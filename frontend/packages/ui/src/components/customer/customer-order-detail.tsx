"use client"

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react"
import Image from "next/image"
import Link from "next/link"
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CalendarDaysIcon,
  CheckIcon,
  ClipboardListIcon,
  Clock3Icon,
  InfoIcon,
  LoaderCircleIcon,
  MapPinIcon,
  PhoneIcon,
  ReceiptTextIcon,
  StarIcon,
  UserRoundIcon,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { HOUSE_TYPE_LABEL, JOB_STATUS_LABEL, PAYMENT_METHOD_LABEL } from "@/lib/config"
import { canRequestCancel, paymentOf, reviewOf } from "@/lib/logic"
import type { PaymentMethod } from "@/lib/types"
import { date, Field, Modal, money, useData } from "../../common"
import { requestCustomerCancellation, saveCustomerPayment, saveCustomerReview } from "./booking-service"
import { CustomerOrderError, CustomerOrderStatus } from "./customer-orders"

type DialogKind = "cancel" | "pay" | "review"
type Feedback = { message: string; warning?: boolean }

function DetailItem({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return <div className={`min-w-0 ${wide ? "sm:col-span-2" : ""}`}><dt className="mb-2 text-xs text-muted-foreground">{label}</dt><dd className="m-0 break-words text-sm leading-7 text-foreground">{children}</dd></div>
}

function customerHistoryLabel(label: string) {
  if (label === "Khách báo đã chuyển khoản – chờ xác nhận" || label === "Khách chọn chuyển khoản – chờ xác nhận") return "Đã lưu lựa chọn chuyển khoản trên trình duyệt"
  if (label === "Khách hàng gửi yêu cầu hủy") return "Đã lưu yêu cầu hủy trên trình duyệt"
  return label
}

export function CustomerOrderDetail({ id }: { id: string }) {
  const { s, user, role } = useData()
  const [dialog, setDialog] = useState<DialogKind | null>(null)
  const [reason, setReason] = useState("")
  const [reasonError, setReasonError] = useState("")
  const [submitError, setSubmitError] = useState("")
  const [method, setMethod] = useState<PaymentMethod>("cash")
  const [serviceStars, setServiceStars] = useState(5)
  const [staffStars, setStaffStars] = useState(5)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const submitting = useRef(false)
  const openedOrderId = useRef<string | null>(null)
  const currentOrderId = useRef(id)
  const dialogTrigger = useRef<HTMLElement | null>(null)
  const feedbackElement = useRef<HTMLDivElement | null>(null)
  const focusFrame = useRef<number | null>(null)
  currentOrderId.current = id

  useEffect(() => {
    setDialog(null)
    setReason("")
    setReasonError("")
    setSubmitError("")
    setFeedback(null)
    setBusy(false)
    openedOrderId.current = null
    submitting.current = false
    dialogTrigger.current = null
    return () => {
      if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current)
    }
  }, [id])

  if (!s) return <div className="mx-auto max-w-6xl space-y-6 px-4 py-12 sm:px-6" aria-busy="true" aria-label="Đang tải chi tiết đơn"><Skeleton className="h-12 w-60" /><Skeleton className="h-80 w-full rounded-2xl" /><Skeleton className="h-64 w-full rounded-2xl" /></div>
  if (!Array.isArray(s.orders) || !Array.isArray(s.services) || !Array.isArray(s.users) || !Array.isArray(s.payments) || !Array.isArray(s.reviews)) return <CustomerOrderError />
  const order = s.orders.find((item) => item?.id === id)
  if (!order || !user || role !== "customer" || order.customerId !== user.id) return (
    <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <div className="rounded-2xl border border-dashed border-border px-6 py-12 text-center"><ClipboardListIcon aria-hidden="true" className="mx-auto mb-5 size-10 text-muted-foreground" /><h1 className="m-0 text-2xl font-semibold">Không tìm thấy đơn dịch vụ</h1><p className="mt-4 mb-6 text-sm leading-7 text-muted-foreground">Đơn không còn trong danh sách hoặc bạn không có quyền xem.</p><Button variant="outline" render={<Link href="/don-cua-toi" />} nativeButton={false}>Trở về đơn của tôi</Button></div>
    </section>
  )
  if (!order.contact || !Array.isArray(order.history) || typeof order.scheduledAt !== "string" || typeof order.createdAt !== "string"
    || s.services.some((item) => !item || !Array.isArray(item.scope)) || s.users.some((item) => !item)
    || s.payments.some((item) => !item) || s.reviews.some((item) => !item)) return <CustomerOrderError />

  const service = s.services.find((item) => item.id === order.serviceId)
  const employee = s.users.find((item) => item.id === order.staffId)
  const payment = paymentOf(s, order.id)
  const review = reviewOf(s, order.id)
  const cancelAllowed = canRequestCancel(order)
  const paymentLabel = payment?.status === "paid" ? "Đã xác nhận đã nhận tiền" : payment?.status === "pending" ? "Chờ CleanHome xác nhận đã nhận tiền" : "Chưa ghi nhận đã nhận tiền"

  const restoreDialogFocus = () => {
    if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current)
    focusFrame.current = requestAnimationFrame(() => {
      focusFrame.current = null
      if (currentOrderId.current !== order.id) return
      const trigger = dialogTrigger.current
      if (trigger?.isConnected && !trigger.hasAttribute("disabled")) trigger.focus({ preventScroll: true })
      else feedbackElement.current?.focus()
    })
  }

  const openDialog = (kind: DialogKind, trigger: HTMLElement) => {
    if (submitting.current) return
    openedOrderId.current = order.id
    dialogTrigger.current = trigger
    setReason("")
    setReasonError("")
    setSubmitError("")
    setFeedback(null)
    setMethod(payment?.method || "cash")
    setServiceStars(5)
    setStaffStars(5)
    setDialog(kind)
  }

  const closeDialog = () => {
    if (submitting.current) return
    setDialog(null)
    setReasonError("")
    setSubmitError("")
    restoreDialogFocus()
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submitting.current || !dialog) return
    if (openedOrderId.current !== order.id) { setSubmitError("Thông tin đơn đã thay đổi. Vui lòng mở lại thao tác."); return }
    if ((dialog === "cancel" || dialog === "review") && !reason.trim()) {
      setReasonError(dialog === "cancel" ? "Vui lòng nhập lý do hủy." : "Vui lòng nhập nhận xét của bạn.")
      return
    }
    if (dialog === "review" && (![serviceStars, ...(order.staffId ? [staffStars] : [])].every((value) => Number.isInteger(value) && value >= 1 && value <= 5))) {
      setSubmitError("Vui lòng chọn đánh giá từ 1 đến 5 sao.")
      return
    }
    submitting.current = true
    setBusy(true)
    setSubmitError("")
    const modalElement = event.currentTarget.closest("dialog")
    const blockNativeCancel = (nativeEvent: Event) => nativeEvent.preventDefault()
    modalElement?.addEventListener("cancel", blockNativeCancel)
    try {
      if (dialog === "cancel") {
        const result = await requestCustomerCancellation(order.id, reason.trim())
        if (currentOrderId.current !== order.id) return
        if (!result.ok) { setSubmitError(result.error); return }
        setFeedback(result.persistence === "session"
          ? { message: "Yêu cầu hủy chỉ được giữ trong phiên hiện tại; trình duyệt chưa lưu được trên thiết bị. Đơn vẫn chờ xét duyệt.", warning: true }
          : { message: "Đã lưu yêu cầu hủy trên trình duyệt này. Đơn vẫn chờ xét duyệt." })
      } else {
        const result = dialog === "pay"
          ? await saveCustomerPayment(order.id, method)
          : await saveCustomerReview(order.id, { serviceRating: serviceStars, ...(order.staffId ? { staffRating: staffStars } : {}), comment: reason.trim() })
        if (currentOrderId.current !== order.id) return
        if (!result.ok) { setSubmitError(result.error); return }
        setFeedback(result.persistence === "session"
          ? { message: dialog === "pay" ? "Lựa chọn thanh toán chỉ được giữ trong phiên hiện tại; trình duyệt chưa lưu được trên thiết bị. Chưa xác nhận thanh toán." : "Đánh giá chỉ được giữ trong phiên hiện tại; trình duyệt chưa lưu được trên thiết bị.", warning: true }
          : { message: dialog === "pay" ? "Lựa chọn thanh toán được lưu trên trình duyệt này; chưa xác nhận đã nhận tiền." : "Đã lưu đánh giá của bạn trên trình duyệt này." })
      }
      setDialog(null)
      setReasonError("")
      setSubmitError("")
      restoreDialogFocus()
    } catch {
      setSubmitError("Chưa lưu được thay đổi. Vui lòng thử lại.")
    } finally {
      modalElement?.removeEventListener("cancel", blockNativeCancel)
      if (currentOrderId.current === order.id) { submitting.current = false; setBusy(false) }
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 pt-6 pb-16 sm:px-6 md:pt-8 md:pb-24">
      <Button variant="ghost" className="mb-6 text-muted-foreground" render={<Link href="/don-cua-toi" />} nativeButton={false}><ArrowLeftIcon data-icon="inline-start" aria-hidden="true" />Đơn của tôi</Button>
      <header className="mb-8 flex flex-col items-start gap-5 sm:flex-row sm:items-center sm:justify-between md:mb-10">
        <div className="min-w-0"><p className="m-0 mb-3 text-xs font-semibold tracking-[0.12em] text-primary uppercase">CleanHome / Chi tiết đơn</p><h1 className="m-0 break-words text-3xl leading-tight font-bold tracking-tight md:text-4xl">Đơn {order.code}</h1><p className="m-0 mt-3 text-sm leading-7 text-muted-foreground">Đặt ngày {date(order.createdAt)}</p></div>
        <CustomerOrderStatus status={order.status} />
      </header>

      {feedback && <div ref={feedbackElement} role="status" tabIndex={-1} className={`mb-6 flex min-w-0 items-start gap-3 rounded-xl border px-5 py-4 text-sm leading-7 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring ${feedback.warning ? "border-amber-200 bg-amber-50 text-amber-900" : "border-blue-100 bg-blue-50 text-blue-900"}`}><InfoIcon aria-hidden="true" className="mt-1 size-5 shrink-0" /><p className="m-0 min-w-0 break-words">{feedback.message}</p></div>}
      {order.status === "pending" && <div className="mb-8 flex min-w-0 items-start gap-3 rounded-xl border border-blue-100 bg-blue-50/60 px-5 py-4 text-sm leading-7 text-blue-900"><InfoIcon aria-hidden="true" className="mt-1 size-5 shrink-0" /><p className="m-0 min-w-0">Yêu cầu đang chờ CleanHome xác nhận thời gian bạn đề xuất. Thông tin được lưu trên trình duyệt này.</p></div>}

      <div className="grid min-w-0 items-start gap-7 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-8">
        <div className="min-w-0 space-y-7">
          <Card className="min-w-0 overflow-visible rounded-2xl shadow-none ring-border [--card-spacing:--spacing(6)]">
            <CardHeader><h2 className="m-0 text-lg font-semibold">Thông tin dịch vụ</h2></CardHeader>
            <CardContent className="space-y-6">
              <div className="flex min-w-0 items-start gap-4">
                {service?.image && <Image src={service.image} alt={service.name} width={88} height={88} sizes="88px" className="size-22 shrink-0 rounded-xl object-cover" />}
                <div className="min-w-0"><h3 className="m-0 break-words text-lg leading-7 font-semibold">{service?.name || "Dịch vụ không còn trong danh sách"}</h3><p className="m-0 mt-2 text-sm text-muted-foreground">{order.quantity} {service?.unit || "đơn vị"}</p>{service && <Link href={`/dich-vu/${service.slug}`} className="inline-flex min-h-11 items-center gap-1.5 rounded-md text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">Chi tiết dịch vụ<ArrowRightIcon aria-hidden="true" className="size-3.5" /></Link>}</div>
              </div>
              <dl className="m-0 grid gap-5 border-t border-border pt-6 sm:grid-cols-2">
                <DetailItem label={order.status === "pending" ? "Thời gian đề xuất" : "Lịch thực hiện"}><span className="flex min-w-0 items-start gap-2"><CalendarDaysIcon aria-hidden="true" className="mt-1.5 size-4 shrink-0 text-primary" /><span className="min-w-0">{date(order.scheduledAt)}</span></span></DetailItem>
                <DetailItem label="Thời lượng dự kiến"><span className="flex items-center gap-2"><Clock3Icon aria-hidden="true" className="size-4 shrink-0 text-primary" />{order.durationMinutes} phút</span></DetailItem>
                <DetailItem label="Nhân viên thực hiện" wide>{employee ? <span className="flex flex-wrap items-center gap-3"><span className="flex items-center gap-2 font-medium"><UserRoundIcon aria-hidden="true" className="size-4 shrink-0 text-primary" />{employee.name}</span>{order.jobStatus && <Badge variant="secondary" className="px-2.5 py-1.5">{JOB_STATUS_LABEL[order.jobStatus]}</Badge>}</span> : "Chưa có nhân viên được phân công."}</DetailItem>
              </dl>
              {service && service.scope.length > 0 && <section className="border-t border-border pt-6"><h3 className="m-0 mb-4 text-sm font-semibold">Phạm vi dịch vụ</h3><ul className="m-0 grid list-none gap-3 p-0">{service.scope.map((item, index) => <li key={`${index}-${item}`} className="flex min-w-0 items-start gap-2.5 text-sm leading-7 text-muted-foreground"><CheckIcon aria-hidden="true" className="mt-1.5 size-4 shrink-0 text-primary" /><span className="min-w-0 break-words">{item}</span></li>)}</ul></section>}
              {(cancelAllowed || order.status === "completed") && <div className="flex flex-col gap-3 border-t border-border pt-6 sm:flex-row sm:flex-wrap">
                {cancelAllowed && <Button variant="outline" disabled={busy} onClick={(event) => openDialog("cancel", event.currentTarget)}>Yêu cầu hủy</Button>}
                {order.status === "completed" && <Button disabled={busy} render={<Link href={`/dat-dich-vu/${order.id}`} />} nativeButton={false}>Đặt lại dịch vụ<ArrowRightIcon data-icon="inline-end" aria-hidden="true" /></Button>}
              </div>}
            </CardContent>
          </Card>

          <Card className="min-w-0 overflow-visible rounded-2xl shadow-none ring-border [--card-spacing:--spacing(6)]">
            <CardHeader><h2 className="m-0 text-lg font-semibold">Liên hệ và địa điểm</h2></CardHeader>
            <CardContent><dl className="m-0 grid gap-5 sm:grid-cols-2">
              <DetailItem label="Người liên hệ">{order.contact.name}</DetailItem>
              <DetailItem label="Số điện thoại"><a href={`tel:${order.contact.phone}`} className="inline-flex min-h-11 items-center gap-2 rounded-md text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"><PhoneIcon aria-hidden="true" className="size-4 shrink-0" />{order.contact.phone}</a></DetailItem>
              <DetailItem label="Địa chỉ thực hiện" wide><span className="flex min-w-0 items-start gap-2"><MapPinIcon aria-hidden="true" className="mt-1.5 size-4 shrink-0 text-primary" /><span className="min-w-0 break-words">{order.contact.address}</span></span></DetailItem>
              <DetailItem label="Loại nhà">{HOUSE_TYPE_LABEL[order.contact.houseType]}</DetailItem>
              {order.contact.area !== undefined && <DetailItem label="Diện tích">{order.contact.area} m²</DetailItem>}
              {(order.contact.rooms !== undefined || order.contact.floors !== undefined) && <DetailItem label="Số phòng / số tầng">{order.contact.rooms ?? "—"} phòng · {order.contact.floors ?? "—"} tầng</DetailItem>}
              {order.contact.hasPets && <DetailItem label="Thú cưng">Có thú cưng</DetailItem>}
              <DetailItem label="Yêu cầu đặc biệt" wide><span className="whitespace-pre-wrap">{order.specialRequest || "Không có yêu cầu đặc biệt."}</span></DetailItem>
            </dl></CardContent>
          </Card>

          {order.cancelRequest && <Card className={`min-w-0 overflow-visible rounded-2xl shadow-none [--card-spacing:--spacing(6)] ${order.cancelRequest.status === "pending" ? "bg-amber-50/50 ring-amber-200" : "ring-border"}`}>
            <CardHeader><h2 className="m-0 text-lg font-semibold">Yêu cầu hủy</h2></CardHeader>
            <CardContent className="space-y-4"><Badge variant="outline" className="px-2.5 py-1.5">{({ pending: "Chờ xét duyệt", approved: "Đã duyệt hủy", rejected: "Đã từ chối" })[order.cancelRequest.status]}</Badge><p className="m-0 break-words text-sm leading-7 whitespace-pre-wrap">{order.cancelRequest.reason}</p><p className="m-0 text-xs leading-6 text-muted-foreground">Lưu ngày {date(order.cancelRequest.requestedAt)}</p>{order.cancelRequest.status === "pending" && <p className="m-0 text-sm leading-7 text-muted-foreground">Yêu cầu được lưu trên trình duyệt này. Trạng thái đơn giữ nguyên trong khi chờ duyệt.</p>}{order.cancelRequest.adminNote && <p className="m-0 rounded-xl bg-white p-4 text-sm leading-7 text-muted-foreground"><span className="font-medium text-foreground">Phản hồi: </span>{order.cancelRequest.adminNote}</p>}</CardContent>
          </Card>}

          <Card className="min-w-0 overflow-visible rounded-2xl shadow-none ring-border [--card-spacing:--spacing(6)]">
            <CardHeader><h2 className="m-0 text-lg font-semibold">Tiến trình đơn</h2></CardHeader>
            <CardContent>{order.history.length > 0 ? <ol className="m-0 list-none p-0">{order.history.map((entry, index) => <li key={`${entry.at}-${index}`} className="relative flex min-w-0 gap-4 pb-7 last:pb-0"><div aria-hidden="true" className="relative flex w-6 shrink-0 justify-center"><span className="relative z-10 mt-1.5 size-3 rounded-full border-[3px] border-blue-100 bg-primary" />{index < order.history.length - 1 && <span className="absolute top-4 bottom-[-0.5rem] w-px bg-border" />}</div><div className="min-w-0"><h3 className="m-0 break-words text-sm leading-7 font-semibold">{customerHistoryLabel(entry.label)}</h3><p className="m-0 mt-1 text-xs leading-6 text-muted-foreground">{date(entry.at)} · {entry.by}</p>{entry.note && <p className="m-0 mt-2 break-words text-sm leading-7 whitespace-pre-wrap text-muted-foreground">{entry.note}</p>}</div></li>)}</ol> : <p className="m-0 text-sm text-muted-foreground">Chưa có cập nhật cho đơn này.</p>}</CardContent>
          </Card>
        </div>

        <aside aria-label="Chi phí, thanh toán và đánh giá" className="min-w-0 space-y-6 lg:sticky lg:top-28">
          <Card className="min-w-0 overflow-visible rounded-2xl shadow-sm shadow-slate-900/5 ring-blue-100 [--card-spacing:--spacing(6)]">
            <CardHeader><div className="flex items-center gap-2.5"><ReceiptTextIcon aria-hidden="true" className="size-5 text-primary" /><h2 className="m-0 text-lg font-semibold">Chi phí và thanh toán</h2></div></CardHeader>
            <CardContent className="space-y-5"><div><p className="m-0 text-sm text-muted-foreground">Tổng dự kiến</p><p className="m-0 mt-2 break-words text-3xl font-bold tracking-tight text-primary tabular-nums">{money(order.price)}</p><p className="m-0 mt-2 text-xs leading-6 text-muted-foreground">Theo thông tin đã lưu khi đặt dịch vụ.</p></div><div className="space-y-3 border-t border-border pt-5"><Badge variant="outline" className={`px-2.5 py-1.5 whitespace-normal ${payment?.status === "paid" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-slate-50 text-slate-600"}`}>{paymentLabel}</Badge><p className="m-0 text-sm text-muted-foreground">{payment ? PAYMENT_METHOD_LABEL[payment.method] : "Chưa chọn phương thức thanh toán"}</p>{payment?.confirmedAt && <p className="m-0 text-xs leading-6 text-muted-foreground">Ghi nhận ngày {date(payment.confirmedAt)}</p>}{payment?.refundRequired && <p className="m-0 rounded-xl bg-amber-50 p-3 text-sm leading-6 text-amber-900">Khoản thanh toán cần được xem xét hoàn lại.</p>}</div>{order.status !== "cancelled" && payment?.status !== "paid" && <Button className="w-full" variant="outline" disabled={busy} onClick={(event) => openDialog("pay", event.currentTarget)}>Chọn / cập nhật thanh toán</Button>}<p className="m-0 text-xs leading-6 text-muted-foreground">Thông tin thanh toán hiển thị theo dữ liệu đang lưu trên trình duyệt này.</p></CardContent>
          </Card>

          {order.status === "completed" && <Card className="min-w-0 overflow-visible rounded-2xl shadow-none ring-border [--card-spacing:--spacing(6)]"><CardHeader><h2 className="m-0 text-lg font-semibold">Đánh giá dịch vụ</h2></CardHeader><CardContent>          {review ? <div className="space-y-4"><div className="flex flex-wrap items-center gap-2"><div className="flex gap-1 text-amber-500" aria-label={`Chất lượng dịch vụ: ${review.serviceRating} trên 5 sao`}>{[1, 2, 3, 4, 5].map((star) => <StarIcon key={star} aria-hidden="true" className={`size-4 ${star <= review.serviceRating ? "fill-current" : "text-slate-200"}`} />)}</div><span className="text-sm font-medium">{review.serviceRating}/5</span></div><p className="m-0 break-words text-sm leading-7 whitespace-pre-wrap">{review.comment}</p>{review.staffId && review.staffRating !== undefined && <p className="m-0 text-xs leading-6 text-muted-foreground">Nhân viên: {review.staffRating}/5 sao</p>}<p className="m-0 text-xs leading-6 text-muted-foreground">{date(review.createdAt)}</p></div> : <div className="space-y-4"><p className="m-0 text-sm leading-7 text-muted-foreground">{order.staffId ? "Chia sẻ trải nghiệm về dịch vụ và nhân viên đã hoàn thành." : "Đơn chưa có nhân viên được phân công; bạn vẫn có thể đánh giá chất lượng dịch vụ."}</p><Button className="w-full" variant="outline" disabled={busy} onClick={(event) => openDialog("review", event.currentTarget)}>Viết đánh giá</Button></div>}</CardContent></Card>}
        </aside>
      </div>

      {dialog && <Modal title={dialog === "cancel" ? "Yêu cầu hủy dịch vụ" : dialog === "pay" ? "Chọn phương thức thanh toán" : "Đánh giá dịch vụ"} close={closeDialog}>
        <form noValidate className="ch-form" onSubmit={submit} aria-busy={busy}>
          {dialog === "cancel" && <><p className="m-0 text-sm leading-7 text-muted-foreground">Yêu cầu hủy cần được xem xét. Đơn vẫn giữ trạng thái hiện tại trong khi chờ duyệt.</p><Field label="Lý do hủy" error={reasonError}><Textarea required rows={4} value={reason} disabled={busy} onChange={(event) => { setReason(event.target.value); setReasonError("") }} placeholder="Cho CleanHome biết lý do bạn muốn hủy lịch hẹn." /></Field></>}
          {dialog === "pay" && <><Field label="Phương thức thanh toán"><select value={method} disabled={busy} onChange={(event) => setMethod(event.target.value === "transfer" ? "transfer" : "cash")}><option value="cash">Tiền mặt</option><option value="transfer">Chuyển khoản</option></select></Field><p className="m-0 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm leading-7 text-blue-900">{method === "transfer" ? "Lựa chọn chuyển khoản sẽ được lưu ở trạng thái chờ CleanHome ghi nhận đã nhận tiền. Đây không phải xác nhận giao dịch ngân hàng." : "Lựa chọn tiền mặt sẽ được lưu trên thiết bị này; chỉ CleanHome ghi nhận sau khi nhận tiền. Chưa có khoản thanh toán nào được xác nhận."}</p></>}
          {dialog === "review" && <><Field label="Chất lượng dịch vụ"><select value={serviceStars} disabled={busy} onChange={(event) => setServiceStars(Number(event.target.value))}>{[5, 4, 3, 2, 1].map((value) => <option key={value} value={value}>{value} sao</option>)}</select></Field>{order.staffId && <Field label="Nhân viên thực hiện"><select value={staffStars} disabled={busy} onChange={(event) => setStaffStars(Number(event.target.value))}>{[5, 4, 3, 2, 1].map((value) => <option key={value} value={value}>{value} sao</option>)}</select></Field>}<Field label="Nhận xét" error={reasonError}><Textarea required rows={4} maxLength={2000} value={reason} disabled={busy} onChange={(event) => { setReason(event.target.value); setReasonError("") }} placeholder="Trải nghiệm của bạn về dịch vụ vừa sử dụng." /></Field></>}
          {submitError && <p role="alert" className="m-0 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-7 text-red-800">{submitError}</p>}
          <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end"><Button type="button" variant="outline" disabled={busy} onClick={closeDialog}>Quay lại</Button><Button type="submit" disabled={busy}>{busy ? <><LoaderCircleIcon aria-hidden="true" className="animate-spin motion-reduce:animate-none" />Đang lưu...</> : dialog === "cancel" ? "Lưu yêu cầu hủy" : dialog === "pay" ? "Lưu lựa chọn thanh toán" : "Lưu đánh giá"}</Button></div>
        </form>
      </Modal>}
    </div>
  )
}
