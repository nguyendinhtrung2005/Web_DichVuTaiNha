import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createMysqlPool } from '../shared/mysql-pool.js';
import { createCustomerFixtures } from '../scripts/customer-fixtures.js';

const origin = 'http://localhost:3001';
const enabled = process.env.ALLOW_CUSTOMER_DB_TEST === '1';

function bookingInput(serviceId, marker) {
  const at = new Date(Date.now() + 3 * 86400000);
  at.setUTCHours(2, 0, 0, 0);
  return {
    requestKey: randomUUID(),
    serviceId, quantity: 1, expectedUnitPrice: 125000,
    contact: { name: `${marker} Contact`, phone: '0391234567', address: `${marker} synthetic test address`, houseType: 'can-ho', area: 60, rooms: 2, floors: 1, hasPets: false },
    scheduledAt: at.toISOString(), specialRequest: `${marker} test only`,
  };
}

test('Customer API via real HTTP and approved local MySQL fixtures', { skip: !enabled && 'Set ALLOW_CUSTOMER_DB_TEST=1 only after fixture and migration approval.', timeout: 180000 }, async (t) => {
  const { startCustomerStack } = await import('../scripts/customer-runtime.js');
  const pool = createMysqlPool();
  let fixture;
  let stack;
  try {
    fixture = await createCustomerFixtures(pool);
    stack = await startCustomerStack({
      env: { ...process.env, NODE_ENV: 'test' },
      ports: { auth: 0, user: 0, catalog: 0, order: 0, staff: 0, payment: 0, review: 0, gateway: 0 },
      configOverrides: { origin, defaultBranchId: fixture.branchId },
    });
    const request = async (method, route, body, cookie, overrides = {}) => {
      const response = await fetch(`${stack.urls.gateway}/api/v1${route}`, {
        method,
        headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), origin, ...(cookie ? { cookie } : {}), ...overrides.headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const result = response.status === 204 ? null : await response.json();
      return { status: response.status, body: result, headers: response.headers, cookie: response.headers.get('set-cookie')?.split(';')[0] };
    };
    const customer = fixture.account('Customer');
    const other = fixture.account('Other');
    let cookie;
    let otherCookie;
    let user;
    let otherUser;
    let order;

    await t.test('registration hashes password, sets secure session attributes, and rejects client roles', async () => {
      const injected = await request('POST', '/auth/register', { ...customer, role: 'ADMIN' });
      assert.equal(injected.status, 400);
      const created = await request('POST', '/auth/register', customer);
      assert.equal(created.status, 201);
      user = created.body.data;
      assert.equal(user.role, 'customer');
      assert.ok(typeof user.id === 'string');
      await fixture.record('users', user.id);
      cookie = created.cookie;
      assert.ok(Boolean(cookie), 'Registration must set a session cookie.');
      const setCookie = created.headers.get('set-cookie') || '';
      assert.ok(/httponly/i.test(setCookie), 'Session cookie must be HttpOnly.');
      assert.ok(/samesite=lax/i.test(setCookie), 'Session cookie must be SameSite=Lax.');
      assert.ok(!('token' in user) && !('password' in user) && !('password_hash' in user), 'Public user must omit credentials.');
      const [rows] = await pool.execute('SELECT password_hash,role FROM users WHERE id=?', [user.id]);
      assert.ok(rows[0].password_hash !== customer.password, 'Password must not be stored in plain text.');
      assert.equal(rows[0].role, 'CUSTOMER');
      const second = await request('POST', '/auth/register', other);
      assert.equal(second.status, 201);
      otherUser = second.body.data;
      await fixture.record('users', otherUser.id);
      otherCookie = second.cookie;
      assert.equal((await request('POST', '/auth/register', customer)).status, 409);
    });
    assert.ok(user && otherUser && cookie && otherCookie, 'Registration setup must succeed.');

    await t.test('phone and case-normalized email login; wrong password and invalid identifiers fail', async () => {
      for (const identifier of [customer.phone, customer.email.toUpperCase()]) {
        const result = await request('POST', '/auth/login', { identifier, password: customer.password });
        assert.equal(result.status, 200);
        assert.equal(result.body.data.id, user.id);
        cookie = result.cookie;
      }
      assert.equal((await request('POST', '/auth/login', { identifier: customer.email, password: 'not-the-test-password' })).status, 401);
      assert.equal((await request('POST', '/auth/login', { identifier: 'invalid', password: customer.password })).status, 400);
      assert.equal((await request('POST', '/auth/login', { identifier: customer.phone, password: customer.password, role: 'ADMIN' })).status, 400);
    });

    await t.test('public catalog has database rows, search, pagination and details', async () => {
      const list = await request('GET', `/catalog/services?q=${encodeURIComponent(fixture.marker)}&page=1&limit=1`);
      assert.equal(list.status, 200);
      assert.equal(list.body.data.total, 1);
      assert.equal(list.body.data.items[0].id, fixture.serviceId);
      assert.equal(list.body.data.items[0].price, 125000);
      assert.equal((await request('GET', `/catalog/services/${fixture.serviceId}`)).status, 200);
      assert.equal((await request('GET', '/catalog/services?page=0')).status, 400);
      const categories = await request('GET', '/catalog/categories');
      assert.equal(categories.status, 200);
      assert.ok(categories.body.data.some((category) => category.id === fixture.categoryId));
    });

    await t.test('inactive fixture account cannot log in or retain its old authenticated session', async () => {
      try {
        const [changed] = await pool.execute("UPDATE users SET status='INACTIVE' WHERE id=? AND full_name=?", [otherUser.id, other.name]);
        assert.equal(changed.affectedRows, 1, 'Only the marked synthetic account may be disabled.');
        const denied = await request('POST', '/auth/login', { identifier: other.phone, password: other.password });
        assert.equal(denied.status, 401);
        assert.equal(denied.cookie, undefined);
        assert.equal((await request('GET', '/users/me', undefined, otherCookie)).status, 401);
      } finally {
        await pool.execute("UPDATE users SET status='ACTIVE' WHERE id=? AND full_name=?", [otherUser.id, other.name]);
      }
      const renewed = await request('POST', '/auth/login', { identifier: other.phone, password: other.password });
      assert.equal(renewed.status, 200);
      otherCookie = renewed.cookie;
    });

    await t.test('session, CORS, origin and internal endpoint protection', async () => {
      assert.equal((await request('GET', '/users/me')).status, 401);
      assert.equal((await request('GET', '/orders')).status, 401);
      const profile = await request('GET', '/users/me', undefined, cookie);
      assert.equal(profile.status, 200);
      assert.equal(profile.body.data.id, user.id);
      assert.equal(profile.headers.get('access-control-allow-origin'), origin);
      assert.equal(profile.headers.get('access-control-allow-credentials'), 'true');
      assert.equal((await request('PATCH', '/users/me', { name: `${fixture.marker} Changed`, phone: customer.phone, email: customer.email }, cookie, { headers: { origin: 'https://evil.invalid' } })).status, 403);
      assert.equal((await request('GET', '/users/me', undefined, 'cleanhome_customer_session=invalid.jwt.value')).status, 401);
      assert.equal((await fetch(`${stack.urls.gateway}/internal/v1/introspect`)).status, 404);
      const internal = await fetch(`${stack.urls.order}/internal/v1/customers/${user.id}/orders`);
      assert.ok([401, 403].includes(internal.status), 'Internal Order API must require a service credential.');
    });

    await t.test('profile writes only current user, enforces unique phone/email and rejects unsupported fields', async () => {
      const patch = { name: `${fixture.marker} Updated`, phone: customer.phone, email: customer.email };
      const changed = await request('PATCH', '/users/me', patch, cookie);
      assert.equal(changed.status, 200);
      assert.equal(changed.body.data.name, patch.name);
      assert.equal((await request('PATCH', '/users/me', { ...patch, phone: other.phone }, cookie)).status, 409);
      assert.equal((await request('PATCH', '/users/me', { ...patch, email: other.email }, cookie)).status, 409);
      assert.equal((await request('PATCH', '/users/me', { ...patch, userId: otherUser.id }, cookie)).status, 400);
      assert.equal((await request('PATCH', '/users/me', { ...patch, avatar: 'not-supported' }, cookie)).status, 400);
    });

    await t.test('booking validates input and computes amount from Catalog, transaction persists items/history', async () => {
      const input = bookingInput(fixture.serviceId, fixture.marker);
      assert.equal((await request('POST', '/orders', input)).status, 401);
      assert.equal((await request('POST', '/orders', { ...input, quantity: 0 }, cookie)).status, 400);
      assert.equal((await request('POST', '/orders', { ...input, price: 1, customerId: otherUser.id }, cookie)).status, 400);
      const created = await request('POST', '/orders', input, cookie);
      assert.equal(created.status, 201);
      order = created.body.data;
      const replay = await request('POST', '/orders', input, cookie);
      assert.equal(replay.status, 200);
      assert.equal(replay.body.data.id, order.id);
      const mismatch = await request('POST', '/orders', { ...input, specialRequest: `${fixture.marker} different request` }, cookie);
      assert.equal(mismatch.status, 409);
      assert.equal(mismatch.body.error.code, 'REQUEST_KEY_REUSED');
      assert.equal(order.customerId, user.id);
      assert.equal(order.price, 125000);
      assert.equal(order.status, 'pending');
      await fixture.recordOrder(order.id);
      const [requestRows] = await pool.execute('SELECT id FROM bookings WHERE customer_id=? AND customer_request_key=?', [user.id, input.requestKey]);
      assert.equal(requestRows.length, 1);
      const [items] = await pool.execute('SELECT quantity,unit_price FROM booking_items WHERE booking_id=?', [order.id]);
      assert.equal(items.length, 1);
      assert.equal(Number(items[0].unit_price), 125000);
      const [history] = await pool.execute('SELECT id FROM booking_status_history WHERE booking_id=?', [order.id]);
      assert.ok(history.length >= 1);
      const owned = await request('GET', '/orders', undefined, cookie);
      assert.equal(owned.status, 200);
      assert.ok(owned.body.data.items.every((item) => item.customerId === user.id));
    });
    assert.ok(order, 'Booking setup must succeed.');

    await t.test('fractional service minimum and quantity persist the Catalog price without rounding to a whole unit', async () => {
      const fixtureName = fixture.marker + ' Service';
      const [previous] = await pool.execute('SELECT customer_config FROM services WHERE id=? AND name=?', [fixture.serviceId, fixtureName]);
      assert.equal(previous.length, 1, 'Only this suite\'s marked service may be changed.');
      const originalMetadata = previous[0].customer_config;
      try {
        const [updated] = await pool.execute('UPDATE services SET customer_config=? WHERE id=? AND name=?', [
          JSON.stringify({ version: 1, group: 've-sinh', cleaningType: 'nha-gia-dinh', minQuantity: 0.5, defaultQuantity: 0.5, pricingMode: 'fixed' }),
          fixture.serviceId, fixtureName,
        ]);
        assert.equal(updated.affectedRows, 1);
        const catalog = await request('GET', '/catalog/services/' + fixture.serviceId);
        assert.equal(catalog.status, 200);
        assert.equal(catalog.body.data.minQuantity, 0.5);
        const payload = { ...bookingInput(fixture.serviceId, fixture.marker), quantity: 0.5 };
        for (const field of ['area', 'rooms', 'floors']) {
          const incomplete = { ...payload, contact: { ...payload.contact } };
          delete incomplete.contact[field];
          const invalid = await request('POST', '/orders', incomplete, cookie);
          assert.equal(invalid.status, 400);
          assert.ok(invalid.body.error.fields['contact.' + field]);
        }
        const fractional = await request('POST', '/orders', payload, cookie);
        assert.equal(fractional.status, 201);
        await fixture.recordOrder(fractional.body.data.id);
        assert.equal(fractional.body.data.quantity, 0.5);
        assert.equal(fractional.body.data.price, 62500);
        const [items] = await pool.execute('SELECT quantity,unit_price FROM booking_items WHERE booking_id=?', [fractional.body.data.id]);
        assert.equal(items.length, 1);
        assert.equal(Number(items[0].quantity), 0.5);
        assert.equal(Number(items[0].unit_price), 125000);
        assert.equal((await request('POST', '/orders', { ...payload, requestKey: randomUUID(), quantity: 0.49 }, cookie)).status, 400);
        const replay = await request('POST', '/orders', payload, cookie);
        assert.equal(replay.status, 200);
        assert.equal(replay.body.data.id, fractional.body.data.id);
      } finally {
        await pool.execute('UPDATE services SET customer_config=? WHERE id=? AND name=?', [
          originalMetadata === null || typeof originalMetadata === 'string' ? originalMetadata : JSON.stringify(originalMetadata),
          fixture.serviceId, fixtureName,
        ]);
      }
    });

    await t.test('other customer cannot read, cancel, pay or review this booking', async () => {
      for (const [method, route, body] of [
        ['GET', `/orders/${order.id}`],
        ['POST', `/orders/${order.id}/cancellation-requests`, { reason: 'Unauthorized cancellation attempt' }],
        ['POST', `/orders/${order.id}/payment-simulation`, { method: 'cash' }],
        ['POST', `/orders/${order.id}/reviews`, { rating: 5, comment: 'Unauthorized review' }],
      ]) assert.equal((await request(method, route, body, otherCookie)).status, 404);
      assert.equal((await request('GET', '/orders', undefined, otherCookie)).body.data.total, 0);
    });

    await t.test('concurrent cancellation requests persist one pending request and keep booking status', async () => {
      const responses = await Promise.all([1, 2].map(() => request('POST', `/orders/${order.id}/cancellation-requests`, { reason: `${fixture.marker} schedule conflict` }, cookie)));
      assert.equal(responses.filter((response) => [200, 201].includes(response.status)).length, 1);
      assert.equal(responses.filter((response) => response.status === 409).length, 1);
      const detail = await request('GET', `/orders/${order.id}`, undefined, cookie);
      assert.equal(detail.body.data.status, 'pending');
      assert.equal(detail.body.data.cancelRequest.status, 'pending');
    });

    await t.test('an older in-progress assignment blocks cancellation despite a newer waiting assignment', async () => {
      const created = await request('POST', '/orders', bookingInput(fixture.serviceId, fixture.marker), cookie);
      assert.equal(created.status, 201);
      const assigned = created.body.data;
      await fixture.recordOrder(assigned.id);
      for (const [status, earlier] of [['IN_PROGRESS', true], ['ASSIGNED', false]]) {
        const [result] = await pool.execute(
          `INSERT INTO assignments (booking_id,employee_id,status,assigned_at,check_in_at) VALUES (?,?,?,${earlier ? 'DATE_SUB(CURRENT_TIMESTAMP,INTERVAL 1 HOUR)' : 'CURRENT_TIMESTAMP'},${earlier ? 'CURRENT_TIMESTAMP' : 'NULL'})`,
          [assigned.id, fixture.employeeId, status],
        );
        await fixture.record('assignments', result.insertId);
      }
      const result = await request('POST', `/orders/${assigned.id}/cancellation-requests`, { reason: `${fixture.marker} unsafe cancellation` }, cookie);
      assert.equal(result.status, 422);
      const [rows] = await pool.execute('SELECT status FROM bookings WHERE id=? AND customer_id=?', [assigned.id, user.id]);
      assert.equal(rows[0].status, 'PENDING');
      await fixture.recordOrder(assigned.id);
    });

    await t.test('payment simulation is idempotent, customer-owned and never confirms real payment', async () => {
      const created = await request('POST', '/orders', bookingInput(fixture.serviceId, fixture.marker), cookie);
      assert.equal(created.status, 201);
      const paymentOrder = created.body.data;
      await fixture.recordOrder(paymentOrder.id);
      const responses = await Promise.all([1, 2].map(() => request('POST', `/orders/${paymentOrder.id}/payment-simulation`, { method: 'transfer' }, cookie)));
      assert.ok(responses.every((response) => [200, 201].includes(response.status)));
      assert.equal(responses[0].body.data.id, responses[1].body.data.id);
      assert.equal(responses[0].body.data.status, 'pending');
      assert.equal(responses[0].body.data.amount, 125000);
      assert.equal((await request('POST', `/orders/${paymentOrder.id}/payment-simulation`, { method: 'real-provider' }, cookie)).status, 400);
      const payments = await request('GET', '/payments', undefined, cookie);
      assert.equal(payments.status, 200);
      assert.ok(payments.body.data.items.every((payment) => payment.status !== 'paid'));
      assert.equal((await request('GET', '/payments', undefined, otherCookie)).body.data.total, 0);
      await fixture.recordOrder(paymentOrder.id);
    });

    await t.test('one rating on completed owned booking with a real assignment; duplicate review conflicts', async (reviewContext) => {
      assert.equal((await request('POST', `/orders/${order.id}/reviews`, { rating: 5, comment: 'Not completed yet' }, cookie)).status, 422);
      const created = await request('POST', '/orders', bookingInput(fixture.serviceId, fixture.marker), cookie);
      assert.equal(created.status, 201);
      const completed = created.body.data;
      await fixture.recordOrder(completed.id);
      await fixture.completeOrder(completed.id, user.id);
      await reviewContext.test('invalid review input never creates a review or consumes the completed booking', async () => {
        for (const comment of ['', '   ', '\t\n', '\u00a0', null, 'x'.repeat(2001)]) {
          const rejected = await request('POST', `/orders/${completed.id}/reviews`, { rating: 4, comment }, cookie);
          assert.equal(rejected.status, 400);
          assert.equal(rejected.body.error.code, 'INVALID_INPUT');
          assert.ok(rejected.body.error.fields.comment);
        }
        for (const rating of [0, 6, 1.5, '4']) {
          assert.equal((await request('POST', `/orders/${completed.id}/reviews`, { rating, comment: 'Valid comment' }, cookie)).status, 400);
        }
        const [reviews] = await pool.execute('SELECT COUNT(*) AS total FROM reviews WHERE booking_id=?', [completed.id]);
        assert.equal(Number(reviews[0].total), 0);
      });
      const review = { rating: 4, comment: `${fixture.marker} synthetic review` };
      const result = await request('POST', `/orders/${completed.id}/reviews`, { ...review, comment: '  ' + review.comment + '  ' }, cookie);
      assert.equal(result.status, 201);
      assert.equal(result.body.data.rating, 4);
      assert.equal(result.body.data.comment, review.comment);
      assert.equal((await request('POST', `/orders/${completed.id}/reviews`, review, cookie)).status, 409);
      assert.equal((await request('POST', `/orders/${completed.id}/reviews`, { ...review, rating: 6 }, cookie)).status, 400);
      assert.equal((await request('GET', '/reviews', undefined, cookie)).body.data.total, 1);
      assert.equal((await request('GET', '/reviews', undefined, otherCookie)).body.data.total, 0);
      await fixture.recordOrder(completed.id);
      const summary = await request('GET', `/reviews/service-summary?serviceId=${fixture.serviceId}`);
      assert.equal(summary.status, 200);
      assert.deepEqual(summary.body.data, { serviceId: fixture.serviceId, count: 1, averageRating: 4 });
      assert.deepEqual(Object.keys(summary.body.data).sort(), ['averageRating', 'count', 'serviceId']);
      assert.equal((await request('GET', '/reviews/service-summary?serviceId=bad')).status, 400);
      const unknown = await request('GET', '/reviews/service-summary?serviceId=9223372036854775807');
      assert.deepEqual(unknown.body.data, { serviceId: '9223372036854775807', count: 0, averageRating: null });
      const internal = await fetch(`${stack.urls.order}/internal/v1/services/${fixture.serviceId}/completed-bookings`);
      assert.ok([401, 403].includes(internal.status));
      assert.equal((await fetch(`${stack.urls.gateway}/internal/v1/services/${fixture.serviceId}/completed-bookings`)).status, 404);
      const orderUrl = stack.config.urls.order;
      try {
        stack.config.urls.order = 'http://127.0.0.1:1';
        const unavailable = await request('GET', `/reviews/service-summary?serviceId=${fixture.serviceId}`);
        assert.equal(unavailable.status, 503);
        assert.ok(!('data' in unavailable.body), 'Dependency failure must not be represented as zero reviews.');
      } finally { stack.config.urls.order = orderUrl; }
    });

    await t.test('Order filters apply ownership, service snapshots, Vietnam day boundaries, pagination and errors through Gateway', async () => {
      const targetDay = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
      const start = Date.parse(targetDay + 'T00:00:00+07:00');
      const createdIds = [];
      for (const time of [start - 1000, start, start + 86400000 - 1000, start + 86400000]) {
        const result = await request('POST', '/orders', bookingInput(fixture.serviceId, fixture.marker), cookie);
        assert.equal(result.status, 201);
        await fixture.recordOrder(result.body.data.id);
        // Historical snapshots can predate today's booking-slot policy.
        await pool.execute('UPDATE bookings SET scheduled_start=?,scheduled_end=? WHERE id=? AND customer_id=?', [new Date(time), new Date(time + 7200000), result.body.data.id, user.id]);
        createdIds.push(result.body.data.id);
      }
      const secondCustomer = await request('POST', '/orders', bookingInput(fixture.serviceId, fixture.marker), otherCookie);
      assert.equal(secondCustomer.status, 201);
      await fixture.recordOrder(secondCustomer.body.data.id);
      await pool.execute('UPDATE bookings SET scheduled_start=?,scheduled_end=? WHERE id=? AND customer_id=?', [new Date(start), new Date(start + 7200000), secondCustomer.body.data.id, otherUser.id]);
      const criteria = `from=${targetDay}&to=${targetDay}&serviceId=${fixture.serviceId}&status=pending&q=${encodeURIComponent(fixture.marker)}`;
      const first = await request('GET', `/orders?${criteria}&sort=schedule-asc&limit=1&page=1`, undefined, cookie);
      const second = await request('GET', `/orders?${criteria}&sort=schedule-asc&limit=1&page=2`, undefined, cookie);
      assert.equal(first.status, 200); assert.equal(second.status, 200);
      assert.equal(first.body.data.total, 2); assert.equal(second.body.data.total, 2);
      assert.deepEqual([first.body.data.items[0].id, second.body.data.items[0].id], createdIds.slice(1, 3));
      const descending = await request('GET', `/orders?${criteria}&sort=schedule-desc`, undefined, cookie);
      assert.deepEqual(descending.body.data.items.map((item) => item.id), createdIds.slice(1, 3).reverse());
      const byCode = await request('GET', '/orders?q=' + first.body.data.items[0].code, undefined, cookie);
      assert.deepEqual(byCode.body.data.items.map((item) => item.id), [createdIds[1]]);
      assert.equal((await request('GET', '/orders?q=' + encodeURIComponent("%' OR 1=1 --"), undefined, cookie)).body.data.total, 0);
      assert.equal((await request('GET', '/orders?' + criteria)).status, 401);
      const isolated = await request('GET', '/orders?' + criteria, undefined, otherCookie);
      assert.deepEqual(isolated.body.data.items.map((item) => item.id), [secondCustomer.body.data.id]);
      for (const query of ['from=2026-02-31', 'from=2026-11-10&to=2026-11-09', 'sort=DROP', 'status=ADMIN', 'serviceId=bad']) {
        assert.equal((await request('GET', '/orders?' + query, undefined, cookie)).status, 400);
      }
      const fixtureName = fixture.marker + ' Service';
      try {
        await pool.execute('UPDATE services SET is_active=FALSE WHERE id=? AND name=?', [fixture.serviceId, fixtureName]);
        const historical = await request('GET', '/orders?' + criteria, undefined, cookie);
        assert.equal(historical.status, 200);
        assert.equal(historical.body.data.total, 2, 'Order filters must use the saved items even if Catalog is inactive.');
      } finally {
        await pool.execute('UPDATE services SET is_active=TRUE WHERE id=? AND name=?', [fixture.serviceId, fixtureName]);
      }
    });

    await t.test('Catalog dependency failure fails closed without a booking insert', async () => {
      const previous = stack.config.urls.catalog;
      const [before] = await pool.execute('SELECT COUNT(*) AS total FROM bookings WHERE customer_id=?', [user.id]);
      try {
        stack.config.urls.catalog = 'http://127.0.0.1:1';
        const result = await request('POST', '/orders', bookingInput(fixture.serviceId, fixture.marker), cookie);
        assert.equal(result.status, 503);
        const serialized = JSON.stringify(result.body);
        assert.ok(!/stack|password_hash|SELECT|DB_PASSWORD/.test(serialized), 'Error response must not expose implementation details or credentials.');
      } finally { stack.config.urls.catalog = previous; }
      const [after] = await pool.execute('SELECT COUNT(*) AS total FROM bookings WHERE customer_id=?', [user.id]);
      assert.equal(Number(after[0].total), Number(before[0].total));
    });

    await t.test('logout revokes an already issued cookie across services', async () => {
      const result = await request('POST', '/auth/logout', {}, cookie);
      assert.ok([200, 204].includes(result.status));
      assert.equal((await request('GET', '/users/me', undefined, cookie)).status, 401);
      assert.equal((await request('GET', '/orders', undefined, cookie)).status, 401);
    });
  } finally {
    if (stack) await stack.close();
    try { if (fixture) await fixture.cleanup(); }
    finally { await pool.end(); }
  }
});
