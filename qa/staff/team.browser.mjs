import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { loadConfig, mysql, privateDirectory, verifyDatabase } from './common.mjs'

// Live QA reads + explicit browser response doubles for future Order contracts.
// Never forwards a business mutation, creates a fixture, or calls an AI provider.
// The status-submit regression holds/fulfills its single PATCH inside Chrome before any network forwarding.
if (process.env.RUN_STAFF_ISOLATED_TEAM_QA !== 'true') { console.log(JSON.stringify({ status: 'NOT_RUN', reason: 'Explicit isolated QA opt-in required' })); process.exit(0) }
const wait = ms => new Promise(done => setTimeout(done, ms)), check = (value, code) => { if (!value) throw Error(code) }
const report = { checks: [], layouts: [], forbiddenWrites: 0, exceptions: 0, liveMultiEmployeeMutation: 'NOT_RUN', orderTeamEnforcement: 'BLOCKED: no Order staffing contract' }
let config, chrome, profile, cdp, artifacts, original, mock = null, held = [], detailRequests = 0, mutationMock = null, incomeMock = null
const expiredRequest = error => error.cdpKind === 'REQUEST_NO_LONGER_ACTIVE' && ['Fetch.fulfillRequest', 'Fetch.continueRequest', 'Fetch.failRequest'].includes(error.cdpMethod)
class CDP {
  constructor(socket) { this.socket = socket; this.sequence = 0; this.pending = new Map(); this.listeners = []; socket.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    if (!message.id) { for (const listener of this.listeners) listener(message.method, message.params); return }
    const item = this.pending.get(message.id); if (!item) return; clearTimeout(item.timer); this.pending.delete(message.id)
    if (message.error) {
      report.cdpError = { method: item.method, code: message.error.code, kind: /context.*destroyed|Cannot find context/i.test(message.error.message || '') ? 'NAVIGATION_CONTEXT_CHANGED' : /interception|resource/i.test(message.error.message || '') ? 'REQUEST_NO_LONGER_ACTIVE' : 'CDP_COMMAND_REJECTED' }
      const error = Error('QA_CDP_REJECTED'); error.cdpKind = report.cdpError.kind; error.cdpMethod = item.method; item.reject(error)
    } else item.done(message.result)
  }) }
  send(method, params = {}) { const id = ++this.sequence; return new Promise((done, reject) => { const timer = setTimeout(() => { this.pending.delete(id); reject(Error('QA_CDP_TIMEOUT')) }, 20000); this.pending.set(id, { done, reject, timer, method }); this.socket.send(JSON.stringify({ id, method, params })) }) }
  async evaluate(expression) { const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); check(!result.exceptionDetails, 'QA_BROWSER_EXPRESSION_FAILED'); return result.result.value }
  async until(expression, timeout = 30000) { const deadline = Date.now() + timeout; while (Date.now() < deadline) { if (await this.evaluate(expression)) return; await wait(100) } throw Error('QA_BROWSER_TIMEOUT') }
  async navigate(path) { const before = await this.evaluate('performance.timeOrigin'); await this.send('Page.navigate', { url: config.frontendOrigin + path }); await this.until('performance.timeOrigin!==' + before + '&&document.readyState==="complete"') }
}
async function fulfill(id, payload, status = 200) { await cdp.send('Fetch.fulfillRequest', { requestId: id, responseCode: status, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Cache-Control', value: 'no-store' }], body: Buffer.from(JSON.stringify(payload)).toString('base64') }) }
function statusPayload(data) {
  const next = { ASSIGNED: 'ACCEPTED', ACCEPTED: 'IN_PROGRESS', IN_PROGRESS: 'DONE' }[data.databaseStatus] || null
  return { current: { assignmentId: data.assignmentId, orderId: data.orderId, status: data.databaseStatus, jobStatus: data.jobStatus, orderStatus: data.orderStatus, checkInAt: data.checkInAt, checkOutAt: data.checkOutAt, assignedAt: data.assignedAt, cancellationPending: null }, operation: null, allowedStatus: next, canRetry: false, blockedReason: next ? null : 'NO_NEXT_STATUS' }
}
async function startChrome() {
  const executable = process.env.STAFF_QA_CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'; await access(executable)
  profile = await mkdtemp(join(tmpdir(), 'cleanhome-staff-team-qa-'))
  const env = Object.fromEntries(['PATH', 'Path', 'SystemRoot', 'ComSpec', 'TEMP', 'TMP', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'WINDIR'].filter(k => process.env[k]).map(k => [k, process.env[k]]))
  chrome = spawn(executable, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-sync', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--window-size=1440,1000', 'about:blank'], { env, windowsHide: true, stdio: 'ignore' })
  let port
  for (let i = 0; i < 150; i++) { try { port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); if (port) break } catch {} await wait(100) }
  check(port, 'QA_CHROME_START_FAILED'); const pages = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json(), socket = new WebSocket(pages.find(p => p.type === 'page').webSocketDebuggerUrl)
  await new Promise((done, reject) => { socket.addEventListener('open', done, { once: true }); socket.addEventListener('error', () => reject(Error('QA_CHROME_CONNECTION_FAILED')), { once: true }) }); cdp = new CDP(socket)
  cdp.listeners.push((method, params) => {
    if (method === 'Runtime.exceptionThrown') report.exceptions++
    if (method !== 'Fetch.requestPaused') return
    void (async () => {
      const url = new URL(params.request.url), verb = params.request.method
      if (mutationMock && mock && typeof mock === 'object' && url.origin === config.frontendOrigin && verb === 'PATCH' && url.pathname === '/api/staff/jobs/' + mock.data.assignmentId + '/status') {
        const input = JSON.parse(params.request.postData || '{}'), key = Object.entries(params.request.headers).find(([name]) => name.toLowerCase() === 'idempotency-key')?.[1]
        check(Object.keys(input).length === 1 && input.status === 'DONE' && mock.data.databaseStatus === 'IN_PROGRESS' && typeof key === 'string' && /^[A-Za-z0-9._:-]{8,128}$/.test(key), 'QA_MOCK_STATUS_INPUT_INVALID')
        mutationMock.requests.push({ id: params.requestId, key, status: input.status }); report.mockedStatusRequests = (report.mockedStatusRequests || 0) + 1
        return // Held before the network; this PATCH can never reach the actual BFF/Backend.
      }
      if (!['GET', 'HEAD', 'OPTIONS'].includes(verb) && !(url.origin === config.frontendOrigin && verb === 'POST' && ['/api/auth/login', '/api/auth/logout'].includes(url.pathname))) {
        report.forbiddenWrites++; await cdp.send('Fetch.failRequest', { requestId: params.requestId, errorReason: 'BlockedByClient' }); return
      }
      if (url.origin === config.frontendOrigin && url.pathname === '/api/staff/support/chat') {
        await cdp.send('Fetch.failRequest', { requestId: params.requestId, errorReason: 'BlockedByClient' }); return
      }
      if (incomeMock && url.origin === config.frontendOrigin && verb === 'GET' && url.pathname === '/api/staff/income/estimate' && url.searchParams.get('month') === incomeMock.period.month) {
        await fulfill(params.requestId, incomeMock); return
      }
      const detail = /^\/api\/staff\/jobs\/\d+$/.test(url.pathname)
      if (detail) detailRequests++
      if (mock && url.origin === config.frontendOrigin && (detail || /^\/api\/staff\/jobs\/\d+\/status$/.test(url.pathname))) {
        if (mock === 'hold' && detail) { held.push(params.requestId); return }
        const value = mock === 'hold' ? original : mock
        await fulfill(params.requestId, detail ? value : statusPayload(value.data)); return
      }
      await cdp.send('Fetch.continueRequest', { requestId: params.requestId })
    })().catch(error => {
      if (expiredRequest(error)) { report.cancelledMockRequests = (report.cancelledMockRequests || 0) + 1; return }
      report.harnessFailure = true; void cdp.send('Fetch.failRequest', { requestId: params.requestId, errorReason: 'BlockedByClient' }).catch(() => {})
    })
  })
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] })
}
async function input(selector, value) { await cdp.evaluate('(()=>{const e=document.querySelector(' + JSON.stringify(selector) + ');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,' + JSON.stringify(value) + ');e.dispatchEvent(new Event("input",{bubbles:true}));return true})()') }
async function api(path) { return cdp.evaluate('(async()=>{const r=await fetch(' + JSON.stringify(path) + ',{cache:"no-store"});return {status:r.status,body:await r.json()}})()') }
async function login(label) { const account = config.accounts[label]; await cdp.navigate('/dang-nhap?next=%2Fdon%2F' + account.assignmentIds[0]); await cdp.until('!!document.querySelector("input[name=phone]")'); await input('[name=phone]', account.phone); await input('[name=password]', account.password); await cdp.evaluate('document.querySelector("form").requestSubmit();true'); await page() }
async function page() { await cdp.until('!!document.querySelector("[data-staff-team]")&&!!document.querySelector("[data-assignment-detail-id]")') }
async function logout() { mock = null; await cdp.evaluate('(async()=>{const r=await fetch("/api/auth/logout",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});return r.status})()') }
async function shot(name) { const picture = await cdp.send('Page.captureScreenshot', { format: 'png' }); await writeFile(join(artifacts, name), Buffer.from(picture.data, 'base64')) }
async function step(name, status, operation) { report.currentStep = name; await operation(); report.checks.push({ name, status }); console.log(JSON.stringify({ name, status })) }
function scenario(required, counts, personal = 'ACCEPTED', booking = 'confirmed', reason = null) {
  const value = structuredClone(original), data = value.data, statuses = { ACCEPTED: ['ACCEPTED', 'accepted'], IN_PROGRESS: ['IN_PROGRESS', 'in_progress'], DONE: ['DONE', 'done'] }
  data.status = statuses[personal][0]; data.databaseStatus = personal; data.jobStatus = statuses[personal][1]; data.orderStatus = booking
  data.checkInAt = ['IN_PROGRESS', 'DONE'].includes(personal) ? '2026-11-01T02:00:00.000Z' : null; data.checkOutAt = personal === 'DONE' ? '2026-11-01T03:00:00.000Z' : null
  data.team = { version: 1, bookingId: data.orderId, assignmentId: data.assignmentId, requiredStaffCount: required, packageName: null, counts: { cancelled: 0, ...counts }, issues: { duplicateEmployees: false, inactiveMembers: false }, memberVisibility: 'SELF_ONLY', members: [{ assignmentId: data.assignmentId, displayName: null, status: personal, isSelf: true }],
    policy: required === null ? { source: 'NOT_CONFIGURED', version: null, enforced: false, canStart: null, canCompleteBooking: null, blockingReason: 'TEAM_POLICY_UNCONFIRMED' }
      : { source: 'order-service', version: 'EXPLICIT_BROWSER_MOCK_ONLY', enforced: true, canStart: personal !== 'DONE' && reason === null, canCompleteBooking: booking === 'completed', blockingReason: reason } }
  delete data.teamError; return value
}
const watchdog = setTimeout(() => { try { cdp?.socket.close() } catch {} if (chrome?.exitCode === null) chrome.kill() }, 240000); watchdog.unref()
try {
  config = await loadConfig(); check(config.frontendOrigin === 'http://localhost:3102', 'QA_ORIGIN_MISMATCH')
  artifacts = join(privateDirectory, 'reports/team-' + new Date().toISOString().replace(/[:.]/g, '-')); await mkdir(artifacts, { recursive: true })
  await step('Real Staff BFF and MySQL team summary preserve unknown requirements and own-only membership', 'REAL_PASS', async () => {
    await startChrome(); await login('A'); const id = config.accounts.A.assignmentIds[0], response = await api('/api/staff/jobs/' + id)
    check(response.status === 200 && response.body.data.team?.requiredStaffCount === null, 'QA_TEAM_READ_UNAVAILABLE'); original = response.body
    const team = original.data.team; check(team.policy.enforced === false && team.policy.canStart === null && team.members.length === 1 && team.members[0].assignmentId === id && team.memberVisibility === 'SELF_ONLY', 'QA_TEAM_POLICY_OR_PRIVACY_FAILED')
    const connection = await mysql.createConnection(config.db)
    try { await verifyDatabase(connection, config); await connection.query('START TRANSACTION READ ONLY'); const [[counts]] = await connection.execute("SELECT COUNT(DISTINCT CASE WHEN status <> 'CANCELLED' THEN employee_id END) AS assigned, COUNT(DISTINCT CASE WHEN status IN ('ACCEPTED','IN_PROGRESS','DONE') THEN employee_id END) AS accepted, COUNT(DISTINCT CASE WHEN status IN ('IN_PROGRESS','DONE') THEN employee_id END) AS started, COUNT(DISTINCT CASE WHEN status='DONE' THEN employee_id END) AS completed FROM assignments WHERE booking_id=?", [original.data.orderId]); for (const k of ['assigned', 'accepted', 'started', 'completed']) check(Number(counts[k]) === team.counts[k], 'QA_TEAM_SQL_COUNT_MISMATCH'); await connection.rollback() } finally { await connection.end() }
    check((await api('/api/staff/jobs/' + config.accounts.B.assignmentIds[0])).status === 404, 'QA_A_READ_B_ASSIGNMENT')
  })
  await step('Real team card fits 375/390/768/1440 and supports keyboard member disclosure', 'REAL_PASS', async () => {
    for (const [width, height] of [[375, 812], [390, 844], [768, 1024], [1440, 1000]]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 768 }); await cdp.evaluate('document.querySelector("[data-staff-team]").scrollIntoView({block:"start"});window.scrollBy(0,-96);true'); await wait(150)
      const layout = await cdp.evaluate('(()=>{const t=document.querySelector("[data-staff-team]"),r=t.getBoundingClientRect();return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth,left:r.left,right:r.right,clientWidth:document.documentElement.clientWidth,unknown:t.textContent.includes("Chưa có thông tin số nhân viên yêu cầu")}})()')
      check(layout.scrollWidth <= width && layout.left >= 0 && layout.right <= layout.clientWidth + 1 && layout.unknown, 'QA_TEAM_RESPONSIVE_FAILURE'); report.layouts.push(layout); await shot('team-real-' + width + '.png')
    }
    await cdp.evaluate('document.querySelector(".staff-team-members summary").focus();true'); await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' }); await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }); await cdp.until('document.querySelector(".staff-team-members").open', 2000)
    const accessibility = await cdp.send('Accessibility.getFullAXTree')
    check(accessibility.nodes.some(n => n.role?.value === 'heading' && n.name?.value === 'Đội thực hiện'), 'QA_TEAM_ACCESSIBLE_HEADING_MISSING')
    check(accessibility.nodes.some(n => n.role?.value === 'progressbar' && n.name?.value?.includes('Tiến độ nhân viên đã phân công')), 'QA_TEAM_ACCESSIBLE_PROGRESS_MISSING')
  })
  await step('Future 1/2/3-worker policies, waiting A/B, DONE, understaffing, cancellation and duplicates are explicit UI doubles', 'MOCK_PASS', async () => {
    const cases = [
      [scenario(1, { assigned: 1, accepted: 1, started: 0, completed: 0 }), 'ready'],
      [scenario(2, { assigned: 2, accepted: 1, started: 0, completed: 0 }, 'ACCEPTED', 'confirmed', 'WAITING_ACCEPTANCE'), 'waiting-acceptance'],
      [scenario(2, { assigned: 2, accepted: 2, started: 0, completed: 0 }), 'ready'],
      [scenario(3, { assigned: 3, accepted: 3, started: 0, completed: 0 }), 'ready'],
      [scenario(2, { assigned: 2, accepted: 2, started: 2, completed: 1 }, 'DONE', 'in_progress'), 'my-work-done'],
      [scenario(2, { assigned: 2, accepted: 2, started: 2, completed: 2 }, 'DONE', 'completed'), 'completed'],
      [scenario(2, { assigned: 1, accepted: 1, started: 0, completed: 0 }, 'ACCEPTED', 'confirmed', 'INSUFFICIENT_STAFF'), 'understaffed'],
      [scenario(2, { assigned: 1, accepted: 1, started: 0, completed: 0, cancelled: 1 }, 'ACCEPTED', 'confirmed', 'REPLACEMENT_REQUIRED'), 'admin-required'],
      [scenario(2, { assigned: 1, accepted: 1, started: 0, completed: 0 }, 'ACCEPTED', 'confirmed', 'DUPLICATE_ASSIGNMENTS'), 'admin-required'],
      [scenario(null, { assigned: 1, accepted: 1, started: 0, completed: 0 }), 'unconfirmed'],
      [scenario(null, { assigned: 2, accepted: 2, started: 2, completed: 0 }, 'IN_PROGRESS', 'in_progress'), 'in-progress'],
      [scenario(null, { assigned: 2, accepted: 2, started: 2, completed: 2 }, 'DONE', 'in_progress'), 'awaiting-booking'],
      [scenario(null, { assigned: 2, accepted: 2, started: 2, completed: 1 }, 'DONE', 'cancelled'), 'cancelled'],
    ]
    cases[8][0].data.team.issues.duplicateEmployees = true
    for (const [value, state] of cases) { mock = value; await cdp.navigate('/don/' + original.data.assignmentId); await page(); await cdp.until('!!document.querySelector("[data-staff-status-panel]")&&!document.querySelector("[data-staff-status-panel] [aria-busy=true]")'); check(await cdp.evaluate('document.querySelector("[data-staff-team]").dataset.teamState===' + JSON.stringify(state)), 'QA_TEAM_MOCK_STATE_FAILED')
      if (value.data.databaseStatus === 'ACCEPTED' && value.data.team.policy.enforced && !value.data.team.policy.canStart) check(await cdp.evaluate('!!document.querySelector("[data-team-start-blocked]")'), 'QA_TEAM_START_NOT_BLOCKED')
    }
  })
  await step('Mocked personal completion has loading, blocks duplicate submit and reloads detail without completing the booking', 'MOCK_PASS', async () => {
    mock = scenario(null, { assigned: 2, accepted: 2, started: 2, completed: 0 }, 'IN_PROGRESS', 'in_progress')
    mutationMock = { requests: [] }; await cdp.navigate('/don/' + original.data.assignmentId); await page()
    await cdp.until('[...document.querySelectorAll("[data-staff-status-panel] button")].some(b=>b.textContent.includes("Hoàn thành phần việc")&&!b.disabled)')
    await cdp.evaluate('[...document.querySelectorAll("[data-staff-status-panel] button")].find(b=>b.textContent.includes("Hoàn thành phần việc")).click();true')
    await cdp.until('!!document.querySelector("dialog[open] form")'); const before = detailRequests
    await cdp.evaluate('document.querySelector("dialog[open] form").requestSubmit();true')
    for (let i = 0; i < 100 && !mutationMock.requests.length; i++) await wait(50)
    check(mutationMock.requests.length === 1, 'QA_MOCK_COMPLETION_NOT_CAPTURED')
    check(await cdp.evaluate('document.querySelector("dialog[open] button[type=submit]").disabled'), 'QA_STATUS_LOADING_NOT_LOCKED')
    await cdp.evaluate('document.querySelector("dialog[open] form").requestSubmit();true'); await wait(150)
    check(mutationMock.requests.length === 1, 'QA_DUPLICATE_STATUS_POSTED')
    const request = mutationMock.requests[0], at = new Date().toISOString(), data = mock.data
    const operationId = createHash('sha256').update(JSON.stringify([config.accounts.A.userId, data.assignmentId, request.key])).digest('hex')
    const transition = { operationId, requestedStatus: 'DONE', synchronization: 'SYNCHRONIZED', replayed: false }
    mock = scenario(null, { assigned: 2, accepted: 2, started: 2, completed: 1 }, 'DONE', 'in_progress')
    await fulfill(request.id, { data: { assignmentId: data.assignmentId, status: 'DONE', jobStatus: 'done', checkInAt: data.checkInAt, checkOutAt: at, transition, orderAtTransition: { id: data.orderId, status: 'IN_PROGRESS', asOf: at } }, operation: { idempotencyKey: request.key, requestedStatus: 'DONE', phase: 'confirmed', createdAt: at, observedTarget: false, transition } })
    mutationMock = null; await cdp.until('document.querySelector("[data-staff-team]")?.dataset.teamState==="my-work-done"')
    check(detailRequests > before, 'QA_STATUS_DID_NOT_RELOAD_DETAIL')
    check(await cdp.evaluate('document.querySelector("[data-staff-team]").textContent.includes("Đơn dịch vụ vẫn đang chờ các thành viên còn lại")&&!document.querySelector("[data-staff-team]").textContent.includes("Đơn đã được xác nhận hoàn thành")'), 'QA_PERSONAL_DONE_COMPLETED_BOOKING')
  })
  await step('Team read loading, error and retry preserve detail without fake zero counts', 'MOCK_PASS', async () => {
    mock = 'hold'; await cdp.navigate('/don/' + original.data.assignmentId); await cdp.until('!document.querySelector("[data-staff-team]")'); for (let i = 0; i < 100 && !held.length; i++) await wait(50); check(held.length > 0, 'QA_TEAM_LOADING_MISSING')
    mock = structuredClone(original); mock.data.team = null; mock.data.teamError = 'TEAM_READ_UNAVAILABLE'
    await cdp.until('!!document.querySelector(".staff-detail")'); await wait(150); for (const id of held.splice(0)) await fulfill(id, mock).catch(error => { if (!expiredRequest(error)) throw error; report.cancelledMockRequests = (report.cancelledMockRequests || 0) + 1 }); await page()
    check(await cdp.evaluate('!!document.querySelector("[data-staff-team] [role=alert]")&&!document.querySelector("[data-staff-team] progress")'), 'QA_TEAM_ERROR_FABRICATED_COUNTS')
    const detailId = original.data.assignmentId
    check(await cdp.evaluate('document.querySelector("[data-assignment-detail-id]")?.dataset.assignmentDetailId===' + JSON.stringify(detailId) + '&&!!document.querySelector(".staff-detail-services-section")'), 'QA_TEAM_ERROR_REMOVED_DETAIL')
    // Full document navigation models F5 while the optional team is unavailable.
    await cdp.navigate('/don/' + detailId); await page()
    check(await cdp.evaluate('!!document.querySelector("[data-staff-team] [role=alert]")&&document.querySelector("[data-assignment-detail-id]")?.dataset.assignmentDetailId===' + JSON.stringify(detailId)), 'QA_TEAM_ERROR_RELOAD_LOST_DETAIL')
    mock = original; const before = detailRequests; await cdp.evaluate('document.querySelector("[data-staff-team] button").click();true'); await cdp.until('(()=>{const t=document.querySelector("[data-staff-team]");return !!t&&t.dataset.teamState!=="error"})()'); check(detailRequests > before, 'QA_TEAM_RETRY_DID_NOT_READ')
    await cdp.navigate('/don/' + detailId); await page()
    check(await cdp.evaluate('!document.querySelector("[data-staff-team] [role=alert]")&&document.querySelector("[data-assignment-detail-id]")?.dataset.assignmentDetailId===' + JSON.stringify(detailId)), 'QA_TEAM_RECOVERY_RELOAD_FAILED')
  })
  await step('Real B login, F5 and cross-owner denial do not reuse A team data', 'REAL_PASS', async () => {
    await logout(); await login('B'); const id = config.accounts.B.assignmentIds[0], result = await api('/api/staff/jobs/' + id)
    check(result.status === 200 && result.body.data.team?.members[0].assignmentId === id, 'QA_B_TEAM_MISMATCH'); check((await api('/api/staff/jobs/' + config.accounts.A.assignmentIds[0])).status === 404, 'QA_B_READ_A_ASSIGNMENT')
    await cdp.navigate('/don/' + id); await page(); check(await cdp.evaluate('document.querySelector("[data-assignment-detail-id]").dataset.assignmentDetailId===' + JSON.stringify(id)), 'QA_TEAM_F5_SCOPE_MISMATCH')
  })
  await step('Real Dashboard, jobs, calendar, achievements and support keep their shell and chat launcher', 'REAL_PASS', async () => {
    for (const [path, selector] of [['/', '[data-dashboard-value]'], ['/cong-viec', '.staff-jobs-results-heading'], ['/lich-lam-viec', '[data-schedule-total]'], ['/thanh-tich', '[data-staff-real-statistics]'], ['/ho-tro', '[data-staff-support]']]) {
      await cdp.navigate(path); await cdp.until('!!document.querySelector(' + JSON.stringify(selector) + ')')
      check(await cdp.evaluate('!!document.querySelector("[data-staff-chat-launcher]")&&[...document.querySelectorAll("a")].some(a=>a.getAttribute("href")==="/cai-dat")'), 'QA_STAFF_SHELL_REGRESSION')
    }
  })
  await step('Repeated-booking income warning preserves the real demo response amount in browser-only doubles', 'MOCK_PASS', async () => {
    const result = await api('/api/staff/income/estimate?month=' + config.seed.month); check(result.status === 200 && result.body.policy?.version === 'DEMO_V2', 'QA_INCOME_DEMO_READ_FAILED')
    incomeMock = structuredClone(result.body); const rows = incomeMock.assignments.filter(row => row.eligible)
    check(rows.length >= 2, 'QA_INCOME_TWO_DONE_FIXTURES_REQUIRED'); rows[1].bookingId = rows[0].bookingId
    report.incomeSource = 'DEMO_PASS: read-only real QA endpoint, no payout'; const expectedTotal = incomeMock.estimateTotalVnd
    await cdp.navigate('/thu-nhap'); await cdp.until('!!document.querySelector("#staff-income-month")')
    if (await cdp.evaluate('document.querySelector("#staff-income-month").value') !== config.seed.month) await input('#staff-income-month', config.seed.month)
    await cdp.until('!!document.querySelector("[data-income-repeated-bookings]")')
    check(await cdp.evaluate('Number(document.querySelector("[data-staff-income-total]").dataset.staffIncomeTotal)===' + expectedTotal), 'QA_DUPLICATE_WARNING_CHANGED_MONEY')
    for (const [width, height] of [[375, 812], [390, 844], [768, 1024], [1440, 1000]]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 768 }); await cdp.evaluate('document.querySelector("[data-income-repeated-bookings]").scrollIntoView({block:"center"});true'); await wait(120)
      check(await cdp.evaluate('document.documentElement.scrollWidth<=innerWidth'), 'QA_INCOME_REPEAT_WARNING_OVERFLOW')
      await shot('income-repeat-mock-' + width + '.png')
    }
    incomeMock = null
  })
  check(!report.harnessFailure && report.exceptions === 0 && report.forbiddenWrites === 0, 'QA_TEAM_BOUNDARY_OR_RUNTIME_FAILURE')
} catch (error) { report.error = /^[A-Z0-9_]+$/.test(error.message || '') ? error.message : 'QA_DETAILS_WITHHELD'; process.exitCode = 1; try { await shot('failure.png') } catch {} }
finally {
  clearTimeout(watchdog); mock = null; incomeMock = null; for (const request of mutationMock?.requests || []) await cdp?.send('Fetch.failRequest', { requestId: request.id, errorReason: 'Aborted' }).catch(() => {}); mutationMock = null; for (const id of held) await cdp?.send('Fetch.failRequest', { requestId: id, errorReason: 'Aborted' }).catch(() => {})
  try { await logout() } catch {} try { await cdp?.send('Browser.close') } catch {} if (chrome?.exitCode === null) chrome.kill()
  if (profile && dirname(resolve(profile)) === resolve(tmpdir()) && basename(profile).startsWith('cleanhome-staff-team-qa-')) await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }).catch(() => {})
  if (artifacts) await writeFile(join(artifacts, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ pass: report.checks.length, fail: report.error ? 1 : 0, error: report.error, report: artifacts && join(artifacts, 'report.json'), databaseMutations: 0 }))
}
