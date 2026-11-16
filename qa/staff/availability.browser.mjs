import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { loadConfig, privateDirectory } from './common.mjs'

// Real BFF/Auth/availability. Network faults affect GET only; no response doubles,
// seed, SQL write, request creation or official shift mutation.
const check = (value, code) => { if (!value) throw Error(code) }
const wait = ms => new Promise(done => setTimeout(done, ms))
if (process.env.RUN_STAFF_ISOLATED_AVAILABILITY_QA !== 'true') {
  console.log(JSON.stringify({ status: 'NOT_RUN', reason: 'Set RUN_STAFF_ISOLATED_AVAILABILITY_QA=true for real read-only QA' })); process.exit(0)
}
const report = { mockedResponses: false, checks: [], notRun: [], layouts: [], screenshots: [], exceptions: 0, forbiddenRequests: 0, availabilityGets: 0, branchGets: 0, faults: [] }
let config, browser, profile, cdp, artifactDir, failedAt = 'configuration', fault = null, aWindows = []
const held = []
const tileRequests = new Set()
class CDP {
  constructor(socket) {
    this.socket = socket; this.sequence = 0; this.pending = new Map(); this.listeners = []
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data)
      if (message.id) { const item = this.pending.get(message.id); if (item) { clearTimeout(item.timer); this.pending.delete(message.id); message.error ? item.reject(Object.assign(Error('QA_CDP_REJECTED'), { cdpMethod: item.method, cdpCode: message.error.code, cdpMessage: message.error.message })) : item.done(message.result) } }
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
async function startChrome() {
  const executable = process.env.STAFF_QA_CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  await access(executable); profile = await mkdtemp(join(tmpdir(), 'cleanhome-staff-availability-qa-'))
  browser = spawn(executable, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-sync', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--disk-cache-dir=' + join(privateDirectory, 'chrome-map-cache'), '--window-size=1440,1000', 'about:blank'], { windowsHide: true, stdio: 'ignore' })
  let port
  for (let i = 0; i < 150; i++) { try { port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); if (port) break } catch {} check(browser.exitCode === null, 'QA_CHROME_START_FAILED'); await wait(100) }
  check(port, 'QA_CHROME_DEBUG_PORT_MISSING')
  const pages = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json(), page = pages.find(row => row.type === 'page')
  const socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((done, reject) => { socket.addEventListener('open', done, { once: true }); socket.addEventListener('error', () => reject(Error('QA_CHROME_CONNECT_FAILED')), { once: true }) }); cdp = new CDP(socket)
  cdp.listeners.push((method, params) => {
    if (method === 'Runtime.exceptionThrown') report.exceptions++
    if (method === 'Network.requestWillBeSent') { const url = new URL(params.request.url); if (url.origin === config.frontendOrigin && url.pathname === '/api/staff/availability') report.availabilityGets++; if (url.origin === config.frontendOrigin && url.pathname === '/api/staff/branch') report.branchGets++; if (url.hostname === 'tile.openstreetmap.org') tileRequests.add(params.requestId) }
    if (method === 'Network.loadingFailed' && tileRequests.has(params.requestId)) report.tileNetworkErrors = [...(report.tileNetworkErrors || []), /^[A-Za-z_:]+$/.test(params.errorText || '') ? params.errorText : 'NETWORK_ERROR']
    if (method !== 'Fetch.requestPaused') return
    const { requestId, request } = params, url = new URL(request.url)
    const auth = url.origin === config.frontendOrigin && request.method === 'POST' && ['/api/auth/login', '/api/auth/logout'].includes(url.pathname)
    const tile = /^https:\/\/tile\.openstreetmap\.org\/\d+\/\d+\/\d+\.png$/.test(request.url) && request.method === 'GET'
    if (url.origin !== config.frontendOrigin && !tile || request.method !== 'GET' && !auth) { report.forbiddenRequests++; void cdp.send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }).catch(() => {}); return }
    if (url.pathname === '/api/staff/availability' && fault) {
      if (fault === 'hold') { held.push(requestId); return }
      report.faults.push('availability GET connection failure'); void cdp.send('Fetch.failRequest', { requestId, errorReason: 'ConnectionFailed' }).catch(() => {}); return
    }
    void cdp.send('Fetch.continueRequest', { requestId }).catch(() => {})
  })
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Network.enable'); await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] })
}
async function click(selector) {
  await cdp.until('!!document.querySelector(' + JSON.stringify(selector) + ')', 15000)
  await cdp.evaluate('document.querySelector(' + JSON.stringify(selector) + ')?.scrollIntoView({block:"center"});true'); await wait(100)
  const position = await cdp.evaluate('(()=>{const e=document.querySelector(' + JSON.stringify(selector) + ');if(!e||e.disabled)return null;const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()')
  check(position, 'QA_CONTROL_NOT_FOUND_OR_DISABLED')
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...position, button: 'left', buttons: 1, clickCount: 1 }); await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...position, button: 'left', buttons: 0, clickCount: 1 })
}
async function input(selector, value, textarea = false) {
  check(await cdp.evaluate('(()=>{const e=document.querySelector(' + JSON.stringify(selector) + ');if(!e)return false;Object.getOwnPropertyDescriptor(' + (textarea ? 'HTMLTextAreaElement' : 'HTMLInputElement') + '.prototype,"value").set.call(e,' + JSON.stringify(value) + ');e.dispatchEvent(new Event("input",{bubbles:true}));return true})()'), 'QA_INPUT_MISSING')
}
async function escape() { await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await cdp.until('!document.querySelector("[role=dialog]")') }
async function api(path, options = {}) {
  check(path.startsWith('/api/staff/availability?') || path === '/api/auth/logout', 'QA_API_SCOPE_DENIED')
  return cdp.evaluate('(async()=>{const r=await fetch(' + JSON.stringify(path) + ',' + JSON.stringify(path === '/api/auth/logout' ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' } : { headers: options }) + ');return {status:r.status,body:await r.json()}})()')
}
async function login(label) {
  await cdp.navigate('/dang-nhap?next=%2Fkhu-vuc'); await cdp.until('!!document.querySelector("input[name=phone]")')
  await input('input[name=phone]', config.accounts[label].phone); await input('input[name=password]', config.accounts[label].password)
  await cdp.evaluate('document.querySelector("form").requestSubmit()'); await ready()
}
async function ready() { await cdp.until('location.pathname==="/khu-vuc"&&document.querySelector("[data-staff-areas-remote]")?.dataset.staffAreasRemote==="ready"&&!!document.querySelector("[data-staff-availability-interactive]")') }
async function currentRange() { return cdp.evaluate('(()=>{const days=[...document.querySelectorAll("[data-staff-availability-day-open]")].map(e=>e.dataset.staffAvailabilityDayOpen);return {from:days[0],to:days[6]}})()') }
async function reviewValidRegistration() {
  const range = await currentRange(), tomorrow = new Date(Date.now() + 7 * 3600000 + 86400000).toISOString().slice(0, 10)
  if (tomorrow > range.to) { await click('button[aria-label="Tuần sau"]'); await ready() }
  await click('[data-staff-availability-register]'); await cdp.until('!!document.querySelector("[data-staff-availability-request=register]")')
  await input('[name=availability-start]', tomorrow + 'T18:00'); await input('[name=availability-end]', tomorrow + 'T19:00')
  await input('[name=availability-reason]', 'QA nội dung chưa gửi, không thay đổi ca.', true); await click('[data-staff-availability-preview]')
  await cdp.until('!!document.querySelector("[data-staff-availability-review]")')
}

const watchdog = setTimeout(() => { try { cdp?.socket.close() } catch {} if (browser?.exitCode === null) browser.kill() }, 240000); watchdog.unref()
try {
  config = await loadConfig(); check(config.frontendOrigin === 'http://localhost:3102', 'QA_EXPECTS_STABLE_STAFF_ORIGIN')
  artifactDir = join(privateDirectory, 'reports/availability-browser-' + new Date().toISOString().replace(/[:.]/g, '-')); await mkdir(artifactDir, { recursive: true })
  await step('Real Chrome and QA A login, availability matches BFF', async () => {
    await startChrome(); await login('A'); const range = await currentRange(), response = await api('/api/staff/availability?' + new URLSearchParams(range))
    check(response.status === 200, 'QA_AVAILABILITY_API_FAILED'); aWindows = response.body.data; report.A = { windows: aWindows.length }
    const ids = await cdp.evaluate('[...document.querySelectorAll("[data-staff-availability-id]")].map(e=>e.dataset.staffAvailabilityId)')
    check(response.body.data.every(item => ids.includes(item.id)), 'QA_WINDOWS_DIFFER_FROM_API')
  })
  await step('Day and slot details show real fields, keyboard closes and restores focus', async () => {
    await click('[data-staff-availability-day-open]'); await cdp.until('!!document.querySelector("[data-staff-availability-detail=day]")')
    await click('[data-staff-availability-day-slot]'); await cdp.until('!!document.querySelector("[data-staff-availability-detail=slot]")')
    await cdp.until('document.activeElement?.hasAttribute("data-staff-availability-detail-heading")')
    await escape(); await cdp.until('document.activeElement?.hasAttribute("data-staff-availability-day-open")')
    await click('[data-staff-availability-open]'); await cdp.until('!!document.querySelector("[data-staff-availability-detail=slot]")')
    check(await cdp.evaluate('(()=>{const d=document.querySelector("[role=dialog]").textContent;return d.includes("Ngày bắt đầu")&&d.includes("Ngày kết thúc")&&d.includes("UTC+7")&&d.includes("Trạng thái khả dụng")&&d.includes("chưa cung cấp")})()'), 'QA_DETAIL_FIELDS_OR_APPROVAL_NOTICE_MISSING')
    await escape(); await cdp.until('document.activeElement?.hasAttribute("data-staff-availability-open")')
  })
  await step('Change and cancel prepare forms are honest and reject past targets', async () => {
    for (const action of ['change', 'cancel']) {
      await click('[data-staff-availability-open]'); await cdp.until('!!document.querySelector("[data-staff-availability-detail=slot]")'); await click('[data-staff-availability-' + action + ']')
      await input('[name=availability-reason]', 'QA kiểm tra yêu cầu chưa gửi.', true); await click('[data-staff-availability-preview]')
      await cdp.until('!!document.querySelector("[data-staff-availability-validation]")')
      check(await cdp.evaluate('document.querySelector("[data-staff-availability-validation]").textContent.includes("quá khứ")'), 'QA_PAST_TARGET_NOT_REJECTED')
      await escape()
    }
  })
  await step('Registration validates empty, reversed and past times, with no mutation', async () => {
    await click('[data-staff-availability-register]'); await cdp.until('!!document.querySelector("[data-staff-availability-request=register]")')
    await input('[name=availability-start]', ''); await input('[name=availability-end]', ''); await click('[data-staff-availability-preview]'); await cdp.until('!!document.querySelector("[data-staff-availability-validation]")')
    await cdp.until('document.activeElement?.hasAttribute("data-staff-availability-validation")')
    check(await cdp.evaluate('[...document.querySelectorAll("[name=availability-start],[name=availability-end]")].every(e=>e.getAttribute("aria-invalid")==="true"&&document.getElementById(e.getAttribute("aria-describedby")))'), 'QA_VALIDATION_ERROR_NOT_ASSOCIATED')
    await input('[name=availability-start]', '2000-01-01T08:00'); await input('[name=availability-end]', '2000-01-01T07:00'); await click('[data-staff-availability-preview]')
    check(await cdp.evaluate('document.querySelector("[data-staff-availability-validation]").textContent.includes("tương lai")&&document.querySelector("[data-staff-availability-validation]").textContent.includes("sau giờ bắt đầu")'), 'QA_INVALID_TIME_VALIDATION_MISSING')
    await escape()
  })
  const future = aWindows.find(item => Date.parse(item.startsAt) > Date.now() + 60_000 && Date.parse(item.endsAt) - Date.parse(item.startsAt) >= 120_000)
  const localInput = instant => new Date(Date.parse(instant) + 7 * 3600000).toISOString().slice(0, 16)
  if (future) {
    await step('Real future fixture overlap is rejected and valid change/cancel previews stay unsent', async () => {
      await click('[data-staff-availability-register]'); await cdp.until('!!document.querySelector("[name=availability-start]")')
      await input('[name=availability-start]', localInput(future.startsAt)); await input('[name=availability-end]', localInput(future.endsAt)); await click('[data-staff-availability-preview]')
      await cdp.until('!!document.querySelector("[data-staff-availability-validation]")')
      check(await cdp.evaluate('document.querySelector("[data-staff-availability-validation]").textContent.includes("trùng")&&document.querySelector("[name=availability-start]").getAttribute("aria-invalid")==="true"'), 'QA_REAL_FIXTURE_OVERLAP_NOT_REJECTED'); await escape()
      for (const action of ['change', 'cancel']) {
        await click('[data-staff-availability-open="' + future.id + '"]'); await cdp.until('!!document.querySelector("[data-staff-availability-detail=slot]")'); await click('[data-staff-availability-' + action + ']')
        await input('[name=availability-reason]', 'QA chỉ xem lại nội dung, chưa gửi yêu cầu.', true)
        if (action === 'change') { await input('[name=availability-start]', localInput(new Date(Date.parse(future.startsAt) + 60_000).toISOString())); await input('[name=availability-end]', localInput(future.endsAt)) }
        await click('[data-staff-availability-preview]'); await cdp.until('document.activeElement?.hasAttribute("data-staff-availability-review-heading")')
        check(await cdp.evaluate('document.querySelector("[data-staff-availability-submit]").disabled&&document.querySelector("[data-staff-availability-review]").textContent.includes("chưa có yêu cầu được tạo")'), 'QA_CHANGE_CANCEL_INVENTED_PENDING')
        await escape()
      }
    })
  } else report.notRun.push({ name: 'Real future fixture overlap and valid change/cancel preview', status: 'NOT_RUN', reason: 'Existing QA fixtures have no future window; no fixture was written or replaced.' })
  await step('Valid draft review, confirmation and disabled send never invent pending or success', async () => {
    await reviewValidRegistration()
    check(await cdp.evaluate('!!document.activeElement?.closest("[data-staff-availability-review]")'), 'QA_REVIEW_FOCUS_NOT_MOVED_TO_CONTENT')
    await click('[data-staff-availability-review] input[type=checkbox]')
    check(await cdp.evaluate('document.querySelector("[data-staff-availability-submit]").disabled&&document.querySelector("[data-staff-availability-review]").textContent.includes("chưa có yêu cầu được tạo")'), 'QA_SEND_NOT_BLOCKED_OR_FAKE_PENDING')
    await cdp.evaluate('document.querySelector("[data-staff-availability-submit]").click()')
    check(report.forbiddenRequests === 0, 'QA_DRAFT_ATTEMPTED_BUSINESS_MUTATION')
    await click('[data-staff-availability-edit]'); await cdp.until('document.activeElement?.hasAttribute("data-staff-availability-form-heading")')
    check(await cdp.evaluate('document.querySelector("[name=availability-reason]").value==="QA nội dung chưa gửi, không thay đổi ca."'), 'QA_REVIEW_EDIT_LOST_DRAFT')
    await click('[data-staff-availability-preview]'); await cdp.until('document.activeElement?.hasAttribute("data-staff-availability-review-heading")')
  })
  await step('Mobile and desktop request dialogs fit 375/390/768/1440 with focus trapping', async () => {
    for (const width of [375, 390, 768, 1440]) {
      const height = width === 375 ? 812 : width === 390 ? 844 : width === 768 ? 1024 : 1000
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }); await wait(250)
      const layout = await cdp.evaluate('(()=>{const e=document.querySelector("[role=dialog]"),r=e.getBoundingClientRect();return {width:innerWidth,documentWidth:document.documentElement.scrollWidth,left:r.left,right:r.right,height:r.height,scrollWidth:e.scrollWidth,clientWidth:e.clientWidth}})()')
      check(layout.documentWidth <= width + 1 && layout.left >= 0 && layout.right <= width + 1 && layout.height <= height && layout.scrollWidth <= layout.clientWidth + 1, 'QA_DIALOG_OVERFLOW_' + width)
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }); await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
      check(await cdp.evaluate('!!document.activeElement?.closest("[role=dialog]")'), 'QA_DIALOG_FOCUS_ESCAPED')
      report.layouts.push({ ...layout, status: 'REAL_PASS' }); const file = 'availability-' + width + '.png', screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' }); await writeFile(join(artifactDir, file), Buffer.from(screenshot.data, 'base64')); report.screenshots.push(file)
      await cdp.evaluate('(()=>{const b=[...document.querySelectorAll("[role=dialog] button")].find(e=>e.textContent==="Chỉnh nội dung");b.click();return true})()')
      await cdp.until('!!document.querySelector("[name=availability-start]")')
      check(await cdp.evaluate('(()=>{const d=document.querySelector("[role=dialog]");return d.scrollWidth<=d.clientWidth+1&&[...d.querySelectorAll("input:not([type=checkbox]),textarea")].every(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth})})()'), 'QA_REQUEST_FORM_OVERFLOW_' + width)
      if (width === 375) { const form = await cdp.send('Page.captureScreenshot', { format: 'png' }); await writeFile(join(artifactDir, 'availability-form-375.png'), Buffer.from(form.data, 'base64')); report.screenshots.push('availability-form-375.png') }
      await click('[data-staff-availability-preview]'); await cdp.until('!!document.querySelector("[data-staff-availability-review]")')
    }
    await escape()
  })
  await step('Real OSM persists while availability loads, errors and retries, including empty days', async () => {
    check(await cdp.evaluate('(()=>{const b=[...document.querySelectorAll("[data-staff-map] button")].find(e=>e.textContent==="Mở bản đồ");if(b){b.click();return true}return !!document.querySelector(".leaflet-container")})()'), 'QA_MAP_OPEN_MISSING')
    await cdp.until('["ready","error"].includes(document.querySelector("[data-staff-map]")?.dataset.staffMap)&&!!document.querySelector("[data-staff-branch-marker]")')
    if (await cdp.evaluate('document.querySelector("[data-staff-map]").dataset.staffMap==="error"')) {
      await cdp.evaluate('(()=>{[...document.querySelectorAll("[data-staff-map] button")].find(e=>e.textContent==="Thử tải bản đồ lại").click();return true})()'); await wait(200)
      await cdp.until('["ready","error"].includes(document.querySelector("[data-staff-map]")?.dataset.staffMap)&&!!document.querySelector("[data-staff-branch-marker]")')
    }
    report.mapTileCoverage = await cdp.evaluate('document.querySelector("[data-staff-map]").dataset.staffMap==="ready"?"REAL_PASS":"BLOCKED_EXTERNAL_TILE_SOURCE"')
    await cdp.evaluate('window.__qaAvailabilityMap=document.querySelector(".staff-branch-map-canvas");true')
    const branchGets = report.branchGets
    fault = 'hold'; await click('button[aria-label="Tuần sau"]'); await cdp.until('document.querySelector("[data-staff-areas-remote]")?.dataset.staffAreasRemote==="loading"')
    check(await cdp.evaluate('window.__qaAvailabilityMap===document.querySelector(".staff-branch-map-canvas")&&!!document.querySelector(".staff-areas-calendar [aria-busy=true]")'), 'QA_LOADING_REMOUNTED_MAP')
    fault = null; for (const requestId of held.splice(0)) await cdp.send('Fetch.continueRequest', { requestId }).catch(() => {}); await ready()
    fault = 'fail'; await click('button[aria-label="Tuần sau"]'); await cdp.until('document.querySelector("[data-staff-areas-remote]")?.dataset.staffAreasRemote==="error"')
    fault = null
    check(await cdp.evaluate('(()=>{const b=[...document.querySelectorAll(".staff-areas-calendar button")].find(e=>e.textContent==="Tải lại lịch khả dụng");if(!b)return false;b.click();return true})()'), 'QA_AVAILABILITY_RETRY_MISSING'); await ready()
    check(report.branchGets === branchGets && await cdp.evaluate('window.__qaAvailabilityMap===document.querySelector(".staff-branch-map-canvas")'), 'QA_CALENDAR_RETRY_CHANGED_MAP_OR_BRANCH')
    check(await cdp.evaluate('document.querySelectorAll("[data-staff-availability-id]").length===0'), 'QA_EXPECTED_EMPTY_FUTURE_WEEK')
    await click('[data-staff-availability-day-open]'); await cdp.until('!!document.querySelector("[data-staff-availability-detail=day]")'); check(await cdp.evaluate('document.querySelector("[role=dialog]").textContent.includes("Không có bản ghi không đồng nghĩa")'), 'QA_EMPTY_DAY_MISREPRESENTED'); await escape()
  })
  await step('A/B UI data and draft isolation, stale account header rejected', async () => {
    await click('[data-staff-availability-register]'); await cdp.until('!!document.querySelector("[data-staff-availability-request=register]")')
    await input('[name=availability-reason]', 'QA_ONLY_A_UNSENT_DRAFT', true)
    check((await api('/api/auth/logout')).status === 200, 'QA_LOGOUT_A_FAILED'); await login('B')
    check(await cdp.evaluate('document.querySelector("[data-staff-availability-interactive]").dataset.staffAvailabilityAccount===' + JSON.stringify(config.accounts.B.userId) + '&&!document.querySelector("[role=dialog]")&&!document.querySelector("[data-staff-availability-review]")'), 'QA_A_DRAFT_LEAKED_TO_B')
    const range = await currentRange(), path = '/api/staff/availability?' + new URLSearchParams(range), own = await api(path)
    const ids = await cdp.evaluate('[...document.querySelectorAll("[data-staff-availability-id]")].map(e=>e.dataset.staffAvailabilityId)')
    check(own.status === 200 && own.body.data.every(item => ids.includes(item.id)), 'QA_B_WINDOWS_DIFFER_FROM_BFF')
    check((await api(path, { 'X-Staff-Account-Id': config.accounts.A.userId })).status === 409, 'QA_CROSS_ACCOUNT_HEADER_NOT_BLOCKED')
    await click('[data-staff-availability-register]'); await cdp.until('!!document.querySelector("[name=availability-reason]")')
    check(await cdp.evaluate('document.querySelector("[name=availability-reason]").value===""'), 'QA_A_DRAFT_CONTENT_LEAKED_TO_B'); await escape()
    report.B = { windows: own.body.data.length }; check(report.forbiddenRequests === 0 && report.exceptions === 0, 'QA_RUNTIME_OR_MUTATION_BOUNDARY_FAILED')
    check((await api('/api/auth/logout')).status === 200, 'QA_LOGOUT_B_FAILED')
  })
  report.notRun.push({ name: 'Create, withdraw, approve or reject shift requests', status: 'NOT_RUN', reason: 'BLOCKED: no approved policy, write API, or Admin approval contract.' })
} catch (error) {
  report.failedAt = failedAt; report.error = /^[A-Z0-9_]+$/.test(error.message || '') ? error.message : 'QA_FAILURE_DETAILS_WITHHELD'; report.cdp = error.cdpMethod ? { method: error.cdpMethod, code: error.cdpCode, message: error.cdpMessage?.slice(0,200) } : undefined; process.exitCode = 1
  try { report.page = await cdp?.evaluate('({path:location.pathname,dialog:document.querySelector("[role=dialog]")?.textContent?.slice(0,200),areas:document.querySelector("[data-staff-areas-remote]")?.dataset.staffAreasRemote,map:document.querySelector("[data-staff-map]")?.dataset.staffMap})'); if (report.page?.path === '/khu-vuc') { const picture = await cdp.send('Page.captureScreenshot', { format: 'png' }); await writeFile(join(artifactDir, 'failure.png'), Buffer.from(picture.data, 'base64')) } } catch {}
} finally {
  clearTimeout(watchdog); fault = null; for (const requestId of held.splice(0)) await cdp?.send('Fetch.continueRequest', { requestId }).catch(() => {})
  try { await api('/api/auth/logout') } catch {} try { await cdp?.send('Browser.close') } catch {} if (browser?.exitCode === null) browser.kill()
  if (profile && dirname(resolve(profile)) === resolve(tmpdir()) && basename(profile).startsWith('cleanhome-staff-availability-qa-')) await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }).catch(() => {})
  report.pass = report.checks.length; report.fail = report.error ? 1 : 0
  if (artifactDir) await writeFile(join(artifactDir, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ pass: report.pass, fail: report.fail, failedAt: report.failedAt, error: report.error, layouts: report.layouts.length, report: artifactDir && join(artifactDir, 'report.json') }))
}
