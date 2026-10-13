"use client"

import { actions, executeStoreCommand, getStoreSnapshot, storedStateRaw, storedStateData } from "@/lib/store"
import { IS_UNIFIED_APP } from "@/lib/env"
import type { AppState, User } from "@/lib/types"

export type StaffProfilePatch = Pick<User, "name" | "email" | "phone" | "address"> & Pick<Partial<User>, "avatar">
export type StaffProfileResult = { ok: true; persistence: "local" | "session" } | { ok: false; error: string }

export async function saveStaffProfile(userId: string, patch: StaffProfilePatch, expectedUser?: User): Promise<StaffProfileResult> {
  return executeStoreCommand(() => {
    try {
      if (IS_UNIFIED_APP && expectedUser && JSON.stringify(getStoreSnapshot()?.users.find((user) => user.id === userId)) !== JSON.stringify(expectedUser)) return { ok: false, error: "Hồ sơ đã thay đổi ở nơi khác. Nội dung bạn nhập vẫn được giữ; vui lòng tải lại thông tin trước khi lưu." }
      const cleaned = { name: patch.name.trim(), email: patch.email.trim(), phone: patch.phone.trim(), address: patch.address.trim(), ...(patch.avatar === undefined ? {} : { avatar: patch.avatar }) }
      const result = actions.updateUser(userId, cleaned)
      if (!result.ok) return result
      let persisted = false
      try {
        const raw = storedStateRaw(); const saved = raw ? storedStateData(raw) : null
        const user = saved?.users.find((item) => item.id === userId)
        persisted = Boolean(user && Object.entries(cleaned).every(([key, value]) => user[key as keyof typeof cleaned] === value))
      } catch { /* The existing store can retain changes in this session only. */ }
      return { ok: true, persistence: persisted ? "local" : "session" }
    } catch { return { ok: false, error: "Chưa lưu được hồ sơ. Thông tin đã nhập vẫn được giữ để thử lại." } }
  })
}
