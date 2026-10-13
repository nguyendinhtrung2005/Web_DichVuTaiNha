const pad = (n: number) => String(n).padStart(2, "0")

export function formatCurrency(value: number) {
  return `${Math.round(value).toLocaleString("vi-VN")} ₫`
}

export function formatDate(iso: string | Date) {
  const d = typeof iso === "string" ? new Date(iso) : iso
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`
}

export function formatTime(iso: string | Date) {
  const d = typeof iso === "string" ? new Date(iso) : iso
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function formatDateTime(iso: string | Date) {
  return `${formatTime(iso)} ${formatDate(iso)}`
}

export function formatDuration(minutes: number) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m} phút`
  return m === 0 ? `${h} giờ` : `${h} giờ ${m} phút`
}

export function toDateInputValue(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function startOfDay(d: Date) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

export function addDays(d: Date, days: number) {
  const x = new Date(d)
  x.setDate(x.getDate() + days)
  return x
}

export function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

export function startOfWeek(d: Date) {
  const x = startOfDay(d)
  const day = (x.getDay() + 6) % 7
  return addDays(x, -day)
}

export const WEEKDAY_SHORT = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"]

export function weekdayLabel(d: Date) {
  const idx = (d.getDay() + 6) % 7
  return idx === 6 ? "Chủ nhật" : `Thứ ${idx + 2}`
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/)
  return (parts.length > 1 ? parts[parts.length - 2][0] + parts[parts.length - 1][0] : parts[0]?.[0] ?? "").toUpperCase()
}

export function inDateRange(iso: string, from?: string, to?: string) {
  const d = new Date(iso)
  if (from && d < startOfDay(new Date(from))) return false
  if (to) {
    const end = startOfDay(new Date(to))
    end.setDate(end.getDate() + 1)
    if (d >= end) return false
  }
  return true
}
