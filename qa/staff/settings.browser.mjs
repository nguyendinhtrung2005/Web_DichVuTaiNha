import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { loadConfig, mysql, privateDirectory, verifyDatabase } from './common.mjs'

// Real Chrome + BFF/Auth. Fault injection only interrupts transport/storage;
// no fulfilled responses, SQL writes, seed, or business mutations are allowed.
if (process.env.RUN_STAFF_ISOLATED_SETTINGS_QA !== 'true') {
  console.log(JSON.stringify({ status: 'NOT_RUN', reason: 'Explicit isolated QA opt-in required' })); process.exit(0)
}
const check = (value, code) => { if (!value) throw Error(code) }
const wait = ms => new Promise(done => setTimeout(done, ms))
const report = { mockedResponses: false, checks: [], layouts: [], screenshots: [], exceptions: 0, forbiddenRequests: 0, branchGets: 0, notificationQueries: [], faults: [] }
const held = [], prefix = 'cleanhome.staff.notification-view.v1:', displayKey = 'cleanhome.staff.display.v1'
let config, browser, profile, cdp, artifactDir, failedAt = 'configuration', branchFault = null, logoutFault = false, beforeDatabase
class CDP {
  constructor(socket) {
    this.socket = socket; this.sequence = 0; this.pending = new Map(); this.listeners = []
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data)
      if (message.id) { const item = this.pending.get(message.id); if (item) { clearTimeout(item.timer); this.pending.delete(message.id); message.error ? item.reject(Object.assign(Error('QA_CDP_REJECTED'), { cdpMethod: item.method, cdpCode: message.error.code })) : item.done(message.result) } }
      else for (const listener of this.listeners) listener(message.method, message.params)
    })
    socket.addEventListener('close', () => { for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(Error('QA_CHROME_CLOSED')) } this.pending.clear() })
  }
  send(method, params = {}) {
    const id = ++this.sequence
    return new Promise((done, reject) => { const timer = setTimeout(() => { this.pending.delete(id); reject(Error('QA_CDP_TIMEOUT')) }, 20000); this.pending.set(id, { done, reject, timer, method }); this.socket.send(JSON.stringify({ id, method, params })) })
  }
  async evaluate(expression) { const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); check(!r.exceptionDetails, 'QA_BROWSER_EXPRESSION_FAILED'); return r.result.value }
  async until(expression, timeout = 45000) { const end = Date.now() + timeout; while (Date.now() < end) { if (await this.evaluate(expression)) return; await wait(120) } throw Error('QA_BROWSER_CONDITION_TIMEOUT') }
  async navigate(path) { const before = await this.evaluate('performance.timeOrigin'); await this.send('Page.navigate', { url: config.frontendOrigin + path }); await this.until('performance.timeOrigin!==' + JSON.stringify(before) + '&&location.pathname===' + JSON.stringify(path.split('?')[0]) + '&&document.readyState==="complete"') }
}
async function step(name, operation) { failedAt = name; await operation(); report.checks.push({ name, status: 'REAL_PASS' }); console.log(JSON.stringify({ name, status: 'REAL_PASS' })) }
async function databaseFingerprint() {
  const connection = await mysql.createConnection({ ...config.db, multipleStatements: false, supportBigNumbers: true, bigNumberStrings: true, connectTimeout: 5000 })
  try {
    await connection.query('SET SESSION TRANSACTION READ ONLY'); await connection.query('START TRANSACTION READ ONLY'); await verifyDatabase(connection, config)
    const [[identity]] = await connection.query('SELECT DATABASE() AS db, @@session.transaction_read_only AS ro')
    check(identity.db === 'cleanhome_staff_qa_isolated' && Number(identity.ro) === 1, 'QA_READONLY_DATABASE_REQUIRED')
    const result = {}
    for (const table of ['users', 'branches', 'employees', 'employee_availability', 'bookings', 'assignments', 'notifications']) {
      const [rows] = await connection.query('SELECT * FROM `' + table + '` ORDER BY id')
      result[table] = { count: rows.length, sha256: createHash('sha256').update(JSON.stringify(rows)).digest('hex') }
    }
    await connection.rollback(); return result
  } finally { await connection.end() }
}
async function startChrome() {
  const executable = process.env.STAFF_QA_CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  await access(executable); profile = await mkdtemp(join(tmpdir(), 'cleanhome-staff-settings-qa-'))
  browser = spawn(executable, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-sync', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--window-size=1440,1000', 'about:blank'], { windowsHide: true, stdio: 'ignore' })
  let port
  for (let i = 0; i < 150; i++) { try { port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); if (port) break } catch {} check(browser.exitCode === null, 'QA_CHROME_START_FAILED'); await wait(100) }
  check(port, 'QA_CHROME_DEBUG_PORT_MISSING')
  const pages = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json(), page = pages.find(row => row.type === 'page')
  const socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((done, reject) => { socket.addEventListener('open', done, { once: true }); socket.addEventListener('error', () => reject(Error('QA_CHROME_CONNECT_FAILED')), { once: true }) }); cdp = new CDP(socket)
  cdp.listeners.push((method, params) => {
    if (method === 'Runtime.exceptionThrown') report.exceptions++
    if (method === 'Network.requestWillBeSent') {
      const url = new URL(params.request.url)
      if (url.origin === config.frontendOrigin && url.pathname === '/api/staff/branch') report.branchGets++
      if (url.origin === config.frontendOrigin && url.pathname === '/api/staff/notifications') report.notificationQueries.push({ unreadOnly: url.searchParams.get('unreadOnly'), method: params.request.method })
    }
    if (method !== 'Fetch.requestPaused') return
    const { requestId, request } = params, url = new URL(request.url)
    const auth = url.origin === config.frontendOrigin && request.method === 'POST' && ['/api/auth/login', '/api/auth/logout'].includes(url.pathname)
    if (url.origin !== config.frontendOrigin || request.method !== 'GET' && !auth) { report.forbiddenRequests++; void cdp.send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }).catch(() => {}); return }
    if (url.pathname === '/api/staff/branch' && branchFault) {
      if (branchFault === 'hold') { held.push(requestId); return }
      report.faults.push('branch GET connection failure'); void cdp.send('Fetch.failRequest', { requestId, errorReason: 'ConnectionFailed' }).catch(() => {}); return
    }
    if (url.pathname === '/api/auth/logout' && logoutFault) { report.faults.push('logout connection failure'); void cdp.send('Fetch.failRequest', { requestId, errorReason: 'ConnectionFailed' }).catch(() => {}); return }
    void cdp.send('Fetch.continueRequest', { requestId }).catch(() => {})
  })
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Network.enable'); await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] })
}
async function click(selector) {
  report.lastControl = selector
  await cdp.until('(()=>{const e=document.querySelector(' + JSON.stringify(selector) + ');return !!e&&!e.matches(":disabled")})()', 15000)
  await cdp.evaluate('document.querySelector(' + JSON.stringify(selector) + ')?.scrollIntoView({block:"center"});true'); await wait(120)
  const position = await cdp.evaluate('(()=>{const e=document.querySelector(' + JSON.stringify(selector) + ');if(!e||e.matches(":disabled"))return null;const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()')
  check(position, 'QA_CONTROL_NOT_FOUND_OR_DISABLED')
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...position, button: 'left', buttons: 1, clickCount: 1 }); await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...position, button: 'left', buttons: 0, clickCount: 1 })
}
async function setValue(selector, value, select = false) {
  check(await cdp.evaluate('(()=>{const e=document.querySelector(' + JSON.stringify(selector) + ');if(!e||e.matches(":disabled"))return false;Object.getOwnPropertyDescriptor(' + (select ? 'HTMLSelectElement' : 'HTMLInputElement') + '.prototype,"value").set.call(e,' + JSON.stringify(value) + ');e.dispatchEvent(new Event(' + JSON.stringify(select ? 'change' : 'input') + ',{bubbles:true}));return true})()'), 'QA_INPUT_MISSING')
}
async function key(name, code) { await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code: name, windowsVirtualKeyCode: code }); await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code: name, windowsVirtualKeyCode: code }) }
async function escape() { await key('Escape', 27); await cdp.until('!document.querySelector("[role=dialog]")') }
async function ready() { await cdp.until('location.pathname==="/cai-dat"&&document.querySelector("[data-staff-settings-branch]")?.dataset.staffSettingsBranch==="ready"&&document.querySelector("[name=notification-unread-default]")?.disabled===false') }
async function login(label) {
  await cdp.navigate('/dang-nhap?next=%2Fcai-dat'); await cdp.until('!!document.querySelector("input[name=phone]")')
  await setValue('input[name=phone]', config.accounts[label].phone); await setValue('input[name=password]', config.accounts[label].password)
  await cdp.evaluate('document.querySelector("form").requestSubmit();true'); await ready()
}
async function api(path, accountId) {
  check(['/api/staff/branch', '/api/auth/session'].includes(path), 'QA_API_SCOPE_DENIED')
  return cdp.evaluate('(async()=>{const r=await fetch(' + JSON.stringify(path) + ',{cache:"no-store",headers:' + JSON.stringify(accountId ? { 'X-Staff-Account-Id': accountId } : {}) + '});return {status:r.status,body:await r.json()}})()')
}
async function reload() { const before = await cdp.evaluate('performance.timeOrigin'); await cdp.send('Page.reload'); await cdp.until('performance.timeOrigin!==' + JSON.stringify(before) + '&&document.readyState==="complete"'); await ready() }
async function logout() { await click('[data-staff-settings-logout]'); await cdp.until('!!document.querySelector("[data-staff-settings-confirm=logout]")'); await click('[data-staff-settings-confirm-action]'); await cdp.until('location.pathname==="/dang-nhap"&&!!document.querySelector("input[name=phone]")') }
async function shot(file) { const image = await cdp.send('Page.captureScreenshot', { format: 'png' }); await writeFile(join(artifactDir, file), Buffer.from(image.data, 'base64')); report.screenshots.push(file) }
const watchdog = setTimeout(() => { try { cdp?.socket.close() } catch {} if (browser?.exitCode === null) browser.kill() }, 300000); watchdog.unref()
try {
  config = await loadConfig(); check(config.frontendOrigin === 'http://localhost:3102', 'QA_EXPECTS_STABLE_STAFF_ORIGIN')
  artifactDir = join(privateDirectory, 'reports/settings-browser-' + new Date().toISOString().replace(/[:.]/g, '-')); await mkdir(artifactDir, { recursive: true })
  beforeDatabase = await databaseFingerprint()
  await step('Real A login, Settings last sidebar destination and exact active route', async () => {
    await startChrome(); await login('A'); await click('.staff-sidebar a[href="/"]'); await cdp.until('location.pathname==="/"')
    await click('.staff-sidebar [data-staff-settings-link]'); await ready()
    check(await cdp.evaluate('(()=>{const n=document.querySelector(".staff-sidebar nav");return n.querySelector("a:last-of-type[data-staff-settings-link]")===n.querySelectorAll("a")[n.querySelectorAll("a").length-1]&&n.querySelectorAll("[aria-current=page]").length===1&&n.querySelector("[data-staff-settings-link]").getAttribute("aria-current")==="page"})()'), 'QA_SIDEBAR_ORDER_OR_ACTIVE_INCORRECT')
    check((await api('/api/auth/session')).body?.session?.user?.id === config.accounts.A.userId, 'QA_A_SESSION_MISMATCH')
  })
  await step('Profile identity matches real session, F5 persists and unavailable editing stays honest', async () => {
    await cdp.navigate('/ho-so'); await cdp.until('!!document.querySelector("[data-staff-profile]")')
    const session = await api('/api/auth/session')
    check(await cdp.evaluate('document.querySelector("[data-staff-profile]").dataset.profileAccountId===' + JSON.stringify(session.body.session.user.id) + '&&!!document.querySelector(".staff-profile-missing")&&!document.querySelector("[data-profile-demo],input[name=role],input[name=status],input[name=employeeId]")'), 'QA_PROFILE_IDENTITY_OR_FAKE_DATA')
    const before = await cdp.evaluate('performance.timeOrigin'); await cdp.send('Page.reload'); await cdp.until('performance.timeOrigin!==' + JSON.stringify(before) + '&&!!document.querySelector("[data-staff-profile]")')
    check(await cdp.evaluate('document.querySelector("[data-profile-field=account-id]").textContent===' + JSON.stringify(session.body.session.user.id)), 'QA_PROFILE_F5_CHANGED_IDENTITY')
    await cdp.navigate('/cai-dat'); await ready()
  })
  await step('Branch matches real BFF; missing identity fields stay honest and forms cannot mutate', async () => {
    const response = await api('/api/staff/branch', config.accounts.A.userId)
    check(response.status === 200 && await cdp.evaluate('document.querySelector("[data-staff-settings-branch]").textContent===' + JSON.stringify(response.body.data.name)), 'QA_BRANCH_DOES_NOT_MATCH_BFF')
    check(await cdp.evaluate('[...document.querySelectorAll("[data-account-field]")].every(e=>e.textContent==="Chưa được cung cấp")&&!document.querySelector("input[name=role],input[name=employeeId],input[name=status]")'), 'QA_FAKE_IDENTITY_OR_PRIVILEGED_FIELD')
    await click('[data-staff-settings-edit]'); await cdp.until('!!document.querySelector("[data-staff-settings-profile-dialog]")')
    check(await cdp.evaluate('document.querySelector("[data-staff-settings-profile-save]").disabled&&[...document.querySelectorAll("[data-staff-settings-profile-dialog] input")].every(e=>e.matches(":disabled")&&e.value==="")'), 'QA_UNSUPPORTED_PROFILE_WRITE_ENABLED')
    await key('Tab', 9); check(await cdp.evaluate('!!document.activeElement.closest("[role=dialog]")'), 'QA_PROFILE_FOCUS_ESCAPED'); await escape()
    check(await cdp.evaluate('document.activeElement.hasAttribute("data-staff-settings-edit")'), 'QA_PROFILE_FOCUS_NOT_RESTORED')
    await click('.staff-account-password summary')
    check(await cdp.evaluate('document.querySelectorAll("[data-staff-settings-password] input[type=password]").length===3&&[...document.querySelectorAll("[data-staff-settings-password] input")].every(e=>e.matches(":disabled")&&e.value==="")'), 'QA_UNSUPPORTED_PASSWORD_ENABLED')
  })
  await step('Display choices persist through F5; reset confirms and only clears display key', async () => {
    await setValue('#staff-display-motion', 'reduce', true); await setValue('#staff-display-focus', 'strong', true)
    await cdp.until('document.querySelector("[data-display-persistence]")?.dataset.displayPersistence==="saved"'); await reload()
    check(await cdp.evaluate('document.querySelector(".staff-app").dataset.staffMotion==="reduce"&&document.querySelector(".staff-app").dataset.staffFocus==="strong"&&document.querySelector("#staff-display-focus").value==="strong"'), 'QA_DISPLAY_F5_LOST')
    await cdp.evaluate('localStorage.setItem("qa-settings-sentinel","preserve");true')
    await click('#staff-settings-display .staff-account-actions button:last-child'); await cdp.until('!!document.querySelector("[data-staff-settings-confirm=display]")'); await escape()
    check(await cdp.evaluate('localStorage.getItem(' + JSON.stringify(displayKey) + ')!==null'), 'QA_CANCEL_RESET_CHANGED_STORAGE')
    await click('#staff-settings-display .staff-account-actions button:last-child'); await cdp.until('!!document.querySelector("[data-staff-settings-confirm=display]")'); await click('[data-staff-settings-confirm-action]')
    await cdp.until('document.querySelector("#staff-display-motion")?.value==="system"&&document.querySelector("#staff-display-focus")?.value==="standard"')
    check(await cdp.evaluate('localStorage.getItem(' + JSON.stringify(displayKey) + ')===null&&localStorage.getItem("qa-settings-sentinel")==="preserve"'), 'QA_RESET_CLEARED_OTHER_STORAGE')
  })
  await step('Local notification preference controls real unread filter and persists across F5', async () => {
    check(await cdp.evaluate('document.querySelector("[name=notification-unread-default]").checked===false'), 'QA_A_DEFAULT_UNEXPECTED')
    await click('[name=notification-unread-default]'); await cdp.until('document.querySelector("[data-staff-notification-persistence]").dataset.staffNotificationPersistence==="saved"'); await reload()
    check(await cdp.evaluate('document.querySelector("[name=notification-unread-default]").checked===true&&localStorage.getItem(' + JSON.stringify(prefix + config.accounts.A.userId) + ')==="{\\"unreadOnly\\":true}"'), 'QA_NOTIFICATION_F5_LOST')
    const before = report.notificationQueries.length
    await click('#staff-settings-notifications a[href="/thong-bao"]'); await cdp.until('location.pathname==="/thong-bao"&&!!document.querySelector("[data-staff-notifications=remote]")')
    await cdp.until('!document.querySelector("[aria-busy=true]")')
    check(report.notificationQueries.slice(before).some(query => query.unreadOnly === 'true' && query.method === 'GET'), 'QA_SAVED_PREFERENCE_HAS_NO_REAL_EFFECT')
    await cdp.navigate('/cai-dat'); await ready()
  })
  await step('Storage failure is temporary, retry saves without storing identity or credentials', async () => {
    await cdp.evaluate('window.__qaSettingsSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.startsWith(' + JSON.stringify(prefix) + '))throw new DOMException("QA storage unavailable","QuotaExceededError");return window.__qaSettingsSet.call(this,k,v)};true')
    await click('[name=notification-unread-default]'); await cdp.until('document.querySelector("[data-staff-notification-persistence]").dataset.staffNotificationPersistence==="temporary"')
    await cdp.evaluate('Storage.prototype.setItem=window.__qaSettingsSet;delete window.__qaSettingsSet;true')
    await click('#staff-settings-notifications .staff-account-actions button:first-child'); await cdp.until('document.querySelector("[data-staff-notification-persistence]").dataset.staffNotificationPersistence==="saved"')
    await click('[name=notification-unread-default]')
    const values = await cdp.evaluate('Object.keys(localStorage).filter(k=>k.startsWith(' + JSON.stringify(prefix) + ')).map(k=>JSON.parse(localStorage.getItem(k)))')
    check(values.every(value => Object.keys(value).length === 1 && typeof value.unreadOnly === 'boolean'), 'QA_NOTIFICATION_STORAGE_CONTAINS_EXTRA_FIELDS')
  })
  await step('Branch loading, network error and retry use real endpoint', async () => {
    branchFault = 'hold'; await cdp.navigate('/cai-dat'); await cdp.until('document.querySelector("[data-staff-settings-branch]")?.dataset.staffSettingsBranch==="loading"')
    branchFault = 'fail'; for (const requestId of held.splice(0)) await cdp.send('Fetch.failRequest', { requestId, errorReason: 'ConnectionFailed' }).catch(() => {})
    await cdp.until('document.querySelector("[data-staff-settings-branch]")?.dataset.staffSettingsBranch==="error"&&!!document.querySelector("[data-staff-settings-retry]")')
    branchFault = null; await click('[data-staff-settings-retry]'); await ready()
  })
  await step('Responsive page, profile dialog and menu fit 375/390/768/1440', async () => {
    for (const width of [375, 390, 768, 1440]) {
      const height = width < 768 ? 812 : 1000
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }); await cdp.evaluate('scrollTo(0,0);true'); await wait(250)
      const layout = await cdp.evaluate('({width:innerWidth,documentWidth:document.documentElement.scrollWidth,overflowControls:[...document.querySelectorAll(".staff-account-settings button,.staff-account-settings select,.staff-account-settings input,.staff-account-settings a")].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&(r.left<0||r.right>innerWidth+1)}).length})')
      check(layout.documentWidth <= width + 1 && layout.overflowControls === 0, 'QA_SETTINGS_OVERFLOW_' + width); report.layouts.push({ ...layout, status: 'REAL_PASS' }); await shot('settings-' + width + '.png')
      await click('[data-staff-settings-edit]'); await cdp.until('!!document.querySelector("[data-staff-settings-profile-dialog]")')
      check(await cdp.evaluate('(()=>{const d=document.querySelector("[role=dialog]"),r=d.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.height<=innerHeight&&d.scrollWidth<=d.clientWidth+1})()'), 'QA_PROFILE_DIALOG_OVERFLOW_' + width); await escape()
      if (width < 1024) {
        await click('button[aria-label="Mở menu nhân viên"]'); await cdp.until('!!document.querySelector(".staff-mobile-sheet")'); await click('.staff-mobile-sheet [data-staff-settings-link]'); await cdp.until('!document.querySelector(".staff-mobile-sheet")'); await ready()
        check(await cdp.evaluate('document.querySelectorAll(".staff-bottom-nav a").length===5&&document.querySelector(".staff-bottom-nav [aria-current=page]")?.getAttribute("href")==="/ho-so"'), 'QA_BOTTOM_NAV_CHANGED')
      }
    }
  })
  await step('Short sidebar and collapsed Settings remain reachable with keyboard', async () => {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 500, deviceScaleFactor: 1, mobile: false })
    await click('.staff-sidebar [data-staff-settings-link]'); await ready()
    check(await cdp.evaluate('(()=>{const r=document.querySelector(".staff-sidebar [data-staff-settings-link]").getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight})()'), 'QA_SETTINGS_HIDDEN_SHORT_DESKTOP')
    await click('button[aria-label="Thu gọn thanh điều hướng"]')
    check(await cdp.evaluate('document.querySelector(".staff-sidebar [data-staff-settings-link]").getAttribute("aria-label")==="Cài đặt"'), 'QA_COLLAPSED_SETTINGS_UNLABELED')
    await cdp.evaluate('document.querySelector(".staff-sidebar [data-staff-settings-link]").focus();true'); await key('Enter', 13); await ready()
    await click('button[aria-label="Mở rộng thanh điều hướng"]')
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 568, deviceScaleFactor: 1, mobile: false }); await click('button[aria-label="Mở menu nhân viên"]'); await cdp.until('!!document.querySelector(".staff-mobile-sheet")')
    await click('.staff-mobile-sheet [data-staff-settings-link]'); await cdp.until('!document.querySelector(".staff-mobile-sheet")'); await ready()
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
  })
  await step('Logout cancel preserves session; transport error stays visible and retry really logs out', async () => {
    await click('[data-staff-settings-logout]'); await cdp.until('!!document.querySelector("[data-staff-settings-confirm=logout]")'); await escape()
    check((await api('/api/auth/session')).status === 200, 'QA_CANCEL_LOGOUT_ENDED_SESSION')
    logoutFault = true; await click('[data-staff-settings-logout]'); await cdp.until('!!document.querySelector("[data-staff-settings-confirm=logout]")'); await click('[data-staff-settings-confirm-action]')
    await cdp.until('!!document.querySelector("[data-staff-settings-account-page] [role=alert]")'); logoutFault = false
    check((await api('/api/auth/session')).status === 200, 'QA_FAILED_LOGOUT_LOST_SESSION'); await logout()
    check((await api('/api/auth/session')).status === 401 && (await api('/api/staff/branch')).status === 401, 'QA_LOGOUT_SESSION_NOT_REVOKED')
    await cdp.navigate('/cai-dat'); await cdp.until('location.pathname==="/dang-nhap"&&!!document.querySelector("input[name=phone]")')
  })
  await step('B session, profile and local preference isolated from A; stale account header rejected', async () => {
    await login('B')
    check((await api('/api/auth/session')).body?.session?.user?.id === config.accounts.B.userId, 'QA_B_SESSION_MISMATCH')
    await cdp.navigate('/ho-so'); await cdp.until('!!document.querySelector("[data-staff-profile]")')
    check(await cdp.evaluate('document.querySelector("[data-staff-profile]").dataset.profileAccountId===' + JSON.stringify(config.accounts.B.userId) + '&&document.querySelector("[data-profile-field=account-id]").textContent!==' + JSON.stringify(config.accounts.A.userId)), 'QA_B_PROFILE_RETAINED_A')
    await cdp.navigate('/cai-dat'); await ready()
    check(await cdp.evaluate('document.querySelector("[name=notification-unread-default]").checked===false&&localStorage.getItem(' + JSON.stringify(prefix + config.accounts.A.userId) + ')==="{\\"unreadOnly\\":true}"'), 'QA_A_PREFERENCE_LEAKED_INTO_B')
    check((await api('/api/staff/branch', config.accounts.A.userId)).status === 409, 'QA_STALE_A_HEADER_NOT_REJECTED')
    await click('[name=notification-unread-default]'); await click('#staff-settings-notifications .staff-account-actions button:last-of-type'); await cdp.until('!!document.querySelector("[data-staff-settings-confirm=notifications]")'); await click('[data-staff-settings-confirm-action]')
    check(await cdp.evaluate('localStorage.getItem(' + JSON.stringify(prefix + config.accounts.B.userId) + ')===null&&localStorage.getItem(' + JSON.stringify(prefix + config.accounts.A.userId) + ')==="{\\"unreadOnly\\":true}"'), 'QA_B_RESET_CHANGED_A')
    await logout(); await login('A'); check(await cdp.evaluate('document.querySelector("[name=notification-unread-default]").checked'), 'QA_A_SAVED_CHOICE_LOST_AFTER_B')
    await click('#staff-settings-privacy a[href="/ho-tro"]'); await cdp.until('location.pathname==="/ho-tro"'); await cdp.navigate('/cai-dat'); await ready(); await logout()
  })
  await step('No browser exceptions, business writes, or changes to QA business tables', async () => {
    check(report.forbiddenRequests === 0 && report.exceptions === 0, 'QA_RUNTIME_OR_MUTATION_BOUNDARY_FAILED')
    const after = await databaseFingerprint(); report.databaseUnchanged = JSON.stringify(after) === JSON.stringify(beforeDatabase); check(report.databaseUnchanged, 'QA_BUSINESS_DATABASE_CHANGED')
  })
} catch (error) {
  report.failedAt = failedAt; report.error = /^[A-Z0-9_]+$/.test(error.message || '') ? error.message : /^[A-Z0-9_]+$/.test(error.code || '') ? error.code : 'QA_FAILURE_DETAILS_WITHHELD'; report.cdpMethod = error.cdpMethod; process.exitCode = 1
  try { report.page = await cdp?.evaluate('({path:location.pathname,branch:document.querySelector("[data-staff-settings-branch]")?.dataset.staffSettingsBranch,dialog:document.querySelector("[role=dialog]")?.getAttribute("data-staff-settings-confirm"),sidebarHrefs:[...document.querySelectorAll(".staff-sidebar nav a")].map(e=>e.getAttribute("href")),settingsLinks:document.querySelectorAll("[data-staff-settings-link]").length})'); if (['/cai-dat','/'].includes(report.page?.path)) await shot('failure.png') } catch {}
} finally {
  clearTimeout(watchdog); branchFault = null; logoutFault = false
  for (const requestId of held.splice(0)) await cdp?.send('Fetch.continueRequest', { requestId }).catch(() => {})
  try { await cdp?.evaluate('(async()=>{await fetch("/api/auth/logout",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});return true})()') } catch {}
  try { await cdp?.send('Browser.close') } catch {} if (browser?.exitCode === null) browser.kill()
  if (profile && dirname(resolve(profile)) === resolve(tmpdir()) && basename(profile).startsWith('cleanhome-staff-settings-qa-')) await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }).catch(() => {})
  report.pass = report.checks.length; report.fail = report.error ? 1 : 0
  if (artifactDir) await writeFile(join(artifactDir, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ pass: report.pass, fail: report.fail, failedAt: report.failedAt, error: report.error, layouts: report.layouts.length, report: artifactDir && join(artifactDir, 'report.json') }))
}
