import { randomUUID } from 'node:crypto'
import { AuthBffError, createStaffAuth } from './auth-core.mjs'
import { loadStaffJobsConfig } from './jobs-config.mjs'
import { parseReviewsPayload, parseReviewsQuery } from '../../../../packages/ui/src/components/staff/staff-reviews-contract.mjs'

const fail = (status, code, message) => { throw new AuthBffError(status, code, message) }
const invalid = () => fail(502, 'STAFF_INVALID_RESPONSE', 'Dữ liệu đánh giá chưa hợp lệ. Vui lòng thử lại hoặc liên hệ người quản lý.')
const unavailable = () => fail(503, 'REVIEWS_UNAVAILABLE', 'Chưa thể kết nối dịch vụ đánh giá. Vui lòng thử lại.')
function sessionId(request, name) {
  const cookie = request.headers.get('cookie') || ''
  if (cookie.length > 16384) return undefined
  const matches = cookie.split(';').map(p => p.trim()).filter(p => p.startsWith(name + '='))
  if (matches.length !== 1) return undefined
  const sid = matches[0].slice(name.length + 1)
  return /^[A-Za-z0-9_-]{43}$/.test(sid) && Buffer.from(sid, 'base64url').toString('base64url') === sid ? sid : undefined
}
async function readReviews(config, token, query, fetchImpl, signal) {
  const url = new URL('/api/v1/staff/me/reviews', config.staffUrl)
  for (const key of ['from', 'to', 'rating', 'page', 'pageSize']) if (query[key] !== null) url.searchParams.set(key, String(query[key]))
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), config.jobsTimeoutMs)
  const abortRequest = () => controller.abort()
  signal?.addEventListener('abort', abortRequest, { once: true })
  if (signal?.aborted) controller.abort()
  let response
  try {
    if (controller.signal.aborted) unavailable()
    response = await fetchImpl(url, { method: 'GET', headers: { Accept: 'application/json', Authorization: 'Bearer ' + token }, cache: 'no-store', redirect: 'error', signal: controller.signal })
    if (response.status === 401) fail(401, 'SESSION_EXPIRED', 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.')
    if (response.status === 403) fail(403, 'STAFF_ACCESS_DENIED', 'Tài khoản không có quyền xem đánh giá.')
    if (response.status === 404 || response.status === 501) fail(503, 'REVIEWS_NOT_AVAILABLE', 'Review API chưa được cung cấp.')
    if (response.status === 429) fail(429, 'STAFF_RATE_LIMITED', 'Vui lòng chờ trước khi tải lại đánh giá.')
    if (response.status >= 500) unavailable()
    if (response.status !== 200 || response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') invalid()
    const reader = response.body?.getReader()
    if (!reader) invalid()
    const cancelReader = () => { void reader.cancel().catch(() => {}) }
    controller.signal.addEventListener('abort', cancelReader, { once: true })
    const chunks = []; let size = 0
    try {
      if (controller.signal.aborted) { cancelReader(); unavailable() }
      while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 262144) invalid(); chunks.push(part.value) }
      if (controller.signal.aborted) unavailable()
    } finally { controller.signal.removeEventListener('abort', cancelReader); await reader.cancel().catch(() => {}); reader.releaseLock() }
    let body
    try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))) } catch { invalid() }
    const parsed = parseReviewsPayload(body, query)
    if (!parsed) invalid()
    return parsed
  } catch (error) { if (error instanceof AuthBffError) throw error; unavailable() }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', abortRequest); controller.abort(); await response?.body?.cancel().catch(() => {}) }
}

/** Fixed, current-employee read only. No review author identity or booking data is exposed. */
export function createStaffReviewsHttp({ configFactory = loadStaffJobsConfig, authFactory = createStaffAuth, fetchImpl = fetch, env = process.env, now = Date.now } = {}) {
  return async request => {
    const requestId = randomUUID(), headers = new Headers({ 'Cache-Control': 'no-store, max-age=0', Pragma: 'no-cache', Vary: 'Cookie', 'X-Content-Type-Options': 'nosniff', 'X-Request-Id': requestId })
    let config, auth, sid, authStarted = false
    try {
      config = configFactory()
      const url = new URL(request.url)
      if (url.pathname !== '/api/staff/reviews') fail(404, 'NOT_FOUND', 'Không tìm thấy API.')
      if (request.method !== 'GET') { headers.set('Allow', 'GET'); fail(405, 'METHOD_NOT_ALLOWED', 'Phương thức không được hỗ trợ.') }
      const origin = request.headers.get('origin'), site = request.headers.get('sec-fetch-site')
      if (url.origin !== config.appOrigin || request.headers.get('host') && request.headers.get('host') !== url.host
        || origin !== null && origin !== config.appOrigin || site !== null && site !== 'same-origin') fail(403, 'ORIGIN_DENIED', 'Nguồn yêu cầu không được cho phép.')
      const query = parseReviewsQuery(url.searchParams)
      if (!query) fail(400, 'VALIDATION_ERROR', 'Bộ lọc đánh giá chưa hợp lệ.')
      const accountId = request.headers.get('X-Staff-Account-Id')
      if (accountId !== null && (!/^[1-9]\d{0,18}$/.test(accountId) || BigInt(accountId) > 9223372036854775807n)) fail(400, 'VALIDATION_ERROR', 'Danh tính phiên chưa hợp lệ.')
      sid = sessionId(request, config.cookieName); auth = authFactory({ config, now }); authStarted = true
      if (accountId !== null && (await auth.inspect(sid)).user.id !== accountId) fail(409, 'STAFF_SESSION_CHANGED', 'Tài khoản đăng nhập đã thay đổi. Vui lòng tải lại trang.')
      const result = await auth.withAccessToken(sid, async token => {
        if (env.STAFF_REVIEWS_API_ENABLED !== 'true') fail(503, 'REVIEWS_NOT_AVAILABLE', 'Review API chưa được cấu hình. Không có đánh giá hoặc huy hiệu chính thức để hiển thị.')
        return readReviews(config, token, query, fetchImpl, request.signal)
      }, { retryOnExpiredToken: true })
      return Response.json(result, { headers })
    } catch (error) {
      let status = error instanceof AuthBffError ? error.status : 503
      let code = error instanceof AuthBffError ? error.code : 'REVIEWS_UNAVAILABLE'
      let message = error instanceof AuthBffError ? error.message : 'Chưa thể tải đánh giá. Vui lòng thử lại.'
      if (config && authStarted && [401, 403].includes(status)) {
        try { await auth.logout(sid) } catch { status = 503; code = 'SESSION_STORE_UNAVAILABLE'; message = 'Chưa thể kiểm tra phiên đăng nhập. Vui lòng thử lại.' }
        headers.set('Set-Cookie', config.cookieName + '=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' + (config.secureCookie ? '; Secure' : ''))
      }
      if (status === 401) headers.set('WWW-Authenticate', 'Session')
      if ([429, 503].includes(status)) headers.set('Retry-After', status === 429 ? '60' : '5')
      return Response.json({ error: { code, message }, requestId }, { status, headers })
    }
  }
}
export const handleStaffReviews = createStaffReviewsHttp()
