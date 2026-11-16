"use client"

import { useId, useLayoutEffect, useRef, useState, type FormEvent } from "react"
import Image from "next/image"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeftIcon, ArrowRightIcon, CalendarDaysIcon, ClipboardListIcon, InfoIcon, LoaderCircleIcon, SparklesIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Logo } from "@/components/shared/logo"
import { PasswordField } from "@/components/shared/password-field"
import { Field } from "../../common"
import { loginCustomer, registerCustomer } from "./account-service"
import { validateLogin, validateRegistration, type AccountErrors, type RegistrationValues } from "./account-validation"
import { IS_UNIFIED_APP } from "@/lib/env"
import { safeReturnTo } from "@/components/shared/route-policy"

export function CustomerAuth({ register, returnTo, switchHref }: { register: boolean; returnTo: string; switchHref: string }) {
  const router = useRouter()
  const generatedId = useId()
  const [values, setValues] = useState<RegistrationValues>({ name: "", email: "", phone: "", password: "", confirm: "" })
  const [errors, setErrors] = useState<AccountErrors<RegistrationValues>>({})
  const [submitError, setSubmitError] = useState("")
  const [busy, setBusy] = useState(false)
  const [failedImage, setFailedImage] = useState(false)
  const submitting = useRef(false)
  const formRef = useRef<HTMLFormElement>(null)
  const errorRef = useRef<HTMLDivElement>(null)
  const focusIntent = useRef<"invalid" | "error" | null>(null)
  const fieldId = (name: keyof RegistrationValues) => `${generatedId}-${name}`
  const returningToBooking = returnTo.startsWith("/dat-dich-vu/")

  useLayoutEffect(() => {
    const target = focusIntent.current
    if (!target) return
    // Wait until the committed form and the native button activation finish.
    const frame = requestAnimationFrame(() => {
      const element = target === "error" ? errorRef.current : formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')
      if (element?.isConnected) {
        focusIntent.current = null
        element.focus()
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [errors, submitError, busy])

  const change = (name: keyof RegistrationValues, value: string) => {
    setValues((current) => ({ ...current, [name]: value }))
    setErrors((current) => ({ ...current, [name]: undefined, ...(name === "password" ? { confirm: undefined } : {}) }))
    setSubmitError("")
  }
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submitting.current) return
    const found = register ? validateRegistration(values) : validateLogin(values)
    focusIntent.current = Object.keys(found).length ? "invalid" : null
    setErrors(found)
    setSubmitError("")
    if (Object.keys(found).length) return
    submitting.current = true
    setBusy(true)
    let completed = false
    try {
      const result = register
        ? await registerCustomer({ name: values.name, email: values.email, phone: values.phone, password: values.password })
        : await loginCustomer(values.email, values.password)
      if (!result.ok) {
        focusIntent.current = "error"
        setSubmitError(result.error)
        return
      }
      completed = true
      if (result.persistence === "session") toast.warning(register ? "Tài khoản chỉ được giữ trong phiên hiện tại" : "Đã đăng nhập trong phiên hiện tại")
      else toast.success(register ? "Đã tạo tài khoản trên trình duyệt này" : "Đã đăng nhập trên trình duyệt này")
      router.replace(IS_UNIFIED_APP ? safeReturnTo(result.user.role, returnTo) : returnTo)
    } catch {
      focusIntent.current = "error"
      setSubmitError(register ? "Chưa thể tạo tài khoản. Thông tin bạn nhập vẫn được giữ lại để thử lại." : "Chưa thể đăng nhập. Vui lòng thử lại.")
    } finally {
      if (!completed) { submitting.current = false; setBusy(false) }
    }
  }

  return (
    <section className="mx-auto w-full max-w-6xl px-4 pt-6 pb-12 sm:px-6 md:pt-8 md:pb-16" aria-labelledby="customer-auth-heading">
      <Link href="/" className="mb-5 inline-flex min-h-11 items-center gap-2 rounded-md text-sm text-muted-foreground hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"><ArrowLeftIcon aria-hidden="true" className="size-4" />Về trang chủ</Link>
      <Card className="mx-auto grid min-w-0 max-w-2xl gap-0 overflow-visible rounded-3xl py-0 shadow-lg shadow-slate-900/5 ring-border lg:max-w-none lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <aside aria-label="Không gian sống cùng CleanHome" className="relative hidden min-w-0 self-stretch rounded-l-3xl bg-blue-50 lg:flex lg:min-h-[38rem]">
          <Image src={failedImage ? "/placeholder.svg" : "/images/hero.png"} alt="Nhân viên đang lau sàn trong phòng khách sáng sủa" fill sizes="(min-width: 1152px) 500px, (min-width: 1024px) 42vw, 1px" className="rounded-l-3xl object-cover object-[60%_center]" onError={() => setFailedImage(true)} />
          <div aria-hidden="true" className="absolute inset-0 rounded-l-3xl bg-gradient-to-t from-slate-950/85 via-slate-950/20 to-transparent" />
          <div className="relative flex w-full min-w-0 flex-col justify-between gap-10 p-8 xl:p-10">
            <div className="self-start rounded-xl border border-white/40 bg-white/95 px-4 py-2"><Logo /></div>
            <div className="min-w-0 text-white">
              <p className="m-0 mb-4 inline-flex items-center gap-2 text-xs font-medium tracking-wide text-blue-100"><SparklesIcon aria-hidden="true" className="size-4" />Chăm sóc không gian sống</p>
              <p className="m-0 text-3xl leading-tight font-semibold tracking-tight xl:text-4xl">Nhẹ việc nhà,<br />thêm thời gian cho bạn.</p>
              <p className="m-0 mt-5 max-w-sm text-sm leading-7 text-white/85">Khám phá dịch vụ phù hợp, chọn thời gian mong muốn và xem lại những yêu cầu của bạn ở một nơi.</p>
              <ul className="m-0 mt-6 grid list-none gap-3 p-0 text-sm text-white/90"><li className="flex items-center gap-2.5"><CalendarDaysIcon aria-hidden="true" className="size-4 shrink-0" />Chọn lịch theo nhu cầu</li><li className="flex items-center gap-2.5"><ClipboardListIcon aria-hidden="true" className="size-4 shrink-0" />Xem lại đơn và lịch sử dịch vụ</li></ul>
            </div>
          </div>
        </aside>

        <CardContent className="min-w-0 p-5 sm:p-8 lg:p-9 xl:p-10">
          <header className="mb-7">
            <p className="m-0 mb-3 text-xs font-semibold tracking-[0.12em] text-primary uppercase">{IS_UNIFIED_APP && !register ? "Tài khoản CleanHome" : "Tài khoản khách hàng"}</p>
            <h1 id="customer-auth-heading" className="m-0 text-3xl leading-tight font-bold tracking-tight text-balance sm:text-4xl">{register ? "Tạo tài khoản CleanHome" : "Chào mừng bạn trở lại"}</h1>
            <p className="m-0 mt-4 text-sm leading-7 text-muted-foreground">{returningToBooking ? register ? "Tạo tài khoản để tiếp tục với dịch vụ bạn đã chọn." : "Đăng nhập để tiếp tục với dịch vụ bạn đã chọn." : register ? "Lưu thông tin liên hệ để đặt dịch vụ và xem lại yêu cầu thuận tiện hơn." : IS_UNIFIED_APP ? "Đăng nhập để mở khu vực phù hợp với tài khoản của bạn." : "Đăng nhập để xem đơn dịch vụ, lịch sử và thông tin của bạn."}</p>
          </header>

          <form ref={formRef} noValidate onSubmit={submit} aria-busy={busy} className="flex flex-col gap-5">
            <fieldset disabled={busy} className="m-0 min-w-0 space-y-5 border-0 p-0">
              <legend className="sr-only">{register ? "Thông tin tạo tài khoản" : "Thông tin đăng nhập"}</legend>
              {register && <div className="grid min-w-0 gap-5 sm:grid-cols-2">
                <Field label="Họ và tên" error={errors.name}><Input id={fieldId("name")} name="name" autoComplete="name" required maxLength={120} className="min-h-12 rounded-xl" value={values.name} onChange={(event) => change("name", event.target.value)} /></Field>
                <Field label="Số điện thoại" error={errors.phone}><Input id={fieldId("phone")} name="phone" type="tel" inputMode="tel" autoComplete="tel" required maxLength={20} className="min-h-12 rounded-xl" value={values.phone} onChange={(event) => change("phone", event.target.value)} /></Field>
              </div>}
              <Field label="Email" error={errors.email}><Input id={fieldId("email")} name="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} required maxLength={254} className="min-h-12 rounded-xl" placeholder="Email của bạn" value={values.email} onChange={(event) => change("email", event.target.value)} /></Field>
              <Field label="Mật khẩu" error={errors.password} hint={register ? "Ít nhất 8 ký tự." : undefined}><PasswordField id={fieldId("password")} name="password" autoComplete={register ? "new-password" : "current-password"} required minLength={register ? 8 : undefined} disabled={busy} value={values.password} onChange={(event) => change("password", event.target.value)} /></Field>
              {register && <Field label="Nhập lại mật khẩu" error={errors.confirm}><PasswordField id={fieldId("confirm")} name="confirm" autoComplete="new-password" toggleLabel="mật khẩu xác nhận" required disabled={busy} value={values.confirm} onChange={(event) => change("confirm", event.target.value)} /></Field>}
            </fieldset>
            {submitError && <div ref={errorRef} tabIndex={-1} role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-destructive outline-none">{submitError}</div>}
            <Button type="submit" size="lg" disabled={busy} className="w-full px-5">{busy ? <><LoaderCircleIcon aria-hidden="true" className="animate-spin motion-reduce:animate-none" />{register ? "Đang tạo tài khoản…" : "Đang đăng nhập…"}</> : <>{register ? "Tạo tài khoản" : "Đăng nhập"}<ArrowRightIcon aria-hidden="true" /></>}</Button>
            <p className="sr-only" role="status" aria-live="polite">{busy ? register ? "Đang tạo tài khoản" : "Đang đăng nhập" : ""}</p>
          </form>

          <p className="m-0 mt-6 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-sm text-muted-foreground"><span>{register ? "Đã có tài khoản?" : "Chưa có tài khoản?"}</span><Link href={switchHref} aria-disabled={busy || undefined} tabIndex={busy ? -1 : undefined} onClick={(event) => { if (busy) event.preventDefault() }} className={`inline-flex min-h-11 items-center rounded-md font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring ${busy ? "pointer-events-none opacity-60" : ""}`}>{register ? "Đăng nhập" : "Đăng ký"}</Link></p>
          <div className="mt-5 flex min-w-0 items-start gap-2.5 rounded-xl bg-slate-50 px-4 py-3"><InfoIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" /><p className="m-0 min-w-0 text-xs leading-6 text-muted-foreground">Thông tin tài khoản hiện được lưu trên trình duyệt này. Dùng cùng trình duyệt để tiếp tục xem những yêu cầu đã lưu.</p></div>
        </CardContent>
      </Card>
    </section>
  )
}
