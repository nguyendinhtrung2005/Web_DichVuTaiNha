import { spawn } from 'node:child_process';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createMysqlPool } from '../shared/mysql-pool.js';
import { createProductFixtures } from '../scripts/product-fixtures.js';
import { runProductsBrowserFlow } from '../../frontend/tests/products-browser.cdp.mjs';
import { runCustomerBrowserFlow } from '../../frontend/tests/customer-browser.cdp.mjs';
import { stopChild } from '../../frontend/tests/cdp.mjs';

const appURL = 'http://localhost:4301';
const appDirectory = fileURLToPath(new URL('../../frontend/apps/customer/', import.meta.url));
const nextEnvPath = fileURLToPath(new URL('../../frontend/apps/customer/next-env.d.ts', import.meta.url));
const testTsconfig = fileURLToPath(new URL('../../frontend/apps/customer/.customer-browser-tsconfig.json', import.meta.url));
const artifacts = fileURLToPath(new URL('../.test-artifacts/', import.meta.url));
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function assertPortFree() {
  try { await fetch(appURL, { signal: AbortSignal.timeout(1000) }); }
  catch { return; }
  throw new Error('A server already responds on product-browser port 4301; stop it manually or configure another test port.');
}
const pool = createMysqlPool();
let fixture, stack, next, initialNextEnv, createdTestTsconfig = false;
try {
  await assertPortFree();
  initialNextEnv = await readFile(nextEnvPath);
  await writeFile(testTsconfig, JSON.stringify({ extends: './tsconfig.json', include: ['next-env.d.ts', 'app/**/*.ts', 'app/**/*.tsx', '.next/customer-browser-test/types/**/*.ts', '.next/customer-browser-test/dev/types/**/*.ts'] }, null, 2), { flag: 'wx' });
  createdTestTsconfig = true;
  const { startCustomerStack } = await import('../scripts/customer-runtime.js');
  fixture = await createProductFixtures(pool);
  stack = await startCustomerStack({
    env: { ...process.env, NODE_ENV: 'test' },
    ports: { gateway: 0, auth: 0, user: 0, catalog: 0, order: 0, staff: 0, payment: 0, review: 0 },
    configOverrides: { origin: appURL, defaultBranchId: fixture.branchId },
  });
  const gatewayURL = stack.urls.gateway.replace('127.0.0.1', 'localhost');
  const clientEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(DB_|INTERNAL_|JWT_)/.test(key)));
  next = spawn(process.execPath, [fileURLToPath(new URL('../../frontend/node_modules/next/dist/bin/next', import.meta.url)), 'dev', '-p', '4301'], {
    cwd: appDirectory, env: { ...clientEnvironment, NODE_ENV: 'development', CLEANHOME_CUSTOMER_BROWSER_TEST: '1', NEXT_PUBLIC_API_URL: gatewayURL + '/api/v1', NEXT_TELEMETRY_DISABLED: '1' },
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const collect = (chunk) => { output = (output + String(chunk)).slice(-12000); };
  next.stdout.on('data', collect); next.stderr.on('data', collect);
  try {
    await new Promise((resolve, reject) => { next.once('spawn', resolve); next.once('error', reject); });
    const deadline = Date.now() + 120000;
    let ready = false;
    while (Date.now() < deadline) {
      if (next.exitCode !== null) throw new Error('Customer development server exited.');
      try { if ((await fetch(appURL, { signal: AbortSignal.timeout(3000) })).ok) { ready = true; break; } } catch {}
      await pause(300);
    }
    if (!ready) throw new Error('Customer frontend did not start within 120 seconds.');
    await runProductsBrowserFlow({ appURL, gatewayURL, fixture, artifactDirectory: artifacts, env: clientEnvironment });
    await runCustomerBrowserFlow({ appURL, gatewayURL, fixture, artifactDirectory: artifacts, env: clientEnvironment });
    process.stdout.write('Services/products native Chrome + HTTP + MySQL browser flow: PASS\n');
  } catch (error) { process.stderr.write(output); throw error; }
} catch (error) {
  process.stderr.write('Products browser test FAIL: ' + error.message + '\n');
  process.exitCode = 1;
} finally {
  await stopChild(next);
  if (stack) await stack.close();
  try { if (fixture) await fixture.cleanup(); }
  finally {
    await pool.end();
    if (initialNextEnv) {
      const current = await readFile(nextEnvPath);
      const normalize = (buffer) => buffer.toString('utf8').replaceAll('.next/customer-browser-test/dev/types/', '.next/types/').replaceAll('.next/customer-browser-test/types/', '.next/types/').replaceAll('.next/dev/types/', '.next/types/');
      if (normalize(current) === normalize(initialNextEnv) && !current.equals(initialNextEnv)) await writeFile(nextEnvPath, initialNextEnv);
      else if (!current.equals(initialNextEnv)) process.stderr.write('Customer next-env changed beyond its generated route import; preserved for review.\n');
    }
    if (createdTestTsconfig) await unlink(testTsconfig);
  }
}
