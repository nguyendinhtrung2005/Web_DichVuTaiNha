"use client"

import type { AppState } from "./types"
import { validateMigrationState } from "./data-migration"

export const UNIFIED_STORAGE_KEY = "cleanhome-unified-state-v1"
export const UNIFIED_SESSION_KEY = "cleanhome-unified-session-v1"
export const UNIFIED_WRITE_LOCK = "cleanhome-unified-write-v1"

export interface UnifiedEnvelope {
  schemaVersion: 1
  revision: number
  provenance: unknown[]
  data: AppState
}

export type UnifiedReadResult = {
  status: "missing" | "ready" | "corrupt" | "unsupported" | "unavailable"
  raw: string | null
  envelope?: UnifiedEnvelope
  error?: string
}

const listeners = new Set<() => void>()
export function subscribeUnifiedData(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export function notifyUnifiedData() { listeners.forEach((listener) => listener()) }

export function readUnifiedEnvelope(): UnifiedReadResult {
  if (typeof window === "undefined") return { status: "unavailable", raw: null, error: "Chưa thể truy cập dữ liệu trong trình duyệt." }
  let raw: string | null
  try { raw = window.localStorage.getItem(UNIFIED_STORAGE_KEY) }
  catch { return { status: "unavailable", raw: null, error: "Trình duyệt đang chặn việc đọc dữ liệu. Vui lòng kiểm tra quyền lưu trữ." } }
  if (raw === null) return { status: "missing", raw }
  try {
    const value = JSON.parse(raw) as Partial<UnifiedEnvelope>
    if (!value || typeof value !== "object") return { status: "corrupt", raw, error: "Không đọc được dữ liệu đã lưu. Bản gốc vẫn được giữ nguyên." }
    if (value.schemaVersion !== 1) return { status: "unsupported", raw, error: "Phiên bản dữ liệu chưa được hỗ trợ. Bản gốc vẫn được giữ nguyên." }
    if (!Number.isSafeInteger(value.revision) || (value.revision ?? 0) < 1 || !Array.isArray(value.provenance) || !value.data || value.data.session !== null || !validateMigrationState(value.data).ok) {
      return { status: "corrupt", raw, error: "Cấu trúc dữ liệu không hợp lệ. Vui lòng sao lưu và kiểm tra trước khi khôi phục." }
    }
    return { status: "ready", raw, envelope: value as UnifiedEnvelope }
  } catch { return { status: "corrupt", raw, error: "Không đọc được dữ liệu đã lưu. Bản gốc vẫn được giữ nguyên." } }
}

export async function withUnifiedWriteLock<T>(command: () => T | Promise<T>): Promise<T> {
  if (typeof navigator === "undefined" || !navigator.locks?.request) throw new Error("Trình duyệt chưa hỗ trợ ghi dữ liệu an toàn giữa các tab. Vui lòng dùng trình duyệt hỗ trợ Web Locks.")
  return navigator.locks.request(UNIFIED_WRITE_LOCK, { mode: "exclusive" }, command)
}

/** Explicit confirmed import only. Never reads or overwrites legacy keys. */
export async function initializeUnifiedData(data: AppState, provenance: unknown[], options: { expectedRaw: string | null }): Promise<{ ok: true; revision: number } | { ok: false; error: string }> {
  try {
    return await withUnifiedWriteLock(() => {
      const clean = { ...data, session: null }
      if (!validateMigrationState(clean).ok || !Array.isArray(provenance)) return { ok: false as const, error: "Bản nhập chưa hợp lệ. Vui lòng kiểm tra lại các mục được báo lỗi." }
      const current = readUnifiedEnvelope()
      if (current.status === "unavailable") return { ok: false as const, error: current.error! }
      if (current.raw !== options.expectedRaw) return { ok: false as const, error: "Dữ liệu đích đã thay đổi. Vui lòng xem lại bản nhập trước khi xác nhận." }
      const revision = (current.envelope?.revision ?? 0) + 1
      const envelope: UnifiedEnvelope = { schemaVersion: 1, revision, provenance, data: clean }
      const serialized = JSON.stringify(envelope)
      window.localStorage.setItem(UNIFIED_STORAGE_KEY, serialized)
      if (window.localStorage.getItem(UNIFIED_STORAGE_KEY) !== serialized) return { ok: false as const, error: "Chưa thể xác nhận dữ liệu đã được lưu. Giữ bản sao lưu để kiểm tra lại." }
      notifyUnifiedData()
      return { ok: true as const, revision }
    })
  } catch (error) { return { ok: false, error: error instanceof Error && error.message.includes("Web Locks") ? error.message : "Chưa thể lưu bản nhập. Các nguồn cũ vẫn được giữ nguyên; vui lòng giữ bản sao lưu và thử lại." } }
}
