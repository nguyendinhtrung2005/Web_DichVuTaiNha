import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createStaffAuthHttp } from '../lib/server/auth-http.mjs'
import { createStaffJobsHttp } from '../lib/server/jobs-http.mjs'
import { loadStaffJobsConfig } from '../lib/server/jobs-config.mjs'

// Opt-in live Auth + Staff HTTP integration around the exact BFF handlers/core.
// The test owns its native HTTP bridge and encrypted session files. This is not
// Next.js routing/browser E2E. No JWT is generated or mocked; no DB writes occur.
// Expiry below is the short BFF session TTL, not the live JWT's 900-second TTL.
const enabled = process.env.RUN_STAFF_UC9_LIFECYCLE_TESTS === 'true'
const options = { skip: !enabled, timeout: 30000 }
const check = (condition, message) => assert.equal(Boolean(condition), true, message)

function loopbackOrigin(value) {
  try {
    const url = new URL(value)
    check(['http:', 'https:'].includes(url.protocol) && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash, 'Live integration requires a fixed loopback service origin')
    return url.origin
  } catch { throw new Error('INTEGRATION_SERVICE_ORIGIN_INVALID') }
}

async function jsonRequest(url, init = {}) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 8000)
  try {
    const response = await fetch(url, { ...init, redirect: 'error', signal: controller.signal })
    const reader = response.body?.getReader()
    check(reader, 'Integration response body is required')
    const chunks = []; let length = 0
    try {
      while (true) {
        const part = await reader.read()
        if (part.done) break
        length += part.value.byteLength
        check(length <= 1048576, 'Integration response exceeds its size limit')
        chunks.push(part.value)
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
    const raw = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))
    check(!/"(?:accessToken|password|password_hash)"\s*:/.test(raw), 'Sensitive field appeared in a browser-facing response')
    check(!/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(raw), 'JWT appeared in a browser-facing response')
    let body
    try { body = JSON.parse(raw) } catch { throw new Error('INTEGRATION_RESPONSE_NOT_JSON') }
    return { status: response.status, headers: response.headers, body }
  } catch (error) {
    // Do not include request bodies, cookies, tokens or upstream raw responses.
    if (error?.code === 'ERR_ASSERTION' || error?.message === 'INTEGRATION_RESPONSE_NOT_JSON') throw error
    throw new Error('INTEGRATION_HTTP_REQUEST_FAILED')
  } finally { clearTimeout(timer); controller.abort() }
}

async function fixture(t, maxAge = 3) {
  const phone = process.env.STAFF_BFF_TEST_PHONE_A, password = process.env.STAFF_BFF_TEST_PASSWORD_A
  check(typeof phone === 'string' && phone.trim().length > 0, 'STAFF_BFF_TEST_PHONE_A is required when enabled')
  check(typeof password === 'string' && password.length > 0, 'STAFF_BFF_TEST_PASSWORD_A is required when enabled')
  const authUrl = loopbackOrigin(process.env.AUTH_SERVICE_URL || 'http://127.0.0.1:4001')
  const staffUrl = loopbackOrigin(process.env.STAFF_SERVICE_URL || 'http://127.0.0.1:4005')
  const authHealth = await jsonRequest(authUrl + '/health/ready')
  check(authHealth.status === 200 && authHealth.body?.service === 'auth-service' && authHealth.body?.status === 'ready', 'Real Auth Service must be ready before testing')
  const staffHealth = await jsonRequest(staffUrl + '/health/live')
  check(staffHealth.status === 200 && staffHealth.body?.service === 'staff-service' && staffHealth.body?.status === 'ok', 'Real Staff Service must be running before testing')

  const temporary = path.resolve(os.tmpdir())
  const directory = await mkdtemp(path.join(temporary, 'cleanhome-staff-uc9-life-'))
  const sessionDir = path.join(directory, 'sessions'), keyFile = path.join(directory, 'session.key')
  const control = { server: null, origin: null }
  t.after(async () => {
    if (control.server?.listening) {
      control.server.closeAllConnections()
      await new Promise(resolve => control.server.close(resolve))
    }
    const target = path.resolve(directory)
    check(target.startsWith(temporary + path.sep) && /^cleanhome-staff-uc9-life-[^\\/]+$/.test(path.basename(target)), 'Refusing cleanup outside this test-owned temporary directory')
    await rm(target, { recursive: true, force: true })
  })
  await writeFile(keyFile, randomBytes(32), { mode: 0o600 })
  const configFactory = () => loadStaffJobsConfig({
    NODE_ENV: 'test', AUTH_SERVICE_URL: authUrl, STAFF_SERVICE_URL: staffUrl, STAFF_APP_ORIGIN: control.origin,
    STAFF_SESSION_DIR: sessionDir, STAFF_SESSION_KEY_FILE: keyFile,
    STAFF_SESSION_MAX_AGE_SECONDS: String(maxAge), STAFF_AUTH_TIMEOUT_MS: '5000', STAFF_API_TIMEOUT_MS: '5000',
  }, directory)
  const handleAuth = createStaffAuthHttp({ configFactory }), handleJobs = createStaffJobsHttp({ configFactory })
  const server = createServer(async (req, res) => {
    try {
      const chunks = []; let length = 0
      for await (const chunk of req) {
        length += chunk.length
        if (length > 8192) throw new Error('BRIDGE_REQUEST_TOO_LARGE')
        chunks.push(chunk)
      }
      const headers = new Headers()
      for (let i = 0; i < req.rawHeaders.length; i += 2) headers.append(req.rawHeaders[i], req.rawHeaders[i + 1])
      const request = new Request(control.origin + req.url, { method: req.method, headers,
        ...(!['GET', 'HEAD'].includes(req.method) ? { body: Buffer.concat(chunks) } : {}) })
      const authMatch = /^\/api\/auth\/(login|logout)$/.exec(req.url)
      const response = authMatch ? await handleAuth(request, authMatch[1])
        : req.url === '/api/staff/jobs' ? await handleJobs(request)
          : Response.json({ error: { code: 'TEST_ROUTE_NOT_FOUND' } }, { status: 404 })
      res.statusCode = response.status
      response.headers.forEach((value, name) => res.setHeader(name, value))
      res.end(Buffer.from(await response.arrayBuffer()))
    } catch {
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end('{"error":{"code":"TEST_HTTP_BRIDGE_FAILURE"}}')
    }
  })
  server.requestTimeout = 8000
  server.headersTimeout = 5000
  control.server = server
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  control.origin = 'http://127.0.0.1:' + server.address().port

  const login = await jsonRequest(control.origin + '/api/auth/login', {
    method: 'POST', headers: { Origin: control.origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, password }),
  })
  check(login.status === 200 && login.body?.session?.user?.role === 'EMPLOYEE' && login.body?.session?.user?.status === 'ACTIVE', 'Real Auth must produce an active EMPLOYEE session')
  const cookieHeader = login.headers.get('set-cookie') || ''
  check(/^cleanhome_staff_session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=[1-9]\d*$/.test(cookieHeader), 'Login must set only the opaque host-only HttpOnly Staff session cookie')
  const cookie = cookieHeader.split(';', 1)[0]
  return {
    login, sessionDir,
    jobs: () => jsonRequest(control.origin + '/api/staff/jobs', { headers: { Origin: control.origin, Cookie: cookie } }),
    logout: () => jsonRequest(control.origin + '/api/auth/logout', {
      method: 'POST', headers: { Origin: control.origin, Cookie: cookie, 'Content-Type': 'application/json' }, body: '{}',
    }),
  }
}

function checkRealJobs(result) {
  check(result.status === 200 && Array.isArray(result.body?.data) && result.body.data.length > 0, 'Real Staff API must return assigned work for Employee A before expiry')
  check(result.body?.timezone === 'Asia/Ho_Chi_Minh' && Number.isSafeInteger(result.body?.pagination?.total), 'UC9 must return the live Staff list contract')
  check(!result.headers.has('set-cookie'), 'UC9 reads must not renew or replace session credentials')
  check(result.body.data.every(item => typeof item.assignmentId === 'string' && item.id === item.assignmentId), 'Live results must use assignment identifiers')
}

test('UC9 live Auth and Staff: short BFF session expires and exposes no fetched work afterward', options, async t => {
  const f = await fixture(t)
  checkRealJobs(await f.jobs())
  const remaining = Date.parse(f.login.body.session.expiresAt) - Date.now() + 100
  check(Number.isFinite(remaining) && remaining >= 0 && remaining <= 3500, 'The short BFF expiry wait must remain bounded')
  await new Promise(resolve => setTimeout(resolve, remaining))
  const expired = await f.jobs()
  check(expired.status === 401 && expired.body?.error?.code === 'SESSION_EXPIRED', 'Expired BFF session must be refused before returning UC9 data')
  check(!Object.hasOwn(expired.body, 'data') && !Object.hasOwn(expired.body, 'pagination'), 'Expired response must not contain previous employee work')
  check((expired.headers.get('set-cookie') || '').endsWith('Max-Age=0'), 'Expired UC9 session must clear only its Staff cookie')
  check((await readdir(f.sessionDir)).length === 0, 'Expired encrypted test session must be removed')
})

test('UC9 live Auth and Staff: frontend logout invalidates the SID for later job requests', options, async t => {
  const f = await fixture(t, 60)
  checkRealJobs(await f.jobs())
  const logout = await f.logout()
  check(logout.status === 200 && logout.body?.ok === true, 'Frontend logout must finish successfully')
  check((logout.headers.get('set-cookie') || '').endsWith('Max-Age=0'), 'Logout must expire only its Staff session cookie')
  const denied = await f.jobs()
  check(denied.status === 401 && denied.body?.error?.code === 'SESSION_EXPIRED', 'A revoked SID must not retrieve jobs')
  check(!Object.hasOwn(denied.body, 'data') && !Object.hasOwn(denied.body, 'pagination'), 'Logout must prevent stale employee data from being returned')
  check((await readdir(f.sessionDir)).length === 0, 'Logout must remove the encrypted test session')
})
