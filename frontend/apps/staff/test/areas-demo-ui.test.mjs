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
    vm.runInNewContext(code, { module, exports: module.exports, AbortController, DOMException, process: { env: { NODE_ENV: environment } }, fetch() { throw Error('Areas demo UI must not make API calls') }, require(id) {
      if (id === './staff-branch-map') return { StaffBranchMap: () => null }
      if (id === './staff-availability-interactions') return { StaffAvailabilityInteractions: () => null }
      if (id === './staff-auth-session') return { useStaffAuth: () => auth }
      if (id === './staff-display-preferences') return { useStaffDisplayPreferences: () => null }
      if (id === './staff-areas-demo-adapter') return source('staff-areas-demo-adapter.ts')
      if (id === './staff-areas-demo-model') return source('staff-areas-demo-model.ts')
      if (id === './staff-areas-remote') return source('staff-areas-remote.tsx')
      if (id === './staff-areas-remote-model') return source('staff-areas-remote-model.ts')
      if (id === 'lucide-react') return new Proxy({}, { get: (_, name) => name === '__esModule' ? false : props => React.createElement('svg', props) })
      if (id === './staff-shared') return {
        StaffPageHeader: ({ title, description, action }) => React.createElement('header', null, React.createElement('h1', null, title), React.createElement('p', null, description), action),
        StaffEmpty: ({ title, description, action }) => React.createElement('section', null, React.createElement('h2', null, title), React.createElement('p', null, description), action),
        StaffLoading: () => React.createElement('div', { role: 'status', 'aria-busy': 'true' }, 'Đang tải'),
      }
      if (id === '@/components/ui/card') return { Card: props => React.createElement('section', props), CardContent: props => React.createElement('div', props) }
      if (id === '@/components/ui/button') return { Button: ({ variant, nativeButton, render, children, ...props }) => render ? React.cloneElement(render, props, children) : React.createElement('button', props, children) }
      if (id === '@/components/ui/dialog') return { Dialog: () => null }
      if (id === '@/components/shared/area-routes') return { AreaLink: props => React.createElement('a', props) }
      return require(id)
    } }, { filename: filename.pathname, timeout: 2000 })
    cache.set(name, module.exports); return module.exports
  }
  return renderToStaticMarkup(React.createElement(source('staff-areas.tsx').StaffAreas, { demoEnabled }))
}
const auth = { status: 'authenticated', busy: null, session: { user: { id: '9007199254740919', role: 'EMPLOYEE', status: 'ACTIVE' } } }

test('areas UI defaults to the real read-only page when demo is disabled or not in development', () => {
  for (const [environment, enabled] of [['development', false], ['production', true], ['test', true], ['', true]]) {
    const html = render(environment, enabled, auth)
    assert.match(html, /data-staff-areas-remote="loading"/)
    assert.doesNotMatch(html, /data-staff-areas-readonly|Bạn có thể xem lịch làm việc\. Đăng ký và thay đổi ca hiện chưa được hỗ trợ\./)
    assert.doesNotMatch(html, /data-staff-areas-demo|DEMO-AREA-|data-area-id|data-shift-id|DỮ LIỆU MINH HỌA/)
  }
})

test('areas UI hides content during logout and absent unknown or invalid authentication', () => {
  for (const value of [null, { ...auth, status: 'loading' }, { ...auth, status: 'unavailable' }, { ...auth, status: 'unauthenticated' }, { ...auth, session: null }, { ...auth, busy: 'logout' }]) assert.equal(render('development', true, value), '')
  const invalidActor = { ...auth, session: { user: { ...auth.session.user, id: '' } } }
  assert.match(render('development', true, invalidActor), /Khu vực &amp; ca làm chưa khả dụng|Khu vực & ca làm chưa khả dụng/)
})

test('authenticated development UI honestly labels illustrative temporary state and loading', () => {
  const html = render('development', true, auth)
  assert.match(html, /DỮ LIỆU MINH HỌA/)
  assert.match(html, /F5/)
  assert.match(html, /đặt lại|mất|không lưu/i)
  assert.match(html, /tài khoản/i)
  assert.match(html, /data-staff-areas-demo="loading"/)
  assert.match(html, /aria-busy="true"/)
  assert.doesNotMatch(html, /data-area-id|data-shift-id|\/api\/|localStorage|sessionStorage/)
})

test('areas demo never projects Auth personal data or treats ACTIVE as readiness', () => {
  const value = { ...auth, session: { user: { ...auth.session.user, name: 'UNIT_PRIVATE_QA_NAME', email: 'private-qa@example.invalid', phone: 'UNIT_PRIVATE_PHONE', accessToken: 'UNIT_PRIVATE_TOKEN' } } }
  const before = JSON.stringify(value), html = render('development', true, value)
  assert.doesNotMatch(html, /UNIT_PRIVATE_|private-qa@example|ACTIVE|9007199254740919/)
  assert.equal(JSON.stringify(value), before)
})
