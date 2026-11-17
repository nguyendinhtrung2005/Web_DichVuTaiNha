import test from 'node:test';
import assert from 'node:assert/strict';
import { createLazyPool } from '../shared/lazy-pool.js';
import { createApp as authApp, createLoginGuard } from '../auth-service/src/app.js';
import { createApp as orderApp, validateCustomerStart, createProductInput, reconcileProductPurchase } from '../order-service/src/app.js';
import { createApp as staffApp } from '../staff-service/src/app.js';
import { MysqlAuthRepository, createRepository as authRepository } from '../auth-service/src/repository.js';
import { MysqlOrderRepository, createRepository as orderRepository, bookingRequestHash } from '../order-service/src/repository.js';
import { MysqlStaffRepository, createRepository as staffRepository } from '../staff-service/src/repository.js';

const config = {
  allowedOrigins: ['http://localhost:3001', 'http://localhost:3002', 'http://localhost:3003'],
  origins: { customer: 'http://localhost:3001', staff: 'http://localhost:3002', admin: 'http://localhost:3003' },
  urls: { auth: 'http://auth.invalid', order: 'http://order.invalid', staff: 'http://staff.invalid' },
  tokens: {}, issuer: 'unit-compat', audience: 'unit-compat', production: false,
  sessionTtl: 3600, cookieName: 'unit_session', secureCookies: false,
};

test('app factories fail closed for missing or unknown bootstrap contracts', () => {
  for (const factory of [authApp, orderApp, staffApp]) {
    assert.throws(() => factory(), TypeError);
    assert.throws(() => factory({}), TypeError);
  }
});

test('injected Staff service selects Express even when runtime also contains config', () => {
  const options = { service: {}, repository: {}, config, issuer: { jwks: { keys: [] } }, authenticate: (_req, _res, next) => next() };
  for (const factory of [authApp, orderApp, staffApp]) {
    const app = factory(options);
    assert.equal(typeof app.listen, 'function');
    assert.equal(typeof app.disable, 'function');
  }
});

test('native Order and Staff bootstrap keep the Customer/Admin request-listener contract', () => {
  for (const factory of [orderApp, staffApp]) {
    const app = factory({ repository: {}, config });
    assert.equal(typeof app, 'function');
    assert.equal(app.listen, undefined);
  }
});

test('both repository families and existing application helper exports remain available', () => {
  for (const ctor of [MysqlAuthRepository, MysqlOrderRepository, MysqlStaffRepository]) assert.equal(typeof ctor, 'function');
  assert.equal(typeof authRepository({}).findByIdentifier, 'function');
  assert.equal(typeof orderRepository({}).createProductOrder, 'function');
  assert.equal(typeof staffRepository({}).prepareTransition, 'function');
  for (const helper of [bookingRequestHash, validateCustomerStart, createProductInput, reconcileProductPurchase, createLoginGuard]) assert.equal(typeof helper, 'function');
});

test('compatibility pool performs no construction or connection on import/then/end of unused pool', async () => {
  let calls = 0;
  const pool = createLazyPool(() => { calls++; throw new Error('must not construct'); });
  assert.equal(pool.then, undefined);
  assert.equal(Object.prototype.toString.call(pool), '[object CleanHomeLazyPool]');
  assert.equal(calls, 0);
  await pool.end();
  assert.equal(calls, 0);
  assert.throws(() => pool.query, /POOL_CLOSED/);
});

test('compatibility pool creates once, binds this, and closes its real pool once', async () => {
  let created = 0, ended = 0;
  const actual = { marker: 17, query(value) { assert.equal(this, actual); return this.marker + value; }, async end() { assert.equal(this, actual); ended++; } };
  const pool = createLazyPool(() => { created++; return actual; });
  assert.equal(pool.query(2), 19);
  assert.equal(pool.query(4), 21);
  assert.equal(created, 1);
  await pool.end(); await pool.end();
  assert.equal(ended, 1);
  assert.throws(() => pool.query, /POOL_CLOSED/);
});
