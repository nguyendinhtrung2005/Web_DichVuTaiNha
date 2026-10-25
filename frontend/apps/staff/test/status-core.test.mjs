import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { AuthBffError } from '../lib/server/auth-core.mjs'
import { createStatusService } from '../lib/server/status-core.mjs'
import { createStatusStore } from '../lib/server/status-store.mjs'
import { transitionOperationId } from '../lib/server/status-contract.mjs'

// Auth and Staff calls are explicit dependency doubles; the journal uses its real
// encrypted filesystem implementation in this suite's disposable temp directory.
// No JWT is forged, no live HTTP endpoint or database is contacted.
const at = '2026-10-24T00:00:00.000Z', key = 'core-operation-key-01'
const users = { A: '9109002', B: '9109101' }, ids = { A: '1001', B: '1002' }
const mapped = { ASSIGNED: ['WAITING', 'waiting'], ACCEPTED: ['ACCEPTED', 'accepted'], IN_PROGRESS: ['IN_PROGRESS', 'in_progress'], DONE: ['DONE', 'done'], CANCELLED: ['CANCELLED', null] }
function detail(id, status = 'ASSIGNED', changes = {}) {
  return { id, assignmentId: id, orderId: '5001', jobCode: null, orderCode: null, status: mapped[status][0], databaseStatus: status, jobStatus: mapped[status][1], orderStatus: 'confirmed',
    scheduledAt: at, expectedEndAt: '2026-10-24T01:30:00.000Z', durationMinutes: 90,
    contact: { name: 'Test customer', address: 'Test address', phone: 'TEST-CONTACT', houseType: null, area: null, rooms: null, floors: null, hasPets: null },
    services: [{ serviceId: '5', name: 'Test service', unit: 'giờ', quantity: '1.50', unitPrice: '123.45' }],
    checkInAt: null, checkOutAt: null, assignedAt: at, specialRequest: null, cancellationPending: null, orderHistory: null, historySource: 'order-service-not-loaded',
    unsupportedFields: ['jobCode', 'orderCode', 'houseType', 'area', 'rooms', 'floors', 'hasPets', 'specialRequest', 'cancellationPending'], ...changes }
}
function result(record, code = 200, changes = {}) {
  return { data: { assignmentId: record.assignmentId, status: record.requestedStatus, jobStatus: mapped[record.requestedStatus][1], checkInAt: null, checkOutAt: null,
    transition: { operationId: transitionOperationId(record), requestedStatus: record.requestedStatus, synchronization: code === 200 ? 'SYNCHRONIZED' : 'PENDING_ACKNOWLEDGEMENT', replayed: false },
    orderAtTransition: { id: record.orderId, status: 'CONFIRMED', asOf: at }, ...changes } }
}
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cleanhome-staff-status-core-unit-'))
  const config = { sessionDir: path.join(root, 'sessions'), keyFile: path.join(root, 'session.key'), staffUrl: 'http://127.0.0.1:4005', jobsTimeoutMs: 200, statusTimeoutMs: 200 }
  await writeFile(config.keyFile, randomBytes(32), { mode: 0o600 })
  t.after(async () => {
    const resolved = path.resolve(root), intended = path.resolve(os.tmpdir()) + path.sep
    assert.equal(resolved.startsWith(intended), true); assert.equal(path.basename(resolved).startsWith('cleanhome-staff-status-core-unit-'), true)
    await rm(resolved, { recursive: true, force: true })
  })
  const store = createStatusStore({ config, now: () => Date.parse(at) }), calls = []
  const controls = { details: { A: detail(ids.A), B: detail(ids.B) }, authError: null, afterCallbackError: null, getError: null, patch: null }
  const auth = {
    async inspect(sid) {
      if (controls.authError) throw controls.authError
      if (!users[sid]) throw new AuthBffError(401, 'SESSION_REQUIRED', 'Login required')
      return { user: { id: users[sid], role: 'EMPLOYEE', status: 'ACTIVE' }, expiresAt: at }
    },
    async withAccessToken(sid, callback) {
      if (controls.authError) throw controls.authError
      if (!users[sid]) throw new AuthBffError(401, 'SESSION_REQUIRED', 'Login required')
      const value = await callback('dependency-double-' + sid)
      if (controls.afterCallbackError) throw controls.afterCallbackError
      return value
    },
  }
  const fetchImpl = async (url, init) => {
    const actor = init.headers.Authorization.slice(-1), id = new URL(url).pathname.split('/')[6]
    calls.push({ url: String(url), init, actor, id })
    if (id !== ids[actor]) return Response.json({ error: { code: 'JOB_NOT_FOUND', message: 'hidden' } }, { status: 404 })
    if (init.method === 'GET') {
      if (controls.getError) return controls.getError()
      return Response.json({ data: controls.details[actor] })
    }
    assert.equal(init.method, 'PATCH')
    const target = JSON.parse(init.body).status
    const entry = (await store.list(users[actor], id)).find(item => item.record.requestedStatus === target)
    assert.ok(entry, 'context is already durable before the HTTP double receives PATCH')
    assert.equal(entry.record.idempotencyKey, init.headers['Idempotency-Key'])
    if (controls.patch) return controls.patch(entry.record, actor, init)
    controls.details[actor] = detail(id, target)
    return Response.json(result(entry.record))
  }
  const create = (overrides = {}) => createStatusService({ config, auth, store, fetchImpl, ...overrides })
  return { config, controls, calls, store, auth, fetchImpl, create, service: create(),
    patches: () => calls.filter(call => call.init.method === 'PATCH') }
}
const errorCode = (code, outcome) => error => error instanceof AuthBffError && error.code === code && (outcome === undefined || error.outcome === outcome)

test('first legitimate transition forwards only fixed Staff PATCH and saves a confirmed receipt before returning', async t => {
  const f = await fixture(t), response = await f.service.update('A', ids.A, 'ACCEPTED', key)
  assert.equal(response.status, 200); assert.equal(response.body.operation.phase, 'confirmed')
  assert.equal(response.body.data.status, 'ACCEPTED'); assert.equal(f.patches().length, 1)
  const call = f.patches()[0]
  assert.equal(call.url, 'http://127.0.0.1:4005/api/v1/staff/me/jobs/1001/status')
  assert.deepEqual(JSON.parse(call.init.body), { status: 'ACCEPTED' }); assert.equal(call.init.headers['Idempotency-Key'], key)
  assert.equal(call.init.redirect, 'error'); assert.equal(call.init.cache, 'no-store'); assert.ok(call.init.signal instanceof AbortSignal)
  assert.equal((await f.store.list(users.A, ids.A))[0].receipt.httpStatus, 200)
  assert.equal(JSON.stringify(response).includes('dependency-double-'), false)
})

test('read only authorizes, fetches current projection and never dispatches a PATCH', async t => {
  const f = await fixture(t), view = await f.service.read('A', ids.A)
  assert.equal(view.allowedStatus, 'ACCEPTED'); assert.equal(view.operation, null); assert.equal(f.patches().length, 0)
  assert.deepEqual(await f.store.list(users.A, ids.A), [])
})

test('a saved confirmed operation survives service reconstruction and a repeated same-key request does not dispatch twice', async t => {
  const f = await fixture(t)
  await f.service.update('A', ids.A, 'ACCEPTED', key)
  const restarted = f.create({ store: createStatusStore({ config: f.config }) })
  assert.equal((await restarted.read('A', ids.A)).operation.phase, 'confirmed')
  const replay = await restarted.update('A', ids.A, 'ACCEPTED', key)
  assert.equal(replay.status, 200); assert.equal(f.patches().length, 1)
  assert.equal((await restarted.read('A', ids.A)).allowedStatus, 'IN_PROGRESS')
})

test('202 remains pending through reload and blocks a new key or next step until explicit same-key retry confirms it', async t => {
  const f = await fixture(t)
  f.controls.patch = record => { f.controls.details.A = detail(ids.A, 'ACCEPTED'); return Response.json(result(record, 202), { status: 202 }) }
  const response = await f.service.update('A', ids.A, 'ACCEPTED', key)
  assert.equal(response.status, 202); assert.equal(response.body.operation.phase, 'pending')
  const view = await f.create().read('A', ids.A)
  assert.equal(view.operation.phase, 'pending'); assert.equal(view.canRetry, true); assert.equal(view.allowedStatus, null)
  await assert.rejects(f.service.update('A', ids.A, 'ACCEPTED', 'new-key-not-allowed'), errorCode('OPERATION_EXISTS', 'not_sent'))
  await assert.rejects(f.service.update('A', ids.A, 'IN_PROGRESS', 'next-step-not-allowed'), errorCode('TRANSITION_BLOCKED', 'not_sent'))
  assert.equal(f.patches().length, 1)
  f.controls.patch = record => { const body = result(record); body.data.transition.replayed = true; return Response.json(body) }
  const retry = await f.create().update('A', ids.A, 'ACCEPTED', key)
  assert.equal(retry.status, 200); assert.equal(retry.body.operation.phase, 'confirmed'); assert.equal(f.patches()[1].init.headers['Idempotency-Key'], key)
})

test('timeout after a possible remote commit preserves unknown context; current projection is not proof and retry reuses key', async t => {
  const f = await fixture(t); f.config.statusTimeoutMs = 15
  const timed = f.create({ fetchImpl: async (url, init) => {
    if (init.method === 'GET') return Response.json({ data: f.controls.details.A })
    // Do not place filesystem work inside the timeout double: receipt-store
    // latency is unrelated to the simulated lost network response.
    f.calls.push({ url: String(url), init, actor: 'A', id: ids.A })
    f.controls.details.A = detail(ids.A, 'ACCEPTED')
    return new Promise(() => {})
  } })
  await assert.rejects(timed.update('A', ids.A, 'ACCEPTED', key), error => errorCode('STAFF_UNAVAILABLE', 'unknown')(error) && error.operation.idempotencyKey === key)
  const view = await f.create().read('A', ids.A)
  assert.equal(view.operation.phase, 'unknown'); assert.equal(view.operation.observedTarget, true); assert.equal(view.allowedStatus, null)
  f.config.statusTimeoutMs = 200
  f.controls.patch = record => Response.json(result(record))
  assert.equal((await f.create().update('A', ids.A, 'ACCEPTED', key)).status, 200)
  assert.deepEqual(f.patches().map(call => call.init.headers['Idempotency-Key']), [key, key])
})

test('a lost or malformed success response remains unknown and never fabricates confirmation', async t => {
  for (const mode of ['lost', 'malformed', 'wrong-operation']) {
    const f = await fixture(t)
    f.controls.patch = record => {
      if (mode === 'lost') throw new Error('network disconnected')
      if (mode === 'malformed') return new Response('{not-json', { headers: { 'Content-Type': 'application/json' } })
      const body = result(record); body.data.transition.operationId = 'f'.repeat(64); return Response.json(body)
    }
    await assert.rejects(f.service.update('A', ids.A, 'ACCEPTED', key), error => error.outcome === 'unknown' && error.operation.phase === 'unknown')
    assert.equal((await f.create().read('A', ids.A)).operation.phase, 'unknown')
    assert.equal((await f.store.list(users.A, ids.A))[0].receipt, null)
  }
})

test('a journal error before context persistence prevents outgoing PATCH and reports not_sent', async t => {
  const f = await fixture(t)
  const store = { ...f.store, ensure: async () => { throw new AuthBffError(503, 'OPERATION_STORE_UNAVAILABLE', 'unavailable') } }
  await assert.rejects(f.create({ store }).update('A', ids.A, 'ACCEPTED', key), errorCode('OPERATION_STORE_UNAVAILABLE', 'not_sent'))
  assert.equal(f.patches().length, 0)
})

test('receipt storage failure after Backend success remains unknown with the original recovery key', async t => {
  const f = await fixture(t)
  const store = { ...f.store, saveReceipt: async () => { throw new AuthBffError(503, 'OPERATION_STORE_UNAVAILABLE', 'unavailable') } }
  await assert.rejects(f.create({ store }).update('A', ids.A, 'ACCEPTED', key), error => errorCode('OPERATION_STORE_UNAVAILABLE', 'unknown')(error) && error.operation.idempotencyKey === key)
  assert.equal(f.patches().length, 1)
  assert.equal((await f.service.read('A', ids.A)).operation.phase, 'unknown')
})

test('post-callback session invalidation rejects the response while retaining durable confirmation for relogin', async t => {
  const f = await fixture(t)
  f.controls.afterCallbackError = new AuthBffError(401, 'SESSION_EXPIRED', 'expired')
  await assert.rejects(f.service.update('A', ids.A, 'ACCEPTED', key), errorCode('SESSION_EXPIRED', 'unknown'))
  assert.equal((await f.store.list(users.A, ids.A))[0].receipt.httpStatus, 200)
  f.controls.afterCallbackError = null
  assert.equal((await f.create().read('A', ids.A)).operation.phase, 'confirmed')
  assert.equal((await f.create().update('A', ids.A, 'ACCEPTED', key)).status, 200)
  assert.equal(f.patches().length, 1)
})

test('missing sessions and role/account authorization failures never reach Staff or journal dispatch', async t => {
  const f = await fixture(t)
  await assert.rejects(f.service.update('missing', ids.A, 'ACCEPTED', key), errorCode('SESSION_REQUIRED', 'not_sent'))
  for (const code of ['ROLE_MISMATCH', 'ACCOUNT_LOCKED']) {
    f.controls.authError = new AuthBffError(403, code, 'denied')
    await assert.rejects(f.service.update('A', ids.A, 'ACCEPTED', key), errorCode(code, 'not_sent'))
  }
  assert.equal(f.calls.length, 0)
})

test('ownership preflight denies cross-employee reads and writes with the same 404 without creating an operation', async t => {
  const f = await fixture(t)
  for (const [actor, foreign] of [['A', ids.B], ['B', ids.A]]) {
    await assert.rejects(f.service.read(actor, foreign), errorCode('JOB_NOT_FOUND'))
    await assert.rejects(f.service.update(actor, foreign, 'ACCEPTED', key), errorCode('JOB_NOT_FOUND', 'not_sent'))
    assert.deepEqual(await f.store.list(users[actor], foreign), [])
  }
  assert.equal(f.patches().length, 0)
})

test('actors sharing one booking retain separate assignment operations and backend booking snapshots', async t => {
  const f = await fixture(t)
  f.controls.details.A = detail(ids.A, 'IN_PROGRESS', { orderStatus: 'in_progress', checkInAt: at })
  f.controls.details.B = detail(ids.B, 'IN_PROGRESS', { orderStatus: 'in_progress', checkInAt: at })
  f.controls.patch = (record, actor) => {
    f.controls.details[actor] = detail(ids[actor], 'DONE', { orderStatus: actor === 'A' ? 'in_progress' : 'completed', checkInAt: at, checkOutAt: at })
    const body = result(record, 200, { checkInAt: at, checkOutAt: at })
    body.data.orderAtTransition.status = actor === 'A' ? 'IN_PROGRESS' : 'COMPLETED'
    return Response.json(body)
  }
  const a = await f.service.update('A', ids.A, 'DONE', 'employee-a-done-key')
  assert.equal(a.body.data.orderAtTransition.status, 'IN_PROGRESS')
  const b = await f.service.update('B', ids.B, 'DONE', 'employee-b-done-key')
  assert.equal(b.body.data.orderAtTransition.status, 'COMPLETED')
  assert.notEqual(a.body.data.transition.operationId, b.body.data.transition.operationId)
  assert.equal((await f.service.read('A', ids.A)).operation.idempotencyKey, 'employee-a-done-key')
  assert.equal((await f.service.read('B', ids.B)).operation.idempotencyKey, 'employee-b-done-key')
  assert.equal(f.calls.some(call => call.url.includes('/internal/')), false)
})

test('the same key cannot be repurposed for a different transition', async t => {
  const f = await fixture(t)
  await f.service.update('A', ids.A, 'ACCEPTED', key)
  await assert.rejects(f.service.update('A', ids.A, 'IN_PROGRESS', key), errorCode('IDEMPOTENCY_CONFLICT', 'not_sent'))
  assert.equal(f.patches().length, 1)
})

test('a distinct key for an already confirmed step is refused; legitimate next step has its own key', async t => {
  const f = await fixture(t)
  await f.service.update('A', ids.A, 'ACCEPTED', key)
  await assert.rejects(f.service.update('A', ids.A, 'ACCEPTED', 'different-accepted-key'), errorCode('OPERATION_EXISTS', 'not_sent'))
  const next = await f.service.update('A', ids.A, 'IN_PROGRESS', 'different-progress-key')
  assert.equal(next.status, 200); assert.equal((await f.store.list(users.A, ids.A)).length, 2)
})

test('generation or order changes block stored operations instead of replacing their key', async t => {
  for (const changes of [{ orderId: '5002' }, { assignedAt: '2026-10-25T00:00:00.000Z' }]) {
    const f = await fixture(t)
    f.controls.patch = record => Response.json(result(record, 202), { status: 202 })
    await f.service.update('A', ids.A, 'ACCEPTED', key)
    f.controls.details.A = detail(ids.A, 'ACCEPTED', changes)
    await assert.rejects(f.service.update('A', ids.A, 'ACCEPTED', key), errorCode('ASSIGNMENT_CHANGED', 'not_sent'))
    const view = await f.service.read('A', ids.A)
    assert.equal(view.blockedReason, 'ASSIGNMENT_CHANGED'); assert.equal(view.canRetry, false); assert.equal(f.patches().length, 1)
  }
})

test('regression of a confirmed assignment cannot start a new cycle silently', async t => {
  const f = await fixture(t)
  await f.service.update('A', ids.A, 'ACCEPTED', key)
  f.controls.details.A = detail(ids.A, 'ASSIGNED')
  await assert.rejects(f.service.update('A', ids.A, 'ACCEPTED', key), errorCode('ASSIGNMENT_CHANGED', 'not_sent'))
  assert.equal((await f.service.read('A', ids.A)).blockedReason, 'ASSIGNMENT_CHANGED')
  assert.equal(f.patches().length, 1)
})

test('pending acknowledgement can be retried after the booking completed without inferring success from that projection', async t => {
  const f = await fixture(t)
  f.controls.details.A = detail(ids.A, 'IN_PROGRESS', { orderStatus: 'in_progress', checkInAt: at })
  f.controls.patch = record => { f.controls.details.A = detail(ids.A, 'DONE', { orderStatus: 'completed', checkInAt: at, checkOutAt: at }); return Response.json(result(record, 202, { checkInAt: at, checkOutAt: at }), { status: 202 }) }
  await f.service.update('A', ids.A, 'DONE', key)
  const view = await f.service.read('A', ids.A)
  assert.equal(view.operation.phase, 'pending'); assert.equal(view.canRetry, true)
  f.controls.patch = record => Response.json(result(record, 200, { checkInAt: at, checkOutAt: at }))
  assert.equal((await f.service.update('A', ids.A, 'DONE', key)).status, 200)
  assert.deepEqual(f.patches().map(call => call.init.headers['Idempotency-Key']), [key, key])
})

test('backend errors preserve operation context and expose only allowlisted error codes/messages', async t => {
  for (const [status, code, expected] of [[503, 'ORDER_UNAVAILABLE', 'ORDER_UNAVAILABLE'], [503, 'RECONCILIATION_REQUIRED', 'RECONCILIATION_REQUIRED'], [409, 'INVALID_TRANSITION', 'INVALID_TRANSITION'], [502, 'ORDER_BAD_RESPONSE', 'ORDER_BAD_RESPONSE'], [409, 'UNKNOWN_PRIVATE_CODE', 'TRANSITION_REJECTED']]) {
    const f = await fixture(t)
    f.controls.patch = () => Response.json({ error: { code, message: 'SECRET not forwarded', details: { privateToken: 'SECRET' } } }, { status })
    await assert.rejects(f.service.update('A', ids.A, 'ACCEPTED', key), error => errorCode(expected, 'unknown')(error) && !error.message.includes('SECRET') && error.operation.idempotencyKey === key)
    assert.equal((await f.service.read('A', ids.A)).operation.phase, 'unknown')
  }
})

test('preflight dependency failure never dispatches or creates a new mutation', async t => {
  const f = await fixture(t)
  f.controls.getError = () => new Response('upstream down', { status: 503 })
  await assert.rejects(f.service.update('A', ids.A, 'ACCEPTED', key), errorCode('STAFF_UNAVAILABLE', 'not_sent'))
  assert.equal(f.patches().length, 0); assert.deepEqual(await f.store.list(users.A, ids.A), [])
})

test('late 202 from a concurrent same-key request cannot downgrade a confirmed receipt', async t => {
  const f = await fixture(t)
  let release, entered
  const started = new Promise(resolve => { entered = resolve })
  const delayed = new Promise(resolve => { release = resolve })
  let count = 0
  f.controls.patch = async record => {
    count += 1
    if (count === 1) { entered(); await delayed; return Response.json(result(record, 202), { status: 202 }) }
    f.controls.details.A = detail(ids.A, 'ACCEPTED')
    return Response.json(result(record))
  }
  const waiting = f.service.update('A', ids.A, 'ACCEPTED', key)
  await started
  const confirmed = await f.create().update('A', ids.A, 'ACCEPTED', key)
  assert.equal(confirmed.status, 200)
  release()
  const late = await waiting
  assert.equal(late.status, 200); assert.equal(late.body.operation.phase, 'confirmed')
  assert.equal((await f.service.read('A', ids.A)).operation.phase, 'confirmed')
  assert.equal(f.patches().length, 2)
  assert.ok(f.patches().every(call => call.init.headers['Idempotency-Key'] === key))
})

test('two concurrent keys for a new step publish one context and only its winning key reaches Staff', async t => {
  const f = await fixture(t)
  const firstKey = 'concurrent-core-key-a', secondKey = 'concurrent-core-key-b'
  const results = await Promise.allSettled([f.service.update('A', ids.A, 'ACCEPTED', firstKey), f.create().update('A', ids.A, 'ACCEPTED', secondKey)])
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  const rejected = results.find(result => result.status === 'rejected').reason
  assert.equal(rejected.code, 'OPERATION_EXISTS'); assert.equal(rejected.outcome, 'not_sent')
  const entries = await f.store.list(users.A, ids.A)
  assert.equal(entries.length, 1); assert.equal(f.patches().length, 1)
  assert.equal(f.patches()[0].init.headers['Idempotency-Key'], entries[0].record.idempotencyKey)
})

test('new operations cannot skip steps, write final assignments or mutate inactive bookings', async t => {
  for (const [status, target, orderStatus] of [
    ['ASSIGNED', 'DONE', 'confirmed'], ['ASSIGNED', 'IN_PROGRESS', 'confirmed'],
    ['DONE', 'DONE', 'completed'], ['CANCELLED', 'ACCEPTED', 'cancelled'],
    ['ASSIGNED', 'ACCEPTED', 'pending'], ['ASSIGNED', 'ACCEPTED', 'cancelled'], ['ASSIGNED', 'ACCEPTED', null],
  ]) {
    const f = await fixture(t); f.controls.details.A = detail(ids.A, status, { orderStatus })
    await assert.rejects(f.service.update('A', ids.A, target, key), errorCode('TRANSITION_BLOCKED', 'not_sent'))
    assert.equal(f.patches().length, 0); assert.deepEqual(await f.store.list(users.A, ids.A), [])
  }
})

test('pending acknowledgement is never retried against cancelled work or a cancelled booking', async t => {
  for (const changes of [{ databaseStatus: 'CANCELLED', status: 'CANCELLED', jobStatus: null }, { orderStatus: 'cancelled' }]) {
    const f = await fixture(t)
    f.controls.patch = record => Response.json(result(record, 202), { status: 202 })
    await f.service.update('A', ids.A, 'ACCEPTED', key)
    f.controls.details.A = { ...detail(ids.A, 'ACCEPTED'), ...changes }
    await assert.rejects(f.service.update('A', ids.A, 'ACCEPTED', key), errorCode('TRANSITION_BLOCKED', 'not_sent'))
    assert.equal(f.patches().length, 1); assert.equal((await f.service.read('A', ids.A)).canRetry, false)
  }
})

test('three legitimate transitions use three distinct keys and immutable per-step receipts', async t => {
  const f = await fixture(t)
  for (const [status, actionKey] of [['ACCEPTED', 'three-steps-accept'], ['IN_PROGRESS', 'three-steps-start'], ['DONE', 'three-steps-finish']]) {
    const response = await f.service.update('A', ids.A, status, actionKey)
    assert.equal(response.status, 200); assert.equal(response.body.operation.requestedStatus, status)
  }
  const entries = await f.store.list(users.A, ids.A)
  assert.equal(entries.length, 3); assert.equal(new Set(entries.map(entry => entry.record.idempotencyKey)).size, 3)
  assert.ok(entries.every(entry => entry.receipt.httpStatus === 200))
  const view = await f.service.read('A', ids.A)
  assert.equal(view.allowedStatus, null); assert.equal(view.blockedReason, 'NO_NEXT_STATUS'); assert.equal(view.operation.requestedStatus, 'DONE')
})

test('oversized or non-JSON mutation replies are rejected with original unknown recovery context', async t => {
  for (const response of [
    () => new Response('not json', { headers: { 'Content-Type': 'text/plain' } }),
    () => new Response('{}', { headers: { 'Content-Type': 'application/json', 'Content-Length': '32769' } }),
    () => new Response('{}', { headers: { 'Content-Type': 'application/json', 'Content-Length': 'invalid' } }),
    () => new Response(JSON.stringify({ data: 'x'.repeat(33000) }), { headers: { 'Content-Type': 'application/json' } }),
    () => new Response(new Uint8Array([0xff]), { headers: { 'Content-Type': 'application/json' } }),
  ]) {
    const f = await fixture(t); f.controls.patch = response
    await assert.rejects(f.service.update('A', ids.A, 'ACCEPTED', key), error => errorCode('STAFF_INVALID_RESPONSE', 'unknown')(error) && error.operation.idempotencyKey === key)
    assert.equal((await f.store.list(users.A, ids.A))[0].receipt, null)
  }
})

test('a persisted cryptographically valid but semantically wrong receipt is never treated as confirmation', async t => {
  const f = await fixture(t)
  const { record } = await f.store.ensure({ userId: users.A, assignmentId: ids.A, orderId: '5001', assignedAt: at, requestedStatus: 'ACCEPTED', fromStatus: 'ASSIGNED', idempotencyKey: key })
  const invalidData = result(record).data; invalidData.transition.operationId = 'a'.repeat(64)
  await f.store.saveReceipt(record, 200, invalidData)
  f.controls.details.A = detail(ids.A, 'ACCEPTED')
  await assert.rejects(f.service.read('A', ids.A), errorCode('STAFF_INVALID_RESPONSE'))
  await assert.rejects(f.service.update('A', ids.A, 'ACCEPTED', key), errorCode('STAFF_INVALID_RESPONSE', 'not_sent'))
  assert.equal(f.patches().length, 0)
})

test('an upstream post-dispatch 401 or 403 never becomes a successful state change', async t => {
  for (const [status, code] of [[401, 'SESSION_EXPIRED'], [403, 'STAFF_ACCESS_DENIED']]) {
    const f = await fixture(t)
    f.controls.patch = () => Response.json({ error: { code: 'ignored-private-code' } }, { status })
    await assert.rejects(f.service.update('A', ids.A, 'ACCEPTED', key), error => errorCode(code, 'unknown')(error) && error.operation.phase === 'unknown')
    assert.equal((await f.store.list(users.A, ids.A))[0].receipt, null)
  }
})

test('a late idempotent replay can return DONE while retaining the original ACCEPTED request and snapshot', async t => {
  const f = await fixture(t)
  f.controls.patch = () => { throw new Error('lost original reply') }
  await assert.rejects(f.service.update('A', ids.A, 'ACCEPTED', key), errorCode('STAFF_UNAVAILABLE', 'unknown'))
  f.controls.details.A = detail(ids.A, 'DONE', { orderStatus: 'completed', checkInAt: at, checkOutAt: at })
  f.controls.patch = record => {
    const body = result(record, 200, { status: 'DONE', jobStatus: 'done', checkInAt: at, checkOutAt: at })
    body.data.transition.replayed = true
    return Response.json(body)
  }
  const replay = await f.service.update('A', ids.A, 'ACCEPTED', key)
  assert.equal(replay.status, 200); assert.equal(replay.body.data.status, 'DONE')
  assert.equal(replay.body.data.transition.requestedStatus, 'ACCEPTED'); assert.equal(replay.body.data.orderAtTransition.status, 'CONFIRMED')
  assert.equal(replay.body.operation.phase, 'confirmed')
})
