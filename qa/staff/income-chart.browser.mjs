import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { loadConfig, privateDirectory } from './common.mjs'

if (process.env.RUN_STAFF_INCOME_CHART_QA !== 'true') { console.log(JSON.stringify({ status: 'NOT_RUN', reason: 'Isolated QA opt-in required' })); process.exit(0) }
const before = process.argv.includes('--before'), wait = ms => new Promise(done => setTimeout(done, ms))
const tableOnly = process.argv.includes('--table-layout')
const screenWidth = Number(process.argv.find(arg => arg.startsWith('--screen-width='))?.split('=')[1] || 0)
const check = (value, code) => { if (!value) throw Error(code) }
const pointer = join(privateDirectory, tableOnly ? 'income-table-layout-artifacts.json' : 'income-chart-artifacts.json')
const report = { phase: before ? 'before' : 'after', checks: [], layouts: [], exceptions: 0, forbidden: 0, databaseAccessed: false, providerCalls: 0 }
let config, browser, profile, cdp, artifacts, failedAt = 'setup', fault = null, account = 'A', maximumActive = 0
const held = [], incomeRequests = []
const network = new Map(), activeRequests = new Set(), apiValues = new Map()
class CDP {
  constructor(ws) { this.ws = ws; this.seq = 0; this.pending = new Map(); this.listeners = []; ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id) { const p = this.pending.get(m.id); if (p) { clearTimeout(p.timer); this.pending.delete(m.id); m.error ? p.reject(Error('QA_CDP_FAILED')) : p.done(m.result) } } else for (const fn of this.listeners) fn(m.method, m.params) }); ws.addEventListener('close', () => { for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(Error('QA_BROWSER_CLOSED')) } this.pending.clear() }) }
  send(method, params = {}) { const id = ++this.seq; return new Promise((done, reject) => { const timer = setTimeout(() => { this.pending.delete(id); reject(Error('QA_CDP_TIMEOUT')) }, 25000); this.pending.set(id, { done, reject, timer }); this.ws.send(JSON.stringify({ id, method, params })) }) }
  async evaluate(expression) { const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) report.expressionError = { type: r.exceptionDetails.exception?.className, property: /reading '([a-zA-Z0-9_.-]+)'/.exec(r.exceptionDetails.exception?.description || '')?.[1] }; check(!r.exceptionDetails, 'QA_EXPRESSION_FAILED'); return r.result.value }
  async until(expression, ms = 35000) { const end = Date.now() + ms; while (Date.now() < end) { if (await this.evaluate(expression)) return; await wait(80) } throw Error('QA_UI_TIMEOUT') }
  async navigate(route) { const time = await this.evaluate('performance.timeOrigin'); await this.send('Page.navigate', { url: config.frontendOrigin + route }); await this.until('performance.timeOrigin!==' + JSON.stringify(time) + '&&location.pathname===' + JSON.stringify(route) + '&&document.readyState==="complete"') }
}
async function step(name, status, run) { failedAt = name; await run(); report.checks.push({ name, status }); console.log(JSON.stringify({ name, status })) }
async function launch() {
  const exe = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'; await access(exe)
  profile = await mkdtemp(join(tmpdir(), 'cleanhome-staff-income-chart-'))
  browser = spawn(exe, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--window-size=1440,1000', 'about:blank'], { windowsHide: true, stdio: 'ignore' })
  let port
  for (let i = 0; i < 120; i++) { try { port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); if (port) break } catch {} await wait(100) }
  check(port, 'QA_CHROME_NOT_READY')
  const pages = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json(), ws = new WebSocket(pages.find(p => p.type === 'page').webSocketDebuggerUrl)
  await new Promise((done, reject) => { ws.addEventListener('open', done, { once: true }); ws.addEventListener('error', () => reject(Error('QA_CHROME_CONNECT_FAILED')), { once: true }) }); cdp = new CDP(ws)
  cdp.listeners.push((method, p) => {
    if (method === 'Runtime.exceptionThrown') report.exceptions++
    if (method === 'Network.requestWillBeSent' && new URL(p.request.url).pathname === '/api/staff/income/estimate') { network.set(p.requestId, { month: new URL(p.request.url).searchParams.get('month'), account }); activeRequests.add(p.requestId); maximumActive = Math.max(maximumActive, activeRequests.size) }
    if (method === 'Network.responseReceived' && network.has(p.requestId)) { network.get(p.requestId).status = p.response.status; activeRequests.delete(p.requestId) }
    if (method === 'Network.loadingFinished' && network.has(p.requestId)) { activeRequests.delete(p.requestId); const meta = network.get(p.requestId); if (meta.status === 200) void cdp.send('Network.getResponseBody', { requestId: p.requestId }).then(value => { const body = JSON.parse(value.base64Encoded ? Buffer.from(value.body, 'base64').toString('utf8') : value.body); apiValues.set(meta.account + ':' + meta.month, body) }).catch(() => {}) }
    if (method === 'Network.loadingFailed') activeRequests.delete(p.requestId)
    if (method !== 'Fetch.requestPaused') return
    const url = new URL(p.request.url), verb = p.request.method, auth = verb === 'POST' && ['/api/auth/login', '/api/auth/logout'].includes(url.pathname)
    if (url.origin !== config.frontendOrigin || verb !== 'GET' && !auth) { report.forbidden++; void cdp.send('Fetch.failRequest', { requestId: p.requestId, errorReason: 'BlockedByClient' }).catch(() => {}); return }
    if (url.pathname === '/api/staff/income/estimate') {
      incomeRequests.push(url.searchParams.get('month'))
      if (fault) { if (fault === 'hold') held.push(p.requestId); else void cdp.send('Fetch.failRequest', { requestId: p.requestId, errorReason: 'ConnectionFailed' }).catch(() => {}); return }
    }
    void cdp.send('Fetch.continueRequest', { requestId: p.requestId }).catch(() => {})
  })
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Network.enable'); await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] })
}
async function input(selector, value) { await cdp.until('!!document.querySelector(' + JSON.stringify(selector) + ')'); await cdp.evaluate('(()=>{const e=document.querySelector(' + JSON.stringify(selector) + ');Object.getOwnPropertyDescriptor(e.tagName==="SELECT"?HTMLSelectElement.prototype:HTMLInputElement.prototype,"value").set.call(e,' + JSON.stringify(value) + ');e.dispatchEvent(new Event("input",{bubbles:true}));e.dispatchEvent(new Event("change",{bubbles:true}));return true})()') }
async function click(selector) { await cdp.until('!!document.querySelector(' + JSON.stringify(selector) + ')'); await cdp.evaluate('document.querySelector(' + JSON.stringify(selector) + ').scrollIntoView({block:"center"});true'); await wait(80); const point = await cdp.evaluate('(()=>{const r=document.querySelector(' + JSON.stringify(selector) + ').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()'); await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: 1 }); await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', buttons: 0, clickCount: 1 }) }
async function login(label) { account = label; await cdp.navigate('/dang-nhap'); await input('[name=phone]', config.accounts[label].phone); await input('[name=password]', config.accounts[label].password); await cdp.evaluate('document.querySelector("form").requestSubmit();true'); await cdp.until('location.pathname!=="/dang-nhap"&&!!document.querySelector(".staff-account-trigger")') }
async function logout() { await cdp.evaluate('(async()=>{await fetch("/api/auth/logout",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});return true})()') }
async function ready() { await cdp.until('document.querySelector("[data-staff-income-remote]")?.dataset.staffIncomeRemote==="ready"'); if (!before || tableOnly) await cdp.until('document.querySelector("[data-income-history-state]")?.dataset.incomeHistoryState==="ready"') }
async function shot(file) { const r = await cdp.send('Page.captureScreenshot', { format: 'png' }); await writeFile(join(artifacts, file), Buffer.from(r.data, 'base64')) }
async function capture() {
  for (const [width, height] of [[375, 812], [390, 844], [768, 1024], [1440, 1000]]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 768 }); await wait(120); await ready()
    await cdp.evaluate('document.querySelector("[data-income-insights]").scrollIntoView({block:"start"});window.scrollBy(0,-82);true')
    const layout = await cdp.evaluate('({width:innerWidth,scroll:document.documentElement.scrollWidth,chart:document.querySelector("[data-income-chart-scroll]")?.clientWidth})'); report.layouts.push(layout); check(layout.scroll <= width, 'QA_PAGE_HORIZONTAL_OVERFLOW_' + width)
    const cardHeight = await cdp.evaluate('document.querySelector("[data-income-insights]").firstElementChild.getBoundingClientRect().height')
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: Math.ceil(cardHeight + 180), deviceScaleFactor: 1, mobile: width < 768 }); await wait(150); await ready()
    await cdp.evaluate('document.activeElement?.blur();document.querySelector("[data-income-insights]").scrollIntoView({block:"start"});window.scrollBy(0,-90);true')
    const clip = await cdp.evaluate('(()=>{const r=document.querySelector("[data-income-insights]").firstElementChild.getBoundingClientRect();return {x:r.left+scrollX,y:r.top+scrollY,width:r.width,height:r.height,scale:1}})()')
    const picture = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip }); await writeFile(join(artifacts, report.phase + '-' + width + '.png'), Buffer.from(picture.data, 'base64'))
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 768 }); await wait(150); await ready()
  }
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false }); await ready()
}
async function compare() {
  const state = await cdp.evaluate('({months:document.querySelector("[data-income-insights]").dataset.incomeHistoryMonths.split(","),source:document.querySelector("[data-income-source]").value,period:document.querySelector("[data-income-period]").value,total:Number(document.querySelector("[data-income-filter-total]").dataset.incomeFilterTotal),rows:[...document.querySelectorAll("[data-income-bucket]")].map(e=>({key:e.dataset.incomeBucket,amount:Number(e.dataset.incomeBucketAmount),count:Number(e.dataset.incomeBucketCount)}))})')
  for (const month of state.months) { const deadline = Date.now() + 5000; while (!apiValues.has(account + ':' + month) && Date.now() < deadline) await wait(50); check(apiValues.has(account + ':' + month), 'QA_BACKEND_RESPONSE_NOT_CAPTURED') }
  const data = state.months.map(month => apiValues.get(account + ':' + month))
  const sum = data.reduce((n, value) => n + (state.source === 'amountVnd' ? value.estimateTotalVnd : value.breakdown[state.source]), 0)
  check(state.total === sum && state.rows.reduce((n, row) => n + row.amount, 0) === sum, 'QA_CHART_DIFFERS_FROM_BACKEND')
  check(state.rows.reduce((n, row) => n + row.count, 0) === data.reduce((n, value) => n + value.counts.eligible, 0), 'QA_CHART_COUNT_DIFFERS_FROM_BACKEND')
  check(await cdp.evaluate('(()=>{const plot=document.querySelector("[data-income-axis-max]"),max=Number(plot.dataset.incomeAxisMax),height=plot.clientHeight;return [...plot.querySelectorAll("[data-income-bucket]")].every(e=>Math.abs(e.querySelector("[data-income-bar]").getBoundingClientRect().height-Number(e.dataset.incomeBucketAmount)/max*height)<1)})()'), 'QA_BAR_HEIGHT_NOT_PROPORTIONAL')
  return { ...state, backend: data }
}
async function key(name, code = name, virtual = 13) { await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code, windowsVirtualKeyCode: virtual, ...(name === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}) }); await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code, windowsVirtualKeyCode: virtual }) }
async function tableLayoutChecks() {
  check(!screenWidth || Number.isInteger(screenWidth) && screenWidth >= 320 && screenWidth <= 7680, 'QA_SCREEN_WIDTH_INVALID')
  const state = await compare()
  await click('[data-income-view=table]'); await cdp.until('!!document.querySelector("[data-income-history-table]")')
  report.tableLayouts = []; report.tableViolations = []; report.screenWidth = screenWidth || null
  const widths = [...new Set([375, 390, 768, 1024, 1440, ...(screenWidth ? [screenWidth] : [])])]
  for (const [index, width] of widths.entries()) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: width < 768 ? 844 : 1000, deviceScaleFactor: 1, mobile: width < 768 })
    await wait(150); await ready()
    if (!await cdp.evaluate('!!document.querySelector("[data-income-history-table]")')) await click('[data-income-view=table]')
    await cdp.until('!!document.querySelector("[data-income-history-table]")')
    const metrics = await cdp.evaluate(`(() => {
      const table = document.querySelector('[data-income-history-table]'), wrap = table.parentElement
      const lines = cell => { const range = document.createRange(); range.selectNodeContents(cell); return new Set([...range.getClientRects()].filter(r => r.width > 0 && r.height > 0).map(r => Math.round(r.top))).size }
      const headers = [...table.tHead.rows[0].cells], rows = [...table.tBodies[0].rows]
      const moneyCells = [...table.querySelectorAll('tbody td:nth-child(n+3):not(:last-child)')]
      const buttons = [...table.querySelectorAll('tbody button')]
      return {
        width: innerWidth, pageWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth,
        tableWidth: table.getBoundingClientRect().width, wrapWidth: wrap.clientWidth, wrapScrollWidth: wrap.scrollWidth,
        headers: headers.map(cell => ({ label: cell.textContent, width: cell.getBoundingClientRect().width, lines: lines(cell) })),
        maxMoneyLines: Math.max(...moneyCells.map(lines)), moneyAlignedRight: moneyCells.every(cell => getComputedStyle(cell).textAlign === 'right'),
        maxRowHeight: Math.max(...rows.map(row => row.getBoundingClientRect().height)), headerHeight: table.tHead.getBoundingClientRect().height,
        tableHeight: table.getBoundingClientRect().height, rowCount: rows.length,
        actionWidth: Math.min(...rows.map(row => row.lastElementChild.getBoundingClientRect().width)),
        minButtonWidth: Math.min(...buttons.map(button => button.getBoundingClientRect().width)),
        buttonsContained: buttons.every(button => { const b = button.getBoundingClientRect(), c = button.closest('td').getBoundingClientRect(); return b.left >= c.left - 1 && b.right <= c.right + 1 }),
        statement: rows.map(row => { const cells = [...row.cells], amount = Number(cells[6].dataset.incomeTableAmount); const parts = cells.slice(2,6).map(cell => /^[-\\d\\s.,\u20ab\u0111]+$/.test(cell.textContent) ? Number(cell.textContent.replace(/[^\\d-]/g,'')) : null); return { amount, components: parts.includes(null) ? null : parts.reduce((sum, value) => sum + value, 0) } })
      }
    })()`)
    const violations = []
    if (metrics.pageWidth > metrics.clientWidth + 1) violations.push('PAGE_HORIZONTAL_OVERFLOW')
    if (metrics.headers.some(cell => cell.lines !== 1)) violations.push('HEADER_WRAPPING')
    if (metrics.maxMoneyLines !== 1) violations.push('MONEY_WRAPPING')
    if (!metrics.moneyAlignedRight) violations.push('MONEY_NOT_RIGHT_ALIGNED')
    if (metrics.actionWidth < 80 || metrics.minButtonWidth < 60 || !metrics.buttonsContained) violations.push('ACTION_COLUMN_TOO_NARROW')
    if (metrics.maxRowHeight > 88 || metrics.headerHeight > 64 || metrics.tableHeight > metrics.rowCount * 88 + 120) violations.push('EXCESSIVE_ROW_HEIGHT')
    if (metrics.wrapScrollWidth + 1 < metrics.tableWidth) violations.push('TABLE_SCROLL_NOT_CONTAINED')
    report.tableLayouts.push(metrics)
    report.tableViolations.push(...violations.map(code => ({ width, code })))
    check(metrics.statement.reduce((sum, row) => sum + row.amount, 0) === state.total, 'QA_TABLE_TOTAL_DIFFERS_FROM_BACKEND')
    const mismatches = metrics.statement.filter(row => row.components !== null && row.components !== row.amount)
    if (mismatches.length) { report.amountMismatches = mismatches; throw Error('QA_TABLE_COMPONENT_SUM_MISMATCH') }
    await cdp.evaluate('document.querySelector("[data-income-history-table]").parentElement.scrollLeft=0;document.querySelector("[data-income-history-table]").parentElement.scrollIntoView({block:"start"});window.scrollBy(0,-90);true')
    await shot(report.phase + '-table-' + width + '-left.png')
    await cdp.evaluate('(()=>{const e=document.querySelector("[data-income-history-table]").parentElement;e.scrollLeft=e.scrollWidth;return true})()')
    await shot(report.phase + '-table-' + width + '-right.png')
    const rowIndex = index % metrics.rowCount + 1
    const expected = await cdp.evaluate('(()=>{const r=document.querySelector("[data-income-history-table] tbody tr:nth-child(' + rowIndex + ')");return {label:r.cells[0].textContent,amount:Number(r.cells[6].dataset.incomeTableAmount)}})()')
    await click('[data-income-history-table] tbody tr:nth-child(' + rowIndex + ') button')
    await cdp.until('document.querySelector("[data-income-selected-total]")?.dataset.incomeSelectedTotal===' + JSON.stringify(String(expected.amount)) + '&&document.querySelector("[data-income-selected-total] h3")?.textContent.includes(' + JSON.stringify(expected.label) + ')')
    metrics.viewButtonWorks = true
  }
  report.layoutRegression = report.tableViolations.length ? 'FAIL' : 'PASS'
  if (!before) check(report.tableViolations.length === 0, 'QA_INCOME_TABLE_LAYOUT_REGRESSION')
}
async function afterChecks() {
  await step('Daily columns, all sources and statement match real Backend amounts', 'REAL_PASS', async () => {
    for (const source of ['amountVnd', 'baseVnd', 'peakVnd', 'distanceVnd', 'incentiveVnd']) { await input('[data-income-source]', source); await cdp.until('document.querySelector("[data-income-filter-total]")?.dataset.incomeFilterSource===' + JSON.stringify(source)); const state = await compare(); check(state.rows.length === Number(state.backend[0].period.to.slice(8)), 'QA_ZERO_DAYS_MISSING') }
    await input('[data-income-source]', 'amountVnd'); await cdp.until('document.querySelector("[data-income-filter-total]")?.dataset.incomeFilterSource==="amountVnd"'); const state = await compare(); report.initialTotal = state.total
    check(await cdp.evaluate('Number(document.querySelector("[data-income-statement-reconciled]").dataset.incomeStatementReconciled)===Number(document.querySelector("[data-income-filter-total]").dataset.incomeFilterTotal)'), 'QA_STATEMENT_TOTAL_MISMATCH')
  })
  await step('Keyboard tooltip, arrow navigation, selection and alternative table', 'REAL_PASS', async () => {
    await cdp.evaluate('document.querySelector("[data-income-chart-scroll]").focus();true'); await key('Tab', 'Tab', 9); await wait(150); report.keyboardFocus = await cdp.evaluate('({bucket:document.activeElement?.dataset.incomeBucket||null,tooltip:!!document.querySelector("[role=tooltip]"),columns:document.querySelectorAll("[data-income-bucket]").length})'); await cdp.until('!!document.querySelector("[role=tooltip]")',5000); await key('ArrowRight', 'ArrowRight', 39); await key('Enter'); await cdp.until('!!document.querySelector("[data-income-selected-total]")',5000)
    check(await cdp.evaluate('document.activeElement.matches("[data-income-bucket]")&&Number(document.querySelector("[data-income-selected-total]").dataset.incomeSelectedTotal)===Number(document.activeElement.dataset.incomeBucketAmount)&&!!document.getElementById(document.activeElement.getAttribute("aria-describedby"))'), 'QA_KEYBOARD_SELECTION_FAILED')
    await key('Escape', 'Escape', 27); await cdp.until('!document.querySelector("[role=tooltip]")'); await input('[data-income-source]', 'baseVnd'); await cdp.until('document.querySelector("[data-income-filter-total]")?.dataset.incomeFilterSource==="baseVnd"'); await cdp.evaluate('document.querySelector("[data-income-chart-scroll]").focus();true'); await key('Tab','Tab',9); await cdp.until('!!document.querySelector("[role=tooltip]")'); check(await cdp.evaluate('document.querySelector("[role=tooltip] strong").textContent.includes("70.000")'), 'QA_TOOLTIP_OMITS_OVERALL_TOTAL'); await input('[data-income-source]', 'amountVnd'); await cdp.until('document.querySelector("[data-income-filter-total]")?.dataset.incomeFilterSource==="amountVnd"')
    await click('[data-income-view=table]'); await cdp.until('!!document.querySelector("[data-income-history-table]")'); check(await cdp.evaluate('[...document.querySelectorAll("[data-income-table-amount]")].reduce((n,e)=>n+Number(e.dataset.incomeTableAmount),0)===Number(document.querySelector("[data-income-filter-total]").dataset.incomeFilterTotal)'), 'QA_TABLE_DIFFERS_FROM_CHART'); await click('[data-income-view=chart]'); await cdp.until('!!document.querySelector("[data-income-chart-scroll]")')
  })
  await step('Real 3/6/12-month comparison has bounded requests and matches Backend', 'REAL_PASS', async () => {
    report.ranges = []; maximumActive = 0; activeRequests.clear()
    for (const span of [3, 6, 12]) { const first = incomeRequests.length; await input('[data-income-span]', String(span)); await ready(); const state = await compare(); check(state.months.length === span && state.rows.length === span, 'QA_MONTH_RANGE_MISSING'); check(incomeRequests.length - first <= span, 'QA_UNBOUNDED_HISTORY_REQUESTS'); report.ranges.push({ span, requests: incomeRequests.length - first, total: state.total }) }
    report.maximumConcurrentHistoryRequests = maximumActive; check(maximumActive <= 2, 'QA_TOO_MANY_CONCURRENT_REQUESTS'); await shot('after-12-months.png')
  })
  await step('Weekly grouping, year boundary and previous/next ranges', 'REAL_PASS', async () => {
    await input('[data-income-span]', '3'); await ready(); await input('[data-income-period]', 'week'); await input('[data-income-end]', '2027-01'); await ready(); await compare()
    await click('[aria-label="Khoảng thu nhập trước"]'); await ready(); check(await cdp.evaluate('document.querySelector("[data-income-end]").value==="2026-10"'), 'QA_PREVIOUS_RANGE_INCORRECT'); await compare()
    await click('[aria-label="Khoảng thu nhập sau"]'); await ready(); check(await cdp.evaluate('document.querySelector("[data-income-end]").value==="2027-01"'), 'QA_NEXT_RANGE_INCORRECT'); await compare()
  })
  await step('Loading and injected network failure never become zero; explicit retry recovers', 'MOCK_PASS', async () => {
    fault = 'hold'; await input('[data-income-end]', '2026-05'); await cdp.until('document.querySelector("[data-income-insights]")?.dataset.incomeHistoryState==="loading"'); check(await cdp.evaluate('!document.querySelector("[data-income-filter-total]")'), 'QA_LOADING_FAKE_ZERO'); fault = null; for (const requestId of held.splice(0)) await cdp.send('Fetch.continueRequest', { requestId }); await ready()
    fault = 'error'; await input('[data-income-end]', '2025-11'); await cdp.until('!!document.querySelector("[data-income-history-error]")'); check(await cdp.evaluate('!document.querySelector("[data-income-filter-total],[data-income-bucket]")'), 'QA_ERROR_FAKE_ZERO'); fault = null; await click('[data-income-history-retry]'); await ready(); await compare()
  })
  await step('Completed empty API month has zero columns and no invented earnings', 'REAL_PASS', async () => {
    await input('#staff-income-month', '2026-10'); await ready(); const state = await compare(); check(state.backend[0].counts.assignments === 0 && state.total === 0 && state.rows.length === 31 && state.rows.every(row => row.amount === 0), 'QA_EMPTY_MONTH_NOT_ZERO')
  })
  await step('A/B binding, F5 and logout isolate income histories', 'REAL_PASS', async () => {
    await input('#staff-income-month', config.seed.month); await ready(); const a = await compare(), aIds = a.backend[0].assignments.map(row => row.id); await logout(); await login('B'); await cdp.navigate('/thu-nhap'); await ready(); const b = await compare(); check(!b.backend[0].assignments.some(row => aIds.includes(row.id)), 'QA_AB_ASSIGNMENT_LEAK')
    const status = await cdp.evaluate('(async()=>{const r=await fetch("/api/staff/income/estimate?month=' + config.seed.month + '",{headers:{"X-Staff-Account-Id":' + JSON.stringify(config.accounts.A.userId) + '}});await r.body.cancel();return r.status})()'); check(status === 409, 'QA_AB_SESSION_BINDING_FAILED')
    await cdp.navigate('/thu-nhap'); await ready(); check((await compare()).total === b.total, 'QA_F5_TOTAL_CHANGED'); await logout(); await cdp.navigate('/thu-nhap'); await cdp.until('location.pathname==="/dang-nhap"||!document.querySelector("[data-income-insights]")'); check(await cdp.evaluate('!document.querySelector("[data-income-bucket],[data-income-selected-total]")'), 'QA_LOGOUT_HISTORY_REMAINED')
  })
}
const watchdog = setTimeout(() => { try { cdp?.ws.close() } catch {} if (browser?.exitCode === null) browser.kill() }, 300000); watchdog.unref()
try {
  config = await loadConfig(); check(config.frontendOrigin === 'http://localhost:3102', 'QA_ORIGIN_MISMATCH')
  if (before) { artifacts = join(privateDirectory, 'reports/income-chart-' + new Date().toISOString().replace(/[:.]/g, '-')); await mkdir(artifacts, { recursive: true }); await writeFile(pointer, JSON.stringify({ artifacts })) }
  else { artifacts = JSON.parse(await readFile(pointer, 'utf8')).artifacts; check(dirname(resolve(artifacts)) === resolve(privateDirectory, 'reports') && basename(artifacts).startsWith('income-chart-'), 'QA_ARTIFACT_PATH_INVALID') }
  await launch(); await login('A'); await cdp.navigate('/thu-nhap'); await ready()
  if (tableOnly) await step('Income table headers, VND, row heights, local scrolling and detail action', before ? 'CAPTURED' : 'DEMO_PASS', tableLayoutChecks)
  else {
    await step('Income chart screenshots and responsive 375/390/768/1440', before ? 'CAPTURED' : 'REAL_PASS', capture)
    if (!before) await afterChecks()
  }
  check(report.exceptions === 0 && report.forbidden === 0, 'QA_BROWSER_SECURITY_BOUNDARY_FAILED')
} catch (error) { report.failedAt = failedAt; report.error = /^[A-Z0-9_]+$/.test(error.message || '') ? error.message : 'QA_ERROR_DETAILS_WITHHELD'; process.exitCode = 1; try { await shot(report.phase + '-failure.png') } catch {} }
finally {
  clearTimeout(watchdog); fault = null
  for (const id of held.splice(0)) await cdp?.send('Fetch.failRequest', { requestId: id, errorReason: 'Aborted' }).catch(() => {})
  try { await logout() } catch {} try { await cdp?.send('Browser.close') } catch {} if (browser?.exitCode === null) browser.kill()
  if (profile && dirname(resolve(profile)) === resolve(tmpdir()) && basename(profile).startsWith('cleanhome-staff-income-chart-')) await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }).catch(() => {})
  if (artifacts) await writeFile(join(artifacts, report.phase + '-report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ phase: report.phase, pass: report.checks.length, fail: report.error ? 1 : 0, error: report.error, failedAt: report.failedAt, artifacts }))
}
