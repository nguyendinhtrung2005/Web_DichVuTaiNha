import { findConflicts } from "@/lib/logic"
import type { AppState, Order } from "@/lib/types"

export const ADMIN_JOB_FILTERS = [
  { value: "waiting", label: "Chờ tiếp nhận" },
  { value: "accepted", label: "Đã tiếp nhận" },
  { value: "in_progress", label: "Đang thực hiện" },
  { value: "done", label: "Đã hoàn thành" },
  { value: "cancelled", label: "Đã hủy" },
  { value: "pending", label: "Chờ xác nhận đơn" },
  { value: "confirmed", label: "Đã xác nhận đơn" },
]

export function adminJobStatus(order: Order) {
  if (order.status === "cancelled") return "cancelled"
  if (order.status === "completed") return "done"
  if (order.status === "in_progress") return "in_progress"
  return order.jobStatus || order.status
}

export function jobConflicts(state: AppState, order: Order) {
  return order.staffId && order.status !== "cancelled" ? findConflicts(state, order.staffId, new Date(order.scheduledAt), order.durationMinutes, order.id) : []
}

export function assignmentBlockReason(order: Order, now = Date.now()) {
  if (order.status !== "confirmed") return "Chỉ phân công được đơn đã xác nhận và chưa bắt đầu."
  if (order.jobStatus === "in_progress" || order.jobStatus === "done") return "Công việc đã bắt đầu hoặc hoàn thành, không thể phân công lại."
  const scheduled = new Date(order.scheduledAt).getTime()
  if (!Number.isFinite(scheduled)) return "Lịch thực hiện chưa hợp lệ. Hãy cập nhật lịch trong chi tiết đơn."
  if (scheduled < now) return "Lịch thực hiện đã qua. Hãy cập nhật lịch trong chi tiết đơn trước khi phân công."
  return ""
}
