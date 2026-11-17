export type StaffMapsSdk = typeof import("leaflet")

let pending: Promise<StaffMapsSdk> | null = null

/** Leaflet reads the DOM at import time: call only from a browser effect on demand. */
export function loadStaffMaps(): Promise<StaffMapsSdk> {
  if (typeof window === "undefined") return Promise.reject(new Error("MAP_BROWSER_REQUIRED"))
  if (!pending) pending = import("leaflet").catch(() => {
    pending = null
    throw new Error("MAP_LIBRARY_UNAVAILABLE")
  })
  return pending
}
