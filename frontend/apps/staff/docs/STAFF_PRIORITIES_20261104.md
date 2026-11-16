# CleanHome Staff — các ưu tiên ngày 04/11/2026

Tiếp tục mã nguồn và 61 pending trên nền `c8dec00`, nhánh `feat/staff-rebuild`. Chủ website cho phép mở rộng Backend **Thu nhập Staff** trong lượt này; không sửa service Auth, Order, Payment, Review hoặc MySQL. Không stage/commit/push/merge.

## Quyết định đã xác nhận

- Giữ phân công đích danh và UC9–UC12; không shared-slot hoặc nhận việc tự do.
- Chính sách tiền công dưới đây chỉ là **MINH HỌA**, không phải payroll/ledger/chi trả đã được TV5 duyệt.
- Chưa có Google Maps key: hoàn thiện khung tích hợp/fallback, không tự cấp key hoặc bịa tọa độ.
- Chưa có Review API, kênh liên hệ/FAQ chính thức hoặc provider chatbot: không tạo đánh giá hoặc phản hồi AI thật giả. DEMO cũ vẫn có nhãn/cờ riêng.

## Thu nhập DEMO_V2 trên phân công thật

Tái sử dụng `GET /api/staff/income/estimate?month=YYYY-MM` → `GET /api/v1/staff/me/income/estimate`. Server resolve employee từ actor được xác thực; browser không chọn employeeId. Backend, BFF và UI đều yêu cầu `NODE_ENV=development` + `STAFF_INCOME_DEMO_ENABLED=true`. Production/off bị khóa kể cả query hoặc cờ module khác bật. Không sửa `.env`.

| Khoản | Điều kiện minh họa |
| --- | --- |
| Cơ bản | 60.000 VND/assignment hiện DONE, check-in/out hợp lệ, check-out không trước check-in |
| Cao điểm | 10.000 VND/assignment hợp lệ, **check-in thực tế** từ 17:00 đến trước 20:00 UTC+7 |
| Di chuyển | 3.000 VND/km vượt 3km, chỉ từ bằng chứng quãng đường được xác minh |
| Thưởng ngày | 30.000 VND một lần/ngày có ít nhất 5 assignment hợp lệ; ngày theo check-out UTC+7 |
| Loại trừ | Không DONE/đã hủy, thiếu/sai check-in/out; DONE ngoài tháng check-out được ghi `OUTSIDE_COMPLETION_PERIOD` |

Các tham số tập trung trong `DEMO_INCOME_POLICY` của `income-policy.js`. Không dùng `booking.unitPrice`; không có thưởng cuối tuần/thời tiết hoặc điều chỉnh chưa được duyệt. Mốc ghi nhận V2 là ngày check-out UTC+7; cao điểm theo check-in. Xem ngày/tuần/tháng trong tháng đã chọn; tuần bắt đầu thứ Hai và chỉ cộng những ngày thuộc kỳ tháng đó. DTO V1 vẫn được đọc tương thích, ghi rõ phạm vi cũ theo lịch hẹn, không tự cộng bonus V2.

Repository chỉ SELECT assignment của employee có check-out hoặc lịch hẹn trong kỳ; phần lịch hẹn dùng để giải thích dữ liệu chưa đủ điều kiện. Đọc tối đa 501 để phát hiện vượt giới hạn 500 và trả lỗi, không xuất tổng tiền bị cắt. Không dùng số phần tử một trang để suy tổng. Không migration/seed/UPDATE/INSERT/replay UC12.

DTO V2 giữ `period/counts/assignments/payout`, thêm `policy.version=DEMO_V2`, `breakdown`, `incentives`, `assignment.detail` (ngày, cơ bản/cao điểm/di chuyển/tổng). BFF/browser dùng chung parser allowlist để kiểm tra lại điều kiện, bonus và tổng; từ chối sai phiên bản/tổng/điều kiện, không chuyển token/PII ngoài hợp đồng.

**Chưa có nguồn quãng đường:** service không truyền bằng chứng; `distanceVnd=null`, `distanceStatus=UNVERIFIED`. UI ghi rõ phụ phí chưa tính được, không coi 0đ là phụ phí đã xác nhận. Chỉ tổng hợp khoản đủ dữ liệu. Tổng, cơ cấu, bảng kê và biểu đồ dùng cùng DTO; bảng kê có link `/don/:id`, cuộn ngang bằng bàn phím/cảm ứng trên mobile; có kỳ rỗng/lỗi/thử lại. `payout.status=NOT_INTEGRATED`, không số dư/rút tiền hoặc thanh toán giả.

## Đăng nhập, Maps, Hỗ trợ, Thành tích

- **Đăng nhập:** logic xóa/remount password khi lỗi đã có ở HEAD, giữ nguyên source Auth/Refresh. Bổ sung Chrome regression cho sai mật khẩu, Auth outage và lỗi mạng: báo lỗi, giữ phone, xóa password, không tự điền lại. Dùng dependency doubles cho tình huống lỗi, không gây khóa tài khoản QA thật. Password manager bản địa còn cần kiểm tra thủ công.
- **Maps:** cấu hình server `STAFF_GOOGLE_MAPS_ENABLED=true` + `STAFF_GOOGLE_MAPS_BROWSER_KEY`. Chỉ tải SDK khi người dùng bấm mở và branch API có tọa độ decimal hợp lệ. GeoJSON Polygon/MultiPolygon hợp lệ mới có biên vùng; không suy tọa độ từ booking, không GPS/đo đường/ghi vùng/ca. Fallback thiếu key/tọa độ/hình học; lỗi SDK có thử lại. Browser key cần giới hạn theo website/API: [hướng dẫn Google](https://developers.google.com/maps/api-security-best-practices), [tải SDK](https://developers.google.com/maps/documentation/javascript/load-maps-js-api), [Data layer](https://developers.google.com/maps/documentation/javascript/datalayer).
- **Hỗ trợ:** tìm/mở hướng dẫn UC9/Lịch/Thu nhập và link Staff thật; tách khỏi FAQ chính thức chưa được cung cấp. Liên hệ chưa cấu hình. Chat có log, input/gửi, loading/đang phản hồi/lỗi/thử đọc lại. `StaffSupportProvider` là port nội bộ, mặc định null nên không gửi/giả tin nhắn. Tương lai phải gọi route Staff BFF cố định có phiên/quyền; không đưa secret ra browser. Retry giữ idempotency key cho cùng nội dung chưa xác nhận; không lưu chat vào storage. Ticket DEMO cũ vẫn dev-only, cô lập theo tài khoản.
- **Thành tích:** giữ nguồn/công thức chỉ số vận hành thật đang có, thêm chọn khoảng lịch hẹn và phân bố 5 trạng thái. DONE không xác định ngày hoàn thành/chi trả; đọc nhiều trang không là snapshot đồng thời. Remount theo tài khoản, timeout chuyển sang lỗi/thử lại. Reviews thật ghi “Chưa có dữ liệu đánh giá”, không sao/nhận xét giả khi demo tắt. DEMO thành tích cũ không thành KPI chính thức.

## Còn chờ tích hợp

TV4: nguồn quãng đường đáng tin cậy, tọa độ/GeoJSON, quyền quản trị vùng/ca. TV3: booking facts/hủy/hoàn khi chốt chính sách chính thức. TV5: ledger, gross/net/điều chỉnh, kỳ chốt, phê duyệt và API chi trả. Review owner/TV5 + TV4 xác nhận contract đánh giá theo employee; TV1 phối hợp danh tính/quyền. Nhóm chốt FAQ/liên hệ, provider chatbot, retention/SLA và quyền hội thoại trước khi bật gửi. Không triển khai Backend ngoài Thu nhập Staff trong lượt này.


## Kiểm chứng lượt này

- Backend: 34 unit PASS (income/policy/repository). Staff: 663 unit PASS; typecheck/build 1 worker PASS, source copy đối chiếu SHA-256.
- Chrome form: 11 PASS với dependency doubles; không thay cho Auth thật. Native password-manager selection NOT_RUN.
- Chrome tổng hợp: 24 PASS = 11 DEMO_PASS + 13 REAL_E2E_PASS; 375/390/768/1440, Auth A/B/F5/logout, Thu nhập/công thức/kỳ rỗng/lọc, Areas/availability chỉ đọc + Maps fallback, Support disconnected, Thành tích/chỉ số thật/reviews unavailable; smoke UC9–UC11/Profile/Notifications. 0 PATCH/ghi dữ liệu nghiệp vụ.
- Thu nhập A tháng 10/2026: 16 DONE hợp lệ, tổng 1080000 VND, cao điểm 60000, thưởng ngày 60000; 16 phân công chưa có quãng đường. Đây là ước tính DEMO trên QA thật, không chi trả.
- Artifact: C:/Users/Asus/AppData/Local/Temp/cleanhome-staff-priorities-20261104-D9jufa; chrome/report.json, auth-form-chrome/report.json; ảnh chrome/{income,areas,support,achievements}-{375,390,768,1440}.png. URL: http://localhost:3163/{thu-nhap,khu-vuc,ho-tro,thanh-tich}. Backend QA 4001/4015; kho phiên Auth/BFF riêng, worker tắt.
- Harness ban đầu sửa selector/input không có id. Kiểm tra ảnh phát hiện CSS cũ ẩn bảng kê mobile, đã sửa scoped Staff và kiểm tra lại. Ổ C đầy làm gián đoạn QA; chỉ xóa bốn profile Chrome do lượt này tạo và chuyển profile mới sang thư mục QA worktree, không sửa Auth/BFF để che lỗi môi trường.
- Google Maps có key, Review/chatbot/Payment thật, nguồn quãng đường thật và triển khai HTTPS production: NOT_RUN; không tuyên bố production-ready.

- Đối chiếu cuối lượt: 42 file thay đổi trong phạm vi lượt này; 78 pending tổng, bảo toàn 61 pending đầu lượt, 0 staged. HEAD c8dec00/feat/staff-rebuild không đổi. Status/index/diff/CSS Git gốc khớp SHA-256 bản chụp đầu lượt: 235 staged paths, portal.css +13 dòng. Secret/whitespace/phạm vi PASS; 221 file ngoài phạm vi giữ nguyên hash. Không commit/push/merge hoặc sửa .env/MySQL/fixture QA. Bằng chứng: artifact final-audit.json.
