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
      if (id === './staff-areas-demo-model') return source('staff-areas-demo-model.ts')
      throw Error('Unexpected areas demo dependency')
    } }, { filename, timeout: 2000 })
    cache.set(name, module.exports); return module.exports
  }
  return { ...source('staff-areas-demo-model.ts'), ...source('staff-areas-demo-adapter.ts') }
}
const plain = value => JSON.parse(JSON.stringify(value)), WEEK = '2026-11-02'
const clock = () => new Date('2026-10-30T04:30:00.000Z')
const adapter = (m, accountScope = '101', now = clock) => m.createAreasDemoAdapter({ enabled: true, accountScope, now })
const find = (snapshot, area = 'DEMO-AREA-CENTRE', day = WEEK, label = 'Ca sáng') => snapshot.shifts.find(s => s.areaId === area && s.date === day && s.label === label)

test('areas and weekly shifts are fictional deterministic unique data, not staff/booking facts', () => {
  const m = load(), areas = m.demoAreas(), shifts = m.demoShifts(WEEK)
  assert.equal(areas.length, 3); assert.equal(areas.filter(a => a.status === 'ACTIVE').length, 2)
  assert.equal(shifts.length, 42); assert.equal(new Set(shifts.map(s => s.id)).size, 42)
  assert.equal(shifts.filter(s => s.status === 'FULL').length, 1); assert.equal(shifts.filter(s => s.status === 'CANCELLED').length, 1)
  for (const a of areas) assert.match(a.description, /giả lập/)
  for (const s of shifts) { assert.ok(s.id.startsWith('DEMO-SHIFT-')); assert.deepEqual(plain(m.validateShift(s)), plain(s)); assert.ok(areas.some(a => a.id === s.areaId && a.status === 'ACTIVE')) }
  for (const item of [...areas, ...shifts]) for (const key of ['userId', 'employeeId', 'assignmentId', 'bookingId', 'address', 'phone', 'password', 'accessToken']) assert.equal(key in item, false)
  areas[0].name = 'Mutated'; shifts[0].label = 'Changed'; assert.notEqual(m.demoAreas()[0].name, 'Mutated'); assert.notEqual(m.demoShifts(WEEK)[0].label, 'Changed')
})

test('Vietnam date/week/time helpers preserve inclusive calendar days across month year and leap boundaries', () => {
  const m = load()
  assert.equal(m.vietnamDate(new Date('2026-10-31T17:00:00.000Z')), '2026-11-01')
  assert.equal(m.vietnamDate(new Date('2026-12-31T17:00:00.000Z')), '2027-01-01')
  assert.equal(m.weekStart('2026-11-01'), '2026-10-26'); assert.equal(m.weekStart(WEEK), WEEK)
  assert.equal(m.weekStart('2027-01-01'), '2026-12-28')
  assert.equal(m.addDays('2028-02-28', 1), '2028-02-29'); assert.equal(m.addDays('2028-02-29', 1), '2028-03-01')
  assert.equal(m.formatDay('2026-11-02'), '02/11/2026'); assert.equal(m.formatShiftTime('2026-11-02T01:00:00.000Z'), '08:00')
  const yearWeek = m.demoShifts('2026-12-28'); assert.equal(yearWeek.at(-1).date, '2027-01-03')
  assert.equal(m.demoShifts('2028-02-28').filter(s => s.date === '2028-02-29').length, 6)
})

test('date helpers reject invalid dates ranges non-Monday weeks and unsafe increments', () => {
  const m = load()
  for (const date of ['2026-02-29', '2028-02-30', '2026-1-02', '1970-12-31', '2100-01-01', '2026-11-02T00:00:00Z', '', null]) { assert.equal(m.isAreasDate(date), false); assert.throws(() => m.weekStart(date), { name: 'AreasDemoError' }) }
  for (const amount of [1.5, NaN, Infinity, 36601]) assert.throws(() => m.addDays(WEEK, amount), { name: 'AreasDemoError' })
  assert.throws(() => m.demoShifts('2026-11-03'), { name: 'AreasDemoError' }); assert.throws(() => m.vietnamDate(new Date('invalid')), { name: 'AreasDemoError' })
  assert.equal(m.formatDay('bad'), 'Ngày không hợp lệ'); assert.equal(m.formatShiftTime('bad'), 'Giờ không hợp lệ')
})

test('preference validation permits an honest empty unavailable selection and clones allowed fields', () => {
  const m = load(), value = { selectedAreaIds: ['DEMO-AREA-CENTRE', 'DEMO-AREA-GARDEN'], available: true }, next = m.validatePreferences(value)
  assert.deepEqual(plain(next), value); next.selectedAreaIds.pop(); assert.equal(value.selectedAreaIds.length, 2)
  assert.deepEqual(plain(m.validatePreferences({ selectedAreaIds: [], available: false })), { selectedAreaIds: [], available: false })
  assert.deepEqual(plain(m.defaultAreaPreferences()), { selectedAreaIds: ['DEMO-AREA-CENTRE'], available: false })
})

test('preference validation refuses paused unknown duplicate areas bad availability and Auth fields', () => {
  const m = load(), valid = { selectedAreaIds: ['DEMO-AREA-CENTRE'], available: false }
  for (const value of [null, [], {}, { ...valid, accountId: '101' }, { ...valid, status: 'ACTIVE' }, { ...valid, available: 'true' }, { ...valid, selectedAreaIds: ['DEMO-AREA-RIVER'] }, { ...valid, selectedAreaIds: ['DEMO-AREA-UNKNOWN'] }, { ...valid, selectedAreaIds: ['DEMO-AREA-CENTRE', 'DEMO-AREA-CENTRE'] }, { selectedAreaIds: [], available: true }, { selectedAreaIds: 'DEMO-AREA-CENTRE', available: false }]) assert.throws(() => m.validatePreferences(value), { name: 'AreasDemoError' })
})

test('shift validation refuses malformed times end-before-start date mismatch overnight and invalid status', () => {
  const m = load(), shift = m.demoShifts(WEEK)[0]
  for (const value of [null, {}, { ...shift, id: '1' }, { ...shift, areaId: 'DEMO-AREA-RIVER' }, { ...shift, status: 'ACTIVE' }, { ...shift, label: '' }, { ...shift, startAt: shift.endAt }, { ...shift, endAt: shift.startAt }, { ...shift, startAt: '2026-11-02T08:00:00+07:00' }, { ...shift, date: '2026-11-03' }, { ...shift, endAt: '2026-11-02T18:00:00.000Z' }]) assert.throws(() => m.validateShift(value), { name: 'AreasDemoError' })
})

test('overlap uses real intervals and allows touching boundaries without treating areas separately', () => {
  const m = load(), interval = (startAt, endAt) => ({ startAt, endAt }), a = interval('2026-11-02T01:00:00.000Z', '2026-11-02T05:00:00.000Z')
  assert.equal(m.shiftsOverlap(a, a), true)
  assert.equal(m.shiftsOverlap(a, interval('2026-11-02T04:00:00.000Z', '2026-11-02T06:00:00.000Z')), true)
  assert.equal(m.shiftsOverlap(a, interval('2026-11-02T05:00:00.000Z', '2026-11-02T09:00:00.000Z')), false)
  assert.equal(m.shiftsOverlap(a, interval('2026-11-01T21:00:00.000Z', '2026-11-02T01:00:00.000Z')), false)
  assert.throws(() => m.shiftsOverlap(a, interval('bad', 'bad')), { name: 'AreasDemoError' })
})

test('read detail and returned arrays cannot mutate private data or register a shift', async () => {
  const m = load(), a = adapter(m), value = await a.read(WEEK), id = value.shifts[0].id
  assert.equal(value.weekTo, '2026-11-08'); assert.equal(value.preferences.available, false); assert.equal(value.registeredShiftIds.length, 0)
  value.areas[0].name = 'Changed'; value.preferences.selectedAreaIds.length = 0; value.shifts.length = 0; value.registeredShiftIds.push(id)
  const detail = await a.detail(id, WEEK); detail.label = 'Changed'
  const next = await a.read(WEEK); assert.equal(next.shifts.length, 42); assert.notEqual(next.areas[0].name, 'Changed'); assert.notEqual(next.shifts[0].label, 'Changed'); assert.equal(next.preferences.selectedAreaIds.length, 1); assert.equal(next.registeredShiftIds.length, 0)
  assert.equal(await a.detail('DEMO-SHIFT-UNKNOWN', WEEK), null)
})

test('saved readiness is independent from Auth ACTIVE and does not gate registration', async () => {
  const m = load(), a = adapter(m), initial = await a.read(WEEK), id = find(initial).id
  assert.equal(initial.preferences.available, false)
  const registered = await a.register(id, WEEK); assert.equal(registered.preferences.available, false); assert.deepEqual(plain(registered.registeredShiftIds), [id])
  await a.savePreferences({ selectedAreaIds: ['DEMO-AREA-CENTRE'], available: true }, WEEK); assert.equal((await a.read(WEEK)).preferences.available, true)
  const off = await a.savePreferences({ selectedAreaIds: ['DEMO-AREA-CENTRE'], available: false }, WEEK); assert.deepEqual(plain(off.registeredShiftIds), [id])
})

test('register cancel and repeated register alter only one private demo registration', async () => {
  const m = load(), a = adapter(m), initial = await a.read(WEEK), id = find(initial).id
  const after = await a.register(id, WEEK); assert.equal(after.registeredShiftIds.length, 1); assert.deepEqual(plain(after.shifts), plain(initial.shifts))
  assert.deepEqual(plain(await a.register(id, WEEK)), plain(after)); assert.deepEqual(plain((await a.cancel(id, WEEK)).registeredShiftIds), [])
  await assert.rejects(a.cancel(id, WEEK), { name: 'AreasDemoError' }); assert.deepEqual(plain((await a.read(WEEK)).registeredShiftIds), [])
})

test('register refuses nonselected full cancelled unknown and already started shifts without mutation', async () => {
  const m = load(), a = adapter(m), initial = await a.read(WEEK)
  for (const id of [find(initial, 'DEMO-AREA-GARDEN').id, initial.shifts.find(s => s.status === 'FULL').id, initial.shifts.find(s => s.status === 'CANCELLED').id, 'DEMO-SHIFT-UNKNOWN']) { await assert.rejects(a.register(id, WEEK), { name: 'AreasDemoError' }); assert.deepEqual(plain(await a.read(WEEK)), plain(initial)) }
  const past = adapter(m, '102', () => new Date('2026-11-02T01:00:00.000Z'))
  await assert.rejects(past.register(find(initial).id, WEEK), { name: 'AreasDemoError' }); assert.equal((await past.read(WEEK)).registeredShiftIds.length, 0)
})

test('cross-area conflicts and concurrent registrations cannot create overlapping shifts', async () => {
  const m = load(), a = adapter(m), initial = await a.savePreferences({ selectedAreaIds: ['DEMO-AREA-CENTRE', 'DEMO-AREA-GARDEN'], available: false }, WEEK), first = find(initial), overlap = find(initial, 'DEMO-AREA-GARDEN')
  const results = await Promise.allSettled([a.register(first.id, WEEK), a.register(overlap.id, WEEK)])
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(results.filter(r => r.status === 'rejected').length, 1)
  assert.equal((await a.read(WEEK)).registeredShiftIds.length, 1)
  const afternoon = find(initial, 'DEMO-AREA-GARDEN', WEEK, 'Ca chiều'); assert.equal((await a.register(afternoon.id, WEEK)).registeredShiftIds.length, 2)
})

test('saved selection cannot discard an area with future registered shifts including other weeks', async () => {
  const m = load(), a = adapter(m), first = find(await a.read(WEEK)); await a.register(first.id, WEEK)
  const otherWeek = '2026-11-09', second = find(await a.read(otherWeek), 'DEMO-AREA-CENTRE', otherWeek); await a.register(second.id, otherWeek)
  await assert.rejects(a.savePreferences({ selectedAreaIds: [], available: false }, otherWeek), { name: 'AreasDemoError' })
  assert.equal((await a.read(WEEK)).registeredShiftIds.length, 2)
  await a.cancel(first.id, WEEK); await a.cancel(second.id, otherWeek)
  const empty = await a.savePreferences({ selectedAreaIds: [], available: false }, WEEK); assert.equal(empty.preferences.selectedAreaIds.length, 0)
})

test('past registrations cannot be cancelled and remain historical demo selections', async () => {
  let current = '2026-10-30T04:30:00.000Z'; const m = load(), a = adapter(m, '101', () => new Date(current)), id = find(await a.read(WEEK)).id
  await a.register(id, WEEK); current = '2026-11-02T01:00:00.000Z'
  await assert.rejects(a.cancel(id, WEEK), { name: 'AreasDemoError' }); assert.equal((await a.read(WEEK)).registeredShiftIds.length, 1)
  current = '2026-11-03T01:00:00.000Z'; await a.savePreferences({ selectedAreaIds: [], available: false }, WEEK); assert.equal((await a.read(WEEK)).registeredShiftIds.length, 1)
})

test('reset and fresh instances restore defaults without sharing A/B state or actor PII', async () => {
  const m = load(), a = adapter(m, '9007199254740993'), b = adapter(m, '9007199254740994'), id = find(await a.read(WEEK)).id
  await a.register(id, WEEK); await a.savePreferences({ selectedAreaIds: ['DEMO-AREA-CENTRE'], available: true }, WEEK)
  assert.equal((await b.read(WEEK)).registeredShiftIds.length, 0); assert.equal((await b.read(WEEK)).preferences.available, false)
  await b.savePreferences({ selectedAreaIds: ['DEMO-AREA-GARDEN'], available: false }, WEEK); const reset = await a.reset(WEEK)
  assert.deepEqual(plain(reset.preferences), { selectedAreaIds: ['DEMO-AREA-CENTRE'], available: false }); assert.equal(reset.registeredShiftIds.length, 0)
  assert.deepEqual(plain((await b.read(WEEK)).preferences.selectedAreaIds), ['DEMO-AREA-GARDEN'])
  const fresh = await adapter(m, '9007199254740994').read(WEEK); assert.deepEqual(plain(fresh.preferences), { selectedAreaIds: ['DEMO-AREA-CENTRE'], available: false }); assert.ok(!JSON.stringify(fresh).includes('9007199254740994'))
})

test('aborted mutations reads detail and reset cannot commit or leak demo state', async () => {
  const m = load(), a = adapter(m), initial = await a.read(WEEK), id = find(initial).id
  for (const operation of [s => a.read(WEEK, s), s => a.detail(id, WEEK, s), s => a.savePreferences({ selectedAreaIds: [], available: false }, WEEK, s), s => a.register(id, WEEK, s)]) {
    const controller = new AbortController(), promise = operation(controller.signal); controller.abort(); await assert.rejects(promise, { name: 'AbortError' }); assert.deepEqual(plain(await a.read(WEEK)), plain(initial))
  }
  await a.register(id, WEEK); const registered = await a.read(WEEK)
  for (const operation of [s => a.cancel(id, WEEK, s), s => a.reset(WEEK, s)]) { const controller = new AbortController(), promise = operation(controller.signal); controller.abort(); await assert.rejects(promise, { name: 'AbortError' }); assert.deepEqual(plain(await a.read(WEEK)), plain(registered)) }
})

test('bad weeks clocks and preferences fail before any existing demo state changes', async () => {
  const m = load(), a = adapter(m), initial = await a.read(WEEK), id = find(initial).id
  await assert.rejects(a.register(id, 'not-a-date'), { name: 'AreasDemoError' }); await assert.rejects(a.reset('2026-11-03'), { name: 'AreasDemoError' })
  await assert.rejects(a.savePreferences({ selectedAreaIds: [], available: true }, WEEK), { name: 'AreasDemoError' }); assert.deepEqual(plain(await a.read(WEEK)), plain(initial))
  const bad = adapter(m, '102', () => new Date('invalid')); await assert.rejects(bad.register(id, WEEK), { name: 'AreasDemoError' }); await assert.rejects(bad.savePreferences({ selectedAreaIds: [], available: false }, WEEK), { name: 'AreasDemoError' }); assert.equal((await bad.read(WEEK)).registeredShiftIds.length, 0)
})

test('development flag and canonical BIGINT account scopes fail closed for every other mode', async () => {
  for (const environment of ['production', 'test', '']) { const m = load(environment), a = adapter(m); assert.equal(a.kind, 'unavailable'); assert.equal(await a.read(WEEK), null); assert.equal(await a.detail('DEMO-SHIFT-UNKNOWN', WEEK), null); assert.equal(await a.reset(WEEK), null); for (const promise of [a.register('x', WEEK), a.cancel('x', WEEK), a.savePreferences({ selectedAreaIds: [], available: false }, WEEK)]) await assert.rejects(promise, { name: 'AreasDemoError' }) }
  const m = load()
  for (const enabled of [false, 'true', 1, undefined]) assert.equal(m.createAreasDemoAdapter({ enabled, accountScope: '101' }).kind, 'unavailable')
  for (const accountScope of ['', '0', '01', '-1', '101,102', '9223372036854775808', 101, null]) assert.equal(m.createAreasDemoAdapter({ enabled: true, accountScope }).kind, 'unavailable')
})

test('all demo actions work without network browser storage Auth push or UC capabilities', async () => {
  const forbidden = () => { throw Error('Forbidden external capability') }
  const m = load('development', { fetch: forbidden, XMLHttpRequest: forbidden, localStorage: { getItem: forbidden, setItem: forbidden }, sessionStorage: { getItem: forbidden, setItem: forbidden }, navigator: new Proxy({}, { get: forbidden }), window: new Proxy({}, { get: forbidden }), document: new Proxy({}, { get: forbidden }) })
  const a = adapter(m), initial = await a.read(WEEK), id = find(initial).id; await a.detail(id, WEEK); await a.savePreferences({ selectedAreaIds: ['DEMO-AREA-CENTRE'], available: true }, WEEK); await a.register(id, WEEK); await a.cancel(id, WEEK); await a.reset(WEEK); assert.equal((await a.read(WEEK)).registeredShiftIds.length, 0)
})
