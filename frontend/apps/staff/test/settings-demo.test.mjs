import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import test from 'node:test'
const require = createRequire(import.meta.url), ts = require('typescript')
const root = new URL('../../../packages/ui/src/components/staff/', import.meta.url)
function load(environment = 'development', globals = {}) {
  const cache = new Map()
  function source(name) {
    if (cache.has(name)) return cache.get(name)
    const filename = fileURLToPath(new URL(name, root)), module = { exports: {} }
    const code = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText
    vm.runInNewContext(code, { module, exports: module.exports, AbortController, DOMException, process: { env: { NODE_ENV: environment } }, ...globals, require(id) {
      if (id === './staff-settings-demo-model') return source('staff-settings-demo-model.ts')
      throw Error('Unexpected settings demo dependency')
    } }, { filename, timeout: 2000 })
    cache.set(name, module.exports); return module.exports
  }
  return { ...source('staff-settings-demo-model.ts'), ...source('staff-settings-demo-adapter.ts') }
}
const plain = value => JSON.parse(JSON.stringify(value))
const adapter = (m, accountScope = '101') => m.createSettingsDemoAdapter({ enabled: true, accountScope })

test('default demo settings are deterministic, fictional and contain no account or secret fields', () => {
  const m = load(), value = m.defaultDemoSettings()
  assert.deepEqual(plain(value), {
    notifications: { shiftReminder: true, supportUpdates: true, weeklyDigest: false },
    display: { listDensity: 'comfortable', showReferenceCode: true },
    privacy: { maskPreviewName: true },
  })
  for (const key of ['password', 'token', 'cookie', 'email', 'phone', 'userId', 'employeeId', 'role', 'permissions', 'session']) assert.equal(key in value, false)
  value.notifications.shiftReminder = false
  assert.equal(m.defaultDemoSettings().notifications.shiftReminder, true)
  assert.match(m.SETTINGS_DISCLAIMER, /không đồng bộ tài khoản/i)
  assert.match(m.SETTINGS_DISCLAIMER, /mật khẩu/i)
})

test('settings validation refuses unknown fields and wrong types', () => {
  const m = load(), value = m.defaultDemoSettings()
  for (const next of [
    null, [], {}, { ...value, extra: true }, { ...value, notifications: { ...value.notifications, extra: true } },
    { ...value, notifications: { ...value.notifications, shiftReminder: 'true' } },
    { ...value, display: { ...value.display, listDensity: 'wide' } },
    { ...value, display: { ...value.display, showReferenceCode: 1 } },
    { ...value, privacy: { ...value.privacy, maskPreviewName: 'yes' } },
    { ...value, privacy: { ...value.privacy, password: 'unit-only-secret' } },
  ]) assert.throws(() => m.validateDemoSettings(next), { name: 'SettingsDemoError' })
  assert.deepEqual(plain(m.validateDemoSettings(value)), plain(value))
})

test('preview applies only to the demo card and never exposes private data', () => {
  const m = load(), base = m.defaultDemoSettings()
  const masked = m.demoSettingsPreview(base)
  assert.equal(masked.name, 'N. M. A.'); assert.equal(masked.masked, true)
  assert.equal(masked.referenceCode, 'DEMO-CV-1042'); assert.equal(masked.density, 'comfortable')
  assert.deepEqual(plain(masked.notificationSummary), ['Nhắc lịch ca làm (DEMO)', 'Cập nhật yêu cầu hỗ trợ (DEMO)'])
  const open = m.demoSettingsPreview({ ...base, privacy: { maskPreviewName: false }, display: { listDensity: 'compact', showReferenceCode: false }, notifications: { shiftReminder: false, supportUpdates: false, weeklyDigest: false } })
  assert.equal(open.name, 'Nguyễn Minh Anh'); assert.equal(open.masked, false)
  assert.equal(open.referenceCode, null); assert.equal(open.density, 'compact')
  assert.deepEqual(plain(open.notificationSummary), ['Không bật thông báo DEMO nào.'])
  const text = JSON.stringify(masked) + JSON.stringify(open)
  for (const forbidden of ['@', 'password', 'token', 'cookie', 'session', '090', 'employeeId', 'userId']) assert.equal(text.includes(forbidden), false)
})

test('update and reset are scoped to the account instance and cannot mutate returned objects', async () => {
  const m = load(), a = adapter(m, '9007199254740993'), b = adapter(m, '9007199254740994')
  const next = { ...m.defaultDemoSettings(), notifications: { shiftReminder: false, supportUpdates: false, weeklyDigest: true }, display: { listDensity: 'compact', showReferenceCode: false }, privacy: { maskPreviewName: false } }
  const updated = await a.update(next)
  assert.deepEqual(plain(updated), plain(next))
  updated.notifications.weeklyDigest = false
  assert.equal((await a.read()).notifications.weeklyDigest, true)
  assert.deepEqual(plain(await b.read()), plain(m.defaultDemoSettings()))
  const reset = await a.reset()
  assert.deepEqual(plain(reset), plain(m.defaultDemoSettings()))
  assert.deepEqual(plain(await b.read()), plain(m.defaultDemoSettings()))
  const fresh = await adapter(m, '9007199254740994').read()
  assert.deepEqual(plain(fresh), plain(m.defaultDemoSettings()))
})

test('aborted reads updates and resets cannot commit state', async () => {
  const m = load(), a = adapter(m), initial = await a.read()
  const next = { ...m.defaultDemoSettings(), notifications: { shiftReminder: false, supportUpdates: false, weeklyDigest: false } }
  for (const operation of [s => a.read(s), s => a.update(next, s), s => a.reset(s)]) {
    const controller = new AbortController(), promise = operation(controller.signal); controller.abort()
    await assert.rejects(promise, { name: 'AbortError' })
    assert.deepEqual(plain(await a.read()), plain(initial))
  }
})

test('development flag and canonical account scopes fail closed for every other mode', async () => {
  for (const environment of ['production', 'test', '']) {
    const m = load(environment), a = adapter(m)
    assert.equal(a.kind, 'unavailable')
    assert.equal(await a.read(), null)
    assert.equal(await a.update(m.defaultDemoSettings()), null)
    assert.equal(await a.reset(), null)
  }
  const m = load()
  for (const enabled of [false, 'true', 1, undefined]) assert.equal(m.createSettingsDemoAdapter({ enabled, accountScope: '101' }).kind, 'unavailable')
  for (const accountScope of ['', '0', '01', '-1', '101,102', '9223372036854775808', 101, null]) assert.equal(m.createSettingsDemoAdapter({ enabled: true, accountScope }).kind, 'unavailable')
})

test('demo settings never need network browser storage Auth or real account capabilities', async () => {
  const forbidden = () => { throw Error('Forbidden external capability') }
  const m = load('development', { fetch: forbidden, XMLHttpRequest: forbidden, localStorage: { getItem: forbidden, setItem: forbidden, removeItem: forbidden }, sessionStorage: { getItem: forbidden, setItem: forbidden }, navigator: new Proxy({}, { get: forbidden }), window: new Proxy({}, { get: forbidden }), document: new Proxy({}, { get: forbidden }) })
  const a = adapter(m)
  const value = await a.update({ ...m.defaultDemoSettings(), privacy: { maskPreviewName: false } })
  assert.equal(value.privacy.maskPreviewName, false)
  assert.equal((await a.reset()).privacy.maskPreviewName, true)
})
