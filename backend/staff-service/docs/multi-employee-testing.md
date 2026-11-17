# Kiểm thử nhiều nhân viên và nhiều công việc

`databases/seed_staff_test_multi.sql` bổ sung **15 bản ghi fixture** vào đúng database `cleanhome_staff_test`. File chỉ được soạn để người dùng xem và chạy thủ công, không được service hoặc test tự thực thi. Cần khởi tạo schema và chạy seed gốc `seed_staff_test.sql` trước. Seed gốc và các bản ghi `9109001…9109009` được giữ nguyên.

## Dữ liệu và ID cố định

Customer `9109001`, branch `9109003`, service `9109006` được dùng lại. Nhân viên A là user `9109002` / employee `9109004`; nhân viên B mới là user `9109101` / employee `9109102`. Mỗi người cần credential/token riêng do Auth cấp; seed không tạo credential đăng nhập được và không cấp Admin.

| Trường hợp | Booking | Booking item | Assignment | Chủ sở hữu | Trạng thái khởi đầu | Lịch so với booking gốc `9109007` |
| --- | --- | --- | --- | --- | --- | --- |
| Gốc được giữ lại | `9109007` | `9109009` | `9109008` | A | Giữ trạng thái đã lưu | Giữ lịch đã lưu |
| Công việc B | `9109103` | `9109104` | `9109105` | B | `ASSIGNED` | +1 ngày |
| Công việc sớm A | `9109111` | `9109112` | `9109113` | A | `ASSIGNED` | −2 ngày |
| Công việc muộn A | `9109121` | `9109122` | `9109123` | A | `ACCEPTED` | +2 ngày |
| Đơn hai nhân viên | `9109131` | `9109132` | `9109133` | A | `ASSIGNED` | +3 ngày |
| Cùng đơn hai nhân viên | `9109131` | `9109132` | `9109134` | B | `ASSIGNED` | +3 ngày |

Khi đủ fixture, **A có ít nhất bốn assignment, B có ít nhất hai**. Giá snapshot của mỗi booking mới là hai giờ × `100000.00`, tổng `200000.00`; đây là giá trị kiểm thử. Các job mới ban đầu có check-in/check-out `NULL`, kể cả `ACCEPTED` vì check-in chỉ ghi khi bắt đầu. Một job `ACCEPTED` được dựng sẵn để kiểm tra bộ lọc; không khẳng định đã có thao tác tiếp nhận thật hoặc tạo lịch sử giả.

Booking mới có JSON marker `_cleanhome_fixture = 'cleanhome-staff-uc9-uc12-multi-v1'`; `_cleanhome_case` lần lượt là `employee-b`, `employee-a-early`, `employee-a-late`, `multi-worker`. Booking gốc giữ marker gốc. Phone `TEST-EMPLOYEE-UC9-B` chỉ là marker, không phải số điện thoại thực; `password_hash` là chuỗi không đăng nhập được như seed gốc.

## Chạy seed thủ công

1. Mở file SQL trên kết nối test riêng, kiểm tra database `cleanhome_staff_test` và seed gốc đã tồn tại. Không chạy trên database có dữ liệu thật.
2. Chạy toàn bộ file **theo thứ tự, một phiên duy nhất**. Không chạy đồng thời hoặc chỉ chọn một đoạn INSERT.
3. Kết quả cuối phải có `selected_database = cleanhome_staff_test`, `multi_seed_guard_passed = 1`, sáu dòng assignment đúng bảng trên. Nếu thiếu bản ghi hoặc có lỗi, không coi seed đã hoàn tất.

Mọi INSERT đều có target schema-qualified, kiểm tra `DATABASE()` và guard khởi tạo bằng `0`. Preflight yêu cầu lineage seed gốc, chặn collision ID/phone/employee-user hoặc booking/item/assignment không đúng fixture. `NOT EXISTS` đọc qua derived table có `LIMIT 1` để materialize an toàn trên MySQL. File không UPDATE, DELETE, DROP, TRUNCATE, thêm bảng/cột hoặc tắt kiểm tra khóa ngoại.

Chạy lại **không** đưa job đã xử lý về trạng thái ban đầu, đổi giá, tạo lại lịch theo ngày hiện tại hoặc sửa credential/lock state. Nếu marker/danh tính fixture bị chỉnh, guard có thể từ chối; không tự xóa bản ghi để ép seed chạy. SQL editor tiếp tục sau một lỗi không đồng nghĩa transaction đã thành công trọn vẹn; luôn kiểm tra kết quả và lỗi.

## Repository integration — chỉ đọc MySQL

Từ `backend/staff-service`, sau khi người dùng đã chạy hai seed:

```powershell
$env:RUN_MYSQL_MULTI_TESTS = 'true'
npm.cmd run test:mysql:multi
Remove-Item Env:RUN_MYSQL_MULTI_TESTS
```

`MYSQL_*` lấy từ `.env` cục bộ. Test từ chối ngay nếu `MYSQL_DATABASE` khác `cleanhome_staff_test`. Mặc định flag không bật thì suite **SKIP trước khi kết nối**. Bật rõ nhưng thiếu seed/profile/job sẽ **FAIL**, không tự thêm dữ liệu và không đổi thành một kiểm tra mảng rỗng đạt.

Các kiểm tra đọc thực tế gồm: A/B chỉ có job của mình, detail A↔B trả null, job cùng booking vẫn tách quyền, lọc trạng thái và số lượng, sort asc/desc theo lịch và ID, page 2 và trang vượt cuối, khoảng lịch và biên không giao nhau, service snapshot, đối chiếu status/timestamp/giá trước-sau. Suite không ghi DB, không gọi PATCH, không giả Auth/JWT và không chứng minh HTTP authorization phía server.

Các kiểm tra tĩnh `test/multi-seed-contract.test.js` chỉ đọc SQL/schema/source, không kết nối MySQL hoặc chạy seed. Chúng chứng minh các guard/cột/ID còn trong file; không thay thế import hoặc kiểm thử dữ liệu thực.

## Kết quả kiểm thử sau khi người dùng chạy seed

Lượt kiểm tra ngày **23/10/2026** dùng `.env` cục bộ, chỉ đọc `cleanhome_staff_test`. Không thực thi lại SQL, chạy server/worker hoặc phát JWT. Git status được kiểm tra trước khi làm; giữ nguyên thay đổi có trước, không sửa Frontend/Auth/Order.

### Kết quả chạy thực tế

| Bộ kiểm tra | PASS | FAIL | SKIP | Phạm vi |
| --- | --- | --- | --- | --- |
| `npm.cmd run test:unit` | 99 | 0 | 0 | Độc lập với MySQL/Auth/Order thật; có key và dependency double chỉ trong test |
| MySQL multi, `RUN_MYSQL_MULTI_TESTS=true` | 11 | 0 | 0 | 10 nhóm assertion và test cha; Repository/service trên dữ liệu hai nhân viên thật |
| MySQL generic + seed gốc, `RUN_MYSQL_TESTS=true` | 17 | 0 | 0 | Kiểm hồi quy schema, liên kết, quyền nghiệp vụ, snapshot và UC9–UC11 |
| `npm.cmd run test:http`, hai cờ HTTP bằng false | 0 | 0 | 1 | Bỏ qua trước khi mở kết nối; không coi là HTTP/JWT đạt |

Tổng **127 PASS / 0 FAIL / 1 SKIP**; MySQL gồm **28 PASS**. Không thực thi UC12 hoặc đối chiếu Order thật. Các unit test UC12 chỉ dùng dữ liệu trong bộ test, không thay đổi database.

### Dữ liệu và kết quả UC9–UC11

- Có **3 users, 2 employees, 5 bookings, 5 booking_items, 6 assignments**. Không có assignment thiếu employee/user/booking/Customer trong kiểm tra liên kết.
- A: user `9109002` → employee `9109004`, có bốn assignment. B: user `9109101` → employee `9109102`, có hai assignment. UC9 tách đúng quyền; filter theo trạng thái khớp dữ liệu lưu, sort asc/desc ổn định theo lịch và ID, nhiều trang không lặp/mất bản ghi, trang vượt cuối rỗng.
- UC10: truy cập chéo A↔B trả `null` tại Repository và lỗi nghiệp vụ `404 JOB_NOT_FOUND` khi gọi trực tiếp service, kể cả hai assignment cùng booking. **Đây không phải response HTTP đã được kiểm chứng.**
- UC11: bổ sung một nhóm test cho cả A/B, lấy ngày tham chiếu bằng `Intl.DateTimeFormat` với `Asia/Ho_Chi_Minh`, đối chiếu biên ngày UTC+7 từ `listQuery`, DTO ISO/timezone và đúng assignment giao khoảng lịch. Không chỉ dựng sẵn khoảng UTC như kiểm tra cũ.

| Nhân viên | Các ngày có công việc, dd/mm/yyyy | Giờ Việt Nam | UTC đã lưu |
| --- | --- | --- | --- |
| A | 22/10/2026, 24/10/2026, 26/10/2026, 27/10/2026 | 08:00–10:00 mỗi ngày | 01:00–03:00Z cùng ngày |
| B | 25/10/2026, 27/10/2026 | 08:00–10:00 mỗi ngày | 01:00–03:00Z cùng ngày |

Booking chung `9109131` giữ hai assignment riêng: A `9109133`, B `9109134`; mỗi người chỉ nhận một dòng của mình, không nhân bản dữ liệu vì dùng chung booking/service snapshot.

### Bảo toàn và giới hạn

Checksum trước/sau của các cột được chọn ở booking/assignment/item/lịch sử và metadata liên kết khớp hoàn toàn; snapshot riêng trong test cũng đạt. Không phải checksum toàn bộ cột của 32 bảng. Cả năm booking còn `CONFIRMED`; năm assignment còn `ASSIGNED`, assignment `9109123` còn `ACCEPTED` đúng seed. Tất cả check-in/check-out vẫn `NULL`, lịch sử booking vẫn 0 dòng.

HTTP dùng JWT do Auth cấp, tích hợp Order, UC12 thật, cạnh tranh đồng thời và worker phục hồi vẫn **chưa kiểm chứng**. Không tạo token vận hành hoặc bỏ middleware để vượt dependency. Không chạy Frontend/build toàn dự án.

Lượt này chỉ sửa `test/mysql.multi.integration.test.js` (thêm kiểm tra service từ chối truy cập chéo và lịch Việt Nam A/B), `docs/multi-employee-testing.md` và `README.md`. Kiểm cú pháp file test và `git diff --check` đạt. Không sửa source production, SQL, `.env` hoặc dữ liệu; không commit/push.

## HTTP/JWT và UC12 hai nhân viên — chưa được xác nhận bằng seed

HTTP cần server Staff, MySQL, credential/token Auth thật và, với UC12 hợp lệ, Order Service thực thi contract journal/idempotency/acknowledgement. Token A phải ánh xạ user `9109002`, token B ánh xạ user `9109101`. Không đổi `sub` của token có sẵn, không dùng JWT tự khai báo hoặc bỏ middleware để làm kiểm thử đạt.

Theo các biến của harness HTTP, bật đọc bằng `RUN_STAFF_HTTP_TESTS=true`. Muốn kiểm thử **có ghi** phải chủ động bật thêm `RUN_STAFF_HTTP_WRITE_TESTS=true` và chỉ định đúng `STAFF_HTTP_WRITE_BOOKING_ID=9109131`. Thiếu một điều kiện thì không được ghi. Không dùng booking gốc `9109007` hoặc các đơn khác làm đối tượng ghi.

Lần kiểm thử đủ sáu chuyển trạng thái A/B cần shared jobs `9109133`, `9109134` đều `ASSIGNED` mới, check-in/check-out `NULL`; booking chung cần đúng trạng thái đầu vào và Auth/Order thật sẵn sàng. Sau khi một nhân viên `DONE`, Order không được coi cả đơn `COMPLETED` khi người kia chưa xong. Order Service quyết định trạng thái tổng hợp và ghi lịch sử, Staff chỉ cập nhật assignment của mình.

Kiểm thử ghi **tiêu thụ shared fixture**: trạng thái và timestamp sẽ được lưu thật. Không có auto-reset hoặc rollback giả giữa hai microservice. Chạy lại seed giữ nguyên các thay đổi nên không tái tạo shared fixture mới; cần người phụ trách quyết định chuẩn bị một fixture khác nếu muốn lặp lại. Việc soạn SQL và test ở đây chưa xác nhận UC12, Auth/Order hoặc HTTP end-to-end đã chạy thành công.
