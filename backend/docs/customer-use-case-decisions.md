# Đối chiếu tài liệu Customer — các quyết định đã xác nhận

Nguồn: `D:\DACN\mo_ta_uc_khach_hang.docx`, mục 2.1.2.1–2.1.2.8, đọc ngày 07/11/2026. Dùng số mục tài liệu để định danh; không tự đổi mã UC tạm của nhóm.

Trạng thái: chủ nhiệm đã xác nhận **giữ hủy chờ duyệt**, **thanh toán mô phỏng**, **duyệt bộ lọc Order**, **duyệt điểm đánh giá chung và API internal Order–Review** ngày 07/11/2026. Thưởng phụ trách Customer. Team review trước merge theo BACKEND_TEAM_RULES mục 5.1 và 13; không suy diễn thành cả nhóm đã nghiệm thu.

## 1. Hủy dịch vụ (2.1.2.5)

- Tài liệu: hủy đủ điều kiện thì cập nhật `bookings.status=CANCELLED` và ghi lịch sử trong cùng transaction.
- Contract hiện tại: `POST /orders/:id/cancellation-requests {reason}` chỉ lưu yêu cầu; trạng thái giữ nguyên chờ Admin duyệt.
- Chủ nhiệm chọn giữ contract chờ duyệt ngày 07/11/2026. Không đổi sang hủy ngay, không sửa assignment hoặc thanh toán của vai trò khác.
- Nếu chọn hủy ngay: cần chốt trạng thái được hủy, hạn chót trước giờ hẹn, phối hợp assignment đang thay đổi, xử lý khoản đã thanh toán/hoàn tiền, khả năng gửi lại và contract phía Admin/Staff. Chưa có đủ căn cứ để tự chọn các quy tắc này.
- Không cần migration chỉ để ghi trạng thái/lịch sử; đó chưa phải phê duyệt thực thi SQL.

## 2. Thanh toán (2.1.2.6)

- Tài liệu mô tả xử lý giao dịch và kết quả thành công/thất bại (kể cả số dư không đủ).
- API hiện tại `POST /orders/:id/payment-simulation {method:cash|transfer}` ghi `UNPAID/PENDING`, không xác nhận đã nhận tiền.
- Chủ nhiệm xác nhận thanh toán mô phỏng là mức nghiệm thu của nhiệm vụ ngày 07/11/2026.
- Tích hợp bên thứ ba cần provider, contract callback/chữ ký, môi trường thử nghiệm, idempotency/đối soát và quy tắc hoàn tiền được duyệt. Không cung cấp credential qua tài liệu/chat và không giả kết quả `PAID`.

## 3. Lịch sử: mở rộng truy vấn API sẵn có (2.1.2.8)

Đề xuất additive, **đã được chủ nhiệm duyệt triển khai ngày 07/11/2026**:

- Giữ `GET /api/v1/orders` và envelope `{data:{items,total,page,limit}}`; thêm query tùy chọn `q` (0–120 ký tự), `serviceId` (ID), `status` (enum hiện có), `from`, `to` (`YYYY-MM-DD`, ngày lịch thực hiện tại Asia/Ho_Chi_Minh), `sort` (`newest|oldest|schedule-asc|schedule-desc`). Mặc định không đổi. `from>to`/ngày sai trả 400. `to` bao gồm cả ngày, SQL dùng cận trên ngày kế tiếp. `q` tìm mã đơn hoặc tên dịch vụ snapshot, escape LIKE.
- Luôn lọc `customer_id` từ principal; không nhận ID khách từ browser. Truy vấn tham số hóa, whitelist sort, pagination hiện tại; không đọc bảng Catalog/Staff để lọc.
- Customer gửi tiêu chí tới API; phân trang theo kết quả lọc. Lịch sử mặc định giữ các đơn hoàn thành như giao diện hiện có; từ “đã thực hiện” trong tài liệu chưa xác định có bao gồm đơn hủy hay không.
- Bảng chỉ đọc: `bookings`, `booking_items`, `booking_status_history` (owner Thưởng). Không schema/migration, không đổi internal API dùng bởi Payment/Review.
- Test: range/ngày sai, ranh giới múi giờ, dịch vụ ngừng bán dùng snapshot, SQL injection, phân trang, không đăng nhập, đơn khác tài khoản, API lỗi không hiển thị rỗng giả.

## 4. Điểm đánh giá công khai (2.1.2.7)

Tài liệu yêu cầu công khai đánh giá **hoặc** cập nhật điểm chung. Phương án ít dữ liệu nhất, additive, **đã được chủ nhiệm duyệt triển khai ngày 07/11/2026**:

- `GET /api/v1/reviews/service-summary?serviceId=<id>` public, do Review sở hữu; Gateway chuyển đến Review. Response `{data:{serviceId:string,count:number,averageRating:number|null}}`; không có điểm thì `count=0,averageRating=null`.
- Order cung cấp `GET /internal/v1/services/:id/completed-bookings?page=&limit=` (chỉ caller `review`, credential nội bộ hiện có). Trả `{items:[{id:string}],total,page,limit}`, các booking hoàn thành có ít nhất một item của dịch vụ, thứ tự ID tăng. Chỉ đọc `bookings`/`booking_items`, không trả thông tin khách/nhân viên. Không xuất route internal qua Gateway.
- Review duyệt các trang ID (tối đa 10.000 booking; vượt giới hạn trả 503 rõ ràng), chỉ đọc `reviews` của mình bằng `booking_id IN (?)` với placeholders, cộng số lượng/tổng điểm để tính trung bình hai chữ số thập phân. Dùng EXISTS ở Order để không nhân đôi do nhiều item. `count` là số bản ghi đánh giá thực; không sửa/xóa đánh giá cũ có nhiều nhân viên. Dịch vụ chưa có booking/không tồn tại trả `count=0,averageRating=null`, không cần mở quyền đọc Catalog. Một lần đọc không phải snapshot transaction xuyên service; lỗi/thay đổi phân trang phát hiện được trả 503 yêu cầu thử lại.
- Frontend chi tiết dịch vụ gọi endpoint summary qua api-client, hiển thị số đánh giá/điểm hoặc “Chưa có đánh giá”; khi lỗi hiển thị lỗi và nút thử lại, không dùng số mẫu.
- File dự kiến: Order app/repository (owner Thưởng), Review app/repository (Thưởng), Gateway app (Thưởng điều phối, chỉ thêm route Customer public), API contract, component Customer hiển thị điểm, test. Không sửa Catalog/Admin/Staff, không schema/migration/biến môi trường mới. Khôi phục code bằng patch riêng sau review; không xóa dữ liệu.
- Không trả tên, SĐT, ID khách, địa chỉ hoặc nội dung đánh giá riêng tư. Không tự giả điểm đánh giá trên UI.
- Bằng chứng kiểm chứng điểm từ đơn hoàn thành, ID sai, không có đánh giá và lỗi dependency xem tại customer-use-case-verification.md.

## 5. Các yêu cầu chưa đủ chi tiết

- Khoảng giờ/đặt trước bao lâu: giữ kiểm tra tương lai và các lựa chọn UI hiện có, chưa tự thêm ngày nghỉ/hạn đặt.
- Danh sách từ ngữ cấm trong nhận xét chưa được cung cấp; không tự tuyên bố có kiểm duyệt nội dung.
- Mô tả đánh giá nhắc sản phẩm nhưng các bước/tiền điều kiện đều là đơn dịch vụ hoàn thành; không tự thêm đánh giá sản phẩm hoặc thay schema.
- Đăng nhập email đã được chủ nhiệm yêu cầu và duyệt trước; giữ cả SĐT/email, không xóa vì tài liệu chỉ minh họa SĐT.
