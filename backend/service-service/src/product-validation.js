export const PRODUCT_STATUSES = new Set(["AVAILABLE", "OUT_OF_STOCK", "INACTIVE"])
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/

function text(value, field, { required = false, max = 5000 } = {}) {
  if (typeof value !== "string") {
    if (!required && value == null) return ""
    throw new ValidationError(`${field} không hợp lệ.`)
  }
  const cleaned = value.trim()
  if (required && !cleaned) throw new ValidationError(`${field} là bắt buộc.`)
  if (cleaned.length > max || CONTROL_CHARACTERS.test(cleaned)) throw new ValidationError(`${field} vượt giới hạn hoặc chứa ký tự không hợp lệ.`)
  return cleaned
}

function positiveId(value, field = "Mã") {
  const id = String(value ?? "")
  if (!/^[1-9]\d{0,19}$/.test(id)) throw new ValidationError(`${field} không hợp lệ.`)
  return id
}

function nonnegativeInteger(value, field) {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < 0) throw new ValidationError(`${field} phải là số nguyên không âm.`)
  return number
}

export function validateCategory(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ValidationError("Dữ liệu danh mục không hợp lệ.")
  if (typeof input.isActive !== "boolean") throw new ValidationError("Trạng thái danh mục không hợp lệ.")
  return {
    name: text(input.name, "Tên danh mục", { required: true, max: 100 }),
    description: text(input.description ?? "", "Mô tả danh mục", { max: 2000 }),
    isActive: input.isActive,
  }
}

function validateImageUrl(value) {
  const imageUrl = text(value, "Đường dẫn ảnh", { required: true, max: 500 })
  if (imageUrl.startsWith("/") && !imageUrl.startsWith("//") && !imageUrl.split("/").includes("..")) return imageUrl
  try {
    const url = new URL(imageUrl)
    if (url.protocol === "https:" && url.hostname && !url.username && !url.password) return imageUrl
  } catch {}
  throw new ValidationError("Ảnh cần dùng đường dẫn nội bộ hoặc URL HTTPS hợp lệ.")
}

function validateImages(value) {
  if (!Array.isArray(value) || value.length > 20) throw new ValidationError("Danh sách ảnh không hợp lệ (tối đa 20 ảnh).")
  const images = value.map((image, index) => {
    if (!image || typeof image !== "object" || Array.isArray(image)) throw new ValidationError("Thông tin ảnh không hợp lệ.")
    return {
      imageUrl: validateImageUrl(image.imageUrl),
      isPrimary: image.isPrimary === true,
      sortOrder: image.sortOrder === undefined ? index : nonnegativeInteger(image.sortOrder, "Thứ tự ảnh"),
    }
  })
  if (images.length && images.filter((image) => image.isPrimary).length !== 1) {
    throw new ValidationError("Chọn duy nhất một ảnh đại diện.")
  }
  return images
}

export function validateProduct(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ValidationError("Dữ liệu sản phẩm không hợp lệ.")
  const price = Number(input.price)
  if (!Number.isFinite(price) || price < 0 || price > 9999999999.99) throw new ValidationError("Giá bán không hợp lệ.")
  if (!PRODUCT_STATUSES.has(input.status)) throw new ValidationError("Trạng thái sản phẩm không hợp lệ.")
  return {
    categoryId: positiveId(input.categoryId, "Danh mục"),
    name: text(input.name, "Tên sản phẩm", { required: true, max: 200 }),
    description: text(input.description ?? "", "Mô tả sản phẩm", { max: 10000 }),
    unit: text(input.unit, "Đơn vị tính", { required: true, max: 50 }),
    price,
    status: input.status,
    inventory: {
      quantity: nonnegativeInteger(input.inventory?.quantity, "Tồn kho"),
      minStock: nonnegativeInteger(input.inventory?.minStock, "Mức tồn tối thiểu"),
    },
    images: validateImages(input.images ?? []),
  }
}

export class ValidationError extends Error {
  constructor(message) {
    super(message)
    this.name = "ValidationError"
    this.statusCode = 400
    this.code = "VALIDATION_ERROR"
  }
}

export { nonnegativeInteger, positiveId, validateImageUrl, validateImages };
