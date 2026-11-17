import { readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export function localBase(value, name) {
  let url
  try { url = new URL(value) } catch { throw new Error('Invalid local integration URL: ' + name) }
  if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Integration URL must be loopback without credentials, path or query: ' + name)
  }
  return url.origin
}

// Consume only access tokens issued by the actual Auth login helper. This code
// never decrypts credentials, signs JWTs, starts a stub or bypasses middleware.
export async function authTokens() {
  const result = {}
  for (const label of ['A', 'B', 'CUSTOMER']) {
    let token
    try { token = (await readFile(new URL('../../auth-service/secrets/tokens/' + label + '.token', import.meta.url), 'utf8')).trim() }
    catch { throw new Error('Auth access-token file is unavailable for ' + label + '; run the real Auth token helper') }
    if (token.length > 8000 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw new Error('Invalid Auth access-token file for ' + label)
    result[label] = token
  }
  return Object.freeze(result)
}

export async function jsonRequest(base, path, { method = 'GET', token, body, headers = {}, timeoutMs = 8000 } = {}) {
  let response
  try {
    response = await fetch(base + path, {
      method, redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    if (!/\bapplication\/(?:[a-z0-9.+-]+\+)?json\b/i.test(response.headers.get('content-type') || '')) throw new Error('Non-JSON response')
    const reader = response.body?.getReader()
    if (!reader) throw new Error('Missing response body')
    const chunks = []
    let bytes = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        bytes += value.byteLength
        if (bytes > 1024 * 1024) { await reader.cancel(); throw new Error('Response too large') }
        chunks.push(value)
      }
      return { status: response.status, body: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))) }
    } finally { reader.releaseLock() }
  } catch { throw new Error('Real integration HTTP request failed; response and credential contents withheld') }
}

export async function runStaffSuite({ tokens, orderToken, staffBase, orderBase, authBase, env: suppliedEnv = process.env }) {
  const env = {
    ...suppliedEnv,
    RUN_STAFF_HTTP_TESTS: 'true', RUN_STAFF_HTTP_WRITE_TESTS: 'true', STAFF_HTTP_WRITE_BOOKING_ID: '9109131', STAFF_HTTP_BASE_URL: staffBase,
    JWT_ALGORITHM: 'RS256', JWT_ISSUER: suppliedEnv.JWT_ISSUER || 'http://localhost:4001', JWT_AUDIENCE: suppliedEnv.JWT_AUDIENCE || 'cleanhome-staff-api',
    JWT_JWKS_URL: authBase + '/.well-known/jwks.json', JWT_PUBLIC_KEY: '', JWT_SECRET: '', AUTH_INTROSPECTION_URL: authBase + '/api/v1/auth/introspect',
    ORDER_SERVICE_URL: orderBase, ORDER_SERVICE_TOKEN: orderToken,
    STAFF_HTTP_TOKEN_A: tokens.A, STAFF_HTTP_TOKEN_B: tokens.B, STAFF_HTTP_TOKEN_CUSTOMER: tokens.CUSTOMER,
    STAFF_HTTP_TOKEN_A_FILE: '', STAFF_HTTP_TOKEN_B_FILE: '', STAFF_HTTP_TOKEN_CUSTOMER_FILE: '', RECONCILIATION_WORKER_ENABLED: 'false',
  }
  // Nested node:test must not inherit the parent's IPC/reporting mode.
  delete env.NODE_TEST_CONTEXT
  const child = spawn(process.execPath, ['--env-file-if-exists=.env', '--test', '--test-reporter=tap', 'test/http.integration.test.js'], {
    cwd: fileURLToPath(new URL('../../staff-service/', import.meta.url)), env, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = '', tooLarge = false, timedOut = false
  const collect = chunk => {
    if (tooLarge) return
    output += chunk.toString()
    if (Buffer.byteLength(output, 'utf8') > 300000) { tooLarge = true; child.kill() }
  }
  child.stdout.on('data', collect); child.stderr.on('data', collect)
  const timer = setTimeout(() => { timedOut = true; child.kill() }, 250000)
  let code
  try {
    code = await new Promise((resolve, reject) => {
      child.on('error', () => reject(new Error('The unchanged Staff HTTP runner could not start')))
      child.on('close', resolve)
    })
  } finally { clearTimeout(timer) }
  const metrics = Object.fromEntries([...output.matchAll(/(?:#|ℹ)\s*(tests|pass|fail|skipped)\s+(\d+)/g)].map(match => [match[1], Number(match[2])]))
  const uc12Executed = /\bok\s+\d+\s+-\s+UC12 real Order synchronization, multi-worker completion and idempotent retries(?![^\n]*# SKIP)/.test(output)
  // Output remains private: assertion failures can contain request details.
  // Only aggregate metrics and known runner state are returned to callers/logs.
  return { code, metrics, uc12Executed, tooLarge, timedOut }
}
