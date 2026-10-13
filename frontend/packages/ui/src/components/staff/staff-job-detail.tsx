"use client"

import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from "react"
import Image from "next/image"
import { AreaLink as Link } from "@/components/shared/area-routes"
import {
  ArrowLeftIcon,
  CalendarDaysIcon,
  CheckIcon,
  ClipboardCheckIcon,
  Clock3Icon,
  InfoIcon,
  LoaderCircleIcon,
  MapPinIcon,
  PhoneIcon,
  ReceiptTextIcon,
  StickyNoteIcon,
  XIcon,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { HOUSE_TYPE_LABEL, JOB_STATUS_LABEL, PAYMENT_METHOD_LABEL } from "@/lib/config"
import { nextJobAction } from "@/lib/logic"
import type { Order, Payment, Service } from "@/lib/types"
import { date, Field, money, useData } from "../../common"
import { advanceStaffJob, saveStaffJobNote } from "./staff-job-service"
import { getAssignedJobs, StaffEmpty, StaffError, StaffJobBadge, StaffLoading, StaffPageHeader } from "./staff-shared"

type JobAction = NonNullable<ReturnType<typeof nextJobAction>>
type Feedback = { message: string; warning?: boolean }

function DetailItem({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return <div className={`min-w-0 ${wide ? "sm:col-span-2" : ""}`}><dt className="mb-2 text-xs text-muted-foreground">{label}</dt><dd className="m-0 break-words text-sm leading-7">{children}</dd></div>
}

function JobConfirmation({ action, busy, error, isBusy, close, submit }: {
  action: JobAction
  busy: boolean
  error: string
  isBusy: () => boolean
  close: () => void
  submit: (event: FormEvent<HTMLFormElement>) => void
}) {
  const element = useRef<HTMLDialogElement>(null)
  const cancelButton = useRef<HTMLButtonElement>(null)
  const errorElement = useRef<HTMLParagraphElement>(null)
  const titleId = useId()
  const descriptionId = useId()

  useLayoutEffect(() => {
    const dialog = element.current
    if (dialog && !dialog.open) dialog.showModal()
    cancelButton.current?.focus({ preventScroll: true })
    return () => dialog?.close()
  }, [])

  useLayoutEffect(() => {
    if (error && !busy) errorElement.current?.focus({ preventScroll: true })
  }, [error, busy])

  return (
    <dialog ref={element} aria-labelledby={titleId} aria-describedby={descriptionId}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-2xl border border-border bg-background p-5 text-foreground shadow-xl outline-none backdrop:bg-slate-950/35 backdrop:backdrop-blur-sm sm:p-7"
      onCancel={(event) => { event.preventDefault(); if (!isBusy()) close() }}
      onClick={(event) => { if (event.target === event.currentTarget && !isBusy()) close() }}>
      <div className="mb-5 flex min-w-0 items-start justify-between gap-3">
        <h2 id={titleId} className="m-0 pt-2 text-xl leading-7 font-semibold">{action.label}</h2>
        <Button type="button" variant="ghost" className="size-11 shrink-0" aria-label="Đóng hộp thoại" disabled={busy} onClick={close}><XIcon aria-hidden="true" /></Button>
      </div>
      <form noValidate onSubmit={submit} aria-busy={busy} className="flex flex-col gap-5">
        <p id={descriptionId} className="m-0 text-sm leading-7 text-muted-foreground">{action.confirm}</p>
        <p className="m-0 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm leading-7 text-blue-900">Thao tác cập nhật trạng thái trong dữ liệu đang lưu trên trình duyệt này.</p>
        {error && <p ref={errorElement} role="alert" tabIndex={-1} className="m-0 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-7 text-red-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{error}</p>}
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button ref={cancelButton} type="button" variant="outline" className="h-11" disabled={busy} onClick={close}>Quay lại</Button>
          <Button type="submit" className="h-11" disabled={busy}>{busy ? <><LoaderCircleIcon aria-hidden="true" className="animate-spin motion-reduce:animate-none" />Đang lưu...</> : "Xác nhận"}</Button>
        </div>
      </form>
    </dialog>
  )
}

export function StaffJobDetail({ id }: { id: string }) {
  const { s, user, role } = useData()
  if (!s) return <StaffLoading />
  if (!user || role !== "staff" || user.role !== "staff") return <StaffEmpty title="Không thể mở công việc" description="Vui lòng đăng nhập bằng tài khoản nhân viên được phân công." />
  const assigned = getAssignedJobs(s, user.id)
  if (!assigned || !Array.isArray(s.services) || !Array.isArray(s.payments)) return <StaffError />
  const order = assigned.find((item) => item.id === id)
  if (!order) return <StaffEmpty title="Không tìm thấy công việc" description="Công việc không còn trong danh sách hoặc không được phân công cho bạn." action={<Button className="h-11" variant="outline" render={<Link href="/cong-viec" />} nativeButton={false}>Trở về công việc</Button>} />
  const service = s.services.find((item) => item?.id === order.serviceId)
  const payment = s.payments.find((item) => item?.orderId === order.id)
  if (!Array.isArray(order.history) || !Array.isArray(order.staffNotes) || typeof order.specialRequest !== "string"
    || order.history.some((item) => !item || typeof item.label !== "string" || typeof item.by !== "string" || !Number.isFinite(new Date(item.at).getTime()) || (item.note !== undefined && typeof item.note !== "string"))
    || order.staffNotes.some((item) => !item || typeof item.text !== "string" || typeof item.staffId !== "string" || !Number.isFinite(new Date(item.at).getTime()))
    || (service && (typeof service.name !== "string" || typeof service.unit !== "string" || typeof service.image !== "string" || !Array.isArray(service.scope) || service.scope.some((item) => typeof item !== "string")))
    || (payment && (!["unpaid", "pending", "paid"].includes(payment.status) || !["cash", "transfer"].includes(payment.method)))
    || (order.cancelRequest && (typeof order.cancelRequest.reason !== "string" || !["pending", "approved", "rejected"].includes(order.cancelRequest.status)
      || !Number.isFinite(new Date(order.cancelRequest.requestedAt).getTime()) || (order.cancelRequest.adminNote !== undefined && typeof order.cancelRequest.adminNote !== "string")))
    || !Number.isFinite(new Date(order.createdAt).getTime())) return <StaffError />
  return <JobDetailContent key={order.id} order={order} service={service} payment={payment} />
}

function JobDetailContent({ order, service, payment }: { order: Order; service?: Service; payment?: Payment }) {
  const [dialog, setDialog] = useState<JobAction | null>(null)
  const [busy, setBusy] = useState<"advance" | "note" | null>(null)
  const [submitError, setSubmitError] = useState("")
  const [note, setNote] = useState("")
  const [noteError, setNoteError] = useState("")
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const submitting = useRef(false)
  const mounted = useRef(true)
  const actionButton = useRef<HTMLButtonElement>(null)
  const noteInput = useRef<HTMLTextAreaElement>(null)
  const feedbackElement = useRef<HTMLDivElement>(null)
  const pageElement = useRef<HTMLDivElement>(null)
  const focusIntent = useRef<"action" | "feedback" | "note" | null>(null)
  const proposedAction = nextJobAction(order)
  const next = order.status === "completed" || order.jobStatus === "done" ? null : proposedAction
  const startBlocked = next?.next === "in_progress" && order.cancelRequest?.status === "pending"
  const paymentLabel = payment?.status === "paid" ? "Đã ghi nhận thanh toán" : payment?.status === "pending" ? "Chờ xác nhận thanh toán" : "Chưa thanh toán"
  const steps = ["waiting", "accepted", "in_progress", "done"] as const
  const currentStep = order.status === "completed" || order.jobStatus === "done" ? 3 : steps.indexOf(order.jobStatus ?? "waiting")

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useLayoutEffect(() => {
    if (busy || dialog || !focusIntent.current) return
    const enabledAction = actionButton.current?.isConnected && !actionButton.current.hasAttribute("disabled") ? actionButton.current : null
    const target = focusIntent.current === "action" ? enabledAction ?? feedbackElement.current ?? pageElement.current
      : focusIntent.current === "note" ? noteInput.current : feedbackElement.current
    if (target?.isConnected && !target.hasAttribute("disabled")) {
      target.focus({ preventScroll: true })
      focusIntent.current = null
    }
  }, [busy, dialog, feedback, noteError])

  const openConfirmation = () => {
    if (submitting.current || !next || startBlocked) return
    setSubmitError("")
    setFeedback(null)
    setDialog(next)
  }

  const closeConfirmation = () => {
    if (submitting.current) return
    focusIntent.current = "action"
    setDialog(null)
    setSubmitError("")
  }

  const advance = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submitting.current || !dialog) return
    if (!next || next.next !== dialog.next || startBlocked) {
      setSubmitError(startBlocked ? "Yêu cầu hủy đang chờ xét duyệt. Vui lòng liên hệ quản trị viên trước khi bắt đầu." : "Trạng thái công việc đã thay đổi. Vui lòng đóng hộp thoại và kiểm tra lại.")
      return
    }
    submitting.current = true
    setBusy("advance")
    setSubmitError("")
    try {
      const result = await advanceStaffJob(order.id, dialog.next)
      if (!mounted.current) return
      if (!result.ok) { setSubmitError(result.error); return }
      focusIntent.current = "feedback"
      setFeedback(result.persistence === "local"
        ? { message: `Đã lưu trạng thái “${JOB_STATUS_LABEL[dialog.next]}” trên trình duyệt này.` }
        : { message: `Trạng thái “${JOB_STATUS_LABEL[dialog.next]}” hiện được giữ trong phiên này. Trình duyệt chưa lưu được thay đổi trên thiết bị.`, warning: true })
      setDialog(null)
    } catch {
      if (mounted.current) setSubmitError("Chưa thể cập nhật công việc. Vui lòng thử lại.")
    } finally {
      if (mounted.current) { submitting.current = false; setBusy(null) }
    }
  }

  const saveNote = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submitting.current) return
    const text = note.trim()
    if (!text || text.length > 2000) {
      focusIntent.current = "note"
      setNoteError(!text ? "Vui lòng nhập ghi chú công việc." : "Ghi chú tối đa 2.000 ký tự.")
      noteInput.current?.focus({ preventScroll: true })
      return
    }
    if (order.status === "cancelled") { setNoteError("Công việc đã hủy, không thể thêm ghi chú."); return }
    submitting.current = true
    setBusy("note")
    setNoteError("")
    setFeedback(null)
    try {
      const result = await saveStaffJobNote(order.id, text)
      if (!mounted.current) return
      if (!result.ok) { focusIntent.current = "note"; setNoteError(result.error); return }
      setNote("")
      focusIntent.current = "feedback"
      setFeedback(result.persistence === "local"
        ? { message: "Đã lưu ghi chú công việc trên trình duyệt này." }
        : { message: "Ghi chú hiện được giữ trong phiên này. Trình duyệt chưa lưu được thay đổi trên thiết bị.", warning: true })
    } catch {
      if (mounted.current) { focusIntent.current = "note"; setNoteError("Chưa thể lưu ghi chú. Nội dung đã nhập vẫn được giữ để bạn thử lại.") }
    } finally {
      if (mounted.current) { submitting.current = false; setBusy(null) }
    }
  }

  return (
    <div ref={pageElement} tabIndex={-1} className="min-w-0 outline-none">
      <Button variant="ghost" className="mb-5 h-11 text-muted-foreground" render={<Link href="/cong-viec" />} nativeButton={false}><ArrowLeftIcon aria-hidden="true" />Công việc được phân công</Button>
      <StaffPageHeader title={`Công việc ${order.code}`} description={`${service?.name || "Dịch vụ không còn trong danh sách"} · Đặt ngày ${date(order.createdAt)}`} action={<StaffJobBadge order={order} />} />
      {feedback && <div ref={feedbackElement} role="status" tabIndex={-1} className={`mb-6 flex min-w-0 items-start gap-3 rounded-xl border px-5 py-4 text-sm leading-7 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring ${feedback.warning ? "border-amber-200 bg-amber-50 text-amber-900" : "border-blue-100 bg-blue-50 text-blue-900"}`}><InfoIcon aria-hidden="true" className="mt-1 size-5 shrink-0" /><p className="m-0 min-w-0 break-words">{feedback.message}</p></div>}

      <div className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="min-w-0 space-y-6">
          <Card className="min-w-0 rounded-2xl shadow-none ring-border [--card-spacing:--spacing(6)]">
            <CardHeader><h2 className="m-0 text-lg font-semibold">Thông tin công việc</h2></CardHeader>
            <CardContent className="space-y-6">
              <div className="flex min-w-0 items-start gap-4">
                {service?.image && <Image src={service.image} alt={service.name} width={80} height={80} sizes="80px" className="size-20 shrink-0 rounded-xl object-cover" />}
                <div className="min-w-0"><h3 className="m-0 break-words text-lg leading-7 font-semibold">{service?.name || "Dịch vụ không còn trong danh sách"}</h3><p className="m-0 mt-2 text-sm text-muted-foreground">{order.quantity} {service?.unit || "đơn vị"}</p></div>
              </div>
              <dl className="m-0 grid gap-5 border-t border-border pt-6 sm:grid-cols-2">
                <DetailItem label="Ngày và giờ thực hiện"><span className="flex items-start gap-2"><CalendarDaysIcon aria-hidden="true" className="mt-1.5 size-4 shrink-0 text-primary" /><span className="min-w-0">{date(order.scheduledAt)}</span></span></DetailItem>
                <DetailItem label="Thời lượng dự kiến"><span className="flex items-center gap-2"><Clock3Icon aria-hidden="true" className="size-4 shrink-0 text-primary" />{order.durationMinutes} phút</span></DetailItem>
                <DetailItem label="Khối lượng công việc">{order.quantity} {service?.unit || "đơn vị"}</DetailItem>
                <DetailItem label="Mã đơn">{order.code}</DetailItem>
              </dl>
              {service && service.scope.length > 0 && <section className="border-t border-border pt-6"><h3 className="m-0 mb-4 text-sm font-semibold">Phạm vi công việc</h3><ul className="m-0 grid list-none gap-3 p-0">{service.scope.map((item, index) => <li key={`${index}-${item}`} className="flex min-w-0 items-start gap-2.5 text-sm leading-7 text-muted-foreground"><CheckIcon aria-hidden="true" className="mt-1.5 size-4 shrink-0 text-primary" /><span className="min-w-0 break-words">{item}</span></li>)}</ul></section>}
            </CardContent>
          </Card>

          <Card className="min-w-0 rounded-2xl shadow-none ring-border [--card-spacing:--spacing(6)]">
            <CardHeader><h2 className="m-0 text-lg font-semibold">Khách hàng và địa điểm</h2></CardHeader>
            <CardContent><dl className="m-0 grid gap-5 sm:grid-cols-2">
              <DetailItem label="Người liên hệ">{order.contact.name}</DetailItem>
              <DetailItem label="Số điện thoại"><a href={`tel:${order.contact.phone.replace(/[^+\d]/g, "")}`} className="inline-flex min-h-11 items-center gap-2 rounded-md text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"><PhoneIcon aria-hidden="true" className="size-4 shrink-0" />{order.contact.phone}</a></DetailItem>
              <DetailItem label="Địa chỉ thực hiện" wide><span className="flex min-w-0 items-start gap-2"><MapPinIcon aria-hidden="true" className="mt-1.5 size-4 shrink-0 text-primary" /><span className="min-w-0 break-words">{order.contact.address}</span></span></DetailItem>
              <DetailItem label="Loại nhà">{HOUSE_TYPE_LABEL[order.contact.houseType] || "Chưa cung cấp"}</DetailItem>
              <DetailItem label="Diện tích">{order.contact.area !== undefined ? `${order.contact.area} m²` : "Chưa cung cấp"}</DetailItem>
              <DetailItem label="Số phòng / số tầng">{order.contact.rooms ?? "—"} phòng · {order.contact.floors ?? "—"} tầng</DetailItem>
              <DetailItem label="Thú cưng">{typeof order.contact.hasPets === "boolean" ? order.contact.hasPets ? "Có thú cưng" : "Không có thú cưng" : "Chưa cung cấp"}</DetailItem>
              <DetailItem label="Ghi chú của khách hàng" wide><p className="m-0 whitespace-pre-wrap">{order.specialRequest || "Không có yêu cầu đặc biệt."}</p></DetailItem>
            </dl></CardContent>
          </Card>

          <Card className="min-w-0 rounded-2xl shadow-none ring-border [--card-spacing:--spacing(6)]">
            <CardHeader><div className="flex items-center gap-2.5"><StickyNoteIcon aria-hidden="true" className="size-5 text-primary" /><h2 className="m-0 text-lg font-semibold">Ghi chú công việc</h2></div></CardHeader>
            <CardContent className="space-y-6">
              {order.staffNotes.length ? <ol className="m-0 grid list-none gap-4 p-0">{order.staffNotes.map((item, index) => <li key={`${item.at}-${index}`} className="min-w-0 rounded-xl border border-border bg-slate-50/60 px-4 py-3"><p className="m-0 break-words text-sm leading-7 whitespace-pre-wrap">{item.text}</p><p className="m-0 mt-2 text-xs leading-6 text-muted-foreground">{date(item.at)}</p></li>)}</ol> : <p className="m-0 text-sm leading-7 text-muted-foreground">Chưa có ghi chú thực hiện.</p>}
              {order.status !== "cancelled" ? <form noValidate onSubmit={saveNote} aria-busy={busy === "note"} className="flex flex-col gap-4 border-t border-border pt-5">
                <Field label="Ghi chú mới" error={noteError} hint="Ghi lại tình hình thực hiện và những thông tin cần bàn giao. Tối đa 2.000 ký tự."><Textarea ref={noteInput} rows={4} value={note} disabled={Boolean(busy)} onChange={(event) => { setNote(event.target.value); setNoteError("") }} placeholder="Nhập ghi chú công việc..." /></Field>
                <div><Button type="submit" className="h-11 w-full sm:w-auto" disabled={Boolean(busy)}>{busy === "note" ? <><LoaderCircleIcon aria-hidden="true" className="animate-spin motion-reduce:animate-none" />Đang lưu...</> : "Lưu ghi chú"}</Button></div>
              </form> : <p className="m-0 border-t border-border pt-5 text-sm leading-7 text-muted-foreground">Công việc đã hủy. Ghi chú đã lưu vẫn được giữ để tra cứu.</p>}
            </CardContent>
          </Card>

          <Card className="min-w-0 rounded-2xl shadow-none ring-border [--card-spacing:--spacing(6)]">
            <CardHeader><h2 className="m-0 text-lg font-semibold">Lịch sử cập nhật</h2></CardHeader>
            <CardContent>{order.history.length ? <ol className="m-0 list-none p-0">{order.history.map((entry, index) => <li key={`${entry.at}-${index}`} className="relative flex min-w-0 gap-4 pb-6 last:pb-0"><div aria-hidden="true" className="relative flex w-5 shrink-0 justify-center"><span className="relative z-10 mt-2 size-2.5 rounded-full bg-primary" />{index < order.history.length - 1 && <span className="absolute top-5 bottom-[-0.5rem] w-px bg-border" />}</div><div className="min-w-0"><h3 className="m-0 break-words text-sm leading-7 font-semibold">{entry.label}</h3><p className="m-0 mt-1 break-words text-xs leading-6 text-muted-foreground">{date(entry.at)} · {entry.by}</p>{entry.note && <p className="m-0 mt-2 break-words text-sm leading-7 whitespace-pre-wrap text-muted-foreground">{entry.note}</p>}</div></li>)}</ol> : <p className="m-0 text-sm leading-7 text-muted-foreground">Chưa có cập nhật cho công việc này.</p>}</CardContent>
          </Card>
        </div>

        <aside aria-label="Trạng thái và chi phí công việc" className="min-w-0 space-y-6 xl:sticky xl:top-24">
          <Card className="min-w-0 rounded-2xl shadow-sm shadow-slate-900/5 ring-blue-100 [--card-spacing:--spacing(6)]">
            <CardHeader><div className="flex items-center gap-2.5"><ClipboardCheckIcon aria-hidden="true" className="size-5 text-primary" /><h2 className="m-0 text-lg font-semibold">Tiến trình công việc</h2></div></CardHeader>
            <CardContent className="space-y-5">
              <StaffJobBadge order={order} />
              <ol className="m-0 grid list-none gap-3 p-0" aria-label="Quy trình thực hiện">{steps.map((step, index) => <li key={step} className="flex items-center gap-3 text-sm"><span aria-hidden="true" className={`flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${order.status === "cancelled" ? "bg-slate-100 text-slate-500" : index <= currentStep ? "bg-blue-50 text-primary" : "bg-slate-100 text-slate-400"}`}>{index < currentStep && order.status !== "cancelled" ? <CheckIcon className="size-3.5" /> : index + 1}</span><span className={index === currentStep && order.status !== "cancelled" ? "font-semibold text-primary" : "text-muted-foreground"}>{JOB_STATUS_LABEL[step]}</span></li>)}</ol>
              {next && <Button ref={actionButton} type="button" className="h-11 w-full" disabled={Boolean(busy) || startBlocked} onClick={openConfirmation}>{next.label}</Button>}
              {startBlocked && <p className="m-0 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-7 text-amber-900">Yêu cầu hủy đang chờ xét duyệt. Vui lòng liên hệ quản trị viên trước khi bắt đầu.</p>}
              {order.status === "cancelled" && <p className="m-0 text-sm leading-7 text-muted-foreground">Công việc đã hủy và không còn thao tác thực hiện.</p>}
              {(order.status === "completed" || order.jobStatus === "done") && <p className="m-0 text-sm leading-7 text-muted-foreground">Công việc đã hoàn thành. Bạn có thể bổ sung ghi chú bàn giao.</p>}
            </CardContent>
          </Card>

          {order.cancelRequest && <Card className={`min-w-0 rounded-2xl shadow-none [--card-spacing:--spacing(6)] ${order.cancelRequest.status === "pending" ? "bg-amber-50/50 ring-amber-200" : "ring-border"}`}><CardHeader><h2 className="m-0 text-lg font-semibold">Yêu cầu hủy</h2></CardHeader><CardContent className="space-y-3"><Badge variant="outline" className="px-2.5 py-1.5">{({ pending: "Chờ xét duyệt", approved: "Đã duyệt hủy", rejected: "Đã từ chối" })[order.cancelRequest.status]}</Badge><p className="m-0 break-words text-sm leading-7 whitespace-pre-wrap">{order.cancelRequest.reason}</p>{order.cancelRequest.adminNote && <p className="m-0 break-words text-sm leading-7 text-muted-foreground">Phản hồi: {order.cancelRequest.adminNote}</p>}</CardContent></Card>}

          <Card className="min-w-0 rounded-2xl shadow-none ring-border [--card-spacing:--spacing(6)]"><CardHeader><div className="flex items-center gap-2.5"><ReceiptTextIcon aria-hidden="true" className="size-5 text-primary" /><h2 className="m-0 text-lg font-semibold">Chi phí đã ghi nhận</h2></div></CardHeader><CardContent className="space-y-4"><p className="m-0 break-words text-3xl font-bold tracking-tight text-primary tabular-nums">{money(order.price)}</p><Badge variant="outline" className="max-w-full px-2.5 py-1.5 whitespace-normal">{paymentLabel}</Badge><p className="m-0 text-sm leading-7 text-muted-foreground">{payment ? PAYMENT_METHOD_LABEL[payment.method] : "Chưa chọn phương thức thanh toán"}</p><p className="m-0 text-xs leading-6 text-muted-foreground">Theo thông tin đơn đã lưu. Trạng thái thanh toán được quản trị viên quản lý.</p></CardContent></Card>
        </aside>
      </div>
      <p className="m-0 mt-6 text-xs leading-6 text-muted-foreground">Thông tin công việc hiển thị theo dữ liệu đã lưu trên trình duyệt này.</p>
      {dialog && <JobConfirmation action={dialog} busy={busy === "advance"} error={submitError} isBusy={() => submitting.current} close={closeConfirmation} submit={advance} />}
    </div>
  )
}
