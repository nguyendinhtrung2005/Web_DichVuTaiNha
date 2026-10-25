import test from 'node:test'
import assert from 'node:assert/strict'
import { parseAssignmentId, parseJobDetailResponse } from '../lib/server/job-detail-contract.mjs'

const assignmentId = '9223372036854775807'
const unsupported = ['jobCode', 'orderCode', 'houseType', 'area', 'rooms', 'floors', 'hasPets', 'specialRequest', 'cancellationPending']
function detail() {
  return { data: {
    id: assignmentId, assignmentId, orderId: '9007199254740993', jobCode: null, orderCode: null,
    status: 'WAITING', databaseStatus: 'ASSIGNED', jobStatus: 'waiting', orderStatus: 'confirmed',
    scheduledAt: '2026-10-23T17:30:00.000Z', expectedEndAt: '2026-10-23T19:00:00.000Z', durationMinutes: 90,
    contact: { name: 'Khách hàng kiểm thử', address: 'Địa chỉ kiểm thử', phone: 'TEST-CONTACT', houseType: null, area: null, rooms: null, floors: null, hasPets: null },
    services: [
      { serviceId: '9007199254740995', name: 'Dịch vụ từ snapshot', unit: 'giờ', quantity: '1.50', unitPrice: '1234567890.12' },
      { serviceId: '5', name: 'Dịch vụ thứ hai', unit: 'lần', quantity: '2.00', unitPrice: '10.00' },
    ],
    checkInAt: null, checkOutAt: null, assignedAt: '2026-10-23T00:00:00.000Z',
    specialRequest: null, cancellationPending: null, orderHistory: null,
    historySource: 'order-service-not-loaded', unsupportedFields: [...unsupported],
  } }
}
function patched(patch) { const value = detail(); Object.assign(value.data, patch); return value }
const rejectInput = callback => assert.throws(callback, { status: 400, code: 'VALIDATION_ERROR' })
const rejectDto = callback => assert.throws(callback, { status: 502, code: 'STAFF_INVALID_RESPONSE' })

test('UC10 accepts canonical signed BIGINT assignment IDs without losing precision', () => {
  for (const id of ['1', '9109008', '9007199254740993', assignmentId]) assert.equal(parseAssignmentId(id), id)
})

test('UC10 rejects numeric, coerced, out-of-range and path-like assignment IDs', () => {
  for (const id of [undefined, null, 1, '', '0', '-1', '01', '1e2', '1.0', ' 1', '1 ', '1abc', '9223372036854775808', '١', '../1', '1/status', '%31', 'http://localhost:4003/internal/v1']) rejectInput(() => parseAssignmentId(id))
})

test('UC10 validates and preserves the actual detail envelope and snapshot precision', () => {
  const source = detail(), before = structuredClone(source)
  assert.deepEqual(parseJobDetailResponse(source, assignmentId), before)
  assert.deepEqual(source, before)
  assert.equal(source.data.services[0].quantity, '1.50')
  assert.equal(source.data.services[0].unitPrice, '1234567890.12')
})

test('UC10 rejects absent data, numeric IDs and another assignment in a successful response', () => {
  for (const source of [null, [], {}, { data: null }, { data: [] }, patched({ id: 1 }), patched({ id: '1', assignmentId: '1' }), patched({ assignmentId: '1' }), patched({ orderId: '9223372036854775808' })]) rejectDto(() => parseJobDetailResponse(source, assignmentId))
})

test('UC10 keeps assignment status separate from the booking and supports cancelled assignments', () => {
  const completedBooking = patched({ status: 'ACCEPTED', databaseStatus: 'ACCEPTED', jobStatus: 'accepted', orderStatus: 'completed' })
  assert.deepEqual(parseJobDetailResponse(completedBooking, assignmentId), completedBooking)
  const cancelled = patched({ status: 'CANCELLED', databaseStatus: 'CANCELLED', jobStatus: null, orderStatus: 'cancelled' })
  assert.deepEqual(parseJobDetailResponse(cancelled, assignmentId), cancelled)
  rejectDto(() => parseJobDetailResponse(patched({ status: 'DONE' }), assignmentId))
})

test('UC10 preserves unknown contact, schedule and empty service data without inventing profile fields', () => {
  const source = patched({ contact: { name: null, address: null, phone: null, houseType: null, area: null, rooms: null, floors: null, hasPets: null }, services: [], scheduledAt: null, expectedEndAt: null, assignedAt: null, durationMinutes: null, orderStatus: null })
  assert.deepEqual(parseJobDetailResponse(source, assignmentId), source)
  for (const key of ['houseType', 'area', 'rooms', 'floors', 'hasPets']) {
    const corrupt = detail(); corrupt.data.contact[key] = key === 'houseType' ? 'invented' : 1
    rejectDto(() => parseJobDetailResponse(corrupt, assignmentId))
  }
  rejectDto(() => parseJobDetailResponse(patched({ specialRequest: 'invented request' }), assignmentId))
})

test('UC10 strips unrelated upstream account, token and contact fields', () => {
  const source = detail()
  source.accessToken = 'unit-double-sensitive-field'
  source.pagination = { total: 1 }
  source.data.employeeId = '2'
  source.data.password_hash = 'unit-double-sensitive-field'
  source.data.contact.email = 'not-in-contract'
  source.data.services[0].secret = 'unit-double-sensitive-field'
  assert.deepEqual(parseJobDetailResponse(source, assignmentId), detail())
})

test('UC10 preserves unloaded history as unknown and a genuinely loaded empty history as empty', () => {
  assert.equal(parseJobDetailResponse(detail(), assignmentId).data.orderHistory, null)
  const loaded = patched({ historySource: 'order-service', orderHistory: [], cancellationPending: false, unsupportedFields: unsupported.filter(key => key !== 'cancellationPending') })
  assert.deepEqual(parseJobDetailResponse(loaded, assignmentId), loaded)
  const unknown = patched({ historySource: 'order-service', orderHistory: null })
  assert.deepEqual(parseJobDetailResponse(unknown, assignmentId), unknown)
})

test('UC10 accepts actual Order history timestamps with Z, offset and optional millisecond precision', () => {
  const source = patched({ historySource: 'order-service', orderHistory: [
    { at: '2026-10-23T17:30:00Z', label: 'Đã xác nhận', by: 'Quản trị viên' },
    { at: '2026-10-24T00:30:00.1+07:00', label: 'Đã phân công', by: 'Quản trị viên', note: 'Thông tin thực tế' },
    { at: '2026-10-23T17:30:00.123Z', label: 'Đã tiếp nhận', by: 'Nhân viên', note: '' },
  ], cancellationPending: true, unsupportedFields: unsupported.filter(key => key !== 'cancellationPending') })
  assert.deepEqual(parseJobDetailResponse(source, assignmentId), source)
})

test('UC10 optional Order failure keeps readable core detail and returns only the fixed safe warning', () => {
  const source = patched({ historySource: 'order-service-unavailable', warnings: [{ code: 'ORDER_HISTORY_UNAVAILABLE', message: 'unit-double-sensitive-upstream-field', token: 'unit-double-sensitive-upstream-field' }] })
  const result = parseJobDetailResponse(source, assignmentId)
  assert.equal(result.data.assignmentId, assignmentId)
  assert.equal(result.data.orderHistory, null)
  assert.deepEqual(result.data.warnings, [{ code: 'ORDER_HISTORY_UNAVAILABLE', message: 'Chưa lấy được lịch sử công việc. Vui lòng thử lại sau.' }])
  assert.equal(JSON.stringify(result).includes('unit-double-sensitive'), false)
})

test('UC10 rejects conflicting optional history sources and cancellation availability', () => {
  for (const patch of [
    { historySource: 'unknown' }, { historySource: 'order-service-not-loaded', orderHistory: [] },
    { historySource: 'order-service-unavailable', orderHistory: [] }, { cancellationPending: false },
    { historySource: 'order-service', cancellationPending: 'false' },
    { historySource: 'order-service', cancellationPending: false, unsupportedFields: [...unsupported] },
  ]) rejectDto(() => parseJobDetailResponse(patched(patch), assignmentId))
})

test('UC10 rejects malformed history and impossible calendar dates without silently dropping entries', () => {
  for (const entry of [null, { at: '2026-02-30T00:00:00Z', label: 'X', by: 'Y' }, { at: '2026-10-23 17:30:00', label: 'X', by: 'Y' }, { at: '2026-10-23T17:30:00Z', label: '', by: 'Y' }, { at: '2026-10-23T17:30:00Z', label: 'X', by: 1 }, { at: '2026-10-23T17:30:00Z', label: 'X', by: 'Y', note: null }]) rejectDto(() => parseJobDetailResponse(patched({ historySource: 'order-service', orderHistory: [entry] }), assignmentId))
  rejectDto(() => parseJobDetailResponse(patched({ historySource: 'order-service', orderHistory: 'history' }), assignmentId))
})

test('UC10 validates the unsupported-field set instead of trusting arbitrary field labels', () => {
  for (const fields of [[], [...unsupported, 'secret'], [...unsupported, 'area'], unsupported.filter(key => key !== 'area'), 'area']) rejectDto(() => parseJobDetailResponse(patched({ unsupportedFields: fields }), assignmentId))
  assert.deepEqual([...parseJobDetailResponse(patched({ unsupportedFields: [...unsupported].reverse() }), assignmentId).data.unsupportedFields].sort(), [...unsupported].sort())
})

test('UC10 rejects corrupt job timestamps and decimal snapshots using the UC9 contract', () => {
  for (const patch of [{ scheduledAt: '2026-10-23 17:30:00' }, { checkOutAt: 'invalid' }, { durationMinutes: NaN }, { services: [{ ...detail().data.services[0], quantity: 1 }] }, { services: [{ ...detail().data.services[0], unitPrice: '-1.00' }] }]) rejectDto(() => parseJobDetailResponse(patched(patch), assignmentId))
})
