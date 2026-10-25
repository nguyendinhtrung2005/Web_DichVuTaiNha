import { validAreaPath } from "@/components/shared/route-policy"

/** The return path is navigation only; the existing store still checks the account role. */
export function staffLoginReturnTo(requested: string): string {
  const fallback = "/"
  if (!requested.startsWith("/") || requested.startsWith("//") || /[\\\u0000-\u0020\u007f]/.test(requested)) return fallback
  try {
    const pathname = requested.split(/[?#]/, 1)[0]
    if (/\/{2,}/.test(pathname)) return fallback
    const segments = pathname.split("/").filter(Boolean).map(decodeURIComponent)
    // Reject escape chains and dot segments before URL normalization can hide them.
    if (segments.some((part) => part.includes("%")) || !validAreaPath("staff", segments)) return fallback
    if (["dang-nhap", "dang-ky"].includes(segments[0] || "")) return fallback
    const url = new URL(requested, "http://cleanhome.local")
    if (url.origin !== "http://cleanhome.local") return fallback
    return `${url.pathname}${url.search}${url.hash}`
  } catch { return fallback }
}
