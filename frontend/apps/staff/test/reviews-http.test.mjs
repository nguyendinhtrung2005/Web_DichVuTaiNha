import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { createStaffReviewsHttp } from '../lib/server/reviews-http.mjs'
import { AuthBffError } from '../lib/server/auth-core.mjs'
import { parseReviewsPayload, parseReviewsQuery } from '../../../packages/ui/src/components/staff/staff-reviews-contract.mjs'

const origin = 'http://localhost:3002', search = '?from=2026-11-01&to=2026-11-30'
const query = parseReviewsQuery(new URLSearchParams(search))
function payload(data = [{ id: 'review-1', rating: 5, createdAt: '2026-11-05T02:00:00.000Z', comment: '<script>unit test</script>', serviceLabel: 'Dọn nhà', customerEmail: 'private@example.invalid', bookingId: 'private-booking' }]) {
  return { schemaVersion: 'STAFF_REVIEWS_V1', timezone: 'Asia/Ho_Chi_Minh', range: { from: '2026-11-01', to: '2026-11-30' }, filter: { rating: null },
    data, pagination: { page: 1, pageSize: 10, total: data.length, totalPages: data.length ? 1 : 0 },
    summary: { total: data.length, average: data.length ? 5 : null, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: data.length } } }
}
function fixture({ enabled = true } = {}) {
  const sid = randomBytes(32).toString('base64url'), calls = [], controls = { error: null, account: '101', upstream: () => Response.json(payload()) }
  const config = { appOrigin: origin, cookieName: 'cleanhome_staff_session', staffUrl: 'http://127.0.0.1:4005', secureCookie: false, jobsTimeoutMs: 100 }
  const auth = {
    async inspect(value) { if (value !== sid) throw new AuthBffError(401, 'SESSION_REQUIRED', 'Đăng nhập.'); return { user: { id: controls.account, role: 'EMPLOYEE' } } },
    async withAccessToken(value, callback) { if (controls.error) throw controls.error; if (value !== sid) throw new AuthBffError(401, 'SESSION_REQUIRED', 'Đăng nhập.'); return callback('unit-server-only-bearer') },
    async logout() { calls.push('logout') },
  }
  const handle = createStaffReviewsHttp({ configFactory: () => config, authFactory: () => auth, env: { STAFF_REVIEWS_API_ENABLED: enabled ? 'true' : 'false' }, fetchImpl: async (url, init) => { calls.push({ url: new URL(url), init }); return controls.upstream(url, init) } })
  const request = ({ url = origin + '/api/staff/reviews' + search, method = 'GET', headers = {}, signal } = {}) => handle(new Request(url, { method, signal, headers: { Cookie: config.cookieName + '=' + sid, ...headers } }))
  return { request, calls, controls }
}

test('reviews BFF reads fixed current-employee endpoint and strips private fields', async () => {
  const f = fixture(), response = await f.request({ headers: { 'X-Staff-Account-Id': '101' } })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.data[0].comment, '<script>unit test</script>')
  assert.equal(JSON.stringify(body).includes('private'), false)
  assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0')
  const call = f.calls[0]
  assert.equal(call.url.pathname, '/api/v1/staff/me/reviews')
  assert.deepEqual(Object.fromEntries(call.url.searchParams), { from: '2026-11-01', to: '2026-11-30', page: '1', pageSize: '10' })
  assert.equal(call.init.headers.Authorization, 'Bearer unit-server-only-bearer')
  assert.equal(call.init.redirect, 'error')
})
test('disabled Review API never calls upstream but still requires a Staff session', async () => {
  const f = fixture({ enabled: false })
  assert.equal((await f.request()).status, 503); assert.equal(f.calls.length, 0)
  assert.equal((await f.request({ headers: { Cookie: '' } })).status, 401)
  assert.deepEqual(f.calls, ['logout'])
})
test('cross-account responses, foreign origins and arbitrary employee parameters fail before upstream', async () => {
  for (const options of [
    { headers: { 'X-Staff-Account-Id': '102' } }, { headers: { Origin: 'https://foreign.invalid' } },
    { headers: { 'Sec-Fetch-Site': 'cross-site' } }, { url: origin + '/api/staff/reviews' + search + '&employeeId=102' },
  ]) { const f = fixture(); assert.ok([400, 403, 409].includes((await f.request(options)).status)); assert.equal(f.calls.length, 0) }
})
test('upstream access denied expires local session and does not expose upstream body', async () => {
  const f = fixture(); f.controls.upstream = () => new Response('private token', { status: 403 })
  const response = await f.request()
  assert.equal(response.status, 403); assert.match(response.headers.get('set-cookie'), /Max-Age=0/)
  assert.equal(f.calls.at(-1), 'logout'); assert.doesNotMatch(await response.text(), /private token/)
})
test('empty reviews preserve null average and no invented rating', async () => {
  const f = fixture(); f.controls.upstream = () => Response.json(payload([]))
  const response = await f.request(); assert.equal(response.status, 200)
  const body = await response.json(); assert.equal(body.summary.average, null); assert.equal(body.summary.total, 0); assert.deepEqual(body.data, [])
})
test('unimplemented, malformed, oversized and timed-out Review APIs fail explicitly', async () => {
  for (const [upstream, status, code] of [
    [() => new Response(null, { status: 404 }), 503, 'REVIEWS_NOT_AVAILABLE'],
    [() => Response.json({ ...payload(), summary: { total: 1, average: 4.9, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 1 } } }), 502, 'STAFF_INVALID_RESPONSE'],
    [() => new Response('a'.repeat(262145), { headers: { 'content-type': 'application/json' } }), 502, 'STAFF_INVALID_RESPONSE'],
    [(_url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('Timeout', 'AbortError')), { once: true })), 503, 'REVIEWS_UNAVAILABLE'],
  ]) {
    const f = fixture(); f.controls.upstream = upstream
    const response = await f.request(); assert.equal(response.status, status); assert.equal((await response.json()).error.code, code)
  }
})
test('review contract rejects invalid filters, duplicate rows, incorrect bounds and summary', () => {
  for (const suffix of ['&rating=0', '&rating=5&rating=5', '&page=0', '&from=2026-11-01']) assert.equal(parseReviewsQuery(new URLSearchParams(search + suffix)), null)
  assert.equal(parseReviewsQuery(new URLSearchParams('from=2026-02-30&to=2026-03-01')), null)
  const duplicate = payload([payload().data[0], payload().data[0]])
  assert.equal(parseReviewsPayload(duplicate, query), null)
  const outside = payload(); outside.data[0].createdAt = '2026-10-31T16:59:59.999Z'
  assert.equal(parseReviewsPayload(outside, query), null)
  const wrongPage = payload(); wrongPage.pagination.pageSize = 100
  assert.equal(parseReviewsPayload(wrongPage, query), null)
  const noRows = payload([]); noRows.summary.average = 0
  assert.equal(parseReviewsPayload(noRows, query), null)
})

test('review response bodies that never close time out and cancel their stream', async () => {
  const f = fixture(); let cancelled = false
  f.controls.upstream = () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{')) }, cancel() { cancelled = true } }), { headers: { 'content-type': 'application/json' } })
  const response = await f.request()
  assert.equal(response.status, 503); assert.equal(cancelled, true)
})

test('client cancellation aborts the upstream body read', async () => {
  const f = fixture(), controller = new AbortController(); let cancelled = false
  f.controls.upstream = () => new Response(new ReadableStream({ start(stream) { stream.enqueue(new TextEncoder().encode('{')); setTimeout(() => controller.abort(), 10) }, cancel() { cancelled = true } }), { headers: { 'content-type': 'application/json' } })
  const response = await f.request({ signal: controller.signal })
  assert.equal(response.status, 503); assert.equal(cancelled, true)
})
