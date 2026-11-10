import { parseStaffJobsPayload, staffJobsQueryString, type RemoteStaffJob, type RemoteStaffJobsPayload, type RemoteStaffStatus } from "./staff-jobs-remote-model"
import { parseStaffSchedulePayload, staffScheduleQueryString, validScheduleDay, type StaffScheduleQuery } from "./staff-schedule-remote-model"

export const DASHBOARD_PREVIEW_SIZE = 4
export type DashboardResult<T> = { data: T; error: null } | { data: null; error: string }
export type StaffDashboardData = {
  today: DashboardResult<RemoteStaffJobsPayload>
  waiting: DashboardResult<RemoteStaffJobsPayload>
  progress: DashboardResult<RemoteStaffJobsPayload>
  done: DashboardResult<RemoteStaffJobsPayload>
  upcoming: DashboardResult<RemoteStaffJob[]>
  accessDenied: boolean
}
export function dashboardPeriods(day: string) {
  if (!validScheduleDay(day)) throw new Error("INVALID_DASHBOARD_DAY")
  const shift = (days: number) => new Date(Date.parse(day + "T00:00:00Z") + days * 86400000).toISOString().slice(0, 10)
  const from = shift(1), to = shift(30)
  return { today: day, upcoming: validScheduleDay(from) ? { from, to: to > "2099-12-31" ? "2099-12-31" : to } : null }
}
function scheduleQuery(from: string, to: string, status: "" | RemoteStaffStatus): StaffScheduleQuery {
  return { from, to, status, page: 1, pageSize: DASHBOARD_PREVIEW_SIZE, sort: "asc", view: "list", anchor: from }
}
class DashboardError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code) }
}
function message(reason: unknown): string {
  if (reason instanceof DashboardError) {
    if (reason.status === 401) return "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại."
    if (reason.status === 403) return "Tài khoản hiện không có quyền xem công việc."
    if (reason.status === 429) return "Vui lòng chờ một lúc rồi thử tải lại."
    if (reason.code === "CHANGED_DURING_READ") return "Lịch công việc vừa thay đổi. Vui lòng tải lại."
    if (reason.code === "INVALID_RESPONSE") return "Thông tin chưa đọc được. Vui lòng tải lại."
  }
  return "Chưa thể tải thông tin. Vui lòng kiểm tra kết nối và thử lại."
}
async function read(path: string, signal: AbortSignal, fetchImpl: typeof fetch): Promise<unknown> {
  const response = await fetchImpl(path, { method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error", signal, headers: { Accept: "application/json" } })
  if (!response.ok) { await response.body?.cancel(); throw new DashboardError(response.status, "DEPENDENCY_ERROR") }
  if (response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new DashboardError(502, "INVALID_RESPONSE")
  const reader = response.body?.getReader()
  if (!reader) throw new DashboardError(502, "INVALID_RESPONSE")
  const chunks: Uint8Array[] = []; let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 2097152) { await reader.cancel(); throw new DashboardError(502, "INVALID_RESPONSE") }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(size); let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) }
  catch { throw new DashboardError(502, "INVALID_RESPONSE") }
}
/** First four per disjoint active status suffice for the first four of their union.
 * Never add their totals: independent HTTP reads are not an atomic aggregate. */
export function upcomingDashboardPreview(partitions: RemoteStaffJobsPayload[]): RemoteStaffJob[] {
  const seen = new Set<string>(), jobs: RemoteStaffJob[] = []
  for (const partition of partitions) for (const job of partition.data) {
    if (seen.has(job.assignmentId)) throw new DashboardError(409, "CHANGED_DURING_READ")
    if (!job.scheduledAt) throw new DashboardError(502, "INVALID_RESPONSE")
    seen.add(job.assignmentId); jobs.push(job)
  }
  return jobs.sort((a, b) => Date.parse(a.scheduledAt!) - Date.parse(b.scheduledAt!)
    || (BigInt(a.assignmentId) < BigInt(b.assignmentId) ? -1 : BigInt(a.assignmentId) > BigInt(b.assignmentId) ? 1 : 0)).slice(0, DASHBOARD_PREVIEW_SIZE)
}
export async function readStaffDashboard(day: string, signal: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<StaffDashboardData> {
  const periods = dashboardPeriods(day)
  const schedule = async (from: string, to: string, status: "" | RemoteStaffStatus) => {
    const query = scheduleQuery(from, to, status)
    const result = parseStaffSchedulePayload(await read("/api/staff/schedule?" + staffScheduleQueryString(query), signal, fetchImpl), query)
    if (!result || result.data.length !== Math.min(result.pagination.total, DASHBOARD_PREVIEW_SIZE)) throw new DashboardError(502, "INVALID_RESPONSE")
    return result
  }
  const count = async (status: RemoteStaffStatus) => {
    const result = parseStaffJobsPayload(await read("/api/staff/jobs?" + staffJobsQueryString({ status, page: 1, pageSize: 1, sort: "asc" }), signal, fetchImpl))
    if (!result || result.pagination.page !== 1 || result.pagination.pageSize !== 1 || result.data.some(job => job.status !== status)) throw new DashboardError(502, "INVALID_RESPONSE")
    return result
  }
  const upcoming = periods.upcoming
    ? (async () => {
      const entries = await Promise.allSettled((["WAITING", "ACCEPTED", "IN_PROGRESS"] as const).map(status => schedule(periods.upcoming!.from, periods.upcoming!.to, status)))
      const failure = entries.find(entry => entry.status === "rejected" && entry.reason instanceof DashboardError && [401, 403].includes(entry.reason.status)) || entries.find(entry => entry.status === "rejected")
      if (failure?.status === "rejected") throw failure.reason
      return upcomingDashboardPreview(entries.map(entry => { if (entry.status !== "fulfilled") throw new DashboardError(503, "UNAVAILABLE"); return entry.value }))
    })()
    : Promise.reject(new DashboardError(400, "PERIOD_UNAVAILABLE"))
  const settled = await Promise.allSettled([schedule(day, day, ""), count("WAITING"), count("IN_PROGRESS"), count("DONE"), upcoming])
  const result = <T,>(entry: PromiseSettledResult<unknown>): DashboardResult<T> => entry.status === "fulfilled"
    ? { data: entry.value as T, error: null } : { data: null, error: message(entry.reason) }
  return {
    today: result<RemoteStaffJobsPayload>(settled[0]), waiting: result<RemoteStaffJobsPayload>(settled[1]),
    progress: result<RemoteStaffJobsPayload>(settled[2]), done: result<RemoteStaffJobsPayload>(settled[3]),
    upcoming: result<RemoteStaffJob[]>(settled[4]),
    accessDenied: settled.some(entry => entry.status === "rejected" && entry.reason instanceof DashboardError && [401, 403].includes(entry.reason.status)),
  }
}
