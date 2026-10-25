# CleanHome — kiểm tra staging bàn giao UC9–UC12

Ghi nhận ngày 25/10/2026, giờ Việt Nam. Branch `feat/cleanhome-frontend`, HEAD `afc5d78b993ec379ba9a9a3c5ab87059dfe2930b`. Điểm dừng: **người dùng kiểm tra staging; chưa commit, push, tạo PR hoặc merge**.

Người dùng đã xác nhận nhóm đồng ý bàn giao phạm vi trình trong handoff. Nguồn minh bạch: **nhóm xác nhận qua người điều phối, chưa đính kèm bằng chứng riêng**. Không bịa tên reviewer, ngày ký, link review hoặc bằng chứng hai owner ký contract. Xác nhận mới thay trạng thái chỉ-phê-duyệt-QA ở các lượt trước; không mở rộng sang phần EXCLUDE hoặc governance.

Xem [STAGING_REVIEW.md](STAGING_REVIEW.md) để kiểm tra index cuối, [STAGING_FILES.csv](STAGING_FILES.csv) để xem từng đường dẫn, [OWNER_APPROVALS.md](OWNER_APPROVALS.md) để đối chiếu nguồn xác nhận và [PR_SPLIT_PLAN.md](PR_SPLIT_PLAN.md) cho phương án PR.

## Phạm vi theo owner

| Nhóm | File toàn bộ | Allowlist đã được ghi nhận duyệt |
| --- | ---: | --- |
| Auth / TV1 | 27 | [01-auth.approved-paths.txt](01-auth.approved-paths.txt) |
| Schema/seed nguồn / owner bảng | 4 | [02-database.approved-paths.txt](02-database.approved-paths.txt) |
| Staff Backend / TV4 | 42 | [03-staff.approved-paths.txt](03-staff.approved-paths.txt) |
| Order Backend / TV3 | 27 | [04-order.approved-paths.txt](04-order.approved-paths.txt) |
| Staff Frontend/BFF | 74 | [05-staff-frontend.approved-paths.txt](05-staff-frontend.approved-paths.txt) |
| QA tooling/test/báo cáo | 12 | [06-qa.approved-paths.txt](06-qa.approved-paths.txt) |
| Tổng | **186** | Thêm hunk CSS Staff và bộ tài liệu handoff riêng |

[FILES.csv](FILES.csv) giữ inventory gốc 197 dòng: 186 file READY/APPROVED; CSS READY_HUNK_ONLY/APPROVED; hai governance HOLD và tám EXCLUDE. [APPROVED_STAGE.csv](APPROVED_STAGE.csv) ràng buộc 186 FILE và một HUNK bằng nội dung/hash/nguồn xác nhận. `.review-paths.txt`, `.ready-paths.txt` và `.approved-paths.txt` của sáu nhóm hiện cùng 186 file; không dùng list toàn-file để lấy CSS. List [07-handoff.approved-paths.txt](07-handoff.approved-paths.txt) chỉ quản lý tài liệu của đợt bàn giao, ngoài 186.

## Patch đã chọn và phần giữ nguyên

Đã áp dụng đúng sáu tài liệu trong [BACKEND_DOC_PROPOSALS.md](BACKEND_DOC_PROPOSALS.md): Auth README và docs/staff-integration; Staff README, docs/order-handoff-checklist và order-service-contract; Order README. Chỉ cập nhật tiến độ/evidence và mốc lịch sử, không thay DTO/endpoint/schema/nghiệp vụ. Patch gốc được giữ để truy vết; không apply lần nữa.

[CSS Staff](STAFF_HUNKS.md): chỉ chọn **57 dòng thêm** từ patch, không chọn 13 dòng Admin. Working tree vẫn giữ đủ 70 dòng có trước; không viết lại file để bỏ Admin. `portal.tsx` không cần cho Staff app mới và không stage.

Các file ngoài staging được giữ nguyên: root `AGENTS.md`, `BACKEND_TEAM_RULES .md`; Staff/Admin `next-env.d.ts`; Staff `AGENTS.md`, `CLAUDE.md`; `frontend/docs/LOGIN_UI.md`; Customer `customer-auth.tsx`; `portal.tsx`; output `tatus`. Tên rule thực có khoảng trắng trước `.md`, không tự đổi tên. Không sửa source nghiệp vụ hoặc localStorage/MySQL.

## Bảo mật và kiểm thử

Bốn `.gitignore` Auth/Staff/Order/Staff Frontend phải được stage cùng source. Không đưa `.env` thật, session/JWT/cookie/key/vault, secrets, dump/backup hoặc bất kỳ `.auth-data/**` nào vào index. Dữ liệu mã hóa vẫn nhạy cảm. Vị trí private tùy chỉnh ngoài các thư mục đã ignore cần rule phù hợp, không dùng `git add -f`.

Đã xử lý đúng **147 cảnh báo trong11 file** theo quyền sửa whitespace của người dùng: hai SQL giữ nguyên mọi dòng có nội dung; tám file Staff chỉ bỏ blank EOF; artifact patch chuyển sang zero-context với chứng minh kết quả sáu file không đổi. Raw `git diff --cached --check` cuối **PASS, exit 0, không còn warning**, không dùng exemption/config nới check. Xem [WHITESPACE_REVIEW.md](WHITESPACE_REVIEW.md), [SQL proof](SQL_WHITESPACE_PROOF.md) và [patch proof](PATCH_FORMAT_PROOF.md). Bản patch mới bắt buộc `--unidiff-zero` và guard đủ image; không apply lại vào tài liệu đã cập nhật.

| Kiểm tra mới của lượt staging | Kết quả |
| --- | --- |
| Auth / Staff / Order unit | 46 / 99 / 72 PASS |
| QA-data unit SQL double | 12 PASS |
| Frontend unit + relay/backup | 328 PASS; lặp lại cùng bộ trên bản sao nội dung được chọn cũng PASS, không cộng hai lần |
| Tổng các ca unit khác nhau | **557 PASS, 0 FAIL, 0 SKIP** |
| Typecheck Staff/Customer/Admin trên bản sao nội dung được chọn | Cả ba PASS |
| Build Staff production trên bản sao cùng ổ E | PASS |
| Thử build bản sao TEMP ổ C, dependencies ổ E | FAIL môi trường đường dẫn webpack; đã khắc phục bằng bản sao cùng ổ, không sửa source/dependency |
| HTTP/MySQL thật và workflow Q01–Q06 | NOT_RUN trong lượt staging, không tái tiêu thụ fixture |

Chi tiết: [BACKEND_VALIDATION.md](BACKEND_VALIDATION.md), [FRONTEND_VALIDATION.md](FRONTEND_VALIDATION.md), [FINAL_SECURITY_REVIEW.md](FINAL_SECURITY_REVIEW.md). Bản kiểm tra chứa HEAD + 186 file đã duyệt + CSS Staff, không lấy Portal/Customer/Admin đang sửa dở; sau staging phải đối chiếu code trong index với bản đã build. Artifact review/build chỉ lưu ở thư mục private bị ignore, không thuộc PR.

[Bằng chứng nghiệm thu cũ](../../apps/staff/docs/UC12_E2E_QA_REPORT.md) vẫn là **43 nhóm E2E local PASS** và lớp riêng **90 HTTP PASS + 1 SKIP UC11** qua ranh ngày. Không gọi 557 unit là E2E, không biến SKIP thành PASS. Q01–Q06, `9109131` và `9109141` đã COMPLETED; không chạy lại/reset. Production, HTTPS/Secure cookie thực, tải lớn, đa replica và crash/power-loss thực chưa kiểm chứng.

## Sau khi xem staging

Remote GitHub đã được kiểm tra: **main 3e90f13 đã merge baseline afc5d78 qua PR #1**, hai cây file giống hệt; cảnh báo kéo272 file chỉ còn áp dụng khi so với origin/main local cũ898b65c. Không fetch/update refs dự án hoặc thay lịch sử. Đề xuất sáu head vào integration/uc9-uc12 được tạo từ main đã xác minh, rồi PR tổng vào main; xem PR_SPLIT_PLAN.md. Tên nhánh mới là đề xuất chờ người dùng chọn, chưa tạo branch/worktree.

[GIT_STEPS.md](GIT_STEPS.md) có lệnh kiểm tra hiện tại và lệnh tương lai trong worktree từng owner. Không commit toàn bộ index tổng hợp rồi gọi là sáu commit riêng. Người dùng phải xác nhận staged diff, lựa chọn head/base và cho phép bước tiếp theo trước commit/push/tạo Draft. Các body PR chỉ là bản chuẩn bị, chưa publish.
