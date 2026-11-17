import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { MysqlStaffRepository } from '../src/repository.js'
import { StaffIncomeService, INCOME_MAX_ASSIGNMENTS, INCOME_POLICY } from '../src/income-service.js'
import { incomeQuery } from '../src/validation.js'

// SQL contract doubles: binding/boundary checks only, not a live MySQL run.
function fixture(answers = []) {
  const log = []
  const connection = {
    async query(sql, values = []) { log.push({ sql, values }); return [[], []] },
    async execute(sql, values = []) {
      log.push({ sql, values })
      const next = answers.shift()
      if (next instanceof Error) throw next
      return [typeof next === 'function' ? next() : next || [], []]
    },
    release() { log.push({ release: true }) },
  }
  return { repository: new MysqlStaffRepository({ async getConnection() { return connection } }), log }
}
const employee = { id: '10', userId: '100', branchId: '20', status: 'ACTIVE', userStatus: 'ACTIVE', userRole: 'EMPLOYEE' }
const actor = Object.freeze({ userId: '100', role: 'staff' })
const period = { month: '2026-11', from: '2026-11-01', to: '2026-11-30', fromUtc: '2026-10-31 17:00:00.000', toUtc: '2026-11-30 17:00:00.000' }
const row = (overrides = {}) => ({
  id: '1', bookingId: '9', status: 'DONE', scheduledStart: '2026-11-05 02:00:00',
  scheduledEnd: '2026-11-05 04:00:00', checkInAt: '2026-11-05 02:05:00', checkOutAt: '2026-11-05 04:00:00',
  bookingStatus: 'COMPLETED', ...overrides,
})
const serviceWith = rows => new StaffIncomeService({ env: { NODE_ENV: "development", STAFF_INCOME_DEMO_ENABLED: "true" }, repository: { async findEmployeeByUserId() { return employee }, async findIncomeAssignments() { return rows } } })

test('income lookup is scoped to the employee and one Vietnam month with an over-limit probe row', async () => {
  const f = fixture([[row()]])
  const rows = await f.repository.findIncomeAssignments('10', period)
  assert.equal(rows[0].id, '1'); assert.equal(rows[0].bookingId, '9')
  const command = f.log.find(item => item.sql.includes('FROM assignments'))
  assert.deepEqual(command.values, ['10', '2026-10-31 17:00:00.000', '2026-11-30 17:00:00.000', '2026-10-31 17:00:00.000', '2026-11-30 17:00:00.000'])
  assert.match(command.sql, /a\.employee_id = \? AND \(/); assert.match(command.sql, /a\.check_out_at >= \? AND a\.check_out_at < \?/); assert.match(command.sql, /b\.scheduled_start >= \? AND b\.scheduled_start < \?/)
  assert.match(command.sql, /ORDER BY b\.scheduled_start, a\.id LIMIT 501/)
  assert.doesNotMatch(command.sql, /booking_items|unit_price|SELECT\s+\*/i)
})

test('only DONE assignments with ordered check-in/check-out count and are paid the illustrative unit price', async () => {
  const rows = [
    row({ id: '1' }),
    row({ id: '2', checkInAt: '2026-11-06 02:00:00', checkOutAt: '2026-11-06 02:00:00' }),
    row({ id: '3', status: 'ASSIGNED', checkInAt: null, checkOutAt: null }),
    row({ id: '4', status: 'ACCEPTED', checkInAt: null, checkOutAt: null }),
    row({ id: '5', status: 'IN_PROGRESS', checkInAt: '2026-11-07 02:00:00', checkOutAt: null }),
    row({ id: '6', status: 'CANCELLED', checkInAt: null, checkOutAt: null }),
  ]
  const result = await serviceWith(rows).estimate(actor, period)
  assert.equal(result.counts.assignments, 6)
  assert.equal(result.counts.eligible, 2)
  assert.equal(result.counts.incomplete, 0)
  assert.equal(result.counts.excluded, 4)
  assert.equal(result.estimateTotalVnd, 120000)
  assert.equal(result.estimateTotalVnd, result.counts.eligible * INCOME_POLICY.unitPriceVnd)
  assert.deepEqual(result.assignments.filter(item => item.eligible).map(item => item.id), ['1', '2'])
})

test('DONE with missing or invalid check times is reported separately and never paid', async () => {
  const rows = [
    row({ id: '1', checkInAt: null }),
    row({ id: '2', checkOutAt: null }),
    row({ id: '3', checkInAt: '2026-11-06 04:00:00', checkOutAt: '2026-11-06 02:00:00' }),
    row({ id: '4' }),
  ]
  const result = await serviceWith(rows).estimate(actor, period)
  assert.equal(result.counts.incomplete, 3)
  assert.equal(result.counts.eligible, 1)
  assert.equal(result.estimateTotalVnd, 60000)
  assert.deepEqual(result.assignments.filter(item => !item.eligible).map(item => item.reason),
    ['MISSING_CHECK_TIMES', 'MISSING_CHECK_TIMES', 'INVALID_CHECK_TIMES'])
})

test('duplicate assignment rows are never counted twice', async () => {
  const result = await serviceWith([row({ id: '1' }), row({ id: '1' })]).estimate(actor, period)
  assert.equal(result.counts.assignments, 1)
  assert.equal(result.counts.eligible, 1)
  assert.equal(result.estimateTotalVnd, 60000)
})

test('a period above the query cap fails instead of returning a partial amount', async () => {
  const rows = Array.from({ length: INCOME_MAX_ASSIGNMENTS + 1 }, (_, index) => row({ id: String(index + 1) }))
  await assert.rejects(serviceWith(rows).estimate(actor, period), { status: 409, code: 'INCOME_RANGE_TOO_LARGE' })
})

test('inactive or non-employee accounts cannot read an income estimate', async () => {
  for (const state of [{ ...employee, status: 'SUSPENDED' }, { ...employee, userStatus: 'LOCKED' }, { ...employee, userRole: 'CUSTOMER' }, null]) {
    const service = new StaffIncomeService({
      repository: {
        async findEmployeeByUserId() { return state },
        async findIncomeAssignments() { throw new Error('must not read assignments') },
      },
    })
    await assert.rejects(service.estimate(actor, period), { status: 403, code: 'STAFF_INACTIVE' })
  }
})

test('income month validation accepts only one real month and never accepts an employee id', () => {
  assert.deepEqual(incomeQuery({ month: '2026-11' }), period)
  assert.deepEqual(incomeQuery({ month: '2026-02' }), {
    month: '2026-02', from: '2026-02-01', to: '2026-02-28',
    fromUtc: '2026-01-31 17:00:00.000', toUtc: '2026-02-28 17:00:00.000',
  })
  for (const query of [{}, { month: '2026-13' }, { month: '2026-00' }, { month: '2026-1' }, { month: '1970-12' }, { month: '2100-01' },
    { month: '2026-11', employeeId: '11' }, { month: ['2026-11'] }]) {
    assert.throws(() => incomeQuery(query), error => error.status === 400, JSON.stringify(query))
  }
})

test('estimate payload is labelled DEMO, excludes payout and never exposes booking price', async () => {
  const result = await serviceWith([row()]).estimate(actor, period)
  assert.equal(result.policy.code, 'ESTIMATE_FOR_DEMO')
  assert.equal(result.policy.unitPriceVnd, 60000)
  assert.match(result.policy.label, /minh họa 60\.000đ\/công việc/)
  assert.deepEqual(result.payout, { status: 'NOT_INTEGRATED' })
  assert.deepEqual(result.period, { month: '2026-11', from: '2026-11-01', to: '2026-11-30', timezone: 'Asia/Ho_Chi_Minh' })
  for (const key of ['unitPrice', 'totalPrice', 'revenue', 'salary', 'commission', 'tax']) {
    assert.equal(key in result.assignments[0], false)
  }
})

test('income service is read-only and does not touch payment or revenue tables', async () => {
  const source = await readFile(new URL('../src/income-service.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /(?:INSERT|UPDATE|DELETE)\s|booking_items|unit_price|revenue_shares|payments?\b/i)
})

test('A/B employee lookup binds each estimate to the authenticated actor only', async () => {
  const calls = []
  const service = new StaffIncomeService({
    env: { NODE_ENV: 'development', STAFF_INCOME_DEMO_ENABLED: 'true' },
    repository: {
      async findEmployeeByUserId(userId) {
        return { ...employee, id: userId === '100' ? '10' : '20', userId }
      },
      async findIncomeAssignments(employeeId) {
        calls.push(employeeId)
        return [row({ id: employeeId === '10' ? '11' : '22' })]
      },
    },
  })
  const a = await service.estimate({ userId: '100' }, { ...period, employeeId: '20' })
  const b = await service.estimate({ userId: '200' }, { ...period, employeeId: '10' })
  assert.deepEqual(calls, ['10', '20'])
  assert.deepEqual(a.assignments.map(value => value.id), ['11'])
  assert.deepEqual(b.assignments.map(value => value.id), ['22'])
})
