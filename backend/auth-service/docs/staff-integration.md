# Tích hợp Auth thật với Staff UC9–UC12

Contract Auth: [auth-contract.md](auth-contract.md). Contract phía Staff hiện có: [auth-integration.md](../../staff-service/docs/auth-integration.md) và [auth-handoff-checklist.md](../../staff-service/docs/auth-handoff-checklist.md).

Auth dùng `users.phone` để đăng nhập. Không có đăng nhập email trong schema hiện tại. Quyền lấy từ MySQL, chữ ký access token dùng RS256; private key chỉ được lưu tại Auth trong file/secret cục bộ đã được Git bỏ qua. Staff nhận public key hoặc JWKS, không nhận private key.

## Cập nhật bằng chứng local ngày 24/10/2026

Theo [báo cáo nghiệm thu UC12](../../../frontend/apps/staff/docs/UC12_E2E_QA_REPORT.md), luồng Browser → BFF → Auth/Staff → Order → MySQL thật trên `cleanhome_staff_test` đạt **43 nhóm E2E PASS, 0 FAIL, 0 SKIP, 0 NOT_RUN** cho Q01–Q06. Hồi quy HTTP riêng đạt **90 PASS, 0 FAIL, 1 SKIP** do thiếu fixture UC11 qua ranh ngày UTC/Việt Nam; không cộng hai lớp kiểm thử hoặc coi SKIP là PASS.

Sáu booking `9109151–9109156` đã COMPLETED, mười hai assignment `9109173–9109184` đã DONE, 36 journal mới đã ACK; giữ nguyên dữ liệu và không chạy lại workflow. Booking cũ `9109131` và `9109141` cũng đã COMPLETED. Muốn kiểm thử ghi thêm cần fixture và phạm vi được duyệt riêng.

Đây là bằng chứng local HTTP trên một máy; chưa kiểm chứng production, HTTPS/Secure cookie thực, tải lớn/stress/soak, nhiều host/replica hoặc crash/kill/mất điện/restore trong lượt Frontend này. Fault Q03–Q06 là mất kết nối/phản hồi thật, không phải crash tiến trình. Worker toàn database tắt. Kết quả không thay phê duyệt contract/PR của owner; các kết quả giai đoạn cũ phía dưới được giữ làm lịch sử.

## Dataset và mật khẩu kiểm thử

Chỉ sử dụng database riêng `cleanhome_staff_test` đã được người dùng khởi tạo/seed. Giữ nguyên dữ liệu 32 bảng, ID, phone marker, Customer/Employee/booking/assignment và trạng thái nghiệp vụ.

| Tài khoản | `users.id` / JWT `sub` | `users.phone` hiện có | Role | `employees.id` |
| --- | --- | --- | --- | --- |
| Staff A | `9109002` | `TEST-EMPLOYEE-UC9` | `EMPLOYEE` | `9109004` |
| Staff B | `9109101` | `TEST-EMPLOYEE-UC9-B` | `EMPLOYEE` | `9109102` |
| Customer | `9109001` | `TEST-CUSTOMER-UC9` | `CUSTOMER` | Không có |

Marker ở `password_hash` trong seed cũ không phải credential hợp lệ. Bước cấp credential của Auth chỉ được phép thay marker đã nhận diện của ba tài khoản trên bằng hash an toàn, sau khi kiểm tra database, ID/phone/role và liên kết employee. Không đổi role/trạng thái/phone, không tạo thêm tài khoản, không reset schema hoặc ghi vào booking/assignment.

Mật khẩu kiểm thử được sinh ngẫu nhiên; không có mật khẩu mặc định trong tài liệu hoặc mã nguồn. `secrets/test-accounts.json` là **envelope mã hóa AES-256-GCM**, khóa AES được bọc bằng **RSA-OAEP-SHA256** với khóa RSA của Auth; không lưu plaintext password trong file. Helper Auth dùng private key để giải mã trong bộ nhớ trước khi POST login thật, còn MySQL chỉ lưu scrypt hash. Không mở file để tìm mật khẩu hoặc đưa mật khẩu/token vào terminal, chat, log hay Git.

Nếu tài khoản đã có hash hợp lệ, giữ nguyên hash; không ghi đè chỉ để chạy lại test. File vault/private key vẫn cần được Git ignore và hạn chế quyền đọc. Giữ nguyên khóa RSA đang dùng vì mất/ghi đè khóa sẽ làm credential vault cũ không giải mã được; không tự chạy rotation tại chỗ để chữa lỗi login. Vault là công cụ kiểm thử cục bộ, không thay thế hệ thống quản lý credential/khóa production.

Không chạy lại seed/reset để khôi phục marker. Nếu mất credential hoặc hash không thuộc định dạng Auth hỗ trợ, cần quy trình đổi mật khẩu riêng được nhóm phê duyệt; không tự sửa dữ liệu khác.

## Cấu hình issuer, audience và khóa

Ví dụ cấu hình phát triển cục bộ dưới đây chỉ chứa URL/audience công khai, không phải bí mật. Thay nhất quán ở Auth và Staff nếu nhóm chọn giá trị khác:

```dotenv
JWT_ISSUER=http://localhost:4001
JWT_AUDIENCE=cleanhome-staff-api
```

Ở Staff Service:

```dotenv
JWT_ALGORITHM=RS256
JWT_ISSUER=http://localhost:4001
JWT_AUDIENCE=cleanhome-staff-api
JWT_JWKS_URL=http://127.0.0.1:4001/.well-known/jwks.json
JWT_PUBLIC_KEY=
JWT_SECRET=
AUTH_INTROSPECTION_URL=http://127.0.0.1:4001/api/v1/auth/introspect
```

`iss` là chuỗi định danh cấu hình nên `localhost` và `127.0.0.1` không tự thay thế cho nhau. JWKS/introspection là URL kết nối thực tế, có thể dùng loopback khác miễn tới đúng Auth Service. Khi triển khai liên máy, sử dụng URL HTTPS và secret manager phù hợp.

Nếu chọn PEM cố định, đặt `JWT_PUBLIC_KEY` bằng **public** PEM SPKI do Auth xuất ra và để `JWT_JWKS_URL` rỗng. Staff hỗ trợ ký tự `\n` để biểu diễn xuống dòng PEM trong `.env`. Không sao chép private PEM vào Staff hoặc template.

Không ghi đè `.env` Staff hiện có. Người vận hành điền các biến qua editor hoặc secret manager; có thể truyền biến môi trường ở tiến trình riêng để kiểm thử mà giữ nguyên file. Introspection là tùy chọn đối với Staff nhưng endpoint Auth hiện tại cho phép kiểm tra trạng thái mới từ MySQL. Nó không bổ sung thu hồi từng phiên/jti chưa có trong schema.

## Khởi động

Node.js 22 trở lên. Tại `backend/auth-service`, cài dependency từ lockfile và tạo `.env` cục bộ khi chưa có; không copy đè file đã tồn tại:

```powershell
npm.cmd ci
if (-not (Test-Path -LiteralPath '.env')) {
    Copy-Item -LiteralPath '.env.example' -Destination '.env'
}
```

Điền MySQL đúng database test, issuer/audience và đường dẫn private key qua cấu hình Auth. Các lệnh sinh khóa/cấp credential là bước thực hiện riêng có guard, không tự chạy khi `start`, không đặt private key hoặc mật khẩu trực tiếp vào dòng lệnh:

```dotenv
PORT=4001
MYSQL_DATABASE=cleanhome_staff_test
JWT_ISSUER=http://localhost:4001
JWT_AUDIENCE=cleanhome-staff-api
JWT_PRIVATE_KEY_FILE=secrets/auth-private.pem
JWT_KEY_ID=cleanhome-local-1
```

`JWT_KEY_ID` là định danh công khai, không phải khóa bí mật. Đặt theo metadata của bước sinh khóa nếu dùng giá trị khác. Các biến MySQL user/password được điền riêng trong `.env`, không có trong ví dụ. Sau khi đã kiểm tra cấu hình:

```powershell
npm.cmd run generate:keys
$env:AUTH_PROVISION_TEST_ACCOUNTS = 'true'
try { npm.cmd run provision:test }
finally { Remove-Item Env:AUTH_PROVISION_TEST_ACCOUNTS -ErrorAction SilentlyContinue }
npm.cmd start
```

`generate:keys` tạo private/public key và JWKS dưới vùng `secrets/` được ignore; từ chối ghi đè khóa đã có. `provision:test` chỉ nhắm database test và ba ID trong manifest, sinh mật khẩu ngẫu nhiên rồi lưu **credential đã mã hóa** ở `secrets/test-accounts.json` được ignore. Không in nội dung vault/private key hoặc tự giải mã ra file plaintext. Script từ chối thay đổi hash đăng nhập đã có; việc chạy lại không phải đặt lại mật khẩu. Auth mặc định cổng 4001. Xem [README Auth](../README.md) để đối chiếu script và kết quả kiểm thử thực tế.

Sau khi Auth sẵn sàng, tại `backend/staff-service` với MySQL/JWT đã cấu hình:

```powershell
npm.cmd run check:schema
npm.cmd start
```

Staff mặc định cổng 4005. Không cần Order để đọc UC9–UC11; UC10 có thể thiếu phần context/history tùy chọn và báo giới hạn đúng theo Staff hiện có. Giữ worker tắt khi chỉ kiểm thử đọc.

## Lấy token và chạy HTTP thật

Đăng nhập A/B/Customer qua `POST /api/v1/auth/login` bằng credential mới được cấp. Body `{phone,password,role?}`; giá trị `role` chỉ là điều kiện mong đợi, không cấp quyền. Không dùng marker hash làm mật khẩu, không tự ký JWT bên ngoài Auth, không dùng JWT unit test.

Không in response đăng nhập nguyên vẹn ra terminal vì chứa access token. Trong `backend/auth-service`, dùng helper giải mã credential vault trong bộ nhớ, gọi login thật và lưu ba token vào `secrets/tokens/` được ignore:

```powershell
npm.cmd run tokens:staff-test
```

Script đọc envelope mã hóa `secrets/test-accounts.json` cùng private key Auth cục bộ để giải mã trong bộ nhớ, rồi gọi Auth đang chạy; không tự ký token. Script chỉ log metadata đã loại bỏ bí mật, không xuất mật khẩu plaintext. Không truyền mật khẩu/token trên dòng lệnh. Endpoint JWKS chỉ trả public key và có thể kiểm tra công khai. Token mặc định hết hạn sau 15 phút, cần gọi login lại khi hết hạn.

Staff harness nhận token theo đúng một nguồn cho mỗi danh tính:

| Token | Biến token trực tiếp | Hoặc biến file token |
| --- | --- | --- |
| A | `STAFF_HTTP_TOKEN_A` | `STAFF_HTTP_TOKEN_A_FILE` |
| B | `STAFF_HTTP_TOKEN_B` | `STAFF_HTTP_TOKEN_B_FILE` |
| Customer | `STAFF_HTTP_TOKEN_CUSTOMER` | `STAFF_HTTP_TOKEN_CUSTOMER_FILE` |

Khi chạy từ `backend/staff-service`, có thể tham chiếu ba file được helper Auth tạo bằng các đường dẫn sau; không cần copy token vào Staff:

```dotenv
STAFF_HTTP_TOKEN_A_FILE=../auth-service/secrets/tokens/A.token
STAFF_HTTP_TOKEN_B_FILE=../auth-service/secrets/tokens/B.token
STAFF_HTTP_TOKEN_CUSTOMER_FILE=../auth-service/secrets/tokens/CUSTOMER.token
STAFF_HTTP_TOKEN_A=
STAFF_HTTP_TOKEN_B=
STAFF_HTTP_TOKEN_CUSTOMER=
```

Các file token chỉ chứa access token, không phải JSON credential/login response; đặt ngoài Git. Token cần còn hạn trong toàn bộ lượt chạy. Chỉ bật cờ đọc khi đã nhận JWT do Auth thật cấp và Staff cùng issuer/audience/khóa/MySQL:

```powershell
$env:RUN_STAFF_HTTP_TESTS = 'true'
$env:RUN_STAFF_HTTP_WRITE_TESTS = 'false'
try { npm.cmd run test:http }
finally {
    Remove-Item Env:RUN_STAFF_HTTP_TESTS -ErrorAction SilentlyContinue
    Remove-Item Env:RUN_STAFF_HTTP_WRITE_TESTS -ErrorAction SilentlyContinue
}
```

Chạy từ `backend/staff-service`. Test đọc cần chứng minh 401 thiếu token; 403 Customer; 404 A/B xem assignment của nhau, kể cả cùng booking; UC9 lọc/sort/phân trang; UC10 chi tiết; UC11 ngày Việt Nam. Chi tiết guard và giới hạn: [hướng dẫn HTTP Staff](../../staff-service/docs/http-integration-testing.md).

## Kết quả giai đoạn triển khai Auth (lịch sử)

Lượt này đã chạy Auth thật cổng 4001 và Staff thật cổng 4005, cùng database `cleanhome_staff_test`. Auth ký RS256 bằng khóa RSA 3072 bit cục bộ; Staff sử dụng JWKS và introspection HTTP thật. Dữ liệu cấp credential chỉ đổi ba `password_hash` marker sang scrypt; giữ phone/ID/role và dữ liệu công việc. Lượt HTTP đọc có đối chiếu hash trước/sau trên các trường liên quan của users, employees, bookings, assignments, booking_items và booking_status_history; không ghi nhận thay đổi ở phạm vi đối chiếu.

| Bộ kiểm thử | PASS | FAIL | SKIP | Phạm vi |
| --- | ---: | ---: | ---: | --- |
| Unit Auth | 46 | 0 | 0 | Mật khẩu, RS256/claims/expiry, vault mã hóa, repository, login/role/trạng thái và lỗi HTTP độc lập |
| Auth MySQL | 6 | 0 | 0 | Schema, credential đã cấp và liên kết tài khoản/nhân viên trong MySQL thật |
| Auth HTTP live | 10 | 0 | 0 | Health, public JWKS, ba login thật, mật khẩu sai, chống nâng quyền, email không hỗ trợ, introspection và gọi suite Staff |
| Staff HTTP được suite Auth gọi | 8 | 0 | 1 | Đọc UC9–UC11, quyền A/B/Customer; **nhánh UC12 ghi bị SKIP** |

Hai dòng HTTP có quan hệ cha/con: dòng Auth có một kiểm tra gọi suite Staff, dòng Staff phân rã kết quả suite con. Không cộng chúng để tuyên bố số endpoint độc lập hoặc coi SKIP là PASS. Kết quả unit/MySQL không thay thế HTTP.

Đã kiểm chứng qua HTTP thật: A/B chỉ lấy công việc của mình; Customer bị 403; truy cập chéo assignment bị 404; lọc/sắp xếp/phân trang và lịch Việt Nam đúng. Booking có nhiều nhân viên vẫn giới hạn theo assignment của từng người. Chi tiết A/B trả dữ liệu từ MySQL hiện có. Không gọi PATCH UC12, không chạy worker, không giả Order Service.

**Giới hạn của lượt Auth lịch sử**: chưa kiểm thử live với MySQL thật các tài khoản bị khóa/ngừng hoạt động, token chờ hết hạn và đăng nhập Admin hợp lệ; không đổi trạng thái seed hoặc thêm Admin để chạy HTTP. Rotation JWKS và thu hồi từng phiên chưa được chứng minh trong lượt này. UC12 với Order thật về sau đã được nghiệm thu local theo cập nhật ở đầu tài liệu; không gộp bằng chứng các giai đoạn.

## Chạy lại kiểm thử Auth

Tại `backend/auth-service` với `.env` cục bộ phù hợp:

```powershell
npm.cmd run test:unit
$env:RUN_AUTH_MYSQL_TESTS = 'true'
try { npm.cmd run test:mysql }
finally { Remove-Item Env:RUN_AUTH_MYSQL_TESTS -ErrorAction SilentlyContinue }
```

Khi Auth và Staff thật đều đang chạy, có credential cục bộ, cùng database test và cấu hình JWT:

```powershell
$env:RUN_AUTH_LIVE_TESTS = 'true'
$env:RUN_AUTH_STAFF_HTTP_TESTS = 'true'
try { npm.cmd run test:live }
finally {
    Remove-Item Env:RUN_AUTH_LIVE_TESTS -ErrorAction SilentlyContinue
    Remove-Item Env:RUN_AUTH_STAFF_HTTP_TESTS -ErrorAction SilentlyContinue
}
```

Auth live runner giải mã credential vault cục bộ trong bộ nhớ để đăng nhập thật ba tài khoản, xác minh JWKS thật rồi truyền token sang suite Staff bằng môi trường tiến trình con. Nó giữ `RUN_STAFF_HTTP_WRITE_TESTS=false` và không thay Staff source/`.env`. Không bật cờ live khi dependency chưa sẵn sàng rồi báo SKIP là đạt.

## Giới hạn và phần bàn giao

- Auth không triển khai thay Order Service bốn API transition/ack/pending. Bốn API hiện đã có implementation Order và bằng chứng Backend local trong README Order. Q01–Q06 kiểm Frontend qua lookup/apply/ack; worker toàn database tắt, không chứng minh riêng pending/global worker. Không bật worker hoặc chạy ghi thêm trên dữ liệu dùng chung chỉ vì đã có kết quả trước đó. Không dùng API giả để có kết quả 200.
- Giai đoạn Auth này không sửa Frontend. Ở giai đoạn tích hợp sau, Staff Frontend đăng nhập phone qua BFF, JWT giữ ở server và UC9–UC12 gọi REST thật; dữ liệu localStorage cũ được giữ nguyên. Không suy rộng kết quả Staff sang Customer/Admin; CORS không thay xác thực và phân quyền.
- Schema chưa có email, refresh token, phiên đăng nhập/thu hồi jti, khóa nhiều lần thử theo tài khoản, hoặc password reset token. Không thêm bảng/cột ngoài tài liệu gốc; các khả năng này cần thiết kế/migration riêng nếu được duyệt.
- Khóa user hoặc employee được kiểm tra từ MySQL ở login/introspection và mỗi nghiệp vụ Staff. Không thay đổi tài khoản đang dùng chỉ để diễn thử tình huống khóa; test cần fixture độc lập có kiểm soát.
- Unit test, MySQL repository test và HTTP Auth → Staff là ba bằng chứng khác nhau. Chỉ báo endpoint HTTP đạt sau khi thực sự gọi service với JWT do Auth phát hành. Kết quả hiện tại và phần chưa kiểm chứng được ghi trong README Auth sau lượt chạy thực tế.

Bàn giao cho nhóm: [contract Auth](auth-contract.md), tài liệu này, README Auth với cấu hình/scripts chính xác, issuer/audience và URL public JWKS/introspection. Credential/private key/token chỉ chuyển qua kênh riêng được phép, không đưa vào tài liệu bàn giao.
