import { after, before, describe, test } from 'node:test'
import { randomBytes } from 'node:crypto'

// Opt-in: real Next.js BFF -> real Auth/Staff -> existing MySQL fixture.
// No JWT is minted/read by this suite. No SQL, seed or UC10-UC12 is called.
const enabled = process.env.RUN_STAFF_UC9_HTTP_TESTS === 'true'
const cookieName = 'cleanhome_staff_session'
const fixtures = {
  A: ['9109008', '9109113', '9109123', '9109133'],
  B: ['9109105', '9109134'],
}
const sessions = new Set()
let origin, people, cookieA, cookieB, dataA, dataB, switchedCookie

function check(value, message) {
  // Boolean assertions avoid node:test printing credentials or response bodies.
  if (!value) throw new Error(message)
}

function sameIds(actual, expected) {
  return actual.length === expected.length && new Set(actual).size === actual.length
    && actual.every(id => expected.includes(id))
}

function noSecret(body) {
  const text = JSON.stringify(body)
  check(!/"(?:accessToken|refreshToken|tokenType|password|passwordHash|password_hash)"\s*:/i.test(text), 'Response exposed a credential field')
  check(!/[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/.test(text), 'Response exposed a JWT')
  for (const person of Object.values(people || {})) check(!text.includes(person.password), 'Response exposed a submitted credential')
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
    const reader = response.body?.getReader(), chunks = []
    let bytes = 0
    if (reader) {
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          bytes += value.byteLength
          check(bytes <= 1024 * 1024, 'Response exceeded the integration-test limit')
          chunks.push(value)
        }
      } finally { reader.releaseLock() }
    }
    raw = Buffer.concat(chunks).toString('utf8')
  } catch { throw new Error('UC9 HTTP request failed; request and response contents withheld') }
  let data = null
  if (json) {
    check(response.headers.get('content-type')?.includes('application/json'), 'UC9 BFF did not return JSON')
    try { data = JSON.parse(raw) } catch { throw new Error('UC9 BFF returned invalid JSON; response withheld') }
    noSecret(data)
    check(/no-store/i.test(response.headers.get('cache-control') || ''), 'UC9 response must not be cached')
  }
  return { status: response.status, data, headers: response.headers }
}

function expectError(result, status) {
  check(result.status === status, `Expected HTTP ${status}; observed HTTP ${result.status}`)
  check(typeof result.data?.error?.code === 'string' && typeof result.data?.error?.message === 'string', 'Error response lacked a safe structured error')
  check(typeof result.data?.requestId === 'string' && result.data.requestId.length > 0, 'Error response lacked a request ID')
}

function jobs(result, { page = 1, pageSize = 100 } = {}) {
  check(result.status === 200, `Expected a UC9 list; observed HTTP ${result.status}`)
  const value = result.data
  check(value?.timezone === 'Asia/Ho_Chi_Minh' && Array.isArray(value.data), 'UC9 list/timezone did not match the Staff contract')
  check(Object.keys(value).every(key => ['data', 'pagination', 'timezone'].includes(key)), 'UC9 returned an unexpected top-level field')
  const p = value.pagination
  check(p?.page === page && p.pageSize === pageSize && Number.isSafeInteger(p.total) && p.total >= 0, 'UC9 pagination did not match the request')
  check(p.totalPages === Math.ceil(p.total / p.pageSize) && value.data.length <= pageSize, 'UC9 pagination totals were inconsistent')
  for (const job of value.data) {
    check(typeof job.assignmentId === 'string' && /^[1-9]\d*$/.test(job.assignmentId) && job.id === job.assignmentId, 'UC9 did not preserve the assignment identifier')
    check(typeof job.orderId === 'string' && /^[1-9]\d*$/.test(job.orderId), 'UC9 booking ID was invalid')
    check(Number.isFinite(Date.parse(job.scheduledAt)) && Number.isFinite(Date.parse(job.expectedEndAt)), 'UC9 schedule was invalid')
    check(['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'DONE', 'CANCELLED'].includes(job.databaseStatus), 'UC9 assignment status was invalid')
    check(job.contact && Object.keys(job.contact).every(key => ['name', 'address'].includes(key)), 'UC9 exposed contact fields outside the list contract')
    check(Array.isArray(job.services) && job.services.every(item => typeof item.serviceId === 'string' && typeof item.quantity === 'string' && typeof item.unitPrice === 'string'), 'UC9 lost service snapshots or DECIMAL precision')
  }
  return value
}

async function login(name) {
  const result = await request('/api/auth/login', { method: 'POST', body: { phone: people[name].phone, password: people[name].password } })
  check(result.status === 200, `Real employee ${name} login failed with HTTP ${result.status}`)
  check(result.data?.session?.user?.role === 'EMPLOYEE' && result.data.session.user.status === 'ACTIVE', 'BFF did not confirm an active employee')
  if (people[name].userId) check(result.data.session.user.id === people[name].userId, 'Real Auth identity did not match the expected employee')
  const header = result.headers.getSetCookie().find(value => value.startsWith(cookieName + '=')) || ''
  const cookie = header.split(';', 1)[0]
  check(new RegExp('^' + cookieName + '=[A-Za-z0-9_-]{43,128}$').test(cookie) && /;\s*HttpOnly(?:;|$)/i.test(header), 'BFF login did not create an opaque HttpOnly session')
  sessions.add(cookie)
  return cookie
}

function expectedIds(name) {
  const raw = process.env['STAFF_UC9_TEST_ASSIGNMENT_IDS_' + name]
  if (!raw) return { ids: fixtures[name], exact: false }
  const ids = raw.split(',')
  check(ids.length >= 2 && ids.every(id => /^[1-9]\d*$/.test(id)) && new Set(ids).size === ids.length, 'Expected assignment metadata must contain distinct canonical IDs')
  return { ids, exact: true }
}

function compareExpected(name, actual) {
  const expected = expectedIds(name)
  check(expected.ids.every(id => actual.includes(id)), 'UC9 omitted an assignment owned by the expected test employee')
  if (expected.exact) check(sameIds(actual, expected.ids), 'UC9 assignment set differed from the read-only MySQL snapshot')
  check(fixtures[name === 'A' ? 'B' : 'A'].every(id => !actual.includes(id)), 'UC9 leaked an assignment owned by the other employee')
}

function compareSchedule(left, right) {
  const byTime = Date.parse(left.scheduledAt) - Date.parse(right.scheduledAt)
  if (byTime) return byTime
  return BigInt(left.assignmentId) < BigInt(right.assignmentId) ? -1 : BigInt(left.assignmentId) === BigInt(right.assignmentId) ? 0 : 1
}

describe('UC9: real Next.js BFF -> Auth/Staff/MySQL, read-only jobs', {
  skip: enabled ? false : 'NOT_RUN: opt in only with running real Auth/Staff/BFF and securely supplied A/B credentials',
  concurrency: false, timeout: 180000,
}, () => {
  before(() => {
    let url
    try { url = new URL(process.env.STAFF_BFF_TEST_BASE_URL || 'http://localhost:3002') } catch { throw new Error('Invalid local Staff BFF test origin') }
    check(['http:', 'https:'].includes(url.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'UC9 integration is restricted to a loopback Staff BFF')
    check(!url.username && !url.password && url.pathname === '/' && !url.search && !url.hash, 'UC9 test URL must be a plain local origin')
    origin = url.origin
    people = Object.fromEntries(['A', 'B'].map(name => [name, {
      phone: process.env['STAFF_BFF_TEST_PHONE_' + name], password: process.env['STAFF_BFF_TEST_PASSWORD_' + name],
      userId: process.env['STAFF_BFF_TEST_USER_ID_' + name],
    }]))
    check(Object.values(people).every(person => typeof person.phone === 'string' && person.phone.length > 0 && typeof person.password === 'string' && person.password.length > 0), 'UC9 integration requires securely injected real employee A/B credentials')
    check(people.A.phone !== people.B.phone, 'UC9 authorization requires two distinct test employees')
  })

  after(async () => {
    for (const cookie of sessions) {
      try {
        const result = await request('/api/auth/logout', { method: 'POST', body: {}, cookie })
        check(result.status === 200, 'Could not revoke a QA-created Frontend session')
      } catch { throw new Error('QA session cleanup failed; no database cleanup was attempted') }
    }
  })

  test('missing session cannot read UC9', async () => { expectError(await request('/api/staff/jobs'), 401) })

  test('unknown opaque session cannot read UC9', async () => {
    expectError(await request('/api/staff/jobs', { cookie: cookieName + '=' + randomBytes(32).toString('base64url') }), 401)
  })

  test('a browser Authorization header cannot replace the server session', async () => {
    expectError(await request('/api/staff/jobs', { authorization: 'Bearer not-an-auth-token' }), 401)
  })

  test('employee A signs in through the real Auth BFF', async () => { cookieA = await login('A') })

  test('employee A receives only the assignments owned by A', async () => {
    check(cookieA, 'Employee A setup did not complete')
    dataA = jobs(await request('/api/staff/jobs?page=1&pageSize=100&sort=asc', { cookie: cookieA }))
    check(dataA.pagination.total === dataA.data.length, 'The read-only fixture exceeded the bounded first-page check')
    compareExpected('A', dataA.data.map(job => job.assignmentId))
  })

  test('employee B signs in and receives a separate assignment set', async () => {
    cookieB = await login('B')
    dataB = jobs(await request('/api/staff/jobs?page=1&pageSize=100&sort=asc', { cookie: cookieB }))
    check(dataB.pagination.total === dataB.data.length, 'The read-only fixture exceeded the bounded first-page check')
    compareExpected('B', dataB.data.map(job => job.assignmentId))
    check(dataA && dataA.data.every(a => dataB.data.every(b => a.assignmentId !== b.assignmentId)), 'Employee assignment lists overlapped')
  })

  test('one booking with two employees remains two separately owned assignments', () => {
    check(dataA && dataB, 'Employee list setup did not complete')
    const a = dataA.data.find(job => job.assignmentId === '9109133'), b = dataB.data.find(job => job.assignmentId === '9109134')
    check(a && b && a.orderId === b.orderId && a.assignmentId !== b.assignmentId, 'Shared booking lost the separate assignment identities')
  })

  test('ascending and descending schedules use stable assignment-ID ordering', async () => {
    check(dataA, 'Employee A list setup did not complete')
    check(dataA.data.every((job, index) => index === 0 || compareSchedule(dataA.data[index - 1], job) <= 0), 'UC9 ascending order was unstable')
    const reverse = jobs(await request('/api/staff/jobs?page=1&pageSize=100&sort=desc', { cookie: cookieA }))
    check(reverse.data.map(job => job.assignmentId).join(',') === dataA.data.map(job => job.assignmentId).reverse().join(','), 'UC9 descending order was not the reverse stable schedule order')
  })

  test('page-size one and page two neither repeat nor omit the expected assignments', async () => {
    check(dataA?.data.length >= 2, 'UC9 pagination fixture needs at least two owned assignments')
    for (const page of [1, 2]) {
      const value = jobs(await request('/api/staff/jobs?page=' + page + '&pageSize=1&sort=asc', { cookie: cookieA }), { page, pageSize: 1 })
      check(value.pagination.total === dataA.pagination.total && value.data.length === 1 && value.data[0].assignmentId === dataA.data[page - 1].assignmentId, 'UC9 pagination changed the stable ordered result')
    }
  })

  test('all supported status filters match the current stored statuses', async () => {
    check(dataA, 'Employee A list setup did not complete')
    for (const status of ['WAITING', 'ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'DONE', 'CANCELLED']) {
      const databaseStatus = status === 'WAITING' ? 'ASSIGNED' : status
      const expected = dataA.data.filter(job => job.databaseStatus === databaseStatus).map(job => job.assignmentId)
      const value = jobs(await request('/api/staff/jobs?status=' + status + '&pageSize=100&sort=asc', { cookie: cookieA }))
      check(sameIds(value.data.map(job => job.assignmentId), expected) && value.pagination.total === expected.length, 'UC9 status filter disagreed with the current owned assignment set')
    }
  })

  test('an out-of-range page is empty without pretending the employee has no jobs', async () => {
    const value = jobs(await request('/api/staff/jobs?page=99999&pageSize=100', { cookie: cookieA }), { page: 99999 })
    check(value.data.length === 0 && dataA && value.pagination.total === dataA.pagination.total, 'UC9 out-of-range page metadata was incorrect')
  })

  test('identity overrides, unsupported queries, duplicates and invalid pagination are rejected', async () => {
    for (const query of ['employeeId=9109102', 'userId=9109101', 'url=http%3A%2F%2Flocalhost%3A4003%2Finternal%2F', 'page=1&page=2', 'sort=arbitrary', 'page=0', 'pageSize=101', 'status=ARBITRARY']) {
      expectError(await request('/api/staff/jobs?' + query, { cookie: cookieA }), 400)
    }
  })

  test('non-GET methods cannot turn the UC9 BFF into a mutation proxy', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const result = await request('/api/staff/jobs', { method, cookie: cookieA, json: false })
      check(result.status === 405, 'UC9 BFF allowed a mutation method')
    }
  })

  test('a foreign Origin is rejected without invalidating the valid employee session', async () => {
    expectError(await request('/api/staff/jobs', { cookie: cookieA, requestOrigin: 'https://attacker.invalid' }), 403)
    const value = jobs(await request('/api/staff/jobs?pageSize=100', { cookie: cookieA }))
    check(dataA && sameIds(value.data.map(job => job.assignmentId), dataA.data.map(job => job.assignmentId)), 'Origin rejection altered the owned assignment list')
  })

  test('a new request with the same session reloads the correct employee data', async () => {
    const value = jobs(await request('/api/staff/jobs?pageSize=100', { cookie: cookieA }))
    check(dataA && sameIds(value.data.map(job => job.assignmentId), dataA.data.map(job => job.assignmentId)), 'HTTP reload equivalent changed the owned assignments')
  })

  test('logout A invalidates the old session; a fresh B login returns no A assignments', async () => {
    const logout = await request('/api/auth/logout', { method: 'POST', body: {}, cookie: cookieA })
    check(logout.status === 200 && logout.data?.ok === true, 'Employee A logout failed')
    expectError(await request('/api/staff/jobs', { cookie: cookieA }), 401)
    sessions.delete(cookieA)
    switchedCookie = await login('B')
    check(switchedCookie !== cookieA, 'Employee switch reused the old opaque session')
    const value = jobs(await request('/api/staff/jobs?pageSize=100', { cookie: switchedCookie }))
    check(dataB && sameIds(value.data.map(job => job.assignmentId), dataB.data.map(job => job.assignmentId)), 'The switched employee did not receive B assignments')
    check(dataA && value.data.every(b => dataA.data.every(a => a.assignmentId !== b.assignmentId)), 'A previous employee assignment leaked after logout/login')
  })
})
