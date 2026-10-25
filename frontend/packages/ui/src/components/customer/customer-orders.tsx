"use client"

import { useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { ArrowRightIcon, CalendarDaysIcon, ClipboardListIcon, MapPinIcon, PlusIcon, SearchIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { ORDER_STATUS_LABEL, PAYMENT_METHOD_LABEL } from "@/lib/config"
import type { OrderStatus, PaymentStatus } from "@/lib/types"
import { date, day, Field, money, useData } from "../../common"

const PAGE_SIZE = 8
const STATUS_STYLE: Record<OrderStatus, string> = {
  pending: "border-amber-200 bg-amber-50 text-amber-800",
  confirmed: "border-blue-200 bg-blue-50 text-blue-700",
  in_progress: "border-indigo-200 bg-indigo-50 text-indigo-700",
  completed: "border-emerald-200 bg-emerald-50 text-emerald-800",
  cancelled: "border-slate-200 bg-slate-100 text-slate-600",
}
const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  unpaid: "Chưa ghi nhận đã nhận tiền",
  pending: "Chờ CleanHome xác nhận đã nhận tiền",
  paid: "Đã xác nhận đã nhận tiền",
}

export function CustomerOrderStatus({ status }: { status: OrderStatus }) {
  return <Badge variant="outline" className={`max-w-full px-2.5 py-1.5 whitespace-normal ${STATUS_STYLE[status]}`}>{ORDER_STATUS_LABEL[status]}</Badge>
}

export function CustomerOrderError() {
  return <section role="alert" className="mx-auto max-w-6xl px-4 py-16 sm:px-6"><div className="rounded-2xl border border-border bg-slate-50 p-6 text-center"><h1 className="m-0 text-2xl font-semibold">Chưa thể tải thông tin đơn</h1><p className="mt-4 mb-6 text-sm leading-7 text-muted-foreground">Vui lòng tải lại trang để thử lại.</p><Button onClick={() => window.location.reload()}>Tải lại trang</Button></div></section>
}

function normalizeSearch(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").toLowerCase().trim()
}

export function CustomerOrders({ history = false }: { history?: boolean } = {}) {
  const { s, user, role } = useData()
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState("")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const defaultSort = history ? "schedule-desc" : "newest"
  const [sort, setSort] = useState(defaultSort)
  const [page, setPage] = useState(0)

  if (!s) return <div className="mx-auto max-w-6xl space-y-6 px-4 py-12 sm:px-6" aria-busy="true" aria-label="Đang tải đơn dịch vụ"><Skeleton className="h-12 w-56" /><Skeleton className="h-36 w-full rounded-2xl" /><Skeleton className="h-80 w-full rounded-2xl" /></div>
  if (!user || role !== "customer") return <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6"><p>Vui lòng đăng nhập để xem đơn dịch vụ của bạn.</p><Button render={<Link href="/dang-nhap" />} nativeButton={false}>Đăng nhập</Button></div>
  if (!Array.isArray(s.orders) || !Array.isArray(s.services) || !Array.isArray(s.payments)) return <CustomerOrderError />

  const ownOrders = s.orders.filter((order) => order?.customerId === user.id && (!history || order.status === "completed"))
  if (s.services.some((service) => !service || typeof service.id !== "string" || typeof service.name !== "string")
    || ownOrders.some((order) => !order.contact || typeof order.contact.name !== "string" || typeof order.scheduledAt !== "string" || typeof order.createdAt !== "string")) return <CustomerOrderError />
  const services = new Map(s.services.map((service) => [service.id, service]))
  const payments = new Map(s.payments.map((payment) => [payment.orderId, payment]))
  const normalizedQuery = normalizeSearch(query)
  const rangeError = Boolean(from && to && from > to)
  const filteredOrders = ownOrders
    .filter((order) => {
      const searchText = normalizeSearch(`${order.code} ${services.get(order.serviceId)?.name || ""} ${order.contact.name}`)
      const scheduledDay = day(new Date(order.scheduledAt))
      return !rangeError && (!normalizedQuery || searchText.includes(normalizedQuery)) && (!status || order.status === status)
        && (!from || scheduledDay >= from) && (!to || scheduledDay <= to)
    })
    .sort((a, b) => {
      if (sort === "oldest") return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      if (sort === "schedule-asc") return new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()
      if (sort === "schedule-desc") return new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime()
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    })
  const pages = Math.ceil(filteredOrders.length / PAGE_SIZE)
  const currentPage = Math.min(page, Math.max(0, pages - 1))
  const displayedOrders = filteredOrders.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)
  const hasFilters = Boolean(query || status || from || to || sort !== defaultSort)
  const clearFilters = () => { setQuery(""); setStatus(""); setFrom(""); setTo(""); setSort(defaultSort); setPage(0) }

  return (
    <div className="mx-auto max-w-6xl px-4 pt-10 pb-16 sm:px-6 md:pt-12 md:pb-24">
      <header className="mb-8 flex flex-col items-start gap-6 sm:flex-row sm:items-center sm:justify-between md:mb-10">
        <div className="min-w-0">
          <p className="m-0 mb-3 text-xs font-semibold tracking-[0.12em] text-primary uppercase">CleanHome / {history ? "Lịch sử dịch vụ" : "Đơn dịch vụ"}</p>
          <h1 className="m-0 text-3xl leading-tight font-bold tracking-tight md:text-4xl">{history ? "Lịch sử dịch vụ" : "Đơn của tôi"}</h1>
          <p className="m-0 mt-4 text-base leading-7 text-muted-foreground">{history ? "Xem lại những dịch vụ đã hoàn thành và đặt lại khi bạn cần." : "Xem lịch hẹn, thông tin dịch vụ và trạng thái từng đơn."}</p>
        </div>
        <Button size="lg" className="w-full px-5 sm:w-auto" render={<Link href="/dat-dich-vu" />} nativeButton={false}>
          <PlusIcon data-icon="inline-start" aria-hidden="true" />
          Đặt dịch vụ
        </Button>
      </header>

      {ownOrders.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-border bg-slate-50 px-6 py-14 text-center" aria-labelledby="no-orders-heading">
          <span className="mx-auto mb-5 flex size-14 items-center justify-center rounded-2xl bg-blue-50 text-primary"><ClipboardListIcon aria-hidden="true" className="size-7" /></span>
          <h2 id="no-orders-heading" className="m-0 text-xl font-semibold">{history ? "Bạn chưa có dịch vụ đã hoàn thành" : "Bạn chưa có đơn dịch vụ nào"}</h2>
          <p className="mx-auto mt-3 mb-6 max-w-md text-sm leading-7 text-muted-foreground">Khám phá các dịch vụ CleanHome và chọn lịch phù hợp cho ngôi nhà của bạn.</p>
          <Button size="lg" className="w-full px-5 sm:w-auto" render={<Link href="/dich-vu" />} nativeButton={false}>Khám phá dịch vụ<ArrowRightIcon data-icon="inline-end" aria-hidden="true" /></Button>
        </section>
      ) : (
        <>
          <section aria-label={history ? "Tìm và lọc lịch sử dịch vụ" : "Tìm và lọc đơn dịch vụ"} className="mb-8 rounded-2xl border border-border bg-slate-50/70 p-5 sm:p-6">
            <div className={`grid min-w-0 gap-5 sm:grid-cols-2 ${history ? "lg:grid-cols-3" : "lg:grid-cols-4"}`}>
              <Field label={history ? "Tìm kiếm lịch sử" : "Tìm kiếm đơn"} hint="Tìm theo mã đơn hoặc tên dịch vụ.">
                <Input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0) }} placeholder="Mã đơn, tên dịch vụ..." className="bg-white" />
              </Field>
              {!history && <Field label="Trạng thái">
                <select value={status} onChange={(event) => { setStatus(event.target.value); setPage(0) }}>
                  <option value="">Tất cả trạng thái</option>
                  {Object.entries(ORDER_STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </Field>}
              <Field label="Lịch thực hiện từ ngày">
                <Input type="date" value={from} onChange={(event) => { setFrom(event.target.value); setPage(0) }} className="bg-white" />
              </Field>
              <Field label="Đến ngày" error={rangeError ? "Ngày kết thúc phải từ ngày bắt đầu trở đi." : undefined}>
                <Input type="date" value={to} min={from || undefined} onChange={(event) => { setTo(event.target.value); setPage(0) }} className="bg-white" />
              </Field>
            </div>
            <div className="mt-5 flex flex-col items-start gap-4 border-t border-border pt-5 sm:flex-row sm:items-end sm:justify-between">
              <div className="w-full min-w-0 sm:max-w-64">
                <Field label="Sắp xếp">
                  <select value={sort} onChange={(event) => { setSort(event.target.value); setPage(0) }}>
                    <option value="newest">Ngày đặt: mới nhất</option>
                    <option value="oldest">Ngày đặt: cũ nhất</option>
                    <option value="schedule-asc">Lịch thực hiện: tăng dần</option>
                    <option value="schedule-desc">Lịch thực hiện: giảm dần</option>
                  </select>
                </Field>
              </div>
              <Button type="button" variant="outline" className="w-full sm:w-auto" disabled={!hasFilters} onClick={clearFilters}>Xóa bộ lọc</Button>
            </div>
          </section>

          <p role="status" aria-live="polite" className="m-0 mb-5 text-sm text-muted-foreground"><span className="font-semibold text-foreground">{filteredOrders.length}</span> đơn phù hợp{hasFilters ? ` / ${ownOrders.length} đơn của bạn` : ""}</p>

          {filteredOrders.length === 0 ? (
            <section aria-labelledby="no-matching-orders-heading" className="rounded-2xl border border-dashed border-border px-6 py-12 text-center">
              <span className="mx-auto mb-5 flex size-12 items-center justify-center rounded-full bg-slate-100 text-muted-foreground"><SearchIcon aria-hidden="true" className="size-6" /></span>
              <h2 id="no-matching-orders-heading" className="m-0 text-xl font-semibold">{history ? "Không tìm thấy lịch sử phù hợp" : "Không tìm thấy đơn phù hợp"}</h2>
              <p className="mt-3 mb-6 text-sm leading-7 text-muted-foreground">{history ? "Thử tìm từ khóa khác hoặc điều chỉnh khoảng ngày." : "Thử tìm từ khóa khác hoặc điều chỉnh khoảng ngày và trạng thái."}</p>
              <Button variant="outline" className="w-full sm:w-auto" onClick={clearFilters}>Xóa bộ lọc</Button>
            </section>
          ) : (
            <>
              <div className="grid min-w-0 gap-4 lg:hidden">
                {displayedOrders.map((order) => {
                  const service = services.get(order.serviceId)
                  const payment = payments.get(order.id)
                  return (
                    <Card key={order.id} className="min-w-0 overflow-visible rounded-2xl shadow-none ring-border [--card-spacing:--spacing(5)]">
                      <CardContent className="space-y-5">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <span className="break-words text-sm font-semibold text-muted-foreground">{order.code}</span>
                          <CustomerOrderStatus status={order.status} />
                        </div>
                        <div className="flex min-w-0 items-center gap-4">
                          {service?.image && <Image src={service.image} alt={service.name} width={72} height={72} sizes="72px" className="size-18 shrink-0 rounded-xl object-cover" />}
                          <div className="min-w-0">
                            <h2 className="m-0 break-words text-base leading-6 font-semibold">{service?.name || "Dịch vụ không còn trong danh sách"}</h2>
                            <p className="m-0 mt-2 text-sm text-muted-foreground">{order.quantity} {service?.unit || "đơn vị"}</p>
                          </div>
                        </div>
                        <dl className="m-0 grid gap-4 border-t border-border pt-5 text-sm">
                          <div className="flex min-w-0 items-start gap-3"><CalendarDaysIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" /><div className="min-w-0"><dt className="text-xs text-muted-foreground">{order.status === "pending" ? "Thời gian đề xuất" : "Lịch thực hiện"}</dt><dd className="m-0 mt-1 break-words leading-6 font-medium">{date(order.scheduledAt)}</dd></div></div>
                          <div className="flex min-w-0 items-start gap-3"><MapPinIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" /><div className="min-w-0"><dt className="text-xs text-muted-foreground">Địa chỉ</dt><dd className="m-0 mt-1 break-words leading-6">{order.contact.address}</dd></div></div>
                        </dl>
                        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4"><span className="text-sm text-muted-foreground">{history ? "Chi phí đã lưu" : "Tổng dự kiến"}</span><span className="text-lg font-semibold text-primary tabular-nums">{money(order.price)}</span></div>
                        <div className="flex flex-wrap items-start justify-between gap-2 text-sm"><span className="text-muted-foreground">Thanh toán</span><span className="text-right font-medium">{PAYMENT_STATUS_LABEL[payment?.status || "unpaid"]}{payment ? ` · ${PAYMENT_METHOD_LABEL[payment.method]}` : ""}</span></div>
                        <Button variant="outline" className="w-full justify-between" aria-label={`Xem chi tiết đơn ${order.code}`} render={<Link href={`/don/${order.id}`} />} nativeButton={false}>Xem chi tiết<ArrowRightIcon data-icon="inline-end" aria-hidden="true" /></Button>
                        {history && (service?.status === "active" ? <Button className="w-full justify-between" aria-label={`Đặt lại dịch vụ đơn ${order.code}`} render={<Link href={`/dat-dich-vu/${order.id}`} />} nativeButton={false}>Đặt lại dịch vụ<ArrowRightIcon data-icon="inline-end" aria-hidden="true" /></Button> : <Button className="w-full" disabled>Dịch vụ tạm ngừng</Button>)}
                      </CardContent>
                    </Card>
                  )
                })}
              </div>

              <div className="hidden rounded-2xl border border-border lg:block">
                <table className="w-full table-fixed border-collapse text-left text-sm">
                  <caption className="sr-only">{history ? "Các dịch vụ đã hoàn thành của bạn" : "Danh sách đơn dịch vụ của bạn"}</caption>
                  <colgroup><col className="w-[30%]" /><col className="w-[25%]" /><col className="w-[17%]" /><col className="w-[16%]" /><col className="w-[12%]" /></colgroup>
                  <thead className="bg-slate-50 text-xs text-muted-foreground"><tr>{["Đơn / dịch vụ", "Lịch / địa chỉ", "Trạng thái", history ? "Chi phí đã lưu" : "Tổng dự kiến", "Chi tiết"].map((label) => <th key={label} scope="col" className="px-4 py-4 font-semibold first:rounded-tl-2xl last:rounded-tr-2xl">{label}</th>)}</tr></thead>
                  <tbody>
                    {displayedOrders.map((order) => {
                      const payment = payments.get(order.id)
                      return <tr key={order.id} className="border-t border-border transition-colors hover:bg-slate-50/60">
                      <td className="px-4 py-5 align-top"><p className="m-0 font-semibold">{order.code}</p><p className="m-0 mt-2 break-words leading-6 text-muted-foreground">{services.get(order.serviceId)?.name || "Dịch vụ không còn trong danh sách"}</p></td>
                      <td className="px-4 py-5 align-top"><p className="m-0 leading-6">{date(order.scheduledAt)}</p><p className="m-0 mt-2 break-words text-xs leading-6 text-muted-foreground">{order.contact.address}</p></td>
                      <td className="px-4 py-5 align-top"><CustomerOrderStatus status={order.status} /></td>
                      <td className="px-4 py-5 align-top"><p className="m-0 break-words leading-6 font-semibold text-primary tabular-nums">{money(order.price)}</p><p className="m-0 mt-2 text-xs leading-5 text-muted-foreground">{PAYMENT_STATUS_LABEL[payment?.status || "unpaid"]}</p>{payment && <p className="m-0 mt-1 text-xs leading-5 text-muted-foreground">{PAYMENT_METHOD_LABEL[payment.method]}</p>}</td>
                      <td className="px-4 py-3 align-top"><div className="flex flex-col items-start gap-2"><Link href={`/don/${order.id}`} aria-label={`Xem chi tiết đơn ${order.code}`} className="inline-flex min-h-11 items-center rounded-lg text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">Chi tiết</Link>{history && (services.get(order.serviceId)?.status === "active" ? <Link href={`/dat-dich-vu/${order.id}`} aria-label={`Đặt lại dịch vụ đơn ${order.code}`} className="inline-flex min-h-11 items-center rounded-lg text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">Đặt lại</Link> : <span className="text-xs leading-5 text-muted-foreground">Tạm ngừng</span>)}</div></td>
                      </tr>
                    })}
                  </tbody>
                </table>
              </div>

              {pages > 1 && <nav aria-label="Phân trang đơn dịch vụ" className="mt-6 flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="m-0 text-sm text-muted-foreground">{currentPage * PAGE_SIZE + 1}–{Math.min((currentPage + 1) * PAGE_SIZE, filteredOrders.length)} / {filteredOrders.length} đơn</p>
                <div className="flex w-full flex-wrap items-center justify-between gap-3 sm:w-auto"><Button variant="outline" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Trước</Button><span aria-live="polite" className="text-sm text-muted-foreground">Trang {currentPage + 1} / {pages}</span><Button variant="outline" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>Sau</Button></div>
              </nav>}
            </>
          )}
        </>
      )}
    </div>
  )
}
