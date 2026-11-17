import { constants } from 'node:fs';
import { lstat, mkdir, open, opendir, rename, unlink } from 'node:fs/promises';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';

const SESSION_NAME = /^[a-f0-9]{64}\.json$/;
const MAX_BODY_BYTES = 16384;
const MAX_SESSION_BYTES = 32768;
const MAX_ID = 9223372036854775807n;
const OPERATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function validRefreshToken(value) {
  return typeof value === 'string' && value.length === 87 && value.split('.').length === 2
    && value.split('.').every(validSid);
}

function canonicalTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) throw invalidResponse();
  const result = Date.parse(value);
  if (!Number.isSafeInteger(result) || new Date(result).toISOString() !== value) throw invalidResponse();
  return result;
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
      if (!recordObject(record) || ![1, 2].includes(record.version) || !Number.isSafeInteger(record.createdAt)
        || !Number.isSafeInteger(record.expiresAt) || record.expiresAt <= record.createdAt) throw new Error('INVALID_SESSION');
      const user = identity(record.user);
      const metadata = tokenMetadata(record.token, user, 0);
      if (record.version === 1) {
        if (record.expiresAt > metadata.exp * 1000 || record.expiresAt > record.createdAt + 3600000) throw new Error('INVALID_SESSION_EXPIRY');
        return { ...record, user, expiresAt: Math.min(record.expiresAt, record.createdAt + this.config.maxAgeSeconds * 1000) };
      }
      if (!validRefreshToken(record.refreshToken) || !Number.isSafeInteger(record.accessExpiresAt)
        || record.accessExpiresAt > metadata.exp * 1000 || record.accessExpiresAt <= record.createdAt
        || !Number.isSafeInteger(record.lastRenewedAt) || record.lastRenewedAt < record.createdAt
        || record.lastRenewedAt >= record.expiresAt
        || !Number.isSafeInteger(record.refreshExpiresAt) || !Number.isSafeInteger(record.refreshCreatedAt)
        || record.refreshCreatedAt > record.createdAt + 60000 || record.refreshCreatedAt < 0
        || record.refreshExpiresAt <= record.refreshCreatedAt || record.expiresAt > record.refreshExpiresAt
        || ![null, undefined].includes(record.refreshAbsoluteExpiresAt) && (!Number.isSafeInteger(record.refreshAbsoluteExpiresAt)
          || record.refreshAbsoluteExpiresAt <= record.refreshCreatedAt || record.refreshExpiresAt > record.refreshAbsoluteExpiresAt)
        || record.absoluteExpiresAt !== null && (!Number.isSafeInteger(record.absoluteExpiresAt)
          || record.absoluteExpiresAt <= record.createdAt || record.expiresAt > record.absoluteExpiresAt)
        || record.pendingRefresh !== undefined && (!recordObject(record.pendingRefresh)
          || !OPERATION_ID.test(record.pendingRefresh.operationId) || !Number.isSafeInteger(record.pendingRefresh.startedAt))) throw new Error('INVALID_RENEWABLE_SESSION');
      const configuredCap = this.config.absoluteAgeSeconds ? record.createdAt + this.config.absoluteAgeSeconds * 1000 : Infinity;
      const configuredIdleCap = record.lastRenewedAt + this.config.idleTimeoutSeconds * 1000;
      return { ...record, user, expiresAt: Math.min(record.expiresAt, configuredCap, configuredIdleCap) };
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
    if (await this.revoked(sid)) return null;
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
      const encrypted = Buffer.concat([cipher.update(JSON.stringify({ ...record, version: record.version || 1 }), 'utf8'), cipher.final()]);
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

  async revoked(sid) {
    if (!validSid(sid)) return true;
    try {
      const stat = await lstat(path.join(this.config.sessionDir, filename(sid) + '.revoked'));
      if (!stat.isFile() || stat.isSymbolicLink()) throw storageError();
      return true;
    } catch (error) { if (error.code === 'ENOENT') return false; throw storageError(); }
  }

  async markRevoked(sid) {
    await this.directory();
    const target = path.join(this.config.sessionDir, filename(sid) + '.revoked');
    let handle;
    try {
      handle = await open(target, 'wx', 0o600);
      await handle.writeFile(JSON.stringify({ version: 1, revokedAt: this.now() }));
      await handle.sync();
    } catch (error) { if (error.code !== 'EEXIST') throw storageError(); }
    finally { await handle?.close(); }
  }

  async locked(sid, operation) {
    await this.directory();
    const target = path.join(this.config.sessionDir, filename(sid) + '.lock');
    const deadline = Date.now() + Math.min(10000, (this.config.timeoutMs || 8000) + 1500);
    let handle;
    try {
      while (!handle) {
        try { handle = await open(target, 'wx', 0o600); }
        catch (error) {
          if (error.code !== 'EEXIST' || Date.now() >= deadline) throw storageError();
          await new Promise(done => setTimeout(done, 20));
        }
      }
      // A lock left by a crashed process fails closed; never break another process's lock.
      return await operation();
    } finally {
      if (handle) { await handle.close(); await unlink(target).catch(() => {}); }
    }
  }

  async replace(sid, record) {
    if (!validSid(sid) || await this.revoked(sid)) throw expired();
    const name = filename(sid), target = path.join(this.config.sessionDir, name);
    let key, handle, temporary;
    try {
      // Never recreate a missing SID. The caller also holds the per-SID lock.
      const prior = await lstat(target);
      if (!prior.isFile() || prior.isSymbolicLink()) throw storageError();
      key = await this.key();
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(Buffer.from(`cleanhome-staff-session:v1:${name}`));
      const encrypted = Buffer.concat([cipher.update(JSON.stringify(record), 'utf8'), cipher.final()]);
      const encoded = JSON.stringify({ version: 1, iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), data: encrypted.toString('base64url') });
      if (Buffer.byteLength(encoded) > MAX_SESSION_BYTES) throw storageError();
      temporary = target + '.' + randomUUID() + '.tmp';
      handle = await open(temporary, 'wx', 0o600);
      await handle.writeFile(encoded); await handle.sync(); await handle.close(); handle = undefined;
      if (await this.revoked(sid)) throw expired();
      await rename(temporary, target); temporary = undefined;
      if (await this.revoked(sid)) { await this.remove(sid); throw expired(); }
    } catch (error) {
      if (error instanceof AuthBffError) throw error;
      throw storageError();
    } finally { await handle?.close().catch(() => {}); if (temporary) await unlink(temporary).catch(() => {}); key?.fill(0); }
  }

  async queueRevocation(sid, record) {
    const directory = path.join(this.config.sessionDir, 'revocations');
    await assertNoSymlinks(directory); await mkdir(directory, { recursive: true, mode: 0o700 });
    const name = filename(sid), target = path.join(directory, name);
    let key, handle;
    try {
      key = await this.key();
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(Buffer.from(`cleanhome-staff-revocation:v1:${name}`));
      const body = { version: 1, refreshToken: record.refreshToken, operationId: randomUUID() };
      const encrypted = Buffer.concat([cipher.update(JSON.stringify(body), 'utf8'), cipher.final()]);
      const encoded = JSON.stringify({ version: 1, iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), data: encrypted.toString('base64url') });
      handle = await open(target, 'wx', 0o600); await handle.writeFile(encoded); await handle.sync();
    } catch (error) { if (error.code !== 'EEXIST') throw storageError(); }
    finally { await handle?.close(); key?.fill(0); }
    return name;
  }

  async pendingRevocation(name) {
    let key;
    try {
      if (!SESSION_NAME.test(name)) throw storageError();
      const envelope = JSON.parse((await privateFile(path.join(this.config.sessionDir, 'revocations', name), MAX_SESSION_BYTES)).toString('utf8'));
      if (envelope.version !== 1) throw storageError();
      key = await this.key();
      const decipher = createDecipheriv('aes-256-gcm', key, canonicalBytes(envelope.iv, 12));
      decipher.setAAD(Buffer.from(`cleanhome-staff-revocation:v1:${name}`)); decipher.setAuthTag(canonicalBytes(envelope.tag, 16));
      const record = JSON.parse(Buffer.concat([decipher.update(canonicalBytes(envelope.data)), decipher.final()]).toString('utf8'));
      if (record.version !== 1 || !validRefreshToken(record.refreshToken) || !OPERATION_ID.test(record.operationId)) throw storageError();
      return record;
    } catch { throw storageError(); }
    finally { key?.fill(0); }
  }

  async removeRevocation(name) {
    if (!SESSION_NAME.test(name)) throw storageError();
    const target = path.join(this.config.sessionDir, 'revocations', name);
    try { await privateFile(target, MAX_SESSION_BYTES); await unlink(target); }
    catch (error) { if (error.code !== 'ENOENT') throw storageError(); }
  }

  async revocationNames() {
    let directory;
    const names = [];
    try {
      await assertNoSymlinks(path.join(this.config.sessionDir, 'revocations'));
      directory = await opendir(path.join(this.config.sessionDir, 'revocations'));
      for await (const entry of directory) {
        if (entry.isFile() && SESSION_NAME.test(entry.name)) { names.push(entry.name); break; }
      }
    } catch (error) { if (error.code !== 'ENOENT') throw storageError(); }
    return names;
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
  if (status === 403 && ['BFF_CLIENT_REQUIRED', 'BFF_CLIENT_DENIED'].includes(code)) return unavailable();
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
  return { user: { ...record.user }, expiresAt: new Date(record.expiresAt).toISOString(), ...(record.version === 2 ? { renewable: true } : {}) };
}

/** Staff-only BFF authentication. All tokens remain in encrypted server storage. */
export function createStaffAuth({ config, fetchImpl = fetch, now = Date.now }) {
  const store = new FileSessionStore(config, now);
  const renewalHeaders = () => {
    if (!config.renewalEnabled || typeof config.bffToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(config.bffToken)) throw unavailable();
    return { Accept: 'application/json', 'Content-Type': 'application/json', 'X-CleanHome-BFF-Authorization': 'Bearer ' + config.bffToken };
  };

  function renewableRecord(body, user, time, previous) {
    if (body.tokenType !== 'Bearer' || !Number.isInteger(body.expiresIn) || body.expiresIn < 60 || body.expiresIn > 3600) throw invalidResponse();
    const metadata = tokenMetadata(body.accessToken, user, now());
    const accessExpiresAt = Math.min(time + body.expiresIn * 1000, metadata.exp * 1000);
    if (!validRefreshToken(body.refreshToken)) throw invalidResponse();
    const refreshExpiresAt = canonicalTime(body.refreshExpiresAt);
    const refreshCreatedAt = canonicalTime(body.sessionCreatedAt);
    const refreshAbsoluteExpiresAt = body.sessionAbsoluteExpiresAt === null ? null : canonicalTime(body.sessionAbsoluteExpiresAt);
    if (refreshCreatedAt > now() + 60000 || refreshExpiresAt <= now() || refreshExpiresAt <= refreshCreatedAt
      || refreshAbsoluteExpiresAt !== null && (refreshAbsoluteExpiresAt <= refreshCreatedAt || refreshExpiresAt > refreshAbsoluteExpiresAt)) throw invalidResponse();
    if (previous && (body.refreshToken === previous.refreshToken || body.refreshToken.split('.')[0] !== previous.refreshToken.split('.')[0]
      || refreshCreatedAt !== previous.refreshCreatedAt || refreshAbsoluteExpiresAt !== previous.refreshAbsoluteExpiresAt)) throw invalidResponse();
    const createdAt = previous?.createdAt ?? time;
    const policyCap = config.absoluteAgeSeconds ? createdAt + config.absoluteAgeSeconds * 1000 : Infinity;
    const absoluteExpiresAt = Math.min(policyCap, refreshAbsoluteExpiresAt ?? Infinity, previous?.absoluteExpiresAt ?? Infinity);
    const lastRenewedAt = now();
    const expiresAt = Math.min(refreshExpiresAt, lastRenewedAt + config.idleTimeoutSeconds * 1000, absoluteExpiresAt);
    if (expiresAt <= now() || accessExpiresAt <= now()) throw expired();
    return { version: 2, user, token: body.accessToken, createdAt, lastRenewedAt, accessExpiresAt, expiresAt,
      refreshToken: body.refreshToken, refreshExpiresAt, refreshCreatedAt, refreshAbsoluteExpiresAt,
      absoluteExpiresAt: Number.isFinite(absoluteExpiresAt) ? absoluteExpiresAt : null };
  }

  async function sendRevocation(name) {
    const pending = await store.pendingRevocation(name);
    try {
      await requestAuth(config, fetchImpl, '/api/v1/auth/logout', { method: 'POST', headers: renewalHeaders(), body: JSON.stringify({ refreshToken: pending.refreshToken, operationId: pending.operationId }) });
      await store.removeRevocation(name);
      return true;
    } catch (error) {
      if (error instanceof AuthBffError && [401, 403].includes(error.status)) { await store.removeRevocation(name); return true; }
      return false;
    }
  }

  async function flushOneRevocation() {
    if (!config.renewalEnabled) return;
    try { const [name] = await store.revocationNames(); if (name) await sendRevocation(name); }
    catch { /* Retry a pending revocation later; this does not reactivate its SID. */ }
  }

  async function revokeLocal(sid, record) {
    const queued = await store.queueRevocation(sid, record);
    // Tombstone first: a refresh that is already in flight cannot recreate this SID.
    await store.markRevoked(sid);
    await store.remove(sid);
    return await sendRevocation(queued) ? undefined : { authRevocationPending: true };
  }

  async function currentRenewable(sid) {
    if (!config.renewalEnabled) throw expired();
    return store.locked(sid, async () => {
      let record = await store.read(sid);
      if (!record || record.version !== 2) throw expired();
      try {
        if (record.pendingRefresh || record.accessExpiresAt - now() <= (config.refreshBeforeSeconds || 60) * 1000) {
          if (!record.pendingRefresh) {
            record = { ...record, pendingRefresh: { operationId: randomUUID(), startedAt: now() } };
            // Durable idempotency context precedes the outbound rotation request.
            await store.replace(sid, record);
          }
          const start = now();
          const body = await requestAuth(config, fetchImpl, '/api/v1/auth/refresh', { method: 'POST', headers: renewalHeaders(),
            body: JSON.stringify({ refreshToken: record.refreshToken, operationId: record.pendingRefresh.operationId }) });
          const user = identity(body.user);
          if (user.id !== record.user.id) throw invalidResponse();
          const updated = renewableRecord(body, user, start, record);
          await introspect(updated.token, updated.user);
          await store.replace(sid, updated);
          record = updated;
        } else {
          // The non-refresh path still verifies signature and current account state.
          tokenMetadata(record.token, record.user, now());
          await introspect(record.token, record.user);
        }
      } catch (error) {
        if (error instanceof AuthBffError && [401, 403].includes(error.status)) {
          await store.markRevoked(sid); await store.remove(sid);
        }
        throw error;
      }
      const current = await store.read(sid);
      if (!current || current.token !== record.token) throw expired();
      return current;
    });
  }

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
    if (record.version === 2) return currentRenewable(sid);
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
      await flushOneRevocation();
      const start = now();
      const inputCredentials = credentials(input);
      const body = await requestAuth(config, fetchImpl, '/api/v1/auth/login', { method: 'POST', headers: config.renewalEnabled ? renewalHeaders() : { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ ...inputCredentials, ...(config.renewalEnabled ? { sessionMode: 'renewable' } : {}) }) });
      const user = identity(body.user);
      if (body.tokenType !== 'Bearer' || !Number.isInteger(body.expiresIn) || body.expiresIn < 60 || body.expiresIn > 3600) throw invalidResponse();
      const metadata = tokenMetadata(body.accessToken, user, now());
      await introspect(body.accessToken, user);
      const expiresAt = Math.min(start + body.expiresIn * 1000, metadata.exp * 1000, start + config.maxAgeSeconds * 1000);
      if (expiresAt <= now()) throw expired();
      const record = config.renewalEnabled ? renewableRecord(body, user, start) : { user, token: body.accessToken, createdAt: start, expiresAt };
      const sid = await store.create(record);
      try {
        const previous = await store.read(oldSid);
        if (previous?.version === 2) await revokeLocal(oldSid, previous);
        else await store.remove(oldSid);
      }
      catch (error) { await store.remove(sid).catch(() => {}); throw error; }
      return { sid, session: publicSession(record) };
    },

    async inspect(sid) {
      // Renewable records may rotate before use; durable tombstones prevent resurrection.
      return publicSession(await authorizedRecord(sid));
    },

    async renew(sid) {
      if (!config.renewalEnabled) throw new AuthBffError(503, 'RENEWAL_DISABLED', 'Gia hạn phiên chưa được cấu hình.');
      await flushOneRevocation();
      return { session: publicSession(await authorizedRecord(sid)) };
    },

    // Server-only capability, never part of the public session DTO or browser response.
    async withAccessToken(sid, operation, options) {
      let record = await authorizedRecord(sid);
      let result;
      try { result = await operation(record.token); }
      catch (error) {
        // Fixed GET adapters opt in. A permission denial, a still-valid token,
        // legacy session or an unapproved mutation must never be replayed.
        if (options?.retryOnExpiredToken !== true || record.version !== 2 || record.accessExpiresAt > now()
          || !(error instanceof AuthBffError) || error.status !== 401 || error.code !== 'SESSION_EXPIRED') throw error;
        const renewed = await authorizedRecord(sid);
        if (renewed.user.id !== record.user.id || renewed.token === record.token) throw expired();
        record = renewed;
        // At most one retry. The per-SID durable lock handles concurrent rotation.
        result = await operation(record.token);
      }
      const current = await store.read(sid);
      // A parallel tab can safely rotate the access token while this operation runs.
      // Logout/deletion/tombstones still invalidate the result.
      if (!current || current.user.id !== record.user.id || current.version !== record.version
        || current.version === 1 && current.token !== record.token) throw expired();
      return result;
    },

    async logout(sid) {
      const record = await store.read(sid);
      if (record?.version === 2) return revokeLocal(sid, record);
      await store.remove(sid);
    },
  });
}
