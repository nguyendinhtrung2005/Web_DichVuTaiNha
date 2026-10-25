import { loadConfig } from './config.js'
import { createPool } from './db.js'
import { createAuthenticate } from './auth.js'
import { MysqlStaffRepository } from './repository.js'
import { OrderClient } from './order-client.js'
import { StaffJobService } from './job-service.js'

export function runtime(env = process.env) {
  const config = loadConfig(env)
  const pool = createPool(config.db)
  const repository = new MysqlStaffRepository(pool)
  const orderClient = new OrderClient(config.order)
  const service = new StaffJobService({ repository, orderClient, orderReadEnabled: Boolean(config.order.baseUrl && config.order.token) })
  return { config, pool, repository, service, authenticate: createAuthenticate(config) }
}
