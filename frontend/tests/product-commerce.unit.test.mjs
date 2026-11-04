import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { webcrypto } from 'node:crypto';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const plain = (value) => JSON.parse(JSON.stringify(value));
function load(file, dependencies = {}) {
  const source = readFileSync(new URL('../packages/' + file, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module, exports: module.exports, crypto: webcrypto,
    require(name) { if (Object.hasOwn(dependencies, name)) return dependencies[name]; throw new Error('Unexpected dependency: ' + name); },
  }, { filename: file });
  return module.exports;
}
const labels = { SERVICE_GROUP_LABEL: { 've-sinh': 'Vệ sinh', 'cham-soc': 'Chăm sóc', 'bao-duong': 'Bảo dưỡng' } };
const taxonomy = load('core/src/service-taxonomy.ts', { './config': labels });
const service = (patch = {}) => ({ id: 'dv-01', category: 'dinh-ky', name: 'Dọn nhà theo giờ', shortDesc: 'Dọn nhà', description: 'Nhà ở', status: 'active', ...patch });

test('three service groups and cleaning filters preserve legacy identifiers and categories', () => {
  const services = [
    service(),
    service({ id: 'room', name: 'Vệ sinh phòng trọ', group: 've-sinh', cleaningType: 'phong-tro' }),
    service({ id: 'care', name: 'Chăm sóc nội thất', group: 'cham-soc', category: 'noi-that' }),
    service({ id: 'machine', name: 'Vệ sinh máy lạnh', category: 'thiet-bi' }),
  ];
  const before = JSON.stringify(services);
  assert.equal(taxonomy.serviceGroupOf(services[0]), 've-sinh');
  assert.equal(taxonomy.serviceGroupOf(services[2]), 'cham-soc');
  assert.equal(taxonomy.serviceGroupOf(services[3]), 'bao-duong');
  assert.equal(taxonomy.cleaningTypeOf(services[0]), 'nha-gia-dinh');
  assert.deepEqual(plain(taxonomy.filterCustomerServices(services, { cleaningType: 'phong-tro' })).map((entry) => entry.id), ['room']);
  assert.deepEqual(plain(taxonomy.filterCustomerServices(services, { group: 'bao-duong' })).map((entry) => entry.id), ['machine']);
  assert.deepEqual(plain(taxonomy.filterCustomerServices(services, { query: 'phong tro' })).map((entry) => entry.id), ['room']);
  assert.equal(taxonomy.serviceGroupOf(service({ group: 'cham-soc', category: 'thiet-bi' })), 'cham-soc', 'Explicit metadata wins over legacy category.');
  assert.equal(JSON.stringify(services), before, 'Classification must not rewrite saved records.');
});

test('legacy storage version and old house types stay valid with additive rental type', () => {
  const mock = load('core/src/mock-data.ts', {
    './format': {
      addDays(date, amount) { const next = new Date(date); next.setDate(next.getDate() + amount); return next; },
      startOfDay(date) { const next = new Date(date); next.setHours(0, 0, 0, 0); return next; },
    },
    './auth': { seedPasswordHashes(users) { return Object.fromEntries(users.map((user) => [user.id, 'synthetic-test-hash'])); } },
  });
  const { validateMigrationState } = load('core/src/data-migration.ts');
  assert.equal(mock.SEED_VERSION, 2);
  const state = plain(mock.createSeedState(new Date('2026-10-30T00:00:00Z')));
  const originalIds = ['dv-01', 'dv-02', 'dv-03', 'dv-04', 'dv-05', 'dv-06'];
  assert.deepEqual(state.services.slice(0, 6).map((entry) => entry.id), originalIds);
  assert.equal(state.services[0].slug, 'don-nha-theo-gio');
  assert.ok(state.services.some((entry) => entry.cleaningType === 'phong-tro'));
  assert.ok(state.services.some((entry) => entry.group === 'cham-soc'));
  state.services = state.services.map(({ group, cleaningType, pricingMode, ...legacy }) => legacy);
  for (const houseType of ['phong-tro', 'can-ho', 'nha-pho', 'biet-thu', 'van-phong']) {
    state.orders[0].contact.houseType = houseType;
    assert.equal(validateMigrationState(state).ok, true, 'Legacy and additive house types must remain valid.');
  }
  state.orders[0].contact.houseType = 'invalid';
  assert.equal(validateMigrationState(state).ok, false);
});

class ApiError extends Error {
  constructor(message, status, code) { super(message); this.status = status; this.code = code; }
}
function commerce(handler = async () => { throw new Error('No request expected'); }) {
  const calls = [], sessionErrors = [], pages = [];
  const core = load('core/src/product-commerce.ts', {
    './api-client': { ApiError, apiRequest: async (path, init) => { calls.push({ path, init }); return handler(path, init); } },
    './customer-api-store': {
      customerRequestError(error) { sessionErrors.push(error); return error.message; },
      allCustomerPages: async (path) => { pages.push(path); return []; },
    },
  });
  return { core, calls, sessionErrors, pages };
}
const product = (patch = {}) => ({ id: '1', name: 'Synthetic product', status: 'available', stock: 20, unit: 'chai', ...patch });
const contact = { name: 'Synthetic customer', phone: '0391234567' };
const order = (patch = {}) => ({ id: '9', customerId: '5', status: 'pending', items: [{ productId: '1', quantity: 2 }], ...patch });

test('cart enforces integers, availability, stock, line limits and never auto-adds products', () => {
  const { core } = commerce();
  assert.deepEqual(plain(core.getProductCartSnapshot()), []);
  for (const quantity of [0, -1, NaN, 1.5, 1000]) assert.equal(core.addProductToCart(product(), quantity).ok, false);
  assert.equal(core.addProductToCart(product({ status: 'inactive' }), 1).ok, false);
  assert.equal(core.addProductToCart(product({ stock: 0 }), 1).ok, false);
  assert.equal(core.addProductToCart(product(), 2).ok, true);
  assert.equal(core.updateProductCartQuantity(product(), 0).ok, false, 'Clearing a draft must not remove its cart item.');
  assert.equal(core.getProductCartSnapshot()[0].quantity, 2);
  assert.equal(core.updateProductCartQuantity(product(), 21).ok, false);
  core.removeProductFromCart('1');
  assert.equal(core.getProductCartSnapshot().length, 0);
  for (let index = 1; index <= 50; index++) assert.equal(core.addProductToCart(product({ id: String(index) }), 1).ok, true);
  assert.equal(core.addProductToCart(product({ id: '51' }), 1).ok, false);
});

test('unknown outcome can retry the original request after cart/contact changes without losing new items', async () => {
  let attempts = 0;
  const { core, calls } = commerce(async () => { if (++attempts === 1) throw new ApiError('Lost response', 0, 'NETWORK_ERROR'); return order(); });
  core.setProductCustomer('5');
  core.addProductToCart(product(), 2);
  await assert.rejects(core.createProductOrder(contact, '5'), (error) => error.code === 'NETWORK_ERROR');
  core.addProductToCart(product(), 1);
  core.addProductToCart(product({ id: '2' }), 1);
  await assert.rejects(core.createProductOrder({ ...contact, name: 'Changed contact' }, '5'), (error) => error.code === 'ORDER_RECOVERY_REQUIRED');
  const result = await core.retryPendingProductOrder('5');
  assert.equal(result.id, '9');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.body, calls[1].init.body, 'Recovery must reuse exactly the original key and body.');
  const body = JSON.parse(calls[1].init.body);
  assert.deepEqual(Object.keys(body).sort(), ['contact', 'items', 'requestKey']);
  assert.equal('scheduledAt' in body, false);
  assert.equal('price' in body, false);
  assert.deepEqual(plain(core.getProductCartSnapshot()), [{ productId: '1', quantity: 1 }, { productId: '2', quantity: 1 }]);
  assert.equal(core.getProductPurchaseSnapshot().pending, null);
});

test('late success cannot clear a removed and newly added cart line', async () => {
  let resolve;
  const response = new Promise((done) => { resolve = done; });
  const { core } = commerce(() => response);
  core.setProductCustomer('5');
  core.addProductToCart(product(), 2);
  const request = core.createProductOrder(contact, '5');
  core.removeProductFromCart('1');
  core.addProductToCart(product(), 3);
  resolve(order());
  await request;
  assert.equal(core.getProductCartSnapshot()[0].quantity, 3);
});

test('customer changes clear personal recovery data and late responses cannot mutate the next cart', async () => {
  let resolve;
  const response = new Promise((done) => { resolve = done; });
  const { core, sessionErrors } = commerce(() => response);
  core.setProductCustomer('5');
  core.addProductToCart(product(), 2);
  const request = core.createProductOrder(contact, '5');
  core.setProductCustomer('6');
  core.addProductToCart(product({ id: '2' }), 1);
  assert.equal(core.getProductPurchaseSnapshot().pending, null);
  resolve(order());
  await assert.rejects(request, (error) => error.code === 'SESSION_CHANGED');
  assert.deepEqual(plain(core.getProductCartSnapshot()), [{ productId: '2', quantity: 1 }]);
  assert.equal(sessionErrors.length, 0, 'An old response must not expire the next customer session.');
});

test('guest cart survives sign-in, logout clears personal cart and auth failures use existing session expiry', async () => {
  const { core, sessionErrors } = commerce(async () => { throw new ApiError('Expired', 401, 'UNAUTHENTICATED'); });
  core.addProductToCart(product(), 1);
  core.setProductCustomer('5');
  assert.equal(core.getProductCartSnapshot().length, 1);
  await assert.rejects(core.createProductOrder(contact, '5'), (error) => error.status === 401);
  assert.equal(core.getProductPurchaseSnapshot().pending, null);
  assert.equal(sessionErrors[0].status, 401);
  core.setProductCustomer(null);
  assert.equal(core.getProductCartSnapshot().length, 0);
});

test('failed product order retains the cart and all order pages use the shared pagination boundary', async () => {
  const { core, pages } = commerce(async () => order({ status: 'failed' }));
  core.setProductCustomer('5');
  core.addProductToCart(product(), 2);
  assert.equal((await core.createProductOrder(contact, '5')).status, 'failed');
  assert.equal(core.getProductCartSnapshot()[0].quantity, 2);
  await core.getProductOrders();
  assert.deepEqual(pages, ['/product-orders']);
});

test('rental/home booking requires household details; equipment details are optional and still validated', () => {
  const booking = load('ui/src/components/customer/booking-validation.ts', {
    '@/lib/config': { HOUSE_TYPE_LABEL: { 'phong-tro': 'Phòng trọ', 'can-ho': 'Căn hộ' }, TIME_SLOTS: ['07:00'] },
    '@/lib/mock-data': { estimatePrice: (entry, quantity) => entry.price * quantity, estimateDuration: () => 60 },
    '@/lib/service-taxonomy': taxonomy,
  });
  const values = { serviceId: 'room', quantity: '1', name: 'Synthetic customer', phone: '0391234567', address: 'Synthetic test address', houseType: 'phong-tro', area: '', rooms: '', floors: '', hasPets: false, date: '2026-11-05', time: '07:00', specialRequest: '' };
  const rental = service({ id: 'room', group: 've-sinh', cleaningType: 'phong-tro', price: 100000, minQuantity: 1 });
  assert.ok(booking.validateBookingStep(1, values, rental).area);
  assert.equal(Object.keys(booking.validateBookingStep(1, { ...values, area: '25', rooms: '1', floors: '1' }, rental)).length, 0);
  const machine = service({ id: 'room', group: 'bao-duong', price: 100000, minQuantity: 1 });
  assert.equal(Object.keys(booking.validateBookingStep(1, values, machine)).length, 0);
  assert.ok(booking.validateBookingStep(1, { ...values, rooms: '1.5' }, machine).rooms);
});
