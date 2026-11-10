# CleanHome Customer API

Bảng đối chiếu 8 Use Case, file thay đổi, API và kết quả kiểm thử ngày 07/11/2026: [Customer Use Case verification](docs/customer-use-case-verification.md).

Customer uses real Node.js services through the API Gateway. Staff/Admin login uses backend portal authentication, the Admin service-order status report reads MySQL, and the Staff job list/detail use assigned bookings from the backend. Staff status transitions are implemented with a shared operation journal but fail closed until migration 005 is manually applied. Other Admin screens and Staff dashboard/calendar/profile still use demo state. Product purchases remain separate from the service-order report. Business services use MySQL pools and internal HTTP calls with caller credentials; the Gateway never accesses the database. See [the approved local integration contract](docs/admin-staff-order-integration-draft.md) for scope and remaining verification.

## Chạy Customer local

Các sửa logic đặt lại dịch vụ, phiên, lỗi đăng ký, retry và validation được ghi tại [báo cáo sửa logic Customer](docs/customer-logic-fixes.md). Lượt sửa này không cần migration/seed hoặc cấu hình runtime mới.

Cập nhật 06/11/2026: migration 003 và bộ dữ liệu `[DEMO]` đã được duyệt/áp dụng riêng trên MySQL local. Chi nhánh mặc định đã cấu hình trong `.env` riêng; cần khởi động lại backend để nhận cấu hình. Không chạy lại seed để nạp tồn. Xem [kế hoạch dữ liệu minh họa](docs/customer-local-demo.md) và [báo cáo kiểm chứng Customer](docs/customer-ux-verification.md).

Yêu cầu Node.js 22.9+ (đã kiểm chứng trên Node 24.21), MySQL 8.0+, dependency frontend/backend đã cài.

Terminal backend, tại thư mục backend:

    npm.cmd ci
    if (-not (Test-Path .env)) { Copy-Item .env.sample .env }
    notepad .env
    npm.cmd run check:db
    npm.cmd run start:customer

Giữ nguyên DB credentials trong file riêng .env. Đặt `STAFF_ORIGIN` và `ADMIN_ORIGIN` khớp origin trình duyệt tương ứng. Đơn dịch vụ `/orders` không dùng chi nhánh mặc định; quyết định tự động chỉ hoạt động sau khi DB owner áp dụng migration 006 và người phụ trách nạp mapping khu vực/dịch vụ/kỹ năng/availability đã xác nhận. Nếu thiếu, đơn sẽ nằm trong queue admin. Dữ liệu fixture kiểm thử được dọn sau mỗi lần chạy, không để lại làm seed demo.

Terminal frontend, tại thư mục frontend:

    if (-not (Test-Path apps/customer/.env.local)) { Copy-Item apps/customer/.env.sample apps/customer/.env.local }
    npm.cmd run dev:customer

Mở http://localhost:3001. NEXT_PUBLIC_API_URL dùng http://localhost:4000/api/v1; CUSTOMER_ORIGIN phải khớp origin trình duyệt. Giữ localhost thống nhất cho frontend/gateway. Biến NEXT_PUBLIC không chứa secret và được Next.js đóng vào bản build.

Để chạy Portal, mở thêm terminal trong `frontend` và chạy `npm.cmd run dev:staff` hoặc `npm.cmd run dev:admin` (cổng 3002/3003). `STAFF_ORIGIN`/`ADMIN_ORIGIN` trong backend phải trùng origin thực tế.

Portal Admin yêu cầu một tài khoản `ADMIN` ACTIVE có sẵn trong MySQL local. Script `node --env-file-if-exists=.env scripts/create-local-admin.js` chỉ là provisioning thủ công: script xác nhận database, yêu cầu nhập mật khẩu ẩn và từ chối host ngoài loopback/production. Chưa chạy script trong task này; chỉ chạy sau khi người quản lý xác nhận đúng database đích.

Launcher local mở Auth 4001, User 4002, Catalog 4003, Order 4004, Staff 4005, Payment 4006, Review 4007, Gateway 4000; các cổng đều cấu hình qua *_PORT. Không khởi động thêm instance trùng cổng. Lỗi cổng/DB phải được sửa trước khi chạy lại.

Backend dùng Node trực tiếp, không tự nạp lại file khi sửa mã. Nếu đặt dịch vụ báo `INVALID_INPUT` với `expectedUnitPrice`, hoặc mua sản phẩm báo trường `paymentMethod` không được hỗ trợ, kiểm tra backend cũ còn chạy: dừng đúng terminal backend bằng Ctrl+C rồi chạy lại `npm.cmd run start:customer`. Auth restart làm hết phiên local; tải lại trang và đăng nhập lại. `check:db`/`check:products` PASS chỉ xác nhận DB/schema, không chứng minh tiến trình đang giữ cổng 4000 đã nạp mã mới. Test dùng stack/cổng riêng cũng không thay thế kiểm tra website đang chạy.

Sau khi đã có quyền dùng fixture trên DB local, có thể chạy `$env:ALLOW_CUSTOMER_DB_TEST='1'` rồi `node --env-file-if-exists=.env tests/customer-live-smoke.mjs` để kiểm tra đúng gateway đang chạy tại localhost:4000; thêm `--browser` để kiểm tra Customer tại localhost:3001 bằng Chrome. Script tạo fixture riêng, dọn đúng marker/ID, không seed/reset dữ liệu web và không in mật khẩu/cookie. Không khởi động thêm backend khi các cổng đang chạy đúng phiên bản.

## API và phiên

Customer chọn phương thức thanh toán mô phỏng ngay trong bước kiểm tra đặt dịch vụ và form mua sản phẩm. Dịch vụ dùng API Payment hiện có, lỗi sau tạo lịch sẽ thử lại đúng key/booking; sản phẩm gửi thêm `paymentMethod` vào POST `/product-orders` và cần migration 004. Migration này đã được duyệt/áp dụng riêng trên DB local; môi trường khác cần duyệt riêng. Xem [luồng thanh toán trong checkout](docs/customer-checkout-payment.md). Không có chuyển tiền thật hoặc PAID giả; đơn cũ không bị tự gán phương thức.

Contract bổ sung xác nhận giá đã được chủ nhiệm xác nhận owner duyệt: đặt lịch gửi `expectedUnitPrice`, mua sản phẩm gửi trường này trong từng item. Giá khác server yêu cầu khách xem và xác nhận lại; API không lấy giá client để tính tiền. Booking mới chỉ nhận các giờ bắt đầu trên giao diện (giờ Việt Nam); dữ liệu/replay cũ được giữ tương thích. Xem [hoàn thiện luồng Customer](docs/customer-flow-corrections.md) để biết DTO, retry và giới hạn liên vai trò. Cần khởi động lại backend và frontend/build lại cùng phiên bản khi dùng thay đổi này; client cũ thiếu giá xác nhận không được tạo đơn mới. Tự động xác nhận/queue cần migration 006 trước khi bật.

Luồng quyết định booking, queue quản trị, mapping vận hành, quyền hiện có và migration/test 006 được ghi tại [tự động xác nhận và điều phối đơn dịch vụ](docs/service-order-automation.md). `/product-orders` tiếp tục độc lập.

Contract endpoint, DTO và giới hạn: [docs/customer-api-contract.md](docs/customer-api-contract.md). Public prefix /api/v1. Auth nhận identifier là số điện thoại hoặc email; đăng ký email tùy chọn. Người dùng chỉ truy cập dữ liệu của mình; input role/userId/status/price bị từ chối. JSON errors nhất quán, không trả stack/SQL/credential.

Phiên là JWT RS256 trong cookie HttpOnly, SameSite=Lax, Secure khi production. Consumer kiểm tra signature, issuer/audience/expiry và introspection trạng thái tài khoản/phiên. Mutation cần Origin đúng và application/json. Không lưu token/mật khẩu trong browser storage. Logout thu hồi phiên; Auth restart hết các phiên local. Sổ phiên trong bộ nhớ là giới hạn local, chưa dùng cho nhiều instance production.

Launcher sinh RSA key và secrets nội bộ tạm thời cho local. Chạy từng service riêng bằng start:auth/start:user/start:catalog/start:order/start:staff/start:payment/start:review/start:gateway cần cấu hình đầy đủ INTERNAL_*_TOKEN giống nhau giữa các tiến trình, *_URL và JWT_PRIVATE_KEY_PATH nếu production. File mẫu chỉ chứa placeholders; khóa riêng/secrets ở ngoài Git.

Thanh toán chỉ mô phỏng tiền mặt/chuyển khoản ở UNPAID/PENDING; không có cổng thanh toán hoặc xác nhận PAID. Hủy là yêu cầu chờ Admin duyệt, không tự hủy đơn. Đánh giá một điểm cho đơn hoàn thành có nhân viên thực được phân công. Hồ sơ sửa tên/SĐT/email; chưa hỗ trợ ảnh hoặc sửa địa chỉ mặc định vì schema thiếu thông tin. Địa chỉ đặt lịch vẫn lưu trong booking snapshot.

Contract Dịch vụ/Sản phẩm đã được xác nhận cho triển khai với Catalog TV2 và Order TV3. Catalog cung cấp nhóm dịch vụ, danh mục/chi tiết sản phẩm và giữ tồn kho; Order ghi nhận đơn sản phẩm riêng, không nhận lịch hẹn hay tin giá/tổng tiền từ trình duyệt. Đơn ở trạng thái `PENDING` chưa đồng nghĩa đã thanh toán hoặc vận chuyển. Chi tiết API và phục hồi trạng thái xem tại [services-products-contract.md](docs/services-products-contract.md).

## Migration được kiểm soát

Giữ nguyên databases/schema.sql. Migration additive databases/migrations/001_users_email.sql thêm users.email nullable và uq_users_email. Migration 002 bổ sung metadata dịch vụ, liên kết sản phẩm và bảng ghi nhận đơn/giữ tồn kho. Hai migration này đã được duyệt và áp dụng lên đúng MySQL local 127.0.0.1:3306 / dich_vu_ve_sinh; metadata đã xác minh. Migration 003 bổ sung idempotency key cho booking đã được duyệt riêng và áp dụng lên cùng database local ngày 06/11/2026; check:db đã PASS. Mỗi môi trường cần owner database duyệt riêng, preflight/backup và áp dụng một lần. Không có startup migration/seed hoặc rollback phá hủy tự động. Chạy npm.cmd run check:db và npm.cmd run check:products để kiểm tra schema chỉ đọc. Xem [migration guide](../databases/migrations/README.md).

## Kiểm thử

Unit/security và HTTP với dependency giả lập (không ghi DB):

    npm.cmd test

Mặc định các test MySQL được SKIP nếu ALLOW_CUSTOMER_DB_TEST chưa bật. Với Dịch vụ/Sản phẩm, chạy test:products:mysql và test:products:browser sau khi được duyệt fixture/target; các lệnh này kiểm thử giỏ/đơn mua riêng và giữ tồn kho, không tạo thanh toán/vận chuyển thật. Nếu một lần test sản phẩm bị ngắt, script product-fixtures.js cleanup <product-registry-path> chỉ dọn marker/ID đã xác minh rồi dọn fixture Customer cha; không dùng cleanup Customer riêng trước khi các FK sản phẩm được dọn.

HTTP thật với MySQL fixture, chỉ sau khi đã được duyệt đúng target và bảng:

    $env:ALLOW_CUSTOMER_DB_TEST = '1'
    npm.cmd run test:mysql

Browser Customer + API + MySQL fixture (Chrome/Edge đã cài, không cần Playwright):

    npm.cmd run test:customer:browser

Các test MySQL từ chối target khác localhost:3306/dich_vu_ve_sinh và yêu cầu cột email đã tồn tại. Registry fixture chỉ chứa marker/ID trong .test-artifacts (ignored). Cleanup dùng đúng ID và xác minh marker/quyền sở hữu, theo thứ tự khóa ngoại. Khi bị ngắt, sau khi xác minh đúng target có thể dọn registry còn lại bằng:

    node --env-file-if-exists=.env scripts/customer-fixtures.js cleanup <registry-path>

Không chạy các test ghi dữ liệu trên môi trường khác khi chưa được owner cho phép. Browser test tự mở/đóng đúng tiến trình Next/Chrome nó tạo, từ chối cổng đang có người dùng; không dừng server của người khác. Build/typecheck và hướng dẫn frontend tại [Customer integration](../frontend/docs/CUSTOMER_API_INTEGRATION.md).

## Prepare a local connection

Requirements: Node.js 22.9+ and MySQL 8.0+.

```powershell
cd D:\DACN\Du_an_DACN\Web_DichVuTaiNha\backend
npm.cmd ci
if (-not (Test-Path .env)) { Copy-Item .env.sample .env }
notepad .env
```

Set `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD` to credentials for an approved local test database. Keep `.env` private; it is ignored by Git.

## Schema

[`../databases/schema.sql`](../databases/schema.sql) contains the 32-table DDL transcribed from the supplied MySQL document. Review it before applying it. It creates the named database if absent, then creates the tables; it is not an idempotent migration and must only be applied once to a new, approved empty database. The backend does not execute schema DDL at startup.

The schema was not run as part of this change. Do not apply it to a database that contains data without a reviewed migration/backup plan.

## Verify connectivity

After installing dependencies, setting `.env`, and applying the schema to the intended test database:

```powershell
npm.cmd run check:db
```

The check opens a pool for Auth, User, Catalog, Order, Staff, Payment, and Review, runs read-only `SELECT DATABASE()` queries, then checks that the 32 expected tables exist. It does not create, update, or delete data. Connection errors are reported without printing credentials.

Each business service can import its pool from its own `src/db.js`. The API Gateway has no database pool.

The service `src/app.js` files implement Customer routes, the Admin service-order report, and Staff job APIs described above. The Staff transition journal migration is prepared but not applied; it does not change the live database. Staff mutations remain unavailable until that migration is applied. Staff dashboard/calendar/profile, Admin screens beyond the report, live HTTP/MySQL verification, and provider/consumer review remain outstanding before calling the full integration complete.
