"use client"

import { actions, executeStoreCommand, getStoreSnapshot, storedStateRaw, storedStateData } from "@/lib/store"
import { IS_UNIFIED_APP } from "@/lib/env"
import type { AppState, User } from "@/lib/types"
import type { Persistence } from "./booking-service"

export type CustomerProfilePatch = Pick<User, "name" | "email" | "phone" | "address"> & Pick<Partial<User>, "avatar">
export type AccountResult = { ok: true; user: User; persistence: Persistence } | { ok: false; error: string }
export type ProfileResult = { ok: true; persistence: Persistence } | { ok: false; error: string }

export interface CustomerAccountService {
  login(email: string, password: string): Promise<AccountResult>
  register(input: Parameters<typeof actions.register>[0]): Promise<AccountResult>
  saveProfile(userId: string, patch: CustomerProfilePatch, expectedUser?: User): Promise<ProfileResult>
}

function persistenceOf(matches: (state: AppState) => boolean): Persistence {
  try {
    const raw = storedStateRaw()
    return raw && matches(storedStateData(raw)) ? "local" : "session"
  } catch { return "session" }
}

// The current store remains the source of authentication and ownership rules.
// A later API adapter can implement this interface without changing these forms.
export const customerAccountService: CustomerAccountService = {
  async login(email, password) {
    return executeStoreCommand(() => {
      try {
        const result = actions.login(email.trim(), password)
        if (!result.ok) return result
        return { ok: true, user: result.data, persistence: persistenceOf((state) => state.session?.userId === result.data.id && state.session.role === result.data.role) }
      } catch { return { ok: false, error: "Chưa thể đăng nhập. Vui lòng thử lại." } }
    })
  },
  async register(input) {
    return executeStoreCommand(() => {
      try {
        const result = actions.register({ ...input, name: input.name.trim(), email: input.email.trim(), phone: input.phone.trim() })
        if (!result.ok) return result
        return { ok: true, user: result.data, persistence: persistenceOf((state) => state.session?.userId === result.data.id && state.users.some((user) => user.id === result.data.id) && Boolean(state.passwordHashes[result.data.id])) }
      } catch { return { ok: false, error: "Chưa thể tạo tài khoản. Vui lòng thử lại." } }
    })
  },
  async saveProfile(userId, patch, expectedUser) {
    return executeStoreCommand(() => {
      try {
        if (IS_UNIFIED_APP && expectedUser && JSON.stringify(getStoreSnapshot()?.users.find((user) => user.id === userId)) !== JSON.stringify(expectedUser)) return { ok: false, error: "Hồ sơ đã thay đổi ở nơi khác. Nội dung bạn nhập vẫn được giữ; vui lòng tải lại thông tin trước khi lưu." }
        const cleaned = { name: patch.name.trim(), email: patch.email.trim(), phone: patch.phone.trim(), address: patch.address.trim(), ...(patch.avatar === undefined ? {} : { avatar: patch.avatar }) }
        const result = actions.updateUser(userId, cleaned)
        if (!result.ok) return result
        return { ok: true, persistence: persistenceOf((state) => {
          const user = state.users.find((item) => item.id === userId)
          return Boolean(user && user.name === cleaned.name && user.email === cleaned.email && user.phone === cleaned.phone && user.address === cleaned.address && (cleaned.avatar === undefined || user.avatar === cleaned.avatar))
        }) }
      } catch { return { ok: false, error: "Chưa thể lưu hồ sơ. Thông tin bạn nhập vẫn được giữ lại để thử lại." } }
    })
  },
}

export const loginCustomer = (email: string, password: string) => customerAccountService.login(email, password)
export const registerCustomer = (input: Parameters<typeof actions.register>[0]) => customerAccountService.register(input)
export const saveCustomerProfile = (userId: string, patch: CustomerProfilePatch, expectedUser?: User) => customerAccountService.saveProfile(userId, patch, expectedUser)
