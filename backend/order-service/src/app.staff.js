import express from 'express'
import { randomUUID } from 'node:crypto'
import { OrderError } from './domain.js'
import { operationInput, pendingLimit } from './validation.js'
export function createApp({ service, repository, authenticate, logger = () => {} }) {
  const app = express()
  app.disable('x-powered-by'); app.set('query parser', 'simple')
  app.use((req, res, next) => {
    req.requestId = randomUUID(); res.setHeader('X-Request-Id', req.requestId); res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff')
    res.on('finish', () => logger({ event: 'order_request', method: req.method, path: req.path, status: res.statusCode, requestId: req.requestId }))
    next()
  })
  app.get('/health/live', (_req, res) => res.json({ status: 'ok', service: 'order-service' }))
  app.get('/health/ready', async (_req, res) => { await repository.assertSchema(); res.json({ status: 'ready', service: 'order-service' }) })
  const router = express.Router()
  router.use(authenticate, express.json({ limit: '8kb', strict: true }))
  const path = '/bookings/:bookingId/assignment-transitions/:operationId'
  const input = (req, write) => operationInput(req.params, write ? req.body : req.query, req.get('X-Actor-User-Id'), req.get('Idempotency-Key'), write)
  router.get(path, async (req, res) => res.json(await service.lookup(input(req, false))))
  router.put(path, async (req, res) => res.json(await service.apply(input(req, true))))
  router.post(path + '/acknowledgement', async (req, res) => res.json(await service.acknowledge(input(req, true))))
  router.get('/assignment-transitions/pending', async (req, res) => res.json(await service.pending(pendingLimit(req.query))))
  app.use('/internal/v1', router)
  app.use((_req, _res, next) => next(new OrderError(404, 'NOT_FOUND', 'Không tìm thấy API.')))
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error)
    const known = error instanceof OrderError, status = known ? error.status : error.type === 'entity.parse.failed' ? 400 : error.type === 'entity.too.large' ? 413 : 500
    if (status === 401) res.setHeader('WWW-Authenticate', 'Bearer')
    if (status === 503) res.setHeader('Retry-After', '2')
    res.status(status).json({ error: { code: known ? error.code : status === 400 ? 'INVALID_JSON' : status === 413 ? 'BODY_TOO_LARGE' : 'INTERNAL_ERROR', message: known ? error.message : 'Chưa thể xử lý yêu cầu.' }, requestId: req.requestId })
  })
  return app
}
