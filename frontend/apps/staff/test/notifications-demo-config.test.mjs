import test from 'node:test'
import assert from 'node:assert/strict'
import { isStaffNotificationsDemoEnabled } from '../lib/server/notifications-demo-config.mjs'

test('notifications demo requires an explicit development server flag', () => {
  for (const NODE_ENV of [undefined, '', 'test', 'development', 'production']) {
    for (const flag of [undefined, '', 'false', '1', 'TRUE', 'true']) {
      const env = { NODE_ENV, STAFF_NOTIFICATIONS_DEMO_ENABLED: flag }, before = JSON.stringify(env)
      assert.equal(isStaffNotificationsDemoEnabled(env), NODE_ENV === 'development' && flag === 'true')
      assert.equal(JSON.stringify(env), before)
    }
  }
})

test('notifications demo cannot be enabled by other demos or public/browser flags', () => {
  for (const env of [
    { NODE_ENV: 'development', STAFF_INCOME_DEMO_ENABLED: 'true', STAFF_PROFILE_DEMO_ENABLED: 'true' },
    { NODE_ENV: 'development', NEXT_PUBLIC_STAFF_NOTIFICATIONS_DEMO_ENABLED: 'true' },
    { NODE_ENV: 'development', demo: 'true', notifications: 'true' },
    { NODE_ENV: 'production', STAFF_NOTIFICATIONS_DEMO_ENABLED: 'true' },
  ]) assert.equal(isStaffNotificationsDemoEnabled(env), false)
})
