import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import { createFixture, appendFixtureOperation } from './fixtures.js'
import { createPool } from '../src/db.js'
import { loadConfig, readServiceToken } from '../src/config.js'
import { MysqlOrderRepository } from '../src/repository.js'
import { OrderClient } from '../../staff-service/src/order-client.js'
import { runtime as staffRuntime } from '../../staff-service/src/runtime.js'

async function unusedPort() {
  const server = createServer().listen(0, '127.0.0.1')
  await once(server, 'listening'); const port = server.address().port
  await new Promise(resolve => server.close(resolve)); return port
}
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  const closed = once(child, 'close')
  // Only the process created by this test is terminated. Its committed journal
  // stays in MySQL; no SQL reset or cleanup follows the simulated interruption.
  child.kill('SIGKILL')
  let timer
  try { await Promise.race([closed, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Owned Order test process did not stop')), 5000) })]) }
  finally { clearTimeout(timer) }
}
async function start(env, base) {
  const childEnv = { ...env }; delete childEnv.NODE_TEST_CONTEXT
  const child = spawn(process.execPath, ['--env-file-if-exists=.env', 'src/server.js'], { cwd: fileURLToPath(new URL('../', import.meta.url)), env: childEnv, stdio: 'ignore' })
  let failed = false
  child.on('error', () => { failed = true })
  for (let i = 0; i < 30; i++) {
    if (failed || child.exitCode !== null) break
    try { const result = await fetch(base + '/health/ready', { signal: AbortSignal.timeout(400) }); if (result.status === 200) return child } catch {}
    await delay(100)
  }
  await stop(child)
  throw new Error('Owned Order server did not become ready; configuration details withheld')
}

test('real Order process interruption and durable pending recovery by the unchanged Staff worker', {
  skip: process.env.RUN_ORDER_RECOVERY_TESTS === 'true' ? false : 'Set RUN_ORDER_RECOVERY_TESTS=true with explicit fixture writes on the verified test database', timeout: 60000,
}, async t => {
  assert.equal(process.env.MYSQL_DATABASE, 'cleanhome_staff_test')
  assert.equal(process.env.ORDER_TEST_ALLOW_FIXTURE_WRITES, 'true')
  const config = loadConfig(), token = await readServiceToken(config.credential), pool = createPool(config.db), repository = new MysqlOrderRepository(pool)
  let child, worker
  t.after(async () => { try { await stop(child) } finally { try { await worker?.pool.end() } finally { await pool.end() } } })
  await repository.assertSchema()
  const fixture = await createFixture(pool, { label: 'order-process-restart-recovery' })
  const port = await unusedPort(), base = 'http://127.0.0.1:' + port
  const env = { ...process.env, HOST: '127.0.0.1', PORT: String(port), ORDER_SERVICE_TOKEN: token, ORDER_SERVICE_TOKEN_FILE: '' }
  child = await start(env, base)
  const client = new OrderClient({ baseUrl: base, token, timeoutMs: 4000 })
  const key = randomUUID(), operation = { id: createHash('sha256').update(JSON.stringify([fixture.actorUserIds[0], fixture.assignmentIds[0], key])).digest('hex'), bookingId: fixture.bookingId, assignmentId: fixture.assignmentIds[0], employeeId: fixture.employeeIds[0], actorUserId: fixture.actorUserIds[0], fromStatus: 'ASSIGNED', toStatus: 'ACCEPTED' }
  const sql = (query, values = []) => repository.connection(async c => (await c.execute(query, values))[0])
  let originalAck
  await t.test('Order commits a real operation while Staff assignment remains unchanged', async () => {
    originalAck = await client.applyAssignmentTransition(operation)
    await appendFixtureOperation(fixture, operation)
    assert.equal(originalAck.assignmentStatus, 'ACCEPTED')
    assert.equal((await sql('SELECT status FROM assignments WHERE id=?', [operation.assignmentId]))[0].status, 'ASSIGNED')
    await assert.rejects(client.ackAssignmentTransition(operation), error => error.status === 409 && error.code === 'ORDER_REJECTED')
  })
  assert.ok(originalAck, 'A durable real operation is required before process interruption')
  await t.test('only the owned Order process is stopped; a real request observes the outage', async () => {
    await stop(child)
    await assert.rejects(client.getAssignmentTransition(operation), error => error.status === 503 && error.code === 'ORDER_UNAVAILABLE')
  })
  await t.test('a fresh Order process returns the exact original acknowledgement without a duplicate', async () => {
    child = await start(env, base)
    assert.deepEqual(await client.getAssignmentTransition(operation), originalAck)
    assert.deepEqual(await client.applyAssignmentTransition(operation), originalAck)
    const rows = await sql('SELECT note FROM booking_status_history WHERE booking_id=?', [fixture.bookingId])
    assert.equal(rows.length, 1); assert.equal(JSON.parse(rows[0].note).staffAcknowledged, false)
  })
  await t.test('real pending journal is consumed by the existing Staff worker and acknowledged after its commit', async () => {
    // The worker must not process any original/user operation as an incidental
    // cleanup. Every queued operation must belong to a labelled Order QA fixture.
    const pending = await client.listPendingTransitions({ limit: 100 })
    assert.ok(pending.some(value => value.id === operation.id)); assert.ok(pending.length < 100)
    const manifest = JSON.parse(await readFile(new URL('../secrets/mysql-qa-manifest.json', import.meta.url), 'utf8'))
    const allowed = new Set(manifest.fixtures.map(value => value.bookingId))
    assert.ok(pending.every(value => allowed.has(value.bookingId)), 'Pending contains an operation outside the retained QA fixtures')
    worker = staffRuntime({ ...process.env, PORT: '4005', CORS_ORIGINS: 'http://localhost:3002', JWT_ALGORITHM: 'RS256', JWT_ISSUER: process.env.JWT_ISSUER || 'http://localhost:4001', JWT_AUDIENCE: process.env.JWT_AUDIENCE || 'cleanhome-staff-api', JWT_JWKS_URL: 'http://127.0.0.1:4001/.well-known/jwks.json', JWT_PUBLIC_KEY: '', JWT_SECRET: '', ORDER_SERVICE_URL: base, ORDER_SERVICE_TOKEN: token, RECONCILIATION_WORKER_ENABLED: 'false' })
    const outcomes = await worker.service.reconcile(100)
    assert.ok(outcomes.some(value => value.operationId === operation.id && value.synchronized === true))
    assert.ok(outcomes.every(value => value.synchronized === true), 'A labelled QA operation was not reconciled')
    const [saved] = await sql('SELECT status FROM assignments WHERE id=?', [operation.assignmentId])
    assert.equal(saved.status, 'ACCEPTED')
    assert.equal(JSON.parse((await sql('SELECT note FROM booking_status_history WHERE booking_id=?', [fixture.bookingId]))[0].note).staffAcknowledged, true)
  })
  await t.test('repeated worker pass and request retry do not add history or rewind state', async () => {
    const before = await sql('SELECT id,note FROM booking_status_history WHERE booking_id=? ORDER BY id', [fixture.bookingId])
    assert.deepEqual(await worker.service.reconcile(100), [])
    assert.deepEqual(await client.getAssignmentTransition(operation), originalAck)
    assert.deepEqual(await client.applyAssignmentTransition(operation), originalAck)
    await client.ackAssignmentTransition(operation)
    assert.deepEqual(await sql('SELECT id,note FROM booking_status_history WHERE booking_id=? ORDER BY id', [fixture.bookingId]), before)
  })
})
