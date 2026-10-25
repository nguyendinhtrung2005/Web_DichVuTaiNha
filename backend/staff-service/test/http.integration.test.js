import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { jwtVerify, importSPKI, createRemoteJWKSet } from 'jose'
import { httpTestPlan, readHttpTokens } from '../scripts/http-test-config.js'
import { loadConfig } from '../src/config.js'
import { createPool } from '../src/db.js'
import { MysqlStaffRepository } from '../src/repository.js'
import { OrderClient } from '../src/order-client.js'
import { listQuery } from '../src/validation.js'
import { iso, previousStatus } from '../src/mapping.js'

const plan = httpTestPlan(process.env)
const people = {
  A: { userId: '9109002', employeeId: '9109004', assignmentId: '9109008', sharedAssignmentId: '9109133' },
  B: { userId: '9109101', employeeId: '9109102', assignmentId: '9109105', sharedAssignmentId: '9109134' },
  CUSTOMER: { userId: '9109001' },
}
const sharedBookingId = '9109131'
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const vietnamDay = value => new Date(Date.parse(iso(value)) + 7 * 3600000).toISOString().slice(0, 10)
const second = value => value == null ? null : new Date(Math.floor(Date.parse(iso(value)) / 1000) * 1000).toISOString()
const ids = values => values.map(value => String(value.assignmentId || value.id))
const jobState = row => ({ id: String(row.id), status: row.status, bookingStatus: row.bookingStatus, assignedAt: iso(row.assignedAt), checkInAt: iso(row.checkInAt), checkOutAt: iso(row.checkOutAt) })

// This suite calls an EXISTING Staff server, authenticates using Auth-issued
// RS256 tokens, and reads an existing MySQL test database. It never starts a
// mock server, signs tokens, replaces middleware, seeds SQL or resets data.
test('real Staff HTTP/JWT integration; dependencies must be running and tokens supplied', {
  skip: plan.enabled ? false : 'NOT RUN: set RUN_STAFF_HTTP_TESTS=true only after real Auth/Staff and multi-employee fixtures are ready.',
  timeout: 240000,
}, async t => {
  const config = loadConfig()
  assert.equal(config.jwt.algorithm, 'RS256', 'Real HTTP integration requires the agreed Auth RS256 contract')
  const tokens = await readHttpTokens(process.env)
  const verificationKey = config.jwt.jwksUrl
    ? createRemoteJWKSet(new URL(config.jwt.jwksUrl), { timeoutDuration: 5000 })
    : await importSPKI(config.jwt.publicKey, 'RS256')
  for (const name of Object.keys(people)) {
    let payload
    try {
      ;({ payload } = await jwtVerify(tokens[name], verificationKey, { algorithms: ['RS256'], issuer: config.jwt.issuer, audience: config.jwt.audience, requiredClaims: ['sub', 'exp'] }))
    } catch { throw new Error('Auth token verification failed for STAFF_HTTP_TOKEN_' + name + '; token contents are withheld') }
    assert.equal(payload.sub, people[name].userId, 'Auth token must reference the matching fixture users.id')
    assert.ok(name === 'CUSTOMER' ? payload.role?.toUpperCase() === 'CUSTOMER' : ['EMPLOYEE', 'STAFF'].includes(payload.role?.toUpperCase()), 'Auth token has an unexpected role')
    if (payload.userId !== undefined) assert.equal(String(payload.userId), payload.sub, 'Optional userId must agree with sub')
  }
  const pool = createPool(config.db)
  const repository = new MysqlStaffRepository(pool)
  const order = new OrderClient(config.order)
  const sql = (query, bindings = []) => repository.connection(async connection => (await connection.execute(query, bindings))[0])
  const protectedSnapshot = async () => ({
    users: await sql('SELECT id, role, status FROM users ORDER BY id'),
    employees: await sql('SELECT id, user_id, status, branch_id FROM employees ORDER BY id'),
    services: await sql('SELECT id, category_id, base_price, duration_minutes, is_active FROM services ORDER BY id'),
    bookingAmountsAndSchedules: await sql('SELECT id, customer_id, branch_id, scheduled_start, scheduled_end, total_amount FROM bookings ORDER BY id'),
    items: await sql('SELECT id, booking_id, service_id, service_name_snapshot, quantity, unit_price, unit_snapshot FROM booking_items ORDER BY id'),
    bookings: await sql('SELECT id, customer_id, branch_id, scheduled_start, scheduled_end, status, total_amount FROM bookings WHERE id<>? ORDER BY id', [sharedBookingId]),
    assignments: await sql('SELECT id, booking_id, employee_id, status, assigned_at, check_in_at, check_out_at FROM assignments WHERE booking_id<>? ORDER BY id', [sharedBookingId]),
  })
  const history = () => sql('SELECT id, status, note, created_at FROM booking_status_history WHERE booking_id=? ORDER BY id', [sharedBookingId])
  const sharedState = async () => ({
    booking: await sql('SELECT id, status FROM bookings WHERE id=?', [sharedBookingId]),
    assignments: await sql('SELECT id, status, check_in_at, check_out_at FROM assignments WHERE booking_id=? ORDER BY id', [sharedBookingId]),
    history: await history(),
  })
  let protectedBefore, sharedBefore
  t.after(async () => {
    try {
      if (protectedBefore) assert.equal(hash(await protectedSnapshot()), hash(protectedBefore), 'Unrelated fixture data changed during HTTP checks')
      if (sharedBefore && !plan.writeEnabled) assert.equal(hash(await sharedState()), hash(sharedBefore), 'Read-only HTTP checks changed shared fixture data')
    } finally { await pool.end() }
  })
  await repository.assertSchema()
  const [database] = await sql('SELECT DATABASE() AS name')
  assert.equal(database.name, 'cleanhome_staff_test')
  for (const name of ['A', 'B']) {
    const employee = await repository.findEmployeeByUserId(people[name].userId)
    assert.ok(employee, 'Run the reviewed multi-employee SQL manually before opting into HTTP tests')
    assert.equal(employee.id, people[name].employeeId)
    assert.equal(employee.status, 'ACTIVE'); assert.equal(employee.userStatus, 'ACTIVE')
    assert.ok(await repository.findJob(employee.id, people[name].assignmentId), 'Expected an owned fixture assignment')
    assert.ok(await repository.findJob(employee.id, people[name].sharedAssignmentId), 'Expected a shared-booking fixture assignment')
  }
  const [shared] = await sql("SELECT id, status, JSON_UNQUOTE(JSON_EXTRACT(address_snapshot,'$._cleanhome_fixture')) AS marker FROM bookings WHERE id=?", [sharedBookingId])
  assert.ok(shared, 'Shared fixture must exist')
  assert.equal(shared.marker, 'cleanhome-staff-uc9-uc12-multi-v1')
  protectedBefore = await protectedSnapshot()
  sharedBefore = await sharedState()
  const allAssignments = await sql('SELECT id FROM assignments')
  const taken = new Set(allAssignments.map(row => String(row.id)))
  let unused = 9223372036854775807n
  while (taken.has(String(unused))) unused--
  const unknownAssignmentId = String(unused)
  const request = async (method, path, person, { body, key } = {}) => {
    let response
    try {
      response = await fetch(plan.baseUrl + path, {
        method, redirect: 'error', signal: AbortSignal.timeout(plan.timeoutMs),
        headers: { Accept: 'application/json', ...(person ? { Authorization: 'Bearer ' + tokens[person] } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...(key ? { 'Idempotency-Key': key } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
      const text = await response.text()
      if (text.length > 1024 * 1024) throw new Error('Response too large')
      return { status: response.status, body: JSON.parse(text) }
    } catch { throw new Error('HTTP request failed or response was invalid for ' + method + ' ' + path + '; response/token contents are withheld') }
  }
  const expectStatus = (result, expected) => assert.equal(result.status, expected, 'Unexpected HTTP status; response contents are withheld')
  const live = await request('GET', '/health/live')
  expectStatus(live, 200)
  assert.equal(live.body.service, 'staff-service')
  let readFailure = false
  const readCheck = (name, callback) => t.test(name, async () => {
    try { await callback() } catch (error) { readFailure = true; throw error }
  })

  await readCheck('401 for a request without a token; no synthetic identity headers', async () => {
    const result = await request('GET', '/api/v1/staff/me/jobs')
    expectStatus(result, 401); assert.equal(result.body.error?.code, 'UNAUTHENTICATED')
  })
  await readCheck('403 for a real, cryptographically verified Customer token', async () => {
    const result = await request('GET', '/api/v1/staff/me/jobs', 'CUSTOMER')
    expectStatus(result, 403); assert.equal(result.body.error?.code, 'STAFF_ACCESS_REQUIRED')
  })
  await readCheck('A and B cannot fetch each other\'s own or shared-booking assignment', async () => {
    for (const [reader, owner] of [['A', 'B'], ['B', 'A']]) {
      for (const id of [people[owner].assignmentId, people[owner].sharedAssignmentId]) {
        const result = await request('GET', '/api/v1/staff/me/jobs/' + id, reader)
        expectStatus(result, 404); assert.equal(result.body.error?.code, 'JOB_NOT_FOUND')
      }
    }
  })
  await readCheck('UC9 lists, sorts, filters and paginates the same owned rows as MySQL', async () => {
    for (const name of ['A', 'B']) {
      const expected = await repository.findJobs(people[name].employeeId, listQuery({ pageSize: '100' }))
      assert.ok(expected.total >= (name === 'A' ? 4 : 2), 'Multi-employee fixture is incomplete')
      for (const sort of ['asc', 'desc']) {
        const query = listQuery({ sort, pageSize: '100' })
        const sorted = await repository.findJobs(people[name].employeeId, query)
        const collected = []
        for (let page = 1; page <= Math.ceil(expected.total / 2); page++) {
          assert.ok(page <= 20, 'Integration dataset exceeds the bounded pagination check')
          const result = await request('GET', '/api/v1/staff/me/jobs?sort=' + sort + '&pageSize=2&page=' + page, name)
          expectStatus(result, 200); assert.equal(result.body.pagination.total, expected.total)
          assert.equal(result.body.timezone, 'Asia/Ho_Chi_Minh'); collected.push(...ids(result.body.data))
        }
        assert.deepEqual(collected, ids(sorted.items)); assert.equal(new Set(collected).size, collected.length)
      }
    }
    for (const status of ['WAITING', 'ACCEPTED']) {
      const expected = await repository.findJobs(people.A.employeeId, listQuery({ status, pageSize: '100' }))
      const result = await request('GET', '/api/v1/staff/me/jobs?pageSize=100&status=' + status, 'A')
      expectStatus(result, 200); assert.deepEqual(ids(result.body.data), ids(expected.items))
    }
  })
  await readCheck('UC10 returns the correct booking, snapshots and required contact without credential fields', async () => {
    const result = await request('GET', '/api/v1/staff/me/jobs/' + people.A.assignmentId, 'A')
    expectStatus(result, 200)
    const row = await repository.findJob(people.A.employeeId, people.A.assignmentId)
    assert.equal(result.body.data.assignmentId, row.id); assert.equal(result.body.data.orderId, row.bookingId)
    assert.ok(result.body.data.contact?.phone); assert.ok(result.body.data.contact?.address)
    const snapshots = (await repository.getBookingItems([row.bookingId])).get(row.bookingId)
    assert.deepEqual(result.body.data.services.map(item => ({ id: item.serviceId, quantity: item.quantity, price: item.unitPrice })), snapshots.map(item => ({ id: item.serviceId, quantity: item.quantity, price: item.unitPrice })))
    assert.equal(Object.hasOwn(result.body.data, 'password_hash'), false)
  })
  await readCheck('UC11 uses stored Vietnam calendar days and returns a genuinely empty outside range', async () => {
    const row = await repository.findJob(people.A.employeeId, people.A.assignmentId)
    const from = vietnamDay(row.scheduledStart), to = vietnamDay(row.scheduledEnd)
    const expected = await repository.findJobs(people.A.employeeId, listQuery({ from, to, pageSize: '100' }, true))
    const result = await request('GET', '/api/v1/staff/me/schedule?from=' + from + '&to=' + to + '&pageSize=100', 'A')
    expectStatus(result, 200); assert.equal(result.body.timezone, 'Asia/Ho_Chi_Minh'); assert.deepEqual(ids(result.body.data), ids(expected.items))
    const dto = result.body.data.find(item => item.assignmentId === people.A.assignmentId)
    assert.ok(dto); assert.equal(dto.scheduledAt, iso(row.scheduledStart)); assert.equal(dto.expectedEndAt, iso(row.scheduledEnd))
    const [latest] = await sql('SELECT MAX(scheduled_end) AS lastEnd FROM bookings')
    const outside = vietnamDay(new Date(Date.parse(iso(latest.lastEnd)) + 7 * 86400000))
    const empty = await request('GET', '/api/v1/staff/me/schedule?from=' + outside + '&to=' + outside, 'A')
    expectStatus(empty, 200); assert.deepEqual(empty.body.data, []); assert.equal(empty.body.pagination.total, 0)
  })
  await readCheck('unknown assignments are 404 and invalid dates are 400 through the real server', async () => {
    const missing = await request('GET', '/api/v1/staff/me/jobs/' + unknownAssignmentId, 'A')
    expectStatus(missing, 404); assert.equal(missing.body.error?.code, 'JOB_NOT_FOUND')
    const invalid = await request('GET', '/api/v1/staff/me/schedule?from=2026-02-30&to=2026-03-01', 'A')
    expectStatus(invalid, 400)
  })

  await t.test('UC12 real Order synchronization, multi-worker completion and idempotent retries', {
    skip: plan.writeEnabled ? false : 'NOT RUN: writes need RUN_STAFF_HTTP_WRITE_TESTS=true and STAFF_HTTP_WRITE_BOOKING_ID=9109131; this consumes the shared fixture.',
    timeout: 120000,
  }, async () => {
    assert.equal(readFailure, false, 'HTTP read/auth checks must all pass before any write')
    assert.ok(config.order.baseUrl && config.order.token, 'Configure the real Order Service before opting into write tests')
    const initial = await sharedState()
    assert.equal(initial.booking.length, 1); assert.equal(initial.booking[0].status, 'CONFIRMED')
    assert.equal(initial.assignments.length, 2)
    assert.ok(initial.assignments.every(row => row.status === 'ASSIGNED' && row.check_in_at === null && row.check_out_at === null), 'Full UC12 checks need an unused shared fixture; tests never reset it')
    const hasPriorTransition = initial.history.some(row => {
      try { return JSON.parse(row.note)?.kind === 'cleanhome.staff-transition' } catch { return false }
    })
    assert.equal(hasPriorTransition, false, 'Shared fixture has prior Staff transition history; review it instead of resetting data')
    const journalFor = async operationId => {
      const rows = await history()
      const matched = []
      for (const row of rows) {
        let metadata
        try { metadata = JSON.parse(row.note) } catch { continue }
        if (metadata?.kind === 'cleanhome.staff-transition' && metadata.version === 1 && metadata.operation?.id === operationId) matched.push({ id: String(row.id), metadata })
      }
      assert.equal(matched.length, 1, 'Each operation must have exactly one durable Order journal record')
      return matched[0]
    }
    const rejectedWithoutMutation = async (path, name, body, key, expectedStatus, expectedCode) => {
      const before = hash(await sharedState())
      const result = await request('PATCH', path, name, { body, key })
      expectStatus(result, expectedStatus)
      if (expectedCode) assert.equal(result.body.error?.code, expectedCode)
      assert.equal(hash(await sharedState()), before, 'Rejected request must not change shared assignments, booking or history')
      return result
    }
    for (const [reader, owner] of [['A', 'B'], ['B', 'A']]) {
      await rejectedWithoutMutation('/api/v1/staff/me/jobs/' + people[owner].sharedAssignmentId + '/status', reader, { status: 'ACCEPTED' }, randomUUID(), 404, 'JOB_NOT_FOUND')
    }
    await rejectedWithoutMutation('/api/v1/staff/me/jobs/' + people.A.sharedAssignmentId + '/status', 'A', { status: 'DONE' }, randomUUID(), 409, 'INVALID_TRANSITION')
    const steps = []
    const step = async (name, status, bookingStatus) => {
      const person = people[name], key = randomUUID()
      const operationId = createHash('sha256').update(JSON.stringify([person.userId, person.sharedAssignmentId, key])).digest('hex')
      const operation = { id: operationId, bookingId: sharedBookingId, assignmentId: person.sharedAssignmentId, employeeId: person.employeeId, actorUserId: person.userId, fromStatus: previousStatus[status], toStatus: status }
      const path = '/api/v1/staff/me/jobs/' + person.sharedAssignmentId + '/status'
      const first = await request('PATCH', path, name, { body: { status }, key })
      expectStatus(first, 200); assert.equal(first.body.data.status, status)
      assert.equal(first.body.data.transition?.operationId, operationId); assert.equal(first.body.data.transition?.synchronization, 'SYNCHRONIZED')
      assert.equal(first.body.data.orderAtTransition?.status, bookingStatus)
      const originalAck = await order.getAssignmentTransition(operation)
      assert.ok(originalAck); assert.equal(originalAck.booking.status, bookingStatus)
      const saved = await repository.findJob(person.employeeId, person.sharedAssignmentId)
      assert.equal(saved.status, status); assert.equal(saved.bookingStatus, bookingStatus)
      if (status === 'IN_PROGRESS') assert.equal(iso(saved.checkInAt), second(originalAck.occurredAt))
      if (status === 'DONE') { assert.ok(saved.checkInAt); assert.equal(iso(saved.checkOutAt), second(originalAck.occurredAt)) }
      const journal = await journalFor(operationId)
      assert.equal(journal.metadata.staffAcknowledged, true)
      const countBeforeRetry = (await history()).length
      const replay = await request('PATCH', path, name, { body: { status }, key })
      expectStatus(replay, 200); assert.equal(replay.body.data.transition?.replayed, true)
      assert.equal(replay.body.data.transition?.operationId, operationId)
      assert.equal((await history()).length, countBeforeRetry, 'A duplicate request must not append booking history')
      assert.equal((await journalFor(operationId)).id, journal.id)
      assert.equal(hash(jobState(await repository.findJob(person.employeeId, person.sharedAssignmentId))), hash(jobState(saved)), 'A retry must preserve stored state and timestamps')
      assert.deepEqual(await order.getAssignmentTransition(operation), originalAck)
      const pending = await order.listPendingTransitions({ limit: 100 })
      assert.equal(pending.some(item => item.id === operationId), false)
      steps.push({ name, status, path, key, operation, originalAck })
      if (status === 'ACCEPTED') {
        const conflict = await rejectedWithoutMutation(path, name, { status: 'IN_PROGRESS' }, key, 409, 'ORDER_REJECTED')
        assert.ok(['IDEMPOTENCY_CONFLICT', 'OPERATION_CONFLICT'].includes(conflict.body.error?.details?.reason), 'Order must identify the reused operation payload conflict')
      }
    }
    await step('A', 'ACCEPTED', 'CONFIRMED')
    await step('B', 'ACCEPTED', 'CONFIRMED')
    await step('A', 'IN_PROGRESS', 'IN_PROGRESS')
    await step('B', 'IN_PROGRESS', 'IN_PROGRESS')
    await step('A', 'DONE', 'IN_PROGRESS')
    assert.equal((await repository.findJob(people.B.employeeId, people.B.sharedAssignmentId)).status, 'IN_PROGRESS', 'One finished employee must not complete the whole booking')
    await step('B', 'DONE', 'COMPLETED')
    const completed = await sharedState()
    assert.equal(completed.booking[0].status, 'COMPLETED')
    assert.ok(completed.assignments.every(row => row.status === 'DONE'))
    for (const earliest of steps.filter(step => step.status === 'ACCEPTED')) {
      const before = hash(await sharedState())
      const replay = await request('PATCH', earliest.path, earliest.name, { body: { status: earliest.status }, key: earliest.key })
      expectStatus(replay, 200)
      assert.equal(replay.body.data.status, 'DONE', 'An old key must not rewind current assignment state')
      assert.equal(replay.body.data.transition?.replayed, true)
      assert.equal(replay.body.data.orderAtTransition?.status, earliest.originalAck.booking.status)
      assert.deepEqual(await order.getAssignmentTransition(earliest.operation), earliest.originalAck)
      assert.equal(hash(await sharedState()), before, 'Old operation replay after completion must preserve state and journal')
    }
  })
})
