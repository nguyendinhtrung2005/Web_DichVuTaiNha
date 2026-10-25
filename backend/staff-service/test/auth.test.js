import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'
import { exportSPKI, generateKeyPair, SignJWT } from 'jose'
import { createAuthenticate } from '../src/auth.js'
import { loadConfig } from '../src/config.js'

// Keys are generated for this process only; no real credentials or tokens enter test output.
const secret = randomBytes(48).toString('base64url')
const key = new TextEncoder().encode(secret)
const now = Math.floor(Date.now() / 1000)
const jwtConfig = { issuer: 'urn:cleanhome:test:auth', audience: 'staff-test', algorithm: 'HS256', secret }
const claims = { sub: '100', role: 'EMPLOYEE', iss: jwtConfig.issuer, aud: jwtConfig.audience, exp: now + 300 }

const sign = (overrides = {}, signingKey = key, algorithm = 'HS256') => new SignJWT({ ...claims, ...overrides }).setProtectedHeader({ alg: algorithm }).sign(signingKey)
const request = async (middleware, authorization, extra = {}) => {
  const req = { headers: { authorization }, ...extra }
  let error
  let calls = 0
  await middleware(req, {}, value => { error = value; calls += 1 })
  assert.equal(calls, 1)
  return { req, error }
}
const authenticate = createAuthenticate({ jwt: jwtConfig })
const denied = async (token, status = 401, middleware = authenticate, extra) => {
  const result = await request(middleware, `Bearer ${token}`, extra)
  assert.equal(result.error?.status, status)
  assert.equal(result.req.actor, undefined)
  return result
}

test('verified EMPLOYEE/STAFF roles map to immutable staff actor; client identity is ignored', async () => {
  for (const role of ['EMPLOYEE', 'STAFF', 'staff', 'employee']) {
    const token = await sign({ role })
    const { req, error } = await request(authenticate, `Bearer ${token}`, { params: { userId: '999' }, query: { staffId: '999', role: 'ADMIN' } })
    assert.equal(error, undefined)
    assert.deepEqual(req.actor, { userId: '100', role: 'staff' })
    assert.ok(Object.isFrozen(req.actor))
  }
})

test('missing, malformed, oversized and unsigned bearer values are rejected', async () => {
  for (const value of [undefined, '', 'Basic test', 'Bearer ', 'Bearer a.b', 'Bearer a.b.c extra', `Bearer ${'a'.repeat(8200)}`, ['Bearer a.b.c'], 'Bearer eyJhbGciOiJub25lIn0.e30.']) {
    const { error, req } = await request(authenticate, value)
    assert.equal(error?.status, 401)
    assert.equal(req.actor, undefined)
  }
})

test('signature, expiry, not-before, issuer, audience and algorithm are cryptographically verified', async () => {
  await denied(await sign({}, new TextEncoder().encode(randomBytes(48).toString('base64url'))))
  await denied(await sign({ exp: now - 5 }))
  await denied(await sign({ nbf: now + 3600 }))
  await denied(await sign({ iss: 'urn:wrong:issuer' }))
  await denied(await sign({ aud: 'different-service' }))
  await denied(await sign({}, key, 'HS512'))
  const token = await sign()
  const parts = token.split('.')
  parts[1] = Buffer.from(JSON.stringify({ ...claims, sub: '999' })).toString('base64url')
  await denied(parts.join('.'))
})

test('subject must be canonical positive signed BIGINT, with required expiration', async () => {
  for (const sub of [undefined, 100, '', '0', '-1', '01', '100abc', '1.0', '1e2', ' 100', '100\n', '9223372036854775808', '9999999999999999999999']) {
    await denied(await sign({ sub }))
  }
  await denied(await sign({ exp: undefined }))
  const result = await request(authenticate, `Bearer ${await sign({ sub: '9223372036854775807' })}`)
  assert.equal(result.error, undefined)
  assert.equal(result.req.actor.userId, '9223372036854775807')
})

test('other roles and unavailable account-status claims fail closed', async () => {
  for (const role of [undefined, 'CUSTOMER', 'ADMIN', ['EMPLOYEE'], ' EMPLOYEE']) await denied(await sign({ role }), 403)
  for (const claim of [{ locked: true }, { isLocked: true }, { active: false }, { isActive: false }, { status: 'LOCKED' }, { accountStatus: 'INACTIVE' }, { locked: 'false' }, { active: 'true' }, { status: null }]) {
    await denied(await sign(claim), 403)
  }
  const result = await request(authenticate, `Bearer ${await sign({ locked: false, isLocked: false, active: true, isActive: true, status: 'active', accountStatus: 'ENABLED' })}`)
  assert.equal(result.error, undefined)
})

test('RS256 accepts only the configured public key and does not confuse asymmetric/symmetric algorithms', async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256')
  const pem = await exportSPKI(publicKey)
  const rsaAuth = createAuthenticate({ jwt: { ...jwtConfig, algorithm: 'RS256', secret: undefined, publicKey: pem } })
  const token = await sign({}, privateKey, 'RS256')
  const result = await request(rsaAuth, `Bearer ${token}`)
  assert.equal(result.error, undefined)
  await denied(await sign(), 401, rsaAuth)
  const other = await generateKeyPair('RS256')
  await denied(await sign({}, other.privateKey, 'RS256'), 401, rsaAuth)
})

test('introspection forwards only bearer token to configured endpoint, with timeout and no redirects', async () => {
  const token = await sign()
  let calls = 0
  const middleware = createAuthenticate({ jwt: { ...jwtConfig, introspectionUrl: 'http://auth.test/current' } }, {
    fetchImpl: async (url, options) => {
      calls += 1
      assert.equal(url, 'http://auth.test/current')
      assert.equal(options.method, 'GET')
      assert.equal(options.headers.Authorization, `Bearer ${token}`)
      assert.equal(options.redirect, 'error')
      assert.ok(options.signal instanceof AbortSignal)
      return Response.json({ sub: '100', role: 'STAFF', active: true, locked: false })
    }
  })
  const result = await request(middleware, `Bearer ${token}`)
  assert.equal(result.error, undefined)
  assert.equal(calls, 1)
  await denied(await sign({ role: 'ADMIN' }), 403, middleware)
  assert.equal(calls, 1)
})

test('introspection denies changed identity, role and revoked/locked accounts', async () => {
  const token = await sign()
  const cases = [
    [{ sub: '999', role: 'STAFF', active: true }, 401],
    [{ sub: '100', role: 'ADMIN', active: true }, 403],
    [{ sub: '100', role: 'EMPLOYEE', active: false }, 403],
    [{ sub: '100', role: 'STAFF', active: true, locked: true }, 403]
  ]
  for (const [body, status] of cases) {
    const middleware = createAuthenticate({ jwt: { ...jwtConfig, introspectionUrl: 'http://auth.test/current' } }, { fetchImpl: async () => Response.json(body) })
    await denied(token, status, middleware)
  }
})

test('configured introspection is fail-closed on network, malformed JSON/body and upstream failures', async () => {
  const token = await sign()
  for (const fetchImpl of [
    async () => { throw new TypeError('upstream unavailable') },
    async () => Response.json({ message: 'unavailable' }, { status: 503 }),
    async () => new Response('not json'),
    async () => Response.json([]),
    async () => Response.json({ sub: '100', role: 'STAFF' }),
    async () => Response.json({ sub: '100abc', role: 'STAFF', active: true })
  ]) {
    const middleware = createAuthenticate({ jwt: { ...jwtConfig, introspectionUrl: 'http://auth.test/current' } }, { fetchImpl })
    await denied(token, 503, middleware)
  }
  for (const status of [401, 403]) {
    const middleware = createAuthenticate({ jwt: { ...jwtConfig, introspectionUrl: 'http://auth.test/current' } }, { fetchImpl: async () => new Response(null, { status }) })
    await denied(token, status, middleware)
  }
})

const baseEnv = () => ({ MYSQL_USER: 'staff_test', MYSQL_DATABASE: 'staff_test', JWT_ISSUER: jwtConfig.issuer, JWT_AUDIENCE: jwtConfig.audience, JWT_ALGORITHM: 'HS256', JWT_SECRET: secret })

test('configuration has safe immutable defaults and no implicit worker or real-service success', () => {
  const config = loadConfig(baseEnv())
  assert.equal(config.port, 4005)
  assert.equal(config.db.port, 3306)
  assert.deepEqual(config.corsOrigins, ['http://localhost:3002'])
  assert.deepEqual(config.worker, { enabled: false, intervalMs: 5000, batchSize: 20 })
  assert.equal(config.order.baseUrl, undefined)
  assert.equal(config.order.token, undefined)
  for (const value of [config, config.db, config.jwt, config.order, config.worker, config.corsOrigins]) assert.ok(Object.isFrozen(value))
})

test('configuration rejects missing identity/database values, weak keys and unsupported algorithms', () => {
  for (const field of ['MYSQL_USER', 'MYSQL_DATABASE', 'JWT_ISSUER', 'JWT_AUDIENCE', 'JWT_ALGORITHM', 'JWT_SECRET']) {
    const env = baseEnv()
    delete env[field]
    assert.throws(() => loadConfig(env))
  }
  assert.throws(() => loadConfig({ ...baseEnv(), JWT_SECRET: randomBytes(3).toString('hex') }))
  assert.throws(() => loadConfig({ ...baseEnv(), JWT_ALGORITHM: 'none' }))
  assert.throws(() => createAuthenticate({ jwt: { algorithm: 'none' } }))
  assert.throws(() => createAuthenticate({ jwt: { ...jwtConfig, secret: undefined } }))
})

test('configuration rejects invalid numeric/range/boolean values and unsafe URL schemes', () => {
  for (const [field, value] of [['PORT', '0'], ['PORT', '65536'], ['MYSQL_PORT', '3306abc'], ['MYSQL_CONNECTION_LIMIT', '0'], ['RECONCILIATION_WORKER_INTERVAL_MS', '1'], ['RECONCILIATION_WORKER_BATCH_SIZE', '101'], ['ORDER_SERVICE_TIMEOUT_MS', 'NaN'], ['RECONCILIATION_WORKER_ENABLED', 'yes'], ['ORDER_SERVICE_URL', 'file:///private'], ['JWT_JWKS_URL', 'https://name:password@auth.test/keys'], ['AUTH_INTROSPECTION_URL', 'https://auth.test/current#fragment'], ['CORS_ORIGINS', '*'], ['CORS_ORIGINS', 'http://localhost:3002/login']]) {
    assert.throws(() => loadConfig({ ...baseEnv(), [field]: value }))
  }
})

test('RS256 config needs exactly one key source and reconciliation needs an authenticated Order Service', () => {
  assert.throws(() => loadConfig({ ...baseEnv(), JWT_ALGORITHM: 'RS256', JWT_SECRET: '' }))
  assert.throws(() => loadConfig({ ...baseEnv(), JWT_ALGORITHM: 'RS256', JWT_JWKS_URL: 'http://auth.test/keys', JWT_PUBLIC_KEY: 'not-a-key' }))
  const config = loadConfig({ ...baseEnv(), JWT_ALGORITHM: 'RS256', JWT_JWKS_URL: 'http://auth.test/keys', RECONCILIATION_WORKER_ENABLED: 'true', ORDER_SERVICE_URL: 'http://order.test/', ORDER_SERVICE_TOKEN: randomBytes(32).toString('base64url') })
  assert.equal(config.worker.enabled, true)
  assert.equal(config.order.baseUrl, 'http://order.test')
  assert.throws(() => loadConfig({ ...baseEnv(), RECONCILIATION_WORKER_ENABLED: 'true' }))
})
