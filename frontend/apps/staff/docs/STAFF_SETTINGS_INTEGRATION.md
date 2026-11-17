# Cài đặt tài khoản Staff

Trang `/cai-dat` dùng session thật và `GET /api/staff/branch` qua Staff BFF. Sidebar đặt Cài đặt cuối menu, dùng chung trên desktop và mobile.

## Đang hoạt động

- Chi nhánh theo tài khoản đăng nhập, loading, timeout, lỗi và retry; không nhận employeeId/role từ form.
- Đăng xuất phiên hiện tại bằng BFF Auth hiện có, yêu cầu xác nhận và hiển thị lỗi nếu thất bại.
- Giảm chuyển động, viền focus, khôi phục mặc định: local trên trình duyệt, dùng chung các tài khoản trên thiết bị.
- Ưu tiên thông báo chưa đọc: local riêng theo ID tài khoản. Khi mở Thông báo, bộ lọc gọi API danh sách thật với `unreadOnly=true`. Không thay đổi việc gửi thông báo.
- Hỗ trợ, thông tin quyền chỉ đọc. Không có chức năng xóa tài khoản.

## Contract còn thiếu — cần chủ sở hữu Auth/Backend xác nhận

Auth hiện chỉ có login/refresh/logout/introspect/JWKS, session công khai chỉ chứa `id`, `role`, `status`, `expiresAt`. Staff hiện không có API cập nhật hồ sơ. Không dùng dữ liệu hồ sơ DEMO hoặc đọc trực tiếp database Auth để bù dữ liệu.

Các endpoint dưới đây là **đề xuất cần cung cấp, chưa tồn tại**:

| Nhu cầu | Contract cần thống nhất |
| --- | --- |
| Đọc hồ sơ | `GET /api/v1/auth/me`: họ tên, điện thoại, email, ảnh đại diện; phân biệt trường chưa cung cấp. |
| Sửa hồ sơ | `PATCH /api/v1/auth/me/profile`: allowlist trường tự sửa; validation, xác minh khi đổi điện thoại/email, lỗi và cơ chế chống ghi đè. Không nhận userId, employeeId, role hoặc trạng thái từ browser. |
| Đổi mật khẩu | `POST /api/v1/auth/change-password`: mật khẩu hiện tại/mới, chính sách độ mạnh, rate limit, xác nhận lại danh tính và quy tắc thu hồi phiên. |
| Thiết bị | `GET /api/v1/auth/sessions`: DTO tối thiểu, không chứa token; API thu hồi phiên nếu được phê duyệt. |
| Tùy chọn gửi thông báo | Chủ sở hữu xác nhận endpoint GET/PATCH, các kênh thực sự được hỗ trợ, phạm vi đồng bộ và mặc định. |

BFF chỉ được nối các contract được duyệt với session/CSRF/validation và phân quyền A/B. Hiện form hồ sơ và đổi mật khẩu bị khóa; không gửi request hoặc báo thành công giả. Chế độ tối chờ hệ thống giao diện hỗ trợ đồng bộ.

## Kiểm thử

`npm.cmd run test:settings --workspace @cleanhome/staff` từ `frontend/`.

Chrome QA thật: `$env:RUN_STAFF_ISOLATED_SETTINGS_QA='true'; node qa/staff/settings.browser.mjs`. Chỉ dùng QA độc lập đang chạy, không seed/migrate; mọi business mutation bị chặn trong harness. Báo cáo và ảnh nằm trong `qa/staff/.private/reports/` (gitignored).

Kết quả QA ngày 06/11/2026 (UTC+7): unit 86/86 PASS, TypeScript PASS, Webpack PASS, Chrome 11/11 REAL_PASS. Chrome bao gồm A/B, session/F5/logout, lỗi GET/retry, lỗi localStorage và responsive 375/390/768/1440. Fingerprint các bảng nghiệp vụ không thay đổi; không có browser exception hoặc request ghi nghiệp vụ. Sửa hồ sơ/đổi mật khẩu/thiết bị/đồng bộ tùy chọn thông báo: NOT_RUN vì chưa có contract; UI đã kiểm tra bị khóa. Đây là bằng chứng QA local, chưa nghiệm thu production.

## File thay đổi trong tác vụ này

- `frontend/packages/ui/src/components/staff/`: `staff-layout.tsx`, `staff-navigation.ts`, `staff-settings.tsx`, `staff-account-settings.tsx`, `staff-notification-view-preferences.ts`, `staff-notifications-remote.tsx`.
- `frontend/apps/staff/`: `app/globals.css`, `package.json`, `test/settings-demo-ui.test.mjs`, `test/settings-local-view.test.mjs`, `test/staff-navigation.test.mjs`, tài liệu này.
- `qa/staff/settings.browser.mjs`.
