import { createHash } from 'node:crypto'
import { OrderError } from './domain.js'

// Read-only projections: users, employees and assignments. This service writes
// only bookings and booking_status_history, as agreed with Staff Service.
const schema = {
  users: { id: 'bigint', role: 'varchar', status: 'varchar' },
  employees: { id: 'bigint', user_id: 'bigint', status: 'varchar' },
  bookings: { id: 'bigint', customer_id: 'bigint', status: 'varchar' },
  assignments: { id: 'bigint', booking_id: 'bigint', employee_id: 'bigint', status: 'varchar', check_in_at: 'timestamp', check_out_at: 'timestamp' },
  booking_status_history: { id: 'bigint', booking_id: 'bigint', changed_by: 'bigint', status: 'varchar', note: 'text', created_at: 'timestamp' },
}
const tables = Object.keys(schema)
const placeholders = values => values.map(() => '?').join(', ')
const unavailable = () => new OrderError(503, 'ORDER_UNAVAILABLE', 'Order Service chưa xử lý được dữ liệu MySQL; hãy thử lại cùng operationId.')
const incompatible = details => new OrderError(503, 'DATABASE_SCHEMA_INCOMPATIBLE', 'Schema MySQL chưa tương thích với Order Service.', details)
const conflict = () => new OrderError(409, 'STALE_ASSIGNMENT', 'Dữ liệu đơn hoặc phân công đã thay đổi; cần đối chiếu.')
const historySelect = `SELECT id, booking_id AS bookingId, changed_by AS changedBy,
  status, note, created_at AS createdAt FROM booking_status_history`
// CASE guards every JSON expression, including legacy notes that are plain text.
const jsonNote = "CASE WHEN JSON_VALID(note) THEN note ELSE '{}' END"
const journalMarker = `JSON_UNQUOTE(JSON_EXTRACT(${jsonNote}, '$.kind')) = 'cleanhome.staff-transition'`
const pendingPredicate = `${journalMarker}
  AND JSON_EXTRACT(${jsonNote}, '$.version') = CAST('1' AS JSON)
  AND JSON_EXTRACT(${jsonNote}, '$.staffAcknowledged') = CAST('false' AS JSON)`

const historyRow = row => ({ ...row, id: String(row.id), bookingId: String(row.bookingId), changedBy: String(row.changedBy) })
const assignmentRow = row => ({ ...row, id: String(row.id), bookingId: String(row.bookingId), employeeId: String(row.employeeId), actorUserId: String(row.actorUserId) })
function timestamp(value) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) throw new OrderError(500, 'INVALID_JOURNAL', 'Không thể lưu thời điểm của operation.')
  return date.toISOString().slice(0, 19).replace('T', ' ')
}
function encoded(metadata) {
  const note = JSON.stringify(metadata)
  if (typeof note !== 'string' || Buffer.byteLength(note, 'utf8') > 65535) throw new OrderError(500, 'INVALID_JOURNAL', 'Operation vượt giới hạn lưu trữ journal.')
  return note
}

export class MysqlOrderRepository {
  constructor(pool) { this.pool = pool; this.pendingCursor = '0' }

  async connection(callback) {
    let connection, discarded = false
    try {
      connection = await this.pool.getConnection()
      await connection.query("SET SESSION time_zone = '+00:00'")
      return await callback(connection, () => { discarded = true; connection.destroy() })
    } catch (error) {
      if (error instanceof OrderError) throw error
      throw unavailable()
    } finally { if (connection && !discarded) connection.release() }
  }

  async health() {
    return this.connection(async connection => { await connection.execute('SELECT 1'); return true })
  }

  async assertSchema() {
    return this.connection(async connection => {
      const [versions] = await connection.execute('SELECT VERSION() AS version')
      const version = String(versions[0]?.version || '')
      if (!/^\d+\./.test(version) || Number(version.split('.')[0]) < 8 || /mariadb/i.test(version)) throw incompatible({ reason: 'MYSQL_8_REQUIRED' })
      const [columns] = await connection.execute(`SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE
        FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${placeholders(tables)})`, tables)
      const columnMap = new Map(columns.map(row => [`${row.TABLE_NAME}.${row.COLUMN_NAME}`, row]))
      const missing = [], invalid = []
      for (const [table, fields] of Object.entries(schema)) {
        for (const [column, type] of Object.entries(fields)) {
          const name = `${table}.${column}`, actual = columnMap.get(name)
          if (!actual) missing.push(name)
          else if (String(actual.DATA_TYPE).toLowerCase() !== type || (type === 'bigint' && /unsigned/i.test(actual.COLUMN_TYPE))) invalid.push(name)
        }
      }
      for (const column of ['check_in_at', 'check_out_at']) {
        if (columnMap.get(`assignments.${column}`)?.IS_NULLABLE !== 'YES') invalid.push(`assignments.${column}.nullable`)
      }
      const [engines] = await connection.execute(`SELECT TABLE_NAME, ENGINE FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${placeholders(tables)})`, tables)
      for (const table of tables) if (engines.find(row => row.TABLE_NAME === table)?.ENGINE !== 'InnoDB') invalid.push(`${table}.engine`)
      const [indexes] = await connection.execute(`SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, COLUMN_NAME, SEQ_IN_INDEX
        FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${placeholders(tables)})`, tables)
      const indexed = (table, column, unique = false) => indexes.some(row => row.TABLE_NAME === table && row.COLUMN_NAME === column && Number(row.SEQ_IN_INDEX) === 1
        && (!unique || (Number(row.NON_UNIQUE) === 0 && indexes.filter(other => other.TABLE_NAME === table && other.INDEX_NAME === row.INDEX_NAME).length === 1)))
      for (const table of tables) if (!indexed(table, 'id', true) || !indexes.some(row => row.TABLE_NAME === table && row.INDEX_NAME === 'PRIMARY' && row.COLUMN_NAME === 'id')) invalid.push(`${table}.primary`)
      for (const [table, column, unique] of [['employees', 'user_id', true], ['assignments', 'booking_id', false], ['assignments', 'employee_id', false], ['booking_status_history', 'booking_id', false]]) {
        if (!indexed(table, column, unique)) invalid.push(`${table}.${column}.index`)
      }
      const [keys] = await connection.execute(`SELECT TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
        FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE()
        AND REFERENCED_TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${placeholders(tables)})`, tables)
      for (const [table, column, target] of [['employees', 'user_id', 'users'], ['assignments', 'employee_id', 'employees'], ['assignments', 'booking_id', 'bookings'], ['bookings', 'customer_id', 'users'], ['booking_status_history', 'booking_id', 'bookings'], ['booking_status_history', 'changed_by', 'users']]) {
        if (!keys.some(row => row.TABLE_NAME === table && row.COLUMN_NAME === column && row.REFERENCED_TABLE_NAME === target && row.REFERENCED_COLUMN_NAME === 'id')) invalid.push(`${table}.${column}.foreignKey`)
      }
      if (missing.length || invalid.length) throw incompatible({ missing, incompatible: invalid })
      return true
    })
  }

  async transactOperation(operation, callback) {
    return this.connection(async (connection, discard) => {
      // MySQL advisory lock names have a 64-character limit. Hash the namespace
      // together with operationId to serialize reuse across different bookings.
      const lockName = createHash('sha256').update('cleanhome-order\0' + operation.id).digest('hex')
      let locked = false, lockResolved = false, began = false, destroy = false
      try {
        const [locks] = await connection.execute('SELECT GET_LOCK(?, 1) AS acquired', [lockName])
        lockResolved = true
        if (Number(locks[0]?.acquired) !== 1) throw unavailable()
        locked = true
        await connection.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED')
        await connection.query('SET SESSION innodb_lock_wait_timeout = 2')
        await connection.beginTransaction(); began = true
        // Staff holds its assignment row while waiting for this REST response.
        // Lock only the Order-owned booking; never FOR UPDATE its assignments.
        const [bookings] = await connection.execute('SELECT id, status FROM bookings WHERE id = ? FOR UPDATE', [operation.bookingId])
        const booking = bookings[0] ? { ...bookings[0], id: String(bookings[0].id) } : null
        const [assignments] = await connection.execute(`SELECT a.id, a.booking_id AS bookingId, a.employee_id AS employeeId,
          e.user_id AS actorUserId, u.role AS userRole, u.status AS userStatus, e.status AS employeeStatus,
          a.status, a.check_in_at AS checkInAt, a.check_out_at AS checkOutAt FROM assignments a
          JOIN employees e ON e.id = a.employee_id JOIN users u ON u.id = e.user_id
          WHERE a.booking_id = ? ORDER BY a.id`, [operation.bookingId])
        const [historyRows] = await connection.execute(`${historySelect} WHERE booking_id = ? ORDER BY id`, [operation.bookingId])
        const [matchingHistoryRows] = await connection.execute(`${historySelect} WHERE ${journalMarker}
          AND CAST(JSON_UNQUOTE(JSON_EXTRACT(${jsonNote}, '$.operation.id')) AS BINARY) = CAST(? AS BINARY) ORDER BY id`, [operation.id])
        const tx = {
          booking,
          assignments: assignments.map(assignmentRow),
          historyRows: historyRows.map(historyRow),
          matchingHistoryRows: matchingHistoryRows.map(historyRow),
          setBookingStatus: async status => {
            if (!booking) throw new OrderError(404, 'BOOKING_NOT_FOUND', 'Không tìm thấy đơn dịch vụ.')
            if (!['PENDING', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'].includes(status)) throw new OrderError(500, 'INVALID_JOURNAL', 'Trạng thái đơn không hợp lệ.')
            if (booking.status === status) return
            const [result] = await connection.execute('UPDATE bookings SET status = ? WHERE id = ? AND status = ?', [status, booking.id, booking.status])
            if (result.affectedRows !== 1) throw conflict()
            booking.status = status
          },
          insertHistory: async metadata => {
            const note = encoded(metadata)
            const [result] = await connection.execute(`INSERT INTO booking_status_history (booking_id, changed_by, status, note, created_at)
              VALUES (?, ?, ?, ?, ?)`, [operation.bookingId, operation.actorUserId, metadata.ack.booking.status, note, timestamp(metadata.ack.occurredAt)])
            return String(result.insertId)
          },
          acknowledgeHistory: async (historyId, metadata) => {
            const note = encoded(metadata)
            const [result] = await connection.execute(`UPDATE booking_status_history SET note = ? WHERE id = ? AND booking_id = ? AND ${journalMarker}`, [note, historyId, operation.bookingId])
            if (result.affectedRows !== 1) throw conflict()
          },
        }
        const result = await callback(tx)
        await connection.commit(); began = false
        return result
      } catch (error) {
        if (began) {
          try { await connection.rollback() } catch { destroy = true }
        }
        throw error
      } finally {
        if (locked && !destroy) {
          try {
            const [released] = await connection.execute('SELECT RELEASE_LOCK(?) AS released', [lockName])
            if (Number(released[0]?.released) !== 1) destroy = true
          } catch { destroy = true }
        }
        // A connection with an uncertain advisory lock must never re-enter pool.
        if (destroy || !lockResolved) discard()
      }
    })
  }

  async listPendingRows(limit = 20) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new OrderError(400, 'INVALID_LIMIT', 'limit phải nằm trong khoảng 1–100.')
    return this.connection(async connection => {
      const cursor = this.pendingCursor
      const [first] = await connection.query(`${historySelect} WHERE ${pendingPredicate} AND id > ? ORDER BY id LIMIT ?`, [cursor, limit])
      let rows = first
      if (rows.length < limit && cursor !== '0') {
        const [wrapped] = await connection.query(`${historySelect} WHERE ${pendingPredicate} AND id <= ? ORDER BY id LIMIT ?`, [cursor, limit - rows.length])
        rows = [...rows, ...wrapped]
      }
      // Cycling through history IDs avoids permanently starving later pending
      // operations when an early one cannot be reconciled. Restart resets cursor.
      if (rows.length) this.pendingCursor = String(rows.at(-1).id)
      return rows.map(historyRow)
    })
  }
}
