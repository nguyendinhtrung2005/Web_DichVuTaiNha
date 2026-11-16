import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const ts = createRequire(import.meta.url)('typescript');
class ApiError extends Error { constructor(message, status, code) { super(message); this.status = status; this.code = code; } }
function setup(handle, finish = async () => {}) {
  let current = true;
  const calls = [];
  const source = readFileSync(new URL('../packages/ui/src/components/customer/booking-service.ts', import.meta.url), 'utf8');
  const module = { exports: {} };
  const dependencies = {
    '@/lib/api-client': { ApiError, apiRequest: async (path, init) => { const body = JSON.parse(init.body); calls.push({ path, body }); return handle(path, body, () => { current = false; }); } },
    '@/lib/customer-api-store': { captureCustomerSession: () => 'A', isCustomerSessionCurrent: () => current, customerRequestError: error => error.message, finishCustomerMutation: finish },
  };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module, exports: module.exports, require: name => dependencies[name] });
  return { service: module.exports, calls };
}
const input = { requestKey: '00112233-4455-4677-8899-aabbccddeeff', serviceId: '3', expectedUnitPrice: 125000, quantity: 1, contact: { name: 'Synthetic', phone: '0391234567' }, scheduledAt: '2030-01-02T02:00:00Z', specialRequest: '' };

test('service checkout saves the selected simulated payment before acknowledging completion', async () => {
  for (const paymentMethod of ['cash', 'transfer']) {
    let refreshed = false;
    const { service, calls } = setup(async path => path === '/orders' ? { id: '42', customerId: 'A', price: 125000 } : { id: '8', orderId: '42', amount: 125000, method: paymentMethod, status: paymentMethod === 'cash' ? 'unpaid' : 'pending', simulated: true }, async () => { refreshed = true; });
    const result = await service.saveBookingRequest({ ...input, paymentMethod });
    assert.equal(result.ok, true);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].path, '/orders/42/payment-simulation');
    assert.deepEqual(calls[1].body, { method: paymentMethod });
    assert.equal('paymentMethod' in calls[0].body, false, 'Use the existing booking DTO and Payment API.');
    assert.equal(calls[0].body.requestKey, input.requestKey);
    assert.equal(refreshed, true);
  }
});

test('lost payment response keeps the acknowledged booking and retries the same booking key and method', async () => {
  let paymentCalls = 0;
  const { service, calls } = setup(async path => {
    if (path === '/orders') return { id: '42', customerId: 'A', price: 125000 };
    if (++paymentCalls === 1) throw new ApiError('Synthetic lost Payment response', 0, 'NETWORK_ERROR');
    return { id: '8', orderId: '42', amount: 125000, method: 'transfer', status: 'pending', simulated: true };
  });
  const request = { ...input, paymentMethod: 'transfer' };
  const failed = await service.saveBookingRequest(request);
  assert.equal(failed.ok, false);
  assert.equal(failed.paymentPending, true);
  assert.equal(failed.uncertain, true);
  const recovered = await service.saveBookingRequest(request);
  assert.equal(recovered.ok, true);
  assert.deepEqual(calls[0], calls[2]);
  assert.deepEqual(calls[1], calls[3]);
});

test('a booking price rejection never starts payment, and a changed session cannot send payment for the prior account', async () => {
  const rejected = setup(async () => { throw new ApiError('Changed price', 409, 'PRICE_CHANGED'); });
  const result = await rejected.service.saveBookingRequest({ ...input, paymentMethod: 'cash' });
  assert.equal(result.ok, false);
  assert.equal(result.uncertain, false);
  assert.equal(rejected.calls.length, 1);
  const changed = setup(async (path, body, expire) => { expire(); return { id: '42', customerId: 'A' }; });
  const outdated = await changed.service.saveBookingRequest({ ...input, paymentMethod: 'transfer' });
  assert.equal(outdated.ok, false);
  assert.equal(outdated.code, 'SESSION_CHANGED');
  assert.equal(changed.calls.length, 1);
});
