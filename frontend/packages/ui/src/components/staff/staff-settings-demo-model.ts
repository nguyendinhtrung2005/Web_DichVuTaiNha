/** Illustrative Staff settings only; these values never represent an account or Backend preference. */
export type DemoNotificationSettings = { shiftReminder: boolean; supportUpdates: boolean; weeklyDigest: boolean }
export type DemoDisplaySettings = { listDensity: "compact" | "comfortable"; showReferenceCode: boolean }
export type DemoPrivacySettings = { maskPreviewName: boolean }
export type DemoSettings = { notifications: DemoNotificationSettings; display: DemoDisplaySettings; privacy: DemoPrivacySettings }
export type DemoSettingsPreview = { name: string; masked: boolean; referenceCode: string | null; density: "compact" | "comfortable"; notificationSummary: string[] }
/** Frontend presentation boundary; an account settings API adapter can replace this without touching the UI. */
export interface SettingsDemoAdapter {
  readonly kind: "demo" | "unavailable"
  read(signal?: AbortSignal): Promise<DemoSettings | null>
  update(next: DemoSettings, signal?: AbortSignal): Promise<DemoSettings | null>
  reset(signal?: AbortSignal): Promise<DemoSettings | null>
}
export class SettingsDemoError extends Error {
  constructor(message: string) { super(message); this.name = "SettingsDemoError" }
}
export const SETTINGS_DISCLAIMER = "Các tùy chọn này chỉ là DEMO trong phiên mở trang; không đồng bộ tài khoản, không đổi quyền, mật khẩu, thiết bị hay bảo mật Backend."
const DEFAULT: DemoSettings = {
  notifications: { shiftReminder: true, supportUpdates: true, weeklyDigest: false },
  display: { listDensity: "comfortable", showReferenceCode: true },
  privacy: { maskPreviewName: true },
}
export function defaultDemoSettings(): DemoSettings { return cloneDemoSettings(DEFAULT) }
export function cloneDemoSettings(value: DemoSettings): DemoSettings {
  return {
    notifications: { shiftReminder: value.notifications.shiftReminder, supportUpdates: value.notifications.supportUpdates, weeklyDigest: value.notifications.weeklyDigest },
    display: { listDensity: value.display.listDensity, showReferenceCode: value.display.showReferenceCode },
    privacy: { maskPreviewName: value.privacy.maskPreviewName },
  }
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[], message: string) {
  if (Object.keys(value).length !== keys.length || !keys.every(key => Object.prototype.hasOwnProperty.call(value, key))) throw new SettingsDemoError(message)
}
export function validateDemoSettings(input: unknown): DemoSettings {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new SettingsDemoError("Tùy chọn minh họa không hợp lệ.")
  const value = input as Record<string, unknown>
  exactKeys(value, ["notifications", "display", "privacy"], "Tùy chọn minh họa chỉ nhận thông báo, hiển thị và quyền riêng tư.")
  if (!value.notifications || typeof value.notifications !== "object" || Array.isArray(value.notifications)) throw new SettingsDemoError("Tùy chọn thông báo minh họa không hợp lệ.")
  const notifications = value.notifications as Record<string, unknown>
  exactKeys(notifications, ["shiftReminder", "supportUpdates", "weeklyDigest"], "Tùy chọn thông báo minh họa chỉ nhận ba công tắc đã duyệt.")
  if (![notifications.shiftReminder, notifications.supportUpdates, notifications.weeklyDigest].every(item => typeof item === "boolean")) throw new SettingsDemoError("Công tắc thông báo minh họa phải là đúng hoặc sai.")
  if (!value.display || typeof value.display !== "object" || Array.isArray(value.display)) throw new SettingsDemoError("Tùy chọn hiển thị minh họa không hợp lệ.")
  const display = value.display as Record<string, unknown>
  exactKeys(display, ["listDensity", "showReferenceCode"], "Tùy chọn hiển thị minh họa chỉ nhận mật độ và mã tham chiếu.")
  if (!["compact", "comfortable"].includes(display.listDensity as string) || typeof display.showReferenceCode !== "boolean") throw new SettingsDemoError("Mật độ hoặc mã tham chiếu minh họa không hợp lệ.")
  if (!value.privacy || typeof value.privacy !== "object" || Array.isArray(value.privacy)) throw new SettingsDemoError("Tùy chọn quyền riêng tư minh họa không hợp lệ.")
  const privacy = value.privacy as Record<string, unknown>
  exactKeys(privacy, ["maskPreviewName"], "Tùy chọn quyền riêng tư minh họa chỉ nhận che tên xem trước.")
  if (typeof privacy.maskPreviewName !== "boolean") throw new SettingsDemoError("Che tên xem trước phải là đúng hoặc sai.")
  return {
    notifications: { shiftReminder: notifications.shiftReminder as boolean, supportUpdates: notifications.supportUpdates as boolean, weeklyDigest: notifications.weeklyDigest as boolean },
    display: { listDensity: display.listDensity as "compact" | "comfortable", showReferenceCode: display.showReferenceCode as boolean },
    privacy: { maskPreviewName: privacy.maskPreviewName as boolean },
  }
}
export function demoSettingsPreview(input: DemoSettings): DemoSettingsPreview {
  const value = validateDemoSettings(input)
  const notificationSummary: string[] = []
  if (value.notifications.shiftReminder) notificationSummary.push("Nhắc lịch ca làm (DEMO)")
  if (value.notifications.supportUpdates) notificationSummary.push("Cập nhật yêu cầu hỗ trợ (DEMO)")
  if (value.notifications.weeklyDigest) notificationSummary.push("Bản tin tuần (DEMO)")
  if (!notificationSummary.length) notificationSummary.push("Không bật thông báo DEMO nào.")
  return {
    name: value.privacy.maskPreviewName ? "N. M. A." : "Nguyễn Minh Anh",
    masked: value.privacy.maskPreviewName,
    referenceCode: value.display.showReferenceCode ? "DEMO-CV-1042" : null,
    density: value.display.listDensity,
    notificationSummary,
  }
}
