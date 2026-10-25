import { parseStaffJobsPayload, parseStaffJobsQuery, staffJobsListHref, type RemoteStaffJob } from "./staff-jobs-remote-model"

export type RemoteStaffJobDetail = Omit<RemoteStaffJob, "contact"> & {
  contact: RemoteStaffJob["contact"] & { phone: string | null; houseType: null; area: null; rooms: null; floors: null; hasPets: null }
  specialRequest: null
  cancellationPending: boolean | null
  orderHistory: { at: string; label: string; by: string; note?: string }[] | null
  historySource: "order-service-not-loaded" | "order-service-unavailable" | "order-service"
  unsupportedFields: string[]
  warnings?: { code: "ORDER_HISTORY_UNAVAILABLE"; message: string }[]
}

function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value) }
export function isStaffAssignmentId(value: unknown): value is string {
  return typeof value === "string" && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9_223_372_036_854_775_807n
}
function historyTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value)
  if (!parts || !Number.isFinite(Date.parse(value))) return false
  const [, year, month, day, hour, minute, second, offsetHour, offsetMinute] = parts.map(Number)
  const calendar = new Date(0)
  calendar.setUTCFullYear(year, month, 0)
  return month >= 1 && month <= 12 && day >= 1 && day <= calendar.getUTCDate() && hour <= 23 && minute <= 59 && second <= 59
    && (Number.isNaN(offsetHour) || (offsetHour <= 23 && offsetMinute <= 59))
}

/** Keep only fields Staff actually exposes; the UC9 parser validates shared assignment data. */
export function parseStaffJobDetailPayload(payload: unknown, expectedAssignmentId: string): RemoteStaffJobDetail | null {
  if (!isStaffAssignmentId(expectedAssignmentId) || !record(payload) || !record(payload.data)) return null
  const source = payload.data
  const base = parseStaffJobsPayload({ data: [source], pagination: { page: 1, pageSize: 1, total: 1, totalPages: 1 }, timezone: "Asia/Ho_Chi_Minh" })?.data[0]
  if (!base || base.assignmentId !== expectedAssignmentId || !record(source.contact)
    || !(source.contact.phone === null || typeof source.contact.phone === "string") || source.specialRequest !== null
    || ["houseType", "area", "rooms", "floors", "hasPets"].some(field => (source.contact as Record<string, unknown>)[field] !== null)
    || !(source.cancellationPending === null || typeof source.cancellationPending === "boolean")
    || typeof source.historySource !== "string" || !["order-service-not-loaded", "order-service-unavailable", "order-service"].includes(source.historySource)
    || !Array.isArray(source.unsupportedFields) || source.unsupportedFields.some(field => typeof field !== "string")
    || !(source.orderHistory === null || Array.isArray(source.orderHistory))) return null
  if (source.historySource !== "order-service" && (source.orderHistory !== null || source.cancellationPending !== null)) return null
  const orderHistory: RemoteStaffJobDetail["orderHistory"] = source.orderHistory === null ? null : []
  if (Array.isArray(source.orderHistory)) {
    for (const entry of source.orderHistory) {
      if (!record(entry) || !historyTimestamp(entry.at) || typeof entry.label !== "string" || !entry.label.trim()
        || typeof entry.by !== "string" || !entry.by.trim() || !(entry.note === undefined || typeof entry.note === "string")) return null
      orderHistory!.push({ at: entry.at, label: entry.label, by: entry.by, ...(entry.note === undefined ? {} : { note: entry.note }) })
    }
  }
  let warnings: RemoteStaffJobDetail["warnings"]
  if (source.warnings !== undefined) {
    if (!Array.isArray(source.warnings)) return null
    warnings = []
    for (const warning of source.warnings) {
      if (!record(warning) || warning.code !== "ORDER_HISTORY_UNAVAILABLE" || typeof warning.message !== "string") return null
      warnings.push({ code: "ORDER_HISTORY_UNAVAILABLE", message: warning.message })
    }
  }
  return {
    ...base, contact: { ...base.contact, phone: source.contact.phone, houseType: null, area: null, rooms: null, floors: null, hasPets: null },
    specialRequest: null, cancellationPending: source.cancellationPending, orderHistory,
    historySource: source.historySource as RemoteStaffJobDetail["historySource"], unsupportedFields: source.unsupportedFields.slice(),
    ...(warnings === undefined ? {} : { warnings }),
  }
}

/** The return value is always a fixed Staff list path, never a redirect or a BFF target. */
export function staffJobsReturnHref(requested: unknown): string {
  if (typeof requested !== "string" || requested.length > 4096 || /[\\\s\u0000-\u001f#]/.test(requested)
    || !(requested === "/cong-viec" || requested.startsWith("/cong-viec?"))) return "/cong-viec"
  try {
    const url = new URL(requested, "http://cleanhome.local")
    if (url.origin !== "http://cleanhome.local" || url.pathname !== "/cong-viec" || url.hash) return "/cong-viec"
    const query = parseStaffJobsQuery(url.search)
    return query ? url.search ? staffJobsListHref(query) : "/cong-viec" : "/cong-viec"
  } catch { return "/cong-viec" }
}

/** Only recognizable phone numbers become telephone links; test identifiers remain plain text. */
export function staffContactPhoneHref(phone: string | null): string | null {
  return phone && /^\+?[\d ()-]{3,32}$/.test(phone) && /\d/.test(phone) ? `tel:${phone.replace(/[^+\d]/g, "")}` : null
}

/** Format the saved DECIMAL without converting through a floating-point number. */
export function formatStaffSnapshotPrice(value: string): string {
  if (!/^-?\d+(?:\.\d+)?$/.test(value)) return "Chưa có đơn giá"
  const [integer, fraction] = value.split(".")
  return `${integer.replace(/\B(?=(\d{3})+(?!\d))/g, ".")}${fraction === undefined ? "" : `,${fraction}`} ₫`
}
