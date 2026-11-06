import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
const require = createRequire(import.meta.url), ts = require('typescript'), module = { exports: {} }
const path = new URL('../../../packages/ui/src/components/staff/staff-notification-view-preferences.ts', import.meta.url)
vm.runInNewContext(ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, { module, exports: module.exports, require, BigInt }, { timeout: 2000 })
const m = module.exports
function storage() { const values = new Map([['unrelated', 'preserve']]); return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) } }
test('notification view stores only one boolean, rejecting credentials or malformed values', () => {
  for (const raw of [null, '', '[]', '{}', 'true', '{"unreadOnly":1}', '{"unreadOnly":true,"password":"secret"}', '{"unreadOnly":true,"__proto__":{}}', 'x'.repeat(81)]) assert.equal(m.parseStaffNotificationView(raw), null)
  assert.equal(m.parseStaffNotificationView('{"unreadOnly":true}').unreadOnly, true)
})
test('A/B keys are isolated, and reset never clears session or another account preference', () => {
  const s = storage()
  assert.equal(m.saveStaffNotificationView(s, '100', true), true)
  assert.equal(m.loadStaffNotificationView(s, '100').unreadOnly, true)
  assert.equal(m.loadStaffNotificationView(s, '200').unreadOnly, false)
  assert.equal(m.saveStaffNotificationView(s, '200', true), true)
  assert.equal(m.resetStaffNotificationView(s, '100'), true)
  assert.equal(m.loadStaffNotificationView(s, '200').unreadOnly, true)
  assert.equal(s.values.get('unrelated'), 'preserve')
})
test('storage failure or silent write does not claim saved; invalid account cannot read or write', () => {
  const blocked = () => { throw Error('blocked') }
  assert.equal(m.loadStaffNotificationView({ getItem: blocked }, '100').persistence, 'temporary')
  assert.equal(m.saveStaffNotificationView({ setItem() {}, getItem: () => null }, '100', true), false)
  assert.equal(m.saveStaffNotificationView({ setItem: blocked }, '100', true), false)
  for (const id of ['', '0', '../1', '9223372036854775808', 100, null]) {
    assert.equal(m.staffNotificationViewKey(id), null)
    assert.equal(m.saveStaffNotificationView({ setItem: blocked }, id, true), false)
  }
  assert.equal(m.resetStaffNotificationView({ removeItem() {}, getItem: () => 'retained' }, '100'), false)
})
