"use client"

import { useEffect, useRef, useState } from "react"
import { useStaffNotificationView } from "./staff-notification-view-preferences"
import { BellIcon, BellRingIcon, CheckCheckIcon, CheckIcon, MailOpenIcon, RefreshCwIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { StaffEmpty, StaffLoading, StaffPageHeader } from "./staff-shared"
import {
  DEFAULT_STAFF_NOTIFICATIONS_QUERY, formatStaffNotificationTime, parseStaffMarkRead, parseStaffNotificationsPage,
  parseStaffReadAll, staffNotificationsQueryString,
  type StaffNotification, type StaffNotificationsPage, type StaffNotificationsQuery,
} from "./staff-notifications-remote-model"

class NotificationsRequestError extends Error {
  constructor(readonly status: number, readonly code: string) { super("Staff notifications request failed") }
}

function requestMessage(reason: unknown): string {
  if (!(reason instanceof NotificationsRequestError)) return "Chưa thể tải thông báo. Vui lòng kiểm tra kết nối và thử lại."
  if (reason.status === 401) return "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại để xem thông báo."
  if (reason.code === "STAFF_SESSION_CHANGED") return "Tài khoản đăng nhập đã thay đổi. Vui lòng tải lại trang."
  if (reason.status === 403) return "Tài khoản hiện không có quyền xem thông báo. Vui lòng liên hệ người quản lý."
  if (reason.status === 429) return "Bạn đã gửi nhiều yêu cầu. Vui lòng chờ một lúc rồi thử lại."
  if (reason.status === 404) return "Thông báo không còn tồn tại. Danh sách sẽ được tải lại."
  if (reason.status === 502 || reason.code === "STAFF_INVALID_RESPONSE") return "Dữ liệu thông báo chưa đọc được. Vui lòng thử lại hoặc liên hệ người quản lý."
  return "Thông báo hiện chưa khả dụng. Vui lòng thử lại sau."
}

async function readJson(response: Response): Promise<unknown> {
  if (response.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    throw new NotificationsRequestError(502, "STAFF_INVALID_RESPONSE")
  }
  const reader = response.body?.getReader()
  if (!reader) throw new NotificationsRequestError(502, "STAFF_INVALID_RESPONSE")
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > 1_048_576) { await reader.cancel(); throw new NotificationsRequestError(502, "STAFF_INVALID_RESPONSE") }
      chunks.push(chunk.value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  let body: unknown
  try { body = JSON.parse(new TextDecoder().decode(bytes)) } catch { throw new NotificationsRequestError(502, "STAFF_INVALID_RESPONSE") }
  if (!response.ok) {
    const error = body && typeof body === "object" && "error" in body ? (body as { error?: unknown }).error : null
    const code = error && typeof error === "object" && "code" in error && typeof (error as { code?: unknown }).code === "string"
      ? (error as { code: string }).code : "REQUEST_FAILED"
    throw new NotificationsRequestError(response.status, code)
  }
  return body
}

function request(query: StaffNotificationsQuery, accountId: string, signal: AbortSignal): Promise<StaffNotificationsPage> {
  return fetch(`/api/staff/notifications?${staffNotificationsQueryString(query)}`, {
    method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error", signal,
    headers: { Accept: "application/json", "X-Staff-Account-Id": accountId },
  }).then(async response => {
    const body = await readJson(response)
    const page = parseStaffNotificationsPage(body, query)
    if (!page) throw new NotificationsRequestError(502, "STAFF_INVALID_RESPONSE")
    return page
  })
}

function mutate(path: string, accountId: string, signal: AbortSignal): Promise<unknown> {
  return fetch(path, {
    method: "PATCH", credentials: "same-origin", cache: "no-store", redirect: "error", signal,
    headers: { Accept: "application/json", "Content-Type": "application/json", "X-Staff-Account-Id": accountId },
    body: "{}",
  }).then(readJson)
}

export function StaffNotificationsRemote({ accountId }: { accountId: string }) {
  const view = useStaffNotificationView(accountId)
  if (!view.ready) return <div role="status" aria-busy="true">Đang tải tùy chọn thông báo...</div>
  return <StaffNotificationsContent key={accountId} accountId={accountId} initialUnreadOnly={view.unreadOnly} />
}
function StaffNotificationsContent({ accountId, initialUnreadOnly }: { accountId: string; initialUnreadOnly: boolean }) {
  const [query, setQuery] = useState<StaffNotificationsQuery>(() => ({ ...DEFAULT_STAFF_NOTIFICATIONS_QUERY, unreadOnly: initialUnreadOnly }))
  const [report, setReport] = useState<StaffNotificationsPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [retry, setRetry] = useState(0)
  const [selected, setSelected] = useState<StaffNotification | null>(null)
  const detailTrigger = useRef<HTMLButtonElement>(null)
  const mutationBusy = useRef(false), mounted = useRef(true)
  const operation = useRef<AbortController | null>(null)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; operation.current?.abort() } }, [])

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    const timer = window.setTimeout(() => controller.abort(), 15000)
    operation.current = controller
    setLoading(true); setReport(null); setError(""); setNotice("")
    void request(query, accountId, controller.signal)
      .then(value => { if (!controller.signal.aborted) setReport(value) })
      .catch(reason => { if (active) setError(requestMessage(reason)) })
      .finally(() => { window.clearTimeout(timer); if (active) setLoading(false) })
    return () => { active = false; controller.abort(); window.clearTimeout(timer) }
  }, [accountId, query, retry])

  function changeFilter(unreadOnly: boolean) {
    setQuery(current => ({ ...current, unreadOnly, page: 1 }))
  }

  async function markOne(id: string) {
    if (mutationBusy.current) return
    mutationBusy.current = true
    const controller = new AbortController(); operation.current = controller
    const timer = window.setTimeout(() => controller.abort(), 15000)
    setBusy(true); setError(""); setNotice("")
    try {
      const body = await mutate(`/api/staff/notifications/${encodeURIComponent(id)}/read`, accountId, controller.signal)
      const parsed = parseStaffMarkRead(body)
      if (!parsed) throw new NotificationsRequestError(502, "STAFF_INVALID_RESPONSE")
      if (controller.signal.aborted) return
      setSelected(current => current?.id === id ? parsed.data : current)
      setReport(current => current ? {
        ...current,
        unreadCount: parsed.unreadCount,
        data: current.data.map(item => item.id === id ? parsed.data : item),
      } : current)
      setNotice("Đã đánh dấu thông báo là đã đọc.")
      if (query.unreadOnly) setQuery(current => ({ ...current, page: 1 }))
    } catch (reason) { if (mounted.current) setError(requestMessage(reason)) }
    finally { window.clearTimeout(timer); mutationBusy.current = false; if (mounted.current) setBusy(false) }
  }

  async function markAll() {
    if (mutationBusy.current || !report?.unreadCount) return
    mutationBusy.current = true
    const controller = new AbortController(); operation.current = controller
    const timer = window.setTimeout(() => controller.abort(), 15000)
    setBusy(true); setError(""); setNotice("")
    try {
      const body = await mutate("/api/staff/notifications/read-all", accountId, controller.signal)
      const parsed = parseStaffReadAll(body)
      if (!parsed) throw new NotificationsRequestError(502, "STAFF_INVALID_RESPONSE")
      if (controller.signal.aborted) return
      setNotice(parsed.data.updated > 0 ? `Đã đánh dấu ${parsed.data.updated} thông báo là đã đọc.` : parsed.data.unreadCount > 0 ? "Có thông báo mới. Danh sách đang được cập nhật." : "Không còn thông báo chưa đọc.")
      setQuery(current => ({ ...current, page: 1 }))
      setRetry(value => value + 1)
    } catch (reason) { if (mounted.current) setError(requestMessage(reason)) }
    finally { window.clearTimeout(timer); mutationBusy.current = false; if (mounted.current) setBusy(false) }
  }

  const items: StaffNotification[] = report?.data || []
  return <div className="staff-notifications min-w-0 space-y-6" data-staff-notifications="remote">
    <StaffPageHeader title="Thông báo" description="Cập nhật dành cho bạn." />
    <Card className="staff-notifications-panel"><CardContent>
      <div className="staff-notifications-summary">
        <span className="staff-notifications-symbol"><BellRingIcon aria-hidden="true" /></span>
        <div>
          <p className="staff-notifications-eyebrow">Hộp thông báo</p>
          <h2>{loading ? "Đang tải thông báo" : !report ? "Chưa đọc được thông báo" : <><span data-staff-notifications-unread={report.unreadCount}>{report.unreadCount}</span> thông báo chưa đọc</>}</h2>
          <p>{report ? `${report.pagination.total} thông báo trong hộp thư của bạn` : loading ? "Vui lòng chờ trong giây lát." : "Hãy thử tải lại danh sách."} · Giờ Việt Nam</p>
        </div>
      </div>
    </CardContent></Card>
    <div className="staff-notifications-toolbar" role="group" aria-label="Lọc thông báo">
      <Button disabled={busy || loading} variant={query.unreadOnly ? "ghost" : "default"} aria-pressed={!query.unreadOnly} onClick={() => changeFilter(false)}>Tất cả{report && <span> {report.pagination.total}</span>}</Button>
      <Button disabled={busy || loading} variant={query.unreadOnly ? "default" : "ghost"} aria-pressed={query.unreadOnly} onClick={() => changeFilter(true)}>Chưa đọc{report && <span> {report.unreadCount}</span>}</Button>
      <Button variant="outline" disabled={loading || busy || !report?.unreadCount} onClick={() => void markAll()}><CheckCheckIcon aria-hidden="true" />Đọc tất cả</Button>
    </div>
    {notice && <p className="staff-notifications-feedback" role="status" aria-live="polite">{notice}</p>}
    {error && <div className="staff-notifications-error" role="alert"><p>{error}</p><Button variant="outline" onClick={() => setRetry(value => value + 1)}><RefreshCwIcon aria-hidden="true" />Thử lại</Button></div>}
    {loading && !report ? <StaffLoading /> : !report ? (!error && <StaffEmpty title="Chưa có dữ liệu thông báo" description="Hộp thư của bạn hiện chưa có thông báo nào." />) : !items.length
      ? <StaffEmpty title={query.unreadOnly ? "Bạn đã đọc tất cả thông báo" : "Hộp thư đang trống"} description={query.unreadOnly ? "Không còn thông báo chưa đọc trong hộp thư của bạn." : "Thông báo mới sẽ xuất hiện khi hệ thống gửi cho tài khoản của bạn."} action={query.unreadOnly ? <Button variant="outline" onClick={() => changeFilter(false)}>Xem tất cả thông báo</Button> : undefined} />
      : <section className="staff-notifications-list" aria-label={query.unreadOnly ? "Danh sách thông báo chưa đọc" : "Danh sách tất cả thông báo"}>
        {items.map(item => <Card key={item.id} role="article" className={"staff-notifications-item" + (item.readAt ? "" : " staff-notifications-item-unread")} data-staff-notification-id={item.id} data-staff-notification-read={item.readAt ? "true" : "false"}><CardContent>
          <span className="staff-notifications-symbol" aria-hidden="true">{item.readAt ? <MailOpenIcon /> : <BellIcon />}</span>
          <div className="staff-notifications-item-content">
            <div className="staff-notifications-item-meta"><span className={"staff-notifications-state" + (item.readAt ? "" : " staff-notifications-state-unread")}>{item.readAt ? "Đã đọc" : "Chưa đọc"}</span></div>
            <p className="staff-notifications-body">{item.content}</p>
            <time dateTime={item.createdAt}>{formatStaffNotificationTime(item.createdAt)}</time>
            <div className="staff-notifications-item-actions"><Button variant="outline" aria-label={"Xem thông báo " + item.id} onClick={event => { detailTrigger.current = event.currentTarget; setSelected(item) }}>Xem chi tiết</Button></div>
            {!item.readAt && <div className="staff-notifications-item-actions"><Button variant="outline" disabled={busy} aria-label={"Đánh dấu đã đọc thông báo " + item.id} onClick={() => void markOne(item.id)}><CheckIcon aria-hidden="true" />Đánh dấu đã đọc</Button></div>}
          </div>
        </CardContent></Card>)}
      </section>}
    {report && report.pagination.totalPages > 1 && <nav className="staff-notifications-pagination" aria-label="Phân trang thông báo">
      <Button variant="outline" disabled={busy || query.page <= 1} onClick={() => setQuery(current => ({ ...current, page: current.page - 1 }))}>Trang trước</Button>
      <span>Trang {report.pagination.page} / {report.pagination.totalPages}</span>
      <Button variant="outline" disabled={busy || query.page >= report.pagination.totalPages} onClick={() => setQuery(current => ({ ...current, page: current.page + 1 }))}>Trang sau</Button>
    </nav>}
    <Dialog open={!!selected} onOpenChange={open => { if (!open) setSelected(null) }}><DialogContent finalFocus={detailTrigger} className="staff-notification-detail-dialog" data-staff-notification-detail={selected?.id}><DialogHeader><DialogTitle>Nội dung thông báo</DialogTitle><DialogDescription>{selected?.readAt ? "Đã đọc" : "Chưa đọc"}{selected ? " · " + formatStaffNotificationTime(selected.createdAt) : ""}</DialogDescription></DialogHeader>
      <p className="staff-notification-detail-body">{selected?.content}</p>
      {selected?.bookingId && <p>Đơn dịch vụ #{selected.bookingId}</p>}
      <div className="staff-notification-detail-actions">{selected && !selected.readAt && <Button disabled={busy} onClick={() => void markOne(selected.id)}>Đánh dấu đã đọc</Button>}<DialogClose render={<Button variant="outline" />}>Đóng</DialogClose></div>
      {error && <p role="alert">{error}</p>}
    </DialogContent></Dialog>
  </div>
}
