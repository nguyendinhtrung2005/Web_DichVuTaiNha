# Staff — kết quả triển khai và kiểm thử 05/11/2026

Đã triển khai các phần độc lập; **chưa xác nhận production-ready** khi chưa nghiệm thu dịch vụ, key và chính sách thật. Không ghi MySQL, không chạy migration, không sửa Customer/Admin/Auth/Order, không commit/push/reset/stash/clean/rebase.

| Kiểm tra | Kết quả |
| --- | --- |
| `npm.cmd run test:modules --workspace=@cleanhome/staff` | PASS 146/146 |
| `npm.cmd run test:auth --workspace=@cleanhome/staff` | PASS 114/114; Auth doubles, kho session tạm |
| Staff Backend areas + income policy/configured policy/service | PASS 38/38; repository doubles, không MySQL |
| Staff typecheck | PASS |
| `next build --webpack` | PASS trên mã cuối |
| Chrome bản production build, 4 trang × 375/390/768/1440 | PASS 24 kiểm tra, gồm 16 layout, loading/error/retry/empty và F5 |
| Chrome development DEMO_V2, cùng 4 viewport | PASS 28 kiểm tra; thêm income loading/error/retry/empty, biểu đồ và lọc bảng kê |
| Chrome form đăng nhập, Auth doubles | PASS 11/11; sai mật khẩu, session, login/logout, giữ/xóa draft |
| HTTP trên bản build: session, branch, availability, reviews, chatbot khi anonymous | PASS 5/5: 401 + no-store |
| Google Maps, AI, Review API, chi trả thật | NOT_RUN — chưa có key/dịch vụ/chính sách |
| Auth/Staff HTTP và Chrome E2E có xác thực bằng dịch vụ thật | NOT_RUN — dịch vụ thật chưa chạy trên cổng cấu hình |
| Audit accessibility toàn diện / hiệu năng production | NOT_RUN; đã kiểm tra nhãn, keyboard, overflow, trạng thái và giới hạn tài nguyên ở module |

Chrome ban đầu CDP timeout trong sandbox; chạy lại ngoài sandbox với profile tạm riêng đã PASS. Các fixture chỉ nằm trong test; không có nhánh tạo dữ liệu giả trong production. Report production Chrome cuối: `C:/Users/Asus/AppData/Local/Temp/cleanhome-staff-modules-report-bKKcyX/report.json`; form: `C:/Users/Asus/AppData/Local/Temp/cleanhome-auth-form-report-M9dXsi/report.json`. Không có runtime exception hoặc cảnh báo key trùng ở Chrome module. Timing local tối đa DOMContentLoaded 162 ms/load 240 ms với doubles; không dùng làm benchmark production.

Report Chrome DEMO_V2: `C:/Users/Asus/AppData/Local/Temp/cleanhome-staff-modules-report-Xh81jA/report.json`. Sau khi sửa React key trùng giữa hai khối Thành tích, 28 kiểm tra chạy lại PASS và không còn cảnh báo key trùng. Chỉ gỡ hai file AGENTS.md/CLAUDE.md do chính các lần `next dev` này tự sinh, không đụng file hướng dẫn gốc. Các Staff server QA được dừng sau kiểm thử.

## Cấu hình còn cần

- Maps: origin Staff thực tế, browser key đã hạn chế website/API và dữ liệu chi nhánh có tọa độ/GeoJSON. Xem [Maps setup](STAFF_GOOGLE_MAPS_SETUP.md).
- Thu nhập: policy được phê duyệt, provider policy và nguồn bằng chứng di chuyển tin cậy; API đối soát/chi trả. Engine cấu hình chưa nối production, DEMO_V2 vẫn chỉ development. Xem [Income policy](STAFF_INCOME_POLICY_CONFIGURATION.md).
- Chatbot: duyệt `general-guidance-v1`, nhà cung cấp/gateway tương thích và API key server-side; giới hạn dùng chung nếu nhiều replica. Chỉ câu hỏi FAQ cố định được gửi; không gửi transcript, dữ liệu cá nhân hoặc booking. Xem [AI configuration](STAFF_SUPPORT_AI_CONFIGURATION.md).
- Review: API `/api/v1/staff/me/reviews`, quyền xem nội dung và chính sách redact; quy chế KPI nếu muốn huy hiệu. Xem [Review contract](STAFF_REVIEWS_INTEGRATION.md).
- Kiểm thử thật: môi trường QA có Auth/Staff chạy và tài khoản được cấp qua môi trường bảo mật, không gửi mật khẩu/token vào báo cáo.

## File được sửa hoặc tạo trong lượt này

Danh sách này chỉ ghi phần triển khai lượt này; worktree còn nhiều WIP đã có trước. Một số file dưới đây vốn đã modified hoặc untracked.

`frontend/packages/ui/src/components/staff/`:

```text
staff-maps-model.ts
staff-maps-loader.ts
staff-branch-map.tsx
staff-areas-remote.tsx
staff-income-remote.tsx
staff-support.tsx
staff-support-knowledge.tsx
staff-support-questions.mjs
staff-support-assistant.tsx
staff-achievements.tsx
staff-performance-breakdown.tsx
staff-performance-remote-model.ts
staff-reviews-contract.mjs
staff-reviews-remote-model.ts
staff-reviews-remote.tsx
```

`frontend/apps/staff/`:

```text
.env.example
package.json
app/globals.css
app/api/staff/support/chat/route.ts
app/api/staff/reviews/route.ts
lib/server/support-chat-config.mjs
lib/server/support-chat-http.mjs
lib/server/reviews-http.mjs
test/maps.test.mjs
test/staff-priorities.test.mjs
test/income-remote-ui.test.mjs
test/support-chat-http.test.mjs
test/support-demo-ui.test.mjs
test/reviews-http.test.mjs
test/reviews-ui.test.mjs
test/performance-model.test.mjs
test/achievements-demo-ui.test.mjs
test/staff-modules.browser.mjs
docs/STAFF_GOOGLE_MAPS_SETUP.md
docs/STAFF_INCOME_POLICY_CONFIGURATION.md
docs/STAFF_SUPPORT_AI_CONFIGURATION.md
docs/STAFF_REVIEWS_INTEGRATION.md
docs/STAFF_MODULES_VALIDATION_20261105.md
```

`backend/staff-service/`:

```text
src/income-configured-policy.js
test/income-configured-policy.test.js
test/income.test.js
```

Build tự sinh lại `next-env.d.ts`; giữ lại các tham chiếu development có trước sau kiểm thử. Không chỉnh source của các WIP còn lại.

Git cuối lượt: **29 modified, 76 untracked files, 0 staged**, bao gồm toàn bộ WIP có trước. `git diff --check` PASS. Các thay đổi đều nằm trong Staff frontend/component và `backend/staff-service`; không commit/push hoặc đổi nhánh.
