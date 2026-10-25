require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") })
const { z } = require("zod")
const { getPool } = require("../../shared/db")
const { HttpError, createApp, finishApp, asyncRoute } = require("../../shared/http")
const { requireAuth } = require("../../shared/auth")
const { CATEGORY_SLUGS, fromJson } = require("../../shared/constants")
const { parse } = require("../../shared/validation")
const { estimateService } = require("../../shared/pricing")

const app = createApp()
const listSchema = z.object({
  category: z.string().optional(),
})

app.get("/services", asyncRoute(async (request, response) => {
  const query = parse(listSchema, request.query)
  if (query.category && !CATEGORY_SLUGS.has(query.category)) throw new HttpError(400, "INVALID_CATEGORY", "Nhóm dịch vụ không hợp lệ.")
  const conditions = ["s.is_active = TRUE", "c.is_active = TRUE"]
  const params = []
  if (query.category) {
    conditions.push("c.slug = ?")
    params.push(query.category)
  }
  const [rows] = await getPool().execute(
    `SELECT s.*, c.slug AS category_slug FROM services s JOIN service_categories c ON c.id = s.category_id WHERE ${conditions.join(" AND ")} ORDER BY s.id`,
    params,
  )
  response.json({ services: rows.map(toService) })
}))

app.get("/services/:id", asyncRoute(async (request, response) => {
  const value = request.params.id
  const [rows] = await getPool().execute(
    "SELECT s.*, c.slug AS category_slug FROM services s JOIN service_categories c ON c.id = s.category_id WHERE (CAST(s.id AS CHAR) = ? OR s.slug = ?) AND s.is_active = TRUE LIMIT 1",
    [value, value],
  )
  const service = rows[0]
  if (!service) throw new HttpError(404, "SERVICE_NOT_FOUND", "Không tìm thấy dịch vụ.")
  response.json({ service: toService(service) })
}))

app.post("/services/:id/estimate", requireAuth, asyncRoute(async (request, response) => {
  const value = parse(z.object({ quantity: z.coerce.number().finite().positive().max(100000) }), request.body)
  const [rows] = await getPool().execute(
    "SELECT s.id, s.slug, s.unit, s.price_mode, s.base_price, s.min_quantity, s.minutes_per_unit, s.base_minutes FROM services s WHERE (CAST(s.id AS CHAR) = ? OR s.slug = ?) AND s.is_active = TRUE LIMIT 1",
    [request.params.id, request.params.id],
  )
  const service = rows[0]
  if (!service) throw new HttpError(404, "SERVICE_NOT_FOUND", "Dịch vụ không còn hoạt động.")
  response.json({ estimate: { ...estimateService(service, value.quantity), unit: service.unit } })
}))

function toService(row) {
  const category = CATEGORY_SLUGS.has(row.category_slug) ? row.category_slug : null
  return {
    id: String(row.id),
    slug: row.slug || `service-${row.id}`,
    name: row.name,
    category,
    shortDesc: row.short_description || "",
    description: row.description,
    scope: fromJson(row.scope),
    included: fromJson(row.included),
    excluded: fromJson(row.excluded),
    unit: row.unit,
    quantityLabel: row.price_mode === "area" ? "Diện tích (m²)" : row.price_mode === "hour" ? "Số giờ" : row.unit,
    price: Number(row.base_price),
    minQuantity: Number(row.min_quantity),
    defaultQuantity: Number(row.min_quantity),
    minutesPerUnit: Number(row.minutes_per_unit),
    baseMinutes: Number(row.base_minutes),
    image: row.image_url || "",
    status: row.is_active ? "active" : "inactive",
  }
}

finishApp(app)

const port = Number(process.env.SERVICE_SERVICE_PORT || 4105)
if (require.main === module) app.listen(port, process.env.SERVICE_HOST || "127.0.0.1", () => console.log(`CleanHome service catalog listening on ${port}`))
module.exports = { app, toService }
