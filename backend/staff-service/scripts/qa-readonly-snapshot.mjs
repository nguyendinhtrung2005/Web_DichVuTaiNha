import { createHash } from 'node:crypto'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPool } from '../src/db.js'

// No service startup, credential loading, migration, fixture helper or business mutation.
// `plan` never creates a pool. `before` / `after` require explicit opt-in and a local QA DB.
const root = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)))
const artifactRoot = path.join(root, 'frontend/apps/staff/.auth-data/qa')
const tables = ['users', 'employees', 'assignments', 'bookings', 'booking_items', 'booking_status_history']
const expectedPeople = [
  { label: 'B', userId: '9109101', employeeId: '9109102', expectedAssignments: 27, expectedDone: 10 },
  { label: 'A', userId: '9109002', employeeId: '9109004', expectedAssignments: 29, expectedDone: 16 },
  { label: 'MANUAL', userId: '9109102', employeeId: '9109103', expectedAssignments: 0, expectedDone: 0 },
]
const check = (condition, code) => { if (!condition) throw Error(code) }
const canonical = value => {
  if (Buffer.isBuffer(value)) return { binaryHex: value.toString('hex') }
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
  return typeof value === 'bigint' ? value.toString() : value
}
const hash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
const [mode = 'plan', directory] = process.argv.slice(2)
let pool
try {
  check(['plan', 'before', 'after'].includes(mode) && process.argv.length <= 4, 'INVALID_QA_MODE')
  const env = process.env
  const ready = !!env.MYSQL_USER?.trim() && env.MYSQL_PASSWORD !== undefined && env.MYSQL_DATABASE === 'cleanhome_staff_test'
    && ['127.0.0.1', 'localhost'].includes(env.MYSQL_HOST || '127.0.0.1') && Number(env.MYSQL_PORT || 3306) === 3306
  if (mode === 'plan') {
    console.log(JSON.stringify({ status: 'NOT_RUN', connected: false, databaseWrites: false, configurationReady: ready,
      missingVariables: ['MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DATABASE'].filter(name => env[name] === undefined || name !== 'MYSQL_PASSWORD' && !env[name]?.trim()),
      optInRequired: 'RUN_STAFF_READONLY_DB_QA=true', database: 'cleanhome_staff_test', localPort: 3306, tables, expectedPeople }))
  } else {
    check(env.RUN_STAFF_READONLY_DB_QA === 'true', 'READONLY_QA_OPT_IN_REQUIRED')
    check(ready, 'LOCAL_QA_MYSQL_CONFIGURATION_REQUIRED')
    check(typeof directory === 'string' && directory.length > 0, 'QA_ARTIFACT_DIRECTORY_REQUIRED')
    const target = path.resolve(directory)
    check(target.startsWith(artifactRoot + path.sep), 'QA_ARTIFACT_OUTSIDE_WORKTREE')
    // Resolve the nearest existing ancestor before creating a report directory.
    let ancestor = target
    for (;;) {
      try { const actual = await realpath(ancestor); check(actual === artifactRoot || actual.startsWith(artifactRoot + path.sep), 'QA_ARTIFACT_SYMLINK_OUTSIDE_WORKTREE'); break }
      catch (error) { if (error.code !== 'ENOENT') throw error; const parent = path.dirname(ancestor); check(parent !== ancestor, 'QA_ARTIFACT_PARENT_REQUIRED'); ancestor = parent }
    }
    let baseline
    if (mode === 'after') {
      baseline = JSON.parse(await readFile(path.join(target, 'database-before.json'), 'utf8'))
      check(baseline.kind === 'cleanhome.staff-readonly-snapshot' && baseline.database === 'cleanhome_staff_test' && baseline.databaseWrites === false
        && tables.every(table => typeof baseline.fingerprints?.[table]?.sha256 === 'string'), 'INVALID_QA_BASELINE')
    }
    pool = createPool({ host: env.MYSQL_HOST || '127.0.0.1', port: 3306, user: env.MYSQL_USER.trim(), password: env.MYSQL_PASSWORD,
      database: 'cleanhome_staff_test', connectionLimit: 1 })
    const connection = await pool.getConnection()
    const snapshot = { kind: 'cleanhome.staff-readonly-snapshot', version: 1, at: new Date().toISOString(), database: 'cleanhome_staff_test', databaseWrites: false,
      transaction: 'REPEATABLE READ / READ ONLY / CONSISTENT SNAPSHOT', fingerprints: {}, people: [] }
    try {
      await connection.query("SET SESSION time_zone = '+00:00'")
      await connection.query('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ')
      await connection.query('SET TRANSACTION READ ONLY')
      await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT')
      const [[identity]] = await connection.query('SELECT DATABASE() AS name')
      check(identity.name === 'cleanhome_staff_test', 'DATABASE_IDENTITY_MISMATCH')
      for (const table of tables) {
        // All columns are hashed in memory; no raw row, phone, password hash or booking content is saved.
        const [rows] = await connection.query('SELECT * FROM `' + table + '` ORDER BY id LIMIT 20001')
        check(rows.length <= 20000, 'QA_TABLE_EXCEEDS_SAFE_SNAPSHOT_LIMIT')
        snapshot.fingerprints[table] = { count: rows.length, sha256: hash(rows) }
      }
      for (const expected of expectedPeople) {
        const [employees] = await connection.execute('SELECT CAST(id AS CHAR) AS employeeId, CAST(user_id AS CHAR) AS userId, status FROM employees WHERE user_id = ?', [expected.userId])
        check(employees.length === 1 && employees[0].employeeId === expected.employeeId, 'QA_EMPLOYEE_MAPPING_MISMATCH')
        const [assignments] = await connection.execute('SELECT CAST(id AS CHAR) AS assignmentId, CAST(booking_id AS CHAR) AS bookingId, status, check_in_at AS checkInAt, check_out_at AS checkOutAt FROM assignments WHERE employee_id = ? ORDER BY id', [expected.employeeId])
        const states = Object.fromEntries(['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'DONE', 'CANCELLED'].map(status => [status, assignments.filter(value => value.status === status).length]))
        snapshot.people.push({ ...expected, actualAssignments: assignments.length, actualDone: states.DONE,
          expectedCountsMatch: assignments.length === expected.expectedAssignments && states.DONE === expected.expectedDone,
          employeeStatus: employees[0].status, states, assignmentIds: assignments.map(value => value.assignmentId), assignmentFactsSha256: hash(assignments) })
      }
      await connection.rollback()
    } catch (error) { await connection.rollback().catch(() => {}); throw error }
    finally { connection.release() }
    if (baseline) {
      snapshot.unchanged = tables.every(table => snapshot.fingerprints[table].sha256 === baseline.fingerprints[table].sha256
        && snapshot.fingerprints[table].count === baseline.fingerprints[table].count)
      snapshot.changedTables = tables.filter(table => snapshot.fingerprints[table].sha256 !== baseline.fingerprints[table].sha256
        || snapshot.fingerprints[table].count !== baseline.fingerprints[table].count)
    }
    snapshot.expectedCountsMatch = snapshot.people.every(person => person.expectedCountsMatch)
    await mkdir(target, { recursive: true, mode: 0o700 })
    const output = path.join(target, mode === 'before' ? 'database-before.json' : 'database-after.json')
    await writeFile(output, JSON.stringify(snapshot, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
    const passed = snapshot.expectedCountsMatch && (!baseline || snapshot.unchanged)
    console.log(JSON.stringify({ status: passed ? 'PASS' : 'FAIL', databaseWrites: false, mode,
      expectedCountsMatch: snapshot.expectedCountsMatch, unchanged: snapshot.unchanged, changedTables: snapshot.changedTables,
      people: snapshot.people.map(({ assignmentIds, assignmentFactsSha256, ...person }) => person), artifact: output }))
    if (!passed) process.exitCode = 1
  }
} catch (error) {
  // Never print raw SQL/driver errors, connection configuration, credentials or rows.
  console.error(JSON.stringify({ status: 'FAIL', databaseWrites: false, code: /^[A-Z_]+$/.test(error.message) ? error.message : 'READONLY_QA_FAILED_DETAILS_WITHHELD' }))
  process.exitCode = 1
} finally { if (pool) await pool.end().catch(() => {}) }
