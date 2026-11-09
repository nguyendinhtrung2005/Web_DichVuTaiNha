import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
class ApiError extends Error {
  constructor(message, status, code) { super(message); this.status = status; this.code = code; }
}
const user = (id) => ({ id, name: 'Synthetic ' + id, phone: id === 'A' ? '0391234567' : '0391234568', role: 'customer', email: '', address: '' });
const order = (id, customerId) => ({ id, customerId, createdAt: null });
const page = (items = []) => ({ items, total: items.length, page: 1, limit: 100 });
function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function load(file, dependencies) {
  const module = { exports: {} };
  const source = readFileSync(new URL('../packages/' + file, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, {
    module, exports: module.exports, Error, setInterval, clearInterval,
    require(name) { if (Object.hasOwn(dependencies, name)) return dependencies[name]; throw new Error('Unexpected dependency: ' + name); },
  }, { filename: file });
  return module.exports;
}
function harness(handler) {
  const calls = [];
  const apiRequest = async (path, init = {}) => { calls.push({ path, init }); return handler(path, init); };
  const store = load('core/src/customer-api-store.ts', { './api-client': { ApiError, apiRequest } });
  const account = load('ui/src/components/customer/account-service.ts', {
    '@/lib/api-client': { apiRequest }, '@/lib/customer-api-store': store,
  });
  return { store, account, calls };
}
const response = (path, id = 'A') => {
  if (path === '/auth/session' || path === '/users/me') return user(id);
  if (path === '/catalog/categories') return [];
  if (path.startsWith('/orders?')) return page([order('order-' + id, id)]);
  return page();
};
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test('registration acknowledgement survives Catalog failure without repeating registration', async () => {
  let registered = 0;
  const { store, account, calls } = harness((path) => {
    if (path === '/auth/register') { registered++; return user('A'); }
    if (path.startsWith('/catalog/services')) throw new ApiError('Catalog unavailable', 503, 'SERVICE_UNAVAILABLE');
    return response(path);
  });
  const result = await account.registerCustomer({ name: 'Synthetic A', phone: '0391234567', password: 'synthetic-only' });
  assert.equal(result.ok, true);
  assert.equal(result.user.id, 'A');
  assert.ok(result.warning);
  assert.equal(store.customerSnapshot().session.userId, 'A');
  assert.equal(store.customerStatus().status, 'unavailable', 'Do not conceal the failed API refresh.');
  assert.equal(store.customerStatus().error, 'Catalog unavailable');
  assert.equal(registered, 1);
  assert.equal(calls.filter((call) => call.path === '/auth/register').length, 1);
});

test('successful login stays acknowledged when another business service is unavailable', async () => {
  const { store, account } = harness((path) => {
    if (path === '/auth/login') return user('A');
    if (path.startsWith('/payments?')) throw new ApiError('Payments unavailable', 503, 'SERVICE_UNAVAILABLE');
    return response(path);
  });
  const result = await account.loginCustomer('0391234567', 'synthetic-only');
  assert.equal(result.ok, true);
  assert.ok(result.warning);
  assert.equal(store.customerSnapshot().session.userId, 'A');
  assert.equal(store.customerStatus().status, 'unavailable');
});

test('Catalog rejection followed by session 401 clears all private cache even after refresh has returned', async () => {
  const session = deferred();
  let fail = false;
  const { store } = harness((path) => {
    if (fail && path === '/auth/session') return session.promise;
    if (fail && path.startsWith('/catalog/services')) throw new ApiError('Catalog unavailable', 503, 'SERVICE_UNAVAILABLE');
    return response(path);
  });
  await store.refreshCustomerData(true);
  assert.equal(store.customerSnapshot().orders.length, 1);
  fail = true;
  await store.refreshCustomerData(true);
  session.reject(new ApiError('Session expired', 401, 'UNAUTHENTICATED'));
  await tick();
  const state = store.customerSnapshot();
  assert.equal(state.session, null);
  for (const key of ['users', 'orders', 'payments', 'reviews']) assert.equal(state[key].length, 0);
  assert.equal(store.customerStatus().error, 'Catalog unavailable');
  assert.ok(store.customerStatus().sessionError);
});

test('session 401 clears private cache before a delayed Catalog failure finishes', async () => {
  const catalog = deferred();
  let fail = false;
  const { store } = harness((path) => {
    if (fail && path === '/auth/session') throw new ApiError('Session expired', 401, 'UNAUTHENTICATED');
    if (fail && path.startsWith('/catalog/services')) return catalog.promise;
    return response(path);
  });
  await store.refreshCustomerData(true);
  fail = true;
  const task = store.refreshCustomerData(true);
  await tick();
  assert.equal(store.customerSnapshot().session, null);
  assert.equal(store.customerSnapshot().orders.length, 0);
  catalog.reject(new ApiError('Catalog unavailable', 503, 'SERVICE_UNAVAILABLE'));
  await task;
  assert.equal(store.customerStatus().status, 'unavailable');
  assert.equal(store.customerSnapshot().session, null);
});

test('a delayed profile 401 from A cannot expire a newer B session', async () => {
  const mutation = deferred();
  const { store, account } = harness((path, init) => path === '/users/me' && init.method === 'PATCH' ? mutation.promise : response(path));
  await store.refreshCustomerData(true);
  const pending = account.saveCustomerProfile('A', { name: 'Synthetic changed A', phone: '0391234567' });
  store.acceptCustomerAuthentication(user('B'));
  mutation.reject(new ApiError('Old A session expired', 401, 'UNAUTHENTICATED'));
  assert.equal((await pending).ok, false);
  assert.equal(store.customerSnapshot().session.userId, 'B');
  assert.equal(store.customerStatus().sessionError, undefined);
});

test('a stale session-refresh 401 is ignored after another identity is accepted', async () => {
  const session = deferred();
  let delayed = false;
  const { store } = harness((path) => delayed && path === '/auth/session' ? session.promise : response(path));
  await store.refreshCustomerData(true);
  delayed = true;
  const pending = store.refreshCustomerData(true);
  store.acceptCustomerAuthentication(user('B'));
  session.reject(new ApiError('Old A session expired', 401, 'UNAUTHENTICATED'));
  await pending;
  assert.equal(store.customerSnapshot().session.userId, 'B');
  assert.equal(store.customerSnapshot().orders.length, 0);
});

test('normal polling does not invalidate a same-customer mutation scope', async () => {
  const { store } = harness((path) => response(path));
  await store.refreshCustomerData(true);
  const scope = store.captureCustomerSession();
  await store.refreshCustomerData(true);
  assert.equal(store.isCustomerSessionCurrent(scope), true);
  await store.finishCustomerMutation(scope);
  assert.equal(store.isCustomerSessionCurrent(scope), true);
});

test('profile mutations reject an out-of-date caller identity before sending a PATCH', async () => {
  const { store, account, calls } = harness((path) => response(path));
  store.acceptCustomerAuthentication(user('B'));
  const result = await account.saveCustomerProfile('A', { name: 'Synthetic A', phone: '0391234567' });
  assert.equal(result.ok, false);
  assert.equal(calls.length, 0);
});

test('an older detail response cannot overwrite a newer complete same-account cache', async () => {
  const detail = deferred();
  let status = 'pending';
  const { store } = harness((path) => {
    if (path === '/orders/order-A') return detail.promise;
    if (path.startsWith('/orders?')) return page([{ ...order('order-A', 'A'), status }]);
    return response(path);
  });
  await store.refreshCustomerData(true);
  const pending = store.refreshCustomerOrder('order-A');
  status = 'confirmed';
  await store.refreshCustomerData(true);
  detail.resolve({ ...order('order-A', 'A'), status: 'pending' });
  await pending;
  assert.equal(store.customerSnapshot().orders[0].status, 'confirmed');
});

test('a pending or failed full refresh does not discard a valid independent detail response', async () => {
  const detail = deferred();
  const catalog = deferred();
  let poll = false;
  const { store } = harness((path) => {
    if (path === '/orders/order-A') return detail.promise;
    if (poll && path.startsWith('/catalog/services')) return catalog.promise;
    return response(path);
  });
  await store.refreshCustomerData(true);
  const pendingDetail = store.refreshCustomerOrder('order-A');
  poll = true;
  const pendingPoll = store.refreshCustomerData(true);
  detail.resolve({ ...order('order-A', 'A'), status: 'confirmed' });
  await pendingDetail;
  assert.equal(store.customerSnapshot().orders[0].status, 'confirmed');
  catalog.reject(new ApiError('Catalog unavailable', 503, 'SERVICE_UNAVAILABLE'));
  await pendingPoll;
  assert.equal(store.customerSnapshot().orders[0].status, 'confirmed');
});

test('mixed-account refresh responses are rejected and never cached together', async () => {
  const { store } = harness((path) => path === '/users/me' ? user('B') : response(path));
  store.acceptCustomerAuthentication(user('A'));
  await store.refreshCustomerData(true);
  assert.equal(store.customerSnapshot().session, null);
  assert.equal(store.customerSnapshot().orders.length, 0);
});

test('login ACK accepts the same identity already observed by a focus refresh after Set-Cookie', async () => {
  const acknowledgement = deferred();
  const { store, account } = harness((path) => path === '/auth/login' ? acknowledgement.promise : response(path));
  const pending = account.loginCustomer('0391234567', 'synthetic-only');
  await store.refreshCustomerData(true);
  const observedScope = store.captureCustomerSession();
  assert.equal(observedScope.userId, 'A');
  acknowledgement.resolve(user('A'));
  const result = await pending;
  assert.equal(result.ok, true);
  assert.equal(store.isCustomerSessionCurrent(observedScope), true, 'Accepting this same ACK must not clear the cache or renew identity again.');
  assert.equal(store.customerSnapshot().orders[0].id, 'order-A');
});

test('registration ACK accepts a cookie observed before its response body', async () => {
  const acknowledgement = deferred();
  const { store, account } = harness((path) => path === '/auth/register' ? acknowledgement.promise : response(path));
  const pending = account.registerCustomer({ name: 'Synthetic A', phone: '0391234567', password: 'synthetic-only' });
  await store.refreshCustomerData(true);
  const observedScope = store.captureCustomerSession();
  acknowledgement.resolve(user('A'));
  const result = await pending;
  assert.equal(result.ok, true);
  assert.equal(store.isCustomerSessionCurrent(observedScope), true);
});

test('an old Auth ACK cannot cross logout or an explicit same-account renewal', async (t) => {
  for (const boundary of ['logout', 'renewal']) {
    await t.test(boundary, async () => {
      const acknowledgement = deferred();
      const { store, account } = harness((path) => path === '/auth/login' ? acknowledgement.promise : path === '/auth/logout' ? undefined : response(path));
      const pending = account.loginCustomer('0391234567', 'synthetic-only');
      await store.refreshCustomerData(true);
      if (boundary === 'logout') await store.logoutCustomer();
      else store.acceptCustomerAuthentication(user('A'));
      const current = store.captureCustomerSession();
      acknowledgement.resolve(user('A'));
      assert.equal((await pending).ok, false);
      assert.equal(store.isCustomerSessionCurrent(current), true, 'The stale ACK must not replace the newer boundary.');
      assert.equal(store.customerSnapshot().session?.userId ?? null, boundary === 'logout' ? null : 'A');
    });
  }
});
