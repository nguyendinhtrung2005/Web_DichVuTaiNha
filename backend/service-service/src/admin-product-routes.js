const express = require("express")
const { createAdminAuth } = require("./admin-auth")
const { createProductRepository } = require("./product-repository")
const {
  PRODUCT_STATUSES,
  ValidationError,
  nonnegativeInteger,
  positiveId,
  validateCategory,
  validateProduct,
} = require("./product-validation")

function sendError(res, error) {
  if (error.code === "ER_DUP_ENTRY") {
    return res.status(409).json({ error: { code: "DUPLICATE_CATEGORY", message: "Tên danh mục đã tồn tại." } })
  }
  if (error.code === "ER_ROW_IS_REFERENCED_2") {
    return res.status(409).json({ error: { code: "PRODUCT_HISTORY_IN_USE", message: "Không thể xóa dữ liệu đang được danh mục, sản phẩm hoặc lịch sử đơn mua sử dụng." } })
  }
  const status = Number.isInteger(error.statusCode) && error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 500
  const code = error.code && status < 500 ? error.code : "INTERNAL_ERROR"
  const message = status < 500 ? error.message : "Không thể hoàn tất yêu cầu sản phẩm. Vui lòng thử lại sau."
  return res.status(status).json({ error: { code, message } })
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)
}

function createAdminProductRouter({ pool, authOptions }) {
  const router = express.Router()
  const repository = createProductRepository(pool)
  const requireAdmin = createAdminAuth({ pool, ...authOptions })

  router.use(express.json({ limit: "256kb" }))
  router.use(requireAdmin)

  router.get("/product-categories", asyncRoute(async (_req, res) => {
    res.json({ data: await repository.listCategories() })
  }))

  router.post("/product-categories", asyncRoute(async (req, res) => {
    const category = await repository.createCategory(validateCategory(req.body))
    res.status(201).json({ data: category })
  }))

  router.put("/product-categories/:id", asyncRoute(async (req, res) => {
    const id = positiveId(req.params.id, "Mã danh mục")
    const category = await repository.updateCategory(id, validateCategory(req.body))
    if (!category) return res.status(404).json({ error: { code: "CATEGORY_NOT_FOUND", message: "Danh mục không tồn tại." } })
    return res.json({ data: category })
  }))

  router.delete("/product-categories/:id", asyncRoute(async (req, res) => {
    const id = positiveId(req.params.id, "Mã danh mục")
    const deleted = await repository.deleteCategory(id)
    if (!deleted) return res.status(409).json({ error: { code: "CATEGORY_IN_USE", message: "Danh mục không tồn tại hoặc đang được sản phẩm sử dụng." } })
    return res.status(204).end()
  }))

  router.get("/products", asyncRoute(async (req, res) => {
    const search = typeof req.query.search === "string" ? req.query.search.trim() : ""
    if (search.length > 200) throw new ValidationError("Từ khóa tìm kiếm quá dài.")
    const categoryId = req.query.categoryId ? positiveId(req.query.categoryId, "Mã danh mục") : ""
    const status = req.query.status ? String(req.query.status) : ""
    if (status && !PRODUCT_STATUSES.has(status)) throw new ValidationError("Trạng thái sản phẩm không hợp lệ.")
    const page = req.query.page === undefined ? 1 : nonnegativeInteger(req.query.page, "Trang")
    const pageSize = req.query.pageSize === undefined ? 12 : nonnegativeInteger(req.query.pageSize, "Số dòng mỗi trang")
    if (page < 1 || page > 100000 || pageSize < 1 || pageSize > 50) throw new ValidationError("Thông tin phân trang không hợp lệ.")
    res.json({ data: await repository.listProducts({ search, categoryId, status, page, pageSize }) })
  }))

  router.post("/products", asyncRoute(async (req, res) => {
    const product = await repository.saveProduct(validateProduct(req.body))
    res.status(201).json({ data: product })
  }))

  router.get("/products/:id", asyncRoute(async (req, res) => {
    const id = positiveId(req.params.id, "Mã sản phẩm")
    const product = await repository.getProduct(id)
    if (!product) return res.status(404).json({ error: { code: "PRODUCT_NOT_FOUND", message: "Sản phẩm không tồn tại." } })
    return res.json({ data: product })
  }))

  router.put("/products/:id", asyncRoute(async (req, res) => {
    const id = positiveId(req.params.id, "Mã sản phẩm")
    const product = await repository.saveProduct(validateProduct(req.body), id)
    return res.json({ data: product })
  }))

  router.patch("/products/:id/status", asyncRoute(async (req, res) => {
    const id = positiveId(req.params.id, "Mã sản phẩm")
    const product = await repository.updateStatus(id, req.body?.status)
    return res.json({ data: product })
  }))

  router.patch("/products/:id/inventory", asyncRoute(async (req, res) => {
    const id = positiveId(req.params.id, "Mã sản phẩm")
    const inventory = {
      quantity: nonnegativeInteger(req.body?.quantity, "Tồn kho"),
      minStock: nonnegativeInteger(req.body?.minStock, "Mức tồn tối thiểu"),
    }
    const product = await repository.updateInventory(id, inventory)
    return res.json({ data: product })
  }))

  router.delete("/products/:id", asyncRoute(async (req, res) => {
    const id = positiveId(req.params.id, "Mã sản phẩm")
    await repository.deleteProduct(id)
    return res.status(204).end()
  }))

  router.use((error, _req, res, _next) => sendError(res, error))
  return router
}

module.exports = { createAdminProductRouter, sendError }
