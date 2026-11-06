import { HttpError } from './errors.js'

const columns = `id, booking_id AS bookingId, content, read_at AS readAt, created_at AS createdAt`
const unavailable = () => new HttpError(503, 'DATABASE_UNAVAILABLE', 'Chưa kết nối hoặc xử lý được dữ liệu MySQL.')

/**
 * Notifications are the only Staff-owned table this repository writes.
 * Every statement is scoped by user_id from the verified token, never by request input.
 */
export class MysqlNotificationRepository {
  constructor(pool) { this.pool = pool }

  async connection(callback) {
    let connection
    try {
      connection = await this.pool.getConnection()
      await connection.query("SET SESSION time_zone = '+00:00'")
      return await callback(connection)
    } catch (error) {
      if (error instanceof HttpError) throw error
      throw unavailable()
    } finally { connection?.release() }
  }

  async listForUser(userId, { page, pageSize, unreadOnly }) {
    const filter = unreadOnly ? 'user_id = ? AND read_at IS NULL' : 'user_id = ?'
    return this.connection(async connection => {
      const [counts] = await connection.execute(`SELECT COUNT(*) AS total FROM notifications WHERE ${filter}`, [userId])
      const [unread] = await connection.execute('SELECT COUNT(*) AS unread FROM notifications WHERE user_id = ? AND read_at IS NULL', [userId])
      const [rows] = await connection.query(`SELECT ${columns} FROM notifications WHERE ${filter}
        ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`, [userId, pageSize, (page - 1) * pageSize])
      return { items: rows, total: Number(counts[0].total), unreadCount: Number(unread[0].unread) }
    })
  }

  async countUnread(userId) {
    return this.connection(async connection => {
      const [rows] = await connection.execute('SELECT COUNT(*) AS unread FROM notifications WHERE user_id = ? AND read_at IS NULL', [userId])
      return Number(rows[0].unread)
    })
  }

  async findOne(userId, notificationId) {
    return this.connection(async connection => {
      const [rows] = await connection.execute(`SELECT ${columns} FROM notifications WHERE user_id = ? AND id = ? LIMIT 1`, [userId, notificationId])
      return rows[0] || null
    })
  }

  /** Idempotent: an already-read row keeps its original read_at timestamp. */
  async markRead(userId, notificationId) {
    return this.connection(async connection => {
      const [owned] = await connection.execute('SELECT id FROM notifications WHERE user_id = ? AND id = ? LIMIT 1', [userId, notificationId])
      if (!owned.length) return null
      await connection.execute('UPDATE notifications SET read_at = COALESCE(read_at, UTC_TIMESTAMP()) WHERE user_id = ? AND id = ?', [userId, notificationId])
      const [rows] = await connection.execute(`SELECT ${columns} FROM notifications WHERE user_id = ? AND id = ? LIMIT 1`, [userId, notificationId])
      const [unread] = await connection.execute('SELECT COUNT(*) AS unread FROM notifications WHERE user_id = ? AND read_at IS NULL', [userId])
      return { item: rows[0] || null, unreadCount: Number(unread[0].unread) }
    })
  }

  async markAllRead(userId) {
    return this.connection(async connection => {
      const [result] = await connection.execute('UPDATE notifications SET read_at = COALESCE(read_at, UTC_TIMESTAMP()) WHERE user_id = ? AND read_at IS NULL', [userId])
      return { updated: Number(result.affectedRows || 0), unreadCount: 0 }
    })
  }
}
