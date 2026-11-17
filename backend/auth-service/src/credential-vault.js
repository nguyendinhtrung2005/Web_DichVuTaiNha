import { constants, createCipheriv, createDecipheriv, createPrivateKey, createPublicKey,
  privateDecrypt, publicEncrypt, randomBytes } from 'node:crypto'

const format = 'cleanhome.auth.credentials'
const aad = Buffer.from(`${format}:v1:RSA-OAEP-256:A256GCM`, 'utf8')
const maximumBytes = 16384
const fields = ['format', 'version', 'alg', 'enc', 'wrappedKey', 'iv', 'tag', 'ciphertext']

function failure() {
  const error = new Error('Không thể mã hóa hoặc đọc kho thông tin đăng nhập an toàn.')
  error.code = 'INVALID_CREDENTIAL_VAULT'
  return error
}

function key(pem, privatePart) {
  if (typeof pem !== 'string' || Buffer.byteLength(pem, 'utf8') > 32768) throw failure()
  const result = privatePart ? createPrivateKey(pem) : createPublicKey(pem)
  const bits = result.asymmetricKeyDetails?.modulusLength
  if (result.asymmetricKeyType !== 'rsa' || !Number.isInteger(bits) || bits < 2048 || bits > 8192) throw failure()
  return result
}

function bytes(text, minimum, maximum) {
  if (typeof text !== 'string' || !/^[A-Za-z0-9_-]+$/.test(text) || text.length > Math.ceil(maximum * 4 / 3)) throw failure()
  const value = Buffer.from(text, 'base64url')
  if (value.length < minimum || value.length > maximum || value.toString('base64url') !== text) throw failure()
  return value
}

export function encryptCredentials(value, publicKeyPem) {
  let secret, plaintext
  try {
    const publicKey = key(publicKeyPem, false)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw failure()
    plaintext = Buffer.from(JSON.stringify(value), 'utf8')
    if (!plaintext.length || plaintext.length > maximumBytes) throw failure()
    secret = randomBytes(32)
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', secret, iv)
    cipher.setAAD(aad)
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
    return {
      format, version: 1, alg: 'RSA-OAEP-256', enc: 'A256GCM',
      wrappedKey: publicEncrypt({ key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, secret).toString('base64url'),
      iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'),
      ciphertext: ciphertext.toString('base64url'),
    }
  } catch { throw failure() }
  finally { secret?.fill(0); plaintext?.fill(0) }
}

export function decryptCredentials(envelope, privateKeyPem) {
  let secret, plaintext
  try {
    const privateKey = key(privateKeyPem, true)
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope) ||
        Object.keys(envelope).length !== fields.length || !fields.every(name => Object.hasOwn(envelope, name)) ||
        envelope.format !== format || envelope.version !== 1 || envelope.alg !== 'RSA-OAEP-256' || envelope.enc !== 'A256GCM') throw failure()
    const wrappedKey = bytes(envelope.wrappedKey, 256, 1024)
    if (wrappedKey.length !== Math.ceil(privateKey.asymmetricKeyDetails.modulusLength / 8)) throw failure()
    const iv = bytes(envelope.iv, 12, 12), tag = bytes(envelope.tag, 16, 16)
    const ciphertext = bytes(envelope.ciphertext, 1, maximumBytes)
    secret = privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, wrappedKey)
    if (secret.length !== 32) throw failure()
    const decipher = createDecipheriv('aes-256-gcm', secret, iv)
    decipher.setAAD(aad)
    decipher.setAuthTag(tag)
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    const value = JSON.parse(plaintext.toString('utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw failure()
    return value
  } catch { throw failure() }
  finally { secret?.fill(0); plaintext?.fill(0) }
}
