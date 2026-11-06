import { fileURLToPath } from 'node:url'
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
  const element = (tag, props) => React.createElement(tag, props)
  function load(name) {
    if (cache.has(name)) return cache.get(name)
    const module = { exports: {} }, filename = new URL(name, root)
    const output = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
    vm.runInNewContext(output, {
      module, exports: module.exports, URLSearchParams, AbortController, DOMException, Intl,
      process: { env: { NODE_ENV: environment } },
      fetch() { throw Error('Income UI must not call a Backend API during static render') },
      require(id) {
        if (id === 'react') return React
        if (id === './staff-auth-session') return { useStaffAuth: () => auth }
        if (id === './staff-income-remote') return load('staff-income-remote.tsx')
        if (id === './staff-income-remote-model') return load('staff-income-remote-model.ts')
      if (id === './staff-income-policy-v2.mjs') return require(fileURLToPath(new URL('staff-income-policy-v2.mjs', root)))
        if (id === './staff-income-insights') return load('staff-income-insights.tsx')
        if (id === './staff-income-insights-model') return load('staff-income-insights-model.ts')
        if (id === './staff-income-history') return load('staff-income-history.ts')
        if (id === 'lucide-react') return new Proxy({}, { get: (_, name) => name === '__esModule' ? false : props => element('svg', props) })
        if (id === 'next/navigation') return { useSearchParams: () => new URLSearchParams('from=2026-10-01&to=2026-10-31') }
        if (id === '@/components/shared/area-routes') return { AreaLink: props => element('a', props) }
        if (id === '@/components/ui/button') return { Button: ({ render: child, nativeButton, ...props }) => child ? React.cloneElement(child, props) : element('button', props) }
        if (id === '@/components/ui/card') return { Card: props => element('section', props), CardContent: props => element('div', props) }
        if (id === '@/components/ui/dialog') return { Dialog: () => null }
        if (id === './staff-shared') return {
          StaffPageHeader: ({ title, description, action }) => element('header', { children: [element('h1', { key: 'h', children: title }), element('p', { key: 'p', children: description }), action] }),
          StaffEmpty: ({ title, description }) => element('section', { children: [element('h2', { key: 'h', children: title }), element('p', { key: 'p', children: description })] }),
          StaffLoading: () => element('p', { role: 'status', children: 'Đang tải' }),
        }
        return require(id)
      },
    }, { filename: filename.pathname, timeout: 2000 })
    cache.set(name, module.exports)
    return module.exports
  }
  return renderToStaticMarkup(React.createElement(load('staff-income.tsx').StaffIncome, { demoEnabled }))
}
const auth = { status: 'authenticated', busy: null, session: { user: { id: '9223372036854775807', role: 'EMPLOYEE', status: 'ACTIVE' }, expiresAt: '2099-01-01T00:00:00.000Z' } }
test('income UI production cannot display illustrative amounts or demo controls even with true flag', () => {
  const html = render('production', true, auth)
  assert.match(html, /data-staff-income="unavailable"/)
  assert.match(html, /Thu nhập chưa khả dụng/)
  assert.match(html, /Chính sách tiền công và quy trình chi trả chính thức chưa được cung cấp/)
  assert.match(html, /Không dùng giá đơn dịch vụ để ước tính lương/)
  assert.doesNotMatch(html, /data-staff-income-total|data-staff-income-assignment-id|data-staff-income-remote|60\.000|DỮ LIỆU MINH HỌA/)
})
test('income UI disabled demo stays unavailable and never claims zero real earnings', () => {
  const html = render('development', false, auth)
  assert.match(html, /Thu nhập chưa khả dụng/)
  assert.doesNotMatch(html, /data-staff-income-total|data-staff-income-remote|0.?₫|60\.000|DỮ LIỆU MINH HỌA/)
})
test('income UI requires Staff authentication and never renders account identity', () => {
  for (const value of [null, { ...auth, status: 'loading' }, { ...auth, status: 'unauthenticated' }, { ...auth, status: 'unavailable' }, { ...auth, session: null }, { ...auth, busy: 'logout' }]) {
    const html = render('development', true, value)
    assert.doesNotMatch(html, /data-staff-income-total|data-staff-income-remote|9223372036854775807/)
  }
})
test('income loading has no banner and does not expose any amount before the real response', () => {
  const html = render('development', true, auth)
  assert.match(html, /data-staff-income-remote="loading"/)
  assert.doesNotMatch(html, /data-staff-income-demo-label|staff-income-demo-notice/)
  assert.doesNotMatch(html, /data-staff-income-total|9223372036854775807|\/api\//)
})
