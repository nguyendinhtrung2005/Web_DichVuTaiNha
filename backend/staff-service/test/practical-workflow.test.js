import test from 'node:test'
import assert from 'node:assert/strict'
import { listQuery } from '../src/validation.js'
import { MysqlStaffRepository } from '../src/repository.js'
import { StaffJobService } from '../src/job-service.js'
import { OrderClient } from '../src/order-client.js'

// Repository/network doubles only. Never opens MySQL or writes fixture data.
test('job dates use inclusive Vietnam days, combined service/status and stable pagination', () => {
  const q = listQuery({ from: '2026-12-31', to: '2027-01-01', serviceId: '9007199254740993', status: 'WAITING', page: '2', sort: 'desc' })
  assert.equal(q.fromUtc, '2026-12-30 17:00:00.000')
  assert.equal(q.toUtc, '2027-01-01 17:00:00.000')
  assert.equal(q.serviceId, '9007199254740993'); assert.equal(q.status, 'ASSIGNED'); assert.equal(q.page, 2)
})
test('job filters reject missing/reversed/impossible/oversized dates and guessed area/staff count', () => {
  for (const q of [{ from: '2026-11-01' }, { from: '2026-02-30', to: '2026-03-01' }, { from: '2027-01-01', to: '2026-12-31' },
    { from: '2026-01-01', to: '2027-01-02' }, { serviceId: '1 OR 1=1' }, { serviceId: ['1', '2'] }, { area: '100' }, { required_staff_count: '3' }, { employeeId: '20' }]) {
    assert.throws(() => listQuery(q), { status: 400 })
  }
})
test('SQL combines owned assignments + date/status + EXISTS service without multiplying rows', async () => {
  const calls = [], con = { async query(sql, values) { calls.push({ sql, values }); return values ? [[{ id: 1, bookingId: 2, employeeId: 10 }]] : [[]] },
    async execute(sql, values) { calls.push({ sql, values }); return [[{ total: '1' }]] }, release() {} }
  const repository = new MysqlStaffRepository({ async getConnection() { return con } })
  const q = listQuery({ from: '2026-11-01', to: '2026-11-30', serviceId: '5', status: 'DONE', sort: 'desc' })
  assert.equal((await repository.findJobs('10', q)).total, 1)
  for (const call of calls.filter(c => c.values)) {
    assert.match(call.sql, /a\.employee_id = \?/); assert.match(call.sql, /EXISTS \(SELECT 1 FROM booking_items filtered/)
    assert.deepEqual(call.values.slice(0, 3), ['10', 'DONE', '5'])
    assert.doesNotMatch(call.sql, /quantity|COUNT\(\*\).*JOIN booking_items/i)
  }
})
test('service facets bind the current employee across all pages and cap incomplete results', async () => {
  let answers = [{ id: 5, name: 'Cleaning' }], bound
  const repository = new MysqlStaffRepository({ async getConnection() { return { async query() { return [[]] },
    async execute(sql, values) { bound = { sql, values }; return [answers] }, release() {} } } })
  assert.deepEqual(await repository.findJobServices('10'), [{ id: '5', name: 'Cleaning' }])
  assert.deepEqual(bound.values, ['10']); assert.match(bound.sql, /SELECT DISTINCT/); assert.match(bound.sql, /a\.employee_id = \?/)
  answers = Array.from({ length: 501 }, (_, n) => ({ id: n + 1, name: 'service' }))
  await assert.rejects(repository.findJobServices('10'), { status: 503, code: 'JOB_FILTERS_UNAVAILABLE' })
})
test('service filters authorize A/B independently and deny an inactive employee before reads', async () => {
  const calls = [], repository = { async findEmployeeByUserId(userId) { return { id: userId, status: userId === '30' ? 'INACTIVE' : 'ACTIVE', userStatus: 'ACTIVE', userRole: 'EMPLOYEE' } },
    async findJobServices(id) { calls.push(id); return [{ id, name: 'Owned service' }] } }
  const service = new StaffJobService({ repository })
  assert.equal((await service.filters({ userId: '10' })).data.services[0].id, '10')
  assert.equal((await service.filters({ userId: '20' })).data.services[0].id, '20')
  await assert.rejects(service.filters({ userId: '30' }), { status: 403 }); assert.deepEqual(calls, ['10', '20'])
})
for (const workers of [1, 2, 3]) test(`missing official policy blocks new start/finish for ${workers} observed workers, including concurrent retries`, async () => {
  let calls = 0
  const client = new OrderClient({ baseUrl: 'http://127.0.0.1:4203', token: 'unit-only-internal-token' }, { fetchImpl: async () => { calls++; throw Error('MUST_NOT_CALL_ORDER') } })
  const base = { id: 'unit-operation', bookingId: '80', assignmentId: '12', employeeId: '9', actorUserId: '100', observedWorkers: workers, requiredStaffCount: workers, canStart: true }
  const attempts = await Promise.allSettled(Array.from({ length: 6 }, (_, n) => client.applyAssignmentTransition({ ...base, fromStatus: n % 2 ? 'IN_PROGRESS' : 'ACCEPTED', toStatus: n % 2 ? 'DONE' : 'IN_PROGRESS' })))
  assert.equal(calls, 0)
  for (const r of attempts) { assert.equal(r.status, 'rejected'); assert.equal(r.reason.code, 'STAFFING_POLICY_REQUIRED'); assert.equal(r.reason.status, 409) }
})
test('existing start/finish receipts remain available for recovery without sending a new command', async () => {
  const operation = { id: 'prior-op', bookingId: '80', assignmentId: '12', employeeId: '9', actorUserId: '100', fromStatus: 'ACCEPTED', toStatus: 'IN_PROGRESS' }
  const calls = [], client = new OrderClient({ baseUrl: 'http://127.0.0.1:4203', token: 'unit-only-internal-token' }, { fetchImpl: async (url, init) => {
    calls.push(init.method); return Response.json({ operationId: 'prior-op', assignmentId: '12', bookingId: '80', assignmentStatus: 'IN_PROGRESS', occurredAt: '2026-11-09T01:00:00.000Z', booking: { id: '80', status: 'IN_PROGRESS', cancellationPending: false } })
  } })
  assert.equal((await client.getAssignmentTransition(operation)).assignmentStatus, 'IN_PROGRESS'); assert.deepEqual(calls, ['GET'])
})
