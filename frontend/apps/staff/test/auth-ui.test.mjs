import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const componentRoot = new URL('../../../packages/ui/src/components/', import.meta.url);
const loaded = new Map();

// Execute the actual pure TypeScript helpers; React hooks and network calls are not mounted.
function sourceModule(relative) {
  const filename = fileURLToPath(new URL(relative, componentRoot));
  if (loaded.has(filename)) return loaded.get(filename);
  const output = ts.transpileModule(readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} };
  loaded.set(filename, module.exports);
  const localRequire = createRequire(filename);
  vm.runInNewContext(output, {
    module, exports: module.exports, TextEncoder, TextDecoder, Uint8Array, URL,
    require(specifier) {
      if (specifier === '@/components/shared/route-policy') return sourceModule('shared/route-policy.ts');
      return localRequire(specifier);
    },
  }, { filename, timeout: 2_000 });
  return module.exports;
}

const { validateStaffLogin } = sourceModule('staff/staff-login-validation.ts');
const { parseStaffSession } = sourceModule('staff/staff-auth-session.tsx');
const { staffLoginReturnTo } = sourceModule('staff/staff-login-route.ts');
const validSession = () => ({
  session: { user: { id: '9109002', role: 'EMPLOYEE', status: 'ACTIVE' }, expiresAt: '2026-10-23T04:00:00.000Z' },
});
const fields = (value) => Object.keys(value).sort().join(',');

test('UI unit: phone accepts Auth test identifiers and surrounding ordinary spaces', () => {
  for (const phone of ['TEST-EMPLOYEE-UC9', '  TEST-EMPLOYEE-UC9  ', '0900000001', 'x'.repeat(20)]) {
    assert.equal(fields(validateStaffLogin({ phone, password: 'unit-input' })), '');
  }
});

test('UI unit: phone rejects empty, oversized and control-character input', () => {
  for (const phone of ['', '   ', 'x'.repeat(21), 'TEST\nUSER', '\tTEST', 'TEST\u007f']) {
    assert.equal(typeof validateStaffLogin({ phone, password: 'unit-input' }).phone, 'string');
  }
});

test('UI unit: password is not trimmed or mutated; Unicode limits match Auth', () => {
  for (const password of [' ', ' leading and trailing ', 'x'.repeat(128), String.fromCodePoint(0x1F600).repeat(128)]) {
    const input = { phone: 'TEST', password };
    assert.equal(fields(validateStaffLogin(input)), '');
    assert.equal(input.password, password);
  }
  for (const password of ['', 'x'.repeat(129), String.fromCodePoint(0x1F600).repeat(129)]) {
    assert.equal(typeof validateStaffLogin({ phone: 'TEST', password }).password, 'string');
  }
});

test('UI unit: session accepts canonical string IDs through signed BIGINT maximum', () => {
  for (const id of ['1', '9109002', '9223372036854775807']) {
    const payload = validSession();
    payload.session.user.id = id;
    assert.equal(parseStaffSession(payload)?.user.id, id);
  }
});

test('UI unit: session rejects numeric, zero, signed, padded and oversized IDs', () => {
  for (const id of [9109002, '', '0', '-1', '+1', '01', ' 1', '1.0', '1e3', '9223372036854775808', '99999999999999999999']) {
    const payload = validSession();
    payload.session.user.id = id;
    assert.equal(parseStaffSession(payload), null);
  }
});

test('UI unit: only ACTIVE EMPLOYEE sessions match the public contract', () => {
  for (const role of ['CUSTOMER', 'ADMIN', 'staff', null, undefined]) {
    const payload = validSession();
    payload.session.user.role = role;
    assert.equal(parseStaffSession(payload), null);
  }
  for (const status of ['LOCKED', 'INACTIVE', null, undefined]) {
    const payload = validSession();
    payload.session.user.status = status;
    assert.equal(parseStaffSession(payload), null);
  }
  for (const value of [null, [], {}, { session: null }, { session: { user: [] } }]) assert.equal(parseStaffSession(value), null);
});

test('UI unit: expiry requires canonical, real UTC ISO timestamps with milliseconds', () => {
  for (const expiresAt of ['2024-02-29T00:00:00.000Z', '2026-10-23T04:00:00.999Z']) {
    const payload = validSession();
    payload.session.expiresAt = expiresAt;
    assert.equal(parseStaffSession(payload)?.expiresAt, expiresAt);
  }
  for (const expiresAt of ['invalid', '2026-10-23', '2026-10-23T04:00:00Z', '2026-10-23T04:00:00.000+00:00',
    '2026-02-30T04:00:00.000Z', '2025-02-29T00:00:00.000Z', '2026-10-23T24:00:00.000Z', '2026-13-01T00:00:00.000Z']) {
    const payload = validSession();
    payload.session.expiresAt = expiresAt;
    assert.equal(parseStaffSession(payload), null);
  }
});

test('UI unit: parsed session retains only public fields, without token or invented profile', () => {
  const payload = validSession();
  payload.accessToken = 'unit-extra';
  payload.session.accessToken = 'unit-extra';
  payload.session.user.email = 'unit-extra';
  payload.session.user.name = 'unit-extra';
  const parsed = parseStaffSession(payload);
  assert.equal(fields(parsed), 'expiresAt,user');
  assert.equal(fields(parsed.user), 'id,role,status');
  assert.equal(parsed.user.id, payload.session.user.id);
});

test('UI unit: return URL preserves only valid Staff paths and local query/hash navigation', () => {
  for (const value of ['/', '/cong-viec', '/lich-lam-viec', '/ho-so', '/don/9109133', '/cong-viec?page=2#list']) {
    assert.equal(staffLoginReturnTo(value), value);
  }
});

test('UI unit: return URL cannot escape Staff using absolute, encoded, dot or login redirects', () => {
  const unsafe = [
    '', 'https://example.invalid', '//example.invalid', '/\\example.invalid', '/%2f%2fexample.invalid',
    '/%5cexample.invalid', '/cong-viec/..', '/don/../ho-so', '/don/%2e%2e', '/don/%252e%252e',
    '/don/%ZZ', '/don//9109133', '/cong-viec\n', '/staff', '/admin', '/tai-khoan',
    '/dang-nhap', '/dang-nhap?next=/cong-viec', '/dang-ky', '/dich-vu',
  ];
  for (const value of unsafe) assert.equal(staffLoginReturnTo(value), '/');
  // Query values never become the redirect target themselves.
  assert.equal(staffLoginReturnTo('/cong-viec?next=https%3A%2F%2Fexample.invalid'), '/cong-viec?next=https%3A%2F%2Fexample.invalid');
});
