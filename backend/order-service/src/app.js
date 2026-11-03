const path = require("node:path")
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") })

const express = require("express")
const helmet = require("helmet")
const mysql = require("mysql2/promise")
const { createProductOrderRouter } = require("./product-order-routes")

function requiredEnv(name) {
  const value = process.env[name]
  if (!value || value.startsWith("replace-locally")) throw new Error(`${name} chưa được cấu hình.`)
  return value
}

function createPoolFromEnv() {
  return mysql.createPool({
    host: requiredEnv("MYSQL_HOST"),
    port: Number(process.env.MYSQL_PORT || 3306),
    database: requiredEnv("MYSQL_DATABASE"),
    user: requiredEnv("MYSQL_USER"),
    password: requiredEnv("MYSQL_PASSWORD"),
    waitForConnections: true,
    connectionLimit: 10,
    decimalNumbers: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
  })
}

function createApp({ pool = createPoolFromEnv(), authOptions = {
  publicKey: process.env.JWT_PUBLIC_KEY,
  issuer: process.env.JWT_ISSUER,
  audience: process.env.JWT_AUDIENCE,
  cookieName: process.env.AUTH_COOKIE_NAME || "cleanhome_access",
} } = {}) {
  const app = express()
  app.disable("x-powered-by")
  app.use(helmet())
  app.get("/health", (_req, res) => res.json({ status: "ok", service: "product-orders" }))
  app.use("/api/v1", createProductOrderRouter({ pool, authOptions }))
  app.use((error, _req, res, _next) => {
    console.error("Product orders request failed:", error.message)
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Không thể hoàn tất yêu cầu. Vui lòng thử lại sau." } })
  })
  return app
}

if (require.main === module) {
  const port = Number(process.env.ORDER_SERVICE_PORT || 4102)
  const host = process.env.SERVICE_HOST || "127.0.0.1"
  const app = createApp()
  app.listen(port, host, () => console.log(`Product orders listening on http://${host}:${port}`))
}

module.exports = { createApp, createPoolFromEnv }
