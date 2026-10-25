import { loadConfig, readServiceToken } from './config.js'
import { createPool } from './db.js'
import { MysqlOrderRepository } from './repository.js'
import { OrderTransitionService } from './service.js'
import { createInternalAuth } from './internal-auth.js'
export async function runtime(env = process.env) {
  const config = loadConfig(env), token = await readServiceToken(config.credential), pool = createPool(config.db)
  const repository = new MysqlOrderRepository(pool)
  try { await repository.assertSchema() } catch (error) { try { await pool.end() } catch {}; throw error }
  return { config, pool, repository, service: new OrderTransitionService(repository), authenticate: createInternalAuth(token) }
}
