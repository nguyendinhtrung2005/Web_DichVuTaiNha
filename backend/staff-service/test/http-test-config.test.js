import test from 'node:test'
import assert from 'node:assert/strict'
import { httpTestPlan, readHttpTokens } from '../scripts/http-test-config.js'

test('real HTTP tests are opt-in, even if a database or remote URL is present', () => {
  assert.deepEqual(httpTestPlan({}), { enabled: false, writeEnabled: false })
  assert.deepEqual(httpTestPlan({ MYSQL_DATABASE: 'production', STAFF_HTTP_BASE_URL: 'https://example.invalid' }), { enabled: false, writeEnabled: false })
  assert.throws(() => httpTestPlan({ RUN_STAFF_HTTP_TESTS: 'yes' }))
  assert.throws(() => httpTestPlan({ RUN_STAFF_HTTP_WRITE_TESTS: 'true' }))
})

test('real HTTP tests require the named test database and a local URL', () => {
  const env = { RUN_STAFF_HTTP_TESTS: 'true', MYSQL_DATABASE: 'cleanhome_staff_test' }
  assert.equal(httpTestPlan(env).baseUrl, 'http://127.0.0.1:4005')
  assert.throws(() => httpTestPlan({ ...env, MYSQL_DATABASE: 'other' }))
  for (const value of ['https://example.invalid', 'http://user:password@localhost:4005', 'file:///test', 'http://localhost:4005/path', 'http://localhost:4005/?x=1']) {
    assert.throws(() => httpTestPlan({ ...env, STAFF_HTTP_BASE_URL: value }))
  }
  for (const timeout of ['0', '499', '15001', 'abc']) assert.throws(() => httpTestPlan({ ...env, STAFF_HTTP_TIMEOUT_MS: timeout }))
})

test('HTTP write tests need an additional explicit flag and the exact dedicated booking ID', () => {
  const env = { RUN_STAFF_HTTP_TESTS: 'true', MYSQL_DATABASE: 'cleanhome_staff_test' }
  assert.equal(httpTestPlan(env).writeEnabled, false)
  assert.throws(() => httpTestPlan({ ...env, RUN_STAFF_HTTP_WRITE_TESTS: 'true' }))
  assert.throws(() => httpTestPlan({ ...env, RUN_STAFF_HTTP_WRITE_TESTS: 'true', STAFF_HTTP_WRITE_BOOKING_ID: '9109007' }))
  assert.equal(httpTestPlan({ ...env, RUN_STAFF_HTTP_WRITE_TESTS: 'true', STAFF_HTTP_WRITE_BOOKING_ID: '9109131' }).writeEnabled, true)
})

test('token inputs never invent credentials, accept two sources or disclose invalid token contents', async () => {
  await assert.rejects(readHttpTokens({}), /STAFF_HTTP_TOKEN_A/)
  await assert.rejects(readHttpTokens({ STAFF_HTTP_TOKEN_A: 'private-invalid-input', STAFF_HTTP_TOKEN_A_FILE: 'unused' }), /exactly one/)
  await assert.rejects(readHttpTokens({ STAFF_HTTP_TOKEN_A: 'private-invalid-input' }), error => !error.message.includes('private-invalid-input'))
})
