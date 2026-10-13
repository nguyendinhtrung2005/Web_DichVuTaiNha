"use client"

import { useState } from "react"
import { AreaLink as Link } from "@/components/shared/area-routes"
import { CalendarDaysIcon, ChevronLeftIcon, ChevronRightIcon, MapPinIcon } from "lucide-react"
import { Field, useData } from "../../common"
import { Button } from "../ui/button"
import { Input } from "../ui/input"
import { formatJobTime, getAssignedJobs, JOB_FILTER_OPTIONS, jobFilterValue, localDateKey, StaffEmpty, StaffError, StaffJobBadge, StaffJobCard, StaffLoading, StaffPageHeader } from "./staff-shared"
import type { Order } from "@/lib/types"

type CalendarView = "day" | "week" | "month" | "list"

function displayDay(day: Date, weekday = true) {
  return day.toLocaleDateString("vi-VN", { ...(weekday ? { weekday: "short" as const } : {}), day: "2-digit", month: "2-digit" })
}

function calendarRange(anchor: string, view: CalendarView) {
  const base = new Date(`${anchor}T12:00:00`)
  const start = new Date(base)
  if (view === "month") start.setDate(1)
  else if (view !== "day") start.setDate(start.getDate() - (start.getDay() + 6) % 7)
  const count = view === "day" ? 1 : view === "month" ? new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate() : 7
  const dates = Array.from({ length: count }, (_, index) => {
    const date = new Date(start)
    date.setDate(start.getDate() + index)
    return date
  })
  return { base, start, dates }
}

function eventColor(order: Order) {
  switch (jobFilterValue(order)) {
    case "cancelled": return "border-slate-300 bg-slate-50 hover:bg-slate-100"
    case "done": return "border-emerald-300 bg-emerald-50/60 hover:bg-emerald-50"
    case "in_progress": return "border-sky-300 bg-sky-50/70 hover:bg-sky-50"
    case "accepted": return "border-blue-300 bg-blue-50/60 hover:bg-blue-50"
    default: return "border-amber-300 bg-amber-50/60 hover:bg-amber-50"
  }
}

export function StaffCalendar() {
  const { s, user, role } = useData()
  const [anchor, setAnchor] = useState(() => localDateKey(new Date()))
  const [view, setView] = useState<CalendarView>("week")
  const [status, setStatus] = useState("")

  if (!s) return <StaffLoading />
  if (!user || role !== "staff" || user.role !== "staff") return <StaffEmpty title="Vui lòng đăng nhập tài khoản nhân viên" />
  const jobs = getAssignedJobs(s, user.id)
  if (!jobs) return <StaffError />

  const { base, start, dates } = calendarRange(anchor, view)
  const dateKeys = new Set(dates.map(localDateKey))
  const selectedJobs = jobs.filter((order) => (status ? jobFilterValue(order) === status : order.status !== "cancelled") && dateKeys.has(localDateKey(order.scheduledAt))).sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())
  const services = new Map(s.services.map((service) => [service.id, service]))
  const byDay = new Map(dates.map((date) => [localDateKey(date), selectedJobs.filter((order) => localDateKey(order.scheduledAt) === localDateKey(date))]))
  const nonEmptyDates = dates.filter((date) => Boolean(byDay.get(localDateKey(date))?.length))
  const today = localDateKey(new Date())
  const monthPadding = view === "month" ? (start.getDay() + 6) % 7 : 0
  const lastPadding = view === "month" ? (7 - (monthPadding + dates.length) % 7) % 7 : 0
  const periodLabel = view === "month" ? base.toLocaleDateString("vi-VN", { month: "long", year: "numeric" }) : view === "day" ? base.toLocaleDateString("vi-VN", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" }) : `${displayDay(dates[0], false)} – ${displayDay(dates[dates.length - 1], false)} / ${dates[dates.length - 1].getFullYear()}`
  const shift = (direction: number) => {
    const next = new Date(base)
    if (view === "month") next.setMonth(next.getMonth() + direction, 1)
    else next.setDate(next.getDate() + direction * (view === "day" ? 1 : 7))
    setAnchor(localDateKey(next))
  }
  const agendaClass = view === "day" || view === "list" ? "grid min-w-0 gap-6" : "grid min-w-0 gap-6 xl:hidden"

  return (
    <div className="min-w-0 space-y-6">
      <StaffPageHeader title="Lịch làm việc" description="Sắp xếp ngày làm việc và mở thông tin từng lịch hẹn của bạn." />

      <section aria-label="Chọn lịch làm việc" className="min-w-0 rounded-2xl border border-border bg-white p-5 sm:p-6">
        <div className="grid min-w-0 gap-5 sm:grid-cols-2 xl:grid-cols-3">
          <Field label="Ngày xem lịch"><Input type="date" value={anchor} onChange={(event) => { if (event.target.value && !Number.isNaN(new Date(`${event.target.value}T12:00:00`).getTime())) setAnchor(event.target.value) }} /></Field>
          <Field label="Chế độ xem"><select value={view} onChange={(event) => setView(event.target.value as CalendarView)}><option value="day">Ngày</option><option value="week">Tuần</option><option value="month">Tháng</option><option value="list">Danh sách tuần</option></select></Field>
          <Field label="Trạng thái công việc"><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Tất cả công việc đang có lịch</option>{JOB_FILTER_OPTIONS.filter((option) => option.value).map(({ value, label }) => <option key={value} value={value}>{label}</option>)}</select></Field>
        </div>
        <div className="mt-5 flex flex-col gap-4 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0"><h2 className="m-0 break-words text-lg leading-7 font-semibold capitalize">{periodLabel}</h2><p role="status" aria-live="polite" className="m-0 mt-1 text-sm text-muted-foreground">{selectedJobs.length} công việc trong khoảng thời gian này{status ? ", theo trạng thái đã chọn" : ""}.</p></div>
          <div className="grid w-full grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2 sm:w-auto sm:shrink-0"><Button variant="outline" className="min-h-11 px-3" aria-label={view === "day" ? "Ngày trước" : view === "month" ? "Tháng trước" : "Tuần trước"} onClick={() => shift(-1)}><ChevronLeftIcon aria-hidden="true" />Trước</Button><Button variant="outline" className="min-h-11 px-3" onClick={() => setAnchor(today)}>Hôm nay</Button><Button variant="outline" className="min-h-11 px-3" aria-label={view === "day" ? "Ngày sau" : view === "month" ? "Tháng sau" : "Tuần sau"} onClick={() => shift(1)}>Sau<ChevronRightIcon aria-hidden="true" /></Button></div>
        </div>
      </section>

      {selectedJobs.length === 0 ? <StaffEmpty title="Không có công việc trong lịch đã chọn" description={status ? "Thử thay đổi trạng thái hoặc chọn ngày khác để xem lịch của bạn." : "Chọn ngày hoặc khoảng thời gian khác để xem các công việc được phân công."} action={status ? <Button variant="outline" className="min-h-11" onClick={() => setStatus("")}>Xóa bộ lọc trạng thái</Button> : undefined} /> : <>
        <div className={agendaClass} aria-label="Danh sách lịch hẹn theo ngày">
          {nonEmptyDates.map((date) => <section key={localDateKey(date)} aria-label={`Công việc ${displayDay(date)}`} className="min-w-0">
            <div className="mb-4 flex flex-wrap items-center gap-3"><span className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${localDateKey(date) === today ? "bg-blue-100 text-primary" : "bg-white text-muted-foreground ring-1 ring-border"}`}><CalendarDaysIcon className="size-5" aria-hidden="true" /></span><h3 className="m-0 text-base font-semibold capitalize">{displayDay(date)}{localDateKey(date) === today ? " · Hôm nay" : ""}</h3><span className="text-sm text-muted-foreground">{byDay.get(localDateKey(date))?.length} công việc</span></div>
            <div className="grid min-w-0 gap-4 lg:grid-cols-2">{byDay.get(localDateKey(date))?.map((order) => <StaffJobCard key={order.id} order={order} service={services.get(order.serviceId)} />)}</div>
          </section>)}
        </div>

        {(view === "week" || view === "month") && <div className="hidden min-w-0 rounded-2xl border border-border bg-white xl:block" aria-label={view === "month" ? "Lưới lịch tháng" : "Lưới lịch tuần"}>
          <div className="grid min-w-0 grid-cols-7 border-b border-border bg-slate-50">{["Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7", "Chủ nhật"].map((label) => <span key={label} className="px-3 py-3 text-center text-xs font-semibold text-muted-foreground">{label}</span>)}</div>
          <div className="grid min-w-0 grid-cols-7">
            {Array.from({ length: monthPadding }, (_, index) => <div key={`before-${index}`} aria-hidden="true" className="min-h-40 border-r border-b border-border bg-slate-50/60" />)}
            {dates.map((date) => {
              const key = localDateKey(date)
              const dayJobs = byDay.get(key) || []
              return <section key={key} aria-label={`Công việc ${displayDay(date)}`} className={`min-w-0 border-r border-b border-border p-2.5 last:border-r-0 ${key === today ? "bg-blue-50/30" : ""}`}>
                <h3 className="m-0 mb-3 text-center text-xs font-semibold"><span className={`inline-flex min-h-8 items-center justify-center rounded-lg px-2 ${key === today ? "bg-primary text-white" : "text-muted-foreground"}`}>{displayDay(date, false)}</span></h3>
                <div className="grid min-w-0 gap-2">{dayJobs.map((order) => <Link key={order.id} href={`/don/${order.id}`} aria-label={`Xem công việc ${order.code}`} className={`block min-w-0 rounded-xl border-l-[3px] p-2.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${eventColor(order)}`}>
                  <p className="m-0 break-words text-xs leading-5 font-semibold tabular-nums">{formatJobTime(order.scheduledAt)}</p>
                  <p className="m-0 mt-1 break-words text-xs leading-5 font-semibold">{order.code}</p>
                  <p className="m-0 mt-1 break-words text-xs leading-5">{services.get(order.serviceId)?.name || "Dịch vụ không còn trong danh sách"}</p>
                  <div className="mt-2 flex min-w-0 items-start gap-1.5 text-muted-foreground"><MapPinIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" /><span className="min-w-0 break-words text-xs leading-5">{order.contact.address}</span></div>
                  <div className="mt-2 min-w-0 [&_[data-slot=badge]]:h-auto [&_[data-slot=badge]]:max-w-full [&_[data-slot=badge]]:text-center [&_[data-slot=badge]]:whitespace-normal"><StaffJobBadge order={order} /></div>
                </Link>)}</div>
                {!dayJobs.length && <p className="m-0 py-5 text-center text-xs leading-5 text-muted-foreground">Không có công việc</p>}
              </section>
            })}
            {Array.from({ length: lastPadding }, (_, index) => <div key={`after-${index}`} aria-hidden="true" className="min-h-40 border-r border-b border-border bg-slate-50/60" />)}
          </div>
        </div>}
      </>}
    </div>
  )
}
