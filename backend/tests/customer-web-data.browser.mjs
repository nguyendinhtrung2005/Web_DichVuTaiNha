import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createMysqlPool } from '../shared/mysql-pool.js';
import { startCustomerStack } from '../scripts/customer-runtime.js';
import { verifyWebData, webAccessPath } from '../scripts/prepare-customer-web-data.js';
import { launchBrowser, stopChild } from '../../frontend/tests/cdp.mjs';

const appURL = 'http://localhost:4301';
const appDirectory = fileURLToPath(new URL('../../frontend/apps/customer/', import.meta.url));
const nextEnvPath = fileURLToPath(new URL('../../frontend/apps/customer/next-env.d.ts', import.meta.url));
const tsconfigPath = fileURLToPath(new URL('../../frontend/apps/customer/.customer-browser-tsconfig.json', import.meta.url));
const artifacts = fileURLToPath(new URL('../.test-artifacts/', import.meta.url));
const publicEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(DB_|INTERNAL_|JWT_)/.test(key)));
const pool = createMysqlPool();
let stack, next, browser, baselineEnv, createdTsconfig = false;
try {
  await verifyWebData(pool);
  const registry = JSON.parse(await readFile(webAccessPath, 'utf8'));
  let occupied = false;
  try { await fetch(appURL, { signal: AbortSignal.timeout(1000) }); occupied = true; } catch {}
  if (occupied) throw new Error('Test port 4301 occupied; existing process preserved.');
  baselineEnv = await readFile(nextEnvPath);
  await writeFile(tsconfigPath, JSON.stringify({ extends: './tsconfig.json', include: ['next-env.d.ts', 'app/**/*.ts', 'app/**/*.tsx', '.next/customer-browser-test/types/**/*.ts', '.next/customer-browser-test/dev/types/**/*.ts'] }, null, 2), { flag: 'wx' });
  createdTsconfig = true;
  stack = await startCustomerStack({ env: { ...process.env, NODE_ENV: 'test' }, ports: { gateway: 0, auth: 0, user: 0, catalog: 0, order: 0, staff: 0, payment: 0, review: 0 }, configOverrides: { origin: appURL, defaultBranchId: registry.branchId } });
  const gateway = stack.urls.gateway.replace('127.0.0.1', 'localhost');
  next = spawn(process.execPath, [fileURLToPath(new URL('../../frontend/node_modules/next/dist/bin/next', import.meta.url)), 'dev', '-p', '4301'], { cwd: appDirectory, env: { ...publicEnv, NODE_ENV: 'development', CLEANHOME_CUSTOMER_BROWSER_TEST: '1', NEXT_PUBLIC_API_URL: gateway + '/api/v1', NEXT_TELEMETRY_DISABLED: '1' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  next.stdout.on('data', () => {}); next.stderr.on('data', () => {});
  await new Promise((resolve, reject) => { next.once('spawn', resolve); next.once('error', reject); });
  let ready = false;
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    if (next.exitCode !== null) throw new Error('Customer dev server exited.');
    try { if ((await fetch(appURL, { signal: AbortSignal.timeout(3000) })).ok) { ready = true; break; } } catch {}
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  if (!ready) throw new Error('Customer startup timeout.');
  browser = await launchBrowser({ artifactDirectory: artifacts, env: publicEnv });
  const { page } = browser;
  const businessWrites = [];
  page.onEvent((event) => {
    if (event.method !== 'Network.requestWillBeSent') return;
    const request = event.params.request;
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method) && request.url.includes('/api/v1/') && !request.url.includes('/auth/')) businessWrites.push(new URL(request.url).pathname);
  });
  const signIn = async (key) => {
    const account = registry.accounts.find((entry) => entry.key === key);
    await page.goto(appURL + '/dang-nhap');
    await page.fill('Số điện thoại hoặc email', account.email);
    await page.fill('Mật khẩu', account.password);
    await page.click('Đăng nhập');
    if (key !== 'locked') await page.waitFor('location.pathname!=="/dang-nhap"', 'Login failed for synthetic account ' + key);
  };
  const signOut = async () => {
    await page.click('Đăng xuất', { aria: true });
    await page.waitFor('location.pathname==="/dang-nhap"', 'Logout did not finish.');
  };
  await signIn('a');
  await page.goto(appURL + '/don-cua-toi'); await page.text('12 đơn phù hợp');
  await page.click('Sau'); await page.text('Trang 2 / 2');
  await page.goto(appURL + '/lich-su'); await page.text('4 đơn phù hợp');
  const reviewReady = registry.bookings.find((booking) => booking.key === 'review-ready');
  await page.goto(appURL + reviewReady.url); await page.text('Viết đánh giá');
  const room = registry.services.find((service) => service.key === 'room');
  await page.goto(appURL + room.url); await page.text('từ 2 đánh giá của đơn đã hoàn thành');
  process.stdout.write('Web data browser PASS: A login, 12 service orders, page 2, four completed, review-ready and public score.\n');
  await page.goto(appURL + '/don-san-pham');
  await page.text('Đang xác minh tồn kho'); await page.text('Chưa tạo được đơn');
  const out = registry.products.find((product) => product.key === 'out');
  await page.goto(appURL + out.url); await page.text('Sản phẩm hiện hết hàng.');
  await signOut(); await signIn('empty');
  await page.goto(appURL + '/don-cua-toi'); await page.text('Bạn chưa có đơn dịch vụ nào');
  await signOut(); await signIn('b');
  await page.goto(appURL + reviewReady.url); await page.text('Không tìm thấy đơn dịch vụ');
  await signOut(); await signIn('locked'); await page.text('Số điện thoại/email hoặc mật khẩu không đúng.');
  assert.deepEqual(businessWrites, [], 'This verification must not change the persistent business scenarios.');
  process.stdout.write('Web data browser PASS: product states, empty account, cross-account denial, inactive login; no business writes.\n');
} catch (error) {
  process.stderr.write('Web data browser FAIL: ' + error.message + '\n');
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  await stopChild(next);
  if (stack) await stack.close();
  await pool.end();
  if (baselineEnv) {
    const current = await readFile(nextEnvPath);
    const normalize = (value) => value.toString('utf8').replaceAll('.next/customer-browser-test/dev/types/', '.next/types/').replaceAll('.next/customer-browser-test/types/', '.next/types/').replaceAll('.next/dev/types/', '.next/types/');
    if (normalize(current) === normalize(baselineEnv) && !current.equals(baselineEnv)) await writeFile(nextEnvPath, baselineEnv);
  }
  if (createdTsconfig) await unlink(tsconfigPath);
}
