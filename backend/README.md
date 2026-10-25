# CleanHome backend

Backend API scaffold cho MySQL 8 và Node.js, gồm API Gateway cùng các service Auth, Order, Payment, Review, Service Catalog và Staff. Database `dich_vu_ve_sinh` trong `../databases/schema.sql` không bị thay đổi. API hiện chưa được nối với ba website frontend; frontend vẫn dùng dữ liệu local riêng theo từng website.

## Thiết lập cục bộ

Yêu cầu Node.js 22.9 trở lên và MySQL 8. Sao chép `.env.example` thành `.env`, sau đó tự cấu hình thông tin MySQL, `JWT_ISSUER`, `JWT_AUDIENCE`, public RSA key, đường dẫn tới private key chỉ Auth Service được đọc, token service-to-service cho introspection, các origin Customer/Staff/Admin và `DEFAULT_BRANCH_ID`. Giữ private key ngoài Git trong `.secrets/` hoặc vị trí an toàn khác; không dùng thông tin tài khoản thật hoặc khóa thật trong file mẫu.

Từ thư mục `backend`, chạy:

```powershell
npm.cmd install
npm.cmd test
npm.cmd run start:all
```

Gateway mặc định ở `http://127.0.0.1:4000`; các service chỉ bind loopback theo mặc định. Với container, đổi `SERVICE_HOST` và `GATEWAY_HOST` theo mạng triển khai, nhưng chỉ công khai Gateway và giới hạn truy cập trực tiếp các cổng service bằng cấu hình mạng/firewall.

## Migration MySQL

Không chạy migration trước khi xác minh database đang dùng đúng schema của `../databases/schema.sql`, sao lưu và thử trên bản sao. Migration `../databases/migrations/001_cleanhome_api_compatibility.sql` chỉ thêm cấu trúc/các nhóm danh mục cần cho API; không thay thế hay xóa bảng `reviews` cũ. Không có migration tự chạy khi khởi động service.

Chạy preflight trước. Nếu truy vấn sau trả về bất kỳ dòng nào, dừng và xử lý trùng payment theo nghiệp vụ trước khi chạy migration; migration tạo ràng buộc một payment cho mỗi booking:

```sql
SELECT booking_id, COUNT(*) AS payment_count
FROM dich_vu_ve_sinh.payments
WHERE booking_id IS NOT NULL
GROUP BY booking_id
HAVING COUNT(*) > 1;
```

Kiểm tra lại `users.phone`, danh mục hiện có, bảng/khóa ngoại của schema, số lượng nhánh ACTIVE và dữ liệu hiện tại. Đặt `DEFAULT_BRANCH_ID` thành ID của một nhánh ACTIVE. Nếu chưa có nhánh, không tạo dữ liệu nhánh giả: luồng đặt dịch vụ sẽ trả lỗi cấu hình cho đến khi quản trị viên thiết lập nhánh thật.

Các hàng danh mục hiện hữu được ánh xạ theo tên tiếng Việt/không dấu; những danh mục không nhận diện được giữ `slug` NULL. Bốn danh mục dịch vụ chuẩn được thêm nếu còn thiếu; không tự tạo dịch vụ hoặc tài khoản demo. Đơn cũ được gán `created_at` từ sự kiện trạng thái đầu tiên; nếu thiếu lịch sử trạng thái, thời điểm lịch hẹn được dùng làm mốc gần đúng vì schema cũ không lưu thời điểm tạo đơn.

Migration chứa DDL MySQL có implicit commit, nên không thể bảo đảm rollback bằng transaction. Cách khôi phục an toàn là phục hồi bản backup đã xác minh. Không xóa thủ công các cột/bảng bổ sung sau khi API đã ghi dữ liệu; việc đó làm mất yêu cầu hủy, lịch sử thanh toán và đánh giá mới.

## API chính

| Gateway route | Nghiệp vụ |
| --- | --- |
| `POST /api/v1/auth/login`, `POST /api/v1/auth/register`, `POST /api/v1/auth/logout`, `GET /api/v1/auth/me` | Auth bằng số điện thoại, phiên JWT RS256 trong cookie HTTP-only |
| `GET /.well-known/jwks.json`, `GET /api/v1/auth/introspect` | JWKS công khai; introspection yêu cầu `x-service-token` và nhận access token qua `Authorization: Bearer` |
| `GET /api/services`, `GET /api/services/:id`, `POST /api/services/:id/estimate` | Danh mục và ước tính dịch vụ |
| `POST /api/orders`, `GET /api/orders`, `GET /api/orders/:id` | Đặt và tra cứu đơn |
| `GET /api/history` | Lịch sử các đơn COMPLETED của khách đang đăng nhập |
| `POST /api/orders/:id/cancellation`, `PATCH /api/orders/:id/cancellation/decision` | Khách gửi và Admin xử lý yêu cầu hủy |
| `PATCH /api/orders/:id/confirm`, `POST /api/orders/:id/assignments`, `PATCH /api/orders/:id/job` | Xác nhận, phân công và cập nhật tiến độ |
| `POST /api/payments/orders/:id/payment`, `GET /api/payments/orders/:id/payment`, `POST /api/payments/:id/confirm` | Chọn phương thức, xem và Admin ghi nhận thanh toán |
| `POST /api/reviews/orders/:id/review`, `GET /api/reviews/orders/:id/review`, `GET /api/reviews` | Gửi/xem đánh giá, Admin xem và kiểm duyệt |
| `GET /api/staff/me`, `PATCH /api/staff/me`, `POST /api/staff/accounts` | Hồ sơ nhân viên và Admin tạo tài khoản |

Các API ghi nhận thanh toán chỉ lưu trạng thái nội bộ; không xác minh giao dịch ngân hàng hay thực hiện hoàn tiền. Lịch khách gửi là thời gian đề xuất, chưa phải khung giờ đã kiểm tra còn trống. Việc Admin duyệt hủy một đơn đã thanh toán chỉ đánh dấu cần xem xét hoàn tiền.

## Giới hạn triển khai hiện tại

- Cần có migration trên database và ít nhất một nhánh ACTIVE được cấu hình trước khi đặt đơn.
- Frontend demo hiện đăng nhập bằng email nhưng chưa nối API; contract Backend Auth dùng số điện thoại. Chốt thay đổi qua contract Auth–Frontend trước khi tích hợp.
- Thời lượng/giá được tính từ dữ liệu dịch vụ trong database. Mô hình đơn API hiện hỗ trợ một dịch vụ cho mỗi đơn.
- Đánh giá API lưu trong bảng `booking_reviews`; dữ liệu legacy trong `reviews` được giữ nguyên, không tự chuyển đổi vì bảng cũ bắt buộc nhân viên và có mô hình đánh giá khác.
- Không có cổng thanh toán, đồng bộ frontend, gửi thông báo, kiểm tra lịch rảnh tập trung hoặc xử lý hoàn tiền tự động.
