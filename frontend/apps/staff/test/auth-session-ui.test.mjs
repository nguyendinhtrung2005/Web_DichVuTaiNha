import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import test from 'node:test'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const filename = fileURLToPath(new URL('../../../packages/ui/src/components/staff/staff-auth-session.tsx', import.meta.url))
const compiled = ts.transpileModule(readFileSync(filename, 'utf8'), {
  fileName: filename,
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText

// Execute the actual provider with explicit hook/scheduler/fetch doubles. This
// models rerenders and effect lifecycles; it is not a React DOM/browser/HTTP test.
// No real credential, JWT, storage, Backend or MySQL is accessed by this suite.
function providerHarness({ ignoreAbort = false } = {}) {
  const hooks = [], effects = [], requests = [], timers = new Map(), transitions = []
  let cursor = 0, dirty = false, mounted = true, rendering = false, timerId = 0
  let now = Date.parse('2026-10-27T03:00:00.000Z'), latest
  const same = (a, b) => a?.length === b?.length && a.every((item, index) => Object.is(item, b[index]))
  const listeners = () => {
    const rows = new Map()
    return {
      addEventListener(type, callback) { if (!rows.has(type)) rows.set(type, new Set()); rows.get(type).add(callback) },
      removeEventListener(type, callback) { rows.get(type)?.delete(callback) },
      dispatch(type) { for (const callback of [...rows.get(type) || []]) callback() },
      count(type) { return rows.get(type)?.size || 0 },
    }
  }
  const window = { ...listeners(),
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, at: now + delay }); return id },
    clearTimeout(id) { timers.delete(id) },
  }
  const document = { ...listeners(), visibilityState: 'visible' }
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])) }
    static now() { return now }
  }
  const react = {
    createContext() { return { Provider: Symbol('unit-provider') } },
    useContext() { return latest },
    useState(initial) {
      const index = cursor++
      if (!hooks[index]) hooks[index] = { value: typeof initial === 'function' ? initial() : initial }
      return [hooks[index].value, value => {
        const next = typeof value === 'function' ? value(hooks[index].value) : value
        if (!Object.is(next, hooks[index].value)) { hooks[index].value = next; dirty = true }
      }]
    },
    useRef(initial) {
      const index = cursor++
      if (!hooks[index]) hooks[index] = { value: { current: initial } }
      return hooks[index].value
    },
    useCallback(callback, dependencies) {
      const index = cursor++
      if (!hooks[index] || !same(hooks[index].dependencies, dependencies)) hooks[index] = { callback, dependencies }
      return hooks[index].callback
    },
    useEffect(callback, dependencies) {
      const index = cursor++
      const previous = hooks[index]
      if (!previous || !same(previous.dependencies, dependencies)) {
        hooks[index] = { dependencies, cleanup: previous?.cleanup }
        effects.push(() => { hooks[index].cleanup?.(); hooks[index].cleanup = callback() })
      }
    },
  }
  const module = { exports: {} }
  vm.runInNewContext(compiled, {
    module, exports: module.exports, window, document, Date: ClockDate,
    TextEncoder, TextDecoder, Uint8Array, URL, AbortController,
    require(specifier) {
      if (specifier === 'react') return react
      if (specifier === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }) }
      throw new Error('Unexpected provider import in unit harness')
    },
    fetch(path, init) {
      return new Promise((resolve, reject) => {
        const request = { path, init, aborted: false,
          respond(status, payload) { resolve(Response.json(payload, { status })) },
          fail() { reject(new Error('Unit network failure')) },
        }
        requests.push(request)
        init.signal.addEventListener('abort', () => {
          request.aborted = true
          if (!ignoreAbort) reject(new DOMException('Unit request aborted', 'AbortError'))
        }, { once: true })
      })
    },
  }, { filename, timeout: 2000 })

  function flush() {
    if (!mounted) return
    assert.equal(rendering, false, 'The unit scheduler must not nest provider renders')
    let renders = 0
    do {
      assert.ok(++renders < 30, 'The provider entered a render loop in the unit scheduler')
      rendering = true; dirty = false; cursor = 0
      latest = module.exports.StaffAuthProvider({ children: 'unit-child' }).props.value
      transitions.push(latest.status)
      rendering = false
      for (const effect of effects.splice(0)) effect()
    } while (dirty)
  }
  flush()
  return {
    requests, transitions, window, document, timers,
    get value() { flush(); return latest },
    rerender: flush,
    async settle() { for (let i = 0; i < 8; i++) { await new Promise(resolve => setImmediate(resolve)); flush() } },
    async respond(index, status, payload) { requests[index].respond(status, payload); await this.settle() },
    event(target, type) { (target === 'window' ? window : document).dispatch(type); flush() },
    async advance(milliseconds) {
      now += milliseconds
      let fired = 0
      for (;;) {
        const due = [...timers].find(([, timer]) => timer.at <= now)
        if (!due) break
        assert.ok(++fired < 30, 'The provider entered a timer loop in the unit scheduler')
        timers.delete(due[0]); due[1].callback(); flush()
      }
      await this.settle()
    },
    session(id = '9109002', ttl = 60000) { return { session: { user: { id, role: 'EMPLOYEE', status: 'ACTIVE' }, expiresAt: new ClockDate(now + ttl).toISOString() } } },
    unmount() {
      mounted = false
      for (const hook of hooks) hook?.cleanup?.()
    },
  }
}
const anonymous = { error: { code: 'SESSION_REQUIRED' } }
const renewableSession = (h, ttl = 604800000) => {
  const value = h.session('9109002', ttl)
  value.session.renewable = true
  return value
}

test('provider single-flight: concurrent session checks share one request instead of aborting each other', async () => {
  const h = providerHarness()
  await h.respond(0, 200, renewableSession(h))
  const a = h.value.checkSession(), b = h.value.checkSession()
  h.event('window', 'focus'); h.event('document', 'visibilitychange')
  assert.equal(h.requests.length, 2)
  assert.equal(h.requests[1].aborted, false)
  await h.respond(1, 200, renewableSession(h))
  await Promise.all([a, b]); assert.equal(h.value.status, 'authenticated')
  h.unmount()
})

test('provider single-flight: logout clears an older check without preventing a new account session check', async () => {
  const h = providerHarness({ ignoreAbort: true })
  await h.respond(0, 200, renewableSession(h))
  const checking = h.value.checkSession()
  const logout = h.value.logout(); await h.respond(2, 200, { ok: true }); await logout
  const login = h.value.login('UNIT_ACCOUNT_B', 'unit-only password')
  await h.respond(3, 200, h.session('9109003')); await login
  const next = h.value.checkSession()
  assert.equal(h.requests.length, 5)
  await h.respond(4, 200, h.session('9109003')); await next
  await h.respond(1, 401, anonymous); await checking
  assert.equal(h.value.session.user.id, '9109003'); assert.equal(h.value.status, 'authenticated')
  h.unmount()
})

test('provider hook unit: initial session inspection remains loading until a real response', async () => {
  const h = providerHarness()
  assert.equal(h.value.status, 'loading')
  assert.equal(h.requests.length, 1)
  assert.equal(h.requests[0].path, '/api/auth/session')
  await h.respond(0, 401, anonymous)
  assert.equal(h.value.status, 'unauthenticated')
  assert.equal(h.value.session, null)
  assert.equal(h.value.error, '')
  h.unmount()
})

test('provider hook regression: known-anonymous focus and tab return never enter loading', async () => {
  const h = providerHarness()
  await h.respond(0, 401, anonymous)
  h.transitions.length = 0
  h.event('window', 'focus')
  assert.equal(h.value.status, 'unauthenticated', 'Focus must not replace the mounted login form with a loading screen')
  await h.respond(1, 401, anonymous)
  h.document.visibilityState = 'hidden'
  h.event('document', 'visibilitychange')
  assert.equal(h.requests.length, 2, 'A hidden tab must not trigger another inspection')
  h.document.visibilityState = 'visible'
  h.event('document', 'visibilitychange')
  assert.equal(h.value.status, 'unauthenticated')
  await h.respond(2, 401, anonymous)
  assert.equal(h.transitions.includes('loading'), false)
  assert.equal(h.value.session, null)
  h.unmount()
})

test('provider hook regression: repeated rerenders and background dependency failures preserve the anonymous form state', async () => {
  const h = providerHarness()
  await h.respond(0, 401, anonymous)
  for (let i = 0; i < 4; i++) h.rerender()
  assert.equal(h.requests.length, 1, 'Stable effects must not restart on an ordinary provider rerender')
  h.event('window', 'focus')
  await h.respond(1, 503, { error: { code: 'AUTH_UNAVAILABLE' } })
  assert.equal(h.value.status, 'unauthenticated')
  // A background outage must not surface as a banner over the anonymous login form.
  assert.equal(h.value.error, '')
  assert.equal(h.value.session, null)
  h.event('window', 'focus')
  await h.respond(2, 401, anonymous)
  assert.equal(h.value.error, '')
  assert.equal(h.value.status, 'unauthenticated')
  h.unmount()
})

test('provider hook unit: an initial dependency outage fails closed and explicit retry has loading', async () => {
  const h = providerHarness()
  await h.respond(0, 503, { error: { code: 'AUTH_UNAVAILABLE' } })
  assert.equal(h.value.status, 'unavailable')
  assert.equal(h.value.session, null)
  const retry = h.value.checkSession()
  assert.equal(h.value.status, 'loading')
  await h.respond(1, 401, anonymous)
  await retry
  assert.equal(h.value.status, 'unauthenticated')
  h.unmount()
})

test('provider hook unit: authenticated dependency failure still removes protected access', async () => {
  const h = providerHarness()
  await h.respond(0, 200, h.session())
  assert.equal(h.value.status, 'authenticated')
  h.event('window', 'focus')
  assert.equal(h.value.status, 'authenticated')
  await h.respond(1, 503, { error: { code: 'AUTH_UNAVAILABLE' } })
  assert.equal(h.value.status, 'unavailable')
  assert.equal(h.value.session, null)
  h.unmount()
})

test('provider hook unit: a newly valid server session can still authenticate on tab return', async () => {
  const h = providerHarness()
  await h.respond(0, 401, anonymous)
  h.event('window', 'focus')
  await h.respond(1, 200, h.session())
  assert.equal(h.value.status, 'authenticated')
  assert.equal(h.value.session.user.id, '9109002')
  assert.equal(h.value.error, '')
  h.unmount()
})

test('provider hook unit: expired, locked and malformed sessions never retain protected identity', async () => {
  for (const [status, body] of [[401, { error: { code: 'SESSION_EXPIRED' } }], [403, { error: { code: 'ACCESS_DENIED' } }], [200, { session: { user: { role: 'ADMIN' } } }]]) {
    const h = providerHarness()
    await h.respond(0, 200, h.session())
    h.event('window', 'focus')
    await h.respond(1, status, body)
    assert.equal(h.value.session, null)
    assert.notEqual(h.value.status, 'authenticated')
    h.unmount()
  }
})

test('provider hook unit: rejected login is accessible and does not promote or store credentials', async () => {
  const h = providerHarness()
  await h.respond(0, 401, anonymous)
  const password = ' unit-only login value '
  const resultPromise = h.value.login('TEST-EMPLOYEE-UC9', password)
  assert.equal(h.value.busy, 'login')
  assert.equal(JSON.parse(h.requests[1].init.body).password, password, 'The provider must not trim a password')
  await h.respond(1, 401, { error: { code: 'INVALID_CREDENTIALS' } })
  const result = await resultPromise
  assert.equal(result.ok, false)
  assert.match(result.message, /mật khẩu/)
  assert.equal(h.value.status, 'unauthenticated')
  assert.equal(h.value.busy, null)
  assert.equal(JSON.stringify(h.value).includes(password), false)
  h.unmount()
})

test('provider hook unit: successful login and logout retain only the public session DTO', async () => {
  const h = providerHarness()
  await h.respond(0, 401, anonymous)
  const login = h.value.login('TEST-EMPLOYEE-UC9', 'unit-only password')
  await h.respond(1, 200, h.session())
  assert.equal((await login).ok, true)
  assert.equal(h.value.status, 'authenticated')
  assert.equal(h.value.session.user.id, '9109002')
  assert.equal(h.value.busy, null)
  assert.equal(Object.keys(h.value.session).sort().join(','), 'expiresAt,user')
  const logout = h.value.logout()
  assert.equal(h.value.busy, 'logout')
  await h.respond(2, 200, { ok: true })
  assert.equal((await logout).ok, true)
  assert.equal(h.value.status, 'unauthenticated')
  assert.equal(h.value.session, null)
  assert.equal(h.value.busy, null)
  h.unmount()
})

test('provider hook unit: failed logout keeps identity until the session can be closed', async () => {
  const h = providerHarness()
  await h.respond(0, 200, h.session())
  const logout = h.value.logout()
  await h.respond(1, 503, { error: { code: 'AUTH_UNAVAILABLE' } })
  assert.equal((await logout).ok, false)
  assert.equal(h.value.status, 'authenticated')
  assert.equal(h.value.session.user.id, '9109002')
  h.unmount()
})

test('provider hook unit: focus checks cannot interrupt login or overwrite it with a stale anonymous response', async () => {
  const h = providerHarness({ ignoreAbort: true })
  await h.respond(0, 401, anonymous)
  h.event('window', 'focus')
  const login = h.value.login('TEST-EMPLOYEE-UC9', 'unit-only password')
  assert.equal(h.requests[1].aborted, true)
  const count = h.requests.length
  h.event('document', 'visibilitychange')
  h.event('window', 'focus')
  assert.equal(h.requests.length, count, 'A session check must not abort a pending login mutation')
  await h.respond(2, 200, h.session())
  assert.equal((await login).ok, true)
  await h.respond(1, 401, anonymous)
  assert.equal(h.value.status, 'authenticated')
  assert.equal(h.value.session.user.id, '9109002')
  h.unmount()
})

test('provider hook unit: concurrent focus/visibility checks share the current server outcome', async () => {
  const h = providerHarness({ ignoreAbort: true })
  await h.respond(0, 401, anonymous)
  h.event('window', 'focus')
  h.event('document', 'visibilitychange')
  assert.equal(h.requests.length, 2)
  assert.equal(h.requests[1].aborted, false)
  await h.respond(1, 200, h.session())
  assert.equal(h.value.status, 'authenticated')
  assert.equal(h.value.error, '')
  h.unmount()
})

test('provider hook unit: expiry timer drops a valid identity at the original deadline', async () => {
  const h = providerHarness()
  await h.respond(0, 200, h.session('9109002', 1000))
  await h.advance(1000)
  assert.equal(h.value.status, 'unauthenticated')
  assert.equal(h.value.session, null)
  assert.match(h.value.error, /hết hạn/)
  h.unmount()
})

test('provider hook regression: expiry explanation survives anonymous focus and visibility rechecks', async () => {
  const h = providerHarness()
  await h.respond(0, 200, h.session('9109002', 1000))
  await h.advance(1000)
  const message = h.value.error
  assert.match(message, /hết hạn/)
  for (const [index, target, type, code] of [
    [1, 'window', 'focus', 'SESSION_REQUIRED'],
    [2, 'document', 'visibilitychange', 'UNAUTHENTICATED'],
  ]) {
    h.event(target, type)
    await h.respond(index, 401, { error: { code } })
    assert.equal(h.value.status, 'unauthenticated')
    assert.equal(h.value.session, null)
    assert.equal(h.value.error, message)
  }
  h.unmount()
})

test('provider hook regression: successful login or explicit logout clears a previous expiry explanation', async () => {
  for (const action of ['login', 'logout']) {
    const h = providerHarness()
    await h.respond(0, 200, h.session('9109002', 1000))
    await h.advance(1000)
    assert.match(h.value.error, /hết hạn/)
    const operation = action === 'login'
      ? h.value.login('TEST-EMPLOYEE-UC9', 'unit-only password')
      : h.value.logout()
    await h.respond(1, 200, action === 'login' ? h.session() : { ok: true })
    assert.equal((await operation).ok, true)
    assert.equal(h.value.error, '')
    assert.equal(h.value.status, action === 'login' ? 'authenticated' : 'unauthenticated')
    h.unmount()
  }
})

test('provider hook unit: unmount removes listeners, expires timers and aborts only pending inspection', async () => {
  const h = providerHarness()
  assert.equal(h.window.count('focus'), 1)
  assert.equal(h.document.count('visibilitychange'), 1)
  h.unmount()
  assert.equal(h.window.count('focus'), 0)
  assert.equal(h.document.count('visibilitychange'), 0)
  assert.equal(h.requests[0].aborted, true)
  await h.settle()
  assert.equal(h.timers.size, 0)
})

test('provider renewal: public boolean opt-in survives parsing without retaining credentials', async () => {
  const h = providerHarness(), value = renewableSession(h)
  value.session.refreshToken = 'not-a-client-field'
  value.session.accessToken = 'not-a-client-field'
  await h.respond(0, 200, value)
  assert.equal(h.value.session.renewable, true)
  assert.equal(Object.keys(h.value.session).sort().join(','), 'expiresAt,renewable,user')
  assert.equal(JSON.stringify(h.value.session).includes('not-a-client-field'), false)
  h.unmount()
})

test('provider renewal: visible active session sends empty same-origin POST and accepts renewed expiry', async () => {
  const h = providerHarness()
  await h.respond(0, 200, renewableSession(h))
  const originalExpiry = h.value.session.expiresAt
  await h.advance(60000)
  assert.equal(h.requests.length, 2)
  const renewal = h.requests[1]
  assert.equal(renewal.path, '/api/auth/renew')
  assert.equal(renewal.init.method, 'POST')
  assert.equal(renewal.init.body, '{}')
  assert.equal(renewal.init.credentials, 'same-origin')
  assert.equal(renewal.init.headers['Content-Type'], 'application/json')
  await h.respond(1, 200, renewableSession(h))
  assert.equal(h.value.status, 'authenticated')
  assert.notEqual(h.value.session.expiresAt, originalExpiry)
  h.unmount()
})

test('provider renewal: legacy and hidden sessions do not acquire an implicit renewal loop', async () => {
  const legacy = providerHarness()
  await legacy.respond(0, 200, legacy.session('9109002', 120000))
  await legacy.advance(60000)
  assert.equal(legacy.requests.length, 1)
  legacy.unmount()
  const hidden = providerHarness()
  await hidden.respond(0, 200, renewableSession(hidden))
  hidden.document.visibilityState = 'hidden'
  await hidden.advance(60000)
  assert.equal(hidden.requests.length, 1)
  hidden.document.visibilityState = 'visible'
  hidden.event('document', 'visibilitychange')
  assert.equal(hidden.requests[1].path, '/api/auth/session')
  await hidden.respond(1, 200, renewableSession(hidden))
  hidden.unmount()
})

test('provider renewal: idle tabs are not renewed until real activity resumes', async () => {
  const h = providerHarness()
  await h.respond(0, 200, renewableSession(h))
  await h.advance(60000)
  await h.respond(1, 200, renewableSession(h))
  await h.advance(60001)
  assert.equal(h.requests.length, 2)
  h.event('window', 'keydown')
  await h.advance(60000)
  assert.equal(h.requests.length, 3)
  assert.equal(h.requests[2].path, '/api/auth/renew')
  await h.respond(2, 200, renewableSession(h))
  h.unmount()
})

test('provider renewal: focus and visibility cannot interrupt an in-flight renewal', async () => {
  const h = providerHarness()
  await h.respond(0, 200, renewableSession(h))
  await h.advance(60000)
  h.event('window', 'focus'); h.event('document', 'visibilitychange')
  assert.equal(h.requests.length, 2)
  assert.equal(h.requests[1].aborted, false)
  await h.respond(1, 200, renewableSession(h))
  h.unmount()
})

test('provider renewal: logout wins over a late renewal response and cannot resurrect identity', async () => {
  const h = providerHarness({ ignoreAbort: true })
  await h.respond(0, 200, renewableSession(h))
  await h.advance(60000)
  const logout = h.value.logout()
  assert.equal(h.requests[1].aborted, true)
  assert.equal(h.requests[2].path, '/api/auth/logout')
  await h.respond(2, 200, { ok: true, authRevocationPending: true })
  await logout
  assert.equal(h.value.status, 'unauthenticated')
  await h.respond(1, 200, renewableSession(h))
  assert.equal(h.value.status, 'unauthenticated')
  assert.equal(h.value.session, null)
  h.unmount()
})

test('provider renewal: a bounded in-flight renewal can replace the old expiry before it clears identity', async () => {
  const h = providerHarness()
  await h.respond(0, 200, renewableSession(h, 61000))
  await h.advance(60000)
  await h.advance(1500)
  assert.equal(h.value.status, 'authenticated')
  assert.equal(h.requests[1].aborted, false)
  await h.respond(1, 200, renewableSession(h))
  await h.advance(100)
  assert.equal(h.value.status, 'authenticated')
  h.unmount()
})

test('provider renewal: dependency failure blocks access but focus can recover the retained server session', async () => {
  const h = providerHarness()
  await h.respond(0, 200, renewableSession(h))
  await h.advance(60000)
  await h.respond(1, 503, { error: { code: 'AUTH_UNAVAILABLE' } })
  assert.equal(h.value.status, 'unavailable')
  assert.equal(h.value.session, null)
  h.event('window', 'focus')
  assert.equal(h.requests[2].path, '/api/auth/session')
  await h.respond(2, 200, renewableSession(h))
  assert.equal(h.value.status, 'authenticated')
  h.unmount()
})

test('provider renewal: idle/absolute expiry and Auth denial still require sign-in', async () => {
  const h = providerHarness()
  await h.respond(0, 200, renewableSession(h, 120000))
  await h.advance(120000)
  assert.equal(h.requests.length, 2)
  assert.equal(h.requests[1].path, '/api/auth/session')
  await h.respond(1, 401, { error: { code: 'SESSION_EXPIRED' } })
  assert.equal(h.value.status, 'unauthenticated')
  assert.match(h.value.error, /hết hạn/)
  assert.equal(h.requests.length, 2)
  h.unmount()
  const denied = providerHarness()
  await denied.respond(0, 200, renewableSession(denied))
  await denied.advance(60000)
  await denied.respond(1, 401, { error: { code: 'SESSION_EXPIRED' } })
  assert.equal(denied.value.status, 'unauthenticated')
  assert.equal(denied.value.session, null)
  denied.unmount()
})

test('provider renewal: a different tab renewing the shared cookie defeats a stale local expiry timer', async () => {
  const h = providerHarness()
  await h.respond(0, 200, renewableSession(h, 120000))
  await h.advance(120000)
  assert.equal(h.value.status, 'authenticated')
  assert.equal(h.requests[1].path, '/api/auth/session')
  await h.respond(1, 200, renewableSession(h))
  assert.equal(h.value.status, 'authenticated')
  assert.equal(h.value.error, '')
  h.unmount()
})
