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
    module, exports: module.exports, crypto: webcrypto, structuredClone,
    require(name) { if (Object.hasOwn(dependencies, name)) return dependencies[name]; throw new Error('Unexpected dependency: ' + name); },
  }, { filename: file });
  return module.exports;
}
const labels = { SERVICE_GROUP_LABEL: { 've-sinh': 'Vệ sinh', 'cham-soc': 'Chăm sóc', 'bao-duong': 'Bảo dưỡng' } };

test('booking draft recovers only for its customer and route, including the exact uncertain request', () => {
  const memory = load('ui/src/components/customer/booking-draft.ts');
  const scope = memory.openBookingDraft('5', 'room');
  const draft = { values: { name: 'Synthetic contact', address: 'Synthetic address' }, step: 3, attempt: { requestKey: 'same-key', contact: { name: 'Original contact' } }, uncertain: true };
  scope.save(draft);
  draft.attempt.contact.name = 'Modified external value';
  memory.selectBookingDraftCustomer(null);
  assert.equal(memory.openBookingDraft('5', 'other-route').read(), null);
  const recovered = memory.openBookingDraft('5', 'room').read();
  assert.equal(recovered.step, 3);
  assert.equal(recovered.uncertain, true);
  assert.equal(recovered.attempt.requestKey, 'same-key');
  assert.equal(recovered.attempt.contact.name, 'Original contact');
  recovered.values.name = 'External mutation';
  assert.equal(scope.read().values.name, 'Synthetic contact');
});

test('switching customers or explicitly logging out clears drafts and rejects late writes', () => {
  const memory = load('ui/src/components/customer/booking-draft.ts');
  const original = memory.openBookingDraft('5', 'new');
  const draft = { values: { address: 'Synthetic private address' }, step: 1, attempt: null, uncertain: false };
  original.save(draft);
  const other = memory.openBookingDraft('6', 'new');
  assert.equal(original.isCurrent(), false);
  original.save(draft);
  assert.equal(other.read(), null);
  memory.clearBookingDrafts();
  other.save(draft);
  assert.equal(memory.openBookingDraft('6', 'new').read(), null);
  assert.equal(memory.openBookingDraft('5', 'new').read(), null);
});

test('completed bookings clear their route draft and cancellation guidance never claims pending requests are cancelled', () => {
  const memory = load('ui/src/components/customer/booking-draft.ts');
  const scope = memory.openBookingDraft('5', 'new');
  scope.save({ values: {}, step: 3, attempt: {}, uncertain: true });
  scope.clear();
  assert.equal(scope.read(), null);
  const { orderNextStep } = load('ui/src/components/customer/order-guidance.ts');
  assert.match(orderNextStep({ status: 'pending' }), /đề xuất/);
  assert.match(orderNextStep({ status: 'confirmed' }), /xác nhận/);
  assert.match(orderNextStep({ status: 'in_progress' }), /đang được thực hiện/);
  assert.match(orderNextStep({ status: 'completed' }), /đánh giá/);
  assert.match(orderNextStep({ status: 'confirmed', cancelRequest: { status: 'pending' } }), /vẫn giữ trạng thái hiện tại/);
  assert.match(orderNextStep({ status: 'cancelled', cancelRequest: { status: 'pending' } }), /^Đơn đã hủy/);
});
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

test('an acknowledged booking remains successful when refreshing the list fails, while an unacknowledged timeout stays uncertain', async () => {
  let acknowledged = true;
  let posts = 0;
  const { saveBookingRequest } = load('ui/src/components/customer/booking-service.ts', {
    '@/lib/api-client': { ApiError, apiRequest: async () => { posts++; if (!acknowledged) throw new ApiError('Network failed', 0, 'NETWORK_ERROR'); return { id: 'saved-booking' } } },
    '@/lib/customer-api-store': { captureCustomerSession: () => ({}), isCustomerSessionCurrent: () => true, customerRequestError: (error) => error.message, finishCustomerMutation: async () => { throw new ApiError('Session expired', 401, 'UNAUTHENTICATED') } },
  });
  const request = { requestKey: 'same-key', contact: {} };
  const saved = await saveBookingRequest(request);
  assert.equal(saved.ok, true);
  assert.equal(saved.order.id, 'saved-booking');
  assert.ok(saved.warning);
  assert.equal(posts, 1, 'A refresh failure must never cause another POST.');
  acknowledged = false;
  const uncertain = await saveBookingRequest(request);
  assert.equal(uncertain.ok, false);
  assert.equal(uncertain.uncertain, true);
});
function commerce(handler = async () => { throw new Error('No request expected'); }) {
  const calls = [], sessionErrors = [], pages = [];
  const core = load('core/src/product-commerce.ts', {
    './api-client': { ApiError, apiRequest: async (path, init) => { calls.push({ path, init }); return handler(path, init); } },
    './customer-api-store': {
      captureCustomerSession: () => ({}),
      isCustomerSessionCurrent: () => true,
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
  await assert.rejects(core.createProductOrder(contact, '5', { '1': 42000, '2': 42000 }), (error) => error.code === 'NETWORK_ERROR');
  core.addProductToCart(product(), 1);
  core.addProductToCart(product({ id: '2' }), 1);
  await assert.rejects(core.createProductOrder({ ...contact, name: 'Changed contact' }, '5', { '1': 42000, '2': 42000 }), (error) => error.code === 'ORDER_RECOVERY_REQUIRED');
  await assert.rejects(core.createProductOrder(contact, '5', { '1': 84000, '2': 42000 }), (error) => error.code === 'ORDER_RECOVERY_REQUIRED');
  const result = await core.retryPendingProductOrder('5');
  assert.equal(result.id, '9');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.body, calls[1].init.body, 'Recovery must reuse exactly the original key and body.');
  const body = JSON.parse(calls[1].init.body);
  assert.deepEqual(Object.keys(body).sort(), ['contact', 'items', 'paymentMethod', 'requestKey']);
  assert.equal(body.paymentMethod, 'cash');
  assert.equal('scheduledAt' in body, false);
  assert.equal('price' in body, false);
  assert.equal(body.items[0].expectedUnitPrice, 42000, 'Recovery cannot silently replace the agreed price.');
  assert.deepEqual(plain(core.getProductCartSnapshot()), [{ productId: '1', quantity: 1 }, { productId: '2', quantity: 1 }]);
  assert.equal(core.getProductPurchaseSnapshot().pending, null);
});

test('late success cannot clear a removed and newly added cart line', async () => {
  let resolve;
  const response = new Promise((done) => { resolve = done; });
  const { core } = commerce(() => response);
  core.setProductCustomer('5');
  core.addProductToCart(product(), 2);
  const request = core.createProductOrder(contact, '5', { '1': 42000, '2': 42000 });
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
  const request = core.createProductOrder(contact, '5', { '1': 42000, '2': 42000 });
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
  await assert.rejects(core.createProductOrder(contact, '5', { '1': 42000, '2': 42000 }), (error) => error.status === 401);
  assert.equal(core.getProductPurchaseSnapshot().pending, null);
  assert.equal(sessionErrors[0].status, 401);
  core.setProductCustomer(null);
  assert.equal(core.getProductCartSnapshot().length, 0);
});

test('failed product order retains the cart and all order pages use the shared pagination boundary', async () => {
  const { core, pages } = commerce(async () => order({ status: 'failed' }));
  core.setProductCustomer('5');
  core.addProductToCart(product(), 2);
  assert.equal((await core.createProductOrder(contact, '5', { '1': 42000, '2': 42000 })).status, 'failed');
  assert.equal(core.getProductCartSnapshot()[0].quantity, 2);
  await core.getProductOrders();
  assert.deepEqual(pages, ['/product-orders']);
});

test('a definitive price conflict keeps the cart and explicit confirmation uses a new key and the newly displayed price', async () => {
  let attempt = 0;
  const { core, calls } = commerce(async () => ++attempt === 1 ? order({ status: 'failed', errorCode: 'PRICE_CHANGED' }) : order());
  core.setProductCustomer('5');
  core.addProductToCart(product(), 2);
  const failed = await core.createProductOrder(contact, '5', { '1': 42000 });
  assert.equal(failed.errorCode, 'PRICE_CHANGED');
  assert.equal(core.getProductCartSnapshot()[0].quantity, 2);
  assert.equal(core.getProductPurchaseSnapshot().pending, null);
  assert.equal(calls.length, 1, 'Loading a new price must not automatically create an order.');
  await core.createProductOrder(contact, '5', { '1': 84000 });
  const [first, second] = calls.map(call => JSON.parse(call.init.body));
  assert.notEqual(first.requestKey, second.requestKey);
  assert.equal(first.items[0].expectedUnitPrice, 42000);
  assert.equal(second.items[0].expectedUnitPrice, 84000);
  assert.equal(core.getProductCartSnapshot().length, 0);
});

test('checkout cannot submit without a valid displayed price and preserves the selected cart', async () => {
  const { core, calls } = commerce(async () => order());
  core.setProductCustomer('5');
  core.addProductToCart(product(), 1);
  for (const price of [undefined, null, NaN, -1, 0.001, 10000000000]) {
    await assert.rejects(core.createProductOrder(contact, '5', { '1': price }), error => error.code === 'PRICE_CONFIRMATION_REQUIRED');
  }
  assert.equal(calls.length, 0);
  assert.equal(core.getProductCartSnapshot()[0].quantity, 1);
});

test('processing keeps cart and recovery key until an explicit retry knows the price outcome', async () => {
  let result = order({ status: 'processing' });
  const { core, calls } = commerce(async () => result);
  core.setProductCustomer('5');
  core.addProductToCart(product(), 2);
  await core.createProductOrder(contact, '5', { '1': 42000 });
  assert.equal(core.getProductCartSnapshot()[0].quantity, 2);
  const originalKey = core.getProductPurchaseSnapshot().pending.requestKey;
  await assert.rejects(core.createProductOrder(contact, '5', { '1': 84000 }), error => error.code === 'ORDER_RECOVERY_REQUIRED');
  result = order({ status: 'failed', errorCode: 'PRICE_CHANGED' });
  await core.retryProductOrder('9');
  assert.equal(core.getProductCartSnapshot()[0].quantity, 2);
  assert.equal(core.getProductPurchaseSnapshot().pending, null);
  result = order();
  await core.createProductOrder(contact, '5', { '1': 84000 });
  assert.notEqual(JSON.parse(calls.at(-1).init.body).requestKey, originalKey);
  assert.equal(core.getProductCartSnapshot().length, 0);
});

test('product checkout freezes the chosen payment method during recovery and rejects a fake paid simulation response', async () => {
  let attempt = 0;
  const { core, calls } = commerce(async () => { if (++attempt === 1) throw new ApiError('Lost response', 0, 'NETWORK_ERROR'); return order({ payment: { method: 'transfer', status: 'pending', simulated: true } }); });
  core.setProductCustomer('5');
  core.addProductToCart(product(), 1);
  await assert.rejects(core.createProductOrder(contact, '5', { '1': 42000 }, 'transfer'));
  await assert.rejects(core.createProductOrder(contact, '5', { '1': 42000 }, 'cash'), error => error.code === 'ORDER_RECOVERY_REQUIRED');
  assert.equal(core.getProductPurchaseSnapshot().pending.paymentMethod, 'transfer');
  await core.retryPendingProductOrder('5');
  assert.equal(calls[0].init.body, calls[1].init.body);
  assert.equal(JSON.parse(calls[1].init.body).paymentMethod, 'transfer');
  const bad = commerce(async () => order({ payment: { method: 'transfer', status: 'paid', simulated: true } }));
  bad.core.setProductCustomer('5');
  bad.core.addProductToCart(product(), 1);
  await assert.rejects(bad.core.createProductOrder(contact, '5', { '1': 42000 }, 'transfer'), error => error.code === 'INVALID_RESPONSE');
  assert.equal(bad.core.getProductCartSnapshot().length, 1);
});

test('rental/home booking requires household details; equipment details are optional and still validated', () => {
  const booking = load('ui/src/components/customer/booking-validation.ts', {
    '@/lib/customer-time': load('core/src/customer-time.ts'),
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
  const fractional = { ...machine, minQuantity: 0.01 };
  for (const quantity of ['0.01', '0.5', '1.25', '100000']) {
    assert.equal(Object.keys(booking.validateBookingStep(0, { ...values, quantity }, fractional)).length, 0);
  }
  for (const quantity of ['0.001', '1.001', '100001']) {
    assert.ok(booking.validateBookingStep(0, { ...values, quantity }, fractional).quantity);
  }
  assert.ok(booking.validateBookingStep(1, { ...values, name: 'a'.repeat(101) }, machine).name);
  assert.ok(booking.validateBookingStep(1, { ...values, rooms: '1001' }, machine).rooms);
});
