# Contract Auth Service — CleanHome

Auth dùng các bảng `users` và `employees` hiện có trong `databases/schema.sql`. Không bổ sung cột, bảng, email, phiên đăng nhập hoặc cơ chế refresh ngầm. `user-service` và `order-service` tiếp tục thuộc phạm vi riêng.

## Định danh và trạng thái

| Dữ liệu | Quy tắc |
| --- | --- |
| Đăng nhập | `users.phone` và mật khẩu; schema chưa có email |
| Danh tính JWT | `sub` là chuỗi canonical của **`users.id`**, không phải `employees.id`; trong miền BIGINT signed dương |
| Vai trò | `CUSTOMER`, `EMPLOYEE`, `ADMIN`, lấy từ MySQL; client không được tự chọn quyền |
| Trạng thái | Chỉ `users.status=ACTIVE` được đăng nhập; `LOCKED` và các trạng thái khác bị từ chối |
| Nhân viên | Ngoài user ACTIVE/EMPLOYEE, cần hồ sơ `employees.user_id=users.id` và `employees.status=ACTIVE` |
| Mật khẩu | Chỉ lưu password hash có salt ngẫu nhiên; không lưu mật khẩu plaintext trong MySQL |

Trong dataset kiểm thử Staff, trường `phone` chứa marker `TEST-EMPLOYEE-UC9`, `TEST-EMPLOYEE-UC9-B` và `TEST-CUSTOMER-UC9`. Đây là định danh đã có trong database kiểm thử, không phải số điện thoại thật. Auth tra đúng giá trị `phone`; không đổi các marker hoặc ID để làm kiểm thử đi qua. Chính sách chuẩn hóa số điện thoại thực tế cần được nhóm thống nhất khi triển khai đăng ký/quản lý tài khoản.

Định dạng mật khẩu hiện được hỗ trợ là scrypt có phiên bản, `N=131072`, `r=8`, `p=1`, salt ngẫu nhiên 16 byte, kết quả 32 byte; so sánh bằng `timingSafeEqual`. Giới hạn bộ nhớ mỗi phép scrypt là 192 MiB. Hàm tạo mật khẩu yêu cầu 16–128 ký tự, tối đa 512 byte UTF-8; API đăng nhập vẫn xác minh mật khẩu ngắn hơn nếu đã có hash hợp lệ để tránh tự thay chính sách tài khoản cũ. Hash marker/plaintext/định dạng khác bị từ chối; không tự coi marker là credential, nâng cấp hash ngầm hoặc ghi đè hash bcrypt/Argon2 của nguồn khác.

Credential của ba tài khoản kiểm thử được lưu ở `secrets/test-accounts.json` dưới dạng **envelope mã hóa AES-256-GCM**, khóa AES được bọc bằng **RSA-OAEP-SHA256** với khóa RSA của Auth. File không chứa mật khẩu plaintext. Helper Auth giải mã bằng private key trong bộ nhớ rồi gọi login HTTP thật; MySQL chỉ lưu scrypt hash. Private key cần được giữ an toàn để mở credential kiểm thử, không chuyển sang Staff hoặc đưa vào Git.

## API đăng nhập

`POST /api/v1/auth/login`, `Content-Type: application/json`:

```json
{
  "phone": "<giá trị users.phone đã được cấp>",
  "password": "<mật khẩu được cấp qua kênh riêng>",
  "role": "EMPLOYEE"
}
```

`role` tùy chọn là vai trò **mong đợi**, dùng để từ chối tài khoản thuộc khu vực khác. Nó không ghi vào database, không cấp quyền và không thay thế vai trò được đọc từ `users.role`. Bỏ trường này để đăng nhập theo vai trò thực tế của tài khoản. Không gửi email, employee ID hoặc user ID thay cho `phone`.

Đăng nhập thành công trả JSON:

```json
{
  "accessToken": "<access token do Auth phát hành>",
  "tokenType": "Bearer",
  "expiresIn": 900,
  "user": {"id":"9109002","role":"EMPLOYEE","status":"ACTIVE"}
}
```

`expiresIn` phản ánh cấu hình thời hạn thực tế; 900 là giá trị mặc định. Response không trả `password_hash`, private key hoặc thông tin hồ sơ không cần thiết. Không lưu token vào log, ảnh chụp, tài liệu hay Git.

| HTTP / mã lỗi | Trường hợp |
| --- | --- |
| `400` | Body hoặc trường đăng nhập không hợp lệ |
| `401` | Không tồn tại tài khoản hoặc mật khẩu không đúng; không tiết lộ trường nào sai |
| `403 ACCOUNT_LOCKED` | Tài khoản không ACTIVE |
| `403 ROLE_MISMATCH` | Mật khẩu hợp lệ nhưng vai trò thực tế không khớp `role` mong đợi |
| `403 EMPLOYEE_INACTIVE` | Tài khoản EMPLOYEE thiếu hồ sơ nhân viên hoạt động |

Mã lỗi dependency, rate limit và introspection xem README/bộ kiểm thử; lỗi không trả SQL, hash, token hoặc stack trace cho client.

Điều kiện khóa/vai trò/hồ sơ được kiểm tra sau khi xác minh mật khẩu; mật khẩu sai vẫn trả 401, không dùng thông báo trạng thái để dò tài khoản. JSON lỗi có dạng `{error:{code,message},requestId}`; client dùng `error.code` để xử lý, không dựa vào chuỗi tiếng Việt. Giới hạn login hiện tại trả `429 LOGIN_RATE_LIMITED`, có `Retry-After`; body quá lớn trả 413, JSON hỏng trả 400, MySQL không khả dụng trả `503 DATABASE_UNAVAILABLE`.

## Access token RS256

| Header/claim | Giá trị |
| --- | --- |
| `alg` | `RS256`; không tự chuyển sang HMAC hoặc `none` |
| `kid` | Định danh khóa public trong JWKS của chính Auth Service |
| `iss` | Khớp chính xác `JWT_ISSUER` đã cấu hình ở Auth và Staff |
| `aud` | Có audience khớp `JWT_AUDIENCE` dành cho Staff API |
| `sub` | Chuỗi `users.id` canonical, không có dấu/khoảng trắng/số 0 đầu |
| `userId` | Cùng giá trị với `sub`; claim bổ sung, không thay thế `sub` |
| `role` | Vai trò thực tế từ MySQL: `CUSTOMER`, `EMPLOYEE` hoặc `ADMIN` |
| `status`, `active`, `locked` | Lần lượt `ACTIVE`, boolean `true`, boolean `false` tại thời điểm cấp |
| `iat`, `exp` | Thời điểm cấp và hết hạn theo giây Unix |
| `jti` | Định danh token ngẫu nhiên; hiện chưa có kho thu hồi riêng theo jti |

Staff chỉ nhận token EMPLOYEE/STAFF theo middleware đang có và tra lại trạng thái user/employee trong MySQL ở mỗi nghiệp vụ. Auth phát hành vai trò chuẩn `EMPLOYEE`; không cần đổi tên role thành `STAFF`. Token Customer/Admin được ký hợp lệ vẫn không có quyền gọi Staff API.

Access token mặc định hết hạn sau **900 giây**, thời hạn được cấu hình rõ tại Auth. Đồng bộ giờ hệ thống giữa các service; Staff dùng `clockTolerance=0`. Không tự sửa `exp`, ký token bằng khóa unit test hoặc tắt middleware để khắc phục lỗi tích hợp.

## Public key/JWKS

`GET /.well-known/jwks.json` trả bộ khóa công khai RSA theo cấu trúc JWKS. Khóa ký private chỉ thuộc Auth Service; endpoint không trả các thành phần bí mật RSA.

Staff cấu hình đúng **một** nguồn xác minh:

- `JWT_JWKS_URL`: URL endpoint JWKS thật.
- Hoặc `JWT_PUBLIC_KEY`: PEM SPKI public key, để trống `JWT_JWKS_URL`.

Không đặt public key vào `JWT_SECRET`. Với RS256, để `JWT_SECRET` trống. Thông tin issuer/audience và khóa xác minh phải cùng môi trường với token.

Hiện chưa có quy trình rotation tự động bảo đảm giữ nhiều khóa cũ đồng thời. Khi thay khóa cần kế hoạch giữ khóa cũ cho tới khi token hết hạn và cache JWKS hết hiệu lực; không coi việc đổi file PEM rồi khởi động lại là rotation không gián đoạn đã được kiểm chứng.

Credential test vault cũng phụ thuộc private key đã dùng để bọc khóa AES. Không ghi đè/xóa khóa đó để sinh khóa mới: có thể làm vault cũ không giải mã được. Cơ chế dùng khóa Auth cho vault là phạm vi kiểm thử cục bộ; triển khai thực tế cần quản lý khóa/kho credential riêng và kế hoạch chuyển khóa được duyệt.

## Introspection cho Staff

`GET /api/v1/auth/introspect` với `Authorization: Bearer <access token>`.

Auth xác minh chữ ký RS256, issuer/audience, thời hạn và danh tính; tiếp tục đọc MySQL để kiểm tra vai trò/trạng thái hiện tại. Thành công trả JSON object **ở cấp cao nhất**, tương thích Staff:

```json
{"sub":"<users.id>","role":"EMPLOYEE","active":true,"status":"ACTIVE","locked":false}
```

Không bọc các trường bắt buộc này trong `data` hay `user`. Customer/Admin hợp lệ có thể được introspect theo vai trò thực tế, nhưng Staff middleware vẫn trả 403 vì không phải EMPLOYEE.

Staff dùng `AUTH_INTROSPECTION_URL` để bật bước này. Khi bật, lỗi Auth/timeout phải được từ chối an toàn; không bỏ qua introspection khi dependency lỗi. Endpoint này là contract GET nội bộ của CleanHome, không tuyên bố triển khai giao thức OAuth token introspection chuẩn POST.

Introspection phản ánh trạng thái tài khoản/hồ sơ hiện tại; chưa có logout, refresh token, blacklist jti hoặc thu hồi một phiên riêng. Xóa token khỏi trình duyệt không làm token Backend tự hết hạn. Không trình bày các khả năng này là đã triển khai.

Token thiếu/sai/hết hạn trả `401 UNAUTHENTICATED`. Tài khoản/hồ sơ ngừng hoạt động trả 403; vai trò MySQL thay đổi so với token trả `403 ROLE_CHANGED` thay vì tiếp tục tin quyền cũ. Dependency MySQL không đọc được trả 503.

## Health và phạm vi kiểm chứng

- `GET /health/live`: tiến trình HTTP còn hoạt động.
- `GET /health/ready`: kiểm tra khả năng phục vụ theo điều kiện sẵn sàng của Auth, gồm MySQL/schema/khóa đã được nạp.

Health 200 không chứng minh endpoint Staff, Order, Gateway hoặc Frontend đã tích hợp. Phân biệt kết quả unit, MySQL, HTTP Auth thật và HTTP Auth → Staff thật trong báo cáo kiểm thử. UC12 còn cần Order Service đúng contract; Auth không ghi trạng thái booking/assignment thay Order.

## Endpoint đã kiểm chứng trong lượt triển khai

Các kết quả dưới đây dùng Auth Service đang chạy tại cổng 4001, MySQL `cleanhome_staff_test`, khóa RSA 3072 bit sinh cục bộ và token được cấp qua đăng nhập thật. Không dùng JWT tự ký bên ngoài Auth hoặc middleware thay thế.

| Endpoint | Kết quả HTTP thực tế |
| --- | --- |
| `GET /health/live` | 200, đúng service Auth |
| `GET /health/ready` | 200 với schema/MySQL hiện tại |
| `GET /.well-known/jwks.json` | 200, RSA/RS256, không chứa thành phần private |
| `POST /api/v1/auth/login` | A/B/Customer đăng nhập 200; mật khẩu sai/phone không tồn tại 401; Customer yêu cầu EMPLOYEE/ADMIN 403; gửi email thay phone 400 |
| `GET /api/v1/auth/introspect` | Token thật A/B/Customer trả 200 đúng danh tính; thiếu/sửa token trả 401 |

Token từ Auth đã được Staff xác minh qua **JWKS và introspection thật** để kiểm tra đọc UC9–UC11. Khóa/ngừng hoạt động, expiry và đăng nhập Admin hợp lệ được kiểm chứng ở unit test; **chưa chạy các tình huống đó với tài khoản MySQL thật** vì không đổi trạng thái fixture hoặc tạo Admin chỉ để kiểm thử. Chưa kiểm chứng rotation nhiều khóa, thu hồi phiên hoặc UC12 với Order thật.
