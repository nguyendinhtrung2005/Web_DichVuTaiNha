import { HttpError } from './errors.js'

const bookingStatuses = new Set(['PENDING', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'])
const previous = { ACCEPTED: 'ASSIGNED', IN_PROGRESS: 'ACCEPTED', DONE: 'IN_PROGRESS' }
const rejectionMessages = {
  BOOKING_CANCELLED: 'Đơn đã bị hủy.',
  BOOKING_COMPLETED: 'Đơn đã hoàn thành.',
  BOOKING_NOT_CONFIRMED: 'Đơn chưa đủ điều kiện tiếp nhận công việc.',
  CANCELLATION_PENDING: 'Đơn đang có yêu cầu hủy chờ xử lý.',
  INVALID_TRANSITION: 'Không được bỏ bước cập nhật công việc.',
  ASSIGNMENT_NOT_ACTIVE: 'Phân công không còn hiệu lực.',
  STALE_ASSIGNMENT: 'Phân công đã thay đổi; cần đối chiếu lại.',
  IDEMPOTENCY_CONFLICT: 'Idempotency-Key đã được dùng cho thao tác khác.',
  OPERATION_CONFLICT: 'Thao tác đã ghi nhận có nội dung khác.',
}
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const text = value => typeof value === 'string' && value.length <= 8192
const id = value => (typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value))
  || (Number.isSafeInteger(value) && value > 0)
const entityId = value => {
  const canonical = Number.isSafeInteger(value) ? String(value) : value
  return typeof canonical === 'string' && /^[1-9]\d{0,18}$/.test(canonical) && BigInt(canonical) <= 9223372036854775807n
}
const date = value => {
  if (typeof value !== 'string') return false
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value)
  if (!parts) return false
  const [, year, month, day, hour, minute, second, offsetHour, offsetMinute] = parts.map(Number)
  const calendar = new Date(0)
  calendar.setUTCFullYear(year, month, 0)
  return month >= 1 && month <= 12 && day >= 1 && day <= calendar.getUTCDate() && hour <= 23 && minute <= 59 && second <= 59
    && (Number.isNaN(offsetHour) || (offsetHour <= 23 && offsetMinute <= 59)) && Number.isFinite(Date.parse(value))
}
const badResponse = () => new HttpError(502, 'ORDER_BAD_RESPONSE', 'Order Service trả dữ liệu không đúng hợp đồng.')
const unavailable = () => new HttpError(503, 'ORDER_UNAVAILABLE', 'Chưa kết nối được Order Service; thao tác chưa được xác nhận.')

function operationInput(value) {
  if (!record(value) || !id(value.id) || !['bookingId', 'assignmentId', 'employeeId', 'actorUserId'].every(key => entityId(value[key]))
    || previous[value.toStatus] !== value.fromStatus) throw new TypeError('Invalid assignment transition operation')
  return Object.fromEntries(['id', 'bookingId', 'assignmentId', 'employeeId', 'actorUserId', 'fromStatus', 'toStatus']
    .map(key => [key, String(value[key])]))
}

function bookingSnapshot(value) {
  if (!record(value) || !entityId(value.id) || !bookingStatuses.has(value.status)
    || !(value.cancellationPending === null || typeof value.cancellationPending === 'boolean')) throw badResponse()
  return { id: String(value.id), status: value.status, cancellationPending: value.cancellationPending }
}

function context(value) {
  const result = bookingSnapshot(value)
  if (!(value.history === undefined || value.history === null || Array.isArray(value.history))) throw badResponse()
  result.history = value.history == null ? null : value.history.map(entry => {
    if (!record(entry) || !date(entry.at) || !text(entry.label) || !entry.label.trim()
      || !text(entry.by) || !entry.by.trim() || (entry.note !== undefined && !text(entry.note))) throw badResponse()
    return { at: entry.at, label: entry.label, by: entry.by, ...(entry.note === undefined ? {} : { note: entry.note }) }
  })
  // The supplied MySQL schema lacks these optional attributes. Never invent values.
  for (const key of ['code', 'specialRequest']) {
    if (value[key] !== undefined) {
      if (!(value[key] === null || text(value[key]))) throw badResponse()
      result[key] = value[key]
    }
  }
  if (value.createdAt !== undefined) {
    if (!(value.createdAt === null || date(value.createdAt))) throw badResponse()
    result.createdAt = value.createdAt
  }
  if (value.contact !== undefined) {
    if (!record(value.contact)) throw badResponse()
    result.contact = {}
    for (const key of ['name', 'phone', 'address', 'houseType']) {
      if (value.contact[key] !== undefined) {
        if (!(value.contact[key] === null || text(value.contact[key]))) throw badResponse()
        result.contact[key] = value.contact[key]
      }
    }
    for (const key of ['area', 'rooms', 'floors']) {
      if (value.contact[key] !== undefined) {
        if (!(value.contact[key] === null || (Number.isFinite(value.contact[key]) && value.contact[key] >= 0))) throw badResponse()
        result.contact[key] = value.contact[key]
      }
    }
    if (value.contact.hasPets !== undefined) {
      if (!(value.contact.hasPets === null || typeof value.contact.hasPets === 'boolean')) throw badResponse()
      result.contact.hasPets = value.contact.hasPets
    }
  }
  if (value.items !== undefined) {
    if (!Array.isArray(value.items)) throw badResponse()
    result.items = value.items.map(item => {
      if (!record(item) || !entityId(item.serviceId) || !text(item.serviceName) || !text(item.unit)
        || !((typeof item.quantity === 'number' && Number.isFinite(item.quantity) && item.quantity > 0)
          || (typeof item.quantity === 'string' && /^\d+(?:\.\d+)?$/.test(item.quantity) && Number(item.quantity) > 0))
        || (item.scope !== undefined && !(item.scope === null || text(item.scope)))) throw badResponse()
      return { serviceId: String(item.serviceId), serviceName: item.serviceName, unit: item.unit, quantity: item.quantity,
        ...(item.scope === undefined ? {} : { scope: item.scope }) }
    })
  }
  return result
}

function ack(value, operation) {
  if (!record(value) || !id(value.operationId) || !entityId(value.assignmentId) || !entityId(value.bookingId)
    || String(value.operationId) !== operation.id || String(value.assignmentId) !== operation.assignmentId
    || String(value.bookingId) !== operation.bookingId || value.assignmentStatus !== operation.toStatus
    || !date(value.occurredAt)) throw badResponse()
  const booking = bookingSnapshot(value.booking)
  const statuses = { ACCEPTED: ['CONFIRMED', 'IN_PROGRESS'], IN_PROGRESS: ['IN_PROGRESS'], DONE: ['IN_PROGRESS', 'COMPLETED'] }
  if (booking.id !== operation.bookingId || !statuses[operation.toStatus].includes(booking.status)
    || (operation.toStatus === 'IN_PROGRESS' && booking.cancellationPending === true)) throw badResponse()
  return { operationId: operation.id, assignmentId: operation.assignmentId, bookingId: operation.bookingId,
    assignmentStatus: value.assignmentStatus, occurredAt: value.occurredAt, booking }
}

async function jsonBody(response) {
  if (!/\bapplication\/(?:[a-z0-9.+-]+\+)?json\b/i.test(response.headers.get('content-type') || '')) throw badResponse()
  const reader = response.body?.getReader()
  if (!reader) throw badResponse()
  const chunks = []
  let length = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > 1024 * 1024) { await reader.cancel(); throw badResponse() }
      chunks.push(value)
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))
  } catch (error) {
    if (error instanceof HttpError || error.name === 'AbortError') throw error
    throw badResponse()
  } finally { reader.releaseLock() }
}

export class OrderClient {
  #baseUrl
  #token
  #timeoutMs
  #fetch
  constructor({ baseUrl, token, timeoutMs = 5000 } = {}, { fetchImpl = fetch } = {}) {
    if (baseUrl !== undefined) {
      let parsed
      try { parsed = new URL(baseUrl) } catch { throw new TypeError('Invalid Order Service URL') }
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) throw new TypeError('Invalid Order Service URL')
      this.#baseUrl = parsed.toString().replace(/\/$/, '')
    }
    if (token !== undefined && (typeof token !== 'string' || !token.trim() || /[\r\n]/.test(token))) throw new TypeError('Invalid Order Service credential')
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000 || typeof fetchImpl !== 'function') throw new TypeError('Invalid Order Service client configuration')
    this.#token = token
    this.#timeoutMs = timeoutMs
    this.#fetch = fetchImpl
  }
  async #request(method, path, { body, actorUserId, key, notFound = false } = {}) {
    if (!this.#baseUrl || !this.#token) throw unavailable()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs)
    try {
      const response = await this.#fetch(this.#baseUrl + path, {
        method, redirect: 'error', signal: controller.signal,
        headers: { Accept: 'application/json', Authorization: 'Bearer ' + this.#token,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(actorUserId === undefined ? {} : { 'X-Actor-User-Id': String(actorUserId) }),
          ...(key === undefined ? {} : { 'Idempotency-Key': key }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      if (response.status >= 500 || response.status === 429 || [401, 403].includes(response.status)) {
        try { await response.body?.cancel() } catch { /* Preserve the sanitized status even if the upstream body fails. */ }
        throw response.status >= 500 || response.status === 429 ? unavailable() : badResponse()
      }
      const value = await jsonBody(response)
      if (notFound && response.status === 404 && value?.error?.code === 'TRANSITION_NOT_FOUND') return null
      if ([409, 422].includes(response.status) && record(value?.error) && Object.hasOwn(rejectionMessages, value.error.code)) {
        throw new HttpError(409, 'ORDER_REJECTED', rejectionMessages[value.error.code], { reason: value.error.code })
      }
      if (response.status !== 200) throw badResponse()
      return value
    } catch (error) {
      if (error instanceof HttpError) throw error
      throw unavailable()
    } finally { clearTimeout(timer) }
  }
  #path(operation) {
    return '/internal/v1/bookings/' + encodeURIComponent(operation.bookingId) + '/assignment-transitions/' + encodeURIComponent(operation.id)
  }
  #payload(operation) {
    return Object.fromEntries(['assignmentId', 'employeeId', 'actorUserId', 'fromStatus', 'toStatus'].map(key => [key, operation[key]]))
  }
  async getBookingContexts({ bookingIds, actorUserId }) {
    if (!Array.isArray(bookingIds) || !bookingIds.every(entityId) || !entityId(actorUserId)) throw new TypeError('Invalid booking context request')
    const ids = [...new Set(bookingIds.map(String))]
    if (!ids.length) return new Map()
    const value = await this.#request('POST', '/internal/v1/bookings/staff-context/batch', { body: { bookingIds: ids, actorUserId: String(actorUserId) } })
    if (!record(value) || !Array.isArray(value.bookings)) throw badResponse()
    const result = new Map()
    for (const item of value.bookings) {
      const parsed = context(item)
      if (!ids.includes(parsed.id) || result.has(parsed.id)) throw badResponse()
      result.set(parsed.id, parsed)
    }
    if (result.size !== ids.length) throw badResponse()
    return result
  }
  async getBookingDetail({ bookingId, actorUserId }) {
    if (!entityId(bookingId) || !entityId(actorUserId)) throw new TypeError('Invalid booking context request')
    const value = context(await this.#request('GET', '/internal/v1/bookings/' + encodeURIComponent(String(bookingId)) + '/staff-context', { actorUserId }))
    if (value.id !== String(bookingId)) throw badResponse()
    return value
  }
  async getAssignmentTransition(value) {
    const operation = operationInput(value)
    const query = new URLSearchParams(this.#payload(operation))
    const result = await this.#request('GET', this.#path(operation) + '?' + query, { actorUserId: operation.actorUserId, notFound: true })
    return result === null ? null : ack(result, operation)
  }
  async applyAssignmentTransition(value) {
    const operation = operationInput(value)
    return ack(await this.#request('PUT', this.#path(operation), { body: this.#payload(operation), actorUserId: operation.actorUserId, key: operation.id }), operation)
  }
  async ackAssignmentTransition(value) {
    const operation = operationInput(value)
    const result = await this.#request('POST', this.#path(operation) + '/acknowledgement', { body: this.#payload(operation), actorUserId: operation.actorUserId, key: operation.id })
    if (!record(result) || result.acknowledged !== true || !id(result.operationId) || !entityId(result.bookingId) || !entityId(result.assignmentId) || String(result.operationId) !== operation.id
      || String(result.assignmentId) !== operation.assignmentId || String(result.bookingId) !== operation.bookingId) throw badResponse()
    return { operationId: operation.id, assignmentId: operation.assignmentId, bookingId: operation.bookingId, acknowledged: true }
  }
  async listPendingTransitions({ limit = 20 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new TypeError('Invalid pending transition limit')
    const value = await this.#request('GET', '/internal/v1/assignment-transitions/pending?limit=' + limit)
    if (!record(value) || !Array.isArray(value.operations) || value.operations.length > limit) throw badResponse()
    const seen = new Set()
    return value.operations.map(item => {
      let parsed
      try { parsed = operationInput(item) } catch { throw badResponse() }
      if (seen.has(parsed.id)) throw badResponse()
      seen.add(parsed.id)
      return parsed
    })
  }
}
