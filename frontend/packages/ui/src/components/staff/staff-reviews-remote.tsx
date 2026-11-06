"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { defaultStaffStatisticsRange } from "./staff-work-statistics-model"
import { parseReviewsQuery } from "./staff-reviews-contract.mjs"
import { readStaffReviews, staffReviewsMessage, StaffReviewsError, type StaffReviewsPayload, type StaffReviewsQuery } from "./staff-reviews-remote-model"

type State = { data: StaffReviewsPayload } | { error: string; unavailable?: boolean } | null
const date = new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric" })
const number = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 })

/** API reviews never share the DEMO adapter, store or fixtures. React renders text only. */
export function StaffReviewsSection({ accountScope, checkSession }: { accountScope: string; checkSession: () => unknown }) {
  const [query, setQuery] = useState<StaffReviewsQuery>(() => ({ ...defaultStaffStatisticsRange(), rating: null, page: 1, pageSize: 10 }))
  const [draft, setDraft] = useState({ from: query.from, to: query.to, rating: "" }), [filterError, setFilterError] = useState("")
  const [state, setState] = useState<State>(null), [retry, setRetry] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => { setState({ error: "Hết thời gian tải đánh giá. Vui lòng thử lại." }); controller.abort() }, 20000)
    setState(null)
    void readStaffReviews(query, accountScope, controller.signal).then(data => {
      if (!controller.signal.aborted) setState({ data })
    }).catch(error => {
      if (controller.signal.aborted) return
      setState({ error: staffReviewsMessage(error), unavailable: error instanceof StaffReviewsError && error.code === "REVIEWS_NOT_AVAILABLE" })
      if (error instanceof StaffReviewsError && [401, 403].includes(error.status)) void checkSession()
    }).finally(() => window.clearTimeout(timer))
    return () => { controller.abort(); window.clearTimeout(timer) }
  }, [query, accountScope, checkSession, retry])
  const payload = state && "data" in state ? state.data : null
  const unavailable = Boolean(state && "error" in state && state.unavailable), filtersDisabled = !state || unavailable
  return <section className="staff-achievements-real space-y-4" aria-labelledby="staff-reviews-heading" data-staff-reviews="real" data-staff-reviews-state={!state ? "loading" : unavailable ? "unavailable" : "error" in state ? "error" : "ready"}>
    <div><h2 id="staff-reviews-heading">Đánh giá khách hàng</h2><p>Theo ngày gửi đánh giá, giờ Việt Nam. Chỉ hiển thị nhận xét được phép chia sẻ với bạn.</p></div>
    <form className="staff-performance-range" aria-label="Lọc đánh giá khách hàng" onSubmit={event => {
      event.preventDefault()
      if (filtersDisabled) return
      const params = new URLSearchParams({ from: draft.from, to: draft.to })
      if (draft.rating) params.set("rating", draft.rating)
      const parsed = parseReviewsQuery(params)
      if (!parsed) { setFilterError("Chọn khoảng ngày hợp lệ, tối đa 366 ngày, và số sao từ 1 đến 5."); return }
      setFilterError(""); setQuery(parsed)
    }}>
      <label>Từ ngày đánh giá<input type="date" min="1971-01-01" max="2099-12-31" required disabled={filtersDisabled} value={draft.from} onChange={e => setDraft(v => ({ ...v, from: e.target.value }))} /></label>
      <label>Đến ngày đánh giá<input type="date" min="1971-01-01" max="2099-12-31" required disabled={filtersDisabled} value={draft.to} onChange={e => setDraft(v => ({ ...v, to: e.target.value }))} /></label>
      <label>Số sao<select disabled={filtersDisabled} value={draft.rating} onChange={e => setDraft(v => ({ ...v, rating: e.target.value }))}><option value="">Tất cả số sao</option>{[5, 4, 3, 2, 1].map(s => <option value={s} key={s}>{s} sao</option>)}</select></label>
      <Button type="submit" disabled={filtersDisabled}>Lọc đánh giá</Button>{filterError && <p role="alert">{filterError}</p>}
    </form>
    {!state ? <p role="status" aria-busy="true">Đang kiểm tra dữ liệu đánh giá...</p>
      : "error" in state ? <div role={state.unavailable ? "status" : "alert"} data-staff-achievements-unavailable={state.unavailable ? "" : undefined}>
        {state.unavailable ? <><h3>Chưa có dữ liệu đánh giá</h3><p>Chức năng đánh giá hiện chưa được cung cấp. Chưa có điểm sao hoặc nhận xét để hiển thị.</p></> : <p>{state.error}</p>}
        <Button variant="outline" onClick={() => setRetry(v => v + 1)}>Thử tải đánh giá lại</Button>
      </div> : payload ? <>
        <p aria-live="polite">{payload.summary.total ? `${number.format(payload.summary.total)} đánh giá · Trung bình ${number.format(payload.summary.average!)} / 5 sao` : "Không có đánh giá nào khớp bộ lọc. Chưa đủ dữ liệu tính điểm trung bình."}</p>
        {payload.summary.total > 0 && <div aria-label="Phân bố đánh giá theo số sao">{[5, 4, 3, 2, 1].map(star => <div key={star} className="flex flex-wrap items-center gap-2"><span>{star} sao</span><meter min={0} max={payload.summary.total} value={payload.summary.distribution[String(star)]} aria-label={star + " sao: " + payload.summary.distribution[String(star)] + " đánh giá"} /><span>{number.format(payload.summary.distribution[String(star)])}</span></div>)}</div>}
        <ul className="staff-achievements-review-list">{payload.data.map(review => <li key={review.id}><Card><CardContent>
          <p aria-label={review.rating + " trên 5 sao"}>{review.rating} / 5 sao</p><time dateTime={review.createdAt}>{date.format(new Date(review.createdAt))}</time>
          <p className="whitespace-pre-wrap break-words">{review.comment || "Khách hàng không để lại nhận xét."}</p>{review.serviceLabel && <p className="break-words">{review.serviceLabel}</p>}
        </CardContent></Card></li>)}</ul>
        {payload.pagination.totalPages > 1 && <nav aria-label="Phân trang đánh giá" className="flex flex-wrap items-center gap-3">
          <Button variant="outline" disabled={query.page <= 1} onClick={() => setQuery(v => ({ ...v, page: v.page - 1 }))}>Trang trước</Button>
          <span aria-live="polite">Trang {query.page} / {payload.pagination.totalPages}</span>
          <Button variant="outline" disabled={query.page >= payload.pagination.totalPages} onClick={() => setQuery(v => ({ ...v, page: v.page + 1 }))}>Trang sau</Button>
        </nav>}
      </> : null}
    <p className="staff-achievements-muted">Huy hiệu và mục tiêu chính thức đang chờ quy chế phê duyệt. Điểm đánh giá không tự quy đổi thành thưởng.</p>
  </section>
}
