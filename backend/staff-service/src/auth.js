import { createRemoteJWKSet, importSPKI, jwtVerify } from 'jose'
import { HttpError } from './errors.js'

const denied = () => new HttpError(403, 'STAFF_ACCESS_REQUIRED', 'Tài khoản không được phép truy cập chức năng nhân viên.')
const unauthorized = () => new HttpError(401, 'UNAUTHENTICATED', 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.')
const authUnavailable = () => new HttpError(503, 'AUTH_UNAVAILABLE', 'Chưa thể kiểm tra trạng thái tài khoản. Vui lòng thử lại sau.')
const isStaff = role => typeof role === 'string' && ['STAFF', 'EMPLOYEE'].includes(role.toUpperCase())

function validateStatus(claims) {
  for (const field of ['locked', 'isLocked']) {
    if (field in claims && claims[field] !== false) throw denied()
  }
  for (const field of ['active', 'isActive']) {
    if (field in claims && claims[field] !== true) throw denied()
  }
  for (const field of ['status', 'accountStatus']) {
    if (field in claims && (typeof claims[field] !== 'string' || !['ACTIVE', 'ENABLED'].includes(claims[field].toUpperCase()))) throw denied()
  }
}

function validSubject(subject) {
  // users.id is signed BIGINT. Reject strings MySQL might silently coerce to another user ID.
  return typeof subject === 'string' && /^[1-9]\d{0,18}$/.test(subject) && BigInt(subject) <= 9223372036854775807n
}

async function checkCurrentStatus(config, token, subject, fetchImpl) {
  let response
  let body
  try {
    response = await fetchImpl(config.introspectionUrl, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
      redirect: 'error'
    })
    if (response.status === 401) throw unauthorized()
    if (response.status === 403) throw denied()
    if (!response.ok) throw authUnavailable()
    body = await response.json()
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw authUnavailable()
  }
  if (!body || typeof body !== 'object' || Array.isArray(body) || !validSubject(body.sub) || typeof body.role !== 'string' || typeof body.active !== 'boolean') {
    throw authUnavailable()
  }
  if (body.sub !== subject) throw unauthorized()
  if (!isStaff(body.role)) throw denied()
  validateStatus(body)
}

export function createAuthenticate(config, { fetchImpl = globalThis.fetch } = {}) {
  const jwt = config.jwt
  if (!jwt || !['HS256', 'RS256'].includes(jwt.algorithm) || !jwt.issuer || !jwt.audience) {
    throw new Error('JWT verification configuration is incomplete')
  }
  let key
  if (jwt.algorithm === 'HS256') {
    if (typeof jwt.secret !== 'string' || Buffer.byteLength(jwt.secret, 'utf8') < 32) throw new Error('JWT_SECRET must contain at least 32 bytes for HS256')
    key = new TextEncoder().encode(jwt.secret)
  } else if (jwt.jwksUrl && !jwt.publicKey) {
    key = createRemoteJWKSet(new URL(jwt.jwksUrl), { timeoutDuration: 5000, cooldownDuration: 30000, cacheMaxAge: 600000 })
  } else if (jwt.publicKey && !jwt.jwksUrl) {
    // Import is deferred into a promise so both middleware creation and async failures are handled safely.
    key = importSPKI(jwt.publicKey, jwt.algorithm)
    key.catch(() => {})
  } else {
    throw new Error('RS256 requires exactly one verification key source')
  }
  return async function authenticate(req, _res, next) {
    try {
      const header = req.headers.authorization
      if (typeof header !== 'string' || header.length > 8192) throw unauthorized()
      const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(header)
      if (!match) throw unauthorized()
      const token = match[1]
      let payload
      try {
        const verified = await jwtVerify(token, await key, {
          issuer: jwt.issuer,
          audience: jwt.audience,
          algorithms: [jwt.algorithm],
          requiredClaims: ['sub', 'exp'],
          clockTolerance: 0
        })
        payload = verified.payload
      } catch (error) {
        if (jwt.jwksUrl && (error.code === 'ERR_JWKS_TIMEOUT' || error.code === 'ERR_JOSE_GENERIC' || error instanceof TypeError)) throw authUnavailable()
        throw unauthorized()
      }
      if (!validSubject(payload.sub)) throw unauthorized()
      if (!isStaff(payload.role)) throw denied()
      validateStatus(payload)
      if (jwt.introspectionUrl) await checkCurrentStatus(jwt, token, payload.sub, fetchImpl)
      req.actor = Object.freeze({ userId: payload.sub, role: 'staff' })
      next()
    } catch (error) {
      next(error)
    }
  }
}
