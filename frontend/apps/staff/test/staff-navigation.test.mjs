import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const require = createRequire(import.meta.url), ts = require('typescript')
const root = new URL('../../../packages/ui/src/components/', import.meta.url), cache = new Map()
function source(relative) {
  if (cache.has(relative)) return cache.get(relative)
  const filename = fileURLToPath(new URL(relative, root)), module = { exports: {} }
  cache.set(relative, module.exports)
  const output = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  vm.runInNewContext(output, { module, exports: module.exports, URL, require(id) {
    if (id === '@/components/shared/route-policy') return source('shared/route-policy.ts')
    if (id === '@/components/staff/staff-route-policy') return source('staff/staff-route-policy.ts')
    return require(id)
  } }, { filename, timeout: 2000 })
  return module.exports
}
const { STAFF_NAVIGATION, staffNavigationActive } = source('staff/staff-navigation.ts')
const { validStaffPath } = source('staff/staff-route-policy.ts')
const { staffLoginReturnTo } = source('staff/staff-login-route.ts')
const { validAreaPath } = source('shared/route-policy.ts')

test('settings is the final distinct sidebar destination while mobile keeps its five original slots', () => {
  const { STAFF_SECONDARY_NAVIGATION, STAFF_FOOTER_NAVIGATION, staffSidebarNavigationActive } = source('staff/staff-navigation.ts')
  const sidebar = [...STAFF_NAVIGATION, ...STAFF_SECONDARY_NAVIGATION, ...STAFF_FOOTER_NAVIGATION]
  assert.equal(sidebar.at(-1).href, '/cai-dat')
  assert.equal(sidebar.at(-1).label, 'Cài đặt')
  assert.deepEqual(sidebar.filter(item => staffSidebarNavigationActive(item.href, 'cai-dat')).map(item => item.href), ['/cai-dat'])
  assert.equal(STAFF_NAVIGATION.length, 5)
  assert.equal(staffNavigationActive('/ho-so', 'cai-dat'), true)
})

test('navigation exposes exactly the five approved destinations without unread counters', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(STAFF_NAVIGATION.map(x => [x.href, x.label]))), [
    ['/', 'Tổng quan'], ['/cong-viec', 'Công việc'], ['/lich-lam-viec', 'Lịch'], ['/thong-bao', 'Thông báo'], ['/ho-so', 'Cá nhân'],
  ])
  assert.equal(new Set(STAFF_NAVIGATION.map(x => x.href)).size, 5)
  assert.ok(STAFF_NAVIGATION.every(x => !('count' in x) && !('unread' in x)))
})
test('all original Staff catch-all routes remain accepted', () => {
  for (const path of [[], ['dang-nhap'], ['dang-ky'], ['cong-viec'], ['lich-lam-viec'], ['ho-so'], ['don', '9223372036854775807']]) assert.equal(validStaffPath(Object.freeze(path)), true)
})
test('notification route is Staff-only and does not allow arbitrary child routes', () => {
  assert.equal(validStaffPath(['thong-bao']), true)
  assert.equal(validAreaPath('customer', ['thong-bao']), false)
  assert.equal(validAreaPath('admin', ['thong-bao']), false)
  for (const path of [['thong-bao', '1'], ['cong-viec', '1'], ['not-a-route'], ['don'], ['don', '1', 'edit'], ['..'], [''], ['thong-bao/extra'], ['thong-bao%2fextra']]) assert.equal(validStaffPath(path), false)
})
test('exactly one destination is active, with assignment detail grouped under jobs', () => {
  for (const [route, href] of [['', '/'], ['cong-viec', '/cong-viec'], ['don', '/cong-viec'], ['lich-lam-viec', '/lich-lam-viec'], ['thong-bao', '/thong-bao'], ['ho-so', '/ho-so'], ['lich-su', '/ho-so'], ['ho-tro', '/ho-so'], ['cai-dat', '/ho-so'], ['thong-ke-cong-viec', '/ho-so']]) {
    assert.deepEqual(JSON.parse(JSON.stringify(STAFF_NAVIGATION.filter(x => staffNavigationActive(x.href, route)).map(x => x.href))), [href])
  }
  for (const route of ['dang-nhap', 'dang-ky', 'unknown']) assert.equal(STAFF_NAVIGATION.some(x => staffNavigationActive(x.href, route)), false)
})
test('new and existing deep links preserve safe query and hash values', () => {
  for (const path of ['/thong-bao', '/thong-bao?view=all#update', '/cong-viec?page=2&status=DONE', '/don/9223372036854775807?from=calendar#status', '/lich-lam-viec?mode=week', '/ho-so', '/lich-su?page=2&pageSize=2&sort=desc', '/ho-tro', '/cai-dat', '/thong-ke-cong-viec?from=2026-10-01&to=2026-10-31']) assert.equal(staffLoginReturnTo(path), path)
})
test('new destination retains all existing open-redirect and encoding guards', () => {
  for (const path of ['https://outside.invalid', '//outside.invalid', '/\\outside.invalid', '/thong-bao/../ho-so', '/thong-bao/%2e%2e', '/thong-bao%252fextra', '/thong-bao%2fextra', '/thong-bao//', '/thong-bao/1', '/dang-nhap?next=/thong-bao', '/dang-ky', '/%2e%2e/thong-bao', '/thong-bao\n']) assert.equal(staffLoginReturnTo(path), '/')
})

test('history extension preserves shared policy and rejects children/redirect escapes', () => {
  assert.equal(validStaffPath(['lich-su']), true)
  assert.equal(validAreaPath('staff', ['lich-su']), false)
  assert.equal(validAreaPath('customer', ['lich-su']), true)
  assert.equal(validAreaPath('admin', ['lich-su']), false)
  for (const path of [['lich-su', '1'], ['lich-su/extra'], ['lich-su%2fextra']]) assert.equal(validStaffPath(path), false)
  for (const path of ['/lich-su/1', '/lich-su/../ho-so', '//outside.invalid/lich-su', '/lich-su%252fextra']) assert.equal(staffLoginReturnTo(path), '/')
})

test('support and settings remain exact Staff-only destinations with safe login return', () => {
  for (const route of ['ho-tro', 'cai-dat']) {
    assert.equal(validStaffPath([route]), true)
    assert.equal(validAreaPath('customer', [route]), false)
    assert.equal(validAreaPath('admin', [route]), false)
    assert.equal(validStaffPath([route, 'edit']), false)
    for (const path of ['/' + route + '/edit', '/' + route + '/../ho-so', '/' + route + '%252fextra', '//' + route]) assert.equal(staffLoginReturnTo(path), '/')
  }
})

test('work statistics remains Staff-only with safe date deep links', () => {
  const route = 'thong-ke-cong-viec'
  assert.equal(validStaffPath([route]), true)
  for (const area of ['staff', 'customer', 'admin']) assert.equal(validAreaPath(area, [route]), false)
  assert.equal(validStaffPath([route, '1']), false)
  for (const path of ['/' + route + '/edit', '/' + route + '/../ho-so', '/' + route + '%252fextra', '//' + route]) assert.equal(staffLoginReturnTo(path), '/')
})

test('income is an exact Staff route with safe deep links and separate desktop navigation', () => {
  const { STAFF_SECONDARY_NAVIGATION, staffSidebarNavigationActive } = source('staff/staff-navigation.ts')
  assert.equal(validStaffPath(['thu-nhap']), true)
  for (const area of ['staff', 'customer', 'admin']) assert.equal(validAreaPath(area, ['thu-nhap']), false)
  for (const path of [['thu-nhap', 'entry'], ['thu-nhap/extra'], ['thu-nhap%2fextra']]) assert.equal(validStaffPath(path), false)
  const query = '/thu-nhap?from=2026-10-01&to=2026-10-31&granularity=day&source=WORK&status=PAID'
  assert.equal(staffLoginReturnTo(query), query)
  for (const path of ['/thu-nhap/entry', '/thu-nhap/../ho-so', '/thu-nhap%252fextra', '//outside.invalid/thu-nhap']) assert.equal(staffLoginReturnTo(path), '/')
  assert.deepEqual(JSON.parse(JSON.stringify(STAFF_NAVIGATION.filter(x => staffNavigationActive(x.href, 'thu-nhap')).map(x => x.href))), ['/ho-so'])
  const sidebar = [...STAFF_NAVIGATION, ...STAFF_SECONDARY_NAVIGATION]
  assert.deepEqual(JSON.parse(JSON.stringify(sidebar.filter(x => staffSidebarNavigationActive(x.href, 'thu-nhap')).map(x => x.href))), ['/thu-nhap'])
  for (const route of ['', 'cong-viec', 'don', 'lich-lam-viec', 'thong-bao', 'ho-so']) assert.equal(sidebar.filter(x => staffSidebarNavigationActive(x.href, route)).length, 1)
})

test('areas is Staff-only with safe return links and one active sidebar/mobile destination', () => {
  const { STAFF_SECONDARY_NAVIGATION, staffSidebarNavigationActive } = source('staff/staff-navigation.ts')
  assert.equal(validStaffPath(['khu-vuc']), true)
  for (const area of ['staff', 'customer', 'admin']) assert.equal(validAreaPath(area, ['khu-vuc']), false)
  for (const p of [['khu-vuc', 'shift'], ['khu-vuc/extra'], ['khu-vuc%2fextra']]) assert.equal(validStaffPath(p), false)
  assert.equal(staffLoginReturnTo('/khu-vuc?view=week#calendar'), '/khu-vuc?view=week#calendar')
  for (const p of ['/khu-vuc/shift', '/khu-vuc/../ho-so', '//outside.invalid/khu-vuc', '/khu-vuc%252fextra']) assert.equal(staffLoginReturnTo(p), '/')
  assert.deepEqual(JSON.parse(JSON.stringify(STAFF_NAVIGATION.filter(x => staffNavigationActive(x.href, 'khu-vuc')).map(x => x.href))), ['/ho-so'])
  const sidebar = [...STAFF_NAVIGATION, ...STAFF_SECONDARY_NAVIGATION]
  assert.deepEqual(JSON.parse(JSON.stringify(sidebar.filter(x => staffSidebarNavigationActive(x.href, 'khu-vuc')).map(x => x.href))), ['/khu-vuc'])
  assert.equal(STAFF_NAVIGATION.length, 5)
})

test('achievements is Staff-only with safe return links and one active sidebar/mobile destination', () => {
  const { STAFF_SECONDARY_NAVIGATION, staffSidebarNavigationActive } = source('staff/staff-navigation.ts')
  assert.equal(validStaffPath(['thanh-tich']), true)
  for (const area of ['staff', 'customer', 'admin']) assert.equal(validAreaPath(area, ['thanh-tich']), false)
  for (const p of [['thanh-tich', 'review'], ['thanh-tich/extra'], ['thanh-tich%2fextra']]) assert.equal(validStaffPath(p), false)
  const query = '/thanh-tich?stars=5&from=2026-10-01&to=2026-10-31'
  assert.equal(staffLoginReturnTo(query), query)
  for (const p of ['/thanh-tich/review', '/thanh-tich/../ho-so', '//outside.invalid/thanh-tich', '/thanh-tich%252fextra']) assert.equal(staffLoginReturnTo(p), '/')
  assert.deepEqual(JSON.parse(JSON.stringify(STAFF_NAVIGATION.filter(x => staffNavigationActive(x.href, 'thanh-tich')).map(x => x.href))), ['/ho-so'])
  const sidebar = [...STAFF_NAVIGATION, ...STAFF_SECONDARY_NAVIGATION]
  assert.deepEqual(JSON.parse(JSON.stringify(sidebar.filter(x => staffSidebarNavigationActive(x.href, 'thanh-tich')).map(x => x.href))), ['/thanh-tich'])
  assert.equal(STAFF_NAVIGATION.length, 5)
})
