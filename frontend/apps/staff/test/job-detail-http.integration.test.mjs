import { after, before, describe, test } from 'node:test'
import { randomBytes } from 'node:crypto'

// Real Auth -> Next.js Staff BFF -> Staff -> existing MySQL, opt-in only.
// No SQL/seed, Auth vault/key access, JWT generation or UC11/UC12 request.
const enabled = process.env.RUN_STAFF_UC10_HTTP_TESTS === 'true'
const cookieName = 'cleanhome_staff_session'
const sessions = new Set()
const listFields = ['id', 'assignmentId', 'orderId', 'jobCode', 'orderCode', 'status', 'databaseStatus', 'jobStatus', 'orderStatus', 'scheduledAt', 'expectedEndAt', 'durationMinutes', 'assignedAt', 'checkInAt', 'checkOutAt', 'services']
const unknownContact = ['houseType', 'area', 'rooms', 'floors', 'hasPets']
let origin, people, cookieA, cookieB, listA, listB, detailA, detailB, missingId

function check(value, message) {
  // Never attach response/actual objects: test failures must not disclose PII.
  if (!value) throw new Error(message)
}

function canonicalId(value) {
  return typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n
}

function idsFromEnvironment(name) {
  const value = process.env['STAFF_UC10_TEST_ASSIGNMENT_IDS_' + name]
  const ids = typeof value === 'string' ? value.split(',') : []
  check(ids.length >= 2 && ids.every(canonicalId) && new Set(ids).size === ids.length, 'Verified read-only assignment CSV metadata is required for both test employees')
  return ids
}

function sameIds(a, b) {
  return a.length === b.length && new Set(a).size === a.length && a.every(id => b.includes(id))
}

function noSecret(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  check(!/"(?:accessToken|refreshToken|password|passwordHash|password_hash|tokenType)"\s*:/i.test(text), 'Browser-facing response exposed a credential field')
  check(!/[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/.test(text), 'Browser-facing response exposed a JWT')
  for (const person of Object.values(people || {})) if (person.password) check(!text.includes(person.password), 'Browser-facing response exposed a submitted credential')
  if (process.env.STAFF_BFF_TEST_PASSWORD_CUSTOMER) check(!text.includes(process.env.STAFF_BFF_TEST_PASSWORD_CUSTOMER), 'Browser-facing response exposed a submitted credential')
}

async function request(path, { method = 'GET', body, cookie, requestOrigin = origin, authorization, json = true } = {}) {
  let response, raw
  try {
    response = await fetch(origin + path, {
      method, redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: {
        Accept: 'application/json',
        ...(requestOrigin === null ? {} : { Origin: requestOrigin }),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(cookie ? { Cookie: cookie } : {}),
        ...(authorization ? { Authorization: authorization } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const chunks = [], reader = response.body?.getReader()
    let bytes = 0
    if (reader) {
      try {
        for (;;) {
          const chunk = await reader.read()
          if (chunk.done) break
          bytes += chunk.value.byteLength
          check(bytes <= 1048576, 'UC10 response exceeded the integration-test limit')
          chunks.push(chunk.value)
        }
      } finally { reader.releaseLock() }
    }
    raw = Buffer.concat(chunks).toString('utf8')
  } catch { throw new Error('UC10 HTTP request failed; request and response contents withheld') }
  noSecret(raw)
  let data = null
  if (json) {
    check(response.headers.get('content-type')?.includes('application/json'), 'Staff BFF did not return JSON')
    try { data = JSON.parse(raw) } catch { throw new Error('Staff BFF returned invalid JSON; body withheld') }
    noSecret(data)
    check(/no-store/i.test(response.headers.get('cache-control') || ''), 'Staff BFF response could be cached')
  }
  return { status: response.status, data, headers: response.headers }
}

function expectError(result, status) {
  check(result.status === status, `Expected HTTP ${status}; observed HTTP ${result.status}`)
  check(typeof result.data?.error?.code === 'string' && typeof result.data.error.message === 'string', 'Error lacked a structured code/message')
  check(typeof result.data?.requestId === 'string' && result.data.requestId.length > 0, 'Error lacked a request ID')
  check(Object.keys(result.data).every(key => ['error', 'requestId'].includes(key)), 'Error exposed assignment or profile data')
  check(Object.keys(result.data.error).every(key => ['code', 'message'].includes(key)), 'Error exposed unexpected upstream details')
  return result.data.error
}

async function login(name) {
  const person = people[name]
  const result = await request('/api/auth/login', { method: 'POST', body: { phone: person.phone, password: person.password } })
  check(result.status === 200, `Real employee ${name} login failed with HTTP ${result.status}`)
  const user = result.data?.session?.user
  check(user?.role === 'EMPLOYEE' && user.status === 'ACTIVE' && canonicalId(user.id), 'Auth did not establish an active employee session')
  if (person.userId) check(user.id === person.userId, 'Auth identity differed from the test employee metadata')
  const value = result.headers.getSetCookie().find(header => header.startsWith(cookieName + '=')) || ''
  const cookie = value.split(';', 1)[0]
  check(new RegExp('^' + cookieName + '=[A-Za-z0-9_-]{43}$').test(cookie) && /;\s*HttpOnly(?:;|$)/i.test(value), 'Login did not establish an opaque HttpOnly Staff cookie')
  sessions.add(cookie)
  return cookie
}

async function ownedList(name, cookie) {
  const rows = []
  let page = 1, total
  for (;;) {
    check(page <= 20, 'UC10 QA exceeded the bounded fixture pagination limit')
    const result = await request('/api/staff/jobs?sort=asc&pageSize=100&page=' + page, { cookie })
    check(result.status === 200 && Array.isArray(result.data?.data), 'UC9 could not select real owned assignments')
    const p = result.data.pagination
    check(p?.page === page && p.pageSize === 100 && Number.isSafeInteger(p.total) && p.total >= 0 && p.totalPages === Math.ceil(p.total / 100), 'UC9 pagination metadata was invalid')
    if (total !== undefined) check(total === p.total, 'Assignment data changed during read-only QA')
    total = p.total
    rows.push(...result.data.data)
    if (page >= p.totalPages) break
    page++
  }
  check(rows.length === total && sameIds(rows.map(row => row.assignmentId), people[name].assignmentIds), 'UC9 owned assignments differed from the read-only MySQL snapshot')
  check(rows.every(row => row.id === row.assignmentId && canonicalId(row.assignmentId) && canonicalId(row.orderId)), 'UC9 assignment identity was invalid')
  return rows
}

function detail(result, expected) {
  check(result.status === 200, `Expected owned UC10 detail; observed HTTP ${result.status}`)
  check(result.data && Object.keys(result.data).length === 1 && Object.hasOwn(result.data, 'data'), 'UC10 detail envelope differed from the Staff contract')
  const job = result.data.data
  check(job && !Array.isArray(job) && canonicalId(job.assignmentId), 'UC10 did not return an assignment DTO')
  for (const field of listFields) check(JSON.stringify(job[field]) === JSON.stringify(expected[field]), 'UC10 detail did not preserve the existing list DTO values')
  check(job.contact?.name === expected.contact.name && job.contact.address === expected.contact.address, 'UC10 contact snapshot differed from the owned job')
  check(job.contact.phone === null || typeof job.contact.phone === 'string', 'UC10 contact phone did not follow the nullable contract')
  check(unknownContact.every(field => job.contact[field] === null), 'UC10 fabricated unsupported home/contact attributes')
  check(job.specialRequest === null, 'UC10 fabricated a special request unavailable in the schema')
  check(job.cancellationPending === null || typeof job.cancellationPending === 'boolean', 'UC10 cancellation state was not nullable')
  check(job.orderHistory === null || Array.isArray(job.orderHistory), 'UC10 optional history did not follow the Staff contract')
  check(['order-service-not-loaded', 'order-service', 'order-service-unavailable'].includes(job.historySource), 'UC10 history provenance was invalid')
  check(Array.isArray(job.unsupportedFields) && job.unsupportedFields.every(field => typeof field === 'string'), 'UC10 omitted the unsupported-field contract')
  check(['jobCode', 'orderCode', ...unknownContact, 'specialRequest'].every(field => job.unsupportedFields.includes(field)), 'UC10 concealed unsupported source fields')
  if (job.cancellationPending === null) check(job.unsupportedFields.includes('cancellationPending'), 'UC10 treated unknown cancellation state as known')
  for (const field of ['scheduledAt', 'expectedEndAt', 'assignedAt', 'checkInAt', 'checkOutAt']) {
    check(job[field] === null || typeof job[field] === 'string' && Number.isFinite(Date.parse(job[field])) && new Date(job[field]).toISOString() === job[field], 'UC10 timestamp was not an ISO UTC value')
  }
  return job
}

async function assertSession(cookie, userId) {
  const result = await request('/api/auth/session', { cookie })
  check(result.status === 200 && result.data?.session?.user?.role === 'EMPLOYEE', 'A rejected UC10 read invalidated a valid employee session')
  if (userId) check(result.data.session.user.id === userId, 'Employee identity changed after a rejected read')
}

const detailPath = id => '/api/staff/jobs/' + encodeURIComponent(id)

describe('UC10: real Next.js BFF -> Auth/Staff/MySQL owned detail, read-only', {
  skip: enabled ? false : 'NOT_RUN: real Auth/Staff/BFF, A/B credentials and verified assignment metadata are required',
  concurrency: false, timeout: 180000,
}, () => {
  before(() => {
    let url
    try { url = new URL(process.env.STAFF_BFF_TEST_BASE_URL || 'http://localhost:3002') } catch { throw new Error('Invalid local Staff BFF origin') }
    check(['http:', 'https:'].includes(url.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'UC10 integration requires a loopback Staff BFF')
    check(!url.username && !url.password && url.pathname === '/' && !url.search && !url.hash, 'UC10 integration requires a plain local origin')
    origin = url.origin
    people = Object.fromEntries(['A', 'B'].map(name => [name, {
      phone: process.env['STAFF_BFF_TEST_PHONE_' + name], password: process.env['STAFF_BFF_TEST_PASSWORD_' + name],
      userId: process.env['STAFF_BFF_TEST_USER_ID_' + name], assignmentIds: idsFromEnvironment(name),
    }]))
    check(Object.values(people).every(person => typeof person.phone === 'string' && person.phone.length && typeof person.password === 'string' && person.password.length), 'UC10 integration requires securely injected real A/B credentials')
    check(people.A.phone !== people.B.phone && people.A.assignmentIds.every(id => !people.B.assignmentIds.includes(id)), 'UC10 authorization requires distinct employees and disjoint assignment metadata')
    missingId = process.env.STAFF_UC10_TEST_MISSING_ID || '9223372036854775807'
    check(canonicalId(missingId) && ![...people.A.assignmentIds, ...people.B.assignmentIds].includes(missingId), 'Missing-assignment metadata must be a valid unused BIGINT ID')
  })

  after(async () => {
    let failed = false
    for (const cookie of sessions) {
      try {
        const result = await request('/api/auth/logout', { method: 'POST', body: {}, cookie })
        if (result.status !== 200) failed = true
      } catch { failed = true }
    }
    check(!failed, 'QA-created session cleanup failed; no database cleanup was attempted')
  })

  test('anonymous UC10 read returns 401 without assignment data', async () => {
    expectError(await request(detailPath('9109008')), 401)
  })

  test('unknown opaque session returns 401', async () => {
    expectError(await request(detailPath('9109008'), { cookie: cookieName + '=' + randomBytes(32).toString('base64url') }), 401)
  })

  test('a client Authorization header cannot replace the server session', async () => {
    expectError(await request(detailPath('9109008'), { authorization: 'Bearer not-an-auth-token' }), 401)
  })

  test('real employee A logs in and selects assignments from UC9', async () => {
    cookieA = await login('A')
    listA = await ownedList('A', cookieA)
    check(listA.length > 0, 'Employee A needs an existing assigned job for UC10 QA')
  })

  test('A can read owned detail with the correct booking, services, contact and timestamps', async () => {
    check(listA?.length, 'Employee A setup did not complete')
    detailA = detail(await request(detailPath(listA[0].assignmentId), { cookie: cookieA }), listA[0])
  })

  test('real employee B logs in and reads only B-owned detail', async () => {
    cookieB = await login('B')
    listB = await ownedList('B', cookieB)
    check(listB.length > 0, 'Employee B needs an existing assigned job for UC10 QA')
    detailB = detail(await request(detailPath(listB[0].assignmentId), { cookie: cookieB }), listB[0])
  })

  test('A cannot read a B-only assignment by changing the URL ID', async () => {
    check(detailB, 'Employee B detail setup did not complete')
    expectError(await request(detailPath(detailB.assignmentId), { cookie: cookieA }), 404)
    await assertSession(cookieA, people.A.userId)
  })

  test('B cannot read an A-only assignment by changing the URL ID', async () => {
    check(detailA, 'Employee A detail setup did not complete')
    expectError(await request(detailPath(detailA.assignmentId), { cookie: cookieB }), 404)
    await assertSession(cookieB, people.B.userId)
  })

  test('a shared booking preserves two separately owned assignment details', async () => {
    const a = listA?.find(job => job.assignmentId === '9109133'), b = listB?.find(job => job.assignmentId === '9109134')
    check(a && b && a.orderId === b.orderId, 'Existing shared-booking fixture was not present in both owned lists')
    detail(await request(detailPath(a.assignmentId), { cookie: cookieA }), a)
    detail(await request(detailPath(b.assignmentId), { cookie: cookieB }), b)
    expectError(await request(detailPath(b.assignmentId), { cookie: cookieA }), 404)
    expectError(await request(detailPath(a.assignmentId), { cookie: cookieB }), 404)
  })

  test('missing and cross-employee assignments have the same safe 404 error', async () => {
    check(detailB, 'Employee B detail setup did not complete')
    const missing = expectError(await request(detailPath(missingId), { cookie: cookieA }), 404)
    const forbidden = expectError(await request(detailPath(detailB.assignmentId), { cookie: cookieA }), 404)
    check(missing.code === forbidden.code && missing.message === forbidden.message, 'UC10 disclosed whether another employee assignment exists')
    await assertSession(cookieA, people.A.userId)
  })

  test('invalid BIGINT IDs are rejected before reading assignment data', async () => {
    for (const value of ['0', '01', '-1', '9223372036854775808', '100000000000000000000', 'arbitrary']) {
      expectError(await request(detailPath(value), { cookie: cookieA }), 400)
    }
  })

  test('encoded path separators cannot turn UC10 into an arbitrary path proxy', async () => {
    for (const value of ['9109008/../../internal', 'https://localhost:4003/internal', '9109008\\status']) {
      const result = await request(detailPath(value), { cookie: cookieA, json: false })
      check([400, 404].includes(result.status), 'Encoded path content bypassed the assignment-ID boundary')
    }
  })

  test('all query overrides are rejected without changing employee identity', async () => {
    check(detailA, 'Employee A detail setup did not complete')
    for (const query of ['employeeId=9109102', 'userId=9109101', 'from=2026-10-01', 'url=http%3A%2F%2Flocalhost%3A4003%2Finternal', 'assignmentId=9109105']) {
      expectError(await request(detailPath(detailA.assignmentId) + '?' + query, { cookie: cookieA }), 400)
    }
    await assertSession(cookieA, people.A.userId)
  })

  test('UC10 cannot proxy POST, PUT, PATCH or DELETE mutations', async () => {
    check(detailA, 'Employee A detail setup did not complete')
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const result = await request(detailPath(detailA.assignmentId), { method, cookie: cookieA, json: false })
      check(result.status === 405, 'UC10 allowed an unsupported mutation method')
    }
  })

  test('wrong Origin returns 403 without revoking a valid employee session', async () => {
    check(detailA, 'Employee A detail setup did not complete')
    expectError(await request(detailPath(detailA.assignmentId), { cookie: cookieA, requestOrigin: 'https://attacker.invalid' }), 403)
    await assertSession(cookieA, people.A.userId)
    detail(await request(detailPath(detailA.assignmentId), { cookie: cookieA }), listA[0])
  })

  test('a new request reloads the same owned detail without frontend storage', async () => {
    check(detailA, 'Employee A detail setup did not complete')
    const value = detail(await request(detailPath(detailA.assignmentId), { cookie: cookieA }), listA[0])
    check(JSON.stringify(value) === JSON.stringify(detailA), 'Read-only detail changed across a new request')
  })

  test('logout A then login B cannot read the previously opened A detail', async () => {
    check(detailA && detailB, 'Employee detail setup did not complete')
    const logout = await request('/api/auth/logout', { method: 'POST', body: {}, cookie: cookieA })
    check(logout.status === 200 && logout.data?.ok === true, 'Employee A logout failed')
    expectError(await request(detailPath(detailA.assignmentId), { cookie: cookieA }), 401)
    sessions.delete(cookieA)
    const switched = await login('B')
    check(switched !== cookieA, 'Switching employee reused the previous opaque session')
    expectError(await request(detailPath(detailA.assignmentId), { cookie: switched }), 404)
    detail(await request(detailPath(detailB.assignmentId), { cookie: switched }), listB[0])
  })

  test('valid Customer credentials are refused by the fixed EMPLOYEE login', { skip: !process.env.STAFF_BFF_TEST_PHONE_CUSTOMER || !process.env.STAFF_BFF_TEST_PASSWORD_CUSTOMER }, async () => {
    expectError(await request('/api/auth/login', { method: 'POST', body: { phone: process.env.STAFF_BFF_TEST_PHONE_CUSTOMER, password: process.env.STAFF_BFF_TEST_PASSWORD_CUSTOMER } }), 403)
  })
})
