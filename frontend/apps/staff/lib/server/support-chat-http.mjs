import { createHash, randomUUID } from 'node:crypto'
import { AuthBffError, createStaffAuth } from './auth-core.mjs'
import { loadStaffSupportChatConfig } from './support-chat-config.mjs'
import { supportProviderAnswer, supportProviderPayload } from './support-chat-provider.mjs'
import { STAFF_SUPPORT_POLICY, STAFF_USAGE_HELP } from '../../../../packages/ui/src/components/staff/staff-support-questions.mjs'
import { STAFF_CONVERSATION_POLICY, STAFF_CONVERSATION_LIMITS as limits, validateSupportText, supportSensitiveContent, supportPromptOverride } from '../../../../packages/ui/src/components/staff/staff-support-conversation.mjs'
import { staffSupportConversations } from './support-chat-context.mjs'

const fail = (status, code, message) => { throw new AuthBffError(status, code, message) }
const unavailable = () => fail(503, 'SUPPORT_AI_UNAVAILABLE', 'Trợ lý AI chưa được cấu hình hoặc tạm thời gián đoạn. Bạn vẫn có thể xem FAQ.')
const providerFailure = code => fail(503, code, 'Chưa thể nhận phản hồi từ nhà cung cấp AI. Bạn vẫn có thể xem FAQ.')
const questions = new Map(STAFF_USAGE_HELP.map(question => [question.id, question]))

/** Per-process, bounded abuse protection. Multi-instance deployments also need a shared edge limit. */
export function createSupportChatLimiter({ now = Date.now, maxSessions = 1000 } = {}) {
  const sessions = new Map()
  let global = { until: 0, count: 0 }, active = 0
  return {
    acquire(sid) {
      const time = now(), key = createHash('sha256').update(sid).digest('hex')
      for (const [id, value] of sessions) if (value.until <= time && !value.active) sessions.delete(id)
      let value = sessions.get(key)
      if (!value) {
        if (sessions.size >= maxSessions) fail(429, 'SUPPORT_RATE_LIMITED', 'Trợ lý đang bận. Vui lòng chờ một phút rồi thử lại.')
        value = { until: time + 60000, count: 0, active: false }; sessions.set(key, value)
      }
      if (value.until <= time) { value.until = time + 60000; value.count = 0 }
      if (global.until <= time) global = { until: time + 60000, count: 0 }
      if (value.active || value.count >= 5 || global.count >= 30 || active >= 4) fail(429, 'SUPPORT_RATE_LIMITED', 'Vui lòng chờ trước khi gửi thêm câu hỏi.')
      value.count++; value.active = true; global.count++; active++
      let released = false
      return () => { if (!released) { released = true; value.active = false; active-- } }
    },
  }
}

function sessionId(request, name) {
  const cookie = request.headers.get('cookie') || ''
  if (cookie.length > 16384) return undefined
  const values = cookie.split(';').map(value => value.trim()).filter(value => value.startsWith(name + '='))
  if (values.length !== 1) return undefined
  const sid = values[0].slice(name.length + 1)
  return /^[A-Za-z0-9_-]{43}$/.test(sid) && Buffer.from(sid, 'base64url').toString('base64url') === sid ? sid : undefined
}

async function boundedJson(body, maxBytes, signal) {
  const reader = body?.getReader()
  if (!reader) fail(400, 'INVALID_JSON', 'Dữ liệu JSON không hợp lệ.')
  const abort = () => { void reader.cancel().catch(() => {}) }
  signal.addEventListener('abort', abort, { once: true })
  const chunks = []; let bytes = 0
  try {
    if (signal.aborted) throw Error('ABORTED')
    while (true) {
      const part = await reader.read()
      if (signal.aborted) throw Error('ABORTED')
      if (part.done) break
      bytes += part.value.byteLength
      if (bytes > maxBytes) fail(413, 'BODY_TOO_LARGE', 'Nội dung vượt giới hạn cho phép.')
      chunks.push(Buffer.from(part.value))
    }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))) }
    catch { fail(400, 'INVALID_JSON', 'Dữ liệu JSON không hợp lệ.') }
  } finally { signal.removeEventListener('abort', abort); void reader.cancel().catch(() => {}); reader.releaseLock() }
}

async function providerAnswer(chat, question, fetchImpl, requestSignal) {
  const controller = new AbortController(), abort = () => controller.abort()
  const timer = setTimeout(abort, chat.timeoutMs)
  requestSignal.addEventListener('abort', abort, { once: true })
  let response
  try {
    if (requestSignal.aborted) controller.abort()
    response = await fetchImpl(chat.endpoint, {
      method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: 'Bearer ' + chat.apiKey },
      body: JSON.stringify(supportProviderPayload(chat, question)),
      redirect: 'error', cache: 'no-store', signal: controller.signal,
    })
    if (response.status === 401) providerFailure('SUPPORT_PROVIDER_AUTH_FAILED')
    if (response.status === 403) providerFailure('SUPPORT_PROVIDER_FORBIDDEN')
    if (response.status === 404) providerFailure('SUPPORT_PROVIDER_MODEL_UNAVAILABLE')
    if (response.status === 429) {
      let quota = false
      if (response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() === 'application/json') {
        const payload = await boundedJson(response.body, 16384, controller.signal)
        quota = payload?.error?.type === 'insufficient_quota' || ['insufficient_quota', 'credit_balance_exhausted', 'project_spend_limit_exceeded', 'organization_spend_limit_exceeded', 'organization_usage_limit_exceeded'].includes(payload?.error?.code)
      }
      providerFailure(quota ? 'SUPPORT_PROVIDER_QUOTA_EXCEEDED' : 'SUPPORT_PROVIDER_RATE_LIMITED')
    }
    if (response.status !== 200) providerFailure(response.status >= 500 ? 'SUPPORT_PROVIDER_UNAVAILABLE' : 'SUPPORT_PROVIDER_REQUEST_REJECTED')
    if (response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') unavailable()
    const length = response.headers.get('content-length')
    if (length && (!/^\d+$/.test(length) || Number(length) > 16384)) unavailable()
    const body = await boundedJson(response.body, 16384, controller.signal)
    const answer = supportProviderAnswer(chat, body)
    if (answer.includes(chat.apiKey)) unavailable()
    return answer
  } catch (error) {
    if (error instanceof AuthBffError && error.status === 503) throw error
    if (controller.signal.aborted) providerFailure('SUPPORT_PROVIDER_TIMEOUT')
    if (error instanceof TypeError && error.cause?.code) providerFailure('SUPPORT_PROVIDER_CONNECTION_FAILED')
    unavailable()
  }
  finally { clearTimeout(timer); controller.abort(); void response?.body?.cancel().catch(() => {}); requestSignal.removeEventListener('abort', abort) }
}

/** FAQ compatibility plus explicitly approved free text; no browser-supplied history or tools. */
export function createStaffSupportChatHttp({ configFactory = loadStaffSupportChatConfig, authFactory = createStaffAuth, fetchImpl = fetch, now = Date.now, limiter = createSupportChatLimiter({ now }), conversations = staffSupportConversations } = {}) {
  return async request => {
    const requestId = randomUUID()
    const headers = new Headers({ 'Cache-Control': 'no-store, max-age=0', Pragma: 'no-cache', Vary: 'Cookie', 'X-Content-Type-Options': 'nosniff', 'X-Request-Id': requestId })
    let release, config, sid, auth
    try {
      config = configFactory()
      const url = new URL(request.url), post = request.method === 'POST', clear = request.method === 'DELETE'
      if (url.pathname !== '/api/staff/support/chat') fail(404, 'NOT_FOUND', 'Không tìm thấy API.')
      if (!post && !clear && request.method !== 'GET') { headers.set('Allow', 'GET, POST, DELETE'); fail(405, 'METHOD_NOT_ALLOWED', 'Phương thức không được hỗ trợ.') }
      if (url.search) fail(400, 'INVALID_INPUT', 'Yêu cầu chứa tham số không được hỗ trợ.')
      const origin = request.headers.get('origin'), site = request.headers.get('sec-fetch-site')
      if (url.origin !== config.appOrigin || request.headers.get('host') && request.headers.get('host') !== url.host
        || (post || clear ? origin !== config.appOrigin : origin !== null && origin !== config.appOrigin)
        || site !== null && site !== 'same-origin') fail(403, 'ORIGIN_DENIED', 'Nguồn yêu cầu không được cho phép.')
      sid = sessionId(request, config.cookieName)
      auth = authFactory({ config, now })
      const session = await auth.inspect(sid)
      if (session?.user?.role !== 'EMPLOYEE' || session?.user?.status !== 'ACTIVE') fail(403, 'STAFF_ACCESS_DENIED', 'Chỉ nhân viên đang hoạt động được dùng trợ lý.')
      const accountId = request.headers.get('X-Staff-Account-Id')
      if (accountId !== null && accountId !== session.user.id) fail(409, 'STAFF_SESSION_CHANGED', 'Tài khoản đăng nhập đã thay đổi. Vui lòng tải lại trang.')
      if (clear) {
        if (accountId !== session.user.id) fail(409, 'STAFF_SESSION_CHANGED', 'Tài khoản đăng nhập đã thay đổi. Vui lòng tải lại trang.')
        conversations.clearSession(sid)
        return Response.json({ ok: true }, { headers })
      }
      if (!post) return Response.json({ available: Boolean(config.chat), policyVersion: STAFF_SUPPORT_POLICY, mode: 'fixed-questions', maxAnswerLength: 4000,
        freeText: { available: config.chat?.freeText === true, policyVersion: STAFF_CONVERSATION_POLICY, maxInputLength: limits.inputLength, maxTurns: config.chat?.maxTurns === 30 ? 30 : limits.turns } }, { headers })
      if (!config.chat) unavailable()
      // Reserve capacity before reading a body so slow uploads cannot bypass
      // the concurrency/session limits while waiting for their own timeout.
      release = limiter.acquire('account:' + session.user.id)
      if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') fail(415, 'JSON_REQUIRED', 'Vui lòng gửi dữ liệu JSON.')
      const declared = request.headers.get('content-length')
      const maxBody = config.chat.freeText ? 8192 : 256
      if (declared && (!/^\d+$/.test(declared) || Number(declared) > maxBody)) fail(413, 'BODY_TOO_LARGE', 'Nội dung vượt giới hạn cho phép.')
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 5000)
      const cancelBody = () => controller.abort()
      request.signal.addEventListener('abort', cancelBody, { once: true })
      if (request.signal.aborted) controller.abort()
      let input
      try { input = await boundedJson(request.body, maxBody, controller.signal) }
      catch (error) { if (controller.signal.aborted) fail(408, 'REQUEST_TIMEOUT', 'Yêu cầu đã quá thời gian chờ.'); throw error }
      finally { clearTimeout(timer); request.signal.removeEventListener('abort', cancelBody); controller.abort() }
      if (input?.mode === 'free-text') {
        if (config.chat.freeText !== true || config.chat.provider !== 'openai-compatible') fail(503, 'SUPPORT_FREE_TEXT_DISABLED', 'Hội thoại tự do chưa được bật theo chính sách dữ liệu.')
        if (accountId !== session.user.id) fail(409, 'STAFF_SESSION_CHANGED', 'Tài khoản đăng nhập đã thay đổi. Vui lòng tải lại trang.')
        if (Object.keys(input).some(key => !['mode', 'message', 'conversationId'].includes(key)) || input.conversationId !== undefined && (typeof input.conversationId !== 'string' || !/^[a-f0-9-]{36}$/.test(input.conversationId))) fail(400, 'INVALID_INPUT', 'Nội dung hội thoại không hợp lệ.')
        const validated = validateSupportText(input.message)
        if (!validated.ok) fail(400, validated.code, 'Không thể gửi nội dung này. Chỉ nhập câu hỏi chung, không có thông tin riêng tư, mật khẩu, token hoặc dữ liệu khách hàng.')
        const conversation = conversations.open(sid, session.user.id, input.conversationId, session.expiresAt, config.chat.maxTurns)
        const answer = await auth.withAccessToken(sid, () => providerAnswer(config.chat, { mode: 'free-text', message: validated.value, history: conversation.messages }, fetchImpl, request.signal))
        if (request.signal.aborted) fail(408, 'REQUEST_TIMEOUT', 'Yêu cầu đã kết thúc.')
        if (supportSensitiveContent(answer) || supportPromptOverride(answer)) providerFailure('SUPPORT_PROVIDER_UNSAFE_OUTPUT')
        conversations.commit(conversation, validated.value, answer)
        return Response.json({ mode: 'free-text', answer, conversationId: conversation.id, turnCount: conversation.turns, maxTurns: conversation.maxTurns, createdAt: new Date(now()).toISOString(), policyVersion: STAFF_CONVERSATION_POLICY }, { headers })
      }
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 1
        || typeof input.questionId !== 'string' || !questions.has(input.questionId)) fail(400, 'INVALID_INPUT', 'Chỉ được gửi một câu hỏi trong danh sách FAQ đã duyệt.')
      const answer = await auth.withAccessToken(sid, () => providerAnswer(config.chat, questions.get(input.questionId), fetchImpl, request.signal))
      return Response.json({ answer, questionId: input.questionId, createdAt: new Date(now()).toISOString(), policyVersion: STAFF_SUPPORT_POLICY }, { headers })
    } catch (error) {
      const known = error instanceof AuthBffError, status = known ? error.status : 503
      if (status === 401) headers.set('WWW-Authenticate', 'Session')
      if (config && auth && [401, 403].includes(status) && error.code !== 'ORIGIN_DENIED') {
        conversations.clearSession(sid)
        try { await auth.logout(sid) } catch { /* Existing session failures are returned without exposing store details. */ }
        headers.set('Set-Cookie', config.cookieName + '=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' + (config.secureCookie ? '; Secure' : ''))
      }
      if ([429, 503].includes(status)) headers.set('Retry-After', status === 429 ? '60' : '5')
      return Response.json({ error: { code: known ? error.code : 'SUPPORT_AI_UNAVAILABLE', message: known ? error.message : 'Chưa thể kết nối trợ lý AI. Bạn vẫn có thể xem FAQ.' }, requestId }, { status, headers })
    } finally { release?.() }
  }
}
export const handleStaffSupportChat = createStaffSupportChatHttp()
