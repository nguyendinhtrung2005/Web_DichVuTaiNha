/** Server-only opt-in; production and browser input cannot enable illustrative account settings. */
export function isStaffSettingsDemoEnabled(env = process.env) {
  return env.NODE_ENV === "development" && env.STAFF_SETTINGS_DEMO_ENABLED === "true"
}
