const express = require("express")
const helmet = require("helmet")
const cookieParser = require("cookie-parser")
const cors = require("cors")

class HttpError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

function createApp() {
  const app = express()
  const origins = (process.env.FRONTEND_ORIGINS || "").split(",").map((value) => value.trim()).filter(Boolean)
  app.disable("x-powered-by")
  app.use(helmet())
  app.use(cors({
    origin(origin, callback) {
      if (!origin || origins.includes(origin)) return callback(null, true)
      return callback(new HttpError(403, "ORIGIN_NOT_ALLOWED", "Origin không được phép truy cập API."))
    },
    credentials: true,
  }))
  app.use(express.json({ limit: "2mb" }))
  app.use(cookieParser())
  app.get("/health", (_request, response) => response.json({ status: "ok" }))
  return app
}

function finishApp(app) {
  app.use((_request, response) => {
    response.status(404).json({ error: { code: "NOT_FOUND", message: "Không tìm thấy API." } })
  })
  app.use((error, _request, response, _next) => {
    const status = Number.isInteger(error.status) ? error.status : 500
    const code = error.code || "INTERNAL_ERROR"
    if (status >= 500) console.error(`[${code}] ${error.message}`)
    response.status(status).json({ error: { code, message: status >= 500 ? "Đã xảy ra lỗi máy chủ." : error.message } })
  })
}

function asyncRoute(handler) {
  return (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next)
}

module.exports = { HttpError, createApp, finishApp, asyncRoute }
