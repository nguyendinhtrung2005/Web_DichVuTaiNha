"use client"

import { useState } from "react"
import { AreaLink as Link } from "@/components/shared/area-routes"
import { ArrowRightIcon, RotateCcwIcon } from "lucide-react"
import { Field, useData, date } from "../../common"
import { Button } from "../ui/button"
import { Input } from "../ui/input"
import { getAssignedJobs, JOB_FILTER_OPTIONS, jobFilterValue, normalizeSearch, StaffEmpty, StaffError, StaffJobBadge, StaffJobCard, StaffLoading, StaffPageHeader } from "./staff-shared"

const PAGE_SIZE = 8

export function StaffJobs() {
  const { s, user, role } = useData()
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState("")
  const [sort, setSort] = useState("schedule-asc")
  const [page, setPage] = useState(0)

  if (!s) return <StaffLoading />
  if (!user || role !== "staff" || user.role !== "staff") return <StaffEmpty title="Vui lòng đăng nhập tài khoản nhân viên" />
  const jobs = getAssignedJobs(s, user.id)
  if (!jobs) return <StaffError />
  const services = new Map(s.services.map((service) => [service.id, service]))
  const normalizedQuery = normalizeSearch(query)
  const filtered = jobs.filter((order) => (!normalizedQuery || normalizeSearch(`${order.code} ${services.get(order.serviceId)?.name || ""}`).includes(normalizedQuery)) && (!status || jobFilterValue(order) === status)).sort((a, b) => (new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()) * (sort === "schedule-asc" ? 1 : -1))
  const pages = Math.ceil(filtered.length / PAGE_SIZE)
  const currentPage = Math.min(page, Math.max(0, pages - 1))
  const displayed = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)
  const hasFilters = Boolean(query || status || sort !== "schedule-asc")
  const clearFilters = () => { setQuery(""); setStatus(""); setSort("schedule-asc"); setPage(0) }

  return (
    <div className="min-w-0 space-y-6">
      <StaffPageHeader title="Công việc được phân công" description="Tìm lịch hẹn, kiểm tra thông tin và theo dõi tiến độ công việc của bạn." />

      <section aria-label="Tìm và lọc công việc" className="min-w-0 rounded-2xl border border-border bg-white p-5 sm:p-6">
        <div className="grid min-w-0 gap-5 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <Field label="Tìm kiếm công việc"><Input type="search" className="bg-white" placeholder="Mã đơn, tên dịch vụ..." value={query} onChange={(event) => { setQuery(event.target.value); setPage(0) }} /></Field>
          <Field label="Trạng thái"><select value={status} onChange={(event) => { setStatus(event.target.value); setPage(0) }}><option value="">Tất cả trạng thái</option>{JOB_FILTER_OPTIONS.filter((option) => option.value).map(({ value, label }) => <option key={value} value={value}>{label}</option>)}</select></Field>
          <Field label="Sắp xếp lịch thực hiện"><select value={sort} onChange={(event) => { setSort(event.target.value); setPage(0) }}><option value="schedule-asc">Thời gian: tăng dần</option><option value="schedule-desc">Thời gian: giảm dần</option></select></Field>
        </div>
        <div className="mt-5 flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between"><p role="status" aria-live="polite" className="m-0 text-sm leading-6 text-muted-foreground"><span className="font-semibold text-foreground">{filtered.length}</span> công việc{hasFilters ? ` phù hợp / ${jobs.length} công việc của bạn` : " được phân công"}</p><Button variant="outline" className="min-h-11 w-full sm:w-auto" disabled={!hasFilters} onClick={clearFilters}><RotateCcwIcon aria-hidden="true" />Xóa bộ lọc</Button></div>
      </section>

      {filtered.length === 0 ? <StaffEmpty title={jobs.length ? "Không tìm thấy công việc phù hợp" : "Bạn chưa có công việc được phân công"} description={jobs.length ? "Thử tìm từ khóa khác hoặc thay đổi bộ lọc trạng thái." : "Danh sách sẽ hiển thị khi có công việc được phân công cho bạn."} action={hasFilters ? <Button variant="outline" className="min-h-11" onClick={clearFilters}>Xóa bộ lọc</Button> : undefined} /> : <>
        <div className="grid min-w-0 gap-4 xl:hidden">{displayed.map((order) => <StaffJobCard key={order.id} order={order} service={services.get(order.serviceId)} />)}</div>

        <div className="hidden min-w-0 rounded-2xl border border-border bg-white xl:block">
          <table className="w-full table-fixed border-collapse text-left text-sm">
            <caption className="sr-only">Danh sách công việc được phân công cho bạn</caption>
            <colgroup><col className="w-[22%]" /><col className="w-[28%]" /><col className="w-[20%]" /><col className="w-[17%]" /><col className="w-[13%]" /></colgroup>
            <thead className="bg-slate-50 text-xs text-muted-foreground"><tr>{["Mã đơn / Dịch vụ", "Khách hàng / Địa chỉ", "Lịch thực hiện", "Trạng thái", "Thao tác"].map((label) => <th key={label} scope="col" className="px-4 py-4 font-semibold first:rounded-tl-2xl last:rounded-tr-2xl">{label}</th>)}</tr></thead>
            <tbody>{displayed.map((order) => <tr key={order.id} className="border-t border-border transition-colors hover:bg-slate-50/70">
              <td className="px-4 py-5 align-top"><p className="m-0 break-words font-semibold">{order.code}</p><p className="m-0 mt-2 break-words leading-6 text-muted-foreground">{services.get(order.serviceId)?.name || "Dịch vụ không còn trong danh sách"}</p></td>
              <td className="px-4 py-5 align-top"><p className="m-0 break-words leading-6 font-medium">{order.contact.name}</p><p className="m-0 mt-2 break-words text-xs leading-6 text-muted-foreground">{order.contact.address}</p></td>
              <td className="px-4 py-5 align-top"><p className="m-0 break-words leading-6">{date(order.scheduledAt)}</p><p className="m-0 mt-2 text-xs text-muted-foreground">{order.durationMinutes} phút</p></td>
              <td className="px-4 py-5 align-top"><StaffJobBadge order={order} /></td>
              <td className="px-4 py-3 align-top"><Link href={`/don/${order.id}`} aria-label={`Xem chi tiết công việc ${order.code}`} className="inline-flex min-h-11 items-center gap-1 rounded-lg text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">Chi tiết<ArrowRightIcon className="size-4" aria-hidden="true" /></Link></td>
            </tr>)}</tbody>
          </table>
        </div>

        {pages > 1 && <nav aria-label="Phân trang công việc" className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><p className="m-0 text-sm text-muted-foreground">{currentPage * PAGE_SIZE + 1}–{Math.min((currentPage + 1) * PAGE_SIZE, filtered.length)} / {filtered.length} công việc</p><div className="flex w-full flex-wrap items-center justify-between gap-3 sm:w-auto"><Button variant="outline" className="min-h-11" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Trước</Button><span aria-live="polite" className="text-sm text-muted-foreground">Trang {currentPage + 1} / {pages}</span><Button variant="outline" className="min-h-11" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>Sau</Button></div></nav>}
      </>}
    </div>
  )
}
