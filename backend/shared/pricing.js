const { HttpError } = require("./http")

function estimateService(service, quantity) {
  const minimum = Number(service.min_quantity)
  const unitPrice = Number(service.base_price)
  const baseMinutes = Number(service.base_minutes)
  const minutesPerUnit = Number(service.minutes_per_unit)
  const mode = service.price_mode
  if (
    !["hour", "area", "unit"].includes(mode) ||
    !Number.isFinite(minimum) || minimum <= 0 ||
    !Number.isFinite(unitPrice) || unitPrice < 0 ||
    !Number.isFinite(baseMinutes) || baseMinutes < 0 ||
    !Number.isFinite(minutesPerUnit) || minutesPerUnit < 0
  ) {
    throw new HttpError(409, "PRICING_NOT_CONFIGURED", "Cách tính giá hoặc thời lượng của dịch vụ chưa được cấu hình hợp lệ.")
  }
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 100000) {
    throw new HttpError(400, "INVALID_QUANTITY", "Số lượng dịch vụ không hợp lệ.")
  }
  if (quantity < minimum) throw new HttpError(400, "MINIMUM_QUANTITY", `Số lượng tối thiểu là ${service.min_quantity} ${service.unit}.`)
  if (mode === "hour" && !Number.isInteger(quantity)) throw new HttpError(400, "HOURS_MUST_BE_INTEGER", "Số giờ dịch vụ phải là số nguyên.")

  const rawDuration = baseMinutes + minutesPerUnit * quantity
  if (!Number.isFinite(rawDuration) || rawDuration > 525600) {
    throw new HttpError(400, "DURATION_OUT_OF_RANGE", "Thời lượng dịch vụ vượt quá giới hạn cho phép.")
  }
  return {
    quantity,
    unitPrice,
    price: Math.round(unitPrice * quantity * 100) / 100,
    durationMinutes: Math.max(60, Math.ceil(rawDuration / 30) * 30),
    pricingMode: mode,
  }
}

module.exports = { estimateService }
