import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import { parseJobsQuery, parseJobFiltersResponse } from '../lib/server/jobs-contract.mjs'
import { createStaffJobsHttp } from '../lib/server/jobs-http.mjs'
import { AuthBffError } from '../lib/server/auth-core.mjs'
import { createStatusService } from '../lib/server/status-core.mjs'
import { jobDto } from '../../../../backend/staff-service/src/mapping.js'
const require = createRequire(import.meta.url), ts = require('typescript')
function model(name) {
  const file = new URL('../../../packages/ui/src/components/staff/' + name, import.meta.url), module = { exports: {} }
  vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText,
    { module, exports: module.exports, URLSearchParams }, { timeout: 2000 })
  return module.exports
}
const ui = model('staff-jobs-remote-model.ts'), team = model('staff-team-model.ts'), plain = v => JSON.parse(JSON.stringify(v))
test('BFF/browser retain combined date/service/status filters through URL/F5/back links', () => {
  const raw = 'from=2026-12-31&to=2027-01-01&serviceId=5&status=DONE&page=2&pageSize=2&sort=desc'
  const q = ui.parseStaffJobsQuery(raw), parsed = parseJobsQuery(new URLSearchParams(ui.staffJobsQueryString(q)))
  assert.equal(parsed.serviceId, '5'); assert.equal(parsed.from, '2026-12-31'); assert.equal(parsed.to, '2027-01-01')
  assert.equal(parsed.page, 2); assert.equal(parsed.sort, 'desc')
  const back = new URL(ui.staffJobDetailHref('12', q), 'http://localhost').searchParams.get('from')
  assert.deepEqual(plain(ui.parseStaffJobsQuery(back.split('?')[1])), plain(q))
})
test('invalid ranges, injection, duplicate service IDs and unsupported area/staff count never become filters', () => {
  for (const raw of ['from=2026-02-30&to=2026-03-01', 'from=2027-01-01&to=2026-12-31', 'from=2026-01-01', 'from=1970-01-01&to=1970-01-02',
    'serviceId=5&serviceId=6', 'serviceId=5%20OR%201=1', 'required_staff_count=3', 'area=60', 'employeeId=20']) {
    assert.throws(() => parseJobsQuery(new URLSearchParams(raw)), { status: 400 }); assert.equal(ui.parseStaffJobsQuery(raw), null)
  }
  assert.equal(ui.validStaffJobsDateRange('2028-02-29', '2028-03-01'), true)
  assert.equal(ui.validStaffJobsDateRange('2026-01-01', '2027-01-02'), false)
})
test('facets strip private fields and reject duplicate/unsupported capabilities in server and browser', () => {
  const value = { data: { services: [{ id: '5', name: 'Cleaning', private: 'MUST_NOT_LEAK' }], areaSupported: false, requiredStaffCountSupported: false } }
  assert.doesNotMatch(JSON.stringify(parseJobFiltersResponse(value)), /MUST_NOT_LEAK/)
  assert.deepEqual(plain(ui.parseStaffJobServiceOptions(value)), [{ id: '5', name: 'Cleaning' }])
  value.data.services.push(value.data.services[0]); assert.throws(() => parseJobFiltersResponse(value), { status: 502 }); assert.equal(ui.parseStaffJobServiceOptions(value), null)
})
function fixture() {
  const origin = 'http://localhost:3202', sid = Buffer.alloc(32, 1).toString('base64url'), calls = []
  const response = { data: { services: [{ id: '5', name: 'Cleaning' }], areaSupported: false, requiredStaffCountSupported: false } }
  const handle = createStaffJobsHttp({ configFactory: () => ({ appOrigin: origin, staffUrl: 'http://127.0.0.1:4215', cookieName: 'cleanhome_staff_session', jobsTimeoutMs: 200 }),
    authFactory: () => ({ async inspect(id) { if (id !== sid) throw new AuthBffError(401, 'SESSION_REQUIRED', 'Login'); return { user: { id: '10' } } }, async withAccessToken(id, run) { if (id !== sid) throw new AuthBffError(401, 'SESSION_REQUIRED', 'Login'); return run('server-only') }, async logout() {} }),
    fetchImpl: async (url, init) => { calls.push({ url, init }); return Response.json(response) } })
  const request = (path = '/api/staff/jobs/filters', headers = {}) => handle(new Request(origin + path, { headers: { cookie: 'cleanhome_staff_session=' + sid, 'X-Staff-Account-Id': '10', ...headers } }))
  return { request, calls }
}
test('facets use one fixed authenticated GET and never forward account/cookie to upstream', async () => {
  const f = fixture(); assert.equal((await f.request()).status, 200); assert.equal(f.calls.length, 1)
  assert.equal(f.calls[0].url.pathname, '/api/v1/staff/me/job-filters'); assert.equal(f.calls[0].init.method, 'GET')
  assert.equal(f.calls[0].init.headers.Authorization, 'Bearer server-only'); assert.equal(f.calls[0].init.headers.Cookie, undefined)
})
test('facets reject A/B mismatch, missing session and supplied identities before upstream reads', async () => {
  for (const [path, headers, expected] of [['/api/staff/jobs/filters?employeeId=20', {}, 400], ['/api/staff/jobs/filters', { 'X-Staff-Account-Id': '20' }, 409], ['/api/staff/jobs/filters', { cookie: '' }, 401]]) {
    const f = fixture(); assert.equal((await f.request(path, headers)).status, expected); assert.equal(f.calls.length, 0)
  }
})
test('unknown staffing policy never enables start/finish from observed 1/2/3/4-worker counts', () => {
  for (const count of [1, 2, 3, 4]) for (const action of ['IN_PROGRESS', 'DONE']) {
    assert.ok(team.staffTeamMutationBlockedReason(null, action))
    assert.ok(team.staffTeamMutationBlockedReason({ requiredStaffCount: null, counts: { assigned: count, accepted: count }, policy: { enforced: false } }, action))
  }
})
test('future approved policy blocks waiting/duplicate/inactive teams; own finish is not booking completion', () => {
  const value = { requiredStaffCount: 3, counts: { assigned: 3, accepted: 3 }, issues: { duplicateEmployees: false, inactiveMembers: false }, policy: { enforced: true, canStart: true, canCompleteBooking: false } }
  assert.equal(team.staffTeamMutationBlockedReason(value, 'IN_PROGRESS'), null)
  assert.equal(team.staffTeamMutationBlockedReason(value, 'DONE'), null)
  for (const changed of [{ ...value, counts: { assigned: 3, accepted: 2 } }, { ...value, issues: { duplicateEmployees: true } }, { ...value, issues: { inactiveMembers: true } }]) assert.ok(team.staffTeamMutationBlockedReason(changed, 'IN_PROGRESS'))
})

test('BFF rejects unsafe new start/finish before journal creation or PATCH; ownership is read first', async () => {
  for (const [status, target] of [['ACCEPTED', 'IN_PROGRESS'], ['IN_PROGRESS', 'DONE']]) {
    const calls = [], body = { data: jobDto({ id: '12', bookingId: '80', status, bookingStatus: 'IN_PROGRESS', assignedAt: null, checkInAt: null, checkOutAt: null, scheduledStart: null, scheduledEnd: null, addressSnapshot: {} }, [], true) }
    const service = createStatusService({ config: { staffUrl: 'http://127.0.0.1:4215', jobsTimeoutMs: 200, statusTimeoutMs: 200 },
      auth: { async inspect() { return { user: { id: '10' } } }, async withAccessToken(sid, run) { return run('server-only') } },
      store: { async list() { return [] }, async ensure() { throw Error('MUST_NOT_CREATE_JOURNAL') } },
      fetchImpl: async (url, init) => { calls.push(init.method); return Response.json(body) } })
    await assert.rejects(service.update('session', '12', target, 'unit-new-operation'), e => e.status === 409 && e.code === 'STAFFING_POLICY_REQUIRED' && e.outcome === 'not_sent')
    assert.deepEqual(calls, ['GET'])
  }
})
