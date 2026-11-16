import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import { parseReadAll } from '../lib/server/notifications-contract.mjs'

const require = createRequire(import.meta.url), ts = require('typescript'), module = { exports: {} }
const code = ts.transpileModule(readFileSync(new URL('../../../packages/ui/src/components/staff/staff-notifications-remote-model.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
vm.runInNewContext(code, { module, exports: module.exports, URLSearchParams }, { timeout: 2000 })

test('read-all preserves a genuine remaining unread count through both strict DTO boundaries', () => {
  for (const unreadCount of [0, 1, 5]) {
    const value = { data: { updated: 2, unreadCount, privateField: 'MUST_NOT_LEAK' } }
    const bff = parseReadAll(value), client = module.exports.parseStaffReadAll(bff)
    assert.equal(client.data.unreadCount, unreadCount)
    assert.doesNotMatch(JSON.stringify(client), /MUST_NOT_LEAK|privateField/)
  }
})
test('read-all never accepts negative, nonnumeric or unsafe unread counts', () => {
  for (const unreadCount of [-1, '0', null, Number.MAX_SAFE_INTEGER + 1]) {
    const value = { data: { updated: 0, unreadCount } }
    assert.throws(() => parseReadAll(value), { status: 502 }); assert.equal(module.exports.parseStaffReadAll(value), null)
  }
})
