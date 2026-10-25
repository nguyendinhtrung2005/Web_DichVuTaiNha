import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { createStaffAuthHttp } from '../lib/server/auth-http.mjs'
import { AuthBffError } from '../lib/server/auth-core.mjs'

const origin = 'http://localhost:3002'
const sid = () => randomBytes(32).toString('base64url')
function fixture() {
  const config = { appOrigin: origin, secureCookie: false, cookieName: 'cleanhome_staff_session' }
  const calls = []
  const controls = { failure: null, expiresAt: Date.now() + 60000 }
  const service = {
    async login(input, previous) {
      calls.push({ operation: 'login', input, previous })
      if (controls.failure) throw controls.failure
      return { sid: sid(), session: { user: { id: '9109002', role: 'EMPLOYEE', status: 'ACTIVE' }, expiresAt: new Date(controls.expiresAt).toISOString() } }
    },
    async inspect(value) {
      calls.push({ operation: 'inspect', value })
      if (controls.failure) throw controls.failure
      if (!value) throw new AuthBffError(401, 'SESSION_REQUIRED', 'Sign in required')
      return { user: { id: '9109002', role: 'EMPLOYEE', status: 'ACTIVE' }, expiresAt: new Date(controls.expiresAt).toISOString() }
    },
    async logout(value) { calls.push({ operation: 'logout', value }); if (controls.failure) throw controls.failure },
  }
  const handle = createStaffAuthHttp({ configFactory: () => config, authFactory: () => service })
  const request = (action = 'login', overrides = {}) => {
    const method = action === 'session' ? 'GET' : 'POST'
    const headers = { Origin: origin, ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}), ...overrides.headers }
    for (const [key, value] of Object.entries(headers)) if (value === undefined) delete headers[key]
    const init = { method, headers, ...(method === 'POST' ? { body: JSON.stringify(action === 'login' ? { phone: 'TEST-EMPLOYEE-UC9', password: ' untouched ' } : {}) } : {}), ...overrides, headers }
    return handle(new Request(origin + '/api/auth/' + action + (overrides.query || ''), init), action)
  }
  return { config, calls, controls, request, handle }
}

test('route login exposes only sanitized session and sets an opaque host-only HttpOnly Lax cookie', async () => {
  const f = fixture(), response = await f.request(), body = await response.json()
  assert.equal(response.status, 200)
  assert.deepEqual(Object.keys(body), ['session'])
  assert.deepEqual(body.session.user, { id: '9109002', role: 'EMPLOYEE', status: 'ACTIVE' })
  const cookie = response.headers.get('set-cookie')
  assert.match(cookie, /^cleanhome_staff_session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=[1-9]\d*$/)
  assert.equal(cookie.includes('Domain='), false)
  assert.equal(cookie.includes('Secure'), false)
  assert.equal(f.calls[0].input.password, ' untouched ')
  assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0')
  assert.equal(response.headers.get('vary'), 'Cookie')
  assert.ok(response.headers.get('x-request-id'))
})

test('HTTPS configuration adds Secure; expiry is bounded by the issued session', async () => {
  const f = fixture()
  f.config.appOrigin = 'https://staff.cleanhome.test'; f.config.secureCookie = true
  const response = await f.handle(new Request(f.config.appOrigin + '/api/auth/login', { method: 'POST', headers: { Origin: f.config.appOrigin, 'Content-Type': 'application/json' }, body: '{"phone":"x","password":"x"}' }), 'login')
  assert.equal(response.status, 200)
  assert.match(response.headers.get('set-cookie'), /; Secure$/)
  const age = Number(/Max-Age=(\d+)/.exec(response.headers.get('set-cookie'))[1])
  assert.ok(age > 0 && age <= 60)
})

for (const [label, headers] of [
  ['missing Origin', { Origin: undefined }],
  ['null Origin', { Origin: 'null' }],
  ['foreign Origin', { Origin: 'https://attacker.invalid' }],
  ['Customer port Origin', { Origin: 'http://localhost:3001' }],
  ['Admin port Origin', { Origin: 'http://localhost:3003' }],
  ['same-site fetch metadata', { 'Sec-Fetch-Site': 'same-site' }],
]) {
  test('write rejects ' + label + ' without touching a session', async () => {
    const f = fixture()
    for (const action of ['login', 'logout']) assert.equal((await f.request(action, { headers })).status, 403)
    assert.equal(f.calls.length, 0)
  })
}

test('Host and request URL must match the pinned Staff origin', async () => {
  const f = fixture()
  assert.equal((await f.request('login', { headers: { Host: 'localhost:3003' } })).status, 403)
  const request = new Request('http://localhost:3003/api/auth/login', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}' })
  assert.equal((await f.handle(request, 'login')).status, 403)
  assert.equal(f.calls.length, 0)
})

test('read rejects an explicit foreign Origin and does not introspect', async () => {
  const f = fixture()
  assert.equal((await f.request('session', { headers: { Origin: 'http://localhost:3001' } })).status, 403)
  assert.equal(f.calls.length, 0)
})

test('missing session returns structured 401 and expires only the Staff cookie', async () => {
  const f = fixture(), response = await f.request('session', { headers: { Origin: undefined } })
  assert.equal(response.status, 401)
  assert.equal((await response.json()).error.code, 'SESSION_REQUIRED')
  assert.match(response.headers.get('set-cookie'), /^cleanhome_staff_session=; Path=\/; HttpOnly; SameSite=Lax; Max-Age=0$/)
})

test('valid cookie session is checked without sending SID or JWT in JSON', async () => {
  const f = fixture(), value = sid()
  const response = await f.request('session', { headers: { Cookie: 'other_app=x; cleanhome_staff_session=' + value } })
  assert.equal(response.status, 200)
  assert.equal(f.calls[0].value, value)
  const body = await response.json()
  assert.equal(JSON.stringify(body).includes(value), false)
  assert.equal(response.headers.has('set-cookie'), false)
})

test('duplicate or malformed Staff cookies fail closed without choosing a credential', async () => {
  for (const value of ['cleanhome_staff_session=bad', 'cleanhome_staff_session=' + sid() + '; cleanhome_staff_session=' + sid(), 'cleanhome_staff_session=header.payload.signature']) {
    const f = fixture()
    assert.equal((await f.request('session', { headers: { Cookie: value } })).status, 401)
    assert.equal(f.calls[0].value, undefined)
  }
})

test('logout revokes the opaque server session and clears browser cookie', async () => {
  const f = fixture(), value = sid()
  const response = await f.request('logout', { headers: { Cookie: 'cleanhome_staff_session=' + value } })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { ok: true })
  assert.equal(f.calls[0].operation, 'logout')
  assert.equal(f.calls[0].value, value)
  assert.match(response.headers.get('set-cookie'), /Max-Age=0/)
})

test('login does not accept client role, user ID, URL or other proxy input', async () => {
  for (const extra of [{ role: 'ADMIN' }, { userId: '1' }, { url: 'http://internal.invalid' }]) {
    const f = fixture()
    const response = await f.request('login', { body: JSON.stringify({ phone: 'x', password: 'x', ...extra }) })
    assert.equal(response.status, 400); assert.equal(f.calls.length, 0)
  }
})

test('logout body and Auth route query are restricted', async () => {
  const f = fixture()
  assert.equal((await f.request('logout', { body: '{"url":"http://internal.invalid"}' })).status, 400)
  assert.equal((await f.request('login', { query: '?returnTo=https://attacker.invalid' })).status, 400)
  assert.equal(f.calls.length, 0)
})

test('invalid JSON, arrays, null, unsupported content type and oversized data are rejected', async () => {
  for (const [body, expected] of [['{bad', 400], ['[]', 400], ['null', 400], ['x'.repeat(8193), 413]]) {
    const f = fixture(); assert.equal((await f.request('login', { body })).status, expected); assert.equal(f.calls.length, 0)
  }
  const f = fixture()
  assert.equal((await f.request('login', { headers: { 'Content-Type': 'text/plain' } })).status, 415)
  assert.equal((await f.request('login', { headers: { 'Content-Length': '9000' } })).status, 413)
})

test('unknown routes/methods cannot become an arbitrary or Order internal proxy', async () => {
  const f = fixture()
  assert.equal((await f.handle(new Request(origin + '/api/auth/unknown'), 'unknown')).status, 404)
  assert.equal((await f.handle(new Request(origin + '/api/auth/login'), 'login')).status, 405)
  assert.equal(f.calls.length, 0)
})

test('authentication 403 revokes the session cookie but dependency errors preserve it', async () => {
  for (const [status, code] of [[403, 'ACCOUNT_LOCKED'], [503, 'AUTH_UNAVAILABLE'], [502, 'AUTH_INVALID_RESPONSE']]) {
    const f = fixture(); f.controls.failure = new AuthBffError(status, code, 'Safe message')
    const response = await f.request('session', { headers: { Cookie: 'cleanhome_staff_session=' + sid() } })
    assert.equal(response.status, status)
    assert.equal(response.headers.has('set-cookie'), status === 403)
  }
})

test('wrong login credentials do not revoke an existing cookie or expose passwords', async () => {
  const f = fixture(); f.controls.failure = new AuthBffError(401, 'INVALID_CREDENTIALS', 'Safe message')
  const response = await f.request()
  assert.equal(response.status, 401)
  assert.equal(response.headers.has('set-cookie'), false)
  assert.equal(JSON.stringify(await response.json()).includes('untouched'), false)
})

test('unexpected storage errors are sanitized and logout does not claim success', async () => {
  const f = fixture(); f.controls.failure = new Error('PRIVATE_SERVER_ERROR_SHOULD_NOT_LEAK')
  const response = await f.request('logout')
  assert.equal(response.status, 503)
  assert.equal(response.headers.has('set-cookie'), false)
  assert.equal(JSON.stringify(await response.json()).includes('PRIVATE_SERVER'), false)
  assert.equal(response.headers.get('retry-after'), '5')
})

test('rate limit delay is forwarded with a safe upper bound', async () => {
  const f = fixture(); f.controls.failure = new AuthBffError(429, 'LOGIN_RATE_LIMITED', 'Safe message', 99999)
  const response = await f.request()
  assert.equal(response.status, 429); assert.equal(response.headers.get('retry-after'), '3600')
})

test('a session already expired before cookie creation is not reported as a successful login', async () => {
  const f = fixture(); f.controls.expiresAt = Date.now() - 1000
  const response = await f.request()
  assert.equal(response.status, 503)
  assert.equal(response.headers.has('set-cookie'), false)
  assert.equal(f.calls.at(-1).operation, 'logout')
})
