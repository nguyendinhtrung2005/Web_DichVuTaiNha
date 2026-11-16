import { cloneDemoSettings, defaultDemoSettings, validateDemoSettings, type DemoSettings, type SettingsDemoAdapter } from "./staff-settings-demo-model"
export { SettingsDemoError } from "./staff-settings-demo-model"
function abort(signal?: AbortSignal) { if (signal?.aborted) throw new DOMException("Demo operation aborted", "AbortError") }
function unavailable(): SettingsDemoAdapter {
  return {
    kind: "unavailable",
    async read(signal) { abort(signal); return null },
    async update(_next, signal) { abort(signal); return null },
    async reset(signal) { abort(signal); return null },
  }
}
/** Account IDs scope private component instances; these settings never touch the real account or browser storage. */
export function createSettingsDemoAdapter({ enabled, accountScope }: { enabled: boolean; accountScope: string }): SettingsDemoAdapter {
  if (enabled !== true || process.env.NODE_ENV !== "development" || typeof accountScope !== "string" || !/^[1-9]\d{0,18}$/.test(accountScope) || BigInt(accountScope) > 9_223_372_036_854_775_807n) return unavailable()
  let settings = defaultDemoSettings()
  async function prepare(signal?: AbortSignal) { abort(signal); await Promise.resolve(); abort(signal) }
  return {
    kind: "demo",
    async read(signal) { await prepare(signal); return cloneDemoSettings(settings) },
    async update(next, signal) { await prepare(signal); settings = validateDemoSettings(next); return cloneDemoSettings(settings) },
    async reset(signal) { await prepare(signal); settings = defaultDemoSettings(); return cloneDemoSettings(settings) },
  }
}
export type { DemoSettings }
