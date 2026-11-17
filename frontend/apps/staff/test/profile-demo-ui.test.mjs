import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
const require = createRequire(import.meta.url), ts = require('typescript'), React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const root = new URL('../../../packages/ui/src/components/staff/', import.meta.url)
function render(environment, enabled, accountScope, auth) {
  const cache = new Map()
  function source(name) {
    if (cache.has(name)) return cache.get(name)
    const module = { exports: {} }, filename = new URL(name, root)
    const code = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
    vm.runInNewContext(code, { module, exports: module.exports, AbortController, DOMException, process: { env: { NODE_ENV: environment } }, fetch() { throw Error('Profile must not make API calls') }, require(id) {
      if (id === './staff-auth-session') return { useStaffAuth: () => auth }
      if (id === './staff-profile-demo-adapter') return source('staff-profile-demo-adapter.ts')
      if (id === './staff-profile-demo-model') return source('staff-profile-demo-model.ts')
      if (id === '@/components/ui/card') return { Card: props => React.createElement('section', props), CardContent: props => React.createElement('div', props) }
      if (id === '@/components/ui/button') return { Button: props => React.createElement('button', props) }
      return require(id)
    } }, { filename: filename.pathname, timeout: 2000 })
    cache.set(name, module.exports); return module.exports
  }
  return renderToStaticMarkup(React.createElement(source('staff-profile-demo.tsx').StaffProfileDemo, { enabled, accountScope }))
}
const auth = { status: 'authenticated', busy: null, session: { user: { id: '101', role: 'EMPLOYEE', status: 'ACTIVE' } } }
test('profile UI production and disabled demo render no illustrative fields or edit controls', () => {
  assert.equal(render('production', true, '101', auth), '')
  assert.equal(render('development', false, '101', auth), '')
  assert.equal(render('test', true, '101', auth), '')
})
test('profile UI hides all demo state on logout, unknown session and actor mismatch', () => {
  for (const value of [null, { ...auth, status: 'loading' }, { ...auth, status: 'unavailable' }, { ...auth, status: 'unauthenticated' }, { ...auth, session: null }, { ...auth, busy: 'logout' }]) assert.equal(render('development', true, '101', value), '')
  assert.equal(render('development', true, '102', auth), '')
})
test('enabled profile view explains temporary storage and loads only after authentication', () => {
  const html = render('development', true, '101', auth)
  assert.match(html, /DỮ LIỆU MINH HỌA/)
  assert.match(html, /F5, rời trang hoặc đăng xuất sẽ đặt lại/)
  assert.match(html, /Mỗi tài khoản có trạng thái minh họa riêng/)
  assert.match(html, /data-profile-demo="loading"/)
  assert.doesNotMatch(html, /name="(?:id|role|status|employeeId)"|\/api\/|localStorage|sessionStorage/)
})
test('demo does not project unexpected Auth PII into its fictional profile', () => {
  const value = { ...auth, session: { user: { ...auth.session.user, name: 'UNIT_PRIVATE_QA_NAME', email: 'private-qa@example.invalid', phone: 'UNIT_PRIVATE_PHONE', accessToken: 'UNIT_PRIVATE_TOKEN' } } }
  const html = render('development', true, '101', value)
  assert.doesNotMatch(html, /UNIT_PRIVATE_|private-qa@example/)
})
