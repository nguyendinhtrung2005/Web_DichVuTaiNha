"use client"

import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from "react"
import { AreaLink as Link } from "@/components/shared/area-routes"
import { CheckIcon, EyeIcon, EyeOffIcon, InfoIcon, MessageSquareIcon, RotateCcwIcon, StarIcon } from "lucide-react"
import type { AppState, Review } from "@/lib/types"
import { Field, useData } from "../../common"
import { Button } from "../ui/button"
import { Card, CardContent } from "../ui/card"
import { Input } from "../ui/input"
import { Textarea } from "../ui/textarea"
import { ToneBadge } from "../shared/status-badge"
import { AdminDialog } from "./admin-dialog"
import { AdminEmpty, AdminError, AdminLoading, AdminPageHeader, normalizeSearch } from "./admin-shared"
import { formatAdminDateTime, getAdminCommerceDataError } from "./admin-display"
import { adminReviewService } from "./admin-review-service"

const PAGE_SIZE = 8
type Feedback = { message: string; warning?: boolean }

function ReviewBadge({ review }: { review: Review }) {
  return <ToneBadge tone={review.hidden ? "warning" : "success"}>{review.hidden ? "Đang ẩn" : "Đang hiển thị"}</ToneBadge>
}

function Rating({ value, label }: { value: number; label: string }) {
  return <div className="min-w-0"><span className="mb-1.5 block text-xs text-muted-foreground">{label}</span><div className="flex flex-wrap items-center gap-2" aria-label={`${label}: ${value} trên 5 sao`}><span className="inline-flex shrink-0 gap-0.5" aria-hidden="true">{[1, 2, 3, 4, 5].map((star) => <StarIcon key={star} className={`size-4 ${star <= value ? "fill-amber-400 text-amber-400" : "text-slate-200"}`} />)}</span><strong className="text-sm">{value}/5</strong></div></div>
}

function ReviewItem({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return <div className={`min-w-0 ${wide ? "sm:col-span-2" : ""}`}><dt className="mb-1.5 text-xs text-muted-foreground">{label}</dt><dd className="m-0 break-words text-sm leading-7">{children}</dd></div>
}

function staffName(state: AppState, review: Review) {
  return review.staffId ? state.users.find((user) => user.id === review.staffId)?.name || "Không tìm thấy nhân viên liên quan" : "Chưa có nhân viên trong bản ghi"
}

function ReviewDetail({ review, state }: { review: Review; state: AppState }) {
  const customer = state.users.find((user) => user.id === review.customerId)
  const service = state.services.find((item) => item.id === review.serviceId)
  const order = state.orders.find((item) => item.id === review.orderId)
  return <div className="min-w-0 space-y-5">
    <div className="flex min-w-0 items-start gap-3 rounded-xl bg-blue-50/60 p-4"><span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white text-primary"><MessageSquareIcon aria-hidden="true" className="size-5" /></span><div className="min-w-0"><h3 className="m-0 break-words text-base leading-7 font-semibold">{service?.name || "Không tìm thấy dịch vụ liên quan"}</h3><p className="m-0 mt-1 break-words text-sm leading-7 text-muted-foreground">{customer?.name || "Không tìm thấy khách hàng liên quan"}</p><div className="mt-2"><ReviewBadge review={review} /></div></div></div>
    <div className="grid min-w-0 gap-4 sm:grid-cols-2"><Rating label="Đánh giá dịch vụ" value={review.serviceRating} /><Rating label="Đánh giá nhân viên" value={review.staffRating} /></div>
    <section className="min-w-0 rounded-xl border border-border p-4"><h3 className="m-0 text-sm font-semibold">Nhận xét của khách hàng</h3><p className="m-0 mt-3 break-words text-sm leading-7 whitespace-pre-line">{review.comment.trim() ? review.comment : "Khách hàng không để lại nhận xét."}</p></section>
    {review.hidden && <section className="min-w-0 rounded-xl border border-amber-200 bg-amber-50 p-4"><h3 className="m-0 text-sm font-semibold text-amber-900">Lý do ẩn đã lưu</h3><p className="m-0 mt-2 break-words text-sm leading-7 whitespace-pre-line text-amber-900">{review.hiddenReason || "Bản ghi chưa có lý do ẩn."}</p></section>}
    <dl className="m-0 grid min-w-0 gap-5 sm:grid-cols-2"><ReviewItem label="Ngày đánh giá">{formatAdminDateTime(review.createdAt)}</ReviewItem><ReviewItem label="Nhân viên">{staffName(state, review)}</ReviewItem><ReviewItem label="Đơn dịch vụ" wide>{order ? <Link href={`/don/${order.id}`} className="inline-flex min-h-11 items-center rounded-lg font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">Xem đơn {order.code}</Link> : <span className="text-amber-800">Không tìm thấy đơn liên quan đến đánh giá này.</span>}</ReviewItem>{order && <><ReviewItem label="Người liên hệ">{order.contact.name}</ReviewItem><ReviewItem label="Số điện thoại">{order.contact.phone}</ReviewItem></>}</dl>
  </div>
}

export function AdminReviews() {
  const context = useData()
  const { s, user, role } = context
  const [query, setQuery] = useState("")
  const [stars, setStars] = useState("")
  const [service, setService] = useState("")
  const [staff, setStaff] = useState("")
  const [visibility, setVisibility] = useState("")
  const [sort, setSort] = useState("created-desc")
  const [page, setPage] = useState(0)
  const [dialog, setDialog] = useState<"view" | "visibility" | null>(null)
  const [targetId, setTargetId] = useState("")
  const [hideDesired, setHideDesired] = useState(true)
  const [reason, setReason] = useState("")
  const [reasonError, setReasonError] = useState("")
  const [submitError, setSubmitError] = useState("")
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const latest = useRef(context)
  latest.current = context
  const openedState = useRef<AppState | null>(null)
  const submitting = useRef(false)
  const mounted = useRef(true)
  const dialogTrigger = useRef<HTMLElement | null>(null)
  const formScope = useRef<HTMLDivElement>(null)
  const pageElement = useRef<HTMLDivElement>(null)
  const feedbackElement = useRef<HTMLDivElement>(null)
  const focusIntent = useRef<"trigger" | "feedback" | "invalid" | null>(null)

  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useLayoutEffect(() => {
    if (busy || !focusIntent.current) return
    if (dialog) { if (focusIntent.current === "invalid") { formScope.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(); focusIntent.current = null }; return }
    const target = focusIntent.current === "feedback" ? feedbackElement.current : dialogTrigger.current?.isConnected ? dialogTrigger.current : pageElement.current
    if (target) { target.focus({ preventScroll: focusIntent.current === "trigger" }); focusIntent.current = null }
  }, [busy, dialog, feedback, reasonError])

  if (!s) return <AdminLoading />
  if (!user || role !== "admin" || user.role !== "admin" || user.status !== "active") return <AdminEmpty title="Vui lòng đăng nhập tài khoản quản trị viên" />
  if (getAdminCommerceDataError(s)) return <AdminError title="Chưa thể tải dữ liệu đánh giá" />

  const normalizedQuery = normalizeSearch(query)
  const filtered = s.reviews.filter((review) => {
    const customer = s.users.find((item) => item.id === review.customerId)
    const serviceRecord = s.services.find((item) => item.id === review.serviceId)
    const order = s.orders.find((item) => item.id === review.orderId)
    return (!normalizedQuery || normalizeSearch(`${customer?.name || ""} ${serviceRecord?.name || ""} ${order?.code || ""} ${review.comment}`).includes(normalizedQuery)) && (!stars || review.serviceRating === Number(stars)) && (!service || review.serviceId === service) && (!staff || review.staffId === staff) && (!visibility || review.hidden === (visibility === "hidden"))
  }).sort((a, b) => (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * (sort === "created-asc" ? 1 : -1))
  const pages = Math.ceil(filtered.length / PAGE_SIZE)
  const currentPage = Math.min(page, Math.max(0, pages - 1))
  const displayed = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)
  const target = s.reviews.find((review) => review.id === targetId)
  const hasFilters = Boolean(query || stars || service || staff || visibility || sort !== "created-desc")
  const missingServiceIds = [...new Set(s.reviews.map((review) => review.serviceId).filter((id) => !s.services.some((item) => item.id === id)))]
  const missingStaffIds = [...new Set(s.reviews.map((review) => review.staffId).filter((id): id is string => Boolean(id && !s.users.some((item) => item.id === id))))]
  const clearFilters = () => { setQuery(""); setStars(""); setService(""); setStaff(""); setVisibility(""); setSort("created-desc"); setPage(0) }
  const closeDialog = () => { if (submitting.current) return; focusIntent.current = "trigger"; setDialog(null); setSubmitError(""); setReasonError("") }
  const openDialog = (review: Review, kind: "view" | "visibility", trigger: HTMLElement) => { if (submitting.current) return; openedState.current = s; dialogTrigger.current = trigger; setTargetId(review.id); setHideDesired(!review.hidden); setReason(""); setReasonError(""); setSubmitError(""); setFeedback(null); setDialog(kind) }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submitting.current) return
    const current = latest.current
    if (!current.s) { setSubmitError("Chưa thể đọc dữ liệu. Vui lòng tải lại trang."); return }
    if (getAdminCommerceDataError(current.s)) { setSubmitError("Dữ liệu đã thay đổi và chưa thể đọc đầy đủ. Vui lòng tải lại trang."); return }
    const review = current.s.reviews.find((item) => item.id === targetId)
    if (dialog === "view") { if (review) { openedState.current = current.s; setHideDesired(!review.hidden); setDialog("visibility"); setSubmitError("") } else closeDialog(); return }
    const actor = current.s.users.find((item) => item.id === current.s.session?.userId)
    if (current.role !== "admin" || current.user?.id !== actor?.id || current.s.session?.role !== "admin" || actor?.role !== "admin" || actor.status !== "active") { setSubmitError("Bạn không còn quyền quản lý đánh giá. Vui lòng đăng nhập lại."); return }
    if (!review || review.hidden === hideDesired) { setSubmitError("Đánh giá đã thay đổi hoặc không còn trong danh sách. Vui lòng kiểm tra lại."); return }
    const cleanReason = reason.trim()
    const error = hideDesired && !cleanReason ? "Vui lòng nhập lý do ẩn đánh giá." : hideDesired && cleanReason.length > 2000 ? "Lý do ẩn không được vượt quá 2.000 ký tự." : ""
    setReasonError(error)
    if (error) { focusIntent.current = "invalid"; formScope.current?.querySelector<HTMLElement>('[name="review-hidden-reason"]')?.focus(); return }
    submitting.current = true
    setBusy(true)
    setSubmitError("")
    try {
      const result = await adminReviewService.setVisibility(openedState.current || current.s, targetId, hideDesired, cleanReason)
      if (!mounted.current) return
      if (!result.ok) { setSubmitError(result.error); return }
      focusIntent.current = "feedback"
      setDialog(null)
      setReason("")
      setFeedback(result.persistence === "local" ? { message: `Đã lưu trạng thái ${hideDesired ? "ẩn" : "hiển thị"} đánh giá trên trình duyệt này.` } : { message: `Đã ${hideDesired ? "ẩn" : "hiện"} đánh giá trong phiên hiện tại. Trình duyệt chưa lưu được thay đổi; tải lại trang có thể mất dữ liệu.`, warning: true })
    } catch { if (mounted.current) setSubmitError("Chưa thể cập nhật đánh giá. Vui lòng thử lại.") }
    finally { submitting.current = false; if (mounted.current) setBusy(false) }
  }

  const actionsFor = (review: Review) => <div className="flex min-w-0 flex-wrap gap-2"><Button type="button" variant="outline" size="sm" className="min-h-11 max-w-full whitespace-normal" disabled={busy} onClick={(event) => openDialog(review, "view", event.currentTarget)} aria-label={`Xem đánh giá ${s.orders.find((order) => order.id === review.orderId)?.code || review.id}`}>Xem chi tiết</Button><Button type="button" variant="outline" size="sm" className="min-h-11 max-w-full whitespace-normal" disabled={busy} onClick={(event) => openDialog(review, "visibility", event.currentTarget)}>{review.hidden ? <EyeIcon aria-hidden="true" className="size-4" /> : <EyeOffIcon aria-hidden="true" className="size-4" />}{review.hidden ? "Hiện đánh giá" : "Ẩn đánh giá"}</Button></div>

  return <div ref={pageElement} tabIndex={-1} className="min-w-0 focus:outline-none">
    <AdminPageHeader title="Quản lý đánh giá" description="Đọc phản hồi của khách hàng và quản lý trạng thái hiển thị của từng đánh giá." />
    {feedback && <div ref={feedbackElement} tabIndex={-1} role="status" className={`mb-5 flex min-w-0 gap-3 rounded-xl border p-4 text-sm leading-7 outline-none focus-visible:ring-2 focus-visible:ring-ring ${feedback.warning ? "border-amber-200 bg-amber-50 text-amber-900" : "border-emerald-200 bg-emerald-50 text-emerald-900"}`}>{feedback.warning ? <InfoIcon aria-hidden="true" className="mt-1 size-5 shrink-0" /> : <CheckIcon aria-hidden="true" className="mt-1 size-5 shrink-0" />}<span className="min-w-0 break-words">{feedback.message}</span></div>}
    <Card className="mb-6 min-w-0 border-border/80 py-0 shadow-sm"><CardContent className="min-w-0 p-4 sm:p-5"><div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-4"><div className="min-w-0 sm:col-span-2"><Field label="Tìm đánh giá"><Input name="review-search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0) }} placeholder="Tên khách hàng, dịch vụ, mã đơn, nhận xét..." className="min-h-11 min-w-0" /></Field></div><Field label="Số sao dịch vụ"><select name="review-stars" value={stars} onChange={(event) => { setStars(event.target.value); setPage(0) }} className="min-h-11 w-full min-w-0 rounded-lg border border-input bg-white px-3 text-sm"><option value="">Tất cả số sao</option>{[5, 4, 3, 2, 1].map((value) => <option key={value} value={value}>{value} sao dịch vụ</option>)}</select></Field><Field label="Trạng thái hiển thị"><select name="review-visibility" value={visibility} onChange={(event) => { setVisibility(event.target.value); setPage(0) }} className="min-h-11 w-full min-w-0 rounded-lg border border-input bg-white px-3 text-sm"><option value="">Tất cả trạng thái</option><option value="public">Đang hiển thị</option><option value="hidden">Đang ẩn</option></select></Field><div className="min-w-0 xl:col-span-2"><Field label="Dịch vụ"><select name="review-service" value={service} onChange={(event) => { setService(event.target.value); setPage(0) }} className="min-h-11 w-full min-w-0 rounded-lg border border-input bg-white px-3 text-sm"><option value="">Tất cả dịch vụ</option>{s.services.map((item) => <option key={item.id} value={item.id}>{item.name}{item.status === "inactive" ? " (Ngừng cung cấp)" : ""}</option>)}{missingServiceIds.map((id) => <option key={id} value={id}>Dịch vụ không còn trong danh sách ({id})</option>)}</select></Field></div><Field label="Nhân viên"><select name="review-staff" value={staff} onChange={(event) => { setStaff(event.target.value); setPage(0) }} className="min-h-11 w-full min-w-0 rounded-lg border border-input bg-white px-3 text-sm"><option value="">Tất cả nhân viên</option>{s.users.filter((item) => item.role === "staff").map((item) => <option key={item.id} value={item.id}>{item.name}{item.status === "locked" ? " (Đã khóa)" : ""}</option>)}{missingStaffIds.map((id) => <option key={id} value={id}>Nhân viên không còn trong danh sách ({id})</option>)}</select></Field><Field label="Sắp xếp"><select name="review-sort" value={sort} onChange={(event) => { setSort(event.target.value); setPage(0) }} className="min-h-11 w-full min-w-0 rounded-lg border border-input bg-white px-3 text-sm"><option value="created-desc">Mới nhất trước</option><option value="created-asc">Cũ nhất trước</option></select></Field></div>{hasFilters && <div className="mt-4 flex justify-end"><Button type="button" variant="ghost" className="min-h-11 whitespace-normal" onClick={clearFilters}><RotateCcwIcon aria-hidden="true" className="size-4" />Xóa bộ lọc</Button></div>}</CardContent></Card>
    {displayed.length === 0 ? <AdminEmpty title={hasFilters ? "Không có đánh giá phù hợp" : "Chưa có đánh giá"} description={hasFilters ? "Thử tìm bằng tên khách hàng, dịch vụ hoặc điều chỉnh bộ lọc." : "Phản hồi thực tế của khách hàng sẽ xuất hiện khi khách hàng gửi đánh giá."} action={hasFilters ? <Button type="button" variant="outline" className="min-h-11" onClick={clearFilters}>Xóa bộ lọc</Button> : undefined} /> : <>
      <div className="mb-3 flex min-w-0 flex-wrap items-center justify-between gap-2 text-sm"><h2 className="m-0 text-base font-semibold">Phản hồi của khách hàng</h2><span className="text-muted-foreground">{filtered.length} kết quả</span></div>
      <Card className="hidden min-w-0 border-border/80 py-0 shadow-sm xl:block"><CardContent className="min-w-0 p-0"><table className="w-full table-fixed text-left text-sm"><thead className="border-b border-border bg-slate-50/80 text-xs text-muted-foreground"><tr><th scope="col" className="w-[18%] p-4 font-medium">Khách hàng / Ngày đánh giá</th><th scope="col" className="w-[21%] p-4 font-medium">Dịch vụ / Nhân viên</th><th scope="col" className="w-[25%] p-4 font-medium">Đánh giá / Nhận xét</th><th scope="col" className="w-[15%] p-4 font-medium">Hiển thị</th><th scope="col" className="w-[21%] p-4 font-medium">Thao tác</th></tr></thead><tbody className="divide-y divide-border">{displayed.map((review) => { const customer = s.users.find((item) => item.id === review.customerId); const serviceRecord = s.services.find((item) => item.id === review.serviceId); const order = s.orders.find((item) => item.id === review.orderId); return <tr key={review.id} className="align-top transition-colors hover:bg-blue-50/35"><td className="p-4"><strong className="block break-words">{customer?.name || "Không tìm thấy khách hàng"}</strong><span className="mt-2 block text-xs leading-6 text-muted-foreground">{formatAdminDateTime(review.createdAt)}</span></td><td className="p-4"><span className="block break-words font-medium">{serviceRecord?.name || "Không tìm thấy dịch vụ"}</span><span className="mt-1 block break-words text-xs leading-6 text-muted-foreground">{staffName(s, review)}</span><span className="mt-2 block break-words text-xs text-muted-foreground">{order?.code || "Không tìm thấy đơn liên quan"}</span></td><td className="p-4"><div className="grid gap-3"><Rating label="Dịch vụ" value={review.serviceRating} /><Rating label="Nhân viên" value={review.staffRating} /></div><p className="m-0 mt-3 line-clamp-3 break-words text-sm leading-7 whitespace-pre-line">{review.comment.trim() ? review.comment : "Không có nhận xét."}</p></td><td className="p-4"><ReviewBadge review={review} />{review.hidden && <p className="m-0 mt-2 line-clamp-3 break-words text-xs leading-6 text-muted-foreground">{review.hiddenReason || "Chưa có lý do ẩn"}</p>}</td><td className="p-4">{actionsFor(review)}</td></tr> })}</tbody></table></CardContent></Card>
      <div className="grid min-w-0 gap-4 md:grid-cols-2 xl:hidden">{displayed.map((review) => { const customer = s.users.find((item) => item.id === review.customerId); const serviceRecord = s.services.find((item) => item.id === review.serviceId); const order = s.orders.find((item) => item.id === review.orderId); return <Card key={review.id} className="min-w-0 border-border/80 py-0 shadow-sm"><CardContent className="flex h-full min-w-0 flex-col gap-4 p-5"><div className="min-w-0"><h3 className="m-0 break-words text-base font-semibold">{customer?.name || "Không tìm thấy khách hàng"}</h3><p className="m-0 mt-1 break-words text-xs leading-6 text-muted-foreground">{formatAdminDateTime(review.createdAt)} · {order?.code || "Không tìm thấy đơn liên quan"}</p></div><div className="flex flex-wrap gap-2"><ReviewBadge review={review} /></div><dl className="m-0 grid min-w-0 gap-3"><ReviewItem label="Dịch vụ">{serviceRecord?.name || "Không tìm thấy dịch vụ"}</ReviewItem><ReviewItem label="Nhân viên">{staffName(s, review)}</ReviewItem></dl><div className="grid min-w-0 gap-3 sm:grid-cols-2"><Rating label="Dịch vụ" value={review.serviceRating} /><Rating label="Nhân viên" value={review.staffRating} /></div><p className="m-0 line-clamp-3 break-words text-sm leading-7 whitespace-pre-line">{review.comment.trim() ? review.comment : "Không có nhận xét."}</p>{review.hidden && <p className="m-0 line-clamp-3 break-words rounded-lg bg-amber-50 p-3 text-xs leading-6 text-amber-900">Lý do ẩn: {review.hiddenReason || "Chưa có lý do trong bản ghi"}</p>}<div className="mt-auto border-t border-border pt-4">{actionsFor(review)}</div></CardContent></Card> })}</div>
      <nav aria-label="Phân trang đánh giá" className="mt-5 flex min-w-0 flex-wrap items-center justify-between gap-3"><p className="m-0 text-sm text-muted-foreground">Trang {currentPage + 1}/{pages} · {filtered.length} kết quả</p><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" className="min-h-11" disabled={busy || currentPage === 0} onClick={() => setPage(currentPage - 1)}>Trước</Button><Button type="button" variant="outline" className="min-h-11" disabled={busy || currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>Sau</Button></div></nav>
    </>}
    {dialog && <AdminDialog key={`${targetId}-${dialog}`} title={dialog === "view" ? "Chi tiết đánh giá" : hideDesired ? "Ẩn đánh giá" : "Hiện đánh giá"} busy={busy} error={submitError} isBusy={() => submitting.current} close={closeDialog} submit={submit} submitLabel={dialog === "view" ? target ? target.hidden ? "Hiện đánh giá" : "Ẩn đánh giá" : "Đóng chi tiết" : hideDesired ? "Xác nhận ẩn đánh giá" : "Xác nhận hiện đánh giá"}>{target ? <>{dialog === "view" ? <ReviewDetail review={target} state={s} /> : <div ref={formScope} className="min-w-0 space-y-5"><p className="m-0 text-sm leading-7">{hideDesired ? "Đánh giá sẽ được đánh dấu ẩn trong dữ liệu quản trị trên trình duyệt này. Nội dung và số sao của khách hàng được giữ nguyên." : "Đánh giá sẽ được đánh dấu hiển thị trong dữ liệu quản trị trên trình duyệt này. Nội dung và số sao của khách hàng được giữ nguyên."}</p><div className="min-w-0 rounded-xl border border-border p-4"><p className="m-0 break-words text-sm font-semibold">{s.services.find((item) => item.id === target.serviceId)?.name || "Không tìm thấy dịch vụ liên quan"}</p><p className="m-0 mt-2 break-words text-sm leading-7 whitespace-pre-line">{target.comment.trim() ? target.comment : "Khách hàng không để lại nhận xét."}</p><div className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2"><Rating label="Dịch vụ" value={target.serviceRating} /><Rating label="Nhân viên" value={target.staffRating} /></div></div>{hideDesired && <Field label="Lý do ẩn đánh giá" hint="Bắt buộc, tối đa 2.000 ký tự." error={reasonError}><Textarea name="review-hidden-reason" value={reason} onChange={(event) => { setReason(event.target.value); if (reasonError) setReasonError("") }} rows={4} maxLength={2000} required className="min-h-28 min-w-0 resize-y" placeholder="Nhập lý do cần ẩn đánh giá..." /></Field>}{!hideDesired && target.hiddenReason && <p className="m-0 break-words text-sm leading-7 whitespace-pre-line text-muted-foreground">Lý do ẩn đã lưu: {target.hiddenReason}</p>}<p className="m-0 text-xs leading-6 text-muted-foreground">Thao tác ghi trạng thái hiển thị trong dữ liệu lưu trên trình duyệt.</p></div>}</> : <p className="m-0 text-sm leading-7">Đánh giá không còn trong danh sách. Vui lòng đóng hộp thoại và tải lại trang.</p>}</AdminDialog>}
  </div>
}
