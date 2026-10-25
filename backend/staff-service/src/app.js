import express from 'express'
import cors from 'cors'
import { randomUUID } from 'node:crypto'
import { HttpError } from './errors.js'
import { listQuery, positiveId, transitionInput } from './validation.js'

export function createApp({ service, authenticate, repository, corsOrigins = ['http://localhost:3002'], logger = () => {}, statusUpdatesConfigured = false }) {
  const app = express()
  app.disable('x-powered-by')
  app.set('query parser', 'simple')
  app.use((req, res, next) => {
    req.requestId = randomUUID()
    res.setHeader('X-Request-Id', req.requestId)
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    const started = performance.now()
    res.on('finish', () => logger({ event: 'http_request', requestId: req.requestId, method: req.method, path: req.path, status: res.statusCode, durationMs: Math.round(performance.now() - started) }))
    next()
  })
  app.use(cors({
    origin(origin, done) { done(origin && !corsOrigins.includes(origin) ? new HttpError(403, 'ORIGIN_DENIED', 'Origin không được cho phép.') : null, true) },
    credentials: true, methods: ['GET', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key'],
    exposedHeaders: ['X-Request-Id'], maxAge: 600,
  }))
  app.use(express.json({ limit: '16kb', strict: true }))
  app.get('/health/live', (req, res) => res.json({ status: 'ok', service: 'staff-service' }))
  app.get('/health/ready', async (req, res) => {
    await repository.assertSchema()
    res.status(statusUpdatesConfigured ? 200 : 503).json({ status: statusUpdatesConfigured ? 'ready' : 'dependency-missing', capabilities: { mysqlReads: true, orderStatusSynchronizationConfigured: statusUpdatesConfigured } })
  })
  const router = express.Router()
  router.use(authenticate)
  router.get('/jobs', async (req, res) => res.json(await service.list(req.actor, listQuery(req.query))))
  router.get('/schedule', async (req, res) => res.json(await service.list(req.actor, listQuery(req.query, true))))
  router.get('/jobs/:assignmentId', async (req, res) => res.json(await service.detail(req.actor, positiveId(req.params.assignmentId))))
  router.patch('/jobs/:assignmentId/status', async (req, res) => {
    const input = transitionInput(req.body, req.get('Idempotency-Key'))
    const result = await service.advance(req.actor, positiveId(req.params.assignmentId), input)
    res.status(result.httpStatus).json(result.body)
  })
  app.use('/api/v1/staff/me', router)
  app.use((req, res, next) => next(new HttpError(404, 'NOT_FOUND', 'Không tìm thấy API.')))
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error)
    const known = error instanceof HttpError
    const invalidJson = error.type === 'entity.parse.failed'
    const tooLarge = error.type === 'entity.too.large'
    const status = known ? error.status : invalidJson ? 400 : tooLarge ? 413 : 500
    const code = known ? error.code : invalidJson ? 'INVALID_JSON' : tooLarge ? 'BODY_TOO_LARGE' : 'INTERNAL_ERROR'
    if (status === 401) res.setHeader('WWW-Authenticate', 'Bearer')
    if (status === 503) res.setHeader('Retry-After', '5')
    res.status(status).json({ error: { code, message: known ? error.message : invalidJson ? 'JSON không hợp lệ.' : tooLarge ? 'Body vượt giới hạn.' : 'Chưa thể xử lý yêu cầu.', ...(known && error.details !== undefined ? { details: error.details } : {}) }, requestId: req.requestId })
  })
  return app
}
