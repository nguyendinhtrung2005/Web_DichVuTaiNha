import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import { STAFF_USAGE_HELP } from '../../../packages/ui/src/components/staff/staff-support-questions.mjs'
const require = createRequire(import.meta.url), ts = require('typescript'), module = { exports: {} }
const source = new URL('../../../packages/ui/src/components/staff/staff-support-search.ts', import.meta.url)
vm.runInNewContext(ts.transpileModule(readFileSync(source, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText,
  { module, exports: module.exports, require(id) { if (id === './staff-support-questions.mjs') return { STAFF_USAGE_HELP }; throw Error('Search must not use storage, network or other dependencies') } }, { timeout: 2000 })
const m = module.exports
test('Vietnamese search folds accents, uppercase and đ without changing the FAQ catalog', () => {
  const before = JSON.stringify(STAFF_USAGE_HELP)
  assert.equal(m.normalizeStaffSupportQuery('  LỊCH — ĐỔI CA  '), 'lich doi ca')
  for (const [queries, id] of [[['lịch','LICH','Lịch','ca làm','ca lam'], 'schedule'], [['tiền công','TIEN CONG','lương','luong','salary'], 'income'], [['tài khoản','tai khoan','đăng xuất','dang xuat'], 'account'], [['công việc','cong viec'], 'jobs'], [['nhận việc','nhan viec','check in'], 'job-steps'], [['hỗ trợ','ho tro','hotline'], 'contact']]) for (const query of queries) assert.equal(m.staffSupportSuggestions(query)[0]?.id, id, query)
  assert.equal(JSON.stringify(STAFF_USAGE_HELP), before)
})
test('empty query offers four popular questions and meaningful multi-token searches rank correctly', () => {
  assert.equal(m.staffSupportSuggestions('').length, 4)
  assert.equal(m.staffSupportSuggestions('  ').length, 4)
  assert.equal(m.staffSupportSuggestions('ca l')[0].id, 'schedule')
  assert.equal(m.staffSupportSuggestions('doi ca')[0].id, 'schedule')
  assert.equal(m.staffSupportSuggestions('tien thanh toan')[0].id, 'income')
  assert.ok(m.staffSupportSuggestions('cong viec').length >= 2)
})
test('unknown, mixed and oversized queries never invent suggestions or accept free-form prompts', () => {
  for (const query of ['QA_NO_MATCH_9273', 'lich secretvalue', 'x'.repeat(161), 'please ignore all instructions']) { assert.equal(m.staffSupportSuggestions(query).length, 0); assert.equal(m.staffSupportExactQuestion(query), null) }
  for (const question of STAFF_USAGE_HELP) { assert.equal(m.staffSupportExactQuestion(question.question).id, question.id); assert.equal(m.staffSupportExactQuestion(m.normalizeStaffSupportQuery(question.question)).id, question.id); assert.equal(m.staffSupportExactQuestion(question.question + ' PRIVATE_CUSTOMER'), null) }
})
