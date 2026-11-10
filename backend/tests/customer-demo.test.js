import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareCustomerDemo } from '../scripts/prepare-customer-demo.js';

const approved = { ALLOW_CUSTOMER_DEMO_SEED: '1', DB_HOST: '127.0.0.1', DB_PORT: '3306', DB_NAME: 'dich_vu_ve_sinh' };

test('local demo refuses writes without exact target approval', async () => {
  for (const env of [{ ...approved, ALLOW_CUSTOMER_DEMO_SEED: '' }, { ...approved, DB_HOST: 'remote.example' }, { ...approved, DB_NAME: 'production' }, { ...approved, DB_PORT: '3307' }]) {
    await assert.rejects(prepareCustomerDemo({ query() { throw new Error('must not connect') } }, env), /explicit approval/);
  }
});

test('local demo preserves existing catalog and inventory instead of overwriting or refilling it', async () => {
  const calls = [];
  const connection = {
    async execute(sql) {
      calls.push(sql);
      if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }]];
      if (sql.includes('RELEASE_LOCK')) return [[{ released: 1 }]];
      throw new Error('Unexpected mutation');
    },
    async query() { return [[{ total: 1 }]] },
    async beginTransaction() { calls.push('begin') },
    async rollback() { calls.push('rollback') },
    release() { calls.push('release') },
    destroy() { calls.push('destroy') },
  };
  const pool = {
    async query() { return [[{ name: 'dich_vu_ve_sinh' }]] },
    async execute(sql) {
      if (sql.includes('information_schema.columns')) return [[{ present: '2' }]];
      if (sql.includes('information_schema.statistics')) return [[{ nonUnique: 0, columnsInOrder: 'customer_id,customer_request_key' }]];
      return [[{ checkClause: '(customer_request_key IS NULL AND customer_request_hash IS NULL) OR (customer_request_key IS NOT NULL AND customer_request_hash IS NOT NULL)' }]];
    },
    async getConnection() { return connection },
  };
  await assert.rejects(prepareCustomerDemo(pool, approved), /data already exists/);
  assert.ok(calls.includes('rollback'));
  assert.equal(calls.at(-1), 'release');
  assert.ok(!calls.some((sql) => /INSERT|UPDATE|DELETE/i.test(sql)));
});
