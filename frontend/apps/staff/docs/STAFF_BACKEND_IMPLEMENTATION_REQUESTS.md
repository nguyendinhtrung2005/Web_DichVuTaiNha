# CleanHome Staff — yêu cầu Backend để hoàn thiện website

Ngày 29/10/2026; checkpoint `913a12d`. Tài liệu bàn giao owner; API/DTO đề xuất chưa duyệt hoặc triển khai.

**Kiểm chứng lại 02/11/2026:** `staff-service` vẫn chỉ có `jobs`/`schedule`/`detail`/`status`; `payment-service`, `review-service`, `user-service`, `service-service` vẫn là scaffold rỗng; Order trả `404 NOT_FOUND` cho cả hai endpoint `staff-context` (đơn lẻ và batch) trong khi `assignment-transitions/pending` trả `200`; các bảng `notifications`, `reviews`, `payments`, `revenue_shares`, `employee_availability` đều 0 dòng. Bằng chứng chi tiết ở §0.4 của [STAFF_BACKEND_CONTRACT_PROPOSALS.md](STAFF_BACKEND_CONTRACT_PROPOSALS.md).

Phạm vi đã được người dùng cấp: **website Staff/BFF/test/doc**. **Đã chốt phân công đích danh**; không triển khai shared-slot/nhận việc tự do.

## Ma trận chức năng và phụ thuộc

| Phân hệ | Phần có nguồn thật | Phần chưa hoàn tất | Owner phối hợp |
| --- | --- | --- | --- |
| A Thu nhập | Chưa có API tiền công cho Staff | BLOCKED: công thức, ledger, kỳ, biểu đồ ngày/tháng, nguồn tiền, bảng kê và chi trả | TV5 + business owner; TV3/TV4/TV1 |
| B Tiếp nhận | Phân công đích danh; ownership, row lock/CAS, FSM, idempotency/journal UC12 | PARTIAL: tải lại GET đã triển khai/kiểm chứng; race ghi cần fixture QA mới | TV4 Staff + TV3 Order |
| C Hồ sơ | Session công khai: accountId/EMPLOYEE/ACTIVE; hub/logout | PARTIAL: hồ sơ đầy đủ, sửa trường cho phép, ảnh, chi nhánh/kỹ năng/chứng chỉ | TV1 User + TV4 |
| D Thông báo | Route/navigation, trạng thái chưa khả dụng đúng bản chất | BLOCKED: list/count/read-state, đánh dấu đọc, sự kiện và deep link có quyền | TV5 phối TV1/TV4; nhóm xác nhận owner |
| E Lịch sử | Assignment DONE phân trang; checkOutAt có nhãn đúng nguồn | PARTIAL: Order BookingContext/timeline chưa được router expose | TV3 chủ trì; TV4 consumer |
| F Khu vực/ca | Lịch assignment UC11 | BLOCKED: vùng được giao, ca rảnh/đăng ký ca, readiness và quy tắc xung đột | TV4 + TV3; TV1 quyền |
| G Thành tích | Thống kê assignment theo khoảng lịch hẹn/trạng thái hiện tại, pagination.total riêng | PARTIAL: review/rating/KPI/thưởng cần API và quy tắc duyệt | TV5 Review/Report + TV4/business |
| H Hỗ trợ/Cài đặt | Motion/focus lưu theo trình duyệt; logout thật | PARTIAL: kênh/FAQ chính thức, ticket; password/devices/sessions và đồng bộ tài khoản | Nhóm chốt support owner; TV5/TV1/TV4; TV1 Auth/User |

Giữ đầy đủ A–H trong mục tiêu website.

## Ưu tiên có thể bàn giao ngay

1. Staff Frontend/BFF: tải lại GET danh sách phân công, giữ filter/page/sort và danh tính; không tự PATCH hoặc làm mất UC12 unknown key.
2. TV3: GET staff-context cho UC10, vì client/interface đã tồn tại và không cần chờ quyết định thu nhập.
3. TV1/TV4: hồ sơ đọc trước, sửa sau theo allowlist; TV5: Notifications contract và event delivery.
4. TV5/business owner: Thu nhập theo [STAFF_INCOME_ACCEPTANCE_CONTRACT_PROPOSAL.md](STAFF_INCOME_ACCEPTANCE_CONTRACT_PROPOSAL.md). Không bỏ module, không tự chọn công thức tiền/chi trả.
5. TV4: khu vực/ca/readiness; TV5/TV4: review/KPI; support owner cung cấp kênh và nội dung.

## E — TV3: Order staff-context, ưu tiên đầu

**Interface consumer:** `backend/staff-service/docs/order-service-contract.md:33–53,112–116`, client `src/order-client.js:190–209`. Order `src/app.js:17–23` chưa expose context, chỉ assignment-transitions.

- GET `/internal/v1/bookings/:bookingId/staff-context`: Bearer service identity và `X-Actor-User-Id`.
- POST `/internal/v1/bookings/staff-context/batch`: Bearer service identity, `{bookingIds:string[],actorUserId:string}`. Ưu tiên GET; chưa nối batch vào UC9.
- DTO `BookingContext`: `{id,status,cancellationPending,history}`; status `PENDING|CONFIRMED|IN_PROGRESS|COMPLETED|CANCELLED`, cancellationPending `boolean|null`, history `[{at,label,by,note?}]`. IDs BIGINT string; ISO timestamp có timezone; không biến thiếu/null thành false hoặc mảng rỗng.
- TV3 chốt nguồn timeline/note; không xuất metadata nội bộ/PII người khác. Chưa có nguồn cancellationPending thì null.
- Quyền: actor phải có assignment thuộc booking, foreign/missing cùng 404. Batch cần quy tắc lỗi khi ID thiếu/trùng/ngoài scope.
- Acceptance: A/B/foreign404, multiemployee, null/empty, chronology/dedup, BIGINT/timezone/lỗi, client limit 1 MiB; hồi quy UC12. Thiếu context giữ warning `ORDER_HISTORY_UNAVAILABLE`, không timeline giả. Browser không gọi internal.

## C — TV1 User + TV4: hồ sơ

User `src/app.js:1` scaffold; session chỉ `user.id/EMPLOYEE/ACTIVE`. userId khác employeeId; ACTIVE khác readiness.

**Capability chưa duyệt URL/DTO:** GET hồ sơ mình; PATCH allowlist; avatar nếu được duyệt. Owner chốt version trước BFF.

- DTO cần xác nhận nguồn từng trường: userId, employeeId, tên, phone/liên hệ, avatar, branch, skills/certificates. Dữ liệu thiếu là null; không suy từ contact khách hàng hoặc legacy store.
- Chốt trường Staff tự sửa/quản lý sửa, validation, concurrency/version, lỗi; thay phone/password có invalidate phiên hay không do TV1 quyết định.
- Avatar cần storage/provider, MIME/size/quota, access/delete và retention; không báo upload thành công trước provider.
- Acceptance: A/B own-only/foreign404, allowlist/null/error/version conflict; fixture QA mới nếu ghi. Không đổi session/JWT schema chỉ để nhét profile.

## D — TV5 phối TV1/TV4: Notifications

Chưa có contract Notifications Staff trong source đã kiểm tra.

**Capability đề nghị, chưa duyệt method/URL/DTO:** list có phân trang; unread count; mark-one/read-all idempotent. DTO tối thiểu cần chốt notificationId, timestamp, category, title/body, readAt nullable và target/type/resourceId an toàn.

- List/count/read-state phải cùng scope theo user, thứ tự và semantics; lỗi không đổi thành unread0. Read-all cần cutoff/version để không nuốt sự kiện đến đồng thời.
- TV4/TV3 cung cấp sự kiện; TV5 chốt delivery/outbox/retry/dedup/retention. Frontend không tự sinh thông báo; pending ACK chưa xong.
- Deep link allowlist Staff; destination vẫn kiểm quyền object; nội dung hiển thị dạng text/HTML đã xử lý theo contract.
- Acceptance: A/B ownership, unread0/positive, nhiều trang, duplicate event, mark-read retry, read-all concurrent arrival, safe deep link và dependency outage.

## A — TV5 + business owner: Thu nhập

Payment `src/app.js:1` scaffold; Staff DTO chỉ có booking/service facts, không có income. Chi tiết endpoint/DTO và quyết định mở ở [đề xuất Thu nhập](STAFF_INCOME_ACCEPTANCE_CONTRACT_PROPOSAL.md); chưa được duyệt/triển khai.

Cần đủ: nguồn tiền và phiên bản công thức; điều kiện ghi nhận; gross/net/điều chỉnh; DECIMAL VND/rounding; kỳ chốt/chi trả; ledger/allocation/idempotency; aggregate ngày/tháng/nguồn/snapshot; bảng kê/chi trả và A/B. Phân biệt ghi nhận, đã trả cho cohort và dòng tiền theo ngày thực trả. Giá booking, DONE hoặc ngày hẹn không phải tiền công. Acceptance phải đối chiếu ledger/provider bằng fixture mới; không đơn thuần cộng một trang hoặc gọi request payment thành đã nhận tiền.

## F — TV4 + TV3: khu vực, ca, readiness

Staff router hiện chỉ jobs/schedule/detail/status; contact.address không phải vùng phục vụ, lịch assignment không phải ca rảnh.

**Capability đề nghị, chưa duyệt method/URL/DTO:** đọc vùng/chi nhánh được giao; đọc/đăng ký/sửa/hủy ca nếu nhóm cho phép; readiness riêng nếu được duyệt.

Cần area/branch IDs+labels/quyền; tách ca rảnh/ca đăng ký/assignment; version/conflict/UTC+7. Race do Backend transaction/CAS xử lý. ACTIVE không phải readiness; bản đồ cần duyệt riêng. Acceptance A/B/empty/overlap/concurrency/timezone, fixture mới nếu ghi.

## G — TV5 Review/Report + TV4/business: thành tích

Review `src/app.js:1` scaffold. Giữ thống kê 4C: current-status assignment có lịch hẹn giao khoảng truy vấn, pagination.total độc lập; DONE không có nghĩa hoàn thành trong kỳ.

Cần contract review read/aggregate/pagination, nguồn author/booking/assignment, publish/attribution nhiều nhân viên/quyền/correction. KPI cần tên/công thức/mẫu số/kỳ/basis/timezone/version, cách xử lý thiếu dữ liệu/hủy/đổi người/khiếu nại. Snapshot/version nếu cần ghép tổng nhất quán. Thưởng phải qua TV5 ledger, không tự tạo rank/badge/bonus. Acceptance đối chiếu nguồn và quyền A/B; không lấy số hàng một trang làm tổng.

## H — nhóm/TV5/TV1: hỗ trợ và tài khoản

- Nhóm cung cấp kênh/contactURL/phone/email/FAQ chính thức đã duyệt. Ticket/chat cần owner, người nhận, SLA, privacy/attachments/retention/state transitions rồi contract API; chỉ success sau provider xác nhận.
- Auth `src/app.js:67–79` chưa có password/device/session-management. TV1 chốt verification/recovery/invalidation/rate limit/audit và method/URL/DTO trước BFF.
- Motion/focus dùng chung theo trình duyệt, không account-sync hoặc lưu secret. FAQ/contact tĩnh đã duyệt có thể làm độc lập.
- Acceptance: kênh thật, ticket retry/idempotency/ownership; account settings validation và revoke-session semantics do TV1 xác nhận. Không nút thao tác giả.

## Điều kiện nhận bàn giao và kiểm chứng

Owner bàn giao contract/version đã duyệt, provider chạy thật, quyền/lỗi/pagination/timezone và fixture mới. Staff chỉ mapping Frontend/BFF; không sửa service khác. Kiểm tra unit/contract/integration đúng layer, typecheck/build1worker, Chrome375/390/768/1440/A-B; thiếu contract/fixture ghi BLOCKED/NOT_RUN.

Giữ Auth/Refresh, UC9–UC12, checkpoints và Git gốc; không commit/push/merge/MySQL/.env/QA write. Không replay Q01–Q06 hoặc tác động booking9109131/9109141. Shared-slot trong tài liệu cũ chỉ là phương án tương lai; mô hình hiện tại đã chốt phân công đích danh.