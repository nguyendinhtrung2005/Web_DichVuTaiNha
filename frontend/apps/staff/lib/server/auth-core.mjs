import { constants } from 'node:fs';
import { lstat, mkdir, open, opendir, unlink } from 'node:fs/promises';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import path from 'node:path';

const SESSION_NAME = /^[a-f0-9]{64}\.json$/;
const MAX_BODY_BYTES = 16384;
const MAX_SESSION_BYTES = 32768;
const MAX_ID = 9223372036854775807n;

export class AuthBffError extends Error {
  constructor(status, code, message, retryAfter) {
    super(message);
    this.name = 'AuthBffError';
    this.status = status;
    this.code = code;
    if (retryAfter !== undefined) this.retryAfter = retryAfter;
  }
}

const expired = () => new AuthBffError(401, 'SESSION_EXPIRED', 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
const required = () => new AuthBffError(401, 'SESSION_REQUIRED', 'Vui lòng đăng nhập bằng tài khoản nhân viên.');
const storageError = () => new AuthBffError(503, 'SESSION_STORE_UNAVAILABLE', 'Chưa thể truy cập phiên đăng nhập. Vui lòng thử lại.', 5);
const unavailable = () => new AuthBffError(503, 'AUTH_UNAVAILABLE', 'Dịch vụ đăng nhập tạm thời gián đoạn. Vui lòng thử lại.', 5);
const invalidResponse = () => new AuthBffError(502, 'AUTH_INVALID_RESPONSE', 'Chưa thể xác minh phản hồi từ dịch vụ đăng nhập.');

function id(value) {
  return typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= MAX_ID;
}

function recordObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function canonicalBytes(value, length) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('INVALID_ENCODING');
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.toString('base64url') !== value || (length !== undefined && decoded.length !== length)) throw new Error('INVALID_ENCODING');
  return decoded;
}

function validSid(sid) {
  try { return typeof sid === 'string' && sid.length === 43 && canonicalBytes(sid, 32).length === 32; }
  catch { return false; }
}

function filename(sid) {
  return `${createHash('sha256').update(sid).digest('hex')}.json`;
}

function identity(user) {
  if (!recordObject(user) || !id(user.id)) throw invalidResponse();
  if (user.role !== 'EMPLOYEE') throw new AuthBffError(403, 'ROLE_MISMATCH', 'Tài khoản không thuộc khu vực nhân viên.');
  if (user.status !== 'ACTIVE') throw new AuthBffError(403, 'ACCOUNT_LOCKED', 'Tài khoản hiện không hoạt động.');
  return { id: user.id, role: 'EMPLOYEE', status: 'ACTIVE' };
}

// This decode only bounds session lifetime and checks response consistency.
// Signature, issuer, audience and live account state are verified by Auth introspection.
function tokenMetadata(token, user, time) {
  try {
    if (typeof token !== 'string' || token.length > 8000) throw new Error();
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error();
    const header = JSON.parse(canonicalBytes(parts[0]).toString('utf8'));
    const payload = JSON.parse(canonicalBytes(parts[1]).toString('utf8'));
    canonicalBytes(parts[2]);
    if (!recordObject(header) || header.alg !== 'RS256' || header.typ !== 'JWT'
      || typeof header.kid !== 'string' || header.kid.length < 1 || header.kid.length > 128
      || !recordObject(payload) || payload.sub !== user.id || payload.userId !== user.id
      || payload.role !== 'EMPLOYEE' || payload.status !== 'ACTIVE' || payload.active !== true || payload.locked !== false
      || !Number.isSafeInteger(payload.exp) || !Number.isSafeInteger(payload.iat)
      || payload.exp <= payload.iat || payload.exp - payload.iat > 3600
      || !Number.isSafeInteger(payload.exp * 1000) || typeof payload.iss !== 'string' || !payload.iss
      || !(typeof payload.aud === 'string' || (Array.isArray(payload.aud) && payload.aud.every(value => typeof value === 'string')))
      || typeof payload.jti !== 'string' || payload.jti.length < 1 || payload.jti.length > 128) throw new Error();
    if (payload.exp * 1000 <= time) throw expired();
    return payload;
  } catch (error) {
    if (error instanceof AuthBffError) throw error;
    throw invalidResponse();
  }
}

function credentials(input) {
  if (!recordObject(input) || Object.keys(input).some(key => !['phone', 'password'].includes(key))
    || typeof input.phone !== 'string' || !input.phone.trim() || input.phone.trim().length > 20
    || /[\u0000-\u001f\u007f]/.test(input.phone) || typeof input.password !== 'string'
    || Array.from(input.password).length < 1 || Array.from(input.password).length > 128
    || Buffer.byteLength(input.password, 'utf8') > 512) {
    throw new AuthBffError(400, 'INVALID_INPUT', 'Vui lòng nhập số điện thoại và mật khẩu hợp lệ.');
  }
  return { phone: input.phone.trim(), password: input.password, role: 'EMPLOYEE' };
}

async function assertNoSymlinks(target) {
  const absolute = path.resolve(target);
  const root = path.parse(absolute).root;
  let current = root;
  for (const part of absolute.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new Error('SYMLINK_NOT_ALLOWED');
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
  }
}

function privateMode(stat) {
  if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) throw new Error('PRIVATE_PERMISSIONS_REQUIRED');
}

async function privateFile(target, maxBytes, exactBytes) {
  await assertNoSymlinks(target);
  const before = await lstat(target);
  if (!before.isFile() || before.size > maxBytes || (exactBytes !== undefined && before.size !== exactBytes)) throw new Error('INVALID_PRIVATE_FILE');
  privateMode(before);
  const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.dev !== before.dev || stat.ino !== before.ino || stat.size > maxBytes) throw new Error('PRIVATE_FILE_CHANGED');
    const data = await handle.readFile();
    if (data.length > maxBytes || (exactBytes !== undefined && data.length !== exactBytes)) throw new Error('INVALID_PRIVATE_FILE');
    return data;
  } finally {
    await handle.close();
  }
}

class FileSessionStore {
  constructor(config, now) { this.config = config; this.now = now; }

  async directory() {
    try {
      await assertNoSymlinks(this.config.sessionDir);
      await mkdir(this.config.sessionDir, { recursive: true, mode: 0o700 });
      const stat = await lstat(this.config.sessionDir);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('INVALID_SESSION_DIRECTORY');
      privateMode(stat);
    } catch { throw storageError(); }
  }

  async key() {
    try { return await privateFile(this.config.keyFile, 32, 32); }
    catch { throw storageError(); }
  }

  async readName(name) {
    let key;
    try {
      if (!SESSION_NAME.test(name)) throw new Error('INVALID_SESSION_NAME');
      const bytes = await privateFile(path.join(this.config.sessionDir, name), MAX_SESSION_BYTES);
      const envelope = JSON.parse(bytes.toString('utf8'));
      if (!recordObject(envelope) || envelope.version !== 1) throw new Error('INVALID_SESSION_VERSION');
      key = await this.key();
      const decipher = createDecipheriv('aes-256-gcm', key, canonicalBytes(envelope.iv, 12));
      decipher.setAAD(Buffer.from(`cleanhome-staff-session:v1:${name}`));
      decipher.setAuthTag(canonicalBytes(envelope.tag, 16));
      const content = Buffer.concat([decipher.update(canonicalBytes(envelope.data)), decipher.final()]);
      const record = JSON.parse(content.toString('utf8'));
      if (!recordObject(record) || record.version !== 1 || !Number.isSafeInteger(record.createdAt)
        || !Number.isSafeInteger(record.expiresAt) || record.expiresAt <= record.createdAt) throw new Error('INVALID_SESSION');
      const user = identity(record.user);
      const metadata = tokenMetadata(record.token, user, 0);
      if (record.expiresAt > metadata.exp * 1000 || record.expiresAt > record.createdAt + 3600000) throw new Error('INVALID_SESSION_EXPIRY');
      return { ...record, user, expiresAt: Math.min(record.expiresAt, record.createdAt + this.config.maxAgeSeconds * 1000) };
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw storageError();
    } finally {
      key?.fill(0);
    }
  }

  async read(sid) {
    if (!validSid(sid)) return null;
    await this.directory();
    const record = await this.readName(filename(sid));
    if (record && record.expiresAt <= this.now()) {
      await this.remove(sid);
      return null;
    }
    return record;
  }

  async create(record) {
    await this.directory();
    let key;
    let handle;
    let target;
    try {
      key = await this.key();
      const sid = randomBytes(32).toString('base64url');
      const name = filename(sid);
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(Buffer.from(`cleanhome-staff-session:v1:${name}`));
      const encrypted = Buffer.concat([cipher.update(JSON.stringify({ ...record, version: 1 }), 'utf8'), cipher.final()]);
      const encoded = JSON.stringify({ version: 1, iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), data: encrypted.toString('base64url') });
      if (Buffer.byteLength(encoded) > MAX_SESSION_BYTES) throw new Error('SESSION_TOO_LARGE');
      target = path.join(this.config.sessionDir, name);
      // Exclusive creation: a session is immutable and never overwrites another SID.
      // Its random SID is not returned until the complete encrypted record is durable.
      handle = await open(target, 'wx', 0o600);
      await handle.writeFile(encoded, 'utf8');
      await handle.sync();
      await handle.close();
      handle = undefined;
      await this.cleanup();
      return sid;
    } catch {
      await handle?.close().catch(() => {});
      if (handle && target) await unlink(target).catch(() => {});
      throw storageError();
    } finally {
      key?.fill(0);
    }
  }

  async remove(sid) {
    if (!validSid(sid)) return;
    await this.directory();
    const target = path.join(this.config.sessionDir, filename(sid));
    try {
      const stat = await lstat(target);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('INVALID_SESSION_FILE');
      await unlink(target);
    } catch (error) {
      if (error.code !== 'ENOENT') throw storageError();
    }
  }

  async cleanup() {
    // Bounded sweep of this store's recognized, authenticated, expired records only.
    // Corrupt/foreign files are left intact; lookup fails closed for corrupt sessions.
    let directory;
    try {
      directory = await opendir(this.config.sessionDir);
      let scanned = 0;
      for await (const entry of directory) {
        if (++scanned > 32) break;
        if (!entry.isFile() || !SESSION_NAME.test(entry.name)) continue;
        try {
          const record = await this.readName(entry.name);
          if (record && record.expiresAt <= this.now()) await unlink(path.join(this.config.sessionDir, entry.name));
        } catch { /* Keep unreadable data; do not replace it or fail unrelated sessions. */ }
      }
    } catch { /* Cleanup is bounded maintenance, not a substitute for per-request expiry. */ }
  }
}

function upstreamError(status, body, retryHeader) {
  const code = recordObject(body?.error) ? body.error.code : '';
  if (status >= 500 || status === 404) return unavailable();
  if (status === 429) {
    const seconds = typeof retryHeader === 'string' && /^\d{1,4}$/.test(retryHeader) ? Math.max(1, Math.min(3600, Number(retryHeader))) : 60;
    return new AuthBffError(429, 'LOGIN_RATE_LIMITED', 'Vui lòng chờ trước khi thử đăng nhập lại.', seconds);
  }
  if (status === 401) return code === 'INVALID_CREDENTIALS'
    ? new AuthBffError(401, 'INVALID_CREDENTIALS', 'Số điện thoại hoặc mật khẩu không đúng.') : expired();
  if (status === 403) {
    const messages = {
      ROLE_MISMATCH: 'Tài khoản không thuộc khu vực nhân viên.',
      ACCOUNT_LOCKED: 'Tài khoản hiện không hoạt động.',
      EMPLOYEE_INACTIVE: 'Hồ sơ nhân viên hiện không hoạt động.',
      ROLE_CHANGED: 'Quyền tài khoản đã thay đổi. Vui lòng đăng nhập lại.',
    };
    return new AuthBffError(403, Object.hasOwn(messages, code) ? code : 'ACCESS_DENIED', messages[code] || 'Tài khoản không được phép truy cập.');
  }
  if (status === 400 && code === 'INVALID_INPUT') return new AuthBffError(400, 'INVALID_INPUT', 'Thông tin đăng nhập không hợp lệ.');
  return invalidResponse();
}

async function requestAuth(config, fetchImpl, endpoint, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetchImpl(new URL(endpoint, config.authUrl), { ...init, redirect: 'error', cache: 'no-store', signal: controller.signal });
    if (!response || !Number.isInteger(response.status)) throw invalidResponse();
    if (response.status >= 500 || response.status === 404) throw unavailable();
    if (!(response.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) throw invalidResponse();
    const length = response.headers.get('content-length');
    if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) throw invalidResponse();
    if (!response.body) throw invalidResponse();
    const chunks = [];
    let size = 0;
    const reader = response.body.getReader();
    try {
      while (true) {
        const item = await reader.read();
        if (item.done) break;
        size += item.value.byteLength;
        if (size > MAX_BODY_BYTES) { await reader.cancel(); throw invalidResponse(); }
        chunks.push(item.value);
      }
    } finally { reader.releaseLock(); }
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw invalidResponse(); }
    if (response.status !== 200) throw upstreamError(response.status, body, response.headers.get('retry-after'));
    if (!recordObject(body)) throw invalidResponse();
    return body;
  } catch (error) {
    if (error instanceof AuthBffError) throw error;
    throw unavailable();
  } finally {
    // Also close unread/oversized/error response streams instead of relying on GC.
    controller.abort();
    clearTimeout(timer);
  }
}

function publicSession(record) {
  return { user: { ...record.user }, expiresAt: new Date(record.expiresAt).toISOString() };
}

/** Staff-only BFF authentication. All tokens remain in encrypted server storage. */
export function createStaffAuth({ config, fetchImpl = fetch, now = Date.now }) {
  const store = new FileSessionStore(config, now);

  async function introspect(token, user) {
    const result = await requestAuth(config, fetchImpl, '/api/v1/auth/introspect', { method: 'GET', headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } });
    if (result.role !== 'EMPLOYEE' || result.status !== 'ACTIVE' || result.active !== true || result.locked !== false) {
      throw new AuthBffError(403, 'ACCESS_DENIED', 'Tài khoản không được phép truy cập khu vực nhân viên.');
    }
    if (!id(result.sub) || result.sub !== user.id || result.userId !== user.id) throw invalidResponse();
  }

  async function authorizedRecord(sid) {
    if (!validSid(sid)) throw required();
    const record = await store.read(sid);
    if (!record) throw expired();
    try {
      await introspect(record.token, record.user);
    } catch (error) {
      if (error instanceof AuthBffError && [401, 403].includes(error.status)) await store.remove(sid);
      throw error;
    }
    const current = await store.read(sid);
    if (!current || current.token !== record.token) throw expired();
    return current;
  }

  return Object.freeze({
    async login(input, oldSid) {
      const start = now();
      const body = await requestAuth(config, fetchImpl, '/api/v1/auth/login', { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(credentials(input)) });
      const user = identity(body.user);
      if (body.tokenType !== 'Bearer' || !Number.isInteger(body.expiresIn) || body.expiresIn < 60 || body.expiresIn > 3600) throw invalidResponse();
      const metadata = tokenMetadata(body.accessToken, user, now());
      await introspect(body.accessToken, user);
      const expiresAt = Math.min(start + body.expiresIn * 1000, metadata.exp * 1000, start + config.maxAgeSeconds * 1000);
      if (expiresAt <= now()) throw expired();
      const record = { user, token: body.accessToken, createdAt: start, expiresAt };
      const sid = await store.create(record);
      try { await store.remove(oldSid); }
      catch (error) { await store.remove(sid).catch(() => {}); throw error; }
      return { sid, session: publicSession(record) };
    },

    async inspect(sid) {
      // Do not renew/write during reads. A logout racing introspection cannot resurrect it.
      return publicSession(await authorizedRecord(sid));
    },

    // Server-only capability, never part of the public session DTO or browser response.
    async withAccessToken(sid, operation) {
      const record = await authorizedRecord(sid);
      const result = await operation(record.token);
      const current = await store.read(sid);
      if (!current || current.token !== record.token) throw expired();
      return result;
    },

    async logout(sid) { await store.remove(sid); },
  });
}
