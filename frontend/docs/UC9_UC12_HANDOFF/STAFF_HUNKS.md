# CleanHome — hunk Staff được nhóm xác nhận để chuẩn bị staging

Rà soát ngày 25/10/2026. Phạm vi 57 dòng CSS Staff dưới đây đã được người dùng xác nhận nhóm đồng ý bàn giao: **"nhóm xác nhận qua người điều phối, chưa đính kèm bằng chứng riêng"**. Không tự bịa reviewer, chữ ký hoặc link phê duyệt. Working tree hiện đã có các dòng này cùng 13 dòng Admin; không áp dụng lặp patch vào source. Người tích hợp sẽ chỉ chọn patch Staff vào index tại checkpoint staging; trạng thái staged thực tế đối chiếu STAGING_REVIEW.md. Không sửa `portal.tsx` hoặc bỏ phần Admin đang có.

Baseline: HEAD `afc5d78b993ec379ba9a9a3c5ab87059dfe2930b`; blob HEAD của `frontend/packages/ui/src/portal.css`: `6dfda1055e3815de132184aaac21ac5cc83f96eb`. Dòng dưới đây theo working tree tại lúc rà soát; kiểm tra lại khi file thay đổi.

## portal.css

Diff hiện có là một hunk nối tiếp cuối file: `@@ -1206,3 +1206,73 @@`, gồm 70 dòng thêm. Không stage toàn file.

| Dòng working tree | Nội dung | Quyết định cho Staff UC9–UC12 |
| --- | --- | --- |
| 1209–1210 | Dòng trống và comment nhóm style đăng nhập | Đưa vào patch đề xuất cùng nhóm Staff dùng |
| 1211–1219 | `.ch-auth-heading` | StaffLogin dùng tại dòng 69; nhóm xác nhận qua điều phối |
| 1220–1226 | `.ch-login-form`, `.ch-field` | Form/label của StaffLogin; nhóm xác nhận qua điều phối |
| 1227–1244 | Input kích thước, focus-visible, aria-invalid | Trường phone/password; nhóm xác nhận qua điều phối |
| 1245–1264 | Submit, hover/focus/disabled | Nút đăng nhập Staff; nhóm xác nhận qua điều phối |
| 1265–1267 | `.ch-admin-auth`, panel và tagline | EXCLUDE khỏi Staff-only patch; UI Admin review riêng |
| 1268–1270 | `.ch-login-header`, `.ch-login-eyebrow`, `.ch-login-intro` | Dùng bởi InternalAuth trong `portal.tsx`, không dùng trong StaffLogin mới; EXCLUDE |
| 1271–1277 | Media query layout/panel Admin | EXCLUDE khỏi Staff-only patch |
| 1278 | Reduced-motion cho `.ch-login-submit` | Nhóm xác nhận qua điều phối; chỉ chọn hunk Staff |

[proposals/staff-login-css-only.patch](proposals/staff-login-css-only.patch) chỉ chứa **57 dòng thêm**: 1209–1264 và 1278. Không chứa 13 dòng 1265–1277. Đây là patch chọn các style Staff cần từ diff hiện có, **không phải CSS đã scope chỉ cho Staff**. Cả ba app import cùng `portal.css`; các class chung còn được dùng trong Customer/Admin chưa commit ở working tree. Phạm vi bàn giao đã được nhóm xác nhận qua điều phối, nhưng chưa đính kèm review riêng của UI/Customer/Admin; kiểm tra hồi quy liên ứng dụng vẫn cần ghi theo kết quả thực tế. Không đổi selector hoặc thêm scope trong nhiệm vụ bàn giao.

SHA-256 patch: `ae3790e20a4202fec3ecdfedd3af6a699cc9cab4305dc714d7da237bfa78cf4b`.

## portal.tsx

**Không có hunk nào bắt buộc cho Staff Frontend mới.** `frontend/apps/staff/app/[[...slug]]/page.tsx:1` import `StaffAuthPortal` trực tiếp; component mới tự quản lý provider, redirect đăng nhập, phiên, UC9/UC10/UC11 và UI UC12. Nó không import `Portal`.

| Dòng working tree / hunk | Nội dung thay đổi | Quyết định |
| --- | --- | --- |
| 5 | Thêm `usePathname` | Phục vụ redirect Staff legacy; EXCLUDE khỏi UC9–UC12 |
| 12 | Bỏ import `DEMO_CREDENTIALS` | Đi cùng thay đổi InternalAuth; EXCLUDE |
| 26,32 | Thêm `staffLoginReturnTo`, bỏ `StaffLoading` | Nhánh Staff legacy; EXCLUDE |
| 53 | Đổi loading trong nhánh role Staff | Legacy, không đi qua entry Staff mới; EXCLUDE |
| 55–56 | Redirect đăng nhập/đã đăng nhập | Legacy; EXCLUDE |
| 100–116 | Thêm StaffAccessLoading/StaffLoginRedirect/StaffSignedInRedirect | Legacy; EXCLUDE |
| 126–156 | Viết lại InternalAuth, class Admin và bỏ tài khoản công khai | UI Admin/luồng cũ; EXCLUDE, cần PR UI riêng |

Không tạo patch `portal.tsx` và không stage toàn file. Không xoá hoặc hoàn tác các hunk legacy/Admin đang có.

## Source Staff cần đi cùng và phụ thuộc

Danh sách đầy đủ nằm trong `05-staff-frontend.review-paths.txt`; các file Staff login/layout trong đó không chứa hunk Customer/Admin:

- `frontend/apps/staff/app/[[...slug]]/page.tsx` đổi entry sang StaffAuthPortal.
- `frontend/packages/ui/src/components/staff/staff-auth-portal.tsx` và `staff-auth-session.tsx` kết nối BFF/phiên thật, điều hướng Staff.
- `frontend/packages/ui/src/components/staff/staff-login.tsx`, `staff-login-route.ts`, `staff-login-validation.ts` dùng phone, giữ nguyên password, nhận lỗi/phiên thật.
- `frontend/packages/ui/src/components/staff/staff-layout.tsx` nhận identity tối thiểu từ Auth và trạng thái đăng xuất, không yêu cầu tên/email giả.
- Các component remote/model và BFF của UC9–UC12 cùng tests phải đi đúng nhóm dependency. Patch CSS không thay thế những file này.

`Field`, `PasswordField`, `Input`, route policy và layout import CSS đã có trong HEAD; không có thay đổi cần lấy thêm ở các file đó. Không đưa thay đổi Customer auth, Admin auth hoặc generated `next-env.d.ts` vào commit Staff.

## Quy trình chọn đúng hunk đã được nhóm xác nhận

Các lệnh dưới đây là quy trình tham khảo **chỉ khi index chưa có hunk CSS này**; không chạy lặp sau khi STAGING_REVIEW.md ghi nhận đã stage. Việc tạo patch trước đây không tự tạo approval; hiện approval bàn giao đến từ xác nhận nhóm qua người điều phối trong yêu cầu mới. Chạy tại repo root. Các commit nhóm Auth/Staff/Order sau checkpoint có thể làm HEAD tiến lên; không cần giữ nguyên toàn bộ commit HEAD nếu blob CSS vẫn đúng baseline. Nếu blob CSS trong HEAD hoặc patch đổi, phải dựng lại proposal và review; nếu CSS đã staged, dừng để bảo vệ index. Không dùng `--3way`, `--reject`, force hoặc reset để ép áp dụng.

```powershell
$expectedCssBlob = '6dfda1055e3815de132184aaac21ac5cc83f96eb'
$cssHeadBlob = git rev-parse 'HEAD:frontend/packages/ui/src/portal.css'
if ($LASTEXITCODE -ne 0 -or $cssHeadBlob -ne $expectedCssBlob) { throw 'Blob CSS trong HEAD đã đổi; cần dựng lại và review patch CSS.' }
git diff --cached --quiet -- frontend/packages/ui/src/portal.css
if ($LASTEXITCODE -ne 0) { throw 'CSS đã có thay đổi staged; dừng để bảo vệ index.' }
$cssIndexBlob = git rev-parse ':frontend/packages/ui/src/portal.css'
if ($LASTEXITCODE -ne 0 -or $cssIndexBlob -ne $cssHeadBlob) { throw 'CSS trong index khác HEAD hoặc không đọc được.' }
$cssPatch = 'frontend/docs/UC9_UC12_HANDOFF/proposals/staff-login-css-only.patch'
if ((Get-FileHash -Algorithm SHA256 -LiteralPath $cssPatch).Hash.ToLowerInvariant() -ne 'ae3790e20a4202fec3ecdfedd3af6a699cc9cab4305dc714d7da237bfa78cf4b') { throw 'Patch CSS đã đổi; cần review lại.' }
git apply --cached --check -- $cssPatch
if ($LASTEXITCODE -ne 0) { throw 'Patch không áp dụng được; không thay đổi index.' }
# Chỉ khi đúng phạm vi được nhóm xác nhận, checkpoint cho phép stage và các guard đạt:
git apply --cached -- $cssPatch
if ($LASTEXITCODE -ne 0) { throw 'Không stage được patch; cần kiểm tra index.' }
git diff --cached --check
git diff --cached --numstat -- frontend/packages/ui/src/portal.css
git diff --cached -- frontend/packages/ui/src/portal.css
git diff -- frontend/packages/ui/src/portal.css
```

Kỳ vọng CSS staged: `57 0`, không có `.ch-admin-auth`, `.ch-login-header`, `.ch-login-eyebrow`, `.ch-login-intro` trong các dòng thêm. Working tree vẫn giữ đủ 70 dòng ban đầu; 13 dòng Admin còn ở unstaged diff. Không dùng `git add portal.css` sau bước này vì sẽ lấy lại toàn bộ phần Admin.

Nếu muốn chọn tương tác, owner có thể dùng `git add -p -- frontend/packages/ui/src/portal.css` và `e` để giữ đúng các dòng trên; `s` thường không tách được đoạn thêm liền nhau. Đây là phương án thay thế, không làm cả hai cách.

## Kiểm tra và checkpoint cuối

- PASS: đối chiếu `git diff --unified=0`, consumer/class usage, entry Staff và 57 dòng patch; patch không có selector riêng Admin.
- PASS lịch sử trước staging: `git apply --cached --check` với CSS trong index đúng HEAD. Lệnh `--check` đó không stage; tình trạng index sau bước chuẩn bị mới phải đọc STAGING_REVIEW.md.
- Người tích hợp ghi nhận đúng 57 dòng Staff staged và 13 dòng Admin còn unstaged tại STAGING_REVIEW.md; working tree giữ nguyên 70 dòng. Không stage `portal.tsx` hoặc tự lấy thay đổi Customer/Admin.
- Typecheck/build và kiểm thử tổ hợp bàn giao phải ghi theo kết quả mới của người tích hợp; bằng chứng QA trên working tree đầy đủ không tự chứng minh subset. Không chạy lại Q01–Q06 đã COMPLETED.
- Trước Ready for Review: xác nhận dependency, kiểm tra subset và ảnh hưởng Customer/Admin; ghi rõ approval qua điều phối, chưa có bằng chứng reviewer riêng. Dừng sau staging để người dùng xem, không commit/push/tạo PR/merge trong lượt này.
