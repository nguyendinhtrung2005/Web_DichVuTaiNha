# Whitespace và base/head: kiểm tra trước commit

Ngày kiểm tra: 25/10/2026, giờ Việt Nam. Người dùng cho phép sửa định dạng thuần túy trong phạm vi đã duyệt. Không đổi nghiệp vụ, schema/seed/transaction, dữ liệu QA/MySQL hoặc lịch sử Git; không commit/push/tạo PR.

## Đúng 11 file, 147 cảnh báo ban đầu

| File | Cảnh báo ban đầu | Nguyên nhân | Xử lý |
| --- | ---: | --- | --- |
| `databases/schema.sql` | 36 | 35 dòng trống có space và một blank-at-EOF | Bỏ space trên đúng dòng trống ngoài literal/comment và một dòng cuối thừa |
| `databases/schema_staff_test.sql` | 36 | Cùng nguyên nhân | Cùng thay đổi thuần định dạng |
| `frontend/apps/staff/.gitignore` | 1 | Blank-at-EOF | Bỏ một dòng trống cuối, giữ newline cuối và mọi pattern |
| `frontend/apps/staff/app/api/auth/login/route.ts` | 1 | Blank-at-EOF | Chỉ bỏ dòng trống cuối |
| `frontend/apps/staff/app/api/auth/logout/route.ts` | 1 | Blank-at-EOF | Chỉ bỏ dòng trống cuối |
| `frontend/apps/staff/app/api/auth/session/route.ts` | 1 | Blank-at-EOF | Chỉ bỏ dòng trống cuối |
| `frontend/apps/staff/lib/server/auth-http.mjs` | 1 | Blank-at-EOF | Chỉ bỏ dòng trống cuối |
| `frontend/apps/staff/scripts/init-auth.mjs` | 1 | Blank-at-EOF | Chỉ bỏ dòng trống cuối, không chạy initializer |
| `frontend/apps/staff/test/auth-browser.integration.mjs` | 1 | Blank-at-EOF | Chỉ bỏ dòng trống cuối, không chạy browser workflow |
| `frontend/apps/staff/test/auth-http.test.mjs` | 1 | Blank-at-EOF | Chỉ bỏ dòng trống cuối |
| `frontend/docs/UC9_UC12_HANDOFF/proposals/backend-docs-update.patch` | 67 | Space đầu dòng context trống là cú pháp unified diff | Tái biểu diễn thành zero-context hợp lệ, không cắt space làm hỏng patch |
| Tổng | **147** | 70 trailing space SQL + 10 blank-at-EOF + 67 context patch | **147 xử lý, 0 còn lại** |

Không chạy formatter toàn file hoặc nới quy tắc whitespace. Tám file Staff chỉ giảm một byte newline mỗi file, vẫn giữ đúng một newline cuối. Hai SQL chỉ thay blank lines đã được nêu; không sửa seed SQL. Artifact diff là tài liệu hỗ trợ, không thực thi nghiệp vụ.

## Chứng minh không thay đổi nội dung thực thi

- [SQL_WHITESPACE_PROOF.md](SQL_WHITESPACE_PROOF.md): các dòng SQL có nội dung giữ nguyên byte/thứ tự; vùng sửa nằm ngoài string, identifier và comment; cả hai file giữ 32 bảng và 124 dòng khóa/ràng buộc. Không chạy SQL hoặc kết nối MySQL.
- Bảy file TS/MJS có AST do TypeScript parse/print trước/sau giống nhau, không lỗi parse; phần trước EOF giữ nguyên. Pattern có nội dung của `.gitignore` giữ nguyên.
- [PATCH_FORMAT_PROOF.md](PATCH_FORMAT_PROOF.md): patch gốc và patch zero-context đều cho đúng sáu postimage Git LF; reverse trong scratch khôi phục đúng sáu preimage. Sáu tài liệu Backend thật giữ nguyên hash trong lượt này. Bản mới 28 hunk, 74 thêm/25 bỏ thay bản cũ 21 hunk, 75 thêm/26 bỏ; chỉ triệt tiêu một cặp dòng trống thêm/bỏ.
- Artifact mới bắt buộc **`--unidiff-zero` cùng guard đủ preimage/postimage**. Hash và lệnh an toàn ở proof; không apply thuận/đảo vào sáu tài liệu đã cập nhật. Không thêm `.gitattributes`, đổi core.whitespace hoặc tắt check để nhận PASS.

## Kiểm tra sau sửa

Raw `git diff --cached --check` sau cập nhật staging: **PASS, exit 0, không còn cảnh báo**. Không dùng path exclusion hoặc cấu hình miễn trừ. Kết quả được đối chiếu trực tiếp index; không chỉ dựa vào working diff.

| Kiểm tra lượt này | Kết quả |
| --- | --- |
| Auth unit tác động trực tiếp, core/http/ui | 55 PASS, 0 FAIL, 0 SKIP |
| Typecheck Staff trong bản sao cô lập đã cập nhật | PASS |
| Node --check cho bốn MJS đã sửa EOF | 4 PASS |
| SQL lexical/nonblank/key/table proof | PASS |
| Patch forward/reverse và hash image trong scratch | PASS |
| Build toàn Frontend, Customer/Admin typecheck mới, toàn bộ 557 unit | NOT_RUN lại; chỉ sửa whitespace, AST/SQL giữ nguyên; bằng chứng trước đó được giữ riêng |
| HTTP/MySQL/browser/Q01–Q06 ghi thật | NOT_RUN; không dùng lại fixture COMPLETED |

Không cộng 55 test chạy lại vào 557 test khác nhau của lượt trước. Production, HTTPS, tải lớn và crash thật vẫn chưa kiểm chứng.

## Staging và bảo toàn

Danh sách tăng **232 → 235 đường dẫn**, chỉ thêm ba tài liệu chứng minh: SQL_WHITESPACE_PROOF.md, PATCH_FORMAT_PROOF.md và file này. Nhóm source toàn-file vẫn 186, CSS vẫn một hunk; handoff 45 → 48. STAGING_FILES.csv và hai list 07 được cập nhật, không ép giữ số 232.

CSS không sửa trong lượt này: cached vẫn 57 dòng Staff, unstaged vẫn 13 dòng Admin; blob index và hash working CSS giữ nguyên. Portal.tsx, Customer auth, generated/governance và các file EXCLUDE giữ nguyên; không .env thật, JWT/session/key/backup hoặc `.auth-data` trong index. Bốn `.gitignore` vẫn staged; file Staff chỉ bỏ blank EOF, không đổi rule.

FILES.csv/APPROVED_STAGE.csv cập nhật hash của đúng mười file toàn bộ đã sửa định dạng, giữ nguồn phê duyệt qua người điều phối. Cột formatting_reference ghi quyền sửa whitespace của người dùng, không tự bịa owner phê duyệt mới. Sáu tài liệu Backend đã cập nhật ở lượt trước không bị sửa lại; chỉ đổi biểu diễn artifact patch.

## Main thật đã có baseline Frontend

Đọc trực tiếp remote và lịch sử trong kho audit riêng ở TEMP cho thấy main GitHub hiện là **3e90f134fc9e344d6750280e6a0ce8abbf9290d5**, merge PR #1 từ featureafc5d78. Merge-base với feature là afc5d78; tree hai commit giống hệt **e4c723759a24ec2cd181f311548005c0f87f4343**. Local origin/main vẫn898b65c vì không fetch/update refs dự án.

Do đó 272 file Frontend nền đã nằm trên main thật; cảnh báo trước đây dựa trên ref local cũ không còn đúng cho main GitHub hiện tại. Với tree main và baseline bằng nhau, diff index tới main thật chỉ là phạm vi handoff, không kéo thêm 267 đường dẫn baseline ngoài manifest. Cần kiểm tra lại nếu main thay đổi trước publish.

[PR_SPLIT_PLAN.md](PR_SPLIT_PLAN.md) đề xuất sáu PR owner vào integration/uc9-uc12 được tạo từ main đã xác minh, rồi PR tổng tích hợp vào main. Tên integration/heads mới là đề xuất; chưa tạo branch/worktree hay tự nhận nhóm đã chọn. Thứ tự: schema/Auth có thể review song song → Order → Staff → Frontend → QA + toàn bộ handoff. Tạo head sau khi dependency đã có trong base, bảo vệ code đã merge.

## Đủ điều kiện tới đâu

Staged diff đã sạch về whitespace, scope và kiểm tra secret trong phạm vi dò; các thay đổi định dạng có chứng minh và test phù hợp. **Đủ điều kiện kỹ thuật để người dùng review và cho phép chuẩn bị commit theo owner**, không tự cấp quyền commit/push/tạo PR. Trước Draft cần chốt base/head/worktree, cập nhật refs có kiểm soát, kiểm tra diff từng PR và dependency. Workspace/index hiện tại được giữ nguyên để người dùng xem; dừng trước commit/push.
