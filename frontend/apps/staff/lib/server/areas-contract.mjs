import { AuthBffError } from './auth-core.mjs'

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const inputError = () => { throw new AuthBffError(400, 'VALIDATION_ERROR', 'Khoảng ngày khu vực hoặc ca làm không hợp lệ. Vui lòng kiểm tra lại.') }
const invalid = () => { throw new AuthBffError(502, 'STAFF_INVALID_RESPONSE', 'Chưa thể đọc dữ liệu khu vực và ca làm. Vui lòng thử lại hoặc liên hệ người quản lý.') }
const identifier = value => typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n
const nullableText = (value, max = 4000) => value === null || (typeof value === 'string' && value.length <= max)
const decimal = value => value === null || (typeof value === 'string' && /^-?\d{1,20}(?:\.\d{1,10})?$/.test(value))
const day = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + 'T00:00:00Z'))
  && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value
function timestamp(value) {
  return value === null || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value)
}
const plain = value => value === null || ['string', 'number', 'boolean'].includes(typeof value)
  || (Array.isArray(value) ? value.every(plain) : object(value) && Object.values(value).every(plain))

/** from/to are required Vietnam calendar dates, at most 63 days apart. */
export function parseAvailabilityQuery(params) {
  const values = {}
  for (const [key, value] of params) {
    if (!['from', 'to'].includes(key) || Object.hasOwn(values, key)) inputError()
    values[key] = value
  }
  if (!day(values.from) || !day(values.to)) inputError()
  const from = Date.parse(values.from + 'T00:00:00Z'), to = Date.parse(values.to + 'T00:00:00Z')
  if (to < from || (to - from) / 86400000 > 62) inputError()
  return { from: values.from, to: values.to }
}

function branch(value) {
  if (!object(value) || !identifier(value.id) || !nullableText(value.name, 150) || !nullableText(value.addressText, 20000)
    || !nullableText(value.status, 40) || !decimal(value.latitude) || !decimal(value.longitude)
    || !(value.serviceArea === null || (typeof value.serviceArea === 'object' && plain(value.serviceArea)))) invalid()
  return {
    id: value.id, name: value.name, addressText: value.addressText,
    serviceArea: value.serviceArea, latitude: value.latitude, longitude: value.longitude, status: value.status,
  }
}

export function parseBranch(payload) {
  if (!object(payload) || payload.timezone !== 'Asia/Ho_Chi_Minh' || !object(payload.data)) invalid()
  return { data: branch(payload.data), timezone: 'Asia/Ho_Chi_Minh' }
}

function availability(value) {
  if (!object(value) || !identifier(value.id) || typeof value.startsAt !== 'string' || !timestamp(value.startsAt)
    || typeof value.endsAt !== 'string' || !timestamp(value.endsAt) || Date.parse(value.endsAt) <= Date.parse(value.startsAt)
    || !nullableText(value.status, 40)) invalid()
  return { id: value.id, startsAt: value.startsAt, endsAt: value.endsAt, status: value.status }
}

export function parseAvailability(payload, query) {
  if (!object(payload) || !Array.isArray(payload.data) || payload.data.length > 500
    || typeof payload.truncated !== 'boolean' || !identifier(payload.branchId)
    || !object(payload.range) || payload.range.from !== query.from || payload.range.to !== query.to
    || payload.range.timezone !== 'Asia/Ho_Chi_Minh') invalid()
  const seen = new Set()
  const data = payload.data.map(value => {
    const parsed = availability(value)
    if (seen.has(parsed.id)) invalid()
    seen.add(parsed.id)
    return parsed
  })
  if (payload.truncated && payload.data.length !== 500) invalid()
  return { data, range: { from: query.from, to: query.to, timezone: 'Asia/Ho_Chi_Minh' }, truncated: payload.truncated, branchId: payload.branchId }
}
