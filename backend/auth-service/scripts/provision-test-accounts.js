import { createPublicKey, randomBytes } from 'node:crypto'
import { mkdir, open, lstat, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPool } from '../src/db.js'
import { loadDbConfig } from '../src/config.js'
import { hashPassword, verifyPassword } from '../src/password.js'
import { encryptCredentials, decryptCredentials } from '../src/credential-vault.js'

const marker = '!CLEANHOME_TEST_ONLY_NO_LOGIN!'
const databaseName = 'cleanhome_staff_test'
const credentialPath = fileURLToPath(new URL('../secrets/test-accounts.json', import.meta.url))
const fixtures = Object.freeze([
  { label: 'A', userId: '9109002', employeeId: '9109004', phone: 'TEST-EMPLOYEE-UC9', role: 'EMPLOYEE' },
  { label: 'B', userId: '9109101', employeeId: '9109102', phone: 'TEST-EMPLOYEE-UC9-B', role: 'EMPLOYEE' },
  { label: 'CUSTOMER', userId: '9109001', employeeId: null, phone: 'TEST-CUSTOMER-UC9', role: 'CUSTOMER' },
])

function provisioningError(code) {
  const error = new Error('Không thể cấp thông tin đăng nhập kiểm thử an toàn; kiểm tra fixture, cấu hình và quyền file cục bộ.')
  error.code = code
  return error
}

function validateCredentials(value) {
  if (!value || value.version !== 1 || value.database !== databaseName ||
      !Array.isArray(value.accounts) || value.accounts.length !== fixtures.length) {
    throw provisioningError('INVALID_CREDENTIAL_FILE')
  }
  for (const fixture of fixtures) {
    const matches = value.accounts.filter(item => item?.label === fixture.label)
    const item = matches[0]
    if (matches.length !== 1 || item.userId !== fixture.userId || item.employeeId !== fixture.employeeId ||
        item.phone !== fixture.phone || typeof item.password !== 'string' || !/^[A-Za-z0-9_-]{32}$/.test(item.password)) {
      throw provisioningError('INVALID_CREDENTIAL_FILE')
    }
  }
  return value
}

async function readCredentials(path, privateKeyPem) {
  try {
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink() || info.size > 26000) throw provisioningError('INVALID_CREDENTIAL_FILE')
    const handle = await open(path, 'r')
    try { return validateCredentials(decryptCredentials(JSON.parse(await handle.readFile('utf8')), privateKeyPem)) }
    finally { await handle.close() }
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw provisioningError('INVALID_CREDENTIAL_FILE')
  }
}

async function writeCredentials(path, credentials, privateKeyPem) {
  const publicKeyPem = createPublicKey(privateKeyPem).export({ type: 'spki', format: 'pem' })
  const envelope = encryptCredentials(credentials, publicKeyPem)
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  // Exclusive create protects an existing credential file, including a file
  // written by a concurrent invocation. Persist before any DB write/commit.
  const handle = await open(path, 'wx', 0o600)
  try {
    await handle.writeFile(JSON.stringify(envelope, null, 2) + '\n', 'utf8')
    await handle.sync()
  } finally { await handle.close() }
}

async function assertLineage(connection, users) {
  if (users.length !== fixtures.length) throw provisioningError('FIXTURE_MISMATCH')
  for (const expected of fixtures) {
    const actual = users.find(row => String(row.id) === expected.userId)
    if (!actual || actual.phone !== expected.phone || actual.role !== expected.role || actual.status !== 'ACTIVE') {
      throw provisioningError('FIXTURE_MISMATCH')
    }
  }
  const [employees] = await connection.execute(`SELECT id, user_id AS userId, branch_id AS branchId, status
    FROM employees WHERE user_id IN (?, ?, ?) ORDER BY id FOR UPDATE`, fixtures.map(item => item.userId))
  if (employees.length !== 2 || !fixtures.filter(item => item.employeeId).every(expected => employees.some(row =>
    String(row.id) === expected.employeeId && String(row.userId) === expected.userId &&
    String(row.branchId) === '9109003' && row.status === 'ACTIVE'))) {
    throw provisioningError('FIXTURE_MISMATCH')
  }
  const [bookings] = await connection.execute(`SELECT id, customer_id AS customerId, branch_id AS branchId,
    JSON_UNQUOTE(JSON_EXTRACT(address_snapshot, '$._cleanhome_fixture')) AS marker
    FROM bookings WHERE id IN (?, ?, ?, ?, ?) ORDER BY id`, ['9109007', '9109103', '9109111', '9109121', '9109131'])
  if (bookings.length !== 5 || bookings.some(row => String(row.customerId) !== '9109001' ||
    String(row.branchId) !== '9109003' || row.marker !== (String(row.id) === '9109007'
      ? 'cleanhome-staff-uc9-uc12-v1' : 'cleanhome-staff-uc9-uc12-multi-v1'))) {
    throw provisioningError('FIXTURE_MISMATCH')
  }
  const [assignments] = await connection.execute(`SELECT id, booking_id AS bookingId, employee_id AS employeeId
    FROM assignments WHERE id IN (?, ?, ?, ?, ?, ?) ORDER BY id`,
  ['9109008', '9109105', '9109113', '9109123', '9109133', '9109134'])
  const expectedAssignments = [
    ['9109008', '9109007', '9109004'], ['9109105', '9109103', '9109102'],
    ['9109113', '9109111', '9109004'], ['9109123', '9109121', '9109004'],
    ['9109133', '9109131', '9109004'], ['9109134', '9109131', '9109102'],
  ]
  if (assignments.length !== expectedAssignments.length || expectedAssignments.some(([id, bookingId, employeeId]) =>
    !assignments.some(row => String(row.id) === id && String(row.bookingId) === bookingId && String(row.employeeId) === employeeId))) {
    throw provisioningError('FIXTURE_MISMATCH')
  }
}

export async function provisionTestAccounts(pool, options) {
  if (options?.database !== databaseName || options?.enabled !== true) throw provisioningError('PROVISIONING_NOT_ENABLED')
  const path = options.credentialPath || credentialPath
  let connection
  let transactionStarted = false
  try {
    connection = await pool.getConnection()
    await connection.query("SET SESSION time_zone = '+00:00'")
    const [databases] = await connection.execute('SELECT DATABASE() AS databaseName')
    if (databases[0]?.databaseName !== databaseName) throw provisioningError('WRONG_DATABASE')
    await connection.beginTransaction()
    transactionStarted = true
    const [users] = await connection.execute(`SELECT id, phone, role, status, password_hash AS passwordHash
      FROM users WHERE id IN (?, ?, ?) ORDER BY id FOR UPDATE`, fixtures.map(item => item.userId))
    await assertLineage(connection, users)
    let credentials = await readCredentials(path, options.credentialPrivateKeyPem)
    if (!credentials && users.some(row => row.passwordHash !== marker)) throw provisioningError('EXISTING_PASSWORD_PRESERVED')
    if (!credentials) {
      credentials = {
        version: 1,
        database: databaseName,
        accounts: fixtures.map(({ role, ...fixture }) => ({ ...fixture, password: randomBytes(24).toString('base64url') })),
      }
      await writeCredentials(path, credentials, options.credentialPrivateKeyPem)
    }
    let changed = 0
    for (const expected of fixtures) {
      const user = users.find(item => String(item.id) === expected.userId)
      const secret = credentials.accounts.find(item => item.label === expected.label)
      if (user.passwordHash !== marker) {
        if (!await verifyPassword(secret.password, user.passwordHash)) throw provisioningError('EXISTING_PASSWORD_PRESERVED')
        continue
      }
      const passwordHash = await hashPassword(secret.password)
      const [result] = await connection.execute(`UPDATE users SET password_hash = ?
        WHERE id = ? AND password_hash = ? AND role = ? AND status = 'ACTIVE'`,
      [passwordHash, expected.userId, marker, expected.role])
      if (result.affectedRows !== 1) throw provisioningError('CONCURRENT_ACCOUNT_CHANGE')
      changed++
    }
    await connection.commit()
    transactionStarted = false
    return { database: databaseName, accounts: fixtures.length, changed, credentialPath: path }
  } catch (error) {
    if (transactionStarted) {
      try { await connection.rollback() } catch { /* Never replace with a raw DB error. */ }
    }
    // Keep the secret file after any failure/uncertain commit. A rerun verifies
    // its passwords against current hashes and repairs marker rows only.
    const allowed = new Set(['PROVISIONING_NOT_ENABLED', 'WRONG_DATABASE', 'FIXTURE_MISMATCH',
      'INVALID_CREDENTIAL_FILE', 'EXISTING_PASSWORD_PRESERVED', 'CONCURRENT_ACCOUNT_CHANGE'])
    throw provisioningError(allowed.has(error?.code) ? error.code : 'PROVISIONING_FAILED')
  } finally { connection?.release() }
}

async function main() {
  let pool
  try {
    const config = loadDbConfig(process.env)
    if (config.database !== databaseName || process.env.AUTH_PROVISION_TEST_ACCOUNTS !== 'true') {
      throw provisioningError('PROVISIONING_NOT_ENABLED')
    }
    if (!process.env.JWT_PRIVATE_KEY_FILE?.trim()) throw provisioningError('INVALID_CREDENTIAL_FILE')
    const privateKeyPem = await readFile(process.env.JWT_PRIVATE_KEY_FILE, 'utf8')
    pool = createPool(config)
    const result = await provisionTestAccounts(pool, { database: config.database, enabled: true, credentialPrivateKeyPem: privateKeyPem })
    console.info(`Auth test accounts: database=${result.database}, accounts=${result.accounts}, changed=${result.changed}. Credentials: secrets/test-accounts.json (local only).`)
  } catch (error) {
    console.error(`Auth test account provisioning failed (${String(error?.code || 'PROVISIONING_FAILED').replace(/[^A-Z_]/g, '')}). No credentials were printed.`)
    process.exitCode = 1
  } finally {
    try { await pool?.end() }
    catch { console.error('Auth test account database cleanup failed; details withheld.'); process.exitCode = 1 }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
