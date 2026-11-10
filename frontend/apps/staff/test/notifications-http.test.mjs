import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { createStaffNotificationsHttp } from '../lib/server/notifications-http.mjs'
import { parseNotificationId, parseNotificationsPage, parseNotificationsQuery } from '../lib/server/notifications-contract.mjs'
import { AuthBffError } from '../lib/server/auth-core.mjs'

// Isolated request-wrapper tests with explicit auth/HTTP doubles.
// They are not evidence of real Staff HTTP, JWT verification or MySQL access.
const origin = 'http://localhost:3002'
const sid = () => randomBytes(32).toString('base64url')
const item = { id: '12', content: 'Đơn CH-1 đã được phân công cho bạn.', bookingId: '7', readAt: null, createdAt: '2026-11-01T02:03:04.000Z' }
const page = { data: [item], pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 }, unreadCount: 1, timezone: 'Asia/Ho_Chi_Minh' }
const emptyPage = { data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 }, unreadCount: 0, timezone: 'Asia/Ho_Chi_Minh' }

function fixture() {
  const config = { appOrigin: origin, secureCookie: false, cookieName: 'cleanhome_staff_session', staffUrl: 'http://127.0.0.1:4005', jobsTimeoutMs: 200 }
  const sessionId = sid()
  const calls = []
  const controls = { accountId: '9109002', inspectError: null, authError: null, upstream: () => Response.json(emptyPage), fetchError: null }
  const auth = {
    async inspect(value) {
      calls.push({ operation: 'inspect', sid: value })
      if (controls.inspectError) throw controls.inspectError
      if (controls.authError) throw controls.authError
      if (value !== sessionId) throw new AuthBffError(401, 'SESSION_REQUIRED', 'Đăng nhập để tiếp tục.')
      return { user: { id: controls.accountId, role: 'EMPLOYEE', status: 'ACTIVE' }, expiresAt: '2099-01-01T00:00:00.000Z' }
    },
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
  const handle = createStaffNotificationsHttp({ configFactory: () => config, authFactory: () => auth, fetchImpl })
  const request = (overrides = {}) => {
    const method = overrides.method || 'GET'
    const headers = { Cookie: 'cleanhome_staff_session=' + sessionId, ...(method === 'GET' ? {} : { Origin: origin }), ...overrides.headers }
    for (const [key, value] of Object.entries(headers)) if (value === undefined) delete headers[key]
    return handle(new Request(overrides.url || origin + '/api/staff/notifications' + (overrides.query || ''), { method, headers }))
  }
  return { config, sessionId, calls, controls, handle, request }
}

test('BFF reads only the fixed Staff notification routes with a server-side bearer', async () => {
  const f = fixture()
  f.controls.upstream = () => Response.json(page)
  const response = await f.request({ headers: { Authorization: 'Bearer browser-input-must-not-be-used', 'X-Employee-Id': '2' } })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), page)
  const call = f.calls.find(value => value.operation === 'fetch')
  assert.equal(call.url.origin, 'http://127.0.0.1:4005')
  assert.equal(call.url.pathname, '/api/v1/staff/me/notifications')
  assert.equal(call.url.searchParams.get('page'), '1')
  assert.equal(call.url.searchParams.get('pageSize'), '20')
  assert.equal(call.url.searchParams.get('unreadOnly'), null)
  const sentHeaders = new Headers(call.init.headers)
  assert.equal(sentHeaders.get('authorization'), 'Bearer unit-test-server-only-bearer')
  assert.equal(sentHeaders.get('cookie'), null)
  assert.equal(sentHeaders.get('x-employee-id'), null)
  assert.equal(call.init.redirect, 'error')
  assert.equal(call.init.cache, 'no-store')
  assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0')
  assert.equal(response.headers.get('vary'), 'Cookie')
  assert.equal(response.headers.get('set-cookie'), null)
})

test('BFF maps every notification endpoint to its fixed upstream path and method', async () => {
  const cases = [
    ['/api/staff/notifications/unread-count', 'GET', '/api/v1/staff/me/notifications/unread-count', () => ({ data: { unreadCount: 0 } })],
    ['/api/staff/notifications/read-all', 'PATCH', '/api/v1/staff/me/notifications/read-all', () => ({ data: { updated: 2, unreadCount: 0 } })],
    ['/api/staff/notifications/12/read', 'PATCH', '/api/v1/staff/me/notifications/12/read', () => ({ data: { ...item, readAt: '2026-11-02T01:00:00.000Z' }, unreadCount: 0 })],
  ]
  for (const [path, method, upstreamPath, body] of cases) {
    const f = fixture()
    f.controls.upstream = () => Response.json(body())
    const response = await f.request({ url: origin + path, method })
    assert.equal(response.status, 200, path)
    const call = f.calls.find(value => value.operation === 'fetch')
    assert.equal(call.url.pathname, upstreamPath)
    assert.equal(call.init.method, method)
  }
})

test('BFF forwards only normalized pagination and unread filter', async () => {
  const f = fixture()
  f.controls.upstream = () => Response.json({ ...page, pagination: { page: 2, pageSize: 1, total: 3, totalPages: 3 } })
  assert.equal((await f.request({ query: '?page=2&pageSize=1&unreadOnly=true' })).status, 200)
  const call = f.calls.find(value => value.operation === 'fetch')
  assert.deepEqual(Object.fromEntries(call.url.searchParams), { page: '2', pageSize: '1', unreadOnly: 'true' })
})

test('BFF rejects impersonation and unsupported query input before upstream access', async () => {
  for (const query of ['?userId=2', '?employeeId=2', '?bookingId=7', '?page=0', '?pageSize=101', '?page=1&page=2', '?unreadOnly=yes', '?sort=asc']) {
    const f = fixture()
    const response = await f.request({ query })
    assert.equal(response.status, 400, query)
    assert.equal((await response.json()).error.code, 'VALIDATION_ERROR')
    assert.equal(f.calls.some(value => value.operation === 'fetch'), false)
  }
  for (const [path, method] of [['/api/staff/notifications/12/read?x=1', 'PATCH'], ['/api/staff/notifications/unread-count?x=1', 'GET'], ['/api/staff/notifications/read-all?x=1', 'PATCH']]) {
    const f = fixture()
    const response = await f.request({ url: origin + path, method })
    assert.equal(response.status, 400, path)
    assert.equal(f.calls.some(value => value.operation === 'fetch'), false)
  }
})

test('BFF rejects malformed notification identifiers before auth or upstream', async () => {
  for (const id of ['0', '01', 'abc', '-1', '1.5', '9223372036854775808']) {
    const f = fixture()
    const response = await f.request({ url: origin + '/api/staff/notifications/' + id + '/read', method: 'PATCH' })
    assert.equal(response.status, 400, id)
    assert.equal(f.calls.some(value => value.operation === 'fetch'), false)
  }
})

test('BFF rejects wrong methods and exact Origin/Host/fetch-site violations', async () => {
  for (const [input, expected] of [[{ method: 'POST' }, 405], [{ url: origin + '/api/staff/notifications', method: 'PATCH' }, 405], [{ url: origin + '/api/staff/notifications/12/read' }, 405], [{ url: 'http://localhost:3003/api/staff/notifications' }, 403], [{ headers: { Host: 'localhost:3001' } }, 403], [{ headers: { Origin: 'http://localhost:3001' } }, 403], [{ headers: { 'Sec-Fetch-Site': 'cross-site' } }, 403], [{ headers: { 'Sec-Fetch-Site': 'same-site' } }, 403]]) {
    const f = fixture()
    const response = await f.request(input)
    assert.equal(response.status, expected, JSON.stringify(input))
    assert.equal(f.calls.some(value => value.operation === 'fetch'), false)
  }
  // A PATCH without an explicit same-origin Origin header is rejected as CSRF risk.
  const f = fixture()
  const raw = f.handle(new Request(origin + '/api/staff/notifications/12/read', { method: 'PATCH', headers: { Cookie: 'cleanhome_staff_session=' + f.sessionId } }))
  assert.equal((await raw).status, 403)
  assert.equal(f.calls.some(value => value.operation === 'fetch'), false)
})

test('BFF accepts an explicit same-origin PATCH', async () => {
  const f = fixture()
  f.controls.upstream = () => Response.json({ data: { ...item, readAt: '2026-11-02T01:00:00.000Z' }, unreadCount: 0 })
  const response = await f.request({ url: origin + '/api/staff/notifications/12/read', method: 'PATCH', headers: { Origin: origin, 'Sec-Fetch-Site': 'same-origin', Host: 'localhost:3002' } })
  assert.equal(response.status, 200)
})

test('BFF refuses absent, malformed, repeated and unknown session cookies', async () => {
  for (const cookie of [undefined, 'cleanhome_staff_session=short', 'cleanhome_staff_session=' + sid(), 'cleanhome_staff_session=' + sid() + '; cleanhome_staff_session=' + sid()]) {
    const f = fixture()
    const response = await f.request({ headers: { Cookie: cookie } })
    assert.equal(response.status, 401)
    assert.equal(f.calls.some(value => value.operation === 'fetch'), false)
    assert.match(response.headers.get('set-cookie'), /^cleanhome_staff_session=; Path=\/; HttpOnly; SameSite=Lax; Max-Age=0$/)
    assert.equal(response.headers.get('www-authenticate'), 'Session')
  }
})

test('BFF rejects a stale X-Staff-Account-Id instead of reading another inbox', async () => {
  const f = fixture()
  f.controls.accountId = '9109101'
  const response = await f.request({ headers: { 'X-Staff-Account-Id': '9109002' } })
  assert.equal(response.status, 409)
  assert.equal((await response.json()).error.code, 'STAFF_SESSION_CHANGED')
  assert.equal(f.calls.some(value => value.operation === 'fetch'), false)
  for (const value of ['0', '01', 'abc', '9223372036854775808']) {
    const g = fixture()
    assert.equal((await g.request({ headers: { 'X-Staff-Account-Id': value } })).status, 400)
    assert.equal(g.calls.some(call => call.operation === 'fetch'), false)
  }
})

test('BFF upstream 401/403 revokes only this frontend session and leaks nothing', async () => {
  for (const [status, expected] of [[401, 'SESSION_EXPIRED'], [403, 'STAFF_ACCESS_DENIED']]) {
    const f = fixture()
    f.controls.upstream = () => Response.json({ error: { code: 'STAFF_INACTIVE', message: 'unit-double-sensitive-upstream-detail', details: { token: 'unit-double-sensitive-field' } } }, { status })
    const response = await f.request()
    const result = await response.json()
    assert.equal(response.status, status)
    assert.equal(result.error.code, expected)
    assert.match(response.headers.get('set-cookie'), /Max-Age=0/)
    assert.ok(f.calls.some(value => value.operation === 'logout' && value.sid === f.sessionId))
    assert.equal(JSON.stringify(result).includes('unit-double-sensitive'), false)
  }
})

test('BFF upstream failures are sanitized and never revoke a valid session', async () => {
  for (const [status, expected] of [[500, 503], [503, 503], [429, 429], [400, 400], [404, 502]]) {
    const f = fixture()
    f.controls.upstream = () => Response.json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'unit-double-sensitive-field' } }, { status })
    const response = await f.request()
    const result = await response.json()
    assert.equal(response.status, expected, String(status))
    assert.equal(JSON.stringify(result).includes('unit-double-sensitive'), false)
    assert.equal(response.headers.get('set-cookie'), null)
    assert.equal(f.calls.some(value => value.operation === 'logout'), false)
  }
})

test('BFF maps a missing notification only on the single-item route', async () => {
  const f = fixture()
  f.controls.upstream = () => Response.json({ error: { code: 'NOTIFICATION_NOT_FOUND', message: 'x' } }, { status: 404 })
  const response = await f.request({ url: origin + '/api/staff/notifications/12/read', method: 'PATCH', headers: { Origin: origin } })
  assert.equal(response.status, 404)
  assert.equal((await response.json()).error.code, 'NOTIFICATION_NOT_FOUND')
})

test('BFF refuses invalid upstream payloads and non-JSON responses', async () => {
  const bad = [
    { ...page, unreadCount: 5 },
    { ...page, timezone: 'UTC' },
    { ...page, data: [{ ...item, createdAt: '2026-11-01 02:03:04' }] },
    { ...page, pagination: { page: 2, pageSize: 20, total: 1, totalPages: 1 } },
    { ...page, data: [item, item] },
  ]
  for (const payload of bad) {
    const f = fixture()
    f.controls.upstream = () => Response.json(payload)
    const response = await f.request()
    assert.equal(response.status, 502, JSON.stringify(payload).slice(0, 60))
    assert.equal((await response.json()).error.code, 'STAFF_INVALID_RESPONSE')
  }
  const f = fixture()
  f.controls.upstream = () => new Response('not json', { status: 200, headers: { 'content-type': 'text/html' } })
  assert.equal((await f.request()).status, 502)
  const g = fixture()
  g.controls.fetchError = new Error('unit-double-network-failure')
  const response = await g.request()
  assert.equal(response.status, 503)
  assert.equal(JSON.stringify(await response.json()).includes('unit-double-network-failure'), false)
})

test('BFF whitelists fields that the stored notification table does not have', async () => {
  const f = fixture()
  f.controls.upstream = () => Response.json({ ...page, data: [{ ...item, salary: '999', href: 'https://evil.test' }] })
  const response = await f.request()
  assert.equal(response.status, 200)
  const body = await response.json()
  for (const key of ['title', 'type', 'href', 'label', 'amount', 'salary', 'link']) assert.equal(key in body.data[0], false)
  assert.deepEqual(body.data[0], item)
})

test('contract validation keeps strict paging, ids and read-all semantics', () => {
  assert.deepEqual(parseNotificationsQuery(new URLSearchParams('')), { page: 1, pageSize: 20, unreadOnly: false })
  assert.deepEqual(parseNotificationsQuery(new URLSearchParams('page=3&pageSize=50&unreadOnly=true')), { page: 3, pageSize: 50, unreadOnly: true })
  assert.equal(parseNotificationId('9223372036854775807'), '9223372036854775807')
  for (const value of ['0', '01', 'abc', '', '1.5', '9223372036854775808']) assert.throws(() => parseNotificationId(value), error => error.status === 400)
  assert.equal(parseNotificationsPage(page, { page: 1, pageSize: 20, unreadOnly: false }).data[0].id, '12')
  assert.equal(parseNotificationsPage({ ...page, data: [{ ...item, readAt: '2026-11-02T01:00:00.000Z' }] }, { page: 1, pageSize: 20, unreadOnly: false }).data[0].readAt, '2026-11-02T01:00:00.000Z')
})
