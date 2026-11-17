# CleanHome — kết quả xử lý conflict Staff/main, 17/11/2026

**READY_FOR_OWNER_REVIEW; chưa đủ điều kiện merge hoặc triển khai chung.**
Merge cục bộ `--no-commit --no-ff` đã được cho phép. Chưa commit, push, tạo PR hay thay đổi main. GitHub chưa nhận bản sửa này.

## Nhánh và phạm vi

- Worktree mới: `E:\DACN\du an chinh\CleanHome_Integration_Review_20261117`.
- Nhánh mới: `fix/staff-main-integration-20261117`.
- Nguồn `pr/staff-demo-ready-20261106`: `f7eb648bff5334e791bc77decc556f63139c3501`.
- Main được tích hợp: `3bf2425d4b94c3a19a238c98377675b530d8db5d`.
- Merge-base: `3e90f134fc9e344d6750280e6a0ce8abbf9290d5`.
- PR có conflict là **#14**, Staff vào main; PR #12 đã merge vào integration.
- PR #13 revert Customer vẫn OPEN, chưa merge khi kiểm tra cuối. Nếu main/revert thay đổi, phải tính lại kết quả; không dùng bản nháp để vô tình đưa lại Customer đã được nhóm quyết định revert.
- PR Admin #10 vẫn OPEN; chỉ bảo toàn Admin đang có trên main, chưa tích hợp toàn bộ PR #10.

Bốn worktree gốc/development/PR cũ/Conflict_Fix cũ được đối chiếu HEAD, status và SHA-256 các file WIP với baseline riêng. Không chuyển WIP development chưa nghiệm thu vào bản này. 10 file Database/ERD untracked trong worktree PR cũ vẫn giữ riêng.

## Chính xác 15 conflict

| File | Cách kết hợp |
| --- | --- |
| `backend/auth-service/package.json` | Giữ toàn bộ scripts, dependency, engine, ESM Staff; mọi trường main đã có và cùng giá trị. |
| `backend/auth-service/src/app.js` | Giữ native main và exports; chọn Express Staff được bảo toàn trong app.staff.js theo bootstrap tin cậy. |
| `backend/auth-service/src/db.js` | Giữ createPool(config) Staff và pool tương thích main; khởi tạo lười, không yêu cầu thêm bộ DB_* khi import Staff. |
| `backend/auth-service/src/repository.js` | Giữ lớp Staff; re-export factory main từ repository.portal.js chứa nguyên implementation main. |
| `backend/order-service/package.json` | Giữ đủ scripts, test, dependency, ESM; không mất trường main. |
| `backend/order-service/src/app.js` | Giữ native main/API booking-product/helper và Express Staff riêng; chọn theo bootstrap, không theo request. |
| `backend/order-service/src/db.js` | Giữ cả createPool(config) và singleton main khởi tạo lười. |
| `backend/order-service/src/repository.js` | Giữ lớp Staff; re-export createRepository và bookingRequestHash main từ implementation bảo toàn. |
| `backend/staff-service/package.json` | Giữ scripts/test, gồm hai suite policy thu nhập; không mất trường main. |
| `backend/staff-service/src/app.js` | Giữ Express Staff/Bearer và native main/cookie tại bootstrap riêng; không chuyển credential giữa API. |
| `backend/staff-service/src/db.js` | Giữ createPool Staff và pool main, không mở kết nối MySQL khi import. |
| `backend/staff-service/src/repository.js` | Giữ repository Staff và re-export implementation main không đổi. |
| `databases/schema.sql` | Giữ văn bản canonical main; đủ cùng 32 định nghĩa bảng của cả hai phía, không mất cột/PK/FK. Giữ migrations 001–005 và README main; không chạy SQL. |
| `frontend/packages/ui/src/components/staff/staff-login.tsx` | Giữ BFF Staff; host không có StaffAuthProvider dùng form portal main bảo toàn trong staff-portal-login.tsx. Có provider nhưng BFF lỗi vẫn giữ BFF, không gửi mật khẩu sang API khác. |
| `frontend/packages/ui/src/components/staff/staff-shared.tsx` | Giữ UI/accessibility/loading/error/retry Staff; bảo toàn description, StaffApiJobBadge và StaffApiJobCard mà main sử dụng. |

Không chọn hàng loạt ours/theirs, không đổi FSM hay gỡ guard nhân sự.

## File cần thiết ngoài 15 conflict

Tám file implementation/adapter:

- `backend/auth-service/src/app.staff.js`
- `backend/auth-service/src/repository.portal.js`
- `backend/order-service/src/app.staff.js`
- `backend/order-service/src/repository.portal.js`
- `backend/staff-service/src/app.staff.js`
- `backend/staff-service/src/repository.portal.js`
- `backend/shared/lazy-pool.js`
- `frontend/packages/ui/src/components/staff/staff-portal-login.tsx`

Ba file kiểm thử và một báo cáo:

- `backend/tests/integration-factories.test.js`: 6 regression bootstrap/exports/lazy pool/đóng pool.
- `frontend/apps/staff/test/integration-login-modes.test.mjs`: 3 regression chọn host/provider và không tự chuyển credential khi lỗi.
- `backend/order-service/test/http.test.js`: fixture ACK cũ đi qua Staff client bị guard STAFFING_POLICY_REQUIRED chặn. Test nay xác nhận guard và history chưa ghi, rồi gọi HTTP Order fixture trực tiếp để kiểm tra ACK/idempotency dưới ranh giới Staff. Không sửa runtime/guard/FSM.
- `docs/STAFF_MAIN_CONFLICT_REVIEW_20261117.md`: báo cáo này.

Tổng phạm vi xử lý/kiểm thử/tài liệu: **27 đường dẫn**; toàn bộ diff merge còn chứa thay đổi main tự kết hợp.

Merge tự mang theo **61 deletion đã tồn tại trên main**: 60 file frontend-legacy và frontend/packages/ui/src/components/staff/staff-job-service.ts. Không xóa chúng để xử lý conflict; mọi file trong 15 conflict còn nguyên. Nhóm trưởng cần review cleanup upstream này. Bốn worktree bảo vệ và lịch sử giữ nguyên.

## Kiểm thử đã thực hiện

| Bộ kiểm tra | PASS | SKIP | Phân loại |
| --- | ---: | ---: | --- |
| Auth unit | 46 | 0 | MOCK_PASS |
| Order unit/HTTP fixture sau sửa test | 72 | 0 | MOCK_PASS |
| Staff Backend unit/HTTP fixture | 170 | 0 | MOCK_PASS |
| Backend main + regression factory/pool | 85 | 3 | MOCK_PASS, MySQL opt-in SKIP |
| Staff Frontend, gồm 3 regression login mới | 816 | 8 | MOCK_PASS, không phải Chrome thực |
| Frontend main unit | 58 | 0 | MOCK_PASS |
| **Tổng không đếm lại test lặp** | **1.247** | **11** | Không có FAIL trong lần cuối |

Lần Order đầu tiên: 71 PASS/1 FAIL vì fixture đi qua guard; log được giữ. Sau sửa fixture: 72/72 PASS; không nới policy.

Typecheck **Staff/Customer/Admin PASS**. Webpack production build **cả ba PASS**. SQL tĩnh/dependency/conflict markers: PASS. git diff --check và kiểm tra cached riêng 27 đường dẫn: PASS. Kiểm tra cached toàn merge trả exit 2 tại sáu Markdown hard-break có sẵn trên main: BACKEND_TEAM_RULES.md dòng 3–4 và backend/docs/admin-staff-order-integration-draft.md dòng 3–5, 86. Hai file trùng nguyên main, giữ nguyên hai dấu cách xuống dòng; không sửa tài liệu upstream để làm đẹp kết quả. Không phát hiện secret theo mẫu hoặc đường dẫn riêng tư trong staged diff; đây không thay thế review của owner.

Test chạy với Node test runner, TAP, concurrency=1; các suite service lấy danh sách test:unit. Frontend dùng toàn bộ *.test.mjs Staff và *.unit.test.mjs main. Typecheck dùng tsc --noEmit --incremental false. Build dùng next build --webpack với bản sao 369 public input đã hash, output/temp/cache trên E ngoài các worktree. Chỉ giới hạn worker/heap và outputFileTracingRoot bản build kiểm chứng; giữ kiểm tra TypeScript. Không sửa node_modules hoặc next-env của worktree bảo vệ, không cài dependency.

**NOT_RUN/BLOCKED:** trial MySQL 3308 không có listener; chưa có live DB integration, Chrome E2E hoặc AI thật trong lượt này. Không dùng secret hay bật service. Schema/migrations chỉ so sánh tĩnh, không import/seed/migrate. Build không chạm ngưỡng dừng C dưới 8 GiB hoặc giảm quá 0,5 GiB.

## Quyết định bắt buộc trước tích hợp chung

1. **Nhóm trưởng:** chốt PR #13/base; main thay đổi thì giữ bản nháp và phân tích lại trước commit.
2. **Auth owner:** Staff dùng phone/Bearer/RS256-JWKS-introspection; portal dùng identifier/cookie/session. Định dạng scrypt và yêu cầu tạo mật khẩu cũng khác. Giữ hai implementation không tạo SSO hoặc bảo đảm tài khoản dùng chéo. Phải chốt bootstrap/cổng, issuer/audience/key và provision user. Không hạ chuẩn mật khẩu, không bật refresh/đổi TTL, không tự chuyển credential.
3. **Order/Staff/Admin owner:** Staff dùng journal booking_status_history; main dùng staff_assignment_transition_operations (migration 005). Hai đường ghi chưa được chứng minh cùng transaction/guard. Staff vẫn chặn 409 STAFFING_POLICY_REQUIRED khi thiếu policy. Native main được giữ nguyên, chưa chứng minh staffing guard tương đương. Không triển khai hai writer cho cùng booking trước khi chốt readiness, thay người, idempotency, khóa và điều kiện hoàn thành đủ nhân viên.
4. **Database owner:** schema nền 32 bảng khác trial được báo 34 bảng. Các migration main bổ sung email/product-service/reservation/idempotency/operation journal chưa được xác minh với MySQL thực. Cần review và kiểm thử DB riêng sau khi cấp phép, không tự chạy migration.
5. **Admin owner:** PR #10 chưa merge; build phần Admin trên main không thay thế nghiệm thu PR #10.
6. Payout, Review/KPI, duyệt ca, hồ sơ/đổi mật khẩu vẫn cần API/phê duyệt đã ghi nhận; không thêm nghiệp vụ trong lượt này.

## Quy trình review tiếp theo

- Chốt main/revert và kiểm tra lại SHA base/head.
- Owner Auth/Order/Staff/Database review các file tương ứng và ranh giới bootstrap; chưa coi AI review là owner approval.
- Review 61 deletion upstream và các migration, không nhầm với xóa WIP.
- Khi được phép và có cấu hình đã thống nhất, chạy DB integration/Chrome E2E A/B/login/công việc/Customer/Admin trên môi trường riêng.
- Chỉ sau phê duyệt mới commit nhánh sửa riêng, push thường và tạo PR. Không merge main trực tiếp hay force-push.

Baseline, log, output và chứng cứ riêng tư chỉ giữ tại máy QA trên E; không đưa credential, .env, SQL dump hoặc build output vào Git. Bản nháp dừng ở merge chưa commit để người dùng kiểm tra.
