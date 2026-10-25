"use client"

import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from "react"
import { AreaLink as Link } from "@/components/shared/area-routes"
import { CheckIcon, CreditCardIcon, InfoIcon, RotateCcwIcon } from "lucide-react"
import type { AppState, Payment } from "@/lib/types"
import { Field, money, useData } from "../../common"
import { Button } from "../ui/button"
import { Card, CardContent } from "../ui/card"
import { Input } from "../ui/input"
import { ToneBadge } from "../shared/status-badge"
import { AdminDialog } from "./admin-dialog"
import { AdminEmpty, AdminError, AdminLoading, AdminPageHeader, localDateKey, normalizeSearch } from "./admin-shared"
import { formatAdminDateTime, getAdminCommerceDataError } from "./admin-display"
import { adminOrderService } from "./admin-order-service"

const PAGE_SIZE = 8
const METHOD_LABEL = { cash: "Tiền mặt", transfer: "Chuyển khoản" }
type Feedback = { message: string; warning?: boolean }

function PaymentBadge({ payment }: { payment: Payment }) {
  return <ToneBadge tone={payment.status === "paid" ? "success" : payment.status === "pending" ? "warning" : "neutral"}>{payment.status === "paid" ? "Đã xác nhận đã nhận tiền" : payment.status === "pending" ? "Chờ xác nhận đã nhận tiền" : "Chưa ghi nhận đã nhận tiền"}</ToneBadge>
}

function PaymentItem({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return <div className={`min-w-0 ${wide ? "sm:col-span-2" : ""}`}><dt className="mb-1.5 text-xs text-muted-foreground">{label}</dt><dd className="m-0 break-words text-sm leading-7">{children}</dd></div>
}

function paymentCanConfirm(state: AppState, payment: Payment | undefined) {
  const order = state.orders.find((item) => item.id === payment?.orderId)
  return Boolean(payment && (payment.status === "pending" || payment.status === "unpaid") && Number.isFinite(payment.amount) && payment.amount >= 0 && order && order.status !== "cancelled")
}

function PaymentDetail({ payment, state }: { payment: Payment; state: AppState }) {
  const order = state.orders.find((item) => item.id === payment.orderId)
  const customer = state.users.find((item) => item.id === order?.customerId)
  const service = state.services.find((item) => item.id === order?.serviceId)
  return <div className="min-w-0 space-y-5">
    <div className="flex min-w-0 items-start gap-3 rounded-xl bg-blue-50/60 p-4"><span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white text-primary"><CreditCardIcon aria-hidden="true" className="size-5" /></span><div className="min-w-0"><h3 className="m-0 break-words text-base leading-7 font-semibold">{payment.code}</h3><p className="m-0 mt-1 break-words text-2xl font-semibold text-primary">{money(payment.amount)}</p><div className="mt-3 flex flex-wrap gap-2"><PaymentBadge payment={payment} />{payment.refundRequired && <ToneBadge tone="warning">Cần xem xét hoàn tiền</ToneBadge>}</div></div></div>
    <dl className="m-0 grid min-w-0 gap-5 sm:grid-cols-2"><PaymentItem label="Phương thức">{METHOD_LABEL[payment.method]}</PaymentItem><PaymentItem label="Ngày tạo bản ghi">{formatAdminDateTime(payment.createdAt)}</PaymentItem><PaymentItem label="Ngày ghi nhận nhận tiền" wide>{payment.confirmedAt ? formatAdminDateTime(payment.confirmedAt) : "Chưa có ngày xác nhận trong bản ghi"}</PaymentItem><PaymentItem label="Đơn dịch vụ" wide>{order ? <Link href={`/don/${order.id}`} className="inline-flex min-h-11 items-center rounded-lg font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">Xem đơn {order.code}</Link> : <span className="text-amber-800">Không tìm thấy đơn liên quan đến bản ghi này.</span>}</PaymentItem><PaymentItem label="Dịch vụ">{service?.name || "Không tìm thấy dịch vụ liên quan"}</PaymentItem><PaymentItem label="Khách hàng">{customer?.name || order?.contact.name || "Không tìm thấy khách hàng liên quan"}</PaymentItem>{order && <><PaymentItem label="Người liên hệ">{order.contact.name}</PaymentItem><PaymentItem label="Số điện thoại">{order.contact.phone}</PaymentItem><PaymentItem label="Địa chỉ thực hiện" wide>{order.contact.address}</PaymentItem></>}</dl>
    {payment.refundRequired && <p className="m-0 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-7 text-amber-900">Bản ghi đang được đánh dấu cần xem xét hoàn tiền. Dấu này không xác nhận đã hoàn tiền cho khách hàng.</p>}
    <p className="m-0 rounded-xl bg-slate-50 p-4 text-sm leading-7 text-muted-foreground">Thông tin này là bản ghi nhận tiền lưu trên trình duyệt. Không xác minh giao dịch ngân hàng hoặc thực hiện hoàn tiền.</p>
  </div>
}

export function AdminPayments() {
  const context = useData()
  const { s, user, role } = context
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState("")
  const [method, setMethod] = useState("")
  const [refund, setRefund] = useState("")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [sort, setSort] = useState("created-desc")
  const [page, setPage] = useState(0)
  const [dialog, setDialog] = useState<"view" | "confirm" | null>(null)
  const [targetId, setTargetId] = useState("")
  const [submitError, setSubmitError] = useState("")
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const latest = useRef(context)
  latest.current = context
  const submitting = useRef(false)
  const mounted = useRef(true)
  const dialogTrigger = useRef<HTMLElement | null>(null)
  const pageElement = useRef<HTMLDivElement>(null)
  const feedbackElement = useRef<HTMLDivElement>(null)
  const focusIntent = useRef<"trigger" | "feedback" | null>(null)

  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useLayoutEffect(() => {
    if (busy || dialog || !focusIntent.current) return
    const target = focusIntent.current === "feedback" ? feedbackElement.current : dialogTrigger.current?.isConnected ? dialogTrigger.current : pageElement.current
    if (target) { target.focus({ preventScroll: focusIntent.current === "trigger" }); focusIntent.current = null }
  }, [busy, dialog, feedback])

  if (!s) return <AdminLoading />
  if (!user || role !== "admin" || user.role !== "admin" || user.status !== "active") return <AdminEmpty title="Vui lòng đăng nhập tài khoản quản trị viên" />
  if (getAdminCommerceDataError(s)) return <AdminError title="Chưa thể tải dữ liệu thanh toán" />

  const dateError = from && to && from > to ? "Ngày kết thúc phải bằng hoặc sau ngày bắt đầu." : ""
  const normalizedQuery = normalizeSearch(query)
  const filtered = s.payments.filter((payment) => {
    const order = s.orders.find((item) => item.id === payment.orderId)
    const customer = s.users.find((item) => item.id === order?.customerId)
    const service = s.services.find((item) => item.id === order?.serviceId)
    const haystack = `${payment.code} ${order?.code || ""} ${customer?.name || ""} ${customer?.phone || ""} ${order?.contact.name || ""} ${order?.contact.phone || ""} ${service?.name || ""}`
    const day = localDateKey(payment.createdAt)
    return !dateError && (!normalizedQuery || normalizeSearch(haystack).includes(normalizedQuery)) && (!status || payment.status === status) && (!method || payment.method === method) && (!refund || Boolean(payment.refundRequired) === (refund === "required")) && (!from || day >= from) && (!to || day <= to)
  }).sort((a, b) => sort.startsWith("amount") ? (a.amount - b.amount) * (sort === "amount-asc" ? 1 : -1) : (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * (sort === "created-asc" ? 1 : -1))
  const pages = Math.ceil(filtered.length / PAGE_SIZE)
  const currentPage = Math.min(page, Math.max(0, pages - 1))
  const displayed = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)
  const target = s.payments.find((payment) => payment.id === targetId)
  const hasFilters = Boolean(query || status || method || refund || from || to || sort !== "created-desc")
  const clearFilters = () => { setQuery(""); setStatus(""); setMethod(""); setRefund(""); setFrom(""); setTo(""); setSort("created-desc"); setPage(0) }
  const closeDialog = () => { if (submitting.current) return; focusIntent.current = "trigger"; setDialog(null); setSubmitError("") }
  const openDialog = (payment: Payment, kind: "view" | "confirm", trigger: HTMLElement) => { if (submitting.current) return; dialogTrigger.current = trigger; setTargetId(payment.id); setDialog(kind); setSubmitError(""); setFeedback(null) }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submitting.current) return
    const current = latest.current
    if (!current.s) { setSubmitError("Chưa thể đọc dữ liệu. Vui lòng tải lại trang."); return }
    if (getAdminCommerceDataError(current.s)) { setSubmitError("Dữ liệu đã thay đổi và chưa thể đọc đầy đủ. Vui lòng tải lại trang."); return }
    if (dialog === "view") { if (paymentCanConfirm(current.s, current.s.payments.find((payment) => payment.id === targetId))) { setDialog("confirm"); setSubmitError("") } else closeDialog(); return }
    const actor = current.s.users.find((item) => item.id === current.s.session?.userId)
    const payment = current.s.payments.find((item) => item.id === targetId)
    if (current.role !== "admin" || current.user?.id !== actor?.id || current.s.session?.role !== "admin" || actor?.role !== "admin" || actor.status !== "active") { setSubmitError("Bạn không còn quyền xác nhận thanh toán. Vui lòng đăng nhập lại."); return }
    if (!paymentCanConfirm(current.s, payment)) { setSubmitError("Bản ghi đã được xác nhận, đơn đã hủy hoặc không còn đơn liên quan. Vui lòng kiểm tra lại."); return }
    submitting.current = true
    setBusy(true)
    setSubmitError("")
    try {
      const result = await adminOrderService.confirmPayment(targetId)
      if (!mounted.current) return
      if (!result.ok) { setSubmitError(result.error); return }
      focusIntent.current = "feedback"
      setDialog(null)
      setFeedback(result.persistence === "local" ? { message: "Đã lưu ghi nhận nhận tiền trên trình duyệt này." } : { message: "Đã cập nhật ghi nhận nhận tiền trong phiên hiện tại. Trình duyệt chưa lưu được thay đổi; tải lại trang có thể mất dữ liệu.", warning: true })
    } catch { if (mounted.current) setSubmitError("Chưa thể ghi nhận nhận tiền. Vui lòng thử lại.") }
    finally { submitting.current = false; if (mounted.current) setBusy(false) }
  }

  const actionsFor = (payment: Payment) => <div className="flex min-w-0 flex-wrap gap-2"><Button type="button" variant="outline" size="sm" className="min-h-11 max-w-full whitespace-normal" disabled={busy} onClick={(event) => openDialog(payment, "view", event.currentTarget)} aria-label={`Xem thanh toán ${payment.code}`}>Xem chi tiết</Button>{paymentCanConfirm(s, payment) && <Button type="button" size="sm" className="min-h-11 max-w-full whitespace-normal" disabled={busy} onClick={(event) => openDialog(payment, "confirm", event.currentTarget)} aria-label={`Ghi nhận đã nhận tiền ${payment.code}`}>Ghi nhận đã nhận tiền</Button>}</div>

  return <div ref={pageElement} tabIndex={-1} className="min-w-0 focus:outline-none">
    <AdminPageHeader title="Quản lý thanh toán" description="Theo dõi số tiền, phương thức và trạng thái ghi nhận của từng đơn dịch vụ." />
    {feedback && <div ref={feedbackElement} tabIndex={-1} role="status" className={`mb-5 flex min-w-0 gap-3 rounded-xl border p-4 text-sm leading-7 outline-none focus-visible:ring-2 focus-visible:ring-ring ${feedback.warning ? "border-amber-200 bg-amber-50 text-amber-900" : "border-emerald-200 bg-emerald-50 text-emerald-900"}`}>{feedback.warning ? <InfoIcon aria-hidden="true" className="mt-1 size-5 shrink-0" /> : <CheckIcon aria-hidden="true" className="mt-1 size-5 shrink-0" />}<span className="min-w-0 break-words">{feedback.message}</span></div>}
    <Card className="mb-6 min-w-0 border-border/80 py-0 shadow-sm"><CardContent className="min-w-0 p-4 sm:p-5"><div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-4"><div className="min-w-0 sm:col-span-2"><Field label="Tìm thanh toán"><Input name="payment-search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0) }} placeholder="Mã thanh toán, mã đơn, khách hàng, điện thoại..." className="min-h-11 min-w-0" /></Field></div><Field label="Trạng thái ghi nhận"><select name="payment-status" value={status} onChange={(event) => { setStatus(event.target.value); setPage(0) }} className="min-h-11 w-full min-w-0 rounded-lg border border-input bg-white px-3 text-sm"><option value="">Tất cả trạng thái</option><option value="unpaid">Chưa ghi nhận tiền</option><option value="pending">Chờ xác nhận</option><option value="paid">Đã ghi nhận tiền</option></select></Field><Field label="Phương thức"><select name="payment-method" value={method} onChange={(event) => { setMethod(event.target.value); setPage(0) }} className="min-h-11 w-full min-w-0 rounded-lg border border-input bg-white px-3 text-sm"><option value="">Tất cả phương thức</option><option value="cash">Tiền mặt</option><option value="transfer">Chuyển khoản</option></select></Field><Field label="Xem xét hoàn tiền"><select name="payment-refund" value={refund} onChange={(event) => { setRefund(event.target.value); setPage(0) }} className="min-h-11 w-full min-w-0 rounded-lg border border-input bg-white px-3 text-sm"><option value="">Tất cả bản ghi</option><option value="required">Cần xem xét hoàn tiền</option><option value="none">Không được đánh dấu</option></select></Field><Field label="Từ ngày tạo"><Input name="payment-from" type="date" value={from} onChange={(event) => { setFrom(event.target.value); setPage(0) }} className="min-h-11 min-w-0" /></Field><Field label="Đến ngày tạo" error={dateError}><Input name="payment-to" type="date" min={from || undefined} value={to} onChange={(event) => { setTo(event.target.value); setPage(0) }} className="min-h-11 min-w-0" /></Field><Field label="Sắp xếp"><select name="payment-sort" value={sort} onChange={(event) => { setSort(event.target.value); setPage(0) }} className="min-h-11 w-full min-w-0 rounded-lg border border-input bg-white px-3 text-sm"><option value="created-desc">Mới tạo trước</option><option value="created-asc">Cũ nhất trước</option><option value="amount-desc">Số tiền giảm dần</option><option value="amount-asc">Số tiền tăng dần</option></select></Field></div><div className="mt-4 flex min-w-0 flex-wrap items-center justify-between gap-3"><p className="m-0 text-xs leading-6 text-muted-foreground">Khoảng ngày lọc theo ngày tạo bản ghi thanh toán.</p>{hasFilters && <Button type="button" variant="ghost" className="min-h-11 whitespace-normal" onClick={clearFilters}><RotateCcwIcon aria-hidden="true" className="size-4" />Xóa bộ lọc</Button>}</div></CardContent></Card>
    {displayed.length === 0 ? <AdminEmpty title={dateError ? "Vui lòng kiểm tra khoảng ngày" : hasFilters ? "Không có thanh toán phù hợp" : "Chưa có bản ghi thanh toán"} description={dateError || (hasFilters ? "Thử tìm bằng mã đơn, tên khách hàng hoặc điều chỉnh bộ lọc." : "Các bản ghi thanh toán sẽ hiển thị khi đơn dịch vụ có thông tin thanh toán.")} action={hasFilters ? <Button type="button" variant="outline" className="min-h-11" onClick={clearFilters}>Xóa bộ lọc</Button> : undefined} /> : <>
      <div className="mb-3 flex min-w-0 flex-wrap items-center justify-between gap-2 text-sm"><h2 className="m-0 text-base font-semibold">Bản ghi thanh toán</h2><span className="text-muted-foreground">{filtered.length} kết quả</span></div>
      <Card className="hidden min-w-0 border-border/80 py-0 shadow-sm xl:block"><CardContent className="min-w-0 p-0"><table className="w-full table-fixed text-left text-sm"><thead className="border-b border-border bg-slate-50/80 text-xs text-muted-foreground"><tr><th scope="col" className="w-[23%] p-4 font-medium">Thanh toán / Đơn dịch vụ</th><th scope="col" className="w-[20%] p-4 font-medium">Khách hàng</th><th scope="col" className="w-[18%] p-4 font-medium">Số tiền / Phương thức</th><th scope="col" className="w-[18%] p-4 font-medium">Trạng thái</th><th scope="col" className="w-[21%] p-4 font-medium">Thao tác</th></tr></thead><tbody className="divide-y divide-border">{displayed.map((payment) => { const order = s.orders.find((item) => item.id === payment.orderId); const customer = s.users.find((item) => item.id === order?.customerId); return <tr key={payment.id} className="align-top transition-colors hover:bg-blue-50/35"><td className="p-4"><strong className="block break-words">{payment.code}</strong><span className="mt-1 block break-words text-xs text-muted-foreground">{order?.code || "Không tìm thấy đơn liên quan"}</span><span className="mt-2 block text-xs leading-6 text-muted-foreground">{formatAdminDateTime(payment.createdAt)}</span></td><td className="p-4"><span className="block break-words font-medium">{customer?.name || order?.contact.name || "Chưa có thông tin"}</span><span className="mt-1 block break-words text-xs text-muted-foreground">{order?.contact.phone || customer?.phone || ""}</span></td><td className="p-4"><strong className="block break-words text-primary">{money(payment.amount)}</strong><span className="mt-1 block text-xs text-muted-foreground">{METHOD_LABEL[payment.method]}</span></td><td className="p-4"><div className="flex flex-wrap gap-2"><PaymentBadge payment={payment} />{payment.refundRequired && <ToneBadge tone="warning">Cần xem xét hoàn tiền</ToneBadge>}</div></td><td className="p-4">{actionsFor(payment)}</td></tr> })}</tbody></table></CardContent></Card>
      <div className="grid min-w-0 gap-4 md:grid-cols-2 xl:hidden">{displayed.map((payment) => { const order = s.orders.find((item) => item.id === payment.orderId); const customer = s.users.find((item) => item.id === order?.customerId); return <Card key={payment.id} className="min-w-0 border-border/80 py-0 shadow-sm"><CardContent className="flex h-full min-w-0 flex-col gap-4 p-5"><div className="min-w-0"><h3 className="m-0 break-words text-base font-semibold">{payment.code}</h3><p className="m-0 mt-1 break-words text-xs leading-6 text-muted-foreground">{order?.code || "Không tìm thấy đơn liên quan"} · {formatAdminDateTime(payment.createdAt)}</p></div><div className="flex flex-wrap gap-2"><PaymentBadge payment={payment} />{payment.refundRequired && <ToneBadge tone="warning">Cần xem xét hoàn tiền</ToneBadge>}</div><dl className="m-0 grid min-w-0 grid-cols-2 gap-4"><PaymentItem label="Số tiền"><strong className="text-primary">{money(payment.amount)}</strong></PaymentItem><PaymentItem label="Phương thức">{METHOD_LABEL[payment.method]}</PaymentItem><PaymentItem label="Khách hàng" wide>{customer?.name || order?.contact.name || "Chưa có thông tin"}{order?.contact.phone && <span className="block text-muted-foreground">{order.contact.phone}</span>}</PaymentItem></dl><div className="mt-auto border-t border-border pt-4">{actionsFor(payment)}</div></CardContent></Card> })}</div>
      <nav aria-label="Phân trang thanh toán" className="mt-5 flex min-w-0 flex-wrap items-center justify-between gap-3"><p className="m-0 text-sm text-muted-foreground">Trang {currentPage + 1}/{pages} · {filtered.length} kết quả</p><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" className="min-h-11" disabled={busy || currentPage === 0} onClick={() => setPage(currentPage - 1)}>Trước</Button><Button type="button" variant="outline" className="min-h-11" disabled={busy || currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>Sau</Button></div></nav>
    </>}
    {dialog && <AdminDialog key={`${targetId}-${dialog}`} title={dialog === "confirm" ? "Ghi nhận đã nhận tiền" : "Chi tiết thanh toán"} busy={busy} error={submitError} isBusy={() => submitting.current} close={closeDialog} submit={submit} submitLabel={dialog === "confirm" ? "Xác nhận đã nhận tiền" : paymentCanConfirm(s, target) ? "Ghi nhận đã nhận tiền" : "Đóng chi tiết"}>{target ? <>{dialog === "confirm" && <p className="m-0 text-sm leading-7">Chỉ xác nhận khi đã thực tế nhận được số tiền của bản ghi này. Thao tác cập nhật trạng thái ghi nhận; không chuyển tiền hoặc xác minh giao dịch ngân hàng.</p>}<PaymentDetail payment={target} state={s} />{dialog === "confirm" && !paymentCanConfirm(s, target) && <p role="alert" className="m-0 text-sm leading-7 text-destructive">Bản ghi không còn đủ điều kiện xác nhận. Bạn có thể quay lại để kiểm tra.</p>}</> : <p className="m-0 text-sm leading-7">Bản ghi thanh toán không còn trong danh sách. Vui lòng đóng hộp thoại và tải lại trang.</p>}</AdminDialog>}
  </div>
}
