import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
const require = createRequire(import.meta.url), ts = require('typescript'), React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const root = new URL('../../../packages/ui/src/components/staff/', import.meta.url)
const query = { from: '2026-11-01', to: '2026-11-30', rating: null, page: 1, pageSize: 10 }
function render(state) {
  const states = [query, { ...query, rating: '' }, '', state, 0]
  const fakeReact = { ...React, useState: () => [states.shift(), () => {}], useEffect: () => {} }
  const cache = new Map()
  function source(name) {
    if (cache.has(name)) return cache.get(name)
    const module = { exports: {} }
    const code = ts.transpileModule(readFileSync(new URL(name, root), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
    vm.runInNewContext(code, { module, exports: module.exports, URLSearchParams, TextDecoder, Uint8Array, AbortController, fetch() { throw Error('No API access during static rendering') }, require(id) {
      if (id === 'react') return fakeReact
      if (id === './staff-work-statistics-model') return { defaultStaffStatisticsRange: () => query }
      if (id.startsWith('./staff-')) return source(id.slice(2) + (id.endsWith('.mjs') ? '' : '.ts'))
      if (id === '@/components/ui/card') return { Card: props => React.createElement('section', props), CardContent: props => React.createElement('div', props) }
      if (id === '@/components/ui/button') return { Button: ({ variant, ...props }) => React.createElement('button', props) }
      return require(id)
    } }, { timeout: 2000 })
    cache.set(name, module.exports); return module.exports
  }
  return renderToStaticMarkup(React.createElement(source('staff-reviews-remote.tsx').StaffReviewsSection, { accountScope: '101', checkSession: () => {} }))
}
test('review loading, unavailable, empty and retry states are honest and accessible', () => {
  const loading = render(null); assert.match(loading, /aria-busy="true"/); assert.doesNotMatch(loading, /Chưa có dữ liệu đánh giá/)
  const unavailable = render({ error: '', unavailable: true }); assert.match(unavailable, /Chưa có dữ liệu đánh giá/); assert.match(unavailable, /Thử tải đánh giá lại/); assert.doesNotMatch(unavailable, /0 \/ 5 sao/)
  assert.match(unavailable,/data-staff-reviews-state="unavailable"/);assert.match(unavailable,/<button[^>]+disabled=""[^>]*>Lọc đánh giá/);assert.match(unavailable,/Chức năng đánh giá hiện chưa được cung cấp/)
  const failure = render({ error: 'Tài khoản không có quyền xem đánh giá.' }); assert.match(failure, /role="alert"/); assert.match(failure, /không có quyền/)
  const empty = render({ data: { data: [], summary: { total: 0, average: null, distribution: {} }, pagination: { page: 1, totalPages: 0 } } })
  assert.match(empty, /Chưa đủ dữ liệu tính điểm trung bình/); assert.doesNotMatch(empty, /Trung bình 0/)
})
test('API review comments render as escaped text and show true distribution without badges', () => {
  const html = render({ data: { data: [{ id: 'unit-review', rating: 5, createdAt: '2026-11-05T02:00:00.000Z', comment: '<script>alert(1)</script>', serviceLabel: 'Dọn nhà' }], summary: { total: 1, average: 5, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 1 } }, pagination: { page: 1, totalPages: 1 } } })
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/); assert.doesNotMatch(html, /<script>|DEMO-REV|DEMO-BADGE/)
  assert.match(html, /Trung bình 5 \/ 5 sao/); assert.match(html, /aria-label="5 sao: 1 đánh giá"/)
  assert.match(html, /Huy hiệu và mục tiêu chính thức đang chờ quy chế phê duyệt/); assert.match(html, /Số sao/)
})
