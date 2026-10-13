export type Errors<K extends string> = Partial<Record<K, string>>

export const PHONE_RE = /^0\d{9}$/
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function validateName(v: string) {
  if (!v.trim()) return "Vui lòng nhập họ tên."
  if (v.trim().length < 2) return "Họ tên quá ngắn."
}

export function validatePhone(v: string) {
  if (!v.trim()) return "Vui lòng nhập số điện thoại."
  if (!PHONE_RE.test(v.trim())) return "Số điện thoại gồm 10 chữ số và bắt đầu bằng 0."
}

export function validateEmail(v: string) {
  if (!v.trim()) return "Vui lòng nhập email."
  if (!EMAIL_RE.test(v.trim())) return "Email không đúng định dạng."
}

export function validatePassword(v: string) {
  if (!v) return "Vui lòng nhập mật khẩu."
  if (v.length < 8) return "Mật khẩu tối thiểu 8 ký tự."
  if (!/[A-Za-z]/.test(v) || !/\d/.test(v)) return "Mật khẩu cần có cả chữ và số."
}

export function hasErrors<K extends string>(e: Errors<K>) {
  return Object.values(e).some(Boolean)
}
