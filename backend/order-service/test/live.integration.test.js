import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { createPool } from '../src/db.js'
import { loadConfig, readServiceToken } from '../src/config.js'
import { MysqlOrderRepository } from '../src/repository.js'
import { authTokens, jsonRequest, localBase, runStaffSuite } from '../scripts/test-http.js'

const sharedId = '9109131'
const assignedIds = ['9109133', '9109134']
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const iso = value => value == null ? null : new Date(String(value).replace(' ', 'T') + (/Z$|[+-]\d\d:\d\d$/.test(String(value)) ? '' : 'Z')).toISOString()

test('real Auth → Staff → Order UC12 HTTP integration on the confirmed test database; consumes shared fixture once', {
  skip: process.env.RUN_ORDER_LIVE_TESTS === 'true' ? false : 'Set RUN_ORDER_LIVE_TESTS=true only with actual Auth, Staff and Order servers',
  timeout: 300000,
}, async t => {
  assert.equal(process.env.MYSQL_DATABASE, 'cleanhome_staff_test', 'Live writes are limited to the dedicated test database')
  assert.equal(process.env.ORDER_LIVE_CONSUME_SHARED_BOOKING, sharedId, 'Explicitly confirm that the unused shared fixture may be consumed')
  const config = loadConfig(), serviceToken = await readServiceToken(config.credential)
  const orderBase = localBase(process.env.ORDER_LIVE_BASE_URL || 'http://127.0.0.1:4003', 'ORDER_LIVE_BASE_URL')
  const staffBase = localBase(process.env.ORDER_LIVE_STAFF_URL || 'http://127.0.0.1:4005', 'ORDER_LIVE_STAFF_URL')
  const authBase = localBase(process.env.ORDER_LIVE_AUTH_URL || 'http://127.0.0.1:4001', 'ORDER_LIVE_AUTH_URL')
  const tokens = await authTokens(), pool = createPool(config.db), repository = new MysqlOrderRepository(pool)
  const sql = (query, bindings = []) => repository.connection(async connection => (await connection.execute(query, bindings))[0])
  const unrelated = async () => ({
    users: await sql('SELECT id, phone, password_hash, role, status FROM users ORDER BY id'),
    employees: await sql('SELECT * FROM employees ORDER BY id'),
    bookings: await sql('SELECT * FROM bookings WHERE id<>? ORDER BY id', [sharedId]),
    assignments: await sql('SELECT * FROM assignments WHERE booking_id<>? ORDER BY id', [sharedId]),
    items: await sql('SELECT * FROM booking_items ORDER BY id'),
    services: await sql('SELECT * FROM services ORDER BY id'),
    history: await sql('SELECT * FROM booking_status_history WHERE booking_id<>? ORDER BY id', [sharedId]),
  })
  const shared = async () => ({
    booking: await sql('SELECT * FROM bookings WHERE id=?', [sharedId]),
    assignments: await sql('SELECT * FROM assignments WHERE booking_id=? ORDER BY id', [sharedId]),
    history: await sql('SELECT * FROM booking_status_history WHERE booking_id=? ORDER BY id', [sharedId]),
  })
  let beforeProtected
  t.after(async () => {
    try { if (beforeProtected) assert.equal(hash(await unrelated()), beforeProtected, 'UC12 changed unrelated fixture data or user credentials') }
    finally { await pool.end() }
  })
  await repository.assertSchema()
  const [database] = await sql('SELECT DATABASE() AS name')
  assert.equal(database.name, 'cleanhome_staff_test')
  const initial = await shared()
  assert.equal(initial.booking.length, 1)
  assert.equal(initial.booking[0].status, 'CONFIRMED', 'Shared fixture has already been used; never reset it to rerun this suite')
  let address
  try { address = typeof initial.booking[0].address_snapshot === 'string' ? JSON.parse(initial.booking[0].address_snapshot) : initial.booking[0].address_snapshot }
  catch { throw new Error('Shared test fixture marker could not be read') }
  assert.equal(address?._cleanhome_fixture, 'cleanhome-staff-uc9-uc12-multi-v1')
  assert.equal(address?._cleanhome_case, 'multi-worker')
  assert.deepEqual(initial.assignments.map(row => String(row.id)), assignedIds)
  assert.ok(initial.assignments.every(row => row.status === 'ASSIGNED' && row.check_in_at === null && row.check_out_at === null), 'Shared fixture must be unused before any live writes')
  assert.equal(initial.history.some(row => { try { return JSON.parse(row.note)?.kind === 'cleanhome.staff-transition' } catch { return false } }), false)
  beforeProtected = hash(await unrelated())
  const internal = (path, options = {}) => jsonRequest(orderBase, path, { token: serviceToken, ...options })
  const pendingPath = '/internal/v1/assignment-transitions/pending?limit=100'
  let preflightFailed = false
  const preflight = (name, action) => t.test(name, async () => { try { await action() } catch (error) { preflightFailed = true; throw error } })

  await preflight('actual Auth, Staff and Order health respond without replacing runtime services', async () => {
    for (const [base, name] of [[authBase, 'auth-service'], [staffBase, 'staff-service'], [orderBase, 'order-service']]) {
      const result = await jsonRequest(base, '/health/live')
      assert.equal(result.status, 200); assert.equal(result.body.service, name)
    }
    assert.equal((await jsonRequest(orderBase, '/health/ready')).status, 200)
  })
  await preflight('internal authentication rejects missing/wrong service credentials and actual user JWTs', async () => {
    for (const token of [undefined, randomBytes(32).toString('base64url'), tokens.A, tokens.CUSTOMER]) {
      const result = await jsonRequest(orderBase, pendingPath, { token })
      assert.equal(result.status, 401, 'Only the separately provisioned service Bearer credential may call internal APIs')
    }
    const allowed = await internal(pendingPath)
    assert.equal(allowed.status, 200); assert.ok(Array.isArray(allowed.body.operations))
  })
  await preflight('browser Origin is rejected even with a correct internal credential', async () => {
    const result = await internal(pendingPath, { headers: { Origin: 'http://localhost:3002' } })
    assert.equal(result.status, 403)
  })
  await preflight('actual Auth introspection and Staff list accept the matching A/B identities', async () => {
    for (const [name, userId, employeeId] of [['A', '9109002', '9109004'], ['B', '9109101', '9109102']]) {
      const auth = await jsonRequest(authBase, '/api/v1/auth/introspect', { token: tokens[name] })
      assert.equal(auth.status, 200); assert.equal(auth.body.sub, userId); assert.equal(auth.body.role, 'EMPLOYEE'); assert.equal(auth.body.active, true)
      const employee = await sql('SELECT id,user_id,status FROM employees WHERE id=? AND user_id=?', [employeeId, userId])
      assert.equal(employee.length, 1); assert.equal(employee[0].status, 'ACTIVE')
      const list = await jsonRequest(staffBase, '/api/v1/staff/me/jobs?pageSize=100', { token: tokens[name] })
      assert.equal(list.status, 200); assert.ok(list.body.data.some(row => assignedIds.includes(row.assignmentId)))
    }
  })
  await t.test('unchanged Staff HTTP suite validates JWT/ownership/UC9–UC12 with actual dependencies and no skipped writes', { timeout: 260000 }, async () => {
    assert.equal(preflightFailed, false, 'No write is permitted after a failed real dependency/auth preflight')
    const result = await runStaffSuite({ tokens, orderToken: serviceToken, staffBase, orderBase, authBase })
    assert.equal(result.timedOut, false, 'Staff HTTP runner exceeded its bounded deadline')
    assert.equal(result.tooLarge, false, 'Staff HTTP runner exceeded its bounded output limit')
    assert.equal(result.code, 0, 'Staff HTTP runner failed; child output withheld to avoid credential disclosure')
    assert.ok(Number.isInteger(result.metrics.tests) && result.metrics.tests > 0, 'Missing real child test summary')
    assert.equal(result.metrics.pass, result.metrics.tests)
    assert.equal(result.metrics.fail, 0); assert.equal(result.metrics.skipped, 0)
    assert.equal(result.uc12Executed, true, 'The child UC12 test must execute, not merely report passing read checks')
    console.log('Actual unchanged Staff HTTP metrics: ' + JSON.stringify(result.metrics))
  })
  const completed = await shared()
  assert.equal(completed.booking[0].status, 'COMPLETED', 'Staff UC12 did not complete the shared booking')
  assert.ok(completed.assignments.every(row => row.status === 'DONE' && row.check_in_at && row.check_out_at))
  const journals = completed.history.map(row => {
    let note
    try { note = JSON.parse(row.note) } catch { return null }
    return note?.kind === 'cleanhome.staff-transition' ? { row, note } : null
  }).filter(Boolean)
  assert.equal(journals.length, 6, 'Exactly six assignment transitions must be journaled for this two-employee fixture')
  assert.equal(new Set(journals.map(value => value.note.operation.id)).size, 6)

  await t.test('real MySQL assignments, booking, immutable ACKs and six unique acknowledged journals agree', async () => {
    for (const assignment of completed.assignments) {
      const owned = journals.filter(value => value.note.operation.assignmentId === String(assignment.id))
      assert.deepEqual(owned.map(value => value.note.operation.toStatus), ['ACCEPTED', 'IN_PROGRESS', 'DONE'])
      assert.equal(iso(assignment.check_in_at), owned.find(value => value.note.operation.toStatus === 'IN_PROGRESS').note.ack.occurredAt)
      assert.equal(iso(assignment.check_out_at), owned.find(value => value.note.operation.toStatus === 'DONE').note.ack.occurredAt)
    }
    const done = journals.filter(value => value.note.operation.toStatus === 'DONE')
    assert.equal(done[0].note.ack.booking.status, 'IN_PROGRESS'); assert.equal(done[1].note.ack.booking.status, 'COMPLETED')
    for (const { row, note } of journals) {
      assert.equal(note.version, 1); assert.equal(note.staffAcknowledged, true)
      assert.equal(String(row.changed_by), note.operation.actorUserId)
      assert.equal(row.status, note.ack.booking.status); assert.equal(iso(row.created_at), note.ack.occurredAt)
    }
  })
  await t.test('four internal endpoint contracts support lookup/replay, conflict, repeat acknowledgement and pending after completion', async () => {
    const before = hash(await shared())
    for (const { note } of journals) {
      const operation = note.operation
      const payload = Object.fromEntries(['assignmentId', 'employeeId', 'actorUserId', 'fromStatus', 'toStatus'].map(key => [key, operation[key]]))
      const path = '/internal/v1/bookings/' + operation.bookingId + '/assignment-transitions/' + operation.id
      const headers = { 'X-Actor-User-Id': operation.actorUserId, 'Idempotency-Key': operation.id }
      const lookup = await internal(path + '?' + new URLSearchParams(payload), { headers })
      assert.equal(lookup.status, 200); assert.deepEqual(lookup.body, note.ack)
      const duplicate = await internal(path, { method: 'PUT', headers, body: payload })
      assert.equal(duplicate.status, 200); assert.deepEqual(duplicate.body, note.ack)
      const ack = await internal(path + '/acknowledgement', { method: 'POST', headers, body: payload })
      assert.equal(ack.status, 200)
      assert.deepEqual(ack.body, { operationId: operation.id, bookingId: operation.bookingId, assignmentId: operation.assignmentId, acknowledged: true })
      const different = payload.toStatus === 'ACCEPTED' ? { ...payload, fromStatus: 'ACCEPTED', toStatus: 'IN_PROGRESS' } : { ...payload, fromStatus: 'ASSIGNED', toStatus: 'ACCEPTED' }
      const conflict = await internal(path, { method: 'PUT', headers, body: different })
      assert.equal(conflict.status, 409); assert.ok(['IDEMPOTENCY_CONFLICT', 'OPERATION_CONFLICT'].includes(conflict.body.error?.code))
    }
    const pending = await internal(pendingPath)
    assert.equal(pending.status, 200)
    const operationIds = new Set(journals.map(value => value.note.operation.id))
    assert.equal(pending.body.operations.some(operation => operationIds.has(operation.id)), false)
    assert.equal(hash(await shared()), before, 'Replay, rejected conflicts and duplicate acknowledgements must preserve all shared rows')
  })
  console.log('Shared UC12 fixture retained after real commits: ' + JSON.stringify({ bookingId: sharedId, status: completed.booking[0].status, assignments: assignedIds, journalCount: journals.length }))
})
