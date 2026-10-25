# Bàn giao Order Service: bốn API để hoàn tất UC12

**Đây là checklist owner review, không tự đánh dấu các ô là đã được phê duyệt.** Auth RS256 và bốn API Order đã có implementation; Staff có HTTP client và transaction assignment thật. README Order ghi bằng chứng Backend local của bốn API. Q01–Q06 bên dưới kiểm luồng Frontend với lookup/apply/ack; worker toàn database tắt nên không dùng lượt này để khẳng định endpoint pending hoặc global worker đã được nghiệm thu. Không có Order/JWT giả hoặc middleware bỏ qua xác thực trong runtime.

Contract đầy đủ: [order-service-contract.md](order-service-contract.md). Xác thực người dùng: [auth-integration.md](auth-integration.md). Hai API đọc context là tùy chọn, được phân biệt ở cuối tài liệu; chúng không thay thế bốn API dưới đây.

## Cập nhật bằng chứng local ngày 24/10/2026

Theo [báo cáo nghiệm thu UC12](../../../frontend/apps/staff/docs/UC12_E2E_QA_REPORT.md), luồng Browser → BFF → Auth/Staff → Order → MySQL thật trên `cleanhome_staff_test` đạt **43 nhóm E2E PASS, 0 FAIL, 0 SKIP, 0 NOT_RUN** cho Q01–Q06. Hồi quy HTTP riêng đạt **90 PASS, 0 FAIL, 1 SKIP** do thiếu fixture UC11 qua ranh ngày UTC/Việt Nam; không cộng hai lớp kiểm thử hoặc coi SKIP là PASS.

Sáu booking `9109151–9109156` đã COMPLETED, mười hai assignment `9109173–9109184` đã DONE, 36 journal mới đã ACK; giữ nguyên dữ liệu và không chạy lại workflow. Booking cũ `9109131` và `9109141` cũng đã COMPLETED. Muốn kiểm thử ghi thêm cần fixture và phạm vi được duyệt riêng.

Đây là bằng chứng local HTTP trên một máy; chưa kiểm chứng production, HTTPS/Secure cookie thực, tải lớn/stress/soak, nhiều host/replica hoặc crash/kill/mất điện/restore trong lượt Frontend này. Fault Q03–Q06 là mất kết nối/phản hồi thật, không phải crash tiến trình. Worker toàn database tắt. Kết quả không thay phê duyệt contract/PR của owner; các kết quả giai đoạn cũ phía dưới được giữ làm lịch sử.

## 1. Checklist đầu vào từ thành viên Order

- [ ] Cung cấp URL của Order Service thật và credential service-to-service qua kênh cấu hình riêng; không ghi token vào source, tài liệu, log, JSON response hoặc journal.
- [ ] Chốt và triển khai đủ bốn method/path bên dưới. Các ACK thành công trả HTTP **200**, `Content-Type: application/json`; không đổi 202/204 thành ACK thành công.
- [ ] Xác thực `Authorization: Bearer <service credential>` trước khi đọc body/query; kiểm tra actor và assignment theo dữ liệu thật. Header tự khai báo không được xem là bằng chứng xác thực.
- [ ] Áp dụng transaction/khóa booking, dedup payload và tổng hợp nhiều assignment, bao gồm operation đã commit nhưng Staff chưa xác nhận.
- [ ] Owner xác nhận implementation journal bền vững trong `booking_status_history.note` ở mục 4, đã có bằng chứng local. Nếu đổi cách lưu/schema, cần thống nhất contract và migration riêng trước; không dùng cache RAM thay thế.
- [ ] Cấp dữ liệu kiểm thử **booking mới có hai employee A/B**, hai assignment còn hiệu lực và hai JWT thật của Auth; không dùng token tự ký tạm để mô tả là Auth đã tích hợp.
- [ ] Cùng kiểm tra timeout/mất response, duplicate, commit lỗi và xác nhận lại. Chưa được kiểm thì ghi CHƯA KIỂM, không suy từ unit test/stub sang PASS thực tế.

## 2. Bốn API nội bộ bắt buộc

Prefix dưới đây là đường dẫn client đang gọi, ghép sau `ORDER_SERVICE_URL`. Không thêm `/api/v1` hoặc đổi tên khác mà chưa đồng bộ client.

| # | Method và path chính xác | Hàm Staff gọi | Request | Response thành công |
| --- | --- | --- | --- | --- |
| 1 | `GET /internal/v1/bookings/:bookingId/assignment-transitions/:operationId` | `getAssignmentTransition(operation)` | Query năm trường `P` bên dưới; Bearer service credential và `X-Actor-User-Id` | **200** ACK gốc đúng payload; chỉ **404** JSON `error.code=TRANSITION_NOT_FOUND` được hiểu là operation chưa tồn tại |
| 2 | `PUT /internal/v1/bookings/:bookingId/assignment-transitions/:operationId` | `applyAssignmentTransition(operation)` | JSON body `P`; Bearer, `X-Actor-User-Id`, `Idempotency-Key: operationId` | **200** ACK sau commit Order bền vững; request lặp trả ACK gốc |
| 3 | `POST /internal/v1/bookings/:bookingId/assignment-transitions/:operationId/acknowledgement` | `ackAssignmentTransition(operation)` | JSON body `P`; Bearer, `X-Actor-User-Id`, `Idempotency-Key: operationId` | **200** `{operationId,bookingId,assignmentId,acknowledged:true}` đúng ID, sau khi Staff đã commit |
| 4 | `GET /internal/v1/assignment-transitions/pending?limit=20` | `listPendingTransitions({limit})` | Bearer service credential; limit nguyên 1–100. Không có actor header vì đây là lượt đọc của worker | **200** `{operations:[Operation]}`; không quá limit, không trùng operation ID, không chứa token |

`P` là toàn bộ payload đối chiếu, không phải một phần tùy chọn:

```json
{
  "assignmentId": "ID-assignment-thật",
  "employeeId": "ID-employee-thật",
  "actorUserId": "ID-users-thật-từ-JWT",
  "fromStatus": "ASSIGNED",
  "toStatus": "ACCEPTED"
}
```

Các chuỗi mô tả ID trong ví dụ chỉ là ký hiệu, không phải giá trị được API chấp nhận. ID entity thực tế phải là chuỗi BIGINT signed dương canonical, không zero đầu/ký tự thừa, tối đa `9223372036854775807`. Operation ID là SHA-256 mà Staff sinh từ JSON `[actorUserId,assignmentId,Idempotency-Key]`; không phải ID user hoặc một JWT.

Lookup phải so khớp đủ booking/assignment/employee/actor/from/to với journal. Cùng operation ID nhưng payload khác trả xung đột, không trả ACK của người/bước khác. Header actor phải khớp actor trong query/body. `Operation` trong pending là `{id,bookingId,...P}`.

### ACK canonical

```json
{
  "operationId": "operation-id-do-Staff-sinh",
  "bookingId": "ID-booking-thật",
  "assignmentId": "ID-assignment-thật",
  "assignmentStatus": "ACCEPTED",
  "occurredAt": "2026-10-23T01:00:00.000Z",
  "booking": {
    "id": "ID-booking-thật",
    "status": "CONFIRMED",
    "cancellationPending": null
  }
}
```

- [ ] Operation/booking/assignment ID và `assignmentStatus` đúng request; không đưa toàn bộ user, password/hash hoặc dữ liệu ngoài nhu cầu công việc vào ACK.
- [ ] `occurredAt` lấy một lần từ quyết định đầu tiên của Order, phát UTC với **độ chính xác giây** như TIMESTAMP MySQL hiện có; replay giữ nguyên timestamp. Không lấy thời gian từ client hoặc sinh timestamp mới mỗi lần retry.
- [ ] `cancellationPending` luôn có mặt: boolean nếu Order hỗ trợ dữ liệu thật, **null** khi schema chưa có. Không bỏ trường hoặc biến giá trị chưa biết thành false.
- [ ] ACK là snapshot lúc chuyển trạng thái; lookup sau khi booking tiến xa hơn vẫn trả snapshot gốc, không tự thay trạng thái bên trong ACK đã lưu.

Client hiện kiểm ISO có timezone/ngày hợp lệ và chấp nhận tối đa ba chữ số phần giây. Repository chuẩn hóa UTC, lưu tới giây; đây là lý do hai bên cần chốt canonical timestamp theo giây, thay vì giả rằng cột TIMESTAMP hiện có giữ mili giây.

## 3. Quy tắc trạng thái và hai nhân viên

| Assignment trước → sau | Booking trong ACK hợp lệ | Điều kiện Order cần bảo đảm |
| --- | --- | --- |
| `ASSIGNED → ACCEPTED` | `CONFIRMED` hoặc `IN_PROGRESS` | Nhận việc không hoàn thành đơn; có thể nhân viên khác đã bắt đầu |
| `ACCEPTED → IN_PROGRESS` | `IN_PROGRESS` | Không bắt đầu khi có yêu cầu hủy đang chờ thực sự được hỗ trợ và đang true; null không phải bằng chứng đã kiểm tra không có yêu cầu hủy |
| `IN_PROGRESS → DONE` | `IN_PROGRESS` hoặc `COMPLETED` | Chỉ COMPLETED khi tất cả assignment còn hiệu lực đều DONE; assignment CANCELLED không tính là người đang phải hoàn thành |

- [ ] Operation mới không được nhảy/lùi bước, tiếp tục booking đã hủy/hoàn thành, dùng assignment sai người hoặc roster đã đổi.
- [ ] Đọc trạng thái hiệu lực từ assignment hiện tại **cộng journal đã commit nhưng chưa được Staff xác nhận**. Nếu chỉ đọc assignment SQL, hai nhân viên cùng DONE có thể bị tổng hợp sai khi Staff chưa kịp commit.
- [ ] Khóa booking khi quyết định, ghi lịch sử và journal trong cùng transaction Order; commit rồi mới trả 200. Staff chỉ cập nhật assignment sau ACK hợp lệ.
- [ ] Không UPDATE bảng assignments từ Order. Staff đang giữ khóa assignment khi gọi REST; Order không được chờ khóa ghi chính assignment đó. Phối hợp hủy/đổi roster để tránh chu trình khóa và race với operation pending.
- [ ] Lookup operation đã tồn tại trả ACK gốc ngay sau khi xác thực/đối chiếu payload, kể cả booking nay đã COMPLETED. Không chạy lại bước chuyển hoặc ghi thêm lịch sử.

Một test đúng cần thấy A DONE nhưng B chưa DONE thì booking vẫn IN_PROGRESS. Không suy ra booking COMPLETED chỉ vì API Staff của A trả `jobStatus:done`.

## 4. Journal và lịch sử: implementation Order cần owner review

Implementation Order dùng `booking_status_history.note TEXT` với marker `kind:"cleanhome.staff-transition"`, `version:1`, gồm `operation`, `ack` bất biến và cờ `staffAcknowledged`. `booking_status_history` vẫn do Order sở hữu; Staff không INSERT/UPDATE bảng này. Bằng chứng transaction/journal local nằm tại [README Order](../../order-service/README.md) và báo cáo Q01–Q06; phê duyệt thiết kế/contract vẫn cần đúng owner.

- [ ] Lưu đúng một bản ghi journal cho mỗi operation ID/payload dưới khóa booking. Không sửa/xóa note cũ không có marker; không ghi token hoặc thông tin liên hệ vào metadata.
- [ ] Ghi `changed_by` là user thật được xác minh và `status` là trạng thái booking lúc quyết định; `created_at`/ACK timestamp nhất quán theo giây.
- [ ] Acknowledgement chỉ đổi trạng thái xác nhận của journal sau khi Staff commit; giữ nguyên operation và ACK gốc, không tạo thêm dòng lịch sử vì retry/ack.
- [ ] Pending chỉ trả operation chưa được Staff xác nhận, có payload đầy đủ; không đưa toàn bộ note hoặc thông tin đăng nhập ra response.
- [ ] Thiết kế cách đối chiếu/đưa vào xử lý thủ công operation không thể hoàn tất, ví dụ actor khóa hoặc roster xung đột. API hiện chỉ có limit, chưa có cursor/backoff/dead-letter; luôn trả cùng nhóm lỗi đầu hàng đợi có thể làm các operation sau không được xử lý.

Nếu Order còn ghi các sự kiện lịch sử booking riêng ngoài journal, phép kiểm không trùng phải đếm **journal có marker và đúng operation ID**, đồng thời kiểm tổng số dòng không tăng khi replay cùng key. Không mặc định toàn booking chỉ có sáu dòng lịch sử cho sáu bước A/B.

Nguồn chứng cứ khi kiểm HTTP thật gồm ACK từ lookup Order, metadata journal đọc từ SQL và trạng thái/timestamp assignments, bookings. Một ACK từ server stub hoặc chỉ kiểm đếm số dòng SQL không chứng minh đủ transaction/idempotency thực tế.

## 5. Lỗi, mất response và retry

| Tình huống | Kết quả Staff hiện tại / yêu cầu Order |
| --- | --- |
| Lookup 404 `TRANSITION_NOT_FOUND` đúng JSON | Staff mới được xét gọi PUT cho bước hợp lệ; 404 HTML/route chưa có không mang ý nghĩa này |
| Order 409/422 với mã nghiệp vụ đã thống nhất | Staff trả 409 `ORDER_REJECTED`, message an toàn; Order giữ nguyên state và journal cho request bị từ chối |
| Order 401/403/404 khác, JSON/null/ID/bước/time sai hoặc HTTP 202/204 thay cho ACK 200 | Staff trả 502 `ORDER_BAD_RESPONSE`; không xem là đã ghi nhận thành công |
| Timeout/mất mạng/429/5xx hoặc redirect | Staff trả 503 `ORDER_UNAVAILABLE`; nếu Order đã commit rồi response bị mất, retry cùng key phải lấy ACK gốc |
| Order commit/ACK xong nhưng Staff commit lỗi | Staff trả 503 `RECONCILIATION_REQUIRED` khi phát hiện; journal pending giúp thử lại/worker hoàn tất bằng timestamp gốc |
| Staff commit rồi POST acknowledgement lỗi | Staff trả 202 `PENDING_ACKNOWLEDGEMENT`; không được thông báo đã SYNCHRONIZED; worker/thử lại xác nhận sau |
| Cả hai phía đã xác nhận | Staff trả 200 `SYNCHRONIZED`; request lặp không đổi timestamp/ghi trùng |

Allowlist lỗi nghiệp vụ hiện tại: `BOOKING_CANCELLED`, `BOOKING_COMPLETED`, `BOOKING_NOT_CONFIRMED`, `CANCELLATION_PENDING`, `INVALID_TRANSITION`, `ASSIGNMENT_NOT_ACTIVE`, `STALE_ASSIGNMENT`, `IDEMPOTENCY_CONFLICT`, `OPERATION_CONFLICT`. Mã lạ không được coi như một từ chối nghiệp vụ đã chứng minh.

Retry cùng bước phải giữ nguyên `Idempotency-Key`; bước mới dùng key mới. Client REST không tự retry trong cùng request. Scheduler Staff gọi theo interval, chống chồng lượt trong cùng tiến trình; idempotency Order và row lock Staff vẫn cần khi có nhiều tiến trình/HTTP request đồng thời.

Khi replay một key cũ sau các bước tiếp theo, API Staff trả trạng thái assignment **hiện tại**, `replayed:true`, còn `orderAtTransition` vẫn phản ánh ACK gốc. Không so sánh toàn bộ response replay với lần đầu rồi kết luận sai; phải kiểm ACK gốc bất biến và trạng thái hiện tại không bị lùi.

## 6. Checklist chạy HTTP thật sau khi dependency sẵn sàng

Phần này giữ điều kiện/assertion của runner Backend lịch sử. UC12 ghi đã được kiểm chứng local riêng trên Q01–Q06 theo cập nhật ở đầu tài liệu; không tự tạo JWT/mock Auth/Order hoặc chạy lại fixture đã tiêu thụ để đánh dấu đạt.

Runner Backend lịch sử nằm tại [test/http.integration.test.js](../test/http.integration.test.js), lệnh `npm.cmd run test:http` từ `backend/staff-service`. Mặc định bỏ qua khi chưa bật `RUN_STAFF_HTTP_TESTS=true`. Nhóm ghi cũ yêu cầu `RUN_STAFF_HTTP_WRITE_TESTS=true` và từng dùng `STAFF_HTTP_WRITE_BOOKING_ID=9109131`; **booking này đã COMPLETED, không bật lại nhóm ghi hoặc reset để chạy lại**. Kiểm thử ghi mới cần fixture/runner và phạm vi được owner duyệt riêng. Xem [hướng dẫn HTTP và giới hạn guard](http-integration-testing.md); service/test phải cùng trỏ database test.

`STAFF_HTTP_BASE_URL` mặc định là `http://127.0.0.1:4005`; runner gọi service đang chạy, không tự mở server hoặc cấp token. JWT lấy qua `STAFF_HTTP_TOKEN_A`, `STAFF_HTTP_TOKEN_B`, `STAFF_HTTP_TOKEN_CUSTOMER` hoặc biến đường dẫn tương ứng có hậu tố `_FILE` do runner hỗ trợ. Ưu tiên tránh đưa giá trị token vào command line/log; cấu hình credential Order và MySQL theo contract riêng, không lẫn Bearer người dùng với service token.

Manifest Backend lịch sử dưới đây đã được sử dụng: booking `9109131` hiện COMPLETED, hai assignment DONE. Giữ để truy vết, không coi là fixture ASSIGNED mới và không dùng bảng này như phê duyệt ghi lại:

| Vai trò | User | Employee | Assignment | Booking chung |
| --- | --- | --- | --- | --- |
| Staff A | `9109002` | `9109004` | `9109133` | `9109131` |
| Staff B | `9109101` | `9109102` | `9109134` | `9109131` |

Phải đọc đối chiếu precondition trước khi ghi. Không dùng assignment một nhân viên `9109008` hoặc booking `9109007` thay thế cho phép kiểm tổng hợp A/B; không tự cập nhật ID/trạng thái trong database để làm test qua.

### Điều kiện chặn trước khi có bất kỳ PATCH/PUT/POST ghi nào

- [ ] Dùng riêng `cleanhome_staff_test`; service và test runner đều trỏ đúng database này, không phải production hoặc dữ liệu người dùng.
- [ ] Có cờ opt-in rõ ràng `RUN_STAFF_HTTP_WRITE_TESTS=true`; mặc định test ghi phải bỏ qua. Biến này dành cho test runner, không thay xác thực hoặc mở quyền runtime.
- [ ] Có URL Staff/Order thật, service credential hợp lệ và hai JWT thật còn hạn của hai user Staff khác nhau do Auth cấp; không in token/claims nhạy cảm vào log.
- [ ] Read preflight xác nhận hai JWT tương ứng hai user/employee khác nhau, đang ACTIVE; hai assignment cùng một booking mới CONFIRMED, đều ASSIGNED, check-in/out còn null và chưa có journal của test này.
- [ ] Chọn assignment/booking riêng do nhóm chuẩn bị, không mặc định dùng fixture một nhân viên `9109008`. Test phải dừng nếu precondition không đúng, không reset status hoặc chạy lại seed để ép điều kiện.
- [ ] Test chỉ ghi bằng endpoint đang kiểm, không UPDATE/DELETE/INSERT SQL, không tạo tài khoản, seed hoặc dữ liệu nghiệp vụ trong script. SQL chỉ đọc đối chiếu; không tự cleanup/reset lịch sử sau khi hoàn thành.
- [ ] Mỗi request có timeout, toàn suite có deadline; nếu lỗi sau một phần thao tác, giữ trạng thái đã ghi và báo bước cuối, không giả rollback xuyên service.

### Chuỗi chấp nhận tối thiểu với A và B

| Lượt | Request qua Staff | Đối chiếu assignment/booking/Order |
| --- | --- | --- |
| 1 | A nhận việc, key A-accept mới | A ACCEPTED; B chưa đổi; booking CONFIRMED; journal/ACK A-accept duy nhất |
| 2 | B nhận việc, key B-accept mới | B ACCEPTED; booking CONFIRMED; A giữ nguyên |
| 3 | A bắt đầu, key A-start mới | A IN_PROGRESS, check-in bằng occurredAt ACK chuẩn hóa giây; booking IN_PROGRESS |
| 4 | B bắt đầu, key B-start mới | B IN_PROGRESS, check-in đúng ACK; A không bị đổi timestamp |
| 5 | A hoàn thành, key A-done mới | A DONE, check-out đúng ACK; **booking vẫn IN_PROGRESS** vì B chưa DONE |
| 6 | B hoàn thành, key B-done mới | B DONE, booking COMPLETED khi mọi assignment còn hiệu lực DONE |

Sau mỗi lượt:

- [ ] Lấy `operationId` từ response Staff; kiểm đúng hash scope user/assignment/key và lookup trực tiếp Order bằng đúng payload của bước đó.
- [ ] So ACK operation/assignment/booking/status/occurredAt với response Staff và SQL. Không tin HTTP 200 nếu ACK sai ID/bước, timestamp khác hoặc booking bị hoàn thành sớm.
- [ ] Đối chiếu journal marker + operation ID đúng một dòng; ACK được lưu không bị thay sau acknowledgement. Đếm lịch sử trước/sau để phát hiện ghi trùng khi replay.
- [ ] Retry cùng key và body: không đổi trạng thái, check-in/out, amount, lịch thực hiện hoặc assignment người kia; không thêm journal/lịch sử. Lặp lại key cũ sau khi hoàn thành để kiểm không làm lùi trạng thái và ACK vẫn nguyên.
- [ ] Dùng cùng key với bước khác: 409; kiểm state/time/history giữ nguyên. Nhảy bước bằng key mới: 409, không tạo journal thành công.
- [ ] Gọi list/detail/schedule bằng JWT A/B thật: mỗi người chỉ thấy assignment mình; A truy cập/cập nhật assignment B phải 404, không rò rỉ contact hoặc ghi journal.
- [ ] Kiểm pending không còn các operation đã SYNCHRONIZED của test. Không khẳng định toàn hàng đợi rỗng nếu có operation khác; giới hạn batch có thể che bản ghi ngoài trang đầu, cần nêu giới hạn quan sát.

### Các ca lỗi cần môi trường được điều khiển riêng

- [ ] Đơn đã hủy, employee/user khóa, roster đổi, yêu cầu hủy pending khi tính năng này thực sự tồn tại.
- [ ] Order dừng trước apply; Order commit nhưng cố ý mất response; Staff lỗi commit sau ACK; POST acknowledgement mất response; nhiều nhân viên DONE đồng thời.
- [ ] Chạy worker phục hồi trên journal thật, chứng minh không ghi trùng và tổng hợp đúng sau crash/restart; kiểm group pending lỗi không làm các operation sau đói mãi.

Không tự gây lỗi các dependency dùng chung hoặc thay cấu hình sản xuất để giả lập các ca này. Nếu chưa có fixture, khả năng điều khiển lỗi hoặc Auth/Order thật, ghi SKIP/CHƯA KIỂM với lý do. Unit test mock và kiểm MySQL chỉ đọc phải báo riêng, không thay thế những ca end-to-end trên.

## 7. Hai API context không bắt buộc cho UC12

| API | Trạng thái Staff hiện tại |
| --- | --- |
| `GET /internal/v1/bookings/:bookingId/staff-context` | UC10 tùy chọn khi có URL/credential Order, lấy lịch sử và cancellationPending; thiếu/lỗi thì giữ null hoặc warning, UC9–UC11 vẫn đọc projection SQL có phân quyền |
| `POST /internal/v1/bookings/staff-context/batch` | Client đã viết, chưa có caller trong luồng nghiệp vụ hiện tại; dành cho tách projection sau này |

Không trì hoãn/chấp nhận sai bốn API UC12 chỉ vì hai context API đã chạy được. Chỉ đánh dấu hoàn tất bàn giao sau khi mỗi phần có chứng cứ HTTP/SQL thực tế tương ứng.
