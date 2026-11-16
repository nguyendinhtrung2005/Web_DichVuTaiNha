export type ProfileAvatar = "sparkle" | "leaf" | "home" | "sun"
export type ProfileSkill = "HOME" | "KITCHEN" | "GLASS" | "LAUNDRY" | "ORGANIZATION"
export type ProfileEmployment = "FULL_TIME" | "PART_TIME" | "FLEXIBLE"
export type ProfileCertificate = { id: string; title: string; issuer: string; issuedOn: string; expiresOn: string }
export type ProfileDemoData = {
  fullName: string; avatar: ProfileAvatar; phone: string; email: string; address: string
  branch: string; jobTitle: string; employmentType: ProfileEmployment; experienceYears: string
  startedOn: string; bio: string; skills: ProfileSkill[]; certificates: ProfileCertificate[]
}
export type ProfileErrors = Record<string, string>
/** Presentation boundary. A future TV1/TV4 adapter maps approved data here; no Auth fields are editable. */
export interface ProfileDemoAdapter {
  readonly kind: "demo" | "unavailable" | "remote"
  read(signal?: AbortSignal): Promise<ProfileDemoData | null>
  save(draft: unknown, signal?: AbortSignal): Promise<ProfileDemoData>
  reset(signal?: AbortSignal): Promise<ProfileDemoData | null>
}
export const PROFILE_AVATARS: readonly ProfileAvatar[] = Object.freeze(["sparkle", "leaf", "home", "sun"])
export const PROFILE_SKILLS: readonly ProfileSkill[] = Object.freeze(["HOME", "KITCHEN", "GLASS", "LAUNDRY", "ORGANIZATION"])
export const AVATAR_LABELS: Record<ProfileAvatar, string> = Object.freeze({ sparkle: "Ánh sao", leaf: "Chiếc lá", home: "Ngôi nhà", sun: "Mặt trời" })
export const SKILL_LABELS: Record<ProfileSkill, string> = Object.freeze({ HOME: "Vệ sinh nhà", KITCHEN: "Vệ sinh bếp", GLASS: "Vệ sinh kính", LAUNDRY: "Giặt ủi", ORGANIZATION: "Sắp xếp đồ đạc" })
export const EMPLOYMENT_LABELS: Record<ProfileEmployment, string> = Object.freeze({ FULL_TIME: "Toàn thời gian", PART_TIME: "Bán thời gian", FLEXIBLE: "Linh hoạt" })
const fields = ["fullName", "avatar", "phone", "email", "address", "branch", "jobTitle", "employmentType", "experienceYears", "startedOn", "bio", "skills", "certificates"] as const
const certificateFields = ["id", "title", "issuer", "issuedOn", "expiresOn"]
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key)
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value) }
function day(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < "1971-01-01" || value > "2099-12-31") return false
  const timestamp = Date.parse(value + "T00:00:00.000Z")
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value
}
function control(value: string, multiline = false) { return (multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/).test(value) }
export function validateProfileDemo(value: unknown): ProfileErrors {
  const errors: ProfileErrors = {}
  if (!record(value)) return { _form: "Hồ sơ minh họa chưa hợp lệ." }
  if (Object.keys(value).some(key => !fields.includes(key as typeof fields[number]))) errors._form = "Hồ sơ demo chứa trường không được phép. Thông tin Auth không thể chỉnh sửa."
  const text = (key: string, min: number, max: number, label: string, multiline = false) => {
    const input = value[key]
    if (!own(value, key) || typeof input !== "string" || control(input, multiline) || input.trim().length < min || input.trim().length > max) errors[key] = label
  }
  text("fullName", 2, 80, "Nhập họ tên minh họa từ 2 đến 80 ký tự.")
  text("phone", 0, 30, "Số liên hệ minh họa không hợp lệ.")
  text("email", 0, 120, "Email minh họa tối đa 120 ký tự.")
  text("address", 0, 240, "Địa chỉ minh họa tối đa 240 ký tự.")
  text("branch", 2, 100, "Nhập chi nhánh minh họa từ 2 đến 100 ký tự.")
  text("jobTitle", 2, 100, "Nhập chức danh minh họa từ 2 đến 100 ký tự.")
  text("bio", 0, 500, "Giới thiệu minh họa tối đa 500 ký tự.", true)
  if (typeof value.phone === "string" && value.phone.trim() && !errors.phone) {
    const input = value.phone.trim(), digits = input.replace(/[ +-]/g, "")
    if (!/^\+?[\d -]+$/.test(input) || !/^\d{10,15}$/.test(digits)) errors.phone = "Nhập 10–15 chữ số; có thể dùng dấu +, khoảng trắng hoặc dấu gạch."
  }
  if (typeof value.email === "string" && value.email.trim() && !errors.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email.trim())) errors.email = "Nhập email minh họa đúng định dạng."
  if (typeof value.avatar !== "string" || !PROFILE_AVATARS.includes(value.avatar as ProfileAvatar)) errors.avatar = "Chọn một biểu tượng minh họa có sẵn."
  if (typeof value.employmentType !== "string" || !own(EMPLOYMENT_LABELS, value.employmentType)) errors.employmentType = "Chọn loại hình công việc minh họa."
  if (typeof value.experienceYears !== "string" || !/^(?:[0-9]|[1-4][0-9]|50)$/.test(value.experienceYears.trim())) errors.experienceYears = "Kinh nghiệm minh họa phải là số nguyên từ 0 đến 50."
  if (!day(value.startedOn)) errors.startedOn = "Chọn ngày bắt đầu hợp lệ từ năm 1971 đến 2099."
  if (!Array.isArray(value.skills) || value.skills.length > 5 || value.skills.some(skill => !PROFILE_SKILLS.includes(skill)) || new Set(value.skills).size !== value.skills.length) errors.skills = "Chọn tối đa 5 kỹ năng minh họa khác nhau."
  if (!Array.isArray(value.certificates) || value.certificates.length > 5) errors.certificates = "Chỉ thêm tối đa 5 chứng chỉ minh họa."
  else {
    const ids = new Set<string>()
    value.certificates.forEach((certificate: unknown, index: number) => {
      const prefix = "certificates." + index + "."
      if (!record(certificate)) { errors[prefix + "title"] = "Chứng chỉ minh họa chưa hợp lệ."; return }
      if (Object.keys(certificate).some(key => !certificateFields.includes(key))) errors.certificates = "Chứng chỉ chứa trường không được phép."
      if (typeof certificate.id !== "string" || !/^DEMO-CERT-[A-Za-z0-9-]{1,64}$/.test(certificate.id) || ids.has(certificate.id)) errors[prefix + "id"] = "Mã chứng chỉ minh họa chưa hợp lệ hoặc bị trùng."
      else ids.add(certificate.id)
      for (const [key, label] of [["title", "Nhập tên chứng chỉ từ 2 đến 100 ký tự."], ["issuer", "Nhập nơi cấp minh họa từ 2 đến 100 ký tự."]]) {
        const input = certificate[key]
        if (!own(certificate, key) || typeof input !== "string" || control(input) || input.trim().length < 2 || input.trim().length > 100) errors[prefix + key] = label
      }
      if (!day(certificate.issuedOn)) errors[prefix + "issuedOn"] = "Chọn ngày cấp hợp lệ."
      if (certificate.expiresOn !== "" && (!day(certificate.expiresOn) || day(certificate.issuedOn) && certificate.expiresOn < certificate.issuedOn)) errors[prefix + "expiresOn"] = "Ngày hết hạn phải bằng hoặc sau ngày cấp."
    })
  }
  return errors
}
export class ProfileDemoValidationError extends Error {
  readonly errors: ProfileErrors
  constructor(errors: ProfileErrors) { super("Profile demo validation failed"); this.name = "ProfileDemoValidationError"; this.errors = { ...errors } }
}
export function cloneProfileDemo(value: ProfileDemoData): ProfileDemoData {
  return { ...value, skills: [...value.skills], certificates: value.certificates.map(certificate => ({ ...certificate })) }
}
export function normalizeProfileDemo(value: unknown): ProfileDemoData {
  const errors = validateProfileDemo(value)
  if (Object.keys(errors).length) throw new ProfileDemoValidationError(errors)
  const result = cloneProfileDemo(value as ProfileDemoData)
  for (const key of ["fullName", "phone", "email", "address", "branch", "jobTitle", "experienceYears", "bio"] as const) result[key] = result[key].trim()
  result.phone = result.phone.replace(/[ -]/g, "")
  result.certificates = result.certificates.map(certificate => ({ ...certificate, title: certificate.title.trim(), issuer: certificate.issuer.trim() }))
  return result
}
const seed: ProfileDemoData = {
  fullName: "Nhân viên Minh Họa", avatar: "sparkle", phone: "0000000000", email: "staff.demo@example.invalid",
  address: "Số 00, Đường Minh Họa, Khu Demo", branch: "Chi nhánh Minh Họa", jobTitle: "Nhân viên dịch vụ minh họa",
  employmentType: "FULL_TIME", experienceYears: "2", startedOn: "2024-01-15",
  bio: "Hồ sơ giả lập dùng để trải nghiệm giao diện CleanHome, không phải hồ sơ của nhân viên thật.",
  skills: ["HOME", "KITCHEN", "ORGANIZATION"],
  certificates: [
    { id: "DEMO-CERT-SAFETY", title: "An toàn làm việc – minh họa", issuer: "Trung tâm Đào tạo Minh Họa", issuedOn: "2025-01-15", expiresOn: "2027-01-15" },
    { id: "DEMO-CERT-CLEANING", title: "Kỹ thuật vệ sinh – minh họa", issuer: "Trung tâm Đào tạo Minh Họa", issuedOn: "2025-06-01", expiresOn: "" },
  ],
}
Object.freeze(seed.skills); seed.certificates.forEach(Object.freeze); Object.freeze(seed.certificates); Object.freeze(seed)
export function defaultProfileDemo(): ProfileDemoData { return cloneProfileDemo(seed) }
