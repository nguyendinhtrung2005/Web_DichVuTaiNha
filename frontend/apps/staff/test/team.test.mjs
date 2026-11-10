import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { parseStaffTeam } from '../../../packages/ui/src/components/staff/staff-team-contract.mjs'
import { parseJobDetailResponse } from '../lib/server/job-detail-contract.mjs'
import { StaffJobService } from '../../../../backend/staff-service/src/job-service.js'

// Future Order policies below are explicit UNIT FIXTURES, never deployment configuration.
const require = createRequire(import.meta.url), React = require('react'), ts = require('typescript'), { renderToStaticMarkup } = require('react-dom/server')
const root = new URL('../../../packages/ui/src/components/staff/', import.meta.url), cache = new Map()
function source(name) {
  if (cache.has(name)) return cache.get(name)
  const module = { exports: {} }, code = ts.transpileModule(readFileSync(new URL(name, root), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText
  vm.runInNewContext(code, { module, exports: module.exports, URL, URLSearchParams, require(id) {
    if (id === './staff-team-model') return source('staff-team-model.ts')
    if (id === './staff-team-contract.mjs') return source('staff-team-contract.mjs')
    if (id === './staff-jobs-remote-model') return source('staff-jobs-remote-model.ts')
    if (id === '@/components/ui/button') return { Button: ({ variant, ...props }) => React.createElement('button', props) }
    if (id === '@/components/shared/area-routes') return { AreaLink: props => React.createElement('a', props) }
    return require(id)
  } }, { timeout: 2000 })
  cache.set(name, module.exports); return module.exports
}
const { staffTeamPresentation, staffTeamProgress } = source('staff-team-model.ts'), { StaffJobTeam } = source('staff-job-team.tsx')
const plain = value => JSON.parse(JSON.stringify(value))
function team() {
  return { version: 1, bookingId: '80', assignmentId: '12', requiredStaffCount: null, packageName: null,
    counts: { assigned: 2, accepted: 1, started: 0, completed: 0, cancelled: 0 }, issues: { duplicateEmployees: false, inactiveMembers: false },
    memberVisibility: 'SELF_ONLY', members: [{ assignmentId: '12', displayName: null, status: 'ACCEPTED', isSelf: true }],
    policy: { source: 'NOT_CONFIGURED', version: null, enforced: false, canStart: null, canCompleteBooking: null, blockingReason: 'TEAM_POLICY_UNCONFIRMED' } }
}
function approved(required = 2, overrides = {}) {
  const value = team(); value.requiredStaffCount = required; value.packageName = 'UNIT PACKAGE'
  value.counts.assigned = required; value.counts.accepted = required
  value.policy = { source: 'order-service', version: 'UNIT-ONLY-v1', enforced: true, canStart: true, canCompleteBooking: false, blockingReason: null }
  return Object.assign(value, overrides)
}
function detail(value) {
  return { data: { id: '12', assignmentId: '12', orderId: '80', jobCode: null, orderCode: null, status: 'ACCEPTED', databaseStatus: 'ACCEPTED', jobStatus: 'accepted', orderStatus: 'confirmed',
    scheduledAt: null, expectedEndAt: null, durationMinutes: null, contact: { name: null, address: null, phone: null, houseType: null, area: null, rooms: null, floors: null, hasPets: null },
    services: [], checkInAt: null, checkOutAt: null, assignedAt: null, specialRequest: null, cancellationPending: null, orderHistory: null, historySource: 'order-service-not-loaded',
    unsupportedFields: ['jobCode', 'orderCode', 'houseType', 'area', 'rooms', 'floors', 'hasPets', 'specialRequest', 'cancellationPending'], ...(value === undefined ? {} : { team: value }) } }
}
const render = (value, props = {}) => renderToStaticMarkup(React.createElement(StaffJobTeam, { team: value, personalStatus: 'ACCEPTED', bookingStatus: 'confirmed', onRetry() {}, ...props }))

// Independent reads model a concurrent update without mutating MySQL or invoking the FSM.
function snapshotFixture() {
  const state = { detailStatus: 'ACCEPTED', rosterStatus: 'ACCEPTED' }, calls = []
  const repository = {
    async findEmployeeByUserId(userId) { return { id: userId === '100' ? '9' : '10', status: 'ACTIVE', userStatus: 'ACTIVE', userRole: 'EMPLOYEE' } },
    async findJob(employeeId, assignmentId) {
      calls.push('detail')
      if (assignmentId !== (employeeId === '9' ? '12' : '13')) return null
      return { id: assignmentId, employeeId, bookingId: '80', status: state.detailStatus, bookingStatus: 'CONFIRMED' }
    },
    async getBookingItems() { return new Map() },
    async findTeamRoster() {
      calls.push('roster')
      return [['12', '9'], ['13', '10']].map(([id, employeeId]) => ({ id, employeeId, bookingId: '80', status: state.rosterStatus,
        employeeStatus: 'ACTIVE', userStatus: 'ACTIVE', userRole: 'EMPLOYEE', fullName: 'UNIT_PRIVATE_PEER', phone: 'UNIT_PRIVATE_PHONE' }))
    },
  }
  const service = new StaffJobService({ repository })
  const read = async (userId = '100', assignmentId = '12') => {
    const response = await service.detail({ userId }, assignmentId)
    const bff = parseJobDetailResponse(response, assignmentId)
    return { response, bff, browser: source('staff-job-detail-remote-model.ts').parseStaffJobDetailPayload(bff, assignmentId) }
  }
  return { state, calls, repository, read }
}

test('snapshot regression: matching assignment and roster survive service, BFF and browser validation', async () => {
  const f = snapshotFixture(), result = await f.read()
  assert.deepEqual(f.calls, ['detail', 'roster'])
  assert.equal(result.browser.databaseStatus, 'ACCEPTED')
  assert.equal(result.browser.team.members[0].status, 'ACCEPTED')
  assert.equal(result.browser.team.counts.accepted, 2)
  assert.equal(result.bff.data.teamError, undefined)
  assert.doesNotMatch(JSON.stringify(result), /UNIT_PRIVATE_|employeeId|userId/)
})

test('snapshot regression: ACCEPTED detail with later IN_PROGRESS roster preserves detail and exposes a retryable team error', async () => {
  const f = snapshotFixture(); f.state.rosterStatus = 'IN_PROGRESS'
  const result = await f.read()
  assert.deepEqual(f.calls, ['detail', 'roster'])
  assert.equal(result.response.data.databaseStatus, 'ACCEPTED')
  assert.equal(result.browser.databaseStatus, 'ACCEPTED')
  assert.equal(result.browser.assignmentId, '12'); assert.equal(result.browser.orderStatus, 'confirmed')
  assert.equal(result.bff.data.team, null); assert.equal(result.browser.team, null)
  assert.equal(result.browser.teamError, 'TEAM_READ_UNAVAILABLE')
  const html = render(result.browser.team, { teamError: result.browser.teamError })
  assert.match(html, /role="alert"/); assert.match(html, /Thử tải đội lại/); assert.doesNotMatch(html, /<progress/)
  assert.doesNotMatch(JSON.stringify(result), /UNIT_PRIVATE_|employeeId|userId/)
})

test('snapshot regression: retry and a fresh page read recover the real roster without changing assignment or booking', async () => {
  const f = snapshotFixture(); f.state.rosterStatus = 'IN_PROGRESS'
  assert.equal((await f.read()).browser.teamError, 'TEAM_READ_UNAVAILABLE')
  // Simulate the next SELECT observing the already committed assignment; the service performs no write.
  f.state.detailStatus = 'IN_PROGRESS'
  for (const _ of ['retry', 'fresh-page-read']) {
    const result = await f.read()
    assert.equal(result.browser.databaseStatus, 'IN_PROGRESS')
    assert.equal(result.browser.team.members[0].status, 'IN_PROGRESS')
    assert.equal(result.browser.teamError, undefined); assert.equal(result.browser.orderStatus, 'confirmed')
  }
})

test('snapshot regression: unavailable, malformed, wrong-booking and wrong-owner rosters never expose untrusted team data', async () => {
  const corruptions = [
    async () => { throw Error('UNIT_PRIVATE_DATABASE_ERROR') }, async () => null, async () => [],
    async () => [{ id: '12', employeeId: '9', bookingId: '81', status: 'IN_PROGRESS' }],
    async () => [{ id: '12', employeeId: '10', bookingId: '80', status: 'IN_PROGRESS' }],
    async () => [{ id: '12', employeeId: '9', bookingId: '80', status: 'INVALID' }],
  ]
  for (const findTeamRoster of corruptions) {
    const f = snapshotFixture(); f.repository.findTeamRoster = findTeamRoster
    const result = await f.read()
    assert.equal(result.browser.assignmentId, '12'); assert.equal(result.browser.databaseStatus, 'ACCEPTED')
    assert.equal(result.browser.team, null); assert.equal(result.browser.teamError, 'TEAM_READ_UNAVAILABLE')
    assert.doesNotMatch(JSON.stringify(result), /UNIT_PRIVATE_|employeeId|userId/)
  }
})

test('snapshot regression: a team fallback cannot make genuinely invalid assignment details valid', async () => {
  for (const invalidDetail of [{ status: 'INVALID' }, { bookingId: 'invalid' }, { id: '13' }]) {
    const f = snapshotFixture(), findJob = f.repository.findJob
    f.repository.findJob = async (...args) => ({ ...await findJob(...args), ...invalidDetail })
    f.repository.findTeamRoster = async () => { throw Error('UNIT_PRIVATE_DATABASE_ERROR') }
    await assert.rejects(f.read(), { status: 502, code: 'STAFF_INVALID_RESPONSE' })
  }
})

test('snapshot regression: BFF and browser still reject raw untrusted or mismatched rosters', () => {
  for (const corrupt of [
    value => { value.bookingId = '81' }, value => { value.assignmentId = '13' },
    value => { value.members[0].assignmentId = '13' }, value => { value.members[0].isSelf = false },
    value => { value.counts.assigned = -1 }, value => { value.members[0].status = 'IN_PROGRESS'; value.counts.started = 1 },
  ]) {
    const value = detail(team()); corrupt(value.data.team)
    assert.throws(() => parseJobDetailResponse(value, '12'), { status: 502, code: 'STAFF_INVALID_RESPONSE' })
    assert.equal(source('staff-job-detail-remote-model.ts').parseStaffJobDetailPayload(value, '12'), null)
  }
})

test('snapshot regression: A/B isolation survives degraded and recovered roster reads', async () => {
  const f = snapshotFixture(); f.state.rosterStatus = 'IN_PROGRESS'
  for (const [userId, ownId, otherId] of [['100', '12', '13'], ['200', '13', '12']]) {
    assert.equal((await f.read(userId, ownId)).browser.team, null)
    const reads = f.calls.length
    await assert.rejects(f.read(userId, otherId), { status: 404, code: 'JOB_NOT_FOUND' })
    assert.deepEqual(f.calls.slice(reads), ['detail'])
  }
  f.state.detailStatus = 'IN_PROGRESS'
  for (const [userId, ownId] of [['100', '12'], ['200', '13']]) {
    const result = await f.read(userId, ownId)
    assert.deepEqual(plain(result.browser.team.members.map(member => member.assignmentId)), [ownId])
    assert.doesNotMatch(JSON.stringify(result), /UNIT_PRIVATE_|employeeId|userId/)
  }
})

test('team contract preserves genuine counts and unknown requirement, stripping unrelated private fields', () => {
  const value = team(); value.apiKey = 'UNIT_PRIVATE'; value.members[0].phone = 'UNIT_PRIVATE'; value.counts.private = 'UNIT_PRIVATE'
  const before = JSON.stringify(value), parsed = parseStaffTeam(value, '12', '80')
  assert.equal(parsed.requiredStaffCount, null); assert.equal(parsed.policy.canStart, null)
  assert.equal(parsed.counts.assigned, 2); assert.doesNotMatch(JSON.stringify(parsed), /UNIT_PRIVATE|phone|apiKey/)
  assert.equal(JSON.stringify(value), before)
})

test('team contract checks assignment/booking bindings and rejects unapproved peer identities', () => {
  assert.equal(parseStaffTeam(team(), '13', '80'), null); assert.equal(parseStaffTeam(team(), '12', '81'), null)
  const other = team(); other.members.push({ assignmentId: '13', status: 'ASSIGNED', displayName: 'PRIVATE_PEER', isSelf: false })
  assert.equal(parseStaffTeam(other, '12', '80'), null)
  const approvedRoster = approved(); approvedRoster.memberVisibility = 'APPROVED_ROSTER'; approvedRoster.members.push({ assignmentId: '13', status: 'ACCEPTED', displayName: 'UNIT PERMITTED NAME', isSelf: false })
  assert.equal(parseStaffTeam(approvedRoster, '12', '80').members.length, 2)
  approvedRoster.members[1].isSelf = true; assert.equal(parseStaffTeam(approvedRoster, '12', '80'), null)
})

test('readiness requires explicit Order enforcement; counts, public flags and null legacy requirements cannot enable it', () => {
  for (const required of [1, 2, 3, 4]) assert.equal(parseStaffTeam(approved(required), '12', '80').requiredStaffCount, required)
  for (const mutate of [v => { v.requiredStaffCount = 2 }, v => { v.policy.canStart = true }, v => { v.policy.enforced = true }, v => { v.policy.source = 'browser' }]) {
    const value = team(); mutate(value); assert.equal(parseStaffTeam(value, '12', '80'), null)
  }
  const value = approved(); value.requiredStaffCount = null; assert.equal(parseStaffTeam(value, '12', '80'), null)
})

test('team contract rejects inconsistent counts and false readiness/completion claims', () => {
  for (const mutate of [v => { v.counts.assigned = 1 }, v => { v.counts.accepted = 1 }, v => { v.issues.duplicateEmployees = true }, v => { v.issues.inactiveMembers = true }, v => { v.policy.blockingReason = 'WAITING_ACCEPTANCE' }]) {
    const value = approved(); mutate(value); assert.equal(parseStaffTeam(value, '12', '80'), null)
  }
  const completion = approved(); completion.policy.canStart = false; completion.policy.canCompleteBooking = true
  assert.equal(parseStaffTeam(completion, '12', '80'), null)
  const impossibleOwn = team(); impossibleOwn.counts.accepted = 0; assert.equal(parseStaffTeam(impossibleOwn, '12', '80'), null)
  for (const key of ['assigned', 'accepted', 'started', 'completed', 'cancelled']) for (const invalid of [-1, 1.5, '1', 501]) { const value = team(); value.counts[key] = invalid; assert.equal(parseStaffTeam(value, '12', '80'), null) }
})

test('future four-person contract uses required count, never the smaller minimum or current roster size', () => {
  // UNIT fixture only: Order's policy/transaction API is not deployed on QA.
  const value = approved(4); value.minimumStaffCount = 2
  assert.equal(parseStaffTeam(value, '12', '80').requiredStaffCount, 4)
  const waiting = approved(4); waiting.counts.accepted = 3; waiting.policy.canStart = false; waiting.policy.blockingReason = 'WAITING_ACCEPTANCE'
  assert.equal(parseStaffTeam(waiting, '12', '80').policy.canStart, false)
  assert.match(render(waiting), /3\/4 nhân viên đã tiếp nhận/)
  Object.assign(value.counts, { started: 4, completed: 3 }); value.members[0].status = 'DONE'
  assert.equal(staffTeamPresentation(value, 'DONE', 'in_progress').code, 'my-work-done')
  value.policy.canCompleteBooking = true
  assert.equal(parseStaffTeam(value, '12', '80'), null)
  value.counts.completed = 4
  assert.equal(parseStaffTeam(value, '12', '80').policy.canCompleteBooking, true)
  assert.notEqual(staffTeamPresentation(value, 'DONE', 'in_progress').code, 'completed')
  assert.equal(staffTeamPresentation(value, 'DONE', 'completed').code, 'completed')
})

test('BFF and browser detail parsers preserve the same safe team DTO and old payloads remain compatible', () => {
  const value = detail(team()), bff = parseJobDetailResponse(value, '12'), browser = source('staff-job-detail-remote-model.ts').parseStaffJobDetailPayload(bff, '12')
  assert.deepEqual(plain(browser.team), team()); assert.deepEqual(bff.data.team, team())
  assert.deepEqual(parseJobDetailResponse(detail(), '12'), detail())
  const invalid = detail(team()); invalid.data.team.bookingId = '81'; assert.throws(() => parseJobDetailResponse(invalid, '12'), { code: 'STAFF_INVALID_RESPONSE' })
  const wrongState = detail(team()); wrongState.data.team.members[0].status = 'DONE'; assert.throws(() => parseJobDetailResponse(wrongState, '12'), { code: 'STAFF_INVALID_RESPONSE' })
})

test('future policy fixtures distinguish waiting, ready, understaffed and replacement states', () => {
  const waiting = approved(); waiting.counts.accepted = 1; waiting.policy.canStart = false; waiting.policy.blockingReason = 'WAITING_ACCEPTANCE'
  assert.equal(staffTeamPresentation(waiting, 'ACCEPTED', 'confirmed').code, 'waiting-acceptance')
  assert.match(render(waiting), /1\/2 nhân viên đã tiếp nhận/)
  assert.ok(staffTeamPresentation(waiting, 'ACCEPTED', 'confirmed').startBlockedReason)
  assert.equal(staffTeamPresentation(approved(1), 'ACCEPTED', 'confirmed').code, 'ready')
  assert.equal(staffTeamPresentation(approved(3), 'ACCEPTED', 'confirmed').code, 'ready')
  const missing = approved(); missing.counts.assigned = 1; missing.counts.accepted = 1; missing.policy.canStart = false; missing.policy.blockingReason = 'INSUFFICIENT_STAFF'
  assert.equal(staffTeamPresentation(missing, 'ACCEPTED', 'confirmed').code, 'understaffed')
  missing.policy.blockingReason = 'REPLACEMENT_REQUIRED'; assert.equal(staffTeamPresentation(missing, 'ACCEPTED', 'confirmed').code, 'admin-required')
})

test('A DONE/B pending never displays whole-booking completion; both DONE still waits for actual booking state', () => {
  const value = team(); Object.assign(value.counts, { accepted: 2, started: 2, completed: 1 })
  assert.match(render(value, { personalStatus: 'DONE', bookingStatus: 'in_progress' }), /Bạn đã hoàn thành phần việc/)
  assert.match(render(value, { personalStatus: 'DONE', bookingStatus: 'in_progress' }), /Bạn đã hoàn thành phần việc được giao\. Đơn dịch vụ vẫn đang chờ các thành viên còn lại\./)
  assert.doesNotMatch(render(value, { personalStatus: 'DONE', bookingStatus: 'in_progress' }), /Đơn đã được xác nhận hoàn thành/)
  value.counts.completed = 2
  assert.notEqual(staffTeamPresentation(value, 'DONE', 'in_progress').code, 'completed')
  assert.equal(staffTeamPresentation(value, 'DONE', 'completed').code, 'completed')
  const inconsistent = approved(); inconsistent.counts.started = 1; inconsistent.counts.completed = 1
  assert.equal(staffTeamPresentation(inconsistent, 'DONE', 'completed').code, 'admin-required')
})

test('frontend team projection distinguishes currently working from the cumulative started count', () => {
  const value = team(); Object.assign(value.counts, { assigned: 3, accepted: 3, started: 3, completed: 1 })
  const projection = staffTeamProgress(value, 'IN_PROGRESS', 'in_progress')
  assert.deepEqual(plain(projection), { requiredStaffCount: null, assignedCount: 3, acceptedCount: 3, inProgressCount: 2, completedCount: 1, teamStatus: 'in-progress' })
  assert.equal(value.policy.enforced, false); assert.equal(value.policy.canStart, null)
  const html = render(value, { personalStatus: 'IN_PROGRESS', bookingStatus: 'in_progress', bookingId: '80', services: ['UNIT SERVICE'] })
  assert.match(html, /Đơn dịch vụ <strong>#80/); assert.match(html, /UNIT SERVICE/); assert.match(html, /data-team-in-progress="2"/)
  assert.match(html, /Chưa có thông tin số nhân viên yêu cầu/); assert.doesNotMatch(html, /Đủ đội/)
  assert.deepEqual(plain(staffTeamProgress(null)), { requiredStaffCount: null, assignedCount: null, acceptedCount: null, inProgressCount: null, completedCount: null, teamStatus: 'unconfirmed' })
})

test('cancelled bookings and waiting for booking acknowledgement never imply waiting for unfinished teammates', () => {
  const value = team(); Object.assign(value.counts, { accepted: 2, started: 2, completed: 2 })
  assert.equal(staffTeamPresentation(value, 'DONE', 'in_progress').code, 'awaiting-booking')
  assert.equal(staffTeamPresentation(value, 'DONE', 'cancelled').code, 'cancelled')
  const html = render(value, { personalStatus: 'DONE', bookingStatus: 'cancelled' })
  assert.doesNotMatch(html, /đang chờ các thành viên còn lại|Đơn đã được xác nhận hoàn thành/)
  value.counts.completed = 1
  assert.equal(staffTeamPresentation(value, 'DONE', 'confirmed').code, 'my-work-done')
})

test('missing requirement, cancelled/duplicate people and fallback never manufacture an official team size', () => {
  assert.match(render(null), /Chưa xác nhận yêu cầu nhân sự/); assert.doesNotMatch(render(null), /<progress|Đủ đội/)
  const value = team(); value.counts.cancelled = 1; value.issues.duplicateEmployees = true
  assert.equal(staffTeamPresentation(value, 'ACCEPTED', 'confirmed').code, 'admin-required')
  assert.match(render(value), /không tính là hoàn thành/); assert.doesNotMatch(render(value), /Đủ đội/)
})

test('team card has accessible progress and keyboard details, escapes permitted names, and retries a real read error', () => {
  const value = approved(); value.memberVisibility = 'APPROVED_ROSTER'; value.members.push({ assignmentId: '13', status: 'ACCEPTED', displayName: '<script>UNIT</script>', isSelf: false })
  const html = render(value)
  assert.match(html, /<label[^>]*for=/); assert.match(html, /<progress[^>]*max="2"[^>]*value="0"/); assert.match(html, /<summary>/)
  assert.match(html, /&lt;script&gt;UNIT&lt;\/script&gt;/); assert.doesNotMatch(html, /<script>/)
  assert.match(render(null, { teamError: 'TEAM_READ_UNAVAILABLE' }), /role="alert"/); assert.match(render(null, { teamError: 'TEAM_READ_UNAVAILABLE' }), /Thử tải đội lại/)
  assert.doesNotMatch(render(team()), /phân công thay|Từ chối|Báo vắng|Đủ đội/)
})
