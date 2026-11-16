import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import test from 'node:test'

const require = createRequire(import.meta.url), ts = require('typescript')
const root = new URL('../../../packages/ui/src/components/staff/', import.meta.url)
function loadIncome(environment = 'test', globals = {}) {
  const cache = new Map()
  function source(name) {
    if (cache.has(name)) return cache.get(name)
    const filename = fileURLToPath(new URL(name, root)), module = { exports: {} }
    const output = ts.transpileModule(readFileSync(filename, 'utf8'), {
      fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText
    vm.runInNewContext(output, {
      module, exports: module.exports, URLSearchParams, AbortController, DOMException,
      process: { env: { NODE_ENV: environment } }, ...globals,
      require(id) {
        if (id === './staff-income-model') return source('staff-income-model.ts')
        throw new Error('Unexpected demo dependency')
      },
    }, { filename, timeout: 2000 })
    cache.set(name, module.exports)
    return module.exports
  }
  return { ...source('staff-income-model.ts'), ...source('staff-income-demo.ts') }
}
const plain = value => JSON.parse(JSON.stringify(value))
const october = { from: '2026-10-01', to: '2026-10-31', granularity: 'day', source: '', status: '' }
function row(overrides = {}) {
  return {
    id: 'DEMO-INCOME-UNIT-A', source: 'WORK', reference: 'DEMO-CV-UNIT-A', description: 'Unit illustration',
    amountVnd: '100000', recognizedAt: '2026-10-01T02:00:00.000Z', status: 'PENDING', paidAt: null, ...overrides,
  }
}
test('income demo: cards, source composition, day buckets and complete ledger reconcile', async () => {
  const m = loadIncome(), report = await m.createIncomeDemoAdapter().read(october)
  assert.equal(report.kind, 'demo')
  assert.equal(report.entries.length, 14)
  assert.deepEqual(plain(report.summary), { totalVnd: '3420000', paidVnd: '1760000', pendingVnd: '1660000', adjustmentVnd: '-40000' })
  assert.equal(BigInt(report.summary.paidVnd) + BigInt(report.summary.pendingVnd), BigInt(report.summary.totalVnd))
  assert.equal(report.entries.reduce((sum, entry) => sum + BigInt(entry.amountVnd), 0n), BigInt(report.summary.totalVnd))
  assert.equal(report.buckets.reduce((sum, bucket) => sum + BigInt(bucket.amountVnd), 0n), BigInt(report.summary.totalVnd))
  assert.equal(report.sources.reduce((sum, source) => sum + BigInt(source.amountVnd), 0n), BigInt(report.summary.totalVnd))
  assert.deepEqual(plain(report.sources), [
    { source: 'WORK', amountVnd: '2810000' }, { source: 'BONUS', amountVnd: '450000' },
    { source: 'ALLOWANCE', amountVnd: '200000' }, { source: 'ADJUSTMENT', amountVnd: '-40000' },
  ])
})
test('income demo: adjustments remain signed and are not added twice', async () => {
  const m = loadIncome(), report = await m.createIncomeDemoAdapter().read({ ...october, source: 'ADJUSTMENT' })
  assert.equal(report.entries.length, 3)
  assert.deepEqual(plain(report.summary), { totalVnd: '-40000', paidVnd: '-50000', pendingVnd: '10000', adjustmentVnd: '-40000' })
  assert.equal(report.buckets.find(x => x.key === '2026-10-12').amountVnd, '-50000')
  assert.equal(report.sources.find(x => x.source === 'ADJUSTMENT').amountVnd, '-40000')
})
test('income demo: source and status filters apply to every aggregate and row', async () => {
  const m = loadIncome(), adapter = m.createIncomeDemoAdapter()
  for (const source of ['', ...m.INCOME_SOURCES]) for (const status of ['', ...m.INCOME_STATUSES]) {
    const report = await adapter.read({ ...october, source, status })
    assert.ok(report.entries.every(entry => (!source || entry.source === source) && (!status || entry.status === status)))
    const total = report.entries.reduce((sum, entry) => sum + BigInt(entry.amountVnd), 0n)
    assert.equal(total, BigInt(report.summary.totalVnd))
    assert.equal(report.buckets.reduce((sum, entry) => sum + BigInt(entry.amountVnd), 0n), total)
    assert.equal(report.sources.reduce((sum, entry) => sum + BigInt(entry.amountVnd), 0n), total)
    assert.equal(BigInt(report.summary.paidVnd) + BigInt(report.summary.pendingVnd), total)
  }
})
test('income demo: inclusive date filter uses recognizedAt rather than paidAt', async () => {
  const m = loadIncome(), adapter = m.createIncomeDemoAdapter()
  const single = await adapter.read({ ...october, from: '2026-10-12', to: '2026-10-12' })
  assert.equal(single.entries.length, 1)
  assert.equal(single.entries[0].source, 'ADJUSTMENT')
  assert.equal(single.summary.totalVnd, '-50000')
  const paidOn12 = (await adapter.read(october)).entries.find(x => x.paidAt === '2026-10-12T02:00:00.000Z')
  assert.equal(paidOn12.source, 'BONUS')
  assert.equal(single.entries.some(x => x.id === paidOn12.id), false)
})
test('income demo: UTC+7 exact month boundary includes midnight and excludes next month', async () => {
  const m = loadIncome(), report = await m.createIncomeDemoAdapter().read(october)
  assert.equal(m.incomeDayKey('2026-09-30T16:59:59.000Z'), '2026-09-30')
  assert.equal(m.incomeDayKey('2026-09-30T17:00:00.000Z'), '2026-10-01')
  assert.equal(m.incomeDayKey('2026-10-31T17:00:00.000Z'), '2026-11-01')
  assert.equal(report.buckets.find(x => x.key === '2026-10-01').amountVnd, '350000')
  assert.ok(report.entries.some(x => x.id === 'DEMO-INCOME-20261001-A'))
  assert.ok(report.entries.every(x => !['DEMO-INCOME-20260930-A', 'DEMO-INCOME-20261101-A'].includes(x.id)))
})
test('income demo: monthly yearly report agrees with daily cohort and crosses calendar years correctly', async () => {
  const m = loadIncome(), adapter = m.createIncomeDemoAdapter()
  const year = m.setIncomeGranularity(october, 'month')
  assert.deepEqual(plain(year), { ...october, from: '2026-01-01', to: '2026-12-31', granularity: 'month' })
  const report = await adapter.read(year)
  assert.equal(report.buckets.length, 12)
  assert.equal(report.summary.totalVnd, '4540000')
  assert.equal(report.buckets.find(x => x.key === '2026-10').amountVnd, '3420000')
  assert.equal(report.buckets.find(x => x.key === '2026-01').amountVnd, '470000')
  assert.equal(report.entries.some(x => x.id === 'DEMO-INCOME-20251231-A'), false)
  assert.equal(report.entries.some(x => x.id === 'DEMO-INCOME-20270101-A'), false)
  const cross = await adapter.read({ ...october, from: '2025-12-01', to: '2026-01-31', granularity: 'month' })
  assert.deepEqual(plain(cross.buckets), [
    { key: '2025-12', label: 'T12/2025', amountVnd: '280000' }, { key: '2026-01', label: 'T01/2026', amountVnd: '470000' },
  ])
})
test('income demo: zero-data periods retain all zero buckets without fabricating income', async () => {
  const m = loadIncome(), report = await m.createIncomeDemoAdapter().read({ ...october, from: '2026-02-01', to: '2026-02-28' })
  assert.equal(report.entries.length, 0)
  assert.equal(report.buckets.length, 28)
  assert.ok(report.buckets.every(x => x.amountVnd === '0'))
  assert.ok(report.sources.every(x => x.amountVnd === '0'))
  assert.deepEqual(plain(report.summary), { totalVnd: '0', paidVnd: '0', pendingVnd: '0', adjustmentVnd: '0' })
})
test('income demo: valid leap days and invalid rolled dates are handled without UTC local drift', () => {
  const m = loadIncome()
  assert.equal(m.validateIncomeQuery({ ...october, from: '2024-02-29', to: '2024-02-29' }), '')
  for (const day of ['2026-02-29', '2024-02-30', '2026-04-31', '1970-12-31', '2100-01-01']) {
    assert.notEqual(m.validateIncomeQuery({ ...october, from: day, to: day }), '')
  }
  assert.equal(m.buildIncomeReport([], { ...october, from: '2024-02-01', to: '2024-02-29' }).buckets.length, 29)
})
test('income demo: bounds are inclusive with a maximum of 366 days', () => {
  const m = loadIncome()
  assert.equal(m.validateIncomeQuery({ ...october, from: '2024-01-01', to: '2024-12-31' }), '')
  assert.notEqual(m.validateIncomeQuery({ ...october, from: '2024-01-01', to: '2025-01-01' }), '')
  assert.notEqual(m.validateIncomeQuery({ ...october, from: '2026-10-31', to: '2026-10-01' }), '')
})
test('income demo: previous/next month handles December, leap February and end bounds', () => {
  const m = loadIncome()
  assert.deepEqual(plain(m.shiftIncomePeriod({ ...october, from: '2026-12-31', to: '2026-12-31' }, 1)), { ...october, from: '2027-01-01', to: '2027-01-31' })
  assert.deepEqual(plain(m.shiftIncomePeriod({ ...october, from: '2024-03-31', to: '2024-03-31' }, -1)), { ...october, from: '2024-02-01', to: '2024-02-29' })
  assert.equal(m.shiftIncomePeriod({ ...october, from: '1971-01-01', to: '1971-01-31' }, -1).from, '1971-01-01')
  assert.equal(m.shiftIncomePeriod({ ...october, from: '2099-12-01', to: '2099-12-31' }, 1).to, '2099-12-31')
})
test('income demo: switching and shifting yearly view uses whole real calendar years', () => {
  const m = loadIncome(), annual = m.setIncomeGranularity(october, 'month')
  assert.equal(m.shiftIncomePeriod(annual, 1).from, '2027-01-01')
  assert.equal(m.shiftIncomePeriod(annual, -1).to, '2025-12-31')
  assert.deepEqual(plain(m.setIncomeGranularity({ ...annual, from: '2024-02-01', to: '2024-03-01' }, 'day')), { ...october, from: '2024-02-01', to: '2024-02-29' })
})
test('income demo: default period is current Vietnam month across UTC midnight and year boundary', () => {
  const m = loadIncome()
  assert.equal(m.defaultIncomeQuery(new Date('2025-12-31T16:59:59.000Z')).from, '2025-12-01')
  assert.equal(m.defaultIncomeQuery(new Date('2025-12-31T17:00:00.000Z')).from, '2026-01-01')
  assert.equal(m.defaultIncomeQuery(new Date('2026-10-31T17:00:00.000Z')).from, '2026-11-01')
})
test('income demo: canonical deep link survives F5 and rejects actor or mode injection', () => {
  const m = loadIncome(), query = { ...october, source: 'ADJUSTMENT', status: 'PENDING' }
  const href = m.incomeHref(query)
  assert.ok(href.startsWith('/thu-nhap?'))
  assert.deepEqual(plain(m.incomeQueryFromSearch(href.split('?')[1])), query)
  for (const search of ['from=2026-10-01', 'to=2026-10-31', 'from=2026-10-01&from=2026-10-02&to=2026-10-31', 'userId=1', 'employeeId=1', 'demo=true', 'mode=real', 'source=BOOKING_PRICE', 'status=SETTLED', 'granularity=week', 'from=2026-02-29&to=2026-03-01']) assert.equal(m.incomeQueryFromSearch(search), null, search)
})
test('income demo: exact BigInt arithmetic does not lose VND precision or hide negative values', () => {
  const m = loadIncome(), entries = [
    row({ amountVnd: '9007199254740993' }),
    row({ id: 'DEMO-INCOME-UNIT-B', amountVnd: '-9007199254740992', source: 'ADJUSTMENT' }),
  ]
  const report = m.buildIncomeReport(entries, october)
  assert.equal(report.summary.totalVnd, '1')
  assert.equal(report.summary.pendingVnd, '1')
  assert.equal(report.summary.adjustmentVnd, '-9007199254740992')
  assert.match(m.formatIncomeVnd('9007199254740993'), /9\.007\.199\.254\.740\.993/)
  assert.ok(m.formatIncomeVnd('-50000').includes('-50.000'))
  for (const amount of ['1.5', '1e3', '01', '-0', 'NaN']) assert.throws(() => m.formatIncomeVnd(amount))
})
test('income demo: inconsistent status, duplicate IDs, real references and bad amounts fail closed', () => {
  const m = loadIncome()
  for (const entry of [
    row({ id: '9109131' }), row({ reference: '9109141' }), row({ amountVnd: '1.00' }),
    row({ status: 'PAID', paidAt: null }), row({ paidAt: '2026-10-02T02:00:00.000Z' }),
    row({ status: 'PAID', paidAt: '2026-09-01T02:00:00.000Z' }),
    row({ recognizedAt: '2026-02-30T02:00:00.000Z' }), row({ source: 'UNKNOWN' }),
  ]) assert.throws(() => m.buildIncomeReport([entry], october), /Invalid isolated demo entry/)
  assert.throws(() => m.buildIncomeReport([row(), row()], october), /Duplicate demo entry/)
})
test('income demo: resetting and changing adapter never mutates shared seed or other callers', async () => {
  const m = loadIncome(), a = m.createIncomeDemoAdapter(), b = m.createIncomeDemoAdapter()
  const before = await a.read(october), baseline = plain(before)
  before.entries[0].amountVnd = '99999999'
  before.sources[0].amountVnd = '99999999'
  before.summary.totalVnd = '99999999'
  before.query.from = '2099-01-01'
  await a.reset()
  assert.deepEqual(plain(await a.read(october)), baseline)
  assert.deepEqual(plain(await b.read(october)), baseline)
  const detail = await a.detail(baseline.entries[0].id)
  detail.amountVnd = '111'
  assert.equal((await a.detail(baseline.entries[0].id)).amountVnd, baseline.entries[0].amountVnd)
  assert.equal(await a.detail('9109131'), null)
})
test('income demo: aborted reads/details never produce reports', async () => {
  const m = loadIncome(), adapter = m.createIncomeDemoAdapter(), controller = new AbortController()
  controller.abort()
  await assert.rejects(adapter.read(october, controller.signal), { name: 'AbortError' })
  await assert.rejects(adapter.detail('DEMO-INCOME-20261001-A', controller.signal), { name: 'AbortError' })
})
test('income demo: production refuses illustrated money even if enabled or direct factory called', async () => {
  const production = loadIncome('production')
  for (const adapter of [production.createIncomeAdapter(true), production.createIncomeAdapter(false), production.createIncomeDemoAdapter()]) {
    assert.equal(adapter.kind, 'unavailable')
    assert.equal(await adapter.read(october), null)
    assert.equal(await adapter.detail('DEMO-INCOME-20261001-A'), null)
    await adapter.reset()
  }
})
test('income demo: disabled mode cannot be activated by URL, browser storage or loose truthy values', async () => {
  const m = loadIncome('development', { location: { search: '?demo=true' }, localStorage: { getItem() { throw new Error('No storage access allowed') } } })
  for (const flag of [false, undefined, null, 'true', 1]) {
    const adapter = m.createIncomeAdapter(flag)
    assert.equal(adapter.kind, 'unavailable')
    assert.equal(await adapter.read(october), null)
  }
  assert.equal(m.createIncomeAdapter(true).kind, 'demo')
})
test('income demo: isolated adapter has no network, identity or storage dependency', async () => {
  const fail = () => { throw new Error('Demo isolation violation') }
  const m = loadIncome('development', {
    fetch: fail, XMLHttpRequest: fail, WebSocket: fail,
    localStorage: { getItem: fail, setItem: fail, removeItem: fail },
    sessionStorage: { getItem: fail, setItem: fail, removeItem: fail },
    document: new Proxy({}, { get: fail }), window: new Proxy({}, { get: fail }),
  })
  const adapter = m.createIncomeAdapter(true)
  const report = await adapter.read(october)
  assert.equal(report.entries.length, 14)
  assert.ok(report.entries.every(entry => entry.id.startsWith('DEMO-INCOME-') && (!entry.reference || entry.reference.startsWith('DEMO-CV-'))))
  await adapter.detail(report.entries[0].id)
  await adapter.reset()
})
