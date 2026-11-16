/**
 * Read-only Staff income estimate. Every amount is ESTIMATE_FOR_DEMO:
 * eligible DONE assignments × 60.000đ, never salary, payout or booking price.
 */
import { parseIncomeV2 } from "./staff-income-policy-v2.mjs"

export type StaffIncomeStatus = "ASSIGNED" | "ACCEPTED" | "IN_PROGRESS" | "DONE" | "CANCELLED"
export type StaffIncomeReason = "STATUS_NOT_DONE" | "MISSING_CHECK_TIMES" | "INVALID_CHECK_TIMES" | "OUTSIDE_COMPLETION_PERIOD"
export type StaffIncomeAssignment = {
  id: string
  bookingId: string
  status: StaffIncomeStatus
  scheduledStart: string
  scheduledEnd: string
  checkInAt: string | null
  checkOutAt: string | null
  eligible: boolean
  detail?: { day: string; baseVnd: number; peakVnd: number; distanceVnd: number | null; distanceStatus: string; distanceKm: string | null; totalVnd: number } | null
  reason: StaffIncomeReason | null
}
export type StaffIncomeEstimate = {
  period: { month: string; from: string; to: string; timezone: "Asia/Ho_Chi_Minh" }
  policy: { code: "ESTIMATE_FOR_DEMO"; unitPriceVnd: number; currency: "VND"; label: string; version?: string }
  breakdown?: { baseVnd: number; peakVnd: number; distanceVnd: number; incentiveVnd: number; unverifiedDistance: number }
  incentives?: { day: string; eligibleCount: number; amountVnd: number }[]
  counts: { assignments: number; eligible: number; incomplete: number; excluded: number }
  estimateTotalVnd: number
  assignments: StaffIncomeAssignment[]
  payout: { status: "NOT_INTEGRATED" }
  timezone: "Asia/Ho_Chi_Minh"
}

/** Potential repeated allocation, not proof of duplicate work or permission to change an amount. */
export function repeatedIncomeBookings(assignments: readonly StaffIncomeAssignment[]) {
  const bookings = new Map<string, Set<string>>()
  for (const assignment of assignments) {
    const ids = bookings.get(assignment.bookingId) || new Set<string>()
    ids.add(assignment.id); bookings.set(assignment.bookingId, ids)
  }
  return [...bookings].filter(([, ids]) => ids.size > 1).map(([bookingId, ids]) => ({ bookingId, assignmentIds: [...ids] }))
}

const STATUSES: StaffIncomeStatus[] = ["ASSIGNED", "ACCEPTED", "IN_PROGRESS", "DONE", "CANCELLED"]
const REASONS: StaffIncomeReason[] = ["STATUS_NOT_DONE", "MISSING_CHECK_TIMES", "INVALID_CHECK_TIMES"]
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/
const UNIT_PRICE_VND = 60000

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
function identifier(value: unknown): value is string {
  return typeof value === "string" && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9_223_372_036_854_775_807n
}
function timestamp(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
}
const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0

export function validIncomeMonth(value: unknown): value is string {
  if (typeof value !== "string" || !MONTH.test(value)) return false
  const year = Number(value.slice(0, 4))
  return year >= 1971 && year <= 2099
}
/** Same UTC+07 month boundaries the Staff API uses for period classification. */
export function incomeMonthBounds(month: string) {
  const year = Number(month.slice(0, 4)), value = Number(month.slice(5, 7))
  const from = Date.UTC(year, value - 1, 1), to = Date.UTC(year, value, 1)
  return {
    from: `${month}-01`,
    to: new Date(to - 86400000).toISOString().slice(0, 10),
    fromUtc: from - 7 * 3600000,
    toUtc: to - 7 * 3600000,
  }
}
export function currentVietnamMonth(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit" })
    .formatToParts(now)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || ""
  const value = `${part("year")}-${part("month")}`
  return validIncomeMonth(value) ? value : "1971-01"
}
export function shiftIncomeMonth(month: string, direction: number): string {
  if (!validIncomeMonth(month) || ![-1, 1].includes(direction)) return month
  const time = Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + direction, 1)
  const value = new Date(time).toISOString().slice(0, 7)
  return validIncomeMonth(value) ? value : month
}
export function canShiftIncomeMonth(month: string, direction: number): boolean {
  return shiftIncomeMonth(month, direction) !== month
}

export function parseStaffIncomeEstimate(value: unknown, month: string): StaffIncomeEstimate | null {
  if (record(value) && record(value.policy) && value.policy.version === "DEMO_V2") return parseIncomeV2(value, month) as StaffIncomeEstimate | null
  if (record(value) && record(value.policy) && value.policy.version !== undefined) return null
  if (!validIncomeMonth(month) || !record(value) || value.timezone !== "Asia/Ho_Chi_Minh"
    || !record(value.period) || !record(value.policy) || !record(value.counts) || !record(value.payout)
    || !Array.isArray(value.assignments) || value.assignments.length > 500) return null
  const bounds = incomeMonthBounds(month)
  if (value.period.month !== month || value.period.from !== bounds.from || value.period.to !== bounds.to
    || value.period.timezone !== "Asia/Ho_Chi_Minh") return null
  const policy = value.policy
  if (policy.code !== "ESTIMATE_FOR_DEMO" || policy.unitPriceVnd !== UNIT_PRICE_VND || policy.currency !== "VND"
    || typeof policy.label !== "string" || !policy.label.length || policy.label.length > 200) return null
  const counts = value.counts
  if (![counts.assignments, counts.eligible, counts.incomplete, counts.excluded].every(count)
    || counts.assignments !== value.assignments.length
    || (counts.eligible as number) + (counts.incomplete as number) + (counts.excluded as number) !== counts.assignments) return null
  if (!count(value.estimateTotalVnd) || value.estimateTotalVnd !== (counts.eligible as number) * UNIT_PRICE_VND) return null
  if (!record(value.payout) || value.payout.status !== "NOT_INTEGRATED") return null

  const seen = new Set<string>()
  let eligible = 0, incomplete = 0
  const assignments: StaffIncomeAssignment[] = []
  for (const entry of value.assignments) {
    if (!record(entry) || !identifier(entry.id) || !identifier(entry.bookingId)
      || !STATUSES.includes(entry.status as StaffIncomeStatus)
      || !timestamp(entry.scheduledStart) || !timestamp(entry.scheduledEnd) || Date.parse(entry.scheduledEnd) <= Date.parse(entry.scheduledStart)
      || !(entry.checkInAt === null || timestamp(entry.checkInAt)) || !(entry.checkOutAt === null || timestamp(entry.checkOutAt))
      || typeof entry.eligible !== "boolean" || !(entry.reason === null || REASONS.includes(entry.reason as StaffIncomeReason))) return null
    if (seen.has(entry.id)) return null
    seen.add(entry.id)
    const start = Date.parse(entry.scheduledStart)
    if (start < bounds.fromUtc || start >= bounds.toUtc) return null
    const expectedEligible = entry.status === "DONE" && entry.checkInAt !== null && entry.checkOutAt !== null
      && Date.parse(entry.checkOutAt) >= Date.parse(entry.checkInAt)
    const expectedReason = expectedEligible ? null : entry.status !== "DONE" ? "STATUS_NOT_DONE"
      : entry.checkInAt === null || entry.checkOutAt === null ? "MISSING_CHECK_TIMES" : "INVALID_CHECK_TIMES"
    if (entry.eligible !== expectedEligible || entry.reason !== expectedReason) return null
    if (expectedEligible) eligible += 1
    else if (expectedReason === "MISSING_CHECK_TIMES" || expectedReason === "INVALID_CHECK_TIMES") incomplete += 1
    assignments.push({
      id: entry.id, bookingId: entry.bookingId, status: entry.status as StaffIncomeStatus,
      scheduledStart: entry.scheduledStart, scheduledEnd: entry.scheduledEnd,
      checkInAt: entry.checkInAt as string | null, checkOutAt: entry.checkOutAt as string | null,
      eligible: entry.eligible, reason: entry.reason as StaffIncomeReason | null,
    })
  }
  // Recount from rows: a mismatched count or total must never render as money.
  if (eligible !== counts.eligible || incomplete !== counts.incomplete
    || assignments.length - eligible - incomplete !== counts.excluded) return null

  return {
    period: { month, from: bounds.from, to: bounds.to, timezone: "Asia/Ho_Chi_Minh" },
    policy: { code: "ESTIMATE_FOR_DEMO", unitPriceVnd: UNIT_PRICE_VND, currency: "VND", label: policy.label },
    counts: { assignments: counts.assignments, eligible, incomplete, excluded: counts.excluded },
    estimateTotalVnd: value.estimateTotalVnd,
    assignments,
    payout: { status: "NOT_INTEGRATED" },
    timezone: "Asia/Ho_Chi_Minh",
  }
}

export class StaffIncomeRequestError extends Error {
  constructor(readonly status: number, readonly code: string) { super("Staff income request failed") }
}
export function staffIncomeMessage(error: unknown): string {
  if (!(error instanceof StaffIncomeRequestError)) return "Chưa thể tải tiền công dự kiến. Vui lòng kiểm tra kết nối và thử lại."
  if (error.status === 401) return "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại."
  if (error.code === "STAFF_SESSION_CHANGED") return "Tài khoản đăng nhập đã thay đổi. Vui lòng tải lại trang."
  if (error.status === 403) return "Tài khoản hiện không có quyền xem tiền công dự kiến. Vui lòng liên hệ người quản lý."
  if (error.status === 409 || error.code === "INCOME_RANGE_TOO_LARGE") return "Kỳ này có quá nhiều phân công để tính tiền công dự kiến. Vui lòng chọn kỳ khác."
  if (error.status === 429) return "Bạn đã gửi nhiều yêu cầu. Vui lòng chờ một lúc rồi thử lại."
  if (error.status === 502 || error.code === "STAFF_INVALID_RESPONSE") return "Dữ liệu tiền công dự kiến chưa đọc được. Vui lòng thử lại hoặc liên hệ người quản lý."
  return "Tiền công dự kiến hiện chưa khả dụng. Vui lòng thử lại sau."
}

async function readJson(response: Response): Promise<unknown> {
  if (response.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    throw new StaffIncomeRequestError(502, "STAFF_INVALID_RESPONSE")
  }
  const reader = response.body?.getReader()
  if (!reader) throw new StaffIncomeRequestError(502, "STAFF_INVALID_RESPONSE")
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > 1_048_576) { await reader.cancel(); throw new StaffIncomeRequestError(502, "STAFF_INVALID_RESPONSE") }
      chunks.push(chunk.value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  let body: unknown
  try { body = JSON.parse(new TextDecoder().decode(bytes)) } catch { throw new StaffIncomeRequestError(502, "STAFF_INVALID_RESPONSE") }
  if (!response.ok) {
    const error = record(body) && record(body.error) ? body.error : null
    const code = error && typeof error.code === "string" ? error.code : "REQUEST_FAILED"
    throw new StaffIncomeRequestError(response.status, code)
  }
  return body
}

export async function readStaffIncome(month: string, accountId: string, signal: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<StaffIncomeEstimate> {
  if (!validIncomeMonth(month) || !identifier(accountId)) throw new StaffIncomeRequestError(400, "INVALID_QUERY")
  const response = await fetchImpl(`/api/staff/income/estimate?month=${month}`, {
    method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error", signal,
    headers: { Accept: "application/json", "X-Staff-Account-Id": accountId },
  })
  const estimate = parseStaffIncomeEstimate(await readJson(response), month)
  if (!estimate) throw new StaffIncomeRequestError(502, "STAFF_INVALID_RESPONSE")
  return estimate
}

export const INCOME_STATUS_LABELS: Record<StaffIncomeStatus, string> = {
  ASSIGNED: "Chờ tiếp nhận",
  ACCEPTED: "Đã tiếp nhận",
  IN_PROGRESS: "Đang thực hiện",
  DONE: "Hoàn thành",
  CANCELLED: "Đã hủy",
}
export const INCOME_REASON_LABELS: Record<StaffIncomeReason, string> = {
  OUTSIDE_COMPLETION_PERIOD: "Hoàn thành ngoài kỳ ghi nhận đang xem",
  STATUS_NOT_DONE: "Chưa hoàn thành nên không tính",
  MISSING_CHECK_TIMES: "Thiếu giờ check-in/check-out",
  INVALID_CHECK_TIMES: "Giờ check-out trước check-in",
}
const amountFormat = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 })
const momentFormat = new Intl.DateTimeFormat("vi-VN", {
  timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
})
export function formatIncomeVnd(amount: number): string {
  return Number.isSafeInteger(amount) ? `${amountFormat.format(amount)} ₫` : "Số tiền chưa hợp lệ"
}
export function formatIncomeMonth(month: string): string {
  return validIncomeMonth(month) ? `Tháng ${month.slice(5, 7)}/${month.slice(0, 4)}` : "Tháng chưa hợp lệ"
}
export function formatIncomeMoment(value: string | null): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "Chưa có"
  return momentFormat.format(new Date(value))
}
export function formatIncomeWindow(start: string, end: string): string {
  return `${formatIncomeMoment(start)} – ${formatIncomeMoment(end)}`
}
