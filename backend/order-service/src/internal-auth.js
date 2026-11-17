import { createHash, timingSafeEqual } from 'node:crypto'
import { OrderError } from './domain.js'
export function createInternalAuth(token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43,200}$/.test(token)) throw new Error('Invalid internal credential configuration')
  const expected = createHash('sha256').update(token).digest()
  return function internalAuth(req, _res, next) {
    const value = req.headers.authorization
    const match = typeof value === 'string' && value.length <= 512 && /^Bearer ([A-Za-z0-9_-]{43,200})$/i.exec(value)
    if (!match || !timingSafeEqual(createHash('sha256').update(match[1]).digest(), expected)) return next(new OrderError(401, 'SERVICE_UNAUTHENTICATED', 'Yêu cầu cần được xác thực giữa các dịch vụ.'))
    // Browser-supplied Origin is never needed for this internal service API.
    if (req.headers.origin !== undefined) return next(new OrderError(403, 'INTERNAL_ONLY', 'API này chỉ dành cho giao tiếp nội bộ.'))
    next()
  }
}
