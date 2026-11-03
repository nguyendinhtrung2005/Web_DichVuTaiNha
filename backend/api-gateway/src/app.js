const path = require("node:path")
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") })

const http = require("node:http")
const https = require("node:https")
const express = require("express")
const cors = require("cors")
const helmet = require("helmet")

const PRODUCT_API = /^\/api\/v1\/admin\/(?:products|product-categories)(?:\/|$)/
const PRODUCT_ORDER_API = /^\/api\/v1\/(?:product-orders|admin\/product-orders)(?:\/|$)/

function proxyToService(serviceUrl) {
  const target = new URL(serviceUrl)
  const transport = target.protocol === "https:" ? https : http
  return (req, res) => {
    const upstreamPath = req.originalUrl
    const upstream = transport.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || undefined,
      method: req.method,
      path: upstreamPath,
      headers: {
        ...req.headers,
        host: target.host,
        "x-forwarded-host": req.get("host") || "",
        "x-forwarded-proto": req.get("x-forwarded-proto") || req.protocol,
      },
    }, (response) => {
      res.status(response.statusCode || 502)
      for (const [name, value] of Object.entries(response.headers)) {
        if (value !== undefined && name.toLowerCase() !== "transfer-encoding") res.setHeader(name, value)
      }
      response.pipe(res)
    })
    upstream.setTimeout(30000, () => upstream.destroy(new Error("Service catalog timed out.")))
    upstream.on("error", () => {
      if (!res.headersSent) res.status(502).json({ error: { code: "UPSTREAM_UNAVAILABLE", message: "Danh mục sản phẩm tạm thời chưa khả dụng." } })
      else res.destroy()
    })
    req.pipe(upstream)
  }
}

function createApp({
  serviceUrl = process.env.SERVICE_SERVICE_URL || "http://127.0.0.1:4105",
  orderServiceUrl = process.env.ORDER_SERVICE_URL || "http://127.0.0.1:4102",
  origins = (process.env.FRONTEND_ORIGINS || "").split(",").map((item) => item.trim()).filter(Boolean),
} = {}) {
  const app = express()
  app.disable("x-powered-by")
  app.use(helmet())
  app.use(cors({
    credentials: true,
    origin(origin, callback) {
      if (!origin || origins.includes(origin)) return callback(null, true)
      return callback(new Error("Origin is not allowed."))
    },
  }))
  app.options("*", cors({ credentials: true, origin: origins }))
  app.get("/health", (_req, res) => res.json({ status: "ok", service: "api-gateway" }))
  app.use((req, res, next) => {
    if (PRODUCT_API.test(req.originalUrl.split("?")[0])) return proxyToService(serviceUrl)(req, res)
    if (PRODUCT_ORDER_API.test(req.originalUrl.split("?")[0])) return proxyToService(orderServiceUrl)(req, res)
    return next()
  })
  app.use((_req, res) => res.status(404).json({ error: { code: "NOT_FOUND", message: "Không tìm thấy API." } }))
  app.use((error, _req, res, _next) => {
    if (error.message === "Origin is not allowed.") return res.status(403).json({ error: { code: "ORIGIN_FORBIDDEN", message: "Nguồn truy cập không được phép." } })
    console.error("API gateway request failed:", error.message)
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Không thể hoàn tất yêu cầu. Vui lòng thử lại sau." } })
  })
  return app
}

if (require.main === module) {
  const port = Number(process.env.GATEWAY_PORT || 4000)
  const host = process.env.GATEWAY_HOST || "127.0.0.1"
  createApp().listen(port, host, () => console.log(`API gateway listening on http://${host}:${port}`))
}

module.exports = { createApp }
