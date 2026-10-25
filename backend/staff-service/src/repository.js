import { HttpError } from './errors.js'

// All names below come from databases/schema.sql supplied by the project owner.
// Cross-service tables are READ ONLY here. Only assignments is ever updated.
const schema = {
  users: { id: 'bigint', full_name: 'varchar', phone: 'varchar', role: 'varchar', status: 'varchar' },
  employees: { id: 'bigint', user_id: 'bigint', status: 'varchar' },
  employee_availability: { id: 'bigint', employee_id: 'bigint', starts_at: 'timestamp', ends_at: 'timestamp', status: 'varchar' },
  assignments: { id: 'bigint', booking_id: 'bigint', employee_id: 'bigint', assigned_at: 'timestamp', check_in_at: 'timestamp', check_out_at: 'timestamp', status: 'varchar' },
  bookings: { id: 'bigint', customer_id: 'bigint', scheduled_start: 'timestamp', scheduled_end: 'timestamp', address_snapshot: 'json', status: 'varchar' },
  booking_items: { id: 'bigint', booking_id: 'bigint', service_id: 'bigint', service_name_snapshot: 'varchar', quantity: 'decimal', unit_price: 'decimal', unit_snapshot: 'varchar' },
  services: { id: 'bigint', name: 'varchar', unit: 'varchar' },
  booking_status_history: { id: 'bigint', booking_id: 'bigint', changed_by: 'bigint', status: 'varchar', note: 'text', created_at: 'timestamp' },
}
const tables = Object.keys(schema)
const placeholders = values => values.map(() => '?').join(', ')
const notFound = () => new HttpError(404, 'JOB_NOT_FOUND', 'Không tìm thấy công việc được phân công cho bạn.')
const schemaError = details => new HttpError(503, 'DATABASE_SCHEMA_INCOMPATIBLE', 'Schema MySQL chưa tương thích với Staff Service; cần kiểm tra schema nguồn.', details)
const nextStep = { ASSIGNED: 'ACCEPTED', ACCEPTED: 'IN_PROGRESS', IN_PROGRESS: 'DONE' }

const jobSelect = `SELECT
  a.id, a.booking_id AS bookingId, a.employee_id AS employeeId,
  a.status, a.assigned_at AS assignedAt, a.check_in_at AS checkInAt,
  a.check_out_at AS checkOutAt, b.status AS bookingStatus,
  b.scheduled_start AS scheduledStart, b.scheduled_end AS scheduledEnd,
  b.address_snapshot AS addressSnapshot, u.full_name AS customerName,
  u.phone AS customerPhone
FROM assignments a
JOIN bookings b ON b.id = a.booking_id
JOIN users u ON u.id = b.customer_id`

function job(row) {
  return row ? { ...row, id: String(row.id), bookingId: String(row.bookingId), employeeId: String(row.employeeId) } : null
}

function utcParameter(value) {
  const text = String(value).replace(' ', 'T')
  const date = value instanceof Date ? value : new Date(/[zZ]$|[+-]\d\d:\d\d$/.test(text) ? text : text + 'Z')
  if (!Number.isFinite(date.getTime())) throw new HttpError(400, 'INVALID_TIME', 'Thời gian cập nhật không hợp lệ.')
  // Original TIMESTAMP columns have second precision, so the DB acknowledgement
  // and any replay are intentionally represented at the precision they store.
  return date.toISOString().slice(0, 19).replace('T', ' ')
}

export class MysqlStaffRepository {
  constructor(pool) { this.pool = pool }

  async connection(callback) {
    let connection
    try {
      connection = await this.pool.getConnection()
      // mysql2 timezone controls JavaScript conversion, not MySQL TIMESTAMP.
      // Configure the session on every checkout, including pooled connections.
      await connection.query("SET SESSION time_zone = '+00:00'")
      return await callback(connection)
    } catch (error) {
      if (error instanceof HttpError) throw error
      throw new HttpError(503, 'DATABASE_UNAVAILABLE', 'Chưa kết nối hoặc xử lý được dữ liệu MySQL.')
    } finally { connection?.release() }
  }

  async health() {
    return this.connection(async connection => { await connection.execute('SELECT 1'); return true })
  }

  async assertSchema() {
    try {
      return await this.connection(async connection => {
        const [versions] = await connection.execute('SELECT VERSION() AS version')
        const version = String(versions[0]?.version || '')
        if (!/^\d+\./.test(version) || Number(version.split('.')[0]) < 8 || /mariadb/i.test(version)) throw schemaError({ reason: 'MYSQL_8_REQUIRED' })
        const [columns] = await connection.execute(`SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT
          FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${placeholders(tables)})`, tables)
        const columnMap = new Map(columns.map(row => [`${row.TABLE_NAME}.${row.COLUMN_NAME}`, row]))
        const missing = [], incompatible = []
        for (const [table, fields] of Object.entries(schema)) {
          for (const [column, type] of Object.entries(fields)) {
            const name = `${table}.${column}`, actual = columnMap.get(name)
            if (!actual) missing.push(name)
            else if (actual.DATA_TYPE.toLowerCase() !== type) incompatible.push(name)
          }
        }
        const assignmentStatus = columnMap.get('assignments.status')
        if (assignmentStatus && assignmentStatus.COLUMN_DEFAULT !== 'ASSIGNED') incompatible.push('assignments.status.default')
        for (const column of ['check_in_at', 'check_out_at']) {
          if (columnMap.get(`assignments.${column}`)?.IS_NULLABLE !== 'YES') incompatible.push(`assignments.${column}.nullable`)
        }
        const [engines] = await connection.execute(`SELECT TABLE_NAME, ENGINE FROM information_schema.TABLES
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${placeholders(tables)})`, tables)
        for (const table of tables) {
          if (engines.find(row => row.TABLE_NAME === table)?.ENGINE !== 'InnoDB') incompatible.push(`${table}.engine`)
        }
        const [indexes] = await connection.execute(`SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, COLUMN_NAME, SEQ_IN_INDEX
          FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${placeholders(tables)})`, tables)
        const indexed = (table, column, unique = false) => indexes.some(row => row.TABLE_NAME === table && row.COLUMN_NAME === column && Number(row.SEQ_IN_INDEX) === 1 && (!unique || Number(row.NON_UNIQUE) === 0 && indexes.filter(other => other.TABLE_NAME === table && other.INDEX_NAME === row.INDEX_NAME).length === 1))
        for (const [table, column, unique] of [['employees', 'user_id', true], ['assignments', 'employee_id', false], ['assignments', 'booking_id', false], ['booking_items', 'booking_id', false]]) {
          if (!indexed(table, column, unique)) incompatible.push(`${table}.${column}.index`)
        }
        for (const table of tables) {
          if (!indexes.some(row => row.TABLE_NAME === table && row.INDEX_NAME === 'PRIMARY' && row.COLUMN_NAME === 'id')) incompatible.push(`${table}.primary`)
        }
        const [foreignKeys] = await connection.execute(`SELECT TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
          FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE()
          AND REFERENCED_TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${placeholders(tables)})`, tables)
        for (const [table, column, target] of [['employees', 'user_id', 'users'], ['assignments', 'employee_id', 'employees'], ['assignments', 'booking_id', 'bookings'], ['bookings', 'customer_id', 'users'], ['booking_items', 'booking_id', 'bookings'], ['booking_items', 'service_id', 'services']]) {
          if (!foreignKeys.some(row => row.TABLE_NAME === table && row.COLUMN_NAME === column && row.REFERENCED_TABLE_NAME === target && row.REFERENCED_COLUMN_NAME === 'id')) incompatible.push(`${table}.${column}.foreignKey`)
        }
        if (missing.length || incompatible.length) throw schemaError({ missing, incompatible })
        return true
      })
    } catch (error) {
      if (error instanceof HttpError) throw error
      throw new HttpError(503, 'DATABASE_UNAVAILABLE', 'Chưa kết nối hoặc đọc được schema MySQL.')
    }
  }

  async findEmployeeByUserId(userId) {
    return this.connection(async connection => {
      const [rows] = await connection.execute(`SELECT e.id, e.user_id AS userId, e.status,
        u.status AS userStatus, u.role AS userRole FROM employees e
        JOIN users u ON u.id = e.user_id WHERE e.user_id = ? LIMIT 1`, [userId])
      const row = rows[0]
      return row ? { ...row, id: String(row.id), userId: String(row.userId) } : null
    })
  }

  async findJobs(employeeId, { status, page = 1, pageSize = 20, sort = 'asc', fromUtc, toUtc }) {
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100 || !['asc', 'desc'].includes(sort)) {
      throw new HttpError(400, 'INVALID_PAGINATION', 'Phân trang hoặc sắp xếp không hợp lệ.')
    }
    const where = ['a.employee_id = ?'], values = [employeeId]
    if (status) { where.push('a.status = ?'); values.push(status) }
    if (fromUtc || toUtc) {
      if (!fromUtc || !toUtc) throw new HttpError(400, 'INVALID_RANGE', 'Cần đủ thời điểm bắt đầu và kết thúc.')
      where.push('b.scheduled_start < ? AND b.scheduled_end > ?'); values.push(toUtc, fromUtc)
    }
    return this.connection(async connection => {
      const clause = where.join(' AND ')
      // No booking_items join: a booking with multiple services still counts as
      // exactly one assignment. Service snapshots are loaded separately in bulk.
      const [counts] = await connection.execute(`SELECT COUNT(*) AS total FROM assignments a
        JOIN bookings b ON b.id = a.booking_id WHERE ${clause}`, values)
      // Text-protocol bindings keep LIMIT integers compatible across mysql2 /
      // MySQL versions; query() escapes every binding, including search filters.
      const [rows] = await connection.query(`${jobSelect} WHERE ${clause}
        ORDER BY b.scheduled_start ${sort.toUpperCase()}, a.id ${sort.toUpperCase()} LIMIT ? OFFSET ?`, [...values, pageSize, (page - 1) * pageSize])
      return { items: rows.map(job), total: Number(counts[0].total) }
    })
  }

  async findJob(employeeId, assignmentId) {
    return this.connection(async connection => {
      const [rows] = await connection.execute(`${jobSelect} WHERE a.employee_id = ? AND a.id = ? LIMIT 1`, [employeeId, assignmentId])
      return job(rows[0])
    })
  }

  async getBookingItems(bookingIds) {
    const ids = [...new Set(bookingIds.map(String))]
    if (!ids.length) return new Map()
    return this.connection(async connection => {
      const [rows] = await connection.execute(`SELECT booking_id AS bookingId, service_id AS serviceId,
        service_name_snapshot AS serviceName, unit_snapshot AS unit, quantity, unit_price AS unitPrice
        FROM booking_items WHERE booking_id IN (${placeholders(ids)}) ORDER BY booking_id, id`, ids)
      const result = new Map(ids.map(id => [id, []]))
      for (const row of rows) {
        result.get(String(row.bookingId))?.push({ serviceId: String(row.serviceId), serviceName: row.serviceName, unit: row.unit, quantity: String(row.quantity), unitPrice: String(row.unitPrice) })
      }
      return result
    })
  }

  async withLockedAssignment(employeeId, assignmentId, callback) {
    return this.connection(async connection => {
      await connection.beginTransaction()
      try {
        // Do not join bookings in this locking statement: Order Service may need
        // that booking row while processing its REST command in the callback.
        const [locked] = await connection.execute('SELECT id, status FROM assignments WHERE employee_id = ? AND id = ? FOR UPDATE', [employeeId, assignmentId])
        if (!locked.length) throw notFound()
        const [rows] = await connection.execute(`${jobSelect} WHERE a.employee_id = ? AND a.id = ? LIMIT 1`, [employeeId, assignmentId])
        let current = job(rows[0])
        if (!current) throw notFound()
        // The lock is the authoritative latest assignment state under InnoDB.
        current.status = locked[0].status
        const result = await callback({
          assignment: { ...current },
          updateStatus: async (status, occurredAt) => {
            if (nextStep[current.status] !== status) throw new HttpError(409, 'INVALID_TRANSITION', 'Không được bỏ bước hoặc cập nhật công việc đã hoàn thành/hủy.')
            const time = utcParameter(occurredAt)
            const [updated] = await connection.execute(`UPDATE assignments SET status = ?,
              check_in_at = CASE WHEN ? = 'IN_PROGRESS' THEN ? ELSE check_in_at END,
              check_out_at = CASE WHEN ? = 'DONE' THEN ? ELSE check_out_at END
              WHERE employee_id = ? AND id = ? AND status = ?`, [status, status, time, status, time, employeeId, assignmentId, current.status])
            if (updated.affectedRows !== 1) throw new HttpError(409, 'ASSIGNMENT_CHANGED', 'Phân công đã thay đổi; cần tải lại công việc.')
            current = { ...current, status, ...(status === 'IN_PROGRESS' ? { checkInAt: time } : {}), ...(status === 'DONE' ? { checkOutAt: time } : {}) }
            return { ...current }
          },
        })
        await connection.commit()
        return result
      } catch (error) {
        try { await connection.rollback() } catch { /* Preserve the original failure. */ }
        throw error
      }
    })
  }
}
