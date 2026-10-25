import { AuthBffError } from './auth-core.mjs'
import { parseJobsQuery, parseJobsResponse } from './jobs-contract.mjs'

const inputError = () => { throw new AuthBffError(400, 'VALIDATION_ERROR', 'Khoảng ngày hoặc bộ lọc lịch làm việc không hợp lệ. Chọn tối đa 366 ngày, từ năm 1971 đến 2099.') }
const invalid = () => { throw new AuthBffError(502, 'STAFF_INVALID_RESPONSE', 'Chưa thể đọc lịch làm việc. Vui lòng thử lại hoặc liên hệ người quản lý.') }
function day(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) inputError()
  const time = Date.parse(value + 'T00:00:00Z')
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value || Number(value.slice(0, 4)) < 1971 || Number(value.slice(0, 4)) > 2099) inputError()
  return time
}

/** Calendar days are inclusive Vietnam dates; the Staff API converts them to UTC SQL bounds. */
export function parseScheduleQuery(params) {
  const values = new Map(), listParams = new URLSearchParams()
  for (const [key, value] of params) {
    if (!['from', 'to', 'status', 'page', 'pageSize', 'sort'].includes(key) || values.has(key)) inputError()
    values.set(key, value)
    if (key !== 'from' && key !== 'to') listParams.set(key, value)
  }
  const from = values.get('from'), to = values.get('to')
  const start = day(from), end = day(to)
  if (end < start || (end - start) / 86400000 > 365) inputError()
  return { from, to, ...parseJobsQuery(listParams) }
}

/** Keep UC9's actual DTO, and reject rows that contradict the requested schedule window. */
export function parseScheduleResponse(payload, query) {
  const result = parseJobsResponse(payload, query)
  const start = day(query.from) - 7 * 3600000
  const end = day(query.to) + 86400000 - 7 * 3600000
  for (const job of result.data) {
    if (job.scheduledAt === null || job.expectedEndAt === null) invalid()
    const jobStart = Date.parse(job.scheduledAt), jobEnd = Date.parse(job.expectedEndAt)
    if (!(jobEnd > jobStart && jobStart < end && jobEnd > start)) invalid()
  }
  return result
}
