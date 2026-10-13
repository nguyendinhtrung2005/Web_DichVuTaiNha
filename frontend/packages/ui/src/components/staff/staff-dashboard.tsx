"use client"

import { AreaLink as Link } from "@/components/shared/area-routes"
import { ArrowRightIcon, CalendarDaysIcon, CheckCheckIcon, ClipboardListIcon, Clock3Icon, PlayIcon } from "lucide-react"
import { useData } from "../../common"
import { Button } from "../ui/button"
import { Card, CardContent } from "../ui/card"
import { getAssignedJobs, jobFilterValue, localDateKey, StaffEmpty, StaffError, StaffJobCard, StaffLoading, StaffPageHeader } from "./staff-shared"
import type { Order } from "@/lib/types"

export function StaffDashboard() {
  const { s, user, role } = useData()

  if (!s) return <StaffLoading />
  if (!user || role !== "staff" || user.role !== "staff") return <StaffEmpty title="Vui lòng đăng nhập tài khoản nhân viên" />
  const jobs = getAssignedJobs(s, user.id)
  if (!jobs || typeof user.name !== "string") return <StaffError />

  const now = new Date()
  const today = localDateKey(now)
  const activeJobs = jobs.filter((order) => order.status !== "cancelled")
  const todayJobs = activeJobs.filter((order) => localDateKey(order.scheduledAt) === today)
  const waitingJobs = activeJobs.filter((order) => jobFilterValue(order) === "waiting")
  const inProgressJobs = activeJobs.filter((order) => jobFilterValue(order) === "in_progress")
  const doneJobs = activeJobs.filter((order) => jobFilterValue(order) === "done")
  const bySchedule = (a: Order, b: Order) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()
  const upcoming = activeJobs.filter((order) => !["done", "in_progress"].includes(jobFilterValue(order)) && new Date(order.scheduledAt).getTime() >= now.getTime()).sort(bySchedule)
  const attention = activeJobs.filter((order) => jobFilterValue(order) !== "done" && (["waiting", "in_progress"].includes(jobFilterValue(order)) || order.cancelRequest?.status === "pending" || new Date(order.scheduledAt).getTime() < now.getTime())).sort(bySchedule)
  const services = new Map(s.services.map((service) => [service.id, service]))
  const stats = [
    { label: "Công việc hôm nay", value: todayJobs.length, hint: "Theo lịch thực hiện trong ngày", icon: CalendarDaysIcon, color: "bg-blue-50 text-primary" },
    { label: "Chờ tiếp nhận", value: waitingJobs.length, hint: "Công việc đang chờ bạn tiếp nhận", icon: Clock3Icon, color: "bg-amber-50 text-amber-700" },
    { label: "Đang thực hiện", value: inProgressJobs.length, hint: "Công việc đã bắt đầu", icon: PlayIcon, color: "bg-sky-50 text-sky-700" },
    { label: "Đã hoàn thành", value: doneJobs.length, hint: "Tổng công việc của bạn đã hoàn thành", icon: CheckCheckIcon, color: "bg-emerald-50 text-emerald-700" },
  ]

  return (
    <div className="min-w-0 space-y-8">
      <StaffPageHeader title={`Chào ${user.name},`} description="Theo dõi lịch trình và những công việc cần bạn xử lý." action={<Button className="min-h-11 w-full px-4 sm:w-auto" render={<Link href="/lich-lam-viec" />} nativeButton={false}><CalendarDaysIcon aria-hidden="true" />Xem lịch làm việc</Button>} />

      <section aria-label="Thống kê công việc của bạn" className="grid min-w-0 grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {stats.map(({ label, value, hint, icon: Icon, color }) => (
          <Card key={label} className="min-w-0 rounded-2xl shadow-none ring-border [--card-spacing:--spacing(4)] sm:[--card-spacing:--spacing(5)]">
            <CardContent>
              <div className="flex items-start justify-between gap-2 sm:gap-3"><p className="m-0 text-xs leading-5 font-medium text-muted-foreground sm:text-sm sm:leading-6">{label}</p><span className={`flex size-8 shrink-0 items-center justify-center rounded-xl sm:size-10 ${color}`}><Icon className="size-4 sm:size-5" aria-hidden="true" /></span></div>
              <p className="m-0 mt-3 text-3xl font-semibold tracking-tight tabular-nums sm:mt-4">{value}</p>
              <p className="m-0 mt-2 hidden text-xs leading-5 text-muted-foreground sm:block">{hint}</p>
            </CardContent>
          </Card>
        ))}
      </section>

      <div className="grid min-w-0 items-start gap-8 xl:grid-cols-2">
        <section aria-labelledby="staff-upcoming-heading" className="min-w-0">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div className="min-w-0"><h2 id="staff-upcoming-heading" className="m-0 text-xl font-semibold tracking-tight">Lịch công việc sắp tới</h2><p className="m-0 mt-2 text-sm leading-6 text-muted-foreground">Các lịch hẹn chưa bắt đầu, theo thứ tự thời gian.</p></div><Link href="/lich-lam-viec" className="inline-flex min-h-11 items-center gap-2 rounded-lg text-sm font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">Xem lịch<ArrowRightIcon className="size-4" aria-hidden="true" /></Link></div>
          {upcoming.length ? <div className="grid min-w-0 gap-4">{upcoming.slice(0, 4).map((order) => <StaffJobCard key={order.id} order={order} service={services.get(order.serviceId)} />)}</div> : <StaffEmpty title="Chưa có lịch hẹn sắp tới" description="Công việc được phân công sẽ xuất hiện khi có lịch thực hiện mới." />}
          {upcoming.length > 4 && <p className="m-0 mt-4 text-sm text-muted-foreground">Còn {upcoming.length - 4} công việc khác trong lịch của bạn.</p>}
        </section>

        <section aria-labelledby="staff-attention-heading" className="min-w-0">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div className="min-w-0"><h2 id="staff-attention-heading" className="m-0 text-xl font-semibold tracking-tight">Công việc cần chú ý</h2><p className="m-0 mt-2 text-sm leading-6 text-muted-foreground">Công việc đã đến lịch, chờ tiếp nhận, đang thực hiện hoặc có yêu cầu hủy.</p></div><Link href="/cong-viec" className="inline-flex min-h-11 items-center gap-2 rounded-lg text-sm font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">Xem tất cả<ArrowRightIcon className="size-4" aria-hidden="true" /></Link></div>
          {attention.length ? <div className="grid min-w-0 gap-4">{attention.slice(0, 4).map((order) => <StaffJobCard key={order.id} order={order} service={services.get(order.serviceId)} />)}</div> : <StaffEmpty title="Không có công việc cần xử lý ngay" description="Bạn có thể kiểm tra lịch làm việc để chuẩn bị cho các lịch hẹn tiếp theo." action={<Button variant="outline" className="min-h-11" render={<Link href="/cong-viec" />} nativeButton={false}><ClipboardListIcon aria-hidden="true" />Xem công việc</Button>} />}
          {attention.length > 4 && <p className="m-0 mt-4 text-sm text-muted-foreground">Còn {attention.length - 4} công việc cần chú ý trong danh sách.</p>}
        </section>
      </div>
    </div>
  )
}
