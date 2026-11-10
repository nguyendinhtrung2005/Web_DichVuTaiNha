import assert from "node:assert/strict";
import { once } from "node:events";
import { generateKeyPairSync } from "node:crypto";
import jwt from "jsonwebtoken";
import test from "node:test";
import { createApp } from "../src/app.js";

function rowCategory(category) {
  return {
    id: category.id,
    name: category.name,
    description: category.description,
    isActive: category.is_active,
    createdAt: category.created_at,
    updatedAt: category.updated_at,
  }
}

class MemoryPool {
  constructor() {
    this.users = [{ id: 7, role: "ADMIN", status: "ACTIVE" }]
    this.categories = []
    this.products = []
    this.images = []
    this.inventory = []
    this.nextCategoryId = 1
    this.nextProductId = 1
  }

  async execute(sql, params = []) {
    return new MemoryConnection(this).execute(sql, params)
  }

  async getConnection() {
    return new MemoryConnection(this)
  }
}

class MemoryConnection {
  constructor(pool) {
    this.pool = pool
    this.backup = null
  }

  async beginTransaction() {
    this.backup = structuredClone({
      categories: this.pool.categories,
      products: this.pool.products,
      images: this.pool.images,
      inventory: this.pool.inventory,
      nextCategoryId: this.pool.nextCategoryId,
      nextProductId: this.pool.nextProductId,
    })
  }

  async commit() { this.backup = null }

  async rollback() {
    if (!this.backup) return
    Object.assign(this.pool, this.backup)
    this.backup = null
  }

  release() {}

  async execute(sql, params = []) {
    const query = sql.replace(/\s+/g, " ").trim()
    const [a, b, c, d, e, f, g] = params
    if (query.startsWith("SELECT id, role, status FROM users")) {
      return [[...this.pool.users.filter((user) => String(user.id) === String(a))], []]
    }
    if (query.includes("FROM product_categories ORDER BY name")) {
      return [this.pool.categories.map(rowCategory), []]
    }
    if (query.includes("SELECT id, name, description, is_active AS isActive") && query.includes("WHERE id = ?")) {
      const category = this.pool.categories.find((item) => String(item.id) === String(a))
      return [category ? [rowCategory(category)] : [], []]
    }
    if (query.startsWith("SELECT id FROM product_categories WHERE id = ?")) {
      return [this.pool.categories.some((item) => String(item.id) === String(a)) ? [{ id: a }] : [], []]
    }
    if (query.startsWith("INSERT INTO product_categories")) {
      if (this.pool.categories.some((item) => item.name === a)) {
        const error = new Error("duplicate")
        error.code = "ER_DUP_ENTRY"
        throw error
      }
      const id = this.pool.nextCategoryId++
      const date = new Date().toISOString()
      this.pool.categories.push({ id, name: a, description: b, is_active: c, created_at: date, updated_at: date })
      return [{ insertId: id, affectedRows: 1 }, []]
    }
    if (query.startsWith("UPDATE product_categories SET")) {
      const category = this.pool.categories.find((item) => String(item.id) === String(d))
      if (!category) return [{ affectedRows: 0 }, []]
      Object.assign(category, { name: a, description: b, is_active: c, updated_at: new Date().toISOString() })
      return [{ affectedRows: 1 }, []]
    }
    if (query.startsWith("SELECT id FROM products WHERE category_id = ?")) {
      return [this.pool.products.filter((item) => String(item.category_id) === String(a)).slice(0, 1).map((item) => ({ id: item.id })), []]
    }
    if (query.startsWith("DELETE FROM product_categories")) {
      const oldLength = this.pool.categories.length
      this.pool.categories = this.pool.categories.filter((item) => String(item.id) !== String(a))
      return [{ affectedRows: oldLength - this.pool.categories.length }, []]
    }
    if (query.startsWith("SELECT COUNT(*) AS total FROM products")) {
      return [[{ total: this.pool.products.length }], []]
    }
    if (query.startsWith("SELECT p.id, p.category_id AS categoryId, c.name AS categoryName")) {
      const productId = query.includes("WHERE p.id = ?") ? a : null
      const rows = this.pool.products
        .filter((product) => productId === null || String(product.id) === String(productId))
        .map((product) => this.productRow(product))
      return [rows, []]
    }
    if (query.startsWith("SELECT id, product_id AS productId, image_url AS imageUrl")) {
      const ids = params.map(String)
      return [this.pool.images.filter((image) => ids.includes(String(image.product_id))).map((image) => ({
        id: image.id,
        productId: image.product_id,
        imageUrl: image.image_url,
        isPrimary: image.is_primary,
        sortOrder: image.sort_order,
      })), []]
    }
    if (query.startsWith("SELECT id FROM products WHERE id = ? FOR UPDATE")) {
      return [this.pool.products.some((item) => String(item.id) === String(a)) ? [{ id: a }] : [], []]
    }
    if (query.startsWith("SELECT reserved_quantity AS reservedQuantity FROM product_inventory")) {
      const inventory = this.pool.inventory.find((item) => String(item.product_id) === String(a))
      return [inventory ? [{ reservedQuantity: inventory.reserved_quantity }] : [], []]
    }
    if (query.startsWith("SELECT p.status, i.reserved_quantity AS reservedQuantity")) {
      const product = this.pool.products.find((item) => String(item.id) === String(a))
      const inventory = this.pool.inventory.find((item) => String(item.product_id) === String(a))
      return [product && inventory ? [{ status: product.status, reservedQuantity: inventory.reserved_quantity }] : [], []]
    }
    if (query.startsWith("SELECT p.id, i.quantity, i.reserved_quantity AS reservedQuantity")) {
      const product = this.pool.products.find((item) => String(item.id) === String(a))
      const inventory = this.pool.inventory.find((item) => String(item.product_id) === String(a))
      return [product && inventory ? [{ id: product.id, quantity: inventory.quantity, reservedQuantity: inventory.reserved_quantity }] : [], []]
    }
    if (query.startsWith("INSERT INTO products")) {
      const id = this.pool.nextProductId++
      const date = new Date().toISOString()
      this.pool.products.push({ id, category_id: a, name: b, description: c, unit: d, price: e, status: f, created_at: date, updated_at: date })
      return [{ insertId: id, affectedRows: 1 }, []]
    }
    if (query.startsWith("UPDATE products SET category_id")) {
      const product = this.pool.products.find((item) => String(item.id) === String(g))
      if (!product) return [{ affectedRows: 0 }, []]
      Object.assign(product, { category_id: a, name: b, description: c, unit: d, price: e, status: params[5] })
      product.updated_at = new Date().toISOString()
      return [{ affectedRows: 1 }, []]
    }
    if (query.startsWith("INSERT INTO product_inventory")) {
      this.pool.inventory.push({ product_id: a, quantity: b, reserved_quantity: 0, min_stock: c, updated_at: new Date().toISOString() })
      return [{ insertId: this.pool.inventory.length, affectedRows: 1 }, []]
    }
    if (query.startsWith("UPDATE product_inventory SET")) {
      const inventory = this.pool.inventory.find((item) => String(item.product_id) === String(c))
      if (!inventory) return [{ affectedRows: 0 }, []]
      Object.assign(inventory, { quantity: a, min_stock: b, updated_at: new Date().toISOString() })
      return [{ affectedRows: 1 }, []]
    }
    if (query.startsWith("DELETE FROM product_images")) {
      const oldLength = this.pool.images.length
      this.pool.images = this.pool.images.filter((item) => String(item.product_id) !== String(a))
      return [{ affectedRows: oldLength - this.pool.images.length }, []]
    }
    if (query.startsWith("INSERT INTO product_images")) {
      this.pool.images.push({ id: this.pool.images.length + 1, product_id: a, image_url: b, is_primary: c, sort_order: d })
      return [{ insertId: this.pool.images.length, affectedRows: 1 }, []]
    }
    if (query.startsWith("UPDATE products SET status")) {
      const product = this.pool.products.find((item) => String(item.id) === String(b))
      if (!product) return [{ affectedRows: 0 }, []]
      product.status = a
      return [{ affectedRows: 1 }, []]
    }
    if (query.startsWith("DELETE FROM product_inventory")) {
      const oldLength = this.pool.inventory.length
      this.pool.inventory = this.pool.inventory.filter((item) => String(item.product_id) !== String(a))
      return [{ affectedRows: oldLength - this.pool.inventory.length }, []]
    }
    if (query.startsWith("DELETE FROM products")) {
      const oldLength = this.pool.products.length
      this.pool.products = this.pool.products.filter((item) => String(item.id) !== String(a))
      return [{ affectedRows: oldLength - this.pool.products.length }, []]
    }
    throw new Error(`Unexpected SQL in test: ${query}`)
  }

  productRow(product) {
    const category = this.pool.categories.find((item) => String(item.id) === String(product.category_id))
    const inventory = this.pool.inventory.find((item) => String(item.product_id) === String(product.id))
    return {
      id: product.id,
      categoryId: product.category_id,
      categoryName: category?.name ?? "",
      name: product.name,
      description: product.description,
      unit: product.unit,
      price: product.price,
      status: product.status,
      createdAt: product.created_at,
      updatedAt: product.updated_at,
      quantity: inventory?.quantity ?? 0,
      reservedQuantity: inventory?.reserved_quantity ?? 0,
      minStock: inventory?.min_stock ?? 0,
      inventoryUpdatedAt: inventory?.updated_at ?? null,
    }
  }
}

async function withApi(run) {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
  const pool = new MemoryPool()
  const app = createApp({
    pool,
    authOptions: { publicKey: publicKey.export({ type: "spki", format: "pem" }), issuer: "test-issuer", audience: "test-api" },
  })
  const server = app.listen(0, "127.0.0.1")
  await once(server, "listening")
  const base = `http://127.0.0.1:${server.address().port}/api/v1/admin`
  const tokenFor = (subject = "7") => jwt.sign({}, privateKey, {
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

test("admin APIs reject missing and non-admin sessions", async () => {
  await withApi(async ({ base, pool, tokenFor }) => {
    const missing = await fetch(`${base}/products`)
    assert.equal(missing.status, 401)
    pool.users[0].role = "EMPLOYEE"
    const forbidden = await fetch(`${base}/products`, { headers: { authorization: `Bearer ${tokenFor()}` } })
    assert.equal(forbidden.status, 403)
  })
})

test("admin can create, list, update, and delete product categories and products", async () => {
  await withApi(async ({ base, pool, tokenFor }) => {
    const headers = { authorization: `Bearer ${tokenFor()}`, "content-type": "application/json" }
    const categoryResponse = await fetch(`${base}/product-categories`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Chăm sóc nhà cửa", description: "Sản phẩm vệ sinh", isActive: true }),
    })
    assert.equal(categoryResponse.status, 201)
    const category = (await categoryResponse.json()).data
    const categoryList = await fetch(`${base}/product-categories`, { headers })
    assert.equal((await categoryList.json()).data.length, 1)

    const input = {
      categoryId: category.id,
      name: "Dung dịch vệ sinh",
      description: "Dùng tại nhà",
      unit: "chai",
      price: 85000,
      status: "AVAILABLE",
      inventory: { quantity: 10, minStock: 2 },
      images: [{ imageUrl: "https://cleanhome.example/image.png", isPrimary: true, sortOrder: 0 }],
    }
    const createdResponse = await fetch(`${base}/products`, { method: "POST", headers, body: JSON.stringify(input) })
    assert.equal(createdResponse.status, 201)
    const created = (await createdResponse.json()).data
    assert.equal(created.inventory.availableQuantity, 10)
    assert.equal(created.images[0].isPrimary, true)

    const listResponse = await fetch(`${base}/products?page=1&pageSize=10`, { headers })
    assert.equal((await listResponse.json()).data.total, 1)
    const updateResponse = await fetch(`${base}/products/${created.id}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ ...input, name: "Dung dịch vệ sinh mới", price: 90000 }),
    })
    assert.equal(updateResponse.status, 200)
    assert.equal((await updateResponse.json()).data.name, "Dung dịch vệ sinh mới")

    const categoryInUse = await fetch(`${base}/product-categories/${category.id}`, { method: "DELETE", headers })
    assert.equal(categoryInUse.status, 409)
    const deletedProduct = await fetch(`${base}/products/${created.id}`, { method: "DELETE", headers })
    assert.equal(deletedProduct.status, 204)
    const deletedCategory = await fetch(`${base}/product-categories/${category.id}`, { method: "DELETE", headers })
    assert.equal(deletedCategory.status, 204)
  })
})

test("inventory updates are transactional and cannot undercut reserved stock", async () => {
  await withApi(async ({ base, pool, tokenFor }) => {
    const headers = { authorization: `Bearer ${tokenFor()}`, "content-type": "application/json" }
    const category = await (await fetch(`${base}/product-categories`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Hóa phẩm", description: "", isActive: true }),
    })).json()
    const created = await (await fetch(`${base}/products`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        categoryId: category.data.id,
        name: "Nước lau sàn",
        description: "",
        unit: "chai",
        price: 50000,
        status: "AVAILABLE",
        inventory: { quantity: 8, minStock: 1 },
        images: [],
      }),
    })).json()
    const inventory = pool.inventory.find((item) => String(item.product_id) === created.data.id)
    inventory.reserved_quantity = 3

    const conflict = await fetch(`${base}/products/${created.data.id}/inventory`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ quantity: 2, minStock: 1 }),
    })
    assert.equal(conflict.status, 409)
    assert.equal(inventory.quantity, 8)

    const saved = await fetch(`${base}/products/${created.data.id}/inventory`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ quantity: 5, minStock: 1 }),
    })
    assert.equal(saved.status, 200)
    const updated = (await saved.json()).data
    assert.equal(updated.inventory.reservedQuantity, 3)
    assert.equal(updated.inventory.availableQuantity, 2)
    assert.equal(updated.status, "AVAILABLE")
  })
})

test("invalid product input is rejected before SQL mutation", async () => {
  await withApi(async ({ base, pool, tokenFor }) => {
    const response = await fetch(`${base}/products`, {
      method: "POST",
      headers: { authorization: `Bearer ${tokenFor()}`, "content-type": "application/json" },
      body: JSON.stringify({
        categoryId: "1",
        name: "Bad image",
        unit: "chai",
        price: -1,
        status: "AVAILABLE",
        inventory: { quantity: 1, minStock: 0 },
        images: [],
      }),
    })
    assert.equal(response.status, 400)
    assert.equal(pool.products.length, 0)
  })
})
