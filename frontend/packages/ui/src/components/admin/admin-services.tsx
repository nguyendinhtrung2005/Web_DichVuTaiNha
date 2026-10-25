"use client"

import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react"
import { CheckIcon, ImageIcon, InfoIcon, PencilIcon, PlusIcon, RotateCcwIcon } from "lucide-react"
import { Field, money, useData } from "../../common"
import { Button } from "../ui/button"
import { Card, CardContent } from "../ui/card"
import { Input } from "../ui/input"
import { Textarea } from "../ui/textarea"
import { ToneBadge } from "../shared/status-badge"
import type { AppState, Service, ServiceCategory } from "@/lib/types"
import { CATEGORY_LABEL } from "@/lib/config"
import { AdminDialog } from "./admin-dialog"
import { AdminEmpty, AdminError, AdminLoading, AdminPageHeader, normalizeSearch } from "./admin-shared"
import { getAdminCommerceDataError } from "./admin-display"
import { adminServiceService, isSafeServiceImage, validateAdminService, type AdminServiceErrors, type AdminServiceInput, type AdminServiceResult } from "./admin-service-service"

type DialogKind = "view" | "edit" | "create" | "status" | "delete"
type Draft = { [K in keyof AdminServiceInput]: string }
type Feedback = { message: string; warning?: boolean }
const PAGE_SIZE = 8
const IMAGE_OPTIONS = [
  { value: "/images/don-nha-theo-gio.png", label: "Dọn nhà theo giờ" },
  { value: "/images/tong-ve-sinh.png", label: "Tổng vệ sinh nhà ở" },
  { value: "/images/ve-sinh-sofa.png", label: "Vệ sinh sofa" },
  { value: "/images/ve-sinh-may-lanh.png", label: "Vệ sinh máy lạnh" },
  { value: "/images/ve-sinh-nem.png", label: "Vệ sinh nệm" },
  { value: "/images/sau-xay-dung.png", label: "Vệ sinh sau xây dựng" },
]
const EMPTY_DRAFT: Draft = { name: "", category: "ve-sinh-nha-o", shortDesc: "", description: "", unit: "giờ", quantityLabel: "Số giờ", price: "", minQuantity: "1", defaultQuantity: "1", minutesPerUnit: "60", baseMinutes: "0", image: IMAGE_OPTIONS[0].value, scope: "", included: "", excluded: "" }

function valuesOf(service: Service): Draft {
  return { name: service.name, category: service.category, shortDesc: service.shortDesc, description: service.description, unit: service.unit, quantityLabel: service.quantityLabel, price: String(service.price), minQuantity: String(service.minQuantity), defaultQuantity: String(service.defaultQuantity), minutesPerUnit: String(service.minutesPerUnit), baseMinutes: String(service.baseMinutes), image: service.image, scope: service.scope.join("\n"), included: service.included.join("\n"), excluded: service.excluded.join("\n") }
}

function inputOf(draft: Draft): AdminServiceInput {
  const numeric = (value: string) => value.trim() ? Number(value) : Number.NaN
  const lines = (value: string) => value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  return { name: draft.name, category: draft.category as ServiceCategory, shortDesc: draft.shortDesc, description: draft.description, unit: draft.unit, quantityLabel: draft.quantityLabel, price: numeric(draft.price), minQuantity: numeric(draft.minQuantity), defaultQuantity: numeric(draft.defaultQuantity), minutesPerUnit: numeric(draft.minutesPerUnit), baseMinutes: numeric(draft.baseMinutes), image: draft.image, scope: lines(draft.scope), included: lines(draft.included), excluded: lines(draft.excluded) }
}

function ServiceStatus({ status }: { status: Service["status"] }) {
  return <ToneBadge tone={status === "active" ? "success" : "neutral"}>{status === "active" ? "Hoạt động" : "Ngừng cung cấp"}</ToneBadge>
}

function ServiceImage({ source, name, small = false }: { source: string; name: string; small?: boolean }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => { setFailed(false) }, [source])
  return <div className={`relative shrink-0 bg-slate-100 ${small ? "size-16 rounded-xl" : "aspect-[16/9] w-full rounded-t-2xl"}`}>{!failed && isSafeServiceImage(source) ? <img src={source} alt={name} width={small ? 64 : 640} height={small ? 64 : 360} loading="lazy" decoding="async" onError={() => setFailed(true)} className={`absolute inset-0 h-full w-full object-cover ${small ? "rounded-xl" : "rounded-t-2xl"}`} /> : <div role="img" aria-label={`Chưa tải được ảnh ${name}`} className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground"><ImageIcon aria-hidden="true" className="size-6" />{!small && <span className="text-xs">Chưa tải được ảnh</span>}</div>}</div>
}

function ServiceSummary({ input, status }: { input: AdminServiceInput; status: Service["status"] }) {
  return <div className="min-w-0 space-y-5"><ServiceImage source={input.image} name={input.name} /><div className="flex min-w-0 flex-wrap items-center justify-between gap-3"><h3 className="m-0 min-w-0 break-words text-lg leading-7 font-semibold">{input.name}</h3><ServiceStatus status={status} /></div><p className="m-0 break-words text-sm leading-7 text-muted-foreground">{input.shortDesc}</p><p className="m-0 break-words text-xl font-semibold text-primary tabular-nums">{money(input.price)} <span className="text-sm font-normal text-muted-foreground">/ {input.unit}</span></p><dl className="m-0 grid min-w-0 gap-4 rounded-xl bg-slate-50 p-4 text-sm sm:grid-cols-2">{[["Nhóm dịch vụ", CATEGORY_LABEL[input.category]], ["Nhãn số lượng", input.quantityLabel], ["Số lượng tối thiểu", input.minQuantity], ["Số lượng mặc định", input.defaultQuantity], ["Phút / đơn vị", input.minutesPerUnit], ["Thời gian cố định", `${input.baseMinutes} phút`]].map(([label, value]) => <div key={label} className="min-w-0"><dt className="mb-1 text-xs text-muted-foreground">{label}</dt><dd className="m-0 break-words leading-7">{value}</dd></div>)}</dl><section className="min-w-0"><h4 className="m-0 mb-2 text-sm font-semibold">Giới thiệu dịch vụ</h4><p className="m-0 break-words text-sm leading-7 whitespace-pre-line text-muted-foreground">{input.description}</p></section>{[["Phạm vi công việc", input.scope], ["Bao gồm", input.included], ["Không bao gồm", input.excluded]].map(([label, items]) => <section key={String(label)} className="min-w-0"><h4 className="m-0 mb-2 text-sm font-semibold">{String(label)}</h4>{(items as string[]).length ? <ul className="m-0 grid gap-2 pl-5 text-sm leading-7 text-muted-foreground">{(items as string[]).map((item, index) => <li key={index} className="break-words">{item}</li>)}</ul> : <p className="m-0 text-sm leading-7 text-muted-foreground">Chưa có nội dung.</p>}</section>)}</div>
}

export function AdminServices() {
  const { s, user, role } = useData()
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState("")
  const [category, setCategory] = useState("")
  const [page, setPage] = useState(0)
  const [dialog, setDialog] = useState<DialogKind | null>(null)
  const [targetId, setTargetId] = useState("")
  const [desiredStatus, setDesiredStatus] = useState<Service["status"]>("inactive")
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [errors, setErrors] = useState<AdminServiceErrors>({})
  const [confirming, setConfirming] = useState(false)
  const [submitError, setSubmitError] = useState("")
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const latestState = useRef(s)
  latestState.current = s
  const openedState = useRef<AppState | null>(null)
  const submitting = useRef(false)
  const mounted = useRef(true)
  const formScope = useRef<HTMLDivElement>(null)
  const pageElement = useRef<HTMLDivElement>(null)
  const feedbackElement = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLElement | null>(null)
  const focusIntent = useRef<"trigger" | "feedback" | "invalid" | "form" | null>(null)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useLayoutEffect(() => {
    if (busy || !focusIntent.current) return
    if (dialog) {
      const target = focusIntent.current === "invalid" ? formScope.current?.querySelector<HTMLElement>('[aria-invalid="true"]') : focusIntent.current === "form" ? formScope.current?.querySelector<HTMLElement>('[name="name"]') : null
      if (target) { target.focus(); focusIntent.current = null }
      return
    }
    const target = focusIntent.current === "feedback" ? feedbackElement.current : trigger.current?.isConnected && !trigger.current.hasAttribute("disabled") ? trigger.current : pageElement.current
    if (target) { target.focus({ preventScroll: focusIntent.current === "trigger" }); focusIntent.current = null }
  }, [dialog, busy, errors, feedback, confirming])

  if (!s) return <AdminLoading />
  if (!user || role !== "admin" || user.role !== "admin" || user.status !== "active") return <AdminEmpty title="Vui lòng đăng nhập tài khoản quản trị viên" />
  if (getAdminCommerceDataError(s)) return <AdminError title="Chưa thể tải danh sách dịch vụ" />
  const normalizedQuery = normalizeSearch(query)
  const filtered = s.services.filter((service) => (!normalizedQuery || normalizeSearch(`${service.name} ${service.shortDesc}`).includes(normalizedQuery)) && (!status || service.status === status) && (!category || service.category === category))
  const pages = Math.ceil(filtered.length / PAGE_SIZE)
  const currentPage = Math.min(page, Math.max(0, pages - 1))
  const displayed = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)
  const target = s.services.find((service) => service.id === targetId)
  const references = (id: string) => s.orders.filter((order) => order.serviceId === id).length
  const hasFilters = Boolean(query || status || category)
  const clearFilters = () => { setQuery(""); setStatus(""); setCategory(""); setPage(0) }

  function open(kind: DialogKind, element: HTMLElement, service?: Service) {
    if (submitting.current) return
    trigger.current = element
    openedState.current = s
    focusIntent.current = null
    setTargetId(service?.id || "")
    setDraft(service ? valuesOf(service) : { ...EMPTY_DRAFT })
    setDesiredStatus(service?.status === "inactive" ? "active" : "inactive")
    setErrors({}); setSubmitError(""); setConfirming(false); setFeedback(null); setDialog(kind)
  }

  function close() {
    if (submitting.current) return
    focusIntent.current = "trigger"
    setDialog(null); setConfirming(false); setErrors({}); setSubmitError("")
  }

  function change(key: keyof Draft, value: string) {
    setDraft((previous) => ({ ...previous, [key]: value }))
    setErrors((previous) => ({ ...previous, [key]: undefined, ...(key === "minQuantity" ? { defaultQuantity: undefined } : {}) }))
    setSubmitError("")
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current || !dialog) return
    const state = latestState.current
    if (!state) { setSubmitError("Chưa đọc được dữ liệu dịch vụ. Vui lòng tải lại trang."); return }
    const current = state.services.find((service) => service.id === targetId)
    if (dialog !== "create" && !current) { setSubmitError("Dịch vụ không còn trong danh sách. Nội dung đang nhập được giữ để kiểm tra."); return }
    if (dialog === "view" && current) { openedState.current = state; setDraft(valuesOf(current)); setDialog("edit"); setErrors({}); setSubmitError(""); focusIntent.current = "form"; return }
    if (dialog === "create" || dialog === "edit") {
      const invalid = validateAdminService(inputOf(draft))
      setErrors(invalid); setSubmitError("")
      if (Object.keys(invalid).length) { focusIntent.current = "invalid"; return }
      if (!confirming) { setConfirming(true); return }
    }
    if (dialog === "status" && current?.status === desiredStatus) { setSubmitError("Trạng thái dịch vụ đã thay đổi. Vui lòng mở lại hộp thoại."); return }
    submitting.current = true
    setBusy(true)
    try {
      const expected = openedState.current || state
      const result: AdminServiceResult = dialog === "create" || dialog === "edit" ? await adminServiceService.save(dialog === "create" ? state : expected, inputOf(draft), dialog === "edit" ? targetId : undefined) : dialog === "status" ? await adminServiceService.setStatus(expected, targetId, desiredStatus) : await adminServiceService.remove(expected, targetId)
      if (!mounted.current) return
      if (!result.ok) {
        setSubmitError(result.error)
        if (dialog === "create" || dialog === "edit") setConfirming(false)
        if (result.field) { setErrors((previous) => ({ ...previous, [result.field!]: result.error })); focusIntent.current = "invalid" }
        return
      }
      const message = dialog === "create" ? "Đã thêm dịch vụ trên trình duyệt này." : dialog === "edit" ? "Đã lưu dịch vụ trên trình duyệt này." : dialog === "delete" ? "Đã xóa dịch vụ trên trình duyệt này." : desiredStatus === "inactive" ? "Đã ngừng cung cấp dịch vụ trên trình duyệt này." : "Đã mở lại dịch vụ trên trình duyệt này."
      setFeedback(result.persistence === "local" ? { message } : { message: "Thay đổi dịch vụ chỉ được giữ trong phiên hiện tại; trình duyệt chưa lưu được trên thiết bị.", warning: true })
      focusIntent.current = "feedback"
      setDialog(null); setConfirming(false); setErrors({}); setSubmitError("")
    } catch { if (mounted.current) setSubmitError("Chưa thể lưu thay đổi. Nội dung đã nhập vẫn được giữ để thử lại.") }
    finally { submitting.current = false; if (mounted.current) setBusy(false) }
  }

  const dialogTitle = dialog === "view" ? "Chi tiết dịch vụ" : dialog === "status" ? desiredStatus === "inactive" ? "Ngừng cung cấp dịch vụ" : "Mở lại dịch vụ" : dialog === "delete" ? "Xóa dịch vụ" : confirming ? dialog === "create" ? "Xác nhận thêm dịch vụ" : "Xác nhận cập nhật dịch vụ" : dialog === "create" ? "Thêm dịch vụ" : "Chỉnh sửa dịch vụ"
  const submitLabel = dialog === "view" ? "Chỉnh sửa dịch vụ" : dialog === "status" ? desiredStatus === "inactive" ? "Xác nhận ngừng" : "Xác nhận mở lại" : dialog === "delete" ? "Xác nhận xóa" : confirming ? dialog === "create" ? "Xác nhận thêm dịch vụ" : "Xác nhận lưu dịch vụ" : "Kiểm tra thông tin"
  const numericFields = [{ key: "price", label: "Giá (₫)" }, { key: "minQuantity", label: "Số lượng tối thiểu" }, { key: "defaultQuantity", label: "Số lượng mặc định" }, { key: "minutesPerUnit", label: "Phút / đơn vị" }, { key: "baseMinutes", label: "Thời gian cố định (phút)" }] as const

  return <div ref={pageElement} tabIndex={-1} className="min-w-0 space-y-6 outline-none">
    <AdminPageHeader title="Quản lý dịch vụ" description="Quản lý danh mục, thông tin dịch vụ, giá tham khảo và trạng thái cung cấp." action={<Button className="min-h-11 w-full sm:w-auto" onClick={(event) => open("create", event.currentTarget)}><PlusIcon aria-hidden="true" />Thêm dịch vụ</Button>} />
    {feedback && <div ref={feedbackElement} role="status" tabIndex={-1} className={`flex min-w-0 items-start gap-3 rounded-xl border p-4 text-sm leading-7 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${feedback.warning ? "border-amber-200 bg-amber-50 text-amber-900" : "border-blue-100 bg-blue-50 text-blue-900"}`}><InfoIcon aria-hidden="true" className="mt-1 size-5 shrink-0" /><p className="m-0 min-w-0 break-words">{feedback.message}</p></div>}
    <section aria-label="Tìm và lọc dịch vụ" className="min-w-0 rounded-2xl border border-border bg-white p-5 sm:p-6"><div className="grid min-w-0 gap-5 sm:grid-cols-2 xl:grid-cols-3"><Field label="Tìm kiếm dịch vụ"><Input type="search" placeholder="Tên hoặc mô tả dịch vụ..." value={query} onChange={(event) => { setQuery(event.target.value); setPage(0) }} /></Field><Field label="Nhóm dịch vụ"><select value={category} onChange={(event) => { setCategory(event.target.value); setPage(0) }}><option value="">Tất cả nhóm dịch vụ</option>{Object.entries(CATEGORY_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field><Field label="Trạng thái dịch vụ"><select value={status} onChange={(event) => { setStatus(event.target.value); setPage(0) }}><option value="">Tất cả trạng thái</option><option value="active">Hoạt động</option><option value="inactive">Ngừng cung cấp</option></select></Field></div><div className="mt-5 flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between"><p role="status" aria-live="polite" className="m-0 text-sm leading-6 text-muted-foreground"><strong className="font-semibold text-foreground">{filtered.length}</strong> dịch vụ{hasFilters ? ` phù hợp / ${s.services.length} dịch vụ hiện có` : " hiện có"}</p><Button variant="outline" className="min-h-11 w-full sm:w-auto" disabled={!hasFilters} onClick={clearFilters}><RotateCcwIcon aria-hidden="true" />Xóa bộ lọc</Button></div></section>

    {filtered.length === 0 ? <AdminEmpty title={s.services.length ? "Không tìm thấy dịch vụ phù hợp" : "Chưa có dịch vụ"} description={s.services.length ? "Thử từ khóa khác hoặc điều chỉnh nhóm và trạng thái dịch vụ." : "Danh sách hiển thị các dịch vụ hiện có trong nguồn dữ liệu."} action={hasFilters ? <Button variant="outline" className="min-h-11" onClick={clearFilters}>Xóa bộ lọc</Button> : undefined} /> : <>
      <div className="grid min-w-0 gap-5 sm:grid-cols-2 xl:hidden">{displayed.map((service) => { const count = references(service.id); return <Card key={service.id} className="min-w-0 gap-0 rounded-2xl py-0 shadow-none ring-border"><ServiceImage source={service.image} name={service.name} /><CardContent className="flex min-w-0 flex-1 flex-col gap-4 p-5"><div className="flex flex-wrap items-center justify-between gap-3"><span className="text-xs text-muted-foreground">{CATEGORY_LABEL[service.category]}</span><ServiceStatus status={service.status} /></div><div className="min-w-0"><h2 className="m-0 break-words text-base leading-7 font-semibold">{service.name}</h2><p className="m-0 mt-2 break-words text-sm leading-7 text-muted-foreground">{service.shortDesc}</p></div><p className="m-0 mt-auto break-words text-lg font-semibold text-primary tabular-nums">{money(service.price)} <span className="text-xs font-normal text-muted-foreground">/ {service.unit}</span></p><div className="grid min-w-0 grid-cols-2 gap-2 border-t border-border pt-4"><Button variant="outline" className="col-span-2 min-h-11 w-full" aria-label={`Xem dịch vụ ${service.name}`} onClick={(event) => open("view", event.currentTarget, service)}>Xem chi tiết</Button><Button variant="outline" className="min-h-11" aria-label={`Sửa dịch vụ ${service.name}`} onClick={(event) => open("edit", event.currentTarget, service)}><PencilIcon aria-hidden="true" />Sửa</Button><Button variant="outline" className="min-h-11" aria-label={`${service.status === "active" ? "Ngừng" : "Mở lại"} dịch vụ ${service.name}`} onClick={(event) => open("status", event.currentTarget, service)}>{service.status === "active" ? "Ngừng" : "Mở lại"}</Button><Button variant="destructive" className="col-span-2 min-h-11" disabled={count > 0} aria-label={`Xóa dịch vụ ${service.name}`} onClick={(event) => open("delete", event.currentTarget, service)}>Xóa dịch vụ</Button></div>{count > 0 && <p className="m-0 text-xs leading-6 text-muted-foreground">Có {count} đơn sử dụng; giữ dịch vụ để bảo toàn đơn đã lưu.</p>}</CardContent></Card> })}</div>
      <div className="hidden min-w-0 rounded-2xl border border-border bg-white xl:block"><table className="w-full table-fixed border-collapse text-left text-sm"><caption className="sr-only">Danh mục dịch vụ CleanHome</caption><colgroup><col className="w-[40%]" /><col className="w-[18%]" /><col className="w-[17%]" /><col className="w-[25%]" /></colgroup><thead className="bg-slate-50 text-xs text-muted-foreground"><tr>{["Dịch vụ", "Giá tham khảo", "Trạng thái", "Thao tác"].map((label) => <th key={label} scope="col" className="px-4 py-4 font-semibold first:rounded-tl-2xl last:rounded-tr-2xl">{label}</th>)}</tr></thead><tbody>{displayed.map((service) => { const count = references(service.id); return <tr key={service.id} className="border-t border-border transition-colors hover:bg-slate-50/70"><td className="px-4 py-5 align-top"><div className="flex min-w-0 items-start gap-4"><ServiceImage source={service.image} name={service.name} small /><div className="min-w-0"><h2 className="m-0 break-words text-sm leading-7 font-semibold">{service.name}</h2><p className="m-0 mt-1 text-xs leading-6 text-muted-foreground">{CATEGORY_LABEL[service.category]}</p><p className="m-0 mt-2 break-words text-xs leading-6 text-muted-foreground">{service.shortDesc}</p></div></div></td><td className="px-4 py-5 align-top"><p className="m-0 break-words font-semibold text-primary tabular-nums">{money(service.price)}</p><p className="m-0 mt-2 text-xs text-muted-foreground">/ {service.unit}</p></td><td className="px-4 py-5 align-top"><ServiceStatus status={service.status} /></td><td className="px-4 py-3 align-top"><div className="flex min-w-0 flex-wrap gap-2"><Button variant="outline" className="min-h-11" aria-label={`Xem dịch vụ ${service.name}`} onClick={(event) => open("view", event.currentTarget, service)}>Chi tiết</Button><Button variant="outline" className="min-h-11" aria-label={`Sửa dịch vụ ${service.name}`} onClick={(event) => open("edit", event.currentTarget, service)}>Sửa</Button><Button variant="outline" className="min-h-11" aria-label={`${service.status === "active" ? "Ngừng" : "Mở lại"} dịch vụ ${service.name}`} onClick={(event) => open("status", event.currentTarget, service)}>{service.status === "active" ? "Ngừng" : "Mở lại"}</Button><Button variant="destructive" className="min-h-11" disabled={count > 0} aria-label={`Xóa dịch vụ ${service.name}`} onClick={(event) => open("delete", event.currentTarget, service)}>Xóa</Button></div>{count > 0 && <p className="m-0 mt-2 text-xs leading-6 text-muted-foreground">{count} đơn sử dụng · không được xóa</p>}</td></tr> })}</tbody></table></div>
      {pages > 1 && <nav aria-label="Phân trang dịch vụ" className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><p className="m-0 text-sm text-muted-foreground">{currentPage * PAGE_SIZE + 1}–{Math.min((currentPage + 1) * PAGE_SIZE, filtered.length)} / {filtered.length} dịch vụ</p><div className="flex w-full flex-wrap items-center justify-between gap-3 sm:w-auto"><Button variant="outline" className="min-h-11" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Trước</Button><span aria-live="polite" className="text-sm text-muted-foreground">Trang {currentPage + 1} / {pages}</span><Button variant="outline" className="min-h-11" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>Sau</Button></div></nav>}
    </>}

    {dialog && <AdminDialog title={dialogTitle} busy={busy} error={submitError} isBusy={() => submitting.current} close={close} submit={submit} submitLabel={submitLabel}><div ref={formScope} className="min-w-0">
      {dialog === "view" ? target ? <ServiceSummary input={target} status={target.status} /> : <p role="alert" className="m-0 text-sm text-destructive">Dịch vụ không còn trong danh sách.</p> : dialog === "status" || dialog === "delete" ? <div className="min-w-0 space-y-4"><h3 className="m-0 break-words text-base leading-7 font-semibold">{target?.name || "Dịch vụ không còn trong danh sách"}</h3><p className="m-0 rounded-xl bg-slate-50 p-4 text-sm leading-7">{dialog === "delete" ? "Bạn xác nhận xóa dịch vụ chưa có đơn sử dụng? Thao tác xóa không có chức năng hoàn tác trong giao diện hiện tại." : `Bạn xác nhận chuyển dịch vụ sang trạng thái ${desiredStatus === "active" ? "Hoạt động" : "Ngừng cung cấp"}? Thông tin các đơn đã lưu được giữ nguyên.`}</p>{dialog === "delete" && references(targetId) > 0 && <p role="alert" className="m-0 text-sm leading-7 text-destructive">Dịch vụ đã có đơn sử dụng, không được xóa.</p>}</div> : confirming ? <div className="min-w-0 space-y-5"><p className="m-0 flex items-start gap-2 text-sm leading-7 text-muted-foreground"><CheckIcon aria-hidden="true" className="mt-1 size-5 shrink-0 text-primary" />Kiểm tra thông tin dịch vụ trước khi xác nhận.</p><ServiceSummary input={inputOf(draft)} status={target?.status || "active"} /><p className="m-0 rounded-xl bg-blue-50 p-4 text-xs leading-7 text-blue-900">Giá và thời lượng của các đơn đã lưu được giữ nguyên.</p><Button type="button" variant="outline" className="min-h-11 w-full sm:w-auto" onClick={() => { setConfirming(false); setSubmitError(""); focusIntent.current = "form" }}>Sửa lại thông tin</Button></div> : <div className="min-w-0 space-y-6">
        <section className="grid min-w-0 gap-5 sm:grid-cols-2" aria-label="Thông tin dịch vụ"><div className="min-w-0 sm:col-span-2"><Field label="Tên dịch vụ" error={errors.name}><Input name="name" required maxLength={120} value={draft.name} onChange={(event) => change("name", event.target.value)} /></Field></div><div className="min-w-0 sm:col-span-2"><Field label="Nhóm dịch vụ" error={errors.category}><select name="category" value={draft.category} onChange={(event) => change("category", event.target.value)}>{Object.entries(CATEGORY_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field></div><div className="min-w-0 sm:col-span-2"><Field label="Mô tả ngắn" error={errors.shortDesc}><Textarea name="shortDesc" required rows={2} maxLength={300} value={draft.shortDesc} onChange={(event) => change("shortDesc", event.target.value)} /></Field></div><div className="min-w-0 sm:col-span-2"><Field label="Mô tả chi tiết" error={errors.description}><Textarea name="description" required rows={4} maxLength={5000} value={draft.description} onChange={(event) => change("description", event.target.value)} /></Field></div><Field label="Đơn vị tính" error={errors.unit}><Input name="unit" required maxLength={40} value={draft.unit} onChange={(event) => change("unit", event.target.value)} /></Field><Field label="Nhãn số lượng" error={errors.quantityLabel}><Input name="quantityLabel" required maxLength={80} value={draft.quantityLabel} onChange={(event) => change("quantityLabel", event.target.value)} /></Field></section>
        <section className="grid min-w-0 gap-5 border-t border-border pt-5 sm:grid-cols-2" aria-label="Giá và thời lượng">{numericFields.map(({ key, label }) => <Field key={key} label={label} error={errors[key]}><Input name={key} type="number" step="1" required min={key === "baseMinutes" ? 0 : 1} value={draft[key]} onChange={(event) => change(key, event.target.value)} /></Field>)}</section>
        <section className="min-w-0 space-y-5 border-t border-border pt-5" aria-label="Ảnh và phạm vi dịch vụ"><Field label="Ảnh dịch vụ" error={errors.image}><select name="image" value={draft.image} onChange={(event) => change("image", event.target.value)}>{!IMAGE_OPTIONS.some((option) => option.value === draft.image) && <option value={draft.image}>Ảnh đang sử dụng</option>}{IMAGE_OPTIONS.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}</select></Field><ServiceImage source={draft.image} name={draft.name || "dịch vụ đang chỉnh sửa"} />{[{ key: "scope", label: "Phạm vi (mỗi dòng một mục)" }, { key: "included", label: "Bao gồm (mỗi dòng một mục)" }, { key: "excluded", label: "Không bao gồm (mỗi dòng một mục)" }].map(({ key, label }) => <Field key={key} label={label} error={errors[key as "scope" | "included" | "excluded"]}><Textarea name={key} rows={3} required={key !== "excluded"} maxLength={15050} value={draft[key as "scope" | "included" | "excluded"]} onChange={(event) => change(key as "scope" | "included" | "excluded", event.target.value)} /></Field>)}</section>
      </div>}
    </div></AdminDialog>}
  </div>
}
