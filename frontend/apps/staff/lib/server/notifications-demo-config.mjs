/** Server-only opt-in. No public flag, URL or browser preference can enable this demo. */
export function isStaffNotificationsDemoEnabled(env = process.env) {
  return env.NODE_ENV === "development" && env.STAFF_NOTIFICATIONS_DEMO_ENABLED === "true"
}
