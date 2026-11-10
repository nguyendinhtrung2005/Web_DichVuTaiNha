# Lịch khả dụng — trạng thái tích hợp

Đã dùng API đọc thật của Staff BFF `/api/staff/availability` và `/api/staff/branch`. Chi tiết ngày/khung giờ dùng chính dữ liệu đã tải, không lấy assignment thay thế lịch khả dụng. Khung giờ qua đêm xuất hiện trên mỗi ngày giao nhau; mốc kết thúc không bao gồm ngày tiếp theo nếu đúng 00:00.

Backend Staff hiện chỉ có GET availability. `StaffAreaService` chủ động để đăng ký/sửa/hủy BLOCKED đến khi duyệt chính sách và quyền Admin. BFF chỉ cho GET; không thêm route ghi hoặc migration trong thay đổi này.

Quyền hiện tại: middleware chỉ chấp nhận JWT có role EMPLOYEE/STAFF; hồ sơ nhân viên và user phải ACTIVE. Employee được lấy từ subject JWT, không từ query/body. Role ADMIN không được vào API Staff này và chưa có contract phê duyệt Admin trong phạm vi Staff. Không suy ra quyền duyệt từ role hoặc tự cấp quyền.

QA MySQL độc lập 3307 đã đối chiếu bằng transaction READ ONLY: chỉ có bảng `employee_availability` với `id`, `employee_id`, `starts_at`, `ends_at`, `status`. Chưa có bảng yêu cầu, phiên bản hoặc thông tin người duyệt; status khả dụng không phải trạng thái phê duyệt.

Giao diện cho chuẩn bị nội dung, kiểm tra và xem lại đăng ký/đổi/hủy. Gửi luôn bị khóa và không có thông báo thành công, lưu nháp, tạo PENDING hay đổi dữ liệu chính thức. Nháp mất khi đóng hộp thoại, đổi tuần, tải lại lịch, F5 hoặc đổi tài khoản.

## Admin cần xác nhận

- Người được duyệt: quản lý chi nhánh hay Admin; phạm vi nhân viên/chi nhánh và quyền tự duyệt.
- Hạn đăng ký/đổi/hủy, ca đang diễn ra/quá khứ, độ dài và độ chính xác giờ, ca qua đêm, hạn mức và lý do bắt buộc.
- Quy tắc xung đột giữa AVAILABLE, UNAVAILABLE, yêu cầu đang chờ và công việc đã nhận; hiệu lực khi duyệt và việc hủy yêu cầu khác với hủy ca đã duyệt.

## Backend cần xác nhận/cung cấp

- Contract được phê duyệt cho tạo/đọc/rút yêu cầu đăng ký, đổi, hủy; ID yêu cầu, ID khung giờ đích, khoảng UTC, lý do, trạng thái yêu cầu và kết quả/ghi chú duyệt. Endpoint `availability-requests` trong đề xuất cũ chưa phải API hoạt động.
- Tách `availability.status` khỏi trạng thái phê duyệt; xác định enum và chuyển trạng thái, không coi AVAILABLE là APPROVED.
- Lấy employee từ JWT; kiểm tra quyền sở hữu, chi nhánh và chống IDOR ở server. Client không chọn employee/branch để ghi.
- Validation giao dịch ở server: giờ Việt Nam/UTC, khoảng `[start,end)`, lịch khả dụng/công việc/yêu cầu liên quan trên mọi tuần; xử lý đồng thời, idempotency và bản ghi đã thay đổi; contract lỗi 400/401/403/404/409/429.

### Contract đề xuất để nhóm Backend/Admin duyệt — chưa phải API hoạt động

| Thao tác | Endpoint cần thống nhất | Quyền dự kiến cần phê duyệt |
| --- | --- | --- |
| Đọc yêu cầu của mình | `GET /api/v1/staff/me/availability-requests` | Nhân viên đọc dữ liệu của chính mình, phân trang, lọc thời gian/trạng thái. |
| Gửi đăng ký/đổi/hủy khung giờ | `POST /api/v1/staff/me/availability-requests` | Nhân viên chỉ tạo yêu cầu cho mình; chưa thay đổi ca chính thức khi mới gửi. |
| Rút yêu cầu chưa xử lý | `POST /api/v1/staff/me/availability-requests/:requestId/withdraw` | Chủ sở hữu, chỉ khi được phép theo trạng thái hiện tại; khác với yêu cầu hủy ca. |
| Danh sách/duyệt/từ chối | Nhóm Admin cung cấp contract riêng và phạm vi chi nhánh | Chưa được cấp cho API Staff; cần xác nhận người duyệt, khả năng tự duyệt và audit. |

DTO tạo đề xuất: `type` (REGISTER/CHANGE/CANCEL), ID khung giờ đích khi đổi/hủy, thời gian UTC cho đăng ký/đổi, lý do và version đích. Không nhận employeeId, userId, branchId, người duyệt hoặc trạng thái do browser chọn. Phản hồi phải có requestId, version, thời gian, type và trạng thái yêu cầu độc lập với availability. Phạm vi trường và enum chính thức cần Backend xác nhận.

Chuyển trạng thái đề xuất: PENDING → APPROVED / REJECTED / WITHDRAWN. Chỉ kết quả duyệt hợp lệ mới có thể cập nhật ca theo chính sách; không hiển thị PENDING hoặc APPROVED khi API chưa trả dữ liệu. API trả lỗi quyền sở hữu mà không lộ bản ghi tài khoản khác. Cần xử lý version cũ và quyết định duyệt đồng thời.

Server cần lưu `Idempotency-Key` theo actor/endpoint và hash nội dung, trả lại kết quả cũ cho cùng yêu cầu và từ chối khóa trùng có nội dung khác. Phải khóa/kiểm tra xung đột trong cùng transaction khi tạo hoặc duyệt; UI không đủ quyền quyết định trùng giờ trên toàn bộ lịch. TTL khóa, hạn gửi và giới hạn tần suất cần được duyệt trước triển khai ghi.

Kiểm tra ở UI hiện chỉ sơ bộ: giờ hợp lệ, tương lai, không trùng các bản ghi đã tải (kể cả UNAVAILABLE), đúng tài khoản/ID đích, lý do đổi/hủy 5–500 ký tự. Chặn xem lại nếu dữ liệu bị cắt 500 bản ghi hoặc khoảng nằm ngoài tuần đã tải. Đây không phải chính sách chính thức hay bằng chứng lịch công việc không xung đột; server phải kiểm tra lại khi có API ghi.

Kiểm thử: `npm run test:areas --workspace=@cleanhome/staff` tại `frontend/`. Chrome QA chỉ đọc: `RUN_STAFF_ISOLATED_AVAILABILITY_QA=true node qa/staff/availability.browser.mjs` (PowerShell dùng `$env:RUN_STAFF_ISOLATED_AVAILABILITY_QA='true'` trước lệnh Node). Không chạy seed hoặc POST nghiệp vụ.

Lần hoàn thiện bước 2 sửa lỗi focus đã tái hiện trên Chrome khi chuyển sang bản xem lại; bàn phím được đưa đến tiêu đề nội dung mới và quay về form vẫn giữ nội dung nháp. Lỗi giờ/lý do được liên kết bằng aria-describedby, kể cả trùng giờ. Các thao tác gửi/duyệt thực tế vẫn BLOCKED bởi contract và chính sách, không phải thiếu kết nối MySQL.

QA bước 2 ngày 06/11/2026 (UTC+7): unit 44/44 PASS; HTTP/BFF/Auth/MySQL chỉ đọc 11/11 REAL_PASS; Chrome 9/9 REAL_PASS cho lịch (375×812, 390×844, 768×1024, 1440×1000), TypeScript và Webpack PASS. Kiểm tra có fixture tương lai thật cho trùng giờ và bản xem lại đổi/hủy; không ghi fixture. Không có browser exception hoặc request ghi nghiệp vụ. Hash các bảng chi nhánh, nhân viên, lịch khả dụng, booking, assignment và lịch sử trạng thái giữ nguyên.

Map component vẫn giữ nguyên khi lịch loading/error/retry. Tải tile OSM trong lần Chrome cuối là BLOCKED_EXTERNAL_TILE_SOURCE do lỗi mạng, không coi dịch vụ tile đã PASS. Tạo/rút/duyệt/từ chối yêu cầu là NOT_RUN vì thiếu API và chính sách được duyệt. Đây là QA local, chưa phải nghiệm thu production.
