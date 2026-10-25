import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes, createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { testBase, testAccounts, jsonRequest, loginAccounts, saveTokens } from '../scripts/http-tools.js'
import { createPool } from '../src/db.js'
import { loadDbConfig } from '../src/config.js'

test('real Auth HTTP with actual MySQL/RS256 and optional real Staff HTTP reads (no UC12 writes)', { skip: process.env.RUN_AUTH_LIVE_TESTS === 'true' ? false : 'Set RUN_AUTH_LIVE_TESTS=true only when the real Auth server is running', timeout: 180000 }, async t => {
  assert.equal(process.env.MYSQL_DATABASE, 'cleanhome_staff_test')
  const base = testBase(), accounts = await testAccounts(), pool = createPool(loadDbConfig())
  const snapshot = async () => {
    const values = []
    try {
      for (const query of ['SELECT id,role,status,password_hash FROM users ORDER BY id', 'SELECT id,user_id,branch_id,status FROM employees ORDER BY id', 'SELECT id,customer_id,status,scheduled_start,scheduled_end,total_amount FROM bookings ORDER BY id', 'SELECT id,booking_id,employee_id,status,assigned_at,check_in_at,check_out_at FROM assignments ORDER BY id', 'SELECT id,booking_id,service_id,quantity,unit_price FROM booking_items ORDER BY id', 'SELECT id,booking_id,status,note,created_at FROM booking_status_history ORDER BY id']) values.push((await pool.query(query))[0])
    } catch { throw new Error('Database snapshot check failed; connection and credential details withheld') }
    return createHash('sha256').update(JSON.stringify(values)).digest('hex')
  }
  let before
  t.after(async () => { try { if (before) assert.equal(await snapshot(), before, 'Auth/Staff read tests must preserve the selected database state') } finally { await pool.end() } })
  before = await snapshot()
  let tokens
  await t.test('Auth health endpoints respond from the real running service', async () => {
    for (const path of ['/health/live', '/health/ready']) { const result = await jsonRequest(base, path); assert.equal(result.status, 200); assert.equal(result.body.service, 'auth-service') }
  })
  await t.test('published JWKS is RSA public verification material only', async () => {
    const result = await jsonRequest(base, '/.well-known/jwks.json')
    assert.equal(result.status, 200); assert.equal(result.body.keys[0].kty, 'RSA'); assert.equal(result.body.keys[0].alg, 'RS256')
    for (const key of result.body.keys) for (const field of ['d', 'p', 'q', 'dp', 'dq', 'qi']) assert.equal(Object.hasOwn(key, field), false)
  })
  await t.test('three real logins produce valid RS256 tokens for A/B/Customer', async () => { tokens = await loginAccounts(base, accounts) })
  assert.ok(tokens, 'Real Auth logins must pass before Staff HTTP integration')
  await t.test('wrong passwords and an unknown phone produce 401', async () => {
    for (const phone of [accounts[0].phone, 'UNKNOWN-AUTH-TEST']) {
      const result = await jsonRequest(base, '/api/v1/auth/login', { method: 'POST', body: { phone, password: randomBytes(24).toString('base64url') } })
      assert.equal(result.status, 401); assert.equal(result.body.error.code, 'INVALID_CREDENTIALS')
    }
  })
  await t.test('requesting Employee/Admin role cannot elevate a real Customer account', async () => {
    const account = accounts.find(account => account.label === 'CUSTOMER')
    for (const role of ['EMPLOYEE', 'ADMIN']) {
      const result = await jsonRequest(base, '/api/v1/auth/login', { method: 'POST', body: { phone: account.phone, password: account.password, role } })
      assert.equal(result.status, 403); assert.equal(result.body.error.code, 'ROLE_MISMATCH'); assert.equal(result.body.accessToken, undefined)
    }
  })
  await t.test('email login is unsupported and cannot silently substitute for phone', async () => {
    const result = await jsonRequest(base, '/api/v1/auth/login', { method: 'POST', body: { email: 'invalid@example.test', password: randomBytes(24).toString('base64url') } })
    assert.equal(result.status, 400)
  })
  await t.test('real introspection accepts current identities, rejects missing/tampered tokens', async () => {
    for (const account of accounts) {
      const result = await jsonRequest(base, '/api/v1/auth/introspect', { token: tokens[account.label] })
      assert.equal(result.status, 200); assert.equal(result.body.sub, account.userId); assert.equal(result.body.active, true)
    }
    assert.equal((await jsonRequest(base, '/api/v1/auth/introspect')).status, 401)
    assert.equal((await jsonRequest(base, '/api/v1/auth/introspect', { token: tokens.A + 'x' })).status, 401)
  })
  await t.test('tokens are saved locally without printing credentials', async () => { await saveTokens(tokens) })
  await t.test('unchanged Staff HTTP suite uses genuine Auth tokens and real dependencies; UC12 remains disabled', { skip: process.env.RUN_AUTH_STAFF_HTTP_TESTS === 'true' ? false : 'Staff HTTP test was not requested' }, async () => {
    const staffBase = testBase(process.env.AUTH_TEST_STAFF_BASE_URL || 'http://127.0.0.1:4005')
    const env = { ...process.env, RUN_STAFF_HTTP_TESTS: 'true', RUN_STAFF_HTTP_WRITE_TESTS: 'false', STAFF_HTTP_WRITE_BOOKING_ID: '', STAFF_HTTP_BASE_URL: staffBase,
      JWT_ALGORITHM: 'RS256', JWT_JWKS_URL: base + '/.well-known/jwks.json', JWT_PUBLIC_KEY: '', JWT_SECRET: '', AUTH_INTROSPECTION_URL: base + '/api/v1/auth/introspect',
      STAFF_HTTP_TOKEN_A: tokens.A, STAFF_HTTP_TOKEN_B: tokens.B, STAFF_HTTP_TOKEN_CUSTOMER: tokens.CUSTOMER, STAFF_HTTP_TOKEN_A_FILE: '', STAFF_HTTP_TOKEN_B_FILE: '', STAFF_HTTP_TOKEN_CUSTOMER_FILE: '' }
    // A nested Node test runner must not inherit the parent's private IPC mode.
    delete env.NODE_TEST_CONTEXT
    const child = spawn(process.execPath, ['--env-file-if-exists=.env', '--test', '--test-reporter=tap', 'test/http.integration.test.js'], { cwd: fileURLToPath(new URL('../../staff-service/', import.meta.url)), env, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = '', tooLarge = false
    const collect = chunk => { output += chunk.toString(); if (output.length > 200000) { tooLarge = true; child.kill() } }
    child.stdout.on('data', collect); child.stderr.on('data', collect)
    const deadline = setTimeout(() => child.kill(), 90000)
    let code
    try { code = await new Promise((resolve, reject) => { child.on('error', () => reject(new Error('Staff HTTP test process could not start'))); child.on('close', resolve) }) }
    finally { clearTimeout(deadline) }
    const metrics = Object.fromEntries([...output.matchAll(/(?:#|ℹ)\s*(tests|pass|fail|skipped)\s+(\d+)/g)].map(match => [match[1], Number(match[2])]))
    assert.equal(tooLarge, false); assert.equal(code, 0, 'Staff HTTP checks failed; child details withheld to avoid secret disclosure')
    assert.ok(metrics.pass > 0); assert.equal(metrics.fail, 0); assert.equal(metrics.skipped, 1, 'UC12 write group must remain SKIP')
    console.log('Real Staff HTTP result (no tokens): ' + JSON.stringify(metrics))
  })
})
