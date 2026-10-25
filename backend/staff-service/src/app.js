require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") })
const bcrypt = require("bcryptjs")
const { z } = require("zod")
const { getPool, inTransaction } = require("../../shared/db")
const { HttpError, createApp, finishApp, asyncRoute } = require("../../shared/http")
const { requireAuth, requireRole } = require("../../shared/auth")
const { parse, numericId } = require("../../shared/validation")

const app = createApp()
const profileSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  phone: z.string().trim().min(9).max(20).regex(/^[0-9+ ()-]+$/),
  address: z.string().trim().max(300),
  avatar: z.string().max(1_400_000).optional(),
}).strict()
const staffAccountSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  phone: z.string().trim().min(9).max(20).regex(/^[0-9+ ()-]+$/),
  password: z.string().min(12).max(200),
  branchId: z.number().int().positive(),
  employeeCode: z.string().trim().max(30).optional(),
  position: z.string().trim().max(120).optional(),
})
const avatarDataPattern = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/
const maxAvatarBytes = 1024 * 1024

app.get("/staff/me", requireAuth, requireRole("staff"), asyncRoute(async (request, response) => {
  const user = await findUser(request.actor.id)
  response.json({ user: toPublicUser(user) })
}))

app.patch("/staff/me", requireAuth, requireRole("staff"), asyncRoute(async (request, response) => {
  const input = parse(profileSchema, request.body)
  if (input.avatar !== undefined && input.avatar !== "") {
    const match = avatarDataPattern.exec(input.avatar)
    if (!match || Buffer.from(match[2], "base64").length > maxAvatarBytes) {
      throw new HttpError(400, "INVALID_AVATAR", "Ảnh cần là PNG, JPEG hoặc WebP và tối đa 1 MB.")
    }
  }
  try {
    const profileFields = ["full_name = ?", "email = ?", "phone = ?", "address_text = ?"]
    const values = [input.name, input.email, input.phone, input.address]
    if (input.avatar !== undefined) {
      profileFields.push("avatar_data = ?", "avatar_url = NULL")
      values.push(input.avatar || null)
    }
    values.push(request.actor.id)
    await getPool().execute(
      `UPDATE users SET ${profileFields.join(", ")} WHERE id = ? AND role = 'EMPLOYEE' AND status = 'ACTIVE'`,
      values,
    )
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") throw new HttpError(409, "CONTACT_IN_USE", "Email hoặc số điện thoại đã được tài khoản khác sử dụng.")
    throw error
  }
  const [activeUsers] = await getPool().execute(
    "SELECT id FROM users WHERE id = ? AND role = 'EMPLOYEE' AND status = 'ACTIVE' LIMIT 1",
    [request.actor.id],
  )
  if (!activeUsers.length) throw new HttpError(404, "STAFF_NOT_FOUND", "Không tìm thấy hồ sơ nhân viên đang hoạt động.")
  const user = await findUser(request.actor.id)
  response.json({ user: toPublicUser(user) })
}))

app.post("/staff/accounts", requireAuth, requireRole("admin"), asyncRoute(async (request, response) => {
  const input = parse(staffAccountSchema, request.body)
  const passwordHash = await bcrypt.hash(input.password, 12)
  const user = await inTransaction(async (connection) => {
    const [branches] = await connection.execute("SELECT id FROM branches WHERE id = ? AND status = 'ACTIVE' LIMIT 1", [input.branchId])
    if (!branches.length) throw new HttpError(400, "BRANCH_INVALID", "Chi nhánh không tồn tại hoặc không hoạt động.")
    const [result] = await connection.execute(
      "INSERT INTO users (full_name, email, phone, password_hash, role, status, employee_code, position) VALUES (?, ?, ?, ?, 'EMPLOYEE', 'ACTIVE', ?, ?)",
      [input.name, input.email, input.phone, passwordHash, input.employeeCode || null, input.position || null],
    )
    await connection.execute(
      "INSERT INTO employees (user_id, branch_id, verification_status, status) VALUES (?, ?, 'VERIFIED', 'ACTIVE')",
      [result.insertId, input.branchId],
    )
    return { id: result.insertId, full_name: input.name, email: input.email, phone: input.phone, address_text: "", role: "EMPLOYEE", status: "ACTIVE", employee_code: input.employeeCode || null, position: input.position || null, avatar_data: null, created_at: new Date() }
  })
  response.status(201).json({ user: toPublicUser(user) })
}))

app.get("/staff/:id", requireAuth, asyncRoute(async (request, response) => {
  const targetId = numericId(request.params.id, "Mã nhân viên")
  if (request.actor.role !== "admin" && (request.actor.role !== "staff" || request.actor.id !== targetId)) {
    throw new HttpError(404, "STAFF_NOT_FOUND", "Không tìm thấy nhân viên.")
  }
  response.json({ user: toPublicUser(await findUser(targetId)) })
}))

async function findUser(id) {
  const [rows] = await getPool().execute(
    "SELECT id, full_name, email, phone, address_text, avatar_url, avatar_data, role, status, employee_code, position, created_at FROM users WHERE id = ? AND role = 'EMPLOYEE' LIMIT 1",
    [id],
  )
  if (!rows[0]) throw new HttpError(404, "STAFF_NOT_FOUND", "Không tìm thấy hồ sơ nhân viên.")
  return rows[0]
}

function toPublicUser(user) {
  return {
    id: String(user.id),
    code: user.employee_code || `NV${String(user.id).padStart(3, "0")}`,
    role: "staff",
    name: user.full_name,
    email: user.email,
    phone: user.phone,
    address: user.address_text || "",
    ...(user.avatar_data ? { avatar: user.avatar_data } : user.avatar_url ? { avatar: user.avatar_url } : {}),
    status: user.status === "ACTIVE" ? "active" : "locked",
    createdAt: new Date(user.created_at).toISOString(),
    ...(user.position ? { position: user.position } : {}),
  }
}

finishApp(app)

const port = Number(process.env.STAFF_SERVICE_PORT || 4005)
if (require.main === module) app.listen(port, process.env.SERVICE_HOST || "127.0.0.1", () => console.log(`CleanHome staff service listening on ${port}`))
module.exports = { app }
