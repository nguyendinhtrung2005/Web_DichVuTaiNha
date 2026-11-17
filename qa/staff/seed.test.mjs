import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateSeedConfig, seedPlan, QA_DATABASE } from './seed.mjs'

const directory = path.dirname(fileURLToPath(import.meta.url))
const config = () => ({ schemaVersion: 'CLEANHOME_STAFF_QA_V1', kind: 'cleanhome.staff-qa-isolated', version: 1, isolated: true,
  runId: 'unit-isolated-no-database', db: { host: '127.0.0.1', port: 3307, database: QA_DATABASE, user: 'staff_qa_app', password: 'test-only-not-a-real-credential-000' },
  mysql: { serverUuid: '00000000-0000-4000-a000-000000000000', dataDir: path.join(directory, '.private', 'mysql', 'data') },
  accounts: Object.fromEntries(['A', 'B', 'MANUAL', 'CUSTOMER'].map((label, index) => [label, { label, userId: String(9601001 + index),
    employeeId: label === 'CUSTOMER' ? null : String(9602001 + index), branchId: '9603001', phone: 'TEST-STAFF-QA-' + (label === 'CUSTOMER' ? 'C' : label), password: 'test-only-not-a-real-password-000' }])),
  seed: { month: '2026-11' } })

test('seed guards refuse shared database, shared port, remote host, root and absent instance binding before SQL', () => {
  const mutations = [c => c.db.database = 'cleanhome_staff_test', c => c.db.port = 3306, c => c.db.host = 'example.invalid', c => c.db.user = 'root',
    c => c.mysql.serverUuid = '', c => c.mysql.dataDir = path.join(directory, '..', 'some-other-instance'), c => c.isolated = false,
    c => c.accounts.B.employeeId = c.accounts.A.employeeId]
  for (const mutate of mutations) { const value = config(); mutate(value); assert.throws(() => validateSeedConfig(value), /^[A-Z_]+$|Error: [A-Z_]+/) }
  assert.equal(validateSeedConfig(config()).db.database, QA_DATABASE)
})

test('deterministic synthetic seed isolates A/B, preserves manual empty and provides all status/time cases', () => {
  const value = config(), plan = seedPlan(value)
  assert.deepEqual(plan, seedPlan(value))
  assert.equal(plan.counts.A.total, 12); assert.equal(plan.counts.B.total, 27); assert.equal(plan.counts.B.done, 10); assert.equal(plan.counts.MANUAL.total, 0)
  assert.equal(new Set(plan.assignments.map(row => row.assignmentId)).size, 39)
  assert.equal(new Set(plan.assignments.map(row => row.bookingId)).size, 39)
  assert.ok(plan.assignments.every(row => row.assignmentId !== row.bookingId && row.userId === value.accounts[row.label].userId && row.employeeId === value.accounts[row.label].employeeId))
  for (const row of plan.assignments.filter(row => row.status === 'DONE')) assert.ok(row.checkInAt && row.checkOutAt && row.checkOutAt >= row.checkInAt)
  for (const status of ['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'DONE', 'CANCELLED']) assert.ok(plan.counts.B.states[status] > 0)
  assert.ok(plan.assignments.some(row => row.scheduledAt.startsWith('2026-10')))
  assert.ok(plan.assignments.some(row => row.scheduledAt.startsWith('2026-11-05')))
  assert.equal(plan.notifications.A.length, 3); assert.equal(plan.notifications.B.length, 3); assert.deepEqual(plan.notifications.MANUAL, [])
  assert.equal(plan.availability.A.length, 3); assert.equal(plan.availability.B.length, 3); assert.deepEqual(plan.availability.MANUAL, [])
})

test('QA schema keeps the relevant worktree table definitions and FK chain without broad schema mutation', async () => {
  const [source, schema] = await Promise.all([readFile(new URL('../../databases/schema.sql', import.meta.url), 'utf8'), readFile(new URL('./schema.sql', import.meta.url), 'utf8')])
  const tables = [...schema.matchAll(/^CREATE TABLE IF NOT EXISTS (\w+)/gm)].map(match => match[1])
  assert.equal(tables.length, 15)
  assert.doesNotMatch(schema.replace(/^--.*$/gm, ''), /\b(?:DROP|ALTER|TRUNCATE|CREATE DATABASE|USE|FOREIGN_KEY_CHECKS)\b/i)
  for (const table of tables.filter(name => name !== 'staff_qa_seed_marker')) {
    const actual = schema.match(new RegExp('CREATE TABLE IF NOT EXISTS ' + table + ' \\([\\s\\S]*?;'))[0]
    const original = source.match(new RegExp('CREATE TABLE ' + table + ' \\([\\s\\S]*?;'))[0]
    assert.equal(actual.replace('CREATE TABLE IF NOT EXISTS', 'CREATE TABLE'), original)
  }
})
