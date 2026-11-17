"use client"

import { useEffect, useState } from "react"
import { AreaLink as Link } from "@/components/shared/area-routes"
import { ArrowRightIcon, RotateCcwIcon } from "lucide-react"
import { Field, date, useData } from "../../common"
import { ApiError } from "@/lib/api-client"
import { loadStaffJobs, type StaffJobPage } from "@/lib/staff-jobs"
import { Button } from "../ui/button"
import { Input } from "../ui/input"
import { StaffApiJobBadge, StaffApiJobCard, JOB_FILTER_OPTIONS, StaffEmpty, StaffError, StaffLoading, StaffPageHeader } from "./staff-shared"

const PAGE_SIZE = 8

export function StaffJobs() {
  const { user, role } = useData()
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState("")
  const [sort, setSort] = useState<"schedule-asc" | "schedule-desc">("schedule-asc")
  const [page, setPage] = useState(0)
  const [result, setResult] = useState<StaffJobPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!user || role !== "staff" || user.role !== "staff") {
      setLoading(false)
      setResult(null)
      return
    }
    const controller = new AbortController()
    setLoading(true)
    setError("")
    void loadStaffJobs({ page: page + 1, pageSize: PAGE_SIZE, q: query.trim(), status, sort }, controller.signal)
      .then(setResult)
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof ApiError ? reason.message : "Chưa thể tải công việc.")
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [page, query, sort, status, user, role])

  if (!user || role !== "staff" || user.role !== "staff") return <StaffEmpty title="Vui lòng đăng nhập tài khoản nhân viên" />
  if (loading && !result) return <StaffLoading />
  if (error) return <StaffError description={error} />
  if (!result) return <StaffError />

  const pages = Math.ceil(result.total / PAGE_SIZE)
  const currentPage = Math.min(page, Math.max(0, pages - 1))
  const hasFilters = Boolean(query || status || sort !== "schedule-asc")
  const clearFilters = () => { setQuery(""); setStatus(""); setSort("schedule-asc"); setPage(0) }

  return (
    <div className="min-w-0 space-y-6">
      <StaffPageHeader title="Công việc được phân công" description="Danh sách và trạng thái lấy từ hệ thống đơn dịch vụ." />

      <section aria-label="Tìm và lọc công việc" className="min-w-0 rounded-2xl border border-border bg-white p-5 sm:p-6">
        <div className="grid min-w-0 gap-5 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <Field label="Tìm kiếm công việc"><Input type="search" className="bg-white" placeholder="Mã đơn, tên dịch vụ..." value={query} onChange={(event) => { setQuery(event.target.value); setPage(0) }} /></Field>
          <Field label="Trạng thái"><select value={status} onChange={(event) => { setStatus(event.target.value); setPage(0) }}><option value="">Tất cả trạng thái</option>{JOB_FILTER_OPTIONS.filter((option) => option.value).map(({ value, label }) => <option key={value} value={value}>{label}</option>)}</select></Field>
          <Field label="Sắp xếp lịch thực hiện"><select value={sort} onChange={(event) => { setSort(event.target.value as typeof sort); setPage(0) }}><option value="schedule-asc">Thời gian: tăng dần</option><option value="schedule-desc">Thời gian: giảm dần</option></select></Field>
        </div>
        <div className="mt-5 flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between"><p role="status" aria-live="polite" className="m-0 text-sm leading-6 text-muted-foreground"><span className="font-semibold text-foreground">{result.total}</span> công việc{hasFilters ? " phù hợp" : " được phân công"}</p><Button variant="outline" className="min-h-11 w-full sm:w-auto" disabled={!hasFilters} onClick={clearFilters}><RotateCcwIcon aria-hidden="true" />Xóa bộ lọc</Button></div>
      </section>

      {result.items.length === 0 ? <StaffEmpty title={hasFilters ? "Không tìm thấy công việc phù hợp" : "Bạn chưa có công việc được phân công"} description={hasFilters ? "Thử từ khóa khác hoặc thay đổi bộ lọc." : "Danh sách sẽ hiển thị khi có công việc được phân công cho bạn."} action={hasFilters ? <Button variant="outline" className="min-h-11" onClick={clearFilters}>Xóa bộ lọc</Button> : undefined} /> : <>
        <div className="grid min-w-0 gap-4 xl:hidden">{result.items.map((job) => <StaffApiJobCard key={job.id} job={job} />)}</div>

        <div className="hidden min-w-0 rounded-2xl border border-border bg-white xl:block">
          <table className="w-full table-fixed border-collapse text-left text-sm">
            <caption className="sr-only">Danh sách công việc được phân công cho bạn</caption>
            <colgroup><col className="w-[22%]" /><col className="w-[28%]" /><col className="w-[20%]" /><col className="w-[17%]" /><col className="w-[13%]" /></colgroup>
            <thead className="bg-slate-50 text-xs text-muted-foreground"><tr>{["Mã đơn / Dịch vụ", "Khách hàng / Địa chỉ", "Lịch thực hiện", "Trạng thái", "Thao tác"].map((label) => <th key={label} scope="col" className="px-4 py-4 font-semibold first:rounded-tl-2xl last:rounded-tr-2xl">{label}</th>)}</tr></thead>
            <tbody>{result.items.map((job) => <tr key={job.id} className="border-t border-border transition-colors hover:bg-slate-50/70">
              <td className="px-4 py-5 align-top"><p className="m-0 break-words font-semibold">{job.code}</p><p className="m-0 mt-2 break-words leading-6 text-muted-foreground">{job.serviceName}</p></td>
              <td className="px-4 py-5 align-top"><p className="m-0 break-words leading-6 font-medium">{job.contact.name}</p><p className="m-0 mt-2 break-words text-xs leading-6 text-muted-foreground">{job.contact.address}</p></td>
              <td className="px-4 py-5 align-top"><p className="m-0 break-words leading-6">{date(job.scheduledAt)}</p><p className="m-0 mt-2 text-xs text-muted-foreground">{job.durationMinutes} phút</p></td>
              <td className="px-4 py-5 align-top"><StaffApiJobBadge job={job} /></td>
              <td className="px-4 py-3 align-top"><Link href={`/don/${job.id}`} aria-label={`Xem chi tiết công việc ${job.code}`} className="inline-flex min-h-11 items-center gap-1 rounded-lg text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">Chi tiết<ArrowRightIcon className="size-4" aria-hidden="true" /></Link></td>
            </tr>)}</tbody>
          </table>
        </div>

        {pages > 1 && <nav aria-label="Phân trang công việc" className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><p className="m-0 text-sm text-muted-foreground">{currentPage * PAGE_SIZE + 1}–{Math.min((currentPage + 1) * PAGE_SIZE, result.total)} / {result.total} công việc</p><div className="flex w-full flex-wrap items-center justify-between gap-3 sm:w-auto"><Button variant="outline" className="min-h-11" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Trước</Button><span aria-live="polite" className="text-sm text-muted-foreground">Trang {currentPage + 1} / {pages}</span><Button variant="outline" className="min-h-11" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>Sau</Button></div></nav>}
      </>}
    </div>
  )
}
