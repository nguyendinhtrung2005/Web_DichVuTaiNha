import test from 'node:test';
import assert from 'node:assert/strict';
import { createRepository } from '../order-service/src/repository.js';

test('new product checkout fails closed before a write connection when payment migration is absent or incomplete, and readiness recovers', async () => {
  let columnsReady = false, checkReady = false, acquired = 0;
  const reached = new Error('Readiness passed, no write performed by this mock.');
  const repository = createRepository({
    async execute(sql) {
      if (sql.includes('information_schema.tables')) return [[{ present: 2 }]];
      if (sql.includes('information_schema.columns')) return [columnsReady ? [{ dataType: 'varchar', nullable: 'YES', maxLength: 16 }] : []];
      if (sql.includes('information_schema.check_constraints')) return [checkReady ? [{ clause: "payment_method IS NULL OR payment_method IN ('CASH','TRANSFER')" }] : []];
      throw new Error('Unexpected database access');
    },
    async getConnection() { acquired++; throw reached; },
  });
  const input = { paymentMethod: 'cash', contact: { name: 'Synthetic' }, items: [{ productId: '1', quantity: 1, expectedUnitPrice: 42000 }] };
  for (const partial of [false, true]) {
    columnsReady = partial;
    await assert.rejects(repository.createProductOrder('1', input), error => error.status === 503 && error.code === 'PRODUCT_PAYMENT_SCHEMA_NOT_READY');
    assert.equal(acquired, 0);
  }
  checkReady = true;
  await assert.rejects(repository.createProductOrder('1', input), error => error === reached);
  assert.equal(acquired, 1);
});

test('legacy product orders can still be read without the payment column and never invent a payment method', async () => {
  const repository = createRepository({
    async execute(sql) {
      if (sql.includes('information_schema.tables')) return [[{ present: 2 }]];
      if (sql.includes('FROM product_orders')) return [[{
        id: '7', customer_id: '1', status: 'PROCESSING', items_request: JSON.stringify([{ productId: '2', quantity: 1 }]),
        contact_snapshot: JSON.stringify({ name: 'Synthetic', phone: '0391234567' }), total_amount: null,
        created_at: new Date(), updated_at: new Date(),
      }]];
      if (sql.includes('FROM product_order_items')) return [[]];
      throw new Error('Reading a legacy order must not require the new column.');
    },
  });
  const order = await repository.getProductOrder('1', '7');
  assert.equal(order.payment, null);
  assert.equal(order.status, 'processing');
});
