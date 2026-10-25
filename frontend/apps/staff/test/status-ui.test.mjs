import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import test from 'node:test'

// Pure parser fixtures. These tests perform no HTTP request or MySQL mutation.
const require = createRequire(import.meta.url), ts = require('typescript')
const filename = fileURLToPath(new URL('../../../packages/ui/src/components/staff/staff-job-status-model.ts', import.meta.url))
const output = ts.transpileModule(readFileSync(filename, 'utf8'), { fileName: filename, compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText
const module = { exports: {} }
vm.runInNewContext(output, { module, exports: module.exports }, { filename, timeout: 2000 })
const { parseStaffStatusOperation, parseStaffStatusPayload, parseStaffStatusMutationPayload, staffStatusErrorMessage } = module.exports
const plain = value => JSON.parse(JSON.stringify(value))
const time = '2026-10-24T00:00:00.000Z'
function operation(phase = 'unknown') {
  return { idempotencyKey: 'unit-operation-1', requestedStatus: 'ACCEPTED', phase, createdAt: time, observedTarget: false,
    ...(phase === 'unknown' ? {} : { transition: { operationId: 'a'.repeat(64), requestedStatus: 'ACCEPTED', synchronization: phase === 'confirmed' ? 'SYNCHRONIZED' : 'PENDING_ACKNOWLEDGEMENT', replayed: false } }) }
}
function state() {
  return { current: { assignmentId: '9007199254740993', orderId: '9223372036854775807', status: 'ASSIGNED', jobStatus: 'waiting', orderStatus: 'confirmed', checkInAt: null, checkOutAt: null, assignedAt: time, cancellationPending: null },
    operation: null, allowedStatus: 'ACCEPTED', canRetry: false, blockedReason: null }
}
function mutation(http = 200) {
  const op = operation(http === 200 ? 'confirmed' : 'pending')
  return { data: { assignmentId: '9007199254740993', status: 'ACCEPTED', jobStatus: 'accepted', checkInAt: null, checkOutAt: null,
    transition: { ...op.transition }, orderAtTransition: { id: '9223372036854775807', status: 'CONFIRMED', asOf: time } }, operation: op }
}

test('UC12 UI keeps canonical BIGINT strings and validates the requested assignment', () => {
  const parsed = parseStaffStatusPayload(state(), '9007199254740993')
  assert.equal(parsed.current.assignmentId, '9007199254740993'); assert.equal(parsed.current.orderId, '9223372036854775807')
  assert.equal(parseStaffStatusPayload(state(), '1'), null)
  for (const id of ['0', '01', '-1', '1e2', '9223372036854775808', 1, null]) assert.equal(parseStaffStatusPayload(state(), id), null)
})
test('UC12 UI offers exactly the next forward step only for active bookings', () => {
  for (const [status, jobStatus, allowedStatus] of [['ASSIGNED', 'waiting', 'ACCEPTED'], ['ACCEPTED', 'accepted', 'IN_PROGRESS'], ['IN_PROGRESS', 'in_progress', 'DONE']]) {
    const input = state(); Object.assign(input.current, { status, jobStatus }); input.allowedStatus = allowedStatus
    assert.equal(parseStaffStatusPayload(input, input.current.assignmentId).allowedStatus, allowedStatus)
    for (const wrong of ['ACCEPTED', 'IN_PROGRESS', 'DONE'].filter(value => value !== allowedStatus)) {
      input.allowedStatus = wrong; assert.equal(parseStaffStatusPayload(input, input.current.assignmentId), null)
    }
  }
})
test('UC12 UI rejects a new action for finished/cancelled/pending/null bookings and cancellation requests', () => {
  for (const orderStatus of ['completed', 'cancelled', 'pending', null]) {
    const input = state(); input.current.orderStatus = orderStatus; assert.equal(parseStaffStatusPayload(input, input.current.assignmentId), null)
  }
  const input = state(); input.current.cancellationPending = true; assert.equal(parseStaffStatusPayload(input, input.current.assignmentId), null)
})
test('UC12 UI reads done/cancelled states without inventing a next action', () => {
  for (const [status, jobStatus] of [['DONE', 'done'], ['CANCELLED', null]]) {
    const input = state(); Object.assign(input.current, { status, jobStatus }); input.allowedStatus = null; input.blockedReason = 'NO_NEXT_STATUS'
    assert.equal(parseStaffStatusPayload(input, input.current.assignmentId).allowedStatus, null)
    input.allowedStatus = 'DONE'; assert.equal(parseStaffStatusPayload(input, input.current.assignmentId), null)
  }
})
test('UC12 UI does not promote a progressed projection to an acknowledged operation', () => {
  const input = state(); Object.assign(input.current, { status: 'DONE', jobStatus: 'done', orderStatus: 'completed' })
  input.operation = { ...operation(), observedTarget: true }; input.allowedStatus = null; input.canRetry = true; input.blockedReason = 'UNRESOLVED_OPERATION'
  const parsed = parseStaffStatusPayload(input, input.current.assignmentId)
  assert.equal(parsed.operation.phase, 'unknown'); assert.equal(parsed.operation.transition, undefined); assert.equal(parsed.allowedStatus, null)
})
test('UC12 UI recognizes a pending receipt while continuing to block new steps', () => {
  const input = state(); Object.assign(input.current, { status: 'ACCEPTED', jobStatus: 'accepted' })
  input.operation = { ...operation('pending'), observedTarget: true }; input.allowedStatus = null; input.canRetry = true; input.blockedReason = 'UNRESOLVED_OPERATION'
  assert.equal(parseStaffStatusPayload(input, input.current.assignmentId).operation.phase, 'pending')
  input.allowedStatus = 'IN_PROGRESS'; input.blockedReason = null
  assert.equal(parseStaffStatusPayload(input, input.current.assignmentId), null)
})
test('UC12 UI rejects retry flags for confirmed, foreign generation and cancelled contexts', () => {
  for (const kind of ['confirmed', 'changed', 'cancelled']) {
    const input = state(); Object.assign(input.current, { status: 'ACCEPTED', jobStatus: 'accepted' })
    input.operation = { ...operation(kind === 'confirmed' ? 'confirmed' : 'unknown'), observedTarget: true }; input.allowedStatus = null; input.canRetry = true; input.blockedReason = 'UNRESOLVED_OPERATION'
    if (kind === 'changed') input.blockedReason = 'ASSIGNMENT_CHANGED'
    if (kind === 'cancelled') { input.current.status = 'CANCELLED'; input.current.jobStatus = null; input.operation.observedTarget = false }
    assert.equal(parseStaffStatusPayload(input, input.current.assignmentId), null)
  }
})
test('UC12 UI rejects unknown enum, malformed dates and inconsistent projected statuses', () => {
  for (const patch of [{ status: 'WAITING' }, { jobStatus: 'done' }, { orderStatus: 'CONFIRMED' }, { assignedAt: '2026-02-30T00:00:00.000Z' }, { checkInAt: 'yesterday' }, { cancellationPending: 'false' }]) {
    const input = state(); Object.assign(input.current, patch); assert.equal(parseStaffStatusPayload(input, input.current.assignmentId), null)
  }
})
test('UC12 UI preserves null timing and cancellation data rather than filling defaults', () => {
  const input = state(); input.current.assignedAt = null
  const parsed = parseStaffStatusPayload(input, input.current.assignmentId)
  assert.equal(parsed.current.assignedAt, null); assert.equal(parsed.current.checkInAt, null); assert.equal(parsed.current.checkOutAt, null); assert.equal(parsed.current.cancellationPending, null)
})
test('UC12 UI validates stable key syntax and operation target without trimming or creating keys', () => {
  for (const key of ['1234567', '12345678 ', ' x12345678', 'x'.repeat(129), 'é12345678', '../unsafe/key']) assert.equal(parseStaffStatusOperation({ ...operation(), idempotencyKey: key }), null)
  for (const key of ['12345678', 'valid:operation_1.test-key', 'x'.repeat(128)]) assert.equal(parseStaffStatusOperation({ ...operation(), idempotencyKey: key }).idempotencyKey, key)
  for (const requestedStatus of ['waiting', 'ASSIGNED', 'CANCELLED', null]) assert.equal(parseStaffStatusOperation({ ...operation(), requestedStatus }), null)
})
test('UC12 UI rejects unknown operations with invented confirmation and contradictory receipts', () => {
  const unknown = operation(); unknown.transition = operation('confirmed').transition
  assert.equal(parseStaffStatusOperation(unknown), null)
  const pending = operation('pending'); pending.transition.synchronization = 'SYNCHRONIZED'
  assert.equal(parseStaffStatusOperation(pending), null)
  const confirmed = operation('confirmed'); confirmed.transition.requestedStatus = 'DONE'
  assert.equal(parseStaffStatusOperation(confirmed), null)
  for (const field of ['phase', 'createdAt', 'observedTarget']) { const input = operation(); delete input[field]; assert.equal(parseStaffStatusOperation(input), null) }
})
test('UC12 UI validates observedTarget against the current projection', () => {
  const input = state(); input.operation = { ...operation(), observedTarget: true }; input.allowedStatus = null; input.blockedReason = 'UNRESOLVED_OPERATION'
  assert.equal(parseStaffStatusPayload(input, input.current.assignmentId), null)
})
test('UC12 UI accepts exact 200 and 202 responses without changing the current state', () => {
  for (const httpStatus of [200, 202]) {
    const payload = mutation(httpStatus), before = plain(payload)
    const parsed = parseStaffStatusMutationPayload(payload, '9007199254740993', 'ACCEPTED', 'unit-operation-1', httpStatus)
    assert.equal(parsed.phase, httpStatus === 200 ? 'confirmed' : 'pending'); assert.deepEqual(plain(payload), before)
  }
})
test('UC12 UI permits a confirmed replay whose current assignment is further ahead than the target', () => {
  const input = mutation(); input.data.status = 'DONE'; input.data.jobStatus = 'done'; input.data.transition.replayed = true; input.operation.transition.replayed = true
  assert.equal(parseStaffStatusMutationPayload(input, input.data.assignmentId, 'ACCEPTED', 'unit-operation-1', 200).phase, 'confirmed')
})
test('UC12 UI rejects mutation replies for a different assignment, target, key or operation', () => {
  const original = mutation()
  for (const changes of [{ assignmentId: '1' }, { status: 'ASSIGNED', jobStatus: 'waiting' }, { jobStatus: 'done' }]) {
    const input = structuredClone(original); Object.assign(input.data, changes)
    assert.equal(parseStaffStatusMutationPayload(input, '9007199254740993', 'ACCEPTED', 'unit-operation-1', 200), null)
  }
  for (const [target, key, status] of [['DONE', 'unit-operation-1', 200], ['ACCEPTED', 'different-key', 200], ['ACCEPTED', 'unit-operation-1', 202]]) assert.equal(parseStaffStatusMutationPayload(original, '9007199254740993', target, key, status), null)
  const changed = mutation(); changed.data.transition.operationId = 'b'.repeat(64)
  assert.equal(parseStaffStatusMutationPayload(changed, '9007199254740993', 'ACCEPTED', 'unit-operation-1', 200), null)
})
test('UC12 UI strips extra server fields instead of retaining token-shaped data', () => {
  const input = state(); input.accessToken = 'unit-extra'; input.current.secret = 'unit-extra'
  const parsed = parseStaffStatusPayload(input, input.current.assignmentId)
  assert.equal(Object.hasOwn(parsed, 'accessToken'), false); assert.equal(Object.hasOwn(parsed.current, 'secret'), false)
  const op = operation('confirmed'); op.accessToken = 'unit-extra'; op.transition.secret = 'unit-extra'
  const parsedOp = parseStaffStatusOperation(op)
  assert.equal(Object.hasOwn(parsedOp, 'accessToken'), false); assert.equal(Object.hasOwn(parsedOp.transition, 'secret'), false)
})
test('UC12 UI distinguishes expired login, dependency outage, pending reconciliation and conflicts', () => {
  assert.match(staffStatusErrorMessage(401, ''), /đăng nhập lại/)
  assert.match(staffStatusErrorMessage(403, ''), /không được phép/)
  assert.match(staffStatusErrorMessage(503, 'AUTH_UNAVAILABLE'), /phiên đăng nhập/)
  assert.match(staffStatusErrorMessage(503, 'ORDER_UNAVAILABLE'), /đơn dịch vụ/)
  assert.match(staffStatusErrorMessage(503, 'RECONCILIATION_REQUIRED'), /chưa có xác nhận/)
  assert.match(staffStatusErrorMessage(409, ''), /đã thay đổi/)
  assert.match(staffStatusErrorMessage(503, 'OPERATION_STORE_UNAVAILABLE'), /thao tác an toàn/)
})
