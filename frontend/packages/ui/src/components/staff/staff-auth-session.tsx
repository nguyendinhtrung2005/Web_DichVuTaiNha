"use client"

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react"

export type StaffSession = {
  user: { id: string; role: "EMPLOYEE"; status: "ACTIVE" }
  expiresAt: string
  renewable?: true
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
const sessionExpiredMessage = "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại."

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
  const { user, expiresAt, renewable } = payload.session
  if (!record(user) || typeof user.id !== "string" || !/^[1-9]\d{0,18}$/.test(user.id) || BigInt(user.id) > 9_223_372_036_854_775_807n
    || user.role !== "EMPLOYEE" || user.status !== "ACTIVE" || typeof expiresAt !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(expiresAt) || !Number.isFinite(Date.parse(expiresAt))
    || new Date(expiresAt).toISOString() !== expiresAt || (renewable !== undefined && typeof renewable !== "boolean")) return null
  return { user: { id: user.id, role: "EMPLOYEE", status: "ACTIVE" }, expiresAt, ...(renewable === true ? { renewable: true as const } : {}) }
}

function errorMessage(error: unknown, login = false) {
  if (!(error instanceof StaffAuthError)) return unavailableMessage
  // Keep the local session store distinct from an Auth outage so a retry hint is accurate.
  if (error.status >= 500) return error.code === "SESSION_STORE_UNAVAILABLE"
    ? "Hệ thống chưa thể lưu phiên đăng nhập. Vui lòng thử lại."
    : unavailableMessage
  if (error.status === 429) return "Bạn đã thử đăng nhập nhiều lần. Vui lòng chờ một lúc rồi thử lại."
  if (error.status === 403) return "Tài khoản không có quyền truy cập khu vực nhân viên hoặc đã bị khóa."
  if (error.status === 401) return login
    ? "Số điện thoại hoặc mật khẩu chưa đúng. Vui lòng kiểm tra lại."
    : sessionExpiredMessage
  if (error.status === 400 || error.status === 422) return "Thông tin đăng nhập chưa hợp lệ. Vui lòng kiểm tra lại."
  return "Chưa thể thực hiện yêu cầu. Vui lòng thử lại."
}

async function request(path: "login" | "session" | "logout" | "renew", signal: AbortSignal, body?: object): Promise<unknown> {
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
  const statusRef = useRef<AuthStatus>("loading")
  const generation = useRef(0)
  const mutation = useRef(false)
  const pending = useRef<AbortController | null>(null)
  const renewing = useRef(false)
  const sessionRequests = useRef(0)
  const lastActivity = useRef(Date.now())

  useEffect(() => { statusRef.current = status }, [status])

  const begin = useCallback(() => {
    pending.current?.abort()
    const controller = new AbortController()
    pending.current = controller
    const version = ++generation.current
    const timeout = window.setTimeout(() => controller.abort(), 12_000)
    return { controller, version, finish: () => window.clearTimeout(timeout) }
  }, [])

  const inspectSession = useCallback(async (action: "session" | "renew") => {
    if (mutation.current || renewing.current) return
    if (action === "renew") renewing.current = true
    // A background recheck must not replace the open login form with a skeleton.
    // Protected pages still fail closed below if their authenticated check fails.
    setStatus((current) => current === "authenticated" || current === "unauthenticated" ? current : "loading")
    const operation = begin()
    sessionRequests.current++
    try {
      const value = parseStaffSession(await request(action, operation.controller.signal, action === "renew" ? {} : undefined))
      if (!value) throw new StaffAuthError(503, "INVALID_RESPONSE")
      if (Date.parse(value.expiresAt) <= Date.now()) throw new StaffAuthError(401, "SESSION_EXPIRED")
      if (operation.version !== generation.current) return
      setSession(value); setStatus("authenticated"); setError("")
    } catch (reason) {
      if (operation.version !== generation.current) return
      setSession(null)
      if (reason instanceof StaffAuthError && (reason.status === 401 || reason.status === 403)) {
        setStatus("unauthenticated")
        const missingSession = reason.code === "SESSION_REQUIRED" || reason.code === "UNAUTHENTICATED"
        // After expiry, the browser may already have removed its cookie. Keep
        // that explanation across anonymous rechecks, but clear recovered outages.
        setError((current) => missingSession
          ? reason.status === 401 && current === sessionExpiredMessage ? current : ""
          : errorMessage(reason))
      } else {
        // A background recheck must not raise a service banner over the open login
        // form: only that form's own submit result may report a login failure.
        const anonymousForm = statusRef.current === "unauthenticated"
        setStatus((current) => current === "unauthenticated" ? current : "unavailable")
        if (!anonymousForm) setError(errorMessage(reason))
      }
    } finally {
      operation.finish()
      sessionRequests.current--
      if (action === "renew") renewing.current = false
    }
  }, [begin])

  const checkSession = useCallback(() => inspectSession("session"), [inspectSession])

  const login = useCallback(async (phone: string, password: string): Promise<AuthResult> => {
    if (mutation.current) return { ok: false, message: "Yêu cầu đang được xử lý. Vui lòng chờ." }
    mutation.current = true; setBusy("login")
    const operation = begin()
    try {
      const value = parseStaffSession(await request("login", operation.controller.signal, { phone, password }))
      if (!value || Date.parse(value.expiresAt) <= Date.now()) throw new StaffAuthError(503, "INVALID_RESPONSE")
      if (operation.version !== generation.current) return { ok: false, message: unavailableMessage }
      lastActivity.current = Date.now()
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
    const markActivity = () => { lastActivity.current = Date.now() }
    const checkVisible = () => {
      if (document.visibilityState === "visible") { markActivity(); void checkSession() }
    }
    window.addEventListener("focus", checkVisible)
    document.addEventListener("visibilitychange", checkVisible)
    for (const event of ["pointerdown", "keydown", "wheel", "touchstart"]) window.addEventListener(event, markActivity, { passive: true })
    return () => {
      ++generation.current; pending.current?.abort(); mutation.current = false; renewing.current = false
      window.removeEventListener("focus", checkVisible)
      document.removeEventListener("visibilitychange", checkVisible)
      for (const event of ["pointerdown", "keydown", "wheel", "touchstart"]) window.removeEventListener(event, markActivity)
    }
  }, [checkSession])

  useEffect(() => {
    if (session?.renewable !== true) return
    let timeout: number
    let stopped = false
    const schedule = () => {
      timeout = window.setTimeout(() => {
        // Idle/hidden tabs do not keep a production session alive indefinitely.
        // A later focus/F5 uses the still-valid server session to renew if needed.
        if (document.visibilityState === "visible" && Date.now() - lastActivity.current <= 60_000) void inspectSession("renew")
        if (!stopped) schedule()
      }, 60_000)
    }
    schedule()
    return () => { stopped = true; window.clearTimeout(timeout) }
  }, [session?.renewable, inspectSession])

  useEffect(() => {
    if (!session) return
    const expiresAt = Date.parse(session.expiresAt)
    let timeout: number
    const expire = () => {
      if (session.renewable && sessionRequests.current > 0) { timeout = window.setTimeout(expire, 100); return }
      if (Date.now() < expiresAt) { void checkSession(); return }
      // Another tab may already have renewed the shared HttpOnly session.
      // Let the server decide instead of expiring from this tab's stale DTO.
      if (session.renewable) { void checkSession(); return }
      ++generation.current; pending.current?.abort(); mutation.current = false; setBusy(null)
      setSession(null); setStatus("unauthenticated"); setError(sessionExpiredMessage)
    }
    timeout = window.setTimeout(expire, Math.min(2_147_483_647, Math.max(1, expiresAt - Date.now())))
    return () => window.clearTimeout(timeout)
  }, [session, checkSession])

  return <StaffAuthContext.Provider value={{ session, status, error, busy, checkSession, login, logout }}>{children}</StaffAuthContext.Provider>
}

export function useStaffAuth() { return useContext(StaffAuthContext) }
