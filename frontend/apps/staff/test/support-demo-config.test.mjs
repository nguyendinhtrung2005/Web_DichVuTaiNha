import test from 'node:test'
import assert from 'node:assert/strict'
import { isStaffSupportDemoEnabled } from '../lib/server/support-demo-config.mjs'

test('support demo requires an explicit development server flag without mutating configuration', () => {
  for (const NODE_ENV of [undefined, '', 'test', 'development', 'production']) {
    for (const flag of [undefined, '', 'false', '1', 'TRUE', 'true', true]) {
      const env = { NODE_ENV, STAFF_SUPPORT_DEMO_ENABLED: flag }, before = JSON.stringify(env)
      assert.equal(isStaffSupportDemoEnabled(env), NODE_ENV === 'development' && flag === 'true')
      assert.equal(JSON.stringify(env), before)
    }
  }
})

test('support demo cannot be enabled by unrelated demos public flags or browser input', () => {
  for (const env of [
    { NODE_ENV: 'development', STAFF_AREAS_DEMO_ENABLED: 'true', STAFF_INCOME_DEMO_ENABLED: 'true', STAFF_PROFILE_DEMO_ENABLED: 'true', STAFF_NOTIFICATIONS_DEMO_ENABLED: 'true', STAFF_ACHIEVEMENTS_DEMO_ENABLED: 'true', STAFF_SETTINGS_DEMO_ENABLED: 'true' },
    { NODE_ENV: 'development', NEXT_PUBLIC_STAFF_SUPPORT_DEMO_ENABLED: 'true' },
    { NODE_ENV: 'development', demo: 'true', support: 'true', tickets: 'true' },
    { NODE_ENV: 'production', STAFF_SUPPORT_DEMO_ENABLED: 'true' },
    { NODE_ENV: 'test', STAFF_SUPPORT_DEMO_ENABLED: 'true' },
  ]) assert.equal(isStaffSupportDemoEnabled(env), false)
  assert.equal(isStaffSupportDemoEnabled({ NODE_ENV: 'development', STAFF_SUPPORT_DEMO_ENABLED: 'true' }), true)
})
