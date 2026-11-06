"use client"

import { useEffect, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { ArrowRightIcon, CalendarDaysIcon, MapPinIcon, RefreshCwIcon, RotateCcwIcon, UserRoundIcon } from "lucide-react"
import { AreaLink as Link } from "@/components/shared/area-routes"
import { ToneBadge } from "@/components/shared/status-badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { useStaffAuth } from "./staff-auth-session"
import { subscribeStaffJobsRevalidation } from "./staff-jobs-revalidation"
import { StaffEmpty, StaffLoading, StaffPageHeader } from "./staff-shared"
import {
  DEFAULT_STAFF_JOBS_QUERY, REMOTE_STAFF_STATUS_LABEL, formatStaffJobTime, parseStaffJobsPayload, staffJobsQueryString,
  parseStaffJobsQuery, staffJobDetailHref, staffJobsListHref,
  type RemoteStaffJob, type RemoteStaffJobsPayload, type StaffJobsQuery,
} from "./staff-jobs-remote-model"

type StaffAuth = NonNullable<ReturnType<typeof useStaffAuth>>
type JobsResult = { key: string; data: RemoteStaffJobsPayload | null; error: string; loading: boolean }
class JobsRequestError extends Error {
  constructor(readonly status: number, readonly code: string) { super("Staff jobs request failed") }
}

function requestMessage(reason: unknown): string {
  if (!(reason instanceof JobsRequestError)) return "Chưa thể tải công việc. Vui lòng kiểm tra kết nối và thử lại."
  if (reason.status === 401) return "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại để xem công việc."
  if (reason.code === "STAFF_SESSION_CHANGED") return "Tài khoản đăng nhập đã thay đổi. Đang kiểm tra lại phiên đăng nhập."
  if (reason.status === 403) return "Tài khoản hiện không có quyền xem danh sách công việc. Vui lòng liên hệ người quản lý."
  if (reason.code === "AUTH_UNAVAILABLE") return "Chưa thể kiểm tra phiên đăng nhập. Vui lòng thử lại sau."
  if (reason.status === 429) return "Bạn đã gửi nhiều yêu cầu. Vui lòng chờ một lúc rồi thử lại."
  if (reason.status === 400) return "Bộ lọc công việc chưa hợp lệ. Vui lòng đặt lại bộ lọc và thử lại."
  if (reason.status === 502 || reason.code === "STAFF_INVALID_RESPONSE") return "Thông tin công việc chưa đọc được. Vui lòng thử lại hoặc liên hệ người quản lý."
  return "Danh sách công việc hiện chưa khả dụng. Vui lòng thử lại sau."
}

async function readJobs(query: string, signal: AbortSignal, accountId: string): Promise<RemoteStaffJobsPayload> {
  const response = await fetch(`/api/staff/jobs?${query}`, {
    method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error", signal, headers: { Accept: "application/json", "X-Staff-Account-Id": accountId },
  })
  if (response.status === 401 || response.status === 403) throw new JobsRequestError(response.status, "ACCESS_DENIED")
  if (response.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") throw new JobsRequestError(502, "STAFF_INVALID_RESPONSE")
  const reader = response.body?.getReader()
  if (!reader) throw new JobsRequestError(502, "STAFF_INVALID_RESPONSE")
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > 2_097_152) { await reader.cancel(); throw new JobsRequestError(502, "STAFF_INVALID_RESPONSE") }
      chunks.push(chunk.value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  let body: unknown
  try { body = JSON.parse(new TextDecoder().decode(bytes)) } catch { throw new JobsRequestError(502, "STAFF_INVALID_RESPONSE") }
  if (!response.ok) {
    const code = body && typeof body === "object" && "error" in body && body.error && typeof body.error === "object"
      && "code" in body.error && typeof body.error.code === "string" ? body.error.code : "REQUEST_FAILED"
    throw new JobsRequestError(response.status, code)
  }
  const payload = parseStaffJobsPayload(body)
  if (!payload) throw new JobsRequestError(502, "STAFF_INVALID_RESPONSE")
  return payload
}

function JobBadge({ job }: { job: RemoteStaffJob }) {
  const tone = ({ WAITING: "warning", ACCEPTED: "info", IN_PROGRESS: "primary", DONE: "success", CANCELLED: "danger" } as const)[job.status]
  return <ToneBadge tone={tone} className="h-auto max-w-full py-1 whitespace-normal break-words">{REMOTE_STAFF_STATUS_LABEL[job.status]}</ToneBadge>
}

function JobServices({ job, heading = false }: { job: RemoteStaffJob; heading?: boolean }) {
  return job.services.length ? <ul className="staff-job-services">{job.services.map((service, index) => <li key={service.serviceId + ":" + index}>
    {heading ? <h2>{service.name || "Chưa có tên dịch vụ"}</h2> : <p>{service.name || "Chưa có tên dịch vụ"}</p>}
    <span>{service.quantity}{service.unit ? " " + service.unit : ""}</span>
  </li>)}</ul> : <p className="staff-job-missing">Chưa có thông tin dịch vụ</p>
}

function JobSchedule({ job }: { job: RemoteStaffJob }) {
  return <div className="staff-job-schedule">{job.scheduledAt ? <time dateTime={job.scheduledAt}>{formatStaffJobTime(job.scheduledAt)}</time> : <span>Chưa có lịch thực hiện</span>}{job.expectedEndAt && <p>Kết thúc dự kiến: <time dateTime={job.expectedEndAt}>{formatStaffJobTime(job.expectedEndAt)}</time></p>}{job.durationMinutes !== null && <span className="staff-job-duration">{job.durationMinutes} phút</span>}</div>
}

function JobCard({ job, href }: { job: RemoteStaffJob; href: string }) {
  return <Card role="article" aria-label={"Phân công " + job.assignmentId} data-assignment-id={job.assignmentId} className="staff-job-card min-w-0 py-0">
    <CardContent className="staff-job-card-content">
      <div className="staff-job-card-heading"><p className="staff-job-reference">Phân công <strong>#{job.assignmentId}</strong></p><JobBadge job={job} /></div>
      <div className="staff-job-card-service"><JobServices job={job} heading /><p className="staff-job-order">Đơn dịch vụ #{job.orderId}</p></div>
      <dl className="staff-job-info">
        <div><CalendarDaysIcon aria-hidden="true" className="staff-job-info-icon" /><dt className="sr-only">Lịch thực hiện</dt><dd><JobSchedule job={job} /></dd></div>
        <div><UserRoundIcon aria-hidden="true" className="staff-job-info-icon" /><dt className="sr-only">Khách hàng</dt><dd>{job.contact.name || "Chưa có tên khách hàng"}</dd></div>
        <div><MapPinIcon aria-hidden="true" className="staff-job-info-icon" /><dt className="sr-only">Địa chỉ</dt><dd>{job.contact.address || "Chưa có địa chỉ"}</dd></div>
      </dl>
      <Button variant="outline" className="staff-job-detail-button" aria-label={"Xem chi tiết phân công " + job.assignmentId} render={<Link href={href} />} nativeButton={false}>Xem chi tiết<ArrowRightIcon aria-hidden="true" /></Button>
    </CardContent>
  </Card>
}


/** A different account or session mounts a fresh list; no assignment data is stored in the browser. */
export function StaffJobsRemote() {
  const auth = useStaffAuth()
  if (!auth || auth.status !== "authenticated" || !auth.session || auth.busy === "logout") return <StaffLoading />
  const identity = `${auth.session.user.id}:${auth.session.expiresAt}`
  return <StaffJobsList key={identity} identity={identity} auth={auth} />
}

function StaffJobsList({ identity, auth }: { identity: string; auth: StaffAuth }) {
  const searchParams = useSearchParams()
  const query = parseStaffJobsQuery(searchParams.toString()) || { ...DEFAULT_STAFF_JOBS_QUERY }
  const setQuery = (change: StaffJobsQuery | ((current: StaffJobsQuery) => StaffJobsQuery)) => {
    const current = parseStaffJobsQuery(window.location.search) || { ...DEFAULT_STAFF_JOBS_QUERY }
    const next = typeof change === "function" ? change(current) : change
    // Next.js synchronizes native history with useSearchParams without reloading the list.
    window.history.replaceState(null, "", staffJobsListHref(next))
  }
  const [retry, setRetry] = useState(0)
  const [result, setResult] = useState<JobsResult>({ key: "", data: null, error: "", loading: true })
  const generation = useRef(0)
  const readBusy = useRef(true)
  const errorAlert = useRef<HTMLDivElement>(null)
  const queryString = staffJobsQueryString(query)
  const requestKey = `${identity}:${queryString}:${retry}`
  const { checkSession } = auth

  useEffect(() => {
    const version = ++generation.current
    readBusy.current = true
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), 15_000)
    setResult({ key: requestKey, data: null, error: "", loading: true })
    void (async () => {
      try {
        const data = await readJobs(queryString, controller.signal, auth.session!.user.id)
        if (controller.signal.aborted || version !== generation.current) return
        setResult({ key: requestKey, data, error: "", loading: false })
      } catch (reason) {
        if (version !== generation.current) return
        // Remove the old assignment payload before checking the session again.
        setResult({ key: requestKey, data: null, error: requestMessage(reason), loading: false })
        if (reason instanceof JobsRequestError && (reason.status === 401 || reason.status === 403 || reason.code === "STAFF_SESSION_CHANGED")) await checkSession()
      } finally { window.clearTimeout(timer); if (version === generation.current) readBusy.current = false }
    })()
    return () => { ++generation.current; controller.abort(); window.clearTimeout(timer) }
  }, [checkSession, queryString, requestKey])

  useEffect(() => subscribeStaffJobsRevalidation(() => setRetry((value) => value + 1), () => readBusy.current), [requestKey])
  const reload = () => {
    if (readBusy.current) return
    readBusy.current = true
    setRetry((value) => value + 1)
  }

  const current = result.key === requestKey ? result : null
  const loading = !current || current.loading
  const payload = current?.data || null
  const hasFilters = query.status !== "" || query.sort !== "asc" || query.pageSize !== 20
  const reset = () => setQuery({ ...DEFAULT_STAFF_JOBS_QUERY })
  useEffect(() => { if (current?.error) errorAlert.current?.focus() }, [current?.error])

  return <div className="staff-jobs min-w-0 space-y-6">
    <StaffPageHeader title="Công việc được phân công" description="Lịch hẹn, thông tin và tiến độ công việc của bạn." action={<Button variant="outline" disabled={loading} aria-label="Tải lại danh sách công việc" onClick={reload}><RefreshCwIcon aria-hidden="true" className="size-4" />Tải lại</Button>} />
    <section aria-label="Lọc công việc" className="staff-jobs-filters">
      <div className="staff-jobs-filter-grid">
        <div className="ch-field staff-jobs-status-field"><label htmlFor="staff-jobs-status">Trạng thái công việc</label><select id="staff-jobs-status" value={query.status} onChange={(event) => setQuery((value) => ({ ...value, status: event.target.value as StaffJobsQuery["status"], page: 1 }))}><option value="">Tất cả trạng thái</option>{Object.entries(REMOTE_STAFF_STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
        <div className="ch-field"><label htmlFor="staff-jobs-sort">Lịch thực hiện</label><select id="staff-jobs-sort" value={query.sort} onChange={(event) => setQuery((value) => ({ ...value, sort: event.target.value as StaffJobsQuery["sort"], page: 1 }))}><option value="asc">Tăng dần</option><option value="desc">Giảm dần</option></select></div>
        <div className="ch-field"><label htmlFor="staff-jobs-page-size">Mỗi trang</label><select id="staff-jobs-page-size" value={query.pageSize} onChange={(event) => setQuery((value) => ({ ...value, pageSize: Number(event.target.value), page: 1 }))}>{Array.from(new Set([2, 8, 20, 50, query.pageSize])).sort((a, b) => a - b).map((size) => <option key={size} value={size}>{size} việc</option>)}</select></div>
      </div>
      <div className="staff-jobs-results-heading"><p role="status" aria-live="polite">{loading ? "Đang tải danh sách công việc..." : payload ? <><strong>{payload.pagination.total}</strong> công việc{query.status ? " phù hợp" : " được phân công"}</> : "Chưa tải được danh sách công việc"}<span>Giờ Việt Nam (UTC+7)</span></p><Button variant="outline" className="staff-jobs-reset" aria-label="Đặt lại bộ lọc" title="Đặt lại bộ lọc" disabled={!hasFilters && query.page === 1} onClick={reset}><RotateCcwIcon aria-hidden="true" className="size-4" /><span>Đặt lại bộ lọc</span></Button></div>
    </section>
    {loading ? <StaffLoading /> : current?.error ? <div ref={errorAlert} tabIndex={-1} role="alert" className="staff-jobs-error"><h2>Chưa thể tải công việc</h2><p>{current.error}</p><Button variant="outline" onClick={() => setRetry((value) => value + 1)}><RotateCcwIcon aria-hidden="true" className="size-4" />Thử lại</Button></div> : payload && <>
      {payload.data.length === 0 ? <StaffEmpty title={query.status ? "Không có công việc phù hợp" : query.page > 1 ? "Trang này chưa có công việc" : "Bạn chưa có công việc được phân công"} description={query.status ? "Thử thay đổi bộ lọc trạng thái để xem các công việc khác." : query.page > 1 ? "Vui lòng quay về trang đầu để xem danh sách hiện có." : "Danh sách sẽ hiển thị khi có công việc được phân công cho bạn."} action={hasFilters || query.page > 1 ? <Button variant="outline" onClick={reset}>Về danh sách mặc định</Button> : undefined} /> : <>
        <div className="staff-jobs-cards grid min-w-0 gap-4 xl:hidden">{payload.data.map((job) => <JobCard key={job.assignmentId} job={job} href={staffJobDetailHref(job.assignmentId, query)} />)}</div>
        <div className="staff-jobs-table-frame hidden min-w-0 xl:block"><table className="staff-jobs-table"><caption className="sr-only">Danh sách công việc được phân công cho bạn</caption><colgroup><col className="w-[23%]" /><col className="w-[25%]" /><col className="w-[24%]" /><col className="w-[16%]" /><col className="w-[12%]" /></colgroup><thead><tr>{["Phân công / Dịch vụ", "Khách hàng / Địa chỉ", "Lịch thực hiện", "Trạng thái", "Thao tác"].map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{payload.data.map((job) => <tr key={job.assignmentId} data-assignment-id={job.assignmentId}>
          <td><p className="staff-job-reference">Phân công <strong>#{job.assignmentId}</strong></p><p className="staff-job-order">Đơn dịch vụ #{job.orderId}</p><JobServices job={job} /></td>
          <td><p className="staff-job-customer">{job.contact.name || "Chưa có tên khách hàng"}</p><p className="staff-job-address"><MapPinIcon aria-hidden="true" className="size-3.5 shrink-0" /><span>{job.contact.address || "Chưa có địa chỉ"}</span></p></td>
          <td><JobSchedule job={job} /></td><td><JobBadge job={job} /></td>
          <td><Link href={staffJobDetailHref(job.assignmentId, query)} aria-label={"Xem chi tiết phân công " + job.assignmentId} className="staff-job-table-detail">Chi tiết<ArrowRightIcon className="size-4" aria-hidden="true" /></Link></td>
        </tr>)}</tbody></table></div>
      </>}
      {(payload.pagination.totalPages > 1 || query.page > 1) && <nav aria-label="Phân trang công việc" className="staff-jobs-pagination"><p>{payload.data.length ? ((payload.pagination.page - 1) * payload.pagination.pageSize + 1) + "–" + ((payload.pagination.page - 1) * payload.pagination.pageSize + payload.data.length) + " / " + payload.pagination.total + " công việc" : payload.pagination.total + " công việc"}</p><div><Button variant="outline" aria-label="Trang trước" disabled={query.page <= 1} onClick={() => setQuery((value) => ({ ...value, page: value.page - 1 }))}>Trước</Button><span aria-live="polite">Trang {payload.pagination.page} / {Math.max(1, payload.pagination.totalPages)}</span><Button variant="outline" aria-label="Trang sau" disabled={query.page >= payload.pagination.totalPages || query.page >= 100_000} onClick={() => setQuery((value) => ({ ...value, page: value.page + 1 }))}>Sau</Button></div></nav>}
    </>}
  </div>
}
