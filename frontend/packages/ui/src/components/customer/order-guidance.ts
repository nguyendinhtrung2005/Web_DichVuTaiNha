import type { Order } from "@/lib/types"

export function orderNextStep(order: Pick<Order, "status" | "cancelRequest">) {
  if (order.status === "cancelled") return "Đơn đã hủy và không tiếp tục thực hiện. Bạn có thể chọn dịch vụ để đặt lịch mới."
  if (order.cancelRequest?.status === "pending") return "Yêu cầu hủy đang chờ duyệt. Lịch dịch vụ vẫn giữ trạng thái hiện tại cho đến khi có kết quả."
  switch (order.status) {
    case "pending": return "CleanHome đã nhận yêu cầu. Ngày giờ bạn chọn là đề xuất; hãy chờ xác nhận lịch hẹn."
    case "confirmed": return "Lịch hẹn đã được xác nhận. Vui lòng kiểm tra lại địa chỉ và chuẩn bị khu vực cần thực hiện."
    case "in_progress": return "Dịch vụ đang được thực hiện. Bạn có thể theo dõi các cập nhật trong lịch sử đơn."
    case "completed": return "Dịch vụ đã hoàn thành. Bạn có thể xem lại chi tiết, đánh giá khi đủ điều kiện hoặc đặt lại dịch vụ."
  }
}
