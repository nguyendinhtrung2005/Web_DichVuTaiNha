import test from 'node:test'
import assert from 'node:assert/strict'
import { positiveId, listQuery, transitionInput } from '../src/validation.js'
import { iso, jobDto, jobStatus, orderStatus } from '../src/mapping.js'

const row = {
  id: '9223372036854775807', bookingId: '9007199254740993', status: 'ASSIGNED', bookingStatus: 'CONFIRMED',
  scheduledStart: '2026-10-22 17:30:00', scheduledEnd: '2026-10-22 19:00:00',
  assignedAt: '2026-10-22 00:00:00', checkInAt: null, checkOutAt: null,
  addressSnapshot: { recipient: 'Tên từ snapshot', phone: 'fixture-contact', address_text: 'Địa chỉ kiểm thử' },
  customerName: 'Tên tài khoản', customerPhone: 'account-contact', password_hash: 'not-a-credential',
}

test('resource IDs preserve signed BIGINT precision and reject MySQL-coercible input', () => {
  assert.equal(positiveId(row.id), row.id)
  for (const value of ['0', '-1', '01', '1abc', '1e2', ' 1', '1.0', '9223372036854775808', '', undefined, 1]) {
    assert.throws(() => positiveId(value), { status: 400 })
  }
})

test('pagination, filters and repeated/unknown parameters have bounded strict validation', () => {
  assert.deepEqual(listQuery({ status: 'waiting', page: '2', pageSize: '100', sort: 'desc' }), { status: 'ASSIGNED', page: 2, pageSize: 100, sort: 'desc' })
  for (const value of [{ page: '0' }, { page: '100001' }, { pageSize: '101' }, { page: '1e2' }, { page: ['1', '2'] }, { status: [] }, { sort: 'ASC' }, { staffId: '2' }, { status: 'toString' }]) {
    assert.throws(() => listQuery(value), { status: 400 })
  }
})

test('schedule uses Vietnam calendar boundaries across a year, midnight and maximum inclusive range', () => {
  const year = listQuery({ from: '2026-12-31', to: '2027-01-01' }, true)
  assert.equal(year.fromUtc, '2026-12-30 17:00:00.000')
  assert.equal(year.toUtc, '2027-01-01 17:00:00.000')
  assert.equal(listQuery({ from: '2024-01-01', to: '2024-12-31' }, true).toUtc, '2024-12-31 17:00:00.000')
  for (const range of [{ from: '2024-01-01', to: '2025-01-01' }, { from: '2026-02-30', to: '2026-03-01' }, { from: '2026-10-23T00:00:00Z', to: '2026-10-23' }, { from: '1970-01-01', to: '1970-01-01' }, { from: '2026-10-23', to: '2026-10-22' }]) {
    assert.throws(() => listQuery(range, true), { status: 400 })
  }
})

test('transition accepts only the explicit step body and bounded idempotency key', () => {
  assert.deepEqual(transitionInput({ status: 'ACCEPTED' }, 'key-valid-1'), { status: 'ACCEPTED', idempotencyKey: 'key-valid-1' })
  for (const body of [null, [], { status: 'WAITING' }, { status: 'done' }, { status: 'DONE', employeeId: '2' }, { status: 'DONE', checkOutAt: '2026-10-23' }]) {
    assert.throws(() => transitionInput(body, 'key-valid-1'), { status: 400 })
  }
  for (const key of [undefined, 'short', 'a'.repeat(129), 'key with spaces', 'key-\r\ninjection']) {
    assert.throws(() => transitionInput({ status: 'DONE' }, key), { status: 400 })
  }
})

test('DTO preserves snapshots, multiple services and decimal/BIGINT precision without leaking account data', () => {
  const source = structuredClone(row)
  const items = [{ serviceId: '9007199254740995', serviceName: 'Tên snapshot', unit: 'giờ', quantity: '1.50', unitPrice: '1234567890.12' }, { serviceId: '5', serviceName: 'Dịch vụ thứ hai', unit: 'lần', quantity: '1.00', unitPrice: '10.00' }]
  const dto = jobDto(row, items)
  assert.equal(dto.assignmentId, row.id); assert.equal(dto.orderId, row.bookingId)
  assert.equal(dto.services.length, 2); assert.equal(dto.services[0].unitPrice, '1234567890.12')
  assert.equal(dto.services[0].quantity, '1.50'); assert.equal(dto.durationMinutes, 90)
  assert.equal(dto.status, 'WAITING'); assert.equal(dto.jobStatus, 'waiting'); assert.equal(dto.orderStatus, 'confirmed')
  assert.equal(dto.contact.phone, undefined); assert.equal(dto.password_hash, undefined)
  assert.deepEqual(row, source)
})

test('detail uses contact snapshots and reports unsupported fields as unknown', () => {
  const dto = jobDto(row, [], true)
  assert.equal(dto.contact.name, 'Tên từ snapshot'); assert.equal(dto.contact.phone, 'fixture-contact')
  for (const key of ['houseType', 'area', 'rooms', 'floors', 'hasPets']) assert.equal(dto.contact[key], null)
  assert.equal(dto.specialRequest, null); assert.equal(dto.cancellationPending, null); assert.equal(dto.orderHistory, null)
  assert.equal(dto.jobCode, null); assert.equal(dto.orderCode, null)
  assert.equal(jobDto({ ...row, addressSnapshot: null }, [], true).contact.phone, 'account-contact')
})

test('JSON contact handles mysql2-decoded scalar strings as well as raw JSON object/string snapshots', () => {
  for (const value of ['Địa chỉ chuỗi đã decode', JSON.stringify('Địa chỉ chuỗi đã decode')]) {
    assert.equal(jobDto({ ...row, addressSnapshot: value }).contact.address, 'Địa chỉ chuỗi đã decode')
  }
  assert.equal(jobDto({ ...row, addressSnapshot: JSON.stringify(row.addressSnapshot) }).contact.address, 'Địa chỉ kiểm thử')
  for (const value of [null, 5, false, [], {}]) assert.equal(jobDto({ ...row, addressSnapshot: value }).contact.address, null)
})

test('status mapping cannot return object-prototype properties for unsupported database statuses', () => {
  for (const value of ['__proto__', 'constructor', 'toString', 'UNKNOWN', undefined]) {
    assert.equal(jobStatus(value), null); assert.equal(orderStatus(value), null)
  }
  assert.equal(jobStatus('CANCELLED'), null); assert.equal(orderStatus('CANCELLED'), 'cancelled')
})

test('timestamps use UTC for SQL strings and sanitize invalid stored Date objects', () => {
  assert.equal(iso('2026-10-23 01:02:03'), '2026-10-23T01:02:03.000Z')
  assert.equal(iso('2026-10-23T08:02:03+07:00'), '2026-10-23T01:02:03.000Z')
  assert.equal(iso(new Date('2026-10-23T01:02:03Z')), '2026-10-23T01:02:03.000Z')
  assert.equal(iso(null), null)
  for (const value of [new Date(NaN), 'not-a-date']) assert.throws(() => iso(value), { status: 503, code: 'INVALID_DATABASE_DATA' })
})
