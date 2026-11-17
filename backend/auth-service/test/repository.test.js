import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, access, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateKeyPairSync } from 'node:crypto'
import { MysqlAuthRepository } from '../src/repository.js'
import { provisionTestAccounts } from '../scripts/provision-test-accounts.js'
import { verifyPassword } from '../src/password.js'
import { decryptCredentials } from '../src/credential-vault.js'

const credentialPrivateKeyPem = generateKeyPairSync('rsa', { modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } }).privateKey

// These are isolated query/transaction contract tests using connection doubles.
// They do not claim that MySQL, Auth HTTP, or Staff HTTP integration succeeded.
function fixture(answers = []) {
  const log = []
  const connection = {
    async query(sql) { log.push({ kind: 'query', sql }); return [[], []] },
    async execute(sql, values = []) {
      log.push({ kind: 'execute', sql, values })
      const next = answers.shift()
      if (next instanceof Error) throw next
      return [next || [], []]
    },
    release() { log.push({ kind: 'release' }) },
  }
  return { repository: new MysqlAuthRepository({ async getConnection() { return connection } }), log }
}

function schemaAnswers() {
  const columns = []
  for (const [table, names] of Object.entries({ users: ['id', 'phone', 'password_hash', 'role', 'status'], employees: ['id', 'user_id', 'status'] })) {
    for (const name of names) columns.push({ TABLE_NAME: table, COLUMN_NAME: name,
      DATA_TYPE: ['id', 'user_id'].includes(name) ? 'bigint' : 'varchar', IS_NULLABLE: 'NO' })
  }
  const indexes = [
    ['users', 'PRIMARY', 'id'], ['users', 'uq_users_phone', 'phone'],
    ['employees', 'PRIMARY', 'id'], ['employees', 'uq_employees_user', 'user_id'],
  ].map(([TABLE_NAME, INDEX_NAME, COLUMN_NAME]) => ({ TABLE_NAME, INDEX_NAME, COLUMN_NAME, NON_UNIQUE: 0, SEQ_IN_INDEX: 1 }))
  return [[{ version: '8.0.40' }], columns, indexes, [{ TABLE_NAME: 'employees', COLUMN_NAME: 'user_id',
    REFERENCED_TABLE_NAME: 'users', REFERENCED_COLUMN_NAME: 'id' }]]
}

test('phone lookup binds exact identifier and explicitly reads the password hash only for login', async () => {
  const f = fixture([[{ id: '9007199254740993', phone: 'TEST-EMPLOYEE-UC9', passwordHash: 'opaque-hash',
    role: 'EMPLOYEE', status: 'ACTIVE', employeeId: '9007199254740994', employeeStatus: 'ACTIVE' }]])
  const row = await f.repository.findByPhone('TEST-EMPLOYEE-UC9')
  assert.equal(row.id, '9007199254740993')
  assert.equal(row.employeeId, '9007199254740994')
  const sql = f.log.find(item => item.kind === 'execute')
  assert.deepEqual(sql.values, ['TEST-EMPLOYEE-UC9'])
  assert.match(sql.sql, /u\.phone = \? LIMIT 1/)
  assert.match(sql.sql, /password_hash AS passwordHash/)
  assert.doesNotMatch(sql.sql, /SELECT\s+\*/i)
  assert.match(f.log[0].sql, /time_zone = '\+00:00'/)
  assert.equal(f.log.at(-1).kind, 'release')
})

test('identity refresh excludes credentials and preserves a customer without employee profile', async () => {
  const f = fixture([[{ id: '10', phone: 'TEST-CUSTOMER-UC9', role: 'CUSTOMER', status: 'ACTIVE', employeeId: null, employeeStatus: null }]])
  assert.equal((await f.repository.findById('10')).employeeId, null)
  const sql = f.log.find(item => item.kind === 'execute')
  assert.deepEqual(sql.values, ['10'])
  assert.doesNotMatch(sql.sql, /password|SELECT\s+\*/i)
})

test('unknown phone and account ID return null', async () => {
  const f = fixture([[], []])
  assert.equal(await f.repository.findByPhone('unknown'), null)
  assert.equal(await f.repository.findById('123'), null)
})

test('driver errors are sanitized and borrowed connections are released', async () => {
  const f = fixture([new Error('Sensitive credential and query parameters must not escape')])
  await assert.rejects(f.repository.findByPhone('example'), error => {
    assert.equal(error.code, 'DB_UNAVAILABLE')
    assert.doesNotMatch(error.message, /Sensitive|credential and query/)
    return true
  })
  assert.equal(f.log.at(-1).kind, 'release')
  const unavailable = new MysqlAuthRepository({ async getConnection() { throw new Error('private DB URL') } })
  await assert.rejects(unavailable.health(), { code: 'DB_UNAVAILABLE' })
})

test('schema verification accepts the existing MySQL users/employees contract without DDL', async () => {
  const f = fixture(schemaAnswers())
  assert.equal(await f.repository.assertSchema(), true)
  const statements = f.log.filter(item => item.kind === 'execute').map(item => item.sql).join('\n')
  assert.doesNotMatch(statements, /CREATE|ALTER|DROP|UPDATE|INSERT|DELETE/i)
  assert.doesNotMatch(statements, /email/i)
})

test('schema verification rejects unsupported engines, missing or nullable credential columns', async () => {
  for (const version of ['5.7.44', '10.6.0-MariaDB', 'unknown']) {
    await assert.rejects(fixture([[{ version }]]).repository.assertSchema(), { code: 'DATABASE_SCHEMA_INCOMPATIBLE' })
  }
  for (const mutation of ['missing', 'wrong-type', 'nullable']) {
    const answers = schemaAnswers()
    const hashColumn = answers[1].find(item => item.COLUMN_NAME === 'password_hash')
    if (mutation === 'missing') answers[1] = answers[1].filter(item => item !== hashColumn)
    if (mutation === 'wrong-type') hashColumn.DATA_TYPE = 'text'
    if (mutation === 'nullable') hashColumn.IS_NULLABLE = 'YES'
    await assert.rejects(fixture(answers).repository.assertSchema(), { code: 'DATABASE_SCHEMA_INCOMPATIBLE' })
  }
})

test('schema verification rejects missing unique identity and employee/user relationship', async () => {
  for (const kind of ['phone', 'employee', 'primary', 'foreign-key']) {
    const answers = schemaAnswers()
    if (kind === 'phone') answers[2] = answers[2].filter(item => item.COLUMN_NAME !== 'phone')
    if (kind === 'employee') answers[2] = answers[2].filter(item => item.COLUMN_NAME !== 'user_id')
    if (kind === 'primary') answers[2] = answers[2].filter(item => item.TABLE_NAME !== 'users' || item.INDEX_NAME !== 'PRIMARY')
    if (kind === 'foreign-key') answers[3] = []
    await assert.rejects(fixture(answers).repository.assertSchema(), { code: 'DATABASE_SCHEMA_INCOMPATIBLE' })
  }
})

function provisioningFixture(options = {}) {
  const marker = '!CLEANHOME_TEST_ONLY_NO_LOGIN!'
  const users = [
    { id: '9109001', phone: 'TEST-CUSTOMER-UC9', role: 'CUSTOMER', status: 'ACTIVE', passwordHash: marker },
    { id: '9109002', phone: 'TEST-EMPLOYEE-UC9', role: 'EMPLOYEE', status: 'ACTIVE', passwordHash: marker },
    { id: '9109101', phone: 'TEST-EMPLOYEE-UC9-B', role: 'EMPLOYEE', status: 'ACTIVE', passwordHash: marker },
  ]
  const employees = [
    { id: '9109004', userId: '9109002', branchId: '9109003', status: 'ACTIVE' },
    { id: '9109102', userId: '9109101', branchId: '9109003', status: 'ACTIVE' },
  ]
  const bookings = ['9109007', '9109103', '9109111', '9109121', '9109131'].map(id => ({ id,
    customerId: '9109001', branchId: '9109003', marker: id === '9109007' ? 'cleanhome-staff-uc9-uc12-v1' : 'cleanhome-staff-uc9-uc12-multi-v1' }))
  const assignments = [
    ['9109008', '9109007', '9109004'], ['9109105', '9109103', '9109102'],
    ['9109113', '9109111', '9109004'], ['9109123', '9109121', '9109004'],
    ['9109133', '9109131', '9109004'], ['9109134', '9109131', '9109102'],
  ].map(([id, bookingId, employeeId]) => ({ id, bookingId, employeeId }))
  const state = { users, employees, bookings, assignments, writes: 0, released: 0, rolledBack: 0, commits: 0 }
  let snapshot
  const connection = {
    async query() {},
    async beginTransaction() { snapshot = structuredClone(state.users) },
    async execute(sql, values = []) {
      if (/SELECT DATABASE/.test(sql)) return [[{ databaseName: options.actualDatabase || 'cleanhome_staff_test' }], []]
      if (/FROM users/.test(sql)) return [structuredClone(state.users), []]
      if (/FROM employees/.test(sql)) return [structuredClone(state.employees), []]
      if (/FROM bookings/.test(sql)) return [structuredClone(state.bookings), []]
      if (/FROM assignments/.test(sql)) return [structuredClone(state.assignments), []]
      if (/UPDATE users SET password_hash = \?/.test(sql)) {
        assert.match(sql, /id = \? AND password_hash = \? AND role = \? AND status = 'ACTIVE'/)
        const row = state.users.find(item => item.id === values[1])
        if (options.failWrite) throw new Error('DB diagnostic must not escape')
        if (row?.passwordHash !== values[2]) return [{ affectedRows: 0 }, []]
        row.passwordHash = values[0]
        state.writes++
        return [{ affectedRows: 1 }, []]
      }
      throw new Error('Unexpected SQL command')
    },
    async commit() { state.commits++ },
    async rollback() { state.users = structuredClone(snapshot); state.rolledBack++ },
    release() { state.released++ },
  }
  const pool = { async getConnection() { return connection } }
  return { state, pool }
}

async function temporaryPath(t) {
  const directory = await mkdtemp(join(tmpdir(), 'cleanhome-auth-provision-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return join(directory, 'secrets', 'test-accounts.json')
}

test('provisioning requires the dedicated database and explicit opt-in before opening MySQL', async () => {
  let opened = false
  const pool = { async getConnection() { opened = true } }
  for (const options of [{ database: 'cleanhome_staff_test' }, { database: 'production', enabled: true }]) {
    await assert.rejects(provisionTestAccounts(pool, options), { code: 'PROVISIONING_NOT_ENABLED' })
  }
  assert.equal(opened, false)
})

test('provisioning checks the actual connected database and preserves foreign fixtures', async t => {
  const path = await temporaryPath(t)
  const wrongDatabase = provisioningFixture({ actualDatabase: 'production' })
  await assert.rejects(provisionTestAccounts(wrongDatabase.pool, { database: 'cleanhome_staff_test', enabled: true, credentialPath: path, credentialPrivateKeyPem }), { code: 'WRONG_DATABASE' })
  for (const kind of ['role', 'status', 'employee-link', 'booking-marker', 'assignment-link']) {
    const f = provisioningFixture()
    if (kind === 'role') f.state.users[1].role = 'ADMIN'
    if (kind === 'status') f.state.users[1].status = 'LOCKED'
    if (kind === 'employee-link') f.state.employees[0].userId = '1'
    if (kind === 'booking-marker') f.state.bookings[0].marker = 'foreign-data'
    if (kind === 'assignment-link') f.state.assignments[0].employeeId = '1'
    await assert.rejects(provisionTestAccounts(f.pool, { database: 'cleanhome_staff_test', enabled: true, credentialPath: path, credentialPrivateKeyPem }), { code: 'FIXTURE_MISMATCH' })
    assert.equal(f.state.writes, 0)
  }
  await assert.rejects(access(path), { code: 'ENOENT' })
})

test('provisioning writes only marker password hashes, encrypts credentials locally and reruns without changes', async t => {
  const path = await temporaryPath(t)
  const f = provisioningFixture()
  const immutable = JSON.stringify({ employees: f.state.employees, bookings: f.state.bookings, assignments: f.state.assignments,
    users: f.state.users.map(({ passwordHash, ...row }) => row) })
  const options = { database: 'cleanhome_staff_test', enabled: true, credentialPath: path, credentialPrivateKeyPem }
  const result = await provisionTestAccounts(f.pool, options)
  assert.equal(result.changed, 3)
  assert.equal(f.state.writes, 3)
  const credentialsText = await readFile(path, 'utf8')
  const credentials = decryptCredentials(JSON.parse(credentialsText), credentialPrivateKeyPem)
  for (const secret of credentials.accounts) {
    const row = f.state.users.find(item => item.id === secret.userId)
    assert.equal(await verifyPassword(secret.password, row.passwordHash), true)
    assert.equal(row.passwordHash.includes(secret.password), false)
    assert.equal(credentialsText.includes(secret.password), false)
  }
  assert.equal((await provisionTestAccounts(f.pool, options)).changed, 0)
  assert.equal(await readFile(path, 'utf8') === credentialsText, true)
  assert.equal(JSON.stringify({ employees: f.state.employees, bookings: f.state.bookings, assignments: f.state.assignments,
    users: f.state.users.map(({ passwordHash, ...row }) => row) }) === immutable, true)
})

test('provisioning never replaces an existing usable password without matching local credentials', async t => {
  const path = await temporaryPath(t)
  const f = provisioningFixture()
  f.state.users[0].passwordHash = 'existing-non-marker-password-hash'
  await assert.rejects(provisionTestAccounts(f.pool, { database: 'cleanhome_staff_test', enabled: true, credentialPath: path, credentialPrivateKeyPem }), { code: 'EXISTING_PASSWORD_PRESERVED' })
  assert.equal(f.state.writes, 0)
  await assert.rejects(access(path), { code: 'ENOENT' })
})

test('failed DB writes retain a recovery credential file and leave transaction rows unchanged', async t => {
  const path = await temporaryPath(t)
  const f = provisioningFixture({ failWrite: true })
  await assert.rejects(provisionTestAccounts(f.pool, { database: 'cleanhome_staff_test', enabled: true, credentialPath: path, credentialPrivateKeyPem }), { code: 'PROVISIONING_FAILED' })
  assert.equal(f.state.users.every(item => item.passwordHash === '!CLEANHOME_TEST_ONLY_NO_LOGIN!'), true)
  assert.equal(f.state.rolledBack, 1)
  assert.equal(f.state.released, 1)
  const saved = await readFile(path, 'utf8')
  assert.equal(decryptCredentials(JSON.parse(saved), credentialPrivateKeyPem).accounts.length, 3)
  await writeFile(path, '{}')
  const clean = provisioningFixture()
  await assert.rejects(provisionTestAccounts(clean.pool, { database: 'cleanhome_staff_test', enabled: true, credentialPath: path, credentialPrivateKeyPem }), { code: 'INVALID_CREDENTIAL_FILE' })
  assert.equal(clean.state.writes, 0)
})

test('provisioning refuses a legacy plaintext credential file without changing it or MySQL rows', async t => {
  const path = await temporaryPath(t)
  const f = provisioningFixture()
  const options = { database: 'cleanhome_staff_test', enabled: true, credentialPath: path, credentialPrivateKeyPem }
  await provisionTestAccounts(f.pool, options)
  const legacyValue = decryptCredentials(JSON.parse(await readFile(path, 'utf8')), credentialPrivateKeyPem)
  const legacyText = JSON.stringify(legacyValue)
  // Intentional invalid local fixture: only ephemeral test passwords, removed
  // with this test directory. Production code must never perform this rewrite.
  await writeFile(path, legacyText, { mode: 0o600 })
  const before = f.state.writes
  await assert.rejects(provisionTestAccounts(f.pool, options), { code: 'INVALID_CREDENTIAL_FILE' })
  assert.equal(f.state.writes, before)
  assert.equal((await readFile(path, 'utf8')) === legacyText, true)
})
