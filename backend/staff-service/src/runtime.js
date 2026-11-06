import { loadConfig } from './config.js'
import { createPool } from './db.js'
import { createAuthenticate } from './auth.js'
import { MysqlStaffRepository } from './repository.js'
import { MysqlNotificationRepository } from './notification-repository.js'
import { StaffNotificationService } from './notification-service.js'
import { StaffAreaService } from './area-service.js'
import { StaffIncomeService } from './income-service.js'
import { OrderClient } from './order-client.js'
import { StaffJobService } from './job-service.js'

export function runtime(env = process.env) {
  const config = loadConfig(env)
  const pool = createPool(config.db)
  const repository = new MysqlStaffRepository(pool)
  const notifications = new MysqlNotificationRepository(pool)
  const orderClient = new OrderClient(config.order)
  const service = new StaffJobService({ repository, orderClient, orderReadEnabled: Boolean(config.order.baseUrl && config.order.token) })
  const notificationService = new StaffNotificationService({ repository, notifications })
  const areaService = new StaffAreaService({ repository })
  const incomeService = new StaffIncomeService({ repository, env })
  return { config, pool, repository, notifications, service, notificationService, areaService, incomeService, authenticate: createAuthenticate(config) }
}
