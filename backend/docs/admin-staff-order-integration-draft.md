# Contract Admin/Staff và báo cáo trạng thái đơn dịch vụ

**Trạng thái:** APPROVED cho phạm vi triển khai local; API chỉ được gọi `VERIFIED` sau kiểm thử HTTP/MySQL  
**Phê duyệt:** Chủ nhiệm xác nhận contract này ngày 09/11/2026 sau khi xác nhận owner liên quan đã duyệt. Migration được phép chuẩn bị nhưng không được tự chạy trên CSDL.  
**Phạm vi:** đồng bộ đơn dịch vụ giữa Customer, Admin và Staff; báo cáo chỉ gồm đơn dịch vụ. Chức năng mua sản phẩm vẫn được giữ, nhưng nằm ngoài báo cáo này.  
**Môi trường mục tiêu:** local. Không bao gồm thanh toán thật, triển khai production hoặc tự áp dụng migration CSDL.

## 1. Hiện trạng đã kiểm tra

- Admin đã có báo cáo số đơn theo trạng thái, lọc ngày tạo và xuất CSV; báo cáo trạng thái dịch vụ đã được nối API/MySQL. Các báo cáo Admin khác vẫn là state demo trên trình duyệt.
- Staff job list/detail đã đọc đơn được giao từ backend; dashboard/calendar/profile Staff và các màn hình Admin ngoài báo cáo vẫn dùng state demo.
- Gateway khai báo API Customer và báo cáo Admin; Order API công khai còn xác thực Customer cho các luồng đơn hàng khác.
- Staff đã có code API danh sách/chi tiết công việc theo employee identity và API chuyển trạng thái. Mutation dùng journal 005, nhưng fail-closed khi schema chưa sẵn sàng; chưa có kiểm thử HTTP/MySQL thật.
- Trạng thái đơn hiện có: `pending`, `confirmed`, `in_progress`, `completed`, `cancelled`.
- Trạng thái công việc hiện có ở UI: `waiting`, `accepted`, `in_progress`, `done`. Đây là trạng thái assignment, không được thay thế trạng thái đơn.

Các endpoint bên dưới là contract đã duyệt để triển khai trong phạm vi trên. Chưa được quảng bá là tích hợp `VERIFIED` trước khi provider/consumer test trên môi trường local.

## 2. Nguyên tắc hợp đồng

1. Order là nguồn sự thật cho booking, trạng thái đơn và lịch sử trạng thái. Staff sở hữu quy trình nhận/bắt đầu/hoàn thành assignment. Admin tiêu thụ dữ liệu đơn và điều phối theo quyền được duyệt.
2. Frontend không đọc MySQL trực tiếp; Gateway định tuyến tới service theo contract.
3. Admin/Staff lấy danh tính từ phiên được server xác thực. Không tin `role`, `staffId`, `customerId`, trạng thái hoặc giá do trình duyệt gửi.
4. Staff chỉ xem và cập nhật assignment thuộc chính nhân viên đã xác thực.
5. Không đánh dấu đơn `completed` cho đến khi mọi assignment bắt buộc hoàn thành.
6. Nếu đơn có yêu cầu hủy đang chờ duyệt, không cho bắt đầu assignment. Quyết định hủy và bắt đầu việc phải được xử lý nguyên tử hoặc có cơ chế phối hợp/recovery được hai owner Order và Staff duyệt.
7. Journal chuyển trạng thái dùng migration additive 005 đã được duyệt để chuẩn bị. Migration chưa chạy; endpoint ghi từ chối an toàn cho đến khi owner tự áp dụng và kiểm tra schema.

## 3. API public đề xuất

Base path: `/api/v1`.

### 3.1 Admin — báo cáo trạng thái đơn dịch vụ

`GET /api/v1/admin/reports/service-orders`

Query:

| Trường | Kiểu | Quy tắc |
|---|---|---|
| `from` | `YYYY-MM-DD` | Tùy chọn; ngày bắt đầu theo giờ Việt Nam |
| `to` | `YYYY-MM-DD` | Tùy chọn; phải lớn hơn hoặc bằng `from` |
| `status` | enum trạng thái đơn | Tùy chọn |

Response đề xuất:

```json
{
  "data": {
    "from": "2026-11-01",
    "to": "2026-11-30",
    "generatedAt": "2026-12-01T02:00:00.000Z",
    "total": 12,
    "statusCounts": {
      "pending": 2,
      "confirmed": 3,
      "in_progress": 1,
      "completed": 5,
      "cancelled": 1
    }
  }
}
```

Quy tắc tính đề xuất:

- Khoảng ngày lọc theo `createdAt` của đơn, gồm cả hai ngày; thời gian được quy đổi theo `Asia/Ho_Chi_Minh`.
- `statusCounts` là trạng thái hiện tại của những đơn được tạo trong khoảng đó, không phải số lần chuyển trạng thái trong khoảng.
- Tổng các số trong `statusCounts` phải bằng `total`.
- Endpoint chỉ trả aggregate, không trả tên, số điện thoại, địa chỉ hoặc ghi chú khách hàng.
- Trạng thái cũ/mới phải được thể hiện nhất quán trong giao diện và CSV; lỗi tải báo rõ, không thay bằng số liệu demo.

Owner cần chốt liệu báo cáo có cần thêm lọc theo ngày lịch thực hiện, chi nhánh, dịch vụ hoặc lịch sử chuyển trạng thái hay không. Không tự gộp các định nghĩa ngày này.

### 3.2 Admin — tra cứu đơn dịch vụ

`GET /api/v1/admin/service-orders?status=&from=&to=&page=1&pageSize=20`

- Chỉ Admin được truy cập; mặc định sắp xếp `createdAt` mới nhất trước.
- `pageSize` mặc định 20, tối đa 100. Trường sort nếu được bổ sung phải whitelist.
- Response gồm `items`, `total`, `page`, `pageSize`; DTO chỉ trả dữ liệu cần cho quản trị và không trả credential/token.
- Quyền xem chi tiết và các hành động quản trị phải được chốt theo Use Case Admin hiện hành.

### 3.3 Staff — danh sách và chi tiết công việc được giao

`GET /api/v1/staff/jobs?from=&to=&status=&page=1&pageSize=20&q=&sort=schedule-asc`  
`GET /api/v1/staff/jobs/:bookingId`

- Chỉ nhân viên đã xác thực được truy cập.
- Server tự lấy employee identity từ principal và chỉ trả assignment thuộc nhân viên đó; không nhận `staffId` từ query/body.
- Trạng thái đơn và trạng thái công việc được trả thành hai trường riêng (`orderStatus`, `jobStatus`).
- DTO trả tên, điện thoại, địa chỉ thực hiện, dịch vụ, lịch và ghi chú khách hàng; không trả giá, thanh toán, mã khách hàng hay chi tiết hồ sơ nhà.

### 3.4 Staff — chuyển trạng thái công việc

`POST /api/v1/staff/jobs/:bookingId/transitions`

```json
{
  "operationId": "UUID",
  "nextStatus": "accepted"
}
```

- Cho phép lần lượt `waiting -> accepted -> in_progress -> done`; không bỏ bước, không lặp mutation khi retry cùng `operationId`.
- Server xác minh assignment thuộc nhân viên hiện tại.
- Khi thành công, response trả trạng thái công việc và trạng thái đơn đã được Order xác nhận.
- `in_progress` bị từ chối nếu đơn đã hủy hoặc có yêu cầu hủy đang chờ duyệt.
- Chuyển `done` chỉ làm đơn thành `completed` khi quy tắc assignment của đơn xác nhận mọi nhân viên bắt buộc đã hoàn thành.
- Mutation dùng `operationId` và journal 005. Order khóa booking để loại trừ race với yêu cầu hủy, cập nhật history cùng transaction, rồi Staff hoàn tất assignment; retry cùng key phục hồi nếu response bị mất. Đây là recovery xuyên service, không phải transaction phân tán nguyên tử; lỗi không xác định giữ operation pending để retry.

## 4. Xác thực, lỗi và thời gian

- Auth có code nhận diện role `CUSTOMER`/`EMPLOYEE`/`ADMIN`, xác thực portal và kiểm tra session qua introspection; chưa kiểm thử HTTP end-to-end. Gateway/service giới hạn origin theo Customer/Staff/Admin; API nội bộ dùng caller token. Môi trường production và session đa instance ngoài phạm vi.
- Lỗi dùng envelope hiện có của service: `{ "error": { "code": "...", "message": "..." }, "requestId": "..." }`.
- Dự kiến `400` input/filter không hợp lệ, `401` chưa xác thực, `403` sai vai trò, `404` không tồn tại/không thuộc quyền xem, `409` xung đột trạng thái hoặc operation key, `503` dependency chưa sẵn sàng.
- Timestamp response dùng ISO 8601 UTC; frontend hiển thị giờ Việt Nam. Ngày lọc phải được định nghĩa rõ như ở mục báo cáo.
- API không trả stack trace, SQL, token hay credential; mutation có giới hạn request và kiểm tra `Origin` theo cơ chế chung đã duyệt.

## 5. Owner và phần cần duyệt

| Phần | Provider/owner cần duyệt | Consumer/reviewer cần duyệt |
|---|---|---|
| Booking, trạng thái đơn, query/report | Order / Customer (Thưởng) | Admin (Trung), Staff (Tùng) |
| Assignment, danh sách việc, chuyển trạng thái | Staff (Tùng) | Order (Thưởng), Admin (Trung) |
| Dashboard/report và màn hình Admin | Admin (Trung) | Order (Thưởng), Staff (Tùng) nếu dùng trạng thái assignment |
| Auth, role, session và Gateway route | Owner Auth/Gateway được nhóm chỉ định | Admin (Trung), Staff (Tùng), Order (Thưởng) |
| Quy tắc ngày, chi nhánh, quyền dữ liệu cá nhân | Các owner nghiệp vụ liên quan | Chủ nhiệm/nhóm |

Contract đã được duyệt cho phạm vi triển khai local. Đăng nhập Staff/Admin, báo cáo Admin, Staff jobs API/UI và mutation journal có code; chưa được kiểm chứng HTTP/MySQL end-to-end. Migration 005 và script provisioning Admin chỉ được chuẩn bị, chưa chạy. Dashboard/calendar/profile Staff, Admin screens ngoài báo cáo, kiểm thử liên service và browser E2E còn thiếu. Triển khai theo thứ tự provider → contract tests → consumer → kiểm thử liên service. Chỉ ghi `VERIFIED` khi có kết quả HTTP/MySQL trên môi trường local được nêu rõ. Tài khoản ADMIN phải được owner tạo riêng; không thêm tài khoản/mật khẩu mặc định và không chạy provisioning tự động.

## 6. Tiêu chí nghiệm thu dự kiến

- Báo cáo Admin lấy dữ liệu từ API/DB, không âm thầm dùng localStorage/demo khi API lỗi.
- Bộ lọc ngày và trạng thái cho kết quả có thể đối chiếu với danh sách đơn; tổng theo trạng thái bằng tổng đơn.
- Staff chỉ đọc/cập nhật assignment của chính mình; thử ID assignment của người khác không lộ dữ liệu.
- Admin, Staff và Customer nhìn thấy cùng trạng thái đơn sau khi làm mới; trạng thái công việc vẫn tách riêng.
- Gửi lại cùng thao tác sau timeout không tạo chuyển trạng thái trùng; thao tác cạnh tranh hủy/bắt đầu không thể cùng thành công sai nghiệp vụ.
- Regression giữ nguyên luồng Customer, sản phẩm, thanh toán mô phỏng và đánh giá.
- Local runbook mô tả đúng tiến trình/cấu hình cần chạy; không chứa secret và không chạy migration/seed tự động.

## 7. Ngoài phạm vi bản nháp

- Báo cáo đơn mua sản phẩm, thanh toán ngân hàng thật, giao hàng và hoàn tiền.
- Tự áp dụng migration 005, seed/reset dữ liệu hoặc loại bỏ bất kỳ bảng nào.
- Production deployment, multi-instance session store, backup/restore automation và observability production.
