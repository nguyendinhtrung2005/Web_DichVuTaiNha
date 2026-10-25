import type { Role } from "@/lib/types"

export const AREA_HOME: Record<Role, string> = { customer: "/", staff: "/staff", admin: "/admin" }

export function validAreaPath(role: Role, path: string[]): boolean {
  if (path.some((part) => !part || part === "." || part === ".." || /[\\/\s\u0000-\u001f]/.test(part))) return false
  const [route = ""] = path
  if (!route) return true
  if (["dang-nhap", "dang-ky", "ho-so"].includes(route)) return path.length === 1
  if (route === "don") return path.length === 2
  if (role === "customer") {
    if (["dich-vu", "dat-dich-vu"].includes(route)) return path.length <= 2
    if (route === "san-pham") return path.length === 1
    return ["don-cua-toi", "lich-su"].includes(route) && path.length === 1
  }
  if (role === "staff") return ["cong-viec", "lich-lam-viec"].includes(route) && path.length === 1
  return ["don-dich-vu", "phan-cong", "lich-lam-viec", "tai-khoan", "dich-vu", "san-pham", "thanh-toan", "danh-gia", "bao-cao"].includes(route) && path.length === 1
}

/** Return URLs never determine account role or allow navigation outside CleanHome. */
export function safeReturnTo(role: Role, requested: string): string {
  const fallback = AREA_HOME[role]
  if (!requested.startsWith("/") || requested.startsWith("//") || /[\\\u0000-\u0020]|%(?:2f|5c)/i.test(requested)) return fallback
  try {
    const url = new URL(requested, "http://cleanhome.local")
    if (url.origin !== "http://cleanhome.local") return fallback
    const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent)
    const target: Role = segments[0] === "staff" ? "staff" : segments[0] === "admin" ? "admin" : "customer"
    const path = target === "customer" ? segments : segments.slice(1)
    if (target !== role || !validAreaPath(target, path) || ["dang-nhap", "dang-ky"].includes(path[0] || "")) return fallback
    return `${url.pathname}${url.search}${url.hash}`
  } catch { return fallback }
}
