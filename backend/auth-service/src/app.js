import express from 'express'
import cors from 'cors'
import { createHash, randomUUID } from 'node:crypto'
import { AuthError, loginInput } from './service.js'

export function createLoginGuard({ now = Date.now, windowMs = 60000, ipLimit = 30, phoneLimit = 10, concurrency = 2 } = {}) {
  const counts = new Map()
  let active = 0
  return function guard(req, res, next) {
    const time = now()
    for (const [key, item] of counts) if (item.until <= time) counts.delete(key)
    const phone = typeof req.body?.phone === 'string' ? req.body.phone.trim().slice(0, 20) : ''
    const keys = [['ip:' + req.ip, ipLimit], ['phone:' + createHash('sha256').update(phone).digest('hex'), phoneLimit]]
    if (active >= concurrency || counts.size >= 10000 || keys.some(([key, limit]) => (counts.get(key)?.count || 0) >= limit)) {
      res.setHeader('Retry-After', '60')
      return next(new AuthError(429, 'LOGIN_RATE_LIMITED', 'Vui lòng thử đăng nhập lại sau.'))
    }
    for (const [key] of keys) { const item = counts.get(key) || { count: 0, until: time + windowMs }; item.count++; counts.set(key, item) }
    active++
    let released = false
    const release = () => { if (!released) { released = true; active-- } }
    // Hold the slot until hashing finishes, even if the client disconnects.
    req.releaseLogin = release
    next()
  }
}
export function createApp({ service, repository, issuer, corsOrigins = [], loginGuard = createLoginGuard(), logger = () => {} }) {
  const app = express()
  app.disable('x-powered-by')
  app.use((req, res, next) => {
    req.requestId = randomUUID(); res.setHeader('X-Request-Id', req.requestId)
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff')
    res.on('finish', () => logger({ event: 'auth_request', method: req.method, path: req.path, status: res.statusCode, requestId: req.requestId }))
    next()
  })
  app.use(cors({ origin(origin, done) { done(origin && !corsOrigins.includes(origin) ? new AuthError(403, 'ORIGIN_DENIED', 'Origin không được phép.') : null, true) }, methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Authorization', 'Content-Type'], exposedHeaders: ['X-Request-Id'], maxAge: 600 }))
  app.use(express.json({ limit: '8kb', strict: true }))
  app.get('/health/live', (_req, res) => res.json({ status: 'ok', service: 'auth-service' }))
  app.get('/health/ready', async (_req, res) => { await repository.assertSchema(); res.json({ status: 'ready', service: 'auth-service' }) })
  app.get('/.well-known/jwks.json', (_req, res) => { res.setHeader('Cache-Control', 'public, max-age=300'); res.json(issuer.jwks) })
  app.post('/api/v1/auth/login', loginGuard, async (req, res) => {
    try { res.json(await service.login(loginInput(req.body))) }
    finally { req.releaseLogin?.() }
  })
  app.get('/api/v1/auth/introspect', async (req, res) => {
    const header = req.headers.authorization
    const token = typeof header === 'string' && header.length <= 8192 && /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(header)?.[1]
    if (!token) throw new AuthError(401, 'UNAUTHENTICATED', 'Access token không hợp lệ hoặc đã hết hạn.')
    res.json(await service.introspect(token))
  })
  app.use((_req, _res, next) => next(new AuthError(404, 'NOT_FOUND', 'Không tìm thấy API.')))
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error)
    const known = error instanceof AuthError
    const status = known ? error.status : error.type === 'entity.parse.failed' ? 400 : error.type === 'entity.too.large' ? 413 : ['DB_UNAVAILABLE', 'DATABASE_SCHEMA_INCOMPATIBLE'].includes(error.code) ? 503 : 500
    const code = known ? error.code : status === 400 ? 'INVALID_JSON' : status === 413 ? 'BODY_TOO_LARGE' : status === 503 ? 'DATABASE_UNAVAILABLE' : 'INTERNAL_ERROR'
    if (status === 401) res.setHeader('WWW-Authenticate', 'Bearer')
    if (status === 503) res.setHeader('Retry-After', '5')
    res.status(status).json({ error: { code, message: known ? error.message : status === 400 ? 'JSON không hợp lệ.' : status === 413 ? 'Dữ liệu vượt giới hạn.' : 'Chưa thể xử lý yêu cầu.' }, requestId: req.requestId })
  })
  return app
}
