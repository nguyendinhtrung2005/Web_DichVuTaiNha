import { randomUUID } from 'node:crypto'
import { readFile, realpath, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hashPassword, verifyPassword, passwordIsAcceptable } from '../../backend/auth-service/src/password.js'
import { createPool } from '../../backend/staff-service/src/db.js'

export const QA_DATABASE = 'cleanhome_staff_qa_isolated'
const qaDirectory = path.dirname(fileURLToPath(import.meta.url))
const privateDirectory = path.join(qaDirectory, '.private')
const configFile = path.join(privateDirectory, 'runtime-config.json')
const schemaFile = path.join(qaDirectory, 'schema.sql')
const check = (value, code) => { if (!value) throw Error(code) }
const id = value => typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value)
const localPath = value => path.resolve(String(value)).replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase()
const date = value => typeof value === 'string' && /^20\d\d-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + 'T00:00:00.000Z')) && new Date(value + 'T00:00:00.000Z').toISOString().slice(0, 10) === value
const plusDays = (day, n) => new Date(Date.parse(day + 'T00:00:00.000Z') + n * 86400000).toISOString().slice(0, 10)
const iso = value => new Date(value).toISOString()
const sqlTime = value => value === null ? null : new Date(value).toISOString().slice(0, 19).replace('T', ' ')
const roles = ['A', 'B', 'MANUAL', 'CUSTOMER']

/** Fail closed before any connection. No shared database, root user or secret fallback. */
export function validateSeedConfig(config) {
  check(config?.schemaVersion === 'CLEANHOME_STAFF_QA_V1' && config.kind === 'cleanhome.staff-qa-isolated' && config.version === 1 && config.isolated === true, 'ISOLATED_CONFIG_REQUIRED')
  check(typeof config.runId === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{7,99}$/.test(config.runId), 'QA_RUN_ID_REQUIRED')
  const db = config.db
  check(db && db.host === '127.0.0.1' && Number.isInteger(db.port) && db.port >= 1024 && db.port <= 65535 && db.port !== 3306
    && db.database === QA_DATABASE && db.user === 'staff_qa_app' && typeof db.password === 'string' && db.password.length >= 24, 'ISOLATED_MYSQL_CONFIG_REQUIRED')
  check(typeof config.mysql?.serverUuid === 'string' && /^[0-9a-f-]{36}$/i.test(config.mysql.serverUuid), 'MYSQL_INSTANCE_BINDING_REQUIRED')
  check(typeof config.mysql?.dataDir === 'string' && localPath(config.mysql.dataDir).startsWith(localPath(privateDirectory) + '/'), 'MYSQL_DATADIR_OUTSIDE_PRIVATE_QA')
  check(config.accounts && roles.every(label => {
    const account = config.accounts[label]
    return account?.label === label && id(account.userId) && (label === 'CUSTOMER' ? account.employeeId === null : id(account.employeeId))
      && (label === 'CUSTOMER' || account.branchId === '9603001') && typeof account.phone === 'string' && /^TEST-STAFF-QA-[A-Z]+$/.test(account.phone)
      && account.phone.length <= 20 && passwordIsAcceptable(account.password)
  }), 'SYNTHETIC_QA_ACCOUNTS_REQUIRED')
  check(new Set(roles.map(label => config.accounts[label].phone)).size === roles.length
    && new Set(roles.map(label => config.accounts[label].userId)).size === roles.length
    && new Set(['A', 'B', 'MANUAL'].map(label => config.accounts[label].employeeId)).size === 3, 'DUPLICATE_QA_ACCOUNT')
  check(/^20\d\d-(0[1-9]|1[0-2])$/.test(config.seed?.month || ''), 'QA_SEED_MONTH_REQUIRED')
  return config
}

export function seedPlan(config) {
  validateSeedConfig(config)
  const month = config.seed.month, anchorDay = config.seed.anchorDay || month + '-05'
  check(date(anchorDay) && anchorDay.startsWith(month), 'QA_ANCHOR_DAY_INVALID')
  const assignments = []
  for (const label of ['A', 'B']) {
    const account = config.accounts[label], count = label === 'B' ? 27 : 12, doneCount = label === 'B' ? 10 : 5
    for (let index = 0; index < count; index++) {
      const status = index < doneCount ? 'DONE' : index < doneCount + 2 ? 'IN_PROGRESS' : index < doneCount + 5 ? 'ACCEPTED'
        : label === 'B' && index >= 25 ? 'CANCELLED' : 'ASSIGNED'
      const offset = status === 'DONE' ? index - doneCount + 1 : status === 'IN_PROGRESS' ? 0 : index - doneCount - 1
      const day = plusDays(anchorDay, offset), hour = index % 3 === 0 ? '10' : '02'
      const start = Date.parse(day + 'T' + hour + ':00:00.000Z'), end = start + 2 * 3600000
      assignments.push({ label, assignmentId: String((label === 'B' ? 9622000 : 9621000) + index + 1), bookingId: String((label === 'B' ? 9612000 : 9611000) + index + 1),
        itemId: String((label === 'B' ? 9632000 : 9631000) + index + 1), historyId: String((label === 'B' ? 9642000 : 9641000) + index + 1),
        userId: account.userId, employeeId: account.employeeId, branchId: account.branchId, status,
        bookingStatus: status === 'DONE' ? 'COMPLETED' : status === 'IN_PROGRESS' ? 'IN_PROGRESS' : status === 'CANCELLED' ? 'CANCELLED' : 'CONFIRMED',
        scheduledAt: iso(start), expectedEndAt: iso(end), assignedAt: iso(start - 2 * 86400000),
        checkInAt: ['DONE', 'IN_PROGRESS'].includes(status) ? iso(start + (index % 2 ? 5 : 0) * 60000) : null,
        checkOutAt: status === 'DONE' ? iso(end - 5 * 60000) : null })
    }
  }
  const counts = Object.fromEntries(['A', 'B', 'MANUAL'].map(label => {
    const owned = assignments.filter(row => row.label === label)
    return [label, { total: owned.length, done: owned.filter(row => row.status === 'DONE').length,
      states: Object.fromEntries(['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'DONE', 'CANCELLED'].map(status => [status, owned.filter(row => row.status === status).length])) }]
  }))
  const weekDate = new Date(anchorDay + 'T00:00:00.000Z'), weekFrom = plusDays(anchorDay, -((weekDate.getUTCDay() + 6) % 7))
  const notifications = {}, availability = {}
  for (const [index, label] of ['A', 'B', 'MANUAL'].entries()) {
    notifications[label] = label === 'MANUAL' ? [] : Array.from({ length: 3 }, (_, n) => ({ id: String(9651000 + index * 100 + n + 1),
      bookingId: assignments.find(row => row.label === label).bookingId, readAt: n === 0 ? null : anchorDay + 'T02:00:00.000Z', createdAt: plusDays(anchorDay, -n) + 'T01:00:00.000Z' }))
    availability[label] = label === 'MANUAL' ? [] : Array.from({ length: 3 }, (_, n) => ({ id: String(9661000 + index * 100 + n + 1),
      startsAt: plusDays(weekFrom, n * 2) + 'T01:00:00.000Z', endsAt: plusDays(weekFrom, n * 2) + 'T10:00:00.000Z', status: n === 2 ? 'UNAVAILABLE' : 'AVAILABLE' }))
  }
  return { kind: 'synthetic-isolated-qa-seed', version: 1, anchorDay, month, counts, assignments, notifications, availability,
    range: { from: month + '-01', to: new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10) },
    allRange: { from: assignments.reduce((earliest, row) => row.scheduledAt.slice(0, 10) < earliest ? row.scheduledAt.slice(0, 10) : earliest, anchorDay),
      to: assignments.reduce((latest, row) => row.scheduledAt.slice(0, 10) > latest ? row.scheduledAt.slice(0, 10) : latest, anchorDay) },
    weekRange: { from: weekFrom, to: plusDays(weekFrom, 6) }, syntheticData: true }
}

async function loadPrivateConfig() {
  const [actualPrivate, actualConfig] = await Promise.all([realpath(privateDirectory), realpath(configFile)])
  check(localPath(actualPrivate) === localPath(privateDirectory) && localPath(actualConfig) === localPath(configFile), 'QA_CONFIG_SYMLINK_REFUSED')
  return validateSeedConfig(JSON.parse(await readFile(configFile, 'utf8')))
}

async function assertInstance(connection, config) {
  const [[server]] = await connection.query('SELECT DATABASE() AS databaseName, @@port AS port, @@server_uuid AS serverUuid, @@datadir AS dataDir, VERSION() AS version')
  check(server.databaseName === QA_DATABASE && Number(server.port) === config.db.port && server.serverUuid === config.mysql.serverUuid
    && localPath(server.dataDir) === localPath(config.mysql.dataDir) && /^\d+\./.test(server.version) && Number(server.version.split('.')[0]) >= 8
    && !/mariadb/i.test(server.version), 'MYSQL_INSTANCE_BINDING_MISMATCH')
}

async function executeSeed(config, plan) {
  const pool = createPool({ ...config.db, connectionLimit: 1 })
  let connection
  try {
    connection = await pool.getConnection()
    await assertInstance(connection, config)
    await connection.query("SET SESSION time_zone = '+00:00'")
    const [existing] = await connection.query('SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()')
    if (existing.length) {
      check(existing.some(row => row.name === 'staff_qa_seed_marker'), 'NONEMPTY_DATABASE_WITHOUT_QA_MARKER')
      const [[marker]] = await connection.query('SELECT run_id AS runId, schema_version AS version FROM staff_qa_seed_marker WHERE id = 1')
      check(marker?.runId === config.runId && Number(marker.version) === 1, 'QA_DATABASE_RUN_BINDING_MISMATCH')
    }
    const schema = (await readFile(schemaFile, 'utf8')).replace(/^--.*$/gm, '')
    const statements = schema.split(';').map(value => value.trim()).filter(Boolean)
    check(statements.length === 15 && statements.every(value => /^CREATE TABLE IF NOT EXISTS [a-z_]+\s*\(/.test(value)), 'QA_SCHEMA_STATEMENTS_INVALID')
    for (const statement of statements) await connection.query(statement)
    // This instance/run binding survives a later DML rollback; reruns never rotate credentials or reset rows.
    await connection.execute('INSERT IGNORE INTO staff_qa_seed_marker (id, run_id, schema_version) VALUES (1, ?, 1)', [config.runId])
    await connection.beginTransaction()
    try {
      for (const label of roles) {
        const account = config.accounts[label], [rows] = await connection.execute('SELECT phone, password_hash AS passwordHash, role FROM users WHERE id = ?', [account.userId])
        if (rows.length) check(rows[0].phone === account.phone && rows[0].role === (label === 'CUSTOMER' ? 'CUSTOMER' : 'EMPLOYEE')
          && await verifyPassword(account.password, rows[0].passwordHash), 'EXISTING_QA_USER_CREDENTIAL_MISMATCH')
        else await connection.execute('INSERT INTO users (id, full_name, phone, password_hash, role, status) VALUES (?, ?, ?, ?, ?, ?)',
          [account.userId, '[ISOLATED QA] ' + label, account.phone, await hashPassword(account.password), label === 'CUSTOMER' ? 'CUSTOMER' : 'EMPLOYEE', 'ACTIVE'])
      }
      await connection.execute('INSERT IGNORE INTO branches (id, name, address_text, service_area, latitude, longitude, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ['9603001', '[ISOLATED QA] Synthetic branch', '[ISOLATED QA] Địa chỉ kiểm thử tổng hợp, không phải địa điểm vận hành', JSON.stringify({ type: 'Polygon', coordinates: [[[106.69, 10.79], [106.71, 10.79], [106.71, 10.81], [106.69, 10.79]]] }), '10.8000000', '106.7000000', 'ACTIVE'])
      for (const label of ['A', 'B', 'MANUAL']) {
        const account = config.accounts[label]
        await connection.execute('INSERT IGNORE INTO employees (id, user_id, branch_id, verification_status, experience_years, status) VALUES (?, ?, ?, ?, ?, ?)',
          [account.employeeId, account.userId, account.branchId, 'VERIFIED', 1, 'ACTIVE'])
      }
      await connection.execute('INSERT IGNORE INTO service_categories (id, name, description, is_active) VALUES (?, ?, ?, ?)', ['9604001', '[ISOLATED QA] Dịch vụ', 'Synthetic QA data only', 1])
      await connection.execute('INSERT IGNORE INTO services (id, category_id, name, description, unit, base_price, duration_minutes, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ['9604002', '9604001', '[ISOLATED QA] Vệ sinh kiểm thử', 'Synthetic QA data only', 'giờ', '120000.00', 120, 1])
      for (const row of plan.assignments) {
        await connection.execute('INSERT IGNORE INTO bookings (id, customer_id, branch_id, address_snapshot, scheduled_start, scheduled_end, status, total_amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [row.bookingId, config.accounts.CUSTOMER.userId, row.branchId, JSON.stringify({ recipient: '[ISOLATED QA] Khách tổng hợp', address_text: '[ISOLATED QA] Địa chỉ tổng hợp', phone: config.accounts.CUSTOMER.phone }), sqlTime(row.scheduledAt), sqlTime(row.expectedEndAt), row.bookingStatus, '180000.00'])
        await connection.execute('INSERT IGNORE INTO booking_items (id, booking_id, service_id, service_name_snapshot, quantity, unit_price, unit_snapshot) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [row.itemId, row.bookingId, '9604002', '[ISOLATED QA] Vệ sinh kiểm thử', '1.50', '120000.00', 'giờ'])
        await connection.execute('INSERT IGNORE INTO assignments (id, booking_id, employee_id, assigned_at, check_in_at, check_out_at, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [row.assignmentId, row.bookingId, row.employeeId, sqlTime(row.assignedAt), sqlTime(row.checkInAt), sqlTime(row.checkOutAt), row.status])
        await connection.execute('INSERT IGNORE INTO booking_status_history (id, booking_id, changed_by, status, note, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          [row.historyId, row.bookingId, row.userId, row.bookingStatus, '[ISOLATED QA] Initial synthetic fixture state; no UC12 operation', sqlTime(row.assignedAt)])
      }
      for (const label of ['A', 'B', 'MANUAL']) {
        for (const row of plan.notifications[label]) await connection.execute('INSERT IGNORE INTO notifications (id, user_id, booking_id, content, read_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          [row.id, config.accounts[label].userId, row.bookingId, '[ISOLATED QA] Thông báo tổng hợp ' + label + ' #' + row.id, sqlTime(row.readAt), sqlTime(row.createdAt)])
        for (const row of plan.availability[label]) await connection.execute('INSERT IGNORE INTO employee_availability (id, employee_id, starts_at, ends_at, status) VALUES (?, ?, ?, ?, ?)',
          [row.id, config.accounts[label].employeeId, sqlTime(row.startsAt), sqlTime(row.endsAt), row.status])
      }
      const [actual] = await connection.query('SELECT CAST(employee_id AS CHAR) AS employeeId, status, COUNT(*) AS count FROM assignments GROUP BY employee_id, status')
      for (const label of ['A', 'B', 'MANUAL']) {
        const rows = actual.filter(row => row.employeeId === config.accounts[label].employeeId)
        check(rows.reduce((sum, row) => sum + Number(row.count), 0) === plan.counts[label].total
          && Number(rows.find(row => row.status === 'DONE')?.count || 0) === plan.counts[label].done, 'SEEDED_COUNTS_MISMATCH')
      }
      await connection.execute('UPDATE staff_qa_seed_marker SET seeded_at = COALESCE(seeded_at, UTC_TIMESTAMP()) WHERE id = 1 AND run_id = ?', [config.runId])
      await connection.commit()
    } catch (error) { await connection.rollback(); throw error }
    // Credentials remain in the existing root-created private config; only metadata is added.
    const current = await loadPrivateConfig()
    check(current.runId === config.runId && current.mysql.serverUuid === config.mysql.serverUuid, 'QA_CONFIG_CHANGED_DURING_SEED')
    for (const label of roles) current.accounts[label].assignmentIds = plan.assignments.filter(row => row.label === label).map(row => row.assignmentId)
    current.seed = { ...current.seed, ...plan, seededAt: new Date().toISOString() }
    const temporary = path.join(privateDirectory, '.seed-metadata-' + randomUUID() + '.tmp')
    await writeFile(temporary, JSON.stringify(current, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
    await rename(temporary, configFile)
    return { database: QA_DATABASE, port: config.db.port, syntheticData: true, counts: plan.counts, month: plan.month, range: plan.range, allRange: plan.allRange, privateMetadataUpdated: true }
  } finally { connection?.release(); await pool.end() }
}

export async function main(args = process.argv.slice(2)) {
  check(args.length <= 1 && (args.length === 0 || ['--execute', '--dry-run'].includes(args[0])), 'INVALID_SEED_ARGUMENTS')
  const config = await loadPrivateConfig(), plan = seedPlan(config)
  if (args[0] !== '--execute') return { status: 'NOT_RUN', connected: false, databaseWrites: false, reason: 'Use --execute only after root confirms the isolated database is ready', database: QA_DATABASE, port: config.db.port, counts: plan.counts, range: plan.allRange }
  return { status: 'PASS', ...await executeSeed(config, plan) }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(result => console.log(JSON.stringify(result))).catch(error => {
    console.error(JSON.stringify({ status: 'BLOCKED', code: /^[A-Z_]+$/.test(error.message) ? error.message : 'ISOLATED_QA_SEED_FAILED_DETAILS_WITHHELD' }))
    process.exitCode = 1
  })
}
