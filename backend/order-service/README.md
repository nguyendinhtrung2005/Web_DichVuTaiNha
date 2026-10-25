# CleanHome — Order Service cho Staff UC12

Đã triển khai bốn REST API nội bộ để **Staff cập nhật assignment, Order quyết định trạng thái booking và ghi journal bền vững**. UC12 đã chạy qua Auth JWT RS256 → Staff → Order → MySQL thật trên `cleanhome_staff_test`; không dùng xác thực giả hoặc tự ký JWT ngoài Auth.

Trạng thái bàn giao: **IMPLEMENTED + VERIFIED trên môi trường local**. Chủ sở hữu service vẫn cần review/chấp thuận contract, quyền database, cấu hình và giới hạn trước khi triển khai; báo cáo của công cụ không thay phê duyệt của thành viên phụ trách.

## Cập nhật bằng chứng local ngày 24/10/2026

Theo [báo cáo nghiệm thu UC12](../../frontend/apps/staff/docs/UC12_E2E_QA_REPORT.md), luồng Browser → BFF → Auth/Staff → Order → MySQL thật trên `cleanhome_staff_test` đạt **43 nhóm E2E PASS, 0 FAIL, 0 SKIP, 0 NOT_RUN** cho Q01–Q06. Hồi quy HTTP riêng đạt **90 PASS, 0 FAIL, 1 SKIP** do thiếu fixture UC11 qua ranh ngày UTC/Việt Nam; không cộng hai lớp kiểm thử hoặc coi SKIP là PASS.

Sáu booking `9109151–9109156` đã COMPLETED, mười hai assignment `9109173–9109184` đã DONE, 36 journal mới đã ACK; giữ nguyên dữ liệu và không chạy lại workflow. Booking cũ `9109131` và `9109141` cũng đã COMPLETED. Muốn kiểm thử ghi thêm cần fixture và phạm vi được duyệt riêng.

Đây là bằng chứng local HTTP trên một máy; chưa kiểm chứng production, HTTPS/Secure cookie thực, tải lớn/stress/soak, nhiều host/replica hoặc crash/kill/mất điện/restore trong lượt Frontend này. Fault Q03–Q06 là mất kết nối/phản hồi thật, không phải crash tiến trình. Worker toàn database tắt. Kết quả không thay phê duyệt contract/PR của owner; các kết quả giai đoạn cũ phía dưới được giữ làm lịch sử.

## Phạm vi và dữ liệu

| Service | Sở hữu trong UC12 |
| --- | --- |
| Auth | Credential tài khoản, JWT RS256, public JWKS và introspection |
| Staff | Xác thực/phân quyền nhân viên, ghi `assignments.status/check_in_at/check_out_at` |
| Order | Quyết định `bookings.status`, ghi `booking_status_history` và quản lý journal/ACK |

Order đọc projection của `assignments`, `employees`, `users` để kiểm liên kết/phạm vi; không sửa các bảng này trong runtime, không tính lại giá, đổi lịch, chỉnh booking_items hoặc cấp tài khoản. Hiện database phát triển được dùng chung, **chưa tách database hoàn toàn theo service**. Các helper kiểm thử có quyền INSERT fixture QA riêng khi bật opt-in, khác với quyền ghi runtime UC12.

Giữ nguyên schema gốc 32 bảng. Không thêm cột/bảng, migration, DROP, reset hoặc cleanup xóa dữ liệu. Journal tận dụng một dòng `booking_status_history` mỗi operation, metadata JSON trong `note TEXT`:

```json
{
  "kind": "cleanhome.staff-transition",
  "version": 1,
  "operation": {"id":"operation-id","bookingId":"80","assignmentId":"12","employeeId":"9","actorUserId":"7","fromStatus":"ASSIGNED","toStatus":"ACCEPTED"},
  "ack": {"operationId":"operation-id","bookingId":"80","assignmentId":"12","assignmentStatus":"ACCEPTED","occurredAt":"2026-10-23T01:00:00.000Z","booking":{"id":"80","status":"CONFIRMED","cancellationPending":null}},
  "staffAcknowledged": false
}
```

Ví dụ minh họa cấu trúc, không phải dữ liệu được seed hoặc credential. Note văn bản cũ không thuộc marker được giữ nguyên. Không lưu token, mật khẩu hoặc thông tin liên hệ vào journal. Schema chưa có trường yêu cầu hủy đang chờ nên `cancellationPending:null`, không giả thành false.

## API đã triển khai và chạy thật

Base URL local: **`http://127.0.0.1:4003`**. Cả bốn endpoint cần `Authorization: Bearer <service credential>`; ba endpoint theo booking cần `X-Actor-User-Id` khớp payload. PUT/POST cần `Idempotency-Key` bằng operation ID trên URL.

| Method | Endpoint | Request | Response thành công |
| --- | --- | --- | --- |
| GET | `/internal/v1/bookings/:bookingId/assignment-transitions/:operationId` | Năm trường payload qua query | `200` ACK gốc; chỉ `404 TRANSITION_NOT_FOUND` có nghĩa chưa ghi operation |
| PUT | `/internal/v1/bookings/:bookingId/assignment-transitions/:operationId` | Năm trường payload JSON | `200` ACK sau commit booking/journal |
| POST | `/internal/v1/bookings/:bookingId/assignment-transitions/:operationId/acknowledgement` | Năm trường payload JSON | `200 {operationId,bookingId,assignmentId,acknowledged:true}` |
| GET | `/internal/v1/assignment-transitions/pending?limit=20` | Limit nguyên 1–100, mặc định 20 | `200 {operations:[Operation]}` |

Năm trường bắt buộc, không thêm trường lạ:

```json
{
  "assignmentId": "12",
  "employeeId": "9",
  "actorUserId": "7",
  "fromStatus": "ASSIGNED",
  "toStatus": "ACCEPTED"
}
```

ID thực thể là chuỗi BIGINT signed dương canonical; không ép Number mất precision. Operation ID chỉ gồm chữ/số/gạch ngang/gạch dưới, tối đa 128 ký tự. Staff tạo operation ID bằng SHA-256 của JSON `[actorUserId,assignmentId,Idempotency-Key-của-client]`; Order giữ đúng scope này, không tự đổi contract.

ACK gồm `{operationId,bookingId,assignmentId,assignmentStatus,occurredAt,booking:{id,status,cancellationPending}}`. `occurredAt` là UTC có độ chính xác giây, được lưu một lần và giữ nguyên khi replay. Pending trả `{id,bookingId,assignmentId,employeeId,actorUserId,fromStatus,toStatus}` cho từng operation chưa acknowledgement.

Health: `GET /health/live` và `GET /health/ready` đã trả 200 trên service thật. Ready kiểm schema MySQL, không có nghĩa mọi hệ thống liên quan hoặc môi trường production đã sẵn sàng.

## Xác thực và lỗi

Service credential được cấp ngẫu nhiên bằng script tường minh, so sánh timing-safe; không phải JWT người dùng và không có giá trị mặc định công khai. Thiếu/sai credential hoặc dùng JWT nhân viên vào endpoint nội bộ trả **401**; request có Origin trình duyệt với credential hợp lệ trả **403**. Chỉ bind loopback mặc định, không bật CORS cho API nội bộ.

Lỗi JSON: `{error:{code,message},requestId}`. Validation lỗi trả 400; body quá giới hạn trả 413; không tìm thấy booking trả 404; lookup operation chưa ghi trả 404 `TRANSITION_NOT_FOUND`. Tranh chấp/nghiệp vụ dùng 409 theo allowlist Staff: `BOOKING_CANCELLED`, `BOOKING_COMPLETED`, `BOOKING_NOT_CONFIRMED`, `INVALID_TRANSITION`, `ASSIGNMENT_NOT_ACTIVE`, `STALE_ASSIGNMENT`, `IDEMPOTENCY_CONFLICT`, `OPERATION_CONFLICT`. `CANCELLATION_PENDING` được contract dự trù nhưng chưa có dữ liệu schema để phát hiện yêu cầu hủy đang chờ.

MySQL không dùng được, journal hỏng hoặc dữ liệu không đủ điều kiện xử lý trả lỗi 503 an toàn; không gửi SQL/credential ra response. Commit thất bại không trả ACK thành công. Staff phân loại upstream 409/422 đã thống nhất thành `ORDER_REJECTED`; timeout/5xx thành `ORDER_UNAVAILABLE`; phản hồi sai contract thành `ORDER_BAD_RESPONSE`. Credential service sai không được hiểu thành nhân viên cần đăng nhập lại.

## Transaction, idempotency và phục hồi

- Mỗi operation lấy advisory lock theo hash operation ID, rồi transaction `READ COMMITTED` khóa booking bằng `FOR UPDATE`. Khóa operation chống tái sử dụng cùng ID ở booking khác; khóa booking tuần tự hóa quyết định giữa nhiều nhân viên. Order không khóa ghi assignment vì Staff đang giữ khóa assignment trong khi đợi REST.
- Assignment hiện tại được hợp nhất với journal đã commit còn pending. A DONE không hoàn tất booking khi B chưa DONE; chỉ mọi assignment còn hiệu lực DONE mới COMPLETED. Assignment CANCELLED không tính vào nhóm phải hoàn thành. Operation mới trên booking CANCELLED/COMPLETED hoặc chưa CONFIRMED bị chặn.
- Booking và journal commit cùng transaction trước ACK. Cùng ID/payload trả ACK gốc, không ghi lịch sử mới; cùng ID nhưng payload khác trả xung đột. ACK cũ không đổi dù booking đã tiến xa hơn.
- Acknowledgement kiểm Staff đã commit trạng thái bằng hoặc vượt bước yêu cầu; start/done phải có timestamp khớp. Chỉ đổi cờ `staffAcknowledged`; giữ nguyên operation/ACK và không thêm dòng lịch sử. Replay acknowledgement không ghi trùng.
- DONE không được trước check-in/journal đã có. Thiếu bằng chứng check-in/start trả lỗi trước commit; đồng hồ quay lùi bị chặn, không phát ACK khiến Staff không thể xác nhận.
- Order commit nhưng Staff chưa commit hoặc mất response: pending còn bền vững, retry cùng key/worker lấy ACK gốc. Staff commit xong nhưng ack lỗi: Staff trả `202 PENDING_ACKNOWLEDGEMENT`. Hoàn tất hai phía mới `200 SYNCHRONIZED`.

Named lock thuộc connection nên phải release tường minh cả khi commit/rollback; nếu không xác nhận release được thì loại connection khỏi pool, theo [MySQL locking functions](https://dev.mysql.com/doc/refman/8.0/en/locking-functions.html). `READ COMMITTED` cho từng nonlocking read một snapshot mới; booking lock và pending journal phối hợp tính trạng thái thay vì chờ assignment đang khóa, theo [MySQL transaction isolation](https://dev.mysql.com/doc/refman/8.0/en/innodb-transaction-isolation-levels.html).

Journal trên TEXT hiện chưa có index operation/pending chuyên biệt. Pending dùng round-robin cursor trong bộ nhớ, reset khi restart; chưa bảo đảm fairness phân tán giữa nhiều instance. Không tự xóa operation không thể phục hồi; cần theo dõi và xử lý thủ công. Các thao tác đổi roster/hủy đơn trong tương lai phải phối hợp cùng booking lock và pending journal. Named lock hiện giả định các writer đi qua cùng MySQL server; chưa kiểm chứng topology đa writer.

## Cài đặt và cấu hình

Node.js **22+**, MySQL **8.0+** có InnoDB và schema nguồn. Tại `backend/order-service`, chỉ khi môi trường chưa cài dependency:

```powershell
npm.cmd ci
if (-not (Test-Path -LiteralPath '.env')) {
  Copy-Item -LiteralPath '.env.example' -Destination '.env'
}
```

Điền MYSQL_* trong `.env` riêng, không dùng dữ liệu production để chạy test. `.env*`, các bản sao `.env`, `secrets/`, node_modules và log được Git ignore; chỉ template `.env.example` không có bí mật được phép đưa vào source. Không chép private key Auth sang Order.

| Biến | Mặc định/ý nghĩa |
| --- | --- |
| `HOST`, `PORT` | `127.0.0.1`, `4003` |
| `MYSQL_HOST`, `MYSQL_PORT` | `127.0.0.1`, `3306` |
| `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE` | Tài khoản/database thật; test chỉ `cleanhome_staff_test` |
| `MYSQL_CONNECTION_LIMIT` | 5, giới hạn 1–20 |
| `ORDER_SERVICE_TOKEN` | Giá trị credential trực tiếp, giữ riêng |
| `ORDER_SERVICE_TOKEN_FILE` | File credential; chọn đúng một nguồn trực tiếp hoặc file |
| `JWT_ISSUER`, `JWT_AUDIENCE` | Launcher/test Staff dùng `http://localhost:4001`, `cleanhome-staff-api`; Order không tự cấp JWT |
| `ORDER_LIVE_BASE_URL` | `http://127.0.0.1:4003` |
| `ORDER_LIVE_STAFF_URL` | `http://127.0.0.1:4005` |
| `ORDER_LIVE_AUTH_URL` | `http://127.0.0.1:4001` |
| `STAFF_INTEGRATION_PORT` | Launcher Staff mặc định 4005 |

Nếu chưa có credential riêng, chạy một lần `npm.cmd run generate:service-token`. Script tạo `secrets/staff-service.token` từ nguồn ngẫu nhiên hệ thống, từ chối ghi đè file cũ, không in token. Runtime không tự sinh secret/fallback khi cấu hình thiếu. Template chọn `ORDER_SERVICE_TOKEN_FILE=secrets/staff-service.token`, để nguồn trực tiếp rỗng.

```powershell
# Terminal Order, dùng server hiện có nếu đang chạy đúng cấu hình:
npm.cmd start
```

Runtime kiểm credential/schema trước khi listen. Shutdown có deadline; log chỉ metadata request, không ghi header Authorization/body chứa dữ liệu nhạy cảm.

## Kết nối Auth và Staff thật

Auth đang dùng `users.phone`, JWT RS256, subject `users.id`, role `EMPLOYEE`, trạng thái user/employee ACTIVE. Token A/B/Customer được cấp qua Auth login thật; không dùng marker hash seed làm mật khẩu. Tại `backend/auth-service`, chạy `npm.cmd run tokens:staff-test` để lấy token mới qua login và lưu riêng ngoài Git khi cần; không tự ký token ở Order.

Staff cần các giá trị công khai:

```dotenv
JWT_ALGORITHM=RS256
JWT_ISSUER=http://localhost:4001
JWT_AUDIENCE=cleanhome-staff-api
JWT_JWKS_URL=http://127.0.0.1:4001/.well-known/jwks.json
JWT_PUBLIC_KEY=
JWT_SECRET=
AUTH_INTROSPECTION_URL=http://127.0.0.1:4001/api/v1/auth/introspect
ORDER_SERVICE_URL=http://127.0.0.1:4003
ORDER_SERVICE_TIMEOUT_MS=5000
RECONCILIATION_WORKER_ENABLED=false
```

`ORDER_SERVICE_TOKEN` Staff phải bằng credential nội bộ Order. Staff không đọc biến token-file; dùng launcher để truyền giá trị vào môi trường tiến trình mà không sửa source hoặc `.env` Staff/Auth. Khi Auth và Order đã chạy, terminal khác tại `backend/order-service`:

```powershell
npm.cmd run staff:integration
```

Helper chỉ cho database test, chạy nguyên server Staff ở 4005 với JWT/MySQL/Order config đúng; worker mặc định tắt. Không mở thêm tiến trình trùng cổng. Chi tiết mapping A/B, payload và bằng chứng: [staff-integration.md](docs/staff-integration.md).

## Kiểm thử đã chạy

| Bộ kiểm thử | PASS | FAIL | SKIP |
| --- | ---: | ---: | ---: |
| Order độc lập | 72 | 0 | 0 |
| Order MySQL thật | 11 | 0 | 0 |
| Order gián đoạn/khôi phục thật | 6 | 0 | 0 |
| Order HTTP live | 8 | 0 | 0 |
| Staff HTTP nguyên mã được Order live gọi | 9 | 0 | 0 |
| HTTP cạnh tranh JWT thật trên fixture mới | 6 | 0 | 0 |

72 test độc lập gồm **36 domain, 17 service/HTTP dùng repository double và 19 repository/SQL double**. Đây không phải MySQL thật. Dòng Staff HTTP là test con nằm trong một test Order live; không cộng trùng hoặc xem số test là số endpoint.

MySQL thật kiểm chuyển hợp lệ/sai, booking không có, assignment sai booking, booking hủy/hoàn thành/chưa xác nhận, roster nhiều người, journal/pending, request lặp và payload conflict. Recovery dừng đúng Order process QA sở hữu, quan sát lỗi mạng, khởi động process mới, lấy ACK gốc và dùng `service.reconcile` của Staff nguyên mã gọi REST Order thật để commit assignment/ack. Worker recovery không gọi HTTP JWT nhân viên; bằng chứng JWT thật nằm ở suite live riêng.

Live dùng JWT do Auth cấp, kiểm missing/wrong/internal user JWT 401, browser Origin 403, quyền A/B, UC9–UC11, sáu bước UC12, timestamp/journal/ack/pending, retry và replay key cũ sau DONE. Booking chung **`9109131` đã COMPLETED**, assignments **`9109133`, `9109134` đã DONE**, đúng sáu journal riêng đã acknowledgement. A xong trước vẫn IN_PROGRESS, B xong mới COMPLETED. Không reset hoặc chạy lại chuỗi này trên fixture đã tiêu thụ.

Kiểm thử cạnh tranh **JWT thật** trong `test/concurrent.integration.test.js` đã đạt **6 PASS / 0 FAIL / 0 SKIP** (một test cha, năm test con), với Order main đã khởi động lại chứa kiểm tra đồng hồ quay lùi. Fixture mới booking **`9109141`**, assignments **`9109153`, `9109154`**, được giữ lại ở COMPLETED/DONE với sáu journal duy nhất đã acknowledgement. A/B nhận việc đồng thời và gửi trùng tổng bốn request không tạo thêm operation; bắt đầu đồng thời; DONE đồng thời nhận hai ACK booking IN_PROGRESS và COMPLETED. Replay cả sáu key sau hoàn thành không đổi trạng thái/timestamp/lịch sử. Suite còn kiểm Customer 403, không token 401 và A/B truy cập chéo 404 qua Staff HTTP thật. Đây là bằng chứng cạnh tranh REST/JWT riêng, khác chuỗi sáu bước tuần tự của booking `9109131`.

Các test MySQL/recovery tạo booking/item/hai assignment QA có marker bằng helper có guard, dùng Customer/Employee/Service hiện có và **giữ lại dữ liệu**. Manifest `secrets/mysql-qa-manifest.json` ghi ID/operation, không có credential. Không reset/xóa rows sau test; không dùng số 5 booking/6 assignment seed ban đầu làm tổng hiện tại. Người dùng, giá/lịch và dữ liệu ngoài thao tác được đối chiếu hash bảo toàn. Các bài test cũ giả định seed chưa chạy UC12 cần xem lại precondition; không reset trạng thái để ép PASS.

### Đối chiếu cuối lượt

Môi trường đã chạy: Node `24.21.0`, MySQL `9.6.0`, database `cleanhome_staff_test` trên `127.0.0.1:3306`. Sau bản sửa thời gian, chạy lại MySQL 11/11 và recovery 6/6 đạt; HTTP cạnh tranh chạy với Order main đã nạp bản sửa. Chuỗi live trên booking gốc chạy trước bản sửa này và không chạy lại vì dữ liệu đã hoàn tất.

Đối chiếu hash trước/sau khớp cho toàn bộ user, employee, service, bốn booking/assignment gốc ngoài booking được phép cập nhật, booking items gốc và mọi trường giá/lịch/liên hệ của cả năm booking gốc. Không công bố giá trị credential/password hash; chỉ dùng digest để đối chiếu.

Thời điểm kiểm tra cuối: 3 users, 2 employees, 24 bookings, 24 booking items, 44 assignments, 22 dòng history/journal, **0 journal pending**. Các hàng tăng thêm là fixture QA được giữ lại, không phải dữ liệu kinh doanh mới. Readiness Auth `4001`, Order `4003`, Staff `4005` đều HTTP 200. Kiểm tra cú pháp 21 file JavaScript đạt; không phát hiện private key/JWT literal trong source; `.env`/credential/manifest không được Git theo dõi; kiểm tra khoảng trắng đạt.

| Checklist bàn giao | Trạng thái | Bằng chứng/giới hạn |
| --- | --- | --- |
| Đúng phạm vi | PASS | 27 file source/config/test/docs trong Order; không sửa source Staff/Auth/Frontend |
| Không hồi quy trong phạm vi | PASS | 72 test độc lập, 11 MySQL, 6 recovery; consumer Staff HTTP và cạnh tranh thật đạt |
| Tương thích API | PASS | Bốn API được kiểm với OrderClient/runner Staff nguyên mã, request/response/error giữ contract hiện có |
| Phê duyệt contract bởi hai owner | NOT_VERIFIED | Cần chủ sở hữu Staff/Order review, không tự gán nhãn APPROVED |
| Database kiểm thử | PASS | Đúng database test; fixture có nhãn và giữ lại, không xóa/reset; dữ liệu bảo vệ đối chiếu khớp |
| Migration/schema | NOT_APPLICABLE | Dùng journal TEXT theo contract, không có DDL/migration hoặc sửa schema gốc |
| Security local | PASS | JWT thật, role/ownership, internal Bearer và secret ignore được kiểm; không dùng bypass |
| Reliability | PASS | Replay/conflict, commit guard, worker phục hồi sau gián đoạn và hai nhân viên đồng thời |
| Evidence/handoff | PASS | Tách dependency double/MySQL/HTTP thật; kết quả và cấu hình trong hai tài liệu Order |
| Git | PASS | Giữ nhánh có sẵn `feat/cleanhome-frontend` và thay đổi ngoài phạm vi; không commit/push/merge |
| Frontend Staff connected (local) | PASS trong Q01–Q06 | Giai đoạn Frontend/BFF sau lượt Backend này đã có 43 nhóm E2E thật; xem cập nhật đầu tài liệu |
| Production/HTTPS/tải lớn/crash thực tế | NOT_VERIFIED | Không suy từ local QA, hai nhân viên đồng thời hoặc fault mất response sang môi trường triển khai/tải lớn/crash |

### Lệnh kiểm thử

Mặc định nhóm có dependency SKIP khi chưa opt-in. Bật mà thiếu cấu hình/dependency/precondition phải FAIL; không fallback API/JWT giả. Có timeout HTTP/suite và giới hạn output. Tại `backend/order-service`:

```powershell
npm.cmd run test:unit

$env:RUN_ORDER_MYSQL_TESTS = 'true'
$env:ORDER_TEST_ALLOW_FIXTURE_WRITES = 'true'
try { npm.cmd run test:mysql }
finally {
  Remove-Item Env:RUN_ORDER_MYSQL_TESTS -ErrorAction SilentlyContinue
  Remove-Item Env:ORDER_TEST_ALLOW_FIXTURE_WRITES -ErrorAction SilentlyContinue
}

$env:RUN_ORDER_RECOVERY_TESTS = 'true'
$env:ORDER_TEST_ALLOW_FIXTURE_WRITES = 'true'
try { npm.cmd run test:recovery }
finally {
  Remove-Item Env:RUN_ORDER_RECOVERY_TESTS -ErrorAction SilentlyContinue
  Remove-Item Env:ORDER_TEST_ALLOW_FIXTURE_WRITES -ErrorAction SilentlyContinue
}

# Tạo fixture QA mới và giữ lại; cần Auth/Staff/Order thật, token còn hạn:
$env:RUN_ORDER_CONCURRENT_TESTS = 'true'
$env:ORDER_TEST_ALLOW_FIXTURE_WRITES = 'true'
try { npm.cmd run test:concurrent }
finally {
  Remove-Item Env:RUN_ORDER_CONCURRENT_TESTS -ErrorAction SilentlyContinue
  Remove-Item Env:ORDER_TEST_ALLOW_FIXTURE_WRITES -ErrorAction SilentlyContinue
}
```

`test:live` dùng `RUN_ORDER_LIVE_TESTS=true` và `ORDER_LIVE_CONSUME_SHARED_BOOKING=9109131`; wrapper gọi suite Staff với ba guard ghi. **Lượt này đã chạy và tiêu thụ fixture; không chạy lại lệnh live trên booking hiện đã DONE.** Không có guard nào cấp phép reset hoặc bỏ qua precondition. Muốn lặp toàn chuỗi booking gốc cần nhóm thống nhất fixture/contract test mới; có thể kiểm thử trên fixture mới bằng suite concurrent có sẵn.

## Giới hạn và phần còn lại

- Chưa kiểm thử production, HTTPS/mTLS/network policy, tải lớn, topology nhiều MySQL writer, nhiều instance Order/worker hoặc triển khai database riêng theo service. Cần giữ `/internal/*` ngoài public gateway; Origin/CORS không thay bảo vệ mạng.
- Journal TEXT cần đánh giá hiệu năng/index và migration kiểm soát riêng khi tăng quy mô; chưa có dead-letter/backoff phân tán. Pending round-robin là cursor bộ nhớ, không queue bền vững.
- Chưa có dữ liệu cancellation pending; không suy diễn null thành đã xác nhận không có yêu cầu hủy. Chưa cung cấp API quản lý hủy/roster trong lượt UC12 này.
- Hai context API tùy chọn của Staff contract **chưa triển khai**: GET `/internal/v1/bookings/:bookingId/staff-context`, POST `/internal/v1/bookings/staff-context/batch`. UC10 vẫn dùng SQL đã phân quyền và giữ warning/null cho lịch sử bổ sung; không fake dữ liệu.
- Ở giai đoạn Backend lịch sử này chưa sửa Frontend; giai đoạn sau đã tích hợp Frontend Staff qua BFF với Auth/JWT/REST thật và nghiệm thu Q01–Q06. Chỉ các luồng Staff đã nối mới dùng Backend; localStorage cũ được giữ nguyên, không suy rộng sang Customer/Admin. Không tự đổi kiến trúc microservices.
- Contract Staff trước đây có nhãn đề xuất do Order chưa tồn tại; implementation và bằng chứng hiện nằm tại README này. Chủ sở hữu Staff/Order cần review và cập nhật trạng thái bàn giao khi thống nhất, không tự coi contract đã được con người phê duyệt.

## File thay đổi

Tất cả đường dẫn dưới đây thuộc `backend/order-service/`; giữ Git chưa commit của các khu vực khác. Không có secret/.env cục bộ trong danh sách source bàn giao.

| Nhóm | File | Nội dung |
| --- | --- | --- |
| Package/cấu hình | `package.json`, `package-lock.json`, `.gitignore`, `.env.example` | Dependency khóa phiên bản, scripts, ignore và template không secret |
| HTTP/xác thực | `src/app.js`, `src/internal-auth.js`, `src/validation.js` | Bốn route, health, service Bearer, Origin, validation và lỗi |
| Nghiệp vụ | `src/domain.js`, `src/service.js` | State machine, aggregate nhiều nhân viên, ACK/journal/idempotency và đối chiếu thời gian |
| MySQL | `src/db.js`, `src/repository.js` | Pool, schema/FK/index check, transaction/locks và journal/pending |
| Runtime | `src/config.js`, `src/runtime.js`, `src/server.js` | Đọc config/credential, startup/shutdown với MySQL thật |
| Script | `scripts/generate-service-token.js`, `scripts/start-staff.js`, `scripts/test-http.js` | Cấp credential tường minh, launcher Staff nguyên mã, helper HTTP/token thật |
| Test độc lập | `test/domain.test.js`, `test/http.test.js`, `test/repository.test.js` | Domain và dependency double có phân loại |
| Test MySQL | `test/fixtures.js`, `test/mysql.integration.test.js` | Fixture riêng có guard/manifest và repository MySQL thật |
| Test tích hợp | `test/live.integration.test.js`, `test/recovery.integration.test.js`, `test/concurrent.integration.test.js` | HTTP JWT thật, gián đoạn/phục hồi và cạnh tranh trên dữ liệu test |
| Tài liệu | `README.md`, `docs/staff-integration.md` | Contract triển khai, cấu hình, kết quả và giới hạn |

Bàn giao cùng [contract Staff → Order](../staff-service/docs/order-service-contract.md), [checklist Order](../staff-service/docs/order-handoff-checklist.md), [contract Auth](../auth-service/docs/auth-contract.md) và [hướng dẫn Auth → Staff](../auth-service/docs/staff-integration.md). Credential thực tế chỉ truyền qua kênh an toàn ngoài Git. Không tự commit, push hoặc merge.
