import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { SignJWT } from 'jose'
import { createAuthenticate } from '../src/auth.js'
import { createApp } from '../src/app.js'
import { StaffJobService } from '../src/job-service.js'
import { HttpError } from '../src/errors.js'
import { listQuery } from '../src/validation.js'

// Dependency doubles are used only by these tests, never by the production runtime.
function dependencies() {
  const rows = new Map([
    ['1', { id: '1', bookingId: '101', employeeId: '10', status: 'ASSIGNED', bookingStatus: 'CONFIRMED', scheduledStart: '2026-01-02 01:00:00', scheduledEnd: '2026-01-02 03:00:00', assignedAt: '2026-01-01 00:00:00', checkInAt: null, checkOutAt: null, addressSnapshot: { address_text: 'Địa chỉ kiểm thử', recipient: 'Khách hàng' }, customerName: 'Khách hàng', customerPhone: 'contact-only' }],
    ['2', { id: '2', bookingId: '102', employeeId: '10', status: 'ASSIGNED', bookingStatus: 'CONFIRMED', scheduledStart: '2026-01-03 01:00:00', scheduledEnd: '2026-01-03 03:00:00', assignedAt: '2026-01-01 00:00:00', checkInAt: null, checkOutAt: null, addressSnapshot: { address_text: 'Địa chỉ thứ hai' }, customerName: 'Khách hàng', customerPhone: 'contact-only' }],
    ['3', { id: '3', bookingId: '103', employeeId: '20', status: 'ASSIGNED', bookingStatus: 'CONFIRMED', scheduledStart: '2026-01-02 01:00:00', scheduledEnd: '2026-01-02 03:00:00', assignedAt: '2026-01-01 00:00:00', checkInAt: null, checkOutAt: null, addressSnapshot: { address_text: 'Không được lộ' } }],
  ])
  let failCommit = false
  let inactive = false
  const locks = new Map()
  const repository = {
    async assertSchema() {},
    async findEmployeeByUserId(userId) { return { id: userId === '100' ? '10' : '20', userId, status: inactive ? 'INACTIVE' : 'ACTIVE', userStatus: 'ACTIVE', userRole: 'EMPLOYEE' } },
    async findJobs(employeeId, query) {
      let list = [...rows.values()].filter(row => row.employeeId === employeeId && (!query.status || row.status === query.status))
      if (query.fromUtc) list = list.filter(row => row.scheduledStart < query.toUtc && row.scheduledEnd > query.fromUtc)
      list.sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart) * (query.sort === 'desc' ? -1 : 1))
      return { items: structuredClone(list.slice((query.page - 1) * query.pageSize, query.page * query.pageSize)), total: list.length }
    },
    async findJob(employeeId, id) { const row = rows.get(id); return row?.employeeId === employeeId ? structuredClone(row) : null },
    async getBookingItems(ids) { return new Map(ids.map(id => [id, [{ serviceId: '11', serviceName: 'Dịch vụ kiểm thử', unit: 'giờ', quantity: '2.00', unitPrice: '100.00' }]])) },
    async withLockedAssignment(employeeId, id, callback) {
      const prior = locks.get(id) || Promise.resolve()
      let release
      const done = new Promise(resolve => { release = resolve })
      const queued = prior.then(() => done)
      locks.set(id, queued)
      await prior
      try {
        let draft = await this.findJob(employeeId, id)
        if (!draft) throw new HttpError(404, 'JOB_NOT_FOUND', 'Không tìm thấy công việc.')
        const result = await callback({ assignment: draft, async updateStatus(status, occurredAt) {
          draft.status = status
          if (status === 'IN_PROGRESS') draft.checkInAt = occurredAt
          if (status === 'DONE') draft.checkOutAt = occurredAt
          return structuredClone(draft)
        } })
        if (failCommit) throw new HttpError(503, 'DATABASE_UNAVAILABLE', 'Simulated database commit failure')
        rows.set(id, draft)
        return result
      } finally { release(); if (locks.get(id) === queued) locks.delete(id) }
    },
  }
  const operations = new Map()
  let unavailable = false, pendingCancel = false, failAck = false, applyCount = 0
  const orderClient = {
    async getAssignmentTransition(op) {
      if (unavailable) throw new HttpError(503, 'ORDER_UNAVAILABLE', 'Order unavailable')
      const saved = operations.get(op.id)
      if (saved && ['bookingId', 'assignmentId', 'actorUserId', 'fromStatus', 'toStatus'].some(key => saved[key] !== op[key])) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', 'Key reused')
      return saved?.ack || null
    },
    async applyAssignmentTransition(op) {
      if (unavailable) throw new HttpError(503, 'ORDER_UNAVAILABLE', 'Order unavailable')
      if (pendingCancel && op.toStatus === 'IN_PROGRESS') throw new HttpError(409, 'ORDER_REJECTED', 'Cancellation pending')
      applyCount++
      const ack = { operationId: op.id, assignmentId: op.assignmentId, bookingId: op.bookingId, assignmentStatus: op.toStatus, occurredAt: '2026-01-02T02:00:00.000Z', booking: { id: op.bookingId, status: op.toStatus === 'DONE' ? 'COMPLETED' : op.toStatus === 'IN_PROGRESS' ? 'IN_PROGRESS' : 'CONFIRMED' } }
      operations.set(op.id, { ...op, ack, synced: false })
      return ack
    },
    async ackAssignmentTransition(op) { if (failAck) throw new HttpError(503, 'ORDER_UNAVAILABLE', 'Ack unavailable'); operations.get(op.id).synced = true },
    async listPendingTransitions({ limit }) { return [...operations.values()].filter(op => !op.synced).slice(0, limit) },
  }
  return { repository, orderClient, rows, operations, get applyCount() { return applyCount }, set failCommit(value) { failCommit = value }, set unavailable(value) { unavailable = value }, set pendingCancel(value) { pendingCancel = value }, set failAck(value) { failAck = value }, set inactive(value) { inactive = value } }
}

test('UC9–UC12 HTTP routes with verified JWT and explicitly mocked repositories/Order dependency', { timeout: 15000 }, async t => {
  const mock = dependencies(), key = randomBytes(48)
  const authenticate = createAuthenticate({ jwt: { issuer: 'test-issuer', audience: 'staff-tests', algorithm: 'HS256', secret: key.toString('hex') } })
  const service = new StaffJobService(mock)
  const app = createApp({ service, authenticate, repository: mock.repository })
  const server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const base = 'http://127.0.0.1:' + server.address().port
  const token = await new SignJWT({ role: 'EMPLOYEE', status: 'ACTIVE' }).setProtectedHeader({ alg: 'HS256' }).setSubject('100').setIssuer('test-issuer').setAudience('staff-tests').setExpirationTime('5m').sign(new TextEncoder().encode(key.toString('hex')))
  const call = async (path, options = {}) => {
    const response = await fetch(base + path, { ...options, signal: AbortSignal.timeout(3000), headers: { Authorization: 'Bearer ' + token, ...options.headers } })
    return { status: response.status, body: await response.json(), response }
  }
  const patch = (id, status, idempotencyKey = 'operation-key-' + status) => call('/api/v1/staff/me/jobs/' + id + '/status', { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey }, body: JSON.stringify({ status }) })
  await t.test('missing JWT is 401; caller-supplied identity cannot authenticate', async () => {
    const result = await call('/api/v1/staff/me/jobs', { headers: { Authorization: '', 'X-User-Id': '100', 'X-Role': 'STAFF' } })
    assert.equal(result.status, 401)
  })
  await t.test('UC9 only own jobs, pagination and sorting', async () => {
    const result = await call('/api/v1/staff/me/jobs?page=1&pageSize=1&sort=desc')
    assert.equal(result.status, 200); assert.equal(result.body.pagination.total, 2)
    assert.equal(result.body.data.length, 1); assert.equal(result.body.data[0].assignmentId, '2')
    assert.equal(result.body.data[0].contact.phone, undefined)
    assert.equal((await call('/api/v1/staff/me/jobs?status=DONE')).body.data.length, 0)
  })
  await t.test('cannot substitute staffId or inject query fragments', async () => {
    assert.equal((await call('/api/v1/staff/me/jobs?staffId=20')).status, 400)
    assert.equal((await call('/api/v1/staff/me/jobs?sort=asc%3BDROP')).status, 400)
    assert.equal((await call('/api/v1/staff/me/jobs?page=1&page=2')).status, 400)
  })
  await t.test('UC10 own detail and 404 for another employee', async () => {
    const detail = await call('/api/v1/staff/me/jobs/1')
    assert.equal(detail.status, 200); assert.equal(detail.body.data.contact.phone, 'contact-only')
    assert.equal(detail.body.data.specialRequest, null); assert.equal(detail.body.data.orderHistory, null)
    assert.equal((await call('/api/v1/staff/me/jobs/3')).status, 404)
    assert.equal((await call('/api/v1/staff/me/jobs/999')).status, 404)
  })
  await t.test('UC11 day range, overlap, empty schedule and invalid dates', async () => {
    const result = await call('/api/v1/staff/me/schedule?from=2026-01-02&to=2026-01-02')
    assert.equal(result.status, 200); assert.deepEqual(result.body.data.map(row => row.id), ['1'])
    assert.deepEqual((await call('/api/v1/staff/me/schedule?from=2027-01-01&to=2027-01-02')).body.data, [])
    for (const range of ['from=2026-02-30&to=2026-03-01', 'from=2026-01-03&to=2026-01-01', 'from=2026-01-01']) assert.equal((await call('/api/v1/staff/me/schedule?' + range)).status, 400)
  })
  await t.test('status input and ownership are checked', async () => {
    assert.equal((await patch('1', 'DONE')).status, 409)
    assert.equal((await patch('3', 'ACCEPTED')).status, 404)
    assert.equal((await patch('1', 'WAITING')).status, 400)
    assert.equal((await patch('1', 'ACCEPTED', 'bad')).status, 400)
  })
  await t.test('Order outage does not update assignments', async () => {
    mock.unavailable = true
    assert.equal((await patch('1', 'ACCEPTED')).status, 503)
    assert.equal(mock.rows.get('1').status, 'ASSIGNED')
    mock.unavailable = false
  })
  await t.test('accept, duplicate key and same key with different body', async () => {
    assert.equal((await patch('1', 'ACCEPTED', 'key-accept-one')).status, 200)
    assert.equal(mock.rows.get('1').checkInAt, null)
    assert.equal((await patch('1', 'ACCEPTED', 'key-accept-one')).status, 200)
    assert.equal(mock.applyCount, 1)
    assert.equal((await patch('1', 'IN_PROGRESS', 'key-accept-one')).status, 409)
  })
  await t.test('pending cancellation is rejected when Order supports it', async () => {
    mock.pendingCancel = true
    assert.equal((await patch('1', 'IN_PROGRESS')).status, 409)
    assert.equal(mock.rows.get('1').status, 'ACCEPTED')
    mock.pendingCancel = false
  })
  await t.test('check-in/check-out and no duplicate completed transition', async () => {
    assert.equal((await patch('1', 'IN_PROGRESS')).status, 200)
    assert.ok(mock.rows.get('1').checkInAt)
    assert.equal((await patch('1', 'DONE', 'key-done-one')).status, 200)
    const checkout = mock.rows.get('1').checkOutAt
    assert.ok(checkout)
    assert.equal((await patch('1', 'DONE', 'key-done-one')).status, 200)
    assert.equal(mock.rows.get('1').checkOutAt, checkout)
    assert.equal((await patch('1', 'DONE', 'new-done-key')).status, 409)
  })
  await t.test('cancelled jobs and inactive employees cannot update', async () => {
    mock.rows.get('2').bookingStatus = 'CANCELLED'
    assert.equal((await patch('2', 'ACCEPTED')).status, 409)
    mock.rows.get('2').bookingStatus = 'CONFIRMED'
    mock.inactive = true
    assert.equal((await call('/api/v1/staff/me/jobs')).status, 403)
    mock.inactive = false
  })
  await t.test('invalid JSON, oversized bodies and extra fields cannot change assignment state', async () => {
    const before = structuredClone([...mock.rows])
    const path = '/api/v1/staff/me/jobs/2/status'
    const headers = { 'Content-Type': 'application/json', 'Idempotency-Key': 'body-check-key' }
    const malformed = await call(path, { method: 'PATCH', headers, body: '{"status":' })
    assert.equal(malformed.status, 400); assert.equal(malformed.body.error.code, 'INVALID_JSON')
    const large = await call(path, { method: 'PATCH', headers, body: JSON.stringify({ status: 'ACCEPTED', note: 'x'.repeat(17000) }) })
    assert.equal(large.status, 413)
    const extra = await call(path, { method: 'PATCH', headers, body: JSON.stringify({ status: 'ACCEPTED', employeeId: '20' }) })
    assert.equal(extra.status, 400)
    assert.deepEqual([...mock.rows], before)
  })
  await t.test('health distinguishes liveness, missing Order configuration and database readiness failure', async () => {
    assert.equal((await call('/health/live', { headers: { Authorization: '' } })).status, 200)
    const ready = await call('/health/ready')
    assert.equal(ready.status, 503); assert.equal(ready.body.capabilities.mysqlReads, true)
    assert.equal(ready.body.capabilities.orderStatusSynchronizationConfigured, false)
    const check = mock.repository.assertSchema
    mock.repository.assertSchema = async () => { throw new HttpError(503, 'DATABASE_UNAVAILABLE', 'Chưa kết nối MySQL.') }
    try {
      const failure = await call('/health/ready')
      assert.equal(failure.status, 503); assert.equal(failure.response.headers.get('retry-after'), '5')
      assert.equal(failure.body.error.code, 'DATABASE_UNAVAILABLE')
    } finally { mock.repository.assertSchema = check }
  })
  await t.test('CORS allows Staff origin and rejects unrelated origins', async () => {
    assert.equal((await call('/api/v1/staff/me/jobs', { headers: { Origin: 'http://localhost:3002' } })).response.headers.get('access-control-allow-origin'), 'http://localhost:3002')
    assert.equal((await call('/api/v1/staff/me/jobs', { headers: { Origin: 'https://unrelated.invalid' } })).status, 403)
  })
})

test('Order durable journal recovers a Staff database commit failure', async () => {
  const mock = dependencies(), service = new StaffJobService(mock), actor = { userId: '100', role: 'staff' }
  mock.failCommit = true
  await assert.rejects(service.advance(actor, '1', { status: 'ACCEPTED', idempotencyKey: 'recover-one' }), error => error.status === 503 && error.code === 'RECONCILIATION_REQUIRED')
  assert.equal(mock.rows.get('1').status, 'ASSIGNED')
  assert.equal(mock.operations.size, 1)
  mock.failCommit = false
  const results = await service.reconcile(10)
  assert.equal(results[0].synchronized, true)
  assert.equal(mock.rows.get('1').status, 'ACCEPTED')
  assert.equal(mock.applyCount, 1)
})
test('acknowledgement failure returns 202 and can be reconciled', async () => {
  const mock = dependencies(), service = new StaffJobService(mock)
  mock.failAck = true
  const result = await service.advance({ userId: '100' }, '1', { status: 'ACCEPTED', idempotencyKey: 'ack-pending' })
  assert.equal(result.httpStatus, 202)
  assert.equal(result.body.data.transition.synchronization, 'PENDING_ACKNOWLEDGEMENT')
  mock.failAck = false
  assert.equal((await service.reconcile(10))[0].synchronized, true)
})
test('concurrent duplicates commit only one Order operation', async () => {
  const mock = dependencies(), service = new StaffJobService(mock)
  await Promise.all([1, 2].map(() => service.advance({ userId: '100' }, '1', { status: 'ACCEPTED', idempotencyKey: 'parallel-one' })))
  assert.equal(mock.applyCount, 1)
})
test('finishing one assignment preserves the Order acknowledgement for a multi-employee booking', async () => {
  const mock = dependencies(), service = new StaffJobService(mock)
  const row = mock.rows.get('1')
  row.status = 'IN_PROGRESS'
  row.bookingStatus = 'IN_PROGRESS'
  row.checkInAt = '2026-01-02T01:00:00.000Z'
  const apply = mock.orderClient.applyAssignmentTransition.bind(mock.orderClient)
  mock.orderClient.applyAssignmentTransition = async operation => {
    const ack = await apply(operation)
    // Another employee is still working; only Order owns this aggregate decision.
    ack.booking.status = 'IN_PROGRESS'
    return ack
  }
  const result = await service.advance({ userId: '100' }, '1', { status: 'DONE', idempotencyKey: 'multi-employee-done' })
  assert.equal(result.body.data.status, 'DONE')
  assert.equal(result.body.data.orderAtTransition.status, 'IN_PROGRESS')
  assert.equal(mock.rows.get('1').bookingStatus, 'IN_PROGRESS')
  assert.ok(mock.rows.get('1').checkOutAt)
})

test('fresh database role/user/employee state denies access before any Order request', async () => {
  for (const state of [null, { status: 'INACTIVE', userStatus: 'ACTIVE', userRole: 'EMPLOYEE' }, { status: 'ACTIVE', userStatus: 'LOCKED', userRole: 'EMPLOYEE' }, { status: 'ACTIVE', userStatus: 'ACTIVE', userRole: 'CUSTOMER' }]) {
    const mock = dependencies(), service = new StaffJobService(mock)
    mock.repository.findEmployeeByUserId = async () => state && { id: '10', ...state }
    await assert.rejects(service.list({ userId: '100' }, listQuery({})), { status: 403 })
    await assert.rejects(service.detail({ userId: '100' }, '1'), { status: 403 })
    await assert.rejects(service.advance({ userId: '100' }, '1', { status: 'ACCEPTED', idempotencyKey: 'blocked-user' }), { status: 403 })
    assert.equal(mock.applyCount, 0); assert.equal(mock.rows.get('1').status, 'ASSIGNED')
  }
})

test('detail preserves core job data when optional Order history is unknown or unavailable', async () => {
  const mock = dependencies(), service = new StaffJobService({ ...mock, orderReadEnabled: true })
  mock.orderClient.getBookingDetail = async () => { throw new HttpError(503, 'ORDER_UNAVAILABLE', 'Private upstream detail') }
  const unavailable = (await service.detail({ userId: '100' }, '1')).data
  assert.equal(unavailable.assignmentId, '1'); assert.equal(unavailable.orderHistory, null)
  assert.equal(unavailable.historySource, 'order-service-unavailable')
  assert.equal(unavailable.warnings[0].code, 'ORDER_HISTORY_UNAVAILABLE')
  assert.equal(JSON.stringify(unavailable).includes('Private upstream detail'), false)
  mock.orderClient.getBookingDetail = async () => ({ history: [], cancellationPending: false })
  const empty = (await service.detail({ userId: '100' }, '1')).data
  assert.deepEqual(empty.orderHistory, []); assert.equal(empty.cancellationPending, false)
  assert.equal(empty.unsupportedFields.includes('cancellationPending'), false)
})

test('idempotency keys are scoped to the actor and assignment, with no rewind on old replay', async () => {
  const mock = dependencies(), service = new StaffJobService(mock), actor = { userId: '100' }
  const first = await service.advance(actor, '1', { status: 'ACCEPTED', idempotencyKey: 'shared-key' })
  const second = await service.advance(actor, '2', { status: 'ACCEPTED', idempotencyKey: 'shared-key' })
  const otherActor = await service.advance({ userId: '200' }, '3', { status: 'ACCEPTED', idempotencyKey: 'shared-key' })
  assert.equal(new Set([first, second, otherActor].map(result => result.body.data.transition.operationId)).size, 3)
  await service.advance(actor, '1', { status: 'IN_PROGRESS', idempotencyKey: 'start-next' })
  await service.advance(actor, '1', { status: 'DONE', idempotencyKey: 'done-next' })
  const before = structuredClone(mock.rows.get('1')), applied = mock.applyCount
  const replay = await service.advance(actor, '1', { status: 'ACCEPTED', idempotencyKey: 'shared-key' })
  assert.equal(replay.body.data.status, 'DONE'); assert.equal(replay.body.data.transition.replayed, true)
  assert.equal(replay.body.data.orderAtTransition.status, 'CONFIRMED')
  assert.deepEqual(mock.rows.get('1'), before); assert.equal(mock.applyCount, applied)
})

test('schedule validation uses inclusive Vietnam days and leap dates', () => {
  assert.deepEqual(listQuery({ from: '2024-02-29', to: '2024-02-29' }, true), { status: undefined, page: 1, pageSize: 20, sort: 'asc', fromUtc: '2024-02-28 17:00:00.000', toUtc: '2024-02-29 17:00:00.000' })
  assert.throws(() => listQuery({ from: '2025-02-29', to: '2025-03-01' }, true))
})
