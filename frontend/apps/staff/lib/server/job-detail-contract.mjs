import { AuthBffError } from './auth-core.mjs'
import { parseJobsResponse } from './jobs-contract.mjs'

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const text = value => typeof value === 'string' && value.length <= 20000
const unsupported = ['jobCode', 'orderCode', 'houseType', 'area', 'rooms', 'floors', 'hasPets', 'specialRequest', 'cancellationPending']
const invalid = () => { throw new AuthBffError(502, 'STAFF_INVALID_RESPONSE', 'Chưa thể đọc thông tin công việc. Vui lòng thử lại hoặc liên hệ người quản lý.') }

export function parseAssignmentId(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{0,18}$/.test(value) || BigInt(value) > 9223372036854775807n) {
    throw new AuthBffError(400, 'VALIDATION_ERROR', 'Mã phân công không hợp lệ.')
  }
  return value
}

// Order context timestamps may include an offset and 0–3 fractional digits.
function historyTime(value) {
  if (typeof value !== 'string') return false
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value)
  if (!parts) return false
  const [, year, month, day, hour, minute, second, offsetHour, offsetMinute] = parts.map(Number)
  const calendar = new Date(0)
  calendar.setUTCFullYear(year, month, 0)
  return month >= 1 && month <= 12 && day >= 1 && day <= calendar.getUTCDate() && hour <= 23 && minute <= 59 && second <= 59
    && (Number.isNaN(offsetHour) || (offsetHour <= 23 && offsetMinute <= 59)) && Number.isFinite(Date.parse(value))
}

/** Keep nullable/unsupported detail data explicit; never create profile or history values. */
export function parseJobDetailResponse(payload, assignmentId) {
  if (!object(payload) || !object(payload.data) || payload.data.assignmentId !== assignmentId) invalid()
  const raw = payload.data
  // Reuse UC9's row validator. This internal envelope is never exposed as detail pagination.
  let base
  try {
    base = parseJobsResponse({ data: [raw], pagination: { page: 1, pageSize: 1, total: 1, totalPages: 1 }, timezone: 'Asia/Ho_Chi_Minh' }, { page: 1, pageSize: 1 }).data[0]
  } catch { invalid() }
  if (!(raw.contact.phone === null || text(raw.contact.phone))
    || ['houseType', 'area', 'rooms', 'floors', 'hasPets'].some(key => raw.contact[key] !== null)
    || raw.specialRequest !== null || !(raw.cancellationPending === null || typeof raw.cancellationPending === 'boolean')
    || !['order-service-not-loaded', 'order-service-unavailable', 'order-service'].includes(raw.historySource)
    || !(raw.orderHistory === null || Array.isArray(raw.orderHistory)) || !Array.isArray(raw.unsupportedFields)) invalid()
  if (raw.historySource !== 'order-service' && (raw.orderHistory !== null || raw.cancellationPending !== null)) invalid()
  const expectedUnsupported = unsupported.filter(key => key !== 'cancellationPending' || raw.cancellationPending === null)
  if (raw.unsupportedFields.length !== expectedUnsupported.length || new Set(raw.unsupportedFields).size !== raw.unsupportedFields.length
    || raw.unsupportedFields.some(key => !expectedUnsupported.includes(key))) invalid()
  let orderHistory = null
  if (raw.orderHistory !== null) {
    if (raw.orderHistory.length > 10000) invalid()
    orderHistory = raw.orderHistory.map(entry => {
      if (!object(entry) || !historyTime(entry.at) || !text(entry.label) || !entry.label.trim()
        || !text(entry.by) || !entry.by.trim() || (entry.note !== undefined && !text(entry.note))) invalid()
      return { at: entry.at, label: entry.label, by: entry.by, ...(entry.note === undefined ? {} : { note: entry.note }) }
    })
  }
  if (raw.warnings !== undefined && (!Array.isArray(raw.warnings) || raw.warnings.length !== 1
    || !object(raw.warnings[0]) || raw.warnings[0].code !== 'ORDER_HISTORY_UNAVAILABLE'
    || !text(raw.warnings[0].message) || raw.historySource !== 'order-service-unavailable')) invalid()
  if (raw.historySource === 'order-service-unavailable' && raw.warnings === undefined) invalid()
  return {
    data: {
      ...base,
      contact: { ...base.contact, phone: raw.contact.phone, houseType: null, area: null, rooms: null, floors: null, hasPets: null },
      specialRequest: null, cancellationPending: raw.cancellationPending, orderHistory,
      historySource: raw.historySource, unsupportedFields: [...raw.unsupportedFields],
      ...(raw.warnings === undefined ? {} : { warnings: [{ code: 'ORDER_HISTORY_UNAVAILABLE', message: 'Chưa lấy được lịch sử công việc. Vui lòng thử lại sau.' }] }),
    },
  }
}
