"use client"

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react"
import { useSearchParams } from "next/navigation"
import { ArrowRightIcon, ChartNoAxesColumnIcon, InfoIcon, RefreshCwIcon } from "lucide-react"
import { AreaLink as Link } from "@/components/shared/area-routes"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useStaffAuth } from "./staff-auth-session"
import { StaffPageHeader } from "./staff-shared"
import { formatStaffScheduleTime, scheduleDayLabel, validateScheduleRange } from "./staff-schedule-remote-model"
import { defaultStaffStatisticsRange, parseStaffStatisticsLocation, readStaffStatistic, STAFF_STATISTIC_METRICS, staffStatisticMessage, staffStatisticsHref, staffStatisticsScheduleHref, StaffStatisticRequestError, type StaffStatisticsRange } from "./staff-work-statistics-model"

type Metric = typeof STAFF_STATISTIC_METRICS[number]
type CountResult = { total: number; readAt: string } | { error: string }
const number = new Intl.NumberFormat("vi-VN")

export function StaffWorkStatisticsRemote() {
  const auth = useStaffAuth()
  if (!auth || auth.status !== "authenticated" || !auth.session || auth.busy === "logout") return null
  const identity = auth.session.user.id + ":" + auth.session.expiresAt
  return <StatisticsContent key={identity} checkSession={auth.checkSession} />
}
function StatisticsPeriod({ initial, onApply }: { initial: StaffStatisticsRange; onApply: (range: StaffStatisticsRange) => void }) {
  const [from, setFrom] = useState(initial.from), [to, setTo] = useState(initial.to), [error, setError] = useState("")
  const alert = useRef<HTMLParagraphElement>(null)
  useEffect(() => { if (error) alert.current?.focus() }, [error])
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const message = validateScheduleRange(from, to)
    setError(message)
    if (!message) onApply({ from, to })
  }
  return <form className="staff-statistics-period" onSubmit={submit} noValidate aria-label="Chọn khoảng lịch hẹn">
    <div className="ch-field"><label htmlFor="staff-statistics-from">Từ ngày</label><input id="staff-statistics-from" type="date" min="1971-01-01" max="2099-12-31" required value={from} aria-invalid={!!error} aria-describedby={error ? "staff-statistics-range-error" : "staff-statistics-range-help"} onChange={event => { setFrom(event.target.value); setError("") }} /></div>
    <div className="ch-field"><label htmlFor="staff-statistics-to">Đến ngày</label><input id="staff-statistics-to" type="date" min="1971-01-01" max="2099-12-31" required value={to} aria-invalid={!!error} aria-describedby={error ? "staff-statistics-range-error" : "staff-statistics-range-help"} onChange={event => { setTo(event.target.value); setError("") }} /></div>
    <div className="staff-statistics-period-actions"><Button type="submit">Áp dụng</Button><Button type="button" variant="outline" onClick={() => { const range = defaultStaffStatisticsRange(); setFrom(range.from); setTo(range.to); setError(""); onApply(range) }}>Tháng này</Button></div>
    <p id="staff-statistics-range-help">Ngày Việt Nam (UTC+7) · Tối đa 366 ngày, bao gồm cả hai ngày đã chọn.</p>
    {error && <p id="staff-statistics-range-error" ref={alert} tabIndex={-1} role="alert">{error}</p>}
  </form>
}
function StatisticCard({ metric, range, onAccessDenied }: { metric: Metric; range: StaffStatisticsRange; onAccessDenied: () => void }) {
  const [result, setResult] = useState<CountResult | null>(null), [retry, setRetry] = useState(0)
  const generation = useRef(0), status = metric.status
  useEffect(() => {
    const version = ++generation.current, controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), 15_000)
    setResult(null)
    void (async () => {
      try {
        const total = await readStaffStatistic(range, status, controller.signal)
        if (controller.signal.aborted || version !== generation.current) return
        setResult({ total, readAt: new Date().toISOString() })
      } catch (error) {
        if (version !== generation.current) return
        if (error instanceof StaffStatisticRequestError && [401, 403].includes(error.status)) onAccessDenied()
        else setResult({ error: staffStatisticMessage(error) })
      } finally { window.clearTimeout(timer) }
    })()
    return () => { ++generation.current; controller.abort(); window.clearTimeout(timer) }
  }, [range.from, range.to, status, retry, onAccessDenied])
  return <Card className="staff-statistics-card" data-statistic={metric.key} role="article" aria-labelledby={"staff-statistic-" + metric.key}>
    <CardContent><header><span><ChartNoAxesColumnIcon aria-hidden="true" /></span><h3 id={"staff-statistic-" + metric.key}>{metric.label}</h3></header>
      {!result ? <div role="status" aria-busy="true" aria-label={"Đang tải " + metric.label}><Skeleton className="my-4 h-10 w-20" /><p>Đang đọc số liệu...</p></div> : "error" in result ? <div role="alert"><p>{result.error}</p><Button variant="outline" onClick={() => setRetry(value => value + 1)} aria-label={"Thử lại " + metric.label}>Thử lại</Button></div> : <div aria-live="polite"><p className="staff-statistics-count" data-statistic-total={result.total}>{number.format(result.total)}<span>phân công</span></p><p>{result.total === 0 ? "Chưa có phân công khớp bộ lọc này." : "Theo lịch hẹn giao với kỳ đã chọn."}</p><p className="staff-statistics-read-time">Đọc lúc <time dateTime={result.readAt}>{formatStaffScheduleTime(result.readAt)}</time></p></div>}
      <Link className="staff-statistics-calendar-link" href={staffStatisticsScheduleHref(range, status)} aria-label={"Xem lịch: " + metric.label}>Xem lịch<ArrowRightIcon aria-hidden="true" /></Link>
    </CardContent>
  </Card>
}
function StatisticsContent({ checkSession }: { checkSession: NonNullable<ReturnType<typeof useStaffAuth>>["checkSession"] }) {
  const params = useSearchParams(), search = params.toString(), range = parseStaffStatisticsLocation(search)
  const [reload, setReload] = useState(0), [denied, setDenied] = useState(false)
  const onAccessDenied = useCallback(() => { setDenied(true); void checkSession() }, [checkSession])
  function apply(next: StaffStatisticsRange) {
    window.history.replaceState(null, "", staffStatisticsHref(next))
    setDenied(false); setReload(value => value + 1)
  }
  return <div className="staff-statistics min-w-0 space-y-6" data-staff-statistics>
    <StaffPageHeader title="Thống kê công việc" description="Phân công của bạn theo khoảng lịch hẹn · Giờ Việt Nam (UTC+7)." action={<Button variant="outline" render={<Link href="/ho-so" />} nativeButton={false}>Về cá nhân</Button>} />
    <Card><CardContent><StatisticsPeriod key={search} initial={range || defaultStaffStatisticsRange()} onApply={apply} /></CardContent></Card>
    {!range ? <section role="alert" className="staff-statistics-notice"><InfoIcon aria-hidden="true" /><div><h2>Khoảng lịch hẹn chưa hợp lệ</h2><p>Chọn đủ ngày bắt đầu và kết thúc, tối đa 366 ngày. Trang này chỉ nhận hai tham số from và to.</p><Button variant="outline" onClick={() => apply(defaultStaffStatisticsRange())}>Về tháng này</Button></div></section> : <>
      <section className="staff-statistics-summary" aria-label="Kỳ và phạm vi thống kê"><div><p className="staff-eyebrow">Khoảng lịch hẹn</p><h2><time dateTime={range.from}>{scheduleDayLabel(range.from)}</time><span> — </span><time dateTime={range.to}>{scheduleDayLabel(range.to)}</time></h2><p>Tính cả lịch hẹn bắt đầu trước kỳ nhưng kéo dài vào kỳ. Mỗi số đếm là phân công của bạn, không phải số đơn dịch vụ.</p></div><Button variant="outline" onClick={() => { setDenied(false); setReload(value => value + 1) }}><RefreshCwIcon aria-hidden="true" />Tải lại</Button></section>
      <div className="staff-statistics-notice" role="note"><InfoIcon aria-hidden="true" /><p>Trạng thái DONE nghĩa là phân công hiện ở trạng thái DONE và có lịch hẹn giao với kỳ đã chọn; kỳ không dựa trên ngày hoàn tất. Mỗi thẻ được đọc riêng và có thể thay đổi giữa các lần đọc. Giờ đọc hiển thị là giờ tại trình duyệt nhận kết quả.</p></div>
      {denied ? <section role="alert" className="staff-statistics-access-error"><h2>Chưa thể xác minh quyền xem số liệu</h2><p>Vui lòng tải lại để kiểm tra phiên đăng nhập.</p></section> : <section className="staff-statistics-grid" aria-label="Số phân công theo trạng thái hiện tại">{STAFF_STATISTIC_METRICS.map(metric => <StatisticCard key={search + ":" + reload + ":" + metric.key} metric={metric} range={range} onAccessDenied={onAccessDenied} />)}</section>}
    </>}
  </div>
}
