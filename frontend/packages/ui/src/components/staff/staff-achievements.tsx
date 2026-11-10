"use client"

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react"
import { AwardIcon, InfoIcon, RotateCcwIcon, StarIcon, TargetIcon } from "lucide-react"
import { AreaLink as Link } from "@/components/shared/area-routes"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { useStaffAuth } from "./staff-auth-session"
import { StaffEmpty, StaffPageHeader } from "./staff-shared"
import { createAchievementsDemoAdapter } from "./staff-achievements-demo-adapter"
import { ACHIEVEMENT_DISCLAIMER, AchievementsDemoError, defaultReviewFilter, formatReviewDate, validateFilter, type AchievementsDemoAdapter, type AchievementsSnapshot, type DemoAchievement, type DemoReview, type ReviewFilter, type ReviewRating } from "./staff-achievements-demo-model"
import { defaultStaffStatisticsRange, parseStaffStatisticsLocation, staffStatisticsPresetRange } from "./staff-work-statistics-model"
import { StaffPerformanceSection } from "./staff-performance-remote"
import { StaffReviewsSection } from "./staff-reviews-remote"

const number = new Intl.NumberFormat("vi-VN")
const starOptions = [5, 4, 3, 2, 1] as const

function formatAverage(value: number | null) {
  return value === null ? "—" : value.toFixed(1).replace(".", ",")
}

function DemoNotice() {
  return <div role="note" className="staff-achievements-notice"><InfoIcon aria-hidden="true" /><div><strong>DỮ LIỆU MINH HỌA</strong><p>Điểm sao, nhận xét, huy hiệu và mục tiêu đều là dữ liệu giả lập, tách riêng từng tài khoản và không lấy từ booking, phân công hay hồ sơ QA thật. Không gửi, sửa hoặc trả lời đánh giá; không cập nhật Backend. Chỉ giữ tạm khi mở trang: F5, rời trang hoặc đăng xuất sẽ đặt lại DEMO.</p></div></div>
}

function Stars({ rating }: { rating: ReviewRating }) {
  return <span className="staff-achievements-stars" aria-label={rating + " trên 5 sao"}>{[1, 2, 3, 4, 5].map(value => <StarIcon key={value} aria-hidden="true" className={value <= rating ? "is-filled" : undefined} />)}</span>
}

function RealAssignments({ checkSession }: { checkSession: NonNullable<ReturnType<typeof useStaffAuth>>["checkSession"] }) {
  const [range, setRange] = useState(() => defaultStaffStatisticsRange())
  const [draft, setDraft] = useState(range), [error, setError] = useState("")
  return <><div className="staff-performance-presets" role="group" aria-label="Chọn nhanh kỳ chỉ số vận hành">{([['day','Hôm nay'],['week','Tuần này'],['month','Tháng này']] as const).map(([preset,label]) => {
    const next=staffStatisticsPresetRange(preset)
    return <Button key={preset} type="button" variant={next?.from===range.from&&next?.to===range.to?'default':'outline'} aria-pressed={next?.from===range.from&&next?.to===range.to} data-performance-preset={preset} onClick={()=>{if(next){setError('');setDraft(next);setRange(next)}}}>{label}</Button>
  })}</div><form className="staff-performance-range" aria-label="Lọc chỉ số vận hành" onSubmit={event => { event.preventDefault(); const next = parseStaffStatisticsLocation("?" + new URLSearchParams(draft)); if (!next) { setError("Khoảng ngày chưa hợp lệ; chọn tối đa 366 ngày."); return }; setError(""); setRange(next) }}><label>Từ ngày<input type="date" required value={draft.from} min="1971-01-01" max="2099-12-31" onChange={event=>setDraft(value=>({...value,from:event.target.value}))} /></label><label>Đến ngày<input type="date" required value={draft.to} min="1971-01-01" max="2099-12-31" onChange={event=>setDraft(value=>({...value,to:event.target.value}))} /></label><Button type="submit">Xem chỉ số vận hành</Button>{error&&<p role="alert">{error}</p>}</form><StaffPerformanceSection key={range.from+":"+range.to} range={range} checkSession={checkSession} headingId="staff-achievements-real-heading" /></>
}

function Distribution({ snapshot }: { snapshot: AchievementsSnapshot }) {
  const total = snapshot.summary.total
  return <div className="staff-achievements-distribution" aria-label="Phân bố đánh giá minh họa theo số sao">{starOptions.map(stars => {
    const count = snapshot.summary.distribution[String(stars) as "1" | "2" | "3" | "4" | "5"], percent = total ? Math.round((count / total) * 100) : 0
    return <div key={stars} className="staff-achievements-distribution-row" data-demo-distribution={stars}><span>{stars} sao</span><span className="staff-achievements-bar" role="img" aria-label={count + " trên " + total + " lượt " + stars + " sao"}><span style={{ width: percent + "%" }} /></span><span>{count} · {percent}%</span></div>
  })}</div>
}

function AchievementCard({ item }: { item: DemoAchievement }) {
  const percent = Math.round((item.progress / item.target) * 100), done = item.progress >= item.target
  return <Card className="staff-achievement-card" data-demo-achievement={item.id} data-demo-achievement-kind={item.kind}><CardContent>
    <div className="staff-achievement-head"><span className="staff-achievement-icon">{item.kind === "BADGE" ? <AwardIcon aria-hidden="true" /> : <TargetIcon aria-hidden="true" />}</span><span>{item.kind === "BADGE" ? "Huy hiệu DEMO" : "Mục tiêu DEMO"}</span></div>
    <h3>{item.title}</h3><p>{item.description}</p>
    <p className="staff-achievement-progress-label"><span>{item.progress}/{item.target} {item.unit}</span><span>{done ? "Đã đạt DEMO" : percent + "%"}</span></p>
    <div className="staff-achievement-progress" role="progressbar" aria-label={item.title + " minh họa"} aria-valuemin={0} aria-valuemax={item.target} aria-valuenow={item.progress} aria-valuetext={item.progress + " trên " + item.target + " " + item.unit}><span style={{ width: Math.min(percent, 100) + "%" }} /></div>
    <p className="staff-achievement-rule">{item.rule}</p>
  </CardContent></Card>
}

function ReviewDetail({ adapter, id, version, onClose }: { adapter: AchievementsDemoAdapter; id: string | null; version: number; onClose: () => void }) {
  const [item, setItem] = useState<DemoReview | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState(""), [retry, setRetry] = useState(0)
  useEffect(() => {
    if (!id) return
    const controller = new AbortController(); setLoading(true); setItem(null); setError("")
    void adapter.detail(id, controller.signal).then(value => { if (!controller.signal.aborted) setItem(value) }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof AchievementsDemoError ? reason.message : "Chưa thể mở đánh giá minh họa.") }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [adapter, id, version, retry])
  return <Dialog open={!!id} onOpenChange={open => { if (!open) onClose() }}><DialogContent showCloseButton={false} className="staff-achievements-dialog" data-achievements-review-detail data-achievements-review-id={id || undefined}>
    <DialogHeader><DialogTitle>Chi tiết đánh giá minh họa</DialogTitle><DialogDescription>Nội dung giả lập; không phải đánh giá thật và không thể trả lời hoặc chỉnh sửa.</DialogDescription></DialogHeader>
    <DemoNotice />
    {loading ? <p role="status" aria-busy="true">Đang mở đánh giá minh họa...</p> : error ? <div role="alert"><p>{error}</p><Button variant="outline" onClick={() => setRetry(value => value + 1)}>Thử lại</Button></div> : !item ? <p role="status">Không tìm thấy đánh giá minh họa này.</p> : <>
      <div className="staff-achievements-detail-head"><Stars rating={item.rating} /><strong>{item.rating}/5 sao</strong></div>
      <p className="staff-achievements-detail-comment">{item.comment}</p>
      <dl className="staff-achievements-detail-fields"><div><dt>Ngày đánh giá (UTC+7)</dt><dd><time dateTime={item.reviewedAt}>{formatReviewDate(item.reviewedAt)}</time></dd></div><div><dt>Loại dịch vụ minh họa</dt><dd>{item.serviceType}</dd></div><div><dt>Mã tham chiếu DEMO</dt><dd>{item.referenceCode}</dd></div><div><dt>Mã đánh giá DEMO</dt><dd>{item.id}</dd></div></dl>
      <p className="staff-achievements-muted">Giả định DEMO: đánh giá gắn với một lượt dịch vụ giả lập, không gắn booking, phân công hay khách hàng thật. Không có thao tác gửi, sửa hoặc trả lời.</p>
    </>}
    <DialogClose render={<Button variant="outline" aria-label="Đóng chi tiết đánh giá" />} onClick={onClose}>Đóng chi tiết</DialogClose>
  </DialogContent></Dialog>
}

function DemoPanel({ adapter }: { adapter: AchievementsDemoAdapter }) {
  const [snapshot, setSnapshot] = useState<AchievementsSnapshot | null>(null), [draft, setDraft] = useState<ReviewFilter>(defaultReviewFilter())
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("")
  const [selected, setSelected] = useState<string | null>(null), [retry, setRetry] = useState(0), [version, setVersion] = useState(0)
  const operation = useRef<AbortController | null>(null), trigger = useRef<HTMLButtonElement | null>(null), heading = useRef<HTMLHeadingElement>(null), alertRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const controller = new AbortController(); operation.current = controller; setLoading(true); setSnapshot(null); setError("")
    void adapter.read(defaultReviewFilter(), controller.signal).then(value => { if (!controller.signal.aborted) { setSnapshot(value); if (value) setDraft({ ...value.filter }) } }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof AchievementsDemoError ? reason.message : "Chưa thể tải đánh giá minh họa. Vui lòng thử lại.") }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => { controller.abort(); operation.current?.abort() }
  }, [adapter, retry])
  useEffect(() => { if (error && !selected) alertRef.current?.focus() }, [error, selected])
  async function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || loading) return
    let next: ReviewFilter
    try { next = validateFilter(draft) } catch (reason) { setError(reason instanceof AchievementsDemoError ? reason.message : "Bộ lọc minh họa không hợp lệ."); return }
    const controller = new AbortController(); operation.current = controller; setBusy(true); setError(""); setNotice("")
    try {
      const value = await adapter.read(next, controller.signal)
      if (controller.signal.aborted) return
      setSnapshot(value); if (value) setDraft({ ...value.filter }); setVersion(current => current + 1)
      setNotice("Đã áp dụng bộ lọc đánh giá minh họa trong trang này.")
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof AchievementsDemoError ? reason.message : "Chưa thể lọc đánh giá minh họa.") }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }
  async function resetDemo() {
    if (busy || loading) return
    const controller = new AbortController(); operation.current = controller; setBusy(true); setError(""); setNotice("")
    try {
      const value = await adapter.reset(controller.signal)
      if (controller.signal.aborted) return
      setSnapshot(value); if (value) setDraft({ ...value.filter }); setSelected(null); setVersion(current => current + 1)
      setNotice("Đã đặt lại đánh giá, bộ lọc và thành tích minh họa của phiên đang mở.")
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof AchievementsDemoError ? reason.message : "Chưa thể đặt lại bản minh họa.") }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }
  function close() { setSelected(null); window.setTimeout(() => { if (trigger.current?.isConnected) trigger.current.focus(); else heading.current?.focus() }, 0) }
  const filtered = snapshot?.filtered || []
  return <>
    <DemoNotice />
    {notice && <p role="status" aria-live="polite" className="staff-achievements-feedback">{notice}</p>}
    {error && <div ref={alertRef} role="alert" tabIndex={-1} className="staff-achievements-error"><p>{error}</p>{!snapshot && <Button variant="outline" onClick={() => setRetry(value => value + 1)}>Thử tải lại</Button>}</div>}
    {loading ? <section className="staff-achievements-loading" role="status" aria-busy="true" aria-label="Đang tải đánh giá minh họa"><Skeleton className="h-28 rounded-2xl" /><Skeleton className="h-52 rounded-2xl" /></section> : !snapshot ? !error && <StaffEmpty title="Chưa có đánh giá minh họa" description="Bản minh họa hiện không cung cấp đánh giá nào." /> : <>
      <section className="staff-achievements-reviews" aria-labelledby="staff-achievements-reviews-heading">
        <div className="staff-achievements-section-title"><div><h2 id="staff-achievements-reviews-heading">Đánh giá minh họa</h2><p>Tổng hợp từ bộ dữ liệu giả lập, không phải đánh giá thật của khách hàng.</p></div><Button variant="outline" disabled={busy || loading} aria-label="Đặt lại đánh giá minh họa" onClick={() => void resetDemo()}><RotateCcwIcon aria-hidden="true" />Đặt lại minh họa</Button></div>
        <div className="staff-achievements-summary">
          <Card><CardContent><p className="staff-achievements-real-label">Điểm trung bình DEMO</p><p className="staff-achievements-average" data-demo-average={snapshot.summary.average ?? ""}>{formatAverage(snapshot.summary.average)}<span>/5</span></p><p>Tổng {snapshot.summary.total} lượt đánh giá minh họa.</p></CardContent></Card>
          <Card><CardContent><p className="staff-achievements-real-label">Phân bố số sao DEMO</p><Distribution snapshot={snapshot} /></CardContent></Card>
        </div>
        <form className="staff-achievements-filters" onSubmit={apply} noValidate aria-label="Lọc đánh giá minh họa">
          <div className="ch-field"><label htmlFor="staff-achievements-stars">Số sao</label><select id="staff-achievements-stars" data-demo-filter-stars value={String(draft.stars)} disabled={busy} onChange={event => { const value = event.target.value; setDraft(current => ({ ...current, stars: value === "ALL" ? "ALL" : Number(value) as ReviewRating })); setNotice("") }}><option value="ALL">Tất cả số sao</option>{starOptions.map(value => <option key={value} value={value}>{value} sao</option>)}</select></div>
          <div className="ch-field"><label htmlFor="staff-achievements-from">Từ ngày</label><input id="staff-achievements-from" type="date" min="1971-01-01" max="2099-12-31" value={draft.from} disabled={busy} onChange={event => { const value = event.target.value; setDraft(current => ({ ...current, from: value })); setNotice("") }} /></div>
          <div className="ch-field"><label htmlFor="staff-achievements-to">Đến ngày</label><input id="staff-achievements-to" type="date" min="1971-01-01" max="2099-12-31" value={draft.to} disabled={busy} onChange={event => { const value = event.target.value; setDraft(current => ({ ...current, to: value })); setNotice("") }} /></div>
          <div className="staff-achievements-filter-actions"><Button type="submit" disabled={busy || loading}>Áp dụng lọc</Button></div>
          <p className="staff-achievements-muted">Ngày Việt Nam (UTC+7), bao gồm cả hai ngày; tối đa 366 ngày. Lọc chỉ áp dụng cho bản minh họa.</p>
        </form>
        <p className="staff-achievements-filter-result" role="status" data-demo-filtered-total={filtered.length}>{filtered.length} / {snapshot.summary.total} lượt khớp bộ lọc · điểm trung bình lọc: {formatAverage(snapshot.filteredSummary.average)}/5</p>
        {!filtered.length ? <div className="staff-achievements-empty" role="status"><StarIcon aria-hidden="true" /><h3>Không có đánh giá minh họa khớp bộ lọc</h3><p>Thử chọn khoảng ngày rộng hơn hoặc bỏ lọc số sao. Dữ liệu thật không bị ảnh hưởng.</p><Button variant="outline" onClick={() => void resetDemo()}>Xóa bộ lọc minh họa</Button></div> : <ul className="staff-achievements-list" aria-label="Danh sách đánh giá minh họa">{filtered.map(review => <li key={review.id}><Card className="staff-achievement-review" data-demo-review={review.id} data-demo-review-rating={review.rating}><CardContent>
          <div className="staff-achievement-review-head"><Stars rating={review.rating} /><span>{formatReviewDate(review.reviewedAt)}</span></div>
          <p className="staff-achievement-review-comment">{review.comment}</p>
          <p className="staff-achievement-review-meta">{review.serviceType} · {review.referenceCode}</p>
          <Button variant="outline" aria-label={"Xem chi tiết đánh giá " + review.id} onClick={event => { trigger.current = event.currentTarget; setSelected(review.id) }}>Xem chi tiết</Button>
        </CardContent></Card></li>)}</ul>}
      </section>
      <section className="staff-achievements-badges" aria-labelledby="staff-achievements-badges-heading">
        <div className="staff-achievements-section-title"><div><h2 ref={heading} tabIndex={-1} id="staff-achievements-badges-heading">Huy hiệu & mục tiêu minh họa</h2><p>Tính trên toàn bộ bộ dữ liệu minh họa, không theo bộ lọc đánh giá phía trên.</p></div><span>{snapshot.achievements.filter(item => item.progress >= item.target).length}/{snapshot.achievements.length} đã đạt DEMO</span></div>
        <div className="staff-achievements-badge-grid">{snapshot.achievements.map(item => <AchievementCard key={item.id} item={item} />)}</div>
        <p className="staff-achievements-disclaimer" role="note">{ACHIEVEMENT_DISCLAIMER}</p>
      </section>
      <details className="staff-achievements-rules"><summary>Giả định và giới hạn của bản minh họa</summary><ul><li>Điểm trung bình và phân bố sao chỉ tính trên 12 lượt đánh giá giả lập; không đại diện cho đánh giá thật.</li><li>Bộ lọc số sao và khoảng ngày áp dụng cho danh sách đánh giá; huy hiệu và mục tiêu tính trên toàn bộ dữ liệu minh họa.</li><li>Quy tắc đạt huy hiệu/mục tiêu là giả định DEMO, không phải quy chế CleanHome và không suy ra thưởng tiền, tăng lương hoặc KPI chính thức.</li><li>Không gắn bookingId, assignmentId, employeeId thật; không gửi, sửa, trả lời hoặc kiểm duyệt đánh giá; không ghi Backend.</li></ul></details>
    </>}
    <ReviewDetail adapter={adapter} id={selected} version={version} onClose={close} />
  </>
}

function BoundAchievements({ enabled, accountScope }: { enabled: boolean; accountScope: string }) {
  const adapter = useMemo(() => createAchievementsDemoAdapter({ enabled, accountScope }), [enabled, accountScope])
  return adapter.kind === "unavailable" ? <UnavailableReviews /> : <DemoPanel adapter={adapter} />
}

function UnavailableReviews() {
  return <section className="staff-achievements-unavailable" aria-label="Đánh giá khách hàng chưa có dữ liệu" data-staff-achievements-unavailable>
    <StaffEmpty title="Chưa có dữ liệu đánh giá" description="Đánh giá khách hàng, huy hiệu và mục tiêu cần Review API và quy chế KPI được duyệt. Trang này không hiển thị dữ liệu minh họa khi DEMO đang tắt hoặc ngoài môi trường development." action={<Button variant="outline" render={<Link href="/thong-ke-cong-viec" />} nativeButton={false}>Xem Thống kê công việc</Button>} />
    <p className="staff-achievements-muted">Đánh giá khách hàng, huy hiệu và mục tiêu sẽ hiển thị khi API đánh giá và quy chế KPI được duyệt.</p>
  </section>
}

export function StaffAchievements({ demoEnabled = false }: { demoEnabled?: boolean }) {
  const auth = useStaffAuth()
  if (!auth || auth.status !== "authenticated" || !auth.session || auth.busy === "logout") return null
  const accountScope = auth.session.user.id
  const canDemo = demoEnabled === true && process.env.NODE_ENV === "development" && /^[1-9]\d{0,18}$/.test(accountScope)
  return <div className="staff-achievements min-w-0 space-y-6" data-staff-achievements={canDemo ? "demo" : "unavailable"}>
    <StaffPageHeader title="Thành tích & Đánh giá" description={canDemo ? "Theo dõi công việc; đánh giá, huy hiệu và mục tiêu là bản minh họa riêng biệt." : "Theo dõi kết quả công việc và đánh giá của bạn."} action={<Button variant="outline" render={<Link href="/ho-so" />} nativeButton={false}>Về Cá nhân</Button>} />
    <RealAssignments key={`real:${accountScope}`} checkSession={auth.checkSession} />
    {canDemo ? <BoundAchievements key={`demo:${accountScope}`} enabled={demoEnabled} accountScope={accountScope} /> : <StaffReviewsSection key={`reviews:${accountScope}`} accountScope={accountScope} checkSession={auth.checkSession} />}
  </div>
}
