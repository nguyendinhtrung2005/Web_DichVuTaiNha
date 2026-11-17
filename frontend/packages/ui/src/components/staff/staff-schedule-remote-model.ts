import { parseStaffJobsPayload, type RemoteStaffJob, type RemoteStaffJobsPayload, type RemoteStaffStatus } from "./staff-jobs-remote-model"

export type StaffCalendarView = "day" | "week" | "month" | "list"
export type StaffScheduleQuery = {
  from: string; to: string; status: "" | RemoteStaffStatus; page: number; pageSize: number; sort: "asc" | "desc"
  view: StaffCalendarView; anchor: string
}
export const STAFF_CALENDAR_VIEWS = { day: "Ngày", week: "Tuần", month: "Tháng", list: "Danh sách" } as const
const DAY = 86_400_000, VN_OFFSET = 7 * 3_600_000
const MIN_DAY = "1971-01-01", MAX_DAY = "2099-12-31"
// The Staff schedule contract uses UTC+07 for every supported year, including
// 1971–1975 when historical IANA offsets differ. Convert for display only;
// never change stored/API timestamps or the shared UC9/UC10 formatters.
const dayFormat = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" })
const scheduleTimeFormat = new Intl.DateTimeFormat("vi-VN", { timeZone: "UTC", hour: "2-digit", minute: "2-digit", hourCycle: "h23", day: "2-digit", month: "2-digit", year: "numeric" })

export function validScheduleDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < MIN_DAY || value > MAX_DAY) return false
  const time = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value
}
export function vietnamDayKey(value: Date | string = new Date()): string {
  const date = typeof value === "string" ? new Date(value) : value
  if (!Number.isFinite(date.getTime())) return ""
  const parts = dayFormat.formatToParts(new Date(date.getTime() + VN_OFFSET)), part = (name: string) => parts.find(item => item.type === name)?.value || ""
  return `${part("year")}-${part("month")}-${part("day")}`
}
export function formatStaffScheduleTime(value: string | null): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "Chưa có lịch thực hiện"
  const parts = scheduleTimeFormat.formatToParts(new Date(Date.parse(value) + VN_OFFSET))
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value || ""
  return `${part("hour")}:${part("minute")} · ${part("day")}/${part("month")}/${part("year")}`
}
export function scheduleDayLabel(value: string, weekday = false): string {
  if (!validScheduleDay(value)) return "Ngày chưa hợp lệ"
  const date = new Date(`${value}T12:00:00Z`)
  const week = weekday ? `${["Chủ nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"][date.getUTCDay()]}, ` : ""
  return `${week}${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}`
}
function dayNumber(value: string) { return Date.parse(`${value}T00:00:00Z`) }
function dayAt(time: number) { return new Date(time).toISOString().slice(0, 10) }
function addDays(value: string, count: number): string { return dayAt(dayNumber(value) + count * DAY) }
export function validateScheduleRange(from: string, to: string): string {
  if (!validScheduleDay(from) || !validScheduleDay(to)) return "Vui lòng chọn ngày hợp lệ trong khoảng 01/01/1971–31/12/2099."
  if (to < from) return "Ngày kết thúc phải bằng hoặc sau ngày bắt đầu."
  if ((dayNumber(to) - dayNumber(from)) / DAY > 365) return "Vui lòng chọn khoảng thời gian không quá 366 ngày."
  return ""
}
export function calendarRange(anchor: string, view: StaffCalendarView): { from: string; to: string } | null {
  if (!validScheduleDay(anchor)) return null
  const date = new Date(`${anchor}T00:00:00Z`)
  let from = anchor, to = anchor
  if (view === "month") {
    from = `${anchor.slice(0, 7)}-01`
    to = dayAt(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0))
  } else if (view !== "day") {
    from = addDays(anchor, -(date.getUTCDay() + 6) % 7)
    to = addDays(from, 6)
  }
  return { from: from < MIN_DAY ? MIN_DAY : from, to: to > MAX_DAY ? MAX_DAY : to }
}
export function defaultStaffScheduleQuery(now: Date = new Date()): StaffScheduleQuery {
  const today = vietnamDayKey(now), anchor = validScheduleDay(today) ? today : MIN_DAY
  const range = calendarRange(anchor, "week")!
  return { ...range, anchor, view: "week", status: "", page: 1, pageSize: 100, sort: "asc" }
}
export function shiftCalendarAnchor(anchor: string, view: StaffCalendarView, direction: number): string | null {
  if (!validScheduleDay(anchor) || ![-1, 1].includes(direction)) return null
  let next: string
  if (view === "month") {
    const date = new Date(`${anchor}T00:00:00Z`), month = date.getUTCMonth() + direction
    const first = new Date(Date.UTC(date.getUTCFullYear(), month, 1))
    const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
    next = dayAt(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(date.getUTCDate(), last)))
  } else next = addDays(anchor, direction * (view === "day" ? 1 : 7))
  return validScheduleDay(next) ? next : null
}
export function shiftScheduleQuery(query: StaffScheduleQuery, direction: number): StaffScheduleQuery | null {
  if (![-1, 1].includes(direction)) return null
  if (query.view === "list") {
    const span = (dayNumber(query.to) - dayNumber(query.from)) / DAY + 1
    const from = addDays(query.from, direction * span), to = addDays(query.to, direction * span)
    return validateScheduleRange(from, to) ? null : { ...query, from, to, anchor: from, page: 1 }
  }
  const anchor = shiftCalendarAnchor(query.anchor, query.view, direction)
  const range = anchor && calendarRange(anchor, query.view)
  return range && anchor ? { ...query, ...range, anchor, page: 1 } : null
}
export function parseStaffScheduleLocation(search: string, now: Date = new Date()): StaffScheduleQuery | null {
  const params = new URLSearchParams(search), defaults = defaultStaffScheduleQuery(now)
  const allowed = new Set(["from", "to", "status", "page", "pageSize", "sort", "view", "anchor"])
  for (const key of params.keys()) if (!allowed.has(key) || params.getAll(key).length !== 1) return null
  if (params.has("from") !== params.has("to")) return null
  const from = params.get("from") ?? defaults.from, to = params.get("to") ?? defaults.to
  if (validateScheduleRange(from, to)) return null
  const view = params.get("view") ?? (params.has("from") ? "list" : defaults.view)
  if (!Object.hasOwn(STAFF_CALENDAR_VIEWS, view)) return null
  const anchor = params.get("anchor") ?? (params.has("from") ? from : defaults.anchor)
  if (!validScheduleDay(anchor)) return null
  const rawStatus = params.get("status"), status = rawStatus === "ASSIGNED" ? "WAITING" : rawStatus
  if (status !== null && !["WAITING", "ACCEPTED", "IN_PROGRESS", "DONE", "CANCELLED"].includes(status)) return null
  const integer = (key: string, fallback: number, max: number) => {
    const raw = params.get(key)
    return raw === null ? fallback : /^[1-9]\d*$/.test(raw) && Number.isSafeInteger(Number(raw)) && Number(raw) <= max ? Number(raw) : null
  }
  const page = integer("page", 1, 100_000), pageSize = integer("pageSize", 100, 100), sort = params.get("sort") ?? "asc"
  if (page === null || pageSize === null || (sort !== "asc" && sort !== "desc")) return null
  return { from, to, anchor, view: view as StaffCalendarView, status: status as StaffScheduleQuery["status"] || "", page, pageSize, sort }
}
/** Only these six parameters reach UC11; view and anchor are local navigation state. */
export function staffScheduleQueryString(query: StaffScheduleQuery): string {
  const params = new URLSearchParams({ from: query.from, to: query.to, page: String(query.page), pageSize: String(query.pageSize), sort: query.sort })
  if (query.status) params.set("status", query.status)
  return params.toString()
}
export function staffScheduleHref(query: StaffScheduleQuery): string {
  const params = new URLSearchParams(staffScheduleQueryString(query))
  params.set("view", query.view); params.set("anchor", query.anchor)
  return `/lich-lam-viec?${params}`
}
export function scheduleDays(from: string, to: string): string[] {
  if (validateScheduleRange(from, to)) return []
  return Array.from({ length: (dayNumber(to) - dayNumber(from)) / DAY + 1 }, (_, index) => addDays(from, index))
}
export function scheduleDayStart(day: string): number { return validScheduleDay(day) ? dayNumber(day) - VN_OFFSET : Number.NaN }
export function parseStaffSchedulePayload(payload: unknown, query: StaffScheduleQuery): RemoteStaffJobsPayload | null {
  const result = parseStaffJobsPayload(payload)
  if (!result || result.pagination.page !== query.page || result.pagination.pageSize !== query.pageSize) return null
  const start = scheduleDayStart(query.from), end = scheduleDayStart(query.to) + DAY
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  for (const job of result.data) {
    if (query.status && job.status !== query.status) return null
    if (job.scheduledAt !== null && job.expectedEndAt !== null && !(Date.parse(job.scheduledAt) < end && Date.parse(job.expectedEndAt) > start)) return null
  }
  return result
}
export function groupScheduleByDay(jobs: RemoteStaffJob[], from: string, to: string): { days: { day: string; jobs: RemoteStaffJob[] }[]; unplaced: RemoteStaffJob[] } {
  const days = scheduleDays(from, to).map(day => ({ day, jobs: [] as RemoteStaffJob[] })), unplaced: RemoteStaffJob[] = []
  for (const job of jobs) {
    const start = job.scheduledAt === null ? Number.NaN : Date.parse(job.scheduledAt)
    const end = job.expectedEndAt === null ? Number.NaN : Date.parse(job.expectedEndAt)
    let placed = false
    if (Number.isFinite(start) && Number.isFinite(end)) for (const entry of days) {
      const dayStart = scheduleDayStart(entry.day)
      if (start < dayStart + DAY && end > dayStart) { entry.jobs.push(job); placed = true }
    }
    if (!placed) unplaced.push(job)
  }
  return { days, unplaced }
}
