"use client"

import { actions, executeStoreCommand, getStoreSnapshot, staleRecordError, storedStateRaw, storedStateData } from "@/lib/store"
import { APP_ROLE, IS_UNIFIED_APP } from "@/lib/env"
import type { AppState, User } from "@/lib/types"
import { validateProfile } from "../customer/account-validation"

export type ManagedAccountRole = "customer" | "staff"
export type AdminAccountPatch = Pick<User, "name" | "email" | "phone" | "address"> & Pick<Partial<User>, "position">
export type AdminAccountInput = AdminAccountPatch & { role: ManagedAccountRole }
export type AdminAccountErrors = Partial<Record<keyof AdminAccountPatch, string>>
export type AdminAccountResult = { ok: true; userId: string; persistence: "local" | "session" } | { ok: false; error: string; field?: keyof AdminAccountPatch }

export function validateAdminAccount(values: AdminAccountPatch, role: ManagedAccountRole): AdminAccountErrors {
  const errors: AdminAccountErrors = validateProfile(values)
  if (role === "staff" && values.position !== undefined && (values.position.trim().length > 120 || /[\p{Cc}]/u.test(values.position))) errors.position = "Vị trí công việc cần tối đa 120 ký tự và không chứa ký tự điều khiển."
  return errors
}

function hasActiveAdmin(state: AppState) {
  return (IS_UNIFIED_APP || APP_ROLE === "admin") && Array.isArray(state.users) && state.session?.role === "admin" && state.users.some((user) => user?.id === state.session?.userId && user.role === "admin" && user.status === "active")
}

function targetAccount(state: AppState, userId: string) {
  return state.users.find((user) => user?.id === userId && (user.role === "customer" || user.role === "staff"))
}

function cleanedPatch(patch: AdminAccountPatch, role: ManagedAccountRole): AdminAccountPatch {
  return { name: patch.name.trim(), email: patch.email.trim(), phone: patch.phone.trim(), address: patch.address.trim(), ...(role === "staff" && patch.position !== undefined ? { position: patch.position.trim() } : {}) }
}

function fieldError(error: string) {
  const message = error.toLowerCase()
  return message.includes("email") ? "email" as const : message.includes("số điện thoại") ? "phone" as const : undefined
}

function validationResult(patch: AdminAccountPatch, role: ManagedAccountRole): AdminAccountResult | null {
  const errors = validateAdminAccount(patch, role)
  const field = (Object.keys(errors) as (keyof AdminAccountPatch)[]).find((key) => errors[key])
  return field ? { ok: false, error: errors[field]!, field } : null
}

function storedState() {
  try { return storedStateRaw() } catch { return null }
}

function persistenceOf(before: string | null, matches: (state: AppState) => boolean): "local" | "session" {
  try {
    const after = storedState()
    if (!after || !matches(storedStateData(after))) return "session"
    // An unchanged edit is already saved if the previous record also matches.
    return after !== before || (before && matches(storedStateData(before))) ? "local" : "session"
  } catch { return "session" }
}

// Whitelist the editable fields before calling the original actions. Account
// provisioning and authorization remain in the existing store.
export const adminAccountService = {
  async update(state: AppState, userId: string, patch: AdminAccountPatch): Promise<AdminAccountResult> {
    return executeStoreCommand(() => {
        if (IS_UNIFIED_APP && userId !== undefined) { const stale = staleRecordError(state, "users", userId); if (stale) return { ok: false, error: stale } }
        if (IS_UNIFIED_APP) state = getStoreSnapshot() ?? state
      try {
        if (!hasActiveAdmin(state)) return { ok: false, error: "Bạn không có quyền quản lý tài khoản." }
        const target = targetAccount(state, userId)
        if (!target) return { ok: false, error: "Tài khoản không còn trong danh sách khách hàng hoặc nhân viên." }
        const cleaned = cleanedPatch(patch, target.role as ManagedAccountRole)
        const invalid = validationResult(cleaned, target.role as ManagedAccountRole)
        if (invalid) return invalid
        const before = storedState()
        const result = actions.updateUser(userId, cleaned)
        if (!result.ok) return { ...result, field: fieldError(result.error) }
        return { ok: true, userId, persistence: persistenceOf(before, (saved) => saved.users.some((user) => user.id === userId && user.role === target.role && Object.entries(cleaned).every(([key, value]) => user[key as keyof AdminAccountPatch] === value))) }
      } catch { return { ok: false, error: "Chưa thể lưu tài khoản. Thông tin đã nhập vẫn được giữ để thử lại." } }
    })
  },

  async create(state: AppState, input: AdminAccountInput): Promise<AdminAccountResult> {
    return executeStoreCommand(() => {
        if (IS_UNIFIED_APP) state = getStoreSnapshot() ?? state
      try {
        if (!hasActiveAdmin(state)) return { ok: false, error: "Bạn không có quyền thêm tài khoản." }
        if (input.role !== "customer" && input.role !== "staff") return { ok: false, error: "Chỉ có thể thêm tài khoản khách hàng hoặc nhân viên." }
        const cleaned = cleanedPatch(input, input.role)
        const invalid = validationResult(cleaned, input.role)
        if (invalid) return invalid
        const before = storedState()
        const result = actions.addUser({ ...cleaned, role: input.role })
        if (!result.ok) return { ...result, field: fieldError(result.error) }
        const userId = result.data.id
        return { ok: true, userId, persistence: persistenceOf(before, (saved) => saved.users.some((user) => user.id === userId && user.role === input.role && user.status === "active" && Object.entries(cleaned).every(([key, value]) => user[key as keyof AdminAccountPatch] === value))) }
      } catch { return { ok: false, error: "Chưa thể thêm tài khoản. Thông tin đã nhập vẫn được giữ để thử lại." } }
    })
  },

  async setLocked(state: AppState, userId: string, locked: boolean): Promise<AdminAccountResult> {
    return executeStoreCommand(() => {
        if (IS_UNIFIED_APP && userId !== undefined) { const stale = staleRecordError(state, "users", userId); if (stale) return { ok: false, error: stale } }
        if (IS_UNIFIED_APP) state = getStoreSnapshot() ?? state
      try {
        if (!hasActiveAdmin(state)) return { ok: false, error: "Bạn không có quyền thay đổi trạng thái tài khoản." }
        if (typeof locked !== "boolean") return { ok: false, error: "Trạng thái tài khoản chưa hợp lệ." }
        if (state.session?.userId === userId) return { ok: false, error: "Không thể khóa tài khoản đang đăng nhập." }
        const target = targetAccount(state, userId)
        if (!target) return { ok: false, error: "Tài khoản không còn trong danh sách khách hàng hoặc nhân viên." }
        const before = storedState()
        const result = actions.setUserLocked(userId, locked)
        if (!result.ok) return { ...result, field: fieldError(result.error) }
        return { ok: true, userId, persistence: persistenceOf(before, (saved) => saved.users.some((user) => user.id === userId && user.role === target.role && user.status === (locked ? "locked" : "active"))) }
      } catch { return { ok: false, error: "Chưa thể cập nhật trạng thái tài khoản. Vui lòng thử lại." } }
    })
  },
}
