import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

// Real Auth/Staff/Next/Chrome only. Never fulfils a request with generated JSON.
// Staff business requests are GET-only; auth login/logout are the only POSTs.
if (process.env.RUN_STAFF_REAL_READONLY_QA !== 'true') {
  console.log(JSON.stringify({ status: 'NOT_RUN', reason: 'Requires explicit opt-in and running real local services; no response doubles' }))
  process.exit(0)
}
const configured = new URL(process.env.STAFF_BFF_TEST_BASE_URL || 'http://localhost:3002')
if (!['http:', 'https:'].includes(configured.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(configured.hostname)
  || configured.port !== '3002' || configured.pathname !== '/' || configured.search || configured.hash || configured.username || configured.password) throw Error('REAL_QA_REQUIRES_PLAIN_LOOPBACK_ORIGIN_PORT_3002')
const origin = configured.origin
const publicOnly = process.env.STAFF_REAL_PUBLIC_ONLY === 'true'
const accounts = Object.fromEntries(['A', 'B'].map(name => [name, { phone: process.env['STAFF_BFF_TEST_PHONE_' + name], password: process.env['STAFF_BFF_TEST_PASSWORD_' + name], userId: process.env['STAFF_BFF_TEST_USER_ID_' + name] }]))
if (!publicOnly && (!Object.values(accounts).every(a => typeof a.phone === 'string' && a.phone && typeof a.password === 'string' && a.password && /^[1-9]\d{0,18}$/.test(a.userId || ''))
  || accounts.A.phone === accounts.B.phone || accounts.A.userId === accounts.B.userId)) throw Error('DISTINCT_REAL_A_B_CREDENTIALS_AND_IDS_REQUIRED_VALUES_WITHHELD')
const expected = Object.fromEntries(['A', 'B'].map(name => {
  const raw = process.env['STAFF_REAL_EXPECTED_IDS_' + name]
  const ids = raw ? raw.split(',') : null
  if (ids && (ids.some(id => !/^[1-9]\d{0,18}$/.test(id)) || new Set(ids).size !== ids.length)) throw Error('INVALID_READ_ONLY_ASSIGNMENT_METADATA')
  return [name, ids]
}))
const chromePath = process.env.STAFF_BFF_CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const artifactDir = resolve('.auth-data/qa/real-readonly-' + new Date().toISOString().replace(/[:.]/g, '-'))
const report = { layer: publicOnly ? 'Real Next Staff BFF and Chrome anonymous checks; no authenticated Backend claim' : 'Real Next Staff BFF → real Auth/Staff services and Chrome; business reads only', origin, checks: [], layouts: [], counts: {}, faultInjection: [], screenshots: [], exceptions: 0, forbiddenRequests: 0,
  notRun: publicOnly ? ['Authenticated wrong/right password, session, logout, A/B detail404, Dashboard/jobs/detail/schedule DTO comparisons: Auth/Staff services and A/B credentials unavailable', 'Authenticated modules/fallback/loading/error/retry: services unavailable'] : [],
  externalServices: { maps: 'NOT_RUN: no key supplied', aiGeneration: 'NOT_RUN: no provider enabled', reviews: 'NOT_RUN: no Review API supplied' },
  baseline: expected.A && expected.B ? 'Independent read-only expected assignment IDs supplied' : 'Live API comparison only; not an independent database snapshot' }
const delay = ms => new Promise(done => setTimeout(done, ms))
const check = (value, code) => { if (!value) throw Error(code) }
const same = (a, b) => a.length === b.length && [...a].sort().every((id, i) => id === [...b].sort()[i])
const cookieName = 'cleanhome_staff_session'
const cookies = new Set()
let chrome, profile, cdp, failedAt = 'initialization', fault = null
function safe(value) {
  let text = String(value)
  for (const account of Object.values(accounts)) for (const field of [account.phone, account.password]) if (field) text = text.split(field).join('[REDACTED]')
  return text.replace(/[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g, '[REDACTED_TOKEN]')
}
function noSecrets(value) {
  const raw = JSON.stringify(value)
  check(!/"(?:accessToken|refreshToken|password|password_hash|passwordHash)"\s*:/i.test(raw), 'PUBLIC_RESPONSE_EXPOSED_SECRET_FIELD')
  check(!/[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/.test(raw), 'PUBLIC_RESPONSE_EXPOSED_JWT')
  for (const account of Object.values(accounts)) if (account.password) check(!raw.includes(account.password), 'PUBLIC_RESPONSE_EXPOSED_PASSWORD')
}
async function http(path, { cookie, body, method = 'GET' } = {}) {
  check(path.startsWith('/api/auth/') || path.startsWith('/api/staff/') && method === 'GET', 'BUSINESS_WRITE_REFUSED')
  const response = await fetch(origin + path, { method, redirect: 'error', signal: AbortSignal.timeout(20000), headers: { Accept: 'application/json', Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
  const raw = await response.text(); check(Buffer.byteLength(raw) <= 2097152, 'HTTP_RESPONSE_EXCEEDED_QA_LIMIT')
  let data; try { data = JSON.parse(raw) } catch { throw Error('REAL_HTTP_RESPONSE_NOT_JSON_CONTENTS_WITHHELD') }
  noSecrets(data)
  return { status: response.status, data, headers: response.headers }
}
async function loginHttp(name) {
  const result = await http('/api/auth/login', { method: 'POST', body: { phone: accounts[name].phone, password: accounts[name].password } })
  check(result.status === 200 && result.data.session?.user?.id === accounts[name].userId, 'REAL_HTTP_LOGIN_FAILED_' + name)
  const cookie = result.headers.get('set-cookie')?.split(';')[0]
  check(cookie?.startsWith(cookieName + '='), 'OPAQUE_SESSION_COOKIE_MISSING'); cookies.add(cookie)
  return cookie
}
async function jobsHttp(cookie) {
  const rows = []; let total = null
  for (let page = 1; page <= 20; page++) {
    const result = await http('/api/staff/jobs?' + new URLSearchParams({ page: String(page), pageSize: '100', sort: 'asc' }), { cookie })
    check(result.status === 200 && Array.isArray(result.data.data) && result.data.pagination.page === page, 'REAL_JOBS_RESPONSE_INVALID')
    if (total === null) total = result.data.pagination.total
    check(total === result.data.pagination.total, 'ASSIGNMENT_TOTAL_CHANGED_DURING_QA')
    rows.push(...result.data.data)
    if (rows.length >= total) break
  }
  check(rows.length === total && new Set(rows.map(r => r.assignmentId)).size === total, 'JOBS_BASELINE_TRUNCATED_OR_DUPLICATED')
  return rows
}
async function step(name, action) { failedAt = name; await action(); report.checks.push({ name, status: 'PASS' }) }
class CDP {
  constructor(socket) {
    this.socket = socket; this.id = 0; this.pending = new Map(); this.listeners = []
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data)
      if (message.id) { const item = this.pending.get(message.id); if (item) { clearTimeout(item.timer); this.pending.delete(message.id); message.error ? item.reject(Error('CDP_REJECTED')) : item.resolve(message.result) } }
      else for (const listener of this.listeners) listener(message.method, message.params)
    })
    socket.addEventListener('close', () => { for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(Error('OWNED_CHROME_CLOSED')) } this.pending.clear() })
  }
  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => { const timer = setTimeout(() => { this.pending.delete(id); reject(Error('CDP_TIMEOUT')) }, 25000); this.pending.set(id, { resolve, reject, timer }); this.socket.send(JSON.stringify({ id, method, params })) })
  }
  async evaluate(expression) { const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); check(!result.exceptionDetails, 'BROWSER_EXPRESSION_FAILED_CONTENTS_WITHHELD'); return result.result.value }
  async until(expression, timeout = 30000) { const deadline = Date.now() + timeout; while (Date.now() < deadline) { if (await this.evaluate(expression)) return; await delay(100) } throw Error('REAL_BROWSER_CONDITION_TIMED_OUT_CONTENTS_WITHHELD') }
  async navigate(path) { await this.send('Page.navigate', { url: origin + path }); await this.until('document.readyState==="complete"') }
}
async function field(selector, value) {
  check(await cdp.evaluate('(()=>{const e=document.querySelector(' + JSON.stringify(selector) + ');if(!e)return false;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,' + JSON.stringify(value) + ');e.dispatchEvent(new Event("input",{bubbles:true}));e.dispatchEvent(new Event("change",{bubbles:true}));return true})()'), 'REAL_FORM_FIELD_MISSING')
}
async function submit(account) { await field('input[name=phone]', account.phone); await field('input[name=password]', account.password); await cdp.evaluate('document.querySelector("form").requestSubmit()') }
async function loginBrowser(name, path = '/') { await cdp.navigate('/dang-nhap?next=' + encodeURIComponent(path)); await cdp.until('!!document.querySelector("input[name=phone]")'); await submit(accounts[name]); await cdp.until('location.pathname===' + JSON.stringify(path.split('?')[0]) + '&&!document.querySelector("input[name=phone]")') }
async function logoutBrowser() {
  await cdp.evaluate('document.querySelector("button[aria-label^=\\"Tài khoản\\"]").click()')
  await cdp.until('[...document.querySelectorAll("[role=menuitem]")].some(x=>x.innerText.includes("Đăng xuất"))')
  await cdp.evaluate('[...document.querySelectorAll("[role=menuitem]")].find(x=>x.innerText.includes("Đăng xuất")).click()')
  await cdp.until('location.pathname==="/dang-nhap"&&!!document.querySelector("input[name=phone]")')
}
async function live(path) {
  return cdp.evaluate('(async()=>{const r=await fetch(' + JSON.stringify(path) + ',{credentials:"same-origin",cache:"no-store",redirect:"error"});const data=await r.json();return {status:r.status,data}})()')
}
const visibleIds = attribute => '[...new Set([...document.querySelectorAll("[' + attribute + ']")].filter(e=>e.getClientRects().length>0).map(e=>e.getAttribute("' + attribute + '")))]'
async function waitIds(attribute, ids) { await cdp.until('JSON.stringify(' + visibleIds(attribute) + '.sort())===' + JSON.stringify(JSON.stringify([...ids].sort()))) }
async function layouts(label) {
  for (const width of [375, 390, 768, 1440]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 768 }); await delay(120)
    const size = await cdp.evaluate('({width:innerWidth,scroll:document.documentElement.scrollWidth,controls:[...document.querySelectorAll("main button,main input,main select")].filter(e=>e.getClientRects().length&&getComputedStyle(e).position!=="absolute").map(e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right}})})')
    check(size.scroll <= size.width + 1 && size.controls.every(r => r.left >= -1 && r.right <= size.width + 1), 'RESPONSIVE_OVERFLOW_' + label + '_' + width)
    report.layouts.push({ page: label, width, status: 'PASS' })
  }
  if (['areas', 'support', 'achievements'].includes(label)) { const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }); const file = label + '-1440.png'; await writeFile(join(artifactDir, file), Buffer.from(shot.data, 'base64')); report.screenshots.push(file) }
}
async function clickText(text, scope = 'main') { check(await cdp.evaluate('(()=>{const b=[...document.querySelectorAll(' + JSON.stringify(scope + ' button') + ')].find(b=>b.innerText.includes(' + JSON.stringify(text) + ')&&!b.disabled);if(!b)return false;b.click();return true})()'), 'RETRY_BUTTON_MISSING') }
async function releaseFault() { const old = fault; fault = null; if (old) for (const requestId of old.pending) await cdp.send('Fetch.continueRequest', { requestId }); return old }

const overall = setTimeout(() => { try { cdp?.socket.close() } catch {} if (chrome?.exitCode === null) chrome.kill() }, 360000); overall.unref()
try {
  await mkdir(artifactDir, { recursive: true })
  let cookieA, cookieB, rowsA, rowsB
  await step('HTTP real missing session is denied', async () => check((await http('/api/staff/jobs')).status === 401, 'MISSING_SESSION_WAS_ACCEPTED'))
  if (!publicOnly) {
  await step('HTTP real A/B login and full assignment baselines', async () => {
    cookieA = await loginHttp('A'); cookieB = await loginHttp('B')
    rowsA = await jobsHttp(cookieA); rowsB = await jobsHttp(cookieB)
    check(rowsA.length && rowsB.length, 'QA_REQUIRES_EXISTING_ASSIGNMENTS_FOR_BOTH_ACCOUNTS')
    check(rowsA.every(a => rowsB.every(b => a.assignmentId !== b.assignmentId)), 'A_B_ASSIGNMENTS_OVERLAP')
    for (const [name, rows] of [['A', rowsA], ['B', rowsB]]) {
      if (expected[name]) check(same(rows.map(r => r.assignmentId), expected[name]), 'INDEPENDENT_ASSIGNMENT_SNAPSHOT_MISMATCH_' + name)
      report.counts[name] = { total: rows.length, statuses: Object.fromEntries(['WAITING', 'ACCEPTED', 'IN_PROGRESS', 'DONE', 'CANCELLED'].map(status => [status, rows.filter(r => r.status === status).length])) }
    }
  })
  await step('HTTP A/B cross-assignment detail reads return 404', async () => {
    check((await http('/api/staff/jobs/' + rowsB[0].assignmentId, { cookie: cookieA })).status === 404, 'A_READ_B_DETAIL')
    check((await http('/api/staff/jobs/' + rowsA[0].assignmentId, { cookie: cookieB })).status === 404, 'B_READ_A_DETAIL')
  })
  } else {
    await step('HTTP anonymous auth and Staff modules fail closed with no-store', async () => {
      for (const path of ['/api/auth/session', '/api/staff/jobs/1', '/api/staff/schedule?from=2026-11-01&to=2026-11-30&page=1&pageSize=10&sort=asc', '/api/staff/branch', '/api/staff/availability?from=2026-11-01&to=2026-11-07', '/api/staff/income/estimate?month=2026-11', '/api/staff/support/chat', '/api/staff/reviews?from=2026-11-01&to=2026-11-30']) {
        const result = await http(path)
        check(result.status === 401, 'ANONYMOUS_ENDPOINT_NOT_401_' + path.split('?')[0])
        check(result.headers.get('cache-control')?.includes('no-store'), 'ANONYMOUS_RESPONSE_MISSING_NO_STORE')
      }
    })
  }
  failedAt = 'Chrome isolated profile and CDP initialization'
  await access(chromePath)
  profile = await mkdtemp(join(tmpdir(), 'cleanhome-staff-real-readonly-'))
  chrome = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-sync', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--window-size=1440,1000', 'about:blank'], { windowsHide: true, stdio: 'ignore' })
  const deadline = Date.now() + 20000; let port
  while (Date.now() < deadline) { try { port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); if (port) break } catch {} check(chrome.exitCode === null, 'OWNED_CHROME_DID_NOT_START'); await delay(100) }
  check(port, 'OWNED_CHROME_START_TIMEOUT')
  const pages = await (await fetch('http://127.0.0.1:' + port + '/json/list', { signal: AbortSignal.timeout(5000) })).json(), page = pages.find(p => p.type === 'page')
  const socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', () => reject(Error('OWNED_CHROME_CONNECT_FAILED')), { once: true }) })
  cdp = new CDP(socket)
  cdp.listeners.push((method, params) => {
    if (method === 'Runtime.exceptionThrown') report.exceptions++
    if (method === 'Fetch.requestPaused') {
      const requestId = params.requestId, url = new URL(params.request.url), method = params.request.method
      const forbidden = [4001, 4003, 4005].includes(Number(url.port)) || url.pathname.startsWith('/internal/')
        || url.pathname.startsWith('/api/staff/') && method !== 'GET'
        || url.pathname.startsWith('/api/auth/') && !(['GET', 'POST'].includes(method) && ['/api/auth/login', '/api/auth/session', '/api/auth/logout', '/api/auth/renew'].includes(url.pathname))
      if (forbidden) { report.forbiddenRequests++; void cdp.send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }).catch(() => {}); return }
      if (fault && url.origin === origin && fault.match(url.pathname)) {
        if (fault.mode === 'hold') { fault.pending.push(requestId); return }
        void cdp.send('Fetch.failRequest', { requestId, errorReason: 'InternetDisconnected' }).catch(() => {}); return
      }
      void cdp.send('Fetch.continueRequest', { requestId }).catch(() => {})
    }
  })
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Network.enable')
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*://*/api/*' }, { urlPattern: '*://*/internal/*' }] })
  if (publicOnly) {
    await step('Chrome real login fields and responsive 375/390/768/1440', async () => {
      await cdp.navigate('/dang-nhap'); await cdp.until('!!document.querySelector("input[name=phone]")')
      check(await cdp.evaluate('document.querySelector("input[name=password]").type==="password"&&!document.querySelector("input[type=email]")'), 'LOGIN_PHONE_PASSWORD_FIELDS_INVALID')
      await layouts('login')
    })
    await step('Chrome F5 retains anonymous login and exposes no session cookie', async () => {
      await cdp.send('Page.reload'); await cdp.until('!!document.querySelector("input[name=phone]")')
      const session = await live('/api/auth/session'); check(session.status === 401, 'ANONYMOUS_SESSION_ACCEPTED')
      check(await cdp.evaluate('!document.cookie.includes("cleanhome_staff_session")'), 'SESSION_COOKIE_VISIBLE_TO_SCRIPT')
    })
    await step('Chrome protected routes redirect to same-origin login and retain safe return path', async () => {
      for (const path of ['/cong-viec', '/khu-vuc', '/thu-nhap', '/ho-tro', '/thanh-tich']) {
        await cdp.navigate(path); await cdp.until('location.pathname==="/dang-nhap"&&!!document.querySelector("input[name=phone]")')
        check(await cdp.evaluate('location.origin===' + JSON.stringify(origin) + '&&new URLSearchParams(location.search).get("next")===' + JSON.stringify(path)), 'PROTECTED_RETURN_PATH_INVALID')
      }
    })
    await step('Chrome public-only run makes no Staff writes or direct backend calls', async () => { check(report.forbiddenRequests === 0, 'FORBIDDEN_REQUEST_ATTEMPT'); check(report.exceptions === 0, 'PUBLIC_BROWSER_RUNTIME_EXCEPTION') })
  } else {
  await step('Chrome wrong password gives accessible real Auth error', async () => {
    await cdp.navigate('/dang-nhap'); await cdp.until('!!document.querySelector("input[name=phone]")')
    await submit({ phone: accounts.A.phone, password: 'invalid-qa-' + randomUUID() })
    await cdp.until('!!document.querySelector("[role=alert]")&&!document.querySelector("button[type=submit]").disabled')
    check(await cdp.evaluate('document.querySelector("[role=alert]").innerText.includes("mật khẩu")'), 'WRONG_PASSWORD_ERROR_UNCLEAR')
  })
  await step('Chrome valid login, opaque HttpOnly session and F5 restoration', async () => {
    await submit(accounts.A); await cdp.until('location.pathname==="/"&&!!document.querySelector("[data-dashboard-value]")')
    const result = await cdp.send('Network.getCookies', { urls: [origin] }), own = result.cookies.find(c => c.name === cookieName)
    check(own?.httpOnly && own.sameSite === 'Lax' && /^[A-Za-z0-9_-]{43}$/.test(own.value), 'SESSION_COOKIE_PROTECTIONS_MISSING')
    await cdp.send('Page.reload'); await cdp.until('!!document.querySelector("[data-dashboard-value]")')
    const session = await live('/api/auth/session'); check(session.status === 200 && session.data.session.user.id === accounts.A.userId, 'SESSION_F5_IDENTITY_MISMATCH')
    check(await cdp.evaluate('!document.cookie.includes("cleanhome_staff_session")'), 'HTTPONLY_COOKIE_VISIBLE')
  })
  await step('Chrome Dashboard counts match real read-only API', async () => {
    for (const [id, status] of [['waiting', 'WAITING'], ['progress', 'IN_PROGRESS'], ['done', 'DONE']]) {
      const result = await live('/api/staff/jobs?' + new URLSearchParams({ status, page: '1', pageSize: '1', sort: 'asc' }))
      const actual = await cdp.evaluate('document.querySelector(' + JSON.stringify('[data-dashboard-stat="' + id + '"] [data-dashboard-value]') + ').innerText.replace(/\D/g,"")')
      check(result.status === 200 && Number(actual) === result.data.pagination.total, 'DASHBOARD_REAL_COUNT_MISMATCH_' + id)
    }
    await layouts('dashboard')
  })
  await step('Chrome jobs lists all A assignments without B leakage', async () => {
    await cdp.navigate('/cong-viec?page=1&pageSize=100&sort=asc'); await waitIds('data-assignment-id', rowsA.map(r => r.assignmentId)); await layouts('jobs')
  })
  await step('Chrome detail uses real assigned DTO; no status action is invoked', async () => {
    const id = rowsA[0].assignmentId
    await cdp.navigate('/don/' + id); await cdp.until('!!document.querySelector("[data-assignment-detail-id]")')
    check(await cdp.evaluate('document.querySelector("[data-assignment-detail-id]").getAttribute("data-assignment-detail-id")===' + JSON.stringify(id)), 'DETAIL_ID_MISMATCH')
    await layouts('detail')
  })
  const dated = rowsA.filter(r => r.scheduledAt && r.expectedEndAt)
  check(dated.length, 'NO_DATED_ASSIGNMENTS_FOR_SCHEDULE_QA')
  const day = value => new Date(Date.parse(value) + 7 * 3600000).toISOString().slice(0, 10)
  const from = dated.map(r => day(r.scheduledAt)).sort()[0], to = dated.map(r => day(r.expectedEndAt)).sort().at(-1)
  check((Date.parse(to) - Date.parse(from)) / 86400000 <= 365, 'SCHEDULE_BASELINE_RANGE_TOO_WIDE')
  const scheduleSearch = new URLSearchParams({ from, to, page: '1', pageSize: '100', sort: 'asc' })
  await step('Chrome schedule list matches real API assignment IDs', async () => {
    const result = await live('/api/staff/schedule?' + scheduleSearch)
    check(result.status === 200 && result.data.pagination.total <= 100, 'SCHEDULE_QA_REQUIRES_BOUNDED_REAL_PAGE')
    await cdp.navigate('/lich-lam-viec?' + scheduleSearch + '&view=list&anchor=' + from)
    await waitIds('data-schedule-assignment-id', [...new Set(result.data.data.map(r => r.assignmentId))]); await layouts('schedule')
  })
  await step('Chrome actual empty range and real network loading/error/retry', async () => {
    const empty = await live('/api/staff/schedule?from=1971-01-01&to=1971-01-01&page=1&pageSize=100&sort=asc')
    check(empty.status === 200 && empty.data.pagination.total === 0, 'CHOSEN_EMPTY_RANGE_HAS_REAL_DATA')
    await cdp.navigate('/lich-lam-viec?from=1971-01-01&to=1971-01-01&page=1&pageSize=100&sort=asc&view=list&anchor=1971-01-01')
    await cdp.until('document.querySelector("main")?.innerText.includes("Không có công việc trong lịch đã chọn")')
    fault = { mode: 'hold', pending: [], match: path => path === '/api/staff/jobs' }
    await cdp.navigate('/cong-viec?page=1&pageSize=100&sort=asc')
    await cdp.until('document.querySelector("main")?.innerText.includes("Đang tải")'); check(fault.pending.length, 'NO_REAL_NETWORK_REQUEST_WAS_HELD')
    await releaseFault(); await waitIds('data-assignment-id', rowsA.map(r => r.assignmentId))
    fault = { mode: 'block', pending: [], match: path => path === '/api/staff/jobs' }
    await clickText('Tải lại', '.staff-jobs'); await cdp.until('!!document.querySelector(".staff-jobs-error[role=alert]")')
    check(await cdp.evaluate('!document.querySelector("[data-assignment-id]")'), 'ERROR_RETAINED_STALE_ASSIGNMENTS')
    await releaseFault(); await clickText('Thử lại', '.staff-jobs-error'); await waitIds('data-assignment-id', rowsA.map(r => r.assignmentId))
    report.faultInjection.push({ target: 'jobs GET', mode: 'CDP pauses/fails real network; no generated responses', loading: 'PASS', error: 'PASS', retryWithRealService: 'PASS' })
  })
  await step('Chrome areas reads actual branch and honest Maps fallback', async () => {
    const result = await live('/api/staff/branch'); check(result.status === 200, 'REAL_BRANCH_API_UNAVAILABLE')
    await cdp.navigate('/khu-vuc'); await cdp.until('!!document.querySelector("[data-staff-branch-id]")')
    check(await cdp.evaluate('document.querySelector("[data-staff-branch-id]").getAttribute("data-staff-branch-id")===' + JSON.stringify(result.data.data.id)), 'AREA_BRANCH_ID_MISMATCH')
    check(await cdp.evaluate('/chưa/i.test(document.querySelector("[data-staff-map]")?.innerText||"")&&!document.querySelector("script[src*=\\"maps.googleapis.com\\"]")'), 'MAPS_FALLBACK_INVENTED_MAP_OR_KEY_WAS_CONFIGURED')
    await layouts('areas')
  })
  await step('Chrome income remains unavailable without official production policy', async () => {
    await cdp.navigate('/thu-nhap'); await cdp.until('!!document.querySelector("[data-staff-income=unavailable]")')
    check(await cdp.evaluate('!document.querySelector("[data-staff-income-total],[data-staff-income-assignment-id]")'), 'PRODUCTION_EXPOSED_DEMO_INCOME')
    await layouts('income')
  })
  await step('Chrome FAQ and AI-disabled fallback use real BFF readiness', async () => {
    const result = await live('/api/staff/support/chat'); check(result.status === 200 && result.data.available === false, 'AI_NOT_DISABLED_FOR_THIS_FALLBACK_QA')
    await cdp.navigate('/ho-tro'); await cdp.until('!!document.querySelector("[data-support-chat-placeholder]")')
    await cdp.evaluate('document.querySelector("[data-support-chat-placeholder]").open=true;true')
    await cdp.until('!!document.querySelector("[data-support-chat-state=unavailable]")')
    check(await cdp.evaluate('document.querySelector("[data-support-chat-state] button[type=submit]").disabled&&!document.querySelector("[role=log] article")'), 'AI_DISABLED_ALLOWED_SEND_OR_FAKE_ANSWER')
    await clickText('Thử kết nối lại', '[data-support-chat-state]'); await cdp.until('!!document.querySelector("[data-support-chat-state=unavailable]")'); await layouts('support')
  })
  await step('Chrome achievements preserves actual metrics and unavailable Review API', async () => {
    await cdp.navigate('/thanh-tich'); await cdp.until('!!document.querySelector("[data-staff-achievements-unavailable]")')
    await cdp.until('!!document.querySelector("[data-real-statistic=ALL]")||document.querySelector("[data-staff-performance]")?.innerText.includes("Không có phân công nào")')
    check(await cdp.evaluate('!document.querySelector("[data-demo-review],[data-demo-achievement]")'), 'REAL_ACHIEVEMENTS_SHOWED_DEMO_REVIEW')
    await layouts('achievements')
  })
  await step('Chrome logout revokes current browser session', async () => {
    await logoutBrowser(); check((await live('/api/auth/session')).status === 401, 'LOGOUT_SESSION_STILL_VALID')
    const result = await cdp.send('Network.getCookies', { urls: [origin] }); check(!result.cookies.some(c => c.name === cookieName), 'LOGOUT_RETAINED_COOKIE')
  })
  await step('Chrome B session sees B assignments and cannot read A detail', async () => {
    await loginBrowser('B', '/cong-viec?page=1&pageSize=100&sort=asc'); await waitIds('data-assignment-id', rowsB.map(r => r.assignmentId))
    check((await live('/api/staff/jobs/' + rowsA[0].assignmentId)).status === 404, 'B_BROWSER_READ_A_DETAIL')
    await logoutBrowser()
  })
  await step('Chrome made no Staff business writes or direct backend calls', async () => { check(report.forbiddenRequests === 0, 'BROWSER_ATTEMPTED_FORBIDDEN_BUSINESS_REQUEST'); check(report.exceptions === 0, 'BROWSER_RUNTIME_EXCEPTION') })
  }
} catch (error) { report.failedAt = failedAt; report.error = safe(error.message); process.exitCode = 1 }
finally {
  clearTimeout(overall)
  try { await releaseFault() } catch {}
  try { if (cdp) await cdp.send('Browser.close') } catch {}
  if (chrome?.exitCode === null) chrome.kill()
  for (const cookie of cookies) { try { const result = await http('/api/auth/logout', { method: 'POST', body: {}, cookie }); check(result.status === 200, 'QA_SESSION_CLEANUP_FAILED') } catch { report.sessionCleanupFailed = true; process.exitCode = 1 } }
  if (profile) {
    const target = resolve(profile), base = resolve(tmpdir())
    if (dirname(target) === base && basename(target).startsWith('cleanhome-staff-real-readonly-')) { try { await rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); report.profileClosed = true } catch { report.profileClosed = false } }
  }
  report.pass = report.checks.length; report.fail = report.error || report.sessionCleanupFailed ? 1 : 0
  await mkdir(artifactDir, { recursive: true }); await writeFile(join(artifactDir, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ pass: report.pass, fail: report.fail, failedAt: report.failedAt, error: report.error, report: join(artifactDir, 'report.json'), layouts: report.layouts.length, counts: report.counts, faults: report.faultInjection }))
}
