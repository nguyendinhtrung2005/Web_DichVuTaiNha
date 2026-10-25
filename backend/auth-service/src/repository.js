// The source of truth is databases/schema.sql: Auth owns credentials in users;
// employee profiles and all booking data are read-only dependencies here.
const requiredColumns = {
  users: {
    id: 'bigint', phone: 'varchar', password_hash: 'varchar',
    role: 'varchar', status: 'varchar',
  },
  employees: { id: 'bigint', user_id: 'bigint', status: 'varchar' },
}

function repositoryError(code) {
  const error = new Error(code === 'DATABASE_SCHEMA_INCOMPATIBLE'
    ? 'Schema MySQL chưa tương thích với Auth Service.'
    : 'Không thể đọc dữ liệu xác thực MySQL.')
  error.code = code
  return error
}

function account(row) {
  if (!row) return null
  return {
    ...row,
    id: String(row.id),
    employeeId: row.employeeId == null ? null : String(row.employeeId),
  }
}

const publicSelect = `u.id, u.phone, u.role, u.status,
  e.id AS employeeId, e.status AS employeeStatus`

export class MysqlAuthRepository {
  constructor(pool) { this.pool = pool }

  async connection(callback) {
    let connection
    try {
      connection = await this.pool.getConnection()
      await connection.query("SET SESSION time_zone = '+00:00'")
      return await callback(connection)
    } catch (error) {
      if (error?.code === 'DATABASE_SCHEMA_INCOMPATIBLE') throw error
      // Never expose a driver error: it may include SQL values or credentials.
      throw repositoryError('DB_UNAVAILABLE')
    } finally { connection?.release() }
  }

  async health() {
    return this.connection(async connection => {
      await connection.execute('SELECT 1')
      return true
    })
  }

  async assertSchema() {
    return this.connection(async connection => {
      const [versions] = await connection.execute('SELECT VERSION() AS version')
      const version = String(versions[0]?.version || '')
      if (!/^\d+\./.test(version) || Number(version.split('.')[0]) < 8 || /mariadb/i.test(version)) {
        throw repositoryError('DATABASE_SCHEMA_INCOMPATIBLE')
      }
      const [columns] = await connection.execute(`SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?, ?)`, ['users', 'employees'])
      for (const [table, fields] of Object.entries(requiredColumns)) {
        for (const [name, type] of Object.entries(fields)) {
          const actual = columns.find(row => row.TABLE_NAME === table && row.COLUMN_NAME === name)
          if (!actual || String(actual.DATA_TYPE).toLowerCase() !== type || actual.IS_NULLABLE !== 'NO') {
            throw repositoryError('DATABASE_SCHEMA_INCOMPATIBLE')
          }
        }
      }
      const [indexes] = await connection.execute(`SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, COLUMN_NAME, SEQ_IN_INDEX
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?, ?)`, ['users', 'employees'])
      const uniqueColumn = (table, name, primary = false) => indexes.some(row =>
        row.TABLE_NAME === table && row.COLUMN_NAME === name && Number(row.NON_UNIQUE) === 0 &&
        Number(row.SEQ_IN_INDEX) === 1 && (!primary || row.INDEX_NAME === 'PRIMARY') &&
        indexes.filter(item => item.TABLE_NAME === table && item.INDEX_NAME === row.INDEX_NAME).length === 1)
      if (!uniqueColumn('users', 'id', true) || !uniqueColumn('employees', 'id', true) ||
          !uniqueColumn('users', 'phone') || !uniqueColumn('employees', 'user_id')) {
        throw repositoryError('DATABASE_SCHEMA_INCOMPATIBLE')
      }
      const [foreignKeys] = await connection.execute(`SELECT TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
        FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE()
        AND REFERENCED_TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, ['employees'])
      if (!foreignKeys.some(row => row.TABLE_NAME === 'employees' && row.COLUMN_NAME === 'user_id' &&
        row.REFERENCED_TABLE_NAME === 'users' && row.REFERENCED_COLUMN_NAME === 'id')) {
        throw repositoryError('DATABASE_SCHEMA_INCOMPATIBLE')
      }
      return true
    })
  }

  async findByPhone(phone) {
    return this.connection(async connection => {
      const [rows] = await connection.execute(`SELECT ${publicSelect}, u.password_hash AS passwordHash
        FROM users u LEFT JOIN employees e ON e.user_id = u.id WHERE u.phone = ? LIMIT 1`, [phone])
      return account(rows[0])
    })
  }

  async findById(id) {
    return this.connection(async connection => {
      const [rows] = await connection.execute(`SELECT ${publicSelect}
        FROM users u LEFT JOIN employees e ON e.user_id = u.id WHERE u.id = ? LIMIT 1`, [id])
      return account(rows[0])
    })
  }
}
