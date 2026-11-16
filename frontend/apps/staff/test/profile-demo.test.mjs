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
      if (id === './staff-profile-demo-model') return source('staff-profile-demo-model.ts')
      throw Error('Unexpected profile dependency')
    } }, { filename, timeout: 2000 })
    cache.set(name, module.exports); return module.exports
  }
  return { ...source('staff-profile-demo-model.ts'), ...source('staff-profile-demo-adapter.ts') }
}
const plain = value => JSON.parse(JSON.stringify(value))
test('profile demo seed is wholly fictional and contains no Auth/session or QA identity fields', () => {
  const m = load(), seed = m.defaultProfileDemo()
  assert.deepEqual(plain(m.validateProfileDemo(seed)), {})
  assert.equal(seed.fullName, 'Nhân viên Minh Họa'); assert.equal(seed.phone, '0000000000'); assert.match(seed.email, /@example\.invalid$/)
  for (const field of ['id', 'accountId', 'employeeId', 'userId', 'role', 'status', 'password', 'accessToken', 'refreshToken']) assert.equal(field in seed, false)
  assert.ok(seed.certificates.every(c => c.id.startsWith('DEMO-CERT-')))
})
test('profile demo rejects each unknown Auth or account property even if its value is plausible', () => {
  const m = load()
  for (const field of ['id', 'userId', 'accountId', 'employeeId', 'role', 'status', 'password', 'avatarUrl']) assert.ok(m.validateProfileDemo({ ...m.defaultProfileDemo(), [field]: 'unit-unsupported' })._form)
  assert.ok(m.validateProfileDemo(JSON.parse('{"__proto__":{"role":"ADMIN"}}'))._form)
})
test('profile validation requires name/branch/title and limits text, phone, email and years', () => {
  const m = load()
  for (const [field, value] of [['fullName', ' '], ['branch', 'x'], ['jobTitle', 'x'], ['fullName', 'x'.repeat(81)], ['address', 'x'.repeat(241)], ['bio', 'x'.repeat(501)], ['phone', '123'], ['phone', 'abc1234567890'], ['email', 'invalid-email'], ['experienceYears', '-1'], ['experienceYears', '1.5'], ['experienceYears', '51'], ['experienceYears', '']]) assert.ok(m.validateProfileDemo({ ...m.defaultProfileDemo(), [field]: value })[field], field + ':' + value)
  assert.ok(m.validateProfileDemo({ ...m.defaultProfileDemo(), fullName: 'Demo\nname' }).fullName)
})
test('profile validation handles leap days, bounds and reversed certificate expiry', () => {
  const m = load()
  for (const startedOn of ['2023-02-29', '2024-02-30', '1970-12-31', '2100-01-01', '2026-13-01']) assert.ok(m.validateProfileDemo({ ...m.defaultProfileDemo(), startedOn }).startedOn)
  assert.deepEqual(plain(m.validateProfileDemo({ ...m.defaultProfileDemo(), startedOn: '2024-02-29' })), {})
  const data = m.defaultProfileDemo(); data.certificates[0].expiresOn = '2024-12-31'
  assert.ok(m.validateProfileDemo(data)['certificates.0.expiresOn'])
})
test('avatar and employment are allowlisted; skills are unique and bounded', () => {
  const m = load()
  assert.ok(m.validateProfileDemo({ ...m.defaultProfileDemo(), avatar: 'https://outside.invalid/photo' }).avatar)
  assert.ok(m.validateProfileDemo({ ...m.defaultProfileDemo(), employmentType: 'ADMIN' }).employmentType)
  for (const skills of [['HOME', 'HOME'], ['not-a-skill'], ['HOME', 'KITCHEN', 'GLASS', 'LAUNDRY', 'ORGANIZATION', 'HOME']]) assert.ok(m.validateProfileDemo({ ...m.defaultProfileDemo(), skills }).skills)
  assert.deepEqual(plain(m.validateProfileDemo({ ...m.defaultProfileDemo(), skills: [], certificates: [] })), {})
})
test('certificate validation rejects duplicate/non-demo IDs, excessive rows and unsupported metadata', () => {
  const m = load(), seed = m.defaultProfileDemo()
  const cases = [Array(6).fill(seed.certificates[0]), [{ ...seed.certificates[0], id: '100' }], [seed.certificates[0], seed.certificates[0]], [{ ...seed.certificates[0], verified: true }]]
  for (const certificates of cases) assert.ok(Object.keys(m.validateProfileDemo({ ...seed, certificates })).length)
  for (const field of ['title', 'issuer', 'issuedOn']) { const row = { ...seed.certificates[0], [field]: '' }; assert.ok(m.validateProfileDemo({ ...seed, certificates: [row] })['certificates.0.' + field]) }
})
test('normalization trims editable text without changing caller data or inventing information', () => {
  const m = load(), data = m.defaultProfileDemo()
  data.fullName = '  Demo Unit  '; data.phone = '+00 000-000-0000'; data.email = '  demo@example.invalid '; data.skills = []
  const before = JSON.stringify(data), normalized = m.normalizeProfileDemo(data)
  assert.equal(normalized.fullName, 'Demo Unit'); assert.equal(normalized.phone, '+000000000000'); assert.equal(normalized.email, 'demo@example.invalid')
  assert.equal(JSON.stringify(data), before); assert.deepEqual(plain(normalized.skills), [])
})
test('saving updates only the bound adapter and returns detached clones', async () => {
  const m = load(), a = m.createProfileDemoAdapter({ enabled: true, accountScope: '101' }), draft = await a.read()
  draft.fullName = 'Demo Saved A'; const saved = await a.save(draft); saved.fullName = 'Mutated response'
  assert.equal((await a.read()).fullName, 'Demo Saved A'); draft.certificates[0].title = 'Mutated input'
  assert.notEqual((await a.read()).certificates[0].title, 'Mutated input')
})
test('cancel is a discarded draft and never changes the saved record', async () => {
  const m = load(), a = m.createProfileDemoAdapter({ enabled: true, accountScope: '101' }), draft = await a.read()
  draft.fullName = 'Demo Uncommitted'; draft.skills.push('GLASS'); draft.certificates[0].title = 'Unsaved title'
  assert.deepEqual(plain(await a.read()), plain(m.defaultProfileDemo()))
})
test('invalid save fails with field errors and leaves the previous saved value intact', async () => {
  const m = load(), a = m.createProfileDemoAdapter({ enabled: true, accountScope: '101' }), draft = await a.read(); draft.email = 'not-an-email'
  await assert.rejects(a.save(draft), error => error instanceof m.ProfileDemoValidationError && !!error.errors.email)
  assert.deepEqual(plain(await a.read()), plain(m.defaultProfileDemo()))
})
test('account A and B never share mutable state; account ID is not copied into fictional fields', async () => {
  const m = load(), a = m.createProfileDemoAdapter({ enabled: true, accountScope: '9007199254740993' }), b = m.createProfileDemoAdapter({ enabled: true, accountScope: '9007199254740994' })
  const draft = await a.read(); draft.fullName = 'Demo Edited A'; draft.phone = '0000000001'; await a.save(draft)
  assert.equal((await b.read()).fullName, 'Nhân viên Minh Họa'); assert.equal((await b.read()).phone, '0000000000')
  assert.ok(!JSON.stringify(await a.read()).includes('9007199254740993'))
  const bDraft = await b.read(); bDraft.fullName = 'Demo Edited B'; await b.save(bDraft); await a.reset()
  assert.equal((await b.read()).fullName, 'Demo Edited B')
})
test('reset restores the bound seed and new instances model F5, logout and page exit', async () => {
  const m = load(), a = m.createProfileDemoAdapter({ enabled: true, accountScope: '101' }), draft = await a.read(); draft.fullName = 'Demo Saved'; await a.save(draft)
  const fresh = m.createProfileDemoAdapter({ enabled: true, accountScope: '101' })
  assert.deepEqual(plain(await fresh.read()), plain(m.defaultProfileDemo()))
  const reset = await a.reset(); reset.skills.length = 0
  assert.deepEqual(plain(await a.read()), plain(m.defaultProfileDemo()))
})
test('aborted save and reset cannot commit to the private record', async () => {
  const m = load(), a = m.createProfileDemoAdapter({ enabled: true, accountScope: '101' }), draft = await a.read(); draft.fullName = 'Demo Pending'
  const saveAbort = new AbortController(), pendingSave = a.save(draft, saveAbort.signal); saveAbort.abort()
  await assert.rejects(pendingSave, { name: 'AbortError' }); assert.equal((await a.read()).fullName, 'Nhân viên Minh Họa')
  await a.save(draft)
  const resetAbort = new AbortController(), pendingReset = a.reset(resetAbort.signal); resetAbort.abort()
  await assert.rejects(pendingReset, { name: 'AbortError' }); assert.equal((await a.read()).fullName, 'Demo Pending')
  const readAbort = new AbortController(); readAbort.abort(); await assert.rejects(a.read(readAbort.signal), { name: 'AbortError' })
})
test('production/test/undefined environment and disabled flags expose no demo data', async () => {
  for (const env of ['production', 'test', undefined]) { const m = env === undefined ? load('production', { process: { env: {} } }) : load(env), adapter = m.createProfileDemoAdapter({ enabled: true, accountScope: '101' }); assert.equal(adapter.kind, 'unavailable'); assert.equal(await adapter.read(), null); assert.equal(await adapter.reset(), null); await assert.rejects(adapter.save(m.defaultProfileDemo()), { name: 'ProfileDemoUnavailableError' }) }
  const m = load(); for (const enabled of [false, 'true', 1, undefined]) assert.equal(m.createProfileDemoAdapter({ enabled, accountScope: '101' }).kind, 'unavailable')
})
test('malformed, repeated or imprecise account scopes never activate an adapter', async () => {
  const m = load()
  for (const accountScope of ['', '0', '01', '-1', '101,102', '9223372036854775808', 101, null]) assert.equal(m.createProfileDemoAdapter({ enabled: true, accountScope }).kind, 'unavailable')
})
test('adapter is entirely local and uses no browser storage, credential, network or query', async () => {
  const forbidden = () => { throw Error('Forbidden external capability') }
  const m = load('development', { fetch: forbidden, XMLHttpRequest: forbidden, localStorage: { getItem: forbidden, setItem: forbidden }, sessionStorage: { getItem: forbidden, setItem: forbidden }, document: new Proxy({}, { get: forbidden }), window: new Proxy({}, { get: forbidden }) })
  const a = m.createProfileDemoAdapter({ enabled: true, accountScope: '101' }), draft = await a.read(); draft.fullName = 'Demo Local'
  await a.save(draft); await a.reset(); assert.equal((await a.read()).fullName, 'Nhân viên Minh Họa')
})
