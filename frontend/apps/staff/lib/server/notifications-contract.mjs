import { AuthBffError } from './auth-core.mjs'

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const inputError = () => { throw new AuthBffError(400, 'VALIDATION_ERROR', 'Bộ lọc thông báo không hợp lệ. Vui lòng kiểm tra lại.') }
const invalid = () => { throw new AuthBffError(502, 'STAFF_INVALID_RESPONSE', 'Chưa thể đọc dữ liệu thông báo. Vui lòng thử lại hoặc liên hệ người quản lý.') }
const identifier = value => typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n
const text = value => typeof value === 'string' && value.length <= 20000
const integer = (value, min, max = Number.MAX_SAFE_INTEGER) => typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max
function timestamp(value) {
  return value === null || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value)
}

export function parseNotificationsQuery(params) {
  const values = {}
  for (const [key, value] of params) {
    if (!['page', 'pageSize', 'unreadOnly'].includes(key) || Object.hasOwn(values, key)) inputError()
    values[key] = value
  }
  const number = (key, fallback, max) => {
    if (values[key] === undefined) return fallback
    if (!/^[1-9]\d*$/.test(values[key]) || !Number.isSafeInteger(Number(values[key])) || Number(values[key]) > max) inputError()
    return Number(values[key])
  }
  if (values.unreadOnly !== undefined && !['true', 'false'].includes(values.unreadOnly)) inputError()
  return { page: number('page', 1, 100000), pageSize: number('pageSize', 20, 100), unreadOnly: values.unreadOnly === 'true' }
}

export function parseNotificationId(value) {
  if (!identifier(value)) inputError()
  return value
}

/** Whitelist the stored notification DTO; title/type/link are not part of the schema. */
function item(value) {
  if (!object(value) || !identifier(value.id) || !text(value.content)
    || !(value.bookingId === null || identifier(value.bookingId))
    || !timestamp(value.readAt) || !timestamp(value.createdAt) || typeof value.createdAt !== 'string') invalid()
  return { id: value.id, content: value.content, bookingId: value.bookingId, readAt: value.readAt, createdAt: value.createdAt }
}

export function parseNotificationsPage(payload, query) {
  if (!object(payload) || !Array.isArray(payload.data) || !object(payload.pagination) || payload.timezone !== 'Asia/Ho_Chi_Minh') invalid()
  const { page, pageSize, total, totalPages } = payload.pagination
  if (page !== query.page || pageSize !== query.pageSize || !integer(total, 0) || !integer(totalPages, 0)
    || totalPages !== Math.ceil(total / pageSize) || payload.data.length > pageSize
    || payload.data.length !== Math.min(pageSize, Math.max(0, total - (page - 1) * pageSize))) invalid()
  if (!integer(payload.unreadCount, 0) || payload.unreadCount > total) invalid()
  const seen = new Set()
  const data = payload.data.map(value => {
    const parsed = item(value)
    if (seen.has(parsed.id)) invalid()
    seen.add(parsed.id)
    return parsed
  })
  return { data, pagination: { page, pageSize, total, totalPages }, unreadCount: payload.unreadCount, timezone: 'Asia/Ho_Chi_Minh' }
}

export function parseUnreadCount(payload) {
  if (!object(payload) || !object(payload.data) || !integer(payload.data.unreadCount, 0)) invalid()
  return { data: { unreadCount: payload.data.unreadCount } }
}

export function parseMarkRead(payload) {
  if (!object(payload) || !object(payload.data) || !integer(payload.unreadCount, 0)) invalid()
  const parsed = item(payload.data)
  if (parsed.readAt === null) invalid()
  return { data: parsed, unreadCount: payload.unreadCount }
}

export function parseReadAll(payload) {
  if (!object(payload) || !object(payload.data) || !integer(payload.data.updated, 0)
    || payload.data.unreadCount !== 0) invalid()
  return { data: { updated: payload.data.updated, unreadCount: 0 } }
}
