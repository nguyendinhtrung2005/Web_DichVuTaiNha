import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';

// Unit DTO fixtures only: no HTTP request, credential, database write or React mount.
const require = createRequire(import.meta.url);
const ts = require('typescript');
const filename = fileURLToPath(new URL('../../../packages/ui/src/components/staff/staff-jobs-remote-model.ts', import.meta.url));
const output = ts.transpileModule(readFileSync(filename, 'utf8'), {
  fileName: filename,
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;
const module = { exports: {} };
vm.runInNewContext(output, { module, exports: module.exports, URLSearchParams }, { filename, timeout: 2_000 });
const { parseStaffJobsPayload, staffJobsQueryString, formatStaffJobTime } = module.exports;
const plain = value => JSON.parse(JSON.stringify(value));

function job() {
  return {
    id: '1', assignmentId: '1', orderId: '2', jobCode: null, orderCode: null,
    status: 'WAITING', databaseStatus: 'ASSIGNED', jobStatus: 'waiting', orderStatus: 'confirmed',
    scheduledAt: '2026-10-24T23:30:00.000Z', expectedEndAt: '2026-10-25T01:00:00.000Z', durationMinutes: 90,
    contact: { name: 'Unit customer snapshot', address: 'Unit address snapshot' },
    services: [{ serviceId: '3', name: 'Unit service snapshot', unit: 'giờ', quantity: '1.50', unitPrice: '125000.00' }],
    checkInAt: null, checkOutAt: null, assignedAt: '2026-10-23T00:00:00.000Z',
  };
}

function payload(rows = [job()]) {
  return { data: rows, pagination: { page: 1, pageSize: 20, total: rows.length, totalPages: rows.length ? 1 : 0 }, timezone: 'Asia/Ho_Chi_Minh' };
}

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

test('UC9 UI unit: canonical signed-BIGINT IDs remain exact strings', () => {
  for (const id of ['1', '9007199254740993', '9223372036854775807']) {
    const row = job();
    row.id = id; row.assignmentId = id; row.orderId = id; row.services[0].serviceId = id;
    const parsed = parseStaffJobsPayload(payload([row]));
    assert.equal(parsed.data[0].assignmentId, id);
    assert.equal(parsed.data[0].orderId, id);
    assert.equal(parsed.data[0].services[0].serviceId, id);
  }
  for (const field of ['id', 'assignmentId', 'orderId']) {
    for (const id of [1, '0', '01', '+1', '-1', '1e3', ' 1', '9223372036854775808']) {
      const row = job(); row[field] = id;
      assert.equal(parseStaffJobsPayload(payload([row])), null);
    }
  }
});

test('UC9 UI unit: every service and DECIMAL snapshot survives without price recalculation', () => {
  const row = job();
  row.services.push({ serviceId: '4', name: 'Second unit service snapshot', unit: 'm²', quantity: '99999999.99', unitPrice: '9999999999.99' });
  const source = freeze(payload([row]));
  const before = JSON.stringify(source);
  const parsed = parseStaffJobsPayload(source);
  assert.deepEqual(plain(parsed.data[0].services), plain(row.services));
  assert.equal(parsed.data[0].services[0].quantity, '1.50');
  assert.equal(parsed.data[0].services[1].unitPrice, '9999999999.99');
  assert.equal(JSON.stringify(source), before);
});

test('UC9 UI unit: nullable fields and an empty server list are valid without invented data', () => {
  const row = job();
  for (const field of ['scheduledAt', 'expectedEndAt', 'assignedAt', 'checkInAt', 'checkOutAt', 'durationMinutes', 'orderStatus']) row[field] = null;
  row.contact = { name: null, address: null }; row.services = [];
  const parsed = parseStaffJobsPayload(payload([row]));
  assert.equal(parsed.data[0].contact.name, null);
  assert.equal(parsed.data[0].scheduledAt, null);
  assert.equal(parsed.data[0].jobCode, null);
  assert.equal(parsed.data[0].orderCode, null);
  assert.equal(parsed.data[0].services.length, 0);
  const empty = parseStaffJobsPayload(payload([]));
  assert.equal(empty.data.length, 0);
  assert.deepEqual(plain(empty.pagination), { page: 1, pageSize: 20, total: 0, totalPages: 0 });
});

test('UC9 UI unit: assignment status remains distinct from the booking status', () => {
  for (const [status, databaseStatus, jobStatus] of [
    ['WAITING', 'ASSIGNED', 'waiting'], ['ACCEPTED', 'ACCEPTED', 'accepted'],
    ['IN_PROGRESS', 'IN_PROGRESS', 'in_progress'], ['DONE', 'DONE', 'done'], ['CANCELLED', 'CANCELLED', null],
  ]) {
    const row = { ...job(), status, databaseStatus, jobStatus, orderStatus: 'completed' };
    const parsed = parseStaffJobsPayload(payload([row]));
    assert.equal(parsed.data[0].status, status);
    assert.equal(parsed.data[0].jobStatus, jobStatus);
    assert.equal(parsed.data[0].orderStatus, 'completed');
  }
});

test('UC9 UI unit: mismatched status, identifier aliases and noncanonical dates are rejected', () => {
  const invalid = [
    { assignmentId: '2' }, { status: 'completed' }, { databaseStatus: 'WAITING' }, { jobStatus: 'done' },
    { orderStatus: 'unsupported' }, { jobCode: 'INVENTED' }, { durationMinutes: Number.NaN },
    { scheduledAt: '2026-02-30T00:00:00.000Z' }, { expectedEndAt: '2026-10-25T01:00:00Z' },
    { checkInAt: '2026-10-24T23:30:00.000+00:00' }, { assignedAt: 'not-a-date' },
  ];
  for (const override of invalid) assert.equal(parseStaffJobsPayload(payload([{ ...job(), ...override }])), null);
  for (const unknown of [null, [], {}, { data: [], pagination: {}, timezone: 'UTC' }]) assert.equal(parseStaffJobsPayload(unknown), null);
});

test('UC9 UI unit: pagination validates bounds, totals and server page counts', () => {
  for (const override of [
    { page: 0 }, { page: 100001 }, { page: 1.5 }, { pageSize: 0 }, { pageSize: 101 },
    { total: -1 }, { total: 0 }, { total: Number.MAX_SAFE_INTEGER + 1 }, { totalPages: 2 }, { totalPages: '1' },
  ]) {
    const source = payload(); Object.assign(source.pagination, override);
    assert.equal(parseStaffJobsPayload(source), null);
  }
  const last = payload([]);
  last.pagination = { page: 2, pageSize: 2, total: 3, totalPages: 2 };
  assert.equal(parseStaffJobsPayload(last).pagination.page, 2);
});

test('UC9 UI unit: duplicate assignments are rejected while a shared booking is preserved', () => {
  const first = job();
  const second = { ...job(), id: '2', assignmentId: '2' };
  assert.equal(parseStaffJobsPayload(payload([first, job()])), null);
  const parsed = parseStaffJobsPayload(payload([first, second]));
  assert.equal(parsed.data.length, 2);
  assert.equal(parsed.data[0].orderId, parsed.data[1].orderId);
  assert.notEqual(parsed.data[0].assignmentId, parsed.data[1].assignmentId);
});

test('UC9 UI unit: query emits only supported filters and never browser-supplied employee identity', () => {
  const query = { status: 'WAITING', page: 2, pageSize: 2, sort: 'desc', employeeId: 'unit-other-user', userId: 'unit-other-user', search: 'unsupported' };
  const params = new URLSearchParams(staffJobsQueryString(query));
  assert.deepEqual([...params.keys()].sort(), ['page', 'pageSize', 'sort', 'status']);
  assert.equal(params.get('status'), 'WAITING');
  assert.equal(params.get('page'), '2');
  assert.equal(params.get('sort'), 'desc');
  const all = new URLSearchParams(staffJobsQueryString({ status: '', page: 1, pageSize: 20, sort: 'asc' }));
  assert.equal(all.has('status'), false);
  assert.deepEqual([...all.keys()].sort(), ['page', 'pageSize', 'sort']);
});

test('UC9 UI unit: Vietnam time crosses UTC midnight and year boundaries using dd/mm/yyyy', () => {
  assert.equal(formatStaffJobTime('2026-10-24T23:30:00.000Z'), '06:30 · 25/10/2026');
  assert.equal(formatStaffJobTime('2026-12-31T23:30:00.000Z'), '06:30 · 01/01/2027');
  assert.equal(formatStaffJobTime('2024-02-28T17:00:00.000Z'), '00:00 · 29/02/2024');
  assert.equal(formatStaffJobTime(null), 'Chưa có lịch thực hiện');
  assert.equal(formatStaffJobTime('invalid'), 'Chưa có lịch thực hiện');
});

test('UC9 UI unit: public DTO strips unexpected secret, contact and profile fields at every level', () => {
  const source = payload();
  source.accessToken = 'unit-unexpected-field'; source.session = { private: 'unit-unexpected-field' };
  source.pagination.employeeId = 'unit-unexpected-field';
  source.data[0].accessToken = 'unit-unexpected-field'; source.data[0].employee = { name: 'unit-unexpected-field' };
  source.data[0].contact.phone = 'unit-unexpected-field';
  source.data[0].services[0].privateKey = 'unit-unexpected-field';
  const parsed = parseStaffJobsPayload(freeze(source));
  assert.equal(JSON.stringify(parsed).includes('unit-unexpected-field'), false);
  assert.deepEqual(Object.keys(parsed).sort(), ['data', 'pagination', 'timezone']);
  assert.deepEqual(Object.keys(parsed.data[0].contact).sort(), ['address', 'name']);
  assert.deepEqual(Object.keys(parsed.data[0].services[0]).sort(), ['name', 'quantity', 'serviceId', 'unit', 'unitPrice']);
});
