import type { AppState } from "@/lib/types"
import { formatDate, formatDateTime } from "@/lib/format"
import { getAdminDataError } from "./admin-shared"

// Display dates explicitly while preserving the existing local-day filtering.
export function formatAdminDate(value: string) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return "Chưa có ngày hợp lệ"
  return formatDate(date)
}

export function formatAdminDateTime(value: string) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return "Chưa có lịch hợp lệ"
  return formatDateTime(date)
}

const optionalText = (value: unknown) => value === undefined || typeof value === "string"
const validDate = (value: unknown) => typeof value === "string" && Number.isFinite(new Date(value).getTime())
const nonnegative = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0

// Read-only guard for the additional fields rendered by the four 3B.3 screens.
// Invalid records are reported, never repaired or replaced here.
export function getAdminCommerceDataError(state: AppState): string | null {
  const existing = getAdminDataError(state)
  if (existing) return existing
  if ([state.services, state.users, state.orders, state.payments, state.reviews].some((items) => new Set(items.map((item) => item.id)).size !== items.length)) return "Dữ liệu quản trị có mã định danh bị trùng"
  if (state.services.some((service) => ![service.slug, service.shortDesc, service.description, service.unit, service.quantityLabel].every((value) => typeof value === "string")
    || !["dinh-ky", "chuyen-sau", "noi-that", "thiet-bi"].includes(service.category) || !["active", "inactive"].includes(service.status)
    || ![service.price, service.minQuantity, service.defaultQuantity, service.minutesPerUnit, service.baseMinutes].every(nonnegative))) return "Chưa thể đọc đầy đủ dữ liệu dịch vụ"
  if (state.payments.some((payment) => payment.refundRequired !== undefined && typeof payment.refundRequired !== "boolean")) return "Chưa thể đọc trạng thái cần hoàn tiền"
  if (state.reviews.some((review) => ![review.customerId, review.serviceId].every((value) => typeof value === "string") || !optionalText(review.staffId)
    || !validDate(review.createdAt) || typeof review.hidden !== "boolean" || !optionalText(review.hiddenReason))) return "Chưa thể đọc đầy đủ dữ liệu đánh giá"
  return null
}
