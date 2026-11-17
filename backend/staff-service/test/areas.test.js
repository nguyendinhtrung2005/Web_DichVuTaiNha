import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { MysqlStaffRepository } from '../src/repository.js'
import { StaffAreaService } from '../src/area-service.js'
import { availabilityQuery } from '../src/validation.js'
import { availabilityDto, branchDto } from '../src/mapping.js'

// SQL contract doubles: binding/boundary checks only, not a live MySQL run.
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
  return { repository: new MysqlStaffRepository({ async getConnection() { return connection } }), log }
}
const employee = { id: '10', userId: '100', branchId: '20', status: 'ACTIVE', userStatus: 'ACTIVE', userRole: 'EMPLOYEE' }
const actor = Object.freeze({ userId: '100', role: 'staff' })
const branchRow = { id: '20', name: 'Chi nhánh Quận 1', addressText: '12 Lê Lợi, Quận 1', serviceArea: { districts: ['Quận 1', 'Quận 3'] }, latitude: '10.7769000', longitude: '106.7009000', status: 'ACTIVE' }
const availabilityRow = { id: '31', startsAt: '2026-11-04 01:00:00', endsAt: '2026-11-04 05:00:00', status: 'AVAILABLE' }

test('employee lookup carries the branch id used by the area endpoints', async () => {
  const f = fixture([[{ id: '10', userId: '100', branchId: '20', status: 'ACTIVE', userRole: 'EMPLOYEE', userStatus: 'ACTIVE' }]])
  const result = await f.repository.findEmployeeByUserId('100')
  assert.equal(result.branchId, '20')
  const command = f.log.find(item => item.kind === 'execute')
  assert.match(command.sql, /e\.branch_id AS branchId/)
  assert.doesNotMatch(command.sql, /password|SELECT\s+\*/i)
})

test('branch lookup is scoped by the branch id from the employee record', async () => {
  const f = fixture([[branchRow]])
  const result = await f.repository.findBranch('20')
  assert.equal(result.id, '20'); assert.equal(result.latitude, '10.7769000')
  const command = f.log.find(item => item.kind === 'execute')
  assert.deepEqual(command.values, ['20'])
  assert.match(command.sql, /FROM branches WHERE id = \? LIMIT 1/)
  assert.match(command.sql, /service_area AS serviceArea/)
  assert.doesNotMatch(command.sql, /SELECT\s+\*/i)
})

test('availability lookup binds the employee id and the UTC overlap window with a hard row cap', async () => {
  const f = fixture([[availabilityRow]])
  const rows = await f.repository.findAvailability('10', { fromUtc: '2026-11-04 00:00:00.000', toUtc: '2026-11-11 00:00:00.000' })
  assert.equal(rows[0].id, '31')
  const command = f.log.find(item => item.kind === 'execute')
  assert.deepEqual(command.values, ['10', '2026-11-04 00:00:00.000', '2026-11-11 00:00:00.000'])
  assert.match(command.sql, /employee_id = \? AND ends_at > \? AND starts_at < \?/)
  assert.match(command.sql, /ORDER BY starts_at, id LIMIT 501/)
})

test('service reads the signed-in employee branch and never accepts a branch or employee id', async () => {
  const calls = []
  const repository = {
    async findEmployeeByUserId(id) { calls.push(id); return employee },
    async findBranch(id) { calls.push(id); return branchRow },
    async findAvailability(id, range) { calls.push([id, range]); return [availabilityRow] },
  }
  const service = new StaffAreaService({ repository })
  const branch = await service.branch(actor)
  assert.equal(branch.data.name, 'Chi nhánh Quận 1')
  assert.deepEqual(branch.data.serviceArea, { districts: ['Quận 1', 'Quận 3'] })
  const availability = await service.availability(actor, { from: '2026-11-04', to: '2026-11-10', fromUtc: '2026-11-03 17:00:00.000', toUtc: '2026-11-10 17:00:00.000' })
  assert.equal(availability.data[0].startsAt, '2026-11-04T01:00:00.000Z')
  assert.equal(availability.branchId, '20')
  assert.equal(availability.truncated, false)
  assert.deepEqual(availability.range, { from: '2026-11-04', to: '2026-11-10', timezone: 'Asia/Ho_Chi_Minh' })
  assert.deepEqual(calls, ['100', '20', '100', ['10', { from: '2026-11-04', to: '2026-11-10', fromUtc: '2026-11-03 17:00:00.000', toUtc: '2026-11-10 17:00:00.000' }]])
})

test('service refuses inactive staff before reading any branch or availability', async () => {
  for (const state of [{ ...employee, status: 'SUSPENDED' }, { ...employee, userStatus: 'LOCKED' }, { ...employee, userRole: 'CUSTOMER' }, null]) {
    const repository = {
      async findEmployeeByUserId() { return state },
      async findBranch() { throw new Error('must not read a branch') },
      async findAvailability() { throw new Error('must not read availability') },
    }
    const service = new StaffAreaService({ repository })
    await assert.rejects(service.branch(actor), { status: 403, code: 'STAFF_INACTIVE' })
    await assert.rejects(service.availability(actor, { from: '2026-11-04', to: '2026-11-10' }), { status: 403, code: 'STAFF_INACTIVE' })
  }
})

test('a missing branch is reported as 404 instead of an empty area page', async () => {
  const service = new StaffAreaService({ repository: { async findEmployeeByUserId() { return employee }, async findBranch() { return null } } })
  await assert.rejects(service.branch(actor), { status: 404, code: 'BRANCH_NOT_FOUND' })
})

test('availability is capped at 500 rows and flagged as truncated', async () => {
  const rows = Array.from({ length: 501 }, (_, index) => ({ ...availabilityRow, id: String(index + 1) }))
  const service = new StaffAreaService({ repository: { async findEmployeeByUserId() { return employee }, async findAvailability() { return rows } } })
  const result = await service.availability(actor, { from: '2026-11-04', to: '2026-11-10' })
  assert.equal(result.data.length, 500); assert.equal(result.truncated, true)
})

test('availability query requires a bounded Vietnam calendar range and rejects impersonation', () => {
  assert.deepEqual(availabilityQuery({ from: '2026-11-04', to: '2026-11-10' }), {
    from: '2026-11-04', to: '2026-11-10', fromUtc: '2026-11-03 17:00:00.000', toUtc: '2026-11-10 17:00:00.000',
  })
  for (const query of [{}, { from: '2026-11-04' }, { to: '2026-11-10' }, { from: '2026-11-10', to: '2026-11-04' }, { from: '2026-11-01', to: '2027-01-03' }, { from: '2026-11-04', to: '2026-11-10', employeeId: '11' }, { from: '2026-02-30', to: '2026-03-02' }, { from: ['2026-11-04'], to: '2026-11-10' }]) {
    assert.throws(() => availabilityQuery(query), error => error.status === 400, JSON.stringify(query))
  }
})

test('branch and availability DTOs keep stored values without inventing area semantics', () => {
  assert.deepEqual(branchDto(branchRow), branchRow)
  assert.deepEqual(availabilityDto(availabilityRow), { id: '31', startsAt: '2026-11-04T01:00:00.000Z', endsAt: '2026-11-04T05:00:00.000Z', status: 'AVAILABLE' })
  // Unstructured JSON is passed through untouched; no district/shift policy is inferred.
  assert.deepEqual(branchDto({ ...branchRow, serviceArea: '{"raw":true}' }).serviceArea, { raw: true })
  assert.deepEqual(branchDto({ ...branchRow, serviceArea: null }).serviceArea, {})
})

test('area reads never write, never touch income tables and never select credentials', async () => {
  const source = await readFile(new URL('../src/area-service.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /INSERT|UPDATE|DELETE|revenue_shares|payments|salary/i)
  const repository = await readFile(new URL('../src/repository.js', import.meta.url), 'utf8')
  assert.doesNotMatch(repository, /(?:DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE)/i)
  assert.match(repository, /Only assignments is ever updated/)
})
