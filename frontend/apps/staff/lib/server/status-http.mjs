import { randomUUID } from 'node:crypto'
import { AuthBffError, createStaffAuth } from './auth-core.mjs'
import { parseAssignmentId } from './job-detail-contract.mjs'
import { loadStaffStatusConfig } from './status-config.mjs'
import { parseStatusInput } from './status-contract.mjs'
import { createStatusService } from './status-core.mjs'
import { createStatusStore } from './status-store.mjs'

const fail = (status, code, message) => { throw new AuthBffError(status, code, message) }
function sessionId(request, name) {
  const value = request.headers.get('cookie') || ''
  if (value.length > 16384) return undefined
  const matches = value.split(';').map(part => part.trim()).filter(part => part.startsWith(name + '='))
  if (matches.length !== 1) return undefined
  const sid = matches[0].slice(name.length + 1)
  return /^[A-Za-z0-9_-]{43}$/.test(sid) && Buffer.from(sid, 'base64url').toString('base64url') === sid ? sid : undefined
}
async function body(request) {
  if ((request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase() !== 'application/json') {
    fail(415, 'UNSUPPORTED_MEDIA_TYPE', 'Yêu cầu phải sử dụng JSON.')
  }
  const length = request.headers.get('content-length')
  if (length && !/^\d+$/.test(length)) fail(400, 'VALIDATION_ERROR', 'Kích thước yêu cầu không hợp lệ.')
  if (length && Number(length) > 4096) fail(413, 'PAYLOAD_TOO_LARGE', 'Nội dung yêu cầu quá lớn.')
  const reader = request.body?.getReader()
  if (!reader) fail(400, 'VALIDATION_ERROR', 'Nội dung yêu cầu không hợp lệ.')
  let timer
  const read = async () => {
    const chunks = []; let size = 0
    while (true) {
      const part = await reader.read()
      if (part.done) break
      size += part.value.byteLength
      if (size > 4096) fail(413, 'PAYLOAD_TOO_LARGE', 'Nội dung yêu cầu quá lớn.')
      chunks.push(part.value)
    }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))) }
    catch { fail(400, 'VALIDATION_ERROR', 'Nội dung yêu cầu không hợp lệ.') }
  }
  try {
    return await Promise.race([read(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new AuthBffError(408, 'REQUEST_TIMEOUT', 'Chưa nhận đủ nội dung yêu cầu.')), 5000)
    })])
  } finally { clearTimeout(timer); void reader.cancel().catch(() => {}); reader.releaseLock() }
}

/** Staff-specific fixed route. GET only inspects; PATCH is always explicit and CSRF checked. */
export function createStaffStatusHttp({ configFactory = loadStaffStatusConfig, authFactory = createStaffAuth,
  storeFactory = createStatusStore, fetchImpl = fetch, now = Date.now } = {}) {
  return async request => {
    const requestId = randomUUID()
    const headers = new Headers({ 'Cache-Control': 'no-store, max-age=0', Pragma: 'no-cache', Expires: '0',
      Vary: 'Cookie', 'X-Content-Type-Options': 'nosniff', 'X-Request-Id': requestId })
    let config, auth, sid, authStarted = false
    try {
      config = configFactory()
      if (!['GET', 'PATCH'].includes(request.method)) {
        headers.set('Allow', 'GET, PATCH'); fail(405, 'METHOD_NOT_ALLOWED', 'Phương thức không được hỗ trợ.')
      }
      const url = new URL(request.url), matched = /^\/api\/staff\/jobs\/([^/]+)\/status$/.exec(url.pathname)
      if (!matched) fail(404, 'NOT_FOUND', 'Không tìm thấy API.')
      const origin = request.headers.get('origin'), site = request.headers.get('sec-fetch-site')
      if (url.origin !== config.appOrigin || (request.headers.get('host') && request.headers.get('host') !== url.host)
        || (request.method === 'PATCH' ? origin !== config.appOrigin : origin !== null && origin !== config.appOrigin)
        || (site !== null && site !== 'same-origin')) fail(403, 'ORIGIN_DENIED', 'Nguồn yêu cầu không được cho phép.')
      if (url.search) fail(400, 'VALIDATION_ERROR', 'Yêu cầu chứa tham số không được hỗ trợ.')
      let decoded
      try { decoded = decodeURIComponent(matched[1]) } catch { fail(400, 'VALIDATION_ERROR', 'Mã phân công không hợp lệ.') }
      const id = parseAssignmentId(decoded)
      const input = request.method === 'PATCH' ? parseStatusInput(await body(request), request.headers.get('idempotency-key')) : null
      sid = sessionId(request, config.cookieName)
      auth = authFactory({ config, now }); authStarted = true
      const service = createStatusService({ config, auth, store: storeFactory({ config, now }), fetchImpl })
      if (input) {
        const result = await service.update(sid, id, input.status, input.key)
        return Response.json(result.body, { status: result.status, headers })
      }
      return Response.json(await service.read(sid, id), { headers })
    } catch (error) {
      const known = error instanceof AuthBffError
      let status = known ? error.status : 503
      let code = known ? error.code : 'STAFF_UNAVAILABLE'
      let message = known ? error.message : 'Chưa thể xử lý thao tác. Vui lòng kiểm tra lại trước khi thử tiếp.'
      if (config && authStarted && [401, 403].includes(status)) {
        try { await auth.logout(sid) } catch { status = 503; code = 'SESSION_STORE_UNAVAILABLE'; message = 'Chưa thể kiểm tra phiên đăng nhập. Vui lòng thử lại.' }
        headers.set('Set-Cookie', config.cookieName + '=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' + (config.secureCookie ? '; Secure' : ''))
      }
      if (status === 401) headers.set('WWW-Authenticate', 'Session')
      if ([429, 503].includes(status)) headers.set('Retry-After', status === 429 ? '60' : '5')
      return Response.json({ error: { code, message, outcome: known && error.outcome === 'unknown' ? 'unknown' : 'not_sent' },
        ...(known && error.operation ? { operation: error.operation } : {}), requestId }, { status, headers })
    }
  }
}
export const handleStaffStatus = createStaffStatusHttp()
