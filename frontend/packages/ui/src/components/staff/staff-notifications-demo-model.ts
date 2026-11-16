export type NotificationType = "WORK" | "INCOME" | "PROFILE" | "SYSTEM"
export type NotificationFilter = "all" | "unread"
export type DemoNotification = {
  id: string; type: NotificationType; title: string; body: string
  createdAt: string; readAt: string | null; href: string; label: string
}
export type NotificationReport = { items: DemoNotification[]; unreadCount: number; total: number }
/** Presentation boundary only. Future providers map their approved DTO here. */
export interface NotificationDemoAdapter {
  readonly kind: "demo" | "unavailable" | "remote"
  list(filter: NotificationFilter, signal?: AbortSignal): Promise<NotificationReport | null>
  detail(id: string, signal?: AbortSignal): Promise<DemoNotification | null>
  markRead(id: string, signal?: AbortSignal): Promise<NotificationReport>
  readAll(signal?: AbortSignal): Promise<NotificationReport>
  reset(signal?: AbortSignal): Promise<NotificationReport | null>
}
export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = Object.freeze({
  WORK: "Công việc", INCOME: "Thu nhập", PROFILE: "Hồ sơ", SYSTEM: "Hệ thống",
})
const destinations = Object.freeze(["/", "/cong-viec", "/lich-lam-viec", "/thu-nhap", "/ho-so", "/lich-su", "/ho-tro", "/cai-dat", "/thong-ke-cong-viec"])
/** Exact Staff landing pages only. Demo links never select an assignment or actor. */
export function isSafeNotificationHref(value: unknown): value is string {
  return typeof value === "string" && destinations.includes(value)
}
const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
export function isNotificationTime(value: unknown): value is string {
  return typeof value === "string" && iso.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
}
export function formatNotificationTime(value: string): string {
  if (!isNotificationTime(value)) return "Chưa có thời gian hợp lệ"
  const date = new Date(Date.parse(value) + 7 * 3_600_000).toISOString()
  return date.slice(8, 10) + "/" + date.slice(5, 7) + "/" + date.slice(0, 4) + " · " + date.slice(11, 16)
}
export function cloneNotification(value: DemoNotification): DemoNotification { return { ...value } }
function assertNotification(value: DemoNotification) {
  if (!value || typeof value.id !== "string" || !/^DEMO-NOTICE-[A-Z0-9-]{1,80}$/.test(value.id)
    || !Object.prototype.hasOwnProperty.call(NOTIFICATION_TYPE_LABELS, value.type)
    || typeof value.title !== "string" || value.title.trim().length < 1 || value.title.length > 160
    || typeof value.body !== "string" || value.body.trim().length < 1 || value.body.length > 2000
    || typeof value.label !== "string" || !value.label.trim() || value.label.length > 100
    || !isNotificationTime(value.createdAt) || value.readAt !== null && (!isNotificationTime(value.readAt) || value.readAt < value.createdAt)
    || !isSafeNotificationHref(value.href)) throw new RangeError("Invalid isolated demo notification")
}
/** total and unreadCount describe the whole private dataset; only items is filtered. */
export function notificationReport(items: readonly DemoNotification[], filter: NotificationFilter): NotificationReport {
  if (filter !== "all" && filter !== "unread") throw new RangeError("Invalid notification filter")
  const ids = new Set<string>()
  for (const item of items) { assertNotification(item); if (ids.has(item.id)) throw new RangeError("Duplicate notification"); ids.add(item.id) }
  return {
    items: items.filter(item => filter === "all" || item.readAt === null).map(cloneNotification)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id)),
    unreadCount: items.filter(item => item.readAt === null).length, total: items.length,
  }
}
const seed: readonly Readonly<DemoNotification>[] = Object.freeze([
  { id: "DEMO-NOTICE-WORK-01", type: "WORK", title: "Khám phá danh sách công việc", body: "Đây là thông báo minh họa để trải nghiệm điều hướng. Không có phân công mới nào được tạo từ thông báo này. Trang đích Công việc sử dụng dữ liệu được phân quyền hiện có.", createdAt: "2026-10-29T10:00:00.000Z", readAt: null, href: "/cong-viec", label: "Mở Công việc" },
  { id: "DEMO-NOTICE-INCOME-01", type: "INCOME", title: "Trải nghiệm bảng kê thu nhập minh họa", body: "Thông báo giả lập giới thiệu giao diện Thu nhập DEMO. Không xác nhận tiền công, số dư hoặc giao dịch thanh toán thật.", createdAt: "2026-10-29T08:30:00.000Z", readAt: null, href: "/thu-nhap", label: "Mở Thu nhập" },
  { id: "DEMO-NOTICE-PROFILE-01", type: "PROFILE", title: "Thử chỉnh sửa hồ sơ minh họa", body: "Bạn có thể trải nghiệm vùng Hồ sơ DEMO nếu đã được bật. Dữ liệu minh họa tách khỏi mã tài khoản, vai trò và trạng thái Auth thật.", createdAt: "2026-10-28T04:00:00.000Z", readAt: null, href: "/ho-so", label: "Mở Hồ sơ" },
  { id: "DEMO-NOTICE-SYSTEM-01", type: "SYSTEM", title: "Tùy chọn hiển thị dành cho bạn", body: "Nội dung minh họa giới thiệu trang Cài đặt. Thông báo này không thay đổi tùy chọn hay phiên đăng nhập của bạn.", createdAt: "2026-10-27T03:00:00.000Z", readAt: "2026-10-28T01:00:00.000Z", href: "/cai-dat", label: "Mở Cài đặt" },
  { id: "DEMO-NOTICE-WORK-02", type: "WORK", title: "Xem lịch làm việc theo ngày", body: "Thông báo minh họa không tạo ca, lịch hẹn hoặc cập nhật phân công. Mở trang Lịch để xem nguồn dữ liệu hiện có theo quyền Staff.", createdAt: "2026-10-26T09:00:00.000Z", readAt: null, href: "/lich-lam-viec", label: "Mở Lịch làm việc" },
  { id: "DEMO-NOTICE-SYSTEM-02", type: "SYSTEM", title: "Tìm hiểu khu vực hỗ trợ", body: "Thông báo giả lập chỉ cung cấp lối vào trang Hỗ trợ; không gửi ticket, chat hoặc liên hệ tới bất kỳ người nhận nào.", createdAt: "2026-10-25T02:00:00.000Z", readAt: "2026-10-26T02:00:00.000Z", href: "/ho-tro", label: "Mở Hỗ trợ" },
  { id: "DEMO-NOTICE-WORK-03", type: "WORK", title: "Nhìn lại các phân công đã hoàn thành", body: "Đây là nội dung minh họa, không được phát sinh từ sự kiện UC9–UC12 thật. Lịch sử công việc vẫn lấy dữ liệu từ nguồn hiện có khi bạn mở trang.", createdAt: "2026-10-24T01:00:00.000Z", readAt: null, href: "/lich-su", label: "Mở Lịch sử" },
  { id: "DEMO-NOTICE-INCOME-02", type: "INCOME", title: "Phân biệt số minh họa và thu nhập thật", body: "Bộ thông báo minh họa không đọc giá booking hoặc biến số tiền minh họa thành tiền đã được thanh toán. Tính năng tiền thật cần tích hợp Payment riêng.", createdAt: "2026-10-23T06:00:00.000Z", readAt: "2026-10-24T02:00:00.000Z", href: "/thu-nhap", label: "Xem Thu nhập" },
  { id: "DEMO-NOTICE-PROFILE-02", type: "PROFILE", title: "Kỹ năng và chứng chỉ trong bản minh họa", body: "Nội dung giả lập không chứng minh kỹ năng hoặc xác minh chứng chỉ của nhân viên. Chỉ vùng Hồ sơ DEMO có thể chỉnh sửa thông tin minh họa.", createdAt: "2026-10-22T04:00:00.000Z", readAt: "2026-10-23T04:00:00.000Z", href: "/ho-so", label: "Xem Hồ sơ" },
  { id: "DEMO-NOTICE-SYSTEM-03", type: "SYSTEM", title: "Bắt đầu từ Tổng quan", body: "Thông báo minh họa đưa bạn trở lại trang Tổng quan. Không có push notification hoặc đăng ký nhận thông báo nền nào được tạo.", createdAt: "2026-10-21T03:00:00.000Z", readAt: "2026-10-22T02:00:00.000Z", href: "/", label: "Về Tổng quan" },
].map(item => Object.freeze(item as DemoNotification)))
export function defaultNotifications(): DemoNotification[] { return seed.map(cloneNotification) }
