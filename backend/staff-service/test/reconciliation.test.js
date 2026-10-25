import test from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as delay, setImmediate as flush } from 'node:timers/promises'
import { startReconciliation } from '../src/reconciliation.js'

const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}
const bounded = promise => {
  let timer
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Scheduler did not complete the expected run')), 1000) })
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer))
}

// These tests exercise the real scheduler with an explicitly test-only service
// double. They do not issue JWTs, contact Auth/Order, or change database state.
test('reconciliation scheduler runs immediately, forwards batch size and logs aggregate metadata', { timeout: 2000 }, async t => {
  const batches = [], logs = []
  const service = { async reconcile(limit) { batches.push(limit); return [{ synchronized: true }, { synchronized: false }] } }
  const stop = startReconciliation(service, { intervalMs: 60000, batchSize: 17 }, value => logs.push(value))
  t.after(stop)
  await flush()
  assert.deepEqual(batches, [17])
  assert.deepEqual(logs, [{ event: 'reconciliation', attempted: 2, synchronized: 1 }])
  await stop()
})

test('reconciliation scheduler does not overlap a slow run and stop waits for that run', { timeout: 2000 }, async t => {
  const pending = deferred()
  let calls = 0, stopped = false
  const service = { async reconcile() { calls++; return pending.promise } }
  const stop = startReconciliation(service, { intervalMs: 5, batchSize: 20 })
  t.after(async () => { pending.resolve([]); await stop() })
  await delay(30)
  assert.equal(calls, 1)
  const stopping = stop().then(() => { stopped = true })
  await flush()
  assert.equal(stopped, false)
  pending.resolve([])
  await stopping
  assert.equal(stopped, true)
  await delay(15)
  assert.equal(calls, 1)
})

test('reconciliation scheduler catches dependency failure, retries on interval and never logs error contents', { timeout: 2000 }, async t => {
  const recovered = deferred(), logs = []
  let calls = 0
  const service = { async reconcile() {
    calls++
    if (calls === 1) throw new Error('private-dependency-detail-must-not-be-logged')
    recovered.resolve()
    return [{ synchronized: true }]
  } }
  const stop = startReconciliation(service, { intervalMs: 10, batchSize: 3 }, value => logs.push(value))
  t.after(stop)
  await bounded(recovered.promise)
  await stop()
  assert.equal(calls, 2)
  assert.deepEqual(logs, [{ event: 'reconciliation_dependency_unavailable' }, { event: 'reconciliation', attempted: 1, synchronized: 1 }])
  assert.equal(JSON.stringify(logs).includes('private-dependency-detail'), false)
})

test('reconciliation scheduler stop is repeatable and prevents subsequent interval calls', { timeout: 2000 }, async t => {
  let calls = 0
  const stop = startReconciliation({ async reconcile() { calls++; return [] } }, { intervalMs: 5, batchSize: 1 })
  t.after(stop)
  await Promise.all([stop(), stop()])
  await delay(20)
  assert.equal(calls, 1)
})
