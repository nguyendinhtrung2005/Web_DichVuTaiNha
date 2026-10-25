"use client"

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react"

export type StaffSession = {
  user: { id: string; role: "EMPLOYEE"; status: "ACTIVE" }
  expiresAt: string
}
type AuthStatus = "loading" | "authenticated" | "unauthenticated" | "unavailable"
type AuthResult = { ok: true } | { ok: false; message: string }
type StaffAuth = {
  session: StaffSession | null
  status: AuthStatus
  error: string
  busy: "login" | "logout" | null
  checkSession: () => Promise<void>
  login: (phone: string, password: string) => Promise<AuthResult>
  logout: () => Promise<AuthResult>
}

const StaffAuthContext = createContext<StaffAuth | null>(null)
const unavailableMessage = "Dịch vụ đăng nhập hiện chưa khả dụng. Vui lòng thử lại sau."

class StaffAuthError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super("Staff authentication request failed")
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

/** Only the public session DTO is retained; credentials and JWT never enter this context. */
export function parseStaffSession(payload: unknown): StaffSession | null {
  if (!record(payload) || !record(payload.session)) return null
  const { user, expiresAt } = payload.session
  if (!record(user) || typeof user.id !== "string" || !/^[1-9]\d{0,18}$/.test(user.id) || BigInt(user.id) > 9_223_372_036_854_775_807n
    || user.role !== "EMPLOYEE" || user.status !== "ACTIVE" || typeof expiresAt !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(expiresAt) || !Number.isFinite(Date.parse(expiresAt))
    || new Date(expiresAt).toISOString() !== expiresAt) return null
  return { user: { id: user.id, role: "EMPLOYEE", status: "ACTIVE" }, expiresAt }
}

function errorMessage(error: unknown, login = false) {
  if (!(error instanceof StaffAuthError)) return unavailableMessage
  if (error.status >= 500) return unavailableMessage
  if (error.status === 429) return "Bạn đã thử đăng nhập nhiều lần. Vui lòng chờ một lúc rồi thử lại."
  if (error.status === 403) return "Tài khoản không có quyền truy cập khu vực nhân viên hoặc đã bị khóa."
  if (error.status === 401) return login
    ? "Số điện thoại hoặc mật khẩu chưa đúng. Vui lòng kiểm tra lại."
    : "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại."
  if (error.status === 400 || error.status === 422) return "Thông tin đăng nhập chưa hợp lệ. Vui lòng kiểm tra lại."
  return "Chưa thể thực hiện yêu cầu. Vui lòng thử lại."
}

async function request(path: "login" | "session" | "logout", signal: AbortSignal, body?: object): Promise<unknown> {
  const response = await fetch(`/api/auth/${path}`, {
    method: body ? "POST" : "GET", credentials: "same-origin", cache: "no-store", redirect: "error", signal,
    headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  // Bound the response before parsing rather than trusting Content-Length alone.
  const reader = response.body?.getReader()
  if (!reader) throw new StaffAuthError(503, "INVALID_RESPONSE")
  let size = 0
  const chunks: Uint8Array[] = []
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      size += part.value.byteLength
      if (size > 16_384) { await reader.cancel(); throw new StaffAuthError(503, "INVALID_RESPONSE") }
      chunks.push(part.value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  let payload: unknown
  try { payload = JSON.parse(new TextDecoder().decode(bytes)) } catch { throw new StaffAuthError(503, "INVALID_RESPONSE") }
  if (!response.ok) {
    const code = record(payload) && record(payload.error) && typeof payload.error.code === "string" ? payload.error.code : "REQUEST_FAILED"
    throw new StaffAuthError(response.status, code)
  }
  return payload
}

export function StaffAuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<StaffSession | null>(null)
  const [status, setStatus] = useState<AuthStatus>("loading")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState<StaffAuth["busy"]>(null)
  const generation = useRef(0)
  const mutation = useRef(false)
  const pending = useRef<AbortController | null>(null)

  const begin = useCallback(() => {
    pending.current?.abort()
    const controller = new AbortController()
    pending.current = controller
    const version = ++generation.current
    const timeout = window.setTimeout(() => controller.abort(), 12_000)
    return { controller, version, finish: () => window.clearTimeout(timeout) }
  }, [])

  const checkSession = useCallback(async () => {
    if (mutation.current) return
    setStatus((current) => current === "authenticated" ? current : "loading")
    const operation = begin()
    try {
      const value = parseStaffSession(await request("session", operation.controller.signal))
      if (!value) throw new StaffAuthError(503, "INVALID_RESPONSE")
      if (Date.parse(value.expiresAt) <= Date.now()) throw new StaffAuthError(401, "SESSION_EXPIRED")
      if (operation.version !== generation.current) return
      setSession(value); setStatus("authenticated"); setError("")
    } catch (reason) {
      if (operation.version !== generation.current) return
      setSession(null)
      if (reason instanceof StaffAuthError && (reason.status === 401 || reason.status === 403)) {
        setStatus("unauthenticated")
        setError(reason.code === "SESSION_REQUIRED" || reason.code === "UNAUTHENTICATED" ? "" : errorMessage(reason))
      } else { setStatus("unavailable"); setError(errorMessage(reason)) }
    } finally { operation.finish() }
  }, [begin])

  const login = useCallback(async (phone: string, password: string): Promise<AuthResult> => {
    if (mutation.current) return { ok: false, message: "Yêu cầu đang được xử lý. Vui lòng chờ." }
    mutation.current = true; setBusy("login")
    const operation = begin()
    try {
      const value = parseStaffSession(await request("login", operation.controller.signal, { phone, password }))
      if (!value || Date.parse(value.expiresAt) <= Date.now()) throw new StaffAuthError(503, "INVALID_RESPONSE")
      if (operation.version !== generation.current) return { ok: false, message: unavailableMessage }
      setSession(value); setStatus("authenticated"); setError("")
      return { ok: true }
    } catch (reason) {
      return { ok: false, message: errorMessage(reason, true) }
    } finally {
      operation.finish()
      if (operation.version === generation.current) { mutation.current = false; setBusy(null) }
    }
  }, [begin])

  const logout = useCallback(async (): Promise<AuthResult> => {
    if (mutation.current) return { ok: false, message: "Yêu cầu đang được xử lý. Vui lòng chờ." }
    mutation.current = true; setBusy("logout")
    const operation = begin()
    try {
      const value = await request("logout", operation.controller.signal, {})
      if (!record(value) || value.ok !== true) throw new StaffAuthError(503, "INVALID_RESPONSE")
      if (operation.version !== generation.current) return { ok: false, message: unavailableMessage }
      setSession(null); setStatus("unauthenticated"); setError("")
      return { ok: true }
    } catch { return { ok: false, message: "Chưa thể đăng xuất. Vui lòng thử lại để đóng phiên đăng nhập." } }
    finally {
      operation.finish()
      if (operation.version === generation.current) { mutation.current = false; setBusy(null) }
    }
  }, [begin])

  useEffect(() => {
    void checkSession()
    const checkVisible = () => { if (document.visibilityState === "visible") void checkSession() }
    window.addEventListener("focus", checkVisible)
    document.addEventListener("visibilitychange", checkVisible)
    return () => {
      ++generation.current; pending.current?.abort(); mutation.current = false
      window.removeEventListener("focus", checkVisible)
      document.removeEventListener("visibilitychange", checkVisible)
    }
  }, [checkSession])

  useEffect(() => {
    if (!session) return
    const expiresAt = Date.parse(session.expiresAt)
    const expire = () => {
      if (Date.now() < expiresAt) { void checkSession(); return }
      ++generation.current; pending.current?.abort(); mutation.current = false; setBusy(null)
      setSession(null); setStatus("unauthenticated"); setError("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.")
    }
    const timeout = window.setTimeout(expire, Math.min(2_147_483_647, Math.max(1, expiresAt - Date.now())))
    return () => window.clearTimeout(timeout)
  }, [session, checkSession])

  return <StaffAuthContext.Provider value={{ session, status, error, busy, checkSession, login, logout }}>{children}</StaffAuthContext.Provider>
}

export function useStaffAuth() { return useContext(StaffAuthContext) }
