export type StaffProfileField = "fullName" | "phone" | "email"
export type StaffProfileDraft = Record<StaffProfileField, string>
export type StaffEditableProfile = { id: string; fullName: string | null; phone: string | null; email: string | null; revision: string }
export const STAFF_PROFILE_FIELDS: StaffProfileField[] = ["fullName", "phone", "email"]
const control = /[\x00-\x1f\x7f]/
const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v)

/** A future approved profile response must belong to this session; extra privilege/secret fields are discarded. */
export function parseEditableStaffProfile(value: unknown, accountId: string): StaffEditableProfile | null {
  if (!record(value) || value.id !== accountId || !/^[1-9]\d{0,18}$/.test(accountId) || BigInt(accountId) > 9223372036854775807n
    || typeof value.revision !== "string" || !value.revision || value.revision.length > 128 || /\s|[\x00-\x1f\x7f]/.test(value.revision)) return null
  for (const [key, max] of [["fullName", 100], ["phone", 20], ["email", 254]] as const) {
    if (value[key] !== null && (typeof value[key] !== "string" || value[key].length > max || control.test(value[key]))) return null
  }
  return { id: accountId, fullName: value.fullName as string | null, phone: value.phone as string | null, email: value.email as string | null, revision: value.revision }
}
export function staffProfileDraft(profile: StaffEditableProfile | null): StaffProfileDraft {
  return { fullName: profile?.fullName || "", phone: profile?.phone || "", email: profile?.email || "" }
}

/** Client sanity checks only. Auth remains authoritative for numbering, uniqueness and verification. */
export function validateStaffProfileDraft(draft: StaffProfileDraft, fields: readonly StaffProfileField[]) {
  const errors: Partial<Record<StaffProfileField, string>> = {}, changes: Partial<StaffProfileDraft> = {}
  for (const field of fields) {
    if (!STAFF_PROFILE_FIELDS.includes(field)) throw Error("UNSUPPORTED_PROFILE_FIELD")
    const value = draft[field]?.trim()
    if (typeof value !== "string" || !value || control.test(value)) { errors[field] = "Vui lòng nhập thông tin hợp lệ."; continue }
    if (field === "fullName" && value.length > 100) errors[field] = "Họ tên tối đa 100 ký tự."
    if (field === "phone" && (value.length > 20 || !/^\+?[0-9][0-9 ()-]*[0-9]$/.test(value) || value.replace(/\D/g, "").length < 8 || value.replace(/\D/g, "").length > 15)) errors[field] = "Nhập số điện thoại hợp lệ; có thể dùng mã quốc gia."
    if (field === "email" && (value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))) errors[field] = "Nhập địa chỉ email hợp lệ."
    if (!errors[field]) changes[field] = value
  }
  return { valid: Object.keys(errors).length === 0 && fields.length > 0, errors, changes }
}

export function staffProfileSaveError(error: unknown): string {
  const status = record(error) ? error.status : null
  if (status === 401 || status === 403) return "Vui lòng kiểm tra lại phiên đăng nhập và quyền cập nhật hồ sơ."
  if (status === 409) return "Thông tin đã thay đổi hoặc đang được sử dụng. Nội dung bạn nhập được giữ lại để kiểm tra."
  if (status === 422) return "Thông tin chưa được chấp nhận hoặc cần xác minh. Vui lòng kiểm tra lại."
  if (status === 429) return "Bạn gửi yêu cầu quá nhanh. Vui lòng chờ trước khi thử lại."
  return "Chưa lưu được thay đổi. Kiểm tra kết nối rồi thử lại; nội dung bạn nhập vẫn được giữ."
}
