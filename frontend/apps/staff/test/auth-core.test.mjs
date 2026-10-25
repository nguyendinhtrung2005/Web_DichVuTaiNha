import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { generateKeyPairSync, randomBytes, sign, verify } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStaffAuth, AuthBffError } from '../lib/server/auth-core.mjs';
import { loadStaffAuthConfig } from '../lib/server/config.mjs';

// Independent tests: a labelled Auth HTTP double signs RS256 with a TEST-ONLY key.
// This does not replace real Auth in runtime or establish live integration evidence.
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const employee = { id: '9109002', role: 'EMPLOYEE', status: 'ACTIVE' };
const testPassword = ' unit-password-with-spaces ';

function matches(status, code) {
  return error => error instanceof AuthBffError && error.status === status && error.code === code;
}

function jwt(user, time, ttl, { badSignature = false, algorithm = 'RS256' } = {}) {
  const header = Buffer.from(JSON.stringify({ alg: algorithm, typ: 'JWT', kid: 'unit-only' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: user.id, userId: user.id, role: user.role, status: user.status,
    active: true, locked: false, iss: 'unit-auth', aud: 'unit-staff', iat: Math.floor(time / 1000),
    exp: Math.floor(time / 1000) + ttl, jti: randomBytes(16).toString('hex') })).toString('base64url');
  const signature = badSignature ? randomBytes(256) : sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), keys.privateKey);
  return `${header}.${payload}.${signature.toString('base64url')}`;
}

async function fixture(t, overrides = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cleanhome-staff-auth-unit-'));
  const clock = { value: Date.now() };
  const control = { user: { ...employee }, tokenTtl: 900, expiresIn: 900, captures: [], introspectCalls: 0 };
  const server = createServer(async (req, res) => {
    function json(status, body) {
      res.writeHead(status, { 'Content-Type': 'application/json', ...(status === 429 ? { 'Retry-After': '12' } : {}) });
      res.end(JSON.stringify(body));
    }
    try {
      if (req.url === '/api/v1/auth/login' && req.method === 'POST') {
        let raw = '';
        for await (const chunk of req) raw += chunk;
        const input = JSON.parse(raw);
        control.captures.push(input);
        if (control.redirect) { res.writeHead(302, { Location: 'http://127.0.0.1:1/never-follow' }); return res.end(); }
        if (control.delay) {
          const timer = setTimeout(() => { if (!res.destroyed) json(503, { error: { code: 'UNAVAILABLE' } }); }, control.delay);
          timer.unref();
          return;
        }
        if (control.loginError) return json(control.loginError.status, { error: control.loginError });
        if (control.malformed) return json(200, control.malformed);
        if (control.hugeBody) return json(200, { excessive: 'x'.repeat(20000) });
        if (input.password !== testPassword) return json(401, { error: { code: 'INVALID_CREDENTIALS', message: 'Private upstream text must not be forwarded.' } });
        control.lastToken = jwt(control.user, clock.value, control.tokenTtl, control);
        return json(200, { accessToken: control.lastToken, tokenType: 'Bearer', expiresIn: control.expiresIn, user: control.user });
      }
      if (req.url === '/api/v1/auth/introspect' && req.method === 'GET') {
        control.introspectCalls++;
        control.onIntrospect?.();
        if (control.introspectGate) await control.introspectGate;
        if (control.introspectError) return json(control.introspectError.status, { error: control.introspectError });
        const token = req.headers.authorization?.replace(/^Bearer /, '') || '';
        const [header, payload, signature] = token.split('.');
        if (!verify('RSA-SHA256', Buffer.from(`${header}.${payload}`), keys.publicKey, Buffer.from(signature || '', 'base64url'))) {
          return json(401, { error: { code: 'UNAUTHENTICATED' } });
        }
        const data = JSON.parse(Buffer.from(payload, 'base64url'));
        if (data.exp * 1000 <= clock.value) return json(401, { error: { code: 'UNAUTHENTICATED' } });
        return json(200, { sub: control.introspectionId || data.sub, userId: data.sub, role: data.role,
          status: data.status, active: true, locked: false });
      }
      return json(404, { error: { code: 'NOT_FOUND' } });
    } catch { if (!res.headersSent) json(500, { error: { code: 'UNIT_DOUBLE_ERROR' } }); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const env = {
    NODE_ENV: 'test', AUTH_SERVICE_URL: `http://127.0.0.1:${server.address().port}`,
    STAFF_SESSION_DIR: path.join(root, 'sessions'), STAFF_SESSION_KEY_FILE: path.join(root, 'session.key'),
    STAFF_AUTH_TIMEOUT_MS: '1000', ...overrides,
  };
  const config = loadStaffAuthConfig(env, root);
  await writeFile(config.keyFile, randomBytes(32), { mode: 0o600 });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    // Only this test's exclusive mkdtemp directory is removed, never runtime data.
    assert.equal(path.basename(root).startsWith('cleanhome-staff-auth-unit-'), true);
    await rm(root, { recursive: true, force: true });
  });
  return { root, config, clock, control, core: createStaffAuth({ config, now: () => clock.value }),
    login: () => createStaffAuth({ config, now: () => clock.value }).login({ phone: 'TEST-EMPLOYEE-UC9', password: testPassword }) };
}

test('configuration: server defaults, HTTPS production and explicit durable paths', () => {
  const dev = loadStaffAuthConfig({}, process.cwd());
  assert.equal(dev.appOrigin, 'http://localhost:3002');
  assert.equal(dev.authUrl, 'http://127.0.0.1:4001');
  assert.equal(dev.secureCookie, false);
  assert.equal(dev.cookieName, 'cleanhome_staff_session');
  assert.throws(() => loadStaffAuthConfig({ NODE_ENV: 'production' }));
  const deployment = { NODE_ENV: 'production', AUTH_SERVICE_URL: 'https://auth.example.test', STAFF_APP_ORIGIN: 'https://staff.example.test',
    STAFF_SESSION_DIR: path.resolve('staff-private-sessions'), STAFF_SESSION_KEY_FILE: path.resolve('staff-private.key') };
  assert.equal(loadStaffAuthConfig(deployment).secureCookie, true);
  assert.throws(() => loadStaffAuthConfig({ ...deployment, STAFF_APP_ORIGIN: 'http://staff.example.test' }));
  assert.throws(() => loadStaffAuthConfig({ ...deployment, STAFF_SESSION_DIR: 'relative' }));
  assert.throws(() => loadStaffAuthConfig({ AUTH_SERVICE_URL: 'http://127.0.0.1:4001/other' }));
  assert.throws(() => loadStaffAuthConfig({ AUTH_SERVICE_URL: 'http://user:password@127.0.0.1:4001' }));
  assert.throws(() => loadStaffAuthConfig({ STAFF_SESSION_DIR: path.join(process.cwd(), 'public', 'sessions') }));
  assert.equal(loadStaffAuthConfig({ STAFF_SESSION_MAX_AGE_SECONDS: '2' }).maxAgeSeconds, 2);
  assert.throws(() => loadStaffAuthConfig({ STAFF_SESSION_MAX_AGE_SECONDS: '0' }));
});

test('login preserves password, trims TEST-* phone and requests EMPLOYEE only', async t => {
  const f = await fixture(t);
  const result = await f.core.login({ phone: '  TEST-EMPLOYEE-UC9  ', password: testPassword });
  assert.deepEqual(f.control.captures[0], { phone: 'TEST-EMPLOYEE-UC9', password: testPassword, role: 'EMPLOYEE' });
  assert.deepEqual(result.session.user, employee);
  assert.equal(result.sid.length, 43);
  assert.equal(Object.hasOwn(result, 'accessToken'), false);
  assert.equal(JSON.stringify(result).includes(f.control.lastToken), false);
  await assert.rejects(f.core.login({ phone: 'TEST\nBAD', password: testPassword }), matches(400, 'INVALID_INPUT'));
  await assert.rejects(f.core.login({ phone: 'x', password: testPassword, role: 'ADMIN' }), matches(400, 'INVALID_INPUT'));
  await assert.rejects(f.core.login({ phone: 'x', password: '🙂'.repeat(129) }), matches(400, 'INVALID_INPUT'));
});

test('persistent encrypted session survives a new service instance and reload inspection', async t => {
  const f = await fixture(t);
  const loggedIn = await f.login();
  const names = await readdir(f.config.sessionDir);
  assert.equal(names.length, 1);
  assert.match(names[0], /^[a-f0-9]{64}\.json$/);
  const stored = await readFile(path.join(f.config.sessionDir, names[0]), 'utf8');
  assert.equal(stored.includes(f.control.lastToken), false);
  assert.equal(stored.includes(employee.id), false);
  assert.equal(stored.includes(loggedIn.sid), false);
  const restarted = createStaffAuth({ config: f.config, now: () => f.clock.value });
  assert.deepEqual(await restarted.inspect(loggedIn.sid), loggedIn.session);
  assert.equal(f.control.introspectCalls, 2);
});

test('wrong password: 401 with sanitized message and no persisted session', async t => {
  const f = await fixture(t);
  await assert.rejects(f.core.login({ phone: 'TEST-EMPLOYEE-UC9', password: 'wrong' }), error => {
    assert.equal(error.status, 401);
    assert.equal(error.code, 'INVALID_CREDENTIALS');
    assert.equal(error.message.includes('Private upstream'), false);
    return true;
  });
  await assert.rejects(readdir(f.config.sessionDir), { code: 'ENOENT' });
});

test('wrong role: Auth denial and unexpected successful CUSTOMER identity are rejected', async t => {
  const f = await fixture(t);
  f.control.loginError = { status: 403, code: 'ROLE_MISMATCH', message: 'internal data' };
  await assert.rejects(f.login(), matches(403, 'ROLE_MISMATCH'));
  delete f.control.loginError;
  f.control.user = { ...employee, role: 'CUSTOMER' };
  await assert.rejects(f.login(), matches(403, 'ROLE_MISMATCH'));
  await assert.rejects(readdir(f.config.sessionDir), { code: 'ENOENT' });
});

test('inactive employee/account login is rejected without exposing upstream details', async t => {
  const f = await fixture(t);
  f.control.loginError = { status: 403, code: 'EMPLOYEE_INACTIVE', message: 'confidential' };
  await assert.rejects(f.login(), matches(403, 'EMPLOYEE_INACTIVE'));
  delete f.control.loginError;
  f.control.user = { ...employee, status: 'LOCKED' };
  await assert.rejects(f.login(), matches(403, 'ACCOUNT_LOCKED'));
});

test('tokens are not trusted by decoding: Auth introspection rejects an invalid signature', async t => {
  const f = await fixture(t);
  f.control.badSignature = true;
  await assert.rejects(f.login(), matches(401, 'SESSION_EXPIRED'));
  assert.equal(f.control.introspectCalls, 1);
  await assert.rejects(readdir(f.config.sessionDir), { code: 'ENOENT' });
});

test('expiry is absolute, bounded by token exp, response expiresIn and configured maximum', async t => {
  const f = await fixture(t, { STAFF_SESSION_MAX_AGE_SECONDS: '30' });
  const result = await f.login();
  assert.equal(Date.parse(result.session.expiresAt), f.clock.value + 30000);
  f.clock.value += 10000;
  assert.equal((await f.core.inspect(result.sid)).expiresAt, result.session.expiresAt);
  f.clock.value += 20001;
  const calls = f.control.introspectCalls;
  await assert.rejects(f.core.inspect(result.sid), matches(401, 'SESSION_EXPIRED'));
  assert.equal(f.control.introspectCalls, calls);
  assert.equal((await readdir(f.config.sessionDir)).length, 0);
  const other = await fixture(t);
  other.control.tokenTtl = 60;
  const byToken = await other.login();
  assert.equal(Date.parse(byToken.session.expiresAt), Math.floor(other.clock.value / 1000) * 1000 + 60000);
  other.control.tokenTtl = 900;
  other.control.expiresIn = 60;
  const byResponse = await other.login();
  assert.equal(Date.parse(byResponse.session.expiresAt), other.clock.value + 60000);
});

test('logout is persistent, idempotent, and does not invalidate a different session', async t => {
  const f = await fixture(t);
  const a = await f.login();
  const b = await f.login();
  assert.notEqual(a.sid, b.sid);
  await f.core.logout(a.sid);
  await f.core.logout(a.sid);
  await assert.rejects(createStaffAuth({ config: f.config }).inspect(a.sid), matches(401, 'SESSION_EXPIRED'));
  assert.deepEqual(await f.core.inspect(b.sid), b.session);
  assert.equal((await readdir(f.config.sessionDir)).length, 1);
});

test('successful re-login rotates SID and invalidates the previous session', async t => {
  const f = await fixture(t);
  const old = await f.login();
  const next = await f.core.login({ phone: 'TEST-EMPLOYEE-UC9', password: testPassword }, old.sid);
  assert.notEqual(next.sid, old.sid);
  await assert.rejects(f.core.inspect(old.sid), matches(401, 'SESSION_EXPIRED'));
  assert.deepEqual(await f.core.inspect(next.sid), next.session);
  assert.equal((await readdir(f.config.sessionDir)).length, 1);
});

test('Auth dependency failure fails closed, keeps session, and recovers without re-login', async t => {
  const f = await fixture(t);
  const loggedIn = await f.login();
  f.control.introspectError = { status: 503, code: 'DATABASE_UNAVAILABLE' };
  await assert.rejects(f.core.inspect(loggedIn.sid), matches(503, 'AUTH_UNAVAILABLE'));
  assert.equal((await readdir(f.config.sessionDir)).length, 1);
  delete f.control.introspectError;
  assert.deepEqual(await f.core.inspect(loggedIn.sid), loggedIn.session);
});

test('account lock or role change at introspection revokes the stored session', async t => {
  const f = await fixture(t);
  const loggedIn = await f.login();
  f.control.introspectError = { status: 403, code: 'ACCOUNT_LOCKED' };
  await assert.rejects(f.core.inspect(loggedIn.sid), matches(403, 'ACCOUNT_LOCKED'));
  assert.equal((await readdir(f.config.sessionDir)).length, 0);
  delete f.control.introspectError;
  await assert.rejects(f.core.inspect(loggedIn.sid), matches(401, 'SESSION_EXPIRED'));
});

test('identity mismatch in introspection cannot authenticate another user', async t => {
  const f = await fixture(t);
  const loggedIn = await f.login();
  f.control.introspectionId = '9109101';
  await assert.rejects(f.core.inspect(loggedIn.sid), matches(502, 'AUTH_INVALID_RESPONSE'));
});

test('concurrent logout cannot recreate or renew a session while inspection is pending', async t => {
  const f = await fixture(t);
  const loggedIn = await f.login();
  let started;
  const awaiting = new Promise(resolve => { started = resolve; });
  let resume;
  f.control.onIntrospect = started;
  f.control.introspectGate = new Promise(resolve => { resume = resolve; });
  const inspect = f.core.inspect(loggedIn.sid);
  await awaiting;
  await f.core.logout(loggedIn.sid);
  resume();
  await assert.rejects(inspect, matches(401, 'SESSION_EXPIRED'));
  assert.equal((await readdir(f.config.sessionDir)).length, 0);
});

test('invalid/missing SID is SESSION_REQUIRED without creating storage or calling Auth', async t => {
  const f = await fixture(t);
  for (const value of [undefined, '', '../escape', 'x'.repeat(100), '_'.repeat(43)]) {
    await assert.rejects(f.core.inspect(value), matches(401, 'SESSION_REQUIRED'));
  }
  assert.equal(f.control.introspectCalls, 0);
  await assert.rejects(readdir(f.config.sessionDir), { code: 'ENOENT' });
});

test('malformed Auth response, numeric ID and wrong JWT algorithm fail before persistence', async t => {
  const f = await fixture(t);
  f.control.malformed = { tokenType: 'Bearer' };
  await assert.rejects(f.login(), matches(502, 'AUTH_INVALID_RESPONSE'));
  delete f.control.malformed;
  f.control.user.id = 9109002;
  await assert.rejects(f.login(), matches(502, 'AUTH_INVALID_RESPONSE'));
  f.control.user.id = '9223372036854775808';
  await assert.rejects(f.login(), matches(502, 'AUTH_INVALID_RESPONSE'));
  f.control.user.id = employee.id;
  f.control.algorithm = 'HS256';
  await assert.rejects(f.login(), matches(502, 'AUTH_INVALID_RESPONSE'));
  assert.equal(f.control.introspectCalls, 0);
});

test('network/timeout/redirect failures are bounded and sanitized as dependency failures', async t => {
  const f = await fixture(t, { STAFF_AUTH_TIMEOUT_MS: '100' });
  f.control.delay = 500;
  await assert.rejects(f.login(), matches(503, 'AUTH_UNAVAILABLE'));
  delete f.control.delay;
  f.control.redirect = true;
  await assert.rejects(f.login(), matches(503, 'AUTH_UNAVAILABLE'));
  const network = createStaffAuth({ config: f.config, fetchImpl: async () => { throw new Error('upstream-password-must-not-escape'); } });
  await assert.rejects(network.login({ phone: 'x', password: testPassword }), error => {
    assert.equal(error.status, 503);
    assert.equal(error.message.includes('upstream-password'), false);
    return true;
  });
});

test('rate limit preserves safe Retry-After; oversized/unknown errors do not leak data', async t => {
  const f = await fixture(t);
  f.control.loginError = { status: 429, code: 'LOGIN_RATE_LIMITED', message: 'private upstream' };
  await assert.rejects(f.login(), error => error.status === 429 && error.retryAfter === 12 && !error.message.includes('private'));
  f.control.loginError = { status: 400, code: 'UNKNOWN_PRIVATE_FAILURE', message: 'private upstream' };
  await assert.rejects(f.login(), matches(502, 'AUTH_INVALID_RESPONSE'));
  delete f.control.loginError;
  f.control.hugeBody = true;
  await assert.rejects(f.login(), matches(502, 'AUTH_INVALID_RESPONSE'));
});

test('missing/wrong storage key fails closed and is never generated implicitly', async t => {
  const f = await fixture(t);
  await rm(f.config.keyFile);
  await assert.rejects(f.login(), matches(503, 'SESSION_STORE_UNAVAILABLE'));
  await assert.rejects(readFile(f.config.keyFile), { code: 'ENOENT' });
  await writeFile(f.config.keyFile, randomBytes(31), { mode: 0o600 });
  await assert.rejects(f.login(), matches(503, 'SESSION_STORE_UNAVAILABLE'));
});

test('unusable session directory does not fall back to in-process storage', async t => {
  const f = await fixture(t);
  await writeFile(f.config.sessionDir, 'not a directory', { mode: 0o600 });
  await assert.rejects(f.login(), matches(503, 'SESSION_STORE_UNAVAILABLE'));
  assert.equal((await readFile(f.config.sessionDir, 'utf8')), 'not a directory');
});

test('encrypted record tampering and key replacement cannot authenticate a session', async t => {
  const f = await fixture(t);
  const loggedIn = await f.login();
  const [name] = await readdir(f.config.sessionDir);
  const target = path.join(f.config.sessionDir, name);
  const original = await readFile(target);
  const envelope = JSON.parse(original);
  envelope.data = randomBytes(Buffer.from(envelope.data, 'base64url').length).toString('base64url');
  await writeFile(target, JSON.stringify(envelope));
  await assert.rejects(f.core.inspect(loggedIn.sid), matches(503, 'SESSION_STORE_UNAVAILABLE'));
  await writeFile(target, original);
  await writeFile(f.config.keyFile, randomBytes(32));
  await assert.rejects(f.core.inspect(loggedIn.sid), matches(503, 'SESSION_STORE_UNAVAILABLE'));
});

test('expired cleanup leaves unrelated files intact and does not extend existing records', async t => {
  const f = await fixture(t, { STAFF_SESSION_MAX_AGE_SECONDS: '2' });
  await mkdir(f.config.sessionDir, { mode: 0o700 });
  const keep = path.join(f.config.sessionDir, 'foreign-backup.txt');
  await writeFile(keep, 'keep unchanged');
  const previous = await f.login();
  f.clock.value += 3000;
  await f.login();
  assert.equal((await readdir(f.config.sessionDir)).filter(name => name.endsWith('.json')).length, 1);
  assert.equal(await readFile(keep, 'utf8'), 'keep unchanged');
  await assert.rejects(f.core.inspect(previous.sid), matches(401, 'SESSION_EXPIRED'));
});
