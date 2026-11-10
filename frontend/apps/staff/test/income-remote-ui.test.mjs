import { fileURLToPath } from 'node:url'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import { DEMO_INCOME_POLICY, calculateIncomeLine, summarizeIncomeLines } from '../../../../backend/staff-service/src/income-policy.js'
import { StaffIncomeService } from '../../../../backend/staff-service/src/income-service.js'
import { incomeQuery } from '../../../../backend/staff-service/src/validation.js'

const require = createRequire(import.meta.url), ts = require('typescript'), React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const root = new URL('../../../packages/ui/src/components/staff/', import.meta.url)
function load(name, environment = 'development') {
  const module = { exports: {} }, filename = new URL(name, root)
  const output = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
  vm.runInNewContext(output, {
    module, exports: module.exports, URLSearchParams, AbortController, DOMException, Intl,
    process: { env: { NODE_ENV: environment } },
    fetch() { throw Error('static render must not call the API') },
    require(id) {
      if (id === 'react') return React
      if (id === './staff-income-remote-model') return load('staff-income-remote-model.ts', environment)
      if (id === './staff-income-policy-v2.mjs') return require(fileURLToPath(new URL('staff-income-policy-v2.mjs', root)))
      if (id === './staff-income-insights') return load('staff-income-insights.tsx', environment)
      if (id === './staff-income-insights-model') return load('staff-income-insights-model.ts', environment)
      if (id === './staff-income-history') return load('staff-income-history.ts', environment)
      if (id === 'lucide-react') return new Proxy({}, { get: (_, key) => key === '__esModule' ? false : props => React.createElement('svg', props) })
      if (id === '@/components/shared/area-routes') return { AreaLink: props => React.createElement('a', props) }
      if (id === '@/components/ui/button') return { Button: ({ render: child, nativeButton, ...props }) => child ? React.cloneElement(child, props) : React.createElement('button', props) }
      if (id === '@/components/ui/card') return { Card: props => React.createElement('section', props), CardContent: props => React.createElement('div', props) }
      if (id === './staff-shared') return {
        StaffPageHeader: ({ title, description, action }) => React.createElement('header', null, React.createElement('h1', null, title), React.createElement('p', null, description), action),
        StaffEmpty: ({ title, description }) => React.createElement('section', null, React.createElement('h2', null, title), React.createElement('p', null, description)),
        StaffLoading: () => React.createElement('div', { role: 'status', 'aria-busy': 'true' }, 'Đang tải'),
      }
      return require(id)
    },
  }, { filename: filename.pathname, timeout: 2000 })
  return module.exports
}
const model = load('staff-income-remote-model.ts')
const panel = load('staff-income-remote.tsx')
const done = (overrides = {}) => ({
  id: '1', bookingId: '9', status: 'DONE',
  scheduledStart: '2026-11-05T02:00:00.000Z', scheduledEnd: '2026-11-05T04:00:00.000Z',
  checkInAt: '2026-11-05T02:05:00.000Z', checkOutAt: '2026-11-05T04:00:00.000Z',
  eligible: true, reason: null, ...overrides,
})
const missing = (overrides = {}) => done({ id: '2', checkInAt: null, checkOutAt: null, eligible: false, reason: 'MISSING_CHECK_TIMES', ...overrides })
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
const render = props => renderToStaticMarkup(React.createElement(panel.StaffIncomePanel, { month: '2026-11', onMonth() {}, onRetry() {}, ...props }))

test('potential repeated booking allocation is warned without merging, deducting or changing DEMO_V2 amounts', async () => {
  const rows = [done(), done({ id: '2' })], before = JSON.stringify(rows)
  const service = new StaffIncomeService({ env: { NODE_ENV: 'development', STAFF_INCOME_DEMO_ENABLED: 'true' }, repository: {
    async findEmployeeByUserId() { return { id: '10', status: 'ACTIVE', userStatus: 'ACTIVE', userRole: 'EMPLOYEE' } },
    async findIncomeAssignments(employeeId) { assert.equal(employeeId, '10'); return rows },
  } })
  const response = await service.estimate({ userId: '100' }, incomeQuery({ month: '2026-11' }))
  assert.equal(response.policy.version, 'DEMO_V2'); assert.equal(response.counts.eligible, 2); assert.equal(response.estimateTotalVnd, 120000)
  const estimate = model.parseStaffIncomeEstimate(response, '2026-11'); assert.ok(estimate)
  assert.deepEqual(JSON.parse(JSON.stringify(model.repeatedIncomeBookings(estimate.assignments))), [{ bookingId: '9', assignmentIds: ['1', '2'] }])
  const html = render({ estimate, loading: false, error: '' })
  assert.match(html, /data-income-repeated-bookings/); assert.match(html, /Chưa đủ thông tin để xác định/)
  assert.match(html, /data-staff-income-total="120000"/); assert.match(html, /data-staff-income-assignment-id="1"/); assert.match(html, /data-staff-income-assignment-id="2"/)
  assert.match(html, /Chính sách minh họa · DEMO_V2/); assert.match(html, /Dự kiến/); assert.doesNotMatch(html, /data-staff-income-payout="PAID"/)
  assert.equal(JSON.stringify(rows), before)
  const performance = load('staff-performance-model.ts').summarizeStaffPerformance(rows.map(row => ({ assignmentId: row.id, orderId: row.bookingId, status: row.status, scheduledAt: row.scheduledStart, checkInAt: row.checkInAt, checkOutAt: row.checkOutAt })))
  assert.equal(performance.done, 2, 'Current metric remains assignment-based; deducing one official job/bonus requires owner policy')
})

test('repeated booking detection ignores an exact same ID and never mixes separate bookings', () => {
  assert.equal(model.repeatedIncomeBookings([done(), done()]).length, 0)
  assert.equal(model.repeatedIncomeBookings([done(), done({ id: '2', bookingId: '10' })]).length, 0)
  assert.equal(model.repeatedIncomeBookings([]).length, 0)
  assert.equal(model.parseStaffIncomeEstimate(payload([done(), done()]), '2026-11'), null, 'Duplicate assignment IDs are already rejected by the API parser')
})

test('ready estimate renders the DEMO total, eligible count, unit price, month filter and payout status', () => {
  const estimate = model.parseStaffIncomeEstimate(payload([done(), done({ id: '3', checkInAt: '2026-11-06T02:00:00.000Z', checkOutAt: '2026-11-06T03:00:00.000Z' })]), '2026-11')
  const html = render({ estimate, loading: false, error: '' })
  assert.match(html, /data-staff-income-remote="ready"/)
  assert.match(html, /data-staff-income-total="120000"/)
  assert.match(html, /data-staff-income-eligible="2"/)
  assert.match(html, /120\.000 ₫/)
  assert.match(html, /60\.000 ₫/)
  assert.match(html, /Tháng 11\/2026/)
  assert.match(html, /type="month"/)
  assert.doesNotMatch(html, /data-staff-income-demo-label|staff-income-demo-notice/)
  assert.match(html, /data-staff-income-estimate-label="true">Dự kiến<\/span>/)
  assert.match(html, /Chính sách chỉ dùng để minh họa, không phải lương chính thức/)
  assert.match(html, /data-staff-income-payout="NOT_INTEGRATED"/)
  assert.match(html, /Chưa có kết quả được xác nhận/)
  assert.match(html, /<details class="staff-income-calculation"><summary>Chi tiết cách tính<\/summary>/)
  assert.doesNotMatch(html, /<details class="staff-income-calculation" open/)
  assert.match(html, /data-staff-income-assignment-id="1"/)
  assert.match(html, /data-staff-income-assignment-id="3"/)
  assert.match(html, /Đối soát và chi trả/)
  assert.match(html, /Tiền đã thanh toán/)
  assert.match(html, /Chưa có giao dịch được xác nhận/)
  assert.match(html, /staff-income-entry-search/)
  assert.match(html, /staff-income-distance-filter/)
  assert.doesNotMatch(html, /booking\.unitPrice|doanh thu|Đã thanh toán/)
})

test('incomplete DONE data is listed separately and never added to the total', () => {
  const estimate = model.parseStaffIncomeEstimate(payload([done(), missing()]), '2026-11')
  const html = render({ estimate, loading: false, error: '' })
  assert.match(html, /data-staff-income-total="60000"/)
  assert.match(html, /data-staff-income-incomplete="1"/)
  assert.match(html, /data-staff-income-incomplete-list/)
  assert.match(html, /data-staff-income-incomplete-id="2"/)
  assert.match(html, /Thiếu giờ check-in\/check-out/)
  assert.doesNotMatch(html, /data-staff-income-assignment-id="2"/)
  assert.match(html, /chưa đủ điều kiện tính tiền dự kiến/)
})

test('error and loading states never render a total or assignment money', () => {
  const failed = render({ estimate: null, loading: false, error: 'Chưa thể tải tiền công dự kiến. Vui lòng thử lại.' })
  assert.match(failed, /data-staff-income-remote="error"/)
  assert.match(failed, /Không hiển thị tổng tiền khi dữ liệu chưa đọc được/)
  assert.match(failed, /Thử lại/)
  assert.doesNotMatch(failed, /data-staff-income-total|data-staff-income-assignment-id|\d+\.\d{3} ₫/)
  const loading = render({ estimate: null, loading: true, error: '' })
  assert.match(loading, /data-staff-income-remote="loading"/)
  assert.doesNotMatch(loading, /data-staff-income-total|data-staff-income-assignment-id/)
})

test('a month without assignments shows an honest empty state', () => {
  const estimate = model.parseStaffIncomeEstimate(payload([]), '2026-11')
  const html = render({ estimate, loading: false, error: '' })
  assert.match(html, /data-staff-income-remote="ready"/)
  assert.match(html, /Chưa có phân công trong tháng/)
  assert.doesNotMatch(html, /data-staff-income-total/)
  assert.match(html, /data-income-filter-total="0"/)
  assert.match(html, /Dữ liệu đã tải đủ/)
})

test('long statements paginate rows without changing the estimate total', () => {
  const estimate = model.parseStaffIncomeEstimate(payload(Array.from({ length: 21 }, (_, index) => done({ id: String(index + 1) }))), '2026-11')
  const html = render({ estimate, loading: false, error: '' })
  assert.match(html, /data-staff-income-total="1260000"/)
  assert.equal((html.match(/data-staff-income-assignment-id=/g) || []).length, 20)
  assert.match(html, /data-staff-income-assignment-id="20"/)
  assert.doesNotMatch(html, /data-staff-income-assignment-id="21"/)
  assert.match(html, /Phân trang bảng kê tiền công/)
  assert.match(html, /Trang 1 \/ 2/)
  assert.match(html, /Tổng kỳ không đổi/)
  assert.match(html, /data-income-statement-subtotal="1260000"/)
  assert.match(html, /data-income-statement-count="21"/)
})
test('V2 assignment statement, daily incentive and every chart source reconcile with Backend totals',()=>{
  const rows=Array.from({length:6},(_,i)=>{const row=done({id:String(i+1),bookingId:String(i+100),scheduledStart:'2026-11-01T10:00:00.000Z',scheduledEnd:'2026-11-01T11:00:00.000Z',checkInAt:i===5?'2026-10-31T16:00:00.000Z':'2026-11-01T10:00:00.000Z',checkOutAt:i===5?'2026-10-31T17:30:00.000Z':'2026-11-01T11:00:00.000Z'});return {...row,detail:calculateIncomeLine(row,i===0?{verified:true,kilometres:'5.125'}:null)}})
  const raw={...payload(rows),policy:DEMO_INCOME_POLICY,...summarizeIncomeLines(rows)},estimate=model.parseStaffIncomeEstimate(raw,'2026-11');assert.ok(estimate)
  const m=load('staff-income-insights-model.ts'),statement=m.incomeStatementReconciliation(estimate)
  assert.equal(statement.assignmentVnd,416375);assert.equal(statement.incentiveVnd,30000);assert.equal(statement.totalVnd,446375)
  const daily=m.incomeDailySeries(estimate);assert.equal(daily[0].eligible,6);assert.equal(daily[0].amountVnd,446375)
  for(const period of ['day','week','month']){const groups=m.groupIncomeSeries(daily,period);assert.equal(groups.reduce((n,r)=>n+r.amountVnd,0),446375);assert.equal(groups.reduce((n,r)=>n+r.eligible,0),6);for(const key of ['baseVnd','peakVnd','distanceVnd','incentiveVnd'])assert.equal(groups.reduce((n,r)=>n+r[key],0),estimate.breakdown[key])}
  const html=render({estimate,loading:false,error:''});assert.match(html,/data-income-statement-subtotal="416375"/);assert.match(html,/data-income-statement-reconciled="446375"/);assert.match(html,/data-income-incentive-total="30000"/);assert.match(html,/chưa phải xác nhận đối soát/);assert.doesNotMatch(html,/data-staff-income-payout="PAID"/)
  assert.throws(()=>m.incomeStatementReconciliation({...estimate,estimateTotalVnd:446376}),/INCOME_TOTAL_MISMATCH/)
})

test('strict parsing rejects any payload whose money, counts or eligibility disagree', () => {
  const valid = payload([done(), missing()])
  assert.equal(model.parseStaffIncomeEstimate(valid, '2026-11').estimateTotalVnd, 60000)
  const invalid = [
    { ...valid, estimateTotalVnd: 120000 },
    { ...valid, counts: { ...valid.counts, eligible: 2 } },
    { ...valid, counts: { ...valid.counts, assignments: 3 } },
    { ...valid, period: { ...valid.period, to: '2026-11-29' } },
    { ...valid, policy: { ...valid.policy, unitPriceVnd: 70000 } },
    { ...valid, policy: { ...valid.policy, code: 'OFFICIAL' } },
    { ...valid, payout: { status: 'PAID' } },
    { ...valid, assignments: [done({ eligible: true, checkInAt: null })] },
    { ...valid, assignments: [done({ scheduledStart: '2026-12-01T00:00:00.000Z' })] },
    { ...valid, assignments: [done(), done()] },
    { ...valid, timezone: 'UTC' },
  ]
  for (const value of invalid) assert.equal(model.parseStaffIncomeEstimate(value, '2026-11'), null, JSON.stringify(value).slice(0, 80))
  assert.equal(model.parseStaffIncomeEstimate(valid, '2026-12'), null)
})

test('month helpers clamp to the supported range and never fabricate a month', () => {
  assert.equal(model.validIncomeMonth('2026-11'), true)
  for (const value of ['2026-13', '2026-1', '1970-12', '2100-01', '', null]) assert.equal(model.validIncomeMonth(value), false)
  assert.equal(model.shiftIncomeMonth('2026-01', -1), '2025-12')
  assert.equal(model.shiftIncomeMonth('2026-12', 1), '2027-01')
  assert.equal(model.shiftIncomeMonth('1971-01', -1), '1971-01')
  assert.equal(model.shiftIncomeMonth('2099-12', 1), '2099-12')
  assert.equal(model.canShiftIncomeMonth('1971-01', -1), false)
  assert.equal(model.formatIncomeMonth('2026-11'), 'Tháng 11/2026')
  assert.equal(model.formatIncomeVnd(120000), '120.000 ₫')
})
