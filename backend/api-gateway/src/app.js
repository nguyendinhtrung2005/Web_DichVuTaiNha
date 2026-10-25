require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") })
const express = require("express")
const helmet = require("helmet")
const cors = require("cors")
const { createProxyMiddleware } = require("http-proxy-middleware")

const app = express()
const origins = (process.env.FRONTEND_ORIGINS || "").split(",").map((value) => value.trim()).filter(Boolean)
app.disable("x-powered-by")
app.use(helmet())
app.use(cors({
  origin(origin, callback) {
    if (!origin || origins.includes(origin)) return callback(null, true)
    return callback(new Error("Origin không được phép truy cập API."))
  },
  credentials: true,
}))
app.get("/health", (_request, response) => response.json({ status: "ok" }))

function forward(prefix, targetEnv, servicePrefix) {
  const target = process.env[targetEnv]
  if (!target) throw new Error(`Missing gateway target ${targetEnv}.`)
  app.use(prefix, createProxyMiddleware({
    target,
    changeOrigin: true,
    pathRewrite: (path) => `${servicePrefix}${path === "/" ? "" : path}`,
    on: {
      error(error, _request, response) {
        console.error(`[GATEWAY_UPSTREAM] ${targetEnv}: ${error.message}`)
        if (!response.headersSent) response.writeHead(503, { "content-type": "application/json" })
        response.end(JSON.stringify({ error: { code: "UPSTREAM_UNAVAILABLE", message: "Dịch vụ backend tạm thời không khả dụng." } }))
      },
    },
  }))
}

forward("/api/auth", "AUTH_SERVICE_URL", "/auth")
forward("/api/v1/auth", "AUTH_SERVICE_URL", "/api/v1/auth")
forward("/.well-known", "AUTH_SERVICE_URL", "/.well-known")
forward("/api/services", "SERVICE_SERVICE_URL", "/services")
forward("/api/orders", "ORDER_SERVICE_URL", "/orders")
forward("/api/history", "ORDER_SERVICE_URL", "/history")
forward("/api/payments", "PAYMENT_SERVICE_URL", "/payments")
forward("/api/reviews", "REVIEW_SERVICE_URL", "/reviews")
forward("/api/staff", "STAFF_SERVICE_URL", "/staff")

app.use((error, _request, response, _next) => {
  console.error(`[GATEWAY_ERROR] ${error.message}`)
  response.status(403).json({ error: { code: "ORIGIN_NOT_ALLOWED", message: "Origin không được phép truy cập API." } })
})
app.use((_request, response) => {
  response.status(404).json({ error: { code: "NOT_FOUND", message: "Không tìm thấy API." } })
})

const port = Number(process.env.GATEWAY_PORT || 4000)
if (require.main === module) app.listen(port, process.env.GATEWAY_HOST || "127.0.0.1", () => console.log(`CleanHome API gateway listening on ${port}`))
module.exports = { app }
