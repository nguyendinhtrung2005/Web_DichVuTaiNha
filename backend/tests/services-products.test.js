import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createApp as createCatalogApp } from '../service-service/src/app.js';
import { createRepository as createCatalogRepository } from '../service-service/src/repository.js';
import { createApp as createOrderApp, createProductInput, reconcileProductPurchase } from '../order-service/src/app.js';
import { createRepository as createOrderRepository } from '../order-service/src/repository.js';
import { legacyGroup, legacyCleaningType, normalized, legacyGroupSql, legacyCleaningTypeSql } from '../service-service/src/service-taxonomy.js';
import { HttpError, closeServer, listen } from '../shared/http.js';

const config = {
  origin: 'http://localhost:3001',
  tokens: { order: randomBytes(32).toString('hex') },
};

test('service DTO uses explicit taxonomy metadata and preserves legacy category identifiers', async () => {
  const calls = [];
  const pool = {
    async execute(sql, values) {
      calls.push({ sql, values });
      if (sql.includes('information_schema.columns')) return [[{ present: 1 }]];
      if (sql.startsWith('SELECT COUNT(*)')) return [[{ total: 1 }]];
      throw new Error('Unexpected execute query');
    },
    async query(sql, values) {
      calls.push({ sql, values });
      return [[{
        id: '17', category_id: '3', category_name: 'Vệ sinh nhà ở', name: 'Vệ sinh phòng trọ',
        description: 'Làm sạch phòng trọ.', unit: 'phòng', base_price: '150000.00',
        duration_minutes: 60, is_active: 1,
        customer_config: { version: 1, group: 've-sinh', cleaningType: 'phong-tro', pricingMode: 'survey',
          scope: ['Phòng trọ'], included: ['Lau sàn'], excluded: ['Giặt rèm'], minQuantity: 1, defaultQuantity: 1 },
      }]];
    },
  };
  const result = await createCatalogRepository(pool).list({ q: '', page: 1, limit: 10, group: 've-sinh', cleaningType: 'phong-tro' });
  assert.equal(result.items[0].id, '17');
  assert.equal(result.items[0].slug, '17');
  assert.equal(result.items[0].category, '3');
  assert.equal(result.items[0].groupName, 'Vệ sinh');
  assert.equal(result.items[0].cleaningType, 'phong-tro');
  assert.equal(result.items[0].pricingMode, 'survey');
  assert.deepEqual(result.items[0].scope, ['Phòng trọ']);
  assert.ok(calls.some(({ sql, values }) => sql.includes('JSON_EXTRACT(s.customer_config') && values.includes('ve-sinh') && values.includes('phong-tro')));
});

test('legacy catalog can list services before optional metadata migration without rewriting ids', async () => {
  const pool = {
    async execute(sql) {
      if (sql.includes('information_schema.columns')) return [[{ present: 0 }]];
      if (sql.startsWith('SELECT COUNT(*)')) return [[{ total: 1 }]];
      throw new Error('Unexpected query');
    },
    async query(sql) {
      assert.ok(sql.includes('NULL AS customer_config'));
      return [[{
        id: '8', category_id: '4', category_name: 'Vệ sinh thiết bị', name: 'Vệ sinh máy lạnh',
        description: 'Làm sạch thiết bị.', unit: 'máy', base_price: '180000.00',
        duration_minutes: 60, is_active: 1,
      }]];
    },
  };
  const result = await createCatalogRepository(pool).list({ page: 1, limit: 10 });
  assert.equal(result.items[0].id, '8');
  assert.equal(result.items[0].category, '4');
  assert.equal(result.items[0].group, 'bao-duong');
  assert.deepEqual(result.items[0].included, []);
});

test('Catalog exposes taxonomy and products while protecting reservation endpoints', async (t) => {
  const calls = [];
  const repository = {
    async list(input) { calls.push(input); return { items: [], total: 0, page: input.page, limit: input.limit }; },
    async productCategories() { return [{ id: '2', name: 'Chăm sóc nhà cửa' }]; },
    async listProducts(input) { calls.push(input); return { items: [], total: 0, page: input.page, limit: input.limit }; },
    async reserveProducts(input) { calls.push(input); return { operationKey: input.operationKey, customerId: input.customerId, items: [], total: 0, status: 'reserved' }; },
  };
  const server = await listen(createCatalogApp({ repository, config }), 0);
  t.after(() => closeServer(server));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = (path) => fetch(`${base}${path}`).then(async (response) => ({ status: response.status, body: await response.json() }));
  const filtered = await get('/api/v1/catalog/services?group=ve-sinh&cleaningType=nha-gia-dinh');
  assert.equal(filtered.status, 200);
  assert.equal(calls[0].group, 've-sinh');
  assert.equal(calls[0].cleaningType, 'nha-gia-dinh');
  assert.equal((await get('/api/v1/catalog/services?group=unknown')).status, 400);
  assert.equal((await get('/api/v1/catalog/services?group=cham-soc&cleaningType=nha-gia-dinh')).status, 400);
  assert.equal((await get('/api/v1/catalog/product-categories')).body.data[0].id, '2');
  assert.equal((await get('/api/v1/catalog/products?serviceId=4')).status, 200);
  assert.equal((await get('/internal/v1/product-reservations/purchase-10')).status, 403);

  const reservation = await fetch(`${base}/internal/v1/product-reservations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-caller': 'order', 'x-internal-token': config.tokens.order },
    body: JSON.stringify({ operationKey: 'purchase-10', customerId: '4', items: [{ productId: '2', quantity: 1 }, { productId: '2', quantity: 2 }] }),
  });
  assert.equal(reservation.status, 400);
});

test('Catalog inventory reservation uses database price and rejects overselling', async () => {
  let reserved = 0;
  let record = null;
  let rollbacks = 0;
  const connection = {
    async beginTransaction() {},
    async commit() {},
    async rollback() { rollbacks += 1; },
    release() {},
    async execute(sql, values) {
      if (sql.includes('GET_LOCK')) return [[{ acquired: '1' }]];
      if (sql.includes('RELEASE_LOCK')) return [[{ released: '1' }]];
      if (sql.includes('FROM product_stock_reservations WHERE operation_key')) return [record?.operation_key === values[0] ? [record] : []];
      if (sql.includes('FROM products p')) return [[{
        id: '5', category_id: '2', name: 'Dung dịch lau nhà', unit: 'chai',
        price: '42000.00', product_status: 'AVAILABLE', category_active: 1,
        quantity: 3, reserved_quantity: reserved,
      }]];
      if (sql.startsWith('UPDATE product_inventory')) {
        reserved += values[0];
        return [{ affectedRows: 1 }];
      }
      if (sql.includes('INSERT INTO product_stock_reservations')) {
        record = {
          operation_key: values[0], customer_id: values[1], request_hash: values[2],
          items_snapshot: values[3], total_amount: values[4], status: 'RESERVED',
        };
        return [{ insertId: '1' }];
      }
      throw new Error(`Unexpected SQL in reservation test: ${sql}`);
    },
  };
  const repository = createCatalogRepository({
    async execute(sql) {
      if (sql.includes('information_schema.tables')) return [[{ present: 2 }]];
      throw new Error('Unexpected pool query');
    },
    async getConnection() { return connection; },
  });
  const first = await repository.reserveProducts({
    operationKey: 'purchase-30', customerId: '9', items: [{ productId: '5', quantity: 2 }],
  });
  assert.equal(first.total, 84000);
  assert.equal(first.items[0].unitPrice, 42000);
  assert.equal(reserved, 2);
  const repeated = await repository.reserveProducts({
    operationKey: 'purchase-30', customerId: '9', items: [{ productId: '5', quantity: 2 }],
  });
  assert.equal(repeated.total, 84000);
  assert.equal(reserved, 2, 'Same operation does not reserve stock twice.');
  await assert.rejects(repository.reserveProducts({
    operationKey: 'purchase-30', customerId: '9', items: [{ productId: '5', quantity: 1 }],
  }), (error) => error.code === 'RESERVATION_KEY_REUSED' && error.status === 409);
  await assert.rejects(repository.reserveProducts({
    operationKey: 'purchase-31', customerId: '9', items: [{ productId: '5', quantity: 2 }],
  }), (error) => error instanceof HttpError && error.status === 409 && error.code === 'OUT_OF_STOCK');
  assert.equal(reserved, 2);
  assert.equal(rollbacks, 2);
});

test('product-order input has no service schedule, rejects client prices, duplicate items and invalid quantities', () => {
  const valid = {
    requestKey: '7ac2b220-95c7-4a2d-b184-322b1f76d9b8',
    items: [{ productId: '3', quantity: 2 }],
    contact: { name: 'Khách hàng', phone: '0391234567' },
  };
  assert.deepEqual(createProductInput(valid), valid);
  for (const invalidInput of [
    { ...valid, scheduledAt: new Date().toISOString() },
    { ...valid, price: 1 },
    { ...valid, items: [{ productId: '3', quantity: 1.5 }] },
    { ...valid, items: [{ productId: '3', quantity: 1 }, { productId: '3', quantity: 2 }] },
    { ...valid, contact: { ...valid.contact, address: 'a' } },
  ]) {
    assert.throws(() => createProductInput(invalidInput), (error) => error instanceof HttpError && error.status === 400);
  }
});

test('product-order reads require a customer session before reaching the repository', async (t) => {
  let listCalls = 0;
  const repository = {
    async listProductOrders() { listCalls += 1; return { items: [], total: 0, page: 1, limit: 100 }; },
  };
  const server = await listen(createOrderApp({
    repository,
    config: { ...config, cookieName: 'cleanhome_customer_session', urls: {} },
  }), 0);
  t.after(() => closeServer(server));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/product-orders`);
  assert.equal(response.status, 401);
  assert.equal(listCalls, 0);
});

test('legacy service taxonomy matches category and service names without changing stored identifiers', () => {
  assert.equal(normalized('  Chăm-sóc_ĐỊNH KỲ '), ' cham soc dinh ky ');
  assert.equal(legacyGroup('Nhóm khác', 'Bảo dưỡng máy lạnh'), 'bao-duong');
  assert.equal(legacyGroup('Vệ sinh thiết bị', 'Chăm sóc cây'), 'cham-soc');
  assert.equal(legacyGroup('Vệ sinh phòng trọ', 'Theo giờ'), 've-sinh');
  assert.equal(legacyCleaningType('Vệ sinh phòng trọ', 'Theo giờ', 've-sinh'), 'phong-tro');
  assert.equal(legacyCleaningType('Dịch vụ', 'Vệ sinh nhà ở gia đình', 've-sinh'), 'nha-gia-dinh');
  assert.equal(legacyCleaningType('Dịch vụ', 'Bảo dưỡng thiết bị phòng trọ', 'bao-duong'), undefined);
  for (const expression of [legacyGroupSql, legacyCleaningTypeSql]) {
    assert.ok(expression.includes("CONCAT_WS(' ', c.name, s.name)") && expression.includes('COLLATE utf8mb4_unicode_ci'));
  }
});

function servicePool(customerConfig) {
  return {
    async execute(sql) { return sql.includes('information_schema.columns') ? [[{ present: 1 }]] : [[{ total: 1 }]]; },
    async query() {
      return [[{ id: '9', category_id: '8', category_name: 'Dịch vụ', name: 'Vệ sinh phòng trọ',
        description: 'Làm sạch theo yêu cầu.', unit: 'm²', base_price: '125000.50', duration_minutes: 60,
        is_active: 1, customer_config: customerConfig }]];
    },
  };
}

test('service metadata accepts bounded fractional quantities and rejects misleading or invalid metadata', async () => {
  const valid = { version: 1, group: 've-sinh', minQuantity: 1.25, defaultQuantity: 2.5, baseMinutes: 15, pricingMode: 'survey' };
  const [service] = (await createCatalogRepository(servicePool(valid)).list({ page: 1, limit: 10 })).items;
  assert.equal(service.minQuantity, 1.25);
  assert.equal(service.defaultQuantity, 2.5);
  assert.equal(service.pricingMode, 'survey');
  assert.equal(service.minimumQuantityKnown, true);
  for (const patch of [
    { group: 'unknown' }, { minQuantity: null }, { minQuantity: 1.001 }, { defaultQuantity: 1 },
    { baseMinutes: -1 }, { pricingMode: null }, { pricingMode: 'paid' },
    { group: 'cham-soc', cleaningType: 'phong-tro' }, { scope: ['Lau sàn', 1] },
  ]) {
    await assert.rejects(createCatalogRepository(servicePool({ ...valid, ...patch })).list({ page: 1, limit: 10 }),
      (error) => error.status === 503 && error.code === 'INVALID_CATALOG_DATA');
  }
});

test('Catalog readiness recovers after unavailable database and unapplied schema, checking only Catalog-owned tables', async () => {
  let checks = 0;
  const repository = createCatalogRepository({
    async execute(sql) {
      if (sql.includes('information_schema.tables')) {
        checks += 1;
        assert.ok(!sql.includes("'product_orders'") && !sql.includes("'product_order_items'"));
        if (checks === 1) throw new Error('synthetic database offline');
        return [[{ present: checks === 2 ? 0 : 2 }]];
      }
      return [[]];
    },
  });
  await assert.rejects(repository.productCategories(), /synthetic database offline/);
  await assert.rejects(repository.productCategories(), (error) => error.code === 'PRODUCT_SCHEMA_NOT_READY');
  assert.deepEqual(await repository.productCategories(), []);
  assert.equal(checks, 3);
});

test('service metadata readiness retries after a transient query error and a missing optional column', async () => {
  let checks = 0;
  const selects = [];
  const repository = createCatalogRepository({
    async execute(sql) {
      if (sql.includes('information_schema.columns')) {
        checks += 1;
        if (checks === 1) throw new Error('synthetic metadata timeout');
        return [[{ present: checks > 2 ? 1 : 0 }]];
      }
      return [[{ total: 0 }]];
    },
    async query(sql) { selects.push(sql); return [[]]; },
  });
  await assert.rejects(repository.list({ page: 1, limit: 10 }), /synthetic metadata timeout/);
  await repository.list({ page: 1, limit: 10 });
  await repository.list({ page: 1, limit: 10 });
  assert.ok(selects[0].includes('NULL AS customer_config'));
  assert.ok(selects[1].includes('s.customer_config'));
});

test('Order product-schema readiness recovers without restarting its process', async () => {
  let checks = 0;
  const repository = createOrderRepository({
    async execute(sql) {
      if (sql.includes('information_schema.tables')) {
        checks += 1;
        if (checks === 1) throw new Error('synthetic database offline');
        return [[{ present: checks === 2 ? 0 : 2 }]];
      }
      return [[{ total: 0 }]];
    },
    async query() { return [[]]; },
  });
  await assert.rejects(repository.listProductOrders('1', { page: 1, limit: 10 }), /synthetic database offline/);
  await assert.rejects(repository.listProductOrders('1', { page: 1, limit: 10 }), (error) => error.code === 'PRODUCT_SCHEMA_NOT_READY');
  assert.deepEqual(await repository.listProductOrders('1', { page: 1, limit: 10 }), { items: [], total: 0, page: 1, limit: 10 });
});

const purchase = () => ({ id: '7', customerId: '2', status: 'processing', items: [{ productId: '5', quantity: 1 }] });
const stockReservation = () => ({
  operationKey: 'purchase-7', customerId: '2', status: 'reserved', total: 42000,
  items: [{ productId: '5', quantity: 1, code: 'SP5', name: 'Dung dịch lau nhà', unit: 'chai', unitPrice: 42000 }],
});

test('product-order recovery returns known committed state after a lost completion acknowledgement', async () => {
  let current = purchase();
  const result = await reconcileProductPurchase({
    order: current,
    request: async () => stockReservation(),
    repository: {
      async completeProductOrder() { current = { ...current, status: 'pending', total: 42000 }; throw new Error('synthetic lost commit acknowledgement'); },
      async getProductOrder() { return current; },
      async failProductOrder() { throw new Error('Committed reservation must not be failed.'); },
    },
  });
  assert.equal(result.status, 200);
  assert.equal(result.data.status, 'pending');
});

test('ambiguous reservation stays processing and explicit retry uses the existing reservation, never release', async () => {
  let reserved = false, reserveCalls = 0, releases = 0, completions = 0;
  let current = purchase();
  const request = async (target, path, options) => {
    if (path.endsWith('/release')) { releases += 1; throw new Error('Must not release an ambiguous operation.'); }
    if (options?.method === 'POST') {
      reserveCalls += 1; reserved = true;
      throw new HttpError(503, 'DEPENDENCY_UNAVAILABLE', 'Synthetic response lost after reserve commit.');
    }
    if (!reserved) throw new HttpError(404, 'RESERVATION_NOT_FOUND', 'Missing.');
    return stockReservation();
  };
  const repository = {
    async getProductOrder() { return current; },
    async completeProductOrder() { completions += 1; current = { ...current, status: 'pending' }; return current; },
    async failProductOrder() { throw new Error('Ambiguous reservation must stay recoverable.'); },
  };
  const first = await reconcileProductPurchase({ order: current, repository, request });
  assert.equal(first.status, 202);
  assert.equal(first.data.status, 'processing');
  const retried = await reconcileProductPurchase({ order: current, repository, request });
  assert.equal(retried.data.status, 'pending');
  assert.equal(reserveCalls, 1);
  assert.equal(completions, 1);
  assert.equal(releases, 0);
});

test('a definitive stock rejection becomes an explicit FAILED order only after confirming no reservation exists', async () => {
  let current = purchase(), reads = 0;
  const result = await reconcileProductPurchase({
    order: current,
    request: async (target, path, options) => {
      if (options?.method === 'POST') throw new HttpError(409, 'OUT_OF_STOCK', 'Synthetic sold out.');
      reads += 1;
      throw new HttpError(404, 'RESERVATION_NOT_FOUND', 'Missing.');
    },
    repository: {
      async getProductOrder() { return current; },
      async failProductOrder(customerId, orderId, code) { current = { ...current, status: 'failed', errorCode: code }; return current; },
    },
  });
  assert.equal(result.data.status, 'failed');
  assert.equal(result.data.errorCode, 'OUT_OF_STOCK');
  assert.equal(reads, 2);
});

test('concurrent reservation success wins over an earlier business rejection during reconciliation', async () => {
  let reads = 0, completed = 0;
  const order = purchase();
  const result = await reconcileProductPurchase({
    order,
    request: async (target, path, options) => {
      if (options?.method === 'POST') throw new HttpError(409, 'OUT_OF_STOCK', 'Earlier competing request.');
      reads += 1;
      if (reads === 1) throw new HttpError(404, 'RESERVATION_NOT_FOUND', 'Before concurrent commit.');
      return stockReservation();
    },
    repository: {
      async getProductOrder() { return order; },
      async completeProductOrder() { completed += 1; return { ...order, status: 'pending' }; },
      async failProductOrder() { throw new Error('Must not fail a known committed reservation.'); },
    },
  });
  assert.equal(result.data.status, 'pending');
  assert.equal(completed, 1);
});

test('journal unique-key recovery reuses its held connection instead of waiting for a second pool slot', async () => {
  let existing = null, acquired = 0, released = 0, unlocked = 0;
  const connection = {
    async beginTransaction() {}, async commit() {}, async rollback() {},
    release() { released += 1; },
    async execute(sql, values) {
      if (sql.includes('GET_LOCK')) return [[{ acquired: '1' }]];
      if (sql.includes('RELEASE_LOCK')) { unlocked += 1; return [[{ released: '1' }]]; }
      if (sql.includes('SELECT id, request_hash')) return [existing ? [{ id: existing.id, request_hash: existing.request_hash }] : []];
      if (sql.includes('INSERT INTO product_orders')) {
        existing = { id: '7', customer_id: values[0], request_key: values[1], request_hash: values[2],
          items_request: values[3], contact_snapshot: values[4], status: 'PROCESSING', total_amount: null,
          created_at: new Date(), updated_at: new Date(), error_code: null };
        throw Object.assign(new Error('Synthetic competing unique insert.'), { code: 'ER_DUP_ENTRY' });
      }
      if (sql.includes('FROM product_orders WHERE customer_id')) return [[existing]];
      if (sql.includes('FROM product_order_items')) return [[]];
      throw new Error('Unexpected journal test query.');
    },
  };
  const repository = createOrderRepository({
    async execute(sql) {
      if (sql.includes('information_schema.tables')) return [[{ present: 2 }]];
      throw new Error('Recovery must not acquire a second connection through pool.execute.');
    },
    async getConnection() { acquired += 1; return connection; },
  });
  const order = await repository.createProductOrder('2', {
    requestKey: '7ac2b220-95c7-4a2d-b184-322b1f76d9b8',
    items: [{ productId: '5', quantity: 1 }], contact: { name: 'Synthetic customer', phone: '0391234567' },
  });
  assert.equal(order.id, '7');
  assert.equal(order.status, 'processing');
  assert.equal(acquired, 1);
  assert.equal(released, 1);
  assert.equal(unlocked, 1);
});

test('one owned order operation excludes a concurrent reserve while an earlier business rejection is being finalized', async () => {
  let current = purchase(), locked = false, posts = 0, reserved = false;
  const loan = {};
  let enter, resume;
  const entered = new Promise((resolve) => { enter = resolve; });
  const blocked = new Promise((resolve) => { resume = resolve; });
  const repository = {
    async withProductOrderOperation(customerId, orderId, operation) {
      if (locked) throw new HttpError(503, 'PRODUCT_ORDER_BUSY', 'Another reconciliation is active.');
      locked = true;
      try { return await operation(loan); } finally { locked = false; }
    },
    async getProductOrder(customerId, orderId, connection) {
      if (connection) assert.equal(connection, loan);
      return current;
    },
    async failProductOrder(customerId, orderId, code, connection) {
      assert.equal(connection, loan);
      assert.equal(reserved, false, 'No competing reservation may commit before this FAILED decision.');
      current = { ...current, status: 'failed', errorCode: code };
      return current;
    },
    async completeProductOrder(customerId, orderId, reservation, connection) {
      assert.equal(connection, loan);
      current = { ...current, status: 'pending' }; return current;
    },
  };
  const request = async (target, path, options) => {
    if (options?.method === 'POST') {
      posts += 1;
      if (posts === 1) { enter(); await blocked; throw new HttpError(409, 'OUT_OF_STOCK', 'Earlier sold-out observation.'); }
      reserved = true; return stockReservation();
    }
    if (!reserved) throw new HttpError(404, 'RESERVATION_NOT_FOUND', 'Missing.');
    return stockReservation();
  };
  const first = reconcileProductPurchase({ order: purchase(), repository, request });
  await entered;
  const concurrent = await reconcileProductPurchase({ order: purchase(), repository, request });
  assert.equal(concurrent.status, 202);
  assert.equal(concurrent.data.status, 'processing');
  assert.equal(posts, 1);
  resume();
  assert.equal((await first).data.status, 'failed');
  assert.equal(reserved, false);
  // An explicit retry starts a new attempt on this same durable order.
  current = { ...current, status: 'processing', errorCode: undefined };
  const retried = await reconcileProductPurchase({ order: current, repository, request });
  assert.equal(retried.data.status, 'pending');
  assert.equal(posts, 2);
});

test('operation-scoped Order reads and writes reuse one loaned pool connection and release it once', async () => {
  let leased = false, acquired = 0, released = 0, unlocked = 0;
  const row = { id: '7', customer_id: '2', request_key: '7ac2b220-95c7-4a2d-b184-322b1f76d9b8',
    items_request: JSON.stringify([{ productId: '5', quantity: 1 }]),
    contact_snapshot: JSON.stringify({ name: 'Synthetic customer', phone: '0391234567' }),
    status: 'PROCESSING', total_amount: null, error_code: null, created_at: new Date(), updated_at: new Date() };
  const connection = {
    async beginTransaction() {}, async commit() {}, async rollback() {},
    release() { assert.equal(leased, true); leased = false; released += 1; },
    async execute(sql, values) {
      if (sql.includes('GET_LOCK')) { assert.equal(values[0], 'product-reconcile'); assert.equal(values[3], 0); return [[{ acquired: '1' }]]; }
      if (sql.includes('RELEASE_LOCK')) { unlocked += 1; return [[{ released: '1' }]]; }
      if (sql.includes('UPDATE product_orders')) { row.status = 'FAILED'; row.error_code = values[0]; return [{ affectedRows: 1 }]; }
      if (sql.includes('FROM product_orders WHERE customer_id')) return [[{ ...row }]];
      if (sql.includes('FROM product_order_items')) return [[]];
      throw new Error('Unexpected loaned-connection query.');
    },
  };
  const repository = createOrderRepository({
    async execute(sql) {
      assert.equal(leased, false, 'A nested pool query would self-deadlock with pool size 1.');
      assert.ok(sql.includes('information_schema.tables')); return [[{ present: 2 }]];
    },
    async getConnection() {
      assert.equal(leased, false, 'A nested acquisition would self-deadlock with pool size 1.');
      leased = true; acquired += 1; return connection;
    },
  });
  const result = await repository.withProductOrderOperation('2', '7', async (loaned) => {
    assert.equal((await repository.getProductOrder('2', '7', loaned)).status, 'processing');
    const failed = await repository.failProductOrder('2', '7', 'OUT_OF_STOCK', loaned);
    assert.equal(leased, true, 'Nested writes must not release their loaned connection.');
    return failed;
  });
  assert.equal(result.status, 'failed');
  assert.equal(acquired, 1); assert.equal(released, 1); assert.equal(unlocked, 1);
});

test('an uncertain operation unlock destroys its session and a busy lock never invokes reconciliation', async () => {
  for (const mode of ['unlock-failed', 'busy']) {
    let destroyed = 0, released = 0, calls = 0;
    const repository = createOrderRepository({
      async execute() { return [[{ present: 2 }]]; },
      async getConnection() { return {
        async execute(sql) {
          if (sql.includes('GET_LOCK')) return [[{ acquired: mode === 'busy' ? '0' : '1' }]];
          throw new Error('Synthetic lost unlock acknowledgement.');
        },
        destroy() { destroyed += 1; }, release() { released += 1; },
      }; },
    });
    const run = () => repository.withProductOrderOperation('2', '7', async () => { calls += 1; return 'known result'; });
    if (mode === 'busy') {
      await assert.rejects(run(), (error) => error.code === 'PRODUCT_ORDER_BUSY');
      assert.equal(calls, 0); assert.equal(released, 1); assert.equal(destroyed, 0);
    } else {
      assert.equal(await run(), 'known result');
      assert.equal(calls, 1); assert.equal(released, 0); assert.equal(destroyed, 1);
    }
  }
});
