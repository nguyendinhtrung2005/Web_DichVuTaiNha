# Thành tích & Đánh giá Staff DEMO

Trang: `/thanh-tich`. Trang gồm hai phần tách biệt: **thống kê phân công thật** đọc từ API Staff hiện có và **đánh giá/huy hiệu/mục tiêu minh họa** không có API. Trang không thay thế Thống kê công việc, Lịch làm việc (UC11), UC9–UC12 và không tạo KPI, thưởng hay quyết định nhân sự.

Lối vào: mục "Thành tích & đánh giá" trong nhóm Cá nhân ở sidebar/sheet điều hướng và lối tắt trên trang Cá nhân. Bottom navigation vẫn giữ đúng năm mục; Thành tích thuộc nhóm Cá nhân.

## Bật demo

- Chỉ bật khi process server chạy `NODE_ENV=development` và `STAFF_ACHIEVEMENTS_DEMO_ENABLED=true` (chuỗi đúng tuyệt đối). Cờ mặc định tắt.
- Production, cờ tắt, cờ public/query/storage hoặc tên cờ của module khác không bật demo. Cờ độc lập với Thu nhập/Hồ sơ/Thông báo/Khu vực.
- Đặt biến trong process rồi chạy script dev Staff hiện có; không cần sửa `.env`. `.env.example` chỉ là mẫu, không chứa secret.
- Khi demo tắt hoặc ngoài development, trang vẫn hiển thị phần thống kê thật và trạng thái "Đánh giá chưa được cung cấp"; không lộ điểm sao, nhận xét, huy hiệu hay mục tiêu minh họa.

## Thống kê thật

- Dùng lại `readStaffStatistic` của Thống kê công việc với đúng contract `/api/staff/schedule`: kỳ là tháng hiện tại theo giờ Việt Nam (UTC+7), tối đa 366 ngày.
- Hiển thị hai số thật: tổng phân công trong kỳ và số phân công **đang ở trạng thái DONE**.
- Trạng thái DONE là trạng thái hiện tại của phân công, **không phải thời điểm hoàn thành thực tế**; kỳ dựa trên lịch hẹn giao với khoảng ngày. Không tạo KPI, tỷ lệ hoàn thành, thời gian trung bình hay xếp hạng khi chưa có dữ liệu chứng minh.
- Nút "Mở Thống kê công việc" mở trang thật hiện có; không nhân bản logic thống kê.

## Dữ liệu đánh giá minh họa

- 12 lượt đánh giá giả lập, mã `DEMO-REV-001`–`DEMO-REV-012`, mã tham chiếu `DEMO-REF-101`–`DEMO-REF-112`; bốn loại dịch vụ hư cấu: Dọn dẹp nhà, Vệ sinh văn phòng, Giặt ghế sofa, Chăm sóc cây.
- Phân bố: 5★ ×5, 4★ ×3, 3★ ×2, 2★ ×1, 1★ ×1; điểm trung bình 3,8/5. Ngày trong khoảng 05/09/2026–24/10/2026, hiển thị UTC+7.
- Nhận xét không chứa tên khách hàng, số điện thoại, địa chỉ, mã booking/assignment hay dữ liệu QA thật; chỉ có nội dung mô tả chất lượng minh họa.
- Bộ lọc số sao (Tất cả hoặc 1–5) và khoảng ngày bao gồm cả hai đầu, tối đa 366 ngày, trong 1971–2099. Bộ lọc áp dụng cho danh sách và điểm trung bình đã lọc; huy hiệu/mục tiêu luôn tính trên toàn bộ dữ liệu minh họa.
- Xem chi tiết trong dialog: số sao, nhận xét đầy đủ, ngày, loại dịch vụ, mã tham chiếu và mã đánh giá DEMO. Không có thao tác gửi, sửa, trả lời hoặc kiểm duyệt.
- Trạng thái rỗng khi bộ lọc không khớp; "Đặt lại minh họa" khôi phục bộ lọc mặc định và dữ liệu seed.

## Huy hiệu và mục tiêu minh họa

- Hai huy hiệu: "Ngôi sao năm sao" (5/5 lượt 5 sao, đã đạt DEMO) và "Phản hồi tích cực" (8/10 lượt từ 4 sao).
- Hai mục tiêu: "Hoàn tất 10 lượt đánh giá" (10/10, đã đạt DEMO) và "Nhận thêm đánh giá 5 sao" (5/8).
- Quy tắc đạt là **giả định DEMO**, ghi ngay trên từng thẻ và trong mục "Giả định và giới hạn". Không phải quy chế CleanHome, không suy ra thưởng tiền, tăng lương, KPI chính thức hoặc quyết định nhân sự.
- Không trộn điểm sao/huy hiệu DEMO với hai số thống kê thật; hai vùng có nhãn và nguồn dữ liệu riêng.

## Cách ly, reset và giới hạn kỹ thuật

- Mỗi tài khoản có một instance adapter riêng trong bộ nhớ trang; không module cache, storage, network, timer nền, push hay geolocation. Adapter/UI fail closed ngoài development hoặc khi account scope không hợp lệ.
- F5, rời trang, đổi tài khoản hoặc đăng xuất đặt lại DEMO; UI nói rõ. A/B không thấy bộ lọc hay dữ liệu của nhau.
- Đọc/ghi đều hủy khi đổi trang hoặc đổi tài khoản; lỗi thao tác không làm mất snapshot đang xem.
- Không gửi đánh giá, không chỉnh sửa review, không PATCH UC12, không ghi Backend/MySQL và không dùng fixture QA.

## Contract cần Backend/Review trước khi tích hợp

`AchievementsDemoAdapter` tách `read`, `detail`, `reset`; DTO view-model là nội bộ frontend, chưa phải contract được duyệt. Khi có owner bàn giao, cần chốt tối thiểu:

1. **Customer đánh giá ai và khi nào:** chỉ sau khi assignment/booking ở trạng thái đủ điều kiện, trong bao lâu, có giới hạn một đánh giá mỗi lượt dịch vụ không; xử lý khiếu nại/đánh giá trùng.
2. **Khóa liên kết:** review gắn `bookingId`, `assignmentId`, `employeeId` (và `serviceId`) theo trường nào; quy tắc ẩn danh, che thông tin khách hàng và thời hạn lưu.
3. **Admin kiểm duyệt:** trạng thái review (chờ duyệt/đã đăng/ẩn), quyền và lý do ẩn, audit, thông báo cho Staff, xử lý nội dung vi phạm.
4. **Phạm vi Staff:** Staff được xem đánh giá nào (chỉ của mình, theo chi nhánh?), có được trả lời/báo cáo không, thời hạn trả lời, hiển thị tên hay ẩn danh, phân trang và thời gian UTC+7.
5. **KPI/huy hiệu/thưởng:** ai quyết định công thức (business owner, không phải Frontend), dữ liệu nguồn, kỳ tính, tiêu chí đạt, hiệu lực, quy trình khiếu nại và việc có kèm thưởng tiền hay không.
6. **API và lỗi:** endpoint/DTO được duyệt, idempotency, mã lỗi ổn định, quyền theo user, audit; Review API thuộc Review Backend, phối hợp TV1/TV3/TV4 khi cần ánh xạ danh tính hoặc phân công Order.

**REAL_E2E_NOT_RUN** cho đánh giá/huy hiệu/mục tiêu thật cho tới khi có API, quy chế KPI và fixture được duyệt. Không tự đặt endpoint/DTO, không seed/PATCH MySQL và không giả báo tích hợp.

Kết quả kiểm thử và artifact ghi trong [STAFF_REBUILD_PROGRESS.md](STAFF_REBUILD_PROGRESS.md). Không sửa Auth/Refresh, BFF security, UC9–UC12, Backend/MySQL, Customer/Admin hoặc QA fixture.
