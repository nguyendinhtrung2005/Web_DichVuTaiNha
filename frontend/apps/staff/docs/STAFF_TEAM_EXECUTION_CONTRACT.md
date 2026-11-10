> Current Staff handoff: new IN_PROGRESS/DONE commands remain blocked with 409 STAFFING_POLICY_REQUIRED until Order supplies an approved authoritative policy. Earlier acceptance sections below are historical; see STAFF_ORDER_STAFFING_CONTRACT_PROPOSAL.md and STAFF_PR_UPDATE_20261110.md for current limits.

# Đội thực hiện — triển khai Staff và contract cần phê duyệt

> Cập nhật 10/11/2026: yêu cầu mới bắt buộc chặn bắt đầu/hoàn thành khi chưa có policy nhân sự chính thức. Staff BFF và Staff OrderClient nay từ chối command mới IN_PROGRESS/DONE với `409 STAFFING_POLICY_REQUIRED`; giữ tiếp nhận và recovery các receipt cũ. Các mô tả bên dưới về giữ nguyên luồng cá nhân là bằng chứng lịch sử, không phải quyền hiện hành. Xem `STAFF_PRACTICAL_READINESS.md` để biết phạm vi và blocker Order/Admin/Customer; không coi rào chắn Staff là đã sửa FSM toàn hệ thống.

## Phạm vi đã triển khai

`GET /api/v1/staff/me/jobs/:assignmentId` bổ sung `data.team` tùy chọn. Staff xác thực nhân viên ACTIVE và quyền sở hữu assignment trước khi đọc các phân công cùng booking. SQL kiểm tra lại employee/assignment/booking trong cùng truy vấn; chỉ SELECT, giới hạn 501 hàng và từ chối summary vượt 500. Lỗi đọc đội trả `team:null, teamError:"TEAM_READ_UNAVAILABLE"`, không làm mất chi tiết công việc còn hợp lệ.

Staff BFF vẫn dùng `GET /api/staff/jobs/:assignmentId`, cùng session, timeout, giới hạn response và bảo vệ same-origin hiện có. Không thêm endpoint ghi. Cả BFF và trình duyệt dùng allowlist DTO chung, xác minh booking/assignment, trạng thái của người xem và bỏ field ngoài contract.

DTO hiện có:

```json
{
  "version": 1,
  "bookingId": "<booking-id>",
  "assignmentId": "<own-assignment-id>",
  "requiredStaffCount": null,
  "packageName": null,
  "counts": { "assigned": 2, "accepted": 1, "started": 0, "completed": 0, "cancelled": 0 },
  "issues": { "duplicateEmployees": false, "inactiveMembers": false },
  "memberVisibility": "SELF_ONLY",
  "members": [{ "assignmentId": "<own-assignment-id>", "displayName": null, "status": "ACCEPTED", "isSelf": true }],
  "policy": {
    "source": "NOT_CONFIGURED", "version": null, "enforced": false,
    "canStart": null, "canCompleteBooking": null, "blockingReason": "TEAM_POLICY_UNCONFIRMED"
  }
}
```

Các con số trên chỉ minh họa cấu trúc, không phải dữ liệu production. `requiredStaffCount` và `packageName` hiện luôn null vì schema/Order chưa cung cấp. Không thêm biến môi trường để tự gán số người.

Định nghĩa đếm:

- `assigned`: số employee khác nhau có assignment không CANCELLED.
- `accepted`: các employee đó đã ACCEPTED, IN_PROGRESS hoặc DONE.
- `started`: các employee đó IN_PROGRESS hoặc DONE.
- `completed`: các employee đó DONE. Với nhiều assignment hiệu lực cùng employee, lấy bước thấp nhất và bật cảnh báo trùng; không đếm người đó hai lần.
- `cancelled`: số employee khác nhau có assignment CANCELLED, có thể có lịch sử đã được phân công lại. Không tự suy ra mọi CANCELLED đều cần thay người.
- Tài khoản/nhân viên không ACTIVE hoặc role không phải nhân viên được gắn cờ; các số vẫn là quan sát phân công, không phải quyền bắt đầu.

Chưa được phép công khai danh tính đồng đội nên chỉ trả entry của chính người xem; không trả employee/user ID, điện thoại hoặc tên đồng đội. UI không dùng ID của đồng đội để điều hướng sang chi tiết ngoài quyền.

## BLOCKED: Order phải thực thi điều kiện đủ đội

Owner Order/Customer/Admin cần phê duyệt:

1. Nguồn snapshot `required_staff_count` theo booking, nguồn gói và phiên bản chính sách. Đề xuất nhỏ/tiêu chuẩn/lớn = 1/2/3 chưa phải chính sách chính thức. Không suy ra từ `booking_items.quantity` hoặc tên dịch vụ.
2. Chính sách booking cũ không có snapshot: giữ trạng thái chưa xác nhận; backfill, chặn hay ngoại lệ phải có quyết định riêng. Lượt này không đổi FSM cũ hoặc mặc định mọi booking là một người.
3. Quy tắc đủ người để bắt đầu: số employee hiệu lực khác nhau đạt yêu cầu, đủ người đã tiếp nhận, không có phân công trùng/nhân viên không hoạt động hoặc yêu cầu thay người chưa xử lý. Xác định có cần mọi người trong roster hay chỉ nhóm bắt buộc.
4. Quy tắc hoàn thành: số người hợp lệ đạt yêu cầu, mọi assignment hiệu lực trong nhóm phải DONE, không còn vị trí bắt buộc cần thay. CANCELLED không đạt điều kiện DONE và không làm giảm số người bắt buộc.
5. Điều kiện bằng chứng nhận việc/hoàn thành và thời lượng. FSM hiện cho phép các bước cùng giây; chưa có chính sách bằng chứng hoặc thời lượng tối thiểu. Không tự đặt số phút trong Staff.

Đề xuất Order cung cấp `GET /internal/v1/bookings/:bookingId/staffing` cho service đã xác thực, được giới hạn theo assignment/actor hiện tại. Cần trả snapshot yêu cầu, `rosterVersion`, `asOf`, policy version, khả năng bắt đầu/hoàn thành và lý do chặn; Order phải tính lại ngay trong transaction ghi, không tin counts/permission từ browser.

Sau khi endpoint và chính sách được duyệt, adapter Staff mới được ánh xạ sang DTO hiện chuẩn bị: `policy.source="order-service"`, policy version thật, `enforced=true`, `canStart`/`canCompleteBooking` boolean và reason thuộc `INSUFFICIENT_STAFF`, `WAITING_ACCEPTANCE`, `REPLACEMENT_REQUIRED`, `DUPLICATE_ASSIGNMENTS` hoặc null. Parser không chấp nhận quyền bật từ counts hay policy chưa được thực thi. Các response này hiện chỉ xuất hiện trong test fixtures; chưa có adapter/endpoint Order chạy thật.

UI có sẵn trạng thái chờ tiếp nhận, thiếu người, sẵn sàng, đang thực hiện, cá nhân DONE chờ đồng đội và cần Admin; khi có policy hợp lệ nó khóa nút bắt đầu theo kết quả server. Đây không thay thế kiểm tra trong Order. Với dữ liệu hiện tại, luồng cũ vẫn được giữ và thẻ đội thông báo rõ chưa xác nhận yêu cầu; không tuyên bố đã chặn đủ đội.

`canCompleteBooking` chỉ là khả năng tại snapshot; UI chỉ hiển thị đơn hoàn thành khi trạng thái booking đọc lại là COMPLETED. Hoàn thành assignment không tự sửa booking trong Frontend.

## BLOCKED: phân công/thay người và check-in riêng

- Admin cần endpoint có quyền phân công/thay người, validation nhân viên ACTIVE, tránh trùng lịch, chống trùng nhân viên hiệu lực, idempotency và audit. Staff không có quyền thay roster, hủy đồng đội hoặc giảm yêu cầu.
- Cần định nghĩa đề nghị từ chối/báo vắng và quyền phê duyệt; hiện không có nút báo thành công hoặc endpoint giả.
- Cần owner duyệt ràng buộc uniqueness của phân công hiệu lực; không áp dụng UNIQUE toàn lịch sử nếu có nghiệp vụ phân công lại cùng người.
- Thay roster và FSM phải có cơ chế đồng thời nhất quán, version/precondition và lock ordering tương thích với Staff giữ assignment lock khi gọi Order. Không tự thêm transaction khóa ngược thứ tự gây deadlock.
- Check-in cá nhân hiện gắn với bước IN_PROGRESS. Chỉ tách check-in/khởi động chung khi Order/Staff có contract và trạng thái lưu phù hợp.
- Journal Order/Staff, replay cùng operation, ACK và phục hồi commit lỗi vẫn giữ nguyên. Production cần quy trình reconciliation; không tự bật worker hoặc session renewal trong QA.

## Thu nhập và thành tích

Không đổi công thức DEMO_V2, chính sách trả lương, bảng thanh toán hoặc cách tính chỉ số hiện hành. Request lặp dùng cùng assignment/operation vẫn có bảo vệ idempotency hiện có. B chưa DONE không được tính công dù A cùng booking đã DONE.

Phân công trùng employee/booking với ID khác nhau vẫn là rủi ro dữ liệu của income/performance hiện tại. Thẻ đội phát hiện và không đếm trùng người, nhưng không tự sửa các assignment hoặc diễn giải lại tiền công. Chặn tạo trùng tại Admin/Order và chính sách xử lý lịch sử là blocker riêng; không được coi cảnh báo UI là đã khắc phục ledger/thu nhập.

## Kiểm chứng và giới hạn

- `npm run test:team` tại Staff Frontend: parser/BFF/UI, 1/2/3 người, thiếu requirement, A DONE/B chưa DONE, chờ tiếp nhận, thiếu người, CANCELLED, duplicate, quyền A/B và hồi quy UC10/UC12.
- `test/team.test.js` trong Staff Backend: summary từ rows, SQL có binding ownership, không lộ danh tính đồng đội, lỗi/giới hạn và HTTP A/B bằng doubles.
- Test Order hiện có chỉ chứng minh FSM hiện hành, bao gồm hành vi bỏ qua CANCELLED. Không đổi assertion để giả chứng minh quy tắc đủ số người đã đạt.
- Chrome thật với QA độc lập kiểm tra summary đọc từ DB và trạng thái chưa xác nhận; các kịch bản đội 2/3 dùng response doubles có nhãn MOCK_PASS, không seed hay mutation MySQL.
- Không đánh dấu REAL_PASS cho chặn bắt đầu/hoàn thành chung, từ chối/báo vắng, thay người hoặc check-in riêng khi thiếu API/chính sách của owner.

## Danh sách 20 tệp triển khai ở lượt đầu

- `backend/staff-service/`: `package.json`, `src/job-service.js`, `src/repository.js`, `src/team-summary.js`, `test/team.test.js`.
- `frontend/apps/staff/`: `package.json`, `app/globals.css`, `lib/server/job-detail-contract.mjs`, `test/job-detail-ui.test.mjs`, `test/team.test.mjs`, `docs/STAFF_TEAM_EXECUTION_CONTRACT.md`.
- `frontend/packages/ui/src/components/staff/`: `staff-job-detail-remote-model.ts`, `staff-job-detail-remote.tsx`, `staff-job-status.tsx`, `staff-job-team.tsx`, `staff-team-contract.mjs`, `staff-team-model.ts`.
- `qa/staff/`: `README.md`, `runtime.mjs`, `team.browser.mjs`.

Nghiệm thu QA 09/11/2026: Frontend/BFF 131/131 unit PASS, Backend/FSM 192/192 unit PASS, typecheck và Webpack PASS; Chrome 3 nhóm REAL_PASS + 2 nhóm MOCK_PASS. Một lần unit deadline 200 ms khi chạy song song build đã được lưu bằng chứng; chạy riêng lại PASS, không tăng timeout. Kiểm tra checksum cả 15 bảng xác nhận dữ liệu không đổi. Không chạy mutation/seed hoặc Groq. Luồng đủ đội ở Order vẫn BLOCKED như trên.

## Bổ sung trong phạm vi Frontend Staff

Lượt tiếp theo chỉ sửa Frontend/BFF và QA; không sửa tiếp Backend Staff/Order. Thẻ đội hiển thị mã booking/dịch vụ từ chi tiết có sẵn; giữ nguyên luồng cá nhân khi thiếu yêu cầu nhân sự. Trạng thái đội đang làm hoặc cá nhân DONE được hiển thị từ dữ liệu quan sát, độc lập với quyền bắt đầu theo policy. Khi mọi người đã DONE nhưng booking chưa COMPLETED, giao diện chờ xác nhận hệ thống, không tự hoàn thành đơn.

`staffTeamProgress` là projection Frontend, không phải field mới của API: `requiredStaffCount` lấy nguyên từ DTO; `assignedCount`, `acceptedCount`, `completedCount` từ các counts tương ứng; `inProgressCount = counts.started - counts.completed` vì started của Staff là số tích lũy; `teamStatus` chỉ là khóa trình bày UI. Không có team thì các số là null, không giả thành 0 hoặc 1. Không suy trạng thái sẵn sàng từ số đếm khi policy chưa được Order thực thi.

BFF chỉ diễn giải các reason đã có trong `OrderClient`: `INVALID_TRANSITION`, `BOOKING_CANCELLED`, `BOOKING_COMPLETED`, `BOOKING_NOT_CONFIRMED`, `CANCELLATION_PENDING`, `ASSIGNMENT_NOT_ACTIVE`, `STALE_ASSIGNMENT`, `IDEMPOTENCY_CONFLICT`, `OPERATION_CONFLICT`. Reason lạ giữ lỗi chung, không lộ message/details thô và không giả có kiểm tra đủ đội.

Thu nhập có thông báo các booking có nhiều assignment ID khác nhau trong kỳ của tài khoản đang xem. Đây là dữ liệu cần đối chiếu, chưa đủ để kết luận trùng nghiệp vụ. Regression dùng `StaffIncomeService` thật với repository double chứng minh 2 ID vẫn có 2 dòng/120.000đ DEMO và chỉ số 2 phân công; không gộp, khấu trừ, sửa lịch sử hay thay công thức. Nhãn DEMO_V2 nằm trong chi tiết cách tính; không có tiền đã thanh toán. Việc ngăn tạo trùng và xử lý tiền công lịch sử vẫn BLOCKED chờ owner.

QA Chrome bổ sung thao tác hoàn thành được mock hoàn toàn tại interception trước mạng: kiểm tra loading, chống gửi lặp, mã thao tác và GET lại chi tiết, booking vẫn IN_PROGRESS khi đồng đội chưa xong. Ngoài login/logout, mọi mutation thật đều bị chặn. Cảnh báo thu nhập được thử bằng bản sao response DEMO trong trình duyệt, không đổi response server hay database.

Tệp sửa ở lượt chỉ Frontend/QA (16):

- `frontend/apps/staff/`: `app/globals.css`, `package.json`, `lib/server/status-core.mjs`, `test/status-core.test.mjs`, `test/status-ui.test.mjs`, `test/team.test.mjs`, `test/income-remote-ui.test.mjs`, `docs/STAFF_TEAM_EXECUTION_CONTRACT.md`.
- `frontend/packages/ui/src/components/staff/`: `staff-job-detail-remote.tsx`, `staff-job-status-model.ts`, `staff-job-team.tsx`, `staff-team-model.ts`, `staff-income-remote-model.ts`, `staff-income-remote.tsx`.
- `qa/staff/`: `README.md`, `team.browser.mjs`.

Nghiệm thu bổ sung 09/11/2026: `npm run test:team` 145/145 PASS; typecheck và Webpack PASS. Chrome 8/8 nhóm PASS (4 REAL_PASS đọc API, responsive/keyboard, A/B/F5 và smoke các trang; 4 MOCK_PASS cho policy tương lai, submit chống lặp/refetch, lỗi/retry và cảnh báo thu nhập). Income được đọc qua API QA thật nhưng vẫn chỉ DEMO_PASS, không payout. Không gọi Groq hoặc gửi mutation nghiệp vụ đến Backend; checksum cả 15 bảng không đổi. Backend Staff/Order không sửa trong lượt này. Git nguồn 49 modified + 147 untracked, 0 staged; repo gốc và worktree PR giữ nguyên.
