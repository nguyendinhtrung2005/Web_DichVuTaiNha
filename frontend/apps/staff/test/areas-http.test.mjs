import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { createStaffAreasHttp } from '../lib/server/areas-http.mjs'
import { parseAvailability, parseAvailabilityQuery, parseBranch } from '../lib/server/areas-contract.mjs'
import { AuthBffError } from '../lib/server/auth-core.mjs'

// Isolated request-wrapper tests with explicit auth/HTTP doubles.
// They are not evidence of real Staff HTTP, JWT verification or MySQL access.
const origin = 'http://localhost:3002'
const sid = () => randomBytes(32).toString('base64url')
const branch = { id: '9109003', name: '(TEST) Chi nhánh Staff UC9', addressText: '12 Lê Lợi, Quận 1', serviceArea: { districts: ['Quận 1'] }, latitude: '10.7769000', longitude: '106.7009000', status: 'ACTIVE' }
const branchBody = { data: branch, timezone: 'Asia/Ho_Chi_Minh' }
const window = { id: '31', startsAt: '2026-11-04T01:00:00.000Z', endsAt: '2026-11-04T05:00:00.000Z', status: 'AVAILABLE' }
const availabilityBody = { data: [window], range: { from: '2026-11-02', to: '2026-11-08', timezone: 'Asia/Ho_Chi_Minh' }, truncated: false, branchId: '9109003' }

test('branch contract preserves missing coordinates and boundaries without deriving them from its address', () => {
  const parsed = parseBranch({ ...branchBody, data: { ...branch, latitude: null, longitude: null, serviceArea: null } })
  assert.equal(parsed.data.addressText, branch.addressText)
  assert.equal(parsed.data.latitude, null)
  assert.equal(parsed.data.longitude, null)
  assert.equal(parsed.data.serviceArea, null)
})

function fixture() {
  const config = { appOrigin: origin, secureCookie: false, cookieName: 'cleanhome_staff_session', staffUrl: 'http://127.0.0.1:4005', jobsTimeoutMs: 200 }
  const sessionId = sid()
  const calls = []
  const controls = { accountId: '9109002', authError: null, upstream: () => Response.json(branchBody), fetchError: null }
  const auth = {
    async inspect(value) {
      calls.push({ operation: 'inspect', sid: value })
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
  const handle = createStaffAreasHttp({ configFactory: () => config, authFactory: () => auth, fetchImpl })
  const request = (overrides = {}) => {
    const headers = { Cookie: 'cleanhome_staff_session=' + sessionId, ...overrides.headers }
    for (const [key, value] of Object.entries(headers)) if (value === undefined) delete headers[key]
    return handle(new Request(overrides.url || origin + '/api/staff/branch', { method: overrides.method || 'GET', headers }))
  }
  return { config, sessionId, calls, controls, handle, request }
}

test('BFF reads only the fixed branch and availability routes with a server-side bearer', async () => {
  const f = fixture()
  const response = await f.request()
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), branchBody)
  const call = f.calls.find(value => value.operation === 'fetch')
  assert.equal(call.url.origin, 'http://127.0.0.1:4005')
  assert.equal(call.url.pathname, '/api/v1/staff/me/branch')
  assert.equal(call.init.method, 'GET')
  const sent = new Headers(call.init.headers)
  assert.equal(sent.get('authorization'), 'Bearer unit-test-server-only-bearer')
  assert.equal(sent.get('cookie'), null)
  assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0')
  assert.equal(response.headers.get('vary'), 'Cookie')

  const g = fixture()
  g.controls.upstream = () => Response.json(availabilityBody)
  const second = await g.request({ url: origin + '/api/staff/availability?from=2026-11-02&to=2026-11-08' })
  assert.equal(second.status, 200)
  const availabilityCall = g.calls.find(value => value.operation === 'fetch')
  assert.equal(availabilityCall.url.pathname, '/api/v1/staff/me/availability')
  assert.deepEqual(Object.fromEntries(availabilityCall.url.searchParams), { from: '2026-11-02', to: '2026-11-08' })
})

test('BFF rejects unknown, repeated and impersonating availability parameters before auth', async () => {
  for (const query of ['', '?from=2026-11-02', '?to=2026-11-08', '?from=2026-11-02&to=2026-11-08&employeeId=9109004', '?from=2026-11-02&from=2026-11-03&to=2026-11-08', '?from=2026-02-30&to=2026-03-02', '?from=2026-11-08&to=2026-11-02', '?from=2026-11-01&to=2027-01-03', '?from=2026-11-02&to=2026-11-08&branchId=1']) {
    const f = fixture()
    const response = await f.request({ url: origin + '/api/staff/availability' + query })
    assert.equal(response.status, 400, query)
    assert.equal((await response.json()).error.code, 'VALIDATION_ERROR')
    assert.equal(f.calls.some(value => value.operation === 'fetch'), false)
  }
  const f = fixture()
  assert.equal((await f.request({ url: origin + '/api/staff/branch?employeeId=1' })).status, 400)
})

test('BFF rejects wrong methods, foreign origins and non-same-origin fetch metadata', async () => {
  for (const [input, expected] of [[{ method: 'POST' }, 405], [{ method: 'PATCH' }, 405], [{ url: 'http://localhost:3003/api/staff/branch' }, 403], [{ headers: { Host: 'localhost:3001' } }, 403], [{ headers: { Origin: 'http://localhost:3001' } }, 403], [{ headers: { 'Sec-Fetch-Site': 'cross-site' } }, 403]]) {
    const f = fixture()
    const response = await f.request(input)
    assert.equal(response.status, expected, JSON.stringify(input))
    assert.equal(f.calls.some(value => value.operation === 'fetch'), false)
  }
})

test('BFF refuses absent and malformed sessions and revokes only this frontend session on 401/403', async () => {
  const missing = fixture()
  assert.equal((await missing.request({ headers: { Cookie: undefined } })).status, 401)
  assert.equal(missing.calls.some(value => value.operation === 'fetch'), false)
  for (const [status, expected] of [[401, 'SESSION_EXPIRED'], [403, 'STAFF_ACCESS_DENIED']]) {
    const f = fixture()
    f.controls.upstream = () => Response.json({ error: { code: 'STAFF_INACTIVE', message: 'unit-double-sensitive' } }, { status })
    const response = await f.request()
    assert.equal(response.status, status)
    assert.equal((await response.json()).error.code, expected)
    assert.match(response.headers.get('set-cookie'), /Max-Age=0/)
    assert.ok(f.calls.some(value => value.operation === 'logout' && value.sid === f.sessionId))
  }
})

test('BFF rejects a stale account binding so staff A cannot read staff B areas', async () => {
  const f = fixture()
  f.controls.accountId = '9109101'
  const response = await f.request({ headers: { 'X-Staff-Account-Id': '9109002' } })
  assert.equal(response.status, 409)
  assert.equal((await response.json()).error.code, 'STAFF_SESSION_CHANGED')
  assert.equal(f.calls.some(value => value.operation === 'fetch'), false)
})

test('BFF maps a missing branch to 404 and upstream outages to sanitized 503', async () => {
  const missing = fixture()
  missing.controls.upstream = () => Response.json({ error: { code: 'BRANCH_NOT_FOUND', message: 'unit-double-sensitive' } }, { status: 404 })
  const response = await missing.request()
  assert.equal(response.status, 404)
  assert.equal((await response.json()).error.code, 'BRANCH_NOT_FOUND')

  const down = fixture()
  down.controls.fetchError = new Error('unit-double-network-failure')
  const failed = await down.request()
  assert.equal(failed.status, 503)
  assert.equal(JSON.stringify(await failed.json()).includes('unit-double-network-failure'), false)
})

test('BFF refuses invalid branch and availability payloads', async () => {
  const badBranch = [
    { ...branchBody, timezone: 'UTC' },
    { ...branchBody, data: { ...branch, id: '0' } },
    { ...branchBody, data: { ...branch, latitude: 'abc' } },
    { ...branchBody, data: { ...branch, serviceArea: 'raw' } },
  ]
  for (const payload of badBranch) {
    const f = fixture()
    f.controls.upstream = () => Response.json(payload)
    const response = await f.request()
    assert.equal(response.status, 502, JSON.stringify(payload).slice(0, 60))
    assert.equal((await response.json()).error.code, 'STAFF_INVALID_RESPONSE')
  }
  const badAvailability = [
    { ...availabilityBody, range: { ...availabilityBody.range, from: '2026-11-01' } },
    { ...availabilityBody, branchId: '0' },
    { ...availabilityBody, truncated: true },
    { ...availabilityBody, data: [{ ...window, endsAt: window.startsAt }] },
    { ...availabilityBody, data: [window, window] },
    { ...availabilityBody, data: [{ ...window, startsAt: '2026-11-04 01:00:00' }] },
  ]
  for (const payload of badAvailability) {
    const f = fixture()
    f.controls.upstream = () => Response.json(payload)
    const response = await f.request({ url: origin + '/api/staff/availability?from=2026-11-02&to=2026-11-08' })
    assert.equal(response.status, 502, JSON.stringify(payload).slice(0, 60))
  }
})

test('BFF never forwards fields that the branch/availability tables do not have', async () => {
  const f = fixture()
  f.controls.upstream = () => Response.json({ ...branchBody, data: { ...branch, salary: '999', secret: 'x' } })
  const body = await (await f.request()).json()
  for (const key of ['salary', 'secret', 'revenue', 'commission']) assert.equal(key in body.data, false)
})

test('contract validation is strict about ranges, ids and statuses', () => {
  assert.deepEqual(parseAvailabilityQuery(new URLSearchParams('from=2026-11-02&to=2026-11-08')), { from: '2026-11-02', to: '2026-11-08' })
  assert.equal(parseBranch(branchBody).data.id, '9109003')
  assert.equal(parseAvailability(availabilityBody, { from: '2026-11-02', to: '2026-11-08' }).data[0].id, '31')
  assert.equal(parseAvailability({ ...availabilityBody, data: [{ ...window, status: null }] }, { from: '2026-11-02', to: '2026-11-08' }).data[0].status, null)
  assert.throws(() => parseAvailability({ ...availabilityBody, data: [{ ...window, status: 'x'.repeat(41) }] }, { from: '2026-11-02', to: '2026-11-08' }), error => error.status === 502)
})
