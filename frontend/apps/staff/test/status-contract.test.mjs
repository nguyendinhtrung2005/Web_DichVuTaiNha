import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { AuthBffError } from '../lib/server/auth-core.mjs'
import { STATUS_STEPS, currentStatus, parseStatusInput, parseStatusResponse, publicOperation, statusView, transitionOperationId } from '../lib/server/status-contract.mjs'

// Pure DTO/decision tests. These make no HTTP calls and do not establish
// real JWT, Staff/Order authorization or MySQL integration evidence.
const at = '2026-10-24T00:00:00.000Z'
const record = (changes = {}) => ({ version: 1, userId: '9109002', assignmentId: '9223372036854775807', orderId: '9007199254740993', assignedAt: at,
  requestedStatus: 'ACCEPTED', fromStatus: 'ASSIGNED', idempotencyKey: 'contract-operation-01', createdAt: Date.parse(at), ...changes })
const current = (changes = {}) => ({ assignmentId: '9223372036854775807', orderId: '9007199254740993', assignedAt: at,
  status: 'ASSIGNED', jobStatus: 'waiting', orderStatus: 'confirmed', checkInAt: null, checkOutAt: null, cancellationPending: null, ...changes })
const reply = (r = record(), code = 200, changes = {}) => ({ data: { assignmentId: r.assignmentId, status: r.requestedStatus,
  jobStatus: { ACCEPTED: 'accepted', IN_PROGRESS: 'in_progress', DONE: 'done' }[r.requestedStatus], checkInAt: null, checkOutAt: null,
  transition: { operationId: transitionOperationId(r), requestedStatus: r.requestedStatus, synchronization: code === 200 ? 'SYNCHRONIZED' : 'PENDING_ACKNOWLEDGEMENT', replayed: false },
  orderAtTransition: { id: r.orderId, status: 'CONFIRMED', asOf: at }, ...changes } })
const invalid = error => error instanceof AuthBffError && error.status === 502 && error.code === 'STAFF_INVALID_RESPONSE'

test('UC12 accepts exactly the three Staff targets and preserves valid Idempotency-Key bytes', () => {
  assert.deepEqual(STATUS_STEPS, ['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'DONE'])
  for (const status of STATUS_STEPS.slice(1)) {
    for (const key of ['a'.repeat(8), 'a'.repeat(128), 'Staff_01:2.3-4']) assert.deepEqual(parseStatusInput({ status }, key), { status, key })
  }
})

test('UC12 rejects extra body fields, aliases, arrays and invalid key syntax without normalization', () => {
  for (const body of [null, [], {}, { status: 'ASSIGNED' }, { status: 'waiting' }, { status: 'DONE ' }, { status: 'accepted' }, { status: 'DONE', employeeId: '2' }]) {
    assert.throws(() => parseStatusInput(body, 'valid-operation-key'), error => error.status === 400)
  }
  for (const key of [null, undefined, '', '1234567', 'a'.repeat(129), ' valid-key', 'valid-key ', 'khóa-thao-tác', 'with/slash', 'with\nnewline', 12345678]) {
    assert.throws(() => parseStatusInput({ status: 'DONE' }, key), error => error.status === 400)
  }
})

test('operation hash binds exact actor user ID, assignment and client key including BIGINT strings', () => {
  const r = record()
  const expected = createHash('sha256').update(JSON.stringify([r.userId, r.assignmentId, r.idempotencyKey])).digest('hex')
  assert.equal(transitionOperationId(r), expected)
  for (const changes of [{ userId: '9109101' }, { assignmentId: '9223372036854775806' }, { idempotencyKey: 'another-operation-key' }]) {
    assert.notEqual(transitionOperationId(record(changes)), expected)
  }
})

test('200 and 202 replies require matching synchronization and return only whitelisted fields', () => {
  const r = record()
  for (const code of [200, 202]) {
    const raw = reply(r, code)
    raw.accessToken = 'not-forwarded'; raw.data.secret = 'not-forwarded'; raw.data.transition.internalToken = 'not-forwarded'; raw.data.orderAtTransition.journal = 'not-forwarded'
    const parsed = parseStatusResponse(raw, code, r)
    assert.equal(parsed.transition.synchronization, code === 200 ? 'SYNCHRONIZED' : 'PENDING_ACKNOWLEDGEMENT')
    assert.equal(JSON.stringify(parsed).includes('not-forwarded'), false)
  }
  assert.throws(() => parseStatusResponse(reply(r, 202), 200, r), invalid)
  assert.throws(() => parseStatusResponse(reply(r), 202, r), invalid)
  assert.throws(() => parseStatusResponse(reply(r), 201, r), invalid)
})

test('an idempotent replay may return a later current assignment state and an older order snapshot', () => {
  const r = record(), raw = reply(r, 200, { status: 'DONE', jobStatus: 'done', checkInAt: at, checkOutAt: '2026-10-24T01:00:00.000Z' })
  raw.data.transition.replayed = true
  const value = parseStatusResponse(raw, 200, r)
  assert.equal(value.status, 'DONE')
  assert.equal(value.transition.requestedStatus, 'ACCEPTED')
  assert.equal(value.orderAtTransition.status, 'CONFIRMED')
})

test('UC12 rejects receipts not bound to the exact assignment, actor-derived hash, target and order', () => {
  const r = record()
  const changes = [
    value => { value.assignmentId = '2' }, value => { value.status = 'ASSIGNED'; value.jobStatus = 'waiting' },
    value => { value.status = 'CANCELLED'; value.jobStatus = null }, value => { value.jobStatus = 'done' },
    value => { value.transition.operationId = 'a'.repeat(64) }, value => { value.transition.requestedStatus = 'DONE' },
    value => { value.transition.replayed = 1 }, value => { value.orderAtTransition.id = '2' },
    value => { value.orderAtTransition.status = 'completed' }, value => { value.orderAtTransition.asOf = null },
  ]
  for (const change of changes) { const raw = reply(r); change(raw.data); assert.throws(() => parseStatusResponse(raw, 200, r), invalid) }
  assert.throws(() => parseStatusResponse(null, 200, r), invalid)
  assert.throws(() => parseStatusResponse({ data: [] }, 200, r), invalid)
})

test('receipt timestamps reject invalid calendar dates or noncontract timezone formats', () => {
  const r = record()
  for (const timestamp of ['2026-02-30T00:00:00.000Z', '2026-10-24T00:00:00Z', '2026-10-24T07:00:00.000+07:00', '2026-10-24', '', 123]) {
    for (const field of ['checkInAt', 'checkOutAt']) assert.throws(() => parseStatusResponse(reply(r, 200, { [field]: timestamp }), 200, r), invalid)
    const raw = reply(r); raw.data.orderAtTransition.asOf = timestamp
    assert.throws(() => parseStatusResponse(raw, 200, r), invalid)
  }
})

test('current status projection preserves actual raw assignment and nullable data, without exposing profile data', () => {
  const projection = currentStatus({ ...current(), databaseStatus: 'ASSIGNED', status: 'WAITING', employeeName: 'not-generated', accessToken: 'not-forwarded' })
  assert.deepEqual(projection, current())
})

test('only one legitimate next action is allowed by each active assignment state', () => {
  for (const [status, target] of [['ASSIGNED', 'ACCEPTED'], ['ACCEPTED', 'IN_PROGRESS'], ['IN_PROGRESS', 'DONE']]) {
    const view = statusView(current({ status }), [])
    assert.equal(view.allowedStatus, target); assert.equal(view.blockedReason, null); assert.equal(view.operation, null); assert.equal(view.canRetry, false)
  }
})

test('final assignments, inactive bookings and a known cancellation request block a new operation', () => {
  for (const status of ['DONE', 'CANCELLED']) assert.equal(statusView(current({ status }), []).blockedReason, 'NO_NEXT_STATUS')
  for (const orderStatus of ['pending', 'completed', 'cancelled', null]) assert.equal(statusView(current({ orderStatus }), []).blockedReason, 'BOOKING_NOT_ACTIVE')
  assert.equal(statusView(current({ cancellationPending: true }), []).blockedReason, 'CANCELLATION_PENDING')
  assert.equal(statusView(current({ cancellationPending: false }), []).allowedStatus, 'ACCEPTED')
})

test('an advanced assignment projection never confirms an operation without a saved 200 receipt', () => {
  const r = record(), entry = { record: r, receipt: null }, c = current({ status: 'DONE', jobStatus: 'done', orderStatus: 'completed' })
  const view = statusView(c, [entry])
  assert.equal(view.operation.phase, 'unknown'); assert.equal(view.operation.observedTarget, true)
  assert.equal(view.allowedStatus, null); assert.equal(view.canRetry, true); assert.equal(view.blockedReason, 'UNRESOLVED_OPERATION')
})

test('pending acknowledgement remains pending, can retry same operation, and blocks the next transition', () => {
  const r = record(), data = parseStatusResponse(reply(r, 202), 202, r)
  const view = statusView(current({ status: 'ACCEPTED', jobStatus: 'accepted' }), [{ record: r, receipt: { httpStatus: 202, data } }])
  assert.equal(view.operation.phase, 'pending'); assert.equal(view.canRetry, true); assert.equal(view.allowedStatus, null)
  assert.equal(view.operation.transition.synchronization, 'PENDING_ACKNOWLEDGEMENT')
})

test('a confirmed operation allows the following step and exposes no actor, order identity or private timestamp record', () => {
  const r = record(), data = parseStatusResponse(reply(r), 200, r), c = current({ status: 'ACCEPTED', jobStatus: 'accepted' })
  const view = statusView(c, [{ record: r, receipt: { httpStatus: 200, data } }])
  assert.equal(view.allowedStatus, 'IN_PROGRESS'); assert.equal(view.operation.phase, 'confirmed'); assert.equal(view.canRetry, false)
  assert.deepEqual(Object.keys(view.operation).sort(), ['createdAt', 'idempotencyKey', 'observedTarget', 'phase', 'requestedStatus', 'transition'].sort())
  assert.equal(view.operation.createdAt, at)
})

test('generation changes or regression of confirmed state block both new writes and retries', () => {
  const r = record(), entry = { record: r, receipt: { httpStatus: 200, data: parseStatusResponse(reply(r), 200, r) } }
  for (const changes of [{ orderId: '2', status: 'ACCEPTED' }, { assignedAt: null, status: 'ACCEPTED' }, { assignedAt: '2027-01-01T00:00:00.000Z', status: 'ACCEPTED' }, { status: 'ASSIGNED' }]) {
    const view = statusView(current(changes), [entry])
    assert.equal(view.blockedReason, 'ASSIGNMENT_CHANGED'); assert.equal(view.canRetry, false); assert.equal(view.allowedStatus, null)
  }
})

test('cancelled assignments or bookings never allow retry, while an unresolved prior step takes precedence', () => {
  const first = { record: record(), receipt: null }
  const later = { record: record({ requestedStatus: 'IN_PROGRESS', fromStatus: 'ACCEPTED', idempotencyKey: 'later-operation' }), receipt: null }
  for (const changes of [{ status: 'CANCELLED' }, { orderStatus: 'cancelled' }]) assert.equal(statusView(current(changes), [first]).canRetry, false)
  const view = statusView(current({ status: 'IN_PROGRESS' }), [first, later])
  assert.equal(view.operation.idempotencyKey, first.record.idempotencyKey)
  assert.equal(publicOperation(null, current()), null)
})
