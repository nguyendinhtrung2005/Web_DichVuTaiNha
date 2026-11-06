/** GET-only freshness for the jobs list. Never mounted beside a UC12 operation. */
export function subscribeStaffJobsRevalidation(refresh: () => void, isBusy: () => boolean) {
  let stopped = false
  let timer: number | undefined
  let lastRefresh = Date.now()
  const available = () => document.visibilityState === "visible" && navigator.onLine !== false
  const cancel = () => {
    if (timer !== undefined) window.clearTimeout(timer)
    timer = undefined
  }
  const flush = () => {
    timer = undefined
    if (stopped || !available()) return
    // Do not abort an in-flight read: keep just one deferred refresh.
    if (isBusy()) { timer = window.setTimeout(flush, 250); return }
    lastRefresh = Date.now()
    refresh()
  }
  const schedule = () => {
    if (stopped || !available()) { cancel(); return }
    if (timer === undefined) timer = window.setTimeout(flush, Math.max(150, lastRefresh + 5_000 - Date.now()))
  }
  window.addEventListener("focus", schedule)
  window.addEventListener("online", schedule)
  window.addEventListener("offline", cancel)
  document.addEventListener("visibilitychange", schedule)
  return () => {
    stopped = true
    cancel()
    window.removeEventListener("focus", schedule)
    window.removeEventListener("online", schedule)
    window.removeEventListener("offline", cancel)
    document.removeEventListener("visibilitychange", schedule)
  }
}
