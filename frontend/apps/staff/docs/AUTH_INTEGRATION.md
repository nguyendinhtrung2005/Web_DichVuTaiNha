# CleanHome — Frontend Staff: đăng nhập và phiên Backend thật

## Phạm vi

Giai đoạn 1 chỉ nối đăng nhập, kiểm tra phiên và đăng xuất của website Staff `http://localhost:3002` với Auth Service. Không nối UC9–UC12, không sửa Gateway hoặc source Backend, không ghi MySQL và không xóa localStorage cũ.

Entry Staff dùng phiên Backend riêng, không coi danh tính hoặc dữ liệu trong store/localStorage cũ là dữ liệu MySQL. Component nghiệp vụ Staff đã có được giữ trong source cho các giai đoạn tiếp theo; các trang nghiệp vụ chưa tích hợp hiển thị trạng thái chưa khả dụng thay vì thực hiện thao tác local dưới danh tính Backend. Customer/Admin tiếp tục dùng luồng hiện có.

## Contract Auth đã đối chiếu

Nguồn: [Auth contract](../../../../backend/auth-service/docs/auth-contract.md), [Auth integration](../../../../backend/auth-service/docs/staff-integration.md), [Staff Auth integration](../../../../backend/staff-service/docs/auth-integration.md).

| Chức năng | API Auth | Dữ liệu |
| --- | --- | --- |
| Đăng nhập | `POST /api/v1/auth/login` | `{phone,password,role:"EMPLOYEE"}` |
| Xác minh phiên hiện tại | `GET /api/v1/auth/introspect` | `Authorization: Bearer <JWT>` chỉ gửi từ server BFF |

Login trả `{accessToken,tokenType:"Bearer",expiresIn,user:{id,role,status}}`. `user.id` là chuỗi số nguyên dương canonical `users.id` trong phạm vi BIGINT signed của schema, không phải `employees.id`; `role=EMPLOYEE`, `status=ACTIVE`. Auth mặc định cấp token 900 giây; BFF dùng thời hạn thực tế trả về và không giả định 3600 giây. Auth chưa trả tên/email/avatar nên UI chỉ dùng nhãn chung “Nhân viên”.

Phone được trim, phải có giá trị, tối đa 20 ký tự và không chứa ký tự điều khiển. Chấp nhận định danh QA `TEST-*`, không bắt buộc mười chữ số. Mật khẩu được giữ nguyên, gồm khoảng trắng đầu/cuối. Role được BFF cố định là EMPLOYEE, không lấy từ dữ liệu client.

## Kiến trúc BFF và phiên

```text
Browser Staff :3002
  └─ /api/auth/login, /api/auth/session, /api/auth/logout
       └─ Next.js server BFF
            ├─ REST → Auth :4001 (login / introspect)
            └─ Kho phiên mã hóa trên filesystem bền vững
```

Browser nhận cookie `cleanhome_staff_session` chỉ chứa ID phiên ngẫu nhiên; DTO phiên công khai được trả riêng trong JSON. JWT không được trả cho JavaScript, không lưu localStorage/sessionStorage và không đưa vào cookie. JWT chỉ tồn tại trong bộ nhớ xử lý phía server hoặc bản ghi phiên mã hóa AES-256-GCM; khóa mã hóa 32 byte được lưu riêng. Tên file là SHA-256 của ID phiên, không lưu ID phiên thô trong tên file. Phiên có thời hạn, được kiểm tra phía server, và bị vô hiệu hóa khi logout. Reload và khởi động lại process vẫn đọc được phiên khi giữ nguyên khóa/kho phiên.

Kho phiên filesystem phục vụ một host với volume bền vững và quyền truy cập hạn chế. Đây không phải session store trong RAM, cũng không phải giải pháp đã kiểm chứng cho nhiều host, serverless hoặc filesystem tạm thời. Mã hiện có dọn có giới hạn các bản ghi phiên hết hạn nhận diện được và kiểm tra thời hạn trên từng request; file lạ hoặc hỏng không bị tự thay thế. Production cần volume bền vững được bảo vệ ACL/quyền hệ điều hành, giám sát dung lượng, backup/rotation phù hợp; khi triển khai nhiều host cần owner duyệt kho phiên dùng chung và kiểm thử đồng thời. Không đưa thư mục phiên hoặc khóa vào Git, thư mục `public/` hay browser bundle.

Cookie: `HttpOnly`, host-only, `Path=/`, `SameSite=Lax`; `Secure` khi origin đã cấu hình dùng HTTPS. Cookie Staff có tên riêng vì cookie localhost không cách ly theo port. BFF yêu cầu Origin khớp chính xác `STAFF_APP_ORIGIN` cho login/logout, từ chối Origin thiếu/khác cổng, đối chiếu Host/URL request và kiểm tra `Sec-Fetch-Site` khi có. Request thay đổi dữ liệu chỉ nhận JSON giới hạn 8 KiB. Không cấu hình CORS wildcard, không cung cấp proxy URL tùy ý và không có route chuyển tiếp `/internal/`.

`GET /api/auth/session` kiểm tra hạn phiên và gọi introspection thật. Token/user/employee bị từ chối dẫn tới yêu cầu đăng nhập lại; Auth timeout/lỗi phụ thuộc dẫn tới trạng thái tạm thời không khả dụng, không bỏ xác thực hoặc chuyển sang phiên local. Logout chỉ thu hồi phiên Frontend; Auth chưa có refresh/revoke/logout API nên không tuyên bố JWT Backend đã bị thu hồi. Token hết hạn cần đăng nhập lại.

## Các route cùng origin

| Method | Route | Response công khai |
| --- | --- | --- |
| POST | `/api/auth/login` | `{session:{user:{id,role,status},expiresAt}}` và cookie HttpOnly |
| GET | `/api/auth/session` | Cùng DTO phiên; không có access token |
| POST | `/api/auth/logout` | `{ok:true}` và xóa cookie; ID phiên cũ không sử dụng lại được |

Request login chỉ gồm `{phone,password}`; logout gửi `{}`. Response có `Cache-Control: no-store`. Lỗi có `{error:{code,message},requestId}`. BFF không log body đăng nhập, JWT, cookie, mật khẩu, khóa, hoặc lỗi upstream nguyên văn có thể chứa dữ liệu nhạy cảm. Return URL chỉ chấp nhận đường dẫn nội bộ Staff đã cho phép, không chuyển tới origin khác.

## Cấu hình server Staff

Điền trong `frontend/apps/staff/.env.local` hoặc cấu hình tiến trình server; không copy đè cấu hình đang có:

```dotenv
AUTH_SERVICE_URL=http://127.0.0.1:4001
STAFF_APP_ORIGIN=http://localhost:3002
STAFF_SESSION_DIR=.auth-data/sessions
STAFF_SESSION_KEY_FILE=.auth-data/session.key
STAFF_AUTH_TIMEOUT_MS=5000
STAFF_SESSION_MAX_AGE_SECONDS=3600
```

Không thêm prefix `NEXT_PUBLIC_` cho các biến trên. Không sao chép MySQL password, private key Auth hoặc Order internal token sang Frontend. Giai đoạn 1 không cần `STAFF_SERVICE_URL` vì chưa gọi API nghiệp vụ Staff. `STAFF_SESSION_MAX_AGE_SECONDS` chỉ giới hạn thêm thời hạn phiên; không gia hạn JWT. Production phải cấu hình đường dẫn tuyệt đối cho kho phiên/khóa và HTTPS theo guard cấu hình; phát triển loopback có thể dùng HTTP. Vị trí tùy chỉnh phải nằm ngoài thư mục public/source và được loại khỏi Git; `.auth-data/` mặc định đã được ignore. Giữ nguyên khóa qua restart; không tự tạo lại khóa khi file đã tồn tại.

Từ thư mục `frontend/apps/staff`:

```powershell
npm.cmd run auth:init
npm.cmd run dev
```

`auth:init` sinh khóa ngẫu nhiên vào đường dẫn server được cấu hình, từ chối ghi đè khóa cũ và không in khóa. Cấp quyền đọc/ghi thư mục `.auth-data` chỉ cho tài khoản chạy Staff. Có thể dùng lệnh `npm.cmd run dev:staff` từ `frontend` để chạy UI sau khi đã khởi tạo cấu hình/khóa. Mở đúng `http://localhost:3002/dang-nhap`; dùng hostname khác cần đổi `STAFF_APP_ORIGIN` tương ứng và khởi động lại.

Auth dùng cấu hình/khóa đã có; không chạy lại seed, provisioning hoặc sinh khóa chỉ để bật BFF:

```powershell
Set-Location backend/auth-service
npm.cmd start
```

Nếu service đang chạy, tái sử dụng tiến trình hiện có. Account QA nhận qua kênh riêng của owner Auth. Tài khoản frontend local trước đây không tự có quyền đăng nhập Backend. Không dùng hash marker trong seed làm mật khẩu.

## Kiểm thử

Từ `frontend/apps/staff`:

```powershell
npm.cmd run test:auth
npm.cmd run typecheck -- --incremental false
npm.cmd run build
```

Chạy build và typecheck Staff tuần tự, tránh cùng ghi/đọc file type do Next.js sinh lại. Không cần chạy Staff Service hoặc Order Service để kiểm thử phạm vi đăng nhập này.

HTTP suite `test/auth-http.integration.test.mjs` chỉ chạy khi bật `RUN_STAFF_BFF_HTTP_TESTS=true`, Auth thật và Next.js BFF thật cùng sẵn sàng. Cấu hình chạy test:

| Biến | Ý nghĩa |
| --- | --- |
| `STAFF_BFF_TEST_BASE_URL` | Origin Staff localhost, mặc định `http://localhost:3002` |
| `STAFF_BFF_TEST_PHONE_A`, `STAFF_BFF_TEST_PASSWORD_A` | Employee A hợp lệ, được cấp an toàn trong môi trường tiến trình test |
| `STAFF_BFF_TEST_PHONE_CUSTOMER`, `STAFF_BFF_TEST_PASSWORD_CUSTOMER` | Customer hợp lệ để kiểm tra role bị từ chối |
| `STAFF_BFF_TEST_USER_ID_A` | Tùy chọn: đối chiếu thêm ID tài khoản A |

Không đặt credential trực tiếp trong dòng lệnh, file được Git theo dõi hoặc log. Có thể để owner Auth chạy helper `scripts/http-tools.js:testAccounts()` trong tiến trình của Auth để lấy credential QA mã hóa vào bộ nhớ và truyền qua môi trường tiến trình con chạy suite; không chuyển private key/vault sang Frontend và không in credential. Test không tự đọc vault/private key, không mint JWT và không ghi database.

Sau khi credential đã được truyền an toàn vào process:

```powershell
$env:RUN_STAFF_BFF_HTTP_TESTS = 'true'
try { npm.cmd run test:auth:http }
finally { Remove-Item Env:RUN_STAFF_BFF_HTTP_TESTS -ErrorAction SilentlyContinue }
```

Suite HTTP gồm 12 ca: thiếu phiên; ID phiên ngẫu nhiên không tồn tại; thiếu Origin; Origin localhost sai port; sai mật khẩu; Customer bị từ chối; Employee đăng nhập thật và cookie an toàn; request mới vẫn có phiên; logout sai Origin không xóa phiên; logout xóa cookie và ID cũ mất hiệu lực; logout không có phiên; khoảng trắng mật khẩu không bị trim. Assertions chỉ log metadata an toàn, không đính kèm body/credential khi thất bại. Khi chưa opt-in, toàn bộ suite bị SKIP, không phải 12 PASS.

Hai suite bổ sung cũng yêu cầu opt-in và credential thật trong môi trường tiến trình test:

```powershell
$env:RUN_STAFF_BFF_LIFECYCLE_TESTS = 'true'
try { npm.cmd run test:auth:lifecycle }
finally { Remove-Item Env:RUN_STAFF_BFF_LIFECYCLE_TESTS -ErrorAction SilentlyContinue }

$env:RUN_STAFF_BFF_BROWSER_TESTS = 'true'
try { npm.cmd run test:auth:browser }
finally { Remove-Item Env:RUN_STAFF_BFF_BROWSER_TESTS -ErrorAction SilentlyContinue }
```

Lifecycle suite dùng `AUTH_SERVICE_URL` phía tiến trình test, Employee A thật và một HTTP bridge do test sở hữu quanh chính handler/core BFF. Suite này không chạy trên Next.js và không giả JWT. Nó tạo khóa/kho phiên riêng trong thư mục tạm QA, chỉ thu dọn tài nguyên do chính lượt test tạo; không tác động kho phiên ứng dụng hoặc database. Browser suite cần Chrome; có thể cấu hình executable bằng `STAFF_BFF_CHROME_PATH`. Profile browser riêng, không truy cập profile của người dùng, CDP có timeout 15 giây/lệnh và từng điều kiện chờ có giới hạn. Khi không opt-in, lifecycle/HTTP bị SKIP, browser báo NOT_RUN.

HTTP reload-equivalent là request mới với cookie; kiểm chứng reload UI, localStorage/sessionStorage và bố cục thực tế được ghi riêng ở browser QA bên dưới. Ca rút ngắn tuổi phiên BFF không đồng nghĩa đã chờ JWT Auth 900 giây hết hạn. Ca cấu hình upstream tới cổng không có service chứng minh xử lý lỗi mạng thật, không tuyên bố đã dừng Auth đang phục vụ người dùng.

### Kết quả lượt triển khai

Môi trường: Windows, Node.js, Next.js Staff development `3002`, Auth thật `4001` và các tài khoản đã được owner Auth cấp trong `cleanhome_staff_test`. Không chạy seed, migration, UC12 hoặc lệnh ghi MySQL. Không in credential, JWT, cookie phiên hay khóa. Kết quả thực thi được phân lớp:

| Lớp kiểm tra | PASS | FAIL | SKIP | Phạm vi chứng minh |
| --- | ---: | ---: | ---: | --- |
| Unit core | 22 | 0 | 0 | Lưu/mã hóa/hết hạn/thu hồi phiên, kiểm tra DTO và lỗi Auth; Auth double chỉ dùng trong unit |
| Unit HTTP wrapper | 23 | 0 | 0 | Origin/Host, JSON/giới hạn body, cookie, lỗi cấu hình và trạng thái HTTP; không phải HTTP tích hợp thật |
| Unit helper UI | 10 | 0 | 0 | Validation phone/password, ID/DTO phiên và return URL nội bộ; chạy helper TypeScript thực tế, không mount React |
| HTTP Next.js BFF → Auth thật | 12 | 0 | 0 | Đăng nhập Employee, Customer bị từ chối, sai mật khẩu, cookie/phiên/logout và CSRF với JWT thật |
| HTTP lifecycle bridge → Auth thật | 6 | 0 | 0 | Phiên hết TTL 3 giây, restart đọc lại phiên, Auth gián đoạn/phục hồi, lỗi lưu và logout khi Auth gián đoạn |
| Chrome profile QA riêng | 19 | 0 | 0 | Đăng nhập, reload, logout, an toàn cookie/storage, responsive và smoke trang đăng nhập Customer/Admin |
| Production build Staff | 1 lượt | 0 | 0 | Biên dịch ứng dụng Staff và ba route BFF; không phải kiểm chứng deployment production |
| Typecheck Staff / Customer / Admin | 3 lượt | 0 | 0 | Chạy tuần tự bằng `--incremental false`, sau thay đổi cuối của source |

Lệnh `npm.cmd run test:auth` đã chạy gộp đủ **55 PASS, 0 FAIL, 0 SKIP**. Typecheck cuối của cả ba ứng dụng đều đạt. Chrome kiểm tra Customer `3001/dang-nhap` và Admin `3003/dang-nhap` vẫn hiển thị form email/thiết kế CleanHome cũ, không dùng ô phone hoặc provider Auth Staff. Đây là smoke điều hướng/form đăng nhập, không phải kiểm thử toàn bộ nghiệp vụ Customer/Admin.

Chrome đã kiểm tra trang đăng nhập và trang sau đăng nhập ở **375, 390, 768, 1440px**, không phát hiện tràn ngang. Kiểm tra gồm phone chấp nhận `TEST-*`, lỗi sai mật khẩu và focus, Customer bị từ chối, đăng nhập Employee thật, chặn return URL ngoài website, reload giữ phiên, logout và bảo vệ route `/cong-viec`. Cookie có giá trị opaque, HttpOnly, SameSite=Lax, host-only; HTTP localhost không đặt Secure. Browser chỉ gọi BFF cùng origin, không gọi trực tiếp cổng Backend, không có JWT trong response/storage, giữ nguyên canary localStorage/sessionStorage có sẵn trong profile QA và không có exception JavaScript trong lượt hoàn tất. Profile QA đã đóng sau kiểm thử.

Bằng chứng được lưu ở `frontend/apps/staff/.auth-data/qa/browser/report.json` và screenshot `login-375.png`, `authenticated-1440.png` cùng thư mục. Thư mục này được Git ignore; báo cáo chỉ chứa metadata an toàn. Đã xem ảnh mobile/desktop.

| Yêu cầu bắt buộc | Kết quả và lớp kiểm chứng |
| --- | --- |
| Đăng nhập đúng EMPLOYEE | PASS — Next.js HTTP và Chrome dùng Auth thật |
| Sai mật khẩu | PASS — HTTP và Chrome trả lỗi, không tạo phiên |
| Tài khoản không phải EMPLOYEE | PASS — Customer thật bị từ chối qua HTTP và Chrome |
| Reload giữ phiên hợp lệ | PASS — Chrome reload và HTTP request mới |
| Logout xóa phiên Frontend | PASS — HTTP/Chrome; ID phiên cũ bị từ chối |
| Phiên hết hạn | PASS — lifecycle HTTP với TTL phiên 3 giây và unit kiểm tra JWT hết hạn; chưa chờ JWT Auth thật hết 900 giây |
| Auth không khả dụng | PASS — HTTP lifecycle dùng cổng upstream từ chối kết nối; trả 503, không bỏ xác thực và không xóa phiên còn khả năng phục hồi |
| JWT không ở browser storage | PASS — Chrome đối chiếu storage và response; dữ liệu cũ vẫn giữ nguyên |
| Thuộc tính cookie | PASS — HTTP/Chrome kiểm tra HttpOnly/Lax/host-only; Secure trên HTTPS được kiểm tra unit, chưa chạy HTTPS thực tế |
| Customer/Admin không bị ảnh hưởng | PASS trong phạm vi đã kiểm tra — không sửa source hai luồng, typecheck cả hai đạt và Chrome mở đúng form đăng nhập email hiện có; chưa chạy lại toàn bộ nghiệp vụ |

**NOT_RUN:** deployment HTTPS/reverse proxy, nhiều host/serverless, restart toàn bộ process Next.js với phiên đang mở, chờ JWT Auth thật hết hạn, và toàn bộ luồng nghiệp vụ UC9–UC12. Restart đã PASS chỉ áp dụng HTTP bridge dùng cùng kho phiên thực, không được coi là restart E2E của Next.js. Lượt đầu lifecycle gặp Auth chưa chạy; sau khi khởi động lại Auth bằng cấu hình hiện có đã chạy lại đủ sáu ca và đạt. Một lượt typecheck bị Node thiếu bộ nhớ khi nhiều tiến trình dev cùng chạy; lượt chạy lại tuần tự sau đó đạt cả ba ứng dụng. Lượt browser mở rộng bị gián đoạn trước khi chạy đã được chạy lại đầy đủ, đạt 19 ca. Không có FAIL còn tồn tại trong các lượt hoàn tất nêu trên.

## File tạo hoặc chỉnh sửa trong giai đoạn 1

Các đường dẫn sau tính từ repository; file đã có thay đổi trước nhiệm vụ được chỉnh nối tiếp có chọn lọc, không hoàn tác nội dung cũ.

| File | Vai trò |
| --- | --- |
| `frontend/apps/staff/app/[[...slug]]/page.tsx` | Entry riêng Staff dùng phiên Backend |
| `frontend/apps/staff/app/api/auth/login/route.ts` | POST đăng nhập BFF |
| `frontend/apps/staff/app/api/auth/session/route.ts` | GET kiểm tra phiên BFF |
| `frontend/apps/staff/app/api/auth/logout/route.ts` | POST thu hồi phiên Frontend |
| `frontend/apps/staff/lib/server/config.mjs` | Cấu hình chỉ phía server và guard production |
| `frontend/apps/staff/lib/server/auth-core.mjs` | Auth REST client và kho phiên mã hóa |
| `frontend/apps/staff/lib/server/auth-http.mjs` | Kiểm tra request, cookie và DTO HTTP |
| `frontend/apps/staff/scripts/init-auth.mjs` | Khởi tạo khóa phiên, không ghi đè khóa đã có |
| `frontend/apps/staff/.env.example` | Mẫu cấu hình không chứa secret |
| `frontend/apps/staff/.gitignore` | Loại khóa/phiên/QA artifact và env khỏi Git |
| `frontend/apps/staff/package.json` | Lệnh init/test, không thêm dependency |
| `frontend/apps/staff/test/auth-core.test.mjs` | 22 unit core |
| `frontend/apps/staff/test/auth-http.test.mjs` | 23 unit HTTP wrapper |
| `frontend/apps/staff/test/auth-ui.test.mjs` | 10 unit helper UI |
| `frontend/apps/staff/test/auth-http.integration.test.mjs` | 12 HTTP Next.js/Auth thật |
| `frontend/apps/staff/test/auth-lifecycle.integration.test.mjs` | 6 HTTP lifecycle với Auth thật |
| `frontend/apps/staff/test/auth-browser.integration.mjs` | Chrome QA với profile riêng |
| `frontend/apps/staff/docs/AUTH_INTEGRATION.md` | Cấu hình, kết quả, phạm vi và bàn giao |
| `frontend/packages/ui/src/components/staff/staff-login.tsx` | Giữ thiết kế, dùng phone và Auth provider |
| `frontend/packages/ui/src/components/staff/staff-layout.tsx` | Nhận danh tính tối thiểu, loading logout |
| `frontend/packages/ui/src/components/staff/staff-auth-session.tsx` | Provider phiên chỉ gọi BFF, không lưu token |
| `frontend/packages/ui/src/components/staff/staff-auth-portal.tsx` | Điều hướng và trạng thái phiên riêng Staff |
| `frontend/packages/ui/src/components/staff/staff-login-validation.ts` | Validation phone/password theo Auth contract |

Ngoài 23 file trên, Next.js tự tạo metadata hướng dẫn `frontend/apps/staff/AGENTS.md`, `CLAUDE.md` và cập nhật tham chiếu type trong `next-env.d.ts` khi dev/build. Đây là file do framework sinh; không xóa hoặc ghi đè các hướng dẫn cũ để làm sạch Git diff. Helper `staff-login-route.ts` đã có trước lượt triển khai, được tái sử dụng và không chỉnh sửa. Không sửa core, Portal dùng chung, source Backend/Customer/Admin, schema hoặc lockfile; không cài package và không commit/push/merge/đổi nhánh.

## Giới hạn và bước UC9 tiếp theo

Checklist bàn giao theo quy tắc nhóm:

| Mục | Trạng thái | Bằng chứng / giới hạn |
| --- | --- | --- |
| Đúng phạm vi | PASS | Chỉ code Staff app và Staff UI; không nối API nghiệp vụ |
| Không hồi quy | PASS trong phạm vi kiểm tra | 55 unit, typecheck ba ứng dụng và smoke Customer/Admin; chưa chạy toàn bộ nghiệp vụ hai ứng dụng |
| API contract | VERIFIED cho đăng nhập/phiên | Đối chiếu source Auth và 12 ca HTTP BFF/Auth thật |
| Database | NOT_APPLICABLE | Không thay schema, seed hoặc ghi dữ liệu; Auth đăng nhập dùng dữ liệu hiện có |
| Security | PASS trong phạm vi kiểm tra | Cookie/Origin, role, introspection, token chỉ phía server và kho phiên mã hóa; HTTPS production chưa kiểm chứng |
| Reliability | PASS trong phạm vi kiểm tra | Timeout, dependency/storage fail-closed, expiry, persisted session và logout khi Auth lỗi |
| Evidence | PASS | Phân biệt unit, HTTP bridge, Next HTTP và Chrome; không báo UC9–UC12 đã kiểm thử |
| Handoff | PASS | Danh mục file, cấu hình, lệnh chạy, giới hạn và bước UC9 ghi trong tài liệu này; owner Frontend/Auth review trước khi triển khai |
| Git | PASS | Giữ nhánh `feat/cleanhome-frontend`; không checkout/reset/commit/push/merge, không hoàn tác thay đổi cũ |

- Chưa có refresh token, đổi mật khẩu, hồ sơ Backend hay thu hồi JWT toàn hệ thống; không tạo dữ liệu hồ sơ giả.
- Chưa có Gateway hoàn thiện; BFF development gọi Auth theo URL server đã được duyệt và giữ xác thực thật.
- Chưa kiểm chứng deployment reverse proxy/TLS: proxy phải giữ đúng scheme/Host để URL request khớp `STAFF_APP_ORIGIN`. Không tự tin cậy header `X-Forwarded-*` từ browser để vượt guard Origin.
- Rate limit Auth có thể nhìn thấy cùng IP loopback cho nhiều người dùng qua BFF; TV1 cần duyệt chính sách IP/proxy/rate limit khi triển khai nhiều người dùng. BFF không tự giả header client IP.
- Chưa có API UC9–UC12 trong BFF; không gọi Order internal API từ Frontend.
- Dữ liệu localStorage cũ được giữ nguyên. Không ghép tài khoản local và MySQL theo ID/email, không fallback sang demo khi Backend lỗi.
- UC9 cần DTO assignment riêng, API client server giới hạn endpoint, phân trang/lọc/sort Backend, ownership A/B và empty/error/loading. Các thống kê/tìm kiếm chưa có trong contract cần phối hợp owner trước khi triển khai.
- UC12 sau này chỉ thử trên fixture QA mới đã được duyệt; booking QA đã COMPLETED không được dùng lại làm trạng thái khởi đầu hoặc reset.

Tài liệu tham chiếu: [Order Staff integration](../../../../backend/order-service/docs/staff-integration.md), [Staff README](../../../../backend/staff-service/README.md), [Auth README](../../../../backend/auth-service/README.md). Giữ nguyên quyền sở hữu source Backend, schema và các thay đổi Git chưa commit của thành viên khác.
