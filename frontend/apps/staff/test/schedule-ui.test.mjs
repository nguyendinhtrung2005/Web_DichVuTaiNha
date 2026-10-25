import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

// Pure model unit fixtures only: no HTTP, browser, MySQL or persisted seed data.
const require = createRequire(import.meta.url), ts = require('typescript'), loaded = new Map()
const componentRoot = new URL('../../../packages/ui/src/components/staff/', import.meta.url)
function sourceModule(relative) {
  const filename = fileURLToPath(new URL(relative, componentRoot))
  if (loaded.has(filename)) return loaded.get(filename)
  const module = { exports: {} }; loaded.set(filename, module.exports)
  const output = ts.transpileModule(readFileSync(filename, 'utf8'), { fileName: filename, compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText
  vm.runInNewContext(output, { module, exports: module.exports, URLSearchParams, Intl,
    require(specifier) { if (specifier === './staff-jobs-remote-model') return sourceModule('staff-jobs-remote-model.ts'); throw new Error('Unexpected model dependency') },
  }, { filename, timeout: 2000 })
  return module.exports
}
const model = sourceModule('staff-schedule-remote-model.ts')
const copy = value => JSON.parse(JSON.stringify(value))
const query = () => ({ from: '2026-10-24', to: '2026-10-25', anchor: '2026-10-24', view: 'list', status: '', page: 1, pageSize: 100, sort: 'asc' })
const job = (id = '1', start = '2026-10-24T01:00:00.000Z', end = '2026-10-24T03:00:00.000Z') => ({
  id, assignmentId: id, orderId: '2', jobCode: null, orderCode: null, status: 'WAITING', databaseStatus: 'ASSIGNED', jobStatus: 'waiting', orderStatus: 'completed',
  scheduledAt: start, expectedEndAt: end, durationMinutes: start && end ? (Date.parse(end) - Date.parse(start)) / 60000 : null,
  contact: { name: 'Unit customer', address: 'Unit location' }, services: [{ serviceId: '3', name: 'Unit service snapshot', unit: 'giờ', quantity: '1.50', unitPrice: '1234567890.12' }],
  assignedAt: null, checkInAt: null, checkOutAt: null,
})
const payload = (rows = [job()], patch = {}) => ({ data: rows, pagination: { page: 1, pageSize: 100, total: rows.length, totalPages: Math.ceil(rows.length / 100) }, timezone: 'Asia/Ho_Chi_Minh', ...patch })

test('UC11 UI: historical dates use the same fixed UTC+07 boundary as the Staff API', () => {
  const start = '1971-01-01T16:30:00.000Z', end = '1971-01-01T17:15:00.000Z'
  assert.equal(model.vietnamDayKey(start), '1971-01-01')
  assert.equal(model.formatStaffScheduleTime(start), '23:30 · 01/01/1971')
  assert.equal(model.formatStaffScheduleTime(end), '00:15 · 02/01/1971')
  const grouped = model.groupScheduleByDay([job('1', start, end)], '1971-01-01', '1971-01-02')
  assert.equal(grouped.days[0].jobs[0].assignmentId, '1')
  assert.equal(grouped.days[1].jobs[0].assignmentId, '1')
  assert.equal(model.formatStaffScheduleTime('2026-10-24T17:00:00.000Z'), '00:00 · 25/10/2026')
})

test('UC11 UI: Vietnam day and default Monday week ignore the machine timezone', () => {
  assert.equal(model.vietnamDayKey('2026-12-31T23:30:00Z'), '2027-01-01')
  assert.equal(model.vietnamDayKey('2026-10-24T16:59:59Z'), '2026-10-24')
  assert.equal(model.vietnamDayKey('2026-10-24T17:00:00Z'), '2026-10-25')
  const value = model.defaultStaffScheduleQuery(new Date('2026-10-24T18:00:00Z'))
  assert.equal(value.anchor, '2026-10-25'); assert.equal(value.from, '2026-10-19'); assert.equal(value.to, '2026-10-25')
})
test('UC11 UI: days validate real leap dates and the Backend calendar bounds', () => {
  for (const day of ['1971-01-01', '2024-02-29', '2099-12-31']) assert.equal(model.validScheduleDay(day), true)
  for (const day of ['1970-12-31', '2100-01-01', '2023-02-29', '2026-02-30', '2026-1-01', '2026-10-24T00:00:00Z', null]) assert.equal(model.validScheduleDay(day), false)
})
test('UC11 UI: inclusive ranges allow at most 366 real calendar days', () => {
  assert.equal(model.validateScheduleRange('2024-01-01', '2024-12-31'), '')
  assert.equal(model.validateScheduleRange('2023-01-01', '2024-01-01'), '')
  assert.notEqual(model.validateScheduleRange('2024-01-01', '2025-01-01'), '')
  assert.notEqual(model.validateScheduleRange('2026-10-25', '2026-10-24'), '')
  assert.notEqual(model.validateScheduleRange('', '2026-10-24'), '')
})
test('UC11 UI: day, Monday week and short/leap months produce correct ranges', () => {
  assert.deepEqual(copy(model.calendarRange('2026-10-24', 'day')), { from: '2026-10-24', to: '2026-10-24' })
  assert.deepEqual(copy(model.calendarRange('2027-01-01', 'week')), { from: '2026-12-28', to: '2027-01-03' })
  assert.deepEqual(copy(model.calendarRange('2024-02-29', 'month')), { from: '2024-02-01', to: '2024-02-29' })
  assert.deepEqual(copy(model.calendarRange('2023-02-12', 'month')), { from: '2023-02-01', to: '2023-02-28' })
  assert.deepEqual(copy(model.calendarRange('1971-01-01', 'week')), { from: '1971-01-01', to: '1971-01-03' })
})
test('UC11 UI: period navigation clamps month ends and refuses unsupported years', () => {
  assert.equal(model.shiftCalendarAnchor('2024-01-31', 'month', 1), '2024-02-29')
  assert.equal(model.shiftCalendarAnchor('2023-01-31', 'month', 1), '2023-02-28')
  assert.equal(model.shiftCalendarAnchor('2026-12-31', 'day', 1), '2027-01-01')
  assert.equal(model.shiftCalendarAnchor('2099-12-31', 'day', 1), null)
  assert.equal(model.shiftCalendarAnchor('1971-01-01', 'month', -1), null)
  const moved = model.shiftScheduleQuery(query(), 1)
  assert.equal(moved.from, '2026-10-26'); assert.equal(moved.to, '2026-10-27'); assert.equal(moved.page, 1)
})
test('UC11 UI: URL state round-trips without forwarding local view or identity fields', () => {
  const source = { ...query(), view: 'month', status: 'DONE', page: 2, pageSize: 2, sort: 'desc' }
  const href = model.staffScheduleHref(source)
  assert.equal(href.startsWith('/lich-lam-viec?'), true)
  assert.deepEqual(copy(model.parseStaffScheduleLocation(href.split('?')[1])), source)
  const api = new URLSearchParams(model.staffScheduleQueryString(source))
  assert.equal([...api.keys()].sort().join(','), 'from,page,pageSize,sort,status,to')
  assert.equal(api.has('view') || api.has('anchor') || api.has('employeeId'), false)
  assert.equal(model.parseStaffScheduleLocation('from=2026-10-24&to=2026-10-25&status=ASSIGNED').status, 'WAITING')
})
test('UC11 UI: malformed, duplicate, impersonation and out-of-range URL state is rejected', () => {
  const prefix = 'from=2026-10-24&to=2026-10-25&'
  for (const suffix of ['from=2026-10-26', 'employeeId=2', 'url=http://localhost/internal/', 'view=arbitrary', 'anchor=2026-02-30', 'page=0', 'page=100001', 'page=01', 'pageSize=101', 'pageSize=', 'sort=ASC', 'status=', 'status=arbitrary']) assert.equal(model.parseStaffScheduleLocation(prefix + suffix), null)
  assert.equal(model.parseStaffScheduleLocation('from=2026-10-24'), null)
})
test('UC11 UI: carry-in and overnight jobs appear on every overlapping Vietnam day', () => {
  const rows = [job('1', '2026-10-24T16:30:00.000Z', '2026-10-24T18:30:00.000Z'), job('2', '2026-10-23T16:00:00.000Z', '2026-10-24T18:00:00.000Z')]
  const grouped = model.groupScheduleByDay(rows, '2026-10-24', '2026-10-25')
  assert.deepEqual(copy(grouped.days.map(entry => entry.jobs.map(row => row.assignmentId))), [['1', '2'], ['1', '2']])
  assert.equal(grouped.unplaced.length, 0)
})
test('UC11 UI: touching midnight does not add an event to the following day', () => {
  const rows = [job('1', '2026-10-24T15:00:00.000Z', '2026-10-24T17:00:00.000Z')]
  const grouped = model.groupScheduleByDay(rows, '2026-10-24', '2026-10-25')
  assert.equal(grouped.days[0].jobs.length, 1); assert.equal(grouped.days[1].jobs.length, 0)
})
test('UC11 UI: simultaneous jobs remain independent and the source is never rescheduled', () => {
  const rows = [job('1'), job('2', '2026-10-24T02:00:00.000Z', '2026-10-24T04:00:00.000Z'), job('3')]
  const before = JSON.stringify(rows)
  Object.freeze(rows); rows.forEach(Object.freeze)
  const grouped = model.groupScheduleByDay(rows, '2026-10-24', '2026-10-24')
  assert.deepEqual(copy(grouped.days[0].jobs.map(row => row.assignmentId)), ['1', '2', '3'])
  assert.equal(JSON.stringify(rows), before)
})
test('UC11 UI: nullable timing stays visible as unplaced data instead of a fabricated event', () => {
  const grouped = model.groupScheduleByDay([job('1', null, null)], '2026-10-24', '2026-10-25')
  assert.equal(grouped.days.every(entry => entry.jobs.length === 0), true)
  assert.equal(grouped.unplaced[0].assignmentId, '1')
})
test('UC11 UI: schedule DTO preserves snapshot strings, separate statuses and strips extra secrets', () => {
  const source = payload()
  source.accessToken = 'unit-extra-secret'; source.data[0].contact.phone = 'unit-detail-only'
  const parsed = model.parseStaffSchedulePayload(source, query())
  assert.equal(parsed.data[0].services[0].unitPrice, '1234567890.12')
  assert.equal(parsed.data[0].services[0].quantity, '1.50')
  assert.equal(parsed.data[0].status, 'WAITING'); assert.equal(parsed.data[0].orderStatus, 'completed')
  assert.equal(JSON.stringify(parsed).includes('unit-extra-secret'), false)
  assert.equal(Object.hasOwn(parsed.data[0].contact, 'phone'), false)
})
test('UC11 UI: wrong pagination, status, range or timezone is not accepted as calendar data', () => {
  for (const value of [payload([job()], { timezone: 'UTC' }), payload([job()], { pagination: { page: 2, pageSize: 100, total: 1, totalPages: 1 } }), payload([job('1', '2026-10-26T01:00:00.000Z', '2026-10-26T03:00:00.000Z')])]) assert.equal(model.parseStaffSchedulePayload(value, query()), null)
  assert.equal(model.parseStaffSchedulePayload(payload(), { ...query(), status: 'DONE' }), null)
  assert.deepEqual(copy(model.parseStaffSchedulePayload(payload([]), query()).data), [])
})
