import { addDays, type StaffAvailability, type StaffAreasWeek } from "./staff-areas-remote-model"

export type AvailabilityRequestKind = "register" | "change" | "cancel"
export type AvailabilityDraft = { accountId: string; kind: AvailabilityRequestKind; targetId: string | null; startsLocal: string; endsLocal: string; reason: string }
export type AvailabilityDraftErrors = Partial<Record<"scope" | "target" | "startsLocal" | "endsLocal" | "reason" | "overlap", string>>

export function availabilityStatus(status: string | null): string {
  if (status === "AVAILABLE") return "Khả dụng"
  if (status === "UNAVAILABLE") return "Không khả dụng"
  return status ? `Trạng thái từ hệ thống: ${status}` : "Chưa rõ trạng thái"
}

/** datetime-local is explicitly Vietnam time, independent of the device timezone. */
export function availabilityLocalInput(instant: string): string {
  const time = Date.parse(instant)
  return Number.isFinite(time) ? new Date(time + 7 * 3600000).toISOString().slice(0, 16) : ""
}
export function availabilityInstant(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null
  const time = Date.parse(value + ":00.000+07:00")
  if (!Number.isFinite(time)) return null
  const instant = new Date(time).toISOString()
  return availabilityLocalInput(instant) === value ? instant : null
}
export function availabilityTouchesDay(item: StaffAvailability, day: string): boolean {
  return Date.parse(item.startsAt) < Date.parse(addDays(day, 1) + "T00:00:00+07:00")
    && Date.parse(item.endsAt) > Date.parse(day + "T00:00:00+07:00")
}

/** Draft validation only: no request creation, approval or official shift mutation. */
export function validateAvailabilityDraft(draft: AvailabilityDraft, context: {
  accountId: string; items: StaffAvailability[]; week: StaffAreasWeek; truncated: boolean; now: number
}): { errors: AvailabilityDraftErrors; conflicts: string[]; startsAt: string | null; endsAt: string | null; valid: boolean } {
  const errors: AvailabilityDraftErrors = {}, conflicts: string[] = []
  const target = context.items.find(item => item.id === draft.targetId)
  const startsAt = availabilityInstant(draft.startsLocal), endsAt = availabilityInstant(draft.endsLocal)
  if (draft.accountId !== context.accountId) errors.scope = "Tài khoản đã thay đổi. Đóng nội dung và tải lại lịch của tài khoản hiện tại."
  else if (context.truncated) errors.scope = "Lịch đang bị giới hạn 500 bản ghi; chưa đủ dữ liệu để kiểm tra trùng giờ."
  if (draft.kind !== "register" && !target) errors.target = "Không tìm thấy khung giờ trong lịch của tài khoản hiện tại."
  else if (draft.kind !== "register" && target && Date.parse(target.startsAt) <= context.now) errors.target = "Ca đã bắt đầu hoặc thuộc quá khứ; không thể chuẩn bị yêu cầu đổi/hủy ca này."
  if (draft.reason.length > 500) errors.reason = "Nội dung tối đa 500 ký tự."
  else if (draft.kind !== "register" && draft.reason.trim().length < 5) errors.reason = "Nhập lý do đổi/hủy từ 5 đến 500 ký tự."
  if (draft.kind !== "cancel") {
    if (!startsAt) errors.startsLocal = "Nhập ngày giờ bắt đầu hợp lệ theo giờ Việt Nam."
    else if (Date.parse(startsAt) <= context.now) errors.startsLocal = "Giờ bắt đầu phải ở tương lai."
    if (!endsAt) errors.endsLocal = "Nhập ngày giờ kết thúc hợp lệ theo giờ Việt Nam."
    else if (startsAt && Date.parse(endsAt) <= Date.parse(startsAt)) errors.endsLocal = "Giờ kết thúc phải sau giờ bắt đầu."
    if (startsAt && endsAt && !errors.startsLocal && !errors.endsLocal) {
      if (Date.parse(startsAt) < Date.parse(context.week.from + "T00:00:00+07:00") || Date.parse(endsAt) > Date.parse(addDays(context.week.to, 1) + "T00:00:00+07:00")) {
        errors.scope = "Chỉ kiểm tra được khung giờ trong tuần đang tải. Hãy mở tuần phù hợp để chuẩn bị nội dung."
      }
      for (const item of context.items) {
        if (draft.kind === "change" && item.id === draft.targetId) continue
        if (Date.parse(startsAt) < Date.parse(item.endsAt) && Date.parse(endsAt) > Date.parse(item.startsAt)) conflicts.push(item.id)
      }
      if (conflicts.length) errors.overlap = `Khung giờ trùng ${conflicts.length} bản ghi khả dụng/không khả dụng trong tuần. Vui lòng chọn thời gian khác.`
      if (draft.kind === "change" && target && startsAt === target.startsAt && endsAt === target.endsAt) errors.target = "Chọn khung giờ khác với khung giờ hiện tại."
    }
  }
  return { errors, conflicts, startsAt, endsAt, valid: Object.keys(errors).length === 0 }
}
