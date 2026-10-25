import { readFile } from 'node:fs/promises'
const required = (env, name) => { if (typeof env[name] !== 'string' || !env[name].trim()) throw new Error('Missing configuration: ' + name); return env[name].trim() }
const number = (env, name, fallback, min, max) => {
  const value = env[name] ?? String(fallback)
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max) throw new Error('Invalid configuration: ' + name)
  return Number(value)
}
export function loadDbConfig(env = process.env) {
  return Object.freeze({ host: env.MYSQL_HOST?.trim() || '127.0.0.1', port: number(env, 'MYSQL_PORT', 3306, 1, 65535), user: required(env, 'MYSQL_USER'), password: env.MYSQL_PASSWORD ?? '', database: required(env, 'MYSQL_DATABASE'), connectionLimit: number(env, 'MYSQL_CONNECTION_LIMIT', 5, 1, 20) })
}
export function loadConfig(env = process.env) {
  const direct = env.ORDER_SERVICE_TOKEN?.trim(), file = env.ORDER_SERVICE_TOKEN_FILE?.trim()
  if (Boolean(direct) === Boolean(file)) throw new Error('Configure exactly one service credential source')
  const host = env.HOST || '127.0.0.1'
  if (!/^[a-zA-Z0-9.:-]{1,253}$/.test(host)) throw new Error('Invalid HOST')
  return Object.freeze({ host, port: number(env, 'PORT', 4003, 1, 65535), db: loadDbConfig(env), credential: Object.freeze({ direct, file }) })
}
export async function readServiceToken(config) {
  let token
  try { token = (config.direct || await readFile(config.file, 'utf8')).trim() } catch { throw new Error('Service credential file could not be read') }
  if (!/^[A-Za-z0-9_-]{43,200}$/.test(token)) throw new Error('A real service credential of at least 32 random bytes is required')
  return token
}
