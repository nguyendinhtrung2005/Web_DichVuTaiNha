"use client"

import { APP_ROLE, IS_UNIFIED_APP } from "@/lib/env"
import { actions, executeStoreCommand, getStoreSnapshot, staleRecordError, storedStateRaw, storedStateData } from "@/lib/store"
import type { AppState } from "@/lib/types"

export type AdminReviewResult = { ok: true; persistence: "local" | "session" } | { ok: false; error: string }

export interface AdminReviewService {
  setVisibility(state: AppState, reviewId: string, hidden: boolean, reason?: string): Promise<AdminReviewResult>
}

function storedState() {
  try { return storedStateRaw() } catch { return null }
}

export const adminReviewService: AdminReviewService = {
  async setVisibility(state, reviewId, hidden, reason) {
    return executeStoreCommand(() => {
        if (IS_UNIFIED_APP && reviewId !== undefined) { const stale = staleRecordError(state, "reviews", reviewId); if (stale) return { ok: false, error: stale } }
        if (IS_UNIFIED_APP) state = getStoreSnapshot() ?? state
      const actor = state.users.find((user) => user.id === state.session?.userId)
      if ((!IS_UNIFIED_APP && APP_ROLE !== "admin") || state.session?.role !== "admin" || actor?.role !== "admin" || actor.status !== "active") return { ok: false, error: "Bạn không có quyền quản lý đánh giá." }
      const review = state.reviews.find((item) => item.id === reviewId)
      if (!review) return { ok: false, error: "Không tìm thấy đánh giá cần cập nhật." }
      if (typeof hidden !== "boolean" || review.hidden === hidden) return { ok: false, error: "Trạng thái đánh giá đã thay đổi. Vui lòng kiểm tra lại." }
      const cleanReason = reason?.trim() ?? ""
      if (hidden && (!cleanReason || cleanReason.length > 2000)) return { ok: false, error: cleanReason ? "Lý do ẩn không được vượt quá 2.000 ký tự." : "Vui lòng nhập lý do ẩn đánh giá." }
      try {
        const before = storedState()
        // The existing action changes only visibility and its reason. It returns
        // void on success; its permission wrapper may return an explicit failure.
        const result: unknown = actions.setReviewHidden(reviewId, hidden, hidden ? cleanReason : undefined)
        if (result && typeof result === "object" && "ok" in result && result.ok === false) return { ok: false, error: "error" in result ? String(result.error) : "Chưa thể cập nhật đánh giá." }
        try {
          const raw = storedState()
          const saved = raw ? (storedStateData(raw)).reviews.find((item) => item.id === reviewId) : undefined
          return { ok: true, persistence: raw && raw !== before && saved?.hidden === hidden && (hidden ? saved.hiddenReason === cleanReason : saved.hiddenReason === undefined) ? "local" : "session" }
        } catch { return { ok: true, persistence: "session" } }
      } catch { return { ok: false, error: "Chưa thể lưu thay đổi. Vui lòng kiểm tra và thử lại." } }
    })
  },
}
