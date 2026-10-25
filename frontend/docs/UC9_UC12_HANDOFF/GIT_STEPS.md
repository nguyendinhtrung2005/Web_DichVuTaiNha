# Git: dừng tại kiểm tra staging

Nhóm đã đồng ý đúng phạm vi handoff qua người điều phối, chưa đính kèm bằng chứng riêng. Lượt hiện tại được phép ghi phê duyệt, áp dụng sáu tài liệu và stage theo allowlist/hunk; **không được commit, push, tạo PR hoặc merge trước khi người dùng xem staging cuối**. Không reset, xóa, force-push, checkout hoặc đổi lịch sử.

Các nhóm đã ghi nhận trong FILES.csv / APPROVED_STAGE.csv: Auth27, SQL4, Staff42, Order27, Frontend74, QA12; CSS chỉ HUNK 57 dòng; tài liệu handoff ngoài 186. Mỗi file được stage theo list chính xác, không git add . / git add -A / git add -f. Bốn .gitignore đi cùng source.

## Kiểm tra ngay tại workspace hiện tại

```powershell
git branch --show-current
git rev-parse HEAD
git diff --cached --name-status
git diff --cached --stat
git diff --cached --check
git diff --cached -- frontend/packages/ui/src/portal.css
git diff -- frontend/packages/ui/src/portal.css
git status --short
```

Kỳ vọng CSS cached chỉ 57 dòng thêm; working diff còn 13 dòng Admin. Portal.tsx, Customer auth, next-env.d.ts, governance/tooling ngoài scope và tatus không staged. Danh sách chuẩn ở STAGING_FILES.csv, từng nhóm ở 01–07-*.approved-paths.txt. Không dùng dòng commit ví dụ để commit nguyên index tổng hợp.

Sáu Backend docs đã được áp dụng. Artifact hiện dùng zero-context để hết cảnh báo context-space; trước kiểm tra phải dùng hash guard preimage/postimage tại [PATCH_FORMAT_PROOF.md](PATCH_FORMAT_PROOF.md), rồi kiểm tra chỉ đọc bằng `git apply --unidiff-zero --reverse --check -- frontend/docs/UC9_UC12_HANDOFF/proposals/backend-docs-update.patch`. Không apply lại hoặc chạy reverse thực. CSS patch không đổi; working tree giữ nguyên Staff/Admin và index chỉ có57 dòngStaff.

## Thao tác staging đã được cho phép trong lượt này

Người tích hợp kiểm tra FILES.csv không drift, đủ approval qua người điều phối và index trống trước khi bắt đầu. Sáu list approved toàn-file cộng lại đúng186 file. List 07 chỉ có handoff. Stage theo list từng nhóm, rồi CSS bằng patch chỉ index:

```powershell
# Mẫu cùng lệnh đã dùng, không cần chạy lại nếu checkpoint đã khớp:
git --literal-pathspecs add --pathspec-from-file="frontend/docs/UC9_UC12_HANDOFF/01-auth.approved-paths.txt"
git --literal-pathspecs add --pathspec-from-file="frontend/docs/UC9_UC12_HANDOFF/02-database.approved-paths.txt"
git --literal-pathspecs add --pathspec-from-file="frontend/docs/UC9_UC12_HANDOFF/03-staff.approved-paths.txt"
git --literal-pathspecs add --pathspec-from-file="frontend/docs/UC9_UC12_HANDOFF/04-order.approved-paths.txt"
git --literal-pathspecs add --pathspec-from-file="frontend/docs/UC9_UC12_HANDOFF/05-staff-frontend.approved-paths.txt"
git --literal-pathspecs add --pathspec-from-file="frontend/docs/UC9_UC12_HANDOFF/06-qa.approved-paths.txt"
git --literal-pathspecs add --pathspec-from-file="frontend/docs/UC9_UC12_HANDOFF/07-handoff.approved-paths.txt"
# Chỉ khi index CSS còn đúng HEAD và --check đạt; không áp dụng lặp:
git apply --cached --check -- frontend/docs/UC9_UC12_HANDOFF/proposals/staff-login-css-only.patch
git apply --cached -- frontend/docs/UC9_UC12_HANDOFF/proposals/staff-login-css-only.patch
```

Nếu bất kỳ lệnh thất bại, dừng và kiểm tra; không chạy tiếp chuỗi mù, không tự reset index. Sau mỗi cập nhật tài liệu chỉ re-stage đúng file thuộc allowlist và kiểm tra cached lại. Các lệnh trên là staging, không cấp quyền commit hoặc publish. Mọi private `.auth-data`, .env thật, secrets/key/token/backup đều ngoài allowlist.

## Vì sao chưa commit trên branch hiện tại

Thông tin ref local cũ898b65c đã được đối chiếu với GitHub: **main thực tế3e90f13 đã merge PR #1 chứa baseline afc5d78**, hai tree giống hệt. Vì vậy272 file nền không bị kéo lại vào PR tới main thật. Local refs chưa đổi; lịch sử remote chỉ được tải vào kho audit TEMP. [PR_SPLIT_PLAN.md](PR_SPLIT_PLAN.md) đề xuất integration/uc9-uc12 từ main đã xác minh và sáu head theo owner, merge theo dependency; chưa tạo branch/worktree hoặc tự coi tên integration đã được nhóm chọn.

Sau khi người dùng duyệt checkpoint, cần chọn phương án Git cụ thể. Ưu tiên giữ nguyên workspace/index tổng hợp hiện tại, dùng worktree/clone riêng cho từng owner và mang đúng blob/hunk đã duyệt sang đó; không checkout/reset workspace chứa code nhóm. Chưa có worktree owner nào được tạo và chưa có commit nào của lượt này.

## Lệnh tương lai sau khi có quyền mới và worktree owner đã chuẩn bị

Mỗi worktree phải chỉ stage đúng nhóm của mình và đã kiểm tra base/dependency. Ví dụ Auth; thay placeholder bằng đường dẫn và base được nhóm chọn, không chạy nguyên mẫu trong workspace tổng hợp:

```powershell
git -C "<worktree-auth-da-duyet>" diff --cached --name-status
git -C "<worktree-auth-da-duyet>" diff --cached --check
git -C "<worktree-auth-da-duyet>" commit -m "feat(auth): provide phone login and RS256 Staff authentication"
git -C "<worktree-auth-da-duyet>" log --oneline "<base-da-duyet>..HEAD"
git -C "<worktree-auth-da-duyet>" diff --name-status "<base-da-duyet>...HEAD"
git -C "<worktree-auth-da-duyet>" push -u origin HEAD
gh pr create --draft --base "<base-da-duyet>" --head "handoff/auth-staff-rs256" --title "feat(auth): provide Staff phone login and RS256 tokens" --body-file "frontend/docs/UC9_UC12_HANDOFF/pull_requests/01-auth.md"
```

Các message/head/body cho năm nhóm khác nằm trong STAGING_REVIEW.md và thư mục pull_requests. QA commit nhận12fileQA cộng bộ tài liệu handoff; Frontend commit nhận74 file cộng CSS57 dòng. Tách commit không tạo sáu PR nếu vẫn dùng chung một head. Không push tổng hợp lên branch sẽ làm base trước khi tạo ownerPRs.

**Các lệnh commit/push/gh ở trên chưa được phép thực hiện trong lượt này.** Tạo Draft chỉ sau xác nhận staging và head/base. Ready for Review cần đúng phạm vi, checks của tổ hợp PR thực tế, secrets sạch, dependency và review contract/ownership cần thiết; phê duyệt qua người điều phối được ghi minh bạch, không tự tạo chữ ký riêng.
