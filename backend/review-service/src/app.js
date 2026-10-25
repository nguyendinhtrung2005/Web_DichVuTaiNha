require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") })
const { z } = require("zod")
const { getPool, inTransaction } = require("../../shared/db")
const { HttpError, createApp, finishApp, asyncRoute } = require("../../shared/http")
const { requireAuth, requireRole } = require("../../shared/auth")
const { parse, numericId } = require("../../shared/validation")

const app = createApp()
const reviewSchema = z.object({
  serviceRating: z.number().int().min(1).max(5),
  staffRating: z.number().int().min(1).max(5).optional(),
  comment: z.string().trim().min(1).max(2000),
})
const visibilitySchema = z.object({
  hidden: z.boolean(),
  reason: z.string().trim().max(2000).optional(),
})
const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

app.post("/orders/:id/review", requireAuth, requireRole("customer"), asyncRoute(async (request, response) => {
  const bookingId = numericId(request.params.id, "Mã đơn")
  const input = parse(reviewSchema, request.body)
  const review = await inTransaction(async (connection) => {
    const [bookings] = await connection.execute(
      "SELECT b.id, b.customer_id, b.status, bi.service_id FROM bookings b JOIN booking_items bi ON bi.booking_id = b.id WHERE b.id = ? FOR UPDATE",
      [bookingId],
    )
    const booking = bookings[0]
    if (!booking || Number(booking.customer_id) !== request.actor.id) throw new HttpError(404, "ORDER_NOT_FOUND", "Không tìm thấy đơn dịch vụ.")
    if (booking.status !== "COMPLETED") throw new HttpError(409, "ORDER_NOT_COMPLETED", "Chỉ đánh giá được đơn đã hoàn thành.")
    const [assignments] = await connection.execute(
      "SELECT e.id AS employee_id, e.user_id FROM assignments a JOIN employees e ON e.id = a.employee_id WHERE a.booking_id = ? AND a.status IN ('DONE','COMPLETED') ORDER BY a.id DESC LIMIT 1",
      [bookingId],
    )
    const employee = assignments[0]
    if (employee && input.staffRating === undefined) throw new HttpError(400, "STAFF_RATING_REQUIRED", "Vui lòng đánh giá nhân viên đã thực hiện đơn.")
    if (!employee && input.staffRating !== undefined) throw new HttpError(400, "STAFF_NOT_ASSIGNED", "Đơn chưa có nhân viên được phân công; chỉ đánh giá chất lượng dịch vụ.")
    const [existing] = await connection.execute("SELECT id FROM booking_reviews WHERE booking_id = ? LIMIT 1", [bookingId])
    if (existing.length) throw new HttpError(409, "REVIEW_ALREADY_EXISTS", "Đơn này đã được đánh giá.")
    const [result] = await connection.execute(
      `INSERT INTO booking_reviews (booking_id, customer_id, employee_id, service_id, service_rating, employee_rating, comment)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [bookingId, request.actor.id, employee?.employee_id || null, booking.service_id, input.serviceRating, input.staffRating ?? null, input.comment],
    )
    return {
      id: String(result.insertId),
      orderId: String(bookingId),
      customerId: String(request.actor.id),
      ...(employee ? { staffId: String(employee.user_id), staffRating: input.staffRating } : {}),
      serviceId: String(booking.service_id),
      serviceRating: input.serviceRating,
      comment: input.comment,
      createdAt: new Date().toISOString(),
      hidden: false,
    }
  })
  response.status(201).json({ review })
}))

app.get("/orders/:id/review", requireAuth, asyncRoute(async (request, response) => {
  const bookingId = numericId(request.params.id, "Mã đơn")
  const [bookings] = await getPool().execute("SELECT customer_id FROM bookings WHERE id = ?", [bookingId])
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
  const [rows] = await getPool().execute(`${reviewSelect()} WHERE r.booking_id = ? LIMIT 1`, [bookingId])
  response.json({ review: rows[0] ? toReview(rows[0]) : null })
}))

app.get("/reviews", requireAuth, requireRole("admin"), asyncRoute(async (request, response) => {
  const { page, pageSize } = parse(listSchema, request.query)
  const [rows] = await getPool().execute(
    `${reviewSelect()} ORDER BY r.created_at DESC LIMIT ? OFFSET ?`,
    [pageSize, (page - 1) * pageSize],
  )
  const [count] = await getPool().query("SELECT COUNT(*) AS total FROM booking_reviews")
  response.json({ reviews: rows.map(toReview), page, pageSize, total: Number(count[0].total) })
}))

app.patch("/reviews/:id/visibility", requireAuth, requireRole("admin"), asyncRoute(async (request, response) => {
  const reviewId = numericId(request.params.id, "Mã đánh giá")
  const input = parse(visibilitySchema, request.body)
  if (input.hidden && !input.reason) throw new HttpError(400, "HIDE_REASON_REQUIRED", "Vui lòng nhập lý do ẩn đánh giá.")
  const [result] = await getPool().execute(
    "UPDATE booking_reviews SET is_hidden = ?, hidden_reason = ? WHERE id = ?",
    [input.hidden, input.hidden ? input.reason : null, reviewId],
  )
  if (!result.affectedRows) throw new HttpError(404, "REVIEW_NOT_FOUND", "Không tìm thấy đánh giá.")
  const [rows] = await getPool().execute(`${reviewSelect()} WHERE r.id = ? LIMIT 1`, [reviewId])
  response.json({ review: toReview(rows[0]) })
}))

function reviewSelect() {
  return `SELECT r.*, e.user_id AS employee_user_id FROM booking_reviews r
    LEFT JOIN employees e ON e.id = r.employee_id`
}

function toReview(row) {
  return {
    id: String(row.id),
    orderId: String(row.booking_id),
    customerId: String(row.customer_id),
    ...(row.employee_user_id ? { staffId: String(row.employee_user_id) } : {}),
    serviceId: String(row.service_id),
    serviceRating: Number(row.service_rating),
    ...(row.employee_rating === null ? {} : { staffRating: Number(row.employee_rating) }),
    comment: row.comment,
    createdAt: new Date(row.created_at).toISOString(),
    hidden: Boolean(row.is_hidden),
    ...(row.hidden_reason ? { hiddenReason: row.hidden_reason } : {}),
  }
}

finishApp(app)

const port = Number(process.env.REVIEW_SERVICE_PORT || 4104)
if (require.main === module) app.listen(port, process.env.SERVICE_HOST || "127.0.0.1", () => console.log(`CleanHome review service listening on ${port}`))
module.exports = { app, toReview }
