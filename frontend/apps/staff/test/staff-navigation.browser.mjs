import { spawn } from 'node:child_process'
import { readFile, writeFile, mkdir, mkdtemp, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// Real Chrome layout/navigation tests with explicit browser-only BFF doubles.
// No real identity, JWT, Backend request or MySQL write. Production code has no fixture switch.
if (process.env.RUN_STAFF_NAV_BROWSER_TESTS !== 'true') {
  console.log(JSON.stringify({ status: 'NOT_RUN', reason: 'Explicit opt-in required' }))
  process.exit(0)
}
const origin = new URL(process.env.STAFF_BFF_TEST_BASE_URL || 'http://localhost:3102').origin
if (!['localhost', '127.0.0.1'].includes(new URL(origin).hostname)) throw new Error('LOOPBACK_REQUIRED')
const folder = process.env.STAFF_NAV_ARTIFACT_DIR ? resolve(process.env.STAFF_NAV_ARTIFACT_DIR) : await mkdtemp(join(tmpdir(), 'cleanhome-staff-navigation-'))
const chromePath = process.env.STAFF_BFF_CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const report = { layer: 'Chrome UI with explicit BFF doubles; not real Auth/Backend E2E', checks: [], layouts: [], exceptions: 0 }
const delay = ms => new Promise(done => setTimeout(done, ms))
function check(ok, code) { if (!ok) throw new Error(code) }
let chrome, socket, cdp, failedAt = 'initialize'
class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map()
    ws.addEventListener('message', event => {
      const m = JSON.parse(event.data)
      if (m.method === 'Runtime.exceptionThrown') report.exceptions++
      if (!m.id) return
      const p = this.pending.get(m.id)
      if (!p) return
      clearTimeout(p.timer); this.pending.delete(m.id)
      m.error ? p.reject(new Error('CDP_REJECTED')) : p.resolve(m.result)
    })
  }
  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('CDP_TIMEOUT')) }, 20000)
      this.pending.set(id, { resolve, reject, timer }); this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    check(!r.exceptionDetails, 'BROWSER_EXPRESSION_FAILED'); return r.result.value
  }
  async until(expression) {
    const deadline = Date.now() + 20000
    while (Date.now() < deadline) { if (await this.eval(expression)) return; await delay(80) }
    throw new Error('BROWSER_CONDITION_TIMEOUT')
  }
  async navigate(path) {
    await this.send('Page.navigate', { url: origin + path })
    await this.until('location.pathname===' + JSON.stringify(path.split(/[?#]/)[0]) + '&&document.readyState==="complete"')
  }
}
function seed(origin) {
  if (location.origin !== origin) return
  const original = window.fetch.bind(window)
  const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
  const session = () => ({ session: { user: { id: '1', role: 'EMPLOYEE', status: 'ACTIVE' }, expiresAt: new Date(Date.now() + 3600000).toISOString() } })
  const q = window.__staffNavQA = { forbidden: 0 }
  window.fetch = async (input, init = {}) => {
    const u = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url, location.href)
    const method = (init.method || input.method || 'GET').toUpperCase()
    if (['4001', '4003', '4005'].includes(u.port) || u.pathname.startsWith('/internal/')) { q.forbidden++; throw new Error('QA_BACKEND_REFUSED') }
    if (u.origin !== origin) return original(input, init)
    if (u.pathname === '/api/auth/session' || u.pathname === '/api/auth/renew') return sessionStorage.getItem('staff-nav-qa-anonymous') === 'yes' ? json({ error: { code: 'SESSION_REQUIRED' } }, 401) : json(session())
    if (u.pathname === '/api/auth/login') { sessionStorage.removeItem('staff-nav-qa-anonymous'); return json(session()) }
    if (u.pathname === '/api/auth/logout') { sessionStorage.setItem('staff-nav-qa-anonymous', 'yes'); return json({ ok: true }) }
    if (u.pathname.startsWith('/api/staff/')) {
      if (method !== 'GET') { q.forbidden++; throw new Error('QA_BUSINESS_WRITE_REFUSED') }
      if (/\/jobs\/[^/]+$/.test(u.pathname)) return json({ error: { code: 'JOB_NOT_FOUND', message: 'Không tìm thấy công việc.' } }, 404)
      return json({ data: [], pagination: { page: Number(u.searchParams.get('page') || 1), pageSize: Number(u.searchParams.get('pageSize') || 20), total: 0, totalPages: 0 }, timezone: 'Asia/Ho_Chi_Minh' })
    }
    return original(input, init)
  }
}
async function step(name, fn) { failedAt = name; await fn(); report.checks.push({ name, status: 'PASS' }); console.log(JSON.stringify({ name, status: 'PASS' })) }
async function screenshot(name) { const p = await cdp.send('Page.captureScreenshot', { format: 'png' }); await writeFile(join(folder, name + '.png'), Buffer.from(p.data, 'base64')) }
const timeout = setTimeout(() => { chrome?.kill(); console.error('NAV_BROWSER_TIMEOUT'); process.exit(1) }, 240000)
try {
  await access(chromePath); await mkdir(folder, { recursive: true })
  const profile = join(folder, 'chrome-profile'); await mkdir(profile, { recursive: true })
  chrome = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync', '--disable-background-networking', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: 'ignore' })
  let port
  for (let i = 0; i < 200; i++) { try { port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); if (port) break } catch {} await delay(100) }
  check(port, 'CHROME_START_FAILED')
  const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list', { signal: AbortSignal.timeout(5000) })).json()
  socket = new WebSocket(targets.find(p => p.type === 'page').webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
  cdp = new CDP(socket); await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Page.bringToFront')
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: '(' + seed.toString() + ')(' + JSON.stringify(origin) + ')' })
  const pages = [['/', '/'], ['/cong-viec', '/cong-viec'], ['/don/1', '/cong-viec'], ['/lich-lam-viec', '/lich-lam-viec'], ['/thong-bao', '/thong-bao'], ['/ho-so', '/ho-so']]
  for (const width of [375, 390, 768, 1440]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false })
    for (const [path, active] of pages) {
      await step(width + 'px ' + path, async () => {
        await cdp.navigate(path); await cdp.until('!!document.querySelector("main h1")&&!!document.querySelector(".staff-bottom-nav")'); await cdp.eval('document.fonts.ready.then(()=>true)')
        const result = await cdp.eval('(() => {const visible=e=>e.getBoundingClientRect().width>0&&getComputedStyle(e).visibility!=="hidden";const nav=window.innerWidth<1024?document.querySelector(".staff-bottom-nav"):document.querySelector(".staff-sidebar nav");const links=[...nav.querySelectorAll("a")];const active=links.filter(e=>e.getAttribute("aria-current")==="page");return{overflow:document.documentElement.scrollWidth>innerWidth,bottomVisible:visible(document.querySelector(".staff-bottom-nav")),sidebarVisible:visible(document.querySelector(".staff-sidebar")),labels:links.map(e=>e.textContent.trim()),active:active.map(e=>new URL(e.href).pathname),targets:links.every(e=>{const r=e.getBoundingClientRect();return r.width>=44&&r.height>=44&&r.left>=0&&r.right<=innerWidth}),color:active[0]&&getComputedStyle(active[0]).color,font:getComputedStyle(document.body).fontFamily,padding:parseFloat(getComputedStyle(document.querySelector(".staff-workspace")).paddingBottom),navHeight:document.querySelector(".staff-bottom-nav").getBoundingClientRect().height,forbidden:window.__staffNavQA.forbidden}})()')
        check(!result.overflow && result.targets && result.forbidden === 0, 'LAYOUT_OVERFLOW_OR_TARGET')
        check(result.bottomVisible === (width < 1024) && result.sidebarVisible === (width >= 1024), 'BREAKPOINT')
        check(JSON.stringify(result.labels) === JSON.stringify(['Tổng quan', 'Công việc', 'Lịch', 'Thông báo', 'Cá nhân']), 'FIVE_ITEMS')
        check(JSON.stringify(result.active) === JSON.stringify([active]), 'ACTIVE_STATE')
        check(result.color === 'rgb(37, 99, 235)' && result.font.includes('Be Vietnam Pro'), 'BRAND_COLOR_OR_FONT')
        if (width < 1024) check(result.padding >= result.navHeight + 8, 'BOTTOM_OVERLAP')
        report.layouts.push({ width, path, status: 'PASS' })
        if ((width === 375 && path === '/thong-bao') || (width === 1440 && path === '/cong-viec')) await screenshot('ui-fixture-' + width)
      })
    }
  }
  await step('desktop collapse preserves accessible names and active page', async () => {
    await cdp.navigate('/don/1'); await cdp.until('!!document.querySelector(".staff-sidebar nav")')
    await cdp.eval('document.querySelector("button[aria-label=\\"Thu gọn thanh điều hướng\\"]").click();true')
    await cdp.until('!!document.querySelector(".staff-collapsed")')
    check(await cdp.eval('[...document.querySelectorAll(".staff-sidebar nav a")].every(a=>!!a.getAttribute("aria-label")&&!!a.title)&&document.querySelector(".staff-sidebar nav [aria-current=page]").getAttribute("href")==="/cong-viec"'), 'COLLAPSED_LABELS')
    await screenshot('ui-fixture-desktop-collapsed')
  })
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false })
  await step('mobile drawer Escape restores focus', async () => {
    await cdp.eval('document.querySelector("button[aria-label=\\"Mở menu nhân viên\\"]").focus();true')
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r' }); await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter' })
    await cdp.until('!!document.querySelector("[role=dialog]")')
    check(await cdp.eval('document.querySelectorAll("[role=dialog] nav a").length===5'), 'DRAWER_ITEMS')
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' }); await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' })
    await cdp.until('!document.querySelector("[role=dialog]")')
    report.focusAfterEscape = await cdp.eval('({tag:document.activeElement.tagName,label:document.activeElement.getAttribute("aria-label"),documentFocused:document.hasFocus()})')
    await cdp.until('document.activeElement.getAttribute("aria-label")==="Mở menu nhân viên"')
  })
  await step('short mobile drawer can scroll to logout', async () => {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 420, deviceScaleFactor: 1, mobile: false })
    await cdp.eval('document.querySelector("button[aria-label=\\"Mở menu nhân viên\\"]").click();true')
    await cdp.until('!!document.querySelector("[role=dialog]")')
    const result = await cdp.eval('(() => {const d=document.querySelector("[role=dialog]");const b=[...d.querySelectorAll("button")].find(e=>e.textContent.includes("Đăng xuất"));b.scrollIntoView({block:"end"});const r=b.getBoundingClientRect();return{scroll:getComputedStyle(d).overflowY==="auto",reachable:r.top>=0&&r.bottom<=innerHeight,top:r.top,bottom:r.bottom,height:innerHeight,scrollTop:d.scrollTop,scrollHeight:d.scrollHeight,clientHeight:d.clientHeight}})()')
    report.shortDrawer=result
    check(result.scroll && result.reachable, 'SHORT_DRAWER_SCROLL')
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' }); await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' })
    await cdp.until('!document.querySelector("[role=dialog]")')
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false })
  })
  await step('keyboard Enter follows mobile links', async () => {
    await cdp.eval('document.querySelector(".staff-bottom-nav a[href=\\"/thong-bao\\"]").focus();true')
    check(await cdp.eval('getComputedStyle(document.activeElement).outlineStyle!=="none"'), 'KEYBOARD_FOCUS')
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r' }); await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter' })
    await cdp.until('location.pathname==="/thong-bao"&&!!document.querySelector("main h1")')
    check(await cdp.eval('document.querySelector("main").textContent.includes("Thông báo chưa khả dụng")&&!document.querySelector(".staff-bottom-nav [data-unread-count]")'), 'NOTIFICATION_PLACEHOLDER')
  })
  try {
    await cdp.send('Emulation.setSafeAreaInsets', { insets: { top: 24, left: 0, right: 0, bottom: 34 } })
    await step('emulated safe area reserves bottom content space', async () => {
      await cdp.eval('new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(()=>done(true))))')
      const sizes = await cdp.eval('({padding:parseFloat(getComputedStyle(document.querySelector(".staff-workspace")).paddingBottom),nav:document.querySelector(".staff-bottom-nav").getBoundingClientRect().height,top:parseFloat(getComputedStyle(document.querySelector(".staff-workspace > header")).paddingTop)})')
      check(sizes.padding >= 122 && sizes.padding >= sizes.nav + 8 && sizes.top >= 24, 'SAFE_AREA_SPACING')
    })
  } catch (e) { if (e.message !== 'CDP_REJECTED') throw e; report.safeAreaDeviceEmulation = 'NOT_RUN; CDP unsupported; default spacing verified' }
  await step('anonymous deep link keeps safe return URL and hides navigation', async () => {
    await cdp.eval('sessionStorage.setItem("staff-nav-qa-anonymous","yes");true')
    await cdp.send('Page.navigate', { url: origin + '/thong-bao?view=all#update' })
    await cdp.until('location.pathname==="/dang-nhap"&&!!document.querySelector("input[name=phone]")')
    check(await cdp.eval('new URLSearchParams(location.search).get("next")==="/thong-bao?view=all#update"&&!document.querySelector(".staff-bottom-nav")&&!document.querySelector(".staff-sidebar")'), 'LOGIN_DEEP_LINK')
    await screenshot('ui-fixture-login')
  })
  await step('navigation stores no JWT/password and raises no runtime exception', async () => {
    check(await cdp.eval('!/[A-Za-z0-9_-]{16,}\\.[A-Za-z0-9_-]{16,}\\.[A-Za-z0-9_-]{16,}/.test(JSON.stringify([Object.entries(localStorage),Object.entries(sessionStorage),document.cookie,location.href]))&&window.__staffNavQA.forbidden===0'), 'STORAGE_OR_BACKEND')
    check(report.exceptions === 0, 'BROWSER_EXCEPTION')
  })
  report.status = 'PASS'
} catch (e) { report.status = 'FAIL'; report.checks.push({ name: failedAt, status: 'FAIL', code: /^[A-Z_]+$/.test(e.message) ? e.message : 'DETAILS_WITHHELD' }); process.exitCode = 1 }
finally {
  clearTimeout(timeout); try { await cdp?.send('Browser.close') } catch {} socket?.close(); if (chrome?.exitCode === null) chrome.kill()
  report.pass = report.checks.filter(c => c.status === 'PASS').length; report.fail = report.checks.filter(c => c.status === 'FAIL').length
  await writeFile(join(folder, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ status: report.status, pass: report.pass, fail: report.fail, layouts: report.layouts.length, artifacts: folder }))
}
