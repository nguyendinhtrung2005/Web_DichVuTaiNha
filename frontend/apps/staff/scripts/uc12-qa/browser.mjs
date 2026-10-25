import { spawn } from 'node:child_process'
import { readFile, writeFile, mkdir, mkdtemp, rm, access } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { resolve, join, dirname, basename } from 'node:path'

// Explicitly approved QA only. This helper uses the real UI/BFF, never fulfills
// requests with synthetic success and never contacts a Backend API from JS.
const targets = ['ACCEPTED', 'IN_PROGRESS', 'DONE']
const actionLabels = { ACCEPTED: 'Tiếp nhận công việc', IN_PROGRESS: 'Bắt đầu thực hiện', DONE: 'Hoàn thành công việc' }
const sleep = ms => new Promise(done => setTimeout(done, ms))
const assert = (value, message) => { if (!value) throw new Error(message) }
const id = value => typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n
const key = value => typeof value === 'string' && /^[A-Za-z0-9._:-]{8,128}$/.test(value)
const panelSelector = '[data-staff-status-panel]'
const panelExpression = 'document.querySelector(' + JSON.stringify(panelSelector) + ')'
const panelButton = text => '[...(' + panelExpression + '?.querySelectorAll("button") || [])].find(e=>e.innerText.includes(' + JSON.stringify(text) + '))'
function safeReply(value) {
  if (!value || typeof value !== 'object') return null
  const result = {}
  if (value.error && typeof value.error === 'object') result.error = Object.fromEntries(['code', 'message', 'outcome'].filter(field => typeof value.error[field] === 'string').map(field => [field, value.error[field]]))
  if (value.operation && typeof value.operation === 'object') result.operation = Object.fromEntries(['idempotencyKey', 'requestedStatus', 'phase', 'createdAt', 'observedTarget', 'transition'].filter(field => Object.hasOwn(value.operation, field)).map(field => [field, value.operation[field]]))
  if (value.data && !Array.isArray(value.data) && typeof value.data === 'object') result.data = Object.fromEntries(['assignmentId', 'status', 'jobStatus', 'checkInAt', 'checkOutAt', 'transition', 'orderAtTransition'].filter(field => Object.hasOwn(value.data, field)).map(field => [field, value.data[field]]))
  return result
}

class Cdp {
  constructor(socket) {
    this.socket = socket; this.sequence = 0; this.pending = new Map(); this.listeners = []; this.loaded = new Set()
    socket.addEventListener('message', event => {
      let value
      try { value = JSON.parse(event.data) } catch { return }
      if (value.id) {
        const entry = this.pending.get(value.id)
        if (!entry) return
        clearTimeout(entry.timer); this.pending.delete(value.id)
        value.error ? entry.reject(new Error('QA CDP command rejected')) : entry.resolve(value.result)
      } else {
        if (value.method === 'Page.lifecycleEvent' && value.params.name === 'load') this.loaded.add(value.params.loaderId)
        for (const listener of this.listeners) listener(value.method, value.params)
      }
    })
    socket.addEventListener('close', () => {
      for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('Owned QA browser closed')) }
      this.pending.clear()
    })
  }
  send(method, params = {}) {
    assert(this.socket.readyState === WebSocket.OPEN, 'Owned QA browser connection is unavailable')
    const id = ++this.sequence
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('QA CDP command timed out')) }, 15000)
      this.pending.set(id, { resolve, reject, timer }); this.socket.send(JSON.stringify({ id, method, params }))
    })
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw new Error('QA browser expression failed; expression and credential values withheld')
    return result.result.value
  }
  async until(expression, timeoutMs = 30000) {
    const until = Date.now() + timeoutMs
    while (Date.now() < until) {
      try { if (await this.evaluate(expression)) return }
      catch (error) { if (!['QA browser expression failed; expression and credential values withheld', 'QA CDP command rejected'].includes(error.message)) throw error }
      await sleep(100)
    }
    throw new Error('QA browser condition timed out; expression and credentials withheld')
  }
  async navigate(origin, path) {
    assert(typeof path === 'string' && path.startsWith('/') && !path.startsWith('//'), 'QA navigation path must remain same-origin')
    const result = await this.send('Page.navigate', { url: origin + path })
    assert(!result.errorText, 'QA page navigation failed; target details withheld')
    if (result.loaderId) {
      const deadline = Date.now() + 30000
      while (Date.now() < deadline && !this.loaded.has(result.loaderId)) await sleep(50)
      assert(this.loaded.has(result.loaderId), 'QA page load timed out')
    }
    await this.until('location.origin === ' + JSON.stringify(origin) + ' && location.pathname === ' + JSON.stringify(new URL(origin + path).pathname) + ' && document.readyState === "complete"')
  }
}

export function createQaBrowser({ origin, accounts, artifactDir, manifest, allowedAssignmentIds = manifest?.allowlist?.assignmentIds,
  chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' }) {
  const url = new URL(origin)
  assert(['http:', 'https:'].includes(url.protocol) && ['localhost', '127.0.0.1'].includes(url.hostname)
    && url.origin === origin && !url.username && !url.password, 'UC12 QA requires an exact loopback Frontend origin')
  assert(Array.isArray(allowedAssignmentIds) && allowedAssignmentIds.length === 12 && allowedAssignmentIds.every(id)
    && new Set(allowedAssignmentIds).size === allowedAssignmentIds.length, 'UC12 QA requires the approved twelve-assignment manifest allowlist')
  const allowlist = new Set(allowedAssignmentIds), sessions = new Map()
  const people = Array.isArray(accounts) ? Object.fromEntries(accounts.map(account => [account.label, account])) : accounts
  assert(people && people.A && people.B && people.A.phone !== people.B.phone, 'Real distinct employee A/B credentials are required')
  const folder = resolve(artifactDir), report = { origin, realBrowser: true, employees: {}, screenshots: [], securityViolations: [], responseLossEvents: [] }
  function noSecrets(value) {
    const text = typeof value === 'string' ? value : JSON.stringify(value)
    assert(!/"(?:accessToken|refreshToken|password|passwordHash|password_hash|authorization|tokenType)"\s*:/i.test(text)
      && !/[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/.test(text), 'A browser-facing response contained a credential-shaped value; contents withheld')
    for (const account of Object.values(people)) if (account?.password) assert(!text.includes(account.password), 'A browser-facing response exposed a submitted credential; contents withheld')
  }

  async function openEmployee(label) {
    assert(['A', 'B', 'CUSTOMER', 'ANONYMOUS'].includes(label), 'Unknown QA browser identity')
    if (sessions.has(label)) return sessions.get(label).api
    const account = people[label]
    if (label !== 'ANONYMOUS') assert(account && typeof account.phone === 'string' && account.phone && typeof account.password === 'string' && account.password, 'Real QA credentials are unavailable; values withheld')
    await access(chromePath)
    await mkdir(folder, { recursive: true })
    const profile = await mkdtemp(join(tmpdir(), 'cleanhome-uc12-approved-' + label.toLowerCase() + '-'))
    let chrome, cdp, closed = false, droppedAssignment = null, lastLogin = null, currentAssignment = null
    const requests = [], responseTasks = new Set(), state = { label, exceptions: 0, profileClosed: false, reads: 0, writes: 0, interceptedReadCancellations: 0 }
    report.employees[label] = state
    const networkRequests = new Map()
    function health() { assert(report.securityViolations.length === 0, 'QA browser security boundary failed; stop further writes') }
    const guardAssignment = assignmentId => { assert(id(assignmentId) && allowlist.has(assignmentId), 'Mutation refused outside the approved assignment allowlist'); health() }
    async function intercept(params) {
      const request = params.request, target = new URL(request.url), isResponse = params.responseStatusCode !== undefined
      if (target.origin !== origin || target.pathname.startsWith('/internal/')) {
        report.securityViolations.push({ kind: 'DIRECT_BACKEND_OR_INTERNAL', path: target.pathname })
        return cdp.send('Fetch.failRequest', { requestId: params.requestId, errorReason: 'BlockedByClient' })
      }
      const statusMatch = /^\/api\/staff\/jobs\/([1-9]\d*)\/status$/.exec(target.pathname)
      if (!isResponse && request.method === 'PATCH') {
        let body
        try { body = JSON.parse(request.postData || '') } catch {}
        const suppliedKey = Object.entries(request.headers || {}).find(([name]) => name.toLowerCase() === 'idempotency-key')?.[1]
        if (!statusMatch || !allowlist.has(statusMatch[1]) || target.search || !body || Object.keys(body).length !== 1 || !targets.includes(body.status) || !key(suppliedKey)) {
          report.securityViolations.push({ kind: 'MUTATION_OUTSIDE_MANIFEST_OR_CONTRACT', path: target.pathname })
          return cdp.send('Fetch.failRequest', { requestId: params.requestId, errorReason: 'BlockedByClient' })
        }
      } else if (!isResponse && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)
        && !((target.pathname === '/api/auth/login' || target.pathname === '/api/auth/logout') && request.method === 'POST')) {
        report.securityViolations.push({ kind: 'UNSUPPORTED_MUTATION', path: target.pathname })
        return cdp.send('Fetch.failRequest', { requestId: params.requestId, errorReason: 'BlockedByClient' })
      }
      if (isResponse && request.method === 'PATCH' && statusMatch && statusMatch[1] === droppedAssignment && [200, 202].includes(params.responseStatusCode)) {
        const assignmentId = droppedAssignment; droppedAssignment = null
        report.responseLossEvents.push({ label, assignmentId, upstreamStatus: params.responseStatusCode, point: 'BFF_RESPONSE_AFTER_REAL_COMMIT' })
        return cdp.send('Fetch.failRequest', { requestId: params.requestId, errorReason: 'ConnectionClosed' })
      }
      return cdp.send('Fetch.continueRequest', { requestId: params.requestId })
    }
    async function close() {
      if (closed) return
      closed = true
      try { if (cdp) await cdp.send('Browser.close') } catch {}
      if (chrome && chrome.exitCode === null) chrome.kill()
      await sleep(150)
      const absolute = resolve(profile)
      if (dirname(absolute) === resolve(tmpdir()) && basename(absolute).startsWith('cleanhome-uc12-approved-' + label.toLowerCase() + '-')) {
        try { await rm(absolute, { recursive: true, force: true, maxRetries: 4, retryDelay: 200 }); state.profileClosed = true } catch { state.profileClosed = false }
      }
    }
    try {
      chrome = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-sync', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--window-size=1440,1000', 'about:blank'], { windowsHide: true, stdio: 'ignore' })
      let port
      for (let attempt = 0; attempt < 180; attempt++) {
        try { port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); if (port) break } catch {}
        if (chrome.exitCode !== null) break
        await sleep(100)
      }
      assert(port, 'Owned QA Chrome startup timed out')
      const pages = await (await fetch('http://127.0.0.1:' + port + '/json/list', { signal: AbortSignal.timeout(5000) })).json()
      const page = pages.find(value => value.type === 'page')
      assert(page?.webSocketDebuggerUrl, 'Owned QA Chrome page is unavailable')
      const socket = new WebSocket(page.webSocketDebuggerUrl)
      await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', () => reject(new Error('Owned QA Chrome connection failed')), { once: true }) })
      cdp = new Cdp(socket)
      cdp.listeners.push((method, params) => {
        if (method === 'Runtime.exceptionThrown') state.exceptions++
        if (method === 'Fetch.requestPaused') void intercept(params).catch(async error => {
          if (params.request.method === 'GET' && error.message === 'QA CDP command rejected') state.interceptedReadCancellations++
          else report.securityViolations.push({ kind: 'INTERCEPTION_FAILURE', method: params.request.method })
          try { await cdp.send('Fetch.failRequest', { requestId: params.requestId, errorReason: 'BlockedByClient' }) } catch {}
        })
        if (method === 'Network.requestWillBeSent') {
          const target = new URL(params.request.url)
          if (target.origin !== origin || !target.pathname.startsWith('/api/')) return
          const item = { path: target.pathname, method: params.request.method, status: null, finished: false }
          const match = /^\/api\/staff\/jobs\/([1-9]\d*)\/status$/.exec(target.pathname)
          if (match && params.request.method === 'PATCH') {
            let value
            try { value = JSON.parse(params.request.postData || '') } catch {}
            item.assignmentId = match[1]; item.target = value?.status
            item.key = Object.entries(params.request.headers || {}).find(([name]) => name.toLowerCase() === 'idempotency-key')?.[1]
            requests.push(item); state.writes++
          } else if (params.request.method === 'GET') state.reads++
          networkRequests.set(params.requestId, item)
        }
        if (method === 'Network.responseReceived') {
          const item = networkRequests.get(params.requestId)
          if (!item) return
          item.status = params.response.status
          if (item.path === '/api/auth/login') lastLogin = { status: item.status }
        }
        if (method === 'Network.loadingFailed') {
          const item = networkRequests.get(params.requestId)
          if (item) { item.finished = true; item.networkFailure = true }
        }
        if (method === 'Network.loadingFinished') {
          const item = networkRequests.get(params.requestId)
          if (!item) return
          const task = cdp.send('Network.getResponseBody', { requestId: params.requestId }).then(value => {
            const text = value.base64Encoded ? Buffer.from(value.body, 'base64').toString('utf8') : value.body
            assert(text.length <= 2097152, 'QA response body exceeded the evidence bound'); noSecrets(text)
            if (item.method === 'PATCH') { try { item.body = safeReply(JSON.parse(text)) } catch {} }
          }).catch(error => { if (error.message !== 'QA CDP command rejected') report.securityViolations.push({ kind: 'RESPONSE_BOUNDARY_FAILURE' }) })
            .finally(() => { item.finished = true; responseTasks.delete(task) })
          responseTasks.add(task)
        }
      })
      await cdp.send('Page.enable'); await cdp.send('Page.setLifecycleEventsEnabled', { enabled: true }); await cdp.send('Runtime.enable'); await cdp.send('Network.enable')
      await cdp.send('Fetch.enable', { patterns: [
        { urlPattern: origin + '/api/*', requestStage: 'Request' },
        { urlPattern: origin + '/api/staff/jobs/*/status*', requestStage: 'Response' },
        { urlPattern: '*://*/internal/*', requestStage: 'Request' },
      ] })

      async function browserJson(path, options = {}) {
        health()
        assert(typeof path === 'string' && (path.startsWith('/api/staff/') || path === '/api/auth/session' || path === '/api/auth/logout'), 'Only fixed same-origin QA BFF APIs are allowed')
        if (await cdp.evaluate('location.origin') !== origin) await cdp.navigate(origin, '/dang-nhap')
        const slot = '__cleanhomeUc12Qa_' + randomUUID().replaceAll('-', '')
        const expression = '(async()=>{try{const r=await fetch(' + JSON.stringify(path) + ',{credentials:"same-origin",cache:"no-store",redirect:"error",signal:AbortSignal.timeout(60000),' +
          'method:' + JSON.stringify(options.method || 'GET') + ',headers:' + JSON.stringify({ Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.key ? { 'Idempotency-Key': options.key } : {}) }) +
          (options.body ? ',body:' + JSON.stringify(JSON.stringify(options.body)) : '') + '});const t=await r.text();return {status:r.status,text:t}}catch{return {status:0,text:""}}})()'
        // Poll a private QA-page promise slot so each CDP command remains bounded
        // at 15 seconds, even when a real BFF timeout legitimately takes longer.
        await cdp.evaluate('(()=>{globalThis[' + JSON.stringify(slot) + ']={done:false};void ' + expression + '.then(result=>{globalThis[' + JSON.stringify(slot) + ']={done:true,result}});return true})()')
        await cdp.until('globalThis[' + JSON.stringify(slot) + ']?.done===true', 65000)
        const result = await cdp.evaluate('(()=>{const value=globalThis[' + JSON.stringify(slot) + '].result;delete globalThis[' + JSON.stringify(slot) + '];return value})()')
        noSecrets(result.text)
        let body
        try { body = result.text ? JSON.parse(result.text) : null } catch { throw new Error('Real QA BFF response is not JSON; contents withheld') }
        health(); return { status: result.status, body }
      }
      async function waitIdle(timeoutMs = 80000) {
        await cdp.until('!!' + panelExpression + ' && ' + panelExpression + '.querySelector("[aria-busy]")?.getAttribute("aria-busy")==="false" && !document.querySelector("dialog[open]")', timeoutMs)
        await Promise.allSettled([...responseTasks]); health()
      }
      async function panel() {
        return cdp.evaluate('(()=>{const e=' + panelExpression + ';if(!e)return null;return {phase:e.querySelector("[data-operation-phase]")?.getAttribute("data-operation-phase")??null,busy:e.querySelector("[aria-busy]")?.getAttribute("aria-busy")==="true",text:e.innerText,buttons:[...e.querySelectorAll("button")].map(b=>({text:b.innerText,disabled:b.disabled})),dialogOpen:!!document.querySelector("dialog[open]")}})()')
      }
      const api = Object.freeze({
        async login({ expectedStatus = 200, returnPath = '/cong-viec' } = {}) {
          assert(label !== 'ANONYMOUS', 'Anonymous QA context cannot log in')
          lastLogin = null
          await cdp.navigate(origin, '/dang-nhap?next=' + encodeURIComponent(returnPath))
          await cdp.until('!!document.querySelector("input[name=phone]")')
          for (const [name, value] of [['phone', account.phone], ['password', account.password]]) {
            await cdp.evaluate('(()=>{const e=document.querySelector(' + JSON.stringify('input[name=' + name + ']') + ');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,' + JSON.stringify(value) + ');e.dispatchEvent(new Event("input",{bubbles:true}));e.dispatchEvent(new Event("change",{bubbles:true}))})()')
          }
          await cdp.evaluate('document.querySelector("form").requestSubmit()')
          if (expectedStatus === 200) await cdp.until('location.pathname===' + JSON.stringify(returnPath.split('?')[0]) + ' && !document.querySelector("input[name=phone]")')
          else await cdp.until('!!document.querySelector("input[name=phone]") && !!document.querySelector("[role=alert]")')
          const end = Date.now() + 15000
          while (Date.now() < end && !lastLogin) await sleep(50)
          assert(lastLogin?.status === expectedStatus, 'Real QA employee login returned an unexpected HTTP status; credentials withheld')
          health(); return { status: lastLogin.status }
        },
        async openJob(assignmentId) {
          assert(id(assignmentId), 'Canonical assignment ID required'); currentAssignment = assignmentId
          await cdp.navigate(origin, '/don/' + assignmentId)
          await cdp.until('(document.querySelector("[data-assignment-detail-id]")?.getAttribute("data-assignment-detail-id")===' + JSON.stringify(assignmentId) + ' && !!' + panelExpression + ') || (!!document.querySelector("[role=alert]") && !document.querySelector("[data-assignment-detail-id]"))')
          if (await cdp.evaluate('!!' + panelExpression)) await waitIdle()
          return panel()
        },
        async action(target, { retry = false, doubleSubmit = false, timeoutMs = 80000 } = {}) {
          guardAssignment(currentAssignment); assert(targets.includes(target), 'Unsupported UC12 target')
          await waitIdle()
          const prior = requests.length, text = retry ? 'Thử lại cùng thao tác' : actionLabels[target]
          await cdp.until('!!' + panelButton(text) + ' && !' + panelButton(text) + '.disabled')
          await cdp.evaluate(panelButton(text) + '.click()')
          await cdp.until('!!document.querySelector("dialog[open] form")')
          await cdp.evaluate('document.querySelector("dialog[open] form").requestSubmit()' + (doubleSubmit ? ';document.querySelector("dialog[open] form")?.requestSubmit()' : ''))
          const until = Date.now() + timeoutMs
          while (Date.now() < until && !requests.slice(prior).some(item => item.assignmentId === currentAssignment && item.finished)) { health(); await sleep(100) }
          const changes = requests.slice(prior).filter(item => item.assignmentId === currentAssignment)
          assert(changes.length > 0 && changes.every(item => item.finished), 'Real UI mutation did not finish within the QA deadline')
          assert(changes.every(item => item.target === target), 'UI mutation target differed from the explicit approved step')
          await waitIdle(timeoutMs)
          const result = changes.at(-1)
          return { status: result.status || 0, httpStatus: result.status || 0, bodySafe: result.body || null, key: result.key,
            requestsSent: changes.length, networkFailure: result.networkFailure === true, statusPanel: await panel() }
        },
        panel,
        async getStatus(assignmentId = currentAssignment) { assert(id(assignmentId), 'Canonical assignment ID required'); return browserJson('/api/staff/jobs/' + assignmentId + '/status') },
        async rawPatch(assignmentId, target, idempotencyKey) {
          guardAssignment(assignmentId); assert(targets.includes(target) && key(idempotencyKey), 'Contract target and idempotency key required')
          const result = await browserJson('/api/staff/jobs/' + assignmentId + '/status', { method: 'PATCH', body: { status: target }, key: idempotencyKey })
          noSecrets(result); return { status: result.status, httpStatus: result.status, body: safeReply(result.body), bodySafe: safeReply(result.body), key: idempotencyKey }
        },
        async reload() {
          const tree = await cdp.send('Page.getFrameTree'), previousLoader = tree.frameTree.frame.loaderId
          await cdp.send('Page.reload', { ignoreCache: true })
          const deadline = Date.now() + 30000
          let loaded = false
          while (Date.now() < deadline) {
            const next = await cdp.send('Page.getFrameTree')
            if (next.frameTree.frame.loaderId !== previousLoader && cdp.loaded.has(next.frameTree.frame.loaderId)) { loaded = true; break }
            await sleep(50)
          }
          assert(loaded, 'QA browser reload timed out')
          await cdp.until('document.readyState==="complete"')
          if (currentAssignment) await waitIdle()
          return panel()
        },
        async logout() {
          // The visible menu drives logout; no opaque cookie is read or passed to JS.
          await cdp.evaluate('document.querySelector("button[aria-label^=\\"Tài khoản\\"]").click()')
          await cdp.until('[...document.querySelectorAll("[role=menuitem]")].some(e=>e.innerText.includes("Đăng xuất"))')
          await cdp.evaluate('[...document.querySelectorAll("[role=menuitem]")].find(e=>e.innerText.includes("Đăng xuất")).click()')
          await cdp.until('location.pathname==="/dang-nhap" && !!document.querySelector("input[name=phone]")'); health()
          return { status: (await browserJson('/api/auth/session')).status }
        },
        async readJobs(query = {}) { return browserJson('/api/staff/jobs?' + new URLSearchParams({ page: '1', pageSize: '100', sort: 'asc', ...query })) },
        async readDetail(assignmentId = currentAssignment) { assert(id(assignmentId), 'Canonical assignment ID required'); return browserJson('/api/staff/jobs/' + assignmentId) },
        async readSchedule(query) { assert(query && typeof query === 'object', 'Explicit bounded schedule dates are required'); return browserJson('/api/staff/schedule?' + new URLSearchParams({ page: '1', pageSize: '100', sort: 'asc', ...query })) },
        async navigate(path) { await cdp.navigate(origin, path); health() },
        async openPage(path) {
          assert(path.startsWith('/cong-viec') || path.startsWith('/lich-lam-viec') || path.startsWith('/don/'), 'QA page route is outside Staff UC9/UC10/UC11')
          currentAssignment = null
          await cdp.navigate(origin, path)
          if (path.startsWith('/cong-viec')) await cdp.until('!!document.querySelector("[data-assignment-id]") || document.body.innerText.includes("Không có công việc")')
          if (path.startsWith('/lich-lam-viec')) await cdp.until('!!document.querySelector("[data-schedule-total]")')
          health()
          return api.visible()
        },
        async visible() {
          const value = await cdp.evaluate('(()=>{const visible=e=>e.getClientRects().length>0;return {path:location.pathname,headings:[...document.querySelectorAll("h1,h2")].filter(visible).map(e=>e.innerText),assignmentIds:[...new Set([...document.querySelectorAll("[data-assignment-id]")].filter(visible).map(e=>e.getAttribute("data-assignment-id")))],scheduleAssignmentIds:[...new Set([...document.querySelectorAll("[data-schedule-assignment-id]")].filter(visible).map(e=>e.getAttribute("data-schedule-assignment-id")))],detailAssignmentId:document.querySelector("[data-assignment-detail-id]")?.getAttribute("data-assignment-detail-id")??null,detailText:document.querySelector("[data-assignment-detail-id]")?.innerText??null,scheduleTotal:document.querySelector("[data-schedule-total]")?.getAttribute("data-schedule-total")??null}})()')
          noSecrets(value); health(); return value
        },
        async assertVisible({ assignmentId, text, area = 'any' } = {}) {
          if (assignmentId !== undefined) assert(id(assignmentId), 'Canonical visible assignment ID required')
          if (assignmentId) {
            const selector = area === 'schedule' ? '[data-schedule-assignment-id="' + assignmentId + '"]' : area === 'detail' ? '[data-assignment-detail-id="' + assignmentId + '"]' : '[data-assignment-id="' + assignmentId + '"],[data-schedule-assignment-id="' + assignmentId + '"],[data-assignment-detail-id="' + assignmentId + '"]'
            await cdp.until('[...document.querySelectorAll(' + JSON.stringify(selector) + ')].some(e=>e.getClientRects().length>0)')
          }
          if (text !== undefined) {
            assert(typeof text === 'string' && text.length < 1000, 'Bounded UI assertion text required')
            await cdp.until('document.body.innerText.includes(' + JSON.stringify(text) + ')')
          }
          health(); return api.visible()
        },
        async verifyStorage() {
          const storageSafe = await cdp.evaluate('(()=>{const jwt=/[A-Za-z0-9_-]{16,}\\.[A-Za-z0-9_-]{16,}\\.[A-Za-z0-9_-]{16,}/;return !Object.values(localStorage).some(v=>jwt.test(v))&&!Object.values(sessionStorage).some(v=>jwt.test(v))&&!document.cookie.includes("cleanhome_staff_session")})()')
          const { cookies } = await cdp.send('Network.getCookies', { urls: [origin] }), own = cookies.filter(cookie => cookie.name === 'cleanhome_staff_session')
          const cookieSafe = own.length === 1 && own[0].httpOnly && own[0].sameSite === 'Lax' && own[0].path === '/' && (url.protocol !== 'https:' || own[0].secure)
          assert(storageSafe && cookieSafe, 'QA session or browser storage security check failed')
          health(); return { jwtInBrowserStorage: false, sessionCookieReadableByJs: false, httpOnly: true, sameSite: 'Lax', secure: own[0].secure }
        },
        async screenshot(name, width = 1440) {
          assert(/^[a-zA-Z0-9._-]+\.png$/.test(name), 'QA screenshot filename must be a simple PNG name')
          assert([375, 390, 768, 1440].includes(width), 'QA responsive width is outside the approved matrix')
          await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false }); await sleep(150)
          assert(await cdp.evaluate('document.documentElement.scrollWidth<=innerWidth+1'), 'QA page has horizontal overflow')
          const image = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
          await writeFile(join(folder, name), Buffer.from(image.data, 'base64')); report.screenshots.push(name)
          return { name, width, horizontalOverflow: false }
        },
        dropNextStatusResponseAfterCommit(assignmentId = currentAssignment) { guardAssignment(assignmentId); assert(droppedAssignment === null, 'A browser response-loss fault is already armed'); droppedAssignment = assignmentId },
        clearResponseLoss() { droppedAssignment = null },
        waitIdle,
        requests() { return requests.map(item => ({ assignmentId: item.assignmentId, method: item.method, status: item.status, key: item.key, target: item.target, finished: item.finished, networkFailure: item.networkFailure === true, bodySafe: item.body || null })) },
        close,
      })
      sessions.set(label, { api, close }); return api
    } catch (error) { await close(); throw error }
  }
  return Object.freeze({
    openEmployee,
    report() { return structuredClone(report) },
    async close() { for (const session of sessions.values()) await session.close(); return structuredClone(report) },
  })
}
