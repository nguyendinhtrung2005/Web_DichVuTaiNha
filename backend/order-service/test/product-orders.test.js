const assert = require("node:assert/strict")
const { once } = require("node:events")
const { generateKeyPairSync } = require("node:crypto")
const jwt = require("jsonwebtoken")
const test = require("node:test")
const { createApp } = require("../src/app")

class MemoryPool {
  constructor() {
    this.users = [
      { id: "1", full_name: "Quản trị", role: "ADMIN", status: "ACTIVE" },
      { id: "2", full_name: "Khách hàng", role: "CUSTOMER", status: "ACTIVE" },
    ]
    this.products = [{
      id: "11",
      name: "Nước lau sàn",
      unit: "chai",
      price: 1500.25,
      status: "AVAILABLE",
      quantity: 10,
      reservedQuantity: 0,
    }]
    this.orders = []
    this.items = []
    this.nextOrderId = 1
    this.nextItemId = 1
  }

  async execute(sql, params = []) {
    return this.run(sql, params)
  }

  async getConnection() {
    return new MemoryConnection(this)
  }

  async run(sql, params) {
    const query = sql.replace(/\s+/g, " ").trim()
    const [a, b, c, d, e, f, g] = params
    if (query.startsWith("SELECT id, role, status FROM users")) {
      return [this.users.filter((user) => String(user.id) === String(a)).map(({ id, role, status }) => ({ id, role, status })), []]
    }
    if (query.startsWith("SELECT p.id, p.name, p.unit, p.price, p.status")) {
      const ids = params.map(String)
      return [this.products.filter((product) => ids.includes(String(product.id))).map((product) => ({
        id: product.id,
        name: product.name,
        unit: product.unit,
        price: product.price,
        status: product.status,
        quantity: product.quantity,
        reservedQuantity: product.reservedQuantity,
      })), []]
    }
    if (query.startsWith("INSERT INTO product_orders")) {
      const id = String(this.nextOrderId++)
      const createdAt = new Date().toISOString()
      this.orders.push({
        id,
        user_id: String(a),
        status: "PENDING",
        recipient_name: b,
        recipient_phone: c,
        delivery_address: d,
        note: e,
        total_amount: Number(f),
        created_at: createdAt,
        updated_at: createdAt,
        completed_at: null,
        cancelled_at: null,
      })
      return [{ insertId: id, affectedRows: 1 }, []]
    }
    if (query.startsWith("INSERT INTO product_order_items")) {
      const id = String(this.nextItemId++)
      this.items.push({
        id,
        order_id: String(a),
        product_id: String(b),
        product_name_snapshot: c,
        product_unit_snapshot: d,
        unit_price_snapshot: Number(e),
        quantity: Number(f),
        line_total: Number(g),
      })
      return [{ insertId: id, affectedRows: 1 }, []]
    }
    if (query.startsWith("UPDATE product_inventory SET reserved_quantity = reserved_quantity +")) {
      const product = this.products.find((item) => String(item.id) === String(b))
      if (product) product.reservedQuantity += Number(a)
      return [{ affectedRows: product ? 1 : 0 }, []]
    }
    if (query.startsWith("SELECT po.id, po.user_id AS customerId") && query.includes("WHERE po.id = ? LIMIT 1")) {
      const order = this.orders.find((item) => String(item.id) === String(a))
      return [order ? [this.orderRow(order)] : [], []]
    }
    if (query.startsWith("SELECT id, product_id AS productId, product_name_snapshot AS name")) {
      return [this.items.filter((item) => String(item.order_id) === String(a)).map((item) => ({
        id: item.id,
        productId: item.product_id,
        name: item.product_name_snapshot,
        unit: item.product_unit_snapshot,
        unitPrice: item.unit_price_snapshot,
        quantity: item.quantity,
        lineTotal: item.line_total,
      })), []]
    }
    if (query.startsWith("SELECT COUNT(*) AS total FROM product_orders")) {
      return [[{ total: this.orders.length }], []]
    }
    if (query.startsWith("SELECT po.id, po.user_id AS customerId")) {
      const offset = Number(params[params.length - 1])
      const pageSize = Number(params[params.length - 2])
      return [this.orders.slice(offset, offset + pageSize).map((order) => this.orderRow(order)), []]
    }
    if (query.startsWith("SELECT id, status FROM product_orders WHERE id = ? FOR UPDATE")) {
      const order = this.orders.find((item) => String(item.id) === String(a))
      return [order ? [{ id: order.id, status: order.status }] : [], []]
    }
    if (query.startsWith("SELECT product_id AS productId, quantity FROM product_order_items")) {
      return [this.items.filter((item) => String(item.order_id) === String(a)).map((item) => ({
        productId: item.product_id,
        quantity: item.quantity,
      })), []]
    }
    if (query.startsWith("SELECT product_id AS productId, quantity, reserved_quantity AS reservedQuantity")) {
      const ids = params.map(String)
      return [this.products.filter((product) => ids.includes(String(product.id))).map((product) => ({
        productId: product.id,
        quantity: product.quantity,
        reservedQuantity: product.reservedQuantity,
      })), []]
    }
    if (query.startsWith("UPDATE product_inventory SET quantity = quantity -")) {
      const product = this.products.find((item) => String(item.id) === String(c))
      if (product) {
        product.quantity -= Number(a)
        product.reservedQuantity -= Number(b)
      }
      return [{ affectedRows: product ? 1 : 0 }, []]
    }
    if (query.startsWith("UPDATE products p JOIN product_inventory")) {
      const product = this.products.find((item) => String(item.id) === String(a))
      if (product && product.status !== "INACTIVE") {
        product.status = product.quantity - product.reservedQuantity <= 0 ? "OUT_OF_STOCK" : "AVAILABLE"
      }
      return [{ affectedRows: product ? 1 : 0 }, []]
    }
    if (query.startsWith("UPDATE product_inventory SET reserved_quantity = reserved_quantity -")) {
      const product = this.products.find((item) => String(item.id) === String(b))
      if (product) product.reservedQuantity -= Number(a)
      return [{ affectedRows: product ? 1 : 0 }, []]
    }
    if (query.startsWith("UPDATE product_orders SET status =")) {
      const order = this.orders.find((item) => String(item.id) === String(d))
      if (order) {
        order.status = a
        order.completed_at = b === "COMPLETED" ? new Date().toISOString() : null
        order.cancelled_at = c === "CANCELLED" ? new Date().toISOString() : null
        order.updated_at = new Date().toISOString()
      }
      return [{ affectedRows: order ? 1 : 0 }, []]
    }
    throw new Error(`Unexpected SQL in test: ${query}`)
  }

  orderRow(order) {
    const customer = this.users.find((item) => String(item.id) === String(order.user_id))
    return {
      id: order.id,
      customerId: order.user_id,
      customerName: customer.full_name,
      status: order.status,
      recipientName: order.recipient_name,
      recipientPhone: order.recipient_phone,
      deliveryAddress: order.delivery_address,
      note: order.note,
      totalAmount: order.total_amount,
      createdAt: order.created_at,
      updatedAt: order.updated_at,
      completedAt: order.completed_at,
      cancelledAt: order.cancelled_at,
      itemCount: this.items.filter((item) => String(item.order_id) === String(order.id)).length,
    }
  }
}

class MemoryConnection {
  constructor(pool) {
    this.pool = pool
    this.snapshot = null
  }

  async beginTransaction() {
    this.snapshot = structuredClone({
      products: this.pool.products,
      orders: this.pool.orders,
      items: this.pool.items,
      nextOrderId: this.pool.nextOrderId,
      nextItemId: this.pool.nextItemId,
    })
  }

  async commit() { this.snapshot = null }

  async rollback() {
    if (this.snapshot) Object.assign(this.pool, this.snapshot)
    this.snapshot = null
  }

  release() {}

  execute(sql, params = []) {
    return this.pool.run(sql, params)
  }
}

async function withApi(run) {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
  const pool = new MemoryPool()
  const app = createApp({
    pool,
    authOptions: {
      publicKey: publicKey.export({ type: "spki", format: "pem" }),
      issuer: "test-issuer",
      audience: "test-api",
    },
  })
  const server = app.listen(0, "127.0.0.1")
  await once(server, "listening")
  const base = `http://127.0.0.1:${server.address().port}/api/v1`
  const tokenFor = (subject) => jwt.sign({}, privateKey, {
    algorithm: "RS256",
    subject,
    issuer: "test-issuer",
    audience: "test-api",
    expiresIn: "5m",
  })
  try {
    await run({ base, pool, tokenFor })
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
}

test("customer orders reserve inventory and admin completion/cancellation settle it safely", async () => {
  await withApi(async ({ base, pool, tokenFor }) => {
    const customerHeaders = { authorization: `Bearer ${tokenFor("2")}`, "content-type": "application/json" }
    const adminHeaders = { authorization: `Bearer ${tokenFor("1")}`, "content-type": "application/json" }
    const orderInput = {
      recipientName: "Nguyen Van A",
      recipientPhone: "0901234567",
      deliveryAddress: "12 Nguyen Trai, Quan 1",
      note: "Giao giờ hành chính",
      items: [{ productId: "11", quantity: 3 }],
    }

    const createdResponse = await fetch(`${base}/product-orders`, {
      method: "POST",
      headers: customerHeaders,
      body: JSON.stringify(orderInput),
    })
    assert.equal(createdResponse.status, 201)
    const created = (await createdResponse.json()).data
    assert.equal(created.status, "PENDING")
    assert.equal(created.totalAmount, 4500.75)
    assert.equal(created.items[0].name, "Nước lau sàn")
    assert.equal(created.items[0].unit, "chai")
    assert.equal(pool.products[0].reservedQuantity, 3)

    const listedResponse = await fetch(`${base}/admin/product-orders?status=PENDING`, { headers: adminHeaders })
    assert.equal(listedResponse.status, 200)
    const listed = (await listedResponse.json()).data
    assert.equal(listed.total, 1)
    assert.equal(listed.items[0].id, created.id)

    const detailResponse = await fetch(`${base}/admin/product-orders/${created.id}`, { headers: adminHeaders })
    const detail = (await detailResponse.json()).data
    assert.equal(detail.deliveryAddress, orderInput.deliveryAddress)
    assert.equal(detail.items[0].unitPrice, 1500.25)
    assert.equal("scheduledAt" in detail, false)
    assert.equal("staffId" in detail, false)

    const completedResponse = await fetch(`${base}/admin/product-orders/${created.id}/status`, {
      method: "PATCH",
      headers: adminHeaders,
      body: JSON.stringify({ status: "COMPLETED" }),
    })
    assert.equal(completedResponse.status, 200)
    assert.equal(pool.products[0].quantity, 7)
    assert.equal(pool.products[0].reservedQuantity, 0)
    assert.equal((await completedResponse.json()).data.status, "COMPLETED")

    const invalidTransition = await fetch(`${base}/admin/product-orders/${created.id}/status`, {
      method: "PATCH",
      headers: adminHeaders,
      body: JSON.stringify({ status: "CANCELLED" }),
    })
    assert.equal(invalidTransition.status, 409)

    const secondOrder = await (await fetch(`${base}/product-orders`, {
      method: "POST",
      headers: customerHeaders,
      body: JSON.stringify({ ...orderInput, items: [{ productId: "11", quantity: 2 }] }),
    })).json()
    const cancelledResponse = await fetch(`${base}/admin/product-orders/${secondOrder.data.id}/status`, {
      method: "PATCH",
      headers: adminHeaders,
      body: JSON.stringify({ status: "CANCELLED" }),
    })
    assert.equal(cancelledResponse.status, 200)
    assert.equal((await cancelledResponse.json()).data.status, "CANCELLED")
    assert.equal(pool.products[0].quantity, 7)
    assert.equal(pool.products[0].reservedQuantity, 0)

    const stockExhaustingOrder = await (await fetch(`${base}/product-orders`, {
      method: "POST",
      headers: customerHeaders,
      body: JSON.stringify({ ...orderInput, items: [{ productId: "11", quantity: 7 }] }),
    })).json()
    assert.equal(pool.products[0].status, "OUT_OF_STOCK")
    const releaseResponse = await fetch(`${base}/admin/product-orders/${stockExhaustingOrder.data.id}/status`, {
      method: "PATCH",
      headers: adminHeaders,
      body: JSON.stringify({ status: "CANCELLED" }),
    })
    assert.equal(releaseResponse.status, 200)
    assert.equal(pool.products[0].quantity, 7)
    assert.equal(pool.products[0].reservedQuantity, 0)
    assert.equal(pool.products[0].status, "AVAILABLE")

    const insufficient = await fetch(`${base}/product-orders`, {
      method: "POST",
      headers: customerHeaders,
      body: JSON.stringify({ ...orderInput, items: [{ productId: "11", quantity: 8 }] }),
    })
    assert.equal(insufficient.status, 409)
    assert.equal(pool.orders.length, 3)
    assert.equal(pool.products[0].reservedQuantity, 0)
  })
})

test("only active customers can place orders and invalid delivery input is rejected", async () => {
  await withApi(async ({ base, pool, tokenFor }) => {
    const input = {
      recipientName: "Khách hàng",
      recipientPhone: "0901234567",
      deliveryAddress: "Địa chỉ giao hàng",
      items: [{ productId: "11", quantity: 1 }],
    }
    const denied = await fetch(`${base}/product-orders`, {
      method: "POST",
      headers: { authorization: `Bearer ${tokenFor("1")}`, "content-type": "application/json" },
      body: JSON.stringify(input),
    })
    assert.equal(denied.status, 403)

    const invalid = await fetch(`${base}/product-orders`, {
      method: "POST",
      headers: { authorization: `Bearer ${tokenFor("2")}`, "content-type": "application/json" },
      body: JSON.stringify({ ...input, deliveryAddress: "", items: [{ productId: "11", quantity: 1 }, { productId: "11", quantity: 1 }] }),
    })
    assert.equal(invalid.status, 400)
    assert.equal(pool.orders.length, 0)
    assert.equal(pool.products[0].reservedQuantity, 0)
  })
})
