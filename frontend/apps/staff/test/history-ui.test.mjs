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
    { module, exports: module.exports, URLSearchParams, TextDecoder, Uint8Array, require(id) { if (id.startsWith('./staff-')) return source(id.slice(2)); throw Error('Unexpected history dependency') } }, { timeout: 2000 })
  cache.set(name, module.exports)
  return module.exports
}
const m = source('staff-history-model'), plain = x => JSON.parse(JSON.stringify(x))
const query = { status: 'DONE', page: 2, pageSize: 2, sort: 'desc' }
const job = id => ({ id, assignmentId: id, orderId: '10', jobCode: null, orderCode: null, status: 'DONE', databaseStatus: 'DONE', jobStatus: 'done', orderStatus: 'in_progress', scheduledAt: '2026-10-24T23:30:00.000Z', expectedEndAt: '2026-10-25T01:30:00.000Z', durationMinutes: 120, contact: { name: null, address: null }, services: [{ serviceId: '3', name: 'Unit service', quantity: '1.50', unit: 'giờ', unitPrice: '100.00' }], checkInAt: null, checkOutAt: null, assignedAt: null })
const payload = () => ({ data: [job('9007199254740993'), job('9223372036854775807')], pagination: { page: 2, pageSize: 2, total: 53, totalPages: 27 }, timezone: 'Asia/Ho_Chi_Minh' })
const signal = () => new AbortController().signal

test('history URL accepts only existing pagination/sort and fixes DONE', () => {
  assert.deepEqual(plain(m.parseStaffHistoryQuery('')), { status: 'DONE', page: 1, pageSize: 20, sort: 'desc' })
  assert.deepEqual(plain(m.parseStaffHistoryQuery('page=2&pageSize=2&sort=asc')), { ...query, sort: 'asc' })
  for (const input of ['status=DONE', 'status=WAITING', 'userId=2', 'from=2026-01-01', 'search=a', 'page=0', 'page=', 'page=100001', 'page=2&page=3', 'pageSize=101', 'pageSize=0', 'sort=no']) assert.equal(m.parseStaffHistoryQuery(input), null)
})

test('history pagination/deep links preserve BIGINT and never add a fake UC10 return target', () => {
  assert.equal(m.staffHistoryHref(query), '/lich-su?page=2&pageSize=2&sort=desc')
  assert.equal(m.staffHistoryDetailHref('9223372036854775807'), '/don/9223372036854775807')
  for (const id of ['0', '01', '../other', '9223372036854775808', '1?userId=2']) assert.equal(m.staffHistoryDetailHref(id), '/lich-su')
})

test('DONE total comes from pagination across all pages, not returned row count', async () => {
  const calls = [], abort = signal()
  const result = await m.readStaffHistory(query, abort, async (url, options) => { calls.push({ url, options }); return Response.json(payload()) })
  assert.equal(result.pagination.total, 53); assert.equal(result.data.length, 2)
  assert.equal(result.data[0].assignmentId, '9007199254740993')
  assert.equal(result.data[1].assignmentId, '9223372036854775807')
  assert.equal(calls.length, 1)
  const u = new URL(calls[0].url, 'http://localhost')
  assert.equal(u.pathname, '/api/staff/jobs'); assert.equal(u.searchParams.get('status'), 'DONE')
  assert.deepEqual([...u.searchParams.keys()].sort(), ['page', 'pageSize', 'sort', 'status'])
  assert.equal(calls[0].options.method, 'GET'); assert.equal(calls[0].options.credentials, 'same-origin')
  assert.equal(calls[0].options.cache, 'no-store'); assert.equal(calls[0].options.redirect, 'error'); assert.equal(calls[0].options.signal, abort)
})

test('history rejects wrong statuses, mismatched pages, duplicate IDs and incomplete pagination', () => {
  const corrupt = [
    p => { p.data[0].status = 'WAITING'; p.data[0].databaseStatus = 'ASSIGNED'; p.data[0].jobStatus = 'waiting' },
    p => { p.pagination.page = 1 }, p => { p.pagination.pageSize = 20 },
    p => { p.data[1] = p.data[0] }, p => { p.data.pop() }, p => { p.timezone = 'UTC' }, p => { p.pagination.totalPages = 1 },
  ]
  for (const change of corrupt) { const p = payload(); change(p); assert.equal(m.parseStaffHistoryPayload(p, query), null) }
  const empty = { data: [], pagination: { page: 100, pageSize: 2, total: 53, totalPages: 27 }, timezone: 'Asia/Ho_Chi_Minh' }
  assert.equal(m.parseStaffHistoryPayload(empty, { ...query, page: 100 }).pagination.total, 53)
})

test('scheduled and recorded checkout timestamps remain distinct; no completion date is invented', () => {
  const p = payload(); p.data[0].checkOutAt = '2026-10-26T02:00:00.000Z'; p.data[0].completedAt = 'unit-only-unapproved'
  const before = JSON.stringify(p), result = m.parseStaffHistoryPayload(p, query)
  assert.equal(result.data[0].scheduledAt, '2026-10-24T23:30:00.000Z')
  assert.equal(result.data[0].checkOutAt, '2026-10-26T02:00:00.000Z')
  assert.equal(result.data[1].checkOutAt, null)
  assert.ok(!('completedAt' in result.data[0]))
  assert.equal(result.data[0].orderStatus, 'in_progress')
  assert.equal(JSON.stringify(p), before)
})

test('history bounds responses and rejects malformed JSON or unsupported content', async () => {
  for (const response of [new Response('{}', { headers: { 'content-type': 'text/plain' } }), new Response('{bad', { headers: { 'content-type': 'application/json' } }), new Response(' '.repeat(2097153), { headers: { 'content-type': 'application/json' } })]) {
    await assert.rejects(m.readStaffHistory(query, signal(), async () => response), e => e.status === 502)
  }
})

test('access failures stay typed for session recheck and internal errors are not shown to users', async () => {
  for (const status of [401, 403, 429, 503]) await assert.rejects(m.readStaffHistory(query, signal(), async () => Response.json({ error: { code: 'unit-internal-error' } }, { status })), e => e.status === status)
  assert.ok(!m.staffHistoryMessage(new Error('unit-internal-error')).includes('unit-internal-error'))
  assert.ok(!m.staffHistoryMessage(new m.StaffHistoryRequestError(503, 'unit-internal-error')).includes('unit-internal-error'))
})

test('unsupported query cannot make a non-DONE request', async () => {
  let calls = 0
  for (const bad of [{ ...query, status: 'WAITING' }, { ...query, pageSize: 101 }, { ...query, sort: 'unexpected' }]) await assert.rejects(m.readStaffHistory(bad, signal(), async () => { calls++; return Response.json(payload()) }), e => e.status === 400)
  assert.equal(calls, 0)
})
