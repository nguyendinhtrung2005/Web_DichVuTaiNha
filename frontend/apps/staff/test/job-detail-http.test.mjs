import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { createStaffJobDetailHttp } from '../lib/server/job-detail-http.mjs'
import { AuthBffError } from '../lib/server/auth-core.mjs'

// Isolated wrapper tests with explicit Auth/HTTP doubles. These do not establish
// real JWT verification, Backend object ownership or MySQL integration evidence.
const origin = 'http://localhost:3002', assignmentId = '9223372036854775807'
const sid = () => randomBytes(32).toString('base64url')
function payload() {
  return { data: {
    id: assignmentId, assignmentId, orderId: '9007199254740993', jobCode: null, orderCode: null,
    status: 'WAITING', databaseStatus: 'ASSIGNED', jobStatus: 'waiting', orderStatus: 'confirmed',
    scheduledAt: '2026-10-23T17:30:00.000Z', expectedEndAt: '2026-10-23T19:00:00.000Z', durationMinutes: 90,
    contact: { name: 'Khách hàng kiểm thử', address: 'Địa chỉ kiểm thử', phone: 'TEST-CONTACT', houseType: null, area: null, rooms: null, floors: null, hasPets: null },
    services: [{ serviceId: '5', name: 'Dịch vụ kiểm thử', unit: 'giờ', quantity: '1.50', unitPrice: '123.45' }],
    checkInAt: null, checkOutAt: null, assignedAt: '2026-10-23T00:00:00.000Z',
    specialRequest: null, cancellationPending: null, orderHistory: null, historySource: 'order-service-not-loaded',
    unsupportedFields: ['jobCode', 'orderCode', 'houseType', 'area', 'rooms', 'floors', 'hasPets', 'specialRequest', 'cancellationPending'],
  } }
}
function fixture() {
  const config = { appOrigin: origin, secureCookie: false, cookieName: 'cleanhome_staff_session', staffUrl: 'http://127.0.0.1:4005', jobsTimeoutMs: 200 }
  const sessionId = sid(), calls = [], controls = { authError: null, upstream: () => Response.json(payload()), fetchError: null }
  const auth = {
    async withAccessToken(value, callback) {
      calls.push({ operation: 'authorize', sid: value })
      if (controls.authError) throw controls.authError
      if (value !== sessionId) throw new AuthBffError(401, 'SESSION_REQUIRED', 'Đăng nhập để tiếp tục.')
      return await callback('unit-test-server-only-bearer')
    },
    async logout(value) { calls.push({ operation: 'logout', sid: value }) },
  }
  const handle = createStaffJobDetailHttp({ configFactory: () => config, authFactory: () => auth, fetchImpl: async (url, init) => {
    calls.push({ operation: 'fetch', url: new URL(url), init })
    if (controls.fetchError) throw controls.fetchError
    return await controls.upstream(url, init)
  } })
  const request = (overrides = {}) => {
    const headers = { Cookie: 'cleanhome_staff_session=' + sessionId, ...overrides.headers }
    for (const [name, value] of Object.entries(headers)) if (value === undefined) delete headers[name]
    return handle(new Request(overrides.url || origin + (overrides.pathname || '/api/staff/jobs/' + assignmentId) + (overrides.query || ''), { method: overrides.method || 'GET', headers }))
  }
  return { config, sessionId, controls, calls, handle, request }
}

test('UC10 BFF reads only the fixed assignment endpoint with server Bearer and no browser credentials', async () => {
  const f = fixture()
  const response = await f.request({ headers: { Authorization: 'Bearer browser-input-not-used', 'X-Employee-Id': '2' } })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), payload())
  const call = f.calls.find(value => value.operation === 'fetch'), headers = new Headers(call.init.headers)
  assert.equal(call.url.href, 'http://127.0.0.1:4005/api/v1/staff/me/jobs/' + assignmentId)
  assert.equal(call.init.method, 'GET')
  assert.equal(headers.get('authorization'), 'Bearer unit-test-server-only-bearer')
  assert.equal(headers.get('cookie'), null)
  assert.equal(headers.get('x-employee-id'), null)
  assert.equal(call.init.redirect, 'error')
  assert.equal(call.init.cache, 'no-store')
  assert.ok(call.init.signal instanceof AbortSignal)
  assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0')
  assert.equal(response.headers.get('vary'), 'Cookie')
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  assert.ok(response.headers.get('x-request-id'))
  assert.equal(response.headers.get('set-cookie'), null)
})

test('UC10 BFF rejects identity, proxy, UC9 and repeated query parameters before fetching', async () => {
  for (const query of ['?employeeId=2', '?userId=2', '?url=http://localhost:4003/internal/v1', '?page=1', '?status=DONE', '?employeeId=1&employeeId=2']) {
    const f = fixture(), response = await f.request({ query })
    assert.equal(response.status, 400)
    assert.equal((await response.json()).error.code, 'VALIDATION_ERROR')
    assert.equal(f.calls.some(value => value.operation === 'fetch'), false)
  }
})

test('UC10 BFF validates decoded IDs before Auth or Staff access', async () => {
  for (const id of ['0', '01', '-1', '1e2', '1.0', '9223372036854775808', '%201', '1%2Fstatus', '%2531']) {
    const f = fixture(), response = await f.request({ pathname: '/api/staff/jobs/' + id })
    assert.equal(response.status, 400)
    assert.equal((await response.json()).error.code, 'VALIDATION_ERROR')
    assert.equal(f.calls.length, 0)
  }
})

test('UC10 BFF does not route status mutation, arbitrary paths or Order internal requests', async () => {
  for (const pathname of ['/api/staff/jobs/' + assignmentId + '/status', '/api/staff/jobs', '/internal/v1/bookings/1', '/api/staff/jobs/' + assignmentId + '/extra']) {
    const f = fixture(), response = await f.request({ pathname })
    assert.equal(response.status, 404)
    assert.equal(f.calls.length, 0)
  }
  const f = fixture()
  assert.equal((await f.request({ method: 'PATCH' })).status, 405)
  assert.equal(f.calls.length, 0)
})

test('UC10 BFF pins exact Origin, Host and same-origin fetch metadata', async () => {
  for (const input of [{ url: 'http://localhost:3003/api/staff/jobs/' + assignmentId }, { headers: { Host: 'localhost:3001' } }, { headers: { Origin: 'http://localhost:3001' } }, { headers: { Origin: 'http://localhost:3003' } }, { headers: { Origin: 'null' } }, { headers: { 'Sec-Fetch-Site': 'cross-site' } }, { headers: { 'Sec-Fetch-Site': 'same-site' } }]) {
    const f = fixture()
    assert.equal((await f.request(input)).status, 403)
    assert.equal(f.calls.length, 0)
  }
  assert.equal((await fixture().request({ headers: { Origin: origin, 'Sec-Fetch-Site': 'same-origin' } })).status, 200)
})

test('UC10 BFF refuses missing, malformed, unknown and repeated Staff session cookies', async () => {
  for (const cookie of [undefined, 'cleanhome_staff_session=short', 'cleanhome_staff_session=' + sid(), 'cleanhome_staff_session=' + sid() + '; cleanhome_staff_session=' + sid()]) {
    const f = fixture(), response = await f.request({ headers: { Cookie: cookie } })
    assert.equal(response.status, 401)
    assert.equal(f.calls.some(value => value.operation === 'fetch'), false)
    assert.match(response.headers.get('set-cookie'), /^cleanhome_staff_session=; Path=\/; HttpOnly; SameSite=Lax; Max-Age=0$/)
    assert.equal(response.headers.get('www-authenticate'), 'Session')
    assert.equal((await response.json()).data, undefined)
  }
})

test('UC10 expired or forbidden sessions are revoked without fetching detail', async () => {
  for (const [status, code] of [[401, 'SESSION_EXPIRED'], [403, 'ACCESS_DENIED']]) {
    const f = fixture()
    f.controls.authError = new AuthBffError(status, code, 'Phiên không hợp lệ.')
    const response = await f.request()
    assert.equal(response.status, status)
    assert.equal(f.calls.some(value => value.operation === 'fetch'), false)
    assert.ok(f.calls.some(value => value.operation === 'logout' && value.sid === f.sessionId))
    assert.match(response.headers.get('set-cookie'), /Max-Age=0/)
    assert.equal((await response.json()).data, undefined)
  }
})

test('UC10 cross-owner and missing assignments share sanitized 404 without revoking a valid session', async () => {
  for (const reason of ['not owned', 'does not exist']) {
    const f = fixture()
    f.controls.upstream = () => Response.json({ error: { code: 'JOB_NOT_FOUND', message: 'unit-double-private-' + reason, details: { assignment: payload().data } } }, { status: 404 })
    const response = await f.request(), result = await response.json()
    assert.equal(response.status, 404)
    assert.equal(result.error.code, 'JOB_NOT_FOUND')
    assert.equal(result.data, undefined)
    assert.equal(JSON.stringify(result).includes(assignmentId), false)
    assert.equal(JSON.stringify(result).includes('unit-double-private'), false)
    assert.equal(JSON.stringify(result).includes('TEST-CONTACT'), false)
    assert.equal(response.headers.get('set-cookie'), null)
    assert.equal(f.calls.some(value => value.operation === 'logout'), false)
  }
})

test('UC10 upstream 401 or 403 invalidates the session with no assignment details', async () => {
  for (const [status, code] of [[401, 'SESSION_EXPIRED'], [403, 'STAFF_ACCESS_DENIED']]) {
    const f = fixture()
    f.controls.upstream = () => Response.json({ error: { code: 'UPSTREAM', message: 'unit-double-private', details: payload().data } }, { status })
    const response = await f.request(), result = await response.json()
    assert.equal(response.status, status)
    assert.equal(result.error.code, code)
    assert.equal(result.data, undefined)
    assert.equal(JSON.stringify(result).includes('unit-double-private'), false)
    assert.ok(f.calls.some(value => value.operation === 'logout' && value.sid === f.sessionId))
    assert.match(response.headers.get('set-cookie'), /Max-Age=0/)
  }
})

test('UC10 Auth outage is fail-closed and retains the session for recovery', async () => {
  const f = fixture()
  f.controls.authError = new AuthBffError(503, 'AUTH_UNAVAILABLE', 'Chưa xác minh được phiên.')
  const response = await f.request()
  assert.equal(response.status, 503)
  assert.equal(response.headers.get('set-cookie'), null)
  assert.equal(f.calls.some(value => ['fetch', 'logout'].includes(value.operation)), false)
  assert.equal((await response.json()).data, undefined)
})

test('UC10 upstream failures and rate limits are sanitized, not retried and do not revoke a session', async () => {
  for (const [status, expected, code] of [[500, 503, 'STAFF_UNAVAILABLE'], [503, 503, 'STAFF_UNAVAILABLE'], [429, 429, 'STAFF_RATE_LIMITED'], [400, 400, 'VALIDATION_ERROR']]) {
    const f = fixture()
    f.controls.upstream = () => Response.json({ error: { code: 'PRIVATE', message: 'unit-double-private', details: payload().data } }, { status })
    const response = await f.request(), result = await response.json()
    assert.equal(response.status, expected)
    assert.equal(result.error.code, code)
    assert.equal(result.data, undefined)
    assert.equal(JSON.stringify(result).includes('unit-double-private'), false)
    assert.equal(response.headers.get('set-cookie'), null)
    assert.equal(f.calls.filter(value => value.operation === 'fetch').length, 1)
    assert.equal(f.calls.some(value => value.operation === 'logout'), false)
  }
})

test('UC10 rejects successful responses for another assignment, non-JSON and oversized data', async () => {
  for (const upstream of [
    () => Response.json({ data: { ...payload().data, id: '1', assignmentId: '1' } }),
    () => new Response('<html>not JSON</html>', { headers: { 'Content-Type': 'text/html' } }),
    () => new Response('{', { headers: { 'Content-Type': 'application/json' } }),
    () => Response.json(payload(), { headers: { 'Content-Length': '1048577' } }),
    () => new Response(' '.repeat(1048577), { headers: { 'Content-Type': 'application/json' } }),
  ]) {
    const f = fixture(); f.controls.upstream = upstream
    const response = await f.request(), result = await response.json()
    assert.equal(response.status, 502)
    assert.equal(result.error.code, 'STAFF_INVALID_RESPONSE')
    assert.equal(result.data, undefined)
    assert.equal(response.headers.get('set-cookie'), null)
  }
})

test('UC10 optional history outage preserves valid assignment details with a safe warning', async () => {
  const f = fixture()
  f.controls.upstream = () => Response.json({ data: { ...payload().data, historySource: 'order-service-unavailable', warnings: [{ code: 'ORDER_HISTORY_UNAVAILABLE', message: 'unit-double-private-upstream' }] } })
  const response = await f.request(), result = await response.json()
  assert.equal(response.status, 200)
  assert.equal(result.data.assignmentId, assignmentId)
  assert.equal(result.data.orderHistory, null)
  assert.equal(result.data.warnings[0].code, 'ORDER_HISTORY_UNAVAILABLE')
  assert.equal(JSON.stringify(result).includes('unit-double-private'), false)
  assert.equal(f.calls.filter(value => value.operation === 'fetch').length, 1)
})

test('UC10 network or redirect failures remain sanitized dependency errors', async () => {
  const f = fixture(); f.controls.fetchError = new TypeError('unit-double-private')
  const response = await f.request(), result = await response.json()
  assert.equal(response.status, 503)
  assert.equal(result.error.code, 'STAFF_UNAVAILABLE')
  assert.equal(JSON.stringify(result).includes('unit-double-private'), false)
  assert.equal(f.calls.filter(value => value.operation === 'fetch').length, 1)
})

test('UC10 applies a finite timeout without returning stale assignment data', { timeout: 2000 }, async () => {
  const f = fixture(); f.config.jobsTimeoutMs = 100
  f.controls.upstream = async (_url, init) => await new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }))
  const response = await f.request(), result = await response.json()
  assert.equal(response.status, 503)
  assert.equal(result.error.code, 'STAFF_UNAVAILABLE')
  assert.equal(result.data, undefined)
  assert.equal(f.calls.filter(value => value.operation === 'fetch').length, 1)
})
