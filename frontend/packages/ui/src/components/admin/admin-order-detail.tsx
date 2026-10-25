"use client"

import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from "react"
import Image from "next/image"
import { AreaLink as Link } from "@/components/shared/area-routes"
import { ArrowLeftIcon, CalendarDaysIcon, CheckIcon, Clock3Icon, InfoIcon, LoaderCircleIcon, MapPinIcon, PhoneIcon, ReceiptTextIcon, StarIcon, UserRoundIcon, XIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { HOUSE_TYPE_LABEL, JOB_STATUS_LABEL, PAYMENT_METHOD_LABEL } from "@/lib/config"
import { findConflicts } from "@/lib/logic"
import type { AppState, Order, Payment, Review, Service, User } from "@/lib/types"
import { OrderStatusBadge } from "@/components/shared/status-badge"
import { date, Field, money, useData } from "../../common"
import { adminOrderService, type AdminMutationResult } from "./admin-order-service"
import { AdminEmpty, AdminError, AdminPageHeader, formatAdminTime, getAdminDataError, localDateKey } from "./admin-shared"

type DialogKind = "confirm" | "edit" | "assign" | "approve" | "reject" | "paid"
type Draft = { schedule: string; address: string; phone: string; request: string; staff: string; reason: string }
type Errors = Partial<Record<keyof Draft, string>>
type Feedback = { message: string; warning?: boolean }
const DIALOG_TITLE: Record<DialogKind, string> = { confirm: "Xác nhận đơn", edit: "Sửa lịch / thông tin", assign: "Phân công nhân viên", approve: "Duyệt yêu cầu hủy", reject: "Từ chối yêu cầu", paid: "Ghi nhận đã nhận tiền" }
const SUBMIT_LABEL: Record<DialogKind, string> = { confirm: "Xác nhận", edit: "Lưu thay đổi", assign: "Xác nhận phân công", approve: "Xác nhận duyệt hủy", reject: "Xác nhận từ chối", paid: "Xác nhận ghi nhận" }
const EMPTY_DRAFT: Draft = { schedule: "", address: "", phone: "", request: "", staff: "", reason: "" }

function DetailItem({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return <div className={`min-w-0 ${wide ? "sm:col-span-2" : ""}`}><dt className="mb-2 text-xs text-muted-foreground">{label}</dt><dd className="m-0 break-words text-sm leading-7">{children}</dd></div>
}

function OrderDialog({ title, busy, error, isBusy, close, submit, children, submitLabel }: {
  title: string; busy: boolean; error: string; isBusy: () => boolean; close: () => void; submit: (event: FormEvent<HTMLFormElement>) => void; children: ReactNode; submitLabel: string
}) {
  const element = useRef<HTMLDialogElement>(null)
  const cancelButton = useRef<HTMLButtonElement>(null)
  const errorElement = useRef<HTMLParagraphElement>(null)
  const titleId = useId()
  useLayoutEffect(() => {
    const dialog = element.current
    if (dialog && !dialog.open) dialog.showModal()
    cancelButton.current?.focus({ preventScroll: true })
    return () => dialog?.close()
  }, [])
  useLayoutEffect(() => { if (error && !busy) errorElement.current?.focus({ preventScroll: true }) }, [error, busy])
  return <dialog ref={element} aria-labelledby={titleId}
    className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-2xl border border-border bg-background p-5 text-foreground shadow-xl outline-none backdrop:bg-slate-950/35 backdrop:backdrop-blur-sm sm:p-7"
    onCancel={(event) => { event.preventDefault(); if (!isBusy()) close() }}
    onClick={(event) => { if (event.target === event.currentTarget && !isBusy()) close() }}>
    <div className="mb-5 flex min-w-0 items-start justify-between gap-3"><h2 id={titleId} className="m-0 pt-2 text-xl leading-7 font-semibold">{title}</h2><Button type="button" variant="ghost" className="size-11 shrink-0" aria-label="Đóng hộp thoại" disabled={busy} onClick={close}><XIcon aria-hidden="true" /></Button></div>
    <form noValidate onSubmit={submit} aria-busy={busy} className="flex min-w-0 flex-col gap-5">
      <fieldset disabled={busy} className="m-0 flex min-w-0 flex-col gap-5 border-0 p-0">{children}</fieldset>
      {error && <p ref={errorElement} role="alert" tabIndex={-1} className="m-0 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-7 text-red-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{error}</p>}
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:flex-wrap sm:justify-end"><Button ref={cancelButton} type="button" variant="outline" className="h-11" disabled={busy} onClick={close}>Quay lại</Button><Button type="submit" className="h-11 whitespace-normal" disabled={busy}>{busy ? <><LoaderCircleIcon aria-hidden="true" className="animate-spin motion-reduce:animate-none" />Đang lưu...</> : submitLabel}</Button></div>
    </form>
  </dialog>
}

export function AdminOrderDetail({ id }: { id: string }) {
  const { s, user, role } = useData()
  if (!s) return <div aria-busy="true" aria-label="Đang tải chi tiết đơn" className="space-y-6"><Skeleton className="h-10 w-56" /><Skeleton className="h-80 rounded-2xl" /><Skeleton className="h-56 rounded-2xl" /></div>
  if (!user || user.role !== "admin" || user.status !== "active" || role !== "admin") return <AdminEmpty title="Không thể mở đơn dịch vụ" description="Vui lòng đăng nhập bằng tài khoản quản trị viên." />
  const dataError = getAdminDataError(s)
  if (dataError) return <AdminError />
  const order = s.orders.find((item) => item.id === id)
  if (!order) return <><AdminPageHeader title="Không tìm thấy đơn dịch vụ" /><AdminEmpty title="Kiểm tra lại mã đơn" description="Đơn không còn trong danh sách. Vui lòng kiểm tra lại mã đơn." action={<Button variant="outline" className="h-11" render={<Link href="/don-dich-vu" />} nativeButton={false}>Trở về danh sách đơn</Button>} /></>
  return <OrderDetailContent key={order.id} state={s} order={order} service={s.services.find((item) => item.id === order.serviceId)} employee={s.users.find((item) => item.id === order.staffId)} payment={s.payments.find((item) => item.orderId === order.id)} review={s.reviews.find((item) => item.orderId === order.id)} />
}

function OrderDetailContent({ state, order, service, employee, payment, review }: { state: AppState; order: Order; service?: Service; employee?: User; payment?: Payment; review?: Review }) {
  const [dialog, setDialog] = useState<DialogKind | null>(null)
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [errors, setErrors] = useState<Errors>({})
  const [submitError, setSubmitError] = useState("")
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const submitting = useRef(false)
  const mounted = useRef(true)
  const dialogTrigger = useRef<HTMLElement | null>(null)
  const openedOrder = useRef<Order | null>(null)
  const feedbackElement = useRef<HTMLDivElement>(null)
  const pageElement = useRef<HTMLDivElement>(null)
  const formElement = useRef<HTMLDivElement>(null)
  const focusIntent = useRef<"trigger" | "feedback" | "invalid" | null>(null)
  const canEdit = order.status === "pending" || order.status === "confirmed"
  const canAssign = order.status === "confirmed" && order.jobStatus !== "in_progress" && order.jobStatus !== "done"
  const hasPendingCancel = order.cancelRequest?.status === "pending"
  const canApproveCancel = hasPendingCancel && order.status !== "in_progress" && order.status !== "completed"
  const canConfirmPayment = Boolean(payment && (payment.status === "pending" || payment.status === "unpaid") && Number.isFinite(payment.amount) && payment.amount >= 0 && order.status !== "cancelled")
  const staffCandidates = state.users.filter((item) => item.role === "staff" && item.status === "active")
  const paymentLabel = payment?.status === "paid" ? "Đã xác nhận đã nhận tiền" : payment?.status === "pending" ? "Chờ xác nhận đã nhận tiền" : "Chưa ghi nhận đã nhận tiền"

  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useLayoutEffect(() => {
    if (busy || !focusIntent.current) return
    if (focusIntent.current === "invalid" && dialog) {
      const target = formElement.current?.querySelector<HTMLElement>('[aria-invalid="true"]')
      if (target) { target.focus({ preventScroll: true }); focusIntent.current = null }
      return
    }
    if (dialog) return
    const trigger = dialogTrigger.current?.isConnected && !dialogTrigger.current.hasAttribute("disabled") ? dialogTrigger.current : null
    const target = focusIntent.current === "trigger" ? trigger ?? feedbackElement.current ?? pageElement.current : feedbackElement.current
    if (target?.isConnected) { target.focus({ preventScroll: true }); focusIntent.current = null }
  }, [busy, dialog, errors, feedback])

  const change = (field: keyof Draft, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }))
    setErrors((current) => ({ ...current, [field]: undefined }))
    setSubmitError("")
  }
  const openDialog = (kind: DialogKind, trigger: HTMLElement) => {
    if (submitting.current) return
    const start = new Date(order.scheduledAt)
    const schedule = `${localDateKey(start)}T${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}`
    dialogTrigger.current = trigger
    openedOrder.current = order
    setDraft({ ...EMPTY_DRAFT, schedule, address: order.contact.address, phone: order.contact.phone, request: order.specialRequest, staff: order.staffId || "" })
    setErrors({})
    setSubmitError("")
    setFeedback(null)
    setDialog(kind)
  }
  const closeDialog = () => {
    if (submitting.current) return
    focusIntent.current = "trigger"
    setDialog(null)
    setErrors({})
    setSubmitError("")
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submitting.current || !dialog) return
    const validation: Errors = {}
    let stateError = ""
    if (dialog === "confirm" && order.status !== "pending") stateError = "Chỉ xác nhận được đơn đang chờ xác nhận."
    if (dialog === "edit") {
      if (!canEdit) stateError = "Không thể sửa đơn đã bắt đầu, hoàn thành hoặc đã hủy."
      const scheduled = new Date(draft.schedule)
      if (!draft.schedule || !Number.isFinite(scheduled.getTime()) || scheduled.getTime() < Date.now()) validation.schedule = "Vui lòng chọn lịch thực hiện ở tương lai."
      else if (order.staffId) {
        const conflicts = findConflicts(state, order.staffId, scheduled, order.durationMinutes, order.id)
        if (conflicts.length) validation.schedule = `Trùng lịch đã lưu với đơn ${conflicts.map((item) => item.code).join(", ")}.`
      }
      if (!draft.address.trim()) validation.address = "Vui lòng nhập địa chỉ thực hiện."
      else if (draft.address.trim().length > 300) validation.address = "Địa chỉ tối đa 300 ký tự."
      if (!/^[0-9+ ()-]{9,15}$/.test(draft.phone.trim())) validation.phone = "Nhập số điện thoại hợp lệ, từ 9 đến 15 ký tự."
      if (draft.request.trim().length > 2000) validation.request = "Yêu cầu tối đa 2.000 ký tự."
    }
    if (dialog === "assign") {
      if (!canAssign) stateError = "Chỉ phân công được đơn đã xác nhận và chưa bắt đầu."
      const selected = staffCandidates.find((item) => item.id === draft.staff)
      if (!selected) validation.staff = "Vui lòng chọn nhân viên đang hoạt động."
      else if (findConflicts(state, selected.id, new Date(order.scheduledAt), order.durationMinutes, order.id).length) validation.staff = "Nhân viên có công việc trùng lịch đã lưu. Vui lòng chọn người khác."
      if (new Date(order.scheduledAt).getTime() < Date.now()) stateError = "Thời gian phân công phải ở tương lai. Vui lòng cập nhật lịch đơn trước."
    }
    if (dialog === "approve" || dialog === "reject") {
      if (!hasPendingCancel) stateError = "Không có yêu cầu hủy đang chờ xét duyệt."
      else if (dialog === "approve" && !canApproveCancel) stateError = "Đơn đã bắt đầu thực hiện hoặc hoàn thành, không thể duyệt hủy."
      if (!draft.reason.trim()) validation.reason = "Vui lòng nhập lý do / ghi chú xử lý."
      else if (draft.reason.trim().length > 2000) validation.reason = "Ghi chú tối đa 2.000 ký tự."
    }
    if (dialog === "paid" && !canConfirmPayment) stateError = "Bản ghi thanh toán không còn đủ điều kiện xác nhận."
    setErrors(validation)
    if (Object.values(validation).some(Boolean)) { focusIntent.current = "invalid"; setSubmitError(stateError); return }
    if (stateError) { setSubmitError(stateError); return }
    submitting.current = true
    setBusy(true)
    setSubmitError("")
    const kind = dialog
    try {
      let result: AdminMutationResult
      if (kind === "confirm") result = await adminOrderService.confirm(order.id)
      else if (kind === "edit") result = await adminOrderService.updateSchedule(order.id, { scheduledAt: new Date(draft.schedule).toISOString(), address: draft.address.trim(), phone: draft.phone.trim(), specialRequest: draft.request.trim() }, openedOrder.current || undefined)
      else if (kind === "assign") result = await adminOrderService.assign(order.id, draft.staff)
      else if (kind === "approve" || kind === "reject") result = await adminOrderService.resolveCancellation(order.id, kind === "approve", draft.reason.trim())
      else if (payment) result = await adminOrderService.confirmPayment(payment.id)
      else result = { ok: false, error: "Không tìm thấy bản ghi thanh toán." }
      if (!mounted.current) return
      if (!result.ok) { setSubmitError(result.error); return }
      const labels: Record<DialogKind, string> = { confirm: "xác nhận đơn", edit: "lịch và thông tin đơn", assign: "phân công nhân viên", approve: "kết quả duyệt hủy", reject: "kết quả từ chối yêu cầu hủy", paid: "ghi nhận đã nhận thanh toán" }
      focusIntent.current = "feedback"
      setFeedback(result.persistence === "local"
        ? { message: `Đã lưu ${labels[kind]} trên trình duyệt này.${kind === "paid" ? " Chưa xác minh giao dịch với ngân hàng." : ""}` }
        : { message: `Thay đổi về ${labels[kind]} chỉ được giữ trong phiên hiện tại; trình duyệt chưa lưu được trên thiết bị.`, warning: true })
      setDialog(null)
      setErrors({})
    } catch {
      if (mounted.current) setSubmitError("Chưa thể lưu thay đổi. Nội dung đã nhập vẫn được giữ để bạn thử lại.")
    } finally {
      if (mounted.current) { submitting.current = false; setBusy(false) }
    }
  }

  return <div ref={pageElement} tabIndex={-1} className="min-w-0 outline-none">
    <Button variant="ghost" className="mb-5 h-11 text-muted-foreground" render={<Link href="/don-dich-vu" />} nativeButton={false}><ArrowLeftIcon aria-hidden="true" />Danh sách đơn dịch vụ</Button>
    <AdminPageHeader title={`Đơn ${order.code}`} description={`${service?.name || "Dịch vụ đã lưu"} · Tạo ngày ${formatAdminTime(order.createdAt)}`} action={<OrderStatusBadge status={order.status} />} />
    {feedback && <div ref={feedbackElement} role="status" tabIndex={-1} className={`mb-6 flex min-w-0 items-start gap-3 rounded-xl border px-5 py-4 text-sm leading-7 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring ${feedback.warning ? "border-amber-200 bg-amber-50 text-amber-900" : "border-blue-100 bg-blue-50 text-blue-900"}`}><InfoIcon aria-hidden="true" className="mt-1 size-5 shrink-0" /><p className="m-0 min-w-0 break-words">{feedback.message}</p></div>}
    <div className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_19rem]">
      <div className="min-w-0 space-y-6">
        <Card className="min-w-0 rounded-2xl shadow-none ring-border [--card-spacing:--spacing(6)]"><CardHeader><h2 className="m-0 text-lg font-semibold">Thông tin dịch vụ</h2></CardHeader><CardContent className="space-y-6">
          <div className="flex min-w-0 items-start gap-4">{service?.image && <Image src={service.image} alt={service.name} width={80} height={80} sizes="80px" className="size-20 shrink-0 rounded-xl object-cover" />}<div className="min-w-0"><h3 className="m-0 break-words text-lg leading-7 font-semibold">{service?.name || "Dịch vụ không còn trong danh sách"}</h3><p className="m-0 mt-2 text-sm text-muted-foreground">{order.quantity} {service?.unit || "đơn vị"}</p></div></div>
          <dl className="m-0 grid gap-5 border-t border-border pt-6 sm:grid-cols-2"><DetailItem label="Ngày và giờ thực hiện"><span className="flex items-start gap-2"><CalendarDaysIcon aria-hidden="true" className="mt-1.5 size-4 shrink-0 text-primary" /><span>{formatAdminTime(order.scheduledAt)}</span></span></DetailItem><DetailItem label="Thời lượng dự kiến"><span className="flex items-center gap-2"><Clock3Icon aria-hidden="true" className="size-4 shrink-0 text-primary" />{order.durationMinutes} phút</span></DetailItem><DetailItem label="Nhân viên thực hiện" wide>{employee ? <div className="flex min-w-0 flex-wrap items-center gap-3"><span className="flex items-center gap-2"><UserRoundIcon aria-hidden="true" className="size-4 shrink-0 text-primary" />{employee.name}</span>{order.jobStatus && <Badge variant="secondary" className="px-2.5 py-1.5">{JOB_STATUS_LABEL[order.jobStatus]}</Badge>}</div> : "Chưa phân công nhân viên"}</DetailItem></dl>
          {service && service.scope.length > 0 && <section className="border-t border-border pt-6"><h3 className="m-0 mb-4 text-sm font-semibold">Phạm vi công việc</h3><ul className="m-0 grid list-none gap-3 p-0">{service.scope.map((item, index) => <li key={`${index}-${item}`} className="flex min-w-0 items-start gap-2.5 text-sm leading-7 text-muted-foreground"><CheckIcon aria-hidden="true" className="mt-1.5 size-4 shrink-0 text-primary" /><span className="min-w-0 break-words">{item}</span></li>)}</ul></section>}
          {(order.status === "pending" || canEdit || canAssign) && <div className="flex flex-col gap-3 border-t border-border pt-6 sm:flex-row sm:flex-wrap">{order.status === "pending" && <Button className="min-h-11 whitespace-normal" disabled={busy} onClick={(event) => openDialog("confirm", event.currentTarget)}>Xác nhận đơn</Button>}{canEdit && <Button variant="outline" className="min-h-11 whitespace-normal" disabled={busy} onClick={(event) => openDialog("edit", event.currentTarget)}>Sửa lịch / thông tin</Button>}{canAssign && <Button variant="outline" className="min-h-11 whitespace-normal" disabled={busy} onClick={(event) => openDialog("assign", event.currentTarget)}>{employee ? "Đổi phân công" : "Phân công nhân viên"}</Button>}</div>}
        </CardContent></Card>

        <Card className="min-w-0 rounded-2xl shadow-none ring-border [--card-spacing:--spacing(6)]"><CardHeader><h2 className="m-0 text-lg font-semibold">Khách hàng và địa điểm</h2></CardHeader><CardContent><dl className="m-0 grid gap-5 sm:grid-cols-2"><DetailItem label="Người liên hệ">{order.contact.name}</DetailItem><DetailItem label="Số điện thoại"><a href={`tel:${order.contact.phone.replace(/[^+\d]/g, "")}`} className="inline-flex min-h-11 items-center gap-2 rounded-md text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"><PhoneIcon aria-hidden="true" className="size-4 shrink-0" />{order.contact.phone}</a></DetailItem><DetailItem label="Địa chỉ thực hiện" wide><span className="flex min-w-0 items-start gap-2"><MapPinIcon aria-hidden="true" className="mt-1.5 size-4 shrink-0 text-primary" /><span className="min-w-0 break-words">{order.contact.address}</span></span></DetailItem><DetailItem label="Loại nhà">{HOUSE_TYPE_LABEL[order.contact.houseType] || "Chưa cung cấp"}</DetailItem><DetailItem label="Diện tích">{order.contact.area !== undefined ? `${order.contact.area} m²` : "Chưa cung cấp"}</DetailItem><DetailItem label="Số phòng / số tầng">{order.contact.rooms ?? "—"} phòng · {order.contact.floors ?? "—"} tầng</DetailItem><DetailItem label="Thú cưng">{typeof order.contact.hasPets === "boolean" ? order.contact.hasPets ? "Có thú cưng" : "Không có thú cưng" : "Chưa cung cấp"}</DetailItem><DetailItem label="Yêu cầu của khách hàng" wide><p className="m-0 whitespace-pre-wrap">{order.specialRequest || "Không có yêu cầu đặc biệt."}</p></DetailItem></dl></CardContent></Card>

        {order.cancelRequest && <Card className={`min-w-0 rounded-2xl shadow-none [--card-spacing:--spacing(6)] ${hasPendingCancel ? "bg-amber-50/50 ring-amber-200" : "ring-border"}`}><CardHeader><h2 className="m-0 text-lg font-semibold">Yêu cầu hủy</h2></CardHeader><CardContent className="space-y-4"><Badge variant="outline" className="px-2.5 py-1.5">{({ pending: "Chờ xét duyệt", approved: "Đã duyệt hủy", rejected: "Đã từ chối" })[order.cancelRequest.status]}</Badge><p className="m-0 break-words text-sm leading-7 whitespace-pre-wrap">{order.cancelRequest.reason}</p><p className="m-0 text-xs leading-6 text-muted-foreground">Gửi ngày {formatAdminTime(order.cancelRequest.requestedAt)}</p>{order.cancelRequest.adminNote && <p className="m-0 break-words text-sm leading-7 whitespace-pre-wrap"><span className="font-medium">Phản hồi: </span>{order.cancelRequest.adminNote}</p>}{hasPendingCancel && <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap"><Button variant="destructive" className="min-h-11 whitespace-normal" disabled={busy || !canApproveCancel} onClick={(event) => openDialog("approve", event.currentTarget)}>Duyệt yêu cầu hủy</Button><Button variant="outline" className="min-h-11 whitespace-normal" disabled={busy} onClick={(event) => openDialog("reject", event.currentTarget)}>Từ chối yêu cầu</Button></div>}{hasPendingCancel && !canApproveCancel && <p className="m-0 text-sm leading-7 text-amber-900">Đơn đã bắt đầu thực hiện hoặc hoàn thành, không thể duyệt hủy.</p>}</CardContent></Card>}

        <Card className="min-w-0 rounded-2xl shadow-none ring-border [--card-spacing:--spacing(6)]"><CardHeader><h2 className="m-0 text-lg font-semibold">Lịch sử cập nhật</h2></CardHeader><CardContent>{order.history.length ? <ol className="m-0 list-none p-0">{order.history.map((entry, index) => <li key={`${entry.at}-${index}`} className="relative flex min-w-0 gap-4 pb-6 last:pb-0"><div aria-hidden="true" className="relative flex w-5 shrink-0 justify-center"><span className="relative z-10 mt-2 size-2.5 rounded-full bg-primary" />{index < order.history.length - 1 && <span className="absolute top-5 bottom-[-0.5rem] w-px bg-border" />}</div><div className="min-w-0"><h3 className="m-0 break-words text-sm leading-7 font-semibold">{entry.label}</h3><p className="m-0 mt-1 break-words text-xs leading-6 text-muted-foreground">{date(entry.at)} · {entry.by}</p>{entry.note && <p className="m-0 mt-2 break-words text-sm leading-7 whitespace-pre-wrap text-muted-foreground">{entry.note}</p>}</div></li>)}</ol> : <p className="m-0 text-sm leading-7 text-muted-foreground">Chưa có cập nhật cho đơn này.</p>}</CardContent></Card>
        <Card className="min-w-0 rounded-2xl shadow-none ring-border [--card-spacing:--spacing(6)]"><CardHeader><h2 className="m-0 text-lg font-semibold">Ghi chú thực hiện</h2></CardHeader><CardContent>{order.staffNotes.length ? <ol className="m-0 grid list-none gap-4 p-0">{order.staffNotes.map((item, index) => <li key={`${item.at}-${index}`} className="min-w-0 rounded-xl border border-border bg-slate-50/60 px-4 py-3"><p className="m-0 break-words text-sm leading-7 whitespace-pre-wrap">{item.text}</p><p className="m-0 mt-2 break-words text-xs leading-6 text-muted-foreground">{formatAdminTime(item.at)} · {state.users.find((user) => user.id === item.staffId)?.name || "Nhân viên đã ghi chú"}</p></li>)}</ol> : <p className="m-0 text-sm leading-7 text-muted-foreground">Chưa có ghi chú thực hiện.</p>}</CardContent></Card>
      </div>

      <aside aria-label="Chi phí, thanh toán và đánh giá" className="min-w-0 space-y-6 xl:sticky xl:top-24">
        <Card className="min-w-0 rounded-2xl shadow-sm shadow-slate-900/5 ring-blue-100 [--card-spacing:--spacing(6)]"><CardHeader><div className="flex items-center gap-2.5"><ReceiptTextIcon aria-hidden="true" className="size-5 text-primary" /><h2 className="m-0 text-lg font-semibold">Chi phí và thanh toán</h2></div></CardHeader><CardContent className="space-y-4"><div><p className="m-0 text-sm text-muted-foreground">Giá trị đơn đã lưu</p><p className="m-0 mt-2 break-words text-3xl font-bold tracking-tight text-primary tabular-nums">{money(order.price)}</p></div><Badge variant="outline" className="max-w-full px-2.5 py-1.5 whitespace-normal">{paymentLabel}</Badge><p className="m-0 text-sm leading-7 text-muted-foreground">{payment ? PAYMENT_METHOD_LABEL[payment.method] : "Chưa chọn phương thức thanh toán"}</p>{payment && <dl className="m-0 space-y-3 text-sm"><DetailItem label="Mã thanh toán">{payment.code}</DetailItem><DetailItem label="Số tiền trong bản ghi">{money(payment.amount)}</DetailItem>{payment.confirmedAt && <DetailItem label="Ghi nhận ngày">{formatAdminTime(payment.confirmedAt)}</DetailItem>}</dl>}{payment?.refundRequired && <p className="m-0 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-7 text-amber-900">Bản ghi cần được xem xét hoàn tiền. Chưa có giao dịch hoàn tiền được thực hiện.</p>}{canConfirmPayment && <Button className="min-h-11 w-full whitespace-normal" disabled={busy} onClick={(event) => openDialog("paid", event.currentTarget)}>Ghi nhận đã nhận tiền</Button>}<p className="m-0 text-xs leading-6 text-muted-foreground">Trạng thái theo bản ghi đang lưu trên trình duyệt; chưa xác minh giao dịch với ngân hàng.</p></CardContent></Card>
        {order.status === "completed" && <Card className="min-w-0 rounded-2xl shadow-none ring-border [--card-spacing:--spacing(6)]"><CardHeader><h2 className="m-0 text-lg font-semibold">Đánh giá dịch vụ</h2></CardHeader><CardContent>{review ? <div className="space-y-4"><div className="flex flex-wrap items-center gap-2"><div className="flex gap-1 text-amber-500" aria-label={`Chất lượng dịch vụ: ${review.serviceRating} trên 5 sao`}>{[1, 2, 3, 4, 5].map((star) => <StarIcon key={star} aria-hidden="true" className={`size-4 ${star <= review.serviceRating ? "fill-current" : "text-slate-200"}`} />)}</div><span className="text-sm font-medium">{review.serviceRating}/5</span></div><p className="m-0 break-words text-sm leading-7 whitespace-pre-wrap">{review.comment}</p>{review.staffId && review.staffRating !== undefined && <p className="m-0 text-xs leading-6 text-muted-foreground">Nhân viên: {review.staffRating}/5 sao</p>}<p className="m-0 text-xs leading-6 text-muted-foreground">{formatAdminTime(review.createdAt)}</p>{review.hidden && <Badge variant="outline" className="px-2.5 py-1.5">Đánh giá đang ẩn</Badge>}</div> : <p className="m-0 text-sm leading-7 text-muted-foreground">Chưa có đánh giá cho đơn này.</p>}</CardContent></Card>}
      </aside>
    </div>
    <p className="m-0 mt-6 text-xs leading-6 text-muted-foreground">Các cập nhật được lưu bằng cơ chế dữ liệu của trình duyệt hiện tại.</p>

    {dialog && <OrderDialog title={DIALOG_TITLE[dialog]} busy={busy} error={submitError} isBusy={() => submitting.current} close={closeDialog} submit={submit} submitLabel={SUBMIT_LABEL[dialog]}>
      <div ref={formElement} className="flex min-w-0 flex-col gap-5">
        {dialog === "confirm" && <p className="m-0 text-sm leading-7 text-muted-foreground">Xác nhận tiếp nhận yêu cầu của khách hàng cho đơn {order.code}? Đơn sẽ chuyển sang “Đã xác nhận”.</p>}
        {dialog === "edit" && <><Field label="Lịch thực hiện mới" error={errors.schedule}><Input type="datetime-local" className="min-w-0" value={draft.schedule} onChange={(event) => change("schedule", event.target.value)} /></Field><Field label="Địa chỉ thực hiện" error={errors.address}><Textarea rows={3} value={draft.address} onChange={(event) => change("address", event.target.value)} /></Field><Field label="Số điện thoại liên hệ" error={errors.phone}><Input type="tel" autoComplete="tel" value={draft.phone} onChange={(event) => change("phone", event.target.value)} /></Field><Field label="Yêu cầu của khách hàng" error={errors.request}><Textarea rows={3} value={draft.request} onChange={(event) => change("request", event.target.value)} /></Field><p className="m-0 text-xs leading-6 text-muted-foreground">Giá trị đơn đã lưu được giữ nguyên khi cập nhật lịch và thông tin liên hệ.</p></>}
        {dialog === "assign" && <><p className="m-0 text-sm leading-7 text-muted-foreground">Lịch: {formatAdminTime(order.scheduledAt)} · {order.durationMinutes} phút</p><Field label="Nhân viên thực hiện" error={errors.staff}><select value={draft.staff} onChange={(event) => change("staff", event.target.value)} className="min-h-11 w-full min-w-0 rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"><option value="">Chọn nhân viên</option>{staffCandidates.map((staff) => { const conflicts = findConflicts(state, staff.id, new Date(order.scheduledAt), order.durationMinutes, order.id); return <option key={staff.id} value={staff.id} disabled={conflicts.length > 0}>{staff.name} — {conflicts.length ? "Có lịch trùng" : "Không trùng lịch đã lưu"}</option> })}</select></Field>{staffCandidates.length === 0 && <p className="m-0 text-sm leading-7 text-muted-foreground">Chưa có nhân viên đang hoạt động để phân công.</p>}<p className="m-0 text-xs leading-6 text-muted-foreground">Kiểm tra dựa trên các công việc đã lưu tại trình duyệt này; chưa xác minh lịch ngoài hệ thống.</p></>}
        {(dialog === "approve" || dialog === "reject") && <><p className="m-0 text-sm leading-7 text-muted-foreground">{dialog === "approve" ? "Duyệt yêu cầu hủy sẽ chuyển đơn sang “Đã hủy”. Nếu đã ghi nhận thanh toán, bản ghi sẽ được đánh dấu cần xem xét hoàn tiền." : "Từ chối yêu cầu hủy sẽ giữ nguyên trạng thái đơn hiện tại."}</p><Field label="Lý do / ghi chú xử lý" error={errors.reason}><Textarea rows={4} value={draft.reason} onChange={(event) => change("reason", event.target.value)} /></Field></>}
        {dialog === "paid" && <><p className="m-0 text-sm leading-7 text-muted-foreground">Bạn xác nhận đã nhận {money(payment?.amount ?? order.price)} cho bản ghi {payment?.code || "thanh toán"}?</p><p className="m-0 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm leading-7 text-blue-900">Thao tác chỉ ghi nhận đã nhận tiền trong dữ liệu trình duyệt. Chưa xác minh giao dịch với ngân hàng và không thực hiện chuyển tiền hoặc hoàn tiền.</p></>}
      </div>
    </OrderDialog>}
  </div>
}
