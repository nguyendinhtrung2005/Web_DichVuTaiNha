/** Illustrative Staff support tickets only; this is not an approved Admin ticket DTO. */
export type SupportStatus = "NEW" | "IN_PROGRESS" | "RESOLVED"
export type SupportPriority = "LOW" | "NORMAL" | "HIGH"
export type SupportTopic = "SCHEDULE" | "SUPPLIES" | "PROCESS" | "OTHER"
export type SupportFilter = { status: "ALL" | SupportStatus }
export type SupportTicketInput = { subject: string; content: string; topic: SupportTopic; priority: SupportPriority; relatedJob: string }
export type DemoTicketResponse = { id: string; body: string; at: string; source: "DEMO" }
export type DemoTicketHistory = { status: SupportStatus; at: string; note: string }
export type DemoTicket = {
  id: string
  subject: string
  content: string
  topic: SupportTopic
  priority: SupportPriority
  relatedJob: string
  status: SupportStatus
  createdAt: string
  updatedAt: string
  responses: DemoTicketResponse[]
  history: DemoTicketHistory[]
}
export type SupportCounts = Record<"ALL" | SupportStatus, number>
export type SupportSnapshot = { filter: SupportFilter; tickets: DemoTicket[]; filtered: DemoTicket[]; counts: SupportCounts; total: number }
/** Frontend presentation boundary; an Admin ticket API adapter can replace this without touching the UI. */
export interface SupportDemoAdapter {
  readonly kind: "demo" | "unavailable"
  list(filter: SupportFilter, signal?: AbortSignal): Promise<SupportSnapshot | null>
  detail(id: string, signal?: AbortSignal): Promise<DemoTicket | null>
  create(input: SupportTicketInput, signal?: AbortSignal): Promise<{ ticket: DemoTicket; snapshot: SupportSnapshot } | null>
  sampleReply(id: string, signal?: AbortSignal): Promise<DemoTicketResponse | null>
  reset(signal?: AbortSignal): Promise<SupportSnapshot | null>
}
export class SupportDemoError extends Error {
  constructor(message: string) { super(message); this.name = "SupportDemoError" }
}
export const SUPPORT_DISCLAIMER = "Yêu cầu, trạng thái và phản hồi ở đây là giả định DEMO; không phải ticket Admin thật, không gửi email/hotline và không ghi Backend."
export const SUPPORT_STATUSES = ["NEW", "IN_PROGRESS", "RESOLVED"] as const
export const SUPPORT_STATUS_LABELS: Record<SupportStatus, string> = { NEW: "Mới", IN_PROGRESS: "Đang xử lý", RESOLVED: "Đã giải quyết" }
export const SUPPORT_TOPICS = ["SCHEDULE", "SUPPLIES", "PROCESS", "OTHER"] as const
export const SUPPORT_TOPIC_LABELS: Record<SupportTopic, string> = { SCHEDULE: "Lịch làm việc", SUPPLIES: "Vật tư & dụng cụ", PROCESS: "Quy trình & ứng dụng", OTHER: "Khác" }
export const SUPPORT_PRIORITIES = ["LOW", "NORMAL", "HIGH"] as const
export const SUPPORT_PRIORITY_LABELS: Record<SupportPriority, string> = { LOW: "Thấp", NORMAL: "Bình thường", HIGH: "Cao" }
export const SUPPORT_JOBS = Object.freeze([
  { id: "DEMO-JOB-101", label: "Ca dọn dẹp nhà · 24/10/2026" },
  { id: "DEMO-JOB-102", label: "Ca vệ sinh văn phòng · 26/10/2026" },
  { id: "DEMO-JOB-103", label: "Ca giặt ghế sofa · 28/10/2026" },
  { id: "DEMO-JOB-104", label: "Ca chăm sóc cây · 30/10/2026" },
] as const)
const JOB_IDS = new Set<string>(SUPPORT_JOBS.map(value => value.id))
const DAY = 86_400_000, OFFSET = 7 * 3_600_000
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const TICKET_ID = /^DEMO-SUP-\d{3}$/, REPLY_ID = /^DEMO-REPLY-\d{3}$/
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
const PHONE = /(?:\+?84|0)\d{8,10}/
const SEED_TIME = "2026-10-31T03:00:00.000Z"
const SAMPLE_REPLY_IDS: Record<SupportTopic, string> = { SCHEDULE: "DEMO-REPLY-901", SUPPLIES: "DEMO-REPLY-902", PROCESS: "DEMO-REPLY-903", OTHER: "DEMO-REPLY-904" }
const SAMPLE_REPLIES: Record<SupportTopic, string> = {
  SCHEDULE: "Phản hồi mẫu DEMO: Lịch minh họa sẽ được kiểm tra lại trong phiên này. Không có Admin tiếp nhận và không có thay đổi lịch thật.",
  SUPPLIES: "Phản hồi mẫu DEMO: Danh sách dụng cụ minh họa sẽ được đối chiếu trong phiên này. Không có yêu cầu cấp vật tư thật nào được gửi.",
  PROCESS: "Phản hồi mẫu DEMO: Góp ý quy trình được ghi nhận trong bản minh họa để xem lại sau. Không phải phản hồi chính thức của CleanHome.",
  OTHER: "Phản hồi mẫu DEMO: Nội dung này chỉ dùng để minh họa cách hiển thị phản hồi. Không gửi đến Admin, email hay hotline.",
}
export function isSupportTime(value: unknown): value is string {
  return typeof value === "string" && ISO.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
}
function assertTime(value: unknown): asserts value is string {
  if (!isSupportTime(value)) throw new SupportDemoError("Thời điểm minh họa không hợp lệ.")
}
/** Vietnam time (UTC+7) for an illustrative ticket timestamp. */
export function formatSupportTime(value: string): string {
  if (!isSupportTime(value)) return "Thời gian không hợp lệ"
  const date = new Date(Date.parse(value) + OFFSET)
  const pad = (number: number) => String(number).padStart(2, "0")
  return pad(date.getUTCDate()) + "/" + pad(date.getUTCMonth() + 1) + "/" + date.getUTCFullYear() + " · " + pad(date.getUTCHours()) + ":" + pad(date.getUTCMinutes())
}
export function supportDay(value: string): string {
  if (!isSupportTime(value)) throw new SupportDemoError("Thời điểm minh họa không hợp lệ.")
  return new Date(Date.parse(value) + OFFSET).toISOString().slice(0, 10)
}
export function relatedJobLabel(id: string): string {
  return SUPPORT_JOBS.find(value => value.id === id)?.label || "Không liên kết công việc"
}
export function emptySupportDraft(): SupportTicketInput {
  return { subject: "", content: "", topic: "SCHEDULE", priority: "NORMAL", relatedJob: "" }
}
export function isSupportDraftPristine(input: SupportTicketInput): boolean {
  return !input.subject.trim() && !input.content.trim() && input.topic === "SCHEDULE" && input.priority === "NORMAL" && input.relatedJob === ""
}
export function defaultSupportFilter(): SupportFilter { return { status: "ALL" } }
export function validateSupportFilter(input: unknown): SupportFilter {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new SupportDemoError("Bộ lọc yêu cầu minh họa không hợp lệ.")
  const value = input as Record<string, unknown>
  if (Object.keys(value).length !== 1 || !Object.prototype.hasOwnProperty.call(value, "status")) throw new SupportDemoError("Bộ lọc minh họa chỉ nhận trạng thái.")
  if (value.status !== "ALL" && !SUPPORT_STATUSES.includes(value.status as SupportStatus)) throw new SupportDemoError("Trạng thái lọc phải là Tất cả, Mới, Đang xử lý hoặc Đã giải quyết.")
  return { status: value.status as "ALL" | SupportStatus }
}
function assertNoSensitiveText(value: string, label: string) {
  if (EMAIL.test(value) || PHONE.test(value)) throw new SupportDemoError(label + " không được chứa email hoặc số điện thoại, kể cả trong bản DEMO.")
}
export function validateTicketInput(input: unknown): SupportTicketInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new SupportDemoError("Yêu cầu hỗ trợ minh họa không hợp lệ.")
  const value = input as Record<string, unknown>
  const keys = Object.keys(value)
  if (keys.length !== 5 || !["subject", "content", "topic", "priority", "relatedJob"].every(key => Object.prototype.hasOwnProperty.call(value, key))) throw new SupportDemoError("Yêu cầu minh họa chỉ nhận chủ đề, nội dung, mức ưu tiên và công việc liên quan.")
  if (typeof value.subject !== "string") throw new SupportDemoError("Chủ đề phải là văn bản.")
  const subject = value.subject.trim()
  if (subject.length < 5 || subject.length > 120) throw new SupportDemoError("Chủ đề phải từ 5 đến 120 ký tự.")
  if (typeof value.content !== "string") throw new SupportDemoError("Nội dung phải là văn bản.")
  const content = value.content.trim()
  if (content.length < 10 || content.length > 1000) throw new SupportDemoError("Nội dung phải từ 10 đến 1000 ký tự.")
  if (!SUPPORT_TOPICS.includes(value.topic as SupportTopic)) throw new SupportDemoError("Chủ đề hỗ trợ không hợp lệ.")
  if (!SUPPORT_PRIORITIES.includes(value.priority as SupportPriority)) throw new SupportDemoError("Mức ưu tiên không hợp lệ.")
  if (typeof value.relatedJob !== "string" || (value.relatedJob !== "" && !JOB_IDS.has(value.relatedJob))) throw new SupportDemoError("Công việc liên quan phải là một ca DEMO đã cho hoặc để trống.")
  assertNoSensitiveText(subject, "Chủ đề")
  assertNoSensitiveText(content, "Nội dung")
  return { subject, content, topic: value.topic as SupportTopic, priority: value.priority as SupportPriority, relatedJob: value.relatedJob }
}
export function validateTicketResponse(input: unknown): DemoTicketResponse {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new SupportDemoError("Phản hồi mẫu minh họa không hợp lệ.")
  const value = input as Record<string, unknown>
  if (Object.keys(value).length !== 4 || !["id", "body", "at", "source"].every(key => Object.prototype.hasOwnProperty.call(value, key))) throw new SupportDemoError("Phản hồi mẫu chỉ nhận nội dung, thời điểm và nguồn DEMO.")
  if (typeof value.id !== "string" || !REPLY_ID.test(value.id) || typeof value.body !== "string" || value.body.trim().length < 1 || value.body.length > 1000 || value.source !== "DEMO") throw new SupportDemoError("Nội dung phản hồi mẫu không hợp lệ.")
  assertTime(value.at)
  return { id: value.id, body: value.body, at: value.at, source: "DEMO" }
}
export function validateTicketHistory(input: unknown): DemoTicketHistory {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new SupportDemoError("Lịch sử trạng thái minh họa không hợp lệ.")
  const value = input as Record<string, unknown>
  if (Object.keys(value).length !== 3 || !["status", "at", "note"].every(key => Object.prototype.hasOwnProperty.call(value, key))) throw new SupportDemoError("Lịch sử trạng thái chỉ nhận trạng thái, thời điểm và ghi chú.")
  if (!SUPPORT_STATUSES.includes(value.status as SupportStatus) || typeof value.note !== "string" || !value.note.trim() || value.note.length > 240) throw new SupportDemoError("Trạng thái hoặc ghi chú lịch sử minh họa không hợp lệ.")
  assertTime(value.at)
  return { status: value.status as SupportStatus, at: value.at, note: value.note }
}
export function validateTicket(input: unknown): DemoTicket {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new SupportDemoError("Yêu cầu hỗ trợ minh họa không hợp lệ.")
  const value = input as Record<string, unknown>
  const keys = ["id", "subject", "content", "topic", "priority", "relatedJob", "status", "createdAt", "updatedAt", "responses", "history"]
  if (Object.keys(value).length !== keys.length || !keys.every(key => Object.prototype.hasOwnProperty.call(value, key))) throw new SupportDemoError("Yêu cầu minh họa chỉ nhận các trường hiển thị đã duyệt.")
  if (typeof value.id !== "string" || !TICKET_ID.test(value.id) || typeof value.subject !== "string" || !value.subject.trim() || value.subject.length > 120
    || typeof value.content !== "string" || !value.content.trim() || value.content.length > 1000
    || !SUPPORT_TOPICS.includes(value.topic as SupportTopic) || !SUPPORT_PRIORITIES.includes(value.priority as SupportPriority)
    || typeof value.relatedJob !== "string" || (value.relatedJob !== "" && !JOB_IDS.has(value.relatedJob))
    || !SUPPORT_STATUSES.includes(value.status as SupportStatus)) throw new SupportDemoError("Nội dung yêu cầu minh họa không hợp lệ.")
  assertTime(value.createdAt); assertTime(value.updatedAt)
  if (value.createdAt > value.updatedAt) throw new SupportDemoError("Thời điểm cập nhật không được trước thời điểm tạo.")
  if (!Array.isArray(value.responses) || value.responses.length > 20 || !Array.isArray(value.history) || value.history.length < 1 || value.history.length > 20) throw new SupportDemoError("Danh sách phản hồi hoặc lịch sử minh họa không hợp lệ.")
  return {
    id: value.id, subject: value.subject, content: value.content, topic: value.topic as SupportTopic, priority: value.priority as SupportPriority,
    relatedJob: value.relatedJob, status: value.status as SupportStatus, createdAt: value.createdAt, updatedAt: value.updatedAt,
    responses: value.responses.map(validateTicketResponse), history: value.history.map(validateTicketHistory),
  }
}
const SEED_TICKETS: readonly DemoTicket[] = Object.freeze([
  {
    id: "DEMO-SUP-001", subject: "Thiếu dụng cụ trong ca vệ sinh văn phòng",
    content: "Ca minh họa ngày 24/10 cần thêm khăn lau kính và găng tay. Tôi muốn hỏi quy trình bổ sung dụng cụ trong bản DEMO.",
    topic: "SUPPLIES", priority: "HIGH", relatedJob: "DEMO-JOB-102", status: "NEW",
    createdAt: "2026-10-30T02:15:00.000Z", updatedAt: "2026-10-30T02:15:00.000Z", responses: [],
    history: [{ status: "NEW", at: "2026-10-30T02:15:00.000Z", note: "Ticket minh họa được tạo trong DEMO; chưa có Admin tiếp nhận." }],
  },
  {
    id: "DEMO-SUP-002", subject: "Cần xác nhận thay đổi lịch ca sáng",
    content: "Tôi muốn xác nhận cách đổi ca sáng 24/10 sang khung giờ khác trong bản minh họa. Nội dung này không gửi đến Admin.",
    topic: "SCHEDULE", priority: "NORMAL", relatedJob: "DEMO-JOB-101", status: "IN_PROGRESS",
    createdAt: "2026-10-28T01:20:00.000Z", updatedAt: "2026-10-29T03:10:00.000Z",
    responses: [{ id: "DEMO-REPLY-001", body: "Phản hồi mẫu DEMO: Lịch minh họa đang được xem lại trong phiên này. Không có Admin tiếp nhận và không có thay đổi lịch thật.", at: "2026-10-29T03:10:00.000Z", source: "DEMO" }],
    history: [
      { status: "NEW", at: "2026-10-28T01:20:00.000Z", note: "Ticket minh họa được tạo trong DEMO; chưa có Admin tiếp nhận." },
      { status: "IN_PROGRESS", at: "2026-10-29T03:10:00.000Z", note: "Trạng thái minh họa do DEMO đặt; không phải Admin đã tiếp nhận." },
    ],
  },
  {
    id: "DEMO-SUP-003", subject: "Góp ý bước check-in trong ứng dụng",
    content: "Bước check-in minh họa cần thêm ghi chú ảnh trước khi bắt đầu ca. Đây là góp ý giả lập, không phải yêu cầu thật.",
    topic: "PROCESS", priority: "NORMAL", relatedJob: "", status: "RESOLVED",
    createdAt: "2026-10-20T06:40:00.000Z", updatedAt: "2026-10-22T02:30:00.000Z",
    responses: [
      { id: "DEMO-REPLY-002", body: "Phản hồi mẫu DEMO: Góp ý quy trình đã được ghi nhận trong bản minh họa để xem lại sau. Không phải phản hồi chính thức của CleanHome.", at: "2026-10-21T04:00:00.000Z", source: "DEMO" },
      { id: "DEMO-REPLY-003", body: "Phản hồi mẫu DEMO: Trạng thái đã giải quyết chỉ là giả định của DEMO; không xác nhận Admin đã xử lý thật.", at: "2026-10-22T02:30:00.000Z", source: "DEMO" },
    ],
    history: [
      { status: "NEW", at: "2026-10-20T06:40:00.000Z", note: "Ticket minh họa được tạo trong DEMO; chưa có Admin tiếp nhận." },
      { status: "IN_PROGRESS", at: "2026-10-21T04:00:00.000Z", note: "Trạng thái minh họa do DEMO đặt; không phải Admin đã tiếp nhận." },
      { status: "RESOLVED", at: "2026-10-22T02:30:00.000Z", note: "Trạng thái minh họa do DEMO đặt; không xác nhận Admin đã xử lý." },
    ],
  },
  {
    id: "DEMO-SUP-004", subject: "Hỏi về nội dung hiển thị trong trang Cá nhân",
    content: "Tôi muốn hỏi bản DEMO có lưu thông tin cá nhân hay không. Nội dung chỉ dùng để minh họa giao diện.",
    topic: "OTHER", priority: "LOW", relatedJob: "DEMO-JOB-104", status: "RESOLVED",
    createdAt: "2026-10-10T02:00:00.000Z", updatedAt: "2026-10-11T07:20:00.000Z",
    responses: [{ id: "DEMO-REPLY-004", body: "Phản hồi mẫu DEMO: Bản minh họa chỉ giữ trạng thái trong bộ nhớ trang và không lưu thông tin cá nhân vào storage hay Backend.", at: "2026-10-11T07:20:00.000Z", source: "DEMO" }],
    history: [
      { status: "NEW", at: "2026-10-10T02:00:00.000Z", note: "Ticket minh họa được tạo trong DEMO; chưa có Admin tiếp nhận." },
      { status: "IN_PROGRESS", at: "2026-10-10T09:00:00.000Z", note: "Trạng thái minh họa do DEMO đặt; không phải Admin đã tiếp nhận." },
      { status: "RESOLVED", at: "2026-10-11T07:20:00.000Z", note: "Trạng thái minh họa do DEMO đặt; không xác nhận Admin đã xử lý." },
    ],
  },
].map(value => Object.freeze(value as DemoTicket)))
export function demoTickets(): DemoTicket[] { return SEED_TICKETS.map(value => validateTicket(value)) }
export function countTickets(tickets: readonly DemoTicket[]): SupportCounts {
  const counts: SupportCounts = { ALL: 0, NEW: 0, IN_PROGRESS: 0, RESOLVED: 0 }
  for (const ticket of tickets) { const item = validateTicket(ticket); counts.ALL += 1; counts[item.status] += 1 }
  return counts
}
export function filterTickets(tickets: readonly DemoTicket[], filter: SupportFilter): DemoTicket[] {
  const value = validateSupportFilter(filter)
  return tickets.map(ticket => validateTicket(ticket)).filter(ticket => value.status === "ALL" || ticket.status === value.status)
}
export function sampleReplyFor(topic: SupportTopic, updatedAt: string): DemoTicketResponse {
  if (!SUPPORT_TOPICS.includes(topic)) throw new SupportDemoError("Chủ đề phản hồi mẫu không hợp lệ.")
  assertTime(updatedAt)
  return validateTicketResponse({ id: SAMPLE_REPLY_IDS[topic], body: SAMPLE_REPLIES[topic], at: new Date(Date.parse(updatedAt) + 3_600_000).toISOString(), source: "DEMO" })
}
export function supportSeedTime(index: number): string {
  const offset = Math.max(0, Math.trunc(index)) * 60_000
  return new Date(Date.parse(SEED_TIME) + offset).toISOString()
}
export { DAY as SUPPORT_DAY_MS }
