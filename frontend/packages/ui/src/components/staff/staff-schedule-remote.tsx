"use client"

import { useEffect, useRef, useState, type FormEvent } from "react"
import { useSearchParams } from "next/navigation"
import { ArrowRightIcon, CalendarDaysIcon, ChevronLeftIcon, ChevronRightIcon, MapPinIcon } from "lucide-react"
import { AreaLink as Link } from "@/components/shared/area-routes"
import { ToneBadge } from "@/components/shared/status-badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useStaffAuth } from "./staff-auth-session"
import { StaffEmpty, StaffLoading, StaffPageHeader } from "./staff-shared"
import { REMOTE_STAFF_STATUS_LABEL, type RemoteStaffJob, type RemoteStaffJobsPayload } from "./staff-jobs-remote-model"
import {
  STAFF_CALENDAR_VIEWS, calendarRange, defaultStaffScheduleQuery, formatStaffScheduleTime, groupScheduleByDay, parseStaffScheduleLocation,
  parseStaffSchedulePayload, scheduleDayLabel, shiftScheduleQuery, staffScheduleHref, staffScheduleQueryString,
  validScheduleDay, validateScheduleRange, vietnamDayKey, type StaffCalendarView, type StaffScheduleQuery,
} from "./staff-schedule-remote-model"

type StaffAuth = NonNullable<ReturnType<typeof useStaffAuth>>
type ScheduleResult = { key: string; data: RemoteStaffJobsPayload | null; error: string; loading: boolean }
class ScheduleRequestError extends Error { constructor(readonly status: number, readonly code: string) { super("Staff schedule request failed") } }
function scheduleMessage(error: unknown) {
  if (!(error instanceof ScheduleRequestError)) return "Chưa thể tải lịch làm việc. Vui lòng kiểm tra kết nối và thử lại."
  if (error.status === 401) return "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại."
  if (error.status === 403) return "Tài khoản hiện không có quyền xem lịch làm việc. Vui lòng liên hệ người quản lý."
  if (error.code === "AUTH_UNAVAILABLE") return "Chưa thể kiểm tra phiên đăng nhập. Vui lòng thử lại sau."
  if (error.status === 400) return "Khoảng ngày hoặc bộ lọc chưa hợp lệ. Vui lòng kiểm tra lại."
  if (error.status === 429) return "Bạn đã gửi nhiều yêu cầu. Vui lòng chờ một lúc rồi thử lại."
  if (error.status === 502) return "Thông tin lịch làm việc chưa đọc được. Vui lòng thử lại hoặc liên hệ người quản lý."
  return "Lịch làm việc hiện chưa khả dụng. Vui lòng thử lại sau."
}
async function readSchedule(query: StaffScheduleQuery, signal: AbortSignal): Promise<RemoteStaffJobsPayload> {
  const response = await fetch(`/api/staff/schedule?${staffScheduleQueryString(query)}`, { method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error", signal, headers: { Accept: "application/json" } })
  if ([401, 403].includes(response.status)) throw new ScheduleRequestError(response.status, "ACCESS_DENIED")
  if (response.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") throw new ScheduleRequestError(502, "STAFF_INVALID_RESPONSE")
  const reader = response.body?.getReader()
  if (!reader) throw new ScheduleRequestError(502, "STAFF_INVALID_RESPONSE")
  let size = 0; const chunks: Uint8Array[] = []
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      size += part.value.byteLength
      if (size > 2_097_152) { await reader.cancel(); throw new ScheduleRequestError(502, "STAFF_INVALID_RESPONSE") }
      chunks.push(part.value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(size); let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  let body: unknown
  try { body = JSON.parse(new TextDecoder().decode(bytes)) } catch { throw new ScheduleRequestError(502, "STAFF_INVALID_RESPONSE") }
  if (!response.ok) {
    const code = body && typeof body === "object" && "error" in body && body.error && typeof body.error === "object" && "code" in body.error && typeof body.error.code === "string" ? body.error.code : "REQUEST_FAILED"
    throw new ScheduleRequestError(response.status, code)
  }
  const payload = parseStaffSchedulePayload(body, query)
  if (!payload) throw new ScheduleRequestError(502, "STAFF_INVALID_RESPONSE")
  return payload
}
function eventColor(job: RemoteStaffJob) {
  return ({ WAITING: "border-amber-300 bg-amber-50/60 hover:bg-amber-50", ACCEPTED: "border-blue-300 bg-blue-50/60 hover:bg-blue-50", IN_PROGRESS: "border-sky-300 bg-sky-50/70 hover:bg-sky-50", DONE: "border-emerald-300 bg-emerald-50/60 hover:bg-emerald-50", CANCELLED: "border-slate-300 bg-slate-50 hover:bg-slate-100" })[job.status]
}
function CalendarEvent({ job, day, compact = false }: { job: RemoteStaffJob; day: string; compact?: boolean }) {
  const tone = ({ WAITING: "warning", ACCEPTED: "info", IN_PROGRESS: "primary", DONE: "success", CANCELLED: "danger" } as const)[job.status]
  return <Link href={`/don/${job.assignmentId}`} data-schedule-assignment-id={job.assignmentId} data-schedule-day={day} aria-label={`Xem chi tiết phân công ${job.assignmentId}`} className={`block min-h-11 min-w-0 rounded-xl border-l-[3px] ${compact ? "p-2.5" : "p-4"} transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${eventColor(job)}`}>
    <p className="m-0 break-words text-xs leading-6 font-semibold tabular-nums">{job.scheduledAt ? formatStaffScheduleTime(job.scheduledAt) : "Chưa có giờ bắt đầu"}</p>
    <p className="mt-1 mb-0 break-words text-xs leading-6 text-muted-foreground">Đến {job.expectedEndAt ? formatStaffScheduleTime(job.expectedEndAt) : "thời điểm chưa được cung cấp"}</p>
    <p className="mt-2 mb-0 break-all text-xs leading-6 font-semibold">Phân công #{job.assignmentId}</p>
    <p className="mt-0.5 mb-0 break-all text-xs leading-6 text-muted-foreground">Đơn #{job.orderId}</p>
    {job.services.length ? <ul className="mt-2 mb-0 list-none space-y-1 p-0">{job.services.map((service, index) => <li key={`${service.serviceId}:${index}`} className="break-words text-xs leading-6">{service.name || "Chưa có tên dịch vụ"}<span className="block text-muted-foreground">{service.quantity}{service.unit ? ` ${service.unit}` : ""}</span></li>)}</ul> : <p className="mt-2 mb-0 text-xs leading-6 text-muted-foreground">Chưa có thông tin dịch vụ</p>}
    <div className="mt-2 flex min-w-0 items-start gap-1.5 text-muted-foreground"><MapPinIcon aria-hidden="true" className="mt-1 size-3.5 shrink-0" /><span className="min-w-0 break-words text-xs leading-6">{job.contact.address || "Chưa có địa chỉ"}</span></div>
    <div className="mt-3 min-w-0"><ToneBadge tone={tone} className="h-auto max-w-full py-1 whitespace-normal break-words">{REMOTE_STAFF_STATUS_LABEL[job.status]}</ToneBadge></div>
    {!compact && <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-primary">Xem chi tiết<ArrowRightIcon aria-hidden="true" className="size-4" /></span>}
  </Link>
}

export function StaffScheduleRemote() {
  const auth = useStaffAuth()
  if (!auth || auth.status !== "authenticated" || !auth.session || auth.busy === "logout") return <StaffLoading />
  const identity = `${auth.session.user.id}:${auth.session.expiresAt}`
  return <StaffScheduleContent key={identity} identity={identity} auth={auth} />
}
function StaffScheduleContent({ identity, auth }: { identity: string; auth: StaffAuth }) {
  const params = useSearchParams()
  const [defaults] = useState(() => defaultStaffScheduleQuery())
  const query = parseStaffScheduleLocation(params.toString()) || defaults
  const setQuery = (next: StaffScheduleQuery) => window.history.replaceState(null, "", staffScheduleHref(next))
  const [from, setFrom] = useState(query.from), [to, setTo] = useState(query.to)
  const [rangeError, setRangeError] = useState("")
  const fromInput = useRef<HTMLInputElement>(null), toInput = useRef<HTMLInputElement>(null)
  const [retry, setRetry] = useState(0)
  const [result, setResult] = useState<ScheduleResult>({ key: "", data: null, error: "", loading: true })
  const generation = useRef(0), alert = useRef<HTMLDivElement>(null)
  const serialized = staffScheduleQueryString(query), requestKey = `${identity}:${serialized}:${retry}`
  const { checkSession } = auth
  useEffect(() => { setFrom(query.from); setTo(query.to); setRangeError("") }, [query.from, query.to])
  useEffect(() => {
    const version = ++generation.current, controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), 20_000)
    setResult({ key: requestKey, data: null, error: "", loading: true })
    void (async () => {
      try {
        const data = await readSchedule(query, controller.signal)
        if (controller.signal.aborted || version !== generation.current) return
        setResult({ key: requestKey, data, error: "", loading: false })
      } catch (error) {
        if (version !== generation.current) return
        setResult({ key: requestKey, data: null, error: scheduleMessage(error), loading: false })
        if (error instanceof ScheduleRequestError && [401, 403].includes(error.status)) await checkSession()
      } finally { window.clearTimeout(timer) }
    })()
    return () => { ++generation.current; controller.abort(); window.clearTimeout(timer) }
  }, [checkSession, serialized, requestKey])
  const current = result.key === requestKey ? result : null, loading = !current || current.loading, payload = current?.data || null
  useEffect(() => { if (current?.error) alert.current?.focus() }, [current?.error])
  function applyRange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const error = validateScheduleRange(from, to)
    if (error) { setRangeError(error); (validScheduleDay(from) ? toInput : fromInput).current?.focus(); return }
    setRangeError(""); setQuery({ ...query, from, to, anchor: from, view: "list", page: 1 })
  }
  const changeView = (view: StaffCalendarView) => {
    const range = calendarRange(query.anchor, view)
    if (range) setQuery({ ...query, ...range, view, page: 1 })
  }
  const today = vietnamDayKey(), previous = shiftScheduleQuery(query, -1), next = shiftScheduleQuery(query, 1)
  const grouped = payload ? groupScheduleByDay(payload.data, query.from, query.to) : { days: [], unplaced: [] }
  const grid = query.view === "week" || query.view === "month"
  const nonEmpty = grouped.days.filter(entry => entry.jobs.length)
  if (!grid && query.sort === "desc") nonEmpty.reverse()
  const partial = Boolean(payload && payload.pagination.totalPages > 1)
  const firstWeekday = new Date(`${query.from}T00:00:00Z`).getUTCDay(), padding = (firstWeekday + 6) % 7
  const lastPadding = (7 - (padding + grouped.days.length) % 7) % 7

  return <div data-staff-schedule className="min-w-0 space-y-6">
    <StaffPageHeader title="Lịch làm việc" description="Xem các lịch hẹn được phân công và mở thông tin công việc của bạn." />
    <section aria-label="Chọn lịch làm việc" className="min-w-0 rounded-2xl border border-border bg-white p-5 sm:p-6">
      <form noValidate onSubmit={applyRange} className="space-y-5">
        <div className="grid min-w-0 gap-5 sm:grid-cols-2 xl:grid-cols-3">
          <div className="ch-field"><label htmlFor="staff-schedule-from">Từ ngày</label><Input ref={fromInput} id="staff-schedule-from" type="date" min="1971-01-01" max="2099-12-31" className="min-h-11 bg-white" value={from} onChange={event => { setFrom(event.target.value); setRangeError("") }} aria-invalid={Boolean(rangeError)} aria-describedby={rangeError ? "staff-schedule-range-error" : undefined} /></div>
          <div className="ch-field"><label htmlFor="staff-schedule-to">Đến ngày</label><Input ref={toInput} id="staff-schedule-to" type="date" min="1971-01-01" max="2099-12-31" className="min-h-11 bg-white" value={to} onChange={event => { setTo(event.target.value); setRangeError("") }} aria-invalid={Boolean(rangeError)} aria-describedby={rangeError ? "staff-schedule-range-error" : undefined} /></div>
          <div className="ch-field"><label htmlFor="staff-schedule-view">Chế độ xem</label><select id="staff-schedule-view" value={query.view} onChange={event => changeView(event.target.value as StaffCalendarView)}>{Object.entries(STAFF_CALENDAR_VIEWS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
          <div className="ch-field"><label htmlFor="staff-schedule-status">Trạng thái công việc</label><select id="staff-schedule-status" value={query.status} onChange={event => setQuery({ ...query, status: event.target.value as StaffScheduleQuery["status"], page: 1 })}><option value="">Tất cả trạng thái</option>{Object.entries(REMOTE_STAFF_STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
          <div className="ch-field"><label htmlFor="staff-schedule-sort">Sắp xếp lịch thực hiện</label><select id="staff-schedule-sort" value={query.sort} onChange={event => setQuery({ ...query, sort: event.target.value as "asc" | "desc", page: 1 })}><option value="asc">Thời gian: tăng dần</option><option value="desc">Thời gian: giảm dần</option></select></div>
          <div className="ch-field"><label htmlFor="staff-schedule-page-size">Số công việc mỗi trang</label><select id="staff-schedule-page-size" value={query.pageSize} onChange={event => setQuery({ ...query, pageSize: Number(event.target.value), page: 1 })}>{Array.from(new Set([2, 20, 100, query.pageSize])).sort((a, b) => a - b).map(size => <option key={size} value={size}>{size} công việc / trang</option>)}</select></div>
        </div>
        {rangeError && <p id="staff-schedule-range-error" role="alert" className="m-0 text-sm leading-7 text-destructive">{rangeError}</p>}
        <div className="flex flex-wrap items-center justify-between gap-3"><p className="m-0 text-xs leading-6 text-muted-foreground">Ngày và giờ Việt Nam (UTC+07). Khoảng ngày tối đa 366 ngày.</p><Button type="submit" className="min-h-11 w-full sm:w-auto">Áp dụng khoảng ngày</Button></div>
      </form>
      <div className="mt-5 flex min-w-0 flex-col gap-4 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0"><h2 className="m-0 break-words text-base leading-7 font-semibold">{scheduleDayLabel(query.from)}{query.to !== query.from ? ` – ${scheduleDayLabel(query.to)}` : ""}</h2><p role="status" aria-live="polite" className="mt-2 mb-0 text-sm leading-7 text-muted-foreground">{loading ? "Đang tải lịch làm việc..." : payload ? <><span data-schedule-total={payload.pagination.total}>{payload.pagination.total} công việc trong khoảng ngày</span><span className="block text-xs" data-schedule-loaded={payload.data.length}>Đang hiển thị {payload.data.length} công việc trên trang {payload.pagination.page}{partial ? ` / ${payload.pagination.totalPages}` : ""}.</span></> : "Chưa tải được lịch làm việc"}</p></div>
        <div className="grid w-full min-w-0 grid-cols-3 gap-2 sm:w-auto sm:shrink-0"><Button variant="outline" className="min-h-11 px-3" disabled={!previous} aria-label="Khoảng thời gian trước" onClick={() => previous && setQuery(previous)}><ChevronLeftIcon aria-hidden="true" />Trước</Button><Button variant="outline" className="min-h-11 px-3" onClick={() => { const range = calendarRange(today, query.view); if (range) setQuery({ ...query, ...range, anchor: today, page: 1 }) }}>Hôm nay</Button><Button variant="outline" className="min-h-11 px-3" disabled={!next} aria-label="Khoảng thời gian sau" onClick={() => next && setQuery(next)}>Sau<ChevronRightIcon aria-hidden="true" /></Button></div>
      </div>
    </section>
    {loading ? <StaffLoading /> : current?.error ? <div ref={alert} tabIndex={-1} role="alert" className="min-w-0 rounded-2xl border border-red-200 bg-white px-5 py-8 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"><h2 className="m-0 text-lg font-semibold">Chưa thể tải lịch làm việc</h2><p className="mt-3 mb-6 text-sm leading-7 text-muted-foreground">{current.error}</p><Button variant="outline" className="min-h-11" onClick={() => setRetry(value => value + 1)}>Thử lại</Button></div> : payload && <>
      {partial && <p role="note" className="m-0 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm leading-7 text-blue-900">Lịch đang hiển thị một phần kết quả. Chuyển trang để xem các công việc còn lại; ô ngày không có mục chỉ phản ánh trang hiện tại.</p>}
      {payload.data.length === 0 ? <StaffEmpty title="Không có công việc trong lịch đã chọn" description={query.page > 1 ? "Trang này không có kết quả. Hãy quay về trang đầu hoặc chọn khoảng ngày khác." : "Thử chọn khoảng ngày hoặc trạng thái khác để xem các công việc được phân công cho bạn."} action={query.page > 1 ? <Button variant="outline" className="min-h-11" onClick={() => setQuery({ ...query, page: 1 })}>Về trang đầu</Button> : undefined} /> : <>
        <div className={grid ? "grid min-w-0 gap-6 xl:hidden" : "grid min-w-0 gap-6"} aria-label="Danh sách lịch hẹn theo ngày">{nonEmpty.map(({ day, jobs }) => <section key={day} data-schedule-day-group={day} className="min-w-0"><div className="mb-4 flex min-w-0 flex-wrap items-center gap-3"><CalendarDaysIcon aria-hidden="true" className="size-5 shrink-0 text-primary" /><h3 className="m-0 break-words text-base font-semibold">{scheduleDayLabel(day, true)}{day === today ? " · Hôm nay" : ""}</h3><span className="text-sm text-muted-foreground">{jobs.length} công việc{partial ? " trên trang" : ""}</span></div><div className="grid min-w-0 gap-4 lg:grid-cols-2">{jobs.map(job => <CalendarEvent key={job.assignmentId} job={job} day={day} />)}</div></section>)}</div>
        {grid && <div className="hidden min-w-0 rounded-2xl border border-border bg-white xl:block" aria-label={query.view === "month" ? "Lưới lịch tháng" : "Lưới lịch tuần"}><div className="grid min-w-0 grid-cols-7 border-b border-border bg-slate-50">{["Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7", "Chủ nhật"].map(label => <span key={label} className="min-w-0 px-2 py-3 text-center text-xs font-semibold text-muted-foreground">{label}</span>)}</div><div className="grid min-w-0 grid-cols-7">{Array.from({ length: padding }, (_, index) => <div key={`before-${index}`} aria-hidden="true" className="min-h-28 border-r border-b border-border bg-slate-50/60" />)}{grouped.days.map(({ day, jobs }) => <section key={day} data-schedule-day-group={day} className={`min-w-0 border-r border-b border-border p-2.5 ${day === today ? "bg-blue-50/30" : ""}`}><h3 className="m-0 mb-3 break-words text-center text-xs leading-6 font-semibold">{scheduleDayLabel(day)}</h3><div className="grid min-w-0 gap-2">{jobs.map(job => <CalendarEvent key={job.assignmentId} job={job} day={day} compact />)}</div>{!jobs.length && <p className="m-0 py-5 text-center text-xs leading-6 text-muted-foreground">{partial ? "Không có trên trang này" : "Không có công việc"}</p>}</section>)}{Array.from({ length: lastPadding }, (_, index) => <div key={`after-${index}`} aria-hidden="true" className="min-h-28 border-r border-b border-border bg-slate-50/60" />)}</div></div>}
        {grouped.unplaced.length > 0 && <section className="min-w-0 rounded-2xl border border-border bg-white p-5"><h3 className="m-0 text-lg font-semibold">Công việc chưa đủ thông tin thời gian</h3><p className="mt-3 mb-5 text-sm leading-7 text-muted-foreground">Các công việc này chưa thể xếp vào ô ngày. Thông tin đã nhận vẫn được giữ để bạn tra cứu.</p><div className="grid min-w-0 gap-4 lg:grid-cols-2">{grouped.unplaced.map(job => <CalendarEvent key={job.assignmentId} job={job} day="" />)}</div></section>}
      </>}
      {(payload.pagination.totalPages > 1 || query.page > 1) && <nav aria-label="Phân trang lịch làm việc" className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><p className="m-0 text-sm leading-6 text-muted-foreground">{payload.data.length ? `${(query.page - 1) * query.pageSize + 1}–${(query.page - 1) * query.pageSize + payload.data.length} / ${payload.pagination.total} công việc` : `${payload.pagination.total} công việc`}</p><div className="flex w-full min-w-0 flex-wrap items-center justify-between gap-3 sm:w-auto"><Button variant="outline" className="min-h-11" disabled={query.page <= 1} onClick={() => setQuery({ ...query, page: query.page - 1 })}>Trang trước</Button><span aria-live="polite" className="text-sm leading-6">Trang {payload.pagination.page} / {Math.max(1, payload.pagination.totalPages)}</span><Button variant="outline" className="min-h-11" disabled={query.page >= payload.pagination.totalPages || query.page >= 100_000} onClick={() => setQuery({ ...query, page: query.page + 1 })}>Trang sau</Button></div></nav>}
    </>}
  </div>
}
