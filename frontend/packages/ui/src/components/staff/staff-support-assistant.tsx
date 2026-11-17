"use client"

import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react"
import { BotIcon, BookOpenIcon, MinusIcon, RefreshCwIcon, SearchIcon, SendIcon, Trash2Icon, UserRoundIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { STAFF_SUPPORT_POLICY, STAFF_USAGE_HELP } from "./staff-support-questions.mjs"
import { staffSupportExactQuestion, staffSupportSuggestions, type StaffSupportQuestion } from "./staff-support-search"
import { STAFF_CONVERSATION_POLICY, STAFF_CONVERSATION_LIMITS, validateSupportText } from "./staff-support-conversation.mjs"

type Message = { id: string; author: "staff" | "assistant" | "faq"; body: string; questionId?: string }
type Prompt = { text: string; questionId?: string; freeText: boolean }
type State = "loading" | "unavailable" | "ready" | "sending" | "error" | "unauthorized"

async function readReply(response: Response, signal: AbortSignal): Promise<Record<string, unknown>> {
  if (response.headers.get("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") throw Error("INVALID_RESPONSE")
  const reader = response.body?.getReader(); if (!reader) throw Error("INVALID_RESPONSE")
  const chunks: Uint8Array[] = []; let size = 0
  const cancel = () => { void reader.cancel().catch(() => {}) }
  signal.addEventListener("abort", cancel, { once: true })
  try {
    while (true) { if (signal.aborted) throw Error("TIMEOUT"); const part = await reader.read(); if (signal.aborted) throw Error("TIMEOUT"); if (part.done) break; size += part.value.byteLength; if (size > 16384) throw Error("INVALID_RESPONSE"); chunks.push(part.value) }
    const bytes = new Uint8Array(size); let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
    if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("INVALID_RESPONSE")
    return value as Record<string, unknown>
  } finally { signal.removeEventListener("abort", cancel); void reader.cancel().catch(() => {}); reader.releaseLock() }
}

/** Only approved, validated text or a fixed FAQ ID leaves the browser; history stays server-side. */
export function StaffSupportAssistant({ accountScope, enabled = true, checkSession, open = true, onMinimize }: { accountScope: string; enabled?: boolean; checkSession?: () => unknown; open?: boolean; onMinimize?: () => void }) {
  const [state, setState] = useState<State>("loading"), [error, setError] = useState(""), [retry, setRetry] = useState(0)
  const [query, setQuery] = useState(""), [messages, setMessages] = useState<Message[]>([]), [suggestionsOpen, setSuggestionsOpen] = useState(false), [activeIndex, setActiveIndex] = useState(-1)
  const [pendingPrompt, setPendingPrompt] = useState<Prompt | null>(null), [hint, setHint] = useState(""), [freeText, setFreeText] = useState(false), [turnCount, setTurnCount] = useState(0), [showFaq, setShowFaq] = useState(false)
  const [maxTurns, setMaxTurns] = useState<number>(STAFF_CONVERSATION_LIMITS.turns), [serverLimitReached, setServerLimitReached] = useState(false)
  const operation = useRef<AbortController | null>(null), locked = useRef(false), owner = useRef(accountScope)
  const conversation = useRef<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null), logRef = useRef<HTMLDivElement>(null), listRef = useRef<HTMLUListElement>(null), id = useId()
  const suggestions = staffSupportSuggestions(query), question = staffSupportExactQuestion(query)
  const validInput = validateSupportText(query), displaySuggestions = suggestionsOpen && suggestions.length > 0
  const busy = state === "sending" || state === "loading", unauthorized = state === "unauthorized"
  const limitReached = freeText && (turnCount >= maxTurns || serverLimitReached)
  const limitMessage = `Đã đạt giới hạn ${maxTurns} lượt của cuộc trò chuyện này. Bạn có thể bắt đầu cuộc trò chuyện mới; hạn mức theo tài khoản vẫn áp dụng.`
  const append = (message: Message) => setMessages(current => [...current.slice(-19), message])
  const resetComposer = () => { setQuery(""); setSuggestionsOpen(false); setActiveIndex(-1); setHint("") }
  const appendFaq = (item: StaffSupportQuestion) => setMessages(current => current.at(-1)?.author === "faq" && current.at(-1)?.questionId === item.id ? current : [...current.slice(-19), { id: crypto.randomUUID(), author: "faq", body: item.answer, questionId: item.id }])
  const clearRemote = () => fetch("/api/staff/support/chat", { method: "DELETE", credentials: "same-origin", cache: "no-store", redirect: "error", keepalive: true, headers: { "X-Staff-Account-Id": accountScope }, signal: AbortSignal.timeout(5000) })
  useEffect(() => () => { if (conversation.current) { conversation.current = null; void clearRemote().catch(() => {}) } }, [accountScope])
  useEffect(() => { if (open && state !== "loading") inputRef.current?.focus() }, [open, state === "loading"])
  useEffect(() => { if (open && !busy && !unauthorized && typeof document !== "undefined" && document.activeElement === document.body) inputRef.current?.focus() }, [open, state])
  useEffect(() => { const log = logRef.current; if (log) log.scrollTop = log.scrollHeight }, [messages, state, open])
  useEffect(() => { if (suggestionsOpen && activeIndex >= 0) (listRef.current?.children.item(activeIndex) as HTMLElement | null)?.scrollIntoView({ block: "nearest" }) }, [suggestionsOpen, activeIndex])
  function sessionFailure(status: number) {
    setMessages([]); resetComposer(); setPendingPrompt(null); conversation.current = null; setTurnCount(0); setServerLimitReached(false); setState("unauthorized")
    setError(status === 403 ? "Tài khoản không có quyền sử dụng trợ lý. Vui lòng kiểm tra lại phiên đăng nhập." : "Phiên đăng nhập đã thay đổi. Vui lòng tải lại trang.")
    try { void Promise.resolve(checkSession?.()).catch(() => {}) } catch { /* Keep sending disabled if session inspection fails. */ }
  }
  useEffect(() => {
    if (owner.current !== accountScope) { owner.current = accountScope; setMessages([]); resetComposer(); setPendingPrompt(null); conversation.current = null; setTurnCount(0); setServerLimitReached(false); setMaxTurns(STAFF_CONVERSATION_LIMITS.turns) }
    setError("")
    if (!enabled || !/^[1-9]\d{0,18}$/.test(accountScope)) { setState("unavailable"); return }
    const controller = new AbortController(); operation.current = controller; setState("loading")
    const timer = window.setTimeout(() => controller.abort(), 18000)
    void fetch("/api/staff/support/chat", { credentials: "same-origin", cache: "no-store", redirect: "error", signal: controller.signal, headers: { Accept: "application/json", "X-Staff-Account-Id": accountScope } })
      .then(async response => {
        if (operation.current !== controller) return
        if ([401, 403, 409].includes(response.status)) { void response.body?.cancel().catch(() => {}); sessionFailure(response.status); return }
        const body = await readReply(response, controller.signal)
        if (operation.current !== controller) return
        if (controller.signal.aborted) throw Error("TIMEOUT")
        if (!response.ok || body.policyVersion !== STAFF_SUPPORT_POLICY || body.mode !== "fixed-questions" || typeof body.available !== "boolean") throw Error("UNAVAILABLE")
        const capability = body.freeText as { available?: boolean; policyVersion?: string; maxTurns?: number } | undefined
        if (capability?.maxTurns !== undefined && ![10, 30].includes(capability.maxTurns)) throw Error("INVALID_RESPONSE")
        setMaxTurns(capability?.maxTurns || STAFF_CONVERSATION_LIMITS.turns)
        setFreeText(capability?.available === true && capability.policyVersion === STAFF_CONVERSATION_POLICY)
        setState(body.available ? "ready" : "unavailable")
      }).catch(() => { if (operation.current === controller) { setError("Chưa thể kiểm tra kết nối trợ lý. Vui lòng thử lại."); setState("error") } })
      .finally(() => window.clearTimeout(timer))
    return () => { operation.current?.abort(); operation.current = null; controller.abort(); locked.current = false }
  }, [accountScope, enabled, retry, checkSession])

  async function sendPrompt(prompt: Prompt, resend = false) {
    if (locked.current || busy || unauthorized || !enabled) return
    const validation = validateSupportText(prompt.text), item = STAFF_USAGE_HELP.find(item => item.id === prompt.questionId)
    if (!validation.ok) { setHint("Chỉ nhập câu hỏi chung, tối đa 1.000 ký tự; không có dữ liệu riêng tư, mật khẩu hoặc token."); return }
    if (prompt.freeText && (!freeText || state !== "ready")) { setError(state !== "ready" ? "Trợ lý AI tạm thời chưa khả dụng. Bạn vẫn có thể mở FAQ." : "Hội thoại tự do chưa được bật theo chính sách dữ liệu."); setShowFaq(true); return }
    if (prompt.freeText && limitReached) { setError(limitMessage); return }
    if (!resend) append({ id: crypto.randomUUID(), author: "staff", body: validation.value!, questionId: item?.id })
    resetComposer()
    if (!prompt.freeText && state !== "ready") { if (item) appendFaq(item); return }
    locked.current = true
    const controller = new AbortController(); operation.current = controller
    const timer = window.setTimeout(() => controller.abort(), 18000)
    setState("sending"); setError(""); setPendingPrompt(null)
    try {
      const response = await fetch("/api/staff/support/chat", { method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error", signal: controller.signal,
        headers: { Accept: "application/json", "Content-Type": "application/json", "X-Staff-Account-Id": accountScope }, body: JSON.stringify(prompt.freeText ? { mode: "free-text", message: validation.value, ...(conversation.current ? { conversationId: conversation.current } : {}) } : { questionId: item!.id }) })
      if (operation.current !== controller) return
      if ([401, 403, 409].includes(response.status)) { void response.body?.cancel().catch(() => {}); sessionFailure(response.status); return }
      const body = await readReply(response, controller.signal)
      if (operation.current !== controller) return
      if (controller.signal.aborted) throw Error("TIMEOUT")
      if (!response.ok) {
        const code = (body.error as { code?: string } | undefined)?.code
        setPendingPrompt([400, 410].includes(response.status) ? null : prompt)
        if (response.status === 410) { conversation.current = null; setTurnCount(0); setServerLimitReached(false); setState("ready"); setQuery(prompt.text); setError("Ngữ cảnh đã kết thúc. Bạn có thể gửi lại để bắt đầu hội thoại mới.") }
        else if (response.status === 400) { setState("ready"); setQuery(prompt.text); if (code === "SUPPORT_CONVERSATION_LIMIT") setServerLimitReached(true); setError(code === "SUPPORT_CONVERSATION_LIMIT" ? limitMessage : "Không thể gửi nội dung này. Hãy bỏ thông tin riêng tư hoặc nội dung không hợp lệ.") }
        else if (response.status === 503) { setState("unavailable"); setError("Trợ lý AI tạm thời chưa khả dụng. Bạn vẫn có thể mở FAQ.") }
        else { setState("ready"); setError(response.status === 429 ? "Bạn đã gửi nhiều câu hỏi. Vui lòng chờ một phút rồi thử lại." : "Chưa nhận được phản hồi. Bạn có thể thử gửi lại.") }
        return
      }
      const answer = body.answer
      if (typeof answer !== "string" || !answer.trim() || answer.length > 4000) throw Error("INVALID_RESPONSE")
      if (prompt.freeText) {
        if (body.mode !== "free-text" || body.policyVersion !== STAFF_CONVERSATION_POLICY || typeof body.conversationId !== "string" || !/^[a-f0-9-]{36}$/.test(body.conversationId) || ![10, 30].includes(Number(body.maxTurns)) || !Number.isInteger(body.maxTurns) || !Number.isInteger(body.turnCount) || Number(body.turnCount) < 1 || Number(body.turnCount) > Number(body.maxTurns)) throw Error("INVALID_RESPONSE")
        conversation.current = body.conversationId; setTurnCount(Number(body.turnCount)); setMaxTurns(Number(body.maxTurns))
      } else if (body.questionId !== item!.id || body.policyVersion !== STAFF_SUPPORT_POLICY) throw Error("INVALID_RESPONSE")
      append({ id: crypto.randomUUID(), author: "assistant", body: answer, questionId: item?.id })
      setState("ready")
    } catch { if (operation.current === controller) { setState("ready"); setPendingPrompt(prompt); setError("Chưa nhận được phản hồi trong thời gian cho phép. Vui lòng thử lại.") } }
    finally { window.clearTimeout(timer); if (operation.current === controller) locked.current = false }
  }
  function send(event: FormEvent) { event.preventDefault(); if (busy || unauthorized) return; void sendPrompt({ text: query, questionId: question?.id, freeText: freeText || !question }) }
  async function clearConversation() {
    if (busy || locked.current) return
    const hadContext = Boolean(conversation.current); conversation.current = null; setTurnCount(0); setServerLimitReached(false); setMessages([]); resetComposer(); setPendingPrompt(null); setError(""); setShowFaq(false)
    if (hadContext) { locked.current = true; setState("loading"); try { const response = await clearRemote(); if (!response.ok) setError("Đã xóa trên cửa sổ này; chưa xác nhận xóa ngữ cảnh trên máy chủ."); void response.body?.cancel().catch(() => {}) } catch { setError("Đã xóa trên cửa sổ này; chưa xác nhận xóa ngữ cảnh trên máy chủ.") } finally { locked.current = false; setState(state) } }
    inputRef.current?.focus()
  }
  function choose(item: StaffSupportQuestion) { inputRef.current?.focus(); setQuery(item.question); setSuggestionsOpen(false); setActiveIndex(-1); setHint("") }
  function navigateSuggestions(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) return
    if ((event.key === "ArrowDown" || event.key === "ArrowUp") && suggestions.length && (suggestionsOpen || event.altKey)) { event.preventDefault(); setSuggestionsOpen(true); const step = event.key === "ArrowDown" ? 1 : -1; setActiveIndex(current => current < 0 ? step > 0 ? 0 : suggestions.length - 1 : (current + step + suggestions.length) % suggestions.length) }
    else if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); if (displaySuggestions && activeIndex >= 0) choose(suggestions[activeIndex]); else inputRef.current?.form?.requestSubmit() }
    else if (event.key === "Escape" && suggestionsOpen) { event.preventDefault(); event.stopPropagation(); setSuggestionsOpen(false); setActiveIndex(-1) }
    else if (event.key === "Tab") setSuggestionsOpen(false)
  }
  const retryQuestion = STAFF_USAGE_HELP.find(item => item.id === pendingPrompt?.questionId)
  return <section className="staff-chat-assistant" data-support-chat-state={state} aria-label="Hội thoại Trợ lý CleanHome">
    <header className="staff-chat-header"><span className="staff-chat-header-avatar"><BotIcon aria-hidden="true" /></span><div><h2>Trợ lý CleanHome</h2><p role="status">{state === "loading" ? "Đang kết nối..." : state === "sending" ? "Đang trả lời..." : state === "ready" ? freeText ? `Hội thoại AI · ${turnCount}/${maxTurns} lượt` : "Hướng dẫn dành cho nhân viên" : unauthorized ? "Cần kiểm tra lại phiên" : "Trợ lý AI tạm thời chưa khả dụng"}</p></div><div className="staff-chat-header-actions"><button type="button" aria-label="Xóa hội thoại" data-staff-chat-clear disabled={busy || !messages.length} onClick={() => void clearConversation()}><Trash2Icon aria-hidden="true" /></button>{onMinimize && <button type="button" aria-label="Thu nhỏ trò chuyện" onClick={onMinimize}><MinusIcon aria-hidden="true" /></button>}</div></header>
    <div ref={logRef} className="staff-chat-body" data-staff-chat-log tabIndex={0} role="region" aria-label="Nội dung trò chuyện và hỗ trợ">
    <div role="log" aria-live="polite" aria-relevant="additions" aria-busy={state === "sending"} aria-label="Tin nhắn trợ lý" className="staff-chat-log">
      {!messages.length && <div className="staff-chat-welcome"><BotIcon aria-hidden="true" /><h3>Bạn cần hỗ trợ gì?</h3><p>Bạn có thể chào hỏi, đặt câu hỏi hoặc chọn gợi ý bên dưới.</p></div>}
      {messages.map(message => <article key={message.id} className={`staff-chat-message staff-chat-message-${message.author}`} data-staff-chat-message={message.author}><span className="staff-chat-message-avatar">{message.author === "staff" ? <UserRoundIcon aria-hidden="true" /> : message.author === "faq" ? <BookOpenIcon aria-hidden="true" /> : <BotIcon aria-hidden="true" />}</span><div className="staff-chat-bubble"><strong>{message.author === "staff" ? "Bạn" : message.author === "faq" ? "FAQ CleanHome · Hướng dẫn cố định" : "Trợ lý AI"}</strong><p>{message.body}</p></div></article>)}
      {state === "sending" && <div className="staff-chat-message staff-chat-message-assistant" role="status"><span className="staff-chat-message-avatar"><BotIcon aria-hidden="true" /></span><span className="staff-chat-bubble staff-chat-typing"><i aria-hidden="true" /><i aria-hidden="true" /><i aria-hidden="true" />Đang trả lời...</span></div>}
    </div>
    {error && <div className="staff-chat-error" role="alert"><p>{error}</p></div>}
    {limitReached && !error && <div className="staff-chat-error" role="status" data-staff-chat-limit><p>{limitMessage}</p></div>}
    <div className="staff-chat-recovery">
      {limitReached && <Button variant="outline" data-staff-chat-new disabled={busy || unauthorized} onClick={() => void clearConversation()}>Bắt đầu cuộc trò chuyện mới</Button>}
      {pendingPrompt && state === "ready" && <Button variant="outline" data-staff-chat-retry onClick={() => void sendPrompt(pendingPrompt, true)}><RefreshCwIcon aria-hidden="true" />Thử gửi lại</Button>}
      {retryQuestion && !busy && !unauthorized && <Button variant="outline" data-staff-chat-faq onClick={() => { appendFaq(retryQuestion); setPendingPrompt(null); setError("") }}><BookOpenIcon aria-hidden="true" />Xem FAQ</Button>}
      {!busy && !unauthorized && <Button variant="outline" data-staff-chat-static-faq aria-expanded={showFaq} onClick={() => setShowFaq(value => !value)}><BookOpenIcon aria-hidden="true" />{showFaq ? "Ẩn FAQ" : "Mở FAQ"}</Button>}
      {["unavailable", "error"].includes(state) && <Button variant="outline" data-staff-chat-reconnect onClick={() => setRetry(value => value + 1)}>Thử kết nối lại</Button>}
    </div>
    {showFaq && <div className="staff-chat-static-faq" aria-label="FAQ CleanHome · Hướng dẫn cố định">{STAFF_USAGE_HELP.map(item => <details key={item.id}><summary>{item.question}</summary><p>{item.answer}</p></details>)}</div>}
    </div>
    <form className="staff-chat-composer" onSubmit={send} aria-describedby={`${id}-privacy`}>
      <div className="staff-chat-combobox" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) { setSuggestionsOpen(false); setActiveIndex(-1) } }}>
        <label htmlFor={`${id}-input`} className="sr-only">Hỏi Trợ lý CleanHome</label>
        <textarea ref={inputRef} id={`${id}-input`} rows={2} role="combobox" aria-multiline="true" aria-autocomplete="list" aria-haspopup="listbox" aria-expanded={displaySuggestions && !busy && !unauthorized} aria-controls={displaySuggestions && !busy && !unauthorized ? `${id}-suggestions` : undefined} aria-activedescendant={displaySuggestions && activeIndex >= 0 && suggestions[activeIndex] ? `${id}-option-${suggestions[activeIndex].id}` : undefined} aria-describedby={`${id}-privacy`} autoComplete="off" maxLength={STAFF_CONVERSATION_LIMITS.inputLength} placeholder="Nhắn cho Trợ lý CleanHome..." value={query} disabled={busy || unauthorized} data-staff-chat-input onFocus={() => { setSuggestionsOpen(Boolean(query.trim()) || messages.length === 0 && !error); setActiveIndex(-1) }} onChange={event => { setQuery(event.target.value); setActiveIndex(-1); setSuggestionsOpen(true); setHint("") }} onKeyDown={navigateSuggestions} />
        {displaySuggestions && !busy && !unauthorized && <div className="staff-chat-suggestions"><p>{query.trim() ? "Gợi ý phù hợp" : "Câu hỏi phổ biến"}</p><ul ref={listRef} id={`${id}-suggestions`} role="listbox" aria-label="Gợi ý câu hỏi FAQ">{suggestions.map((item, index) => <li key={item.id} id={`${id}-option-${item.id}`} role="option" aria-selected={activeIndex === index} data-staff-chat-option={item.id} onMouseDown={event => event.preventDefault()} onClick={() => choose(item)}><SearchIcon aria-hidden="true" /><span>{item.question}</span></li>)}</ul></div>}
      </div>
      <button type="submit" className="staff-chat-send" disabled={!validInput.ok || busy || unauthorized} aria-label="Gửi tin nhắn" data-staff-chat-send><SendIcon aria-hidden="true" /></button>
      {hint && <p className="staff-chat-hint" role="status">{hint}</p>}
      <p id={`${id}-privacy`} className="staff-chat-privacy">Không gửi thông tin riêng tư, khách hàng, mật khẩu hoặc token. Enter gửi · Shift+Enter xuống dòng. {query.length}/{STAFF_CONVERSATION_LIMITS.inputLength}</p>
      {query.trim() && !validInput.ok && <p className="staff-chat-hint" role="status">Nội dung vượt giới hạn hoặc có thông tin không được phép gửi.</p>}
    </form>
  </section>
}
