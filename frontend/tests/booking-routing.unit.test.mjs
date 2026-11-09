import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
function load(file) {
  const source = readFileSync(new URL('../packages/ui/src/components/' + file, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports, URL, require() { throw new Error('Unexpected runtime dependency'); } });
  return module.exports;
}
const routing = load('customer/booking-routing.ts');
const services = [
  { id: '3', status: 'active', defaultQuantity: 1 },
  { id: '12', status: 'active', defaultQuantity: 2 },
  { id: 'inactive', status: 'inactive', defaultQuantity: 1 },
];
const orders = [
  { id: '12', serviceId: '3', customerId: 'customer-A', quantity: 7, contact: { name: 'Synthetic A' } },
  { id: 'other', serviceId: '3', customerId: 'customer-B', quantity: 9 },
];
const input = (patch = {}) => ({ serviceId: '12', services, orders, customerId: 'customer-A', ...patch });

test('a service ID collision with an existing order never changes the chosen service or prefills that order', () => {
  const before = JSON.stringify({ services, orders });
  const result = routing.resolveBookingRoute(input());
  assert.equal(result.invalidRebook, false);
  assert.equal(result.initialService.id, '12');
  assert.equal(result.initialService.defaultQuantity, 2);
  assert.equal(result.previous, undefined);
  assert.equal(JSON.stringify({ services, orders }), before);
});

test('only an explicit rebook of an owned matching-service order prefills its information', () => {
  const result = routing.resolveBookingRoute(input({ serviceId: '3', rebookId: '12' }));
  assert.equal(result.invalidRebook, false);
  assert.equal(result.initialService.id, '3');
  assert.equal(result.previous.id, '12');
  assert.equal(result.previous.quantity, 7);
  assert.equal(result.previous.contact.name, 'Synthetic A');
});

test('unknown, unowned, mismatched and incomplete rebook links never fall back to another service or order', () => {
  for (const patch of [
    { serviceId: '3', rebookId: 'missing' },
    { serviceId: '3', rebookId: 'other' },
    { serviceId: '12', rebookId: '12' },
    { serviceId: '3', rebookId: '' },
    { serviceId: undefined, rebookId: '12' },
  ]) {
    const result = routing.resolveBookingRoute(input(patch));
    assert.equal(result.invalidRebook, true);
    assert.equal(result.previous, undefined);
    assert.equal(result.initialService, undefined);
  }
});

test('new generic booking chooses an active service while a missing/inactive requested service is never substituted', () => {
  assert.equal(routing.resolveBookingRoute(input({ serviceId: undefined })).initialService.id, '3');
  assert.equal(routing.resolveBookingRoute(input({ serviceId: 'missing' })).initialService, undefined);
  assert.equal(routing.resolveBookingRoute(input({ serviceId: 'inactive' })).initialService, undefined);
});

test('rebook URLs and login return destinations retain both distinct IDs', () => {
  const href = routing.customerBookingHref('3', '12');
  assert.equal(href, '/dat-dich-vu/3?rebook=12');
  assert.equal(routing.customerBookingHref('12'), '/dat-dich-vu/12');
  assert.equal(routing.customerBookingHref(), '/dat-dich-vu');
  const login = new URL(routing.bookingLoginHref('3', '12'), 'http://cleanhome.local');
  assert.equal(login.pathname, '/dang-nhap');
  assert.equal(login.searchParams.get('next'), href);
  assert.equal(new URL(routing.bookingLoginHref(), 'http://cleanhome.local').searchParams.get('next'), '/dat-dich-vu');
  const { safeReturnTo } = load('shared/route-policy.ts');
  assert.equal(safeReturnTo('customer', href), href);
});

test('new and reordered bookings have separate form/draft identities even when IDs collide', () => {
  const keys = [
    routing.bookingDraftRoute('12'),
    routing.bookingDraftRoute('3', '12'),
    routing.bookingDraftRoute('3'),
    routing.bookingDraftRoute('3', 'another-order'),
    routing.bookingDraftRoute(),
  ];
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(routing.bookingDraftRoute('3', '12'), routing.bookingDraftRoute('3', '12'));
});
