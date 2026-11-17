import test from 'node:test'
import assert from 'node:assert/strict'
import { isStaffIncomeDemoEnabled } from '../lib/server/income-demo-config.mjs'

test('income demo server gate is explicit development-only and fails closed', () => {
  for (const NODE_ENV of [undefined, 'test', 'production', 'development']) {
    for (const flag of [undefined, '', 'false', 'TRUE', '1', 'true']) {
      const env = { NODE_ENV, STAFF_INCOME_DEMO_ENABLED: flag }
      const before = JSON.stringify(env)
      assert.equal(isStaffIncomeDemoEnabled(env), NODE_ENV === 'development' && flag === 'true')
      assert.equal(JSON.stringify(env), before)
    }
  }
})
test('public flags and URL-like inputs do not enable the income demo', () => {
  for (const env of [{ NODE_ENV: 'development', NEXT_PUBLIC_STAFF_INCOME_DEMO_ENABLED: 'true' }, { NODE_ENV: 'development', demo: 'true' }, { NODE_ENV: 'production', STAFF_INCOME_DEMO_ENABLED: 'true', NEXT_PUBLIC_STAFF_INCOME_DEMO_ENABLED: 'true' }]) assert.equal(isStaffIncomeDemoEnabled(env), false)
})
