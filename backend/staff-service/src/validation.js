import { HttpError } from './errors.js'

const fail = message => { throw new HttpError(400, 'VALIDATION_ERROR', message) }
const keysOnly = (value, allowed) => {
  if (Object.keys(value).some(key => !allowed.includes(key))) fail('Request chứa trường không được hỗ trợ.')
}
const single = value => {
  if (value !== undefined && typeof value !== 'string') fail('Mỗi tham số chỉ được xuất hiện một lần.')
  return value
}
const integer = (raw, fallback, max) => {
  if (raw === undefined) return fallback
  if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) > max) fail('Tham số phân trang không hợp lệ.')
  return Number(raw)
}
export function positiveId(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{0,18}$/.test(value) || BigInt(value) > 9223372036854775807n) fail('ID phải là số nguyên dương BIGINT hợp lệ.')
  return value
}
export function listQuery(query, schedule = false) {
  keysOnly(query, schedule ? ['from', 'to', 'status', 'page', 'pageSize', 'sort'] : ['from', 'to', 'serviceId', 'status', 'page', 'pageSize', 'sort'])
  Object.values(query).forEach(single)
  const rawStatus = query.status?.toUpperCase()
  const status = rawStatus === 'WAITING' ? 'ASSIGNED' : rawStatus
  if (status !== undefined && !['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'DONE', 'CANCELLED'].includes(status)) fail('Trạng thái công việc không hợp lệ.')
  const sort = query.sort || 'asc'
  if (!['asc', 'desc'].includes(sort)) fail('sort chỉ nhận asc hoặc desc.')
  const result = { status, page: integer(query.page, 1, 100000), pageSize: integer(query.pageSize, 20, 100), sort }
  if (!schedule && query.serviceId !== undefined) result.serviceId = positiveId(query.serviceId)
  if (schedule || query.from !== undefined || query.to !== undefined) {
    const from = parseDay(query.from), to = parseDay(query.to)
    if (to < from || (to - from) / 86400000 > 365) fail('Khoảng ngày phải tăng dần và không dài hơn 366 ngày.')
    // API calendar dates use Vietnam time (UTC+07); MySQL connections use UTC.
    result.fromUtc = mysqlTime(new Date(from - 7 * 3600000))
    result.toUtc = mysqlTime(new Date(to + 86400000 - 7 * 3600000))
  }
  return result
}
function parseDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('from/to phải có định dạng YYYY-MM-DD.')
  const time = Date.parse(value + 'T00:00:00Z')
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value || Number(value.slice(0, 4)) < 1971 || Number(value.slice(0, 4)) > 2099) fail('Ngày không tồn tại hoặc nằm ngoài phạm vi hỗ trợ.')
  return time
}
export function mysqlTime(date) { return date.toISOString().replace('T', ' ').replace('Z', '') }
/** Notifications are read per signed-in user; the query never accepts a user id. */
export function notificationQuery(query) {
  keysOnly(query, ['page', 'pageSize', 'unreadOnly'])
  Object.values(query).forEach(single)
  if (query.unreadOnly !== undefined && !['true', 'false'].includes(query.unreadOnly)) fail('unreadOnly chỉ nhận true hoặc false.')
  return { page: integer(query.page, 1, 100000), pageSize: integer(query.pageSize, 20, 100), unreadOnly: query.unreadOnly === 'true' }
}
/** Availability is read for the signed-in employee only; no employee id is accepted. */
export function availabilityQuery(query) {
  keysOnly(query, ['from', 'to'])
  Object.values(query).forEach(single)
  if (query.from === undefined || query.to === undefined) fail('Cần đủ from và to theo định dạng YYYY-MM-DD.')
  const from = parseDay(query.from), to = parseDay(query.to)
  if (to < from || (to - from) / 86400000 > 62) fail('Khoảng ngày phải tăng dần và không dài hơn 63 ngày.')
  return {
    from: query.from, to: query.to,
    // API calendar dates use Vietnam time (UTC+07); MySQL sessions run in UTC.
    fromUtc: mysqlTime(new Date(from - 7 * 3600000)),
    toUtc: mysqlTime(new Date(to + 86400000 - 7 * 3600000)),
  }
}
/** Income estimate is read for the signed-in employee and one Vietnam month only. */
export function incomeQuery(query) {
  keysOnly(query, ['month'])
  Object.values(query).forEach(single)
  if (typeof query.month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(query.month)) fail('month phải có định dạng YYYY-MM.')
  const year = Number(query.month.slice(0, 4)), month = Number(query.month.slice(5, 7))
  if (year < 1971 || year > 2099) fail('Tháng nằm ngoài phạm vi hỗ trợ.')
  const from = Date.UTC(year, month - 1, 1), to = Date.UTC(year, month, 1)
  return {
    month: query.month,
    from: `${query.month}-01`,
    to: new Date(to - 86400000).toISOString().slice(0, 10),
    // Vietnam calendar month (UTC+07) mapped onto UTC TIMESTAMP columns.
    fromUtc: mysqlTime(new Date(from - 7 * 3600000)),
    toUtc: mysqlTime(new Date(to - 7 * 3600000)),
  }
}
export function transitionInput(body, key) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('Body phải là JSON object.')
  keysOnly(body, ['status'])
  if (typeof body.status !== 'string' || !['ACCEPTED', 'IN_PROGRESS', 'DONE'].includes(body.status)) fail('status phải là ACCEPTED, IN_PROGRESS hoặc DONE.')
  if (typeof key !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(key)) fail('Cần header Idempotency-Key gồm 8–128 ký tự ASCII hợp lệ.')
  return { status: body.status, idempotencyKey: key }
}
