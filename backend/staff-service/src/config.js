const freeze = value => {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value
}

function required(env, name) {
  const value = env[name]
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing required configuration: ${name}`)
  return value.trim()
}

function integer(env, name, fallback, min, max) {
  const raw = env[name] ?? String(fallback)
  if (!/^\d+$/.test(raw)) throw new Error(`Invalid integer configuration: ${name}`)
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`Configuration outside allowed range: ${name}`)
  return value
}

function boolean(env, name, fallback) {
  const raw = env[name]
  if (raw === undefined || raw === '') return fallback
  if (raw === 'true') return true
  if (raw === 'false') return false
  throw new Error(`Invalid boolean configuration: ${name}`)
}

function httpUrl(value, name) {
  let url
  try { url = new URL(value) } catch { throw new Error(`Invalid URL configuration: ${name}`) }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new Error(`Invalid URL configuration: ${name}`)
  }
  // Plain HTTP is only permitted for local development/service networks explicitly configured by the operator.
  return url.toString()
}

export function loadConfig(env = process.env) {
  const algorithm = required(env, 'JWT_ALGORITHM')
  if (!['HS256', 'RS256'].includes(algorithm)) throw new Error('JWT_ALGORITHM must be HS256 or RS256')
  const secret = env.JWT_SECRET || undefined
  const publicKey = env.JWT_PUBLIC_KEY?.replace(/\\n/g, '\n') || undefined
  const jwksUrl = env.JWT_JWKS_URL ? httpUrl(env.JWT_JWKS_URL, 'JWT_JWKS_URL') : undefined
  if (algorithm === 'HS256' && (!secret || Buffer.byteLength(secret, 'utf8') < 32)) {
    throw new Error('JWT_SECRET must contain at least 32 bytes for HS256')
  }
  if (algorithm === 'RS256' && Number(Boolean(publicKey)) + Number(Boolean(jwksUrl)) !== 1) {
    throw new Error('RS256 requires exactly one of JWT_PUBLIC_KEY and JWT_JWKS_URL')
  }
  const corsOrigins = (env.CORS_ORIGINS ?? 'http://localhost:3002').split(',').map(value => value.trim()).filter(Boolean)
  if (!corsOrigins.length) throw new Error('CORS_ORIGINS must contain at least one origin')
  for (const origin of corsOrigins) {
    const url = new URL(httpUrl(origin, 'CORS_ORIGINS'))
    if (url.origin !== origin) throw new Error('CORS_ORIGINS must contain origins without paths')
  }
  const workerEnabled = boolean(env, 'RECONCILIATION_WORKER_ENABLED', false)
  const orderUrl = env.ORDER_SERVICE_URL ? httpUrl(env.ORDER_SERVICE_URL, 'ORDER_SERVICE_URL').replace(/\/$/, '') : undefined
  const orderToken = env.ORDER_SERVICE_TOKEN || undefined
  if (workerEnabled && (!orderUrl || !orderToken)) throw new Error('The reconciliation worker requires ORDER_SERVICE_URL and ORDER_SERVICE_TOKEN')
  return freeze({
    port: integer(env, 'PORT', 4005, 1, 65535),
    corsOrigins,
    db: {
      host: env.MYSQL_HOST?.trim() || '127.0.0.1',
      port: integer(env, 'MYSQL_PORT', 3306, 1, 65535),
      user: required(env, 'MYSQL_USER'),
      password: env.MYSQL_PASSWORD ?? '',
      database: required(env, 'MYSQL_DATABASE'),
      connectionLimit: integer(env, 'MYSQL_CONNECTION_LIMIT', 10, 1, 100)
    },
    jwt: {
      issuer: required(env, 'JWT_ISSUER'),
      audience: required(env, 'JWT_AUDIENCE'),
      algorithm,
      secret,
      jwksUrl,
      publicKey,
      introspectionUrl: env.AUTH_INTROSPECTION_URL ? httpUrl(env.AUTH_INTROSPECTION_URL, 'AUTH_INTROSPECTION_URL') : undefined
    },
    order: {
      baseUrl: orderUrl,
      token: orderToken,
      timeoutMs: integer(env, 'ORDER_SERVICE_TIMEOUT_MS', 5000, 100, 30000)
    },
    worker: {
      enabled: workerEnabled,
      intervalMs: integer(env, 'RECONCILIATION_WORKER_INTERVAL_MS', 5000, 250, 300000),
      batchSize: integer(env, 'RECONCILIATION_WORKER_BATCH_SIZE', 20, 1, 100)
    }
  })
}
