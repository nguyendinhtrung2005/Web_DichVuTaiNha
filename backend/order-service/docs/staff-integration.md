# CleanHome — tích hợp Order với Staff UC12

Đã kiểm thử UC12 qua **Auth RS256 → Staff → Order → MySQL thật**, giữ nguyên source Staff/Auth/Frontend và schema 32 bảng. Bốn API nội bộ tương thích contract hiện có; không thêm DDL hoặc migration. Kết quả và giới hạn của lượt triển khai được ghi tại [README Order](../README.md).

## Kết quả chạy thực tế ngày 23/10/2026

| Bộ kiểm thử | PASS | FAIL | SKIP | Bằng chứng chính |
| --- | ---: | ---: | ---: | --- |
| Order độc lập | 72 | 0 | 0 | 36 domain, 17 service/HTTP với repository double và 19 repository/SQL double |
| Order MySQL thật | 11 | 0 | 0 | Journal, idempotency, trạng thái và nhiều nhân viên trên database test |
| Khôi phục với tiến trình Order thật | 6 | 0 | 0 | Dừng/khởi động lại đúng tiến trình QA, ACK bền vững, worker Staff thật phục hồi pending |
| Order HTTP tích hợp thật | 8 | 0 | 0 | Health, service Bearer, JWT A/B, suite Staff, SQL và bốn API sau hoàn thành |
| Suite Staff HTTP nguyên mã do Order runner gọi | 9 | 0 | 0 | RS256 thật, quyền A/B, UC9–UC11, UC12 và retry |
| HTTP cạnh tranh JWT thật trên fixture mới | 6 | 0 | 0 | Một test cha/năm test con; request đồng thời/trùng, aggregate DONE và replay |

Dòng Staff là thống kê test con lồng trong một test của suite Order HTTP, **không cộng lại để tuyên bố số endpoint độc lập**. Các số trên không thay bằng chứng kiểm thử production, database tách biệt hoặc mạng thực tế ngoài loopback.

Booking `9109131` đã **COMPLETED**; assignment `9109133` và `9109134` đã **DONE**, có check-in/check-out khớp ACK và đúng sáu journal riêng đã acknowledgement. Khi A xong trước, booking vẫn IN_PROGRESS; B xong mới COMPLETED. Retry, replay key cũ sau DONE và payload khác cùng operation đã được kiểm chứng; dữ liệu người dùng và các booking/assignment không thuộc thao tác được đối chiếu bảo toàn.

Unit test bổ sung kiểm đồng hồ quay lùi: DONE không được có thời điểm trước check-in hoặc journal đã lưu; thiếu check-in thật hoặc bằng chứng start từ journal bị từ chối trước commit. Không để Order phát ACK không thể được Staff acknowledgement vì mâu thuẫn thời gian.

**Fixture chung đã bị tiêu thụ, không chạy lại toàn chuỗi trên `9109131` và không reset nó.** MySQL/recovery tạo fixture QA riêng có marker và giữ lại dữ liệu sau chạy; metadata ID/operation nằm tại `secrets/mysql-qa-manifest.json` cục bộ ngoài Git. Database hiện có thêm các hàng QA nên số lượng không còn chỉ là 5 booking/6 assignment ban đầu. Sau lượt kiểm tra được ghi nhận, không còn operation pending; đây là trạng thái quan sát tại thời điểm đó.

Auth `4001`, Order `4003`, Staff `4005` được giữ chạy sau kiểm thử; Order main đã khởi động lại với kiểm tra đồng hồ quay lùi. Không đưa password, token hoặc private key vào kết quả.

HTTP cạnh tranh dùng JWT Auth thật trên booking QA **`9109141`**, assignments **`9109153`, `9109154`**, đã đạt **6 PASS / 0 FAIL / 0 SKIP**. A/B nhận việc đồng thời với tổng bốn request gồm retry trùng không tạo operation dư; hai request bắt đầu và hai request DONE đồng thời vẫn cho đúng hai snapshot IN_PROGRESS/COMPLETED. Cả sáu key được replay sau hoàn thành, không đổi state/timestamp/lịch sử; dữ liệu ngoài fixture được bảo toàn. Customer 403, thiếu token 401 và truy cập chéo A/B 404 đều kiểm qua Staff HTTP thật. Fixture được giữ lại ở COMPLETED/DONE, đúng sáu journal duy nhất đã acknowledgement. Đây là suite riêng, không suy ra từ chuỗi A/B tuần tự trên booking gốc `9109131`.

## Ranh giới dữ liệu

| Service | Quyền sở hữu trong UC12 |
| --- | --- |
| Auth | Kiểm credential của `users`, cấp JWT RS256, public JWKS và introspection |
| Staff | Xác thực JWT người dùng, phân quyền nhân viên, ghi `assignments.status/check_in_at/check_out_at` |
| Order | Quyết định `bookings.status`; ghi `booking_status_history`; sở hữu journal và ACK của operation |

Hiện các service phát triển dùng projection trên cùng MySQL. Đây chưa phải kiến trúc database tách biệt hoàn toàn. Order đọc `assignments`, `employees` và `users` để kiểm quan hệ/quyền; không cập nhật các bảng này hoặc giá/lịch/booking_items. Khi tách database, cần thay projection bằng contract dữ liệu tương ứng, không tiếp tục cấp quyền SQL chéo service.

Schema có `booking_status_history.note TEXT`, nhưng không có bảng outbox, unique operation ID hoặc trường yêu cầu hủy đang chờ. Journal dùng JSON có marker `kind: "cleanhome.staff-transition"`, `version: 1`, trong một dòng lịch sử cho mỗi operation; giữ nguyên note cũ không thuộc marker. `cancellationPending` luôn `null` vì chưa có dữ liệu tương ứng, không giả định đã kiểm tra không có yêu cầu hủy. Không có DDL/migration/reset tự động.

## Bốn API nội bộ

Base URL local: `http://127.0.0.1:4003`. Mọi endpoint bắt buộc service Bearer credential; JWT nhân viên không thay thế service credential. Ba endpoint theo booking còn cần `X-Actor-User-Id` trùng `actorUserId` trong query/body. PUT và POST cần `Idempotency-Key` bằng `operationId` của URL.

| Method | Endpoint | Nội dung và phản hồi |
| --- | --- | --- |
| GET | `/internal/v1/bookings/:bookingId/assignment-transitions/:operationId` | Query đủ năm trường payload; ACK gốc nếu có, chỉ `404 TRANSITION_NOT_FOUND` có nghĩa chưa có operation |
| PUT | `/internal/v1/bookings/:bookingId/assignment-transitions/:operationId` | JSON đủ năm trường; `200` + ACK sau transaction Order commit |
| POST | `/internal/v1/bookings/:bookingId/assignment-transitions/:operationId/acknowledgement` | JSON đủ năm trường; `200 {operationId,bookingId,assignmentId,acknowledged:true}` sau đối chiếu Staff đã commit |
| GET | `/internal/v1/assignment-transitions/pending?limit=20` | Không cần actor header; limit 1–100; `200 {operations:[Operation]}` |

Payload dùng cho query hoặc JSON:

```json
{
  "assignmentId": "9109133",
  "employeeId": "9109004",
  "actorUserId": "9109002",
  "fromStatus": "ASSIGNED",
  "toStatus": "ACCEPTED"
}
```

Đây là ví dụ cấu trúc từ fixture, không phải một request đã chạy. ID thực thể là chuỗi BIGINT dương canonical, không ép Number. Các bước hợp lệ là `ASSIGNED → ACCEPTED → IN_PROGRESS → DONE`. Operation ID do Staff tạo bằng SHA-256 của JSON `[actorUserId, assignmentId, Idempotency-Key-của-client]`; key của request nội bộ chính là operation ID này. Đổi payload trong cùng operation là xung đột, không phải thao tác mới.

ACK có `{operationId,bookingId,assignmentId,assignmentStatus,occurredAt,booking:{id,status,cancellationPending}}`. `occurredAt` dùng UTC, độ chính xác giây, quyết định một lần và giữ nguyên khi replay. Operation trong pending có `{id,bookingId,assignmentId,employeeId,actorUserId,fromStatus,toStatus}`. Không trả token, password/hash hoặc thông tin liên hệ trong các cấu trúc này.

Lỗi JSON có dạng `{error:{code,message}}`. Staff đã biết các mã nghiệp vụ `BOOKING_CANCELLED`, `BOOKING_COMPLETED`, `BOOKING_NOT_CONFIRMED`, `CANCELLATION_PENDING`, `INVALID_TRANSITION`, `ASSIGNMENT_NOT_ACTIVE`, `STALE_ASSIGNMENT`, `IDEMPOTENCY_CONFLICT`, `OPERATION_CONFLICT` tại HTTP 409/422. Lỗi 401/403 nội bộ không được giải thích thành nhân viên cần đăng nhập lại. Sai credential, validation, database hoặc transaction phải trả lỗi, không ACK giả.

Không public-route `/internal/*` qua gateway hoặc Frontend. Mặc định local chỉ listen loopback; khi triển khai service network phải áp dụng firewall/network policy, HTTPS hoặc mTLS và secret manager phù hợp. CORS không thay xác thực hay giới hạn mạng. Không chép token nội bộ vào JavaScript trình duyệt, Git, URL, ảnh chụp hoặc log.

## Transaction, retry và hai nhân viên

1. Staff giữ khóa assignment của chính mình rồi lookup/apply Order. Order khóa booking để tuần tự hóa quyết định; **không khóa ghi assignment** vì sẽ tạo vòng chờ với Staff đang đợi REST.
2. Order dùng operation lock và journal bền vững để đối chiếu operation/payload; cache RAM không phải nguồn idempotency. Cùng operation/payload trả nguyên ACK, kể cả booking hiện đã COMPLETED. Cùng operation nhưng payload khác bị từ chối.
3. Quyết định tổng hợp dùng roster hiện tại cộng operation đã commit còn pending, vì Staff có thể chưa commit assignment sau ACK. A DONE trong khi B chưa DONE vẫn để booking IN_PROGRESS. Chỉ tất cả assignment còn hiệu lực DONE mới COMPLETED; assignment CANCELLED không tính vào nhóm phải hoàn thành.
4. Order commit booking/journal trước khi trả `200`; Staff mới ghi status/check-in/check-out bằng timestamp ACK. POST acknowledgement chỉ ghi cờ đã xác nhận của journal sau đối chiếu assignment đã đạt hoặc vượt bước đó. Không đổi operation/ACK, không thêm lịch sử khi ack/retry.
5. Order commit nhưng mất response hoặc Staff commit thất bại: journal giữ pending; cùng key hoặc worker dùng ACK gốc để hoàn tất. Staff đã commit nhưng acknowledgement thất bại: HTTP Staff trả `202 PENDING_ACKNOWLEDGEMENT`, chưa được báo đồng bộ thành công. Khi cả hai phía xong mới `200 SYNCHRONIZED`.

Khi replay key cũ sau các bước tiếp theo, trạng thái assignment trong response Staff là trạng thái hiện tại; `orderAtTransition` vẫn là snapshot ACK gốc. Cần kiểm không lùi trạng thái, timestamp không đổi và không tăng số journal; không so nguyên response với lần đầu.

Cancellation, đổi roster hoặc chuyển assignment giữa nhân viên về sau phải tham gia cùng booking lock và đối chiếu pending. Chưa có API quản lý các thao tác này trong phạm vi UC12. Journal trên TEXT thiếu index pending/operation chuyên biệt nên cần đánh giá hiệu năng, giới hạn số bản ghi và migration riêng khi tăng quy mô. Pending giữ response limit theo contract, chọn batch round-robin bằng cursor trong bộ nhớ để tránh lặp mãi nhóm đầu; cursor này mất khi restart, không phải queue bền vững hoặc cam kết fairness giữa nhiều instance. Các operation không thể phục hồi cần theo dõi/xử lý thủ công, không tự xóa journal hoặc reset assignment để làm sạch hàng đợi.

## Cấu hình Staff mà không sửa source

Giữ Auth thật đang chạy ở `4001`; Staff ở `4005`. Auth cung cấp issuer `http://localhost:4001`, audience `cleanhome-staff-api`, JWKS `http://127.0.0.1:4001/.well-known/jwks.json` và introspection `/api/v1/auth/introspect`. Staff kiểm RS256 và dùng `sub = users.id`; không phải `employees.id`.

Các giá trị công khai bổ sung cho môi trường tiến trình Staff:

```dotenv
ORDER_SERVICE_URL=http://127.0.0.1:4003
ORDER_SERVICE_TIMEOUT_MS=5000
RECONCILIATION_WORKER_ENABLED=false
```

Order cần đúng một nguồn credential: `ORDER_SERVICE_TOKEN` hoặc `ORDER_SERVICE_TOKEN_FILE=secrets/staff-service.token`. Tại `backend/order-service`, `npm.cmd run generate:service-token` cấp credential ngẫu nhiên riêng, không hardcode, không sinh tự động khi startup và không ghi đè file đã có. File `secrets/` nằm ngoài Git; không gửi qua chat/log. Mật khẩu MySQL cũng chỉ cấu hình trong `.env` cục bộ được ignore.

Staff cần **giá trị thô** qua `ORDER_SERVICE_TOKEN` từ cùng credential đã cấp cho Order; config Staff hiện không hỗ trợ biến `ORDER_SERVICE_TOKEN_FILE`. Không có giá trị mẫu dùng được hoặc fallback secret. Có thể đọc file secret cục bộ đã ignore vào biến môi trường tiến trình, không in nội dung, không sửa `.env` của thành viên khác. Auth private key chỉ ở Auth; Order không cần private key này.

Chạy `npm.cmd start` trong thư mục Order sau khi hoàn tất `.env` theo `.env.example`; runtime kiểm schema trước khi listen. Script kiểm thử Order là `test:unit`, `test:mysql`, `test:recovery` và `test:live`; các cờ opt-in bên dưới và kết quả có trong README. Không dùng port frontend `3003` thay port backend `4003`.

Để mở Staff đã cấu hình Order/JWT mà **không sửa file Staff hoặc Auth**, tại terminal riêng trong `backend/order-service` chạy:

```powershell
npm.cmd run staff:integration
```

Helper đọc `.env` và credential riêng của Order, chỉ cho database `cleanhome_staff_test`, rồi chạy nguyên `backend/staff-service/src/server.js` với môi trường tiến trình: MySQL test, issuer/audience/JWKS/introspection Auth, URL/Bearer Order, worker tắt. Không nạp hoặc ghi đè `.env` Staff; không sinh JWT/token thay Auth. `STAFF_INTEGRATION_PORT` mặc định 4005; `ORDER_LIVE_BASE_URL`/`ORDER_LIVE_AUTH_URL` chỉ nhận URL loopback. Dùng server đang chạy nếu đã đúng cấu hình để tránh trùng cổng.

Hai API đọc context là tùy chọn, không phải điều kiện ACK UC12: GET `/internal/v1/bookings/:bookingId/staff-context` và POST `/internal/v1/bookings/staff-context/batch`. Nếu chưa cung cấp, UC10 vẫn đọc SQL đã phân quyền và báo lịch sử bổ sung không lấy được; không giả lịch sử rỗng hoặc bỏ quyền. Không báo hai API tùy chọn đã tồn tại nếu README chưa xác nhận.

## Kế hoạch và bằng chứng kiểm thử

| Lớp kiểm thử | Cần chứng minh | Giới hạn |
| --- | --- | --- |
| Độc lập | Validation, payload/operation conflict, trạng thái, tổng hợp roster, credential sai, lỗi transaction/retry | Dependency double không chứng minh MySQL/HTTP thật |
| Repository MySQL test | FK, transaction/rollback, journal nguyên vẹn, ack/pending, đồng thời hai nhân viên và cùng operation | Không thay JWT/HTTP tích hợp |
| HTTP Order thật | Bốn endpoint, Bearer thật, request/response contract, lỗi xác thực và idempotency | Gọi Order trực tiếp không chứng minh JWT nhân viên ở Staff |
| Auth → Staff → Order → MySQL | JWT thật, phân quyền A/B, sáu bước UC12, timestamps, journal, replay | Phải bật guard ghi, fixture bị tiêu thụ thật |
| Khôi phục | Order đã commit trước mất response; Staff chưa commit; ack mất response; restart/worker không trùng | Cần môi trường điều khiển lỗi riêng, không dừng service của người khác |

Trên MySQL chỉ được dùng `cleanhome_staff_test` đã xác minh. Các ca cạnh tranh/khôi phục cần booking kiểm thử riêng có marker, dùng Customer/Service hiện có, giữ lại ID và trạng thái sau chạy trong báo cáo. Không DROP/TRUNCATE/DELETE/reset, không thay dữ liệu seed để ép precondition. Bài HTTP ghi liên service có commit thật, không thể hứa rollback toàn chuỗi. Mọi ca chưa chạy hoặc thiếu điều kiện phải ghi SKIP/CHƯA KIỂM, không đổi thành PASS.

Tại `backend/order-service`, kiểm thử độc lập không cần dependency bằng `npm.cmd run test:unit`. Hai nhóm sau **ghi fixture QA mới, giữ lại dữ liệu**, chỉ chạy khi được phép trên database test:

```powershell
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
```

Recovery dùng Order server riêng trên cổng loopback rảnh, dừng/khởi động lại đúng tiến trình test sở hữu. Nó giữ journal đã commit, gọi `service.reconcile` của runtime Staff nguyên mã; worker kiểm nhân viên trong MySQL và gọi REST Order thật để phục hồi. Nó kiểm retry không ghi trùng và không dừng Auth/Staff/Order đang dùng chung. Runtime Staff vẫn có cấu hình RS256 hợp lệ; ca worker này không gọi HTTP/JWT nhân viên, nên bằng chứng JWT nằm ở suite live riêng, không lấy từ recovery. Không thay middleware hoặc giả HTTP thành công.

### Fixture HTTP hai nhân viên

| Nhân viên | `users.id` / JWT sub | `employees.id` | Assignment chung | Booking chung |
| --- | --- | --- | --- | --- |
| A | `9109002` | `9109004` | `9109133` | `9109131` |
| B | `9109101` | `9109102` | `9109134` | `9109131` |

Token Customer có sub `9109001` dùng kiểm 403. Cả A/B cần user/employee ACTIVE và credential đã provision bằng scrypt; không dùng hash marker làm mật khẩu. Tại `backend/auth-service`, `npm.cmd run tokens:staff-test` đăng nhập thật, lưu token riêng ngoài Git, không in token.

Runner có sẵn `backend/staff-service/test/http.integration.test.js`; Order wrapper là `test/live.integration.test.js`. Lượt đã chạy kiểm server/runner/Order đều trỏ cùng database test, booking CONFIRMED, hai assignment ASSIGNED, check-in/out NULL, đúng marker `cleanhome-staff-uc9-uc12-multi-v1`, chưa có transition journal trước ghi. Hiện các precondition này không còn đúng vì fixture đã COMPLETED; runner phải chặn, không reset hoặc seed lại.

Wrapper Order dùng `RUN_ORDER_LIVE_TESTS=true` cùng xác nhận `ORDER_LIVE_CONSUME_SHARED_BOOKING=9109131`, gọi `npm.cmd run test:live`. Nó lấy token được Auth cấp trong `../auth-service/secrets/tokens/`, gọi nguyên suite Staff với ba guard dưới đây, đọc SQL đối chiếu journal/timestamp và kiểm bốn API Order bằng service credential thật. Hai cờ không làm mới fixture hoặc bỏ qua precondition. Lệnh này đã chạy đạt một lần; không dùng lại trên dữ liệu đã tiêu thụ.

Các cờ Staff sau mô tả lượt ghi đã chạy, **không phải hướng dẫn chạy lại fixture hiện đã DONE**:

```powershell
$env:RUN_STAFF_HTTP_TESTS = 'true'
$env:RUN_STAFF_HTTP_WRITE_TESTS = 'true'
$env:STAFF_HTTP_WRITE_BOOKING_ID = '9109131'
try { npm.cmd run test:http }
finally {
  Remove-Item Env:RUN_STAFF_HTTP_TESTS -ErrorAction SilentlyContinue
  Remove-Item Env:RUN_STAFF_HTTP_WRITE_TESTS -ErrorAction SilentlyContinue
  Remove-Item Env:STAFF_HTTP_WRITE_BOOKING_ID -ErrorAction SilentlyContinue
}
```

Runner cần ba token A/B/Customer qua `STAFF_HTTP_TOKEN_*` hoặc `STAFF_HTTP_TOKEN_*_FILE`; đúng một nguồn cho mỗi token. Token file do Auth cấp có thể được tham chiếu từ cấu hình tiến trình, không sao chép vào source. Thiếu dependency khi đã bật test là FAIL, không fallback xác thực giả.

Chuỗi ghi: A nhận → B nhận → A bắt đầu → B bắt đầu → A xong → B xong. Đối chiếu mỗi bước với MySQL, lookup ACK gốc, journal đúng một dòng và acknowledgement. Sau A xong booking phải IN_PROGRESS; sau B xong mới COMPLETED. Retry cùng key không tăng lịch sử hoặc đổi timestamp; payload khác cùng key bị từ chối; mỗi người chỉ truy cập assignment của mình, kể cả cùng booking.

**Bài ghi tiêu thụ fixture `9109131`**. Sau khi hoàn thành hoặc thất bại giữa chừng, giữ dữ liệu đã commit để điều tra. Test không tự reset/trả trạng thái cũ; muốn chạy lại toàn chuỗi cần chuẩn bị fixture riêng được nhóm thống nhất. Worker cũng có thể ghi phục hồi pending nên chỉ bật khi đã kiểm tra quyền, credential và dữ liệu đích.

MySQL/recovery đã kiểm aggregate khi còn pending journal, operation commit được lookup sau restart, ack trước Staff commit bị từ chối, pending đã ack không xuất hiện và worker lặp không thêm journal. Chuỗi HTTP booking gốc là tuần tự; suite cạnh tranh JWT thật trên booking QA riêng đã kiểm chứng request đồng thời và retry trùng. Không khẳng định cả hàng đợi rỗng chỉ vì operation test không nằm trong một batch limit.

## Hồ sơ bàn giao

- [Contract Staff → Order](../../staff-service/docs/order-service-contract.md) và [checklist Order](../../staff-service/docs/order-handoff-checklist.md): payload/error/ACK hiện Staff thực sự dùng.
- [Contract Auth](../../auth-service/docs/auth-contract.md) và [tích hợp Auth → Staff](../../auth-service/docs/staff-integration.md): issuer/audience/sub/role và cách lấy token thật.
- [Runner HTTP Staff](../../staff-service/docs/http-integration-testing.md): guard, giới hạn và fixture tiêu thụ.
- [README Order](../README.md): biến môi trường, scripts, file đã thay đổi và số PASS/FAIL/SKIP thực tế của lượt triển khai.

Không có token, mật khẩu, private key, `.env` cục bộ hoặc dữ liệu vault trong hồ sơ nguồn. Không tự commit/push/merge; không thay Staff/Auth/Frontend để làm test qua.
