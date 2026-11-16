"use client"

import { useLayoutEffect, useRef, useState, type FormEvent } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { ArrowRightIcon, CalendarDaysIcon, ClipboardListIcon, LoaderCircleIcon, LockKeyholeIcon, ShieldCheckIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { PasswordField } from "@/components/shared/password-field"
import { Field } from "../../common"
import { staffLoginReturnTo } from "./staff-login-route"
import { useStaffAuth } from "./staff-auth-session"
import { validateStaffLogin, type StaffLoginErrors } from "./staff-login-validation"

export function StaffLogin() {
  const router = useRouter()
  const params = useSearchParams()
  const auth = useStaffAuth()
  const returnTo = staffLoginReturnTo(params.get("next") || "")
  const [errors, setErrors] = useState<StaffLoginErrors>({})
  const [submitError, setSubmitError] = useState("")
  const [busy, setBusy] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const locked = useRef(false)
  const form = useRef<HTMLFormElement>(null)
  const alert = useRef<HTMLDivElement>(null)
  const focusIntent = useRef<"invalid" | "error" | null>(null)

  useLayoutEffect(() => {
    const intent = focusIntent.current
    if (!intent) return
    const frame = requestAnimationFrame(() => {
      const target = intent === "error" ? alert.current : form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')
      if (target?.isConnected) { focusIntent.current = null; target.focus() }
    })
    return () => cancelAnimationFrame(frame)
  }, [errors, submitError, busy])

  function change(key: keyof StaffLoginErrors) {
    setErrors((current) => ({ ...current, [key]: undefined }))
    setSubmitError("")
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (locked.current) return
    // Let the native inputs retain the draft, including password-manager fills
    // that do not dispatch a React change event. Credentials only live in this request.
    const submittedForm = event.currentTarget
    const data = new FormData(submittedForm)
    const phone = data.get("phone"), password = data.get("password")
    const values = { phone: typeof phone === "string" ? phone : "", password: typeof password === "string" ? password : "" }
    const invalid = validateStaffLogin(values)
    focusIntent.current = Object.keys(invalid).length ? "invalid" : null
    setErrors(invalid)
    setSubmitError("")
    if (Object.keys(invalid).length) return
    locked.current = true
    setBusy(true)
    let completed = false
    try {
      if (!auth) { focusIntent.current = "error"; setSubmitError("Dịch vụ đăng nhập hiện chưa khả dụng. Vui lòng thử lại sau."); return }
      const result = await auth.login(values.phone.trim(), values.password)
      if (!result.ok) { focusIntent.current = "error"; setSubmitError(result.message); return }
      completed = true
      router.replace(returnTo)
    } catch { focusIntent.current = "error"; setSubmitError("Chưa thể đăng nhập. Vui lòng thử lại.") }
    finally {
      const passwordInput = submittedForm.elements.namedItem("password")
      if (passwordInput instanceof HTMLInputElement) passwordInput.value = ""
      // Recreate the password input after a failure so a browser password manager
      // that re-applies its saved value to the re-enabled field cannot restore it.
      if (!completed) { locked.current = false; setBusy(false); setAttempt((value) => value + 1) }
    }
  }

  return <Card className="staff-login-card mx-auto grid min-w-0 max-w-lg gap-0 overflow-visible rounded-3xl py-0 shadow-sm ring-border lg:max-w-none lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
    <aside className="staff-login-intro hidden min-w-0 flex-col justify-between lg:flex">
      <div><div className="staff-login-emblem"><ClipboardListIcon aria-hidden="true" className="size-7" /></div><p className="staff-eyebrow">Không gian làm việc</p><p className="staff-login-promise">Một ngày làm việc<br />thật ngăn nắp.</p><p className="staff-login-description">Lịch hẹn rõ ràng, công việc liền mạch. Cùng CleanHome chăm sóc từng ngôi nhà.</p></div>
      <ul className="staff-login-features"><li><CalendarDaysIcon aria-hidden="true" /><div><strong>Lịch trình trong tầm tay</strong><span>Theo dõi lịch và các công việc được phân công.</span></div></li><li><ClipboardListIcon aria-hidden="true" /><div><strong>Nắm rõ từng công việc</strong><span>Xem thông tin và cập nhật tiến trình thực hiện.</span></div></li></ul>
      <p className="staff-login-account-note"><ShieldCheckIcon aria-hidden="true" />Tài khoản được người quản lý cấp.</p>
    </aside>
    <CardContent className="staff-login-panel min-w-0 p-6 sm:p-8 lg:p-10"><div className="staff-login-lock"><LockKeyholeIcon aria-hidden="true" className="size-5" /></div><p className="m-0 mb-3 text-xs font-semibold tracking-wider text-primary uppercase">CleanHome / Nhân viên</p><h1 className="ch-auth-heading staff-login-title m-0 tracking-tight">Đăng nhập nhân viên</h1><p className="m-0 mt-4 mb-7 text-sm leading-7 text-muted-foreground">Chào mừng bạn trở lại. Đăng nhập để bắt đầu công việc hôm nay.</p>{auth?.error && !submitError && <p role="status" className="staff-notice m-0 mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-7 text-amber-950">{auth.error}</p>}<form ref={form} method="post" autoComplete="on" noValidate onSubmit={submit} aria-busy={busy} className="ch-login-form flex flex-col gap-5"><fieldset disabled={busy} className="m-0 min-w-0 space-y-5 border-0 p-0"><legend className="sr-only">Thông tin đăng nhập</legend><Field label="Số điện thoại" error={errors.phone}><Input id="staff-login-phone" name="phone" type="tel" autoComplete="username" autoCapitalize="none" spellCheck={false} required maxLength={20} defaultValue="" onChange={() => change("phone")} className="min-h-12 rounded-xl" /></Field><Field label="Mật khẩu" error={errors.password}><PasswordField key={"staff-login-password-" + attempt} id="staff-login-password" name="password" autoComplete="current-password" required disabled={busy} defaultValue="" onChange={() => change("password")} /></Field></fieldset>{submitError && <div ref={alert} tabIndex={-1} role="alert" className="staff-notice rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-7 text-destructive">{submitError}</div>}<Button type="submit" disabled={busy} className="ch-login-submit w-full">{busy ? <><LoaderCircleIcon aria-hidden="true" className="animate-spin motion-reduce:animate-none" />Đang đăng nhập...</> : <>Đăng nhập<ArrowRightIcon aria-hidden="true" /></>}</Button><p className="sr-only" role="status">{busy ? "Đang đăng nhập" : ""}</p></form><p className="staff-login-help m-0 mt-6 rounded-xl bg-slate-50 px-4 py-3 text-xs leading-6 text-muted-foreground">Nếu chưa có tài khoản hoặc không thể đăng nhập, vui lòng liên hệ người quản lý.</p></CardContent>
  </Card>
}
