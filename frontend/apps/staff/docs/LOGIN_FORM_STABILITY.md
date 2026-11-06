# CleanHome — ổn định form đăng nhập Staff khi chuyển tab

## Nguyên nhân đã kiểm chứng

`StaffAuthProvider.checkSession()` được gọi khi window focus hoặc document trở lại visible. Trước sửa, nó đổi trạng thái đã biết `unauthenticated` thành `loading`. `StaffAuthScreen` trong Portal khi đó thay `StaffLogin` bằng skeleton. Form bị unmount; response 401 làm form mount lại với state rỗng. Password manager có thể tự điền trên các input mới, khiến người dùng thấy lúc trống, lúc được điền lại.

Chrome QA đã tái hiện trước sửa: trong lúc session check đang chờ, input phone biến mất và cả hai input gốc không còn connected. Không tìm thấy `router.refresh`, effect reset trên focus hoặc code tự điền password trong form. Đây không phải lỗi JSX/hydration được quan sát trong lượt này.

`name=phone`, `type=tel`, `autocomplete=username` và `autocomplete=current-password` vốn đúng chuẩn. Autofill từ trình duyệt/password manager là chức năng của trình duyệt, không đồng nghĩa ứng dụng đã lưu mật khẩu. Ngoài lỗi unmount, controlled inputs có thể không nhận một số lần điền DOM không phát React change event; lượt sửa cũng xử lý trường hợp này.

## Thay đổi

| File | Nội dung |
| --- | --- |
| `packages/ui/src/components/staff/staff-auth-session.tsx` | Giữ trạng thái anonymous đã biết trong background check; 503 khi anonymous giữ form và báo lỗi. Initial check/retry vẫn loading. Phiên authenticated gặp lỗi vẫn bị chặn, không giữ quyền khi kiểm tra thất bại. |
| `packages/ui/src/components/staff/staff-login.tsx` | Input uncontrolled giữ draft tại DOM; đọc FormData lúc submit; ID và autocomplete ổn định; form method POST tránh native GET đưa credential vào URL. Giữ phone, xóa password sau một lần gửi đăng nhập; không trim password. |
| `apps/staff/package.json` | Đưa unit Provider mới vào `test:auth`; thêm lệnh opt-in `test:auth:form-browser`. Không thay dependency/lockfile. |
| `apps/staff/test/auth-session-ui.test.mjs` | Thực thi Provider TypeScript thật bằng hook/scheduler/fetch doubles; bao phủ trạng thái nền, retry, protected access, stale response, mutation, login/logout/expiry. |
| `apps/staff/test/auth-form-browser.integration.mjs` | Chrome profile riêng với Auth/BFF doubles chỉ trong test: chuyển tab, DOM identity/draft, rerender, 503, lỗi đăng nhập, silent autofill, success/logout, không lưu credential. |
| `apps/staff/docs/LOGIN_FORM_STABILITY.md` | Báo cáo này và checklist kiểm tra thủ công. |

Đường dẫn trong bảng tính từ `frontend/`. Không sửa Portal, component password dùng chung, Customer/Admin, BFF server, Backend hoặc schema. Không thêm dependency.

## Hành vi và bảo mật

- Nhập dở rồi quay lại tab: cùng form/input DOM, không xóa draft khi kiểm tra phiên nền trả 401 hoặc gặp lỗi phụ thuộc tạm thời. Re-render không ghi giá trị React cũ đè lên native autofill.
- Login sai: phone còn nguyên, password bị xóa để nhập lại; lỗi rõ ràng và focus tới thông báo. Validation phía client chưa gửi request vẫn giữ draft.
- Login thành công: session công khai và điều hướng an toàn giữ nguyên; form không còn giữ password. Logout vẫn gọi BFF để thu hồi đúng phiên Frontend.
- Password chỉ nằm trong input/bộ nhớ cần thiết cho request. Không có credential context, localStorage/sessionStorage/cookie/URL/log hoặc lưu nháp bền vững. Không có code tự điền password đã biết, polling đọc password hoặc cơ chế `remember password` của ứng dụng.
- HttpOnly cookie, CSRF/Origin guard, session encryption, JWT/JWKS và Auth Service không bị chỉnh sửa. Test vẫn xác minh protected access fail closed khi phiên hết hạn, tài khoản bị từ chối hoặc dependency lỗi.
- Draft không được giữ qua F5, đóng tab, full navigation hoặc unmount thật. Trong development, Fast Refresh/full reload khi sửa source cũng có thể tạo lại form; không dùng persistent storage để giữ password qua những trường hợp này.

## Kết quả kiểm tra

| Kiểm tra | Kết quả | Phạm vi |
| --- | --- | --- |
| `npm.cmd run test:auth` | **69 PASS, 0 FAIL, 0 SKIP** | Gồm 14 test Provider mới; unit/HTTP doubles, không phải MySQL E2E |
| Chrome hồi quy form | **8 PASS, 0 FAIL**, không JS exception | Actual UI, Auth/BFF dependency doubles; gồm mở tab khác rồi quay lại và phản hồi session bị trì hoãn |
| Chrome Auth/BFF thật | **19 PASS, 0 FAIL**, không JS exception | Sai password, Customer bị từ chối, A đăng nhập thật, cookie, reload, logout, protected redirect; bố cục 375/390/768/1440 và form email Customer/Admin |
| Staff production build | **PASS** | Bản sao tách biệt cùng ổ E:, hash ba file ứng dụng thay đổi khớp source working tree |
| Staff TypeScript | **PASS** | `tsc --noEmit --incremental false`, chạy sau build trong bản sao |
| Whitespace/cú pháp test | **PASS** | Kiểm tra diff phần sửa và hai test mới |
| Chọn credential trong password manager của profile người dùng | **NOT_RUN** | Cần kiểm tra thủ công; silent DOM-fill test không thay xác minh UI password manager thật |

Trước sửa có red proof: hai regression unit thất bại và Chrome thất bại tại bước quay lại tab vì form unmount. Lượt Chrome đầu trong sandbox bị CDP timeout trước khi chạy assertion; chạy bằng Windows user ngoài sandbox đã tái hiện và xác minh bản sửa. Build đầu trong TEMP ổ C: gặp lỗi webpack phân giải đường dẫn dependency junction sang ổ E:; chuyển bản sao sang cùng ổ E: rồi build đạt, không sửa Next config hoặc source để bỏ kiểm tra.

Artifact form trước/sau: `%TEMP%/cleanhome-auth-form-report-vhI9DE/report.json` và `%TEMP%/cleanhome-auth-form-report-atdBoS/report.json`. Báo cáo không chứa input/password/JWT/cookie. Chrome và profile QA riêng đã được đóng/dọn đúng phạm vi sau mỗi lượt.

Artifact Auth thật/build nằm trong thư mục QA riêng bị Git ignore: `apps/staff/.auth-data/qa/login-form-validation-2d1a8ae5-02a1-4d8f-afff-bbe85fdbe5bd/`. Không copy `.env`, key hoặc session cũ vào bản sao kiểm tra; runner Auth thật chỉ truyền credential được cấp qua bộ nhớ tiến trình kiểm thử, không in chúng.

Không ghi MySQL, không chạy seed/reset/UC12 hoặc dùng lại Q01–Q06 đã hoàn thành. Phiên browser test riêng được logout; dữ liệu localStorage/sessionStorage của người dùng không bị truy cập.

## Chạy kiểm tra và nghiệm thu thủ công

Từ `frontend/apps/staff`, dùng server `3002` đã có:

```powershell
npm.cmd run test:auth
$env:RUN_STAFF_AUTH_FORM_BROWSER_TESTS = 'true'
try { npm.cmd run test:auth:form-browser }
finally { Remove-Item Env:RUN_STAFF_AUTH_FORM_BROWSER_TESTS -ErrorAction SilentlyContinue }
```

Browser test mặc định tạo profile và artifact TMP riêng, giới hạn toàn lượt 180 giây và 20 giây mỗi lệnh CDP; không dùng credential thật hoặc gọi API nghiệp vụ. Các kiểm tra đăng nhập thật chỉ chạy opt-in qua suite `test:auth:browser` với credential được owner cấp qua kênh riêng, không đặt password trực tiếp vào dòng lệnh.

1. Tải lại `http://localhost:3002/dang-nhap` một lần sau cập nhật source; nhập dở rồi chuyển tab nhiều lần và quay lại. Thử cả nhập phone trước và password trước.
2. Dùng đúng profile Chrome/Edge có password manager; chọn credential Staff đã lưu. Trình duyệt có thể gợi ý credential cũ của các website cùng hostname localhost; chọn đúng định danh Staff `TEST-*`.
3. Sau khi autofill, thử bật/tắt hiện password rồi đăng nhập. Thử cả Enter và nút Đăng nhập.
4. Nhập sai password: phone phải giữ lại, password trống, lỗi được đọc/nhìn thấy rõ. Nhập password đúng để đăng nhập, tải lại trang rồi đăng xuất.
5. Kiểm tra extension password manager đang dùng và thao tác Alt+Tab/chuyển cửa sổ thực tế. Những phần UI password manager này không được thay bằng mô phỏng autofill trong báo cáo.

Đối chiếu 338 file tracked liên quan: chỉ ba file ứng dụng trong bảng thay đổi, 335 file còn lại giữ nguyên, gồm Backend, BFF server, Customer/Admin và component dùng chung. Branch, bytes index và staged diff khớp snapshot trước sửa; vẫn 235 đường dẫn staged, 13 dòng CSS Admin unstaged nguyên vẹn. Không stage/commit/push/merge.
