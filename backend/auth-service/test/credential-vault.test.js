import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, randomBytes } from 'node:crypto'
import { encryptCredentials, decryptCredentials } from '../src/credential-vault.js'

// Ephemeral process-only keys exercise the real cryptography, not Auth login.
const pair = () => generateKeyPairSync('rsa', { modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } })
const keys = pair(), otherKeys = pair()
const fixture = () => ({ version: 1, database: 'cleanhome_staff_test', accounts: [
  { label: 'A', userId: '9109002', phone: 'TEST-EMPLOYEE-UC9', password: randomBytes(24).toString('base64url') },
] })

test('credential vault round-trips with RSA-OAEP-SHA256 and authenticated AES-256-GCM', () => {
  const value = fixture()
  const envelope = encryptCredentials(value, keys.publicKey)
  const decrypted = decryptCredentials(envelope, keys.privateKey)
  // Compare booleans so an unexpected assertion never prints passwords.
  assert.equal(JSON.stringify(decrypted) === JSON.stringify(value), true)
  assert.equal(envelope.alg, 'RSA-OAEP-256')
  assert.equal(envelope.enc, 'A256GCM')
})

test('credential files contain neither passwords nor account JSON in plaintext and encryption is randomized', () => {
  const value = fixture()
  const first = encryptCredentials(value, keys.publicKey), second = encryptCredentials(value, keys.publicKey)
  const serialized = JSON.stringify(first)
  assert.equal(serialized.includes(value.accounts[0].password), false)
  assert.equal(serialized.includes(value.accounts[0].phone), false)
  assert.equal(serialized.includes('accounts'), false)
  assert.equal(first.ciphertext === second.ciphertext, false)
  assert.equal(first.wrappedKey === second.wrappedKey, false)
})

test('credential vault rejects all tampered authenticated fields and mismatching private keys', () => {
  const envelope = encryptCredentials(fixture(), keys.publicKey)
  for (const field of ['wrappedKey', 'iv', 'tag', 'ciphertext']) {
    const bytes = Buffer.from(envelope[field], 'base64url')
    bytes[0] ^= 1
    assert.throws(() => decryptCredentials({ ...envelope, [field]: bytes.toString('base64url') }, keys.privateKey), { code: 'INVALID_CREDENTIAL_VAULT' })
  }
  assert.throws(() => decryptCredentials(envelope, otherKeys.privateKey), { code: 'INVALID_CREDENTIAL_VAULT' })
})

test('credential vault refuses plaintext, algorithm changes, extra fields and oversized inputs', () => {
  const envelope = encryptCredentials(fixture(), keys.publicKey)
  for (const invalid of [fixture(), null, [], {}, { ...envelope, version: 2 }, { ...envelope, alg: 'RSA1_5' },
    { ...envelope, enc: 'A128GCM' }, { ...envelope, extra: true }, { ...envelope, ciphertext: 'A'.repeat(23000) },
    { ...envelope, iv: envelope.iv + '=' }, { ...envelope, tag: '' }]) {
    assert.throws(() => decryptCredentials(invalid, keys.privateKey), { code: 'INVALID_CREDENTIAL_VAULT' })
  }
  for (const invalid of [null, [], 'plaintext', { oversized: 'A'.repeat(16385) }]) {
    assert.throws(() => encryptCredentials(invalid, keys.publicKey), { code: 'INVALID_CREDENTIAL_VAULT' })
  }
})

test('credential vault rejects weak or non-RSA keys and never leaks input or key details in errors', () => {
  const weak = generateKeyPairSync('rsa', { modulusLength: 1024,
    publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } })
  const ec = generateKeyPairSync('ec', { namedCurve: 'prime256v1',
    publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } })
  const value = fixture()
  for (const invalid of [weak.publicKey, ec.publicKey, 'sensitive-invalid-key', 'A'.repeat(32769)]) {
    assert.throws(() => encryptCredentials(value, invalid), error => {
      assert.equal(error.code, 'INVALID_CREDENTIAL_VAULT')
      assert.equal(error.message.includes(value.accounts[0].password), false)
      assert.equal(error.message.includes('sensitive-invalid-key'), false)
      assert.equal(error.cause, undefined)
      return true
    })
  }
})
