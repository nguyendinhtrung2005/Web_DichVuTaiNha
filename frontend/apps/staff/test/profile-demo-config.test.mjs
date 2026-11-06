import test from 'node:test'
import assert from 'node:assert/strict'
import { isStaffProfileDemoEnabled } from '../lib/server/profile-demo-config.mjs'

test('profile demo is explicitly enabled only for a development server', () => {
  for (const NODE_ENV of [undefined, 'test', 'development', 'production']) {
    for (const flag of [undefined, '', 'false', '1', 'TRUE', 'true']) {
      const env = { NODE_ENV, STAFF_PROFILE_DEMO_ENABLED: flag }, before = JSON.stringify(env)
      assert.equal(isStaffProfileDemoEnabled(env), NODE_ENV === 'development' && flag === 'true')
      assert.equal(JSON.stringify(env), before)
    }
  }
})
test('profile demo cannot be enabled through Income/public/browser-style flags', () => {
  for (const env of [{ NODE_ENV: 'development', STAFF_INCOME_DEMO_ENABLED: 'true' }, { NODE_ENV: 'development', NEXT_PUBLIC_STAFF_PROFILE_DEMO_ENABLED: 'true' }, { NODE_ENV: 'development', demo: 'true', profile: 'true' }, { NODE_ENV: 'production', STAFF_PROFILE_DEMO_ENABLED: 'true' }]) assert.equal(isStaffProfileDemoEnabled(env), false)
})
