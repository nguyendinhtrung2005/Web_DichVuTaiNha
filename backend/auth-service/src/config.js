const required = (env, name) => {
  if (typeof env[name] !== 'string' || !env[name].trim()) throw new Error('Missing configuration: ' + name)
  return env[name].trim()
}
function integer(env, name, fallback, min, max) {
  const value = env[name] ?? String(fallback)
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max) throw new Error('Invalid configuration: ' + name)
  return Number(value)
}
function url(value, name) {
  let result
  try { result = new URL(value) } catch { throw new Error('Invalid URL: ' + name) }
  if (!['http:', 'https:'].includes(result.protocol) || result.username || result.password || result.search || result.hash) throw new Error('Invalid URL: ' + name)
  return result
}
export function loadDbConfig(env = process.env) {
  return Object.freeze({ host: env.MYSQL_HOST?.trim() || '127.0.0.1', port: integer(env, 'MYSQL_PORT', 3306, 1, 65535),
    user: required(env, 'MYSQL_USER'), password: env.MYSQL_PASSWORD ?? '', database: required(env, 'MYSQL_DATABASE'),
    connectionLimit: integer(env, 'MYSQL_CONNECTION_LIMIT', 5, 1, 20) })
}
export function loadConfig(env = process.env) {
  const issuer = required(env, 'JWT_ISSUER'), audience = required(env, 'JWT_AUDIENCE')
  url(issuer, 'JWT_ISSUER')
  if (audience.length > 200) throw new Error('Invalid configuration: JWT_AUDIENCE')
  const kid = required(env, 'JWT_KEY_ID')
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(kid)) throw new Error('Invalid configuration: JWT_KEY_ID')
  const origins = (env.CORS_ORIGINS || 'http://localhost:3001,http://localhost:3002,http://localhost:3003').split(',').map(value => value.trim())
  for (const origin of origins) if (url(origin, 'CORS_ORIGINS').origin !== origin) throw new Error('Invalid origin')
  return Object.freeze({ port: integer(env, 'PORT', 4001, 1, 65535), db: loadDbConfig(env), corsOrigins: Object.freeze(origins),
    jwt: Object.freeze({ issuer, audience, kid, privateKeyFile: required(env, 'JWT_PRIVATE_KEY_FILE'), ttlSeconds: integer(env, 'JWT_ACCESS_TTL_SECONDS', 900, 60, 3600) }) })
}
