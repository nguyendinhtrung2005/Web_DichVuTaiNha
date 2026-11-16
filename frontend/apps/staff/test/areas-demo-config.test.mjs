import test from 'node:test'
import assert from 'node:assert/strict'
import { isStaffAreasDemoEnabled } from '../lib/server/areas-demo-config.mjs'

test('areas demo requires an explicit development server flag without mutating configuration', () => {
  for (const NODE_ENV of [undefined, '', 'test', 'development', 'production']) {
    for (const flag of [undefined, '', 'false', '1', 'TRUE', 'true', true]) {
      const env = { NODE_ENV, STAFF_AREAS_DEMO_ENABLED: flag }, before = JSON.stringify(env)
      assert.equal(isStaffAreasDemoEnabled(env), NODE_ENV === 'development' && flag === 'true')
      assert.equal(JSON.stringify(env), before)
    }
  }
})

test('areas demo cannot be enabled by unrelated demos public flags or browser input', () => {
  for (const env of [
    { NODE_ENV: 'development', STAFF_INCOME_DEMO_ENABLED: 'true', STAFF_PROFILE_DEMO_ENABLED: 'true', STAFF_NOTIFICATIONS_DEMO_ENABLED: 'true' },
    { NODE_ENV: 'development', NEXT_PUBLIC_STAFF_AREAS_DEMO_ENABLED: 'true' },
    { NODE_ENV: 'development', demo: 'true', areas: 'true', available: 'true' },
    { NODE_ENV: 'production', STAFF_AREAS_DEMO_ENABLED: 'true' },
  ]) assert.equal(isStaffAreasDemoEnabled(env), false)
})
