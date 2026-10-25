import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { MysqlStaffRepository } from '../src/repository.js'

// SQL contract doubles: these tests verify our query/transaction boundaries.
// They do not run MySQL or pretend that a real database integration passed.
function fixture(answers = []) {
  const log = []
  const response = (sql, values) => {
    const next = answers.shift()
    if (next instanceof Error) throw next
    return [typeof next === 'function' ? next(sql, values) : next || [], []]
  }
  const connection = {
    async query(sql, values) { log.push({ kind: 'query', sql, values }); return values ? response(sql, values) : [[], []] },
    async execute(sql, values = []) {
      log.push({ kind: 'execute', sql, values })
      return response(sql, values)
    },
    async beginTransaction() { log.push({ kind: 'begin' }) },
    async commit() { log.push({ kind: 'commit' }) },
    async rollback() { log.push({ kind: 'rollback' }) },
    release() { log.push({ kind: 'release' }) },
  }
  return { repository: new MysqlStaffRepository({ async getConnection() { return connection } }), connection, log }
}
const row = { id: '9007199254740993', bookingId: '101', employeeId: '10', status: 'ASSIGNED', bookingStatus: 'CONFIRMED', checkInAt: null, checkOutAt: null }

test('repository reads employee state without selecting credential columns', async () => {
  const f = fixture([[{ id: '10', userId: '100', status: 'ACTIVE', userRole: 'EMPLOYEE', userStatus: 'ACTIVE' }]])
  assert.equal((await f.repository.findEmployeeByUserId('100')).id, '10')
  const command = f.log.find(item => item.kind === 'execute')
  assert.deepEqual(command.values, ['100']); assert.match(command.sql, /e\.user_id = \?/)
  assert.doesNotMatch(command.sql, /password|SELECT\s+\*/i)
  assert.match(f.log[0].sql, /time_zone = '\+00:00'/)
  assert.equal(f.log.at(-1).kind, 'release')
})

test('repository list binds identity/filter/overlap and does not multiply bookings by service items', async () => {
  const f = fixture([[{ total: '2' }], [row]])
  const result = await f.repository.findJobs('10', { status: 'ASSIGNED', page: 2, pageSize: 1, sort: 'desc', fromUtc: '2026-01-01 00:00:00', toUtc: '2026-01-02 00:00:00' })
  assert.equal(result.total, 2); assert.equal(result.items[0].id, '9007199254740993')
  const commands = f.log.filter(item => item.values)
  assert.match(commands[0].sql, /b\.scheduled_start < \? AND b\.scheduled_end > \?/)
  assert.deepEqual(commands[1].values, ['10', 'ASSIGNED', '2026-01-02 00:00:00', '2026-01-01 00:00:00', 1, 1])
  assert.match(commands[1].sql, /ORDER BY b\.scheduled_start DESC, a\.id DESC LIMIT \? OFFSET \?/)
  assert.doesNotMatch(commands.map(item => item.sql).join(' '), /JOIN booking_items/)
})

test('repository refuses dynamic sort SQL before opening a connection', async () => {
  const f = fixture()
  await assert.rejects(f.repository.findJobs('10', { page: 1, pageSize: 10, sort: 'asc; DROP TABLE users' }), { status: 400 })
  assert.equal(f.log.length, 0)
})

test('assignment ownership is always bound for detail; absence returns null', async () => {
  const f = fixture([[]])
  assert.equal(await f.repository.findJob('10', '99'), null)
  const command = f.log.find(item => item.kind === 'execute')
  assert.match(command.sql, /a\.employee_id = \? AND a\.id = \?/)
  assert.deepEqual(command.values, ['10', '99'])
})

test('service snapshots batch is parameterized, deduplicated and preserves decimal strings', async () => {
  const f = fixture([[{ bookingId: '101', serviceId: '8', serviceName: 'Tên snapshot', unit: 'giờ', quantity: '2.50', unitPrice: '100000.00' }]])
  assert.equal((await f.repository.getBookingItems(['101', '101', '102'])).get('101')[0].quantity, '2.50')
  const command = f.log.find(item => item.kind === 'execute')
  assert.deepEqual(command.values, ['101', '102']); assert.match(command.sql, /IN \(\?, \?\)/)
  assert.match(command.sql, /service_name_snapshot AS serviceName/); assert.doesNotMatch(command.sql, /JOIN services/)
  const empty = fixture(); assert.equal((await empty.repository.getBookingItems([])).size, 0); assert.equal(empty.log.length, 0)
})

test('transition locks assignments only, updates owned row by old state, and commits callback result', async () => {
  const initial = { ...row, status: 'ACCEPTED' }, f = fixture([[{ id: row.id, status: 'ACCEPTED' }], [initial], { affectedRows: 1 }])
  const result = await f.repository.withLockedAssignment('10', row.id, async tx => {
    assert.equal(tx.assignment.status, 'ACCEPTED')
    return tx.updateStatus('IN_PROGRESS', '2026-01-02T02:03:04.789Z')
  })
  assert.equal(result.checkInAt, '2026-01-02 02:03:04'); assert.equal(result.status, 'IN_PROGRESS')
  const commands = f.log.filter(item => item.kind === 'execute')
  assert.match(commands[0].sql, /FROM assignments WHERE employee_id = \? AND id = \? FOR UPDATE/)
  assert.doesNotMatch(commands[0].sql, /JOIN|bookings/)
  assert.doesNotMatch(commands[1].sql, /FOR UPDATE/)
  assert.match(commands[2].sql, /^UPDATE assignments SET status = \?/)
  assert.deepEqual(commands[2].values.slice(-3), ['10', row.id, 'ACCEPTED'])
  assert.equal(f.log.at(-2).kind, 'commit'); assert.equal(f.log.at(-1).kind, 'release')
})

test('completion writes checkout at supplied Order acknowledgement time', async () => {
  const f = fixture([[{ id: '1', status: 'IN_PROGRESS' }], [{ ...row, id: '1', status: 'IN_PROGRESS', checkInAt: '2026-01-02 01:00:00' }], { affectedRows: 1 }])
  const result = await f.repository.withLockedAssignment('10', '1', tx => tx.updateStatus('DONE', '2026-01-02T09:00:00+07:00'))
  assert.equal(result.checkOutAt, '2026-01-02 02:00:00'); assert.equal(result.checkInAt, '2026-01-02 01:00:00')
})

test('unowned assignment rolls back without reading booking or invoking callback', async () => {
  const f = fixture([[]]); let invoked = false
  await assert.rejects(f.repository.withLockedAssignment('10', '3', async () => { invoked = true }), { status: 404 })
  assert.equal(invoked, false); assert.equal(f.log.filter(item => item.kind === 'execute').length, 1)
  assert.equal(f.log.at(-2).kind, 'rollback'); assert.equal(f.log.at(-1).kind, 'release')
})

test('callback or compare-and-swap failure rolls back and releases connection', async () => {
  for (const mode of ['callback', 'cas', 'skip']) {
    const f = fixture([[{ id: row.id, status: 'ASSIGNED' }], [row], { affectedRows: 0 }])
    await assert.rejects(f.repository.withLockedAssignment('10', row.id, async tx => {
      if (mode === 'callback') throw new Error('Order dependency failed')
      return tx.updateStatus(mode === 'skip' ? 'DONE' : 'ACCEPTED', '2026-01-02T01:00:00Z')
    }))
    assert.equal(f.log.at(-2).kind, 'rollback'); assert.equal(f.log.at(-1).kind, 'release')
    assert.equal(f.log.some(item => item.kind === 'commit'), false)
  }
})

test('commit failure returns a sanitized database error even when rollback also fails', async () => {
  const f = fixture([[{ id: row.id, status: 'ASSIGNED' }], [row]])
  f.connection.commit = async () => { throw new Error('commit failed') }
  f.connection.rollback = async () => { throw new Error('rollback failed') }
  await assert.rejects(f.repository.withLockedAssignment('10', row.id, async () => 'result'), { status: 503, code: 'DATABASE_UNAVAILABLE' })
  assert.equal(f.log.at(-1).kind, 'release')
})

test('schema check fails safely on missing/incompatible schema; no DDL is issued', async () => {
  const f = fixture([[{ version: '8.0.42' }], [], [], [], []])
  await assert.rejects(f.repository.assertSchema(), error => error.status === 503 && error.code === 'DATABASE_SCHEMA_INCOMPATIBLE' && error.details.missing.includes('assignments.status'))
  assert.doesNotMatch(f.log.map(item => item.sql || '').join(' '), /CREATE TABLE|ALTER TABLE|FOREIGN_KEY_CHECKS|DROP |TRUNCATE /i)
  const inaccessible = fixture([new Error('private connection details')])
  await assert.rejects(inaccessible.repository.assertSchema(), error => error.code === 'DATABASE_UNAVAILABLE' && !error.message.includes('private'))
})

test('schema metadata from the original DDL is accepted; incompatible defaults/indexes/FKs/versions are rejected', async () => {
  const ddl = await readFile(new URL('../../../databases/schema.sql', import.meta.url), 'utf8')
  const names = ['users', 'employees', 'employee_availability', 'assignments', 'bookings', 'booking_items', 'services', 'booking_status_history']
  const columns = [], indexes = [], foreignKeys = [], engines = []
  for (const match of ddl.matchAll(/CREATE TABLE (\w+) \(([\s\S]*?)\) ENGINE=(\w+)/g)) {
    const [, table, body, engine] = match
    if (!names.includes(table)) continue
    engines.push({ TABLE_NAME: table, ENGINE: engine })
    for (const line of body.split('\n').map(value => value.trim())) {
      const column = /^(\w+)\s+(BIGINT|VARCHAR|TIMESTAMP|DECIMAL|JSON|TEXT)\b(.*)$/i.exec(line)
      if (column) columns.push({ TABLE_NAME: table, COLUMN_NAME: column[1], DATA_TYPE: column[2].toLowerCase(), IS_NULLABLE: /NOT NULL/.test(column[3]) ? 'NO' : 'YES', COLUMN_DEFAULT: /DEFAULT '([^']+)'/.exec(column[3])?.[1] || null })
      const index = /^(PRIMARY KEY|UNIQUE KEY (\w+)|KEY (\w+)) \(([^)]+)\)/.exec(line)
      if (index) index[4].split(',').forEach((name, position) => indexes.push({ TABLE_NAME: table, INDEX_NAME: index[1] === 'PRIMARY KEY' ? 'PRIMARY' : index[2] || index[3], NON_UNIQUE: index[1].startsWith('KEY ') ? 1 : 0, COLUMN_NAME: name.trim(), SEQ_IN_INDEX: position + 1 }))
      const fk = /FOREIGN KEY \((\w+)\)\s+REFERENCES (\w+)\((\w+)\)/.exec(line)
      if (fk) foreignKeys.push({ TABLE_NAME: table, COLUMN_NAME: fk[1], REFERENCED_TABLE_NAME: fk[2], REFERENCED_COLUMN_NAME: fk[3] })
    }
  }
  const metadata = (version = '8.0.42', cols = columns, ix = indexes, fk = foreignKeys) => [[{ version }], cols, engines, ix, fk]
  assert.equal(await fixture(metadata()).repository.assertSchema(), true)
  assert.equal(await fixture(metadata('9.0.0')).repository.assertSchema(), true)
  for (const version of ['5.7.44', '10.11.7-MariaDB']) await assert.rejects(fixture(metadata(version)).repository.assertSchema(), { code: 'DATABASE_SCHEMA_INCOMPATIBLE' })
  const badDefault = columns.map(row => row.TABLE_NAME === 'assignments' && row.COLUMN_NAME === 'status' ? { ...row, COLUMN_DEFAULT: 'WAITING' } : row)
  await assert.rejects(fixture(metadata('8.0.42', badDefault)).repository.assertSchema(), error => error.details.incompatible.includes('assignments.status.default'))
  await assert.rejects(fixture(metadata('8.0.42', columns, indexes.filter(row => row.TABLE_NAME !== 'assignments'))).repository.assertSchema(), { code: 'DATABASE_SCHEMA_INCOMPATIBLE' })
  await assert.rejects(fixture(metadata('8.0.42', columns, indexes, [])).repository.assertSchema(), { code: 'DATABASE_SCHEMA_INCOMPATIBLE' })
})

test('pool and session failures are sanitized and checked-out connections are released', async () => {
  const inaccessible = new MysqlStaffRepository({ async getConnection() { throw new Error('private connection details') } })
  await assert.rejects(inaccessible.health(), error => error.code === 'DATABASE_UNAVAILABLE' && !error.message.includes('private'))
  const f = fixture()
  f.connection.query = async () => { throw new Error('private session details') }
  await assert.rejects(f.repository.health(), { status: 503, code: 'DATABASE_UNAVAILABLE' })
  assert.deepEqual(f.log.map(entry => entry.kind), ['release'])
})

test('locked assignment status overrides an older nonlocking projection during a transition', async () => {
  const f = fixture([[{ id: row.id, status: 'ACCEPTED' }], [row], { affectedRows: 1 }])
  const result = await f.repository.withLockedAssignment('10', row.id, tx => tx.updateStatus('IN_PROGRESS', '2026-01-02T01:00:00Z'))
  assert.equal(result.status, 'IN_PROGRESS')
  const update = f.log.find(entry => entry.sql?.startsWith('UPDATE assignments'))
  assert.equal(update.values.at(-1), 'ACCEPTED')
})

test('missing range boundaries and invalid pagination fail without querying MySQL', async () => {
  const f = fixture()
  for (const query of [{ page: 0 }, { pageSize: 101 }, { page: 1.5 }, { fromUtc: '2026-10-23 00:00:00' }, { toUtc: '2026-10-24 00:00:00' }]) {
    await assert.rejects(f.repository.findJobs('10', query), { status: 400 })
  }
  assert.equal(f.log.length, 0)
})

test('all repository writes target assignments exclusively; source has no schema mutation or credentials query', async () => {
  const source = await readFile(new URL('../src/repository.js', import.meta.url), 'utf8')
  const updates = [...source.matchAll(/UPDATE\s+([a-z_]+)\s+SET/gi)].map(match => match[1])
  assert.deepEqual(updates, ['assignments'])
  assert.doesNotMatch(source, /(?:INSERT\s+INTO|DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE|SET\s+FOREIGN_KEY_CHECKS)/i)
  assert.doesNotMatch(source, /password_hash|SELECT\s+\*/i)
})
