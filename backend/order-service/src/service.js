import { OrderError, decodeJournal, transitionDecision } from './domain.js'
const fields = ['id', 'bookingId', 'assignmentId', 'employeeId', 'actorUserId', 'fromStatus', 'toStatus']
const steps = ['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'DONE']
const conflict = () => { throw new OrderError(409, 'IDEMPOTENCY_CONFLICT', 'Mã thao tác đã được dùng với nội dung khác.') }
function existing(tx, operation) {
  const matches = tx.matchingHistoryRows.map(decodeJournal).filter(Boolean)
  if (matches.length > 1) throw new OrderError(503, 'JOURNAL_CORRUPT', 'Có nhiều bản ghi cho cùng mã thao tác.')
  const result = matches[0]
  if (result && fields.some(field => result.operation[field] !== operation[field])) conflict()
  return result
}
function target(tx, operation, active = true) {
  if (!tx.booking) throw new OrderError(404, 'BOOKING_NOT_FOUND', 'Không tìm thấy đơn dịch vụ.')
  const row = tx.assignments.find(row => row.id === operation.assignmentId)
  if (!row || row.bookingId !== operation.bookingId || row.employeeId !== operation.employeeId || row.actorUserId !== operation.actorUserId) throw new OrderError(409, 'STALE_ASSIGNMENT', 'Phân công không còn khớp với đơn và nhân viên.')
  if (active && (row.status === 'CANCELLED' || row.userStatus !== 'ACTIVE' || row.employeeStatus !== 'ACTIVE' || !['EMPLOYEE', 'STAFF'].includes(row.userRole))) throw new OrderError(409, 'ASSIGNMENT_NOT_ACTIVE', 'Phân công hoặc nhân viên không còn hoạt động.')
  return row
}
function iso(value) {
  if (value == null) return null
  const time = value instanceof Date ? value : new Date(String(value).replace(' ', 'T') + (/Z$|[+-]\d\d:\d\d$/.test(String(value)) ? '' : 'Z'))
  if (!Number.isFinite(time.getTime())) throw new OrderError(503, 'DATA_INTEGRITY_ERROR', 'Thời điểm công việc chưa đọc được.')
  return time.toISOString()
}
export class OrderTransitionService {
  constructor(repository) { this.repository = repository }
  async lookup(operation) {
    return this.repository.transactOperation(operation, async tx => {
      const recorded = existing(tx, operation)
      if (recorded) return recorded.ack
      target(tx, operation)
      throw new OrderError(404, 'TRANSITION_NOT_FOUND', 'Chưa ghi nhận thao tác này.')
    })
  }
  async apply(operation) {
    return this.repository.transactOperation(operation, async tx => {
      const recorded = existing(tx, operation)
      if (recorded) return recorded.ack
      const decision = transitionDecision({ booking: tx.booking, assignments: tx.assignments, records: tx.historyRows.map(decodeJournal).filter(Boolean) }, operation)
      await tx.setBookingStatus(decision.bookingStatus)
      await tx.insertHistory(decision.metadata)
      return decision.ack
    })
  }
  async acknowledge(operation) {
    return this.repository.transactOperation(operation, async tx => {
      const recorded = existing(tx, operation)
      if (!recorded) { target(tx, operation); throw new OrderError(404, 'TRANSITION_NOT_FOUND', 'Chưa ghi nhận thao tác này.') }
      if (!recorded.staffAcknowledged) {
        const row = target(tx, operation, false)
        if (steps.indexOf(row.status) < steps.indexOf(operation.toStatus) || !steps.includes(row.status)) throw new OrderError(409, 'STALE_ASSIGNMENT', 'Staff chưa commit bước công việc cần xác nhận.')
        const occurredAt = iso(recorded.ack.occurredAt)
        if ((operation.toStatus === 'IN_PROGRESS' && iso(row.checkInAt) !== occurredAt)
          || (operation.toStatus === 'DONE' && (iso(row.checkOutAt) !== occurredAt || !iso(row.checkInAt) || iso(row.checkInAt) > occurredAt))) throw new OrderError(409, 'STALE_ASSIGNMENT', 'Thời điểm Staff lưu chưa khớp với thao tác đã ghi nhận.')
        const originalRow = tx.matchingHistoryRows.find(row => row.id === recorded.historyId)
        const metadata = JSON.parse(originalRow.note)
        metadata.staffAcknowledged = true
        await tx.acknowledgeHistory(recorded.historyId, metadata)
      }
      return { operationId: operation.id, bookingId: operation.bookingId, assignmentId: operation.assignmentId, acknowledged: true }
    })
  }
  async pending(limit) {
    const rows = await this.repository.listPendingRows(limit), seen = new Set(), operations = []
    for (const row of rows) {
      const record = decodeJournal(row)
      if (!record || record.staffAcknowledged || seen.has(record.operation.id)) throw new OrderError(503, 'JOURNAL_CORRUPT', 'Danh sách đối chiếu chưa đọc được an toàn.')
      seen.add(record.operation.id); operations.push(record.operation)
    }
    return { operations }
  }
}
