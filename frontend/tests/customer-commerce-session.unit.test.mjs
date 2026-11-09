import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
class ApiError extends Error {
  constructor(message, status, code) { super(message); this.status = status; this.code = code; }
}
function load(file, dependencies) {
  const source = readFileSync(new URL('../packages/' + file, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports, require(name) { if (name in dependencies) return dependencies[name]; throw new Error('Unexpected dependency: ' + name); } });
  return module.exports;
}
const user = (id) => ({ id, name: 'Synthetic ' + id, phone: '0391234567', role: 'customer' });
const page = (items = []) => ({ items, total: items.length, page: 1, limit: 100 });
function setup() {
  const context = { identity: user('A'), gate: null, target: 'product' };
  const apiRequest = async (path, init) => {
    if (context.gate && ((context.target === 'product' && path.startsWith('/product-orders')) || (context.target === 'booking' && path === '/orders' && init?.method === 'POST'))) return context.gate;
    if (path === '/auth/session' || path === '/users/me') return context.identity;
    if (path === '/catalog/categories') return [];
    return page();
  };
  const api = { ApiError, apiRequest };
  const store = load('core/src/customer-api-store.ts', { './api-client': api });
  const products = load('core/src/product-commerce.ts', { './api-client': api, './customer-api-store': store });
  const booking = load('ui/src/components/customer/booking-service.ts', { '@/lib/api-client': api, '@/lib/customer-api-store': store });
  return { context, store, products, booking };
}
const requests = {
  list: (products) => products.getProductOrders(),
  detail: (products) => products.getProductOrder('9'),
  retry: (products) => products.retryProductOrder('9'),
};

for (const [name, request] of Object.entries(requests)) {
  test('late product ' + name + ' 401 cannot expire a different customer or a renewed session', async () => {
    for (const renewedSameUser of [false, true]) {
      const { context, store, products } = setup();
      await store.refreshCustomerData();
      let reject;
      context.gate = new Promise((_, fail) => { reject = fail; });
      const pending = request(products);
      if (renewedSameUser) store.acceptCustomerAuthentication(user('A'));
      else { context.identity = user('B'); await store.refreshCustomerData(true); }
      reject(new ApiError('Late old response', 401, 'UNAUTHENTICATED'));
      await assert.rejects(pending, (error) => error.status === 401);
      assert.equal(store.customerSnapshot().session.userId, renewedSameUser ? 'A' : 'B');
    }
  });
}

test('a late successful product response is discarded after switching accounts', async () => {
  const { context, store, products } = setup();
  await store.refreshCustomerData();
  let resolve;
  context.gate = new Promise((done) => { resolve = done; });
  const pending = products.getProductOrder('9');
  context.identity = user('B');
  await store.refreshCustomerData(true);
  resolve({ id: '9', customerId: 'A', status: 'pending', items: [] });
  await assert.rejects(pending, (error) => error.code === 'SESSION_CHANGED');
  assert.equal(store.customerSnapshot().session.userId, 'B');
});

test('ordinary same-account refresh does not hide a real current-session 401', async () => {
  const { context, store, products } = setup();
  await store.refreshCustomerData();
  let reject;
  context.gate = new Promise((_, fail) => { reject = fail; });
  const pending = products.getProductOrder('9');
  await store.refreshCustomerData(true);
  reject(new ApiError('Current session expired', 401, 'UNAUTHENTICATED'));
  await assert.rejects(pending);
  assert.equal(store.customerSnapshot().session, null);
});

test('a late booking error cannot clear a newly authenticated customer', async () => {
  const { context, store, booking } = setup();
  await store.refreshCustomerData();
  let reject;
  context.target = 'booking';
  context.gate = new Promise((_, fail) => { reject = fail; });
  const pending = booking.saveBookingRequest({ requestKey: 'synthetic-request', contact: {} });
  context.identity = user('B');
  await store.refreshCustomerData(true);
  reject(new ApiError('Late booking response', 401, 'UNAUTHENTICATED'));
  assert.equal((await pending).ok, false);
  assert.equal(store.customerSnapshot().session.userId, 'B');
});
