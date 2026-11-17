# Contract tích hợp Staff → Order Service

**Trạng thái thực thi: đã triển khai và có bằng chứng tích hợp local; phê duyệt contract chính thức vẫn chờ owner Staff/Order.** `src/order-client.js` là REST client thật; không có Order giả trong runtime. Test client dùng stub riêng có nhãn mock; HTTP/MySQL/E2E thật là lớp bằng chứng riêng, không suy ra từ stub.

Checklist bàn giao bốn API, điều kiện chạy HTTP thật và assertion nhiều nhân viên: [order-handoff-checklist.md](order-handoff-checklist.md). Các ô checklist chưa được đánh dấu đạt không phải bằng chứng đã tích hợp Order.

## Cập nhật bằng chứng local ngày 24/10/2026

Theo [báo cáo nghiệm thu UC12](../../../frontend/apps/staff/docs/UC12_E2E_QA_REPORT.md), luồng Browser → BFF → Auth/Staff → Order → MySQL thật trên `cleanhome_staff_test` đạt **43 nhóm E2E PASS, 0 FAIL, 0 SKIP, 0 NOT_RUN** cho Q01–Q06. Hồi quy HTTP riêng đạt **90 PASS, 0 FAIL, 1 SKIP** do thiếu fixture UC11 qua ranh ngày UTC/Việt Nam; không cộng hai lớp kiểm thử hoặc coi SKIP là PASS.

Sáu booking `9109151–9109156` đã COMPLETED, mười hai assignment `9109173–9109184` đã DONE, 36 journal mới đã ACK; giữ nguyên dữ liệu và không chạy lại workflow. Booking cũ `9109131` và `9109141` cũng đã COMPLETED. Muốn kiểm thử ghi thêm cần fixture và phạm vi được duyệt riêng.

Đây là bằng chứng local HTTP trên một máy; chưa kiểm chứng production, HTTPS/Secure cookie thực, tải lớn/stress/soak, nhiều host/replica hoặc crash/kill/mất điện/restore trong lượt Frontend này. Fault Q03–Q06 là mất kết nối/phản hồi thật, không phải crash tiến trình. Worker toàn database tắt. Kết quả không thay phê duyệt contract/PR của owner; các kết quả giai đoạn cũ phía dưới được giữ làm lịch sử.

## Ranh giới và schema đã xác minh

Staff chỉ ghi `assignments.status/check_in_at/check_out_at`. Order sở hữu `bookings`, `booking_items`, `booking_status_history` và quyết định trạng thái tổng thể của đơn. Staff không UPDATE các bảng Order.

Schema hiện hữu `databases/schema.sql` có 32 bảng, gồm `booking_status_history.note TEXT NOT NULL` và `created_at TIMESTAMP`. Không có bảng outbox, version, booking_code, created_at của bookings hoặc cột yêu cầu hủy chờ duyệt. Contract này **không tạo bảng/cột/migration**, không chạy DDL hoặc reset dữ liệu.

UC9–UC11 hiện đọc projection SQL liên bảng trên MySQL phát triển chung, có lọc quyền tại repository. Hai endpoint context bên dưới chuẩn bị cho bước tách database; hiện detail chỉ dùng context REST để lấy lịch sử/cờ hủy tùy chọn. Thiếu Order không làm giả lịch sử hoặc bỏ qua quyền Staff.

## Giao tiếp, xác thực và bảo vệ dữ liệu

- Base URL lấy từ `ORDER_SERVICE_URL`. Chỉ dùng HTTP/HTTPS đã cấu hình; không có credential trong URL.
- Mọi request nội bộ dùng `Authorization: Bearer <ORDER_SERVICE_TOKEN>` do hạ tầng cấp. Token là credential service-to-service; **không phải JWT người dùng**, không ghi token vào journal, database, URL hoặc log.
- `X-Actor-User-Id` là danh tính đã được Staff xác thực qua JWT, truyền trong các request đọc chi tiết/chuyển trạng thái. Nó không tự xác thực request; Order phải xác thực service credential trước.
- ID booking/assignment/employee/user/service phải là số BIGINT signed dương dạng chuỗi canonical, không zero đầu hoặc ký tự thừa, tối đa `9223372036854775807`; không ép Number gây mất precision. Client từ chối các chuỗi như `7junk` trước khi chúng có thể bị MySQL ép kiểu thành ID khác, kể cả trong danh sách pending của worker. Operation ID là mã riêng có thể chứa chữ, số, gạch ngang/gạch dưới. Ví dụ JSON trong tài liệu chỉ minh họa cấu trúc, không phải seed hoặc dữ liệu đã tạo.
- JSON UTF-8; request không tự theo redirect để tránh gửi credential sang đích khác. Client giới hạn response 1 MiB và timeout mặc định 5 giây, tối đa cấu hình 30 giây. Mỗi lần gọi gửi đúng một request; retry do request lặp/worker, dùng cùng operation ID.

## Endpoint nội bộ cần Order cung cấp

Có **bốn endpoint bắt buộc cho UC12 và cơ chế khôi phục**, đã được Order triển khai theo contract; bằng chứng Backend local của bốn API nằm ở [README Order](../../order-service/README.md). Q01–Q06 kiểm Frontend qua ba API lookup/apply/ack; worker toàn database tắt, không suy từ lượt Frontend này sang pending/global worker. **Hai endpoint đọc context tùy chọn chưa triển khai**. Đường dẫn/DTO dưới đây được giữ nguyên.

### Bốn endpoint UC12/worker

Tất cả dùng Bearer service credential. Ba endpoint theo booking thêm header `X-Actor-User-Id`; GET pending không mang danh tính của một người dùng cụ thể.

| Method | Endpoint | Hàm client / nơi gọi | Đầu vào bổ sung | Response 200 bắt buộc | Ý nghĩa |
| --- | --- | --- | --- | --- | --- |
| GET | `/internal/v1/bookings/:bookingId/assignment-transitions/:operationId` | `getAssignmentTransition` / `StaffJobService.performTransition` | Query đủ năm trường payload bên dưới | ACK gốc; riêng 404 JSON `TRANSITION_NOT_FOUND` được chuyển thành null | Tra journal trước mỗi PATCH hoặc lần worker đối chiếu; 404 của route chưa triển khai không được coi là chưa có operation |
| PUT | `/internal/v1/bookings/:bookingId/assignment-transitions/:operationId` | `applyAssignmentTransition` / `performTransition`, chỉ khi lookup chưa có và bước hiện tại hợp lệ | Body đủ năm trường; `Idempotency-Key: operationId` | ACK với ID/bước khớp và `occurredAt` hợp lệ, sau khi transaction Order commit | Ghi operation/lịch sử và trạng thái tổng thể đơn một cách idempotent |
| POST | `/internal/v1/bookings/:bookingId/assignment-transitions/:operationId/acknowledgement` | `ackAssignmentTransition` / `performTransition`, sau khi transaction Staff commit | Body đủ năm trường; `Idempotency-Key: operationId` | `{operationId,bookingId,assignmentId,acknowledged:true}`; ID phải khớp | Xác nhận Staff đã áp dụng operation, không tạo lại lịch sử hoặc sửa ACK gốc |
| GET | `/internal/v1/assignment-transitions/pending?limit=20` | `listPendingTransitions` / `StaffJobService.reconcile`, được `startReconciliation` gọi | `limit` nguyên 1–100, mặc định 20 | `{operations:[Operation]}`, không quá limit, không trùng ID, từng operation có ID BIGINT/bước hợp lệ | Cần cho worker phục hồi sau mất response/crash; không được gọi trực tiếp bởi một PATCH thông thường |

UC12 thường gọi lookup → apply nếu cần → acknowledgement. Worker thêm bước lấy pending trước, rồi dùng lại cùng `performTransition`; không có đường ghi assignment bỏ qua kiểm tra quyền hoặc bước chuyển.

### Hai endpoint context tùy chọn

| Method | Endpoint | Hàm client / trạng thái sử dụng | Đầu vào | Response 200 |
| --- | --- | --- | --- | --- |
| GET | `/internal/v1/bookings/:bookingId/staff-context` | `getBookingDetail` / UC10 chỉ bật khi có URL và credential Order | Header `X-Actor-User-Id` | `BookingContext`; Staff hiện chỉ bổ sung lịch sử và cờ yêu cầu hủy, không thay dữ liệu đơn bằng giá trị tự tạo |
| POST | `/internal/v1/bookings/staff-context/batch` | `getBookingContexts` / **chưa có nơi gọi trong luồng nghiệp vụ hiện tại**, chuẩn bị khi tách projection SQL | Body `{bookingIds:["80"],actorUserId:"7"}`; không có header actor trong implementation này | `{bookings:[BookingContext]}` đủ mọi ID được yêu cầu; batch input rỗng trả Map rỗng tại client, không gửi HTTP |

Thiếu hai endpoint đọc này không ngăn UC9–UC11 lấy dữ liệu SQL được phân quyền. UC10 trả `orderHistory:null`/`cancellationPending:null` hoặc warning nếu không lấy được phần bổ sung; không trả lịch sử giả. Chúng không phải điều kiện để Order xác nhận UC12.

Các endpoint thành công phải trả **200** và JSON đúng contract. 202 từ Order không được coi là ACK đã commit; Staff chưa được cập nhật assignment dựa trên phản hồi pending.

Payload năm trường của lookup/apply/ack:

```json
{
  "assignmentId": "12",
  "employeeId": "9",
  "actorUserId": "7",
  "fromStatus": "ASSIGNED",
  "toStatus": "ACCEPTED"
}
```

GET lookup truyền đủ năm trường trên qua query string để Order đối chiếu với payload đã ghi. Khác actor, employee, booking, assignment hoặc bước chuyển phải báo xung đột, không trả ACK của payload khác. Header actor phải khớp body/query. Staff sinh operation ID bằng SHA-256 của JSON `[actorUserId, assignmentId, Idempotency-Key]`; target status không nằm trong hash để cùng key nhưng đổi bước bị Order từ chối xung đột payload. Một bước tiếp theo phải dùng key mới.

`Operation` worker trả về có thêm `id` và `bookingId`; không chứa JWT:

```json
{
  "id": "operation-id-do-staff-sinh",
  "bookingId": "80",
  "assignmentId": "12",
  "employeeId": "9",
  "actorUserId": "7",
  "fromStatus": "ASSIGNED",
  "toStatus": "ACCEPTED"
}
```

ACK tối thiểu, sau khi transaction Order đã commit:

```json
{
  "operationId": "operation-id-do-staff-sinh",
  "bookingId": "80",
  "assignmentId": "12",
  "assignmentStatus": "ACCEPTED",
  "occurredAt": "2026-10-23T01:00:00.000Z",
  "booking": {"id":"80","status":"CONFIRMED","cancellationPending":null}
}
```

`occurredAt` là thời điểm Order quyết định lần đầu, có timezone rõ ràng, được giữ nguyên trong replay. Order nên phát UTC `Z` với độ chính xác giây như cột TIMESTAMP gốc. Client kiểm tra ISO/ngày thật, không bắt buộc chỉ có đuôi Z; repository chuẩn hóa UTC và lưu ở độ chính xác giây. Staff dùng timestamp này cho check-in/check-out; client không tự đặt thời gian hoàn thành hoặc gửi thời gian tùy ý từ trình duyệt.

`booking.status` là snapshot **tại lần chuyển trạng thái đó**, không khẳng định trạng thái đơn hiện tại sau các thao tác khác. Client chấp nhận:

| Bước | Trạng thái booking trong ACK |
| --- | --- |
| `ASSIGNED → ACCEPTED` | `CONFIRMED` hoặc `IN_PROGRESS` nếu nhân viên khác đã bắt đầu |
| `ACCEPTED → IN_PROGRESS` | `IN_PROGRESS`; `cancellationPending:true` bị từ chối |
| `IN_PROGRESS → DONE` | `IN_PROGRESS` nếu còn nhân viên khác, hoặc `COMPLETED` khi đủ điều kiện tổng hợp |

Không chấp nhận `CANCELLED`, ID khác, sai bước, timestamp thiếu/sai hoặc ACK không đúng payload.

## Context dữ liệu thật và trường chưa được hỗ trợ

`BookingContext` tối thiểu là `{id,status,cancellationPending,history}`. Status dùng `PENDING|CONFIRMED|IN_PROGRESS|COMPLETED|CANCELLED`. `cancellationPending` bắt buộc là boolean hoặc **null nếu hệ thống chưa hỗ trợ dữ liệu này**; không mặc định thiếu dữ liệu thành false.

`history` là `[{at,label,by,note?}]` khi đã truy vấn dữ liệu thật. Mảng rỗng chỉ dùng khi đã đọc và thực sự không có dòng; thiếu/null được client giữ là **null**, không giả thành lịch sử rỗng đã tải thành công.

Khi Order thực sự có dữ liệu, có thể cung cấp thêm:

- `code`, `createdAt`, `specialRequest`: chuỗi, timestamp hoặc null; thiếu thì giữ thiếu, không tự tạo mã hoặc ngày.
- `contact`: chỉ tên, số điện thoại, địa chỉ cần cho công việc. `houseType/area/rooms/floors/hasPets` chỉ truyền khi được lưu thật; không suy ra từ dịch vụ hoặc gán nhà/phòng/thú cưng mặc định.
- `items`: `[{serviceId,serviceName,unit,quantity,scope?}]` từ snapshot booking_items. DECIMAL quantity có thể giữ chuỗi; không chuyển thành float rồi làm tròn ngầm.

Batch phải trả đủ mọi booking ID được yêu cầu, không trùng hoặc thêm ID lạ. Staff chỉ yêu cầu ID sau khi repository đã kiểm tra assignment thuộc employee. Order vẫn cần xác thực credential và kiểm tra phạm vi dữ liệu tương ứng. Client whitelist trường trả về, không forward password/hash/trường lạ từ upstream.

## Quy tắc transaction và nhiều nhân viên

Order phải xử lý các bước sau trong **một transaction**:

1. Khóa booking, tìm operation ID đã có. Nếu cùng operation và payload, trả ACK gốc chính xác, kể cả booking hiện đã hoàn thành. Nếu cùng ID nhưng khác payload, từ chối xung đột.
2. Kiểm tra assignment còn thuộc booking/employee/actor hợp lệ, roster không bị đổi và bước chuyển đúng `ASSIGNED → ACCEPTED → IN_PROGRESS → DONE`.
3. Từ chối booking hủy/hoàn thành đối với operation mới; từ chối bắt đầu khi yêu cầu hủy chờ xử lý thực sự được hệ thống hỗ trợ và đang true. Không dùng null như bằng chứng đã kiểm tra không có yêu cầu hủy.
4. Tiếp nhận không làm đơn hoàn thành; bắt đầu đưa đơn sang `IN_PROGRESS`. Khi một nhân viên DONE, chỉ đưa booking sang `COMPLETED` nếu **tất cả assignment còn hiệu lực** của booking DONE; không tính assignment CANCELLED. Phải có roster hợp lệ, không hoàn thành một booking không có nhân viên hiệu lực.
5. Ghi lịch sử và journal kèm ACK, rồi commit trước khi trả 200. Không đợi Staff cập nhật xong mới ghi journal.

Tổng hợp phải tính **trạng thái hiệu lực từ assignment hiện tại và journal đã commit còn chờ xác nhận**. Nếu hai nhân viên cùng hoàn thành, assignment của người thứ nhất có thể chưa được Staff commit dù Order đã ghi DONE trong journal. Bỏ qua journal sẽ tính sai và không hoàn thành đơn hoặc cho phép bước sai.

Mọi thao tác hủy/đổi phân công/đổi roster do service phụ trách phải phối hợp cùng khóa booking và các journal đang pending. Không thay roster âm thầm khi có thao tác đang đối chiếu. Staff hiện giữ khóa assignment trong lúc chờ REST; Order không được chờ khóa ghi assignment ấy hoặc tự cập nhật assignment, vì có thể tạo chu trình khóa. Truy vấn projection đọc dùng snapshot phù hợp với MySQL và journal Order, với timeout/rollback cho tranh chấp; cần kiểm thử cạnh tranh thực tế trước vận hành.

## Journal bền vững trên schema hiện hữu

Implementation Order cần owner review: dùng **một dòng booking_status_history cho mỗi operation**, metadata JSON có marker/version riêng trong `note`, ví dụ:

```json
{
  "kind": "cleanhome.staff-transition",
  "version": 1,
  "operation": {"id":"...","bookingId":"80","assignmentId":"12","employeeId":"9","actorUserId":"7","fromStatus":"ASSIGNED","toStatus":"ACCEPTED"},
  "ack": {"operationId":"...","bookingId":"80","assignmentId":"12","assignmentStatus":"ACCEPTED","occurredAt":"2026-10-23T01:00:00.000Z","booking":{"id":"80","status":"CONFIRMED","cancellationPending":null}},
  "staffAcknowledged": false
}
```

`changed_by` là user có thật đã xác thực, `status` là trạng thái booking sau thao tác. Marker giúp phân biệt với ghi chú văn bản cũ; không sửa/xóa các note không mang marker này. Nội dung phải dưới giới hạn TEXT; không đưa thông tin liên hệ hoặc token vào metadata. Lịch sử trả Frontend phải chuyển metadata thành sự kiện dễ đọc, không lộ toàn bộ journal.

Khóa booking bảo đảm dedup có transaction theo booking. Cùng assignment/actor/key luôn sinh cùng operation ID. Schema chưa có unique index operation ID hoặc index pending; implementation Order kết hợp advisory lock theo operation ID, khóa booking và kiểm payload đầy đủ, không chỉ cache RAM. Journal/pending đã có code đọc/ghi và bằng chứng local. Quy mô lớn cần đánh giá index/migration riêng với owner; không coi kết quả local là kiểm chứng hiệu năng production.

ACK acknowledgement chỉ được đánh dấu sau khi Staff commit assignment. Endpoint ACK phải kiểm tra journal/payload và projection Staff tương ứng đã đạt bước đó hoặc tiến xa hơn, không xóa ACK gốc, không tạo thêm dòng lịch sử. Lặp lại acknowledgement trả cùng kết quả. Nếu không chấp nhận note làm journal, nhóm phải duyệt migration bền vững khác trước; không thay bằng mock thành công.

## Khôi phục lỗi và HTTP lỗi

- Order chưa ghi/không truy cập được: Staff rollback, trả 503; không tự cập nhật chỉ assignment.
- Order đã ghi, response bị mất hoặc Staff commit lỗi/crash: journal pending còn nguyên. Thử lại cùng key hoặc worker lookup ACK gốc, hoàn tất Staff bằng timestamp gốc, không ghi trùng.
- Staff đã commit nhưng acknowledgement lỗi: Staff trả 202 `PENDING_ACKNOWLEDGEMENT`; worker tiếp tục xác nhận. 202 này không được mô tả là đã đồng bộ cả hai service.
- Hoàn tất cả hai phía: Staff trả 200 `SYNCHRONIZED`.

Lỗi Order JSON dạng `{error:{code,message}}`. Chỉ các mã nghiệp vụ đã thống nhất sau tại HTTP 409/422 được client chuyển thành 409 `ORDER_REJECTED`: `BOOKING_CANCELLED`, `BOOKING_COMPLETED`, `BOOKING_NOT_CONFIRMED`, `CANCELLATION_PENDING`, `INVALID_TRANSITION`, `ASSIGNMENT_NOT_ACTIVE`, `STALE_ASSIGNMENT`, `IDEMPOTENCY_CONFLICT`, `OPERATION_CONFLICT`. Message upstream không được hiển thị trực tiếp.

Riêng GET lookup, 404 `{error:{code:"TRANSITION_NOT_FOUND"}}` mới có nghĩa operation chưa tồn tại. 401/403/404 khác hoặc JSON/ACK sai contract trả dependency 502; timeout/network/429/5xx trả 503. Không suy đoán mất operation từ một trang 404 HTML hoặc route chưa tồn tại.

| Phản hồi/lỗi Order | Kết quả client Staff | Tác động UC12 |
| --- | --- | --- |
| 200 + ACK hợp lệ của lookup/apply | Trả ACK được whitelist | Staff chỉ ghi bước/timestamp sau ACK này |
| Lookup 404 + đúng `error.code:TRANSITION_NOT_FOUND` | Trả null | Chỉ lúc này mới được xét apply operation mới |
| 409/422 + một mã nghiệp vụ trong allowlist trên | 409 `ORDER_REJECTED`, `details.reason` là mã Order | Không báo cập nhật thành công; không hiển thị message upstream |
| 401/403, 404 khác, 409/422 mã lạ, JSON/null sai, ID/bước/time sai, thiếu cancellationPending, response trên 1 MiB hoặc content-type không phải JSON | 502 `ORDER_BAD_RESPONSE` | Không dùng phản hồi làm bằng chứng đã ghi nhận operation |
| 202/204 hoặc HTTP khác 200, ngoài các trường hợp được phân loại riêng | 502 `ORDER_BAD_RESPONSE` | Pending/không có body không được chuyển thành ACK thành công |
| Timeout, mất kết nối, redirect bị từ chối, 429 hoặc 5xx | 503 `ORDER_UNAVAILABLE` | Không tự ghi riêng assignment; Order có thể đã commit trước mất response nên retry phải giữ nguyên key |
| POST acknowledgement lỗi bất kỳ sau commit Staff | `performTransition` trả HTTP 202 `PENDING_ACKNOWLEDGEMENT` | Assignment đã đổi; đồng bộ journal còn pending, worker/thử lại tiếp tục đối chiếu |
| DB Staff lỗi sau ACK Order hợp lệ | HTTP 503 `RECONCILIATION_REQUIRED` với operationId khi lỗi được phát hiện | Journal Order phải giữ ACK gốc để phục hồi; không rollback được transaction Order đã commit bằng transaction Staff |

401/403 trong bảng là lỗi **Order upstream**. API Staff vẫn trả 401/403 riêng khi JWT người dùng thiếu/sai hoặc tài khoản/employee không được phép truy cập. Một credential Order sai không được diễn giải thành việc người dùng cần đăng nhập lại.

## Worker trong implementation Staff hiện tại

`server.js` chỉ bật vòng đối chiếu nhúng khi `RECONCILIATION_WORKER_ENABLED=true`; `worker.js` là tiến trình riêng và yêu cầu cấu hình URL/credential Order. Cả hai gọi `startReconciliation(service,{intervalMs,batchSize})`.

- Chạy một lượt ngay lúc khởi động, sau đó theo interval; không tạo lượt chồng khi lượt trước đang chạy trong cùng tiến trình.
- Mỗi lượt lấy pending có limit rồi xử lý tuần tự. Một operation lỗi được ghi nhận không thành công và không ngăn các operation khác; lỗi lấy danh sách/dependency được vòng lặp bắt, chỉ log metadata an toàn.
- Worker kiểm tra lại user/employee hoạt động và assignment thuộc quyền từ MySQL qua `performTransition`; không lưu hoặc tự phát JWT, không tự cấp quyền từ pending payload.
- `stop()` ngăn interval mới và đợi lượt đang chạy hoàn tất. Mỗi REST request có timeout; tiến trình server/worker có deadline dừng 30 giây, không có cam kết toàn bộ một batch lớn luôn xong trong một timeout REST.
- Chưa có circuit breaker, exponential backoff hoặc điều phối nhiều worker. Retry hiện là chu kỳ cố định; nhiều tiến trình có thể cùng đọc pending, nên dedup/journal ở Order và row lock ở Staff là bắt buộc.
- API pending hiện chỉ có limit, chưa có cursor/cơ chế fairness. Nếu Order luôn trả cùng nhóm operation không thể phục hồi ở đầu hàng đợi, các operation sau có thể không được xử lý. Phải thống nhất cách chọn batch/đối chiếu thủ công ở Order, không giả rằng chống chồng lượt đã giải quyết được tình trạng này.

Chống chồng lượt trong một tiến trình không thay thế idempotency phân tán. Journal note hiện do Order triển khai và sở hữu; Staff chỉ đọc/đối chiếu qua REST, không ghi journal SQL. Trong lượt Frontend Q01–Q06, worker toàn database cố ý tắt; bằng chứng phục hồi là retry cùng key và receipt, không phải nghiệm thu global queue/fairness.

## Kiểm chứng cần phối hợp

Test client độc lập kiểm native fetch/HTTP loopback với **Order stub** có nhãn, timeout, malformed JSON, whitelist, multiworker ACK, idempotency payload và journal recovery contract. Test vòng worker dùng service stub **chỉ trong test**. Bằng chứng Backend MySQL/HTTP/recovery thật ở [README Order](../../order-service/README.md); bằng chứng Frontend/BFF thật Q01–Q06 ở báo cáo liên kết đầu tài liệu. Chưa kiểm chứng cạnh tranh nhiều worker production, global queue/fairness hoặc crash thực tế trong lượt Frontend này. Không bật worker toàn database dùng chung chỉ để tái diễn kết quả.
