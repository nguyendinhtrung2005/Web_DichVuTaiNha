# feat(staff): hand off authenticated UC9–UC12 with local UC12 QA

## Kết quả và phạm vi

Staff đăng nhập bằng phone qua Auth RS256; Browser giữ cookie phiên opaque HttpOnly, JWT chỉ ở BFF server. UC9 danh sách, UC10 chi tiết, UC11 lịch và UC12 trạng thái dùng REST/MySQL thật cho các luồng đã tích hợp, không lấy kết quả nghiệp vụ từ localStorage cũ. Không xóa localStorage hoặc thay Customer/Admin ngoài phạm vi.

UC12 đi Browser → BFF → Staff → Order → MySQL, giữ ASSIGNED → ACCEPTED → IN_PROGRESS → DONE, idempotency key ổn định, journal/ACK và context bền qua reload/relogin. Một nhân viên DONE không làm booking COMPLETED khi người khác chưa xong. Không tự PATCH hoặc báo thành công khi pending/unknown.

**Trạng thái bàn giao:** nhóm xác nhận qua người điều phối, chưa đính kèm bằng chứng riêng. Nguồn là yêu cầu trực tiếp “CLEANHOME – HOÀN TẤT BÀN GIAO UC9–UC12 LÊN GITHUB”; không bịa reviewer, ngày ký hoặc link. Không coi đây là chữ ký riêng của từng owner hoặc phê duyệt kiến trúc/contract production.

Đây là mô tả tổng hợp để review checkpoint, **chưa tạo PR**. Sáu body theo owner nằm trong [pull_requests](pull_requests/01-auth.md), kế hoạch ở [PR_SPLIT_PLAN.md](PR_SPLIT_PLAN.md). Main GitHub 3e90f13 đã merge baseline afc5d78, hai tree giống nhau; thông tin rủi ro272 file trước đây dựa trên origin/main local cũ. Đề xuất sáu PRowner vào integration/uc9-uc12 từ main đã xác minh, rồi PR tổng vào main; chưa tạo/chuyển nhánh.

## Nội dung chuẩn bị staging

- Auth27, SQL nguồn4, Staff Backend42, Order Backend27, Staff Frontend74, QA tooling/test/report12 = **186 file toàn bộ**, theo 01–06-*.approved-paths.txt.
- CSS Staff chỉ57 dòng đã duyệt; giữ13 dòng Admin unstaged. Không lấy `portal.tsx`, Customer auth, generated/tooling ngoài scope, governance hoặc `tatus`.
- Tài liệu bàn giao được quản lý riêng bằng list07; [STAGING_FILES.csv](STAGING_FILES.csv) liệt kê chính xác index cuối, [STAGING_REVIEW.md](STAGING_REVIEW.md) ghi checkpoint.
- Sáu Backend docs đã cập nhật theo patch được trình nhóm, giữ DTO/endpoint/enum và mốc lịch sử. Không đổi source nghiệp vụ hoặc schema, không chạy SQL.

Auth sở hữu user/login/key; Staff sở hữu assignment/check-in/out; Order quyết định booking aggregate và ghi history/journal. Bốn API internal chỉ Staff→Order, Browser không gọi `/internal/`. Hai context API tùy chọn chưa có implementation, không bổ sung dữ liệu giả cho UC10.

## API và bảo mật

| BFF Staff | Backend phía server |
| --- | --- |
| POST /api/auth/login | POST Auth /api/v1/auth/login; cố định EMPLOYEE |
| GET /api/auth/session | Kiểm tra phiên server và Auth introspection |
| POST /api/auth/logout | Thu hồi phiên Frontend, không tuyên bố revoke JWT Backend |
| GET /api/staff/jobs | GET Staff /api/v1/staff/me/jobs |
| GET /api/staff/jobs/:assignmentId | GET Staff /api/v1/staff/me/jobs/:assignmentId |
| GET /api/staff/schedule | GET Staff /api/v1/staff/me/schedule |
| GET/PATCH /api/staff/jobs/:assignmentId/status | Detail/journal BFF và PATCH status có xác nhận |

Cookie HttpOnly/SameSite, Secure khi HTTPS; mutation kiểm tra Origin chính xác, response no-store. ID BIGINT giữ chuỗi, actor/ownership kiểm tra ở server. Không JWT trong localStorage/sessionStorage/response browser hoặc secret trong NEXT_PUBLIC. Không proxy URL tùy ý. HTTP200 confirmed,202 pending; timeout giữ unknown và cùng key. Đọc projection đã tiến triển không thay bằng chứng operation ACK.

Bốn .gitignore phải đi cùng source. Không .env thật, token/cookie/key/vault, backup/dump hoặc toàn bộ .auth-data/qa/session/journal trong PR, kể cả dữ liệu mã hóa. Secret scan chỉ có phạm vi xác định, không chứng nhận toàn lịch sử Git.

Đã xử lý **147/147 cảnh báo whitespace**, raw `git diff --cached --check` **PASS, exit 0**: chỉ sửa blank lines/EOF và tái biểu diễn patch, không đổi schema hoặc AST. Xem [WHITESPACE_REVIEW.md](WHITESPACE_REVIEW.md). Patch tài liệu cần `--unidiff-zero` và image guards; không nới whitespace rule. Staging tăng232→235 chỉ do ba tài liệu proof/review mới.

## Kiểm tra mới trước staging

Bảng557unit/typecheck/build dưới đây là evidence của lượt staging trước. Lượt sửa whitespace chạy lại **55 Auth unit PASS, Staff typecheck PASS**, bốn Node syntaxcheck và proof SQL/AST/patch đều PASS; không chạy lại toàn bộ 557 hoặc build vì không thay nội dung thực thi. HTTP/MySQL/Q01–Q06 không chạy lại.

| Lớp | PASS | FAIL | SKIP / NOT_RUN |
| --- | ---: | ---: | --- |
| Auth / Staff / Order unit | 46 /99 /72 | 0 | 0 |
| Frontend năm nhóm unit | 308 | 0 | 0 |
| QA tooling unit: relay13 +backup7 +data12 | 32 | 0 | 0 |
| Tổng unit khác nhau | **557** | **0** | **0** |
| Frontend328 trên bản sao đúng nội dung được chọn | 328 | 0 | Chạy lại cùng bộ, không cộng thành test khác |
| Typecheck Staff/Customer/Admin | 3 ứng dụng | 0 | 0 |
| Build Staff cùng ổ đĩa, chỉ nội dung được chọn | 1 | 0 | 0 |
| HTTP/MySQL/browser thật trong lượt staging | 0 | 0 | NOT_RUN |

Một lượt build thử trong TEMP ổC gặp lỗi resolve đường dẫn Next từ dependencies ổE. Đã giữ log và chạy lại bản sao cùng ổE thành công, không sửa source/dependency. Chi tiết và phạm vi: [Frontend](FRONTEND_VALIDATION.md), [Backend](BACKEND_VALIDATION.md), [security](FINAL_SECURITY_REVIEW.md). Bản sao không lấy các thay đổi Portal/Customer/Admin chưa được duyệt; index cuối cần khớp blob của bản đã kiểm tra.

## Bằng chứng nghiệm thu đã có

[Báo cáo UC12](../../apps/staff/docs/UC12_E2E_QA_REPORT.md): **43 nhóm E2E local PASS,0 FAIL,0 SKIP,0NOT_RUN** trên Q01–Q06; lớp riêng **90HTTP PASS +1SKIP UC11 qua ranh ngày**, ChromeUC9 15PASS. Không cộng các lớp thành số E2E và không nhận đã chạy lại trong lượt staging.

Sáu booking9109151–9109156,12assignment9109173–9109184 đềuCOMPLETED/DONE,36journal mớiACK. Không chạy lại, reset hoặc restore fixture đã tiêu thụ, gồm booking cũ9109131/9109141. Q03–Q06 dùng mất kết nối/phản hồi thật; không suy thành crash/power-loss. Worker toàn database cố ý tắt. Evidence bảo toàn bốn bảng/110file của lượt QA là scoped, không phải checksum toàn32 bảng/repository.

## Giới hạn và checklist reviewer

Production, HTTPS/Secure cookie thực, tải lớn/stress/soak, nhiều host/replica, serverless và crash/power-loss/restore thực chưa kiểm chứng. BFF session/journal vẫn filesystem một host; Order journal trong history.note trên schema tích hợp dùng chung. Chưa có refresh/revoke Auth hoàn chỉnh, queue phân tán hoặc kiểm chứng global-worker fairness ở lượt Frontend.

- [x] Ghi nhận xác nhận nhóm qua người điều phối, đúng phạm vi đã trình; chưa đính kèm bằng chứng riêng.
- [x] Sáu tài liệu Backend cập nhật tiến độ/evidence, không sửa nghiệp vụ/DTO/schema.
- [x] Unit557, ba typecheck và build Staff trên nội dung chọn có bằng chứng; không chạy lại Q01–Q06.
- [ ] Người dùng xem và xác nhận staged diff cuối, gồm CSS57 và EXCLUDE giữ nguyên.
- [ ] Nhóm chọn sáu head/base trên main đã có baseline; không dựa vào origin/main local cũ, không bỏ sót handoff hoặc dependency.
- [ ] Kiểm tra cached secret/diff và dependencies trên đúng từng ownerhead trước commit/publish.
- [ ] Các owner hoàn tất review riêng/contract theo quy trình nhóm nếu được yêu cầu; không suy chữ ký từ nguồn điều phối.
- [ ] Cho phép riêng commit/push/tạo Draft sau checkpoint, không tự merge.

**Dừng ở kiểm tra staging. Chưa commit, push, tạo PR, merge, đổi branch hoặc lịch sử; không ghi MySQL.** Khi tách ownerPR, chỉ dùng body tương ứng và validation đúng phạm vi PR thực tế; không coi subset trên base khác đã được chứng minh bởi toàn tổ hợp này.
