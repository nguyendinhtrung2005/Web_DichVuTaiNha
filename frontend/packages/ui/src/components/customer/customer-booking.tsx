"use client"

import { useEffect, useId, useRef, useState, type FormEvent } from "react"
import Image from "next/image"
import Link from "next/link"
import { useRouter } from "next/navigation"
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
import type { HouseType, Order, Service, User } from "@/lib/types"
import { saveBookingRequest } from "./booking-service"
import { bookingDateTime, firstInvalidBookingStep, localDateValue, validateBookingStep, type BookingErrors, type BookingValues } from "./booking-validation"

const STEPS = ["Dịch vụ", "Thông tin nhà ở", "Ngày giờ", "Kiểm tra yêu cầu"]
const controlClass = "min-h-12 w-full min-w-0 rounded-xl border border-input bg-white px-3 py-2 text-base outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60 aria-invalid:border-destructive aria-invalid:ring-destructive/20 md:text-sm"

function BookingMessage({ title, description, error = false, href = "/dich-vu", action = "Xem danh sách dịch vụ" }: { title: string; description: string; error?: boolean; href?: string; action?: string }) {
  return <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6"><div className="rounded-2xl border border-dashed border-border bg-slate-50 px-5 py-12 text-center" role={error ? "alert" : undefined}><h1 className="m-0 text-2xl leading-tight font-bold">{title}</h1><p className="mx-auto mt-4 max-w-lg text-sm leading-7 text-muted-foreground">{description}</p><div className="mt-6 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">{error && <Button variant="outline" onClick={() => window.location.reload()}><RefreshCwIcon aria-hidden="true" />Tải lại trang</Button>}<Button render={<Link href={href} />} nativeButton={false}>{action}<ArrowRightIcon aria-hidden="true" /></Button></div></div></section>
}

export function CustomerBooking({ id }: { id?: string }) {
  const { s, user } = useData()
  if (!s) return <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6" role="status" aria-label="Đang tải đặt dịch vụ"><PageSkeleton /></div>
  if (!Array.isArray(s.services)) return <BookingMessage title="Chưa thể tải dịch vụ" description="Vui lòng tải lại trang để thử lại." error />
  if (!user) return <BookingMessage title="Đăng nhập để tiếp tục" description="Đăng nhập tài khoản khách hàng để lưu yêu cầu của bạn." href={`/dang-nhap${id ? `?next=${encodeURIComponent(`/dat-dich-vu/${id}`)}` : ""}`} action="Đăng nhập" />
  if (!s.services.some((service) => service.status === "active")) return <BookingMessage title="Hiện chưa có dịch vụ để đặt" description="Vui lòng quay lại sau để xem các dịch vụ đang cung cấp của CleanHome." />
  return <BookingForm id={id} services={s.services} orders={Array.isArray(s.orders) ? s.orders : []} user={user} />
}

function BookingForm({ id, services, orders, user }: { id?: string; services: Service[]; orders: Order[]; user: User }) {
  const router = useRouter()
  const generatedId = useId()
  const active = services.filter((item) => item.status === "active")
  const previous = id ? orders.find((order) => order.id === id && order.customerId === user.id) : undefined
  const requestedId = previous?.serviceId || id
  const initialService = requestedId ? services.find((item) => item.id === requestedId && item.status === "active") : active[0]
  const [values, setValues] = useState<BookingValues>(() => ({
    serviceId: initialService?.id || "",
    quantity: String(previous?.quantity ?? initialService?.defaultQuantity ?? ""),
    name: previous?.contact.name || user.name || "",
    phone: previous?.contact.phone || user.phone || "",
    address: previous?.contact.address || user.address || "",
    houseType: previous?.contact.houseType || "can-ho",
    area: String(previous?.contact.area ?? 60),
    rooms: String(previous?.contact.rooms ?? 2),
    floors: String(previous?.contact.floors ?? 1),
    hasPets: previous?.contact.hasPets || false,
    date: "", time: "", specialRequest: previous?.specialRequest || "",
  }))
  const [step, setStep] = useState(0)
  const [errors, setErrors] = useState<BookingErrors>({})
  const [submitError, setSubmitError] = useState("")
  const [saving, setSaving] = useState(false)
  const [failedImage, setFailedImage] = useState<string | null>(null)
  const submitLock = useRef(false)
  const interacted = useRef(false)
  const formRef = useRef<HTMLFormElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const service = services.find((item) => item.id === values.serviceId)
  const currentService = service?.status === "active" ? service : undefined
  const quantity = Number(values.quantity)
  const validQuantity = Boolean(currentService && values.quantity.trim() && Number.isFinite(quantity) && quantity >= currentService.minQuantity && quantity > 0 && Number.isFinite(estimatePrice(currentService, quantity)) && Number.isFinite(estimateDuration(currentService, quantity)))
  const scheduled = bookingDateTime(values.date, values.time)
  const image = currentService?.image || "/placeholder.svg"
  const unavailableSelection = requestedId && !initialService && !values.serviceId
  const fieldId = (name: keyof BookingValues) => `${generatedId}-${name}`

  useEffect(() => { if (interacted.current) headingRef.current?.focus() }, [step])

  const change = <K extends keyof BookingValues>(key: K, value: BookingValues[K]) => {
    setValues((old) => ({ ...old, [key]: value }))
    setErrors((old) => ({ ...old, [key]: undefined }))
    setSubmitError("")
  }
  const goToStep = (next: number) => { interacted.current = true; setStep(next); setSubmitError("") }
  const focusError = () => requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (submitLock.current) return
    const found = validateBookingStep(step, values, currentService)
    if (Object.keys(found).length) {
      setErrors(found)
      if (step === 3) goToStep(firstInvalidBookingStep(found))
      focusError()
      return
    }
    if (step < 3) { setErrors({}); goToStep(step + 1); return }
    const time = bookingDateTime(values.date, values.time)
    if (!currentService || !time) return
    submitLock.current = true
    setSaving(true)
    setSubmitError("")
    let saved = false
    try {
      const result = await saveBookingRequest({
        serviceId: currentService.id,
        quantity: Number(values.quantity),
        contact: { name: values.name.trim(), phone: values.phone.trim(), address: values.address.trim(), houseType: values.houseType, area: Number(values.area), rooms: Number(values.rooms), floors: Number(values.floors), hasPets: values.hasPets },
        scheduledAt: time.toISOString(),
        specialRequest: values.specialRequest.trim(),
      })
      if (!result.ok) { setSubmitError(result.error); return }
      saved = true
      toast.success(result.persistence === "session" ? "Đã giữ yêu cầu trong phiên hiện tại" : "Đã lưu yêu cầu trên thiết bị này")
      router.push(`/don/${result.order.id}`)
    } catch {
      setSubmitError("Chưa thể lưu yêu cầu. Vui lòng thử lại.")
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

      <nav aria-label="Các bước đặt dịch vụ" className="mb-8 rounded-2xl border border-border bg-slate-50 p-2 sm:p-3">
        <ol className="m-0 grid list-none grid-cols-4 gap-1 p-0 sm:gap-3">
          {STEPS.map((label, index) => <li key={label} className="min-w-0"><button type="button" disabled={saving || index > step} onClick={() => goToStep(index)} aria-current={index === step ? "step" : undefined} className={`flex min-h-20 w-full min-w-0 flex-col items-center gap-2 rounded-xl px-1 py-3 text-center text-[0.65rem] leading-4 font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/40 disabled:cursor-default sm:min-h-16 sm:flex-row sm:justify-center sm:gap-3 sm:px-3 sm:text-sm ${index === step ? "bg-white text-primary shadow-sm" : index < step ? "text-foreground hover:bg-white" : "text-muted-foreground"}`}><span className={`flex size-7 shrink-0 items-center justify-center rounded-full text-xs sm:size-8 sm:text-sm ${index <= step ? "bg-primary text-white" : "bg-slate-200 text-muted-foreground"}`}>{index < step ? <CheckIcon aria-hidden="true" className="size-4" /> : index + 1}</span><span className="min-w-0 break-words">{label}</span></button></li>)}
        </ol>
      </nav>

      <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_21rem] lg:gap-8">
        <Card className="min-w-0 overflow-visible rounded-2xl shadow-sm ring-border [--card-spacing:--spacing(5)] sm:[--card-spacing:--spacing(7)]">
          <CardHeader className="gap-2"><p className="m-0 text-xs font-semibold text-primary">Bước {step + 1} / 4</p><h2 ref={headingRef} tabIndex={-1} className="m-0 scroll-mt-28 text-xl leading-7 font-semibold outline-none sm:text-2xl">{STEPS[step]}</h2></CardHeader>
          <CardContent>
            <form ref={formRef} noValidate onSubmit={submit} className="space-y-6" aria-busy={saving}>
              <fieldset className="m-0 min-w-0 space-y-6 border-0 p-0" disabled={saving}>
                <legend className="sr-only">{STEPS[step]}</legend>
                {step === 0 && <>
                  {unavailableSelection && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900" role="status">Dịch vụ trong đường dẫn này không còn khả dụng. Vui lòng chọn một dịch vụ khác bên dưới.</div>}
                  {service && !currentService && <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm leading-6 text-amber-900">Dịch vụ đã tạm ngừng cung cấp. Vui lòng chọn dịch vụ khác.</p>}
                  <Field label="Dịch vụ" error={errors.serviceId} hint="Xem lại phạm vi công việc trước khi chọn số lượng."><select id={fieldId("serviceId")} className={controlClass} required value={values.serviceId} onChange={(event) => { const next = active.find((item) => item.id === event.target.value); change("serviceId", event.target.value); change("quantity", String(next?.defaultQuantity ?? "")) }}><option value="" disabled>Chọn dịch vụ</option>{active.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
                  {currentService && <>
                    <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-4"><h3 className="m-0 text-base leading-6 font-semibold">{currentService.name}</h3><p className="m-0 mt-2 text-sm leading-6 text-muted-foreground">{currentService.shortDesc}</p><Link href={`/dich-vu/${currentService.slug}`} className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-md text-sm font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">Xem chi tiết dịch vụ<ArrowRightIcon aria-hidden="true" className="size-4" /></Link></div>
                    <Field label={`${currentService.quantityLabel} (${currentService.unit})`} error={errors.quantity} hint={`Tối thiểu ${currentService.minQuantity} ${currentService.unit}. Đơn giá tham khảo ${formatCurrency(currentService.price)} / ${currentService.unit}.`}><Input id={fieldId("quantity")} className="min-h-12 rounded-xl" type="number" inputMode="decimal" step="any" min={currentService.minQuantity} required value={values.quantity} onChange={(event) => change("quantity", event.target.value)} /></Field>
                  </>}
                </>}

                {step === 1 && <>
                  <div className="grid min-w-0 gap-5 sm:grid-cols-2">
                    <Field label="Họ tên liên hệ" error={errors.name}><Input id={fieldId("name")} className="min-h-12 rounded-xl" required autoComplete="name" maxLength={120} value={values.name} onChange={(event) => change("name", event.target.value)} /></Field>
                    <Field label="Số điện thoại" error={errors.phone}><Input id={fieldId("phone")} className="min-h-12 rounded-xl" type="tel" inputMode="tel" autoComplete="tel" maxLength={20} required value={values.phone} onChange={(event) => change("phone", event.target.value)} /></Field>
                  </div>
                  <Field label="Địa chỉ thực hiện" error={errors.address} hint="Ghi số nhà, đường, phường/xã và quận/huyện; thêm tên tòa nhà hoặc căn hộ nếu có."><Textarea id={fieldId("address")} className="min-h-24 rounded-xl" required autoComplete="street-address" maxLength={300} value={values.address} onChange={(event) => change("address", event.target.value)} /></Field>
                  <Field label="Loại nhà" error={errors.houseType}><select id={fieldId("houseType")} className={controlClass} required value={values.houseType} onChange={(event) => change("houseType", event.target.value as HouseType)}>{Object.entries(HOUSE_TYPE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
                  <div className="grid min-w-0 gap-5 sm:grid-cols-3">{([["area", "Diện tích (m²)"], ["rooms", "Số phòng"], ["floors", "Số tầng"]] as const).map(([key, label]) => <Field key={key} label={label} error={errors[key]}><Input id={fieldId(key)} className="min-h-12 rounded-xl" type="number" inputMode={key === "area" ? "decimal" : "numeric"} min={key === "area" ? 0.01 : 1} step={key === "area" ? "any" : 1} required value={values[key]} onChange={(event) => change(key, event.target.value)} /></Field>)}</div>
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
                    <ReviewBlock title="Thông tin thực hiện" onEdit={() => goToStep(1)}><p className="m-0 break-words font-medium text-foreground">{values.name} · {values.phone}</p><p className="m-0 mt-2 break-words text-sm leading-6 text-muted-foreground">{values.address}</p><p className="m-0 mt-2 text-sm leading-6 text-muted-foreground">{HOUSE_TYPE_LABEL[values.houseType]} · {values.area} m² · {values.rooms} phòng · {values.floors} tầng{values.hasPets ? " · Có thú cưng" : ""}</p></ReviewBlock>
                    <ReviewBlock title="Thời gian đề xuất và ghi chú" onEdit={() => goToStep(2)}><p className="m-0 font-medium text-foreground">{scheduled ? new Intl.DateTimeFormat("vi-VN", { dateStyle: "full", timeStyle: "short" }).format(scheduled) : "Chưa chọn thời gian"}</p><p className="m-0 mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">{values.specialRequest || "Không có ghi chú thêm."}</p></ReviewBlock>
                  </div>
                  <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-4 text-sm leading-6 text-foreground"><ClipboardListIcon aria-hidden="true" className="mb-2 size-5 text-primary" />Yêu cầu được lưu trên trình duyệt này. Lịch hẹn chưa được xác nhận.</div>
                </>}
              </fieldset>
              {submitError && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-destructive">{submitError}</div>}
              <div className="flex flex-col gap-3 border-t border-border pt-6 sm:flex-row sm:justify-between">
                {step > 0 ? <Button type="button" variant="outline" size="lg" disabled={saving} onClick={() => goToStep(step - 1)} className="w-full sm:w-auto"><ArrowLeftIcon aria-hidden="true" />Quay lại</Button> : <Button variant="outline" size="lg" disabled={saving} className="w-full sm:w-auto" render={<Link href="/dich-vu" />} nativeButton={false}>Chọn từ danh sách</Button>}
                <Button type="submit" size="lg" className="w-full px-5 sm:w-auto" disabled={saving}>{saving ? <><LoaderCircleIcon aria-hidden="true" className="animate-spin motion-reduce:animate-none" />Đang lưu yêu cầu…</> : step === 3 ? <>Lưu yêu cầu<CheckIcon aria-hidden="true" /></> : <>Tiếp theo<ArrowRightIcon aria-hidden="true" /></>}</Button>
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
                <dl className="m-0 space-y-3 text-sm"><SummaryRow title="Số lượng" value={validQuantity ? `${values.quantity} ${currentService.unit}` : "Chưa chọn hợp lệ"} /><SummaryRow title="Đơn giá" value={`${formatCurrency(currentService.price)} / ${currentService.unit}`} />{validQuantity && <SummaryRow title="Thời lượng dự kiến" value={`${estimateDuration(currentService, quantity)} phút`} />}{scheduled && <SummaryRow title="Thời gian đề xuất" value={new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(scheduled)} />}</dl>
                <div className="rounded-xl bg-blue-50 p-4"><p className="m-0 text-sm text-muted-foreground">Tổng giá dự kiến</p><p className="m-0 mt-2 break-words text-2xl leading-8 font-bold text-primary tabular-nums">{validQuantity ? formatCurrency(estimatePrice(currentService, quantity)) : "—"}</p><p className="m-0 mt-2 text-xs leading-5 text-muted-foreground">Tính theo số lượng × đơn giá tham khảo. Giá cuối cùng cần được xác nhận.</p></div>
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
