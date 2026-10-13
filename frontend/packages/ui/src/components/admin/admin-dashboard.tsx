"use client"

import { useState } from "react"
import { AreaLink as Link } from "@/components/shared/area-routes"
import { ArrowRightIcon, BriefcaseBusinessIcon, CheckCheckIcon, ClipboardListIcon, Clock3Icon, CreditCardIcon, PlayIcon, RotateCcwIcon, UsersIcon } from "lucide-react"
import { Field, money, useData } from "../../common"
import { Button } from "../ui/button"
import { Card, CardContent } from "../ui/card"
import { Input } from "../ui/input"
import { OrderStatusBadge } from "../shared/status-badge"
import { ORDER_STATUS_LABEL } from "@/lib/config"
import { AdminEmpty, AdminError, AdminLoading, AdminPageHeader, formatAdminTime, getAdminDataError, localDateKey } from "./admin-shared"
import type { Order } from "@/lib/types"

const STATUS_COLOR = { pending: "bg-amber-400", confirmed: "bg-blue-400", in_progress: "bg-sky-500", completed: "bg-emerald-500", cancelled: "bg-slate-400" }

function DashboardOrder({ order, service, attention }: { order: Order; service?: string; attention?: string }) {
  return <Link href={`/don/${order.id}`} aria-label={`Xem chi tiết đơn ${order.code}`} className="block min-w-0 rounded-xl border border-border bg-white p-4 outline-none transition-colors hover:border-blue-200 hover:bg-blue-50/30 focus-visible:ring-3 focus-visible:ring-ring/50 sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><span className="break-words text-xs font-semibold text-muted-foreground">{order.code}</span><OrderStatusBadge status={order.status} /></div>
    <h3 className="m-0 mt-3 break-words text-sm leading-7 font-semibold">{service || "Dịch vụ không còn trong danh sách"}</h3>
    <p className="m-0 mt-1 break-words text-xs leading-6 text-muted-foreground">{order.contact.name} · {formatAdminTime(order.scheduledAt)}</p>
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><span className={`break-words text-xs leading-6 ${attention ? "text-amber-800" : "font-semibold text-primary tabular-nums"}`}>{attention || money(order.price)}</span><span className="inline-flex items-center gap-1 text-xs font-semibold text-primary">Chi tiết<ArrowRightIcon aria-hidden="true" className="size-3.5" /></span></div>
  </Link>
}

export function AdminDashboard() {
  const { s, user, role } = useData()
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")

  if (!s) return <AdminLoading />
  if (!user || role !== "admin" || user.role !== "admin" || user.status !== "active") return <AdminEmpty title="Vui lòng đăng nhập tài khoản quản trị viên" />
  const dataError = getAdminDataError(s)
  if (dataError) return <AdminError />

  const rangeError = Boolean(from && to && from > to)
  const inRange = (value: string) => {
    const key = localDateKey(value)
    return !rangeError && (!from || key >= from) && (!to || key <= to)
  }
  const orders = s.orders.filter((order) => inRange(order.createdAt))
  const paidPayments = s.payments.filter((payment) => payment.status === "paid" && inRange(payment.confirmedAt || payment.createdAt))
  const revenue = paidPayments.reduce((sum, payment) => sum + payment.amount, 0)
  const services = new Map(s.services.map((service) => [service.id, service.name]))
  const recentOrders = orders.slice().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 6)
  const attentionOrders = orders.filter((order) => order.cancelRequest?.status === "pending" || order.status === "pending" || (order.status === "confirmed" && !order.staffId)).sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())
  const attentionLabel = (order: Order) => [order.cancelRequest?.status === "pending" ? "Yêu cầu hủy chờ duyệt" : "", order.status === "pending" ? "Cần xác nhận đơn" : "", order.status === "confirmed" && !order.staffId ? "Chưa phân công nhân viên" : ""].filter(Boolean).join(" · ")
  const monthly = new Map<string, number>()
  paidPayments.forEach((payment) => {
    const month = localDateKey(payment.confirmedAt || payment.createdAt).slice(0, 7)
    monthly.set(month, (monthly.get(month) || 0) + payment.amount)
  })
  const months = [...monthly.entries()].sort(([a], [b]) => a.localeCompare(b))
  const maxRevenue = Math.max(1, ...months.map(([, amount]) => amount))
  const maxOrders = Math.max(1, orders.length)
  const cards = [
    { key: "orders", label: "Tổng đơn dịch vụ", value: String(orders.length), hint: "Theo ngày tạo đơn trong khoảng đã chọn", icon: ClipboardListIcon, color: "bg-blue-50 text-primary" },
    { key: "revenue", label: "Doanh thu đã ghi nhận", value: money(revenue), hint: `${paidPayments.length} khoản đã được xác nhận thanh toán`, icon: CreditCardIcon, color: "bg-emerald-50 text-emerald-700" },
    { key: "customers", label: "Khách hàng", value: String(s.users.filter((account) => account.role === "customer").length), hint: "Tổng tài khoản khách hàng hiện có", icon: UsersIcon, color: "bg-sky-50 text-sky-700" },
    { key: "staff", label: "Nhân viên", value: String(s.users.filter((account) => account.role === "staff").length), hint: "Tổng tài khoản nhân viên hiện có", icon: BriefcaseBusinessIcon, color: "bg-indigo-50 text-indigo-700" },
  ]
  const statusCards = [
    { key: "pending", label: "Chờ xác nhận", icon: Clock3Icon, color: "bg-amber-50 text-amber-700" },
    { key: "in_progress", label: "Đang thực hiện", icon: PlayIcon, color: "bg-sky-50 text-sky-700" },
    { key: "completed", label: "Đã hoàn thành", icon: CheckCheckIcon, color: "bg-emerald-50 text-emerald-700" },
  ]

  return <div className="min-w-0 space-y-7">
    <AdminPageHeader title="Tổng quan hoạt động" description="Theo dõi đơn dịch vụ, doanh thu đã ghi nhận và các công việc cần xử lý." action={<Button className="min-h-11 w-full sm:w-auto" render={<Link href="/don-dich-vu" />} nativeButton={false}><ClipboardListIcon aria-hidden="true" />Quản lý đơn</Button>} />

    <section aria-label="Khoảng thời gian thống kê" className="min-w-0 rounded-2xl border border-border bg-white p-5 sm:p-6">
      <div className="grid min-w-0 gap-5 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] xl:items-end"><Field label="Từ ngày"><Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></Field><Field label="Đến ngày" error={rangeError ? "Ngày kết thúc phải từ ngày bắt đầu trở đi." : undefined}><Input type="date" min={from || undefined} value={to} onChange={(event) => setTo(event.target.value)} /></Field><Button variant="outline" className="min-h-11 w-full sm:col-span-2 xl:col-span-1 xl:w-auto" disabled={!from && !to} onClick={() => { setFrom(""); setTo("") }}><RotateCcwIcon aria-hidden="true" />Xóa khoảng ngày</Button></div>
      <p className="m-0 mt-4 text-xs leading-6 text-muted-foreground">Đơn theo ngày tạo; doanh thu theo ngày xác nhận thanh toán, hoặc ngày tạo bản ghi khi chưa có ngày xác nhận. Số tài khoản là tổng hiện có, không giới hạn theo ngày.</p>
    </section>

    {rangeError ? <AdminEmpty title="Khoảng ngày chưa hợp lệ" description="Điều chỉnh ngày bắt đầu hoặc ngày kết thúc để xem thống kê." /> : <>
      <section aria-label="Thống kê hoạt động CleanHome" className="grid min-w-0 grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {cards.map(({ key, label, value, hint, icon: Icon, color }) => <article key={key} data-stat={key} className="min-w-0"><Card className="h-full min-w-0 rounded-2xl shadow-none ring-border [--card-spacing:--spacing(4)] sm:[--card-spacing:--spacing(5)]"><CardContent><span className={`mb-4 flex size-10 items-center justify-center rounded-xl ${color}`}><Icon aria-hidden="true" className="size-5" /></span><dl className="m-0 min-w-0"><dt className="text-xs leading-6 font-medium text-muted-foreground sm:text-sm">{label}</dt><dd className={`m-0 mt-2 break-words font-semibold tracking-tight tabular-nums ${key === "revenue" ? "text-xl leading-8 sm:text-2xl" : "text-3xl leading-9"}`}>{value}</dd></dl><p className="m-0 mt-3 text-xs leading-5 text-muted-foreground">{hint}</p></CardContent></Card></article>)}
        <div className="col-span-full grid min-w-0 gap-3 sm:grid-cols-3 sm:gap-4">{statusCards.map(({ key, label, icon: Icon, color }) => <article key={key} data-stat={key} className="flex min-w-0 items-center gap-4 rounded-2xl border border-border bg-white p-4 sm:p-5"><span className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${color}`}><Icon aria-hidden="true" className="size-5" /></span><dl className="m-0 min-w-0"><dt className="text-xs leading-6 font-medium text-muted-foreground sm:text-sm">{label}</dt><dd className="m-0 mt-1 text-2xl font-semibold tabular-nums">{orders.filter((order) => order.status === key).length}</dd></dl></article>)}</div>
      </section>

      <div className="grid min-w-0 items-start gap-6 xl:grid-cols-2">
        <section aria-labelledby="admin-revenue-heading" className="min-w-0 rounded-2xl border border-border bg-white p-5 sm:p-6"><h2 id="admin-revenue-heading" className="m-0 text-lg font-semibold">Doanh thu theo tháng</h2><p className="m-0 mt-2 text-xs leading-6 text-muted-foreground">Chỉ cộng các bản ghi đã thanh toán trong khoảng ngày đã chọn. Tổng ghi nhận chưa trừ những khoản hoàn tiền cần xử lý.</p>{months.length ? <ol className="m-0 mt-6 grid min-w-0 list-none gap-5 p-0">{months.map(([month, amount]) => <li key={month} className="min-w-0"><div className="mb-2 flex min-w-0 flex-wrap items-center justify-between gap-2 text-sm"><span className="text-muted-foreground">{month.slice(5)}/{month.slice(0, 4)}</span><strong className="break-words font-semibold text-primary tabular-nums">{money(amount)}</strong></div><div aria-hidden="true" className="h-2 rounded-full bg-blue-50"><div className="h-full rounded-full bg-primary" style={{ width: `${amount / maxRevenue * 100}%` }} /></div></li>)}</ol> : <p className="m-0 mt-6 rounded-xl bg-slate-50 px-4 py-5 text-sm leading-7 text-muted-foreground">Chưa có bản ghi đã thanh toán trong khoảng thời gian này.</p>}</section>
        <section aria-labelledby="admin-status-heading" className="min-w-0 rounded-2xl border border-border bg-white p-5 sm:p-6"><h2 id="admin-status-heading" className="m-0 text-lg font-semibold">Tình trạng đơn dịch vụ</h2><p className="m-0 mt-2 text-xs leading-6 text-muted-foreground">Phân bố {orders.length} đơn theo trạng thái hiện tại, lọc bằng ngày tạo đơn.</p>{orders.length ? <ul className="m-0 mt-6 grid min-w-0 list-none gap-5 p-0">{Object.entries(ORDER_STATUS_LABEL).map(([status, label]) => { const count = orders.filter((order) => order.status === status).length; return <li key={status} className="min-w-0"><div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm"><span className="text-muted-foreground">{label}</span><strong className="font-semibold tabular-nums">{count}</strong></div><div aria-hidden="true" className="h-2 rounded-full bg-slate-100"><div className={`h-full rounded-full ${STATUS_COLOR[status as keyof typeof STATUS_COLOR]}`} style={{ width: `${count / maxOrders * 100}%` }} /></div></li> })}</ul> : <p className="m-0 mt-6 rounded-xl bg-slate-50 px-4 py-5 text-sm leading-7 text-muted-foreground">Chưa có đơn dịch vụ trong khoảng thời gian này.</p>}</section>
      </div>

      <div className="grid min-w-0 items-start gap-7 xl:grid-cols-2">
        <section aria-labelledby="admin-recent-heading" className="min-w-0"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 id="admin-recent-heading" className="m-0 text-lg font-semibold">Đơn dịch vụ gần đây</h2><Link href="/don-dich-vu" className="inline-flex min-h-11 items-center gap-1 rounded-lg text-sm font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">Xem tất cả<ArrowRightIcon aria-hidden="true" className="size-4" /></Link></div>{recentOrders.length ? <div className="grid min-w-0 gap-3">{recentOrders.map((order) => <DashboardOrder key={order.id} order={order} service={services.get(order.serviceId)} />)}</div> : <AdminEmpty title="Chưa có đơn trong khoảng đã chọn" description="Thử mở rộng khoảng ngày để xem các đơn hiện có." />}</section>
        <section aria-labelledby="admin-attention-heading" className="min-w-0"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 id="admin-attention-heading" className="m-0 text-lg font-semibold">Công việc cần xử lý</h2><span className="text-sm text-muted-foreground">{attentionOrders.length} đơn</span></div>{attentionOrders.length ? <div className="grid min-w-0 gap-3">{attentionOrders.slice(0, 6).map((order) => <DashboardOrder key={order.id} order={order} service={services.get(order.serviceId)} attention={attentionLabel(order)} />)}{attentionOrders.length > 6 && <Link href="/don-dich-vu" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg text-sm font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">Xem {attentionOrders.length - 6} đơn cần xử lý khác<ArrowRightIcon aria-hidden="true" className="size-4" /></Link>}</div> : <AdminEmpty title="Không có đơn cần xử lý trong khoảng đã chọn" description="Những đơn chờ xác nhận, yêu cầu hủy chờ duyệt và đơn chưa phân công sẽ xuất hiện tại đây." />}</section>
      </div>
    </>}
  </div>
}
