# CleanHome – ba website Customer, Staff và Admin

Tiến độ giao diện Customer và giới hạn kỹ thuật của Giai đoạn 2 được ghi tại [docs/CUSTOMER_UI_PHASE2.md](docs/CUSTOMER_UI_PHASE2.md).

CleanHome hiện chạy thành **ba website riêng** để trình diễn đồ án: Customer **3001**, Staff **3002**, Admin **3003**. Customer mở trực tiếp trang chủ; Staff và Admin có trang đăng nhập riêng. Không cần nhập dữ liệu hoặc đi qua màn hình migration để sử dụng.

Xem phạm vi khôi phục, an toàn dữ liệu và hướng dẫn kiểm tra tại [docs/THREE_WEBSITES_RESTORE.md](docs/THREE_WEBSITES_RESTORE.md). Báo cáo [Giai đoạn 4](docs/FRONTEND_UNIFICATION_PHASE4.md) được giữ làm lịch sử của phương án hợp nhất, không phải hướng dẫn chạy mặc định hiện tại. Dữ liệu vẫn lưu trên trình duyệt, chưa có backend API hoặc giao dịch thanh toán thực tế.

## Chạy trên Windows

Cài Node.js 22.9 trở lên (khuyến nghị bản LTS phù hợp). Không dùng Node 14 cho dự án này.

Mở repository `Web_DichVuTaiNha`, đặt Terminal tại thư mục `frontend`. Nếu chưa cài dependency, chạy:

```bash
npm.cmd install
```

Mở ba Terminal trong thư mục `frontend`, chạy một lệnh ở mỗi Terminal:

```powershell
npm.cmd run dev:customer
```

```powershell
npm.cmd run dev:staff
```

```powershell
npm.cmd run dev:admin
```

| Website | Trang chính | Đăng nhập |
| --- | --- | --- |
| Customer | http://localhost:3001 | http://localhost:3001/dang-nhap |
| Staff | http://localhost:3002 | http://localhost:3002/dang-nhap |
| Admin | http://localhost:3003 | http://localhost:3003/dang-nhap |

Giữ các Terminal đang chạy. Nhấn Ctrl+C khi muốn dừng. Nếu một cổng đang chạy bản cũ, dừng đúng Terminal đó rồi khởi động lại bằng lệnh tương ứng để Next.js nạp cấu hình mới. Không mở thêm tiến trình trùng cổng. Trang `/du-lieu` ở từng website chỉ phục vụ xuất bản sao dữ liệu hiện có, không phải bước bắt buộc trước đăng nhập.

## Tài khoản demo

| Website | Email | Mật khẩu |
| --- | --- | --- |
| Khách hàng | lan.nguyen@example.vn | KhachHang123 |
| Nhân viên | hung.tran@cleanhome.vn | NhanVien123 |
| Quản trị | admin@cleanhome.vn | QuanTri123 |

Nhập sai mật khẩu hoặc đăng nhập sai website sẽ bị chặn trong luồng demo. Tài khoản mẫu khác dùng mật khẩu `CleanHome123` (email xem tại `packages/core/src/mock-data.ts`).

Khách mới có thể đăng ký tại website khách hàng, luôn được gán vai trò customer. Nhân viên và quản trị không có đăng ký công khai. Không nhập mật khẩu thật: mã xác thực chạy ở frontend, chỉ dùng mô phỏng, có thể bị sửa bằng công cụ trình duyệt. Cách băm demo không phải cơ chế bảo vệ mật khẩu dùng trong sản phẩm thật.

## Phần đã bổ sung

- Khách hàng: trang dịch vụ, chi tiết, biểu mẫu đặt nhiều bước, đơn/chi tiết, yêu cầu hủy, thanh toán mô phỏng, đánh giá, lịch sử/đặt lại, hồ sơ/ảnh đại diện.
- Nhân viên: tổng quan, công việc, chi tiết, lịch tuần/tháng/danh sách, tiếp nhận/bắt đầu/hoàn thành, ghi chú và hồ sơ.
- Quản trị: tổng quan, quản lý tài khoản/dịch vụ, sản phẩm và tồn kho, xác nhận đơn, phân công có kiểm tra trùng lịch, duyệt hủy, lịch, thanh toán, đánh giá, báo cáo và xuất CSV.
- Danh mục dịch vụ gồm Vệ sinh nhà ở, Vệ sinh phòng trọ, Chăm sóc và Bảo dưỡng. Sản phẩm có trang mua riêng tại `/san-pham`, giỏ hàng và đơn mua demo; không dùng luồng đặt lịch.
- Giữ lại hình ảnh, thành phần trang chủ và dữ liệu mẫu từ bản ban đầu. Font Be Vietnam Pro được đóng gói qua npm, không tải font từ Google khi build.
- Tách ba ứng dụng, mỗi ứng dụng có package.json, cổng và lệnh build riêng, dùng chung mã nguồn component và logic.

## Dữ liệu và giới hạn demo

Mỗi website dùng bộ dữ liệu riêng trong localStorage theo vai trò. Thay đổi ở customer **không tự chuyển** sang admin hoặc staff. Nhân viên mới tạo ở admin cũng không tự xuất hiện ở staff. Để minh họa các phía, dùng các đơn/tài khoản mẫu có sẵn ở từng website. Đây là giới hạn có chủ ý khi chưa có backend chung; không phải lỗi đồng bộ.

Danh mục sản phẩm demo cũng lưu riêng theo nguồn gốc trình duyệt. Đơn mua và cập nhật tồn kho ở Customer không đồng bộ với trang quản lý sản phẩm ở Admin; để đồng bộ giao dịch và tồn kho giữa các website cần backend/API chung. Không dùng đơn mua demo cho giao dịch thực tế.

Tải lại trang giữ dữ liệu đã lưu. Không xóa hoặc reset các khóa `cleanhome-demo-state-customer`, `cleanhome-demo-state-staff`, `cleanhome-demo-state-admin` để chuyển chế độ. Dữ liệu hợp nhất `cleanhome-unified-state-v1` vẫn được giữ riêng, không tự nhập hoặc ghi đè vào dữ liệu của ba website. Có thể xuất bản sao tại `/du-lieu` trước khi thao tác với dữ liệu.

Thanh toán chỉ là mô phỏng: khách chọn tiền mặt hoặc chuyển khoản; chọn chuyển khoản tạo trạng thái chờ CleanHome ghi nhận đã nhận tiền, không xác nhận giao dịch ngân hàng. Admin chỉ ghi nhận đã nhận tiền theo luồng quản trị hiện có. Đánh giá chỉ dành cho đơn đã hoàn thành; nếu chưa có nhân viên được phân công, khách chỉ đánh giá dịch vụ. Lịch sử khách hàng chỉ gồm đơn đã hoàn thành. Nhân viên chỉ tự sửa thông tin liên hệ và ảnh đại diện, không tự sửa chức danh, mã nhân viên hoặc trạng thái tài khoản. Đơn đã ghi nhận thanh toán được duyệt hủy chỉ đánh dấu cần xem xét hoàn tiền, không thực hiện hoàn tiền.

Doanh thu báo cáo là tổng đã xác nhận, chưa trừ tiền chưa thực hiện hoàn. Bộ lọc báo cáo áp dụng ngày tạo đơn và ngày xác nhận thanh toán; số tài khoản là tổng hiện có.

Backend API Node.js/MySQL đang được xây dựng riêng trong `backend/`; giao diện Customer, Staff và Admin hiện chưa gọi các API đó và vẫn sử dụng localStorage. Chưa tích hợp chatbot AI, khuyến mãi, đồng bộ database giữa các website, SSO hoặc cổng thanh toán thật. Các phần này không được tuyên bố là đã hoạt động.

## Cấu trúc

- `apps/customer`: ứng dụng khách hàng.
- `apps/staff`: ứng dụng nhân viên.
- `apps/admin`: ứng dụng quản trị.
- `packages/ui/src`: màn hình và component dùng chung, CSS responsive.
- `packages/core/src`: kiểu dữ liệu, dữ liệu mẫu, xử lý demo và cấu hình.
- `packages/core/src/api-client.ts`: hàm HTTP chuẩn bị cho giai đoạn backend; giao diện hiện chưa sử dụng hàm này.

Ba ứng dụng được quản lý trong cùng một npm workspace nhưng chạy/build/deploy riêng. Không sao chép một mình thư mục apps/customer ra ngoài vì nó còn dùng packages dùng chung. Khi triển khai, dùng toàn repository và chọn ứng dụng cần build.

## Build và chạy bản production

```bash
npm run typecheck
npm run build
```

Sau đó chạy từng ứng dụng:

```bash
npm run start:customer
npm run start:staff
npm run start:admin
```

Mỗi lệnh start chạy ở Terminal riêng. Có thể build một phía bằng `npm run build:customer`, `npm run build:staff`, `npm run build:admin`.

## Kết nối API và tên miền sau này

Sao chép `.env.example` trong từng app thành `.env.local`, đặt địa chỉ API và ba website thực tế. Ba tên miền ví dụ trong yêu cầu chưa được đăng ký/triển khai bởi bản ZIP này. Biến môi trường công khai không được chứa khóa bí mật.

Backend chung cần: xác thực thật, lưu mật khẩu an toàn, phiên đăng nhập, kiểm tra vai trò/quyền sở hữu đơn trên mọi API, CORS phù hợp, cơ sở dữ liệu và kiểm tra đầu vào. Sau đó thay lớp store demo bằng các lời gọi API. Dùng chung tài khoản không tự tạo SSO giữa các tên miền.
