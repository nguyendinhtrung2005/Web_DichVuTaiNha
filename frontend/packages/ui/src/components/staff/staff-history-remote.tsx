"use client"

import { useEffect, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { ArrowRightIcon, HistoryIcon, InfoIcon } from "lucide-react"
import { AreaLink as Link } from "@/components/shared/area-routes"
import { ToneBadge } from "@/components/shared/status-badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { useStaffAuth } from "./staff-auth-session"
import { StaffEmpty, StaffPageHeader } from "./staff-shared"
import { formatStaffScheduleTime } from "./staff-schedule-remote-model"
import { staffJobsQueryString, type RemoteStaffJob, type RemoteStaffJobsPayload, type StaffJobsQuery } from "./staff-jobs-remote-model"
import { DEFAULT_STAFF_HISTORY_QUERY, parseStaffHistoryQuery, readStaffHistory, staffHistoryDetailHref, staffHistoryHref, staffHistoryMessage, StaffHistoryRequestError } from "./staff-history-model"

type StaffAuth = NonNullable<ReturnType<typeof useStaffAuth>>
type HistoryResult = { key: string; data: RemoteStaffJobsPayload | null; error: string; loading: boolean }

function HistoryServices({ job }: { job: RemoteStaffJob }) {
  return job.services.length ? <ul className="staff-history-services">{job.services.map((service, index) => <li key={service.serviceId + ":" + index}><p>{service.name || "Chưa có tên dịch vụ"}</p><span>{service.quantity}{service.unit ? " " + service.unit : ""}</span></li>)}</ul> : <p>Chưa có thông tin dịch vụ</p>
}
function HistoryTimes({ job }: { job: RemoteStaffJob }) {
  return <dl className="staff-history-times"><div><dt>Lịch hẹn</dt><dd>{job.scheduledAt ? <time dateTime={job.scheduledAt}>{formatStaffScheduleTime(job.scheduledAt)}</time> : "Chưa có lịch hẹn"}</dd></div><div><dt>Kết thúc ghi nhận</dt><dd>{job.checkOutAt ? <time dateTime={job.checkOutAt}>{formatStaffScheduleTime(job.checkOutAt)}</time> : "Chưa có thông tin"}</dd></div></dl>
}

export function StaffHistoryRemote() {
  const auth = useStaffAuth()
  if (!auth || auth.status !== "authenticated" || !auth.session || auth.busy === "logout") return null
  const identity = auth.session.user.id + ":" + auth.session.expiresAt
  return <StaffHistoryContent key={identity} identity={identity} auth={auth} />
}
function StaffHistoryContent({ identity, auth }: { identity: string; auth: StaffAuth }) {
  const params = useSearchParams()
  const query = parseStaffHistoryQuery(params.toString()) || { ...DEFAULT_STAFF_HISTORY_QUERY }
  const setQuery = (next: StaffJobsQuery) => window.history.replaceState(null, "", staffHistoryHref(next))
  const [retry, setRetry] = useState(0)
  const [result, setResult] = useState<HistoryResult>({ key: "", data: null, error: "", loading: true })
  const alert = useRef<HTMLDivElement>(null), generation = useRef(0)
  const serialized = staffJobsQueryString(query), key = identity + ":" + serialized + ":" + retry
  const { checkSession } = auth
  useEffect(() => {
    const version = ++generation.current, controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), 15_000)
    setResult({ key, data: null, error: "", loading: true })
    void (async () => {
      try {
        const data = await readStaffHistory(query, controller.signal)
        if (controller.signal.aborted || version !== generation.current) return
        setResult({ key, data, error: "", loading: false })
      } catch (error) {
        if (version !== generation.current) return
        setResult({ key, data: null, error: staffHistoryMessage(error), loading: false })
        if (error instanceof StaffHistoryRequestError && [401, 403].includes(error.status)) await checkSession()
      } finally { window.clearTimeout(timer) }
    })()
    return () => { ++generation.current; controller.abort(); window.clearTimeout(timer) }
  }, [checkSession, serialized, key])
  const current = result.key === key ? result : null, loading = !current || current.loading, payload = current?.data || null
  useEffect(() => { if (current?.error) alert.current?.focus() }, [current?.error])

  return <div data-staff-history className="staff-history min-w-0 space-y-6">
    <StaffPageHeader title="Lịch sử công việc" description="Các phân công của bạn đã được ghi nhận ở trạng thái hoàn thành." action={<Button variant="outline" render={<Link href="/ho-so" />} nativeButton={false}>Về cá nhân</Button>} />
    <section className="staff-history-controls" aria-label="Tùy chọn lịch sử"><div className="staff-history-total" role="status" aria-live="polite"><span><HistoryIcon aria-hidden="true" /></span><div><p>Phân công đã hoàn thành</p><strong data-history-total={payload?.pagination.total}>{loading ? "Đang tải..." : payload ? payload.pagination.total : "—"}</strong><p>Toàn bộ lịch hẹn · Giờ Việt Nam (UTC+7)</p></div></div><div className="staff-history-selects"><div className="ch-field"><label htmlFor="staff-history-sort">Thứ tự lịch hẹn</label><select id="staff-history-sort" value={query.sort} onChange={event => setQuery({ ...query, sort: event.target.value as "asc" | "desc", page: 1 })}><option value="desc">Mới nhất</option><option value="asc">Cũ nhất</option></select></div><div className="ch-field"><label htmlFor="staff-history-page-size">Mỗi trang</label><select id="staff-history-page-size" value={query.pageSize} onChange={event => setQuery({ ...query, pageSize: Number(event.target.value), page: 1 })}>{Array.from(new Set([2, 20, 50, 100, query.pageSize])).sort((a, b) => a - b).map(size => <option key={size} value={size}>{size} việc</option>)}</select></div></div></section>
    <div className="staff-history-notice" role="note"><InfoIcon aria-hidden="true" /><p>Đây là lịch sử phân công của bạn, không phải lịch sử trạng thái của toàn bộ đơn dịch vụ. Lịch hẹn không phải ngày hoàn thành; thời điểm kết thúc ghi nhận chỉ hiển thị khi đã được cung cấp. Lịch sử trạng thái đơn dịch vụ có thể chưa khả dụng trong trang Chi tiết.</p></div>
    {loading ? <section role="status" aria-live="polite" aria-busy="true" className="staff-history-loading"><span className="staff-state-icon"><HistoryIcon aria-hidden="true" /></span><p>Đang tải lịch sử công việc...</p></section> : current?.error ? <div role="alert" tabIndex={-1} ref={alert} className="staff-history-error"><h2>Chưa thể tải lịch sử công việc</h2><p>{current.error}</p><Button variant="outline" onClick={() => setRetry(value => value + 1)}>Thử lại</Button></div> : payload && <>
      <p className="staff-history-page-caption" data-history-loaded={payload.data.length}>Đang hiển thị {payload.data.length} phân công trên trang {payload.pagination.page}.</p>
      {payload.data.length === 0 ? <StaffEmpty title={payload.pagination.total === 0 ? "Chưa có phân công đã hoàn thành" : "Trang này không có kết quả"} description={payload.pagination.total === 0 ? "Lịch sử sẽ hiển thị khi công việc của bạn được ghi nhận hoàn thành." : "Quay về trang đầu để xem các phân công đã hoàn thành."} action={query.page > 1 ? <Button variant="outline" onClick={() => setQuery({ ...query, page: 1 })}>Về trang đầu</Button> : undefined} /> : <>
        <div className="staff-history-cards grid min-w-0 gap-4 xl:hidden">{payload.data.map(job => <Card key={job.assignmentId} role="article" data-history-assignment-id={job.assignmentId} className="staff-history-card"><CardContent><header><p>Phân công <strong>#{job.assignmentId}</strong></p><ToneBadge tone="success">Đã hoàn thành</ToneBadge></header><HistoryServices job={job} /><HistoryTimes job={job} /><Button variant="outline" render={<Link href={staffHistoryDetailHref(job.assignmentId)} />} nativeButton={false} aria-label={"Xem chi tiết phân công " + job.assignmentId}>Xem chi tiết<ArrowRightIcon aria-hidden="true" /></Button></CardContent></Card>)}</div>
        <div className="staff-history-table-frame hidden xl:block"><table className="staff-history-table"><caption className="sr-only">Phân công đã hoàn thành của bạn</caption><colgroup><col className="w-[17%]" /><col className="w-[29%]" /><col className="w-[28%]" /><col className="w-[14%]" /><col className="w-[12%]" /></colgroup><thead><tr>{["Phân công", "Dịch vụ", "Thời gian (UTC+7)", "Trạng thái", "Thao tác"].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{payload.data.map(job => <tr key={job.assignmentId} data-history-assignment-id={job.assignmentId}><td><p className="staff-history-reference">#{job.assignmentId}</p></td><td><HistoryServices job={job} /></td><td><HistoryTimes job={job} /></td><td><ToneBadge tone="success">Đã hoàn thành</ToneBadge></td><td><Link href={staffHistoryDetailHref(job.assignmentId)} aria-label={"Xem chi tiết phân công " + job.assignmentId} className="staff-history-detail-link">Chi tiết<ArrowRightIcon aria-hidden="true" /></Link></td></tr>)}</tbody></table></div>
      </>}
      {(payload.pagination.totalPages > 1 || query.page > 1) && <nav aria-label="Phân trang lịch sử" className="staff-history-pagination"><p>{payload.data.length ? ((query.page - 1) * query.pageSize + 1) + "–" + ((query.page - 1) * query.pageSize + payload.data.length) + " / " + payload.pagination.total + " phân công" : payload.pagination.total + " phân công"}</p><div><Button variant="outline" aria-label="Trang trước" disabled={query.page <= 1} onClick={() => setQuery({ ...query, page: query.page - 1 })}>Trước</Button><span aria-live="polite">Trang {payload.pagination.page} / {Math.max(1, payload.pagination.totalPages)}</span><Button variant="outline" aria-label="Trang sau" disabled={query.page >= payload.pagination.totalPages || query.page >= 100_000} onClick={() => setQuery({ ...query, page: query.page + 1 })}>Sau</Button></div></nav>}
    </>}
  </div>
}
