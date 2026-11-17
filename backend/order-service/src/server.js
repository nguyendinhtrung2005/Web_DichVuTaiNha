import { runtime } from './runtime.js'
import { createApp } from './app.js'
const logger = row => process.stdout.write(JSON.stringify(row) + '\n')
let instance
try {
  instance = await runtime()
  const { config } = instance
  const server = createApp({ ...instance, logger }).listen(config.port, config.host, () => logger({ event: 'order_service_listening', host: config.host, port: config.port }))
  server.headersTimeout = 15000; server.requestTimeout = 15000
  server.on('error', async () => { logger({ event: 'order_listen_failed' }); try { await instance.pool.end() } catch {}; process.exitCode = 1 })
  let stopping = false
  const stop = async () => {
    if (stopping) return
    stopping = true
    const deadline = setTimeout(() => process.exit(1), 15000); deadline.unref()
    try { await new Promise(resolve => server.close(resolve)); await instance.pool.end() } catch { logger({ event: 'order_shutdown_failed' }) }
    finally { clearTimeout(deadline) }
  }
  process.once('SIGTERM', stop); process.once('SIGINT', stop)
} catch { logger({ event: 'order_startup_failed', code: 'CONFIGURATION_CREDENTIAL_OR_DATABASE_UNAVAILABLE' }); if (instance) { try { await instance.pool.end() } catch {} }; process.exitCode = 1 }
