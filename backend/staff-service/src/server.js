import { runtime } from './runtime.js'
import { createApp } from './app.js'
import { startReconciliation } from './reconciliation.js'

const logger = record => process.stdout.write(JSON.stringify(record) + '\n')
let instance
try {
  instance = runtime()
  await instance.repository.assertSchema()
  const { config, service, authenticate, repository, pool } = instance
  const app = createApp({ service, authenticate, repository, corsOrigins: config.corsOrigins, logger, statusUpdatesConfigured: Boolean(config.order.baseUrl && config.order.token) })
  const server = app.listen(config.port, () => logger({ event: 'staff_service_listening', port: config.port }))
  server.headersTimeout = 15000
  server.requestTimeout = 30000
  server.on('error', async () => { logger({ event: 'listen_failed' }); await pool.end(); process.exitCode = 1 })
  const stopWorker = config.worker.enabled ? startReconciliation(service, config.worker, logger) : async () => {}
  let stopping = false
  async function stop() {
    if (stopping) return
    stopping = true
    const deadline = setTimeout(() => process.exit(1), 30000)
    deadline.unref()
    await new Promise(resolve => server.close(resolve))
    await stopWorker()
    await pool.end()
    clearTimeout(deadline)
  }
  process.once('SIGTERM', stop)
  process.once('SIGINT', stop)
} catch (error) {
  logger({ event: 'startup_failed', code: error.code || 'CONFIGURATION_OR_DATABASE_UNAVAILABLE' })
  if (instance) await instance.pool.end()
  process.exitCode = 1
}
