import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { parseEnv } from 'node:util'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createPool } from '../../../../../backend/order-service/src/db.js'
import { loadDbConfig } from '../../../../../backend/order-service/src/config.js'
import { createQaData } from '../../../../../backend/order-service/scripts/uc12-qa-data.mjs'
import { testAccounts, loginAccounts } from '../../../../../backend/auth-service/scripts/http-tools.js'
import { backupWithMysqlDump, assertNoConcurrentWriters } from './backup.mjs'
import { startQaRuntime } from './runtime.mjs'
import { createQaBrowser } from './browser.mjs'

// This coordinator is opt-in, retains every committed fixture and never resets data.
const root = fileURLToPath(new URL('../../../../../', import.meta.url))
const artifactDir = path.join(root, 'frontend/apps/staff/.auth-data/qa/uc12-e2e-20261024')
const runId = 'cleanhome-uc12-e2e-20261024-approved'
const approvalRef = 'user-attachment-56ba81a2-c872-4cc4-9a39-3e9f84003433'
const execute = process.argv.includes('--execute')
const createOnly = process.argv.includes('--create-fixtures')
const q01Only = process.argv.includes('--q01-only')
const auditOnly = process.argv.includes('--audit')
if (process.argv.slice(2).some(arg => !['--execute', '--create-fixtures', '--dry-run', '--q01-only', '--audit'].includes(arg))) throw new Error('Unknown QA mode')
if (process.argv.slice(2).filter(arg => ['--execute', '--create-fixtures', '--dry-run', '--audit'].includes(arg)).length > 1
  || (q01Only && !execute)) throw new Error('Select exactly one QA mode; --q01-only requires --execute')
const report = { runId, approvalRef, database: 'cleanhome_staff_test', startedAt: new Date().toISOString(), mode: auditOnly ? 'audit' : execute ? 'execute' : createOnly ? 'create-fixtures' : 'dry-run',
  cases: [], fixtures: [], realFrontendWrites: false, resetPerformed: false, globalWorkerEnabled: false }
const check = (condition, message) => { if (!condition) throw new Error(message) }
const sqlTime = instant => new Date(instant).toISOString().slice(0, 19).replace('T', ' ')
const vnDay = instant => new Date(Date.parse(instant) + 7 * 3600000).toISOString().slice(0, 10)
let data, pool, runtime, browser, manifest, accounts = [], currentCase = 'preflight', failedFixture = null
async function persist() {
  await mkdir(artifactDir, { recursive: true, mode: 0o700 })
  const filename = execute ? 'e2e-report.json' : report.mode + '-report.json'
  await writeFile(path.join(artifactDir, filename), JSON.stringify(report, null, 2), { mode: 0o600 })
}
async function step(name, action, fixture = null) {
  currentCase = name; failedFixture = fixture
  const started = Date.now(), value = await action()
  report.cases.push({ name, fixture, status: 'PASS', durationMs: Date.now() - started, ...(value === undefined ? {} : { evidence: value }) })
  await persist(); console.log(JSON.stringify({ case: name, fixture, status: 'PASS' }))
  return value
}
function fixture(code) { const result = manifest.fixtures.find(item => item.code === code); check(result?.bookingId, 'Fixture is missing from the approved manifest'); return result }
async function state(code) {
  const row = await data.inspectFixture(code)
  return { ...row, a: row.assignments[0], b: row.assignments[1] }
}
function evidence(row) {
  return { code: row.code, bookingId: String(row.booking.id), bookingStatus: row.booking.status,
    assignments: row.assignments.map(a => ({ id: String(a.id), status: a.status, checkInAt: a.check_in_at, checkOutAt: a.check_out_at })),
    journalCount: row.journals.length, acknowledged: row.journals.filter(j => j.staffAcknowledged).length,
    operationIds: row.journals.map(j => j.operation.id) }
}
async function checkpoint(code) {
  const protectedState = await data.assertPreserved(), row = await state(code)
  check(new Set(row.journals.map(j => j.operation.id)).size === row.journals.length, 'Duplicate journal operation detected')
  for (const assignment of row.assignments) {
    const own = row.journals.filter(j => j.operation.assignmentId === String(assignment.id))
    const start = own.find(j => j.operation.toStatus === 'IN_PROGRESS'), done = own.find(j => j.operation.toStatus === 'DONE')
    if (assignment.check_in_at !== null) check(start && sqlTime(start.ack.occurredAt) === assignment.check_in_at, 'Persisted check-in differs from original Order ACK')
    if (assignment.check_out_at !== null) check(done && sqlTime(done.ack.occurredAt) === assignment.check_out_at, 'Persisted check-out differs from original Order ACK')
    if (assignment.check_in_at && assignment.check_out_at) check(assignment.check_out_at >= assignment.check_in_at, 'Check-out is before check-in')
  }
  await writeFile(path.join(artifactDir, code + '-latest.json'), JSON.stringify({ at: new Date().toISOString(), ...evidence(row), preservation: protectedState }, null, 2), { mode: 0o600 })
  return row
}
async function complete(code) {
  const row = await checkpoint(code)
  check(row.booking.status === 'COMPLETED' && row.a.status === 'DONE' && row.b.status === 'DONE', 'Fixture did not reach the legitimate completed state')
  check(row.journals.length === 6 && row.journals.every(j => j.staffAcknowledged), 'Fixture must have exactly six acknowledged journal operations')
  const result = { status: 'PASS', ...evidence(row) }
  await data.recordResult(code, result); report.fixtures.push(result); await persist()
}
async function uiAdvance(code, person, target, expectedBooking, expectedCount, options = {}) {
  const f = fixture(code), id = f.assignmentIds[person === 'A' ? 0 : 1], page = await browser.openEmployee(person)
  await page.openJob(id)
  const before = evidence(await state(code))
  const response = await page.action(target, options)
  check(response.status === 200, 'Real UI transition did not receive a confirmed HTTP 200')
  check(response.requestsSent === 1, 'UI confirmation emitted duplicate requests')
  const current = await page.getStatus(id)
  check(current.status === 200 && current.body.operation?.phase === 'confirmed' && current.body.operation.idempotencyKey === response.key, 'BFF did not retain the exact confirmed operation')
  const row = await checkpoint(code), own = row.assignments.find(a => String(a.id) === id)
  check(own.status === target && row.booking.status === expectedBooking && row.journals.length === expectedCount, 'SQL status or journal count differs from the explicit workflow')
  return { before, after: evidence(row), httpStatus: response.status, idempotencyKey: response.key }
}
async function finishFromAccepted(code) {
  const count = (await state(code)).journals.length
  check(count === 2, 'Finish-from-accepted requires exactly the first two committed operations')
  for (const [person, target, booking, total] of [['A', 'IN_PROGRESS', 'IN_PROGRESS', 3], ['B', 'IN_PROGRESS', 'IN_PROGRESS', 4], ['A', 'DONE', 'IN_PROGRESS', 5], ['B', 'DONE', 'COMPLETED', 6]]) {
    await step(code + ' ' + person + ' ' + target, () => uiAdvance(code, person, target, booking, total), code)
  }
}
async function fresh(code) {
  const row = await checkpoint(code)
  check(row.booking.status === 'CONFIRMED' && row.assignments.every(a => a.status === 'ASSIGNED' && a.check_in_at === null && a.check_out_at === null) && row.journals.length === 0,
    'Fixture already consumed; this runner never resets or repeats a stale initial-state test')
}

try {
  const orderEnv = parseEnv(await readFile(path.join(root, 'backend/order-service/.env'), 'utf8'))
  const db = loadDbConfig(orderEnv)
  check(db.host === '127.0.0.1' && db.port === 3306 && db.database === report.database, 'Database is outside the explicit QA approval')
  pool = createPool({ ...db, connectionLimit: 5 })
  data = createQaData({ pool, artifactDir, approvalRef, runId })
  if (!auditOnly) await step('point-in-time no concurrent database writers', () => assertNoConcurrentWriters(pool))
  manifest = await step('consistent backup and read-only preflight', () => data.preflightAndBackup().then(m => ({ ...m, fixtures: m.fixtures })))
  // Do not put full synthetic address snapshots in the public progress output.
  report.cases.at(-1).evidence = { manifest: path.join(artifactDir, 'manifest.json'), backup: manifest.backup, plannedFixtures: manifest.fixtures.map(f => ({ code: f.code, bookingId: f.bookingId, scheduledStart: f.scheduledStart, scheduledEnd: f.scheduledEnd })) }
  if (!auditOnly) await step('MySQL 9.6 native consistent SQL backup verified', () => backupWithMysqlDump({ db, artifactDir, pool }))
  if (auditOnly) {
    report.preservation = await step('read-only retained fixture audit', () => data.assertPreserved())
    for (const f of manifest.fixtures.filter(f => f.bookingId)) report.fixtures.push(evidence(await checkpoint(f.code)))
  } else if (execute || createOnly) {
    accounts = await testAccounts()
    await step('real RS256 Auth verifies approved A/B/Customer credentials', async () => {
      await loginAccounts('http://127.0.0.1:4001', accounts)
      return { issuer: process.env.JWT_ISSUER, audience: process.env.JWT_AUDIENCE, roles: ['EMPLOYEE', 'EMPLOYEE', 'CUSTOMER'], jwtDisclosed: false }
    })
    await step('pre-insert no concurrent database writers', () => assertNoConcurrentWriters(pool))
    currentCase = 'create exactly the approved fixtures in one transaction'
    manifest = await data.createFixtures({ writeApproved: true })
    await step('exact six retained fixtures created or recovered without duplication', async () => {
      check(manifest.fixtures.length === 6 && manifest.allowlist.assignmentIds.length === 12 && manifest.allowlist.itemIds.length === 6, 'Unexpected fixture write scope')
      return { fixtures: manifest.fixtures.map(f => ({ code: f.code, bookingId: f.bookingId, assignmentIds: f.assignmentIds })), preservation: await data.assertPreserved() }
    })
    if (execute) {
      for (const f of manifest.fixtures) await fresh(f.code)
      const connection = await pool.getConnection(); let readAssignmentIds
      try {
        readAssignmentIds = (await connection.query('SELECT id FROM assignments ORDER BY id'))[0].map(row => String(row.id))
        check(!readAssignmentIds.includes('9223372036854775807'), 'The planned missing-ID probe unexpectedly exists')
        // Read-only negative probe: allow it to reach Staff's real opaque 404.
        // The mutation allowlist remains exactly the twelve created assignments.
        readAssignmentIds.push('9223372036854775807')
      } finally { connection.release() }
      runtime = await startQaRuntime({ repoRoot: root, artifactDir, manifest, orderEnv,
        authEnv: { JWT_ISSUER: process.env.JWT_ISSUER, JWT_AUDIENCE: process.env.JWT_AUDIENCE }, readAssignmentIds })
      report.runtime = runtime.processes(); report.origin = runtime.origin
      browser = createQaBrowser({ origin: runtime.origin, accounts, artifactDir: path.join(artifactDir, 'browser'), manifest })
      const a = await browser.openEmployee('A'), b = await browser.openEmployee('B')
      await step('A and B establish separate real EMPLOYEE browser sessions', async () => { await a.login(); await b.login(); return { A: await a.verifyStorage(), B: await b.verifyStorage() } })
      const f = fixture('Q01')
      await step('Q01 cross-employee updates and skipped transition are rejected before any journal', async () => {
        check((await a.rawPatch(f.assignmentIds[1], 'ACCEPTED', randomUUID())).status === 404, 'A accessed the assignment owned by B')
        check((await b.rawPatch(f.assignmentIds[0], 'ACCEPTED', randomUUID())).status === 404, 'B accessed the assignment owned by A')
        check((await a.rawPatch(f.assignmentIds[0], 'DONE', randomUUID())).status === 409, 'Skipped transition was not refused')
        const missing = await a.getStatus('9223372036854775807'), foreign = await a.getStatus(f.assignmentIds[1])
        check(missing.status === 404 && foreign.status === 404 && missing.body.error.code === foreign.body.error.code, 'Missing/foreign assignment leaked ownership information')
        check((await checkpoint('Q01')).journals.length === 0, 'Rejected requests created a journal')
        return { foreignA: 404, foreignB: 404, skippedStep: 409, missing: 404, journals: 0 }
      }, 'Q01')
      await step('anonymous and CUSTOMER browser sessions cannot update Staff jobs', async () => {
        const anon = await browser.openEmployee('ANONYMOUS'), customer = await browser.openEmployee('CUSTOMER')
        check((await anon.rawPatch(f.assignmentIds[0], 'ACCEPTED', randomUUID())).status === 401, 'Anonymous update was not refused')
        await customer.login({ expectedStatus: 403 })
        await checkpoint('Q01'); return { anonymous: 401, customerLogin: 403 }
      }, 'Q01')
      for (const [person, target, booking, count] of [['A', 'ACCEPTED', 'CONFIRMED', 1], ['B', 'ACCEPTED', 'CONFIRMED', 2], ['A', 'IN_PROGRESS', 'IN_PROGRESS', 3], ['B', 'IN_PROGRESS', 'IN_PROGRESS', 4], ['A', 'DONE', 'IN_PROGRESS', 5], ['B', 'DONE', 'COMPLETED', 6]]) {
        await step('Q01 ' + person + ' ' + target, () => uiAdvance('Q01', person, target, booking, count, { doubleSubmit: person === 'A' && target === 'ACCEPTED' }), 'Q01')
      }
      await complete('Q01'); report.realFrontendWrites = true
      await step('Q01 UC9 UC10 UC11 read the completed fixture from MySQL', async () => {
        for (const [page, index] of [[a, 0], [b, 1]]) {
          const id = f.assignmentIds[index], jobs = await page.readJobs(), detail = await page.readDetail(id)
          check(jobs.status === 200 && jobs.body.data.some(j => j.assignmentId === id && j.databaseStatus === 'DONE'), 'UC9 did not show the completed assignment')
          check(detail.status === 200 && detail.body.data.databaseStatus === 'DONE' && detail.body.data.orderStatus === 'completed', 'UC10 did not show the committed states')
          const range = { from: vnDay(f.scheduledStart), to: vnDay(f.scheduledEnd) }, schedule = await page.readSchedule(range)
          check(schedule.status === 200 && schedule.body.data.some(j => j.assignmentId === id && j.databaseStatus === 'DONE'), 'UC11 did not show the completed assignment')
          await page.openPage('/cong-viec?status=DONE&pageSize=100'); await page.assertVisible({ assignmentId: id })
          await page.openPage('/lich-lam-viec?' + new URLSearchParams({ ...range, view: 'list' })); await page.assertVisible({ assignmentId: id, area: 'schedule' })
        }
        await a.openJob(f.assignmentIds[0]); for (const width of [375, 390, 768, 1440]) await a.screenshot('Q01-completed-' + width + '.png', width)
        return { areas: ['UC9', 'UC10', 'UC11'], widths: [375, 390, 768, 1440] }
      }, 'Q01')
      if (!q01Only) {
        const q2 = fixture('Q02')
        await step('Q02 concurrent A/B duplicate same-key requests are idempotent', async () => {
          for (const target of ['ACCEPTED', 'IN_PROGRESS', 'DONE']) {
            const keys = [randomUUID(), randomUUID()], requests = []
            for (const [page, index] of [[a, 0], [b, 1]]) for (let retry = 0; retry < 2; retry++) requests.push(page.rawPatch(q2.assignmentIds[index], target, keys[index]))
            const replies = await Promise.all(requests); check(replies.every(r => r.status === 200), 'Concurrent duplicate operation did not confirm')
            if (target === 'DONE') {
              const snapshots = new Map(replies.map(r => [r.bodySafe.data.transition.operationId, r.bodySafe.data.orderAtTransition.status]))
              check(snapshots.size === 2 && new Set(snapshots.values()).has('IN_PROGRESS') && new Set(snapshots.values()).has('COMPLETED'), 'Concurrent completion did not retain one partial and one fully completed Order acknowledgement')
            }
            const row = await checkpoint('Q02'), count = ['ACCEPTED', 'IN_PROGRESS', 'DONE'].indexOf(target) * 2 + 2
            check(row.journals.length === count, 'Duplicate concurrent request created extra journal operations')
            check(row.booking.status === (target === 'DONE' ? 'COMPLETED' : target === 'IN_PROGRESS' ? 'IN_PROGRESS' : 'CONFIRMED'), 'Concurrent aggregate booking state is wrong')
            if (target === 'ACCEPTED') {
              const conflict = await a.rawPatch(q2.assignmentIds[0], 'IN_PROGRESS', keys[0])
              check(conflict.status === 409, 'Same key with different payload was not rejected')
              check((await checkpoint('Q02')).journals.length === 2, 'Conflicting payload created an operation')
            }
          }
          return evidence(await checkpoint('Q02'))
        }, 'Q02'); await complete('Q02')

        const q3 = fixture('Q03')
        await step('Q03 Order unavailable before commit retains the operation key', async () => {
          await a.openJob(q3.assignmentIds[0]); runtime.orderRelay.arm({ kind: 'offlineBeforeForward', bookingId: q3.bookingId, count: 'untilClear' })
          const first = await a.action('ACCEPTED'), failed = await checkpoint('Q03'), op = await a.getStatus()
          check(first.status >= 500 && failed.a.status === 'ASSIGNED' && failed.journals.length === 0 && op.body.operation?.phase === 'unknown', 'Pre-commit failure was not retained as unknown without a DB write')
          runtime.orderRelay.clear(); const retry = await a.action('ACCEPTED', { retry: true })
          check(retry.status === 200 && retry.key === first.key, 'Order recovery changed the operation key')
          const row = await checkpoint('Q03'); check(row.a.status === 'ACCEPTED' && row.journals.length === 1, 'Order recovery did not apply exactly once')
          return { initialHttp: first.status, retryHttp: retry.status, sameKey: true, ...evidence(row) }
        }, 'Q03')
        await step('Q03 B ACCEPTED', () => uiAdvance('Q03', 'B', 'ACCEPTED', 'CONFIRMED', 2), 'Q03'); await finishFromAccepted('Q03'); await complete('Q03')

        const q4 = fixture('Q04')
        await step('Q04 A ACCEPTED', () => uiAdvance('Q04', 'A', 'ACCEPTED', 'CONFIRMED', 1), 'Q04')
        await step('Q04 B ACCEPTED', () => uiAdvance('Q04', 'B', 'ACCEPTED', 'CONFIRMED', 2), 'Q04')
        await step('Q04 Order commit with lost response recovers original ACK without a duplicate', async () => {
          await a.openJob(q4.assignmentIds[0]); runtime.orderRelay.arm({ kind: 'dropPutResponseAfterCommit', assignmentId: q4.assignmentIds[0], targetStatus: 'IN_PROGRESS' })
          const first = await a.action('IN_PROGRESS'), partial = await checkpoint('Q04')
          check(first.status >= 500 && partial.a.status === 'ACCEPTED' && partial.a.check_in_at === null && partial.booking.status === 'IN_PROGRESS' && partial.journals.length === 3, 'Post-Order-commit fault did not produce the expected recoverable split state')
          const original = partial.journals.find(j => j.operation.assignmentId === q4.assignmentIds[0] && j.operation.toStatus === 'IN_PROGRESS')
          check(original && !original.staffAcknowledged, 'Lost Order response did not retain a pending journal')
          runtime.orderRelay.clear(); const retry = await a.action('IN_PROGRESS', { retry: true }), row = await checkpoint('Q04')
          check(retry.status === 200 && retry.key === first.key && row.journals.length === 3 && row.a.check_in_at === sqlTime(original.ack.occurredAt), 'Retry did not preserve the original journal/time/key')
          return { partial: evidence(partial), recovered: evidence(row), sameKey: true }
        }, 'Q04')
        for (const [person, target, booking, count] of [['B', 'IN_PROGRESS', 'IN_PROGRESS', 4], ['A', 'DONE', 'IN_PROGRESS', 5], ['B', 'DONE', 'COMPLETED', 6]]) await step('Q04 ' + person + ' ' + target, () => uiAdvance('Q04', person, target, booking, count), 'Q04')
        await complete('Q04')

        const q5 = fixture('Q05')
        for (const [person, index, kind] of [['A', 0, 'dropAckBeforeForward'], ['B', 1, 'dropAckResponseAfterCommit']]) {
          await step('Q05 ' + person + ' ' + kind + ' returns pending until explicit confirmation', async () => {
            const page = person === 'A' ? a : b; await page.openJob(q5.assignmentIds[index])
            runtime.orderRelay.arm({ kind, assignmentId: q5.assignmentIds[index], targetStatus: 'ACCEPTED' })
            const first = await page.action('ACCEPTED'), partial = await checkpoint('Q05'), observed = await page.getStatus()
            check(first.status === 202 && observed.body.operation?.phase === 'pending' && observed.body.allowedStatus === null, 'A pending ACK was incorrectly shown as a confirmed/new-step state')
            const own = partial.journals.find(j => j.operation.assignmentId === q5.assignmentIds[index])
            check(own && own.staffAcknowledged === (kind === 'dropAckResponseAfterCommit'), 'Before/after ACK fault points were not distinguished')
            runtime.orderRelay.clear(); const retry = await page.action('ACCEPTED', { retry: true }), row = await checkpoint('Q05')
            check(retry.status === 200 && retry.key === first.key && row.journals.length === index + 1, 'ACK retry changed the key or inserted another journal')
            return { initialHttp: 202, retryHttp: 200, acknowledgedBeforeRetry: own.staffAcknowledged, sameKey: true, ...evidence(row) }
          }, 'Q05')
        }
        await finishFromAccepted('Q05'); await complete('Q05')

        const q6 = fixture('Q06')
        await step('Q06 lost Staff response preserves unknown context across reload/relogin', async () => {
          await a.openJob(q6.assignmentIds[0]); runtime.staffRelay.arm({ kind: 'dropStaffResponseAfterCommit', assignmentId: q6.assignmentIds[0], targetStatus: 'ACCEPTED' })
          const first = await a.action('ACCEPTED'), committed = await checkpoint('Q06')
          check(first.status >= 500 && committed.a.status === 'ACCEPTED' && committed.journals.length === 1 && committed.journals[0].staffAcknowledged, 'The dropped Staff response did not follow a real committed operation')
          runtime.staffRelay.clear(); const patches = a.requests().length
          await a.reload(); await a.logout(); await a.login(); await a.openJob(q6.assignmentIds[0]); const recovered = await a.getStatus()
          check(a.requests().length === patches && recovered.body.operation?.idempotencyKey === first.key && recovered.body.operation.phase === 'unknown', 'Reload/relogin lost the exact unknown key or automatically retried')
          const retry = await a.action('ACCEPTED', { retry: true }); check(retry.status === 200 && retry.key === first.key, 'Post-relogin retry changed the key')
          check((await checkpoint('Q06')).journals.length === 1, 'Post-relogin retry created a duplicate journal')
          return { initialHttp: first.status, retryHttp: 200, sameKey: true, autoPatchOnReload: false }
        }, 'Q06')
        await step('Q06 browser loses the real BFF 200; reload recovers the durable confirmed receipt', async () => {
          await b.openJob(q6.assignmentIds[1]); b.dropNextStatusResponseAfterCommit(q6.assignmentIds[1])
          const first = await b.action('ACCEPTED'), row = await checkpoint('Q06'), patches = b.requests().length
          check(first.networkFailure && row.b.status === 'ACCEPTED' && row.journals.length === 2 && row.journals.every(j => j.staffAcknowledged), 'Browser fault did not happen after the real BFF/backend commit')
          await b.reload(); await b.logout(); await b.login(); await b.openJob(q6.assignmentIds[1]); const recovered = await b.getStatus()
          check(b.requests().length === patches && recovered.body.operation?.phase === 'confirmed' && recovered.body.operation.idempotencyKey === first.key, 'Browser response loss did not recover the original confirmed receipt without another PATCH')
          return { sameKey: true, recoveredPhase: 'confirmed', autoPatchOnReload: false, ...evidence(row) }
        }, 'Q06')
        await finishFromAccepted('Q06'); await complete('Q06')
      }
      await step('final browser sessions keep credentials server-side', async () => ({ A: await a.verifyStorage(), B: await b.verifyStorage() }))
      report.relayEvidence = { order: runtime.orderRelay.events(), staff: runtime.staffRelay.events() }
      report.preservation = await step('final outside-allowlist and immutable-data verification', () => data.assertPreserved())
    }
  } else {
    report.fixtureWrites = 'NOT_RUN'; report.e2eWrites = 'NOT_RUN'
  }
  report.status = 'PASS'
} catch (error) {
  report.status = 'FAIL'; report.cases.push({ name: currentCase, fixture: failedFixture, status: 'FAIL', error: String(error.message).replace(/[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g, '[REDACTED]') })
  for (const account of accounts) if (account.password) report.cases.at(-1).error = report.cases.at(-1).error.split(account.password).join('[REDACTED]')
  if (data && failedFixture) try { await data.recordResult(failedFixture, { status: 'FAIL', test: currentCase, error: report.cases.at(-1).error }) } catch {}
  if (data) try { report.preservation = await data.assertPreserved() } catch { report.preservation = { outsideAllowlistUnchanged: false, action: 'Stopped all remaining mutations; no reset or restoration performed' } }
  console.log(JSON.stringify({ status: 'FAIL', case: currentCase, fixture: failedFixture, error: report.cases.at(-1).error })); process.exitCode = 1
} finally {
  if (browser) try { report.browser = await browser.close() } catch { report.browserCleanup = 'FAIL' }
  if (runtime) try { await runtime.close(); report.ownedRuntimeClosed = true } catch { report.ownedRuntimeClosed = false }
  if (data) await data.close().catch(() => {})
  if (pool) await pool.end().catch(() => {})
  report.finishedAt = new Date().toISOString(); report.pass = report.cases.filter(c => c.status === 'PASS').length; report.fail = report.cases.filter(c => c.status === 'FAIL').length
  await persist(); console.log(JSON.stringify({ status: report.status, mode: report.mode, pass: report.pass, fail: report.fail,
    completedFixtures: report.fixtures.filter(f => f.bookingStatus === 'COMPLETED').map(f => f.code),
    report: path.join(artifactDir, execute ? 'e2e-report.json' : report.mode + '-report.json') }))
}
