import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalQaJson, createQaData, planQaSlots } from '../scripts/uc12-qa-data.mjs'

// Explicit SQL double and private scratch artifacts only. Never a MySQL test.
const ROOT = fileURLToPath(new URL('../../../frontend/apps/staff/.auth-data/qa/', import.meta.url))
const NOW = Date.parse('2026-10-24T02:00:00.000Z')
const copy = value => JSON.parse(JSON.stringify(value))
function fakePool() {
  const contact = { _cleanhome_fixture: 'cleanhome-staff-uc9-uc12-v1', recipient: 'QA Customer', phone: 'TEST-CUSTOMER-UC9', address_text: 'QA address' }
  const db = { calls: [], tables: {
    bookings: [{ id: '9109007', customer_id: '9109001', branch_id: '9109003', address_snapshot: contact, scheduled_start: '2026-10-24 01:00:00', scheduled_end: '2026-10-24 03:00:00', status: 'CONFIRMED', total_amount: '123.45' },
      ...['9109131', '9109141'].map(id => ({ id, customer_id: '9109001', branch_id: '9109003', address_snapshot: {}, scheduled_start: '2026-10-20 01:00:00', scheduled_end: '2026-10-20 03:00:00', status: 'COMPLETED', total_amount: '123.45' }))],
    booking_items: [], assignments: [], booking_status_history: [],
  }, next: { bookings: 9200000, booking_items: 9300000, assignments: 9400000 }, triggers: [], userStatus: 'ACTIVE' }
  let transaction
  async function sql(statement, params = []) {
    db.calls.push({ statement, params: copy(params) })
    if (statement.startsWith('SET ') || statement.startsWith('START TRANSACTION')) return [[], []]
    if (statement.startsWith('SELECT DATABASE()')) return [[{ databaseName: 'cleanhome_staff_test', port: 3306, version: '9.6.0' }]]
    if (statement.startsWith('SELECT GET_LOCK')) return [[{ acquired: 1 }]]
    if (statement.startsWith('SELECT RELEASE_LOCK')) return [[{ released: 1 }]]
    if (statement.includes('information_schema.tables')) return [Array.from({ length: 32 }, (_, i) => ({ table_name: 'table' + i, engine: 'InnoDB' }))]
    if (statement.includes('information_schema.triggers')) return [db.triggers]
    if (statement.startsWith('SHOW CREATE TABLE')) return [[{ 'Create Table': 'CREATE TABLE ' + statement.split(' ').at(-1) + ' (id BIGINT PRIMARY KEY)' }]]
    if (statement.startsWith('SELECT id, role, status FROM users')) return [[{ id: '9109001', role: 'CUSTOMER', status: db.userStatus }, { id: '9109002', role: 'EMPLOYEE', status: 'ACTIVE' }, { id: '9109101', role: 'EMPLOYEE', status: 'ACTIVE' }]]
    if (statement.startsWith('SELECT id,user_id,branch_id,status')) return [[{ id: '9109004', user_id: '9109002', branch_id: '9109003', status: 'ACTIVE' }, { id: '9109102', user_id: '9109101', branch_id: '9109003', status: 'ACTIVE' }]]
    if (statement.startsWith('SELECT id,status FROM branches')) return [[{ id: '9109003', status: 'ACTIVE' }]]
    if (statement.startsWith('SELECT id,name,unit,base_price,is_active')) return [[{ id: '9109006', name: 'QA service', unit: 'giờ', base_price: '123.45', is_active: 1 }]]
    if (statement.startsWith('SELECT address_snapshot FROM bookings')) return [[{ address_snapshot: copy(contact) }]]
    if (statement.startsWith('SELECT DISTINCT b.scheduled_start')) return [[...db.tables.bookings].map(({ scheduled_start, scheduled_end }) => ({ scheduled_start, scheduled_end }))]
    if (statement.startsWith('SELECT id FROM bookings WHERE JSON_UNQUOTE')) return [db.tables.bookings.filter(row => row.address_snapshot?._cleanhome_order_qa === params[0]).map(({ id }) => ({ id }))]
    const read = /^SELECT \* FROM (bookings|booking_items|assignments|booking_status_history)(.*)$/.exec(statement)
    if (read) {
      const [, table, suffix] = read
      return [copy(db.tables[table].filter(row => !suffix.includes('WHERE') || String(suffix.includes('WHERE id=') ? row.id : row.booking_id) === String(params[0])))]
    }
    if (statement.startsWith('INSERT INTO bookings')) {
      const id = String(db.next.bookings++)
      db.tables.bookings.push({ id, customer_id: params[0], branch_id: params[1], address_snapshot: JSON.parse(params[2]), scheduled_start: params[3], scheduled_end: params[4], status: params[5], total_amount: params[6] })
      return [{ insertId: id, affectedRows: 1 }]
    }
    if (statement.startsWith('INSERT INTO booking_items')) {
      const id = String(db.next.booking_items++)
      db.tables.booking_items.push({ id, booking_id: params[0], service_id: params[1], service_name_snapshot: params[2], quantity: params[3], unit_price: params[4], unit_snapshot: params[5], entitlement_id: null })
      return [{ insertId: id, affectedRows: 1 }]
    }
    if (statement.startsWith('INSERT INTO assignments')) {
      const id = String(db.next.assignments++)
      db.tables.assignments.push({ id, booking_id: params[0], employee_id: params[1], assigned_at: params[2], status: params[3], check_in_at: null, check_out_at: null })
      return [{ insertId: id, affectedRows: 1 }]
    }
    throw new Error('Unexpected SQL in test double: ' + statement)
  }
  const connection = { query: sql, execute: sql,
    async beginTransaction() { transaction = copy(db.tables) }, async commit() { transaction = undefined },
    async rollback() { if (transaction) db.tables = transaction; transaction = undefined }, release() {},
  }
  return { pool: { pool: { config: { connectionConfig: { host: '127.0.0.1', port: 3306, database: 'cleanhome_staff_test' } } }, async getConnection() { return connection } }, db }
}
async function fixture(t) {
  const { pool, db } = fakePool(), directory = path.resolve(ROOT, 'uc12-data-unit-' + randomUUID())
  const options = { pool, artifactDir: directory, approvalRef: 'unit-only-approval-no-live-db', runId: 'unit-' + randomUUID(), now: () => NOW }
  const qa = createQaData(options)
  t.after(async () => { await qa.close(); const target = path.resolve(directory); assert.equal(path.dirname(target), path.resolve(ROOT)); assert.ok(path.basename(target).startsWith('uc12-data-unit-')); await rm(target, { recursive: true, force: true }) })
  return { qa, db, pool, directory, options }
}

test('canonical snapshots preserve values while ignoring JSON object-key order', () => {
  assert.equal(canonicalQaJson({ z: 1, a: { y: '10.00', x: ['2', null] } }), canonicalQaJson({ a: { x: ['2', null], y: '10.00' }, z: 1 }))
  assert.notEqual(canonicalQaJson({ amount: '10.00' }), canonicalQaJson({ amount: 10 }))
})
test('six UTC slots avoid all saved intervals and are separate Vietnam 08:00 windows', () => {
  const first = planQaSlots([], NOW), result = planQaSlots([{ scheduled_start: first[0].scheduledStart, scheduled_end: first[1].scheduledEnd }], NOW)
  assert.equal(result.length, 6)
  assert.ok(Date.parse(result[0].scheduledStart) >= Date.parse(first[1].scheduledEnd))
  for (const [index, slot] of result.entries()) { assert.equal(slot.scheduledStart.slice(11, 16), '01:00'); assert.equal(Date.parse(slot.scheduledEnd) - Date.parse(slot.scheduledStart), 7200000); if (index) assert.ok(slot.scheduledStart > result[index - 1].scheduledEnd) }
})
test('bad schedule, clocks and unsupported TIMESTAMP range fail rather than guess', () => {
  assert.throws(() => planQaSlots([{ scheduled_start: 'not-a-time', scheduled_end: 'not-a-time' }], NOW))
  assert.throws(() => planQaSlots([], NaN)); assert.throws(() => planQaSlots([], Date.UTC(2038, 0, 18)))
})
test('preflight creates readable consistent backup and planned manifest without INSERT', async t => {
  const f = await fixture(t), manifest = await f.qa.preflightAndBackup(), backup = JSON.parse(await readFile(path.join(f.directory, manifest.backup.file), 'utf8'))
  assert.equal(manifest.fixtures.length, 6); assert.equal(manifest.allowlist.bookingIds.length, 0)
  assert.equal(backup.tables.bookings.length, 3); assert.equal(Object.keys(backup.schema).length, 4)
  assert.ok(f.db.calls.some(call => call.statement === 'START TRANSACTION WITH CONSISTENT SNAPSHOT'))
  assert.equal(f.db.calls.some(call => /^INSERT|UPDATE|DELETE|DROP|TRUNCATE/.test(call.statement)), false)
})
test('fixture writes require explicit approval and verified backup first', async t => {
  const f = await fixture(t)
  await assert.rejects(f.qa.createFixtures(), /writeApproved/)
  await assert.rejects(f.qa.createFixtures({ writeApproved: true }))
  assert.equal(f.db.tables.bookings.length, 3)
})
test('exact six bookings/items and twelve A/B assignments are created once, with real snapshot values', async t => {
  const f = await fixture(t); await f.qa.preflightAndBackup()
  const m = await f.qa.createFixtures({ writeApproved: true })
  assert.deepEqual([f.db.tables.bookings.length, f.db.tables.booking_items.length, f.db.tables.assignments.length], [9, 6, 12])
  assert.equal(new Set(m.fixtures.map(x => x.marker)).size, 6)
  for (const row of m.fixtures) { const state = await f.qa.inspectFixture(row.code); assert.equal(state.booking.total_amount, '123.45'); assert.equal(state.items[0].unit_price, '123.45'); assert.equal(state.assignments[0].employee_id, '9109004'); assert.equal(state.assignments[1].employee_id, '9109102'); assert.ok(state.assignments.every(a => a.status === 'ASSIGNED' && a.check_in_at === null && a.check_out_at === null)); assert.equal(state.journals.length, 0) }
  await f.qa.createFixtures({ writeApproved: true })
  assert.equal(f.db.tables.bookings.length, 9); assert.equal((await f.qa.assertPreserved()).outsideAllowlistUnchanged, true)
})
test('marker recovery after fixture commit but manifest publication loss never inserts duplicates', async t => {
  const f = await fixture(t), planned = await f.qa.preflightAndBackup(); await f.qa.createFixtures({ writeApproved: true })
  await writeFile(path.join(f.directory, 'manifest.json'), JSON.stringify(planned))
  await f.qa.preflightAndBackup()
  const recovered = await f.qa.createFixtures({ writeApproved: true })
  assert.equal(recovered.allowlist.assignmentIds.length, 12); assert.equal(f.db.tables.bookings.length, 9)
})
test('partial marker set fails closed without creating the other fixtures', async t => {
  const f = await fixture(t), planned = await f.qa.preflightAndBackup(); await f.qa.createFixtures({ writeApproved: true })
  f.db.tables.bookings = f.db.tables.bookings.filter(row => !row.address_snapshot?.qaCase || row.address_snapshot.qaCase === 'Q01')
  await writeFile(path.join(f.directory, 'manifest.json'), JSON.stringify(planned))
  await assert.rejects(f.qa.preflightAndBackup(), /Partial/)
  assert.equal(f.db.tables.bookings.length, 4)
})
test('outside-allowlist changes and fixture immutable price changes are detected', async t => {
  const f = await fixture(t); await f.qa.preflightAndBackup(); const m = await f.qa.createFixtures({ writeApproved: true })
  f.db.tables.bookings[0].status = 'CANCELLED'
  await assert.rejects(f.qa.assertPreserved(), /OUTSIDE_ALLOWLIST_CHANGED/)
  f.db.tables.bookings[0].status = 'CONFIRMED'
  f.db.tables.bookings.find(row => row.id === m.fixtures[0].bookingId).total_amount = '1.00'
  await assert.rejects(f.qa.assertPreserved(), /FIXTURE_IMMUTABLE_CHANGED/)
})
test('tampered backup cannot authorize further fixture writes', async t => {
  const f = await fixture(t); await f.qa.preflightAndBackup()
  const target = path.join(f.directory, 'mysql-consistent-backup.json'), backup = JSON.parse(await readFile(target, 'utf8'))
  backup.tables.bookings[0].status = 'COMPLETED'; await writeFile(target, JSON.stringify(backup))
  await assert.rejects(f.qa.createFixtures({ writeApproved: true }), /hash verification/)
  assert.equal(f.db.tables.bookings.length, 3)
})
test('wrong host, trigger side effects and inactive reference fail before fixture INSERT', async t => {
  const f = await fixture(t); f.pool.pool.config.connectionConfig.host = 'production.invalid'
  await assert.rejects(f.qa.preflightAndBackup(), /Refusing connection/)
  f.pool.pool.config.connectionConfig.host = '127.0.0.1'; f.db.triggers = [{ trigger_name: 'unexpected-trigger' }]
  await assert.rejects(f.qa.preflightAndBackup(), /side-effect triggers/)
  f.db.triggers = []; f.db.userStatus = 'LOCKED'
  await assert.rejects(f.qa.preflightAndBackup(), /not active/)
  assert.equal(f.db.tables.bookings.length, 3)
})
test('result metadata rejects credentials and stores only structured statuses', async t => {
  const f = await fixture(t); await f.qa.preflightAndBackup()
  await assert.rejects(f.qa.recordResult('Q01', { status: 'PASS', accessToken: 'never-write-this' }), /forbidden/)
  await f.qa.recordResult('Q01', { status: 'NOT_RUN', reason: 'Unit SQL double only' })
  assert.equal((await f.qa.readManifest()).fixtures[0].results[0].status, 'NOT_RUN')
})
