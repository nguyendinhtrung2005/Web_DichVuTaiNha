import { AuthBffError } from './auth-core.mjs'

const statuses = new Map([['ASSIGNED', ['WAITING', 'waiting']], ['ACCEPTED', ['ACCEPTED', 'accepted']], ['IN_PROGRESS', ['IN_PROGRESS', 'in_progress']], ['DONE', ['DONE', 'done']], ['CANCELLED', ['CANCELLED', null]]])
const orderStatuses = new Set(['pending', 'confirmed', 'in_progress', 'completed', 'cancelled', null])
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const inputError = () => { throw new AuthBffError(400, 'VALIDATION_ERROR', 'Bộ lọc công việc không hợp lệ. Vui lòng kiểm tra lại.') }
const invalid = () => { throw new AuthBffError(502, 'STAFF_INVALID_RESPONSE', 'Chưa thể đọc dữ liệu công việc. Vui lòng thử lại hoặc liên hệ người quản lý.') }
const id = value => typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n
const text = value => typeof value === 'string' && value.length <= 20000
const nullableText = value => value === null || text(value)
const decimal = value => typeof value === 'string' && /^\d{1,20}(?:\.\d{1,10})?$/.test(value)
function timestamp(value) {
  return value === null || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value)
}

export function parseJobsQuery(params) {
  const values = {}
  for (const [key, value] of params) {
    if (!['status', 'page', 'pageSize', 'sort'].includes(key) || Object.hasOwn(values, key)) inputError()
    values[key] = value
  }
  const number = (key, fallback, max) => {
    if (values[key] === undefined) return fallback
    if (!/^[1-9]\d*$/.test(values[key]) || !Number.isSafeInteger(Number(values[key])) || Number(values[key]) > max) inputError()
    return Number(values[key])
  }
  let status = values.status?.toUpperCase()
  if (status === 'WAITING') status = 'ASSIGNED'
  if (status !== undefined && !statuses.has(status)) inputError()
  const sort = values.sort ?? 'asc'
  if (!['asc', 'desc'].includes(sort)) inputError()
  return { status, page: number('page', 1, 100000), pageSize: number('pageSize', 20, 100), sort }
}

/** Validate and explicitly select the UC9 DTO; no profile, token, or arbitrary upstream fields. */
export function parseJobsResponse(payload, query) {
  if (!object(payload) || !Array.isArray(payload.data) || !object(payload.pagination)
    || payload.timezone !== 'Asia/Ho_Chi_Minh') invalid()
  const { page, pageSize, total, totalPages } = payload.pagination
  if (page !== query.page || pageSize !== query.pageSize || !Number.isSafeInteger(total) || total < 0
    || !Number.isSafeInteger(totalPages) || totalPages !== Math.ceil(total / pageSize)
    || payload.data.length > pageSize || payload.data.length > total) invalid()
  // Every row in a valid page must be present; out-of-range pages legitimately have no rows.
  if (payload.data.length !== Math.min(pageSize, Math.max(0, total - (page - 1) * pageSize))) invalid()
  const seen = new Set()
  const data = payload.data.map(job => {
    if (!object(job) || !id(job.assignmentId) || job.id !== job.assignmentId || !id(job.orderId)
      || seen.has(job.assignmentId) || job.jobCode !== null || job.orderCode !== null
      || !statuses.has(job.databaseStatus) || !orderStatuses.has(job.orderStatus)
      || !object(job.contact) || !nullableText(job.contact.name) || !nullableText(job.contact.address)
      || !Array.isArray(job.services) || job.services.length > 1000
      || ![job.scheduledAt, job.expectedEndAt, job.checkInAt, job.checkOutAt, job.assignedAt].every(timestamp)
      || !(job.durationMinutes === null || (typeof job.durationMinutes === 'number' && Number.isFinite(job.durationMinutes)))) invalid()
    const [status, jobStatus] = statuses.get(job.databaseStatus)
    if (job.status !== status || job.jobStatus !== jobStatus || (query.status !== undefined && job.databaseStatus !== query.status)) invalid()
    seen.add(job.assignmentId)
    const services = job.services.map(service => {
      if (!object(service) || !id(service.serviceId) || !text(service.name) || !text(service.unit)
        || !decimal(service.quantity) || !decimal(service.unitPrice)) invalid()
      return { serviceId: service.serviceId, name: service.name, unit: service.unit, quantity: service.quantity, unitPrice: service.unitPrice }
    })
    return {
      id: job.id, assignmentId: job.assignmentId, orderId: job.orderId,
      jobCode: null, orderCode: null, status, databaseStatus: job.databaseStatus, jobStatus, orderStatus: job.orderStatus,
      scheduledAt: job.scheduledAt, expectedEndAt: job.expectedEndAt, durationMinutes: job.durationMinutes,
      contact: { name: job.contact.name, address: job.contact.address }, services,
      checkInAt: job.checkInAt, checkOutAt: job.checkOutAt, assignedAt: job.assignedAt,
    }
  })
  return { data, pagination: { page, pageSize, total, totalPages }, timezone: 'Asia/Ho_Chi_Minh' }
}
