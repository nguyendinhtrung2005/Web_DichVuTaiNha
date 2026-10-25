import { AuthBffError } from './auth-core.mjs'
import { parseJobDetailResponse } from './job-detail-contract.mjs'
import { STATUS_STEPS, currentStatus, parseStatusResponse, publicOperation, statusView } from './status-contract.mjs'

const fail = (status, code, message) => { throw new AuthBffError(status, code, message) }
const unavailable = () => new AuthBffError(503, 'STAFF_UNAVAILABLE', 'Dịch vụ công việc tạm thời gián đoạn. Vui lòng kiểm tra lại trước khi thử tiếp.', 5)
const invalid = () => new AuthBffError(502, 'STAFF_INVALID_RESPONSE', 'Chưa thể xác minh phản hồi. Vui lòng kiểm tra lại thao tác đã lưu.')
const messages = {
  INVALID_TRANSITION: 'Trạng thái hiện tại không cho phép chuyển bước này. Vui lòng tải lại thông tin.',
  ASSIGNMENT_CHANGED: 'Phân công đã thay đổi. Vui lòng tải lại thông tin hoặc liên hệ người quản lý.',
  RECONCILIATION_CONFLICT: 'Thao tác cần được đối chiếu. Vui lòng giữ thao tác hiện tại và liên hệ người quản lý.',
  RECONCILIATION_REQUIRED: 'Kết quả đang cần đối chiếu giữa các dịch vụ. Chưa thể xác nhận hoàn tất.',
  ORDER_UNAVAILABLE: 'Dịch vụ đơn hàng tạm thời gián đoạn. Vui lòng kiểm tra lại thao tác đã lưu.',
  ORDER_BAD_RESPONSE: 'Chưa thể xác minh phản hồi từ dịch vụ đơn hàng.',
  ORDER_REJECTED: 'Dịch vụ đơn hàng chưa chấp nhận thao tác. Vui lòng kiểm tra lại thông tin.',
  AUTH_UNAVAILABLE: 'Dịch vụ xác thực tạm thời gián đoạn. Vui lòng thử kiểm tra lại sau.',
}

/** Fixed Staff endpoints only. This module never contacts Order's internal APIs. */
async function staffRequest(config, token, assignmentId, fetchImpl, mutation) {
  const controller = new AbortController()
  let timer
  const work = async () => {
    const response = await fetchImpl(new URL('/api/v1/staff/me/jobs/' + assignmentId + (mutation ? '/status' : ''), config.staffUrl), {
      method: mutation ? 'PATCH' : 'GET',
      headers: { Accept: 'application/json', Authorization: 'Bearer ' + token,
        ...(mutation ? { 'Content-Type': 'application/json', 'Idempotency-Key': mutation.key } : {}) },
      ...(mutation ? { body: JSON.stringify({ status: mutation.status }) } : {}),
      cache: 'no-store', redirect: 'error', signal: controller.signal,
    })
    if (response.status === 401) fail(401, 'SESSION_EXPIRED', 'Phiên đăng nhập không còn hợp lệ. Vui lòng đăng nhập lại.')
    if (response.status === 403) fail(403, 'STAFF_ACCESS_DENIED', 'Tài khoản hiện không được phép thực hiện thao tác này.')
    if (response.status === 404) fail(404, 'JOB_NOT_FOUND', 'Không tìm thấy công việc được phân công cho bạn.')
    if (response.status === 429) fail(429, 'STAFF_RATE_LIMITED', 'Vui lòng chờ trước khi kiểm tra lại thao tác.')
    if (!(response.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) {
      if (response.status >= 500) throw unavailable()
      throw invalid()
    }
    const limit = mutation ? 32768 : 1048576
    const length = response.headers.get('content-length')
    if (length && (!/^\d+$/.test(length) || Number(length) > limit)) throw invalid()
    const reader = response.body?.getReader()
    if (!reader) throw invalid()
    const chunks = []; let size = 0
    try {
      while (true) {
        const part = await reader.read()
        if (part.done) break
        size += part.value.byteLength
        if (size > limit) throw invalid()
        chunks.push(part.value)
      }
    } finally { void reader.cancel().catch(() => {}); reader.releaseLock() }
    let body
    try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))) } catch { throw invalid() }
    if (response.status === 200 || (mutation && response.status === 202)) return { status: response.status, body }
    const rawCode = body?.error?.code
    if (response.status === 400) fail(400, 'VALIDATION_ERROR', 'Dữ liệu thao tác không hợp lệ. Vui lòng kiểm tra lại.')
    if (typeof rawCode === 'string' && Object.hasOwn(messages, rawCode) && [409, 422, 502, 503].includes(response.status)) fail(response.status, rawCode, messages[rawCode])
    if ([409, 422].includes(response.status)) fail(response.status, 'TRANSITION_REJECTED', 'Trạng thái công việc đã thay đổi hoặc không cho phép thao tác này.')
    if (response.status >= 500) throw unavailable()
    throw invalid()
  }
  try {
    return await Promise.race([work(), new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(unavailable()) }, mutation ? config.statusTimeoutMs : config.jobsTimeoutMs)
    })])
  } catch (error) {
    if (error instanceof AuthBffError) throw error
    throw unavailable()
  } finally { clearTimeout(timer); controller.abort() }
}

/** Coordinates a real Staff mutation with an immutable local recovery journal. */
export function createStatusService({ config, auth, store, fetchImpl = fetch }) {
  const readCurrent = async (token, id) => currentStatus(parseJobDetailResponse((await staffRequest(config, token, id, fetchImpl)).body, id).data)
  async function entriesFor(userId, id) {
    return (await store.list(userId, id)).map(entry => ({ ...entry, receipt: entry.receipt
      ? { httpStatus: entry.receipt.httpStatus, data: parseStatusResponse({ data: entry.receipt.data }, entry.receipt.httpStatus, entry.record) } : null }))
  }
  return Object.freeze({
    async read(sid, id) {
      const session = await auth.inspect(sid)
      return auth.withAccessToken(sid, async token => {
        const current = await readCurrent(token, id)
        return statusView(current, await entriesFor(session.user.id, id))
      })
    },
    async update(sid, id, target, key) {
      let active, current, sent = false
      try {
        const session = await auth.inspect(sid)
        return await auth.withAccessToken(sid, async token => {
          current = await readCurrent(token, id)
          const entries = await entriesFor(session.user.id, id)
          const view = statusView(current, entries)
          active = entries.find(entry => entry.record.requestedStatus === target)
          if (view.blockedReason === 'ASSIGNMENT_CHANGED') fail(409, 'ASSIGNMENT_CHANGED', 'Phân công đã thay đổi. Cần người quản lý đối chiếu thao tác đã lưu.')
          if (entries.some(entry => entry.record.idempotencyKey === key && entry.record.requestedStatus !== target)) {
            fail(409, 'IDEMPOTENCY_CONFLICT', 'Mã thao tác đã được sử dụng cho một bước khác.')
          }
          if (active) {
            if (active.record.idempotencyKey !== key) fail(409, 'OPERATION_EXISTS', 'Đã có thao tác cho bước này. Vui lòng tiếp tục bằng thao tác đã lưu.')
            if (active.receipt?.httpStatus === 200) return { status: 200, body: { data: active.receipt.data, operation: publicOperation(active, current) } }
            if (!view.canRetry || view.operation?.idempotencyKey !== key) fail(409, 'TRANSITION_BLOCKED', 'Chưa thể thử lại thao tác. Vui lòng tải lại thông tin hoặc liên hệ người quản lý.')
          } else {
            if (view.allowedStatus !== target) {
              active = entries.find(entry => entry.receipt?.httpStatus !== 200)
              fail(409, 'TRANSITION_BLOCKED', 'Chưa thể chuyển bước này. Vui lòng đối chiếu thao tác trước và trạng thái hiện tại.')
            }
            const ensured = await store.ensure({ userId: session.user.id, assignmentId: id, orderId: current.orderId,
              assignedAt: current.assignedAt, requestedStatus: target, fromStatus: STATUS_STEPS[STATUS_STEPS.indexOf(target) - 1], idempotencyKey: key })
            active = { record: ensured.record, receipt: null }
            if (active.record.idempotencyKey !== key) fail(409, 'OPERATION_EXISTS', 'Một thao tác khác đã được ghi nhận. Vui lòng kiểm tra lại thao tác đã lưu.')
            if (active.record.orderId !== current.orderId || active.record.assignedAt !== current.assignedAt) fail(409, 'ASSIGNMENT_CHANGED', 'Phân công đã thay đổi. Cần đối chiếu trước khi tiếp tục.')
          }
          // The recovery context must be durable BEFORE the first outgoing PATCH.
          sent = true
          const response = await staffRequest(config, token, id, fetchImpl, { status: target, key })
          const data = parseStatusResponse(response.body, response.status, active.record)
          await store.saveReceipt(active.record, response.status, data)
          // A late 202 must not downgrade a concurrent, already confirmed 200.
          active = (await entriesFor(session.user.id, id)).find(entry => entry.record.requestedStatus === target)
          if (!active?.receipt) throw invalid()
          return { status: active.receipt.httpStatus, body: { data: active.receipt.data, operation: publicOperation(active, current) } }
        })
      } catch (error) {
        const safe = error instanceof AuthBffError ? error : unavailable()
        safe.outcome = sent ? 'unknown' : 'not_sent'
        if (active && current) safe.operation = publicOperation(active, current)
        throw safe
      }
    },
  })
}
