import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { createStaffScheduleHttp } from '../lib/server/schedule-http.mjs'
import { AuthBffError } from '../lib/server/auth-core.mjs'

// Request-wrapper unit tests use explicit Auth/fetch doubles, not live HTTP/MySQL.
const origin = 'http://localhost:3002'
const body = () => ({ data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 }, timezone: 'Asia/Ho_Chi_Minh' })
const sid = () => randomBytes(32).toString('base64url')
const range = '?from=2026-10-24&to=2026-10-24'
function fixture() {
  const config = { appOrigin: origin, secureCookie: false, cookieName: 'cleanhome_staff_session', staffUrl: 'http://127.0.0.1:4005', jobsTimeoutMs: 200 }
  const sessionId = sid(), calls = [], controls = { authError: null, upstream: () => Response.json(body()), fetchError: null }
  const auth = {
    async withAccessToken(value, callback) {
      calls.push({ operation: 'authorize', sid: value })
      if (controls.authError) throw controls.authError
      if (value !== sessionId) throw new AuthBffError(401, 'SESSION_REQUIRED', 'Đăng nhập để tiếp tục.')
      return await callback('unit-test-server-only-bearer')
    },
    async logout(value) { calls.push({ operation: 'logout', sid: value }) },
  }
  const fetchImpl = async (url, init) => {
    calls.push({ operation: 'fetch', url: new URL(url), init })
    if (controls.fetchError) throw controls.fetchError
    return await controls.upstream(url, init)
  }
  const handle = createStaffScheduleHttp({ configFactory: () => config, authFactory: () => auth, fetchImpl })
  const request = (overrides = {}) => {
    const headers = { Cookie: 'cleanhome_staff_session=' + sessionId, ...overrides.headers }
    for (const [key, value] of Object.entries(headers)) if (value === undefined) delete headers[key]
    return handle(new Request(overrides.url || origin + '/api/staff/schedule' + (overrides.query ?? range), { method: overrides.method || 'GET', headers }))
  }
  return { config, sessionId, calls, controls, handle, request }
}

test('UC11 BFF calls only Staff schedule with a server-owned Bearer token and safe response headers', async () => {
  const f = fixture(), response = await f.request({ headers: { Authorization: 'Bearer browser-token-must-not-be-forwarded', 'X-Employee-Id': '2' } })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), body())
  const call = f.calls.find(value => value.operation === 'fetch')
  assert.equal(call.url.origin, 'http://127.0.0.1:4005')
  assert.equal(call.url.pathname, '/api/v1/staff/me/schedule')
  assert.deepEqual(Object.fromEntries(call.url.searchParams), { from: '2026-10-24', to: '2026-10-24', page: '1', pageSize: '20', sort: 'asc' })
  const headers = new Headers(call.init.headers)
  assert.equal(headers.get('authorization'), 'Bearer unit-test-server-only-bearer')
  assert.equal(headers.get('cookie'), null)
  assert.equal(headers.get('x-employee-id'), null)
  assert.equal(call.init.method, 'GET')
  assert.equal(call.init.redirect, 'error')
  assert.equal(call.init.cache, 'no-store')
  assert.ok(call.init.signal instanceof AbortSignal)
  assert.match(response.headers.get('cache-control'), /no-store/)
  assert.equal(response.headers.get('vary'), 'Cookie')
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  assert.ok(response.headers.get('x-request-id'))
  assert.equal(response.headers.get('set-cookie'), null)
})

test('UC11 BFF forwards only validated calendar dates, normalized status and bounded pagination', async () => {
  const f = fixture()
  f.controls.upstream = () => Response.json({ ...body(), pagination: { page: 2, pageSize: 1, total: 1, totalPages: 1 } })
  const response = await f.request({ query: '?from=2026-12-31&to=2027-01-01&status=waiting&page=2&pageSize=1&sort=desc' })
  assert.equal(response.status, 200)
  const call = f.calls.find(value => value.operation === 'fetch')
  assert.deepEqual(Object.fromEntries(call.url.searchParams), { from: '2026-12-31', to: '2027-01-01', status: 'ASSIGNED', page: '2', pageSize: '1', sort: 'desc' })
})

test('UC11 BFF refuses missing dates, identity overrides, duplicates and invalid ranges before upstream use', async () => {
  for (const query of ['', '?from=2026-10-24', range + '&employeeId=2', range + '&userId=2', range + '&staffId=2', range + '&url=http://localhost:4003/internal/v1', range + '&from=2026-10-25', '?from=2026-02-30&to=2026-03-01', '?from=2024-01-01&to=2025-01-01', range + '&pageSize=101']) {
    const f = fixture(), response = await f.request({ query })
    assert.equal(response.status, 400)
    assert.equal((await response.json()).error.code, 'VALIDATION_ERROR')
    assert.equal(f.calls.length, 0)
  }
})

test('UC11 BFF rejects mutation methods, arbitrary paths and internal Order routes', async () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const f = fixture(), response = await f.request({ method })
    assert.equal(response.status, 405)
    assert.equal(response.headers.get('allow'), 'GET')
    assert.equal(f.calls.length, 0)
  }
  for (const path of ['/api/staff/schedule/1', '/api/staff/jobs', '/internal/v1/assignment-transitions/pending']) {
    const f = fixture(), response = await f.request({ url: origin + path + range })
    assert.equal(response.status, 404)
    assert.equal(f.calls.length, 0)
  }
})

test('UC11 pins exact Origin, request Host and same-origin fetch metadata without revoking sessions', async () => {
  for (const input of [{ url: 'http://localhost:3003/api/staff/schedule' + range }, { headers: { Host: 'localhost:3001' } }, { headers: { Origin: 'http://localhost:3001' } }, { headers: { Origin: 'null' } }, { headers: { 'Sec-Fetch-Site': 'cross-site' } }, { headers: { 'Sec-Fetch-Site': 'same-site' } }]) {
    const f = fixture(), response = await f.request(input)
    assert.equal(response.status, 403)
    assert.equal(f.calls.length, 0)
    assert.equal(response.headers.get('set-cookie'), null)
  }
})

test('UC11 accepts a legitimate explicit same-origin request', async () => {
  const f = fixture()
  assert.equal((await f.request({ headers: { Origin: origin, Host: 'localhost:3002', 'Sec-Fetch-Site': 'same-origin' } })).status, 200)
})

test('UC11 missing, malformed, repeated and unknown session cookies cannot request schedule data', async () => {
  for (const cookie of [undefined, 'cleanhome_staff_session=short', 'cleanhome_staff_session=' + sid(), 'cleanhome_staff_session=' + sid() + '; cleanhome_staff_session=' + sid()]) {
    const f = fixture(), response = await f.request({ headers: { Cookie: cookie } })
    assert.equal(response.status, 401)
    assert.equal((await response.json()).data, undefined)
    assert.equal(f.calls.some(value => value.operation === 'fetch'), false)
    assert.match(response.headers.get('set-cookie'), /HttpOnly; SameSite=Lax; Max-Age=0/)
    assert.equal(response.headers.get('www-authenticate'), 'Session')
  }
})

test('UC11 expired or forbidden Auth sessions fail closed and revoke only the current SID', async () => {
  for (const [status, code] of [[401, 'SESSION_EXPIRED'], [403, 'ACCESS_DENIED']]) {
    const f = fixture()
    f.controls.authError = new AuthBffError(status, code, 'Phiên không hợp lệ.')
    const response = await f.request()
    assert.equal(response.status, status)
    assert.equal((await response.json()).data, undefined)
    assert.ok(f.calls.some(value => value.operation === 'logout' && value.sid === f.sessionId))
    assert.equal(f.calls.some(value => value.operation === 'fetch'), false)
    assert.match(response.headers.get('set-cookie'), /Max-Age=0/)
  }
})

test('UC11 HTTPS cookie expiry keeps Secure and other HttpOnly attributes', async () => {
  const f = fixture()
  f.config.appOrigin = 'https://staff.cleanhome.test'; f.config.secureCookie = true
  const response = await f.handle(new Request(f.config.appOrigin + '/api/staff/schedule' + range))
  assert.equal(response.status, 401)
  assert.match(response.headers.get('set-cookie'), /HttpOnly; SameSite=Lax; Max-Age=0; Secure$/)
})

test('UC11 Staff 401 and 403 are sanitized and invalidate this Frontend session', async () => {
  for (const [status, expected] of [[401, 'SESSION_EXPIRED'], [403, 'STAFF_ACCESS_DENIED']]) {
    const f = fixture()
    f.controls.upstream = () => Response.json({ error: { code: 'STAFF_INACTIVE', message: 'unit-double-sensitive-detail', details: { token: 'unit-double-sensitive-field' } } }, { status })
    const response = await f.request(), result = await response.json()
    assert.equal(response.status, status)
    assert.equal(result.error.code, expected)
    assert.equal(JSON.stringify(result).includes('unit-double-sensitive'), false)
    assert.equal(result.data, undefined)
    assert.ok(f.calls.some(value => value.operation === 'logout' && value.sid === f.sessionId))
  }
})

test('UC11 Auth dependency outage retains the session and does not request or fabricate a schedule', async () => {
  const f = fixture()
  f.controls.authError = new AuthBffError(503, 'AUTH_UNAVAILABLE', 'Chưa thể xác minh phiên.')
  const response = await f.request(), result = await response.json()
  assert.equal(response.status, 503)
  assert.equal(result.error.code, 'AUTH_UNAVAILABLE')
  assert.equal(result.data, undefined)
  assert.equal(response.headers.get('set-cookie'), null)
  assert.equal(f.calls.some(value => ['fetch', 'logout'].includes(value.operation)), false)
})

test('UC11 Staff failure, rate limits and a missing fixed endpoint are not an empty successful calendar', async () => {
  for (const [status, expectedStatus, code] of [[500, 503, 'STAFF_UNAVAILABLE'], [503, 503, 'STAFF_UNAVAILABLE'], [404, 502, 'STAFF_INVALID_RESPONSE'], [429, 429, 'STAFF_RATE_LIMITED'], [400, 400, 'VALIDATION_ERROR']]) {
    const f = fixture()
    f.controls.upstream = () => Response.json({ error: { code: 'UPSTREAM_PRIVATE', message: 'unit-double-sensitive-detail' } }, { status })
    const response = await f.request(), result = await response.json()
    assert.equal(response.status, expectedStatus)
    assert.equal(result.error.code, code)
    assert.equal(result.data, undefined)
    assert.equal(JSON.stringify(result).includes('unit-double-sensitive'), false)
    assert.equal(response.headers.get('set-cookie'), null)
    assert.equal(f.calls.filter(value => value.operation === 'fetch').length, 1)
    assert.equal(f.calls.some(value => value.operation === 'logout'), false)
  }
})

test('UC11 a genuinely empty Staff response is returned as a valid empty calendar', async () => {
  const f = fixture(), response = await f.request()
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), body())
})

test('UC11 rejects malformed, non-JSON and oversized successful Staff responses', async () => {
  for (const upstream of [() => new Response('<html>not JSON</html>', { headers: { 'Content-Type': 'text/html' } }), () => new Response('{', { headers: { 'Content-Type': 'application/json' } }), () => Response.json({ ...body(), timezone: 'UTC' }), () => Response.json(body(), { headers: { 'Content-Length': '1048577' } }), () => new Response(' '.repeat(1048577), { headers: { 'Content-Type': 'application/json' } })]) {
    const f = fixture(); f.controls.upstream = upstream
    const response = await f.request()
    assert.equal(response.status, 502)
    assert.equal((await response.json()).error.code, 'STAFF_INVALID_RESPONSE')
    assert.equal(response.headers.get('set-cookie'), null)
  }
})

test('UC11 connection and redirect errors are bounded safe failures with no retry', async () => {
  const f = fixture(); f.controls.fetchError = new TypeError('unit-double-sensitive-detail')
  const response = await f.request(), result = await response.json()
  assert.equal(response.status, 503)
  assert.equal(result.error.code, 'STAFF_UNAVAILABLE')
  assert.equal(JSON.stringify(result).includes('unit-double-sensitive'), false)
  assert.equal(f.calls.filter(value => value.operation === 'fetch').length, 1)
})

test('UC11 applies a finite timeout rather than leaving the calendar request pending', { timeout: 2000 }, async () => {
  const f = fixture(); f.config.jobsTimeoutMs = 100
  f.controls.upstream = async (_url, init) => await new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('unit timeout')), { once: true })
  })
  const response = await f.request()
  assert.equal(response.status, 503)
  assert.equal((await response.json()).data, undefined)
})
