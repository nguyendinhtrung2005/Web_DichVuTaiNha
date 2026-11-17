import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

const people = Object.freeze({
  customerId: '9109001', branchId: '9109003', serviceId: '9109006',
  actorUserIds: Object.freeze(['9109002', '9109101']), employeeIds: Object.freeze(['9109004', '9109102']),
})
const manifestUrl = new URL('../secrets/mysql-qa-manifest.json', import.meta.url)
let manifestQueue = Promise.resolve()
const sqlTime = milliseconds => new Date(milliseconds).toISOString().slice(0, 19).replace('T', ' ')

function fail(message) { throw new Error(message) }
function guarded() {
  if (process.env.ORDER_TEST_ALLOW_FIXTURE_WRITES !== 'true') fail('Explicit ORDER_TEST_ALLOW_FIXTURE_WRITES=true is required for new QA fixtures.')
  if (process.env.MYSQL_DATABASE !== 'cleanhome_staff_test') fail('Order QA fixtures are restricted to cleanhome_staff_test.')
}
async function changeManifest(change) {
  const pending = manifestQueue.then(async () => {
    await mkdir(new URL('../secrets/', import.meta.url), { recursive: true })
    let manifest = { kind: 'cleanhome.order-qa-manifest', version: 1, database: 'cleanhome_staff_test', fixtures: [], operations: [] }
    try {
      const prior = JSON.parse(await readFile(manifestUrl, 'utf8'))
      if (prior.kind !== manifest.kind || prior.version !== 1 || prior.database !== manifest.database || !Array.isArray(prior.fixtures) || !Array.isArray(prior.operations)) fail('Unexpected QA manifest format; inspect metadata file before running tests.')
      manifest = prior
    } catch (error) { if (error.code !== 'ENOENT') throw error }
    change(manifest)
    await writeFile(manifestUrl, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 })
  })
  manifestQueue = pending.catch(() => {})
  return pending
}

/** Records IDs only: no password, phone, key, service credential or JWT. */
export async function appendFixtureOperation(fixture, operation) {
  if (operation.bookingId !== fixture.bookingId || !fixture.assignmentIds.includes(operation.assignmentId)) fail('Operation is outside the generated QA fixture.')
  await changeManifest(manifest => {
    if (!manifest.operations.some(value => value.id === operation.id)) manifest.operations.push({ ...operation, fixtureMarker: fixture.marker })
  })
}

/**
 * Inserts a separately labelled booking/item/two assignments; never updates or
 * deletes existing rows. Only called after explicit live-test write opt-in.
 * Fixtures deliberately remain in MySQL for audit/recovery after the run.
 */
export async function createFixture(pool, { label, status = 'CONFIRMED', assignmentStatuses = ['ASSIGNED', 'ASSIGNED'] } = {}) {
  guarded()
  if (typeof label !== 'string' || !label.trim() || label.length > 100) fail('A short explicit QA fixture label is required.')
  if (!['PENDING', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'].includes(status)) fail('Invalid fixture booking status.')
  if (!Array.isArray(assignmentStatuses) || assignmentStatuses.length !== 2 || assignmentStatuses.some(value => !['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'DONE', 'CANCELLED'].includes(value))) fail('Exactly two supported assignment statuses are required.')
  const connection = await pool.getConnection()
  let began = false
  try {
    await connection.query("SET SESSION time_zone = '+00:00'")
    const [database] = await connection.execute('SELECT DATABASE() AS databaseName')
    if (database[0]?.databaseName !== 'cleanhome_staff_test') fail('Actual MySQL database is not cleanhome_staff_test; refusing fixture writes.')
    const [users] = await connection.execute('SELECT id, role, status FROM users WHERE id IN (?, ?, ?) ORDER BY id', [people.customerId, ...people.actorUserIds])
    const customer = users.find(row => String(row.id) === people.customerId)
    if (customer?.role !== 'CUSTOMER' || customer.status !== 'ACTIVE') fail('Expected active QA Customer is missing.')
    for (const id of people.actorUserIds) if (!users.some(row => String(row.id) === id && row.role === 'EMPLOYEE' && row.status === 'ACTIVE')) fail('Expected active QA Employee account is missing.')
    const [employees] = await connection.execute('SELECT id, user_id AS userId, branch_id AS branchId, status FROM employees WHERE id IN (?, ?) ORDER BY id', people.employeeIds)
    for (const [index, id] of people.employeeIds.entries()) if (!employees.some(row => String(row.id) === id && String(row.userId) === people.actorUserIds[index] && String(row.branchId) === people.branchId && row.status === 'ACTIVE')) fail('Expected QA employee/user/branch linkage is missing.')
    const [branches] = await connection.execute('SELECT id FROM branches WHERE id = ?', [people.branchId])
    if (branches.length !== 1) fail('Expected QA branch is missing.')
    const [services] = await connection.execute('SELECT id, name, unit, base_price AS price, is_active AS active FROM services WHERE id = ?', [people.serviceId])
    if (services.length !== 1 || Number(services[0].active) !== 1 || !/^\d+(?:\.\d{1,2})?$/.test(String(services[0].price))) fail('Expected active QA service is missing or invalid.')
    const service = services[0], marker = randomUUID(), createdAt = new Date(Math.floor(Date.now() / 1000) * 1000).toISOString()
    const now = Date.parse(createdAt), address = JSON.stringify({ _cleanhome_order_qa: marker, label: label.trim(), source: 'order-service-integration' })
    await connection.beginTransaction(); began = true
    const [booking] = await connection.execute(`INSERT INTO bookings
      (customer_id, branch_id, address_snapshot, scheduled_start, scheduled_end, status, total_amount)
      VALUES (?, ?, ?, ?, ?, ?, ?)`, [people.customerId, people.branchId, address, sqlTime(now + 86400000), sqlTime(now + 93600000), status, String(service.price)])
    const bookingId = String(booking.insertId)
    const [item] = await connection.execute(`INSERT INTO booking_items
      (booking_id, service_id, service_name_snapshot, quantity, unit_price, unit_snapshot) VALUES (?, ?, ?, ?, ?, ?)`, [bookingId, people.serviceId, service.name, '1.00', String(service.price), service.unit])
    const assignmentIds = []
    for (const [index, employeeId] of people.employeeIds.entries()) {
      const assignmentStatus = assignmentStatuses[index]
      const checkIn = assignmentStatus === 'IN_PROGRESS' ? sqlTime(now - 60000) : assignmentStatus === 'DONE' ? sqlTime(now - 120000) : null
      const checkOut = assignmentStatus === 'DONE' ? sqlTime(now - 60000) : null
      const [assignment] = await connection.execute(`INSERT INTO assignments
        (booking_id, employee_id, assigned_at, status, check_in_at, check_out_at) VALUES (?, ?, ?, ?, ?, ?)`, [bookingId, employeeId, sqlTime(now), assignmentStatus, checkIn, checkOut])
      assignmentIds.push(String(assignment.insertId))
    }
    await connection.commit(); began = false
    const fixture = { bookingId, assignmentIds, itemId: String(item.insertId), marker, label: label.trim(), status, assignmentStatuses: [...assignmentStatuses], employeeIds: [...people.employeeIds], actorUserIds: [...people.actorUserIds], createdAt }
    await changeManifest(manifest => manifest.fixtures.push(fixture))
    return fixture
  } catch (error) {
    if (began) { try { await connection.rollback() } catch { /* No delete/reset fallback. */ } }
    throw error
  } finally { connection.release() }
}
