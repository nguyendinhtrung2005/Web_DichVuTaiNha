"use client"

import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from "react"
import { AreaLink as Link } from "@/components/shared/area-routes"
import { CheckIcon, InfoIcon, LockKeyholeIcon, PencilIcon, PlusIcon, RotateCcwIcon, UnlockKeyholeIcon, UserRoundIcon } from "lucide-react"
import { Field, useData } from "../../common"
import { Button } from "../ui/button"
import { Card, CardContent } from "../ui/card"
import { Input } from "../ui/input"
import { Textarea } from "../ui/textarea"
import { ToneBadge } from "../shared/status-badge"
import type { AppState, User } from "@/lib/types"
import { AdminEmpty, AdminError, AdminLoading, AdminPageHeader, formatAdminTime, getAdminDataError, normalizeSearch } from "./admin-shared"
import { AdminDialog } from "./admin-dialog"
import { adminAccountService, validateAdminAccount, type AdminAccountErrors, type AdminAccountInput, type AdminAccountResult, type ManagedAccountRole } from "./admin-account-service"

type AccountDialog = "view" | "edit" | "create" | "lock"
type Draft = AdminAccountInput & { position: string }
type Feedback = { message: string; warning?: boolean }
const PAGE_SIZE = 8
const EMPTY_DRAFT: Draft = { name: "", email: "", phone: "", address: "", position: "", role: "customer" }

function valuesOf(account: User): Draft {
  return { name: account.name, email: account.email, phone: account.phone, address: account.address, position: account.position || "", role: account.role as ManagedAccountRole }
}

function AccountStatus({ account }: { account: User }) {
  return <ToneBadge tone={account.status === "active" ? "success" : "danger"}>{account.status === "active" ? "Hoạt động" : "Đã khóa"}</ToneBadge>
}

function AccountItem({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return <div className={`min-w-0 ${wide ? "sm:col-span-2" : ""}`}><dt className="mb-1.5 text-xs text-muted-foreground">{label}</dt><dd className="m-0 break-words text-sm leading-7">{children}</dd></div>
}

function DetailContent({ account, state }: { account: User; state: AppState }) {
  const related = state.orders.filter((order) => account.role === "staff" ? order.staffId === account.id : order.customerId === account.id)
  const recent = related.slice().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 3)
  return <div className="min-w-0 space-y-5">
    <div className="flex min-w-0 items-start gap-3 rounded-xl bg-blue-50/60 p-4"><span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white text-primary"><UserRoundIcon aria-hidden="true" className="size-5" /></span><div className="min-w-0"><h3 className="m-0 break-words text-base leading-7 font-semibold">{account.name}</h3><div className="mt-2 flex flex-wrap items-center gap-2"><ToneBadge tone="primary">{account.role === "staff" ? "Nhân viên" : "Khách hàng"}</ToneBadge><AccountStatus account={account} /></div></div></div>
    <dl className="m-0 grid min-w-0 gap-5 sm:grid-cols-2"><AccountItem label="Mã tài khoản">{account.code}</AccountItem><AccountItem label="Ngày tạo">{formatAdminTime(account.createdAt)}</AccountItem><AccountItem label="Email" wide><span className="break-all">{account.email}</span></AccountItem><AccountItem label="Số điện thoại">{account.phone}</AccountItem>{account.role === "staff" && <AccountItem label="Vị trí công việc">{account.position || "Chưa có thông tin"}</AccountItem>}<AccountItem label="Địa chỉ liên hệ" wide>{account.address || "Chưa có địa chỉ liên hệ"}</AccountItem><AccountItem label="ID tài khoản" wide><span className="break-all text-xs text-muted-foreground">{account.id}</span></AccountItem></dl>
    <section className="rounded-xl border border-border p-4" aria-label="Thông tin đơn liên quan"><h3 className="m-0 text-sm font-semibold">{account.role === "staff" ? "Công việc được phân công" : "Đơn dịch vụ liên quan"}</h3><dl className="m-0 mt-4 grid grid-cols-2 gap-4"><AccountItem label="Tổng số">{related.length}</AccountItem><AccountItem label="Đã hoàn thành">{related.filter((order) => order.status === "completed").length}</AccountItem></dl>{recent.length > 0 && <ul className="m-0 mt-4 grid list-none gap-2 border-t border-border p-0 pt-3">{recent.map((order) => <li key={order.id} className="min-w-0"><Link href={`/don/${order.id}`} className="inline-flex min-h-11 items-center rounded-lg break-words text-sm font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">Xem đơn {order.code}</Link></li>)}</ul>}</section>
  </div>
}

export function AdminAccounts() {
  const { s, user, role } = useData()
  const [query, setQuery] = useState("")
  const [accountRole, setAccountRole] = useState("")
  const [status, setStatus] = useState("")
  const [sort, setSort] = useState("created-desc")
  const [page, setPage] = useState(0)
  const [dialog, setDialog] = useState<AccountDialog | null>(null)
  const [targetId, setTargetId] = useState("")
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [errors, setErrors] = useState<AdminAccountErrors>({})
  const [confirming, setConfirming] = useState(false)
  const [lockDesired, setLockDesired] = useState(true)
  const [submitError, setSubmitError] = useState("")
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const submitting = useRef(false)
  const mounted = useRef(true)
  const latestState = useRef(s)
  latestState.current = s
  const openedState = useRef<AppState | null>(null)
  const dialogTrigger = useRef<HTMLElement | null>(null)
  const formScope = useRef<HTMLDivElement>(null)
  const pageElement = useRef<HTMLDivElement>(null)
  const feedbackElement = useRef<HTMLDivElement>(null)
  const focusIntent = useRef<"trigger" | "feedback" | "invalid" | "form" | null>(null)

  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useLayoutEffect(() => {
    if (busy || !focusIntent.current) return
    if (dialog) {
      const target = focusIntent.current === "invalid" ? formScope.current?.querySelector<HTMLElement>('[aria-invalid="true"]') : focusIntent.current === "form" ? formScope.current?.querySelector<HTMLElement>('[name="name"]') : null
      if (target) { target.focus(); focusIntent.current = null }
      return
    }
    const target = focusIntent.current === "feedback" ? feedbackElement.current : dialogTrigger.current?.isConnected ? dialogTrigger.current : pageElement.current
    if (target) { target.focus({ preventScroll: focusIntent.current === "trigger" }); focusIntent.current = null }
  }, [busy, dialog, feedback, errors, confirming])

  if (!s) return <AdminLoading />
  if (!user || role !== "admin" || user.role !== "admin" || user.status !== "active") return <AdminEmpty title="Vui lòng đăng nhập tài khoản quản trị viên" />
  if (getAdminDataError(s)) return <AdminError />
  const managed = s.users.filter((account) => account.role === "customer" || account.role === "staff")
  if (managed.some((account) => ![account.code, account.name, account.email, account.phone, account.address, account.createdAt].every((value) => typeof value === "string") || !Number.isFinite(new Date(account.createdAt).getTime()) || (account.avatar !== undefined && typeof account.avatar !== "string") || (account.position !== undefined && typeof account.position !== "string"))) return <AdminError title="Chưa thể tải danh sách tài khoản" />

  const normalizedQuery = normalizeSearch(query)
  const filtered = managed.filter((account) => (!normalizedQuery || normalizeSearch(`${account.name} ${account.email} ${account.phone} ${account.phone.replace(/[^0-9]/g, "")}`).includes(normalizedQuery)) && (!accountRole || account.role === accountRole) && (!status || account.status === status)).sort((a, b) => {
    if (sort === "name-asc") return a.name.localeCompare(b.name, "vi", { sensitivity: "base" })
    if (sort === "name-desc") return b.name.localeCompare(a.name, "vi", { sensitivity: "base" })
    return (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * (sort === "created-asc" ? 1 : -1)
  })
  const pages = Math.ceil(filtered.length / PAGE_SIZE)
  const currentPage = Math.min(page, Math.max(0, pages - 1))
  const displayed = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)
  const target = managed.find((account) => account.id === targetId)
  const hasFilters = Boolean(query || accountRole || status || sort !== "created-desc")
  const clearFilters = () => { setQuery(""); setAccountRole(""); setStatus(""); setSort("created-desc"); setPage(0) }

  function open(kind: AccountDialog, trigger: HTMLElement, account?: User) {
    if (submitting.current) return
    dialogTrigger.current = trigger
    openedState.current = s
    focusIntent.current = null
    setTargetId(account?.id || "")
    setDraft(account ? valuesOf(account) : { ...EMPTY_DRAFT, role: accountRole === "staff" ? "staff" : "customer" })
    setLockDesired(account?.status !== "locked")
    setErrors({}); setSubmitError(""); setConfirming(false); setFeedback(null); setDialog(kind)
  }

  function closeDialog() {
    if (submitting.current) return
    focusIntent.current = "trigger"
    setDialog(null); setConfirming(false); setErrors({}); setSubmitError("")
  }

  function change(key: keyof Draft, value: string) {
    setDraft((previous) => ({ ...previous, [key]: value }))
    setErrors((previous) => ({ ...previous, [key]: undefined }))
    setSubmitError("")
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current || !dialog) return
    const state = latestState.current
    if (!state) { setSubmitError("Chưa đọc được dữ liệu tài khoản. Vui lòng tải lại trang."); return }
    const currentTarget = state.users.find((account) => account.id === targetId && (account.role === "customer" || account.role === "staff"))
    if (dialog !== "create" && !currentTarget) { setSubmitError("Tài khoản không còn trong danh sách khách hàng hoặc nhân viên."); return }
    if (dialog === "view" && currentTarget) { openedState.current = state; setDraft(valuesOf(currentTarget)); setErrors({}); setSubmitError(""); focusIntent.current = "form"; setDialog("edit"); return }
    const targetRole = dialog === "create" ? draft.role : currentTarget!.role as ManagedAccountRole
    if (dialog === "edit" || dialog === "create") {
      const invalid = validateAdminAccount(draft, targetRole)
      setErrors(invalid); setSubmitError("")
      if (Object.keys(invalid).length) { focusIntent.current = "invalid"; return }
      if (dialog === "create" && !confirming) { setConfirming(true); return }
    }
    if (dialog === "lock" && currentTarget?.status === (lockDesired ? "locked" : "active")) { setSubmitError("Trạng thái tài khoản đã thay đổi. Vui lòng mở lại hộp thoại để kiểm tra."); return }
    submitting.current = true
    setBusy(true)
    try {
      const expected = openedState.current || state
      const result: AdminAccountResult = dialog === "create" ? await adminAccountService.create(state, draft) : dialog === "edit" ? await adminAccountService.update(expected, targetId, draft) : await adminAccountService.setLocked(expected, targetId, lockDesired)
      if (!mounted.current) return
      if (!result.ok) {
        setSubmitError(result.error)
        if (dialog === "create") setConfirming(false)
        if (result.field) { setErrors((previous) => ({ ...previous, [result.field!]: result.error })); focusIntent.current = "invalid" }
        return
      }
      const message = dialog === "create" ? "Đã tạo tài khoản trên trình duyệt này." : dialog === "edit" ? "Đã lưu thông tin tài khoản trên trình duyệt này." : lockDesired ? "Đã khóa tài khoản trên trình duyệt này." : "Đã mở khóa tài khoản trên trình duyệt này."
      setFeedback(result.persistence === "local" ? { message } : { message: "Thay đổi tài khoản chỉ được giữ trong phiên hiện tại; trình duyệt chưa lưu được trên thiết bị.", warning: true })
      focusIntent.current = "feedback"
      setDialog(null); setConfirming(false); setSubmitError(""); setErrors({})
    } catch { if (mounted.current) setSubmitError("Chưa thể lưu thay đổi. Thông tin đã nhập vẫn được giữ để thử lại.") }
    finally { submitting.current = false; if (mounted.current) setBusy(false) }
  }

  const dialogTitle = dialog === "view" ? "Chi tiết tài khoản" : dialog === "edit" ? "Chỉnh sửa tài khoản" : dialog === "lock" ? lockDesired ? "Khóa tài khoản" : "Mở khóa tài khoản" : confirming ? "Xác nhận thêm tài khoản" : "Thêm tài khoản"
  const submitLabel = dialog === "view" ? "Chỉnh sửa thông tin" : dialog === "edit" ? "Lưu tài khoản" : dialog === "lock" ? lockDesired ? "Xác nhận khóa" : "Xác nhận mở khóa" : confirming ? "Xác nhận tạo tài khoản" : "Kiểm tra thông tin"

  return <div ref={pageElement} tabIndex={-1} className="min-w-0 space-y-6 outline-none">
    <AdminPageHeader title="Quản lý tài khoản" description="Tra cứu khách hàng và nhân viên, cập nhật thông tin liên hệ và trạng thái tài khoản." action={<Button className="min-h-11 w-full sm:w-auto" onClick={(event) => open("create", event.currentTarget)}><PlusIcon aria-hidden="true" />Thêm tài khoản</Button>} />
    {feedback && <div ref={feedbackElement} role="status" tabIndex={-1} className={`flex min-w-0 items-start gap-3 rounded-xl border p-4 text-sm leading-7 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${feedback.warning ? "border-amber-200 bg-amber-50 text-amber-900" : "border-blue-100 bg-blue-50 text-blue-900"}`}><InfoIcon aria-hidden="true" className="mt-1 size-5 shrink-0" /><p className="m-0 min-w-0 break-words">{feedback.message}</p></div>}
    <section aria-label="Tìm và lọc tài khoản" className="min-w-0 rounded-2xl border border-border bg-white p-5 sm:p-6"><div className="grid min-w-0 gap-5 sm:grid-cols-2 xl:grid-cols-4"><Field label="Tìm kiếm tài khoản"><Input type="search" placeholder="Tên, email, số điện thoại..." value={query} onChange={(event) => { setQuery(event.target.value); setPage(0) }} /></Field><Field label="Vai trò"><select value={accountRole} onChange={(event) => { setAccountRole(event.target.value); setPage(0) }}><option value="">Tất cả vai trò</option><option value="customer">Khách hàng</option><option value="staff">Nhân viên</option></select></Field><Field label="Trạng thái tài khoản"><select value={status} onChange={(event) => { setStatus(event.target.value); setPage(0) }}><option value="">Tất cả trạng thái</option><option value="active">Hoạt động</option><option value="locked">Đã khóa</option></select></Field><Field label="Sắp xếp tài khoản"><select value={sort} onChange={(event) => { setSort(event.target.value); setPage(0) }}><option value="created-desc">Ngày tạo: mới nhất</option><option value="created-asc">Ngày tạo: cũ nhất</option><option value="name-asc">Tên: A–Z</option><option value="name-desc">Tên: Z–A</option></select></Field></div><div className="mt-5 flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between"><p role="status" aria-live="polite" className="m-0 text-sm leading-6 text-muted-foreground"><strong className="font-semibold text-foreground">{filtered.length}</strong> tài khoản{hasFilters ? ` phù hợp / ${managed.length} tài khoản hiện có` : " khách hàng và nhân viên"}</p><Button variant="outline" className="min-h-11 w-full sm:w-auto" disabled={!hasFilters} onClick={clearFilters}><RotateCcwIcon aria-hidden="true" />Xóa bộ lọc</Button></div></section>

    {filtered.length === 0 ? <AdminEmpty title={managed.length ? "Không tìm thấy tài khoản phù hợp" : "Chưa có khách hàng hoặc nhân viên"} description={managed.length ? "Thử tên, email hoặc số điện thoại khác và điều chỉnh bộ lọc." : "Danh sách sẽ hiển thị các tài khoản khách hàng và nhân viên hiện có."} action={hasFilters ? <Button variant="outline" className="min-h-11" onClick={clearFilters}>Xóa bộ lọc</Button> : undefined} /> : <>
      <div className="grid min-w-0 gap-4 xl:hidden">{displayed.map((account) => <Card key={account.id} className="min-w-0 rounded-2xl shadow-none ring-border [--card-spacing:--spacing(5)]"><CardContent className="flex min-w-0 flex-col gap-4"><div className="flex min-w-0 flex-wrap items-center justify-between gap-3"><span className="break-words text-xs font-semibold text-muted-foreground">{account.code}</span><AccountStatus account={account} /></div><div className="min-w-0"><h2 className="m-0 break-words text-base leading-7 font-semibold">{account.name}</h2><p className="m-0 mt-1 text-xs text-primary">{account.role === "staff" ? "Nhân viên" : "Khách hàng"}</p></div><dl className="m-0 grid min-w-0 gap-3"><AccountItem label="Email"><span className="break-all">{account.email}</span></AccountItem><AccountItem label="Số điện thoại">{account.phone}</AccountItem></dl><div className="grid min-w-0 grid-cols-2 gap-2 border-t border-border pt-4"><Button variant="outline" className="col-span-2 min-h-11 w-full" aria-label={`Xem tài khoản ${account.code}`} onClick={(event) => open("view", event.currentTarget, account)}>Xem chi tiết</Button><Button variant="outline" className="min-h-11" aria-label={`Sửa tài khoản ${account.code}`} onClick={(event) => open("edit", event.currentTarget, account)}><PencilIcon aria-hidden="true" />Sửa</Button><Button variant="outline" className="min-h-11" disabled={account.id === user.id} aria-label={`${account.status === "locked" ? "Mở khóa" : "Khóa"} tài khoản ${account.code}`} onClick={(event) => open("lock", event.currentTarget, account)}>{account.status === "locked" ? <UnlockKeyholeIcon aria-hidden="true" /> : <LockKeyholeIcon aria-hidden="true" />}{account.status === "locked" ? "Mở khóa" : "Khóa"}</Button></div></CardContent></Card>)}</div>
      <div className="hidden min-w-0 rounded-2xl border border-border bg-white xl:block"><table className="w-full table-fixed border-collapse text-left text-sm"><caption className="sr-only">Khách hàng và nhân viên CleanHome</caption><colgroup><col className="w-[27%]" /><col className="w-[29%]" /><col className="w-[16%]" /><col className="w-[28%]" /></colgroup><thead className="bg-slate-50 text-xs text-muted-foreground"><tr>{["Tài khoản / Vai trò", "Thông tin liên hệ", "Trạng thái", "Thao tác"].map((label) => <th key={label} scope="col" className="px-4 py-4 font-semibold first:rounded-tl-2xl last:rounded-tr-2xl">{label}</th>)}</tr></thead><tbody>{displayed.map((account) => <tr key={account.id} className="border-t border-border transition-colors hover:bg-slate-50/70"><td className="px-4 py-5 align-top"><p className="m-0 break-words leading-6 font-semibold">{account.name}</p><p className="m-0 mt-2 break-words text-xs leading-6 text-muted-foreground">{account.code} · {account.role === "staff" ? "Nhân viên" : "Khách hàng"}</p></td><td className="px-4 py-5 align-top"><p className="m-0 break-all leading-6">{account.email}</p><p className="m-0 mt-2 break-words text-xs leading-6 text-muted-foreground">{account.phone}</p></td><td className="px-4 py-5 align-top"><AccountStatus account={account} /></td><td className="px-4 py-3 align-top"><div className="flex min-w-0 flex-wrap gap-2"><Button variant="outline" className="min-h-11" aria-label={`Xem tài khoản ${account.code}`} onClick={(event) => open("view", event.currentTarget, account)}>Chi tiết</Button><Button variant="outline" className="min-h-11" aria-label={`Sửa tài khoản ${account.code}`} onClick={(event) => open("edit", event.currentTarget, account)}>Sửa</Button><Button variant="outline" className="min-h-11" disabled={account.id === user.id} aria-label={`${account.status === "locked" ? "Mở khóa" : "Khóa"} tài khoản ${account.code}`} onClick={(event) => open("lock", event.currentTarget, account)}>{account.status === "locked" ? "Mở khóa" : "Khóa"}</Button></div></td></tr>)}</tbody></table></div>
      {pages > 1 && <nav aria-label="Phân trang tài khoản" className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><p className="m-0 text-sm text-muted-foreground">{currentPage * PAGE_SIZE + 1}–{Math.min((currentPage + 1) * PAGE_SIZE, filtered.length)} / {filtered.length} tài khoản</p><div className="flex w-full flex-wrap items-center justify-between gap-3 sm:w-auto"><Button variant="outline" className="min-h-11" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Trước</Button><span aria-live="polite" className="text-sm text-muted-foreground">Trang {currentPage + 1} / {pages}</span><Button variant="outline" className="min-h-11" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>Sau</Button></div></nav>}
    </>}

    {dialog && <AdminDialog title={dialogTitle} busy={busy} error={submitError} isBusy={() => submitting.current} close={closeDialog} submit={submit} submitLabel={submitLabel}>
      <div ref={formScope} className="min-w-0">
        {dialog === "view" ? target ? <DetailContent account={target} state={s} /> : <p role="alert" className="m-0 text-sm leading-7 text-destructive">Tài khoản không còn trong danh sách.</p> : dialog === "lock" ? <div className="min-w-0 space-y-4"><p className="m-0 break-words text-sm leading-7">{target?.name || "Tài khoản không còn trong danh sách"}</p><p className="m-0 break-all text-xs leading-6 text-muted-foreground">{target?.email}</p><p className="m-0 rounded-xl bg-slate-50 p-4 text-sm leading-7">{lockDesired ? "Tài khoản bị khóa sẽ không thể đăng nhập theo cơ chế hiện có. Những thông tin và đơn dịch vụ đã lưu được giữ nguyên." : "Bạn xác nhận mở khóa để tài khoản này có thể đăng nhập trở lại theo cơ chế hiện có?"}</p></div> : dialog === "create" && confirming ? <div className="min-w-0 space-y-5"><p className="m-0 flex items-start gap-2 text-sm leading-7 text-muted-foreground"><CheckIcon aria-hidden="true" className="mt-1 size-5 shrink-0 text-primary" />Kiểm tra thông tin trước khi tạo tài khoản.</p><dl className="m-0 grid min-w-0 gap-5 sm:grid-cols-2"><AccountItem label="Vai trò">{draft.role === "staff" ? "Nhân viên" : "Khách hàng"}</AccountItem><AccountItem label="Họ tên">{draft.name.trim()}</AccountItem><AccountItem label="Email" wide><span className="break-all">{draft.email.trim()}</span></AccountItem><AccountItem label="Số điện thoại">{draft.phone.trim()}</AccountItem>{draft.role === "staff" && <AccountItem label="Vị trí công việc">{draft.position.trim() || "Chưa có thông tin"}</AccountItem>}<AccountItem label="Địa chỉ" wide>{draft.address.trim() || "Chưa có địa chỉ liên hệ"}</AccountItem></dl><Button type="button" variant="outline" className="min-h-11 w-full sm:w-auto" disabled={busy} onClick={() => { setConfirming(false); setSubmitError(""); focusIntent.current = "form" }}>Sửa lại thông tin</Button></div> : <div className="grid min-w-0 gap-5 sm:grid-cols-2">
          {dialog === "create" && <div className="min-w-0 sm:col-span-2"><Field label="Vai trò tài khoản"><select name="role" value={draft.role} onChange={(event) => change("role", event.target.value)}><option value="customer">Khách hàng</option><option value="staff">Nhân viên</option></select></Field></div>}
          <div className="min-w-0 sm:col-span-2"><Field label="Họ tên" error={errors.name}><Input name="name" required maxLength={120} value={draft.name} onChange={(event) => change("name", event.target.value)} /></Field></div>
          <Field label="Email" error={errors.email}><Input name="email" type="email" required autoCapitalize="none" spellCheck={false} maxLength={254} value={draft.email} onChange={(event) => change("email", event.target.value)} /></Field>
          <Field label="Số điện thoại" error={errors.phone}><Input name="phone" type="tel" required maxLength={20} value={draft.phone} onChange={(event) => change("phone", event.target.value)} /></Field>
          <div className="min-w-0 sm:col-span-2"><Field label="Địa chỉ" error={errors.address} hint="Có thể để trống khi chưa có thông tin liên hệ."><Textarea name="address" rows={3} maxLength={300} value={draft.address} onChange={(event) => change("address", event.target.value)} /></Field></div>
          {(dialog === "create" ? draft.role : target?.role) === "staff" && <div className="min-w-0 sm:col-span-2"><Field label="Vị trí công việc" error={errors.position}><Input name="position" maxLength={120} value={draft.position} onChange={(event) => change("position", event.target.value)} /></Field></div>}
        </div>}
      </div>
    </AdminDialog>}
  </div>
}
