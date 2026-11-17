import { verifyPassword, getDummyHash, isSupportedPasswordHash } from './password.js'

export class AuthError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code }
}
export const roles = new Set(['CUSTOMER', 'EMPLOYEE', 'ADMIN'])
const unauthorized = () => new AuthError(401, 'INVALID_CREDENTIALS', 'Số điện thoại hoặc mật khẩu không đúng.')
function activeUser(user) {
  if (!user || !roles.has(user.role)) throw new AuthError(403, 'ACCESS_DENIED', 'Tài khoản không được phép truy cập.')
  if (user.status !== 'ACTIVE') throw new AuthError(403, 'ACCOUNT_LOCKED', 'Tài khoản hiện không hoạt động.')
  if (user.role === 'EMPLOYEE' && (!user.employeeId || user.employeeStatus !== 'ACTIVE')) throw new AuthError(403, 'EMPLOYEE_INACTIVE', 'Hồ sơ nhân viên hiện không hoạt động.')
}
export function loginInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['phone', 'password', 'role'].includes(key))) throw new AuthError(400, 'INVALID_INPUT', 'Thông tin đăng nhập không hợp lệ.')
  const { phone, password, role } = value
  if (typeof phone !== 'string' || !phone.trim() || phone.trim().length > 20 || /[\u0000-\u001f\u007f]/.test(phone)
    || typeof password !== 'string' || Array.from(password).length < 1 || Array.from(password).length > 128 || Buffer.byteLength(password, 'utf8') > 512
    || (role !== undefined && !roles.has(role))) throw new AuthError(400, 'INVALID_INPUT', 'Thông tin đăng nhập không hợp lệ.')
  return { phone: phone.trim(), password, role }
}
export class AuthService {
  constructor({ repository, issuer }) { this.repository = repository; this.issuer = issuer }
  async login(input) {
    const user = await this.repository.findByPhone(input.phone)
    const encoded = user && isSupportedPasswordHash(user.passwordHash) ? user.passwordHash : await getDummyHash()
    const valid = await verifyPassword(input.password, encoded)
    if (!user || !valid || !isSupportedPasswordHash(user.passwordHash)) throw unauthorized()
    activeUser(user)
    if (input.role !== undefined && input.role !== user.role) throw new AuthError(403, 'ROLE_MISMATCH', 'Tài khoản không thuộc vai trò đã chọn.')
    // Re-read current account state after expensive hashing. Never sign a stale role.
    const current = await this.repository.findByPhone(input.phone)
    if (!current || current.id !== user.id || current.passwordHash !== user.passwordHash || current.role !== user.role) throw unauthorized()
    activeUser(current)
    return { accessToken: await this.issuer.issue(current), tokenType: 'Bearer', expiresIn: this.issuer.ttlSeconds,
      user: { id: current.id, role: current.role, status: current.status } }
  }
  async introspect(token) {
    let payload
    try { payload = await this.issuer.verify(token) } catch { throw new AuthError(401, 'UNAUTHENTICATED', 'Access token không hợp lệ hoặc đã hết hạn.') }
    const user = await this.repository.findById(payload.sub)
    if (!user) throw new AuthError(401, 'UNAUTHENTICATED', 'Access token không còn hợp lệ.')
    activeUser(user)
    if (payload.role !== user.role) throw new AuthError(403, 'ROLE_CHANGED', 'Quyền tài khoản đã thay đổi.')
    return { sub: user.id, userId: user.id, role: user.role, status: user.status, active: true, locked: false }
  }
}
