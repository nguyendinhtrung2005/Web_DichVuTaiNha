import { loadStaffAuthConfig } from './config.mjs'

/** UC9 server-only configuration; no internal credential or public environment variable. */
export function loadStaffJobsConfig(env = process.env, cwd = process.cwd()) {
  const config = loadStaffAuthConfig(env, cwd)
  const value = env.STAFF_SERVICE_URL || 'http://127.0.0.1:4005'
  let url
  try { url = new URL(value) } catch { throw new Error('STAFF_API_CONFIGURATION_INVALID') }
  if (!['http:', 'https:'].includes(url.protocol) || value !== url.origin
    || url.username || url.password || url.search || url.hash || url.pathname !== '/'
    || (config.production && url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
    throw new Error('STAFF_API_CONFIGURATION_INVALID')
  }
  const timeout = env.STAFF_API_TIMEOUT_MS || '8000'
  if (!/^[1-9]\d*$/.test(String(timeout)) || !Number.isSafeInteger(Number(timeout))
    || Number(timeout) < 100 || Number(timeout) > 15000) throw new Error('STAFF_API_CONFIGURATION_INVALID')
  return Object.freeze({ ...config, staffUrl: url.origin, jobsTimeoutMs: Number(timeout) })
}
