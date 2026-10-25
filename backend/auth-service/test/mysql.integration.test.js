import test from 'node:test'
import assert from 'node:assert/strict'
import { createPool } from '../src/db.js'
import { loadDbConfig } from '../src/config.js'
import { MysqlAuthRepository } from '../src/repository.js'
import { verifyPassword, isSupportedPasswordHash } from '../src/password.js'
import { testAccounts } from '../scripts/http-tools.js'

test('real Auth MySQL repository and provisioned credentials; read-only, not HTTP integration', { skip: process.env.RUN_AUTH_MYSQL_TESTS === 'true' ? false : 'Set RUN_AUTH_MYSQL_TESTS=true for the dedicated database', timeout: 30000 }, async t => {
  assert.equal(process.env.MYSQL_DATABASE, 'cleanhome_staff_test')
  const accounts = await testAccounts(), pool = createPool(loadDbConfig()), repository = new MysqlAuthRepository(pool)
  t.after(() => pool.end())
  await t.test('existing users/employees schema is compatible without DDL', async () => { assert.equal(await repository.assertSchema(), true) })
  await t.test('A/B/Customer login identifiers resolve the exact pre-existing users', async () => {
    for (const account of accounts) {
      const user = await repository.findByPhone(account.phone)
      assert.equal(user.id, account.userId); assert.equal(user.status, 'ACTIVE'); assert.equal(user.employeeId, account.employeeId)
      assert.equal(user.role, account.label === 'CUSTOMER' ? 'CUSTOMER' : 'EMPLOYEE')
      if (account.employeeId) assert.equal(user.employeeStatus, 'ACTIVE')
    }
  })
  await t.test('all three stored hashes are scrypt and match the locally provisioned credentials', async () => {
    for (const account of accounts) {
      const user = await repository.findByPhone(account.phone)
      assert.equal(isSupportedPasswordHash(user.passwordHash), true)
      assert.equal(await verifyPassword(account.password, user.passwordHash), true)
    }
  })
  await t.test('identity refresh does not return password hashes', async () => {
    for (const account of accounts) assert.equal(Object.hasOwn(await repository.findById(account.userId), 'passwordHash'), false)
  })
  await t.test('unknown phone and ID return no account', async () => {
    assert.equal(await repository.findByPhone('UNKNOWN-AUTH-TEST'), null)
    assert.equal(await repository.findById('9223372036854775807'), null)
  })
})
