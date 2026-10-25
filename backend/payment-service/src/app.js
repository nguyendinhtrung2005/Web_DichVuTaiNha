require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") })
const { z } = require("zod")
const { getPool, inTransaction } = require("../../shared/db")
const { HttpError, createApp, finishApp, asyncRoute } = require("../../shared/http")
const { requireAuth, requireRole } = require("../../shared/auth")
const { PAYMENT_METHOD_TO_DB } = require("../../shared/constants")
const { parse, numericId } = require("../../shared/validation")

const app = createApp()
const createPaymentSchema = z.object({ method: z.enum(["cash", "transfer"]) })
const pageSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(["unpaid", "pending", "paid"]).optional(),
})

app.post("/orders/:id/payment", requireAuth, requireRole("customer"), asyncRoute(async (request, response) => {
  const bookingId = numericId(request.params.id, "Mã đơn")
  const input = parse(createPaymentSchema, request.body)
  const payment = await inTransaction(async (connection) => {
    const [bookings] = await connection.execute(
      "SELECT id, customer_id, status, total_amount FROM bookings WHERE id = ? FOR UPDATE",
      [bookingId],
    )
    const booking = bookings[0]
    if (!booking || Number(booking.customer_id) !== request.actor.id) throw new HttpError(404, "ORDER_NOT_FOUND", "Không tìm thấy đơn dịch vụ.")
    if (booking.status === "CANCELLED") throw new HttpError(409, "ORDER_CANCELLED", "Đơn đã hủy, không thể cập nhật thanh toán.")
    const [existingRows] = await connection.execute("SELECT * FROM payments WHERE booking_id = ? FOR UPDATE", [bookingId])
    const existing = existingRows[0]
    if (existing?.status === "PAID") throw new HttpError(409, "PAYMENT_ALREADY_CONFIRMED", "Khoản thanh toán đã được xác nhận.")
    const method = PAYMENT_METHOD_TO_DB[input.method]
    const status = input.method === "transfer" ? "PENDING" : "UNPAID"
    let paymentId
    if (existing) {
      paymentId = existing.id
      await connection.execute(
        "UPDATE payments SET method = ?, amount = ?, status = ?, paid_at = NULL, confirmed_by = NULL WHERE id = ?",
        [method, booking.total_amount, status, paymentId],
      )
    } else {
      const [result] = await connection.execute(
        "INSERT INTO payments (booking_id, amount, method, status, created_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)",
        [bookingId, booking.total_amount, method, status],
      )
      paymentId = result.insertId
      await connection.execute("UPDATE payments SET payment_code = ? WHERE id = ?", [`TT${String(paymentId).padStart(8, "0")}`, paymentId])
    }
    await connection.execute(
      "INSERT INTO payment_status_history (payment_id, changed_by, previous_status, new_status, note) VALUES (?, ?, ?, ?, ?)",
      [paymentId, request.actor.id, existing?.status || null, status, `Khách chọn phương thức ${input.method}. Chưa xác nhận đã nhận tiền.`],
    )
    const [rows] = await connection.execute("SELECT * FROM payments WHERE id = ?", [paymentId])
    return toPayment(rows[0])
  })
  response.status(200).json({ payment })
}))

app.get("/orders/:id/payment", requireAuth, asyncRoute(async (request, response) => {
  const bookingId = numericId(request.params.id, "Mã đơn")
  const [bookings] = await getPool().execute("SELECT id, customer_id FROM bookings WHERE id = ?", [bookingId])
  const booking = bookings[0]
  if (!booking || (request.actor.role === "customer" && Number(booking.customer_id) !== request.actor.id)) {
    throw new HttpError(404, "ORDER_NOT_FOUND", "Không tìm thấy đơn dịch vụ.")
  }
  if (request.actor.role === "staff") {
    const [assigned] = await getPool().execute(
      "SELECT 1 FROM assignments a JOIN employees e ON e.id = a.employee_id WHERE a.booking_id = ? AND e.user_id = ? LIMIT 1",
      [bookingId, request.actor.id],
    )
    if (!assigned.length) throw new HttpError(404, "ORDER_NOT_FOUND", "Không tìm thấy đơn dịch vụ.")
  }
  const [rows] = await getPool().execute("SELECT * FROM payments WHERE booking_id = ? LIMIT 1", [bookingId])
  response.json({ payment: rows[0] ? toPayment(rows[0]) : null })
}))

app.get("/payments", requireAuth, requireRole("admin"), asyncRoute(async (request, response) => {
  const query = parse(pageSchema, request.query)
  const conditions = ["p.booking_id IS NOT NULL"]
  const values = []
  if (query.status) {
    conditions.push("p.status = ?")
    values.push(query.status.toUpperCase())
  }
  const [countRows] = await getPool().execute(
    `SELECT COUNT(*) AS total FROM payments p WHERE ${conditions.join(" AND ")}`,
    values,
  )
  const [rows] = await getPool().execute(
    `SELECT p.* FROM payments p WHERE ${conditions.join(" AND ")} ORDER BY p.created_at DESC LIMIT ? OFFSET ?`,
    [...values, query.pageSize, (query.page - 1) * query.pageSize],
  )
  response.json({ payments: rows.map(toPayment), page: query.page, pageSize: query.pageSize, total: Number(countRows[0].total) })
}))

app.post("/payments/:id/confirm", requireAuth, requireRole("admin"), asyncRoute(async (request, response) => {
  const paymentId = numericId(request.params.id, "Mã thanh toán")
  const payment = await inTransaction(async (connection) => {
    const [rows] = await connection.execute(
      "SELECT p.*, b.status AS booking_status, b.total_amount FROM payments p JOIN bookings b ON b.id = p.booking_id WHERE p.id = ? FOR UPDATE",
      [paymentId],
    )
    const current = rows[0]
    if (
      !current ||
      current.booking_status === "CANCELLED" ||
      !["PENDING", "UNPAID"].includes(current.status) ||
      !["CASH", "TRANSFER"].includes(current.method) ||
      !Number.isFinite(Number(current.amount)) ||
      Number(current.amount) < 0 ||
      Number(current.amount) !== Number(current.total_amount)
    ) {
      throw new HttpError(409, "PAYMENT_NOT_CONFIRMABLE", "Bản ghi thanh toán không còn đủ điều kiện xác nhận.")
    }
    await connection.execute(
      "UPDATE payments SET status = 'PAID', paid_at = CURRENT_TIMESTAMP, confirmed_by = ? WHERE id = ?",
      [request.actor.id, paymentId],
    )
    await connection.execute(
      "INSERT INTO payment_status_history (payment_id, changed_by, previous_status, new_status, note) VALUES (?, ?, ?, 'PAID', 'Admin ghi nhận đã nhận tiền; không xác minh giao dịch ngân hàng.')",
      [paymentId, request.actor.id, current.status],
    )
    const [updatedRows] = await connection.execute("SELECT * FROM payments WHERE id = ?", [paymentId])
    return toPayment(updatedRows[0])
  })
  response.json({ payment })
}))

app.get("/payments/:id/history", requireAuth, requireRole("admin"), asyncRoute(async (request, response) => {
  const paymentId = numericId(request.params.id, "Mã thanh toán")
  const [rows] = await getPool().execute(
    "SELECT h.id, h.previous_status, h.new_status, h.note, h.created_at, u.full_name AS changed_by_name FROM payment_status_history h JOIN users u ON u.id = h.changed_by WHERE h.payment_id = ? ORDER BY h.created_at, h.id",
    [paymentId],
  )
  response.json({ history: rows.map((row) => ({ id: String(row.id), previousStatus: row.previous_status?.toLowerCase() || null, status: row.new_status.toLowerCase(), note: row.note, changedBy: row.changed_by_name, at: new Date(row.created_at).toISOString() })) })
}))

function toPayment(row) {
  return {
    id: String(row.id),
    code: row.payment_code || `TT${String(row.id).padStart(8, "0")}`,
    orderId: String(row.booking_id),
    amount: Number(row.amount),
    method: row.method === "CASH" ? "cash" : "transfer",
    status: row.status.toLowerCase(),
    createdAt: new Date(row.created_at).toISOString(),
    ...(row.paid_at ? { confirmedAt: new Date(row.paid_at).toISOString() } : {}),
    ...(row.refund_required ? { refundRequired: true } : {}),
  }
}

finishApp(app)

const port = Number(process.env.PAYMENT_SERVICE_PORT || 4103)
if (require.main === module) app.listen(port, process.env.SERVICE_HOST || "127.0.0.1", () => console.log(`CleanHome payment service listening on ${port}`))
module.exports = { app, toPayment }
