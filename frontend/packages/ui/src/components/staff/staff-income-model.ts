export type IncomeSource = "WORK" | "BONUS" | "ALLOWANCE" | "ADJUSTMENT"
export type IncomeStatus = "PAID" | "PENDING"
export type IncomeEntry = {
  id: string; source: IncomeSource; reference: string | null; description: string
  amountVnd: string; recognizedAt: string; status: IncomeStatus; paidAt: string | null
}
export type IncomeQuery = {
  from: string; to: string; granularity: "day" | "month"; source: IncomeSource | ""; status: IncomeStatus | ""
}
export type IncomeReport = {
  kind: "demo" | "remote"; query: IncomeQuery; entries: IncomeEntry[]
  summary: { totalVnd: string; paidVnd: string; pendingVnd: string; adjustmentVnd: string }
  buckets: { key: string; label: string; amountVnd: string }[]
  sources: { source: IncomeSource; amountVnd: string }[]
}
/** UI boundary only. A future Payment adapter must map an owner-approved DTO here. */
export interface IncomeAdapter {
  readonly kind: "demo" | "unavailable" | "remote"
  read(query: IncomeQuery, signal?: AbortSignal): Promise<IncomeReport | null>
  detail(id: string, signal?: AbortSignal): Promise<IncomeEntry | null>
  reset(): Promise<void>
}
export const INCOME_SOURCES: readonly IncomeSource[] = ["WORK", "BONUS", "ALLOWANCE", "ADJUSTMENT"]
export const INCOME_STATUSES: readonly IncomeStatus[] = ["PAID", "PENDING"]
export const SOURCE_LABELS: Record<IncomeSource, string> = {
  WORK: "Tiền công", BONUS: "Thưởng", ALLOWANCE: "Phụ cấp", ADJUSTMENT: "Điều chỉnh",
}
export const STATUS_LABELS: Record<IncomeStatus, string> = { PAID: "Đã thanh toán / đối trừ", PENDING: "Chờ thanh toán / đối trừ" }
const DAY = 86_400_000, VN = 7 * 3_600_000, MIN_DAY = "1971-01-01", MAX_DAY = "2099-12-31"
const amountPattern = /^(?:0|-?[1-9]\d*)$/
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
function validDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < MIN_DAY || value > MAX_DAY) return false
  const time = Date.parse(value + "T00:00:00.000Z")
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value
}
function at(value: string) { return Date.parse(value + "T00:00:00.000Z") }
function day(time: number) { return new Date(time).toISOString().slice(0, 10) }
function monthRange(year: number, month: number) {
  return { from: day(Date.UTC(year, month, 1)), to: day(Date.UTC(year, month + 1, 0)) }
}
function yearRange(year: number) { return { from: String(year) + "-01-01", to: String(year) + "-12-31" } }
export function incomeDayKey(value: Date | string = new Date()): string {
  const time = typeof value === "string" ? Date.parse(value) : value.getTime()
  return Number.isFinite(time) ? day(time + VN) : ""
}
export function formatIncomeDate(value: string | null): string {
  if (!value || !timestampPattern.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) return "Chưa có thông tin"
  const shifted = new Date(Date.parse(value) + VN).toISOString()
  return shifted.slice(8, 10) + "/" + shifted.slice(5, 7) + "/" + shifted.slice(0, 4) + " · " + shifted.slice(11, 16)
}
export function formatIncomeVnd(value: string): string {
  if (!amountPattern.test(value) || value.length > 40) throw new RangeError("Invalid VND integer")
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 }).format(BigInt(value))
}
export function validateIncomeQuery(query: IncomeQuery): string {
  if (!query || !validDay(query.from) || !validDay(query.to)) return "Chọn ngày hợp lệ từ 01/01/1971 đến 31/12/2099."
  if (query.to < query.from) return "Ngày kết thúc phải bằng hoặc sau ngày bắt đầu."
  if ((at(query.to) - at(query.from)) / DAY > 365) return "Khoảng thời gian tối đa 366 ngày, tính cả hai ngày đã chọn."
  if (query.granularity !== "day" && query.granularity !== "month") return "Chọn thống kê theo ngày hoặc tháng."
  if (query.source !== "" && !INCOME_SOURCES.includes(query.source)) return "Nguồn thu nhập chưa hợp lệ."
  if (query.status !== "" && !INCOME_STATUSES.includes(query.status)) return "Trạng thái chưa hợp lệ."
  return ""
}
export function defaultIncomeQuery(now = new Date()): IncomeQuery {
  const today = incomeDayKey(now)
  const anchor = validDay(today) ? today : "2026-10-01"
  const date = new Date(anchor + "T00:00:00.000Z")
  return { ...monthRange(date.getUTCFullYear(), date.getUTCMonth()), granularity: "day", source: "", status: "" }
}
export function incomeQueryFromSearch(search: string, now = new Date()): IncomeQuery | null {
  if (search.length > 4096) return null
  const params = new URLSearchParams(search), allowed = ["from", "to", "granularity", "source", "status"]
  for (const key of params.keys()) if (!allowed.includes(key) || params.getAll(key).length !== 1) return null
  const defaults = defaultIncomeQuery(now)
  if (params.has("from") !== params.has("to")) return null
  const query: IncomeQuery = {
    from: params.get("from") ?? defaults.from, to: params.get("to") ?? defaults.to,
    granularity: (params.get("granularity") ?? "day") as IncomeQuery["granularity"],
    source: (params.get("source") ?? "") as IncomeQuery["source"], status: (params.get("status") ?? "") as IncomeQuery["status"],
  }
  return validateIncomeQuery(query) ? null : query
}
export function incomeHref(query: IncomeQuery): string {
  if (validateIncomeQuery(query)) throw new RangeError("Invalid income query")
  const params = new URLSearchParams({ from: query.from, to: query.to, granularity: query.granularity })
  if (query.source) params.set("source", query.source)
  if (query.status) params.set("status", query.status)
  return "/thu-nhap?" + params.toString()
}
export function setIncomeGranularity(query: IncomeQuery, granularity: IncomeQuery["granularity"]): IncomeQuery {
  if (validateIncomeQuery(query) || !["day", "month"].includes(granularity)) throw new RangeError("Invalid income query")
  const date = new Date(query.from + "T00:00:00.000Z")
  const range = granularity === "day" ? monthRange(date.getUTCFullYear(), date.getUTCMonth()) : yearRange(date.getUTCFullYear())
  return { ...query, ...range, granularity }
}
export function shiftIncomePeriod(query: IncomeQuery, delta: number): IncomeQuery {
  if (validateIncomeQuery(query) || !Number.isInteger(delta)) throw new RangeError("Invalid income period")
  const date = new Date(query.from + "T00:00:00.000Z")
  if (query.granularity === "month") {
    const year = Math.max(1971, Math.min(2099, date.getUTCFullYear() + delta))
    return { ...query, ...yearRange(year) }
  }
  const months = Math.max(1971 * 12, Math.min(2099 * 12 + 11, date.getUTCFullYear() * 12 + date.getUTCMonth() + delta))
  return { ...query, ...monthRange(Math.floor(months / 12), months % 12) }
}
function validTimestamp(value: string) {
  return timestampPattern.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
}
function assertEntry(entry: IncomeEntry) {
  if (!entry || typeof entry.id !== "string" || !/^DEMO-INCOME-[A-Z0-9-]+$/.test(entry.id)
    || !INCOME_SOURCES.includes(entry.source) || !INCOME_STATUSES.includes(entry.status)
    || typeof entry.amountVnd !== "string" || !amountPattern.test(entry.amountVnd) || entry.amountVnd.length > 40
    || !validTimestamp(entry.recognizedAt) || typeof entry.description !== "string"
    || (entry.reference !== null && !/^DEMO-CV-[A-Z0-9-]+$/.test(entry.reference))
    || (entry.status === "PAID" ? !entry.paidAt || !validTimestamp(entry.paidAt) || entry.paidAt < entry.recognizedAt : entry.paidAt !== null)) throw new RangeError("Invalid isolated demo entry")
}
/** Every aggregate comes from the same full filtered cohort, never from a table page. */
export function buildIncomeReport(entries: readonly IncomeEntry[], query: IncomeQuery): IncomeReport {
  if (validateIncomeQuery(query)) throw new RangeError("Invalid income query")
  const ids = new Set<string>()
  for (const entry of entries) { assertEntry(entry); if (ids.has(entry.id)) throw new RangeError("Duplicate demo entry"); ids.add(entry.id) }
  const filtered = entries.filter(entry => {
    const recognizedDay = incomeDayKey(entry.recognizedAt)
    return recognizedDay >= query.from && recognizedDay <= query.to && (!query.source || entry.source === query.source) && (!query.status || entry.status === query.status)
  }).map(entry => ({ ...entry })).sort((a, b) => b.recognizedAt.localeCompare(a.recognizedAt) || a.id.localeCompare(b.id))
  let total = 0n, paid = 0n, pending = 0n, adjustment = 0n
  const sourceTotals: Record<IncomeSource, bigint> = { WORK: 0n, BONUS: 0n, ALLOWANCE: 0n, ADJUSTMENT: 0n }
  const bucketTotals = new Map<string, bigint>()
  if (query.granularity === "day") {
    for (let time = at(query.from); time <= at(query.to); time += DAY) bucketTotals.set(day(time), 0n)
  } else {
    const last = query.to.slice(0, 7)
    for (let key = query.from.slice(0, 7); key <= last;) {
      bucketTotals.set(key, 0n)
      const [year, month] = key.split("-").map(Number)
      key = day(Date.UTC(year, month, 1)).slice(0, 7)
    }
  }
  for (const entry of filtered) {
    const value = BigInt(entry.amountVnd)
    total += value
    if (entry.status === "PAID") paid += value
    else pending += value
    if (entry.source === "ADJUSTMENT") adjustment += value
    sourceTotals[entry.source] += value
    const key = incomeDayKey(entry.recognizedAt).slice(0, query.granularity === "day" ? 10 : 7)
    bucketTotals.set(key, (bucketTotals.get(key) ?? 0n) + value)
  }
  return {
    kind: "demo", query: { ...query }, entries: filtered,
    summary: { totalVnd: String(total), paidVnd: String(paid), pendingVnd: String(pending), adjustmentVnd: String(adjustment) },
    buckets: [...bucketTotals].map(([key, amount]) => ({ key, label: query.granularity === "day" ? key.slice(8, 10) + "/" + key.slice(5, 7) : "T" + key.slice(5, 7) + "/" + key.slice(0, 4), amountVnd: String(amount) })),
    sources: INCOME_SOURCES.map(source => ({ source, amountVnd: String(sourceTotals[source]) })),
  }
}
