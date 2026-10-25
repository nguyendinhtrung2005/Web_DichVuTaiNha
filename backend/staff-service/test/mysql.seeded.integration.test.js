import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createPool } from '../src/db.js'
import { MysqlStaffRepository } from '../src/repository.js'
import { StaffJobService } from '../src/job-service.js'
import { OrderClient } from '../src/order-client.js'
import { listQuery, mysqlTime } from '../src/validation.js'
import { iso } from '../src/mapping.js'

const enabled = process.env.RUN_MYSQL_TESTS === 'true'
const fixture = { customerUserId: '9109001', staffUserId: '9109002', employeeId: '9109004', serviceId: '9109006', bookingId: '9109007', assignmentId: '9109008' }
const hasFixture = result => result.items.some(row => row.id === fixture.assignmentId)
const hasDto = result => result.data.some(row => row.assignmentId === fixture.assignmentId)
const vietnamDay = value => new Date(Date.parse(iso(value)) + 7 * 3600000).toISOString().slice(0, 10)
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')

// Real database/repository/service integration only. No HTTP server, JWT issuer,
// replacement auth middleware, state transition, seed execution or Order mock.
// Direct service calls below test business authorization, not token verification.
test('UC9–UC11 seeded MySQL reads and business authorization without HTTP or data writes', {
  skip: enabled ? false : 'Set RUN_MYSQL_TESTS=true after manually seeding cleanhome_staff_test.', timeout: 30000,
}, async t => {
  assert.equal(process.env.MYSQL_DATABASE, 'cleanhome_staff_test', 'Seeded checks require the dedicated test database')
  assert.ok(process.env.MYSQL_USER, 'MYSQL_USER is required')
  const pool = createPool({ host: process.env.MYSQL_HOST || '127.0.0.1', port: Number(process.env.MYSQL_PORT || 3306), user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD || '', database: process.env.MYSQL_DATABASE, connectionLimit: 1 })
  const repository = new MysqlStaffRepository(pool)
  const service = new StaffJobService({ repository, orderClient: new OrderClient({}) })
  // This is an explicit service test input using a real database user ID. It is
  // never submitted to HTTP or represented as a successfully verified JWT.
  const actor = { userId: fixture.staffUserId }
  const snapshotQueries = {
    users: 'SELECT id, role, status FROM users ORDER BY id',
    employees: 'SELECT id, user_id, branch_id, status FROM employees ORDER BY id',
    branches: 'SELECT id, status FROM branches ORDER BY id',
    categories: 'SELECT id, is_active FROM service_categories ORDER BY id',
    services: 'SELECT id, category_id, base_price, duration_minutes, is_active FROM services ORDER BY id',
    bookings: 'SELECT id, customer_id, branch_id, scheduled_start, scheduled_end, status, total_amount FROM bookings ORDER BY id',
    items: 'SELECT id, booking_id, service_id, quantity, unit_price, unit_snapshot FROM booking_items ORDER BY id',
    assignments: 'SELECT id, booking_id, employee_id, assigned_at, check_in_at, check_out_at, status FROM assignments ORDER BY id',
  }
  const snapshot = () => repository.connection(async connection => {
    const result = {}
    for (const [name, sql] of Object.entries(snapshotQueries)) {
      const [rows] = await connection.execute(sql)
      result[name] = rows
    }
    return result
  })
  let before
  t.after(async () => {
    try {
      if (before) assert.equal(digest(await snapshot()), digest(before), 'Read-only checks must preserve database state')
    } finally { await pool.end() }
  })
  await repository.assertSchema()
  before = await snapshot()
  const usedIds = new Set(Object.values(before).flat().map(row => String(row.id)))
  let candidate = 9223372036854775807n
  while (usedIds.has(String(candidate))) candidate--
  const unusedId = String(candidate)
  let linked, list

  await t.test('fixture foreign-key chain connects the real Staff, Customer, Booking and Assignment', async () => {
    linked = await repository.connection(async connection => {
      const [rows] = await connection.execute(`SELECT a.id AS assignmentId, a.booking_id AS bookingId,
        a.employee_id AS employeeId, a.status AS assignmentStatus, e.user_id AS staffUserId,
        e.status AS employeeStatus, u.role AS staffRole, u.status AS staffStatus,
        b.customer_id AS customerUserId, c.role AS customerRole, e.branch_id AS employeeBranchId,
        b.branch_id AS bookingBranchId, b.scheduled_start AS scheduledStart, b.scheduled_end AS scheduledEnd
        FROM assignments a JOIN employees e ON e.id=a.employee_id
        JOIN users u ON u.id=e.user_id JOIN bookings b ON b.id=a.booking_id
        JOIN users c ON c.id=b.customer_id WHERE a.id=?`, [fixture.assignmentId])
      assert.equal(rows.length, 1, 'The manually seeded assignment and all required parents must exist')
      return rows[0]
    })
    for (const key of ['assignmentId', 'bookingId', 'employeeId', 'staffUserId', 'customerUserId']) assert.equal(String(linked[key]), fixture[key])
    assert.equal(linked.staffRole, 'EMPLOYEE'); assert.equal(linked.customerRole, 'CUSTOMER')
    assert.equal(linked.employeeStatus, 'ACTIVE'); assert.equal(linked.staffStatus, 'ACTIVE')
    assert.equal(linked.employeeBranchId, linked.bookingBranchId)
    assert.ok(Date.parse(iso(linked.scheduledStart)) < Date.parse(iso(linked.scheduledEnd)))
  })

  await t.test('user lookup resolves Employee ID and does not grant Customer an employee profile', async () => {
    const employee = await repository.findEmployeeByUserId(fixture.staffUserId)
    assert.equal(employee.id, fixture.employeeId); assert.equal(employee.userId, fixture.staffUserId)
    assert.equal(await repository.findEmployeeByUserId(fixture.customerUserId), null)
    assert.equal(await repository.findEmployeeByUserId(unusedId), null)
  })

  await t.test('UC9 returns the assigned work, filters by current status and preserves pagination totals', async () => {
    list = await repository.findJobs(fixture.employeeId, listQuery({}))
    assert.ok(hasFixture(list)); assert.ok(list.total >= 1)
    assert.ok(list.items.every(row => row.employeeId === fixture.employeeId))
    const filtered = await repository.findJobs(fixture.employeeId, listQuery({ status: linked.assignmentStatus }))
    assert.ok(hasFixture(filtered)); assert.ok(filtered.items.every(row => row.status === linked.assignmentStatus))
    const first = await repository.findJobs(fixture.employeeId, listQuery({ page: '1', pageSize: '1', sort: 'desc' }))
    const last = await repository.findJobs(fixture.employeeId, listQuery({ page: String(list.total + 1), pageSize: '1', sort: 'desc' }))
    assert.equal(first.items.length, 1); assert.equal(last.total, list.total); assert.deepEqual(last.items, [])
  })

  await t.test('UC10 resolves the owned detail and reads the saved service/decimal snapshots', async () => {
    const row = await repository.findJob(fixture.employeeId, fixture.assignmentId)
    assert.equal(row.bookingId, fixture.bookingId); assert.equal(row.employeeId, fixture.employeeId)
    const snapshots = await repository.getBookingItems([row.bookingId])
    const item = snapshots.get(row.bookingId).find(value => value.serviceId === fixture.serviceId)
    assert.ok(item); assert.equal(item.quantity, '2.00'); assert.equal(item.unitPrice, '100000.00')
    assert.equal(item.unit, 'giờ'); assert.ok(item.serviceName)
  })

  await t.test('unknown assignment and confirmed-unused employee cannot retrieve existing work', async () => {
    assert.equal(await repository.findJob(fixture.employeeId, unusedId), null)
    assert.equal(await repository.findJob(unusedId, fixture.assignmentId), null)
    const empty = await repository.findJobs(unusedId, listQuery({}))
    assert.equal(empty.total, 0); assert.deepEqual(empty.items, [])
    // Only one actual Employee is seeded: this checks SQL scoping, not two
    // real employees authenticating with different tokens over HTTP.
  })

  await t.test('UC11 uses the saved Vietnam calendar day and includes partial overlaps only', async () => {
    const range = listQuery({ from: vietnamDay(linked.scheduledStart), to: vietnamDay(linked.scheduledEnd) }, true)
    assert.ok(hasFixture(await repository.findJobs(fixture.employeeId, range)))
    const start = Date.parse(iso(linked.scheduledStart)), end = Date.parse(iso(linked.scheduledEnd))
    const query = { page: 1, pageSize: 100, sort: 'asc' }
    const overlap = await repository.findJobs(fixture.employeeId, { ...query, fromUtc: mysqlTime(new Date(start + (end - start) / 4)), toUtc: mysqlTime(new Date(end - (end - start) / 4)) })
    const beforeStart = await repository.findJobs(fixture.employeeId, { ...query, fromUtc: mysqlTime(new Date(start - 3600000)), toUtc: mysqlTime(new Date(start)) })
    const afterEnd = await repository.findJobs(fixture.employeeId, { ...query, fromUtc: mysqlTime(new Date(end)), toUtc: mysqlTime(new Date(end + 3600000)) })
    assert.ok(hasFixture(overlap)); assert.equal(hasFixture(beforeStart), false); assert.equal(hasFixture(afterEnd), false)
  })

  await t.test('empty schedule outside every stored booking and invalid date ranges remain safe', async () => {
    const latestEnd = Math.max(...before.bookings.map(row => Date.parse(iso(row.scheduled_end))))
    const outsideDay = vietnamDay(new Date(latestEnd + 7 * 86400000))
    const empty = await repository.findJobs(fixture.employeeId, listQuery({ from: outsideDay, to: outsideDay }, true))
    assert.equal(empty.total, 0); assert.deepEqual(empty.items, [])
    const unowned = await repository.findJobs(unusedId, listQuery({ from: vietnamDay(linked.scheduledStart), to: vietnamDay(linked.scheduledEnd) }, true))
    assert.deepEqual(unowned.items, [])
    assert.throws(() => listQuery({ from: '2026-02-30', to: '2026-03-01' }, true), { status: 400 })
    assert.throws(() => listQuery({ from: '2026-10-24', to: '2026-10-23' }, true), { status: 400 })
  })

  await t.test('direct service list/detail/schedule return database DTOs without calling Order or HTTP', async () => {
    const result = await service.list(actor, listQuery({}))
    const dto = result.data.find(value => value.assignmentId === fixture.assignmentId)
    assert.ok(dto); assert.equal(dto.orderId, fixture.bookingId); assert.equal(dto.contact.phone, undefined)
    const detail = (await service.detail(actor, fixture.assignmentId)).data
    assert.equal(detail.assignmentId, fixture.assignmentId); assert.equal(detail.services.length, 1)
    assert.ok(detail.contact.phone); assert.ok(detail.contact.address)
    assert.equal(detail.password_hash, undefined); assert.equal(detail.orderHistory, null)
    assert.equal(detail.cancellationPending, null); assert.equal(detail.historySource, 'order-service-not-loaded')
    const range = listQuery({ from: vietnamDay(linked.scheduledStart), to: vietnamDay(linked.scheduledEnd) }, true)
    assert.ok(hasDto(await service.list(actor, range)))
  })

  await t.test('business layer rejects Customer/missing user and reports a missing assignment without fabricating authentication', async () => {
    for (const userId of [fixture.customerUserId, unusedId]) {
      await assert.rejects(service.list({ userId }, listQuery({})), { status: 403, code: 'STAFF_INACTIVE' })
      await assert.rejects(service.detail({ userId }, fixture.assignmentId), { status: 403, code: 'STAFF_INACTIVE' })
    }
    await assert.rejects(service.detail(actor, unusedId), { status: 404, code: 'JOB_NOT_FOUND' })
  })

  await t.test('all checked data, saved order state, assignment state and timestamps are unchanged', async () => {
    assert.equal(digest(await snapshot()), digest(before))
  })
})
