"use client"

import { actions, executeStoreCommand, storedStateRaw, storedStateData } from "@/lib/store"
import type { AppState, JobStatus } from "@/lib/types"

export type StaffMutationResult = { ok: true; persistence: "local" | "session" } | { ok: false; error: string }

// An API adapter can implement this interface later. The current implementation
// keeps the existing store actions, state transitions and Order schema intact.
export interface StaffJobService {
  advance(orderId: string, next: JobStatus): Promise<StaffMutationResult>
  saveNote(orderId: string, text: string): Promise<StaffMutationResult>
}

function storedState() {
  try { return storedStateRaw() } catch { return null }
}

function persistenceOf(before: string | null, matches: (state: AppState) => boolean): "local" | "session" {
  try {
    const raw = storedState()
    return raw && raw !== before && matches(storedStateData(raw)) ? "local" : "session"
  } catch { return "session" }
}

export const staffJobService: StaffJobService = {
  async advance(orderId, next) {
    return executeStoreCommand(() => {
      try {
        const before = storedState()
        const result = actions.advanceJob(orderId, next)
        if (!result.ok) return result
        return {
          ok: true,
          persistence: persistenceOf(before, (state) => {
            const order = state.orders.find((item) => item.id === orderId)
            return order?.jobStatus === next && (next !== "in_progress" || order.status === "in_progress") && (next !== "done" || order.status === "completed")
          }),
        }
      } catch { return { ok: false, error: "Chưa thể cập nhật công việc. Vui lòng thử lại." } }
    })
  },
  async saveNote(orderId, text) {
    return executeStoreCommand(() => {
      try {
        const before = storedState()
        const startedAt = Date.now()
        const result = actions.addStaffNote(orderId, text)
        if (!result.ok) return result
        return {
          ok: true,
          persistence: persistenceOf(before, (state) => {
            const order = state.orders.find((item) => item.id === orderId)
            const note = order?.staffNotes.at(-1)
            return note?.text === text && note.staffId === order?.staffId && new Date(note.at).getTime() >= startedAt
          }),
        }
      } catch { return { ok: false, error: "Chưa thể lưu ghi chú. Vui lòng thử lại." } }
    })
  },
}

export const advanceStaffJob = (orderId: string, next: JobStatus) => staffJobService.advance(orderId, next)
export const saveStaffJobNote = (orderId: string, text: string) => staffJobService.saveNote(orderId, text)
