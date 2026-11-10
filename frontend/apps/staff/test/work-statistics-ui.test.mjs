import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'

const require = createRequire(import.meta.url), ts = require('typescript'), cache = new Map()
function source(name) {
  if (cache.has(name)) return cache.get(name)
  const filename = new URL('../../../packages/ui/src/components/staff/' + name + '.ts', import.meta.url), module = { exports: {} }
  vm.runInNewContext(ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText,
    { module, exports: module.exports, URL, URLSearchParams, TextDecoder, Uint8Array, Response, AbortController, DOMException, require(id) {
      if (id.startsWith('./staff-')) return source(id.slice(2))
      throw Error('Unexpected statistics dependency')
    } }, { timeout: 2000 })
  cache.set(name, module.exports)
  return module.exports
}
const m = source('staff-work-statistics-model'), plain = x => JSON.parse(JSON.stringify(x))
const range = { from: '2026-10-29', to: '2026-10-29' }, statuses = ['', 'WAITING', 'ACCEPTED', 'IN_PROGRESS', 'DONE', 'CANCELLED']
const signal = () => new AbortController().signal
const job = (status = 'DONE', start = '2026-10-29T02:00:00.000Z', end = '2026-10-29T04:00:00.000Z') => ({
  id: '9223372036854775807', assignmentId: '9223372036854775807', orderId: '9007199254740993',
  jobCode: null, orderCode: null, status, databaseStatus: status === 'WAITING' ? 'ASSIGNED' : status,
  jobStatus: ({ WAITING: 'waiting', ACCEPTED: 'accepted', IN_PROGRESS: 'in_progress', DONE: 'done', CANCELLED: null })[status],
  orderStatus: 'in_progress', scheduledAt: start, expectedEndAt: end, durationMinutes: 120,
  contact: { name: null, address: null }, services: [{ serviceId: '3', name: 'Unit service', quantity: '1.50', unit: 'giờ', unitPrice: '100.00' }],
  checkInAt: null, checkOutAt: null, assignedAt: null,
})
const payload = (total = 53, status = 'DONE') => ({ data: total ? [job(status)] : [], pagination: { page: 1, pageSize: 1, total, totalPages: total }, timezone: 'Asia/Ho_Chi_Minh' })
const read = (p, selected = 'DONE', selectedRange = range) => m.readStaffStatistic(selectedRange, selected, signal(), async () => Response.json(p))

test('statistics default period is the whole current Vietnam month across UTC, leap and year boundaries', () => {
  for (const [now, from, to] of [
    ['2026-10-31T16:59:59.000Z', '2026-10-01', '2026-10-31'],
    ['2026-10-31T17:00:00.000Z', '2026-11-01', '2026-11-30'],
    ['2026-12-31T17:00:00.000Z', '2027-01-01', '2027-01-31'],
    ['2024-02-28T17:00:00.000Z', '2024-02-01', '2024-02-29'],
  ]) assert.deepEqual(plain(m.defaultStaffStatisticsRange(new Date(now))), { from, to })
})

test('statistics URL accepts paired dates only, validates real days and rejects account selectors or duplicates', () => {
  assert.deepEqual(plain(m.parseStaffStatisticsLocation('from=2026-10-29&to=2026-10-29')), range)
  assert.deepEqual(plain(m.parseStaffStatisticsLocation('', new Date('2026-10-31T17:00:00.000Z'))), { from: '2026-11-01', to: '2026-11-30' })
  for (const search of [
    'from=2026-10-29', 'to=2026-10-29', 'from=&to=', 'from=2026-02-29&to=2026-03-01',
    'from=2026-11-01&to=2026-10-29', 'from=1970-12-31&to=1971-01-01', 'from=2099-12-31&to=2100-01-01',
    'from=2026-10-29&to=2026-10-29&from=2026-10-30', 'userId=2', 'employeeId=2', 'status=DONE',
    'page=2', 'search=unit', 'sort=desc', 'from=2026-10-29T00%3A00%3A00Z&to=2026-10-29',
  ]) assert.equal(m.parseStaffStatisticsLocation(search), null, search)
})

test('statistics ranges include both endpoints, accept 366 days and reject the next day', () => {
  for (const [from, to] of [['2024-01-01', '2024-12-31'], ['2026-01-01', '2027-01-01'], ['1971-01-01', '1971-01-01'], ['2099-12-31', '2099-12-31']]) {
    assert.deepEqual(plain(m.parseStaffStatisticsLocation('from=' + from + '&to=' + to)), { from, to })
  }
  for (const search of ['from=2024-01-01&to=2025-01-01', 'from=2026-01-01&to=2027-01-02']) assert.equal(m.parseStaffStatisticsLocation(search), null)
})

test('statistics and schedule deep links keep the selected range without inventing unsupported API filters', () => {
  const href = new URL(m.staffStatisticsHref(range), 'http://localhost')
  assert.equal(href.pathname, '/thong-ke-cong-viec')
  assert.deepEqual(Object.fromEntries(href.searchParams), range)
  for (const status of statuses) {
    const href = new URL(m.staffStatisticsScheduleHref(range, status), 'http://localhost'), params = href.searchParams
    assert.equal(href.pathname, '/lich-lam-viec')
    assert.equal(params.get('from'), range.from); assert.equal(params.get('to'), range.to)
    assert.equal(params.get('page'), '1'); assert.equal(params.get('pageSize'), '100'); assert.equal(params.get('sort'), 'asc')
    assert.equal(params.get('view'), 'list'); assert.equal(params.get('anchor'), range.from)
    assert.equal(params.get('status'), status || null)
    assert.deepEqual([...params.keys()].sort(), ['anchor', 'from', 'page', 'pageSize', 'sort', 'to', 'view', ...(status ? ['status'] : [])].sort())
  }
})

test('each statistic comes only from pagination.total using one authenticated read of the fixed schedule endpoint', async () => {
  for (const status of statuses) {
    const calls = [], abort = signal(), response = payload(123456, status || 'DONE')
    const result = await m.readStaffStatistic(range, status, abort, async (url, options) => { calls.push({ url, options }); return Response.json(response) })
    assert.equal(result, 123456); assert.equal(response.data.length, 1); assert.equal(calls.length, 1)
    const u = new URL(calls[0].url, 'http://localhost'), q = u.searchParams, options = calls[0].options
    assert.equal(u.pathname, '/api/staff/schedule')
    assert.equal(q.get('from'), range.from); assert.equal(q.get('to'), range.to); assert.equal(q.get('status'), status || null)
    assert.equal(q.get('page'), '1'); assert.equal(q.get('pageSize'), '1'); assert.equal(q.get('sort'), 'asc')
    assert.deepEqual([...q.keys()].sort(), ['from', 'page', 'pageSize', 'sort', 'to', ...(status ? ['status'] : [])].sort())
    assert.equal(options.method, 'GET'); assert.equal(options.credentials, 'same-origin'); assert.equal(options.cache, 'no-store')
    assert.equal(options.redirect, 'error'); assert.equal(options.signal, abort); assert.equal(options.body, undefined)
    assert.equal(options.headers.Authorization, undefined)
  }
})

test('zero is reported only for a successful empty response with total zero', async () => {
  assert.equal(await read(payload(0)), 0)
  const p = payload(53); p.data = []
  await assert.rejects(read(p), e => e.status === 502)
  const nonempty = payload(0); nonempty.data = [job()]
  await assert.rejects(read(nonempty), e => e.status === 502)
})

test('statistics rejects inconsistent page metadata, unsafe totals, wrong status and unsupported DTO rows', async () => {
  for (const corrupt of [
    p => { p.pagination.page = 2 }, p => { p.pagination.pageSize = 2 }, p => { p.pagination.totalPages = 1 },
    p => { p.pagination.total = -1 }, p => { p.pagination.total = 1.5 }, p => { p.pagination.total = Number.MAX_SAFE_INTEGER + 1 },
    p => { p.timezone = 'UTC' }, p => { p.data[0] = job('WAITING') }, p => { p.data.push(job()) },
    p => { p.data[0].assignmentId = 9007199254740992 }, p => { p.data[0].databaseStatus = 'ASSIGNED' },
  ]) {
    const p = payload(); corrupt(p)
    await assert.rejects(read(p), e => e.status === 502)
  }
})

test('schedule overlap honors Vietnam midnight; touching boundaries and invalid or missing intervals are rejected', async () => {
  for (const [start, end] of [
    ['2026-10-28T16:00:00.000Z', '2026-10-28T17:01:00.000Z'],
    ['2026-10-29T16:59:00.000Z', '2026-10-29T18:00:00.000Z'],
    ['2026-10-28T17:00:00.000Z', '2026-10-29T17:00:00.000Z'],
  ]) { const p = payload(); p.data[0] = job('DONE', start, end); assert.equal(await read(p), 53) }
  for (const [start, end] of [
    ['2026-10-28T16:00:00.000Z', '2026-10-28T17:00:00.000Z'],
    ['2026-10-29T17:00:00.000Z', '2026-10-29T18:00:00.000Z'],
    [null, '2026-10-29T04:00:00.000Z'], ['2026-10-29T02:00:00.000Z', null],
    ['2026-10-29T02:00:00.000Z', '2026-10-29T02:00:00.000Z'],
    ['2026-10-29T04:00:00.000Z', '2026-10-29T02:00:00.000Z'],
  ]) { const p = payload(); p.data[0] = job('DONE', start, end); await assert.rejects(read(p), e => e.status === 502) }
})

test('DONE is counted by appointment overlap even without checkout or with checkout outside the selected period', async () => {
  for (const checkout of [null, '2026-11-01T02:00:00.000Z']) {
    const p = payload(); p.data[0].checkOutAt = checkout; p.data[0].completedAt = 'unit-only-unapproved'; p.data[0].profile = 'unit-only-extra'
    const before = JSON.stringify(p), result = await read(p)
    assert.equal(result, 53); assert.equal(typeof result, 'number'); assert.equal(JSON.stringify(p), before)
  }
})

test('independent statistic requests retain their own totals and failures, without replacing errors with zero', async () => {
  const selected = ['WAITING', 'DONE', 'IN_PROGRESS'], calls = []
  const results = await Promise.allSettled(selected.map(status => m.readStaffStatistic(range, status, signal(), async url => {
    const status = new URL(url, 'http://localhost').searchParams.get('status'); calls.push(status)
    return status === 'DONE' ? Response.json({ error: { code: 'unit-only-failure' } }, { status: 503 }) : Response.json(payload(status === 'WAITING' ? 71 : 8, status))
  })))
  assert.equal(results[0].status, 'fulfilled'); assert.equal(results[0].value, 71)
  assert.equal(results[1].status, 'rejected'); assert.equal(results[1].reason.status, 503)
  assert.equal(results[2].status, 'fulfilled'); assert.equal(results[2].value, 8); assert.equal(calls.length, 3)
})

test('access denial and dependency errors keep typed HTTP status without exposing upstream error details', async () => {
  for (const status of [401, 403, 429, 503]) {
    await assert.rejects(m.readStaffStatistic(range, 'DONE', signal(), async () => Response.json({ error: { message: 'unit-only-internal-detail' } }, { status })), e => e.status === status)
    assert.ok(!m.staffStatisticMessage(new m.StaffStatisticRequestError(status, 'unit-only-internal-detail')).includes('unit-only-internal-detail'))
  }
  assert.ok(!m.staffStatisticMessage(new Error('unit-only-internal-detail')).includes('unit-only-internal-detail'))
})

test('statistics bounds and validates response bodies; abort is not retried or converted to a result', async () => {
  for (const response of [
    new Response('{}', { headers: { 'content-type': 'text/plain' } }),
    new Response('{bad', { headers: { 'content-type': 'application/json' } }),
    new Response(' '.repeat(2097153), { headers: { 'content-type': 'application/json' } }),
  ]) await assert.rejects(m.readStaffStatistic(range, 'DONE', signal(), async () => response), e => e.status === 502)
  const controller = new AbortController(); controller.abort(); let calls = 0
  await assert.rejects(m.readStaffStatistic(range, 'DONE', controller.signal, async (_url, options) => { calls++; options.signal.throwIfAborted() }), e => e.name === 'AbortError')
  assert.ok(calls <= 1)
})

test('invalid query or status cannot reach fetch or select another employee', async () => {
  let calls = 0
  const upstream = async () => { calls++; return Response.json(payload()) }
  for (const badRange of [{ from: '2026-10-29', to: '2026-10-28' }, { from: '2026-02-30', to: '2026-03-01' }, { from: '2024-01-01', to: '2025-01-01' }]) {
    await assert.rejects(m.readStaffStatistic(badRange, 'DONE', signal(), upstream), e => e.status === 400)
  }
  for (const status of ['OTHER', 'done', 'ASSIGNED', 'DONE&userId=2']) await assert.rejects(m.readStaffStatistic(range, status, signal(), upstream), e => e.status === 400)
  assert.equal(calls, 0)
})
