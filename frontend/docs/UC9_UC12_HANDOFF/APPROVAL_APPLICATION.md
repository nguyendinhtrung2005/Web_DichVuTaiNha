# Áp dụng xác nhận nhóm và kiểm soát staging UC9–UC12

**Cập nhật tiếp theo:** người dùng cho phép sửa whitespace thuần túy. Đã xử lý147 cảnhbáo bằng proof SQL/AST/patch và cập nhật staging232→235 do thêm ba tài liệu chứng minh, không mở rộng source. Main GitHub thực tế3e90f13 đã merge baseline afc5d78; các mô tả rủi ro dựa trên local origin/main cũ ở giai đoạn trước cần đọc cùng [WHITESPACE_REVIEW.md](WHITESPACE_REVIEW.md) và [PR_SPLIT_PLAN.md](PR_SPLIT_PLAN.md). Không có quyền tự commit/push hoặc tạo nhánh mới.

Ghi nhận trong lượt ngày **25/10/2026**, giờ Việt Nam. Branch gốc `feat/cleanhome-frontend`, HEAD kiểm tra `afc5d78b993ec379ba9a9a3c5ab87059dfe2930b`. Không đổi branch hoặc lịch sử trong bước chuẩn bị.

Người dùng đã xác nhận nhóm đồng ý bàn giao UC9–UC12 và các thay đổi liên quan trong bộ handoff. **Nguồn: nhóm xác nhận qua người điều phối, chưa đính kèm bằng chứng riêng.** Không bịa tên reviewer, ngày ký hoặc link; không đánh đồng phê duyệt phạm vi bàn giao với contract có chữ ký độc lập hai owner hay nghiệm thu production. Xác nhận mới thay trạng thái chỉ-phê-duyệt-QA của lượt trước, trong đúng phạm vi đã trình nhóm.

## Phạm vi đã ghi nhận

| Nhóm | File đầy đủ | Quyết định được ghi nhận |
| --- | ---: | --- |
| Auth | 27 | APPROVED để chuẩn bị bàn giao, nguồn qua người điều phối |
| Schema/seed nguồn | 4 | APPROVED chỉ bàn giao source; không chạy SQL |
| Staff Backend | 42 | APPROVED trong phạm vi đã trình; không sửa nghiệp vụ |
| Order Backend | 27 | APPROVED trong phạm vi đã trình; giữ contract hiện có |
| Staff Frontend/BFF | 74 | APPROVED; không nhận Customer/Admin ngoài scope |
| QA tooling/test/báo cáo | 12 | APPROVED code/tài liệu; private dữ liệu QA vẫn loại trừ |
| CSS Staff | Hunk 57 dòng, ngoài 186 | APPROVED chỉ phần hunk đã trình, không gồm 13 dòng Admin |
| Tài liệu handoff | Nhóm riêng | Đồng ý cập nhật và chuẩn bị staging; không tạo quyền publish tự động |

FILES.csv đã ghi đúng **186 ứng viên READY/APPROVED**, CSS READY_HUNK_ONLY/APPROVED; hai mục governance HOLD và tám mục EXCLUDE giữ nguyên. APPROVED_STAGE.csv và các allowlist phải phản ánh đúng nội dung/hash sau cập nhật; không lấy nguyên portal.css vào stage. Nguồn xác nhận mỗi nhóm vẫn là qua người điều phối, chưa có bằng chứng riêng từng owner.

## Sáu tài liệu Backend đã cập nhật

Đã áp dụng [patch tài liệu](proposals/backend-docs-update.patch) đúng sáu file:

1. `backend/auth-service/README.md`.
2. `backend/auth-service/docs/staff-integration.md`.
3. `backend/staff-service/README.md`.
4. `backend/staff-service/docs/order-handoff-checklist.md`.
5. `backend/staff-service/docs/order-service-contract.md`.
6. `backend/order-service/README.md`.

Chỉ cập nhật tiến độ và liên kết bằng chứng mới; giữ DTO, endpoint, enum, schema và logic UC9–UC12 đã nghiệm thu. Các mốc test/seed cũ được giữ dưới nhãn lịch sử. Không tự đổi contract thành APPROVED có chữ ký hai owner. Proposal/patch gốc được giữ để truy vết; không áp dụng lần nữa.

## CSS và phần được bảo toàn

Patch [staff-login-css-only.patch](proposals/staff-login-css-only.patch), SHA-256 `ae3790e20a4202fec3ecdfedd3af6a699cc9cab4305dc714d7da237bfa78cf4b`, chọn 57 dòng Staff ở cuối portal.css. Toàn bộ 57 dòng đã có trong working tree cùng 13 dòng Admin từ trước; không viết lại file hoặc apply lặp. Staging chỉ nhận 57 dòng theo patch, giữ nguyên 13 dòng Admin ở unstaged. Xem [STAFF_HUNKS.md](STAFF_HUNKS.md) và kết quả index cuối trong `STAGING_REVIEW.md`.

`portal.tsx` không cần cho Staff app mới nên không đưa vào PR này. Customer auth, file sinh tự động, UI legacy/Admin, governance và output ngoài scope vẫn được giữ nguyên, không reset/revert/xóa. Không sửa MySQL, backend nghiệp vụ, authentication hoặc schema.

## Điểm kiểm soát hiện tại

Người dùng cho phép cập nhật phê duyệt, áp dụng patch đã đồng ý và chuẩn bị staging theo allowlist; có thể chạy kiểm thử không phá hủy dữ liệu. **Không commit, push, tạo Draft PR hoặc merge trước khi người dùng xem và xác nhận staging cuối.** Các bước còn chờ hoàn tất/đối chiếu được ghi tại `STAGING_REVIEW.md`, không tự coi đã đạt chỉ vì phê duyệt được ghi nhận.

- Quét các file sẽ stage, bốn `.gitignore` và staged diff; loại `.env` thật, JWT/password/cookie/private key/khóa mã hóa, session/vault, backup và toàn bộ `.auth-data`.
- Chạy unit/typecheck/build phù hợp; báo riêng PASS/FAIL/SKIP/NOT_RUN. Không suy kiểm thử độc lập thành HTTP/MySQL E2E.
- Không chạy lại Q01–Q06, seed/migration, worker toàn database hoặc bài ghi trên booking `9109131`/`9109141` đã COMPLETED. Không thay/reset/xóa dữ liệu MySQL.
- Kiểm tra index theo nhóm owner và hunk CSS; không dùng git add . hoặc git add -A. Không stage EXCLUDE hoặc phần Admin.
- Đối chiếu mọi commit giữa base/head trước tạo PR. [PR_SPLIT_PLAN.md](PR_SPLIT_PLAN.md) chỉ ra nhánh hiện tại có commit nền 272 file ngoài phạm vi; chưa tạo/chuyển branch hoặc thay lịch sử để xử lý.

## Bằng chứng nghiệm thu và giới hạn

[Báo cáo UC12](../../apps/staff/docs/UC12_E2E_QA_REPORT.md) ghi **43 nhóm E2E local PASS / 0 FAIL / 0 SKIP / 0 NOT_RUN** và lớp hồi quy riêng **90 HTTP PASS + 1 SKIP** UC11 qua ranh ngày. Đây là evidence đã có, không phải kết quả chạy lại trong bước staging. Các kết quả test mới phải xem báo cáo staging cuối.

Q01–Q06 và booking cũ đã COMPLETED, được giữ làm audit. Production, HTTPS/Secure cookie thực, tải lớn/stress/soak, đa host/replica và crash/power-loss thực chưa được kiểm chứng; mất socket/response không chứng minh crash. Phê duyệt QA không cho phép tái tiêu thụ fixture hoặc upload private QA artifacts.

## Sau khi người dùng xác nhận staging

1. Nhóm chốt hình thức commit/PR và base; không tự đẩy tất cả thay đổi lên một head rồi gọi là sáu PR độc lập.
2. Người dùng cho phép commit/push/tạo Draft riêng sau điểm kiểm soát hiện tại; lệnh chỉ được thực hiện theo quyền mới đó và allowlist đã đối chiếu.
3. Kiểm tra head/base thật, staged secrets, diff lịch sử và dependency; mô tả PR phải khớp nội dung đã chọn.
4. Ready for Review sau validation đúng tổ hợp commit, ownership/contract review cần thiết, không có file ngoài scope hoặc secret, và người dùng chấp nhận các giới hạn còn lại.

[OWNER_APPROVALS.md](OWNER_APPROVALS.md) ghi nguồn xác nhận minh bạch. APPROVED_STAGE.csv giữ phân biệt FILE và HUNK; phạm vi bàn giao không mở rộng sang file/hunk ngoài danh sách đã trình nhóm.
