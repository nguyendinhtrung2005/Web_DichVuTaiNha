import type { StaffPerformance } from "./staff-performance-model"

export function StaffPerformanceBreakdown({ summary }: { summary: StaffPerformance }) {
  const rows = [["WAITING", "Chờ tiếp nhận", summary.waiting], ["ACCEPTED", "Đã tiếp nhận", summary.accepted], ["IN_PROGRESS", "Đang thực hiện", summary.inProgress], ["DONE", "Đã hoàn thành", summary.done], ["CANCELLED", "Đã hủy", summary.cancelled]] as const
  const percent = (count: number) => summary.total ? new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 }).format(count / summary.total * 100) + "%" : "Chưa đủ dữ liệu"
  return <section className="staff-performance-breakdown" aria-label="Phân bố trạng thái phân công">
    <h3>Phân bố trạng thái hiện tại</h3>
    <p>Theo ngày bắt đầu lịch hẹn. Hoàn thành công việc không đồng nghĩa đã được thanh toán.</p>
    {rows.map(([status, label, count]) => <div key={status} data-performance-status={status}>
      <span>{label}</span><meter min={0} max={Math.max(1, summary.total)} value={count} aria-label={label + ": " + count + " trong " + summary.total + " phân công"} /><strong>{count}</strong>
    </div>)}
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Bảng phân bố trạng thái">
      <table className="w-full text-left text-sm"><caption className="sr-only">Số lượng và tỷ trọng trạng thái trong kỳ lịch hẹn</caption>
        <thead><tr><th scope="col">Trạng thái</th><th scope="col">Số lượng</th><th scope="col">Tỷ trọng</th></tr></thead>
        <tbody>{rows.map(([status, label, count]) => <tr key={status}><th scope="row">{label}</th><td>{count}</td><td>{percent(count)}</td></tr>)}</tbody>
      </table>
    </div>
    <p>Số liệu có thể thay đổi khi công việc được cập nhật.</p>
  </section>
}
