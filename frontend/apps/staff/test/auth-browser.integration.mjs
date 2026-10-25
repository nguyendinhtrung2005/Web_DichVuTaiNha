import { spawn } from 'node:child_process'
import { readFile, writeFile, mkdir, mkdtemp, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, basename, resolve, join } from 'node:path'

if (process.env.RUN_STAFF_BFF_BROWSER_TESTS !== 'true') {
  console.log(JSON.stringify({ browser: 'NOT_RUN', reason: 'Explicit opt-in and real test credentials are required' }))
  process.exit(0)
}
const origin = new URL(process.env.STAFF_BFF_TEST_BASE_URL || 'http://localhost:3002').origin
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)) throw new Error('Browser QA requires a loopback Staff frontend')
const employee = { phone: process.env.STAFF_BFF_TEST_PHONE_A, password: process.env.STAFF_BFF_TEST_PASSWORD_A }
const customer = { phone: process.env.STAFF_BFF_TEST_PHONE_CUSTOMER, password: process.env.STAFF_BFF_TEST_PASSWORD_CUSTOMER }
if (![employee.phone, employee.password, customer.phone, customer.password].every(x => typeof x === 'string' && x.length)) throw new Error('Real credentials are required; values withheld')
const expectedId = process.env.STAFF_BFF_TEST_USER_ID_A || '9109002'
const chromePath = process.env.STAFF_BFF_CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const artifactDir = resolve('.auth-data/qa/browser')
const report = { browser: 'Chrome headless, isolated QA profile', origin, checks: [], screenshots: [], exceptions: 0, credentialLeakDetected: false }
let chrome, profile, cdp, failedAt = 'initialization'
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
function check(value, message) { if (!value) throw new Error(message) }
function scrub(value) {
  let text = String(value)
  for (const account of [employee, customer]) text = text.split(account.password).join('[REDACTED]')
  return text.replace(/[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g, '[REDACTED_TOKEN]')
}
class CDP {
  constructor(socket) {
    this.socket = socket; this.next = 1; this.pending = new Map(); this.listeners = []
    socket.addEventListener('message', event => {
      const data = JSON.parse(event.data)
      if (data.id) {
        const item = this.pending.get(data.id)
        if (item) { clearTimeout(item.timer); this.pending.delete(data.id); data.error ? item.reject(new Error('CDP command was rejected')) : item.resolve(data.result) }
      } else for (const listener of this.listeners) listener(data.method, data.params)
    })
  }
  async send(method, params = {}) {
    const id = this.next++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('CDP command timed out')) }, 15000)
      this.pending.set(id, { resolve, reject, timer })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }
  async evaluate(expression) {
    const response = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (response.exceptionDetails) throw new Error('Browser expression failed; expression contents withheld')
    return response.result.value
  }
  async until(expression, timeout = 25000) {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) { if (await this.evaluate(expression)) return; await delay(100) }
    throw new Error('Browser condition timed out; expression contents withheld')
  }
  async navigate(path) {
    await this.send('Page.navigate', { url: origin + path })
    await this.until('document.readyState === "complete"')
  }
}
async function step(name, action) {
  failedAt = name
  await action()
  report.checks.push({ name, status: 'PASS' })
}
async function field(name, value) {
  const expression = '(() => { const e=document.querySelector(' + JSON.stringify('input[name="' + name + '"]') + '); if(!e) return false; const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set; setter.call(e,' + JSON.stringify(value) + '); e.dispatchEvent(new Event("input",{bubbles:true})); e.dispatchEvent(new Event("change",{bubbles:true})); return true; })()'
  check(await cdp.evaluate(expression), 'A login field was unavailable')
}
async function submit(account) {
  await field('phone', account.phone); await field('password', account.password)
  await cdp.evaluate('document.querySelector("form").requestSubmit()')
}
async function storage() {
  const data = await cdp.evaluate('({local:Object.fromEntries(Object.entries(localStorage)),session:Object.fromEntries(Object.entries(sessionStorage)),cookie:document.cookie})')
  check(data.local['cleanhome-demo-state-staff'] === 'qa-existing-data-do-not-replace', 'Existing local data changed')
  check(data.session['cleanhome-qa-existing'] === 'keep-session-storage', 'Existing session storage changed')
  check(!data.cookie.includes('cleanhome_staff_session'), 'HttpOnly session was readable by JavaScript')
  check(!/[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/.test(JSON.stringify(data)), 'JWT appeared in browser storage')
}
async function screen(label, width) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 768 })
  await delay(150)
  const sizes = await cdp.evaluate('({width:innerWidth,scroll:document.documentElement.scrollWidth,buttons:[...document.querySelectorAll("button,input")].filter(x=>x.offsetParent!==null).map(x=>{const r=x.getBoundingClientRect();return {left:r.left,right:r.right}})})')
  check(sizes.scroll <= sizes.width + 1, 'Horizontal overflow at a required viewport')
  check(sizes.buttons.every(x => x.left >= -1 && x.right <= sizes.width + 1), 'An input or button exceeded the viewport')
  if ((label === 'login' && width === 375) || (label === 'authenticated' && width === 1440)) {
    const image = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    const name = label + '-' + width + '.png'
    await writeFile(join(artifactDir, name), Buffer.from(image.data, 'base64'))
    report.screenshots.push(name)
  }
}
try {
  await access(chromePath)
  await mkdir(artifactDir, { recursive: true })
  profile = await mkdtemp(join(tmpdir(), 'cleanhome-staff-auth-browser-'))
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
  const target = targets.find(x => x.type === 'page')
  check(target?.webSocketDebuggerUrl, 'Owned browser page is unavailable')
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', () => reject(new Error('Could not connect to owned browser')), { once: true }) })
  cdp = new CDP(socket)
  const responses = new Map(), bodyChecks = [], browserBackends = []
  cdp.listeners.push((method, params) => {
    if (method === 'Runtime.exceptionThrown') { report.exceptions++; report.lastException = scrub(params.exceptionDetails?.text || 'Browser runtime exception') }
    if (method === 'Network.responseReceived') {
      const url = new URL(params.response.url)
      if ([4001,4003,4005].includes(Number(url.port))) browserBackends.push(url.origin)
      if (url.origin === origin && url.pathname.startsWith('/api/auth/')) responses.set(params.requestId, { path: url.pathname, status: params.response.status })
    }
    if (method === 'Network.loadingFinished' && responses.has(params.requestId)) {
      bodyChecks.push(cdp.send('Network.getResponseBody', { requestId: params.requestId }).then(result => {
        const serialized = result.base64Encoded ? Buffer.from(result.body, 'base64').toString('utf8') : result.body
        if (/"(?:accessToken|password|password_hash|refreshToken)"\s*:|[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/.test(serialized)) report.credentialLeakDetected = true
      }).catch(() => {}))
    }
  })
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Network.enable')
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: 'try { if(location.origin===' + JSON.stringify(origin) + '){ if(localStorage.getItem("cleanhome-demo-state-staff")===null)localStorage.setItem("cleanhome-demo-state-staff","qa-existing-data-do-not-replace");if(sessionStorage.getItem("cleanhome-qa-existing")===null)sessionStorage.setItem("cleanhome-qa-existing","keep-session-storage"); }}catch{}' })
  await step('Staff login keeps CleanHome design and uses phone without a ten-digit restriction', async () => {
    await cdp.navigate('/dang-nhap?next=https%3A%2F%2Fattacker.invalid')
    await cdp.until('!!document.querySelector("input[name=phone]")')
    check(await cdp.evaluate('document.body.innerText.includes("CleanHome") && !document.querySelector("input[type=email]") && document.querySelector("input[name=password]").type==="password"'), 'Login identity fields were incorrect')
    await storage()
  })
  for (const width of [375,390,768,1440]) await step('login layout ' + width, () => screen('login', width))
  await step('wrong password shows an accessible authentication error', async () => {
    await submit({ phone: employee.phone, password: 'invalid-qa-password-' + Date.now() })
    await cdp.until('!!document.querySelector("[role=alert]") && !document.querySelector("button[type=submit]").disabled')
    check(await cdp.evaluate('document.querySelector("[role=alert]").innerText.includes("mật khẩu")'), 'Wrong-password message was not clear')
    await cdp.until('document.activeElement?.getAttribute("role")==="alert"')
  })
  await step('Customer account cannot enter the Staff website', async () => {
    await submit(customer)
    await cdp.until('!!document.querySelector("[role=alert]") && !document.querySelector("button[type=submit]").disabled')
    check(await cdp.evaluate('document.querySelector("[role=alert]").innerText.includes("quyền")'), 'Wrong-role message was not clear')
  })
  await step('real EMPLOYEE login reaches the protected identity without open redirect', async () => {
    await submit(employee)
    await cdp.until('location.pathname==="/" && document.body.innerText.includes(' + JSON.stringify(expectedId) + ')')
    check(await cdp.evaluate('location.origin===' + JSON.stringify(origin)), 'Return URL left the Staff origin')
    await storage()
  })
  await step('cookie is opaque, HttpOnly, Lax, host-only and uses the matching Secure policy', async () => {
    const cookies = await cdp.send('Network.getCookies', { urls: [origin] })
    const own = cookies.cookies.filter(x => x.name === 'cleanhome_staff_session')
    check(own.length === 1, 'Expected one Staff cookie')
    const cookie = own[0]
    check(cookie.httpOnly && cookie.sameSite === 'Lax' && cookie.path === '/' && !cookie.domain.startsWith('.'), 'Cookie protections were missing')
    check(cookie.secure === origin.startsWith('https:') && /^[A-Za-z0-9_-]{43}$/.test(cookie.value), 'Cookie contents or Secure flag was invalid')
  })
  await step('browser reload restores the real session through BFF introspection', async () => {
    await cdp.send('Page.reload')
    await cdp.until('document.body.innerText.includes(' + JSON.stringify(expectedId) + ')')
    await storage()
  })
  for (const width of [375,390,768,1440]) await step('authenticated layout ' + width, () => screen('authenticated', width))
  await step('logout removes the browser cookie and returns to the Staff phone login', async () => {
    await cdp.evaluate('document.querySelector("button[aria-label^=\\"Tài khoản\\"]").click()')
    await cdp.until('[...document.querySelectorAll("[role=menuitem]")].some(x=>x.innerText.includes("Đăng xuất"))')
    await cdp.evaluate('[...document.querySelectorAll("[role=menuitem]")].find(x=>x.innerText.includes("Đăng xuất")).click()')
    await cdp.until('location.pathname==="/dang-nhap" && !!document.querySelector("input[name=phone]")')
    const cookies = await cdp.send('Network.getCookies', { urls: [origin] })
    check(!cookies.cookies.some(x => x.name === 'cleanhome_staff_session'), 'Logout retained the Staff cookie')
    await storage()
  })
  await step('protected navigation redirects to a safe same-origin login return path', async () => {
    await cdp.navigate('/cong-viec')
    await cdp.until('location.pathname==="/dang-nhap" && !!document.querySelector("input[name=phone]")')
    check(await cdp.evaluate('new URLSearchParams(location.search).get("next")==="/cong-viec"'), 'Protected return path was not retained safely')
  })
  await step('browser receives no JWT, keeps old storage and makes no Staff/Order business calls', async () => {
    await Promise.allSettled(bodyChecks)
    await storage()
    check(!report.credentialLeakDetected && browserBackends.length === 0, 'Browser crossed the BFF security boundary')
    check(report.exceptions === 0, 'Browser raised a JavaScript exception')
    report.http = [...responses.values()]
    check(report.http.some(x => x.path === '/api/auth/login' && x.status === 200), 'No successful real BFF login was observed')
    check(report.http.some(x => x.path === '/api/auth/login' && x.status === 401), 'No failed-login HTTP status was observed')
    check(report.http.some(x => x.path === '/api/auth/login' && x.status === 403), 'No wrong-role HTTP status was observed')
  })
  for (const [area, port] of [['Customer', 3001], ['Admin', 3003]]) await step(area + ' retains its existing email login without the Staff auth provider', async () => {
    const targetOrigin = 'http://localhost:' + port
    await cdp.send('Page.navigate', { url: targetOrigin + '/dang-nhap' })
    await cdp.until('location.origin===' + JSON.stringify(targetOrigin) + ' && !!document.querySelector("input[type=email]")')
    check(await cdp.evaluate('document.body.innerText.includes("CleanHome") && !document.querySelector("input[name=phone]")'), 'An unrelated login form changed')
    check(report.exceptions === 0, 'An unrelated login page raised a JavaScript exception')
  })
  report.pass = report.checks.length; report.fail = 0
} catch (error) {
  report.pass = report.checks.length; report.fail = 1; report.failedAt = failedAt; report.error = scrub(error.message)
  process.exitCode = 1
} finally {
  try { if (cdp) await cdp.send('Browser.close') } catch {}
  if (chrome && chrome.exitCode === null) chrome.kill()
  if (profile) {
    const target = resolve(profile), base = resolve(tmpdir())
    if (dirname(target) === base && basename(target).startsWith('cleanhome-staff-auth-browser-')) {
      try { await rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); report.profileClosed = true } catch { report.profileClosed = false }
    }
  }
  await mkdir(artifactDir, { recursive: true })
  await writeFile(join(artifactDir, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ pass: report.pass || 0, fail: report.fail || 0, failedAt: report.failedAt, report: join(artifactDir, 'report.json'), screenshots: report.screenshots, profileClosed: report.profileClosed }))
}
