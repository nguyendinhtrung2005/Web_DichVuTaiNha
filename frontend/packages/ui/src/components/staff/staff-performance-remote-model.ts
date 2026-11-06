import type { RemoteStaffJob } from "./staff-jobs-remote-model"
import { parseStaffSchedulePayload, staffScheduleQueryString, validateScheduleRange, type StaffScheduleQuery } from "./staff-schedule-remote-model"
import { staffStatisticMessage, StaffStatisticRequestError, type StaffStatisticsRange } from "./staff-work-statistics-model"
import { summarizeStaffPerformance, type StaffPerformance } from "./staff-performance-model"

const PAGE_SIZE = 100
/** 5 pages = 500 assignments; a wider range must be narrowed instead of silently truncated. */
const MAX_PAGES = 5
const MAX_BODY = 2_097_152

function scheduleQuery(range: StaffStatisticsRange, page: number): StaffScheduleQuery {
  return { from: range.from, to: range.to, status: "", page, pageSize: PAGE_SIZE, sort: "asc", view: "list", anchor: range.from }
}

async function readBody(response: Response): Promise<unknown> {
  if (response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new StaffStatisticRequestError(502, "INVALID_RESPONSE")
  const reader = response.body?.getReader()
  if (!reader) throw new StaffStatisticRequestError(502, "INVALID_RESPONSE")
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      size += part.value.byteLength
      if (size > MAX_BODY) { await reader.cancel(); throw new StaffStatisticRequestError(502, "INVALID_RESPONSE") }
      chunks.push(part.value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const part of chunks) { bytes.set(part, offset); offset += part.byteLength }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) } catch { throw new StaffStatisticRequestError(502, "INVALID_RESPONSE") }
}

/**
 * Reads every assignment of the range through the existing Staff BFF, then derives
 * operational metrics from the public DTO only. No salary, revenue or booking price
 * is read, and no write is performed.
 *
 * Pagination is treated as a consistency problem, not as an opportunity to guess:
 * a changed total or a range above 500 rows fails explicitly instead of producing
 * a partial "rate".
 */
export async function readStaffPerformance(range: StaffStatisticsRange, signal: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<StaffPerformance> {
  if (validateScheduleRange(range.from, range.to)) throw new StaffStatisticRequestError(400, "INVALID_RANGE")
  const jobs: RemoteStaffJob[] = []
  const seen = new Set<string>()
  let expectedTotal: number | null = null
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const selected = scheduleQuery(range, page)
    const response = await fetchImpl("/api/staff/schedule?" + staffScheduleQueryString(selected), {
      method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error", signal, headers: { Accept: "application/json" },
    })
    if (response.status !== 200) { await response.body?.cancel(); throw new StaffStatisticRequestError(response.status, "REQUEST_FAILED") }
    const payload = parseStaffSchedulePayload(await readBody(response), selected)
    if (!payload) throw new StaffStatisticRequestError(502, "INVALID_RESPONSE")
    if (expectedTotal === null) expectedTotal = payload.pagination.total
    else if (payload.pagination.total !== expectedTotal) throw new StaffStatisticRequestError(409, "TOTAL_CHANGED")
    for (const job of payload.data) {
      if (seen.has(job.assignmentId)) throw new StaffStatisticRequestError(409, "TOTAL_CHANGED")
      seen.add(job.assignmentId)
      jobs.push(job)
    }
    if (jobs.length >= expectedTotal || payload.pagination.totalPages <= page) break
  }
  if (expectedTotal === null) throw new StaffStatisticRequestError(502, "INVALID_RESPONSE")
  if (jobs.length !== expectedTotal) throw new StaffStatisticRequestError(expectedTotal > PAGE_SIZE * MAX_PAGES ? 413 : 502, expectedTotal > PAGE_SIZE * MAX_PAGES ? "RANGE_TOO_LARGE" : "INVALID_RESPONSE")
  // Schedule returns overlapping appointments. This report is explicitly based
  // on scheduled_start in the selected Vietnam dates, not every overlap.
  const start = Date.parse(range.from + "T00:00:00+07:00")
  const end = Date.parse(range.to + "T00:00:00+07:00") + 86_400_000
  return summarizeStaffPerformance(jobs.filter(job => job.scheduledAt !== null
    && Date.parse(job.scheduledAt) >= start && Date.parse(job.scheduledAt) < end))
}

/** Explicit, non-destructive messages for the two consistency failures. */
export function staffPerformanceMessage(error: unknown): string {
  if (error instanceof StaffStatisticRequestError && error.code === "RANGE_TOO_LARGE") return "Khoảng thời gian có quá nhiều phân công để tính chỉ số (tối đa 500). Vui lòng chọn khoảng ngắn hơn."
  if (error instanceof StaffStatisticRequestError && error.code === "TOTAL_CHANGED") return "Dữ liệu phân công vừa thay đổi trong lúc đọc. Vui lòng thử lại để có số liệu nhất quán."
  return staffStatisticMessage(error)
}
