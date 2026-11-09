import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const ts = createRequire(import.meta.url)('typescript');
class ApiError extends Error { constructor(message, status, code) { super(message); this.status = status; this.code = code; } }
function load(file, dependencies = {}, globals = {}) {
  const source = readFileSync(new URL('../packages/' + file, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, URLSearchParams, ...globals, require(name) { if (name in dependencies) return dependencies[name]; throw new Error('Unexpected dependency: ' + name); } });
  return module.exports;
}

test('Customer optimizes only public raster assets and passes remote, authenticated, query and vector sources through', () => {
  const { canOptimizeCustomerImage } = load('core/src/customer-image-policy.ts');
  for (const source of ['/images/hero.png', '/images/ve-sinh-sofa.png', '/images/sub/image.webp']) assert.equal(canOptimizeCustomerImage(source), true);
  for (const source of ['https://images.example.invalid/photo.jpg', '//example.invalid/photo.png', '/api/private/photo.png', '/images/photo.png?token=private', '/images/../private.png', '/images/%2e%2e/private.png', '/placeholder.svg', 'data:image/png;base64,synthetic', 'blob:synthetic', null, {}]) assert.equal(canOptimizeCustomerImage(source), false);
});

test('Customer reuses Intl formatters without changing the Vietnamese date/time output', () => {
  let created = 0;
  const { customerDay, customerDate } = load('core/src/customer-time.ts', {}, { Intl: { DateTimeFormat: function (...args) { created++; return new Intl.DateTimeFormat(...args); } } });
  for (let index = 0; index < 200; index++) {
    assert.equal(customerDay(new Date('2026-11-07T17:00:00Z')), '2026-11-08');
    assert.equal(customerDate('2026-11-08T02:00:00Z'), new Date('2026-11-08T02:00:00Z').toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }));
  }
  assert.equal(created, 2, 'Formatter construction must not scale with order rows/renders.');
  assert.equal(customerDate('invalid'), 'Invalid Date');
});

test('cancelled service search aborts its paginated API request and never starts another page', async () => {
  const calls = [];
  let started;
  const ready = new Promise((resolve) => { started = resolve; });
  const api = { ApiError, apiRequest: async (path, init) => {
    calls.push(path); started();
    return new Promise((resolve, reject) => {
      if (init.signal.aborted) reject(new ApiError('Aborted', 0, 'TIMEOUT'));
      else init.signal.addEventListener('abort', () => reject(new ApiError('Aborted', 0, 'TIMEOUT')), { once: true });
    });
  } };
  const store = load('core/src/customer-api-store.ts', { './api-client': api });
  const search = load('core/src/customer-service-search.ts', { './api-client': api, './customer-api-store': store });
  const controller = new AbortController();
  const pending = search.searchCustomerServices({ query: 'synthetic', group: '', cleaningType: '' }, controller.signal);
  await ready;
  controller.abort();
  await assert.rejects(pending, (error) => error.code === 'TIMEOUT');
  assert.equal(calls.length, 1);
});
