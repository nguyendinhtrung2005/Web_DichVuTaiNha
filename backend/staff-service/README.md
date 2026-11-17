# CleanHome — Staff Service UC9–UC12

Express/JavaScript (ES modules), Node.js 22+, MySQL 8.0+, REST `/api/v1`.
Chỉ phục vụ nhân viên: xem công việc, chi tiết, lịch và cập nhật tiến độ. Frontend Staff đã tích hợp qua BFF trong các giai đoạn sau; service này không xóa hoặc reset dữ liệu localStorage cũ.

**Mốc lịch sử kiểm thử nhiều nhân viên 23/10/2026:** khi mới chạy seed bổ sung có 2 nhân viên, 5 booking, 6 assignment; 99 kiểm thử độc lập và 28 kiểm thử MySQL đạt, HTTP thật khi đó có 1 suite SKIP và không chạy UC12 ghi. Xem [báo cáo giai đoạn đó](docs/multi-employee-testing.md#kết-quả-kiểm-thử-sau-khi-người-dùng-chạy-seed) và [hướng dẫn HTTP](docs/http-integration-testing.md). Đây không phải tổng dữ liệu hoặc trạng thái tích hợp hiện tại.

## Cập nhật bằng chứng local ngày 24/10/2026

Theo [báo cáo nghiệm thu UC12](../../frontend/apps/staff/docs/UC12_E2E_QA_REPORT.md), luồng Browser → BFF → Auth/Staff → Order → MySQL thật trên `cleanhome_staff_test` đạt **43 nhóm E2E PASS, 0 FAIL, 0 SKIP, 0 NOT_RUN** cho Q01–Q06. Hồi quy HTTP riêng đạt **90 PASS, 0 FAIL, 1 SKIP** do thiếu fixture UC11 qua ranh ngày UTC/Việt Nam; không cộng hai lớp kiểm thử hoặc coi SKIP là PASS.

Sáu booking `9109151–9109156` đã COMPLETED, mười hai assignment `9109173–9109184` đã DONE, 36 journal mới đã ACK; giữ nguyên dữ liệu và không chạy lại workflow. Booking cũ `9109131` và `9109141` cũng đã COMPLETED. Muốn kiểm thử ghi thêm cần fixture và phạm vi được duyệt riêng.

Đây là bằng chứng local HTTP trên một máy; chưa kiểm chứng production, HTTPS/Secure cookie thực, tải lớn/stress/soak, nhiều host/replica hoặc crash/kill/mất điện/restore trong lượt Frontend này. Fault Q03–Q06 là mất kết nối/phản hồi thật, không phải crash tiến trình. Worker toàn database tắt. Kết quả không thay phê duyệt contract/PR của owner; các kết quả giai đoạn cũ phía dưới được giữ làm lịch sử.

## Nguồn schema và phạm vi ghi

`../../databases/schema.sql` được trích nguyên khối SQL từ tài liệu người dùng cung cấp **CSDL_Dich_vu_ve_sinh_MySQL.docx**, gồm 32 bảng. Không bổ sung cột, bảng hoặc seed. Service không tự chạy DDL, reset, `DROP`, `TRUNCATE` hay tắt kiểm tra khóa ngoại.

Fixture tùy chọn nằm riêng tại `../../databases/seed_staff_test.sql`; chỉ dành cho `cleanhome_staff_test`, không nằm trong schema gốc và không tự chạy. Đọc [hướng dẫn dữ liệu kiểm thử](docs/test-data.md) trước khi tự nhập bằng MySQL Workbench. Seed cung cấp chín bản ghi FK tối thiểu, dùng marker không đăng nhập được. Người dùng đã nhập seed thủ công; bộ kiểm tra bổ sung chỉ đọc các bản ghi này.

Schema gốc giữ nguyên cả hai câu `SET FOREIGN_KEY_CHECKS` có sẵn trong DOCX để bảo toàn nguồn; **không dùng chúng để sửa lỗi dữ liệu vận hành**. Không chạy lại toàn bộ schema trên database đang có dữ liệu. Nếu chưa có database, người quản trị cần xem xét script rồi chủ động khởi tạo một MySQL phát triển riêng. Không có script npm tự import hoặc reset database.

| Bảng | Cách sử dụng |
| --- | --- |
| `employees` | Tra cứu `user_id` từ JWT đã xác minh, kiểm tra hồ sơ hoạt động |
| `users` | **Chỉ đọc** id/role/status và thông tin liên hệ cần thiết; không SELECT password_hash |
| `assignments` | Đọc các phân công thuộc employee hiện tại; UC12 chỉ ghi status/check_in_at/check_out_at |
| `bookings` | **Chỉ đọc** lịch dự kiến, địa chỉ snapshot, trạng thái; không UPDATE từ Staff |
| `booking_items` | **Chỉ đọc** tên/đơn vị/đơn giá snapshot và số lượng dịch vụ đã đặt |
| `services` | Nguồn danh mục của Service Service; không ghi từ Staff |
| `booking_status_history` | Order Service sở hữu, lấy lịch sử/ghi chuyển trạng thái thông qua REST contract |
| `employee_availability` | Khoảng khả dụng, **không phải lịch các đơn đã phân công**; UC11 không sửa hoặc thay lịch bằng bảng này |

Hiện sử dụng MySQL chung theo đúng schema. Phần SELECT liên bảng nằm trong repository đọc; quyền UPDATE chỉ cấp cho `assignments`, không cấp cho `bookings`/`booking_status_history`. Khi tách database, thay phần đọc projection bằng Order/User/Service API; không chuyển quyền sở hữu dữ liệu sang Staff. Các phương thức REST đọc context đã được tách trong Order client để phục vụ bước này.

## Cài đặt và chạy

```powershell
cd backend/staff-service
npm.cmd install
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

Điền cấu hình cục bộ trong `.env`; file này được Git ignore. Không đưa mật khẩu, token hoặc private key vào source/log. Chỉ sao chép `.env.example` khi chưa có `.env`, không ghi đè cấu hình đang sử dụng.

```powershell
npm.cmd run check:schema
npm.cmd start
# Hoặc: npm.cmd run dev
```

Mặc định cổng **4005**. MySQL phải được khởi tạo từ schema nguồn và đã có tài khoản/nhân viên/phân công do những service phụ trách tạo. Service không tự tạo tài khoản thử nghiệm hoặc thêm đơn để làm đầy dữ liệu.

| Biến | Ý nghĩa |
| --- | --- |
| `MYSQL_HOST`, `MYSQL_PORT` | MySQL hiện có; mặc định loopback/3306 |
| `MYSQL_DATABASE` | Database dùng schema nguồn, thường là `dich_vu_ve_sinh` |
| `MYSQL_USER`, `MYSQL_PASSWORD` | Tài khoản riêng với quyền tối thiểu nêu trên |
| `MYSQL_CONNECTION_LIMIT` | Kích thước connection pool |
| `JWT_ISSUER`, `JWT_AUDIENCE`, `JWT_ALGORITHM` | Contract token của Auth Service |
| `JWT_PUBLIC_KEY` hoặc `JWT_JWKS_URL` | Chọn đúng một khi dùng RS256 |
| `JWT_SECRET` | Chỉ dùng HS256 khi đã thống nhất với Auth; ít nhất 32 byte, lấy từ môi trường |
| `AUTH_INTROSPECTION_URL` | Tùy chọn kiểm tra trạng thái phiên hiện tại; lỗi dependency bị từ chối an toàn |
| `ORDER_SERVICE_URL`, `ORDER_SERVICE_TOKEN` | REST nội bộ và credential service-to-service thật; không thay bằng token client |
| `ORDER_SERVICE_TIMEOUT_MS` | Timeout hữu hạn cho mỗi request Order |
| `CORS_ORIGINS` | Danh sách origin, mặc định `http://localhost:3002`; không dùng wildcard |
| `RECONCILIATION_WORKER_ENABLED` | Bật worker đối chiếu journal khi Order đã triển khai contract |
| `RECONCILIATION_WORKER_INTERVAL_MS`, `RECONCILIATION_WORKER_BATCH_SIZE` | Chu kỳ và giới hạn batch worker |

Không cấu hình Order vẫn cho phép UC9–UC11 đọc MySQL. UC12 trả lỗi phụ thuộc thay vì cập nhật riêng trạng thái Staff. `/health/live` kiểm tra tiến trình; `/health/ready` kiểm tra schema và cho biết cấu hình phụ thuộc đồng bộ, không chứng minh Auth/Order đã tích hợp end-to-end.

## API công khai

Mọi endpoint dưới `/api/v1/staff/me` yêu cầu `Authorization: Bearer <access-token>`.

| UC | Method | Endpoint | Kết quả |
| --- | --- | --- | --- |
| UC9 | GET | `/api/v1/staff/me/jobs` | Chỉ các assignment của employee gắn với JWT sub |
| UC10 | GET | `/api/v1/staff/me/jobs/:assignmentId` | Chi tiết; người khác hoặc không tồn tại trả cùng 404 |
| UC11 | GET | `/api/v1/staff/me/schedule?from=YYYY-MM-DD&to=YYYY-MM-DD` | Lịch thực hiện từ assignments + bookings |
| UC12 | PATCH | `/api/v1/staff/me/jobs/:assignmentId/status` | Tiến độ có kiểm tra quyền và đồng bộ Order |

Danh sách/lịch hỗ trợ `page` (mặc định 1), `pageSize` (20, tối đa 100), `sort=asc|desc` theo `bookings.scheduled_start` và ID để ổn định phân trang; `status=WAITING|ACCEPTED|IN_PROGRESS|DONE|CANCELLED` (`ASSIGNED` cũng được chấp nhận khi lọc). Không hỗ trợ `staffId` hoặc `userId` tự chọn từ client. Các tham số lạ/trùng bị từ chối 400.

Ngày lịch theo **Asia/Ho_Chi_Minh, UTC+07**, `from`/`to` bao gồm cả hai ngày; tối đa 366 ngày. Truy vấn lấy công việc giao với khoảng `[đầu ngày from, đầu ngày sau to)`, gồm lịch kéo qua nửa đêm. MySQL được đọc/ghi theo UTC. Khoảng sai hoặc ngày không tồn tại trả 400; không có việc trả `data: []` và pagination tổng 0.

Ví dụ request (thay bằng token và ID phân công có thật):

```powershell
$staffHeaders = @{ Authorization = "Bearer $env:STAFF_ACCESS_TOKEN" }
Invoke-RestMethod 'http://localhost:4005/api/v1/staff/me/jobs?page=1&pageSize=20&sort=asc' -Headers $staffHeaders
Invoke-RestMethod 'http://localhost:4005/api/v1/staff/me/schedule?from=2026-10-01&to=2026-10-31' -Headers $staffHeaders
$staffHeaders['Idempotency-Key'] = [guid]::NewGuid().ToString()
Invoke-RestMethod 'http://localhost:4005/api/v1/staff/me/jobs/1/status' -Method Patch -Headers $staffHeaders -ContentType 'application/json' -Body '{"status":"ACCEPTED"}'
```

Giữ nguyên `Idempotency-Key` khi thử lại **cùng** thao tác. Dùng key mới khi chuyển sang bước tiếp theo. Key được scope theo user và assignment, không thay thế kiểm tra quyền.

Ví dụ cấu trúc phản hồi danh sách; các số dưới đây chỉ minh họa hợp đồng, không phải dữ liệu đã được thêm vào MySQL:

```json
{
  "data": [{
    "id": "1", "assignmentId": "1", "orderId": "80",
    "jobCode": null, "orderCode": null,
    "status": "WAITING", "databaseStatus": "ASSIGNED",
    "jobStatus": "waiting", "orderStatus": "confirmed",
    "scheduledAt": "2026-10-23T01:00:00.000Z", "expectedEndAt": "2026-10-23T03:00:00.000Z",
    "durationMinutes": 120,
    "contact": { "name": "Tên lấy từ dữ liệu", "address": "Địa chỉ lấy từ snapshot" },
    "services": [{ "serviceId": "2", "name": "Tên snapshot", "unit": "giờ", "quantity": "2.00", "unitPrice": "100000.00" }],
    "assignedAt": "2026-10-22T05:00:00.000Z", "checkInAt": null, "checkOutAt": null
  }],
  "pagination": { "page": 1, "pageSize": 20, "total": 1, "totalPages": 1 },
  "timezone": "Asia/Ho_Chi_Minh"
}
```

Danh sách không trả số điện thoại khách hàng; chi tiết có `contact.phone` để thực hiện công việc. Không trả password/hash hoặc toàn bộ bản ghi users. Lịch sử Order là tùy chọn: `orderHistory: null` và `historySource` thể hiện chưa cấu hình/không lấy được, không tự tạo lịch sử giả.

Lỗi có dạng `{ "error": { "code": "...", "message": "..." }, "requestId": "..." }`. 401 thiếu/sai token; 403 sai vai trò/tài khoản hoặc employee bị khóa; 404 không thấy assignment thuộc quyền; 409 sai bước/xung đột; 503 dependency chưa sẵn sàng. Log chỉ ghi metadata request, không ghi Authorization/body/SQL hoặc thông tin liên hệ.

## Mapping Frontend và khoảng trống schema

| MySQL assignments | API status | Frontend JobStatus |
| --- | --- | --- |
| `ASSIGNED` (default trong DOCX) | `WAITING` | `waiting` |
| `ACCEPTED` | `ACCEPTED` | `accepted` |
| `IN_PROGRESS` | `IN_PROGRESS` | `in_progress` |
| `DONE` | `DONE` | `done` |
| `CANCELLED` | `CANCELLED` | null; hiển thị theo trạng thái hủy |

Đây là quy ước Service trên cột VARCHAR(20), không đổi kiểu cột thành ENUM. `bookings.status` map `PENDING/CONFIRMED/IN_PROGRESS/COMPLETED/CANCELLED` sang `OrderStatus` chữ thường. JWT/MySQL `EMPLOYEE` map Frontend `staff`; `JWT sub` là `users.id`, khác `employees.id`.

`assignmentId` dùng để mở/cập nhật công việc; `orderId` là booking. Tất cả BIGINT trả dạng chuỗi để không mất precision. DECIMAL giữ chuỗi; Frontend cần adapter chuyển đổi có kiểm tra, không ép DTO này thành `Order` bằng type assertion. Một booking có nhiều dịch vụ/nhân viên nên API giữ mảng `services` và từng assignment, không chọn giả một dịch vụ hoặc gộp mất phân công.

Schema không có `job_code`, `booking_code`, email của users, loại nhà, diện tích, số phòng/tầng, thú cưng, yêu cầu đặc biệt, yêu cầu hủy chờ duyệt, ghi chú Staff, thời điểm tạo booking hoặc version/outbox. Không thêm các trường/bảng này vào schema nguồn. Trường chưa có trả null hoặc được ghi trong `unsupportedFields`. Địa chỉ đọc từ JSON snapshot khi có `address_text`/`address` hoặc chuỗi; tên/phone ưu tiên snapshot thực có, nếu thiếu dùng full_name/phone khách hàng đã lưu. Không tự suy diễn cấu trúc JSON khác.

Nếu nhóm cần các trường Frontend này, phải thống nhất **migration riêng sau review**; chưa tạo hoặc chạy migration trong lượt này. Tương tự, nên xem xét index ghép `(employee_id,status)` và CHECK khoảng giờ trong migration hiệu năng/toàn vẹn riêng; không sửa khóa/index nguồn.

## UC12, lịch sử và khôi phục đồng bộ

Staff giữ transaction/row lock trên assignment, kiểm tra chủ sở hữu và bước chuyển; request REST Order có timeout hữu hạn. Order phải kiểm tra booking, ghi lịch sử và xác nhận trạng thái trước khi Staff ghi assignment/check-in/check-out. Check-in lưu khi bắt đầu `IN_PROGRESS`, check-out khi `DONE`; `assigned_at` giữ nguyên.

Order Service hiện chỉ là scaffold. Contract cần đồng đội triển khai được ghi tại [docs/order-service-contract.md](docs/order-service-contract.md). Không có ghi trực tiếp bookings hoặc booking_status_history từ Staff.

Contract dùng **journal idempotency/đối chiếu do Order sở hữu** trong `booking_status_history.note` đã có (metadata JSON được định nghĩa trong contract), không tự thêm bảng Staff outbox. Nếu nhóm không chấp nhận dùng note làm journal, cần duyệt migration riêng trước khi triển khai bền vững; không thay bằng cache trong RAM.

- Order lỗi trước khi trả ACK: Staff rollback, assignment không đổi, trả 503/409 phù hợp.
- Order ACK nhưng Staff commit lỗi/crash: journal còn pending; trả 503 khi phát hiện, thử lại cùng key hoặc worker hoàn tất. Không báo cả hai service đã thành công.
- Staff commit rồi ACK journal lỗi: trả **202**, `synchronization: PENDING_ACKNOWLEDGEMENT`; worker/thử lại xác nhận tiếp.
- Hoàn tất và nhận ACK: trả 200, `SYNCHRONIZED`. Request lặp không ghi thêm bước hoặc đổi timestamp lần nữa.
- Worker không sửa lùi trạng thái đã đi xa hơn; employee bị khóa hoặc xung đột giữ chờ đối chiếu, không tự bỏ qua quyền.

Order phải khóa booking, chống trùng operation và tổng hợp **tất cả phân công đang hiệu lực**, gồm journal chưa được Staff xác nhận. Nhận việc không tự hoàn thành đơn; bắt đầu chuyển đơn sang IN_PROGRESS; chỉ COMPLETED khi mọi nhân viên cần thiết DONE. Hủy/đổi phân công phải phối hợp journal pending, không chạy đua với chuyển trạng thái. Đây là contract cần thực thi tại Order, chưa được chứng minh end-to-end.

```powershell
# Chạy worker riêng sau khi cấu hình Order contract và MySQL:
npm.cmd run worker
```

Schema không có dữ liệu yêu cầu hủy chờ duyệt. Chỉ kiểm tra điều kiện này khi Order thực sự cung cấp `cancellationPending`; giá trị chưa hỗ trợ là null, không giả thành false.

## JWT và service khác

Hướng dẫn cấu hình và claims thực tế: [docs/auth-integration.md](docs/auth-integration.md). Với RS256, lấy `JWT_ISSUER`, `JWT_AUDIENCE` và đúng một trong `JWT_PUBLIC_KEY`/`JWT_JWKS_URL` từ thành viên Auth. Không tự sinh secret/token để làm cho server vượt qua cấu hình còn thiếu. Token cần `sub` là `users.id` thật và role `EMPLOYEE`; fixture nhân viên dùng user ID `9109002`, khác employee ID `9109004`.

JWT được kiểm chữ ký, algorithm/issuer/audience/expiry; không đọc role/userId từ header tự khai báo. Kiểm tra user/employee hoạt động lại qua MySQL mỗi request. Có adapter introspection tùy chọn để kiểm tra phiên/revocation nếu Auth hỗ trợ. Không có endpoint phát token hoặc middleware cho phép mọi request trong Staff Service. Auth Service của nhóm cần cấp token thật theo contract; dữ liệu đăng nhập localStorage Frontend không được dùng làm token Backend.

Gateway vẫn là scaffold và không bị ghi đè; gọi Staff Service trực tiếp trên 4005 hoặc nhờ thành viên Gateway proxy `/api/v1/staff` tới service, giữ nguyên Bearer/Idempotency-Key. Không đổi các cổng Frontend 3001–3003.

## Kiểm thử và giới hạn xác minh

```powershell
npm.cmd run test:unit
npm.cmd test
npm.cmd run test:mysql
npm.cmd run test:mysql:seeded
```

Test tự động phân biệt JWT/HTTP thật với repository/Order dependency mock. Test MySQL thật chỉ chạy khi được cấu hình rõ ràng trên database phát triển/test riêng; thiếu cấu hình phải báo SKIP, không thay bằng giả lập rồi báo tích hợp thành công. Không có fixture/seed chạy vào dữ liệu người dùng.

`test:unit` chỉ chọn các file kiểm thử độc lập, không nạp `.env` hoặc mở kết nối MySQL/Auth/Order thật. JWT được ký/xác minh bằng key dùng riêng trong tiến trình kiểm thử; HTTP Order/introspection và repository được thay bằng dependency double có ghi nhãn. Không có thay đổi xác thực runtime. `npm.cmd test` khám phá toàn bộ test; phần MySQL mặc định bỏ qua nếu không bật `RUN_MYSQL_TESTS=true`.

Để bật kiểm tra MySQL chỉ đọc, điền `MYSQL_*` của database kiểm thử đã tồn tại và đặt `RUN_MYSQL_TESTS=true` trong `.env`, rồi chạy `npm.cmd run test:mysql`. Có thể điền thêm `TEST_STAFF_USER_ID` là ID user kiểm thử đã có để kiểm tra truy vấn nhân viên/công việc; không cần và không tự tạo fixture. Sau khi đã tự nhập seed, chạy thêm `npm.cmd run test:mysql:seeded`; lệnh này chỉ cho phép database `cleanhome_staff_test` và yêu cầu các ID fixture hiện hữu. Cả hai bộ kiểm tra không ghi dữ liệu hoặc gọi cập nhật trạng thái.

Kết quả lượt kiểm tra seed trước, ngày 23/10/2026 (kết quả mới ở phần chuẩn bị tích hợp bên dưới):

- `npm.cmd run test:unit`: **87 kiểm tra đạt ở lượt bổ sung trước**, không lỗi/bỏ qua. Bao gồm JWT/config, HTTP Express, quyền dữ liệu mới nhất, input JSON/size, DTO/precision, SQL/transaction double, idempotency/replay, REST client stub và scheduler. Bốn kiểm tra seed là **kiểm tra tĩnh**, không chứng minh đã chạy lại seed trên MySQL. Không chạy lại bộ unit không thay đổi trong lượt kiểm tra dữ liệu mới.
- `$env:RUN_MYSQL_TESTS='true'; npm.cmd run test:mysql`: **6 kiểm tra đạt trên dữ liệu seed**, không bỏ qua. Kiểm tra kết nối/schema tám bảng, đủ 32 bảng nguồn, list/filter/page/sort, detail/snapshot và lịch.
- `npm.cmd run test:mysql:seeded` với cùng cờ môi trường: **11 kiểm tra đạt**, không bỏ qua. Kiểm tra liên kết dữ liệu, UC9–UC11 có dữ liệu, snapshot DECIMAL/DTO, sai employee ID, không tồn tại, rỗng và các biên thời gian. Có gọi trực tiếp tầng service để kiểm tra quyền Customer/không có user và lỗi không tìm thấy; không tạo HTTP server, phát JWT hoặc thay middleware xác thực.
- Database có **2 users, 1 employee, 1 booking, 1 assignment**. User `9109002` → employee `9109004` → assignment `9109008` → booking `9109007`, Customer `9109001`. Assignment giữ `ASSIGNED`, booking giữ `CONFIRMED`; lịch **08:00–10:00 ngày 24/10/2026, giờ Việt Nam**. Đối chiếu hash các trường ID/trạng thái/lịch/giá và bản ghi liên quan trong tám bảng trước/sau đạt; không đọc hash mật khẩu hoặc ghi/xóa dữ liệu.
- Hai file kiểm thử MySQL đã thay đổi qua kiểm tra cú pháp; kiểm tra khoảng trắng và `git diff --check` trong phạm vi thay đổi đạt. Các schema, seed và mã production được giữ nguyên trong lượt kiểm tra dữ liệu này.
- Chưa kiểm chứng token/JWKS/introspection do Auth thật cung cấp, REST/journal/transaction của Order thật, Gateway hoặc tích hợp Frontend. Staff Service chưa được xác nhận chạy HTTP end-to-end với các dependency này.

Tại lượt kiểm tra seed gốc chỉ có một employee và một assignment: kiểm tra employee ID đã xác nhận không tồn tại chứng minh bộ lọc SQL không trả công việc, **không thay thế hai tài khoản Staff thật truy cập chéo qua HTTP**. Khi đó SQL nhiều bản ghi chưa được chạy và RS256 thiếu public key/JWKS; không bỏ qua xác thực để khởi động API. Kết quả dữ liệu nhiều nhân viên hiện tại nằm ở liên kết đầu README; không gọi UC12 hoặc worker.

## Chuẩn bị tích hợp Auth/Order — báo cáo trước khi chạy seed bổ sung

Đã rà soát source UC9–UC12 và Git status, giữ thay đổi có trước. Không phát hiện blocker mới qua review và kiểm thử độc lập; không viết lại production code trong lượt này. `.env*` và thư mục `secrets/` được ignore, ngoại lệ duy nhất là template `.env.example`. Cả `.env` và tên bản sao `.env copy.example` không được Git theo dõi; không đọc/in nội dung bản sao hoặc đưa credential vào artifact. Không sửa Frontend, Auth/Order hoặc schema gốc, không chạy seed/worker/HTTP ghi.

### File thay đổi của lượt chuẩn bị tích hợp

| File | Nội dung |
| --- | --- |
| `../../databases/seed_staff_test_multi.sql` | SQL riêng, 15 bản ghi thêm có guard/idempotency, không ghi đè seed gốc; chờ chạy thủ công |
| `test/mysql.multi.integration.test.js` | MySQL chỉ đọc với hai nhân viên, kiểm truy cập chéo, booking chung, lọc/sort/nhiều trang/lịch |
| `test/multi-seed-contract.test.js` | Tám kiểm tra tĩnh cấu trúc/guard SQL, không thực thi SQL |
| `scripts/http-test-config.js` | Guard opt-in/database/URL/booking ghi và nguồn token thật, không tạo JWT |
| `test/http-test-config.test.js` | Bốn kiểm tra độc lập guard và lỗi không lộ token |
| `test/http.integration.test.js` | Runner gọi Staff thật, JWT RS256 Auth thật; đọc UC9–UC11, ghi UC12 qua Order thật khi chủ động bật |
| `docs/multi-employee-testing.md` | Manifest A/B, hướng dẫn Workbench và Repository test |
| `docs/http-integration-testing.md` | Điều kiện, lệnh đọc/ghi, an toàn token, fixture bị tiêu thụ và giới hạn |
| `docs/auth-handoff-checklist.md`, `docs/auth-integration.md` | Checklist Auth/login/claims/keys/tokens và liên kết contract |
| `docs/order-handoff-checklist.md`, `docs/order-service-contract.md` | Checklist bốn API, ACK/journal, lỗi, retry, multi-worker và fairness pending |
| `.gitignore`, `.env.example`, `package.json`, `README.md` | Bảo vệ env bản sao, template trống, lệnh test và báo cáo |

### Kết quả thực sự đã chạy

| Kiểm tra | Kết quả | Phạm vi |
| --- | --- | --- |
| `npm.cmd run test:unit` | **99 đạt**, 0 lỗi/bỏ qua | 87 kiểm tra cũ + 8 contract SQL tĩnh + 4 guard HTTP; dependency double/key unit không chứng minh service thật |
| MySQL generic và seeded, `RUN_MYSQL_TESTS=true` | **17 đạt**, 0 lỗi/bỏ qua | MySQL thật, 32 bảng hiện diện, UC9–UC11 repository/service chỉ đọc, kiểm snapshot trước/sau |
| MySQL multi, `RUN_MYSQL_MULTI_TESTS=false` | **SKIP**, không đạt giả | Xác nhận mặc định không mở kết nối; SQL mới chưa được người dùng thực thi |
| HTTP, hai cờ `RUN_STAFF_HTTP_*` bằng false | **SKIP**, không gọi service | Chưa có token thật và Order contract hoạt động; không báo HTTP/JWT end-to-end đạt |
| `node --check` toàn bộ `src/`, `test/`, `scripts/` | **29 file đạt** | Kiểm tra cú pháp, không chạy production hoặc sửa output |
| Git ignore / nội dung Git có thể nhìn thấy / khoảng trắng | **Đạt trong phạm vi kiểm tra** | Không có env ngoài template trong danh sách Git; 46 file Staff không có literal private key/JWT theo mẫu đã dò; `git diff --check` đạt |

Đọc lại database xác nhận **2 users / 1 employee / 1 booking / 1 assignment**; assignment `9109008` còn `ASSIGNED`, booking gốc còn `CONFIRMED`. Không có năm assignment mới trong SQL bổ sung. `.env` hiện không vượt qua kiểm tra cấu hình RS256 vì chưa có đúng một nguồn `JWT_PUBLIC_KEY` hoặc `JWT_JWKS_URL`; không tạo secret/key thay thế để khởi động server.

### Bàn giao và bước chạy tiếp

- Auth cần bàn giao login thật (method/path/payload/response), issuer/audience, public key hoặc JWKS và token RS256 cho đúng users.id A/B/Customer. Contract lấy danh tính từ `sub`, role `EMPLOYEE`, trạng thái `ACTIVE/LOCKED`; không dùng `employees.id` hay claim userId riêng thay sub. Hash marker seed không đăng nhập được. Xem [checklist Auth](docs/auth-handoff-checklist.md).
- Order cần bốn API lookup/apply/ack/pending cùng credential nội bộ thật, ACK/journal bền vững, chống trùng, tổng hợp nhiều assignment và không khóa assignment đang bị Staff giữ. Hai context API chỉ tùy chọn. Xem [checklist Order](docs/order-handoff-checklist.md).
- Sau khi tự chạy SQL mới, dùng `$env:RUN_MYSQL_MULTI_TESTS='true'` rồi `npm.cmd run test:mysql:multi` để kiểm repository. Không cần Auth/Order cho lệnh này; không tự thực thi seed.
- Khi cấu hình Auth/Order đã sẵn sàng: `npm.cmd run check:schema`, `npm.cmd start` (cổng 4005), rồi làm theo [hướng dẫn HTTP](docs/http-integration-testing.md). Runner chỉ đọc theo mặc định; UC12 cần cả hai cờ HTTP và `STAFF_HTTP_WRITE_BOOKING_ID=9109131`, tiêu thụ shared fixture thật và không reset sau đó.

### Giới hạn còn lại

Chưa kiểm chứng HTTP với Auth/Order thật, import SQL mới trên MySQL, phân quyền A/B thật, transaction cạnh tranh, mất response/crash hoặc worker phục hồi thật. Chuỗi HTTP nhiều nhân viên được soạn theo thứ tự, không chứng minh cập nhật đồng thời. Snapshot chỉ bao phủ những cột/bảng được chọn, không phải checksum toàn bộ 32 bảng. `/health/ready` không probe dependency từ xa; runner không tự suy ra database của server từ URL. Các SELECT đếm/lấy trang riêng có thể lệch khi dữ liệu thay đổi đồng thời; truy vấn/lock MySQL chưa có timeout riêng ngoài kết nối. Pending hiện có limit nhưng chưa có cursor; cần Order bảo đảm fairness để operation lỗi không chặn các batch sau. Đây là các điểm cần kiểm chứng/hardening khi phối hợp, không được sửa schema hay dịch vụ của đồng đội trong lượt này.

## Kết quả rà soát UC9–UC12

Đã đọc toàn bộ 14 file `src/`: app/validation/errors, auth/config/db, repository/mapping/job-service, Order client, reconciliation và các entry point runtime/server/worker. Không đổi kiến trúc hoặc bỏ middleware để vượt qua dependency còn thiếu.

| UC | Phần đã triển khai | Phần còn cần tích hợp thật |
| --- | --- | --- |
| UC9 | Route JWT, tra employee từ user, SQL giới hạn quyền, lọc/phân trang/sắp xếp và DTO nhiều dịch vụ; repository/service đã đọc đúng assignment seed | Token Auth để kiểm API HTTP có dữ liệu, thêm nhân viên/công việc khi cần kiểm truy cập chéo và sắp xếp nhiều bản ghi |
| UC10 | Detail theo quyền sở hữu, contact/snapshot, không tồn tại/sai employee ID; dữ liệu seed đã được kiểm ở repository/service; lịch sử Order tùy chọn | JWT qua HTTP và context/history thật nếu cần hiển thị phần bổ sung |
| UC11 | Lịch assignment/booking, ngày Việt Nam, overlap/filter/page/sort và trạng thái rỗng đã kiểm trên seed | JWT qua HTTP; không phải API sửa availability |
| UC12 | Row lock/transaction assignment, đúng bước, check-in/out từ ACK, lookup/apply/ack, retry và worker pending | Bốn API Order bắt buộc, journal bền vững/tổng hợp nhiều nhân viên, Auth và kiểm thử transaction cạnh tranh thực tế |

Rà soát đã sửa riêng DTO: giữ địa chỉ JSON scalar khi mysql2 đã decode chuỗi; trạng thái lạ không trả về thuộc tính prototype; Date không hợp lệ được báo lỗi dữ liệu nhất quán. Không thay đổi trạng thái, giá hoặc công thức nghiệp vụ.

Order cần **GET lookup** và **PUT apply** trên `/internal/v1/bookings/:bookingId/assignment-transitions/:operationId`, **POST** `/internal/v1/bookings/:bookingId/assignment-transitions/:operationId/acknowledgement`, cùng **GET** `/internal/v1/assignment-transitions/pending` cho worker. Hai API context là phần đọc tùy chọn, không phải điều kiện UC12. Payload/ACK/mã lỗi chính xác nằm trong [contract Order](docs/order-service-contract.md).

## Khi dependency đã sẵn sàng

1. Thành viên Auth cấp cấu hình xác minh và access token hợp lệ cho user nhân viên có thật. Nếu dùng fixture, Auth cần quy trình cấp credential riêng; hash/phone marker trong seed không phải tài khoản đăng nhập.
2. Thành viên Order triển khai bốn endpoint UC12/worker và journal theo contract; thống nhất credential service-to-service rồi điền `ORDER_SERVICE_URL`/`ORDER_SERVICE_TOKEN` trong `.env`. Chỉ bật introspection/context/worker khi phần tương ứng đã có.
3. Người quản trị tự chạy seed đã review trong Workbench trên database test khi muốn có dữ liệu. Không chạy lại schema hoặc reset database. UC9–UC11 không bắt buộc Order nếu dùng projection SQL hiện tại; UC12 cần Order.
4. Từ `backend/staff-service`, chạy:

```powershell
npm.cmd run check:schema
npm.cmd start
# Worker riêng chỉ khi Order đã hỗ trợ pending/ack; tránh chạy trùng worker trong server:
npm.cmd run worker
```

Server mặc định `http://localhost:4005`; Staff Frontend vẫn ở cổng 3002. Kiểm `/health/live`, rồi dùng access token Auth thật gọi bốn route công khai. `/health/ready` hiện kiểm schema và sự có mặt của cấu hình Order, không probe Auth/Order từ xa; 200 không thay kiểm thử JWT hoặc journal thực tế. PATCH cần `Idempotency-Key`; dùng key mới cho bước tiếp theo và giữ key khi retry cùng bước.

## File thay đổi trong lượt bổ sung

| File | Nội dung |
| --- | --- |
| `../../databases/seed_staff_test.sql`, `docs/test-data.md` | Seed thủ công có guard, ID và giới hạn fixture |
| `docs/auth-integration.md`, `docs/order-service-contract.md` | Hướng dẫn Auth và đối chiếu bốn API Order bắt buộc/hai API tùy chọn |
| `src/mapping.js` | Ba sửa nhỏ khi đọc DTO; không đổi auth hoặc nghiệp vụ |
| `package.json` | Thêm `test:unit` tách kiểm thử không cần dependency thật |
| `test/jobs.test.js`, `test/repository.test.js`, `test/order-client.test.js`, `test/mysql.integration.test.js` | Bổ sung nhánh lỗi, recovery và kiểm SQL MySQL chỉ đọc |
| `test/validation-mapping.test.js`, `test/reconciliation.test.js`, `test/seed-contract.test.js` | Validation/DTO, scheduler và kiểm seed tĩnh |
| `README.md` | Mức hoàn thiện từng UC, kết quả kiểm tra và bước bàn giao |

## File bàn giao

Các đường dẫn bên dưới tính từ `backend/staff-service/`, trừ schema:

| File | Nội dung |
| --- | --- |
| `../../databases/schema.sql` | SQL gốc 32 bảng được trích từ DOCX |
| `package.json`, `package-lock.json`, `.gitignore`, `.env.example` | Dependency, lệnh chạy và cấu hình môi trường |
| `src/app.js`, `src/errors.js`, `src/validation.js` | Bốn endpoint UC9–UC12, validation, lỗi JSON, CORS |
| `src/auth.js`, `src/config.js`, `src/db.js` | JWT, cấu hình và MySQL pool |
| `src/repository.js`, `src/mapping.js`, `src/job-service.js` | SQL theo schema, DTO và quy trình công việc |
| `src/order-client.js`, `src/reconciliation.js` | REST Order, idempotency và đối chiếu journal |
| `src/runtime.js`, `src/server.js`, `src/worker.js` | Khởi chạy API/worker và đóng tiến trình |
| `scripts/check-schema.js` | Kiểm tra schema chỉ đọc, không chạy DDL |
| `test/auth.test.js`, `test/jobs.test.js`, `test/validation-mapping.test.js`, `test/reconciliation.test.js`, `test/seed-contract.test.js` | Xác thực, quyền, API, DTO, scheduler và kiểm seed tĩnh |
| `test/repository.test.js`, `test/mysql.integration.test.js`, `test/mysql.seeded.integration.test.js`, `test/order-client.test.js` | SQL, kiểm MySQL tổng quát/có seed chỉ đọc và HTTP client |
| `docs/auth-contract.md`, `docs/auth-integration.md`, `docs/order-service-contract.md`, `docs/test-data.md`, `README.md` | Contract cần phối hợp, fixture và hướng dẫn bàn giao |

Không chỉnh Frontend, Auth/Order/Gateway, backend khác hoặc dữ liệu localStorage. Giữ các thay đổi Git có trước, không commit/push/đổi nhánh.
