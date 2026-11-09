import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp as createOrderApp } from '../order-service/src/app.js';
import { createSigningKeys, issueToken } from '../shared/auth-tokens.js';
import { closeServer, listen } from '../shared/http.js';

test('Admin service-order report enforces Admin role and Admin origin over HTTP', async (t) => {
  const config = {
    allowedOrigins: ['http://localhost:3001', 'http://localhost:3002', 'http://localhost:3003'],
    origins: { customer: 'http://localhost:3001', staff: 'http://localhost:3002', admin: 'http://localhost:3003' },
    tokens: { order: 'o'.repeat(40) }, urls: { auth: 'http://auth.internal' },
    issuer: 'cleanhome-auth', audience: 'cleanhome-customer', cookieName: 'cleanhome_customer_session',
    secureCookies: false, sessionTtl: 3600, production: false,
  };
  const keys = createSigningKeys(config);
  const now = Math.floor(Date.now() / 1000);
  const adminToken = issueToken(keys, config, '10', randomUUID(), now, 'ADMIN');
  const employeeToken = issueToken(keys, config, '9', randomUUID(), now, 'EMPLOYEE');
  const previousFetch = globalThis.fetch;
  const roles = new Map([[adminToken, ['10', 'ADMIN']], [employeeToken, ['9', 'EMPLOYEE']]]);
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith(config.urls.auth) && String(url).endsWith('/api/v1/auth/jwks')) {
      return Response.json({ data: keys.jwks });
    }
    if (String(url).startsWith(config.urls.auth) && String(url).endsWith('/internal/v1/introspect')) {
      const [sub, role] = roles.get(JSON.parse(init.body).token) ?? [];
      return Response.json({ data: { sub, role } });
    }
    return previousFetch(url, init);
  };
  let reportReads = 0;
  const repository = {
    async serviceOrderReport(filters) {
      reportReads += 1;
      return {
        from: filters.from, to: filters.to, generatedAt: '2026-11-09T00:00:00.000Z',
        total: 0, statusCounts: { pending: 0, confirmed: 0, in_progress: 0, completed: 0, cancelled: 0 },
      };
    },
  };
  const server = await listen(createOrderApp({ repository, config }), 0);
  t.after(async () => { globalThis.fetch = previousFetch; await closeServer(server); });
  const url = `http://127.0.0.1:${server.address().port}/api/v1/admin/reports/service-orders`;
  const call = (token, origin, query = '') => previousFetch(`${url}${query}`, {
    headers: { origin, cookie: `cleanhome_customer_session=${token}` },
  });

  const staff = await call(employeeToken, 'http://localhost:3003');
  assert.equal(staff.status, 403);
  const wrongOrigin = await call(adminToken, 'http://localhost:3002');
  assert.equal(wrongOrigin.status, 403);
  assert.equal(wrongOrigin.headers.get('Access-Control-Allow-Origin'), null);
  const deniedPreflight = await previousFetch(url, {
    method: 'OPTIONS',
    headers: { origin: 'http://localhost:3002', 'access-control-request-method': 'GET' },
  });
  assert.equal(deniedPreflight.status, 403);
  assert.equal(deniedPreflight.headers.get('Access-Control-Allow-Origin'), null);
  const allowedPreflight = await previousFetch(url, {
    method: 'OPTIONS',
    headers: { origin: 'http://localhost:3003', 'access-control-request-method': 'GET' },
  });
  assert.equal(allowedPreflight.status, 204);
  assert.equal(allowedPreflight.headers.get('Access-Control-Allow-Origin'), 'http://localhost:3003');
  const invalidDate = await call(adminToken, 'http://localhost:3003', '?from=2026-02-31');
  assert.equal(invalidDate.status, 400);
  const allowed = await call(adminToken, 'http://localhost:3003', '?from=2026-11-08&to=2026-11-09');
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get('Access-Control-Allow-Origin'), 'http://localhost:3003');
  assert.equal((await allowed.json()).data.total, 0);
  assert.equal(reportReads, 1);
});
