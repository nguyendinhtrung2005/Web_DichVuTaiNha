// Resolve Order's exact locked dependencies through an existing worktree install.
// This never creates or edits a package in node_modules.
import { registerHooks, createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { repoRoot } from './common.mjs'

const order = join(repoRoot, 'backend/order-service')
const prefix = pathToFileURL(order).href + '/'
const available = createRequire(join(repoRoot, 'backend/auth-service/package.json'))
const lock = JSON.parse(readFileSync(join(order, 'package-lock.json'), 'utf8'))
for (const name of ['express', 'mysql2']) {
  const actual = JSON.parse(readFileSync(available.resolve(name + '/package.json'), 'utf8')).version
  if (actual !== lock.packages['node_modules/' + name]?.version) throw Error('QA_ORDER_DEPENDENCY_VERSION_MISMATCH')
}
registerHooks({ resolve(specifier, context, nextResolve) {
  try { return nextResolve(specifier, context) }
  catch (error) {
    if (!['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND'].includes(error.code) || !context.parentURL?.startsWith(prefix)
      || !['express', 'mysql2/promise'].includes(specifier)) throw error
    return { url: pathToFileURL(available.resolve(specifier)).href, shortCircuit: true }
  }
} })
