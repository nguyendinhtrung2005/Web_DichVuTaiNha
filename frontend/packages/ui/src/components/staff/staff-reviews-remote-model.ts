import { parseReviewsPayload } from "./staff-reviews-contract.mjs"

export type StaffReviewsQuery = { from: string; to: string; rating: number | null; page: number; pageSize: number }
export type StaffReview = { id: string; rating: number; createdAt: string; comment: string | null; serviceLabel: string | null }
export type StaffReviewsPayload = {
  data: StaffReview[]
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
  summary: { total: number; average: number | null; distribution: Record<string, number> }
}
export class StaffReviewsError extends Error {
  constructor(readonly status: number, readonly code: string) { super("Staff review request failed") }
}
export function staffReviewsMessage(error: unknown): string {
  if (!(error instanceof StaffReviewsError)) return "Chưa thể tải đánh giá. Vui lòng kiểm tra kết nối và thử lại."
  if (error.status === 401) return "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại."
  if (error.status === 403) return "Tài khoản không có quyền xem đánh giá."
  if (error.status === 409) return "Tài khoản đăng nhập đã thay đổi. Vui lòng tải lại trang."
  if (error.status === 429) return "Vui lòng chờ một lúc rồi thử lại."
  if (error.status === 400) return "Bộ lọc đánh giá chưa hợp lệ. Vui lòng kiểm tra lại."
  return "Dịch vụ đánh giá chưa đọc được dữ liệu hợp lệ. Vui lòng thử lại."
}
async function body(response: Response): Promise<unknown> {
  if (response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new StaffReviewsError(502, "INVALID_RESPONSE")
  const reader = response.body?.getReader()
  if (!reader) throw new StaffReviewsError(502, "INVALID_RESPONSE")
  const chunks: Uint8Array[] = []; let size = 0
  try {
    while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 262144) throw new StaffReviewsError(502, "INVALID_RESPONSE"); chunks.push(part.value) }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
  const bytes = new Uint8Array(size); let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) } catch { throw new StaffReviewsError(502, "INVALID_RESPONSE") }
}
export async function readStaffReviews(query: StaffReviewsQuery, accountScope: string, signal: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<StaffReviewsPayload> {
  const params = new URLSearchParams({ from: query.from, to: query.to, page: String(query.page) })
  if (query.rating !== null) params.set("rating", String(query.rating))
  const response = await fetchImpl("/api/staff/reviews?" + params, { method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error", signal,
    headers: { Accept: "application/json", "X-Staff-Account-Id": accountScope } })
  if (response.status !== 200) {
    let code = "REQUEST_FAILED"
    try { const value = await body(response) as { error?: { code?: unknown } }; if (value?.error?.code === "REVIEWS_NOT_AVAILABLE") code = "REVIEWS_NOT_AVAILABLE" } catch { /* Do not echo upstream messages. */ }
    throw new StaffReviewsError(response.status, code)
  }
  const parsed = parseReviewsPayload(await body(response), query)
  if (!parsed) throw new StaffReviewsError(502, "INVALID_RESPONSE")
  return parsed as StaffReviewsPayload
}
