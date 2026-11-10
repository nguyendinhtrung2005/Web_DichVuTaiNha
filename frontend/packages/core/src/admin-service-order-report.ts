import { ApiError, apiRequest } from "./api-client"
import type { OrderStatus } from "./types"

export type AdminServiceOrderReport = {
  from: string | null
  to: string | null
  generatedAt: string
  total: number
  statusCounts: Record<OrderStatus, number>
}

const statuses: OrderStatus[] = ["pending", "confirmed", "in_progress", "completed", "cancelled"]

export async function loadAdminServiceOrderReport(from: string, to: string, signal?: AbortSignal): Promise<AdminServiceOrderReport> {
  const query = new URLSearchParams()
  if (from) query.set("from", from)
  if (to) query.set("to", to)
  const search = query.toString()
  const result = await apiRequest<AdminServiceOrderReport>(`/admin/reports/service-orders${search ? `?${search}` : ""}`, { signal })
  if (!result || !Array.isArray(statuses)
    || !statuses.every((status) => Number.isSafeInteger(result.statusCounts?.[status]) && result.statusCounts[status] >= 0)
    || !Number.isSafeInteger(result.total) || result.total < 0
    || statuses.reduce((sum, status) => sum + result.statusCounts[status], 0) !== result.total
    || !Number.isFinite(Date.parse(result.generatedAt))
    || result.from !== (from || null) || result.to !== (to || null)) {
    throw new ApiError("API báo cáo trạng thái đơn trả dữ liệu không hợp lệ.", 502, "INVALID_RESPONSE")
  }
  return result
}

export function adminServiceOrderReportCsvRows(report: AdminServiceOrderReport): (string | number)[][] {
  return [
    ["Khoảng ngày tạo từ", report.from || "Toàn bộ thời gian"],
    ["Khoảng ngày tạo đến", report.to || "Toàn bộ thời gian"],
    ["Thời điểm tổng hợp (UTC)", report.generatedAt],
    ["Tổng đơn dịch vụ", report.total],
    ["Chờ xác nhận", report.statusCounts.pending],
    ["Đã xác nhận", report.statusCounts.confirmed],
    ["Đang thực hiện", report.statusCounts.in_progress],
    ["Hoàn thành", report.statusCounts.completed],
    ["Đã hủy", report.statusCounts.cancelled],
  ]
}
