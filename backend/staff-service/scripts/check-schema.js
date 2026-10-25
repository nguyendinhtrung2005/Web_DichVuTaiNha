import { createPool } from '../src/db.js'
import { MysqlStaffRepository } from '../src/repository.js'

// This diagnostic only needs MySQL configuration; JWT and Order credentials
// are intentionally not required to inspect an already initialized database.
let pool
try {
  const user = process.env.MYSQL_USER?.trim(), database = process.env.MYSQL_DATABASE?.trim()
  const port = Number(process.env.MYSQL_PORT || 3306)
  if (!user || !database || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('MYSQL_CONFIGURATION_REQUIRED')
  pool = createPool({ host: process.env.MYSQL_HOST?.trim() || '127.0.0.1', port, user, password: process.env.MYSQL_PASSWORD || '', database, connectionLimit: 1 })
  await new MysqlStaffRepository(pool).assertSchema()
  process.stdout.write(JSON.stringify({ event: 'staff_schema_compatible', tablesChecked: 8, changesApplied: false }) + '\n')
} catch (error) {
  // Do not log connection strings, raw SQL errors, passwords or data.
  process.stderr.write(JSON.stringify({ event: 'staff_schema_check_failed', code: error.code || 'MYSQL_CONFIGURATION_REQUIRED', ...(error.details ? { details: error.details } : {}) }) + '\n')
  process.exitCode = 1
} finally { if (pool) await pool.end() }
