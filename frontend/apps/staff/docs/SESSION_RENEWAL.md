# CleanHome — phiên Staff tự gia hạn

## Phạm vi

Người dùng đã phê duyệt sửa Auth và Staff BFF trong cuộc trao đổi này. Không thay đổi MySQL, schema, Staff/Order Service hoặc nghiệp vụ UC9–UC12. Phạm vi triển khai giữ ba website riêng.

## Nguyên nhân và cách xử lý

Phiên cũ bị giới hạn bởi `exp` của access JWT (local 900 giây). Cookie dài hơn không thể làm JWT hết hạn trở lại hợp lệ. BFF hiện tách thời hạn access token khỏi thời hạn phiên và đổi refresh credential tại Auth trước khi token sắp hết hạn hoặc khi người dùng quay lại sau hạn token.

Auth có đúng `POST /api/v1/auth/refresh`. `GET` trên URL đó trả 404. Khi refresh tắt, POST trả 503; thiếu credential riêng của BFF trả 403. Trước khi khởi động trong lượt này, cổng Auth 4001 không lắng nghe. Không có log của lần 404 trước nên chưa thể khẳng định lần đó là sai phương thức hay tiến trình cũ.

## Thời hạn

| Môi trường | Access JWT | Idle timeout | Giới hạn tổng phiên |
| --- | --- | --- | --- |
| Local đang cấu hình | 900 giây, RS256 | 604800 giây | **604800 giây (7 ngày) từ đăng nhập** |
| Production khi bật renewal | Tối đa theo Auth contract | Tối đa 30 phút | Tối đa 8 giờ; yêu cầu HTTPS và private durable paths |

Gia hạn không vượt giới hạn tổng phiên. Chuyển tab/F5 khi phiên còn hạn được kiểm tra lại trên server; trang ẩn không chạy keepalive vô điều kiện. Đóng trình duyệt vẫn có thể dùng cookie còn hạn, tùy chính sách trình duyệt. Xóa cookie, mất khóa/kho phiên, khóa tài khoản hoặc thay mật khẩu vẫn có thể yêu cầu đăng nhập lại. Đây không phải phiên vô hạn.

**Phiên cũ chưa có refresh credential cần đăng xuất/đăng nhập một lần để nâng cấp.** Không tự chuyển đổi hoặc xóa phiên cũ.

## Bảo mật và độ bền

- Browser chỉ nhận mã phiên ngẫu nhiên trong cookie HttpOnly, SameSite=Lax; Secure khi HTTPS. DTO browser chỉ có định danh/trạng thái và thời hạn phiên, không có JWT/refresh token.
- Access/refresh credential nằm trong kho file AES-256-GCM phía server. Auth dùng khóa refresh riêng; không đổi khóa RSA hay khóa phiên BFF đang có.
- Refresh chỉ dành cho BFF có credential service-to-service riêng. Browser không gọi Auth refresh trực tiếp. Origin/CSRF guards và kiểm tra JWT `exp` giữ nguyên.
- Rotation, kiểm tra reuse, khóa theo phiên, operationId bền vững và receipt mã hóa hỗ trợ retry không cấp hai refresh credential khác nhau cho cùng thao tác.
- Auth kiểm tra lại tài khoản/nhân viên/quyền và fingerprint mật khẩu khi refresh. Logout thu hồi phiên BFF và refresh family; access JWT đã cấp vẫn có thời hạn riêng theo contract.
- Auth gián đoạn trả lỗi phụ thuộc; không đổi thành đăng xuất do sai mật khẩu. Logout local vẫn hoàn tất; yêu cầu thu hồi Auth chưa gửi được nằm trong hàng đợi mã hóa và được thử lại sau.

Kho file chỉ dành cho một host có volume bền vững. Chưa nghiệm thu multi-replica/serverless, tải lớn, HTTPS production hoặc crash mất điện. Lock bỏ lại sau crash cần operator kiểm tra process trước khi xử lý; không xóa khóa/phiên để chữa lỗi.

## Cấu hình và chạy local

Giữ `.env` Auth và `.env.local` Staff ngoài Git. Không chép template đè cấu hình đang có, không đưa token vào `NEXT_PUBLIC_*`.

Auth (server-only): `AUTH_REFRESH_ENABLED=true`, `AUTH_REFRESH_IDLE_SECONDS=604800`, `AUTH_REFRESH_ABSOLUTE_SECONDS=604800`; private store/key/client-token paths xem ghi chú: contract refresh cần owner Auth cung cấp và phê duyệt riêng; session renewal vẫn mặc định tắt.

Staff (server-only): `STAFF_SESSION_RENEWAL_ENABLED=true`, `STAFF_SESSION_IDLE_SECONDS=604800`, `STAFF_SESSION_ABSOLUTE_SECONDS=604800`, `STAFF_SESSION_REFRESH_BEFORE_SECONDS=60`, `AUTH_SERVICE_BFF_TOKEN` nhận qua kênh local an toàn từ Auth. Giá trị token không được ghi vào tài liệu hoặc log.

`refresh:init` chỉ chạy lần đầu khi chưa có kho refresh, không sinh lại khóa đang dùng. Máy local này đã được cấu hình trong lượt triển khai; các lần chạy sau chỉ cần start:

```powershell
# Terminal Auth
Set-Location 'E:\DACN\du an chinh\Web_DichVuTaiNha\backend\auth-service'
npm.cmd start

# Terminal Staff Frontend
Set-Location 'E:\DACN\du an chinh\Web_DichVuTaiNha\frontend'
npm.cmd run dev:staff
```

Giữ MySQL và Staff Service 4005 hoạt động với `JWT_ISSUER`, `JWT_AUDIENCE`, JWKS/introspection đúng Auth. Order 4003 cần cho các thao tác UC12; lượt kiểm tra phiên này chỉ đọc UC9–UC11, không chạy lại fixture UC12 hoàn thành.

Mở `http://localhost:3002/dang-nhap`, đăng nhập Staff QA bằng phone và mật khẩu từ công cụ local đã cấp. F5, chuyển tab rồi xem Công việc/Chi tiết/Lịch. Không chạy thêm server nếu cổng đang có đúng ứng dụng.

## Bằng chứng kiểm thử

Lượt xác minh ngày **28/10/2026**, không lấy số liệu QA UC12 lịch sử làm kết quả phiên mới:

| Kiểm tra đã thực thi | Kết quả | Phạm vi |
| --- | --- | --- |
| Auth unit | 71 PASS / 0 FAIL / 0 SKIP | RS256, refresh/rotation/reuse/retry/logout và expiry |
| Staff Auth/BFF/Provider unit | 114 PASS / 0 FAIL / 0 SKIP | Phiên legacy/renewable, đồng thời, lỗi phụ thuộc, UI |
| UC9/UC10/UC11/UC12 unit hồi quy | 253 PASS / 0 FAIL / 0 SKIP | 45 / 42 / 45 / 121; không chạy UC12 ghi MySQL |
| HTTP Staff thật `3002` | 20 PASS | A/B login, phiên 7 ngày, cookie, kiểm tra/gia hạn phiên, UC9–UC11 đọc và logout |
| HTTP Auth thật `4001` | 5 PASS | Login JWT900 giây, POST refresh200, rotation, replay cùng operationId, logout/revoke401 |
| Chrome thật `3002` | 14 PASS | Login, F5/tab, đọc/điều hướng UC9–UC11, cookie/storage và bấm Đăng xuất trên UI |
| Chrome/HTTP QA riêng `3102`/`4101` | 19 PASS | JWT60 giây **hết hạn theo thời gian thật**, JWT cũ401, refresh đồng thời, F5/UC9–UC11 bằng JWT mới; absolute expiry180 giây và logout |
| Auth QA gián đoạn/khởi động lại | 9 PASS | Dừng đúng PID4101, BFF503 giữ cookie/ciphertext, cùng SID phục hồi; logout thu hồi Auth family |
| Staff typecheck và production build | PASS | Chạy tuần tự trên bản sao source QA cùng ổ đĩa; dependencies dùng junction, không chép `.env` thật |
| Bảo toàn Git/MySQL | PASS | Hash index và CSS nguyên vẹn; sáu bảng dữ liệu đối chiếu toàn bộ nội dung không thay đổi |
| Rà soát secret | PASS trong phạm vi | 142 file public Auth/Staff/BFF, không khớp bí mật local; cấu hình, khóa và kho phiên được Git ignore |

Tổng unit **438 PASS**, tổng kiểm tra HTTP/Chrome/local QA **67 PASS** (các nhóm trên có chức năng trùng nhau nhưng khác môi trường). Không có FAIL/SKIP trong các lượt hoàn tất. Build chứa route `/api/auth/renew`. Source JS/TS chạy test là source hiện tại, không tạo JWT giả, không bỏ middleware.

**NOT_RUN:** chờ trực tiếp 15 phút trên cổng4001 hoặc bảy ngày trên cổng3002; thay vào đó đã kiểm thử cùng triển khai với thời gian thật 60/180 giây trên service QA riêng. HTTPS/production, tải lớn, nhiều host và crash mất điện chưa kiểm chứng. UC12 ghi dữ liệu và Q01–Q06 không chạy lại. Không sửa Customer/Admin; không chạy lại toàn bộ nghiệp vụ hai ứng dụng.

Các lượt đầu có lỗi hạ tầng QA (Next dev kết thúc khi stdin bị đóng) và assertion công cụ (đòi mã user xuất hiện ở mọi trang, selector menu escape sai). Đã sửa **harness private**, giữ báo cáo lỗi cũ; không sửa nghiệp vụ ứng dụng để làm test đạt. Những kết quả này không được tính PASS trước khi chạy lại đủ.

Artifact local, **không commit**: `frontend/apps/staff/.auth-data/qa/refresh-20261028/`, gồm `actual-smoke.json`, `actual-refresh.json`, `local-browser-report.json`, `real-refresh-report.json`, `outage-revocation-report.json`, baseline chỉ chứa digest và bản sao cấu hình mã hóa DPAPI. Báo cáo không ghi credential/JWT/cookie value. Chrome profile QA riêng, không đọc hoặc xóa dữ liệu trình duyệt người dùng. Auth/Next QA4101/3102 đã đóng sau test; Auth4001 và Frontend3002 được giữ cho người dùng kiểm tra.

Đối chiếu cuối: **235 đường dẫn staged**, index SHA256 `6e7b0aaef9156b3ad140377841509e3fd4bb364943eaa5a209e54be2cb03b52d` không đổi; 13 dòng CSS Admin unstaged giữ nguyên. Sáu bảng có số dòng 3/2/30/30/56/66 và digest nội dung không đổi. `git diff --cached --check` đạt. Năm file source runtime BFF/Provider trong bản build được đối chiếu hash khớp source hiện tại.

ACL của `.env.local`, khóa/token refresh Auth và các khóa/token QA đã xác minh protected, chỉ có CurrentUser/SYSTEM. Windows từ chối đổi ACL của thư mục cha QA; không cưỡng chế đổi owner. Bản sao cấu hình vẫn mã hóa DPAPI; dữ liệu phiên mã hóa và khóa riêng được bảo vệ. Việc harden toàn bộ thư mục vận hành/retention trước production vẫn thuộc phần chưa nghiệm thu.

## File thuộc thay đổi refresh

Danh sách bao gồm source đã làm từ lượt trước và phần cấu hình/hoàn thiện của lượt này; không đưa các thay đổi Git khác vào phạm vi:

| Khu vực | File |
| --- | --- |
| Auth source | `src/app.js`, `src/config.js`, `src/runtime.js`, `src/service.js`, `src/refresh-store.js` |
| Auth công cụ/test/cấu hình mẫu | `scripts/init-refresh.js`, `test/refresh.test.js`, `package.json`, `.env.example` |
| Auth tài liệu | `README.md`, `docs/auth-contract.md`, `docs/refresh-integration.md` |
| Staff BFF | `lib/server/config.mjs`, `lib/server/auth-core.mjs`, `lib/server/auth-http.mjs`, `app/api/auth/renew/route.ts` |
| Staff Provider | `frontend/packages/ui/src/components/staff/staff-auth-session.tsx` |
| Staff test/cấu hình mẫu | `test/auth-core-renewal.test.mjs`, `test/auth-http.test.mjs`, `test/auth-session-ui.test.mjs`, `package.json`, `.env.example` |
| Staff tài liệu | `docs/SESSION_RENEWAL.md`, `docs/SESSION_RENEWAL_PROPOSAL.md`, `docs/AUTH_INTEGRATION.md`, `docs/LOCAL_STAFF_RUNBOOK.md`, `docs/LOCAL_STAFF_RECOVERY_REPORT.md` |

Auth paths tính từ `backend/auth-service/`; Staff paths tính từ `frontend/apps/staff/` trừ Provider đã ghi đầy đủ. Chỉ cấu hình local `.env` Auth và `.env.local` Staff được tạo/cập nhật có chọn lọc ngoài Git, không chép đè template. Khóa refresh/service credential mới tách riêng; khóa RSA và khóa phiên BFF cũ giữ nguyên. Không stage, commit, push, merge hoặc thay đổi nhánh.
