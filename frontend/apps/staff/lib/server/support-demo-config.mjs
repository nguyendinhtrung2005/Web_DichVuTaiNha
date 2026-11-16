/** Server-only opt-in; production and browser input cannot enable illustrative support tickets. */
export function isStaffSupportDemoEnabled(env = process.env) {
  return env.NODE_ENV === "development" && env.STAFF_SUPPORT_DEMO_ENABLED === "true"
}
