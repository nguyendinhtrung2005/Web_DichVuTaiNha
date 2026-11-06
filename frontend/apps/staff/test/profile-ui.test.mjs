import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'

const require = createRequire(import.meta.url), ts = require('typescript'), React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
let auth
const element = (tag, props, children) => React.createElement(tag, props, children)
const module = { exports: {} }
const filename = new URL('../../../packages/ui/src/components/staff/staff-profile-remote.tsx', import.meta.url)
const output = ts.transpileModule(readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText
vm.runInNewContext(output, {
  module, exports: module.exports,
  fetch() { throw Error('Profile must not call an unapproved API') },
  require(id) {
    if (id === './staff-profile-demo') return { StaffProfileDemo: () => null }
    if (id === './staff-auth-session') return { useStaffAuth: () => auth }
    if (id === './staff-shared') return {
      StaffPageHeader: ({ title, description }) => element('header', {}, [element('h1', { key: 'h' }, title), element('p', { key: 'p' }, description)]),
      StaffEmpty: ({ title, description }) => element('section', {}, [element('h2', { key: 'h' }, title), element('p', { key: 'p' }, description)]),
    }
    if (id === '@/components/shared/area-routes') return { AreaLink: ({ children, ...props }) => element('a', props, children) }
    if (id === '@/components/shared/status-badge') return { ToneBadge: ({ children }) => element('span', {}, children) }
    if (id === '@/components/ui/card') return {
      Card: ({ children, ...props }) => element('section', props, children),
      CardContent: ({ children }) => element('div', {}, children),
    }
    if (id === '@/components/ui/button') return {
      Button: ({ render, nativeButton, variant, children, ...props }) => render ? React.cloneElement(render, props, children) : element('button', props, children),
    }
    if (['react/jsx-runtime', 'lucide-react'].includes(id)) return require(id)
    throw Error('Unexpected profile dependency')
  },
}, { timeout: 2000 })
const session = id => ({ user: { id, role: 'EMPLOYEE', status: 'ACTIVE' }, expiresAt: '2099-01-01T00:00:00.000Z', renewable: true })
const render = value => { auth = value; return renderToStaticMarkup(React.createElement(module.exports.StaffProfileRemote)) }
const authenticated = id => ({ status: 'authenticated', session: session(id), busy: null })

test('profile preserves BIGINT account identity without treating it as an employee code', () => {
  const value = authenticated('9223372036854775807'), before = JSON.stringify(value)
  const html = render(value)
  assert.match(html, /data-profile-account-id="9223372036854775807"/)
  assert.match(html, /Mã tài khoản/)
  assert.match(html, /Nhân viên/)
  assert.match(html, /Trạng thái tài khoản/)
  assert.match(html, /Đang hoạt động/)
  assert.doesNotMatch(html, /Mã nhân viên|Sẵn sàng nhận việc|Đang nhận việc/)
  assert.equal(JSON.stringify(value), before)
})

test('non-authenticated, unavailable, missing session and logout never render personal identity', () => {
  for (const status of ['loading', 'unavailable', 'unauthenticated']) assert.equal(render({ ...authenticated('100'), status }), '')
  assert.equal(render(null), '')
  assert.equal(render({ status: 'authenticated', session: null, busy: null }), '')
  assert.equal(render({ ...authenticated('100'), busy: 'logout' }), '')
})

test('only public identity is rendered; unknown personal fields, credentials and session metadata stay private', () => {
  const value = authenticated('101')
  const markers = ['unit-only-name', 'unit-only-phone', 'unit-only-email', 'unit-only-avatar', 'unit-only-employee', 'unit-only-password', 'unit-only-token', 'unit-only-refresh']
  Object.assign(value.session.user, Object.fromEntries(['name', 'phone', 'email', 'avatar', 'employeeId', 'password', 'accessToken', 'refreshToken'].map((name, index) => [name, markers[index]])))
  const html = render(value)
  for (const marker of [...markers, value.session.expiresAt]) assert.ok(!html.includes(marker))
  assert.doesNotMatch(html, /renewable|localStorage|sessionStorage/)
  assert.match(html, /Chưa có thông tin hồ sơ/)
})

test('account changes immediately replace the previous identity without cached profile data', () => {
  assert.match(render(authenticated('9007199254740992')), /data-profile-account-id="9007199254740992"/)
  const next = render(authenticated('9007199254740993'))
  assert.match(next, /data-profile-account-id="9007199254740993"/)
  assert.ok(!next.includes('9007199254740992'))
})

test('profile offers only existing work destinations and no unsupported mutation controls', () => {
  const html = render(authenticated('102'))
  assert.deepEqual([...html.matchAll(/href="([^"]+)"/g)].map(match => match[1]), ['/cong-viec', '/lich-lam-viec', '/lich-su', '/thong-ke-cong-viec', '/thu-nhap', '/khu-vuc', '/thanh-tich', '/ho-tro', '/cai-dat'])
  assert.doesNotMatch(html, /<(?:input|form|button)\b|Chỉnh sửa|Đổi mật khẩu|Tải ảnh|Upload|\/api\//)
  assert.match(html, /đăng xuất từ menu tài khoản/)
})
