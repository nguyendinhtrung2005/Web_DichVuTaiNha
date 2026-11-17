import { after, before, describe, test } from 'node:test'
import { randomBytes } from 'node:crypto'
import { readFile, lstat } from 'node:fs/promises'
import { resolve, sep, extname } from 'node:path'

// Opt-in, real Next.js -> Auth/Staff -> existing MySQL. Metadata contains IDs,
// statuses and saved UTC times only. No SQL, JWT minting, vault/key or UC12 call.
const enabled = process.env.RUN_STAFF_UC11_HTTP_TESTS === 'true'
const cookieName = 'cleanhome_staff_session', dayMs = 86400000, offsetMs = 7 * 3600000
const sessions = new Set(), databaseStatuses = ['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'DONE', 'CANCELLED']
let origin, people, metadata, range, cookieA, cookieB, baselineA, baselineB

function check(value, message) { if (!value) throw new Error(message) }
function id(value) { return typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n }
function iso(value) { return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value }
function vietnamDay(value) { return new Date(Date.parse(value) + offsetMs).toISOString().slice(0, 10) }
function localRange(from, to) { return { start: Date.parse(from + 'T00:00:00Z') - offsetMs, end: Date.parse(to + 'T00:00:00Z') - offsetMs + dayMs } }
function sameIds(actual, expected) { return actual.length === expected.length && new Set(actual).size === actual.length && actual.every(value => expected.includes(value)) }
function schedulePath(values) { return '/api/staff/schedule?' + new URLSearchParams(values).toString() }
const baseQuery = values => ({ from: range.from, to: range.to, page: '1', pageSize: '100', sort: 'asc', ...values })

function noSecret(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  check(!/"(?:accessToken|refreshToken|tokenType|password|passwordHash|password_hash)"\s*:/i.test(text), 'Browser-facing response exposed a credential field')
  check(!/[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/.test(text), 'Browser-facing response exposed a JWT')
  for (const person of Object.values(people || {})) if (person.password) check(!text.includes(person.password), 'Response exposed a submitted credential')
  if (process.env.STAFF_BFF_TEST_PASSWORD_CUSTOMER) check(!text.includes(process.env.STAFF_BFF_TEST_PASSWORD_CUSTOMER), 'Response exposed a submitted credential')
}

async function request(path, { method = 'GET', body, cookie, requestOrigin = origin, authorization, json = true } = {}) {
  let response, raw
  try {
    response = await fetch(origin + path, {
      method, redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: {
        Accept: 'application/json', ...(requestOrigin === null ? {} : { Origin: requestOrigin }),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(cookie ? { Cookie: cookie } : {}), ...(authorization ? { Authorization: authorization } : {}),
      }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const chunks = [], reader = response.body?.getReader(); let bytes = 0
    if (reader) {
      try {
        for (;;) {
          const part = await reader.read()
          if (part.done) break
          bytes += part.value.byteLength
          check(bytes <= 1048576, 'UC11 response exceeded the test size limit')
          chunks.push(part.value)
        }
      } finally { reader.releaseLock() }
    }
    raw = Buffer.concat(chunks).toString('utf8')
  } catch { throw new Error('UC11 HTTP request failed; request and response contents withheld') }
  noSecret(raw)
  let data = null
  if (json) {
    check(response.headers.get('content-type')?.includes('application/json'), 'UC11 BFF did not return JSON')
    try { data = JSON.parse(raw) } catch { throw new Error('UC11 BFF returned invalid JSON; contents withheld') }
    noSecret(data)
    check(/no-store/i.test(response.headers.get('cache-control') || ''), 'UC11 response could be cached')
  }
  return { status: response.status, data, headers: response.headers }
}

function expectError(result, status) {
  check(result.status === status, `Expected HTTP ${status}; observed HTTP ${result.status}`)
  check(typeof result.data?.error?.code === 'string' && typeof result.data.error.message === 'string' && typeof result.data.requestId === 'string', 'UC11 error lacked a safe structured error/request ID')
  check(Object.keys(result.data).every(key => ['error', 'requestId'].includes(key)) && Object.keys(result.data.error).every(key => ['code', 'message'].includes(key)), 'UC11 error exposed unexpected assignment or upstream data')
}

function expected(name, values) {
  const { start, end } = localRange(values.from, values.to)
  const status = values.status === 'WAITING' ? 'ASSIGNED' : values.status
  const rows = metadata.filter(row => row.userId === people[name].userId && Date.parse(row.scheduledAt) < end && Date.parse(row.expectedEndAt) > start && (!status || row.databaseStatus === status))
  rows.sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt) || (BigInt(a.assignmentId) < BigInt(b.assignmentId) ? -1 : BigInt(a.assignmentId) > BigInt(b.assignmentId) ? 1 : 0))
  return values.sort === 'desc' ? rows.reverse() : rows
}

function schedule(result, name, values) {
  check(result.status === 200, `Expected UC11 schedule; observed HTTP ${result.status}`)
  const payload = result.data, page = Number(values.page || 1), pageSize = Number(values.pageSize || 20), all = expected(name, values)
  check(payload?.timezone === 'Asia/Ho_Chi_Minh' && Array.isArray(payload.data) && Object.keys(payload).every(key => ['data', 'pagination', 'timezone'].includes(key)), 'UC11 envelope/timezone was invalid')
  const p = payload.pagination
  check(p?.page === page && p.pageSize === pageSize && p.total === all.length && p.totalPages === Math.ceil(all.length / pageSize), 'UC11 pagination differed from the read-only MySQL snapshot')
  const wanted = all.slice((page - 1) * pageSize, page * pageSize)
  check(payload.data.map(row => row.assignmentId).join(',') === wanted.map(row => row.assignmentId).join(','), 'UC11 returned an incorrect owned overlap/page/sort result')
  for (let index = 0; index < wanted.length; index++) {
    const row = payload.data[index], baseline = wanted[index]
    check(row.id === baseline.assignmentId && row.assignmentId === baseline.assignmentId && row.orderId === baseline.orderId, 'UC11 changed assignment/booking identity')
    check(row.scheduledAt === baseline.scheduledAt && row.expectedEndAt === baseline.expectedEndAt && row.databaseStatus === baseline.databaseStatus, 'UC11 changed saved UTC timestamps or assignment status')
    check(row.status === (baseline.databaseStatus === 'ASSIGNED' ? 'WAITING' : baseline.databaseStatus), 'UC11 status mapping was invalid')
    check(row.contact && Object.keys(row.contact).every(key => ['name', 'address'].includes(key)), 'UC11 exposed detail-only contact fields')
    check(Array.isArray(row.services) && row.services.every(item => id(item.serviceId) && typeof item.quantity === 'string' && typeof item.unitPrice === 'string'), 'UC11 lost service snapshots or decimal precision')
  }
  return payload
}

async function readSchedule(name, cookie, overrides = {}) {
  const values = baseQuery(overrides)
  return schedule(await request(schedulePath(values), { cookie }), name, values)
}

async function login(name) {
  const person = people[name]
  const result = await request('/api/auth/login', { method: 'POST', body: { phone: person.phone, password: person.password } })
  check(result.status === 200, `Real employee ${name} login failed with HTTP ${result.status}`)
  check(result.data?.session?.user?.id === person.userId && result.data.session.user.role === 'EMPLOYEE' && result.data.session.user.status === 'ACTIVE', 'Auth did not confirm the expected active employee')
  const header = result.headers.getSetCookie().find(value => value.startsWith(cookieName + '=')) || '', cookie = header.split(';', 1)[0]
  check(new RegExp('^' + cookieName + '=[A-Za-z0-9_-]{43}$').test(cookie) && /;\s*HttpOnly(?:;|$)/i.test(header), 'Auth BFF did not create an opaque HttpOnly session')
  sessions.add(cookie)
  return cookie
}

async function loadMetadata() {
  const rawPath = process.env.STAFF_UC11_TEST_METADATA_FILE
  check(typeof rawPath === 'string' && rawPath.length, 'A verified, non-PII schedule metadata file is required')
  const root = resolve('.auth-data/qa/uc11'), filename = resolve(rawPath)
  check(filename.startsWith(root + sep) && extname(filename) === '.json', 'UC11 metadata must be a JSON file inside the ignored Staff QA directory')
  const info = await lstat(filename)
  check(info.isFile() && !info.isSymbolicLink() && info.size <= 1048576, 'UC11 metadata file was invalid or too large')
  let payload
  try { payload = JSON.parse(await readFile(filename, 'utf8')) } catch { throw new Error('UC11 metadata JSON could not be read; contents withheld') }
  check(payload?.database === 'cleanhome_staff_test' && Array.isArray(payload.assignments) && payload.assignments.length > 0, 'UC11 metadata must come from the verified test database')
  check(Object.keys(payload).every(key => ['database', 'assignments'].includes(key)), 'UC11 metadata included fields outside the non-PII contract')
  const keys = ['assignmentId', 'orderId', 'userId', 'databaseStatus', 'scheduledAt', 'expectedEndAt']
  const rows = payload.assignments
  check(rows.every(row => row && Object.keys(row).length === keys.length && Object.keys(row).every(key => keys.includes(key)) && [row.assignmentId, row.orderId, row.userId].every(id)
    && databaseStatuses.includes(row.databaseStatus) && iso(row.scheduledAt) && iso(row.expectedEndAt) && Date.parse(row.expectedEndAt) > Date.parse(row.scheduledAt)), 'UC11 metadata row did not match the safe schedule contract')
  check(new Set(rows.map(row => row.assignmentId)).size === rows.length, 'UC11 metadata contained duplicate assignments')
  return rows
}

describe('UC11: real Next.js BFF -> Auth/Staff/MySQL Vietnam schedules, read-only', {
  skip: enabled ? false : 'NOT_RUN: real services, employee A/B credentials and verified non-PII schedule metadata are required',
  concurrency: false, timeout: 180000,
}, () => {
  before(async () => {
    let url
    try { url = new URL(process.env.STAFF_BFF_TEST_BASE_URL || 'http://localhost:3002') } catch { throw new Error('Invalid local Staff BFF origin') }
    check(['http:', 'https:'].includes(url.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash, 'UC11 integration requires a plain loopback Staff BFF origin')
    origin = url.origin
    people = Object.fromEntries(['A', 'B'].map(name => [name, { phone: process.env['STAFF_BFF_TEST_PHONE_' + name], password: process.env['STAFF_BFF_TEST_PASSWORD_' + name], userId: process.env['STAFF_BFF_TEST_USER_ID_' + name] || (name === 'A' ? '9109002' : '9109101') }]))
    check(Object.values(people).every(person => typeof person.phone === 'string' && person.phone.length && typeof person.password === 'string' && person.password.length && id(person.userId)), 'UC11 requires securely injected real A/B credentials and user IDs')
    check(people.A.phone !== people.B.phone && people.A.userId !== people.B.userId, 'UC11 requires two distinct employees')
    metadata = await loadMetadata()
    for (const name of ['A', 'B']) check(metadata.some(row => row.userId === people[name].userId), 'UC11 metadata did not include an existing assigned job for each test employee')
    const relevant = metadata.filter(row => [people.A.userId, people.B.userId].includes(row.userId))
    const first = Math.min(...relevant.map(row => Date.parse(row.scheduledAt))), last = Math.max(...relevant.map(row => Date.parse(row.expectedEndAt) - 1))
    range = { from: vietnamDay(new Date(first).toISOString()), to: vietnamDay(new Date(last).toISOString()) }
    check(Date.parse(range.to) - Date.parse(range.from) <= 365 * dayMs && range.from >= '1971-01-01' && range.to <= '2099-12-31', 'Existing schedule fixture exceeds one bounded API query range')
  })

  after(async () => {
    let failed = false
    for (const cookie of sessions) {
      try { if ((await request('/api/auth/logout', { method: 'POST', body: {}, cookie })).status !== 200) failed = true } catch { failed = true }
    }
    check(!failed, 'QA-created Frontend session cleanup failed; no database cleanup was attempted')
  })

  test('anonymous schedule read is rejected with 401', async () => { expectError(await request(schedulePath(baseQuery())), 401) })
  test('unknown opaque session is rejected with 401', async () => { expectError(await request(schedulePath(baseQuery()), { cookie: cookieName + '=' + randomBytes(32).toString('base64url') }), 401) })
  test('browser Authorization cannot replace the server session', async () => { expectError(await request(schedulePath(baseQuery()), { authorization: 'Bearer not-an-auth-token' }), 401) })

  test('real employee A receives exactly the owned schedule from MySQL', async () => {
    cookieA = await login('A'); baselineA = await readSchedule('A', cookieA)
    check(baselineA.pagination.total > 1 && baselineA.pagination.total <= 100, 'Bounded A schedule fixture must fit one full metadata comparison page')
  })
  test('real employee B receives a separate owned schedule', async () => {
    cookieB = await login('B'); baselineB = await readSchedule('B', cookieB)
    check(baselineB.pagination.total > 0 && baselineB.pagination.total <= 100, 'Bounded B schedule fixture must fit one full metadata comparison page')
    check(baselineA && baselineA.data.every(a => baselineB.data.every(b => a.assignmentId !== b.assignmentId)), 'UC11 leaked assignment ownership between employees')
  })
  test('shared booking keeps separate A/B assignment identities', () => {
    const a = baselineA?.data.find(row => row.assignmentId === '9109133'), b = baselineB?.data.find(row => row.assignmentId === '9109134')
    check(a && b && a.orderId === b.orderId && a.assignmentId !== b.assignmentId, 'Shared booking lost separately owned schedule rows')
  })
  test('several jobs on one Vietnam day are all returned without overwrite', async t => {
    const groups = new Map()
    for (const row of metadata.filter(row => row.userId === people.A.userId)) { const day = vietnamDay(row.scheduledAt); groups.set(day, (groups.get(day) || 0) + 1) }
    const day = [...groups].find(([, count]) => count > 1)?.[0]
    if (!day) { t.skip('NOT_RUN: current MySQL fixture has no employee A day with multiple jobs'); return }
    const value = await readSchedule('A', cookieA, { from: day, to: day })
    check(value.pagination.total > 1 && new Set(value.data.map(row => row.assignmentId)).size === value.data.length, 'Same-day assignments were omitted or overwritten')
  })
  test('different Vietnam days use their own stored overlap ranges', async t => {
    const days = [...new Set(metadata.filter(row => row.userId === people.A.userId).map(row => vietnamDay(row.scheduledAt)))].sort()
    if (days.length < 2) { t.skip('NOT_RUN: existing A schedule does not span multiple calendar days'); return }
    for (const day of [days[0], days[days.length - 1]]) await readSchedule('A', cookieA, { from: day, to: day })
  })
  test('descending schedules reverse stable UTC-start and assignment-ID order', async () => {
    const value = await readSchedule('A', cookieA, { sort: 'desc' })
    check(baselineA && value.data.map(row => row.assignmentId).join(',') === baselineA.data.map(row => row.assignmentId).reverse().join(','), 'UC11 reverse schedule sort was unstable')
  })
  test('page one, page two and an out-of-range page match real totals', async () => {
    for (const page of ['1', '2', '99999']) await readSchedule('A', cookieA, { page, pageSize: '1' })
  })
  test('all supported statuses match the current saved assignment status', async () => {
    for (const status of ['WAITING', ...databaseStatuses]) await readSchedule('A', cookieA, { status })
  })
  test('a metadata-confirmed empty calendar range is empty for both employees', async () => {
    const values = { from: '1971-01-01', to: '1971-01-02' }
    for (const name of ['A', 'B']) {
      check(expected(name, baseQuery(values)).length === 0, 'The selected empty range is not empty in the real metadata')
      const value = await readSchedule(name, name === 'A' ? cookieA : cookieB, values)
      check(value.data.length === 0 && value.pagination.total === 0, 'An empty schedule range was not represented correctly')
    }
  })
  test('from and to include the entire chosen Vietnam calendar day', async () => {
    const day = vietnamDay(metadata.find(row => row.userId === people.A.userId).scheduledAt)
    await readSchedule('A', cookieA, { from: day, to: day })
  })
  test('an existing real UTC/Vietnam date-boundary job uses the correct calendar day', async t => {
    const boundary = metadata.find(row => row.userId === people.A.userId && (vietnamDay(row.scheduledAt) !== row.scheduledAt.slice(0, 10) || vietnamDay(new Date(Date.parse(row.expectedEndAt) - 1).toISOString()) !== new Date(Date.parse(row.expectedEndAt) - 1).toISOString().slice(0, 10)))
    if (!boundary) { t.skip('NOT_RUN: no existing A job crosses the UTC/Vietnam date boundary; unit cases cover this without inserting data'); return }
    const day = vietnamDay(boundary.scheduledAt)
    const value = await readSchedule('A', cookieA, { from: day, to: day })
    check(value.data.some(row => row.assignmentId === boundary.assignmentId), 'A real date-boundary assignment appeared on the wrong day')
  })
  test('leap day, year transition and the inclusive 366-day limit are accepted', async () => {
    for (const values of [{ from: '1972-02-29', to: '1972-02-29' }, { from: '1971-12-31', to: '1972-01-01' }, { from: '1972-01-01', to: '1972-12-31' }]) await readSchedule('A', cookieA, values)
  })
  test('missing, reversed, malformed, nonexistent and overly long dates are rejected', async () => {
    for (const query of ['from=2026-01-01', 'to=2026-01-01', 'from=2026-02-30&to=2026-03-01', 'from=1971-02-29&to=1971-03-01', 'from=2026-01-02&to=2026-01-01', 'from=2026-1-01&to=2026-01-01', 'from=1970-12-31&to=1971-01-01', 'from=2099-12-31&to=2100-01-01', 'from=1972-01-01&to=1973-01-01']) expectError(await request('/api/staff/schedule?' + query, { cookie: cookieA }), 400)
  })
  test('identity overrides, arbitrary URLs, duplicates and invalid pagination are rejected', async () => {
    for (const query of ['employeeId=9109102', 'userId=9109101', 'url=http%3A%2F%2Flocalhost%3A4003%2Finternal', 'from=2026-01-01', 'page=1&page=2', 'page=0', 'pageSize=101', 'sort=arbitrary', 'status=ARBITRARY']) expectError(await request(schedulePath({ from: range.from, to: range.to }) + '&' + query, { cookie: cookieA }), 400)
  })
  test('UC11 cannot proxy mutation methods', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) check((await request(schedulePath(baseQuery()), { method, cookie: cookieA, json: false })).status === 405, 'UC11 allowed an unsupported mutation method')
  })
  test('wrong Origin is denied without destroying the valid employee session', async () => {
    expectError(await request(schedulePath(baseQuery()), { cookie: cookieA, requestOrigin: 'https://attacker.invalid' }), 403)
    const session = await request('/api/auth/session', { cookie: cookieA })
    check(session.status === 200 && session.data?.session?.user?.id === people.A.userId, 'Origin rejection invalidated or changed the valid employee session')
  })
  test('a new request reloads the correct employee schedule', async () => {
    const value = await readSchedule('A', cookieA)
    check(baselineA && sameIds(value.data.map(row => row.assignmentId), baselineA.data.map(row => row.assignmentId)), 'HTTP reload equivalent changed the owned schedule')
  })
  test('logout A then login B cannot reuse A session or schedule data', async () => {
    const logout = await request('/api/auth/logout', { method: 'POST', body: {}, cookie: cookieA })
    check(logout.status === 200 && logout.data?.ok === true, 'Employee A logout failed')
    expectError(await request(schedulePath(baseQuery()), { cookie: cookieA }), 401); sessions.delete(cookieA)
    const switched = await login('B'), value = await readSchedule('B', switched)
    check(switched !== cookieA && baselineB && sameIds(value.data.map(row => row.assignmentId), baselineB.data.map(row => row.assignmentId)), 'Switched employee did not receive B schedule')
    check(baselineA && value.data.every(b => baselineA.data.every(a => a.assignmentId !== b.assignmentId)), 'Previous employee assignments leaked after logout/login')
  })
  test('Customer credentials are refused by the fixed EMPLOYEE login', { skip: !process.env.STAFF_BFF_TEST_PHONE_CUSTOMER || !process.env.STAFF_BFF_TEST_PASSWORD_CUSTOMER }, async () => {
    expectError(await request('/api/auth/login', { method: 'POST', body: { phone: process.env.STAFF_BFF_TEST_PHONE_CUSTOMER, password: process.env.STAFF_BFF_TEST_PASSWORD_CUSTOMER } }), 403)
  })
})
