require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") })
const { z } = require("zod")
const { getPool, inTransaction } = require("../../shared/db")
const { HttpError, createApp, finishApp, asyncRoute } = require("../../shared/http")
const { requireAuth, requireRole } = require("../../shared/auth")
const { ORDER_STATUS_TO_DB, JOB_STATUS_TO_DB } = require("../../shared/constants")
const { parse, numericId } = require("../../shared/validation")
const { estimateService } = require("../../shared/pricing")

const app = createApp()
const bookingSchema = z.object({
  serviceId: z.string().trim().min(1).max(160),
  quantity: z.number().finite().positive().max(100000),
  contact: z.object({
    name: z.string().trim().min(2).max(120),
    phone: z.string().trim().min(9).max(20).regex(/^[+0-9 ()-]+$/),
    address: z.string().trim().min(8).max(300),
    houseType: z.enum(["can-ho", "nha-pho", "biet-thu", "van-phong"]),
    area: z.number().finite().positive().max(100000).optional(),
    rooms: z.number().int().positive().max(1000).optional(),
    floors: z.number().int().positive().max(1000).optional(),
    hasPets: z.boolean(),
  }),
  scheduledAt: z.string().datetime({ offset: true }),
  specialRequest: z.string().max(1000).default(""),
})
const cancellationSchema = z.object({ reason: z.string().trim().min(3).max(2000) })
const cancellationDecisionSchema = z.object({
  approve: z.boolean(),
  note: z.string().trim().min(1).max(2000),
})
const assignSchema = z.object({ staffId: z.string().regex(/^\d+$/) })
const jobSchema = z.object({ next: z.enum(["accepted", "in_progress", "done"]) })
const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(["pending", "confirmed", "in_progress", "completed", "cancelled"]).optional(),
  search: z.string().trim().max(120).optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  sort: z.enum(["newest", "oldest", "schedule-asc", "schedule-desc"]).default("newest"),
})

app.post("/orders", requireAuth, requireRole("customer"), asyncRoute(async (request, response) => {
  const input = parse(bookingSchema, request.body)
  const scheduledAt = new Date(input.scheduledAt)
  if (!Number.isFinite(scheduledAt.getTime()) || scheduledAt.getTime() <= Date.now()) throw new HttpError(400, "INVALID_SCHEDULE", "Thời gian đề xuất phải ở tương lai.")
  const order = await inTransaction(async (connection) => {
    const [services] = await connection.execute(
      "SELECT s.*, c.slug AS category_slug FROM services s JOIN service_categories c ON c.id = s.category_id WHERE (CAST(s.id AS CHAR) = ? OR s.slug = ?) AND s.is_active = TRUE FOR UPDATE",
      [input.serviceId, input.serviceId],
    )
    const service = services[0]
    if (!service) throw new HttpError(404, "SERVICE_NOT_FOUND", "Dịch vụ không còn hoạt động.")
    if (service.category_slug !== "ve-sinh-nha-o") throw new HttpError(400, "SERVICE_CATEGORY_NOT_SUPPORTED", "Luồng này chỉ nhận dịch vụ thuộc nhóm Vệ sinh nhà ở.")
    const quantity = Number(input.quantity)
    const estimate = estimateService(service, quantity)
    if (service.price_mode === "area" && (input.contact.area === undefined || Math.abs(input.contact.area - quantity) > 0.001)) {
      throw new HttpError(400, "AREA_QUANTITY_MISMATCH", "Với dịch vụ tính theo diện tích, số lượng phải bằng diện tích đã nhập.")
    }
    if (input.contact.area === undefined || input.contact.rooms === undefined || input.contact.floors === undefined) {
      throw new HttpError(400, "HOUSE_DETAILS_REQUIRED", "Dịch vụ vệ sinh nhà ở cần diện tích, số phòng và số tầng.")
    }
    const branchId = await resolveBranch(connection)
    const unitPrice = estimate.unitPrice
    const amount = estimate.price
    const duration = estimate.durationMinutes
    const scheduleEnd = new Date(scheduledAt.getTime() + duration * 60000)
    const addressSnapshot = {
      name: input.contact.name,
      phone: input.contact.phone,
      address: input.contact.address,
      houseType: input.contact.houseType,
      area: input.contact.area,
      rooms: input.contact.rooms,
      floors: input.contact.floors,
      hasPets: input.contact.hasPets,
    }
    const [result] = await connection.execute(
      "INSERT INTO bookings (customer_id, branch_id, address_snapshot, special_request, scheduled_start, scheduled_end, duration_minutes, status, total_amount) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)",
      [request.actor.id, branchId, JSON.stringify(addressSnapshot), input.specialRequest, scheduledAt, scheduleEnd, duration, amount],
    )
    const bookingId = result.insertId
    const code = `DH${String(bookingId).padStart(8, "0")}`
    await connection.execute("UPDATE bookings SET booking_code = ? WHERE id = ?", [code, bookingId])
    await connection.execute(
      "INSERT INTO booking_items (booking_id, service_id, service_name_snapshot, quantity, unit_price, unit_snapshot, duration_snapshot, line_total) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [bookingId, service.id, service.name, quantity, unitPrice, service.unit, duration, amount],
    )
    await connection.execute(
      "INSERT INTO booking_status_history (booking_id, changed_by, status, note) VALUES (?, ?, 'PENDING', 'Khách gửi yêu cầu; lịch là thời gian đề xuất, chờ CleanHome xác nhận.')",
      [bookingId, request.actor.id],
    )
    return {
      id: String(bookingId),
      code,
      customerId: String(request.actor.id),
      serviceId: String(service.id),
      quantity,
      contact: addressSnapshot,
      scheduledAt: scheduledAt.toISOString(),
      durationMinutes: duration,
      specialRequest: input.specialRequest,
      price: amount,
      status: "pending",
      history: [{ at: new Date().toISOString(), label: "Khách đặt dịch vụ – chờ xác nhận", by: "Khách hàng" }],
      staffNotes: [],
      createdAt: new Date().toISOString(),
    }
  })
  response.status(201).json({ order, scheduleNote: "Đây là thời gian khách đề xuất, chưa phải lịch hẹn được xác nhận." })
}))

app.get("/orders", requireAuth, asyncRoute(async (request, response) => {
  const query = parse(listSchema, request.query)
  const result = await listOrders(request.actor, query, false)
  response.json(result)
}))

app.get("/history", requireAuth, requireRole("customer"), asyncRoute(async (request, response) => {
  const query = parse(listSchema, request.query)
  const result = await listOrders(request.actor, { ...query, status: "completed" }, true)
  response.json(result)
}))

app.get("/orders/:id", requireAuth, asyncRoute(async (request, response) => {
  const bookingId = numericId(request.params.id, "Mã đơn")
  const order = await getOrder(bookingId, request.actor)
  response.json({ order })
}))

app.post("/orders/:id/cancellation", requireAuth, requireRole("customer"), asyncRoute(async (request, response) => {
  const bookingId = numericId(request.params.id, "Mã đơn")
  const input = parse(cancellationSchema, request.body)
  const cancelRequest = await inTransaction(async (connection) => {
    const [bookings] = await connection.execute("SELECT * FROM bookings WHERE id = ? FOR UPDATE", [bookingId])
    const booking = bookings[0]
    if (!booking || Number(booking.customer_id) !== request.actor.id) throw new HttpError(404, "ORDER_NOT_FOUND", "Không tìm thấy đơn dịch vụ.")
    const [assignmentRows] = await connection.execute("SELECT status FROM assignments WHERE booking_id = ? ORDER BY id DESC LIMIT 1 FOR UPDATE", [bookingId])
    if (!canCancel(booking.status, assignmentRows[0]?.status)) throw new HttpError(409, "CANCELLATION_NOT_ALLOWED", "Đơn không còn đủ điều kiện gửi yêu cầu hủy.")
    const [pending] = await connection.execute(
      "SELECT id FROM booking_cancellation_requests WHERE booking_id = ? AND status = 'PENDING' LIMIT 1 FOR UPDATE",
      [bookingId],
    )
    if (pending.length) throw new HttpError(409, "CANCELLATION_ALREADY_PENDING", "Đơn đã có yêu cầu hủy đang chờ xét duyệt.")
    const [result] = await connection.execute(
      "INSERT INTO booking_cancellation_requests (booking_id, requested_by, reason, status) VALUES (?, ?, ?, 'PENDING')",
      [bookingId, request.actor.id, input.reason],
    )
    await connection.execute(
      "INSERT INTO booking_status_history (booking_id, changed_by, status, note) VALUES (?, ?, ?, ?)",
      [bookingId, request.actor.id, booking.status, "Khách gửi yêu cầu hủy; đơn vẫn giữ trạng thái hiện tại, chờ Admin xét duyệt."],
    )
    return { id: String(result.insertId), reason: input.reason, requestedAt: new Date().toISOString(), status: "pending" }
  })
  response.status(201).json({ cancelRequest })
}))

app.patch("/orders/:id/confirm", requireAuth, requireRole("admin"), asyncRoute(async (request, response) => {
  const bookingId = numericId(request.params.id, "Mã đơn")
  const order = await inTransaction(async (connection) => {
    const [rows] = await connection.execute("SELECT status FROM bookings WHERE id = ? FOR UPDATE", [bookingId])
    if (!rows[0]) throw new HttpError(404, "ORDER_NOT_FOUND", "Không tìm thấy đơn dịch vụ.")
    if (rows[0].status !== "PENDING") throw new HttpError(409, "ORDER_STATE_CONFLICT", "Chỉ xác nhận được đơn đang chờ xác nhận.")
    await connection.execute("UPDATE bookings SET status = 'CONFIRMED' WHERE id = ?", [bookingId])
    await connection.execute(
      "INSERT INTO booking_status_history (booking_id, changed_by, status, note) VALUES (?, ?, 'CONFIRMED', 'Admin xác nhận đơn; thời gian trở thành lịch dự kiến cần phân công.')",
      [bookingId, request.actor.id],
    )
    return getOrderWithConnection(connection, bookingId)
  })
  response.json({ order })
}))

app.patch("/orders/:id/cancellation/decision", requireAuth, requireRole("admin"), asyncRoute(async (request, response) => {
  const bookingId = numericId(request.params.id, "Mã đơn")
  const input = parse(cancellationDecisionSchema, request.body)
  const cancelRequest = await inTransaction(async (connection) => {
    const [bookings] = await connection.execute("SELECT * FROM bookings WHERE id = ? FOR UPDATE", [bookingId])
    const booking = bookings[0]
    if (!booking) throw new HttpError(404, "ORDER_NOT_FOUND", "Không tìm thấy đơn dịch vụ.")
    const [requests] = await connection.execute(
      "SELECT * FROM booking_cancellation_requests WHERE booking_id = ? AND status = 'PENDING' ORDER BY requested_at DESC LIMIT 1 FOR UPDATE",
      [bookingId],
    )
    const pending = requests[0]
    if (!pending) throw new HttpError(409, "CANCELLATION_NOT_PENDING", "Không có yêu cầu hủy đang chờ xét duyệt.")
    const [assignmentRows] = await connection.execute("SELECT status FROM assignments WHERE booking_id = ? ORDER BY id DESC LIMIT 1 FOR UPDATE", [bookingId])
    if (input.approve && !canCancel(booking.status, assignmentRows[0]?.status)) {
      throw new HttpError(409, "CANCELLATION_NOT_APPROVABLE", "Đơn đã bắt đầu hoặc hoàn thành, không thể duyệt hủy.")
    }
    const status = input.approve ? "APPROVED" : "REJECTED"
    await connection.execute(
      "UPDATE booking_cancellation_requests SET status = ?, resolved_by = ?, resolved_at = CURRENT_TIMESTAMP, admin_note = ? WHERE id = ? AND status = 'PENDING'",
      [status, request.actor.id, input.note, pending.id],
    )
    if (input.approve) {
      await connection.execute("UPDATE bookings SET status = 'CANCELLED' WHERE id = ?", [bookingId])
      await connection.execute(
        "UPDATE payments SET refund_required = TRUE WHERE booking_id = ? AND status = 'PAID'",
        [bookingId],
      )
      await connection.execute(
        "INSERT INTO booking_status_history (booking_id, changed_by, status, note) VALUES (?, ?, 'CANCELLED', ?)",
        [bookingId, request.actor.id, `Admin duyệt hủy. Ghi chú: ${input.note}. Khoản đã ghi nhận chỉ được đánh dấu cần xem xét hoàn tiền.`],
      )
    } else {
      await connection.execute(
        "INSERT INTO booking_status_history (booking_id, changed_by, status, note) VALUES (?, ?, ?, ?)",
        [bookingId, request.actor.id, booking.status, `Admin từ chối yêu cầu hủy. Ghi chú: ${input.note}`],
      )
    }
    return { id: String(pending.id), reason: pending.reason, requestedAt: toIso(pending.requested_at), status: status.toLowerCase(), adminNote: input.note, resolvedAt: new Date().toISOString() }
  })
  response.json({ cancelRequest })
}))

app.post("/orders/:id/assignments", requireAuth, requireRole("admin"), asyncRoute(async (request, response) => {
  const bookingId = numericId(request.params.id, "Mã đơn")
  const input = parse(assignSchema, request.body)
  const staffId = numericId(input.staffId, "Mã nhân viên")
  const assignment = await inTransaction(async (connection) => {
    const [bookings] = await connection.execute("SELECT * FROM bookings WHERE id = ? FOR UPDATE", [bookingId])
    const booking = bookings[0]
    if (!booking || booking.status !== "CONFIRMED") throw new HttpError(409, "ORDER_NOT_ASSIGNABLE", "Chỉ phân công được đơn đã xác nhận.")
    if (new Date(booking.scheduled_start).getTime() <= Date.now()) throw new HttpError(409, "SCHEDULE_IN_PAST", "Thời gian thực hiện đã qua; hãy cập nhật lịch trước.")
    const [employees] = await connection.execute(
      "SELECT e.id FROM employees e JOIN users u ON u.id = e.user_id WHERE e.user_id = ? AND e.status = 'ACTIVE' AND u.status = 'ACTIVE' FOR UPDATE",
      [staffId],
    )
    if (!employees[0]) throw new HttpError(400, "STAFF_INVALID", "Nhân viên không tồn tại hoặc không hoạt động.")
    const [conflicts] = await connection.execute(
      `SELECT b.booking_code FROM assignments a JOIN bookings b ON b.id = a.booking_id
       WHERE a.employee_id = ? AND a.status NOT IN ('CANCELLED', 'REASSIGNED')
         AND b.status NOT IN ('CANCELLED', 'COMPLETED') AND b.scheduled_start < ? AND b.scheduled_end > ?
       LIMIT 1 FOR UPDATE`,
      [employees[0].id, booking.scheduled_end, booking.scheduled_start],
    )
    if (conflicts.length) throw new HttpError(409, "STAFF_SCHEDULE_CONFLICT", `Nhân viên đã có công việc trùng lịch ${conflicts[0].booking_code || ""}.`)
    await connection.execute(
      "UPDATE assignments SET status = 'REASSIGNED' WHERE booking_id = ? AND status NOT IN ('DONE', 'COMPLETED')",
      [bookingId],
    )
    const [result] = await connection.execute(
      "INSERT INTO assignments (booking_id, employee_id, status) VALUES (?, ?, 'ASSIGNED')",
      [bookingId, employees[0].id],
    )
    await connection.execute(
      "INSERT INTO booking_status_history (booking_id, changed_by, status, note) VALUES (?, ?, 'CONFIRMED', 'Admin phân công nhân viên.')",
      [bookingId, request.actor.id],
    )
    return { id: String(result.insertId), staffId: String(staffId), jobStatus: "waiting" }
  })
  response.status(201).json({ assignment })
}))

app.patch("/orders/:id/job", requireAuth, requireRole("staff"), asyncRoute(async (request, response) => {
  const bookingId = numericId(request.params.id, "Mã đơn")
  const input = parse(jobSchema, request.body)
  const result = await inTransaction(async (connection) => {
    const [rows] = await connection.execute(
      `SELECT b.*, a.id AS assignment_id, a.status AS assignment_status
       FROM bookings b JOIN assignments a ON a.booking_id = b.id
       JOIN employees e ON e.id = a.employee_id
       WHERE b.id = ? AND e.user_id = ? ORDER BY a.id DESC LIMIT 1 FOR UPDATE`,
      [bookingId, request.actor.id],
    )
    const order = rows[0]
    if (!order) throw new HttpError(404, "ORDER_NOT_FOUND", "Công việc không được giao cho bạn.")
    const nextAllowed = { ASSIGNED: "accepted", ACCEPTED: "in_progress", IN_PROGRESS: "done" }
    const current = order.assignment_status
    if (nextAllowed[current] !== input.next) throw new HttpError(409, "JOB_STATE_CONFLICT", "Trạng thái công việc đã thay đổi hoặc thao tác không hợp lệ.")
    const expectedOrderStatus = input.next === "done" ? "IN_PROGRESS" : "CONFIRMED"
    if (order.status !== expectedOrderStatus) throw new HttpError(409, "ORDER_STATE_CONFLICT", "Đơn không còn ở trạng thái cho phép cập nhật công việc.")
    if (input.next === "accepted") {
      await connection.execute("UPDATE assignments SET status = 'ACCEPTED' WHERE id = ?", [order.assignment_id])
    } else if (input.next === "in_progress") {
      await connection.execute("UPDATE assignments SET status = 'IN_PROGRESS', check_in_at = CURRENT_TIMESTAMP WHERE id = ?", [order.assignment_id])
      await connection.execute("UPDATE bookings SET status = 'IN_PROGRESS' WHERE id = ?", [bookingId])
      await connection.execute(
        "INSERT INTO booking_status_history (booking_id, changed_by, status, note) VALUES (?, ?, 'IN_PROGRESS', 'Nhân viên bắt đầu thực hiện công việc.')",
        [bookingId, request.actor.id],
      )
    } else {
      await connection.execute("UPDATE assignments SET status = 'DONE', check_out_at = CURRENT_TIMESTAMP WHERE id = ?", [order.assignment_id])
      await connection.execute("UPDATE bookings SET status = 'COMPLETED' WHERE id = ?", [bookingId])
      await connection.execute(
        "INSERT INTO booking_status_history (booking_id, changed_by, status, note) VALUES (?, ?, 'COMPLETED', 'Nhân viên xác nhận hoàn thành công việc.')",
        [bookingId, request.actor.id],
      )
    }
    return { jobStatus: JOB_STATUS_TO_DB[input.next === "accepted" ? "ACCEPTED" : input.next === "in_progress" ? "IN_PROGRESS" : "DONE"], orderStatus: input.next === "in_progress" ? "in_progress" : input.next === "done" ? "completed" : "confirmed" }
  })
  response.json(result)
}))

async function listOrders(actor, query, historyOnly) {
  const where = []
  const params = []
  if (actor.role === "customer") { where.push("b.customer_id = ?"); params.push(actor.id) }
  else if (actor.role === "staff") { where.push("EXISTS (SELECT 1 FROM assignments ax JOIN employees ex ON ex.id = ax.employee_id WHERE ax.booking_id = b.id AND ex.user_id = ?)"); params.push(actor.id) }
  if (historyOnly) where.push("b.status = 'COMPLETED'")
  else if (query.status) { where.push("b.status = ?"); params.push(ORDER_STATUS_TO_DB[query.status]) }
  if (query.search) {
    where.push("(b.booking_code LIKE ? OR bi.service_name_snapshot LIKE ? OR JSON_UNQUOTE(JSON_EXTRACT(b.address_snapshot, '$.name')) LIKE ?)")
    params.push(`%${query.search}%`, `%${query.search}%`, `%${query.search}%`)
  }
  if (query.from) { where.push("DATE(b.scheduled_start) >= ?"); params.push(query.from) }
  if (query.to) { where.push("DATE(b.scheduled_start) <= ?"); params.push(query.to) }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : ""
  const [countRows] = await getPool().execute(
    `SELECT COUNT(DISTINCT b.id) AS total FROM bookings b LEFT JOIN booking_items bi ON bi.booking_id = b.id ${whereSql}`,
    params,
  )
  const direction = query.sort === "oldest" || query.sort === "schedule-asc" ? "ASC" : "DESC"
  const sortColumn = query.sort.startsWith("schedule-") ? "b.scheduled_start" : "b.created_at"
  const [rows] = await getPool().execute(
    `SELECT b.*, bi.service_id, bi.service_name_snapshot, bi.quantity, bi.unit_snapshot, bi.unit_price, bi.duration_snapshot, bi.line_total,
      (SELECT e.user_id FROM assignments a JOIN employees e ON e.id = a.employee_id WHERE a.booking_id = b.id AND a.status NOT IN ('REASSIGNED','CANCELLED') ORDER BY a.id DESC LIMIT 1) AS staff_user_id,
      (SELECT a.status FROM assignments a WHERE a.booking_id = b.id AND a.status NOT IN ('REASSIGNED','CANCELLED') ORDER BY a.id DESC LIMIT 1) AS job_status
     FROM bookings b LEFT JOIN booking_items bi
       ON bi.id = (SELECT MIN(bi_first.id) FROM booking_items bi_first WHERE bi_first.booking_id = b.id)
     ${whereSql} ORDER BY ${sortColumn} ${direction}, b.id ${direction} LIMIT ? OFFSET ?`,
    [...params, query.pageSize, (query.page - 1) * query.pageSize],
  )
  const ids = rows.map((row) => row.id)
  const extras = await getOrderExtras(ids)
  return { orders: rows.map((row) => toOrder(row, extras.get(Number(row.id)) || {})), page: query.page, pageSize: query.pageSize, total: Number(countRows[0].total) }
}

async function getOrder(id, actor) {
  const connection = getPool()
  let scope = ""
  const params = [id]
  if (actor.role === "customer") { scope = " AND b.customer_id = ?"; params.push(actor.id) }
  if (actor.role === "staff") {
    scope = " AND EXISTS (SELECT 1 FROM assignments ax JOIN employees ex ON ex.id = ax.employee_id WHERE ax.booking_id = b.id AND ex.user_id = ?)"
    params.push(actor.id)
  }
  const [rows] = await connection.execute(
    `SELECT b.*, bi.service_id, bi.service_name_snapshot, bi.quantity, bi.unit_snapshot, bi.unit_price, bi.duration_snapshot, bi.line_total,
      (SELECT e.user_id FROM assignments a JOIN employees e ON e.id = a.employee_id WHERE a.booking_id = b.id AND a.status NOT IN ('REASSIGNED','CANCELLED') ORDER BY a.id DESC LIMIT 1) AS staff_user_id,
      (SELECT a.status FROM assignments a WHERE a.booking_id = b.id AND a.status NOT IN ('REASSIGNED','CANCELLED') ORDER BY a.id DESC LIMIT 1) AS job_status
     FROM bookings b LEFT JOIN booking_items bi
       ON bi.id = (SELECT MIN(bi_first.id) FROM booking_items bi_first WHERE bi_first.booking_id = b.id)
     WHERE b.id = ? ${scope}`,
    params,
  )
  if (!rows[0]) throw new HttpError(404, "ORDER_NOT_FOUND", "Không tìm thấy đơn dịch vụ hoặc bạn không có quyền xem.")
  const extras = await getOrderExtras([id])
  return toOrder(rows[0], extras.get(id) || {})
}

async function getOrderWithConnection(connection, id) {
  const [rows] = await connection.execute(
    `SELECT b.*, bi.service_id, bi.service_name_snapshot, bi.quantity, bi.unit_snapshot, bi.unit_price, bi.duration_snapshot, bi.line_total,
      (SELECT e.user_id FROM assignments a JOIN employees e ON e.id = a.employee_id WHERE a.booking_id = b.id AND a.status NOT IN ('REASSIGNED','CANCELLED') ORDER BY a.id DESC LIMIT 1) AS staff_user_id,
      (SELECT a.status FROM assignments a WHERE a.booking_id = b.id AND a.status NOT IN ('REASSIGNED','CANCELLED') ORDER BY a.id DESC LIMIT 1) AS job_status
     FROM bookings b LEFT JOIN booking_items bi
       ON bi.id = (SELECT MIN(bi_first.id) FROM booking_items bi_first WHERE bi_first.booking_id = b.id)
     WHERE b.id = ?`,
    [id],
  )
  const [history] = await connection.execute(
    "SELECT h.created_at, h.status, h.note, u.full_name FROM booking_status_history h JOIN users u ON u.id = h.changed_by WHERE h.booking_id = ? ORDER BY h.created_at, h.id",
    [id],
  )
  const [cancelRows] = await connection.execute(
    "SELECT * FROM booking_cancellation_requests WHERE booking_id = ? ORDER BY requested_at DESC LIMIT 1",
    [id],
  )
  return toOrder(rows[0], { history, cancelRequest: cancelRows[0] })
}

async function getOrderExtras(ids) {
  const result = new Map()
  if (!ids.length) return result
  const marks = ids.map(() => "?").join(",")
  const [historyRows] = await getPool().execute(
    `SELECT h.booking_id, h.created_at, h.status, h.note, u.full_name FROM booking_status_history h JOIN users u ON u.id = h.changed_by WHERE h.booking_id IN (${marks}) ORDER BY h.created_at, h.id`,
    ids,
  )
  const [cancelRows] = await getPool().execute(
    `SELECT c.* FROM booking_cancellation_requests c JOIN (SELECT booking_id, MAX(id) AS max_id FROM booking_cancellation_requests WHERE booking_id IN (${marks}) GROUP BY booking_id) latest ON latest.max_id = c.id`,
    ids,
  )
  for (const id of ids) result.set(Number(id), { history: [], cancelRequest: null })
  for (const row of historyRows) result.get(Number(row.booking_id)).history.push(row)
  for (const row of cancelRows) result.get(Number(row.booking_id)).cancelRequest = row
  return result
}

function toOrder(row, extras) {
  const contact = typeof row.address_snapshot === "string" ? JSON.parse(row.address_snapshot) : row.address_snapshot
  const status = String(row.status).toLowerCase()
  const jobStatus = row.job_status ? ({ ASSIGNED: "waiting", WAITING: "waiting", ACCEPTED: "accepted", IN_PROGRESS: "in_progress", DONE: "done", COMPLETED: "done" })[row.job_status] : undefined
  const history = (extras.history || []).map((entry) => ({
    at: toIso(entry.created_at),
    label: entry.note || `Trạng thái ${String(entry.status).toLowerCase()}`,
    by: entry.full_name || "CleanHome",
  }))
  const cancellation = extras.cancelRequest
  return {
    id: String(row.id),
    code: row.booking_code || `DH${String(row.id).padStart(8, "0")}`,
    customerId: String(row.customer_id),
    serviceId: String(row.service_id),
    quantity: Number(row.quantity),
    contact: {
      name: contact.name,
      phone: contact.phone,
      address: contact.address,
      houseType: contact.houseType,
      ...(contact.area === undefined ? {} : { area: Number(contact.area) }),
      ...(contact.rooms === undefined ? {} : { rooms: Number(contact.rooms) }),
      ...(contact.floors === undefined ? {} : { floors: Number(contact.floors) }),
      hasPets: Boolean(contact.hasPets),
    },
    scheduledAt: toIso(row.scheduled_start),
    durationMinutes: Number(row.duration_snapshot ?? row.duration_minutes),
    specialRequest: row.special_request || "",
    price: Number(row.line_total ?? row.total_amount),
    status,
    ...(row.staff_user_id ? { staffId: String(row.staff_user_id) } : {}),
    ...(jobStatus ? { jobStatus } : {}),
    ...(cancellation ? { cancelRequest: { reason: cancellation.reason, requestedAt: toIso(cancellation.requested_at), status: cancellation.status.toLowerCase(), ...(cancellation.admin_note ? { adminNote: cancellation.admin_note } : {}), ...(cancellation.resolved_at ? { resolvedAt: toIso(cancellation.resolved_at) } : {}) } } : {}),
    history,
    staffNotes: [],
    createdAt: toIso(row.created_at),
  }
}

async function resolveBranch(connection) {
  const configured = process.env.DEFAULT_BRANCH_ID
  if (configured) {
    const id = numericId(configured, "DEFAULT_BRANCH_ID")
    const [rows] = await connection.execute("SELECT id FROM branches WHERE id = ? AND status = 'ACTIVE' LIMIT 1", [id])
    if (!rows.length) throw new HttpError(503, "DEFAULT_BRANCH_UNAVAILABLE", "Chi nhánh mặc định không hoạt động; kiểm tra cấu hình DEFAULT_BRANCH_ID.")
    return id
  }
  const [rows] = await connection.execute("SELECT id FROM branches WHERE status = 'ACTIVE' ORDER BY id LIMIT 2")
  if (rows.length !== 1) throw new HttpError(503, "DEFAULT_BRANCH_REQUIRED", "Cấu hình DEFAULT_BRANCH_ID trỏ tới chi nhánh hoạt động của đơn.")
  return rows[0].id
}

function canCancel(status, jobStatus) {
  return ["PENDING", "CONFIRMED"].includes(status) && !["IN_PROGRESS", "DONE", "COMPLETED"].includes(jobStatus)
}

function toIso(value) {
  const date = value instanceof Date ? value : new Date(value)
  return date.toISOString()
}

finishApp(app)

const port = Number(process.env.ORDER_SERVICE_PORT || 4102)
if (require.main === module) app.listen(port, process.env.SERVICE_HOST || "127.0.0.1", () => console.log(`CleanHome order service listening on ${port}`))
module.exports = { app, canCancel, toOrder }
