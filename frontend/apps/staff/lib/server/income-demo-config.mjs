/** Staff presentation flag only. No query, cookie or browser preference can enable it. */
export function isStaffIncomeDemoEnabled(env = process.env) {
  return env.NODE_ENV === 'development' && env.STAFF_INCOME_DEMO_ENABLED === 'true'
}
