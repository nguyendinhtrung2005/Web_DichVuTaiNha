export interface ProfileValues {
  name: string
  email: string
  phone: string
  address: string
  avatar?: string
}

export interface RegistrationValues {
  name: string
  phone: string
  email: string
  password: string
  confirm: string
}

export type AccountErrors<T> = Partial<Record<keyof T, string>>

// Used only to validate the national format; stored phone formatting is preserved.
export function normalizePhone(value: string) {
  const digits = value.replace(/[\s()+-]/g, "")
  return digits.startsWith("84") ? `0${digits.slice(2)}` : digits
}

function validateName(name: string) {
  const trimmed = name.trim()
  if (!trimmed) return "Vui lòng nhập họ và tên."
  if (trimmed.length < 2 || trimmed.length > 120) return "Họ tên cần từ 2 đến 120 ký tự."
  if (!/[\p{L}]/u.test(trimmed) || /[\p{Cc}]/u.test(trimmed)) return "Vui lòng nhập họ tên hợp lệ."
}

function validateEmail(email: string) {
  const trimmed = email.trim()
  if (!trimmed) return "Vui lòng nhập email."
  if (trimmed.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return "Vui lòng nhập email hợp lệ, ví dụ ten@vidu.vn."
}

function validatePhone(phone: string) {
  const trimmed = phone.trim()
  if (!trimmed) return "Vui lòng nhập số điện thoại."
  const normalized = normalizePhone(trimmed)
  if (trimmed.length > 20 || !/^\+?[0-9 ()-]+$/.test(trimmed) || !/^(?:0[35789]\d{8}|02\d{9})$/.test(normalized)) return "Nhập số điện thoại Việt Nam hợp lệ, bắt đầu bằng 0 hoặc +84."
}

export function validateProfile(values: ProfileValues): AccountErrors<ProfileValues> {
  const errors: AccountErrors<ProfileValues> = {}
  const name = validateName(values.name), email = validateEmail(values.email), phone = validatePhone(values.phone)
  if (name) errors.name = name
  if (email) errors.email = email
  if (phone) errors.phone = phone
  const address = values.address.trim()
  if (address && (address.length < 8 || address.length > 300)) errors.address = "Địa chỉ cần từ 8 đến 300 ký tự; có thể để trống nếu chưa có địa chỉ mặc định."
  return errors
}

export function validateLogin(values: { email: string; password: string }): AccountErrors<typeof values> {
  const errors: AccountErrors<typeof values> = {}
  const email = validateEmail(values.email)
  if (email) errors.email = email
  if (!values.password) errors.password = "Vui lòng nhập mật khẩu."
  return errors
}

export function validateRegistration(values: RegistrationValues): AccountErrors<RegistrationValues> {
  const errors: AccountErrors<RegistrationValues> = {}
  const name = validateName(values.name), email = validateEmail(values.email), phone = validatePhone(values.phone)
  if (name) errors.name = name
  if (email) errors.email = email
  if (phone) errors.phone = phone
  if (!values.password) errors.password = "Vui lòng nhập mật khẩu."
  else if (values.password.length < 8) errors.password = "Mật khẩu cần ít nhất 8 ký tự."
  if (!values.confirm) errors.confirm = "Vui lòng nhập lại mật khẩu."
  else if (values.confirm !== values.password) errors.confirm = "Mật khẩu xác nhận không khớp."
  return errors
}
