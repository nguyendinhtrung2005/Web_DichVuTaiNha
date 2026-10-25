import { spawn } from 'node:child_process'
import { readFile, writeFile, mkdir, mkdtemp, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, basename, resolve, join } from 'node:path'

if (process.env.RUN_STAFF_UC9_BROWSER_TESTS !== 'true') {
  console.log(JSON.stringify({ browser: 'NOT_RUN', reason: 'Explicit opt-in, real Auth credentials and assignment metadata are required' }))
  process.exit(0)
}

const origin = new URL(process.env.STAFF_BFF_TEST_BASE_URL || 'http://localhost:3002').origin
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)) throw new Error('UC9 browser QA requires a loopback frontend')
const scenario = process.env.STAFF_UC9_BROWSER_SCENARIO || 'regular'
if (!['regular', 'outage'].includes(scenario)) throw new Error('Unknown UC9 browser scenario')
const accountA = { phone: process.env.STAFF_BFF_TEST_PHONE_A, password: process.env.STAFF_BFF_TEST_PASSWORD_A }
const accountB = { phone: process.env.STAFF_BFF_TEST_PHONE_B, password: process.env.STAFF_BFF_TEST_PASSWORD_B }
if (![accountA.phone, accountA.password, ...(scenario === 'regular' ? [accountB.phone, accountB.password] : [])].every(value => typeof value === 'string' && value.length)) throw new Error('Real Auth test credentials are required; values withheld')
function expectedIds(name) {
  const values = String(process.env[name] || '').split(',').filter(Boolean)
  if (!values.length || values.some(value => !/^[1-9]\d{0,18}$/.test(value)) || new Set(values).size !== values.length) throw new Error('Verified read-only assignment metadata is required')
  return values
}
const expectedA = scenario === 'regular' ? expectedIds('STAFF_UC9_EXPECTED_ASSIGNMENT_IDS_A') : []
const expectedB = scenario === 'regular' ? expectedIds('STAFF_UC9_EXPECTED_ASSIGNMENT_IDS_B') : []
if (expectedA.some(value => expectedB.includes(value))) throw new Error('Assignment ownership metadata overlaps unexpectedly')
const chromePath = process.env.STAFF_BFF_CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const artifactDir = resolve('.auth-data/qa/uc9/' + (scenario === 'outage' ? 'browser-outage' : 'browser'))
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
async function login(account) {
  await cdp.navigate('/dang-nhap?next=%2Fcong-viec')
  await cdp.until('!!document.querySelector("input[name=phone]")')
  for (const [name, value] of [['phone', account.phone], ['password', account.password]]) {
    check(await cdp.evaluate('(() => {const e=document.querySelector(' + JSON.stringify('input[name="' + name + '"]') + ');if(!e)return false;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,' + JSON.stringify(value) + ');e.dispatchEvent(new Event("input",{bubbles:true}));e.dispatchEvent(new Event("change",{bubbles:true}));return true})()'), 'Login field unavailable')
  }
  await cdp.evaluate('document.querySelector("form").requestSubmit()')
  await cdp.until('location.pathname==="/cong-viec" && !!document.querySelector("#staff-jobs-status")')
}
async function storage() {
  const value = await cdp.evaluate('({local:Object.fromEntries(Object.entries(localStorage)),session:Object.fromEntries(Object.entries(sessionStorage)),cookie:document.cookie})')
  check(value.local['cleanhome-demo-state-staff'] === 'qa-existing-data-do-not-replace', 'Existing localStorage canary changed')
  check(value.session['cleanhome-qa-existing'] === 'keep-session-storage', 'Existing sessionStorage canary changed')
  check(!value.cookie.includes('cleanhome_staff_session'), 'HttpOnly cookie readable by JavaScript')
  check(!/[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/.test(JSON.stringify(value)), 'JWT found in browser storage')
}
async function baseline(query = {}) {
  const params = new URLSearchParams({ page: '1', pageSize: '20', sort: 'asc', ...query })
  const result = await cdp.evaluate('(async()=>{const r=await fetch(' + JSON.stringify('/api/staff/jobs?' + params) + ',{credentials:"same-origin",cache:"no-store"});const p=await r.json();return {status:r.status,data:Array.isArray(p.data)?p.data.map(x=>({id:x.assignmentId,status:x.status})):null,pagination:p.pagination,timezone:p.timezone}})()')
  check(result.status === 200 && Array.isArray(result.data) && result.timezone === 'Asia/Ho_Chi_Minh', 'Real UC9 baseline failed')
  return result
}
async function awaitIds(ids) {
  await cdp.until('JSON.stringify(' + visibleIdsExpression + ')===' + JSON.stringify(JSON.stringify(ids)))
}
async function awaitJobsResponse(previousCount) {
  const deadline = Date.now() + 25000
  while (Date.now() < deadline) { if (jobsResponseCount > previousCount) return; await delay(100) }
  throw new Error('UC9 UI did not receive a new HTTP response')
}
async function select(id, value, expected) {
  const previousCount = jobsResponseCount
  await cdp.evaluate('(()=>{const e=document.getElementById(' + JSON.stringify(id) + ');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(e,' + JSON.stringify(String(value)) + ');e.dispatchEvent(new Event("input",{bubbles:true}));e.dispatchEvent(new Event("change",{bubbles:true}))})()')
  await awaitJobsResponse(previousCount)
  await awaitIds(expected)
}
async function screen(width) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 768 })
  await delay(150)
  const sizes = await cdp.evaluate('({width:innerWidth,scroll:document.documentElement.scrollWidth,controls:[...document.querySelectorAll("button,select,a[href^=\\"/don/\\"]")].filter(e=>e.getClientRects().length>0).map(e=>{const r=e.getBoundingClientRect();return {tag:e.tagName,id:e.id,aria:e.getAttribute("aria-label"),uc9:!!e.closest("section[aria-label=\\"Lọc công việc\\"],nav[aria-label=\\"Phân trang công việc\\"],[data-assignment-id]"),left:r.left,right:r.right,height:r.height}})})')
  report.layoutDiagnostics = { width, scroll: sizes.scroll, failedControls: sizes.controls.filter(value => value.left < -1 || value.right > sizes.width + 1 || (value.uc9 && value.height < 43)), existingHeaderControls: sizes.controls.filter(value => !value.uc9 && value.height < 43) }
  check(sizes.scroll <= sizes.width + 1, 'UC9 horizontal overflow')
  check(sizes.controls.every(value => value.left >= -1 && value.right <= sizes.width + 1 && (!value.uc9 || value.height >= 43)), 'A UC9 control exceeded the viewport or was too small')
  if ([375, 1440].includes(width)) {
    const image = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    const name = 'uc9-' + width + '.png'
    await writeFile(join(artifactDir, name), Buffer.from(image.data, 'base64')); report.screenshots.push(name)
  }
}
const overallTimeout = setTimeout(() => {
  report.timedOut = true
  try { cdp?.socket.close() } catch {}
  if (chrome && chrome.exitCode === null) chrome.kill()
}, 240000)
overallTimeout.unref()
try {
  await access(chromePath); await mkdir(artifactDir, { recursive: true })
  profile = await mkdtemp(join(tmpdir(), 'cleanhome-staff-uc9-browser-'))
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
  const allowedApi = new Set(['/api/auth/login', '/api/auth/session', '/api/auth/logout', '/api/staff/jobs'])
  cdp.listeners.push((method, params) => {
    if (method === 'Runtime.exceptionThrown') report.exceptions++
    if (method === 'Network.requestWillBeSent') {
      const url = new URL(params.request.url)
      if ([4001, 4003, 4005].includes(Number(url.port)) || url.pathname.startsWith('/internal/') || (url.origin === origin && url.pathname.startsWith('/api/') && !allowedApi.has(url.pathname))) forbiddenRequests.push({ path: url.pathname, port: url.port })
    }
    if (method === 'Network.responseReceived') {
      const url = new URL(params.response.url)
      if (url.origin === origin && url.pathname === '/api/staff/jobs') jobsResponseCount++
      if (url.origin === origin && allowedApi.has(url.pathname)) responses.set(params.requestId, { path: url.pathname, status: params.response.status })
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
    await step('real Auth login remains available while the Staff dependency is stopped', async () => {
      await login(accountA)
      await cdp.until('!!document.querySelector("[role=alert]") && document.querySelector("[role=alert]").innerText.includes("Chưa thể tải công việc")')
      check(await cdp.evaluate(visibleIdsExpression + '.length===0'), 'Assignments remained visible during outage')
    })
    await step('Staff outage shows an accessible retry state without pretending the list is empty', async () => {
      check(await cdp.evaluate('document.activeElement?.getAttribute("role")==="alert"'), 'Outage alert did not receive focus')
      check(await cdp.evaluate('!document.body.innerText.includes("Bạn chưa có công việc được phân công") && [...document.querySelectorAll("button")].some(e=>e.innerText==="Thử lại")'), 'Outage was mistaken for an empty list')
      const previousCount = jobsResponseCount
      await cdp.evaluate('[...document.querySelectorAll("button")].find(e=>e.innerText==="Thử lại").click()')
      await awaitJobsResponse(previousCount)
      await cdp.until('!!document.querySelector("[role=alert]") && document.querySelector("[role=alert]").innerText.includes("Chưa thể tải công việc")')
      check(await cdp.evaluate(visibleIdsExpression + '.length===0'), 'Retry exposed stale assignments')
    })
    await step('Auth session stays valid and UC9 returns real 503 during Staff outage', async () => {
      const statuses = await cdp.evaluate('(async()=>({session:(await fetch("/api/auth/session",{cache:"no-store"})).status,jobs:(await fetch("/api/staff/jobs",{cache:"no-store"})).status}))()')
      check(statuses.session === 200 && statuses.jobs === 503, 'Dependency failure invalidated Auth or did not return 503')
      await storage()
    })
  } else {
    let listA
    await step('real employee A sees exactly their own verified MySQL assignments', async () => {
      await login(accountA); listA = await baseline()
      check(listA.pagination.total === expectedA.length && listA.data.every(value => expectedA.includes(value.id)), 'A ownership differed from verified MySQL metadata')
      await awaitIds(listA.data.map(value => value.id)); await storage()
      report.employeeA = { total: listA.pagination.total, assignmentIds: listA.data.map(value => value.id) }
    })
    for (const width of [375, 390, 768, 1440]) await step('UC9 responsive layout ' + width, () => screen(width))
    await step('status filter matches the real Staff API', async () => {
      const status = listA.data.find(value => value.status === 'WAITING')?.status || listA.data[0]?.status
      check(status, 'A has no assignments available for status filtering')
      const filtered = await baseline({ status })
      check(filtered.data.every(value => value.status === status), 'Backend status filter mismatch')
      await select('staff-jobs-status', status, filtered.data.map(value => value.id))
      await select('staff-jobs-status', '', listA.data.map(value => value.id))
    })
    await step('descending schedule sort matches the real Staff API order', async () => {
      const sorted = await baseline({ sort: 'desc' })
      await select('staff-jobs-sort', 'desc', sorted.data.map(value => value.id))
    })
    await step('server pageSize and next-page controls show distinct real assignments', async () => {
      const first = await baseline({ pageSize: '2', sort: 'desc' })
      await select('staff-jobs-page-size', '2', first.data.map(value => value.id))
      check(first.pagination.totalPages > 1, 'Verified dataset has insufficient rows for a second page')
      const next = await baseline({ page: '2', pageSize: '2', sort: 'desc' })
      await cdp.evaluate('[...document.querySelectorAll("button")].find(e=>e.innerText==="Sau").click()')
      await awaitIds(next.data.map(value => value.id))
      check(!next.data.some(value => first.data.some(previous => previous.id === value.id)), 'Server pagination repeated an assignment')
      await cdp.until('document.querySelector("nav[aria-label=\\"Phân trang công việc\\"]").innerText.includes("Trang 2")')
    })
    await step('detail links retain assignmentId without calling unintegrated UC10', async () => {
      const ids = await cdp.evaluate(visibleIdsExpression)
      const hrefs = await cdp.evaluate('[...document.querySelectorAll("a[href^=\\"/don/\\"]")].filter(e=>e.getClientRects().length>0).map(e=>e.getAttribute("href"))')
      check(hrefs.length === ids.length && hrefs.every((href, index) => {
        const detail = new URL(href, origin)
        const back = new URL(detail.searchParams.get('from') || '', origin)
        return detail.origin === origin && detail.pathname === '/don/' + ids[index]
          && [...detail.searchParams.keys()].every(key => key === 'from') && detail.searchParams.getAll('from').length === 1
          && back.origin === origin && back.pathname === '/cong-viec'
          && back.searchParams.get('page') === '2' && back.searchParams.get('pageSize') === '2' && back.searchParams.get('sort') === 'desc'
          && [...back.searchParams.keys()].every(key => ['status', 'page', 'pageSize', 'sort'].includes(key))
      }), 'Detail links lost assignmentId or the validated UC9 return state')
    })
    let absentStatus
    for (const status of ['WAITING', 'ACCEPTED', 'IN_PROGRESS', 'DONE', 'CANCELLED']) {
      if (listA.data.some(value => value.status === status)) continue
      if ((await baseline({ status, pageSize: '2', sort: 'desc' })).pagination.total === 0) { absentStatus = status; break }
    }
    if (absentStatus) await step('empty state comes from a genuinely absent server status without inserting fixtures', async () => {
      const empty = await baseline({ status: absentStatus, pageSize: '2', sort: 'desc' })
      check(empty.pagination.total === 0, 'Selected status was not empty in the real dataset')
      await select('staff-jobs-status', absentStatus, [])
      await cdp.until('document.body.innerText.includes("Không có công việc phù hợp")')
      check(!await cdp.evaluate('!!document.querySelector("[role=alert]")'), 'Valid empty data displayed an error')
    })
    else await skip('empty state with real data', 'Every status exists in the current read-only dataset; no fixture was inserted')
    await step('reload restores session and refetches the correct employee A list', async () => {
      await cdp.evaluate('[...document.querySelectorAll("button")].find(e=>e.innerText.includes("Đặt lại bộ lọc")).click()')
      await awaitIds(listA.data.map(value => value.id))
      await cdp.send('Page.reload'); await cdp.until('!!document.querySelector("#staff-jobs-status")')
      await awaitIds(listA.data.map(value => value.id)); await storage()
    })
    await step('logout clears assignments and the server session cookie before switching account', async () => {
      await cdp.evaluate('document.querySelector("button[aria-label^=\\"Tài khoản\\"]").click()')
      await cdp.until('[...document.querySelectorAll("[role=menuitem]")].some(e=>e.innerText.includes("Đăng xuất"))')
      await cdp.evaluate('[...document.querySelectorAll("[role=menuitem]")].find(e=>e.innerText.includes("Đăng xuất")).click()')
      await cdp.until('location.pathname==="/dang-nhap" && !!document.querySelector("input[name=phone]")')
      check(await cdp.evaluate('!document.querySelector("[data-assignment-id]")'), 'Old assignments survived logout')
      const cookies = await cdp.send('Network.getCookies', { urls: [origin] })
      check(!cookies.cookies.some(value => value.name === 'cleanhome_staff_session'), 'Old session cookie survived logout')
      await storage()
    })
    await step('employee B sees their own list without flashing employee A assignments', async () => {
      const watch = '(()=>{globalThis.__uc9StaleDetected=false;const observer=new MutationObserver(()=>{if(' + visibleIdsExpression + '.some(id=>' + JSON.stringify(expectedA) + '.includes(id)))globalThis.__uc9StaleDetected=true});const start=()=>observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true});if(document.documentElement)start();else document.addEventListener("DOMContentLoaded",start,{once:true})})()'
      await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: watch })
      await login(accountB)
      const listB = await baseline()
      check(listB.pagination.total === expectedB.length && listB.data.every(value => expectedB.includes(value.id) && !expectedA.includes(value.id)), 'B ownership differed from verified MySQL metadata')
      await awaitIds(listB.data.map(value => value.id))
      check(await cdp.evaluate('globalThis.__uc9StaleDetected===false'), 'Employee A assignments flashed under B')
      report.employeeB = { total: listB.pagination.total, assignmentIds: listB.data.map(value => value.id) }
      await storage()
    })
    await step('live cookie remains opaque, HttpOnly, SameSite Lax and origin appropriate', async () => {
      const cookies = await cdp.send('Network.getCookies', { urls: [origin] })
      const own = cookies.cookies.filter(value => value.name === 'cleanhome_staff_session')
      check(own.length === 1 && own[0].httpOnly && own[0].sameSite === 'Lax' && own[0].path === '/' && !own[0].domain.startsWith('.') && own[0].secure === origin.startsWith('https:') && /^[A-Za-z0-9_-]{43}$/.test(own[0].value), 'Cookie protections or opaque format failed')
    })
  }
  await step('browser uses only allowed same-origin BFF APIs, preserves storage and receives no JWT', async () => {
    await Promise.allSettled(bodyChecks); await storage()
    check(!report.credentialLeakDetected && forbiddenRequests.length === 0, 'Browser crossed the allowed BFF boundary')
    check(report.exceptions === 0, 'Browser raised a JavaScript exception')
    report.http = [...responses.values()]
    check(report.http.some(value => value.path === '/api/auth/login' && value.status === 200), 'Real Auth login was not observed')
    check(report.http.some(value => value.path === '/api/staff/jobs' && value.status === (scenario === 'outage' ? 503 : 200)), 'Expected real UC9 HTTP response was not observed')
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
    if (dirname(target) === base && basename(target).startsWith('cleanhome-staff-uc9-browser-')) {
      try { await rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); report.profileClosed = true } catch { report.profileClosed = false }
    }
  }
  await mkdir(artifactDir, { recursive: true })
  await writeFile(join(artifactDir, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ pass: report.pass || 0, fail: report.fail || 0, skip: report.skip || 0, failedAt: report.failedAt, report: join(artifactDir, 'report.json'), screenshots: report.screenshots, profileClosed: report.profileClosed }))
}
