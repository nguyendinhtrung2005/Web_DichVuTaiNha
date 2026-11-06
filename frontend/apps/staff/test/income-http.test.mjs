import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { createStaffIncomeHttp } from '../lib/server/income-http.mjs'
import { monthBounds, parseIncomeEstimate, parseIncomeQuery } from '../lib/server/income-contract.mjs'
import { AuthBffError } from '../lib/server/auth-core.mjs'

// Isolated request-wrapper tests with explicit auth/HTTP doubles.
// They are not evidence of real Staff HTTP, JWT verification or MySQL access.
const origin = 'http://localhost:3002'
const sid = () => randomBytes(32).toString('base64url')
const done = (overrides = {}) => ({
  id: '1', bookingId: '9', status: 'DONE',
  scheduledStart: '2026-11-05T02:00:00.000Z', scheduledEnd: '2026-11-05T04:00:00.000Z',
  checkInAt: '2026-11-05T02:05:00.000Z', checkOutAt: '2026-11-05T04:00:00.000Z',
  eligible: true, reason: null, ...overrides,
})
const missing = (overrides = {}) => done({
  id: '2', status: 'DONE', checkInAt: null, checkOutAt: null, eligible: false, reason: 'MISSING_CHECK_TIMES', ...overrides,
})
function payload(assignments = [done()]) {
  const eligible = assignments.filter(item => item.eligible).length
  const incomplete = assignments.filter(item => item.reason === 'MISSING_CHECK_TIMES' || item.reason === 'INVALID_CHECK_TIMES').length
  return {
    period: { month: '2026-11', from: '2026-11-01', to: '2026-11-30', timezone: 'Asia/Ho_Chi_Minh' },
    policy: { code: 'ESTIMATE_FOR_DEMO', unitPriceVnd: 60000, currency: 'VND', label: 'Tiền công dự kiến — chính sách minh họa 60.000đ/công việc' },
    counts: { assignments: assignments.length, eligible, incomplete, excluded: assignments.length - eligible - incomplete },
    estimateTotalVnd: eligible * 60000,
    assignments,
    payout: { status: 'NOT_INTEGRATED' },
    timezone: 'Asia/Ho_Chi_Minh',
  }
}

function fixture() {
  const config = { appOrigin: origin, secureCookie: false, cookieName: 'cleanhome_staff_session', staffUrl: 'http://127.0.0.1:4005', jobsTimeoutMs: 200 }
  const sessionId = sid()
  const calls = []
  const controls = { accountId: '9109002', authError: null, upstream: () => Response.json(payload()), fetchError: null }
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
  const env = { NODE_ENV: 'development', STAFF_INCOME_DEMO_ENABLED: 'true' }
  const handle = createStaffIncomeHttp({ env, configFactory: () => config, authFactory: () => auth, fetchImpl })
  const request = (overrides = {}) => {
    const headers = { Cookie: 'cleanhome_staff_session=' + sessionId, ...overrides.headers }
    for (const [key, value] of Object.entries(headers)) if (value === undefined) delete headers[key]
    return handle(new Request(overrides.url || origin + '/api/staff/income/estimate?month=2026-11', { method: overrides.method || 'GET', headers }))
  }
  return { config, sessionId, calls, controls, handle, request, env }
}

test('BFF reads only the fixed income route with a server-side bearer and one month', async () => {
  const f = fixture()
  const response = await f.request()
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), payload())
  const call = f.calls.find(value => value.operation === 'fetch')
  assert.equal(call.url.origin, 'http://127.0.0.1:4005')
  assert.equal(call.url.pathname, '/api/v1/staff/me/income/estimate')
  assert.deepEqual(Object.fromEntries(call.url.searchParams), { month: '2026-11' })
  const sent = new Headers(call.init.headers)
  assert.equal(sent.get('authorization'), 'Bearer unit-test-server-only-bearer')
  assert.equal(sent.get('cookie'), null)
  assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0')
  assert.equal(response.headers.get('vary'), 'Cookie')
})

test('BFF rejects unknown, repeated, missing and impersonating income parameters before auth', async () => {
  for (const query of ['', '?month=', '?month=2026-13', '?month=2026-1', '?month=1970-12', '?month=2100-01',
    '?month=2026-11&month=2026-12', '?month=2026-11&employeeId=9109004', '?month=2026-11&from=2026-11-01']) {
    const f = fixture()
    const response = await f.request({ url: origin + '/api/staff/income/estimate' + query })
    assert.equal(response.status, 400, query)
    assert.equal((await response.json()).error.code, 'VALIDATION_ERROR')
    assert.equal(f.calls.some(value => value.operation === 'fetch'), false)
  }
})

test('BFF rejects wrong methods, foreign origins and non-same-origin fetch metadata', async () => {
  for (const [input, expected] of [[{ method: 'POST' }, 405], [{ method: 'PATCH' }, 405],
    [{ url: 'http://localhost:3003/api/staff/income/estimate?month=2026-11' }, 403],
    [{ headers: { Host: 'localhost:3001' } }, 403], [{ headers: { Origin: 'http://localhost:3001' } }, 403],
    [{ headers: { 'Sec-Fetch-Site': 'cross-site' } }, 403]]) {
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

test('BFF rejects a stale account binding so staff A cannot read staff B income', async () => {
  const f = fixture()
  f.controls.accountId = '9109101'
  const response = await f.request({ headers: { 'X-Staff-Account-Id': '9109002' } })
  assert.equal(response.status, 409)
  assert.equal((await response.json()).error.code, 'STAFF_SESSION_CHANGED')
  assert.equal(f.calls.some(value => value.operation === 'fetch'), false)
})

test('BFF maps an over-limit period to 409 without any money, and outages to sanitized 503', async () => {
  const large = fixture()
  large.controls.upstream = () => Response.json({ error: { code: 'INCOME_RANGE_TOO_LARGE', message: 'unit-double-sensitive' } }, { status: 409 })
  const response = await large.request()
  assert.equal(response.status, 409)
  const body = await response.json()
  assert.equal(body.error.code, 'INCOME_RANGE_TOO_LARGE')
  assert.equal('estimateTotalVnd' in body, false)
  assert.equal(JSON.stringify(body).includes('unit-double-sensitive'), false)

  const down = fixture()
  down.controls.fetchError = new Error('unit-double-network-failure')
  const failed = await down.request()
  assert.equal(failed.status, 503)
  assert.equal(JSON.stringify(await failed.json()).includes('unit-double-network-failure'), false)
})

test('BFF refuses payloads whose total, counts or eligibility do not match the rows', async () => {
  const bad = [
    { ...payload(), estimateTotalVnd: 0 },
    { ...payload(), estimateTotalVnd: 120000 },
    { ...payload(), counts: { assignments: 1, eligible: 1, incomplete: 1, excluded: -1 } },
    { ...payload(), counts: { assignments: 2, eligible: 1, incomplete: 0, excluded: 1 } },
    { ...payload(), period: { ...payload().period, month: '2026-12' } },
    { ...payload(), payout: { status: 'PAID' } },
    { ...payload(), policy: { ...payload().policy, unitPriceVnd: 100000 } },
    { ...payload(), policy: { ...payload().policy, code: 'OFFICIAL_SALARY' } },
    { ...payload([done({ checkInAt: null })]), assignments: [done({ checkInAt: null, eligible: true, reason: null })] },
    { ...payload([done({ scheduledStart: '2026-12-01T02:00:00.000Z' })]) },
    { ...payload([done(), done()]) },
    { ...payload([done({ reason: 'STATUS_NOT_DONE' })]) },
  ]
  for (const body of bad) {
    const f = fixture()
    f.controls.upstream = () => Response.json(body)
    const response = await f.request()
    assert.equal(response.status, 502, JSON.stringify(body).slice(0, 80))
    assert.equal((await response.json()).error.code, 'STAFF_INVALID_RESPONSE')
  }
})

test('BFF accepts a valid period with incomplete DONE data and never forwards unknown money fields', async () => {
  const f = fixture()
  f.controls.upstream = () => Response.json({ ...payload([done(), missing()]), secret: 'x', salary: '999' })
  const body = await (await f.request()).json()
  assert.equal(body.counts.eligible, 1)
  assert.equal(body.counts.incomplete, 1)
  assert.equal(body.estimateTotalVnd, 60000)
  for (const key of ['secret', 'salary', 'revenue', 'commission']) assert.equal(key in body, false)
  for (const key of ['unitPrice', 'revenue', 'salary']) assert.equal(key in body.assignments[0], false)
})

test('contract validation is strict about months and the DEMO formula', () => {
  assert.deepEqual(parseIncomeQuery(new URLSearchParams('month=2026-11')), { month: '2026-11' })
  assert.deepEqual(monthBounds('2026-02'), { from: '2026-02-01', to: '2026-02-28', fromUtc: Date.UTC(2026, 1, 1) - 25200000, toUtc: Date.UTC(2026, 2, 1) - 25200000 })
  assert.equal(parseIncomeEstimate(payload([done(), missing()]), { month: '2026-11' }).estimateTotalVnd, 60000)
  assert.equal(parseIncomeEstimate(payload([done({ id: '3', status: 'ASSIGNED', checkInAt: null, checkOutAt: null, eligible: false, reason: 'STATUS_NOT_DONE' })]), { month: '2026-11' }).counts.excluded, 1)
  assert.throws(() => parseIncomeEstimate({ ...payload(), timezone: 'UTC' }, { month: '2026-11' }), error => error.status === 502)
  assert.throws(() => parseIncomeQuery(new URLSearchParams('month=2026-11&month=2026-11')), error => error.status === 400)
})


test('income BFF blocks the illustrative policy in production or when disabled without changing session', async () => {
 for(const env of [{NODE_ENV:'production',STAFF_INCOME_DEMO_ENABLED:'true'},{NODE_ENV:'development',STAFF_INCOME_DEMO_ENABLED:'false'}]){const f=fixture();Object.assign(f.env,env);const result=await f.request();assert.equal(result.status,503);assert.equal((await result.json()).error.code,'INCOME_POLICY_NOT_AVAILABLE');assert.equal(f.calls.some(c=>c.operation==='fetch'||c.operation==='logout'),false);assert.equal(result.headers.get('set-cookie'),null)}
})
