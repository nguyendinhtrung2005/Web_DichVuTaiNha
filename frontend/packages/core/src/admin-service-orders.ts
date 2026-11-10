import { apiRequest } from "./api-client"
import type { Order } from "./types"

export type AdminServiceOrder = Omit<Order, "durationMinutes"> & {
  branchId: string | null
  branchName?: string | null
  decisionState: string
  decisionSource: string
  decisionReason?: string
  durationMinutes: number | null
  assignment?: { employeeId: string; employeeName: string; status: string }
  assignments?: { id: string; employeeId: string; employeeName: string; status: string; assignedAt: string }[]
  decisionHistory?: {
    actorType: string; actorId: string | null; action: string; previousStatus: string | null
    nextStatus: string; previousDecision: string | null; nextDecision: string; reason: string
    details: Record<string, unknown>; createdAt: string
  }[]
}

export type AdminServiceOrderPage = { items: AdminServiceOrder[]; total: number; page: number; limit: number }
export type AdminServiceOrderOptions = {
  branches: { id: string; name: string }[]
  employees: { id: string; branchId: string; name: string; available: boolean }[]
}
export type AdminBookingAction =
  | { action: "assign" | "confirm"; reason: string; branchId: string; employeeId: string; scheduledAt?: string; durationMinutes?: number }
  | { action: "set-branch"; reason: string; branchId: string }
  | { action: "needs-dispatch" | "needs-admin" | "reject" | "cancel"; reason: string }
  | { action: "resolve-cancellation"; reason: string; approve: boolean }
  | { action: "reschedule"; reason: string; scheduledAt: string; durationMinutes?: number }
  | { action: "update"; reason: string; address?: string; phone?: string; specialRequest?: string }

export async function listAdminServiceOrders(filters: {
  status?: string
  decisionState?: string
  branchId?: string
  from?: string
  to?: string
  reason?: string
  signal?: AbortSignal
} = {}): Promise<AdminServiceOrder[]> {
  const items: AdminServiceOrder[] = []
  for (let page = 1; page <= 10000; page++) {
    const query = new URLSearchParams({ page: String(page), limit: "100" })
    for (const [key, value] of Object.entries(filters)) {
      if (key !== "signal" && typeof value === "string" && value) query.set(key, value)
    }
    const result = await apiRequest<AdminServiceOrderPage>(`/admin/orders?${query}`, { signal: filters.signal })
    if (!result || !Array.isArray(result.items) || !Number.isInteger(result.total) || result.page !== page) {
      throw new Error("Danh sách đơn dịch vụ quản trị trả dữ liệu không hợp lệ.")
    }
    items.push(...result.items)
    if (items.length >= result.total) return items
    if (!result.items.length) throw new Error("Danh sách đơn dịch vụ quản trị chưa đầy đủ.")
  }
  throw new Error("Danh sách đơn dịch vụ vượt giới hạn tải.")
}

export function getAdminServiceOrder(id: string, signal?: AbortSignal) {
  return apiRequest<AdminServiceOrder>(`/admin/orders/${encodeURIComponent(id)}`, { signal })
}

export function getAdminServiceOrderOptions(
  id: string,
  signal?: AbortSignal,
  schedule?: { scheduledAt?: string; durationMinutes?: number },
) {
  const query = new URLSearchParams()
  if (schedule?.scheduledAt) query.set("scheduledAt", schedule.scheduledAt)
  if (schedule?.durationMinutes !== undefined) query.set("durationMinutes", String(schedule.durationMinutes))
  const queryString = query.toString()
  const suffix = queryString ? `?${queryString}` : ""
  return apiRequest<AdminServiceOrderOptions>(`/admin/orders/${encodeURIComponent(id)}/options${suffix}`, { signal })
}

export function decideAdminServiceOrder(id: string, action: AdminBookingAction) {
  return apiRequest<AdminServiceOrder>(`/admin/orders/${encodeURIComponent(id)}/decisions`, {
    method: "POST",
    body: JSON.stringify(action),
  })
}
