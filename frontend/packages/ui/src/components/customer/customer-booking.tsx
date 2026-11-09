"use client"

import { useEffect, useId, useRef, useState, type FormEvent } from "react"
import { CustomerImage as Image } from "./customer-image"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { ArrowLeftIcon, ArrowRightIcon, CalendarDaysIcon, CheckIcon, ClipboardListIcon, Clock3Icon, HouseIcon, LoaderCircleIcon, PencilIcon, RefreshCwIcon, SparklesIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { PageSkeleton } from "@/components/shared/role-guard"
import { Field, useData } from "../../common"
import { HOUSE_TYPE_LABEL, TIME_SLOTS } from "@/lib/config"
import { formatCurrency } from "@/lib/format"
import { estimateDuration, estimatePrice } from "@/lib/mock-data"
import type { HouseType, Order, Service, User, PaymentMethod } from "@/lib/types"
import { CLEANING_TYPE_LABEL, cleaningTypeOf, serviceRequiresHouseDetails } from "@/lib/service-taxonomy"
import { saveBookingRequest, type BookingRequest } from "./booking-service"
import { openBookingDraft } from "./booking-draft"
import { CheckoutPayment } from "./checkout-payment"
import { customerSnapshot, refreshCustomerService } from "@/lib/customer-api-store"
import { bookingDateTime, firstInvalidBookingStep, localDateValue, validateBookingStep, type BookingErrors, type BookingValues } from "./booking-validation"
import { bookingDraftRoute, bookingLoginHref, resolveBookingRoute } from "./booking-routing"

const STEPS = ["Dịch vụ", "Thông tin nhà ở", "Ngày giờ", "Kiểm tra yêu cầu"]
const controlClass = "min-h-12 w-full min-w-0 rounded-xl border border-input bg-white px-3 py-2 text-base outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60 aria-invalid:border-destructive aria-invalid:ring-destructive/20 md:text-sm"

function BookingMessage({ title, description, error = false, href = "/dich-vu", action = "Xem danh sách dịch vụ" }: { title: string; description: string; error?: boolean; href?: string; action?: string }) {
  return <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6"><div className="rounded-2xl border border-dashed border-border bg-slate-50 px-5 py-12 text-center" role={error ? "alert" : undefined}><h1 className="m-0 text-2xl leading-tight font-bold">{title}</h1><p className="mx-auto mt-4 max-w-lg text-sm leading-7 text-muted-foreground">{description}</p><div className="mt-6 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">{error && <Button variant="outline" onClick={() => window.location.reload()}><RefreshCwIcon aria-hidden="true" />Tải lại trang</Button>}<Button render={<Link href={href} />} nativeButton={false}>{action}<ArrowRightIcon aria-hidden="true" /></Button></div></div></section>
}

export function CustomerBooking({ id }: { id?: string }) {
  const { s, user } = useData()
  const params = useSearchParams()
  const rebookIds = params.getAll("rebook")
  const rebookId = rebookIds.length ? rebookIds.length === 1 ? rebookIds[0] : "" : undefined
  if (!s) return <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6" role="status" aria-label="Đang tải đặt dịch vụ"><PageSkeleton /></div>
  if (!Array.isArray(s.services)) return <BookingMessage title="Chưa thể tải dịch vụ" description="Vui lòng tải lại trang để thử lại." error />
  if (!user) return <BookingMessage title="Đăng nhập để tiếp tục" description="Đăng nhập tài khoản khách hàng để lưu yêu cầu của bạn." href={bookingLoginHref(id, rebookId)} action="Đăng nhập" />
  const selection = resolveBookingRoute({ serviceId: id, rebookId, services: s.services, orders: Array.isArray(s.orders) ? s.orders : [], customerId: user.id })
  if (selection.invalidRebook) return <BookingMessage title="Không thể đặt lại đơn này" description="Đơn không khả dụng để đặt lại hoặc không khớp với dịch vụ trong đường dẫn. Vui lòng mở đơn của bạn và chọn đặt lại từ đó." href="/don-cua-toi" action="Xem đơn dịch vụ" />
  if (rebookId !== undefined && !selection.initialService) return <BookingMessage title="Dịch vụ đang tạm ngừng" description="Dịch vụ của đơn cũ hiện không còn khả dụng để đặt lại. Bạn có thể xem những dịch vụ đang cung cấp." />
  if (!s.services.some((service) => service.status === "active")) return <BookingMessage title="Hiện chưa có dịch vụ để đặt" description="Vui lòng quay lại sau để xem các dịch vụ đang cung cấp của CleanHome." />
  const draftRoute = bookingDraftRoute(id, rebookId)
  return <BookingForm key={draftRoute} id={id} services={s.services} initialService={selection.initialService} previous={selection.previous} draftRoute={draftRoute} user={user} />
}

function BookingForm({ id, services, initialService, previous, draftRoute, user }: { id?: string; services: Service[]; initialService?: Service; previous?: Order; draftRoute: string; user: User }) {
  const router = useRouter()
  const [draftScope] = useState(() => openBookingDraft(user.id, draftRoute))
  const [restored] = useState(() => draftScope.read())
  const generatedId = useId()
  const active = services.filter((item) => item.status === "active")
  const requestedId = id
  const [values, setValues] = useState<BookingValues>(() => restored?.values ?? ({
    serviceId: initialService?.id || "",
    quantity: String(previous?.quantity ?? initialService?.defaultQuantity ?? ""),
    name: previous?.contact.name || user.name || "",
    phone: previous?.contact.phone || user.phone || "",
    address: previous?.contact.address || user.address || "",
    houseType: previous?.contact.houseType || (initialService && cleaningTypeOf(initialService) === "phong-tro" ? "phong-tro" : "can-ho"),
    area: String(previous?.contact.area ?? (initialService && serviceRequiresHouseDetails(initialService) ? cleaningTypeOf(initialService) === "phong-tro" ? 25 : 60 : "")),
    rooms: String(previous?.contact.rooms ?? (initialService && serviceRequiresHouseDetails(initialService) ? cleaningTypeOf(initialService) === "phong-tro" ? 1 : 2 : "")),
    floors: String(previous?.contact.floors ?? (initialService && serviceRequiresHouseDetails(initialService) ? 1 : "")),
    hasPets: previous?.contact.hasPets || false,
    date: "", time: "", specialRequest: previous?.specialRequest || "",
  }))
  const [step, setStep] = useState(restored?.step ?? 0)
  const [errors, setErrors] = useState<BookingErrors>({})
  const [submitError, setSubmitError] = useState("")
  const [uncertainSubmission, setUncertainSubmission] = useState(restored?.uncertain ?? false)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(restored?.attempt?.paymentMethod ?? restored?.paymentMethod ?? "cash")
  const [paymentPending, setPaymentPending] = useState(restored?.paymentPending ?? false)
  const [saving, setSaving] = useState(false)
  const [failedImage, setFailedImage] = useState<string | null>(null)
  const submitLock = useRef(false)
  const bookingAttempt = useRef<BookingRequest | null>(restored?.attempt ?? null)
  const finished = useRef(false)
  const mounted = useRef(false)
  const interacted = useRef(false)
  const formRef = useRef<HTMLFormElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const service = services.find((item) => item.id === values.serviceId)
  const currentService = service?.status === "active" ? service : undefined
  const requireHouseDetails = Boolean(currentService && serviceRequiresHouseDetails(currentService))
  const quantity = Number(values.quantity)
  const validQuantity = Boolean(currentService && values.quantity.trim() && Number.isFinite(quantity) && quantity >= currentService.minQuantity && quantity > 0 && Number.isFinite(estimatePrice(currentService, quantity)) && Number.isFinite(estimateDuration(currentService, quantity)))
  const scheduled = bookingDateTime(values.date, values.time)
  const image = currentService?.image || "/placeholder.svg"
  const unavailableSelection = requestedId && !initialService && !values.serviceId
  const fieldId = (name: keyof BookingValues) => `${generatedId}-${name}`

  useEffect(() => { if (interacted.current) headingRef.current?.focus() }, [step])
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    if (!finished.current) draftScope.save({ values, step, attempt: bookingAttempt.current, uncertain: uncertainSubmission, paymentMethod, paymentPending })
  }, [draftScope, values, step, uncertainSubmission, paymentMethod, paymentPending])

  const change = <K extends keyof BookingValues>(key: K, value: BookingValues[K]) => {
    setValues((old) => ({ ...old, [key]: value }))
    setErrors((old) => ({ ...old, [key]: undefined }))
    setSubmitError("")
    bookingAttempt.current = null
    setUncertainSubmission(false)
    setPaymentPending(false)
  }
  const goToStep = (next: number) => { interacted.current = true; setStep(next); setSubmitError("") }
  const focusError = () => requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (submitLock.current) return
    const retry = uncertainSubmission ? bookingAttempt.current : null
    if (!retry) {
      const found = validateBookingStep(step, values, currentService)
      if (Object.keys(found).length) {
        setErrors(found)
        if (step === 3) goToStep(firstInvalidBookingStep(found))
        focusError()
        return
      }
      if (step < 3) { setErrors({}); goToStep(step + 1); return }
    }
    const time = bookingDateTime(values.date, values.time)
    if (!retry && (!currentService || !time)) return
    submitLock.current = true
    setSaving(true)
    setSubmitError("")
    let saved = false
    try {
      let request = retry ?? bookingAttempt.current
      if (!request) {
        if (!currentService || !time) return
        request = {
          requestKey: crypto.randomUUID(),
          serviceId: currentService.id,
          expectedUnitPrice: currentService.price,
          quantity: Number(values.quantity),
          contact: { name: values.name.trim(), phone: values.phone.trim(), address: values.address.trim(), houseType: values.houseType, ...(values.area.trim() ? { area: Number(values.area) } : {}), ...(values.rooms.trim() ? { rooms: Number(values.rooms) } : {}), ...(values.floors.trim() ? { floors: Number(values.floors) } : {}), hasPets: values.hasPets },
          scheduledAt: time.toISOString(),
          specialRequest: values.specialRequest.trim(),
          paymentMethod,
        }
      }
      if (!request.paymentMethod) request = { ...request, paymentMethod }
      bookingAttempt.current = request
      // Persist the exact key/payload before sending, including if this form unmounts.
      draftScope.save({ values, step, attempt: request, uncertain: true, paymentMethod, paymentPending })
      const result = await saveBookingRequest(request)
      if (!result.ok) {
        const paymentStillPending = Boolean(result.paymentPending || paymentPending)
        const mustRetry = result.uncertain || paymentStillPending
        draftScope.save({ values, step, attempt: mustRetry ? request : null, uncertain: mustRetry, paymentMethod, paymentPending: paymentStillPending })
        if (!mounted.current || !draftScope.isCurrent()) return
        setSubmitError(result.error)
        setUncertainSubmission(mustRetry)
        setPaymentPending(paymentStillPending)
        if (!mustRetry) bookingAttempt.current = null
        if (result.code === "PRICE_CHANGED") {
          await refreshCustomerService(request.serviceId)
          if (mounted.current && draftScope.isCurrent()) {
            setStep(3)
            setSubmitError("Đơn giá đã thay đổi. Hãy xem giá mới trong phần kiểm tra yêu cầu và bấm lưu lại nếu bạn đồng ý. Chưa tạo lịch mới.")
          }
        }
        return
      }
      saved = true
      finished.current = true
      draftScope.clear()
      const sessionOwner = customerSnapshot()?.session?.userId
      if (!draftScope.isCurrent() || (sessionOwner && sessionOwner !== user.id) || (!mounted.current && sessionOwner)) return
      bookingAttempt.current = null
      setUncertainSubmission(false)
      if (result.warning) toast.warning(result.warning)
      else toast.success("Đã gửi yêu cầu đặt dịch vụ và lưu phương thức thanh toán mô phỏng")
      router.push(`/don/${result.order.id}`)
    } catch {
      draftScope.save({ values, step, attempt: bookingAttempt.current, uncertain: true, paymentMethod, paymentPending })
      if (!mounted.current || !draftScope.isCurrent()) return
      setSubmitError("Chưa xác nhận được kết quả. Hãy gửi lại đúng yêu cầu này để hệ thống kiểm tra, tránh tạo đơn trùng.")
      setUncertainSubmission(true)
    } finally {
      if (!saved) { submitLock.current = false; setSaving(false) }
    }
  }

  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 md:py-12" aria-labelledby="customer-booking-heading">
      <Link href="/dich-vu" className="mb-5 inline-flex min-h-11 items-center gap-2 rounded-md text-sm text-muted-foreground hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"><ArrowLeftIcon aria-hidden="true" className="size-4" />Danh sách dịch vụ</Link>
      <header className="mb-8 max-w-2xl">
        <p className="m-0 mb-3 inline-flex items-center gap-2 text-xs font-semibold tracking-[0.14em] text-primary uppercase"><SparklesIcon aria-hidden="true" className="size-4" />Đặt dịch vụ CleanHome</p>
        <h1 id="customer-booking-heading" className="m-0 text-3xl leading-tight font-bold tracking-tight sm:text-4xl">Một lịch hẹn, nhẹ việc nhà</h1>
        <p className="m-0 mt-4 text-base leading-7 text-muted-foreground">Chọn dịch vụ, điền thông tin và đề xuất thời gian phù hợp với bạn. Kiểm tra yêu cầu trước khi lưu.</p>
      </header>

      {restored && <p role="status" className="mb-6 rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm leading-6">Đã khôi phục thông tin bạn đang nhập trong tab này. Thông tin không được giữ khi tải lại hoặc đóng tab.</p>}
      {uncertainSubmission && <p role="status" className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6">{paymentPending ? "Lịch dịch vụ đã được tạo. Bước lưu phương thức thanh toán chưa được xác nhận; gửi lại đúng yêu cầu để tiếp tục trên lịch này, không tạo lịch mới." : "Yêu cầu trước chưa xác nhận được kết quả. Dùng nút “Gửi lại để xác nhận” để kiểm tra đúng yêu cầu đó, tránh tạo lịch trùng."}</p>}

      <nav aria-label="Các bước đặt dịch vụ" className="mb-8 rounded-2xl border border-border bg-slate-50 p-2 sm:p-3">
        <ol className="m-0 grid list-none grid-cols-4 gap-1 p-0 sm:gap-3">
          {STEPS.map((label, index) => <li key={label} className="min-w-0"><button type="button" disabled={saving || uncertainSubmission || index > step} onClick={() => goToStep(index)} aria-current={index === step ? "step" : undefined} className={`flex min-h-20 w-full min-w-0 flex-col items-center gap-2 rounded-xl px-1 py-3 text-center text-[0.65rem] leading-4 font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/40 disabled:cursor-default sm:min-h-16 sm:flex-row sm:justify-center sm:gap-3 sm:px-3 sm:text-sm ${index === step ? "bg-white text-primary shadow-sm" : index < step ? "text-foreground hover:bg-white" : "text-muted-foreground"}`}><span className={`flex size-7 shrink-0 items-center justify-center rounded-full text-xs sm:size-8 sm:text-sm ${index <= step ? "bg-primary text-white" : "bg-slate-200 text-muted-foreground"}`}>{index < step ? <CheckIcon aria-hidden="true" className="size-4" /> : index + 1}</span><span className="min-w-0 break-words">{label}</span></button></li>)}
        </ol>
      </nav>

      <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_21rem] lg:gap-8">
        <Card className="min-w-0 overflow-visible rounded-2xl shadow-sm ring-border [--card-spacing:--spacing(5)] sm:[--card-spacing:--spacing(7)]">
          <CardHeader className="gap-2"><p className="m-0 text-xs font-semibold text-primary">Bước {step + 1} / 4</p><h2 ref={headingRef} tabIndex={-1} className="m-0 scroll-mt-28 text-xl leading-7 font-semibold outline-none sm:text-2xl">{STEPS[step]}</h2></CardHeader>
          <CardContent>
            <form ref={formRef} noValidate onSubmit={submit} className="space-y-6" aria-busy={saving}>
              <fieldset className="m-0 min-w-0 space-y-6 border-0 p-0" disabled={saving || uncertainSubmission}>
                <legend className="sr-only">{STEPS[step]}</legend>
                {step === 0 && <>
                  {unavailableSelection && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900" role="status">Dịch vụ trong đường dẫn này không còn khả dụng. Vui lòng chọn một dịch vụ khác bên dưới.</div>}
                  {service && !currentService && <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm leading-6 text-amber-900">Dịch vụ đã tạm ngừng cung cấp. Vui lòng chọn dịch vụ khác.</p>}
                  <Field label="Dịch vụ" error={errors.serviceId} hint="Xem lại phạm vi công việc trước khi chọn số lượng."><select id={fieldId("serviceId")} className={controlClass} required value={values.serviceId} onChange={(event) => { const next = active.find((item) => item.id === event.target.value); change("serviceId", event.target.value); change("quantity", String(next?.defaultQuantity ?? "")) }}><option value="" disabled>Chọn dịch vụ</option>{active.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
                  {currentService && <>
                    <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-4"><h3 className="m-0 text-base leading-6 font-semibold">{currentService.name}</h3><p className="m-0 mt-2 text-sm leading-6 text-muted-foreground">{currentService.shortDesc}</p><Link href={`/dich-vu/${currentService.slug}`} className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-md text-sm font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">Xem chi tiết dịch vụ<ArrowRightIcon aria-hidden="true" className="size-4" /></Link></div>
                    <Field label={`${currentService.quantityLabel} (${currentService.unit})`} error={errors.quantity} hint={`Tối thiểu ${currentService.minimumQuantityKnown === false ? "1" : currentService.minQuantity} ${currentService.unit}${currentService.minimumQuantityKnown === false ? " (mức kỹ thuật; danh mục chưa cung cấp số tối thiểu)" : ""}. ${currentService.pricingModeKnown === false ? "Giá cơ sở tham khảo" : currentService.pricingMode === "fixed" ? "Đơn giá cố định" : "Đơn giá tham khảo"} ${formatCurrency(currentService.price)} / ${currentService.unit}.`}><Input id={fieldId("quantity")} className="min-h-12 rounded-xl" type="number" inputMode="decimal" step="0.01" max={100000} min={currentService.minQuantity} required value={values.quantity} onChange={(event) => change("quantity", event.target.value)} /></Field>
                  </>}
                </>}

                {step === 1 && <>
                  <p className="m-0 text-sm leading-6 text-muted-foreground">{currentService && cleaningTypeOf(currentService) ? CLEANING_TYPE_LABEL[cleaningTypeOf(currentService)!] + ": " : ""}{requireHouseDetails ? "Cho biết diện tích, số phòng và số tầng để chuẩn bị công việc phù hợp." : "Số lượng dịch vụ đã chọn ở bước trước. Diện tích, số phòng và số tầng là thông tin bổ sung không bắt buộc."}</p>
                  <div className="grid min-w-0 gap-5 sm:grid-cols-2">
                    <Field label="Họ tên liên hệ" error={errors.name}><Input id={fieldId("name")} className="min-h-12 rounded-xl" required autoComplete="name" maxLength={100} value={values.name} onChange={(event) => change("name", event.target.value)} /></Field>
                    <Field label="Số điện thoại" error={errors.phone}><Input id={fieldId("phone")} className="min-h-12 rounded-xl" type="tel" inputMode="tel" autoComplete="tel" maxLength={20} required value={values.phone} onChange={(event) => change("phone", event.target.value)} /></Field>
                  </div>
                  <Field label="Địa chỉ thực hiện" error={errors.address} hint="Ghi số nhà, đường, phường/xã và quận/huyện; thêm tên tòa nhà hoặc căn hộ nếu có."><Textarea id={fieldId("address")} className="min-h-24 rounded-xl" required autoComplete="street-address" maxLength={300} value={values.address} onChange={(event) => change("address", event.target.value)} /></Field>
                  <Field label="Loại nhà" error={errors.houseType}><select id={fieldId("houseType")} className={controlClass} required value={values.houseType} onChange={(event) => change("houseType", event.target.value as HouseType)}>{Object.entries(HOUSE_TYPE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
                  <div className="grid min-w-0 gap-5 sm:grid-cols-3">{([["area", "Diện tích (m²)"], ["rooms", "Số phòng"], ["floors", "Số tầng"]] as const).map(([key, label]) => <Field key={key} label={label + (requireHouseDetails ? "" : " (không bắt buộc)")} error={errors[key]}><Input id={fieldId(key)} className="min-h-12 rounded-xl" type="number" inputMode={key === "area" ? "decimal" : "numeric"} min={key === "area" ? 0.01 : 1} step={key === "area" ? "any" : 1} required={requireHouseDetails} value={values[key]} onChange={(event) => change(key, event.target.value)} /></Field>)}</div>
                  <label htmlFor={fieldId("hasPets")} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-border px-4 py-3 text-sm"><input id={fieldId("hasPets")} className="size-5 shrink-0 accent-blue-600 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring" type="checkbox" checked={values.hasPets} onChange={(event) => change("hasPets", event.target.checked)} /><span>Nhà có thú cưng</span></label>
                </>}

                {step === 2 && <>
                  <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm leading-6 text-muted-foreground"><CalendarDaysIcon aria-hidden="true" className="mb-2 size-5 text-primary" />Chọn ngày giờ bạn mong muốn. Đây là thời gian đề xuất, lịch hẹn cần được xác nhận.</div>
                  <div className="grid min-w-0 gap-5 sm:grid-cols-2">
                    <Field label="Ngày mong muốn" error={errors.date}><Input id={fieldId("date")} className="min-h-12 max-w-full rounded-xl" type="date" min={localDateValue()} required value={values.date} onChange={(event) => { change("date", event.target.value); setErrors((old) => ({ ...old, time: undefined })) }} /></Field>
                    <Field label="Giờ mong muốn" error={errors.time}><select id={fieldId("time")} className={controlClass} required value={values.time} onChange={(event) => change("time", event.target.value)}><option value="" disabled>Chọn giờ</option>{TIME_SLOTS.map((time) => { const date = bookingDateTime(values.date, time); return <option key={time} value={time} disabled={Boolean(date && date.getTime() <= Date.now())}>{time}</option> })}</select></Field>
                  </div>
                  <Field label="Ghi chú thêm" error={errors.specialRequest} hint={`${values.specialRequest.length} / 1.000 ký tự. Không bắt buộc.`}><Textarea id={fieldId("specialRequest")} className="min-h-28 rounded-xl" placeholder="Ví dụ: vui lòng gọi trước khi đến, lưu ý khu vực cần làm sạch..." maxLength={1000} value={values.specialRequest} onChange={(event) => change("specialRequest", event.target.value)} /></Field>
                  <div className="rounded-xl bg-slate-50 p-4 text-sm leading-6 text-muted-foreground"><h3 className="m-0 mb-2 text-sm font-semibold text-foreground">Trước khi thực hiện</h3><p className="m-0">Đảm bảo số điện thoại liên hệ và địa chỉ chính xác. Ghi rõ những khu vực cần ưu tiên hoặc lưu ý về việc ra vào tòa nhà.</p></div>
                </>}

                {step === 3 && <>
                  <div className="space-y-5">
                    <ReviewBlock title="Dịch vụ và số lượng" onEdit={() => goToStep(0)}><p className="m-0 font-medium text-foreground">{currentService?.name}</p><p className="m-0 mt-2 text-sm text-muted-foreground">{values.quantity} {currentService?.unit} × {formatCurrency(currentService?.price || 0)} / {currentService?.unit}</p></ReviewBlock>
                    <ReviewBlock title="Thông tin thực hiện" onEdit={() => goToStep(1)}><p className="m-0 break-words font-medium text-foreground">{values.name} · {values.phone}</p><p className="m-0 mt-2 break-words text-sm leading-6 text-muted-foreground">{values.address}</p><p className="m-0 mt-2 text-sm leading-6 text-muted-foreground">{[HOUSE_TYPE_LABEL[values.houseType], values.area ? values.area + " m²" : "", values.rooms ? values.rooms + " phòng" : "", values.floors ? values.floors + " tầng" : "", values.hasPets ? "Có thú cưng" : ""].filter(Boolean).join(" · ")}</p></ReviewBlock>
                    <ReviewBlock title="Thời gian đề xuất và ghi chú" onEdit={() => goToStep(2)}><p className="m-0 font-medium text-foreground">{scheduled ? new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "full", timeStyle: "short" }).format(scheduled) : "Chưa chọn thời gian"}</p><p className="m-0 mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">{values.specialRequest || "Không có ghi chú thêm."}</p></ReviewBlock>
                  </div>
                  <CheckoutPayment value={paymentMethod} onChange={setPaymentMethod} disabled={saving || uncertainSubmission} />
                  <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-4 text-sm leading-6 text-foreground"><ClipboardListIcon aria-hidden="true" className="mb-2 size-5 text-primary" />Bấm lưu để gửi yêu cầu và ghi nhận phương thức thanh toán mô phỏng. Lịch hẹn cần được xác nhận; hệ thống chưa nhận tiền.</div>
                </>}
              </fieldset>
              {submitError && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-destructive">{submitError}</div>}
              <div className="flex flex-col gap-3 border-t border-border pt-6 sm:flex-row sm:justify-between">
                {step > 0 ? <Button type="button" variant="outline" size="lg" disabled={saving || uncertainSubmission} onClick={() => goToStep(step - 1)} className="w-full sm:w-auto"><ArrowLeftIcon aria-hidden="true" />Quay lại</Button> : <Button variant="outline" size="lg" disabled={saving || uncertainSubmission} className="w-full sm:w-auto" render={<Link href="/dich-vu" />} nativeButton={false}>Chọn từ danh sách</Button>}
                <Button type="submit" size="lg" className="w-full px-5 sm:w-auto" disabled={saving}>{saving ? <><LoaderCircleIcon aria-hidden="true" className="animate-spin motion-reduce:animate-none" />Đang lưu yêu cầu…</> : uncertainSubmission ? <>Gửi lại để xác nhận<RefreshCwIcon aria-hidden="true" /></> : step === 3 ? <>Lưu yêu cầu<CheckIcon aria-hidden="true" /></> : <>Tiếp theo<ArrowRightIcon aria-hidden="true" /></>}</Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <aside aria-label="Tóm tắt yêu cầu" className="min-w-0 lg:sticky lg:top-28">
          <Card className="min-w-0 overflow-visible rounded-2xl shadow-sm ring-border [--card-spacing:--spacing(5)] sm:[--card-spacing:--spacing(6)]">
            <CardHeader><h2 className="m-0 text-lg leading-6 font-semibold">Yêu cầu của bạn</h2></CardHeader>
            <CardContent className="space-y-5">
              {currentService ? <>
                <div className="relative aspect-[4/3] rounded-xl bg-muted"><Image src={failedImage === image ? "/placeholder.svg" : image} alt={currentService.name} fill sizes="(min-width: 1024px) 288px, (min-width: 640px) calc(100vw - 96px), calc(100vw - 72px)" className="rounded-xl object-cover" onError={() => setFailedImage(image)} /></div>
                <h3 className="m-0 text-base leading-6 font-semibold">{currentService.name}</h3>
                <dl className="m-0 space-y-3 text-sm"><SummaryRow title="Số lượng" value={validQuantity ? `${values.quantity} ${currentService.unit}` : "Chưa chọn hợp lệ"} /><SummaryRow title="Đơn giá" value={`${formatCurrency(currentService.price)} / ${currentService.unit}`} />{validQuantity && <SummaryRow title="Thời lượng dự kiến" value={`${estimateDuration(currentService, quantity)} phút`} />}{scheduled && <SummaryRow title="Thời gian đề xuất" value={new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "short", timeStyle: "short" }).format(scheduled)} />}</dl>
                <div className="rounded-xl bg-blue-50 p-4"><p className="m-0 text-sm text-muted-foreground">{currentService.pricingModeKnown === false ? "Tổng tham khảo (cách tính chưa cấu hình)" : currentService.pricingMode === "fixed" ? "Tổng giá cố định" : "Tổng giá tham khảo"}</p><p className="m-0 mt-2 break-words text-2xl leading-8 font-bold text-primary tabular-nums">{validQuantity ? formatCurrency(estimatePrice(currentService, quantity)) : "—"}</p><p className="m-0 mt-2 text-xs leading-5 text-muted-foreground">{currentService.pricingModeKnown === false ? "Giá cơ sở và cách tính chưa được cung cấp đầy đủ; CleanHome cần xác nhận giá cuối cùng." : currentService.pricingMode === "fixed" ? "Tính theo số lượng × đơn giá cố định." : currentService.pricingMode === "survey" ? "Giá cuối cùng cần khảo sát và được xác nhận trước khi thực hiện." : "Tính theo số lượng × đơn giá tham khảo; giá cuối cùng cần được xác nhận."}</p></div>
              </> : <div className="rounded-xl bg-slate-50 p-5 text-sm leading-6 text-muted-foreground"><HouseIcon aria-hidden="true" className="mb-3 size-6 text-primary" />Chọn một dịch vụ đang cung cấp để xem số lượng và giá dự kiến.</div>}
              <p className="m-0 flex items-start gap-2 text-xs leading-5 text-muted-foreground"><Clock3Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" /><span>Ngày giờ là đề xuất của bạn, chưa phải lịch hẹn đã xác nhận.</span></p>
            </CardContent>
          </Card>
        </aside>
      </div>
    </section>
  )
}

function SummaryRow({ title, value }: { title: string; value: string }) {
  return <div className="flex min-w-0 items-start justify-between gap-4"><dt className="shrink-0 text-muted-foreground">{title}</dt><dd className="m-0 min-w-0 break-words text-right font-medium">{value}</dd></div>
}

function ReviewBlock({ title, children, onEdit }: { title: string; children: React.ReactNode; onEdit: () => void }) {
  return <section className="min-w-0 rounded-xl border border-border p-4 sm:p-5"><div className="mb-3 flex min-w-0 flex-wrap items-center justify-between gap-2"><h3 className="m-0 text-sm leading-6 font-semibold">{title}</h3><Button type="button" variant="ghost" onClick={onEdit} aria-label={`Sửa ${title.toLowerCase()}`} className="text-primary"><PencilIcon aria-hidden="true" className="size-4" />Sửa</Button></div>{children}</section>
}
