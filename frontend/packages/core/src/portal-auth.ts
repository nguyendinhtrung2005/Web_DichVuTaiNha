"use client"

import { ApiError, apiRequest } from "./api-client"
import type { Role, User } from "./types"

export type PortalAuthState = {
  status: "loading" | "ready" | "unavailable"
  role: "staff" | "admin" | null
  user: User | null
  error?: string
}

let state: PortalAuthState = { status: "loading", role: null, user: null }
const serverState: PortalAuthState = { status: "loading", role: null, user: null }
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((listener) => listener())

export const portalAuthSnapshot = () => state
export const portalAuthServerSnapshot = () => serverState
export const subscribePortalAuth = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function isPortalRole(role: Role): role is "staff" | "admin" {
  return role === "staff" || role === "admin"
}

function validatePortalUser(value: unknown, role: "staff" | "admin"): User {
  if (!value || typeof value !== "object") throw new ApiError("API trả thông tin tài khoản không hợp lệ.", 502, "INVALID_RESPONSE")
  const user = value as Partial<User>
  if (typeof user.id !== "string" || typeof user.code !== "string" || typeof user.name !== "string"
    || typeof user.phone !== "string" || typeof user.email !== "string" || typeof user.address !== "string"
    || typeof user.createdAt !== "string" || user.role !== role || user.status !== "active") {
    throw new ApiError("Tài khoản không có quyền truy cập khu vực này.", 403, "ROLE_FORBIDDEN")
  }
  return user as User
}

export async function refreshPortalSession(role: Role) {
  if (!isPortalRole(role)) return
  state = { status: "loading", role, user: state.role === role ? state.user : null }
  emit()
  try {
    const user = validatePortalUser(await apiRequest<User>("/portal-auth/session"), role)
    state = { status: "ready", role, user }
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      state = { status: "ready", role, user: null }
    } else {
      state = { status: "unavailable", role, user: null, error: error instanceof Error ? error.message : "Chưa thể xác minh phiên đăng nhập." }
    }
  }
  emit()
}

export async function loginPortal(role: Role, identifier: string, password: string) {
  if (!isPortalRole(role)) throw new ApiError("Vai trò đăng nhập không hợp lệ.", 400, "INVALID_ROLE")
  const user = validatePortalUser(await apiRequest<User>("/portal-auth/login", {
    method: "POST",
    body: JSON.stringify({ role, identifier, password }),
  }), role)
  state = { status: "ready", role, user }
  emit()
  return user
}

export async function logoutPortal() {
  await apiRequest<{ loggedOut: boolean }>("/auth/logout", { method: "POST", body: "{}" })
  state = { status: "ready", role: state.role, user: null }
  emit()
}
