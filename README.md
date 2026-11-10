# CleanHome — Web_DichVuTaiNha

Website dịch vụ tại nhà gồm ba app Next.js/React/TypeScript trong một frontend workspace. Customer dùng Node.js services và MySQL qua API Gateway; Staff/Admin giữ demo riêng trên trình duyệt.

## Cấu trúc hiện tại

- `frontend/apps/customer`: Customer, cổng 3001.
- `frontend/apps/staff`: Staff, cổng 3002.
- `frontend/apps/admin`: Admin, cổng 3003.
- `frontend/packages`: mã nguồn dùng chung; cần giữ cùng workspace khi build.
- `backend`: Gateway và Auth/User/Catalog/Order/Staff/Payment/Review services.
- `databases`: schema tham khảo và migration có phiên bản, không tự chạy khi start.

Frontend Vite cũ đã được gỡ theo xác nhận owner ngày 07/11/2026. Hướng dẫn migration kit chỉ còn là lịch sử, không phải quy trình chạy hiện tại. `docker-compose.yml` đang là placeholder `services: {}`, chưa phải cấu hình triển khai.

## Chạy local

Yêu cầu Node.js 22.9+ và MySQL 8.0+. Cài dependency từ root nếu máy chưa có:

```powershell
npm.cmd --prefix frontend ci
npm.cmd --prefix backend ci
```

Cấu hình riêng theo [backend README](backend/README.md) và [frontend README](frontend/README.md). Dùng `backend/.env` và `frontend/apps/customer/.env.local`; file mẫu không chứa credential thật. Không import lại schema hoặc seed lên database đang có dữ liệu. Migration phải được owner duyệt cho đúng môi trường.

Mở hai terminal tại root:

```powershell
npm.cmd --prefix backend run start:customer
```

```powershell
npm.cmd --prefix frontend run dev:customer
```

Truy cập http://localhost:3001. Gateway local dùng http://localhost:4000/api/v1; giữ cùng hostname với frontend và đúng CUSTOMER_ORIGIN. Launcher backend mở các service cần thiết; không chạy thêm instance trùng cổng.

Staff/Admin có thể chạy riêng bằng `npm.cmd --prefix frontend run dev:staff` và `npm.cmd --prefix frontend run dev:admin`. Tài khoản demo và giới hạn xem trong frontend README.

## Chức năng và giới hạn

Customer đăng ký/đăng nhập SĐT hoặc email qua API, phiên cookie HttpOnly; xem/tìm dịch vụ, đặt lịch, quản lý/lọc lịch sử, gửi yêu cầu hủy chờ duyệt, thanh toán mô phỏng, đánh giá và xem điểm chung. Sản phẩm có giỏ và đơn mua riêng, không cần lịch dịch vụ hoặc tự mua kèm.

Staff/Admin demo không tự đồng bộ với dữ liệu Customer MySQL. Chưa có payment/shipping thật; Auth local lưu registry phiên trong RAM. Không dùng trạng thái demo làm bằng chứng tích hợp backend hai vai trò.

## Kiểm thử và tài liệu

- Frontend: `npm.cmd --prefix frontend run test:commerce`, `npm.cmd --prefix frontend run typecheck`, `npm.cmd --prefix frontend run build:customer`.
- Backend: `npm.cmd --prefix backend test`; các test MySQL mặc định SKIP nếu chưa bật ALLOW_CUSTOMER_DB_TEST và chưa được duyệt fixture/target.
- [Contract Customer](backend/docs/customer-api-contract.md), [Dịch vụ/Sản phẩm](backend/docs/services-products-contract.md).
- [Kiểm chứng 8 Use Case](backend/docs/customer-use-case-verification.md), [dọn dẹp và tối ưu](frontend/docs/PROJECT_CLEANUP.md).
- Đọc [AGENTS.md](AGENTS.md) và [quy tắc nhóm](BACKEND_TEAM_RULES.md) trước khi sửa. Không commit `.env`, private keys, tokens hoặc database dump chứa dữ liệu cá nhân.
