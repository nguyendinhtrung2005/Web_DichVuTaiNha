"use client"

import { useLayoutEffect, useRef, useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { ArrowRightIcon, ClipboardListIcon, LoaderCircleIcon, ShieldCheckIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { PasswordField } from "@/components/shared/password-field"
import { Field } from "../../common"
import { validateLogin } from "../customer/account-validation"
import { actions } from "@/lib/store"
import { APP_ROLE } from "@/lib/env"
import { HOME_PATH } from "@/lib/auth"
import type { AppState } from "@/lib/types"
import { toast } from "sonner"

export function StaffLogin() {
  const router = useRouter()
  const [values, setValues] = useState({ email: "", password: "" })
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({})
  const [submitError, setSubmitError] = useState("")
  const [busy, setBusy] = useState(false)
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

  function change(key: keyof typeof values, value: string) {
    setValues((current) => ({ ...current, [key]: value }))
    setErrors((current) => ({ ...current, [key]: undefined }))
    setSubmitError("")
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (locked.current) return
    const invalid = validateLogin(values)
    focusIntent.current = Object.keys(invalid).length ? "invalid" : null
    setErrors(invalid)
    setSubmitError("")
    if (Object.keys(invalid).length) return
    locked.current = true
    setBusy(true)
    let completed = false
    try {
      // Authentication and role checks stay in the existing store.
      const result = await Promise.resolve(actions.login(values.email, values.password))
      if (!result.ok) { focusIntent.current = "error"; setSubmitError(result.error); return }
      let persisted = false
      try {
        const saved = JSON.parse(window.localStorage.getItem(`cleanhome-demo-state-${APP_ROLE}`) || "null") as AppState | null
        persisted = saved?.session?.userId === result.data.id && saved.session.role === result.data.role
      } catch { /* The store can keep the session in memory when storage is unavailable. */ }
      if (persisted) toast.success("Đã đăng nhập trên trình duyệt này")
      else toast.warning("Đã đăng nhập trong phiên hiện tại; trình duyệt chưa lưu được phiên đăng nhập")
      completed = true
      router.push(HOME_PATH.staff)
    } catch { focusIntent.current = "error"; setSubmitError("Chưa thể đăng nhập. Vui lòng thử lại.") }
    finally { if (!completed) { locked.current = false; setBusy(false) } }
  }

  return <Card className="mx-auto grid min-w-0 max-w-lg gap-0 overflow-visible rounded-3xl py-0 shadow-sm ring-border lg:max-w-none lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
    <aside className="hidden min-w-0 flex-col justify-between gap-10 rounded-l-3xl bg-blue-50 p-9 lg:flex"><div><div className="mb-6 flex size-14 items-center justify-center rounded-2xl bg-white text-primary"><ClipboardListIcon aria-hidden="true" className="size-7" /></div><p className="m-0 text-xs font-semibold tracking-wider text-primary uppercase">Không gian làm việc</p><p className="m-0 mt-5 text-3xl leading-tight font-semibold tracking-tight">Lịch trình rõ ràng.<br />Công việc thuận tiện.</p><p className="m-0 mt-5 text-sm leading-7 text-muted-foreground">Xem các công việc được phân công, theo dõi lịch và ghi lại tiến trình thực hiện.</p></div><p className="m-0 flex items-start gap-3 text-sm leading-7 text-muted-foreground"><ShieldCheckIcon aria-hidden="true" className="mt-1 size-5 shrink-0 text-primary" />Tài khoản nhân viên được người quản lý cấp.</p></aside>
    <CardContent className="min-w-0 p-6 sm:p-8 lg:p-10"><p className="m-0 mb-3 text-xs font-semibold tracking-wider text-primary uppercase">CleanHome / Nhân viên</p><h1 className="m-0 text-3xl leading-tight font-bold tracking-tight">Đăng nhập nhân viên</h1><p className="m-0 mt-4 mb-7 text-sm leading-7 text-muted-foreground">Sử dụng tài khoản của bạn để mở không gian làm việc.</p><form ref={form} noValidate onSubmit={submit} aria-busy={busy} className="flex flex-col gap-5"><fieldset disabled={busy} className="m-0 min-w-0 space-y-5 border-0 p-0"><legend className="sr-only">Thông tin đăng nhập</legend><Field label="Email" error={errors.email}><Input name="email" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} required maxLength={254} value={values.email} onChange={(event) => change("email", event.target.value)} className="min-h-12 rounded-xl" /></Field><Field label="Mật khẩu" error={errors.password}><PasswordField name="password" required disabled={busy} value={values.password} onChange={(event) => change("password", event.target.value)} /></Field></fieldset>{submitError && <div ref={alert} tabIndex={-1} role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-7 text-destructive">{submitError}</div>}<Button type="submit" disabled={busy} className="w-full">{busy ? <><LoaderCircleIcon aria-hidden="true" className="animate-spin motion-reduce:animate-none" />Đang đăng nhập...</> : <>Đăng nhập<ArrowRightIcon aria-hidden="true" /></>}</Button><p className="sr-only" role="status">{busy ? "Đang đăng nhập" : ""}</p></form><p className="m-0 mt-6 rounded-xl bg-slate-50 px-4 py-3 text-xs leading-6 text-muted-foreground">Nếu chưa có tài khoản hoặc không thể đăng nhập, vui lòng liên hệ người quản lý.</p></CardContent>
  </Card>
}
