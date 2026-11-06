import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
const require = createRequire(import.meta.url), ts = require('typescript'), React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const root = new URL('../../../packages/ui/src/components/staff/', import.meta.url)
function render(environment, demoEnabled, auth) {
  const cache = new Map()
  function source(name) {
    if (cache.has(name)) return cache.get(name)
    const module = { exports: {} }, filename = new URL(name, root)
    const code = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
    vm.runInNewContext(code, { module, exports: module.exports, AbortController, DOMException, process: { env: { NODE_ENV: environment } }, fetch() { throw Error('Support UI must not call an unapproved API') }, require(id) {
      if (id === './staff-auth-session') return { useStaffAuth: () => auth }
      if (id === './staff-support-demo-adapter') return source('staff-support-demo-adapter.ts')
      if (id === './staff-support-demo-model') return source('staff-support-demo-model.ts')
      if (id === './staff-support-knowledge') return source('staff-support-knowledge.tsx')
      if (id === './staff-support-chat') return source('staff-support-chat.tsx')
      if (id === './staff-support-assistant') return source('staff-support-assistant.tsx')
      if (id === './staff-support-questions.mjs') return source('staff-support-questions.mjs')
      if (id === './staff-support-search') return source('staff-support-search.ts')
      if (id === './staff-support-conversation.mjs') return source('staff-support-conversation.mjs')
      if (id === './staff-support-widget-context') return source('staff-support-widget-context.tsx')
      if (id === './staff-shared') return {
        StaffPageHeader: ({ title, description, action }) => React.createElement('header', null, React.createElement('h1', null, title), React.createElement('p', null, description), action),
        StaffEmpty: ({ title, description, action }) => React.createElement('section', null, React.createElement('h2', null, title), React.createElement('p', null, description), action),
      }
      if (id === 'lucide-react') return new Proxy({}, { get: () => props => React.createElement('svg', props) })
      if (id === '@/components/ui/card') return { Card: props => React.createElement('section', props), CardContent: props => React.createElement('div', props) }
      if (id === '@/components/ui/button') return { Button: ({ variant, nativeButton, render, children, ...props }) => render ? React.cloneElement(render, props, children) : React.createElement('button', props, children) }
      if (id === '@/components/ui/dialog') return { Dialog: () => null, DialogContent: () => null, DialogHeader: () => null, DialogTitle: () => null, DialogDescription: () => null, DialogClose: () => null }
      if (id === '@/components/ui/skeleton') return { Skeleton: props => React.createElement('div', props) }
      if (id === '@/components/shared/area-routes') return { AreaLink: props => React.createElement('a', props) }
      return require(id)
    } }, { filename: filename.pathname, timeout: 2000 })
    cache.set(name, module.exports); return module.exports
  }
  return renderToStaticMarkup(React.createElement(source('staff-support.tsx').StaffSupport, { demoEnabled }))
}
const auth = { status: 'authenticated', busy: null, checkSession: async () => {}, session: { user: { id: '9007199254740919', role: 'EMPLOYEE', status: 'ACTIVE' } } }

test('support UI hides all demo content when demo is disabled or production', () => {
  for (const [environment, enabled] of [['development', false], ['production', true], ['test', true], ['', true]]) {
    const html = render(environment, enabled, auth)
    assert.match(html, /Hỗ trợ/)
    assert.match(html, /Yêu cầu hỗ trợ chưa khả dụng/)
    assert.match(html, /Chức năng gửi yêu cầu trực tiếp chưa được cung cấp/)
    assert.doesNotMatch(html, /DỮ LIỆU MINH HỌA|DEMO-SUP-|data-staff-support="demo"|Đang tải yêu cầu hỗ trợ minh họa|REAL_E2E_NOT_RUN/)
  }
})

test('support UI hides content during logout and absent unknown or invalid authentication', () => {
  for (const value of [null, { ...auth, status: 'loading' }, { ...auth, status: 'unavailable' }, { ...auth, status: 'unauthenticated' }, { ...auth, session: null }, { ...auth, busy: 'logout' }]) assert.equal(render('development', true, value), '')
  const invalidActor = { ...auth, session: { user: { ...auth.session.user, id: '' } } }
  assert.match(render('development', true, invalidActor), /Yêu cầu hỗ trợ chưa khả dụng/)
  assert.doesNotMatch(render('development', true, invalidActor), /DỮ LIỆU MINH HỌA|DEMO-SUP-/)
})

test('authenticated development UI labels illustrative support and loading honestly', () => {
  const html = render('development', true, auth)
  assert.match(html, /DỮ LIỆU MINH HỌA/)
  assert.match(html, /F5/)
  assert.match(html, /tài khoản/i)
  assert.match(html, /data-staff-support="demo"/)
  assert.match(html, /Đang tải yêu cầu hỗ trợ minh họa/)
  assert.match(html, /aria-busy="true"/)
  assert.doesNotMatch(html, /\/api\/|localStorage|sessionStorage|DEMO-SUP-001|@/)
})

test('support UI never projects Auth personal data into the page shell', () => {
  const value = { ...auth, session: { user: { ...auth.session.user, name: 'UNIT_PRIVATE_QA_NAME', email: 'private-qa@example.invalid', phone: 'UNIT_PRIVATE_PHONE', accessToken: 'UNIT_PRIVATE_TOKEN' } } }
  const before = JSON.stringify(value), html = render('development', true, value)
  assert.doesNotMatch(html, /UNIT_PRIVATE_|private-qa@example|9007199254740919/)
  assert.equal(JSON.stringify(value), before)
})

// A small hook runner exercises asynchronous handlers and their resulting UI;
// no browser, real provider, session store or private data is used here.
function assistantHarness({ readinessStatus = 200, freeText = false, maxTurns = 10 } = {}) {
  const slots = [], effects = [], cache = new Map()
  let cursor = 0, tree, checks = 0, postStatus = 200, posts = 0, turns = 0, clears = 0
  const fakeReact = { ...React,
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next }] },
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index] },
    useId() { return 'unit-support-' + cursor++ },
    useEffect(operation, dependencies) { const index = cursor++, prior = slots[index]; if (!prior || dependencies.some((value, i) => value !== prior[i])) { slots[index] = dependencies; effects.push(operation) } },
  }
  const props = { accountScope: '101', checkSession: async () => { checks++ } }
  function source(name) {
    if (cache.has(name)) return cache.get(name)
    const module = { exports: {} }
    const code = ts.transpileModule(readFileSync(new URL(name, root), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
    vm.runInNewContext(code, { module, exports: module.exports, AbortController, AbortSignal, Promise, TextDecoder, TextEncoder, crypto: { randomUUID: () => String(Math.random()) }, window: { setTimeout, clearTimeout },
      async fetch(_url, init) {
        if (init.method === 'DELETE') { clears++; turns = 0; return Response.json({ok:true}) }
        const status = init.method === 'POST' ? postStatus : readinessStatus
        if (init.method === 'POST') posts++
        return status === 200 ? Response.json(init.method === 'POST'
          ? freeText ? {mode:'free-text',answer:'UNIT_PRIOR_ASSISTANT_REPLY',conversationId:'12345678-1234-4123-8123-123456789abc',turnCount:++turns,maxTurns,policyVersion:'general-conversation-v1'} : { answer: 'UNIT_PRIOR_ASSISTANT_REPLY', questionId: 'jobs', policyVersion: 'general-guidance-v2' }
          : { available: true, mode: 'fixed-questions', policyVersion: 'general-guidance-v2',freeText:{available:freeText,maxTurns,policyVersion:'general-conversation-v1'} }) : new Response('Unauthorized response does not need JSON', { status })
      }, require(id) {
        if (id === 'react') return fakeReact
        if (id === './staff-support-questions.mjs') return source('staff-support-questions.mjs')
        if (id === './staff-support-search') return source('staff-support-search.ts')
        if (id === './staff-support-conversation.mjs') return source('staff-support-conversation.mjs')
        if (id === '@/components/ui/button') return { Button: ({ variant, ...buttonProps }) => React.createElement('button', buttonProps) }
        return require(id)
      } }, { timeout: 2000 })
    cache.set(name, module.exports); return module.exports
  }
  const Component = source('staff-support-assistant.tsx').StaffSupportAssistant
  const render = () => { cursor = 0; tree = Component(props); return renderToStaticMarkup(tree) }
  const find = (node, predicate) => { if (!node || typeof node !== 'object') return null; if (predicate(node)) return node; for (const child of React.Children.toArray(node.props?.children)) { const found = find(child, predicate); if (found) return found } return null }
  return {
    async mount() { render(); for (const effect of effects.splice(0)) effect(); await new Promise(resolve => setImmediate(resolve)); return render() },
    chooseJobs() { const input = find(tree, node => node.props?.['data-staff-chat-input']); if (input.props.disabled) return; input.props.onChange({ target: { value: 'Tôi xem công việc được phân công ở đâu?' } }); render(); find(tree, node => node.props?.['data-staff-chat-option'] === 'jobs').props.onClick(); render() },
    async send(status) { postStatus = status; this.chooseJobs(); const form = find(tree, node => node.type === 'form'); form.props.onSubmit({ preventDefault() {} }); await new Promise(resolve => setImmediate(resolve)); return render() },
    async newConversation() { const button=find(tree,node=>node.props?.['data-staff-chat-new']!==undefined); assert.ok(button);button.props.onClick();await new Promise(resolve=>setImmediate(resolve));return render() },
    render, checks: () => checks, posts: () => posts, clears:()=>clears,
    sendDisabled: () => find(tree, node => node.props?.type === 'submit').props.disabled,
  }
}

test('assistant clears transcript, disables sends and checks session on POST 401/403/409', async () => {
  for (const status of [401, 403, 409]) {
    const ui = assistantHarness()
    await ui.mount(); ui.chooseJobs(); assert.equal(ui.sendDisabled(), false)
    assert.match(await ui.send(200), /UNIT_PRIOR_ASSISTANT_REPLY/)
    const denied = await ui.send(status)
    assert.doesNotMatch(denied, /UNIT_PRIOR_ASSISTANT_REPLY/)
    assert.match(denied, /data-support-chat-state="unauthorized"/)
    assert.equal(ui.sendDisabled(), true); assert.equal(ui.checks(), 1)
    await ui.send(200); assert.equal(ui.posts(), 2, 'unauthorized state must prevent another request')
  }
})

test('assistant readiness 401/403 checks session and keeps sending disabled', async () => {
  for (const status of [401, 403]) {
    const ui = assistantHarness({ readinessStatus: status }), html = await ui.mount()
    assert.match(html, /data-support-chat-state="unauthorized"/)
    assert.equal(ui.sendDisabled(), true); assert.equal(ui.checks(), 1); assert.equal(ui.posts(), 0)
  }
})
test('assistant uses the BFF 30-turn QA limit, offers a new conversation and does not POST turn 31',async()=>{
  const ui=assistantHarness({freeText:true,maxTurns:30});assert.match(await ui.mount(),/Hội thoại AI · 0\/30 lượt/)
  for(let i=0;i<30;i++)assert.match(await ui.send(200),new RegExp(`Hội thoại AI · ${i+1}/30 lượt`))
  assert.match(ui.render(),/Đã đạt giới hạn 30 lượt/);assert.match(ui.render(),/Bắt đầu cuộc trò chuyện mới/);await ui.send(200);assert.equal(ui.posts(),30)
  const cleared=await ui.newConversation();assert.match(cleared,/Hội thoại AI · 0\/30 lượt/);assert.doesNotMatch(cleared,/UNIT_PRIOR_ASSISTANT_REPLY/);assert.equal(ui.clears(),1)
})
test('assistant retains the BFF production limit of 10 and never assumes the QA allowance',async()=>{
  const ui=assistantHarness({freeText:true,maxTurns:10});assert.match(await ui.mount(),/Hội thoại AI · 0\/10 lượt/);for(let i=0;i<10;i++)await ui.send(200);assert.match(ui.render(),/Đã đạt giới hạn 10 lượt/);await ui.send(200);assert.equal(ui.posts(),10)
})
