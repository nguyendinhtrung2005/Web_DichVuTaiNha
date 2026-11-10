import test from 'node:test'
import assert from 'node:assert/strict'
import { staffTeamSummary } from '../src/team-summary.js'
import { StaffJobService } from '../src/job-service.js'
import { MysqlStaffRepository } from '../src/repository.js'
import { createApp } from '../src/app.js'

// Assignment/HTTP doubles only. No live MySQL, seed or business mutation.
const own = { bookingId: '80', assignmentId: '12', employeeId: '9' }
const row = (id = '12', employeeId = '9', status = 'ASSIGNED') => ({ id, bookingId: '80', employeeId, status, employeeStatus: 'ACTIVE', userStatus: 'ACTIVE', userRole: 'EMPLOYEE' })
const summary = rows => staffTeamSummary(rows, own)

test('single employee counts are real observations, never an inferred one-person requirement', () => {
  const team = summary([row()])
  assert.deepEqual(team.counts, { assigned: 1, accepted: 0, started: 0, completed: 0, cancelled: 0 })
  assert.equal(team.requiredStaffCount, null); assert.equal(team.packageName, null)
  assert.deepEqual(team.policy, { source: 'NOT_CONFIGURED', version: null, enforced: false, canStart: null, canCompleteBooking: null, blockingReason: 'TEAM_POLICY_UNCONFIRMED' })
})

test('two/three people and cumulative acceptance/start/completion count distinct employees', () => {
  assert.deepEqual(summary([row('12', '9', 'ACCEPTED'), row('13', '10')]).counts, { assigned: 2, accepted: 1, started: 0, completed: 0, cancelled: 0 })
  const ready = summary([row('12', '9', 'ACCEPTED'), row('13', '10', 'ACCEPTED'), row('14', '11', 'ACCEPTED')])
  assert.equal(ready.counts.accepted, 3); assert.equal(ready.policy.canStart, null)
  assert.deepEqual(summary([row('12', '9', 'DONE'), row('13', '10', 'IN_PROGRESS')]).counts, { assigned: 2, accepted: 2, started: 2, completed: 1, cancelled: 0 })
})

test('both DONE, undersized roster and cancelled B never manufacture completion permission', () => {
  for (const rows of [[row('12', '9', 'DONE'), row('13', '10', 'DONE')], [row('12', '9', 'DONE')], [row('12', '9', 'DONE'), row('13', '10', 'CANCELLED')]]) {
    const team = summary(rows)
    assert.equal(team.requiredStaffCount, null); assert.equal(team.policy.canCompleteBooking, null)
  }
  assert.deepEqual(summary([row('12', '9', 'DONE'), row('13', '10', 'CANCELLED')]).counts, { assigned: 1, accepted: 1, started: 1, completed: 1, cancelled: 1 })
})

test('duplicate employee assignments do not inflate people or hide conflicting states', () => {
  const rows = [row('12', '9', 'DONE'), row('14', '9'), row('13', '10', 'DONE')], before = JSON.stringify(rows)
  const team = summary(rows)
  assert.equal(team.issues.duplicateEmployees, true)
  assert.deepEqual(team.counts, { assigned: 2, accepted: 1, started: 1, completed: 1, cancelled: 0 })
  assert.equal(JSON.stringify(rows), before)
  assert.equal(summary([row(), row('14', '9', 'CANCELLED')]).issues.duplicateEmployees, false)
})

test('peer identity is never projected; only own assignment is exposed', () => {
  const team = summary([row(), { ...row('13', '10'), fullName: 'PRIVATE_PEER', phone: 'PRIVATE_PHONE', password: 'PRIVATE_PASSWORD' }])
  assert.deepEqual(team.members, [{ assignmentId: '12', displayName: null, status: 'ASSIGNED', isSelf: true }])
  assert.equal(team.memberVisibility, 'SELF_ONLY')
  assert.doesNotMatch(JSON.stringify(team), /PRIVATE_|employeeId|actorUserId|userId|password/)
})

test('inactive members are flagged and missing/invalid/truncated roster fails closed', () => {
  assert.equal(summary([row(), { ...row('13', '10'), userStatus: 'LOCKED' }]).issues.inactiveMembers, true)
  for (const rows of [[], [row('13', '10')], [row(), row()], [row(), { ...row('13', '10'), bookingId: '81' }], [row(), row('13', '10', 'NO_SHOW')], Array.from({ length: 501 }, (_, n) => row(String(100 + n), String(200 + n)))]) {
    assert.throws(() => summary(rows), { code: 'TEAM_DATA_UNAVAILABLE' })
  }
})

test('team SQL rechecks own employee/assignment/booking together and has no writes or peer personal fields', async () => {
  const log = [], repository = new MysqlStaffRepository({ async getConnection() { return {
    async query(sql) { log.push({ sql }); return [[]] },
    async execute(sql, values) { log.push({ sql, values }); return [[{ ...row(), id: 12, bookingId: 80, employeeId: 9 }]] }, release() {},
  } } })
  assert.equal((await repository.findTeamRoster('9', '12', '80'))[0].employeeId, '9')
  const query = log.find(item => item.values)
  assert.deepEqual(query.values, ['80', '12', '9'])
  assert.match(query.sql, /owned\.id = \? AND owned\.employee_id = \? AND owned\.booking_id = a\.booking_id/)
  assert.match(query.sql, /ORDER BY a\.id LIMIT 501/)
  assert.doesNotMatch(query.sql, /full_name|phone|password|address|INSERT|UPDATE|DELETE|SELECT\s+\*/i)
})

function fixture() {
  const rows = [row(), row('13', '10')], calls = []
  const repository = {
    async findEmployeeByUserId(userId) { return { id: userId === '100' ? '9' : '10', status: 'ACTIVE', userStatus: 'ACTIVE', userRole: 'EMPLOYEE' } },
    async findJob(employeeId, assignmentId) { const value = rows.find(r => r.id === assignmentId && r.employeeId === employeeId); return value ? { ...value, bookingStatus: 'CONFIRMED', checkInAt: null, checkOutAt: null, scheduledStart: null, scheduledEnd: null, assignedAt: null } : null },
    async getBookingItems() { return new Map() },
    async findTeamRoster(employeeId, assignmentId, bookingId) { calls.push([employeeId, assignmentId, bookingId]); return rows },
    async assertSchema() {},
  }
  return { repository, calls, service: new StaffJobService({ repository }) }
}

test('ownership is checked before team lookup; errors preserve core job without fabricated zeros', async () => {
  const f = fixture()
  await assert.rejects(f.service.detail({ userId: '200' }, '12'), { status: 404 }); assert.equal(f.calls.length, 0)
  assert.equal((await f.service.detail({ userId: '100' }, '12')).data.team.counts.assigned, 2)
  assert.deepEqual(f.calls, [['9', '12', '80']])
  f.repository.findTeamRoster = async () => { throw Error('PRIVATE_DATABASE_ERROR') }
  const result = await f.service.detail({ userId: '100' }, '12')
  assert.equal(result.data.assignmentId, '12'); assert.equal(result.data.team, null); assert.equal(result.data.teamError, 'TEAM_READ_UNAVAILABLE')
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_DATABASE_ERROR/)
})

test('concurrent roster reads degrade only team while preserving the authorized assignment and booking snapshot', async () => {
  for (const [detailStatus, rosterStatus] of [['ASSIGNED', 'ACCEPTED'], ['ACCEPTED', 'IN_PROGRESS'], ['IN_PROGRESS', 'DONE']]) {
    const f = fixture(), findJob = f.repository.findJob
    f.repository.findJob = async (...args) => ({ ...await findJob(...args), status: detailStatus })
    f.repository.findTeamRoster = async () => [row('12', '9', rosterStatus), row('13', '10')]
    const result = await f.service.detail({ userId: '100' }, '12')
    assert.equal(result.data.databaseStatus, detailStatus)
    assert.equal(result.data.orderId, '80'); assert.equal(result.data.orderStatus, 'confirmed')
    assert.equal(result.data.team, null); assert.equal(result.data.teamError, 'TEAM_READ_UNAVAILABLE')
    assert.doesNotMatch(JSON.stringify(result), /TEAM_SNAPSHOT_MISMATCH|employeeId|userId/)
  }
})

test('HTTP A/B can see their team counts and own membership, never the other employee assignment detail', async t => {
  const f = fixture(), app = createApp({ service: f.service, repository: f.repository, authenticate(req, res, next) { req.actor = { userId: req.get('X-Unit-Account') === 'B' ? '200' : '100' }; next() } })
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); t.after(() => new Promise(resolve => server.close(resolve)))
  const base = 'http://127.0.0.1:' + server.address().port + '/api/v1/staff/me/jobs/'
  for (const [actor, id, other] of [['A', '12', '13'], ['B', '13', '12']]) {
    const response = await fetch(base + id, { headers: { 'X-Unit-Account': actor } }), body = await response.json()
    assert.equal(response.status, 200); assert.equal(body.data.team.counts.assigned, 2)
    assert.deepEqual(body.data.team.members.map(member => member.assignmentId), [id])
    assert.equal((await fetch(base + other, { headers: { 'X-Unit-Account': actor } })).status, 404)
  }
})
