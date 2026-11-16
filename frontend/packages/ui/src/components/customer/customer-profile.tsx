"use client"

import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react"
import Link from "next/link"
import { CalendarDaysIcon, CameraIcon, InfoIcon, LoaderCircleIcon, MapPinIcon, PencilIcon, UserRoundIcon } from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import type { User } from "@/lib/types"
import { Field, useData } from "../../common"
import { saveCustomerProfile } from "./account-service"
import { validateProfile } from "./account-validation"

type ProfileValues = { name: string; email: string; phone: string; address: string; avatar: string }
type ProfileErrors = Partial<Record<keyof ProfileValues, string>>
type Feedback = { message: string; warning?: boolean }
const AVATAR_TYPES = new Set(["image/png", "image/jpeg", "image/webp"])
const MAX_AVATAR_BYTES = 1024 * 1024

function valuesOf(user: User): ProfileValues {
  return { name: user.name, email: user.email, phone: user.phone, address: user.address, avatar: user.avatar || "" }
}

function ProfileItem({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return <div className={`min-w-0 ${wide ? "sm:col-span-2" : ""}`}><dt className="mb-2 text-xs text-muted-foreground">{label}</dt><dd className="m-0 break-words text-sm leading-7 font-medium">{children}</dd></div>
}

function ProfileContent({ user }: { user: User }) {
  const [editing, setEditing] = useState(false)
  const [values, setValues] = useState<ProfileValues>(() => valuesOf(user))
  const [errors, setErrors] = useState<ProfileErrors>({})
  const [submitError, setSubmitError] = useState("")
  const [avatarError, setAvatarError] = useState("")
  const [avatarReading, setAvatarReading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const mounted = useRef(false)
  const saving = useRef(false)
  const draftUser = useRef(user)
  const reading = useRef(false)
  const uploadVersion = useRef(0)
  const fileReader = useRef<FileReader | null>(null)
  const decodingImage = useRef<HTMLImageElement | null>(null)
  const fileInput = useRef<HTMLInputElement | null>(null)
  const nameInput = useRef<HTMLInputElement | null>(null)
  const editButton = useRef<HTMLButtonElement | null>(null)
  const feedbackElement = useRef<HTMLDivElement | null>(null)
  const focusIntent = useRef<"name" | "edit" | "feedback" | null>(null)

  function cancelAvatarRead() {
    uploadVersion.current += 1
    const reader = fileReader.current
    if (reader) {
      reader.onload = null
      reader.onerror = null
      reader.onabort = null
      if (reader.readyState === FileReader.LOADING) reader.abort()
    }
    fileReader.current = null
    const image = decodingImage.current
    if (image) { image.onload = null; image.onerror = null; image.src = "" }
    decodingImage.current = null
    reading.current = false
  }

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      cancelAvatarRead()
      focusIntent.current = null
    }
  }, [])

  useEffect(() => {
    if (!editing) setValues(valuesOf(user))
  }, [user, editing])

  useLayoutEffect(() => {
    const target = focusIntent.current
    if (!target) return
    const element = target === "name" ? nameInput.current : target === "feedback" ? feedbackElement.current : editButton.current
    if (element?.isConnected) {
      element.focus({ preventScroll: target === "edit" })
      focusIntent.current = null
    }
  }, [editing, feedback])

  function focusAfterRender(target: "name" | "edit" | "feedback") {
    focusIntent.current = target
  }

  const changeValue = (key: keyof ProfileValues, value: string) => {
    setValues((previous) => ({ ...previous, [key]: value }))
    setErrors((previous) => ({ ...previous, [key]: undefined }))
    setSubmitError("")
  }

  const startEditing = () => {
    if (saving.current) return
    draftUser.current = user
    focusAfterRender("name")
    cancelAvatarRead()
    setAvatarReading(false)
    setValues(valuesOf(user))
    setErrors({})
    setSubmitError("")
    setAvatarError("")
    setFeedback(null)
    setEditing(true)
  }

  const cancelEditing = () => {
    if (saving.current) return
    focusAfterRender("edit")
    cancelAvatarRead()
    setAvatarReading(false)
    setValues(valuesOf(user))
    setErrors({})
    setSubmitError("")
    setAvatarError("")
    setFeedback(null)
    setEditing(false)
  }

  const keepCurrentAvatar = () => {
    cancelAvatarRead()
    setAvatarReading(false)
    setAvatarError("")
    setValues((previous) => ({ ...previous, avatar: user.avatar || "" }))
    if (fileInput.current) fileInput.current.value = ""
  }

  const readAvatar = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file || saving.current) return
    cancelAvatarRead()
    setAvatarReading(false)
    setAvatarError("")
    if (!AVATAR_TYPES.has(file.type)) { setAvatarError("Chọn ảnh PNG, JPEG hoặc WebP."); event.target.value = ""; return }
    if (file.size === 0 || file.size > MAX_AVATAR_BYTES) { setAvatarError("Chọn ảnh có dung lượng từ 1 byte đến 1 MB."); event.target.value = ""; return }
    const version = uploadVersion.current
    const reader = new FileReader()
    fileReader.current = reader
    reading.current = true
    setAvatarReading(true)

    const failRead = (message: string) => {
      if (!mounted.current || version !== uploadVersion.current) return
      fileReader.current = null
      decodingImage.current = null
      reading.current = false
      setAvatarReading(false)
      setAvatarError(message)
      if (fileInput.current) fileInput.current.value = ""
    }
    reader.onerror = () => failRead("Chưa đọc được ảnh. Vui lòng chọn lại.")
    reader.onabort = () => failRead("Việc đọc ảnh đã dừng. Vui lòng chọn lại.")
    reader.onload = () => {
      if (!mounted.current || version !== uploadVersion.current) return
      const imageData = reader.result
      if (typeof imageData !== "string" || !/^data:image\/(png|jpeg|webp);base64,/.test(imageData)) { failRead("Ảnh không hợp lệ. Vui lòng chọn lại."); return }
      const image = new window.Image()
      decodingImage.current = image
      image.onerror = () => failRead("Không thể mở ảnh này. Vui lòng chọn ảnh khác.")
      image.onload = () => {
        if (!mounted.current || version !== uploadVersion.current) return
        if (!image.naturalWidth || !image.naturalHeight) { failRead("Ảnh không hợp lệ. Vui lòng chọn lại."); return }
        fileReader.current = null
        decodingImage.current = null
        reading.current = false
        setAvatarReading(false)
        setAvatarError("")
        setValues((previous) => ({ ...previous, avatar: imageData }))
      }
      image.src = imageData
    }
    try { reader.readAsDataURL(file) } catch { failRead("Chưa đọc được ảnh. Vui lòng chọn lại.") }
  }

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (saving.current || reading.current) return
    if (avatarError) { fileInput.current?.focus(); return }
    const nextValues = { name: values.name.trim(), email: values.email.trim(), phone: values.phone.trim(), address: values.address.trim(), avatar: values.avatar }
    const validationErrors = validateProfile(nextValues)
    setErrors(validationErrors)
    setSubmitError("")
    if (Object.values(validationErrors).some(Boolean)) {
      const firstInvalid = Object.keys(validationErrors).find((key) => validationErrors[key as keyof typeof validationErrors])
      event.currentTarget.querySelector<HTMLElement>(`[name="${firstInvalid}"]`)?.focus()
      return
    }
    saving.current = true
    setBusy(true)
    try {
      const result = await saveCustomerProfile(user.id, nextValues, draftUser.current)
      if (!mounted.current) return
      if (!result.ok) {
        setSubmitError(result.error)
        const message = result.error.toLowerCase()
        if (message.includes("email")) setErrors((previous) => ({ ...previous, email: result.error }))
        else if (message.includes("số điện thoại")) setErrors((previous) => ({ ...previous, phone: result.error }))
        return
      }
      focusAfterRender("feedback")
      draftUser.current = { ...draftUser.current, ...nextValues }
      setEditing(false)
      setFeedback(result.persistence === "session"
        ? { message: "Thay đổi hồ sơ chỉ được giữ trong phiên hiện tại; trình duyệt chưa lưu được trên thiết bị.", warning: true }
        : { message: "Đã lưu thông tin hồ sơ trên trình duyệt này." })
    } catch {
      if (mounted.current) setSubmitError("Chưa lưu được hồ sơ. Vui lòng thử lại; thông tin bạn nhập vẫn được giữ.")
    } finally {
      saving.current = false
      if (mounted.current) setBusy(false)
    }
  }

  const displayedAvatar = editing ? values.avatar : user.avatar
  const initials = user.name.trim().split(/\s+/).slice(-2).map((part) => part[0]).join("").toUpperCase()
  const joinedAt = new Date(user.createdAt)

  return (
    <div className="mx-auto max-w-6xl px-4 pt-10 pb-16 sm:px-6 md:pt-12 md:pb-24">
      <header className="mb-8 md:mb-10"><p className="m-0 mb-3 text-xs font-semibold tracking-[0.12em] text-primary uppercase">CleanHome / Tài khoản</p><h1 className="m-0 text-3xl leading-tight font-bold tracking-tight md:text-4xl">Hồ sơ cá nhân</h1><p className="m-0 mt-4 text-base leading-7 text-muted-foreground">Quản lý thông tin liên hệ và địa chỉ dùng khi đặt dịch vụ.</p></header>

      {feedback && <div ref={feedbackElement} role="status" tabIndex={-1} className={`mb-7 flex min-w-0 items-start gap-3 rounded-xl border px-5 py-4 text-sm leading-7 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring ${feedback.warning ? "border-amber-200 bg-amber-50 text-amber-900" : "border-blue-100 bg-blue-50 text-blue-900"}`}><InfoIcon aria-hidden="true" className="mt-1 size-5 shrink-0" /><p className="m-0 min-w-0 break-words">{feedback.message}</p></div>}

      <section aria-label="Thông tin tài khoản" className="mb-8 flex min-w-0 flex-col items-start gap-5 rounded-2xl border border-blue-100 bg-blue-50/50 p-6 sm:flex-row sm:items-center sm:p-7">
        <Avatar className="size-24 bg-white"><AvatarImage src={displayedAvatar || undefined} alt={`Ảnh đại diện của ${user.name}`} /><AvatarFallback className="bg-blue-100 text-2xl font-semibold text-primary">{initials || <UserRoundIcon aria-hidden="true" className="size-9" />}</AvatarFallback></Avatar>
        <div className="min-w-0"><h2 className="m-0 break-words text-xl leading-8 font-semibold sm:text-2xl">{user.name}</h2><p className="m-0 mt-2 break-all text-sm leading-7 text-muted-foreground">{user.email}</p><Badge variant="outline" className="mt-3 border-blue-200 bg-white px-2.5 py-1.5 text-primary">Khách hàng</Badge></div>
      </section>

      <div className="grid min-w-0 items-start gap-7 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-8">
        <Card className="min-w-0 overflow-visible rounded-2xl shadow-none ring-border [--card-spacing:--spacing(6)]">
          <CardHeader><div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between"><h2 className="m-0 text-lg leading-7 font-semibold">{editing ? "Chỉnh sửa thông tin" : "Thông tin cá nhân"}</h2>{!editing && <Button ref={editButton} variant="outline" className="w-full sm:w-auto" onClick={startEditing}><PencilIcon data-icon="inline-start" aria-hidden="true" />Chỉnh sửa thông tin</Button>}</div></CardHeader>
          <CardContent>
            {editing ? <form noValidate onSubmit={saveProfile} aria-busy={busy || avatarReading} className="space-y-6">
              <div className="grid min-w-0 gap-5 sm:grid-cols-2">
                <div className="min-w-0 sm:col-span-2"><Field label="Họ và tên" error={errors.name}><Input ref={nameInput} name="name" required autoComplete="name" maxLength={120} value={values.name} disabled={busy} onChange={(event) => changeValue("name", event.target.value)} /></Field></div>
                <Field label="Email" error={errors.email}><Input name="email" type="email" required autoComplete="email" maxLength={254} value={values.email} disabled={busy} onChange={(event) => changeValue("email", event.target.value)} /></Field>
                <Field label="Số điện thoại" error={errors.phone} hint="Số di động hoặc số điện thoại bàn tại Việt Nam."><Input name="phone" type="tel" required autoComplete="tel" value={values.phone} disabled={busy} onChange={(event) => changeValue("phone", event.target.value)} /></Field>
                <div className="min-w-0 sm:col-span-2"><Field label="Địa chỉ mặc định" error={errors.address} hint="Có thể để trống và nhập địa chỉ khi đặt dịch vụ."><Textarea name="address" rows={3} autoComplete="street-address" maxLength={300} value={values.address} disabled={busy} onChange={(event) => changeValue("address", event.target.value)} /></Field></div>
              </div>
              <section className="rounded-xl border border-border bg-slate-50/60 p-4 sm:p-5" aria-label="Chỉnh sửa ảnh đại diện"><div className="mb-4 flex items-center gap-2.5"><CameraIcon aria-hidden="true" className="size-5 text-primary" /><h3 className="m-0 text-sm font-semibold">Ảnh đại diện</h3></div><Field label="Chọn ảnh đại diện" hint="Ảnh PNG, JPEG hoặc WebP, tối đa 1 MB." error={avatarError}><Input ref={fileInput} name="avatar" type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={readAvatar} className="h-auto min-h-11 py-2 file:mr-3 file:rounded-md file:bg-white file:px-2 file:text-xs" /></Field>{avatarReading && <p role="status" className="m-0 mt-3 flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />Đang đọc ảnh...</p>}{(avatarError || avatarReading || values.avatar !== (user.avatar || "")) && <Button variant="ghost" className="mt-3" disabled={busy} onClick={keepCurrentAvatar}>Giữ ảnh hiện tại</Button>}</section>
              {submitError && <p role="alert" className="m-0 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-7 text-red-800">{submitError}</p>}
              <div className="flex flex-col gap-3 border-t border-border pt-6 sm:flex-row sm:justify-end"><Button type="submit" disabled={busy || avatarReading || Boolean(avatarError)} className="px-5">{busy ? <><LoaderCircleIcon aria-hidden="true" className="animate-spin motion-reduce:animate-none" />Đang lưu...</> : "Lưu hồ sơ"}</Button><Button type="button" variant="outline" disabled={busy} onClick={cancelEditing}>Hủy thay đổi</Button></div>
              <p className="m-0 text-xs leading-6 text-muted-foreground">Thay đổi được lưu trên trình duyệt bạn đang sử dụng.</p>
            </form> : <dl className="m-0 grid min-w-0 gap-x-6 gap-y-6 sm:grid-cols-2"><ProfileItem label="Họ và tên">{user.name}</ProfileItem><ProfileItem label="Số điện thoại">{user.phone}</ProfileItem><ProfileItem label="Email" wide><span className="break-all">{user.email}</span></ProfileItem><ProfileItem label="Địa chỉ mặc định" wide>{user.address || <span className="font-normal text-muted-foreground">Chưa có địa chỉ mặc định.</span>}</ProfileItem></dl>}
          </CardContent>
        </Card>

        <aside aria-label="Thông tin bổ sung" className="min-w-0 space-y-6">
          <Card className="min-w-0 overflow-visible rounded-2xl shadow-none ring-border [--card-spacing:--spacing(6)]"><CardHeader><h2 className="m-0 text-lg font-semibold">Tài khoản CleanHome</h2></CardHeader><CardContent><dl className="m-0 grid gap-5"><ProfileItem label="Mã khách hàng">{user.code}</ProfileItem><ProfileItem label="Ngày tham gia"><span className="flex items-start gap-2"><CalendarDaysIcon aria-hidden="true" className="mt-1.5 size-4 shrink-0 text-primary" />{Number.isFinite(joinedAt.getTime()) ? joinedAt.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" }) : "Chưa có thông tin"}</span></ProfileItem><ProfileItem label="Trạng thái"><Badge variant="outline" className="border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-emerald-800">{user.status === "active" ? "Hoạt động" : "Đã khóa"}</Badge></ProfileItem></dl></CardContent></Card>
          <section className="rounded-2xl border border-blue-100 bg-blue-50/60 p-6"><MapPinIcon aria-hidden="true" className="mb-4 size-6 text-primary" /><h2 className="m-0 text-lg font-semibold">Địa chỉ cho lần đặt mới</h2><p className="m-0 mt-3 text-sm leading-7 text-muted-foreground">Địa chỉ mặc định giúp điền trước thông tin khi bạn tạo lịch đặt mới. Bạn vẫn có thể chỉnh lại địa chỉ trong bước đặt dịch vụ.</p></section>
        </aside>
      </div>
    </div>
  )
}

export function CustomerProfile() {
  const { s, user, role } = useData()
  if (!s) return <div className="mx-auto max-w-6xl space-y-6 px-4 py-12 sm:px-6" aria-busy="true" aria-label="Đang tải hồ sơ"><Skeleton className="h-12 w-60" /><Skeleton className="h-36 w-full rounded-2xl" /><Skeleton className="h-72 w-full rounded-2xl" /></div>
  if (!user || role !== "customer" || user.role !== "customer") return <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6"><h1 className="m-0 text-2xl font-semibold">Đăng nhập để xem hồ sơ</h1><p className="mt-4 mb-6 text-sm leading-7 text-muted-foreground">Thông tin cá nhân dành cho tài khoản khách hàng của bạn.</p><Button render={<Link href="/dang-nhap" />} nativeButton={false}>Đăng nhập</Button></section>
  if (![user.name, user.email, user.phone, user.address, user.code, user.createdAt].every((value) => typeof value === "string")) return <section role="alert" className="mx-auto max-w-6xl px-4 py-16 sm:px-6"><h1 className="m-0 text-2xl font-semibold">Chưa thể tải hồ sơ</h1><p className="mt-4 mb-6 text-sm leading-7 text-muted-foreground">Vui lòng tải lại trang để thử lại.</p><Button onClick={() => window.location.reload()}>Tải lại trang</Button></section>
  return <ProfileContent key={user.id} user={user} />
}
