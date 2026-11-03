# Web_DichVuTaiNha

Ứng dụng dịch vụ tại nhà với một frontend React dùng chung cho khách hàng, nhân viên và quản trị viên. Frontend sử dụng giao diện CleanHome làm điểm xuất phát, giữ lại phong cách hình ảnh và luồng đặt lịch, đồng thời mở rộng danh mục sang sửa chữa, lắp đặt và điện lạnh.

## Chạy frontend

Yêu cầu Node.js 18 trở lên. Từ thư mục `frontend`, chạy:

```bash
npm install
npm run dev
```

Mở địa chỉ được Vite in ra trong terminal (mặc định `http://localhost:5173`).

### Tài khoản demo

| Vai trò | Email | Mật khẩu |
| --- | --- | --- |
| Khách hàng | `lan.nguyen@example.vn` | `KhachHang123` |
| Nhân viên | `hung.tran@cleanhome.vn` | `NhanVien123` |
| Quản trị viên | `admin@cleanhome.vn` | `QuanTri123` |

Có thể đăng ký tài khoản khách hàng demo mới. Phiên đăng nhập và các đơn demo được giữ trong Local Storage của trình duyệt.

## Phạm vi hiện tại

- Một ứng dụng responsive, điều hướng theo vai trò qua `/user`, `/staff` và `/admin`; các route vai trò được chặn nếu chưa đăng nhập hoặc sai vai trò.
- Khách hàng có thể duyệt dịch vụ theo 4 nhóm: vệ sinh phòng trọ, vệ sinh nhà ở, chăm sóc, bảo dưỡng; gửi yêu cầu đặt lịch và theo dõi đơn demo.
- Admin quản lý danh mục, sản phẩm, ảnh URL và tồn kho qua API; màn điều hành đơn mua sản phẩm tách riêng khỏi đơn dịch vụ. Đơn mua có migration additive riêng trong `backend/order-service/migrations`.
- Nhân viên có thể xem công việc mẫu, nhận đơn đang chờ, cập nhật trạng thái thực hiện và xem lịch.
- Quản trị viên có các màn hình tổng quan, đơn hàng, danh mục dịch vụ, tài khoản mẫu, thanh toán, đánh giá và báo cáo.
- Dịch vụ mẫu gồm dọn dẹp, sửa chữa điện nước/điện gia dụng, lắp đặt và chăm sóc thiết bị điện lạnh.

**Lưu ý:** luồng khách hàng, đơn dịch vụ và đăng nhập giao diện hiện vẫn dùng dữ liệu demo phía trình duyệt. API danh mục/sản phẩm và API đơn mua có service MySQL, JWT và kiểm tra role hiện hành ở backend; auth service trong repo chưa phát hành JWT nên cần hoàn tất tích hợp xác thực trước khi sử dụng thực tế. Đơn mua hỗ trợ trạng thái chờ xử lý/đã giao/đã hủy và lưu địa chỉ giao hàng; thanh toán, hãng vận chuyển và giao diện đặt hàng khách hàng chưa triển khai. Cần áp dụng migration đơn mua trước khi chạy order-service.
