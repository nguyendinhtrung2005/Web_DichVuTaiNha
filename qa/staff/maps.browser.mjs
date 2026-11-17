import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { loadConfig, privateDirectory } from './common.mjs'

// Real browser and real tile requests. This suite performs no SQL, seed or
// Staff mutation; only login/logout and authenticated GET requests are allowed.
const check = (condition, code) => { if (!condition) throw Error(code) }
const wait = ms => new Promise(done => setTimeout(done, ms))
const report = { layer: 'Chrome → isolated Staff BFF → Leaflet → live OpenStreetMap tiles', mockedResponses: false, checks: [], layouts: [], interactions: [], tileCoverage: [], screenshots: [], tileRequests: 0, tileResponses: [], tileFailures: 0, forbiddenRequests: 0, exceptions: 0 }
let config, cdp, chrome, profile, artifacts, fault = null, failedAt = 'configuration'
const heldTiles = []
const tileRequestIds = new Set()
const intentionalNetworkIds = new Set()
const tileUrl = value => /^https:\/\/tile\.openstreetmap\.org\/\d+\/\d+\/\d+\.png$/.test(value)
function redact(value) {
  let text = String(value || '')
  for (const account of Object.values(config?.accounts || {})) for (const secret of [account.phone, account.password]) if (secret) text = text.split(secret).join('[REDACTED]')
  return text.replace(/[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g, '[REDACTED_TOKEN]')
}

class CDP {
  constructor(socket) {
    this.socket = socket; this.sequence = 0; this.pending = new Map(); this.listeners = []
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data)
      if (message.id) {
        const item = this.pending.get(message.id)
        if (item) { clearTimeout(item.timer); this.pending.delete(message.id); message.error ? item.reject(Error('QA_CDP_REQUEST_FAILED_' + item.method.replaceAll('.', '_'))) : item.resolve(message.result) }
      } else for (const listener of this.listeners) listener(message.method, message.params)
    })
    socket.addEventListener('close', () => { for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(Error('QA_CHROME_CLOSED')) } this.pending.clear() })
  }
  send(method, params = {}) {
    const id = ++this.sequence
    return new Promise((done, reject) => { const timer = setTimeout(() => { this.pending.delete(id); reject(Error('QA_CDP_TIMEOUT')) }, 25000); this.pending.set(id, { done, resolve: done, reject, timer, method }); this.socket.send(JSON.stringify({ id, method, params })) })
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    check(!result.exceptionDetails, 'QA_BROWSER_EXPRESSION_FAILED_CONTENTS_WITHHELD')
    return result.result.value
  }
  async until(expression, milliseconds = 60000) {
    const deadline = Date.now() + milliseconds
    while (Date.now() < deadline) { if (await this.evaluate(expression)) return; await wait(120) }
    throw Error('QA_BROWSER_CONDITION_TIMEOUT_CONTENTS_WITHHELD')
  }
  async navigate(path) {
    const before = await this.evaluate('performance.timeOrigin')
    await this.send('Page.navigate', { url: config.frontendOrigin + path })
    await this.until('performance.timeOrigin!==' + JSON.stringify(before) + '&&location.pathname===' + JSON.stringify(path.split('?')[0]) + '&&document.readyState==="complete"')
  }
}
async function step(name, action) {
  failedAt = name
  try { await action(); report.checks.push({ name, status: 'REAL_PASS' }); console.log(JSON.stringify({ name, status: 'REAL_PASS' })) }
  catch (error) {
    const tileStep = name.startsWith('Leaflet renders') || name.startsWith('Real tile network error') || name.startsWith('Live tiles after')
    const realNetworkFailure = report.tileNetworkErrors?.some(row => !row.intentionalFault && !row.cancelled) || report.tileResponses.some(row => row.status >= 400)
    if (!tileStep || !realNetworkFailure || !['QA_REAL_TILE_NETWORK_ERROR_AFTER_BOUNDED_RETRY', 'QA_REAL_MAP_NOT_FULLY_LOADED'].includes(error.message)) throw error
    report.externalTilesBlocked = true; report.checks.push({ name, status: 'BLOCKED', code: error.message }); console.log(JSON.stringify({ name, status: 'BLOCKED', code: error.message }))
  }
}
async function startChrome() {
  const executable = process.env.STAFF_QA_CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  await access(executable)
  profile = await mkdtemp(join(tmpdir(), 'cleanhome-staff-leaflet-qa-chrome-'))
  const cache = join(privateDirectory, 'chrome-map-cache'); await mkdir(cache, { recursive: true })
  // Reuse the browser's ordinary disk cache across runs while keeping cookies
  // and sessions in a new temporary profile. Do not clear or bypass tile cache.
  chrome = spawn(executable, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-sync', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--disk-cache-dir=' + cache, '--window-size=1440,1000', 'about:blank'], { windowsHide: true, stdio: 'ignore' })
  let port
  for (let attempt = 0; attempt < 200; attempt++) {
    try { port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); if (port) break } catch {}
    check(chrome.exitCode === null, 'QA_CHROME_START_FAILED'); await wait(100)
  }
  check(port, 'QA_CHROME_START_TIMEOUT')
  const pages = await (await fetch('http://127.0.0.1:' + port + '/json/list', { signal: AbortSignal.timeout(5000) })).json()
  const page = pages.find(value => value.type === 'page'); check(page?.webSocketDebuggerUrl, 'QA_CHROME_PAGE_MISSING')
  const socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((done, reject) => { socket.addEventListener('open', done, { once: true }); socket.addEventListener('error', () => reject(Error('QA_CDP_CONNECT_FAILED')), { once: true }) })
  cdp = new CDP(socket)
  cdp.listeners.push((method, params) => {
    if (method === 'Runtime.exceptionThrown') report.exceptions++
    if (method === 'Network.requestWillBeSent' && tileUrl(params.request.url)) {
      report.tileRequests++
      tileRequestIds.add(params.requestId)
      const headers = Object.fromEntries(Object.entries(params.request.headers).map(([name, value]) => [name.toLowerCase(), value]))
      if (headers.referer && headers.referer.startsWith(config.frontendOrigin + '/')) report.tileRefererPresent = true
    }
    if (method === 'Network.responseReceived' && tileUrl(params.response.url)) report.tileResponses.push({ status: params.response.status, mimeType: params.response.mimeType, protocol: params.response.protocol, fromDiskCache: !!params.response.fromDiskCache })
    if (method === 'Network.responseReceived') {
      const url = new URL(params.response.url)
      if (url.origin === config.frontendOrigin && url.pathname.startsWith('/api/')) report.apiResponses = [...(report.apiResponses || []), { path: url.pathname, status: params.response.status }]
    }
    if (method === 'Network.loadingFailed' && tileRequestIds.has(params.requestId)) {
      const code = /^net::[A-Z_]+$/.test(params.errorText || '') ? params.errorText : 'NETWORK_ERROR'
      report.tileNetworkErrors = [...(report.tileNetworkErrors || []), { code, intentionalFault: intentionalNetworkIds.has(params.requestId), cancelled: !!params.canceled }]
    }
    if (method !== 'Fetch.requestPaused') return
    const { requestId, request } = params, url = new URL(request.url)
    const allowedAuth = url.origin === config.frontendOrigin && request.method === 'POST' && ['/api/auth/login', '/api/auth/logout'].includes(url.pathname)
    const forbidden = url.origin !== config.frontendOrigin && !tileUrl(request.url)
      || url.pathname.startsWith('/api/') && request.method !== 'GET' && !allowedAuth
      || url.pathname.startsWith('/internal/')
      || tileUrl(request.url) && (request.method !== 'GET' || request.hasPostData)
    if (forbidden) { report.forbiddenRequests++; void cdp.send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }).catch(() => {}); return }
    if (fault === 'hold' && tileUrl(request.url)) { heldTiles.push(requestId); return }
    if (fault === 'fail' && tileUrl(request.url)) { report.tileFailures++; if (params.networkId) intentionalNetworkIds.add(params.networkId); void cdp.send('Fetch.failRequest', { requestId, errorReason: 'InternetDisconnected' }).catch(() => {}); return }
    void cdp.send('Fetch.continueRequest', { requestId }).catch(() => {})
  })
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Network.enable')
  // Request interception is only a business-write guard and an explicit tile
  // network-failure test. No response fulfilment and no cache override.
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] })
}
async function field(selector, value) {
  check(await cdp.evaluate('(()=>{const e=document.querySelector(' + JSON.stringify(selector) + ');if(!e)return false;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,' + JSON.stringify(value) + ');e.dispatchEvent(new Event("input",{bubbles:true}));e.dispatchEvent(new Event("change",{bubbles:true}));return true})()'), 'QA_LOGIN_FIELD_MISSING')
}
async function api(path, method = 'GET') {
  check(method === 'GET' || path === '/api/auth/logout' && method === 'POST', 'QA_STAFF_MUTATION_REFUSED')
  return cdp.evaluate('(async()=>{const r=await fetch(' + JSON.stringify(path) + ',{method:' + JSON.stringify(method) + ',credentials:"same-origin",headers:{Accept:"application/json"' + (method === 'POST' ? ',"Content-Type":"application/json"' : '') + '}' + (method === 'POST' ? ',body:"{}"' : '') + '});return {status:r.status,data:await r.json()}})()')
}
async function releaseTiles() {
  fault = null
  for (const requestId of heldTiles.splice(0)) {
    try { await cdp.send('Fetch.continueRequest', { requestId }) }
    catch { /* React StrictMode may already have cancelled its first mount. */ }
  }
}
async function openMap() {
  await cdp.until('!!document.querySelector("[data-staff-branch-id]")')
  const opened = await cdp.evaluate('(()=>{const map=document.querySelector("[data-staff-map]");const button=[...map.querySelectorAll("button")].find(e=>/mở/i.test(e.textContent));if(button){button.click();return true}return !!map.querySelector(".leaflet-container")})()')
  check(opened, 'QA_MAP_OPEN_CONTROL_MISSING')
}
const loadedTiles = '[...document.querySelectorAll(".staff-branch-map-canvas img.leaflet-tile")].filter(e=>e.complete&&e.naturalWidth>0).length'
const pendingTiles = '[...document.querySelectorAll(".staff-branch-map-canvas img.leaflet-tile")].filter(e=>!e.complete||e.naturalWidth===0).length'
async function ready({ allowPartial = false, recover = true } = {}) {
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    const current = await cdp.evaluate('({state:document.querySelector("[data-staff-map]")?.getAttribute("data-staff-map"),loaded:' + loadedTiles + ',pending:' + pendingTiles + '})')
    if (current.state === 'ready' && current.loaded > 0 && current.pending === 0) return
    if (current.state === 'error') {
      if (!recover && allowPartial) return false
      const retries = report.networkRecoveryRetries?.length || 0
      if (fault || retries >= 2) {
        if (allowPartial && report.externalTilesBlocked) return false
        throw Error('QA_REAL_TILE_NETWORK_ERROR_AFTER_BOUNDED_RETRY')
      }
      // Two explicit user retries at most across the entire suite. Successful
      // tiles remain in the native browser cache. No URL or cache bypass.
      report.networkRecoveryRetries = [...(report.networkRecoveryRetries || []), { attempt: retries + 1, loadedTiles: current.loaded, pendingTiles: current.pending }]
      const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' }), filename = 'tile-network-error-' + (retries + 1) + '.png'
      await writeFile(join(artifacts, filename), Buffer.from(screenshot.data, 'base64')); report.screenshots.push(filename)
      check(await cdp.evaluate('(()=>{const button=[...document.querySelectorAll("[data-staff-map] button")].find(e=>/lại/i.test(e.textContent));if(!button)return false;button.click();return true})()'), 'QA_MAP_RETRY_CONTROL_MISSING')
      await wait(800)
    } else await wait(120)
  }
  throw Error('QA_REAL_MAP_NOT_FULLY_LOADED')
}

// Read the active grid's native tile zoom, not a test-only exposed map object.
// Leaflet keeps old zoom levels briefly during animation; the active level has
// the highest z-index. The stable-view wait below excludes those animations.
const mapViewExpression = String.raw`(()=>{
  const map=document.querySelector('.staff-branch-map-canvas'),pane=map?.querySelector('.leaflet-map-pane'),marker=map?.querySelector('[data-staff-branch-marker]');
  const levels=[...map.querySelectorAll('.leaflet-tile-container')].sort((a,b)=>Number(b.style.zIndex)-Number(a.style.zIndex));
  const image=levels.find(e=>e.querySelector('img.leaflet-tile'))?.querySelector('img.leaflet-tile');
  const match=image&&new URL(image.currentSrc||image.src).pathname.match(/^\/(\d+)\//);
  const r=map.getBoundingClientRect(),m=marker?.getBoundingClientRect();
  return {zoom:match?Number(match[1]):null,pane:pane?.style.transform,rect:{left:r.left,top:r.top,width:r.width,height:r.height},marker:m?{left:m.left,top:m.top}:null,
    markerCount:map.querySelectorAll('[data-staff-branch-marker]').length,polygonCount:map.querySelectorAll('.staff-service-area-boundary').length,
    latitude:marker?.getAttribute('data-latitude'),longitude:marker?.getAttribute('data-longitude'),
    animating:map.classList.contains('leaflet-zoom-anim')||!!map.querySelector('.leaflet-pan-anim')||document.body.classList.contains('leaflet-dragging')};
})()`
async function stableView() {
  let previous, unchanged = 0
  const deadline = Date.now() + 12000
  while (Date.now() < deadline) {
    const view = await cdp.evaluate(mapViewExpression), fingerprint = JSON.stringify(view)
    unchanged = !view.animating && view.zoom !== null && fingerprint === previous ? unchanged + 1 : 0
    if (unchanged >= 5) return view
    previous = fingerprint; await wait(100)
  }
  throw Error('QA_MAP_VISUAL_VIEW_DID_NOT_SETTLE')
}
function sameGeometry(before, after) {
  check(after.markerCount === before.markerCount && after.polygonCount === before.polygonCount
    && after.latitude === before.latitude && after.longitude === before.longitude, 'QA_INTERACTION_CHANGED_BRANCH_GEOMETRY')
}
async function coverage(stage) {
  const complete = await ready({ allowPartial: true, recover: false })
  report.tileCoverage.push({ stage, complete: complete !== false,
    ...await cdp.evaluate('({loaded:' + loadedTiles + ',pending:' + pendingTiles + ',state:document.querySelector("[data-staff-map]")?.getAttribute("data-staff-map")})') })
  return complete !== false
}
async function pointerClick(selector) {
  const position = await cdp.evaluate('(()=>{const e=document.querySelector(' + JSON.stringify(selector) + ');if(!e)return null;const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,disabled:e.classList.contains("leaflet-disabled")}})()')
  check(position && !position.disabled, 'QA_MAP_ZOOM_CONTROL_MISSING_OR_DISABLED')
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: position.x, y: position.y, buttons: 0 })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: position.x, y: position.y, button: 'left', buttons: 1, clickCount: 1 })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: position.x, y: position.y, button: 'left', buttons: 0, clickCount: 1 })
}
async function zoomAction(name, action, direction) {
  await cdp.evaluate('document.querySelector("[data-staff-map]").scrollIntoView({block:"center"})')
  const before = await stableView()
  await action()
  await cdp.until('(' + mapViewExpression + ').zoom===' + (before.zoom + direction), 12000)
  const after = await stableView()
  check(after.zoom === before.zoom + direction, 'QA_MAP_ZOOM_DID_NOT_CHANGE_' + name)
  sameGeometry(before, after)
  const tilesComplete = await coverage(name)
  report.interactions.push({ name, beforeZoom: before.zoom, afterZoom: after.zoom, markerCount: after.markerCount, polygonCount: after.polygonCount, tilesComplete, status: 'REAL_PASS' })
}
async function zoomKey(key, code, windowsVirtualKeyCode) {
  await cdp.evaluate('document.querySelector(".staff-branch-map-canvas").focus({preventScroll:true})')
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode, text: key, unmodifiedText: key, location: 3, isKeypad: true })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode, location: 3, isKeypad: true })
}
async function pointerDrag(name, dx, dy) {
  await cdp.evaluate('document.querySelector("[data-staff-map]").scrollIntoView({block:"center"})')
  const before = await stableView(), x = before.rect.left + before.rect.width * 0.65, y = before.rect.top + before.rect.height * 0.45
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 })
  for (let index = 1; index <= 12; index++) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + dx * index / 12, y: y + dy * index / 12, button: 'left', buttons: 1 })
    await wait(18)
  }
  // A short hold before release avoids a fling; this tests pointer dragging
  // itself and keeps the next responsive checks at a predictable location.
  await wait(160)
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + dx, y: y + dy, button: 'left', buttons: 0, clickCount: 1 })
  const after = await stableView()
  sameGeometry(before, after)
  check(after.zoom === before.zoom && after.pane !== before.pane && after.marker && before.marker
    && Math.hypot(after.marker.left - before.marker.left, after.marker.top - before.marker.top) > 20, 'QA_NATIVE_POINTER_DRAG_DID_NOT_PAN_MAP')
  const tilesComplete = await coverage(name)
  report.interactions.push({ name, zoom: after.zoom, markerDelta: { x: after.marker.left - before.marker.left, y: after.marker.top - before.marker.top }, markerCount: after.markerCount, polygonCount: after.polygonCount, tilesComplete, status: 'REAL_PASS' })
}

if (process.env.RUN_STAFF_ISOLATED_MAPS_QA !== 'true') {
  console.log(JSON.stringify({ status: 'NOT_RUN', reason: 'Set RUN_STAFF_ISOLATED_MAPS_QA=true after refreshing the isolated QA frontend; this suite never seeds or writes MySQL' })); process.exit(0)
}
const watchdog = setTimeout(() => { try { cdp?.socket.close() } catch {} if (chrome?.exitCode === null) chrome.kill() }, 300000); watchdog.unref()
try {
  config = await loadConfig()
  check(config.frontendOrigin === 'http://localhost:3102', 'QA_MAPS_EXPECTED_STABLE_STAFF_3102')
  artifacts = join(privateDirectory, 'reports/maps-browser-' + new Date().toISOString().replace(/[:.]/g, '-')); await mkdir(artifacts, { recursive: true })
  report.origin = config.frontendOrigin; report.syntheticBranchFromIsolatedQA = true
  await step('Real isolated Auth, Order and Staff readiness before browser login', async () => {
    for (const name of ['auth', 'order', 'staff']) {
      let status = 'UNREACHABLE'
      try { const response = await fetch(config[name + 'Origin'] + '/health/ready', { signal: AbortSignal.timeout(5000), redirect: 'error' }); status = response.status; await response.body?.cancel() } catch {}
      report.services = { ...report.services, [name]: status }; check(status === 200, 'QA_' + name.toUpperCase() + '_NOT_READY')
    }
  })
  await step('Chrome isolated profile, live network, write and external-data guard', startChrome)
  let branch, availabilityIds
  await step('Real QA A login and branch from Staff BFF, no tile prefetch', async () => {
    await cdp.navigate('/dang-nhap?next=%2Fkhu-vuc'); await cdp.until('!!document.querySelector("input[name=phone]")')
    await field('input[name=phone]', config.accounts.A.phone); await field('input[name=password]', config.accounts.A.password)
    await cdp.evaluate('document.querySelector("form").requestSubmit()')
    await cdp.until('location.pathname==="/khu-vuc"&&!!document.querySelector("[data-staff-branch-id]")')
    const response = await api('/api/staff/branch'); check(response.status === 200 && response.data.data.id === config.accounts.A.branchId, 'QA_BRANCH_API_ID_MISMATCH'); branch = response.data.data
    check(Number.isFinite(Number(branch.latitude)) && Number.isFinite(Number(branch.longitude)) && branch.name && branch.addressText, 'QA_BRANCH_COORDINATE_OR_POPUP_DATA_MISSING')
    check(report.tileRequests === 0, 'QA_TILES_PREFETCHED_BEFORE_MAP_OPEN')
    check(await cdp.evaluate('!document.querySelector("[data-staff-areas-readonly]")&&!document.querySelector("script[src*=\\"maps.googleapis.com\\"]")'), 'QA_REMOVED_BANNER_OR_GOOGLE_SCRIPT_PRESENT')
    await cdp.until('document.querySelector("[data-staff-areas-remote]")?.getAttribute("data-staff-areas-remote")==="ready"&&!!document.querySelector("[data-staff-availability-count]")')
    availabilityIds = await cdp.evaluate('[...document.querySelectorAll("[data-staff-availability-id]")].map(e=>e.getAttribute("data-staff-availability-id")).sort()')
  })
  await step('Leaflet renders real OpenStreetMap tiles and visible attribution', async () => {
    fault = 'hold'; await openMap()
    await cdp.until('document.querySelector("[data-staff-map]")?.getAttribute("data-staff-map")==="loading"&&!!document.querySelector("[data-staff-map] [role=status]")')
    await releaseTiles(); await ready()
    check(await cdp.evaluate('(()=>{const e=document.querySelector(".staff-branch-map-canvas");const a=e.querySelector(".leaflet-control-attribution");return e.classList.contains("leaflet-container")&&e.getBoundingClientRect().height>=240&&a?.textContent.includes("OpenStreetMap")&&!!a.querySelector("a[href=\\"https://www.openstreetmap.org/copyright\\"]")})()'), 'QA_LEAFLET_TILE_ATTRIBUTION_MISSING')
    check(report.tileResponses.some(row => row.status === 200 && /^image\//.test(row.mimeType)), 'QA_NO_REAL_SUCCESSFUL_OSM_TILE_RESPONSE')
    check(report.tileRefererPresent === true, 'QA_OSM_REFERER_MISSING')
    await cdp.evaluate('document.querySelector("[data-staff-map]").scrollIntoView({block:"center"})')
    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' }); await writeFile(join(artifacts, 'initial-ready.png'), Buffer.from(screenshot.data, 'base64')); report.screenshots.push('initial-ready.png')
  })
  await step('Branch marker keyboard popup matches real name and address, GeoJSON overlays', async () => {
    check(await cdp.evaluate('(()=>{const a=document.querySelector(".staff-branch-map-canvas .leaflet-control-attribution");return a?.textContent.includes("© OpenStreetMap contributors")&&!!a.querySelector("a[href=\\"https://www.openstreetmap.org/copyright\\"]")})()'), 'QA_MAP_ATTRIBUTION_MISSING')
    const marker = '.staff-branch-map-canvas .leaflet-marker-icon'
    await cdp.until('!!document.querySelector(' + JSON.stringify(marker) + ')')
    check(await cdp.evaluate('(()=>{const e=document.querySelector(' + JSON.stringify(marker) + ');e.focus();return document.activeElement===e&&e.tabIndex>=0&&Number(e.getAttribute("data-latitude"))===' + Number(branch.latitude) + '&&Number(e.getAttribute("data-longitude"))===' + Number(branch.longitude) + '})()'), 'QA_MARKER_NOT_KEYBOARD_FOCUSABLE_OR_COORDINATES_DIFFER')
    failedAt = 'Branch marker: native Enter opens popup'
    // Enter produces a carriage-return keypress in Chrome. Leaflet 1.9 listens
    // for this native keypress on a marker; keyDown without text omits it.
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' }); await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
    await cdp.until('!!document.querySelector(".leaflet-popup-content")')
    check(await cdp.evaluate('(()=>{const e=document.querySelector(".leaflet-popup-content");return e.textContent.includes(' + JSON.stringify(branch.name) + ')&&e.textContent.includes(' + JSON.stringify(branch.addressText) + ')})()'), 'QA_BRANCH_POPUP_DIFFERS_FROM_BFF')
    const input = branch.serviceArea, geometries = input?.type === 'FeatureCollection' ? input.features?.map(row => row.geometry) : [input?.type === 'Feature' ? input.geometry : input]
    const hasPolygon = geometries?.some(geometry => ['Polygon', 'MultiPolygon'].includes(geometry?.type))
    const paths = await cdp.evaluate('document.querySelectorAll(".staff-branch-map-canvas .staff-service-area-boundary").length')
    check(!hasPolygon || paths > 0, 'QA_BFF_GEOJSON_POLYGON_NOT_RENDERED')
    report.geometry = { bffType: input?.type || null, polygonsAvailable: !!hasPolygon, renderedPaths: paths }
    failedAt = 'Branch marker: Escape closes popup while marker has focus'
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await cdp.until('!document.querySelector(".leaflet-popup-content")')
  })
  await step('Map zoom in and out controls change real tile zoom and preserve geometry', async () => {
    await zoomAction('pointer-zoom-in', () => pointerClick('.leaflet-control-zoom-in'), 1)
    await zoomAction('pointer-zoom-out', () => pointerClick('.leaflet-control-zoom-out'), -1)
  })
  await step('Map native plus and minus keys change real tile zoom and preserve geometry', async () => {
    await zoomAction('keyboard-plus', () => zoomKey('+', 'NumpadAdd', 107), 1)
    await zoomAction('keyboard-minus', () => zoomKey('-', 'NumpadSubtract', 109), -1)
  })
  await step('Map native pointer dragging pans marker and polygon without changing branch data', async () => {
    await pointerDrag('pointer-drag', 64, 32)
    await pointerDrag('pointer-drag-return', -64, -32)
  })
  await step('Map keyboard navigation and calendar remain read only', async () => {
    check(await cdp.evaluate('(()=>{const e=document.querySelector(".staff-branch-map-canvas");e.focus();return e.tabIndex>=0&&document.activeElement===e&&!!e.getAttribute("aria-label")})()'), 'QA_MAP_REGION_KEYBOARD_OR_LABEL_MISSING')
    const beforePan = await cdp.evaluate('document.querySelector(".leaflet-map-pane").style.transform')
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 }); await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 })
    await stableView(); await coverage('keyboard-arrow-pan')
    check(await cdp.evaluate('document.querySelector(".leaflet-map-pane").style.transform!==' + JSON.stringify(beforePan)), 'QA_KEYBOARD_ARROW_DID_NOT_PAN_MAP')
    const after = await cdp.evaluate('[...document.querySelectorAll("[data-staff-availability-id]")].map(e=>e.getAttribute("data-staff-availability-id")).sort()')
    check(JSON.stringify(after) === JSON.stringify(availabilityIds), 'QA_MAP_CHANGED_AVAILABILITY')
    check(report.forbiddenRequests === 0, 'QA_BUSINESS_WRITE_OR_EXTERNAL_DATA_REQUESTED')
  })
  await step('Real map responsive 375/390/768/1440 without horizontal overflow', async () => {
    for (const width of [375, 390, 768, 1440]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false }); await stableView(); const tilesFullyLoaded = await coverage('viewport-' + width)
      const layout = await cdp.evaluate('(()=>{const e=document.querySelector(".staff-branch-map-canvas"),r=e.getBoundingClientRect();const controls=[...e.querySelectorAll("a,button,[role=button]")].filter(n=>n.checkVisibility({checkVisibilityCSS:true,checkOpacity:true}));return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth,mapWidth:r.width,mapHeight:r.height,mapLeft:r.left,mapRight:r.right,loadedTiles:' + loadedTiles + ',unnamed:controls.filter(n=>!n.textContent&&!n.getAttribute("aria-label")&&!n.getAttribute("title")&&!n.getAttribute("alt")).length}})()')
      check(layout.scrollWidth <= width + 1 && layout.mapLeft >= 0 && layout.mapRight <= width + 1 && layout.mapWidth > 200 && layout.mapHeight >= 240 && layout.unnamed === 0, 'QA_MAP_LAYOUT_OR_A11Y_INVALID_' + width)
      report.layouts.push({ ...layout, tilesFullyLoaded: tilesFullyLoaded !== false, status: 'REAL_PASS' })
      await cdp.evaluate('document.querySelector("[data-staff-map]").scrollIntoView({block:"center"})')
      const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' }), filename = 'leaflet-' + width + '.png'
      await writeFile(join(artifacts, filename), Buffer.from(screenshot.data, 'base64')); report.screenshots.push(filename)
    }
  })
  await step('Live tiles after zoom, dragging and responsive resize are complete', async () => {
    if (report.tileCoverage.some(row => !row.complete)) throw Error('QA_REAL_MAP_NOT_FULLY_LOADED')
  })
  await step('Real tile network error shows alert and retry recovers live map', async () => {
    fault = 'fail'
    await cdp.navigate('/khu-vuc'); await openMap()
    await cdp.until('document.querySelector("[data-staff-map]")?.getAttribute("data-staff-map")==="error"&&!!document.querySelector("[data-staff-map] [role=alert]")')
    check(report.tileFailures > 0, 'QA_TILE_FAULT_NOT_EXERCISED')
    fault = null
    check(await cdp.evaluate('(()=>{const button=[...document.querySelectorAll("[data-staff-map] button")].find(e=>/lại/i.test(e.textContent));if(!button)return false;button.click();return true})()'), 'QA_MAP_RETRY_CONTROL_MISSING')
    await ready()
  })
  await step('No Google requests, business writes, booking data exports or runtime exceptions', async () => {
    check(report.forbiddenRequests === 0 && report.exceptions === 0, 'QA_MAP_RUNTIME_OR_DATA_BOUNDARY_FAILED')
    check(report.tileRequests > 0 && report.tileRequests < 200, 'QA_TILE_REQUESTS_UNEXPECTEDLY_UNBOUNDED')
    const logout = await api('/api/auth/logout', 'POST'); check(logout.status === 200, 'QA_LOGOUT_FAILED')
  })
} catch (error) {
  report.failedAt = failedAt; report.error = /^[A-Z0-9_]+$/.test(error.message || '') ? error.message : 'QA_MAPS_TEST_FAILED_DETAILS_WITHHELD'; process.exitCode = 1
  try {
    report.lastPage = await cdp?.evaluate('({path:location.pathname,mapState:document.querySelector("[data-staff-map]")?.getAttribute("data-staff-map"),leaflet:!!document.querySelector(".leaflet-container"),loadedTiles:' + loadedTiles + ',markers:document.querySelectorAll(".leaflet-marker-icon").length,overlays:document.querySelectorAll(".leaflet-overlay-pane path").length,mapAlert:document.querySelector("[role=alert]")?.textContent?.slice(0,300)})')
    if (report.lastPage?.mapAlert) report.lastPage.mapAlert = redact(report.lastPage.mapAlert)
    const screenshot = await cdp?.send('Page.captureScreenshot', { format: 'png' })
    if (screenshot && artifacts) { await writeFile(join(artifacts, 'failure.png'), Buffer.from(screenshot.data, 'base64')); report.screenshots.push('failure.png') }
  } catch {}
} finally {
  clearTimeout(watchdog); await releaseTiles()
  try { if (cdp) await api('/api/auth/logout', 'POST') } catch {}
  try { await cdp?.send('Browser.close') } catch {}
  // Let Chrome flush its normal disk cache and close its temporary profile.
  for (let attempt = 0; chrome?.exitCode === null && attempt < 30; attempt++) await wait(100)
  if (chrome?.exitCode === null) chrome.kill()
  if (profile) {
    const target = resolve(profile), temporary = resolve(tmpdir())
    if (dirname(target) === temporary && basename(target).startsWith('cleanhome-staff-leaflet-qa-chrome-')) {
      try { await rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); report.profileClosed = true } catch { report.profileClosed = false }
    }
  }
  report.pass = report.checks.filter(row => row.status === 'REAL_PASS').length; report.blocked = report.checks.filter(row => row.status === 'BLOCKED').length; report.fail = report.error ? 1 : 0
  if (report.blocked && !report.fail) process.exitCode = 2
  if (artifacts) await writeFile(join(artifacts, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ pass: report.pass, fail: report.fail, blocked: report.blocked, failedAt: report.failedAt, error: report.error, layouts: report.layouts.length, tileRequests: report.tileRequests, realTileResponses: report.tileResponses.filter(row => row.status === 200).length, report: artifacts && join(artifacts, 'report.json') }))
}
