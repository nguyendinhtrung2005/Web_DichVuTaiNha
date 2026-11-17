# Đề xuất contract đội thực hiện — cần Order/Admin phê duyệt

Trạng thái: **PROPOSAL, chưa được triển khai hoặc phê duyệt**. Người nhận: Trung/Order/Admin và người phụ trách Customer. Không chạy SQL/migration từ tài liệu này. Staff tiếp tục trả `409 STAFFING_POLICY_REQUIRED` cho command bắt đầu/hoàn thành mới đến khi cả contract, implementation và kiểm thử owner đạt yêu cầu.

## 1. Hiện trạng đã đối chiếu code

| Đường đi thực tế | Quyền / ghi dữ liệu hiện tại |
|---|---|
| BFF `PATCH /api/staff/jobs/:assignmentId/status` → `createStatusService.update` | Session Staff, origin, account binding, journal bền vững; command mới IN_PROGRESS/DONE bị chặn trước tạo journal. |
| Staff `PATCH /api/v1/staff/me/jobs/:assignmentId/status` → `StaffJobService.advance/performTransition` | Xác thực nhân viên, khóa assignment thuộc mình; chỉ assignments được cập nhật sau receipt Order. |
| Staff `OrderClient.applyAssignmentTransition` | Rào chắn thứ hai: không gửi PUT mới IN_PROGRESS/DONE khi Order chưa có staffing policy. Không có flag production để bỏ chặn. |
| Order `PUT /internal/v1/bookings/:bookingId/assignment-transitions/:operationId` | `OrderTransitionService.apply` → `transitionDecision` → `setBookingStatus` và journal. Đây là đường ghi booking hiện có trong source Order được kiểm tra. |
| Order GET cùng đường transition | Lookup receipt; không tạo transition. Vẫn chạy transaction/lock nội bộ theo repository. |
| Order POST `.../acknowledgement` | Xác minh Staff đã commit trạng thái/timestamp và đánh dấu journal đã ACK; hiện chưa có finalization barrier theo required staff count. |
| Staff `reconcile` / worker | Dùng lại `performTransition` và client Order; không có SQL tự hoàn thành booking. Trial đang tắt worker. |
| Order `GET /internal/v1/assignment-transitions/pending` | Chỉ liệt kê journal chưa ACK; không phải policy đủ đội. |

Order hiện lấy các assignment chưa CANCELLED rồi dùng `every(DONE)` trên trạng thái hiệu lực từ journal/assignment để quyết định COMPLETED. Không có requirement chính thức và không chờ đủ lượt tiếp nhận trước IN_PROGRESS. Vì receipt Order có thể được commit trước assignment Staff, không được coi booking COMPLETED là bằng chứng các dòng assignments đã cùng commit DONE.

Không thấy đường SQL cập nhật bookings khác trong **source Staff/Order đang xét**. Điều này không xác nhận Admin/Customer hoặc dịch vụ ngoài worktree không còn writer khác; owner phải liệt kê và bảo vệ chúng trước nghiệm thu.

## 2. Mô hình dữ liệu đề xuất, không phải schema đã có

| Thành phần / field | Kiểu đề xuất / ý nghĩa | Owner / migration phải duyệt |
|---|---|---|
| `bookings.minimum_staff_count` | Số nguyên dương do Order tính theo policy tại lúc xác nhận, NULL cho legacy chưa xác minh | Order; ngưỡng diện tích/dịch vụ do nhóm phê duyệt, không phải hằng số do Staff đặt |
| `bookings.required_staff_count` | Số nguyên dương khách đã chọn và xác nhận, **không nhỏ hơn minimum_staff_count**; có thể lớn hơn nếu policy cho phép. NULL cho legacy chưa xác minh | Order + Customer; **không backfill bằng COUNT(assignments) hoặc quantity** |
| `bookings.staffing_policy_version` | VARCHAR(32), nullable khi chưa xác nhận policy | Order |
| `bookings.staffing_input_snapshot` | Đầu vào đã chuẩn hóa và snapshot kết quả quote: dịch vụ, m² nếu áp dụng, độ phức tạp/điều kiện, minimum/required, version và quy tắc tổng hợp | Order; tên cột/kiểu lưu/FK/index là đề xuất cần owner duyệt migration |
| `bookings.staffing_revision` | BIGINT UNSIGNED, tăng khi đổi đội hoặc requirement | Order/Admin |
| `booking_staff_slots` (bảng mới đề xuất) | Booking, slot_no, current_assignment_id, employee_id, revision/timestamp | Order/Admin; cần duyệt quyền và FK sang assignments/employees |
| Slot uniqueness | UNIQUE(booking_id,slot_no), UNIQUE(current_assignment_id), UNIQUE(booking_id,employee_id) với NULL cho slot trống | Một người không thể lấp hai slot; giữ lịch sử assignment thay thế |
| Slot binding | FK/composite constraint hoặc kiểm tra cùng transaction để assignment/employee/booking khớp; hai field current_assignment_id và employee_id cùng NULL hoặc cùng có giá trị | Nếu composite FK thì cần unique index tương ứng trên assignments; chỉ owner mới được migration |

Số slot chính thức phải bằng required_staff_count, không dùng minimum_staff_count thay thế. Assignment cũ CANCELLED/thay thế còn trong lịch sử nhưng không lấp slot hiện hành. Không thêm trạng thái REJECTED/NO_SHOW vào enum/varchar hiện có khi chưa được duyệt. Requirement không tự giảm khi có người từ chối/vắng. Đổi requirement sau khi bắt đầu phải đi qua quy trình sửa hợp đồng riêng, không phải thao tác Staff.

### 2.1. Tính minimum và xác nhận lựa chọn của Customer — API mới đề xuất

**Chưa có trong source hoặc DB trial.** Không có ngưỡng m², mức giá hay phụ phí chính thức được đặt trong tài liệu này. Chủ nghiệp vụ/Order phải cung cấp bảng policy có hiệu lực; Customer không tự tính authoritative.

`POST /api/v1/bookings/staffing-quotes` (Order, Customer session): body allowlist `{items:[{serviceId,workAreaM2?,complexityCode?,conditionCodes?}],requestedStaffCount?}`. Diện tích dùng chuỗi decimal chuẩn, không số mũ; nullable chỉ khi loại dịch vụ cho phép không áp dụng. Không nhận minimum, policy version, employeeId hoặc giá do browser tự gán. `booking_items.quantity` vẫn là số lượng dịch vụ, không phải số người.

Response đề xuất: `{quoteId,expiresAt,policyVersion,minimumStaffCount,requiredStaffCount,maximumStaffCount?,inputSnapshotVersion,priceQuoteReference?}`. Mọi số người là số nguyên dương; required >= minimum và <= maximum khi có. Nếu chưa chọn tăng người, Order đề xuất required=minimum trong quote; chỉ trở thành requirement chính thức sau xác nhận. Quote ràng buộc với actor và hash đầu vào, TTL, revision/version; không dùng quote tài khoản khác hoặc input đã đổi. Giá, tiền phụ thu và tính lại giá do luồng giá Order phụ trách, không mặc định tăng người miễn phí hay tự nhân giá ở Staff.

Endpoint xác nhận booking hiện có **cần owner chỉ rõ đường dẫn/version thực tế** trước tích hợp: nhận quoteId + requestedStaffCount + Idempotency-Key; Order đọc lại policy/quote, validate nguyên tử và lưu minimum/required/version/input snapshot cùng booking. Không chỉ khóa input phía Customer. Nếu quote hết hạn/đổi đầu vào/đổi policy trước xác nhận, yêu cầu quote mới và khách xác nhận lại; không ghi đè snapshot booking lịch sử. Sửa yêu cầu booking đã xác nhận cần quy trình amendment/requote được owner duyệt, cập nhật revision và kiểm tra đội/giá trong transaction; không âm thầm backfill.

Booking nhiều dịch vụ: Order phải chọn và version quy tắc tổng hợp (cộng người, cực đại cho công việc tuần tự hoặc nguồn lực theo lịch chồng nhau). Đây là **quyết định còn thiếu**, không tự chọn `sum`/`max` ở Staff. Thiếu diện tích bắt buộc, service chưa có policy hoặc điều kiện đặc biệt chưa được hỗ trợ phải trả lỗi nghiệp vụ hoặc trạng thái cần người quản lý xác nhận, không đoán N để cho chạy.

| HTTP / mã đề xuất | Trường hợp |
|---|---|
| 422 STAFFING_INPUT_REQUIRED / STAFFING_INPUT_INVALID | Thiếu/sai dữ liệu bắt buộc; không dùng 0 hoặc quantity lấp vào |
| 422 STAFF_COUNT_BELOW_MINIMUM / STAFF_COUNT_ABOVE_MAXIMUM | Lựa chọn khách vượt phạm vi policy, server từ chối |
| 409 STAFFING_QUOTE_EXPIRED / STAFFING_QUOTE_CHANGED | TTL/revision/input đã thay đổi; không tự đổi đơn cũ |
| 409 STAFFING_MANUAL_REVIEW_REQUIRED | Không có quy tắc chính thức hoặc chưa chốt tổng hợp nhiều dịch vụ |

Customer: lấy quote/hiển thị min và lựa chọn tăng người. Order: validate và lưu snapshot. Admin: phân công đúng required distinct people/slot. Staff: đọc required đã xác nhận, hiển thị tiến độ và tuân quyền; không có API thì tiếp tục fail-closed. Ví dụ kiểm thử **không phải ngưỡng nghiệp vụ**: minimum=2, khách chọn required=4 thì phải có bốn người nhận và hoàn thành; tuyệt đối không giảm về hai.

## 3. Invariant nghiệp vụ

- `canStart=true` chỉ khi N đã biết, có đúng N slot hợp lệ, N nhân viên khác nhau đang có hiệu lực, và mọi slot đã tiếp nhận (ACCEPTED hoặc bước hợp lệ kế tiếp có chứng cứ journal). Nếu chỉ kiểm tra trạng thái đúng bằng ACCEPTED thì người thứ hai sẽ bị khóa sau khi người thứ nhất bắt đầu; phải dùng tiến độ tiếp nhận tích lũy hợp lệ.
- Chưa biết N, thiếu slot, trùng người, nhân viên inactive, slot bị hủy/thay thế hoặc còn chờ tiếp nhận: **không bắt đầu mới**.
- Mỗi nhân viên chỉ cập nhật assignment của chính mình. A DONE không đổi assignment B/C, không hoàn thành booking nếu còn slot chưa DONE.
- Booking chỉ COMPLETED khi tất cả N slot hiện hành có assignment đã commit DONE, timestamp hợp lệ và journal/ACK khớp; không dùng chỉ số quan sát hoặc receipt chưa đối soát để giả xác nhận commit.
- CANCELLED/vắng/từ chối không được xem là DONE. Một nhân viên DONE rồi nghỉ không được tự động thay thế để cộng thêm tiền công cho cùng phần việc; quy tắc này cần owner duyệt riêng.
- Khi N=1 cũng cần requirement chính thức; một assignment quan sát được không tự chứng minh đơn yêu cầu một người.

## 4. API đề xuất (chưa tồn tại)

`GET /internal/v1/bookings/:bookingId/staffing`, authenticated service token + `X-Actor-User-Id` từ JWT đã xác minh. Order xác nhận actor sở hữu assignment của booking. Staff không nhận employeeId/actor từ browser để chọn người.

Ví dụ **contract minh họa**, không phải dữ liệu QA hoặc response đã triển khai:

```json
{
  "version": 2,
  "bookingId": "101",
  "staffingRevision": "7",
  "requiredStaffCount": 3,
  "counts": {"assigned": 3, "accepted": 2, "started": 0, "completed": 0, "cancelled": 0},
  "policy": {
    "source": "ORDER_SERVICE",
    "version": "staffing-v1",
    "enforced": true,
    "canStart": false,
    "canCompleteBooking": false,
    "blockingReason": "WAITING_ACCEPTANCE"
  }
}
```

Counts lấy từ slot hiện hành, không cộng raw assignments trùng/thay thế. DTO theo người xem chỉ có assignment của mình, không mặc định công khai ID/tên/số điện thoại đồng đội. `staffingRevision` là chuỗi BIGINT; unknown requirement trả null + policy không khả dụng, không trả 0 hoặc tự đặt N.

Endpoint PUT transition hiện có giữ đủ 5 field body (`assignmentId`, `employeeId`, `actorUserId`, `fromStatus`, `toStatus`), operation ID/header trùng nhau. Bổ sung revision phải version API/DTO vì validator hiện từ chối field thừa. Ví dụ request v2 cần owner duyệt:

```json
{
  "assignmentId": "901", "employeeId": "501", "actorUserId": "201",
  "fromStatus": "ACCEPTED", "toStatus": "IN_PROGRESS", "expectedStaffingRevision": "7"
}
```

`POST /api/v1/staff/me/jobs/:assignmentId/exceptions` **đề xuất**: `{reasonCode:"DECLINED"|"UNAVAILABLE"|"ABSENCE", note?, expectedStaffingRevision}`. Note có giới hạn, không bắt gửi dữ liệu khách. Trả requestId + PENDING_ADMIN_REVIEW; không tự bỏ slot, đổi booking, cấp phép bắt đầu hoặc phân công người khác.

`POST /api/v1/admin/bookings/:bookingId/staffing/replacements` **đề xuất**: slotNo, oldAssignmentId, newEmployeeId, expectedStaffingRevision, reasonCode và Idempotency-Key. Chỉ Admin có scope chi nhánh; kiểm tra năng lực, trùng lịch/đội, tài khoản hiệu lực. Giữ assignment cũ và audit; tạo/bind assignment thay thế trong transaction, không sửa employee_id của assignment đã có journal.

| HTTP / mã đề xuất | Khi trả |
|---|---|
| 409 STAFFING_POLICY_REQUIRED | Chưa có N hoặc policy owner được phê duyệt |
| 409 INSUFFICIENT_STAFF | Slot chưa đủ người |
| 409 WAITING_ACCEPTANCE | Còn nhân viên chưa tiếp nhận |
| 409 DUPLICATE_ASSIGNMENTS | Một người/trạng thái assignment đang xung đột |
| 409 REPLACEMENT_REQUIRED | Có slot cần Admin xử lý |
| 409 STAFFING_REVISION_CONFLICT | Đội đã thay đổi từ lúc đọc |
| 409 IDEMPOTENCY_CONFLICT / OPERATION_CONFLICT | Key tái dùng sai payload; không tạo thao tác thứ hai |
| 404 JOB_NOT_FOUND / STALE_ASSIGNMENT | Không thuộc tài khoản hoặc assignment đã bị thay thế; không lộ dữ liệu người khác |
| 503 STAFFING_UNAVAILABLE / RECONCILIATION_REQUIRED | Thiếu dữ liệu tin cậy, dependency lỗi hoặc đang cần đối soát; không trả success giả |

Các mã mới cần Order và Staff thống nhất allowlist; hiện chỉ STAFFING_POLICY_REQUIRED là rào chắn Staff đã triển khai. Không gửi nguyên error/stack/details upstream tới browser.

## 5. Transaction và concurrency cần owner triển khai

**Phương án tương thích phân chia quyền hiện tại, đề xuất để duyệt:**

1. Order khóa booking + slot theo thứ tự ổn định, xác minh revision và actor, đọc trạng thái/journal phục vụ readiness. PUT DONE chỉ ghi receipt và giữ booking IN_PROGRESS, không hoàn thành dựa vào transition chưa được Staff commit.
2. Staff giữ cơ chế CAS assignment sở hữu, timestamp từ receipt, commit rồi mới ACK. Không giữ transaction mở trong lúc gọi ACK.
3. Trong ACK, Order khóa booking/slot, đọc lại **trạng thái committed** của các assignment hiện hành bằng consistent read READ COMMITTED; xác minh journal/timestamp và N distinct employee. Chỉ khi tất cả DONE hợp lệ mới cập nhật COMPLETED cùng transaction đánh dấu ACK.
4. Không thêm `FOR UPDATE` trên assignments trong Order khi Staff đang giữ assignment và chờ HTTP Order: sẽ tạo chu kỳ deadlock. Admin thay đội cũng phải theo lock booking/slot trước và không được có đường cập nhật assignment bên ngoài protocol.
5. Finalization phải dùng dữ liệu mới sau lock, không snapshot roster cũ. Nếu Admin/các writer có thể thay assignment mà không tuân lock booking/slot, phương án này **chưa đủ an toàn** và chưa được bỏ guard.
6. ACK mất mạng phải retry cùng operation ID; ACK đã ghi vẫn cần bảo đảm finalization không bị bỏ sót. Worker chỉ gọi cùng service/guard, không cập nhật booking trực tiếp. Key và snapshot receipt bất biến; không trả lại một occurrence time mới khi retry.

**Phương án v2 thay thế:** Order làm chủ ghi nguyên tử cả assignment + booking + journal trong một transaction, Staff chuyển sang proxy/read. Đây là thay đổi ownership/contract lớn cần owner Staff/Order duyệt đồng thời, không được tự làm ở Staff.

Cần chọn một phương án và chứng minh MySQL concurrency thật; không gọi hai transaction REST hiện hành là transaction phân tán nguyên tử. Cần thống nhất semantics ảnh chụp `orderAtTransition` bất biến và trạng thái booking hiện tại đọc qua GET.

## 6. Acceptance test bắt buộc trước bỏ guard

| Kịch bản | Kết quả cần chứng minh |
|---|---|
| N=1,2,3,4 chính thức | Đúng slot và distinct employee; không suy N từ quantity/roster |
| Minimum=2, khách chọn required=4; mới 3/4 nhận hoặc DONE | Chưa bắt đầu / chưa COMPLETED; không dùng minimum để bỏ qua người thứ tư |
| Khách chọn dưới minimum, quote khác actor/hết hạn, input/policy đổi | Server từ chối trước lưu; không ghi đè snapshot lịch sử |
| Nhiều dịch vụ chưa có quy tắc tổng hợp hoặc input bắt buộc thiếu | Lỗi nghiệp vụ/manual review; không tự sum/max hoặc đoán ngưỡng |
| A tiếp nhận, B/C chưa | A không thể bắt đầu; error ổn định |
| A/B tiếp nhận, C chưa | Chưa bắt đầu |
| Tất cả đã tiếp nhận | Từng người được bắt đầu trên assignment của mình |
| A DONE, B/C chưa; A/B DONE, C chưa | Booking còn IN_PROGRESS |
| Mọi slot DONE, timestamp/journal committed hợp lệ | Booking COMPLETED đúng một lần |
| CANCELLED/declined/absence | Không đủ đội; cần thay slot qua Admin |
| Thay người trùng nhân viên/khác booking/khác chi nhánh | Từ chối; không làm mất assignment cũ |
| Duplicate raw assignments cùng người | Không tăng counts; flag/quarantine để đối soát |
| A/B giả ID người khác | 404/403 an toàn, không cập nhật hoặc lộ peer identity |
| Hai người start/done đồng thời | Serialize policy/finalization; không sớm, không deadlock chéo service |
| Replay cùng key / hai key / response timeout | Một journal/receipt; không thực hiện lại hoặc bỏ qua xác minh |
| Staff commit lỗi sau Order receipt / ACK lỗi sau commit | Pending đối soát đúng; không hoàn thành sớm, worker không bypass |
| Admin thay người cùng lúc start/done | Revision conflict hoặc thứ tự lock hợp lệ; không mất slot |
| N null, legacy, snapshot lỗi, policy API timeout | Guard giữ khóa, không fallback sang số đếm |

Thu nhập vẫn dựa assignment DONE theo policy hiện hành; không suy bonus/KPI hoặc payout từ readiness. Chính sách xử lý assignment lịch sử trùng cần owner riêng, không gộp/khấu trừ dữ liệu ở Staff.
