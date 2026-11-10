const ORDER_STATUSES = new Set(["PENDING", "COMPLETED", "CANCELLED"])

class ValidationError extends Error {
  constructor(message) {
    super(message)
    this.statusCode = 400
    this.code = "VALIDATION_ERROR"
  }
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError(`${label} không hợp lệ.`)
  }
  return value
}

function positiveId(value, label = "Mã đơn") {
  const text = String(value ?? "")
  if (!/^[1-9]\d{0,19}$/.test(text)) throw new ValidationError(`${label} không hợp lệ.`)
  if (BigInt(text) > 9223372036854775807n) throw new ValidationError(`${label} không hợp lệ.`)
  return text
}

function validateCreateOrder(value) {
  const input = object(value, "Thông tin đơn mua")
  const recipientName = typeof input.recipientName === "string" ? input.recipientName.trim() : ""
  const recipientPhone = typeof input.recipientPhone === "string" ? input.recipientPhone.trim() : ""
  const deliveryAddress = typeof input.deliveryAddress === "string" ? input.deliveryAddress.trim() : ""
  const note = input.note === undefined || input.note === null ? "" : typeof input.note === "string" ? input.note.trim() : null
  if (!recipientName || recipientName.length > 100) throw new ValidationError("Tên người nhận phải có từ 1 đến 100 ký tự.")
  if (!/^\+?[0-9][0-9\s().-]{7,19}$/.test(recipientPhone)) throw new ValidationError("Số điện thoại người nhận không hợp lệ.")
  if (!deliveryAddress || deliveryAddress.length > 500) throw new ValidationError("Địa chỉ giao hàng phải có từ 1 đến 500 ký tự.")
  if (note === null || note.length > 1000) throw new ValidationError("Ghi chú giao hàng không được vượt quá 1000 ký tự.")
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 50) {
    throw new ValidationError("Đơn mua cần có từ 1 đến 50 sản phẩm.")
  }

  const items = input.items.map((item, index) => {
    const row = object(item, `Sản phẩm thứ ${index + 1}`)
    const productId = positiveId(row.productId, `Mã sản phẩm thứ ${index + 1}`)
    const quantity = row.quantity
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 2147483647) {
      throw new ValidationError(`Số lượng sản phẩm thứ ${index + 1} không hợp lệ.`)
    }
    return { productId, quantity }
  })
  if (new Set(items.map((item) => item.productId)).size !== items.length) {
    throw new ValidationError("Mỗi sản phẩm chỉ được xuất hiện một lần trong đơn.")
  }

  return { recipientName, recipientPhone, deliveryAddress, note, items }
}

function validateOrderStatus(value) {
  const status = object(value, "Trạng thái").status
  if (!ORDER_STATUSES.has(status)) throw new ValidationError("Trạng thái đơn mua không hợp lệ.")
  return status
}

function nonnegativeInteger(value, label, defaultValue) {
  if (value === undefined && defaultValue !== undefined) return defaultValue
  const parsed = typeof value === "number" ? value : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new ValidationError(`${label} không hợp lệ.`)
  return parsed
}

export { ORDER_STATUSES, ValidationError, nonnegativeInteger, positiveId, validateCreateOrder, validateOrderStatus }
