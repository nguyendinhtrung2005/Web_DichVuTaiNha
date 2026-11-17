import { runtime } from './runtime.js'
import { startReconciliation } from './reconciliation.js'

let instance
try {
  instance = runtime()
  if (!instance.config.order.baseUrl || !instance.config.order.token) throw new Error('ORDER_SERVICE_REQUIRED')
  await instance.repository.assertSchema()
  const log = record => process.stdout.write(JSON.stringify(record) + '\n')
  const stop = startReconciliation(instance.service, instance.config.worker, log)
  // Unlike the in-server timer, a standalone worker must keep the process alive.
  const keepAlive = setInterval(() => {}, 60000)
  let stopping = false
  async function close() {
    if (stopping) return
    stopping = true
    const deadline = setTimeout(() => process.exit(1), 30000)
    deadline.unref()
    await stop(); clearInterval(keepAlive); await instance.pool.end(); clearTimeout(deadline)
  }
  process.once('SIGTERM', close)
  process.once('SIGINT', close)
} catch {
  process.stderr.write(JSON.stringify({ event: 'worker_startup_failed' }) + '\n')
  if (instance) await instance.pool.end()
  process.exitCode = 1
}
