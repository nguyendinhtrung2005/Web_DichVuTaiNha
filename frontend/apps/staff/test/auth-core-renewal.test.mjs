import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes, sign, verify, createHash } from 'node:crypto';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createStaffAuth, AuthBffError } from '../lib/server/auth-core.mjs';
import { loadStaffAuthConfig } from '../lib/server/config.mjs';

// Explicit Auth dependency double and controlled clock; no production keys,
// credentials, MySQL, browser or live Auth are read or modified by this suite.
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const employee = { id: '9109002', role: 'EMPLOYEE', status: 'ACTIVE' };
const matches = (status, code) => error => error instanceof AuthBffError && error.status === status && (!code || error.code === code);
const random = () => randomBytes(32).toString('base64url');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function token(user, now, ttl = 60) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'renewal-unit-only' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: user.id, userId: user.id, role: user.role, status: user.status, active: true, locked: false,
    iss: 'unit-auth', aud: 'unit-staff', iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + ttl, jti: random() })).toString('base64url');
  return header + '.' + payload + '.' + sign('RSA-SHA256', Buffer.from(header + '.' + payload), keys.privateKey).toString('base64url');
}

async function fixture(t, overrides = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'cleanhome-bff-renewal-unit-'));
  const clock = { value: Math.floor(Date.now() / 1000) * 1000 };
  const bffToken = random(), testPassword = random();
  const config = loadStaffAuthConfig({ NODE_ENV: 'test', AUTH_SERVICE_URL: 'http://127.0.0.1:4001',
    STAFF_SESSION_DIR: path.join(directory, 'sessions'), STAFF_SESSION_KEY_FILE: path.join(directory, 'session.key'),
    STAFF_SESSION_RENEWAL_ENABLED: 'true', AUTH_SERVICE_BFF_TOKEN: bffToken,
    STAFF_SESSION_REFRESH_BEFORE_SECONDS: '5', ...overrides }, directory);
  await writeFile(config.keyFile, randomBytes(32), { mode: 0o600 });
  const control = { refreshes: [], logouts: [], introspections: 0, user: { ...employee }, families: new Map(), beforeRefresh: null, afterRefresh: null };
  const json = (body, status = 200) => Response.json(body, { status });
  function response(family) {
    return { accessToken: token(control.user, clock.value), tokenType: 'Bearer', expiresIn: 60, user: { ...control.user },
      refreshToken: family.current, refreshExpiresAt: new Date(clock.value + 604800000).toISOString(),
      sessionCreatedAt: new Date(family.created).toISOString(), sessionAbsoluteExpiresAt: null };
  }
  const fetchImpl = async (input, init) => {
    const endpoint = new URL(input).pathname;
    if (endpoint === '/api/v1/auth/introspect') {
      control.introspections++;
      if (control.introspectGate) await control.introspectGate;
      if (control.introspectError) return json({ error: control.introspectError }, control.introspectError.status);
      const value = init.headers.Authorization?.slice(7), pieces = value?.split('.') || [];
      const payload = pieces.length === 3 ? JSON.parse(Buffer.from(pieces[1], 'base64url')) : null;
      if (!payload || !verify('RSA-SHA256', Buffer.from(pieces[0] + '.' + pieces[1]), keys.publicKey, Buffer.from(pieces[2], 'base64url')) || payload.exp * 1000 <= clock.value) return json({ error: { code: 'UNAUTHENTICATED' } }, 401);
      return json({ sub: payload.sub, userId: payload.sub, role: control.user.role, status: control.user.status, active: control.user.status === 'ACTIVE', locked: control.user.status !== 'ACTIVE' });
    }
    assert.equal(init.headers['X-CleanHome-BFF-Authorization'], control.acceptLegacy && endpoint === '/api/v1/auth/login' ? undefined : 'Bearer ' + bffToken);
    if (control.clientDenied) return json({ error: { code: 'BFF_CLIENT_REQUIRED' } }, 403);
    const body = JSON.parse(init.body);
    if (endpoint === '/api/v1/auth/login') {
      assert.deepEqual(body, { phone: 'TEST-EMPLOYEE-UC9', password: testPassword, role: 'EMPLOYEE', ...(control.acceptLegacy ? {} : { sessionMode: 'renewable' }) });
      clock.value += control.loginAdvanceMs || 0;
      const id = random(), family = { id, created: clock.value, current: id + '.' + random(), receipts: new Map(), revoked: false };
      control.families.set(id, family);
      control.latestFamily = family;
      return json(control.invalidLoginResponse ? { ...response(family), ...control.invalidLoginResponse } : response(family));
    }
    const family = control.families.get(body.refreshToken?.split('.')[0]);
    if (endpoint === '/api/v1/auth/logout') {
      control.logouts.push(body);
      if (control.logoutError) return json({ error: { code: 'UNAVAILABLE' } }, 503);
      if (family) family.revoked = true;
      return json({ ok: true });
    }
    if (endpoint === '/api/v1/auth/refresh') {
      control.refreshes.push(body);
      if (control.beforeRefresh) await control.beforeRefresh(body);
      if (control.refreshError) return json({ error: control.refreshError }, control.refreshError.status);
      if (!family || family.revoked) return json({ error: { code: 'REFRESH_INVALID' } }, 401);
      const receipt = family.receipts.get(body.refreshToken);
      if (receipt) {
        if (receipt.operationId !== body.operationId) { family.revoked = true; return json({ error: { code: 'REFRESH_REUSED' } }, 401); }
        const cached = JSON.parse(Buffer.from(receipt.response.accessToken.split('.')[1], 'base64url'));
        if (cached.exp * 1000 <= clock.value) receipt.response = { ...receipt.response, accessToken: token(control.user, clock.value) };
        return json(receipt.response);
      }
      if (family.current !== body.refreshToken) return json({ error: { code: 'REFRESH_INVALID' } }, 401);
      family.current = family.id + '.' + random();
      const value = response(family);
      family.receipts.set(body.refreshToken, { operationId: body.operationId, response: value });
      if (control.afterRefresh) return control.afterRefresh(value, body);
      return json(value);
    }
    throw new Error('UNEXPECTED_UNIT_ENDPOINT');
  };
  const core = () => createStaffAuth({ config, fetchImpl, now: () => clock.value });
  t.after(async () => {
    assert.ok(path.basename(directory).startsWith('cleanhome-bff-renewal-unit-'));
    await rm(directory, { recursive: true, force: true });
  });
  return { directory, config, clock, control, core, fetchImpl, testPassword, login: () => core().login({ phone: 'TEST-EMPLOYEE-UC9', password: testPassword }) };
}

test('renewal config is opt-in, validates BFF client credential and production idle/absolute limits', () => {
  assert.equal(loadStaffAuthConfig().renewalEnabled, false);
  assert.throws(() => loadStaffAuthConfig({ STAFF_SESSION_RENEWAL_ENABLED: 'true' }));
  const local = loadStaffAuthConfig({ STAFF_SESSION_RENEWAL_ENABLED: 'true', AUTH_SERVICE_BFF_TOKEN: random() });
  assert.equal(local.idleTimeoutSeconds, 604800);
  assert.equal(local.absoluteAgeSeconds, 604800);
  assert.equal(loadStaffAuthConfig({ STAFF_SESSION_ABSOLUTE_SECONDS: '' }).absoluteAgeSeconds, 604800);
  assert.equal(loadStaffAuthConfig({ STAFF_SESSION_ABSOLUTE_SECONDS: '0' }).absoluteAgeSeconds, 0);
  const proposedQa = loadStaffAuthConfig({ STAFF_SESSION_IDLE_SECONDS: '2592000', STAFF_SESSION_ABSOLUTE_SECONDS: '0' });
  assert.equal(proposedQa.idleTimeoutSeconds, 2592000);
  assert.equal(proposedQa.absoluteAgeSeconds, 0);
  assert.equal(proposedQa.renewalEnabled, false, 'A proposed TTL must never turn renewal on implicitly');
  const production = { NODE_ENV: 'production', AUTH_SERVICE_URL: 'https://auth.example.test', STAFF_APP_ORIGIN: 'https://staff.example.test',
    STAFF_SESSION_DIR: path.resolve('private-session-unit'), STAFF_SESSION_KEY_FILE: path.resolve('private-session-key-unit'),
    STAFF_SESSION_RENEWAL_ENABLED: 'true', AUTH_SERVICE_BFF_TOKEN: random() };
  assert.equal(loadStaffAuthConfig(production).absoluteAgeSeconds, 28800);
  for (const overrides of [{ STAFF_SESSION_IDLE_SECONDS: '1801' }, { STAFF_SESSION_ABSOLUTE_SECONDS: '28801' },
    { STAFF_SESSION_ABSOLUTE_SECONDS: '0' }, { AUTH_SERVICE_URL: 'http://localhost:4001' }, { STAFF_APP_ORIGIN: 'http://localhost:3002' }]) assert.throws(() => loadStaffAuthConfig({ ...production, ...overrides }));
});

test('renewable login stores tokens only encrypted and exposes only public session capability', async t => {
  const f = await fixture(t), login = await f.login();
  assert.deepEqual(Object.keys(login.session).sort(), ['expiresAt', 'renewable', 'user']);
  assert.equal(login.session.renewable, true);
  assert.ok(Date.parse(login.session.expiresAt) > f.clock.value + 900000);
  const names = await readdir(f.config.sessionDir);
  assert.equal(names.length, 1);
  const raw = await readFile(path.join(f.config.sessionDir, names[0]), 'utf8');
  for (const value of [login.sid, employee.id, f.control.latestFamily.current]) assert.equal(raw.includes(value), false);
  assert.equal(JSON.stringify(login).includes(f.control.latestFamily.current), false);
});

test('F5/new core instance refreshes a real expired access JWT with a still valid server refresh session', async t => {
  const f = await fixture(t), login = await f.login();
  f.clock.value += 61000;
  const result = await f.core().inspect(login.sid);
  assert.equal(result.user.id, employee.id);
  assert.equal(f.control.refreshes.length, 1);
  assert.equal(result.renewable, true);
  let used;
  await f.core().withAccessToken(login.sid, async value => { used = value; return true; });
  const payload = JSON.parse(Buffer.from(used.split('.')[1], 'base64url'));
  assert.ok(payload.exp * 1000 > f.clock.value);
});

test('healthy inspections and minute renew checks do not rotate a fresh access token unnecessarily', async t => {
  const f = await fixture(t), login = await f.login();
  const before = login.session.expiresAt;
  await f.core().inspect(login.sid);
  const result = await f.core().renew(login.sid);
  assert.equal(result.session.expiresAt, before);
  assert.equal(f.control.refreshes.length, 0);
  assert.ok(f.control.introspections >= 3);
});

test('expired-token read retry: one explicit read retry refreshes a token that expired during the first operation', async t => {
  const f = await fixture(t), login = await f.login(); let calls = 0;
  const result = await f.core().withAccessToken(login.sid, async () => {
    if (++calls === 1) { f.clock.value += 61000; throw new AuthBffError(401, 'SESSION_EXPIRED', 'Unit expiry'); }
    return 'read-recovered';
  }, { retryOnExpiredToken: true });
  assert.equal(result, 'read-recovered'); assert.equal(calls, 2); assert.equal(f.control.refreshes.length, 1);
});

test('expired-token read retry: parallel reads still rotate the same SID only once', async t => {
  const f = await fixture(t), login = await f.login(), gate = deferred(); let waiting = 0;
  const run = () => { let calls = 0; return f.core().withAccessToken(login.sid, async () => {
    if (++calls === 1) { if (++waiting === 3) { f.clock.value += 61000; gate.resolve(); } await gate.promise; throw new AuthBffError(401, 'SESSION_EXPIRED', 'Unit expiry'); }
    return calls;
  }, { retryOnExpiredToken: true }); };
  assert.deepEqual(await Promise.all([run(), run(), run()]), [2, 2, 2]); assert.equal(f.control.refreshes.length, 1);
});

test('expired-token read retry: no permission retry, fresh-token retry, implicit mutation retry or infinite loop', async t => {
  for (const [status, advance, options, expected] of [[403, true, { retryOnExpiredToken: true }, 1], [401, false, { retryOnExpiredToken: true }, 1], [401, true, undefined, 1], [401, true, { retryOnExpiredToken: true }, 2]]) {
    const f = await fixture(t), login = await f.login(); let calls = 0;
    await assert.rejects(f.core().withAccessToken(login.sid, async () => {
      calls++; if (advance) f.clock.value += 61000; throw new AuthBffError(status, status === 401 ? 'SESSION_EXPIRED' : 'ACCESS_DENIED', 'Unit denial');
    }, options), matches(status));
    assert.equal(calls, expected); assert.equal(f.control.refreshes.length, expected - 1);
  }
});

test('cross-second Auth latency does not corrupt a renewable record or silently shift its idle deadline', async t => {
  const f = await fixture(t);
  f.clock.value += 950;
  f.control.loginAdvanceMs = 200;
  const login = await f.login();
  assert.equal((await f.core().inspect(login.sid)).expiresAt, login.session.expiresAt);
  assert.equal((await f.core().renew(login.sid)).session.expiresAt, login.session.expiresAt);
});

test('two tabs/core instances refresh one SID once and receive the same advanced session', async t => {
  const f = await fixture(t), login = await f.login();
  f.clock.value += 61000;
  const results = await Promise.all([f.core().inspect(login.sid), f.core().renew(login.sid), f.core().inspect(login.sid)]);
  assert.equal(f.control.refreshes.length, 1);
  assert.equal(results[0].expiresAt, results[1].session.expiresAt);
  assert.equal(results[0].expiresAt, results[2].expiresAt);
});

test('response loss retries the persisted operation and old refresh credential instead of starting another rotation', async t => {
  const f = await fixture(t), login = await f.login();
  f.clock.value += 61000;
  let lost = false;
  f.control.afterRefresh = () => { lost = true; throw new Error('Sensitive transport details never escape'); };
  await assert.rejects(f.core().inspect(login.sid), matches(503, 'AUTH_UNAVAILABLE'));
  assert.equal(lost, true);
  delete f.control.afterRefresh;
  const result = await f.core().inspect(login.sid);
  assert.equal(result.user.id, employee.id);
  assert.equal(f.control.refreshes.length, 2);
  assert.deepEqual(f.control.refreshes[1], f.control.refreshes[0]);
});

test('a lost refresh response can recover after that response JWT expires without another refresh generation', async t => {
  const f = await fixture(t), login = await f.login();
  f.clock.value += 61000;
  f.control.afterRefresh = () => { throw new Error('Simulated transport loss'); };
  await assert.rejects(f.core().inspect(login.sid), matches(503));
  const alreadyRotated = f.control.latestFamily.current;
  f.clock.value += 5 * 60000;
  delete f.control.afterRefresh;
  const result = await f.core().inspect(login.sid);
  assert.equal(result.user.id, employee.id);
  assert.equal(f.control.latestFamily.current, alreadyRotated);
  assert.deepEqual(f.control.refreshes[0], f.control.refreshes[1]);
});

test('dependency failure keeps encrypted session/pending credential and recovers after access expiry', async t => {
  const f = await fixture(t), login = await f.login();
  f.clock.value += 61000;
  f.control.refreshError = { status: 503, code: 'UNAVAILABLE' };
  await assert.rejects(f.core().inspect(login.sid), matches(503));
  delete f.control.refreshError;
  assert.equal((await f.core().inspect(login.sid)).user.id, employee.id);
});

test('misconfigured BFF client credential is a dependency failure, not an employee logout', async t => {
  const f = await fixture(t), login = await f.login();
  f.clock.value += 61000;
  f.control.clientDenied = true;
  await assert.rejects(f.core().inspect(login.sid), matches(503, 'AUTH_UNAVAILABLE'));
  delete f.control.clientDenied;
  assert.equal((await f.core().inspect(login.sid)).user.id, employee.id);
});

test('refresh denial/locked employee cannot continue to use the long-lived cookie', async t => {
  const f = await fixture(t), login = await f.login();
  f.clock.value += 61000;
  f.control.refreshError = { status: 403, code: 'EMPLOYEE_INACTIVE' };
  await assert.rejects(f.core().inspect(login.sid), matches(403));
  delete f.control.refreshError;
  await assert.rejects(f.core().inspect(login.sid), matches(401));
});

test('idle and absolute session deadlines still expire despite a renewable credential', async t => {
  const idle = await fixture(t, { STAFF_SESSION_IDLE_SECONDS: '60' }), a = await idle.login();
  idle.clock.value += 60001;
  await assert.rejects(idle.core().inspect(a.sid), matches(401));
  const absolute = await fixture(t, { STAFF_SESSION_ABSOLUTE_SECONDS: '120' }), b = await absolute.login();
  absolute.clock.value += 61000;
  assert.equal(Date.parse((await absolute.core().inspect(b.sid)).expiresAt), absolute.clock.value - 61000 + 120000);
  absolute.clock.value += 60000;
  await assert.rejects(absolute.core().inspect(b.sid), matches(401));
});

test('a later configuration cannot loosen an absolute deadline already stored at login', async t => {
  const f = await fixture(t, { STAFF_SESSION_ABSOLUTE_SECONDS: '120' }), login = await f.login();
  const originalDeadline = login.session.expiresAt;
  f.clock.value += 61000;
  const loosened = createStaffAuth({ config: { ...f.config, absoluteAgeSeconds: 0 }, now: () => f.clock.value,
    fetchImpl: async (...args) => {
      // Use the established fixture service through its private core factory.
      return f.fetchImpl(...args);
    } });
  assert.equal((await loosened.inspect(login.sid)).expiresAt, originalDeadline);
});

test('shortening configured idle policy applies to an existing durable session', async t => {
  const f = await fixture(t), login = await f.login();
  f.clock.value += 61000;
  const shorter = createStaffAuth({ config: { ...f.config, idleTimeoutSeconds: 60 }, now: () => f.clock.value, fetchImpl: f.fetchImpl });
  await assert.rejects(shorter.inspect(login.sid), matches(401));
  assert.equal(f.control.refreshes.length, 0);
});

for (const [name, invalid] of [
  ['missing refresh credential', { refreshToken: undefined }],
  ['malformed session deadline', { refreshExpiresAt: 'invalid' }],
  ['noncanonical absolute deadline', { sessionAbsoluteExpiresAt: '2030-01-01' }],
  ['future session creation', { sessionCreatedAt: '2099-01-01T00:00:00.000Z' }],
]) test('renewable login rejects ' + name + ' before publishing a SID', async t => {
  const f = await fixture(t);
  f.control.invalidLoginResponse = invalid;
  await assert.rejects(f.login(), matches(502, 'AUTH_INVALID_RESPONSE'));
  await assert.rejects(readdir(f.config.sessionDir), { code: 'ENOENT' });
});

test('a different Auth identity during refresh cannot replace the employee session', async t => {
  const f = await fixture(t), login = await f.login();
  f.clock.value += 61000;
  f.control.afterRefresh = response => Response.json({ ...response, user: { ...employee, id: '9109101' } });
  await assert.rejects(f.core().inspect(login.sid), matches(502));
  delete f.control.afterRefresh;
  assert.equal((await f.core().inspect(login.sid)).user.id, employee.id);
});

test('encrypted renewable record tampering fails closed without creating a fallback session', async t => {
  const f = await fixture(t), login = await f.login();
  const name = createHash('sha256').update(login.sid).digest('hex') + '.json';
  const file = path.join(f.config.sessionDir, name), record = JSON.parse(await readFile(file, 'utf8'));
  record.data = record.data.slice(1);
  await writeFile(file, JSON.stringify(record), { mode: 0o600 });
  await assert.rejects(f.core().inspect(login.sid), matches(503, 'SESSION_STORE_UNAVAILABLE'));
  assert.equal(f.control.refreshes.length, 0);
});

test('logout revokes Auth family and SID, while a parallel refresh cannot resurrect it', async t => {
  const f = await fixture(t), login = await f.login();
  f.clock.value += 61000;
  const entered = deferred(), gate = deferred();
  f.control.beforeRefresh = async () => { entered.resolve(); await gate.promise; };
  const refreshing = f.core().inspect(login.sid);
  await entered.promise;
  await f.core().logout(login.sid);
  gate.resolve();
  await assert.rejects(refreshing, matches(401));
  await assert.rejects(f.core().inspect(login.sid), matches(401));
  assert.equal(f.control.latestFamily.revoked, true);
});

test('logout during Auth outage durably invalidates SID and queues only encrypted upstream revocation', async t => {
  const f = await fixture(t), login = await f.login();
  f.control.logoutError = true;
  assert.deepEqual(await f.core().logout(login.sid), { authRevocationPending: true });
  await assert.rejects(f.core().inspect(login.sid), matches(401));
  const queued = await readdir(path.join(f.config.sessionDir, 'revocations'));
  assert.equal(queued.length, 1);
  const raw = await readFile(path.join(f.config.sessionDir, 'revocations', queued[0]), 'utf8');
  assert.equal(raw.includes(f.control.latestFamily.current), false);
  delete f.control.logoutError;
  const next = await f.login();
  assert.equal((await readdir(path.join(f.config.sessionDir, 'revocations'))).length, 0);
  assert.equal(next.session.user.id, employee.id);
});

test('tombstones and encrypted records survive server-instance restart; foreign data is not removed', async t => {
  const f = await fixture(t), login = await f.login();
  await f.core().logout(login.sid);
  const name = createHash('sha256').update(login.sid).digest('hex') + '.json.revoked';
  assert.ok((await readFile(path.join(f.config.sessionDir, name), 'utf8')).includes('revokedAt'));
  await assert.rejects(f.core().inspect(login.sid), matches(401));
  const foreign = path.join(f.config.sessionDir, 'owner-backup.txt');
  await writeFile(foreign, 'unit foreign file');
  await f.login();
  assert.equal(await readFile(foreign, 'utf8'), 'unit foreign file');
});

test('renewal cannot be enabled for a legacy session by silently inventing a refresh token', async t => {
  const f = await fixture(t);
  const disabled = createStaffAuth({ config: { ...f.config, renewalEnabled: false }, now: () => f.clock.value, fetchImpl: f.fetchImpl });
  await assert.rejects(disabled.renew(random()), matches(503, 'RENEWAL_DISABLED'));
  f.control.acceptLegacy = true;
  const login = await disabled.login({ phone: 'TEST-EMPLOYEE-UC9', password: f.testPassword });
  assert.equal(Object.hasOwn((await f.core().inspect(login.sid)), 'renewable'), false);
  f.clock.value += 61000;
  await assert.rejects(f.core().inspect(login.sid), matches(401));
  assert.equal(f.control.refreshes.length, 0);
});
