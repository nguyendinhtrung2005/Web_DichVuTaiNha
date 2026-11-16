import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { AuthBffError } from '../lib/server/auth-core.mjs'
import { createStaffSupportChatHttp, createSupportChatLimiter } from '../lib/server/support-chat-http.mjs'
import { loadStaffSupportChatConfig } from '../lib/server/support-chat-config.mjs'
import { STAFF_SUPPORT_POLICY, STAFF_USAGE_HELP } from '../../../packages/ui/src/components/staff/staff-support-questions.mjs'

const origin = 'http://localhost:3002'
const chat = { endpoint: 'https://ai-gateway.example.invalid/staff-support', apiKey: 'unit-test-server-only-key', timeoutMs: 100, policyVersion: 'general-guidance-v2' }
function fixture({ limiter } = {}) {
  const sid = randomBytes(32).toString('base64url'), calls = []
  const config = { appOrigin: origin, cookieName: 'cleanhome_staff_session', secureCookie: false, chat }
  const controls = { id: '9109002', role: 'EMPLOYEE', status: 'ACTIVE', failure: null, provider: async () => Response.json({ answer: 'Phản hồi từ HTTP double, không phải AI thật.' }) }
  const auth = {
    async inspect(value) {
      if (!value || value !== sid) throw new AuthBffError(401, 'SESSION_REQUIRED', 'Vui lòng đăng nhập.')
      if (controls.failure) throw controls.failure
      return { user: { id: controls.id, role: controls.role, status: controls.status, name: 'PRIVATE_NAME', email: 'PRIVATE_EMAIL', phone: 'PRIVATE_PHONE' } }
    },
    async withAccessToken(value, operation) { await this.inspect(value); const result = await operation('PRIVATE_AUTH_TOKEN'); await this.inspect(value); return result },
    async logout() { calls.push({ logout: true }) },
  }
  const handle = createStaffSupportChatHttp({ configFactory: () => config, authFactory: () => auth, limiter,
    fetchImpl: async (url, init) => { calls.push({ url, init }); return controls.provider(url, init) } })
  const request = ({ method = 'POST', body = { questionId: 'jobs' }, headers = {}, url = origin + '/api/staff/support/chat' } = {}) => {
    const allHeaders = { Cookie: 'cleanhome_staff_session=' + sid, Origin: origin, 'Content-Type': 'application/json', ...headers }
    for (const [name, value] of Object.entries(allHeaders)) if (value === undefined) delete allHeaders[name]
    return handle(new Request(url, { method, headers: allHeaders, ...(method === 'GET' ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) }))
  }
  return { request, config, controls, calls, handle, sid }
}

test('support config requires explicit provider, policy and server key, ignoring public flags', () => {
  const base = { NODE_ENV: 'test', STAFF_SUPPORT_AI_ENABLED: 'true', STAFF_SUPPORT_AI_POLICY_VERSION: 'general-guidance-v2', STAFF_SUPPORT_AI_ENDPOINT: chat.endpoint, STAFF_SUPPORT_AI_API_KEY: chat.apiKey }
  assert.ok(loadStaffSupportChatConfig(base).chat)
  for (const patch of [{ STAFF_SUPPORT_AI_ENABLED: 'false' }, { STAFF_SUPPORT_AI_POLICY_VERSION: '' }, { STAFF_SUPPORT_AI_POLICY_VERSION: 'unapproved' }, { STAFF_SUPPORT_AI_API_KEY: '' }, { STAFF_SUPPORT_AI_ENDPOINT: 'http://localhost/private' }, { STAFF_SUPPORT_AI_ENDPOINT: 'https://user:secret@example.invalid/api' }, { STAFF_SUPPORT_AI_TIMEOUT_MS: '99999' }]) assert.equal(loadStaffSupportChatConfig({ ...base, ...patch }).chat, null)
  assert.equal(loadStaffSupportChatConfig({ NODE_ENV: 'test', NEXT_PUBLIC_STAFF_SUPPORT_AI_ENABLED: 'true', NEXT_PUBLIC_STAFF_SUPPORT_AI_API_KEY: chat.apiKey }).chat, null)
})

test('readiness is authenticated and never exposes provider credentials', async () => {
  const f = fixture(), response = await f.request({ method: 'GET' }), text = await response.text()
  assert.equal(response.status, 200)
  assert.equal(JSON.parse(text).available, true)
  assert.doesNotMatch(text, /unit-test-server|PRIVATE_|https:/)
  assert.equal(f.calls.length, 0)
  assert.equal((await f.request({ method: 'GET', headers: { Cookie: undefined } })).status, 401)
  f.config.chat = null
  assert.equal((await (await f.request({ method: 'GET' })).json()).available, false)
  assert.equal((await f.request()).status, 503)
})

test('fixed-question provider call never receives session, account data, history or auth bearer', async () => {
  const f = fixture(), response = await f.request(), body = await response.json()
  assert.equal(response.status, 200)
  assert.equal(body.questionId, 'jobs')
  assert.match(body.answer, /HTTP double/)
  assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0')
  const call = f.calls[0], sent = new Headers(call.init.headers)
  assert.equal(call.url, chat.endpoint)
  assert.equal(sent.get('authorization'), 'Bearer ' + chat.apiKey)
  assert.equal(sent.get('cookie'), null)
  assert.equal(call.init.redirect, 'error')
  assert.equal(JSON.parse(call.init.body).questionId, 'jobs')
  assert.doesNotMatch(call.init.body, /PRIVATE_|9109002|history|messages|session|bookingId/)
  assert.doesNotMatch(JSON.stringify(body), /unit-test-server-only-key|PRIVATE_/)
})

test('free text, booking context, extra keys and invalid or oversized input fail before provider', async () => {
  for (const body of [{ questionId: 'jobs', text: 'PRIVATE_CUSTOMER' }, { questionId: 'jobs', bookingId: '42' }, { message: 'Who is PRIVATE_NAME?' }, { questionId: '__proto__' }, { questionId: 'unknown' }, [], null, '{broken', 'x'.repeat(257)]) {
    const f = fixture(), response = await f.request({ body })
    assert.ok([400, 413].includes(response.status), JSON.stringify(body))
    assert.equal(f.calls.length, 0)
  }
  const f = fixture()
  assert.equal((await f.request({ headers: { 'Content-Type': 'text/plain' } })).status, 415)
})

test('session, role, CSRF and account-switch checks block provider access', async () => {
  for (const [options, expected] of [[{ headers: { Cookie: undefined } }, 401], [{ headers: { Cookie: 'cleanhome_staff_session=invalid' } }, 401], [{ headers: { Origin: 'https://foreign.invalid' } }, 403], [{ headers: { Origin: undefined } }, 403], [{ headers: { 'Sec-Fetch-Site': 'cross-site' } }, 403], [{ headers: { 'X-Staff-Account-Id': '9109101' } }, 409], [{ url: origin + '/api/staff/support/chat?userId=9109101' }, 400], [{ method: 'PATCH' }, 405]]) {
    const f = fixture(), response = await f.request(options)
    assert.equal(response.status, expected)
    assert.equal(f.calls.filter(call => call.url).length, 0)
  }
  for (const patch of [{ role: 'CUSTOMER' }, { role: 'ADMIN' }, { status: 'INACTIVE' }]) {
    const f = fixture(); Object.assign(f.controls, patch)
    assert.equal((await f.request()).status, 403)
    assert.equal(f.calls.filter(call => call.url).length, 0)
  }
})

test('provider errors, invalid answers, large streams and timeout become sanitized errors', async () => {
  for (const provider of [async () => { throw Error('PRIVATE_PROVIDER_ERROR') }, async () => Response.json({ error: 'PRIVATE_PROVIDER_ERROR' }, { status: 401 }), async () => Response.json({ answer: '' }), async () => Response.json({ answer: 'x'.repeat(4001) }), async () => new Response('<html>PRIVATE_PROVIDER_ERROR</html>'), async () => Response.json({ answer: 'x'.repeat(17000) }), async (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(Error('PRIVATE_TIMEOUT'))))]) {
    const f = fixture(); f.controls.provider = provider
    const response = await f.request(), text = await response.text()
    assert.equal(response.status, 503)
    assert.equal(response.headers.get('retry-after'), '5')
    assert.doesNotMatch(text, /PRIVATE_|unit-test-server|<html>/)
  }
})

test('per-account limit and A/B account bindings remain independent', async () => {
  const limiter = createSupportChatLimiter(), a = fixture({ limiter })
  for (let i = 0; i < 5; i++) assert.equal((await a.request()).status, 200)
  assert.equal((await a.request()).status, 429)
  const b = fixture({ limiter }); b.controls.id = '9109101'
  assert.equal((await b.request({ headers: { 'X-Staff-Account-Id': '9109101' } })).status, 200)
})

test('OpenAI-compatible config requires an approved model, bounded tokens and current policy', () => {
  const base = { NODE_ENV: 'test', STAFF_SUPPORT_AI_ENABLED: 'true', STAFF_SUPPORT_AI_POLICY_VERSION: STAFF_SUPPORT_POLICY,
    STAFF_SUPPORT_AI_PROVIDER: 'openai-compatible', STAFF_SUPPORT_AI_ENDPOINT: 'https://api.openai.com/v1/chat/completions', STAFF_SUPPORT_AI_API_KEY: chat.apiKey, STAFF_SUPPORT_AI_MODEL: 'unit-approved-model' }
  const configured = loadStaffSupportChatConfig(base).chat
  assert.equal(configured.provider, 'openai-compatible'); assert.equal(configured.model, 'unit-approved-model'); assert.equal(configured.maxOutputTokens, 512)
  for (const patch of [{ STAFF_SUPPORT_AI_MODEL: '' }, { STAFF_SUPPORT_AI_MODEL: 'model with spaces' }, { STAFF_SUPPORT_AI_PROVIDER: 'unknown' }, { STAFF_SUPPORT_AI_MAX_OUTPUT_TOKENS: '63' }, { STAFF_SUPPORT_AI_MAX_OUTPUT_TOKENS: '2049' }, { STAFF_SUPPORT_AI_MAX_OUTPUT_TOKENS: '1e3' }, { STAFF_SUPPORT_AI_POLICY_VERSION: 'general-guidance-v1' }]) assert.equal(loadStaffSupportChatConfig({ ...base, ...patch }).chat, null)
})

const completion = content => ({ choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }] })
function openaiFixture() {
  const f = fixture(); f.config.chat = { ...chat, endpoint: 'https://api.openai.com/v1/chat/completions', provider: 'openai-compatible', model: 'unit-approved-model', maxOutputTokens: 256 }
  f.controls.provider = async () => Response.json(completion('MOCK provider adapter reply.'))
  return f
}

test('all six FAQ questions use real Chat Completions wire format without identity, tools or history', async () => {
  assert.deepEqual(STAFF_USAGE_HELP.map(item => item.id), ['jobs', 'job-steps', 'schedule', 'income', 'account', 'contact'])
  for (const question of STAFF_USAGE_HELP) {
    const f = openaiFixture(), response = await f.request({ body: { questionId: question.id } })
    assert.equal(response.status, 200); assert.equal((await response.json()).answer, 'MOCK provider adapter reply.')
    const call = f.calls[0], sent = JSON.parse(call.init.body)
    assert.equal(sent.model, 'unit-approved-model'); assert.equal(sent.store, false); assert.equal(sent.stream, false); assert.equal(sent.max_completion_tokens, 256)
    assert.deepEqual(sent.messages.map(message => message.role), ['system', 'user'])
    assert.deepEqual(JSON.parse(sent.messages[1].content), { question: question.question, guidance: question.answer })
    assert.match(sent.messages[0].content, /tiếng Việt/); assert.match(sent.messages[0].content, /không được thực hiện/)
    assert.equal(sent.tools, undefined); assert.equal(sent.functions, undefined); assert.equal(sent.user, undefined)
    assert.equal(new Headers(call.init.headers).get('cookie'), null)
    assert.doesNotMatch(call.init.body, /PRIVATE_|9109002|unit-test-server-only-key|bookingId|employeeId|expiresAt/)
    assert.equal(call.init.redirect, 'error')
  }
})

test('Groq accepts only the official completion endpoint and requested GPT-OSS model', () => {
  const base = { NODE_ENV: 'test', STAFF_SUPPORT_AI_ENABLED: 'true', STAFF_SUPPORT_AI_POLICY_VERSION: STAFF_SUPPORT_POLICY,
    STAFF_SUPPORT_AI_PROVIDER: 'openai-compatible', STAFF_SUPPORT_AI_ENDPOINT: 'https://api.groq.com/openai/v1/chat/completions', STAFF_SUPPORT_AI_API_KEY: chat.apiKey, STAFF_SUPPORT_AI_MODEL: 'openai/gpt-oss-20b' }
  assert.equal(loadStaffSupportChatConfig(base).chat.model, 'openai/gpt-oss-20b')
  for (const endpoint of ['https://api.groq.com.evil.invalid/openai/v1/chat/completions', 'https://api.groq.com@evil.invalid/openai/v1/chat/completions', 'https://127.0.0.1/openai/v1/chat/completions', 'https://api.groq.com:8443/openai/v1/chat/completions', 'https://api.groq.com/openai/v1/models', 'https://api.groq.com/openai/v1/chat/completions?redirect=https://evil.invalid', 'https://unapproved.invalid/v1/chat/completions']) assert.equal(loadStaffSupportChatConfig({ ...base, STAFF_SUPPORT_AI_ENDPOINT: endpoint }).chat, null)
  assert.equal(loadStaffSupportChatConfig({ ...base, STAFF_SUPPORT_AI_MODEL: 'unapproved-model' }).chat, null)
  assert.equal(loadStaffSupportChatConfig({ ...base, STAFF_SUPPORT_AI_PROVIDER: 'gateway' }).chat, null)
})

test('all six Groq FAQ payloads omit unsupported store, exclude reasoning and preserve data minimization', async () => {
  for (const question of STAFF_USAGE_HELP) {
    const f = openaiFixture(); f.config.chat = { ...f.config.chat, endpoint: 'https://api.groq.com/openai/v1/chat/completions', model: 'openai/gpt-oss-20b' }
    f.controls.provider = async () => Response.json({ ...completion('MOCK Groq reply.'), model: 'openai/gpt-oss-20b', usage: { completion_tokens: 40 } })
    const response = await f.request({ body: { questionId: question.id } }); assert.equal(response.status, 200)
    const body = await response.text(), sent = JSON.parse(f.calls[0].init.body)
    assert.equal(JSON.parse(body).answer, 'MOCK Groq reply.')
    assert.equal(sent.store, undefined); assert.equal(sent.reasoning_effort, 'low'); assert.equal(sent.include_reasoning, false); assert.equal(sent.reasoning_format, undefined)
    assert.equal(sent.model, 'openai/gpt-oss-20b'); assert.equal(sent.max_completion_tokens, 256); assert.equal(sent.stream, false)
    assert.deepEqual(JSON.parse(sent.messages[1].content), { question: question.question, guidance: question.answer })
    assert.equal(sent.tools, undefined); assert.equal(sent.service_tier, undefined); assert.equal(sent.metadata, undefined); assert.equal(sent.documents, undefined)
    assert.doesNotMatch(f.calls[0].init.body, /PRIVATE_|9109002|unit-test-server-only-key|bookingId|employeeId|expiresAt/)
    assert.doesNotMatch(body, /reasoning|completion_tokens|unit-test-server-only-key/)
  }
})

test('Groq reply must match the configured model and never forwards reasoning fields', async () => {
  const f = openaiFixture(); f.config.chat = { ...f.config.chat, endpoint: 'https://api.groq.com/openai/v1/chat/completions', model: 'openai/gpt-oss-20b' }
  f.controls.provider = async () => Response.json({ ...completion('MOCK reply.'), model: 'wrong-model' })
  assert.equal((await f.request()).status, 503)
  const reply = completion('MOCK reply.'); reply.choices[0].message.reasoning = 'PRIVATE_REASONING_NOT_FOR_BROWSER'
  f.controls.provider = async () => Response.json({ ...reply, model: 'openai/gpt-oss-20b' })
  const response = await f.request(); assert.equal(response.status, 200); assert.doesNotMatch(await response.text(), /PRIVATE_|reasoning/)
})

test('OpenAI-compatible errors, truncated answers, tools and refusals never become assistant replies', async () => {
  const cases = [null, {}, { choices: [] }, { choices: [...completion('one').choices, ...completion('two').choices] }, completion(''), completion('x'.repeat(4001)), completion('\u0000'),
    { choices: [{ ...completion('ignored').choices[0], finish_reason: 'length' }] },
    { choices: [{ ...completion('ignored').choices[0], message: { role: 'assistant', content: 'ignored', tool_calls: [{ id: 'unit-tool', type: 'function', function: { name: 'change_shift', arguments: '{}' } }] } }] },
    { choices: [{ ...completion('ignored').choices[0], message: { role: 'assistant', content: 'ignored', refusal: 'refused' } }] }]
  for (const payload of cases) {
    const f = openaiFixture(); f.controls.provider = async () => Response.json(payload)
    const response = await f.request(); assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /ignored|change_shift|unit-tool/)
    assert.equal(f.calls.length, 1)
  }
})

test('provider invalid status/content type cancels its body and does not expose upstream errors', async () => {
  for (const type of ['application/json-malicious', 'text/html']) {
    const f = openaiFixture(); let cancelled = false
    f.controls.provider = async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('PRIVATE_PROVIDER_ERROR')) }, cancel() { cancelled = true } }), { headers: { 'Content-Type': type } })
    const response = await f.request(); assert.equal(response.status, 503); assert.equal(cancelled, true); assert.doesNotMatch(await response.text(), /PRIVATE_/)
  }
})

test('provider stream deadline cancels the body and releases capacity for a retry', async () => {
  const f = openaiFixture(); let cancelled = false
  f.controls.provider = async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{')) }, cancel() { cancelled = true } }), { headers: { 'Content-Type': 'application/json' } })
  const started = Date.now(), response = await f.request()
  assert.equal(response.status, 503); assert.equal(cancelled, true); assert.ok(Date.now() - started < 2000)
  f.controls.provider = async () => Response.json(completion('MOCK retry reply.'))
  assert.equal((await f.request()).status, 200)
})

test('a provider accidentally echoing its server credential is never exposed to the browser', async () => {
  const f = openaiFixture(); f.controls.provider = async () => Response.json(completion('PRIVATE echo: ' + chat.apiKey))
  const response = await f.request(); assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /PRIVATE|unit-test-server-only-key/)
})

test('provider auth, permission, billing and throttling return safe diagnostic codes, not upstream messages', async () => {
  for (const [status, payload, expected] of [
    [401, { error: { message: 'PRIVATE_PROVIDER_ERROR' } }, 'SUPPORT_PROVIDER_AUTH_FAILED'],
    [403, { error: { message: 'PRIVATE_PROVIDER_ERROR' } }, 'SUPPORT_PROVIDER_FORBIDDEN'],
    [404, { error: {} }, 'SUPPORT_PROVIDER_MODEL_UNAVAILABLE'],
    [429, { error: { type: 'insufficient_quota', message: 'PRIVATE_PROVIDER_ERROR' } }, 'SUPPORT_PROVIDER_QUOTA_EXCEEDED'],
    [429, { error: { code: 'project_spend_limit_exceeded' } }, 'SUPPORT_PROVIDER_QUOTA_EXCEEDED'],
    [429, { error: { code: 'rate_limit_exceeded', message: 'PRIVATE_PROVIDER_ERROR' } }, 'SUPPORT_PROVIDER_RATE_LIMITED'],
    [400, { error: {} }, 'SUPPORT_PROVIDER_REQUEST_REJECTED'],
  ]) {
    const f = openaiFixture(); f.controls.provider = async () => Response.json(payload, { status })
    const response = await f.request(), body = await response.text()
    assert.equal(response.status, 503); assert.equal(JSON.parse(body).error.code, expected); assert.doesNotMatch(body, /PRIVATE_|unit-test-server-only-key/)
    assert.equal(f.calls.length, 1)
  }
})

test('opening another session for the same account cannot bypass its provider quota', async () => {
  const limiter = createSupportChatLimiter(), first = fixture({ limiter }), second = fixture({ limiter })
  for (let i = 0; i < 5; i++) assert.equal((await first.request()).status, 200)
  assert.notEqual(first.sid, second.sid)
  assert.equal((await second.request()).status, 429); assert.equal(second.calls.length, 0)
  second.controls.id = '9109101'; assert.equal((await second.request()).status, 200)
})

test('limiter bounds memory, concurrent requests and global volume without storing raw sessions', () => {
  let time = 100000
  const limiter = createSupportChatLimiter({ now: () => time, maxSessions: 2 })
  const one = limiter.acquire('session-a')
  assert.throws(() => limiter.acquire('session-a'), error => error.status === 429)
  one(); limiter.acquire('session-b')()
  assert.throws(() => limiter.acquire('session-c'), error => error.status === 429)
  time += 60001
  assert.doesNotThrow(() => limiter.acquire('session-c')())
  const global = createSupportChatLimiter({ now: () => time })
  for (let i = 0; i < 30; i++) global.acquire('different-session-' + i)()
  assert.throws(() => global.acquire('over-global-limit'), error => error.status === 429)
  const concurrent = createSupportChatLimiter({ now: () => time })
  const releases = Array.from({ length: 4 }, (_, i) => concurrent.acquire('active-session-' + i))
  assert.throws(() => concurrent.acquire('over-concurrency-limit'), error => error.status === 429)
  releases.forEach(release => release())
  assert.doesNotThrow(() => concurrent.acquire('after-release')())
})

test('logout during AI generation suppresses the generated response', async () => {
  const f = fixture()
  f.controls.provider = async () => { f.controls.failure = new AuthBffError(401, 'SESSION_EXPIRED', 'Phiên đã hết hạn.'); return Response.json({ answer: 'PRIVATE_GENERATED_AFTER_LOGOUT' }) }
  const response = await f.request()
  assert.equal(response.status, 401)
  assert.doesNotMatch(await response.text(), /PRIVATE_GENERATED_AFTER_LOGOUT/)
  assert.match(response.headers.get('set-cookie'), /Max-Age=0/)
})

function slowBodyRequest(fixture, controller, onCancel = () => {}) {
  const body = new ReadableStream({ start(stream) { stream.enqueue(new TextEncoder().encode('{')) }, cancel: onCancel })
  return fixture.handle(new Request(origin + '/api/staff/support/chat', {
    method: 'POST', headers: { Cookie: 'cleanhome_staff_session=' + fixture.sid, Origin: origin, 'Content-Type': 'application/json' },
    body, duplex: 'half', signal: controller.signal,
  }))
}

test('client cancellation promptly cancels a slow request body and releases capacity', async () => {
  const f = fixture(), controller = new AbortController(); let cancelled = false
  const started = Date.now(), pending = slowBodyRequest(f, controller, () => { cancelled = true })
  setTimeout(() => controller.abort(), 10)
  const response = await pending
  assert.equal(response.status, 408)
  assert.ok(Date.now() - started < 2000, 'client cancellation must not wait for the five-second body timeout')
  assert.equal(cancelled, true); assert.equal(f.calls.length, 0)
  assert.equal((await f.request()).status, 200)
})

test('slow body reads consume per-session and global concurrency limits before provider calls', async () => {
  const limiter = createSupportChatLimiter(), fixtures = Array.from({ length: 5 }, () => fixture({ limiter }))
  fixtures.forEach((fixture, index) => { fixture.controls.id = String(9109002 + index) })
  const controllers = Array.from({ length: 4 }, () => new AbortController())
  const pending = controllers.map((controller, index) => slowBodyRequest(fixtures[index], controller))
  await new Promise(resolve => setImmediate(resolve))
  try {
    assert.equal((await fixtures[0].request()).status, 429, 'same-session slow upload must reserve its active slot')
    assert.equal((await fixtures[4].request()).status, 429, 'four slow uploads must exhaust global active slots')
    assert.equal(fixtures.flatMap(f => f.calls).length, 0)
  } finally { controllers.forEach(controller => controller.abort()); await Promise.all(pending) }
  assert.equal((await fixtures[4].request()).status, 200, 'cancelled uploads must release global capacity')
})
