"use client"

import { useEffect, useState } from "react"

export const STAFF_NOTIFICATION_VIEW_PREFIX = "cleanhome.staff.notification-view.v1:"
type Persistence = "default" | "saved" | "temporary"
type ViewPreference = { unreadOnly: boolean }
type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">
export function staffNotificationViewKey(accountId: string): string | null {
  return typeof accountId === "string" && /^[1-9]\d{0,18}$/.test(accountId) && BigInt(accountId) <= 9_223_372_036_854_775_807n ? STAFF_NOTIFICATION_VIEW_PREFIX + accountId : null
}
export function parseStaffNotificationView(raw: string | null): ViewPreference | null {
  if (!raw || raw.length > 80) return null
  try { const value = JSON.parse(raw); return value && !Array.isArray(value) && Object.keys(value).length === 1 && typeof value.unreadOnly === "boolean" ? { unreadOnly: value.unreadOnly } : null } catch { return null }
}
export function loadStaffNotificationView(storage: Pick<Storage, "getItem">, accountId: string): { unreadOnly: boolean; persistence: Persistence } {
  const key = staffNotificationViewKey(accountId)
  if (!key) return { unreadOnly: false, persistence: "temporary" }
  try { const value = parseStaffNotificationView(storage.getItem(key)); return value ? { ...value, persistence: "saved" } : { unreadOnly: false, persistence: "default" } } catch { return { unreadOnly: false, persistence: "temporary" } }
}
export function saveStaffNotificationView(storage: StoragePort, accountId: string, unreadOnly: boolean): boolean {
  const key = staffNotificationViewKey(accountId)
  if (!key || typeof unreadOnly !== "boolean") return false
  try { const raw = JSON.stringify({ unreadOnly }); storage.setItem(key, raw); return storage.getItem(key) === raw } catch { return false }
}
export function resetStaffNotificationView(storage: StoragePort, accountId: string): boolean {
  const key = staffNotificationViewKey(accountId)
  if (!key) return false
  try { storage.removeItem(key); return storage.getItem(key) === null } catch { return false }
}
export function useStaffNotificationView(accountId: string) {
  const [state, setState] = useState({ accountId, unreadOnly: false, ready: false, persistence: "default" as Persistence })
  useEffect(() => {
    const load = () => { try { setState({ accountId, ...loadStaffNotificationView(window.localStorage, accountId), ready: true }) } catch { setState({ accountId, unreadOnly: false, ready: true, persistence: "temporary" }) } }
    load()
    const changed = (event: StorageEvent) => { if (event.key === staffNotificationViewKey(accountId) || event.key === null) load() }
    window.addEventListener("storage", changed); return () => window.removeEventListener("storage", changed)
  }, [accountId])
  const update = (unreadOnly: boolean) => {
    let saved = false
    try { saved = saveStaffNotificationView(window.localStorage, accountId, unreadOnly) } catch { /* Keep the view usable without storage. */ }
    setState({ accountId, unreadOnly, ready: true, persistence: saved ? "saved" : "temporary" })
  }
  const reset = () => {
    let saved = false
    try { saved = resetStaffNotificationView(window.localStorage, accountId) } catch { /* Do not touch session or other account data. */ }
    setState({ accountId, unreadOnly: false, ready: true, persistence: saved ? "default" : "temporary" })
  }
  return { ...state, ready: state.ready && state.accountId === accountId, update, reset }
}
