const MAX_TOTAL_CENTS = 999999999999

function asMoney(value) {
  const cents = Math.round(Number(value) * 100)
  return Number.isSafeInteger(cents) ? cents : NaN
}

function moneyValue(cents) {
  return (cents / 100).toFixed(2)
}

function mapOrder(row) {
  return {
    id: String(row.id),
    customerId: String(row.customerId),
    customerName: row.customerName,
    status: row.status,
    recipientName: row.recipientName,
    recipientPhone: row.recipientPhone,
    deliveryAddress: row.deliveryAddress,
    note: row.note || "",
    totalAmount: Number(row.totalAmount),
    itemCount: Number(row.itemCount ?? row.items?.length ?? 0),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt,
    cancelledAt: row.cancelledAt,
    items: row.items || [],
  }
}

function createProductOrdersRepository(pool) {
  async function refreshProductStatus(connection, productId) {
    await connection.execute(
      `UPDATE products p JOIN product_inventory i ON i.product_id = p.id
       SET p.status = CASE
         WHEN p.status = 'INACTIVE' THEN 'INACTIVE'
         WHEN i.quantity - i.reserved_quantity <= 0 THEN 'OUT_OF_STOCK'
         ELSE 'AVAILABLE'
       END
       WHERE p.id = ?`,
      [productId],
    )
  }

  async function getOrder(id, connection = pool) {
    const [orders] = await connection.execute(
      `SELECT po.id, po.user_id AS customerId, u.full_name AS customerName, po.status,
              po.recipient_name AS recipientName, po.recipient_phone AS recipientPhone,
              po.delivery_address AS deliveryAddress, po.note, po.total_amount AS totalAmount,
              po.created_at AS createdAt, po.updated_at AS updatedAt,
              po.completed_at AS completedAt, po.cancelled_at AS cancelledAt,
              (SELECT COUNT(*) FROM product_order_items poi WHERE poi.order_id = po.id) AS itemCount
       FROM product_orders po JOIN users u ON u.id = po.user_id
       WHERE po.id = ? LIMIT 1`,
      [id],
    )
    if (!orders.length) return null
    const [items] = await connection.execute(
      `SELECT id, product_id AS productId, product_name_snapshot AS name,
              product_unit_snapshot AS unit, unit_price_snapshot AS unitPrice,
              quantity, line_total AS lineTotal
       FROM product_order_items WHERE order_id = ? ORDER BY id`,
      [id],
    )
    return mapOrder({
      ...orders[0],
      items: items.map((item) => ({
        id: String(item.id),
        productId: String(item.productId),
        name: item.name,
        unit: item.unit,
        unitPrice: Number(item.unitPrice),
        quantity: Number(item.quantity),
        lineTotal: Number(item.lineTotal),
      })),
    })
  }

  return {
    async createOrder(customerId, input) {
      const connection = await pool.getConnection()
      try {
        await connection.beginTransaction()
        const ids = input.items.map((item) => item.productId)
        const placeholders = ids.map(() => "?").join(", ")
        const [products] = await connection.execute(
          `SELECT p.id, p.name, p.unit, p.price, p.status,
                  i.quantity, i.reserved_quantity AS reservedQuantity
           FROM products p JOIN product_inventory i ON i.product_id = p.id
           WHERE p.id IN (${placeholders}) ORDER BY p.id FOR UPDATE`,
          ids,
        )
        if (products.length !== input.items.length) {
          const error = new Error("Một hoặc nhiều sản phẩm không còn tồn tại.")
          error.statusCode = 404
          error.code = "PRODUCT_NOT_FOUND"
          throw error
        }
        const productsById = new Map(products.map((product) => [String(product.id), product]))
        let totalCents = 0
        const snapshots = input.items.map((item) => {
          const product = productsById.get(item.productId)
          if (product.status !== "AVAILABLE") {
            const error = new Error(`Sản phẩm "${product.name}" hiện không mở bán.`)
            error.statusCode = 409
            error.code = "PRODUCT_UNAVAILABLE"
            throw error
          }
          const available = Number(product.quantity) - Number(product.reservedQuantity)
          if (available < item.quantity) {
            const error = new Error(`Sản phẩm "${product.name}" không đủ tồn kho khả dụng.`)
            error.statusCode = 409
            error.code = "INSUFFICIENT_STOCK"
            throw error
          }
          const unitPriceCents = asMoney(product.price)
          const lineTotalCents = unitPriceCents * item.quantity
          if (!Number.isSafeInteger(lineTotalCents) || lineTotalCents < 0) {
            const error = new Error("Giá trị đơn mua vượt giới hạn hỗ trợ.")
            error.statusCode = 400
            error.code = "ORDER_TOTAL_INVALID"
            throw error
          }
          totalCents += lineTotalCents
          return { ...item, product, unitPriceCents, lineTotalCents }
        })
        if (!Number.isSafeInteger(totalCents) || totalCents > MAX_TOTAL_CENTS) {
          const error = new Error("Tổng tiền đơn mua vượt giới hạn hỗ trợ.")
          error.statusCode = 400
          error.code = "ORDER_TOTAL_INVALID"
          throw error
        }

        const [created] = await connection.execute(
          `INSERT INTO product_orders
             (user_id, status, recipient_name, recipient_phone, delivery_address, note, total_amount)
           VALUES (?, 'PENDING', ?, ?, ?, ?, ?)`,
          [customerId, input.recipientName, input.recipientPhone, input.deliveryAddress, input.note || null, moneyValue(totalCents)],
        )
        const orderId = String(created.insertId)
        for (const snapshot of snapshots) {
          await connection.execute(
            `INSERT INTO product_order_items
               (order_id, product_id, product_name_snapshot, product_unit_snapshot,
                unit_price_snapshot, quantity, line_total)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [orderId, snapshot.productId, snapshot.product.name, snapshot.product.unit,
              moneyValue(snapshot.unitPriceCents), snapshot.quantity, moneyValue(snapshot.lineTotalCents)],
          )
          await connection.execute(
            "UPDATE product_inventory SET reserved_quantity = reserved_quantity + ? WHERE product_id = ?",
            [snapshot.quantity, snapshot.productId],
          )
          await refreshProductStatus(connection, snapshot.productId)
        }
        await connection.commit()
        return await getOrder(orderId)
      } catch (error) {
        await connection.rollback()
        throw error
      } finally {
        connection.release()
      }
    },

    async listOrders({ search, status, page, pageSize }) {
      const filters = []
      const params = []
      if (search) {
        filters.push("(CAST(po.id AS CHAR) LIKE ? OR u.full_name LIKE ? OR po.recipient_phone LIKE ?)")
        const term = `%${search}%`
        params.push(term, term, term)
      }
      if (status) {
        filters.push("po.status = ?")
        params.push(status)
      }
      const where = filters.length ? `WHERE ${filters.join(" AND ")}` : ""
      const [[{ total }]] = await pool.execute(
        `SELECT COUNT(*) AS total FROM product_orders po JOIN users u ON u.id = po.user_id ${where}`,
        params,
      )
      const offset = (page - 1) * pageSize
      const [rows] = await pool.execute(
        `SELECT po.id, po.user_id AS customerId, u.full_name AS customerName, po.status,
                po.recipient_name AS recipientName, po.recipient_phone AS recipientPhone,
                po.delivery_address AS deliveryAddress, po.note, po.total_amount AS totalAmount,
                po.created_at AS createdAt, po.updated_at AS updatedAt,
                po.completed_at AS completedAt, po.cancelled_at AS cancelledAt,
                (SELECT COUNT(*) FROM product_order_items poi WHERE poi.order_id = po.id) AS itemCount
         FROM product_orders po JOIN users u ON u.id = po.user_id ${where}
         ORDER BY po.created_at DESC, po.id DESC LIMIT ? OFFSET ?`,
        [...params, pageSize, offset],
      )
      return { items: rows.map((row) => mapOrder(row)), page, pageSize, total: Number(total) }
    },

    getOrder,

    async updateStatus(id, nextStatus) {
      const connection = await pool.getConnection()
      try {
        await connection.beginTransaction()
        const [orders] = await connection.execute(
          "SELECT id, status FROM product_orders WHERE id = ? FOR UPDATE",
          [id],
        )
        if (!orders.length) {
          const error = new Error("Không tìm thấy đơn mua sản phẩm.")
          error.statusCode = 404
          error.code = "ORDER_NOT_FOUND"
          throw error
        }
        if (orders[0].status !== "PENDING" || !["COMPLETED", "CANCELLED"].includes(nextStatus)) {
          const error = new Error("Chỉ có thể hoàn tất hoặc hủy đơn đang chờ xử lý.")
          error.statusCode = 409
          error.code = "ORDER_TRANSITION_INVALID"
          throw error
        }
        const [items] = await connection.execute(
          "SELECT product_id AS productId, quantity FROM product_order_items WHERE order_id = ? ORDER BY product_id",
          [id],
        )
        if (!items.length) {
          const error = new Error("Đơn mua không có chi tiết sản phẩm hợp lệ.")
          error.statusCode = 409
          error.code = "ORDER_ITEMS_MISSING"
          throw error
        }
        const productIds = items.map((item) => String(item.productId))
        const placeholders = productIds.map(() => "?").join(", ")
        const [inventoryRows] = await connection.execute(
          `SELECT product_id AS productId, quantity, reserved_quantity AS reservedQuantity
           FROM product_inventory WHERE product_id IN (${placeholders}) ORDER BY product_id FOR UPDATE`,
          productIds,
        )
        const inventoryById = new Map(inventoryRows.map((row) => [String(row.productId), row]))
        if (items.some((item) => Number(inventoryById.get(String(item.productId))?.reservedQuantity) < Number(item.quantity))) {
          const error = new Error("Tồn kho đã giữ không khớp với chi tiết đơn; không thể cập nhật trạng thái.")
          error.statusCode = 409
          error.code = "RESERVED_STOCK_CONFLICT"
          throw error
        }
        for (const item of items) {
          const productId = String(item.productId)
          if (nextStatus === "COMPLETED") {
            const inventory = inventoryById.get(productId)
            if (Number(inventory.quantity) < Number(item.quantity)) {
              const error = new Error("Tồn thực tế không đủ để hoàn tất đơn.")
              error.statusCode = 409
              error.code = "INSUFFICIENT_STOCK"
              throw error
            }
            await connection.execute(
              `UPDATE product_inventory
               SET quantity = quantity - ?, reserved_quantity = reserved_quantity - ?
               WHERE product_id = ?`,
              [item.quantity, item.quantity, productId],
            )
            await refreshProductStatus(connection, productId)
          } else {
            await connection.execute(
              "UPDATE product_inventory SET reserved_quantity = reserved_quantity - ? WHERE product_id = ?",
              [item.quantity, productId],
            )
            await refreshProductStatus(connection, productId)
          }
        }
        await connection.execute(
          `UPDATE product_orders SET status = ?,
             completed_at = IF(? = 'COMPLETED', CURRENT_TIMESTAMP, NULL),
             cancelled_at = IF(? = 'CANCELLED', CURRENT_TIMESTAMP, NULL)
           WHERE id = ?`,
          [nextStatus, nextStatus, nextStatus, id],
        )
        await connection.commit()
        return await getOrder(id)
      } catch (error) {
        await connection.rollback()
        throw error
      } finally {
        connection.release()
      }
    },
  }
}

export { createProductOrdersRepository }
