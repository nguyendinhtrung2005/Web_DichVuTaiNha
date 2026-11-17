import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { validateCustomerStart } from '../order-service/src/app.js';
import { createRepository as orderRepository } from '../order-service/src/repository.js';
import { createRepository as catalogRepository } from '../service-service/src/repository.js';
import { createProductFixtures } from '../scripts/product-fixtures.js';
import { createMysqlPool } from '../shared/mysql-pool.js';

test('Customer booking slots use Vietnam time, exact half hours and preserve the existing UI choices', () => {
  for (const time of ['07:00', '07:30', '08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00']) {
    const at = '2030-01-02T' + time + ':00+07:00';
    assert.doesNotThrow(() => validateCustomerStart(at));
    assert.doesNotThrow(() => validateCustomerStart(new Date(at).toISOString()));
  }
  for (const time of ['02:15', '06:30', '07:15', '11:00', '12:30', '16:30', '23:30']) {
    assert.throws(() => validateCustomerStart('2030-01-02T' + time + ':00+07:00'), error => error.status === 400 && Boolean(error.fields.scheduledAt));
  }
  for (const at of ['2030-01-02T09:00:01+07:00', '2030-01-02T09:00:00.001+07:00', '2000-01-02T09:00:00+07:00', 'invalid']) {
    assert.throws(() => validateCustomerStart(at), error => error.status === 400);
  }
});

test('Customer price confirmation and legacy recovery through Gateway and approved MySQL fixtures', { skip: process.env.ALLOW_CUSTOMER_DB_TEST !== '1', timeout: 90000 }, async t => {
  const { startCustomerStack } = await import('../scripts/customer-runtime.js');
  const pool = createMysqlPool();
  let fixture, stack;
  try {
    fixture = await createProductFixtures(pool);
    stack = await startCustomerStack({ env: { ...process.env, NODE_ENV: 'test' },
      ports: { auth: 0, user: 0, catalog: 0, order: 0, staff: 0, payment: 0, review: 0, gateway: 0 },
      configOverrides: { origin: 'http://localhost:3001', defaultBranchId: fixture.branchId } });
    let cookie;
    const request = async (path, body) => {
      const response = await fetch(stack.urls.gateway + '/api/v1' + path, { method: body ? 'POST' : 'GET',
        headers: { Origin: stack.config.origin, ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
    };
    const account = fixture.account('PriceConfirmation');
    const registered = await request('/auth/register', account);
    assert.equal(registered.status, 201);
    cookie = registered.cookie;
    const customerId = registered.body.data.id;
    await fixture.record('users', customerId);
    const date = new Date(new Date(Date.now() + 4 * 86400000).setUTCHours(2, 0, 0, 0));
    const booking = () => ({ requestKey: randomUUID(), serviceId: fixture.serviceId, expectedUnitPrice: 125000, quantity: 1,
      contact: { name: account.name, phone: account.phone, address: fixture.marker + ' confirmation address', houseType: 'can-ho', hasPets: false, area: 60, rooms: 2, floors: 1 },
      scheduledAt: date.toISOString(), specialRequest: fixture.marker });
    const contact = { name: account.name, phone: account.phone };
    const purchase = () => ({ requestKey: randomUUID(), contact, items: [{ productId: fixture.productId, quantity: 1, expectedUnitPrice: 42000 }], paymentMethod: 'cash' });
    const stock = async () => { const [rows] = await pool.execute('SELECT reserved_quantity FROM product_inventory WHERE product_id=?', [fixture.productId]); return Number(rows[0].reserved_quantity); };
    const create = async input => { const r = await request('/orders', input); if (r.body.data?.id) await fixture.recordOrder(r.body.data.id); return r; };
    const buy = async input => { const r = await request('/product-orders', input); if (r.body.data?.id) await fixture.recordProductOrder(r.body.data.id); return r; };
    await t.test('service price increases/decreases require a new explicit confirmation; replay retains the agreed price', async () => {
      const original = booking();
      const saved = await create(original);
      assert.equal(saved.status, 201);
      for (const price of [250000, 100000]) {
        await pool.execute('UPDATE services SET base_price=? WHERE id=? AND name=?', [price, fixture.serviceId, fixture.marker + ' Service']);
        const rejected = await create(booking());
        assert.equal(rejected.status, 409);
        assert.equal(rejected.body.error.code, 'PRICE_CHANGED');
        const replay = await create(original);
        assert.equal(replay.status, 200);
        assert.equal(replay.body.data.id, saved.body.data.id);
        assert.equal(replay.body.data.price, 125000);
      }
      const confirmed = { ...booking(), expectedUnitPrice: 100000 };
      assert.equal((await create(confirmed)).body.data.price, 100000);
      const mismatch = await create({ ...confirmed, expectedUnitPrice: 125000 });
      assert.equal(mismatch.status, 409);
      assert.equal(mismatch.body.error.code, 'REQUEST_KEY_REUSED');
      await pool.execute('UPDATE services SET base_price=125000 WHERE id=?', [fixture.serviceId]);
    });
    await t.test('new bookings reject missing/invalid confirmations and off-slot times before any write', async () => {
      const before = (await request('/orders')).body.data.total;
      for (const expectedUnitPrice of [undefined, null, '125000', -1, 0.001, 10000000000]) assert.equal((await create({ ...booking(), expectedUnitPrice })).status, 400);
      const night = date.toISOString().slice(0, 10) + 'T02:15:00+07:00';
      assert.equal((await create({ ...booking(), scheduledAt: night })).status, 400);
      assert.equal((await request('/orders')).body.data.total, before);
      const lowerPrice = await create({ ...booking(), expectedUnitPrice: 1 });
      assert.equal(lowerPrice.status, 409);
    });
    await t.test('legacy booking replays without a new price or current slot, but cannot create a new booking that way', async () => {
      const input = booking(); delete input.expectedUnitPrice;
      input.scheduledAt = date.toISOString().slice(0, 10) + 'T02:15:00+07:00';
      const service = (await request('/catalog/services/' + fixture.serviceId)).body.data;
      const saved = await orderRepository(pool).create(customerId, input, service, fixture.branchId);
      await fixture.recordOrder(saved.id);
      assert.equal((await create(input)).body.data.id, saved.id);
      assert.equal((await create({ ...input, requestKey: randomUUID() })).status, 400);
    });
    await t.test('changed product prices never reserve inventory; new confirmation works and failed keys stay terminal', async () => {
      const before = await stock();
      for (const price of [84000, 21000]) {
        const input = purchase();
        await pool.execute('UPDATE products SET price=? WHERE id=?', [price, fixture.productId]);
        const rejected = await buy(input);
        assert.equal(rejected.body.data.status, 'failed');
        assert.equal(rejected.body.data.errorCode, 'PRICE_CHANGED');
        assert.equal(await stock(), before);
        assert.equal((await buy(input)).body.data.id, rejected.body.data.id);
        assert.equal((await request('/product-orders/' + rejected.body.data.id + '/retry', {})).body.data.status, 'failed');
      }
      const input = purchase(); input.items[0].expectedUnitPrice = 21000;
      const saved = await buy(input);
      assert.equal(saved.body.data.status, 'pending');
      assert.equal(saved.body.data.total, 21000);
      await pool.execute('UPDATE products SET price=42000 WHERE id=?', [fixture.productId]);
      assert.equal((await buy(input)).body.data.total, 21000);
      assert.equal((await buy({ ...input, items: purchase().items })).body.error.code, 'REQUEST_KEY_REUSED');
      const missing = purchase(); delete missing.items[0].expectedUnitPrice;
      assert.equal((await buy(missing)).status, 400);
      assert.equal(await stock(), before + 1);
    });
    await t.test('legacy product journals recover known reservations and fail safely when no confirmed price exists', async () => {
      for (const known of [false, true]) {
        const input = purchase();
        const journal = await orderRepository(pool).createProductOrder(customerId, input);
        await fixture.recordProductOrder(journal.id);
        if (known) await catalogRepository(pool).reserveProducts({ operationKey: 'purchase-' + journal.id, customerId, items: input.items });
        const oldItems = input.items.map(({ productId, quantity }) => ({ productId, quantity }));
        const hash = createHash('sha256').update(JSON.stringify({ contact, items: oldItems })).digest('hex');
        await pool.execute('UPDATE product_orders SET items_request=?,request_hash=?,payment_method=NULL WHERE id=? AND customer_id=?', [JSON.stringify(oldItems), hash, journal.id, customerId]);
        const before = await stock();
        const recovered = await buy({ ...input, items: oldItems, paymentMethod: undefined });
        assert.equal(recovered.body.data.status, known ? 'pending' : 'failed');
        if (!known) assert.equal(recovered.body.data.errorCode, 'PRICE_CONFIRMATION_REQUIRED');
        assert.equal(await stock(), before);
      }
    });
  } finally {
    if (stack) await stack.close();
    try { if (fixture) await fixture.cleanup(); } finally { await pool.end(); }
  }
});
