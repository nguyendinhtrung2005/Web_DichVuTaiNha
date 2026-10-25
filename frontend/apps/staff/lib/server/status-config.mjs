import { loadStaffJobsConfig } from './jobs-config.mjs'

export function loadStaffStatusConfig(env = process.env, cwd = process.cwd()) {
  const config = loadStaffJobsConfig(env, cwd)
  const timeout = String(env.STAFF_STATUS_TIMEOUT_MS || '20000')
  if (!/^[1-9]\d*$/.test(timeout) || !Number.isSafeInteger(Number(timeout)) || Number(timeout) < 100 || Number(timeout) > 30000) {
    throw new Error('STAFF_STATUS_CONFIGURATION_INVALID')
  }
  return Object.freeze({ ...config, statusTimeoutMs: Number(timeout) })
}
