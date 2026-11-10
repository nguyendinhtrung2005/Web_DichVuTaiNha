import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
const require = createRequire(import.meta.url), ts = require('typescript'), React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const root = new URL('../../../packages/ui/src/components/staff/', import.meta.url)
function render(environment, demoEnabled, auth) {
  const cache = new Map()
  function source(name) {
    if (cache.has(name)) return cache.get(name)
    const module = { exports: {} }, filename = new URL(name, root)
    const code = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
    vm.runInNewContext(code, { module, exports: module.exports, AbortController, DOMException, process: { env: { NODE_ENV: environment } }, fetch() { throw Error('Achievements UI must not call an unapproved API') }, require(id) {
      if (id === './staff-auth-session') return { useStaffAuth: () => auth }
      if (id === './staff-achievements-demo-adapter') return source('staff-achievements-demo-adapter.ts')
      if (id === './staff-achievements-demo-model') return source('staff-achievements-demo-model.ts')
      if (id === './staff-work-statistics-model') return {
        defaultStaffStatisticsRange: () => ({ from: '2026-10-01', to: '2026-10-31' }),
        staffStatisticsPresetRange: () => ({ from: '2026-10-01', to: '2026-10-31' }),
        readStaffStatistic: () => { throw Error('Real statistics must not be requested during static render') },
        staffStatisticMessage: () => 'Chưa thể đọc số liệu.',
        staffStatisticsHref: range => '/thong-ke-cong-viec?' + range.from + '&' + range.to,
        StaffStatisticRequestError: class extends Error {},
      }
      // The real section performs no request during static render; this stub keeps the
      // harness free of fetch so the assertion below proves the page shell is offline.
      if (id === './staff-performance-remote') return {
        StaffPerformanceSection: ({ headingId }) => React.createElement('section', { 'data-staff-real-statistics': '', 'data-staff-performance': 'real' },
          React.createElement('h2', { id: headingId }, 'Thống kê phân công thật'),
          React.createElement('p', null, 'Đang đọc số liệu thật...')),
      }
      if (id === './staff-reviews-remote') return {
        StaffReviewsSection: () => React.createElement('section', { 'data-staff-reviews': 'real' },
          React.createElement('h2', null, 'Chưa có dữ liệu đánh giá'),
          React.createElement('p', null, 'Đánh giá khách hàng, huy hiệu và mục tiêu sẽ hiển thị khi API đánh giá và quy chế KPI được duyệt')),
      }
      if (id === './staff-shared') return {
        StaffPageHeader: ({ title, description, action }) => React.createElement('header', null, React.createElement('h1', null, title), React.createElement('p', null, description), action),
        StaffEmpty: ({ title, description, action }) => React.createElement('section', null, React.createElement('h2', null, title), React.createElement('p', null, description), action),
      }
      if (id === '@/components/ui/card') return { Card: props => React.createElement('section', props), CardContent: props => React.createElement('div', props) }
      if (id === '@/components/ui/button') return { Button: ({ variant, nativeButton, render, children, ...props }) => render ? React.cloneElement(render, props, children) : React.createElement('button', props, children) }
      if (id === '@/components/ui/dialog') return { Dialog: () => null, DialogContent: () => null, DialogHeader: () => null, DialogTitle: () => null, DialogDescription: () => null, DialogClose: () => null }
      if (id === '@/components/ui/skeleton') return { Skeleton: props => React.createElement('div', props) }
      if (id === '@/components/shared/area-routes') return { AreaLink: props => React.createElement('a', props) }
      return require(id)
    } }, { filename: filename.pathname, timeout: 2000 })
    cache.set(name, module.exports); return module.exports
  }
  return renderToStaticMarkup(React.createElement(source('staff-achievements.tsx').StaffAchievements, { demoEnabled }))
}
const auth = { status: 'authenticated', busy: null, checkSession: async () => {}, session: { user: { id: '9007199254740919', role: 'EMPLOYEE', status: 'ACTIVE' } } }

test('achievements UI keeps real statistics but no demo content when demo is disabled or production', () => {
  for (const [environment, enabled] of [['development', false], ['production', true], ['test', true], ['', true]]) {
    const html = render(environment, enabled, auth)
    assert.match(html, /Thành tích &amp; Đánh giá|Thành tích & Đánh giá/)
    assert.match(html, /Thống kê phân công thật/)
    assert.match(html, /data-staff-performance="real"/)
    assert.match(html, /Chưa có dữ liệu đánh giá/)
    assert.doesNotMatch(html, /DỮ LIỆU MINH HỌA|DEMO-REV-|DEMO-BADGE-|DEMO-GOAL-|data-staff-achievements="demo"|data-demo-average|3\.8|REAL_E2E_NOT_RUN/)
    assert.match(html, /Đánh giá khách hàng, huy hiệu và mục tiêu sẽ hiển thị khi API đánh giá và quy chế KPI được duyệt/)
    assert.doesNotMatch(html, /bản minh họa riêng biệt/)
  }
})

test('achievements UI hides content during logout and absent unknown or invalid authentication', () => {
  for (const value of [null, { ...auth, status: 'loading' }, { ...auth, status: 'unavailable' }, { ...auth, status: 'unauthenticated' }, { ...auth, session: null }, { ...auth, busy: 'logout' }]) assert.equal(render('development', true, value), '')
  const invalidActor = { ...auth, session: { user: { ...auth.session.user, id: '' } } }
  assert.match(render('development', true, invalidActor), /Chưa có dữ liệu đánh giá/)
  assert.doesNotMatch(render('development', true, invalidActor), /DỮ LIỆU MINH HỌA|DEMO-REV-/)
})

test('authenticated development UI labels illustrative reviews and loading honestly', () => {
  const html = render('development', true, auth)
  assert.match(html, /DỮ LIỆU MINH HỌA/)
  assert.match(html, /F5/)
  assert.match(html, /tài khoản/i)
  assert.match(html, /data-staff-achievements="demo"/)
  assert.match(html, /Đang tải đánh giá minh họa/)
  assert.match(html, /aria-busy="true"/)
  assert.doesNotMatch(html, /\/api\/|localStorage|sessionStorage|DEMO-REV-001/)
})

test('achievements UI never projects Auth personal data into the page shell', () => {
  const value = { ...auth, session: { user: { ...auth.session.user, name: 'UNIT_PRIVATE_QA_NAME', email: 'private-qa@example.invalid', phone: 'UNIT_PRIVATE_PHONE', accessToken: 'UNIT_PRIVATE_TOKEN' } } }
  const before = JSON.stringify(value), html = render('development', true, value)
  assert.doesNotMatch(html, /UNIT_PRIVATE_|private-qa@example|9007199254740919/)
  assert.equal(JSON.stringify(value), before)
})
