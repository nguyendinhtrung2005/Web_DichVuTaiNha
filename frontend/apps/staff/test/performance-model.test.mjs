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
      throw Error('Unexpected performance dependency: ' + id)
    } }, { timeout: 2000 })
  cache.set(name, module.exports)
  return module.exports
}
const model = source('staff-performance-model'), remote = source('staff-performance-remote-model')
const plain = x => JSON.parse(JSON.stringify(x))
const range = { from: '2026-10-01', to: '2026-10-31' }
const signal = () => new AbortController().signal
test('operational calendar presets use Vietnam day, Monday weeks and real month bounds',()=>{
  const stats=source('staff-work-statistics-model'),at=new Date('2026-12-31T18:00:00.000Z')
  assert.deepEqual(plain(stats.staffStatisticsPresetRange('day',at)),{from:'2027-01-01',to:'2027-01-01'})
  assert.deepEqual(plain(stats.staffStatisticsPresetRange('week',at)),{from:'2026-12-28',to:'2027-01-03'})
  assert.deepEqual(plain(stats.staffStatisticsPresetRange('month',at)),{from:'2027-01-01',to:'2027-01-31'})
  assert.deepEqual(plain(stats.staffStatisticsPresetRange('week',new Date('2026-11-01T00:00:00.000Z'))),{from:'2026-10-26',to:'2026-11-01'})
})

/** Only the real assignment DTO shape; no money, no review, no employee identity. */
let nextId = 1
const job = ({ status = 'DONE', scheduledAt = '2026-10-29T02:00:00.000Z', expectedEndAt = '2026-10-29T04:00:00.000Z', checkInAt = null, checkOutAt = null, unitPrice = '100.00' } = {}) => {
  const id = String(nextId++)
  return {
    id, assignmentId: id, orderId: '9007199254740993', jobCode: null, orderCode: null,
    status, databaseStatus: status === 'WAITING' ? 'ASSIGNED' : status,
    jobStatus: ({ WAITING: 'waiting', ACCEPTED: 'accepted', IN_PROGRESS: 'in_progress', DONE: 'done', CANCELLED: null })[status],
    orderStatus: 'in_progress', scheduledAt, expectedEndAt, durationMinutes: 120,
    contact: { name: null, address: null },
    services: [{ serviceId: '3', name: 'Unit service', quantity: '1.50', unit: 'giờ', unitPrice }],
    checkInAt, checkOutAt, assignedAt: null,
  }
}
const page = (data, { page: pageNumber = 1, total = data.length } = {}) => ({
  data, pagination: { page: pageNumber, pageSize: 100, total, totalPages: Math.ceil(total / 100) }, timezone: 'Asia/Ho_Chi_Minh',
})
const json = value => Response.json(value)

test('operational metrics count every real assignment status and never invent money', () => {
  const summary = model.summarizeStaffPerformance([
    job({ status: 'WAITING' }),
    job({ status: 'ACCEPTED' }),
    job({ status: 'IN_PROGRESS', checkInAt: '2026-10-29T02:10:00.000Z' }),
    job({ status: 'DONE', checkInAt: '2026-10-29T02:00:00.000Z', checkOutAt: '2026-10-29T03:30:00.000Z' }),
    job({ status: 'CANCELLED' }),
  ])
  assert.equal(summary.total, 5)
  assert.equal(summary.waiting, 1); assert.equal(summary.accepted, 1); assert.equal(summary.inProgress, 1)
  assert.equal(summary.done, 1); assert.equal(summary.cancelled, 1)
  // 1 DONE / (5 total - 1 CANCELLED) = 25%
  assert.equal(summary.completionDenominator, 4)
  assert.equal(summary.completionRate, 25)
  // The DONE row checks in exactly on time; the IN_PROGRESS row checks in 10 minutes late.
  assert.equal(summary.checkInSample, 2)
  assert.equal(summary.onTimeCheckIn, 1)
  assert.equal(summary.onTimeRate, 50)
  assert.equal(summary.durationSample, 1)
  assert.equal(summary.averageServiceMinutes, 90)
  assert.equal(JSON.stringify(summary).includes('100.00'), false)
  assert.equal(JSON.stringify(summary).match(/price|salary|revenue|amount/i), null)
})

test('a zero denominator stays null instead of becoming 0%', () => {
  const empty = model.summarizeStaffPerformance([])
  assert.equal(empty.total, 0)
  assert.equal(empty.completionRate, null)
  assert.equal(empty.completionDenominator, 0)
  assert.equal(empty.onTimeRate, null)
  assert.equal(empty.averageServiceMinutes, null)

  const cancelledOnly = model.summarizeStaffPerformance([job({ status: 'CANCELLED' }), job({ status: 'CANCELLED' })])
  assert.equal(cancelledOnly.completionRate, null)
  assert.equal(cancelledOnly.completionDenominator, 0)

  const noTimestamps = model.summarizeStaffPerformance([job({ status: 'DONE' })])
  assert.equal(noTimestamps.completionRate, 100)
  assert.equal(noTimestamps.onTimeRate, null)
  assert.equal(noTimestamps.checkInSample, 0)
  assert.equal(noTimestamps.averageServiceMinutes, null)
  assert.equal(noTimestamps.doneMissingCheckOut, 1)
})

test('missing, invalid and reversed timestamps are reported as data gaps, never as zero minutes', () => {
  const summary = model.summarizeStaffPerformance([
    job({ status: 'DONE', checkInAt: '2026-10-29T02:00:00.000Z', checkOutAt: '2026-10-29T01:00:00.000Z' }),
    job({ status: 'DONE', checkInAt: null, checkOutAt: '2026-10-29T03:00:00.000Z' }),
    job({ status: 'IN_PROGRESS', checkInAt: null }),
  ])
  assert.equal(summary.invalidDuration, 1)
  assert.equal(summary.durationSample, 0)
  assert.equal(summary.averageServiceMinutes, null)
  assert.equal(summary.activeMissingCheckIn, 2)
  assert.equal(summary.doneMissingCheckOut, 0)
})

test('on-time comparison includes the exact scheduled instant and excludes unscheduled rows', () => {
  const exact = model.summarizeStaffPerformance([job({ scheduledAt: '2026-10-29T02:00:00.000Z', checkInAt: '2026-10-29T02:00:00.000Z' })])
  assert.equal(exact.onTimeRate, 100)
  const late = model.summarizeStaffPerformance([job({ scheduledAt: '2026-10-29T02:00:00.000Z', checkInAt: '2026-10-29T02:00:01.000Z' })])
  assert.equal(late.onTimeRate, 0)
  const unscheduled = model.summarizeStaffPerformance([job({ scheduledAt: null, expectedEndAt: null, checkInAt: '2026-10-29T02:00:00.000Z' })])
  assert.equal(unscheduled.checkInSample, 0)
  assert.equal(unscheduled.onTimeRate, null)
})

test('rates round to one decimal and never drift into float noise', () => {
  const third = model.summarizeStaffPerformance([
    job({ status: 'DONE', checkInAt: '2026-10-29T02:00:00.000Z', checkOutAt: '2026-10-29T03:00:00.000Z' }),
    job({ status: 'WAITING' }), job({ status: 'WAITING' }),
  ])
  assert.equal(third.completionRate, 33.3)
  const twoThirds = model.summarizeStaffPerformance([
    job({ status: 'DONE', checkInAt: '2026-10-29T02:00:00.000Z', checkOutAt: '2026-10-29T03:00:00.000Z' }),
    job({ status: 'DONE', checkInAt: '2026-10-29T02:00:00.000Z', checkOutAt: '2026-10-29T03:40:00.000Z' }),
    job({ status: 'WAITING' }),
  ])
  assert.equal(twoThirds.completionRate, 66.7)
  assert.equal(twoThirds.averageServiceMinutes, 80)
})

test('display formatters are Vietnamese, deterministic and honest about missing data', () => {
  assert.equal(model.formatStaffPercent(null), 'Chưa đủ dữ liệu')
  assert.equal(model.formatStaffPercent(66.7), '66,7%')
  assert.equal(model.formatStaffPercent(0), '0,0%')
  assert.equal(model.formatStaffMinutes(null), 'Chưa đủ dữ liệu')
  assert.equal(model.formatStaffMinutes(45), '45 phút')
  assert.equal(model.formatStaffMinutes(90), '1 giờ 30 phút')
  assert.equal(model.formatStaffMinutes(60), '1 giờ 00 phút')
  assert.equal(model.formatStaffMinutes(-5), 'Chưa đủ dữ liệu')
  assert.deepEqual(plain(model.STAFF_PERFORMANCE_DEFINITIONS.map(item => item.key)), ['completionRate', 'onTimeRate', 'averageServiceMinutes'])
})

test('the real reader aggregates every page of the existing schedule API', async () => {
  const jobs = [job({ status: 'DONE', checkInAt: '2026-10-29T02:00:00.000Z', checkOutAt: '2026-10-29T03:00:00.000Z' }), job({ status: 'WAITING' }), job({ status: 'CANCELLED' })]
  const urls = []
  const summary = await remote.readStaffPerformance(range, signal(), async url => {
    urls.push(url)
    const selected = new URL(url, 'http://localhost').searchParams
    assert.equal(selected.get('from'), range.from); assert.equal(selected.get('to'), range.to)
    assert.equal(selected.get('pageSize'), '100'); assert.equal(selected.get('sort'), 'asc')
    assert.equal(selected.get('status'), null)
    return json(page(jobs))
  })
  assert.equal(urls.length, 1)
  assert.equal(summary.total, 3)
  assert.equal(summary.completionRate, 50)
  assert.equal(summary.averageServiceMinutes, 60)
})

test('the real reader joins 101 assignments from two pages and rejects a moving total', async () => {
  const jobs = Array.from({ length: 101 }, (_, index) => job({ status: index === 0 ? 'CANCELLED' : 'WAITING' }))
  const summary = await remote.readStaffPerformance(range, signal(), async url => {
    const selected = new URL(url, 'http://localhost').searchParams, pageNumber = Number(selected.get('page'))
    return json(page(jobs.slice((pageNumber - 1) * 100, pageNumber * 100), { page: pageNumber, total: 101 }))
  })
  assert.equal(summary.total, 101)
  assert.equal(summary.cancelled, 1)
  assert.equal(summary.completionRate, 0)

  let call = 0
  await assert.rejects(remote.readStaffPerformance(range, signal(), async url => {
    const pageNumber = Number(new URL(url, 'http://localhost').searchParams.get('page'))
    call += 1
    return json(page(jobs.slice((pageNumber - 1) * 100, pageNumber * 100), { page: pageNumber, total: call === 1 ? 101 : 102 }))
  }), error => error.code === 'TOTAL_CHANGED' && error.status === 409)
})

test('the real reader refuses a range above 500 rows instead of returning a partial rate', async () => {
  const jobs = Array.from({ length: 501 }, () => job({ status: 'WAITING' }))
  await assert.rejects(remote.readStaffPerformance(range, signal(), async url => {
    const pageNumber = Number(new URL(url, 'http://localhost').searchParams.get('page'))
    return json(page(jobs.slice((pageNumber - 1) * 100, pageNumber * 100), { page: pageNumber, total: 501 }))
  }), error => error.code === 'RANGE_TOO_LARGE' && error.status === 413)
})

test('the real reader fails closed on an invalid range, non-JSON body and non-200 status', async () => {
  await assert.rejects(remote.readStaffPerformance({ from: '2026-10-31', to: '2026-10-01' }, signal(), async () => { throw Error('must not fetch') }),
    error => error.status === 400)
  await assert.rejects(remote.readStaffPerformance(range, signal(), async () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } })),
    error => error.status === 502)
  await assert.rejects(remote.readStaffPerformance(range, signal(), async () => new Response(null, { status: 503 })),
    error => error.status === 503)
})

test('an empty real range stays an explicit empty result, not a 0% achievement', async () => {
  const summary = await remote.readStaffPerformance(range, signal(), async () => json(page([])))
  assert.equal(summary.total, 0)
  assert.equal(summary.completionRate, null)
  assert.equal(summary.onTimeRate, null)
  assert.equal(summary.averageServiceMinutes, null)
})

test('operator-facing errors distinguish consistency failures from ordinary failures', () => {
  const changed = new (source('staff-work-statistics-model').StaffStatisticRequestError)(409, 'TOTAL_CHANGED')
  assert.match(remote.staffPerformanceMessage(changed), /vừa thay đổi/)
  const tooLarge = new (source('staff-work-statistics-model').StaffStatisticRequestError)(413, 'RANGE_TOO_LARGE')
  assert.match(remote.staffPerformanceMessage(tooLarge), /tối đa 500/)
  assert.match(remote.staffPerformanceMessage(new Error('boom')), /Chưa thể đọc số liệu/)
})

test('performance excludes overlapping appointments starting outside Vietnam reporting days', async () => {
  const rows = [job({ scheduledAt: '2026-09-30T16:00:00.000Z', expectedEndAt: '2026-09-30T19:00:00.000Z' }),
    job({ scheduledAt: '2026-09-30T17:00:00.000Z', expectedEndAt: '2026-09-30T18:00:00.000Z' }),
    job({ scheduledAt: null, expectedEndAt: null })]
  const summary = await remote.readStaffPerformance(range, signal(), async () => json(page(rows)))
  assert.equal(summary.total, 1)
  assert.equal(summary.done, 1)
})

test('performance rejects duplicate assignments between pages even when the total is unchanged', async () => {
  const rows = Array.from({ length: 100 }, () => job({ status: 'WAITING' }))
  await assert.rejects(remote.readStaffPerformance(range, signal(), async url => {
    const pageNumber = Number(new URL(url, 'http://localhost').searchParams.get('page'))
    return json(page(pageNumber === 1 ? rows : [rows[0]], { page: pageNumber, total: 101 }))
  }), error => error.code === 'TOTAL_CHANGED' && error.status === 409)
})

test('performance propagates unauthorized and forbidden reads without producing metrics', async () => {
  for (const status of [401, 403]) await assert.rejects(remote.readStaffPerformance(range, signal(), async () => new Response(null, { status })), error => error.status === status)
})
