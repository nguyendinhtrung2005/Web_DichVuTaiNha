import type { HouseType, JobStatus, OrderStatus, PaymentMethod, PaymentStatus, ServiceCategory } from "./types"

/**
 * Quy tắc hủy mẫu, có thể cấu hình khi có chính sách thực tế.
 * Không áp dụng phí hủy tự động.
 */
export const CANCEL_POLICY = {
  allowedStatuses: ["pending", "confirmed"] as OrderStatus[],
  blockedJobStatuses: ["in_progress", "done"] as JobStatus[],
  requireAdminApproval: true,
  description: [
    "Chỉ gửi yêu cầu hủy khi đơn chưa bắt đầu thực hiện.",
    "Yêu cầu hủy cần quản trị viên xem xét và duyệt.",
    "Đơn chỉ chuyển sang “Đã hủy” sau khi được duyệt.",
    "Bản demo chưa áp dụng phí hủy.",
  ],
}

export const BANK_INFO = {
  bank: "Ngân hàng TMCP Ngoại thương Việt Nam (Vietcombank) – mẫu",
  accountName: "CONG TY TNHH CLEANHOME (MAU)",
  accountNumber: "0000 1234 5678",
}

export const COMPANY = {
  name: "CleanHome",
  hotline: "1900 6868",
  email: "hotro@cleanhome.vn",
  address: "123 Nguyễn Văn Linh, Quận 7, TP. Hồ Chí Minh",
}

export const CATEGORY_LABEL: Record<ServiceCategory, string> = {
  "ve-sinh-nha-o": "Vệ sinh nhà ở",
  "ve-sinh-phong-tro": "Vệ sinh phòng trọ",
  "cham-soc": "Chăm sóc",
  "bao-duong": "Bảo dưỡng",
}

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  pending: "Chờ xác nhận",
  confirmed: "Đã xác nhận",
  in_progress: "Đang thực hiện",
  completed: "Hoàn thành",
  cancelled: "Đã hủy",
}

export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  waiting: "Chờ tiếp nhận",
  accepted: "Đã tiếp nhận",
  in_progress: "Đang thực hiện",
  done: "Hoàn thành",
}

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  unpaid: "Chưa ghi nhận đã nhận tiền",
  pending: "Chờ xác nhận đã nhận tiền",
  paid: "Đã xác nhận đã nhận tiền",
}

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: "Tiền mặt",
  transfer: "Chuyển khoản",
}

export const HOUSE_TYPE_LABEL: Record<HouseType, string> = {
  "can-ho": "Căn hộ chung cư",
  "nha-pho": "Nhà phố",
  "biet-thu": "Biệt thự",
  "van-phong": "Văn phòng nhỏ",
}

export const TIME_SLOTS = ["07:00", "07:30", "08:00", "08:30", "09:00", "09:30", "10:00", "10:30", "13:00", "13:30", "14:00", "14:30", "15:00", "15:30", "16:00"]

export const AUTH_NOTICE =
  "Đây là xác thực mô phỏng phục vụ demo giao diện, không phải bảo mật thật. Khi kết nối backend, máy chủ sẽ kiểm tra mật khẩu và quyền trên từng API."
