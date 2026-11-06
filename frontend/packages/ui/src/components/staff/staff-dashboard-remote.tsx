"use client"

import { useEffect, useState } from "react"
import { ArrowRightIcon, CalendarDaysIcon, CheckCheckIcon, ClipboardListIcon, Clock3Icon, InfoIcon, SparklesIcon } from "lucide-react"
import { AreaLink as Link } from "@/components/shared/area-routes"
import { ToneBadge } from "@/components/shared/status-badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useStaffAuth } from "./staff-auth-session"
import { StaffEmpty, StaffPageHeader } from "./staff-shared"
import { DEFAULT_STAFF_JOBS_QUERY, REMOTE_STAFF_STATUS_LABEL, staffJobDetailHref, staffJobsListHref, type RemoteStaffJob } from "./staff-jobs-remote-model"
import { formatStaffScheduleTime, scheduleDayLabel, staffScheduleHref, vietnamDayKey } from "./staff-schedule-remote-model"
import { dashboardPeriods, readStaffDashboard, type StaffDashboardData } from "./staff-dashboard-model"

function todayHref(day: string) {
  return staffScheduleHref({ from: day, to: day, anchor: day, view: "day", status: "", page: 1, pageSize: 100, sort: "asc" })
}
function PanelError({ message, retry }: { message: string; retry: () => void }) {
  return <div role="alert" className="staff-dashboard-error"><p>{message}</p><Button variant="outline" onClick={retry}>Thử lại</Button></div>
}
function JobPreview({ jobs }: { jobs: RemoteStaffJob[] }) {
  return <ul className="staff-dashboard-jobs">{jobs.map(job => <li key={job.assignmentId} data-dashboard-assignment={job.assignmentId}>
    <div className="staff-dashboard-job-heading"><p>Phân công #{job.assignmentId}</p><ToneBadge tone={({ WAITING: "warning", ACCEPTED: "info", IN_PROGRESS: "primary", DONE: "success", CANCELLED: "danger" } as const)[job.status]}>{REMOTE_STAFF_STATUS_LABEL[job.status]}</ToneBadge></div>
    <h3>{job.services.map(service => service.name).filter(Boolean).join(" · ") || "Chưa có tên dịch vụ"}</h3>
    <p className="staff-dashboard-job-time"><CalendarDaysIcon aria-hidden="true" className="size-4 shrink-0" /><time dateTime={job.scheduledAt || undefined}>{formatStaffScheduleTime(job.scheduledAt)}</time></p>
    {job.contact.address && <p className="staff-dashboard-job-address">{job.contact.address}</p>}
    <Link className="staff-dashboard-detail" href={staffJobDetailHref(job.assignmentId, DEFAULT_STAFF_JOBS_QUERY)}>Xem chi tiết<ArrowRightIcon aria-hidden="true" className="size-4" /><span className="sr-only"> phân công {job.assignmentId}</span></Link>
  </li>)}</ul>
}
function LoadingPreview() {
  return <div role="status" aria-label="Đang tải Tổng quan" aria-busy="true" className="staff-dashboard-loading"><span className="sr-only">Đang tải công việc của bạn.</span>{[0, 1].map(key => <Skeleton key={key} className="h-40 rounded-2xl" />)}</div>
}
export function StaffDashboardRemote() {
  const auth = useStaffAuth()
  if (!auth || auth.status !== "authenticated" || !auth.session || auth.busy === "logout") return <LoadingPreview />
  return <StaffDashboard key={auth.session.user.id + ":" + auth.session.expiresAt} checkSession={auth.checkSession} />
}
function StaffDashboard({ checkSession }: { checkSession: () => Promise<void> }) {
  const [day, setDay] = useState(() => vietnamDayKey()), [retry, setRetry] = useState(0)
  const [result, setResult] = useState<{ key: string; data: StaffDashboardData | null }>({ key: "", data: null })
  const key = day + ":" + retry, periods = dashboardPeriods(day), refresh = () => setRetry(value => value + 1)
  useEffect(() => {
    const tick = () => { if (document.visibilityState === "visible") setDay(vietnamDayKey()) }
    const timer = window.setInterval(tick, 60000)
    window.addEventListener("focus", tick); document.addEventListener("visibilitychange", tick)
    return () => { window.clearInterval(timer); window.removeEventListener("focus", tick); document.removeEventListener("visibilitychange", tick) }
  }, [])
  useEffect(() => {
    const controller = new AbortController(), timeout = window.setTimeout(() => controller.abort(), 15000)
    void readStaffDashboard(day, controller.signal).then(async data => {
      if (controller.signal.aborted) return
      setResult({ key, data })
      if (data.accessDenied) await checkSession()
    }).catch(() => {
      if (!controller.signal.aborted) setResult({ key, data: null })
    }).finally(() => window.clearTimeout(timeout))
    // On a real timeout expose a retry state; unmount aborts do not commit old data.
    const timeoutState = window.setTimeout(() => {
      if (!controller.signal.aborted) return
      setResult({ key, data: null })
    }, 15010)
    return () => { window.clearTimeout(timeout); window.clearTimeout(timeoutState); controller.abort() }
  }, [day, key, checkSession])
  const loaded = result.key === key, data = loaded ? result.data : null
  const stats = [
    { id: "today", label: "Trong lịch hôm nay", detail: "Mọi trạng thái", value: data?.today.data?.pagination.total, error: data?.today.error, href: todayHref(day), icon: CalendarDaysIcon },
    { id: "waiting", label: "Chờ tiếp nhận", detail: "Toàn bộ thời gian", value: data?.waiting.data?.pagination.total, error: data?.waiting.error, href: staffJobsListHref({ ...DEFAULT_STAFF_JOBS_QUERY, status: "WAITING" }), icon: Clock3Icon },
    { id: "progress", label: "Đang thực hiện", detail: "Toàn bộ thời gian", value: data?.progress.data?.pagination.total, error: data?.progress.error, href: staffJobsListHref({ ...DEFAULT_STAFF_JOBS_QUERY, status: "IN_PROGRESS" }), icon: ClipboardListIcon },
    { id: "done", label: "Đã hoàn thành", detail: "Toàn bộ thời gian", value: data?.done.data?.pagination.total, error: data?.done.error, href: staffJobsListHref({ ...DEFAULT_STAFF_JOBS_QUERY, status: "DONE" }), icon: CheckCheckIcon },
  ]
  return <div className="staff-dashboard">
    <StaffPageHeader title="Tổng quan" description={scheduleDayLabel(day, true) + " · Giờ Việt Nam (UTC+7)"} />
    <section className="staff-dashboard-welcome"><div><p className="staff-eyebrow">Không gian làm việc của bạn</p><h2>Sẵn sàng cho ngày hôm nay.</h2><p>Theo dõi lịch hẹn và chăm sóc từng công việc cùng CleanHome.</p><div className="staff-dashboard-shortcuts"><Button render={<Link href="/cong-viec" />} nativeButton={false}>Xem công việc<ArrowRightIcon aria-hidden="true" className="size-4" /></Button><Button variant="outline" render={<Link href={todayHref(day)} />} nativeButton={false}><CalendarDaysIcon aria-hidden="true" className="size-4" />Lịch hôm nay</Button></div></div><SparklesIcon aria-hidden="true" className="staff-dashboard-welcome-icon" /></section>
    <section aria-label="Số công việc theo phạm vi" className="staff-dashboard-stats">{stats.map(({ id, label, detail, value, error, href, icon: Icon }) => <Card key={id}><CardContent><Link href={href} data-dashboard-stat={id} className="staff-dashboard-stat"><span className="staff-dashboard-stat-icon"><Icon aria-hidden="true" className="size-5" /></span><span className="staff-dashboard-stat-label">{label}</span>{!loaded ? <Skeleton className="h-9 w-16" /> : <strong data-dashboard-value>{value === undefined ? "—" : value.toLocaleString("vi-VN")}</strong>}<span className="staff-dashboard-stat-scope">{loaded && (error || !data) ? "Chưa tải được · mở danh sách" : detail}</span></Link></CardContent></Card>)}</section>
    <details className="staff-dashboard-info"><summary><InfoIcon aria-hidden="true" />Phạm vi chỉ số</summary><p>Các chỉ số tính theo công việc được phân công. “Đã hoàn thành” là tổng trên toàn bộ thời gian, không phải số hoàn thành hôm nay.</p></details>
    {loaded && !data && <PanelError message="Chưa thể tải Tổng quan. Vui lòng thử lại." retry={refresh} />}
    {data && [data.waiting, data.progress, data.done].some(item => item.error) && <PanelError message="Một số chỉ số chưa tải được. Các mục có dấu — chưa có số liệu." retry={refresh} />}
    <div className="staff-dashboard-columns">
      <section className="staff-dashboard-panel" aria-label="Công việc hôm nay"><div className="staff-dashboard-panel-heading"><div><h2>Lịch hôm nay</h2><p>{scheduleDayLabel(day)} · gồm mọi trạng thái</p></div><Link href={todayHref(day)} className="staff-dashboard-detail">Mở lịch<ArrowRightIcon aria-hidden="true" className="size-4" /></Link></div>
        {!loaded ? <LoadingPreview /> : data?.today.error ? <PanelError message={data.today.error} retry={refresh} /> : data?.today.data ? <>{data.today.data.data.length ? <JobPreview jobs={data.today.data.data} /> : <StaffEmpty title="Chưa có công việc trong lịch hôm nay" description="Bạn có thể mở lịch để xem các ngày khác." />}<p className="staff-dashboard-caption">Hiển thị {data.today.data.data.length}/{data.today.data.pagination.total} công việc. Gồm việc đã hủy và việc kéo dài qua ngày.</p></> : <PanelError message="Chưa thể tải lịch hôm nay." retry={refresh} />}
      </section>
      <section className="staff-dashboard-panel" aria-label="Công việc sắp tới"><div className="staff-dashboard-panel-heading"><div><h2>Công việc sắp tới</h2><p>{periods.upcoming ? scheduleDayLabel(periods.upcoming.from) + " – " + scheduleDayLabel(periods.upcoming.to) : "Ngoài khoảng ngày được hỗ trợ"}</p></div><Link href="/lich-lam-viec" className="staff-dashboard-detail">Xem lịch<ArrowRightIcon aria-hidden="true" className="size-4" /></Link></div>
        {!loaded ? <LoadingPreview /> : data?.upcoming.error ? <PanelError message={data.upcoming.error} retry={refresh} /> : data?.upcoming.data ? <>{data.upcoming.data.length ? <JobPreview jobs={data.upcoming.data} /> : <StaffEmpty title="Chưa ghi nhận công việc sắp tới" description="Chưa có việc chờ tiếp nhận, đã tiếp nhận hoặc đang thực hiện trong khoảng ngày này." />}<p className="staff-dashboard-caption">Xem trước tối đa 4 công việc; gồm việc kéo dài sang khoảng ngày này. Mở Lịch để xem đầy đủ.</p></> : <PanelError message="Chưa thể tải công việc sắp tới." retry={refresh} />}
      </section>
    </div>
  </div>
}
