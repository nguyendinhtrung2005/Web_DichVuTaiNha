import { AreasDemoError, addDays, defaultAreaPreferences, demoAreas, demoShifts, shiftsOverlap, validatePreferences, validateShift, type AreaPreferences, type AreasDemoAdapter, type AreasSnapshot, type DemoShift } from "./staff-areas-demo-model"
export { AreasDemoError } from "./staff-areas-demo-model"
function abort(signal?: AbortSignal) { if (signal?.aborted) throw new DOMException("Demo operation aborted", "AbortError") }
function unavailable(): AreasDemoAdapter {
  const reject = () => { throw new AreasDemoError("Khu vực và ca làm minh họa chưa được bật.") }
  return { kind: "unavailable", async read(_week, signal) { abort(signal); return null }, async detail(_id, _week, signal) { abort(signal); return null }, async reset(_week, signal) { abort(signal); return null },
    async savePreferences(_value, _week, signal) { abort(signal); return reject() }, async register(_id, _week, signal) { abort(signal); return reject() }, async cancel(_id, _week, signal) { abort(signal); return reject() } }
}
/** Account IDs scope private component instances; content never comes from Auth, booking addresses or UC events. */
export function createAreasDemoAdapter({ enabled, accountScope, now = () => new Date() }: { enabled: boolean; accountScope: string; now?: () => Date }): AreasDemoAdapter {
  if (enabled !== true || process.env.NODE_ENV !== "development" || typeof accountScope !== "string" || !/^[1-9]\d{0,18}$/.test(accountScope) || BigInt(accountScope) > 9_223_372_036_854_775_807n) return unavailable()
  let preferences = defaultAreaPreferences()
  const registered = new Map<string, DemoShift>()
  function timestamp(): string { const value = now(); if (!value || !Number.isFinite(value.getTime())) throw new AreasDemoError("Chưa xác định được thời gian minh họa. Vui lòng thử lại."); return value.toISOString() }
  function snapshot(weekFrom: string, shifts = demoShifts(weekFrom)): AreasSnapshot {
    return { areas: demoAreas(), shifts: shifts.map(value => ({ ...value })), preferences: { selectedAreaIds: [...preferences.selectedAreaIds], available: preferences.available }, registeredShiftIds: [...registered.keys()].sort(), weekFrom, weekTo: addDays(weekFrom, 6) }
  }
  async function prepare(weekFrom: string, signal?: AbortSignal) { abort(signal); await Promise.resolve(); abort(signal); return demoShifts(weekFrom) }
  return {
    kind: "demo",
    async read(weekFrom, signal) { const shifts = await prepare(weekFrom, signal); return snapshot(weekFrom, shifts) },
    async detail(id, weekFrom, signal) { const shifts = await prepare(weekFrom, signal), found = shifts.find(value => value.id === id); return found ? { ...found } : null },
    async savePreferences(value, weekFrom, signal) {
      const shifts = await prepare(weekFrom, signal), next = validatePreferences(value), currentTime = timestamp()
      if ([...registered.values()].some(shift => shift.startAt > currentTime && !next.selectedAreaIds.includes(shift.areaId))) throw new AreasDemoError("Hãy hủy các ca minh họa sắp tới ở khu vực này trước khi bỏ lựa chọn.")
      abort(signal); preferences = next; return snapshot(weekFrom, shifts)
    },
    async register(id, weekFrom, signal) {
      const shifts = await prepare(weekFrom, signal), found = shifts.find(value => value.id === id)
      if (!found) throw new AreasDemoError("Không tìm thấy ca minh họa trong tuần đang xem.")
      const shift = validateShift(found)
      if (registered.has(id)) return snapshot(weekFrom, shifts)
      if (shift.status !== "OPEN") throw new AreasDemoError(shift.status === "FULL" ? "Ca minh họa đã đủ chỗ." : "Ca minh họa đã bị hủy.")
      if (!preferences.selectedAreaIds.includes(shift.areaId)) throw new AreasDemoError("Hãy lưu lựa chọn khu vực minh họa này trước khi đăng ký ca.")
      if (shift.startAt <= timestamp()) throw new AreasDemoError("Chỉ đăng ký ca minh họa chưa bắt đầu.")
      if ([...registered.values()].some(value => shiftsOverlap(value, shift))) throw new AreasDemoError("Ca minh họa trùng giờ với ca bạn đã đăng ký, kể cả ở khu vực khác.")
      abort(signal); registered.set(id, { ...shift }); return snapshot(weekFrom, shifts)
    },
    async cancel(id, weekFrom, signal) {
      const shifts = await prepare(weekFrom, signal), shift = registered.get(id)
      if (!shift || !shifts.some(value => value.id === id)) throw new AreasDemoError("Bạn chưa đăng ký ca minh họa này trong tuần đang xem.")
      if (shift.startAt <= timestamp()) throw new AreasDemoError("Chỉ hủy ca minh họa chưa bắt đầu.")
      abort(signal); registered.delete(id); return snapshot(weekFrom, shifts)
    },
    async reset(weekFrom, signal) { const shifts = await prepare(weekFrom, signal); abort(signal); preferences = defaultAreaPreferences(); registered.clear(); return snapshot(weekFrom, shifts) },
  }
}
