import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
const require = createRequire(import.meta.url), React = require('react'), ts = require('typescript')
const { renderToStaticMarkup } = require('react-dom/server'), root = new URL('../../../packages/ui/src/components/staff/', import.meta.url), cache = new Map()
function source(name) {
  if (cache.has(name)) return cache.get(name)
  const module = { exports: {} }, code = ts.transpileModule(readFileSync(new URL(name, root), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
  vm.runInNewContext(code, { module, exports: module.exports, BigInt, fetch() { throw Error('No approved Auth endpoint') }, require(id) {
    if (id === './staff-profile-edit-model') return source('staff-profile-edit-model.ts')
    if (id === '@/components/ui/button') return { Button: ({ variant, ...props }) => React.createElement('button', props) }
    return require(id)
  } }, { timeout: 2000 }); cache.set(name, module.exports); return module.exports
}
const m = source('staff-profile-edit-model.ts'), Editor = source('staff-profile-editor.tsx').StaffProfileEditor
const own = { id: '100', revision: 'revision-1', fullName: 'QA Staff', phone: '+84900000001', email: 'qa@example.invalid' }
const draft = { fullName: ' QA Staff ', phone: '+84 900 000 001', email: 'qa@example.invalid' }
test('profile parser binds account A/B and strips privilege and secret fields', () => {
  assert.equal(m.parseEditableStaffProfile(own, '200'), null)
  const value = { ...own, role: 'ADMIN', status: 'ACTIVE', password: 'PRIVATE_MARKER', token: 'PRIVATE_MARKER', employeeId: '8' }
  assert.deepEqual(JSON.parse(JSON.stringify(m.parseEditableStaffProfile(value, '100'))), own)
})
test('profile parser rejects incomplete, invalid and stale-response identity metadata', () => {
  for (const change of [{ id: '0100' }, { revision: '' }, { revision: 'bad revision' }, { fullName: undefined }, { phone: 123 }, { email: '\n' }]) assert.equal(m.parseEditableStaffProfile({ ...own, ...change }, '100'), null)
})
test('profile validation trims and only emits explicitly permitted fields', () => {
  const result = m.validateStaffProfileDraft({ ...draft, role: 'ADMIN', employeeId: '8' }, ['fullName'])
  assert.equal(result.valid, true); assert.deepEqual(JSON.parse(JSON.stringify(result.changes)), { fullName: 'QA Staff' })
  assert.throws(() => m.validateStaffProfileDraft(draft, ['role']), /UNSUPPORTED_PROFILE_FIELD/)
  assert.equal(m.validateStaffProfileDraft(draft, []).valid, false)
})
test('profile validation rejects blank names, unsafe controls and malformed phone/email', () => {
  assert.equal(m.validateStaffProfileDraft(draft, ['fullName', 'phone', 'email']).valid, true)
  for (const [field, invalid] of [['fullName', '   '], ['fullName', 'x'.repeat(101)], ['fullName', 'A\nB'], ['phone', 'not-a-phone'], ['phone', '1234'], ['phone', '9'.repeat(16)], ['email', 'not-an-email'], ['email', 'a@b'], ['email', 'a b@example.invalid']]) assert.equal(m.validateStaffProfileDraft({ ...draft, [field]: invalid }, [field]).valid, false)
})
test('profile API errors remain safe and distinguish permissions, conflict, verification and throttling', () => {
  const messages = new Set()
  for (const status of [401, 409, 422, 429, 500]) { const text = m.staffProfileSaveError({ status, message: 'PRIVATE_PROVIDER_STACK' }); assert.doesNotMatch(text, /PRIVATE_/); messages.add(text) }
  assert.equal(messages.size, 5)
})
test('profile form is locked without a real approved profile and callback', () => {
  for (const props of [{}, { profile: own }, { profile: own, editableFields: ['fullName'] }, { profile: { ...own, id: '200' }, editableFields: ['fullName'], onSave() { throw Error('Must not run') } }]) {
    const html = renderToStaticMarkup(React.createElement(Editor, { accountId: '100', onCancel() {}, ...props }))
    assert.match(html, /fieldset disabled/); assert.match(html, /button disabled=""[^>]*data-staff-settings-profile-save/)
    assert.doesNotMatch(html, /name="(?:role|status|employeeId)"|Đã lưu thay đổi/)
  }
})
test('future approved profile form enables only Auth-allowlisted fields, without a render-time request', () => {
  const html = renderToStaticMarkup(React.createElement(Editor, { accountId: '100', profile: own, editableFields: ['fullName'], onSave() { throw Error('No request during render') }, onCancel() {} }))
  assert.doesNotMatch(html, /fieldset disabled/)
  const inputs = [...html.matchAll(/<input\b[^>]*>/g)].map(match => match[0])
  for (const field of ['phone', 'email']) assert.match(inputs.find(input => input.includes(`name="profile-${field}"`)), /disabled/)
  assert.doesNotMatch(inputs.find(input => input.includes('name="profile-fullName"')), /disabled/)
  assert.doesNotMatch(html, /Đã lưu thay đổi/)
})
