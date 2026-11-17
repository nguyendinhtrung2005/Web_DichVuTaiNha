# CleanHome — rà soát tài liệu và context AI

> Ghi chú xuất bản: đây là snapshot rà soát working tree gốc ngày 25/10/2026. Các số 85→87, 235 staged paths, 13 dòng CSS Admin và số đo 1.198 từ thuộc mốc rà soát đó, không mô tả trạng thái worktree sạch hoặc toàn bộ file đã có trên GitHub. PR tài liệu chỉ thêm hai file; không áp dụng proposal AGENTS, không xuất bản file governance local và không xóa/di chuyển archive. Bản xuất bản chỉnh chỉ dẫn tới tài liệu governance được cung cấp riêng để tránh link hỏng; các số đo lịch sử được giữ nguyên.

Ngày kiểm kê: 25/10/2026. Đây là báo cáo theo yêu cầu tinh gọn; chỉ đọc khi review thay đổi tài liệu, không phải context mặc định cho nhiệm vụ Staff. Điểm bắt đầu ngắn là [STAFF_DEVELOPMENT_GUIDE.md](STAFF_DEVELOPMENT_GUIDE.md).

## Việc thực hiện và giới hạn

Chỉ tạo hai tài liệu mới: hướng dẫn Staff và báo cáo này. Không sửa, xóa hoặc chuyển bất kỳ file cũ nào; không đổi AGENTS, quy tắc nhóm, Backend, API contract, schema, test, QA hay cấu hình. Không stage/commit/push/merge, không chạy service hoặc MySQL.

Workspace vẫn ở `feat/cleanhome-frontend`, HEAD `afc5d78`; có 235 đường dẫn staged và 13 dòng CSS Admin unstaged. PR #2–#7 đã vào `integration/uc9-uc12` ở mốc `f38ea50709c3d2fc82c82715e703ce73c84324bb` theo nghiệm thu trước đó; không suy ra đã vào `main`, không đổi branch để làm tài liệu.

Inventory lấy các `.md/.txt/.csv/.patch` nhìn thấy bởi `rg --files --hidden`, giữ quy tắc ignore; loại dependency, `.git`, build output, `.auth-data` và secrets. Không duyệt dữ liệu private để tiết kiệm context. Báo cáo QA Markdown thuộc inventory; artifact QA riêng ngoài Git chỉ được ghi nhận cần bảo vệ, không mở hoặc di chuyển.

| Nhóm chính | Trước | Sau hai tài liệu mới | Hành động |
| --- | ---: | ---: | --- |
| KEEP | 32 | 34 | Giữ nguyên file cũ; thêm hai tài liệu |
| CONSOLIDATE | 5 | 5 | Tổng hợp phần vận hành vào guide, giữ bản chi tiết |
| ARCHIVE_CANDIDATE | 48 | 48 | Chỉ đề xuất, chưa di chuyển |
| DELETE_CANDIDATE | 0 | 0 | Chưa có file đủ điều kiện đề nghị xóa |
| Tổng | **85** | **87** | Chưa giảm số file vật lý |

PROTECTED là lớp bổ sung, không cộng vào tổng: **84/85 file cũ** có thay đổi chưa commit, ownership, tham chiếu hoặc bằng chứng cần bảo vệ. Trong mẫu kiểm kê, chỉ `MIGRATION_CLEANHOME.md` không có các dấu hiệu bảo vệ bổ sung đó; file này vẫn KEEP. Hai tài liệu mới cũng chưa commit. Số file tăng hai để tạo điểm đọc ngắn và hồ sơ quyết định; chưa gọi đây là đã dọn archive hoặc đã thay đổi cách AI tự nạp context.

## KEEP — danh sách đủ 32 file cũ

Mỗi hàng liệt kê chính xác các hậu tố dưới thư mục; `{admin,customer,staff}` là ba vị trí khác nhau.

| Thư mục | File giữ tại vị trí hiện tại | Số |
| --- | --- | ---: |
| Repository | `AGENTS.md`, `BACKEND_TEAM_RULES .md`, `README.md`, `MIGRATION_CLEANHOME.md` | 4 |
| `backend/auth-service/` | `README.md`, `docs/auth-contract.md`, `docs/staff-integration.md` | 3 |
| `backend/order-service/` | `README.md`, `docs/staff-integration.md` | 2 |
| `backend/staff-service/` | `README.md`, `docs/auth-contract.md`, `docs/auth-handoff-checklist.md`, `docs/auth-integration.md`, `docs/http-integration-testing.md`, `docs/multi-employee-testing.md`, `docs/order-handoff-checklist.md`, `docs/order-service-contract.md`, `docs/test-data.md` | 9 |
| `frontend/` | `README.md` | 1 |
| `frontend/apps/{admin,customer,staff}/` | `AGENTS.md`, `CLAUDE.md` ở mỗi app | 6 |
| `frontend/apps/staff/docs/` | `UC12_E2E_QA_REPORT.md` | 1 |
| `frontend/docs/` | `ADMIN_UI_PHASE3.md`, `CUSTOMER_UI_PHASE2.md`, `FRONTEND_UNIFICATION_PHASE4.md`, `LOGIN_UI.md`, `STAFF_UI_PHASE3.md`, `THREE_WEBSITES_RESTORE.md` | 6 |

Toàn bộ source, unit/integration/E2E test, schema, seed, migration và script đang dùng cũng KEEP; chúng không nằm trong mẫu số 85 tài liệu. Không có đề xuất bỏ chúng. Contract và bằng chứng không trở thành dư thừa chỉ vì có guide.

Các README còn câu cũ về Vite, email/localStorage hoặc chưa có Backend; giữ nguyên theo ownership, chờ owner cập nhật đoạn tiến độ và link sang guide. `MIGRATION_CLEANHOME.md` là lịch sử, không phải lý do chạy migration. File rule thực có khoảng trắng trước `.md`; không tự rename. Các app AGENTS/CLAUDE giống byte nhưng vẫn giữ riêng theo scope; block Next.js được công cụ sinh lại, không gỡ để giảm file.

## CONSOLIDATE — năm tài liệu

Giữ nguyên tại `frontend/apps/staff/docs/`: `AUTH_INTEGRATION.md`, `UC9_INTEGRATION.md`, `UC10_INTEGRATION.md`, `UC11_INTEGRATION.md`, `UC12_INTEGRATION.md`.

Guide mới tổng hợp các phần lặp: kiến trúc, API mapping, phone/JWT/phiên, quyền A/B, trạng thái/idempotency, cấu hình không secret, lệnh chạy và unit/typecheck/build. Chi tiết DTO, validation, lỗi, test và lịch sử vẫn trỏ về bản gốc. Không sao chép toàn bộ báo cáo hoặc thay contract bằng bản rút gọn.

Các câu “chưa làm bước tiếp” trong báo cáo từng giai đoạn là lịch sử. Đầu UC12 đã cập nhật 43 E2E PASS; các bảng NOT_RUN phía dưới giữ mốc trước QA. Không xóa bảng lịch sử hoặc hiểu chúng là kết quả hiện tại. Đề xuất owner thêm chỉ dẫn đọc ở đầu năm file sau khi duyệt; lượt này chưa áp dụng.

## ARCHIVE_CANDIDATE — đủ 48 file handoff

Tất cả ở `frontend/docs/UC9_UC12_HANDOFF/`. Đây là ứng viên **archive sau phê duyệt**, không phải cho phép xóa hoặc áp dụng lại patch. Cả 48 file đều có tham chiếu từ tài liệu khác, nhiều file còn nằm trong staging gốc.

| Nhóm | Danh sách chính xác | Số |
| --- | --- | ---: |
| Allowlist | Mỗi tiền tố `01-auth`, `02-database`, `03-staff`, `04-order`, `05-staff-frontend`, `06-qa` có cả ba hậu tố `.approved-paths.txt`, `.ready-paths.txt`, `.review-paths.txt`; `07-handoff` chỉ có `.approved-paths.txt`, `.ready-paths.txt` | 20 |
| Staging/inventory | `APPROVAL_APPLICATION.md`, `APPROVED_STAGE.csv`, `FILES.csv`, `STAGING_FILES.csv`, `STAGING_REVIEW.md` | 5 |
| Phê duyệt và hunk | `BACKEND_DOC_PROPOSALS.md`, `OWNER_APPROVALS.md`, `OWNER_REVIEW_MESSAGE.md`, `STAFF_HUNKS.md` | 4 |
| Validation/security/whitespace | `BACKEND_VALIDATION.md`, `FRONTEND_VALIDATION.md`, `FINAL_SECURITY_REVIEW.md`, `SECURITY_REVIEW.md`, `WHITESPACE_REVIEW.md`, `SQL_WHITESPACE_PROOF.md`, `PATCH_FORMAT_PROOF.md` | 7 |
| Kế hoạch/body tổng | `README.md`, `GIT_STEPS.md`, `PR_DESCRIPTION.md`, `PR_SPLIT_PLAN.md` | 4 |
| Patch lịch sử | `proposals/backend-docs-update.patch`, `proposals/staff-login-css-only.patch` | 2 |
| Body theo owner | `pull_requests/01-auth.md`, `02-database.md`, `03-staff.md`, `04-order.md`, `05-staff-frontend.md`, `06-qa.md` — cả sáu dưới `pull_requests/` | 6 |

Bảy cặp approved/ready trùng byte. Sáu review list có cùng đường dẫn và thứ tự nhưng khác LF/CRLF; không có review list số 07. Giống nội dung không đồng nghĩa vai trò audit giống nhau; không tự xóa ready/review hoặc thay CSV hash.

Phương án chờ duyệt: chọn một commit integration bất biến làm nguồn lịch sử; nếu nhóm cần archive trong working tree, chuyển **cả bộ** theo một danh sách được duyệt, cập nhật tất cả link vào/ra và chỉ dẫn đọc. Không sao chép thêm 48 bản sang archive rồi giữ bản cũ. Nếu chỉ lưu trong Git history, phải có index tới commit/path và xác nhận quy trình hiện tại không còn cần các allowlist/patch/CSV tại đường dẫn cũ. Không dùng lịch sử Git thay cho backup dữ liệu QA private.

## PROTECTED và DELETE_CANDIDATE

- Giữ nguyên 235 staged paths, toàn bộ unstaged/untracked có trước, đặc biệt root AGENTS, rule có khoảng trắng, Customer auth, `portal.tsx` và CSS Admin. Không lấy snapshot cũ ghi đè file đang sửa.
- Tài liệu Backend thuộc Auth/Staff/Order và contract giữa owner vẫn được bảo vệ; không cập nhật theo suy đoán hoặc gắn tên reviewer giả.
- QA Markdown, journal, backup, manifest và artifact private cần truy vết được giữ nguyên, kể cả dữ liệu mã hóa. Không đưa `.env`, token, cookie, key hoặc `.auth-data` vào docs/context/Git.
- `tatus` là file untracked không thuộc 85 tài liệu, 19.207 byte/274 dòng, có ANSI; chưa đủ bằng chứng về nguồn và giá trị. Để PROTECTED chờ kiểm tra thủ công, chưa xếp DELETE_CANDIDATE.
- Không có danh sách xóa được duyệt hoặc lệnh xóa trong lượt này. Không đụng placeholder `.gitkeep` hoặc file rỗng chỉ vì chúng rỗng.

## Đề xuất AGENTS — chưa áp dụng

Root `AGENTS.md` đang có 11 dòng bổ sung chưa commit của lượt trước; ownership/governance chưa mở cho thay đổi mới. Bản diff dưới đây chỉ đề xuất cho owner xem. Nó giữ yêu cầu đọc toàn bộ quy tắc nhóm khi sửa Backend/database/contract/integration, chỉ làm rõ cách chọn context khác. Không biến guide thành nguồn thay thế contract hoặc bỏ kiểm tra an toàn. Không tự sửa child AGENTS/CLAUDE do Next.js tạo.

```diff
diff --git a/AGENTS.md b/AGENTS.md
index f3b653c..e63dfb1 100644
--- a/AGENTS.md
+++ b/AGENTS.md
@@ -44 +44 @@ Before modifying backend, database, API contracts,
-or integration code, read and follow BACKEND_TEAM_RULES.md.
+or integration code, read and follow the actual BACKEND_TEAM_RULES .md file.
@@ -51 +51,8 @@ Do not overwrite teammates' changes or automatically
-commit, push, merge or run destructive database commands.
\ No newline at end of file
+commit, push, merge or run destructive database commands.
+
+## Focused context
+- For Staff auth or UC9-UC12, start with frontend/docs/STAFF_DEVELOPMENT_GUIDE.md; open detailed docs only for the task.
+- Read only the affected service and interacting API contracts. Keep mandatory team rules and owner approvals in force.
+- Do not bulk-read handoff allowlists, archived reports or QA history by default. Do not scan all frontend/backend for a one-service task.
+- Do not load or print .env, tokens, sessions, keys or backups without a necessary, authorized task; prefer config names and safe templates.
+- Run relevant tests first; broaden for shared behavior or integration. Keep ownership, unfinished work and Git restrictions above.
```

Diff dùng zero-context để tránh khoảng trắng cú pháp trong báo cáo; lượt này chỉ chạy `git apply --check --unidiff-zero --whitespace=error`, không áp dụng.

Sau khi owner duyệt, áp dụng đúng hunk trên **nội dung working hiện tại**, kiểm tra lại thay đổi của đồng đội; không tự thay bằng HEAD. Trước đó AI vẫn làm theo AGENTS/rule hiện có; hướng dẫn ngắn chỉ là điểm đọc được đề nghị trong nhiệm vụ thích hợp.

## Đo lượng đọc

Đếm bằng tách khoảng trắng, gồm Markdown; đây không phải số token của tokenizer Codex/Claude và không đo nội dung thực tế đã nạp trong mỗi phiên.

| Gói nội dung | Số đơn vị từ |
| --- | ---: |
| 85 tài liệu ban đầu | 132.216 |
| Handoff 48 file, không nên đọc mặc định | 45.362 |
| Năm tài liệu Frontend integration | 18.715 |
| Root AGENTS + quy tắc nhóm bắt buộc theo phạm vi | 6.298 |
| Guide mới | 1.198 |

So phần nhập môn năm tài liệu với guide: **18.715 → 1.198, giảm khoảng 93,6%**. Nếu một nhiệm vụ Staff trước đây mở cả năm tài liệu và governance, gói so sánh là **25.013 → 7.496, giảm khoảng 70,0%**; vẫn phải cộng source/contract/test liên quan khi cần. Đây là kịch bản tham khảo, không phải cam kết giảm token cho mọi nhiệm vụ. AGENTS chưa được thay nên chưa có tối ưu bắt buộc ở cơ chế tự đọc.

## Kiểm tra và việc cần duyệt

Kiểm kê ban đầu không có link Markdown cục bộ hỏng. Tìm literal tên tài liệu trong source/test/script/package của ba service, Staff app và component Staff không thấy phụ thuộc; không có `.github` trong workspace. Không xem đó là chứng minh không có tham chiếu động, CI bên ngoài hoặc quy trình thủ công của đồng đội. Danh sách protected còn tính cả liên kết và tham chiếu literal giữa docs.

Lượt này chỉ kiểm tra link/file đích, cú pháp lệnh với package scripts, whitespace/secret của tài liệu mới và hash/status/index trước/sau. Kết quả đạt: 15 link Markdown cục bộ hợp lệ; hai tài liệu mới không có lỗi whitespace hoặc chữ ký secret theo mẫu dò; `git diff --cached --check` exit 0; proposal AGENTS kiểm tra áp dụng được nhưng chưa áp dụng. Hash 557 file có trước, index từng byte, branch/HEAD và 235 staged paths không đổi; CSS Admin vẫn thêm 13 dòng unstaged. URL GitHub chỉ kiểm tra cú pháp, không gọi mạng lại trong lượt này.

Không chạy build/test ứng dụng cho thay đổi chỉ gồm tài liệu; không lặp 557 unit, HTTP hoặc Q01–Q06. Kết quả kiểm thử đã ghi ở guide là evidence của lượt nghiệm thu, không phải vừa chạy lại.

Các quyết định còn chờ:

1. Owner governance duyệt diff AGENTS và việc điều hướng qua guide; giữ nguyên rule nhóm và tên file thực tế đến khi có quyết định riêng.
2. Owner Auth/Staff/Order/Frontend duyệt chỉ dẫn mới trong README/tài liệu cũ nếu muốn cập nhật; không sửa trong lượt này.
3. Nhóm duyệt 48 ứng viên archive, vị trí/index lịch sử và danh sách link phải đổi; kiểm tra script, CI ngoài repo và người dùng thủ công trước khi di chuyển.
4. Xác định nguồn gốc `tatus` trước khi cân nhắc xóa. Phê duyệt archive không tự cho phép xóa dữ liệu QA hoặc xóa file khác.

Hai tài liệu mới chưa stage. Bộ handoff và các thay đổi cũ được giữ nguyên để người điều phối tự review; không có commit, push, merge hoặc thay đổi dữ liệu.
