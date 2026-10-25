require("dotenv").config({ path: process.env.ENV_FILE || require("path").resolve(__dirname, "../../.env") })
const bcrypt = require("bcryptjs")
const { z } = require("zod")
const { getPool } = require("../../shared/db")
const { HttpError, createApp, finishApp, asyncRoute } = require("../../shared/http")
const {
  COOKIE_NAME,
  cookieOptions,
  getJwks,
  introspectSession,
  requireAuth,
  requireIntrospectionClient,
  signSession,
} = require("../../shared/auth")
const { toRole } = require("../../shared/constants")
const { parse } = require("../../shared/validation")

const app = createApp()
const credentialsSchema = z.object({
  phone: z.string().trim().min(9).max(20).regex(/^[0-9+ ()-]+$/),
  password: z.string().min(1).max(200),
})
const registrationSchema = z.object({
  name: z.string().trim().min(2).max(100),
  phone: z.string().trim().min(9).max(20).regex(/^[0-9+ ()-]+$/),
  password: z.string().min(10).max(200),
})

app.post(["/auth/login", "/api/v1/auth/login"], asyncRoute(async (request, response) => {
  const input = parse(credentialsSchema, request.body)
  const [rows] = await getPool().execute(
    "SELECT id, full_name, phone, password_hash, role, status, created_at, employee_code, position, address_text, avatar_url FROM users WHERE phone = ? LIMIT 1",
    [input.phone],
  )
  const user = rows[0]
  if (!user || user.status !== "ACTIVE" || !(await bcrypt.compare(input.password, user.password_hash))) {
    throw new HttpError(401, "INVALID_CREDENTIALS", "Số điện thoại hoặc mật khẩu không đúng.")
  }
  const role = toRole(user.role)
  if (!["customer", "staff", "admin"].includes(role)) throw new HttpError(403, "ROLE_INVALID", "Tài khoản chưa được cấu hình quyền hợp lệ.")
  response.cookie(COOKIE_NAME, signSession({ id: user.id, role: user.role }), cookieOptions())
  response.json({ user: publicUser(user, role) })
}))

app.post(["/auth/register", "/api/v1/auth/register"], asyncRoute(async (request, response) => {
  const input = parse(registrationSchema, request.body)
  const passwordHash = await bcrypt.hash(input.password, 12)
  try {
    const [result] = await getPool().execute(
      "INSERT INTO users (full_name, phone, password_hash, role, status) VALUES (?, ?, ?, 'CUSTOMER', 'ACTIVE')",
      [input.name, input.phone, passwordHash],
    )
    const user = { id: result.insertId, full_name: input.name, phone: input.phone, address_text: "", role: "CUSTOMER", status: "ACTIVE", created_at: new Date(), employee_code: null, position: null, avatar_url: null }
    response.cookie(COOKIE_NAME, signSession({ id: user.id, role: user.role }), cookieOptions())
    response.status(201).json({ user: publicUser(user, "customer") })
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") throw new HttpError(409, "ACCOUNT_EXISTS", "Số điện thoại đã được sử dụng.")
    throw error
  }
}))

app.post(["/auth/logout", "/api/v1/auth/logout"], (_request, response) => {
  response.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: undefined })
  response.status(204).end()
})

app.get(["/auth/me", "/api/v1/auth/me"], requireAuth, asyncRoute(async (request, response) => {
  const [rows] = await getPool().execute(
    "SELECT id, full_name, phone, role, status, created_at, employee_code, position, address_text, avatar_url FROM users WHERE id = ? LIMIT 1",
    [request.actor.id],
  )
  const user = rows[0]
  if (!user) throw new HttpError(401, "SESSION_REVOKED", "Tài khoản không còn hoạt động.")
  response.json({ user: publicUser(user, request.actor.role) })
}))

app.get("/.well-known/jwks.json", (_request, response) => {
  response.set("Cache-Control", "public, max-age=300").json(getJwks())
})

app.get("/api/v1/auth/introspect", requireIntrospectionClient, asyncRoute(async (request, response) => {
  const authorization = request.get("authorization") || ""
  const token = /^Bearer ([^\s]+)$/i.exec(authorization)?.[1]
  response.json(token ? await introspectSession(token) : { active: false })
}))

app.get("/health/ready", asyncRoute(async (_request, response) => {
  await getPool().query("SELECT 1")
  response.json({ status: "ready" })
}))

finishApp(app)

function publicUser(user, role) {
  return {
    id: String(user.id),
    code: user.employee_code || `${role === "staff" ? "NV" : role === "admin" ? "AD" : "KH"}${String(user.id).padStart(3, "0")}`,
    role,
    name: user.full_name,
    phone: user.phone,
    address: user.address_text || "",
    ...(user.avatar_url ? { avatar: user.avatar_url } : {}),
    status: user.status === "ACTIVE" ? "active" : "locked",
    createdAt: new Date(user.created_at).toISOString(),
    ...(user.position ? { position: user.position } : {}),
  }
}

const port = Number(process.env.AUTH_SERVICE_PORT || 4001)
if (require.main === module) app.listen(port, process.env.SERVICE_HOST || "127.0.0.1", () => console.log(`CleanHome auth service listening on ${port}`))
module.exports = { app }
