# CleanHome — Giai đoạn 4: cập nhật trạng thái công việc Staff

## Cập nhật nghiệm thu ghi thật ngày 24/10/2026

Sau khi nhóm phê duyệt bộ dữ liệu riêng Q01–Q06, đã chạy E2E thật **Browser → BFF → Staff → Order → MySQL: 43 nhóm kiểm tra PASS, 0 FAIL, 0 SKIP**. Sáu booking mới đều COMPLETED, mười hai assignment DONE, đúng 36 journal mới đã ACK. Hash dữ liệu ngoài allowlist giữ nguyên, gồm booking cũ `9109131` và `9109141`. Không reset hoặc tái sử dụng dữ liệu đã tiêu thụ.

Lượt nghiệm thu còn chạy lại **557 kiểm thử độc lập PASS**, **90 HTTP PASS/1 SKIP** (UC11 thiếu job thật qua ranh ngày UTC/Việt Nam), **15 kiểm tra Chrome UC9 PASS**, typecheck Staff/Customer/Admin và build Staff đều đạt. Đây là các lớp bằng chứng riêng, không cộng thành số test E2E. Source hash 110 file được bảo vệ không đổi. Các giới hạn HTTPS/nhiều host, crash/power-loss, deadline thật và worker toàn database vẫn được ghi rõ; không lấy relay response loss làm bằng chứng các trường hợp đó đã kiểm.

Xem [báo cáo nghiệm thu UC12](UC12_E2E_QA_REPORT.md) để có ID fixture, phạm vi, bằng chứng lỗi/retry/202, kết quả hồi quy và giới hạn. Các phần dưới giữ mô tả implementation và kết quả **lượt triển khai trước khi có phê duyệt QA ghi**; trạng thái NOT_RUN trong bảng lịch sử không thay cho kết quả E2E mới.

## Phạm vi và điều kiện dữ liệu

Lượt triển khai code chỉ tích hợp UC12 trên Frontend Staff, ưu tiên trang chi tiết UC10. Giữ Auth, UC9, UC10 và UC11 đã hoàn thành. Lượt đó không sửa Auth/Staff/Order Backend, schema, dữ liệu MySQL, Customer/Admin hoặc localStorage cũ; không tự commit/push/merge/reset/checkout. Lượt QA ghi sau phê duyệt chỉ thêm tooling/test/tài liệu và dữ liệu Q01–Q06 theo báo cáo riêng, không đổi logic nghiệp vụ đã có.

**Tại thời điểm triển khai code, chưa có bộ QA ghi riêng được owner phê duyệt cho lượt Frontend UC12.** Booking `9109131` và `9109141` đã COMPLETED ở các kiểm thử Backend trước; không đưa về trạng thái cũ, dùng lại như fixture mới hoặc xóa journal. Các bản ghi khác dù còn ASSIGNED cũng không tự trở thành dữ liệu được phép ghi. Phê duyệt sau đó chỉ áp dụng sáu fixture mới Q01–Q06, không mở quyền ghi tùy ý trên dữ liệu cũ.

Theo mục 7 prompt UC12: “Nếu không có bộ dữ liệu QA ghi an toàn, hãy hoàn thành code và các unit/mock HTTP test trước; báo các kiểm thử ghi MySQL là NOT_RUN”. Theo `BACKEND_TEAM_RULES .md` mục 15, trước lệnh ghi phải nêu host/database/bảng/SQL hoặc thao tác/rủi ro/khôi phục và được owner chấp thuận. Vì vậy lượt triển khai code chỉ hoàn tất unit/dependency-double và kiểm tra HTTP an toàn, **không tự chạy chuyển trạng thái thật hoặc tạo fixture** khi chưa được duyệt. Lượt E2E mới đã có phê duyệt riêng, tiền kiểm/backup và manifest allowlist như báo cáo liên kết ở đầu tài liệu.

Nguồn đã đọc: `AGENTS.md`, `BACKEND_TEAM_RULES .md` (tên file thực tế có khoảng trắng), Staff app `AGENTS.md`/Next.js docs, [Auth](AUTH_INTEGRATION.md), [UC9](UC9_INTEGRATION.md), [UC10](UC10_INTEGRATION.md), [UC11](UC11_INTEGRATION.md), README Staff/Order, [contract Staff→Order](../../../../backend/staff-service/docs/order-service-contract.md), [bàn giao Order](../../../../backend/staff-service/docs/order-handoff-checklist.md), [Order Staff integration](../../../../backend/order-service/docs/staff-integration.md), validator/service/repository/route/tests UC12 thực tế.

README/contract Staff còn một số câu tiến độ cũ “Order scaffold/chưa triển khai”; source Order và tài liệu tích hợp đã có implementation/journal. Không sửa tài liệu Backend của owner hoặc lấy báo cáo Backend cũ làm bằng chứng Frontend UC12 ghi thật trong lượt này.

## Contract Backend đã xác minh

```text
Browser Staff :3002
  └─ PATCH /api/staff/jobs/:assignmentId/status
       └─ Next.js BFF: phiên EMPLOYEE, Origin/CSRF, payload/key hợp lệ
            └─ PATCH Staff :4005/api/v1/staff/me/jobs/:assignmentId/status
                 Authorization: Bearer <JWT phía server>
                 Idempotency-Key: <key ổn định của thao tác>
                 JSON: {"status":"ACCEPTED" | "IN_PROGRESS" | "DONE"}
```

Đã triển khai cả `GET` và `PATCH /api/staff/jobs/:assignmentId/status`. GET chỉ đọc chi tiết Staff đã phân quyền và nhật ký BFF của đúng user/assignment; không gửi PATCH ngầm. Browser không gọi bốn `/internal/` Order endpoint; BFF không nhận token nội bộ Order hoặc URL upstream do browser chỉ định.

- BFF dùng phiên HttpOnly hiện có, kiểm tra EMPLOYEE ACTIVE qua Auth introspection, rồi lấy JWT phía server để gọi Staff. JWT, password và service token không nằm trong response hoặc browser storage.
- PATCH bắt buộc `Origin` khớp chính xác `STAFF_APP_ORIGIN`, URL/Host đúng origin; `Sec-Fetch-Site` nếu có phải là `same-origin`. Origin sai bị chặn trước khi dùng phiên, không tự thu hồi phiên đúng. GET cho phép thiếu Origin nhưng vẫn từ chối Origin/site khác.
- Chỉ nhận JSON `{status}` và `Idempotency-Key`, body tối đa 4.096 byte, đọc body tối đa 5 giây. Từ chối query, ID không canonical, method khác GET/PATCH và trường ngoài contract trước khi gọi dịch vụ.
- Chỉ gọi hai đường dẫn Staff cố định: GET chi tiết và PATCH trạng thái. Response có `Cache-Control: no-store`, `Vary: Cookie`, request ID; lỗi upstream được chuyển sang thông điệp cho phép, không đưa nguyên response/secret vào browser.

| Trạng thái assignment hiện tại | Thao tác mới hợp lệ | Điều kiện / ý nghĩa |
| --- | --- | --- |
| Database ASSIGNED, API WAITING | ACCEPTED | Nhận việc; chưa ghi check-in |
| ACCEPTED | IN_PROGRESS | Bắt đầu; check-in lấy timestamp ACK Order, không lấy giờ browser |
| IN_PROGRESS | DONE | Hoàn thành; check-out theo ACK Order |
| DONE/CANCELLED hoặc booking không đủ điều kiện | Không tạo thao tác mới | Không bỏ bước, đổi ngược hoặc thao tác trên việc ngoài quyền |

Staff validator chỉ nhận JSON object có `status`, không nhận field thêm. ID là BIGINT signed dương canonical dạng chuỗi. Header `Idempotency-Key` gồm 8–128 ký tự ASCII `[A-Za-z0-9._:-]`. Staff tạo operation ID bằng SHA-256 của JSON `[actorUserId,assignmentId,Idempotency-Key]`; target status không ở trong hash, nên đổi payload cùng key phải bị phát hiện là xung đột, không được coi là thao tác mới.

Staff giữ lock/transaction assignment. Order quyết định booking, lưu lịch sử/journal và trả ACK sau commit; Staff mới ghi assignment/check-in/check-out, rồi acknowledgement. Một nhân viên DONE chưa làm booking COMPLETED nếu còn nhân viên hiệu lực chưa DONE. Journal nằm trong `booking_status_history.note` theo marker/version đã có; không thêm bảng/cột hoặc ghi booking trực tiếp từ Frontend/Staff.

### Response và lỗi

Response Staff có `{data:{assignmentId,status,jobStatus,checkInAt,checkOutAt,transition:{operationId,requestedStatus,synchronization,replayed},orderAtTransition:{id,status,asOf}}}`.

| Kết quả | Ý nghĩa cần giữ ở UI |
| --- | --- |
| HTTP 200 + SYNCHRONIZED | Backend xác nhận đồng bộ thao tác; sau đó tải lại dữ liệu hiện tại |
| HTTP 202 + PENDING_ACKNOWLEDGEMENT | Assignment đã áp dụng, ACK journal chưa xác nhận xong; không hiển thị hoàn tất đồng bộ |
| Timeout/mất mạng/response sai | Kết quả chưa xác định, có thể đã commit; giữ context/key, không tạo key mới để tự gửi lại |
| 400 | ID/body/key/transition input sai; không gửi field ngoài contract |
| 401/403 từ Auth/Staff | Phiên/quyền không hợp lệ; không fallback dữ liệu local |
| 404 | Không có assignment thuộc quyền; không tiết lộ dữ liệu của người khác |
| 409/422, gồm ORDER_REJECTED và lý do nghiệp vụ | Backend từ chối/xung đột; hiển thị thông tin an toàn, không tự sửa dữ liệu để vượt lỗi |
| 502 ORDER_BAD_RESPONSE; 503 ORDER_UNAVAILABLE/RECONCILIATION_REQUIRED | Lỗi phụ thuộc hoặc cần đối chiếu; không kết luận đã thất bại chắc chắn |

Lỗi credential nội bộ Order không phải bằng chứng JWT nhân viên hết hạn. Không tự logout vì mọi lỗi Order. `orderAtTransition` là snapshot tại operation gốc, **không phải booking hiện tại** khi replay; assignment trong response replay có thể đã tiến xa hơn requestedStatus. Không bắt response replay phải giống nguyên response ban đầu hoặc tự lùi trạng thái. Tải UC10 hiện tại để hiển thị dữ liệu mới.

### DTO công khai của BFF

GET trả object sau; các ID luôn là chuỗi, thời điểm ISO UTC hoặc null:

```text
{
  current: {
    assignmentId, orderId,
    status: ASSIGNED | ACCEPTED | IN_PROGRESS | DONE | CANCELLED,
    jobStatus: waiting | accepted | in_progress | done | null,
    orderStatus: pending | confirmed | in_progress | completed | cancelled | null,
    checkInAt, checkOutAt, assignedAt, cancellationPending: boolean | null
  },
  operation: null | {
    idempotencyKey, requestedStatus, createdAt,
    phase: unknown | pending | confirmed,
    observedTarget: boolean,
    transition?: { operationId, requestedStatus, synchronization, replayed }
  },
  allowedStatus: ACCEPTED | IN_PROGRESS | DONE | null,
  canRetry: boolean,
  blockedReason: null | UNRESOLVED_OPERATION | ASSIGNMENT_CHANGED |
    NO_NEXT_STATUS | BOOKING_NOT_ACTIVE | CANCELLATION_PENDING
}
```

`allowedStatus` chỉ cho bước tiếp theo khi booking đang confirmed/in_progress, không có yêu cầu hủy đã biết và không còn thao tác chưa đối chiếu. `cancellationPending: null` giữ nghĩa chưa có thông tin, không giả boolean false. `observedTarget` chỉ so trạng thái hiện tại với bước đã yêu cầu, không phải xác nhận operation.

PATCH thành công trả `{data: <DTO Staff đã whitelist>, operation: <context công khai>}` với HTTP 200 hoặc 202; không thay `orderAtTransition` thành booking hiện tại. Lỗi trả `{error:{code,message,outcome:"not_sent"|"unknown"},requestId,operation?}`. `unknown` nghĩa request đã bắt đầu gửi và có thể đã ghi; `not_sent` không cho phép bỏ context đã có để tự tạo key mới. Lỗi 401/403 sau xác thực xóa phiên Frontend và cookie; lỗi dependency 502/503 giữ phiên.

## Idempotency và đối chiếu an toàn đã triển khai

Mỗi lần xác nhận bước mới, UI tạo UUID bằng Web Crypto; retry dùng nguyên `Idempotency-Key` và status cũ. UI có mutex/loading và dialog xác nhận; không tự gửi PATCH khi mount, reload, kiểm tra trạng thái hoặc điều hướng.

BFF lưu context **trước** PATCH tại `STAFF_SESSION_DIR/uc12-operations`, tách khỏi file phiên để logout/hết phiên không làm mất key. Nhật ký mã hóa AES-256-GCM bằng khóa phiên server hiện có, ràng buộc actor `users.id`, assignment, target, booking và `assignedAt`. Tên file là hash, không chứa ID/key trực tiếp. Ghi file hoàn chỉnh rồi publish độc quyền qua filesystem; thao tác đầu tiên giữ key, request đồng thời dùng key khác không được gửi tiếp. Store không fallback RAM, không sửa hoặc tự xóa file lỗi.

Một context bất biến cho mỗi actor/assignment/bước tiến. BFF kiểm tra `orderId`/`assignedAt` và trạng thái đã xác nhận để phát hiện assignment đổi thế hệ/lùi trạng thái; khi khác thì chặn để owner đối chiếu. Cách này phù hợp workflow hiện tại chỉ tiến ASSIGNED→ACCEPTED→IN_PROGRESS→DONE. Nếu sau này tái sử dụng cùng assignment ID cho vòng làm việc mới, cần thiết kế riêng với owner; không tự xóa context để chạy lại.

Receipt 200 và 202 được lưu riêng, mã hóa/ràng buộc context. Receipt 200 hợp lệ luôn ưu tiên hơn 202 đến muộn, nên không bị hạ từ confirmed thành pending. Cùng key đã có receipt 200 có thể trả lại xác nhận đã lưu sau khi kiểm tra quyền bằng Staff detail; không gửi thêm PATCH. Timeout, response sai hoặc lỗi lưu receipt sau khi đã gửi giữ context unknown. Còn pending/unknown thì không mở bước mới. Retry do người dùng xác nhận dùng đúng key/payload đã lưu và vẫn qua preflight quyền/trạng thái rồi Backend kiểm tra lại.

Backend Staff hiện **không có public API đọc operation journal bằng idempotency key**. BFF không được mở Order internal ra browser để bù. Đọc detail công việc cho biết trạng thái assignment/booking hiện tại nhưng không đủ chứng minh operation nào đã được ACK hoặc key nào tạo ra trạng thái đó. Vì vậy không đánh dấu SYNCHRONIZED chỉ vì đọc thấy trạng thái đã đạt; giữ pending/unknown cho tới khi có bằng chứng phù hợp từ request gốc/retry cùng key hoặc quy trình owner đối chiếu.

GET đối chiếu BFF không gửi PATCH. Nếu worker Backend đã tự hoàn tất nhưng BFF chưa có receipt 200, GET vẫn giữ pending/unknown; người dùng phải retry cùng key hoặc nhờ owner đối chiếu. Không suy confirmed từ assignment đã DONE hoặc booking COMPLETED.

UI cũng giữ key của request chưa rõ kết quả trong React. Nếu GET chưa tìm thấy đúng context, không unmount panel để làm mất key khi đang thao tác. Sau PATCH 200/202 hoặc kiểm tra lại có context khớp, UC10 đọc lại dữ liệu; không lấy response thao tác cũ làm trạng thái hiện tại. UC9 và UC11 tải mới khi điều hướng trở lại và khi reload. Không đổi dữ liệu localStorage cũ hoặc ghép dữ liệu đó với MySQL.

### Giới hạn vận hành của kho context

- Đây là kho filesystem bền vững cho **một host**. Production phải cấu hình đường dẫn riêng tuyệt đối trên private persistent volume, giữ đúng khóa và quyền truy cập. Chưa hỗ trợ nhiều replica có filesystem độc lập; cần kho chia sẻ có atomicity tương ứng trước khi scale.
- Trên Windows, operator phải cấu hình ACL cho đúng tài khoản chạy Staff Frontend. Node không cung cấp directory-fsync portable trên Windows; publish nguyên tử và fsync file đã có, còn độ bền khi mất điện phụ thuộc filesystem/volume. Không cam kết phục hồi mọi lỗi phần cứng.
- Không tự cleanup/expire context khi logout, không tự xoay/xóa khóa hoặc journal. Trước production cần owner thống nhất retention/backup/archive/rotation để không mất context của thao tác chưa rõ kết quả. Thư mục runtime và khóa đều ngoài Git.
- UI chờ GET tối đa 20 giây, PATCH 45 giây; BFF PATCH Staff mặc định 20 giây, tối đa 30 giây, ngoài thời gian kiểm tra phiên/preflight. Browser có thể hết thời gian trước toàn bộ chuỗi khi dependency chậm; khi đó vẫn unknown và giữ cùng key, không tự tạo thao tác khác.

## Kiểm thử có thể thực hiện khi chưa có QA ghi

- Unit validator/mapper/BFF và HTTP dependency-double riêng: chuyển trạng thái hợp lệ, 200/202, timeout trước/sau upstream, payload/key conflict, replay không lùi trạng thái, lỗi lưu context, khóa gửi trùng, reload/đối chiếu và phân quyền.
- HTTP thật **guard-only**: chưa có phiên/role sai/Origin sai/input sai/method sai hoặc ownership preflight bị từ chối, không gửi một mutation vừa hợp lệ vừa được phép trên assignment hiện có.
- Browser read-only: xem nút/trạng thái, mở/hủy confirmation, lỗi validation và điều hướng/hồi quy; không bấm xác nhận một transition thật khi thiếu manifest/permission.
- Build/typecheck và đối chiếu source/database trước-sau theo phạm vi đã chạy.

HTTP dependency-double được ghi rõ là mock trong test, không thay runtime bằng server giả hoặc coi là Auth→Staff→Order→MySQL ghi thật. Request bị BFF từ chối không chứng minh transition hợp lệ/idempotency/journal thật đã thành công. Lượt kiểm thử guard không dùng cờ từ những lần ghi Backend trước như quyền ghi mới.

## Checklist bộ QA ghi để bàn giao owner

Chưa có manifest được duyệt hoặc runner ghi được phép chạy. Danh sách sau là điều kiện bàn giao, **không phải phê duyệt hoặc chỉ dẫn tự chạy SQL**:

| Nhóm | Cần cung cấp / kiểm chứng |
| --- | --- |
| Quyền | Chấp thuận cụ thể của owner Staff, Order và dữ liệu QA; reference/thời điểm/phạm vi thao tác, không chỉ tự điền `approved:true` trong JSON |
| Database | Host/port công khai và đúng `cleanhome_staff_test`; xác nhận service/test cùng trỏ database, không production |
| Fixture riêng | Marker QA phân biệt, booking/assignment/user/employee IDs allowlist chính xác; không dùng 9109131, 9109141, fixture đã tiêu thụ hoặc dữ liệu đồng đội |
| Trạng thái đầu | Booking CONFIRMED, assignment A/B ASSIGNED thuộc đúng user EMPLOYEE ACTIVE; check-in/out null; chưa có journal operation cho chuỗi sắp chạy |
| Snapshot | Bản sao/snapshot chỉ đọc trước ghi, hash và đường dẫn ignored; gồm assignments/bookings/items/history/journal và dữ liệu ngoài fixture cần bảo toàn |
| Phạm vi ghi | Chỉ assignment status/check-in/out qua Staff; booking status/history/journal qua Order; không giá/lịch/items/users/roster hoặc schema |
| Kịch bản | Sáu transition A/B, duplicate/replay cùng key, conflict key khác payload, A DONE chưa COMPLETED, B DONE đủ điều kiện, retry và gián đoạn có kiểm soát |
| Guard runner | Mặc định NOT_RUN, opt-in riêng cho ghi và manifest, allowlisted booking ID trùng manifest, validation chống ID cũ/dữ liệu sai; không chạy hai suite ghi trên cùng fixture |
| Rủi ro / khôi phục | Giao dịch liên service có commit thật; không hứa rollback toàn chuỗi. Giữ snapshot/journal/operation để điều tra, không tự reset/xóa để chạy lại |
| Secrets | Credential/JWT/Order token ở đúng service/process, không source/log/manifest/browser; báo cáo chỉ metadata an toàn |

Manifest tương lai chỉ nên chứa metadata cần thiết: mục đích QA, database/host, reference owner approval, booking ID, cặp user/employee/assignment và trạng thái đầu, snapshot path/hash, allowlist thao tác, thời hạn cho phép và kế hoạch giữ/đối chiếu dữ liệu sau chạy. Manifest không tự chứng minh người dùng đã cho phép ghi; operator vẫn phải đối chiếu chấp thuận thực tế trước khi bật runner. Chưa tạo seed, SQL fixture, migration hoặc thay cấu hình Backend trong lượt này.

## Cấu hình và chạy an toàn

Giữ BFF Auth/Staff server-only config của các giai đoạn trước; không thêm `NEXT_PUBLIC_*` secret hoặc `ORDER_SERVICE_TOKEN` cho Frontend. Staff cần Order thật và service credential hợp lệ do owner cung cấp; Frontend chỉ gọi Staff public API bằng JWT nhân viên phía server.

Frontend Staff `.env.local` dùng cấu hình server từ `.env.example`, bổ sung `STAFF_STATUS_TIMEOUT_MS=20000` (100–30000). Các giá trị URL local: `AUTH_SERVICE_URL=http://127.0.0.1:4001`, `STAFF_SERVICE_URL=http://127.0.0.1:4005`, `STAFF_APP_ORIGIN=http://localhost:3002`. Không chạy lại init/đổi khóa đã có chỉ để kiểm thử UC12. `STAFF_SESSION_DIR` và `STAFF_SESSION_KEY_FILE` giữ cấu hình của Giai đoạn 1.

Staff `.env` còn thiếu cấu hình JWT cần thiết nên không khẳng định `npm start` Staff trực tiếp đã đủ. Dùng launcher do Order owner cung cấp, đọc `.env`/credential riêng Order và chạy nguyên Staff với môi trường tiến trình đúng Auth/Order, worker tắt. Không sửa `.env`/source của đồng đội và không copy token vào Frontend.

Từ root repository, dùng terminal riêng cho từng tiến trình; dùng server đúng cấu hình đã chạy nếu có:

```powershell
npm.cmd --prefix backend/auth-service start
```

```powershell
npm.cmd --prefix backend/order-service start
```

```powershell
npm.cmd --prefix backend/order-service run staff:integration
```

```powershell
npm.cmd --prefix frontend run dev:staff
```

Launcher không sinh credential/JWT giả và không chạy seed/reset. Nếu thiếu credential hoặc config thì cấu hình qua owner đúng service trước, không bỏ xác thực.

Mở `http://localhost:3002/dang-nhap` → `/cong-viec` → `/don/:assignmentId`, hoặc từ `/lich-lam-viec` chọn công việc. Đăng nhập bằng phone/password nhân viên thật đã được cấp an toàn; không đưa mật khẩu/token vào tài liệu. Khi chưa có QA được phép, chỉ xem dữ liệu, mở và hủy confirmation; **không xác nhận transition thật** để thử giao diện.

Sau kiểm tra, Auth `4001`, Order `4003`, Staff `4005` và Frontend Staff `3002` được giữ chạy để xem giao diện. Nếu các cổng đang hoạt động đúng cấu hình, dùng trực tiếp và không mở tiến trình trùng.

Trong `frontend/apps/staff`:

```powershell
npm.cmd run test:status
npm.cmd run typecheck -- --incremental false
npm.cmd run build
```

`test:status` dùng fixture/double độc lập, không kết nối MySQL. `test:status:http` chỉ opt-in khi `RUN_STAFF_UC12_HTTP_TESTS=true` và credentials/ID snapshot được truyền an toàn; suite có safety gate chặn mọi PATCH mang cookie hoặc Authorization, nên chỉ kiểm guard/read-only. `test:status:browser` cần opt-in `RUN_STAFF_UC12_BROWSER_TESTS=true`, Chrome và credentials an toàn; chặn mọi PATCH thật bằng CDP. Các kịch bản UI 200/202/timeout là response được intercept rõ ràng trong test, không phải runtime mock hoặc bằng chứng MySQL ghi. Không ghi credentials trong command history/source/log.

## Kết quả lượt triển khai

Đã hoàn thiện implementation UC12 và kiểm tra khả thi theo quyền dữ liệu hiện tại. Kết quả dưới đây từ output cuối của lượt này, không suy PASS từ Backend trước. Unit và HTTP double kiểm tra hành vi BFF, không thay bằng chứng UC12 ghi thật.

| Lớp kiểm tra | PASS | FAIL | SKIP / NOT_RUN | Giới hạn |
| --- | ---: | ---: | --- | --- |
| UC12 độc lập: contract/core/store/HTTP wrapper/UI parser | 121 | 0 | 0 | 15 contract, 28 core, 30 store, 31 HTTP double, 17 UI parser; không ghi MySQL/Order thật |
| UC12 HTTP thật guard/read-only | 23 | 0 | 0 | Phiên thật A/B, quyền đọc chéo 404, input/Origin/session guard, Customer bị từ chối; không gửi PATCH hợp lệ có phiên |
| HTTP thật toàn bộ Auth/UC9/UC10/UC11/UC12 | 90 | 0 | 1 SKIP | Auth 12, UC9 16, UC10 18, UC11 21 PASS + 1 SKIP, UC12 23; dòng UC12 phía trên là tập con, không cộng lại |
| Chrome đọc thật và UI intercept | 14 | 0 | 0 | 10 ca đọc thật, 4 ca UI intercept; không có PATCH trạng thái nào được forward thật |
| Responsive panel/dialog | 8 | 0 | 0 | 375/390/768/1440px × hai bố cục; là lượt bố cục trong Chrome, không cộng thành endpoint/test nghiệp vụ mới |
| Chuyển trạng thái hợp lệ A/B qua BFF thật | — | — | NOT_RUN | Chưa có fixture/manifest/phê duyệt ghi riêng |
| Booking nhiều nhân viên, check-in/out/journal thật | — | — | NOT_RUN | Không dùng lại các booking COMPLETED |
| Idempotency/retry/timeout sau commit/Order outage ghi thật | — | — | NOT_RUN | Chưa có môi trường và QA được phép ghi |
| Hồi quy độc lập Auth/UC9/UC10/UC11 | 187 | 0 | 0 | Auth 55, UC9 45, UC10 42, UC11 45 |
| Typecheck Staff/Customer/Admin | 3 | 0 | 0 | Sau source cuối, không thay source Customer/Admin |
| Build production Staff | 1 | 0 | 0 | Build đạt, bao gồm route BFF trạng thái |

Ca UC11 SKIP/NOT_RUN: database hiện không có công việc A đã tồn tại nằm khác ngày giữa UTC và Việt Nam. Unit có ca biên ngày này; không tự thêm fixture chỉ để biến kiểm thử HTTP thành PASS. Đây không phải SKIP của UC12.

Unit UC12 đã kiểm 200/202, receipt/key binding, first-key-wins khi cạnh tranh, restart/relogin context, chặn bước mới khi unknown/pending, retry cùng key, timeout/response sai, lỗi lưu trước/sau PATCH, lỗi phiên/quyền/ownership, generation thay đổi và late 202 không hạ receipt 200. Các kết quả này dùng dependency doubles/filesystem test riêng; chưa chứng minh sáu chuyển trạng thái A/B hay tổng hợp booking trên MySQL trong lượt này.

Chrome dùng profile QA riêng, đăng nhập Auth thật và đọc UC9/UC10/UC12 thật. Đã mở/hủy dialog, kiểm Escape/focus, reload và ranh giới token/cookie; xem screenshot mobile 375 và desktop 1440. Bốn ca intercept chỉ kiểm UI khi timeout/unknown, reload context, retry 202 và retry 200; CDP chặn mọi PATCH thật trước khi tới BFF. `actualStatusPatchForwarded: 0`, không có exception JavaScript, profile QA đã đóng. Ba GET interception bị hủy khi điều hướng là request đọc đã hủy, không phải thao tác ghi hoặc exception ứng dụng.

## File, bảo toàn và bước tiếp theo

### Danh sách file của UC12

Đường dẫn tính từ `frontend/apps/staff/`, trừ ba file UI ghi đường dẫn tính từ `frontend/`. Tổng cộng **19 file** gồm tạo mới hoặc hoàn thiện trong lượt UC12; không có file Backend/database.

| File | Nội dung |
| --- | --- |
| `lib/server/status-config.mjs` | Timeout server-only riêng cho mutation |
| `lib/server/status-contract.mjs` | Input/response whitelist, operation ID và state đối chiếu |
| `lib/server/status-core.mjs` | Preflight quyền, journal trước PATCH, retry/receipt và lỗi |
| `lib/server/status-http.mjs` | BFF GET/PATCH, Origin/CSRF/body/session/error guard |
| `lib/server/status-store.mjs` | Journal mã hóa bền vững và publish bất biến |
| `app/api/staff/jobs/[assignmentId]/status/route.ts` | Nối route cố định vào BFF Node runtime |
| `packages/ui/src/components/staff/staff-job-status-model.ts` | UI parser, trạng thái/thông điệp an toàn |
| `packages/ui/src/components/staff/staff-job-status.tsx` | Panel, dialog, mutex, kiểm tra lại và retry cùng key |
| `packages/ui/src/components/staff/staff-job-detail-remote.tsx` | Mount panel và refresh UC10 tối thiểu |
| `test/status-contract.test.mjs` | Unit contract/transition projection |
| `test/status-core.test.mjs` | Unit coordinator với dependency doubles |
| `test/status-store.test.mjs` | Unit lưu bền/concurrency/encryption/corruption |
| `test/status-http.test.mjs` | HTTP wrapper double, validation và session guard |
| `test/status-ui.test.mjs` | Unit parser và tính nhất quán UI DTO |
| `test/status-http.integration.test.mjs` | HTTP guard/read-only bằng phiên thật |
| `test/status-browser.integration.mjs` | Chrome đọc thật và UI intercept; chặn PATCH thật |
| `package.json` | Ba script kiểm thử UC12, không thêm dependency |
| `.env.example` | Timeout UC12 server-only |
| `docs/UC12_INTEGRATION.md` | Báo cáo, giới hạn và hướng dẫn bàn giao |

### Bảo toàn và artifact

Đối chiếu SHA-256 **100 file nguồn được bảo vệ** trong baseline: không thay đổi; gồm source Backend, core, các phần BFF/UI cũ ngoài sửa UC10 đã được giao. Customer/Admin chỉ typecheck; không chạy lại đầy đủ luồng browser của hai website và không sửa source của chúng. Không hoàn tác thay đổi Git có trước, không commit/push/merge/checkout.

Snapshot chỉ đọc và đối chiếu tất cả cột, thứ tự ID của bốn bảng MySQL cho kết quả hash trước/sau khớp:

| Bảng | Số bản ghi | Trước/sau |
| --- | ---: | --- |
| `assignments` | 44 | Không đổi |
| `bookings` | 24 | Không đổi |
| `booking_items` | 24 | Không đổi |
| `booking_status_history` | 22 | Không đổi, gồm nội dung journal đã có |

Không chạy seed/reset hoặc PATCH cập nhật trạng thái thật; không ghi vào các booking COMPLETED đã nêu. Đối chiếu này xác nhận dữ liệu bốn bảng đã quan sát, không thay kiểm thử ghi transaction hoặc bằng chứng mọi bảng khác trong database.

Artifact tại `frontend/apps/staff/.auth-data/qa/uc12/` (ngoài Git):

- `http-all.tap`: 90 PASS, 1 SKIP của năm suite HTTP thật.
- `browser/report.json`, `browser/uc12-375.png`, `browser/uc12-1440.png`, `browser/uc12-dialog-375.png`, `browser/uc12-dialog-1440.png`: báo cáo và ảnh Chrome.
- `preservation-before.json`, `preservation-report.json`: baseline/hash 100 file nguồn.
- `mysql-before.json`, `mysql-preservation.json`: snapshot/hash đối chiếu chỉ đọc bốn bảng.

Kết thúc lượt triển khai code ban đầu, **kiểm thử UC12 ghi thật end-to-end là NOT_RUN** vì chưa có bộ QA được duyệt. Trạng thái này đã được cập nhật bằng lượt Q01–Q06 được nhóm phê duyệt: 43 nhóm E2E PASS trong [báo cáo nghiệm thu](UC12_E2E_QA_REPORT.md), tách khỏi các kết quả chỉ đọc lịch sử ở trên.

Bước tiếp theo sau lượt QA mới: owner review manifest, evidence và giới hạn trong báo cáo nghiệm thu; hoàn tất bàn giao Git/PR theo quy trình nhóm. Sáu fixture đã DONE/COMPLETED phải được giữ lại; không chạy lại workflow từ trạng thái đầu, xóa journal hoặc reset để thử lại. Muốn chạy thêm chuỗi ghi cần fixture và phạm vi phê duyệt phù hợp riêng.
