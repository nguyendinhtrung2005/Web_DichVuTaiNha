import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { assertPrivatePath, loadConfig, mysql, privateDirectory, verifyDatabase, writeJson } from './common.mjs'

// Real loopback HTTP and SQL SELECTs only. No seed, migration, branch edit or
// business mutation. Credentials and opaque session IDs never enter the report.
if (process.env.RUN_STAFF_ISOLATED_MAPS_ISOLATION !== 'true') {
  console.log(JSON.stringify({ status: 'NOT_RUN', reason: 'Explicit opt-in required' }))
  process.exit(0)
}

class CheckError extends Error { constructor(code, blocked = false) { super(code); this.blocked = blocked } }
const check = (condition, code) => { if (!condition) throw new CheckError(code) }
const report = { layer: 'real isolated Staff BFF + read-only MySQL branch/account isolation', mockedResponses: false, checks: [], businessGetRequests: 0, authPostRequests: 0, businessMutations: 0 }
const sessions = new Set(), branchSql = {}, accounts = {}
let config, connection, failedAt = 'configuration', reportFile

async function step(name, operation) {
  failedAt = name
  try {
    const metadata = await operation()
    report.checks.push({ name, status: 'REAL_PASS', ...(metadata ? { metadata } : {}) })
    console.log(JSON.stringify({ name, status: 'REAL_PASS' }))
  } catch (error) {
    report.checks.push({ name, status: error instanceof CheckError && !error.blocked ? 'FAIL' : 'BLOCKED' })
    throw error
  }
}

function noCredentialLeak(value) {
  const text = JSON.stringify(value)
  check(!/"(?:accessToken|refreshToken|password|passwordHash|password_hash|tokenType)"\s*:/i.test(text), 'CREDENTIAL_FIELD_EXPOSED')
  check(!/[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/.test(text), 'JWT_EXPOSED')
  for (const account of Object.values(config.accounts)) if (typeof account.password === 'string' && account.password.length > 5) check(!text.includes(account.password), 'QA_PASSWORD_EXPOSED')
}

async function request(path, { method = 'GET', body, cookie, accountId } = {}) {
  const url = new URL(path, config.frontendOrigin)
  check(url.origin === config.frontendOrigin, 'LOOPBACK_BFF_ORIGIN_REQUIRED')
  const business = ['/api/staff/branch', '/api/staff/availability'].includes(url.pathname)
  const authRead = url.pathname === '/api/auth/session'
  const authWrite = ['/api/auth/login', '/api/auth/logout'].includes(url.pathname)
  check((method === 'GET' && (business || authRead)) || (method === 'POST' && authWrite && !url.search), 'QA_REQUEST_OUTSIDE_READONLY_SCOPE')
  check(method !== 'POST' || (body !== null && typeof body === 'object'), 'QA_AUTH_JSON_BODY_REQUIRED')
  if (business) report.businessGetRequests++
  if (method === 'POST') report.authPostRequests++
  let response, data
  try {
    response = await fetch(url, { method, redirect: 'error', signal: AbortSignal.timeout(30000), cache: 'no-store',
      headers: { Accept: 'application/json', Origin: config.frontendOrigin,
        ...(cookie ? { Cookie: cookie } : {}), ...(accountId ? { 'X-Staff-Account-Id': accountId } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    check(response.headers.get('content-type')?.includes('application/json'), 'BFF_EXPECTED_JSON')
    const reader = response.body.getReader(), chunks = []
    let size = 0
    try {
      for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; check(size <= 1048576, 'BFF_RESPONSE_TOO_LARGE'); chunks.push(part.value) }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
    data = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch (error) { if (error instanceof CheckError) throw error; throw new CheckError('BFF_UNREACHABLE_OR_INVALID_RESPONSE', true) }
  noCredentialLeak(data)
  check(/no-store/.test(response.headers.get('cache-control') || ''), 'BFF_RESPONSE_MUST_NOT_BE_CACHEABLE')
  return { status: response.status, data, headers: response.headers }
}

function expect(response, status, code) {
  check(response.status === status, 'HTTP_EXPECTED_' + status + '_GOT_' + response.status)
  if (code) check(response.data?.error?.code === code, 'UNEXPECTED_BFF_ERROR_CODE')
  if (status >= 400) check(!Object.hasOwn(response.data, 'data'), 'ERROR_EXPOSED_BRANCH_DATA')
}

async function login(label) {
  const account = config.accounts[label]
  const response = await request('/api/auth/login', { method: 'POST', body: { phone: account.phone, password: account.password } })
  expect(response, 200)
  check(response.data?.session?.user?.id === account.userId && response.data.session.user.role === 'EMPLOYEE', 'LOGIN_ACCOUNT_MISMATCH')
  const header = response.headers.getSetCookie().find(value => value.startsWith('cleanhome_staff_session=')) || ''
  const cookie = header.split(';', 1)[0]
  check(/^cleanhome_staff_session=[A-Za-z0-9_-]{43}$/.test(cookie) && /;\s*HttpOnly(?:;|$)/i.test(header), 'OPAQUE_HTTPONLY_SESSION_REQUIRED')
  sessions.add(cookie); accounts[label] = { cookie, userId: account.userId }
}

function sessionOptions(label) { return { cookie: accounts[label].cookie, accountId: accounts[label].userId } }
function compareBranch(response, label) {
  expect(response, 200)
  check(response.data?.timezone === 'Asia/Ho_Chi_Minh', 'BRANCH_TIMEZONE_MISMATCH')
  const actual = response.data?.data, expected = branchSql[label]
  check(actual && isDeepStrictEqual(actual, expected), 'BFF_BRANCH_DOES_NOT_MATCH_EMPLOYEE_BRANCH_SQL_' + label)
}

try {
  await step('isolated_database_identity_and_readonly_snapshot', async () => {
    config = await loadConfig()
    for (const label of ['A', 'B']) {
      const account = config.accounts?.[label]
      check(account && ['userId', 'employeeId', 'branchId'].every(key => /^[1-9]\d{0,18}$/.test(account[key])) && account.phone?.startsWith('TEST-STAFF-QA-') && typeof account.password === 'string' && account.password.length >= 8, 'SYNTHETIC_QA_ACCOUNT_REQUIRED')
    }
    check(config.accounts.A.userId !== config.accounts.B.userId && config.accounts.A.employeeId !== config.accounts.B.employeeId, 'DISTINCT_QA_ACCOUNTS_REQUIRED')
    connection = await mysql.createConnection({ ...config.db, multipleStatements: false, connectTimeout: 5000, supportBigNumbers: true, bigNumberStrings: true })
    await connection.query('SET SESSION TRANSACTION READ ONLY')
    await connection.query('START TRANSACTION READ ONLY')
    await verifyDatabase(connection, config)
    const [[identity]] = await connection.query('SELECT DATABASE() AS databaseName, @@session.transaction_read_only AS readOnly')
    check(identity.databaseName === 'cleanhome_staff_qa_isolated' && Number(identity.readOnly) === 1, 'READONLY_ISOLATED_DATABASE_REQUIRED')
    for (const label of ['A', 'B']) {
      const account = config.accounts[label]
      const [rows] = await connection.execute(`SELECT e.id AS employeeId, e.user_id AS userId, e.branch_id AS branchId,
        b.id, b.name, b.address_text AS addressText, b.service_area AS serviceArea,
        b.latitude, b.longitude, b.status FROM employees e JOIN branches b ON b.id=e.branch_id WHERE e.user_id=?`, [account.userId])
      check(rows.length === 1 && String(rows[0].employeeId) === account.employeeId && String(rows[0].branchId) === account.branchId, 'EMPLOYEE_BRANCH_RELATION_MISMATCH_' + label)
      const row = rows[0]
      branchSql[label] = { id: String(row.id), name: row.name, addressText: row.addressText, serviceArea: typeof row.serviceArea === 'string' ? JSON.parse(row.serviceArea) : row.serviceArea, latitude: String(row.latitude), longitude: String(row.longitude), status: row.status }
    }
    return { readOnlyTransaction: true, sameQaBranch: branchSql.A.id === branchSql.B.id, database: config.db.database, port: config.db.port }
  })
  const range = new URLSearchParams(config.seed.range).toString()
  await step('anonymous_branch_and_availability_denied', async () => {
    expect(await request('/api/staff/branch'), 401)
    expect(await request('/api/staff/availability?' + range), 401)
  })
  for (const label of ['A', 'B']) await step(label + '_real_login', () => login(label))
  for (const label of ['A', 'B']) await step(label + '_branch_matches_employee_fk_and_sql', async () => {
    compareBranch(await request('/api/staff/branch', sessionOptions(label)), label)
    const response = await request('/api/staff/availability?' + range, sessionOptions(label))
    expect(response, 200); check(response.data.branchId === branchSql[label].id, 'AVAILABILITY_BRANCH_BINDING_MISMATCH_' + label)
  })
  for (const label of ['A', 'B']) await step(label + '_cross_account_header_rejected_for_both_area_routes', async () => {
    const other = label === 'A' ? 'B' : 'A'
    const options = { cookie: accounts[label].cookie, accountId: accounts[other].userId }
    expect(await request('/api/staff/branch', options), 409, 'STAFF_SESSION_CHANGED')
    expect(await request('/api/staff/availability?' + range, options), 409, 'STAFF_SESSION_CHANGED')
  })
  for (const label of ['A', 'B']) await step(label + '_employee_and_branch_query_impersonation_rejected', async () => {
    const other = config.accounts[label === 'A' ? 'B' : 'A']
    for (const [key, value] of [['employeeId', other.employeeId], ['branchId', other.branchId]]) {
      const query = new URLSearchParams({ [key]: value }).toString()
      expect(await request('/api/staff/branch?' + query, sessionOptions(label)), 400, 'VALIDATION_ERROR')
      expect(await request('/api/staff/availability?' + range + '&' + query, sessionOptions(label)), 400, 'VALIDATION_ERROR')
    }
    compareBranch(await request('/api/staff/branch', sessionOptions(label)), label)
  })
  await step('logout_A_revokes_A_while_B_identity_and_branch_remain_valid', async () => {
    expect(await request('/api/auth/logout', { method: 'POST', body: {}, cookie: accounts.A.cookie }), 200)
    sessions.delete(accounts.A.cookie)
    expect(await request('/api/staff/branch', sessionOptions('A')), 401)
    const session = await request('/api/auth/session', { cookie: accounts.B.cookie })
    expect(session, 200); check(session.data?.session?.user?.id === accounts.B.userId, 'B_SESSION_CHANGED_AFTER_A_LOGOUT')
    compareBranch(await request('/api/staff/branch', sessionOptions('B')), 'B')
  })
  report.status = 'REAL_PASS'
} catch (error) {
  report.status = error instanceof CheckError && !error.blocked ? 'FAIL' : 'BLOCKED'
  report.failedAt = failedAt
  report.reason = /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'DETAILS_WITHHELD'
  report.failureClassification = error instanceof CheckError && !error.blocked
    ? /^(?:QA_|LOOPBACK_BFF_ORIGIN_REQUIRED)/.test(error.message) ? 'HARNESS_CONTRACT_FAILURE' : 'INTEGRATION_ASSERTION_REQUIRES_DIAGNOSIS'
    : 'ENVIRONMENT_OR_TRANSPORT_BLOCKED'
  process.exitCode = 1
} finally {
  for (const cookie of sessions) try { expect(await request('/api/auth/logout', { method: 'POST', body: {}, cookie }), 200) } catch { report.sessionCleanupIncomplete = true }
  if (connection) { try { await connection.rollback() } catch {} await connection.end().catch(() => {}) }
  report.pass = report.checks.filter(value => value.status === 'REAL_PASS').length
  report.fail = report.checks.filter(value => value.status === 'FAIL').length
  report.blocked = report.checks.filter(value => value.status === 'BLOCKED').length
  try {
    const directory = join(privateDirectory, 'reports')
    await assertPrivatePath(directory); await mkdir(directory, { recursive: true })
    reportFile = join(directory, 'maps-isolation-' + new Date().toISOString().replaceAll(':', '-') + '.json')
    await writeJson(reportFile, report)
  } catch { report.artifactUnavailable = true }
  console.log(JSON.stringify({ status: report.status, pass: report.pass, fail: report.fail, blocked: report.blocked, businessMutations: report.businessMutations, report: reportFile, artifactUnavailable: report.artifactUnavailable }))
}
