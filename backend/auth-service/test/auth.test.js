import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes, generateKeyPairSync } from 'node:crypto'
import { once } from 'node:events'
import { createApp, createLoginGuard } from '../src/app.js'
import { AuthService, loginInput } from '../src/service.js'
import { createTokenIssuer } from '../src/tokens.js'
import { hashPassword } from '../src/password.js'
import { loadConfig, loadDbConfig } from '../src/config.js'

test('Auth HTTP/service with real crypto and an explicitly in-memory repository (not live MySQL integration)', { timeout: 60000 }, async t => {
  const password = randomBytes(24).toString('base64url'), passwordHash = await hashPassword(password)
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { format: 'pem', type: 'pkcs8' }, publicKeyEncoding: { format: 'pem', type: 'spki' } })
  const issuer = await createTokenIssuer({ privateKeyPem: privateKey, issuer: 'http://unit-auth', audience: 'unit-staff', kid: 'unit-key', ttlSeconds: 900 })
  const users = new Map([
    ['1', { id: '1', phone: 'unit-employee', role: 'EMPLOYEE', status: 'ACTIVE', employeeId: '11', employeeStatus: 'ACTIVE', passwordHash }],
    ['2', { id: '2', phone: 'unit-customer', role: 'CUSTOMER', status: 'ACTIVE', employeeId: null, passwordHash }],
    ['3', { id: '3', phone: 'unit-admin', role: 'ADMIN', status: 'ACTIVE', employeeId: null, passwordHash }],
  ])
  let unavailable = false, refreshOverride
  const repository = {
    async assertSchema() { if (unavailable) throw Object.assign(new Error('private SQL details'), { code: 'DB_UNAVAILABLE' }); return true },
    async findByPhone(phone) { if (unavailable) throw Object.assign(new Error('private SQL details'), { code: 'DB_UNAVAILABLE' }); return structuredClone([...users.values()].find(u => u.phone === phone) || null) },
    async findById(id) { return structuredClone(refreshOverride || users.get(id) || null) },
  }
  const service = new AuthService({ repository, issuer }), logs = []
  const server = createApp({ service, repository, issuer, corsOrigins: ['http://localhost:3002'], loginGuard: createLoginGuard({ ipLimit: 100, phoneLimit: 100 }), logger: row => logs.push(row) }).listen(0, '127.0.0.1')
  await once(server, 'listening'); t.after(() => new Promise(resolve => server.close(resolve)))
  const base = 'http://127.0.0.1:' + server.address().port
  const request = async (path, { body, token, raw, origin } = {}) => {
    const response = await fetch(base + path, { method: body || raw ? 'POST' : 'GET', headers: { ...(body || raw ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(origin ? { Origin: origin } : {}) }, ...(body || raw ? { body: raw || JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10000) })
    return { status: response.status, body: await response.json(), headers: response.headers }
  }
  const login = (phone, extra = {}) => request('/api/v1/auth/login', { body: { phone, password, ...extra } })
  let employeeToken
  await t.test('valid Employee login has the agreed RS256 claims and expiry metadata', async () => {
    const result = await login('unit-employee', { role: 'EMPLOYEE' })
    assert.equal(result.status, 200); assert.equal(result.body.expiresIn, 900); assert.equal(result.body.tokenType, 'Bearer')
    assert.deepEqual(result.body.user, { id: '1', role: 'EMPLOYEE', status: 'ACTIVE' })
    employeeToken = result.body.accessToken
    const claims = await issuer.verify(employeeToken)
    assert.equal(claims.sub, '1'); assert.equal(claims.userId, claims.sub); assert.equal(claims.role, 'EMPLOYEE')
  })
  await t.test('Customer/Admin retain their database role; optional role cannot grant privileges', async () => {
    for (const [phone, role] of [['unit-customer', 'CUSTOMER'], ['unit-admin', 'ADMIN']]) {
      const result = await login(phone, { role }); assert.equal(result.status, 200)
      assert.equal((await issuer.verify(result.body.accessToken)).role, role)
    }
    const wrong = await login('unit-customer', { role: 'EMPLOYEE' })
    assert.equal(wrong.status, 403); assert.equal(wrong.body.error.code, 'ROLE_MISMATCH'); assert.equal(wrong.body.accessToken, undefined)
  })
  await t.test('wrong password, unknown phone and marker credentials are all rejected', async () => {
    for (const body of [{ phone: 'unit-employee', password: randomBytes(24).toString('base64url') }, { phone: 'unknown', password }]) {
      const result = await request('/api/v1/auth/login', { body }); assert.equal(result.status, 401); assert.equal(result.body.error.code, 'INVALID_CREDENTIALS')
    }
    const user = users.get('1'); user.passwordHash = '!CLEANHOME_TEST_ONLY_NO_LOGIN!'
    try { assert.equal((await login(user.phone)).status, 401) } finally { user.passwordHash = passwordHash }
  })
  await t.test('locked user and inactive/missing employee cannot login', async () => {
    const user = users.get('1')
    user.status = 'LOCKED'
    try { const result = await login(user.phone); assert.equal(result.status, 403); assert.equal(result.body.error.code, 'ACCOUNT_LOCKED') } finally { user.status = 'ACTIVE' }
    for (const changes of [{ employeeStatus: 'INACTIVE' }, { employeeId: null }]) {
      Object.assign(user, changes)
      try { const result = await login(user.phone); assert.equal(result.status, 403); assert.equal(result.body.error.code, 'EMPLOYEE_INACTIVE') } finally { user.employeeId = '11'; user.employeeStatus = 'ACTIVE' }
    }
  })
  await t.test('introspection verifies the token and current database account state', async () => {
    const result = await request('/api/v1/auth/introspect', { token: employeeToken })
    assert.equal(result.status, 200); assert.equal(result.body.sub, '1'); assert.equal(result.body.active, true)
    assert.equal(result.body.passwordHash, undefined); assert.equal(result.body.phone, undefined)
    refreshOverride = { ...users.get('1'), status: 'LOCKED' }
    try { assert.equal((await request('/api/v1/auth/introspect', { token: employeeToken })).status, 403) } finally { refreshOverride = undefined }
    refreshOverride = { ...users.get('1'), role: 'CUSTOMER' }
    try { const result = await request('/api/v1/auth/introspect', { token: employeeToken }); assert.equal(result.status, 403); assert.equal(result.body.error.code, 'ROLE_CHANGED') } finally { refreshOverride = undefined }
  })
  await t.test('expired, missing and tampered tokens cannot introspect', async () => {
    const expired = await issuer.issue(users.get('1'), { nowSeconds: Math.floor(Date.now() / 1000) - 901 })
    for (const token of [undefined, employeeToken + 'x', expired]) assert.equal((await request('/api/v1/auth/introspect', { token })).status, 401)
  })
  await t.test('public JWKS contains verification material only', async () => {
    const result = await request('/.well-known/jwks.json')
    assert.equal(result.status, 200); assert.equal(result.body.keys[0].alg, 'RS256')
    for (const key of result.body.keys) for (const privateField of ['d', 'p', 'q', 'dp', 'dq', 'qi']) assert.equal(Object.hasOwn(key, privateField), false)
  })
  await t.test('email login, unknown fields, invalid role and password sizes are invalid input', async () => {
    for (const body of [{ email: 'user@example.test', password }, { phone: 'unit-employee', password, userId: '3' }, { phone: 'unit-employee', password, role: 'OWNER' }, { phone: 'unit-employee', password: 'a'.repeat(129) }]) {
      const result = await request('/api/v1/auth/login', { body }); assert.equal(result.status, 400)
    }
    assert.throws(() => loginInput({ phone: 'a', password: '' }))
  })
  await t.test('malformed/oversized JSON and CORS failures return safe errors', async () => {
    assert.equal((await request('/api/v1/auth/login', { raw: '{' })).status, 400)
    assert.equal((await request('/api/v1/auth/login', { raw: JSON.stringify({ phone: 'a', password: 'x'.repeat(9000) }) })).status, 413)
    assert.equal((await request('/health/live', { origin: 'https://untrusted.example' })).status, 403)
    assert.equal((await request('/health/live', { origin: 'http://localhost:3002' })).status, 200)
  })
  await t.test('database errors never expose SQL, credentials or private error details', async () => {
    unavailable = true
    try { const result = await login('unit-employee'); assert.equal(result.status, 503); assert.equal(JSON.stringify(result.body).includes('private SQL details'), false) } finally { unavailable = false }
  })
  await t.test('logs never contain request credentials or access tokens', async () => {
    const text = JSON.stringify(logs)
    assert.equal(text.includes(password), false); assert.equal(text.includes(employeeToken), false); assert.equal(text.includes('unit-employee'), false)
  })
})

test('login limiter keeps expensive work bounded until the login promise completes', () => {
  const guard = createLoginGuard({ concurrency: 1, ipLimit: 3, phoneLimit: 3 }), req = { ip: 'unit', body: { phone: 'one' } }
  const res = { setHeader() {} }
  let error
  guard(req, res, value => { error = value }); assert.equal(error, undefined)
  guard({ ip: 'other', body: { phone: 'two' } }, res, value => { error = value }); assert.equal(error.status, 429)
  req.releaseLogin(); req.releaseLogin()
  guard({ ip: 'other', body: { phone: 'two' } }, res, value => { error = value }); assert.equal(error, undefined)
})

test('configuration requires real MySQL and explicit key material, without email/secret fallback', () => {
  assert.throws(() => loadConfig({}))
  const env = { MYSQL_USER: 'unit-user', MYSQL_DATABASE: 'unit-db', JWT_ISSUER: 'http://unit-auth', JWT_AUDIENCE: 'unit-staff', JWT_KEY_ID: 'unit-key', JWT_PRIVATE_KEY_FILE: 'unit.pem' }
  assert.equal(loadConfig(env).port, 4001); assert.equal(loadDbConfig(env).database, 'unit-db')
  for (const update of [{ JWT_ACCESS_TTL_SECONDS: '0' }, { MYSQL_PORT: '0' }, { JWT_KEY_ID: 'with space' }, { CORS_ORIGINS: '*' }]) assert.throws(() => loadConfig({ ...env, ...update }))
})
