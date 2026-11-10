# CleanHome – ba website Customer, Staff và Admin

Customer hiện dùng backend API và MySQL qua API Gateway. Hướng dẫn cấu hình, xác thực và giới hạn schema tại [docs/CUSTOMER_API_INTEGRATION.md](docs/CUSTOMER_API_INTEGRATION.md). Báo cáo [Giai đoạn 2](docs/CUSTOMER_UI_PHASE2.md) được giữ làm lịch sử giao diện.

CleanHome hiện chạy thành **ba website riêng**: Customer **3001**, Staff **3002**, Admin **3003**. Customer mở trực tiếp trang chủ; Staff và Admin có trang đăng nhập riêng.

Staff/Admin giữ luồng demo riêng trên trình duyệt. Báo cáo [khôi phục ba website](docs/THREE_WEBSITES_RESTORE.md) và [Giai đoạn 4](docs/FRONTEND_UNIFICATION_PHASE4.md) là tài liệu lịch sử. Thanh toán Customer hiện chỉ mô phỏng, chưa có cổng thanh toán thật.

## Chạy trên Windows

Cài Node.js 22.9 trở lên (khuyến nghị bản LTS phù hợp). Không dùng Node 14 cho dự án này.

Mở repository `Web_DichVuTaiNha`, đặt Terminal tại thư mục `frontend`. Nếu chưa cài dependency, chạy:

```bash
npm.cmd install
```

Với Customer, sao chép `apps/customer/.env.sample` thành `apps/customer/.env.local`, đặt `NEXT_PUBLIC_API_URL`, rồi khởi động backend theo [backend README](../backend/README.md). Customer hiển thị lỗi rõ nếu API/database chưa sẵn sàng. Sau đó mở các Terminal trong thư mục `frontend`, chạy lệnh cho website cần dùng:

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

## Tài khoản

Customer đăng ký tài khoản qua API và đăng nhập bằng số điện thoại hoặc email đã đăng ký. Tài khoản demo cũ trong localStorage không tự nhập vào MySQL. Staff/Admin tiếp tục dùng tài khoản demo dưới đây.

| Website | Email | Mật khẩu |
| --- | --- | --- |
| Nhân viên | hung.tran@cleanhome.vn | NhanVien123 |
| Quản trị | admin@cleanhome.vn | QuanTri123 |

Nhập sai mật khẩu hoặc đăng nhập sai website sẽ bị chặn trong luồng demo. Tài khoản mẫu khác dùng mật khẩu `CleanHome123` (email xem tại `packages/core/src/mock-data.ts`).

Customer luôn được backend gán vai trò customer; mật khẩu được backend băm và phiên dùng HttpOnly cookie. Staff/Admin không có đăng ký công khai và vẫn xác thực mô phỏng ở frontend; không dùng mật khẩu thật cho hai luồng demo này.

## Phần đã bổ sung

- Khách hàng qua API: dịch vụ theo ba nhóm Vệ sinh/Chăm sóc/Bảo dưỡng, chi tiết và đặt lịch; đơn/chi tiết, yêu cầu hủy, thanh toán mô phỏng, đánh giá một điểm, lịch sử/đặt lại, hồ sơ tên/điện thoại/email. Sản phẩm có danh sách/chi tiết, gợi ý mua thêm tùy chọn, giỏ và đơn mua riêng không có lịch hẹn; xem [hướng dẫn Dịch vụ/Sản phẩm](docs/SERVICES_PRODUCTS.md). Ảnh đại diện và sửa địa chỉ mặc định đang khóa với lý do hiển thị vì schema chưa hỗ trợ đủ dữ liệu.
- Nhân viên: tổng quan, công việc, chi tiết, lịch tuần/tháng/danh sách, tiếp nhận/bắt đầu/hoàn thành, ghi chú và hồ sơ.
- Quản trị: queue đơn dịch vụ và các quyết định/phân công dùng API MySQL; tổng quan, tài khoản/dịch vụ, lịch, thanh toán, đánh giá và một số màn hình quản trị khác vẫn giữ demo state.
- Giữ lại hình ảnh, thành phần trang chủ và dữ liệu mẫu từ bản ban đầu. Font Be Vietnam Pro được đóng gói qua npm, không tải font từ Google khi build.
- Tách ba ứng dụng, mỗi ứng dụng có package.json, cổng và lệnh build riêng, dùng chung mã nguồn component và logic.

## Dữ liệu và giới hạn demo

Customer đọc/ghi dữ liệu nghiệp vụ qua API, dùng cache trong bộ nhớ và không lấy dữ liệu demo làm fallback. Staff/Admin vẫn có các màn hình demo trong localStorage; riêng Staff jobs hiện có backend, và Admin service-order queue/detail/mutations đọc, ghi API booking. Nhân viên mới tạo ở Admin demo không tự xuất hiện ở Staff/backend.

Tải lại trang giữ dữ liệu đã lưu. Không xóa hoặc reset các khóa `cleanhome-demo-state-customer`, `cleanhome-demo-state-staff`, `cleanhome-demo-state-admin` để chuyển chế độ. Dữ liệu hợp nhất `cleanhome-unified-state-v1` vẫn được giữ riêng, không tự nhập hoặc ghi đè vào dữ liệu của ba website. Có thể xuất bản sao tại `/du-lieu` trước khi thao tác với dữ liệu.

Thanh toán Customer qua API chỉ ghi nhận lựa chọn mô phỏng: tiền mặt chưa thanh toán, chuyển khoản chờ xác nhận. Không có xác nhận nhận tiền thật. Xác nhận thanh toán/duyệt hủy trên Admin demo chỉ thay đổi dữ liệu demo của Admin.

Doanh thu báo cáo là tổng đã xác nhận, chưa trừ tiền chưa thực hiện hoàn. Bộ lọc báo cáo áp dụng ngày tạo đơn và ngày xác nhận thanh toán; số tài khoản là tổng hiện có. API booking cần migration 006 và mapping khu vực, dịch vụ chi nhánh, kỹ năng và availability đã được xác nhận; nếu thiếu mapping, đơn được hiển thị trong queue admin, không tự xác nhận.

Chưa tích hợp chatbot AI, khuyến mãi, SSO hoặc cổng thanh toán thật. Staff/Admin chưa tích hợp backend trong phạm vi này.

## Cấu trúc

- `apps/customer`: ứng dụng khách hàng.
- `apps/staff`: ứng dụng nhân viên.
- `apps/admin`: ứng dụng quản trị.
- `packages/ui/src`: màn hình và component dùng chung, CSS responsive.
- `packages/core/src`: kiểu dữ liệu, dữ liệu mẫu, xử lý demo và cấu hình.
- `packages/core/src/api-client.ts`: HTTP client dùng cookie, đọc success/error envelope của Customer API.
- `packages/core/src/customer-api-store.ts`: dữ liệu Customer trong bộ nhớ; tự tải lại sau thao tác, khi đổi trang/focus và mỗi 30 giây.

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

## Cấu hình API và tên miền

Customer dùng `apps/customer/.env.sample`; sao chép thành `.env.local` và đặt URL gateway. Biến `NEXT_PUBLIC_*` được cố định lúc build và không được chứa khóa bí mật. Dùng cùng hostname cho gateway/frontend và cấu hình đúng Customer origin ở backend để cookie/CORS hoạt động.

Contract, biến môi trường backend, migration email và giới hạn session local được mô tả trong [backend README](../backend/README.md) và [Customer integration](docs/CUSTOMER_API_INTEGRATION.md). Dùng chung tài khoản không tự tạo SSO giữa các tên miền.
