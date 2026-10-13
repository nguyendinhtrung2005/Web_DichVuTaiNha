"use client"

import { actions, executeStoreCommand, getStoreSnapshot, storedStateRaw, storedStateData } from "@/lib/store"
import { IS_UNIFIED_APP } from "@/lib/env"
import type { AppState, Order } from "@/lib/types"

export type AdminOrderSchedulePatch = Parameters<typeof actions.updateOrderSchedule>[1]
export type AdminMutationResult = { ok: true; persistence: "local" | "session" } | { ok: false; error: string }

// These operations retain the existing store actions and business rules. A
// backend adapter can implement this interface without changing the UI later.
export interface AdminOrderService {
  confirm(orderId: string): Promise<AdminMutationResult>
  updateSchedule(orderId: string, patch: AdminOrderSchedulePatch, expectedOrder?: Order): Promise<AdminMutationResult>
  assign(orderId: string, staffId: string): Promise<AdminMutationResult>
  resolveCancellation(orderId: string, approve: boolean, note: string): Promise<AdminMutationResult>
  confirmPayment(paymentId: string): Promise<AdminMutationResult>
}

function storedState() {
  try { return storedStateRaw() } catch { return null }
}

async function mutate(action: () => { ok: true } | { ok: false; error: string }, matches: (state: AppState) => boolean): Promise<AdminMutationResult> {
    return executeStoreCommand(() => {
  try {
    const before = storedState()
    const result = action()
    if (!result.ok) return result
    try {
      const raw = storedState()
      return { ok: true, persistence: raw && raw !== before && matches(storedStateData(raw)) ? "local" : "session" }
    } catch { return { ok: true, persistence: "session" } }
  } catch { return { ok: false, error: "Chưa thể lưu thay đổi. Vui lòng kiểm tra và thử lại." } }

    })
}

export const adminOrderService: AdminOrderService = {
  confirm(orderId) {
    return mutate(() => actions.confirmOrder(orderId), (state) => state.orders.some((order) => order.id === orderId && order.status === "confirmed"))
  },
  updateSchedule(orderId, patch, expectedOrder) {
    return mutate(() => {
      if (IS_UNIFIED_APP && expectedOrder) {
        const current = getStoreSnapshot()?.orders.find((order) => order.id === orderId)
        if (!current || expectedOrder.id !== orderId || JSON.stringify(current) !== JSON.stringify(expectedOrder)) return { ok: false, error: "Thông tin đơn đã thay đổi ở nơi khác. Nội dung bạn nhập vẫn được giữ; vui lòng mở lại đơn trước khi lưu." }
      }
      return actions.updateOrderSchedule(orderId, patch)
    }, (state) => state.orders.some((order) => order.id === orderId && order.scheduledAt === patch.scheduledAt && order.specialRequest === patch.specialRequest && order.contact.address === patch.address && order.contact.phone === patch.phone))
  },
  assign(orderId, staffId) {
    return mutate(() => actions.assignStaff(orderId, staffId), (state) => state.orders.some((order) => order.id === orderId && order.staffId === staffId))
  },
  resolveCancellation(orderId, approve, note) {
    const startedAt = Date.now()
    return mutate(() => actions.resolveCancel(orderId, approve, note), (state) => {
      const order = state.orders.find((item) => item.id === orderId)
      const request = order?.cancelRequest
      return request?.status === (approve ? "approved" : "rejected") && request.adminNote === note && Number.isFinite(new Date(request.resolvedAt ?? "").getTime())
        && new Date(request.resolvedAt ?? "").getTime() >= startedAt && (!approve || order?.status === "cancelled")
    })
  },
  confirmPayment(paymentId) {
    const startedAt = Date.now()
    return mutate(() => actions.confirmPayment(paymentId), (state) => state.payments.some((payment) => payment.id === paymentId && payment.status === "paid" && new Date(payment.confirmedAt ?? "").getTime() >= startedAt))
  },
}
