import test from 'node:test'
import assert from 'node:assert/strict'
import { decodeJournal, OrderError, transitionDecision } from '../src/domain.js'

const nowSeconds = 1792717200
const assignment = (overrides = {}) => ({
  id: '12', bookingId: '80', employeeId: '9', actorUserId: '7', status: 'ASSIGNED',
  checkInAt: ['IN_PROGRESS', 'DONE'].includes(overrides.status) ? '2026-10-23 00:00:00' : null,
  userRole: 'EMPLOYEE', userStatus: 'ACTIVE', employeeStatus: 'ACTIVE', ...overrides,
})
const operation = (overrides = {}) => ({
  id: 'operation-1', bookingId: '80', assignmentId: '12', employeeId: '9', actorUserId: '7',
  fromStatus: 'ASSIGNED', toStatus: 'ACCEPTED', ...overrides,
})
const state = (overrides = {}) => ({ booking: { id: '80', status: 'CONFIRMED' }, assignments: [assignment()], records: [], ...overrides })
const decide = (context = state(), op = operation()) => transitionDecision(context, op, { nowSeconds })
const code = expected => error => error instanceof OrderError && error.code === expected
const historyRow = (decision, overrides = {}) => ({
  id: '200', bookingId: '80', changedBy: decision.metadata.operation.actorUserId,
  status: decision.bookingStatus, note: JSON.stringify(decision.metadata), createdAt: '2026-10-23 01:00:00', ...overrides,
})
const pending = (op, bookingStatus = 'IN_PROGRESS', acknowledged = false) => ({
  operation: op,
  ack: {
    operationId: op.id, bookingId: op.bookingId, assignmentId: op.assignmentId,
    assignmentStatus: op.toStatus, occurredAt: '2026-10-23T01:00:00.000Z',
    booking: { id: op.bookingId, status: bookingStatus, cancellationPending: null },
  }, staffAcknowledged: acknowledged,
})
const other = (overrides = {}) => assignment({ id: '13', employeeId: '10', actorUserId: '8', ...overrides })

test('accept creates a confirmed booking ACK and a versioned pending journal', () => {
  const result = decide()
  assert.equal(result.bookingStatus, 'CONFIRMED')
  assert.equal(result.replayed, false)
  assert.deepEqual(result.ack, {
    operationId: 'operation-1', bookingId: '80', assignmentId: '12', assignmentStatus: 'ACCEPTED',
    occurredAt: new Date(nowSeconds * 1000).toISOString(),
    booking: { id: '80', status: 'CONFIRMED', cancellationPending: null },
  })
  assert.equal(result.metadata.kind, 'cleanhome.staff-transition')
  assert.equal(result.metadata.version, 1)
  assert.equal(result.metadata.staffAcknowledged, false)
  assert.deepEqual(result.metadata.ack, result.ack)
})

test('start advances booking without writing the assignment or input objects', () => {
  const context = state({ assignments: [assignment({ status: 'ACCEPTED' })] })
  const before = structuredClone(context)
  const op = operation({ fromStatus: 'ACCEPTED', toStatus: 'IN_PROGRESS' })
  assert.equal(decide(context, op).bookingStatus, 'IN_PROGRESS')
  assert.deepEqual(context, before)
  assert.equal(op.toStatus, 'IN_PROGRESS')
})

test('single worker DONE completes booking', () => {
  const result = decide(state({ booking: { id: '80', status: 'IN_PROGRESS' }, assignments: [assignment({ status: 'IN_PROGRESS' })] }),
    operation({ fromStatus: 'IN_PROGRESS', toStatus: 'DONE' }))
  assert.equal(result.bookingStatus, 'COMPLETED')
})

test('one worker DONE does not complete booking while another remains active', () => {
  const result = decide(state({ booking: { id: '80', status: 'IN_PROGRESS' }, assignments: [assignment({ status: 'IN_PROGRESS' }), other({ status: 'IN_PROGRESS' })] }),
    operation({ fromStatus: 'IN_PROGRESS', toStatus: 'DONE' }))
  assert.equal(result.bookingStatus, 'IN_PROGRESS')
})

test('last active worker DONE completes booking; CANCELLED rows do not count', () => {
  const context = state({ booking: { id: '80', status: 'IN_PROGRESS' }, assignments: [assignment({ status: 'IN_PROGRESS' }), other({ status: 'CANCELLED' })] })
  assert.equal(decide(context, operation({ fromStatus: 'IN_PROGRESS', toStatus: 'DONE' })).bookingStatus, 'COMPLETED')
})

test('two workers completing before Staff commit aggregate pending journal, in either order', () => {
  for (const reverse of [false, true]) {
    const first = reverse ? other({ status: 'IN_PROGRESS' }) : assignment({ status: 'IN_PROGRESS' })
    const second = reverse ? assignment({ status: 'IN_PROGRESS' }) : other({ status: 'IN_PROGRESS' })
    const firstOp = operation({ id: 'done-first', assignmentId: first.id, employeeId: first.employeeId, actorUserId: first.actorUserId, fromStatus: 'IN_PROGRESS', toStatus: 'DONE' })
    const secondOp = operation({ id: 'done-second', assignmentId: second.id, employeeId: second.employeeId, actorUserId: second.actorUserId, fromStatus: 'IN_PROGRESS', toStatus: 'DONE' })
    const context = state({ booking: { id: '80', status: 'IN_PROGRESS' }, assignments: [first, second] })
    const a = decide(context, firstOp)
    assert.equal(a.bookingStatus, 'IN_PROGRESS')
    context.records.push({ ...a.metadata })
    const b = decide(context, secondOp)
    assert.equal(b.bookingStatus, 'COMPLETED')
    assert.equal(first.status, 'IN_PROGRESS')
  }
})

test('accept while another worker started preserves IN_PROGRESS', () => {
  assert.equal(decide(state({ booking: { id: '80', status: 'IN_PROGRESS' }, assignments: [assignment(), other({ status: 'IN_PROGRESS' })] })).bookingStatus, 'IN_PROGRESS')
})

test('effective pending progress contributes to accept snapshot even before Staff commit', () => {
  const earlier = operation({ id: 'other-start', assignmentId: '13', employeeId: '10', actorUserId: '8', fromStatus: 'ACCEPTED', toStatus: 'IN_PROGRESS' })
  assert.equal(decide(state({ assignments: [assignment(), other({ status: 'ACCEPTED' })], records: [pending(earlier)] })).bookingStatus, 'IN_PROGRESS')
})

test('pending overlay cannot rewind an assignment already beyond the journal step', () => {
  const earlier = operation({ id: 'other-accept', assignmentId: '13', employeeId: '10', actorUserId: '8' })
  const context = state({ booking: { id: '80', status: 'IN_PROGRESS' }, assignments: [assignment({ status: 'IN_PROGRESS' }), other({ status: 'DONE' })], records: [pending(earlier, 'CONFIRMED')] })
  assert.equal(decide(context, operation({ fromStatus: 'IN_PROGRESS', toStatus: 'DONE' })).bookingStatus, 'COMPLETED')
})

test('pending operation for same assignment prevents a new-key duplicate of its step', () => {
  const earlier = operation({ id: 'earlier' })
  assert.throws(() => decide(state({ records: [pending(earlier, 'CONFIRMED')] })), code('INVALID_TRANSITION'))
})

test('same operation replay is immutable after booking COMPLETED', () => {
  const first = decide()
  const context = state({ booking: { id: '80', status: 'COMPLETED' }, assignments: [], records: [first.metadata] })
  const replay = transitionDecision(context, operation(), { nowSeconds: nowSeconds + 99 })
  assert.equal(replay.replayed, true)
  assert.deepEqual(replay.ack, first.ack)
  assert.equal(replay.bookingStatus, 'COMPLETED')
  replay.ack.booking.status = 'CANCELLED'
  assert.equal(first.metadata.ack.booking.status, 'CONFIRMED')
})

test('same operation replay remains the historical fact if account or roster later changes', () => {
  const first = decide()
  const context = state({ assignments: [assignment({ userStatus: 'LOCKED', status: 'DONE' })], records: [{ ...first.metadata, staffAcknowledged: true }] })
  const replay = decide(context)
  assert.equal(replay.replayed, true)
  assert.equal(replay.metadata.staffAcknowledged, true)
  assert.deepEqual(replay.ack, first.ack)
})

test('same operation ID with changed payload conflicts, including after completion', () => {
  const context = state({ booking: { id: '80', status: 'COMPLETED' }, records: [decide().metadata] })
  for (const changed of [{ actorUserId: '8' }, { employeeId: '10' }, { assignmentId: '13' }, { fromStatus: 'ACCEPTED', toStatus: 'IN_PROGRESS' }]) {
    assert.throws(() => decide(context, operation(changed)), code('IDEMPOTENCY_CONFLICT'))
  }
})

for (const [status, expected] of [['CANCELLED', 'BOOKING_CANCELLED'], ['COMPLETED', 'BOOKING_COMPLETED'], ['PENDING', 'BOOKING_NOT_CONFIRMED']]) {
  test(`new operation rejects ${status} booking`, () => assert.throws(() => decide(state({ booking: { id: '80', status } })), code(expected)))
}

test('booking does not exist', () => assert.throws(() => decide(state({ booking: null })), code('BOOKING_NOT_FOUND')))

test('assignment not in booking or actor/employee mismatch is stale', () => {
  for (const changed of [{ assignmentId: '13' }, { employeeId: '10' }, { actorUserId: '8' }]) {
    assert.throws(() => decide(state(), operation(changed)), code('STALE_ASSIGNMENT'))
  }
})

test('cancelled assignment and locked/invalid accounts are not active', () => {
  for (const changed of [{ status: 'CANCELLED' }, { userStatus: 'LOCKED' }, { employeeStatus: 'INACTIVE' }, { userRole: 'CUSTOMER' }, { userRole: 'ADMIN' }]) {
    assert.throws(() => decide(state({ assignments: [assignment(changed)] })), code('ASSIGNMENT_NOT_ACTIVE'))
  }
})

test('STAFF compatibility alias is supported without allowing other roles', () => assert.equal(decide(state({ assignments: [assignment({ userRole: 'STAFF' })] })).bookingStatus, 'CONFIRMED'))

test('skipped, backward, prototype and extra-field operations are rejected', () => {
  for (const changed of [{ toStatus: 'DONE' }, { fromStatus: 'IN_PROGRESS', toStatus: 'ACCEPTED' }, { fromStatus: 'toString', toStatus: undefined }, { token: 'must-never-be-persisted' }]) {
    assert.throws(() => decide(state(), operation(changed)), code('INVALID_REQUEST'))
  }
})

test('actual state must match requested step', () => assert.throws(() => decide(state({ assignments: [assignment({ status: 'ACCEPTED' })] })), code('INVALID_TRANSITION')))

test('BIGINT identifiers retain precision and reject noncanonical values', () => {
  const max = '9223372036854775807'
  assert.equal(decide(state({ booking: { id: max, status: 'CONFIRMED' }, assignments: [assignment({ bookingId: max })] }), operation({ bookingId: max })).ack.bookingId, max)
  for (const bad of ['01', '0', '7junk', '9223372036854775808', 7]) assert.throws(() => decide(state(), operation({ actorUserId: bad })), code('INVALID_REQUEST'))
})

test('duplicate, unknown-status, mismatched-booking or incomplete roster fails closed', () => {
  for (const assignments of [[assignment(), assignment()], [assignment({ status: 'UNKNOWN' })], [assignment({ bookingId: '81' })], [assignment({ actorUserId: null })]]) {
    assert.throws(() => decide(state({ assignments })), code('DATA_INTEGRITY_ERROR'))
  }
})

test('pending journal whose roster moved, disappeared or cancelled rejects new work', () => {
  const earlier = operation({ id: 'other-accept', assignmentId: '13', employeeId: '10', actorUserId: '8' })
  for (const rows of [[assignment()], [assignment(), other({ employeeId: '11' })], [assignment(), other({ actorUserId: '99' })], [assignment(), other({ status: 'CANCELLED' })]]) {
    assert.throws(() => decide(state({ assignments: rows, records: [pending(earlier, 'CONFIRMED')] })), code('STALE_ASSIGNMENT'))
  }
})

test('historical acknowledged journal does not overlay changed roster', () => {
  const earlier = operation({ id: 'other-accept', assignmentId: '13', employeeId: '10', actorUserId: '8' })
  assert.equal(decide(state({ records: [pending(earlier, 'CONFIRMED', true)] })).bookingStatus, 'CONFIRMED')
})

test('duplicate or malformed journals fail closed', () => {
  const earlier = pending(operation({ id: 'earlier' }), 'CONFIRMED')
  assert.throws(() => decide(state({ records: [earlier, earlier] })), code('JOURNAL_CORRUPT'))
  assert.throws(() => decide(state({ records: [{ ...earlier, ack: null }] })), code('JOURNAL_CORRUPT'))
})

test('invalid server clock is not converted to a false successful ACK', () => {
  for (const bad of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) assert.throws(() => transitionDecision(state(), operation(), { nowSeconds: bad }), code('DATA_INTEGRITY_ERROR'))
})

test('clock rollback cannot create a DONE ACK before the actual MySQL check-in', () => {
  const context = state({ booking: { id: '80', status: 'IN_PROGRESS' },
    assignments: [assignment({ status: 'IN_PROGRESS', checkInAt: '2026-10-23 02:00:00' })] })
  const before = structuredClone(context)
  assert.throws(() => decide(context, operation({ fromStatus: 'IN_PROGRESS', toStatus: 'DONE' })), code('INVALID_TRANSITION'))
  assert.deepEqual(context, before)
})

test('clock rollback cannot precede a pending or acknowledged start journal', () => {
  for (const staffAcknowledged of [false, true]) {
    const started = pending(operation({ id: 'start', fromStatus: 'ACCEPTED', toStatus: 'IN_PROGRESS' }), 'IN_PROGRESS', staffAcknowledged)
    started.ack.occurredAt = '2026-10-23T02:00:00.000Z'
    const context = state({ booking: { id: '80', status: 'IN_PROGRESS' },
      assignments: [assignment({ status: 'IN_PROGRESS', checkInAt: null })], records: [started] })
    assert.throws(() => decide(context, operation({ fromStatus: 'IN_PROGRESS', toStatus: 'DONE' })), code('INVALID_TRANSITION'))
  }
})

test('DONE requires a valid actual check-in or a committed start journal', () => {
  const op = operation({ fromStatus: 'IN_PROGRESS', toStatus: 'DONE' })
  for (const checkInAt of [null, '2026-02-30 00:00:00', 'not-a-date']) {
    assert.throws(() => decide(state({ assignments: [assignment({ status: 'IN_PROGRESS', checkInAt })] }), op), code('DATA_INTEGRITY_ERROR'))
  }
  const started = pending(operation({ id: 'start', fromStatus: 'ACCEPTED', toStatus: 'IN_PROGRESS' }))
  const context = state({ assignments: [assignment({ status: 'ACCEPTED', checkInAt: null })], records: [started] })
  assert.equal(decide(context, op).ack.occurredAt, started.ack.occurredAt)
  assert.equal(decide(state({ assignments: [assignment({ status: 'IN_PROGRESS', checkInAt: new Date(nowSeconds * 1000) })] }), op).bookingStatus, 'COMPLETED')
})

test('read-only frozen context and operation are supported', () => {
  const context = state()
  Object.freeze(context.booking)
  context.assignments.forEach(Object.freeze)
  Object.freeze(context.assignments)
  Object.freeze(context.records)
  Object.freeze(context)
  assert.equal(decide(context, Object.freeze(operation())).bookingStatus, 'CONFIRMED')
})

test('decodeJournal reads valid metadata without exposing arbitrary SQL fields', () => {
  const result = decide()
  const row = historyRow(result, { hidden: 'not-returned' })
  const decoded = decodeJournal(row)
  assert.deepEqual(decoded, { operation: result.metadata.operation, ack: result.ack, staffAcknowledged: false, historyId: '200' })
  assert.equal(Object.hasOwn(decoded, 'hidden'), false)
})

test('legacy text, unrelated JSON and note containing marker text stay untouched', () => {
  for (const note of ['Đã xác nhận đơn', 'cleanhome.staff-transition (ghi chú)', '{"kind":"other"}', '[]', '{bad old note']) {
    assert.equal(decodeJournal({ note }), null)
  }
})

test('corrupt marker, version, row IDs or actor/status mismatch fail closed', () => {
  const first = decide()
  const row = historyRow(first)
  const changes = [
    { note: '{"kind":"cleanhome.staff-transition"' },
    { note: JSON.stringify({ ...first.metadata, version: 2 }) },
    { note: JSON.stringify({ ...first.metadata, staffAcknowledged: 'true' }) },
    { id: '0' }, { bookingId: '81' }, { changedBy: '8' }, { status: 'COMPLETED' },
  ]
  for (const changed of changes) assert.throws(() => decodeJournal({ ...row, ...changed }), code('JOURNAL_CORRUPT'))
})

test('journal ACK must match operation and represent a real calendar date', () => {
  const first = decide()
  for (const changed of [{ occurredAt: '2026-02-30T00:00:00.000Z' }, { operationId: 'other' }, { assignmentStatus: 'DONE' }, { booking: { id: '80', status: 'CANCELLED', cancellationPending: null } }]) {
    assert.throws(() => decodeJournal(historyRow({ ...first, metadata: { ...first.metadata, ack: { ...first.ack, ...changed } } })), code('JOURNAL_CORRUPT'))
  }
})
