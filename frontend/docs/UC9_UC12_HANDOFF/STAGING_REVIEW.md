# CleanHome — staging sau sửa whitespace và kiểm tra remote

Ngày kiểm tra: 25/10/2026, giờ Việt Nam. HEAD afc5d78 và branch feat/cleanhome-frontend giữ nguyên. Không commit, push, tạo PR, merge, checkout/rebase/cherry-pick hoặc reset; không sửa MySQL/QA và không chạy lại Q01–Q06.

Nguồn nhóm đồng ý bàn giao vẫn là **nhóm xác nhận qua người điều phối, chưa đính kèm bằng chứng riêng**. Người dùng tiếp tục cho phép sửa định dạng thuần túy, không phải thay nghiệp vụ hoặc mở rộng file ngoài scope.

## Danh sách staging hiện tại

**235 đường dẫn = 186 file toàn bộ + một CSS theo hunk + 48 file handoff.** Tăng ba đường dẫn so với232 trước đó chỉ do thêm SQL_WHITESPACE_PROOF.md, PATCH_FORMAT_PROOF.md và WHITESPACE_REVIEW.md. [STAGING_FILES.csv](STAGING_FILES.csv) ghi từng đường dẫn; list07 cập nhật đúng48 tài liệu, không ép giữ tổng cũ.

| Nhóm | Đường dẫn |
| --- | ---: |
| Auth | 27 |
| Schema/seed nguồn | 4 |
| Staff Backend | 42 |
| Order Backend | 27 |
| Frontend Staff, gồm một CSS chỉ lấy hunk | 75 |
| QA tooling/test/báo cáo | 12 |
| Tài liệu bàn giao | 48 |
| Tổng | **235** |

## Whitespace và nội dung được bảo toàn

[WHITESPACE_REVIEW.md](WHITESPACE_REVIEW.md) liệt kê đúng11 file và147 cảnhbáo gốc. Đã xử lý **147/147, còn0**; raw **git diff --cached --check PASS, exit 0** không exemption hoặc thay core.whitespace.

- HaiSQL: mỗi file bỏ space trên35dòng trống ngoài literal/comment và một blank EOF. Giữ nguyên mọi dòngSQL có nội dung,32 bảng và124 dòng khóa; không chạySQL hoặc sửa seed/transaction.
- TámfileStaff: chỉ bỏ một dòng trống cuối, giữ đúng một newline và pattern.gitignore. BảyfileTS/MJS có AST trước/sau giống nhau; bốn MJS syntaxcheck PASS.
- Artifact patchBackend: zero-context hợp lệ thay context có space, không cắt cú pháp. Cùng kết quả sáu file đã áp dụng; forward/reverse trong scratch khớp byteGitLF. Bản mới28 hunk,74 thêm/25 bỏ, triệt tiêu một cặp dòng trống so với bản gốc21 hunk 75/26. **Phải dùng --unidiff-zero và guard pre/postimage** ở [PATCH_FORMAT_PROOF.md](PATCH_FORMAT_PROOF.md), không apply lại vào sáu tài liệu thật.

Sáu Backend docs đã được cập nhật ở lượt trước vẫn giữ nguyên trong lượt formatting. Source/schema chỉ thay định dạng trong mười file đã duyệt; FILES.csv và APPROVED_STAGE.csv cập nhật hash, không bịa owner review mới. [SQL proof](SQL_WHITESPACE_PROOF.md) và proofAST trong TEMP giải thích mức an toàn.

**CSS không thay đổi:** index vẫn57 dòngStaff, working tree vẫn còn13 dòng Admin; không stage portal.css toàn file. BlobCSS và hashworking giữ nguyên. Portal.tsx, Customer auth, hai next-env.d.ts, rootAGENTS/rule, StaffAGENTS/CLAUDE, LOGIN_UI.md vàtatus đều giữ nguyên, ngoài index. Không xóa file hoặc dữ liệu chưa commit.

## Kiểm tra chất lượng và bảo mật

| Lượt sửa whitespace | Kết quả |
| --- | --- |
| Auth core/http/ui unit | **55 PASS,0 FAIL,0 SKIP** |
| Staff typecheck bản sao cô lập đã cập nhật | PASS |
| Node --check bốn MJS | 4 PASS |
| SQL/AST/patch equivalence | PASS |
| Raw staged whitespace | PASS,0 warning |
| Secret/private/generated path scan, manifest và CSS | PASS trong phạm vi dò; bốn.gitignore vẫn staged |
| Toàn557unit, Customer/Admin typecheck, Staffbuild | Không chạy lại toàn bộ; kết quảPASS trước đó và proof nội dung thực thi không đổi được giữ riêng |
| HTTP/JWT/MySQL/browser/Q01–Q06 ghi thật | NOT_RUN |

Không cộng55 test lặp vào557 ca khác nhau. Evidence cũ riêng:43 E2E local PASS và90 HTTP PASS + 1 SKIP UC11 qua ranh ngày. Production/HTTPS/tải lớn/crash thực vẫn chưa kiểm chứng. [FINAL_SECURITY_REVIEW.md](FINAL_SECURITY_REVIEW.md) giữ audit trước và cập nhật chỉ mục sau formatting; scan không chứng minh toàn lịch sử Git sạch.

## Kết quả base/head mới, quan trọng hơn cảnh báo lịch sử cũ

Remote GitHub main hiện được kiểm tra là **3e90f134fc9e344d6750280e6a0ce8abbf9290d5**, merge PR #1 từ featureafc5d78. Merge-base main thật/feature làafc5d78; tree cả hai bằng **e4c723759a24ec2cd181f311548005c0f87f4343**. Không có commit riêng của feature so với main thật; main hơn một merge commit không đổi nội dung so với baseline.

**272 file frontend nền đã có trên main GitHub.** Origin/main local vẫn898b65c do không cập nhật refs dự án. Kết luận trước đây rằng PR vào main kéo267 đường dẫn nền ngoài handoff chỉ áp dụng với ref local cũ, không với main thật hiện tại. Do treegiốngnhau, diff index tới main thật chỉ là235 đường dẫn handoff, không kéo lại272 file nền. Nếu main thay đổi trước publish, kiểm tra lại overlap.

Lịch sử được tải vào kho audit TEMP riêng, không fetch vào repo dự án, không đổi refs/index/workingtree để đọc remote. Không chỉnh global safe.directory hoặc cấu hình whitespace. Chưa tạo nhánh tích hợp/worktree, chưa kiểm tra branch-protection/CI trên GitHub.

## Sáu PR owner và dependency đề xuất

Base chung đề xuất **integration/uc9-uc12**, tạo từ main đã xác minh3e90f13 sau khi người dùng chốt phương án; tên này chưa tồn tại và chưa tự coi là quyết định đã được nhóm phê duyệt.

| Thứ tự | Head | Phạm vi | Body |
| --- | --- | --- | --- |
| 1A | handoff/staff-test-schema | 4 SQL nguồn, không thực thi | [02](pull_requests/02-database.md) |
| 1B | handoff/auth-staff-rs256 | 27 fileAuth, review song song schema | [01](pull_requests/01-auth.md) |
| 2 | handoff/order-staff-transitions | 27 fileOrder, sau provider/schema cần thiết | [04](pull_requests/04-order.md) |
| 3 | handoff/staff-uc9-uc12 | 42 fileStaff, sauAuth/Order/schema | [03](pull_requests/03-staff.md) |
| 4 | handoff/staff-bff-uc9-uc12 | 74 file+CSS57, sauBackend | [05](pull_requests/05-staff-frontend.md) |
| 5 | handoff/uc12-qa-and-handoff | 12 QA + 48 handoff = 60 file, sau tất cả provider/Frontend | [06](pull_requests/06-qa.md) |

Mỗi head được tạo từ tip integration sau dependency đã merge. Sau sáu PR, PR integration→main được review như tổ hợp hoàn chỉnh; không thiếu tài liệu handoff. Crosslink Markdown tới báo cáo/contract ởPRkhác phải ghi nhận tạm thời, kiểm tra đủ khi ghép; không fakeAPI hoặc âm thầm bỏ CI. Nếu nhóm chọn sáu PR thẳng vào main, dùng cùngbaseline đãmergeFrontend và cùngthứtựdependency; đó là phương án khác cần chốt, không phải lý do tự thay nhánh hiện tại.

[PR_SPLIT_PLAN.md](PR_SPLIT_PLAN.md) và [GIT_STEPS.md](GIT_STEPS.md) ghi rõ lệnh chỉ đọc, lệnh tương lai chưa chạy, kiểm tra overlap và quyền từng bước. Giữ workspace/index này để người dùng review; sau khi được cho phép mới tạo worktree riêng và chuyển đúng blob/hunk index theoallowlist. Nếu base đã có thay đổi cùngfile bởi người khác, dừng ghép/review thay vì ghi đè.

## Có thể làm gì tiếp

Staging đã sạch về whitespace/scope và rà soát secret, có proof/test phù hợp. Đủ điều kiện kỹ thuật để người dùng xác nhận danh sách và cho phép chuẩn bị commit theo owner; **chưa có quyền tự commit/push/tạo PR**. TrướcDraft cần chốt nhánh integration hoặcmain, tạohead/worktree sạch, cập nhậtremoteRefs có kiểm soát, kiểm tra diff/CI từngPR và dependency. Không tạoPRnhầm từref localmain cũ hoặc dùng mộthead giảtách sáu PR.

**Dừng trước commit/push.** Những bước đã chạy chỉ là sửa định dạng, cập nhật tài liệu/hash và kiểm tra/staging trong phạm vi đã duyệt; mọi thay đổi ngoài scope và dữ liệu người dùng được bảo toàn.
