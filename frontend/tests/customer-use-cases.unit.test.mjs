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
function load(file, dependencies = {}) {
  const source = readFileSync(new URL('../packages/' + file, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports, URLSearchParams, require(name) {
    if (name in dependencies) return dependencies[name];
    throw new Error('Unexpected dependency: ' + name);
  } });
  return module.exports;
}

test('service search sends user criteria to the existing Catalog API and propagates failure without cached success', async () => {
  const calls = [];
  let failure;
  const service = { id: '7', name: 'Synthetic active service', status: 'active' };
  const { searchCustomerServices } = load('core/src/customer-service-search.ts', {
    './api-client': { ApiError },
    './customer-api-store': { async allCustomerPages(path) { calls.push(path); if (failure) throw failure; return [service]; } },
  });
  const result = await searchCustomerServices({ query: '  room & home  ', group: 've-sinh', cleaningType: 'phong-tro' });
  const url = new URL(calls[0], 'http://synthetic.invalid');
  assert.equal(url.pathname, '/catalog/services');
  assert.equal(url.searchParams.get('q'), 'room & home');
  assert.equal(url.searchParams.get('group'), 've-sinh');
  assert.equal(url.searchParams.get('cleaningType'), 'phong-tro');
  assert.equal(result[0].id, '7');
  failure = new ApiError('Synthetic Catalog outage', 503, 'UNAVAILABLE');
  await assert.rejects(searchCustomerServices({ query: 'other', group: '', cleaningType: '' }), (error) => error === failure);
  assert.equal(calls.length, 2);
});

test('inactive Catalog rows cannot be represented as available service search results', async () => {
  const { searchCustomerServices } = load('core/src/customer-service-search.ts', {
    './api-client': { ApiError },
    './customer-api-store': { async allCustomerPages() { return [{ id: '7', name: 'Inactive', status: 'inactive' }]; } },
  });
  await assert.rejects(searchCustomerServices({ query: '', group: '', cleaningType: '' }), (error) => error.code === 'INVALID_RESPONSE');
});

test('confirmed cancellation, payment and review mutations remain acknowledged when only the following reload fails', async () => {
  const calls = [];
  let current = true;
  let postFailure;
  const { customerOrderService } = load('ui/src/components/customer/booking-service.ts', {
    '@/lib/api-client': { ApiError, async apiRequest(path) { calls.push(path); if (postFailure) throw postFailure; return { id: 'saved' }; } },
    '@/lib/customer-api-store': {
      captureCustomerSession: () => ({}), isCustomerSessionCurrent: () => current,
      customerRequestError: (error) => error.message,
      async finishCustomerMutation() { throw new ApiError('Synthetic reload failure', 503, 'REFRESH_FAILED'); },
    },
  });
  for (const send of [() => customerOrderService.requestCancellation('7', 'Synthetic reason'), () => customerOrderService.savePayment('7', 'cash'), () => customerOrderService.saveReview('7', { rating: 4, comment: 'Synthetic' })]) {
    const result = await send();
    assert.equal(result.ok, true);
    assert.ok(result.warning);
  }
  assert.equal(calls.length, 3, 'No write may be retried automatically after its acknowledged response.');
  postFailure = new ApiError('Synthetic write failure', 503, 'DATABASE_UNAVAILABLE');
  assert.equal((await customerOrderService.saveReview('7', { rating: 4, comment: 'Synthetic' })).ok, false);
  postFailure = undefined;
  current = false;
  assert.equal((await customerOrderService.savePayment('7', 'cash')).ok, false, 'An old session cannot report success in the next account.');
});

test('booking contact validation matches Vietnamese phone and house area constraints', () => {
  const { validateBookingStep } = load('ui/src/components/customer/booking-validation.ts', {
    '@/lib/customer-time': load('core/src/customer-time.ts'),
    '@/lib/config': { HOUSE_TYPE_LABEL: { 'can-ho': 'Apartment' }, TIME_SLOTS: ['09:00'] },
    '@/lib/mock-data': { estimatePrice: () => 125000, estimateDuration: () => 120 },
    '@/lib/service-taxonomy': { serviceRequiresHouseDetails: () => true },
  });
  const values = { name: 'Synthetic customer', phone: '0391234567', address: 'Synthetic address', houseType: 'can-ho', area: '25', rooms: '1', floors: '1' };
  for (const phone of ['0391234567', '+84 391 234 567', '02412345678']) assert.equal(validateBookingStep(1, { ...values, phone }, {}).phone, undefined);
  for (const phone of ['123456789', '0123456789', '+1 234 567 890']) assert.ok(validateBookingStep(1, { ...values, phone }, {}).phone);
  assert.ok(validateBookingStep(1, { ...values, area: '0.001' }, {}).area);
  assert.equal(validateBookingStep(1, { ...values, area: '0.01' }, {}).area, undefined);
});

test('booking dates and displayed calendar days use Vietnam time even outside the browser timezone', () => {
  const time = load('core/src/customer-time.ts');
  const booking = load('ui/src/components/customer/booking-validation.ts', {
    '@/lib/customer-time': time,
    '@/lib/config': { HOUSE_TYPE_LABEL: {}, TIME_SLOTS: ['09:00'] },
    '@/lib/mock-data': {}, '@/lib/service-taxonomy': {},
  });
  assert.equal(booking.bookingDateTime('2026-11-08', '09:00').toISOString(), '2026-11-08T02:00:00.000Z');
  assert.equal(booking.bookingDateTime('2026-02-31', '09:00'), null);
  assert.equal(time.customerDay(new Date('2026-11-07T17:00:00Z')), '2026-11-08');
  assert.equal(booking.localDateValue(new Date('2026-11-07T16:59:59Z')), '2026-11-07');
  assert.match(time.customerDate('2026-11-08T02:00:00Z'), /09:00/);
});

test('order browsing sends filters and pagination to the server, checks ownership and propagates API errors', async () => {
  const calls = [];
  let current = true;
  let customerId = 'A';
  let failure;
  const sessionErrors = [];
  const { getCustomerOrders } = load('core/src/customer-order-api.ts', {
    './api-client': { ApiError, async apiRequest(path) {
      calls.push(path);
      if (failure) throw failure;
      return { items: [{ id: '7', customerId, contact: {}, items: [], createdAt: null }], total: 9, page: 2, limit: 8 };
    } },
    './customer-api-store': {
      captureCustomerSession: () => ({ userId: 'A' }), isCustomerSessionCurrent: () => current,
      customerRequestError: (error, scope) => sessionErrors.push({ error, scope }),
    },
  });
  const filters = { query: ' DH000007 ', serviceId: '5', status: 'completed', from: '2026-11-01', to: '2026-11-30', sort: 'schedule-desc', page: 2, limit: 8 };
  assert.equal((await getCustomerOrders(filters)).items[0].createdAt, '');
  const url = new URL(calls[0], 'http://synthetic.invalid');
  for (const [name, value] of Object.entries({ q: 'DH000007', serviceId: '5', status: 'completed', from: filters.from, to: filters.to, sort: filters.sort, page: '2', limit: '8' })) assert.equal(url.searchParams.get(name), value);
  customerId = 'B';
  await assert.rejects(getCustomerOrders(filters), (error) => error.code === 'INVALID_RESPONSE');
  customerId = 'A'; current = false;
  await assert.rejects(getCustomerOrders(filters), (error) => error.code === 'SESSION_CHANGED');
  current = true; failure = new ApiError('Synthetic order outage', 503, 'UNAVAILABLE');
  await assert.rejects(getCustomerOrders(filters), (error) => error === failure);
  assert.equal(sessionErrors.length, 3);
});

test('public service rating accepts actual empty/nonempty summaries and rejects invented or cross-service values', async () => {
  let payload = { serviceId: '7', count: 0, averageRating: null };
  let failure;
  const { getServiceReviewSummary } = load('core/src/customer-service-reviews.ts', {
    './api-client': { ApiError, async apiRequest(path) {
      assert.equal(path, '/reviews/service-summary?serviceId=7');
      if (failure) throw failure;
      return payload;
    } },
  });
  assert.equal((await getServiceReviewSummary('7')).averageRating, null);
  payload = { serviceId: '7', count: 3, averageRating: 4.33 };
  assert.equal((await getServiceReviewSummary('7')).count, 3);
  for (const invalid of [{ serviceId: '8', count: 1, averageRating: 4 }, { serviceId: '7', count: 0, averageRating: 5 }, { serviceId: '7', count: 1, averageRating: null }]) {
    payload = invalid;
    await assert.rejects(getServiceReviewSummary('7'), (error) => error.code === 'INVALID_RESPONSE');
  }
  failure = new ApiError('Synthetic summary unavailable', 503, 'UNAVAILABLE');
  await assert.rejects(getServiceReviewSummary('7'), (error) => error === failure);
});
