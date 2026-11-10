import test from 'node:test';
import assert from 'node:assert/strict';
import { createRepository as createOrderRepository, bookingRequestHash } from '../order-service/src/repository.js';
import { createRepository as createPaymentRepository } from '../payment-service/src/repository.js';
import { createRepository as createCatalogRepository } from '../service-service/src/repository.js';
import { createRepository as createReviewRepository } from '../review-service/src/repository.js';
import { checkCustomerBookingIdempotencySchema } from '../shared/database-checks.js';
import { createApp as createOrderApp } from '../order-service/src/app.js';
import { createSigningKeys, issueToken } from '../shared/auth-tokens.js';
import { createConfig } from '../shared/config.js';
import { closeServer, createHttpApp, HttpError, listen, reply } from '../shared/http.js';

const service = { id: '1', name: 'Synthetic test service', unit: 'giờ', price: 125000, minQuantity: 1, baseMinutes: 0, minutesPerUnit: 120, status: 'active' };
function input() {
  return {
    serviceId: '1', quantity: 1, expectedUnitPrice: 125000,
    contact: { name: 'Synthetic customer', phone: '0391234567', address: 'Synthetic test address', houseType: 'can-ho', hasPets: false },
    scheduledAt: new Date(new Date(Date.now() + 86400000).setUTCHours(2, 0, 0, 0)).toISOString(), specialRequest: '',
  };
}

test('Order repository rolls back the entire booking on an item insert failure (mock connection)', async () => {
  const failure = new Error('synthetic database failure');
  const calls = [];
  const actions = { begin: 0, commit: 0, rollback: 0, release: 0 };
  const connection = {
    async beginTransaction() { actions.begin += 1; },
    async commit() { actions.commit += 1; },
    async rollback() { actions.rollback += 1; },
    release() { actions.release += 1; },
    async execute(sql, parameters) {
      calls.push({ sql, parameters });
      if (sql.includes('service_auto_assignment_config')) return [[]];
      if (sql.includes('INSERT INTO bookings')) return [{ insertId: '101' }];
      if (sql.includes('INSERT INTO booking_items')) throw failure;
      throw new Error('Unexpected query in fault-injection test');
    },
  };
  const repository = createOrderRepository({
    async execute(sql) {
      if (sql.includes('information_schema.tables')) return [[{ present: 5 }]];
      if (sql.includes('information_schema.columns')) return [[{ present: 4 }]];
      throw new Error('Unexpected schema query');
    },
    async getConnection() { return connection; },
  });
  const payload = { ...input(), specialRequest: "'); DROP TABLE users; --" };
  await assert.rejects(repository.create('1', payload, service, '1'), (error) => error === failure);
  assert.deepEqual(actions, { begin: 1, commit: 0, rollback: 1, release: 1 });
  assert.equal(calls.length, 3);
  assert.ok(!calls[1].sql.includes(payload.specialRequest));
  assert.equal(JSON.parse(calls[1].parameters[2]).specialRequest, payload.specialRequest);
});

test('Order amount and TIMESTAMP overflow are rejected before acquiring a write connection', async () => {
  let acquired = 0;
  const repository = createOrderRepository({ async getConnection() { acquired += 1; throw new Error('must not connect'); } });
  await assert.rejects(repository.create('1', { ...input(), quantity: 100000 }, { ...service, price: 9999999999.99 }, '1'),
    (error) => error instanceof HttpError && error.status === 422 && error.code === 'ORDER_LIMIT_EXCEEDED');
  await assert.rejects(repository.create('1', { ...input(), scheduledAt: '2038-01-19T03:00:00.000Z' }, service, '1'),
    (error) => error instanceof HttpError && error.status === 422 && error.code === 'SCHEDULE_OUT_OF_RANGE');
  assert.equal(acquired, 0);
});

test('Customer booking retries fail closed until the request-key migration is complete', async () => {
  let connectionRequested = false;
  const repository = createOrderRepository({
    async execute(sql) {
      if (sql.includes('information_schema.columns')) return [[{ present: 2 }]];
      if (sql.includes('information_schema.statistics')) return [[{ present: 0 }]];
      if (sql.includes('information_schema.check_constraints')) return [[{ checkClause: '((customer_request_key IS NULL AND customer_request_hash IS NULL) OR (customer_request_key IS NOT NULL AND customer_request_hash IS NOT NULL))' }]];
      throw new Error('Unexpected schema query');
    },
    async getConnection() { connectionRequested = true; throw new Error('must not write'); },
  });
  await assert.rejects(
    repository.create('1', { ...input(), requestKey: '7ac2b220-95c7-4a2d-b184-322b1f76d9b8' }, service, '1'),
    (error) => error instanceof HttpError && error.status === 503 && error.code === 'BOOKING_IDEMPOTENCY_SCHEMA_NOT_READY',
  );
  assert.equal(connectionRequested, false);
});

test('Customer database readiness requires request columns, the exact unique index and matching check constraint', async () => {
  const valid = await checkCustomerBookingIdempotencySchema({
    async execute(sql) {
      if (sql.includes('information_schema.columns')) return [[{ present: '2' }]];
      if (sql.includes('information_schema.statistics')) {
        assert.match(sql, /non_unique AS nonUnique/);
        return [[{ indexName: 'uq_booking_customer_request', nonUnique: 0, columnsInOrder: 'customer_id,customer_request_key' }]];
      }
      return [[{ checkClause: '((customer_request_key IS NULL AND customer_request_hash IS NULL) OR (customer_request_key IS NOT NULL AND customer_request_hash IS NOT NULL))' }]];
    },
  });
  const invalid = await checkCustomerBookingIdempotencySchema({
    async execute(sql) {
      if (sql.includes('information_schema.columns')) return [[{ present: '2' }]];
      if (sql.includes('information_schema.statistics')) return [[{ indexName: 'uq_booking_customer_request', nonUnique: 0, columnsInOrder: 'customer_id,customer_request_key,created_at' }]];
      return [[{ checkClause: 'customer_request_key IS NULL OR customer_request_hash IS NULL' }]];
    },
  });
  assert.equal(valid, true);
  assert.equal(invalid, false);
  const invalidConstraint = await checkCustomerBookingIdempotencySchema({
    async execute(sql) {
      if (sql.includes('information_schema.columns')) return [[{ present: '2' }]];
      if (sql.includes('information_schema.statistics')) return [[{ indexName: 'uq_booking_customer_request', nonUnique: 0, columnsInOrder: 'customer_id,customer_request_key' }]];
      return [[{ checkClause: 'customer_request_key IS NULL OR customer_request_hash IS NULL' }]];
    },
  });
  assert.equal(invalidConstraint, false);
});

test('Payment simulation never overwrites paid or independent provider payments (mock transaction)', async (t) => {
  for (const existing of [
    [{ id: '1', booking_id: '4', method: 'TRANSFER', amount: '125000', provider_ref: 'CUSTOMER_SIM_V1:4', status: 'PAID' }],
    [
      { id: '1', booking_id: '4', method: 'TRANSFER', amount: '125000', provider_ref: 'provider-real-reference', status: 'PENDING' },
      { id: '2', booking_id: '4', method: 'TRANSFER', amount: '125000', provider_ref: 'CUSTOMER_SIM_V1:4', status: 'PENDING' },
    ],
  ]) {
    await t.test(existing[0].status === 'PAID' ? 'confirmed payment is preserved' : 'other provider reference is preserved', async () => {
      const calls = [];
      let rolledBack = 0, committed = 0, released = 0;
      const repository = createPaymentRepository({ async getConnection() { return {
        async beginTransaction() {},
        async commit() { committed += 1; },
        async rollback() { rolledBack += 1; },
        release() { released += 1; },
        async execute(sql, values) {
          calls.push({ sql, values });
          return sql.startsWith('SELECT') ? [existing] : [{ insertId: '2' }];
        },
      }; } });
      await assert.rejects(repository.simulate({ id: '4', price: 125000, status: 'confirmed' }, 'transfer'),
        (error) => error instanceof HttpError && error.status === 409);
      assert.equal(rolledBack, 1); assert.equal(committed, 0); assert.equal(released, 1);
      assert.ok(!calls.some(({ sql }) => sql.startsWith('UPDATE')));
      assert.ok(calls[0].sql.includes('ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)'));
    });
  }
});

test('Catalog search binds user text and escapes LIKE wildcards (mock pool)', async () => {
  const calls = [];
  const repository = createCatalogRepository({
    async execute(sql, values) {
      calls.push({ sql, values });
      return sql.includes('information_schema.columns') ? [[{ present: 0 }]] : [[{ total: 0 }]];
    },
    async query(sql, values) { calls.push({ sql, values }); return [[]]; },
  });
  const query = "x%' OR 1=1 --!";
  const result = await repository.list({ q: query, category: '1', page: 2, limit: 10 });
  assert.deepEqual(result, { items: [], total: 0, page: 2, limit: 10 });
  assert.ok(calls.every(({ sql }) => !sql.includes(query)));
  const searchCall = calls.find(({ sql }) => sql.startsWith('SELECT COUNT(*) AS total'));
  const pageCall = calls.find(({ sql }) => sql.includes('LIMIT ? OFFSET ?'));
  assert.equal(searchCall.values[0], "%x!%' OR 1=1 --!!%");
  assert.deepEqual(pageCall.values.slice(-2), [10, 10]);
});

test('Unsupported legacy booking statuses fail explicitly instead of being presented as pending', async () => {
  const repository = createOrderRepository({ async execute(sql) {
    if (sql.includes('FROM bookings')) return [[{ id: '4', customer_id: '1', status: 'UNKNOWN_LEGACY' }]];
    return [[]];
  } });
  await assert.rejects(repository.get('1', '4'),
    (error) => error instanceof HttpError && error.status === 503 && error.code === 'UNSUPPORTED_ORDER_STATUS');
});

test('Review unique-key races become a conflict without exposing database details (mock pool)', async () => {
  let unlocked = 0, released = 0;
  const repository = createReviewRepository({ async getConnection() { return {
    async execute(sql) {
      if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }]];
      if (sql.includes('RELEASE_LOCK')) { unlocked += 1; return [[{ released: 1 }]]; }
      if (sql.startsWith('SELECT id')) return [[]];
      throw Object.assign(new Error('synthetic SQL detail that must not reach HTTP'), { code: 'ER_DUP_ENTRY' });
    },
    release() { released += 1; },
  }; } });
  await assert.rejects(repository.create({ id: '4', status: 'completed', staffId: '2' }, { rating: 5, comment: '' }),
    (error) => error instanceof HttpError && error.status === 409 && error.code === 'REVIEW_ALREADY_EXISTS'
      && !error.message.includes('synthetic SQL'));
  assert.equal(unlocked, 1); assert.equal(released, 1);
});

test('Review lock enforces one booking review even when concurrent requests have different employees (mock advisory lock)', async () => {
  let locked = false, released = 0, unlocked = 0;
  const waiters = [];
  const rows = [];
  const acquire = async () => {
    if (!locked) { locked = true; return; }
    await new Promise((resolve) => waiters.push(resolve));
  };
  const unlock = () => {
    const next = waiters.shift();
    if (next) next();
    else locked = false;
  };
  const repository = createReviewRepository({ async getConnection() { return {
    release() { released += 1; },
    async execute(sql, values) {
      if (sql.includes('GET_LOCK')) { await acquire(); return [[{ acquired: 1 }]]; }
      if (sql.includes('RELEASE_LOCK')) { unlocked += 1; unlock(); return [[{ released: 1 }]]; }
      if (sql.startsWith('SELECT id FROM reviews')) return [rows.map((row) => ({ id: row.id }))];
      if (sql.startsWith('INSERT')) {
        rows.push({ id: String(rows.length + 1), booking_id: values[0], employee_id: values[1], rating: values[2], comment: values[3], created_at: '2026-01-01T00:00:00Z' });
        return [{ insertId: String(rows.length) }];
      }
      return [[rows.find((row) => row.id === values[0])]];
    },
  }; } });
  const result = await Promise.allSettled(['2', '3'].map((staffId) => repository.create(
    { id: '4', customerId: '1', serviceId: '1', status: 'completed', staffId }, { rating: 5, comment: 'Synthetic review' },
  )));
  assert.equal(result.filter((entry) => entry.status === 'fulfilled').length, 1);
  assert.equal(result.filter((entry) => entry.status === 'rejected' && entry.reason.status === 409).length, 1);
  assert.equal(rows.length, 1); assert.equal(unlocked, 2); assert.equal(released, 2); assert.equal(locked, false);
});

test('Review lock timeout makes no data changes and releases its pool connection', async () => {
  let calls = 0, released = 0;
  const repository = createReviewRepository({ async getConnection() { return {
    async execute() { calls += 1; return [[{ acquired: 0 }]]; }, release() { released += 1; },
  }; } });
  await assert.rejects(repository.create({ id: '4', status: 'completed', staffId: '2' }, { rating: 5, comment: '' }),
    (error) => error instanceof HttpError && error.status === 503 && error.code === 'REVIEW_BUSY');
  assert.equal(calls, 1); assert.equal(released, 1);
});

test('A failed advisory unlock destroys the session instead of pooling a connection that may hold its lock', async () => {
  let destroyed = 0, pooled = 0;
  const repository = createReviewRepository({ async getConnection() { return {
    release() { pooled += 1; }, destroy() { destroyed += 1; },
    async execute(sql) {
      if (sql.includes('GET_LOCK')) return [[{ acquired: '1' }]];
      if (sql.includes('RELEASE_LOCK')) throw new Error('synthetic connection loss during cleanup');
      if (sql.startsWith('SELECT id FROM')) return [[]];
      if (sql.startsWith('INSERT')) return [{ insertId: '1' }];
      return [[{ id: '1', booking_id: '4', employee_id: '2', rating: 5, comment: 'Synthetic review', created_at: '2026-01-01T00:00:00Z' }]];
    },
  }; } });
  const saved = await repository.create({ id: '4', customerId: '1', serviceId: '1', status: 'completed', staffId: '2' }, { rating: 5, comment: 'Synthetic review' });
  assert.equal(saved.id, '1'); assert.equal(destroyed, 1); assert.equal(pooled, 0);
});

test('Order HTTP validates calendar/input and fails closed on out-of-sync assignment (mock repositories/dependencies)', async (t) => {
  const config = createConfig({}, { generateLocalSecrets: true });
  config.defaultBranchId = '1';
  const keys = createSigningKeys(config);
  const servers = [];
  let authRole = 'CUSTOMER';
  t.after(async () => { await Promise.all(servers.map(closeServer)); });
  const start = async (name, handler) => {
    const server = await listen(handler, 0);
    servers.push(server);
    config.urls[name] = `http://127.0.0.1:${server.address().port}`;
  };
  await start('auth', createHttpApp({ name: 'test-auth', config, routes: [
    { method: 'GET', path: '/api/v1/auth/jwks', handler: () => reply(keys.jwks) },
    { method: 'POST', path: '/internal/v1/introspect', auth: 'internal', callers: ['order'], handler: () => reply({ sub: '1', role: authRole }) },
  ] }));
  let offeredService = service;
  await start('catalog', createHttpApp({ name: 'test-catalog', config, routes: [
    { method: 'GET', path: '/internal/v1/services/:id', auth: 'internal', callers: ['order'], handler: () => reply(offeredService) },
  ] }));
  let assignment = { employeeId: '2', status: 'IN_PROGRESS' };
  let unavailable = false;
  await start('staff', createHttpApp({ name: 'test-staff', config, routes: [
    { method: 'GET', path: '/internal/v1/bookings/:id/assignment', auth: 'internal', callers: ['order'], handler: () => {
      if (unavailable) throw new HttpError(503, 'DEPENDENCY_UNAVAILABLE', 'Synthetic Staff outage');
      return reply(assignment);
    } },
    { method: 'GET', path: '/internal/v1/branches/:id', auth: 'internal', callers: ['order'], handler: () => reply({ id: '1', status: 'ACTIVE' }) },
  ] }));
  let cancelled = 0, created = 0, lastCreateInput, lastCreateService;
  const adminCalls = [];
  const bookingRequests = new Map();
  let current = { id: '4', customerId: '1', status: 'pending' };
  const repository = {
    async get(customerId) { assert.equal(customerId, '1'); return current; },
    async getByRequestKey(customerId, request) {
      const { requestKey, ...payload } = request;
      const previous = bookingRequests.get(customerId + ':' + requestKey);
      if (!previous) return null;
      if (previous.signature !== bookingRequestHash(payload)) throw new HttpError(409, 'REQUEST_KEY_REUSED', 'Synthetic mismatched idempotency key');
      return previous.order;
    },
    async create(customerId, request, catalogService) {
      lastCreateInput = request;
      lastCreateService = catalogService;
      created += 1;
      const order = { id: String(100 + created), customerId, status: 'pending' };
      if (request.requestKey) {
        const { requestKey, ...payload } = request;
        bookingRequests.set(customerId + ':' + requestKey, { signature: bookingRequestHash(payload), order });
      }
      return order;
    },
    async requestCancellation(customerId) { assert.equal(customerId, '1'); cancelled += 1; return current; },
    async listAdmin(filters) { adminCalls.push(['list', filters]); return { items: [], total: 0, page: filters.page, limit: filters.limit }; },
    async getAdmin(bookingId) { adminCalls.push(['detail', bookingId]); return { id: bookingId }; },
    async getAdminOptions(bookingId, options) { adminCalls.push(['options', bookingId, options]); return { branches: [], employees: [] }; },
    async mutateAdmin(bookingId, actorId, action) { adminCalls.push(['mutate', bookingId, actorId, action]); return { id: bookingId }; },
  };
  await start('order', createOrderApp({ repository, config }));
  const cookie = config.cookieName + '=' + issueToken(keys, config, '1', 'test-domain-session');
  const adminCookie = config.cookieName + '=' + issueToken(keys, config, '1', 'test-admin-session', undefined, 'ADMIN');
  const send = async (path, body, authenticated = true) => {
    const response = await fetch(config.urls.order + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: path.includes('/admin/') ? config.origins.admin : config.origin, ...(authenticated ? { Cookie: authRole === 'ADMIN' ? adminCookie : cookie } : {}) },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  const getAdmin = async (path, authenticated = true) => {
    const response = await fetch(config.urls.order + path, {
      headers: { Origin: config.origins.admin, ...(authenticated ? { Cookie: authRole === 'ADMIN' ? adminCookie : cookie } : {}) },
    });
    return { status: response.status, body: await response.json() };
  };

  await t.test('invalid dates, quantities, strict nested fields do not create bookings', async () => {
    for (const body of [null, []]) assert.equal((await send('/api/v1/orders', body)).status, 400);
    for (const patch of [
      { scheduledAt: '2099-02-31T10:00:00Z' },
      { scheduledAt: input().scheduledAt.slice(0, -1) },
      { quantity: 0 }, { quantity: 0.001 }, { quantity: 1.001 }, { quantity: 100001 }, { quantity: '1' }, { requestKey: 'not-a-uuid' },
      { contact: null }, { contact: { ...input().contact, userId: '2' } }, { price: 1 },
    ]) assert.equal((await send('/api/v1/orders', { ...input(), ...patch })).status, 400);
    assert.equal(created, 0);
  });
  await t.test('booking request keys replay the same order and reject a different payload', async () => {
    const request = { ...input(), requestKey: '7ac2b220-95c7-4a2d-b184-322b1f76d9b8' };
    const first = await send('/api/v1/orders', request);
    const retry = await send('/api/v1/orders', request);
    const mismatch = await send('/api/v1/orders', { ...request, specialRequest: 'Different request' });
    assert.equal(first.status, 201);
    assert.equal(retry.status, 200);
    assert.equal(retry.body.data.id, first.body.data.id);
    assert.equal(mismatch.status, 409);
    assert.equal(mismatch.body.error.code, 'REQUEST_KEY_REUSED');
    assert.equal(created, 1);
  });
  await t.test('a known booking key replays after its schedule; new past requests and changed payloads still fail', async () => {
    const request = { ...input(), scheduledAt: new Date(Date.now() - 60000).toISOString(), requestKey: '8ac2b220-95c7-4a2d-b184-322b1f76d9b8' };
    const { requestKey, ...payload } = request;
    const saved = { id: 'past-booking', customerId: '1', status: 'pending' };
    bookingRequests.set('1:' + requestKey, { signature: bookingRequestHash(payload), order: saved });
    const before = created;
    const originalBranch = config.defaultBranchId;
    config.defaultBranchId = '';
    try {
      const replay = await send('/api/v1/orders', request);
      assert.equal(replay.status, 200);
      assert.equal(replay.body.data.id, saved.id);
      const changed = await send('/api/v1/orders', { ...request, specialRequest: 'Different old request' });
      assert.equal(changed.status, 409);
      assert.equal(changed.body.error.code, 'REQUEST_KEY_REUSED');
      const malformed = await send('/api/v1/orders', { ...request, scheduledAt: '2026-02-31T10:00:00Z' });
      assert.equal(malformed.status, 400, 'Replay does not bypass structural calendar validation.');
      for (const requestKey of [undefined, '9ac2b220-95c7-4a2d-b184-322b1f76d9b8']) {
        const rejected = await send('/api/v1/orders', { ...request, requestKey });
        assert.equal(rejected.status, 400);
        assert.ok(rejected.body.error.fields.scheduledAt);
      }
      assert.equal((await send('/api/v1/orders', request, false)).status, 401);
      assert.equal(created, before);
    } finally { config.defaultBranchId = originalBranch; }
  });
  await t.test('fractional Catalog minimums and booking quantities agree while precision and minimum checks remain enforced', async () => {
    const before = created;
    try {
      offeredService = { ...service, minQuantity: 0.5 };
      const valid = await send('/api/v1/orders', { ...input(), quantity: 0.5 });
      assert.equal(valid.status, 201);
      assert.equal(lastCreateInput.quantity, 0.5);
      assert.equal(lastCreateService.minQuantity, 0.5);
      const belowMinimum = await send('/api/v1/orders', { ...input(), quantity: 0.49 });
      assert.equal(belowMinimum.status, 400);
      const precision = await send('/api/v1/orders', { ...input(), quantity: 0.501 });
      assert.equal(precision.status, 400);
      offeredService = { ...service, minQuantity: 0.01 };
      assert.equal((await send('/api/v1/orders', { ...input(), quantity: 0.01 })).status, 201);
      offeredService = { ...service, minQuantity: 0.005 };
      const invalidCatalog = await send('/api/v1/orders', { ...input(), quantity: 1 });
      assert.equal(invalidCatalog.status, 503);
      assert.equal(invalidCatalog.body.error.code, 'INVALID_CATALOG_DATA');
      assert.equal(created, before + 2);
    } finally { offeredService = service; }
  });
  await t.test('optional verified routing region is accepted without becoming required or inferred from the address', async () => {
    const body = input();
    body.contact.region = 'Phường thử nghiệm';
    const response = await send('/api/v1/orders', body);
    assert.equal(response.status, 201);
    assert.equal(lastCreateInput.contact.region, 'Phường thử nghiệm');
    const withoutRegion = input();
    assert.equal((await send('/api/v1/orders', withoutRegion)).status, 201);
    assert.equal(Object.hasOwn(lastCreateInput.contact, 'region'), false);
  });
  await t.test('rental and family cleaning enforce house details server-side; care and maintenance allow omitted details', async () => {
    const before = created;
    try {
      for (const cleaningType of ['phong-tro', 'nha-gia-dinh']) {
        offeredService = { ...service, group: 've-sinh', cleaningType };
        for (const field of ['area', 'rooms', 'floors']) {
          const body = input();
          body.contact = { ...body.contact, area: 25, rooms: 1, floors: 1 };
          delete body.contact[field];
          const result = await send('/api/v1/orders', body);
          assert.equal(result.status, 400);
          assert.ok(result.body.error.fields['contact.' + field]);
        }
        assert.equal(created, before);
      }
      for (const group of ['cham-soc', 'bao-duong']) {
        offeredService = { ...service, group };
        assert.equal((await send('/api/v1/orders', input())).status, 201);
      }
      offeredService = { ...service, group: 've-sinh', cleaningType: 'phong-tro' };
      const complete = input();
      complete.contact = { ...complete.contact, area: 0.01, rooms: 1, floors: 1 };
      assert.equal((await send('/api/v1/orders', complete)).status, 201);
      assert.equal(created, before + 3);
    } finally { offeredService = service; }
  });
  await t.test('in-progress assignment blocks cancellation even while booking remains pending/confirmed', async () => {
    for (const status of ['pending', 'confirmed']) {
      current = { ...current, status };
      const result = await send('/api/v1/orders/4/cancellation-requests', { reason: 'Synthetic schedule conflict' });
      assert.equal(result.status, 422);
      assert.equal(result.body.error.code, 'CANCELLATION_NOT_ALLOWED');
    }
    assert.equal(cancelled, 0);
  });
  await t.test('Staff unavailable cannot produce a successful cancellation', async () => {
    unavailable = true;
    const result = await send('/api/v1/orders/4/cancellation-requests', { reason: 'Synthetic schedule conflict' });
    assert.equal(result.status, 503);
    assert.equal(cancelled, 0);
    unavailable = false;
  });
  await t.test('a waiting assignment permits the request; authentication still applies', async () => {
    assignment = { employeeId: '2', status: 'ASSIGNED' };
    assert.equal((await send('/api/v1/orders/4/cancellation-requests', { reason: 'Synthetic schedule conflict' }, false)).status, 401);
    const result = await send('/api/v1/orders/4/cancellation-requests', { reason: 'Synthetic schedule conflict' });
    assert.equal(result.status, 201);
    assert.equal(result.body.data.staffId, '2');
    assert.equal(cancelled, 1);
  });
  await t.test('admin routes require the backend ADMIN role and expose filtered service-order actions', async () => {
    authRole = 'CUSTOMER';
    assert.equal((await getAdmin('/api/v1/admin/orders')).status, 403);
    authRole = 'ADMIN';
    const list = await getAdmin('/api/v1/admin/orders?decisionState=NEEDS_ADMIN&branchId=1&from=2030-01-01&to=2030-01-31&reason=địa%20chỉ');
    assert.equal(list.status, 200, JSON.stringify(list.body));
    assert.equal(adminCalls.at(-1)[0], 'list');
    assert.equal(adminCalls.at(-1)[1].decisionState, 'NEEDS_ADMIN');
    assert.equal(adminCalls.at(-1)[1].branchId, '1');
    const options = await getAdmin('/api/v1/admin/orders/4/options?scheduledAt=2030-01-02T02%3A00%3A00.000Z&durationMinutes=90');
    assert.equal(options.status, 200);
    assert.deepEqual(options.body.data, { branches: [], employees: [] });
    assert.deepEqual(adminCalls.at(-1), ['options', '4', { scheduledAt: '2030-01-02T02:00:00.000Z', durationMinutes: 90 }]);
    assert.equal((await getAdmin('/api/v1/admin/orders/4/options?durationMinutes=1.5')).status, 400);
    assert.equal((await getAdmin('/api/v1/admin/orders/4/options?unknown=value')).status, 400);
    const invalid = await send('/api/v1/admin/orders/4/decisions', { action: 'cancel', reason: '' });
    assert.equal(invalid.status, 400);
    const mutation = await send('/api/v1/admin/orders/4/decisions', { action: 'cancel', reason: 'Admin quyết định hủy' });
    assert.equal(mutation.status, 200);
    assert.equal(adminCalls.at(-1)[0], 'mutate');
    assert.equal(adminCalls.at(-1)[2], '1');
    assert.equal(adminCalls.at(-1)[3].action, 'cancel');
    const update = await send('/api/v1/admin/orders/4/decisions', {
      action: 'update',
      reason: 'Cập nhật địa chỉ theo xác nhận của khách',
      name: 'Khách hàng',
      address: '12 Nguyễn Trãi',
      region: '',
    });
    assert.equal(update.status, 200);
    assert.deepEqual(adminCalls.at(-1)[3], {
      action: 'update',
      reason: 'Cập nhật địa chỉ theo xác nhận của khách',
      name: 'Khách hàng',
      address: '12 Nguyễn Trãi',
      region: '',
    });
    authRole = 'CUSTOMER';
    assert.equal((await getAdmin('/api/v1/admin/orders', false)).status, 401);
  });
});
