import { HttpError } from './errors.js'
import { notificationDto } from './mapping.js'

const notFound = () => new HttpError(404, 'NOTIFICATION_NOT_FOUND', 'Không tìm thấy thông báo thuộc tài khoản của bạn.')

export class StaffNotificationService {
  constructor({ repository, notifications }) {
    this.repository = repository
    this.notifications = notifications
  }

  /** Same active-employee gate as jobs: suspended or unknown staff get no inbox. */
  async employee(actor) {
    const employee = await this.repository.findEmployeeByUserId(actor.userId)
    if (!employee || employee.status !== 'ACTIVE' || employee.userStatus !== 'ACTIVE' || !['EMPLOYEE', 'STAFF'].includes(employee.userRole)) {
      throw new HttpError(403, 'STAFF_INACTIVE', 'Tài khoản hoặc hồ sơ nhân viên không còn hoạt động.')
    }
    return employee
  }

  async list(actor, query) {
    await this.employee(actor)
    const result = await this.notifications.listForUser(actor.userId, query)
    return {
      data: result.items.map(notificationDto),
      pagination: { page: query.page, pageSize: query.pageSize, total: result.total, totalPages: Math.ceil(result.total / query.pageSize) },
      unreadCount: result.unreadCount,
      timezone: 'Asia/Ho_Chi_Minh',
    }
  }

  async unreadCount(actor) {
    await this.employee(actor)
    return { data: { unreadCount: await this.notifications.countUnread(actor.userId) } }
  }

  async markRead(actor, notificationId) {
    await this.employee(actor)
    const result = await this.notifications.markRead(actor.userId, notificationId)
    if (!result || !result.item) throw notFound()
    return { data: notificationDto(result.item), unreadCount: result.unreadCount }
  }

  async markAllRead(actor) {
    await this.employee(actor)
    return { data: await this.notifications.markAllRead(actor.userId) }
  }
}
