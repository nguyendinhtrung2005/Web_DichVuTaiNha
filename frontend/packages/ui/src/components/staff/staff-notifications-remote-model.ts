/** Real Staff notification DTO: the stored table has no title/type/link columns. */
export type StaffNotification = {
  id: string
  content: string
  bookingId: string | null
  readAt: string | null
  createdAt: string
}
export type StaffNotificationsPage = {
  data: StaffNotification[]
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
  unreadCount: number
  timezone: "Asia/Ho_Chi_Minh"
}
export type StaffNotificationsQuery = { page: number; pageSize: number; unreadOnly: boolean }
export type StaffUnreadCount = { data: { unreadCount: number } }
export type StaffMarkRead = { data: StaffNotification; unreadCount: number }
export type StaffReadAll = { data: { updated: number; unreadCount: number } }

export const DEFAULT_STAFF_NOTIFICATIONS_QUERY: StaffNotificationsQuery = { page: 1, pageSize: 20, unreadOnly: false }

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
function identifier(value: unknown): value is string {
  return typeof value === "string" && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9_223_372_036_854_775_807n
}
function timestamp(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value)
}
function integer(value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max
}

function parseItem(value: unknown): StaffNotification | null {
  if (!record(value) || !identifier(value.id) || typeof value.content !== "string" || value.content.length > 20000
    || !(value.bookingId === null || identifier(value.bookingId))
    || !timestamp(value.readAt) || typeof value.createdAt !== "string" || !timestamp(value.createdAt)) return null
  return { id: value.id, content: value.content, bookingId: value.bookingId as string | null, readAt: value.readAt, createdAt: value.createdAt }
}

export function parseStaffNotificationsPage(value: unknown, query: StaffNotificationsQuery): StaffNotificationsPage | null {
  if (!record(value) || !Array.isArray(value.data) || !record(value.pagination) || value.timezone !== "Asia/Ho_Chi_Minh") return null
  const { page, pageSize, total, totalPages } = value.pagination
  if (page !== query.page || pageSize !== query.pageSize || !integer(total, 0) || !integer(totalPages, 0)
    || totalPages !== Math.ceil(total / pageSize) || value.data.length > pageSize
    || value.data.length !== Math.min(pageSize, Math.max(0, total - (page - 1) * pageSize))) return null
  if (!integer(value.unreadCount, 0) || value.unreadCount > total) return null
  const data: StaffNotification[] = []
  const seen = new Set<string>()
  for (const entry of value.data) {
    const item = parseItem(entry)
    if (!item || seen.has(item.id)) return null
    seen.add(item.id); data.push(item)
  }
  return { data, pagination: { page, pageSize, total, totalPages }, unreadCount: value.unreadCount, timezone: "Asia/Ho_Chi_Minh" }
}

export function parseStaffUnreadCount(value: unknown): StaffUnreadCount | null {
  if (!record(value) || !record(value.data) || !integer(value.data.unreadCount, 0)) return null
  return { data: { unreadCount: value.data.unreadCount } }
}

export function parseStaffMarkRead(value: unknown): StaffMarkRead | null {
  if (!record(value) || !record(value.data) || !integer(value.unreadCount, 0)) return null
  const item = parseItem(value.data)
  if (!item || item.readAt === null) return null
  return { data: item, unreadCount: value.unreadCount }
}

export function parseStaffReadAll(value: unknown): StaffReadAll | null {
  if (!record(value) || !record(value.data) || !integer(value.data.updated, 0) || value.data.unreadCount !== 0) return null
  return { data: { updated: value.data.updated, unreadCount: 0 } }
}

export function staffNotificationsQueryString(query: StaffNotificationsQuery): string {
  const params = new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize) })
  if (query.unreadOnly) params.set("unreadOnly", "true")
  return params.toString()
}

const vietnamTime = new Intl.DateTimeFormat("vi-VN", {
  timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", hourCycle: "h23", day: "2-digit", month: "2-digit", year: "numeric",
})
export function formatStaffNotificationTime(value: string | null): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "Chưa rõ thời gian"
  const parts = vietnamTime.formatToParts(new Date(value))
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || ""
  return `${part("hour")}:${part("minute")} · ${part("day")}/${part("month")}/${part("year")}`
}
