import { HttpError } from '../../shared/http.js';

const select = 'SELECT id, booking_id, employee_id, rating, comment, created_at FROM reviews';
function reviewDto(row, order) {
  const rating = Number(row.rating);
  const created = new Date(row.created_at);
  if (!order || row.created_at === null || row.created_at === undefined || !Number.isInteger(rating) || rating < 1 || rating > 5 || !Number.isFinite(created.getTime())) {
    throw new HttpError(503, 'INVALID_REVIEW_DATA', 'Dữ liệu đánh giá chưa hợp lệ.');
  }
  return {
    id: String(row.id), orderId: String(row.booking_id), customerId: String(order.customerId),
    staffId: String(row.employee_id), serviceId: String(order.serviceId), rating,
    comment: row.comment, createdAt: created.toISOString(),
  };
}

export function createRepository(pool) {
  return {
    async summarizeBookings(bookingIds) {
      if (!bookingIds.length) return { count: 0, ratingSum: 0 };
      const [rows] = await pool.execute(
        `SELECT COUNT(*) AS count, COALESCE(SUM(rating), 0) AS ratingSum, MIN(rating) AS minRating, MAX(rating) AS maxRating
         FROM reviews WHERE booking_id IN (${bookingIds.map(() => '?').join(',')})`, bookingIds,
      );
      const count = Number(rows[0]?.count), ratingSum = Number(rows[0]?.ratingSum);
      if (!Number.isSafeInteger(count) || count < 0 || !Number.isSafeInteger(ratingSum) || ratingSum < count || ratingSum > count * 5
        || (count > 0 && (Number(rows[0].minRating) < 1 || Number(rows[0].maxRating) > 5))) {
        throw new HttpError(503, 'INVALID_REVIEW_DATA', 'Chưa thể tổng hợp điểm đánh giá.');
      }
      return { count, ratingSum };
    },
    async list(orders, { page, limit }) {
      const byId = new Map(orders.map((order) => [String(order.id), order]));
      if (!byId.size) return { items: [], total: 0, page, limit };
      const ids = [...byId.keys()];
      const where = ` WHERE booking_id IN (${ids.map(() => '?').join(',')})`;
      const [count] = await pool.execute(`SELECT COUNT(*) AS total FROM reviews${where}`, ids);
      const [rows] = await pool.query(`${select}${where} ORDER BY id DESC LIMIT ? OFFSET ?`, [...ids, limit, (page - 1) * limit]);
      return { items: rows.map((row) => reviewDto(row, byId.get(String(row.booking_id)))), total: Number(count[0].total), page, limit };
    },
    async create(order, { rating, comment }) {
      if (order.status !== 'completed' || !order.staffId) throw new HttpError(422, 'REVIEW_NOT_ALLOWED', 'Đơn chưa đủ điều kiện đánh giá.');
      const connection = await pool.getConnection();
      let locked = false;
      let destroyed = false;
      // The schema's unique key is per employee. This service-owned advisory lock also
      // serializes a review for the same booking if its representative employee changes.
      // SHA2 keeps the database-qualified lock name within MySQL's 64-character limit.
      const lockName = "SHA2(CONCAT(DATABASE(), ':customer-review:', ?), 256)";
      try {
        const [locks] = await connection.execute(`SELECT GET_LOCK(${lockName}, 2) AS acquired`, [order.id]);
        if (Number(locks[0]?.acquired) !== 1) throw new HttpError(503, 'REVIEW_BUSY', 'Đánh giá đang được xử lý. Vui lòng tải lại danh sách trước khi thử lại.');
        locked = true;
        const [existing] = await connection.execute('SELECT id FROM reviews WHERE booking_id = ? LIMIT 1', [order.id]);
        if (existing.length) throw new HttpError(409, 'REVIEW_ALREADY_EXISTS', 'Đơn này đã được đánh giá.');
        const [result] = await connection.execute(
          'INSERT INTO reviews (booking_id, employee_id, rating, comment) VALUES (?, ?, ?, ?)',
          [order.id, order.staffId, rating, comment],
        );
        const [rows] = await connection.execute(`${select} WHERE id = ?`, [String(result.insertId)]);
        if (!rows[0]) throw new HttpError(503, 'REVIEW_NOT_READABLE', 'Đánh giá đã ghi nhưng chưa thể đọc lại. Vui lòng tải lại danh sách.');
        return reviewDto(rows[0], order);
      } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') throw new HttpError(409, 'REVIEW_ALREADY_EXISTS', 'Đơn này đã được đánh giá.');
        throw error;
      } finally {
        if (locked) {
          try {
            const [released] = await connection.execute(`SELECT RELEASE_LOCK(${lockName}) AS released`, [order.id]);
            if (Number(released[0]?.released) !== 1) throw new Error('review lock not released');
          } catch {
            // Closing the session releases its advisory lock; never return a locked
            // connection to the pool, including when the database connection fails.
            connection.destroy();
            destroyed = true;
          }
        }
        if (!destroyed) connection.release();
      }
    },
  };
}
