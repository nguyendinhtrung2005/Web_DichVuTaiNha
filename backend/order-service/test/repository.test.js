import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { MysqlOrderRepository } from '../src/repository.js'
import { OrderError } from '../src/domain.js'

// SQL dependency doubles check repository ownership/transaction boundaries.
// They are unit tests, not evidence that a live MySQL transaction passed.
const operation = { id: 'operation-A', bookingId: '80', assignmentId: '12', employeeId: '9', actorUserId: '7', fromStatus: 'ASSIGNED', toStatus: 'ACCEPTED' }
const roster = [{ id: '12', bookingId: '80', employeeId: '9', actorUserId: '7', userRole: 'EMPLOYEE', userStatus: 'ACTIVE', employeeStatus: 'ACTIVE', status: 'ASSIGNED', checkInAt: null, checkOutAt: null }]
const history = { id: '9007199254740993', bookingId: '80', changedBy: '7', status: 'CONFIRMED', note: 'Legacy note', createdAt: '2026-10-23 01:00:00' }
const metadata = () => ({ kind: 'cleanhome.staff-transition', version: 1, operation, ack: { operationId: operation.id, bookingId: '80', assignmentId: '12', assignmentStatus: 'ACCEPTED', occurredAt: '2026-10-23T01:02:03.000Z', booking: { id: '80', status: 'CONFIRMED', cancellationPending: null } }, staffAcknowledged: false })

function fixture(options = {}) {
  const log = [], pending = [...(options.pending || [])]
  const response = (kind, sql, values = []) => {
    log.push({ kind, sql, values })
    const error = options.fail?.(kind, sql, values)
    if (error) throw error
    if (sql.includes('GET_LOCK')) return [[{ acquired: options.acquired ?? 1 }], []]
    if (sql.includes('RELEASE_LOCK')) return [[{ released: options.released ?? 1 }], []]
    if (sql.includes('SELECT id, status FROM bookings')) return [options.booking === null ? [] : [{ id: '80', status: 'CONFIRMED', ...options.booking }], []]
    if (sql.includes('FROM assignments a')) return [options.assignments || roster, []]
    if (sql.includes('CAST(JSON_UNQUOTE')) return [options.matching || [], []]
    if (sql.includes('FROM booking_status_history') && sql.includes('LIMIT ?')) return [pending.shift() || [], []]
    if (sql.includes('FROM booking_status_history')) return [options.history || [history], []]
    if (sql.startsWith('INSERT')) return [{ insertId: '9007199254740995', affectedRows: 1 }, []]
    if (sql.startsWith('UPDATE')) return [{ affectedRows: options.affectedRows ?? 1 }, []]
    if (sql.includes('VERSION()')) return [[{ version: options.version || '8.0.40' }], []]
    if (sql.includes('information_schema.COLUMNS')) return [options.columns || [], []]
    if (sql.includes('information_schema.TABLES')) return [options.engines || [], []]
    if (sql.includes('information_schema.STATISTICS')) return [options.indexes || [], []]
    if (sql.includes('information_schema.KEY_COLUMN_USAGE')) return [options.keys || [], []]
    return [[], []]
  }
  const connection = {
    async query(sql, values) { return response('query', sql, values) },
    async execute(sql, values) { return response('execute', sql, values) },
    async beginTransaction() { log.push({ kind: 'begin' }); if (options.beginError) throw options.beginError },
    async commit() { log.push({ kind: 'commit' }); if (options.commitError) throw options.commitError },
    async rollback() { log.push({ kind: 'rollback' }); if (options.rollbackError) throw options.rollbackError },
    release() { log.push({ kind: 'release' }) },
    destroy() { log.push({ kind: 'destroy' }) },
  }
  const repository = new MysqlOrderRepository({ async getConnection() { log.push({ kind: 'checkout' }); if (options.checkoutError) throw options.checkoutError; return connection } })
  return { repository, connection, log }
}

test('transaction uses UTC/READ COMMITTED, serializes operation, and locks only booking before roster read', async () => {
  const f = fixture()
  const result = await f.repository.transactOperation(operation, async tx => {
    assert.equal(tx.booking.id, '80'); assert.equal(tx.assignments[0].actorUserId, '7')
    assert.equal(tx.historyRows[0].id, '9007199254740993'); assert.deepEqual(tx.matchingHistoryRows, [])
    return { committed: true }
  })
  assert.deepEqual(result, { committed: true })
  const commands = f.log.filter(row => row.sql)
  assert.match(commands[0].sql, /time_zone = '\+00:00'/)
  assert.match(commands[1].sql, /GET_LOCK\(\?, 1\)/)
  assert.equal(commands[1].values[0].length, 64)
  assert.match(commands[2].sql, /SET TRANSACTION ISOLATION LEVEL READ COMMITTED/)
  assert.match(commands[3].sql, /innodb_lock_wait_timeout = 2/)
  const lockAt = f.log.findIndex(row => row.sql?.includes('FOR UPDATE'))
  const rosterAt = f.log.findIndex(row => row.sql?.includes('FROM assignments a'))
  assert.ok(f.log.findIndex(row => row.kind === 'begin') < lockAt && lockAt < rosterAt)
  assert.deepEqual(f.log[lockAt].values, ['80'])
  assert.equal(commands.filter(row => row.sql.includes('FOR UPDATE')).length, 1)
  assert.match(commands.find(row => row.sql.includes('FOR UPDATE')).sql, /FROM bookings WHERE id = \? FOR UPDATE$/)
  assert.doesNotMatch(commands.find(row => row.sql.includes('FROM assignments a')).sql, /FOR UPDATE|FOR SHARE/)
  assert.deepEqual(f.log.slice(-3).map(row => row.kind), ['commit', 'execute', 'release'])
  assert.match(f.log.at(-2).sql, /RELEASE_LOCK/)
})

test('operation lock is namespaced, deterministic and shared across different booking IDs', async () => {
  const a = fixture(), b = fixture(), c = fixture()
  await a.repository.transactOperation(operation, async () => null)
  await b.repository.transactOperation({ ...operation, bookingId: '81' }, async () => null)
  await c.repository.transactOperation({ ...operation, id: 'operation-B' }, async () => null)
  const lock = f => f.log.find(row => row.sql?.includes('GET_LOCK')).values[0]
  assert.equal(lock(a), lock(b)); assert.notEqual(lock(a), lock(c))
  assert.doesNotMatch(lock(a), /operation-A/)
})

test('global journal lookup safely handles legacy TEXT and binds case-sensitive operation ID', async () => {
  const f = fixture({ matching: [{ ...history, bookingId: '81' }] })
  await f.repository.transactOperation(operation, async tx => assert.equal(tx.matchingHistoryRows[0].bookingId, '81'))
  const lookup = f.log.find(row => row.sql?.includes('CAST(JSON_UNQUOTE'))
  assert.match(lookup.sql, /CASE WHEN JSON_VALID\(note\) THEN note ELSE '\{\}' END/)
  assert.match(lookup.sql, /AS BINARY\) = CAST\(\? AS BINARY\)/)
  assert.deepEqual(lookup.values, [operation.id])
  assert.doesNotMatch(lookup.sql, /booking_id = \?/)
})

test('writes only Order-owned status/journal and preserves canonical timestamp and BIGINT ID', async () => {
  const f = fixture()
  await f.repository.transactOperation(operation, async tx => {
    await tx.setBookingStatus('IN_PROGRESS')
    assert.equal(tx.booking.status, 'IN_PROGRESS')
    assert.equal(await tx.insertHistory(metadata()), '9007199254740995')
    await tx.acknowledgeHistory('9007199254740993', { ...metadata(), staffAcknowledged: true })
  })
  const commands = f.log.filter(row => /^(UPDATE|INSERT)/.test(row.sql || ''))
  assert.deepEqual(commands.map(row => row.sql.split(' ').slice(0, 3).join(' ')), ['UPDATE bookings SET', 'INSERT INTO booking_status_history', 'UPDATE booking_status_history SET'])
  assert.deepEqual(commands[0].values, ['IN_PROGRESS', '80', 'CONFIRMED'])
  assert.deepEqual(commands[1].values.slice(0, 3), ['80', '7', 'CONFIRMED'])
  assert.equal(commands[1].values.at(-1), '2026-10-23 01:02:03')
  assert.equal(JSON.parse(commands[2].values[0]).staffAcknowledged, true)
  assert.deepEqual(commands[2].values.slice(1), ['9007199254740993', '80'])
  assert.match(commands[2].sql, /cleanhome\.staff-transition/)
})

test('same booking status avoids needless update and missing booking is represented honestly', async () => {
  const f = fixture()
  await f.repository.transactOperation(operation, tx => tx.setBookingStatus('CONFIRMED'))
  assert.equal(f.log.filter(row => row.sql?.startsWith('UPDATE')).length, 0)
  const missing = fixture({ booking: null })
  await missing.repository.transactOperation(operation, tx => { assert.equal(tx.booking, null) })
  await assert.rejects(missing.repository.transactOperation(operation, tx => tx.setBookingStatus('CONFIRMED')), { status: 404, code: 'BOOKING_NOT_FOUND' })
})

test('callback error rolls back before releasing operation lock and preserves domain rejection', async () => {
  const f = fixture(), error = new OrderError(409, 'INVALID_TRANSITION', 'Không hợp lệ')
  await assert.rejects(f.repository.transactOperation(operation, async () => { throw error }), value => value === error)
  assert.deepEqual(f.log.slice(-3).map(row => row.kind), ['rollback', 'execute', 'release'])
  assert.match(f.log.at(-2).sql, /RELEASE_LOCK/)
  assert.equal(f.log.some(row => row.kind === 'commit'), false)
})

test('failed write compare-and-set rolls back instead of returning success', async () => {
  const f = fixture({ affectedRows: 0 })
  await assert.rejects(f.repository.transactOperation(operation, tx => tx.setBookingStatus('IN_PROGRESS')), { status: 409, code: 'STALE_ASSIGNMENT' })
  assert.ok(f.log.some(row => row.kind === 'rollback')); assert.equal(f.log.some(row => row.kind === 'commit'), false)
})

test('uncertain commit returns sanitized unavailable and allows retry with same operation', async () => {
  const f = fixture({ commitError: new Error('private database user or password') })
  await assert.rejects(f.repository.transactOperation(operation, async () => true), error => error.status === 503 && error.code === 'ORDER_UNAVAILABLE' && !error.message.includes('password') && !error.cause)
  assert.ok(f.log.some(row => row.kind === 'rollback'))
  assert.equal(f.log.filter(row => row.sql?.includes('GET_LOCK')).length, 1)
})

test('advisory lock contention rejects before begin and releases checked-out connection', async () => {
  const f = fixture({ acquired: 0 })
  await assert.rejects(f.repository.transactOperation(operation, async () => assert.fail()), { status: 503, code: 'ORDER_UNAVAILABLE' })
  assert.equal(f.log.some(row => row.kind === 'begin'), false)
  assert.equal(f.log.some(row => row.sql?.includes('RELEASE_LOCK')), false)
  assert.equal(f.log.at(-1).kind, 'release')
})

test('advisory lock release failure destroys connection instead of returning locked session to pool', async () => {
  for (const options of [{ released: 0 }, { fail: (kind, sql) => sql.includes('RELEASE_LOCK') ? new Error('connection lost') : null }]) {
    const f = fixture(options)
    assert.equal(await f.repository.transactOperation(operation, async () => true), true)
    assert.equal(f.log.at(-1).kind, 'destroy')
    assert.equal(f.log.some(row => row.kind === 'release'), false)
  }
})

test('uncertain advisory lock acquisition discards connection so a lost response cannot leak a lock', async () => {
  const f = fixture({ fail: (kind, sql) => sql.includes('GET_LOCK') ? new Error('lock response lost') : null })
  await assert.rejects(f.repository.transactOperation(operation, async () => assert.fail()), { status: 503, code: 'ORDER_UNAVAILABLE' })
  assert.equal(f.log.at(-1).kind, 'destroy')
  assert.equal(f.log.some(row => row.kind === 'release' || row.kind === 'begin'), false)
})

test('failed rollback discards session and never returns success or pooled lock', async () => {
  const f = fixture({ rollbackError: new Error('network lost') })
  await assert.rejects(f.repository.transactOperation(operation, async () => { throw new OrderError(409, 'OPERATION_CONFLICT', 'Không hợp lệ') }), { status: 409 })
  assert.equal(f.log.at(-1).kind, 'destroy')
  assert.equal(f.log.some(row => row.kind === 'release'), false)
})

test('connection, SQL and session failures are sanitized without leaking driver information', async () => {
  const sensitive = new Error('mysql://private-user:private-password@host/database')
  for (const options of [{ checkoutError: sensitive }, { fail: () => sensitive }]) {
    const f = fixture(options)
    await assert.rejects(f.repository.health(), error => error.status === 503 && error.code === 'ORDER_UNAVAILABLE' && !error.message.includes('private') && !error.cause)
  }
})

test('pending rows use bounded queries and rotate around unrecoverable early operations', async () => {
  const f = fixture({ pending: [[{ ...history, id: '10' }, { ...history, id: '20' }], [{ ...history, id: '30' }], [{ ...history, id: '10' }]] })
  assert.deepEqual((await f.repository.listPendingRows(2)).map(row => row.id), ['10', '20'])
  assert.deepEqual((await f.repository.listPendingRows(2)).map(row => row.id), ['30', '10'])
  const queries = f.log.filter(row => row.sql?.includes('LIMIT ?'))
  assert.deepEqual(queries.map(row => row.values), [['0', 2], ['20', 2], ['20', 1]])
  assert.match(queries[2].sql, /AND id <= \? ORDER BY id LIMIT \?/)
  for (const query of queries) {
    assert.match(query.sql, /CAST\('false' AS JSON\)/)
    assert.match(query.sql, /CASE WHEN JSON_VALID/)
    assert.doesNotMatch(query.sql, /UPDATE|FOR UPDATE/)
  }
})

test('pending invalid limit is rejected before checking out DB connection', async () => {
  for (const limit of [0, 101, -1, 1.5, '2']) {
    const f = fixture()
    await assert.rejects(f.repository.listPendingRows(limit), { status: 400, code: 'INVALID_LIMIT' })
    assert.equal(f.log.length, 0)
  }
})

test('invalid journal timestamp/oversized TEXT and invalid booking status cannot create writes', async () => {
  for (const change of [value => { value.ack.occurredAt = 'not-a-date' }, value => { value.extra = 'x'.repeat(65536) }]) {
    const f = fixture(), value = metadata(); change(value)
    await assert.rejects(f.repository.transactOperation(operation, tx => tx.insertHistory(value)), { status: 500, code: 'INVALID_JOURNAL' })
    assert.equal(f.log.some(row => row.sql?.startsWith('INSERT')), false)
  }
  const f = fixture()
  await assert.rejects(f.repository.transactOperation(operation, tx => tx.setBookingStatus('UNKNOWN')), { status: 500 })
})

function schemaFixture() {
  const definitions = {
    users: { id: 'bigint', role: 'varchar', status: 'varchar' },
    employees: { id: 'bigint', user_id: 'bigint', status: 'varchar' },
    bookings: { id: 'bigint', customer_id: 'bigint', status: 'varchar' },
    assignments: { id: 'bigint', booking_id: 'bigint', employee_id: 'bigint', status: 'varchar', check_in_at: 'timestamp', check_out_at: 'timestamp' },
    booking_status_history: { id: 'bigint', booking_id: 'bigint', changed_by: 'bigint', status: 'varchar', note: 'text', created_at: 'timestamp' },
  }
  const columns = Object.entries(definitions).flatMap(([table, fields]) => Object.entries(fields).map(([column, type]) => ({ TABLE_NAME: table, COLUMN_NAME: column, DATA_TYPE: type, COLUMN_TYPE: type, IS_NULLABLE: column.startsWith('check_') ? 'YES' : 'NO' })))
  const engines = Object.keys(definitions).map(table => ({ TABLE_NAME: table, ENGINE: 'InnoDB' }))
  const indexes = Object.keys(definitions).map(table => ({ TABLE_NAME: table, INDEX_NAME: 'PRIMARY', COLUMN_NAME: 'id', SEQ_IN_INDEX: 1, NON_UNIQUE: 0 }))
  for (const [table, column, unique] of [['employees', 'user_id', true], ['assignments', 'booking_id', false], ['assignments', 'employee_id', false], ['booking_status_history', 'booking_id', false]]) indexes.push({ TABLE_NAME: table, INDEX_NAME: `idx_${column}`, COLUMN_NAME: column, SEQ_IN_INDEX: 1, NON_UNIQUE: unique ? 0 : 1 })
  const keys = [['employees', 'user_id', 'users'], ['assignments', 'employee_id', 'employees'], ['assignments', 'booking_id', 'bookings'], ['bookings', 'customer_id', 'users'], ['booking_status_history', 'booking_id', 'bookings'], ['booking_status_history', 'changed_by', 'users']].map(([table, column, target]) => ({ TABLE_NAME: table, COLUMN_NAME: column, REFERENCED_TABLE_NAME: target, REFERENCED_COLUMN_NAME: 'id' }))
  return { columns, engines, indexes, keys }
}

test('schema check verifies existing types, signed IDs, InnoDB, indexes and all ownership FKs without DDL', async () => {
  const f = fixture(schemaFixture())
  assert.equal(await f.repository.assertSchema(), true)
  assert.doesNotMatch(f.log.map(row => row.sql || '').join('\n'), /CREATE|ALTER|DROP|UPDATE|DELETE|INSERT/)
})

test('schema check rejects unsupported server, missing FK, unsigned ID and nontransactional engine', async () => {
  const noFk = schemaFixture(); noFk.keys.pop()
  const unsigned = schemaFixture(); unsigned.columns[0].COLUMN_TYPE = 'bigint unsigned'
  const engine = schemaFixture(); engine.engines[0].ENGINE = 'MyISAM'
  const type = schemaFixture(); type.columns.find(row => row.COLUMN_NAME === 'note').DATA_TYPE = 'varchar'
  for (const options of [{ version: '5.7.44' }, { version: '10.11-MariaDB' }, noFk, unsigned, engine, type]) {
    await assert.rejects(fixture(options).repository.assertSchema(), { status: 503, code: 'DATABASE_SCHEMA_INCOMPATIBLE' })
  }
})

test('repository source never writes Staff/Auth tables or disables referential integrity', async () => {
  const source = await readFile(new URL('../src/repository.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /(?:UPDATE|INSERT INTO|DELETE FROM)\s+(?:assignments|users|employees)\b/i)
  assert.doesNotMatch(source, /FOREIGN_KEY_CHECKS|DROP TABLE|DELETE FROM/)
})
