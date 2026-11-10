import { HttpError } from '../../shared/http.js';

function paymentDto(row, order) {
  const method = { CASH: 'cash', TRANSFER: 'transfer' }[row.method];
  const status = { PENDING: method === 'cash' ? 'unpaid' : 'pending', UNPAID: 'unpaid', PAID: 'paid' }[row.status];
  const amount = Number(row.amount);
  if (!method || !status || !Number.isFinite(amount) || amount < 0) {
    throw new HttpError(503, 'UNSUPPORTED_PAYMENT_DATA', 'Trạng thái hoặc dữ liệu thanh toán chưa được hỗ trợ.');
  }
  const confirmed = row.paid_at === null || row.paid_at === undefined ? undefined : new Date(row.paid_at);
  if (confirmed && !Number.isFinite(confirmed.getTime())) throw new HttpError(503, 'INVALID_PAYMENT_DATA', 'Thời điểm thanh toán chưa hợp lệ.');
  return {
    id: String(row.id), code: `TT${String(row.id).padStart(6, '0')}`, orderId: String(row.booking_id),
    amount, method, status, createdAt: null, simulated: String(row.provider_ref || '').startsWith('CUSTOMER_SIM_V1:'),
    ...(confirmed ? { confirmedAt: confirmed.toISOString() } : {}),
    ...(status === 'paid' && order?.status === 'cancelled' ? { refundRequired: true } : {}),
  };
}

const select = 'SELECT id, booking_id, amount, method, provider_ref, status, paid_at FROM payments';

export function createRepository(pool) {
  return {
    async list(orders, { page, limit }) {
      const byId = new Map(orders.map((order) => [String(order.id), order]));
      if (!byId.size) return { items: [], total: 0, page, limit };
      const ids = [...byId.keys()];
      const where = ` WHERE booking_id IN (${ids.map(() => '?').join(',')})`;
      const [count] = await pool.execute(`SELECT COUNT(*) AS total FROM payments${where}`, ids);
      const [rows] = await pool.query(`${select}${where} ORDER BY id DESC LIMIT ? OFFSET ?`, [...ids, limit, (page - 1) * limit]);
      return { items: rows.map((row) => paymentDto(row, byId.get(String(row.booking_id)))), total: Number(count[0].total), page, limit };
    },
    async simulate(order, method) {
      if (order.status === 'cancelled') throw new HttpError(422, 'ORDER_CANCELLED', 'Đơn đã hủy không thể mô phỏng thanh toán.');
      if (!Number.isFinite(order.price) || order.price < 0 || order.price > 9999999999.99) {
        throw new HttpError(503, 'INVALID_ORDER_AMOUNT', 'Tổng tiền đơn dịch vụ chưa hợp lệ.');
      }
      const reference = `CUSTOMER_SIM_V1:${order.id}`;
      const connection = await pool.getConnection();
      let transaction = false;
      try {
        await connection.beginTransaction();
        transaction = true;
        // The stable unique reference serializes concurrent simulations for this booking.
        // No confirmed payment is modified by this endpoint.
        await connection.execute(
          `INSERT INTO payments (booking_id, subscription_id, amount, method, provider_ref, status, paid_at)
           VALUES (?, NULL, ?, ?, ?, 'PENDING', NULL)
           ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
          [order.id, order.price.toFixed(2), method.toUpperCase(), reference],
        );
        const [rows] = await connection.execute(`${select} WHERE booking_id = ? ORDER BY id FOR UPDATE`, [order.id]);
        if (rows.some((row) => row.status === 'PAID')) {
          throw new HttpError(409, 'PAYMENT_ALREADY_PAID', 'Đơn đã được xác nhận thanh toán.');
        }
        if (rows.some((row) => row.provider_ref !== reference)) {
          throw new HttpError(409, 'PAYMENT_ALREADY_EXISTS', 'Đơn đã có giao dịch thanh toán khác; không thể thay thế bằng mô phỏng.');
        }
        const payment = rows.find((row) => row.provider_ref === reference);
        if (!payment || !['PENDING', 'UNPAID'].includes(payment.status)) {
          throw new HttpError(409, 'PAYMENT_STATE_CONFLICT', 'Trạng thái giao dịch không cho phép mô phỏng.');
        }
        await connection.execute("UPDATE payments SET amount = ?, method = ?, status = 'PENDING', paid_at = NULL WHERE id = ?",
          [order.price.toFixed(2), method.toUpperCase(), payment.id]);
        const saved = paymentDto({ ...payment, amount: order.price, method: method.toUpperCase(), status: 'PENDING', paid_at: null }, order);
        await connection.commit();
        transaction = false;
        return saved;
      } catch (error) {
        if (transaction) await connection.rollback().catch(() => {});
        throw error;
      } finally {
        connection.release();
      }
    },
  };
}
