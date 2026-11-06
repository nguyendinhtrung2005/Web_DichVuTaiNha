import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { MysqlNotificationRepository } from '../src/notification-repository.js'
import { StaffNotificationService } from '../src/notification-service.js'
import { notificationQuery } from '../src/validation.js'
import { notificationDto } from '../src/mapping.js'

// SQL contract doubles: they verify binding and boundaries, not a live MySQL run.
function fixture(answers = []) {
  const log = []
  const respond = () => {
    const next = answers.shift()
    if (next instanceof Error) throw next
    return [typeof next === 'function' ? next() : next || [], []]
  }
  const connection = {
    async query(sql, values) { log.push({ kind: 'query', sql, values }); return values ? respond() : [[], []] },
    async execute(sql, values = []) { log.push({ kind: 'execute', sql, values }); return respond() },
    release() { log.push({ kind: 'release' }) },
  }
  return { repository: new MysqlNotificationRepository({ async getConnection() { return connection } }), log }
}
const employee = { id: '10', userId: '100', status: 'ACTIVE', userStatus: 'ACTIVE', userRole: 'EMPLOYEE' }
const staff = { async findEmployeeByUserId() { return employee } }
const actor = Object.freeze({ userId: '100', role: 'staff' })
const row = { id: '9007199254740993', bookingId: '101', content: 'Đơn của bạn đã được phân công.', readAt: null, createdAt: '2026-11-01 02:03:04' }

test('notification list binds the signed-in user, unread filter and pagination', async () => {
  const f = fixture([[{ total: '3' }], [{ unread: '2' }], [row]])
  const result = await f.repository.listForUser('100', { page: 2, pageSize: 1, unreadOnly: true })
  assert.equal(result.total, 3); assert.equal(result.unreadCount, 2)
  const commands = f.log.filter(item => item.values)
  assert.deepEqual(commands[0].values, ['100'])
  assert.match(commands[0].sql, /read_at IS NULL/)
  assert.deepEqual(commands[2].values, ['100', 1, 1])
  assert.match(commands[2].sql, /ORDER BY created_at DESC, id DESC LIMIT \? OFFSET \?/)
  assert.equal(f.log.at(-1).kind, 'release')
})

test('notification list without unreadOnly still counts unread for the same user', async () => {
  const f = fixture([[{ total: '0' }], [{ unread: '0' }], []])
  const result = await f.repository.listForUser('100', { page: 1, pageSize: 20, unreadOnly: false })
  assert.equal(result.total, 0); assert.equal(result.unreadCount, 0)
  const commands = f.log.filter(item => item.values)
  assert.doesNotMatch(commands[0].sql, /read_at IS NULL/)
  assert.match(commands[1].sql, /user_id = \? AND read_at IS NULL/)
})

test('marking read is scoped by user and never overwrites the original read time', async () => {
  const f = fixture([[{ id: row.id }], { affectedRows: 1 }, [{ ...row, readAt: '2026-11-02 01:00:00' }], [{ unread: '0' }]])
  const result = await f.repository.markRead('100', row.id)
  assert.equal(result.item.readAt, '2026-11-02 01:00:00'); assert.equal(result.unreadCount, 0)
  const commands = f.log.filter(item => item.values)
  assert.deepEqual(commands[0].values, ['100', row.id])
  assert.match(commands[1].sql, /UPDATE notifications SET read_at = COALESCE\(read_at, UTC_TIMESTAMP\(\)\) WHERE user_id = \? AND id = \?/)
  assert.deepEqual(commands[1].values, ['100', row.id])
})

test('a notification owned by another user is not found and never updated', async () => {
  const f = fixture([[]])
  assert.equal(await f.repository.markRead('100', '999'), null)
  assert.equal(f.log.filter(item => item.kind === 'execute').length, 1)
  assert.equal(f.log.some(item => /UPDATE/.test(item.sql || '')), false)
})

test('mark-all only touches the current user unread rows', async () => {
  const f = fixture([{ affectedRows: 4 }])
  assert.deepEqual(await f.repository.markAllRead('100'), { updated: 4, unreadCount: 0 })
  const command = f.log.find(item => item.kind === 'execute')
  assert.deepEqual(command.values, ['100'])
  assert.match(command.sql, /WHERE user_id = \? AND read_at IS NULL/)
})

test('service returns the stored notification DTO with ISO timestamps and unread count', async () => {
  const notifications = { async listForUser() { return { items: [row], total: 1, unreadCount: 1 } } }
  const service = new StaffNotificationService({ repository: staff, notifications })
  const body = await service.list(actor, { page: 1, pageSize: 20, unreadOnly: false })
  assert.deepEqual(body.pagination, { page: 1, pageSize: 20, total: 1, totalPages: 1 })
  assert.equal(body.unreadCount, 1)
  assert.equal(body.timezone, 'Asia/Ho_Chi_Minh')
  assert.deepEqual(body.data[0], {
    id: '9007199254740993', content: 'Đơn của bạn đã được phân công.', bookingId: '101',
    readAt: null, createdAt: '2026-11-01T02:03:04.000Z',
  })
  // The stored schema has no title/type/link; the DTO must not invent them.
  for (const key of ['title', 'type', 'href', 'label', 'amount', 'salary']) assert.equal(key in body.data[0], false)
})

test('service refuses inactive staff before reading any inbox', async () => {
  const inactive = { async findEmployeeByUserId() { return { ...employee, status: 'SUSPENDED' } } }
  const service = new StaffNotificationService({ repository: inactive, notifications: { async listForUser() { throw new Error('must not run') } } })
  await assert.rejects(service.list(actor, { page: 1, pageSize: 20, unreadOnly: false }), { status: 403, code: 'STAFF_INACTIVE' })
})

test('service returns 404 when a notification is missing or belongs to another user', async () => {
  const service = new StaffNotificationService({ repository: staff, notifications: { async markRead() { return null } } })
  await assert.rejects(service.markRead(actor, '999'), { status: 404, code: 'NOTIFICATION_NOT_FOUND' })
})

test('query validation rejects unknown keys, bad paging and non-boolean unreadOnly', () => {
  assert.deepEqual(notificationQuery({}), { page: 1, pageSize: 20, unreadOnly: false })
  assert.deepEqual(notificationQuery({ page: '2', pageSize: '5', unreadOnly: 'true' }), { page: 2, pageSize: 5, unreadOnly: true })
  for (const query of [{ userId: '101' }, { page: '0' }, { pageSize: '101' }, { page: '1.5' }, { unreadOnly: 'yes' }, { page: ['1', '2'] }]) {
    assert.throws(() => notificationQuery(query), error => error.status === 400)
  }
})

test('notification DTO keeps content as stored and tolerates a null booking', () => {
  assert.deepEqual(notificationDto({ id: '5', bookingId: null, content: 'Nội dung', readAt: '2026-11-02 01:00:00', createdAt: '2026-11-01 02:03:04' }),
    { id: '5', content: 'Nội dung', bookingId: null, readAt: '2026-11-02T01:00:00.000Z', createdAt: '2026-11-01T02:03:04.000Z' })
})

test('notification source never selects credentials or reads income tables', async () => {
  const source = await readFile(new URL('../src/notification-repository.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /password|revenue_shares|payments|booking_items|unit_price/i)
  assert.doesNotMatch(source, /SELECT\s+\*/i)
  assert.doesNotMatch(source, /(?:DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE)/i)
})
