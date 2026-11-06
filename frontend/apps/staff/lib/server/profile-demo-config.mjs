/** Explicit Staff presentation capability, independent of Income and Auth. */
export function isStaffProfileDemoEnabled(env = process.env) {
  return env.NODE_ENV === 'development' && env.STAFF_PROFILE_DEMO_ENABLED === 'true'
}
