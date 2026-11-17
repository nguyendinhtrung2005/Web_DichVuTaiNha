/** Proposed read contract. Enable only after the Staff Review API accepts this schema. */
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const count = value => Number.isSafeInteger(value) && value >= 0
const day = value => typeof value === 'string' && /^(?:19[7-9]\d|20\d\d)-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value
const timestamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
const text = (value, max) => value === null || typeof value === 'string' && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)

export function parseReviewsQuery(params) {
  const values = {}
  for (const [key, value] of params) {
    if (!['from', 'to', 'rating', 'page'].includes(key) || Object.hasOwn(values, key)) return null
    values[key] = value
  }
  if (!day(values.from) || !day(values.to) || values.from < '1971-01-01' || values.to < values.from
    || (Date.parse(values.to) - Date.parse(values.from)) / 86400000 > 365) return null
  if (values.rating !== undefined && !/^[1-5]$/.test(values.rating)) return null
  if (values.page !== undefined && (!/^[1-9]\d{0,5}$/.test(values.page) || Number(values.page) > 100000)) return null
  return { from: values.from, to: values.to, rating: values.rating === undefined ? null : Number(values.rating), page: Number(values.page || 1), pageSize: 10 }
}

/** Whitelist public fields; never forward customer identity or booking details. */
export function parseReviewsPayload(value, query) {
  if (!query || !object(value) || value.schemaVersion !== 'STAFF_REVIEWS_V1' || value.timezone !== 'Asia/Ho_Chi_Minh'
    || !object(value.range) || value.range.from !== query.from || value.range.to !== query.to
    || !object(value.filter) || value.filter.rating !== query.rating || !object(value.pagination) || !object(value.summary)
    || !Array.isArray(value.data) || value.data.length > 10) return null
  const p = value.pagination, s = value.summary
  if (p.page !== query.page || p.pageSize !== 10 || !count(p.total) || p.total > 1_000_000
    || p.totalPages !== Math.ceil(p.total / 10) || value.data.length !== Math.max(0, Math.min(10, p.total - (p.page - 1) * 10))
    || s.total !== p.total || !object(s.distribution)) return null
  let total = 0, weighted = 0
  /** @type {Record<string, number>} */
  const distribution = {}
  for (const star of [1, 2, 3, 4, 5]) {
    const n = s.distribution[String(star)]
    if (!count(n) || query.rating !== null && star !== query.rating && n !== 0) return null
    total += n; weighted += star * n; distribution[String(star)] = n
  }
  if (total !== p.total || s.average !== (total ? Math.round(weighted / total * 10) / 10 : null)) return null
  const seen = new Set(), data = []
  const from = Date.parse(query.from + 'T00:00:00+07:00'), to = Date.parse(query.to + 'T00:00:00+07:00') + 86400000
  let previous = Infinity
  for (const row of value.data) {
    if (!object(row) || typeof row.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(row.id) || seen.has(row.id)
      || !Number.isInteger(row.rating) || row.rating < 1 || row.rating > 5 || query.rating !== null && row.rating !== query.rating
      || !timestamp(row.createdAt) || !text(row.comment, 2000) || !text(row.serviceLabel, 150)) return null
    const at = Date.parse(row.createdAt)
    if (at < from || at >= to || at > previous) return null
    previous = at; seen.add(row.id)
    data.push({ id: row.id, rating: row.rating, createdAt: row.createdAt, comment: row.comment, serviceLabel: row.serviceLabel })
  }
  return { schemaVersion: 'STAFF_REVIEWS_V1', timezone: 'Asia/Ho_Chi_Minh', range: { from: query.from, to: query.to }, filter: { rating: query.rating },
    data, pagination: { page: p.page, pageSize: 10, total: p.total, totalPages: p.totalPages }, summary: { total, average: s.average, distribution } }
}
