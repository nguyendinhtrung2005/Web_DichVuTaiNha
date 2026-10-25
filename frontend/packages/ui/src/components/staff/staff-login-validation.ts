export type StaffLoginValues = { phone: string; password: string }
export type StaffLoginErrors = Partial<Record<keyof StaffLoginValues, string>>

/** Match Auth's phone contract; test identifiers TEST-* are valid account identifiers. */
export function validateStaffLogin(values: StaffLoginValues): StaffLoginErrors {
  const errors: StaffLoginErrors = {}
  const phone = values.phone.trim()
  if (!phone) errors.phone = "Vui lòng nhập số điện thoại."
  else if (phone.length > 20 || /[\u0000-\u001f\u007f]/.test(values.phone)) errors.phone = "Số điện thoại không hợp lệ."
  if (!values.password) errors.password = "Vui lòng nhập mật khẩu."
  else if ([...values.password].length > 128 || new TextEncoder().encode(values.password).byteLength > 512) errors.password = "Mật khẩu không hợp lệ."
  return errors
}
