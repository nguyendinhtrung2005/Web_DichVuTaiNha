const fs = require("node:fs")
const path = require("node:path")
const { createHash, createPrivateKey, createPublicKey, timingSafeEqual } = require("node:crypto")
const jwt = require("jsonwebtoken")
const { HttpError } = require("./http")
const { getPool } = require("./db")
const { toRole } = require("./constants")

const COOKIE_NAME = "cleanhome_session"
const SESSION_ROLES = new Set(["CUSTOMER", "EMPLOYEE", "ADMIN"])

class InvalidSessionTokenError extends Error {}

function jwtConfig() {
  const issuer = process.env.JWT_ISSUER
  const audience = process.env.JWT_AUDIENCE
  if (!issuer) throw new Error("JWT_ISSUER must be configured.")
  if (!audience) throw new Error("JWT_AUDIENCE must be configured.")
  return { issuer, audience }
}

function readPem(name) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} must be configured.`)
  return value.replace(/\\n/g, "\n")
}

function rsaKey(name, parseKey) {
  return parseRsaKey(name, readPem(name), parseKey)
}

function parseRsaKey(name, pem, parseKey) {
  let key
  try {
    key = parseKey(pem)
  } catch (error) {
    throw new Error(`${name} must contain a valid RSA key.`)
  }
  if (key.asymmetricKeyType !== "rsa" || key.asymmetricKeyDetails?.modulusLength < 2048) {
    throw new Error(`${name} must be an RSA key with at least a 2048-bit modulus.`)
  }
  return key
}

function getPrivateKey() {
  const configuredPath = process.env.JWT_PRIVATE_KEY_FILE
  if (!configuredPath) throw new Error("JWT_PRIVATE_KEY_FILE must be configured for the Auth Service.")
  const filePath = path.resolve(process.cwd(), configuredPath)
  let pem
  try {
    pem = fs.readFileSync(filePath, "utf8")
  } catch {
    throw new Error("JWT private key file could not be read by the Auth Service.")
  }
  return parseRsaKey("JWT_PRIVATE_KEY_FILE", pem, createPrivateKey)
}

function publicKeyId(key) {
  return createHash("sha256")
    .update(key.export({ format: "der", type: "spki" }))
    .digest("base64url")
    .slice(0, 22)
}

function getPublicKey() {
  return rsaKey("JWT_PUBLIC_KEY", createPublicKey)
}

function getJwks() {
  const publicKey = getPublicKey()
  const jwk = publicKey.export({ format: "jwk" })
  return {
    keys: [{
      ...jwk,
      kid: publicKeyId(publicKey),
      use: "sig",
      alg: "RS256",
      key_ops: ["verify"],
    }],
  }
}

function signSession(user) {
  const config = jwtConfig()
  const privateKey = getPrivateKey()
  const publicKey = getPublicKey()
  const privateKeyPublic = createPublicKey(privateKey)
  const kid = publicKeyId(publicKey)
  if (publicKeyId(privateKeyPublic) !== kid) {
    throw new Error("JWT_PRIVATE_KEY and JWT_PUBLIC_KEY must be a matching key pair.")
  }
  if (!SESSION_ROLES.has(user.role)) throw new Error("Session role must use the Auth database role mapping.")
  return jwt.sign(
    { role: user.role },
    privateKey,
    {
      algorithm: "RS256",
      audience: config.audience,
      expiresIn: process.env.JWT_EXPIRES_IN || "8h",
      issuer: config.issuer,
      keyid: kid,
      subject: String(user.id),
    },
  )
}

function verifySession(token) {
  const config = jwtConfig()
  const publicKey = getPublicKey()
  const decoded = jwt.decode(token, { complete: true })
  if (!decoded || decoded.header.kid !== publicKeyId(publicKey)) {
    throw new InvalidSessionTokenError("Session token key is invalid.")
  }
  let payload
  try {
    payload = jwt.verify(token, publicKey, {
      algorithms: ["RS256"],
      audience: config.audience,
      issuer: config.issuer,
    })
  } catch {
    throw new InvalidSessionTokenError("Session token is invalid.")
  }
  if (
    !payload
    || typeof payload === "string"
    || typeof payload.sub !== "string"
    || !SESSION_ROLES.has(payload.role)
    || !Number.isFinite(payload.exp)
    || payload.exp <= Math.floor(Date.now() / 1000)
  ) {
    throw new InvalidSessionTokenError("Session token claims are invalid.")
  }
  return payload
}

async function getActiveActor(payload) {
  const id = Number(payload.sub)
  if (!Number.isSafeInteger(id) || id < 1) return null
  const [users] = await getPool().execute("SELECT id, role, status FROM users WHERE id = ? LIMIT 1", [id])
  const user = users[0]
  const role = toRole(user?.role)
  if (!user || user.status !== "ACTIVE" || role !== toRole(payload.role)) return null
  return { id, role }
}

async function requireAuth(request, _response, next) {
  const token = request.cookies?.[COOKIE_NAME]
  if (!token) return next(new HttpError(401, "UNAUTHENTICATED", "Vui lòng đăng nhập để tiếp tục."))

  let payload
  try {
    payload = verifySession(token)
  } catch (error) {
    if (error instanceof InvalidSessionTokenError) {
      return next(new HttpError(401, "SESSION_INVALID", "Phiên đăng nhập hết hạn hoặc không hợp lệ."))
    }
    return next(error)
  }

  const introspectionUrl = process.env.AUTH_INTROSPECTION_URL
  const serviceToken = process.env.AUTH_INTROSPECTION_TOKEN
  if (!introspectionUrl) return next(new Error("AUTH_INTROSPECTION_URL must be configured."))
  if (!serviceToken) return next(new Error("AUTH_INTROSPECTION_TOKEN must be configured."))

  try {
    const response = await fetch(introspectionUrl, {
      headers: {
        authorization: `Bearer ${token}`,
        "x-service-token": serviceToken,
      },
      signal: AbortSignal.timeout(3000),
    })
    if (!response.ok) {
      return next(new HttpError(503, "AUTH_UNAVAILABLE", "Không thể xác minh trạng thái tài khoản."))
    }
    const result = await response.json()
    if (!result || typeof result.active !== "boolean") {
      throw new Error("Auth introspection returned an invalid response.")
    }
    if (!result.active) {
      return next(new HttpError(401, "SESSION_REVOKED", "Tài khoản không còn hoạt động hoặc phiên đăng nhập đã bị thu hồi."))
    }
    if (result.sub !== payload.sub || result.role !== payload.role) {
      return next(new HttpError(401, "SESSION_INVALID", "Phiên đăng nhập hết hạn hoặc không hợp lệ."))
    }
    const id = Number(payload.sub)
    if (!Number.isSafeInteger(id) || id < 1) {
      return next(new HttpError(401, "SESSION_INVALID", "Phiên đăng nhập hết hạn hoặc không hợp lệ."))
    }
    request.actor = { id, role: toRole(payload.role) }
    next()
  } catch (error) {
    if (error.name === "TimeoutError" || error.name === "AbortError" || error instanceof TypeError) {
      return next(new HttpError(503, "AUTH_UNAVAILABLE", "Không thể xác minh trạng thái tài khoản."))
    }
    next(error)
  }
}

function requireIntrospectionClient(request, _response, next) {
  const expected = process.env.AUTH_INTROSPECTION_TOKEN
  if (!expected) return next(new Error("AUTH_INTROSPECTION_TOKEN must be configured."))
  const supplied = request.get("x-service-token") || ""
  const expectedBuffer = Buffer.from(expected)
  const suppliedBuffer = Buffer.from(supplied)
  if (expectedBuffer.length !== suppliedBuffer.length || !timingSafeEqual(expectedBuffer, suppliedBuffer)) {
    return next(new HttpError(401, "SERVICE_UNAUTHENTICATED", "Dịch vụ gọi chưa được xác thực."))
  }
  next()
}

async function introspectSession(token) {
  let payload
  try {
    payload = verifySession(token)
  } catch (error) {
    if (error instanceof InvalidSessionTokenError) return { active: false }
    throw error
  }
  const actor = await getActiveActor(payload)
  if (!actor) return { active: false }
  return {
    active: true,
    sub: payload.sub,
    role: payload.role,
    iss: payload.iss,
    aud: payload.aud,
    exp: payload.exp,
  }
}

function requireRole(...roles) {
  return (request, _response, next) => {
    if (!request.actor || !roles.includes(request.actor.role)) return next(new HttpError(403, "FORBIDDEN", "Bạn không có quyền thực hiện thao tác này."))
    next()
  }
}

function cookieOptions() {
  const sameSite = process.env.COOKIE_SAME_SITE || "lax"
  return {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE === "true",
    sameSite,
    path: "/",
    maxAge: 8 * 60 * 60 * 1000,
  }
}

module.exports = {
  COOKIE_NAME,
  InvalidSessionTokenError,
  cookieOptions,
  getJwks,
  introspectSession,
  requireAuth,
  requireIntrospectionClient,
  requireRole,
  signSession,
  verifySession,
}
