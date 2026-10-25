import { spawn } from 'node:child_process'
import { readFile, writeFile, mkdir, mkdtemp, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, basename, resolve, join } from 'node:path'

if (process.env.RUN_STAFF_UC11_BROWSER_TESTS !== 'true') {
  console.log(JSON.stringify({ browser: 'NOT_RUN', reason: 'Explicit opt-in, real Auth credentials and verified schedule metadata are required' }))
  process.exit(0)
}
const origin = new URL(process.env.STAFF_BFF_TEST_BASE_URL || 'http://localhost:3002').origin
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)) throw new Error('UC11 browser QA requires a loopback frontend')
const scenario = process.env.STAFF_UC11_BROWSER_SCENARIO || 'regular'
if (!['regular', 'outage'].includes(scenario)) throw new Error('Unknown UC11 browser scenario')
const accountA = { phone: process.env.STAFF_BFF_TEST_PHONE_A, password: process.env.STAFF_BFF_TEST_PASSWORD_A }
const accountB = { phone: process.env.STAFF_BFF_TEST_PHONE_B, password: process.env.STAFF_BFF_TEST_PASSWORD_B }
if (![accountA.phone, accountA.password, ...(scenario === 'regular' ? [accountB.phone, accountB.password] : [])].every(value => typeof value === 'string' && value.length)) throw new Error('Real Auth test credentials are required; values withheld')
const metadata = JSON.parse(await readFile(process.env.STAFF_UC11_TEST_METADATA_FILE || '.auth-data/qa/uc11/metadata.json', 'utf8'))
if (metadata.database !== 'cleanhome_staff_test' || !Array.isArray(metadata.assignments)) throw new Error('Verified test database schedule metadata is required')
const userA = process.env.STAFF_BFF_TEST_USER_ID_A || '9109002', userB = process.env.STAFF_BFF_TEST_USER_ID_B || '9109101'
const rowsA = metadata.assignments.filter(row => row.userId === userA), rowsB = metadata.assignments.filter(row => row.userId === userB)
if (!rowsA.length || (scenario === 'regular' && !rowsB.length) || rowsA.some(a => rowsB.some(b => a.assignmentId === b.assignmentId))) throw new Error('Verified employee ownership metadata is invalid')
const DAY = 86400000, VN = 7 * 3600000
const localDay = value => new Date(Date.parse(value) + VN).toISOString().slice(0, 10)
const from = rowsA.concat(rowsB).map(row => localDay(row.scheduledAt)).sort()[0]
const to = rowsA.concat(rowsB).map(row => localDay(row.expectedEndAt)).sort().at(-1)
if (!from || !to || (Date.parse(to) - Date.parse(from)) / DAY > 365) throw new Error('Verified schedule range exceeds the bounded QA scope')
const baseQuery = { from, to, page: '1', pageSize: '100', sort: 'asc' }
const calendarPath = '/lich-lam-viec?' + new URLSearchParams({ ...baseQuery, view: 'list', anchor: from })
const chromePath = process.env.STAFF_BFF_CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const artifactDir = resolve('.auth-data/qa/uc11/' + (scenario === 'outage' ? 'browser-outage' : 'browser'))
const report = { browser: 'Chrome headless with isolated QA profile', scenario, origin, checks: [], screenshots: [], exceptions: 0, credentialLeakDetected: false }
let chrome, profile, cdp, failedAt = 'initialization', responseCount = 0
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
function check(value, message) { if (!value) throw new Error(message) }
function scrub(value) {
  let text = String(value)
  for (const account of [accountA, accountB]) if (account.password) text = text.split(account.password).join('[REDACTED]')
  return text.replace(/[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g, '[REDACTED_TOKEN]')
}
const visibleIds = '[...document.querySelectorAll("[data-schedule-assignment-id]")].filter(e=>e.getClientRects().length>0).map(e=>e.getAttribute("data-schedule-assignment-id"))'
const uniqueIds = '[...new Set(' + visibleIds + ')]'
class CDP {
  constructor(socket) {
    this.socket = socket; this.next = 1; this.pending = new Map(); this.listeners = []
    socket.addEventListener('message', event => {
      const data = JSON.parse(event.data)
      if (data.id) {
        const item = this.pending.get(data.id)
        if (item) { clearTimeout(item.timer); this.pending.delete(data.id); data.error ? item.reject(new Error('CDP command rejected')) : item.resolve(data.result) }
      } else for (const listener of this.listeners) listener(data.method, data.params)
    })
    socket.addEventListener('close', () => { for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('Owned browser connection closed')) } this.pending.clear() })
  }
  async send(method, params = {}) {
    if (this.socket.readyState !== WebSocket.OPEN) throw new Error('Owned browser connection unavailable')
    const id = this.next++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('CDP command timed out')) }, 15000)
      this.pending.set(id, { resolve, reject, timer }); this.socket.send(JSON.stringify({ id, method, params }))
    })
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw new Error('Browser expression failed; expression and credentials withheld')
    return result.result.value
  }
  async until(expression, timeout = 25000) {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) { if (await this.evaluate(expression)) return; await delay(100) }
    throw new Error('Browser condition timed out; expression withheld')
  }
  async navigate(path) { await this.send('Page.navigate', { url: origin + path }); await this.until('document.readyState==="complete"') }
}
async function step(name, action) { failedAt = name; await action(); report.checks.push({ name, status: 'PASS' }) }
async function waitResponse(previous) {
  const deadline = Date.now() + 25000
  while (Date.now() < deadline) { if (responseCount > previous) return; await delay(100) }
  throw new Error('Calendar control did not produce a new HTTP response')
}
async function awaitIds(ids, ordered = false) {
  const expected = ordered ? ids : [...new Set(ids)].sort()
  const expression = ordered ? visibleIds : uniqueIds + '.sort()'
  await cdp.until('JSON.stringify(' + expression + ')===' + JSON.stringify(JSON.stringify(expected)))
}
async function login(account, path = calendarPath) {
  await cdp.navigate('/dang-nhap?next=' + encodeURIComponent(path))
  await cdp.until('!!document.querySelector("input[name=phone]")')
  for (const [name, value] of [['phone', account.phone], ['password', account.password]]) await field(name, value)
  await cdp.evaluate('document.querySelector("form").requestSubmit()')
  await cdp.until('location.pathname==="/lich-lam-viec" && !!document.querySelector("#staff-schedule-from")')
}
async function field(name, value, byId = false) {
  const selector = byId ? '#' + name : 'input[name="' + name + '"]'
  check(await cdp.evaluate('(()=>{const e=document.querySelector(' + JSON.stringify(selector) + ');if(!e)return false;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,' + JSON.stringify(value) + ');e.dispatchEvent(new Event("input",{bubbles:true}));e.dispatchEvent(new Event("change",{bubbles:true}));return true})()'), 'Calendar or login input was unavailable')
}
async function currentQuery() {
  return await cdp.evaluate('Object.fromEntries([...new URLSearchParams(location.search)].filter(([k])=>["from","to","status","page","pageSize","sort"].includes(k)))')
}
async function baseline(query) {
  const search = new URLSearchParams({ ...baseQuery, ...query })
  const value = await cdp.evaluate('(async()=>{const r=await fetch(' + JSON.stringify('/api/staff/schedule?' + search) + ',{cache:"no-store",credentials:"same-origin"});const p=await r.json();return {status:r.status,data:Array.isArray(p.data)?p.data.map(x=>({id:x.assignmentId,status:x.status,start:x.scheduledAt,end:x.expectedEndAt})):null,pagination:p.pagination,timezone:p.timezone}})()')
  check(value.status === 200 && Array.isArray(value.data) && value.timezone === 'Asia/Ho_Chi_Minh', 'Live schedule baseline did not match the contract')
  return value
}
async function select(id, value) {
  const previous = responseCount, before = JSON.stringify(await currentQuery())
  await cdp.evaluate('(()=>{const e=document.getElementById(' + JSON.stringify(id) + ');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(e,' + JSON.stringify(String(value)) + ');e.dispatchEvent(new Event("input",{bubbles:true}));e.dispatchEvent(new Event("change",{bubbles:true}))})()')
  await cdp.until('document.getElementById(' + JSON.stringify(id) + ').value===' + JSON.stringify(String(value)))
  const query = await currentQuery()
  if (JSON.stringify(query) !== before) await waitResponse(previous)
  const result = await baseline(query); await awaitIds(result.data.map(row => row.id))
  return result
}
async function applyRange(first, last) {
  await field('staff-schedule-from', first, true); await field('staff-schedule-to', last, true)
  const previous = responseCount, before = JSON.stringify(await currentQuery())
  await cdp.evaluate('document.querySelector("[data-staff-schedule] form").requestSubmit()')
  await cdp.until('new URLSearchParams(location.search).get("from")===' + JSON.stringify(first) + ' && new URLSearchParams(location.search).get("to")===' + JSON.stringify(last))
  const query = await currentQuery()
  if (JSON.stringify(query) !== before) await waitResponse(previous)
  const result = await baseline(query); await awaitIds(result.data.map(row => row.id)); return result
}
async function storage() {
  const value = await cdp.evaluate('({local:Object.fromEntries(Object.entries(localStorage)),session:Object.fromEntries(Object.entries(sessionStorage)),cookie:document.cookie})')
  check(value.local['cleanhome-demo-state-staff'] === 'qa-existing-data-do-not-replace' && value.session['cleanhome-qa-existing'] === 'keep-session-storage', 'Existing browser storage canaries changed')
  check(!value.cookie.includes('cleanhome_staff_session') && !/[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/.test(JSON.stringify(value)), 'A Staff cookie or JWT was readable in browser storage')
}
async function screen(width) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 768 }); await delay(150)
  const size = await cdp.evaluate('({width:innerWidth,scroll:document.documentElement.scrollWidth,controls:[...document.querySelectorAll("button,a,input,select")].filter(e=>e.getClientRects().length>0).map(e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,height:r.height,calendar:!!e.closest("[data-staff-schedule]")}})})')
  check(size.scroll <= size.width + 1, 'Calendar overflowed horizontally')
  check(size.controls.every(value => value.left >= -1 && value.right <= size.width + 1 && (!value.calendar || value.height >= 43)), 'A calendar control was clipped or smaller than its touch target')
  if ([375, 1440].includes(width)) { const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); const name = 'uc11-' + width + '.png'; await writeFile(join(artifactDir, name), Buffer.from(shot.data, 'base64')); report.screenshots.push(name) }
}
async function logout() {
  await cdp.evaluate('document.querySelector("button[aria-label^=\\"Tài khoản\\"]").click()')
  await cdp.until('[...document.querySelectorAll("[role=menuitem]")].some(e=>e.innerText.includes("Đăng xuất"))')
  await cdp.evaluate('[...document.querySelectorAll("[role=menuitem]")].find(e=>e.innerText.includes("Đăng xuất")).click()')
  await cdp.until('location.pathname==="/dang-nhap" && !!document.querySelector("input[name=phone]")')
}
function expected(rows, query) {
  const start = Date.parse(query.from + 'T00:00:00Z') - VN, end = Date.parse(query.to + 'T00:00:00Z') + DAY - VN
  return rows.filter(row => Date.parse(row.scheduledAt) < end && Date.parse(row.expectedEndAt) > start)
}
const overallTimeout = setTimeout(() => { report.timedOut = true; try { cdp?.socket.close() } catch {} if (chrome && chrome.exitCode === null) chrome.kill() }, 240000)
overallTimeout.unref()
try {
  await access(chromePath); await mkdir(artifactDir, { recursive: true })
  profile = await mkdtemp(join(tmpdir(), 'cleanhome-staff-uc11-browser-'))
  chrome = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-sync', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--window-size=1440,1000', 'about:blank'], { windowsHide: true, stdio: 'ignore' })
  const deadline = Date.now() + 20000; let port
  while (Date.now() < deadline) { try { port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); if (port) break } catch {} if (chrome.exitCode !== null) throw new Error('Owned Chrome did not start'); await delay(100) }
  check(port, 'DevTools startup timed out')
  const pages = await (await fetch('http://127.0.0.1:' + port + '/json/list', { signal: AbortSignal.timeout(5000) })).json(), page = pages.find(value => value.type === 'page')
  check(page?.webSocketDebuggerUrl, 'Owned browser page unavailable')
  const socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', () => reject(new Error('Owned browser connection failed')), { once: true }) })
  cdp = new CDP(socket)
  const responses = new Map(), bodyChecks = [], forbidden = []
  const allowedApi = path => ['/api/auth/login', '/api/auth/session', '/api/auth/logout', '/api/staff/schedule'].includes(path) || /^\/api\/staff\/jobs\/[1-9]\d{0,18}$/.test(path)
  cdp.listeners.push((method, params) => {
    if (method === 'Runtime.exceptionThrown') report.exceptions++
    if (method === 'Network.requestWillBeSent') {
      const url = new URL(params.request.url)
      if ([4001, 4003, 4005].includes(Number(url.port)) || url.pathname.startsWith('/internal/') || (url.pathname.startsWith('/api/staff/') && params.request.method !== 'GET') || (url.origin === origin && url.pathname.startsWith('/api/') && !allowedApi(url.pathname))) forbidden.push({ path: url.pathname, port: url.port })
      if (url.pathname === '/api/staff/schedule' && [...url.searchParams.keys()].some(key => !['from', 'to', 'status', 'page', 'pageSize', 'sort'].includes(key))) forbidden.push({ path: url.pathname, reason: 'Unexpected calendar query' })
    }
    if (method === 'Network.responseReceived') { const url = new URL(params.response.url); if (url.origin === origin && url.pathname === '/api/staff/schedule') responseCount++; if (url.origin === origin && allowedApi(url.pathname)) responses.set(params.requestId, { path: url.pathname, status: params.response.status }) }
    if (method === 'Network.loadingFinished' && responses.has(params.requestId)) bodyChecks.push(cdp.send('Network.getResponseBody', { requestId: params.requestId }).then(value => { const body = value.base64Encoded ? Buffer.from(value.body, 'base64').toString('utf8') : value.body; if (/"(?:accessToken|password|password_hash|refreshToken)"\s*:|[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/.test(body)) report.credentialLeakDetected = true }).catch(() => {}))
  })
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Network.enable')
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: 'try{if(location.origin===' + JSON.stringify(origin) + '){if(localStorage.getItem("cleanhome-demo-state-staff")===null)localStorage.setItem("cleanhome-demo-state-staff","qa-existing-data-do-not-replace");if(sessionStorage.getItem("cleanhome-qa-existing")===null)sessionStorage.setItem("cleanhome-qa-existing","keep-session-storage")}}catch{}' })
  if (scenario === 'outage') {
    await step('real Auth login remains valid while UC11 reports a stopped Staff dependency', async () => {
      await login(accountA); await cdp.until('document.querySelector("[role=alert]")?.innerText.includes("Chưa thể tải lịch làm việc")')
      check(await cdp.evaluate(uniqueIds + '.length===0 && !document.body.innerText.includes("Không có công việc trong lịch đã chọn")'), 'Outage showed stale calendar entries or a false empty state')
    })
    await step('calendar outage offers focused retry and a new real failing request', async () => {
      await cdp.until('document.activeElement?.getAttribute("role")==="alert"'); const previous = responseCount
      await cdp.evaluate('[...document.querySelectorAll("button")].find(e=>e.innerText==="Thử lại").click()'); await waitResponse(previous)
      await cdp.until('document.querySelector("[role=alert]")?.innerText.includes("Chưa thể tải lịch làm việc")')
    })
    await step('Staff outage returns 503 without revoking the actual Auth session', async () => {
      const statuses = await cdp.evaluate('(async()=>({auth:(await fetch("/api/auth/session",{cache:"no-store"})).status,schedule:(await fetch(' + JSON.stringify('/api/staff/schedule?' + new URLSearchParams(baseQuery)) + ',{cache:"no-store"})).status}))()')
      check(statuses.auth === 200 && statuses.schedule === 503, 'Staff outage changed Auth or did not fail closed'); await storage()
    })
  } else {
    let allA
    await step('employee A calendar contains exactly the verified owned assignments', async () => {
      await login(accountA); allA = await baseline(baseQuery)
      const ids = expected(rowsA, baseQuery).map(row => row.assignmentId)
      check(allA.pagination.total === ids.length && allA.data.length === ids.length && allA.data.every(row => ids.includes(row.id)), 'Calendar A ownership differed from verified MySQL metadata')
      await awaitIds(allA.data.map(row => row.id), true); await storage()
    })
    await step('multiple jobs on the same Vietnam day remain visible without overwriting each other', async () => {
      const counts = new Map(); for (const row of rowsA) { const day = localDay(row.scheduledAt); counts.set(day, (counts.get(day) || 0) + 1) }
      const entry = [...counts].find(([, count]) => count > 1); check(entry, 'Verified dataset needs multiple jobs on one day')
      const ids = expected(rowsA, { from: entry[0], to: entry[0] }).map(row => row.assignmentId)
      const actual = await cdp.evaluate('[...document.querySelectorAll(' + JSON.stringify('[data-schedule-day-group="' + entry[0] + '"] [data-schedule-assignment-id]') + ')].filter(e=>e.getClientRects().length>0).map(e=>e.getAttribute("data-schedule-assignment-id"))')
      check(ids.length === actual.length && ids.every(id => actual.includes(id)), 'A same-day job was overwritten or omitted')
    })
    for (const view of ['day', 'week', 'month', 'list']) await step('calendar ' + view + ' view uses the current real Backend range', async () => { await select('staff-schedule-view', view); check(await cdp.evaluate('document.getElementById("staff-schedule-view").value===' + JSON.stringify(view)), 'Calendar view did not change') })
    await applyRange(from, to); await select('staff-schedule-view', 'month')
    for (const width of [375, 390, 768, 1440]) await step('UC11 responsive layout ' + width, () => screen(width))
    await step('applied date range and status filter are sent to the real Staff API', async () => {
      await applyRange(from, to); const filtered = await select('staff-schedule-status', 'WAITING')
      check(filtered.data.every(row => row.status === 'WAITING'), 'Calendar status filter did not match the actual jobs')
      await select('staff-schedule-status', '')
    })
    await step('descending list order matches the real server schedule order', async () => {
      const descending = await select('staff-schedule-sort', 'desc'); await awaitIds(descending.data.map(row => row.id), true)
    })
    await step('server pagination shows distinct jobs and identifies the calendar as partial', async () => {
      const first = await select('staff-schedule-page-size', '2'); check(first.pagination.totalPages > 1, 'Verified data cannot exercise pagination')
      check(await cdp.evaluate('!!document.querySelector("[role=note]") && document.querySelector("[data-schedule-loaded]").getAttribute("data-schedule-loaded")==="2"'), 'A paginated calendar pretended its first page was complete')
      const previous = responseCount; await cdp.evaluate('[...document.querySelectorAll("button")].find(e=>e.innerText==="Trang sau").click()'); await waitResponse(previous)
      const second = await baseline(await currentQuery()); await awaitIds(second.data.map(row => row.id), true)
      check(second.pagination.page === 2 && second.data.every(row => first.data.every(before => before.id !== row.id)), 'Calendar page two repeated an assignment')
    })
    await step('invalid draft range shows validation and makes no calendar request', async () => {
      await field('staff-schedule-from', '1970-01-01', true); await field('staff-schedule-to', '2026-10-24', true)
      let previous = responseCount; await cdp.evaluate('document.querySelector("[data-staff-schedule] form").requestSubmit()')
      await cdp.until('!!document.querySelector("#staff-schedule-range-error")')
      check(await cdp.evaluate('document.activeElement?.id==="staff-schedule-from"'), 'Invalid start date did not receive focus')
      await delay(150); check(responseCount === previous, 'An invalid start date was sent to Staff')
      await field('staff-schedule-from', '2026-10-25', true); await field('staff-schedule-to', '2026-10-24', true)
      previous = responseCount; await cdp.evaluate('document.querySelector("[data-staff-schedule] form").requestSubmit()')
      await cdp.until('!!document.querySelector("#staff-schedule-range-error")')
      check(await cdp.evaluate('document.activeElement?.id==="staff-schedule-to"'), 'Invalid range did not focus the relevant date field')
      await delay(150); check(responseCount === previous, 'An invalid draft range was sent to Staff')
    })
    await step('a verified empty interval shows an honest empty calendar', async () => {
      check(expected(rowsA, { from: '1971-01-01', to: '1971-01-01' }).length === 0, 'Empty-range metadata was not empty')
      const empty = await applyRange('1971-01-01', '1971-01-01'); check(empty.pagination.total === 0, 'Real empty range returned jobs')
      await cdp.until('document.body.innerText.includes("Không có công việc trong lịch đã chọn")')
    })
    await step('day navigation crosses the calendar year with the correct Vietnam date', async () => {
      await applyRange('2026-12-31', '2026-12-31'); await select('staff-schedule-view', 'day')
      const previous = responseCount; await cdp.evaluate('document.querySelector("button[aria-label=\\"Khoảng thời gian sau\\"]").click()'); await waitResponse(previous)
      await cdp.until('document.getElementById("staff-schedule-from").value==="2027-01-01" && document.getElementById("staff-schedule-to").value==="2027-01-01"')
    })
    await step('month navigation clamps January 31 into the real leap February range', async () => {
      await applyRange('2024-01-31', '2024-01-31'); await select('staff-schedule-view', 'month')
      const previous = responseCount; await cdp.evaluate('document.querySelector("button[aria-label=\\"Khoảng thời gian sau\\"]").click()'); await waitResponse(previous)
      await cdp.until('document.getElementById("staff-schedule-from").value==="2024-02-01" && document.getElementById("staff-schedule-to").value==="2024-02-29"')
    })
    await step('reload restores the calendar URL and correctly refetches A assignments', async () => {
      await applyRange(from, to); await select('staff-schedule-sort', 'asc'); const restored = await select('staff-schedule-page-size', '100')
      const path = await cdp.evaluate('location.pathname+location.search'); await cdp.send('Page.reload')
      await cdp.until('!!document.querySelector("#staff-schedule-from")'); await awaitIds(restored.data.map(row => row.id), true)
      check(await cdp.evaluate('location.pathname+location.search===' + JSON.stringify(path)), 'Reload changed calendar URL state'); await storage()
    })
    await step('calendar opens the real UC10 assignment and browser Back restores the calendar', async () => {
      const ids = await cdp.evaluate(uniqueIds), path = await cdp.evaluate('location.pathname+location.search'); check(ids.length, 'No owned assignment link was visible')
      await cdp.evaluate('[...document.querySelectorAll("[data-schedule-assignment-id]")].find(e=>e.getClientRects().length>0).click()')
      await cdp.until('document.querySelector("[data-assignment-detail-id]")?.getAttribute("data-assignment-detail-id")===' + JSON.stringify(ids[0]))
      await cdp.evaluate('history.back()'); await cdp.until('location.pathname==="/lich-lam-viec" && !!document.querySelector("#staff-schedule-from")')
      await awaitIds(ids, true); check(await cdp.evaluate('location.pathname+location.search===' + JSON.stringify(path)), 'Back lost the calendar state')
    })
    await step('logout removes A calendar entries before a new account can be used', async () => {
      await logout(); check(await cdp.evaluate('!document.querySelector("[data-schedule-assignment-id]")'), 'A calendar survived logout'); await storage()
    })
    await step('employee B sees only B-owned assignments without an A calendar flash', async () => {
      const idsA = rowsA.map(row => row.assignmentId)
      const watch = 'globalThis.__uc11Stale=false;(()=>{const start=()=>new MutationObserver(()=>{if(' + visibleIds + '.some(id=>' + JSON.stringify(idsA) + '.includes(id)))globalThis.__uc11Stale=true}).observe(document.documentElement,{childList:true,subtree:true,attributes:true});if(document.documentElement)start();else document.addEventListener("DOMContentLoaded",start,{once:true})})()'
      await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: watch }); await login(accountB)
      const result = await baseline(baseQuery), ids = expected(rowsB, baseQuery).map(row => row.assignmentId)
      check(result.pagination.total === ids.length && result.data.length === ids.length && result.data.every(row => ids.includes(row.id) && !idsA.includes(row.id)), 'B calendar violated verified ownership')
      await awaitIds(result.data.map(row => row.id), true); check(await cdp.evaluate('globalThis.__uc11Stale===false'), 'A calendar flashed under B'); await storage()
    })
  }
  await step('browser keeps the BFF boundary, existing storage and real session security', async () => {
    await Promise.allSettled(bodyChecks); await storage()
    const cookies = await cdp.send('Network.getCookies', { urls: [origin] }), own = cookies.cookies.filter(value => value.name === 'cleanhome_staff_session')
    check(own.length === 1 && own[0].httpOnly && own[0].sameSite === 'Lax' && own[0].path === '/' && /^[A-Za-z0-9_-]{43}$/.test(own[0].value), 'Staff cookie protections were missing')
    check(!report.credentialLeakDetected && forbidden.length === 0 && report.exceptions === 0, 'Browser crossed a security boundary or raised a JavaScript exception')
    report.http = [...responses.values()]
    check(report.http.some(value => value.path === '/api/staff/schedule' && value.status === (scenario === 'outage' ? 503 : 200)), 'Expected real calendar HTTP status was not observed')
  })
  report.pass = report.checks.length; report.fail = 0; report.skip = 0
} catch (error) {
  report.pass = report.checks.length; report.fail = 1; report.skip = 0; report.failedAt = failedAt; report.error = scrub(error.message); process.exitCode = 1
} finally {
  clearTimeout(overallTimeout)
  try { if (cdp) await cdp.send('Browser.close') } catch {}
  if (chrome && chrome.exitCode === null) chrome.kill()
  if (profile) {
    const target = resolve(profile), base = resolve(tmpdir())
    if (dirname(target) === base && basename(target).startsWith('cleanhome-staff-uc11-browser-')) {
      try { await rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); report.profileClosed = true } catch { report.profileClosed = false }
    }
  }
  await mkdir(artifactDir, { recursive: true }); await writeFile(join(artifactDir, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ pass: report.pass || 0, fail: report.fail || 0, skip: report.skip || 0, failedAt: report.failedAt, report: join(artifactDir, 'report.json'), screenshots: report.screenshots, profileClosed: report.profileClosed }))
}
