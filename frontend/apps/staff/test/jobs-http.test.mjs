import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, randomBytes, sign, verify } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createStaffJobsHttp } from '../lib/server/jobs-http.mjs'
import { AuthBffError, createStaffAuth } from '../lib/server/auth-core.mjs'
import { loadStaffAuthConfig } from '../lib/server/config.mjs'

// These are isolated request-wrapper unit tests with explicit auth/HTTP doubles.
// They are not evidence of real Staff HTTP, JWT verification or MySQL access.
const origin = 'http://localhost:3002'
const sid = () => randomBytes(32).toString('base64url')
const body = () => ({ data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 }, timezone: 'Asia/Ho_Chi_Minh' })
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
  const handle = createStaffJobsHttp({ configFactory: () => config, authFactory: () => auth, fetchImpl })
  const request = (overrides = {}) => {
    const headers = { Cookie: 'cleanhome_staff_session=' + sessionId, ...overrides.headers }
    for (const [key, value] of Object.entries(headers)) if (value === undefined) delete headers[key]
    return handle(new Request(overrides.url || origin + '/api/staff/jobs' + (overrides.query || ''), { method: overrides.method || 'GET', headers }))
  }
  return { config, sessionId, calls, controls, handle, request }
}

test('UC9 BFF calls only the fixed public Staff list route with server Bearer and no client credentials', async () => {
  const f = fixture()
  const response = await f.request({ headers: { Authorization: 'Bearer browser-input-must-not-be-used', 'X-Employee-Id': '2' } })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), body())
  const call = f.calls.find(value => value.operation === 'fetch')
  assert.equal(call.url.origin, 'http://127.0.0.1:4005')
  assert.equal(call.url.pathname, '/api/v1/staff/me/jobs')
  assert.equal(call.url.searchParams.get('page'), '1')
  assert.equal(call.url.searchParams.get('pageSize'), '20')
  assert.equal(call.url.searchParams.get('sort'), 'asc')
  assert.equal(call.init.method, 'GET')
  const sentHeaders = new Headers(call.init.headers)
  assert.equal(sentHeaders.get('authorization'), 'Bearer unit-test-server-only-bearer')
  assert.equal(sentHeaders.get('cookie'), null)
  assert.equal(sentHeaders.get('x-employee-id'), null)
  assert.equal(call.init.redirect, 'error')
  assert.equal(call.init.cache, 'no-store')
  assert.ok(call.init.signal instanceof AbortSignal)
  assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0')
  assert.equal(response.headers.get('vary'), 'Cookie')
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  assert.ok(response.headers.get('x-request-id'))
  assert.equal(response.headers.get('set-cookie'), null)
})

test('UC9 BFF forwards only normalized supported filter, page and sort values', async () => {
  const f = fixture()
  f.controls.upstream = () => Response.json({ ...body(), pagination: { page: 2, pageSize: 1, total: 1, totalPages: 1 } })
  assert.equal((await f.request({ query: '?status=waiting&page=2&pageSize=1&sort=desc' })).status, 200)
  const call = f.calls.find(value => value.operation === 'fetch')
  assert.deepEqual(Object.fromEntries(call.url.searchParams), { status: 'ASSIGNED', page: '2', pageSize: '1', sort: 'desc' })
})

test('UC9 BFF rejects impersonation, unsupported and repeated query inputs before upstream access', async () => {
  for (const query of ['?employeeId=2', '?userId=2', '?url=http://localhost:4003/internal/v1', '?search=clean', '?page=1&page=2', '?pageSize=101']) {
    const f = fixture(), response = await f.request({ query })
    assert.equal(response.status, 400)
    assert.equal((await response.json()).error.code, 'VALIDATION_ERROR')
    assert.equal(f.calls.some(value => value.operation === 'fetch'), false)
  }
})

test('UC9 BFF rejects wrong methods and exact Origin/Host/fetch-site violations', async () => {
  for (const input of [{ method: 'POST' }, { url: 'http://localhost:3003/api/staff/jobs' }, { headers: { Host: 'localhost:3001' } }, { headers: { Origin: 'http://localhost:3001' } }, { headers: { Origin: 'http://localhost:3003' } }, { headers: { Origin: 'null' } }, { headers: { 'Sec-Fetch-Site': 'cross-site' } }, { headers: { 'Sec-Fetch-Site': 'same-site' } }]) {
    const f = fixture(), response = await f.request(input)
    assert.equal(response.status, input.method ? 405 : 403)
    assert.equal(f.calls.some(value => value.operation === 'fetch'), false)
  }
})

test('UC9 BFF accepts an explicit same-origin request', async () => {
  const f = fixture()
  assert.equal((await f.request({ headers: { Origin: origin, 'Sec-Fetch-Site': 'same-origin', Host: 'localhost:3002' } })).status, 200)
})

test('UC9 BFF refuses absent, malformed, repeated and unknown session cookies', async () => {
  for (const cookie of [undefined, 'cleanhome_staff_session=short', 'cleanhome_staff_session=' + sid(), 'cleanhome_staff_session=' + sid() + '; cleanhome_staff_session=' + sid()]) {
    const f = fixture(), response = await f.request({ headers: { Cookie: cookie } })
    assert.equal(response.status, 401)
    assert.equal(f.calls.some(value => value.operation === 'fetch'), false)
    assert.match(response.headers.get('set-cookie'), /^cleanhome_staff_session=; Path=\/; HttpOnly; SameSite=Lax; Max-Age=0$/)
    assert.equal(response.headers.get('www-authenticate'), 'Session')
  }
})

test('UC9 BFF preserves secure expiry-cookie attributes for HTTPS sessions', async () => {
  const f = fixture()
  f.config.appOrigin = 'https://staff.cleanhome.test'
  f.config.secureCookie = true
  const response = await f.handle(new Request(f.config.appOrigin + '/api/staff/jobs'))
  assert.equal(response.status, 401)
  assert.match(response.headers.get('set-cookie'), /; Secure$/)
})

test('UC9 auth expiry and denial fail closed, revoke the session and never fetch jobs', async () => {
  for (const [status, code] of [[401, 'SESSION_EXPIRED'], [403, 'ACCESS_DENIED']]) {
    const f = fixture()
    f.controls.authError = new AuthBffError(status, code, 'Phiên không hợp lệ.')
    const response = await f.request()
    assert.equal(response.status, status)
    assert.ok(f.calls.some(value => value.operation === 'logout' && value.sid === f.sessionId))
    assert.equal(f.calls.some(value => value.operation === 'fetch'), false)
    assert.match(response.headers.get('set-cookie'), /Max-Age=0/)
  }
})

test('UC9 Auth dependency outage retains the encrypted session and returns no jobs', async () => {
  const f = fixture()
  f.controls.authError = new AuthBffError(503, 'AUTH_UNAVAILABLE', 'Chưa thể xác minh phiên.')
  const response = await f.request()
  assert.equal(response.status, 503)
  assert.equal(response.headers.get('set-cookie'), null)
  assert.equal(f.calls.some(value => ['fetch', 'logout'].includes(value.operation)), false)
  assert.equal((await response.json()).data, undefined)
})

test('UC9 Staff authentication and authorization failures invalidate only this frontend session', async () => {
  for (const [status, upstreamCode, expected] of [[401, 'UNAUTHENTICATED', 'SESSION_EXPIRED'], [403, 'STAFF_INACTIVE', 'STAFF_ACCESS_DENIED']]) {
    const f = fixture()
    f.controls.upstream = () => Response.json({ error: { code: upstreamCode, message: 'unit-double-sensitive-upstream-detail', details: { token: 'unit-double-sensitive-field' } } }, { status })
    const response = await f.request(), result = await response.json()
    assert.equal(response.status, status)
    assert.equal(result.error.code, expected)
    assert.match(response.headers.get('set-cookie'), /Max-Age=0/)
    assert.ok(f.calls.some(value => value.operation === 'logout' && value.sid === f.sessionId))
    assert.equal(JSON.stringify(result).includes('unit-double-sensitive'), false)
  }
})

test('UC9 upstream failures and rate limiting are sanitized and never revoke a valid session', async () => {
  for (const [status, code] of [[500, 'STAFF_UNAVAILABLE'], [503, 'STAFF_UNAVAILABLE'], [404, 'STAFF_INVALID_RESPONSE'], [429, 'STAFF_RATE_LIMITED'], [400, 'VALIDATION_ERROR']]) {
    const f = fixture()
    f.controls.upstream = () => Response.json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'unit-double-sensitive-field' } }, { status, headers: { 'Retry-After': '12' } })
    const response = await f.request(), result = await response.json()
    assert.equal(response.status, status >= 500 ? 503 : status === 404 ? 502 : status)
    assert.equal(result.error.code, code)
    assert.equal(JSON.stringify(result).includes('unit-double-sensitive'), false)
    assert.equal(response.headers.get('set-cookie'), null)
    assert.equal(f.calls.filter(value => value.operation === 'fetch').length, 1)
    assert.equal(f.calls.some(value => value.operation === 'logout'), false)
  }
})

test('UC9 rejects non-JSON, invalid DTO and oversized successful responses', async () => {
  for (const upstream of [() => new Response('<html>not JSON</html>', { headers: { 'Content-Type': 'text/html' } }), () => new Response('{', { headers: { 'Content-Type': 'application/json' } }), () => Response.json({ ...body(), timezone: 'UTC' }), () => Response.json(body(), { headers: { 'Content-Length': '1048577' } }), () => new Response(' '.repeat(1048577), { headers: { 'Content-Type': 'application/json' } })]) {
    const f = fixture()
    f.controls.upstream = upstream
    const response = await f.request()
    assert.equal(response.status, 502)
    assert.equal((await response.json()).error.code, 'STAFF_INVALID_RESPONSE')
    assert.equal(response.headers.get('set-cookie'), null)
  }
})

test('UC9 network and redirect failure do not leak upstream errors or retry', async () => {
  const f = fixture()
  f.controls.fetchError = new TypeError('unit-double-sensitive-field')
  const response = await f.request(), result = await response.json()
  assert.equal(response.status, 503)
  assert.equal(result.error.code, 'STAFF_UNAVAILABLE')
  assert.equal(JSON.stringify(result).includes('unit-double-sensitive'), false)
  assert.equal(f.calls.filter(value => value.operation === 'fetch').length, 1)
})

test('UC9 applies a finite timeout to an unresponsive upstream', { timeout: 2000 }, async () => {
  const f = fixture()
  f.config.jobsTimeoutMs = 100
  f.controls.upstream = async (_url, init) => await new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
  })
  const response = await f.request()
  assert.equal(response.status, 503)
  assert.equal((await response.json()).error.code, 'STAFF_UNAVAILABLE')
  assert.equal(f.calls.filter(value => value.operation === 'fetch').length, 1)
})

// Real encrypted session-store regressions. Auth below is explicitly a unit
// double using a test-only RS256 key; no live account or MySQL is accessed.
const unitKeys = generateKeyPairSync('rsa', { modulusLength: 2048 })
async function sessionFixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'cleanhome-staff-jobs-unit-'))
  const user = { id: '9109002', role: 'EMPLOYEE', status: 'ACTIVE' }
  const clock = { value: Date.now() }, controls = { introspectionStatus: 200, calls: 0 }
  const config = loadStaffAuthConfig({ STAFF_SESSION_DIR: path.join(directory, 'sessions'), STAFF_SESSION_KEY_FILE: path.join(directory, 'key'), STAFF_SESSION_MAX_AGE_SECONDS: '2' }, directory)
  await writeFile(config.keyFile, randomBytes(32), { mode: 0o600 })
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'unit-jobs' })).toString('base64url')
  const claims = Buffer.from(JSON.stringify({ sub: user.id, userId: user.id, role: 'EMPLOYEE', status: 'ACTIVE', active: true, locked: false, iss: 'unit-auth', aud: 'unit-staff', iat: Math.floor(clock.value / 1000), exp: Math.floor(clock.value / 1000) + 900, jti: 'unit-jobs-only' })).toString('base64url')
  const signature = sign('RSA-SHA256', Buffer.from(header + '.' + claims), unitKeys.privateKey).toString('base64url')
  const unitToken = header + '.' + claims + '.' + signature
  const fetchImpl = async (url, init) => {
    if (new URL(url).pathname === '/api/v1/auth/login') return Response.json({ accessToken: unitToken, tokenType: 'Bearer', expiresIn: 900, user })
    controls.calls++
    if (controls.introspectionStatus !== 200) return Response.json({ error: { code: 'UNAUTHENTICATED' } }, { status: controls.introspectionStatus })
    const incoming = new Headers(init.headers).get('authorization')?.replace(/^Bearer /, '') || ''
    const parts = incoming.split('.')
    assert.equal(verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), unitKeys.publicKey, Buffer.from(parts[2] || '', 'base64url')), true)
    return Response.json({ sub: user.id, userId: user.id, role: user.role, status: user.status, active: true, locked: false })
  }
  const auth = createStaffAuth({ config, fetchImpl, now: () => clock.value })
  t.after(async () => {
    const absolute = path.resolve(directory), temporary = path.resolve(os.tmpdir()) + path.sep
    assert.equal(absolute.startsWith(temporary), true)
    assert.equal(path.basename(absolute).startsWith('cleanhome-staff-jobs-unit-'), true)
    await rm(absolute, { recursive: true, force: true })
  })
  const login = await auth.login({ phone: 'TEST-UNIT-EMPLOYEE', password: 'unit-only-password' })
  return { auth, login, config, clock, controls, unitToken }
}

test('UC9 server capability supplies the token only to its callback without rewriting a valid encrypted session', async t => {
  const f = await sessionFixture(t), [name] = await readdir(f.config.sessionDir)
  const before = await readFile(path.join(f.config.sessionDir, name))
  const result = await f.auth.withAccessToken(f.login.sid, async token => {
    assert.equal(token === f.unitToken, true)
    return body()
  })
  assert.deepEqual(result, body())
  assert.equal(JSON.stringify(f.login.session).includes(f.unitToken), false)
  assert.equal(before.includes(Buffer.from(f.unitToken)), false)
  assert.deepEqual(await readFile(path.join(f.config.sessionDir, name)), before)
})

test('UC9 server capability never invokes upstream work for missing or invalid session IDs', async t => {
  const f = await sessionFixture(t)
  for (const value of [undefined, '../invalid', '_'.repeat(43), sid()]) {
    let called = false
    await assert.rejects(f.auth.withAccessToken(value, async () => { called = true }), { status: 401 })
    assert.equal(called, false)
  }
})

test('UC9 server capability discards fetched results if logout occurs while loading', async t => {
  const f = await sessionFixture(t)
  await assert.rejects(f.auth.withAccessToken(f.login.sid, async () => {
    await f.auth.logout(f.login.sid)
    return body()
  }), { status: 401, code: 'SESSION_EXPIRED' })
  assert.equal((await readdir(f.config.sessionDir)).length, 0)
})

test('UC9 server capability discards fetched results if the frontend session expires while loading', async t => {
  const f = await sessionFixture(t)
  await assert.rejects(f.auth.withAccessToken(f.login.sid, async () => {
    f.clock.value += 3000
    return body()
  }), { status: 401, code: 'SESSION_EXPIRED' })
})

test('UC9 server capability refuses introspection denial before invoking the Staff request', async t => {
  for (const status of [401, 403]) {
    const f = await sessionFixture(t)
    f.controls.introspectionStatus = status
    let called = false
    await assert.rejects(f.auth.withAccessToken(f.login.sid, async () => { called = true }), { status })
    assert.equal(called, false)
    assert.equal((await readdir(f.config.sessionDir)).length, 0)
  }
})

test('UC9 server capability preserves a session during Auth outage and resumes after recovery', async t => {
  const f = await sessionFixture(t)
  f.controls.introspectionStatus = 503
  let called = false
  await assert.rejects(f.auth.withAccessToken(f.login.sid, async () => { called = true }), { status: 503, code: 'AUTH_UNAVAILABLE' })
  assert.equal(called, false)
  assert.equal((await readdir(f.config.sessionDir)).length, 1)
  f.controls.introspectionStatus = 200
  assert.deepEqual(await f.auth.withAccessToken(f.login.sid, async () => body()), body())
})

test('UC9 server capability propagates a Staff failure without deleting or extending the session', async t => {
  const f = await sessionFixture(t)
  await assert.rejects(f.auth.withAccessToken(f.login.sid, async () => {
    throw new AuthBffError(503, 'STAFF_UNAVAILABLE', 'Unit dependency unavailable')
  }), { status: 503, code: 'STAFF_UNAVAILABLE' })
  assert.deepEqual(await f.auth.inspect(f.login.sid), f.login.session)
})
