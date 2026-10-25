import { spawn } from 'node:child_process'
import { readFile, writeFile, mkdir, mkdtemp, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, basename, resolve, join } from 'node:path'

if (process.env.RUN_STAFF_UC10_BROWSER_TESTS !== 'true') {
  console.log(JSON.stringify({ browser: 'NOT_RUN', reason: 'Explicit opt-in, real Auth credentials and assignment metadata are required' }))
  process.exit(0)
}

const origin = new URL(process.env.STAFF_BFF_TEST_BASE_URL || 'http://localhost:3002').origin
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)) throw new Error('UC10 browser QA requires a loopback frontend')
const scenario = process.env.STAFF_UC10_BROWSER_SCENARIO || 'regular'
if (!['regular', 'outage'].includes(scenario)) throw new Error('Unknown UC10 browser scenario')
const accountA = { phone: process.env.STAFF_BFF_TEST_PHONE_A, password: process.env.STAFF_BFF_TEST_PASSWORD_A }
const accountB = { phone: process.env.STAFF_BFF_TEST_PHONE_B, password: process.env.STAFF_BFF_TEST_PASSWORD_B }
if (![accountA.phone, accountA.password, ...(scenario === 'regular' ? [accountB.phone, accountB.password] : [])].every(value => typeof value === 'string' && value.length)) throw new Error('Real Auth test credentials are required; values withheld')
function expectedIds(name) {
  const values = String(process.env[name] || '').split(',').filter(Boolean)
  if (!values.length || values.some(value => !/^[1-9]\d{0,18}$/.test(value)) || new Set(values).size !== values.length) throw new Error('Verified read-only assignment metadata is required')
  return values
}
const expectedA = expectedIds('STAFF_UC10_TEST_ASSIGNMENT_IDS_A')
const expectedB = scenario === 'regular' ? expectedIds('STAFF_UC10_TEST_ASSIGNMENT_IDS_B') : []
if (expectedA.some(value => expectedB.includes(value))) throw new Error('Assignment ownership metadata overlaps unexpectedly')
const chromePath = process.env.STAFF_BFF_CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const artifactDir = resolve('.auth-data/qa/uc10/' + (scenario === 'outage' ? 'browser-outage' : 'browser'))
const report = { browser: 'Chrome headless with isolated QA profile', scenario, origin, checks: [], screenshots: [], exceptions: 0, credentialLeakDetected: false }
let chrome, profile, cdp, failedAt = 'initialization', jobsResponseCount = 0
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
function check(value, message) { if (!value) throw new Error(message) }
function scrub(value) {
  let text = String(value)
  for (const account of [accountA, accountB]) if (account.password) text = text.split(account.password).join('[REDACTED]')
  return text.replace(/[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g, '[REDACTED_TOKEN]')
}
const visibleIdsExpression = '[...document.querySelectorAll("[data-assignment-id]")].filter(e=>e.getClientRects().length>0).map(e=>e.getAttribute("data-assignment-id"))'
class CDP {
  constructor(socket) {
    this.socket = socket; this.next = 1; this.pending = new Map(); this.listeners = []
    socket.addEventListener('message', event => {
      const data = JSON.parse(event.data)
      if (data.id) {
        const entry = this.pending.get(data.id)
        if (entry) { clearTimeout(entry.timer); this.pending.delete(data.id); data.error ? entry.reject(new Error('CDP command rejected')) : entry.resolve(data.result) }
      } else for (const listener of this.listeners) listener(data.method, data.params)
    })
    socket.addEventListener('close', () => {
      for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('Owned browser connection closed')) }
      this.pending.clear()
    })
  }
  async send(method, params = {}) {
    if (this.socket.readyState !== WebSocket.OPEN) throw new Error('Owned browser connection unavailable')
    const id = this.next++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('CDP command timed out')) }, 15000)
      this.pending.set(id, { resolve, reject, timer })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }
  async evaluate(expression) {
    const response = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (response.exceptionDetails) throw new Error('Browser expression failed; expression and credentials withheld')
    return response.result.value
  }
  async until(expression, timeout = 25000) {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) { if (await this.evaluate(expression)) return; await delay(100) }
    throw new Error('Browser condition timed out; expression withheld')
  }
  async navigate(path) {
    await this.send('Page.navigate', { url: origin + path })
    await this.until('document.readyState === "complete"')
  }
}
async function step(name, action) {
  failedAt = name; await action(); report.checks.push({ name, status: 'PASS' })
}
async function skip(name, reason) { report.checks.push({ name, status: 'SKIP', reason }) }
const ownA = expectedA[0], ownB = expectedB[0]
const missingId = process.env.STAFF_UC10_TEST_MISSING_ASSIGNMENT_ID || '9223372036854775807'
if (!/^[1-9]\d{0,18}$/.test(missingId) || expectedA.includes(missingId) || expectedB.includes(missingId)) throw new Error('Missing assignment ID metadata is invalid')

async function login(account, returnPath = '/cong-viec') {
  await cdp.navigate('/dang-nhap?next=' + encodeURIComponent(returnPath))
  await cdp.until('!!document.querySelector("input[name=phone]")')
  for (const [name, value] of [['phone', account.phone], ['password', account.password]]) {
    check(await cdp.evaluate('(()=>{const e=document.querySelector(' + JSON.stringify('input[name="' + name + '"]') + ');if(!e)return false;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,' + JSON.stringify(value) + ');e.dispatchEvent(new Event("input",{bubbles:true}));e.dispatchEvent(new Event("change",{bubbles:true}));return true})()'), 'Login field unavailable')
  }
  await cdp.evaluate('document.querySelector("form").requestSubmit()')
  await cdp.until('location.pathname===' + JSON.stringify(returnPath.split('?')[0]) + ' && !document.querySelector("input[name=phone]")')
}
async function storage() {
  const value = await cdp.evaluate('({local:Object.fromEntries(Object.entries(localStorage)),session:Object.fromEntries(Object.entries(sessionStorage)),cookie:document.cookie})')
  check(value.local['cleanhome-demo-state-staff'] === 'qa-existing-data-do-not-replace', 'Existing localStorage canary changed')
  check(value.session['cleanhome-qa-existing'] === 'keep-session-storage', 'Existing sessionStorage canary changed')
  check(!value.cookie.includes('cleanhome_staff_session'), 'HttpOnly cookie was readable by JavaScript')
  check(!/[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/.test(JSON.stringify(value)), 'JWT appeared in browser storage')
}
async function baseline(query = {}) {
  const params = new URLSearchParams({ page: '1', pageSize: '20', sort: 'asc', ...query })
  const value = await cdp.evaluate('(async()=>{const r=await fetch(' + JSON.stringify('/api/staff/jobs?' + params) + ',{cache:"no-store",credentials:"same-origin"});const p=await r.json();return {status:r.status,ids:Array.isArray(p.data)?p.data.map(x=>x.assignmentId):null,pagination:p.pagination}})()')
  check(value.status === 200 && Array.isArray(value.ids), 'Real UC9 reference request failed')
  return value
}
async function awaitIds(ids) { await cdp.until('JSON.stringify(' + visibleIdsExpression + ')===' + JSON.stringify(JSON.stringify(ids))) }
async function awaitJobsResponse(previousCount) {
  const deadline = Date.now() + 25000
  while (Date.now() < deadline) { if (jobsResponseCount > previousCount) return; await delay(100) }
  throw new Error('UC9 controls did not produce a new response')
}
async function select(id, value, expected) {
  const previousCount = jobsResponseCount
  await cdp.evaluate('(()=>{const e=document.getElementById(' + JSON.stringify(id) + ');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(e,' + JSON.stringify(String(value)) + ');e.dispatchEvent(new Event("input",{bubbles:true}));e.dispatchEvent(new Event("change",{bubbles:true}))})()')
  await awaitJobsResponse(previousCount); await awaitIds(expected)
}
async function awaitDetail(id) { await cdp.until('document.querySelector("[data-assignment-detail-id]")?.getAttribute("data-assignment-detail-id")===' + JSON.stringify(id)) }
async function notFound() {
  await cdp.until('!!document.querySelector("[role=alert]") && document.querySelector("[role=alert]").innerText.includes("Không tìm thấy công việc")')
  check(await cdp.evaluate('!document.querySelector("[data-assignment-detail-id]")'), 'A not-found response exposed old detail data')
}
async function screen(width) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 768 })
  await delay(150)
  const size = await cdp.evaluate('({width:innerWidth,scroll:document.documentElement.scrollWidth,controls:[...document.querySelectorAll("button,a,select")].filter(e=>e.getClientRects().length>0).map(e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,height:r.height,detail:!!e.closest("main")}})})')
  check(size.scroll <= size.width + 1, 'UC10 detail overflowed the viewport')
  check(size.controls.every(value => value.left >= -1 && value.right <= size.width + 1 && (!value.detail || value.height >= 43)), 'A detail control was clipped or smaller than the touch target')
  if ([375, 1440].includes(width)) {
    const image = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    const name = 'uc10-' + width + '.png'
    await writeFile(join(artifactDir, name), Buffer.from(image.data, 'base64')); report.screenshots.push(name)
  }
}
async function verifyDetail(id) {
  const result = await cdp.evaluate('(async()=>{const r=await fetch(' + JSON.stringify('/api/staff/jobs/' + id) + ',{cache:"no-store",credentials:"same-origin"});const p=await r.json(),d=p.data,e=document.querySelector("[data-assignment-detail-id]"),t=e?.innerText||"";const fmt=v=>{const a=new Intl.DateTimeFormat("vi-VN",{timeZone:"Asia/Ho_Chi_Minh",hour:"2-digit",minute:"2-digit",hourCycle:"h23",day:"2-digit",month:"2-digit",year:"numeric"}).formatToParts(new Date(v));const q=x=>a.find(y=>y.type===x)?.value;return q("hour")+":"+q("minute")+" · "+q("day")+"/"+q("month")+"/"+q("year")};return {http:r.status,id:d?.assignmentId,valid:!!d&&e?.getAttribute("data-assignment-detail-id")===d.assignmentId&&t.includes("Phân công #"+d.assignmentId)&&t.includes("Đơn dịch vụ #"+d.orderId)&&d.services.every(s=>(!s.name||t.includes(s.name))&&t.includes(s.quantity))&&[d.contact.name,d.contact.address,d.contact.phone].filter(Boolean).every(s=>t.includes(s))&&(!d.scheduledAt||t.includes(fmt(d.scheduledAt)))&&!e.querySelector("form,textarea,button")}})()')
  check(result.http === 200 && result.id === id && result.valid, 'Rendered detail did not match the actual Staff DTO or exposed write controls')
}
async function logout() {
  await cdp.evaluate('document.querySelector("button[aria-label^=\\"Tài khoản\\"]").click()')
  await cdp.until('[...document.querySelectorAll("[role=menuitem]")].some(e=>e.innerText.includes("Đăng xuất"))')
  await cdp.evaluate('[...document.querySelectorAll("[role=menuitem]")].find(e=>e.innerText.includes("Đăng xuất")).click()')
  await cdp.until('location.pathname==="/dang-nhap" && !!document.querySelector("input[name=phone]")')
}
const overallTimeout = setTimeout(() => {
  report.timedOut = true
  try { cdp?.socket.close() } catch {}
  if (chrome && chrome.exitCode === null) chrome.kill()
}, 240000)
overallTimeout.unref()
try {
  await access(chromePath); await mkdir(artifactDir, { recursive: true })
  profile = await mkdtemp(join(tmpdir(), 'cleanhome-staff-uc10-browser-'))
  chrome = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-sync', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--window-size=1440,1000', 'about:blank'], { windowsHide: true, stdio: 'ignore' })
  const deadline = Date.now() + 20000
  let port
  while (Date.now() < deadline) {
    try { port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); if (port) break } catch {}
    if (chrome.exitCode !== null) throw new Error('Owned headless Chrome did not start')
    await delay(100)
  }
  check(port, 'DevTools startup timed out')
  const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list', { signal: AbortSignal.timeout(5000) })).json()
  const target = targets.find(value => value.type === 'page')
  check(target?.webSocketDebuggerUrl, 'Owned browser page unavailable')
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', () => reject(new Error('Owned browser connection failed')), { once: true }) })
  cdp = new CDP(socket)
  const responses = new Map(), bodyChecks = [], forbiddenRequests = []
  const allowedApi = path => ['/api/auth/login', '/api/auth/session', '/api/auth/logout', '/api/staff/jobs'].includes(path) || /^\/api\/staff\/jobs\/[1-9]\d{0,18}$/.test(path)
  cdp.listeners.push((method, params) => {
    if (method === 'Runtime.exceptionThrown') report.exceptions++
    if (method === 'Network.requestWillBeSent') {
      const url = new URL(params.request.url)
      if ((url.pathname.startsWith('/api/staff/') && params.request.method !== 'GET') || [4001, 4003, 4005].includes(Number(url.port)) || url.pathname.startsWith('/internal/') || (url.origin === origin && url.pathname.startsWith('/api/') && !allowedApi(url.pathname))) forbiddenRequests.push({ path: url.pathname, port: url.port })
    }
    if (method === 'Network.responseReceived') {
      const url = new URL(params.response.url)
      if (url.origin === origin && url.pathname === '/api/staff/jobs') jobsResponseCount++
      if (url.origin === origin && allowedApi(url.pathname)) responses.set(params.requestId, { path: url.pathname, status: params.response.status })
    }
    if (method === 'Network.loadingFinished' && responses.has(params.requestId)) {
      bodyChecks.push(cdp.send('Network.getResponseBody', { requestId: params.requestId }).then(result => {
        const body = result.base64Encoded ? Buffer.from(result.body, 'base64').toString('utf8') : result.body
        if (/"(?:accessToken|password|password_hash|refreshToken)"\s*:|[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/.test(body)) report.credentialLeakDetected = true
      }).catch(() => {}))
    }
  })
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Network.enable')
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: 'try{if(location.origin===' + JSON.stringify(origin) + '){if(localStorage.getItem("cleanhome-demo-state-staff")===null)localStorage.setItem("cleanhome-demo-state-staff","qa-existing-data-do-not-replace");if(sessionStorage.getItem("cleanhome-qa-existing")===null)sessionStorage.setItem("cleanhome-qa-existing","keep-session-storage")}}catch{}' })


  if (scenario === 'outage') {
    await step('Auth login succeeds and protected detail shows a real Staff dependency error', async () => {
      await login(accountA, '/don/' + ownA)
      await cdp.until('!!document.querySelector("[role=alert]") && document.querySelector("[role=alert]").innerText.includes("Chưa thể tải thông tin công việc")')
      check(await cdp.evaluate('!document.querySelector("[data-assignment-detail-id]") && !document.body.innerText.includes("Không tìm thấy công việc")'), 'Staff outage showed stale detail or a false 404')
    })
    await step('detail outage provides accessible retry without returning assignment data', async () => {
      await cdp.until('document.activeElement?.getAttribute("role")==="alert"')
      const previous = [...responses.values()].filter(value => value.path === '/api/staff/jobs/' + ownA).length
      await cdp.evaluate('[...document.querySelectorAll("button")].find(e=>e.innerText==="Thử lại").click()')
      const deadline = Date.now() + 25000
      while (Date.now() < deadline && [...responses.values()].filter(value => value.path === '/api/staff/jobs/' + ownA).length <= previous) await delay(100)
      check([...responses.values()].filter(value => value.path === '/api/staff/jobs/' + ownA).length > previous, 'Detail retry made no HTTP request')
      await cdp.until('!!document.querySelector("[role=alert]") && !document.querySelector("[data-assignment-detail-id]")')
    })
    await step('Auth session remains valid while the actual detail BFF returns 503', async () => {
      const codes = await cdp.evaluate('(async()=>({session:(await fetch("/api/auth/session",{cache:"no-store"})).status,detail:(await fetch(' + JSON.stringify('/api/staff/jobs/' + ownA) + ',{cache:"no-store"})).status}))()')
      check(codes.session === 200 && codes.detail === 503, 'Staff outage invalidated Auth or did not return 503')
      await storage()
    })
  } else {
    let savedList, selectedId, foreignText
    await step('real employee A opens only their own UC9 assignments', async () => {
      await login(accountA)
      const list = await baseline()
      check(list.pagination.total === expectedA.length && list.ids.every(id => expectedA.includes(id)), 'Employee A list did not match verified assignment ownership')
      await awaitIds(list.ids)
    })
    await step('UC9 status, descending sort, page size and page are recorded in the validated URL', async () => {
      const waiting = await baseline({ status: 'WAITING' })
      check(waiting.pagination.total > 2, 'The read-only dataset does not have enough WAITING assignments for this navigation check')
      await select('staff-jobs-status', 'WAITING', waiting.ids)
      const sorted = await baseline({ status: 'WAITING', sort: 'desc' })
      await select('staff-jobs-sort', 'desc', sorted.ids)
      const first = await baseline({ status: 'WAITING', sort: 'desc', pageSize: '2' })
      await select('staff-jobs-page-size', '2', first.ids)
      const next = await baseline({ status: 'WAITING', sort: 'desc', pageSize: '2', page: '2' })
      await cdp.evaluate('[...document.querySelectorAll("button")].find(e=>e.innerText==="Sau").click()')
      await awaitIds(next.ids)
      savedList = await cdp.evaluate('({url:location.pathname+location.search,ids:' + visibleIdsExpression + '})')
      const query = new URL(savedList.url, origin).searchParams
      check(query.get('status') === 'WAITING' && query.get('sort') === 'desc' && query.get('pageSize') === '2' && query.get('page') === '2', 'UC9 URL lost active filters or pagination')
    })
    await step('UC9 detail link uses the actual assignment and preserves the list return URL', async () => {
      const href = await cdp.evaluate('[...document.querySelectorAll("a[href^=\\"/don/\\"]")].find(e=>e.getClientRects().length>0)?.getAttribute("href")')
      const target = new URL(href, origin)
      selectedId = target.pathname.split('/')[2]
      check(expectedA.includes(selectedId) && target.searchParams.get('from') === savedList.url, 'Detail link did not preserve assignment ID or list URL')
      await cdp.evaluate('[...document.querySelectorAll("a[href^=\\"/don/\\"]")].find(e=>e.getClientRects().length>0).click()')
      await awaitDetail(selectedId)
      check(await cdp.evaluate('location.pathname===' + JSON.stringify('/don/' + selectedId)), 'Detail navigation used the wrong assignment')
    })
    for (const width of [375, 390, 768, 1440]) await step('UC10 responsive detail layout ' + width, () => screen(width))
    await step('rendered services, contact, Vietnam schedule and read-only detail match the real DTO', () => verifyDetail(selectedId))
    await step('detail reload restores the session and refetches the same real assignment', async () => {
      await cdp.send('Page.reload'); await awaitDetail(selectedId); await verifyDetail(selectedId); await storage()
    })
    await step('returning to UC9 preserves every filter, page and visible assignment', async () => {
      await cdp.evaluate('[...document.querySelectorAll("a")].find(e=>e.getClientRects().length>0&&e.innerText.includes("Trở về công việc")).click()')
      await cdp.until('!!document.querySelector("#staff-jobs-status")')
      await awaitIds(savedList.ids)
      check(await cdp.evaluate('location.pathname+location.search===' + JSON.stringify(savedList.url) + ' && document.querySelector("#staff-jobs-status").value==="WAITING" && document.querySelector("#staff-jobs-sort").value==="desc" && document.querySelector("#staff-jobs-page-size").value==="2"'), 'UC9 return did not preserve the active list state')
    })
    await step('A cannot read a B-only assignment by editing the URL and the session remains valid', async () => {
      await cdp.navigate('/don/' + ownB); await notFound()
      foreignText = await cdp.evaluate('document.querySelector("[role=alert]").innerText')
      const status = await cdp.evaluate('(async()=>({session:(await fetch("/api/auth/session",{cache:"no-store"})).status,detail:(await fetch(' + JSON.stringify('/api/staff/jobs/' + ownB) + ',{cache:"no-store"})).status}))()')
      check(status.session === 200 && status.detail === 404, 'Cross-assignment request did not retain Auth and return safe 404')
    })
    await step('a missing assignment shows the same safe 404 state as an assignment owned by another employee', async () => {
      await cdp.navigate('/don/' + missingId); await notFound()
      check(await cdp.evaluate('document.querySelector("[role=alert]").innerText===' + JSON.stringify(foreignText)), 'Not-found UI disclosed an ownership difference')
    })
    await step('invalid assignment URL is rejected by UI before calling the detail BFF', async () => {
      await cdp.navigate('/don/0')
      await cdp.until('document.body.innerText.includes("Đường dẫn công việc chưa hợp lệ")')
      check(![...responses.values()].some(value => value.path === '/api/staff/jobs/0'), 'Invalid ID was sent to the BFF')
      check(await cdp.evaluate('!document.querySelector("[data-assignment-detail-id]")'), 'Invalid ID exposed stale detail')
    })
    await step('return parameter cannot redirect the detail back link outside the fixed UC9 path', async () => {
      await cdp.navigate('/don/' + ownA + '?from=' + encodeURIComponent('https://attacker.invalid'))
      await awaitDetail(ownA)
      check(await cdp.evaluate('[...document.querySelectorAll("a")].find(e=>e.getClientRects().length>0&&e.innerText.includes("Trở về công việc"))?.getAttribute("href")==="/cong-viec"'), 'An unsafe return URL reached the detail back link')
    })
    await step('own detail recovers after denied or invalid navigation without a cached foreign record', async () => {
      await cdp.navigate('/don/' + ownA); await awaitDetail(ownA); await verifyDetail(ownA)
    })
    await step('logout from detail removes its payload and the Frontend session cookie', async () => {
      await logout()
      check(await cdp.evaluate('!document.querySelector("[data-assignment-detail-id]")'), 'Detail remained visible after logout')
      const cookies = await cdp.send('Network.getCookies', { urls: [origin] })
      check(!cookies.cookies.some(value => value.name === 'cleanhome_staff_session'), 'Logout retained the old Frontend cookie')
      await storage()
    })
    await step('B logging into the same A URL receives 404 without flashing the old A detail', async () => {
      const watch = '(()=>{globalThis.__uc10StaleDetected=false;const observer=new MutationObserver(()=>{const id=document.querySelector("[data-assignment-detail-id]")?.getAttribute("data-assignment-detail-id");if(' + JSON.stringify(expectedA) + '.includes(id))globalThis.__uc10StaleDetected=true});const start=()=>observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true});if(document.documentElement)start();else document.addEventListener("DOMContentLoaded",start,{once:true})})()'
      await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: watch })
      await login(accountB, '/don/' + ownA); await notFound()
      check(await cdp.evaluate('globalThis.__uc10StaleDetected===false'), 'An A assignment flashed under the B session')
    })
    await step('B can open their own real assignment after the safe ownership denial', async () => {
      await cdp.navigate('/don/' + ownB); await awaitDetail(ownB); await verifyDetail(ownB)
      check(await cdp.evaluate('globalThis.__uc10StaleDetected===false'), 'A detail leaked while B opened their own assignment')
      await storage()
    })
  }
  await step('only fixed read BFF routes are called and JWT, storage and JavaScript boundaries remain safe', async () => {
    await Promise.allSettled(bodyChecks); await storage()
    check(!report.credentialLeakDetected && forbiddenRequests.length === 0, 'Browser crossed the fixed read-only BFF boundary')
    check(report.exceptions === 0, 'Browser raised a JavaScript exception')
    report.http = [...responses.values()]
    check(report.http.some(value => value.path === '/api/auth/login' && value.status === 200), 'No real Auth login response was observed')
    check(report.http.some(value => /^\/api\/staff\/jobs\/\d+$/.test(value.path) && value.status === (scenario === 'outage' ? 503 : 200)), 'No expected real detail HTTP response was observed')
  })
  report.pass = report.checks.filter(value => value.status === 'PASS').length; report.fail = 0
  report.skip = report.checks.filter(value => value.status === 'SKIP').length
} catch (error) {
  report.pass = report.checks.filter(value => value.status === 'PASS').length; report.fail = 1
  report.skip = report.checks.filter(value => value.status === 'SKIP').length
  report.failedAt = failedAt; report.error = scrub(error.message); process.exitCode = 1
} finally {
  clearTimeout(overallTimeout)
  try { if (cdp) await cdp.send('Browser.close') } catch {}
  if (chrome && chrome.exitCode === null) chrome.kill()
  if (profile) {
    const target = resolve(profile), base = resolve(tmpdir())
    if (dirname(target) === base && basename(target).startsWith('cleanhome-staff-uc10-browser-')) {
      try { await rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); report.profileClosed = true } catch { report.profileClosed = false }
    }
  }
  await mkdir(artifactDir, { recursive: true })
  await writeFile(join(artifactDir, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ pass: report.pass || 0, fail: report.fail || 0, skip: report.skip || 0, failedAt: report.failedAt, report: join(artifactDir, 'report.json'), screenshots: report.screenshots, profileClosed: report.profileClosed }))
}
