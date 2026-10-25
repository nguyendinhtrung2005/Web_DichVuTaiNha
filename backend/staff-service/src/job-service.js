import { createHash } from 'node:crypto'
import { HttpError } from './errors.js'
import { jobDto, jobStatus, iso, previousStatus, steps } from './mapping.js'

export class StaffJobService {
  constructor({ repository, orderClient, orderReadEnabled = false }) {
    this.repository = repository
    this.orderClient = orderClient
    this.orderReadEnabled = orderReadEnabled
  }
  async employee(actor) {
    const employee = await this.repository.findEmployeeByUserId(actor.userId)
    if (!employee || employee.status !== 'ACTIVE' || employee.userStatus !== 'ACTIVE' || !['EMPLOYEE', 'STAFF'].includes(employee.userRole)) {
      throw new HttpError(403, 'STAFF_INACTIVE', 'Tài khoản hoặc hồ sơ nhân viên không còn hoạt động.')
    }
    return employee
  }
  async list(actor, query) {
    const employee = await this.employee(actor)
    const result = await this.repository.findJobs(employee.id, query)
    const items = await this.repository.getBookingItems([...new Set(result.items.map(row => String(row.bookingId)))])
    return {
      data: result.items.map(row => jobDto(row, items.get(String(row.bookingId)) || [])),
      pagination: { page: query.page, pageSize: query.pageSize, total: result.total, totalPages: Math.ceil(result.total / query.pageSize) },
      timezone: 'Asia/Ho_Chi_Minh',
    }
  }
  async detail(actor, assignmentId) {
    const employee = await this.employee(actor)
    const row = await this.repository.findJob(employee.id, assignmentId)
    if (!row) throw new HttpError(404, 'JOB_NOT_FOUND', 'Không tìm thấy công việc được phân công cho bạn.')
    const items = await this.repository.getBookingItems([String(row.bookingId)])
    const data = jobDto(row, items.get(String(row.bookingId)) || [], true)
    if (this.orderReadEnabled) {
      try {
        const context = await this.orderClient.getBookingDetail({ bookingId: String(row.bookingId), actorUserId: actor.userId })
        data.orderHistory = context.history
        data.historySource = 'order-service'
        data.cancellationPending = context.cancellationPending
        if (typeof context.cancellationPending === 'boolean') data.unsupportedFields = data.unsupportedFields.filter(field => field !== 'cancellationPending')
      } catch {
        data.historySource = 'order-service-unavailable'
        data.warnings = [{ code: 'ORDER_HISTORY_UNAVAILABLE', message: 'Chưa lấy được lịch sử từ Order Service.' }]
      }
    }
    return { data }
  }
  async advance(actor, assignmentId, { status, idempotencyKey }) {
    const id = createHash('sha256').update(JSON.stringify([actor.userId, assignmentId, idempotencyKey])).digest('hex')
    return this.performTransition(actor, assignmentId, status, id)
  }
  async performTransition(actor, assignmentId, targetStatus, operationId) {
    const employee = await this.employee(actor)
    if (!previousStatus[targetStatus]) throw new HttpError(400, 'INVALID_TRANSITION', 'Trạng thái cập nhật không hợp lệ.')
    let remoteApplied = false
    let outcome
    try {
      outcome = await this.repository.withLockedAssignment(employee.id, assignmentId, async tx => {
        const current = tx.assignment
        if (current.status === 'CANCELLED' || current.bookingStatus === 'CANCELLED' || !steps.includes(current.status)
          || steps.indexOf(current.status) < steps.indexOf(previousStatus[targetStatus])) {
          throw new HttpError(409, 'INVALID_TRANSITION', 'Không được bỏ bước hoặc cập nhật công việc đã hủy.')
        }
        const operation = {
          id: operationId, bookingId: String(current.bookingId), assignmentId: String(current.id),
          employeeId: String(employee.id), actorUserId: actor.userId,
          fromStatus: previousStatus[targetStatus], toStatus: targetStatus,
        }
        const existing = await this.orderClient.getAssignmentTransition(operation)
        let ack = existing
        if (!existing) {
          if (current.status !== operation.fromStatus || current.bookingStatus === 'COMPLETED') throw new HttpError(409, 'INVALID_TRANSITION', 'Không được bỏ bước hoặc cập nhật công việc đã hoàn thành/hủy.')
          ack = await this.orderClient.applyAssignmentTransition(operation)
        }
        remoteApplied = true
        let assignment = current
        if (current.status === operation.fromStatus) {
          assignment = await tx.updateStatus(targetStatus, ack.occurredAt)
        } else if (steps.indexOf(current.status) < steps.indexOf(targetStatus) || !steps.includes(current.status)) {
          throw new HttpError(409, 'RECONCILIATION_CONFLICT', 'Trạng thái hiện tại khác với thao tác đã được ghi nhận; cần đối chiếu.')
        }
        return { operation, ack, assignment, replayed: Boolean(existing) }
      })
    } catch (error) {
      // The Order journal is durable. A DB commit failure is recoverable by the
      // same key or the reconciliation worker; never claim the local write succeeded.
      if (remoteApplied && (!(error instanceof HttpError) || error.status >= 500)) throw new HttpError(503, 'RECONCILIATION_REQUIRED', 'Chưa xác nhận được cập nhật nhân viên; hãy thử lại cùng Idempotency-Key.', { operationId })
      throw error
    }
    let synchronization = 'SYNCHRONIZED'
    try { await this.orderClient.ackAssignmentTransition(outcome.operation) }
    catch { synchronization = 'PENDING_ACKNOWLEDGEMENT' }
    return {
      httpStatus: synchronization === 'SYNCHRONIZED' ? 200 : 202,
      body: { data: {
        assignmentId: String(outcome.assignment.id), status: outcome.assignment.status,
        jobStatus: jobStatus(outcome.assignment.status),
        checkInAt: iso(outcome.assignment.checkInAt), checkOutAt: iso(outcome.assignment.checkOutAt),
        transition: { operationId, requestedStatus: targetStatus, synchronization, replayed: outcome.replayed },
        orderAtTransition: { id: String(outcome.ack.bookingId), status: outcome.ack.booking.status, asOf: outcome.ack.occurredAt },
      } },
    }
  }
  async reconcile(limit) {
    const operations = await this.orderClient.listPendingTransitions({ limit })
    const results = []
    for (const operation of operations) {
      try {
        const result = await this.performTransition({ userId: operation.actorUserId, role: 'staff' }, operation.assignmentId, operation.toStatus, operation.id)
        results.push({ operationId: operation.id, synchronized: result.httpStatus === 200 })
      } catch (error) { results.push({ operationId: operation.id, synchronized: false, code: error instanceof HttpError ? error.code : 'RECONCILIATION_FAILED' }) }
    }
    return results
  }
}
