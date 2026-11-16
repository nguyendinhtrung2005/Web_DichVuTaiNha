import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

// Browser UI regression using explicit test-only fetch doubles. No real
// credentials, JWTs, sessions, Auth/Staff/Order requests or MySQL writes.
if (process.env.RUN_STAFF_AUTH_FORM_BROWSER_TESTS !== 'true') {
  console.log(JSON.stringify({ browser: 'NOT_RUN', reason: 'Explicit opt-in is required' }))
  process.exit(0)
}
const origin = new URL(process.env.STAFF_BFF_TEST_BASE_URL || 'http://localhost:3002').origin
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)) throw new Error('Loopback Staff frontend required')
const chromePath = process.env.STAFF_BFF_CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const artifactDir = process.env.STAFF_AUTH_FORM_QA_ARTIFACT_DIR
  ? resolve(process.env.STAFF_AUTH_FORM_QA_ARTIFACT_DIR) : await mkdtemp(join(tmpdir(), 'cleanhome-auth-form-report-'))
const fixture = { phone: 'TEST-FORM-' + randomBytes(4).toString('hex'), password: randomBytes(24).toString('base64url') }
const report = { layer: 'Chrome UI with explicit in-browser Auth/BFF dependency doubles; not real Auth E2E', checks: [],
  nativePasswordManagerSelection: 'NOT_RUN; requires manual saved-credential selection', exceptions: 0 }
let chrome, profile, cdp, failedAt = 'initialization'
const delay = ms => new Promise(done => setTimeout(done, ms))
function check(value, code) { if (!value) throw new Error(code) }
class CDP {
  constructor(socket) {
    this.socket = socket; this.id = 0; this.pending = new Map(); this.listeners = []
    socket.addEventListener('message', event => {
      const data = JSON.parse(event.data)
      if (data.id) {
        const item = this.pending.get(data.id)
        if (item) { clearTimeout(item.timer); this.pending.delete(data.id); data.error ? item.reject(new Error('CDP_REJECTED')) : item.resolve(data.result) }
      } else for (const listener of this.listeners) listener(data.method, data.params)
    })
  }
  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('CDP_TIMEOUT')) }, 20000)
      this.pending.set(id, { resolve, reject, timer })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    check(!result.exceptionDetails, 'BROWSER_EXPRESSION_FAILED_CONTENTS_WITHHELD')
    return result.result.value
  }
  async until(expression, timeout = 20000) {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) { if (await this.evaluate(expression)) return; await delay(80) }
    throw new Error('BROWSER_CONDITION_TIMEOUT_CONTENTS_WITHHELD')
  }
}
async function step(name, action) { failedAt = name; await action(); report.checks.push({ name, status: 'PASS' }) }
async function fill(name, value, events = true) {
  check(await cdp.evaluate('(() => {const e=document.querySelector(' + JSON.stringify('input[name="' + name + '"]') + ');if(!e)return false;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,' + JSON.stringify(value) + ');'
    + (events ? 'e.dispatchEvent(new Event("input",{bubbles:true}));e.dispatchEvent(new Event("change",{bubbles:true}));' : '') + 'return true})()'), 'FORM_INPUT_MISSING')
}
async function rememberNodes() {
  await cdp.evaluate('window.__authFormQA.nodes={phone:document.querySelector("input[name=phone]"),password:document.querySelector("input[name=password]"),form:document.querySelector("form")};true')
}
function sameNodesAndValues() {
  return '(() => {const q=window.__authFormQA;return q.nodes.phone===document.querySelector("input[name=phone]")&&q.nodes.password===document.querySelector("input[name=password]")&&q.nodes.form===document.querySelector("form")&&q.nodes.phone.value===q.expected.phone&&q.nodes.password.value===q.expected.password})()'
}
async function checkStorage() {
  check(await cdp.evaluate('(() => {const q=window.__authFormQA;const text=JSON.stringify([Object.fromEntries(Object.entries(localStorage)),Object.fromEntries(Object.entries(sessionStorage)),document.cookie,location.href]);return !text.includes(q.expected.password)&&!/[A-Za-z0-9_-]{16,}\\.[A-Za-z0-9_-]{16,}\\.[A-Za-z0-9_-]{16,}/.test(text)&&localStorage.getItem("cleanhome-form-existing")==="keep-local"&&sessionStorage.getItem("cleanhome-form-existing")==="keep-session"})()'), 'BROWSER_STORAGE_CONTAINS_CREDENTIAL_OR_CHANGED_DATA')
}
const watchdog = setTimeout(() => {
  report.hardTimeout = true
  if (chrome && chrome.exitCode === null) chrome.kill()
}, 180000)
try {
  await access(chromePath)
  await mkdir(artifactDir, { recursive: true })
  profile = await mkdtemp(join(tmpdir(), 'cleanhome-staff-auth-form-'))
  chrome = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--disable-background-networking', '--disable-sync', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
    '--user-data-dir=' + profile, '--window-size=1280,900', 'about:blank'], { windowsHide: true, stdio: 'ignore' })
  let port
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    try { port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); if (port) break } catch {}
    check(chrome.exitCode === null, 'OWNED_CHROME_START_FAILED')
    await delay(100)
  }
  check(port, 'OWNED_CHROME_START_TIMEOUT')
  const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list', { signal: AbortSignal.timeout(5000) })).json()
  const target = targets.find(item => item.type === 'page')
  check(target?.webSocketDebuggerUrl, 'OWNED_CHROME_PAGE_MISSING')
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', () => reject(new Error('CDP_CONNECT_FAILED')), { once: true }) })
  cdp = new CDP(socket)
  cdp.listeners.push((method) => { if (method === 'Runtime.exceptionThrown') report.exceptions++ })
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable')
  const injected = `(() => {
    if(location.origin!==${JSON.stringify(origin)})return;
    const originalFetch=window.fetch.bind(window);
    const q=window.__authFormQA={expected:${JSON.stringify(fixture)},sessionMode:'anonymous',loginMode:'reject',hasSession:false,sessionCalls:0,loginCalls:0,blockedBusinessCalls:0,pending:[],lastLoginMatched:false};
    const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
    const publicSession=()=>({session:{user:{id:'9109002',role:'EMPLOYEE',status:'ACTIVE'},expiresAt:new Date(Date.now()+600000).toISOString()}});
    q.releaseSessions=()=>{for(const item of q.pending.splice(0))if(!item.signal?.aborted)item.resolve(json({error:{code:'SESSION_REQUIRED',message:'No session'}},401));};
    window.fetch=(input,init={})=>{
      const u=new URL(typeof input==='string'?input:input.url,location.href);
      if([4001,4003,4005].includes(Number(u.port))||u.origin===location.origin&&u.pathname.startsWith('/api/staff/')){q.blockedBusinessCalls++;return Promise.reject(new Error('TEST_BLOCKED_BACKEND_CALL'));}
      if(u.origin!==location.origin||!u.pathname.startsWith('/api/auth/'))return originalFetch(input,init);
      if(u.pathname==='/api/auth/session'){
        q.sessionCalls++;
        if(q.sessionMode==='hold')return new Promise((resolve,reject)=>{q.pending.push({resolve,signal:init.signal});init.signal?.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});});
        if(q.sessionMode==='unavailable')return Promise.resolve(json({error:{code:'AUTH_UNAVAILABLE',message:'Dependency unavailable'}},503));
        return Promise.resolve(q.hasSession?json(publicSession()):json({error:{code:q.sessionMode==='expired'?'SESSION_EXPIRED':'SESSION_REQUIRED',message:'No session'}},401));
      }
      if(u.pathname==='/api/auth/login'){
        q.loginCalls++;const body=JSON.parse(init.body);q.lastLoginMatched=body.phone===q.expected.phone&&body.password===q.expected.password;
        if(q.loginMode==='network')return Promise.reject(new TypeError('TEST_NETWORK_UNAVAILABLE'));
        if(q.loginMode==='unavailable')return Promise.resolve(json({error:{code:'AUTH_UNAVAILABLE',message:'Temporarily unavailable'}},503));
        if(q.loginMode==='success'&&q.lastLoginMatched){q.hasSession=true;return Promise.resolve(json(publicSession()));}
        return Promise.resolve(json({error:{code:'INVALID_CREDENTIALS',message:'Wrong credentials'}},401));
      }
      if(u.pathname==='/api/auth/logout'){q.hasSession=false;return Promise.resolve(json({ok:true}));}
      return Promise.resolve(json({error:{code:'NOT_FOUND'}},404));
    };
    localStorage.setItem('cleanhome-form-existing','keep-local');sessionStorage.setItem('cleanhome-form-existing','keep-session');
  })()`
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: injected })
  await cdp.send('Page.navigate', { url: origin + '/dang-nhap' })
  await cdp.until('!!document.querySelector("input[name=phone]")&&!!window.__authFormQA')
  await step('standard phone/password manager attributes', async () => {
    check(await cdp.evaluate('document.querySelector("input[name=phone]").type==="tel"&&document.querySelector("input[name=phone]").autocomplete==="username"&&document.querySelector("input[name=password]").type==="password"&&document.querySelector("input[name=password]").autocomplete==="current-password"'), 'AUTOCOMPLETE_ATTRIBUTES_CHANGED')
  })
  await step('tab return keeps draft and original DOM nodes while background session check is pending', async () => {
    await fill('phone', fixture.phone); await fill('password', fixture.password); await rememberNodes()
    const startCalls = await cdp.evaluate('window.__authFormQA.sessionMode="hold";window.__authFormQA.sessionCalls')
    const other = await cdp.send('Target.createTarget', { url: 'about:blank' })
    await cdp.send('Target.activateTarget', { targetId: other.targetId }); await delay(100)
    await cdp.send('Page.bringToFront')
    // Explicit events make the test deterministic on headless platforms that
    // do not report native desktop focus. The real second tab is still used.
    await cdp.evaluate('window.dispatchEvent(new Event("focus"));document.dispatchEvent(new Event("visibilitychange"));true')
    await cdp.until('window.__authFormQA.sessionCalls>' + startCalls)
    await delay(180)
    report.pendingDraftObservation = await cdp.evaluate('({phonePresent:!!document.querySelector("input[name=phone]"),originalPhoneConnected:window.__authFormQA.nodes.phone.isConnected,originalPasswordConnected:window.__authFormQA.nodes.password.isConnected})')
    check(await cdp.evaluate(sameNodesAndValues()), 'TAB_RETURN_UNMOUNTED_OR_CLEARED_DRAFT')
    await cdp.evaluate('window.__authFormQA.releaseSessions();window.__authFormQA.sessionMode="anonymous";true')
    await delay(120)
    check(await cdp.evaluate(sameNodesAndValues()), 'ANONYMOUS_RESPONSE_CLEARED_DRAFT')
    await cdp.send('Target.closeTarget', { targetId: other.targetId })
  })
  await step('React context rerender and password visibility toggle keep entered values', async () => {
    await cdp.evaluate('window.__authFormQA.sessionMode="expired";window.dispatchEvent(new Event("focus"));true')
    await delay(180)
    check(await cdp.evaluate(sameNodesAndValues()), 'CONTEXT_RERENDER_CLEARED_DRAFT')
    await cdp.evaluate('document.querySelector("button[aria-controls]").click();true')
    check(await cdp.evaluate(sameNodesAndValues()), 'PASSWORD_VISIBILITY_RERENDER_CLEARED_DRAFT')
    await cdp.evaluate('document.querySelector("button[aria-controls]").click();true')
  })
  await step('background dependency error keeps the anonymous login draft', async () => {
    await cdp.evaluate('window.__authFormQA.sessionMode="unavailable";window.dispatchEvent(new Event("focus"));true')
    await delay(180)
    check(await cdp.evaluate(sameNodesAndValues()), 'DEPENDENCY_ERROR_CLEARED_DRAFT')
    check(await cdp.evaluate('!Array.from(document.querySelectorAll("[role=status]")).some(x=>/chưa khả dụng/.test(x.innerText))'), 'BACKGROUND_OUTAGE_SHOWED_SERVICE_BANNER')
    await cdp.evaluate('window.__authFormQA.sessionMode="anonymous";true')
  })
  await step('wrong login keeps phone and clears only the password with accessible error', async () => {
    await cdp.evaluate('document.querySelector("form").requestSubmit();true')
    await cdp.until('!!document.querySelector("[role=alert]")&&!document.querySelector("button[type=submit]").disabled')
    check(await cdp.evaluate('window.__authFormQA.lastLoginMatched&&document.querySelector("input[name=phone]").value===window.__authFormQA.expected.phone&&document.querySelector("input[name=password]").value===""'), 'FAILED_LOGIN_DRAFT_POLICY_WRONG')
    await checkStorage()
  })
  await step('failed login keeps the password cleared through a background outage', async () => {
    await cdp.evaluate('window.__authFormQA.sessionMode="unavailable";window.dispatchEvent(new Event("focus"));true')
    await delay(250)
    check(await cdp.evaluate('document.querySelector("input[name=password]").value===""'), 'BACKGROUND_OUTAGE_RESTORED_PASSWORD')
    check(await cdp.evaluate('!Array.from(document.querySelectorAll("[role=status]")).some(x=>/chưa khả dụng/.test(x.innerText))'), 'BACKGROUND_OUTAGE_SHOWED_SERVICE_BANNER_AFTER_FAILURE')
    await cdp.evaluate('window.__authFormQA.sessionMode="anonymous";true')
  })
  for (const mode of ['unavailable','network']) await step('login '+mode+' keeps phone, recreates empty password and announces error', async()=>{
    await cdp.evaluate('window.__authFormQA.loginMode='+JSON.stringify(mode)+';true');await fill('password',fixture.password);await rememberNodes();await cdp.evaluate('document.querySelector("form").requestSubmit();true');await cdp.until('!!document.querySelector("[role=alert]")&&!document.querySelector("button[type=submit]").disabled');check(await cdp.evaluate('document.querySelector("input[name=password]").value===""&&document.querySelector("input[name=phone]").value===window.__authFormQA.expected.phone&&!window.__authFormQA.nodes.password.isConnected'), 'FAILURE_RESTORED_PASSWORD');await delay(250);check(await cdp.evaluate('document.querySelector("input[name=password]").value===""'), 'FAILURE_DELAY_RESTORED_PASSWORD');await checkStorage()
  })
  await step('silent DOM autofill model is used at submit without application autofilling credentials', async () => {
    check(await cdp.evaluate('window.__authFormQA.blockedBusinessCalls===0'), 'UNEXPECTED_BUSINESS_API_CALL')
    await cdp.evaluate('window.__authFormQA.loginMode="success";true')
    await fill('phone', fixture.phone, false); await fill('password', fixture.password, false)
    await cdp.evaluate('document.querySelector("form").requestSubmit();true')
    await cdp.until('location.pathname==="/"&&!document.querySelector("input[name=password]")')
    check(await cdp.evaluate('window.__authFormQA.lastLoginMatched'), 'DOM_AUTOFILL_WAS_NOT_SUBMITTED')
    await checkStorage()
  })
  await step('successful UI login and logout discard form credentials and preserve browser storage', async () => {
    check(await cdp.evaluate('!document.querySelector("input[name=password]")'), 'SUCCESS_RETAINED_LOGIN_FORM')
    await cdp.evaluate('document.querySelector("button[aria-label^=\\"Tài khoản\\"]").click();true')
    await cdp.until('[...document.querySelectorAll("[role=menuitem]")].some(x=>x.innerText.includes("Đăng xuất"))')
    await cdp.evaluate('[...document.querySelectorAll("[role=menuitem]")].find(x=>x.innerText.includes("Đăng xuất")).click();true')
    await cdp.until('location.pathname==="/dang-nhap"&&!!document.querySelector("input[name=phone]")')
    check(await cdp.evaluate('document.querySelector("input[name=phone]").value===""&&document.querySelector("input[name=password]").value===""'), 'LOGOUT_RETAINED_CREDENTIAL_INPUTS')
    await checkStorage()
  })
  await step('login form test raises no browser exception', async () => {
    // The authenticated dashboard is allowed to request read-only staff data;
    // the in-browser double blocks it and records the count as an observation.
    report.dashboardBusinessCallsBlockedAfterLogin = await cdp.evaluate('window.__authFormQA.blockedBusinessCalls')
    check(report.exceptions === 0, 'BROWSER_EXCEPTION')
  })
  report.pass = report.checks.length; report.fail = 0
} catch (error) {
  report.pass = report.checks.length; report.fail = 1; report.failedAt = failedAt
  report.error = /^[A-Z_]+$/.test(error.message) ? error.message : 'BROWSER_CHECK_FAILED_CONTENTS_WITHHELD'
  process.exitCode = 1
} finally {
  clearTimeout(watchdog)
  try { if (cdp) await cdp.send('Browser.close') } catch {}
  if (chrome && chrome.exitCode === null) chrome.kill()
  if (profile) {
    const target = resolve(profile)
    if (dirname(target) === resolve(tmpdir()) && basename(target).startsWith('cleanhome-staff-auth-form-')) {
      try { await rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); report.profileClosed = true } catch { report.profileClosed = false }
    }
  }
  await mkdir(artifactDir, { recursive: true })
  await writeFile(join(artifactDir, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ pass: report.pass || 0, fail: report.fail || 0, failedAt: report.failedAt, report: join(artifactDir, 'report.json'), profileClosed: report.profileClosed, nativePasswordManagerSelection: 'NOT_RUN' }))
}
