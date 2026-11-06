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
      if (id === './staff-support-demo-model') return source('staff-support-demo-model.ts')
      throw Error('Unexpected support demo dependency')
    } }, { filename, timeout: 2000 })
    cache.set(name, module.exports); return module.exports
  }
  return { ...source('staff-support-demo-model.ts'), ...source('staff-support-demo-adapter.ts') }
}
const plain = value => JSON.parse(JSON.stringify(value))
const adapter = (m, accountScope = '101') => m.createSupportDemoAdapter({ enabled: true, accountScope })
const input = (overrides = {}) => ({ subject: 'Cần xác nhận lịch ca sáng', content: 'Nội dung minh họa đủ dài để kiểm tra tạo yêu cầu.', topic: 'SCHEDULE', priority: 'HIGH', relatedJob: 'DEMO-JOB-101', ...overrides })

test('seed tickets are fictional deterministic data with status counts and no real identities', () => {
  const m = load(), tickets = m.demoTickets()
  assert.equal(tickets.length, 4)
  assert.equal(new Set(tickets.map(ticket => ticket.id)).size, 4)
  assert.deepEqual(plain(m.countTickets(tickets)), { ALL: 4, NEW: 1, IN_PROGRESS: 1, RESOLVED: 2 })
  for (const ticket of tickets) {
    assert.match(ticket.id, /^DEMO-SUP-\d{3}$/)
    assert.match(ticket.content, /DEMO|minh họa|giả lập/i)
    assert.ok(ticket.history.length >= 1)
    assert.ok(ticket.history.every(entry => entry.note.includes('DEMO') || entry.note.includes('minh họa')))
    assert.deepEqual(plain(m.validateTicket(ticket)), plain(ticket))
    for (const key of ['userId', 'employeeId', 'assignmentId', 'bookingId', 'customerName', 'address', 'phone', 'password', 'accessToken', 'staffId', 'email']) assert.equal(key in ticket, false)
  }
  tickets[0].subject = 'Mutated'; tickets[0].history.length = 0
  assert.notEqual(m.demoTickets()[0].subject, 'Mutated'); assert.ok(m.demoTickets()[0].history.length >= 1)
  assert.equal(m.formatSupportTime('2026-10-30T02:15:00.000Z'), '30/10/2026 · 09:15')
  assert.equal(m.relatedJobLabel('DEMO-JOB-101'), 'Ca dọn dẹp nhà · 24/10/2026')
  assert.equal(m.relatedJobLabel(''), 'Không liên kết công việc')
})

test('status filter validation refuses unknown fields and values', () => {
  const m = load()
  assert.deepEqual(plain(m.defaultSupportFilter()), { status: 'ALL' })
  for (const value of [null, [], {}, { status: 'OPEN' }, { status: 'new' }, { status: 'ALL', extra: true }, { status: 1 }]) assert.throws(() => m.validateSupportFilter(value), { name: 'SupportDemoError' })
  for (const status of ['ALL', 'NEW', 'IN_PROGRESS', 'RESOLVED']) assert.deepEqual(plain(m.validateSupportFilter({ status })), { status })
})

test('ticket input validation trims values and refuses unsafe or unknown content', () => {
  const m = load()
  assert.deepEqual(plain(m.validateTicketInput(input({ subject: '  Cần xác nhận lịch ca  ', content: '  Nội dung minh họa đủ dài.  ' }))), input({ subject: 'Cần xác nhận lịch ca', content: 'Nội dung minh họa đủ dài.' }))
  for (const value of [null, {}, input({ extra: true }), input({ subject: 'abc' }), input({ subject: 'x'.repeat(121) }), input({ content: 'ngắn' }), input({ content: 'x'.repeat(1001) }), input({ topic: 'PAYROLL' }), input({ priority: 'URGENT' }), input({ relatedJob: 'BOOKING-9109131' }), input({ subject: 'Liên hệ qa@example.invalid' }), input({ content: 'Gọi số 0901234567 để trao đổi' })]) assert.throws(() => m.validateTicketInput(value), { name: 'SupportDemoError' })
})

test('draft helpers support cancel without inventing a ticket', () => {
  const m = load(), empty = m.emptySupportDraft()
  assert.deepEqual(plain(empty), { subject: '', content: '', topic: 'SCHEDULE', priority: 'NORMAL', relatedJob: '' })
  assert.equal(m.isSupportDraftPristine(empty), true)
  assert.equal(m.isSupportDraftPristine({ ...empty, subject: 'x' }), false)
  assert.throws(() => m.validateTicketInput(empty), { name: 'SupportDemoError' })
})

test('create adds a new DEMO ticket, updates counts and keeps A and B isolated', async () => {
  const m = load(), a = adapter(m, '9007199254740993'), b = adapter(m, '9007199254740994')
  const created = await a.create(input())
  assert.equal(created.ticket.id, 'DEMO-SUP-005')
  assert.equal(created.ticket.status, 'NEW')
  assert.equal(created.ticket.subject, 'Cần xác nhận lịch ca sáng')
  assert.equal(created.snapshot.total, 5)
  assert.equal(created.snapshot.counts.NEW, 2)
  assert.equal((await a.list({ status: 'NEW' })).filtered.length, 2)
  assert.equal((await a.detail('DEMO-SUP-005')).subject, 'Cần xác nhận lịch ca sáng')
  assert.equal((await b.list({ status: 'ALL' })).total, 4)
  assert.equal(await b.detail('DEMO-SUP-005'), null)
  const next = await a.create(input({ subject: 'Yêu cầu thứ hai trong DEMO' }))
  assert.equal(next.ticket.id, 'DEMO-SUP-006')
  assert.equal((await a.list({ status: 'ALL' })).total, 6)
  assert.equal((await b.list({ status: 'ALL' })).total, 4)
})

test('sample replies are previews only and never change ticket status', async () => {
  const m = load(), a = adapter(m), before = await a.detail('DEMO-SUP-001')
  const sample = await a.sampleReply('DEMO-SUP-001')
  assert.equal(sample.id, 'DEMO-REPLY-902')
  assert.match(sample.body, /DEMO/)
  assert.equal(sample.source, 'DEMO')
  const after = await a.detail('DEMO-SUP-001')
  assert.equal(after.status, before.status)
  assert.equal(after.responses.length, before.responses.length)
  assert.equal(await a.sampleReply('DEMO-SUP-999'), null)
})

test('reset restores seed, default filter and the created sequence', async () => {
  const m = load(), a = adapter(m)
  await a.create(input())
  await a.list({ status: 'RESOLVED' })
  const reset = await a.reset()
  assert.deepEqual(plain(reset.filter), { status: 'ALL' })
  assert.equal(reset.total, 4)
  assert.equal(reset.filtered.length, 4)
  assert.deepEqual(plain(reset.counts), { ALL: 4, NEW: 1, IN_PROGRESS: 1, RESOLVED: 2 })
  assert.equal(await a.detail('DEMO-SUP-005'), null)
  assert.equal((await a.create(input())).ticket.id, 'DEMO-SUP-005')
})

test('aborted list detail create sample and reset cannot commit or leak state', async () => {
  const m = load(), a = adapter(m), initial = await a.list(m.defaultSupportFilter())
  const operations = [s => a.list({ status: 'NEW' }, s), s => a.detail('DEMO-SUP-001', s), s => a.create(input(), s), s => a.sampleReply('DEMO-SUP-001', s), s => a.reset(s)]
  for (const operation of operations) {
    const controller = new AbortController(), promise = operation(controller.signal); controller.abort()
    await assert.rejects(promise, { name: 'AbortError' })
    assert.deepEqual(plain(await a.list(m.defaultSupportFilter())), plain(initial))
  }
})

test('development flag and canonical account scopes fail closed for every other mode', async () => {
  for (const environment of ['production', 'test', '']) {
    const m = load(environment), a = adapter(m)
    assert.equal(a.kind, 'unavailable')
    assert.equal(await a.list(m.defaultSupportFilter()), null)
    assert.equal(await a.detail('DEMO-SUP-001'), null)
    assert.equal(await a.create(input()), null)
    assert.equal(await a.sampleReply('DEMO-SUP-001'), null)
    assert.equal(await a.reset(), null)
  }
  const m = load()
  for (const enabled of [false, 'true', 1, undefined]) assert.equal(m.createSupportDemoAdapter({ enabled, accountScope: '101' }).kind, 'unavailable')
  for (const accountScope of ['', '0', '01', '-1', '101,102', '9223372036854775808', 101, null]) assert.equal(m.createSupportDemoAdapter({ enabled: true, accountScope }).kind, 'unavailable')
})

test('demo operations never need network browser storage Auth or UC capabilities', async () => {
  const forbidden = () => { throw Error('Forbidden external capability') }
  const m = load('development', { fetch: forbidden, XMLHttpRequest: forbidden, localStorage: { getItem: forbidden, setItem: forbidden }, sessionStorage: { getItem: forbidden, setItem: forbidden }, navigator: new Proxy({}, { get: forbidden }), window: new Proxy({}, { get: forbidden }), document: new Proxy({}, { get: forbidden }) })
  const a = adapter(m)
  const created = await a.create(input())
  await a.list({ status: 'NEW' }); await a.detail(created.ticket.id); await a.sampleReply(created.ticket.id); await a.reset()
  assert.equal(created.ticket.id, 'DEMO-SUP-005')
  assert.equal((await a.list(m.defaultSupportFilter())).total, 4)
})
