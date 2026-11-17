# CleanHome Staff — kết quả dữ liệu 0 và localhost:3002, 04/11/2026

## Nguyên nhân đã xác minh

Không có lỗi mất phân công hoặc nhầm scope trong Backend/BFF. Mã tài khoản users.id và mã nhân viên employees.id thuộc hai bảng khác nhau.

| Tài khoản | userId từ session | employeeId do Backend resolve | Tổng assignment | DONE |
| --- | --- | --- | --- | --- |
| TEST-STAFF-MANUAL | 9109102 | 9109103 | 0 | 0 |
| TEST-EMPLOYEE-UC9-B | 9109101 | 9109102 | 27 | 10 |
| TEST-EMPLOYEE-UC9 | 9109002 | 9109004 | 29 | 16 |

Tài khoản manual được tạo riêng trước đó và chưa được phân công; số 0 là đúng. Bộ 27/10 thuộc QA B. Không đổi mapping, gán chéo công việc hoặc tạo dữ liệu để làm đầy.

## Môi trường và khắc phục

- Lúc chẩn đoán: 3002/3163/4003/4005 không có listener; Auth 4001 và Staff QA 4015 đang hoạt động. Hai Backend thuộc cụm QA trước đó, dùng database cleanhome_staff_test; cấu hình Auth/Staff cùng host/port/database được đối chiếu trong bộ nhớ, không xuất thông tin kết nối nhạy cảm.
- Source đang chạy trên 4015 khớp hash các file config/runtime/app/repository/job-service/validation/notification-service hiện tại. Worker đối soát của cụm QA vẫn tắt.
- Log máy chủ Webpack trước đó có FATAL JavaScript heap out of memory. Dependency của worktree là junction sang checkout gốc; cấu hình root truyền qua custom server không được phiên bản Next hiện có áp dụng khi prepare.
- Sửa duy nhất cấu hình Staff: /lich chuyển 307 sang /lich-lam-viec và giữ query; root development được suy ra từ đường dẫn app và dependency thực tế, đặt thống nhất cho Turbopack/tracing. Production giữ tracing mặc định. Không sửa node_modules hoặc repository gốc.
- 3002 hiện chạy development bằng Turbopack từ bản sao public source có hash khớp worktree, để Next không ghi đè next-env.d.ts đang pending. Backend tiếp tục được tái sử dụng, không khởi động trùng.
- Chỉ cấu hình tiến trình: origin http://localhost:3002, Auth http://127.0.0.1:4001, Staff http://127.0.0.1:4015, cấu hình phiên QA đã nghiệm thu với cap 7 ngày; dùng key/store hiện có trong worktree. Không sửa .env, session.key, token/credential hoặc code Auth/Refresh.

## Kiểm chứng thực tế trên 3002

- SQL dùng transaction READ ONLY để đối chiếu actor/employee, trạng thái và lịch hẹn UTC+7. Fingerprint users/employees/assignments/bookings trước và sau Chrome giữ nguyên; 0 ghi MySQL.
- 147 unit liên quan PASS; thêm 2 regression test root development/junction và production tracing PASS. Staff typecheck/build 1 worker PASS.
- Chrome 21 REAL_PASS, 0 FAIL/exception/ghi ngoài allowlist, không có response doubles. Login/session, Dashboard, jobs/phân trang/DONE, /lich/giữ kỳ, F5, Notifications, truy cập chéo 404 và logout cho manual/B/A.
- BFF jobs pageSize=100 trả HTTP200: manual 0/0, B 27/27, A 29/29 (total/returned); DONE tương ứng 0/10/16. UI trang đầu B/A là 20 mục; trang hai 7/9 mục, không cộng số phần tử một trang thành tổng.
- Dashboard B: hôm nay 1, chờ nhận 15, đang làm 2, DONE toàn thời gian 10; A: 1/10/0/16; manual: 0/0/0/0. Không coi DONE toàn thời gian là hoàn thành hôm nay.
- Lịch B: năm 2026 là 27, tháng 10 là 22, tháng 11 là 5, ngày 04/11 là 1; A tương ứng 29/24/5/1; manual đều 0. API/UI khớp phạm vi lịch hẹn UTC+7.
- /thong-bao: HTTP200, không lỗi mới, không bật dữ liệu demo hoặc ghi trạng thái đọc.

## Phạm vi và bằng chứng

Source thay đổi: next.config.mjs; test mới staff-local-runtime.test.mjs; tài liệu này. Toàn bộ 78 pending đầu lượt được giữ nguyên từng byte; không stage/commit/push/merge/reset/stash/clean.

Artifact local: C:/Users/Asus/AppData/Local/Temp/cleanhome-staff-datazero-hCzuwB. trace.json, validation.json, browser-report.json, chrome-{MANUAL,B,A}.json, database-before-browser.json và final-audit.json; không chứa password/JWT/cookie. Các lần runtime Webpack/Turbopack khởi động chưa đạt được giữ trong log; kết quả trên là lần chạy cuối sau sửa cấu hình.

URL: http://localhost:3002 — dùng TEST-EMPLOYEE-UC9-B để kiểm tra bộ 27 phân công. Tài khoản TEST-STAFF-MANUAL tiếp tục hiển thị rỗng đúng quyền. Lịch: /lich-lam-viec, hoặc /lich sẽ chuyển hướng.
