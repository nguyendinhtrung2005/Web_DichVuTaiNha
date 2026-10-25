import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertNoConcurrentWriters, backupWithMysqlDump } from '../scripts/uc12-qa/backup.mjs'

// Read/write private scratch files and explicit SQL doubles only; never MySQL.
const root = path.resolve(fileURLToPath(new URL('../.auth-data/qa/', import.meta.url)))
function pool({ database = 'cleanhome_staff_test', transactions = [], processes = [] } = {}) {
  let released = false
  return { get released() { return released }, async getConnection() { return {
    async query(sql) {
      if (sql.includes('CONNECTION_ID() connectionId')) return [[{ connectionId: 7, databaseName: database }]]
      if (sql.includes('innodb_trx')) return [transactions]
      if (sql.includes('processlist')) return [processes]
      throw new Error('Unexpected SQL in double')
    }, release() { released = true },
  } } }
}
async function artifact(t) {
  const directory = path.join(root, 'uc12-backup-unit-' + randomUUID()); await mkdir(directory, { recursive: true })
  t.after(async () => { const checked = path.resolve(directory); assert.equal(path.dirname(checked), root); assert.ok(path.basename(checked).startsWith('uc12-backup-unit-')); await rm(checked, { recursive: true, force: true }) })
  return directory
}
const db = { host: '127.0.0.1', port: 3306, database: 'cleanhome_staff_test', user: 'unit', password: 'unit-not-a-real-password' }
const tables = ['bookings', 'booking_items', 'assignments', 'booking_status_history']
async function prepared(t, contents) {
  const artifactDir = await artifact(t)
  const sql = contents || tables.map(table => 'CREATE TABLE `' + table + '` (id bigint);\nINSERT INTO `' + table + '` VALUES (1,\'JSON with (parentheses), commas, escaped \\\' quote and semicolon;\');').join('\n') + '\n-- Dump completed on 2026-10-24\n'
  const bytes = Buffer.from(sql), metadata = { kind: 'cleanhome.uc12-mysqldump-backup', database: db.database, host: db.host, port: db.port,
    sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, tableRowCounts: Object.fromEntries(tables.map(table => [table, 1])) }
  await writeFile(path.join(artifactDir, 'mysql-9.6-backup.sql'), bytes)
  await writeFile(path.join(artifactDir, 'mysql-9.6-backup.json'), JSON.stringify(metadata))
  return { artifactDir, metadata }
}
test('quiescence accepts idle/read-only sessions and explicitly states its point-in-time scope', async () => {
  const p = pool({ processes: [{ ID: 8, DB: db.database, COMMAND: 'Query', INFO: 'SELECT id FROM bookings' }] })
  const result = await assertNoConcurrentWriters(p)
  assert.equal(result.otherActiveTransactions, 0); assert.equal(result.otherActiveWriteQueries, 0); assert.match(result.scope, /point-in-time/); assert.equal(p.released, true)
})
test('quiescence refuses non-QA databases and another active transaction', async () => {
  await assert.rejects(assertNoConcurrentWriters(pool({ database: 'production' })), /non-QA/)
  await assert.rejects(assertNoConcurrentWriters(pool({ transactions: [{ trx_mysql_thread_id: 9 }] })), /active InnoDB/)
})
test('quiescence refuses write queries without echoing their SQL or sensitive contents', async () => {
  const secret = 'unit-sensitive-should-not-appear'
  await assert.rejects(assertNoConcurrentWriters(pool({ processes: [{ DB: db.database, INFO: "UPDATE users SET password_hash='" + secret + "'" }] })), error => !error.message.includes(secret) && /non-read-only/.test(error.message))
})
test('backup rejects wrong host/database before starting any dump client', async t => {
  const artifactDir = await artifact(t)
  await assert.rejects(backupWithMysqlDump({ db: { ...db, host: 'production.invalid' }, artifactDir, pool: pool() }), /limited/)
  await assert.rejects(backupWithMysqlDump({ db: { ...db, database: 'production' }, artifactDir, pool: pool() }), /limited/)
})
test('existing readable dump is verified using checksum, four schema sections and SQL-aware row counts', async t => {
  const f = await prepared(t), result = await backupWithMysqlDump({ db, ...f, pool: pool() })
  assert.equal(result.sha256, f.metadata.sha256); assert.ok(result.readBackVerifiedAt)
})
test('existing dump checksum changes fail rather than overwrite the backup', async t => {
  const f = await prepared(t)
  await writeFile(path.join(f.artifactDir, 'mysql-9.6-backup.sql'), tables.map(table => 'CREATE TABLE `' + table + '` (id bigint);\nINSERT INTO `' + table + '` VALUES (2);').join('\n') + '\n-- Dump completed on 2026-10-24\n')
  await assert.rejects(backupWithMysqlDump({ db, ...f, pool: pool() }), /checksum changed/)
})
test('dump without metadata, incomplete SQL and unexpected destructive output fail closed', async t => {
  const artifactDir = await artifact(t); await writeFile(path.join(artifactDir, 'mysql-9.6-backup.sql'), 'retained')
  await assert.rejects(backupWithMysqlDump({ db, artifactDir, pool: pool() }), /without metadata/)
  const incomplete = await prepared(t, 'CREATE TABLE `bookings` (id bigint);')
  await assert.rejects(backupWithMysqlDump({ db, ...incomplete, pool: pool() }), /completion marker/)
  const bad = await prepared(t, 'DROP TABLE `bookings`;\n' + tables.map(table => 'CREATE TABLE `' + table + '` (id bigint);\nINSERT INTO `' + table + '` VALUES (1);').join('\n') + '\n-- Dump completed on 2026-10-24\n')
  await assert.rejects(backupWithMysqlDump({ db, ...bad, pool: pool() }), /destructive/)
})
