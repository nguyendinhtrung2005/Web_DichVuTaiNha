import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { loadConfig, privateDirectory } from './common.mjs'
import { STAFF_USAGE_HELP } from '../../frontend/packages/ui/src/components/staff/staff-support-questions.mjs'

// Real browser -> real BFF -> operator-configured provider. No mock responses.
// This runner never loads the AI key or copies it to Chrome. Six inference calls
// maximum with --all-faq, otherwise one smoke FAQ. --remaining-faq verifies the
// other five with account B after a successful smoke. --read-only never calls AI.
// Stop on the first failure, no retries; only a confirmed local 429 is extra.
if (process.env.RUN_STAFF_ISOLATED_SUPPORT_LIVE_QA !== 'true') { console.log(JSON.stringify({ status: 'NOT_RUN', reason: 'Explicit live QA opt-in required' })); process.exit(0) }
const check = (value, code) => { if (!value) throw Error(code) }, wait = ms => new Promise(done => setTimeout(done, ms))
const readOnly = process.argv.includes('--read-only'), allFaq = process.argv.includes('--all-faq'), remainingFaq = process.argv.includes('--remaining-faq')
const conversationQa = process.argv.includes('--conversation')
const freeQuestions=[{id:'free-greeting',question:'xin'},{id:'free-followup',question:'Tôi vừa nhắn từ gì? Chỉ nhắc lại từ đó.'}]
const selectedQuestions = readOnly ? [] : conversationQa ? freeQuestions : remainingFaq ? STAFF_USAGE_HELP.slice(1) : allFaq ? STAFF_USAGE_HELP : STAFF_USAGE_HELP.slice(0, 1)
const report = { mockedResponses: false, scope: readOnly ? 'UI_ONLY' : remainingFaq ? 'REMAINING_FIVE_FAQ' : allFaq ? 'SIX_FAQ' : 'SINGLE_FAQ_SMOKE', inferenceBudget: selectedQuestions.length, checks: [], faq: [], realAI: 'NOT_RUN', providerFailures: [], unexpectedBrowserErrors: 0 }
let config, browser, profile, cdp, artifacts, calls = 0, lastAt = 0
class CDP {
  constructor(socket) {
    this.socket = socket; this.sequence = 0; this.pending = new Map()
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data)
      if (message.method === 'Runtime.exceptionThrown') report.unexpectedBrowserErrors++
      if (!message.id) return
      const item = this.pending.get(message.id); if (!item) return
      clearTimeout(item.timer); this.pending.delete(message.id); message.error ? item.reject(Error('QA_CDP_REJECTED')) : item.done(message.result)
    })
  }
  send(method, params = {}) { const id = ++this.sequence; return new Promise((done, reject) => { const timer = setTimeout(() => { this.pending.delete(id); reject(Error('QA_CDP_TIMEOUT')) }, 25000); this.pending.set(id, { done, reject, timer }); this.socket.send(JSON.stringify({ id, method, params })) }) }
  async evaluate(expression) { const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); check(!r.exceptionDetails, 'QA_BROWSER_EXPRESSION_FAILED'); return r.result.value }
  async until(expression, timeout = 30000) { const until = Date.now() + timeout; while (Date.now() < until) { if (await this.evaluate(expression)) return; await wait(60) } throw Error('QA_BROWSER_TIMEOUT') }
  async navigate(path) { const before = await this.evaluate('performance.timeOrigin'); await this.send('Page.navigate', { url: config.frontendOrigin + path }); await this.until('performance.timeOrigin!==' + JSON.stringify(before) + '&&location.pathname===' + JSON.stringify(path.split('?')[0]) + '&&document.readyState==="complete"') }
}
function observe(origin, ids, texts) {
  if (location.origin !== origin) return
  const original = window.fetch.bind(window), qa = window.__qaSupportLive = { permit: false, replies: [], forbidden: 0 }
  const unsafe = text => /gsk_[A-Za-z0-9_-]{16,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}|"(?:apiKey|accessToken|refreshToken|password|cookie)"\s*:/i.test(text)
  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url, location.href), method = (init.method || input.method || 'GET').toUpperCase()
    const chat = url.origin === origin && url.pathname === '/api/staff/support/chat'
    if (url.origin !== origin || method !== 'GET' && !(method === 'POST' && ['/api/auth/login','/api/auth/logout','/api/staff/support/chat'].includes(url.pathname)) && !(method==='DELETE'&&chat)) { qa.forbidden++; throw Error('QA_REQUEST_SCOPE_BLOCKED') }
    if (chat && method === 'POST') {
      let body; try { body = JSON.parse(init.body) } catch {}
      const fixed=body&&Object.keys(body).length===1&&ids.includes(body.questionId),free=body?.mode==='free-text'&&Object.keys(body).every(key=>['mode','message','conversationId'].includes(key))&&texts.includes(body.message)
      if (!qa.permit || !fixed&&!free) { qa.forbidden++; throw Error('QA_EXTRA_OR_PRIVATE_PROMPT_BLOCKED') }
      qa.permit = false
      const started = performance.now(), response = await original(input, init)
      let data; try { data = await response.clone().json() } catch {}
      const serialized = JSON.stringify(data), code = data?.error?.code
      qa.replies.push({ status: response.status, code: typeof code === 'string' && /^[A-Z_]{1,80}$/.test(code) ? code : undefined, durationMs: Math.round(performance.now()-started),
        questionId: body.questionId, freeText:free,turnCount:data?.turnCount,contextReused:free&&Boolean(body.conversationId), answerLength: typeof data?.answer === 'string' ? data.answer.length : 0, responseMatches: free?data?.mode==='free-text':data?.questionId === body.questionId,
        followupRecognized:free&&body.message===texts.at(-1)?typeof data?.answer==='string'&&/\bxin\b/i.test(data.answer):undefined,
        publicKeysOnly: !!data && Object.keys(data).every(key => ['mode','conversationId','turnCount','maxTurns','answer','questionId','createdAt','policyVersion','error','requestId'].includes(key)), secretDetected: unsafe(serialized || ''),
        vietnamese: typeof data?.answer === 'string' && /[àáảãạăằắẳẵặâầấẩẫậđèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵ]/i.test(data.answer) })
      return response
    }
    return original(input, init)
  }
}
async function startChrome() {
  const executable = process.env.STAFF_QA_CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'; await access(executable)
  profile = await mkdtemp(join(tmpdir(), 'cleanhome-staff-support-live-'))
  // Deliberately exclude every AI environment variable from the browser process.
  const env = Object.fromEntries(['PATH','Path','SystemRoot','ComSpec','TEMP','TMP','USERPROFILE','LOCALAPPDATA','APPDATA','WINDIR'].filter(name=>process.env[name]).map(name=>[name,process.env[name]]))
  browser = spawn(executable, ['--headless=new','--no-first-run','--no-default-browser-check','--disable-extensions','--disable-background-networking','--disable-sync','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0','--user-data-dir='+profile,'--window-size=1440,1000','about:blank'], { windowsHide: true, stdio: 'ignore', env })
  let port; for (let i=0;i<150;i++) { try {port=Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);if(port)break}catch{} await wait(100) }
  check(port,'QA_CHROME_START_FAILED'); const pages=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json(), socket=new WebSocket(pages.find(page=>page.type==='page').webSocketDebuggerUrl)
  await new Promise((done,reject)=>{socket.addEventListener('open',done,{once:true});socket.addEventListener('error',()=>reject(Error('QA_CHROME_CONNECTION_FAILED')),{once:true})});cdp=new CDP(socket)
  await cdp.send('Page.enable');await cdp.send('Runtime.enable')
  await cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:'('+observe.toString()+')('+JSON.stringify(config.frontendOrigin)+','+JSON.stringify(STAFF_USAGE_HELP.map(q=>q.id))+','+JSON.stringify([...STAFF_USAGE_HELP.map(q=>q.question),...freeQuestions.map(q=>q.question)])+')'})
}
async function input(selector,value,select=false){await cdp.evaluate('(()=>{const e=document.querySelector('+JSON.stringify(selector)+');Object.getOwnPropertyDescriptor(e.tagName==="TEXTAREA"?HTMLTextAreaElement.prototype:'+(select?'HTMLSelectElement':'HTMLInputElement')+'.prototype,"value").set.call(e,'+JSON.stringify(value)+');e.dispatchEvent(new Event('+(select?'"change"':'"input"')+',{bubbles:true}));return true})()')}
async function login(label){await cdp.navigate('/dang-nhap?next=%2Fho-tro');await cdp.until('!!document.querySelector("input[name=phone]")');await input('[name=phone]',config.accounts[label].phone);await input('[name=password]',config.accounts[label].password);await cdp.evaluate('document.querySelector("form").requestSubmit();true');await cdp.until('location.pathname==="/ho-tro"&&!!document.querySelector("[data-staff-chat-launcher]")');await cdp.evaluate('document.querySelector("[data-staff-chat-launcher]").click();true');await cdp.until(readOnly?'["ready","unavailable"].includes(document.querySelector("[data-support-chat-state]")?.dataset.supportChatState)':'document.querySelector("[data-support-chat-state]")?.dataset.supportChatState==="ready"')}
async function logout(){await cdp.evaluate('(async()=>{await fetch("/api/auth/logout",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});return true})()')}
async function ask(questionId, rateProbe=false){
  check(calls<report.inferenceBudget,'QA_INFERENCE_BUDGET_EXHAUSTED');calls++;await input('[data-staff-chat-input]',[...STAFF_USAGE_HELP,...freeQuestions].find(question=>question.id===questionId).question)
  if(!conversationQa){await cdp.until('!!document.querySelector("[data-staff-chat-option='+questionId+']")');await cdp.evaluate('document.querySelector("[data-staff-chat-option='+questionId+']").click();true')}
  const before=await cdp.evaluate('window.__qaSupportLive.replies.length');await cdp.evaluate('window.__qaSupportLive.permit=true;document.querySelector(".staff-chat-composer").requestSubmit();true')
  let loading=false;try{await cdp.until('document.querySelector("[data-support-chat-state]")?.dataset.supportChatState==="sending"',1200);loading=true}catch{}
  await cdp.until('window.__qaSupportLive.replies.length>'+before,22000)
  const result=await cdp.evaluate('window.__qaSupportLive.replies.at(-1)');result.loadingObserved=loading
  if(rateProbe&&result.status===429)calls--
  check(!result.secretDetected&&result.publicKeysOnly,'QA_SECRET_OR_PRIVATE_DTO_EXPOSED')
  if(!rateProbe&&result.status===200){check(result.responseMatches&&result.answerLength>0&&result.answerLength<=4000&&(result.vietnamese||questionId==='free-followup'&&result.followupRecognized),'QA_ANSWER_INVALID');await cdp.until('document.querySelector("[data-support-chat-state]")?.dataset.supportChatState==="ready"')}
  return result
}
const watchdog=setTimeout(()=>{try{cdp?.socket.close()}catch{}if(browser?.exitCode===null)browser.kill()},240000);watchdog.unref()
try{
  config=await loadConfig();check(config.frontendOrigin==='http://localhost:3102','QA_WRONG_FRONTEND_ORIGIN');artifacts=join(privateDirectory,'reports/support-live-'+new Date().toISOString().replace(/[:.]/g,'-'));await mkdir(artifacts,{recursive:true})
  for(const [headers,expected] of [[{},401],[{Origin:'https://foreign.invalid'},403]]){const response=await fetch(config.frontendOrigin+'/api/staff/support/chat',{headers,signal:AbortSignal.timeout(10000)});check(response.status===expected,'QA_AUTH_OR_ORIGIN_GUARD_FAILED');await response.body?.cancel();report.checks.push({name:'BFF access '+expected,status:'REAL_PASS'})}
  await startChrome();await login(remainingFaq?'B':'A');lastAt=Date.now()
  check(await cdp.evaluate('document.querySelectorAll(".staff-support-knowledge details").length===6&&document.querySelectorAll("[data-staff-chat-panel]").length===1'),'QA_FAQ_OR_SINGLE_WIDGET_MISSING')
  report.checks.push({name:'Real support page, six FAQs and one floating widget',status:'REAL_PASS'})
  for(let i=0;i<selectedQuestions.length;i++){
    if(i===5){
      if(Date.now()-lastAt<50000){const rate=await ask('jobs',true);report.checks.push({name:'Local BFF rate limit',http:rate.status,status:rate.status===429&&rate.code==='SUPPORT_RATE_LIMITED'?'REAL_PASS':'FAIL'});if(rate.status!==429)throw Error('QA_RATE_LIMIT_DID_NOT_BLOCK_EXTRA_INFERENCE')}
      else report.checks.push({name:'Local BFF rate limit',status:'NOT_RUN',reason:'Minute elapsed; extra provider call deliberately avoided'})
      await logout();await login('B')
    }
    const question=selectedQuestions[i],result=await ask(question.id);report.faq.push({id:question.id,...result,http:result.status,status:result.status===200?'REAL_PASS':'FAIL'});console.log(JSON.stringify({faq:question.id,http:result.status,code:result.code,status:result.status===200?'REAL_PASS':'FAIL'}))
    if(result.status!==200){report.providerFailures.push({http:result.status,code:result.code});break}
  }
  for(const question of STAFF_USAGE_HELP)if(!report.faq.some(result=>result.id===question.id))report.faq.push({id:question.id,status:'NOT_RUN',reason:readOnly?'Read-only UI verification; provider not called':!selectedQuestions.some(selected=>selected.id===question.id)?'Outside selected FAQ scope':'Stopped after provider failure; no retries'})
  if(conversationQa){const followup=report.faq.find(result=>result.id==='free-followup');check(followup?.contextReused&&followup.turnCount===2&&followup.followupRecognized,'QA_REAL_CONTEXT_NOT_CONFIRMED');report.scope='TWO_TURN_FREE_TEXT'}
  report.realAI=readOnly?'NOT_RUN':selectedQuestions.every(question=>report.faq.some(result=>result.id===question.id&&result.status==='REAL_PASS'))?'REAL_PASS':'FAIL'
  report.browserSafety=await cdp.evaluate('window.__qaSupportLive.forbidden===0&&!Object.keys(localStorage).some(k=>/support|chat|token|password/i.test(k))&&!Object.keys(sessionStorage).some(k=>/support|chat|token|password/i.test(k))&&!document.cookie.includes("cleanhome_staff_session=")')
  check(report.browserSafety&&report.unexpectedBrowserErrors===0,'QA_BROWSER_SAFETY_FAILED')
  // The screenshot contains only permitted FAQ text and the visible reply/error.
  const picture=await cdp.send('Page.captureScreenshot',{format:'png'});await writeFile(join(artifacts,'staff-support-live.png'),Buffer.from(picture.data,'base64'))
}catch(error){report.realAI='FAIL';report.error=/^[A-Z0-9_]+$/.test(error.message||'')?error.message:'QA_ERROR_DETAILS_WITHHELD';process.exitCode=1}
finally{
  clearTimeout(watchdog);try{await logout()}catch{}try{await cdp?.send('Browser.close')}catch{}if(browser?.exitCode===null)browser.kill()
  if(profile&&dirname(resolve(profile))===resolve(tmpdir())&&basename(profile).startsWith('cleanhome-staff-support-live-'))await rm(profile,{recursive:true,force:true,maxRetries:3,retryDelay:200}).catch(()=>{})
  report.inferenceAttempts=calls;if(artifacts)await writeFile(join(artifacts,'report.json'),JSON.stringify(report,null,2));if(report.realAI==='FAIL')process.exitCode=1
  console.log(JSON.stringify({realAI:report.realAI,inferenceAttempts:calls,faqPass:report.faq.filter(q=>q.status==='REAL_PASS').length,faqNotRun:report.faq.filter(q=>q.status==='NOT_RUN').length,error:report.error,report:artifacts&&join(artifacts,'report.json')}))
}
