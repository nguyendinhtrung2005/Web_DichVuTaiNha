# CleanHome — nghiệm thu Frontend Staff UC12 với MySQL thật

Ngày lập: **24/10/2026** (giờ Việt Nam). Nhánh làm việc: `feat/cleanhome-frontend`.

## Phạm vi được phê duyệt và trạng thái báo cáo

Người dùng xác nhận nhóm đã duyệt bộ QA Q01–Q06 trong yêu cầu đính kèm `56ba81a2-c872-4cc4-9a39-3e9f84003433`. Phạm vi là sáu booking, sáu booking item và mười hai assignment A/B mới trong `127.0.0.1:3306/cleanhome_staff_test`; sau tạo chỉ chạy UC12 trên ID thuộc manifest. Không thay schema hoặc API contract, không reset/xóa/restore dữ liệu đã commit và không bật worker phục hồi toàn database.

**E2E ghi thật Q01–Q06 đã đạt: 43 nhóm kiểm tra PASS, 0 FAIL, 0 SKIP.** Sáu fixture đều được giữ lại ở COMPLETED/DONE, mỗi booking có sáu journal đã ACK. Kết quả này lấy từ `e2e-report.json` của lượt execute kết thúc lúc 23:22:13 ngày 24/10/2026 giờ Việt Nam (`2026-10-24T16:22:13Z`); không suy ra từ các test mock hoặc báo cáo Backend cũ. Hồi quy, ba typecheck và build Staff cuối đều đạt theo bảng riêng bên dưới.

Nguồn đối chiếu: `AGENTS.md`, `BACKEND_TEAM_RULES .md` (tên file thực tế có khoảng trắng), [Auth Frontend](AUTH_INTEGRATION.md), [UC9](UC9_INTEGRATION.md), [UC10](UC10_INTEGRATION.md), [UC11](UC11_INTEGRATION.md), [UC12](UC12_INTEGRATION.md), README Staff/Order, [contract Staff → Order](../../../../backend/staff-service/docs/order-service-contract.md) và [Order Staff integration](../../../../backend/order-service/docs/staff-integration.md). Một số mô tả tiến độ đầu tài liệu Backend còn cũ; báo cáo lấy contract thực thi và bằng chứng của lượt này làm căn cứ.

## Môi trường và ranh giới bằng chứng

| Thành phần | Môi trường kiểm thử |
| --- | --- |
| Auth thật | `http://127.0.0.1:4001`; JWT RS256, JWKS và introspection hiện có |
| Frontend/BFF QA | Tiến trình riêng `http://localhost:3302`, dùng production build Staff hiện có |
| Staff QA | Tiến trình riêng loopback `4405`, nguyên logic/auth của Staff |
| Order QA | Tiến trình riêng loopback `4403`, nguyên logic/journal của Order |
| MySQL | `127.0.0.1:3306`, database `cleanhome_staff_test`, server/client **9.6.0** |
| Trình duyệt | Chrome headless với profile riêng cho từng người dùng QA |
| Trạng thái worker | Tắt; không quét hoặc ghi phục hồi pending ngoài manifest |

Luồng nghiệm thu là **đăng nhập UI thật → Browser cùng origin → Next.js BFF → Staff Service → Order Service → MySQL**. Relay QA chỉ chuyển tiếp request/response thật hoặc đóng kết nối tại điểm lỗi đã chọn; không trả thành công giả hoặc bỏ middleware xác thực. Gọi trực tiếp Staff/Order nếu có chỉ là bằng chứng bổ sung, không thay E2E Frontend.

JWT ở phía BFF/server. Browser chỉ nhận ID phiên opaque qua cookie HttpOnly; không chép JWT hoặc service credential vào JavaScript, localStorage/sessionStorage, manifest hoặc báo cáo. Key phiên/kho journal QA tách khỏi dữ liệu người dùng đang dùng tại cổng 3002. Chỉ đổi cổng không cô lập cookie, nên Chrome profile riêng là điều kiện bắt buộc.

## Tiền kiểm và backup

Tiền kiểm đọc đúng database, đủ 32 bảng InnoDB và không có trigger. A/B đang ACTIVE, role EMPLOYEE; quan hệ user–employee–branch hợp lệ. Customer, branch và service tham chiếu được kiểm tra lại trước khi tạo fixture. Không phát hiện transaction hoặc query ghi khác tại các lần quan sát tiền kiểm; đây là bằng chứng tại thời điểm đọc, kết hợp với advisory lock của coordinator, ID fixture mới và kiểm tra hash sau mỗi bước, không phải tuyên bố chặn được mọi writer không tuân thủ lock.

| Bảng | Trước QA | Sau Q01–Q06 | Thay đổi được duyệt |
| --- | ---: | ---: | --- |
| `bookings` | 24 | 30 | Sáu fixture mới, không đổi booking cũ |
| `booking_items` | 24 | 30 | Sáu item mới; snapshot/giá không đổi khi chạy UC12 |
| `assignments` | 44 | 56 | Mười hai assignment mới, cuối cùng DONE |
| `booking_status_history` | 22 | 58 | 36 journal mới đã ACK; giữ nguyên 22 journal cũ |

Cả 22 journal cũ đã ACK. Booking `9109131` và `9109141` đều COMPLETED, giữ nguyên để đối chiếu; không dùng chúng làm đầu vào workflow mới.

Hai bản sao lưu ngoài Git đã tạo và đọc lại được trước thao tác ghi:

| Artifact | Bằng chứng |
| --- | --- |
| `mysql-consistent-backup.json` | Snapshot nhất quán InnoDB READ ONLY, mọi cột bốn bảng và SHOW CREATE TABLE; readback/hash khớp |
| `mysql-9.6-backup.sql` | `mysqldump` **9.6.0**, `--single-transaction`, đúng bốn bảng; 34.696 byte, đủ completion marker, không có DROP TABLE/DATABASE |
| `mysql-9.6-backup.json` | Checksum và row counts 24/24/44/22 của SQL dump |
| `preflight-proof.json` | Gate database/writer/backup và lịch dự kiến Q01–Q06 |
| `source-before.json` | Baseline hash 110 file nguồn được bảo vệ trước thay đổi QA |

Backup không được thực thi để restore trong lượt này. Khả năng đọc, checksum, DDL và row counts đã kiểm; **chưa chạy restore thử sang database khác**, nên không mô tả backup đã được diễn tập phục hồi toàn hệ thống.

## Fixture và manifest

Tham chiếu: Customer `9109001`, branch `9109003`, service `9109006`; A là user `9109002`/employee `9109004`, B là user `9109101`/employee `9109102`. Không thêm/sửa tài khoản, mật khẩu hoặc dịch vụ.

Mỗi fixture khởi đầu booking CONFIRMED; hai assignment ASSIGNED, check-in/out NULL; một booking item với snapshot tên, giá và đơn vị từ service thực; chưa có journal. ID lấy AUTO_INCREMENT, marker UUID riêng; không reserve số ID theo suy đoán. Lịch 08:00–10:00 Việt Nam của từng ngày dưới đây được chọn để không giao lịch A/B đã lưu và kiểm tra lại trước INSERT.

| Ca | Booking ID | Assignment A/B | Lịch Việt Nam | Mục đích | Kết quả |
| --- | --- | --- | --- | --- | --- |
| Q01 | `9109151` | `9109173` / `9109174` | 31/10/2026 | Workflow tuần tự A/B, phân quyền và UC9–UC11 | PASS, COMPLETED, 6 ACK |
| Q02 | `9109152` | `9109175` / `9109176` | 01/11/2026 | Đồng thời, duplicate và payload conflict | PASS, COMPLETED, 6 ACK |
| Q03 | `9109153` | `9109177` / `9109178` | 02/11/2026 | Order mất kết nối trước commit | PASS, COMPLETED, 6 ACK |
| Q04 | `9109154` | `9109179` / `9109180` | 03/11/2026 | Order commit nhưng mất phản hồi | PASS, COMPLETED, 6 ACK |
| Q05 | `9109155` | `9109181` / `9109182` | 04/11/2026 | Gián đoạn trước/sau ACK | PASS, COMPLETED, 6 ACK |
| Q06 | `9109156` | `9109183` / `9109184` | 05/11/2026 | Mất phản hồi, reload và đăng nhập lại | PASS, COMPLETED, 6 ACK |

Manifest riêng `manifest.json` ghi approval reference, run ID, marker, ID thực tế, trạng thái đầu, lịch, allowlist, snapshot và kết quả. Coordinator có gate chống tạo trùng; khi đã tiêu thụ fixture không chạy lại từ trạng thái ASSIGNED cũ. Nếu commit fixture xong nhưng chưa publish manifest, chỉ phục hồi bằng UUID marker và kiểm tra đầy đủ sáu fixture; không INSERT thêm hoặc reset.

## Hợp đồng và đối chiếu dữ liệu

Browser dùng `GET/PATCH /api/staff/jobs/:assignmentId/status`. BFF gọi Staff public GET detail và PATCH `/api/v1/staff/me/jobs/:assignmentId/status`, truyền JWT server-side và `Idempotency-Key` ổn định. Body mutation chỉ có `{status:"ACCEPTED"|"IN_PROGRESS"|"DONE"}`.

Assignment tiến `ASSIGNED → ACCEPTED → IN_PROGRESS → DONE`. Staff ghi `assignments.status/check_in_at/check_out_at`; Order ghi `bookings.status`, INSERT journal trong `booking_status_history` và UPDATE `note` của journal khi ACK. `booking_items`, giá, lịch, roster, user/employee/service và mọi dòng ngoài allowlist phải giữ nguyên. Các bảng runtime không có `updated_at` trong schema hiện có.

Một bước nghiệp vụ hợp lệ thêm đúng một journal, kể cả booking chưa đổi trạng thái. ACK không tạo dòng lịch sử thứ hai. Operation ID là SHA-256 của JSON `[actorUserId,assignmentId,Idempotency-Key]`; bước tiếp theo dùng key mới, retry giữ nguyên key/payload. Replay có thể trả assignment hiện đã tiến xa hơn, còn `orderAtTransition` là snapshot ACK gốc; không dùng snapshot cũ làm booking hiện tại.

| Tình huống | Điều kiện đạt cần kiểm |
| --- | --- |
| HTTP 200 | SYNCHRONIZED và receipt confirmed hợp lệ; tải lại dữ liệu hiện tại |
| HTTP 202 | PENDING_ACKNOWLEDGEMENT; UI chưa mở bước mới; retry cùng key để có xác nhận |
| Timeout/mất phản hồi | Giữ unknown/context, không tự tạo key hoặc PATCH mới |
| Đọc thấy assignment tiến triển | Không tự coi là bằng chứng operation đã ACK |
| A DONE trước B | Booking vẫn IN_PROGRESS |
| Cả A/B DONE | Booking COMPLETED nếu đủ điều kiện, đúng sáu journal đã ACK |

Sau từng bước, runner lưu trạng thái SQL, journal/operation/ACK, check-in/out đối chiếu `ack.occurredAt`, số dòng, hash dữ liệu ngoài allowlist và dữ liệu bất biến của fixture. Sai khác ngoài phạm vi là điều kiện dừng các thao tác ghi còn lại.

## Bằng chứng Q01 và Q02–Q06

Q01 thực hiện sáu lần xác nhận qua UI thật. A nhận việc còn kiểm hai lần submit liên tiếp chỉ gửi một request. Sau mỗi bước, runner đọc lại SQL và đối chiếu ngoài allowlist trước khi tiếp tục:

| Bước Q01 | A | B | Booking | Journal / ACK |
| --- | --- | --- | --- | ---: |
| Khởi đầu | ASSIGNED | ASSIGNED | CONFIRMED | 0 / 0 |
| A nhận | ACCEPTED | ASSIGNED | CONFIRMED | 1 / 1 |
| B nhận | ACCEPTED | ACCEPTED | CONFIRMED | 2 / 2 |
| A bắt đầu | IN_PROGRESS | ACCEPTED | IN_PROGRESS | 3 / 3 |
| B bắt đầu | IN_PROGRESS | IN_PROGRESS | IN_PROGRESS | 4 / 4 |
| A hoàn thành | DONE | IN_PROGRESS | IN_PROGRESS | 5 / 5 |
| B hoàn thành | DONE | DONE | COMPLETED | 6 / 6 |

UC9, UC10 và UC11 được đọc lại qua BFF thật cho cả A/B và mở giao diện danh sách/lịch. Assignment hoàn thành xuất hiện với trạng thái đúng; UC10 giữ phân biệt assignment DONE và booking completed. Chrome đã chụp bố cục hoàn thành tại 375, 390, 768 và 1440px, không phát hiện tràn ngang trong những lượt này. Các ảnh là dữ liệu tổng hợp QA có nhãn, không phải dữ liệu khách hàng thật.

| Ca lỗi/đồng thời | Kết quả thực tế |
| --- | --- |
| Q02 | A/B cùng gửi mỗi bước bằng key riêng, hai request cùng key/payload cho mỗi người. Các phản hồi 200; cuối mỗi bước có 2/4/6 journal. Cùng key nhưng payload khác bị 409 và không tăng journal. Đây là request thật từ browser tới BFF với phiên A/B; không phải bốn lần bấm UI đồng thời. |
| Q03 | Relay QA đóng kết nối Order trước khi forward; Frontend nhận 503 và giữ unknown. Assignment vẫn ASSIGNED, journal 0. Mở lại relay và retry nguyên key trả 200, chỉ tạo một operation; sau đó hoàn tất sáu bước. |
| Q04 | Relay cho PUT IN_PROGRESS thực vào Order, chờ phản hồi commit rồi làm mất response. Booking đã IN_PROGRESS, journal thứ ba pending, nhưng assignment A còn ACCEPTED/check-in NULL. Retry cùng key lấy ACK gốc, ghi check-in đúng `occurredAt`, không tạo journal thứ tư cho thao tác này. |
| Q05 trước ACK | POST acknowledgement bị chặn trước Order: assignment đã ACCEPTED, journal `staffAcknowledged=false`, Staff/BFF trả 202, UI pending và không mở bước mới. Retry cùng key trả 200. |
| Q05 sau ACK | Order đã ACK thật rồi mất response: journal đã true nhưng Staff/BFF vẫn trả 202. GET không tự coi pending là confirmed chỉ vì assignment tiến triển; retry cùng key trả 200, không thêm journal. |
| Q06 Staff→BFF | Staff đã commit+ACK nhưng relay làm mất phản hồi: BFF trả 503/unknown. Reload, logout/login lại không tự PATCH, vẫn khôi phục đúng key; retry nguyên key trả 200 và journal vẫn một dòng. |
| Q06 BFF→browser | CDP làm mất phản hồi sau khi BFF thực trả 200. Reload và đăng nhập lại đọc được receipt confirmed đã lưu, đúng key ban đầu, không gửi PATCH mới. Không dùng `Fetch.fulfillRequest` hoặc response thành công giả. |

Ca cùng key nhưng payload khác được gửi từ browser tới BFF và bị chặn ở ranh giới BFF; không tuyên bố request xung đột đó đã tới nhánh kiểm tra payload của Order. Với Q02, đối chiếu event relay cho **từng operation trong sáu operation** có hai lookup GET, một PUT và hai POST ACK được forward thật: duplicate đã đi qua Staff/Order và chỉ ghi một journal, không chỉ được phục vụ từ receipt BFF. Các lần replay sau khi đã confirmed vẫn có thể được BFF trả receipt mà không gọi Backend thêm lần nữa.

Hai chiều cập nhật chéo A/B đều 404; ID không có và ID ngoài quyền có cùng lỗi an toàn. Thiếu phiên nhận 401; Customer không tạo được phiên EMPLOYEE, login trả 403. ASSIGNED→DONE bị BFF từ chối 409 trước khi tạo journal. Cookie HttpOnly/SameSite=Lax và ranh giới token/browser storage được kiểm ở đầu/cuối; local HTTP không có Secure, HTTPS chưa được kiểm ở lượt này.

Chrome có bốn profile QA A/B/Anonymous/Customer: tất cả đóng sau kiểm tra, không ghi nhận JavaScript exception hoặc vi phạm ranh giới request/credential. Tiến trình QA được đóng riêng; không restart/dừng các service dùng chung tại 3002/4003/4005. Q03 là gián đoạn vận chuyển bằng relay QA, **không phải** bài dừng/khởi động tiến trình Order thật hoặc crash/power-loss.

## Kết quả kiểm thử của lượt nghiệm thu

| Nhóm | PASS | FAIL | SKIP | NOT_RUN / giới hạn |
| --- | ---: | ---: | ---: | --- |
| Tiền kiểm/backup/phiên/bảo toàn chung | 9 | 0 | 0 | Nhóm của cùng runner 43 ca; chưa diễn tập restore |
| Q01 — workflow UI, bảo mật, UC9–UC11 | 9 | 0 | 0 | Sáu bước + hai nhóm quyền + một nhóm đồng bộ/UI |
| Q02 — đồng thời/idempotency | 1 | 0 | 0 | Một nhóm có nhiều request và assertion, không tính thành nhiều test độc lập |
| Q03 — Order trước commit | 6 | 0 | 0 | Một ca lỗi/retry và năm bước tiếp theo |
| Q04 — mất phản hồi sau commit | 6 | 0 | 0 | Đúng key, ACK/timestamp gốc và sáu operation |
| Q05 — trước/sau ACK | 6 | 0 | 0 | Hai trạng thái 202 khác nhau, cùng-key recovery |
| Q06 — reload/đăng nhập lại | 6 | 0 | 0 | Mất response Staff/BFF và response browser riêng biệt |
| Tổng runner E2E thật | **43** | **0** | **0** | Các hàng E2E phía trên là thành phần của tổng này, không cộng lại |
| Unit độc lập Backend/Frontend/tooling | **557** | **0** | **0** | Auth Backend 46, Staff 99, Order 72, Frontend 308, relay 13, backup 7, data 12; không phải 557 E2E |
| Hồi quy HTTP Auth/UC9–UC12 chỉ đọc | **90** | **0** | **1** | 91 test thuộc năm suite; fresh metadata sau tạo fixture |
| Hồi quy Chrome UC9 gốc | **15** | **0** | **0** | A/B, filter/sort/pagination/reload/logout, responsive; không ghi MySQL |
| Typecheck Staff/Customer/Admin | **3** | **0** | **0** | Ba ứng dụng đạt, không đổi source Customer/Admin |
| Build Staff production | **1** | **0** | **0** | `next build --webpack` kết thúc exit 0 sau thay đổi cuối; đây là một lệnh kiểm tra build, không cộng thành E2E test |

Các kết quả lịch sử HTTP/Chrome chỉ đọc nằm trong [UC12 integration](UC12_INTEGRATION.md); không cộng lại hoặc thay thế số đo của lượt nghiệm thu này. Trong 308 test Frontend chạy lại có 121 unit UC12 và 187 Auth/UC9–UC11. Test relay/data/backup bằng dependency doubles không phải MySQL/HTTP E2E thật.

Một SKIP HTTP thuộc UC11: chưa có assignment A thật giao ranh ngày UTC/Việt Nam trong fixture hiện có. Unit đã có ca biên ngày, nhưng không thêm dữ liệu ngoài sáu fixture được duyệt chỉ để đổi SKIP thành PASS. Đây không phải SKIP của Q01–Q06.

Hồi quy lấy lại metadata sau tạo fixture: A có **29** assignment và B có **27**, tổng 56; không dùng tiếp giả định cũ 23/21. Runner HTTP và Chrome chỉ đọc đối chiếu mọi cột bốn bảng trước/sau hồi quy không đổi. Chrome UC9 gốc có 15 PASS, không exception/lộ credential; bản test dùng trong QA được giữ nguyên nguồn và chạy với origin/metadata/profile riêng.

Q01 phải đạt và baseline ngoài phạm vi giữ nguyên trước Q02–Q06. Dữ liệu đã commit được giữ để truy vết kể cả khi test lỗi giữa chừng. Không reset để làm lại test xanh.

Các lượt khởi động đầu đã gặp dependency Auth offline và lỗi harness QA trước khi có transition UC12 hợp lệ: phạm vi probe read-only qua relay, lifecycle của helper. Chỉ tooling QA được sửa; không đổi source nghiệp vụ để ép PASS. Manifest giữ lịch sử Q01 FAIL của harness rồi PASS cuối, không xóa dấu vết. Số 43/0 là kết quả execute hoàn tất sau sửa harness, không mô tả mọi lần khởi động đều thành công.

Đối chiếu cuối `outsideAllowlistUnchanged=true`: hash mọi cột của 24 booking, 24 item, 44 assignment và 22 history ban đầu khớp baseline; snapshot giá/lịch/item/roster của sáu fixture mới cũng giữ nguyên. Chỉ trạng thái, check-in/out và 36 journal/ACK mới thay đổi theo scope. Booking `9109131` và `9109141` được bảo vệ nguyên vẹn. Không reset, xóa, seed lại hoặc restore database dùng chung.

`source-preservation.json` đối chiếu **110 file được bảo vệ, không file nào thay đổi**. Đây là phạm vi source đã chọn của ba Backend service, core, Staff UI/BFF và các file dùng chung/Customer liên quan; không phải checksum toàn repository. Đối chiếu dữ liệu cũng chỉ bao gồm mọi cột bốn bảng nêu trên, immutable fixture và các trường tham chiếu kiểm tra, **không phải checksum mọi dữ liệu của cả 32 bảng**.

## Giới hạn chưa kiểm chứng

- Lượt này là loopback, HTTP và một máy Windows; chưa kiểm HTTPS/Secure cookie thực, nhiều host/replica, serverless, thiết bị vật lý hoặc mạng triển khai thật.
- Fault injection đã chạy với request/commit thật qua relay và browser; chưa thử deadline hết do dependency chậm thực tế, kill/crash tiến trình Order/Staff/BFF, mất điện, lỗi ổ đĩa hoặc restore backup. Socket/response loss thật không phải bằng chứng những loại lỗi này đã PASS; deadline có kiểm tra độc lập trong unit.
- Worker phục hồi toàn database cố ý không bật. Bằng chứng recovery ở đây là explicit retry cùng khóa của fixture và đọc receipt, không phải nghiệm thu worker/global queue hoặc fairness nhiều instance.
- Schema/store vẫn là mô hình hiện có: projection SQL trên database tích hợp chung, journal Order trong TEXT, journal/phiên BFF filesystem một host. Không triển khai database-per-service, journal index, retention/rotation hoặc cơ chế session phân tán trong lượt QA này.
- Cancellation pending chưa có cột nguồn và tiếp tục null; UC10 có thể báo lịch sử Order bổ sung chưa lấy được vì API context tùy chọn chưa có. Hai điểm này không được thay bằng dữ liệu giả hoặc coi là đã tích hợp ngoài phạm vi UC12.
- Kết quả đủ hay chưa đủ nghiệm thu chỉ áp dụng các ca và môi trường đã ghi. Owner vẫn cần review bằng chứng, giới hạn và PR; không đồng nhất báo cáo tự động với phê duyệt sản phẩm cuối của cả nhóm.

## Artifact và thay đổi cần review

Artifact runtime riêng: `frontend/apps/staff/.auth-data/qa/uc12-e2e-20261024/` (được Git ignore). Backup, manifest, journal/key/phiên riêng và báo cáo chi tiết chỉ phục vụ QA nội bộ; không đưa credential vào PR hoặc ảnh chụp.

| Artifact | Dùng để đối chiếu |
| --- | --- |
| `manifest.json` | Phạm vi được duyệt, marker/ID/lịch/trạng thái đầu và kết quả từng fixture |
| `e2e-report.json` | Execute thật 43 PASS, trạng thái trước/sau từng ca, HTTP/key/ACK và relay event |
| `Q01-latest.json` … `Q06-latest.json` | Trạng thái SQL, journal/ACK, timestamp và bảo toàn sau fixture |
| `browser/Q01-completed-375.png` … `browser/Q01-completed-1440.png` | Bốn screenshot Q01 hoàn thành; đã xem ảnh 375/1440px |
| `http-regression.tap` | 90 PASS/1 SKIP của năm suite HTTP sau tạo fixture |
| `readonly-regression-browser-report.json` | Metadata A29/B27 và mọi cột bốn bảng không đổi qua hồi quy chỉ đọc |
| `uc9-browser-regression-report.json` | 15 kiểm tra Chrome UC9 gốc đạt, profile đã đóng |
| `source-preservation.json` | 110 source hash không đổi |

Các file cần owner review:

| File, đường dẫn tính từ repo root | Nội dung |
| --- | --- |
| `backend/order-service/scripts/uc12-qa-data.mjs` | Tiền kiểm, backup snapshot, fixture, manifest và bảo toàn dữ liệu |
| `backend/order-service/test/uc12-qa-data.test.mjs` | Kiểm tra tooling bằng SQL double và filesystem riêng |
| `frontend/apps/staff/scripts/uc12-qa/backup.mjs` | Native mysqldump/readback, checksum và gate writer |
| `frontend/apps/staff/scripts/uc12-qa/relay.mjs` | Relay fault injection theo allowlist, không fake success |
| `frontend/apps/staff/scripts/uc12-qa/runtime.mjs` | Tiến trình QA riêng, worker tắt, môi trường Frontend không chứa secret Backend |
| `frontend/apps/staff/scripts/uc12-qa/browser.mjs` | Chrome UI thật, profile riêng A/B và evidence an toàn |
| `frontend/apps/staff/scripts/uc12-qa/run.mjs` | Coordinator dry-run/execute/audit và fail-fast |
| `frontend/apps/staff/scripts/uc12-qa/regression.mjs` | Hồi quy chỉ đọc với ownership metadata mới và Chrome UC9 gốc |
| `frontend/apps/staff/test/status-qa-relay.test.mjs` | Kiểm tra relay transport riêng với double |
| `frontend/apps/staff/test/uc12-qa-backup.test.mjs` | Kiểm tra backup/parser/gate bằng double |
| `frontend/apps/staff/docs/UC12_E2E_QA_REPORT.md` | Báo cáo nghiệm thu lượt được duyệt |
| `frontend/apps/staff/docs/UC12_INTEGRATION.md` | Liên kết và cập nhật trạng thái bằng chứng sau nghiệm thu |

Tổng cộng **12 file tạo/sửa** trong lượt QA, gồm mười file tooling/test mới và hai tài liệu. Không refactor nghiệp vụ Auth/Staff/Order/Frontend, thay schema, Gateway, Customer/Admin hoặc ghi đè thay đổi chưa commit. Những thay đổi Git có trước vẫn được giữ; không tự commit, push, merge, reset hoặc checkout.

## Chạy lại an toàn và bàn giao

Từ `backend/auth-service`, runner đọc cấu hình Auth cục bộ hiện có; credential QA được giải mã trong tiến trình Node và không đưa vào dòng lệnh hoặc JavaScript browser:

```powershell
node --env-file-if-exists=.env ../../frontend/apps/staff/scripts/uc12-qa/run.mjs --dry-run
```

`--dry-run` không INSERT/UPDATE MySQL. `--execute` chỉ dùng trong đúng phạm vi phê duyệt và sau khi xác nhận fixture chưa tiêu thụ. Không chạy lại execute trên fixture đã DONE; audit chỉ đọc hoặc một bộ fixture mới cần phê duyệt tương ứng. Không tự chạy các test ghi cũ vốn tạo fixture khác hoặc tiêu thụ booking `9109131`.

Đối chiếu bộ fixture đã giữ lại bằng chế độ chỉ đọc:

```powershell
node --env-file-if-exists=.env ../../frontend/apps/staff/scripts/uc12-qa/run.mjs --audit
```

Các mode audit/dry-run có report riêng, giữ nguyên `e2e-report.json` của execute. Có thể chạy lại hồi quy chỉ đọc bằng `regression.mjs --browser` khi Auth hoạt động, các cổng QA trống và Chrome/profile riêng được phép khởi động. Không bật lại test ghi cũ để lấy bằng chứng bổ sung.

Để kiểm tra giao diện chính, dùng `http://localhost:3002/dang-nhap` với tài khoản nhân viên thật đã được cấp, mở `/cong-viec`, `/don/9109173` (A) hoặc `/don/9109174` (B), rồi lịch ngày 31/10/2026. Q01 đã DONE/COMPLETED nên chỉ xem kết quả; không đưa về trạng thái ban đầu. Auth/Order/Staff chính dùng 4001/4003/4005; tiến trình QA riêng 3302/4403/4405 đã đóng sau kiểm thử. Source Backend/config `.env` chung được giữ nguyên; cách chạy chuẩn vẫn theo tài liệu tích hợp của từng owner.

Trước PR cần review tooling/SQL/allowlist bởi owner Staff và Order, đối chiếu kết quả thực tế cùng source hash, loại backup/secret khỏi staged files và mô tả rõ giới hạn. Không tự commit, push, merge hoặc đổi branch.

## Kết luận và bàn giao

**Đủ bằng chứng kỹ thuật để nghiệm thu UC12 trong phạm vi local và sáu kịch bản Q01–Q06 đã được nhóm duyệt.** Luồng Browser/BFF/Auth/Staff/Order/MySQL thật đã kiểm chứng cập nhật trạng thái, quyền A/B, nhiều nhân viên, duplicate, journal/ACK và phục hồi bằng cùng key khi mất phản hồi. Dữ liệu ngoài allowlist được bảo toàn, hồi quy và build/typecheck đạt; sáu fixture đã tiêu thụ được giữ nguyên để truy vết.

Đây không phải chứng nhận production, nghiệm thu mọi loại crash/deployment hoặc thay cho review chính thức của owner. Staff/Order và người tích hợp cần review 12 file QA/tài liệu, manifest và evidence; kiểm tra staged files không có backup/key/credential trước khi thành viên chủ động tạo commit/PR theo quy trình nhóm. Chưa tự commit, push, merge hoặc đổi branch. Không tự chạy thêm vòng ghi hoặc tạo fixture ngoài phạm vi phê duyệt hiện tại.
