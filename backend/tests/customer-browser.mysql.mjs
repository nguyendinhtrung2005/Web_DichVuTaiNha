import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createMysqlPool } from '../shared/mysql-pool.js';
import { createCustomerFixtures } from '../scripts/customer-fixtures.js';
import { runCustomerBrowserFlow } from '../../frontend/tests/customer-browser.cdp.mjs';
import { stopChild } from '../../frontend/tests/cdp.mjs';

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const frontend = fileURLToPath(new URL('../../frontend/', import.meta.url));
const artifacts = fileURLToPath(new URL('../.test-artifacts/', import.meta.url));
const appURL = 'http://localhost:3001';
const gatewayURL = 'http://localhost:4100';

async function assertPortFree(url) {
  try { await fetch(url, { signal: AbortSignal.timeout(1000) }); }
  catch { return; }
  throw new Error(`A server already responds at ${url}. Stop that server yourself before this isolated test.`);
}

async function waitForFrontend(child) {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('Customer frontend exited during startup.');
    try { const response = await fetch(appURL, { signal: AbortSignal.timeout(3000) }); if (response.ok) return; } catch { /* Wait for the local development server. */ }
    await pause(300);
  }
  throw new Error('Customer frontend did not become ready within 120 seconds.');
}

const pool = createMysqlPool();
let fixture;
let stack;
let next;
try {
  await assertPortFree(appURL);
  const { startCustomerStack } = await import('../scripts/customer-runtime.js');
  fixture = await createCustomerFixtures(pool);
  stack = await startCustomerStack({ env: { ...process.env, NODE_ENV: 'test' }, ports: { gateway: 4100, auth: 4101, user: 4102, catalog: 4103, order: 4104, staff: 4105, payment: 4106, review: 4107 }, configOverrides: { origin: appURL, defaultBranchId: fixture.branchId } });
  // The browser/Next processes have no reason to inherit database credentials.
  const clientEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(DB_|INTERNAL_|JWT_|AUTH_SERVICE_TOKEN|USER_SERVICE_TOKEN|ORDER_SERVICE_TOKEN|PAYMENT_SERVICE_TOKEN|REVIEW_SERVICE_TOKEN|STAFF_SERVICE_TOKEN|CATALOG_SERVICE_TOKEN)/.test(key)));
  next = spawn(process.execPath, [fileURLToPath(new URL('../../frontend/node_modules/next/dist/bin/next', import.meta.url)), 'dev', '-p', '3001'], { cwd: fileURLToPath(new URL('../../frontend/apps/customer/', import.meta.url)), env: { ...clientEnvironment, NODE_ENV: 'development', NEXT_PUBLIC_API_URL: `${gatewayURL}/api/v1`, NEXT_TELEMETRY_DISABLED: '1' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let startupOutput = '';
  const collect = (chunk) => { startupOutput = (startupOutput + String(chunk)).slice(-12000); };
  next.stdout.on('data', collect);
  next.stderr.on('data', collect);
  try {
    await new Promise((resolve, reject) => { next.once('spawn', resolve); next.once('error', reject); });
    await waitForFrontend(next);
    await runCustomerBrowserFlow({ appURL, gatewayURL, fixture, artifactDirectory: artifacts, env: clientEnvironment });
    process.stdout.write('Customer browser + HTTP + MySQL fixture flow: PASS\n');
  } catch (error) {
    // Next logs contain only synthetic test traffic; never print process.env.
    process.stderr.write(startupOutput);
    throw error;
  }
} catch (error) {
  process.stderr.write(`Customer browser test FAIL: ${error.message}\n`);
  process.exitCode = 1;
} finally {
  await stopChild(next);
  if (stack) await stack.close();
  try { if (fixture) await fixture.cleanup(); }
  finally { await pool.end(); }
}
