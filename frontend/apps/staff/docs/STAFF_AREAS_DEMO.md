# Khu vực & ca làm Staff DEMO

Trang: `/khu-vuc`. Đây là bản minh họa tương tác cho khu vực phục vụ, lịch ca và trạng thái sẵn sàng; không phải phân công, lịch hẹn hay chính sách nhân sự thật. Trang không thay thế Lịch làm việc (UC11) và không tạo assignment hoặc cập nhật UC12.

Lối vào: mục "Khu vực & ca làm" trong nhóm Cá nhân ở sidebar/sheet điều hướng và lối tắt trên trang Cá nhân. Bottom navigation vẫn giữ đúng năm mục; Khu vực thuộc nhóm Cá nhân.

## Bật demo

- Chỉ bật khi process server chạy `NODE_ENV=development` và `STAFF_AREAS_DEMO_ENABLED=true` (chuỗi đúng tuyệt đối). Cờ mặc định tắt.
- Production luôn chặn cả UI và adapter dù đặt `true`. Query, localStorage/sessionStorage, cờ `NEXT_PUBLIC_*` hoặc tên cờ của module khác không bật được demo.
- Cờ độc lập với Thu nhập/Hồ sơ/Thông báo. Đặt biến trong process rồi chạy script dev Staff hiện có; không cần sửa `.env`. `.env.example` chỉ là mẫu, không chứa secret.
- Cổng dev mặc định 3002 không đổi. Preview QA dùng cổng riêng và bản sao public source đã đối chiếu hash.

## Dữ liệu minh họa

- Ba khu vực giả lập: Trung tâm, Vườn (hoạt động) và Ven sông (tạm ngưng, không chọn được). Tên khu vực/chi nhánh và mô tả hoàn toàn hư cấu, không suy từ địa chỉ booking, PII QA hay dữ liệu UC9–UC12.
- Ban đầu chỉ chọn Trung tâm, chưa sẵn sàng và chưa đăng ký ca. Không có mã nhân viên, tài khoản, assignment, booking, số điện thoại hay token trong seed.
- Lịch tuần bắt đầu thứ Hai theo ngày Việt Nam (UTC+7). Hai khu vực hoạt động × 7 ngày × 3 khung = 42 ca/tuần; ID ổn định theo ngày/khu vực/khung.
- Khung ca: sáng 08:00–12:00, chiều 13:00–17:00, tối 18:00–21:00. Có một ca đủ chỗ (thứ Tư chiều, Trung tâm) và một ca đã hủy (thứ Sáu tối, Vườn) để kiểm tra trạng thái không đăng ký được.
- Khoảng xem hợp lệ 04/01/1971–27/12/2099 để tuần hiển thị luôn trọn. Ngày gõ tay sai không làm mất lịch đang xem.

## Tính năng

- Chọn/bỏ khu vực hoạt động, Lưu hoặc Hủy thay đổi; lựa chọn chỉ áp dụng sau khi lưu.
- Bật/tắt "Sẵn sàng trong DEMO". Sẵn sàng cần ít nhất một khu vực hoạt động, độc lập trạng thái ACTIVE của Auth và không phải điều kiện đăng ký ca.
- Lịch ngày/tuần, chuyển kỳ trước/sau, Hôm nay, chọn ngày và lọc theo khu vực đã lưu. Counter ghi rõ số ca đã đăng ký trong cả phiên minh họa, không phải tổng của riêng kỳ đang xem.
- Xem chi tiết ca trong dialog: khu vực, khung giờ UTC+7, trạng thái ca và trạng thái đăng ký.
- Đăng ký/hủy ca, Đặt lại minh họa, loading/empty/error/retry và thông báo kết quả thao tác.

## Quy tắc của bản minh họa

- Chỉ đăng ký ca `OPEN`, chưa bắt đầu và thuộc khu vực đã lưu. Ca `FULL`/`CANCELLED`, ca đã bắt đầu và ca ngoài khu vực đã chọn bị từ chối.
- Kiểm tra giờ bắt đầu trước kết thúc, cùng ngày Việt Nam và không giao giờ với ca đã đăng ký, kể cả ở khu vực khác. Hai khung chạm biên không tính là trùng.
- Đăng ký lặp không tạo bản sao; hai yêu cầu đồng thời không bỏ qua kiểm tra trùng.
- Chỉ hủy ca chưa bắt đầu. Ca đã bắt đầu vẫn là lịch sử minh họa trong phiên và không hủy được.
- Không bỏ khu vực còn ca đã đăng ký chưa bắt đầu, kể cả ca ở tuần khác; phải hủy ca trước. Có thể lưu lựa chọn rỗng khi không sẵn sàng và không còn ca tương lai.
- Không thêm thời gian di chuyển, chính sách nhân sự, tiền công hay shared-slot. Đây không phải chính sách chính thức của CleanHome.

## Trạng thái, reset và cách ly

- Mỗi tài khoản có một instance adapter riêng trong bộ nhớ trang; không module cache, storage, network, timer nền, push hay geolocation.
- F5, rời trang, đổi tài khoản hoặc đăng xuất sẽ đặt lại DEMO; UI nói rõ trạng thái chỉ giữ tạm khi mở trang. A/B không thấy lựa chọn, sẵn sàng hay ca của nhau.
- Đặt lại chỉ khôi phục seed của phiên đang mở, không xóa storage, không đổi Auth/assignment và không gửi Backend.
- Mọi thao tác đọc/ghi đều hủy khi đổi trang hoặc đổi tài khoản; lỗi thao tác không làm mất snapshot đang xem.

## Ranh giới tích hợp sau này

`AreasDemoAdapter` tách `read`, `detail`, `savePreferences`, `register`, `cancel`, `reset`. DTO view-model là nội bộ frontend, chưa phải contract Backend được duyệt.

Khi có owner bàn giao, Backend cần cung cấp tối thiểu: danh sách khu vực/chi nhánh được phân công và quyền chỉnh lựa chọn; đọc/ghi lựa chọn khu vực và ý nghĩa trạng thái sẵn sàng; lịch ca theo tuần/ngày kèm timezone UTC+7; đăng ký/hủy ca với idempotency, xung đột/trùng giờ, ca đã bắt đầu/đủ chỗ/đã hủy; mã lỗi ổn định; phân quyền theo user và audit. TV4 sở hữu contract vùng/ca/khả dụng; business owner chốt mô hình ca và ý nghĩa sẵn sàng; TV3 phối hợp nếu ảnh hưởng phân công Order; TV1 chỉ khi cần ánh xạ danh tính/quyền. Không suy quyền từ tên khu vực hoặc Auth ACTIVE.

**REAL_E2E_NOT_RUN** cho Khu vực/ca làm thật cho tới khi có API và fixture được duyệt. Không tự đặt endpoint/DTO, không seed/PATCH MySQL và không giả báo tích hợp.

Kết quả kiểm thử và artifact thực tế ghi trong [STAFF_REBUILD_PROGRESS.md](STAFF_REBUILD_PROGRESS.md). Không sửa Auth/Refresh, BFF security, UC9–UC12, Backend/MySQL, Customer/Admin hoặc QA fixture.
