import test from 'node:test'
import assert from 'node:assert/strict'
import { createPool } from '../src/db.js'
import { MysqlStaffRepository } from '../src/repository.js'
import { readFile } from 'node:fs/promises'
import { positiveId } from '../src/validation.js'

const enabled = process.env.RUN_MYSQL_TESTS === 'true'
test('real MySQL schema and read-only repository integration (no DDL, fixtures or writes)', { skip: enabled ? false : 'Set RUN_MYSQL_TESTS=true and MYSQL_* for an existing test database.', timeout: 30000 }, async t => {
  assert.ok(process.env.MYSQL_USER && process.env.MYSQL_DATABASE, 'MYSQL_USER and MYSQL_DATABASE are required')
  const pool = createPool({ host: process.env.MYSQL_HOST || '127.0.0.1', port: Number(process.env.MYSQL_PORT || 3306), user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD || '', database: process.env.MYSQL_DATABASE, connectionLimit: 1 })
  t.after(() => pool.end())
  const repository = new MysqlStaffRepository(pool)
  await t.test('connection and eight-table Staff schema contract', async () => {
    assert.equal(await repository.health(), true)
    assert.equal(await repository.assertSchema(), true)
  })
  await t.test('all 32 original tables exist without applying schema changes', async () => {
    const ddl = await readFile(new URL('../../../databases/schema.sql', import.meta.url), 'utf8')
    const expected = [...ddl.matchAll(/^CREATE TABLE (\w+)/gm)].map(match => match[1])
    assert.equal(expected.length, 32)
    const actual = await repository.connection(async connection => {
      const [rows] = await connection.execute("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE'")
      return new Set(rows.map(row => row.name))
    })
    for (const table of expected) assert.ok(actual.has(table), 'Missing expected table: ' + table)
  })
  // Read existing IDs only. Empty databases exercise negative/empty SQL paths;
  // this neither creates an employee nor fabricates an authenticated HTTP actor.
  const users = await repository.connection(async connection => {
    const [rows] = await connection.execute('SELECT user_id AS userId FROM employees ORDER BY id LIMIT 1')
    return rows
  })
  const userId = process.env.TEST_STAFF_USER_ID ? positiveId(process.env.TEST_STAFF_USER_ID) : users[0] ? String(users[0].userId) : '9223372036854775807'
  const employee = await repository.findEmployeeByUserId(userId)
  if (process.env.TEST_STAFF_USER_ID) assert.ok(employee, 'TEST_STAFF_USER_ID must have an existing employees row')
  const employeeId = employee?.id || '9223372036854775807'
  let result
  await t.test('owned list, status filter, pagination and sort execute against MySQL', async () => {
    result = await repository.findJobs(employeeId, { page: 1, pageSize: 20, sort: 'asc' })
    const filtered = await repository.findJobs(employeeId, { status: 'ASSIGNED', page: 1, pageSize: 1, sort: 'desc' })
    assert.ok(Number.isInteger(result.total)); assert.ok(Array.isArray(result.items))
    assert.ok(result.items.every(row => row.employeeId === employeeId))
    assert.ok(filtered.items.length <= 1); assert.ok(filtered.items.every(row => row.status === 'ASSIGNED'))
    if (!employee) { assert.equal(result.total, 0); assert.deepEqual(result.items, []) }
  })
  await t.test('owned detail and booking snapshot queries execute against MySQL', async () => {
    if (result.items.length) {
      for (const row of result.items) assert.equal((await repository.findJob(employeeId, row.id)).id, row.id)
    } else {
      assert.equal(await repository.findJob(employeeId, '9223372036854775807'), null)
    }
    const items = await repository.getBookingItems(result.items.length ? result.items.map(row => row.bookingId) : ['9223372036854775807'])
    assert.ok(items instanceof Map)
  })
  await t.test('schedule overlap query runs with UTC boundaries and remains employee-scoped', async () => {
    const range = { fromUtc: '2026-01-01 00:00:00', toUtc: '2027-01-01 00:00:00', page: 1, pageSize: 20, sort: 'asc' }
    const schedule = await repository.findJobs(employeeId, range)
    assert.ok(schedule.items.every(row => row.employeeId === employeeId && row.scheduledStart < range.toUtc && row.scheduledEnd > range.fromUtc))
    if (!employee) assert.deepEqual(schedule.items, [])
  })
})
