import { type RemoteStaffStatus } from "./staff-jobs-remote-model"
import { calendarRange, parseStaffSchedulePayload, staffScheduleHref, staffScheduleQueryString, validateScheduleRange, vietnamDayKey, type StaffScheduleQuery } from "./staff-schedule-remote-model"

export type StaffStatisticsRange = { from: string; to: string }
export const STAFF_STATISTIC_METRICS = [
  { status: "", key: "ALL", label: "Tất cả trạng thái" },
  { status: "WAITING", key: "WAITING", label: "Chờ tiếp nhận" },
  { status: "ACCEPTED", key: "ACCEPTED", label: "Đã tiếp nhận" },
  { status: "IN_PROGRESS", key: "IN_PROGRESS", label: "Đang thực hiện" },
  { status: "DONE", key: "DONE", label: "Trạng thái DONE" },
  { status: "CANCELLED", key: "CANCELLED", label: "Đã hủy" },
] as const
export type StaffStatisticStatus = "" | RemoteStaffStatus

export function defaultStaffStatisticsRange(now: Date = new Date()): StaffStatisticsRange {
  return calendarRange(vietnamDayKey(now), "month") || { from: "1971-01-01", to: "1971-01-31" }
}
/** Calendar presets use Vietnam dates; the same start-date basis as the operational report. */
export function staffStatisticsPresetRange(preset: "day" | "week" | "month", now: Date = new Date()): StaffStatisticsRange | null {
  const range = calendarRange(vietnamDayKey(now), preset)
  return range && !validateScheduleRange(range.from, range.to) ? range : null
}
/** Only calendar bounds belong to this URL, never another employee or an unsupported filter. */
export function parseStaffStatisticsLocation(search: string, now: Date = new Date()): StaffStatisticsRange | null {
  const params = new URLSearchParams(search)
  for (const key of params.keys()) if (!["from", "to"].includes(key) || params.getAll(key).length !== 1) return null
  if (params.has("from") !== params.has("to")) return null
  const fallback = defaultStaffStatisticsRange(now)
  const from = params.get("from") ?? fallback.from, to = params.get("to") ?? fallback.to
  return validateScheduleRange(from, to) ? null : { from, to }
}
export function staffStatisticsHref(range: StaffStatisticsRange): string {
  return "/thong-ke-cong-viec?" + new URLSearchParams({ from: range.from, to: range.to })
}
function scheduleQuery(range: StaffStatisticsRange, status: StaffStatisticStatus, pageSize = 1): StaffScheduleQuery {
  return { from: range.from, to: range.to, status, page: 1, pageSize, sort: "asc", view: "list", anchor: range.from }
}
export function staffStatisticsScheduleHref(range: StaffStatisticsRange, status: StaffStatisticStatus): string {
  return staffScheduleHref(scheduleQuery(range, status, 100))
}
export class StaffStatisticRequestError extends Error {
  constructor(readonly status: number, readonly code: string) { super("Staff statistic request failed") }
}
export function staffStatisticMessage(error: unknown): string {
  if (!(error instanceof StaffStatisticRequestError)) return "Chưa thể đọc số liệu. Vui lòng kiểm tra kết nối và thử lại."
  if (error.status === 401) return "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại."
  if (error.status === 403) return "Tài khoản hiện không có quyền xem số liệu công việc."
  if (error.status === 429) return "Vui lòng chờ một lúc rồi thử lại."
  if (error.status === 400) return "Khoảng lịch hẹn chưa hợp lệ. Vui lòng chọn lại."
  return "Số liệu chưa đọc được. Vui lòng thử lại hoặc liên hệ người quản lý."
}
/** One query, one current-status total. Never combine these independent reads into a snapshot.
 * Validate the existing assignment DTO, then retain only its pagination.total, without personal data. */
export async function readStaffStatistic(range: StaffStatisticsRange, status: StaffStatisticStatus, signal: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<number> {
  if (validateScheduleRange(range.from, range.to) || !STAFF_STATISTIC_METRICS.some(metric => metric.status === status)) throw new StaffStatisticRequestError(400, "INVALID_QUERY")
  const query = scheduleQuery(range, status)
  const response = await fetchImpl("/api/staff/schedule?" + staffScheduleQueryString(query), {
    method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error", signal, headers: { Accept: "application/json" },
  })
  if (response.status !== 200) { await response.body?.cancel(); throw new StaffStatisticRequestError(response.status, "REQUEST_FAILED") }
  if (response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new StaffStatisticRequestError(502, "INVALID_RESPONSE")
  const reader = response.body?.getReader()
  if (!reader) throw new StaffStatisticRequestError(502, "INVALID_RESPONSE")
  const chunks: Uint8Array[] = []; let size = 0
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      size += part.value.byteLength
      if (size > 2_097_152) { await reader.cancel(); throw new StaffStatisticRequestError(502, "INVALID_RESPONSE") }
      chunks.push(part.value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(size); let offset = 0
  for (const part of chunks) { bytes.set(part, offset); offset += part.byteLength }
  let body: unknown
  try { body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) } catch { throw new StaffStatisticRequestError(502, "INVALID_RESPONSE") }
  const payload = parseStaffSchedulePayload(body, query)
  if (!payload || payload.data.length !== Math.min(payload.pagination.total, 1)
    || payload.data.some(job => !job.scheduledAt || !job.expectedEndAt || Date.parse(job.expectedEndAt) <= Date.parse(job.scheduledAt))) throw new StaffStatisticRequestError(502, "INVALID_RESPONSE")
  return payload.pagination.total
}
