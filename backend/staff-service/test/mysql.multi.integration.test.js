import test from 'node:test'
import assert from 'node:assert/strict'
import { createPool } from '../src/db.js'
import { MysqlStaffRepository } from '../src/repository.js'
import { StaffJobService } from '../src/job-service.js'
import { listQuery } from '../src/validation.js'
import { iso } from '../src/mapping.js'

const enabled = process.env.RUN_MYSQL_MULTI_TESTS === 'true'
const fixture = {
  a: { user: '9109002', employee: '9109004', jobs: ['9109008', '9109113', '9109123', '9109133'] },
  b: { user: '9109101', employee: '9109102', jobs: ['9109105', '9109134'] },
}
const jobIds = [...fixture.a.jobs, ...fixture.b.jobs]
const bookingIds = ['9109007', '9109103', '9109111', '9109121', '9109131']
const ids = rows => rows.map(row => String(row.id))
const timestamp = value => Date.parse(value instanceof Date ? value.toISOString() : String(value).replace(' ', 'T') + 'Z')
const sqlTime = milliseconds => new Date(milliseconds).toISOString().slice(0, 23).replace('T', ' ')
const compareJobs = (a, b) => timestamp(a.scheduledStart) - timestamp(b.scheduledStart) || (BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0)
const placeholders = values => values.map(() => '?').join(', ')

async function snapshot(repository) {
  return repository.connection(async connection => {
    const [assignments] = await connection.execute(`SELECT id, booking_id, employee_id, status, assigned_at, check_in_at, check_out_at
      FROM assignments WHERE id IN (${placeholders(jobIds)}) ORDER BY id`, jobIds)
    const [bookings] = await connection.execute(`SELECT id, customer_id, branch_id, scheduled_start, scheduled_end, status, total_amount, address_snapshot
      FROM bookings WHERE id IN (${placeholders(bookingIds)}) ORDER BY id`, bookingIds)
    const [items] = await connection.execute(`SELECT id, booking_id, service_id, service_name_snapshot, quantity, unit_price, unit_snapshot
      FROM booking_items WHERE booking_id IN (${placeholders(bookingIds)}) ORDER BY id`, bookingIds)
    return { assignments, bookings, items }
  })
}

async function allJobs(repository, employee, query = {}) {
  const items = []
  for (let page = 1; page <= 100; page++) {
    const result = await repository.findJobs(employee, { page, pageSize: 100, sort: 'asc', ...query })
    items.push(...result.items)
    if (items.length >= result.total) { assert.equal(items.length, result.total); return items }
  }
  assert.fail('The isolated test employee has more than 10000 jobs; use a dedicated test dataset.')
}

// This suite connects ONLY when explicitly enabled and NEVER applies SQL files,
// inserts fixtures, signs JWTs, or calls a status mutation/transaction callback.
test('real MySQL multi-employee fixtures: read-only ownership, filtering, sorting and pagination', {
  skip: enabled ? false : 'Set RUN_MYSQL_MULTI_TESTS=true after manually reviewing and applying both test seeds.',
  timeout: 45000,
}, async t => {
  assert.equal(process.env.MYSQL_DATABASE, 'cleanhome_staff_test', 'Multi tests are restricted to cleanhome_staff_test.')
  assert.ok(process.env.MYSQL_USER, 'MYSQL_USER is required; never print credentials.')
  const pool = createPool({ host: process.env.MYSQL_HOST || '127.0.0.1', port: Number(process.env.MYSQL_PORT || 3306), user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD || '', database: process.env.MYSQL_DATABASE, connectionLimit: 1 })
  t.after(() => pool.end())
  const repository = new MysqlStaffRepository(pool)
  await repository.assertSchema()
  const before = await snapshot(repository)
  let a, b
  try {
    await t.test('both real employee profiles and all six expected owned jobs must exist', async () => {
      for (const expected of [fixture.a, fixture.b]) {
        const employee = await repository.findEmployeeByUserId(expected.user)
        assert.ok(employee, 'Missing employee fixture; manually review and run the seeds first.')
        assert.equal(employee.id, expected.employee); assert.equal(employee.userRole, 'EMPLOYEE')
        assert.equal(employee.status, 'ACTIVE'); assert.equal(employee.userStatus, 'ACTIVE')
        for (const id of expected.jobs) assert.ok(await repository.findJob(employee.id, id), 'Missing owned assignment ' + id)
      }
    })
    // Required preconditions also fail the parent test explicitly if a subtest
    // fails; missing fixtures never turn into an empty-list integration pass.
    for (const expected of [fixture.a, fixture.b]) {
      assert.equal((await repository.findEmployeeByUserId(expected.user))?.id, expected.employee, 'Required fixture employee is missing.')
      for (const id of expected.jobs) assert.ok(await repository.findJob(expected.employee, id), 'Required fixture assignment is missing: ' + id)
    }
    a = await allJobs(repository, fixture.a.employee)
    b = await allJobs(repository, fixture.b.employee)
    await t.test('UC9 lists have multiple real rows and never cross employee boundaries', async () => {
      assert.ok(a.length >= 4); assert.ok(b.length >= 2)
      assert.ok(a.every(row => row.employeeId === fixture.a.employee)); assert.ok(b.every(row => row.employeeId === fixture.b.employee))
      for (const id of fixture.a.jobs) { assert.ok(ids(a).includes(id)); assert.ok(!ids(b).includes(id)) }
      for (const id of fixture.b.jobs) { assert.ok(ids(b).includes(id)); assert.ok(!ids(a).includes(id)) }
    })
    await t.test('UC10 A cannot read B and B cannot read A, including a shared booking', async () => {
      const service = new StaffJobService({ repository })
      for (const id of fixture.b.jobs) {
        assert.equal(await repository.findJob(fixture.a.employee, id), null)
        await assert.rejects(service.detail({ userId: fixture.a.user }, id), { status: 404, code: 'JOB_NOT_FOUND' })
      }
      for (const id of fixture.a.jobs) {
        assert.equal(await repository.findJob(fixture.b.employee, id), null)
        await assert.rejects(service.detail({ userId: fixture.b.user }, id), { status: 404, code: 'JOB_NOT_FOUND' })
      }
      assert.equal((await repository.findJob(fixture.a.employee, '9109133')).bookingId, '9109131')
      assert.equal((await repository.findJob(fixture.b.employee, '9109134')).bookingId, '9109131')
    })
    await t.test('ascending and descending sort use actual stored times and stable IDs', async () => {
      for (const [employee, baseline] of [[fixture.a.employee, a], [fixture.b.employee, b]]) {
        assert.deepEqual(ids(baseline), ids([...baseline].sort(compareJobs)))
        assert.deepEqual(ids(await allJobs(repository, employee, { sort: 'desc' })), ids([...baseline].reverse()))
      }
    })
    await t.test('pagination page 2 contains different rows without losing or repeating an assignment', async () => {
      for (const [employee, baseline] of [[fixture.a.employee, a], [fixture.b.employee, b]]) {
        const pageSize = employee === fixture.a.employee ? 2 : 1
        const pages = []
        for (let page = 1; page <= Math.ceil(baseline.length / pageSize); page++) {
          const result = await repository.findJobs(employee, { page, pageSize, sort: 'asc' })
          assert.equal(result.total, baseline.length); assert.ok(result.items.length <= pageSize)
          pages.push(...result.items)
        }
        assert.deepEqual(ids(pages), ids(baseline)); assert.equal(new Set(ids(pages)).size, pages.length)
        const beyond = await repository.findJobs(employee, { page: baseline.length + 1, pageSize, sort: 'asc' })
        assert.deepEqual(beyond.items, []); assert.equal(beyond.total, baseline.length)
      }
    })
    await t.test('status filters return exact owned counts, and filtered pagination stays scoped', async () => {
      // Compare against the actual stored state: manual UC12 tests can have
      // consumed shared fixtures, and this read-only suite must not reset them.
      for (const [employee, baseline] of [[fixture.a.employee, a], [fixture.b.employee, b]]) {
        for (const status of ['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'DONE', 'CANCELLED']) {
          const expected = baseline.filter(row => row.status === status)
          assert.deepEqual(ids(await allJobs(repository, employee, { status })), ids(expected))
          const page = await repository.findJobs(employee, { status, page: 1, pageSize: 1, sort: 'desc' })
          assert.equal(page.total, expected.length); assert.deepEqual(ids(page.items), ids([...expected].reverse().slice(0, 1)))
        }
      }
    })
    await t.test('UC11 range and non-overlap boundaries remain scoped for A and B', async () => {
      const base = a.find(row => row.id === '9109008'), start = timestamp(base.scheduledStart)
      const fromUtc = sqlTime(start - 3 * 86400000), toUtc = sqlTime(start + 4 * 86400000)
      for (const [employee, baseline] of [[fixture.a.employee, a], [fixture.b.employee, b]]) {
        const expected = baseline.filter(row => timestamp(row.scheduledStart) < Date.parse(toUtc.replace(' ', 'T') + 'Z') && timestamp(row.scheduledEnd) > Date.parse(fromUtc.replace(' ', 'T') + 'Z'))
        assert.deepEqual(ids(await allJobs(repository, employee, { fromUtc, toUtc })), ids(expected))
      }
      const end = timestamp(base.scheduledEnd)
      const after = await allJobs(repository, fixture.a.employee, { fromUtc: sqlTime(end), toUtc: sqlTime(end + 1000) })
      assert.ok(!ids(after).includes(base.id), 'Touching the end is not an overlap.')
      const empty = await repository.findJobs(fixture.b.employee, { fromUtc: '2000-01-01 00:00:00', toUtc: '2000-01-02 00:00:00', page: 1, pageSize: 20, sort: 'asc' })
      assert.equal(empty.total, 0); assert.deepEqual(empty.items, [])
    })
    await t.test('UC11 Vietnam calendar boundaries and service schedule DTOs are correct for both employees', async () => {
      // Direct service/repository calls only: these inputs are not HTTP/JWT identities.
      // No Order client is needed for the read-only schedule path.
      const service = new StaffJobService({ repository })
      const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' })
      const localDay = value => {
        const parts = Object.fromEntries(formatter.formatToParts(new Date(timestamp(value))).map(part => [part.type, part.value]))
        return parts.year + '-' + parts.month + '-' + parts.day
      }
      for (const [person, baseline] of [[fixture.a, a], [fixture.b, b]]) {
        const days = new Set(baseline.flatMap(row => [localDay(row.scheduledStart), localDay(row.scheduledEnd)]))
        for (const day of days) {
          const [year, month, date] = day.split('-').map(Number)
          const start = Date.UTC(year, month - 1, date) - 7 * 3600000, end = start + 86400000
          const query = listQuery({ from: day, to: day, pageSize: '100' }, true)
          assert.equal(query.fromUtc, sqlTime(start)); assert.equal(query.toUtc, sqlTime(end))
          const expected = baseline.filter(row => timestamp(row.scheduledStart) < end && timestamp(row.scheduledEnd) > start)
          const result = await service.list({ userId: person.user }, query)
          assert.equal(result.timezone, 'Asia/Ho_Chi_Minh')
          assert.equal(result.pagination.total, expected.length)
          assert.deepEqual(result.data.map(row => row.assignmentId), ids(expected))
          for (const dto of result.data) {
            const row = expected.find(row => row.id === dto.assignmentId)
            assert.equal(row.employeeId, person.employee)
            assert.equal(dto.orderId, row.bookingId)
            assert.equal(dto.scheduledAt, iso(row.scheduledStart))
            assert.equal(dto.expectedEndAt, iso(row.scheduledEnd))
          }
        }
      }
    })
    await t.test('service snapshots exist for all fixtures, without double-counting shared jobs', async () => {
      const items = await repository.getBookingItems(bookingIds)
      for (const id of bookingIds) {
        assert.ok(items.get(id)?.some(item => item.serviceId === '9109006'), 'Fixture service snapshot missing for booking ' + id)
      }
      assert.equal(a.filter(row => row.bookingId === '9109131').length, 1)
      assert.equal(b.filter(row => row.bookingId === '9109131').length, 1)
    })
  } finally {
    await t.test('all selected database state, timestamps and prices are unchanged', async () => {
      assert.deepEqual(await snapshot(repository), before)
    })
  }
})
