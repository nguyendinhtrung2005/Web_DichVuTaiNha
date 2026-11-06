import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
const require = createRequire(import.meta.url), ts = require('typescript'), cache = new Map()
const root = new URL('../../../packages/ui/src/components/staff/', import.meta.url)
function source(name) {
  if (cache.has(name)) return cache.get(name)
  const filename = fileURLToPath(new URL(name + '.ts', root)), module = { exports: {} }
  cache.set(name, module.exports)
  vm.runInNewContext(ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText,
    { module, exports: module.exports, URLSearchParams, TextDecoder, Uint8Array, Response, require(id) {
      if (id.startsWith('./staff-')) return source(id.slice(2))
      throw Error('Unexpected dependency')
    } }, { filename, timeout: 2000 })
  return module.exports
}
const { dashboardPeriods, readStaffDashboard, upcomingDashboardPreview } = source('staff-dashboard-model')
const copy = x => JSON.parse(JSON.stringify(x)), day = '2026-10-28'
const job = (id, status = 'WAITING', start = '2026-10-29T02:00:00.000Z', end = '2026-10-29T04:00:00.000Z') => ({
  id, assignmentId: id, orderId: '100', jobCode: null, orderCode: null, status,
  databaseStatus: status === 'WAITING' ? 'ASSIGNED' : status,
  jobStatus: ({ WAITING: 'waiting', ACCEPTED: 'accepted', IN_PROGRESS: 'in_progress', DONE: 'done', CANCELLED: null })[status],
  orderStatus: null, scheduledAt: start, expectedEndAt: end, durationMinutes: 120,
  contact: { name: 'Unit only', address: 'Unit only' }, services: [],
  checkInAt: null, checkOutAt: null, assignedAt: null,
})
const payload = (data, pageSize = 4, total = data.length) => ({ data, pagination: { page: 1, pageSize, total, totalPages: Math.ceil(total / pageSize) }, timezone: 'Asia/Ho_Chi_Minh' })
function upstream(overrides = {}) {
  const calls = []
  const fn = async (url, options) => {
    calls.push({ url, options })
    const parsed = new URL(url, 'http://localhost'), q = parsed.searchParams, status = q.get('status')
    const patch = await overrides.response?.(parsed)
    if (patch) return patch
    if (parsed.pathname.endsWith('/jobs')) return Response.json(payload([job('50', status)], 1, status === 'DONE' ? 123456 : status === 'WAITING' ? 211 : 7))
    if (q.get('from') === day) return Response.json(payload(Array.from({ length: 4 }, (_, i) => job(String(80 + i), 'CANCELLED', '2026-10-27T16:30:00.000Z', '2026-10-28T01:00:00.000Z')), 4, 20))
    const id = ({ WAITING: '2', ACCEPTED: '10', IN_PROGRESS: '20' })[status]
    return Response.json(payload(Array.from({ length: 4 }, (_, i) => job(String(Number(id) + i), status)), 4, 25))
  }
  return { fn, calls }
}
test('dashboard period is tomorrow through +30 days across leap/year boundaries', () => {
  assert.deepEqual(copy(dashboardPeriods(day)), { today: day, upcoming: { from: '2026-10-29', to: '2026-11-27' } })
  assert.deepEqual(copy(dashboardPeriods('2024-02-29').upcoming), { from: '2024-03-01', to: '2024-03-30' })
  assert.deepEqual(copy(dashboardPeriods('2026-12-31').upcoming), { from: '2027-01-01', to: '2027-01-30' })
  assert.equal(dashboardPeriods('2099-12-31').upcoming, null)
  assert.deepEqual(copy(dashboardPeriods('2099-12-30').upcoming), { from: '2099-12-31', to: '2099-12-31' })
  for (const value of ['2026-02-30', '1970-12-31', '2100-01-01', '']) assert.throws(() => dashboardPeriods(value))
})
test('large exact totals come from pagination, never the one returned row', async () => {
  const api = upstream(), result = await readStaffDashboard(day, new AbortController().signal, api.fn)
  assert.equal(result.waiting.data.pagination.total, 211); assert.equal(result.progress.data.pagination.total, 7)
  assert.equal(result.done.data.pagination.total, 123456); assert.equal(result.done.data.data.length, 1)
  assert.equal(result.today.data.pagination.total, 20); assert.equal(result.today.data.data[0].status, 'CANCELLED')
  assert.equal(api.calls.length, 7); assert.equal(result.accessDenied, false)
  assert.ok(api.calls.every(({ url, options }) => url.startsWith('/api/staff/') && options.method === 'GET' && options.credentials === 'same-origin' && !new URL(url, 'http://localhost').searchParams.has('userId')))
})
test('upcoming preview merges active first pages with numeric BIGINT tie breaking', () => {
  const lists = [payload([job('10'), job('9007199254740993')]), payload([job('2', 'ACCEPTED'), job('9007199254740992', 'ACCEPTED')]), payload([job('3', 'IN_PROGRESS')])]
  const frozen = copy(lists)
  assert.deepEqual(copy(upcomingDashboardPreview(lists).map(x => x.assignmentId)), ['2', '3', '10', '9007199254740992'])
  assert.deepEqual(lists, frozen)
})
test('overlap work that began before the upcoming range is retained, without a false combined total', async () => {
  const api = upstream({ response: u => u.pathname.endsWith('/schedule') && u.searchParams.get('status') === 'ACCEPTED'
    ? Response.json(payload([job('11', 'ACCEPTED', '2026-10-28T10:00:00.000Z', '2026-10-29T03:00:00.000Z')])) : null })
  const result = await readStaffDashboard(day, new AbortController().signal, api.fn)
  assert.equal(result.upcoming.data[0].assignmentId, '11')
  assert.equal('total' in result.upcoming, false)
})
test('duplicate across independent status reads requests refresh instead of silently counting twice', async () => {
  const api = upstream({ response: u => u.pathname.endsWith('/schedule') && u.searchParams.get('status')
    ? Response.json(payload([job('2', u.searchParams.get('status'))])) : null })
  const result = await readStaffDashboard(day, new AbortController().signal, api.fn)
  assert.equal(result.upcoming.data, null); assert.match(result.upcoming.error, /vừa thay đổi/)
  assert.equal(result.waiting.data.pagination.total, 211)
})
test('partial failure never substitutes zero for an unavailable counter or preview', async () => {
  const api = upstream({ response: u => u.searchParams.get('status') === 'DONE' || u.pathname.endsWith('/schedule') && u.searchParams.get('status') === 'ACCEPTED'
    ? Response.json({ error: { code: 'UNAVAILABLE' } }, { status: 503 }) : null })
  const result = await readStaffDashboard(day, new AbortController().signal, api.fn)
  assert.equal(result.done.data, null); assert.ok(result.done.error); assert.equal(result.upcoming.data, null)
  assert.equal(result.progress.data.pagination.total, 7); assert.equal(result.accessDenied, false)
})
test('real authentication error categories are preserved for Provider session checking', async () => {
  for (const status of [401, 403]) {
    const result = await readStaffDashboard(day, new AbortController().signal, async () => Response.json({}, { status }))
    assert.equal(result.accessDenied, true); assert.equal(result.today.data, null)
    assert.equal(result.waiting.data, null); assert.equal(result.upcoming.data, null)
  }
})
test('DTO page/timezone/status mismatches remain unavailable while other blocks load', async () => {
  for (const bad of [{ timezone: 'UTC' }, { pagination: { page: 2, pageSize: 4, total: 0, totalPages: 0 } }]) {
    const api = upstream({ response: u => u.pathname.endsWith('/schedule') && !u.searchParams.has('status') ? Response.json({ ...payload([]), ...bad }) : null })
    const result = await readStaffDashboard(day, new AbortController().signal, api.fn)
    assert.equal(result.today.data, null); assert.equal(result.done.data.pagination.total, 123456)
  }
  const api = upstream({ response: u => u.pathname.endsWith('/jobs') && u.searchParams.get('status') === 'WAITING' ? Response.json(payload([job('1', 'DONE')], 1)) : null })
  const result = await readStaffDashboard(day, new AbortController().signal, api.fn)
  assert.equal(result.waiting.data, null)
})
test('empty preview is produced only by successful empty active partitions', async () => {
  const api = upstream({ response: u => u.pathname.endsWith('/schedule') && u.searchParams.has('status') ? Response.json(payload([])) : null })
  const result = await readStaffDashboard(day, new AbortController().signal, api.fn)
  assert.deepEqual(copy(result.upcoming), { data: [], error: null })
})
test('response size cap and abort do not leak arbitrary upstream payloads or retries', async () => {
  const huge = async () => new Response('x'.repeat(2097153), { headers: { 'Content-Type': 'application/json' } })
  const result = await readStaffDashboard(day, new AbortController().signal, huge)
  assert.equal(result.today.data, null); assert.ok(result.done.error)
  const controller = new AbortController(); controller.abort()
  let count = 0
  const aborted = await readStaffDashboard(day, controller.signal, async (_url, options) => { count++; options.signal.throwIfAborted() })
  assert.equal(count, 7); assert.equal(aborted.upcoming.data, null)
})


test('a delayed401 in another upcoming partition is not masked by an earlier503', async () => {
 const api = upstream({ response: async u => {
  if (!u.pathname.endsWith('/schedule')) return null
  if (u.searchParams.get('status') === 'WAITING') return Response.json({}, { status: 503 })
  if (u.searchParams.get('status') === 'ACCEPTED') { await new Promise(resolve => setTimeout(resolve, 20)); return Response.json({}, { status: 401 }) }
  return null
 } })
 const result = await readStaffDashboard(day, new AbortController().signal, api.fn)
 assert.equal(result.upcoming.data, null); assert.equal(result.accessDenied, true)
})
test('incomplete first schedule page is not rendered as an exact empty state', async () => {
 const api = upstream({ response: u => u.pathname.endsWith('/schedule') && !u.searchParams.has('status') ? Response.json(payload([], 4, 20)) : null })
 const result = await readStaffDashboard(day, new AbortController().signal, api.fn)
 assert.equal(result.today.data, null); assert.ok(result.today.error)
})
