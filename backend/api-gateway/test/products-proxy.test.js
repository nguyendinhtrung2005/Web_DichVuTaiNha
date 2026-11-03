const assert = require("node:assert/strict")
const { once } = require("node:events")
const { generateKeyPairSync } = require("node:crypto")
const express = require("express")
const jwt = require("jsonwebtoken")
const test = require("node:test")
const { createApp } = require("../src/app")
const { createApp: createServiceApp } = require("../../service-service/src/app")

async function listen(app) {
  const server = app.listen(0, "127.0.0.1")
  await once(server, "listening")
  return { server, url: `http://127.0.0.1:${server.address().port}` }
}

async function close(server) {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
}

test("gateway proxies product routes and forwards the server session cookie", async () => {
  const upstreamApp = express()
  upstreamApp.post("/api/v1/admin/products", express.json(), (req, res) => {
    res.status(201).json({
      path: req.originalUrl,
      session: req.get("cookie"),
      product: req.body.name,
    })
  })
  const upstream = await listen(upstreamApp)
  const gateway = await listen(createApp({ serviceUrl: upstream.url, origins: ["http://localhost:3003"] }))
  try {
    const response = await fetch(`${gateway.url}/api/v1/admin/products?search=cleaner`, {
      method: "POST",
      headers: {
        origin: "http://localhost:3003",
        cookie: "cleanhome_access=signed-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "Dung dịch" }),
    })
    assert.equal(response.status, 201)
    assert.equal(response.headers.get("access-control-allow-origin"), "http://localhost:3003")
    assert.deepEqual(await response.json(), {
      path: "/api/v1/admin/products?search=cleaner",
      session: "cleanhome_access=signed-token",
      product: "Dung dịch",
    })
  } finally {
    await close(gateway.server)
    await close(upstream.server)
  }
})

test("gateway rejects unrecognized origins", async () => {
  const gateway = await listen(createApp({ serviceUrl: "http://127.0.0.1:1", origins: ["http://localhost:3003"] }))
  try {
    const response = await fetch(`${gateway.url}/api/v1/admin/products`, { headers: { origin: "https://not-allowed.example" } })
    assert.equal(response.status, 403)
  } finally {
    await close(gateway.server)
  }
})

test("gateway routes product purchase APIs to the order service", async () => {
  const upstreamApp = express()
  upstreamApp.post("/api/v1/product-orders", express.json(), (req, res) => {
    res.status(201).json({ data: { recipient: req.body.recipientName, cookie: req.get("cookie") } })
  })
  const upstream = await listen(upstreamApp)
  const gateway = await listen(createApp({
    orderServiceUrl: upstream.url,
    origins: ["http://localhost:3003"],
  }))
  try {
    const response = await fetch(`${gateway.url}/api/v1/product-orders`, {
      method: "POST",
      headers: {
        origin: "http://localhost:3003",
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

test("gateway routes an authenticated admin request to the product service", async () => {
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
  const gateway = await listen(createApp({
    serviceUrl: service.url,
    origins: ["http://localhost:3003"],
  }))
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
