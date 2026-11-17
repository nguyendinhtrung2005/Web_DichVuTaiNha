import { after, before, describe, test } from 'node:test'
import { randomBytes } from 'node:crypto'

// These tests call the running Next.js BFF and real Auth Service. They never
// mint JWTs, read Auth's key/vault, alter database rows, or call Staff UC9–UC12.
const enabled = process.env.RUN_STAFF_BFF_HTTP_TESTS === 'true'
const cookieName = 'cleanhome_staff_session'
let origin, employee, customer, activeCookie
const sessions = new Set()

function requireCheck(value, message) {
  // Do not attach actual/expected response bodies: node:test may print secrets.
  if (!value) throw new Error(message)
}

function noCredentialLeak(body) {
  const serialized = JSON.stringify(body)
  requireCheck(!/"(?:accessToken|refreshToken|tokenType|password|passwordHash|password_hash)"\s*:/i.test(serialized), 'Response exposed a credential field')
  requireCheck(!/(?:^|[^A-Za-z0-9_-])[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}(?:$|[^A-Za-z0-9_-])/.test(serialized), 'Response exposed a JWT')
  for (const account of [employee, customer]) {
    if (account) requireCheck(!serialized.includes(account.password), 'Response exposed a submitted credential')
  }
}

async function request(path, { method = 'GET', body, cookie, requestOrigin = origin } = {}) {
  let response, data
  try {
    response = await fetch(origin + path, {
      method, redirect: 'error', signal: AbortSignal.timeout(20000),
      headers: {
        Accept: 'application/json',
        ...(requestOrigin === null ? {} : { Origin: requestOrigin }),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    requireCheck(response.headers.get('content-type')?.includes('application/json'), 'BFF did not return JSON')
    const chunks = [], reader = response.body.getReader()
    let size = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        requireCheck(size <= 65536, 'BFF response exceeded the test limit')
        chunks.push(value)
      }
    } finally { reader.releaseLock() }
    data = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new Error('BFF HTTP request failed; request and response contents withheld')
  }
  noCredentialLeak(data)
  return { status: response.status, data, headers: response.headers }
}

function expectError(result, status) {
  requireCheck(result.status === status, `Expected HTTP ${status}; observed HTTP ${result.status}`)
  requireCheck(typeof result.data?.error?.code === 'string' && typeof result.data?.error?.message === 'string', 'Missing structured error')
  requireCheck(typeof result.data?.requestId === 'string' && result.data.requestId.length > 0, 'Missing error request ID')
}

function sessionData(result) {
  requireCheck(result.status === 200, `Expected an authenticated session; observed HTTP ${result.status}`)
  const session = result.data?.session
  requireCheck(session?.user?.role === 'EMPLOYEE' && session.user.status === 'ACTIVE', 'Session did not describe an active employee')
  requireCheck(typeof session.user.id === 'string' && /^[1-9]\d*$/.test(session.user.id), 'Session user ID was not a canonical string ID')
  requireCheck(Number.isFinite(Date.parse(session.expiresAt)) && Date.parse(session.expiresAt) > Date.now(), 'Session did not have a future expiry')
  requireCheck(Object.keys(session.user).every(key => ['id', 'role', 'status'].includes(key)), 'BFF returned unexpected profile data')
  if (process.env.STAFF_BFF_TEST_USER_ID_A) requireCheck(session.user.id === process.env.STAFF_BFF_TEST_USER_ID_A, 'Employee identity did not match the test account')
  return session
}

function readSessionCookie(result) {
  const entries = result.headers.getSetCookie()
  const matching = entries.filter(value => value.startsWith(cookieName + '='))
  requireCheck(matching.length === 1, 'Expected one Staff session cookie')
  const header = matching[0], cookie = header.split(';', 1)[0]
  requireCheck(/^[A-Za-z0-9_-]{43,128}$/.test(cookie.slice(cookieName.length + 1)), 'Session cookie was not an opaque random identifier')
  requireCheck(!cookie.includes('.'), 'Session cookie contained a JWT-like value')
  requireCheck(/;\s*HttpOnly(?:;|$)/i.test(header), 'Session cookie lacked HttpOnly')
  requireCheck(/;\s*SameSite=Lax(?:;|$)/i.test(header), 'Session cookie lacked SameSite=Lax')
  requireCheck(/;\s*Path=\/(?:;|$)/i.test(header), 'Session cookie had an unexpected path')
  requireCheck(!/;\s*Domain=/i.test(header), 'Session cookie must be host-only')
  requireCheck(/;\s*Secure(?:;|$)/i.test(header) === origin.startsWith('https:'), 'Secure cookie flag did not match the configured local protocol')
  const maxAge = Number(header.match(/;\s*Max-Age=(\d+)/i)?.[1])
  requireCheck(Number.isSafeInteger(maxAge) && maxAge > 0, 'Session cookie lacked a positive Max-Age')
  const remaining = (Date.parse(result.data.session.expiresAt) - Date.now()) / 1000
  requireCheck(maxAge <= remaining + 3, 'Cookie outlived the server session')
  requireCheck(/no-store/i.test(result.headers.get('cache-control') || ''), 'Authenticated response must not be cached')
  sessions.add(cookie)
  return cookie
}

async function login() {
  const result = await request('/api/auth/login', { method: 'POST', body: employee })
  sessionData(result)
  return { result, cookie: readSessionCookie(result) }
}

describe('Staff BFF → real Auth HTTP (no database writes)', { skip: !enabled, concurrency: false, timeout: 180000 }, () => {
  before(() => {
    let url
    try { url = new URL(process.env.STAFF_BFF_TEST_BASE_URL || 'http://localhost:3002') } catch { throw new Error('Invalid Staff BFF test URL') }
    requireCheck(['http:', 'https:'].includes(url.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'HTTP suite is limited to a local Staff BFF')
    requireCheck(!url.username && !url.password && !url.search && !url.hash && url.pathname === '/', 'Staff BFF test URL must be a plain origin')
    origin = url.origin
    const phoneA = process.env.STAFF_BFF_TEST_PHONE_A, passwordA = process.env.STAFF_BFF_TEST_PASSWORD_A
    const phoneCustomer = process.env.STAFF_BFF_TEST_PHONE_CUSTOMER, passwordCustomer = process.env.STAFF_BFF_TEST_PASSWORD_CUSTOMER
    requireCheck([phoneA, passwordA, phoneCustomer, passwordCustomer].every(value => typeof value === 'string' && value.length > 0), 'Opt-in HTTP suite requires real employee/customer credentials through secure process environment')
    employee = { phone: phoneA, password: passwordA }
    customer = { phone: phoneCustomer, password: passwordCustomer }
  })

  after(async () => {
    for (const cookie of sessions) {
      try { await request('/api/auth/logout', { method: 'POST', body: {}, cookie }) } catch { /* Metadata-only test failure reporting. */ }
    }
  })

  test('missing session returns 401', async () => {
    expectError(await request('/api/auth/session'), 401)
  })

  test('unknown opaque session returns 401', async () => {
    expectError(await request('/api/auth/session', { cookie: cookieName + '=' + randomBytes(32).toString('base64url') }), 401)
  })

  test('login rejects an absent Origin', async () => {
    expectError(await request('/api/auth/login', { method: 'POST', body: employee, requestOrigin: null }), 403)
  })

  test('login rejects a different localhost port Origin', async () => {
    const other = new URL(origin)
    other.port = other.port === '3001' ? '3003' : '3001'
    expectError(await request('/api/auth/login', { method: 'POST', body: employee, requestOrigin: other.origin }), 403)
  })

  test('wrong password returns 401', async () => {
    const password = employee.password + '-invalid-' + randomBytes(8).toString('hex')
    expectError(await request('/api/auth/login', { method: 'POST', body: { phone: employee.phone, password } }), 401)
  })

  test('valid CUSTOMER credentials are rejected by the EMPLOYEE login', async () => {
    expectError(await request('/api/auth/login', { method: 'POST', body: customer }), 403)
  })

  test('actual EMPLOYEE login creates a secure opaque session without returning JWT', async () => {
    const signedIn = await login()
    activeCookie = signedIn.cookie
  })

  test('a new request preserves the logged-in session (reload HTTP equivalent)', async () => {
    requireCheck(activeCookie, 'Employee session setup did not complete')
    sessionData(await request('/api/auth/session', { cookie: activeCookie }))
  })

  test('logout rejects a different Origin and preserves the session', async () => {
    requireCheck(activeCookie, 'Employee session setup did not complete')
    expectError(await request('/api/auth/logout', { method: 'POST', body: {}, cookie: activeCookie, requestOrigin: 'https://attacker.invalid' }), 403)
    sessionData(await request('/api/auth/session', { cookie: activeCookie }))
  })

  test('logout clears the cookie and permanently invalidates the old session ID', async () => {
    requireCheck(activeCookie, 'Employee session setup did not complete')
    const result = await request('/api/auth/logout', { method: 'POST', body: {}, cookie: activeCookie })
    requireCheck(result.status === 200 && result.data?.ok === true, 'Logout did not succeed')
    const clear = result.headers.getSetCookie().find(value => value.startsWith(cookieName + '=')) || ''
    requireCheck(/;\s*Max-Age=0(?:;|$)/i.test(clear) && /;\s*HttpOnly(?:;|$)/i.test(clear), 'Logout did not clear the HttpOnly cookie')
    expectError(await request('/api/auth/session', { cookie: activeCookie }), 401)
    sessions.delete(activeCookie)
    activeCookie = null
  })

  test('logout is safe when no session exists', async () => {
    const result = await request('/api/auth/logout', { method: 'POST', body: {} })
    requireCheck(result.status === 200 && result.data?.ok === true, 'Anonymous logout did not complete safely')
  })

  test('password whitespace is preserved rather than trimmed', async () => {
    expectError(await request('/api/auth/login', { method: 'POST', body: { phone: employee.phone, password: ' ' + employee.password + ' ' } }), 401)
  })
})
