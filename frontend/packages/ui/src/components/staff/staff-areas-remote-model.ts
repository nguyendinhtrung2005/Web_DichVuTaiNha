/** Read-only Staff areas DTOs. service_area JSON is passed through, never reinterpreted. */
export type StaffBranch = {
  id: string
  name: string | null
  addressText: string | null
  serviceArea: unknown
  latitude: string | null
  longitude: string | null
  status: string | null
}
export type StaffBranchPayload = { data: StaffBranch; timezone: "Asia/Ho_Chi_Minh" }
export type StaffAvailability = { id: string; startsAt: string; endsAt: string; status: string | null }
export type StaffAvailabilityPayload = {
  data: StaffAvailability[]
  range: { from: string; to: string; timezone: "Asia/Ho_Chi_Minh" }
  truncated: boolean
  branchId: string
}
export type StaffAreasWeek = { from: string; to: string }

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
function identifier(value: unknown): value is string {
  return typeof value === "string" && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9_223_372_036_854_775_807n
}
function nullableText(value: unknown, max = 20000): value is string | null {
  return value === null || (typeof value === "string" && value.length <= max)
}
function decimal(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && /^-?\d{1,20}(?:\.\d{1,10})?$/.test(value))
}
function timestamp(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
}

export function parseStaffBranch(value: unknown): StaffBranchPayload | null {
  if (!record(value) || value.timezone !== "Asia/Ho_Chi_Minh" || !record(value.data)) return null
  const data = value.data
  if (!identifier(data.id) || !nullableText(data.name, 150) || !nullableText(data.addressText)
    || !nullableText(data.status, 40) || !decimal(data.latitude) || !decimal(data.longitude)
    || !(data.serviceArea === null || typeof data.serviceArea === "object")) return null
  return {
    data: {
      id: data.id, name: data.name, addressText: data.addressText, serviceArea: data.serviceArea,
      latitude: data.latitude, longitude: data.longitude, status: data.status,
    },
    timezone: "Asia/Ho_Chi_Minh",
  }
}

export function parseStaffAvailability(value: unknown, week: StaffAreasWeek): StaffAvailabilityPayload | null {
  if (!record(value) || !Array.isArray(value.data) || value.data.length > 500
    || typeof value.truncated !== "boolean" || !identifier(value.branchId) || !record(value.range)
    || value.range.from !== week.from || value.range.to !== week.to || value.range.timezone !== "Asia/Ho_Chi_Minh") return null
  const data: StaffAvailability[] = []
  const seen = new Set<string>()
  for (const entry of value.data) {
    if (!record(entry) || !identifier(entry.id) || !timestamp(entry.startsAt) || !timestamp(entry.endsAt)
      || Date.parse(entry.endsAt) <= Date.parse(entry.startsAt) || !nullableText(entry.status, 40)) return null
    if (seen.has(entry.id)) return null
    seen.add(entry.id)
    data.push({ id: entry.id, startsAt: entry.startsAt, endsAt: entry.endsAt, status: entry.status })
  }
  if (value.truncated && data.length !== 500) return null
  return { data, range: { from: week.from, to: week.to, timezone: "Asia/Ho_Chi_Minh" }, truncated: value.truncated, branchId: value.branchId }
}

/** Only a plain list of names is displayable; any other JSON shape stays unexplained. */
export function serviceAreaLabels(serviceArea: unknown): string[] {
  if (!Array.isArray(serviceArea)) return []
  const labels = serviceArea.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0 && entry.length <= 120)
  return labels.length === serviceArea.length ? labels : []
}

const vnDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" })
export function vietnamToday(now: Date = new Date()): string {
  const parts = vnDate.formatToParts(now)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || ""
  return `${part("year")}-${part("month")}-${part("day")}`
}
export function addDays(date: string, amount: number): string {
  const time = Date.parse(date + "T00:00:00Z") + amount * 86400000
  return new Date(time).toISOString().slice(0, 10)
}
/** Monday-based week containing the given Vietnam calendar date. */
export function weekStart(date: string): string {
  const weekday = new Date(Date.parse(date + "T00:00:00Z")).getUTCDay()
  return addDays(date, -((weekday + 6) % 7))
}
export function weekRange(date: string): StaffAreasWeek {
  const from = weekStart(date)
  return { from, to: addDays(from, 6) }
}

const dayLabel = new Intl.DateTimeFormat("vi-VN", { timeZone: "UTC", weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" })
const timeLabel = new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
export function formatStaffDay(date: string): string {
  const value = new Date(date + "T00:00:00Z")
  if (!Number.isFinite(value.getTime())) return "Ngày không hợp lệ"
  const label = dayLabel.format(value)
  return label.charAt(0).toUpperCase() + label.slice(1)
}
export function formatStaffWindow(startsAt: string, endsAt: string): string {
  const start = new Date(startsAt), end = new Date(endsAt)
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return "Chưa rõ thời gian"
  return `${timeLabel.format(start)}–${timeLabel.format(end)}`
}
/** Vietnam calendar date of a stored UTC instant, used to group availability windows. */
export function staffDayOf(instant: string): string {
  return vietnamToday(new Date(instant))
}
