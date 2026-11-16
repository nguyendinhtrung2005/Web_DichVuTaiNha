import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import test from 'node:test'

const require = createRequire(import.meta.url), ts = require('typescript')
const filename = fileURLToPath(new URL('../../../packages/ui/src/components/staff/staff-jobs-revalidation.ts', import.meta.url))
const source = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText
// Execute the actual event coordinator with a deterministic browser/clock, no HTTP or QA data.
function harness() {
  let now = 0, next = 0, busy = false, refreshes = 0
  const timers = new Map()
  const events = () => {
    const callbacks = new Map()
    return {
      addEventListener(type, fn) { if (!callbacks.has(type)) callbacks.set(type, new Set()); callbacks.get(type).add(fn) },
      removeEventListener(type, fn) { callbacks.get(type)?.delete(fn) },
      fire(type) { for (const fn of [...callbacks.get(type) || []]) fn() },
      count() { return [...callbacks.values()].reduce((n, entries) => n + entries.size, 0) },
    }
  }
  const window = { ...events(), setTimeout(fn, delay) { const id = ++next; timers.set(id, { fn, at: now + delay }); return id }, clearTimeout(id) { timers.delete(id) } }
  const document = { ...events(), visibilityState: 'visible' }, navigator = { onLine: true }, module = { exports: {} }
  vm.runInNewContext(source, { module, exports: module.exports, window, document, navigator, Date: { now: () => now } }, { filename, timeout: 2000 })
  const subscribe = () => module.exports.subscribeStaffJobsRevalidation(() => { refreshes++ }, () => busy)
  let stop = subscribe()
  return {
    window, document, navigator, timers,
    get refreshes() { return refreshes },
    busy(value) { busy = value },
    advance(ms) {
      const until = now + ms
      for (let count = 0; ; count++) {
        assert.ok(count < 100, 'finite scheduler work')
        const entry = [...timers].sort((a, b) => a[1].at - b[1].at).find(([, timer]) => timer.at <= until)
        if (!entry) break
        now = entry[1].at; timers.delete(entry[0]); entry[1].fn()
      }
      now = until
    },
    stop() { stop() },
    remount() { stop(); stop = subscribe() },
  }
}
test('jobs freshness: no polling or initial duplicate request', () => {
  const h = harness(); h.advance(60_000)
  assert.equal(h.refreshes, 0); assert.equal(h.timers.size, 0)
})
test('jobs freshness: focus and visible burst coalesces with minimum interval', () => {
  const h = harness(); h.window.fire('focus'); h.document.fire('visibilitychange'); h.window.fire('online')
  assert.equal(h.timers.size, 1); h.advance(4999); assert.equal(h.refreshes, 0)
  h.advance(1); assert.equal(h.refreshes, 1); assert.equal(h.timers.size, 0)
  h.window.fire('focus'); h.advance(4999); assert.equal(h.refreshes, 1)
  h.advance(1); assert.equal(h.refreshes, 2)
})
test('jobs freshness: idle focus has a short debounce without another five-second wait', () => {
  const h = harness(); h.advance(10_000); h.window.fire('focus')
  h.advance(149); assert.equal(h.refreshes, 0); h.advance(1); assert.equal(h.refreshes, 1)
})
test('jobs freshness: busy request finishes before one queued refresh, never aborts it', () => {
  const h = harness(); h.busy(true); h.window.fire('focus'); h.advance(5000)
  assert.equal(h.refreshes, 0); assert.equal(h.timers.size, 1)
  for (let n = 0; n < 5; n++) h.window.fire('focus')
  assert.equal(h.timers.size, 1); h.advance(750); assert.equal(h.refreshes, 0)
  h.busy(false); h.advance(250); assert.equal(h.refreshes, 1); assert.equal(h.timers.size, 0)
})
test('jobs freshness: hidden tab cancels work and visible triggers one later read', () => {
  const h = harness(); h.window.fire('focus'); h.document.visibilityState = 'hidden'; h.document.fire('visibilitychange')
  h.advance(10_000); assert.equal(h.refreshes, 0); assert.equal(h.timers.size, 0)
  h.document.visibilityState = 'visible'; h.document.fire('visibilitychange'); h.advance(150); assert.equal(h.refreshes, 1)
})
test('jobs freshness: offline cancels work, focus offline is ignored, online revalidates', () => {
  const h = harness(); h.window.fire('focus'); h.navigator.onLine = false; h.window.fire('offline'); h.window.fire('focus')
  h.advance(10_000); assert.equal(h.refreshes, 0); assert.equal(h.timers.size, 0)
  h.navigator.onLine = true; h.window.fire('online'); h.advance(150); assert.equal(h.refreshes, 1)
})
test('jobs freshness: actual hidden/offline state is checked again when timer fires', () => {
  for (const change of [h => { h.document.visibilityState = 'hidden' }, h => { h.navigator.onLine = false }]) {
    const h = harness(); h.window.fire('focus'); change(h); h.advance(10_000)
    assert.equal(h.refreshes, 0); assert.equal(h.timers.size, 0)
  }
})
test('jobs freshness: query or account remount disposes stale queued work', () => {
  const h = harness(); h.busy(true); h.window.fire('focus'); h.advance(5000); h.remount(); h.busy(false)
  h.advance(10_000); assert.equal(h.refreshes, 0)
  assert.equal(h.window.count(), 3); assert.equal(h.document.count(), 1)
  h.window.fire('focus'); h.advance(150); assert.equal(h.refreshes, 1)
})
test('jobs freshness: cleanup and strict remount remove every listener and timer', () => {
  const h = harness(); h.window.fire('focus'); h.stop(); h.stop()
  assert.equal(h.window.count(), 0); assert.equal(h.document.count(), 0); assert.equal(h.timers.size, 0)
  h.window.fire('focus'); h.window.fire('online'); h.document.fire('visibilitychange'); h.advance(60_000)
  assert.equal(h.refreshes, 0)
})
