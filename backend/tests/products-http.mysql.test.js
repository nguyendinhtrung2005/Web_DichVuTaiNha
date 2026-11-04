import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createMysqlPool } from '../shared/mysql-pool.js';
import { createProductFixtures } from '../scripts/product-fixtures.js';
import { createRepository as createOrderRepository } from '../order-service/src/repository.js';
import { HttpError, listen, closeServer } from '../shared/http.js';

const origin = 'http://localhost:3001';
const enabled = process.env.ALLOW_CUSTOMER_DB_TEST === '1';

test('Services/products via real HTTP services and approved MySQL fixtures', { skip: !enabled && 'Requires approved fixture target and ALLOW_CUSTOMER_DB_TEST=1.', timeout: 180000 }, async (t) => {
  const { startCustomerStack } = await import('../scripts/customer-runtime.js');
  const pool = createMysqlPool();
  let fixture, stack;
  let throwAfterComplete = false, throwAfterCreate = false;
  try {
    fixture = await createProductFixtures(pool);
    const orderRepository = createOrderRepository(pool);
    const repository = {
      ...orderRepository,
      async completeProductOrder(...args) {
        const result = await orderRepository.completeProductOrder(...args);
        if (throwAfterComplete) { throwAfterComplete = false; throw new HttpError(503, 'TEST_LOST_COMMIT_RESPONSE', 'Synthetic lost commit response.'); }
        return result;
      },
      async createProductOrder(...args) {
        let result;
        try { result = await orderRepository.createProductOrder(...args); }
        catch (error) { if (/^(ER_|PROTOCOL_|ECONN)/.test(error.code || '')) process.stderr.write('Synthetic HTTP test create-journal error code: ' + error.code + '\n'); throw error; }
        if (throwAfterCreate) { throwAfterCreate = false; throw new HttpError(503, 'TEST_LOST_CREATE_RESPONSE', 'Synthetic lost create response.'); }
        return result;
      },
    };
    stack = await startCustomerStack({
      env: { ...process.env, NODE_ENV: 'test' },
      ports: { auth: 0, user: 0, catalog: 0, order: 0, staff: 0, payment: 0, review: 0, gateway: 0 },
      repositories: { order: repository },
      configOverrides: { origin, defaultBranchId: fixture.branchId },
    });
    const request = async (method, route, body, cookie) => {
      const response = await fetch(stack.urls.gateway + '/api/v1' + route, {
        method, headers: { origin, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
    };
    const account = fixture.account('Products'), other = fixture.account('OtherProducts');
    let cookie, otherCookie, userId, otherId;
    const contact = { name: fixture.marker + ' Purchase contact', phone: account.phone, note: 'Synthetic test; no shipment/payment.' };
    const purchase = (productId = fixture.productId, quantity = 1, requestKey = randomUUID()) => ({ requestKey, items: [{ productId, quantity }], contact });
    const stock = async (productId) => {
      const [rows] = await pool.execute('SELECT quantity,reserved_quantity FROM product_inventory WHERE product_id=?', [productId]);
      return { quantity: Number(rows[0].quantity), reserved: Number(rows[0].reserved_quantity) };
    };
    const ownedCount = async (table) => {
      const [rows] = await pool.execute('SELECT COUNT(*) AS total FROM ' + table + ' WHERE customer_id=?', [userId]);
      return Number(rows[0].total);
    };
    const remember = async (result) => {
      if (result.body?.data?.id) await fixture.recordProductOrder(result.body.data.id);
      return result;
    };

    await t.test('taxonomy and cleaning filters agree with metadata and legacy DTOs without ID changes', async () => {
      for (const [group, expected] of [
        ['ve-sinh', [fixture.roomServiceId, fixture.houseServiceId, fixture.legacyRoomServiceId]],
        ['cham-soc', [fixture.careServiceId]],
        ['bao-duong', [fixture.maintenanceServiceId, fixture.legacyMaintenanceServiceId]],
      ]) {
        const result = await request('GET', '/catalog/services?q=' + encodeURIComponent(fixture.marker) + '&group=' + group);
        assert.equal(result.status, 200);
        for (const id of expected) assert.ok(result.body.data.items.some((item) => item.id === id && item.group === group), 'Missing service in its classified group.');
        assert.ok(result.body.data.items.every((item) => item.group === group));
      }
      const rooms = await request('GET', '/catalog/services?q=' + encodeURIComponent(fixture.marker) + '&group=ve-sinh&cleaningType=phong-tro');
      assert.equal(rooms.status, 200);
      assert.ok(rooms.body.data.items.some((item) => item.id === fixture.roomServiceId));
      assert.ok(rooms.body.data.items.some((item) => item.id === fixture.legacyRoomServiceId), 'Legacy category-based room type must also match the filter.');
      assert.ok(rooms.body.data.items.every((item) => item.cleaningType === 'phong-tro'));
      const detail = await request('GET', '/catalog/services/' + fixture.roomServiceId);
      assert.equal(detail.body.data.slug, fixture.roomServiceId);
      assert.equal(detail.body.data.pricingMode, 'survey');
      assert.deepEqual(detail.body.data.scope, ['Phạm vi fixture đã xác nhận']);
      assert.deepEqual(detail.body.data.included, ['Làm sạch bề mặt']);
      assert.deepEqual(detail.body.data.excluded, ['Hạng mục ngoài phạm vi']);
    });
    await t.test('public product browsing, search, category, related suggestions and explicit unavailable states', async () => {
      const products = await request('GET', '/catalog/products?q=' + encodeURIComponent(fixture.marker));
      assert.equal(products.status, 200);
      assert.ok(products.body.data.items.some((item) => item.id === fixture.productId && item.stock === 8 && item.price === 42000));
      const categories = await request('GET', '/catalog/product-categories');
      assert.ok(categories.body.data.some((item) => item.id === fixture.productCategoryId));
      const related = await request('GET', '/catalog/products?serviceId=' + fixture.roomServiceId);
      assert.deepEqual(related.body.data.items.map((item) => item.id), [fixture.productId]);
      assert.ok(related.body.data.items[0].relatedServiceIds.includes(fixture.roomServiceId));
      const unrelated = await request('GET', '/catalog/products?serviceId=' + fixture.careServiceId);
      assert.equal(unrelated.body.data.total, 0);
      assert.equal((await request('GET', '/catalog/products/' + fixture.outOfStockProductId)).body.data.status, 'out_of_stock');
      assert.equal((await request('GET', '/catalog/products/' + fixture.inactiveProductId)).body.data.status, 'inactive');
      assert.equal((await stock(fixture.productId)).reserved, 0, 'Viewing suggestions must never reserve or add products.');
    });
    await t.test('guest checkout/orders and internal reservation access are denied', async () => {
      assert.equal((await request('POST', '/product-orders', purchase())).status, 401);
      assert.equal((await request('GET', '/product-orders')).status, 401);
      const internal = await fetch(stack.urls.catalog + '/internal/v1/product-reservations/purchase-1');
      assert.equal(internal.status, 403);
    });
    await t.test('authenticated customers are isolated', async () => {
      const first = await request('POST', '/auth/register', account);
      assert.equal(first.status, 201);
      userId = first.body.data.id; cookie = first.cookie; await fixture.record('users', userId);
      const second = await request('POST', '/auth/register', other);
      assert.equal(second.status, 201);
      otherId = second.body.data.id; otherCookie = second.cookie; await fixture.record('users', otherId);
      assert.notEqual(userId, otherId);
    });
    assert.ok(cookie && otherCookie && userId);
    let completedPurchase;
    await t.test('product checkout needs no service/schedule and uses authoritative price snapshots', async () => {
      const bookingsBefore = await ownedCount('bookings');
      const result = await remember(await request('POST', '/product-orders', purchase(fixture.productId, 2), cookie));
      assert.equal(result.status, 200);
      assert.equal(result.body.data.status, 'pending');
      assert.equal(result.body.data.total, 84000);
      assert.equal(result.body.data.items[0].unitPrice, 42000);
      assert.equal(result.body.data.items[0].quantity, 2);
      assert.equal('scheduledAt' in result.body.data, false);
      assert.equal('serviceId' in result.body.data, false);
      assert.equal(await ownedCount('bookings'), bookingsBefore, 'Product purchase cannot create a service booking.');
      assert.equal((await stock(fixture.productId)).reserved, 2);
      completedPurchase = result.body.data;
    });
    await t.test('ownership protects product reads/retries/list', async () => {
      assert.equal((await request('GET', '/product-orders/' + completedPurchase.id, undefined, otherCookie)).status, 404);
      assert.equal((await request('POST', '/product-orders/' + completedPurchase.id + '/retry', {}, otherCookie)).status, 404);
      assert.equal((await request('GET', '/product-orders', undefined, otherCookie)).body.data.total, 0);
      assert.equal((await request('GET', '/product-orders/' + completedPurchase.id, undefined, cookie)).body.data.customerId, userId);
    });
    await t.test('strict purchase input rejects price, schedule, role, duplicates and fractional quantities before journaling', async () => {
      const before = await ownedCount('product_orders');
      const base = purchase();
      for (const body of [
        { ...base, total: 1 }, { ...base, status: 'PAID' }, { ...base, customerId: otherId },
        { ...base, scheduledAt: new Date().toISOString() }, { ...base, serviceId: fixture.roomServiceId },
        { ...base, items: [{ productId: fixture.productId, quantity: 1, unitPrice: 1 }] },
        { ...base, items: [{ productId: fixture.productId, quantity: 1 }, { productId: fixture.productId, quantity: 2 }] },
        { ...base, items: [{ productId: fixture.productId, quantity: 0.5 }] },
        { ...base, items: [{ productId: fixture.productId, quantity: -1 }] },
      ]) assert.equal((await request('POST', '/product-orders', body, cookie)).status, 400);
      assert.equal(await ownedCount('product_orders'), before);
    });
    await t.test('idempotent same-key concurrent checkouts reserve once and reject changed payload', async () => {
      const input = purchase();
      const before = await stock(fixture.productId);
      const results = await Promise.all([request('POST', '/product-orders', input, cookie), request('POST', '/product-orders', input, cookie)]);
      for (const result of results) {
        await remember(result);
        assert.ok([200, 202].includes(result.status));
        assert.ok(['pending', 'processing'].includes(result.body.data.status));
      }
      assert.equal(results[0].body.data.id, results[1].body.data.id);
      assert.equal((await request('GET', '/product-orders/' + results[0].body.data.id, undefined, cookie)).body.data.status, 'pending');
      assert.equal((await stock(fixture.productId)).reserved, before.reserved + 1);
      const changed = await request('POST', '/product-orders', { ...input, items: [{ productId: fixture.productId, quantity: 2 }] }, cookie);
      assert.equal(changed.status, 409);
    });
    await t.test('last unit cannot be oversold by concurrent independent customers', async () => {
      // Exercise unrelated request-key index ranges as well as the inventory row lock.
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await fixture.setAvailableStock(fixture.lastStockProductId, 1);
        const before = await stock(fixture.lastStockProductId);
        const results = await Promise.all([
          request('POST', '/product-orders', purchase(fixture.lastStockProductId), cookie),
          request('POST', '/product-orders', purchase(fixture.lastStockProductId), otherCookie),
        ]);
        for (const result of results) await remember(result);
        assert.equal(results.filter((result) => result.body.data?.status === 'pending').length, 1);
        assert.equal(results.filter((result) => result.body.data?.status === 'failed').length, 1, JSON.stringify(results.map((result) => ({ http: result.status, status: result.body.data?.status, errorCode: result.body.error?.code }))));
        const inventory = await stock(fixture.lastStockProductId);
        assert.equal(inventory.reserved, before.reserved + 1); assert.equal(inventory.quantity, inventory.reserved);
      }
    });
    await t.test('out-of-stock/inactive/mixed orders fail honestly and rollback all inventory changes', async () => {
      const before = await stock(fixture.productId);
      for (const productId of [fixture.outOfStockProductId, fixture.inactiveProductId]) {
        const result = await remember(await request('POST', '/product-orders', purchase(productId), cookie));
        assert.equal(result.body.data.status, 'failed');
        assert.ok(['OUT_OF_STOCK', 'PRODUCT_UNAVAILABLE'].includes(result.body.data.errorCode));
        assert.equal(result.body.data.total, null);
      }
      const mixed = purchase();
      mixed.items.push({ productId: fixture.outOfStockProductId, quantity: 1 });
      const result = await remember(await request('POST', '/product-orders', mixed, cookie));
      assert.equal(result.body.data.status, 'failed');
      assert.equal((await stock(fixture.productId)).reserved, before.reserved);
    });
    await t.test('catalog outage leaves a durable PROCESSING order and explicit retry reconciles once', async () => {
      const url = stack.config.urls.catalog, before = await stock(fixture.productId);
      let result;
      try {
        stack.config.urls.catalog = 'http://127.0.0.1:1';
        result = await remember(await request('POST', '/product-orders', purchase(), cookie));
      } finally { stack.config.urls.catalog = url; }
      assert.equal(result.status, 202); assert.equal(result.body.data.status, 'processing');
      assert.equal((await stock(fixture.productId)).reserved, before.reserved);
      const retry = await request('POST', '/product-orders/' + result.body.data.id + '/retry', {}, cookie);
      assert.equal(retry.status, 200); assert.equal(retry.body.data.status, 'pending');
      assert.equal((await stock(fixture.productId)).reserved, before.reserved + 1);
    });
    await t.test('lost reservation response retains inventory and retries against its operation journal', async () => {
      const real = stack.config.urls.catalog, before = await stock(fixture.productId);
      let loseResponse = true;
      const proxy = await listen(async (req, res) => {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const response = await fetch(real + req.url, { method: req.method, headers: req.headers, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) });
        const payload = await response.text();
        if (loseResponse && req.method === 'POST' && req.url === '/internal/v1/product-reservations') {
          loseResponse = false; res.writeHead(503, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { code: 'SYNTHETIC_LOST_RESPONSE', message: 'Synthetic response loss.' } }));
        } else { res.writeHead(response.status, { 'content-type': 'application/json' }); res.end(payload); }
      }, 0);
      let result;
      try {
        stack.config.urls.catalog = 'http://127.0.0.1:' + proxy.address().port;
        result = await remember(await request('POST', '/product-orders', purchase(), cookie));
      } finally { stack.config.urls.catalog = real; await closeServer(proxy); }
      assert.equal(result.status, 202); assert.equal(result.body.data.status, 'processing');
      assert.equal((await stock(fixture.productId)).reserved, before.reserved + 1);
      const retry = await request('POST', '/product-orders/' + result.body.data.id + '/retry', {}, cookie);
      assert.equal(retry.body.data.status, 'pending');
      assert.equal((await stock(fixture.productId)).reserved, before.reserved + 1);
    });
    await t.test('lost order completion response returns the already verified PENDING outcome', async () => {
      const before = await stock(fixture.productId);
      throwAfterComplete = true;
      const result = await remember(await request('POST', '/product-orders', purchase(), cookie));
      assert.equal(result.status, 200);
      assert.equal(result.body.data.status, 'pending');
      assert.equal((await stock(fixture.productId)).reserved, before.reserved + 1);
    });
    await t.test('lost journal creation response recovers with the exact original request key', async () => {
      const input = purchase();
      throwAfterCreate = true;
      const lost = await request('POST', '/product-orders', input, cookie);
      assert.equal(lost.status, 503);
      const result = await remember(await request('POST', '/product-orders', input, cookie));
      assert.equal(result.body.data.status, 'pending');
      const [rows] = await pool.execute('SELECT COUNT(*) AS total FROM product_orders WHERE customer_id=? AND request_key=?', [userId, input.requestKey]);
      assert.equal(Number(rows[0].total), 1);
    });
    await t.test('service booking remains separate and does not add optional products', async () => {
      const before = await stock(fixture.productId);
      const result = await request('POST', '/orders', {
        serviceId: fixture.roomServiceId, quantity: 1,
        contact: { name: account.name, phone: account.phone, address: fixture.marker + ' service booking address', houseType: 'can-ho', area: 30, rooms: 1, floors: 1, hasPets: false },
        scheduledAt: new Date(Date.now() + 3 * 86400000).toISOString(), specialRequest: 'Service only, no optional product.',
      }, cookie);
      assert.equal(result.status, 201);
      await fixture.recordOrder(result.body.data.id);
      assert.equal(result.body.data.price, 125000);
      assert.equal('productId' in result.body.data, false);
      assert.equal((await stock(fixture.productId)).reserved, before.reserved);
    });
  } finally {
    if (stack) await stack.close();
    try { if (fixture) await fixture.cleanup(); }
    finally { await pool.end(); }
  }
});
