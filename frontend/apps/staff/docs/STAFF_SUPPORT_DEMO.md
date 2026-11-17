# Hỗ trợ & Cài đặt Staff DEMO

Hai trang: `/ho-tro` (Hỗ trợ) và `/cai-dat` (Cài đặt). Mỗi trang tách rõ phần **thật** và phần **minh họa**:

- Hỗ trợ: chưa có Admin ticket API nên toàn bộ danh sách/tạo mới/chi tiết/phản hồi mẫu là DEMO.
- Cài đặt: tùy chọn giao diện (chuyển động, viền focus) lưu thật trên trình duyệt; thông báo/hiển thị mở rộng/quyền riêng tư và mọi thao tác tài khoản – bảo mật là DEMO hoặc chưa hỗ trợ.

Không thay thế UC9–UC12, Auth/Refresh, BFF, Backend, MySQL, Customer/Admin. Không ghi dữ liệu DEMO vào API/MySQL.

## Bật DEMO

- Hỗ trợ chỉ bật khi process server chạy `NODE_ENV=development` **và** `STAFF_SUPPORT_DEMO_ENABLED=true` (chuỗi đúng tuyệt đối).
- Cài đặt DEMO dùng cờ riêng `STAFF_SETTINGS_DEMO_ENABLED=true`, cùng điều kiện development.
- Hai cờ độc lập với Thu nhập/Hồ sơ/Thông báo/Khu vực/Thành tích. Cờ public, query, storage hoặc tên cờ của module khác không bật DEMO.
- Đặt biến trong process rồi chạy script dev Staff hiện có; không cần sửa `.env`. `.env.example` chỉ là mẫu.
- Khi cờ tắt hoặc ngoài development: Hỗ trợ hiển thị "Hỗ trợ chưa được cung cấp" kèm `REAL_E2E_NOT_RUN`; Cài đặt vẫn giữ tùy chọn giao diện thật, phần tài khoản hiển thị "Tùy chọn tài khoản chưa khả dụng". Không lộ ticket, bản xem trước hay nhãn DEMO.

## Hỗ trợ DEMO (`/ho-tro`)

- Bốn ticket seed `DEMO-SUP-001`–`004`; số đếm Tất cả 4 / Mới 1 / Đang xử lý 1 / Đã giải quyết 2.
- Tạo mới với chủ đề, tiêu đề 5–120 ký tự, nội dung 10–1000 ký tự, mức ưu tiên và công việc DEMO liên quan. Ticket mới nhận mã `DEMO-SUP-005` trở đi, trạng thái Mới.
- Từ chối email/số điện thoại trong tiêu đề/nội dung, trường lạ, chủ đề/ưu tiên/công việc ngoài allowlist.
- Lọc Tất cả/Mới/Đang xử lý/Đã giải quyết; số đếm và danh sách dùng cùng một tập dữ liệu.
- Chi tiết có lịch sử trạng thái và phản hồi mẫu DEMO. Phản hồi mẫu chỉ xem trước, không đổi trạng thái, không gửi đi.
- Hủy bản nháp xóa nội dung, không tạo ticket. "Đặt lại DEMO" khôi phục seed, bộ lọc và bản nháp.
- F5, rời trang, đăng xuất hoặc đổi tài khoản đặt lại toàn bộ. Mỗi tài khoản A/B có instance riêng trong bộ nhớ trang.
- Không gửi email/hotline, không gọi Admin API, không ghi storage/MySQL. Mọi nội dung mang nhãn **DỮ LIỆU MINH HỌA**; trạng thái chỉ là giả định, không xác nhận Admin đã nhận/xử lý/trả lời.

## Cài đặt (`/cai-dat`)

### Lưu thật trên trình duyệt

- Chuyển động `system|reduce` và viền focus `standard|strong`, lưu ở key `cleanhome.staff.display.v1`.
- Áp dụng ngay trong không gian Staff, tồn tại qua F5, dùng chung khi đổi tài khoản trên cùng trình duyệt.
- Khôi phục mặc định xóa đúng key này. Nếu trình duyệt chặn lưu, UI báo "tạm thời" thay vì giả báo đã lưu.

### DEMO (chỉ trong phiên mở trang)

- Thông báo: nhắc lịch ca, cập nhật yêu cầu hỗ trợ, bản tin tuần.
- Hiển thị: mật độ thẻ xem trước, hiện/ẩn mã ca DEMO.
- Quyền riêng tư: che tên trong bản xem trước.
- Các công tắc chỉ thay đổi thẻ xem trước DEMO; không bật push/email, không đổi giao diện thật, không đổi quyền hay dữ liệu tài khoản.
- "Đặt lại tùy chọn DEMO" khôi phục mặc định; F5/đăng xuất/đổi tài khoản đặt lại; A/B độc lập.

### Tài khoản và bảo mật

- Đổi mật khẩu, thiết bị đăng nhập, quyền tài khoản: **chưa hỗ trợ**, hiển thị rõ và không giả lập.
- Đăng xuất dùng menu tài khoản sẵn có; không triển khai lại Auth/Refresh.
- Không lưu token, cookie, mật khẩu hay PII vào localStorage/sessionStorage.

## Ranh giới dữ liệu

- `SupportDemoAdapter` (`list/detail/create/sampleReply/reset`) và `SettingsDemoAdapter` (`read/update/reset`) là biên trình bày; có thể thay bằng adapter Admin/API sau mà không sửa UI.
- Adapter scope theo `userId`, fail-closed ngoài development, kiểm tra abort và allowlist trường.
- Không có request tới API ticket hay API cài đặt tài khoản; Chrome QA chặn mọi write ngoài Auth login/logout/renew.

## Contract cần Admin/Backend cung cấp

- Ticket: danh sách có phân trang/lọc trạng thái, tạo ticket (chủ đề, nội dung, ưu tiên, công việc liên quan), chi tiết, lịch sử trạng thái, phản hồi, moderation/đóng ticket, SLA và mapping trạng thái thật.
- Cài đặt tài khoản: API thông báo, quyền riêng tư, mật độ hiển thị; API đổi mật khẩu; danh sách/ thu hồi thiết bị; quyền hạn.
- Chung: error code ổn định, idempotency cho tạo ticket, ETag/version để tránh ghi đè, phân quyền Staff–Admin và audit log.

## Đã kiểm chứng

- Unit: `test:support-demo` 16 PASS; `test:settings-demo` 19 PASS (gồm `display-preferences`); hồi quy navigation/profile/areas/notifications/income/achievements PASS.
- `npm run typecheck` PASS; production build 1 worker PASS.
- Chrome thật: 23/23 bước DEMO + 3/3 bước demo-off PASS tại 375/390/768/1440; có ảnh cho Hỗ trợ, chi tiết, Cài đặt và demo-off. Không có exception/write bị chặn; localStorage chỉ chứa key hiển thị.
- Báo cáo: `support-settings-demo-acceptance-report.json`, `support-settings-off-acceptance-report.json` trong artifact QA (không commit).
- `REAL_E2E_NOT_RUN` cho Hỗ trợ thật và cài đặt cấp tài khoản; production HTTPS vẫn `NOT_RUN` vì chưa dựng runtime TLS.
