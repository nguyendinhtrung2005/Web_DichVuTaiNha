import test from 'node:test'
import assert from 'node:assert/strict'
import { realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const appDirectory = dirname(fileURLToPath(new URL('../next.config.mjs', import.meta.url)))
const nextPackage = realpathSync(require.resolve('next/package.json'))
function includes(root, target) {
  const part = relative(root, target)
  return part !== '..' && !part.startsWith('..' + sep) && !isAbsolute(part)
}
async function configuration(mode) {
  const previous = process.env.NODE_ENV
  try {
    process.env.NODE_ENV = mode
    return (await import(new URL('../next.config.mjs?local-runtime=' + mode, import.meta.url))).default
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previous
  }
}

test('development root encloses the app and resolved dependencies, including an external worktree junction', async () => {
  const config = await configuration('development')
  assert.equal(isAbsolute(config.turbopack.root), true)
  assert.equal(config.outputFileTracingRoot, config.turbopack.root)
  assert.equal(includes(config.turbopack.root, appDirectory), true)
  assert.equal(includes(config.turbopack.root, nextPackage), true)
})

test('production tracing does not inherit the wider local development filesystem root', async () => {
  const config = await configuration('production')
  assert.equal(config.outputFileTracingRoot, undefined)
  assert.equal(config.turbopack, undefined)
  assert.equal(config.typescript.ignoreBuildErrors, false)
})
