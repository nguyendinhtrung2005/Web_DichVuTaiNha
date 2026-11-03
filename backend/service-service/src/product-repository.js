const { PRODUCT_STATUSES } = require("./product-validation")

const CATEGORY_COLUMNS = "id, name, description, is_active AS isActive, created_at AS createdAt, updated_at AS updatedAt"

function categoryFromRow(row) {
  return {
    id: String(row.id),
    name: row.name,
    description: row.description ?? "",
    isActive: Boolean(row.isActive),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function productFromRows(row, images) {
  const quantity = Number(row.quantity ?? 0)
  const reservedQuantity = Number(row.reservedQuantity ?? 0)
  return {
    id: String(row.id),
    categoryId: String(row.categoryId),
    categoryName: row.categoryName,
    name: row.name,
    description: row.description ?? "",
    unit: row.unit,
    price: Number(row.price),
    status: row.status,
    inventory: {
      quantity,
      reservedQuantity,
      availableQuantity: Math.max(0, quantity - reservedQuantity),
      minStock: Number(row.minStock ?? 0),
      updatedAt: row.inventoryUpdatedAt ?? null,
    },
    images,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

async function findImages(db, productIds) {
  if (!productIds.length) return new Map()
  const placeholders = productIds.map(() => "?").join(",")
  const [rows] = await db.execute(
    `SELECT id, product_id AS productId, image_url AS imageUrl, is_primary AS isPrimary, sort_order AS sortOrder
     FROM product_images WHERE product_id IN (${placeholders})
     ORDER BY is_primary DESC, sort_order ASC, id ASC`,
    productIds,
  )
  const images = new Map(productIds.map((id) => [String(id), []]))
  for (const row of rows) {
    images.get(String(row.productId)).push({
      id: String(row.id),
      imageUrl: row.imageUrl,
      isPrimary: Boolean(row.isPrimary),
      sortOrder: Number(row.sortOrder),
    })
  }
  return images
}

function createProductRepository(pool) {
  return {
    async listCategories() {
      const [rows] = await pool.execute(`SELECT ${CATEGORY_COLUMNS} FROM product_categories ORDER BY name ASC`)
      return rows.map(categoryFromRow)
    },

    async createCategory(input) {
      const [result] = await pool.execute(
        "INSERT INTO product_categories (name, description, is_active) VALUES (?, ?, ?)",
        [input.name, input.description || null, input.isActive],
      )
      return this.getCategory(result.insertId)
    },

    async getCategory(id) {
      const [rows] = await pool.execute(`SELECT ${CATEGORY_COLUMNS} FROM product_categories WHERE id = ?`, [id])
      return rows.length ? categoryFromRow(rows[0]) : null
    },

    async updateCategory(id, input) {
      const [result] = await pool.execute(
        "UPDATE product_categories SET name = ?, description = ?, is_active = ? WHERE id = ?",
        [input.name, input.description || null, input.isActive, id],
      )
      return result.affectedRows ? this.getCategory(id) : null
    },

    async deleteCategory(id) {
      const [products] = await pool.execute("SELECT id FROM products WHERE category_id = ? LIMIT 1", [id])
      if (products.length) return false
      const [result] = await pool.execute("DELETE FROM product_categories WHERE id = ?", [id])
      return result.affectedRows > 0
    },

    async listProducts({ search, categoryId, status, page, pageSize }) {
      const filters = []
      const values = []
      if (search) {
        filters.push("(p.name LIKE ? OR p.description LIKE ?)")
        values.push(`%${search}%`, `%${search}%`)
      }
      if (categoryId) {
        filters.push("p.category_id = ?")
        values.push(categoryId)
      }
      if (status) {
        filters.push("p.status = ?")
        values.push(status)
      }
      const where = filters.length ? `WHERE ${filters.join(" AND ")}` : ""
      const [counts] = await pool.execute(`SELECT COUNT(*) AS total FROM products p ${where}`, values)
      const offset = (page - 1) * pageSize
      const [rows] = await pool.execute(
        `SELECT p.id, p.category_id AS categoryId, c.name AS categoryName, p.name, p.description, p.unit,
                p.price, p.status, p.created_at AS createdAt, p.updated_at AS updatedAt,
                i.quantity, i.reserved_quantity AS reservedQuantity, i.min_stock AS minStock,
                i.updated_at AS inventoryUpdatedAt
         FROM products p
         JOIN product_categories c ON c.id = p.category_id
         LEFT JOIN product_inventory i ON i.product_id = p.id
         ${where}
         ORDER BY p.updated_at DESC, p.id DESC LIMIT ? OFFSET ?`,
        [...values, pageSize, offset],
      )
      const imageMap = await findImages(pool, rows.map((row) => row.id))
      return {
        items: rows.map((row) => productFromRows(row, imageMap.get(String(row.id)) || [])),
        page,
        pageSize,
        total: Number(counts[0].total),
      }
    },

    async getProduct(id, db = pool) {
      const [rows] = await db.execute(
        `SELECT p.id, p.category_id AS categoryId, c.name AS categoryName, p.name, p.description, p.unit,
                p.price, p.status, p.created_at AS createdAt, p.updated_at AS updatedAt,
                i.quantity, i.reserved_quantity AS reservedQuantity, i.min_stock AS minStock,
                i.updated_at AS inventoryUpdatedAt
         FROM products p
         JOIN product_categories c ON c.id = p.category_id
         LEFT JOIN product_inventory i ON i.product_id = p.id
         WHERE p.id = ?`,
        [id],
      )
      if (!rows.length) return null
      const imageMap = await findImages(db, [rows[0].id])
      return productFromRows(rows[0], imageMap.get(String(rows[0].id)) || [])
    },

    async saveProduct(input, id) {
      const connection = await pool.getConnection()
      try {
        await connection.beginTransaction()
        const [categories] = await connection.execute("SELECT id FROM product_categories WHERE id = ? FOR UPDATE", [input.categoryId])
        if (!categories.length) {
          const error = new Error("Danh mục không tồn tại.")
          error.statusCode = 404
          error.code = "CATEGORY_NOT_FOUND"
          throw error
        }

        let productId = id
        let reserved = 0
        if (id) {
          const [current] = await connection.execute(
            "SELECT id FROM products WHERE id = ? FOR UPDATE",
            [id],
          )
          if (!current.length) {
            const error = new Error("Sản phẩm không tồn tại.")
            error.statusCode = 404
            error.code = "PRODUCT_NOT_FOUND"
            throw error
          }
          const [inventory] = await connection.execute(
            "SELECT reserved_quantity AS reservedQuantity FROM product_inventory WHERE product_id = ? FOR UPDATE",
            [id],
          )
          reserved = Number(inventory[0]?.reservedQuantity ?? 0)
          if (input.inventory.quantity < reserved) {
            const error = new Error("Tồn kho mới không thể thấp hơn số lượng đang được giữ.")
            error.statusCode = 409
            error.code = "RESERVED_STOCK_CONFLICT"
            throw error
          }
          if (input.status === "AVAILABLE" && input.inventory.quantity <= reserved) {
            const error = new Error("Không thể đặt trạng thái còn hàng khi tồn khả dụng bằng 0.")
            error.statusCode = 409
            error.code = "PRODUCT_OUT_OF_STOCK"
            throw error
          }
          await connection.execute(
            "UPDATE products SET category_id = ?, name = ?, description = ?, unit = ?, price = ?, status = ? WHERE id = ?",
            [input.categoryId, input.name, input.description || null, input.unit, input.price, input.status, id],
          )
        } else {
          const [result] = await connection.execute(
            "INSERT INTO products (category_id, name, description, unit, price, status) VALUES (?, ?, ?, ?, ?, ?)",
            [input.categoryId, input.name, input.description || null, input.unit, input.price, input.status],
          )
          productId = result.insertId
          if (input.status === "AVAILABLE" && input.inventory.quantity <= 0) {
            const error = new Error("Sản phẩm còn hàng cần có tồn kho lớn hơn 0.")
            error.statusCode = 409
            error.code = "PRODUCT_OUT_OF_STOCK"
            throw error
          }
        }

        if (id) {
          await connection.execute(
            "UPDATE product_inventory SET quantity = ?, min_stock = ? WHERE product_id = ?",
            [input.inventory.quantity, input.inventory.minStock, productId],
          )
          await connection.execute("DELETE FROM product_images WHERE product_id = ?", [productId])
        } else {
          await connection.execute(
            "INSERT INTO product_inventory (product_id, quantity, reserved_quantity, min_stock) VALUES (?, ?, 0, ?)",
            [productId, input.inventory.quantity, input.inventory.minStock],
          )
        }
        for (const image of input.images) {
          await connection.execute(
            "INSERT INTO product_images (product_id, image_url, is_primary, sort_order) VALUES (?, ?, ?, ?)",
            [productId, image.imageUrl, image.isPrimary, image.sortOrder],
          )
        }
        await connection.commit()
        return await this.getProduct(productId, connection)
      } catch (error) {
        await connection.rollback()
        if (error.code === "ER_DUP_ENTRY") {
          error.statusCode = 409
          error.code = "DUPLICATE_CATEGORY"
          error.message = "Tên danh mục đã tồn tại."
        }
        throw error
      } finally {
        connection.release()
      }
    },

    async updateInventory(id, { quantity, minStock }) {
      const connection = await pool.getConnection()
      try {
        await connection.beginTransaction()
        const [rows] = await connection.execute(
          `SELECT p.status, i.reserved_quantity AS reservedQuantity
           FROM products p JOIN product_inventory i ON i.product_id = p.id
           WHERE p.id = ? FOR UPDATE`,
          [id],
        )
        if (!rows.length) {
          const error = new Error("Sản phẩm không tồn tại.")
          error.statusCode = 404
          error.code = "PRODUCT_NOT_FOUND"
          throw error
        }
        const reserved = Number(rows[0].reservedQuantity)
        if (quantity < reserved) {
          const error = new Error("Tồn kho mới không thể thấp hơn số lượng đang được giữ.")
          error.statusCode = 409
          error.code = "RESERVED_STOCK_CONFLICT"
          throw error
        }
        const status = rows[0].status === "INACTIVE" ? "INACTIVE" : quantity > reserved ? "AVAILABLE" : "OUT_OF_STOCK"
        await connection.execute(
          "UPDATE product_inventory SET quantity = ?, min_stock = ? WHERE product_id = ?",
          [quantity, minStock, id],
        )
        await connection.execute("UPDATE products SET status = ? WHERE id = ?", [status, id])
        await connection.commit()
        return await this.getProduct(id, connection)
      } catch (error) {
        await connection.rollback()
        throw error
      } finally {
        connection.release()
      }
    },

    async updateStatus(id, status) {
      if (!PRODUCT_STATUSES.has(status)) {
        const error = new Error("Trạng thái sản phẩm không hợp lệ.")
        error.statusCode = 400
        error.code = "VALIDATION_ERROR"
        throw error
      }
      const connection = await pool.getConnection()
      try {
        await connection.beginTransaction()
        const [rows] = await connection.execute(
          `SELECT p.id, i.quantity, i.reserved_quantity AS reservedQuantity
           FROM products p JOIN product_inventory i ON i.product_id = p.id
           WHERE p.id = ? FOR UPDATE`,
          [id],
        )
        if (!rows.length) {
          const error = new Error("Sản phẩm không tồn tại.")
          error.statusCode = 404
          error.code = "PRODUCT_NOT_FOUND"
          throw error
        }
        if (status === "AVAILABLE" && Number(rows[0].quantity) <= Number(rows[0].reservedQuantity)) {
          const error = new Error("Không thể đặt trạng thái còn hàng khi tồn khả dụng bằng 0.")
          error.statusCode = 409
          error.code = "PRODUCT_OUT_OF_STOCK"
          throw error
        }
        await connection.execute("UPDATE products SET status = ? WHERE id = ?", [status, id])
        await connection.commit()
        return await this.getProduct(id, connection)
      } catch (error) {
        await connection.rollback()
        throw error
      } finally {
        connection.release()
      }
    },

    async deleteProduct(id) {
      const connection = await pool.getConnection()
      try {
        await connection.beginTransaction()
        const [rows] = await connection.execute(
          "SELECT reserved_quantity AS reservedQuantity FROM product_inventory WHERE product_id = ? FOR UPDATE",
          [id],
        )
        if (!rows.length) {
          const error = new Error("Sản phẩm không tồn tại.")
          error.statusCode = 404
          error.code = "PRODUCT_NOT_FOUND"
          throw error
        }
        if (Number(rows[0].reservedQuantity) > 0) {
          const error = new Error("Không thể xóa sản phẩm đang có số lượng được giữ.")
          error.statusCode = 409
          error.code = "RESERVED_STOCK_CONFLICT"
          throw error
        }
        await connection.execute("DELETE FROM product_images WHERE product_id = ?", [id])
        await connection.execute("DELETE FROM product_inventory WHERE product_id = ?", [id])
        await connection.execute("DELETE FROM products WHERE id = ?", [id])
        await connection.commit()
        return true
      } catch (error) {
        await connection.rollback()
        throw error
      } finally {
        connection.release()
      }
    },
  }
}

module.exports = { createProductRepository, productFromRows }
