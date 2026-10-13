import { DEMO_ACCOUNTS } from "./mock-data"
import type { Role } from "./types"

/**
 * Xác thực mô phỏng – không phải bảo mật thật.
 * Mật khẩu demo được băm phía client; không lưu chuỗi mật khẩu người dùng nhập.
 */
export const DEMO_PASSWORD_CUSTOMER = "KhachHang123"
export const DEMO_PASSWORD_STAFF = "NhanVien123"
export const DEMO_PASSWORD_ADMIN = "QuanTri123"
export const DEMO_PASSWORD_SEEDED = "CleanHome123"

export function hashPassword(password: string) {
  let h = 2166136261
  const s = `cleanhome-demo-v1:${password}`
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16).padStart(8, "0")
}

export function verifyPassword(password: string, hash: string) {
  return hashPassword(password) === hash
}

export const DEMO_CREDENTIALS: { role: Role; email: string; password: string; name: string }[] = [
  { role: "customer", email: "lan.nguyen@example.vn", password: DEMO_PASSWORD_CUSTOMER, name: "Nguyễn Thị Lan" },
  { role: "staff", email: "hung.tran@cleanhome.vn", password: DEMO_PASSWORD_STAFF, name: "Trần Văn Hùng" },
  { role: "admin", email: "admin@cleanhome.vn", password: DEMO_PASSWORD_ADMIN, name: "Lê Hoàng Nam" },
]

export function seedPasswordHashes(userIds: { id: string; role: Role }[]): Record<string, string> {
  const hashes: Record<string, string> = {}
  for (const u of userIds) {
    if (u.id === DEMO_ACCOUNTS.customer) hashes[u.id] = hashPassword(DEMO_PASSWORD_CUSTOMER)
    else if (u.id === DEMO_ACCOUNTS.staff) hashes[u.id] = hashPassword(DEMO_PASSWORD_STAFF)
    else if (u.id === DEMO_ACCOUNTS.admin) hashes[u.id] = hashPassword(DEMO_PASSWORD_ADMIN)
    else hashes[u.id] = hashPassword(DEMO_PASSWORD_SEEDED)
  }
  return hashes
}

export const ROLE_LABEL: Record<Role, string> = {
  customer: "khách hàng",
  staff: "nhân viên",
  admin: "quản trị viên",
}

export const HOME_PATH: Record<Role, string> = {
  customer: "/don-cua-toi",
  staff: "/",
  admin: "/",
}
