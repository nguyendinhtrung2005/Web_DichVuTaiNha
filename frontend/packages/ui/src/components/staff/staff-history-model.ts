import { parseStaffJobsPayload, parseStaffJobsQuery, staffJobsQueryString, type RemoteStaffJobsPayload, type StaffJobsQuery } from "./staff-jobs-remote-model"

export const DEFAULT_STAFF_HISTORY_QUERY: StaffJobsQuery = { status: "DONE", page: 1, pageSize: 20, sort: "desc" }

/** History has a fixed DONE filter; URL state never selects another account or status. */
export function parseStaffHistoryQuery(search: string): StaffJobsQuery | null {
  const params = new URLSearchParams(search)
  for (const key of params.keys()) if (!["page", "pageSize", "sort"].includes(key) || params.getAll(key).length !== 1) return null
  params.set("status", "DONE")
  if (!params.has("sort")) params.set("sort", "desc")
  return parseStaffJobsQuery(params.toString())
}
export function staffHistoryHref(query: StaffJobsQuery): string {
  const params = new URLSearchParams(staffJobsQueryString({ ...query, status: "DONE" }))
  params.delete("status")
  return "/lich-su?" + params
}
export function staffHistoryDetailHref(id: string): string {
  return /^[1-9]\d{0,18}$/.test(id) && BigInt(id) <= 9_223_372_036_854_775_807n ? "/don/" + id : "/lich-su"
}
export function parseStaffHistoryPayload(value: unknown, query: StaffJobsQuery): RemoteStaffJobsPayload | null {
  const result = parseStaffJobsPayload(value)
  if (!result || query.status !== "DONE" || result.pagination.page !== query.page || result.pagination.pageSize !== query.pageSize
    || result.data.some(job => job.status !== "DONE")
    || result.data.length !== Math.min(query.pageSize, Math.max(0, result.pagination.total - (query.page - 1) * query.pageSize))) return null
  return result
}
export class StaffHistoryRequestError extends Error {
  constructor(readonly status: number, readonly code: string) { super("Staff history request failed") }
}
export function staffHistoryMessage(error: unknown): string {
  if (!(error instanceof StaffHistoryRequestError)) return "Chưa thể tải lịch sử. Vui lòng kiểm tra kết nối và thử lại."
  if (error.status === 401) return "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại."
  if (error.status === 403) return "Tài khoản hiện không có quyền xem lịch sử công việc."
  if (error.status === 429) return "Bạn đã gửi nhiều yêu cầu. Vui lòng chờ một lúc rồi thử lại."
  if (error.status === 400) return "Tham số lịch sử chưa hợp lệ. Vui lòng quay về trang đầu."
  if (error.status === 502) return "Thông tin lịch sử chưa đọc được. Vui lòng thử lại hoặc liên hệ người quản lý."
  return "Lịch sử công việc hiện chưa khả dụng. Vui lòng thử lại sau."
}
export async function readStaffHistory(query: StaffJobsQuery, signal: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<RemoteStaffJobsPayload> {
  const safe = parseStaffHistoryQuery(new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize), sort: query.sort }).toString())
  if (query.status !== "DONE" || !safe) throw new StaffHistoryRequestError(400, "INVALID_QUERY")
  const response = await fetchImpl("/api/staff/jobs?" + staffJobsQueryString(safe), {
    method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error", signal, headers: { Accept: "application/json" },
  })
  if ([401, 403].includes(response.status)) { await response.body?.cancel(); throw new StaffHistoryRequestError(response.status, "ACCESS_DENIED") }
  if (response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") throw new StaffHistoryRequestError(502, "INVALID_RESPONSE")
  const reader = response.body?.getReader()
  if (!reader) throw new StaffHistoryRequestError(502, "INVALID_RESPONSE")
  const chunks: Uint8Array[] = []; let size = 0
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      size += part.value.byteLength
      if (size > 2_097_152) { await reader.cancel(); throw new StaffHistoryRequestError(502, "INVALID_RESPONSE") }
      chunks.push(part.value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(size); let offset = 0
  for (const part of chunks) { bytes.set(part, offset); offset += part.byteLength }
  let body: unknown
  try { body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) } catch { throw new StaffHistoryRequestError(502, "INVALID_RESPONSE") }
  if (!response.ok) throw new StaffHistoryRequestError(response.status, "REQUEST_FAILED")
  const payload = parseStaffHistoryPayload(body, safe)
  if (!payload) throw new StaffHistoryRequestError(502, "INVALID_RESPONSE")
  return payload
}
