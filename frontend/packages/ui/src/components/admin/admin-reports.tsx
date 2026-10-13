"use client"

import { useState } from "react"
import { AreaLink as Link } from "@/components/shared/area-routes"
import { ArrowRightIcon, BriefcaseBusinessIcon, ClipboardListIcon, CreditCardIcon, DownloadIcon, RotateCcwIcon, UsersIcon } from "lucide-react"
import { csv, Field, money, useData } from "../../common"
import { Button } from "../ui/button"
import { Card, CardContent } from "../ui/card"
import { Input } from "../ui/input"
import { ORDER_STATUS_LABEL } from "@/lib/config"
import { AdminEmpty, AdminError, AdminLoading, AdminPageHeader } from "./admin-shared"
import { formatAdminDate, getAdminCommerceDataError } from "./admin-display"
import { ADMIN_REPORT_CSV_HEADERS, adminReportCsvRows, computeAdminReport } from "./admin-report-data"

const STATUS_COLOR = { pending: "bg-amber-400", confirmed: "bg-blue-400", in_progress: "bg-sky-500", completed: "bg-emerald-500", cancelled: "bg-slate-400" }

function ReportBars({ items, denominator }: { items: { id: string; label: string; value: number; display?: string; color?: string }[]; denominator?: number }) {
  const maximum = denominator || Math.max(1, ...items.map((item) => item.value))
  return <ul className="m-0 grid min-w-0 list-none gap-5 p-0">{items.map((item) => <li key={item.id} className="min-w-0" data-report-bar={item.id} data-value={item.value}>
    <div className="mb-2 flex min-w-0 flex-wrap items-center justify-between gap-2 text-sm leading-6"><span className="min-w-0 break-words text-muted-foreground">{item.label}</span><strong className="break-words font-semibold text-foreground tabular-nums">{item.display || item.value}</strong></div>
    <div aria-hidden="true" className="h-2 rounded-full bg-slate-100"><div className={`h-full rounded-full ${item.color || "bg-primary"}`} style={{ width: `${item.value / maximum * 100}%` }} /></div>
  </li>)}</ul>
}

export function AdminReports() {
  const { s, user, role } = useData()
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [exportError, setExportError] = useState("")

  if (!s) return <AdminLoading />
  if (!user || role !== "admin" || user.role !== "admin" || user.status !== "active") return <AdminEmpty title="Vui lòng đăng nhập tài khoản quản trị viên" />
  if (getAdminCommerceDataError(s)) return <AdminError />

  const report = computeAdminReport(s, from, to)
  const rangeLabel = from && to ? `${formatAdminDate(`${from}T12:00:00`)} – ${formatAdminDate(`${to}T12:00:00`)}`
    : from ? `Từ ${formatAdminDate(`${from}T12:00:00`)}` : to ? `Đến ${formatAdminDate(`${to}T12:00:00`)}` : "Toàn bộ thời gian"
  const clearDates = () => { setFrom(""); setTo(""); setExportError("") }
  const exportCsv = () => {
    if (report.rangeError) return
    setExportError("")
    try { csv("bao-cao-cleanhome.csv", ADMIN_REPORT_CSV_HEADERS, adminReportCsvRows(report)) }
    catch { setExportError("Chưa thể tải file CSV. Vui lòng thử lại.") }
  }
  const metrics = [
    { key: "orders", label: "Tổng đơn dịch vụ", value: String(report.totalOrders), hint: "Theo ngày tạo trong khoảng đã chọn", icon: ClipboardListIcon, color: "bg-blue-50 text-primary" },
    { key: "revenue", label: "Doanh thu đã thu", value: money(report.revenue), hint: `${report.paidPayments.length} bản ghi đã thanh toán`, icon: CreditCardIcon, color: "bg-emerald-50 text-emerald-700" },
    { key: "customers", label: "Khách hàng", value: String(report.customerCount), hint: "Tổng tài khoản, gồm cả tài khoản đã khóa", icon: UsersIcon, color: "bg-sky-50 text-sky-700" },
    { key: "staff", label: "Nhân viên", value: String(report.staffCount), hint: "Tổng tài khoản, gồm cả tài khoản đã khóa", icon: BriefcaseBusinessIcon, color: "bg-indigo-50 text-indigo-700" },
  ]

  return <div className="min-w-0 space-y-7" data-admin-page="reports">
    <AdminPageHeader title="Thống kê và báo cáo" description="Đối chiếu đơn dịch vụ, doanh thu đã thu và phân công trong khoảng thời gian bạn chọn." action={<Button className="min-h-11 w-full sm:w-auto" disabled={report.rangeError} onClick={exportCsv} data-report-export><DownloadIcon aria-hidden="true" />Xuất CSV</Button>} />
    {exportError && <p role="alert" className="m-0 rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-7 text-red-800">{exportError}</p>}
    <section aria-label="Khoảng thời gian báo cáo" className="min-w-0 rounded-2xl border border-border bg-white p-5 sm:p-6">
      <div className="grid min-w-0 gap-5 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] xl:items-end">
        <Field label="Từ ngày"><Input type="date" name="report-from" value={from} onChange={(event) => { setFrom(event.target.value); setExportError("") }} /></Field>
        <Field label="Đến ngày" error={report.rangeError ? "Ngày kết thúc phải từ ngày bắt đầu trở đi." : undefined}><Input type="date" name="report-to" min={from || undefined} value={to} onChange={(event) => { setTo(event.target.value); setExportError("") }} /></Field>
        <Button variant="outline" className="min-h-11 w-full sm:col-span-2 xl:col-span-1 xl:w-auto" disabled={!from && !to} onClick={clearDates}><RotateCcwIcon aria-hidden="true" />Xóa khoảng ngày</Button>
      </div>
      <p role="status" className="m-0 mt-4 break-words text-sm leading-7 font-medium text-foreground">{rangeLabel}</p>
      <p className="m-0 mt-2 text-xs leading-6 text-muted-foreground">Báo cáo tổng hợp các bản ghi lưu trên trình duyệt đang sử dụng. Đơn theo ngày tạo. Doanh thu theo ngày xác nhận thanh toán, hoặc ngày tạo bản ghi nếu chưa có ngày xác nhận. Số tài khoản và khoản cần xử lý hoàn tiền là tổng hiện có, không lọc theo ngày.</p>
    </section>

    {report.rangeError ? <AdminEmpty title="Khoảng ngày chưa hợp lệ" description="Điều chỉnh ngày bắt đầu hoặc ngày kết thúc trước khi xem hoặc xuất báo cáo." action={<Button variant="outline" onClick={clearDates}>Xóa khoảng ngày</Button>} /> : <>
      <section aria-label="Số liệu báo cáo" className="grid min-w-0 grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {metrics.map(({ key, label, value, hint, icon: Icon, color }) => <article key={key} className="min-w-0" data-report-stat={key}><Card className="h-full min-w-0 rounded-2xl shadow-none ring-border [--card-spacing:--spacing(4)] sm:[--card-spacing:--spacing(5)]"><CardContent><span className={`mb-4 flex size-10 items-center justify-center rounded-xl ${color}`}><Icon aria-hidden="true" className="size-5" /></span><dl className="m-0 min-w-0"><dt className="text-xs leading-6 font-medium text-muted-foreground sm:text-sm">{label}</dt><dd className={`m-0 mt-2 break-words font-semibold tracking-tight tabular-nums ${key === "revenue" ? "text-xl leading-8 sm:text-2xl" : "text-3xl leading-9"}`}>{value}</dd></dl><p className="m-0 mt-3 text-xs leading-5 text-muted-foreground">{hint}</p></CardContent></Card></article>)}
      </section>
      {!report.orders.length && !report.paidPayments.length && <AdminEmpty title="Chưa có đơn hoặc thanh toán trong khoảng đã chọn" description="Thử mở rộng khoảng ngày. Tổng tài khoản và khoản cần xử lý hoàn tiền vẫn được hiển thị theo toàn bộ dữ liệu hiện có." />}

      <div className="grid min-w-0 items-start gap-6 xl:grid-cols-2">
        <section aria-labelledby="report-revenue-heading" data-report-section="monthly-revenue" className="min-w-0 rounded-2xl border border-border bg-white p-5 sm:p-6">
          <h2 id="report-revenue-heading" className="m-0 text-lg font-semibold">Doanh thu theo tháng</h2><p className="m-0 mt-2 text-xs leading-6 text-muted-foreground">Chỉ cộng bản ghi có trạng thái đã thanh toán. Chưa trừ các khoản cần xử lý hoàn tiền.</p>
          <div className="mt-6">{report.monthlyRevenue.length ? <ReportBars items={report.monthlyRevenue.map(({ month, amount }) => ({ id: month, label: `${month.slice(5)}/${month.slice(0, 4)}`, value: amount, display: money(amount) }))} /> : <p className="m-0 rounded-xl bg-slate-50 px-4 py-5 text-sm leading-7 text-muted-foreground">Chưa có bản ghi đã thanh toán trong khoảng ngày này.</p>}</div>
        </section>
        <section aria-labelledby="report-status-heading" data-report-section="order-status" className="min-w-0 rounded-2xl border border-border bg-white p-5 sm:p-6">
          <h2 id="report-status-heading" className="m-0 text-lg font-semibold">Tình trạng đơn dịch vụ</h2><p className="m-0 mt-2 text-xs leading-6 text-muted-foreground">Trạng thái hiện tại của {report.totalOrders} đơn được tạo trong khoảng đã chọn.</p>
          <div className="mt-6"><ReportBars denominator={Math.max(1, report.totalOrders)} items={Object.entries(ORDER_STATUS_LABEL).map(([status, label]) => ({ id: status, label, value: report.statusCounts[status as keyof typeof report.statusCounts], color: STATUS_COLOR[status as keyof typeof STATUS_COLOR] }))} /></div>
        </section>
        <section aria-labelledby="report-service-heading" data-report-section="service-usage" className="min-w-0 rounded-2xl border border-border bg-white p-5 sm:p-6">
          <h2 id="report-service-heading" className="m-0 text-lg font-semibold">Mức sử dụng dịch vụ</h2><p className="m-0 mt-2 text-xs leading-6 text-muted-foreground">Số đơn theo từng dịch vụ trong khoảng ngày tạo, loại trừ đơn đã hủy.</p>
          <div className="mt-6">{report.serviceUsage.length ? <ReportBars items={report.serviceUsage.map((service) => ({ id: service.id, label: service.name, value: service.count }))} /> : <p className="m-0 rounded-xl bg-slate-50 px-4 py-5 text-sm leading-7 text-muted-foreground">Chưa có dịch vụ hoặc đơn dịch vụ để thống kê.</p>}</div>
        </section>
        <section aria-labelledby="report-processing-heading" data-report-section="refund-required" className="min-w-0 rounded-2xl border border-border bg-white p-5 sm:p-6">
          <h2 id="report-processing-heading" className="m-0 text-lg font-semibold">Theo dõi xử lý đơn</h2>
          <dl className="m-0 mt-6 grid min-w-0 gap-6"><div><dt className="text-sm leading-7 text-muted-foreground">Tỷ lệ hủy trong khoảng ngày tạo đơn</dt><dd className="m-0 mt-2 break-words text-3xl font-semibold text-primary tabular-nums" data-report-stat="cancelled-rate">{report.cancelledRate.toFixed(1)}%</dd><p className="m-0 mt-2 text-xs leading-6 text-muted-foreground">{report.statusCounts.cancelled} đơn đã hủy / {report.totalOrders} đơn.</p></div><div className="rounded-xl border border-amber-200 bg-amber-50 p-4"><dt className="text-sm leading-7 font-medium text-amber-900">Khoản cần xử lý hoàn tiền · Toàn bộ dữ liệu</dt><dd className="m-0 mt-2 text-2xl font-semibold text-amber-900 tabular-nums" data-report-stat="refund-required">{report.refundRequiredCount}</dd><p className="m-0 mt-2 text-xs leading-6 text-amber-900">Số bản ghi được đánh dấu cần hoàn tiền, không lọc theo ngày. Đây là khoản cần kiểm tra; chưa phải số tiền đã hoàn.</p></div></dl>
          <Link href="/thanh-toan" className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-lg text-sm font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">Xem thanh toán<ArrowRightIcon aria-hidden="true" className="size-4" /></Link>
        </section>
      </div>

      <section aria-labelledby="report-staff-heading" data-report-section="staff-performance" className="min-w-0">
        <div className="mb-5"><h2 id="report-staff-heading" className="m-0 text-lg font-semibold">Đơn theo nhân viên</h2><p className="m-0 mt-3 max-w-3xl text-sm leading-7 text-muted-foreground">Nhóm các đơn được tạo trong khoảng đã chọn theo nhân viên hiện đang được phân công, gồm cả đơn đã hủy. Các số liệu phản ánh trạng thái công việc hiện tại; không thống kê theo thời điểm giao việc trong quá khứ.</p></div>
        {report.staffPerformance.length ? <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-3">{report.staffPerformance.map((employee) => <article key={employee.id} data-report-staff={employee.id} className="min-w-0 rounded-2xl border border-border bg-white p-5"><h3 className="m-0 break-words text-base leading-7 font-semibold">{employee.name}</h3>{(employee.locked || employee.missing) && <p className="m-0 mt-2 break-words text-xs leading-6 text-muted-foreground">{employee.missing ? `Mã nhân viên: ${employee.id}` : "Tài khoản đã khóa"}</p>}<dl className="m-0 mt-5 grid min-w-0 grid-cols-2 gap-x-3 gap-y-4">{[["Đơn có phân công", employee.assigned], ["Chờ tiếp nhận", employee.waiting], ["Đã tiếp nhận", employee.accepted], ["Đang thực hiện", employee.inProgress], ["Đã hoàn thành", employee.completed], ["Đã hủy", employee.cancelled]].map(([label, value]) => <div key={label} className="min-w-0"><dt className="break-words text-xs leading-6 text-muted-foreground">{label}</dt><dd className="m-0 mt-1 text-xl font-semibold tabular-nums">{value}</dd></div>)}</dl>{employee.unspecified > 0 && <p className="m-0 mt-4 text-xs leading-6 text-muted-foreground">{employee.unspecified} đơn chưa có trạng thái công việc.</p>}</article>)}</div> : <AdminEmpty title="Chưa có nhân viên hoặc đơn đã phân công" description="Số liệu sẽ hiển thị khi có tài khoản nhân viên hoặc phân công được ghi nhận." />}
      </section>
    </>}
  </div>
}
