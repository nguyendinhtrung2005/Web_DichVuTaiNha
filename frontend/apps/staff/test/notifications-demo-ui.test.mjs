import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
const require = createRequire(import.meta.url), ts = require('typescript'), React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const root = new URL('../../../packages/ui/src/components/staff/', import.meta.url)
function render(environment, enabled, auth) {
  const cache = new Map()
  function source(name) {
    if (cache.has(name)) return cache.get(name)
    const module = { exports: {} }, filename = new URL(name, root)
    const code = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
    vm.runInNewContext(code, { module, exports: module.exports, AbortController, DOMException, process: { env: { NODE_ENV: environment } }, fetch() { throw Error('Notifications UI must not make API calls') }, require(id) {
      if (id === './staff-auth-session') return { useStaffAuth: () => auth }
      if (id === './staff-display-preferences') return { useStaffDisplayPreferences: () => null }
      if (id === './staff-notifications-demo-adapter') return source('staff-notifications-demo-adapter.ts')
      if (id === './staff-notifications-demo-model') return source('staff-notifications-demo-model.ts')
      if (id === './staff-notifications-unavailable') return { StaffNotificationsUnavailable: () => React.createElement('section', { 'data-notifications-unavailable': true }, 'Notifications unavailable') }
      if (id === './staff-shared') return { StaffPageHeader: ({ title, description, action }) => React.createElement('header', null, React.createElement('h1', null, title), React.createElement('p', null, description), action) }
      if (id === '@/components/ui/card') return { Card: props => React.createElement('section', props), CardContent: props => React.createElement('div', props) }
      if (id === '@/components/ui/button') return { Button: ({ variant, ...props }) => React.createElement('button', props) }
      if (id === '@/components/ui/dialog') return { Dialog: () => null }
      if (id === '@/components/shared/area-routes') return { AreaLink: props => React.createElement('a', props) }
      return require(id)
    } }, { filename: filename.pathname, timeout: 2000 })
    cache.set(name, module.exports); return module.exports
  }
  return renderToStaticMarkup(React.createElement(source('staff-notifications-demo.tsx').StaffNotificationsDemo, { enabled }))
}
const auth = { status: 'authenticated', busy: null, session: { user: { id: '101', role: 'EMPLOYEE', status: 'ACTIVE' } } }

test('notifications UI keeps the real unavailable state when demo is disabled or production', () => {
  for (const [environment, enabled] of [['development', false], ['production', true], ['test', true], ['', true]]) {
    const html = render(environment, enabled, auth)
    assert.match(html, /data-notifications-unavailable/)
    assert.doesNotMatch(html, /data-staff-notifications-demo|DEMO-NOTICE-|data-notifications-unread/)
  }
})

test('notifications UI hides its content during logout and absent or unknown authentication', () => {
  for (const value of [null, { ...auth, status: 'loading' }, { ...auth, status: 'unavailable' }, { ...auth, status: 'unauthenticated' }, { ...auth, session: null }, { ...auth, busy: 'logout' }]) assert.equal(render('development', true, value), '')
  const invalidActor = { ...auth, session: { user: { ...auth.session.user, id: '' } } }
  assert.match(render('development', true, invalidActor), /data-notifications-unavailable/)
})

test('authenticated development UI labels the demo, temporary read state and loading truthfully', () => {
  const html = render('development', true, auth)
  assert.match(html, /DỮ LIỆU MINH HỌA/)
  assert.match(html, /F5, rời trang hoặc đăng xuất sẽ đặt lại/)
  assert.match(html, /Mỗi tài khoản có trạng thái riêng/)
  assert.match(html, /data-staff-notifications-demo="loading"/)
  assert.match(html, /aria-busy="true"/)
  assert.doesNotMatch(html, /DEMO-NOTICE-|data-notifications-unread|\/api\/|localStorage|sessionStorage/)
})

test('notifications demo never projects unexpected Auth personal data into its illustrative content', () => {
  const value = { ...auth, session: { user: { ...auth.session.user, name: 'UNIT_PRIVATE_QA_NAME', email: 'private-qa@example.invalid', phone: 'UNIT_PRIVATE_PHONE', accessToken: 'UNIT_PRIVATE_TOKEN' } } }
  const html = render('development', true, value)
  assert.doesNotMatch(html, /UNIT_PRIVATE_|private-qa@example/)
})
