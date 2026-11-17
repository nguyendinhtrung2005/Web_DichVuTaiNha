# Tích hợp Auth thật với Staff Service

Tài liệu này hướng dẫn cấu hình middleware đang có trong `src/auth.js`, không triển khai hoặc thay thế Auth Service. Staff Service chỉ xác minh access token và quyền nhân viên; không có endpoint cấp token, đăng nhập bằng mật khẩu hoặc chế độ bỏ qua xác thực. Contract chi tiết giữa hai thành viên: [auth-contract.md](./auth-contract.md).

Khi chuẩn bị token và dataset để kiểm thử với thành viên Auth, dùng [checklist bàn giao Auth](./auth-handoff-checklist.md) để ghi rõ đầu vào còn thiếu và kết quả đã kiểm chứng.

## 1. Thông tin cần nhận từ thành viên Auth

Thống nhất issuer, audience dành cho Staff API, thuật toán **RS256**, cách lấy public key/JWKS và cấu trúc claim. Thành viên Auth phải cấp token cho một `users.id` thật có hồ sơ `employees` hoạt động trong MySQL mà Staff Service đọc. Tài khoản demo trong localStorage Frontend không tự trở thành danh tính Backend.

Staff Service không nhận private key của Auth và không tự sinh token dùng cho vận hành. Public key chỉ dùng kiểm tra chữ ký; private key vẫn thuộc Auth Service. Không chép access token, private key, mật khẩu hoặc nội dung `.env` vào tài liệu, Git, ảnh chụp hoặc log.

| Cấu hình | Giá trị cần thống nhất |
| --- | --- |
| `JWT_ALGORITHM` | `RS256`; middleware chỉ chấp nhận đúng thuật toán đã cấu hình |
| `JWT_ISSUER` | Chuỗi issuer chính xác do Auth công bố; phải khớp `iss` |
| `JWT_AUDIENCE` | Audience chính xác dành cho Staff API; phải khớp `aud` của token |
| `JWT_PUBLIC_KEY` | Public key RSA ở định dạng PEM SPKI nếu xác minh bằng khóa cố định |
| `JWT_JWKS_URL` | URL JWKS thật do Auth cung cấp nếu dùng bộ khóa/rotation |
| `AUTH_INTROSPECTION_URL` | Tùy chọn; chỉ đặt khi Auth đã thực hiện contract GET ở mục 4 |

Với RS256, phải đặt **đúng một** trong `JWT_PUBLIC_KEY` và `JWT_JWKS_URL`; để trống trường còn lại và `JWT_SECRET`. Config hỗ trợ ký tự `\n` trong giá trị public key để chuyển thành xuống dòng PEM. Nếu dùng JWKS, Auth cần công bố khóa RSA xác minh tương ứng với token, gồm `kid` phù hợp khi chọn khóa. Không tự đặt URL giả rồi coi là Auth đã triển khai. Dùng HTTPS cho các kết nối liên dịch vụ trong môi trường triển khai thực tế; code hiện cho phép HTTP để phát triển hoặc dùng mạng nội bộ được cấu hình.

HS256 vẫn được hỗ trợ theo [auth-contract.md](./auth-contract.md), yêu cầu secret từ môi trường tối thiểu 32 byte và phải thống nhất riêng với Auth. Không dùng public key làm HMAC secret hoặc chuyển thuật toán để cho một token không hợp lệ đi qua.

## 2. Claim mà JWT phải đáp ứng

| Claim | Quy tắc thực tế trong middleware |
| --- | --- |
| `iss` | Khớp `JWT_ISSUER` |
| `aud` | Có audience khớp `JWT_AUDIENCE`; thư viện JWT hỗ trợ claim audience chuỗi hoặc mảng theo chuẩn |
| `sub` | Chuỗi `users.id`, không phải `employees.id`; số thập phân dương canonical trong khoảng `1` đến `9223372036854775807` |
| `exp` | Bắt buộc, thời điểm hết hạn tính bằng giây Unix và chưa hết hạn |
| `nbf` | Không bắt buộc; nếu có thì token chỉ được dùng từ thời điểm này |
| `role` | `EMPLOYEE` hoặc `STAFF`, không phân biệt hoa thường; ánh xạ thành `req.actor.role = 'staff'` |

`sub` không được là số JSON, không có dấu, khoảng trắng, số 0 đầu, phần thập phân hoặc hậu tố chữ. Quy tắc này ngăn MySQL ép những chuỗi như `100abc` thành ID của người khác. Middleware không tin `userId`, `staffId`, `employeeId`, `X-User-Id` hoặc `X-Role` do client tự khai báo. Danh tính dùng để tra cứu chỉ đến từ `sub` trong JWT đã xác minh chữ ký.

Các claim trạng thái không bắt buộc phải hiện diện. **Nếu có**, kiểu và giá trị phải đúng:

- `locked` và `isLocked`: boolean `false`.
- `active` và `isActive`: boolean `true`.
- `status` và `accountStatus`: chuỗi `ACTIVE` hoặc `ENABLED`, không phân biệt hoa thường.

Không dùng chuỗi `"false"` hoặc `"true"` thay boolean. Claim khóa, ngừng hoạt động, sai kiểu hoặc mâu thuẫn đều bị từ chối. Role ngoài Staff/Employee bị từ chối dù chữ ký token hợp lệ.

Không có khoảng dung sai thời gian trong xác minh hiện tại (`clockTolerance: 0`); cần đồng bộ giờ hệ thống của Auth và Staff Service. Token đã hết hạn cần được cấp lại theo luồng thật của Auth, không sửa payload hay bỏ kiểm tra `exp`.

## 3. Kiểm tra trạng thái hiện tại trong MySQL

JWT hợp lệ chưa đủ để truy cập dữ liệu công việc. Mỗi nghiệp vụ lấy `employees` từ `employees.user_id = JWT.sub`, đồng thời đọc `users.role` và `users.status` qua JOIN. Service chỉ cho phép khi:

- Có hồ sơ nhân viên tương ứng.
- `employees.status === 'ACTIVE'`.
- `users.status === 'ACTIVE'`.
- `users.role` là `EMPLOYEE` hoặc `STAFF`.

Điều kiện này được kiểm tra lại từ database, giúp chặn tài khoản đã khóa hoặc ngừng làm việc dù access token cũ chưa hết hạn. Assignment tiếp tục được giới hạn theo ID nhân viên vừa tra cứu, không cho client lựa chọn nhân viên khác. Không sửa role hoặc kích hoạt tài khoản bằng request tới Staff Service; những thao tác đó thuộc service/thành viên quản lý tương ứng.

Schema và quyền đọc MySQL phải đúng với `databases/schema.sql` đã được cung cấp. `npm.cmd run check:schema` kiểm tra tính tương thích; server cũng kiểm tra schema trước khi mở cổng. Không chạy migration/reset dữ liệu để chữa lỗi đăng nhập. Kiểm tra database không thay thế cơ chế thu hồi phiên của Auth.

## 4. Introspection tùy chọn và giới hạn thu hồi phiên

Nếu Auth hỗ trợ kiểm tra access token hiện tại theo contract đã thống nhất, cấu hình `AUTH_INTROSPECTION_URL` bằng URL thật. Sau xác minh JWT, Staff gửi **GET** tới URL đó với `Authorization: Bearer <access token>` và `Accept: application/json`, timeout **5 giây**, không theo redirect.

Response thành công phải là JSON object có `sub` cùng danh tính JWT, `role` vẫn là Staff/Employee và `active: true` đúng kiểu boolean. Có thể thêm các claim trạng thái ở mục 2. Contract này là adapter của dự án, **không phải khẳng định đã có endpoint introspection trong Auth Service**, và không phải giao thức POST introspection mặc định của OAuth.

Khi đã bật, middleware từ chối an toàn nếu Auth không trả được kết quả: lỗi mạng, timeout, JSON không đọc được, body sai cấu trúc hoặc lỗi dependency trả `503`; Auth trả `401/403` thì giữ mã tương ứng. Không bỏ qua kiểm tra để request tiếp tục khi Auth lỗi. Khác `sub` bị từ chối `401`, role hoặc trạng thái bị thu hồi bị từ chối `403`.

Nếu Auth chưa hỗ trợ contract này, để trống biến. Khi đó JWT và trạng thái user/employee trong MySQL vẫn được kiểm tra, nhưng **chưa xác minh logout/thu hồi một phiên riêng trên Auth theo thời gian thực**. Không coi việc Frontend xóa phiên localStorage là bằng chứng Backend đã thu hồi access token.

## 5. Chuẩn bị và chạy với Node.js 22+

Trong PowerShell, từ `backend/staff-service`:

```powershell
node --version
npm.cmd ci
if (-not (Test-Path -LiteralPath '.env')) {
    Copy-Item -LiteralPath '.env.example' -Destination '.env'
}
```

Lệnh trên chỉ tạo `.env` khi chưa có, không ghi đè cấu hình hiện hữu. Sửa file cục bộ bằng editor để đặt cấu hình MySQL và Auth do nhóm cung cấp. Không chạy lệnh in toàn bộ `.env` hoặc dump biến môi trường. Script đã dùng `--env-file-if-exists=.env`; biến môi trường do tiến trình triển khai cung cấp cũng được hỗ trợ.

Giữ `CORS_ORIGINS=http://localhost:3002` khi phát triển giao diện Staff tại cổng 3002. Nếu cần nhiều origin thật, liệt kê phân cách bằng dấu phẩy, mỗi mục chỉ có scheme/host/port, không có path và không dùng `*`. CORS chỉ kiểm soát trình duyệt; nó không thay xác thực JWT hay quyền sở hữu assignment.

Sau khi cấu hình đủ:

```powershell
npm.cmd run check:schema
npm.cmd start
```

Mặc định server dùng cổng `4005`. Thiếu issuer, audience, thuật toán, nguồn khóa JWT hoặc thông tin MySQL bắt buộc sẽ làm startup thất bại; **không có chế độ tự bỏ qua Auth để chạy production**. Thiếu kết nối/schema MySQL phù hợp cũng chặn server trước khi listen.

Cần phân biệt cấu hình Auth với khả dụng của Auth: public key PEM được import bất đồng bộ khi middleware được tạo, JWKS được tải khi có request cần khóa. Vì vậy, cấu hình không rỗng chưa chứng minh PEM hợp lệ hoặc JWKS/Auth đang online; startup hiện không có bước preflight Auth từ xa. Một public key sai có thể khiến mọi request trả `401`; JWKS không khả dụng có thể khiến request trả `503`. Phải kiểm tra bằng token Auth thật trước khi công bố sẵn sàng tích hợp.

Để kiểm tra endpoint, lấy access token qua luồng đăng nhập thật do thành viên Auth bàn giao và cấp nó vào môi trường tiến trình an toàn. Ví dụ dưới đây chỉ tham chiếu biến, không chứa hoặc in token:

```powershell
$staffHeaders = @{ Authorization = ('Bearer ' + $env:STAFF_ACCESS_TOKEN) }
Invoke-RestMethod -Method Get -Uri 'http://localhost:4005/api/v1/staff/me/jobs' -Headers $staffHeaders
```

Không đặt token trực tiếp vào lệnh lưu trong lịch sử shell hoặc screenshot. Không dùng token lấy từ fixture/unit test cho website hoặc API thật. Khi Auth chưa cấp token thực tế và thông tin xác minh tương ứng, đánh dấu tích hợp Auth chưa kiểm chứng; không thêm middleware giả để vượt qua.

## 6. Phân biệt lỗi và kiểm thử

| HTTP | Trường hợp cần đối chiếu |
| --- | --- |
| `401` | Thiếu/sai Bearer token, chữ ký/algorithm/issuer/audience sai, hết hạn, chưa tới `nbf`, thiếu `exp`, `sub` không hợp lệ; introspection trả 401 hoặc đổi danh tính |
| `403` | JWT hợp lệ nhưng role/trạng thái không đủ quyền; không có hồ sơ nhân viên hoạt động; user/employee MySQL bị khóa/ngừng hoạt động; introspection từ chối quyền |
| `503` | Dependency xác thực hoặc dữ liệu không đọc được; kiểm tra thêm mã lỗi và log sự kiện không chứa thông tin nhạy cảm |
| `404` | Assignment không tồn tại hoặc không thuộc nhân viên, theo chính sách tránh tiết lộ tài nguyên của người khác |

Chạy riêng bộ kiểm thử xác thực/config:

```powershell
node --test test/auth.test.js
```

Test ký và xác minh JWT bằng key sinh ngẫu nhiên trong tiến trình, bao gồm HS256/RS256, giả mạo, expiry/issuer/audience/algorithm, subject BIGINT, quyền và introspection lỗi. Đây là kiểm thử mật mã thật với dữ liệu test; HTTP Auth dependency trong test dùng stub. **Kết quả unit test không chứng minh Auth Service, JWKS production, key rotation, MySQL hoặc Gateway đã tích hợp end-to-end.**

Trước khi bàn giao tích hợp thật, hai thành viên cần kiểm chứng: token do Auth cấp truy cập được đúng nhân viên; token khác nhân viên không đọc assignment của người khác; khóa user/employee đang hoạt động bị chặn; token hết hạn/thu hồi bị chặn theo cơ chế đã chọn; JWKS/rotation và lỗi Auth được xử lý đúng; CORS đúng origin Staff. Ghi rõ môi trường và phần đã kiểm chứng, không log token hoặc thông tin đăng nhập để làm bằng chứng.
