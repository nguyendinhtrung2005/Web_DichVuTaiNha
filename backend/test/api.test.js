const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { generateKeyPairSync } = require("node:crypto")
const { once } = require("node:events")
const test = require("node:test")
const cookieParser = require("cookie-parser")
const express = require("express")
const authApp = require("../auth-service/src/app").app
const { COOKIE_NAME, InvalidSessionTokenError, getJwks, requireAuth, signSession, verifySession } = require("../shared/auth")
const { canCancel, toOrder } = require("../order-service/src/app")
const { toPayment } = require("../payment-service/src/app")
const { toReview } = require("../review-service/src/app")
const { toService } = require("../service-service/src/app")
const { estimateService } = require("../shared/pricing")

async function request(app, path, options) {
  const server = app.listen(0, "127.0.0.1")
  await once(server, "listening")
  try {
    const address = server.address()
    return await fetch(`http://127.0.0.1:${address.port}${path}`, options)
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
}

async function withJwtConfig(run) {
  const names = ["JWT_ISSUER", "JWT_AUDIENCE", "JWT_PRIVATE_KEY_FILE", "JWT_PUBLIC_KEY", "AUTH_INTROSPECTION_URL", "AUTH_INTROSPECTION_TOKEN"]
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]))
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
  const keyDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "cleanhome-auth-test-"))
  const privateKeyPath = path.join(keyDirectory, "private.pem")
  fs.writeFileSync(privateKeyPath, privateKey.export({ format: "pem", type: "pkcs8" }), { mode: 0o600 })
  process.env.JWT_ISSUER = "cleanhome-auth-test"
  process.env.JWT_AUDIENCE = "cleanhome-api-test"
  process.env.JWT_PRIVATE_KEY_FILE = privateKeyPath
  process.env.JWT_PUBLIC_KEY = publicKey.export({ format: "pem", type: "spki" }).toString()
  process.env.AUTH_INTROSPECTION_TOKEN = "test-service-token"
  try {
    return await run()
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name]
      else process.env[name] = previous[name]
    }
    fs.rmSync(keyDirectory, { recursive: true, force: true })
  }
}

test("API returns structured validation, authentication, and not-found responses", async () => {
  const invalidLogin = await request(authApp, "/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  })
  assert.equal(invalidLogin.status, 400)
  assert.equal((await invalidLogin.json()).error.code, "VALIDATION_ERROR")

  const emailLogin = await request(authApp, "/api/v1/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "customer@example.test", password: "not-a-real-password" }),
  })
  assert.equal(emailLogin.status, 400)

  const unauthenticated = await request(authApp, "/auth/me")
  assert.equal(unauthenticated.status, 401)
  assert.equal((await unauthenticated.json()).error.code, "UNAUTHENTICATED")

  const missing = await request(authApp, "/does-not-exist")
  assert.equal(missing.status, 404)
  assert.equal((await missing.json()).error.code, "NOT_FOUND")
})

test("Auth signs RS256 phone-auth sessions and publishes a matching JWKS", async () => {
  await withJwtConfig(async () => {
    const token = signSession({ id: 42, role: "EMPLOYEE" })
    const verified = verifySession(token)
    const jwks = getJwks()
    const response = await request(authApp, "/.well-known/jwks.json")
    const body = await response.json()
    const unauthorizedIntrospection = await request(authApp, "/api/v1/auth/introspect")
    const invalidTokenIntrospection = await request(authApp, "/api/v1/auth/introspect", {
      headers: {
        "x-service-token": "test-service-token",
        authorization: "Bearer invalid-token",
      },
    })

    assert.equal(verified.sub, "42")
    assert.equal(verified.role, "EMPLOYEE")
    assert.equal(verified.iss, process.env.JWT_ISSUER)
    assert.equal(verified.aud, process.env.JWT_AUDIENCE)
    assert.equal(jwks.keys[0].alg, "RS256")
    assert.equal(jwks.keys[0].kid, JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString()).kid)
    assert.equal(response.status, 200)
    assert.deepEqual(body, jwks)
    assert.equal(unauthorizedIntrospection.status, 401)
    assert.deepEqual(await invalidTokenIntrospection.json(), { active: false })
    const [header, payload] = token.split(".")
    const invalidToken = `${header}.${payload}.${Buffer.from("invalid-signature").toString("base64url")}`
    assert.throws(() => verifySession(invalidToken), InvalidSessionTokenError)
  })
})

test("services verify JWT locally and fail closed through Auth introspection", async () => {
  await withJwtConfig(async () => {
    const token = signSession({ id: 42, role: "EMPLOYEE" })
    const introspection = express()
    introspection.get("/api/v1/auth/introspect", (request, response) => {
      assert.equal(request.get("x-service-token"), "test-service-token")
      assert.equal(request.get("authorization"), `Bearer ${token}`)
      response.json({ active: true, sub: "42", role: "EMPLOYEE" })
    })
    const server = introspection.listen(0, "127.0.0.1")
    await once(server, "listening")
    const address = server.address()
    process.env.AUTH_INTROSPECTION_URL = `http://127.0.0.1:${address.port}/api/v1/auth/introspect`

    const protectedApp = express()
    protectedApp.use(cookieParser())
    protectedApp.get("/protected", requireAuth, (request, response) => response.json({ actor: request.actor }))
    try {
      const response = await request(protectedApp, "/protected", {
        headers: { cookie: `${COOKIE_NAME}=${token}` },
      })
      assert.equal(response.status, 200)
      assert.deepEqual(await response.json(), { actor: { id: 42, role: "staff" } })
    } finally {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    }
  })
})

test("cancellation is limited to pending or confirmed jobs that have not started", () => {
  assert.equal(canCancel("PENDING", "ASSIGNED"), true)
  assert.equal(canCancel("CONFIRMED", "ACCEPTED"), true)
  assert.equal(canCancel("IN_PROGRESS", "IN_PROGRESS"), false)
  assert.equal(canCancel("COMPLETED", "DONE"), false)
  assert.equal(canCancel("CANCELLED", "ASSIGNED"), false)
})

test("shared pricing enforces quantity rules and yields the same price and duration inputs", () => {
  const hourly = { price_mode: "hour", min_quantity: 2, base_price: 95000, base_minutes: 30, minutes_per_unit: 20, unit: "giờ" }
  assert.deepEqual(estimateService(hourly, 2), {
    quantity: 2,
    unitPrice: 95000,
    price: 190000,
    durationMinutes: 90,
    pricingMode: "hour",
  })
  assert.throws(() => estimateService(hourly, 1), { code: "MINIMUM_QUANTITY" })
  assert.throws(() => estimateService(hourly, 2.5), { code: "HOURS_MUST_BE_INTEGER" })
  assert.throws(() => estimateService({ ...hourly, base_minutes: 600000 }, 2), { code: "DURATION_OUT_OF_RANGE" })
})

test("database rows map to stable frontend service, order, payment, and review objects", () => {
  const service = toService({
    id: 2,
    slug: "deep-clean",
    name: "Tổng vệ sinh",
    category_slug: "ve-sinh-nha-o",
    short_description: "Dọn sâu",
    description: "Toàn bộ nhà",
    scope: "[\"Phòng khách\"]",
    included: null,
    excluded: "[]",
    unit: "m²",
    price_mode: "area",
    base_price: 12000,
    min_quantity: 20,
    minutes_per_unit: 2,
    base_minutes: 30,
    image_url: null,
    is_active: 1,
  })
  assert.equal(service.category, "ve-sinh-nha-o")
  assert.equal(service.quantityLabel, "Diện tích (m²)")
  assert.deepEqual(service.scope, ["Phòng khách"])

  const order = toOrder({
    id: 8,
    booking_code: "DH00000008",
    customer_id: 3,
    service_id: 2,
    quantity: "30.00",
    address_snapshot: JSON.stringify({ name: "Lan", phone: "0900000000", address: "Địa chỉ mẫu", houseType: "nha-pho", area: 30, rooms: 3, floors: 2, hasPets: false }),
    scheduled_start: new Date("2030-01-01T10:00:00Z"),
    duration_snapshot: 90,
    special_request: "",
    line_total: "360000.00",
    status: "COMPLETED",
    job_status: "DONE",
    staff_user_id: 4,
    created_at: new Date("2029-12-01T08:00:00Z"),
  }, { history: [], cancelRequest: null })
  assert.equal(order.status, "completed")
  assert.equal(order.price, 360000)
  assert.equal(order.staffId, "4")

  assert.equal(toPayment({
    id: 9,
    payment_code: "TT00000009",
    booking_id: 8,
    amount: "360000.00",
    method: "TRANSFER",
    status: "PENDING",
    created_at: new Date("2029-12-01T08:00:00Z"),
    paid_at: null,
    refund_required: 0,
  }).status, "pending")

  const review = toReview({
    id: 10,
    booking_id: 8,
    customer_id: 3,
    employee_id: null,
    employee_user_id: null,
    service_id: 2,
    service_rating: 5,
    employee_rating: null,
    comment: "Tốt",
    created_at: new Date("2030-01-01T12:00:00Z"),
    is_hidden: 0,
    hidden_reason: null,
  })
  assert.equal(review.serviceRating, 5)
  assert.equal("staffRating" in review, false)
})
