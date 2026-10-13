"use client"

import { useState } from "react"
import { AreaLink as Link } from "@/components/shared/area-routes"
import { ArrowRightIcon, CalendarDaysIcon, MapPinIcon, RotateCcwIcon, UserRoundIcon } from "lucide-react"
import { Field, money, useData } from "../../common"
import { Button } from "../ui/button"
import { Card, CardContent } from "../ui/card"
import { Input } from "../ui/input"
import { CancelRequestBadge, OrderStatusBadge } from "../shared/status-badge"
import { ORDER_STATUS_LABEL } from "@/lib/config"
import { AdminEmpty, AdminError, AdminLoading, AdminPageHeader, formatAdminTime, getAdminDataError, localDateKey, normalizeSearch } from "./admin-shared"

const PAGE_SIZE = 8

export function AdminOrders() {
  const { s, user, role } = useData()
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState("")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [sort, setSort] = useState("created-desc")
  const [page, setPage] = useState(0)

  if (!s) return <AdminLoading />
  if (!user || role !== "admin" || user.role !== "admin" || user.status !== "active") return <AdminEmpty title="Vui lòng đăng nhập tài khoản quản trị viên" />
  const dataError = getAdminDataError(s)
  if (dataError) return <AdminError />

  const services = new Map(s.services.map((service) => [service.id, service]))
  const users = new Map(s.users.map((account) => [account.id, account]))
  const normalizedQuery = normalizeSearch(query)
  const rangeError = Boolean(from && to && from > to)
  const filtered = s.orders.filter((order) => {
    const text = normalizeSearch(`${order.code} ${order.contact.name} ${users.get(order.customerId)?.name || ""} ${services.get(order.serviceId)?.name || ""}`)
    const scheduledDay = localDateKey(order.scheduledAt)
    return !rangeError && (!normalizedQuery || text.includes(normalizedQuery)) && (!status || order.status === status) && (!from || scheduledDay >= from) && (!to || scheduledDay <= to)
  }).sort((a, b) => {
    if (sort === "created-asc") return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    if (sort === "schedule-asc") return new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()
    if (sort === "schedule-desc") return new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime()
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  })
  const pages = Math.ceil(filtered.length / PAGE_SIZE)
  const currentPage = Math.min(page, Math.max(0, pages - 1))
  const displayed = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)
  const hasFilters = Boolean(query || status || from || to || sort !== "created-desc")
  const clearFilters = () => { setQuery(""); setStatus(""); setFrom(""); setTo(""); setSort("created-desc"); setPage(0) }

  return <div className="min-w-0 space-y-6">
    <AdminPageHeader title="Quản lý đơn dịch vụ" description="Tra cứu lịch hẹn, trạng thái và mở chi tiết để xử lý từng đơn." />

    <section aria-label="Tìm và lọc đơn dịch vụ" className="min-w-0 rounded-2xl border border-border bg-white p-5 sm:p-6">
      <div className="grid min-w-0 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <Field label="Tìm kiếm đơn"><Input type="search" value={query} placeholder="Mã đơn, khách hàng, dịch vụ..." onChange={(event) => { setQuery(event.target.value); setPage(0) }} /></Field>
        <Field label="Trạng thái đơn"><select value={status} onChange={(event) => { setStatus(event.target.value); setPage(0) }}><option value="">Tất cả trạng thái</option>{Object.entries(ORDER_STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
        <Field label="Lịch thực hiện từ ngày"><Input type="date" value={from} onChange={(event) => { setFrom(event.target.value); setPage(0) }} /></Field>
        <Field label="Đến ngày" error={rangeError ? "Ngày kết thúc phải từ ngày bắt đầu trở đi." : undefined}><Input type="date" value={to} min={from || undefined} onChange={(event) => { setTo(event.target.value); setPage(0) }} /></Field>
      </div>
      <div className="mt-5 flex min-w-0 flex-col items-start gap-4 border-t border-border pt-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="w-full min-w-0 sm:max-w-72"><Field label="Sắp xếp"><select value={sort} onChange={(event) => { setSort(event.target.value); setPage(0) }}><option value="created-desc">Ngày tạo: mới nhất</option><option value="created-asc">Ngày tạo: cũ nhất</option><option value="schedule-asc">Lịch thực hiện: tăng dần</option><option value="schedule-desc">Lịch thực hiện: giảm dần</option></select></Field></div>
        <Button variant="outline" className="min-h-11 w-full sm:w-auto" disabled={!hasFilters} onClick={clearFilters}><RotateCcwIcon aria-hidden="true" />Xóa bộ lọc</Button>
      </div>
    </section>

    {!rangeError && <p role="status" aria-live="polite" className="m-0 text-sm leading-6 text-muted-foreground"><span className="font-semibold text-foreground">{filtered.length}</span> đơn dịch vụ{hasFilters ? ` phù hợp / ${s.orders.length} đơn hiện có` : " hiện có"}</p>}

    {rangeError ? <AdminEmpty title="Khoảng ngày chưa hợp lệ" description="Điều chỉnh ngày bắt đầu hoặc ngày kết thúc để xem các đơn phù hợp." action={<Button variant="outline" className="min-h-11" onClick={clearFilters}>Xóa bộ lọc</Button>} /> : filtered.length === 0 ? <AdminEmpty title={s.orders.length ? "Không tìm thấy đơn dịch vụ phù hợp" : "Chưa có đơn dịch vụ"} description={s.orders.length ? "Thử từ khóa khác hoặc điều chỉnh trạng thái và khoảng ngày." : "Đơn dịch vụ sẽ xuất hiện khi nguồn dữ liệu có đơn mới."} action={hasFilters ? <Button variant="outline" className="min-h-11" onClick={clearFilters}>Xóa bộ lọc</Button> : undefined} /> : <>
      <div className="grid min-w-0 gap-4 xl:hidden">
        {displayed.map((order) => <Card key={order.id} className="min-w-0 rounded-2xl shadow-none ring-border [--card-spacing:--spacing(5)]"><CardContent className="flex min-w-0 flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3"><p className="m-0 break-words text-xs font-semibold text-muted-foreground">{order.code}</p><OrderStatusBadge status={order.status} /></div>
          <div className="min-w-0"><h2 className="m-0 break-words text-base leading-7 font-semibold">{services.get(order.serviceId)?.name || "Dịch vụ không còn trong danh sách"}</h2><p className="m-0 mt-2 text-sm text-muted-foreground">{order.quantity} {services.get(order.serviceId)?.unit || "đơn vị"}</p></div>
          <dl className="m-0 grid min-w-0 gap-3 text-sm">
            <div className="flex min-w-0 items-start gap-3"><UserRoundIcon aria-hidden="true" className="mt-1 size-4 shrink-0 text-muted-foreground" /><dt className="sr-only">Khách hàng</dt><dd className="m-0 min-w-0 break-words leading-6">{order.contact.name}</dd></div>
            <div className="flex min-w-0 items-start gap-3"><CalendarDaysIcon aria-hidden="true" className="mt-1 size-4 shrink-0 text-primary" /><dt className="sr-only">Lịch thực hiện</dt><dd className="m-0 min-w-0 break-words leading-6">{formatAdminTime(order.scheduledAt)}</dd></div>
            <div className="flex min-w-0 items-start gap-3"><MapPinIcon aria-hidden="true" className="mt-1 size-4 shrink-0 text-muted-foreground" /><dt className="sr-only">Địa chỉ</dt><dd className="m-0 min-w-0 break-words leading-6">{order.contact.address}</dd></div>
          </dl>
          {order.cancelRequest?.status === "pending" && <div className="min-w-0"><CancelRequestBadge request={order.cancelRequest} /></div>}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4"><span className="text-xs text-muted-foreground">Chi phí đã lưu</span><span className="break-words text-base font-semibold text-primary tabular-nums">{money(order.price)}</span></div>
          <Button variant="outline" className="min-h-11 w-full justify-between" aria-label={`Xem chi tiết đơn ${order.code}`} render={<Link href={`/don/${order.id}`} />} nativeButton={false}>Xem chi tiết<ArrowRightIcon aria-hidden="true" /></Button>
        </CardContent></Card>)}
      </div>

      <div className="hidden min-w-0 rounded-2xl border border-border bg-white xl:block">
        <table className="w-full table-fixed border-collapse text-left text-sm">
          <caption className="sr-only">Danh sách đơn dịch vụ CleanHome</caption>
          <colgroup><col className="w-[21%]" /><col className="w-[27%]" /><col className="w-[20%]" /><col className="w-[20%]" /><col className="w-[12%]" /></colgroup>
          <thead className="bg-slate-50 text-xs text-muted-foreground"><tr>{["Mã đơn / Dịch vụ", "Khách hàng / Địa chỉ", "Lịch / Chi phí", "Trạng thái", "Thao tác"].map((label) => <th key={label} scope="col" className="px-4 py-4 font-semibold first:rounded-tl-2xl last:rounded-tr-2xl">{label}</th>)}</tr></thead>
          <tbody>{displayed.map((order) => <tr key={order.id} className="border-t border-border transition-colors hover:bg-slate-50/70">
            <td className="px-4 py-5 align-top"><p className="m-0 break-words font-semibold">{order.code}</p><p className="m-0 mt-2 break-words leading-6 text-muted-foreground">{services.get(order.serviceId)?.name || "Dịch vụ không còn trong danh sách"}</p></td>
            <td className="px-4 py-5 align-top"><p className="m-0 break-words leading-6 font-medium">{order.contact.name}</p><p className="m-0 mt-2 break-words text-xs leading-6 text-muted-foreground">{order.contact.address}</p></td>
            <td className="px-4 py-5 align-top"><p className="m-0 break-words leading-6">{formatAdminTime(order.scheduledAt)}</p><p className="m-0 mt-2 break-words font-semibold text-primary tabular-nums">{money(order.price)}</p></td>
            <td className="px-4 py-5 align-top"><div className="flex min-w-0 flex-col items-start gap-3 [&_[data-slot=badge]]:h-auto [&_[data-slot=badge]]:max-w-full [&_[data-slot=badge]]:whitespace-normal"><OrderStatusBadge status={order.status} /><CancelRequestBadge request={order.cancelRequest} /></div></td>
            <td className="px-4 py-3 align-top"><Link href={`/don/${order.id}`} aria-label={`Xem chi tiết đơn ${order.code}`} className="inline-flex min-h-11 items-center gap-1 rounded-lg text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">Chi tiết<ArrowRightIcon className="size-4" aria-hidden="true" /></Link></td>
          </tr>)}</tbody>
        </table>
      </div>

      {pages > 1 && <nav aria-label="Phân trang đơn dịch vụ" className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><p className="m-0 text-sm text-muted-foreground">{currentPage * PAGE_SIZE + 1}–{Math.min((currentPage + 1) * PAGE_SIZE, filtered.length)} / {filtered.length} đơn</p><div className="flex w-full flex-wrap items-center justify-between gap-3 sm:w-auto"><Button variant="outline" className="min-h-11" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Trước</Button><span aria-live="polite" className="text-sm text-muted-foreground">Trang {currentPage + 1} / {pages}</span><Button variant="outline" className="min-h-11" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>Sau</Button></div></nav>}
    </>}
  </div>
}
