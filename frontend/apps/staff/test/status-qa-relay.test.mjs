import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer, request } from 'node:http'
import { createFaultRelay } from '../scripts/uc12-qa/relay.mjs'

// Isolated transport tests only; upstream is an explicit test double, not Auth,
// Staff, Order or MySQL. No credential or production service is contacted.
const bookingId = '101', assignmentId = '201', operationId = 'a'.repeat(64)
const transition = '/internal/v1/bookings/' + bookingId + '/assignment-transitions/' + operationId
const payload = { assignmentId, employeeId: '301', actorUserId: '401', fromStatus: 'ASSIGNED', toStatus: 'ACCEPTED' }
const lookup = transition + '?' + new URLSearchParams(payload)
function ack() { return { operationId, bookingId, assignmentId, assignmentStatus: 'ACCEPTED', occurredAt: '2026-10-24T00:00:00.000Z', booking: { id: bookingId, status: 'CONFIRMED', cancellationPending: null } } }
async function fixture(t, name = 'order', responder) {
  const seen = []
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk)
    seen.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() })
    const result = await (responder ? responder(seen.at(-1)) : { status: 200, body: req.method === 'POST' ? { operationId, bookingId, assignmentId, acknowledged: true } : ack() })
    if (result === null) return
    res.writeHead(result.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(result.body))
  })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  const relay = await createFaultRelay({ target: 'http://127.0.0.1:' + server.address().port, name, bookingIds: [bookingId], assignmentIds: [assignmentId], timeoutMs: 200 })
  t.after(async () => { await relay.close(); await new Promise(done => server.close(done)) })
  return { relay, seen }
}
function call(base, path = lookup, { method = 'GET', body, headers = {} } = {}) {
  return new Promise((done, reject) => {
    const value = body === undefined ? null : JSON.stringify(body)
    const req = request(base + path, { method, headers: { ...(value ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(value) } : {}), ...headers } }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.once('error', reject)
      res.once('end', () => { const raw = Buffer.concat(chunks).toString(); done({ status: res.statusCode, body: JSON.parse(raw), headers: res.headers }) })
    }); req.once('error', () => reject(new Error('EXPECTED_CONNECTION_CLOSED'))); req.end(value)
  })
}

test('QA relay forwards the fixed Order route and real reply without leaking header/body credentials to events', async t => {
  const { relay, seen } = await fixture(t)
  const result = await call(relay.origin, lookup, { headers: { Authorization: 'Bearer unit-secret-not-real', Cookie: 'session=unit-private', 'X-Actor-User-Id': payload.actorUserId } })
  assert.equal(result.status, 200); assert.deepEqual(result.body, ack()); assert.equal(seen[0].headers.authorization, 'Bearer unit-secret-not-real')
  assert.equal(seen[0].headers.cookie, undefined); assert.equal(seen[0].headers['x-actor-user-id'], payload.actorUserId)
  assert.equal(seen[0].url, lookup); assert.equal(JSON.stringify(relay.events()).includes('unit-secret'), false)
  assert.equal(JSON.stringify(relay.events()).includes('unit-private'), false)
})
test('QA relay cannot turn an upstream authentication failure into success', async t => {
  const { relay } = await fixture(t, 'order', () => ({ status: 401, body: { error: { code: 'UNAUTHORIZED', message: 'Rejected by the upstream test double' } } }))
  assert.equal((await call(relay.origin)).status, 401)
})
test('QA relay refuses unknown booking/assignment, global pending queue and arbitrary paths before forwarding', async t => {
  const { relay, seen } = await fixture(t)
  for (const path of [lookup.replace('/101/', '/999/'), transition + '?' + new URLSearchParams({ ...payload, assignmentId: '999' }), '/internal/v1/assignment-transitions/pending?limit=20', '/api/auth/login', '//attacker.invalid/anything']) {
    assert.equal((await call(relay.origin, path)).status, 403)
  }
  assert.equal(seen.length, 0)
})
test('offlineBeforeForward blocks only the selected fixture until explicit clear and forwards nothing', async t => {
  const { relay, seen } = await fixture(t)
  relay.arm({ kind: 'offlineBeforeForward', bookingId, count: 'untilClear' })
  await assert.rejects(call(relay.origin), /EXPECTED_CONNECTION_CLOSED/)
  await assert.rejects(call(relay.origin), /EXPECTED_CONNECTION_CLOSED/)
  assert.equal(seen.length, 0); assert.equal(relay.events().filter(e => e.event === 'fault-before-forward').length, 2)
  relay.clear(); assert.equal((await call(relay.origin)).status, 200); assert.equal(seen.length, 1)
})
test('dropPutResponseAfterCommit waits for the actual successful ACK and consumes exactly one response', async t => {
  const { relay, seen } = await fixture(t)
  relay.arm({ kind: 'dropPutResponseAfterCommit', bookingId, targetStatus: 'ACCEPTED' })
  await assert.rejects(call(relay.origin, transition, { method: 'PUT', body: payload }), /EXPECTED_CONNECTION_CLOSED/)
  assert.equal(seen.length, 1); assert.equal(relay.events().filter(e => e.event === 'fault-after-committed-response').length, 1)
  assert.deepEqual((await call(relay.origin, transition, { method: 'PUT', body: payload })).body, ack())
})
test('dropAckBeforeForward does not send the acknowledgement to the upstream', async t => {
  const { relay, seen } = await fixture(t)
  relay.arm({ kind: 'dropAckBeforeForward', bookingId })
  await assert.rejects(call(relay.origin, transition + '/acknowledgement', { method: 'POST', body: payload }), /EXPECTED_CONNECTION_CLOSED/)
  assert.equal(seen.length, 0)
  assert.equal((await call(relay.origin, transition + '/acknowledgement', { method: 'POST', body: payload })).body.acknowledged, true)
})
test('dropAckResponseAfterCommit sends ACK but discards its actual committed response', async t => {
  const { relay, seen } = await fixture(t)
  relay.arm({ kind: 'dropAckResponseAfterCommit', operationId })
  await assert.rejects(call(relay.origin, transition + '/acknowledgement', { method: 'POST', body: payload }), /EXPECTED_CONNECTION_CLOSED/)
  assert.equal(seen.length, 1)
  assert.equal(relay.events().filter(e => e.event === 'fault-after-committed-response').length, 1)
})
test('a non-success or malformed response is forwarded honestly and does not consume an after-commit fault', async t => {
  let count = 0
  const { relay } = await fixture(t, 'order', () => (++count === 1 ? { status: 503, body: { error: { code: 'ORDER_UNAVAILABLE' } } } : count === 2 ? { status: 200, body: { wrong: 'shape' } } : { status: 200, body: ack() }))
  relay.arm({ kind: 'dropPutResponseAfterCommit', bookingId })
  assert.equal((await call(relay.origin, transition, { method: 'PUT', body: payload })).status, 503)
  assert.deepEqual((await call(relay.origin, transition, { method: 'PUT', body: payload })).body, { wrong: 'shape' })
  await assert.rejects(call(relay.origin, transition, { method: 'PUT', body: payload }), /EXPECTED_CONNECTION_CLOSED/)
})
test('Staff relay permits fixed list/schedule GETs but scopes every status PATCH to manifest assignment IDs', async t => {
  const { relay, seen } = await fixture(t, 'staff', () => ({ status: 200, body: { data: [] } }))
  for (const path of ['/api/v1/staff/me/jobs?page=2&sort=desc', '/api/v1/staff/me/schedule?from=2026-10-24&to=2026-10-25', '/api/v1/staff/me/jobs/' + assignmentId]) {
    assert.equal((await call(relay.origin, path)).status, 200)
  }
  assert.equal((await call(relay.origin, '/api/v1/staff/me/jobs/999/status', { method: 'PATCH', body: { status: 'ACCEPTED' } })).status, 403)
  assert.equal(seen.length, 3)
})
test('Staff after-commit fault drops actual 200/202 without forwarding a fake success', async t => {
  const { relay, seen } = await fixture(t, 'staff', () => ({ status: 202, body: { data: { assignmentId, transition: { requestedStatus: 'ACCEPTED', synchronization: 'PENDING_ACKNOWLEDGEMENT' } } } }))
  relay.arm({ kind: 'dropStaffResponseAfterCommit', assignmentId, targetStatus: 'ACCEPTED' })
  await assert.rejects(call(relay.origin, '/api/v1/staff/me/jobs/' + assignmentId + '/status', { method: 'PATCH', body: { status: 'ACCEPTED' } }), /EXPECTED_CONNECTION_CLOSED/)
  assert.equal(seen.length, 1); assert.equal(relay.events().find(e => e.event === 'fault-after-committed-response').status, 202)
})
test('fault filters do not consume a different operation or status', async t => {
  const { relay, seen } = await fixture(t)
  relay.arm({ kind: 'dropPutResponseAfterCommit', bookingId, targetStatus: 'IN_PROGRESS' })
  assert.equal((await call(relay.origin, transition, { method: 'PUT', body: payload })).status, 200)
  assert.equal(seen.length, 1); assert.equal(relay.events().filter(e => e.event === 'fault-after-committed-response').length, 0)
})
test('upstream timeout is finite and closes the connection without claiming a result', async t => {
  const { relay } = await fixture(t, 'order', () => null)
  const start = Date.now(); await assert.rejects(call(relay.origin), /EXPECTED_CONNECTION_CLOSED/)
  assert.ok(Date.now() - start < 1000)
  assert.equal(relay.events().at(-1).event, 'connection-failed')
})
test('configuration and fault arming reject public URLs, arbitrary IDs and unsafe global controls', async t => {
  const config = { target: 'http://127.0.0.1:4403', name: 'order', bookingIds: [bookingId], assignmentIds: [assignmentId] }
  for (const patch of [{ target: 'http://attacker.invalid' }, { target: 'http://user:pass@localhost:4403' }, { target: 'http://localhost:4403/path' }, { bookingIds: [] }, { assignmentIds: ['01'] }, { port: -1 }]) {
    await assert.rejects(createFaultRelay({ ...config, ...patch }), /QA_RELAY_CONFIGURATION_INVALID/)
  }
  const { relay } = await fixture(t)
  for (const options of [{ kind: 'offlineBeforeForward' }, { kind: 'offlineBeforeForward', bookingId: '999' }, { kind: 'unknown', bookingId }, { kind: 'dropStaffResponseAfterCommit', assignmentId }, { kind: 'offlineBeforeForward', bookingId, url: 'http://attacker.invalid' }, { kind: 'offlineBeforeForward', bookingId, count: 0 }]) assert.throws(() => relay.arm(options), /QA_RELAY_CONFIGURATION_INVALID/)
})
