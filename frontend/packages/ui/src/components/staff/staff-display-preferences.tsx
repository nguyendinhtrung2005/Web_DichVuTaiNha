"use client"

import { createContext, useContext, useEffect, useState, type ReactNode } from "react"

export type StaffDisplayPreferences = { motion: "system" | "reduce"; focus: "standard" | "strong" }
export const STAFF_DISPLAY_KEY = "cleanhome.staff.display.v1"
export const DEFAULT_STAFF_DISPLAY: StaffDisplayPreferences = { motion: "system", focus: "standard" }
type Persistence = "default" | "saved" | "temporary"
type PreferenceStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">

/** This is a browser display preference, never an account/session or remote DTO. */
export function parseStaffDisplayPreferences(raw: string | null): StaffDisplayPreferences | null {
  if (raw === null || raw.length > 256) return null
  try {
    const value = JSON.parse(raw)
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 2
      || !Object.hasOwn(value, "motion") || !Object.hasOwn(value, "focus")
      || !["system", "reduce"].includes(value.motion) || !["standard", "strong"].includes(value.focus)) return null
    return { motion: value.motion, focus: value.focus }
  } catch { return null }
}
export function loadStaffDisplayPreferences(storage: Pick<Storage, "getItem">): { preferences: StaffDisplayPreferences; persistence: Persistence } {
  try {
    const preferences = parseStaffDisplayPreferences(storage.getItem(STAFF_DISPLAY_KEY))
    return preferences ? { preferences, persistence: "saved" } : { preferences: { ...DEFAULT_STAFF_DISPLAY }, persistence: "default" }
  } catch { return { preferences: { ...DEFAULT_STAFF_DISPLAY }, persistence: "temporary" } }
}
export function saveStaffDisplayPreferences(storage: PreferenceStorage, preferences: StaffDisplayPreferences): boolean {
  try {
    const safe = parseStaffDisplayPreferences(JSON.stringify(preferences))
    if (!safe) return false
    const serialized = JSON.stringify(safe)
    storage.setItem(STAFF_DISPLAY_KEY, serialized)
    return storage.getItem(STAFF_DISPLAY_KEY) === serialized
  } catch { return false }
}
export function resetStaffDisplayPreferences(storage: PreferenceStorage): boolean {
  try { storage.removeItem(STAFF_DISPLAY_KEY); return storage.getItem(STAFF_DISPLAY_KEY) === null } catch { return false }
}

type DisplayContext = {
  preferences: StaffDisplayPreferences; persistence: Persistence; ready: boolean
  update: (next: StaffDisplayPreferences) => void; reset: () => void
}
const Context = createContext<DisplayContext | null>(null)

export function StaffDisplayPreferencesProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState({ preferences: { ...DEFAULT_STAFF_DISPLAY }, persistence: "default" as Persistence, ready: false })
  useEffect(() => {
    const load = () => {
      try { setState({ ...loadStaffDisplayPreferences(window.localStorage), ready: true }) }
      catch { setState({ preferences: { ...DEFAULT_STAFF_DISPLAY }, persistence: "temporary", ready: true }) }
    }
    load()
    const changed = (event: StorageEvent) => { if (event.key === STAFF_DISPLAY_KEY || event.key === null) load() }
    window.addEventListener("storage", changed)
    return () => window.removeEventListener("storage", changed)
  }, [])
  const update = (next: StaffDisplayPreferences) => {
    const preferences = parseStaffDisplayPreferences(JSON.stringify(next))
    if (!preferences) return
    let saved = false
    try { saved = saveStaffDisplayPreferences(window.localStorage, preferences) } catch { /* Display still works without storage. */ }
    setState({ preferences, persistence: saved ? "saved" : "temporary", ready: true })
  }
  const reset = () => {
    let saved = false
    try { saved = resetStaffDisplayPreferences(window.localStorage) } catch { /* Do not clear any other browser data. */ }
    setState({ preferences: { ...DEFAULT_STAFF_DISPLAY }, persistence: saved ? "default" : "temporary", ready: true })
  }
  return <Context.Provider value={{ ...state, update, reset }}>{children}</Context.Provider>
}
export function useStaffDisplayPreferences() { return useContext(Context) }
