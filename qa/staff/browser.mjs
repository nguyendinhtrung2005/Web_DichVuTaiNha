import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// This suite uses real local QA services and a separate Chrome profile.
// No fetch replacement, JWT fixture, response fulfilment or business write.
const folder = dirname(fileURLToPath(import.meta.url))
const check = (value, code) => { if (!value) throw Error(code) }
const delay = ms => new Promise(done => setTimeout(done, ms))
const same = (left, right) => left.length === right.length && [...left].sort().every((id, index) => id === [...right].sort()[index])
const cookieName = 'cleanhome_staff_session'
const report = { layer: 'Chrome → real isolated Staff BFF/Auth/Order/Staff/MySQL QA; no response doubles', checks: [], layouts: [], screenshots: [], counts: {}, faults: [], exceptions: 0, forbiddenRequests: 0,
  externalMaps: 'NOT_RUN: live Leaflet tiles use the separate maps.browser.mjs suite', externalAI: 'NOT_RUN: live inference uses the separate explicitly budgeted support-live suite', externalReviews: 'NOT_RUN: no Review API', externalPayout: 'NOT_RUN: no payout integration' }
let browserConfig, chrome, profile, cdp, fault, artifactDir, failedAt = 'configuration'

function origin(value) {
  const url = new URL(value)
  check(['http:', 'https:'].includes(url.protocol) && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    && Number(url.port) >= 1024 && Number(url.port) <= 65535 && ![3001, 3002, 3003, 3306, 4001, 4003, 4005].includes(Number(url.port))
    && url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password, 'ISOLATED_QA_LOOPBACK_ORIGIN_INVALID')
  return url.origin
}
async function loadConfig() {
  // The root QA runner owns this generated file. Never fall back to another
  // repository, existing .env, credential vault, default password or shared DB.
  let config
  try { config = JSON.parse(await readFile(join(folder, '.private/runtime-config.json'), 'utf8')) } catch { throw Error('ISOLATED_QA_RUNTIME_CONFIG_REQUIRED_CONTENTS_WITHHELD') }
  check(config.schemaVersion === 'CLEANHOME_STAFF_QA_V1' && config.kind === 'cleanhome.staff-qa-isolated' && config.version === 1
    && config.isolated === true && config.database?.host === '127.0.0.1' && config.database?.name === 'cleanhome_staff_qa_isolated'
    && Number.isInteger(config.database?.port) && config.database.port >= 1024 && config.database.port <= 65535 && config.database.port !== 3306, 'ISOLATED_QA_DATABASE_GUARD_FAILED')
  const frontendOrigin = origin(config.frontendOrigin)
  const serviceOrigins = [origin(config.authOrigin), origin(config.orderOrigin), origin(config.staffOrigin)]
  check(new Set([frontendOrigin, ...serviceOrigins]).size === 4, 'ISOLATED_QA_SERVICE_ORIGINS_MUST_DIFFER')
  const accounts = config.accounts
  check(accounts && ['A', 'B'].every(name => {
    const account = accounts[name]
    return account && typeof account.phone === 'string' && account.phone && typeof account.password === 'string' && account.password
      && /^[1-9]\d{0,18}$/.test(account.userId) && Array.isArray(account.assignmentIds) && account.assignmentIds.length
      && account.assignmentIds.every(id => typeof id === 'string' && /^[1-9]\d{0,18}$/.test(id)) && new Set(account.assignmentIds).size === account.assignmentIds.length
  }) && accounts.A.phone !== accounts.B.phone && accounts.A.userId !== accounts.B.userId
    && accounts.A.assignmentIds.every(id => !accounts.B.assignmentIds.includes(id)), 'ISOLATED_SYNTHETIC_ACCOUNTS_METADATA_REQUIRED')
  check(accounts.B.assignmentIds.length === 27, 'ISOLATED_QA_B27_METADATA_REQUIRED')
  check(config.seed && /^\d{4}-\d{2}$/.test(config.seed.month) && config.seed.range?.from && config.seed.range?.to, 'ISOLATED_QA_REPORTING_PERIOD_REQUIRED')
  check(['development', 'production'].includes(config.mode) && typeof config.incomeDemoEnabled === 'boolean', 'ISOLATED_QA_FRONTEND_MODE_REQUIRED')
  return { ...config, frontendOrigin, serviceOrigins, accounts }
}
function safe(value) {
  let text = String(value)
  for (const account of Object.values(browserConfig?.accounts || {})) for (const field of [account.phone, account.password]) if (field) text = text.split(field).join('[REDACTED]')
  return text.replace(/[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g, '[REDACTED_TOKEN]')
}
function noSecrets(data) {
  const text = JSON.stringify(data)
  check(!/"(?:accessToken|refreshToken|password|password_hash|passwordHash)"\s*:/i.test(text)
    && !/[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/.test(text), 'BROWSER_PUBLIC_RESPONSE_EXPOSED_SECRET')
  for (const account of Object.values(browserConfig.accounts)) check(!text.includes(account.password), 'BROWSER_PUBLIC_RESPONSE_EXPOSED_PASSWORD')
}
async function step(name, action) { failedAt = name; await action(); const status = name.startsWith('Fault injection:') ? 'MOCK_PASS' : name.startsWith('Income ') ? 'DEMO_PASS' : 'REAL_PASS'; report.checks.push({ name, status }); console.log(JSON.stringify({ name, status })) }

class CDP {
  constructor(socket) {
    this.socket = socket; this.id = 0; this.pending = new Map(); this.listeners = []
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data)
      if (message.id) { const item = this.pending.get(message.id); if (item) { clearTimeout(item.timer); this.pending.delete(message.id); message.error ? item.reject(Object.assign(Error('QA_CDP_REJECTED'), { cdpMethod: item.method, cdpCode: message.error.code, cdpMessage: message.error.message })) : item.resolve(message.result) } }
      else for (const listener of this.listeners) listener(message.method, message.params)
    })
    socket.addEventListener('close', () => { for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(Error('OWNED_QA_CHROME_CLOSED')) } this.pending.clear() })
  }
  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => { const timer = setTimeout(() => { this.pending.delete(id); reject(Error('QA_CDP_TIMEOUT')) }, 25000); this.pending.set(id, { resolve, reject, timer, method }); this.socket.send(JSON.stringify({ id, method, params })) })
  }
  async evaluate(expression) { const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); check(!result.exceptionDetails, 'QA_BROWSER_EXPRESSION_FAILED_CONTENTS_WITHHELD'); return result.result.value }
  async until(expression, timeout = 60000) { const end = Date.now() + timeout; while (Date.now() < end) { if (await this.evaluate(expression)) return; await delay(100) } throw Error('QA_BROWSER_CONDITION_TIMEOUT_CONTENTS_WITHHELD') }
  async navigate(path) {
    const previous = await this.evaluate('performance.timeOrigin')
    await this.send('Page.navigate', { url: browserConfig.frontendOrigin + path })
    await this.until('performance.timeOrigin!==' + JSON.stringify(previous) + '&&location.pathname===' + JSON.stringify(path.split(/[?#]/)[0]) + '&&document.readyState==="complete"')
  }
}
async function startChrome() {
  const executable = process.env.STAFF_QA_CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  await access(executable)
  profile = await mkdtemp(join(tmpdir(), 'cleanhome-staff-isolated-qa-chrome-'))
  chrome = spawn(executable, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-sync', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--window-size=1440,1000', 'about:blank'], { windowsHide: true, stdio: 'ignore' })
  let port
  for (let attempt = 0; attempt < 200; attempt++) { try { port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); if (port) break } catch {} check(chrome.exitCode === null, 'OWNED_QA_CHROME_START_FAILED'); await delay(100) }
  check(port, 'OWNED_QA_CHROME_START_TIMEOUT')
  const pages = await (await fetch('http://127.0.0.1:' + port + '/json/list', { signal: AbortSignal.timeout(5000) })).json(), page = pages.find(value => value.type === 'page')
  check(page?.webSocketDebuggerUrl, 'OWNED_QA_CHROME_PAGE_MISSING')
  const socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', () => reject(Error('OWNED_QA_CDP_CONNECT_FAILED')), { once: true }) })
  cdp = new CDP(socket)
  cdp.listeners.push((method, params) => {
    if (method === 'Runtime.exceptionThrown') report.exceptions++
    if (method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(params.type)) {
      report.consoleMessages = [...(report.consoleMessages || []).slice(-9), safe(params.args.filter(arg => typeof arg.value === 'string').map(arg => arg.value).join(' ')).slice(0, 500)]
    }
    if (method === 'Network.responseReceived' && params.response.status >= 400) {
      const path = new URL(params.response.url).pathname
      if (path.startsWith('/_next/')) report.failedAssets = [...(report.failedAssets || []), { path, status: params.response.status }]
    }
    if (method !== 'Fetch.requestPaused') return
    const requestId = params.requestId, url = new URL(params.request.url), verb = params.request.method
    const forbidden = browserConfig.serviceOrigins.includes(url.origin) || url.pathname.startsWith('/internal/')
      || url.pathname.startsWith('/api/staff/') && verb !== 'GET'
      || url.pathname.startsWith('/api/auth/') && !(url.origin === browserConfig.frontendOrigin && ['GET', 'POST'].includes(verb) && ['/api/auth/login', '/api/auth/session', '/api/auth/logout', '/api/auth/renew'].includes(url.pathname))
    if (forbidden) { report.forbiddenRequests++; void cdp.send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }).catch(() => {}); return }
    if (fault && url.origin === browserConfig.frontendOrigin && fault.match(url.pathname)) {
      if (fault.mode === 'hold') { fault.pending.push(requestId); return }
      void cdp.send('Fetch.failRequest', { requestId, errorReason: 'InternetDisconnected' }).catch(() => {}); return
    }
    void cdp.send('Fetch.continueRequest', { requestId }).catch(() => {})
  })
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Network.enable')
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*://*/api/*' }, { urlPattern: '*://*/internal/*' }] })
}
async function field(selector, value) {
  check(await cdp.evaluate('(()=>{const e=document.querySelector(' + JSON.stringify(selector) + ');if(!e)return false;const p=e.tagName==="SELECT"?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,"value").set.call(e,' + JSON.stringify(value) + ');e.dispatchEvent(new Event("input",{bubbles:true}));e.dispatchEvent(new Event("change",{bubbles:true}));return true})()'), 'QA_BROWSER_FIELD_MISSING')
}
async function submit(account) { await field('input[name=phone]', account.phone); await field('input[name=password]', account.password); await cdp.evaluate('document.querySelector("form").requestSubmit()') }
async function login(name, path = '/') { await cdp.navigate('/dang-nhap?next=' + encodeURIComponent(path)); await cdp.until('!!document.querySelector("input[name=phone]")'); await submit(browserConfig.accounts[name]); await cdp.until('location.pathname===' + JSON.stringify(path.split('?')[0]) + '&&!document.querySelector("input[name=phone]")') }
async function logout() {
  await cdp.evaluate('document.querySelector("button[aria-label^=\\"Tài khoản\\"]").click()')
  await cdp.until('[...document.querySelectorAll("[role=menuitem]")].some(e=>e.innerText.includes("Đăng xuất"))')
  await cdp.evaluate('[...document.querySelectorAll("[role=menuitem]")].find(e=>e.innerText.includes("Đăng xuất")).click()')
  await cdp.until('location.pathname==="/dang-nhap"&&!!document.querySelector("input[name=phone]")')
}
async function api(path, { method = 'GET', body } = {}) {
  check(method === 'GET' || method === 'POST' && path === '/api/auth/logout', 'QA_BROWSER_BUSINESS_WRITE_REFUSED')
  const result = await cdp.evaluate('(async()=>{const r=await fetch(' + JSON.stringify(path) + ',{method:' + JSON.stringify(method) + ',credentials:"same-origin",cache:"no-store",redirect:"error",headers:{Accept:"application/json"' + (body ? ',"Content-Type":"application/json"' : '') + '}' + (body ? ',body:' + JSON.stringify(JSON.stringify(body)) : '') + '});return {status:r.status,data:await r.json()}})()')
  noSecrets(result.data); return result
}
const idsExpression = attribute => '[...new Set([...document.querySelectorAll("[' + attribute + ']")].filter(e=>e.getClientRects().length).map(e=>e.getAttribute("' + attribute + '")))]'
async function ids(attribute, expected) { await cdp.until('JSON.stringify(' + idsExpression(attribute) + '.sort())===' + JSON.stringify(JSON.stringify([...new Set(expected)].sort()))) }
async function clickText(text, scope = 'main') { check(await cdp.evaluate('(()=>{const e=[...document.querySelectorAll(' + JSON.stringify(scope + ' button') + ')].find(e=>e.innerText.includes(' + JSON.stringify(text) + ')&&!e.disabled);if(!e)return false;e.click();return true})()'), 'QA_BROWSER_ACTION_MISSING') }
async function layouts(page) {
  for (const width of [375, 390, 768, 1440]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false }); await delay(150)
    await cdp.until('document.querySelectorAll("main h1").length===1')
    const result = await cdp.evaluate('(()=>{const controls=[...document.querySelectorAll("main button,main input,main select")].filter(e=>e.checkVisibility?e.checkVisibility({checkVisibilityCSS:true,checkOpacity:true}):e.getClientRects().length);return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth,lang:document.documentElement.lang,h1:document.querySelectorAll("main h1").length,unnamed:controls.filter(e=>!e.innerText&&!e.getAttribute("aria-label")&&!e.getAttribute("aria-labelledby")&&!e.labels?.length).length,overflow:controls.filter(e=>{if(e.closest("[data-income-chart-scroll],.staff-income-table-wrap"))return false;const r=e.getBoundingClientRect();return r.left< -1||r.right>innerWidth+1}).length,navigationMs:Math.round(performance.getEntriesByType("navigation")[0]?.domContentLoadedEventEnd||0)}})()')
    report.lastLayout = { page, ...result }
    check(result.scrollWidth <= result.width + 1 && result.overflow === 0, 'QA_HORIZONTAL_OVERFLOW_' + page + '_' + width)
    check(result.lang.startsWith('vi') && result.h1 === 1 && result.unnamed === 0, 'QA_BASIC_ACCESSIBILITY_' + page + '_' + width)
    report.layouts.push({ page, ...result, status: 'PASS' })
    if (width === 375 && ['login', 'income', 'areas', 'support', 'achievements'].includes(page)) { const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }); const filename = page + '-375.png'; await writeFile(join(artifactDir, filename), Buffer.from(shot.data, 'base64')); report.screenshots.push(filename) }
  }
}
async function clearFault() {
  const pending = fault?.pending || []; fault = null
  for (const requestId of pending) {
    try { await cdp.send('Fetch.continueRequest', { requestId }) }
    catch (error) {
      // Development StrictMode may abort its first fetch while it is paused.
      // Resume every remaining live request; do not treat an already-cancelled
      // interception as an application/network retry failure.
      if (error.cdpMethod === 'Fetch.continueRequest' && /invalid interception|not found|not exist|already/i.test(error.cdpMessage || '')) {
        report.cancelledPausedRequests = (report.cancelledPausedRequests || 0) + 1
      } else throw error
    }
  }
}
async function jobsBaseline(name) {
  const result = await api('/api/staff/jobs?page=1&pageSize=100&sort=asc')
  check(result.status === 200 && result.data.pagination.total === browserConfig.accounts[name].assignmentIds.length && same(result.data.data.map(row => row.assignmentId), browserConfig.accounts[name].assignmentIds), 'QA_REAL_ASSIGNMENTS_MISMATCH_' + name)
  const rows = result.data.data
  report.counts[name] = { total: rows.length, done: rows.filter(row => row.status === 'DONE').length }
  if (name === 'B') check(rows.length === 27 && report.counts.B.done === 10, 'QA_B27_DONE10_MISMATCH')
  return rows
}

if (process.env.RUN_STAFF_ISOLATED_BROWSER_QA !== 'true') {
  console.log(JSON.stringify({ status: 'NOT_RUN', reason: 'Set RUN_STAFF_ISOLATED_BROWSER_QA=true only after isolated QA runtime is ready' }))
  process.exit(0)
}
const watchdog = setTimeout(() => { try { cdp?.socket.close() } catch {} if (chrome?.exitCode === null) chrome.kill() }, 480000); watchdog.unref()
try {
  browserConfig = await loadConfig()
  artifactDir = join(folder, '.private/reports/browser-' + new Date().toISOString().replace(/[:.]/g, '-'))
  await mkdir(artifactDir, { recursive: true }); report.origin = browserConfig.frontendOrigin; report.frontendMode = browserConfig.mode
  await step('Chrome isolated profile with real network and business write guard', startChrome)
  await step('Real login page responsive 375/390/768/1440', async () => {
    await cdp.navigate('/dang-nhap'); await cdp.until('!!document.querySelector("input[name=phone]")')
    check(await cdp.evaluate('document.querySelector("input[name=password]").type==="password"&&!document.querySelector("input[type=email]")'), 'QA_LOGIN_IDENTITY_FIELDS_INVALID')
    await layouts('login')
  })
  await step('Real wrong password reports accessible Auth error', async () => {
    await submit({ phone: browserConfig.accounts.A.phone, password: 'wrong-isolated-qa-' + randomUUID() })
    await cdp.until('!!document.querySelector("[role=alert]")&&!document.querySelector("button[type=submit]").disabled')
    check(await cdp.evaluate('document.querySelector("[role=alert]").innerText.includes("mật khẩu")'), 'QA_WRONG_PASSWORD_ERROR_UNCLEAR')
  })
  let rowsA, rowsB
  await step('Real A login opaque HttpOnly session and F5 restoration', async () => {
    await submit(browserConfig.accounts.A); await cdp.until('location.pathname==="/"&&!!document.querySelector("[data-dashboard-value]")')
    const cookies = (await cdp.send('Network.getCookies', { urls: [browserConfig.frontendOrigin] })).cookies, own = cookies.find(cookie => cookie.name === cookieName)
    check(own?.httpOnly && own.sameSite === 'Lax' && /^[A-Za-z0-9_-]{43}$/.test(own.value), 'QA_SESSION_COOKIE_NOT_OPAQUE_HTTPONLY')
    const beforeReload = await cdp.evaluate('performance.timeOrigin')
    await cdp.send('Page.reload'); await cdp.until('performance.timeOrigin!==' + JSON.stringify(beforeReload) + '&&document.readyState==="complete"&&!!document.querySelector("[data-dashboard-value]")')
    const result = await api('/api/auth/session'); check(result.status === 200 && result.data.session.user.id === browserConfig.accounts.A.userId, 'QA_SESSION_F5_IDENTITY_CHANGED')
    check(await cdp.evaluate('!document.cookie.includes("cleanhome_staff_session")'), 'QA_HTTPONLY_COOKIE_VISIBLE')
    rowsA = await jobsBaseline('A')
  })
  await step('Dashboard real counts agree with isolated assignments', async () => {
    for (const [stat, status] of [['waiting', 'WAITING'], ['progress', 'IN_PROGRESS'], ['done', 'DONE']]) {
      const actual = await cdp.evaluate('document.querySelector(' + JSON.stringify('[data-dashboard-stat="' + stat + '"] [data-dashboard-value]') + ').innerText.replace(/\D/g,"")')
      check(Number(actual) === rowsA.filter(row => row.status === status).length, 'QA_DASHBOARD_COUNT_MISMATCH_' + stat)
    }
    await layouts('dashboard')
  })
  await step('A jobs and detail show only independently seeded assignments', async () => {
    await cdp.navigate('/cong-viec?page=1&pageSize=100&sort=asc'); await ids('data-assignment-id', browserConfig.accounts.A.assignmentIds); await layouts('jobs')
    await cdp.navigate('/don/' + rowsA[0].assignmentId); await cdp.until('!!document.querySelector("[data-assignment-detail-id]")')
    check(await cdp.evaluate('document.querySelector("[data-assignment-detail-id]").getAttribute("data-assignment-detail-id")===' + JSON.stringify(rowsA[0].assignmentId)), 'QA_DETAIL_ASSIGNMENT_MISMATCH')
    check((await api('/api/staff/jobs/' + browserConfig.accounts.B.assignmentIds[0])).status === 404, 'QA_A_READ_B_DETAIL')
    await layouts('detail')
  })
  await step('Schedule real list and empty range', async () => {
    const { from, to } = browserConfig.seed.range
    const query = new URLSearchParams({ from, to, page: '1', pageSize: '100', sort: 'asc' })
    const result = await api('/api/staff/schedule?' + query); check(result.status === 200, 'QA_SCHEDULE_API_FAILED')
    await cdp.navigate('/lich-lam-viec?' + query + '&view=list&anchor=' + from); await ids('data-schedule-assignment-id', result.data.data.map(row => row.assignmentId)); await layouts('schedule')
    const empty = await api('/api/staff/schedule?from=1971-01-01&to=1971-01-01&page=1&pageSize=100&sort=asc'); check(empty.status === 200 && empty.data.pagination.total === 0, 'QA_EMPTY_RANGE_NOT_EMPTY')
    await cdp.navigate('/lich-lam-viec?from=1971-01-01&to=1971-01-01&page=1&pageSize=100&sort=asc&view=list&anchor=1971-01-01')
    await cdp.until('document.querySelector("main")?.innerText.includes("Không có công việc trong lịch đã chọn")')
  })
  await step('Fault injection: pause/fail real jobs GET then retry real service', async () => {
    fault = { mode: 'hold', pending: [], match: path => path === '/api/staff/jobs' }
    await cdp.navigate('/cong-viec?page=1&pageSize=100&sort=asc'); await cdp.until('document.querySelector("main")?.innerText.includes("Đang tải")')
    check(fault.pending.length > 0, 'QA_NO_REAL_REQUEST_PAUSED')
    await clearFault(); await ids('data-assignment-id', browserConfig.accounts.A.assignmentIds)
    fault = { mode: 'block', pending: [], match: path => path === '/api/staff/jobs' }
    await clickText('Tải lại', '.staff-jobs'); await cdp.until('!!document.querySelector(".staff-jobs-error[role=alert]")')
    check(await cdp.evaluate('!document.querySelector("[data-assignment-id]")'), 'QA_ERROR_RETAINED_STALE_DATA')
    await clearFault(); await clickText('Thử lại', '.staff-jobs-error'); await ids('data-assignment-id', browserConfig.accounts.A.assignmentIds)
    report.faults.push({ target: 'GET jobs', injection: 'CDP pauses/fails actual network; no replacement response', loading: 'PASS', error: 'PASS', realRetry: 'PASS' })
  })
  await step('Real notifications list and unread count match the authenticated API', async () => {
    const listed = await api('/api/staff/notifications?page=1&pageSize=100')
    const unread = await api('/api/staff/notifications/unread-count')
    check(listed.status === 200 && unread.status === 200, 'QA_NOTIFICATIONS_API_FAILED')
    await cdp.navigate('/thong-bao')
    await ids('data-staff-notification-id', listed.data.data.map(row => row.id))
    await cdp.until('!!document.querySelector("[data-staff-notifications-unread]")')
    check(await cdp.evaluate('Number(document.querySelector("[data-staff-notifications-unread]").getAttribute("data-staff-notifications-unread"))===' + unread.data.data.unreadCount), 'QA_NOTIFICATION_UNREAD_UI_MISMATCH')
    await layouts('notifications')
  })
  await step('Areas actual branch and Leaflet waits for explicit map open', async () => {
    const result = await api('/api/staff/branch'); check(result.status === 200, 'QA_BRANCH_API_FAILED')
    await cdp.navigate('/khu-vuc'); await cdp.until('!!document.querySelector("[data-staff-branch-id]")')
    check(await cdp.evaluate('document.querySelector("[data-staff-branch-id]").getAttribute("data-staff-branch-id")===' + JSON.stringify(result.data.data.id)), 'QA_BRANCH_ID_MISMATCH')
    check(await cdp.evaluate('!![...document.querySelectorAll("[data-staff-map] button")].find(e=>/mở bản đồ/i.test(e.textContent))&&!document.querySelector(".leaflet-container")&&!document.querySelector("script[src*=\\"maps.googleapis.com\\"]")'), 'QA_MAPS_EXPLICIT_OPEN_INVALID')
    await layouts('areas')
  })
  await step('Income real DEMO_V2 endpoint follows development gate without real payout', async () => {
    await cdp.navigate('/thu-nhap')
    if (browserConfig.mode === 'development' && browserConfig.incomeDemoEnabled) {
      const result = await api('/api/staff/income/estimate?month=' + browserConfig.seed.month)
      check(result.status === 200 && result.data.policy.version === 'DEMO_V2', 'QA_REAL_DEMO_V2_API_FAILED')
      failedAt = 'Income: wait for real data before changing month'
      await cdp.until('!!document.querySelector("[data-staff-income-remote=ready]")&&!!document.querySelector("#staff-income-month")&&!document.querySelector("#staff-income-month").disabled')
      await field('#staff-income-month', browserConfig.seed.month)
      await cdp.until('!!document.querySelector("[data-staff-income-remote=ready]")&&!!document.querySelector("[data-staff-income-total]")&&document.querySelector("[data-staff-income-month]")?.getAttribute("data-staff-income-month")===' + JSON.stringify(browserConfig.seed.month))
      const total = await cdp.evaluate('Number(document.querySelector("[data-staff-income-total]").getAttribute("data-staff-income-total"))')
      check(total === result.data.estimateTotalVnd, 'QA_INCOME_UI_TOTAL_MISMATCH')
      check(await cdp.evaluate('document.querySelector("[data-staff-income-payout]").innerText.includes("Chưa có giao dịch được xác nhận")'), 'QA_INCOME_FALSE_PAYMENT')
      failedAt = 'Income: wait for the controlled statement filter'
      await field('#staff-income-entry-search', '9999999999999999999'); await cdp.until('!document.querySelector("[data-staff-income-assignment-id]")')
      await field('#staff-income-entry-search', '')
      await cdp.until('!!document.querySelector("[data-staff-income-assignment-id]")')
      failedAt = 'Income: switch from chart to data table'
      await clickText('Số liệu', '[data-income-insights]'); await cdp.until('!!document.querySelector("[data-income-insights] table")')
    } else {
      await cdp.until('!!document.querySelector("[data-staff-income=unavailable]")'); check(await cdp.evaluate('!document.querySelector("[data-staff-income-total]")'), 'QA_PRODUCTION_EXPOSED_DEMO_MONEY')
    }
    await layouts('income')
  })
  await step('FAQ and floating chatbot readiness use real authenticated BFF without inference', async () => {
    const result = await api('/api/staff/support/chat'); check(result.status === 200 && typeof result.data.available === 'boolean', 'QA_AI_READINESS_INVALID')
    await cdp.navigate('/ho-tro'); await cdp.until('!!document.querySelector("[data-staff-chat-launcher]")&&document.querySelectorAll(".staff-support-knowledge details").length===6')
    await cdp.evaluate('document.querySelector("[data-staff-chat-launcher]").click();true'); await cdp.until('["ready","unavailable"].includes(document.querySelector("[data-support-chat-state]")?.dataset.supportChatState)')
    check(await cdp.evaluate('document.querySelectorAll("[data-staff-chat-panel]").length===1&&document.querySelectorAll("[data-staff-chat-message]").length===0'), 'QA_DUPLICATE_CHAT_OR_FAKE_ANSWER')
    await cdp.evaluate('document.querySelector("[data-staff-chat-minimize]")?.click();true'); await layouts('support')
  })
  await step('Achievements real metrics and unavailable Review API', async () => {
    await cdp.navigate('/thanh-tich'); await cdp.until('!!document.querySelector("[data-staff-achievements-unavailable]")')
    await cdp.until('!!document.querySelector("[data-real-statistic=ALL]")||document.querySelector("[data-staff-performance]")?.innerText.includes("Không có phân công nào")')
    check(await cdp.evaluate('!document.querySelector("[data-demo-review],[data-demo-achievement]")'), 'QA_ACHIEVEMENTS_SHOWED_DEMO_REVIEWS')
    await layouts('achievements')
  })
  await step('Real logout clears A cookie and protected session', async () => {
    await logout(); check((await api('/api/auth/session')).status === 401, 'QA_A_LOGOUT_DID_NOT_REVOKE_SESSION')
    const cookies = (await cdp.send('Network.getCookies', { urls: [browserConfig.frontendOrigin] })).cookies
    check(!cookies.some(cookie => cookie.name === cookieName), 'QA_A_LOGOUT_RETAINED_COOKIE')
  })
  await step('B27 DONE10 real session UI and A/B detail isolation', async () => {
    await login('B', '/cong-viec?page=1&pageSize=100&sort=asc'); rowsB = await jobsBaseline('B'); await ids('data-assignment-id', browserConfig.accounts.B.assignmentIds)
    check((await api('/api/staff/jobs/' + browserConfig.accounts.A.assignmentIds[0])).status === 404, 'QA_B_READ_A_DETAIL')
    await cdp.navigate('/'); await cdp.until('!!document.querySelector("[data-dashboard-stat=done] [data-dashboard-value]")')
    check(await cdp.evaluate('document.querySelector("[data-dashboard-stat=done] [data-dashboard-value]").innerText==="10"'), 'QA_B_DONE10_DASHBOARD_MISMATCH')
    if (browserConfig.mode === 'development' && browserConfig.incomeDemoEnabled) {
      const income = await api('/api/staff/income/estimate?month=' + browserConfig.seed.month)
      check(income.status === 200 && income.data.policy.version === 'DEMO_V2'
        && income.data.assignments.every(row => browserConfig.accounts.B.assignmentIds.includes(row.id)), 'QA_B_INCOME_SCOPE_MISMATCH')
      await cdp.navigate('/thu-nhap'); await cdp.until('!!document.querySelector("#staff-income-month")'); await field('#staff-income-month', browserConfig.seed.month)
      await cdp.until('!!document.querySelector("[data-staff-income-total]")&&document.querySelector("[data-staff-income-month]")?.getAttribute("data-staff-income-month")===' + JSON.stringify(browserConfig.seed.month))
      check(await cdp.evaluate('Number(document.querySelector("[data-staff-income-total]").getAttribute("data-staff-income-total"))===' + income.data.estimateTotalVnd), 'QA_B_INCOME_UI_TOTAL_MISMATCH')
      const displayed = await cdp.evaluate('[...document.querySelectorAll("[data-staff-income-assignment-id]")].map(e=>e.getAttribute("data-staff-income-assignment-id"))')
      check(displayed.length && displayed.every(id => browserConfig.accounts.B.assignmentIds.includes(id)), 'QA_B_INCOME_RETAINED_A_ROWS')
    }
    await logout()
  })
  await step('No browser business writes, backend bypass or runtime exception', async () => { check(report.forbiddenRequests === 0, 'QA_FORBIDDEN_BROWSER_REQUEST'); check(report.exceptions === 0, 'QA_BROWSER_RUNTIME_EXCEPTION') })
} catch (error) {
  report.failedAt = failedAt; report.error = safe(error.message)
  if (error.cdpMethod) report.cdpError = { method: error.cdpMethod, code: error.cdpCode, message: safe(error.cdpMessage) }
  try { report.lastPageState = await cdp?.evaluate('({path:location.pathname,ready:document.readyState,headings:document.querySelectorAll("main h1").length,loginInput:!!document.querySelector("input[name=phone]"),incomeState:document.querySelector("[data-staff-income-remote]")?.getAttribute("data-staff-income-remote"),incomeMonth:document.querySelector("#staff-income-month")?.value,incomeRows:document.querySelectorAll("[data-staff-income-assignment-id]").length,incomeTables:document.querySelectorAll("[data-income-insights] table").length})') } catch {}
  process.exitCode = 1
}
finally {
  clearTimeout(watchdog)
  try { await clearFault() } catch {}
  try { if (cdp) await api('/api/auth/logout', { method: 'POST', body: {} }) } catch { /* Closing this isolated profile removes browser access; HTTP lifecycle suite audits revocation. */ }
  try { if (cdp) await cdp.send('Browser.close') } catch {}
  if (chrome?.exitCode === null) chrome.kill()
  if (profile) { const target = resolve(profile), base = resolve(tmpdir()); if (dirname(target) === base && basename(target).startsWith('cleanhome-staff-isolated-qa-chrome-')) { try { await rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); report.profileClosed = true } catch { report.profileClosed = false } } }
  if (artifactDir) { report.pass = report.checks.length; report.fail = report.error ? 1 : 0; await writeFile(join(artifactDir, 'report.json'), JSON.stringify(report, null, 2)) }
  console.log(JSON.stringify({ pass: report.checks.length, fail: report.error ? 1 : 0, failedAt: report.failedAt, error: report.error, layouts: report.layouts.length, counts: report.counts, report: artifactDir ? join(artifactDir, 'report.json') : undefined }))
}
