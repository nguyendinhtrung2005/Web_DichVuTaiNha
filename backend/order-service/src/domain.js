const JOURNAL_KIND = 'cleanhome.staff-transition'
const operationKeys = ['id', 'bookingId', 'assignmentId', 'employeeId', 'actorUserId', 'fromStatus', 'toStatus']
const steps = ['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'DONE']
const nextStep = new Map([['ASSIGNED', 'ACCEPTED'], ['ACCEPTED', 'IN_PROGRESS'], ['IN_PROGRESS', 'DONE']])
const bookingStatuses = new Set(['PENDING', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'])
const assignmentStatuses = new Set([...steps, 'CANCELLED'])
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const entityId = value => typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n
const operationId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value)
const equalOperation = (left, right) => operationKeys.every(key => left[key] === right[key])
const validOperation = value => object(value) && Object.keys(value).length === operationKeys.length
  && operationKeys.every(key => Object.hasOwn(value, key)) && operationId(value.id)
  && ['bookingId', 'assignmentId', 'employeeId', 'actorUserId'].every(key => entityId(value[key]))
  && nextStep.get(value.fromStatus) === value.toStatus && nextStep.has(value.fromStatus)
const clone = value => structuredClone(value)

export class OrderError extends Error {
  constructor(status, code, message) {
    super(message)
    this.name = 'OrderError'
    this.status = status
    this.code = code
  }
}

function fail(status, code, message) { throw new OrderError(status, code, message) }
const corrupt = () => fail(503, 'JOURNAL_CORRUPT', 'Không đọc được bản ghi đối chiếu công việc.')
const invalidData = () => fail(503, 'DATA_INTEGRITY_ERROR', 'Dữ liệu công việc chưa đủ điều kiện xử lý.')

function validTime(value) {
  if (typeof value !== 'string') return false
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(value)
  if (!match) return false
  const [, year, month, day, hour, minute, second, , offset] = match
  const end = new Date(0)
  end.setUTCFullYear(Number(year), Number(month), 0)
  if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > end.getUTCDate()
    || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return false
  if (offset !== 'Z' && (Number(offset.slice(1, 3)) > 23 || Number(offset.slice(4, 6)) > 59)) return false
  return Number.isFinite(Date.parse(value))
}

function validAck(ack, operation) {
  const allowed = new Map([['ACCEPTED', ['CONFIRMED', 'IN_PROGRESS']], ['IN_PROGRESS', ['IN_PROGRESS']], ['DONE', ['IN_PROGRESS', 'COMPLETED']]])
  return object(ack) && ack.operationId === operation.id && ack.bookingId === operation.bookingId
    && ack.assignmentId === operation.assignmentId && ack.assignmentStatus === operation.toStatus && validTime(ack.occurredAt)
    && object(ack.booking) && ack.booking.id === operation.bookingId
    && allowed.get(operation.toStatus)?.includes(ack.booking.status) && ack.booking.cancellationPending === null
}

function storedInstant(value) {
  if (value == null) return null
  const text = value instanceof Date ? (Number.isFinite(value.getTime()) ? value.toISOString() : '')
    : typeof value === 'string' ? value.replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/, '$1T$2Z') : ''
  if (!validTime(text)) invalidData()
  return Date.parse(text)
}

/** Legacy free-text notes are deliberately not changed or interpreted as journals. */
export function decodeJournal(row) {
  if (!object(row) || typeof row.note !== 'string') return null
  let value
  try { value = JSON.parse(row.note) }
  catch {
    if (row.note.trimStart().startsWith('{') && row.note.includes(JOURNAL_KIND)) corrupt()
    return null
  }
  if (!object(value) || value.kind !== JOURNAL_KIND) return null
  if (value.version !== 1 || !validOperation(value.operation) || !validAck(value.ack, value.operation)
    || typeof value.staffAcknowledged !== 'boolean' || !entityId(row.id)
    || row.bookingId !== value.operation.bookingId || row.changedBy !== value.operation.actorUserId
    || row.status !== value.ack.booking.status) corrupt()
  return {
    operation: clone(value.operation), ack: clone(value.ack), staffAcknowledged: value.staffAcknowledged,
    historyId: row.id,
  }
}

/** The repository must hold the booking lock while reading this snapshot and writing the decision. */
export function transitionDecision({ booking, assignments, records }, operation, { nowSeconds = Math.floor(Date.now() / 1000) } = {}) {
  if (!validOperation(operation)) fail(400, 'INVALID_REQUEST', 'Thông tin chuyển trạng thái không hợp lệ.')
  if (!booking) fail(404, 'BOOKING_NOT_FOUND', 'Không tìm thấy đơn dịch vụ.')
  if (!entityId(booking.id) || booking.id !== operation.bookingId || !bookingStatuses.has(booking.status)
    || !Array.isArray(assignments) || !Array.isArray(records)) invalidData()

  // A replay is a lookup of an immutable committed fact, including after completion.
  const matching = records.filter(record => record?.operation?.id === operation.id)
  if (matching.length > 1) corrupt()
  if (matching.length === 1) {
    const existing = matching[0]
    if (!validOperation(existing.operation) || !validAck(existing.ack, existing.operation)
      || typeof existing.staffAcknowledged !== 'boolean') corrupt()
    if (!equalOperation(existing.operation, operation)) fail(409, 'IDEMPOTENCY_CONFLICT', 'Mã thao tác đã được dùng cho nội dung khác.')
    return {
      ack: clone(existing.ack), metadata: {
        kind: JOURNAL_KIND, version: 1, operation: clone(existing.operation), ack: clone(existing.ack),
        staffAcknowledged: existing.staffAcknowledged,
      }, bookingStatus: booking.status, replayed: true,
    }
  }

  if (booking.status === 'CANCELLED') fail(409, 'BOOKING_CANCELLED', 'Đơn dịch vụ đã bị hủy.')
  if (booking.status === 'COMPLETED') fail(409, 'BOOKING_COMPLETED', 'Đơn dịch vụ đã hoàn thành.')
  if (booking.status === 'PENDING') fail(409, 'BOOKING_NOT_CONFIRMED', 'Đơn dịch vụ chưa được xác nhận.')

  const roster = new Map()
  for (const assignment of assignments) {
    if (!object(assignment) || !['id', 'bookingId', 'employeeId', 'actorUserId'].every(key => entityId(assignment[key]))
      || assignment.bookingId !== booking.id || !assignmentStatuses.has(assignment.status) || roster.has(assignment.id)) invalidData()
    roster.set(assignment.id, assignment)
  }
  const target = roster.get(operation.assignmentId)
  if (!target || target.employeeId !== operation.employeeId || target.actorUserId !== operation.actorUserId) {
    fail(409, 'STALE_ASSIGNMENT', 'Phân công không còn khớp với đơn dịch vụ và nhân viên.')
  }
  if (target.status === 'CANCELLED' || target.employeeStatus !== 'ACTIVE' || target.userStatus !== 'ACTIVE'
    || !['EMPLOYEE', 'STAFF'].includes(target.userRole)) fail(409, 'ASSIGNMENT_NOT_ACTIVE', 'Phân công hoặc tài khoản nhân viên không còn hoạt động.')

  const effective = new Map([...roster.values()].map(assignment => [assignment.id, assignment.status]))
  let checkInTime = storedInstant(target.checkInAt)
  let previousTime = checkInTime ?? -Infinity
  const seenOperations = new Set()
  for (const record of records) {
    if (!object(record) || !validOperation(record.operation) || !validAck(record.ack, record.operation)
      || typeof record.staffAcknowledged !== 'boolean' || record.operation.bookingId !== booking.id
      || seenOperations.has(record.operation.id)) corrupt()
    seenOperations.add(record.operation.id)
    if (record.operation.assignmentId === target.id && record.operation.employeeId === target.employeeId
      && record.operation.actorUserId === target.actorUserId) {
      const recordedTime = Date.parse(record.ack.occurredAt)
      previousTime = Math.max(previousTime, recordedTime)
      if (record.operation.toStatus === 'IN_PROGRESS' && checkInTime === null) checkInTime = recordedTime
    }
    if (record.staffAcknowledged) continue
    const current = roster.get(record.operation.assignmentId)
    if (!current || current.employeeId !== record.operation.employeeId || current.actorUserId !== record.operation.actorUserId
      || current.status === 'CANCELLED') fail(409, 'STALE_ASSIGNMENT', 'Phân công đã thay đổi trong khi còn thao tác cần đối chiếu.')
    const knownRank = steps.indexOf(effective.get(current.id))
    const acknowledgedRank = steps.indexOf(record.ack.assignmentStatus)
    if (acknowledgedRank > knownRank) effective.set(current.id, record.ack.assignmentStatus)
  }
  if (effective.get(target.id) !== operation.fromStatus) fail(409, 'INVALID_TRANSITION', 'Không được bỏ bước hoặc lặp lại bước bằng mã thao tác mới.')
  effective.set(target.id, operation.toStatus)
  const active = [...roster.values()].filter(assignment => assignment.status !== 'CANCELLED')
  if (active.length === 0) fail(409, 'ASSIGNMENT_NOT_ACTIVE', 'Đơn dịch vụ không có phân công còn hiệu lực.')
  let bookingStatus = booking.status
  if (operation.toStatus === 'ACCEPTED' && active.some(assignment => ['IN_PROGRESS', 'DONE'].includes(effective.get(assignment.id)))) bookingStatus = 'IN_PROGRESS'
  if (operation.toStatus === 'IN_PROGRESS' || operation.toStatus === 'DONE') {
    bookingStatus = active.every(assignment => effective.get(assignment.id) === 'DONE') ? 'COMPLETED' : 'IN_PROGRESS'
  }
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds < 0) invalidData()
  const instant = new Date(nowSeconds * 1000)
  if (!Number.isFinite(instant.getTime())) invalidData()
  if (operation.toStatus === 'DONE' && checkInTime === null) invalidData()
  // Reject clock rollback before committing an immutable ACK that Staff could never acknowledge.
  if (instant.getTime() < previousTime) fail(409, 'INVALID_TRANSITION', 'Thời điểm thao tác không được trước thời điểm công việc đã ghi nhận.')
  const ack = {
    operationId: operation.id, bookingId: operation.bookingId, assignmentId: operation.assignmentId,
    assignmentStatus: operation.toStatus, occurredAt: instant.toISOString(),
    booking: { id: operation.bookingId, status: bookingStatus, cancellationPending: null },
  }
  return {
    ack, metadata: { kind: JOURNAL_KIND, version: 1, operation: clone(operation), ack: clone(ack), staffAcknowledged: false },
    bookingStatus, replayed: false,
  }
}
