import { after, before, describe, test } from 'node:test'
import { randomBytes } from 'node:crypto'

// Real Next.js -> Auth/Staff -> existing MySQL, READ-ONLY and guard requests.
// No authorized PATCH, SQL, seed, Order internal request or generated JWT.
// Successful UC12 writes require a separate owner-approved QA manifest.
const enabled = process.env.RUN_STAFF_UC12_HTTP_TESTS === 'true'
const cookieName = 'cleanhome_staff_session'
const sessions = new Set()
const targets = ['ACCEPTED', 'IN_PROGRESS', 'DONE']
const states = ['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'DONE', 'CANCELLED']
let origin, people, cookieA, cookieB, listA, listB, firstA, firstB, missingId

function check(value, message) { if (!value) throw new Error(message) }
function id(value) { return typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n }
function metadata(name) {
  const ids = (process.env['STAFF_UC12_TEST_ASSIGNMENT_IDS_' + name] || '').split(',')
  check(ids.length >= 2 && ids.every(id) && new Set(ids).size === ids.length, 'Verified read-only assignment CSV metadata is required for employees A/B')
  return ids
}
function noSecret(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  check(!/"(?:accessToken|refreshToken|password|passwordHash|password_hash|tokenType|authorization)"\s*:/i.test(text), 'Browser-facing response exposed a credential field')
  check(!/[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/.test(text), 'Browser-facing response exposed a JWT')
  for (const person of Object.values(people || {})) if (person.password) check(!text.includes(person.password), 'Response exposed a submitted credential')
}

async function request(path, options = {}) {
  const { method = 'GET', body, rawBody, cookie, requestOrigin = origin, authorization, key, site, json = true, contentType } = options
  // Defence in depth: this suite must NEVER forward an authenticated mutation.
  // Guard cases remain anonymous even when real A/B sessions exist elsewhere.
  check(method !== 'PATCH' || (!cookie && !authorization), 'Safety gate forbids every credential-bearing UC12 PATCH')
  check(path.startsWith('/api/auth/') || path.startsWith('/api/staff/jobs'), 'Safety gate refused a non-allowlisted BFF path')
  let response, raw
  try {
    response = await fetch(origin + path, {
      method, redirect: 'error', signal: AbortSignal.timeout(20000),
      headers: {
        Accept: 'application/json',
        ...(requestOrigin === null ? {} : { Origin: requestOrigin }),
        ...((body === undefined && rawBody === undefined) || contentType === null ? {} : { 'Content-Type': contentType || 'application/json' }),
        ...(cookie ? { Cookie: cookie } : {}), ...(authorization ? { Authorization: authorization } : {}),
        ...(key === undefined ? {} : { 'Idempotency-Key': key }), ...(site === undefined ? {} : { 'Sec-Fetch-Site': site }),
      },
      ...(rawBody !== undefined ? { body: rawBody } : body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const reader = response.body?.getReader(), chunks = []
    let bytes = 0
    if (reader) {
      try {
        for (;;) {
          const part = await reader.read()
          if (part.done) break
          bytes += part.value.byteLength
          check(bytes <= 1048576, 'UC12 response exceeded the read-only test limit')
          chunks.push(part.value)
        }
      } finally { reader.releaseLock() }
    }
    raw = Buffer.concat(chunks).toString('utf8')
  } catch { throw new Error('UC12 HTTP request failed; request and response contents withheld') }
  noSecret(raw)
  let data = null
  if (json) {
    check(response.headers.get('content-type')?.includes('application/json'), 'Staff BFF did not return JSON')
    try { data = JSON.parse(raw) } catch { throw new Error('Staff BFF returned invalid JSON; contents withheld') }
    noSecret(data)
    check(/no-store/i.test(response.headers.get('cache-control') || ''), 'Staff BFF response could be cached')
  }
  return { status: response.status, data, headers: response.headers }
}

function error(result, expected) {
  check(result.status === expected, `Expected HTTP ${expected}; observed HTTP ${result.status}`)
  check(typeof result.data?.error?.code === 'string' && typeof result.data.error.message === 'string', 'Error lacked structured code/message')
  check(typeof result.data.requestId === 'string' && result.data.requestId.length > 0, 'Error lacked a request ID')
  check(Object.keys(result.data).every(key => ['error', 'requestId', 'operation'].includes(key)), 'Error exposed unexpected upstream data')
  check(Object.keys(result.data.error).every(key => ['code', 'message', 'outcome'].includes(key)), 'Error exposed unexpected upstream details')
  check(!result.data.operation, 'Guard/read-only error exposed another operation context')
  return result.data.error
}

async function login(name) {
  const person = people[name]
  const result = await request('/api/auth/login', { method: 'POST', body: { phone: person.phone, password: person.password } })
  check(result.status === 200, `Real employee ${name} login failed with HTTP ${result.status}`)
  const user = result.data?.session?.user
  check(user?.role === 'EMPLOYEE' && user.status === 'ACTIVE' && id(user.id), 'Auth did not establish an active EMPLOYEE session')
  if (person.userId) check(user.id === person.userId, 'Auth user ID differed from the read-only QA metadata')
  const header = result.headers.getSetCookie().find(value => value.startsWith(cookieName + '=')) || ''
  const cookie = header.split(';', 1)[0]
  check(new RegExp('^' + cookieName + '=[A-Za-z0-9_-]{43}$').test(cookie) && /;\s*HttpOnly(?:;|$)/i.test(header)
    && /;\s*SameSite=Lax(?:;|$)/i.test(header), 'Login did not establish an opaque HttpOnly/SameSite Staff cookie')
  if (origin.startsWith('https:')) check(/;\s*Secure(?:;|$)/i.test(header), 'HTTPS cookie lacked Secure')
  sessions.add(cookie)
  return cookie
}

async function list(name, cookie) {
  const rows = []
  let page = 1, total
  for (;;) {
    check(page <= 20, 'Read-only UC12 QA exceeded the bounded pagination limit')
    const result = await request('/api/staff/jobs?sort=asc&pageSize=100&page=' + page, { cookie })
    check(result.status === 200 && Array.isArray(result.data?.data), 'UC9 could not select real owned assignments')
    const p = result.data.pagination
    check(p?.page === page && p.pageSize === 100 && Number.isSafeInteger(p.total) && p.total >= 0 && p.totalPages === Math.ceil(p.total / 100), 'UC9 pagination was invalid')
    if (total !== undefined) check(total === p.total, 'Assignment count changed during read-only UC12 QA')
    total = p.total
    rows.push(...result.data.data)
    if (page >= p.totalPages) break
    page++
  }
  check(rows.length === total && rows.length === people[name].assignmentIds.length
    && rows.every(row => people[name].assignmentIds.includes(row.assignmentId)), 'Owned assignments differed from the verified read-only MySQL snapshot')
  return rows
}

function projection(result, expected) {
  check(result.status === 200, `Expected owned UC12 status GET; observed HTTP ${result.status}`)
  const dto = result.data, current = dto?.current
  check(current?.assignmentId === expected.assignmentId && current.orderId === expected.orderId, 'UC12 status projection changed assignment/booking identity')
  check(states.includes(current.status) && current.status === (expected.status === 'WAITING' ? 'ASSIGNED' : expected.status), 'UC12 status projection differed from the current assignment')
  check(current.jobStatus === expected.jobStatus && current.orderStatus === expected.orderStatus, 'UC12 status projection differed from the real job/booking state')
  for (const field of ['checkInAt', 'checkOutAt', 'assignedAt']) check(current[field] === expected[field], 'UC12 projection changed a persisted assignment timestamp')
  check(current.cancellationPending === null || typeof current.cancellationPending === 'boolean', 'UC12 fabricated cancellation data')
  check(dto.allowedStatus === null || targets.includes(dto.allowedStatus), 'UC12 offered an invalid next status')
  check(typeof dto.canRetry === 'boolean', 'UC12 omitted safe retry metadata')
  check(dto.blockedReason === null || ['UNRESOLVED_OPERATION', 'ASSIGNMENT_CHANGED', 'NO_NEXT_STATUS', 'BOOKING_NOT_ACTIVE', 'CANCELLATION_PENDING'].includes(dto.blockedReason), 'UC12 returned an unknown block reason')
  if (current.status === 'DONE' || current.status === 'CANCELLED' || ['completed', 'cancelled', 'pending'].includes(current.orderStatus)) check(dto.allowedStatus === null, 'UC12 offered a new transition for an ineligible job')
  if (dto.operation !== null) {
    const op = dto.operation
    check(typeof op?.idempotencyKey === 'string' && /^[A-Za-z0-9._:-]{8,128}$/.test(op.idempotencyKey), 'Recovered operation has an invalid idempotency key')
    check(targets.includes(op.requestedStatus) && ['unknown', 'pending', 'confirmed'].includes(op.phase) && typeof op.observedTarget === 'boolean', 'Recovered operation did not follow the public journal contract')
    check(typeof op.createdAt === 'string' && Number.isFinite(Date.parse(op.createdAt)), 'Recovered operation lacked its durable creation time')
    if (op.phase !== 'confirmed') check(dto.allowedStatus === null, 'An unresolved operation allowed a new transition')
  }
  return dto
}

const path = assignmentId => '/api/staff/jobs/' + encodeURIComponent(assignmentId) + '/status'
const anonymousPatch = (assignmentId = '9109008', options = {}) => request(path(assignmentId), {
  method: 'PATCH', key: 'readonly-guard-key', body: { status: 'ACCEPTED' }, ...options,
})

describe('UC12: real BFF guard and read-only Auth/Staff/MySQL status projection', {
  skip: enabled ? false : 'NOT_RUN: opt-in real Auth/Staff/BFF, A/B credentials and read-only metadata required; no approved QA writes',
  concurrency: false, timeout: 240000,
}, () => {
  before(() => {
    let url
    try { url = new URL(process.env.STAFF_BFF_TEST_BASE_URL || 'http://localhost:3002') } catch { throw new Error('Invalid loopback Staff BFF origin') }
    check(['http:', 'https:'].includes(url.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash, 'UC12 integration requires a plain loopback Staff origin')
    origin = url.origin
    people = Object.fromEntries(['A', 'B'].map(name => [name, {
      phone: process.env['STAFF_BFF_TEST_PHONE_' + name], password: process.env['STAFF_BFF_TEST_PASSWORD_' + name],
      userId: process.env['STAFF_BFF_TEST_USER_ID_' + name], assignmentIds: metadata(name),
    }]))
    check(Object.values(people).every(person => person.phone && person.password), 'Real A/B credentials must be securely injected')
    check(people.A.phone !== people.B.phone && people.A.assignmentIds.every(value => !people.B.assignmentIds.includes(value)), 'A/B ownership metadata must describe distinct employees and assignments')
    missingId = process.env.STAFF_UC12_TEST_MISSING_ID || '9223372036854775807'
    check(id(missingId) && ![...people.A.assignmentIds, ...people.B.assignmentIds].includes(missingId), 'Missing ID must be a valid unused BIGINT')
  })
  after(async () => {
    let failed = false
    for (const cookie of sessions) {
      try { if ((await request('/api/auth/logout', { method: 'POST', body: {}, cookie })).status !== 200) failed = true }
      catch { failed = true }
    }
    check(!failed, 'QA-created session cleanup failed; no database cleanup was attempted')
  })

  test('anonymous status GET returns 401 without an operation context', async () => { error(await request(path('9109008')), 401) })
  test('unknown opaque session returns 401', async () => { error(await request(path('9109008'), { cookie: cookieName + '=' + randomBytes(32).toString('base64url') }), 401) })
  test('client Bearer cannot replace a server session', async () => { error(await request(path('9109008'), { authorization: 'Bearer not-an-auth-token' }), 401) })
  test('valid anonymous PATCH is rejected before any upstream mutation', async () => { error(await anonymousPatch(), 401) })
  test('PATCH requires exact Origin, including refusing a missing Origin', async () => {
    for (const requestOrigin of [null, 'null', 'https://attacker.invalid', origin + '/']) error(await anonymousPatch('9109008', { requestOrigin }), 403)
  })
  test('cross-site fetch metadata is rejected', async () => { error(await anonymousPatch('9109008', { site: 'cross-site' }), 403) })
  test('noncanonical and oversized BIGINT IDs are rejected before authentication', async () => {
    for (const value of ['0', '01', '-1', '9223372036854775808', 'arbitrary']) {
      error(await request(path(value)), 400)
      error(await anonymousPatch(value), 400)
    }
  })
  test('query and identity overrides are rejected', async () => {
    for (const query of ['employeeId=9109102', 'url=http%3A%2F%2Flocalhost%3A4003%2Finternal', 'assignmentId=9109105']) {
      error(await request(path('9109008') + '?' + query), 400)
      error(await request(path('9109008') + '?' + query, { method: 'PATCH', body: { status: 'ACCEPTED' }, key: 'readonly-guard-key' }), 400)
    }
  })
  test('invalid or extra status payloads are rejected before authentication', async () => {
    for (const body of [{}, null, [], { status: 'WAITING' }, { status: 'DONE', employeeId: '9109102' }, { status: 'accepted' }, { status: 1 }]) error(await anonymousPatch('9109008', { body }), 400)
    error(await anonymousPatch('9109008', { body: undefined, rawBody: '{' }), 400)
  })
  test('missing, short, oversized or noncontract idempotency keys are rejected', async () => {
    for (const key of [undefined, '', 'short', 'x'.repeat(129), 'contains space', 'slash/key']) error(await anonymousPatch('9109008', { key }), 400)
  })
  test('non-JSON status bodies are refused', async () => { error(await anonymousPatch('9109008', { contentType: 'text/plain' }), 415) })
  test('oversized status body is refused', async () => { error(await anonymousPatch('9109008', { body: undefined, rawBody: JSON.stringify({ status: 'ACCEPTED', extra: 'x'.repeat(5000) }) }), 413) })
  test('status route cannot proxy unsupported methods', async () => {
    for (const method of ['POST', 'PUT', 'DELETE']) check((await request(path('9109008'), { method, json: false })).status === 405, 'Status route accepted an unsupported method')
  })
  test('real employee A logs in and reads owned current status', async () => {
    cookieA = await login('A'); listA = await list('A', cookieA)
    check(listA.length > 0, 'Employee A needs existing assignments for read-only QA')
    firstA = projection(await request(path(listA[0].assignmentId), { cookie: cookieA }), listA[0])
  })
  test('real employee B logs in and reads owned current status', async () => {
    cookieB = await login('B'); listB = await list('B', cookieB)
    check(listB.length > 0, 'Employee B needs existing assignments for read-only QA')
    firstB = projection(await request(path(listB[0].assignmentId), { cookie: cookieB }), listB[0])
  })
  test('A cannot read B assignment status or journal context', async () => {
    check(firstB && cookieA, 'A/B setup did not complete'); error(await request(path(firstB.current.assignmentId), { cookie: cookieA }), 404)
  })
  test('B cannot read A assignment status or journal context', async () => {
    check(firstA && cookieB, 'A/B setup did not complete'); error(await request(path(firstA.current.assignmentId), { cookie: cookieB }), 404)
  })
  test('missing assignment and another employee assignment have the same safe 404', async () => {
    check(firstB && cookieA, 'A/B setup did not complete')
    const missing = error(await request(path(missingId), { cookie: cookieA }), 404)
    const foreign = error(await request(path(firstB.current.assignmentId), { cookie: cookieA }), 404)
    check(missing.code === foreign.code && missing.message === foreign.message, 'Status lookup leaked foreign assignment existence')
  })
  test('a shared booking still has separate A/B status projections', async () => {
    const a = listA?.find(row => listB?.some(other => other.orderId === row.orderId))
    const b = listB?.find(row => row.orderId === a?.orderId)
    check(a && b && a.assignmentId !== b.assignmentId, 'Read-only QA needs an existing shared-booking fixture')
    const ownA = projection(await request(path(a.assignmentId), { cookie: cookieA }), a)
    const ownB = projection(await request(path(b.assignmentId), { cookie: cookieB }), b)
    check(ownA.current.orderId === ownB.current.orderId, 'Shared booking identity changed in status projections')
  })
  test('fresh status reads preserve projection without generating an operation', async () => {
    check(firstA && cookieA, 'Employee A setup did not complete')
    const fresh = projection(await request(path(firstA.current.assignmentId), { cookie: cookieA }), listA[0])
    check(JSON.stringify(fresh) === JSON.stringify(firstA), 'Read-only status GET changed the projection or operation context')
  })
  test('wrong-Origin GET does not revoke the valid employee session', async () => {
    check(firstA && cookieA, 'Employee A setup did not complete')
    error(await request(path(firstA.current.assignmentId), { cookie: cookieA, requestOrigin: 'https://attacker.invalid' }), 403)
    const session = await request('/api/auth/session', { cookie: cookieA })
    check(session.status === 200 && session.data?.session?.user?.role === 'EMPLOYEE', 'Origin rejection revoked an unrelated valid session')
    projection(await request(path(firstA.current.assignmentId), { cookie: cookieA }), listA[0])
  })
  test('logout invalidates the old status session and relogin cannot switch ownership', async () => {
    check(firstA && firstB && cookieA, 'Employee setup did not complete')
    check((await request('/api/auth/logout', { method: 'POST', body: {}, cookie: cookieA })).status === 200, 'Employee A logout failed')
    error(await request(path(firstA.current.assignmentId), { cookie: cookieA }), 401)
    sessions.delete(cookieA)
    const switched = await login('B')
    error(await request(path(firstA.current.assignmentId), { cookie: switched }), 404)
    projection(await request(path(firstB.current.assignmentId), { cookie: switched }), listB[0])
  })
  test('Customer credentials cannot establish an EMPLOYEE session', { skip: !process.env.STAFF_BFF_TEST_PHONE_CUSTOMER || !process.env.STAFF_BFF_TEST_PASSWORD_CUSTOMER }, async () => {
    error(await request('/api/auth/login', { method: 'POST', body: { phone: process.env.STAFF_BFF_TEST_PHONE_CUSTOMER, password: process.env.STAFF_BFF_TEST_PASSWORD_CUSTOMER } }), 403)
  })
})
