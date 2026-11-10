import { ApiError, apiRequest } from "@cleanhome/core"
import type { AdminServiceOrder, AdminServiceOrderOptions } from "@cleanhome/core"

export type BookingStatus = "PENDING" | "CONFIRMED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED"
export type BookingDecisionState =
  | "AUTO_CONFIRMED"
  | "NEEDS_DISPATCH"
  | "NEEDS_ADMIN"
  | "ADMIN_CONFIRMED"
  | "ADMIN_REJECTED"
  | "ADMIN_CANCELLED"
  | "LEGACY"

export interface BookingRecord {
  id: string
  customerId: string
  customerName: string
  branchId: string | null
  branchName: string | null
  status: BookingStatus
  decisionState: BookingDecisionState
  decisionSource: string
  decisionReason: string
  durationMinutes: number | null
  specialRequest: string
  address: AdminServiceOrder["contact"]
  scheduledStart: string
  scheduledEnd: string | null
  totalAmount: number
  createdAt: string
  updatedAt: string
  employeeId: string | null
  employeeName: string | null
  serviceName?: string
  quantity?: number
  items: NonNullable<AdminServiceOrder["items"]>
  history: NonNullable<AdminServiceOrder["decisionHistory"]>
}

export interface BookingPage {
  items: BookingRecord[]
  page: number
  pageSize: number
  total: number
}

export class BookingApiError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message)
    this.name = "BookingApiError"
  }
}

export interface AdminBookingOptions {
  branches: Array<{ id: string; name: string }>
  employees: Array<{ id: string; branchId: string; name: string; available: boolean }>
}

export interface AdminBookingFilters {
  page: number
  pageSize: number
  status?: BookingStatus | ""
  decisionState?: BookingDecisionState | ""
  branchId?: string
  from?: string
  to?: string
  reason?: string
}

export interface AdminBookingMutation {
  action: "UPDATE" | "CONFIRM" | "ASSIGN" | "RESCHEDULE" | "SET_BRANCH" | "REJECT" | "CANCEL"
  reason: string
  scheduledAt?: string
  branchId?: string | null
  employeeId?: string | null
  durationMinutes?: number
  contact?: { name: string; phone: string; address: string; region: string }
}

type AdminOrderPage = { items: AdminServiceOrder[]; page: number; limit: number; total: number }
const DECISION_STATES: readonly BookingDecisionState[] = [
  "AUTO_CONFIRMED", "NEEDS_DISPATCH", "NEEDS_ADMIN", "ADMIN_CONFIRMED",
  "ADMIN_REJECTED", "ADMIN_CANCELLED", "LEGACY",
]

function mapOrder(order: AdminServiceOrder): BookingRecord {
  const statuses: Record<AdminServiceOrder["status"], BookingStatus> = {
    pending: "PENDING",
    confirmed: "CONFIRMED",
    in_progress: "IN_PROGRESS",
    completed: "COMPLETED",
    cancelled: "CANCELLED",
  }
  const status = statuses[order.status]
  const decisionState = DECISION_STATES.find((state) => state === order.decisionState) ?? (order.decisionState ? undefined : "LEGACY")
  if (!status || !decisionState) {
    throw new BookingApiError("API trả về trạng thái đơn dịch vụ không hợp lệ.", 502, "INVALID_ORDER_STATUS")
  }
  const scheduledEnd = order.durationMinutes === null
    ? null
    : new Date(new Date(order.scheduledAt).getTime() + order.durationMinutes * 60000)
  if (!Number.isFinite(new Date(order.scheduledAt).getTime()) || (scheduledEnd && !Number.isFinite(scheduledEnd.getTime()))) {
    throw new BookingApiError("API trả về lịch đơn dịch vụ không hợp lệ.", 502, "INVALID_ORDER_SCHEDULE")
  }
  const employeeId = order.assignment?.employeeId ?? order.staffId ?? null
  return {
    id: order.id,
    customerId: order.customerId,
    customerName: order.contact.name,
    branchId: order.branchId ?? null,
    branchName: order.branchName ?? (order.branchId ? `Chi nhánh #${order.branchId}` : null),
    status,
    decisionState,
    decisionSource: order.decisionSource ?? "LEGACY",
    decisionReason: order.decisionReason ?? "",
    durationMinutes: order.durationMinutes,
    specialRequest: order.specialRequest,
    address: order.contact,
    scheduledStart: order.scheduledAt,
    scheduledEnd: scheduledEnd?.toISOString() ?? null,
    totalAmount: order.price,
    createdAt: order.createdAt,
    updatedAt: order.createdAt,
    employeeId,
    employeeName: order.assignment?.employeeName ?? null,
    serviceName: order.serviceName,
    quantity: order.quantity,
    items: order.items ?? [],
    history: order.decisionHistory ?? [],
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    return await apiRequest<T>(path, init)
  } catch (error) {
    if (error instanceof ApiError) throw new BookingApiError(error.message, error.status, error.code)
    throw error
  }
}

export async function listAdminBookings(filters: AdminBookingFilters): Promise<BookingPage> {
  const query = new URLSearchParams({
    page: String(filters.page),
    limit: String(filters.pageSize),
  })
  for (const [key, value] of Object.entries(filters)) {
    if (key !== "page" && key !== "pageSize" && value) query.set(key, String(value))
  }
  const result = await request<AdminOrderPage>(`/admin/orders?${query}`)
  return {
    items: result.items.map(mapOrder),
    page: result.page,
    pageSize: result.limit,
    total: result.total,
  }
}

export async function getAdminBooking(id: string) {
  return mapOrder(await request<AdminServiceOrder>(`/admin/orders/${encodeURIComponent(id)}`))
}

export async function getAdminBookingOptions(
  id: string,
  schedule?: { scheduledAt?: string; durationMinutes?: number },
): Promise<AdminBookingOptions> {
  const query = new URLSearchParams()
  if (schedule?.scheduledAt) query.set("scheduledAt", schedule.scheduledAt)
  if (schedule?.durationMinutes !== undefined) query.set("durationMinutes", String(schedule.durationMinutes))
  const suffix = query.toString() ? `?${query}` : ""
  const options = await request<AdminServiceOrderOptions>(`/admin/orders/${encodeURIComponent(id)}/options${suffix}`)
  return {
    branches: options.branches,
    employees: options.employees,
  }
}

export async function mutateAdminBooking(id: string, mutation: AdminBookingMutation) {
  const action = mutation.action === "UPDATE"
    ? "update"
    : mutation.action === "RESCHEDULE"
      ? "reschedule"
      : mutation.action === "SET_BRANCH"
        ? "set-branch"
        : mutation.action === "REJECT"
          ? "reject"
          : mutation.action === "CANCEL"
            ? "cancel"
            : mutation.action === "CONFIRM"
              ? "confirm"
              : "assign"
  const body: Record<string, unknown> = { action, reason: mutation.reason }
  if (mutation.action === "UPDATE" && mutation.contact) {
    body.name = mutation.contact.name
    body.address = mutation.contact.address
    body.phone = mutation.contact.phone
    body.region = mutation.contact.region
  }
  if (mutation.action === "CONFIRM" || mutation.action === "ASSIGN") {
    body.branchId = mutation.branchId
    body.employeeId = mutation.employeeId
    body.scheduledAt = mutation.scheduledAt
    body.durationMinutes = mutation.durationMinutes
  }
  if (mutation.action === "RESCHEDULE") {
    body.scheduledAt = mutation.scheduledAt
    body.durationMinutes = mutation.durationMinutes
  }
  if (mutation.action === "SET_BRANCH") body.branchId = mutation.branchId
  return mapOrder(await request<AdminServiceOrder>(`/admin/orders/${encodeURIComponent(id)}/decisions`, {
    method: "POST",
    body: JSON.stringify(body),
  }))
}
