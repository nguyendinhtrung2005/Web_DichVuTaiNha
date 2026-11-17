# CleanHome — Auth Service cho Staff UC9–UC12

Đã triển khai đăng nhập **bằng `users.phone`**, cấp JWT **RS256**, public JWKS và introspection kiểm trạng thái MySQL hiện tại. Auth/Staff đã được kiểm chứng HTTP thật; Frontend Staff và UC12 đã có bằng chứng local Q01–Q06 riêng ở phần cập nhật dưới đây.

## Cập nhật bằng chứng local ngày 24/10/2026

Theo [báo cáo nghiệm thu UC12](../../frontend/apps/staff/docs/UC12_E2E_QA_REPORT.md), luồng Browser → BFF → Auth/Staff → Order → MySQL thật trên `cleanhome_staff_test` đạt **43 nhóm E2E PASS, 0 FAIL, 0 SKIP, 0 NOT_RUN** cho Q01–Q06. Hồi quy HTTP riêng đạt **90 PASS, 0 FAIL, 1 SKIP** do thiếu fixture UC11 qua ranh ngày UTC/Việt Nam; không cộng hai lớp kiểm thử hoặc coi SKIP là PASS.

Sáu booking `9109151–9109156` đã COMPLETED, mười hai assignment `9109173–9109184` đã DONE, 36 journal mới đã ACK; giữ nguyên dữ liệu và không chạy lại workflow. Booking cũ `9109131` và `9109141` cũng đã COMPLETED. Muốn kiểm thử ghi thêm cần fixture và phạm vi được duyệt riêng.

Đây là bằng chứng local HTTP trên một máy; chưa kiểm chứng production, HTTPS/Secure cookie thực, tải lớn/stress/soak, nhiều host/replica hoặc crash/kill/mất điện/restore trong lượt Frontend này. Fault Q03–Q06 là mất kết nối/phản hồi thật, không phải crash tiến trình. Worker toàn database tắt. Kết quả không thay phê duyệt contract/PR của owner; các kết quả giai đoạn cũ phía dưới được giữ làm lịch sử.

## Phạm vi và định danh

Auth/User ban đầu chỉ có scaffold `TODO`. Lượt này chỉ sửa `backend/auth-service`; giữ nguyên User Service, Staff Service, Order Service, Frontend và schema 32 bảng. Auth hiện truy vấn trực tiếp MySQL chung theo schema nguồn, không gọi API User Service chưa tồn tại. Auth sở hữu xác minh/cấp credential; quản lý profile/user và tách dữ liệu giữa service là phần tích hợp tiếp theo.

`users` có `phone`, `password_hash`, `role`, `status`; **không có email**. Không thêm cột/bảng hoặc giả định hỗ trợ đăng nhập email. Subject JWT là chuỗi **`users.id`**, không phải `employees.id`. Quyền luôn lấy từ database: `CUSTOMER`, `EMPLOYEE`, `ADMIN`. EMPLOYEE còn cần hồ sơ `employees` ACTIVE.

Mật khẩu lưu dạng `scrypt` có salt ngẫu nhiên, `N=131072,r=8,p=1`, so sánh timing-safe và giới hạn tham số khi đọc hash. Dùng native Node crypto theo [hướng dẫn OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), không thêm thư viện hashing. Hash marker không đăng nhập được; không tự chuyển hash lạ thành mật khẩu mặc định.

## Endpoint đã chạy thật

Auth mặc định `http://localhost:4001`:

| Method | Endpoint | Kết quả đã kiểm chứng |
| --- | --- | --- |
| GET | `/health/live` | 200, đúng tiến trình Auth |
| GET | `/health/ready` | 200, schema users/employees phù hợp |
| POST | `/api/v1/auth/login` | A/B/Customer 200; sai mật khẩu/phone không có 401; đúng mật khẩu nhưng chọn sai role 403; gửi email thay phone 400 |
| GET | `/.well-known/jwks.json` | 200, chỉ public RSA JWK, không có private parameters |
| GET | `/api/v1/auth/introspect` | JWT thật trả đúng danh tính ACTIVE; thiếu/sửa token trả 401 |

Login nhận `{phone,password,role?}`. `role` tùy chọn chỉ kiểm tra vai trò mong đợi, không cấp quyền. Response `{accessToken,tokenType:"Bearer",expiresIn,user:{id,role,status}}`. TTL mặc định 900 giây. Introspection trả top-level `{sub,userId,role,status,active,locked}` theo Staff contract. Chi tiết lỗi/claims: [auth-contract.md](docs/auth-contract.md).

## Cài đặt và cấu hình

Node.js 22+, từ thư mục `backend/auth-service`:

```powershell
npm.cmd ci
if (-not (Test-Path -LiteralPath '.env')) {
    Copy-Item -LiteralPath '.env.example' -Destination '.env'
}
```

Điền `MYSQL_*` của database phù hợp vào `.env` cục bộ. Trong lượt kiểm tra, Auth có cấu hình MySQL test riêng được lấy từ cấu hình Staff đã có; không ghi đè `.env` Staff hoặc in credential. `.env*`, mọi bản sao `.env`, `secrets/`, log và dependency đều được ignore; chỉ `.env.example` trống bí mật được phép đưa vào Git.

```dotenv
PORT=4001
JWT_ISSUER=http://localhost:4001
JWT_AUDIENCE=cleanhome-staff-api
JWT_KEY_ID=cleanhome-local-1
JWT_PRIVATE_KEY_FILE=secrets/auth-private.pem
JWT_ACCESS_TTL_SECONDS=900
```

Với cài mới chưa có khóa, chạy `npm.cmd run generate:keys` **một lần**. Script sinh RSA 3072 bit bằng nguồn ngẫu nhiên hệ thống, tạo riêng private/public PEM và public JWKS trong `secrets/`, từ chối ghi đè khóa đã có. Private key không hardcode, không được đưa vào log/Git hoặc chuyển sang Staff. Runtime không tự sinh khóa/fallback khi cấu hình thiếu. Khóa cục bộ của lượt này đã được tạo, không cần sinh lại.

```powershell
npm.cmd start
```

Server xác minh key và schema trước khi listen; log chỉ metadata, không body/mật khẩu/token. Có giới hạn JSON 8 KiB, origin cho ba website, rate limit đăng nhập và tối đa hai lượt hashing đồng thời trong một tiến trình, kể cả khi client ngắt kết nối.

## Ba tài khoản kiểm thử đã cấp credential

| Nhãn | `users.id` / JWT `sub` | `employees.id` | `phone` dùng đăng nhập | Role |
| --- | --- | --- | --- | --- |
| A | `9109002` | `9109004` | `TEST-EMPLOYEE-UC9` | EMPLOYEE |
| B | `9109101` | `9109102` | `TEST-EMPLOYEE-UC9-B` | EMPLOYEE |
| Customer | `9109001` | Không có | `TEST-CUSTOMER-UC9` | CUSTOMER |

Phone marker là identifier **đã có thực trong cột phone của fixture**, không phải số điện thoại thật hoặc email. API không ép regex chỉ chữ số để không tự sửa dữ liệu hiện tại. Không thay phone, ID, role, trạng thái, employee hoặc công việc khi cấp credential. Không thêm Admin chỉ để kiểm thử.

Đã chạy script có guard trên đúng `cleanhome_staff_test`: **chỉ ba `password_hash` marker được thay bằng scrypt**. Mật khẩu ngẫu nhiên không có mặc định công khai. File `secrets/test-accounts.json` chứa **envelope mã hóa AES-256-GCM + RSA-OAEP-SHA256**, không chứa mật khẩu plaintext; helper giải mã trong bộ nhớ trước khi POST login thật. Giữ private key Auth để mở vault; hiện chưa có quy trình rotation/rewrap tự động. Mã hóa file cục bộ không thay hệ thống quản lý secret khi triển khai production; quyền POSIX `0600` còn cần ACL tương ứng trên Windows/máy dùng chung.

Script provision chỉ cho test database, cần opt-in, kiểm đúng lineage 3 user/2 employee/5 booking/6 assignment và cập nhật marker bằng transaction/CAS. Chạy lại đã kiểm chứng **changed=0**, không reset mật khẩu hoặc dữ liệu. Không dùng script này trên production. Không tự xóa vault/khóa khi mất quyền đọc vì hash đã lưu không thể khôi phục mật khẩu.

```powershell
# Chỉ khi chuẩn bị fixture kiểm thử đã được duyệt, không phải bước startup:
$env:AUTH_PROVISION_TEST_ACCOUNTS = 'true'
try { npm.cmd run provision:test }
finally { Remove-Item Env:AUTH_PROVISION_TEST_ACCOUNTS -ErrorAction SilentlyContinue }
```

Khi Auth đang chạy, lấy token qua login thật mà không in credential/response:

```powershell
npm.cmd run tokens:staff-test
```

Token được lưu tại `secrets/tokens/A.token`, `B.token`, `CUSTOMER.token`, ngoài Git. Chạy lại helper để đăng nhập/cấp token mới khi hết hạn; không sửa claim hoặc tự ký token bên ngoài Auth.

## Cấu hình Staff để tích hợp

Ví dụ public config, không chứa private key:

```dotenv
JWT_ALGORITHM=RS256
JWT_ISSUER=http://localhost:4001
JWT_AUDIENCE=cleanhome-staff-api
JWT_JWKS_URL=http://127.0.0.1:4001/.well-known/jwks.json
JWT_PUBLIC_KEY=
JWT_SECRET=
AUTH_INTROSPECTION_URL=http://127.0.0.1:4001/api/v1/auth/introspect
RECONCILIATION_WORKER_ENABLED=false
```

Chọn đúng một nguồn public key: JWKS như trên, hoặc public PEM SPKI từ `secrets/auth-public.pem` và để JWKS rỗng. Introspection tùy chọn, lượt này đã kiểm chứng khi bật. Không gửi private key sang Staff. Cấu hình Staff của người dùng được giữ nguyên; các giá trị kiểm thử đã truyền qua môi trường tiến trình.

Để tái hiện đúng hai tiến trình local của lượt này mà không sửa `.env` Staff, giữ Auth chạy ở terminal thứ nhất, rồi tại `backend/staff-service` ở terminal thứ hai:

```powershell
$env:PORT = '4005'
$env:CORS_ORIGINS = 'http://localhost:3002'
$env:JWT_ALGORITHM = 'RS256'
$env:JWT_JWKS_URL = 'http://127.0.0.1:4001/.well-known/jwks.json'
$env:AUTH_INTROSPECTION_URL = 'http://127.0.0.1:4001/api/v1/auth/introspect'
$env:RECONCILIATION_WORKER_ENABLED = 'false'
node --env-file=../auth-service/.env src/server.js
```

Lệnh tái hiện dùng MySQL/issuer/audience từ `.env` Auth test, không nạp `.env` Staff; không đặt đồng thời PEM/secret cũ trong môi trường terminal này. Trong môi trường triển khai, dùng secret/config riêng từng service thay vì đọc chung file. Hướng dẫn đầy đủ: [staff-integration.md](docs/staff-integration.md).

## Kiểm thử và giới hạn kết quả giai đoạn Auth (lịch sử)

| Bộ kiểm thử | PASS | FAIL | SKIP |
| --- | ---: | ---: | ---: |
| Auth độc lập | 46 | 0 | 0 |
| Auth MySQL thật | 6 | 0 | 0 |
| Auth HTTP thật | 10 | 0 | 0 |
| Suite Staff HTTP do Auth runner gọi | 8 | 0 | 1 |

Dòng Auth HTTP gồm một test cha gọi suite Staff; dòng Staff phân rã kết quả con, không cộng để khẳng định số endpoint độc lập. Staff kiểm 401 không token, 403 Customer, 404 A/B truy cập chéo (kể cả chung booking), UC9 lọc/sort/phân trang, UC10 chi tiết và UC11 lịch Việt Nam. Nhánh ghi UC12 SKIP trong suite Auth lịch sử này; kết quả đó không thay trạng thái Q01–Q06 đã nghiệm thu riêng. Lần đầu runner lồng nhau không đọc được thống kê Node; đã sửa IPC/reporter ở Auth test harness, chạy lại đạt bảng trên, không sửa Staff.

Kiểm cú pháp **20 file JavaScript** và khoảng trắng đạt. Rà 32 file Auth có thể được Git nhìn thấy không phát hiện literal private key/JWT theo mẫu đã dò; không có `.env` ngoài template hoặc nội dung `secrets/` trong danh sách đó. Tám liên kết tài liệu cục bộ hợp lệ. Checksum trước/sau của toàn bộ hàng employees/bookings/assignments/booking_items/booking_status_history và users trừ password_hash khớp; dữ liệu vẫn 3 user, 2 employee, 5 booking, 6 assignment, 5 item, 0 lịch sử. Ba hash mới là scrypt; không cập nhật trạng thái/check-in/check-out. Kiểm tra này có phạm vi rõ ràng, không phải checksum toàn bộ 32 bảng hoặc audit bảo mật production.

Khóa tài khoản/employee, token hết hạn, login Admin và thuật toán/chữ ký sai đã có kiểm thử độc lập. **Chưa chạy live các tình huống khóa/expiry/Admin trên MySQL**, không thay trạng thái seed hoặc thêm Admin để diễn thử. Auth/User không có refresh/logout/thu hồi từng jti, MFA, quên mật khẩu, migration email hoặc rotation nhiều khóa; không báo các khả năng này đã hoàn tất. Rate limit hiện cục bộ một process, cần giải pháp phù hợp tại gateway khi scale hoặc đặt sau proxy.

```powershell
npm.cmd run test:unit
$env:RUN_AUTH_MYSQL_TESTS = 'true'
try { npm.cmd run test:mysql }
finally { Remove-Item Env:RUN_AUTH_MYSQL_TESTS -ErrorAction SilentlyContinue }

# Khi Auth và Staff thật đang chạy cùng test database:
$env:RUN_AUTH_LIVE_TESTS = 'true'
$env:RUN_AUTH_STAFF_HTTP_TESTS = 'true'
try { npm.cmd run test:live }
finally {
    Remove-Item Env:RUN_AUTH_LIVE_TESTS -ErrorAction SilentlyContinue
    Remove-Item Env:RUN_AUTH_STAFF_HTTP_TESTS -ErrorAction SilentlyContinue
}
```

MySQL/live mặc định bỏ qua khi chưa opt-in; bật mà thiếu input thì FAIL, không đổi thành API giả. Test live của Auth chỉ đọc dữ liệu và chạy Staff suite có sẵn với `RUN_STAFF_HTTP_WRITE_TESTS=false`. Không cần Order để đọc UC9–UC11. Ở giai đoạn Auth lịch sử này, UC12/worker còn chờ Order và Frontend chưa được nối JWT; Order và Frontend Staff đã được tích hợp trong các giai đoạn sau theo báo cáo Q01–Q06 ở đầu tài liệu. Không chạy lại test ghi trên fixture đã hoàn tất.

## File bàn giao

Các đường dẫn tính từ `backend/auth-service/`:

| File | Nội dung |
| --- | --- |
| `package.json`, `package-lock.json`, `.gitignore`, `.env.example` | Dependency khóa phiên bản, scripts và config công khai |
| `src/app.js`, `src/service.js` | HTTP/login/introspection, quyền/trạng thái và lỗi |
| `src/config.js`, `src/db.js`, `src/repository.js` | Cấu hình/schema/SQL theo users và employees |
| `src/password.js`, `src/tokens.js`, `src/credential-vault.js` | Scrypt, RS256/public JWKS và mã hóa credential kiểm thử |
| `src/runtime.js`, `src/server.js` | Startup với key/MySQL thật, shutdown |
| `scripts/generate-keys.js`, `scripts/provision-test-accounts.js` | Tạo khóa/cấp credential tường minh, có guard, không tự chạy khi startup |
| `scripts/http-tools.js`, `scripts/staff-tokens.js` | Login thật và lưu token riêng không in bí mật |
| `test/auth.test.js`, `test/crypto.test.js`, `test/credential-vault.test.js`, `test/repository.test.js` | Kiểm thử độc lập với crypto thật/dependency double có ghi nhãn |
| `test/mysql.integration.test.js`, `test/live.integration.test.js` | MySQL chỉ đọc và HTTP Auth → Staff thật, UC12 tắt |
| `docs/auth-contract.md`, `docs/staff-integration.md`, `README.md` | Contract, cấu hình, kết quả và hướng dẫn |

Private key, vault, `.env` và token là dữ liệu cục bộ ngoài Git, không thuộc file bàn giao source. Giữ nguyên Git chưa commit, không commit/push/merge.
