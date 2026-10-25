// These are Express/REST contract unit tests with a test-only in-memory repository.
// They do not connect MySQL, launch Auth, or constitute live Staff JWT integration.
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { createApp } from '../src/app.js'
import { createInternalAuth } from '../src/internal-auth.js'
import { OrderTransitionService } from '../src/service.js'
import { OrderError, decodeJournal } from '../src/domain.js'
import { OrderClient } from '../../staff-service/src/order-client.js'

const payload = (overrides = {}) => ({ assignmentId: '12', employeeId: '9', actorUserId: '7', fromStatus: 'ASSIGNED', toStatus: 'ACCEPTED', ...overrides })
const operation = (overrides = {}) => ({ id: 'operation-http-1', bookingId: '80', ...payload(), ...overrides })
const assignment = (overrides = {}) => ({ id: '12', bookingId: '80', employeeId: '9', actorUserId: '7', status: 'ASSIGNED', userRole: 'EMPLOYEE', userStatus: 'ACTIVE', employeeStatus: 'ACTIVE', checkInAt: null, checkOutAt: null, ...overrides })
const path = (op = operation()) => `/internal/v1/bookings/${op.bookingId}/assignment-transitions/${op.id}`
const bodyOf = op => Object.fromEntries(['assignmentId', 'employeeId', 'actorUserId', 'fromStatus', 'toStatus'].map(key => [key, op[key]]))

function memoryRepository() {
  let state = { booking: { id: '80', status: 'CONFIRMED' }, assignments: [assignment()], history: [] }
  let queue = Promise.resolve()
  const controls = { error: null, readinessError: null }
  return {
    get state() { return state }, controls,
    async assertSchema() { if (controls.readinessError) throw controls.readinessError },
    transactOperation(op, callback) {
      const run = queue.then(async () => {
        if (controls.error) throw controls.error
        const work = structuredClone(state)
        const tx = {
          booking: work.booking?.id === op.bookingId ? work.booking : null,
          assignments: work.assignments.filter(row => row.bookingId === op.bookingId),
          historyRows: work.history.filter(row => row.bookingId === op.bookingId),
          matchingHistoryRows: work.history.filter(row => decodeJournal(row)?.operation.id === op.id),
          async setBookingStatus(status) { work.booking.status = status },
          async insertHistory(metadata) {
            work.history.push({ id: String(1000 + work.history.length), bookingId: metadata.operation.bookingId,
              changedBy: metadata.operation.actorUserId, status: metadata.ack.booking.status,
              note: JSON.stringify(metadata), createdAt: metadata.ack.occurredAt })
          },
          async acknowledgeHistory(id, metadata) { work.history.find(row => row.id === id).note = JSON.stringify(metadata) },
        }
        const result = await callback(tx)
        state = work
        return result
      })
      queue = run.catch(() => {})
      return run
    },
    async listPendingRows(limit) {
      if (controls.error) throw controls.error
      return state.history.filter(row => decodeJournal(row)?.staffAcknowledged === false).slice(0, limit)
    },
  }
}

async function fixture(t) {
  const token = randomBytes(32).toString('base64url')
  const repository = memoryRepository(), logs = []
  const service = new OrderTransitionService(repository)
  const app = createApp({ repository, service, authenticate: createInternalAuth(token), logger: event => logs.push(event) })
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) })
  const baseUrl = `http://127.0.0.1:${server.address().port}`
  const client = new OrderClient({ baseUrl, token, timeoutMs: 2000 })
  const request = async (url, { method = 'GET', body, headers = {}, authenticated = true, raw = false } = {}) => {
    const response = await fetch(baseUrl + url, { method, redirect: 'error', signal: AbortSignal.timeout(2500),
      headers: { ...(authenticated ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      ...(body === undefined ? {} : { body: raw ? body : JSON.stringify(body) }),
    })
    return { status: response.status, headers: response.headers, body: await response.json() }
  }
  const put = (op = operation(), extra = {}) => request(path(op), { method: 'PUT', body: bodyOf(op), headers: { 'X-Actor-User-Id': op.actorUserId, 'Idempotency-Key': op.id }, ...extra })
  const get = (op = operation(), extra = {}) => request(path(op) + '?' + new URLSearchParams(bodyOf(op)), { headers: { 'X-Actor-User-Id': op.actorUserId }, ...extra })
  return { repository, logs, token, client, request, put, get }
}

test('public liveness/readiness exposes no internal credential or implementation headers', async t => {
  const f = await fixture(t)
  for (const endpoint of ['/health/live', '/health/ready']) {
    const response = await f.request(endpoint, { authenticated: false })
    assert.equal(response.status, 200)
    assert.equal(response.body.service, 'order-service')
    assert.equal(response.headers.get('x-powered-by'), null)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
    assert.ok(response.headers.get('x-request-id'))
  }
})

test('internal routes reject missing, wrong, malformed and user-JWT-shaped Bearer credentials', async t => {
  const f = await fixture(t)
  const wrong = randomBytes(32).toString('base64url')
  for (const headers of [{}, { Authorization: `Bearer ${wrong}` }, { Authorization: 'Bearer header.payload.signature' }, { Authorization: 'Basic not-service-auth' }]) {
    const response = await f.request('/internal/v1/assignment-transitions/pending', { authenticated: false, headers })
    assert.equal(response.status, 401)
    assert.equal(response.body.error.code, 'SERVICE_UNAUTHENTICATED')
    assert.equal(response.headers.get('www-authenticate'), 'Bearer')
  }
  assert.equal(f.repository.state.history.length, 0)
})

test('valid service credential cannot be used with browser Origin', async t => {
  const f = await fixture(t)
  const response = await f.request('/internal/v1/assignment-transitions/pending', { headers: { Origin: 'http://localhost:3002' } })
  assert.equal(response.status, 403)
  assert.equal(response.body.error.code, 'INTERNAL_ONLY')
})

test('actual Staff OrderClient matches all four routes, commit guard, replay and pending contract', async t => {
  const f = await fixture(t), op = operation()
  assert.equal(await f.client.getAssignmentTransition(op), null)
  const ack = await f.client.applyAssignmentTransition(op)
  assert.equal(ack.assignmentStatus, 'ACCEPTED')
  assert.equal(ack.booking.status, 'CONFIRMED')
  assert.equal(ack.booking.cancellationPending, null)
  assert.equal(f.repository.state.assignments[0].status, 'ASSIGNED')
  assert.equal(f.repository.state.history.length, 1)
  assert.deepEqual(await f.client.getAssignmentTransition(op), ack)
  assert.deepEqual(await f.client.listPendingTransitions({ limit: 20 }), [op])
  await assert.rejects(f.client.ackAssignmentTransition(op), error => error.code === 'ORDER_REJECTED' && error.details?.reason === 'STALE_ASSIGNMENT')
  assert.equal(decodeJournal(f.repository.state.history[0]).staffAcknowledged, false)
  f.repository.state.assignments[0].status = 'ACCEPTED' // test-only simulation of a Staff DB commit
  assert.equal((await f.client.ackAssignmentTransition(op)).acknowledged, true)
  assert.equal((await f.client.ackAssignmentTransition(op)).acknowledged, true)
  assert.deepEqual(await f.client.listPendingTransitions({ limit: 20 }), [])
  const originalHistory = structuredClone(f.repository.state.history)
  f.repository.state.booking.status = 'COMPLETED'
  assert.deepEqual(await f.client.applyAssignmentTransition(op), ack)
  assert.deepEqual(await f.client.getAssignmentTransition(op), ack)
  assert.deepEqual(f.repository.state.history, originalHistory)
})

test('same operationId with changed payload conflicts, not an additional history', async t => {
  const f = await fixture(t)
  const first = await f.put()
  assert.equal(first.status, 200)
  const before = structuredClone(f.repository.state)
  const op = operation({ fromStatus: 'ACCEPTED', toStatus: 'IN_PROGRESS' })
  const changed = await f.put(op)
  assert.equal(changed.status, 409)
  assert.equal(changed.body.error.code, 'IDEMPOTENCY_CONFLICT')
  assert.deepEqual(f.repository.state, before)
})

test('future check-in rejects DONE without committing booking or journal', async t => {
  const f = await fixture(t)
  f.repository.state.booking.status = 'IN_PROGRESS'
  f.repository.state.assignments[0].status = 'IN_PROGRESS'
  f.repository.state.assignments[0].checkInAt = new Date(Date.now() + 3600000).toISOString()
  const before = structuredClone(f.repository.state)
  const response = await f.put(operation({ fromStatus: 'IN_PROGRESS', toStatus: 'DONE' }))
  assert.equal(response.status, 409)
  assert.equal(response.body.error.code, 'INVALID_TRANSITION')
  assert.deepEqual(f.repository.state, before)
})

test('same-step different-key and concurrent replays leave a single committed journal', async t => {
  const f = await fixture(t)
  const [a, b] = await Promise.all([f.put(), f.put()])
  assert.equal(a.status, 200)
  assert.equal(b.status, 200)
  assert.deepEqual(a.body, b.body)
  const duplicate = await f.put(operation({ id: 'different-key' }))
  assert.equal(duplicate.status, 409)
  assert.equal(duplicate.body.error.code, 'INVALID_TRANSITION')
  assert.equal(f.repository.state.history.length, 1)
})

test('unknown booking and mismatched assignment return explicit errors with no changes', async t => {
  const f = await fixture(t), before = structuredClone(f.repository.state)
  const missing = await f.put(operation({ bookingId: '81' }))
  assert.equal(missing.status, 404)
  assert.equal(missing.body.error.code, 'BOOKING_NOT_FOUND')
  const wrong = await f.put(operation({ assignmentId: '99' }))
  assert.equal(wrong.status, 409)
  assert.equal(wrong.body.error.code, 'STALE_ASSIGNMENT')
  assert.deepEqual(f.repository.state, before)
})

test('cancelled/completed/pending booking and locked account reject new operations', async t => {
  const f = await fixture(t)
  for (const [status, code] of [['CANCELLED', 'BOOKING_CANCELLED'], ['COMPLETED', 'BOOKING_COMPLETED'], ['PENDING', 'BOOKING_NOT_CONFIRMED']]) {
    f.repository.state.booking.status = status
    const response = await f.put()
    assert.equal(response.status, 409)
    assert.equal(response.body.error.code, code)
  }
  f.repository.state.booking.status = 'CONFIRMED'
  f.repository.state.assignments[0].userStatus = 'LOCKED'
  const locked = await f.put()
  assert.equal(locked.status, 409)
  assert.equal(locked.body.error.code, 'ASSIGNMENT_NOT_ACTIVE')
  assert.equal(f.repository.state.history.length, 0)
})

test('canonical IDs, operation IDs, role-sensitive actor and key headers are validated', async t => {
  const f = await fixture(t)
  for (const changed of [{ bookingId: '080' }, { bookingId: '80junk' }, { assignmentId: '12junk' }, { employeeId: '0' }, { actorUserId: '9223372036854775808' }, { id: 'invalid.id' }, { id: 'x'.repeat(129) }]) {
    const response = await f.put(operation(changed))
    assert.equal(response.status, 400)
    assert.equal(response.body.error.code, 'INVALID_REQUEST')
  }
  for (const headers of [{ 'X-Actor-User-Id': '8', 'Idempotency-Key': operation().id }, { 'X-Actor-User-Id': '7', 'Idempotency-Key': 'other' }, {}]) {
    assert.equal((await f.put(operation(), { headers })).status, 400)
  }
  assert.equal(f.repository.state.history.length, 0)
})

test('lookup rejects unknown/repeated query fields and invalid state steps', async t => {
  const f = await fixture(t)
  const baseQuery = new URLSearchParams(payload())
  for (const query of [baseQuery + '&extra=x', baseQuery + '&assignmentId=12', baseQuery + '&actorUserId=7', new URLSearchParams(payload({ fromStatus: 'constructor', toStatus: 'IN_PROGRESS' })), new URLSearchParams(payload({ toStatus: 'DONE' }))]) {
    const response = await f.request(path() + '?' + query, { headers: { 'X-Actor-User-Id': '7' } })
    assert.equal(response.status, 400)
  }
  assert.equal((await f.get()).body.error.code, 'TRANSITION_NOT_FOUND')
})

test('write body rejects extra fields, wrong types, malformed JSON and over-limit body', async t => {
  const f = await fixture(t)
  for (const body of [payload({ extra: 'x' }), payload({ assignmentId: 12 }), [], null, payload({ toStatus: 'DONE' })]) {
    assert.equal((await f.put(operation(), { body })).status, 400)
  }
  const malformed = await f.put(operation(), { body: '{bad-json', raw: true })
  assert.equal(malformed.status, 400)
  assert.equal(malformed.body.error.code, 'INVALID_JSON')
  const oversize = await f.put(operation(), { body: { ...payload(), oversized: 'x'.repeat(9000) } })
  assert.equal(oversize.status, 413)
  assert.equal(oversize.body.error.code, 'BODY_TOO_LARGE')
  assert.equal(f.repository.state.history.length, 0)
})

test('pending supports real operation payload and enforces default/bounded single limit', async t => {
  const f = await fixture(t)
  f.repository.state.assignments.push(assignment({ id: '13', employeeId: '10', actorUserId: '8' }))
  assert.equal((await f.put()).status, 200)
  const other = operation({ id: 'operation-http-2', assignmentId: '13', employeeId: '10', actorUserId: '8' })
  assert.equal((await f.put(other)).status, 200)
  assert.equal((await f.request('/internal/v1/assignment-transitions/pending')).body.operations.length, 2)
  assert.equal((await f.client.listPendingTransitions({ limit: 1 })).length, 1)
  for (const query of ['limit=0', 'limit=101', 'limit=01', 'limit=-1', 'limit=1.5', 'limit=2&limit=3', 'extra=x']) {
    const response = await f.request('/internal/v1/assignment-transitions/pending?' + query)
    assert.equal(response.status, 400)
  }
})

test('ACK verifies Staff commit timestamps and remains idempotent after later steps', async t => {
  const f = await fixture(t)
  f.repository.state.assignments[0].status = 'ACCEPTED'
  const op = operation({ fromStatus: 'ACCEPTED', toStatus: 'IN_PROGRESS' })
  const ack = await f.client.applyAssignmentTransition(op)
  f.repository.state.assignments[0].status = 'IN_PROGRESS'
  f.repository.state.assignments[0].checkInAt = '2026-01-01T00:00:00.000Z'
  await assert.rejects(f.client.ackAssignmentTransition(op), error => error.details?.reason === 'STALE_ASSIGNMENT')
  f.repository.state.assignments[0].checkInAt = ack.occurredAt
  assert.equal((await f.client.ackAssignmentTransition(op)).acknowledged, true)
  f.repository.state.assignments[0].status = 'DONE'
  assert.equal((await f.client.ackAssignmentTransition(op)).acknowledged, true)
  assert.equal(f.repository.state.history.length, 1)
})

test('unknown/incorrect-method routes are explicit JSON 404, never a transition lookup miss', async t => {
  const f = await fixture(t)
  for (const [endpoint, method] of [['/internal/v1/not-real', 'GET'], [path(), 'DELETE'], [path() + '/acknowledgement', 'GET']]) {
    const response = await f.request(endpoint, { method })
    assert.equal(response.status, 404)
    assert.equal(response.body.error.code, 'NOT_FOUND')
  }
})

test('database errors are sanitized and request logs never contain credentials or bodies', async t => {
  const f = await fixture(t), secret = randomBytes(32).toString('hex')
  f.repository.controls.error = new OrderError(503, 'DATABASE_UNAVAILABLE', 'Chưa kết nối được cơ sở dữ liệu.')
  const unavailable = await f.put()
  assert.equal(unavailable.status, 503)
  assert.equal(unavailable.headers.get('retry-after'), '2')
  await assert.rejects(f.client.applyAssignmentTransition(operation()), error => error.code === 'ORDER_UNAVAILABLE')
  f.repository.controls.error = new Error('SQL connection credential ' + secret)
  const internal = await f.put()
  assert.equal(internal.status, 500)
  assert.equal(internal.body.error.code, 'INTERNAL_ERROR')
  const encoded = JSON.stringify({ logs: f.logs, body: internal.body })
  assert.equal(encoded.includes(f.token), false)
  assert.equal(encoded.includes(secret), false)
  assert.equal(encoded.includes('Authorization'), false)
  for (const entry of f.logs) assert.deepEqual(Object.keys(entry).sort(), ['event', 'method', 'path', 'requestId', 'status'])
  assert.equal(f.repository.state.history.length, 0)
})

test('internal credential construction rejects unsafe/short/newline values', () => {
  for (const token of [undefined, '', 'weak', 'a'.repeat(42), 'a'.repeat(201), 'a'.repeat(43) + '\n', 'contains.dots.not-service-token']) {
    assert.throws(() => createInternalAuth(token), /Invalid internal credential configuration/)
  }
})
