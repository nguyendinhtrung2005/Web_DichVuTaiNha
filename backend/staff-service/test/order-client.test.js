import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { OrderClient } from '../src/order-client.js'

const operation = { id: 'operation-test-1', bookingId: '80', assignmentId: '12', employeeId: '9', actorUserId: '7', fromStatus: 'ASSIGNED', toStatus: 'ACCEPTED' }
const booking = { id: '80', status: 'CONFIRMED', cancellationPending: null }
const acknowledged = (op = operation, status = 'CONFIRMED') => ({ operationId: op.id, assignmentId: op.assignmentId, bookingId: op.bookingId,
  assignmentStatus: op.toStatus, occurredAt: '2026-10-23T01:00:00.000Z', booking: { ...booking, status } })
const reject = (promise, status, code) => assert.rejects(promise, error => error.status === status && error.code === code)

// This is a real loopback HTTP server, but its Order dependency responses are
// explicitly test stubs. It does not implement or certify the team's Order Service.
async function fixture(t) {
  const requests = []
  let respond = () => ({ status: 200, body: acknowledged() })
  const server = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const raw = Buffer.concat(chunks).toString('utf8')
    const entry = { method: request.method, path: request.url, headers: request.headers, body: raw ? JSON.parse(raw) : undefined }
    requests.push(entry)
    const result = await respond(entry)
    if (result.disconnect) { request.socket.destroy(); return }
    if (result.delay) await new Promise(resolve => setTimeout(resolve, result.delay))
    if (response.destroyed) return
    response.writeHead(result.status ?? 200, { 'Content-Type': result.type ?? 'application/json', ...result.headers })
    if (result.prefix !== undefined) {
      response.write(result.prefix)
      await new Promise(resolve => setTimeout(resolve, result.streamDelay ?? 100))
      if (response.destroyed) return
    }
    response.end(result.raw ?? JSON.stringify(result.body))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections() }))
  const token = randomBytes(32).toString('hex')
  const config = { baseUrl: 'http://127.0.0.1:' + server.address().port, token, timeoutMs: 500 }
  return { requests, token, client: new OrderClient(config), config, set respond(callback) { respond = callback } }
}

test('Order HTTP client: configuration and explicit empty batch', async () => {
  let called = false
  const client = new OrderClient({}, { fetchImpl: async () => { called = true } })
  assert.deepEqual(await client.getBookingContexts({ bookingIds: [], actorUserId: '7' }), new Map())
  await reject(client.applyAssignmentTransition(operation), 503, 'ORDER_UNAVAILABLE')
  assert.equal(called, false)
  assert.throws(() => new OrderClient({ baseUrl: 'https://user:password@example.invalid' }))
  assert.throws(() => new OrderClient({ token: 'invalid\r\ncredential' }))
  assert.throws(() => new OrderClient({ timeoutMs: 0 }))
  await assert.rejects(client.applyAssignmentTransition({ ...operation, fromStatus: 'WAITING' }), TypeError)
})

test('Order HTTP client: entity IDs are canonical signed BIGINT, never MySQL-coerced strings', async t => {
  const f = await fixture(t)
  const invalid = ['7junk', '007', '0', '-7', '7 OR 1=1', '9223372036854775808', Number.MAX_SAFE_INTEGER + 1]
  for (const value of invalid) {
    await assert.rejects(f.client.getBookingDetail({ bookingId: value, actorUserId: '7' }), TypeError)
    await assert.rejects(f.client.getBookingContexts({ bookingIds: ['80'], actorUserId: value }), TypeError)
    for (const key of ['bookingId', 'assignmentId', 'employeeId', 'actorUserId']) {
      await assert.rejects(f.client.applyAssignmentTransition({ ...operation, [key]: value }), TypeError)
    }
    f.respond = () => ({ body: { operations: [{ ...operation, actorUserId: value }] } })
    await reject(f.client.listPendingTransitions(), 502, 'ORDER_BAD_RESPONSE')
  }
  const max = '9223372036854775807'
  f.respond = () => ({ body: { ...booking, id: max } })
  assert.equal((await f.client.getBookingDetail({ bookingId: max, actorUserId: '7' })).id, max)
  f.respond = () => ({ body: { ...acknowledged(), assignmentId: '12junk' } })
  await reject(f.client.applyAssignmentTransition(operation), 502, 'ORDER_BAD_RESPONSE')
})

test('Order HTTP client: native fetch sends service credential and whitelisted transition payload', async t => {
  const f = await fixture(t)
  const result = await f.client.applyAssignmentTransition({ ...operation, callerJwt: randomBytes(16).toString('hex'), occurredAt: 'untrusted-time' })
  assert.equal(result.occurredAt, '2026-10-23T01:00:00.000Z')
  assert.equal(f.requests.length, 1)
  const request = f.requests[0]
  assert.equal(request.method, 'PUT')
  assert.equal(request.path, '/internal/v1/bookings/80/assignment-transitions/operation-test-1')
  assert.equal(request.headers.authorization, 'Bearer ' + f.token)
  assert.equal(request.headers['idempotency-key'], operation.id)
  assert.equal(request.headers['x-actor-user-id'], operation.actorUserId)
  assert.deepEqual(request.body, { assignmentId: '12', employeeId: '9', actorUserId: '7', fromStatus: 'ASSIGNED', toStatus: 'ACCEPTED' })
  assert.deepEqual(Object.keys(result.booking).sort(), ['cancellationPending', 'id', 'status'])
})

test('Order HTTP client: detail and batch preserve unknown fields as unknown, strip sensitive extra attributes', async t => {
  const f = await fixture(t)
  const context = { ...booking, contact: { name: 'Tên trong bản ghi', phone: 'contact-only', address: 'Địa chỉ trong bản ghi', password_hash: 'must-not-forward' },
    items: [{ serviceId: 2, serviceName: 'Tên snapshot', unit: 'giờ', quantity: '2.00', secret: 'must-not-forward' }], password_hash: 'must-not-forward' }
  f.respond = request => ({ body: request.method === 'POST' ? { bookings: [context] } : context })
  const detail = await f.client.getBookingDetail({ bookingId: 80, actorUserId: 7 })
  assert.equal(detail.history, null)
  assert.equal(detail.cancellationPending, null)
  assert.equal(detail.createdAt, undefined)
  assert.equal(detail.contact.hasPets, undefined)
  assert.equal(detail.password_hash, undefined)
  assert.equal(detail.contact.password_hash, undefined)
  assert.equal(detail.items[0].secret, undefined)
  const result = await f.client.getBookingContexts({ bookingIds: [80, '80'], actorUserId: '7' })
  assert.equal(result.size, 1)
  assert.equal(result.get('80').items[0].quantity, '2.00')
  assert.deepEqual(f.requests.at(-1).body, { bookingIds: ['80'], actorUserId: '7' })
})

test('Order HTTP client: real empty history differs from unavailable history', async t => {
  const f = await fixture(t)
  f.respond = () => ({ body: { ...booking, history: [] } })
  assert.deepEqual((await f.client.getBookingDetail({ bookingId: '80', actorUserId: '7' })).history, [])
  f.respond = () => ({ body: { ...booking, history: [{ at: '2026-10-23T01:00:00Z', label: 'Đã xác nhận', by: 'Order Service', note: 'Ghi chú' }] } })
  assert.equal((await f.client.getBookingDetail({ bookingId: '80', actorUserId: '7' })).history.length, 1)
})

test('Order HTTP client: incomplete, duplicate or unexpected batch contexts fail closed', async t => {
  const f = await fixture(t)
  for (const bookings of [[], [booking, booking], [{ ...booking, id: '81' }], [null]]) {
    f.respond = () => ({ body: { bookings } })
    await reject(f.client.getBookingContexts({ bookingIds: ['80'], actorUserId: '7' }), 502, 'ORDER_BAD_RESPONSE')
  }
  f.respond = () => ({ body: { id: '81', status: 'CONFIRMED', cancellationPending: null } })
  await reject(f.client.getBookingDetail({ bookingId: '80', actorUserId: '7' }), 502, 'ORDER_BAD_RESPONSE')
})

test('Order HTTP client: acknowledgement cannot claim another operation, invalid timestamp or cancelled booking', async t => {
  const f = await fixture(t)
  const valid = acknowledged()
  const invalid = [null, {}, { ...valid, operationId: 'wrong' }, { ...valid, assignmentId: 'wrong' }, { ...valid, bookingId: 'wrong' },
    { ...valid, assignmentStatus: 'DONE' }, { ...valid, occurredAt: 'not-a-time' }, { ...valid, occurredAt: '2026-02-30T01:00:00Z' },
    { ...valid, occurredAt: '2026-10-23T24:00:00Z' }, { ...valid, booking: { ...booking, id: 'wrong' } },
    { ...valid, booking: { ...booking, status: 'CANCELLED' } }, { ...valid, booking: { ...booking, status: 'COMPLETED' } },
    { ...valid, booking: { id: '80', status: 'CONFIRMED' } }]
  for (const body of invalid) {
    f.respond = () => ({ body })
    await reject(f.client.applyAssignmentTransition(operation), 502, 'ORDER_BAD_RESPONSE')
  }
})

test('Order HTTP client: status projection supports multiple workers, never completes booking prematurely itself', async t => {
  const f = await fixture(t)
  for (const [toStatus, fromStatus, bookingStatus] of [
    ['ACCEPTED', 'ASSIGNED', 'CONFIRMED'], ['ACCEPTED', 'ASSIGNED', 'IN_PROGRESS'],
    ['IN_PROGRESS', 'ACCEPTED', 'IN_PROGRESS'], ['DONE', 'IN_PROGRESS', 'IN_PROGRESS'], ['DONE', 'IN_PROGRESS', 'COMPLETED'],
  ]) {
    const op = { ...operation, toStatus, fromStatus }
    f.respond = () => ({ body: acknowledged(op, bookingStatus) })
    assert.equal((await f.client.applyAssignmentTransition(op)).booking.status, bookingStatus)
  }
  const start = { ...operation, fromStatus: 'ACCEPTED', toStatus: 'IN_PROGRESS' }
  f.respond = () => ({ body: { ...acknowledged(start, 'IN_PROGRESS'), booking: { id: '80', status: 'IN_PROGRESS', cancellationPending: true } } })
  await reject(f.client.applyAssignmentTransition(start), 502, 'ORDER_BAD_RESPONSE')
})

test('Order HTTP client: only explicit transition-not-found allows safe first application', async t => {
  const f = await fixture(t)
  f.respond = () => ({ status: 404, body: { error: { code: 'TRANSITION_NOT_FOUND' } } })
  assert.equal(await f.client.getAssignmentTransition(operation), null)
  const request = f.requests[0]
  assert.equal(request.method, 'GET')
  const params = new URL(request.path, 'http://local.invalid').searchParams
  assert.equal(params.get('assignmentId'), '12')
  assert.equal(params.get('toStatus'), 'ACCEPTED')
  for (const code of ['BOOKING_NOT_FOUND', 'route-not-found']) {
    f.respond = () => ({ status: 404, body: { error: { code } } })
    await reject(f.client.getAssignmentTransition(operation), 502, 'ORDER_BAD_RESPONSE')
  }
})

test('Order HTTP client: idempotent retry uses identical body/key and original canonical acknowledgement', async t => {
  const f = await fixture(t)
  const journal = new Map()
  let effects = 0
  f.respond = request => {
    if (!journal.has(request.path)) { journal.set(request.path, { payload: JSON.stringify(request.body), ack: acknowledged() }); effects++ }
    const saved = journal.get(request.path)
    assert.equal(JSON.stringify(request.body), saved.payload)
    return { body: saved.ack }
  }
  const first = await f.client.applyAssignmentTransition(operation)
  const second = await f.client.applyAssignmentTransition(operation)
  assert.deepEqual(second, first)
  assert.equal(effects, 1)
  assert.equal(f.requests[0].headers['idempotency-key'], f.requests[1].headers['idempotency-key'])
})

test('Order HTTP client: existing journal lookup checks all payload fields and preserves original acknowledgement', async t => {
  const f = await fixture(t)
  f.respond = () => ({ body: { ...acknowledged(), upstreamPrivateField: 'must-not-forward' } })
  assert.deepEqual(await f.client.getAssignmentTransition(operation), acknowledged())
  const request = f.requests[0]
  assert.equal(request.method, 'GET')
  assert.equal(request.headers['x-actor-user-id'], operation.actorUserId)
  assert.deepEqual(Object.fromEntries(new URL(request.path, 'http://local.invalid').searchParams), {
    assignmentId: '12', employeeId: '9', actorUserId: '7', fromStatus: 'ASSIGNED', toStatus: 'ACCEPTED',
  })
  f.respond = () => ({ status: 409, body: { error: { code: 'IDEMPOTENCY_CONFLICT' } } })
  await reject(f.client.getAssignmentTransition({ ...operation, fromStatus: 'ACCEPTED', toStatus: 'IN_PROGRESS' }), 409, 'ORDER_REJECTED')
})

test('Order HTTP client: journal acknowledgement and pending recovery validate identity and step', async t => {
  const f = await fixture(t)
  f.respond = () => ({ body: { operationId: operation.id, bookingId: '80', assignmentId: '12', acknowledged: true } })
  assert.equal((await f.client.ackAssignmentTransition(operation)).acknowledged, true)
  assert.equal(f.requests[0].path.endsWith('/acknowledgement'), true)
  assert.equal(f.requests[0].method, 'POST')
  f.respond = () => ({ body: { acknowledged: true, operationId: 'wrong', bookingId: '80', assignmentId: '12' } })
  await reject(f.client.ackAssignmentTransition(operation), 502, 'ORDER_BAD_RESPONSE')
  f.respond = () => ({ body: { operations: [operation] } })
  assert.deepEqual(await f.client.listPendingTransitions({ limit: 2 }), [operation])
  assert.equal(f.requests.at(-1).path, '/internal/v1/assignment-transitions/pending?limit=2')
  for (const operations of [[operation, operation], [{ ...operation, fromStatus: 'WAITING' }], [null]]) {
    f.respond = () => ({ body: { operations } })
    await reject(f.client.listPendingTransitions({ limit: 2 }), 502, 'ORDER_BAD_RESPONSE')
  }
})

test('Order HTTP client: journal acknowledgement must be final, true and for exactly the expected identities', async t => {
  const f = await fixture(t)
  const success = { operationId: operation.id, bookingId: '80', assignmentId: '12', acknowledged: true }
  for (const body of [null, {}, { ...success, acknowledged: false }, { ...success, acknowledged: 'true' },
    { ...success, assignmentId: '13' }, { ...success, bookingId: '81' }, { ...success, assignmentId: '12junk' }]) {
    f.respond = () => ({ body })
    await reject(f.client.ackAssignmentTransition(operation), 502, 'ORDER_BAD_RESPONSE')
  }
  f.respond = () => ({ status: 202, body: success })
  await reject(f.client.ackAssignmentTransition(operation), 502, 'ORDER_BAD_RESPONSE')
})

test('Order HTTP client: pending limits reject oversized or malformed batches without inventing work', async t => {
  const f = await fixture(t)
  for (const limit of [0, 101, -1, 1.5, '20']) await assert.rejects(f.client.listPendingTransitions({ limit }), TypeError)
  assert.equal(f.requests.length, 0)
  for (const body of [null, {}, { operations: null }, { operations: [operation, { ...operation, id: 'other-operation' }] }]) {
    f.respond = () => ({ body })
    await reject(f.client.listPendingTransitions({ limit: 1 }), 502, 'ORDER_BAD_RESPONSE')
  }
  f.respond = () => ({ body: { operations: [] } })
  assert.deepEqual(await f.client.listPendingTransitions({ limit: 1 }), [])
})

test('Order HTTP client: known business rejection is safe, unknown upstream messages are never relayed', async t => {
  const f = await fixture(t)
  for (const status of [409, 422]) {
    f.respond = () => ({ status, body: { error: { code: 'CANCELLATION_PENDING', message: f.token } } })
    await assert.rejects(f.client.applyAssignmentTransition(operation), error => error.status === 409 && error.code === 'ORDER_REJECTED'
      && !error.message.includes(f.token) && error.details.reason === 'CANCELLATION_PENDING')
  }
  f.respond = () => ({ status: 409, body: { error: { code: 'UNRECOGNIZED_FAILURE', message: f.token } } })
  await reject(f.client.applyAssignmentTransition(operation), 502, 'ORDER_BAD_RESPONSE')
  for (const status of [401, 403, 404]) {
    f.respond = () => ({ status, body: { message: f.token } })
    await reject(f.client.applyAssignmentTransition(operation), 502, 'ORDER_BAD_RESPONSE')
  }
  for (const status of [429, 500, 503]) {
    f.respond = () => ({ status, raw: 'not-json' })
    await reject(f.client.applyAssignmentTransition(operation), 503, 'ORDER_UNAVAILABLE')
  }
})

test('Order HTTP client: malformed/null/oversized JSON and non-final success cannot become a successful write', async t => {
  const f = await fixture(t)
  for (const result of [{ raw: '{broken' }, { body: null }, { body: acknowledged(), status: 202 },
    { raw: JSON.stringify(acknowledged()), type: 'text/html' }, { raw: ' '.repeat(1024 * 1024 + 1) }]) {
    f.respond = () => result
    await reject(f.client.applyAssignmentTransition(operation), 502, 'ORDER_BAD_RESPONSE')
  }
})

test('Order HTTP client: timeouts and disconnected networks remain bounded and cannot acknowledge a transition', async t => {
  const f = await fixture(t)
  const shortClient = new OrderClient({ ...f.config, timeoutMs: 25 })
  f.respond = () => ({ body: acknowledged(), delay: 100 })
  const began = Date.now()
  await reject(shortClient.applyAssignmentTransition(operation), 503, 'ORDER_UNAVAILABLE')
  assert.ok(Date.now() - began < 2000)
  f.respond = () => ({ disconnect: true })
  await reject(f.client.applyAssignmentTransition(operation), 503, 'ORDER_UNAVAILABLE')
})

test('Order HTTP client: redirects are not followed and a stalled response body also times out', async t => {
  const f = await fixture(t)
  f.respond = () => ({ status: 302, headers: { Location: f.config.baseUrl + '/must-not-follow' }, body: {} })
  await reject(f.client.applyAssignmentTransition(operation), 503, 'ORDER_UNAVAILABLE')
  assert.equal(f.requests.length, 1)
  const shortClient = new OrderClient({ ...f.config, timeoutMs: 25 })
  f.respond = () => ({ prefix: '{', streamDelay: 100, raw: JSON.stringify(acknowledged()).slice(1) })
  const began = Date.now()
  await reject(shortClient.applyAssignmentTransition(operation), 503, 'ORDER_UNAVAILABLE')
  assert.ok(Date.now() - began < 2000)
})
