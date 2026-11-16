import { cloneProfileDemo, defaultProfileDemo, normalizeProfileDemo, type ProfileDemoAdapter, type ProfileDemoData } from "./staff-profile-demo-model"

export class ProfileDemoUnavailableError extends Error {
  constructor() { super("Profile demo is unavailable"); this.name = "ProfileDemoUnavailableError" }
}
function abortIfNeeded(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Profile demo operation aborted", "AbortError")
}
function unavailable(): ProfileDemoAdapter {
  return {
    kind: "unavailable",
    async read(signal) { abortIfNeeded(signal); return null },
    async save(_draft, signal) { abortIfNeeded(signal); throw new ProfileDemoUnavailableError() },
    async reset(signal) { abortIfNeeded(signal); return null },
  }
}
/**
 * The public account ID binds a private in-memory instance only. It is never
 * copied into fictional fields or exposed as an editable profile property.
 * No module-level cache, browser storage, credential or network is used.
 */
export function createProfileDemoAdapter({ enabled, accountScope }: { enabled: boolean; accountScope: string }): ProfileDemoAdapter {
  if (enabled !== true || process.env.NODE_ENV !== "development" || typeof accountScope !== "string"
    || !/^[1-9]\d{0,18}$/.test(accountScope) || BigInt(accountScope) > 9_223_372_036_854_775_807n) return unavailable()
  let state: ProfileDemoData = defaultProfileDemo()
  return {
    kind: "demo",
    async read(signal) {
      abortIfNeeded(signal); await Promise.resolve(); abortIfNeeded(signal)
      return cloneProfileDemo(state)
    },
    async save(draft, signal) {
      abortIfNeeded(signal)
      const next = normalizeProfileDemo(draft)
      await Promise.resolve(); abortIfNeeded(signal)
      state = cloneProfileDemo(next)
      return cloneProfileDemo(state)
    },
    async reset(signal) {
      abortIfNeeded(signal); await Promise.resolve(); abortIfNeeded(signal)
      state = defaultProfileDemo()
      return cloneProfileDemo(state)
    },
  }
}
