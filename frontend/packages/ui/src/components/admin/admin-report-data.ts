import { ORDER_STATUS_LABEL } from "@/lib/config"
import { toDateInputValue } from "@/lib/format"
import type { AppState, Order, OrderStatus, Payment } from "@/lib/types"
import { adminJobStatus } from "./admin-scheduling"

export interface AdminReportServiceUsage {
  id: string
  name: string
  count: number
  missing: boolean
}

export interface AdminReportStaffPerformance {
  id: string
  name: string
  locked: boolean
  missing: boolean
  assigned: number
  waiting: number
  accepted: number
  inProgress: number
  completed: number
  cancelled: number
  unspecified: number
}

export interface AdminReportData {
  from: string
  to: string
  rangeError: boolean
  orders: Order[]
  paidPayments: Payment[]
  totalOrders: number
  revenue: number
  customerCount: number
  staffCount: number
  statusCounts: Record<OrderStatus, number>
  cancelledRate: number
  monthlyRevenue: { month: string; amount: number }[]
  serviceUsage: AdminReportServiceUsage[]
  staffPerformance: AdminReportStaffPerformance[]
  refundRequiredCount: number
}

function localDay(value: string) {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? toDateInputValue(date) : ""
}

function staffRow(id: string, name: string, locked = false, missing = false): AdminReportStaffPerformance {
  return { id, name, locked, missing, assigned: 0, waiting: 0, accepted: 0, inProgress: 0, completed: 0, cancelled: 0, unspecified: 0 }
}

// The date and revenue definitions match AdminDashboard. This function only
// derives a report; it never updates records or estimates financial outcomes.
export function computeAdminReport(state: AppState, from = "", to = ""): AdminReportData {
  const rangeError = Boolean(from && to && from > to)
  const inRange = (value: string) => {
    const key = localDay(value)
    return !rangeError && (!from || key >= from) && (!to || key <= to)
  }
  const orders = state.orders.filter((order) => inRange(order.createdAt))
  const paidPayments = state.payments.filter((payment) => payment.status === "paid" && inRange(payment.confirmedAt || payment.createdAt))
  const revenue = paidPayments.reduce((sum, payment) => sum + payment.amount, 0)
  const statusCounts: Record<OrderStatus, number> = { pending: 0, confirmed: 0, in_progress: 0, completed: 0, cancelled: 0 }
  orders.forEach((order) => { statusCounts[order.status] += 1 })

  const monthly = new Map<string, number>()
  paidPayments.forEach((payment) => {
    const month = localDay(payment.confirmedAt || payment.createdAt).slice(0, 7)
    monthly.set(month, (monthly.get(month) || 0) + payment.amount)
  })

  const usage = new Map<string, AdminReportServiceUsage>(state.services.map((service) => [service.id, { id: service.id, name: service.name, count: 0, missing: false }]))
  orders.forEach((order) => {
    if (order.status === "cancelled") return
    if (!usage.has(order.serviceId)) usage.set(order.serviceId, { id: order.serviceId, name: `Dịch vụ không còn trong danh sách (${order.serviceId})`, count: 0, missing: true })
    usage.get(order.serviceId)!.count += 1
  })

  const employees = new Map<string, AdminReportStaffPerformance>(state.users.filter((user) => user.role === "staff").map((user) => [user.id, staffRow(user.id, user.name, user.status === "locked")]))
  orders.forEach((order) => {
    if (!order.staffId) return
    if (!employees.has(order.staffId)) employees.set(order.staffId, staffRow(order.staffId, "Nhân viên không còn trong danh sách", false, true))
    const employee = employees.get(order.staffId)!
    employee.assigned += 1
    switch (adminJobStatus(order)) {
      case "waiting": employee.waiting += 1; break
      case "accepted": employee.accepted += 1; break
      case "in_progress": employee.inProgress += 1; break
      case "done": employee.completed += 1; break
      case "cancelled": employee.cancelled += 1; break
      default: employee.unspecified += 1
    }
  })

  return {
    from, to, rangeError, orders, paidPayments,
    totalOrders: orders.length,
    revenue,
    customerCount: state.users.filter((user) => user.role === "customer").length,
    staffCount: state.users.filter((user) => user.role === "staff").length,
    statusCounts,
    cancelledRate: orders.length ? statusCounts.cancelled / orders.length * 100 : 0,
    monthlyRevenue: [...monthly.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, amount]) => ({ month, amount })),
    serviceUsage: [...usage.values()],
    staffPerformance: [...employees.values()].sort((a, b) => a.name.localeCompare(b.name, "vi")),
    refundRequiredCount: state.payments.filter((payment) => payment.refundRequired).length,
  }
}

export const ADMIN_REPORT_CSV_HEADERS = ["Chỉ tiêu", "Giá trị"]
const currency = (value: number) => new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(value)

// Keep the original report columns, metric labels and service rows first.
// The existing common.csv function applies BOM, quoting and formula protection.
export function adminReportCsvRows(report: AdminReportData): (string | number)[][] {
  return [
    ["Tổng đơn dịch vụ", report.totalOrders],
    ["Doanh thu đã thu", currency(report.revenue)],
    ["Khách hàng", report.customerCount],
    ["Nhân viên", report.staffCount],
    ["Chờ xác nhận", report.statusCounts.pending],
    ["Đang thực hiện", report.statusCounts.in_progress],
    ["Tỷ lệ hủy (%)", report.totalOrders ? report.cancelledRate.toFixed(1) : 0],
    ...report.serviceUsage.map((service) => [service.name, service.count] as [string, number]),
    ...(["confirmed", "completed", "cancelled"] as const).map((status) => [ORDER_STATUS_LABEL[status], report.statusCounts[status]] as [string, number]),
    ["Bản ghi đã thanh toán trong khoảng", report.paidPayments.length],
    ["Khoản cần xử lý hoàn tiền (toàn bộ dữ liệu)", report.refundRequiredCount],
    ...report.monthlyRevenue.map(({ month, amount }) => [`Doanh thu tháng ${month.slice(5)}/${month.slice(0, 4)}`, currency(amount)] as [string, string]),
    ...report.staffPerformance.flatMap((employee) => [
      [`Nhân viên ${employee.name} (${employee.id}) · Đơn có phân công`, employee.assigned],
      [`Nhân viên ${employee.name} (${employee.id}) · Chờ tiếp nhận`, employee.waiting],
      [`Nhân viên ${employee.name} (${employee.id}) · Đã tiếp nhận`, employee.accepted],
      [`Nhân viên ${employee.name} (${employee.id}) · Đang thực hiện`, employee.inProgress],
      [`Nhân viên ${employee.name} (${employee.id}) · Đã hoàn thành`, employee.completed],
      [`Nhân viên ${employee.name} (${employee.id}) · Đã hủy`, employee.cancelled],
      [`Nhân viên ${employee.name} (${employee.id}) · Chưa có trạng thái công việc`, employee.unspecified],
    ] as (string | number)[][]),
  ]
}
