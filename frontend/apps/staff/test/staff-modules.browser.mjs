import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { DEMO_INCOME_POLICY } from '../../../../backend/staff-service/src/income-policy.js'
import { STAFF_SUPPORT_POLICY } from '../../../packages/ui/src/components/staff/staff-support-questions.mjs'

// Actual Chrome against the built Staff UI, with explicit in-browser dependency doubles.
// No real auth, map/tile service, provider AI, Backend or database is used.
if (process.env.RUN_STAFF_MODULES_BROWSER_TESTS !== 'true') {
  console.log(JSON.stringify({ status: 'NOT_RUN', reason: 'Explicit opt-in required' }))
  process.exit(0)
}
const origin = new URL(process.env.STAFF_BFF_TEST_BASE_URL || 'http://localhost:3102').origin
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)) throw Error('LOOPBACK_REQUIRED')
const chromePath = process.env.STAFF_BFF_CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const folder = process.env.STAFF_MODULES_QA_ARTIFACT_DIR ? resolve(process.env.STAFF_MODULES_QA_ARTIFACT_DIR) : await mkdtemp(join(tmpdir(), 'cleanhome-staff-modules-report-'))
const report = { layer: 'Chrome UI with explicit browser-only BFF doubles; not real Backend or provider E2E', checks: [], layouts: [], exceptions: 0, duplicateKeyWarnings: 0,
  realMaps: 'NOT_RUN; on-demand control only; live Leaflet tiles use qa/staff/maps.browser.mjs', mapRequests: 0, realAI: 'NOT_RUN; provider unavailable fixture', realBackend: 'NOT_RUN' }
const delay = ms => new Promise(done => setTimeout(done, ms))
const check = (value, code) => { if (!value) throw Error(code) }
let chrome, socket, cdp, profile, failedAt = 'initialization'

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map()
    ws.addEventListener('message', event => {
      const message = JSON.parse(event.data)
      if (message.method === 'Network.requestWillBeSent') {
        const requestUrl = new URL(message.params.request.url)
        if (['maps.googleapis.com', 'maps.gstatic.com', 'tile.openstreetmap.org'].includes(requestUrl.hostname) ||
          (message.params.type === 'Image' && /^https?:$/.test(requestUrl.protocol) && requestUrl.origin !== origin)) report.mapRequests++
      }
      if (message.method === 'Runtime.exceptionThrown') report.exceptions++
      if (message.method === 'Runtime.consoleAPICalled' && message.params.args.some(arg => typeof arg.value === 'string' && /Encountered two children with the same key|Each child in a list should have a unique/.test(arg.value))) report.duplicateKeyWarnings++
      if (!message.id) return
      const item = this.pending.get(message.id)
      if (!item) return
      clearTimeout(item.timer); this.pending.delete(message.id)
      message.error ? item.reject(Error('CDP_REJECTED')) : item.resolve(message.result)
    })
  }
  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(Error('CDP_TIMEOUT')) }, 20000)
      this.pending.set(id, { resolve, reject, timer }); this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    check(!result.exceptionDetails, 'BROWSER_EXPRESSION_FAILED_CONTENTS_WITHHELD')
    return result.result.value
  }
  async until(expression) {
    const deadline = Date.now() + 20000
    while (Date.now() < deadline) { if (await this.evaluate(expression)) return; await delay(80) }
    throw Error('BROWSER_CONDITION_TIMEOUT')
  }
  async navigate(path, mode = 'ready') {
    await this.evaluate('location.origin===' + JSON.stringify(origin) + '&&(sessionStorage.setItem("staff-modules-qa-mode",' + JSON.stringify(mode) + '),true)')
    await this.send('Page.navigate', { url: origin + path })
    await this.until('location.pathname===' + JSON.stringify(path) + '&&document.readyState==="complete"&&!!window.__staffModulesQA&&!!document.querySelector("main h1")')
  }
}

function seed(origin, demoPolicy, supportPolicy) {
  if (location.origin !== origin) return
  const original = window.fetch.bind(window)
  const q = window.__staffModulesQA = { generation: crypto.randomUUID(), mode: sessionStorage.getItem('staff-modules-qa-mode') || 'ready', forbidden: 0, calls: {}, pending: [] }
  const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
  const error = (code, status = 503) => json({ error: { code, message: 'Browser QA dependency double' } }, status)
  const wait = (signal, respond) => new Promise((resolve, reject) => {
    const item = { resolve, respond, signal }; q.pending.push(item)
    signal?.addEventListener('abort', () => { q.pending = q.pending.filter(value => value !== item); reject(new DOMException('Aborted', 'AbortError')) }, { once: true })
  })
  q.release = () => { q.mode = 'ready'; for (const item of q.pending.splice(0)) if (!item.signal?.aborted) item.resolve(item.respond()) }
  const session = () => ({ session: { user: { id: '1', role: 'EMPLOYEE', status: 'ACTIVE' }, expiresAt: new Date(Date.now() + 3600000).toISOString() } })
  const income = month => {
    const empty = q.mode === 'income-empty', day = month + '-01', totalVnd = demoPolicy.unitPriceVnd + demoPolicy.peakBonusVnd
    return { period: { month, from: day, to: new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10), timezone: 'Asia/Ho_Chi_Minh' }, policy: demoPolicy,
      counts: { assignments: empty ? 0 : 1, eligible: empty ? 0 : 1, incomplete: 0, excluded: 0 }, estimateTotalVnd: empty ? 0 : totalVnd,
      assignments: empty ? [] : [{ id: '101', bookingId: '201', status: 'DONE', scheduledStart: day + 'T10:00:00.000Z', scheduledEnd: day + 'T11:00:00.000Z', checkInAt: day + 'T10:00:00.000Z', checkOutAt: day + 'T11:00:00.000Z', eligible: true, reason: null,
        detail: { day, baseVnd: demoPolicy.unitPriceVnd, peakVnd: demoPolicy.peakBonusVnd, distanceVnd: null, distanceStatus: 'UNVERIFIED', distanceKm: null, totalVnd } }],
      incentives: [], breakdown: { baseVnd: empty ? 0 : demoPolicy.unitPriceVnd, peakVnd: empty ? 0 : demoPolicy.peakBonusVnd, distanceVnd: 0, incentiveVnd: 0, unverifiedDistance: empty ? 0 : 1 }, payout: { status: 'NOT_INTEGRATED' }, timezone: 'Asia/Ho_Chi_Minh' }
  }
  const schedule = url => {
    const day = url.searchParams.get('from'), empty = q.mode === 'performance-empty'
    const data = empty ? [] : ['DONE', 'DONE', 'CANCELLED'].map((status, index) => ({
      id: String(index + 1), assignmentId: String(index + 1), orderId: String(index + 11), jobCode: null, orderCode: null, status, databaseStatus: status, jobStatus: status === 'DONE' ? 'done' : null,
      orderStatus: status === 'DONE' ? 'completed' : 'cancelled', scheduledAt: day + 'T02:00:00.000Z', expectedEndAt: day + 'T04:00:00.000Z', durationMinutes: 120,
      contact: { name: null, address: null }, services: [], checkInAt: status === 'DONE' ? day + 'T02:00:00.000Z' : null, checkOutAt: status === 'DONE' ? day + 'T04:00:00.000Z' : null, assignedAt: null,
    }))
    const pageSize = Number(url.searchParams.get('pageSize') || 100)
    return json({ data, pagination: { page: Number(url.searchParams.get('page') || 1), pageSize, total: data.length, totalPages: Math.ceil(data.length / pageSize) }, timezone: 'Asia/Ho_Chi_Minh' })
  }
  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url, location.href)
    const method = (init.method || input.method || 'GET').toUpperCase()
    if (url.origin !== origin || ['/internal/', '/api/v1/'].some(prefix => url.pathname.startsWith(prefix))) { q.forbidden++; throw Error('QA_EXTERNAL_OR_BACKEND_REFUSED') }
    if (url.pathname.startsWith('/api/')) q.calls[url.pathname] = (q.calls[url.pathname] || 0) + 1
    if (url.pathname === '/api/auth/session' || url.pathname === '/api/auth/renew') return json(session())
    if (url.pathname.startsWith('/api/auth/')) { q.forbidden++; throw Error('QA_AUTH_WRITE_REFUSED') }
    if (!url.pathname.startsWith('/api/staff/')) return original(input, init)
    if (method !== 'GET') { q.forbidden++; throw Error('QA_BUSINESS_WRITE_REFUSED') }
    if (url.pathname === '/api/staff/branch') {
      const respond = () => json({ data: { id: '31', name: 'Chi nhánh kiểm thử trình duyệt', addressText: 'Địa chỉ fixture trong browser QA', latitude: '10.8', longitude: '106.7', status: 'ACTIVE',
        serviceArea: { type: 'Polygon', coordinates: [[[106.69, 10.79], [106.71, 10.79], [106.71, 10.81], [106.69, 10.79]]] } }, timezone: 'Asia/Ho_Chi_Minh' })
      return q.mode === 'areas-hold' ? wait(init.signal, respond) : respond()
    }
    if (url.pathname === '/api/staff/availability') {
      const respond = () => {
        if (q.mode === 'areas-error') return error('STAFF_UNAVAILABLE')
        const from = url.searchParams.get('from'), to = url.searchParams.get('to')
        return json({ data: q.mode === 'areas-empty' ? [] : [{ id: '41', startsAt: from + 'T02:00:00.000Z', endsAt: from + 'T04:00:00.000Z', status: 'AVAILABLE' }],
          range: { from, to, timezone: 'Asia/Ho_Chi_Minh' }, branchId: '31', truncated: false })
      }
      return q.mode === 'areas-hold' ? wait(init.signal, respond) : respond()
    }
    if (url.pathname === '/api/staff/schedule') {
      const respond = () => q.mode === 'performance-error' ? error('STAFF_UNAVAILABLE') : schedule(url)
      return q.mode === 'performance-hold' ? wait(init.signal, respond) : respond()
    }
    if (url.pathname === '/api/staff/reviews') return error('REVIEWS_NOT_AVAILABLE')
    if (url.pathname === '/api/staff/support/chat') return json({ available: false, policyVersion: supportPolicy, mode: 'fixed-questions' })
    if (url.pathname === '/api/staff/income/estimate') {
      const respond = () => q.mode === 'income-error' ? error('INCOME_UNAVAILABLE') : json(income(url.searchParams.get('month')))
      return q.mode === 'income-hold' ? wait(init.signal, respond) : respond()
    }
    return error('QA_READ_DEPENDENCY_UNAVAILABLE')
  }
}

async function step(name, action) { failedAt = name; await action(); report.checks.push({ name, status: 'PASS' }); console.log(JSON.stringify({ name, status: 'PASS' })) }
async function clickText(text, scope = 'main') {
  check(await cdp.evaluate('(() => {const element=[...document.querySelectorAll(' + JSON.stringify(scope + ' button') + ')].find(e=>e.textContent.trim()===' + JSON.stringify(text) + ');if(!element)return false;element.click();return true})()'), 'ACTION_BUTTON_MISSING')
}
async function fill(selector, value) {
  check(await cdp.evaluate('(() => {const e=document.querySelector(' + JSON.stringify(selector) + ');if(!e)return false;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,' + JSON.stringify(value) + ');e.dispatchEvent(new Event("input",{bubbles:true}));e.dispatchEvent(new Event("change",{bubbles:true}));return true})()'), 'INPUT_MISSING')
}
async function choose(selector, value) {
  check(await cdp.evaluate('(() => {const e=document.querySelector(' + JSON.stringify(selector) + ');if(!e||e.disabled)return false;Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(e,' + JSON.stringify(value) + ');e.dispatchEvent(new Event("change",{bubbles:true}));return true})()'), 'SELECT_MISSING_OR_DISABLED')
}
async function layout(path, width) {
  await cdp.evaluate('document.fonts.ready.then(()=>true)')
  const result = await cdp.evaluate(`(() => {
    const visible=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden'};
    const named=e=>!!(e.getAttribute('aria-label')||e.getAttribute('title')||e.textContent.trim()||e.getAttribute('aria-labelledby')?.split(/\\s+/).some(id=>document.getElementById(id)?.textContent.trim()));
    const fields=[...document.querySelectorAll('main input:not([type=hidden]),main textarea,main select')].filter(visible);
    const buttons=[...document.querySelectorAll('main button')].filter(visible);
    return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth,lang:document.documentElement.lang,
      h1:document.querySelectorAll('main h1').length,unnamedButtons:buttons.filter(e=>!named(e)).length,
      unlabelledFields:fields.filter(e=>!e.labels?.length&&!e.getAttribute('aria-label')&&!e.getAttribute('aria-labelledby')).length,
      forbidden:window.__staffModulesQA.forbidden,
      timing:(()=>{const n=performance.getEntriesByType('navigation')[0];return n?{domContentLoadedMs:Math.round(n.domContentLoadedEventEnd),loadMs:Math.round(n.loadEventEnd)}:null})()};
  })()`)
  report.layouts.push({ path, width, ...result })
  check(result.scrollWidth <= result.width + 1, 'DOCUMENT_HORIZONTAL_OVERFLOW')
  check(result.h1 === 1 && result.lang.startsWith('vi') && result.unnamedButtons === 0 && result.unlabelledFields === 0, 'BASIC_ACCESSIBILITY')
  check(result.forbidden === 0, 'UNEXPECTED_EXTERNAL_OR_WRITE_REQUEST')
}
const watchdog = setTimeout(() => { report.hardTimeout = true; chrome?.kill() }, 240000)
try {
  await access(chromePath); await mkdir(folder, { recursive: true })
  profile = await mkdtemp(join(tmpdir(), 'cleanhome-staff-modules-chrome-'))
  chrome = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-sync', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: 'ignore' })
  let port
  for (let attempt = 0; attempt < 200; attempt++) {
    try { port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); if (port) break } catch {}
    check(chrome.exitCode === null, 'CHROME_START_FAILED'); await delay(100)
  }
  check(port, 'CHROME_START_TIMEOUT')
  const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list', { signal: AbortSignal.timeout(5000) })).json()
  const target = targets.find(value => value.type === 'page')
  check(target?.webSocketDebuggerUrl, 'CHROME_PAGE_MISSING')
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', () => reject(Error('CDP_CONNECT_FAILED')), { once: true }) })
  cdp = new CDP(socket)
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Network.enable')
  await cdp.send('Network.setBlockedURLs', { urls: ['*://maps.googleapis.com/*', '*://maps.gstatic.com/*', '*://tile.openstreetmap.org/*'] })
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: '(' + seed.toString() + ')(' + JSON.stringify(origin) + ',' + JSON.stringify(DEMO_INCOME_POLICY) + ',' + JSON.stringify(STAFF_SUPPORT_POLICY) + ')' })
  for (const width of [375, 390, 768, 1440]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false })
    for (const path of ['/khu-vuc', '/thu-nhap', '/ho-tro', '/thanh-tich']) await step(width + 'px ' + path + ' responsive and labels', async () => {
      await cdp.navigate(path)
      if (path === '/khu-vuc') {
        await cdp.until('!!document.querySelector("[data-staff-areas-remote=ready]")')
        check(await cdp.evaluate('(() => {const map=document.querySelector("[data-staff-map]");return !!map&&map.dataset.staffMap==="idle"&&([...map.querySelectorAll("button")].some(button=>button.textContent.trim()==="M\\u1edf b\\u1ea3n \\u0111\\u1ed3")||map.textContent.includes("Ngu\\u1ed3n b\\u1ea3n \\u0111\\u1ed3 ch\\u01b0a \\u0111\\u01b0\\u1ee3c c\\u1ea5u h\\u00ecnh"))&&!document.querySelector(".leaflet-container,script[src*=\\"maps.googleapis.com\\"]")})()'), 'MAPS_MUST_REMAIN_ON_DEMAND_OR_UNCONFIGURED')
        check(report.mapRequests === 0, 'MOCKED_SUITE_REQUESTED_LIVE_MAP_TILES')
      }
      if (path === '/thu-nhap') {
        await cdp.until('!!document.querySelector("[data-staff-income=unavailable],[data-staff-income-remote=ready]")')
        const gate = await cdp.evaluate('!!document.querySelector("[data-staff-income=unavailable]")')
        report.incomeMode = gate ? 'production unavailable gate' : 'development DEMO_V2 contract double'
        if (gate) check(await cdp.evaluate('!document.querySelector("[data-staff-income-total],[data-staff-income-assignment-id]")'), 'PRODUCTION_DISPLAYED_DEMO_MONEY')
      }
      if (path === '/ho-tro') {
        await cdp.until('!!document.querySelector("[data-support-chat-placeholder]")')
        await cdp.evaluate('document.querySelector("[data-support-chat-placeholder]").open=true;true')
        await cdp.until('!!document.querySelector("[data-support-chat-state=unavailable]")')
      }
      if (path === '/thanh-tich') await cdp.until('!!document.querySelector("[data-real-statistic=ALL]")&&!!document.querySelector("[data-staff-achievements-unavailable]")')
      await layout(path, width)
      if (width === 375 || width === 1440) {
        const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' })
        await writeFile(join(folder, width + path.replaceAll('/', '-') + '.png'), Buffer.from(screenshot.data, 'base64'))
      }
    })
  }
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false })
  if (report.incomeMode === 'development DEMO_V2 contract double') {
    report.incomeInteractions = 'development-only DEMO_V2 browser doubles'
    await step('DEMO_V2 income loading announces progress and hides unfinished amounts', async () => {
      await cdp.navigate('/thu-nhap', 'income-hold')
      await cdp.until('window.__staffModulesQA.pending.length>0&&!!document.querySelector("[data-staff-income-remote=loading]")')
      check(await cdp.evaluate('!!document.querySelector("main [role=status],main [aria-busy=true]")&&!document.querySelector("[data-staff-income-total],[data-staff-income-assignment-id]")'), 'INCOME_LOADING_SHOWED_UNFINISHED_MONEY')
      await cdp.evaluate('window.__staffModulesQA.release();true')
      await cdp.until('!!document.querySelector("[data-staff-income-remote=ready]")&&!!document.querySelector("[data-staff-income-assignment-id=\\"101\\"]")')
    })
    await step('DEMO_V2 income error has no stale total and retry restores the contract estimate', async () => {
      await cdp.navigate('/thu-nhap', 'income-error')
      await cdp.until('!!document.querySelector("[data-staff-income-remote=error]")')
      check(await cdp.evaluate('!!document.querySelector("[data-staff-income-error][role=alert]")&&!document.querySelector("[data-staff-income-total],[data-staff-income-assignment-id]")'), 'INCOME_ERROR_SHOWED_STALE_MONEY')
      await cdp.evaluate('window.__staffModulesQA.mode="ready";true'); await clickText('Thử lại', '[data-staff-income-error]')
      await cdp.until('!!document.querySelector("[data-staff-income-remote=ready]")&&!!document.querySelector("[data-staff-income-total]")')
      check(await cdp.evaluate('Number(document.querySelector("[data-staff-income-total]").dataset.staffIncomeTotal)===' + (DEMO_INCOME_POLICY.unitPriceVnd + DEMO_INCOME_POLICY.peakBonusVnd)
        + '&&document.querySelector("[data-staff-income-payout]").textContent.includes("Chưa có giao dịch được xác nhận")'), 'INCOME_RETRY_TOTAL_OR_PAYMENT_STATE')
    })
    await step('DEMO_V2 income empty month has an empty state without a fabricated paid zero', async () => {
      await cdp.navigate('/thu-nhap', 'income-empty')
      await cdp.until('!!document.querySelector("[data-staff-income-remote=ready]")')
      check(await cdp.evaluate('document.querySelector("main").textContent.includes("Chưa có phân công trong tháng")&&!document.querySelector("[data-staff-income-total],[data-staff-income-assignment-id]")'), 'INCOME_EMPTY_STATE')
    })
    await step('DEMO_V2 income chart grouping and statement filters preserve the period total', async () => {
      await cdp.navigate('/thu-nhap'); await cdp.until('!!document.querySelector("[data-staff-income-assignment-id=\\"101\\"]")')
      const originalTotal = await cdp.evaluate('document.querySelector("[data-staff-income-total]").dataset.staffIncomeTotal')
      await choose('[data-income-insights] select', 'week'); await cdp.until('!!document.querySelector("[data-income-chart-period=week]")')
      await choose('[data-income-insights] select', 'month'); await cdp.until('!!document.querySelector("[data-income-chart-period=month]")')
      await choose('[data-income-insights] .staff-income-insights-filters label:nth-child(2) select', 'distanceVnd')
      await cdp.until('document.querySelector("[data-income-insights]").textContent.includes("không coi là 0đ đã xác nhận")')
      await clickText('Số liệu', '[data-income-insights]')
      await cdp.until('!!document.querySelector("[data-income-insights] table caption")&&!document.querySelector("[data-income-chart-period]")')
      await fill('#staff-income-entry-search', '999999'); await cdp.until('document.querySelector("main").textContent.includes("Không có phân công phù hợp")')
      check(await cdp.evaluate('!document.querySelector("[data-staff-income-assignment-id]")'), 'INCOME_SEARCH_RETAINED_NONMATCHING_ROW')
      await fill('#staff-income-entry-search', '101'); await cdp.until('!!document.querySelector("[data-staff-income-assignment-id=\\"101\\"]")')
      await choose('#staff-income-distance-filter', 'verified'); await cdp.until('!document.querySelector("[data-staff-income-assignment-id]")')
      await choose('#staff-income-distance-filter', 'unverified'); await cdp.until('!!document.querySelector("[data-staff-income-assignment-id=\\"101\\"]")')
      check(await cdp.evaluate('document.querySelector("[data-staff-income-total]").dataset.staffIncomeTotal===' + JSON.stringify(originalTotal) + '&&window.__staffModulesQA.forbidden===0'), 'INCOME_FILTER_CHANGED_TOTAL_OR_SENT_WRITE')
    })
  } else report.incomeInteractions = 'NOT_RUN; production gate intentionally disables DEMO_V2 UI'
  await step('areas loading is announced then resolves', async () => {
    await cdp.navigate('/khu-vuc', 'areas-hold')
    await cdp.until('window.__staffModulesQA.pending.length>=2&&!!document.querySelector("[data-staff-areas-remote=loading]")')
    check(await cdp.evaluate('!!document.querySelector("main [role=status],main [aria-busy=true]")'), 'LOADING_NOT_ANNOUNCED')
    await cdp.evaluate('window.__staffModulesQA.release();true'); await cdp.until('!!document.querySelector("[data-staff-areas-remote=ready]")')
  })
  await step('availability failure preserves branch and map; retry restores shifts', async () => {
    await cdp.navigate('/khu-vuc', 'areas-error')
    await cdp.until('!!document.querySelector("[data-staff-areas-remote=error]")&&!!document.querySelector("[data-staff-branch-id]")')
    check(await cdp.evaluate('!!document.querySelector("[data-staff-map]")&&document.querySelector("main").textContent.includes("Bản đồ vẫn hiển thị dữ liệu chi nhánh đã tải")'), 'AVAILABILITY_FAILURE_REMOVED_BRANCH_MAP')
    await cdp.evaluate('window.__staffModulesQA.mode="ready";true'); await clickText('Thử lại')
    await cdp.until('!!document.querySelector("[data-staff-areas-remote=ready]")&&!!document.querySelector("[data-staff-availability-id]")')
  })
  await step('areas empty availability never fabricates a shift', async () => {
    await cdp.navigate('/khu-vuc', 'areas-empty'); await cdp.until('!!document.querySelector("[data-staff-areas-remote=ready]")')
    check(await cdp.evaluate('document.querySelector("main").textContent.includes("Chưa có lịch khả dụng")&&!document.querySelector("[data-staff-availability-id]")&&!!document.querySelector("[data-staff-branch-id]")'), 'AREAS_EMPTY_STATE')
  })
  await step('F5 rechecks the session and reloads the authorized module', async () => {
    await cdp.navigate('/khu-vuc')
    await cdp.until('!!document.querySelector("[data-staff-areas-remote=ready]")')
    const generation = await cdp.evaluate('window.__staffModulesQA.generation')
    await cdp.send('Page.reload', { ignoreCache: true })
    await cdp.until('!!window.__staffModulesQA&&window.__staffModulesQA.generation!==' + JSON.stringify(generation) + '&&!!document.querySelector("[data-staff-areas-remote=ready]")')
    check(await cdp.evaluate('location.pathname==="/khu-vuc"&&window.__staffModulesQA.calls["/api/auth/session"]>=1&&window.__staffModulesQA.calls["/api/staff/branch"]>=1&&window.__staffModulesQA.forbidden===0'), 'RELOAD_DID_NOT_RECHECK_SESSION')
  })
  await step('FAQ search and unavailable chatbot stay usable without sending content', async () => {
    await cdp.navigate('/ho-tro'); await cdp.until('!!document.querySelector("#staff-help-search")')
    await fill('#staff-help-search', 'zzzz-no-qa-match'); await cdp.until('document.querySelector("main").textContent.includes("Chưa tìm thấy hướng dẫn phù hợp")')
    await fill('#staff-help-search', '')
    await cdp.evaluate('document.querySelector("[data-support-chat-placeholder]").open=true;true'); await cdp.until('!!document.querySelector("[data-support-chat-state=unavailable]")')
    check(await cdp.evaluate('document.querySelector("#staff-assistant-question").disabled&&document.querySelector("[data-support-chat-state] button[type=submit]").disabled&&!document.querySelector("[role=log] article")'), 'UNAVAILABLE_CHAT_ALLOWED_SEND_OR_FAKE_REPLY')
    await clickText('Thử kết nối lại', '[data-support-chat-state]'); await cdp.until('!!document.querySelector("[data-support-chat-state=unavailable]")')
    check(await cdp.evaluate('window.__staffModulesQA.forbidden===0'), 'CHATBOT_SENT_UNAUTHORIZED_CONTENT')
  })
  await step('performance loading then error and retry retain honest states', async () => {
    await cdp.navigate('/thanh-tich', 'performance-hold')
    await cdp.until('window.__staffModulesQA.pending.length>0&&!!document.querySelector("[data-staff-performance] [aria-busy=true]")')
    await cdp.evaluate('window.__staffModulesQA.release();true'); await cdp.until('!!document.querySelector("[data-real-statistic=ALL]")')
    await cdp.navigate('/thanh-tich', 'performance-error'); await cdp.until('!!document.querySelector("[data-staff-performance] [role=alert]")')
    check(await cdp.evaluate('!document.querySelector("[data-real-statistic=ALL]")'), 'PERFORMANCE_ERROR_SHOWED_STALE_METRIC')
    await cdp.evaluate('window.__staffModulesQA.mode="ready";true'); await clickText('Thử lại', '[data-staff-performance]')
    await cdp.until('!!document.querySelector("[data-real-statistic=ALL]")')
  })
  await step('performance empty has no fabricated rate or review', async () => {
    await cdp.navigate('/thanh-tich', 'performance-empty')
    await cdp.until('document.querySelector("[data-staff-performance]")?.textContent.includes("Không có phân công nào")')
    check(await cdp.evaluate('!document.querySelector("[data-real-metric],[data-demo-review],[data-demo-achievement]")'), 'EMPTY_PERFORMANCE_FABRICATED_DATA')
  })
  await step('keyboard reaches an interactive control and no browser exception is raised', async () => {
    await cdp.send('Page.bringToFront'); await cdp.evaluate('document.activeElement?.blur();true')
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
    check(await cdp.evaluate('!!document.activeElement&&document.activeElement!==document.body&&document.activeElement!==document.documentElement'), 'KEYBOARD_FOCUS_MISSING')
    check(report.exceptions === 0, 'BROWSER_EXCEPTION')
    check(report.duplicateKeyWarnings === 0, 'DUPLICATE_REACT_KEY')
    check(report.mapRequests === 0, 'MOCKED_SUITE_REQUESTED_LIVE_MAP_TILES')
  })
  report.status = 'PASS'
} catch (error) {
  report.status = 'FAIL'; report.failedAt = failedAt
  report.error = /^[A-Z_]+$/.test(error.message) ? error.message : 'DETAILS_WITHHELD'
  process.exitCode = 1
} finally {
  clearTimeout(watchdog)
  try { await cdp?.send('Browser.close') } catch {}
  socket?.close(); if (chrome?.exitCode === null) chrome.kill()
  if (profile) {
    const target = resolve(profile)
    if (dirname(target) === resolve(tmpdir()) && basename(target).startsWith('cleanhome-staff-modules-chrome-')) {
      try { await rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); report.profileClosed = true } catch { report.profileClosed = false }
    }
  }
  report.pass = report.checks.length; report.fail = report.status === 'FAIL' ? 1 : 0
  await mkdir(folder, { recursive: true }); await writeFile(join(folder, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ status: report.status, pass: report.pass, fail: report.fail, layouts: report.layouts.length, failedAt: report.failedAt, report: join(folder, 'report.json'), profileClosed: report.profileClosed }))
}
