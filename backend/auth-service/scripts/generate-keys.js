import { generateKeyPair } from 'node:crypto'
import { promisify } from 'node:util'
import { mkdir, writeFile, access } from 'node:fs/promises'
import { exportJWK, importSPKI } from 'jose'
const files = ['secrets/auth-private.pem', 'secrets/auth-public.pem', 'secrets/jwks.json']
try {
  const kid = process.env.JWT_KEY_ID || 'cleanhome-local-1'
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(kid)) throw new Error('Invalid key identifier')
  for (const file of files) { let exists = false; try { await access(file); exists = true } catch (error) { if (error.code !== 'ENOENT') throw error }; if (exists) throw new Error('Existing key file must not be overwritten') }
  await mkdir('secrets', { recursive: true, mode: 0o700 })
  const { privateKey, publicKey } = await promisify(generateKeyPair)('rsa', { modulusLength: 3072, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } })
  const jwk = await exportJWK(await importSPKI(publicKey, 'RS256'))
  await writeFile(files[0], privateKey, { flag: 'wx', mode: 0o600 })
  await writeFile(files[1], publicKey, { flag: 'wx', mode: 0o644 })
  await writeFile(files[2], JSON.stringify({ keys: [{ ...jwk, kid, alg: 'RS256', use: 'sig' }] }, null, 2) + '\n', { flag: 'wx', mode: 0o644 })
  console.log(JSON.stringify({ event: 'auth_key_generated', algorithm: 'RS256', bits: 3072, kid, publicKeyFile: files[1], jwksFile: files[2], privateKeyPrinted: false }))
} catch { console.error('Key generation refused or failed; existing files preserved and key material withheld.'); process.exitCode = 1 }
