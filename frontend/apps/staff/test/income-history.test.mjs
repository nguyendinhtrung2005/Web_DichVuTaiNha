import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { DEMO_INCOME_POLICY, calculateIncomeLine, summarizeIncomeLines } from '../../../../backend/staff-service/src/income-policy.js'

const require = createRequire(import.meta.url), ts = require('typescript'), root = new URL('../../../packages/ui/src/components/staff/', import.meta.url)
function modules(globals = {}) {
  const cache = new Map()
  function load(name) {
    if (cache.has(name)) return cache.get(name)
    const module = { exports: {} }, filename = new URL(name, root)
    const code = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    vm.runInNewContext(code, { module, exports: module.exports, AbortController, DOMException, Intl, setTimeout, clearTimeout, fetch, ...globals,
      require(id) { return id === './staff-income-policy-v2.mjs' ? require(fileURLToPath(new URL('staff-income-policy-v2.mjs', root))) : load(id.slice(2) + '.ts') },
    }, { timeout: 2000 }); cache.set(name, module.exports); return module.exports
  }
  return { ...load('staff-income-remote-model.ts'), ...load('staff-income-insights-model.ts'), ...load('staff-income-history.ts') }
}
const m = modules(), plain = value => JSON.parse(JSON.stringify(value))
function done(id, checkOutAt, checkInAt = checkOutAt) { return { id: String(id), bookingId: String(Number(id) + 1000), status: 'DONE', scheduledStart: checkInAt, scheduledEnd: new Date(Date.parse(checkInAt) + 3600000).toISOString(), checkInAt, checkOutAt, eligible: true, reason: null } }
function estimate(month, assignments = []) {
  const rows = assignments.map(row => ({ ...row, detail: row.eligible ? calculateIncomeLine(row) : null }))
  const raw = { period: { month, ...m.incomeMonthBounds(month), timezone: 'Asia/Ho_Chi_Minh' }, policy: DEMO_INCOME_POLICY, counts: { assignments: rows.length, eligible: rows.filter(row => row.eligible).length, incomplete: rows.filter(row => row.reason === 'MISSING_CHECK_TIMES').length, excluded: 0 }, ...summarizeIncomeLines(rows), assignments: rows, payout: { status: 'NOT_INTEGRATED' }, timezone: 'Asia/Ho_Chi_Minh' }
  const parsed = m.parseStaffIncomeEstimate(raw, month); assert.ok(parsed); return parsed
}

test('calendar ranges are bounded to 1/3/6/12 and cross year/leap-month boundaries', () => {
  assert.deepEqual(plain(m.incomeHistoryMonths('2027-01', 3)), ['2026-11', '2026-12', '2027-01'])
  assert.equal(m.incomeHistoryMonths('2026-11', 12).length, 12)
  for (const span of [0, 2, 13, 500]) assert.throws(() => m.incomeHistoryMonths('2026-11', span), /INVALID_INCOME_RANGE/)
  assert.throws(() => m.incomeHistoryMonths('1971-01', 3), /INVALID_INCOME_RANGE/)
  assert.equal(m.shiftIncomeHistoryMonth('2099-12', 1), null)
  assert.equal(m.incomeDailySeries(estimate('2024-02')).length, 29)
})
test('daily data includes every zero day only after a complete API month', () => {
  const rows = m.incomeHistorySeries([estimate('2026-11', [done(1, '2026-11-05T04:00:00.000Z')])])
  assert.equal(rows.length, 30); assert.equal(rows.filter(row => row.amountVnd === 0).length, 29)
  assert.equal(rows.reduce((sum, row) => sum + row.amountVnd, 0), 60000)
  assert.equal(rows.some(row => row.incomplete), false)
})
test('missing completion timestamps stay unknown; a zero is not confirmed complete', () => {
  const missing = { ...done(1, '2026-11-05T04:00:00.000Z'), checkInAt: null, checkOutAt: null, eligible: false, reason: 'MISSING_CHECK_TIMES' }
  const rows = m.incomeHistorySeries([estimate('2026-11', [missing])])
  assert.equal(rows.every(row => row.incomplete), true); assert.equal(rows.reduce((sum, row) => sum + row.amountVnd, 0), 0)
})
test('cross-midnight completion is counted in its UTC+7 completion month once', () => {
  const crossing = done(1, '2026-10-31T17:30:00.000Z', '2026-10-31T16:00:00.000Z')
  const november = estimate('2026-11', [crossing])
  const october = estimate('2026-10')
  const rows = m.incomeHistorySeries([november, october])
  assert.equal(rows.find(row => row.day === '2026-11-01').amountVnd, 60000)
  assert.equal(m.groupIncomeSeries(rows, 'month')[0].amountVnd, 0)
  assert.equal(m.groupIncomeSeries(rows, 'week').reduce((sum, row) => sum + row.amountVnd, 0), 60000)
})
test('week crossing month/year and daily incentive reconcile without duplication', () => {
  const december = estimate('2026-12', Array.from({ length: 5 }, (_, i) => done(i + 1, '2026-12-31T11:00:00.000Z', '2026-12-31T10:00:00.000Z')))
  const january = estimate('2027-01', [done(6, '2027-01-01T04:00:00.000Z')])
  const rows = m.incomeHistorySeries([january, december]), weeks = m.groupIncomeSeries(rows, 'week')
  const joint = weeks.find(row => row.day === '2026-12-28')
  assert.equal(joint.amountVnd, 440000); assert.equal(joint.incentiveVnd, 30000); assert.equal(joint.eligible, 6)
  for (const period of ['day', 'week', 'month']) {
    const grouped = m.groupIncomeSeries(rows, period)
    assert.equal(grouped.reduce((sum, row) => sum + row.amountVnd, 0), december.estimateTotalVnd + january.estimateTotalVnd)
    assert.equal(grouped.reduce((sum, row) => sum + row.incentiveVnd, 0), 30000)
  }
  assert.deepEqual(plain(m.incomeBucketBounds('2026-12-28', 'week', '2027-01-01', '2027-01-31')), { from: '2027-01-01', to: '2027-01-03' })
})
test('duplicate months, repeated eligible assignment and incompatible policy are rejected', () => {
  const november = estimate('2026-11', [done(1, '2026-11-05T04:00:00.000Z')]), december = estimate('2026-12', [done(1, '2026-12-05T04:00:00.000Z')])
  assert.throws(() => m.incomeHistorySeries([november, november]), /INCOME_PERIOD_MISMATCH/)
  assert.throws(() => m.incomeHistorySeries([november, december]), /DUPLICATE_INCOME_ASSIGNMENT/)
  assert.throws(() => m.incomeHistorySeries([november, { ...december, policy: { ...december.policy, version: undefined } }]), /INCOME_PERIOD_MISMATCH/)
})
test('axis starts at zero, uses integral sensible steps and never distorts ratios', () => {
  for (const maximum of [0, 1, 60000, 150000, 320000, 446375, 12000000]) {
    const axis = m.incomeAxis(maximum)
    assert.equal(axis.ticks[0], 0); assert.ok(axis.max >= maximum); assert.ok(axis.ticks.length <= 6)
    assert.ok(Number.isSafeInteger(axis.step)); assert.equal(axis.ticks.at(-1), axis.max)
    if (maximum) assert.ok(Math.abs((maximum / axis.max) / (maximum / 2 / axis.max) - 2) < 1e-10)
  }
  assert.deepEqual(plain(m.incomeAxis(150000).ticks), [0, 50000, 100000, 150000])
  assert.throws(() => m.incomeAxis(-1), /INVALID_INCOME_AMOUNT/)
})
test('history loads at most two requests concurrently and reuses the already fetched month', async () => {
  let active = 0, maximum = 0; const calls = []
  const result = await m.readIncomeHistory({ end: '2026-11', span: 12, accountId: '11', signal: new AbortController().signal, known: [estimate('2026-11')], read: async (month, account) => {
    calls.push(month); assert.equal(account, '11'); maximum = Math.max(maximum, ++active); await new Promise(done => setTimeout(done, 1)); active--; return estimate(month)
  } })
  assert.equal(calls.length, 11); assert.equal(new Set(calls).size, 11); assert.equal(maximum, 2)
  assert.equal(result.complete, true); assert.equal(result.estimates.length, 12)
})
test('a failed month is not a zero month and explicit retry fetches only missing data', async () => {
  let calls = 0
  const partial = await m.readIncomeHistory({ end: '2026-11', span: 3, accountId: '11', signal: new AbortController().signal, read: async month => { calls++; if (month === '2026-10') throw new m.StaffIncomeRequestError(503, 'STAFF_UNAVAILABLE'); return estimate(month) } })
  assert.equal(partial.complete, false); assert.equal(partial.estimates.length, 2); assert.equal(partial.errors.length, 1); assert.equal(calls, 3)
  const retry = await m.readIncomeHistory({ end: '2026-11', span: 3, accountId: '11', signal: new AbortController().signal, known: partial.estimates, read: async month => { calls++; return estimate(month) } })
  assert.equal(retry.complete, true); assert.equal(calls, 4)
})
test('401/403/429 and changed session stop the queue without automatic retry', async () => {
  for (const [status, code] of [[401, 'SESSION_EXPIRED'], [403, 'STAFF_ACCESS_DENIED'], [429, 'STAFF_RATE_LIMITED'], [409, 'STAFF_SESSION_CHANGED']]) {
    let calls = 0
    const result = await m.readIncomeHistory({ end: '2026-11', span: 12, accountId: '11', signal: new AbortController().signal, read: async () => { calls++; throw new m.StaffIncomeRequestError(status, code) } })
    assert.equal(result.complete, false); assert.ok(calls <= 2); assert.equal(result.estimates.length, 0)
  }
})
test('abort prevents stale history completion and the next account uses its own requests', async () => {
  const controller = new AbortController(), accounts = []
  const first = await m.readIncomeHistory({ end: '2026-11', span: 3, accountId: '11', signal: controller.signal, read: async month => { controller.abort(); return estimate(month) } })
  assert.equal(first.complete, false); assert.equal(first.estimates.length, 0)
  await m.readIncomeHistory({ end: '2026-11', span: 3, accountId: '22', signal: new AbortController().signal, read: async (month, account) => { accounts.push(account); return estimate(month) } })
  assert.deepEqual(accounts, ['22', '22', '22'])
})
test('timeout aborts pending requests and reports unavailable instead of zero', async () => {
  const timed = modules({ setTimeout: callback => setTimeout(callback, 2) })
  const result = await timed.readIncomeHistory({ end: '2026-11', span: 1, accountId: '11', signal: new AbortController().signal, read: async (_month, _account, signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })) })
  assert.equal(result.complete, false); assert.equal(result.errors.length, 1); assert.equal(result.estimates.length, 0)
})
