"use client"

import { useLayoutEffect, useRef, useState, type FormEvent } from "react"
import { AreaLink as Link } from "@/components/shared/area-routes"
import { CalendarDaysIcon, CheckIcon, ClockIcon, MapPinIcon, UserRoundIcon } from "lucide-react"
import { Field, useData } from "../../common"
import { Button } from "../ui/button"
import { Input } from "../ui/input"
import { OrderStatusBadge } from "../shared/status-badge"
import { ORDER_STATUS_LABEL } from "@/lib/config"
import { findConflicts, staffJobsOnDay } from "@/lib/logic"
import { AdminDialog } from "./admin-dialog"
import { adminOrderService } from "./admin-order-service"
import { assignmentBlockReason } from "./admin-scheduling"
import { AdminEmpty, AdminError, AdminLoading, AdminPageHeader, formatAdminTime, getAdminDataError, normalizeSearch } from "./admin-shared"

const PAGE_SIZE = 8

export function AdminAssignment() {
  const context = useData()
  const { s, user, role } = context
  const latest = useRef(context)
  latest.current = context
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState("confirmed")
  const [assignment, setAssignment] = useState("unassigned")
  const [page, setPage] = useState(0)
  const [orderId, setOrderId] = useState("")
  const [staffId, setStaffId] = useState("")
  const [dialog, setDialog] = useState(false)
  const [busy, setBusy] = useState(false)
  const mutex = useRef(false)
  const [error, setError] = useState("")
  const [feedback, setFeedback] = useState("")
  const panel = useRef<HTMLElement>(null)
  const feedbackElement = useRef<HTMLParagraphElement>(null)
  const openingButton = useRef<HTMLButtonElement | null>(null)
  const focusIntent = useRef<"panel" | "feedback" | "return" | "">("")
  const [selectionRequest, setSelectionRequest] = useState(0)

  useLayoutEffect(() => {
    if (focusIntent.current === "panel") {
      panel.current?.focus({ preventScroll: true })
      panel.current?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" })
    } else if (focusIntent.current === "feedback") feedbackElement.current?.focus({ preventScroll: true })
    else if (focusIntent.current === "return") openingButton.current?.focus({ preventScroll: true })
    focusIntent.current = ""
  }, [orderId, dialog, feedback, selectionRequest])

  const close = () => {
    if (mutex.current) return
    focusIntent.current = "return"
    setDialog(false)
    setError("")
  }
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (mutex.current) return
    mutex.current = true
    setBusy(true)
    setError("")
    try {
      const current = latest.current
      const order = current.s?.orders.find((item) => item.id === orderId)
      const staff = current.s?.users.find((item) => item.id === staffId)
      if (!current.s || !current.user || current.role !== "admin" || current.user.role !== "admin" || current.user.status !== "active") { setError("Phiên quản trị không còn hợp lệ. Vui lòng đăng nhập lại."); return }
      if (getAdminDataError(current.s)) { setError("Dữ liệu chưa đọc được. Vui lòng tải lại trang để kiểm tra."); return }
      if (!order) { setError("Đơn không còn trong danh sách. Hãy tải lại để kiểm tra."); return }
      const blocked = assignmentBlockReason(order)
      if (blocked) { setError(blocked); return }
      if (!staff || staff.role !== "staff" || staff.status !== "active") { setError("Nhân viên đã chọn không còn đủ điều kiện nhận phân công."); return }
      if (order.staffId === staff.id) { setError("Đơn đã được phân công cho nhân viên này."); return }
      if (findConflicts(current.s, staff.id, new Date(order.scheduledAt), order.durationMinutes, order.id).length) { setError("Nhân viên bị trùng lịch đã lưu. Hãy chọn nhân viên khác."); return }
      const result = await adminOrderService.assign(order.id, staff.id)
      if (!result.ok) { setError(result.error); return }
      setDialog(false)
      focusIntent.current = "feedback"
      setFeedback(result.persistence === "local" ? "Đã lưu phân công trên trình duyệt này." : "Đã cập nhật phân công trong phiên này. Trình duyệt chưa lưu được; thay đổi có thể mất khi tải lại.")
    } catch { setError("Chưa thể lưu phân công. Vui lòng kiểm tra và thử lại.") }
    finally { mutex.current = false; setBusy(false) }
  }

  if (!s) return <AdminLoading />
  if (!user || role !== "admin" || user.role !== "admin" || user.status !== "active") return <AdminEmpty title="Vui lòng đăng nhập tài khoản quản trị viên" />
  if (getAdminDataError(s)) return <AdminError />
  const services = new Map(s.services.map((service) => [service.id, service]))
  const users = new Map(s.users.map((account) => [account.id, account]))
  const normalized = normalizeSearch(query)
  const orders = s.orders.filter((order) => (!status || order.status === status)
    && (assignment === "all" || (assignment === "assigned" ? Boolean(order.staffId) : !order.staffId))
    && (!normalized || normalizeSearch(`${order.code} ${order.contact.name} ${users.get(order.customerId)?.name || ""} ${services.get(order.serviceId)?.name || ""}`).includes(normalized)))
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())
  const pages = Math.ceil(orders.length / PAGE_SIZE)
  const currentPage = Math.min(page, Math.max(0, pages - 1))
  const displayed = orders.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)
  const selected = s.orders.find((order) => order.id === orderId)
  const selectedStaff = s.users.find((staff) => staff.id === staffId && staff.role === "staff")
  const staff = s.users.filter((account) => account.role === "staff").sort((a, b) => a.name.localeCompare(b.name, "vi"))
  const blocked = selected ? assignmentBlockReason(selected) : ""
  const selectedConflicts = selected && selectedStaff ? findConflicts(s, selectedStaff.id, new Date(selected.scheduledAt), selected.durationMinutes, selected.id) : []
  const alreadyAssigned = Boolean(selected && selectedStaff && selected.staffId === selectedStaff.id)
  const canAssign = Boolean(selected && selectedStaff?.status === "active" && !blocked && !selectedConflicts.length && !alreadyAssigned)
  const hasFilters = query || status !== "confirmed" || assignment !== "unassigned"
  const clear = () => { setQuery(""); setStatus("confirmed"); setAssignment("unassigned"); setPage(0) }

  return <div className="min-w-0 space-y-6">
    <AdminPageHeader title="Phân công nhân viên" description="Chọn đơn đã xác nhận, đối chiếu lịch đã lưu và phân công người thực hiện." />
    {feedback && <p ref={feedbackElement} role="status" aria-live="polite" tabIndex={-1} className="m-0 rounded-xl border border-blue-200 bg-blue-50 px-5 py-4 text-sm leading-7 text-blue-900 outline-offset-2">{feedback}</p>}
    <section aria-label="Tìm và lọc đơn phân công" className="min-w-0 rounded-2xl border border-border bg-white p-5 sm:p-6">
      <div className="grid min-w-0 gap-5 sm:grid-cols-2 xl:grid-cols-3">
        <Field label="Tìm kiếm đơn"><Input type="search" placeholder="Mã đơn, khách hàng, dịch vụ..." value={query} onChange={(event) => { setQuery(event.target.value); setPage(0) }} /></Field>
        <Field label="Trạng thái đơn"><select value={status} onChange={(event) => { setStatus(event.target.value); setPage(0) }}><option value="">Tất cả trạng thái</option>{Object.entries(ORDER_STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
        <Field label="Tình trạng phân công"><select value={assignment} onChange={(event) => { setAssignment(event.target.value); setPage(0) }}><option value="unassigned">Chưa phân công</option><option value="assigned">Đã phân công</option><option value="all">Tất cả đơn</option></select></Field>
      </div>
      <div className="mt-5 flex flex-col items-start gap-4 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between"><p role="status" className="m-0 text-sm text-muted-foreground"><strong className="text-foreground">{orders.length}</strong> đơn phù hợp, xếp theo lịch thực hiện</p><Button variant="outline" disabled={!hasFilters} className="w-full sm:w-auto" onClick={clear}>Xóa bộ lọc</Button></div>
    </section>
    <div className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,25rem)]">
      <section aria-label="Danh sách đơn phân công" className="min-w-0 space-y-4">
        {!orders.length ? <AdminEmpty title={s.orders.length ? "Không có đơn phù hợp" : "Chưa có đơn dịch vụ"} description={s.orders.length ? "Thử tìm kiếm khác hoặc đổi tình trạng phân công để xem các đơn đã có." : "Đơn mới sẽ xuất hiện khi có dữ liệu."} action={hasFilters ? <Button variant="outline" onClick={clear}>Xóa bộ lọc</Button> : undefined} /> : displayed.map((order) => <article key={order.id} className={`min-w-0 rounded-2xl border bg-white p-5 sm:p-6 ${order.id === orderId ? "border-blue-400 ring-1 ring-blue-200" : "border-border"}`}>
          <div className="flex flex-wrap items-center justify-between gap-3"><span className="break-words text-xs font-semibold text-muted-foreground">{order.code}</span><OrderStatusBadge status={order.status} /></div>
          <h2 className="m-0 mt-4 break-words text-lg leading-7 font-semibold">{services.get(order.serviceId)?.name || "Dịch vụ không còn trong danh sách"}</h2>
          <dl className="m-0 mt-4 grid min-w-0 gap-3 text-sm leading-6">
            <div className="flex min-w-0 gap-3"><UserRoundIcon aria-hidden="true" className="mt-1 size-4 shrink-0 text-muted-foreground" /><dt className="sr-only">Khách hàng</dt><dd className="m-0 min-w-0 break-words">{order.contact.name}</dd></div>
            <div className="flex min-w-0 gap-3"><CalendarDaysIcon aria-hidden="true" className="mt-1 size-4 shrink-0 text-primary" /><dt className="sr-only">Lịch thực hiện</dt><dd className="m-0 min-w-0 break-words">{formatAdminTime(order.scheduledAt)}</dd></div>
            <div className="flex min-w-0 gap-3"><ClockIcon aria-hidden="true" className="mt-1 size-4 shrink-0 text-muted-foreground" /><dt className="sr-only">Thời lượng</dt><dd className="m-0 break-words">{order.durationMinutes} phút · {order.quantity} {services.get(order.serviceId)?.unit || "đơn vị"}</dd></div>
            <div className="flex min-w-0 gap-3"><MapPinIcon aria-hidden="true" className="mt-1 size-4 shrink-0 text-muted-foreground" /><dt className="sr-only">Địa điểm</dt><dd className="m-0 min-w-0 break-words">{order.contact.address}</dd></div>
          </dl>
          <p className="m-0 mt-4 break-words text-sm leading-6 text-muted-foreground">{order.staffId ? `Nhân viên: ${users.get(order.staffId)?.name || "Không còn trong danh sách"}` : "Chưa phân công nhân viên"}</p>
          <div className="mt-5 grid gap-3 border-t border-border pt-4 sm:grid-cols-2"><Button variant={order.id === orderId ? "default" : "outline"} aria-label={`Chọn đơn ${order.code}`} aria-pressed={order.id === orderId} onClick={() => { focusIntent.current = "panel"; setSelectionRequest((value) => value + 1); setOrderId(order.id); setStaffId(""); setFeedback("") }}>{order.id === orderId && <CheckIcon aria-hidden="true" />}Chọn đơn</Button><Button variant="outline" render={<Link href={`/don/${order.id}`} />} nativeButton={false} aria-label={`Xem chi tiết đơn ${order.code}`}>Xem chi tiết</Button></div>
        </article>)}
        {pages > 1 && <nav aria-label="Phân trang đơn phân công" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-white p-4"><Button variant="outline" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Trang trước</Button><span className="text-sm text-muted-foreground">{currentPage + 1} / {pages}</span><Button variant="outline" disabled={currentPage >= pages - 1} onClick={() => setPage(currentPage + 1)}>Trang sau</Button></nav>}
      </section>
      <section ref={panel} tabIndex={-1} aria-label="Chọn nhân viên thực hiện" className="min-w-0 scroll-mt-24 space-y-5 rounded-2xl border border-border bg-white p-5 outline-offset-4 sm:p-6">
        <div><h2 className="m-0 text-lg font-semibold">Nhân viên thực hiện</h2><p className="m-0 mt-3 text-sm leading-7 text-muted-foreground">Đối chiếu các lịch đã lưu; thông tin này chưa xác nhận được lịch trống thực tế của nhân viên.</p></div>
        {!selected ? <AdminEmpty title={orderId ? "Đơn không còn trong danh sách" : "Chọn đơn cần phân công"} description="Thông tin lịch và nhân viên sẽ hiển thị sau khi bạn chọn một đơn." /> : <>
          <div className="min-w-0 rounded-xl border border-blue-100 bg-blue-50 p-4"><p className="m-0 break-words text-sm font-semibold text-primary">{selected.code}</p><p className="m-0 mt-2 break-words text-sm leading-6 font-semibold">{services.get(selected.serviceId)?.name || "Dịch vụ không còn trong danh sách"}</p><p className="m-0 mt-2 text-sm leading-6">{formatAdminTime(selected.scheduledAt)} · {selected.durationMinutes} phút</p>{selected.staffId && <p className="m-0 mt-2 break-words text-sm leading-6">Đang giao: {users.get(selected.staffId)?.name || "Không còn trong danh sách"}</p>}</div>
          {blocked && <p role="status" className="m-0 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-7 text-amber-900">{blocked} <Link href={`/don/${selected.id}`} className="font-semibold underline underline-offset-4">Mở chi tiết đơn</Link></p>}
          {!staff.length ? <AdminEmpty title="Chưa có tài khoản nhân viên" description="Kiểm tra danh sách tài khoản trước khi phân công." /> : <div className="space-y-3">{staff.map((account) => {
            const conflicts = findConflicts(s, account.id, new Date(selected.scheduledAt), selected.durationMinutes, selected.id)
            const jobs = staffJobsOnDay(s, account.id, new Date(selected.scheduledAt))
            const disabled = account.status !== "active" || Boolean(blocked) || conflicts.length > 0
            return <article key={account.id} className={`min-w-0 rounded-xl border p-4 ${account.id === staffId ? "border-blue-400 bg-blue-50/50" : "border-border"}`}>
              <h3 className="m-0 break-words text-sm leading-6 font-semibold">{account.name}</h3>
              <p className={`m-0 mt-2 text-sm leading-6 ${account.status !== "active" || conflicts.length ? "text-amber-800" : "text-muted-foreground"}`}>{account.status !== "active" ? "Tài khoản đã khóa" : conflicts.length ? `Trùng ${conflicts.length} lịch đã lưu` : "Không trùng lịch đã lưu"}</p>
              {jobs.length > 0 && <details className="mt-3 text-xs leading-6"><summary className="min-h-11 cursor-pointer rounded-md py-2 font-medium focus-visible:outline-2 focus-visible:outline-ring">{jobs.length} công việc đã lưu trong ngày</summary><ul className="m-0 mt-2 list-none space-y-2 p-0">{jobs.map((job) => <li key={job.id} className="min-w-0 break-words rounded-lg bg-slate-50 p-3"><Link href={`/don/${job.id}`} className="font-semibold text-primary underline underline-offset-4">{job.code}</Link><span className="block">{services.get(job.serviceId)?.name || "Dịch vụ không còn trong danh sách"}</span><span className="block">{formatAdminTime(job.scheduledAt)} · {job.durationMinutes} phút</span><span className="block">{ORDER_STATUS_LABEL[job.status]}{conflicts.some((conflict) => conflict.id === job.id) ? " · Trùng lịch" : ""}</span></li>)}</ul></details>}
              <Button variant={account.id === staffId ? "default" : "outline"} className="mt-3 w-full whitespace-normal" disabled={disabled} aria-label={`Chọn nhân viên ${account.name}`} aria-pressed={account.id === staffId} onClick={() => { setStaffId(account.id); setFeedback("") }}>{account.id === staffId ? "Đã chọn nhân viên" : "Chọn nhân viên"}</Button>
            </article>
          })}</div>}
          {alreadyAssigned && <p role="status" className="m-0 text-sm leading-7 text-muted-foreground">Đơn đã được giao cho nhân viên này. Chọn người khác nếu cần đổi phân công.</p>}
          <Button className="w-full whitespace-normal" disabled={!canAssign} onClick={(event) => { openingButton.current = event.currentTarget; setError(""); setDialog(true) }}>Xác nhận phân công</Button>
        </>}
      </section>
    </div>
    {dialog && selected && <AdminDialog title="Xác nhận phân công nhân viên" busy={busy} error={error} isBusy={() => mutex.current} close={close} submit={submit} submitLabel="Lưu phân công"><dl className="m-0 grid min-w-0 gap-4 text-sm leading-7">{[["Đơn dịch vụ", selected.code], ["Dịch vụ", services.get(selected.serviceId)?.name || "Không còn trong danh sách"], ["Lịch thực hiện", formatAdminTime(selected.scheduledAt)], ["Thời lượng", `${selected.durationMinutes} phút`], ["Nhân viên", selectedStaff?.name || "Không còn trong danh sách"]].map(([label, value]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="m-0 break-words font-semibold">{value}</dd></div>)}</dl><p className="m-0 rounded-xl bg-blue-50 p-4 text-sm leading-7 text-blue-900">Phân công được kiểm tra lại với lịch đã lưu trước khi cập nhật. Lịch thực hiện và chi phí của đơn được giữ nguyên.</p></AdminDialog>}
  </div>
}
