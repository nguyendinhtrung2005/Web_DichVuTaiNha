import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStaffAuthHttp } from '../lib/server/auth-http.mjs';
import { loadStaffAuthConfig } from '../lib/server/config.mjs';

// Live Auth integration through a TEST-OWNED native HTTP bridge around the exact
// BFF handler/core. This suite does not claim to be Next.js/browser E2E coverage.
// Every JWT is issued/verified by real Auth; no JWT fixture or middleware double.
const enabled = process.env.RUN_STAFF_BFF_LIFECYCLE_TESTS === 'true';
const options = { skip: !enabled, timeout: 30000 };
const check = (condition, message) => assert.equal(Boolean(condition), true, message);

async function jsonRequest(url, init = {}) {
  try {
    const response = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(10000) });
    const raw = await response.text();
    check(Buffer.byteLength(raw) <= 16384, 'HTTP response exceeds the integration-test limit');
    let body;
    try { body = JSON.parse(raw); } catch { throw new Error('INTEGRATION_RESPONSE_NOT_JSON'); }
    // Never include actual body, credentials, token or cookies in assertions/logs.
    check(!raw.includes('"accessToken"') && !raw.includes('"password"'), 'Sensitive field appeared in a browser-facing response');
    return { status: response.status, headers: response.headers, body };
  } catch (error) {
    if (error?.code === 'ERR_ASSERTION' || error?.message === 'INTEGRATION_RESPONSE_NOT_JSON') throw error;
    throw new Error('INTEGRATION_HTTP_REQUEST_FAILED');
  }
}

async function preflight() {
  const phone = process.env.STAFF_BFF_TEST_PHONE_A;
  const password = process.env.STAFF_BFF_TEST_PASSWORD_A;
  check(typeof phone === 'string' && phone.trim().length > 0, 'STAFF_BFF_TEST_PHONE_A is required when the suite is enabled');
  check(typeof password === 'string' && password.length > 0, 'STAFF_BFF_TEST_PASSWORD_A is required when the suite is enabled');
  let authUrl;
  try {
    const configured = new URL(process.env.AUTH_SERVICE_URL || 'http://127.0.0.1:4001');
    check(['http:', 'https:'].includes(configured.protocol) && !configured.username && !configured.password
      && configured.pathname === '/' && !configured.search && !configured.hash, 'Auth URL must be a fixed origin');
    authUrl = configured.origin;
  } catch { throw new Error('AUTH_SERVICE_URL_INVALID'); }
  for (const [route, status] of [['/health/live', 'ok'], ['/health/ready', 'ready']]) {
    const result = await jsonRequest(authUrl + route);
    check(result.status === 200 && result.body?.service === 'auth-service' && result.body?.status === status,
      'Real Auth Service must be healthy before creating test-owned session files');
  }
  return { phone, password, authUrl };
}

async function closeServer(server) {
  if (!server?.listening) return;
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}

async function unusedClosedPort() {
  const probe = createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await closeServer(probe);
  return `http://127.0.0.1:${port}`;
}

async function fixture(t, { maxAge = 900, blockedStorage = false } = {}) {
  const input = await preflight();
  const tmpRoot = path.resolve(os.tmpdir());
  const root = await mkdtemp(path.join(tmpRoot, 'cleanhome-staff-bff-life-'));
  const sessions = path.join(root, 'sessions');
  const keyFile = path.join(root, 'session.key');
  const control = { authUrl: input.authUrl, origin: undefined, server: undefined };
  await writeFile(keyFile, randomBytes(32), { mode: 0o600 });
  if (blockedStorage) await writeFile(sessions, 'test-owned blocked directory', { mode: 0o600 });

  t.after(async () => {
    await closeServer(control.server);
    const resolved = path.resolve(root);
    check(resolved.startsWith(tmpRoot + path.sep) && /^cleanhome-staff-bff-life-[^\\/]+$/.test(path.basename(resolved)),
      'Refusing cleanup outside the exclusive test-owned temporary directory');
    await rm(resolved, { recursive: true, force: true });
  });

  async function start() {
    const handle = createStaffAuthHttp({ configFactory: () => loadStaffAuthConfig({
      NODE_ENV: 'test', AUTH_SERVICE_URL: control.authUrl, STAFF_APP_ORIGIN: control.origin,
      STAFF_SESSION_DIR: sessions, STAFF_SESSION_KEY_FILE: keyFile,
      STAFF_SESSION_MAX_AGE_SECONDS: String(maxAge), STAFF_AUTH_TIMEOUT_MS: '1500',
    }, root) });
    const server = createServer(async (req, res) => {
      try {
        const chunks = [];
        let length = 0;
        for await (const chunk of req) {
          length += chunk.length;
          if (length > 8192) throw new Error('BRIDGE_REQUEST_TOO_LARGE');
          chunks.push(chunk);
        }
        const headers = new Headers();
        for (let i = 0; i < req.rawHeaders.length; i += 2) headers.append(req.rawHeaders[i], req.rawHeaders[i + 1]);
        const request = new Request(control.origin + req.url, { method: req.method, headers,
          ...(!['GET', 'HEAD'].includes(req.method) ? { body: Buffer.concat(chunks) } : {}) });
        const match = /^\/api\/auth\/(login|session|logout)$/.exec(req.url);
        const response = await handle(request, match?.[1] || 'unknown');
        res.statusCode = response.status;
        response.headers.forEach((value, name) => res.setHeader(name, value));
        res.end(Buffer.from(await response.arrayBuffer()));
      } catch {
        if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end('{"error":{"code":"TEST_HTTP_BRIDGE_FAILURE"}}');
      }
    });
    server.requestTimeout = 10000;
    server.headersTimeout = 5000;
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    control.server = server;
    control.origin = `http://127.0.0.1:${server.address().port}`;
  }

  await start();
  const request = (action, cookie) => jsonRequest(control.origin + '/api/auth/' + action, {
    method: action === 'session' ? 'GET' : 'POST',
    headers: { Origin: control.origin, ...(cookie ? { Cookie: cookie } : {}),
      ...(action !== 'session' ? { 'Content-Type': 'application/json' } : {}) },
    ...(action !== 'session' ? { body: JSON.stringify(action === 'login'
      ? { phone: input.phone, password: input.password } : {}) } : {}),
  });
  return { control, root, sessions, input, request,
    async restart() { await closeServer(control.server); await start(); },
    async disconnectAuth() { control.authUrl = await unusedClosedPort(); },
    restoreAuth() { control.authUrl = input.authUrl; },
  };
}

function successfulLogin(result) {
  check(result.status === 200 && result.body?.session?.user?.role === 'EMPLOYEE'
    && result.body?.session?.user?.status === 'ACTIVE', 'Real Auth login must produce an active employee session');
  const header = result.headers.get('set-cookie') || '';
  check(/^cleanhome_staff_session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=[1-9]\d*$/.test(header),
    'Test HTTP login must set the expected opaque host-only development session cookie');
  return header.split(';', 1)[0];
}

test('real Auth lifecycle: short server session expires without forging or changing JWT', options, async t => {
  const f = await fixture(t, { maxAge: 3 });
  const loggedIn = await f.request('login');
  const cookie = successfulLogin(loggedIn);
  check((await f.request('session', cookie)).status === 200, 'New session must initially be valid');
  const delay = Date.parse(loggedIn.body.session.expiresAt) - Date.now() + 100;
  check(Number.isFinite(delay) && delay >= 0 && delay <= 3500, 'Expiry wait must remain bounded by 3.5 seconds');
  await new Promise(resolve => setTimeout(resolve, delay));
  const expired = await f.request('session', cookie);
  check(expired.status === 401 && expired.body?.error?.code === 'SESSION_EXPIRED', 'Expired session must require authentication');
  check((expired.headers.get('set-cookie') || '').endsWith('Max-Age=0'), 'Expired session must clear only its Staff cookie');
  check((await readdir(f.sessions)).length === 0, 'Expired encrypted session must be removed');
});

test('real Auth lifecycle: HTTP handler restart preserves the encrypted durable session', options, async t => {
  const f = await fixture(t);
  const cookie = successfulLogin(await f.request('login'));
  const before = await readdir(f.sessions);
  check(before.length === 1, 'One encrypted session must be persisted');
  const encrypted = await readFile(path.join(f.sessions, before[0]), 'utf8');
  check(!encrypted.includes('accessToken') && !encrypted.includes(cookie.split('=', 2)[1]), 'Persistent envelope must not contain plaintext browser credentials');
  await f.restart();
  const session = await f.request('session', cookie);
  check(session.status === 200 && session.body?.session?.user?.role === 'EMPLOYEE', 'Restarted handler must validate the original stored token with real Auth');
  check(!session.headers.has('set-cookie'), 'Session read must not renew credentials');
});

test('real Auth lifecycle: upstream refusal fails closed, keeps session and recovers', options, async t => {
  const f = await fixture(t);
  const cookie = successfulLogin(await f.request('login'));
  await f.disconnectAuth();
  const unavailable = await f.request('session', cookie);
  check(unavailable.status === 503 && unavailable.body?.error?.code === 'AUTH_UNAVAILABLE', 'Connection refusal must remain a dependency error');
  check(!unavailable.headers.has('set-cookie'), 'Dependency failure must not replace or clear the session cookie');
  check((await readdir(f.sessions)).length === 1, 'Dependency failure must preserve the encrypted session');
  f.restoreAuth();
  check((await f.request('session', cookie)).status === 200, 'Restored real Auth must validate the same session');
});

test('real Auth lifecycle: login with unavailable upstream never issues a cookie', options, async t => {
  const f = await fixture(t);
  await f.disconnectAuth();
  const result = await f.request('login');
  check(result.status === 503 && result.body?.error?.code === 'AUTH_UNAVAILABLE', 'Unavailable Auth must reject login');
  check(!result.headers.has('set-cookie'), 'Failed login must not issue a cookie');
});

test('real Auth lifecycle: valid backend login cannot succeed when session storage is blocked', options, async t => {
  const f = await fixture(t, { blockedStorage: true });
  const result = await f.request('login');
  check(result.status === 503 && result.body?.error?.code === 'SESSION_STORE_UNAVAILABLE', 'Storage failure must reject the real Auth login result');
  check(!result.headers.has('set-cookie'), 'Storage failure must not issue a cookie');
  check((await readFile(f.sessions, 'utf8')) === 'test-owned blocked directory', 'Failed persistence must preserve the test-owned blocking file');
});

test('real Auth lifecycle: logout works during dependency outage and persists revocation', options, async t => {
  const f = await fixture(t);
  const cookie = successfulLogin(await f.request('login'));
  await f.disconnectAuth();
  const result = await f.request('logout', cookie);
  check(result.status === 200 && result.body?.ok === true, 'Frontend logout must not require an unavailable Auth logout endpoint');
  check((result.headers.get('set-cookie') || '').endsWith('Max-Age=0'), 'Logout must clear the Staff cookie');
  check((await readdir(f.sessions)).length === 0, 'Logout must revoke the persistent server session');
  f.restoreAuth();
  const next = await f.request('session', cookie);
  check(next.status === 401 && next.body?.error?.code === 'SESSION_EXPIRED', 'Revoked SID must stay invalid when real Auth returns');
});
