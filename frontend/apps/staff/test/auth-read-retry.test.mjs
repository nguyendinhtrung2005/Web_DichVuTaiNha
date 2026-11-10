import test from 'node:test'
import assert from 'node:assert/strict'
import { createStaffJobsHttp } from '../lib/server/jobs-http.mjs'
import { createStaffJobDetailHttp } from '../lib/server/job-detail-http.mjs'
import { createStaffScheduleHttp } from '../lib/server/schedule-http.mjs'
import { createStaffAreasHttp } from '../lib/server/areas-http.mjs'
import { createStaffIncomeHttp } from '../lib/server/income-http.mjs'
import { createStaffReviewsHttp } from '../lib/server/reviews-http.mjs'
import { createStaffNotificationsHttp } from '../lib/server/notifications-http.mjs'
import { createStatusService } from '../lib/server/status-core.mjs'

// Adapter wiring only: the Auth capability is a double, never a real user session.
const origin = 'http://localhost:3202', config = { appOrigin: origin, cookieName: 'cleanhome_staff_session' }
const sid = Buffer.alloc(32, 1).toString('base64url')
function dependencies(calls) {
  return { configFactory: () => config, authFactory: () => ({ async inspect() { return { user: { id: '100' } } },
    async withAccessToken(id, operation, options) { assert.equal(id, sid); calls.push(options); return { unit: true } } }),
    fetchImpl() { throw Error('This wiring test must not call an upstream') } }
}
test('fixed Staff GET adapters opt in to a single proven-expired-token retry', async () => {
  for (const [factory, path] of [[createStaffJobsHttp, '/api/staff/jobs'], [createStaffJobDetailHttp, '/api/staff/jobs/12'],
    [createStaffScheduleHttp, '/api/staff/schedule?from=2026-11-09&to=2026-11-15'], [createStaffAreasHttp, '/api/staff/branch'],
    [createStaffIncomeHttp, '/api/staff/income/estimate?month=2026-11'], [createStaffReviewsHttp, '/api/staff/reviews?from=2026-11-09&to=2026-11-15'],
    [createStaffNotificationsHttp, '/api/staff/notifications']]) {
    const calls = [], response = await factory(dependencies(calls))(new Request(origin + path, { headers: { Cookie: 'cleanhome_staff_session=' + sid } }))
    assert.equal(response.status, 200, path); assert.deepEqual(calls, [{ retryOnExpiredToken: true }], path)
  }
})
test('notification writes do not acquire retry permission from their shared GET handler', async () => {
  for (const path of ['/api/staff/notifications/1/read', '/api/staff/notifications/read-all']) {
    const calls = [], response = await createStaffNotificationsHttp(dependencies(calls))(new Request(origin + path, { method: 'PATCH', headers: { Origin: origin, Cookie: 'cleanhome_staff_session=' + sid } }))
    assert.equal(response.status, 200); assert.deepEqual(calls, [{ retryOnExpiredToken: false }])
  }
})
test('status inspection can retry an expired read but a status mutation cannot', async () => {
  const calls = [], d = dependencies(calls), service = createStatusService({ config, auth: d.authFactory(), store: {}, fetchImpl: d.fetchImpl })
  await service.read(sid, '12'); assert.deepEqual(calls, [{ retryOnExpiredToken: true }])
  await service.update(sid, '12', 'ACCEPTED', 'unit-operation-key'); assert.equal(calls.length, 2); assert.equal(calls[1], undefined)
})
