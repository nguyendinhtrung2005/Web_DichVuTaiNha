import { createHash } from 'node:crypto'
import { AuthBffError } from './auth-core.mjs'
import { parseAssignmentId } from './job-detail-contract.mjs'

export const STATUS_STEPS = Object.freeze(['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'DONE'])
const targets = STATUS_STEPS.slice(1)
const jobs = { ASSIGNED: 'waiting', ACCEPTED: 'accepted', IN_PROGRESS: 'in_progress', DONE: 'done' }
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const invalid = () => { throw new AuthBffError(502, 'STAFF_INVALID_RESPONSE', 'Chưa thể xác minh kết quả cập nhật. Vui lòng kiểm tra lại bằng thao tác đã lưu.') }
const time = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
export function parseStatusInput(body, key) {
  if (!object(body) || Object.keys(body).length !== 1 || !targets.includes(body.status)
    || typeof key !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(key)) {
    throw new AuthBffError(400, 'VALIDATION_ERROR', 'Trạng thái hoặc mã thao tác không hợp lệ.')
  }
  return { status: body.status, key }
}
export function transitionOperationId(record) {
  return createHash('sha256').update(JSON.stringify([record.userId, record.assignmentId, record.idempotencyKey])).digest('hex')
}
/** A reply confirms the specific operation, never a newly inferred booking state. */
export function parseStatusResponse(payload, httpStatus, record) {
  if (!object(payload) || !object(payload.data) || ![200, 202].includes(httpStatus)) invalid()
  const value = payload.data, transition = value.transition, order = value.orderAtTransition
  if (value.assignmentId !== record.assignmentId || !STATUS_STEPS.includes(value.status)
    || STATUS_STEPS.indexOf(value.status) < STATUS_STEPS.indexOf(record.requestedStatus)
    || value.jobStatus !== jobs[value.status] || !(value.checkInAt === null || time(value.checkInAt))
    || !(value.checkOutAt === null || time(value.checkOutAt)) || !object(transition)
    || transition.operationId !== transitionOperationId(record) || transition.requestedStatus !== record.requestedStatus
    || transition.synchronization !== (httpStatus === 200 ? 'SYNCHRONIZED' : 'PENDING_ACKNOWLEDGEMENT')
    || typeof transition.replayed !== 'boolean' || !object(order) || order.id !== record.orderId
    || !['PENDING', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'].includes(order.status) || !time(order.asOf)) invalid()
  try { parseAssignmentId(order.id) } catch { invalid() }
  return {
    assignmentId: value.assignmentId, status: value.status, jobStatus: value.jobStatus,
    checkInAt: value.checkInAt, checkOutAt: value.checkOutAt,
    transition: { operationId: transition.operationId, requestedStatus: transition.requestedStatus, synchronization: transition.synchronization, replayed: transition.replayed },
    orderAtTransition: { id: order.id, status: order.status, asOf: order.asOf },
  }
}
export function currentStatus(detail) {
  return {
    assignmentId: detail.assignmentId, orderId: detail.orderId, status: detail.databaseStatus, jobStatus: detail.jobStatus,
    orderStatus: detail.orderStatus, checkInAt: detail.checkInAt, checkOutAt: detail.checkOutAt,
    assignedAt: detail.assignedAt, cancellationPending: detail.cancellationPending,
  }
}
export function publicOperation(entry, current) {
  if (!entry) return null
  const { record, receipt } = entry
  return {
    idempotencyKey: record.idempotencyKey, requestedStatus: record.requestedStatus,
    phase: receipt?.httpStatus === 200 ? 'confirmed' : receipt?.httpStatus === 202 ? 'pending' : 'unknown',
    createdAt: new Date(record.createdAt).toISOString(),
    observedTarget: STATUS_STEPS.indexOf(current.status) >= STATUS_STEPS.indexOf(record.requestedStatus),
    ...(receipt ? { transition: receipt.data.transition } : {}),
  }
}
export function statusView(current, entries) {
  const changed = entries.some(({ record, receipt }) => record.orderId !== current.orderId || record.assignedAt !== current.assignedAt
    || (receipt?.httpStatus === 200 && STATUS_STEPS.indexOf(current.status) < STATUS_STEPS.indexOf(record.requestedStatus)))
  const unresolved = entries.find(entry => entry.receipt?.httpStatus !== 200)
  const selected = unresolved || entries.at(-1)
  const next = STATUS_STEPS[STATUS_STEPS.indexOf(current.status) + 1]
  const eligible = targets.includes(next) && current.status !== 'CANCELLED'
  const blockedReason = changed ? 'ASSIGNMENT_CHANGED' : unresolved ? 'UNRESOLVED_OPERATION'
    : !eligible ? 'NO_NEXT_STATUS' : !['confirmed', 'in_progress'].includes(current.orderStatus) ? 'BOOKING_NOT_ACTIVE'
      : current.cancellationPending === true ? 'CANCELLATION_PENDING' : null
  return {
    current, operation: publicOperation(selected, current), allowedStatus: blockedReason ? null : next,
    canRetry: Boolean(unresolved && !changed && current.status !== 'CANCELLED' && current.orderStatus !== 'cancelled'
      && STATUS_STEPS.indexOf(current.status) >= STATUS_STEPS.indexOf(unresolved.record.fromStatus)), blockedReason,
  }
}
