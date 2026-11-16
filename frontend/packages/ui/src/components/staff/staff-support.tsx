"use client"

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react"
import {
  ArrowRightIcon, CalendarDaysIcon, ChevronRightIcon, CircleHelpIcon, ClipboardListIcon, InfoIcon,
  MessageCircleIcon, PlusIcon, RotateCcwIcon, SendIcon, UserRoundIcon,
} from "lucide-react"
import { AreaLink as Link } from "@/components/shared/area-routes"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { useStaffAuth } from "./staff-auth-session"
import { StaffEmpty, StaffPageHeader } from "./staff-shared"
import { StaffSupportKnowledge } from "./staff-support-knowledge"
import { createSupportDemoAdapter } from "./staff-support-demo-adapter"
import {
  SUPPORT_DISCLAIMER, SUPPORT_JOBS, SUPPORT_PRIORITIES, SUPPORT_PRIORITY_LABELS, SUPPORT_STATUSES, SUPPORT_STATUS_LABELS,
  SUPPORT_TOPICS, SUPPORT_TOPIC_LABELS, SupportDemoError, defaultSupportFilter, emptySupportDraft, formatSupportTime,
  isSupportDraftPristine, relatedJobLabel, validateSupportFilter, validateTicketInput,
  type DemoTicket, type DemoTicketResponse, type SupportDemoAdapter, type SupportFilter, type SupportPriority,
  type SupportSnapshot, type SupportStatus, type SupportTicketInput, type SupportTopic,
} from "./staff-support-demo-model"

function DemoNotice({ compact = false }: { compact?: boolean }) {
  return <div role="note" className={"staff-support-notice" + (compact ? " staff-support-notice-compact" : "")}><InfoIcon aria-hidden="true" /><div><strong>DỮ LIỆU MINH HỌA</strong><p>{compact ? "Nội dung, trạng thái và phản hồi mẫu chỉ thuộc bản DEMO, không phải ticket Admin." : "Yêu cầu, trạng thái và phản hồi mẫu đều là giả định DEMO, tách riêng từng tài khoản. Không gửi đến Admin, email hay hotline, không ghi Backend. Chỉ giữ trong phiên đang mở: F5, rời trang hoặc đăng xuất sẽ đặt lại."}</p></div></div>
}

function StatusBadge({ status }: { status: SupportStatus }) {
  return <span className={"staff-support-status staff-support-status-" + status.toLowerCase()} data-support-status={status}>{SUPPORT_STATUS_LABELS[status]}</span>
}

function Priority({ priority }: { priority: SupportPriority }) {
  return <span className={"staff-support-priority staff-support-priority-" + priority.toLowerCase()}>Ưu tiên {SUPPORT_PRIORITY_LABELS[priority].toLowerCase()}</span>
}

function SupportShortcuts() {
  return <Card className="staff-support-shortcuts"><CardContent><h2>Truy cập nhanh</h2><p>Tiếp tục theo dõi công việc và thông tin cá nhân.</p><nav aria-label="Lối tắt hỗ trợ">
    <Button variant="outline" render={<Link href="/cong-viec" />} nativeButton={false}><ClipboardListIcon aria-hidden="true" /><span>Công việc</span><ArrowRightIcon aria-hidden="true" /></Button>
    <Button variant="outline" render={<Link href="/lich-lam-viec" />} nativeButton={false}><CalendarDaysIcon aria-hidden="true" /><span>Lịch làm việc</span><ArrowRightIcon aria-hidden="true" /></Button>
    <Button variant="outline" render={<Link href="/ho-so" />} nativeButton={false}><UserRoundIcon aria-hidden="true" /><span>Hồ sơ cá nhân</span><ArrowRightIcon aria-hidden="true" /></Button>
  </nav></CardContent></Card>
}

function TicketDetail({ adapter, id, version, onClose }: { adapter: SupportDemoAdapter; id: string | null; version: number; onClose: () => void }) {
  const [ticket, setTicket] = useState<DemoTicket | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState(""), [retry, setRetry] = useState(0)
  const [sample, setSample] = useState<DemoTicketResponse | null>(null), [sampleError, setSampleError] = useState(""), [sampleBusy, setSampleBusy] = useState(false)
  useEffect(() => {
    if (!id) return
    const controller = new AbortController(); setLoading(true); setTicket(null); setError("")
    void adapter.detail(id, controller.signal).then(value => { if (!controller.signal.aborted) setTicket(value) }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof SupportDemoError ? reason.message : "Chưa thể mở yêu cầu minh họa.") }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [adapter, id, version, retry])
  useEffect(() => { setSample(null); setSampleError("") }, [id, version])
  async function showSample() {
    if (!id || sampleBusy) return
    setSampleBusy(true); setSampleError("")
    try {
      const value = await adapter.sampleReply(id)
      if (value) setSample(value); else setSampleError("Không tìm thấy phản hồi mẫu cho yêu cầu này.")
    } catch (reason) { setSampleError(reason instanceof SupportDemoError ? reason.message : "Chưa thể xem phản hồi mẫu DEMO.") }
    finally { setSampleBusy(false) }
  }
  return <Dialog open={!!id} onOpenChange={open => { if (!open) onClose() }}><DialogContent showCloseButton={false} className="staff-support-dialog" data-support-detail data-support-detail-id={id || undefined}>
    <DialogHeader><DialogTitle>Chi tiết yêu cầu hỗ trợ DEMO</DialogTitle><DialogDescription>Dữ liệu giả lập; không phải ticket Admin và không gửi thông báo thật.</DialogDescription></DialogHeader>
    <DemoNotice compact />
    {loading ? <p role="status" aria-busy="true">Đang mở yêu cầu minh họa...</p> : error ? <div role="alert"><p>{error}</p><Button variant="outline" onClick={() => setRetry(value => value + 1)}>Thử lại</Button></div> : !ticket ? <p role="status">Không tìm thấy yêu cầu minh họa này.</p> : <>
      <div className="staff-support-detail-head"><StatusBadge status={ticket.status} /><Priority priority={ticket.priority} /><span className="staff-support-code">{ticket.id}</span></div>
      <h3 className="staff-support-detail-title">{ticket.subject}</h3>
      <dl className="staff-support-detail-fields">
        <div><dt>Chủ đề</dt><dd>{SUPPORT_TOPIC_LABELS[ticket.topic]}</dd></div>
        <div><dt>Công việc liên quan</dt><dd>{relatedJobLabel(ticket.relatedJob)}</dd></div>
        <div><dt>Tạo lúc (UTC+7)</dt><dd><time dateTime={ticket.createdAt}>{formatSupportTime(ticket.createdAt)}</time></dd></div>
        <div><dt>Cập nhật lúc (UTC+7)</dt><dd><time dateTime={ticket.updatedAt}>{formatSupportTime(ticket.updatedAt)}</time></dd></div>
      </dl>
      <section className="staff-support-detail-section"><h4>Nội dung yêu cầu</h4><p>{ticket.content}</p></section>
      <section className="staff-support-detail-section"><h4>Lịch sử trạng thái DEMO</h4><ol className="staff-support-timeline">{ticket.history.map((entry, index) => <li key={entry.status + entry.at + index}><span className="staff-support-timeline-dot" aria-hidden="true" /><div><div className="staff-support-timeline-head"><StatusBadge status={entry.status} /><time dateTime={entry.at}>{formatSupportTime(entry.at)}</time></div><p>{entry.note}</p></div></li>)}</ol></section>
      <section className="staff-support-detail-section"><h4>Phản hồi mẫu DEMO</h4>
        {ticket.responses.length ? <ul className="staff-support-responses">{ticket.responses.map(response => <li key={response.id}><MessageCircleIcon aria-hidden="true" /><div><p>{response.body}</p><time dateTime={response.at}>{formatSupportTime(response.at)} · Nguồn DEMO</time></div></li>)}</ul> : <p className="staff-support-muted">Ticket này chưa có phản hồi mẫu. Có thể xem một phản hồi mẫu bên dưới; phản hồi không được gửi đi.</p>}
        <Button variant="outline" disabled={sampleBusy} onClick={() => void showSample()}><MessageCircleIcon aria-hidden="true" />{sampleBusy ? "Đang lấy phản hồi mẫu..." : "Xem phản hồi mẫu DEMO"}</Button>
        {sampleError && <p role="alert" className="staff-support-inline-error">{sampleError}</p>}
        {sample && <div className="staff-support-sample" role="note"><strong>Phản hồi mẫu DEMO · không gửi đến Admin</strong><p>{sample.body}</p><time dateTime={sample.at}>{formatSupportTime(sample.at)} · {sample.id}</time></div>}
      </section>
      <p className="staff-support-muted">Trạng thái và phản hồi mẫu chỉ là giả định DEMO; không xác nhận Admin đã nhận, đã xử lý hoặc đã trả lời. Không có thao tác gửi email, gọi hotline hay ghi Backend.</p>
    </>}
    <DialogClose render={<Button variant="outline" aria-label="Đóng chi tiết yêu cầu hỗ trợ" />} onClick={onClose}>Đóng chi tiết</DialogClose>
  </DialogContent></Dialog>
}

function SupportPanel({ adapter }: { adapter: SupportDemoAdapter }) {
  const [snapshot, setSnapshot] = useState<SupportSnapshot | null>(null), [filter, setFilter] = useState<SupportFilter>(defaultSupportFilter())
  const [draft, setDraft] = useState<SupportTicketInput>(() => emptySupportDraft())
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(""), [formError, setFormError] = useState(""), [notice, setNotice] = useState("")
  const [selected, setSelected] = useState<string | null>(null), [retry, setRetry] = useState(0), [version, setVersion] = useState(0)
  const operation = useRef<AbortController | null>(null), trigger = useRef<HTMLButtonElement | null>(null), heading = useRef<HTMLHeadingElement>(null), alertRef = useRef<HTMLDivElement>(null), formAlert = useRef<HTMLDivElement>(null), subjectRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const controller = new AbortController(); operation.current = controller; setLoading(true); setSnapshot(null); setError("")
    void adapter.list(defaultSupportFilter(), controller.signal).then(value => { if (!controller.signal.aborted) { setSnapshot(value); if (value) setFilter({ ...value.filter }) } }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof SupportDemoError ? reason.message : "Chưa thể tải yêu cầu hỗ trợ minh họa. Vui lòng thử lại.") }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => { controller.abort(); operation.current?.abort() }
  }, [adapter, retry])
  useEffect(() => { if (error && !selected) alertRef.current?.focus() }, [error, selected])
  function patch<K extends keyof SupportTicketInput>(key: K, value: SupportTicketInput[K]) {
    setDraft(current => ({ ...current, [key]: value })); setFormError("")
  }
  async function applyFilter(next: SupportFilter) {
    if (busy || loading) return
    let safe: SupportFilter
    try { safe = validateSupportFilter(next) } catch (reason) { setError(reason instanceof SupportDemoError ? reason.message : "Bộ lọc minh họa không hợp lệ."); return }
    const controller = new AbortController(); operation.current = controller; setBusy(true); setError("")
    try {
      const value = await adapter.list(safe, controller.signal)
      if (controller.signal.aborted) return
      setSnapshot(value); if (value) setFilter({ ...value.filter })
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof SupportDemoError ? reason.message : "Chưa thể lọc yêu cầu minh họa.") }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || loading) return
    let safe: SupportTicketInput
    try { safe = validateTicketInput(draft) } catch (reason) {
      setFormError(reason instanceof SupportDemoError ? reason.message : "Yêu cầu minh họa không hợp lệ.")
      window.setTimeout(() => formAlert.current?.focus(), 0)
      return
    }
    const controller = new AbortController(); operation.current = controller; setBusy(true); setFormError(""); setError(""); setNotice("")
    try {
      const created = await adapter.create(safe, controller.signal)
      if (controller.signal.aborted || !created) return
      const all = await adapter.list({ status: "ALL" }, controller.signal)
      if (controller.signal.aborted) return
      setSnapshot(all); setFilter({ status: "ALL" }); setDraft(emptySupportDraft()); setSelected(created.ticket.id); setVersion(value => value + 1)
      setNotice("Đã tạo yêu cầu " + created.ticket.id + " trong bản DEMO. Không gửi đến Admin.")
    } catch (reason) { if (!controller.signal.aborted) setFormError(reason instanceof SupportDemoError ? reason.message : "Chưa thể tạo yêu cầu minh họa.") }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }
  function cancelDraft() {
    if (busy || loading) return
    setDraft(emptySupportDraft()); setFormError(""); setNotice("Đã hủy bản nháp. Chưa có yêu cầu nào được tạo từ bản nháp này.")
    window.setTimeout(() => subjectRef.current?.focus(), 0)
  }
  async function resetDemo() {
    if (busy || loading) return
    const controller = new AbortController(); operation.current = controller; setBusy(true); setError(""); setNotice("")
    try {
      const value = await adapter.reset(controller.signal)
      if (controller.signal.aborted) return
      setSnapshot(value); setFilter(defaultSupportFilter()); setDraft(emptySupportDraft()); setSelected(null); setFormError(""); setVersion(current => current + 1)
      setNotice("Đã đặt lại toàn bộ yêu cầu, bộ lọc và bản nháp DEMO của phiên đang mở.")
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof SupportDemoError ? reason.message : "Chưa thể đặt lại bản minh họa.") }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }
  function close() { setSelected(null); window.setTimeout(() => { if (trigger.current?.isConnected) trigger.current.focus(); else heading.current?.focus() }, 0) }
  const filtered = snapshot?.filtered || []
  return <>
    <DemoNotice />
    {notice && <p role="status" aria-live="polite" className="staff-support-feedback">{notice}</p>}
    {error && <div ref={alertRef} role="alert" tabIndex={-1} className="staff-support-error"><p>{error}</p>{!snapshot && <Button variant="outline" onClick={() => setRetry(value => value + 1)}>Thử tải lại</Button>}</div>}
    {loading ? <section className="staff-support-loading" role="status" aria-busy="true" aria-label="Đang tải yêu cầu hỗ trợ minh họa"><Skeleton className="h-28 rounded-2xl" /><Skeleton className="h-52 rounded-2xl" /></section> : !snapshot ? !error && <StaffEmpty title="Chưa có yêu cầu hỗ trợ minh họa" description="Bản minh họa hiện không cung cấp yêu cầu nào." /> : <>
      <section className="staff-support-overview" aria-label="Tổng quan yêu cầu hỗ trợ minh họa">
        <Card><CardContent><p className="staff-support-count-label">Tổng yêu cầu DEMO</p><p className="staff-support-count" data-support-count="ALL">{snapshot.counts.ALL}</p><p>Chỉ trong bộ dữ liệu minh họa.</p></CardContent></Card>
        <Card><CardContent><p className="staff-support-count-label">Mới</p><p className="staff-support-count" data-support-count="NEW">{snapshot.counts.NEW}</p><p>Trạng thái giả định DEMO.</p></CardContent></Card>
        <Card><CardContent><p className="staff-support-count-label">Đang xử lý</p><p className="staff-support-count" data-support-count="IN_PROGRESS">{snapshot.counts.IN_PROGRESS}</p><p>Không phải Admin đang xử lý thật.</p></CardContent></Card>
        <Card><CardContent><p className="staff-support-count-label">Đã giải quyết</p><p className="staff-support-count" data-support-count="RESOLVED">{snapshot.counts.RESOLVED}</p><p>Không xác nhận Admin đã xử lý.</p></CardContent></Card>
      </section>
      <div className="staff-support-toolbar">
        <div className="staff-support-tabs" role="group" aria-label="Lọc yêu cầu hỗ trợ">
          {(["ALL", ...SUPPORT_STATUSES] as const).map(status => <Button key={status} variant={filter.status === status ? "default" : "ghost"} aria-pressed={filter.status === status} data-support-filter={status} disabled={busy || loading} onClick={() => void applyFilter({ status })}>{status === "ALL" ? "Tất cả" : SUPPORT_STATUS_LABELS[status]}<span>{snapshot.counts[status]}</span></Button>)}
        </div>
        <Button variant="outline" disabled={busy || loading} aria-label="Đặt lại yêu cầu hỗ trợ minh họa" onClick={() => void resetDemo()}><RotateCcwIcon aria-hidden="true" />Đặt lại DEMO</Button>
      </div>
      <div className="staff-support-layout">
        <section className="staff-support-list-section" aria-labelledby="staff-support-list-heading">
          <div className="staff-support-section-title"><div><h2 ref={heading} tabIndex={-1} id="staff-support-list-heading">Danh sách yêu cầu minh họa</h2><p>{filtered.length} / {snapshot.total} yêu cầu khớp bộ lọc · Giờ Việt Nam (UTC+7)</p></div></div>
          {!filtered.length ? <div className="staff-support-empty" role="status"><CircleHelpIcon aria-hidden="true" /><h3>Không có yêu cầu minh họa khớp bộ lọc</h3><p>Thử chọn trạng thái khác hoặc xem tất cả. Dữ liệu thật không bị ảnh hưởng.</p><Button variant="outline" onClick={() => void applyFilter(defaultSupportFilter())}>Xem tất cả yêu cầu</Button></div> : <ul className="staff-support-list" aria-label="Danh sách yêu cầu hỗ trợ minh họa">{filtered.map(ticket => <li key={ticket.id}><Card className="staff-support-ticket" data-demo-ticket={ticket.id} data-demo-ticket-status={ticket.status}><CardContent>
            <div className="staff-support-ticket-head"><StatusBadge status={ticket.status} /><Priority priority={ticket.priority} /><time dateTime={ticket.updatedAt}>{formatSupportTime(ticket.updatedAt)}</time></div>
            <h3>{ticket.subject}</h3>
            <p className="staff-support-ticket-excerpt">{ticket.content}</p>
            <p className="staff-support-ticket-meta">{SUPPORT_TOPIC_LABELS[ticket.topic]} · {relatedJobLabel(ticket.relatedJob)} · {ticket.id}</p>
            <Button variant="outline" aria-label={"Xem chi tiết yêu cầu " + ticket.id} onClick={event => { trigger.current = event.currentTarget; setSelected(ticket.id) }}>Xem chi tiết<ChevronRightIcon aria-hidden="true" /></Button>
          </CardContent></Card></li>)}</ul>}
        </section>
        <Card className="staff-support-form-card"><CardContent>
          <header className="staff-support-form-heading"><span><PlusIcon aria-hidden="true" /></span><div><h2>Tạo yêu cầu mới (DEMO)</h2><p>Chỉ tạo trong bộ nhớ trang; không gửi đến Admin hay kênh liên hệ nào.</p></div></header>
          {formError && <div ref={formAlert} role="alert" tabIndex={-1} className="staff-support-error staff-support-form-error"><p>{formError}</p></div>}
          <form className="staff-support-form" onSubmit={submit} noValidate aria-label="Tạo yêu cầu hỗ trợ minh họa">
            <div className="ch-field"><label htmlFor="staff-support-topic">Chủ đề</label><select id="staff-support-topic" value={draft.topic} disabled={busy} aria-describedby="staff-support-topic-help" onChange={event => patch("topic", event.target.value as SupportTopic)}>{SUPPORT_TOPICS.map(value => <option key={value} value={value}>{SUPPORT_TOPIC_LABELS[value]}</option>)}</select><p id="staff-support-topic-help">Chọn nhóm nội dung gần nhất. Không nhập email hoặc số điện thoại.</p></div>
            <div className="ch-field"><label htmlFor="staff-support-subject">Tiêu đề ngắn</label><input ref={subjectRef} id="staff-support-subject" value={draft.subject} maxLength={120} disabled={busy} placeholder="Ví dụ: Cần xác nhận lịch ca sáng" aria-describedby="staff-support-subject-help" onChange={event => patch("subject", event.target.value)} /><p id="staff-support-subject-help">Từ 5 đến 120 ký tự. Không dùng thông tin cá nhân thật.</p></div>
            <div className="ch-field"><label htmlFor="staff-support-content">Nội dung</label><textarea id="staff-support-content" value={draft.content} maxLength={1000} disabled={busy} rows={5} placeholder="Mô tả ngắn gọn nội dung cần hỗ trợ trong bản DEMO." aria-describedby="staff-support-content-help" onChange={event => patch("content", event.target.value)} /><p id="staff-support-content-help">Từ 10 đến 1000 ký tự. Không nhập mật khẩu, token, email, số điện thoại hoặc dữ liệu khách hàng.</p></div>
            <div className="staff-support-form-row">
              <div className="ch-field"><label htmlFor="staff-support-priority">Mức ưu tiên</label><select id="staff-support-priority" value={draft.priority} disabled={busy} onChange={event => patch("priority", event.target.value as SupportPriority)}>{SUPPORT_PRIORITIES.map(value => <option key={value} value={value}>{SUPPORT_PRIORITY_LABELS[value]}</option>)}</select><p>Chỉ là nhãn minh họa, không tạo SLA thật.</p></div>
              <div className="ch-field"><label htmlFor="staff-support-job">Công việc liên quan</label><select id="staff-support-job" value={draft.relatedJob} disabled={busy} onChange={event => patch("relatedJob", event.target.value)}><option value="">Không liên kết công việc</option>{SUPPORT_JOBS.map(value => <option key={value.id} value={value.id}>{value.label}</option>)}</select><p>Chỉ chọn ca DEMO; không liên kết công việc thật.</p></div>
            </div>
            <div className="staff-support-form-actions"><Button type="submit" disabled={busy || loading}><SendIcon aria-hidden="true" />{busy ? "Đang tạo trong DEMO..." : "Gửi yêu cầu DEMO"}</Button><Button type="button" variant="outline" disabled={busy || loading || isSupportDraftPristine(draft)} onClick={cancelDraft}>Hủy bản nháp</Button></div>
            <p className="staff-support-muted">Nút gửi chỉ thêm ticket vào bộ nhớ trang. Không có email, hotline, Admin API hoặc ghi MySQL.</p>
          </form>
        </CardContent></Card>
      </div>
      <SupportShortcuts />
      <details className="staff-support-rules"><summary>Giả định và giới hạn của bản minh họa</summary><ul><li>Bốn yêu cầu seed và mọi yêu cầu tạo mới đều là dữ liệu giả lập; mã bắt đầu bằng DEMO-SUP.</li><li>Trạng thái Mới/Đang xử lý/Đã giải quyết do DEMO đặt, không phải trạng thái ticket Admin và không có SLA.</li><li>Phản hồi mẫu chỉ để xem trong dialog; không gửi, không sửa và không xác nhận Admin đã trả lời.</li><li>Không lưu storage, không gọi API, không ghi MySQL; F5, rời trang, đổi tài khoản hoặc đăng xuất sẽ đặt lại.</li></ul></details>
      <p className="staff-support-disclaimer" role="note">{SUPPORT_DISCLAIMER}</p>
    </>}
    <TicketDetail adapter={adapter} id={selected} version={version} onClose={close} />
  </>
}

function UnavailableSupport() {
  return <section className="staff-support-unavailable" aria-label="Hỗ trợ trực tuyến chưa được cung cấp" data-staff-support-unavailable>
    <StaffEmpty title="Yêu cầu hỗ trợ chưa khả dụng" description="Chức năng gửi yêu cầu trực tiếp chưa được cung cấp. Bạn có thể xem hướng dẫn hoặc mở Trợ lý CleanHome." action={<Button variant="outline" render={<Link href="/ho-so" />} nativeButton={false}>Về Cá nhân</Button>} />
    <SupportShortcuts />
  </section>
}

function BoundSupport({ enabled, accountScope }: { enabled: boolean; accountScope: string }) {
  const adapter = useMemo(() => createSupportDemoAdapter({ enabled, accountScope }), [enabled, accountScope])
  return adapter.kind === "unavailable" ? <UnavailableSupport /> : <SupportPanel adapter={adapter} />
}

export function StaffSupport({ demoEnabled = false }: { demoEnabled?: boolean }) {
  const auth = useStaffAuth()
  if (!auth || auth.status !== "authenticated" || !auth.session || auth.busy === "logout") return null
  const accountScope = auth.session.user.id
  const canDemo = demoEnabled === true && process.env.NODE_ENV === "development" && /^[1-9]\d{0,18}$/.test(accountScope)
  return <div data-staff-support={canDemo ? "demo" : "unavailable"} className="staff-support min-w-0 space-y-6">
    <StaffPageHeader title="Hỗ trợ" description="Tìm hướng dẫn và trò chuyện với Trợ lý CleanHome." action={<Button variant="outline" render={<Link href="/ho-so" />} nativeButton={false}>Về Cá nhân</Button>} />
    <StaffSupportKnowledge key={accountScope} accountScope={accountScope} chatEnabled={!canDemo} checkSession={auth.checkSession} />
    {canDemo ? <BoundSupport key={accountScope} enabled={demoEnabled} accountScope={accountScope} /> : <UnavailableSupport />}
  </div>
}
