import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp as createOrderApp } from '../order-service/src/app.js';
import { createRepository as createOrderRepository } from '../order-service/src/repository.js';
import { createApp as createStaffApp } from '../staff-service/src/app.js';
import { createRepository as createStaffRepository } from '../staff-service/src/repository.js';
import { createSigningKeys, issueToken } from '../shared/auth-tokens.js';
import { closeServer, HttpError, listen } from '../shared/http.js';
import { randomUUID } from 'node:crypto';

const staffToken = 's'.repeat(40);
const orderToken = 'o'.repeat(40);

test('Staff ownership lookup is scoped to the authenticated user and excludes inactive/cancelled assignments', async () => {
  const calls = [];
  const repository = createStaffRepository({
    async execute(sql, values) {
      calls.push({ sql, values });
      return [[{ id: '18', bookingId: '51', employeeId: '7', userId: '9', status: 'ASSIGNED' }]];
    },
  });
  const result = await repository.assignmentForUser('9', '51');
  assert.equal(result.userId, '9');
  assert.equal(result.employeeId, '7');
  assert.equal(result.jobStatus, 'waiting');
  assert.deepEqual(calls[0].values, ['9', '51']);
  assert.match(calls[0].sql, /e\.user_id = \?/);
  assert.match(calls[0].sql, /e\.status = 'ACTIVE'/);
  assert.match(calls[0].sql, /a\.status NOT IN \('CANCELLED', 'REJECTED'\)/);
});

test('Staff public job API requires an EMPLOYEE session and uses its principal for Order queries', async (t) => {
  const config = {
    allowedOrigins: ['http://localhost:3001', 'http://localhost:3002', 'http://localhost:3003'],
    origins: { staff: 'http://localhost:3002', admin: 'http://localhost:3003', customer: 'http://localhost:3001' },
    tokens: { staff: staffToken },
    urls: { auth: 'http://auth.internal', order: 'http://order.internal' },
    issuer: 'cleanhome-auth', audience: 'cleanhome-customer', cookieName: 'cleanhome_customer_session',
    secureCookies: false, sessionTtl: 3600, production: false,
  };
  const keys = createSigningKeys(config);
  const now = Math.floor(Date.now() / 1000);
  const employeeToken = issueToken(keys, config, '9', randomUUID(), now, 'EMPLOYEE');
  const adminToken = issueToken(keys, config, '10', randomUUID(), now, 'ADMIN');
  const previousFetch = globalThis.fetch;
  const orderRequests = [];
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    if (target.startsWith(config.urls.auth) && target.endsWith('/api/v1/auth/jwks')) return Response.json({ data: keys.jwks });
    if (target.startsWith(config.urls.auth) && target.endsWith('/internal/v1/introspect')) {
      const token = JSON.parse(init.body).token;
      return Response.json({ data: { sub: token === employeeToken ? '9' : '10', role: token === employeeToken ? 'EMPLOYEE' : 'ADMIN' } });
    }
    if (target.startsWith(config.urls.order)) {
      orderRequests.push({ url: target, headers: init.headers });
      return Response.json({ data: { items: [], total: 0, page: 1, pageSize: 8 } });
    }
    throw new Error('Unexpected HTTP dependency');
  };
  const app = createStaffApp({ repository: {}, config });
  const server = await listen(app, 0);
  t.after(async () => { globalThis.fetch = previousFetch; await closeServer(server); });
  const address = server.address();
  const request = (token) => previousFetch(`http://127.0.0.1:${address.port}/api/v1/staff/jobs?page=1&pageSize=8`, {
    headers: { origin: 'http://localhost:3002', cookie: `cleanhome_customer_session=${token}` },
  });
  const denied = await request(adminToken);
  assert.equal(denied.status, 403);
  assert.equal(orderRequests.length, 0);
  const allowed = await request(employeeToken);
  assert.equal(allowed.status, 200);
  assert.deepEqual((await allowed.json()).data, { items: [], total: 0, page: 1, pageSize: 8 });
  assert.equal(orderRequests.length, 1);
  assert.match(orderRequests[0].url, /\/internal\/v1\/staff\/users\/9\/jobs\?/);
  assert.equal(orderRequests[0].headers['X-Internal-Caller'], 'staff');
  assert.equal(orderRequests[0].headers['X-Internal-Token'], staffToken);
});

test('Staff status mutations fail closed without migration 005 before opening a write transaction', async () => {
  let writeConnections = 0;
  const repository = createStaffRepository({
    async execute(sql) {
      if (sql.includes('information_schema.columns')) return [[{ present: 0 }]];
      if (sql.includes('information_schema.statistics')) return [[]];
      throw new Error('Unexpected schema query');
    },
    async getConnection() { writeConnections += 1; throw new Error('must not write'); },
  });
  await assert.rejects(repository.prepareTransition('9', '51', '00f763a3-4ba7-4e56-a959-3ddcb6a6c042', 'accepted'),
    (error) => error instanceof HttpError && error.status === 503 && error.code === 'STAFF_TRANSITION_SCHEMA_NOT_READY');
  assert.equal(writeConnections, 0);
});

test('Order Staff job endpoint validates the internal caller and omits payment/customer-private fields', async (t) => {
  const previousFetch = globalThis.fetch;
  let dependencyRequest;
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith('http://staff.internal/')) {
      dependencyRequest = { url: String(url), headers: init.headers };
      return Response.json({ data: { employeeId: '7' } });
    }
    return previousFetch(url, init);
  };
  const repository = {
    async listStaffJobs(employeeId, filters) {
      assert.equal(employeeId, '7');
      assert.deepEqual(filters, {
        fromUtc: '2026-11-07 17:00:00', toUtc: '2026-11-08 17:00:00',
        status: 'waiting', page: 2, pageSize: 8, q: '', sort: 'schedule-asc',
      });
      return {
        total: 1, page: 2, pageSize: 8,
        items: [{
          id: '51', code: 'DH000051', customerId: '99', serviceId: '3', serviceName: 'Dịch vụ',
          unit: 'giờ', quantity: 2, price: 999, status: 'confirmed', jobStatus: 'waiting',
          contact: { name: 'Khách', phone: '0900000000', address: 'Địa chỉ', houseType: 'can-ho', hasPets: true },
          scheduledAt: '2026-11-10T02:00:00.000Z', durationMinutes: 120, specialRequest: 'Ghi chú khách',
          cancelRequest: { status: 'pending', reason: 'reason', requestedAt: '2026-11-01T00:00:00.000Z' },
          history: [{ at: '2026-11-01T00:00:00.000Z', label: 'Đã xác nhận', by: 'Tài khoản 99', note: 'private' }],
          createdAt: '2026-11-01T00:00:00.000Z',
        }],
      };
    },
  };
  const config = {
    allowedOrigins: ['http://localhost:3002'],
    origins: { staff: 'http://localhost:3002', admin: 'http://localhost:3003', customer: 'http://localhost:3001' },
    tokens: { staff: staffToken, order: orderToken },
    urls: { staff: 'http://staff.internal' },
  };
  const server = await listen(createOrderApp({ repository, config }), 0);
  t.after(async () => { globalThis.fetch = previousFetch; await closeServer(server); });
  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/internal/v1/staff/users/9/jobs?from=2026-11-08&to=2026-11-08&status=waiting&page=2&pageSize=8`);
  const denied = await fetch(`http://127.0.0.1:${address.port}/internal/v1/staff/users/9/jobs`, {
    headers: { 'x-internal-caller': 'gateway', 'x-internal-token': orderToken },
  });
  assert.equal(response.status, 403);
  assert.equal(denied.status, 403);

  const authorized = await fetch(`http://127.0.0.1:${address.port}/internal/v1/staff/users/9/jobs?from=2026-11-08&to=2026-11-08&status=waiting&page=2&pageSize=8`, {
    headers: { 'x-internal-caller': 'staff', 'x-internal-token': staffToken },
  });
  assert.equal(authorized.status, 200);
  const payload = (await authorized.json()).data;
  const job = payload.items[0];
  assert.equal(job.orderStatus, 'confirmed');
  assert.equal(job.jobStatus, 'waiting');
  assert.equal(job.cancelPending, true);
  assert.deepEqual(Object.keys(job.contact).sort(), ['address', 'name', 'phone']);
  assert.equal('price' in job, false);
  assert.equal('customerId' in job, false);
  assert.equal('staffId' in job, false);
  assert.equal('note' in job.history[0], false);
  assert.equal(dependencyRequest.headers['X-Internal-Caller'], 'order');
  assert.equal(dependencyRequest.headers['X-Internal-Token'], orderToken);
});

test('Order refuses to begin a Staff assignment while cancellation is pending and rolls back', async () => {
  const calls = [];
  const connection = {
    async beginTransaction() {},
    async commit() { throw new Error('should not commit'); },
    async rollback() { calls.push('rollback'); },
    release() {},
    async execute(sql, values) {
      calls.push({ sql, values });
      if (sql.includes('FROM staff_assignment_transition_operations')) return [[{
        assignmentId: '18', employeeId: '7', bookingId: '51', fromStatus: 'ACCEPTED',
        toStatus: 'IN_PROGRESS', phase: 'PENDING', resultSnapshot: null,
      }]];
      if (sql.includes('FROM bookings WHERE id')) return [[{ id: '51', status: 'CONFIRMED' }]];
      if (sql.includes('FROM employees WHERE id')) return [[{ user_id: '9' }]];
      if (sql.includes('FROM assignments') && sql.includes('WHERE id = ?')) return [[{ status: 'ACCEPTED' }]];
      if (sql.includes('FROM booking_status_history')) return [[{
        note: JSON.stringify({ version: 1, type: 'CUSTOMER_CANCEL_REQUESTED', reason: 'schedule conflict' }),
      }]];
      throw new Error('Unexpected query');
    },
  };
  const repository = createOrderRepository({ async getConnection() { return connection; } });
  await assert.rejects(repository.applyStaffTransition({
    operationId: '00f763a3-4ba7-4e56-a959-3ddcb6a6c042', assignmentId: '18',
    employeeId: '7', bookingId: '51', nextStatus: 'in_progress',
  }), (error) => error instanceof HttpError && error.status === 409 && error.code === 'CANCELLATION_PENDING');
  assert.deepEqual(calls.at(-1), 'rollback');
  assert.equal(calls.some((call) => typeof call === 'object' && /UPDATE bookings|INSERT INTO booking_status_history/.test(call.sql)), false);
});

test('Completing one assignment does not complete the service order while another required assignment is active', async () => {
  const calls = [];
  let committed = false;
  const connection = {
    async beginTransaction() {},
    async commit() { committed = true; },
    async rollback() { throw new Error('should not rollback'); },
    release() {},
    async execute(sql, values) {
      calls.push({ sql, values });
      if (sql.includes('FROM staff_assignment_transition_operations')) return [[{
        assignmentId: '18', employeeId: '7', bookingId: '51', fromStatus: 'IN_PROGRESS',
        toStatus: 'COMPLETED', phase: 'PENDING', resultSnapshot: null,
      }]];
      if (sql.includes('FROM bookings WHERE id')) return [[{ id: '51', status: 'IN_PROGRESS' }]];
      if (sql.includes('FROM employees WHERE id')) return [[{ user_id: '9' }]];
      if (sql.includes('FROM assignments') && sql.includes('WHERE id = ?')) return [[{ status: 'IN_PROGRESS' }]];
      if (sql.includes('FROM booking_status_history')) return [[]];
      if (sql.includes('COUNT(*) AS total FROM assignments')) return [[{ total: 1 }]];
      if (sql.includes('UPDATE staff_assignment_transition_operations')) return [{ affectedRows: 1 }];
      throw new Error('Unexpected query');
    },
  };
  const repository = createOrderRepository({ async getConnection() { return connection; } });
  const result = await repository.applyStaffTransition({
    operationId: '00f763a3-4ba7-4e56-a959-3ddcb6a6c042', assignmentId: '18',
    employeeId: '7', bookingId: '51', nextStatus: 'done',
  });
  assert.deepEqual(result, { bookingId: '51', orderStatus: 'in_progress' });
  assert.equal(committed, true);
  assert.equal(calls.some((call) => /UPDATE bookings|INSERT INTO booking_status_history/.test(call.sql)), false);
  assert.ok(calls.some((call) => call.sql.includes('UPDATE staff_assignment_transition_operations')));
});
