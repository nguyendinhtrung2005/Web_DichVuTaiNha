import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url), ts = require('typescript');
const source = readFileSync(new URL('../../../packages/ui/src/components/staff/staff-login.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { fileName: 'staff-login.tsx', compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
let context = null;
const portal = function PortalLoginSentinel() {};
const exports = {};
vm.runInNewContext(code, { exports, require(id) {
  if (id === './staff-auth-session') return { useStaffAuth: () => context };
  if (id === './staff-portal-login') return { StaffPortalLogin: portal };
  if (id === 'react' || id === 'react/jsx-runtime') return require(id);
  return {};
} }, { timeout: 2000 });

test('host without StaffAuthProvider keeps the native portal login', () => {
  context = null;
  assert.equal(exports.StaffLogin().type, portal);
});

test('Staff provider selects BFF login during loading/authenticated/anonymous states', () => {
  for (const status of ['loading', 'authenticated', 'anonymous']) {
    context = { status };
    assert.equal(exports.StaffLogin().type.name, 'StaffBffLogin');
  }
});

test('BFF errors never trigger portal credential failover', () => {
  for (const error of ['SESSION_STORE_UNAVAILABLE', 'AUTH_UNAVAILABLE', 'SESSION_EXPIRED']) {
    context = { status: 'anonymous', error };
    assert.equal(exports.StaffLogin().type.name, 'StaffBffLogin');
    assert.notEqual(exports.StaffLogin().type, portal);
  }
});
