export type DemoArea = { id: string; name: string; description: string; branch: string; status: "ACTIVE" | "PAUSED" }
export type Area = DemoArea
export type DemoShift = { id: string; areaId: string; date: string; label: string; startAt: string; endAt: string; status: "OPEN" | "FULL" | "CANCELLED" }
export type AreaPreferences = { selectedAreaIds: string[]; available: boolean }
export type AreasSnapshot = { areas: DemoArea[]; shifts: DemoShift[]; preferences: AreaPreferences; registeredShiftIds: string[]; weekFrom: string; weekTo: string }
/** Frontend presentation boundary; this is not an approved Backend DTO. */
export interface AreasDemoAdapter {
  readonly kind: "demo" | "unavailable" | "remote"
  read(weekFrom: string, signal?: AbortSignal): Promise<AreasSnapshot | null>
  savePreferences(preferences: AreaPreferences, weekFrom: string, signal?: AbortSignal): Promise<AreasSnapshot>
  register(shiftId: string, weekFrom: string, signal?: AbortSignal): Promise<AreasSnapshot>
  cancel(shiftId: string, weekFrom: string, signal?: AbortSignal): Promise<AreasSnapshot>
  detail(shiftId: string, weekFrom: string, signal?: AbortSignal): Promise<DemoShift | null>
  reset(weekFrom: string, signal?: AbortSignal): Promise<AreasSnapshot | null>
}
export class AreasDemoError extends Error {
  constructor(message: string) { super(message); this.name = "AreasDemoError" }
}
const DAY = 86_400_000, OFFSET = 7 * 3_600_000
const DATE = /^\d{4}-\d{2}-\d{2}$/
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
export function isAreasDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE.test(value) || value < "1971-01-01" || value > "2099-12-31") return false
  const parsed = Date.parse(value + "T00:00:00.000Z")
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value
}
function assertDate(value: unknown): asserts value is string {
  if (!isAreasDate(value)) throw new AreasDemoError("Ngày minh họa phải hợp lệ trong khoảng 1971–2099.")
}
function canonicalTime(value: unknown): value is string {
  return typeof value === "string" && ISO.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
}
export function vietnamDate(value: Date): string {
  if (!value || !Number.isFinite(value.getTime())) throw new AreasDemoError("Chưa xác định được ngày minh họa.")
  const result = new Date(value.getTime() + OFFSET).toISOString().slice(0, 10); assertDate(result); return result
}
export function addDays(value: string, amount: number): string {
  assertDate(value)
  if (!Number.isInteger(amount) || Math.abs(amount) > 36600) throw new AreasDemoError("Khoảng chuyển ngày minh họa không hợp lệ.")
  const result = new Date(Date.parse(value + "T00:00:00.000Z") + amount * DAY).toISOString().slice(0, 10); assertDate(result); return result
}
export function weekStart(value: string): string {
  assertDate(value); const day = new Date(value + "T00:00:00.000Z").getUTCDay(); return addDays(value, -((day + 6) % 7))
}
export function formatDay(value: string): string { return isAreasDate(value) ? value.slice(8, 10) + "/" + value.slice(5, 7) + "/" + value.slice(0, 4) : "Ngày không hợp lệ" }
export function formatShiftTime(value: string): string { return canonicalTime(value) ? new Date(Date.parse(value) + OFFSET).toISOString().slice(11, 16) : "Giờ không hợp lệ" }
const AREAS: readonly Readonly<DemoArea>[] = Object.freeze([
  { id: "DEMO-AREA-CENTRE", name: "Khu Trung tâm Minh Họa", description: "Vùng phục vụ giả lập A; không mô tả địa chỉ booking hoặc khu vực được phân công thật.", branch: "Chi nhánh Minh Họa", status: "ACTIVE" },
  { id: "DEMO-AREA-GARDEN", name: "Khu Vườn Minh Họa", description: "Vùng phục vụ giả lập B để trải nghiệm chọn khu vực và kiểm tra trùng ca.", branch: "Chi nhánh Minh Họa", status: "ACTIVE" },
  { id: "DEMO-AREA-RIVER", name: "Khu Ven sông Minh Họa", description: "Vùng giả lập đang tạm dừng; chưa mở lựa chọn hoặc ca trong bộ minh họa.", branch: "Chi nhánh Minh Họa", status: "PAUSED" },
].map(value => Object.freeze(value as DemoArea)))
export function demoAreas(): DemoArea[] { return AREAS.map(value => ({ ...value })) }
export function defaultAreaPreferences(): AreaPreferences { return { selectedAreaIds: ["DEMO-AREA-CENTRE"], available: false } }
export function validatePreferences(input: unknown, areas: readonly DemoArea[] = demoAreas()): AreaPreferences {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new AreasDemoError("Lựa chọn minh họa không hợp lệ.")
  const value = input as Record<string, unknown>
  if (Object.keys(value).length !== 2 || !Object.prototype.hasOwnProperty.call(value, "selectedAreaIds") || !Object.prototype.hasOwnProperty.call(value, "available")
    || typeof value.available !== "boolean" || !Array.isArray(value.selectedAreaIds) || value.selectedAreaIds.length > areas.length
    || value.selectedAreaIds.some(id => typeof id !== "string" || !areas.some(area => area.id === id && area.status === "ACTIVE"))
    || new Set(value.selectedAreaIds).size !== value.selectedAreaIds.length) throw new AreasDemoError("Chỉ chọn các khu vực minh họa đang hoạt động; không được chọn trùng.")
  if (value.available && !value.selectedAreaIds.length) throw new AreasDemoError("Hãy chọn ít nhất một khu vực trước khi bật sẵn sàng minh họa.")
  return { selectedAreaIds: [...value.selectedAreaIds] as string[], available: value.available }
}
export function validateShift(input: unknown): DemoShift {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new AreasDemoError("Ca minh họa không hợp lệ.")
  const value = input as DemoShift
  if (typeof value.id !== "string" || !/^DEMO-SHIFT-[A-Z0-9-]{1,100}$/.test(value.id) || !AREAS.some(area => area.id === value.areaId && area.status === "ACTIVE")
    || !isAreasDate(value.date) || typeof value.label !== "string" || !value.label.trim() || value.label.length > 80
    || !["OPEN", "FULL", "CANCELLED"].includes(value.status) || !canonicalTime(value.startAt) || !canonicalTime(value.endAt)
    || value.startAt >= value.endAt || vietnamDate(new Date(value.startAt)) !== value.date || vietnamDate(new Date(value.endAt)) !== value.date) throw new AreasDemoError("Giờ bắt đầu/kết thúc, ngày hoặc trạng thái ca minh họa không hợp lệ.")
  return { id: value.id, areaId: value.areaId, date: value.date, label: value.label, startAt: value.startAt, endAt: value.endAt, status: value.status }
}
export function shiftsOverlap(a: Pick<DemoShift, "startAt" | "endAt">, b: Pick<DemoShift, "startAt" | "endAt">): boolean {
  if (!canonicalTime(a.startAt) || !canonicalTime(a.endAt) || !canonicalTime(b.startAt) || !canonicalTime(b.endAt) || a.startAt >= a.endAt || b.startAt >= b.endAt) throw new AreasDemoError("Khung giờ minh họa không hợp lệ.")
  return a.startAt < b.endAt && b.startAt < a.endAt
}
export function demoShifts(weekFrom: string): DemoShift[] {
  assertDate(weekFrom)
  if (weekStart(weekFrom) !== weekFrom) throw new AreasDemoError("Tuần minh họa phải bắt đầu vào thứ Hai.")
  addDays(weekFrom, 6)
  const slots = [{ id: "MORNING", label: "Ca sáng", start: "08:00", end: "12:00" }, { id: "AFTERNOON", label: "Ca chiều", start: "13:00", end: "17:00" }, { id: "EVENING", label: "Ca tối", start: "18:00", end: "21:00" }]
  const result: DemoShift[] = []
  for (let day = 0; day < 7; day++) for (const area of AREAS.filter(value => value.status === "ACTIVE")) for (const slot of slots) {
    const date = addDays(weekFrom, day)
    result.push(validateShift({ id: "DEMO-SHIFT-" + date + "-" + area.id.slice(10) + "-" + slot.id, areaId: area.id, date, label: slot.label,
      startAt: new Date(date + "T" + slot.start + ":00+07:00").toISOString(), endAt: new Date(date + "T" + slot.end + ":00+07:00").toISOString(),
      status: day === 2 && area.id === "DEMO-AREA-CENTRE" && slot.id === "AFTERNOON" ? "FULL" : day === 4 && area.id === "DEMO-AREA-GARDEN" && slot.id === "EVENING" ? "CANCELLED" : "OPEN" }))
  }
  return result
}
