# Dịch vụ và sản phẩm Customer

Customer mở rộng các trang/Portal/API hiện có. Staff/Admin giữ dữ liệu demo riêng; taxonomy quản lý dịch vụ của Admin demo được mở rộng tương thích, không dùng phiên demo để cấp quyền quản trị hàng hóa MySQL.

## Chạy local

Tại backend, giữ DB credentials riêng trong .env và chạy:

    npm.cmd run check:db
    npm.cmd run check:products
    npm.cmd run start:customer

Tại frontend:

    npm.cmd run dev:customer

Mở http://localhost:3001. NEXT_PUBLIC_API_URL trỏ tới Gateway /api/v1; CUSTOMER_ORIGIN phải khớp origin trình duyệt. CUSTOMER_DEFAULT_BRANCH_ID cần chi nhánh ACTIVE cho đặt lịch dịch vụ; mua sản phẩm không yêu cầu branch hoặc lịch dịch vụ.

Cập nhật 06/11/2026: migration 003 đã được duyệt và áp dụng trên database local; dữ liệu `[DEMO]` gồm 4 dịch vụ, 2 sản phẩm và 1 chi nhánh được duyệt/nạp riêng. Xem `backend/docs/customer-local-demo.md`. Khởi động lại backend để nạp cấu hình chi nhánh mới. Nguồn API vẫn là MySQL thật; không tự seed khi start và không dùng mock để che lỗi.

Migration 002 đã được user duyệt riêng và áp dụng lên MySQL local 127.0.0.1:3306 / dich_vu_ve_sinh. Môi trường khác cần owner duyệt riêng. Không chạy schema.sql hoặc migration tự động khi khởi động. API không tự sinh catalog hay dùng mock khi DB lỗi; dữ liệu thật do owner Catalog/Staff cung cấp. Fixture kiểm thử được dọn sau khi chạy.

## Xem và đặt dịch vụ

/dich-vu hiển thị ba nhóm Vệ sinh, Chăm sóc, Bảo dưỡng, hỗ trợ tìm kiếm và lọc. Nhóm Vệ sinh phân biệt Vệ sinh phòng trọ và Vệ sinh nhà ở gia đình. Loại dịch vụ, phạm vi, bao gồm/không bao gồm, ảnh, đơn vị và số lượng lấy từ metadata Catalog; giá cơ sở/thời lượng lấy từ cột MySQL gốc.

Nhãn giá phân biệt cố định, tham khảo và cần khảo sát. Giá cần khảo sát chưa phải báo giá cuối cùng; yêu cầu được ghi nhận với mức tham khảo để xác nhận sau. Đặt lịch giữ các bước dịch vụ, thông tin nơi thực hiện, ngày/giờ và xác nhận. Phòng trọ có loại nhà riêng; thông tin diện tích/phòng/tầng được yêu cầu khi phù hợp, không ép mua sản phẩm.

ID/slug/category cũ và snapshot đơn được giữ nguyên. Taxonomy cũ được ánh xạ lúc đọc; không xóa localStorage hoặc đổi SEED_VERSION. Metadata mẫu mới dùng cho demo được ghi rõ, không thay thế dữ liệu Customer API. Bản demo đã lưu không bị tự nhập lại dữ liệu mẫu.

## Mua sản phẩm tự nguyện

/san-pham cho xem, tìm/lọc, xem chi tiết và tồn khả dụng. Trên chi tiết dịch vụ, phần sản phẩm liên quan ghi rõ mua thêm tùy chọn. Xem hoặc đặt dịch vụ không tự thêm sản phẩm; khách phải bấm thêm vào giỏ.

/gio-hang chứa ID và số lượng trong bộ nhớ tab; có thể sửa số lượng, xóa và mua riêng. Giá/tồn kho được tải lại, checkout bị chặn khi sản phẩm không khả dụng hoặc dữ liệu tải lỗi. Backend kiểm tra lại giá và giữ tồn kho bằng transaction; không tin tổng tiền trình duyệt.

/thanh-toan-san-pham yêu cầu đăng nhập và thông tin liên hệ, không có ngày/giờ dịch vụ. Địa chỉ tùy chọn chỉ để trao đổi về đơn, không phải đăng ký vận chuyển. /don-san-pham hiển thị đơn sản phẩm riêng.

PROCESSING nghĩa là cần xác minh kết quả; PENDING nghĩa là đã ghi nhận và giữ hàng; FAILED là chưa hoàn tất. Không trạng thái nào ở đây xác nhận thanh toán hoặc giao hàng thật. Khi mạng/commit chưa rõ, dùng thao tác khôi phục cùng yêu cầu hoặc kiểm tra lại đơn, không gửi đơn mới để che lỗi. Bản nháp khôi phục tạm trong bộ nhớ được gắn với tài khoản và không ghi browser storage.

Menu và trang đơn có lối chuyển rõ giữa “Lịch dịch vụ” và “Đơn sản phẩm”. Chi tiết lịch dịch vụ hiển thị tiến độ/bước tiếp theo theo trạng thái API thật; yêu cầu hủy chờ duyệt không được hiển thị là đã hủy. Form đặt lịch giữ thông tin và request key trong bộ nhớ tab khi chuyển trang hoặc cùng tài khoản đăng nhập lại sau hết phiên. Đăng xuất chủ động, đổi tài khoản, đặt thành công hoặc tải lại toàn bộ trang sẽ xóa bản nháp tương ứng.

## Giới hạn quản trị

Chưa có contract/xác thực Admin thật cho quản lý sản phẩm/tồn kho. Không tạo API ghi hàng hóa từ tài khoản demo hoặc luồng quản trị song song. Owner TV2 cung cấp dữ liệu Catalog/tồn kho; TV3 quản lý đơn. Chính sách thực hiện/giao hàng/thanh toán/hủy đơn sản phẩm và hết hạn giữ hàng cần được nhóm duyệt trước khi bổ sung; hệ thống không tự hoàn tồn kho khi kết quả commit chưa rõ.

## Kiểm chứng

Frontend unit:

    npm.cmd run test:commerce
    npm.cmd run typecheck:customer
    npm.cmd run typecheck:staff
    npm.cmd run typecheck:admin
    npm.cmd run build:customer

Backend unit/HTTP giả lập:

    npm.cmd test

MySQL và trình duyệt thật, chỉ trên target/fixture đã được duyệt:

    $env:ALLOW_CUSTOMER_DB_TEST = '1'
    npm.cmd run test:products:mysql
    npm.cmd run test:products:browser

Chi tiết quyền/DTO/recovery tại backend/docs/services-products-contract.md. Báo cáo kiểm thử phải phân biệt repository giả lập, MySQL thật và trình duyệt; không coi test skip là pass.
