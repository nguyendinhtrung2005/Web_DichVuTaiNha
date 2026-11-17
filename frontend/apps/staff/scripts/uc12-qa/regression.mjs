import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'
import { loadDbConfig } from '../../../../../backend/order-service/src/config.js'
import { createPool } from '../../../../../backend/order-service/src/db.js'
import { canonicalQaJson, createQaData } from '../../../../../backend/order-service/scripts/uc12-qa-data.mjs'
import { testAccounts } from '../../../../../backend/auth-service/scripts/http-tools.js'
import { startQaRuntime } from './runtime.mjs'

// Read-only database regression. The imported fixture helper is used only for
// manifest/backup verification and preservation; createFixtures is never called.
const repoRoot = fileURLToPath(new URL('../../../../../', import.meta.url))
const staffDirectory = path.join(repoRoot, 'frontend/apps/staff')
const artifactDir = path.join(staffDirectory, '.auth-data/qa/uc12-e2e-20261024')
const runId = 'cleanhome-uc12-e2e-20261024-approved'
const approvalRef = 'user-attachment-56ba81a2-c872-4cc4-9a39-3e9f84003433'
const browserRequested = process.argv.includes('--browser')
if (process.argv.slice(2).some(arg => arg !== '--browser')) throw new Error('Unknown read-only regression option')
const OS_NAMES = ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'ComSpec', 'COMSPEC', 'TEMP', 'TMP', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'PATHEXT', 'WINDIR']
const TABLES = ['bookings', 'booking_items', 'assignments', 'booking_status_history']
const report = { kind: 'cleanhome.uc12-readonly-regression', version: 1, runId, startedAt: new Date().toISOString(), database: 'cleanhome_staff_test',
  databaseWrites: false, browserRequested, checks: [], status: 'RUNNING' }
const hash = value => createHash('sha256').update(canonicalQaJson(value)).digest('hex')
const assert = (value, message) => { if (!value) throw new Error(message) }
let pool, data, runtime, accounts = [], runningChild
const reportPath = path.join(artifactDir, browserRequested ? 'readonly-regression-browser-report.json' : 'readonly-regression-report.json')
async function save() { await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 }) }
function scrub(text) {
  let safe = String(text)
  for (const account of accounts) if (account.password) safe = safe.split(account.password).join('[REDACTED]')
  return safe.replace(/[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g, '[REDACTED_TOKEN]')
}
async function snapshot() {
  const c = await pool.getConnection()
  try {
    await c.query("SET SESSION time_zone = '+00:00'")
    await c.query('SET TRANSACTION READ ONLY'); await c.query('START TRANSACTION WITH CONSISTENT SNAPSHOT')
    const result = {}
    for (const table of TABLES) {
      const [rows] = await c.query('SELECT * FROM ' + table + ' ORDER BY id')
      result[table] = { count: rows.length, sha256: hash(rows) }
    }
    await c.rollback(); return result
  } catch (error) { await c.rollback().catch(() => {}); throw error }
  finally { c.release() }
}
async function metadata() {
  const c = await pool.getConnection()
  try {
    await c.query("SET SESSION time_zone = '+00:00'")
    const [rows] = await c.query(`SELECT CAST(a.id AS CHAR) assignmentId, CAST(a.booking_id AS CHAR) orderId,
      CAST(e.user_id AS CHAR) userId, a.status databaseStatus, b.scheduled_start scheduledAt, b.scheduled_end expectedEndAt
      FROM assignments a JOIN employees e ON e.id=a.employee_id JOIN bookings b ON b.id=a.booking_id ORDER BY a.id`)
    const iso = value => new Date(String(value).replace(' ', 'T') + 'Z').toISOString()
    return rows.map(row => ({ assignmentId: row.assignmentId, orderId: row.orderId, userId: row.userId,
      databaseStatus: row.databaseStatus, scheduledAt: iso(row.scheduledAt), expectedEndAt: iso(row.expectedEndAt) }))
  } finally { c.release() }
}
function totals(output) {
  const value = {}
  for (const name of ['tests', 'pass', 'fail', 'skipped', 'cancelled']) {
    const found = [...output.matchAll(new RegExp('(?:^|\\n)[^\\n]*\\b' + name + '\\s+(\\d+)\\s*(?=\\n|$)', 'g'))].at(-1)
    value[name] = found ? Number(found[1]) : null
  }
  return value
}
async function child(args, cwd, env, timeoutMs, artifactName) {
  const processChild = spawn(process.execPath, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  runningChild = processChild
  let stdout = '', stderr = '', timedOut = false, oversized = false
  processChild.stdout.on('data', bytes => { stdout += bytes; if (stdout.length > 8 * 1024 * 1024) { oversized = true; processChild.kill() } })
  processChild.stderr.on('data', bytes => { stderr += bytes; if (stderr.length > 1024 * 1024) { oversized = true; processChild.kill() } })
  const timer = setTimeout(() => { timedOut = true; processChild.kill() }, timeoutMs)
  const code = await new Promise((resolve, reject) => {
    processChild.once('error', () => reject(new Error('Read-only regression child could not start; details withheld')))
    processChild.once('close', resolve)
  }).finally(() => { clearTimeout(timer); runningChild = null })
  const safe = scrub(stdout), leaked = safe !== stdout || scrub(stderr) !== stderr
  await writeFile(path.join(artifactDir, artifactName), safe, { mode: 0o600 })
  assert(!timedOut && !oversized, 'Read-only regression exceeded its finite time/output budget')
  assert(!leaked, 'A regression subprocess emitted a secret-shaped value; artifact contents were redacted')
  return { code, stdout: safe, stderrBytes: Buffer.byteLength(stderr) }
}
async function checked(name, operation) {
  const evidence = await operation()
  report.checks.push({ name, status: 'PASS', evidence }); await save()
  console.log(JSON.stringify({ check: name, status: 'PASS', evidence }))
  return evidence
}
try {
  await mkdir(artifactDir, { recursive: true, mode: 0o700 })
  const orderEnv = parseEnv(await readFile(path.join(repoRoot, 'backend/order-service/.env'), 'utf8'))
  const db = loadDbConfig(orderEnv)
  assert(db.host === '127.0.0.1' && db.port === 3306 && db.database === report.database, 'Read-only regression refused a non-approved database')
  pool = createPool({ ...db, connectionLimit: 5 })
  data = createQaData({ pool, artifactDir, runId, approvalRef })
  const manifest = await data.preflightAndBackup()
  assert(manifest.fixtures.every(f => f.bookingId && f.results.some(result => result.status === 'PASS')), 'All six retained fixtures must already have passed before regression')
  report.before = await snapshot()
  await checked('existing fixture allowlist and immutable baseline remain preserved', () => data.assertPreserved())
  const rows = await metadata(), people = ['9109002', '9109101']
  report.metadata = { assignments: rows.length, employees: Object.fromEntries(people.map(id => [id, rows.filter(row => row.userId === id).length])) }
  assert(rows.length === report.before.assignments.count && people.every(id => rows.some(row => row.userId === id)), 'Current metadata is not a full A/B assignment baseline')
  const metadataFile = path.join(staffDirectory, '.auth-data/qa/uc11/metadata-uc12-final.json')
  await mkdir(path.dirname(metadataFile), { recursive: true, mode: 0o700 })
  const payload = { database: report.database, assignments: rows }
  try {
    const existing = JSON.parse(await readFile(metadataFile, 'utf8'))
    assert(hash(existing) === hash(payload), 'Final regression metadata already exists for different data; do not overwrite it')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    await writeFile(metadataFile, JSON.stringify(payload, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  }
  accounts = await testAccounts()
  const env = Object.fromEntries(OS_NAMES.filter(key => typeof process.env[key] === 'string').map(key => [key, process.env[key]]))
  runtime = await startQaRuntime({ repoRoot, artifactDir, manifest, orderEnv,
    authEnv: { JWT_ISSUER: process.env.JWT_ISSUER, JWT_AUDIENCE: process.env.JWT_AUDIENCE }, readAssignmentIds: [...rows.map(row => row.assignmentId), '9223372036854775807'] })
  report.runtime = runtime.processes(); report.origin = runtime.origin
  env.STAFF_BFF_TEST_BASE_URL = runtime.origin
  env.STAFF_UC11_TEST_METADATA_FILE = metadataFile
  for (const flag of ['RUN_STAFF_BFF_HTTP_TESTS', 'RUN_STAFF_UC9_HTTP_TESTS', 'RUN_STAFF_UC10_HTTP_TESTS', 'RUN_STAFF_UC11_HTTP_TESTS', 'RUN_STAFF_UC12_HTTP_TESTS']) env[flag] = 'true'
  for (const account of accounts) {
    env['STAFF_BFF_TEST_PHONE_' + account.label] = account.phone
    env['STAFF_BFF_TEST_PASSWORD_' + account.label] = account.password
    env['STAFF_BFF_TEST_USER_ID_' + account.label] = account.userId
    if (['A', 'B'].includes(account.label)) {
      const ids = rows.filter(row => row.userId === account.userId).map(row => row.assignmentId).join(',')
      for (const uc of ['UC9', 'UC10', 'UC12']) env['STAFF_' + uc + '_TEST_ASSIGNMENT_IDS_' + account.label] = ids
      env['STAFF_UC9_EXPECTED_ASSIGNMENT_IDS_' + account.label] = ids
    }
  }
  report.http = await checked('real Auth and UC9-UC12 HTTP read-only regression', async () => {
    const names = ['auth-http.integration.test.mjs', 'jobs-http.integration.test.mjs', 'job-detail-http.integration.test.mjs', 'schedule-http.integration.test.mjs', 'status-http.integration.test.mjs']
    const result = await child(['--test', '--test-concurrency=1', ...names.map(name => 'test/' + name)], staffDirectory, env, 240000, 'http-regression.tap')
    const summary = totals(result.stdout)
    assert(result.code === 0 && summary.fail === 0 && summary.cancelled === 0 && Number.isInteger(summary.pass), 'HTTP regression failed; inspect the private redacted TAP artifact')
    return { ...summary, suites: names, artifact: 'http-regression.tap', stderrBytes: result.stderrBytes }
  })
  if (browserRequested) {
    report.browser = await checked('original UC9 Chrome browser regression with refreshed complete ownership metadata', async () => {
      const cwd = path.join(artifactDir, 'uc9-browser-workspace')
      await mkdir(cwd, { recursive: true, mode: 0o700 })
      env.RUN_STAFF_UC9_BROWSER_TESTS = 'true'; env.STAFF_UC9_BROWSER_SCENARIO = 'regular'
      const result = await child([path.join(staffDirectory, 'test/jobs-browser.integration.mjs')], cwd, env, 270000, 'uc9-browser-regression.txt')
      const browserReportFile = path.join(cwd, '.auth-data/qa/uc9/browser/report.json')
      const browserReport = JSON.parse(await readFile(browserReportFile, 'utf8'))
      assert(result.code === 0 && browserReport.fail === 0 && browserReport.profileClosed === true, 'Original UC9 browser regression failed; private artifacts retained')
      await writeFile(path.join(artifactDir, 'uc9-browser-regression-report.json'), JSON.stringify(browserReport, null, 2) + '\n', { mode: 0o600 })
      return { pass: browserReport.pass, fail: browserReport.fail, skip: browserReport.skip, exceptions: browserReport.exceptions,
        profileClosed: browserReport.profileClosed, screenshots: browserReport.screenshots, artifact: 'uc9-browser-regression-report.json' }
    })
  } else report.browser = { status: 'NOT_RUN', reason: 'Use --browser only when Chrome launch is permitted; HTTP and database preservation still run' }
  report.after = await snapshot()
  await checked('all columns in all four tables are unchanged by read-only regression', async () => {
    assert(hash(report.before) === hash(report.after), 'DATABASE_CHANGED_DURING_READ_ONLY_REGRESSION')
    return { unchanged: true, tables: report.after, protectedBookingIds: ['9109131', '9109141'] }
  })
  report.preservation = await data.assertPreserved(); report.status = 'PASS'
} catch (error) {
  report.status = 'FAIL'; report.error = scrub(error.message)
  if (data) try { report.preservation = await data.assertPreserved() } catch { report.preservation = { outsideAllowlistUnchanged: false } }
  console.log(JSON.stringify({ status: 'FAIL', error: report.error })); process.exitCode = 1
} finally {
  if (runningChild && runningChild.exitCode === null) runningChild.kill()
  if (runtime) try { await runtime.close(); report.ownedRuntimeClosed = true } catch { report.ownedRuntimeClosed = false; report.status = 'FAIL'; process.exitCode = 1 }
  if (data) await data.close().catch(() => {})
  if (pool) await pool.end().catch(() => {})
  report.finishedAt = new Date().toISOString(); await save()
  console.log(JSON.stringify({ status: report.status, http: report.http && { pass: report.http.pass, fail: report.http.fail, skip: report.http.skipped },
    browser: report.browser, metadata: report.metadata, ownedRuntimeClosed: report.ownedRuntimeClosed, report: reportPath }))
}
