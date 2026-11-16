import test from 'node:test';
import assert from 'node:assert/strict';
import { applyWebData, inspectWebData } from '../scripts/prepare-customer-web-data.js';
import { webDataPlan, webAccounts, webServices, webProducts, webBookings, webPurchases } from '../scripts/customer-web-data-definition.js';

const approved = { DB_HOST: '127.0.0.1', DB_PORT: '3306', DB_NAME: 'dich_vu_ve_sinh', CUSTOMER_DEFAULT_BRANCH_ID: '22', ALLOW_CUSTOMER_WEB_SEED: '1' };
function fixture({ collision = 0, failItem = false, ambiguousCommit = false } = {}) {
  const calls = [], phases = [], actions = { begin: 0, commit: 0, rollback: 0, release: 0, destroy: 0, artifacts: 0 };
  let nextId = 100, registry;
  async function query(sql, values = []) {
    calls.push({ sql, values });
    if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }]];
    if (sql.includes('RELEASE_LOCK')) return [[{ released: 1 }]];
    if (sql.includes('SELECT DATABASE()')) return [[{ name: 'dich_vu_ve_sinh' }]];
    if (sql.includes('information_schema.columns')) {
      if (sql.includes('COUNT(')) return [[{ present: 2 }]];
      return values[0] === 'users' ? [[{ nullable: 'YES' }]] : [[{ column_name: 'customer_config' }]];
    }
    if (sql.includes('information_schema.statistics')) return values[0] === 'users'
      ? [[{ nonUnique: 0, columnName: 'email' }]] : [[{ nonUnique: 0, columnsInOrder: 'customer_id,customer_request_key' }]];
    if (sql.includes('information_schema.check_constraints')) return [[{ checkClause: '(customer_request_key IS NULL AND customer_request_hash IS NULL) OR (customer_request_key IS NOT NULL AND customer_request_hash IS NOT NULL)' }]];
    if (sql.includes('information_schema.tables')) return [Object.keys(webDataPlan.counts).map((name) => ({ name, engine: 'InnoDB' }))];
    if (sql.startsWith('SELECT id,status FROM branches')) return [[{ id: '22', status: 'ACTIVE' }]];
    if (sql.startsWith('SELECT COUNT(*)')) return [[{ count: sql.includes('phone IN') ? collision : 0 }]];
    if (sql.startsWith('INSERT INTO booking_items') && failItem) throw new Error('Synthetic item failure');
    if (sql.startsWith('INSERT')) return [{ insertId: String(nextId++), affectedRows: 1 }];
    if (sql.startsWith('UPDATE product_inventory')) return [{ affectedRows: 1 }];
    throw new Error('Unexpected test query');
  }
  const connection = { query, execute: query,
    async beginTransaction() { actions.begin++; },
    async commit() { actions.commit++; if (ambiguousCommit) throw new Error('Synthetic lost commit ACK'); },
    async rollback() { actions.rollback++; }, release() { actions.release++; }, destroy() { actions.destroy++; },
  };
  return {
    calls, phases, actions,
    pool: { query, execute: query, async getConnection() { return connection; } },
    options: { encodePassword: async () => 'synthetic-hashed-password', artifactStore: {
      async readFile() { return 'backend/.test-artifacts/\n'; }, async mkdir() {},
      async writeFile(path, content) { actions.artifacts++; registry = JSON.parse(content); phases.push(registry.phase); },
    } },
    registry: () => registry,
  };
}

test('persistent web dataset refuses unapproved/wrong targets before querying or writing', async () => {
  const noPool = { query() { throw new Error('must not connect'); } };
  for (const patch of [{ DB_HOST: 'production.invalid' }, { DB_PORT: '3307' }, { DB_NAME: 'another_schema' }, { ALLOW_CUSTOMER_WEB_SEED: '' }]) {
    await assert.rejects(applyWebData(noPool, { ...approved, ...patch }));
  }
  await assert.rejects(inspectWebData(noPool, { ...approved, DB_NAME: 'production' }));
});

test('web dataset covers active/inactive, all booking states, cross-account, empty and stock scenarios', () => {
  assert.equal(webAccounts.filter((a) => a.role === 'CUSTOMER').length, 4);
  assert.equal(webBookings.filter((b) => b.account === 'a').length, 12);
  assert.equal(webBookings.filter((b) => b.account === 'b').length, 2);
  assert.ok(!webBookings.some((b) => b.account === 'empty'));
  assert.equal(new Set(webBookings.map((b) => b.status)).size, 5);
  assert.equal(new Set(webPurchases.map((p) => p.status)).size, 3);
  assert.ok(webServices.some((s) => s.inactive));
  assert.ok(webProducts.some((p) => p.stock === 1) && webProducts.some((p) => p.stock === 0));
  assert.equal(Object.keys(webDataPlan.counts).length, 18);
  for (const product of webProducts) {
    const reserved = webPurchases.filter((p) => p.status === 'PENDING').flatMap((p) => p.items).filter((i) => i.product === product.key).reduce((n, i) => n + i.quantity, 0);
    assert.ok(reserved <= product.stock, 'Initial reservations must fit the owned synthetic inventory.');
  }
});

test('existing account collisions stop the dataset without touching artifacts, passwords or stock', async () => {
  const context = fixture({ collision: 1 });
  await assert.rejects(applyWebData(context.pool, approved, context.options), /đã tồn tại/);
  assert.equal(context.actions.artifacts, 0);
  assert.ok(!context.calls.some((call) => /^(INSERT|UPDATE|DELETE)/.test(call.sql)));
});

test('complete dataset commits once, journals exact rows and never sends plaintext passwords to SQL (mock transaction)', async () => {
  const context = fixture();
  const result = await applyWebData(context.pool, approved, context.options);
  assert.deepEqual(result.counts, webDataPlan.counts);
  assert.equal(context.actions.commit, 1); assert.equal(context.actions.rollback, 0);
  assert.equal(context.actions.release, 1);
  const registry = context.registry();
  assert.equal(registry.phase, 'applied');
  for (const [table, count] of Object.entries(webDataPlan.counts)) assert.equal(registry.ids[table].length, count);
  assert.equal(registry.accounts.length, 4);
  const sql = JSON.stringify(context.calls);
  for (const account of registry.accounts) assert.ok(!sql.includes(account.password));
  assert.ok(!context.calls.some((call) => /^(DELETE|ALTER|DROP|TRUNCATE)/.test(call.sql)));
  assert.ok(context.calls.filter((call) => call.sql.startsWith('UPDATE')).every((call) => call.sql.startsWith('UPDATE product_inventory')));
});

test('mid-seed item failure rolls back everything and a lost commit ACK remains uncertain (mock transaction)', async (t) => {
  const failed = fixture({ failItem: true });
  await assert.rejects(applyWebData(failed.pool, approved, failed.options), /Synthetic item failure/);
  assert.equal(failed.actions.commit, 0); assert.equal(failed.actions.rollback, 1);
  assert.equal(failed.registry().phase, 'rolledback');
  const uncertain = fixture({ ambiguousCommit: true });
  await assert.rejects(applyWebData(uncertain.pool, approved, uncertain.options), /Có thể đã commit/);
  assert.equal(uncertain.actions.commit, 1);
  assert.equal(uncertain.registry().phase, 'uncertain');
  assert.ok(!uncertain.calls.some((call) => call.sql.startsWith('DELETE')));
});
