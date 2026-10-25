import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import test from 'node:test'

// Pure UI unit fixtures only. No credential, HTTP request, React mount or SQL operation.
const require = createRequire(import.meta.url), ts = require('typescript')
const root = new URL('../../../packages/ui/src/components/staff/', import.meta.url)
const cache = new Map()
function sourceModule(name) {
  const filename = fileURLToPath(new URL(name, root))
  if (cache.has(filename)) return cache.get(filename)
  const output = ts.transpileModule(readFileSync(filename, 'utf8'), {
    fileName: filename, compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText
  const module = { exports: {} }
  cache.set(filename, module.exports)
  vm.runInNewContext(output, {
    module, exports: module.exports, URLSearchParams, URL,
    require(name) {
      if (name === './staff-jobs-remote-model') return sourceModule('staff-jobs-remote-model.ts')
      throw new Error('Unexpected dependency in pure Staff detail model')
    },
  }, { filename, timeout: 2000 })
  return module.exports
}
const { parseStaffJobDetailPayload, isStaffAssignmentId, staffJobsReturnHref, staffContactPhoneHref, formatStaffSnapshotPrice } = sourceModule('staff-job-detail-remote-model.ts')
const { parseStaffJobsQuery, staffJobsQueryString, staffJobsListHref, staffJobDetailHref } = sourceModule('staff-jobs-remote-model.ts')
const plain = value => JSON.parse(JSON.stringify(value))
function detail() {
  return {
    data: {
      id: '1', assignmentId: '1', orderId: '2', jobCode: null, orderCode: null,
      status: 'WAITING', databaseStatus: 'ASSIGNED', jobStatus: 'waiting', orderStatus: 'confirmed',
      scheduledAt: '2026-10-24T23:30:00.000Z', expectedEndAt: '2026-10-25T01:00:00.000Z', durationMinutes: 90,
      contact: { name: 'Unit customer', address: 'Unit address', phone: 'TEST-UNIT-CONTACT', houseType: null, area: null, rooms: null, floors: null, hasPets: null },
      services: [{ serviceId: '3', name: 'Unit service snapshot', unit: 'giờ', quantity: '1.50', unitPrice: '125000.00' }],
      checkInAt: null, checkOutAt: null, assignedAt: '2026-10-23T00:00:00.000Z',
      specialRequest: null, cancellationPending: null, orderHistory: null, historySource: 'order-service-not-loaded',
      unsupportedFields: ['jobCode', 'orderCode', 'houseType', 'area', 'rooms', 'floors', 'hasPets', 'specialRequest', 'cancellationPending'],
    },
  }
}
function freeze(value) {
  if (value && typeof value === 'object') { Object.freeze(value); for (const child of Object.values(value)) freeze(child) }
  return value
}

test('UC10 UI unit: detail keeps canonical BIGINT strings and verifies the requested assignment', () => {
  for (const id of ['1', '9007199254740993', '9223372036854775807']) {
    const source = detail(); source.data.id = id; source.data.assignmentId = id
    const parsed = parseStaffJobDetailPayload(source, id)
    assert.equal(parsed.assignmentId, id)
    assert.equal(parsed.orderId, '2')
    assert.equal(parseStaffJobDetailPayload(source, id === '1' ? '2' : '1'), null)
  }
  for (const value of [1, null, '', '0', '01', '-1', '+1', '1.0', '1e2', '9223372036854775808', '../1', '1?employeeId=2']) assert.equal(isStaffAssignmentId(value), false)
});

test('UC10 UI unit: unsupported and nullable fields stay null without an invented profile or timeline', () => {
  const source = detail()
  source.data.contact.name = null; source.data.contact.phone = null; source.data.contact.address = null
  source.data.services = []; source.data.scheduledAt = null; source.data.expectedEndAt = null; source.data.durationMinutes = null
  const parsed = parseStaffJobDetailPayload(source, '1')
  assert.equal(parsed.contact.name, null)
  assert.equal(parsed.contact.hasPets, null)
  assert.equal(parsed.specialRequest, null)
  assert.equal(parsed.orderHistory, null)
  assert.equal(parsed.cancellationPending, null)
  assert.equal(parsed.services.length, 0)
  for (const field of ['houseType', 'area', 'rooms', 'floors', 'hasPets']) {
    const invalid = detail(); invalid.data.contact[field] = 'invented'
    assert.equal(parseStaffJobDetailPayload(invalid, '1'), null)
  }
});

test('UC10 UI unit: all saved services and precise DECIMAL prices survive read-only parsing', () => {
  const source = detail()
  source.data.services.push({ serviceId: '4', name: 'Second unit service', unit: 'm²', quantity: '99999999.99', unitPrice: '999999999999999999.99' })
  const before = JSON.stringify(source)
  const parsed = parseStaffJobDetailPayload(freeze(source), '1')
  assert.deepEqual(plain(parsed.services), plain(source.data.services))
  assert.equal(JSON.stringify(source), before)
  assert.equal(formatStaffSnapshotPrice('999999999999999999.99'), '999.999.999.999.999.999,99 ₫')
  assert.equal(formatStaffSnapshotPrice('125000.00'), '125.000,00 ₫')
  assert.equal(formatStaffSnapshotPrice('not-a-price'), 'Chưa có đơn giá')
});

test('UC10 UI unit: real contact phone is preserved while TEST identifiers never become fabricated telephone numbers', () => {
  assert.equal(parseStaffJobDetailPayload(detail(), '1').contact.phone, 'TEST-UNIT-CONTACT')
  assert.equal(staffContactPhoneHref('TEST-UNIT-CONTACT'), null)
  assert.equal(staffContactPhoneHref(null), null)
  assert.equal(staffContactPhoneHref('+84 (900) 123-456'), 'tel:+84900123456')
  for (const value of ['javascript:alert(1)', '0900/123', '---', '   ', '12+345', '<0900123456>']) assert.equal(staffContactPhoneHref(value), null)
});

test('UC10 UI unit: assignment status is not replaced by completed or cancelled booking state', () => {
  for (const orderStatus of ['completed', 'cancelled']) {
    const source = detail(); source.data.orderStatus = orderStatus
    const parsed = parseStaffJobDetailPayload(source, '1')
    assert.equal(parsed.status, 'WAITING'); assert.equal(parsed.jobStatus, 'waiting'); assert.equal(parsed.orderStatus, orderStatus)
  }
  const source = detail(); source.data.status = 'CANCELLED'; source.data.databaseStatus = 'CANCELLED'; source.data.jobStatus = null
  assert.equal(parseStaffJobDetailPayload(source, '1').status, 'CANCELLED')
  source.data.jobStatus = 'waiting'
  assert.equal(parseStaffJobDetailPayload(source, '1'), null)
});

test('UC10 UI unit: missing Order history remains distinct from an empty received history', () => {
  for (const historySource of ['order-service-not-loaded', 'order-service-unavailable', 'order-service']) {
    const source = detail(); source.data.historySource = historySource
    assert.equal(parseStaffJobDetailPayload(source, '1').orderHistory, null)
  }
  const source = detail(); source.data.historySource = 'order-service'; source.data.orderHistory = []; source.data.cancellationPending = false
  assert.equal(parseStaffJobDetailPayload(source, '1').orderHistory.length, 0)
  source.data.historySource = 'order-service-not-loaded'
  assert.equal(parseStaffJobDetailPayload(source, '1'), null)
});

test('UC10 UI unit: Order history accepts the actual offset/fraction contract and only real entries', () => {
  const source = detail(); source.data.historySource = 'order-service'; source.data.cancellationPending = true
  source.data.orderHistory = [
    { at: '2026-10-25T06:30:00+07:00', label: 'Unit actual event', by: 'Unit actor', note: 'Unit supplied note' },
    { at: '2026-10-24T23:30:00.1Z', label: 'Unit actual event 2', by: 'Unit actor 2' },
    { at: '2026-10-24T23:30:00.123Z', label: 'Unit actual event 3', by: 'Unit actor 3', note: '' },
  ]
  const parsed = parseStaffJobDetailPayload(freeze(source), '1')
  assert.deepEqual(plain(parsed.orderHistory), plain(source.data.orderHistory))
  assert.equal(parsed.cancellationPending, true)
});

test('UC10 UI unit: malformed or contradictory history and warnings fail closed', () => {
  const badEntries = [
    { at: '2026-02-30T00:00:00Z', label: 'Event', by: 'Actor' },
    { at: '2026-10-25', label: 'Event', by: 'Actor' },
    { at: '2026-10-25T00:00:00Z', label: '', by: 'Actor' },
    { at: '2026-10-25T00:00:00Z', label: 'Event', by: ' ' },
    { at: '2026-10-25T00:00:00Z', label: 'Event', by: 'Actor', note: null },
  ]
  for (const entry of badEntries) {
    const source = detail(); source.data.historySource = 'order-service'; source.data.orderHistory = [entry]
    assert.equal(parseStaffJobDetailPayload(source, '1'), null)
  }
  for (const override of [{ orderHistory: [] }, { cancellationPending: true }, { historySource: {} }, { warnings: [{ code: 'UNEXPECTED', message: 'Unit warning' }] }]) {
    const source = detail(); Object.assign(source.data, override)
    assert.equal(parseStaffJobDetailPayload(source, '1'), null)
  }
});

test('UC10 UI unit: parsing strips unrelated secret and profile fields without changing the source', () => {
  const source = detail()
  source.accessToken = 'unit-unexpected'; source.data.sessionCookie = 'unit-unexpected'
  source.data.contact.email = 'unit-unexpected'; source.data.services[0].privateKey = 'unit-unexpected'
  source.data.historySource = 'order-service'; source.data.orderHistory = [{ at: '2026-10-25T00:00:00Z', label: 'Event', by: 'Actor', password: 'unit-unexpected' }]
  source.data.warnings = [{ code: 'ORDER_HISTORY_UNAVAILABLE', message: 'Unit legitimate warning', accessToken: 'unit-unexpected' }]
  const parsed = parseStaffJobDetailPayload(freeze(source), '1')
  assert.equal(JSON.stringify(parsed).includes('unit-unexpected'), false)
  assert.equal(Object.hasOwn(parsed, 'payment'), false)
  assert.equal(Object.hasOwn(parsed, 'staffNotes'), false)
});

test('UC10 navigation unit: supported list filters survive reload and round-trip return URLs', () => {
  const query = parseStaffJobsQuery('?status=DONE&page=2&pageSize=8&sort=desc')
  assert.deepEqual(plain(query), { status: 'DONE', page: 2, pageSize: 8, sort: 'desc' })
  const href = staffJobsListHref(query)
  assert.equal(staffJobsReturnHref(href), href)
  assert.equal(staffJobsQueryString(parseStaffJobsQuery(new URL(href, 'http://unit.local').search)), staffJobsQueryString(query))
  assert.equal(parseStaffJobsQuery('status=ASSIGNED').status, 'WAITING')
  assert.equal(staffJobsReturnHref('/cong-viec'), '/cong-viec')
});

test('UC10 navigation unit: list URL state rejects unknown, repeated and out-of-range query parameters', () => {
  for (const search of ['employeeId=1', 'userId=1', 'url=https://unit.invalid', 'page=1&page=2', 'status=', 'status=done', 'page=0', 'page=01', 'page=100001', 'pageSize=101', 'pageSize=', 'sort=invalid', 'sort=']) {
    assert.equal(parseStaffJobsQuery(search), null)
    assert.equal(staffJobsReturnHref('/cong-viec?' + search), '/cong-viec')
  }
});

test('UC10 navigation unit: return values cannot redirect outside the fixed list path', () => {
  for (const requested of [null, undefined, '', 'https://unit.invalid', '//unit.invalid/cong-viec', '/\\unit.invalid', '/cong-viec/../ho-so', '/cong-viec/', '/cong-viec#unsafe', '/cong-viec?from=%2Fadmin', '/api/staff/jobs', '/internal/v1/bookings', '/don/1', '/cong-viec\n', '/cong-viec?status=DONE%0A']) assert.equal(staffJobsReturnHref(requested), '/cong-viec')
});

test('UC10 navigation unit: detail link uses the real assignment ID and validated list return only', () => {
  const query = { status: 'IN_PROGRESS', page: 3, pageSize: 2, sort: 'desc' }
  const url = new URL(staffJobDetailHref('9223372036854775807', query), 'http://unit.local')
  assert.equal(url.pathname, '/don/9223372036854775807')
  assert.deepEqual([...url.searchParams.keys()], ['from'])
  assert.equal(staffJobsReturnHref(url.searchParams.get('from')), staffJobsListHref(query))
  assert.equal(staffJobDetailHref('../other', query), '/cong-viec')
});
