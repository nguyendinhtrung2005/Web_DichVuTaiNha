import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
const require = createRequire(import.meta.url), ts = require('typescript'), React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const root = new URL('../../../packages/ui/src/components/staff/', import.meta.url)
const display = { preferences: { motion: 'system', focus: 'standard' }, persistence: 'default', ready: true, update() {}, reset() {} }
function render(environment, demoEnabled, auth) {
  const cache = new Map()
  function source(name) {
    if (cache.has(name)) return cache.get(name)
    const module = { exports: {} }, filename = new URL(name, root)
    const code = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
    vm.runInNewContext(code, { module, exports: module.exports, AbortController, DOMException, process: { env: { NODE_ENV: environment } }, fetch() { throw Error('Settings UI must not call an unapproved API') }, require(id) {
      if (id === './staff-auth-session') return { useStaffAuth: () => auth }
      if (id === './staff-display-preferences') return { useStaffDisplayPreferences: () => display }
      if (id === './staff-account-settings') return source('staff-account-settings.tsx')
      if (id === './staff-profile-editor') return source('staff-profile-editor.tsx')
      if (id === './staff-profile-edit-model') return source('staff-profile-edit-model.ts')
      if (id === './staff-areas-remote-model') return source('staff-areas-remote-model.ts')
      if (id === './staff-notification-view-preferences') return source('staff-notification-view-preferences.ts')
      if (id === './staff-settings-demo-adapter') return source('staff-settings-demo-adapter.ts')
      if (id === './staff-settings-demo-model') return source('staff-settings-demo-model.ts')
      if (id === './staff-shared') return {
        StaffPageHeader: ({ title, description, action }) => React.createElement('header', null, React.createElement('h1', null, title), React.createElement('p', null, description), action),
        StaffEmpty: ({ title, description, action }) => React.createElement('section', null, React.createElement('h2', null, title), React.createElement('p', null, description), action),
      }
      if (id === 'lucide-react') return new Proxy({}, { get: () => props => React.createElement('svg', props) })
      if (id === '@/components/ui/card') return { Card: props => React.createElement('section', props), CardContent: props => React.createElement('div', props) }
      if (id === '@/components/ui/button') return { Button: ({ variant, nativeButton, render, children, ...props }) => render ? React.cloneElement(render, props, children) : React.createElement('button', props, children) }
      if (id === '@/components/ui/skeleton') return { Skeleton: props => React.createElement('div', props) }
      if (id === '@/components/ui/dialog') return { Dialog: () => null }
      if (id === '@/components/shared/area-routes') return { AreaLink: props => React.createElement('a', props) }
      return require(id)
    } }, { filename: filename.pathname, timeout: 2000 })
    cache.set(name, module.exports); return module.exports
  }
  return renderToStaticMarkup(React.createElement(source('staff-settings.tsx').StaffSettings, { demoEnabled }))
}
const auth = { status: 'authenticated', busy: null, checkSession: async () => {}, session: { user: { id: '9007199254740919', role: 'EMPLOYEE', status: 'ACTIVE' } } }

test('settings UI keeps real local display controls but no demo content when disabled or production', () => {
  for (const [environment, enabled] of [['development', false], ['production', true], ['test', true], ['', true]]) {
    const html = render(environment, enabled, auth)
    assert.match(html, /Cài đặt/)
    assert.match(html, /Giao diện &amp; trợ năng/)
    assert.match(html, /staff-display-motion/)
    assert.match(html, /Thông tin cá nhân/)
    assert.match(html, /Bảo mật tài khoản/)
    assert.match(html, /Chỉ lưu trên thiết bị này/)
    assert.match(html, /notification-unread-default/)
    assert.match(html, /Chỉnh sửa thông tin/)
    assert.match(html, /Chỉnh sửa thông tin chưa khả dụng/)
    assert.match(html, /Quyền riêng tư &amp; hỗ trợ/)
    assert.match(html, /data-staff-settings-demo="unavailable"/)
    assert.doesNotMatch(html, /DỮ LIỆU MINH HỌA|data-staff-settings-demo-panel|DEMO-CV-1042|data-settings-preview/)
  }
})

test('settings UI hides content during logout and absent unknown or invalid authentication', () => {
  for (const value of [null, { ...auth, status: 'loading' }, { ...auth, status: 'unavailable' }, { ...auth, status: 'unauthenticated' }, { ...auth, session: null }, { ...auth, busy: 'logout' }]) assert.equal(render('development', true, value), '')
  const invalidActor = { ...auth, session: { user: { ...auth.session.user, id: '' } } }
  assert.match(render('development', true, invalidActor), /Tùy chọn tài khoản chưa khả dụng/)
  assert.doesNotMatch(render('development', true, invalidActor), /DỮ LIỆU MINH HỌA|data-staff-settings-demo-panel/)
})

test('authenticated development UI labels demo settings and keeps local storage wording honest', () => {
  const html = render('development', true, auth)
  assert.match(html, /DỮ LIỆU MINH HỌA/)
  assert.match(html, /data-staff-settings-demo="demo"/)
  assert.match(html, /Đang tải tùy chọn minh họa/)
  assert.match(html, /aria-busy="true"/)
  assert.match(html, /Đang dùng mặc định/)
  assert.match(html, /data-staff-settings-password/)
  assert.match(html, /fieldset[^>]*disabled/)
  assert.doesNotMatch(html, /\/api\/|localStorage|sessionStorage|DEMO-CV-1042|data-settings-preview/)
})

test('settings UI never projects Auth personal data or secrets into the page shell', () => {
  const value = { ...auth, session: { user: { ...auth.session.user, name: 'UNIT_PRIVATE_QA_NAME', email: 'private-qa@example.invalid', phone: 'UNIT_PRIVATE_PHONE', accessToken: 'UNIT_PRIVATE_TOKEN' } } }
  const before = JSON.stringify(value), html = render('development', true, value)
  assert.doesNotMatch(html, /UNIT_PRIVATE_|private-qa@example/)
  assert.match(html, /9007199254740919/)
  assert.equal(JSON.stringify(value), before)
})
