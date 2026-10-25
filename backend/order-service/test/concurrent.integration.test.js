// Real Auth JWT -> Staff -> Order -> MySQL. New labelled QA rows are retained.
// This suite never signs user tokens, mocks a dependency, resets or deletes rows.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { createPool } from '../src/db.js'
import { loadConfig, readServiceToken } from '../src/config.js'
import { MysqlOrderRepository } from '../src/repository.js'
import { createFixture, appendFixtureOperation } from './fixtures.js'
import { authTokens, jsonRequest, localBase } from '../scripts/test-http.js'

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const iso = value => value == null ? null : new Date(String(value).replace(' ', 'T') + (/Z$|[+-]\d\d:\d\d$/.test(String(value)) ? '' : 'Z')).toISOString()

test('real concurrent Staff JWT transitions, duplicate requests and two-worker completion use a fresh retained QA fixture', {
  skip: process.env.RUN_ORDER_CONCURRENT_TESTS === 'true' ? false : 'Set RUN_ORDER_CONCURRENT_TESTS=true only with actual Auth, Staff, Order and explicit fixture-write approval',
  timeout: 240000,
}, async t => {
  assert.equal(process.env.ORDER_TEST_ALLOW_FIXTURE_WRITES, 'true', 'Explicitly allow new retained QA fixtures; no existing booking is reset')
  assert.equal(process.env.MYSQL_DATABASE, 'cleanhome_staff_test', 'Concurrent integration is restricted to the dedicated test database')
  const config = loadConfig(), serviceToken = await readServiceToken(config.credential), tokens = await authTokens()
  const orderBase = localBase(process.env.ORDER_LIVE_BASE_URL || 'http://127.0.0.1:4003', 'ORDER_LIVE_BASE_URL')
  const staffBase = localBase(process.env.ORDER_LIVE_STAFF_URL || 'http://127.0.0.1:4005', 'ORDER_LIVE_STAFF_URL')
  const authBase = localBase(process.env.ORDER_LIVE_AUTH_URL || 'http://127.0.0.1:4001', 'ORDER_LIVE_AUTH_URL')
  const pool = createPool(config.db), repository = new MysqlOrderRepository(pool)
  const sql = (query, bindings = []) => repository.connection(async connection => (await connection.execute(query, bindings))[0])
  const internal = (path, options = {}) => jsonRequest(orderBase, path, { token: serviceToken, ...options })
  let fixture, protectedBefore
  const unrelated = async () => ({
    users: await sql('SELECT id,phone,password_hash,role,status FROM users ORDER BY id'),
    employees: await sql('SELECT * FROM employees ORDER BY id'),
    services: await sql('SELECT * FROM services ORDER BY id'),
    bookings: await sql('SELECT * FROM bookings WHERE id<>? ORDER BY id', [fixture.bookingId]),
    assignments: await sql('SELECT * FROM assignments WHERE booking_id<>? ORDER BY id', [fixture.bookingId]),
    items: await sql('SELECT * FROM booking_items WHERE booking_id<>? ORDER BY id', [fixture.bookingId]),
    history: await sql('SELECT * FROM booking_status_history WHERE booking_id<>? ORDER BY id', [fixture.bookingId]),
  })
  const current = async () => ({
    booking: (await sql('SELECT * FROM bookings WHERE id=?', [fixture.bookingId]))[0],
    assignments: await sql('SELECT * FROM assignments WHERE booking_id=? ORDER BY id', [fixture.bookingId]),
    history: await sql('SELECT * FROM booking_status_history WHERE booking_id=? ORDER BY id', [fixture.bookingId]),
  })
  t.after(async () => {
    try { if (protectedBefore) assert.equal(hash(await unrelated()), protectedBefore, 'Concurrent suite changed unrelated rows or account credentials') }
    finally { await pool.end() }
  })
  await repository.assertSchema()
  const [database] = await sql('SELECT DATABASE() AS name')
  assert.equal(database.name, 'cleanhome_staff_test')
  // All dependency and identity checks precede INSERT or Staff PATCH operations.
  for (const [base, name] of [[authBase, 'auth-service'], [staffBase, 'staff-service'], [orderBase, 'order-service']]) {
    const live = await jsonRequest(base, '/health/live')
    assert.equal(live.status, 200)
    assert.equal(live.body.service, name)
  }
  assert.equal((await jsonRequest(orderBase, '/health/ready')).status, 200)
  for (const [label, userId, role] of [['A', '9109002', 'EMPLOYEE'], ['B', '9109101', 'EMPLOYEE'], ['CUSTOMER', '9109001', 'CUSTOMER']]) {
    const actual = await jsonRequest(authBase, '/api/v1/auth/introspect', { token: tokens[label] })
    assert.equal(actual.status, 200)
    assert.equal(actual.body.sub, userId)
    assert.equal(actual.body.role, role)
    assert.equal(actual.body.active, true)
  }
  assert.equal((await internal('/internal/v1/assignment-transitions/pending?limit=100')).status, 200)
  fixture = await createFixture(pool, { label: 'concurrent-staff-jwt', assignmentStatuses: ['ASSIGNED', 'ASSIGNED'] })
  protectedBefore = hash(await unrelated())
  const people = fixture.actorUserIds.map((userId, index) => ({
    userId, employeeId: fixture.employeeIds[index], assignmentId: fixture.assignmentIds[index],
    token: tokens[index === 0 ? 'A' : 'B'], index,
  }))
  const transitions = []
  for (const [fromStatus, toStatus] of [['ASSIGNED', 'ACCEPTED'], ['ACCEPTED', 'IN_PROGRESS'], ['IN_PROGRESS', 'DONE']]) {
    for (const person of people) {
      const key = randomUUID(), id = hash([person.userId, person.assignmentId, key])
      const operation = { id, bookingId: fixture.bookingId, assignmentId: person.assignmentId, employeeId: person.employeeId, actorUserId: person.userId, fromStatus, toStatus }
      await appendFixtureOperation(fixture, operation)
      transitions.push({ operation, person, key })
    }
  }
  const patch = transition => jsonRequest(staffBase, '/api/v1/staff/me/jobs/' + transition.person.assignmentId + '/status', {
    method: 'PATCH', token: transition.person.token, body: { status: transition.operation.toStatus }, headers: { 'Idempotency-Key': transition.key },
  })
  const verifyResponse = (response, transition) => {
    assert.equal(response.status, 200, 'A genuine Staff transition must complete both commits and acknowledgement')
    assert.equal(response.body.data?.transition?.synchronization, 'SYNCHRONIZED')
    assert.equal(response.body.data?.transition?.operationId, transition.operation.id)
    assert.equal(response.body.data?.assignmentId, transition.person.assignmentId)
    assert.equal(response.body.data?.status, transition.operation.toStatus)
  }
  const journal = state => state.history.map(row => {
    let metadata
    try { metadata = JSON.parse(row.note) } catch { throw new Error('Fresh concurrent QA journal is not valid JSON') }
    assert.equal(metadata.kind, 'cleanhome.staff-transition')
    return { row, metadata }
  })
  let failed = false
  const step = (name, action) => t.test(name, async () => {
    assert.equal(failed, false, 'An earlier concurrency step failed; retain current rows without further state-changing requests')
    try { await action() } catch (error) { failed = true; throw error }
  })

  await step('real A/B ownership and HTTP authorization reject cross-assignment PATCH, missing JWT and Customer JWT', async () => {
    const before = hash(await current())
    for (const person of people) {
      const own = await jsonRequest(staffBase, '/api/v1/staff/me/jobs/' + person.assignmentId, { token: person.token })
      assert.equal(own.status, 200)
      assert.equal(own.body.data?.assignmentId, person.assignmentId)
      const otherId = people[1 - person.index].assignmentId
      const crossRead = await jsonRequest(staffBase, '/api/v1/staff/me/jobs/' + otherId, { token: person.token })
      assert.equal(crossRead.status, 404)
      const crossWrite = await jsonRequest(staffBase, '/api/v1/staff/me/jobs/' + otherId + '/status', {
        method: 'PATCH', token: person.token, body: { status: 'ACCEPTED' }, headers: { 'Idempotency-Key': randomUUID() },
      })
      assert.equal(crossWrite.status, 404)
    }
    for (const [token, status] of [[undefined, 401], [tokens.CUSTOMER, 403]]) {
      const rejected = await jsonRequest(staffBase, '/api/v1/staff/me/jobs/' + people[0].assignmentId + '/status', {
        method: 'PATCH', token, body: { status: 'ACCEPTED' }, headers: { 'Idempotency-Key': randomUUID() },
      })
      assert.equal(rejected.status, status)
    }
    assert.equal(hash(await current()), before, 'Rejected ownership/auth requests must not create journal or change assignment')
  })

  await step('A and B accept concurrently, with two same-key duplicate requests per employee', async () => {
    const accepts = transitions.filter(value => value.operation.toStatus === 'ACCEPTED')
    const responses = await Promise.all(accepts.flatMap(transition => [patch(transition), patch(transition)]))
    for (const [index, transition] of accepts.entries()) {
      const pair = responses.slice(index * 2, index * 2 + 2)
      pair.forEach(response => verifyResponse(response, transition))
      assert.deepEqual(pair.map(response => response.body.data.transition.replayed).sort(), [false, true])
      assert.ok(pair.every(response => response.body.data.orderAtTransition.status === 'CONFIRMED'))
    }
    const state = await current(), records = journal(state)
    assert.equal(state.booking.status, 'CONFIRMED')
    assert.ok(state.assignments.every(row => row.status === 'ACCEPTED' && row.check_in_at === null && row.check_out_at === null))
    assert.equal(records.length, 2)
    assert.equal(new Set(records.map(value => value.metadata.operation.id)).size, 2)
    assert.ok(records.every(value => value.metadata.staffAcknowledged === true))
  })

  await step('A and B start concurrently and MySQL check-in equals immutable Order timestamps', async () => {
    const starts = transitions.filter(value => value.operation.toStatus === 'IN_PROGRESS')
    const responses = await Promise.all(starts.map(patch))
    responses.forEach((response, index) => verifyResponse(response, starts[index]))
    const state = await current(), records = journal(state)
    assert.equal(state.booking.status, 'IN_PROGRESS')
    assert.equal(records.length, 4)
    for (const [index, transition] of starts.entries()) {
      const row = state.assignments.find(row => String(row.id) === transition.person.assignmentId)
      const saved = records.find(value => value.metadata.operation.id === transition.operation.id)
      assert.equal(row.status, 'IN_PROGRESS')
      assert.equal(row.check_out_at, null)
      assert.equal(saved.metadata.staffAcknowledged, true)
      assert.equal(iso(row.check_in_at), saved.metadata.ack.occurredAt)
      assert.equal(responses[index].body.data.checkInAt, saved.metadata.ack.occurredAt)
      assert.equal(responses[index].body.data.orderAtTransition.asOf, saved.metadata.ack.occurredAt)
    }
  })

  await step('simultaneous DONE requests keep first ACK IN_PROGRESS and complete only after both workers', async () => {
    const done = transitions.filter(value => value.operation.toStatus === 'DONE')
    const responses = await Promise.all(done.map(patch))
    responses.forEach((response, index) => verifyResponse(response, done[index]))
    assert.deepEqual(responses.map(response => response.body.data.orderAtTransition.status).sort(), ['COMPLETED', 'IN_PROGRESS'])
    const state = await current(), records = journal(state)
    assert.equal(state.booking.status, 'COMPLETED')
    assert.equal(records.length, 6)
    assert.equal(new Set(records.map(value => value.metadata.operation.id)).size, 6)
    for (const row of state.assignments) {
      assert.equal(row.status, 'DONE')
      const owned = records.filter(value => value.metadata.operation.assignmentId === String(row.id))
      assert.deepEqual(owned.map(value => value.metadata.operation.toStatus).sort(), ['ACCEPTED', 'DONE', 'IN_PROGRESS'])
      const start = owned.find(value => value.metadata.operation.toStatus === 'IN_PROGRESS')
      const finish = owned.find(value => value.metadata.operation.toStatus === 'DONE')
      assert.equal(iso(row.check_in_at), start.metadata.ack.occurredAt)
      assert.equal(iso(row.check_out_at), finish.metadata.ack.occurredAt)
      assert.ok(iso(row.check_out_at) >= iso(row.check_in_at))
    }
    for (const { row, metadata } of records) {
      assert.equal(metadata.version, 1)
      assert.equal(metadata.staffAcknowledged, true)
      assert.equal(String(row.changed_by), metadata.operation.actorUserId)
      assert.equal(row.status, metadata.ack.booking.status)
      assert.equal(iso(row.created_at), metadata.ack.occurredAt)
    }
  })

  await step('replaying all six old keys after completion does not duplicate history or rewind timestamps/state', async () => {
    const before = hash(await current())
    const responses = await Promise.all(transitions.map(patch))
    for (const [index, response] of responses.entries()) {
      assert.equal(response.status, 200)
      assert.equal(response.body.data?.transition?.operationId, transitions[index].operation.id)
      assert.equal(response.body.data?.transition?.replayed, true)
      assert.equal(response.body.data?.transition?.synchronization, 'SYNCHRONIZED')
      assert.equal(response.body.data?.status, 'DONE')
    }
    const ids = new Set(transitions.map(value => value.operation.id))
    const pending = await internal('/internal/v1/assignment-transitions/pending?limit=100')
    assert.equal(pending.status, 200)
    assert.ok(Array.isArray(pending.body.operations))
    assert.equal(pending.body.operations.some(operation => ids.has(operation.id)), false)
    assert.equal(hash(await current()), before, 'Replay must preserve current assignment rows, booking and the original six journals')
  })

  const final = await current()
  assert.equal(failed, false)
  assert.equal(final.booking.status, 'COMPLETED')
  console.log('Concurrent real JWT QA fixture retained: ' + JSON.stringify({ bookingId: fixture.bookingId, assignmentIds: fixture.assignmentIds, status: final.booking.status, journalCount: final.history.length }))
})
