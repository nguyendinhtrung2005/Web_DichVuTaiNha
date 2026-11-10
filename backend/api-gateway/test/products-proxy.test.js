import assert from "node:assert/strict"
import { once } from "node:events"
import { createServer } from "node:http"
import { generateKeyPairSync } from "node:crypto"
import express from "express"
import jwt from "jsonwebtoken"
import test from "node:test"
import { createApp } from "../src/app.js"
import { createApp as createServiceApp } from "../../service-service/src/app.js"

async function listen(app) {
  const server = typeof app.listen === "function"
    ? app.listen(0, "127.0.0.1")
    : createServer(app).listen(0, "127.0.0.1")
  await once(server, "listening")
  return { server, url: `http://127.0.0.1:${server.address().port}` }
}

function close(server) {
  server.close()
  server.closeAllConnections()
}

function gatewayConfig(catalogUrl, orderUrl = catalogUrl) {
  return {
    origin: "http://localhost:3001",
    origins: {
      customer: "http://localhost:3001",
      staff: "http://localhost:3002",
      admin: "http://localhost:3003",
    },
    allowedOrigins: ["http://localhost:3001", "http://localhost:3002", "http://localhost:3003"],
    urls: { catalog: catalogUrl, order: orderUrl },
  }
}

test("gateway proxies admin product APIs to catalog and forwards the session cookie", async () => {
  const upstreamApp = express()
  upstreamApp.get("/api/v1/admin/products", (req, res) => {
    res.json({
      path: req.originalUrl,
      session: req.get("cookie"),
      origin: req.get("origin"),
    })
  })
  const upstream = await listen(upstreamApp)
  const gateway = await listen(createApp({ config: gatewayConfig(upstream.url) }))
  try {
    const response = await fetch(`${gateway.url}/api/v1/admin/products?search=cleaner`, {
      headers: {
        origin: "http://localhost:3003",
        cookie: "cleanhome_access=signed-token",
      },
    })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get("access-control-allow-origin"), "http://localhost:3003")
    assert.deepEqual(await response.json(), {
      path: "/api/v1/admin/products?search=cleaner",
      session: "cleanhome_access=signed-token",
      origin: "http://localhost:3003",
    })
  } finally {
    await close(gateway.server)
    await close(upstream.server)
  }
})

test("gateway rejects unrecognized origins", async () => {
  const gateway = await listen(createApp({ config: gatewayConfig("http://127.0.0.1:1") }))
  try {
    const response = await fetch(`${gateway.url}/api/v1/admin/products`, {
      headers: { origin: "https://not-allowed.example" },
    })
    assert.equal(response.status, 403)
  } finally {
    await close(gateway.server)
  }
})

test("gateway keeps product purchase APIs routed to the order service", async () => {
  const upstreamApp = express()
  upstreamApp.post("/api/v1/product-orders", express.json(), (req, res) => {
    res.status(201).json({ data: { recipient: req.body.recipientName, cookie: req.get("cookie") } })
  })
  const upstream = await listen(upstreamApp)
  const gateway = await listen(createApp({ config: gatewayConfig("http://127.0.0.1:1", upstream.url) }))
  try {
    const response = await fetch(`${gateway.url}/api/v1/product-orders`, {
      method: "POST",
      headers: {
        origin: "http://localhost:3001",
        cookie: "cleanhome_access=customer-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ recipientName: "Khách hàng" }),
    })
    assert.equal(response.status, 201)
    assert.deepEqual(await response.json(), { data: { recipient: "Khách hàng", cookie: "cleanhome_access=customer-token" } })
  } finally {
    await close(gateway.server)
    await close(upstream.server)
  }
})

test("gateway proxies authenticated admin product categories to the ESM catalog service", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
  const pool = {
    async execute(sql) {
      if (sql.startsWith("SELECT id, role, status FROM users")) {
        return [[{ id: 7, role: "ADMIN", status: "ACTIVE" }], []]
      }
      if (sql.includes("FROM product_categories ORDER BY name")) return [[], []]
      throw new Error(`Unexpected SQL in integration test: ${sql}`)
    },
  }
  const service = await listen(createServiceApp({
    pool,
    authOptions: {
      publicKey: publicKey.export({ type: "spki", format: "pem" }),
      issuer: "test-issuer",
      audience: "test-api",
    },
  }))
  const gateway = await listen(createApp({ config: gatewayConfig(service.url) }))
  const token = jwt.sign({}, privateKey, {
    algorithm: "RS256",
    subject: "7",
    issuer: "test-issuer",
    audience: "test-api",
    expiresIn: "5m",
  })
  try {
    const response = await fetch(`${gateway.url}/api/v1/admin/product-categories`, {
      headers: {
        origin: "http://localhost:3003",
        cookie: `cleanhome_access=${token}`,
      },
    })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { data: [] })
  } finally {
    await close(gateway.server)
    await close(service.server)
  }
})
