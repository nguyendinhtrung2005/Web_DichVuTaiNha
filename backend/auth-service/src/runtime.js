import { readFile } from 'node:fs/promises'
import { loadConfig } from './config.js'
import { createPool } from './db.js'
import { MysqlAuthRepository } from './repository.js'
import { createTokenIssuer } from './tokens.js'
import { getDummyHash } from './password.js'
import { AuthService } from './service.js'

export async function runtime(env = process.env) {
  const config = loadConfig(env)
  const privateKeyPem = await readFile(config.jwt.privateKeyFile, 'utf8')
  const issuer = await createTokenIssuer({ ...config.jwt, privateKeyPem })
  await getDummyHash()
  const pool = createPool(config.db)
  const repository = new MysqlAuthRepository(pool)
  try { await repository.assertSchema() } catch (error) { await pool.end(); throw error }
  return { config, pool, repository, issuer, service: new AuthService({ repository, issuer }) }
}
