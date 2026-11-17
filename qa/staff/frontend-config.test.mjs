import test from 'node:test'
import assert from 'node:assert/strict'
import { STAFF_QA_NODE_OPTIONS, staffQaNextConfig } from './frontend-config.mjs'

test('QA avoids development filesystem cache without mutating the source config or hiding types', () => {
  const source = { turbopack: { root: 'external' }, typescript: { ignoreBuildErrors: false }, experimental: { testOption: true } }
  const qa = staffQaNextConfig(source, 'isolated-root')
  assert.equal(qa.webpack({ cache: { type: 'filesystem' } }, { dev: true }).cache, false)
  assert.equal(qa.experimental.webpackMemoryOptimizations, true)
  assert.equal(qa.experimental.testOption, true)
  assert.equal(qa.experimental.cpus, 2)
  assert.equal(qa.typescript.ignoreBuildErrors, false)
  assert.equal(qa.turbopack, undefined)
  assert.equal(qa.outputFileTracingRoot, 'isolated-root')
  assert.deepEqual(source.turbopack, { root: 'external' })
  assert.deepEqual(source.experimental, { testOption: true })
  assert.equal(STAFF_QA_NODE_OPTIONS, '--max-old-space-size=2048')
})

test('existing webpack customization and production cache are preserved', () => {
  const qa = staffQaNextConfig({ webpack(input, context) { return { ...input, originalHookRan: context.isServer } } }, 'root')
  const cache = { type: 'filesystem' }
  assert.deepEqual(qa.webpack({ cache }, { dev: false, isServer: true }), { cache, originalHookRan: true })
  assert.deepEqual(qa.webpack({ cache }, { dev: true, isServer: true }), { cache: false, originalHookRan: true })
})
