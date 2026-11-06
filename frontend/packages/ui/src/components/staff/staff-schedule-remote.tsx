"use client"

import { useEffect, useRef, useState, type FormEvent } from "react"
import { useSearchParams } from "next/navigation"
import { ArrowRightIcon, CalendarDaysIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, MapPinIcon, SlidersHorizontalIcon } from "lucide-react"
import { AreaLink as Link } from "@/components/shared/area-routes"
import { ToneBadge } from "@/components/shared/status-badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useStaffAuth } from "./staff-auth-session"
import { StaffEmpty, StaffLoading, StaffPageHeader } from "./staff-shared"
import { REMOTE_STAFF_STATUS_LABEL, type RemoteStaffJob, type RemoteStaffJobsPayload } from "./staff-jobs-remote-model"
import {
  STAFF_CALENDAR_VIEWS, calendarRange, defaultStaffScheduleQuery, formatStaffScheduleTime, groupScheduleByDay, parseStaffScheduleLocation,
  parseStaffSchedulePayload, scheduleDays, scheduleDayLabel, shiftScheduleQuery, staffScheduleHref, staffScheduleQueryString,
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
function CalendarEvent({ job, day }: { job: RemoteStaffJob; day: string }) {
  const tone = ({ WAITING: "warning", ACCEPTED: "info", IN_PROGRESS: "primary", DONE: "success", CANCELLED: "danger" } as const)[job.status]
  return <Link href={"/don/" + job.assignmentId} data-schedule-assignment-id={job.assignmentId} data-schedule-day={day} data-schedule-status={job.status} aria-label={"Xem chi tiết phân công " + job.assignmentId} className={"staff-schedule-event " + eventColor(job)}>
    <div className="staff-schedule-event-heading"><p>Phân công <strong>#{job.assignmentId}</strong></p><ToneBadge tone={tone}>{REMOTE_STAFF_STATUS_LABEL[job.status]}</ToneBadge></div>
    <div className="staff-schedule-event-time"><CalendarDaysIcon aria-hidden="true" /><div><p>{job.scheduledAt ? formatStaffScheduleTime(job.scheduledAt) : "Chưa có giờ bắt đầu"}</p><span>Đến {job.expectedEndAt ? formatStaffScheduleTime(job.expectedEndAt) : "thời điểm chưa được cung cấp"}</span></div></div>
    {job.services.length ? <ul className="staff-schedule-services">{job.services.map((service, index) => <li key={service.serviceId + ":" + index}><h4>{service.name || "Chưa có tên dịch vụ"}</h4><span>{service.quantity}{service.unit ? " " + service.unit : ""}</span></li>)}</ul> : <p className="staff-schedule-muted">Chưa có thông tin dịch vụ</p>}
    <p className="staff-schedule-order">Đơn dịch vụ #{job.orderId}</p>
    <div className="staff-schedule-address"><MapPinIcon aria-hidden="true" /><span>{job.contact.address || "Chưa có địa chỉ"}</span></div>
    <span className="staff-schedule-detail-link">Xem chi tiết<ArrowRightIcon aria-hidden="true" /></span>
  </Link>
}
function CalendarDay({ day, jobs, selected, today, partial, onSelect }: { day: string; jobs: RemoteStaffJob[]; selected: boolean; today: string; partial: boolean; onSelect: (day: string) => void }) {
  return <Button type="button" variant="ghost" data-calendar-day={day} aria-pressed={selected} aria-current={day === today ? "date" : undefined} aria-label={"Chọn " + scheduleDayLabel(day, true) + ", " + jobs.length + (partial ? " công việc trên trang hiện tại" : " công việc")} className="staff-schedule-calendar-day" onClick={() => onSelect(day)}>
    <span className="staff-schedule-cell-heading"><time dateTime={day}>{Number(day.slice(8))}</time>{day === today && <span>Hôm nay</span>}</span>
    <span className="staff-schedule-cell-count">{jobs.length} {partial ? "trên trang" : "công việc"}</span>
    <span className="staff-schedule-cell-preview">{jobs.slice(0, 2).map(job => <span key={job.assignmentId} title={job.services.map(service => service.name).join(" · ") || "Phân công #" + job.assignmentId}><span className="staff-schedule-cell-dot" data-tone={job.status} />{job.services[0]?.name || "Phân công #" + job.assignmentId}</span>)}{jobs.length > 2 && <span>+{jobs.length - 2} {partial ? "trên trang" : "công việc"}</span>}</span>
  </Button>
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


  const selectedDay = query.anchor >= query.from && query.anchor <= query.to ? query.anchor : query.from
  const selected = grouped.days.find(entry => entry.day === selectedDay)
  const selectedWeek = calendarRange(selectedDay, "week")
  const stripDays = selectedWeek ? scheduleDays(selectedWeek.from, selectedWeek.to) : []
  const selectDay = (day: string) => {
    if (query.view === "day") {
      const range = calendarRange(day, "day")
      if (range) setQuery({ ...query, ...range, anchor: day, page: 1 })
    } else setQuery({ ...query, anchor: day })
  }

  return <div data-staff-schedule className="staff-schedule min-w-0 space-y-6">
    <StaffPageHeader title="Lịch làm việc" description="Theo dõi lịch hẹn và công việc được phân công cho bạn." />
    <section aria-label="Chọn lịch làm việc" className="staff-schedule-controls">
      <div className="staff-schedule-toolbar"><div className="staff-schedule-range"><span className="staff-schedule-range-icon"><CalendarDaysIcon aria-hidden="true" /></span><div><p>Lịch phân công · UTC+7</p><h2>{scheduleDayLabel(query.from)}{query.to !== query.from ? " – " + scheduleDayLabel(query.to) : ""}</h2></div></div><div className="ch-field staff-schedule-view-field"><label htmlFor="staff-schedule-view" className="sr-only">Chế độ xem</label><select id="staff-schedule-view" value={query.view} onChange={event => changeView(event.target.value as StaffCalendarView)}>{Object.entries(STAFF_CALENDAR_VIEWS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div></div>
      <div className="staff-schedule-period-nav"><Button type="button" variant="outline" disabled={!previous} aria-label="Khoảng thời gian trước" onClick={() => previous && setQuery(previous)}><ChevronLeftIcon aria-hidden="true" />Trước</Button><Button type="button" variant="outline" onClick={() => { const currentDay = vietnamDayKey(); const range = calendarRange(currentDay, query.view); if (range) setQuery({ ...query, ...range, anchor: currentDay, page: 1 }) }}>Hôm nay</Button><Button type="button" variant="outline" disabled={!next} aria-label="Khoảng thời gian sau" onClick={() => next && setQuery(next)}>Sau<ChevronRightIcon aria-hidden="true" /></Button></div>
      <details className="staff-schedule-filter-details"><summary><SlidersHorizontalIcon aria-hidden="true" /><span>Bộ lọc và khoảng ngày</span><ChevronDownIcon aria-hidden="true" /></summary>
        <form noValidate onSubmit={applyRange}>
          <div className="staff-schedule-filter-grid">
            <div className="ch-field"><label htmlFor="staff-schedule-from">Từ ngày</label><Input ref={fromInput} id="staff-schedule-from" type="date" min="1971-01-01" max="2099-12-31" value={from} onChange={event => { setFrom(event.target.value); setRangeError("") }} aria-invalid={Boolean(rangeError)} aria-describedby={rangeError ? "staff-schedule-range-error" : undefined} /></div>
            <div className="ch-field"><label htmlFor="staff-schedule-to">Đến ngày</label><Input ref={toInput} id="staff-schedule-to" type="date" min="1971-01-01" max="2099-12-31" value={to} onChange={event => { setTo(event.target.value); setRangeError("") }} aria-invalid={Boolean(rangeError)} aria-describedby={rangeError ? "staff-schedule-range-error" : undefined} /></div>
            <div className="ch-field staff-schedule-status-field"><label htmlFor="staff-schedule-status">Trạng thái công việc</label><select id="staff-schedule-status" value={query.status} onChange={event => setQuery({ ...query, status: event.target.value as StaffScheduleQuery["status"], page: 1 })}><option value="">Tất cả trạng thái</option>{Object.entries(REMOTE_STAFF_STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
            <div className="ch-field"><label htmlFor="staff-schedule-sort">Thứ tự lịch</label><select id="staff-schedule-sort" value={query.sort} onChange={event => setQuery({ ...query, sort: event.target.value as "asc" | "desc", page: 1 })}><option value="asc">Tăng dần</option><option value="desc">Giảm dần</option></select></div>
            <div className="ch-field"><label htmlFor="staff-schedule-page-size">Mỗi trang</label><select id="staff-schedule-page-size" value={query.pageSize} onChange={event => setQuery({ ...query, pageSize: Number(event.target.value), page: 1 })}>{Array.from(new Set([2, 20, 100, query.pageSize])).sort((a, b) => a - b).map(size => <option key={size} value={size}>{size} việc</option>)}</select></div>
          </div>
          {rangeError && <p id="staff-schedule-range-error" role="alert" className="staff-schedule-range-error">{rangeError}</p>}
          <div className="staff-schedule-range-submit"><p>Giờ Việt Nam (UTC+7) · Khoảng ngày tối đa 366 ngày.</p><Button type="submit">Áp dụng khoảng ngày</Button></div>
        </form>
      </details>
      <p role="status" aria-live="polite" className="staff-schedule-result-caption">{loading ? "Đang tải lịch làm việc..." : payload ? <><span data-schedule-total={payload.pagination.total}>{payload.pagination.total} công việc trong khoảng ngày</span><span data-schedule-loaded={payload.data.length}>Đang hiển thị {payload.data.length} công việc trên trang {payload.pagination.page}{partial ? " / " + payload.pagination.totalPages : ""}.</span></> : "Chưa tải được lịch làm việc"}</p>
    </section>
    {loading ? <StaffLoading /> : current?.error ? <div ref={alert} tabIndex={-1} role="alert" className="staff-schedule-error"><h2>Chưa thể tải lịch làm việc</h2><p>{current.error}</p><Button variant="outline" onClick={() => setRetry(value => value + 1)}>Thử lại</Button></div> : payload && <>
      {partial && <p role="note" className="staff-schedule-partial">Lịch đang hiển thị một phần kết quả. Chuyển trang để xem các công việc còn lại; ô ngày không có mục chỉ phản ánh trang hiện tại.</p>}
      {query.view !== "list" && <div className="staff-schedule-workspace">
        {grid && <section className="staff-schedule-calendar hidden xl:block" aria-label={query.view === "month" ? "Lưới lịch tháng" : "Lưới lịch tuần"}><div className="staff-schedule-weekdays">{["Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7", "Chủ nhật"].map(label => <span key={label}>{label}</span>)}</div><div className="staff-schedule-calendar-grid">{Array.from({ length: padding }, (_, index) => <div key={"before-" + index} aria-hidden="true" className="staff-schedule-calendar-padding" />)}{grouped.days.map(({ day, jobs }) => <CalendarDay key={day} day={day} jobs={jobs} selected={day === selectedDay} today={today} partial={partial} onSelect={selectDay} />)}{Array.from({ length: lastPadding }, (_, index) => <div key={"after-" + index} aria-hidden="true" className="staff-schedule-calendar-padding" />)}</div><p className="staff-schedule-help">Chọn ngày để xem đầy đủ công việc bên dưới.{partial ? " Số việc trong ô chỉ tính trên trang hiện tại." : ""}</p></section>}
        <nav aria-label="Chọn ngày trong tuần" className={"staff-schedule-day-strip" + (grid ? " xl:hidden" : "")}>{stripDays.map(day => {
          const entry = grouped.days.find(item => item.day === day), inRange = day >= query.from && day <= query.to
          return <Button key={day} type="button" variant="ghost" data-strip-day={day} aria-label={"Chọn " + scheduleDayLabel(day, true) + ", " + (entry?.jobs.length || 0) + (partial ? " công việc trên trang hiện tại" : " công việc")} aria-pressed={day === selectedDay} aria-current={day === today ? "date" : undefined} disabled={query.view !== "day" && !inRange} className="staff-schedule-day-button" onClick={() => selectDay(day)}><span>{["CN", "T2", "T3", "T4", "T5", "T6", "T7"][new Date(day + "T12:00:00Z").getUTCDay()]}</span><strong>{Number(day.slice(8))}</strong><span aria-hidden="true" className={"staff-schedule-day-dot" + (entry?.jobs.length ? " has-work" : "")} /></Button>
        })}</nav>
        {query.view === "month" && <div className="ch-field staff-schedule-month-picker xl:hidden"><label htmlFor="staff-schedule-selected-day">Chọn ngày trong tháng</label><Input id="staff-schedule-selected-day" type="date" min={query.from} max={query.to} value={selectedDay} onChange={event => { const day = event.target.value; if (validScheduleDay(day) && day >= query.from && day <= query.to) selectDay(day) }} /></div>}
        <section data-selected-schedule-day={selectedDay} className="staff-schedule-agenda"><header><div><p className="staff-eyebrow">Ngày được chọn</p><h2>{scheduleDayLabel(selectedDay, true)}</h2></div><p role="status" aria-live="polite">{selected?.jobs.length || 0} công việc{partial ? " trên trang hiện tại" : " phù hợp"}</p></header>
          {selected?.jobs.length ? <div className="staff-schedule-event-grid">{selected.jobs.map(job => <CalendarEvent key={job.assignmentId} job={job} day={selectedDay} />)}</div> : <StaffEmpty title={partial ? "Ngày này không có công việc trên trang hiện tại" : "Không có công việc trong ngày đã chọn"} description={partial ? "Chuyển trang để xem các kết quả còn lại hoặc chọn ngày khác." : "Thử chọn ngày hoặc bộ lọc khác để xem công việc được phân công."} />}
        </section>
      </div>}
      {query.view === "list" && <div aria-label="Danh sách lịch hẹn theo ngày" className="staff-schedule-list">{payload.data.length === 0 ? <StaffEmpty title="Không có công việc trong lịch đã chọn" description={query.page > 1 ? "Trang này không có kết quả. Hãy quay về trang đầu hoặc chọn khoảng ngày khác." : "Thử chọn khoảng ngày hoặc trạng thái khác để xem công việc được phân công cho bạn."} action={query.page > 1 ? <Button variant="outline" onClick={() => setQuery({ ...query, page: 1 })}>Về trang đầu</Button> : undefined} /> : nonEmpty.map(({ day, jobs }) => <section key={day} data-schedule-day-group={day}><header className="staff-schedule-list-day"><CalendarDaysIcon aria-hidden="true" /><h3>{scheduleDayLabel(day, true)}{day === today ? " · Hôm nay" : ""}</h3><span>{jobs.length} công việc{partial ? " trên trang" : ""}</span></header><div className="staff-schedule-event-grid">{jobs.map(job => <CalendarEvent key={job.assignmentId} job={job} day={day} />)}</div></section>)}</div>}
      {grouped.unplaced.length > 0 && <section className="staff-schedule-unplaced"><h3>Công việc chưa đủ thông tin thời gian</h3><p>Các công việc này chưa thể xếp vào ô ngày. Thông tin đã nhận vẫn được giữ để bạn tra cứu.</p><div className="staff-schedule-event-grid">{grouped.unplaced.map(job => <CalendarEvent key={job.assignmentId} job={job} day="" />)}</div></section>}
      {(payload.pagination.totalPages > 1 || query.page > 1) && <nav aria-label="Phân trang lịch làm việc" className="staff-schedule-pagination"><p>{payload.data.length ? ((query.page - 1) * query.pageSize + 1) + "–" + ((query.page - 1) * query.pageSize + payload.data.length) + " / " + payload.pagination.total + " công việc" : payload.pagination.total + " công việc"}</p><div><Button variant="outline" disabled={query.page <= 1} onClick={() => setQuery({ ...query, page: query.page - 1 })}>Trang trước</Button><span aria-live="polite">Trang {payload.pagination.page} / {Math.max(1, payload.pagination.totalPages)}</span><Button variant="outline" disabled={query.page >= payload.pagination.totalPages || query.page >= 100_000} onClick={() => setQuery({ ...query, page: query.page + 1 })}>Trang sau</Button></div></nav>}
    </>}
  </div>
}
