import test from 'node:test'
import assert from 'node:assert/strict'
import { isStaffSettingsDemoEnabled } from '../lib/server/settings-demo-config.mjs'

test('settings demo requires an explicit development server flag without mutating configuration', () => {
  for (const NODE_ENV of [undefined, '', 'test', 'development', 'production']) {
    for (const flag of [undefined, '', 'false', '1', 'TRUE', 'true', true]) {
      const env = { NODE_ENV, STAFF_SETTINGS_DEMO_ENABLED: flag }, before = JSON.stringify(env)
      assert.equal(isStaffSettingsDemoEnabled(env), NODE_ENV === 'development' && flag === 'true')
      assert.equal(JSON.stringify(env), before)
    }
  }
})

test('settings demo cannot be enabled by unrelated demos public flags or browser input', () => {
  for (const env of [
    { NODE_ENV: 'development', STAFF_AREAS_DEMO_ENABLED: 'true', STAFF_INCOME_DEMO_ENABLED: 'true', STAFF_PROFILE_DEMO_ENABLED: 'true', STAFF_NOTIFICATIONS_DEMO_ENABLED: 'true', STAFF_ACHIEVEMENTS_DEMO_ENABLED: 'true', STAFF_SUPPORT_DEMO_ENABLED: 'true' },
    { NODE_ENV: 'development', NEXT_PUBLIC_STAFF_SETTINGS_DEMO_ENABLED: 'true' },
    { NODE_ENV: 'development', demo: 'true', settings: 'true', notifications: 'true' },
    { NODE_ENV: 'production', STAFF_SETTINGS_DEMO_ENABLED: 'true' },
    { NODE_ENV: 'test', STAFF_SETTINGS_DEMO_ENABLED: 'true' },
  ]) assert.equal(isStaffSettingsDemoEnabled(env), false)
  assert.equal(isStaffSettingsDemoEnabled({ NODE_ENV: 'development', STAFF_SETTINGS_DEMO_ENABLED: 'true' }), true)
})
