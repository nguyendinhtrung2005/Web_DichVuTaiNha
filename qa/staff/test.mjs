import { readFile, realpath, lstat, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { randomBytes } from 'node:crypto'
import { loadStaffAuthConfig } from '../../frontend/apps/staff/lib/server/config.mjs'
import { createStaffAuth } from '../../frontend/apps/staff/lib/server/auth-core.mjs'

// Real HTTP + MySQL integration only. All credentials are supplied by the isolated
// private runtime config; no sibling repository, .env, fixture mock or shared DB.
const qaRoot = path.dirname(fileURLToPath(import.meta.url))
const privateRoot = path.join(qaRoot, '.private')
const results = [], sessions = new Set()
let config, mysql, snapshots = {}, origin
class CheckError extends Error { constructor(code, blocked = false) { super(code); this.blocked = blocked } }
const check = (condition, code) => { if (!condition) throw new CheckError(code) }
const canonicalId = value => typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value)
const sqlTime = value => value === null ? null : Date.parse(String(value).replace(' ', 'T') + 'Z')
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
function inside(root, target) { const relative = path.relative(root, target); return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative) }
function plainLocalOrigin(value) {
  let url
  try { url = new URL(value) } catch { throw new CheckError('INVALID_LOCAL_SERVICE_ORIGIN', true) }
  check(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && value === url.origin && !url.username && !url.password, 'NON_ISOLATED_SERVICE_ORIGIN')
  return url.origin
}
function noCredentialLeak(value) {
  const body = JSON.stringify(value)
  check(!/"(?:accessToken|refreshToken|password|passwordHash|password_hash|tokenType)"\s*:/i.test(body), 'CREDENTIAL_FIELD_EXPOSED')
  check(!/[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/.test(body), 'JWT_EXPOSED')
  for (const account of Object.values(config.accounts || {})) if (typeof account.password === 'string' && account.password.length > 5) check(!body.includes(account.password), 'SUBMITTED_PASSWORD_EXPOSED')
}
async function run(name, operation, kind = 'REAL_PASS') {
  const start = Date.now()
  try {
    const metadata = await operation()
    const result = { name, status: kind, durationMs: Date.now() - start, ...(metadata ? { metadata } : {}) }
    results.push(result); process.stdout.write(kind + ' ' + name + '\n')
    return result
  } catch (error) {
    const safe = error instanceof CheckError
    const result = { name, status: safe && !error.blocked ? 'FAIL' : 'BLOCKED', reason: safe ? error.message : 'SERVICE_OR_CONFIGURATION_UNAVAILABLE_DETAILS_WITHHELD', durationMs: Date.now() - start }
    results.push(result); process.stdout.write(result.status + ' ' + name + ' ' + result.reason + '\n')
    return result
  }
}
function notRun(name, reason) { results.push({ name, status: 'NOT_RUN', reason }); process.stdout.write('NOT_RUN ' + name + ' ' + reason + '\n') }

async function http(target, pathname, { method = 'GET', body, cookie, account, json = true, requestOrigin = origin } = {}) {
  let response, raw
  try {
    response = await fetch(target + pathname, { method, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(30000),
      headers: { Accept: json ? 'application/json' : 'text/html', ...(requestOrigin ? { Origin: requestOrigin } : {}),
        ...(cookie ? { Cookie: cookie } : {}), ...(account ? { 'X-Staff-Account-Id': account.userId } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    const chunks = [], reader = response.body?.getReader(); let bytes = 0
    if (reader) try { for (;;) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength; if (bytes > 2_097_152) throw new CheckError('HTTP_RESPONSE_TOO_LARGE'); chunks.push(part.value) } } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
    raw = Buffer.concat(chunks).toString('utf8')
  } catch (error) { if (error instanceof CheckError) throw error; throw new CheckError('HTTP_SERVICE_UNREACHABLE_OR_TIMEOUT', true) }
  let data = null
  if (json) {
    check(response.headers.get('content-type')?.includes('application/json'), 'HTTP_EXPECTED_JSON_GOT_' + response.status)
    try { data = JSON.parse(raw) } catch { throw new CheckError('HTTP_INVALID_JSON') }
    noCredentialLeak(data)
  }
  return { status: response.status, headers: response.headers, data, ...(json ? {} : { html: raw }) }
}
const bff = (pathname, options) => http(origin, pathname, options)
function expectStatus(response, status) { check(response.status === status, 'HTTP_EXPECTED_' + status + '_GOT_' + response.status) }
function expectError(response, status, code) {
  expectStatus(response, status)
  check(typeof response.data?.error?.code === 'string' && typeof response.data.error.message === 'string', 'STRUCTURED_ERROR_MISSING')
  if (code) check(response.data.error.code === code, 'UNEXPECTED_ERROR_CODE')
}
async function login(label) {
  const account = config.accounts[label]
  if (!account) throw new CheckError('QA_ACCOUNT_NOT_CONFIGURED', true)
  const response = await bff('/api/auth/login', { method: 'POST', body: { phone: account.phone, password: account.password } })
  expectStatus(response, 200)
  check(response.data?.session?.user?.id === account.userId && response.data.session.user.role === 'EMPLOYEE' && response.data.session.user.status === 'ACTIVE', 'AUTHENTICATED_IDENTITY_MISMATCH')
  const header = response.headers.getSetCookie().find(value => value.startsWith('cleanhome_staff_session=')) || ''
  const cookie = header.split(';', 1)[0]
  check(/^cleanhome_staff_session=[A-Za-z0-9_-]{43}$/.test(cookie) && /;\s*HttpOnly(?:;|$)/i.test(header) && /;\s*SameSite=Lax(?:;|$)/i.test(header) && !/;\s*Domain=/i.test(header), 'SESSION_COOKIE_NOT_OPAQUE_HOST_ONLY_HTTPONLY_LAX')
  check(/no-store/.test(response.headers.get('cache-control') || ''), 'AUTH_RESPONSE_CACHEABLE')
  sessions.add(cookie)
  return { cookie, account, session: response.data.session }
}
const sameIds = (left, right) => left.length === right.length && new Set(left).size === left.length && left.every(id => right.includes(id))
const jobsQuery = '?page=1&pageSize=100&sort=asc'
const scheduleQuery = (range = config.seed.range) => '?' + new URLSearchParams({ ...range, page: '1', pageSize: '100', sort: 'asc' })
function rows(response) { expectStatus(response, 200); check(Array.isArray(response.data?.data) && response.data?.timezone === 'Asia/Ho_Chi_Minh', 'STAFF_LIST_CONTRACT_INVALID'); return response.data.data }

async function preflight() {
  const filename = path.join(privateRoot, 'runtime-config.json')
  const stat = await lstat(filename), resolved = await realpath(filename), resolvedPrivate = await realpath(privateRoot)
  check(stat.isFile() && !stat.isSymbolicLink() && inside(resolvedPrivate, resolved), 'PRIVATE_CONFIG_ESCAPES_ISOLATED_QA')
  try { config = JSON.parse(await readFile(filename, 'utf8')) } catch { throw new CheckError('QA_CONFIG_UNREADABLE', true) }
  check(config.schemaVersion === 'CLEANHOME_STAFF_QA_V1' && config.kind === 'cleanhome.staff-qa-isolated' && config.version === 1 && config.isolated === true, 'QA_CONFIG_ISOLATION_MARKER_INVALID')
  check(config.db?.database === 'cleanhome_staff_qa_isolated' && Number.isInteger(config.db.port) && config.db.port >= 1024 && config.db.port <= 65535 && config.db.port !== 3306 && config.db.host === '127.0.0.1', 'QA_DB_MUST_BE_EXACT_NEW_INSTANCE')
  check(config.database?.name === config.db.database && config.database.port === config.db.port, 'QA_DATABASE_METADATA_MISMATCH')
  for (const name of ['A', 'B']) { const account = config.accounts?.[name]; check(account && canonicalId(account.userId) && canonicalId(account.employeeId) && typeof account.phone === 'string' && account.phone.startsWith('TEST-STAFF-QA-') && typeof account.password === 'string' && account.password.length >= 8, 'QA_SYNTHETIC_ACCOUNTS_REQUIRED') }
  origin = plainLocalOrigin(config.frontendOrigin)
  for (const key of ['authOrigin', 'orderOrigin', 'staffOrigin']) plainLocalOrigin(config[key])
  const require = createRequire(new URL('../../backend/staff-service/package.json', import.meta.url))
  const driver = require('mysql2/promise')
  mysql = await driver.createConnection({ ...config.db, connectTimeout: 5000, dateStrings: true, supportBigNumbers: true, bigNumberStrings: true, multipleStatements: false })
  const [identity] = await mysql.query('SELECT DATABASE() AS databaseName, @@port AS serverPort, @@server_uuid AS serverUuid, @@datadir AS dataDir')
  check(identity[0]?.databaseName === 'cleanhome_staff_qa_isolated' && Number(identity[0].serverPort) === config.db.port, 'ACTUAL_MYSQL_ISOLATION_MISMATCH')
  if (config.mysql?.serverUuid) check(identity[0].serverUuid === config.mysql.serverUuid, 'ACTUAL_MYSQL_UUID_MISMATCH')
  if (config.mysql?.dataDir) {
    const expected = path.normalize(config.mysql.dataDir).replace(/[\\/]+$/, '').toLowerCase(), actual = path.normalize(identity[0].dataDir).replace(/[\\/]+$/, '').toLowerCase()
    check(expected === actual, 'ACTUAL_MYSQL_DATADIR_MISMATCH')
    check(inside(resolvedPrivate, await realpath(config.mysql.dataDir)), 'QA_MYSQL_DATADIR_ESCAPES_PRIVATE_ROOT')
  }
  // mysql2 dateStrings does not set the MySQL session timezone. Match the
  // production repository's UTC TIMESTAMP reads before deriving VN-day totals.
  await mysql.query("SET SESSION time_zone = '+00:00'")
  for (const label of ['A', 'B', 'MANUAL']) {
    const account = config.accounts[label]
    if (!account?.employeeId) continue
    const [assignments] = await mysql.execute(`SELECT a.id AS assignmentId, a.booking_id AS bookingId, a.status,
      b.scheduled_start AS scheduledAt, b.scheduled_end AS expectedEndAt, a.check_in_at AS checkInAt, a.check_out_at AS checkOutAt
      FROM assignments a JOIN bookings b ON b.id = a.booking_id WHERE a.employee_id = ? ORDER BY b.scheduled_start, a.id`, [account.employeeId])
    snapshots[label] = assignments.map(row => ({ ...row, assignmentId: String(row.assignmentId), bookingId: String(row.bookingId) }))
    if (config.seed?.counts?.[label]?.total !== undefined) check(assignments.length === config.seed.counts[label].total, 'QA_SEED_TOTAL_MISMATCH_' + label)
    if (config.seed?.counts?.[label]?.done !== undefined) check(assignments.filter(row => row.status === 'DONE').length === config.seed.counts[label].done, 'QA_SEED_DONE_MISMATCH_' + label)
    if (account.assignmentIds?.length) check(sameIds(snapshots[label].map(row => row.assignmentId), account.assignmentIds), 'QA_SEED_ID_METADATA_MISMATCH_' + label)
  }
  return { database: 'cleanhome_staff_qa_isolated', port: config.db.port, totalA: snapshots.A.length, totalB: snapshots.B.length, doneB: snapshots.B.filter(row => row.status === 'DONE').length }
}

async function main() {
  const preflightResult = await run('isolated_mysql_and_synthetic_seed_preflight', preflight)
  if (preflightResult.status !== 'REAL_PASS') return
  let ready = true
  for (const [name, target] of [['auth', config.authOrigin], ['order', config.orderOrigin], ['staff', config.staffOrigin]]) {
    const result = await run(name + '_real_health_ready', async () => { const response = await http(target, '/health/ready'); expectStatus(response, 200); check(response.data?.status === 'ready', 'SERVICE_NOT_READY') })
    if (result.status !== 'REAL_PASS') ready = false
  }
  if (!ready) { notRun('authenticated_http_modules', 'DEPENDENCY_READINESS_FAILED'); return }
  await run('order_internal_token_isolated_real_authentication', async () => {
    const route = '/internal/v1/assignment-transitions/pending?limit=10'
    const denied = await fetch(config.orderOrigin + route, { signal: AbortSignal.timeout(10000), redirect: 'error' })
    check(denied.status === 401, 'ORDER_INTERNAL_ROUTE_ALLOWED_ANONYMOUS'); await denied.body?.cancel()
    const tokenFile = config.paths.orderTokenFile
    check(inside(await realpath(privateRoot), await realpath(tokenFile)), 'ORDER_TOKEN_OUTSIDE_PRIVATE_QA')
    const token = (await readFile(tokenFile, 'utf8')).trim()
    const allowed = await fetch(config.orderOrigin + route, { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(10000), redirect: 'error' })
    check(allowed.status === 200, 'ORDER_INTERNAL_QA_TOKEN_DENIED'); await allowed.body?.cancel()
    const browserDenied = await fetch(config.orderOrigin + route, { headers: { Authorization: 'Bearer ' + token, Origin: origin }, signal: AbortSignal.timeout(10000), redirect: 'error' })
    check(browserDenied.status === 403, 'ORDER_INTERNAL_ROUTE_ALLOWED_BROWSER_ORIGIN'); await browserDenied.body?.cancel()
  })
  await run('anonymous_session_and_protected_modules_401', async () => {
    for (const route of ['/api/auth/session', '/api/staff/jobs', '/api/staff/branch', '/api/staff/notifications', '/api/staff/support/chat', '/api/staff/reviews?from=' + config.seed.range.from + '&to=' + config.seed.range.to]) expectError(await bff(route), 401)
    expectError(await bff('/api/auth/session', { cookie: 'cleanhome_staff_session=' + randomBytes(32).toString('base64url') }), 401)
  })
  await run('wrong_password_real_auth_401', async () => expectError(await bff('/api/auth/login', { method: 'POST', body: { phone: config.accounts.A.phone, password: config.accounts.A.password + '-wrong' } }), 401))
  await run('login_requires_same_origin', async () => expectError(await bff('/api/auth/login', { method: 'POST', requestOrigin: 'https://foreign.invalid', body: { phone: config.accounts.A.phone, password: config.accounts.A.password } }), 403))
  if (config.accounts.CUSTOMER) await run('customer_cannot_login_staff_403', async () => expectError(await bff('/api/auth/login', { method: 'POST', body: { phone: config.accounts.CUSTOMER.phone, password: config.accounts.CUSTOMER.password } }), 403))
  let A, B
  await run('real_login_employee_A', async () => { A = await login('A') })
  await run('real_login_employee_B', async () => { B = await login('B') })
  if (!A || !B) { notRun('authenticated_http_modules', 'REAL_LOGIN_REQUIRED'); return }
  await run('session_persists_across_independent_http_requests_reload_equivalent', async () => {
    for (let i = 0; i < 2; i++) { const response = await bff('/api/auth/session', { cookie: A.cookie }); expectStatus(response, 200); check(response.data?.session?.user?.id === A.account.userId, 'RELOAD_SESSION_IDENTITY_CHANGED') }
    const html = await bff('/cong-viec', { cookie: A.cookie, json: false }); expectStatus(html, 200)
  })
  for (const [label, person] of [['A', A], ['B', B]]) {
    await run('jobs_exact_mysql_ownership_' + label, async () => {
      const response = await bff('/api/staff/jobs' + jobsQuery, { cookie: person.cookie, account: person.account }), data = rows(response)
      check(response.data.pagination.total === snapshots[label].length && sameIds(data.map(row => row.assignmentId), snapshots[label].map(row => row.assignmentId)), 'JOBS_IDS_DIFFER_FROM_ISOLATED_MYSQL')
      check(data.every(row => snapshots[label].some(expected => expected.assignmentId === row.assignmentId && expected.status === row.databaseStatus)), 'JOBS_STATUS_DIFFERS_FROM_MYSQL')
      return { total: data.length, done: data.filter(row => row.databaseStatus === 'DONE').length }
    })
    await run('schedule_exact_mysql_range_' + label, async () => {
      const response = await bff('/api/staff/schedule' + scheduleQuery(), { cookie: person.cookie, account: person.account }), data = rows(response)
      const start = Date.parse(config.seed.range.from + 'T00:00:00+07:00'), end = Date.parse(config.seed.range.to + 'T00:00:00+07:00') + 86400000
      const expected = snapshots[label].filter(row => sqlTime(row.scheduledAt) < end && sqlTime(row.expectedEndAt) > start)
      check(sameIds(data.map(row => row.assignmentId), expected.map(row => row.assignmentId)), 'SCHEDULE_IDS_DIFFER_FROM_MYSQL_WINDOW')
      return { total: data.length }
    })
  }
  await run('job_detail_owned_200_foreign_404_and_session_binding_409', async () => {
    const own = snapshots.A[0]?.assignmentId, foreign = snapshots.B[0]?.assignmentId
    check(own && foreign, 'QA_REQUIRES_A_B_ASSIGNMENTS')
    const detail = await bff('/api/staff/jobs/' + own, { cookie: A.cookie, account: A.account }); expectStatus(detail, 200); check(detail.data?.data?.assignmentId === own, 'DETAIL_ID_MISMATCH')
    expectError(await bff('/api/staff/jobs/' + foreign, { cookie: A.cookie, account: A.account }), 404)
    expectError(await bff('/api/staff/jobs/' + own, { cookie: B.cookie, account: B.account }), 404)
    expectError(await bff('/api/staff/jobs' + jobsQuery, { cookie: A.cookie, account: B.account }), 409, 'STAFF_SESSION_CHANGED')
  })
  await run('job_and_schedule_validation_real_bff_400', async () => {
    expectError(await bff('/api/staff/jobs?page=0', { cookie: A.cookie }), 400)
    expectError(await bff('/api/staff/schedule?from=2026-11-31&to=2026-12-01', { cookie: A.cookie }), 400)
    expectError(await bff('/api/staff/jobs?employeeId=' + B.account.employeeId, { cookie: A.cookie }), 400)
  })
  await run('real_operational_achievement_model_from_real_schedule', async () => {
    const { summarizeStaffPerformance } = await import('../../frontend/packages/ui/src/components/staff/staff-performance-model.ts')
    const range = config.seed.allRange || config.seed.range
    const response = await bff('/api/staff/schedule' + scheduleQuery(range), { cookie: B.cookie, account: B.account }), data = rows(response)
    const start = Date.parse(range.from + 'T00:00:00+07:00'), end = Date.parse(range.to + 'T00:00:00+07:00') + 86400000
    const selected = data.filter(row => Date.parse(row.scheduledAt) >= start && Date.parse(row.scheduledAt) < end), summary = summarizeStaffPerformance(selected)
    check(summary.total === selected.length && summary.done === selected.filter(row => row.databaseStatus === 'DONE').length, 'OPERATIONAL_MODEL_COUNT_MISMATCH')
    const expected = snapshots.B.filter(row => sqlTime(row.scheduledAt) >= start && sqlTime(row.scheduledAt) < end)
    check(summary.total === expected.length && summary.done === expected.filter(row => row.status === 'DONE').length, 'OPERATIONAL_MODEL_DIFFERS_FROM_ACTUAL_MYSQL')
    check(summary.completionRate === (summary.completionDenominator ? Math.round(summary.done / summary.completionDenominator * 1000) / 10 : null), 'OPERATIONAL_MODEL_RATE_MISMATCH')
    return { source: 'real_schedule_http_to_production_model', total: summary.total, done: summary.done, completionRate: summary.completionRate }
  })
  await run('branch_geojson_coordinates_and_availability_real_mysql', async () => {
    const response = await bff('/api/staff/branch', { cookie: A.cookie, account: A.account }); expectStatus(response, 200)
    check(response.data?.data?.id === A.account.branchId, 'BRANCH_ID_MISMATCH')
    const [branches] = await mysql.execute('SELECT latitude, longitude FROM branches WHERE id = ?', [A.account.branchId])
    check(branches.length === 1 && String(response.data.data.latitude) === String(branches[0].latitude) && String(response.data.data.longitude) === String(branches[0].longitude), 'BRANCH_COORDINATES_DIFFER_FROM_MYSQL')
    const from = config.seed.weekRange?.from || config.seed.range.from, to = config.seed.weekRange?.to || new Date(Date.parse(from + 'T00:00:00Z') + 6 * 86400000).toISOString().slice(0, 10)
    const availability = await bff('/api/staff/availability?' + new URLSearchParams({ from, to }), { cookie: A.cookie, account: A.account }); expectStatus(availability, 200)
    check(Array.isArray(availability.data?.data) && availability.data.branchId === A.account.branchId, 'AVAILABILITY_CONTRACT_INVALID')
    const [dbWindows] = await mysql.execute('SELECT id, starts_at AS startsAt, ends_at AS endsAt FROM employee_availability WHERE employee_id = ?', [A.account.employeeId])
    const windowStart = Date.parse(from + 'T00:00:00+07:00'), windowEnd = Date.parse(to + 'T00:00:00+07:00') + 86400000
    const expectedWindows = dbWindows.filter(row => sqlTime(row.startsAt) < windowEnd && sqlTime(row.endsAt) > windowStart)
    check(sameIds(availability.data.data.map(row => row.id), expectedWindows.map(row => String(row.id))), 'AVAILABILITY_IDS_DIFFER_FROM_MYSQL')
    expectError(await bff('/api/staff/branch', { cookie: A.cookie, account: B.account }), 409, 'STAFF_SESSION_CHANGED')
    return { availabilityCount: availability.data.data.length, coordinatesVerifiedAgainst: 'isolated_mysql' }
  })
  await run('notifications_real_isolation_unread_read_retry_only_new_qa_db', async () => {
    const listedA = await bff('/api/staff/notifications?page=1&pageSize=100', { cookie: A.cookie, account: A.account }), listA = rows(listedA)
    const listedB = await bff('/api/staff/notifications?page=1&pageSize=100', { cookie: B.cookie, account: B.account }), listB = rows(listedB)
    const [dbA] = await mysql.execute('SELECT id, read_at AS readAt FROM notifications WHERE user_id = ?', [A.account.userId])
    const [dbB] = await mysql.execute('SELECT id, read_at AS readAt FROM notifications WHERE user_id = ?', [B.account.userId])
    check(sameIds(listA.map(row => row.id), dbA.map(row => String(row.id))) && sameIds(listB.map(row => row.id), dbB.map(row => String(row.id))), 'NOTIFICATION_OWNERSHIP_DIFFERS_FROM_MYSQL')
    const aUnread = await bff('/api/staff/notifications/unread-count', { cookie: A.cookie }), bUnread = await bff('/api/staff/notifications/unread-count', { cookie: B.cookie })
    expectStatus(aUnread, 200); expectStatus(bUnread, 200)
    check(aUnread.data?.data?.unreadCount === dbA.filter(row => row.readAt === null).length && bUnread.data?.data?.unreadCount === dbB.filter(row => row.readAt === null).length, 'UNREAD_COUNT_DIFFERS_FROM_MYSQL')
    const own = listA.find(row => row.readAt === null) || listA[0], foreign = listB[0]
    check(own && foreign, 'QA_NOTIFICATIONS_REQUIRED')
    expectError(await bff('/api/staff/notifications/' + foreign.id + '/read', { method: 'PATCH', cookie: A.cookie, account: A.account }), 404)
    const marked = await bff('/api/staff/notifications/' + own.id + '/read', { method: 'PATCH', cookie: A.cookie, account: A.account }); expectStatus(marked, 200)
    check(marked.data?.data?.id === own.id && typeof marked.data.data.readAt === 'string', 'MARK_READ_NOT_PERSISTED')
    const retry = await bff('/api/staff/notifications/' + own.id + '/read', { method: 'PATCH', cookie: A.cookie, account: A.account }); expectStatus(retry, 200)
    check(retry.data.data.readAt === marked.data.data.readAt && retry.data.unreadCount === marked.data.unreadCount, 'MARK_READ_RETRY_NOT_IDEMPOTENT')
    const [stored] = await mysql.execute('SELECT read_at AS readAt FROM notifications WHERE user_id = ? AND id = ?', [A.account.userId, own.id])
    check(stored[0]?.readAt !== null, 'MARK_READ_MISSING_IN_ACTUAL_MYSQL')
    const bAfter = await bff('/api/staff/notifications/unread-count', { cookie: B.cookie }); expectStatus(bAfter, 200); check(bAfter.data.data.unreadCount === bUnread.data.data.unreadCount, 'STAFF_A_MUTATION_CHANGED_STAFF_B')
    const all = await bff('/api/staff/notifications/read-all', { method: 'PATCH', cookie: A.cookie, account: A.account }); expectStatus(all, 200); check(all.data?.data?.unreadCount === 0, 'MARK_ALL_UNREAD_NOT_ZERO')
    return { scope: 'new_isolated_qa_database_only', countA: listA.length, countB: listB.length }
  })
  if (config.mode === 'development' && config.incomeDemoEnabled === true) {
    await run('income_demo_v2_real_assignments_without_payment_claim', async () => {
      for (const [label, person] of [['A', A], ['B', B]]) {
        const response = await bff('/api/staff/income/estimate?month=' + config.seed.month, { cookie: person.cookie, account: person.account }); expectStatus(response, 200)
        check(response.data?.policy?.version === 'DEMO_V2' && response.data.payout?.status === 'NOT_INTEGRATED', 'INCOME_NOT_LABELLED_DEMO_V2_OR_FALSE_PAYMENT')
        check(response.data.assignments.every(row => snapshots[label].some(expected => expected.assignmentId === row.id)), 'INCOME_LEAKS_OTHER_EMPLOYEE_ASSIGNMENTS')
        check(response.data.counts.eligible === response.data.assignments.filter(row => row.eligible).length, 'INCOME_ELIGIBLE_COUNT_INCONSISTENT')
        check(response.data.assignments.filter(row => row.eligible).every(row => row.status === 'DONE' && row.checkInAt && row.checkOutAt), 'INCOME_INCLUDES_INELIGIBLE_ASSIGNMENTS')
        const [year, month] = config.seed.month.split('-').map(Number), start = Date.UTC(year, month - 1, 1) - 7 * 3600000, end = Date.UTC(year, month, 1) - 7 * 3600000
        const inMonth = time => time !== null && time >= start && time < end
        const expected = snapshots[label].filter(row => inMonth(sqlTime(row.scheduledAt)) || inMonth(sqlTime(row.checkOutAt)))
        check(sameIds(response.data.assignments.map(row => row.id), expected.map(row => row.assignmentId)), 'INCOME_ROWS_DIFFER_FROM_MYSQL_MONTH')
        const eligible = expected.filter(row => row.status === 'DONE' && row.checkInAt && row.checkOutAt && sqlTime(row.checkOutAt) >= sqlTime(row.checkInAt) && inMonth(sqlTime(row.checkOutAt)))
        const days = new Map(); let peakCount = 0
        for (const row of eligible) {
          const day = new Date(sqlTime(row.checkOutAt) + 7 * 3600000).toISOString().slice(0, 10)
          days.set(day, (days.get(day) || 0) + 1)
          const local = new Date(sqlTime(row.checkInAt) + 7 * 3600000), minute = local.getUTCHours() * 60 + local.getUTCMinutes()
          if (minute >= 17 * 60 && minute < 20 * 60) peakCount++
        }
        const baseVnd = eligible.length * 60000, peakVnd = peakCount * 10000, incentiveVnd = [...days.values()].filter(count => count >= 5).length * 30000
        check(response.data.counts.eligible === eligible.length && response.data.breakdown.baseVnd === baseVnd && response.data.breakdown.peakVnd === peakVnd && response.data.breakdown.incentiveVnd === incentiveVnd && response.data.breakdown.distanceVnd === 0 && response.data.estimateTotalVnd === baseVnd + peakVnd + incentiveVnd, 'DEMO_FORMULA_DIFFERS_FROM_ACTUAL_MYSQL_INPUTS')
      }
      expectError(await bff('/api/staff/income/estimate?month=' + config.seed.month, { cookie: A.cookie, account: B.account }), 409, 'STAFF_SESSION_CHANGED')
      expectError(await bff('/api/staff/income/estimate?month=invalid', { cookie: A.cookie }), 400)
      return { policy: 'DEMO_V2', sourceAssignments: 'real_isolated_mysql', payout: 'NOT_INTEGRATED' }
    }, 'DEMO_PASS')
  } else notRun('income_demo_v2_real_assignments_without_payment_claim', 'DEVELOPMENT_DEMO_NOT_ENABLED')
  await run('chatbot_real_bff_readiness_and_account_isolation_without_inference', async () => {
    const status = await bff('/api/staff/support/chat', { cookie: A.cookie, account: A.account }); expectStatus(status, 200)
    check(typeof status.data?.available === 'boolean' && ['fixed-questions', 'free-text'].includes(status.data?.mode), 'CHATBOT_READINESS_INVALID')
    if (!status.data.available) expectError(await bff('/api/staff/support/chat', { method: 'POST', cookie: A.cookie, account: A.account, body: { questionId: 'jobs' } }), 503, 'SUPPORT_AI_UNAVAILABLE')
    expectError(await bff('/api/staff/support/chat', { cookie: A.cookie, account: B.account }), 409, 'STAFF_SESSION_CHANGED')
  })
  await run('review_real_bff_disabled_no_synthetic_ratings', async () => {
    expectError(await bff('/api/staff/reviews?' + new URLSearchParams(config.seed.range), { cookie: A.cookie, account: A.account }), 503, 'REVIEWS_NOT_AVAILABLE')
    expectError(await bff('/api/staff/reviews?' + new URLSearchParams(config.seed.range), { cookie: A.cookie, account: B.account }), 409, 'STAFF_SESSION_CHANGED')
  })
  await run('staff_pages_real_http_shells_and_maps_no_server_sdk_request', async () => {
    for (const route of ['/khu-vuc', '/thu-nhap', '/ho-tro', '/thanh-tich']) { const response = await bff(route, { cookie: A.cookie, json: false }); expectStatus(response, 200); check(!/<script[^>]+src=["']https:\/\/maps\.googleapis\.com\//i.test(response.html), 'MAPS_SCRIPT_LOADED_WITHOUT_EXPLICIT_OPEN') }
    return { coverage: 'HTTP_shell_only_client_render_verified_by_browser_suite' }
  })
  notRun('leaflet_live_tiles_render', 'RUN_SEPARATE_MAPS_BROWSER_QA')
  notRun('real_ai_answer', 'SEPARATE_EXPLICITLY_BUDGETED_LIVE_AI_SUITE')
  notRun('real_rating_review_data', 'REVIEW_API_NOT_AVAILABLE')
  notRun('real_payment_payout', 'PAYOUT_NOT_INTEGRATED')
  await run('real_core_bff_to_auth_session_expiry_private_1_second_store', async () => {
    const keyFile = config.frontend?.sessionKeyFile || config.paths?.staffSessionKeyFile || config.staffSessionKeyFile
    if (!keyFile) throw new CheckError('QA_BFF_SESSION_KEY_PATH_NOT_CONFIGURED', true)
    check(inside(await realpath(privateRoot), await realpath(keyFile)), 'QA_EXPIRY_KEY_ESCAPES_PRIVATE_ROOT')
    const localConfig = loadStaffAuthConfig({ NODE_ENV: 'development', AUTH_SERVICE_URL: config.authOrigin, STAFF_APP_ORIGIN: origin,
      STAFF_SESSION_DIR: path.join(privateRoot, 'session-expiry-test'), STAFF_SESSION_KEY_FILE: keyFile,
      STAFF_SESSION_MAX_AGE_SECONDS: '1', STAFF_SESSION_RENEWAL_ENABLED: 'false' }, qaRoot)
    const auth = createStaffAuth({ config: localConfig })
    let sid
    try {
      const signedIn = await auth.login({ phone: A.account.phone, password: A.account.password }); sid = signedIn.sid
      check(signedIn.session.user.id === A.account.userId, 'EXPIRY_LOGIN_IDENTITY_MISMATCH')
      const remaining = Date.parse(signedIn.session.expiresAt) - Date.now()
      check(remaining > 0 && remaining <= 1000, 'PRIVATE_TEST_SESSION_TTL_NOT_ONE_SECOND')
      await pause(remaining + 150)
      let expired = false
      try { await auth.inspect(sid) } catch (error) { expired = error.status === 401 && error.code === 'SESSION_EXPIRED' }
      check(expired, 'EXPIRED_REAL_AUTH_BACKED_SESSION_STILL_VALID')
      return { source: 'real_createStaffAuth_to_real_Auth_HTTP', privateStoreTtlSeconds: 1, mainHttpSessionTtlUnchanged: true }
    } finally { if (sid) await auth.logout(sid).catch(() => {}) }
  })
  await run('logout_real_http_invalidates_old_cookie_A_and_preserves_B', async () => {
    expectError(await bff('/api/auth/logout', { method: 'POST', body: {}, cookie: A.cookie, requestOrigin: 'https://foreign.invalid' }), 403)
    expectStatus(await bff('/api/auth/session', { cookie: A.cookie }), 200)
    const response = await bff('/api/auth/logout', { method: 'POST', body: {}, cookie: A.cookie }); expectStatus(response, 200)
    check(response.data?.ok === true && response.headers.getSetCookie().some(value => value.startsWith('cleanhome_staff_session=') && /Max-Age=0/.test(value)), 'LOGOUT_DID_NOT_CLEAR_COOKIE')
    expectError(await bff('/api/auth/session', { cookie: A.cookie }), 401)
    expectError(await bff('/api/staff/jobs', { cookie: A.cookie }), 401)
    expectStatus(await bff('/api/auth/session', { cookie: B.cookie }), 200)
    sessions.delete(A.cookie)
  })
  if (config.accounts.MANUAL && snapshots.MANUAL?.length === 0) await run('real_employee_with_no_jobs_empty_states', async () => {
    const person = await login('MANUAL')
    const jobs = await bff('/api/staff/jobs' + jobsQuery, { cookie: person.cookie, account: person.account }); check(rows(jobs).length === 0 && jobs.data.pagination.total === 0, 'EMPTY_EMPLOYEE_HAS_JOBS')
    const schedule = await bff('/api/staff/schedule' + scheduleQuery(), { cookie: person.cookie, account: person.account }); check(rows(schedule).length === 0, 'EMPTY_EMPLOYEE_HAS_SCHEDULE')
    const { summarizeStaffPerformance } = await import('../../frontend/packages/ui/src/components/staff/staff-performance-model.ts')
    const summary = summarizeStaffPerformance(rows(schedule)); check(summary.total === 0 && summary.completionRate === null && summary.onTimeRate === null, 'EMPTY_REAL_EMPLOYEE_PROJECTED_FAKE_METRICS')
    return { total: 0 }
  })
}

try { await main() }
catch { results.push({ name: 'qa_runner', status: 'BLOCKED', reason: 'UNEXPECTED_FAILURE_DETAILS_WITHHELD' }) }
finally {
  if (origin) for (const cookie of sessions) try { await bff('/api/auth/logout', { method: 'POST', body: {}, cookie }) } catch { /* Never print session material. */ }
  if (mysql) await mysql.end().catch(() => {})
  const counts = Object.fromEntries(['REAL_PASS', 'DEMO_PASS', 'FAIL', 'BLOCKED', 'NOT_RUN'].map(status => [status, results.filter(result => result.status === status).length]))
  await mkdir(path.join(privateRoot, 'reports'), { recursive: true })
  await writeFile(path.join(privateRoot, 'reports', 'http-results.json'), JSON.stringify({ schemaVersion: 'CLEANHOME_STAFF_QA_HTTP_V1', executedAt: new Date().toISOString(), scope: 'isolated_synthetic_qa_only', counts, results }, null, 2) + '\n')
  process.stdout.write('SUMMARY ' + JSON.stringify(counts) + '\n')
  if (counts.FAIL || counts.BLOCKED) process.exitCode = 1
}
