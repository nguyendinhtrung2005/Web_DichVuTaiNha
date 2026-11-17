import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'

const require = createRequire(import.meta.url), ts = require('typescript')
const root = new URL('../../../packages/ui/src/components/staff/', import.meta.url)
function source(name, context = {}) {
  const module = { exports: {} }
  const code = ts.transpileModule(readFileSync(new URL(name, root), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  vm.runInNewContext(code, { module, exports: module.exports, URL, Set, ...context }, { timeout: 2000 })
  return module.exports
}
const model = source('staff-maps-model.ts')
const triangle = { type: 'Polygon', coordinates: [[[106, 10], [107, 10], [107, 11], [106, 10]]] }
const config = { tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', maxZoom: 19, providerName: null, providerUrl: null }
const settle = () => new Promise(resolve => setImmediate(resolve))

test('Maps accepts standard GeoJSON wrappers and strips every feature property', () => {
  const geometry = model.servicePolygon({ type: 'FeatureCollection', features: [
    { type: 'Feature', geometry: triangle, properties: { privateCustomer: 'DO_NOT_FORWARD' } },
    { type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: [triangle.coordinates] } },
  ] })
  assert.equal(geometry.type, 'MultiPolygon')
  assert.equal(geometry.coordinates.length, 2)
  assert.equal(JSON.stringify(geometry).includes('DO_NOT_FORWARD'), false)
  geometry.coordinates[0][0][0][0] = 0
  assert.equal(triangle.coordinates[0][0][0], 106)
  assert.equal(model.servicePolygon({ type: 'Feature', geometry: triangle }).type, 'Polygon')
})

test('Maps rejects malformed, degenerate, excessive and mixed service boundaries', () => {
  for (const value of [
    { type: 'Polygon', coordinates: [[[0, 0], [0, 0], [0, 0], [0, 0]]] },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [106, 10] } },
    { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: triangle }, { type: 'Feature', geometry: null }] },
    { type: 'FeatureCollection', features: Array.from({ length: 9 }, () => ({ type: 'Feature', geometry: triangle })) },
    { type: 'Polygon', coordinates: [Array.from({ length: 1001 }, () => [106, 10])] },
    { districts: ['A', 'B'] },
  ]) assert.equal(model.servicePolygon(value), null)
})

test('Leaflet loader refuses SSR without loading the DOM-dependent library', async () => {
  let imports = 0
  const loader = source('staff-maps-loader.ts', { require() { imports++; throw Error('SSR must not import Leaflet') } })
  await assert.rejects(loader.loadStaffMaps(), /MAP_BROWSER_REQUIRED/)
  assert.equal(imports, 0)
})

test('Leaflet loader shares the on-demand browser import and retries an import failure', async () => {
  let imports = 0, fail = true
  const sdk = { map() {} }
  const loader = source('staff-maps-loader.ts', { window: {}, require(id) {
    assert.equal(id, 'leaflet'); imports++
    if (fail) throw Error('network chunk unavailable')
    return sdk
  } })
  const first = loader.loadStaffMaps(), second = loader.loadStaffMaps()
  assert.equal(first, second)
  await assert.rejects(first, /MAP_LIBRARY_UNAVAILABLE/)
  assert.equal(imports, 1)
  fail = false
  assert.equal(await loader.loadStaffMaps(), sdk)
  assert.equal(await loader.loadStaffMaps(), sdk)
  assert.equal(imports, 2)
})

const escapeHtml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.listeners = new Map(); this.focusCount = 0 }
  set textContent(value) { this.children = [String(value)] }
  get textContent() { return this.children.map(child => typeof child === 'string' ? child : child.textContent).join('') }
  append(...values) { this.children.push(...values) }
  setAttribute(name, value) { this.attrs[name] = value }
  addEventListener(name, callback, capture) { const entries = this.listeners.get(name) || []; entries.push({ callback, capture }); this.listeners.set(name, entries) }
  removeEventListener(name, callback, capture) { this.listeners.set(name, (this.listeners.get(name) || []).filter(entry => entry.callback !== callback || entry.capture !== capture)) }
  dispatchEvent(event) { for (const { callback } of this.listeners.get(event.type) || []) callback(event) }
  focus(options) { this.focusCount++; this.focusOptions = options; Element.activeElement = this }
  querySelector(selector) {
    for (const child of this.children) if (child instanceof Element) {
      if ((selector.startsWith('.') && child.className?.split(' ').includes(selector.slice(1))) ||
        (selector.startsWith('[') && selector.slice(1, -1) in child.attrs)) return child
      const descendant = child.querySelector(selector)
      if (descendant) return descendant
    }
    return null
  }
  get innerHTML() {
    return this.children.map(child => typeof child === 'string' ? escapeHtml(child) : `<${child.tag}${child.href ? ` href="${escapeHtml(child.href)}"` : ''}>${child.innerHTML}</${child.tag}>`).join('')
  }
}

function componentFixture(overrides = {}) {
  const effects = [], calls = [], timers = new Map(), tiles = [], markerNodes = []
  const target = new Element('div')
  let timerId = 0, stateIndex = 0, resolveSdk, rejectSdk
  const sdkPromise = new Promise((resolve, reject) => { resolveSdk = resolve; rejectSdk = reject })
  const host = {
    setTimeout(callback) { const id = ++timerId; timers.set(id, callback); return id },
    clearTimeout(id) { timers.delete(id) }, matchMedia() { return { matches: false } },
  }
  const control = kind => options => ({ addTo(map) { calls.push(['control', kind, options, map]); return this } })
  const sdk = {
    map(node, options) {
      calls.push(['map', node, options])
      return { initialized: false, pendingMarkers: [], container: node,
        initializeView() { this.initialized = true; for (const marker of this.pendingMarkers.splice(0)) marker.attach() },
        closePopup() { calls.push(['closePopup']); node.children = node.children.filter(child => child.className !== 'leaflet-popup') },
        remove() { calls.push(['remove']) }, fitBounds(bounds, options) { calls.push(['fit', bounds.points, options]); this.initializeView() },
        setView(point, zoom) { calls.push(['view', point, zoom]); this.initializeView() }, invalidateSize(options) { calls.push(['resize', options]) } }
    },
    control: { zoom: control('zoom'), attribution: control('attribution') },
    latLngBounds() { return { points: [], extend(point) { this.points.push(point); return this } } },
    divIcon(options) { calls.push(['icon', options]); return options },
    marker(point, options) {
      calls.push(['marker', point, options])
      return { element: undefined, handlers: new Map(),
        bindPopup(content, popupOptions) { calls.push(['popup', content, popupOptions]); return this },
        on(name, callback) { this.handlers.set(name, callback); return this },
        attach() { this.element = new Element('div'); markerNodes.push(this.element); this.map.container.append(this.element); calls.push(['marker-added']); this.handlers.get('add')?.() },
        addTo(map) { calls.push(['marker-addTo', !!this.element]); this.map = map; if (map.initialized) this.attach(); else map.pendingMarkers.push(this); return this },
        getElement() { calls.push(['marker-getElement', !!this.element]); return this.element },
      }
    },
    geoJSON(geometry, options) {
      calls.push(['geojson', geometry, options])
      return { addTo() { return this }, getBounds() { return { geometry } } }
    },
    tileLayer(url, options) {
      calls.push(['tiles', url, options])
      const layer = { handlers: new Map(), on(name, callback) { this.handlers.set(name, callback); return this }, addTo() { return this } }
      tiles.push(layer); return layer
    },
  }
  const states = [true, 'idle', 0]
  const component = source('staff-branch-map.tsx', {
    window: host, document: { createElement(tag) { return new Element(tag) } },
    ResizeObserver: class { observe() { calls.push(['observe']) } disconnect() { calls.push(['disconnect']) } },
    require(id) {
      if (id === 'react') return {
        useEffect(callback) { effects.push(callback) }, useRef() { return { current: target } }, useId() { return 'map-instructions' },
        useState(initial) { const index = stateIndex++; return [index < states.length ? states[index] : initial, value => { states[index] = typeof value === 'function' ? value(states[index]) : value; calls.push(['state', states[index]]) }] },
      }
      if (id === 'leaflet/dist/leaflet.css') return {}
      if (id === './staff-maps-model') return model
      if (id === './staff-maps-loader') return { loadStaffMaps() { calls.push(['load']); return sdkPromise } }
      if (id === '@/components/ui/card') return { Card() {}, CardContent() {} }
      if (id === '@/components/ui/button') return { Button() {} }
      return require(id)
    },
  }).StaffBranchMap
  const props = { config, latitude: '10.75', longitude: '106.5', branchName: 'Assigned branch', branchAddress: 'Branch address', serviceArea: { type: 'Feature', geometry: triangle, properties: { bookingSecret: 'DO_NOT_FORWARD' } }, ...overrides }
  let cleanup
  function render() { stateIndex = 0; const tree = component(props); cleanup = effects.at(-1)(); return tree }
  render()
  return { calls, tiles, timers, markerNodes, states, target,
    cleanup() { cleanup?.() },
    retry() { cleanup?.(); states[2]++; return render() },
    resolveSdk() { resolveSdk(sdk) }, rejectSdk() { rejectSdk(Error('network chunk unavailable')) },
    emit(name, index = tiles.length - 1) { tiles[index].handlers.get(name)?.() },
    openPopup() { const popup = new Element('div'); popup.className = 'leaflet-popup'; target.append(popup) },
    key(key) {
      const event = { type: 'keydown', key, target: Element.activeElement, defaultPrevented: false, propagationStopped: false,
        preventDefault() { this.defaultPrevented = true }, stopPropagation() { this.propagationStopped = true } }
      target.dispatchEvent(event); return event
    },
    timeout() { const [id, callback] = timers.entries().next().value; timers.delete(id); callback() },
  }
}

test('map places the exact BFF point and safe popup text, renders only sanitized geometry, and waits for tiles', async () => {
  const f = componentFixture({ branchName: '<img src=x onerror=bad()>', branchAddress: 'Branch <script>bad</script>' })
  f.resolveSdk(); await settle()
  assert.deepEqual(Array.from(f.calls.find(call => call[0] === 'marker')[1]), [10.75, 106.5])
  const popup = f.calls.find(call => call[0] === 'popup')[1]
  assert.match(popup.innerHTML, /&lt;img/)
  assert.match(popup.innerHTML, /&lt;script&gt;/)
  assert.doesNotMatch(popup.innerHTML, /<img|<script/)
  assert.equal(f.markerNodes[0].attrs['data-latitude'], '10.75')
  const geometry = f.calls.find(call => call[0] === 'geojson')[1]
  assert.equal(geometry.type, 'Polygon')
  assert.equal(JSON.stringify(geometry).includes('DO_NOT_FORWARD'), false)
  assert.equal(f.calls.find(call => call[0] === 'fit')[1].length, 2)
  const [, url, options] = f.calls.find(call => call[0] === 'tiles')
  assert.equal(url, config.tileUrl)
  assert.match(options.attribution, /© .*OpenStreetMap contributors/)
  assert.equal(options.referrerPolicy, 'strict-origin-when-cross-origin')
  assert.equal(options.keepBuffer, 0)
  assert.equal(f.states[1], 'loading')
  f.emit('tileload'); f.emit('load')
  assert.equal(f.states[1], 'ready')
  assert.equal(f.timers.size, 0)
  f.cleanup()
  assert.ok(f.calls.some(call => call[0] === 'remove'))
  assert.ok(f.calls.some(call => call[0] === 'disconnect'))
})

test('valid MultiPolygon can render without branch coordinates and never invents a marker', async () => {
  const f = componentFixture({ latitude: null, longitude: null, serviceArea: { type: 'MultiPolygon', coordinates: [triangle.coordinates] } })
  f.resolveSdk(); await settle()
  assert.equal(f.calls.some(call => call[0] === 'marker'), false)
  assert.equal(f.calls.find(call => call[0] === 'geojson')[1].type, 'MultiPolygon')
  assert.ok(f.calls.some(call => call[0] === 'fit'))
  f.cleanup()
})

test('marker accessibility and exact coordinates are applied after Leaflet creates its icon on initial view', async () => {
  for (const serviceArea of [triangle, null]) {
    const f = componentFixture({ serviceArea })
    f.resolveSdk(); await settle()
    assert.equal(f.calls.find(call => call[0] === 'marker-addTo')[1], false, 'Leaflet has no icon when the layer is queued before its first view')
    const view = f.calls.findIndex(call => call[0] === (serviceArea ? 'fit' : 'view'))
    const add = f.calls.findIndex(call => call[0] === 'marker-added')
    const decorate = f.calls.findIndex(call => call[0] === 'marker-getElement')
    assert.ok(view >= 0 && add > view && decorate > add)
    assert.equal(f.calls[decorate][1], true)
    assert.equal(f.markerNodes[0].attrs['aria-label'], 'Xem chi nhánh Assigned branch')
    assert.equal(f.markerNodes[0].attrs['data-staff-branch-marker'], 'true')
    assert.equal(f.markerNodes[0].attrs['data-latitude'], '10.75')
    assert.equal(f.markerNodes[0].attrs['data-longitude'], '106.5')
    f.cleanup()
  }
})

test('Escape closes a popup while its marker has focus and releases the capture listener on unmount', async () => {
  const f = componentFixture(); f.resolveSdk(); await settle()
  const marker = f.markerNodes[0]
  marker.focus(); f.openPopup()
  assert.equal(f.target.listeners.get('keydown')[0].capture, true)
  const enter = f.key('Enter')
  assert.equal(enter.defaultPrevented, false)
  assert.ok(f.target.querySelector('.leaflet-popup'))
  assert.equal(f.calls.some(call => call[0] === 'closePopup'), false)
  const escape = f.key('Escape')
  assert.equal(escape.defaultPrevented, true)
  assert.equal(escape.propagationStopped, true)
  assert.equal(f.target.querySelector('.leaflet-popup'), null)
  assert.equal(f.calls.filter(call => call[0] === 'closePopup').length, 1)
  assert.equal(Element.activeElement, marker)
  assert.equal(marker.focusCount, 2)
  assert.equal(marker.focusOptions.preventScroll, true)
  assert.equal(f.key('Escape').defaultPrevented, false, 'Escape is untouched when no map popup is open')
  f.cleanup()
  assert.equal(f.target.listeners.get('keydown').length, 0)
  f.openPopup(); f.key('Escape')
  assert.equal(f.calls.filter(call => call[0] === 'closePopup').length, 1)
})

test('missing or malformed branch and area data never initializes a default map', async () => {
  for (const serviceArea of [null, { districts: ['A', 'B'] }]) {
    const f = componentFixture({ latitude: null, longitude: null, serviceArea })
    f.resolveSdk(); await settle()
    assert.equal(f.calls.some(call => call[0] === 'load'), false)
    assert.equal(f.calls.some(call => call[0] === 'map'), false)
    f.cleanup()
  }
})

test('library load failure and tile failure remain errors until retry succeeds with real tile completion', async () => {
  const failedImport = componentFixture(); failedImport.rejectSdk(); await settle()
  assert.equal(failedImport.states[1], 'error')
  assert.equal(failedImport.timers.size, 0)
  failedImport.cleanup()
  const f = componentFixture(); f.resolveSdk(); await settle()
  f.emit('tileerror'); f.emit('tileload'); f.emit('load')
  assert.equal(f.states[1], 'error')
  f.retry(); await settle()
  assert.equal(f.calls.filter(call => call[0] === 'map').length, 2)
  assert.equal(f.calls.filter(call => call[0] === 'remove').length, 1)
  assert.equal(f.states[1], 'loading')
  f.emit('tileload'); f.emit('load')
  assert.equal(f.states[1], 'ready')
  f.cleanup()
})

test('timeout before library completion stays failed, and unmount never creates a late map', async () => {
  const timeout = componentFixture(); timeout.timeout()
  assert.equal(timeout.states[1], 'error')
  timeout.resolveSdk(); await settle()
  assert.equal(timeout.calls.some(call => call[0] === 'map'), false)
  timeout.cleanup()
  const unmounted = componentFixture(); unmounted.cleanup()
  const before = unmounted.calls.length
  unmounted.resolveSdk(); await settle()
  assert.equal(unmounted.calls.length, before)
  assert.equal(unmounted.timers.size, 0)
})
