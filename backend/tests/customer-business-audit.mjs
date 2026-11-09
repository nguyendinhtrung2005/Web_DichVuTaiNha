// Diagnostic probes, not acceptance tests: reproduce behavior without modifying runtime code.
// Uses only approved uniquely marked fixtures and their exact-ID cleanup.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createMysqlPool } from '../shared/mysql-pool.js';
import { createProductFixtures } from '../scripts/product-fixtures.js';
import { startCustomerStack } from '../scripts/customer-runtime.js';
import { createRepository as staffRepository } from '../staff-service/src/repository.js';

const pool = createMysqlPool();
let fixture, stack, armedBooking, armedAssignment;
const observations = {};
try {
  fixture = await createProductFixtures(pool);
  const staff = staffRepository(pool);
  const simulatedStaff = {
    branch: (id) => staff.branch(id),
    async assignment(id) {
      const snapshot = await staff.assignment(id);
      if (String(id) === armedBooking) {
        armedBooking = undefined;
        const [changed] = await pool.execute("UPDATE assignments SET status='IN_PROGRESS',check_in_at=CURRENT_TIMESTAMP WHERE id=? AND booking_id=? AND employee_id=?", [armedAssignment, id, fixture.employeeId]);
        assert.equal(changed.affectedRows, 1);
      }
      return snapshot;
    },
  };
  stack = await startCustomerStack({ env: { ...process.env, NODE_ENV: 'test' }, repositories: { staff: simulatedStaff },
    ports: { auth: 0, user: 0, catalog: 0, order: 0, staff: 0, payment: 0, review: 0, gateway: 0 },
    configOverrides: { origin: 'http://localhost:3001', defaultBranchId: fixture.branchId } });
  let cookie;
  const request = async (method, route, body) => {
    const response = await fetch(stack.urls.gateway + '/api/v1' + route, { method,
      headers: { Origin: stack.config.origin, ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    const result = { status: response.status, body: await response.json() };
    if (route === '/auth/register') cookie = response.headers.get('set-cookie')?.split(';')[0];
    return result;
  };
  const account = fixture.account('Audit');
  const registered = await request('POST', '/auth/register', account);
  assert.equal(registered.status, 201);
  const customerId = registered.body.data.id;
  await fixture.record('users', customerId);
  let displayedServicePrice = 125000;
  const bookingInput = () => {
    const scheduled = new Date(Date.now() + 4 * 86400000); scheduled.setUTCHours(2, 0, 0, 0);
    return { requestKey: randomUUID(), serviceId: fixture.serviceId, quantity: 1, expectedUnitPrice: displayedServicePrice,
      contact: { name: account.name, phone: account.phone, address: fixture.marker + ' audit address', houseType: 'phong-tro', hasPets: false, area: 25, rooms: 1, floors: 1 },
      scheduledAt: scheduled.toISOString(), specialRequest: fixture.marker + ' audit' };
  };
  const create = async (payload = bookingInput()) => {
    const response = await request('POST', '/orders', payload);
    if (response.body.data?.id) await fixture.recordOrder(response.body.data.id);
    return response;
  };

  const [rows] = await pool.execute('SELECT customer_config FROM services WHERE id=? AND name=?', [fixture.serviceId, fixture.marker + ' Service']);
  assert.equal(rows.length, 1);
  const metadata = typeof rows[0].customer_config === 'string' ? JSON.parse(rows[0].customer_config) : rows[0].customer_config;
  await pool.execute('UPDATE services SET customer_config=? WHERE id=? AND name=?', [JSON.stringify({ ...metadata, pricingMode: 'fixed' }), fixture.serviceId, fixture.marker + ' Service']);
  const preview = await request('GET', '/catalog/services/' + fixture.serviceId);
  assert.equal(preview.status, 200);
  await pool.execute('UPDATE services SET base_price=? WHERE id=? AND name=?', [250000, fixture.serviceId, fixture.marker + ' Service']);
  const priceChange = await create();
  observations.servicePriceChange = { previewMode: preview.body.data.pricingMode, previewPrice: preview.body.data.price,
    responseStatus: priceChange.status, persistedPrice: priceChange.body.data?.price,
    changedWithoutReconfirmation: priceChange.status === 201 && priceChange.body.data.price !== preview.body.data.price };
  displayedServicePrice = 250000;

  const night = bookingInput();
  night.scheduledAt = night.scheduledAt.slice(0, 10) + 'T02:15:00+07:00';
  const nightResult = await create(night);
  observations.outsideUiSchedule = { submittedVietnamTime: '02:15', responseStatus: nightResult.status, accepted: nightResult.status === 201 };

  const reviewOrder = await create();
  assert.equal(reviewOrder.status, 201);
  await fixture.completeOrder(reviewOrder.body.data.id, customerId);
  const blank = await request('POST', '/orders/' + reviewOrder.body.data.id + '/reviews', { rating: 4, comment: '   ' });
  await fixture.recordOrder(reviewOrder.body.data.id);
  observations.blankReview = { responseStatus: blank.status, persistedEmptyComment: blank.status === 201 && blank.body.data.comment === '' };

  const raceOrder = await create();
  assert.equal(raceOrder.status, 201);
  const bookingId = raceOrder.body.data.id;
  const [assigned] = await pool.execute("INSERT INTO assignments(booking_id,employee_id,status) VALUES(?,?,'ASSIGNED')", [bookingId, fixture.employeeId]);
  armedAssignment = String(assigned.insertId);
  await fixture.record('assignments', armedAssignment);
  armedBooking = bookingId;
  const cancellation = await request('POST', '/orders/' + bookingId + '/cancellation-requests', { reason: fixture.marker + ' concurrent start probe' });
  await fixture.recordOrder(bookingId);
  const after = await staff.assignment(bookingId);
  const detail = await request('GET', '/orders/' + bookingId);
  observations.cancellationStartRace = { responseStatus: cancellation.status, assignmentAfter: after.status,
    requestPendingAfterStart: after.status === 'IN_PROGRESS' && detail.body.data?.cancelRequest?.status === 'pending',
    limitation: 'Staff adapter deterministically starts the marked assignment after reading its snapshot; other services and MySQL are real.' };

  const productPreview = await request('GET', '/catalog/products/' + fixture.productId);
  await pool.execute('UPDATE products SET price=? WHERE id=? AND name=?', [84000, fixture.productId, fixture.marker + ' Nước lau nhà']);
  const purchase = await request('POST', '/product-orders', { requestKey: randomUUID(), items: [{ productId: fixture.productId, quantity: 1, expectedUnitPrice: productPreview.body.data.price }], contact: { name: account.name, phone: account.phone }, paymentMethod: 'cash' });
  if (purchase.body.data?.id) await fixture.recordProductOrder(purchase.body.data.id);
  observations.productPriceChange = { previewPrice: productPreview.body.data.price, responseStatus: purchase.status,
    persistedTotal: purchase.body.data?.total, changedWithoutReconfirmation: purchase.body.data?.status === 'pending' && purchase.body.data.total !== productPreview.body.data.price };
} finally {
  if (stack) await stack.close();
  try { if (fixture) await fixture.cleanup(); } finally { await pool.end(); }
}
process.stdout.write(JSON.stringify({ diagnosticOnly: true, observations, cleanup: 'PASS' }, null, 2) + '\n');
