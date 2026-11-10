import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
const require = createRequire(import.meta.url), ts = require('typescript'), module = { exports: {} }
const filename = new URL('../../../packages/ui/src/components/staff/staff-display-preferences.tsx', import.meta.url)
vm.runInNewContext(ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText,
  { module, exports: module.exports, require(id) { if (['react', 'react/jsx-runtime'].includes(id)) return require(id); throw Error('Unexpected preference dependency') } }, { timeout: 2000 })
const m = module.exports, plain = x => JSON.parse(JSON.stringify(x))
function storage() {
  const values = new Map([['unrelated', 'unit-only-unrelated']]), touched = []
  return { values, touched, getItem(k) { return values.get(k) ?? null }, setItem(k, v) { touched.push(k); values.set(k, v) }, removeItem(k) { touched.push(k); values.delete(k) } }
}
test('browser defaults and read do not create or repair stored data', () => {
  const s = storage()
  assert.deepEqual(plain(m.loadStaffDisplayPreferences(s)), { preferences: { motion: 'system', focus: 'standard' }, persistence: 'default' })
  assert.equal(s.touched.length, 0)
  s.values.set(m.STAFF_DISPLAY_KEY, '{invalid')
  assert.equal(m.loadStaffDisplayPreferences(s).persistence, 'default')
  assert.equal(s.values.get(m.STAFF_DISPLAY_KEY), '{invalid')
  assert.equal(s.touched.length, 0)
})
test('preference parser accepts only two display enums, no identity or remote data', () => {
  for (const value of [null, '', '[]', '{}', 'null', 'a'.repeat(257), '{"motion":"reduce","focus":"strong","userId":"1"}', '{"motion":"reduce","focus":"strong","session":"unit-only"}', '{"motion":"reduce","focus":"strong","__proto__":{}}', '{"motion":"other","focus":"standard"}', '{"motion":"reduce","focus":true}']) assert.equal(m.parseStaffDisplayPreferences(value), null)
  assert.deepEqual(plain(m.parseStaffDisplayPreferences('{"motion":"reduce","focus":"strong"}')), { motion: 'reduce', focus: 'strong' })
})
test('save verifies read-back and writes only the isolated display key', () => {
  const s = storage(), preferences = Object.freeze({ motion: 'reduce', focus: 'strong' })
  assert.equal(m.saveStaffDisplayPreferences(s, preferences), true)
  assert.deepEqual(JSON.parse(s.values.get(m.STAFF_DISPLAY_KEY)), preferences)
  assert.deepEqual(s.touched, [m.STAFF_DISPLAY_KEY])
  assert.equal(s.values.get('unrelated'), 'unit-only-unrelated')
  assert.deepEqual(plain(m.loadStaffDisplayPreferences(s)), { preferences, persistence: 'saved' })
  assert.equal(m.saveStaffDisplayPreferences(s, { ...preferences, accessToken: 'unit-only-not-a-token' }), false)
  assert.deepEqual(s.touched, [m.STAFF_DISPLAY_KEY])
})
test('unavailable storage and silent write failure never report saved', () => {
  const fail = () => { throw Error('storage-blocked') }
  assert.equal(m.loadStaffDisplayPreferences({ getItem: fail }).persistence, 'temporary')
  const p = { motion: 'reduce', focus: 'strong' }
  assert.equal(m.saveStaffDisplayPreferences({ getItem: () => null, setItem: fail }, p), false)
  assert.equal(m.saveStaffDisplayPreferences({ getItem: () => null, setItem: () => {} }, p), false)
  assert.equal(m.saveStaffDisplayPreferences({ getItem: fail, setItem: () => {} }, p), false)
})
test('reset removes only display preferences and verifies actual removal', () => {
  const s = storage()
  m.saveStaffDisplayPreferences(s, { motion: 'reduce', focus: 'strong' })
  assert.equal(m.resetStaffDisplayPreferences(s), true)
  assert.equal(s.values.has(m.STAFF_DISPLAY_KEY), false)
  assert.equal(s.values.get('unrelated'), 'unit-only-unrelated')
  assert.ok(s.touched.every(k => k === m.STAFF_DISPLAY_KEY))
  assert.equal(m.resetStaffDisplayPreferences({ removeItem() {}, getItem: () => 'still-present' }), false)
  assert.equal(m.resetStaffDisplayPreferences({ removeItem() { throw Error('blocked') }, getItem: () => null }), false)
})
test('loading malformed preferences does not mutate defaults or leak untrusted values', () => {
  const before = JSON.stringify(m.DEFAULT_STAFF_DISPLAY), s = storage()
  s.values.set(m.STAFF_DISPLAY_KEY, '{"motion":"reduce","focus":"strong","password":"unit-only-secret-marker"}')
  const result = m.loadStaffDisplayPreferences(s)
  assert.deepEqual(plain(result.preferences), { motion: 'system', focus: 'standard' })
  result.preferences.motion = 'reduce'
  assert.equal(JSON.stringify(m.DEFAULT_STAFF_DISPLAY), before)
  assert.ok(!JSON.stringify(result).includes('unit-only-secret-marker'))
})
