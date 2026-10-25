import { HttpError } from './errors.js'

const jobStatuses = new Map([['ASSIGNED', 'waiting'], ['ACCEPTED', 'accepted'], ['IN_PROGRESS', 'in_progress'], ['DONE', 'done'], ['CANCELLED', null]])
const orderStatuses = new Map([['PENDING', 'pending'], ['CONFIRMED', 'confirmed'], ['IN_PROGRESS', 'in_progress'], ['COMPLETED', 'completed'], ['CANCELLED', 'cancelled']])
export const jobStatus = status => jobStatuses.get(status) ?? null
export const orderStatus = status => orderStatuses.get(status) ?? null
export const previousStatus = { ACCEPTED: 'ASSIGNED', IN_PROGRESS: 'ACCEPTED', DONE: 'IN_PROGRESS' }
export const steps = ['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'DONE']

export function iso(value) {
  if (value === null || value === undefined) return null
  const text = String(value)
  const date = value instanceof Date ? value : new Date(/[Zz]$|[+-]\d{2}:\d{2}$/.test(text) ? text : text.replace(' ', 'T') + 'Z')
  if (!Number.isFinite(date.getTime())) throw new HttpError(503, 'INVALID_DATABASE_DATA', 'Thời gian đã lưu không hợp lệ.')
  return date.toISOString()
}
function snapshot(value) {
  if (typeof value !== 'string') return value && typeof value === 'object' ? value : {}
  // mysql2 decodes JSON by default, including a scalar JSON string address.
  // Also support drivers returning the raw JSON representation.
  try { return JSON.parse(value) } catch { return value }
}
const text = value => typeof value === 'string' && value.trim() ? value : null
export function jobDto(row, items = [], detail = false) {
  const address = snapshot(row.addressSnapshot)
  const contact = {
    name: text(address?.recipient) || text(address?.name) || text(row.customerName),
    address: text(address) || text(address?.address_text) || text(address?.address),
  }
  if (detail) {
    contact.phone = text(address?.phone) || text(row.customerPhone)
    // The supplied schema does not define these properties or JSON keys.
    contact.houseType = null; contact.area = null; contact.rooms = null; contact.floors = null; contact.hasPets = null
  }
  const start = iso(row.scheduledStart), end = iso(row.scheduledEnd)
  return {
    id: String(row.id), assignmentId: String(row.id), orderId: String(row.bookingId),
    // IDs are identifiers; do not invent booking/job code columns or display data.
    jobCode: null, orderCode: null,
    status: row.status === 'ASSIGNED' ? 'WAITING' : row.status,
    databaseStatus: row.status, jobStatus: jobStatus(row.status), orderStatus: orderStatus(row.bookingStatus),
    scheduledAt: start, expectedEndAt: end,
    durationMinutes: start && end ? (Date.parse(end) - Date.parse(start)) / 60000 : null,
    contact, services: items.map(item => ({
      serviceId: String(item.serviceId), name: item.serviceName, unit: item.unit,
      quantity: String(item.quantity), unitPrice: String(item.unitPrice),
    })),
    checkInAt: iso(row.checkInAt), checkOutAt: iso(row.checkOutAt), assignedAt: iso(row.assignedAt),
    ...(detail ? { specialRequest: null, cancellationPending: null, orderHistory: null, historySource: 'order-service-not-loaded', unsupportedFields: ['jobCode', 'orderCode', 'houseType', 'area', 'rooms', 'floors', 'hasPets', 'specialRequest', 'cancellationPending'] } : {}),
  }
}
