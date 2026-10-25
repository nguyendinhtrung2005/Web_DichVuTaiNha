import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { link, lstat, mkdir, open, readFile, unlink } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const MYSQLDUMP = 'C:\\Program Files\\MySQL\\MySQL Server 9.6\\bin\\mysqldump.exe'
const TABLES = ['bookings', 'booking_items', 'assignments', 'booking_status_history']
const ROOT = path.resolve(fileURLToPath(new URL('../../.auth-data/qa/', import.meta.url)))
const fail = message => { throw new Error(message) }
const checksum = bytes => createHash('sha256').update(bytes).digest('hex')
const iso = () => new Date().toISOString()

/** Read-only point-in-time check. This does not claim to lock out unrelated writers. */
export async function assertNoConcurrentWriters(pool) {
  const connection = await pool.getConnection()
  try {
    const [current] = await connection.query('SELECT CONNECTION_ID() connectionId, DATABASE() databaseName')
    if (current[0]?.databaseName !== 'cleanhome_staff_test') fail('Writer safety check refused a non-QA database')
    const [transactions] = await connection.query('SELECT trx_mysql_thread_id FROM information_schema.innodb_trx')
    // Even another QA read transaction is unexpected during this quiescence gate.
    if (transactions.some(row => String(row.trx_mysql_thread_id) !== String(current[0].connectionId))) fail('Another active InnoDB transaction prevents safe QA fixture creation')
    const [processes] = await connection.query("SELECT ID,DB,COMMAND,INFO FROM information_schema.processlist WHERE ID <> CONNECTION_ID() AND COMMAND <> 'Sleep' AND INFO IS NOT NULL")
    // Do not log raw SQL: it can contain credentials or another member's data.
    const unsafe = processes.filter(row => {
      const db = row.DB ?? row.db, sql = String(row.INFO ?? row.info ?? '').trim()
      if (!sql || db && db !== 'cleanhome_staff_test') return false
      return !/^(?:SELECT|SHOW|EXPLAIN|DESCRIBE|DESC|SET\s+(?:SESSION\s+)?(?:time_zone|NAMES|TRANSACTION)|COMMIT|ROLLBACK)\b/i.test(sql)
    })
    if (unsafe.length) fail('An active non-read-only query prevents safe QA fixture creation')
    return { checkedAt: iso(), database: 'cleanhome_staff_test', otherActiveTransactions: 0, otherActiveWriteQueries: 0, scope: 'point-in-time observation only; advisory lock and preservation gates are also required' }
  } finally { connection.release() }
}

function countInsertRows(sql) {
  const counts = Object.fromEntries(TABLES.map(table => [table, 0]))
  const expression = /INSERT INTO `([^`]+)` VALUES\s*/g
  let match
  while ((match = expression.exec(sql))) {
    const table = match[1]
    if (!TABLES.includes(table)) fail('Dump unexpectedly includes an out-of-scope table')
    let depth = 0, quoted = false, ended = false
    for (let index = expression.lastIndex; index < sql.length; index++) {
      const char = sql[index]
      if (quoted) {
        if (char === '\\') { index++; continue }
        if (char === "'") { if (sql[index + 1] === "'") index++; else quoted = false }
        continue
      }
      if (char === "'") { quoted = true; continue }
      if (char === '(') { if (depth === 0) counts[table]++; depth++; continue }
      if (char === ')') { if (--depth < 0) fail('Dump INSERT structure is invalid'); continue }
      if (char === ';' && depth === 0) { expression.lastIndex = index + 1; ended = true; break }
    }
    if (!ended || depth !== 0 || quoted) fail('Dump INSERT is incomplete')
  }
  return counts
}
function validateSql(bytes, expectedCounts) {
  const sql = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  if (!sql.includes('-- Dump completed on')) fail('MySQL dump completion marker is missing')
  const created = [...sql.matchAll(/^CREATE TABLE `([^`]+)`/gm)].map(match => match[1])
  if (created.length !== 4 || TABLES.some(table => !created.includes(table))) fail('Dump must contain exactly the four approved table definitions')
  if (/^DROP\s+(?:DATABASE|TABLE)\b/im.test(sql)) fail('Dump contains an unexpected destructive statement')
  const counts = countInsertRows(sql)
  if (TABLES.some(table => counts[table] !== expectedCounts[table])) fail('Dump row counts do not match the quiescent preflight snapshot')
  return { bytes: bytes.length, sha256: checksum(bytes), tableRowCounts: counts, createTableCount: created.length, completionMarker: true, readable: true }
}
async function privatePath(directory) {
  if (!directory.startsWith(ROOT + path.sep)) fail('Backup must remain inside the ignored Staff QA artifact directory')
  let current = path.parse(directory).root
  for (const part of directory.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part)
    try { if ((await lstat(current)).isSymbolicLink()) fail('Backup path cannot contain symbolic links') }
    catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  await mkdir(directory, { recursive: true, mode: 0o700 })
}
async function fileBytes(file) {
  const before = await lstat(file)
  if (!before.isFile() || before.isSymbolicLink() || before.size > 64 * 1024 * 1024) fail('Backup artifact is not a bounded regular file')
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0))
  try { return await handle.readFile() } finally { await handle.close() }
}
function osEnvironment() {
  return Object.fromEntries(['PATH', 'Path', 'SystemRoot', 'ComSpec', 'TEMP', 'TMP', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA'].filter(name => process.env[name]).map(name => [name, process.env[name]]))
}
async function clientVersion() {
  const child = spawn(MYSQLDUMP, ['--no-defaults', '--version'], { env: osEnvironment(), windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
  let output = ''
  child.stdout.on('data', chunk => { if (output.length < 2048) output += chunk.toString('utf8') })
  const timer = setTimeout(() => child.kill(), 5000)
  try {
    const code = await new Promise((resolve, reject) => { child.once('error', () => reject(new Error('MySQL 9.6 dump client could not start'))); child.once('close', resolve) })
    if (code !== 0 || !/Ver\s+9\.6\.0\b/i.test(output)) fail('Expected MySQL 9.6.0 dump client is unavailable')
    return '9.6.0'
  } finally { clearTimeout(timer) }
}

/** Executes read-only mysqldump, never executes the resulting SQL. */
export async function backupWithMysqlDump({ db, artifactDir, pool }) {
  if (!db || db.host !== '127.0.0.1' || Number(db.port) !== 3306 || db.database !== 'cleanhome_staff_test'
    || typeof db.user !== 'string' || !db.user || typeof db.password !== 'string') fail('Dump is limited to the explicitly configured QA connection')
  const directory = path.resolve(artifactDir || ''), target = path.join(directory, 'mysql-9.6-backup.sql'), metadataPath = path.join(directory, 'mysql-9.6-backup.json')
  await privatePath(directory)
  let existingMetadata
  try { existingMetadata = JSON.parse((await fileBytes(metadataPath)).toString('utf8')) }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  if (existingMetadata) {
    const metadata = existingMetadata
    if (metadata.kind !== 'cleanhome.uc12-mysqldump-backup' || metadata.database !== db.database || metadata.host !== db.host || metadata.port !== 3306) fail('Existing dump metadata does not match the approved database')
    const verified = validateSql(await fileBytes(target), metadata.tableRowCounts)
    if (verified.sha256 !== metadata.sha256 || verified.bytes !== metadata.bytes) fail('Existing backup checksum changed; refusing overwrite')
    return { ...metadata, readBackVerifiedAt: iso() }
  }
  try { await lstat(target); fail('Dump exists without metadata; manual review required before any overwrite') } catch (error) { if (error.code !== 'ENOENT') throw error }
  const version = await clientVersion(), gate = await assertNoConcurrentWriters(pool)
  const connection = await pool.getConnection(), counts = {}
  try {
    const [server] = await connection.query('SELECT DATABASE() databaseName,VERSION() version')
    if (server[0]?.databaseName !== db.database || server[0].version !== version) fail('MySQL server/client version or QA database mismatch')
    for (const table of TABLES) counts[table] = Number((await connection.query('SELECT COUNT(*) count FROM ' + table))[0][0].count)
  } finally { connection.release() }
  const temporary = path.join(directory, '.mysql-9.6-backup.' + randomUUID() + '.tmp')
  const handle = await open(temporary, 'wx', 0o600)
  let child, timer
  try {
    child = spawn(MYSQLDUMP, ['--no-defaults', '--protocol=TCP', '--host=127.0.0.1', '--port=3306', '--user=' + db.user,
      '--single-transaction', '--skip-lock-tables', '--skip-add-locks', '--skip-add-drop-table', '--no-tablespaces', '--set-gtid-purged=OFF', '--column-statistics=0', '--default-character-set=utf8mb4', db.database, ...TABLES],
    { env: { ...osEnvironment(), MYSQL_PWD: db.password }, windowsHide: true, stdio: ['ignore', handle.fd, 'pipe'] })
    // Drain stderr without exposing its raw content or credentials to logs.
    child.stderr.on('data', () => {})
    timer = setTimeout(() => child.kill(), 60000)
    const code = await new Promise((resolve, reject) => { child.once('error', () => reject(new Error('MySQL backup process could not start; details withheld'))); child.once('close', resolve) })
    if (code !== 0) fail('MySQL backup process did not complete successfully; details withheld')
    await handle.sync(); await handle.close()
    const verified = validateSql(await fileBytes(temporary), counts)
    await assertNoConcurrentWriters(pool)
    await link(temporary, target)
    const metadata = { kind: 'cleanhome.uc12-mysqldump-backup', version: 1, database: db.database, host: db.host, port: 3306,
      clientVersion: version, serverVersion: version, createdAt: iso(), consistency: 'InnoDB --single-transaction', sqlNeverExecuted: true, writerGate: gate, ...verified }
    const meta = await open(metadataPath, 'wx', 0o600)
    try { await meta.writeFile(JSON.stringify(metadata, null, 2) + '\n', 'utf8'); await meta.sync() } finally { await meta.close() }
    const readBack = validateSql(await fileBytes(target), counts)
    if (readBack.sha256 !== metadata.sha256) fail('Published backup read-back checksum failed')
    return metadata
  } finally {
    clearTimeout(timer)
    if (child && child.exitCode === null) child.kill()
    try { await handle.close() } catch {}
    try { await unlink(temporary) } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
}
