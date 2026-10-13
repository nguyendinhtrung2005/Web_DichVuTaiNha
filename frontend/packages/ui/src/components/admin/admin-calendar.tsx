"use client"

import { useState } from "react"
import { AreaLink as Link } from "@/components/shared/area-routes"
import { AlertTriangleIcon, CalendarDaysIcon, ChevronLeftIcon, ChevronRightIcon, Clock3Icon, MapPinIcon, UserRoundIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { JobStatusBadge, OrderStatusBadge } from "@/components/shared/status-badge"
import type { Order } from "@/lib/types"
import { Field, useData } from "../../common"
import { AdminEmpty, AdminError, AdminLoading, AdminPageHeader, getAdminDataError, localDateKey } from "./admin-shared"
import { ADMIN_JOB_FILTERS, adminJobStatus, jobConflicts } from "./admin-scheduling"

type CalendarView = "day" | "week" | "month" | "list"

function displayDay(value: Date, weekday = true) {
  return value.toLocaleDateString("vi-VN", { ...(weekday ? { weekday: "short" as const } : {}), day: "2-digit", month: "2-digit" })
}

function calendarRange(anchor: string, view: CalendarView) {
  // Interpret date-input values as local calendar days. Noon avoids shifting a
  // date backwards when converting an ISO UTC midnight to the local time zone.
  const base = new Date(`${anchor}T12:00:00`)
  const start = new Date(base)
  if (view === "month") start.setDate(1)
  else if (view !== "day") start.setDate(start.getDate() - (start.getDay() + 6) % 7)
  const count = view === "day" ? 1 : view === "month" ? new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate() : 7
  const dates = Array.from({ length: count }, (_, index) => {
    const value = new Date(start)
    value.setDate(start.getDate() + index)
    return value
  })
  return { base, start, dates }
}

function shiftAnchor(anchor: string, view: CalendarView, direction: number) {
  const next = new Date(`${anchor}T12:00:00`)
  if (view === "month") next.setMonth(next.getMonth() + direction, 1)
  else next.setDate(next.getDate() + direction * (view === "day" ? 1 : 7))
  return localDateKey(next)
}

function eventTime(order: Order) {
  const start = new Date(order.scheduledAt)
  const end = new Date(start.getTime() + order.durationMinutes * 60000)
  const time = (value: Date) => value.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })
  return `${time(start)} – ${time(end)}${localDateKey(start) !== localDateKey(end) ? ` (${displayDay(end, false)})` : ""}`
}

function eventColor(order: Order) {
  switch (adminJobStatus(order)) {
    case "cancelled": return "border-l-slate-300 bg-slate-50 hover:bg-slate-100"
    case "done": return "border-l-emerald-300 bg-emerald-50/60 hover:bg-emerald-50"
    case "in_progress": return "border-l-sky-300 bg-sky-50/70 hover:bg-sky-50"
    case "accepted":
    case "confirmed": return "border-l-blue-300 bg-blue-50/60 hover:bg-blue-50"
    default: return "border-l-amber-300 bg-amber-50/60 hover:bg-amber-50"
  }
}

function CalendarEvent({ order, serviceName, staffName, conflicts, compact = false }: {
  order: Order; serviceName: string; staffName: string; conflicts: Order[]; compact?: boolean
}) {
  const hasJobBadge = order.status !== "cancelled" && order.status !== "completed" && Boolean(order.jobStatus)
  return <Link href={`/don/${order.id}`} aria-label={`Xem công việc ${order.code}`}
    className={`block min-w-0 rounded-xl border border-border border-l-[3px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${compact ? "p-2.5" : "p-5"} ${eventColor(order)}`}>
    <div className={`flex min-w-0 flex-wrap items-start justify-between gap-2 ${compact ? "mb-2" : "mb-3"}`}>
      <p className={`m-0 min-w-0 break-words font-semibold tabular-nums ${compact ? "text-xs leading-5" : "text-sm leading-6"}`}>{order.code}</p>
      <div className="min-w-0 [&_[data-slot=badge]]:h-auto [&_[data-slot=badge]]:max-w-full [&_[data-slot=badge]]:text-center [&_[data-slot=badge]]:whitespace-normal">{hasJobBadge && order.jobStatus ? <JobStatusBadge status={order.jobStatus} /> : <OrderStatusBadge status={order.status} />}</div>
    </div>
    <h4 className={`m-0 break-words font-semibold ${compact ? "text-xs leading-5" : "text-base leading-7"}`}>{serviceName}</h4>
    <dl className={`m-0 grid ${compact ? "mt-2 gap-2 text-xs leading-5" : "mt-4 gap-3 text-sm leading-6"}`}>
      <div className="flex min-w-0 items-start gap-2"><UserRoundIcon aria-hidden="true" className={`mt-0.5 shrink-0 text-primary ${compact ? "size-3.5" : "size-4"}`} /><dt className="sr-only">Nhân viên</dt><dd className="m-0 min-w-0 break-words">{staffName}</dd></div>
      <div className="flex min-w-0 items-start gap-2"><Clock3Icon aria-hidden="true" className={`mt-0.5 shrink-0 text-primary ${compact ? "size-3.5" : "size-4"}`} /><dt className="sr-only">Giờ và thời lượng</dt><dd className="m-0 min-w-0 break-words tabular-nums">{eventTime(order)}<span className="mt-0.5 block text-muted-foreground">{order.durationMinutes} phút</span></dd></div>
      <div className="flex min-w-0 items-start gap-2"><MapPinIcon aria-hidden="true" className={`mt-0.5 shrink-0 text-muted-foreground ${compact ? "size-3.5" : "size-4"}`} /><dt className="sr-only">Địa chỉ thực hiện</dt><dd className="m-0 min-w-0 break-words text-muted-foreground">{order.contact.address}</dd></div>
    </dl>
    {conflicts.length > 0 && <div className={`mt-3 flex min-w-0 items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 text-amber-900 ${compact ? "p-2 text-xs leading-5" : "px-3 py-2.5 text-sm leading-6"}`}><AlertTriangleIcon aria-hidden="true" className={`mt-0.5 shrink-0 ${compact ? "size-3.5" : "size-4"}`} /><p className="m-0 min-w-0 break-words"><span className="font-semibold">Trùng lịch đã lưu</span><span className="mt-1 block">Với {conflicts.map((item) => item.code).join(", ")}.</span></p></div>}
    {!compact && <span className="mt-4 inline-flex min-h-8 items-center text-sm font-medium text-primary">Xem chi tiết đơn →</span>}
  </Link>
}

export function AdminCalendar() {
  const { s, user, role } = useData()
  const [anchor, setAnchor] = useState(() => localDateKey(new Date()))
  const [view, setView] = useState<CalendarView>("week")
  const [staffId, setStaffId] = useState("")
  const [status, setStatus] = useState("")

  if (!s) return <AdminLoading />
  if (!user || user.role !== "admin" || user.status !== "active" || role !== "admin") return <><AdminPageHeader title="Lịch làm việc" /><AdminEmpty title="Vui lòng đăng nhập tài khoản quản trị viên" /></>
  if (getAdminDataError(s)) return <AdminError />

  const { base, start, dates } = calendarRange(anchor, view)
  const dateKeys = new Set(dates.map(localDateKey))
  const assigned = s.orders.filter((order) => Boolean(order.staffId))
  const selectedJobs = assigned.filter((order) => (!staffId || order.staffId === staffId)
    && (status ? adminJobStatus(order) === status : order.status !== "cancelled")
    && dateKeys.has(localDateKey(order.scheduledAt))).sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime() || a.code.localeCompare(b.code, "vi"))
  const services = new Map(s.services.map((service) => [service.id, service]))
  const staff = s.users.filter((item) => item.role === "staff").sort((a, b) => a.name.localeCompare(b.name, "vi"))
  const staffById = new Map(staff.map((item) => [item.id, item]))
  const missingStaff = Array.from(new Set(assigned.map((order) => order.staffId!))).filter((id) => !staffById.has(id))
  const byDay = new Map<string, Order[]>(dates.map((date) => [localDateKey(date), []]))
  for (const order of selectedJobs) byDay.get(localDateKey(order.scheduledAt))?.push(order)
  const nonEmptyDates = dates.filter((value) => Boolean(byDay.get(localDateKey(value))?.length))
  // Use the whole store for conflicts, including completed jobs and jobs hidden
  // by the staff/date/status filters, just as the existing core rules do.
  const conflicts = new Map(selectedJobs.map((order) => [order.id, jobConflicts(s, order)]))
  const conflictingJobs = selectedJobs.filter((order) => Boolean(conflicts.get(order.id)?.length))
  const today = localDateKey(new Date())
  const monthPadding = view === "month" ? (start.getDay() + 6) % 7 : 0
  const lastPadding = view === "month" ? (7 - (monthPadding + dates.length) % 7) % 7 : 0
  const periodLabel = view === "month" ? base.toLocaleDateString("vi-VN", { month: "long", year: "numeric" })
    : view === "day" ? base.toLocaleDateString("vi-VN", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" })
    : `${displayDay(dates[0], false)} – ${displayDay(dates[dates.length - 1], false)} / ${dates[dates.length - 1].getFullYear()}`
  const agendaClass = view === "day" || view === "list" ? "grid min-w-0 gap-6" : "grid min-w-0 gap-6 xl:hidden"
  const clearFilters = () => { setStaffId(""); setStatus("") }
  const staffName = (order: Order) => {
    const employee = staffById.get(order.staffId || "")
    return employee ? `${employee.name}${employee.status === "locked" ? " · Đã khóa" : ""}` : "Nhân viên đã lưu không còn trong danh sách"
  }

  return <div className="min-w-0 space-y-6">
    <AdminPageHeader title="Lịch làm việc" description="Theo dõi lịch đã phân công và các công việc trùng giờ trong dữ liệu hiện có." />
    <section aria-label="Bộ lọc lịch làm việc" className="min-w-0 rounded-2xl border border-border bg-white p-5 sm:p-6">
      <div className="grid min-w-0 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <Field label="Ngày xem lịch"><Input type="date" className="min-w-0" value={anchor} onChange={(event) => { const value = event.target.value; if (value && Number.isFinite(new Date(`${value}T12:00:00`).getTime())) setAnchor(value) }} /></Field>
        <Field label="Chế độ xem"><select value={view} onChange={(event) => setView(event.target.value as CalendarView)} className="min-h-11 w-full min-w-0 rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"><option value="day">Ngày</option><option value="week">Tuần</option><option value="month">Tháng</option><option value="list">Danh sách tuần</option></select></Field>
        <Field label="Nhân viên"><select value={staffId} onChange={(event) => setStaffId(event.target.value)} className="min-h-11 w-full min-w-0 rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"><option value="">Tất cả nhân viên</option>{staff.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}{employee.status === "locked" ? " · Đã khóa" : ""}</option>)}{missingStaff.map((id) => <option key={id} value={id}>Nhân viên đã lưu không còn trong danh sách</option>)}</select></Field>
        <Field label="Trạng thái công việc"><select value={status} onChange={(event) => setStatus(event.target.value)} className="min-h-11 w-full min-w-0 rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"><option value="">Tất cả công việc đang có lịch</option>{ADMIN_JOB_FILTERS.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}</select></Field>
      </div>
      <div className="mt-5 flex flex-col gap-4 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0"><h2 className="m-0 break-words text-lg leading-7 font-semibold capitalize">{periodLabel}</h2><p role="status" aria-live="polite" className="m-0 mt-1 text-sm leading-6 text-muted-foreground">{selectedJobs.length} công việc trong khoảng thời gian này{staffId || status ? ", theo bộ lọc đã chọn" : ""}.</p></div>
        <div className="grid w-full grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2 sm:w-auto sm:shrink-0"><Button variant="outline" className="min-h-11 px-3" aria-label={view === "day" ? "Ngày trước" : view === "month" ? "Tháng trước" : "Tuần trước"} onClick={() => setAnchor(shiftAnchor(anchor, view, -1))}><ChevronLeftIcon aria-hidden="true" />Trước</Button><Button variant="outline" className="min-h-11 px-3" onClick={() => setAnchor(today)}>Hôm nay</Button><Button variant="outline" className="min-h-11 px-3" aria-label={view === "day" ? "Ngày sau" : view === "month" ? "Tháng sau" : "Tuần sau"} onClick={() => setAnchor(shiftAnchor(anchor, view, 1))}>Sau<ChevronRightIcon aria-hidden="true" /></Button></div>
      </div>
      {(staffId || status) && <Button variant="ghost" className="mt-3 min-h-11" onClick={clearFilters}>Xóa bộ lọc</Button>}
    </section>

    {conflictingJobs.length > 0 && <section aria-label="Xung đột lịch đã lưu" className="flex min-w-0 items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-amber-900"><AlertTriangleIcon aria-hidden="true" className="mt-1 size-5 shrink-0" /><div className="min-w-0"><h2 className="m-0 text-sm leading-7 font-semibold">{conflictingJobs.length} công việc có lịch trùng theo dữ liệu đã lưu</h2><p className="m-0 mt-1 text-sm leading-7">Xung đột được kiểm tra với toàn bộ công việc đã lưu, kể cả ngoài bộ lọc hiện tại.</p></div></section>}

    {selectedJobs.length === 0 ? <AdminEmpty title="Không có công việc trong lịch đã chọn" description={staffId || status ? "Thử thay đổi bộ lọc hoặc khoảng thời gian để xem lịch đã phân công." : "Chọn ngày hoặc khoảng thời gian khác để xem các công việc đã phân công."} action={staffId || status ? <Button variant="outline" className="min-h-11" onClick={clearFilters}>Xóa bộ lọc</Button> : undefined} /> : <>
      <div className={agendaClass} aria-label="Danh sách lịch hẹn theo ngày">
        {nonEmptyDates.map((value) => <section key={localDateKey(value)} aria-label={`Công việc ${displayDay(value)}`} className="min-w-0"><div className="mb-4 flex flex-wrap items-center gap-3"><span className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${localDateKey(value) === today ? "bg-blue-100 text-primary" : "bg-white text-muted-foreground ring-1 ring-border"}`}><CalendarDaysIcon aria-hidden="true" className="size-5" /></span><h3 className="m-0 text-base font-semibold capitalize">{displayDay(value)}{localDateKey(value) === today ? " · Hôm nay" : ""}</h3><span className="text-sm text-muted-foreground">{byDay.get(localDateKey(value))?.length} công việc</span></div><div className="grid min-w-0 gap-4 lg:grid-cols-2">{byDay.get(localDateKey(value))?.map((order) => <CalendarEvent key={order.id} order={order} serviceName={services.get(order.serviceId)?.name || "Dịch vụ không còn trong danh sách"} staffName={staffName(order)} conflicts={conflicts.get(order.id) || []} />)}</div></section>)}
      </div>

      {(view === "week" || view === "month") && <div className="hidden min-w-0 rounded-2xl border border-border bg-white xl:block" aria-label={view === "month" ? "Lưới lịch tháng" : "Lưới lịch tuần"}>
        <div className="grid min-w-0 grid-cols-7 border-b border-border bg-slate-50">{["Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7", "Chủ nhật"].map((label) => <span key={label} className="px-2 py-3 text-center text-xs font-semibold text-muted-foreground">{label}</span>)}</div>
        <div className="grid min-w-0 grid-cols-7">
          {Array.from({ length: monthPadding }, (_, index) => <div key={`before-${index}`} aria-hidden="true" className="min-h-40 border-r border-b border-border bg-slate-50/60" />)}
          {dates.map((value) => { const key = localDateKey(value); const dayJobs = byDay.get(key) || []; return <section key={key} aria-label={`Công việc ${displayDay(value)}`} className={`min-w-0 border-r border-b border-border p-2 last:border-r-0 ${key === today ? "bg-blue-50/30" : ""}`}><h3 className="m-0 mb-3 text-center text-xs font-semibold"><span className={`inline-flex min-h-8 items-center justify-center rounded-lg px-2 ${key === today ? "bg-primary text-white" : "text-muted-foreground"}`}>{displayDay(value, false)}</span></h3><div className="grid min-w-0 gap-2">{dayJobs.map((order) => <CalendarEvent key={order.id} order={order} serviceName={services.get(order.serviceId)?.name || "Dịch vụ đã lưu"} staffName={staffName(order)} conflicts={conflicts.get(order.id) || []} compact />)}</div>{dayJobs.length === 0 && <p className="m-0 py-5 text-center text-xs leading-5 text-muted-foreground">Không có công việc</p>}</section> })}
          {Array.from({ length: lastPadding }, (_, index) => <div key={`after-${index}`} aria-hidden="true" className="min-h-40 border-r border-b border-border bg-slate-50/60" />)}
        </div>
      </div>}
    </>}
    <p className="m-0 text-xs leading-6 text-muted-foreground">Lịch hiển thị từ dữ liệu đã lưu trên trình duyệt này. Các bộ lọc chỉ thay đổi cách xem lịch.</p>
  </div>
}
