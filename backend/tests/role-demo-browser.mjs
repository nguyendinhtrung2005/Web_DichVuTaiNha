import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { launchBrowser, stopChild } from '../../frontend/tests/cdp.mjs';

const artifacts = fileURLToPath(new URL('../.test-artifacts/', import.meta.url));
const authSource = await readFile(new URL('../../frontend/packages/core/src/auth.ts', import.meta.url), 'utf8');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clientEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(DB_|INTERNAL_|JWT_)/.test(key)));

async function waitForServer(child, url) {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('Demo frontend exited during startup.');
    try { if ((await fetch(url, { signal: AbortSignal.timeout(3000) })).ok) return; } catch { /* Wait for this test's child process. */ }
    await pause(300);
  }
  throw new Error('Demo frontend startup timed out.');
}

for (const [role, port] of [['staff', 3002], ['admin', 3003]]) {
  const url = `http://localhost:${port}`;
  let child;
  let browser;
  try {
    let occupied = false;
    try { await fetch(url, { signal: AbortSignal.timeout(1000) }); occupied = true; } catch { /* A free port is required. */ }
    if (occupied) throw new Error(`Port ${port} is already in use; this test will not replace that process.`);
    const credential = authSource.match(new RegExp(`\\{ role: "${role}", email: "([^"]+)", password: (DEMO_PASSWORD_[A-Z]+), name: "([^"]+)" \\}`));
    if (!credential) throw new Error('Demo credential definition was not found.');
    const password = authSource.match(new RegExp(`export const ${credential[2]} = "([^"]+)"`))?.[1];
    if (!password) throw new Error('Demo password definition was not found.');
    child = spawn(process.execPath, [fileURLToPath(new URL('../../frontend/node_modules/next/dist/bin/next', import.meta.url)), 'dev', '-p', String(port)], { cwd: fileURLToPath(new URL(`../../frontend/apps/${role}/`, import.meta.url)), env: { ...clientEnvironment, NODE_ENV: 'development', NEXT_TELEMETRY_DISABLED: '1' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', () => {});
    child.stderr.on('data', () => {});
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    await waitForServer(child, url);
    browser = await launchBrowser({ artifactDirectory: artifacts, env: clientEnvironment });
    const { page } = browser;
    const apiRequests = [];
    page.onEvent((event) => {
      if (event.method === 'Network.requestWillBeSent' && event.params.request.url.includes('/api/v1/')) apiRequests.push(event.params.request.url);
    });
    await page.goto(`${url}/dang-nhap`);
    await page.fill('Email', credential[1]);
    await page.fill('Mật khẩu', password);
    await page.evaluate("localStorage.setItem('cleanhome-demo-state-customer','preserve-customer-sentinel')");
    await page.waitFor('(() => {const button=document.querySelector("form button[type=submit]");if(!button || button.disabled)return false;button.click();return true})()', 'Demo login submit button is unavailable.');
    await page.waitFor('location.pathname === "/"', `${role} demo login did not navigate to its dashboard.`);
    await page.text(role === 'staff' ? `Chào ${credential[3]},` : 'Tổng quan hoạt động');
    await page.send('Page.reload');
    await page.text(role === 'staff' ? `Chào ${credential[3]},` : 'Tổng quan hoạt động');
    const storage = await page.evaluate(`(() => {const state=JSON.parse(localStorage.getItem('cleanhome-demo-state-${role}'));return {role:state?.session?.role,userId:state?.session?.userId,orders:state?.orders?.length,customer:localStorage.getItem('cleanhome-demo-state-customer')}})()`);
    assert.equal(storage.role, role);
    assert.ok(typeof storage.userId === 'string');
    assert.ok(Number.isInteger(storage.orders) && storage.orders > 0);
    assert.equal(storage.customer, 'preserve-customer-sentinel');
    assert.equal(apiRequests.length, 0, 'Staff/Admin demo must not start Customer API requests.');
    process.stdout.write(`${role} browser smoke PASS: demo login, dashboard/reload, separate localStorage, zero Customer API requests\n`);
  } catch (error) {
    process.stderr.write(`${role} browser smoke FAIL: ${error.message}\n`);
    process.exitCode = 1;
    break;
  } finally {
    if (browser) await browser.close();
    await stopChild(child);
  }
}
