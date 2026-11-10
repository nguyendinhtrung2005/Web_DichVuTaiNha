import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { canonicalRegionKey } from '../order-service/src/booking-auto-assignment.js';
import { createProductFixtures } from '../scripts/product-fixtures.js';
import { createMysqlPool } from '../shared/mysql-pool.js';
import { startCustomerStack } from '../scripts/customer-runtime.js';
import { createRepository as createOrderRepository } from '../order-service/src/repository.js';
import { hashPassword } from '../shared/passwords.js';

const enabled = process.env.ALLOW_BOOKING_AUTOMATION_DB_TEST === '1'
  && process.env.ALLOW_CUSTOMER_DB_TEST === '1';

test('booking automation persists audit and serializes overlapping employee assignments in MySQL', {
  skip: !enabled,
  timeout: 90000,
}, async () => {
  const pool = createMysqlPool();
  let fixture;
  let stack;
  try {
    const [migrationTables] = await pool.execute(
      `SELECT COUNT(DISTINCT table_name) AS present FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name IN
         ('branch_services', 'branch_service_areas', 'service_auto_assignment_config',
          'service_required_skills', 'booking_decision_history')`,
    );
    if (Number(migrationTables[0]?.present) !== 5) throw new Error('Apply migration 006 to the separately approved test database before enabling this test.');

    fixture = await createProductFixtures(pool);
    const scheduleDay = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(Date.now() + 4 * 86400000));
    const start = new Date(`${scheduleDay}T09:00:00+07:00`);
    const end = new Date(start.getTime() + 120 * 60000);
    const region = 'Phường Auto Test';
    const regionKey = canonicalRegionKey(region);
    await pool.execute('INSERT INTO branch_services (branch_id,service_id,is_active) VALUES (?,?,TRUE)', [fixture.branchId, fixture.serviceId]);
    await pool.execute(
      'INSERT INTO branch_service_areas (branch_id,region_key,region_name,is_active) VALUES (?,?,?,TRUE)',
      [fixture.branchId, regionKey, region],
    );
    await pool.execute(
      'INSERT INTO service_auto_assignment_config (service_id,skills_verified) VALUES (?,TRUE)',
      [fixture.serviceId],
    );
    await pool.execute(
      `INSERT INTO employee_availability (employee_id,starts_at,ends_at,status)
       VALUES (?,?,?,'AVAILABLE')`,
      [fixture.employeeId, new Date(start.getTime() - 3600000), new Date(end.getTime() + 3600000)],
    );

    stack = await startCustomerStack({
      env: { ...process.env, NODE_ENV: 'test' },
      ports: { auth: 0, user: 0, catalog: 0, order: 0, staff: 0, payment: 0, review: 0, gateway: 0 },
      configOverrides: { origin: 'http://localhost:3001', defaultBranchId: fixture.branchId },
    });
    const register = async (label) => {
      const account = fixture.account(label);
      const response = await fetch(`${stack.urls.gateway}/api/v1/auth/register`, {
        method: 'POST',
        headers: { Origin: stack.config.origin, 'Content-Type': 'application/json' },
        body: JSON.stringify(account),
      });
      assert.equal(response.status, 201);
      const cookie = response.headers.get('set-cookie')?.split(';')[0];
      assert.ok(cookie);
      const { data } = await response.json();
      await fixture.record('users', data.id);
      return { cookie, account };
    };
    const customers = await Promise.all([register('AutoOne'), register('AutoTwo')]);
    const serviceResponse = await fetch(`${stack.urls.gateway}/api/v1/catalog/services/${fixture.serviceId}`);
    const service = (await serviceResponse.json()).data;
    assert.equal(service.status, 'active');
    const requestKeys = [randomUUID(), randomUUID()];
    const bookingRequest = (requestKey) => ({
      requestKey, serviceId: fixture.serviceId, expectedUnitPrice: service.price, quantity: 1,
      contact: {
        name: 'Automation Test', phone: '0391234567', address: '1 Test Street, Phường Auto Test',
        region, houseType: 'can-ho', hasPets: false, area: 60, rooms: 2, floors: 1,
      },
      scheduledAt: start.toISOString(), specialRequest: 'automation concurrency fixture',
    });
    const submit = (customer, requestKey) => fetch(`${stack.urls.gateway}/api/v1/orders`, {
      method: 'POST',
      headers: { Origin: stack.config.origin, Cookie: customer.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify(bookingRequest(requestKey)),
    });
    const responses = await Promise.all(customers.map((customer, index) => submit(customer, requestKeys[index])));
    const results = await Promise.all(responses.map(async (response) => {
      assert.equal(response.status, 201);
      return (await response.json()).data;
    }));
    for (const order of results) await fixture.recordOrder(order.id);

    assert.deepEqual(results.map((order) => order.decisionState).sort(), ['AUTO_CONFIRMED', 'NEEDS_DISPATCH']);
    assert.equal(results.filter((order) => order.staffId).length, 1);
    const ownerIndex = results.findIndex((order) => order.decisionState === 'AUTO_CONFIRMED');
    const queueIndex = 1 - ownerIndex;
    const unauthorized = await fetch(`${stack.urls.gateway}/api/v1/orders/${results[ownerIndex].id}`, {
      headers: { Origin: stack.config.origin, Cookie: customers[queueIndex].cookie },
    });
    assert.equal(unauthorized.status, 404);
    const replay = await submit(customers[ownerIndex], requestKeys[ownerIndex]);
    assert.equal(replay.status, 200);
    assert.equal((await replay.json()).data.id, results[ownerIndex].id);

    const [audit] = await pool.execute(
      `SELECT next_decision FROM booking_decision_history
       WHERE booking_id IN (?,?) ORDER BY id`, results.map((order) => order.id),
    );
    assert.deepEqual(audit.map((row) => row.next_decision).sort(), ['AUTO_CONFIRMED', 'NEEDS_DISPATCH']);

    const staffJobs = await createOrderRepository(pool).listStaffJobs(fixture.employeeId, {
      page: 1, pageSize: 20, fromUtc: null, toUtc: null, q: '', sort: 'schedule-asc',
    });
    assert.deepEqual(staffJobs.items.map((order) => order.id), [results[ownerIndex].id]);

    const adminAccount = fixture.account('AutomationAdmin');
    const [adminInsert] = await pool.execute(
      `INSERT INTO users (full_name,phone,email,password_hash,role,status)
       VALUES (?,?,?,?,'ADMIN','ACTIVE')`,
      [adminAccount.name, adminAccount.phone, adminAccount.email, await hashPassword(adminAccount.password)],
    );
    await fixture.record('users', adminInsert.insertId);
    const adminLogin = await fetch(`${stack.urls.gateway}/api/v1/portal-auth/login`, {
      method: 'POST',
      headers: { Origin: stack.config.origins.admin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: adminAccount.email, password: adminAccount.password, role: 'admin' }),
    });
    assert.equal(adminLogin.status, 200);
    const adminCookie = adminLogin.headers.get('set-cookie')?.split(';')[0];
    assert.ok(adminCookie);
    const adminOrderPath = `${stack.urls.gateway}/api/v1/admin/orders/${results[queueIndex].id}`;
    const adminOrder = await fetch(adminOrderPath, { headers: { Origin: stack.config.origins.admin, Cookie: adminCookie } });
    assert.equal(adminOrder.status, 200);
    const conflictingAssignment = await fetch(`${adminOrderPath}/decisions`, {
      method: 'POST',
      headers: { Origin: stack.config.origins.admin, Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'assign', reason: 'Kiểm thử không cho phép trùng lịch', branchId: fixture.branchId,
        employeeId: fixture.employeeId, scheduledAt: start.toISOString(), durationMinutes: 120,
      }),
    });
    assert.equal(conflictingAssignment.status, 409);
    const adminUpdate = await fetch(`${adminOrderPath}/decisions`, {
      method: 'POST',
      headers: { Origin: stack.config.origins.admin, Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'needs-admin', reason: 'Cần admin kiểm tra fixture điều phối' }),
    });
    assert.equal(adminUpdate.status, 200);
    const [adminAudit] = await pool.execute(
      `SELECT actor_type, actor_id, action FROM booking_decision_history
       WHERE booking_id = ? ORDER BY id`, [results[queueIndex].id],
    );
    assert.equal(adminAudit.at(-1).actor_type, 'ADMIN');
    assert.equal(String(adminAudit.at(-1).actor_id), String(adminInsert.insertId));

    const [inventoryBefore] = await pool.execute(
      'SELECT reserved_quantity FROM product_inventory WHERE product_id = ?', [fixture.productId],
    );
    const productOrderResponse = await fetch(`${stack.urls.gateway}/api/v1/product-orders`, {
      method: 'POST',
      headers: { Origin: stack.config.origin, Cookie: customers[0].cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestKey: randomUUID(),
        items: [{ productId: fixture.productId, quantity: 1, expectedUnitPrice: 42000 }],
        contact: { name: customers[0].account.name, phone: customers[0].account.phone },
        paymentMethod: 'cash',
      }),
    });
    assert.equal(productOrderResponse.status, 201);
    const productOrder = (await productOrderResponse.json()).data;
    await fixture.recordProductOrder(productOrder.id);
    assert.equal(productOrder.status, 'pending');
    const [inventoryAfter] = await pool.execute(
      'SELECT reserved_quantity FROM product_inventory WHERE product_id = ?', [fixture.productId],
    );
    assert.equal(Number(inventoryAfter[0].reserved_quantity), Number(inventoryBefore[0].reserved_quantity) + 1);
  } finally {
    if (stack) await stack.close();
    if (fixture) await fixture.cleanup();
    await pool.end();
  }
});
