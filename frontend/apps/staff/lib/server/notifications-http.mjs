import { randomUUID } from 'node:crypto'
import { AuthBffError, createStaffAuth } from './auth-core.mjs'
import { loadStaffJobsConfig } from './jobs-config.mjs'
import { parseMarkRead, parseNotificationId, parseNotificationsPage, parseNotificationsQuery, parseReadAll, parseUnreadCount } from './notifications-contract.mjs'

const fail = (status, code, message) => { throw new AuthBffError(status, code, message) }
const unavailable = () => new AuthBffError(503, 'STAFF_UNAVAILABLE', 'Dịch vụ thông báo tạm thời gián đoạn. Vui lòng thử lại.', 5)
const invalid = () => new AuthBffError(502, 'STAFF_INVALID_RESPONSE', 'Chưa thể đọc dữ liệu thông báo. Vui lòng thử lại hoặc liên hệ người quản lý.')
function sessionId(request, name) {
  const cookies = request.headers.get('cookie') || ''
  if (cookies.length > 16384) return undefined
  const parts = cookies.split(';').map(part => part.trim()).filter(part => part.startsWith(name + '='))
  if (parts.length !== 1) return undefined
  const sid = parts[0].slice(name.length + 1)
  return /^[A-Za-z0-9_-]{43}$/.test(sid) && Buffer.from(sid, 'base64url').toString('base64url') === sid ? sid : undefined
}

async function readJson(response) {
  if (response.status !== 200 || !(response.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) throw invalid()
  const length = response.headers.get('content-length')
  if (length && (!/^\d+$/.test(length) || Number(length) > 1048576)) throw invalid()
  const reader = response.body?.getReader()
  if (!reader) throw invalid()
  const chunks = []; let size = 0
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      size += part.value.byteLength
      if (size > 1048576) throw invalid()
      chunks.push(part.value)
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))) } catch { throw invalid() }
}

async function upstream(config, token, method, path, fetchImpl, notFoundIsMissing) {
  const url = new URL(path, config.staffUrl)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.jobsTimeoutMs)
  try {
    const response = await fetchImpl(url, {
      method, headers: { Accept: 'application/json', Authorization: 'Bearer ' + token },
      redirect: 'error', cache: 'no-store', signal: controller.signal,
    })
    if (response.status === 401) fail(401, 'SESSION_EXPIRED', 'Phiên đăng nhập không còn hợp lệ. Vui lòng đăng nhập lại.')
    if (response.status === 403) fail(403, 'STAFF_ACCESS_DENIED', 'Tài khoản không được phép xem thông báo. Vui lòng liên hệ người quản lý.')
    if (response.status === 404) {
      if (notFoundIsMissing) fail(404, 'NOTIFICATION_NOT_FOUND', 'Không tìm thấy thông báo thuộc tài khoản của bạn.')
      invalid()
    }
    if (response.status === 429) fail(429, 'STAFF_RATE_LIMITED', 'Vui lòng chờ trước khi tải lại thông báo.')
    if (response.status === 400) fail(400, 'VALIDATION_ERROR', 'Yêu cầu thông báo chưa được chấp nhận. Vui lòng kiểm tra lại.')
    if (response.status >= 500) throw unavailable()
    return await readJson(response)
  } catch (error) {
    if (error instanceof AuthBffError) throw error
    throw unavailable()
  } finally { clearTimeout(timer); controller.abort() }
}

/** Fixed Staff notification routes only; no arbitrary upstream path or user id is accepted. */
export function createStaffNotificationsHttp({ configFactory = loadStaffJobsConfig, authFactory = createStaffAuth, fetchImpl = fetch, now = Date.now } = {}) {
  return async request => {
    const requestId = randomUUID()
    const headers = new Headers({ 'Cache-Control': 'no-store, max-age=0', Pragma: 'no-cache', Expires: '0', Vary: 'Cookie', 'X-Content-Type-Options': 'nosniff', 'X-Request-Id': requestId })
    let config, auth, sid, authStarted = false
    try {
      config = configFactory()
      const url = new URL(request.url)
      const list = url.pathname === '/api/staff/notifications'
      const unread = url.pathname === '/api/staff/notifications/unread-count'
      const readAll = url.pathname === '/api/staff/notifications/read-all'
      const one = /^\/api\/staff\/notifications\/([^/]+)\/read$/.exec(url.pathname)
      if (!list && !unread && !readAll && !one) fail(404, 'NOT_FOUND', 'Không tìm thấy API.')
      const method = request.method
      const allowed = list || unread ? 'GET' : 'PATCH'
      if (method !== allowed) { headers.set('Allow', allowed); fail(405, 'METHOD_NOT_ALLOWED', 'Phương thức không được hỗ trợ.') }
      const origin = request.headers.get('origin'), site = request.headers.get('sec-fetch-site')
      if (url.origin !== config.appOrigin || (request.headers.get('host') && request.headers.get('host') !== url.host)
        || (method === 'PATCH' ? origin !== config.appOrigin : origin !== null && origin !== config.appOrigin)
        || (site !== null && site !== 'same-origin')) fail(403, 'ORIGIN_DENIED', 'Nguồn yêu cầu không được cho phép.')
      const accountId = request.headers.get('X-Staff-Account-Id')
      if (accountId !== null && (!/^[1-9]\d{0,18}$/.test(accountId) || BigInt(accountId) > 9_223_372_036_854_775_807n)) fail(400, 'VALIDATION_ERROR', 'Danh tính phiên chưa hợp lệ.')

      let path, parse
      if (list) {
        const query = parseNotificationsQuery(url.searchParams)
        const params = new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize) })
        if (query.unreadOnly) params.set('unreadOnly', 'true')
        path = '/api/v1/staff/me/notifications?' + params.toString()
        parse = body => parseNotificationsPage(body, query)
      } else if (unread) {
        if (url.search) fail(400, 'VALIDATION_ERROR', 'Yêu cầu chứa tham số không được hỗ trợ.')
        path = '/api/v1/staff/me/notifications/unread-count'
        parse = parseUnreadCount
      } else if (readAll) {
        if (url.search) fail(400, 'VALIDATION_ERROR', 'Yêu cầu chứa tham số không được hỗ trợ.')
        path = '/api/v1/staff/me/notifications/read-all'
        parse = parseReadAll
      } else {
        if (url.search) fail(400, 'VALIDATION_ERROR', 'Yêu cầu chứa tham số không được hỗ trợ.')
        let decoded
        try { decoded = decodeURIComponent(one[1]) } catch { fail(400, 'VALIDATION_ERROR', 'Mã thông báo không hợp lệ.') }
        path = '/api/v1/staff/me/notifications/' + parseNotificationId(decoded) + '/read'
        parse = parseMarkRead
      }

      sid = sessionId(request, config.cookieName)
      auth = authFactory({ config, now }); authStarted = true
      if (accountId !== null) {
        const session = await auth.inspect(sid)
        if (session.user.id !== accountId) fail(409, 'STAFF_SESSION_CHANGED', 'Tài khoản đăng nhập đã thay đổi. Vui lòng tải lại thông báo.')
      }
      const result = await auth.withAccessToken(sid, async token => parse(await upstream(config, token, method, path, fetchImpl, Boolean(one))))
      return Response.json(result, { headers })
    } catch (error) {
      const known = error instanceof AuthBffError
      let status = known ? error.status : 503
      let code = known ? error.code : 'STAFF_UNAVAILABLE'
      let message = known ? error.message : 'Chưa thể tải thông báo. Vui lòng thử lại.'
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
export const handleStaffNotifications = createStaffNotificationsHttp()
