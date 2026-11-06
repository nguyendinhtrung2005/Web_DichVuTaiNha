/** Server-only opt-in; production and browser input cannot enable illustrative reviews or achievements. */
export function isStaffAchievementsDemoEnabled(env = process.env) {
  return env.NODE_ENV === "development" && env.STAFF_ACHIEVEMENTS_DEMO_ENABLED === "true"
}
