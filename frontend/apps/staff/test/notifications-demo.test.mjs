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
      if (id === './staff-notifications-demo-model') return source('staff-notifications-demo-model.ts')
      throw Error('Unexpected notification dependency')
    } }, { filename, timeout: 2000 })
    cache.set(name, module.exports); return module.exports
  }
  return { ...source('staff-notifications-demo-model.ts'), ...source('staff-notifications-demo-adapter.ts') }
}
const plain = value => JSON.parse(JSON.stringify(value))
const clock = () => new Date('2026-10-30T04:30:00.000Z')
const adapter = (m, accountScope = '101', now = clock) => m.createNotificationDemoAdapter({ enabled: true, accountScope, now })
test('notification demo seed is fictional, unique and contains only Staff landing links', () => {
  const m = load(), seed = m.defaultNotifications()
  assert.equal(seed.length, 10); assert.equal(new Set(seed.map(n => n.id)).size, 10)
  assert.ok(seed.every(n => n.id.startsWith('DEMO-NOTICE-') && m.isSafeNotificationHref(n.href)))
  assert.ok(seed.every(n => /minh họa|giả lập/i.test(n.body)))
  for (const n of seed) for (const key of ['accountId', 'employeeId', 'assignmentId', 'bookingId', 'password', 'accessToken', 'refreshToken']) assert.equal(key in n, false)
  seed[0].title = 'Mutated'; seed.pop(); assert.equal(m.defaultNotifications().length, 10); assert.notEqual(m.defaultNotifications()[0].title, 'Mutated')
})
test('all/unread filter and count use the same complete private dataset', async () => {
  const m = load(), a = adapter(m), all = await a.list('all'), unread = await a.list('unread')
  assert.equal(all.total, 10); assert.equal(all.unreadCount, 5)
  assert.equal(all.unreadCount, all.items.filter(n => n.readAt === null).length)
  assert.equal(unread.total, all.total); assert.equal(unread.unreadCount, all.unreadCount)
  assert.deepEqual(plain(unread.items), plain(all.items.filter(n => n.readAt === null)))
  assert.ok(all.items.every((n, i, rows) => i === 0 || rows[i - 1].createdAt >= n.createdAt))
})
test('detail returns a clone and does not silently mark a notification read', async () => {
  const m = load(), a = adapter(m), id = (await a.list('unread')).items[0].id, before = await a.list('all')
  const detail = await a.detail(id); assert.equal(detail.readAt, null); detail.title = 'Modified result'
  assert.deepEqual(plain(await a.list('all')), plain(before))
  assert.equal(await a.detail('DEMO-NOTICE-NOT-FOUND'), null)
})
test('mark-read changes one item, count and filtered list consistently', async () => {
  const m = load(), a = adapter(m), before = await a.list('all'), id = before.items.find(n => n.readAt === null).id
  const after = await a.markRead(id)
  assert.equal(after.total, before.total); assert.equal(after.unreadCount, before.unreadCount - 1)
  assert.equal((await a.detail(id)).readAt, clock().toISOString())
  assert.ok((await a.list('unread')).items.every(n => n.id !== id))
  assert.deepEqual(plain(after.items.filter(n => n.id !== id)), plain(before.items.filter(n => n.id !== id)))
})
test('mark-read is idempotent and does not replace an existing read timestamp', async () => {
  let calls = 0; const m = load(), a = adapter(m, '101', () => new Date(Date.parse('2026-10-30T04:30:00.000Z') + calls++ * 1000))
  const id = (await a.list('unread')).items[0].id
  await a.markRead(id); const first = await a.detail(id); await a.markRead(id)
  assert.equal((await a.detail(id)).readAt, first.readAt); assert.equal(calls, 1)
})
test('unknown mark-read fails rather than reporting a false success', async () => {
  const m = load(), a = adapter(m), before = await a.list('all')
  await assert.rejects(a.markRead('DEMO-NOTICE-NOT-FOUND'), { name: 'NotificationDemoNotFoundError' })
  await assert.rejects(a.markRead('101'), { name: 'NotificationDemoNotFoundError' })
  assert.deepEqual(plain(await a.list('all')), plain(before))
})
test('read-all updates only unread entries and repeated read-all is stable', async () => {
  const m = load(), a = adapter(m), before = await a.list('all'), alreadyRead = before.items.filter(n => n.readAt !== null)
  const after = await a.readAll(); assert.equal(after.unreadCount, 0); assert.equal(after.total, before.total)
  assert.equal((await a.list('unread')).items.length, 0)
  for (const item of alreadyRead) assert.equal((await a.detail(item.id)).readAt, item.readAt)
  assert.deepEqual(plain(await a.readAll()), plain(after))
})
test('interleaved mark/read-all requests cannot lose read states or overcount', async () => {
  const m = load(), a = adapter(m), id = (await a.list('unread')).items[0].id
  await Promise.all([a.markRead(id), a.readAll(), a.markRead(id)])
  const report = await a.list('all'); assert.equal(report.unreadCount, 0)
  assert.equal(new Set(report.items.map(n => n.id)).size, 10)
})
test('read state is isolated between A/B and is reset by a new page instance', async () => {
  const m = load(), a = adapter(m, '9007199254740993'), b = adapter(m, '9007199254740994')
  await a.readAll(); assert.equal((await b.list('all')).unreadCount, 5)
  await b.markRead((await b.list('unread')).items[0].id); await a.reset()
  assert.equal((await b.list('all')).unreadCount, 4); assert.equal((await a.list('all')).unreadCount, 5)
  const fresh = adapter(m, '9007199254740994'); assert.equal((await fresh.list('all')).unreadCount, 5)
  assert.ok(!JSON.stringify(await fresh.list('all')).includes('9007199254740994'))
})
test('reset restores the seed without sharing mutable report references', async () => {
  const m = load(), a = adapter(m); await a.readAll(); const report = await a.reset()
  report.items[0].title = 'Changed reset result'; const live = await a.list('all')
  assert.equal(live.unreadCount, 5); assert.notEqual(live.items[0].title, 'Changed reset result')
})
test('aborted read, detail, mark-read, read-all and reset cannot produce or commit data', async () => {
  const m = load(), a = adapter(m), initial = await a.list('all'), id = initial.items.find(n => n.readAt === null).id
  for (const operation of [s => a.list('all', s), s => a.detail(id, s), s => a.markRead(id, s), s => a.readAll(s)]) {
    const controller = new AbortController(), promise = operation(controller.signal); controller.abort()
    await assert.rejects(promise, { name: 'AbortError' }); assert.deepEqual(plain(await a.list('all')), plain(initial))
  }
  await a.readAll(); const controller = new AbortController(), promise = a.reset(controller.signal); controller.abort()
  await assert.rejects(promise, { name: 'AbortError' }); assert.equal((await a.list('all')).unreadCount, 0)
})
test('a bad or retroactive clock fails before mutating any read state', async () => {
  const m = load()
  for (const now of [() => new Date('invalid'), () => new Date('2020-01-01T00:00:00.000Z')]) {
    const a = adapter(m, '101', now), before = await a.list('all')
    await assert.rejects(a.markRead(before.items.find(n => n.readAt === null).id), { name: 'RangeError' })
    await assert.rejects(a.readAll(), { name: 'RangeError' })
    assert.deepEqual(plain(await a.list('all')), plain(before))
  }
})
test('default clock produces canonical ISO read timestamps without external services', async () => {
  class ClockDate extends Date { constructor(...args) { super(...(args.length ? args : ['2026-10-30T04:30:00.000Z'])) } }
  const m = load('development', { Date: ClockDate }), a = m.createNotificationDemoAdapter({ enabled: true, accountScope: '101' }), id = (await a.list('unread')).items[0].id
  await a.markRead(id); assert.equal((await a.detail(id)).readAt, '2026-10-30T04:30:00.000Z')
})
test('Vietnam time formatter handles month/year UTC boundaries and invalid dates', () => {
  const m = load()
  assert.equal(m.formatNotificationTime('2026-09-30T17:00:00.000Z'), '01/10/2026 · 00:00')
  assert.equal(m.formatNotificationTime('2026-12-31T17:00:00.000Z'), '01/01/2027 · 00:00')
  for (const time of ['invalid', '2026-02-30T00:00:00.000Z', '2026-10-30T00:00:00+07:00']) assert.equal(m.formatNotificationTime(time), 'Chưa có thời gian hợp lệ')
})
test('deep links reject external, auth, resource, encoded and control-character destinations', () => {
  const m = load()
  for (const href of ['/', '/cong-viec', '/lich-lam-viec', '/thu-nhap', '/ho-so', '/lich-su', '/ho-tro', '/cai-dat', '/thong-ke-cong-viec']) assert.equal(m.isSafeNotificationHref(href), true)
  for (const href of ['https://outside.invalid', '//outside.invalid', 'javascript:alert(1)', '/\\outside.invalid', '/dang-nhap', '/dang-ky', '/api/auth/logout', '/internal/v1', '/don/1', '/don/DEMO-1', '/ho-so?userId=101', '/ho-so#x', '/ho-so/../cong-viec', '/ho-so%2fextra', '/%68o-so', '/ho-so%252fextra', '/ho-so\n', '/ho-so ', new String('/ho-so'), null]) assert.equal(m.isSafeNotificationHref(href), false)
})
test('report validation refuses unsupported filters, duplicate IDs and unsafe links', () => {
  const m = load(), seed = m.defaultNotifications()
  assert.throws(() => m.notificationReport(seed, 'unknown'), { name: 'RangeError' })
  assert.throws(() => m.notificationReport([...seed, seed[0]], 'all'), { name: 'RangeError' })
  assert.throws(() => m.notificationReport([{ ...seed[0], href: '//outside.invalid' }], 'all'), { name: 'RangeError' })
  assert.throws(() => m.notificationReport([{ ...seed[0], readAt: '2020-01-01T00:00:00.000Z' }], 'all'), { name: 'RangeError' })
})
test('development flag and canonical account scope fail closed in all other environments', async () => {
  for (const environment of ['production', 'test', '']) { const m = load(environment), a = adapter(m); assert.equal(a.kind, 'unavailable'); assert.equal(await a.list('all'), null); assert.equal(await a.detail('DEMO-NOTICE-WORK-01'), null); assert.equal(await a.reset(), null); await assert.rejects(a.readAll(), { name: 'NotificationDemoUnavailableError' }); await assert.rejects(a.markRead('DEMO-NOTICE-WORK-01'), { name: 'NotificationDemoUnavailableError' }) }
  const m = load()
  for (const enabled of [false, 'true', 1, undefined]) assert.equal(m.createNotificationDemoAdapter({ enabled, accountScope: '101' }).kind, 'unavailable')
  for (const accountScope of ['', '0', '01', '-1', '101,102', '9223372036854775808', 101, null]) assert.equal(m.createNotificationDemoAdapter({ enabled: true, accountScope }).kind, 'unavailable')
})
test('adapter requires no network storage document window Auth or push capability', async () => {
  const forbidden = () => { throw Error('Forbidden external capability') }
  const m = load('development', { fetch: forbidden, XMLHttpRequest: forbidden, Notification: forbidden, localStorage: { getItem: forbidden, setItem: forbidden }, sessionStorage: { getItem: forbidden, setItem: forbidden }, navigator: new Proxy({}, { get: forbidden }), window: new Proxy({}, { get: forbidden }), document: new Proxy({}, { get: forbidden }) })
  const a = adapter(m), id = (await a.list('unread')).items[0].id; await a.detail(id); await a.markRead(id); await a.readAll(); await a.reset()
  assert.equal((await a.list('all')).unreadCount, 5)
})
