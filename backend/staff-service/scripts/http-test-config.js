import { readFile } from 'node:fs/promises'

function flag(env, name) {
  const value = env[name]
  if (value === undefined || value === '' || value === 'false') return false
  if (value === 'true') return true
  throw new Error('Expected true or false for ' + name)
}

export function httpTestPlan(env) {
  const enabled = flag(env, 'RUN_STAFF_HTTP_TESTS')
  const writeEnabled = flag(env, 'RUN_STAFF_HTTP_WRITE_TESTS')
  if (writeEnabled && !enabled) throw new Error('HTTP writes require RUN_STAFF_HTTP_TESTS=true')
  if (!enabled) return Object.freeze({ enabled: false, writeEnabled: false })
  if (env.MYSQL_DATABASE !== 'cleanhome_staff_test') throw new Error('HTTP integration requires MYSQL_DATABASE=cleanhome_staff_test')
  let base
  try { base = new URL(env.STAFF_HTTP_BASE_URL || 'http://127.0.0.1:4005') } catch { throw new Error('Invalid STAFF_HTTP_BASE_URL') }
  if (!['http:', 'https:'].includes(base.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)
    || base.username || base.password || base.search || base.hash || base.pathname !== '/') {
    throw new Error('HTTP integration requires a local base URL without credentials, path or query')
  }
  const timeoutMs = Number(env.STAFF_HTTP_TIMEOUT_MS || 8000)
  if (!Number.isInteger(timeoutMs) || timeoutMs < 500 || timeoutMs > 15000) throw new Error('STAFF_HTTP_TIMEOUT_MS must be 500..15000')
  if (writeEnabled && env.STAFF_HTTP_WRITE_BOOKING_ID !== '9109131') throw new Error('Confirm the dedicated fixture with STAFF_HTTP_WRITE_BOOKING_ID=9109131')
  return Object.freeze({ enabled, writeEnabled, baseUrl: base.origin, timeoutMs })
}

export async function readHttpTokens(env) {
  const result = {}
  for (const name of ['A', 'B', 'CUSTOMER']) {
    const variable = 'STAFF_HTTP_TOKEN_' + name
    const direct = env[variable]?.trim(), file = env[variable + '_FILE']?.trim()
    if (Boolean(direct) === Boolean(file)) throw new Error('Configure exactly one of ' + variable + ' and ' + variable + '_FILE')
    let token
    try { token = direct || (await readFile(file, 'utf8')).trim() } catch { throw new Error('Cannot read access token from ' + variable + '_FILE') }
    if (token.length > 8000 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
      throw new Error('Expected a raw Auth access token in ' + variable)
    }
    result[name] = token
  }
  return Object.freeze(result)
}
