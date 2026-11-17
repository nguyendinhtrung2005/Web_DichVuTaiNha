import { spawn } from 'node:child_process'
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join, dirname, basename } from 'node:path'

// Real login/read-only rendering plus explicitly intercepted UI simulations.
// Fetch interception denies EVERY real PATCH; no Backend write fixtures are used.
if (process.env.RUN_STAFF_UC12_BROWSER_TESTS !== 'true') {
  console.log('NOT_RUN: opt-in and real Auth credentials required; no approved QA writes')
  process.exit(0)
}
const origin = process.env.STAFF_BFF_TEST_BASE_URL || 'http://localhost:3002'
if (!['localhost', '127.0.0.1'].includes(new URL(origin).hostname) || new URL(origin).origin !== origin) throw new Error('Loopback origin required')
const phone = process.env.STAFF_BFF_TEST_PHONE_A, password = process.env.STAFF_BFF_TEST_PASSWORD_A
if (!phone || !password) throw new Error('Securely injected employee credentials required')
const folder = resolve('.auth-data/qa/uc12/browser'), sleep = ms => new Promise(done => setTimeout(done, ms))
const report = { realReadOnly: [], interceptedUi: [], screenshots: [], exceptions: 0, actualStatusPatchForwarded: 0, unexpectedPatch: 0, cancelledReadInterceptions: 0 }
let chrome, profile, cdp, failedAt = 'initialization', mode = 'real', reply = 'unknown', mock, original, assignmentId, firstKey, patchCount = 0
const check = (value, message) => { if (!value) throw new Error(message) }
class CDP {
  constructor(socket) {
    this.socket = socket; this.sequence = 0; this.pending = new Map(); this.listeners = []
    socket.addEventListener('message', event => {
      const value = JSON.parse(event.data)
      if (value.id) {
        const call = this.pending.get(value.id)
        if (call) { clearTimeout(call.timer); this.pending.delete(value.id); value.error ? call.reject(new Error('CDP command rejected')) : call.resolve(value.result) }
      } else for (const listen of this.listeners) listen(value.method, value.params)
    })
  }
  send(method, params = {}) {
    const id = ++this.sequence
    return new Promise((done, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('CDP command timeout')) }, 15000)
      this.pending.set(id, { resolve: done, reject, timer }); this.socket.send(JSON.stringify({ id, method, params }))
    })
  }
  async evaluate(expression) {
    const value = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (value.exceptionDetails) throw new Error('Browser expression failed; contents withheld')
    return value.result.value
  }
  async until(expression, ms = 25000) {
    const end = Date.now() + ms
    while (Date.now() < end) { if (await this.evaluate(expression)) return; await sleep(100) }
    throw new Error('Browser condition timeout; expression withheld')
  }
  async navigate(path) { await this.send('Page.navigate', { url: origin + path }); await this.until('document.readyState === "complete"') }
}
const panel = 'document.querySelector("[data-staff-status-panel]")'
const button = text => '[...(' + panel + '?.querySelectorAll("button") || [])].find(e=>e.innerText.includes(' + JSON.stringify(text) + '))'
async function click(text) { await cdp.evaluate(button(text) + '.click()') }
async function step(name, action, simulated = false) { failedAt = name; await action(); report[simulated ? 'interceptedUi' : 'realReadOnly'].push(name) }
async function screen(width, dialog = false) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false })
  await sleep(180)
  check(await cdp.evaluate('document.documentElement.scrollWidth <= innerWidth+1'), 'Horizontal document overflow')
  check(await cdp.evaluate('(()=>{const root=' + (dialog ? 'document.querySelector("dialog[open]")' : panel) + ';return !!root&&[root,...root.querySelectorAll("button,p,h2")].filter(e=>e.getClientRects().length).every(e=>{const r=e.getBoundingClientRect();return r.left>=-1&&r.right<=innerWidth+1})})()'), 'Panel/button outside viewport')
  if (width === 375 || width === 1440) {
    const value = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
    const name = 'uc12-' + (dialog ? 'dialog-' : '') + width + '.png'
    await writeFile(join(folder, name), Buffer.from(value.data, 'base64')); report.screenshots.push(name)
  }
}
async function confirm() {
  await cdp.until('!!document.querySelector("dialog[open]")')
  await cdp.evaluate('document.querySelector("dialog[open] form").requestSubmit();document.querySelector("dialog[open] form").requestSubmit()')
}
async function intercept(params) {
  const mutation = params.request.method === 'PATCH'
  if (mutation && mode === 'real') { report.unexpectedPatch++; return cdp.send('Fetch.failRequest', { requestId: params.requestId, errorReason: 'BlockedByClient' }) }
  if (!mutation && mode === 'real') return cdp.send('Fetch.continueRequest', { requestId: params.requestId })
  let status = 200, value = mock
  if (mutation) {
    patchCount++
    const key = Object.entries(params.request.headers).find(([name]) => name.toLowerCase() === 'idempotency-key')?.[1]
    check(typeof key === 'string' && /^[A-Za-z0-9._:-]{8,128}$/.test(key), 'UI did not send a contract idempotency key')
    if (!firstKey) firstKey = key
    check(key === firstKey, 'UI created a new key for the same uncertain operation')
    check(params.request.postData === JSON.stringify({ status: 'ACCEPTED' }), 'UI changed the retry payload')
    const phase = reply, transition = { operationId: 'a'.repeat(64), requestedStatus: 'ACCEPTED', synchronization: phase === 'confirmed' ? 'SYNCHRONIZED' : 'PENDING_ACKNOWLEDGEMENT', replayed: patchCount > 1 }
    const operation = { idempotencyKey: key, requestedStatus: 'ACCEPTED', phase, createdAt: '2026-10-24T00:00:00.000Z', observedTarget: phase !== 'unknown', ...(phase === 'unknown' ? {} : { transition }) }
    mock = { ...original, current: { ...original.current, ...(phase === 'unknown' ? {} : { status: 'ACCEPTED', jobStatus: 'accepted' }) }, operation, allowedStatus: phase === 'confirmed' ? 'IN_PROGRESS' : null, canRetry: phase !== 'confirmed', blockedReason: phase === 'confirmed' ? null : 'UNRESOLVED_OPERATION' }
    if (phase === 'unknown') { status = 503; value = { error: { code: 'STAFF_UNAVAILABLE', message: 'Kết quả chưa xác định.', outcome: 'unknown' }, operation, requestId: 'intercepted-ui-only' } }
    else { status = phase === 'confirmed' ? 200 : 202; value = { data: { assignmentId, status: 'ACCEPTED', jobStatus: 'accepted', checkInAt: null, checkOutAt: null, transition, orderAtTransition: { id: original.current.orderId, status: 'CONFIRMED', asOf: '2026-10-24T00:00:00.000Z' } }, operation } }
    await sleep(120)
  }
  return cdp.send('Fetch.fulfillRequest', { requestId: params.requestId, responseCode: status,
    responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Cache-Control', value: 'no-store' }], body: Buffer.from(JSON.stringify(value)).toString('base64') })
}
let interceptError = false
const deadline = setTimeout(() => { chrome?.kill(); process.exitCode = 1 }, 240000); deadline.unref()
try {
  await mkdir(folder, { recursive: true }); profile = await mkdtemp(join(tmpdir(), 'cleanhome-staff-uc12-browser-'))
  chrome = spawn(process.env.STAFF_BFF_CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', ['--headless=new', '--no-first-run', '--disable-background-networking', '--disable-extensions', '--disable-sync', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--window-size=1440,1000', 'about:blank'], { windowsHide: true, stdio: 'ignore' })
  let port
  for (let i = 0; i < 150; i++) { try { port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); if (port) break } catch {} await sleep(100) }
  check(port, 'Owned Chrome startup timed out')
  const pages = await (await fetch('http://127.0.0.1:' + port + '/json/list', { signal: AbortSignal.timeout(5000) })).json()
  const socket = new WebSocket(pages.find(p => p.type === 'page').webSocketDebuggerUrl)
  await new Promise((done, reject) => { socket.addEventListener('open', done, { once: true }); socket.addEventListener('error', () => reject(new Error('Chrome socket failed')), { once: true }) })
  cdp = new CDP(socket)
  cdp.listeners.push((method, params) => {
    if (method === 'Runtime.exceptionThrown') report.exceptions++
    if (method === 'Fetch.requestPaused') void intercept(params).catch(async error => {
      // Navigation/React cleanup can cancel a paused GET before CDP continues it.
      // Every PATCH failure remains a test failure and is always blocked.
      if (params.request.method === 'GET' && error.message === 'CDP command rejected') report.cancelledReadInterceptions++
      else interceptError = true
      try { await cdp.send('Fetch.failRequest', { requestId: params.requestId, errorReason: 'BlockedByClient' }) } catch {}
    })
  })
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Network.enable')
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: origin + '/api/staff/jobs/*/status*', requestStage: 'Request' }] })
  await step('real employee login and UC9 list', async () => {
    await cdp.navigate('/dang-nhap?next=%2Fcong-viec'); await cdp.until('!!document.querySelector("input[name=phone]")')
    for (const [name, value] of [['phone', phone], ['password', password]]) await cdp.evaluate('(()=>{const e=document.querySelector(' + JSON.stringify('input[name=' + name + ']') + ');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,' + JSON.stringify(value) + ');e.dispatchEvent(new Event("input",{bubbles:true}))})()')
    await cdp.evaluate('document.querySelector("form").requestSubmit()'); await cdp.until('location.pathname==="/cong-viec"')
    const rows = await cdp.evaluate('(async()=>{const r=await fetch("/api/staff/jobs?pageSize=100",{cache:"no-store"});return (await r.json()).data.map(x=>({id:x.assignmentId,status:x.databaseStatus,order:x.orderStatus}))})()')
    assignmentId = rows.find(row => row.status === 'ASSIGNED' && row.order === 'confirmed')?.id
    check(assignmentId, 'An existing read-only eligible assignment is required; no fixture will be created')
  })
  await step('UC10 and UC12 read the real owned assignment', async () => {
    await cdp.navigate('/don/' + assignmentId); await cdp.until('!!' + panel + ' && !!' + button('Tiếp nhận công việc') + ' && !' + button('Tiếp nhận công việc') + '.disabled')
    original = await cdp.evaluate('(async()=>{const r=await fetch(' + JSON.stringify('/api/staff/jobs/' + assignmentId + '/status') + ',{cache:"no-store"});return await r.json()})()')
    check(original.current.assignmentId === assignmentId && original.allowedStatus === 'ACCEPTED' && original.operation === null, 'Real initial projection mismatch')
  })
  for (const width of [375, 390, 768, 1440]) await step('real UC12 responsive ' + width, () => screen(width))
  await step('confirmation opens without sending a mutation; Escape returns focus', async () => {
    await click('Tiếp nhận công việc'); await cdp.until('!!document.querySelector("dialog[open]")')
    for (const width of [375, 390, 768, 1440]) await screen(width, true)
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await cdp.until('!document.querySelector("dialog[open]") && document.activeElement?.innerText.includes("Tiếp nhận công việc")')
    check(report.unexpectedPatch === 0, 'Opening/cancelling confirmation attempted a PATCH')
  })
  await step('real reload retains Backend state without creating an operation', async () => {
    await cdp.navigate('/don/' + assignmentId); await cdp.until('!!' + button('Tiếp nhận công việc') + ' && !' + button('Tiếp nhận công việc') + '.disabled')
    check(!await cdp.evaluate('!!document.querySelector("[data-operation-phase]")'), 'Read-only reload created an operation')
  })
  mode = 'mock'; mock = original
  await step('intercepted timeout-result UI retains key and mutex rejects double submit', async () => {
    await click('Tiếp nhận công việc'); await confirm(); await cdp.until('!!document.querySelector("[data-operation-phase=unknown]") && !document.querySelector("dialog[open]")')
    check(patchCount === 1 && firstKey, 'Two UI submissions were not serialized')
    check(!await cdp.evaluate('!!' + button('Bắt đầu thực hiện')), 'Uncertain result enabled a new step')
  }, true)
  await step('intercepted reload recovers unknown context without auto PATCH', async () => {
    await cdp.navigate('/don/' + assignmentId); await cdp.until('!!document.querySelector("[data-operation-phase=unknown]")')
    check(patchCount === 1, 'Reload sent a mutation')
  }, true)
  await step('intercepted same-key retry renders 202 pending and blocks next step', async () => {
    reply = 'pending'; await click('Thử lại cùng thao tác'); await confirm(); await cdp.until('!!document.querySelector("[data-operation-phase=pending]") && !document.querySelector("dialog[open]")')
    check(patchCount === 2 && !await cdp.evaluate('!!' + button('Bắt đầu thực hiện')), 'Pending enabled a new step')
  }, true)
  await step('intercepted same-key retry renders confirmed only after explicit 200', async () => {
    reply = 'confirmed'; await click('Thử lại cùng thao tác'); await confirm(); await cdp.until('!!document.querySelector("[data-operation-phase=confirmed]") && !!' + button('Bắt đầu thực hiện'))
    check(patchCount === 3, 'Retry generated extra requests')
  }, true)
  mode = 'real'
  await step('real UC10 state is unchanged after browser-only simulations', async () => {
    await cdp.navigate('/don/' + assignmentId); await cdp.until('!!' + button('Tiếp nhận công việc') + ' && !' + button('Tiếp nhận công việc') + '.disabled')
    check(!await cdp.evaluate('!!document.querySelector("[data-operation-phase]")'), 'UI simulations escaped into the BFF journal')
  })
  await step('browser token boundary and session cookie', async () => {
    check(await cdp.evaluate('(()=>{const jwt=/[A-Za-z0-9_-]{16,}\\.[A-Za-z0-9_-]{16,}\\.[A-Za-z0-9_-]{16,}/;return !Object.values(localStorage).some(v=>jwt.test(v))&&!Object.values(sessionStorage).some(v=>jwt.test(v))&&!document.cookie.includes("cleanhome_staff_session")})()'), 'JWT or HttpOnly cookie was readable by JavaScript')
    const { cookies } = await cdp.send('Network.getCookies', { urls: [origin] }), cookie = cookies.find(c => c.name === 'cleanhome_staff_session')
    check(cookie?.httpOnly && cookie.sameSite === 'Lax' && cookie.path === '/', 'Session cookie protections missing')
    check(!interceptError && report.exceptions === 0 && report.unexpectedPatch === 0, 'Browser exception or blocked unexpected mutation')
  })
  await cdp.evaluate('(async()=>{await fetch("/api/auth/logout",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"})})()')
  report.pass = report.realReadOnly.length + report.interceptedUi.length; report.fail = 0
} catch (error) {
  report.pass = report.realReadOnly.length + report.interceptedUi.length; report.fail = 1; report.failedAt = failedAt
  report.error = String(error.message).split(password).join('[REDACTED]').replace(/[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g, '[REDACTED]'); process.exitCode = 1
} finally {
  clearTimeout(deadline)
  try { await cdp?.send('Browser.close') } catch {}
  if (chrome?.exitCode === null) chrome.kill()
  if (profile && dirname(resolve(profile)) === resolve(tmpdir()) && basename(profile).startsWith('cleanhome-staff-uc12-browser-')) {
    try { await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); report.profileClosed = true } catch { report.profileClosed = false }
  }
  await mkdir(folder, { recursive: true }); await writeFile(join(folder, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ pass: report.pass, fail: report.fail, realReadOnly: report.realReadOnly.length, interceptedUi: report.interceptedUi.length, failedAt: report.failedAt, profileClosed: report.profileClosed }))
}
