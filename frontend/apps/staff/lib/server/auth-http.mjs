import { randomUUID } from 'node:crypto'
import { createStaffAuth, AuthBffError } from './auth-core.mjs'
import { loadStaffAuthConfig } from './config.mjs'

const MAX_BODY = 8192
const SID = /^[A-Za-z0-9_-]{43}$/
const fail = (status, code, message) => { throw new AuthBffError(status, code, message) }
const emptyCookie = config => cookie(config, '', 0)
function cookie(config, sid, maxAge) {
  return config.cookieName + '=' + sid + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + maxAge + (config.secureCookie ? '; Secure' : '')
}
function sidFrom(request, name) {
  const header = request.headers.get('cookie') || ''
  if (header.length > 16384) return undefined
  const values = header.split(';').map(value => value.trim()).filter(value => value.startsWith(name + '='))
  if (values.length !== 1) return undefined
  const sid = values[0].slice(name.length + 1)
  return SID.test(sid) ? sid : undefined
}
function guard(request, action, config) {
  const write = action !== 'session'
  if (request.method !== (write ? 'POST' : 'GET')) fail(405, 'METHOD_NOT_ALLOWED', 'Phương thức không được hỗ trợ.')
  const url = new URL(request.url)
  if (url.origin !== config.appOrigin || request.headers.get('host') && request.headers.get('host') !== url.host) fail(403, 'ORIGIN_DENIED', 'Nguồn yêu cầu không được cho phép.')
  const origin = request.headers.get('origin')
  if ((write || origin !== null) && origin !== config.appOrigin) fail(403, 'ORIGIN_DENIED', 'Nguồn yêu cầu không được cho phép.')
  const fetchSite = request.headers.get('sec-fetch-site')
  if (write && fetchSite && fetchSite !== 'same-origin') fail(403, 'ORIGIN_DENIED', 'Nguồn yêu cầu không được cho phép.')
  if (url.search) fail(400, 'INVALID_INPUT', 'Yêu cầu chứa tham số không được hỗ trợ.')
  if (write && request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') fail(415, 'JSON_REQUIRED', 'Vui lòng gửi dữ liệu JSON.')
}
async function jsonBody(request) {
  const declared = request.headers.get('content-length')
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY)) fail(413, 'BODY_TOO_LARGE', 'Dữ liệu vượt giới hạn.')
  const reader = request.body?.getReader()
  if (!reader) fail(400, 'INVALID_JSON', 'Dữ liệu JSON không hợp lệ.')
  let timer
  try {
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => { reader.cancel().catch(() => {}); reject(new AuthBffError(408, 'REQUEST_TIMEOUT', 'Yêu cầu đã quá thời gian chờ.')) }, 5000)
      timer.unref?.()
    })
    const read = async () => {
      const chunks = []; let length = 0
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        length += value.byteLength
        if (length > MAX_BODY) fail(413, 'BODY_TOO_LARGE', 'Dữ liệu vượt giới hạn.')
        chunks.push(Buffer.from(value))
      }
      try {
        const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))
        if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'INVALID_JSON', 'Dữ liệu JSON phải là object.')
        return value
      } catch (error) {
        if (error instanceof AuthBffError) throw error
        fail(400, 'INVALID_JSON', 'Dữ liệu JSON không hợp lệ.')
      }
    }
    return await Promise.race([read(), timeout])
  } finally { clearTimeout(timer); reader.cancel().catch(() => {}) }
}

/** Dedicated fixed Auth routes. This is never an arbitrary upstream proxy. */
export function createStaffAuthHttp({ configFactory = loadStaffAuthConfig, authFactory = createStaffAuth, now = Date.now } = {}) {
  return async function handle(request, action) {
    const requestId = randomUUID()
    const headers = new Headers({ 'Cache-Control': 'no-store, max-age=0', Pragma: 'no-cache', Expires: '0', Vary: 'Cookie', 'X-Content-Type-Options': 'nosniff', 'X-Request-Id': requestId })
    let config, authStarted = false
    const response = (data, status = 200) => Response.json(data, { status, headers })
    try {
      if (!['login', 'session', 'logout'].includes(action)) fail(404, 'NOT_FOUND', 'Không tìm thấy API.')
      config = configFactory()
      guard(request, action, config)
      const sid = sidFrom(request, config.cookieName)
      const auth = authFactory({ config })
      if (action === 'session') {
        authStarted = true
        return response({ session: await auth.inspect(sid) })
      }
      const input = await jsonBody(request)
      if (action === 'logout') {
        if (Object.keys(input).length) fail(400, 'INVALID_INPUT', 'Yêu cầu chứa trường không được hỗ trợ.')
        await auth.logout(sid)
        headers.set('Set-Cookie', emptyCookie(config))
        return response({ ok: true })
      }
      if (Object.keys(input).some(key => !['phone', 'password'].includes(key))) fail(400, 'INVALID_INPUT', 'Yêu cầu chứa trường không được hỗ trợ.')
      const result = await auth.login(input, sid)
      const maxAge = Math.floor((Date.parse(result.session.expiresAt) - now()) / 1000)
      if (!SID.test(result.sid) || !Number.isFinite(maxAge) || maxAge < 1) {
        if (SID.test(result.sid)) await auth.logout(result.sid)
        fail(503, 'SESSION_UNAVAILABLE', 'Chưa thể lưu phiên đăng nhập. Vui lòng thử lại.')
      }
      headers.set('Set-Cookie', cookie(config, result.sid, maxAge))
      return response({ session: result.session })
    } catch (error) {
      const known = error instanceof AuthBffError
      const status = known ? error.status : 503
      const code = known ? error.code : 'SESSION_UNAVAILABLE'
      if (config && authStarted && [401, 403].includes(status)) headers.set('Set-Cookie', emptyCookie(config))
      if (status === 401) headers.set('WWW-Authenticate', 'Session')
      if ([429, 503].includes(status)) headers.set('Retry-After', String(known && Number.isSafeInteger(error.retryAfter) && error.retryAfter > 0 ? Math.min(error.retryAfter, 3600) : status === 429 ? 60 : 5))
      return response({ error: { code, message: known ? error.message : 'Chưa thể xử lý phiên đăng nhập. Vui lòng thử lại.' }, requestId }, status)
    }
  }
}
export const handleStaffAuth = createStaffAuthHttp()
