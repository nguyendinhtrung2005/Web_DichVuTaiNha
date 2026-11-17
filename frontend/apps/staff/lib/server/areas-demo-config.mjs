/** Server-only opt-in; production and browser input cannot enable illustrative areas. */
export function isStaffAreasDemoEnabled(env = process.env) {
  return env.NODE_ENV === "development" && env.STAFF_AREAS_DEMO_ENABLED === "true"
}
