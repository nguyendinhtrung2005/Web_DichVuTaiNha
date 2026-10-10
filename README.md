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
- Có gian hàng sản phẩm theo các nhóm dịch vụ; khách hàng demo có thể chọn số lượng, gửi đơn mua và xem trạng thái. Admin có thể quản lý danh mục/tồn kho và xử lý đơn sản phẩm.
- Nhân viên có thể xem công việc mẫu, nhận đơn đang chờ, cập nhật trạng thái thực hiện và xem lịch.
- Quản trị viên có các màn hình tổng quan, đơn hàng, danh mục dịch vụ, tài khoản mẫu, thanh toán, đánh giá và báo cáo.
- Dịch vụ mẫu gồm dọn dẹp, sửa chữa điện nước/điện gia dụng, lắp đặt và chăm sóc thiết bị điện lạnh.

**Lưu ý:** các luồng nghiệp vụ và số liệu hiện chỉ là bản demo phía trình duyệt. Đơn sản phẩm không kết nối thanh toán/vận chuyển thật; thay đổi tồn kho và đơn được lưu cục bộ. `docker-compose.yml`, backend và các module `frontend/src/services` chưa được kết nối/triển khai; đăng nhập, phân quyền và thanh toán hiện không phải cơ chế bảo mật hay giao dịch thật. Cần tích hợp API và kiểm tra quyền ở backend trước khi đưa vào sử dụng thực tế.
