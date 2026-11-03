const express = require("express")
const { createSessionAuth } = require("../../shared/session-auth")
const { createProductOrdersRepository } = require("./product-orders-repository")
const {
  ORDER_STATUSES,
  ValidationError,
  nonnegativeInteger,
  positiveId,
  validateCreateOrder,
  validateOrderStatus,
} = require("./product-order-validation")

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)
}

function sendError(res, error) {
  const status = Number.isInteger(error.statusCode) && error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 500
  const code = error.code && status < 500 ? error.code : "INTERNAL_ERROR"
  const message = status < 500 ? error.message : "Không thể hoàn tất yêu cầu đơn mua. Vui lòng thử lại sau."
  return res.status(status).json({ error: { code, message } })
}

function createProductOrderRouter({ pool, authOptions }) {
  const router = express.Router()
  const repository = createProductOrdersRepository(pool)
  const requireCustomer = createSessionAuth({ pool, ...authOptions, requiredRole: "CUSTOMER" })
  const requireAdmin = createSessionAuth({ pool, ...authOptions, requiredRole: "ADMIN" })

  router.use(express.json({ limit: "64kb" }))

  router.post("/product-orders", requireCustomer, asyncRoute(async (req, res) => {
    const order = await repository.createOrder(req.authenticatedUser.id, validateCreateOrder(req.body))
    return res.status(201).json({ data: order })
  }))

  router.get("/admin/product-orders", requireAdmin, asyncRoute(async (req, res) => {
    const search = typeof req.query.search === "string" ? req.query.search.trim() : ""
    if (search.length > 100) throw new ValidationError("Từ khóa tìm kiếm quá dài.")
    const status = req.query.status ? String(req.query.status) : ""
    if (status && !ORDER_STATUSES.has(status)) throw new ValidationError("Trạng thái đơn mua không hợp lệ.")
    const page = nonnegativeInteger(req.query.page, "Trang", 1)
    const pageSize = nonnegativeInteger(req.query.pageSize, "Số dòng mỗi trang", 12)
    if (page < 1 || page > 100000 || pageSize < 1 || pageSize > 50) throw new ValidationError("Thông tin phân trang không hợp lệ.")
    const result = await repository.listOrders({ search, status, page, pageSize })
    return res.json({ data: result })
  }))

  router.get("/admin/product-orders/:id", requireAdmin, asyncRoute(async (req, res) => {
    const order = await repository.getOrder(positiveId(req.params.id))
    if (!order) return res.status(404).json({ error: { code: "ORDER_NOT_FOUND", message: "Không tìm thấy đơn mua sản phẩm." } })
    return res.json({ data: order })
  }))

  router.patch("/admin/product-orders/:id/status", requireAdmin, asyncRoute(async (req, res) => {
    const order = await repository.updateStatus(positiveId(req.params.id), validateOrderStatus(req.body))
    return res.json({ data: order })
  }))

  router.use((error, _req, res, _next) => sendError(res, error))
  return router
}

module.exports = { createProductOrderRouter, sendError }
