"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { BellIcon, BellRingIcon, CheckCheckIcon, CheckIcon, ChevronRightIcon, CircleUserRoundIcon, ClipboardListIcon, InfoIcon, MailOpenIcon, RotateCcwIcon, SettingsIcon, WalletCardsIcon } from "lucide-react"
import { AreaLink as Link } from "@/components/shared/area-routes"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useStaffAuth } from "./staff-auth-session"
import { useStaffDisplayPreferences } from "./staff-display-preferences"
import { StaffPageHeader } from "./staff-shared"
import { StaffNotificationsUnavailable } from "./staff-notifications-unavailable"
import { createNotificationDemoAdapter } from "./staff-notifications-demo-adapter"
import { NOTIFICATION_TYPE_LABELS, formatNotificationTime, isSafeNotificationHref, type DemoNotification, type NotificationDemoAdapter, type NotificationReport } from "./staff-notifications-demo-model"

const icons = { WORK: ClipboardListIcon, INCOME: WalletCardsIcon, PROFILE: CircleUserRoundIcon, SYSTEM: SettingsIcon }
function DemoNotice({ compact = false }: { compact?: boolean }) {
  return <div role="note" className={"staff-notifications-demo-notice" + (compact ? " staff-notifications-demo-notice-compact" : "")}><InfoIcon aria-hidden="true" /><div><strong>DỮ LIỆU MINH HỌA</strong><p>{compact ? "Nội dung và trạng thái đọc chỉ thuộc bản minh họa, không phải thông báo Backend." : "Thông báo hoàn toàn giả lập, không được tạo từ công việc hay thanh toán thật. Chỉ giữ trạng thái đọc khi đang mở trang; F5, rời trang hoặc đăng xuất sẽ đặt lại. Mỗi tài khoản có trạng thái riêng."}</p></div></div>
}
export function StaffNotificationsDemo({ enabled = false }: { enabled?: boolean }) {
  const auth = useStaffAuth()
  if (!auth || auth.status !== "authenticated" || !auth.session || auth.busy === "logout") return null
  if (!enabled || process.env.NODE_ENV !== "development") return <StaffNotificationsUnavailable />
  return <BoundNotifications key={auth.session.user.id} enabled={enabled} accountScope={auth.session.user.id} />
}
function BoundNotifications({ enabled, accountScope }: { enabled: boolean; accountScope: string }) {
  const adapter = useMemo(() => createNotificationDemoAdapter({ enabled, accountScope }), [enabled, accountScope])
  return adapter.kind === "unavailable" ? <StaffNotificationsUnavailable /> : <NotificationsPanel adapter={adapter} />
}
function NoticeIcon({ item }: { item: DemoNotification }) {
  const Icon = icons[item.type]
  return <span className={"staff-notifications-demo-icon staff-notifications-demo-icon-" + item.type.toLowerCase()}><Icon aria-hidden="true" /></span>
}
function NotificationDetail({ adapter, id, version, onClose, onRead, busy }: { adapter: NotificationDemoAdapter; id: string | null; version: number; onClose: () => void; onRead: (id: string) => void; busy: boolean }) {
  const [item, setItem] = useState<DemoNotification | null>(null), [error, setError] = useState(""), [loading, setLoading] = useState(true), [retry, setRetry] = useState(0)
  const display = useStaffDisplayPreferences()
  useEffect(() => {
    if (!id) return
    const controller = new AbortController(); setLoading(true); setError(""); setItem(null)
    void adapter.detail(id, controller.signal).then(value => { if (!controller.signal.aborted) setItem(value) }).catch(() => { if (!controller.signal.aborted) setError("Chưa thể mở thông báo. Vui lòng thử lại.") }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [adapter, id, version, retry])
  return <Dialog open={!!id} onOpenChange={open => { if (!open) onClose() }}><DialogContent showCloseButton={false} className="staff-preference-surface staff-notifications-demo-dialog" data-staff-motion={display?.preferences.motion || "system"} data-staff-focus={display?.preferences.focus || "standard"} data-notification-detail data-notification-detail-id={id || undefined}><DialogHeader><DialogTitle>Chi tiết thông báo</DialogTitle><DialogDescription>Nội dung, thời gian và trạng thái đọc của thông báo đang xem.</DialogDescription></DialogHeader>{adapter.kind === "demo" && <DemoNotice compact />}
    {loading ? <p role="status" aria-busy="true">Đang mở thông báo...</p> : error ? <div role="alert"><p>{error}</p><Button variant="outline" onClick={() => setRetry(value => value + 1)}>Thử lại</Button></div> : !item ? <p role="status">Không tìm thấy thông báo này.</p> : <><div className="staff-notifications-demo-detail-heading"><NoticeIcon item={item} /><div><p className="staff-notifications-demo-type">{NOTIFICATION_TYPE_LABELS[item.type]}</p><h3>{item.title}</h3><time dateTime={item.createdAt}>{formatNotificationTime(item.createdAt)} · Giờ Việt Nam</time></div></div><p className="staff-notifications-demo-body">{item.body}</p><p className="staff-notifications-demo-detail-read">{item.readAt ? <>Đã đọc · <time dateTime={item.readAt}>{formatNotificationTime(item.readAt)}</time></> : "Chưa đọc"}</p><div className="staff-notifications-demo-detail-actions">{!item.readAt && <Button variant="outline" disabled={busy} aria-label={"Đánh dấu đã đọc " + item.id} onClick={() => onRead(item.id)}><CheckIcon aria-hidden="true" />Đánh dấu đã đọc</Button>}{isSafeNotificationHref(item.href) && <Button render={<Link href={item.href} onClick={onClose} data-notification-link />} nativeButton={false}>{item.label}<ChevronRightIcon aria-hidden="true" /></Button>}</div></>}
    <DialogClose render={<Button variant="outline" aria-label="Đóng chi tiết thông báo" />} onClick={onClose}>Đóng chi tiết</DialogClose>
  </DialogContent></Dialog>
}
function NotificationsPanel({ adapter }: { adapter: NotificationDemoAdapter }) {
  const [report, setReport] = useState<NotificationReport | null>(null), [filter, setFilter] = useState<"all" | "unread">("all"), [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [retry, setRetry] = useState(0), [version, setVersion] = useState(0)
  const operation = useRef<AbortController | null>(null), mutation = useRef(false), trigger = useRef<HTMLButtonElement | null>(null), unreadTab = useRef<HTMLButtonElement>(null)
  const isDemo = adapter.kind === "demo"
  useEffect(() => {
    const controller = new AbortController(); operation.current = controller
    setLoading(true); setReport(null); setError("")
    void adapter.list("all", controller.signal).then(value => { if (!controller.signal.aborted) setReport(value) }).catch(() => { if (!controller.signal.aborted) setError("Chưa thể tải thông báo minh họa. Vui lòng thử lại.") }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => { controller.abort(); operation.current?.abort(); mutation.current = false }
  }, [adapter, retry])
  async function change(action: "one" | "all" | "reset", id?: string) {
    if (mutation.current || loading) return
    mutation.current = true; const controller = new AbortController(); operation.current = controller
    setBusy(true); setError(""); setNotice("")
    try {
      const next = action === "one" ? await adapter.markRead(id!, controller.signal) : action === "all" ? await adapter.readAll(controller.signal) : await adapter.reset(controller.signal)
      if (controller.signal.aborted) return
      setReport(next); setVersion(value => value + 1)
      if (action === "reset") { setSelected(null); setFilter("all") }
      setNotice(action === "reset" ? "Đã đặt lại thông báo minh họa." : action === "all" ? "Đã đọc tất cả thông báo trong bản minh họa." : "Đã đánh dấu đọc trong bản minh họa.")
    } catch { if (!controller.signal.aborted) setError("Chưa thể cập nhật trạng thái minh họa. Dữ liệu cũ được giữ; vui lòng thử lại.") }
    finally { if (!controller.signal.aborted) { mutation.current = false; setBusy(false) } }
  }
  function close() {
    setSelected(null)
    window.setTimeout(() => { if (trigger.current?.isConnected) trigger.current.focus(); else unreadTab.current?.focus() }, 0)
  }
  const visible = report?.items.filter(item => filter === "all" || item.readAt === null) || []
  return <div className="staff-notifications-demo min-w-0 space-y-6" data-staff-notifications-demo={loading ? "loading" : error && !report ? "error" : "ready"}>
    <StaffPageHeader title="Thông báo" description="Theo dõi nội dung dành cho bạn trong không gian nhân viên." action={isDemo && <Button variant="outline" disabled={loading || busy} aria-label="Đặt lại thông báo minh họa" onClick={() => void change("reset")}><RotateCcwIcon aria-hidden="true" />Đặt lại minh họa</Button>} />
    {isDemo && <DemoNotice />}
    <Card className="staff-notifications-demo-overview"><CardContent><div className="staff-notifications-demo-count-icon"><BellRingIcon aria-hidden="true" /></div><div><p className="staff-notifications-demo-eyebrow">Hộp thông báo {isDemo ? "minh họa" : ""}</p><h2>{loading ? "Đang tải thông báo" : !report ? "Chưa đọc được thông báo" : <><span data-notifications-unread={report.unreadCount}>{report.unreadCount}</span> thông báo chưa đọc</>}</h2><p>{report ? report.total + " thông báo trong bộ dữ liệu đang xem" : loading ? "Vui lòng chờ trong giây lát." : "Hãy thử tải lại danh sách."} · Giờ Việt Nam (UTC+7)</p></div></CardContent></Card>
    <div className="staff-notifications-demo-toolbar"><div className="staff-notifications-demo-tabs" role="group" aria-label="Lọc thông báo"><Button variant={filter === "all" ? "default" : "ghost"} aria-label="Tất cả thông báo" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>Tất cả{report && <span>{report.total}</span>}</Button><Button ref={unreadTab} variant={filter === "unread" ? "default" : "ghost"} aria-label="Thông báo chưa đọc" aria-pressed={filter === "unread"} onClick={() => setFilter("unread")}>Chưa đọc{report && <span>{report.unreadCount}</span>}</Button></div><Button variant="outline" aria-label="Đọc tất cả thông báo minh họa" disabled={loading || busy || !report?.unreadCount} onClick={() => void change("all")}><CheckCheckIcon aria-hidden="true" />Đọc tất cả</Button></div>
    {notice && <p className="staff-notifications-demo-feedback" role="status" aria-live="polite">{notice}</p>}
    {error && <div className="staff-notifications-demo-error" role="alert"><p>{error}</p>{!report && <Button variant="outline" onClick={() => setRetry(value => value + 1)}>Thử tải lại</Button>}</div>}
    {loading ? <div className="staff-notifications-demo-loading" role="status" aria-busy="true">Đang tải danh sách minh họa...</div> : !report ? !error && <section className="staff-notifications-demo-empty"><BellIcon aria-hidden="true" /><h2>Chưa có dữ liệu thông báo</h2><p>Nguồn dữ liệu hiện chưa cung cấp thông báo.</p></section> : !visible.length ? <section className="staff-notifications-demo-empty"><MailOpenIcon aria-hidden="true" /><h2>{filter === "unread" ? "Bạn đã đọc tất cả thông báo minh họa" : "Chưa có thông báo trong bản minh họa"}</h2><p>{filter === "unread" ? "Không còn thông báo chưa đọc trong bộ minh họa đang mở." : "Đặt lại để xem bộ minh họa ban đầu."}</p><Button variant="outline" onClick={() => setFilter("all")}>Xem tất cả thông báo</Button></section> : <section className="staff-notifications-demo-list" aria-label={filter === "unread" ? "Danh sách thông báo chưa đọc" : "Danh sách tất cả thông báo"}>{visible.map(item => <Card key={item.id} role="article" className={"staff-notifications-demo-item" + (!item.readAt ? " staff-notifications-demo-item-unread" : "")} data-notification-id={item.id} data-notification-read={item.readAt ? "true" : "false"}><CardContent><NoticeIcon item={item} /><div className="staff-notifications-demo-item-content"><div className="staff-notifications-demo-item-meta"><span className="staff-notifications-demo-type">{NOTIFICATION_TYPE_LABELS[item.type]}</span><span className={"staff-notifications-demo-state" + (!item.readAt ? " staff-notifications-demo-state-unread" : "")}>{item.readAt ? "Đã đọc" : "Chưa đọc"}</span></div><h2>{item.title}</h2><p>{item.body}</p><time dateTime={item.createdAt}>{formatNotificationTime(item.createdAt)}</time><div className="staff-notifications-demo-item-actions"><Button variant="outline" aria-label={"Xem thông báo " + item.id} onClick={event => { trigger.current = event.currentTarget; setSelected(item.id) }}>Xem chi tiết<ChevronRightIcon aria-hidden="true" /></Button>{!item.readAt && <Button variant="ghost" disabled={busy} aria-label={"Đánh dấu đã đọc " + item.id} onClick={() => void change("one", item.id)}><CheckIcon aria-hidden="true" />Đánh dấu đã đọc</Button>}</div></div></CardContent></Card>)}</section>}
    <NotificationDetail key={selected || "closed"} adapter={adapter} id={selected} version={version} onClose={close} onRead={id => void change("one", id)} busy={busy} />
  </div>
}
