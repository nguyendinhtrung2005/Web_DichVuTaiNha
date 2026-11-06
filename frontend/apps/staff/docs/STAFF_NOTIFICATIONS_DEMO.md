# Thông báo Staff DEMO

Trang: /thong-bao. Đây là bản minh họa tương tác; không phải thông báo Backend hay thông báo đẩy.

- Chỉ bật khi server chạy NODE_ENV=development và STAFF_NOTIFICATIONS_DEMO_ENABLED=true (chuỗi đúng tuyệt đối). Cờ mặc định tắt; production luôn chặn cả UI và adapter dù đặt true. Không dùng query, localStorage hoặc cờ NEXT_PUBLIC để bật demo. Các cờ Thu nhập/Hồ sơ độc lập.
- Không cần sửa .env: đặt cờ trong process development rồi dùng script dev Staff hiện có. Cổng mặc định 3002 không đổi; preview QA dùng cổng riêng.
- Mười nội dung hoàn toàn giả lập, bốn loại Công việc/Thu nhập/Hồ sơ/Hệ thống. Mọi trang và chi tiết đều ghi DỮ LIỆU MINH HỌA. Không tạo nội dung từ UC9–UC12, giá booking, thanh toán hay thông tin QA thật.
- Danh sách Tất cả/Chưa đọc, số chưa đọc, chi tiết, đánh dấu từng mục, Đọc tất cả và Đặt lại đều dùng cùng một adapter. Xem chi tiết không tự đánh dấu đọc. Các lần đọc lặp giữ thời điểm đọc cũ; thời gian hiển thị UTC+7.
- Mỗi tài khoản có một instance riêng trong bộ nhớ của trang. Không storage, network, timer nền, service worker hay permission push. F5, rời trang, đổi tài khoản hoặc đăng xuất sẽ bỏ trạng thái; trở lại dùng bộ minh họa ban đầu. Không hứa lưu qua F5 hay đồng bộ tài khoản.
- Deep link chỉ dùng allowlist trang Staff có thật. Không trỏ đến assignment giả, API, /internal/, URL ngoài, query chỉ định người dùng hoặc trang Auth. Trang đích dữ liệu thật tiếp tục dùng quyền/session hiện có.
- NotificationDemoAdapter là ranh giới UI: list/detail/markRead/readAll/reset; report.total và unreadCount tính trên toàn dataset riêng, items theo bộ lọc. Đây là interface nội bộ frontend, chưa phải DTO hoặc endpoint Backend được duyệt. Future remote adapter cần map contract chính thức, xử lý phân trang và semantics count sau khi owner bàn giao.
- Loading, lỗi/thử lại, chưa có dữ liệu, không còn mục chưa đọc và detail không tồn tại đều có trạng thái riêng. Chỉ báo thành công sau khi adapter hoàn tất; hủy request khi đổi trang/tài khoản.
- TV5 phối hợp TV1/TV4 cần cung cấp contract danh sách/phân trang, unread count, detail, mark-read/read-all, quyền theo user, deep link và read-state đồng thời. TV3 chỉ phối hợp nếu sau này cần nguồn sự kiện Order. REAL_E2E_NOT_RUN cho Notifications thật cho tới khi có API/fixture được duyệt.

Kết quả kiểm thử và đường dẫn artifact ghi trong STAFF_REBUILD_PROGRESS.md. Không đổi Auth/Refresh, BFF security, UC9–UC12 hoặc Backend/MySQL.
