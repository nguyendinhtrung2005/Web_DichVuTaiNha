"use client"

import { useEffect, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { ArrowRightIcon, CalendarDaysIcon, MapPinIcon, RotateCcwIcon, UserRoundIcon } from "lucide-react"
import { AreaLink as Link } from "@/components/shared/area-routes"
import { ToneBadge } from "@/components/shared/status-badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { useStaffAuth } from "./staff-auth-session"
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
  if (reason.status === 403) return "Tài khoản hiện không có quyền xem danh sách công việc. Vui lòng liên hệ người quản lý."
  if (reason.code === "AUTH_UNAVAILABLE") return "Chưa thể kiểm tra phiên đăng nhập. Vui lòng thử lại sau."
  if (reason.status === 429) return "Bạn đã gửi nhiều yêu cầu. Vui lòng chờ một lúc rồi thử lại."
  if (reason.status === 400) return "Bộ lọc công việc chưa hợp lệ. Vui lòng đặt lại bộ lọc và thử lại."
  if (reason.status === 502 || reason.code === "STAFF_INVALID_RESPONSE") return "Thông tin công việc chưa đọc được. Vui lòng thử lại hoặc liên hệ người quản lý."
  return "Danh sách công việc hiện chưa khả dụng. Vui lòng thử lại sau."
}

async function readJobs(query: string, signal: AbortSignal): Promise<RemoteStaffJobsPayload> {
  const response = await fetch(`/api/staff/jobs?${query}`, {
    method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error", signal, headers: { Accept: "application/json" },
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

function JobServices({ job }: { job: RemoteStaffJob }) {
  return job.services.length ? <ul className="m-0 list-none space-y-2 p-0">{job.services.map((service, index) => <li key={`${service.serviceId}:${index}`} className="min-w-0 break-words leading-6"><span className="font-medium">{service.name || "Chưa có tên dịch vụ"}</span><span className="mt-1 block text-xs font-normal text-muted-foreground">{service.quantity}{service.unit ? ` ${service.unit}` : ""}</span></li>)}</ul> : <p className="m-0 text-sm leading-6 text-muted-foreground">Chưa có thông tin dịch vụ</p>
}

function JobSchedule({ job }: { job: RemoteStaffJob }) {
  return <div className="min-w-0 space-y-1.5 break-words leading-6">{job.scheduledAt ? <time dateTime={job.scheduledAt}>{formatStaffJobTime(job.scheduledAt)}</time> : <span>Chưa có lịch thực hiện</span>}{job.expectedEndAt && <p className="m-0 text-xs leading-6 text-muted-foreground">Kết thúc dự kiến: <time dateTime={job.expectedEndAt}>{formatStaffJobTime(job.expectedEndAt)}</time></p>}{job.durationMinutes !== null && <p className="m-0 text-xs text-muted-foreground">{job.durationMinutes} phút</p>}</div>
}

function JobCard({ job, href }: { job: RemoteStaffJob; href: string }) {
  return <Card data-assignment-id={job.assignmentId} className="min-w-0 rounded-2xl shadow-none ring-border [--card-spacing:--spacing(5)]"><CardContent className="flex min-w-0 flex-col gap-4"><div className="flex min-w-0 flex-wrap items-center justify-between gap-3"><p className="m-0 min-w-0 break-all text-xs font-semibold text-muted-foreground">Phân công #{job.assignmentId}</p><JobBadge job={job} /></div><div className="min-w-0"><h2 className="m-0 mb-3 break-all text-sm font-semibold">Đơn dịch vụ #{job.orderId}</h2><JobServices job={job} /></div><dl className="m-0 space-y-3 text-sm"><div className="flex min-w-0 items-start gap-2.5"><CalendarDaysIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" /><dt className="sr-only">Lịch thực hiện</dt><dd className="m-0 min-w-0"><JobSchedule job={job} /></dd></div><div className="flex min-w-0 items-start gap-2.5"><UserRoundIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" /><dt className="sr-only">Khách hàng</dt><dd className="m-0 min-w-0 break-words">{job.contact.name || "Chưa có tên khách hàng"}</dd></div><div className="flex min-w-0 items-start gap-2.5"><MapPinIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" /><dt className="sr-only">Địa chỉ</dt><dd className="m-0 min-w-0 break-words leading-6">{job.contact.address || "Chưa có địa chỉ"}</dd></div></dl><Button variant="outline" className="mt-auto min-h-11 w-full justify-between" aria-label={`Xem chi tiết phân công ${job.assignmentId}`} render={<Link href={href} />} nativeButton={false}>Xem chi tiết<ArrowRightIcon aria-hidden="true" /></Button></CardContent></Card>
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
  const errorAlert = useRef<HTMLDivElement>(null)
  const queryString = staffJobsQueryString(query)
  const requestKey = `${identity}:${queryString}:${retry}`
  const { checkSession } = auth

  useEffect(() => {
    const version = ++generation.current
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), 15_000)
    setResult({ key: requestKey, data: null, error: "", loading: true })
    void (async () => {
      try {
        const data = await readJobs(queryString, controller.signal)
        if (controller.signal.aborted || version !== generation.current) return
        setResult({ key: requestKey, data, error: "", loading: false })
      } catch (reason) {
        if (version !== generation.current) return
        // Remove the old assignment payload before checking the session again.
        setResult({ key: requestKey, data: null, error: requestMessage(reason), loading: false })
        if (reason instanceof JobsRequestError && (reason.status === 401 || reason.status === 403)) await checkSession()
      } finally { window.clearTimeout(timer) }
    })()
    return () => { ++generation.current; controller.abort(); window.clearTimeout(timer) }
  }, [checkSession, queryString, requestKey])

  const current = result.key === requestKey ? result : null
  const loading = !current || current.loading
  const payload = current?.data || null
  const hasFilters = query.status !== "" || query.sort !== "asc" || query.pageSize !== 20
  const reset = () => setQuery({ ...DEFAULT_STAFF_JOBS_QUERY })
  useEffect(() => { if (current?.error) errorAlert.current?.focus() }, [current?.error])

  return <div className="min-w-0 space-y-6">
    <StaffPageHeader title="Công việc được phân công" description="Kiểm tra lịch hẹn và theo dõi các công việc được phân công cho bạn." />
    <section aria-label="Lọc công việc" className="min-w-0 rounded-2xl border border-border bg-white p-5 sm:p-6">
      <div className="grid min-w-0 gap-5 sm:grid-cols-2 xl:grid-cols-3">
        <div className="ch-field"><label htmlFor="staff-jobs-status">Trạng thái</label><select id="staff-jobs-status" value={query.status} onChange={(event) => setQuery((value) => ({ ...value, status: event.target.value as StaffJobsQuery["status"], page: 1 }))}><option value="">Tất cả trạng thái</option>{Object.entries(REMOTE_STAFF_STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
        <div className="ch-field"><label htmlFor="staff-jobs-sort">Sắp xếp lịch thực hiện</label><select id="staff-jobs-sort" value={query.sort} onChange={(event) => setQuery((value) => ({ ...value, sort: event.target.value as StaffJobsQuery["sort"], page: 1 }))}><option value="asc">Thời gian: tăng dần</option><option value="desc">Thời gian: giảm dần</option></select></div>
        <div className="ch-field"><label htmlFor="staff-jobs-page-size">Số công việc mỗi trang</label><select id="staff-jobs-page-size" value={query.pageSize} onChange={(event) => setQuery((value) => ({ ...value, pageSize: Number(event.target.value), page: 1 }))}>{Array.from(new Set([2, 8, 20, 50, query.pageSize])).sort((a, b) => a - b).map((size) => <option key={size} value={size}>{size} công việc / trang</option>)}</select></div>
      </div>
      <div className="mt-5 flex min-w-0 flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between"><p role="status" aria-live="polite" className="m-0 min-w-0 text-sm leading-6 text-muted-foreground">{loading ? "Đang tải danh sách công việc..." : payload ? <><span className="font-semibold text-foreground">{payload.pagination.total}</span> công việc{query.status ? " phù hợp" : " được phân công"}</> : "Chưa tải được danh sách công việc"}<span className="mt-1 block text-xs">Thời gian hiển thị theo giờ Việt Nam (UTC+07).</span></p><Button variant="outline" className="min-h-11 w-full sm:w-auto" disabled={!hasFilters && query.page === 1} onClick={reset}><RotateCcwIcon aria-hidden="true" />Đặt lại bộ lọc</Button></div>
    </section>
    {loading ? <StaffLoading /> : current?.error ? <div ref={errorAlert} tabIndex={-1} role="alert" className="min-w-0 rounded-2xl border border-red-200 bg-white px-5 py-8 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"><h2 className="m-0 text-lg font-semibold">Chưa thể tải công việc</h2><p className="mt-3 mb-6 text-sm leading-7 text-muted-foreground">{current.error}</p><Button variant="outline" className="min-h-11" onClick={() => setRetry((value) => value + 1)}>Thử lại</Button></div> : payload && <>
      {payload.data.length === 0 ? <StaffEmpty title={query.status ? "Không có công việc phù hợp" : query.page > 1 ? "Trang này chưa có công việc" : "Bạn chưa có công việc được phân công"} description={query.status ? "Thử thay đổi bộ lọc trạng thái để xem các công việc khác." : query.page > 1 ? "Vui lòng quay về trang đầu để xem danh sách hiện có." : "Danh sách sẽ hiển thị khi có công việc được phân công cho bạn."} action={hasFilters || query.page > 1 ? <Button variant="outline" className="min-h-11" onClick={reset}>Về danh sách mặc định</Button> : undefined} /> : <>
        <div className="grid min-w-0 gap-4 xl:hidden">{payload.data.map((job) => <JobCard key={job.assignmentId} job={job} href={staffJobDetailHref(job.assignmentId, query)} />)}</div>
        <div className="hidden min-w-0 rounded-2xl border border-border bg-white xl:block"><table className="w-full table-fixed border-collapse text-left text-sm"><caption className="sr-only">Danh sách công việc được phân công cho bạn</caption><colgroup><col className="w-[21%]" /><col className="w-[26%]" /><col className="w-[24%]" /><col className="w-[16%]" /><col className="w-[13%]" /></colgroup><thead className="bg-slate-50 text-xs text-muted-foreground"><tr>{["Phân công / Dịch vụ", "Khách hàng / Địa chỉ", "Lịch thực hiện", "Trạng thái", "Thao tác"].map((label) => <th key={label} scope="col" className="px-4 py-4 font-semibold first:rounded-tl-2xl last:rounded-tr-2xl">{label}</th>)}</tr></thead><tbody>{payload.data.map((job) => <tr key={job.assignmentId} data-assignment-id={job.assignmentId} className="border-t border-border transition-colors hover:bg-slate-50/70"><td className="min-w-0 px-4 py-5 align-top"><p className="m-0 break-all font-semibold">Phân công #{job.assignmentId}</p><p className="mt-2 mb-4 break-all text-xs text-muted-foreground">Đơn #{job.orderId}</p><JobServices job={job} /></td><td className="px-4 py-5 align-top"><p className="m-0 break-words leading-6 font-medium">{job.contact.name || "Chưa có tên khách hàng"}</p><p className="mt-2 mb-0 break-words text-xs leading-6 text-muted-foreground">{job.contact.address || "Chưa có địa chỉ"}</p></td><td className="px-4 py-5 align-top"><JobSchedule job={job} /></td><td className="px-4 py-5 align-top"><JobBadge job={job} /></td><td className="px-3 py-3 align-top"><Link href={staffJobDetailHref(job.assignmentId, query)} aria-label={`Xem chi tiết phân công ${job.assignmentId}`} className="inline-flex min-h-11 min-w-0 flex-wrap items-center gap-1 rounded-lg text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">Chi tiết<ArrowRightIcon className="size-4" aria-hidden="true" /></Link></td></tr>)}</tbody></table></div>
      </>}
      {(payload.pagination.totalPages > 1 || query.page > 1) && <nav aria-label="Phân trang công việc" className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><p className="m-0 text-sm leading-6 text-muted-foreground">{payload.data.length ? `${(payload.pagination.page - 1) * payload.pagination.pageSize + 1}–${(payload.pagination.page - 1) * payload.pagination.pageSize + payload.data.length} / ${payload.pagination.total} công việc` : `${payload.pagination.total} công việc`}</p><div className="flex w-full min-w-0 flex-wrap items-center justify-between gap-3 sm:w-auto"><Button variant="outline" className="min-h-11" disabled={query.page <= 1} onClick={() => setQuery((value) => ({ ...value, page: value.page - 1 }))}>Trước</Button><span aria-live="polite" className="text-sm leading-6 text-muted-foreground">Trang {payload.pagination.page} / {Math.max(1, payload.pagination.totalPages)}</span><Button variant="outline" className="min-h-11" disabled={query.page >= payload.pagination.totalPages || query.page >= 100_000} onClick={() => setQuery((value) => ({ ...value, page: value.page + 1 }))}>Sau</Button></div></nav>}
    </>}
  </div>
}
