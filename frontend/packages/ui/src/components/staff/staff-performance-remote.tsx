"use client"

import { useEffect, useRef, useState } from "react"
import { InfoIcon } from "lucide-react"
import { AreaLink as Link } from "@/components/shared/area-routes"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { staffStatisticsHref, StaffStatisticRequestError, type StaffStatisticsRange } from "./staff-work-statistics-model"
import { readStaffPerformance, staffPerformanceMessage } from "./staff-performance-remote-model"
import { StaffPerformanceBreakdown } from "./staff-performance-breakdown"
import { formatStaffMinutes, formatStaffPercent, STAFF_PERFORMANCE_DEFINITIONS, type StaffPerformance } from "./staff-performance-model"

const number = new Intl.NumberFormat("vi-VN")
const dateLabel = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`

type State = { summary: StaffPerformance } | { error: string } | null

/**
 * Real-data section: reads the existing Staff assignment API and shows operational
 * metrics only. It never reads salary/revenue, never writes, and never replaces an
 * unavailable real read with DEMO content.
 */
export function StaffPerformanceSection({ range, checkSession, headingId = "staff-performance-heading" }: {
  range: StaffStatisticsRange
  checkSession: () => unknown
  headingId?: string
}) {
  const [state, setState] = useState<State>(null)
  const [retry, setRetry] = useState(0)
  const generation = useRef(0)
  useEffect(() => {
    const version = ++generation.current
    const controller = new AbortController()
    const timer = window.setTimeout(() => { if (version === generation.current && !controller.signal.aborted) { setState({ error: "Hết thời gian đọc số liệu. Vui lòng thử lại." }); controller.abort() } }, 20_000)
    setState(null)
    void (async () => {
      try {
        const summary = await readStaffPerformance(range, controller.signal)
        if (controller.signal.aborted || version !== generation.current) return
        setState({ summary })
      } catch (error) {
        if (controller.signal.aborted || version !== generation.current) return
        setState({ error: staffPerformanceMessage(error) })
        if (error instanceof StaffStatisticRequestError && [401, 403].includes(error.status)) void checkSession()
      } finally { window.clearTimeout(timer) }
    })()
    return () => { controller.abort(); window.clearTimeout(timer) }
  }, [range.from, range.to, retry, checkSession])

  const summary = state && "summary" in state ? state.summary : null
  return <section className="staff-achievements-real" data-staff-real-statistics data-staff-performance="real" aria-labelledby={headingId}>
    <div className="staff-achievements-section-title">
      <div>
        <h2 id={headingId}>Thống kê công việc</h2>
        <p>Theo lịch hẹn {dateLabel(range.from)} – {dateLabel(range.to)} · Giờ Việt Nam (UTC+7).</p>
      </div>
      <Button variant="outline" render={<Link href={staffStatisticsHref(range)} />} nativeButton={false} aria-label="Mở trang Thống kê công việc">Mở Thống kê công việc</Button>
    </div>
    {!state ? <div className="staff-achievements-real-grid" role="status" aria-busy="true" aria-label="Đang tải thống kê công việc">
      <Card><CardContent><Skeleton className="h-8 w-20" /><p>Đang tải số liệu...</p></CardContent></Card>
      <Card><CardContent><Skeleton className="h-8 w-20" /><p>Đang tải số liệu...</p></CardContent></Card>
    </div>
      : "error" in state ? <div role="alert" className="staff-achievements-error"><p>{state.error}</p><Button variant="outline" onClick={() => setRetry(value => value + 1)} aria-label="Tải lại thống kê công việc">Thử lại</Button></div>
        : !summary || summary.total === 0 ? <div role="status" className="staff-achievements-error"><p>Chưa có công việc trong khoảng thời gian này.</p><Button variant="outline" onClick={() => setRetry(value => value + 1)}>Thử lại</Button></div>
          : <div className="staff-achievements-real-grid" aria-live="polite" data-performance-total={summary.total}>
            <Card><CardContent>
              <p className="staff-achievements-real-label">Tổng phân công trong kỳ</p>
              <p className="staff-achievements-real-count" data-real-statistic="ALL">{number.format(summary.total)}<span>phân công</span></p>
              <p>Chờ nhận {number.format(summary.waiting)} · Đã nhận {number.format(summary.accepted)} · Đang làm {number.format(summary.inProgress)} · <span data-real-statistic="DONE">Hoàn thành {number.format(summary.done)}</span> · Đã hủy {number.format(summary.cancelled)}.</p>
            </CardContent></Card>
            <Card><CardContent>
              <p className="staff-achievements-real-label">{STAFF_PERFORMANCE_DEFINITIONS[0].label}</p>
              <p className="staff-achievements-real-count" data-real-metric="completionRate">{formatStaffPercent(summary.completionRate)}</p>
              {summary.completionRate !== null && <meter className="staff-performance-meter" min={0} max={100} value={summary.completionRate} aria-label={"Tỷ lệ hoàn thành: " + formatStaffPercent(summary.completionRate)} />}
              <p>{number.format(summary.done)} / {number.format(summary.completionDenominator)} công việc còn hiệu lực, không tính việc đã hủy.</p>
            </CardContent></Card>
            <Card><CardContent>
              <p className="staff-achievements-real-label">{STAFF_PERFORMANCE_DEFINITIONS[1].label}</p>
              <p className="staff-achievements-real-count" data-real-metric="onTimeRate">{formatStaffPercent(summary.onTimeRate)}</p>
              {summary.onTimeRate !== null && <meter className="staff-performance-meter" min={0} max={100} value={summary.onTimeRate} aria-label={"Đúng giờ nhận việc: " + formatStaffPercent(summary.onTimeRate)} />}
              <p>{number.format(summary.onTimeCheckIn)} / {number.format(summary.checkInSample)} công việc có đủ lịch hẹn và giờ bắt đầu.</p>
            </CardContent></Card>
            <Card><CardContent>
              <p className="staff-achievements-real-label">{STAFF_PERFORMANCE_DEFINITIONS[2].label}</p>
              <p className="staff-achievements-real-count" data-real-metric="averageServiceMinutes">{formatStaffMinutes(summary.averageServiceMinutes)}</p>
              <p>Trên {number.format(summary.durationSample)} công việc hoàn thành có đủ thời gian hợp lệ.</p>
            </CardContent></Card>
          </div>}
    {summary && summary.total > 0 && (summary.doneMissingCheckOut > 0 || summary.activeMissingCheckIn > 0 || summary.invalidDuration > 0)
      ? <p className="staff-achievements-muted" role="note">Chưa đủ thời gian để tính chỉ số cho một số công việc: {number.format(summary.doneMissingCheckOut)} thiếu giờ kết thúc, {number.format(summary.activeMissingCheckIn)} thiếu giờ bắt đầu, {number.format(summary.invalidDuration)} khoảng thời gian không hợp lệ.</p>
      : null}
    {summary && <StaffPerformanceBreakdown summary={summary} />}
    <p className="staff-achievements-muted"><InfoIcon aria-hidden="true" /> Số liệu công việc không tự quy đổi thành thưởng hoặc xếp hạng nhân sự.</p>
  </section>
}
