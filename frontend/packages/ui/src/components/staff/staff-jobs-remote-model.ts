/** UC9 uses the assignment DTO; it must never be cast to the local-store Order type. */
export type RemoteStaffStatus = "WAITING" | "ACCEPTED" | "IN_PROGRESS" | "DONE" | "CANCELLED"
export type StaffJobsQuery = { status: "" | RemoteStaffStatus; page: number; pageSize: number; sort: "asc" | "desc" }
export type RemoteStaffJob = {
  id: string
  assignmentId: string
  orderId: string
  jobCode: null
  orderCode: null
  status: RemoteStaffStatus
  databaseStatus: "ASSIGNED" | "ACCEPTED" | "IN_PROGRESS" | "DONE" | "CANCELLED"
  jobStatus: "waiting" | "accepted" | "in_progress" | "done" | null
  orderStatus: "pending" | "confirmed" | "in_progress" | "completed" | "cancelled" | null
  scheduledAt: string | null
  expectedEndAt: string | null
  durationMinutes: number | null
  contact: { name: string | null; address: string | null }
  services: { serviceId: string; name: string; unit: string; quantity: string; unitPrice: string }[]
  checkInAt: string | null
  checkOutAt: string | null
  assignedAt: string | null
}
export type RemoteStaffJobsPayload = {
  data: RemoteStaffJob[]
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
  timezone: "Asia/Ho_Chi_Minh"
}

export const DEFAULT_STAFF_JOBS_QUERY: StaffJobsQuery = { status: "", page: 1, pageSize: 20, sort: "asc" }
export const REMOTE_STAFF_STATUS_LABEL: Record<RemoteStaffStatus, string> = {
  WAITING: "Chờ tiếp nhận", ACCEPTED: "Đã tiếp nhận", IN_PROGRESS: "Đang thực hiện", DONE: "Đã hoàn thành", CANCELLED: "Đã hủy",
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
function identifier(value: unknown): value is string {
  return typeof value === "string" && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9_223_372_036_854_775_807n
}
function nullableText(value: unknown): value is string | null { return value === null || typeof value === "string" }
function timestamp(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value)
}
function decimal(value: unknown): value is string { return typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value) }
function integer(value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max
}

function parseJob(value: unknown): RemoteStaffJob | null {
  if (!record(value) || !identifier(value.id) || !identifier(value.assignmentId) || value.id !== value.assignmentId || !identifier(value.orderId)
    || value.jobCode !== null || value.orderCode !== null || typeof value.status !== "string" || !Object.hasOwn(REMOTE_STAFF_STATUS_LABEL, value.status)
    || !record(value.contact) || !nullableText(value.contact.name) || !nullableText(value.contact.address)
    || !timestamp(value.scheduledAt) || !timestamp(value.expectedEndAt) || !timestamp(value.checkInAt) || !timestamp(value.checkOutAt) || !timestamp(value.assignedAt)
    || !(value.durationMinutes === null || (typeof value.durationMinutes === "number" && Number.isFinite(value.durationMinutes) && value.durationMinutes >= 0))
    || !["pending", "confirmed", "in_progress", "completed", "cancelled", null].includes(value.orderStatus as string | null)
    || !Array.isArray(value.services)) return null
  const status = value.status as RemoteStaffStatus
  const databaseStatus = status === "WAITING" ? "ASSIGNED" : status
  const jobStatus = ({ WAITING: "waiting", ACCEPTED: "accepted", IN_PROGRESS: "in_progress", DONE: "done", CANCELLED: null } as const)[status]
  if (value.databaseStatus !== databaseStatus || value.jobStatus !== jobStatus) return null
  const services: RemoteStaffJob["services"] = []
  for (const item of value.services) {
    if (!record(item) || !identifier(item.serviceId) || typeof item.name !== "string" || typeof item.unit !== "string" || !decimal(item.quantity) || !decimal(item.unitPrice)) return null
    // Keep DECIMAL strings intact; do not recalculate booking prices from the catalog.
    services.push({ serviceId: item.serviceId, name: item.name, unit: item.unit, quantity: item.quantity, unitPrice: item.unitPrice })
  }
  return {
    id: value.id, assignmentId: value.assignmentId, orderId: value.orderId, jobCode: null, orderCode: null,
    status, databaseStatus, jobStatus, orderStatus: value.orderStatus as RemoteStaffJob["orderStatus"],
    scheduledAt: value.scheduledAt, expectedEndAt: value.expectedEndAt, durationMinutes: value.durationMinutes,
    contact: { name: value.contact.name, address: value.contact.address }, services,
    checkInAt: value.checkInAt, checkOutAt: value.checkOutAt, assignedAt: value.assignedAt,
  }
}

/** Whitelist the public DTO and discard extra fields rather than retaining arbitrary payloads. */
export function parseStaffJobsPayload(value: unknown): RemoteStaffJobsPayload | null {
  if (!record(value) || value.timezone !== "Asia/Ho_Chi_Minh" || !Array.isArray(value.data) || !record(value.pagination)) return null
  const { page, pageSize, total, totalPages } = value.pagination
  if (!integer(page, 1, 100_000) || !integer(pageSize, 1, 100) || !integer(total, 0) || !integer(totalPages, 0)
    || totalPages !== Math.ceil(total / pageSize) || value.data.length > pageSize || value.data.length > total) return null
  const data: RemoteStaffJob[] = []
  const seen = new Set<string>()
  for (const item of value.data) {
    const job = parseJob(item)
    if (!job || seen.has(job.assignmentId)) return null
    seen.add(job.assignmentId); data.push(job)
  }
  return { data, pagination: { page, pageSize, total, totalPages }, timezone: "Asia/Ho_Chi_Minh" }
}

export function staffJobsQueryString(query: StaffJobsQuery): string {
  const params = new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize), sort: query.sort })
  if (query.status) params.set("status", query.status)
  return params.toString()
}

/** URL state has the same four supported filters as UC9, never an employee identity. */
export function parseStaffJobsQuery(search: string): StaffJobsQuery | null {
  const params = new URLSearchParams(search)
  const allowed = new Set(["status", "page", "pageSize", "sort"])
  for (const key of params.keys()) if (!allowed.has(key) || params.getAll(key).length !== 1) return null
  const rawStatus = params.get("status")
  const status = rawStatus === "ASSIGNED" ? "WAITING" : rawStatus
  if (status !== null && !Object.hasOwn(REMOTE_STAFF_STATUS_LABEL, status)) return null
  const page = params.get("page") || "1", pageSize = params.get("pageSize") || "20", sort = params.get("sort") || "asc"
  if ((params.has("page") && !params.get("page")) || (params.has("pageSize") && !params.get("pageSize")) || (params.has("sort") && !params.get("sort"))
    || !/^[1-9]\d*$/.test(page) || !integer(Number(page), 1, 100_000) || !/^[1-9]\d*$/.test(pageSize) || !integer(Number(pageSize), 1, 100)
    || (sort !== "asc" && sort !== "desc")) return null
  return { status: status as StaffJobsQuery["status"] || "", page: Number(page), pageSize: Number(pageSize), sort }
}

export function staffJobsListHref(query: StaffJobsQuery): string { return `/cong-viec?${staffJobsQueryString(query)}` }
export function staffJobDetailHref(assignmentId: string, query: StaffJobsQuery): string {
  return identifier(assignmentId) ? `/don/${assignmentId}?from=${encodeURIComponent(staffJobsListHref(query))}` : "/cong-viec"
}

const vietnamTime = new Intl.DateTimeFormat("vi-VN", {
  timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", hourCycle: "h23", day: "2-digit", month: "2-digit", year: "numeric",
})
export function formatStaffJobTime(value: string | null): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "Chưa có lịch thực hiện"
  const parts = vietnamTime.formatToParts(new Date(value))
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || ""
  return `${part("hour")}:${part("minute")} · ${part("day")}/${part("month")}/${part("year")}`
}
