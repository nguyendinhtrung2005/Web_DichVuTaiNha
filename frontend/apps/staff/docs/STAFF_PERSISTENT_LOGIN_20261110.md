> Source-worktree acceptance record. The two qa/integration harnesses remain local and are excluded from this PR. PR-worktree checks and the current transfer plan are recorded in STAFF_PR_UPDATE_20261110.md. Refresh remains disabled; a 30-day session is not active.

# Phiên Staff dài hạn — hiện trạng và contract cần Auth duyệt

Ngày 10/11/2026. Phạm vi triển khai: Staff Frontend/BFF trong worktree phát triển. **Chủ Auth chưa xác nhận bật refresh; người dùng đã yêu cầu giữ tắt trên trial4201/3202.** Không sửa Auth/Customer/Admin/schema, không cấp key hoặc credential mới, không thay đổi Draft PR #12.

## 1. Nguyên nhân thực tế

Probe HTTP qua Integration QA `http://127.0.0.1:3202`:

| Mục | Giá trị đo / cấu hình |
|---|---|
| Auth access JWT | 900 giây; RS256, có `exp`; `qa/integration/service.mjs` cấp `JWT_ACCESS_TTL_SECONDS=900` |
| Auth refresh | `AUTH_REFRESH_ENABLED=false`; POST refresh trả **503 REFRESH_DISABLED** trước khi xử lý credential |
| BFF renewal | `STAFF_SESSION_RENEWAL_ENABLED=false`; POST `/api/auth/renew` trả **503 SESSION_RENEWAL_DISABLED** |
| Phiên Staff sau login | HTTP200, `renewable` không được bật, deadline khoảng900giây |
| Cookie | Max-Age899giây lúc response (làm tròn xuống), HttpOnly, SameSite=Lax; Secure=false vì QA loopback HTTP |
| Lệch giờ | Date header so với client trong probe khoảng -1giây, không giải thích việc hết phiên15phút |

Legacy BFF giới hạn `expiresAt=min(JWT exp, Auth expiresIn, STAFF_SESSION_MAX_AGE_SECONDS)`. Max-age config của trial là900; kéo riêng cookie hoặc giá trị này không tạo refresh credential và không vượt được JWT expiry. Provider legacy chủ động xóa identity khi đến deadline. F5 chỉ khôi phục cookie còn hợp lệ, không tái đăng nhập bằng mật khẩu lưu sẵn.

Kho phiên BFF nằm bền vững trên E, mã hóa AES-256-GCM bằng key local đã có. Restart cùng key/directory không tự xóa phiên còn hạn; mất/đổi key hoặc thư mục, cookie hết hạn, tài khoản bị khóa và logout vẫn có thể làm phiên không sử dụng được. Không regenerate key để chữa lỗi.

Source Auth có extension refresh opt-in; điều này **không đồng nghĩa đã được owner duyệt bật trên Integration QA hoặc production**. Các báo cáo SESSION_RENEWAL cũ thuộc cấu hình/thời điểm khác, không thay thế quyết định hiện tại.

## 2. Staff-only đã sửa

### Single-flight phía Frontend

`staff-auth-session.tsx` chia sẻ cùng Promise kiểm tra phiên cho focus, visibility, nhiều component gọi `checkSession` và vòng renew. Trước bản vá, bốn trigger có thể tạo bốn request rồi hủy lẫn nhau. Login/logout hủy generation cũ và xóa flight; response cũ không được khôi phục accountA sau logout/loginB. Giữ nguyên Auth deny403, expiry legacy và fail-closed khi không xác minh được phiên.

Renew thành công không đưa ứng dụng về skeleton/login giữa thao tác. Không thêm password/JWT/refresh token vào context, localStorage, sessionStorage, URL hoặc log. Khi Auth thật trả401/403 phải bỏ identity; khi dependency503 thì báo không thể kiểm tra phiên, không giả vẫn được xác thực. Việc bảo toàn mọi draft qua outage khiến màn hình bảo vệ bị tháo vẫn cần thiết kế riêng theo chính sách dữ liệu; bản vá không lưu PII/draft vào browser để né bảo vệ.

### Retry đọc khi token hết hạn giữa request

`auth-core.mjs` thêm capability server-only `withAccessToken(sid, operation, {retryOnExpiredToken:true})`. Chỉ retry tối đa **một lần** khi cùng lúc đáp ứng:

- Phiên version2 renewable thật, đã được Auth xác minh; không tự nâng legacy thành renewable.
- Adapter GET cố định đã opt-in từ code server, không từ query/header browser.
- Callback trả401 `SESSION_EXPIRED` và access deadline của token đã qua theo clock server.
- Auth xác minh và cấp/khôi phục token mới cho **cùng account**, qua lock/rotation/idempotency đã có; phiên chưa revoked/logout.

Token còn hạn, lỗi403, lỗi provider/timeout hoặc refresh bị từ chối không được biến thành retry vượt quyền. Request GET lần hai vẫn lỗi thì trả lỗi, không lặp vô hạn. Nhiều request cùng SID dùng lock bền vững để không rotate thành các nhánh khác nhau.

Đã opt-in GET: công việc/facets, chi tiết, lịch, chi nhánh/khả dụng, tiền công dự kiến, review và đọc thông báo; status GET cũng opt-in. PATCH thông báo/status và POST Groq giữ **không tự replay**. Mutation không được retry chỉ vì có key: vẫn cần protocol/journal/idempotency riêng hiện hữu.

## 3. Contract hiện có — chỉ dùng sau owner sign-off

| Endpoint | Caller / dữ liệu |
|---|---|
| Auth POST `/api/v1/auth/login` | BFF gửi credential một lần + `role:EMPLOYEE,sessionMode:renewable`; cần service-client credential riêng |
| Auth POST `/api/v1/auth/refresh` | BFF gửi `{refreshToken,operationId}`; operationId UUID được lưu trước request và dùng lại khi response loss |
| Auth POST `/api/v1/auth/logout` | BFF revoke family idempotent; logout local có tombstone và hàng đợi revoke mã hóa nếu Auth outage |
| BFF GET `/api/auth/session` | Cookie HttpOnly; xác minh Auth, có thể refresh server-side khi gần/hết hạn; public DTO chỉ user/id/role/status, expiresAt, renewable |
| BFF POST `/api/auth/renew` | Origin/CSRF guard và body `{}`; không nhận/đưa JWT hoặc refresh credential vào browser |
| BFF POST `/api/auth/logout` | Đóng SID, thu hồi và xóa cookie; F5 không tự login lại |

Header Auth↔BFF là `X-CleanHome-BFF-Authorization`; không dùng Order token, Groq key, JWT signing key hoặc credential tài khoản QA thay service-client credential. Refresh opaque token chỉ ở Auth/BFF. Auth kiểm lại user/employee ACTIVE, role và fingerprint password trước rotation. Rotation giữ family và createdAt, không tự tạo phiên mới bằng login mật khẩu.

Response Auth→BFF cần `accessToken`, `tokenType`, `expiresIn`, `user`, `refreshToken`, `refreshExpiresAt`, `sessionCreatedAt`, `sessionAbsoluteExpiresAt` (ISO UTC hoặc null cho hard cap được duyệt). Phải tách access expiry và session deadline; chỉ cập nhật cookie sau khi response hợp lệ và kho phiên ghi bền vững. Cookie Max-Age không vượt deadline Auth/BFF hiện tại.

401 expired/revoked yêu cầu sign-in; 403 account/role forbidden giữ cấm truy cập;403 do service-client credential cấu hình sai phải diễn giải dependency503, không gọi lại bằng token khác.429 tôn trọng backoff;5xx/timeout không xóa cookie server chỉ để che outage. Không đổi đồng hồ Windows để thử expiry.

## 4. Chính sách 30ngày đề nghị owner xem xét — chưa bật

| Thành phần | Đề xuất | Trạng thái hiện tại |
|---|---|---|
| Access JWT | 900giây, luôn có exp | Đã dùng; không kéo JWT thành30ngày |
| Refresh/session idle | 2592000giây kể từ hoạt động/refresh hợp lệ | QA parser có hỗ trợ30ngày nhưng đang tắt refresh |
| Hard cap | Không hard cap chỉ khi nhóm duyệt rõ; logout/revoke/idle vẫn chấm dứt | QA parser chấp nhận0 tường minh; chưa dùng. Production parser hiện **cấm0** |
| Hoạt động | Renew từ tab có tương tác hoặc request nghiệp vụ hợp lệ; không giữ phiên bằng heartbeat tabẩn vô hạn | Provider có activity/visibility gate; BFF/Auth authoritative |
| Cookie production | HttpOnly, Secure/HTTPS, SameSite phù hợp, host/path/role namespace rõ ràng | QA HTTP không giả Secure hoặc chia cookie sang môi trường khác |
| Kho phiên | QA một host: key/kho riêng bền vững trên E; production: store dùng chung, atomic rotation, backup/retention/audit | File store hiện tại không phải giải pháp nhiều replica/serverless |

Các biến **đề xuất sau khi duyệt**, không phải hướng dẫn bật ngay:

```text
AUTH_REFRESH_ENABLED
AUTH_REFRESH_IDLE_SECONDS
AUTH_REFRESH_ABSOLUTE_SECONDS
AUTH_REFRESH_SESSION_DIR
AUTH_REFRESH_KEY_FILE
AUTH_REFRESH_CLIENT_TOKEN_FILE
STAFF_SESSION_RENEWAL_ENABLED
STAFF_SESSION_IDLE_SECONDS
STAFF_SESSION_ABSOLUTE_SECONDS
STAFF_SESSION_REFRESH_BEFORE_SECONDS
AUTH_SERVICE_BFF_TOKEN
```

**Production chưa tương thích policy30ngày:** config hiện giới hạn idle1800giây và hard cap28800giây, yêu cầu HTTPS/đường dẫn bền vững. Không chỉ đổi env để vượt các rào chắn này. Auth owner phải duyệt threat model, revoke, xác minh lại thao tác nhạy cảm và thay đổi config trong PR riêng; Staff thay tương ứng chỉ sau khi contract chung được duyệt.

Logout hiện chặn ngay SID của BFF và refresh family; access JWT đã cấp không tự bị blacklist mọi jti và có thể còn hạn riêng. Nếu cần thu hồi tức thời cả direct JWT, Auth phải đề xuất sid/session-version hoặc introspection/revocation registry nhất quán; không quảng cáo logout BFF là blacklist JWT toàn hệ thống.

## 5. Những gì chủ Auth cần phê duyệt/cung cấp

1. Xác nhận extension refresh hiện tại được dùng cho trial4201/3202; idle30ngày và có/không hard cap; semantics hoạt động hợp lệ và re-auth.
2. Cấp/khởi tạo kho/key/service-client credential riêng cho QA trên E bằng quy trình exclusive-create, không sao chép secret môi trường khác. Chỉ gửi đường dẫn/cách nạp, không gửi giá trị qua chat.
3. Review rotation, ancestor reuse detection, response-loss receipt, lock/CAS, logout/outage và retention khi chạy lâu ngày. Chọn store production và migration nếu cần; Staff không tạo schema thay owner.
4. Quyền xem/thu hồi từng thiết bị, logout một/tất cả thiết bị, password-change/account-lock/recovery; endpoint quản lý thiết bị hiện chưa được cung cấp cho Staff.
5. Customer/Admin: contract đang xét chỉ hỗ trợ EMPLOYEE renewable. Cần owner các module triển khai BFF/session riêng theo role/client, token audience/cookie namespace và kiểm thử riêng. Source Customer/Admin trong worktree này đi qua Portal/store khác đường Staff BFF; không suy từ đó ra trạng thái PR10/11 hoặc website của thành viên khác, không coi việc sửa Staff là đã sửa hai website hoặc SSO dùng chung.
6. Owner cung cấp QA dùng thật để chạy expiry/rotation/revocation/30ngày/sliding; chưa có thì chỉ đánh MOCK_PASS cho fake clock và dependency doubles.

## 6. File/hunk và kiểm thử

Staff runtime: `frontend/packages/ui/src/components/staff/staff-auth-session.tsx`; `frontend/apps/staff/lib/server/auth-core.mjs` và các GET adapter `jobs-http.mjs`, `job-detail-http.mjs`, `schedule-http.mjs`, `areas-http.mjs`, `income-http.mjs`, `reviews-http.mjs`, `notifications-http.mjs`, `status-core.mjs`.

Test: `auth-session-ui.test.mjs`, `auth-core-renewal.test.mjs`, mới `auth-read-retry.test.mjs`; script `test:auth` trong Staff package thêm wiring regression này, giữ các test cũ. QA: `qa/integration/refresh-staff.mjs` bổ sung `--frontend-only` để không restart Auth/Order/Staff/MySQL; mới `qa/integration/session.browser.mjs`. Chỉ chuyển hunk sau phê duyệt riêng; không chép đè package/script/Git WIP hoặc các bản vá đã có trên PR.

Regression trước sửa:4FAIL/1PASS trong5test mới (request storm và thiếu retry); sau sửa,55/55test core/provider +3/3adapter wiring PASS. Các trường hợp expiry, refresh thành công/revoked, 401đồng thời, logout, restart core dùng fake clock/doubles là **MOCK_PASS**, không phải Groq/Auth/MySQL REAL_PASS.

Kết quả full unit/typecheck/Chrome và checksum dữ liệu được lưu trong báo cáo nghiệm thu local trên E; không đưa artifact, cookie, Chrome profile, kho phiên, key hoặc log runtime vào PR. Không full rebuild hoặc thử thay mật khẩu/khóa account thật để tạo bằng chứng khi chưa có quyền.

## 7. Nghiệm thu lượt này

| Kiểm tra | Kết quả |
|---|---|
| Full Frontend unit/regression | **813 PASS, 8 SKIP, 0 FAIL**, 821 tổng; test opt-in cần dịch vụ khác vẫn SKIP |
| Script `npm run test:auth` | **122/122 PASS**, đã chứa regression mới |
| Typecheck, JS syntax, whitespace | **PASS**; không thay dependency hoặc chạy production build |
| Chrome login, chuyển trang, F5 | **REAL_PASS**, Auth/BFF/Staff thật |
| Đóng/mở Chrome cùng profile và restart riêng Frontend | **REAL_PASS**, cùng cookie/SID và đúng account; chứng minh phiên legacy còn hạn phục hồi, **không phải phiên30ngày** |
| Logout/F5 và A/B | **REAL_PASS**: cookie bị xóa, session401; B đọc assignmentA bị404, không tự đăng nhập lại |
| Expiry/rotation/revoked/single-flight/read retry | **MOCK_PASS** qua clock/doubles; không dùng Windows clock hoặc ghi MySQL để ép expiry |
| Refresh/sliding thật trên4201/3202 | **BLOCKED**, owner chưa duyệt, hai cờ tiếp tục false |
| Auth restart thật, chờ quá15phút/30ngày, khóa/đổi password tài khoản thật, HTTPS production, Customer/Admin E2E | **NOT_RUN**; không dùng thử nghiệm mô phỏng thay cho chứng cứ này |

Chrome cuối:3nhómREAL_PASS,0exception,0business write,0provider call. Harness phục hồi1lần GET vì execution context bị Webpack dev thay sau restart; không phát lại POST login/logout hoặc request nghiệp vụ ghi. Các lần lỗi CDP trước được giữ trong reports, không tính PASS hoặc sửa code ứng dụng để che lỗi.

Báo cáo local: `staff-persistent-session-1794297918200/runtime-probe.json`, `final-verification.json`; Chrome `staff-session-browser-1794299146507/report.json`; unit `session-frontend-tests.log`, `session-auth-standard-tests.log`. Tất cả nằm trong reports QA trên E, không thuộc Git/PR.

Đã đối chiếu34bảng trial không đổi; Groq bootstrap/config và metadata key không đổi, không đọc nội dung key. MySQL3306/3307, Auth/Order/Staff Backend không restart hoặc sửa source. Chỉ Frontend3202 được restart có kiểm tra PID sở hữu và sao lưu source snapshot. QA vẫn giữ cookie/TTL15phút và refresh tắt theo quyết định người dùng.

Tổng17file thuộc lượt này. WIP nguồn hiện **61 modified +186 untracked,0staged**; worktree PR và repository gốc khớp HEAD/status baseline. Hunk Staff-only sẵn sàng owner review sau phê duyệt chuyển mã; chưa stage/commit/push/cập nhật Draft PR#12. Trước production còn cần Auth sign-off, policy/store/revocation phù hợp và nghiệm thu refresh/sliding thật.
