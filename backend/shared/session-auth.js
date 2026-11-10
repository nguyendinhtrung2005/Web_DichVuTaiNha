import jwt from "jsonwebtoken"
import { createPublicKey } from "node:crypto"

function cookieValue(header = "", name) {
  for (const part of header.split(";")) {
    const separator = part.indexOf("=")
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue
    try { return decodeURIComponent(part.slice(separator + 1).trim()) } catch { return "" }
  }
  return ""
}

function createSessionAuth({ pool, publicKey, issuer, audience, cookieName = "cleanhome_access", requiredRole }) {
  const candidate = publicKey?.replace(/\\n/g, "\n")
  const key = candidate ? createPublicKey(candidate) : null
  if (key && key.asymmetricKeyType !== "rsa") throw new Error("JWT_PUBLIC_KEY must be an RSA public key.")

  return async function requireSession(req, res, next) {
    if (!key || !issuer || !audience) {
      return res.status(503).json({ error: { code: "AUTH_NOT_CONFIGURED", message: "Xác thực API chưa được cấu hình." } })
    }
    const authorization = req.get("authorization") || ""
    const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : ""
    const token = bearer || cookieValue(req.get("cookie"), cookieName)
    if (!token) return res.status(401).json({ error: { code: "AUTH_REQUIRED", message: "Phiên đăng nhập máy chủ không tồn tại hoặc đã hết hạn." } })

    let claims
    try {
      claims = jwt.verify(token, key, { algorithms: ["RS256"], issuer, audience })
    } catch {
      return res.status(401).json({ error: { code: "AUTH_INVALID", message: "Phiên đăng nhập máy chủ không hợp lệ hoặc đã hết hạn." } })
    }
    const userId = typeof claims === "object" ? claims.sub : undefined
    if (typeof userId !== "string" || !/^[1-9]\d{0,19}$/.test(userId) || BigInt(userId) > 9223372036854775807n) {
      return res.status(401).json({ error: { code: "AUTH_INVALID", message: "Danh tính trong phiên đăng nhập không hợp lệ." } })
    }
    try {
      const [users] = await pool.execute(
        "SELECT id, role, status FROM users WHERE id = ? LIMIT 1",
        [userId],
      )
      const account = users[0]
      if (!account || account.status !== "ACTIVE" || account.role !== requiredRole) {
        return res.status(403).json({ error: { code: "ROLE_REQUIRED", message: "Tài khoản không có quyền truy cập chức năng này." } })
      }
      req.authenticatedUser = { id: String(account.id), role: account.role }
      if (requiredRole === "ADMIN") req.admin = { id: String(account.id) }
      return next()
    } catch (error) {
      return next(error)
    }
  }
}

export { cookieValue, createSessionAuth }
