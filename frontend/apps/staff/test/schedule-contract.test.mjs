import test from 'node:test'
import assert from 'node:assert/strict'
import { parseScheduleQuery, parseScheduleResponse } from '../lib/server/schedule-contract.mjs'

// Explicit unit fixtures. These tests do not query MySQL or claim live HTTP/JWT coverage.
const query = (extra = {}) => ({ from: '2026-10-24', to: '2026-10-24', status: undefined, page: 1, pageSize: 20, sort: 'asc', ...extra })
const params = (extra = {}) => new URLSearchParams({ from: '2026-10-24', to: '2026-10-24', ...extra })
function job(extra = {}) {
  return {
    id: '9223372036854775807', assignmentId: '9223372036854775807', orderId: '9007199254740993',
    jobCode: null, orderCode: null, status: 'WAITING', databaseStatus: 'ASSIGNED', jobStatus: 'waiting', orderStatus: 'confirmed',
    scheduledAt: '2026-10-23T17:30:00.000Z', expectedEndAt: '2026-10-23T19:00:00.000Z', durationMinutes: 90,
    contact: { name: 'Unit contact snapshot', address: 'Unit address snapshot' },
    services: [
      { serviceId: '9007199254740995', name: 'Unit service snapshot', unit: 'giờ', quantity: '1.50', unitPrice: '1234567890.12' },
      { serviceId: '5', name: 'Unit second service snapshot', unit: 'lần', quantity: '2.00', unitPrice: '10.00' },
    ],
    checkInAt: null, checkOutAt: null, assignedAt: '2026-10-23T00:00:00.000Z', ...extra,
  }
}
function payload(data = [job()], extra = {}) {
  return { data, pagination: { page: 1, pageSize: 20, total: data.length, totalPages: data.length ? 1 : 0 }, timezone: 'Asia/Ho_Chi_Minh', ...extra }
}
const invalidQuery = callback => assert.throws(callback, { status: 400, code: 'VALIDATION_ERROR' })
const invalidResponse = callback => assert.throws(callback, { status: 502, code: 'STAFF_INVALID_RESPONSE' })

test('UC11 requires both date parameters and defaults only supported paging and sort', () => {
  assert.deepEqual(parseScheduleQuery(params()), query())
  for (const search of ['', 'from=2026-10-24', 'to=2026-10-24', 'from=&to=2026-10-24', 'from=2026-10-24&to=']) {
    invalidQuery(() => parseScheduleQuery(new URLSearchParams(search)))
  }
})

test('UC11 date validation accepts the exact supported year bounds and genuine leap days', () => {
  for (const day of ['1971-01-01', '2099-12-31', '2000-02-29', '2024-02-29']) {
    assert.deepEqual(parseScheduleQuery(params({ from: day, to: day })), query({ from: day, to: day }))
  }
})

test('UC11 inclusive range is at most 366 days across leap and ordinary years', () => {
  assert.equal(parseScheduleQuery(params({ from: '2024-01-01', to: '2024-12-31' })).to, '2024-12-31')
  assert.equal(parseScheduleQuery(params({ from: '2025-01-01', to: '2026-01-01' })).to, '2026-01-01')
  for (const range of [{ from: '2024-01-01', to: '2025-01-01' }, { from: '2025-01-01', to: '2026-01-02' }]) {
    invalidQuery(() => parseScheduleQuery(params(range)))
  }
})

test('UC11 rejects impossible, ambiguous, timezone-bearing, reversed and out-of-bounds dates', () => {
  for (const day of ['2026-02-29', '2026-02-30', '2024-04-31', '2026-13-01', '2026-00-01', '2026-01-00', '24/10/2026', '2026-1-01', '2026-10-24T00:00:00Z', ' 2026-10-24', '1970-12-31', '2100-01-01', '0000-01-01', 'toString']) {
    invalidQuery(() => parseScheduleQuery(params({ from: day, to: day })))
  }
  invalidQuery(() => parseScheduleQuery(params({ from: '2027-01-01', to: '2026-12-31' })))
})

test('UC11 rejects unknown, identity, proxy and repeated query parameters', () => {
  for (const search of ['employeeId=2', 'userId=2', 'staffId=2', 'role=EMPLOYEE', 'search=unit', 'url=http%3A%2F%2Flocalhost%3A4003%2Finternal%2Fv1', '__proto__=x', 'from=2026-10-24', 'to=2026-10-24', 'status=WAITING&status=DONE', 'page=1&page=2', 'pageSize=20&pageSize=20', 'sort=asc&sort=desc']) {
    invalidQuery(() => parseScheduleQuery(new URLSearchParams(params() + '&' + search)))
  }
})

test('UC11 normalizes existing status aliases and validates bounded pagination and sort', () => {
  for (const [input, expected] of [['waiting', 'ASSIGNED'], ['assigned', 'ASSIGNED'], ['ACCEPTED', 'ACCEPTED'], ['in_progress', 'IN_PROGRESS'], ['done', 'DONE'], ['cancelled', 'CANCELLED']]) {
    assert.equal(parseScheduleQuery(params({ status: input })).status, expected)
  }
  assert.deepEqual(parseScheduleQuery(params({ page: '100000', pageSize: '100', sort: 'desc' })), query({ page: 100000, pageSize: 100, sort: 'desc' }))
  for (const [key, value] of [['page', '0'], ['page', '01'], ['page', '1e2'], ['page', '100001'], ['pageSize', '0'], ['pageSize', '101'], ['pageSize', '1.0'], ['sort', 'ASC'], ['sort', ''], ['status', ''], ['status', 'toString']]) {
    invalidQuery(() => parseScheduleQuery(params({ [key]: value })))
  }
})

test('UC11 Vietnam midnight accepts a prior-UTC-date job without shifting the calendar day', () => {
  const source = payload()
  assert.deepEqual(parseScheduleResponse(source, query()), source)
  invalidResponse(() => parseScheduleResponse(source, query({ from: '2026-10-23', to: '2026-10-23' })))
})

test('UC11 preserves carry-in and multi-day jobs instead of filtering solely on start date', () => {
  for (const row of [
    job({ scheduledAt: '2026-10-23T16:00:00.000Z', expectedEndAt: '2026-10-23T18:00:00.000Z', durationMinutes: 120 }),
    job({ scheduledAt: '2026-10-22T10:00:00.000Z', expectedEndAt: '2026-10-25T10:00:00.000Z', durationMinutes: 4320 }),
  ]) assert.deepEqual(parseScheduleResponse(payload([row]), query()).data[0], row)
})

test('UC11 retains every same-day overlapping assignment and a shared booking without overwriting', () => {
  const first = job({ id: '1', assignmentId: '1' })
  const second = job({ id: '2', assignmentId: '2', scheduledAt: '2026-10-23T18:00:00.000Z', expectedEndAt: '2026-10-23T19:30:00.000Z' })
  const source = payload([first, second])
  assert.deepEqual(parseScheduleResponse(source, query()), source)
  assert.equal(source.data[0].orderId, source.data[1].orderId)
})

test('UC11 strict overlap excludes jobs touching only the beginning or exclusive ending boundary', () => {
  for (const patch of [
    { scheduledAt: '2026-10-23T16:00:00.000Z', expectedEndAt: '2026-10-23T17:00:00.000Z' },
    { scheduledAt: '2026-10-24T17:00:00.000Z', expectedEndAt: '2026-10-24T18:00:00.000Z' },
    { scheduledAt: '2026-10-20T10:00:00.000Z', expectedEndAt: '2026-10-20T11:00:00.000Z' },
  ]) invalidResponse(() => parseScheduleResponse(payload([job(patch)]), query()))
})

test('UC11 midnight range semantics work across year changes and a leap day', () => {
  const year = job({ scheduledAt: '2026-12-31T16:30:00.000Z', expectedEndAt: '2026-12-31T17:30:00.000Z', durationMinutes: 60 })
  assert.deepEqual(parseScheduleResponse(payload([year]), query({ from: '2027-01-01', to: '2027-01-01' })).data[0], year)
  const leap = job({ scheduledAt: '2024-02-28T17:00:00.000Z', expectedEndAt: '2024-02-29T17:00:00.000Z', durationMinutes: 1440 })
  assert.deepEqual(parseScheduleResponse(payload([leap]), query({ from: '2024-02-29', to: '2024-02-29' })).data[0], leap)
})

test('UC11 rejects absent, noncanonical or non-positive schedule intervals', () => {
  for (const patch of [
    { scheduledAt: null }, { expectedEndAt: null }, { scheduledAt: '2026-10-24 01:00:00' },
    { expectedEndAt: '2026-02-30T01:00:00.000Z' }, { expectedEndAt: '2026-10-23T17:30:00.000Z' },
    { expectedEndAt: '2026-10-23T17:00:00.000Z' },
  ]) invalidResponse(() => parseScheduleResponse(payload([job(patch)]), query()))
})

test('UC11 preserves BIGINT and service DECIMAL snapshots and strips unrelated fields', () => {
  const clean = payload(), source = structuredClone(clean)
  source.accessToken = 'unit-double-sensitive-field'
  source.employeeId = '7'
  source.data[0].password_hash = 'unit-double-sensitive-field'
  source.data[0].contact.phone = 'detail-only-contact'
  source.data[0].services[0].extra = 'not-in-list-contract'
  const before = structuredClone(source), result = parseScheduleResponse(source, query())
  assert.deepEqual(result, clean)
  assert.deepEqual(source, before)
  assert.equal(result.data[0].assignmentId, '9223372036854775807')
  assert.equal(result.data[0].services[0].unitPrice, '1234567890.12')
})

test('UC11 retains cancelled assignment state separately from a completed booking', () => {
  const row = job({ status: 'CANCELLED', databaseStatus: 'CANCELLED', jobStatus: null, orderStatus: 'completed' })
  assert.deepEqual(parseScheduleResponse(payload([row]), query({ status: 'CANCELLED' })).data[0], row)
  invalidResponse(() => parseScheduleResponse(payload([row]), query({ status: 'ASSIGNED' })))
})

test('UC11 empty and out-of-range pages retain honest totals and reject malformed DTO metadata', () => {
  assert.deepEqual(parseScheduleResponse(payload([]), query()), payload([]))
  const last = payload([], { pagination: { page: 3, pageSize: 20, total: 2, totalPages: 1 } })
  assert.deepEqual(parseScheduleResponse(last, query({ page: 3 })), last)
  for (const source of [null, {}, { ...payload(), timezone: 'UTC' }, { ...payload(), pagination: { page: 2, pageSize: 20, total: 1, totalPages: 1 } }, { ...payload(), pagination: { page: 1, pageSize: 20, total: 1, totalPages: 0 } }, payload([job(), job()]), payload([job({ assignmentId: '01' })]), payload([job({ databaseStatus: 'DONE' })])]) {
    invalidResponse(() => parseScheduleResponse(source, query()))
  }
})
