import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID, createHash } from 'node:crypto'
import { createPool } from '../src/db.js'
import { loadDbConfig } from '../src/config.js'
import { MysqlOrderRepository } from '../src/repository.js'
import { OrderTransitionService } from '../src/service.js'
import { decodeJournal } from '../src/domain.js'
import { createFixture, appendFixtureOperation } from './fixtures.js'

const enabled = process.env.RUN_ORDER_MYSQL_TESTS === 'true'
const originalBookingIds = ['9109007', '9109103', '9109111', '9109121', '9109131']
const originalAssignmentIds = ['9109008', '9109105', '9109113', '9109123', '9109133', '9109134']
const placeholders = values => values.map(() => '?').join(', ')
function operation(fixture, index, fromStatus = 'ASSIGNED', toStatus = 'ACCEPTED') {
  return { id: randomUUID(), bookingId: fixture.bookingId, assignmentId: fixture.assignmentIds[index], employeeId: fixture.employeeIds[index], actorUserId: fixture.actorUserIds[index], fromStatus, toStatus }
}
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')

async function originalSnapshot(pool) {
  const connection = await pool.getConnection()
  try {
    await connection.query("SET SESSION time_zone = '+00:00'")
    const [bookings] = await connection.execute(`SELECT id, customer_id, branch_id, address_snapshot, scheduled_start, scheduled_end, status, total_amount FROM bookings WHERE id IN (${placeholders(originalBookingIds)}) ORDER BY id`, originalBookingIds)
    const [assignments] = await connection.execute(`SELECT id, booking_id, employee_id, status, assigned_at, check_in_at, check_out_at FROM assignments WHERE id IN (${placeholders(originalAssignmentIds)}) ORDER BY id`, originalAssignmentIds)
    const [items] = await connection.execute(`SELECT id, booking_id, service_id, service_name_snapshot, quantity, unit_price, unit_snapshot FROM booking_items WHERE booking_id IN (${placeholders(originalBookingIds)}) ORDER BY id`, originalBookingIds)
    const [history] = await connection.execute(`SELECT id, booking_id, changed_by, status, note, created_at FROM booking_status_history WHERE booking_id IN (${placeholders(originalBookingIds)}) ORDER BY id`, originalBookingIds)
    return { bookings, assignments, items, history }
  } finally { connection.release() }
}
async function fixtureRows(pool, fixture) {
  const connection = await pool.getConnection()
  try {
    await connection.query("SET SESSION time_zone = '+00:00'")
    const [bookings] = await connection.execute('SELECT id, status, address_snapshot AS addressSnapshot FROM bookings WHERE id = ?', [fixture.bookingId])
    const address = typeof bookings[0]?.addressSnapshot === 'string' ? JSON.parse(bookings[0].addressSnapshot) : bookings[0]?.addressSnapshot
    assert.equal(address?._cleanhome_order_qa, fixture.marker, 'Only generated, explicitly labelled QA rows may be used.')
    const [assignments] = await connection.execute('SELECT id, booking_id AS bookingId, employee_id AS employeeId, status, check_in_at AS checkInAt, check_out_at AS checkOutAt FROM assignments WHERE booking_id = ? ORDER BY id', [fixture.bookingId])
    const [history] = await connection.execute('SELECT id, booking_id AS bookingId, changed_by AS changedBy, status, note, created_at AS createdAt FROM booking_status_history WHERE booking_id = ? ORDER BY id', [fixture.bookingId])
    return { booking: bookings[0], assignments, history: history.map(row => ({ ...row, id: String(row.id), bookingId: String(row.bookingId), changedBy: String(row.changedBy) })) }
  } finally { connection.release() }
}
async function unusedId(pool, table) {
  assert.ok(['bookings', 'assignments'].includes(table))
  const [rows] = await pool.execute(`SELECT COALESCE(MAX(id), 0) AS maxId FROM ${table}`)
  const id = BigInt(rows[0].maxId) + 1000000n
  assert.ok(id <= 9223372036854775807n)
  return String(id)
}

test('Order real MySQL transactions with separately labelled retained QA fixtures', {
  skip: enabled ? false : 'Set RUN_ORDER_MYSQL_TESTS=true and ORDER_TEST_ALLOW_FIXTURE_WRITES=true on cleanhome_staff_test only.',
  timeout: 120000,
}, async t => {
  assert.equal(process.env.ORDER_TEST_ALLOW_FIXTURE_WRITES, 'true', 'Explicit fixture write opt-in is required.')
  const config = loadDbConfig()
  assert.equal(config.database, 'cleanhome_staff_test', 'Production databases are never integration-test targets.')
  const pool = createPool({ ...config, connectionLimit: 5 })
  const repository = new MysqlOrderRepository(pool), service = new OrderTransitionService(repository)
  let before
  t.after(async () => {
    try { if (before) assert.equal(digest(await originalSnapshot(pool)), digest(before), 'Original seeds must remain byte-for-byte unchanged.') }
    finally { await pool.end() }
  })
  before = await originalSnapshot(pool)
  assert.equal(before.bookings.length, 5, 'The original five seed bookings must exist.')
  assert.equal(before.assignments.length, 6, 'The original six seed assignments must exist.')

  await t.test('schema, required foreign keys, MySQL version and database target are real', async () => {
    assert.equal(await repository.assertSchema(), true)
    assert.equal(await repository.health(), true)
    const [rows] = await pool.execute('SELECT DATABASE() AS databaseName')
    assert.equal(rows[0].databaseName, 'cleanhome_staff_test')
  })

  const fixture = await createFixture(pool, { label: 'mysql-valid-and-recovery' })
  const firstOperation = operation(fixture, 0)
  await t.test('missing booking and assignment/booking mismatch are rejected without writes', async () => {
    await assert.rejects(service.apply({ ...firstOperation, id: randomUUID(), bookingId: await unusedId(pool, 'bookings') }), { status: 404, code: 'BOOKING_NOT_FOUND' })
    await assert.rejects(service.apply({ ...firstOperation, id: randomUUID(), assignmentId: await unusedId(pool, 'assignments') }), { status: 409, code: 'STALE_ASSIGNMENT' })
    const other = await createFixture(pool, { label: 'mysql-assignment-other-booking' })
    await assert.rejects(service.apply({ ...firstOperation, id: randomUUID(), assignmentId: other.assignmentIds[0] }), { status: 409, code: 'STALE_ASSIGNMENT' })
    assert.equal((await fixtureRows(pool, fixture)).history.length, 0)
  })

  await t.test('cancelled/completed/pending bookings reject new operations and preserve assignments', async () => {
    for (const [status, code] of [['CANCELLED', 'BOOKING_CANCELLED'], ['COMPLETED', 'BOOKING_COMPLETED'], ['PENDING', 'BOOKING_NOT_CONFIRMED']]) {
      const blocked = await createFixture(pool, { label: 'mysql-reject-' + status.toLowerCase(), status })
      const original = await fixtureRows(pool, blocked)
      await assert.rejects(service.apply(operation(blocked, 0)), { status: 409, code })
      assert.deepEqual(await fixtureRows(pool, blocked), original)
    }
  })

  await t.test('invalid step is rejected before journal insertion', async () => {
    await assert.rejects(service.apply({ ...operation(fixture, 0), fromStatus: 'ASSIGNED', toStatus: 'DONE' }), { status: 400, code: 'INVALID_REQUEST' })
    assert.equal((await fixtureRows(pool, fixture)).history.length, 0)
  })

  let firstAck
  await t.test('valid acceptance creates one durable journal and leaves Staff assignments untouched', async () => {
    const original = await fixtureRows(pool, fixture)
    await appendFixtureOperation(fixture, firstOperation)
    firstAck = await service.apply(firstOperation)
    assert.equal(firstAck.booking.status, 'CONFIRMED'); assert.equal(firstAck.assignmentStatus, 'ACCEPTED')
    const stored = await fixtureRows(pool, fixture)
    assert.deepEqual(stored.assignments, original.assignments)
    assert.equal(stored.history.length, 1)
    const record = decodeJournal(stored.history[0])
    assert.deepEqual(record.operation, firstOperation); assert.deepEqual(record.ack, firstAck); assert.equal(record.staffAcknowledged, false)
  })
  assert.ok(firstAck, 'A real committed ACK is required before replay tests.')

  await t.test('same operation replay survives a new repository instance and does not duplicate history', async () => {
    const fresh = new OrderTransitionService(new MysqlOrderRepository(pool))
    const beforeReplay = await fixtureRows(pool, fixture)
    assert.deepEqual(await fresh.lookup(firstOperation), firstAck)
    assert.deepEqual(await fresh.apply(firstOperation), firstAck)
    assert.deepEqual(await fixtureRows(pool, fixture), beforeReplay)
  })

  await t.test('reused operation ID with another payload or another booking is rejected', async () => {
    await assert.rejects(service.apply({ ...firstOperation, fromStatus: 'ACCEPTED', toStatus: 'IN_PROGRESS' }), { status: 409, code: 'IDEMPOTENCY_CONFLICT' })
    const other = await createFixture(pool, { label: 'mysql-cross-booking-operation-collision' })
    await assert.rejects(service.apply({ ...operation(other, 0), id: firstOperation.id }), { status: 409, code: 'IDEMPOTENCY_CONFLICT' })
    assert.equal((await fixtureRows(pool, other)).history.length, 0)
  })

  await t.test('acknowledgement before Staff commit fails and pending remains recoverable', async () => {
    await assert.rejects(service.acknowledge(firstOperation), { status: 409, code: 'STALE_ASSIGNMENT' })
    const state = await fixtureRows(pool, fixture)
    assert.equal(decodeJournal(state.history[0]).staffAcknowledged, false)
    let found = false
    for (let page = 0; page < 20; page++) {
      const pending = await service.pending(100)
      if (pending.operations.some(value => value.id === firstOperation.id)) { found = true; break }
      if (pending.operations.length === 0) break
    }
    assert.equal(found, true, 'Committed operation must be discoverable for Staff reconciliation.')
  })

  await t.test('one worker DONE does not complete a booking while another is still working', async () => {
    const shared = await createFixture(pool, { label: 'mysql-single-worker-done', status: 'IN_PROGRESS', assignmentStatuses: ['IN_PROGRESS', 'IN_PROGRESS'] })
    const op = operation(shared, 0, 'IN_PROGRESS', 'DONE')
    await appendFixtureOperation(shared, op)
    const initial = await fixtureRows(pool, shared), ack = await service.apply(op), stored = await fixtureRows(pool, shared)
    assert.equal(ack.booking.status, 'IN_PROGRESS'); assert.equal(stored.booking.status, 'IN_PROGRESS')
    assert.deepEqual(stored.assignments, initial.assignments)
    assert.equal(stored.history.length, 1)
  })

  await t.test('two concurrent DONE commands aggregate committed pending journals without assignment locks', async () => {
    const shared = await createFixture(pool, { label: 'mysql-concurrent-two-worker-done', status: 'IN_PROGRESS', assignmentStatuses: ['IN_PROGRESS', 'IN_PROGRESS'] })
    const a = operation(shared, 0, 'IN_PROGRESS', 'DONE'), b = operation(shared, 1, 'IN_PROGRESS', 'DONE')
    await appendFixtureOperation(shared, a); await appendFixtureOperation(shared, b)
    const original = await fixtureRows(pool, shared)
    const acknowledgements = await Promise.all([service.apply(a), new OrderTransitionService(new MysqlOrderRepository(pool)).apply(b)])
    assert.deepEqual(acknowledgements.map(value => value.booking.status).sort(), ['COMPLETED', 'IN_PROGRESS'])
    const stored = await fixtureRows(pool, shared)
    assert.equal(stored.booking.status, 'COMPLETED')
    assert.deepEqual(stored.assignments, original.assignments, 'Only Staff may commit assignment DONE/check-out.')
    assert.equal(stored.history.length, 2)
    const records = stored.history.map(decodeJournal)
    assert.equal(new Set(records.map(record => record.operation.id)).size, 2)
    assert.ok(records.every(record => record.staffAcknowledged === false))
    assert.deepEqual(await service.apply(a), acknowledgements[0]); assert.deepEqual(await service.apply(b), acknowledgements[1])
    assert.equal((await fixtureRows(pool, shared)).history.length, 2)
  })
})
