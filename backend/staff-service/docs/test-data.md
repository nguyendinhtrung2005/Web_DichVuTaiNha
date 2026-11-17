# Dữ liệu kiểm thử Staff UC9–UC12

File `../../../databases/seed_staff_test.sql` là fixture **chạy thủ công**, chỉ dành cho database `cleanhome_staff_test` đã có đủ bảng từ `schema_staff_test.sql`. Không có lệnh npm/startup tự seed. Việc soạn và rà soát file chưa đồng nghĩa dữ liệu đã được nhập vào MySQL hoặc API đã được kiểm chứng với dữ liệu này.

## Các bản ghi dự kiến

Lần chạy đầu trên database test trống tạo chín bản ghi. Các ID được đặt trước để chạy lại không phát sinh bản sao:

| Bảng | ID | Ý nghĩa |
| --- | --- | --- |
| `users` | `9109001` | Khách hàng fixture, role `CUSTOMER` |
| `users` | `9109002` | Tài khoản nhân viên fixture, role `EMPLOYEE` |
| `branches` | `9109003` | Chi nhánh kiểm thử để đáp ứng khóa ngoại |
| `employees` | `9109004` | Hồ sơ của user `9109002`, status `ACTIVE` |
| `service_categories` | `9109005` | Nhóm dịch vụ kiểm thử |
| `services` | `9109006` | Dịch vụ kiểm thử, đơn vị giờ |
| `bookings` | `9109007` | Đơn fixture `CONFIRMED`, dự kiến hai giờ |
| `assignments` | `9109008` | Công việc giao cho employee `9109004`, khởi đầu `ASSIGNED` |
| `booking_items` | `9109009` | Hai giờ dịch vụ, đơn giá snapshot `100000.00` |

Giá trị tiền là dữ liệu kiểm thử, không phải bảng giá kinh doanh. Tổng tiền ban đầu là `200000.00`. Lịch khi tạo mới là **01:00–03:00 UTC ngày kế tiếp**, tương ứng **08:00–10:00 Việt Nam**. Chạy lại không đổi lịch sang ngày mới, không đưa trạng thái công việc trở về `ASSIGNED`, không cập nhật giá hoặc snapshot đã lưu.

Tên/địa chỉ có nhãn kiểm thử; số điện thoại `TEST-CUSTOMER-UC9` và `TEST-EMPLOYEE-UC9` là marker phù hợp độ dài cột, không phải số liên hệ thật. Các bản ghi dùng marker `cleanhome-staff-uc9-uc12-v1`. Fixture không tạo Admin, lịch khả dụng, giao dịch, đánh giá, lịch sử xác nhận hay sự kiện hoàn thành.

## Cách chạy thủ công

1. Kiểm tra đây là MySQL phát triển riêng, database `cleanhome_staff_test` đã có đúng 32 bảng và không chứa dữ liệu thật. Đọc toàn bộ SQL trước khi chạy.
2. Mở `databases/seed_staff_test.sql` trong MySQL Workbench, chọn kết nối test. Chạy **toàn bộ file theo thứ tự, trong một phiên**, không chạy đồng thời hai cửa sổ seed.
3. Đọc hai kết quả cuối: `selected_database` phải là `cleanhome_staff_test`, `seed_guard_passed` phải bằng `1`; dòng metadata phải có user `9109002`, employee `9109004`, assignment `9109008`.
4. Nếu guard bằng `0`, seed không bổ sung dữ liệu: kiểm tra database đang chọn và collision ID/marker. Không xóa/ghi đè bản ghi để ép seed chạy. Nếu gặp lỗi SQL, dừng và kiểm tra; không coi output thiếu bản ghi là seed hoàn tất.

Mỗi INSERT có đích schema-qualified `cleanhome_staff_test.*`, điều kiện `DATABASE() = 'cleanhome_staff_test'`, guard đã khởi tạo bằng `0`, và `NOT EXISTS`. Vì vậy, nếu lệnh `USE` hoặc preflight lỗi nhưng editor tiếp tục, các INSERT không chuyển sang ghi nhầm database đang chọn. Preflight chặn collision ID/unique key không mang đúng danh tính fixture; các JOIN kiểm tra lại nguồn phụ thuộc. Không dùng upsert ghi đè, không UPDATE/DELETE/DROP/TRUNCATE và không tắt kiểm tra khóa ngoại.

Kiểm tra tồn tại đọc bảng đích qua derived table có `LIMIT 1` để buộc materialization, tránh hạn chế MySQL khi INSERT đồng thời tham chiếu bảng đích trong subquery. Xem [giới hạn subquery của MySQL](https://dev.mysql.com/doc/mysql-reslimits-excerpt/8.0/en/subquery-restrictions.html).

Các bảng có khóa chính/unique tiếp tục chặn bản ghi trùng khi có race; file không được thiết kế để seed song song. Transaction gom các INSERT khi thực thi bình thường; nếu client tiếp tục sau lỗi statement, không được khẳng định toàn bộ seed đã thành công. Không có cơ chế tự sửa hoặc reset dữ liệu hiện có. Nếu đã thử đổi trạng thái, khóa tài khoản, sửa lịch/giá hoặc cấp mật khẩu thật, chạy lại sẽ giữ các giá trị đó. Việc sửa marker/danh tính fixture có thể khiến guard chặn lần chạy sau; đây là hành vi bảo toàn dữ liệu.

## Xác thực và kiểm thử API

`password_hash` chỉ chứa marker **không đăng nhập được**, không phải bcrypt/Argon2 hash. Không có mật khẩu hay JWT secret dùng được trong seed/tài liệu này. Auth Service phải cấp credential/token hợp lệ theo contract riêng; không bỏ middleware xác thực và không tạo token tự khai báo danh tính từ client. Để thử với fixture nhân viên, token do Auth xác minh phải ánh xạ subject tới user **`9109002`**, role `EMPLOYEE`/`STAFF` theo contract, tài khoản và employee còn hoạt động.

Sau khi người quản trị đã chạy SQL và cấu hình service, có thể dùng token hợp lệ để gọi:

- `GET /api/v1/staff/me/jobs` — tìm assignment `9109008` của chính nhân viên.
- `GET /api/v1/staff/me/jobs/9109008` — xem chi tiết đơn `9109007` và service snapshot.
- `GET /api/v1/staff/me/schedule?from=YYYY-MM-DD&to=YYYY-MM-DD` — dùng ngày **Việt Nam thực tế của lịch đã lưu**, không mặc định luôn là ngày mai sau khi seed lại.
- `PATCH /api/v1/staff/me/jobs/9109008/status` — chỉ khi Order Service đã triển khai contract journal/idempotency/đồng bộ. Luồng database `ASSIGNED → ACCEPTED → IN_PROGRESS → DONE`; mỗi bước mới dùng Idempotency-Key mới, retry cùng bước giữ key cũ.

Seed chỉ cung cấp dữ liệu FK tối thiểu; không triển khai Auth hoặc Order Service. Khi các dependency này chưa sẵn sàng, không báo PATCH, lịch sử hoặc kiểm thử HTTP end-to-end là thành công. Không seed `booking_status_history`: lịch sử nghiệp vụ và đồng bộ Order do service sở hữu xử lý theo contract.

## Kiểm tra sau khi người dùng nhập seed — 23/10/2026

Đã đọc MySQL `cleanhome_staff_test`: hai user, một employee, một booking và một assignment. Liên kết user `9109002` → employee `9109004` → assignment `9109008` → booking `9109007` đúng; Customer là user `9109001`. Assignment đang `ASSIGNED`, booking `CONFIRMED`. Lịch đã lưu là `2026-10-24 01:00:00`–`03:00:00` UTC, tức **08:00–10:00 ngày 24/10/2026 giờ Việt Nam**.

Từ `backend/staff-service`, với `.env` chứa cấu hình MySQL test đã có:

```powershell
$env:RUN_MYSQL_TESTS = 'true'
npm.cmd run test:mysql
npm.cmd run test:mysql:seeded
```

Kết quả lần kiểm tra này: **6 + 11 kiểm tra đạt**, không bỏ qua. Bộ mới `test/mysql.seeded.integration.test.js` kiểm liên kết FK, danh sách có dữ liệu, lọc/phân trang, detail và snapshot, employee ID sai, ID không tồn tại, lịch chứa việc/giao một phần/hai biên không giao, lịch rỗng và validation ngày. Nó lấy ngày từ lịch đã lưu, không mặc định luôn là ngày mai.

Các lời gọi trực tiếp `StaffJobService.list/detail` kiểm DTO và quyền Customer/không có user trên MySQL thật. Đối tượng truyền user ID chỉ là đầu vào kiểm thử tầng nghiệp vụ; **không phải phiên đã xác thực JWT**, không được dùng để công bố API HTTP đã hoạt động. Test không mở HTTP server, không phát token, không thay auth middleware và không gọi Order hay cập nhật tiến độ.

Đã đối chiếu hash các trường ID/trạng thái/lịch/giá trong tám bảng liên quan trước/sau: các trường được kiểm tra giữ nguyên. Không đọc hash mật khẩu; không in nội dung liên hệ. Với một employee, kiểm ID employee đã xác nhận không tồn tại chỉ chứng minh SQL giới hạn đúng ID; chưa kiểm hai Staff thật truy cập chéo qua HTTP hoặc riêng nhánh sai role/tài khoản khóa trên MySQL. Với một assignment, chưa kiểm sắp xếp nhiều bản ghi. Những trường hợp đó cần thêm dữ liệu được phê duyệt và JWT do Auth thật cấp; UC12/lịch sử cần Order Service.

Không chạy seed lại để kiểm thử. Nếu thiếu fixture hoặc dữ liệu fixture đã đổi, test báo lỗi để xem xét thay vì tự tạo/sửa/reset bản ghi.
