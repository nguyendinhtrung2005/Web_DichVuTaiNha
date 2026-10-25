import test from 'node:test'
import assert from 'node:assert/strict'
import { parseJobsQuery, parseJobsResponse } from '../lib/server/jobs-contract.mjs'
import { loadStaffJobsConfig } from '../lib/server/jobs-config.mjs'

const query = () => ({ status: undefined, page: 1, pageSize: 20, sort: 'asc' })
function job() {
  return {
    id: '9223372036854775807', assignmentId: '9223372036854775807', orderId: '9007199254740993',
    jobCode: null, orderCode: null, status: 'WAITING', databaseStatus: 'ASSIGNED', jobStatus: 'waiting', orderStatus: 'confirmed',
    scheduledAt: '2026-10-23T17:30:00.000Z', expectedEndAt: '2026-10-23T19:00:00.000Z', durationMinutes: 90,
    contact: { name: 'Khách hàng kiểm thử', address: 'Địa chỉ kiểm thử' },
    services: [
      { serviceId: '9007199254740995', name: 'Tên dịch vụ từ snapshot', unit: 'giờ', quantity: '1.50', unitPrice: '1234567890.12' },
      { serviceId: '5', name: 'Dịch vụ thứ hai', unit: 'lần', quantity: '2.00', unitPrice: '10.00' },
    ],
    checkInAt: null, checkOutAt: null, assignedAt: '2026-10-23T00:00:00.000Z',
  }
}
function payload(data = [job()], overrides = {}) {
  return { data, pagination: { page: 1, pageSize: 20, total: data.length, totalPages: data.length ? 1 : 0 }, timezone: 'Asia/Ho_Chi_Minh', ...overrides }
}
const invalidQuery = callback => assert.throws(callback, { status: 400, code: 'VALIDATION_ERROR' })
const invalidResponse = callback => assert.throws(callback, { status: 502, code: 'STAFF_INVALID_RESPONSE' })

test('UC9 query defaults and legal boundary values follow the existing Staff API', () => {
  assert.deepEqual(parseJobsQuery(new URLSearchParams()), query())
  assert.deepEqual(parseJobsQuery(new URLSearchParams('page=100000&pageSize=100&sort=desc')), { ...query(), page: 100000, pageSize: 100, sort: 'desc' })
})

test('UC9 status normalizes WAITING and supports every existing assignment state', () => {
  for (const [input, status] of [['waiting', 'ASSIGNED'], ['WAITING', 'ASSIGNED'], ['assigned', 'ASSIGNED'], ['accepted', 'ACCEPTED'], ['in_progress', 'IN_PROGRESS'], ['done', 'DONE'], ['cancelled', 'CANCELLED']]) {
    assert.equal(parseJobsQuery(new URLSearchParams({ status })).status, status)
    assert.equal(parseJobsQuery(new URLSearchParams({ status: input })).status, status)
  }
})

test('UC9 rejects unknown, impersonation, unsupported search/date and proxy parameters', () => {
  for (const input of ['employeeId=2', 'userId=2', 'staffId=2', 'role=EMPLOYEE', 'search=clean', 'from=2026-10-23', 'to=2026-10-24', 'url=http%3A%2F%2Flocalhost%3A4003%2Finternal%2Fv1', '__proto__=x']) {
    invalidQuery(() => parseJobsQuery(new URLSearchParams(input)))
  }
})

test('UC9 rejects duplicate query keys instead of choosing a caller supplied identity or page', () => {
  for (const input of ['page=1&page=2', 'pageSize=20&pageSize=20', 'sort=asc&sort=desc', 'status=DONE&status=ACCEPTED']) {
    invalidQuery(() => parseJobsQuery(new URLSearchParams(input)))
  }
})

test('UC9 validates pagination, sort and states without permissive numeric coercion', () => {
  for (const input of ['page=0', 'page=-1', 'page=01', 'page=1e2', 'page=1.0', 'page=100001', 'page=', 'pageSize=0', 'pageSize=101', 'pageSize=9007199254740993', 'sort=ASC', 'sort=random', 'status=', 'status=toString', 'status=UNKNOWN']) {
    invalidQuery(() => parseJobsQuery(new URLSearchParams(input)))
  }
})

test('UC9 response preserves BIGINT, decimal snapshots, multiple services and UTC dates', () => {
  const source = payload(), before = structuredClone(source)
  const result = parseJobsResponse(source, query())
  assert.deepEqual(result, source)
  assert.deepEqual(source, before)
  assert.equal(result.data[0].id, '9223372036854775807')
  assert.equal(result.data[0].services[0].unitPrice, '1234567890.12')
  assert.equal(result.data[0].services[0].quantity, '1.50')
})

test('UC9 response strips unrelated identity, authentication and contact detail fields', () => {
  const source = payload()
  source.accessToken = 'unit-double-sensitive-field'
  source.employeeId = '7'
  source.pagination.token = 'unit-double-sensitive-field'
  source.data[0].password_hash = 'unit-double-sensitive-field'
  source.data[0].employeeId = '7'
  source.data[0].contact.phone = 'private-detail-only'
  source.data[0].services[0].extra = 'not-contract'
  assert.deepEqual(parseJobsResponse(source, query()), payload())
})

test('UC9 cancelled assignments remain distinct from waiting work', () => {
  const item = { ...job(), status: 'CANCELLED', databaseStatus: 'CANCELLED', jobStatus: null, orderStatus: 'cancelled' }
  assert.deepEqual(parseJobsResponse(payload([item]), query()).data[0], item)
})

test('UC9 nullable source data and genuinely empty service lists are not fabricated', () => {
  const item = { ...job(), contact: { name: null, address: null }, services: [], scheduledAt: null, expectedEndAt: null, durationMinutes: null, assignedAt: null, orderStatus: null }
  assert.deepEqual(parseJobsResponse(payload([item]), query()).data[0], item)
})

test('UC9 accepts empty results and a requested page beyond current result count', () => {
  assert.deepEqual(parseJobsResponse(payload([]), query()), payload([]))
  const outOfRange = payload([], { pagination: { page: 3, pageSize: 20, total: 2, totalPages: 1 } })
  assert.deepEqual(parseJobsResponse(outOfRange, { ...query(), page: 3 }), outOfRange)
})

test('UC9 rejects malformed response wrappers, timezone and pagination echoes', () => {
  for (const source of [null, [], {}, { ...payload(), data: {} }, { ...payload(), timezone: 'UTC' }, { ...payload(), pagination: { page: 2, pageSize: 20, total: 1, totalPages: 1 } }, { ...payload(), pagination: { page: 1, pageSize: 10, total: 1, totalPages: 1 } }, { ...payload(), pagination: { page: 1, pageSize: 20, total: 1, totalPages: 2 } }, { ...payload(), pagination: { page: 1, pageSize: 20, total: -1, totalPages: 0 } }, { ...payload(), pagination: { page: 1, pageSize: 20, total: '1', totalPages: 1 } }]) {
    invalidResponse(() => parseJobsResponse(source, query()))
  }
})

test('UC9 rejects corrupt IDs, conflicting assignment states and malformed service values', () => {
  for (const patch of [{ id: 1 }, { assignmentId: '9223372036854775808' }, { orderId: '01' }, { status: 'UNKNOWN' }, { databaseStatus: 'UNKNOWN' }, { status: 'DONE', databaseStatus: 'ASSIGNED', jobStatus: 'waiting' }, { jobStatus: 'unknown' }, { orderStatus: 'unknown' }, { contact: [] }, { services: 'service' }, { services: [{ ...job().services[0], serviceId: 1 }] }]) {
    invalidResponse(() => parseJobsResponse(payload([{ ...job(), ...patch }]), query()))
  }
})

test('UC9 rejects invalid or timezone-less dates and non-finite duration', () => {
  for (const patch of [{ scheduledAt: '2026-10-23 17:30:00' }, { expectedEndAt: 'not-a-date' }, { checkInAt: '2026-02-30T00:00:00.000Z' }, { assignedAt: 1 }, { durationMinutes: NaN }]) {
    invalidResponse(() => parseJobsResponse(payload([{ ...job(), ...patch }]), query()))
  }
})

test('UC9 configuration pins a server-only Staff origin and bounded timeout', () => {
  const config = loadStaffJobsConfig({}, process.cwd())
  assert.equal(config.staffUrl, 'http://127.0.0.1:4005')
  assert.equal(config.jobsTimeoutMs, 8000)
  const explicit = loadStaffJobsConfig({ STAFF_SERVICE_URL: 'http://localhost:4005', STAFF_API_TIMEOUT_MS: '15000' }, process.cwd())
  assert.equal(explicit.staffUrl, 'http://localhost:4005')
  assert.equal(explicit.jobsTimeoutMs, 15000)
  for (const staffUrl of ['http://localhost:4005/internal/v1', 'http://user:password@localhost:4005', 'http://localhost:4005?url=x', 'ftp://localhost:4005', '//localhost:4005']) {
    assert.throws(() => loadStaffJobsConfig({ STAFF_SERVICE_URL: staffUrl }, process.cwd()))
  }
  for (const timeout of ['99', '15001', '1e3']) assert.throws(() => loadStaffJobsConfig({ STAFF_API_TIMEOUT_MS: timeout }, process.cwd()))
})
