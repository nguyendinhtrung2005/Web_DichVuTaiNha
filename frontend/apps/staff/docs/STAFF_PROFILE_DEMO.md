# Hồ sơ nhân viên Staff — DEMO cô lập

Hoàn tất ngày 30/10/2026. Route `/ho-so` giữ nguyên thông tin tài khoản thật; khu vực hồ sơ minh họa là phần riêng.

- Bật bằng `STAFF_PROFILE_DEMO_ENABLED=true` cho riêng tiến trình `next dev` có cấu hình Auth hiện có. Gate chỉ chấp nhận `NODE_ENV=development`; phải khởi động lại dev server sau đổi biến. Không sửa .env, không dùng query/cookie/NEXT_PUBLIC/localStorage để bật. Cờ độc lập với Thu nhập.
- Production luôn tắt demo, kể cả cờ true. Khi tắt, mã tài khoản/vai trò/trạng thái session vẫn hiển thị và khu vực thiếu hồ sơ thật giữ đúng trạng thái chưa có thông tin.
- `staff-profile-demo-model.ts`: model giao diện, validation và seed hoàn toàn giả lập. Họ tên “Nhân viên Minh Họa”, số liên hệ toàn số0, email example.invalid, địa chỉ/chi nhánh/chứng chỉ đều gắn nghĩa minh họa; không lấy tên/phone/email của tài khoản QA.
- Avatar chọn trong4biểu tượng nội bộ; không URL ảnh ngoài, upload hoặc thành công upload giả. Kỹ năng/chứng chỉ giả lập không có giá trị xác minh.
- `ProfileDemoAdapter` có read/save/reset, UI nhận adapter. Adapter demo chỉ giữ bản sao riêng trong bộ nhớ, gắn với tài khoản đang mở; không cache module/map giữa các tài khoản, không API hoặc browser storage.
- Lưu là lưu bản minh họa tạm thời; hủy bỏ draft chưa lưu; reset chỉ trả bản minh họa hiện tại về seed. F5, rời trang và logout hủy trạng thái tạm. UI nói rõ điều này và không báo đã cập nhật Backend.
- Account ID chỉ tạo scope, không trở thành dữ liệu minh họa hoặc trường có thể sửa. Khi đổi tài khoản, component đổi key và abort thao tác cũ; UI còn kiểm tra scope khớp session hiện hành trước khi hiển thị.
- Validation allowlist toàn bộ trường; từ chối id/userId/role/status/Auth metadata, kiểm độ dài, phone/email, năm kinh nghiệm, ngày thực/năm nhuận, kỹ năng và chứng chỉ trùng/hết hạn trước ngày cấp. Không tự đặt quy tắc nghiệp vụ hồ sơ thật.
- **DEMO_PASS** là kiểm chứng giao diện/adapter minh họa. **REAL_E2E_NOT_RUN** cho API hồ sơ/ảnh/kỹ năng/chứng chỉ thật; cần TV1 User +TV4 Staff duyệt contract/quyền/validation và cung cấp API trước khi viết adapter remote.
