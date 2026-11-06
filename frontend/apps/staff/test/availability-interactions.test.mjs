import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
const require = createRequire(import.meta.url), ts = require('typescript'), React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const root = new URL('../../../packages/ui/src/components/staff/', import.meta.url), cache = new Map()
function source(name) {
  if (cache.has(name)) return cache.get(name)
  const module = { exports: {} }
  const code = ts.transpileModule(readFileSync(new URL(name, root), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText
  vm.runInNewContext(code, { module, exports: module.exports, Date, Intl, BigInt, queueMicrotask, fetch() { throw Error('Availability preview must never write or fetch') }, require(id) {
    if (id === './staff-areas-remote-model') return source('staff-areas-remote-model.ts')
    if (id === './staff-availability-request-model') return source('staff-availability-request-model.ts')
    if (id === '@/components/ui/dialog') return { Dialog: () => null }
    if (id === '@/components/ui/button') return { Button: ({ variant, children, ...props }) => React.createElement('button', props, children) }
    if (id === 'lucide-react') return new Proxy({}, { get: (_, key) => key === '__esModule' ? false : props => React.createElement('svg', props) })
    return require(id)
  } }, { timeout: 2000 })
  cache.set(name, module.exports); return module.exports
}
const model = source('staff-availability-request-model.ts')
const week = { from: '2030-01-07', to: '2030-01-13' }, now = Date.parse('2030-01-07T00:00:00Z')
const item = { id: '10', startsAt: '2030-01-08T01:00:00.000Z', endsAt: '2030-01-08T05:00:00.000Z', status: 'AVAILABLE' }
const context = { accountId: '100', items: [item], week, truncated: false, now }
const draft = { accountId: '100', kind: 'register', targetId: null, startsLocal: '2030-01-09T08:00', endsLocal: '2030-01-09T12:00', reason: '' }
const validate = (values = {}, options = {}) => model.validateAvailabilityDraft({ ...draft, ...values }, { ...context, ...options })

test('Vietnam wall time is explicit and rejects rolled-over dates, invalid clock values and host timezone assumptions', () => {
  assert.equal(model.availabilityInstant('2030-01-08T08:30'), '2030-01-08T01:30:00.000Z')
  assert.equal(model.availabilityLocalInput(item.startsAt), '2030-01-08T08:00')
  for (const value of ['', '2030-02-30T08:00', '2030-01-08T24:00', '2030-01-08T08:60', '2030-01-08 08:00', '2030-01-08T08:00Z']) assert.equal(model.availabilityInstant(value), null)
})
test('draft rejects past, reversed, equal, out-of-week and truncated availability without sending anything', () => {
  assert.equal(validate().valid, true)
  for (const values of [{ startsLocal: '' }, { startsLocal: '2030-01-06T08:00' }, { endsLocal: '2030-01-09T08:00' }, { endsLocal: '2030-01-08T12:00' }, { endsLocal: '2030-01-14T01:00' }]) assert.equal(validate(values).valid, false)
  assert.equal(validate({}, { truncated: true }).valid, false)
})
test('overlap uses half-open intervals across available and unavailable windows; adjacent times are allowed', () => {
  for (const status of ['AVAILABLE', 'UNAVAILABLE', null]) {
    assert.equal(validate({ startsLocal: '2030-01-08T09:00', endsLocal: '2030-01-08T13:00' }, { items: [{ ...item, status }] }).conflicts[0], '10')
  }
  assert.equal(validate({ startsLocal: '2030-01-08T12:00', endsLocal: '2030-01-08T13:00' }).valid, true)
  assert.equal(validate({ startsLocal: '2030-01-08T07:00', endsLocal: '2030-01-08T08:00' }).valid, true)
})
test('A/B account and source-window ownership are required, including cancellation and change', () => {
  assert.equal(validate({ accountId: '200' }).valid, false)
  for (const kind of ['change', 'cancel']) {
    assert.equal(validate({ kind, targetId: 'OTHER_ACCOUNT_WINDOW', reason: 'A reason' }).valid, false)
    assert.equal(validate({ kind, targetId: '10', reason: 'A reason' }).valid, true)
    assert.equal(validate({ kind, targetId: '10', reason: 'A reason' }, { now: Date.parse(item.startsAt) }).valid, false)
    assert.equal(validate({ kind, targetId: '10', reason: ' ' }).valid, false)
  }
  assert.equal(validate({ kind: 'change', targetId: '10', startsLocal: '2030-01-08T08:00', endsLocal: '2030-01-08T12:00', reason: 'A reason' }).valid, false)
  assert.equal(validate({ reason: 'x'.repeat(501) }).valid, false)
})
test('cross-midnight windows appear on every overlapping Vietnam day, excluding exact midnight end', () => {
  const overnight = { ...item, startsAt: '2030-01-06T16:00:00.000Z', endsAt: '2030-01-07T18:00:00.000Z' }
  assert.equal(model.availabilityTouchesDay(overnight, '2030-01-06'), true)
  assert.equal(model.availabilityTouchesDay(overnight, '2030-01-07'), true)
  assert.equal(model.availabilityTouchesDay(overnight, '2030-01-08'), true)
  assert.equal(model.availabilityTouchesDay({ ...overnight, endsAt: '2030-01-07T17:00:00.000Z' }, '2030-01-08'), false)
})
test('availability state never implies approval and unknown Backend states remain explicit', () => {
  assert.equal(model.availabilityStatus('AVAILABLE'), 'Khả dụng')
  assert.equal(model.availabilityStatus('UNAVAILABLE'), 'Không khả dụng')
  assert.equal(model.availabilityStatus(null), 'Chưa rõ trạng thái')
  assert.match(model.availabilityStatus('PENDING_APPROVAL'), /Trạng thái từ hệ thống: PENDING_APPROVAL/)
})
test('SSR provides real buttons for days and windows, also for an empty week, with no network or fake request success', () => {
  const Component = source('staff-availability-interactions.tsx').StaffAvailabilityInteractions
  for (const items of [[item], []]) {
    const html = renderToStaticMarkup(React.createElement(Component, { accountId: '100', items, week, branch: { id: '20', name: 'Unit branch' }, truncated: false }))
    assert.equal((html.match(/data-staff-availability-day-open=/g) || []).length, 7)
    assert.equal((html.match(/data-staff-availability-open=/g) || []).length, items.length)
    assert.match(html, /aria-haspopup="dialog"/)
    assert.match(html, /Chuẩn bị đăng ký ca/)
    assert.doesNotMatch(html, /đăng ký thành công|đã gửi yêu cầu|fetch\(|localStorage/i)
  }
})
