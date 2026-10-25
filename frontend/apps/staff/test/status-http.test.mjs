import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { createStaffStatusHttp } from '../lib/server/status-http.mjs'
import { AuthBffError } from '../lib/server/auth-core.mjs'
import { transitionOperationId } from '../lib/server/status-contract.mjs'

// These tests inject Auth, storage and Staff HTTP doubles. They are NOT evidence
// of real JWT verification, Order/MySQL mutations or multi-employee completion.
const origin = 'http://localhost:3002', assignmentId = '9223372036854775807', orderId = '9007199254740993'
const actorId = '9109002', key = 'unit-status-operation-001', serverToken = 'unit-only-server-bearer-never-returned'
const now = () => Date.parse('2026-10-24T01:00:00.000Z')
function detail() {
  return { data: {
    id: assignmentId, assignmentId, orderId, jobCode: null, orderCode: null,
    status: 'WAITING', databaseStatus: 'ASSIGNED', jobStatus: 'waiting', orderStatus: 'confirmed',
    scheduledAt: '2026-10-24T02:00:00.000Z', expectedEndAt: '2026-10-24T03:30:00.000Z', durationMinutes: 90,
    contact: { name: 'Người liên hệ kiểm thử', address: 'Địa chỉ kiểm thử', phone: 'TEST-CONTACT', houseType: null, area: null, rooms: null, floors: null, hasPets: null },
    services: [{ serviceId: '5', name: 'Dịch vụ kiểm thử', unit: 'giờ', quantity: '1.50', unitPrice: '123.45' }],
    checkInAt: null, checkOutAt: null, assignedAt: '2026-10-24T00:00:00.000Z',
    specialRequest: null, cancellationPending: null, orderHistory: null, historySource: 'order-service-not-loaded',
    unsupportedFields: ['jobCode', 'orderCode', 'houseType', 'area', 'rooms', 'floors', 'hasPets', 'specialRequest', 'cancellationPending'],
  } }
}
function fixture() {
  const sessionId = randomBytes(32).toString('base64url')
  const config = { appOrigin: origin, cookieName: 'cleanhome_staff_session', secureCookie: false,
    staffUrl: 'http://127.0.0.1:4005', jobsTimeoutMs: 100, statusTimeoutMs: 100 }
  const calls = [], entries = []
  const controls = { authError: null, postAuthError: null, logoutError: null, readError: null, receiptError: null,
    current: detail(), upstream: null, httpStatus: 200 }
  function validate(value) {
    if (controls.authError) throw controls.authError
    if (value !== sessionId) throw new AuthBffError(401, 'SESSION_REQUIRED', 'Vui lòng đăng nhập.')
  }
  const auth = {
    async inspect(value) { calls.push({ kind: 'inspect', sid: value }); validate(value); return { user: { id: actorId, role: 'EMPLOYEE', status: 'ACTIVE' }, expiresAt: now() + 3600000 } },
    async withAccessToken(value, callback) {
      calls.push({ kind: 'authorize', sid: value }); validate(value)
      const result = await callback(serverToken)
      if (controls.postAuthError) throw controls.postAuthError
      return result
    },
    async logout(value) { calls.push({ kind: 'logout', sid: value }); if (controls.logoutError) throw controls.logoutError },
  }
  const store = {
    async list(userId, id) { calls.push({ kind: 'list', userId, id }); if (controls.readError) throw controls.readError; return structuredClone(entries) },
    async ensure(input) {
      calls.push({ kind: 'ensure', input })
      const existing = entries.find(entry => entry.record.requestedStatus === input.requestedStatus)
      if (existing) return { record: structuredClone(existing.record), created: false }
      const record = { version: 1, ...input, createdAt: now() }
      entries.push({ record, receipt: null }); return { record: structuredClone(record), created: true }
    },
    async saveReceipt(record, httpStatus, data) {
      calls.push({ kind: 'receipt', httpStatus })
      if (controls.receiptError) throw controls.receiptError
      const entry = entries.find(value => value.record.idempotencyKey === record.idempotencyKey)
      if (entry.receipt?.httpStatus !== 200) entry.receipt = { httpStatus, data: structuredClone(data) }
    },
  }
  const fetchImpl = async (url, init) => {
    const call = { kind: 'fetch', url: new URL(url), init }; calls.push(call)
    if (controls.upstream) return controls.upstream(url, init)
    if (init.method === 'GET') return Response.json(controls.current)
    const entry = entries.find(value => value.record.idempotencyKey === new Headers(init.headers).get('idempotency-key'))
    const target = JSON.parse(init.body).status
    return Response.json({ data: { assignmentId, status: target, jobStatus: { ACCEPTED: 'accepted', IN_PROGRESS: 'in_progress', DONE: 'done' }[target],
      checkInAt: null, checkOutAt: null,
      transition: { operationId: transitionOperationId(entry.record), requestedStatus: target,
        synchronization: controls.httpStatus === 200 ? 'SYNCHRONIZED' : 'PENDING_ACKNOWLEDGEMENT', replayed: false },
      orderAtTransition: { id: orderId, status: 'CONFIRMED', asOf: '2026-10-24T01:00:00.000Z' },
      accessToken: serverToken, internalToken: 'unit-upstream-secret-not-for-browser' }, rawSecret: 'unit-private-data' }, { status: controls.httpStatus })
  }
  const handle = createStaffStatusHttp({ configFactory: () => config, authFactory: () => auth, storeFactory: () => store, fetchImpl, now })
  async function request(input = {}) {
    const method = input.method || 'GET'
    const headers = { Cookie: 'cleanhome_staff_session=' + sessionId,
      ...(method === 'PATCH' ? { Origin: origin, 'Content-Type': 'application/json', 'Idempotency-Key': key } : {}), ...input.headers }
    for (const [name, value] of Object.entries(headers)) if (value === undefined) delete headers[name]
    return handle(new Request(input.url || origin + (input.pathname || '/api/staff/jobs/' + assignmentId + '/status') + (input.query || ''), {
      method, headers, ...(['GET', 'HEAD'].includes(method) ? {} : { body: Object.hasOwn(input, 'body') ? input.body : JSON.stringify({ status: 'ACCEPTED' }) }),
    }))
  }
  return { config, sessionId, calls, controls, entries, auth, store, handle, request }
}
const fetched = f => f.calls.filter(call => call.kind === 'fetch')
const mutations = f => fetched(f).filter(call => call.init.method === 'PATCH')

test('UC12 HTTP GET only reads fixed Staff detail with server Bearer; browser identity headers are not forwarded', async () => {
  const f = fixture(), response = await f.request({ headers: { Authorization: 'Bearer browser-value', 'X-Employee-Id': '1' } })
  assert.equal(response.status, 200)
  const result = await response.json()
  assert.equal(result.allowedStatus, 'ACCEPTED'); assert.equal(result.operation, null)
  const call = fetched(f)[0], headers = new Headers(call.init.headers)
  assert.equal(call.url.href, 'http://127.0.0.1:4005/api/v1/staff/me/jobs/' + assignmentId)
  assert.equal(headers.get('authorization'), 'Bearer ' + serverToken)
  assert.equal(headers.get('cookie'), null); assert.equal(headers.get('x-employee-id'), null)
  assert.equal(call.init.redirect, 'error'); assert.equal(call.init.cache, 'no-store')
  assert.ok(call.init.signal instanceof AbortSignal); assert.equal(mutations(f).length, 0)
  assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0')
  assert.equal(response.headers.get('vary'), 'Cookie'); assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  assert.ok(response.headers.get('x-request-id')); assert.equal(response.headers.get('set-cookie'), null)
  assert.equal(JSON.stringify(result).includes(serverToken), false)
})

test('UC12 HTTP PATCH persists context then sends only validated target/key and server Bearer', async () => {
  const f = fixture(), response = await f.request({ method: 'PATCH', headers: { Authorization: 'Bearer browser-value', 'X-Employee-Id': '2' } })
  assert.equal(response.status, 200)
  const result = await response.json(), patch = mutations(f)[0], headers = new Headers(patch.init.headers)
  assert.equal(patch.url.href, 'http://127.0.0.1:4005/api/v1/staff/me/jobs/' + assignmentId + '/status')
  assert.equal(patch.init.body, JSON.stringify({ status: 'ACCEPTED' })); assert.equal(headers.get('idempotency-key'), key)
  assert.equal(headers.get('authorization'), 'Bearer ' + serverToken); assert.equal(headers.get('x-employee-id'), null)
  assert.ok(f.calls.findIndex(call => call.kind === 'ensure') < f.calls.findIndex(call => call === patch))
  assert.equal(result.operation.phase, 'confirmed'); assert.equal(result.operation.idempotencyKey, key)
  for (const secret of [serverToken, 'unit-upstream-secret-not-for-browser', 'unit-private-data']) assert.equal(JSON.stringify(result).includes(secret), false)
  assert.equal(Object.hasOwn(result.data, 'accessToken'), false)
})

test('UC12 HTTP 202 is pending and does not become a false 200', async () => {
  const f = fixture(); f.controls.httpStatus = 202
  const response = await f.request({ method: 'PATCH' }), result = await response.json()
  assert.equal(response.status, 202); assert.equal(result.operation.phase, 'pending')
  assert.equal(result.data.transition.synchronization, 'PENDING_ACKNOWLEDGEMENT')
})

test('UC12 HTTP PATCH requires exact Origin, including requests without Origin', async () => {
  for (const value of [undefined, 'null', origin + '/', 'http://localhost:3001', 'http://localhost:3003', 'http://127.0.0.1:3002', 'https://localhost:3002']) {
    const f = fixture(), response = await f.request({ method: 'PATCH', headers: { Origin: value } })
    assert.equal(response.status, 403); assert.equal((await response.json()).error.code, 'ORIGIN_DENIED')
    assert.equal(f.calls.length, 0); assert.equal(response.headers.get('set-cookie'), null)
  }
})

test('UC12 HTTP GET permits missing Origin but rejects foreign Origin, Host and fetch metadata', async () => {
  for (const input of [{ headers: { Origin: 'http://localhost:3001' } }, { headers: { Host: 'localhost:3003' } },
    { headers: { 'Sec-Fetch-Site': 'cross-site' } }, { headers: { 'Sec-Fetch-Site': 'same-site' } },
    { url: 'http://127.0.0.1:3002/api/staff/jobs/' + assignmentId + '/status' }]) {
    const f = fixture(), response = await f.request(input)
    assert.equal(response.status, 403); assert.equal(f.calls.length, 0)
  }
  const f = fixture(); assert.equal((await f.request({ headers: { Origin: origin, 'Sec-Fetch-Site': 'same-origin' } })).status, 200)
})

test('UC12 HTTP rejects queries that try to override identity, key, target or upstream URL', async () => {
  for (const query of ['?employeeId=2', '?userId=1', '?status=DONE', '?operationId=123', '?url=http://localhost:4003/internal/v1', '?page=1', '?key=abcdefgh&key=ijklmnop']) {
    const f = fixture(), response = await f.request({ method: 'PATCH', query })
    assert.equal(response.status, 400); assert.equal(f.calls.length, 0)
  }
})

test('UC12 HTTP accepts only canonical positive signed BIGINT assignment IDs', async () => {
  for (const id of ['0', '01', '-1', '1e2', '1.0', '9223372036854775808', '%201', '1%2Fstatus', '%2531', '%FF']) {
    const f = fixture(), response = await f.request({ pathname: '/api/staff/jobs/' + id + '/status' })
    assert.equal(response.status, 400); assert.equal(f.calls.length, 0)
  }
})

test('UC12 HTTP does not proxy arbitrary paths or Order internal endpoints', async () => {
  for (const pathname of ['/internal/v1/bookings/1/assignment-transitions/a', '/api/staff/jobs/' + assignmentId,
    '/api/staff/jobs/' + assignmentId + '/status/extra', '/api/staff/schedule']) {
    const f = fixture(), response = await f.request({ pathname })
    assert.equal(response.status, 404); assert.equal(f.calls.length, 0)
  }
})

test('UC12 HTTP unsupported methods return 405 and an explicit Allow header', async () => {
  for (const method of ['POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS']) {
    const f = fixture(), response = await f.request({ method })
    assert.equal(response.status, 405); assert.equal(response.headers.get('allow'), 'GET, PATCH'); assert.equal(f.calls.length, 0)
  }
})

test('UC12 HTTP validates JSON content type before Auth or any upstream access', async () => {
  for (const type of [undefined, 'text/plain', 'application/jsonp', 'application/x-www-form-urlencoded']) {
    const f = fixture(), response = await f.request({ method: 'PATCH', headers: { 'Content-Type': type } })
    assert.equal(response.status, 415); assert.equal(f.calls.length, 0)
  }
  const f = fixture(); assert.equal((await f.request({ method: 'PATCH', headers: { 'Content-Type': 'application/json; charset=utf-8' } })).status, 200)
})

test('UC12 HTTP refuses malformed JSON, extra fields and non-contract target values before Auth', async () => {
  for (const value of ['{', '', 'null', '[]', '{}', '{"status":"accepted"}', '{"status":"ASSIGNED"}', '{"status":"CANCELLED"}',
    '{"status":"DONE","employeeId":"2"}', '{"status":"DONE","checkInAt":"2026-01-01"}', '{"status":true}']) {
    const f = fixture(), response = await f.request({ method: 'PATCH', body: value })
    assert.equal(response.status, 400); assert.equal(f.calls.length, 0)
  }
})

test('UC12 HTTP refuses missing or invalid Idempotency-Key and never trims it', async () => {
  for (const value of [undefined, '', 'short', 'a'.repeat(129), 'invalid/key', 'invalid key', 'é12345678']) {
    const f = fixture(), response = await f.request({ method: 'PATCH', headers: { 'Idempotency-Key': value } })
    assert.equal(response.status, 400); assert.equal(f.calls.length, 0)
  }
})

test('UC12 HTTP bounds declared and streamed body bytes before Auth', async () => {
  for (const input of [{ headers: { 'Content-Length': '4097' } }, { body: JSON.stringify({ status: 'ACCEPTED', excess: 'a'.repeat(4096) }) }]) {
    const f = fixture(), response = await f.request({ method: 'PATCH', ...input })
    assert.equal(response.status, 413); assert.equal(f.calls.length, 0)
  }
  const f = fixture(), response = await f.request({ method: 'PATCH', headers: { 'Content-Length': 'invalid' } })
  assert.equal(response.status, 400); assert.equal(f.calls.length, 0)
})

test('UC12 HTTP missing session or browser Bearer cannot authorize GET or PATCH', async () => {
  for (const method of ['GET', 'PATCH']) {
    const f = fixture(), response = await f.request({ method, headers: { Cookie: undefined, Authorization: 'Bearer browser-token' } })
    assert.equal(response.status, 401); assert.equal((await response.json()).error.outcome, 'not_sent')
    assert.equal(fetched(f).length, 0); assert.equal(response.headers.get('www-authenticate'), 'Session')
    assert.match(response.headers.get('set-cookie'), /Max-Age=0/)
  }
})

test('UC12 HTTP malformed, duplicate and oversized cookies are not accepted as sessions', async () => {
  for (const value of ['cleanhome_staff_session=bad', 'cleanhome_staff_session=' + 'A'.repeat(44), 'x=' + 'a'.repeat(16385)]) {
    const f = fixture(), response = await f.request({ headers: { Cookie: value } })
    assert.equal(response.status, 401); assert.equal(fetched(f).length, 0)
  }
  const f = fixture(), cookie = 'cleanhome_staff_session=' + f.sessionId
  assert.equal((await f.request({ headers: { Cookie: cookie + '; ' + cookie } })).status, 401)
})

test('UC12 HTTP expired, locked and wrong-role sessions are revoked and no upstream request is made', async () => {
  for (const [status, code] of [[401, 'SESSION_EXPIRED'], [403, 'ACCOUNT_LOCKED'], [403, 'ROLE_MISMATCH']]) {
    const f = fixture(); f.controls.authError = new AuthBffError(status, code, 'Phiên không hợp lệ.')
    const response = await f.request({ method: 'PATCH' })
    assert.equal(response.status, status); assert.equal(fetched(f).length, 0)
    assert.equal(f.calls.filter(call => call.kind === 'logout').length, 1)
    assert.match(response.headers.get('set-cookie'), /HttpOnly; SameSite=Lax; Max-Age=0/)
  }
})

test('UC12 HTTP secure cookie clearing retains Secure when configured for HTTPS', async () => {
  const f = fixture(); f.config.secureCookie = true
  f.controls.authError = new AuthBffError(401, 'SESSION_EXPIRED', 'Phiên hết hạn.')
  const response = await f.request()
  assert.match(response.headers.get('set-cookie'), /; Secure$/)
})

test('UC12 HTTP Auth outage retains session and sends no Staff mutation', async () => {
  const f = fixture(); f.controls.authError = new AuthBffError(503, 'AUTH_UNAVAILABLE', 'Dịch vụ xác thực tạm gián đoạn.')
  const response = await f.request({ method: 'PATCH' }), result = await response.json()
  assert.equal(response.status, 503); assert.equal(result.error.code, 'AUTH_UNAVAILABLE')
  assert.equal(response.headers.get('set-cookie'), null); assert.equal(response.headers.get('retry-after'), '5')
  assert.equal(fetched(f).length, 0); assert.equal(f.calls.some(call => call.kind === 'logout'), false)
})

test('UC12 HTTP Staff 401/403 is session failure, whereas foreign/missing detail is an opaque 404', async () => {
  for (const status of [401, 403, 404]) {
    const f = fixture(); f.controls.upstream = async () => Response.json({ error: { code: 'PRIVATE_BACKEND_CODE', message: 'unit-upstream-private-detail' } }, { status })
    const response = await f.request({ method: 'PATCH' }), result = await response.json()
    assert.equal(response.status, status); assert.equal(mutations(f).length, 0)
    assert.equal(JSON.stringify(result).includes('unit-upstream-private-detail'), false)
    assert.equal(response.headers.get('set-cookie') !== null, status !== 404)
    if (status === 404) assert.equal(result.error.code, 'JOB_NOT_FOUND')
  }
})

test('UC12 HTTP safe Order error mapping never echoes upstream secrets or revokes the employee session', async () => {
  for (const [status, code] of [[503, 'ORDER_UNAVAILABLE'], [502, 'ORDER_BAD_RESPONSE'], [409, 'ORDER_REJECTED'], [503, 'RECONCILIATION_REQUIRED']]) {
    const f = fixture(); f.controls.upstream = async (_url, init) => init.method === 'GET' ? Response.json(detail())
      : Response.json({ error: { code, message: 'unit-internal-token-should-never-appear', details: { token: 'unit-secret' } } }, { status })
    const response = await f.request({ method: 'PATCH' }), result = await response.json()
    assert.equal(response.status, status); assert.equal(result.error.code, code); assert.equal(result.error.outcome, 'unknown')
    assert.equal(result.operation.idempotencyKey, key); assert.equal(result.operation.phase, 'unknown')
    assert.equal(response.headers.get('set-cookie'), null); assert.equal(JSON.stringify(result).includes('unit-secret'), false)
    assert.equal(JSON.stringify(result).includes('unit-internal-token-should-never-appear'), false)
  }
})

test('UC12 HTTP network failure after outgoing PATCH preserves the operation key as unknown', async () => {
  const f = fixture(); f.controls.upstream = async (_url, init) => {
    if (init.method === 'GET') return Response.json(detail())
    throw new Error('unit-diagnostic-containing-server-secret')
  }
  const response = await f.request({ method: 'PATCH' }), result = await response.json()
  assert.equal(response.status, 503); assert.equal(result.error.outcome, 'unknown')
  assert.equal(result.operation.idempotencyKey, key); assert.equal(result.operation.phase, 'unknown')
  assert.equal(JSON.stringify(result).includes('unit-diagnostic-containing-server-secret'), false)
  assert.equal(f.entries.length, 1); assert.equal(f.entries[0].receipt, null)
})

test('UC12 HTTP invalid success DTO cannot produce a success notification or receipt', async () => {
  const f = fixture(); f.controls.upstream = async (_url, init) => init.method === 'GET' ? Response.json(detail())
    : Response.json({ data: { assignmentId, status: 'ACCEPTED', accessToken: serverToken } })
  const response = await f.request({ method: 'PATCH' }), result = await response.json()
  assert.equal(response.status, 502); assert.equal(result.error.outcome, 'unknown')
  assert.equal(result.operation.phase, 'unknown'); assert.equal(f.entries[0].receipt, null)
  assert.equal(JSON.stringify(result).includes(serverToken), false)
})

test('UC12 HTTP operation-store failure before send is not_sent and must not forward a mutation', async () => {
  const f = fixture(); f.controls.readError = new AuthBffError(503, 'OPERATION_STORE_UNAVAILABLE', 'Không đọc được thông tin đối chiếu.')
  const response = await f.request({ method: 'PATCH' }), result = await response.json()
  assert.equal(response.status, 503); assert.equal(result.error.code, 'OPERATION_STORE_UNAVAILABLE')
  assert.equal(result.error.outcome, 'not_sent'); assert.equal(mutations(f).length, 0)
})

test('UC12 HTTP receipt-store failure after Backend success remains unknown and retains original key', async () => {
  const f = fixture(); f.controls.receiptError = new AuthBffError(503, 'OPERATION_STORE_UNAVAILABLE', 'Không lưu được thông tin đối chiếu.')
  const response = await f.request({ method: 'PATCH' }), result = await response.json()
  assert.equal(response.status, 503); assert.equal(result.error.outcome, 'unknown')
  assert.equal(result.operation.idempotencyKey, key); assert.equal(result.operation.phase, 'unknown')
  assert.equal(mutations(f).length, 1)
})

test('UC12 HTTP concurrent logout after commit returns 401 but keeps the receipt for later re-login', async () => {
  const f = fixture(); f.controls.postAuthError = new AuthBffError(401, 'SESSION_EXPIRED', 'Phiên đăng nhập đã kết thúc.')
  const response = await f.request({ method: 'PATCH' }), result = await response.json()
  assert.equal(response.status, 401); assert.equal(result.error.outcome, 'unknown')
  assert.equal(f.entries[0].receipt.httpStatus, 200); assert.equal(result.operation.phase, 'confirmed')
  assert.match(response.headers.get('set-cookie'), /Max-Age=0/)
})

test('UC12 HTTP unhandled configuration failure returns safe 503 rather than local error details', async () => {
  const handle = createStaffStatusHttp({ configFactory: () => { throw new Error('unit-private-file-path-and-secret') } })
  const response = await handle(new Request(origin + '/api/staff/jobs/1/status')), result = await response.json()
  assert.equal(response.status, 503); assert.equal(result.error.outcome, 'not_sent')
  assert.equal(JSON.stringify(result).includes('unit-private-file-path-and-secret'), false)
})

test('UC12 HTTP failed logout cannot claim that the server session was revoked successfully', async () => {
  const f = fixture(); f.controls.authError = new AuthBffError(401, 'SESSION_EXPIRED', 'Phiên hết hạn.')
  f.controls.logoutError = new Error('unit-storage-failure')
  const response = await f.request(), result = await response.json()
  assert.equal(response.status, 503); assert.equal(result.error.code, 'SESSION_STORE_UNAVAILABLE')
  assert.match(response.headers.get('set-cookie'), /Max-Age=0/)
})

test('UC12 HTTP invalid UTF-8 is rejected before Auth and cannot become a different target', async () => {
  const f = fixture(), response = await f.request({ method: 'PATCH', body: new Uint8Array([0x7b, 0xff, 0x7d]) })
  assert.equal(response.status, 400); assert.equal(f.calls.length, 0)
})

test('UC12 HTTP slow incoming body has a bounded timeout and does not start authentication', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const f = fixture(); let cancelled = false
  const request = new Request(origin + '/api/staff/jobs/' + assignmentId + '/status', {
    method: 'PATCH', headers: { Origin: origin, 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: new ReadableStream({ cancel() { cancelled = true } }), duplex: 'half',
  })
  const pending = f.handle(request)
  t.mock.timers.tick(5000)
  const response = await pending
  assert.equal(response.status, 408); assert.equal((await response.json()).error.code, 'REQUEST_TIMEOUT')
  assert.equal(f.calls.length, 0); assert.equal(cancelled, true)
})

test('UC12 HTTP timeout after dispatch is unknown and preserves the same operation for retry', async () => {
  const f = fixture(); f.controls.upstream = async (_url, init) => {
    if (init.method === 'GET') return Response.json(detail())
    return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('unit-aborted')), { once: true }))
  }
  const response = await f.request({ method: 'PATCH' }), result = await response.json()
  assert.equal(response.status, 503); assert.equal(result.error.outcome, 'unknown')
  assert.equal(result.operation.idempotencyKey, key); assert.equal(result.operation.phase, 'unknown')
  assert.equal(mutations(f).length, 1); assert.equal(f.entries[0].receipt, null)
})

test('UC12 HTTP error-code allowlist excludes Object prototype properties', async () => {
  for (const code of ['constructor', 'toString', '__proto__']) {
    const f = fixture(); f.controls.upstream = async (_url, init) => init.method === 'GET' ? Response.json(detail())
      : Response.json({ error: { code, message: 'unit-upstream-private-message' } }, { status: 409 })
    const response = await f.request({ method: 'PATCH' }), result = await response.json()
    assert.equal(response.status, 409); assert.equal(result.error.code, 'TRANSITION_REJECTED')
    assert.equal(typeof result.error.message, 'string'); assert.equal(JSON.stringify(result).includes('unit-upstream-private-message'), false)
  }
})
