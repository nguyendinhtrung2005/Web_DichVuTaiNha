export function startReconciliation(service, { intervalMs, batchSize }, logger = () => {}) {
  let running = null
  let stopped = false
  const tick = () => {
    if (stopped || running) return
    running = service.reconcile(batchSize)
      .then(results => logger({ event: 'reconciliation', attempted: results.length, synchronized: results.filter(item => item.synchronized).length }))
      .catch(() => logger({ event: 'reconciliation_dependency_unavailable' }))
      .finally(() => { running = null })
  }
  const timer = setInterval(tick, intervalMs)
  timer.unref()
  tick()
  return async () => { stopped = true; clearInterval(timer); if (running) await running }
}
