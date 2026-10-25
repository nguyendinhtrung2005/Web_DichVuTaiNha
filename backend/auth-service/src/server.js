import { runtime } from './runtime.js'
import { createApp } from './app.js'
const logger = record => process.stdout.write(JSON.stringify(record) + '\n')
let instance
try {
  instance = await runtime()
  const { config } = instance
  const server = createApp({ ...instance, corsOrigins: config.corsOrigins, logger }).listen(config.port, () => logger({ event: 'auth_service_listening', port: config.port }))
  server.headersTimeout = 15000; server.requestTimeout = 30000
  server.on('error', async () => { logger({ event: 'listen_failed' }); await instance.pool.end(); process.exitCode = 1 })
  let stopping = false
  async function stop() {
    if (stopping) return
    stopping = true
    const deadline = setTimeout(() => process.exit(1), 15000); deadline.unref()
    await new Promise(resolve => server.close(resolve)); await instance.pool.end(); clearTimeout(deadline)
  }
  process.once('SIGTERM', stop); process.once('SIGINT', stop)
} catch { logger({ event: 'auth_startup_failed', code: 'CONFIGURATION_KEY_OR_DATABASE_UNAVAILABLE' }); if (instance) await instance.pool.end(); process.exitCode = 1 }
