import { CANCEL_POLICY } from "./config"
import type { AppState, Order, Payment, PaymentStatus } from "./types"

export function orderEnd(order: Pick<Order, "scheduledAt" | "durationMinutes">) {
  return new Date(new Date(order.scheduledAt).getTime() + order.durationMinutes * 60000)
}

export function isActiveOrder(order: Order) {
  return order.status !== "cancelled"
}

/** Tìm công việc của nhân viên trùng khung giờ với khoảng thời gian đề xuất. */
export function findConflicts(state: AppState, staffId: string, start: Date, durationMinutes: number, excludeOrderId?: string) {
  const end = start.getTime() + durationMinutes * 60000
  return state.orders.filter((o) => {
    if (o.id === excludeOrderId || o.staffId !== staffId || !isActiveOrder(o)) return false
    const s = new Date(o.scheduledAt).getTime()
    const e = orderEnd(o).getTime()
    return s < end && start.getTime() < e
  })
}

export function canRequestCancel(order: Order) {
  if (!CANCEL_POLICY.allowedStatuses.includes(order.status)) return false
  if (order.jobStatus && CANCEL_POLICY.blockedJobStatuses.includes(order.jobStatus)) return false
  if (order.cancelRequest?.status === "pending") return false
  return true
}

export function paymentOf(state: AppState, orderId: string): Payment | undefined {
  return state.payments.find((p) => p.orderId === orderId)
}

export function paymentStatusOf(state: AppState, orderId: string): PaymentStatus {
  return paymentOf(state, orderId)?.status ?? "unpaid"
}

export function reviewOf(state: AppState, orderId: string) {
  return state.reviews.find((r) => r.orderId === orderId)
}

export function staffJobsOnDay(state: AppState, staffId: string, day: Date) {
  return state.orders.filter((o) => {
    if (o.staffId !== staffId || !isActiveOrder(o)) return false
    const d = new Date(o.scheduledAt)
    return d.getFullYear() === day.getFullYear() && d.getMonth() === day.getMonth() && d.getDate() === day.getDate()
  })
}

export function nextJobAction(order: Order) {
  if (order.status === "cancelled" || !order.staffId) return null
  switch (order.jobStatus) {
    case "waiting":
      return { next: "accepted" as const, label: "Tiếp nhận công việc", confirm: "Bạn xác nhận tiếp nhận công việc này?" }
    case "accepted":
      return { next: "in_progress" as const, label: "Bắt đầu thực hiện", confirm: "Xác nhận bắt đầu thực hiện? Trạng thái đơn sẽ chuyển sang “Đang thực hiện”." }
    case "in_progress":
      return { next: "done" as const, label: "Hoàn thành", confirm: "Xác nhận đã hoàn thành công việc? Trạng thái đơn sẽ chuyển sang “Hoàn thành”." }
    default:
      return null
  }
}
