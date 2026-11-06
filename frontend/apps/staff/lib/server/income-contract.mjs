import { AuthBffError } from './auth-core.mjs'
import { parseIncomeV2 } from '../../../../packages/ui/src/components/staff/staff-income-policy-v2.mjs'

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const inputError = () => { throw new AuthBffError(400, 'VALIDATION_ERROR', 'Tháng thu nhập chưa hợp lệ. Vui lòng kiểm tra lại.') }
const invalid = () => { throw new AuthBffError(502, 'STAFF_INVALID_RESPONSE', 'Chưa thể đọc tiền công dự kiến. Vui lòng thử lại hoặc liên hệ người quản lý.') }
const identifier = value => typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n
const nonNegativeInt = value => Number.isSafeInteger(value) && value >= 0
const timestamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/
const STATUSES = ['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'DONE', 'CANCELLED']
const REASONS = ['STATUS_NOT_DONE', 'MISSING_CHECK_TIMES', 'INVALID_CHECK_TIMES']

/** One Vietnam calendar month, 1971-01..2099-12, mapped onto UTC bounds. */
export function monthBounds(month) {
  const year = Number(month.slice(0, 4)), value = Number(month.slice(5, 7))
  const from = Date.UTC(year, value - 1, 1), to = Date.UTC(year, value, 1)
  return {
    from: `${month}-01`,
    to: new Date(to - 86400000).toISOString().slice(0, 10),
    fromUtc: from - 7 * 3600000,
    toUtc: to - 7 * 3600000,
  }
}

export function parseIncomeQuery(params) {
  const values = {}
  for (const [key, value] of params) {
    if (key !== 'month' || Object.hasOwn(values, key)) inputError()
    values[key] = value
  }
  if (typeof values.month !== 'string' || !monthPattern.test(values.month)) inputError()
  const year = Number(values.month.slice(0, 4))
  if (year < 1971 || year > 2099) inputError()
  return { month: values.month }
}

export function parseIncomeEstimate(payload, query) {
  if (payload?.policy?.version === "DEMO_V2") { const value = parseIncomeV2(payload, query.month); if (!value) invalid(); return value }
  if (payload?.policy?.version !== undefined) invalid()
  if (!object(payload) || payload.timezone !== 'Asia/Ho_Chi_Minh'
    || !object(payload.period) || !object(payload.policy) || !object(payload.counts) || !object(payload.payout)
    || !Array.isArray(payload.assignments) || payload.assignments.length > 500) invalid()
  const bounds = monthBounds(query.month)
  if (payload.period.month !== query.month || payload.period.from !== bounds.from || payload.period.to !== bounds.to
    || payload.period.timezone !== 'Asia/Ho_Chi_Minh') invalid()

  const policy = payload.policy
  if (policy.code !== 'ESTIMATE_FOR_DEMO' || policy.unitPriceVnd !== 60000 || policy.currency !== 'VND'
    || typeof policy.label !== 'string' || !policy.label.length || policy.label.length > 200) invalid()

  const counts = payload.counts
  if (![counts.assignments, counts.eligible, counts.incomplete, counts.excluded].every(nonNegativeInt)
    || counts.assignments !== payload.assignments.length
    || counts.eligible + counts.incomplete + counts.excluded !== counts.assignments) invalid()
  if (!nonNegativeInt(payload.estimateTotalVnd) || payload.estimateTotalVnd !== counts.eligible * policy.unitPriceVnd) invalid()
  if (payload.payout.status !== 'NOT_INTEGRATED') invalid()

  const seen = new Set()
  let eligible = 0, incomplete = 0
  const assignments = payload.assignments.map(value => {
    if (!object(value) || !identifier(value.id) || !identifier(value.bookingId) || !STATUSES.includes(value.status)
      || !timestamp(value.scheduledStart) || !timestamp(value.scheduledEnd) || Date.parse(value.scheduledEnd) <= Date.parse(value.scheduledStart)
      || !(value.checkInAt === null || timestamp(value.checkInAt)) || !(value.checkOutAt === null || timestamp(value.checkOutAt))
      || typeof value.eligible !== 'boolean' || !(value.reason === null || REASONS.includes(value.reason))) invalid()
    if (seen.has(value.id)) invalid()
    seen.add(value.id)
    const start = Date.parse(value.scheduledStart)
    if (start < bounds.fromUtc || start >= bounds.toUtc) invalid()
    const expectedEligible = value.status === 'DONE' && value.checkInAt !== null && value.checkOutAt !== null
      && Date.parse(value.checkOutAt) >= Date.parse(value.checkInAt)
    const expectedReason = expectedEligible ? null : value.status !== 'DONE' ? 'STATUS_NOT_DONE'
      : value.checkInAt === null || value.checkOutAt === null ? 'MISSING_CHECK_TIMES' : 'INVALID_CHECK_TIMES'
    if (value.eligible !== expectedEligible || value.reason !== expectedReason) invalid()
    if (expectedEligible) eligible += 1
    else if (expectedReason === 'MISSING_CHECK_TIMES' || expectedReason === 'INVALID_CHECK_TIMES') incomplete += 1
    return {
      id: value.id, bookingId: value.bookingId, status: value.status,
      scheduledStart: value.scheduledStart, scheduledEnd: value.scheduledEnd,
      checkInAt: value.checkInAt, checkOutAt: value.checkOutAt,
      eligible: value.eligible, reason: value.reason,
    }
  })
  // Recount from the rows themselves: a wrong count or total must never render.
  if (eligible !== counts.eligible || incomplete !== counts.incomplete
    || payload.assignments.length - eligible - incomplete !== counts.excluded) invalid()

  return {
    period: { month: query.month, from: bounds.from, to: bounds.to, timezone: 'Asia/Ho_Chi_Minh' },
    policy: { code: 'ESTIMATE_FOR_DEMO', unitPriceVnd: policy.unitPriceVnd, currency: 'VND', label: policy.label },
    counts: { assignments: counts.assignments, eligible, incomplete, excluded: counts.excluded },
    estimateTotalVnd: payload.estimateTotalVnd,
    assignments,
    payout: { status: 'NOT_INTEGRATED' },
    timezone: 'Asia/Ho_Chi_Minh',
  }
}
