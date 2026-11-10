// Exercises the already-running local gateway using disposable approved fixtures.
// Never prints credentials/cookies and never resets persistent demo data.
import { createMysqlPool } from '../shared/mysql-pool.js';
import { createProductFixtures } from '../scripts/product-fixtures.js';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const pool = createMysqlPool();
let fixture, cookie;
const results = {};
const request = async (path, body) => {
  const response = await fetch('http://localhost:4000/api/v1' + path, { method: 'POST',
    headers: { Origin: 'http://localhost:3001', 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  const result = { status: response.status, body: await response.json() };
  if (path === '/auth/register') cookie = response.headers.get('set-cookie')?.split(';')[0];
  return result;
};
const outcome = result => ({ status: result.status, code: result.body.error?.code, message: result.body.error?.message,
  fields: result.body.error?.fields ? Object.keys(result.body.error.fields) : undefined,
  orderStatus: result.body.data?.status, payment: result.body.data?.payment });
try {
  fixture = await createProductFixtures(pool);
  const account = fixture.account('LiveSmoke');
  const registered = await request('/auth/register', account);
  results.auth = { status: registered.status, code: registered.body.error?.code };
  if (registered.body.data?.id) await fixture.record('users', registered.body.data.id);
  if (registered.status !== 201 || !cookie) throw new Error('Live fixture authentication failed');
  if (process.argv.includes('--browser')) {
    const { runProductsBrowserFlow } = await import('../../frontend/tests/products-browser.cdp.mjs');
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(DB_|INTERNAL_|JWT_)/.test(name)));
    await runProductsBrowserFlow({ appURL: 'http://localhost:3001', gatewayURL: 'http://localhost:4000', fixture,
      artifactDirectory: fileURLToPath(new URL('../.test-artifacts/live-browser/', import.meta.url)), env });
    results.browser = 'PASS on live Customer 3001 and Gateway 4000';
  }
  const at = new Date(new Date(Date.now() + 4 * 86400000).setUTCHours(2, 0, 0, 0));
  const booking = await request('/orders', { requestKey: randomUUID(), serviceId: fixture.serviceId, quantity: 1, expectedUnitPrice: 125000,
    contact: { name: account.name, phone: account.phone, address: fixture.marker + ' live smoke address', houseType: 'phong-tro', hasPets: false, area: 25, rooms: 1, floors: 1 },
    scheduledAt: at.toISOString(), specialRequest: fixture.marker });
  if (booking.body.data?.id) await fixture.recordOrder(booking.body.data.id);
  results.service = outcome(booking);
  if (booking.body.data?.id) {
    const payment = await request('/orders/' + booking.body.data.id + '/payment-simulation', { method: 'cash' });
    await fixture.recordOrder(booking.body.data.id);
    results.servicePayment = { status: payment.status, code: payment.body.error?.code, paymentStatus: payment.body.data?.status };
  }
  const purchase = await request('/product-orders', { requestKey: randomUUID(), paymentMethod: 'transfer',
    contact: { name: account.name, phone: account.phone }, items: [{ productId: fixture.productId, quantity: 1, expectedUnitPrice: 42000 }] });
  if (purchase.body.data?.id) await fixture.recordProductOrder(purchase.body.data.id);
  results.product = outcome(purchase);
} finally {
  try { if (fixture) await fixture.cleanup(); } finally { await pool.end(); }
}
const passed = results.service?.status === 201 && results.servicePayment?.status === 200
  && results.product?.status === 200 && results.product?.orderStatus === 'pending';
process.stdout.write(JSON.stringify({ passed, results, cleanup: 'PASS' }, null, 2) + '\n');
if (!passed) process.exitCode = 1;
