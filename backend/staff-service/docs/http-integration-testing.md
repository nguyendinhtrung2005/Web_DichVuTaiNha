# Kiểm thử HTTP/JWT thật — Staff UC9–UC12

Runner: `test/http.integration.test.js`; cấu hình và guard: `scripts/http-test-config.js`. Đây là bộ kiểm thử **chuẩn bị để chạy khi dependency sẵn sàng**, không phải bằng chứng Auth/Order đã tích hợp. Không tạo JWT, thay middleware, dựng API giả, import SQL hoặc reset dữ liệu.

## Điều kiện trước khi chạy

1. MySQL riêng `cleanhome_staff_test` có schema 32 bảng. Người dùng tự review/chạy `databases/seed_staff_test.sql` rồi `databases/seed_staff_test_multi.sql` bằng Workbench. Runner không thực thi hai file này. Xem [manifest và hướng dẫn seed](multi-employee-testing.md).
2. Staff server đang chạy tại `http://127.0.0.1:4005`, dùng **cùng database test và cấu hình JWT** với runner. Guard chỉ kiểm tra database kết nối từ runner; không thể suy ra cấu hình database của server từ URL. Không hướng server/Order/worker tới dữ liệu production.
3. Auth cung cấp issuer, audience, RS256 public key **hoặc** JWKS và ba access token còn hạn, được cấp qua quy trình Auth thật:

| Token | `sub` = `users.id` | Role | Employee |
| --- | --- | --- | --- |
| A | `9109002` | `EMPLOYEE` | `9109004` |
| B | `9109101` | `EMPLOYEE` | `9109102` |
| Customer | `9109001` | `CUSTOMER` | Không có |

`sub` là chuỗi ID, không phải `employees.id`. Claim `userId` tùy chọn phải trùng `sub`; middleware hiện chỉ lấy danh tính từ `sub`. Seed dùng hash/phone marker **không đăng nhập được**: thành viên Auth phải cung cấp quy trình cấp credential kiểm thử, không lấy marker làm mật khẩu hoặc tự ký JWT. Endpoint đăng nhập chưa được thống nhất nên runner nhận token đã cấp, không tự đoán URL login.

4. Với UC12, Order phải triển khai [bốn API và journal](order-service-contract.md), cấu hình `ORDER_SERVICE_URL`/`ORDER_SERVICE_TOKEN` thật. UC9–UC11 không bắt buộc Order; context/history UC10 là tùy chọn. Không bật worker chỉ để chạy kiểm tra đọc; worker cần pending/ack Order thật và có thể ghi phục hồi khi được bật.

## Cấu hình an toàn

Điền cấu hình trong `.env` cục bộ đã được Git ignore. Ưu tiên file token dưới `backend/staff-service/secrets/` (cũng ignore), chẳng hạn `STAFF_HTTP_TOKEN_A_FILE=secrets/staff-a.token`; mỗi file chỉ chứa access token hợp lệ. Cấu hình tương tự cho `_B_FILE` và `_CUSTOMER_FILE`. Mỗi token dùng **đúng một** nguồn: biến `STAFF_HTTP_TOKEN_*` hoặc biến đường dẫn `STAFF_HTTP_TOKEN_*_FILE`; để nguồn kia rỗng. Không đưa token, mật khẩu hoặc private key vào command line, tài liệu, ảnh chụp, template hay log.

Runner kiểm chữ ký RS256/issuer/audience/exp trước khi gọi API và kiểm mapping A/B với MySQL. Nó không cấp token, sửa claims, sửa hash đăng nhập hoặc tự mở server. Chỉ cho URL loopback, database test, timeout mỗi request 0,5–15 giây (mặc định 8 giây), toàn suite 240 giây, nhánh ghi 120 giây. Không gửi token sang redirect.

## Chạy phần đọc

Tại `backend/staff-service`, trong PowerShell, sau khi hoàn tất các điều kiện trên:

```powershell
$env:RUN_STAFF_HTTP_TESTS = 'true'
$env:RUN_STAFF_HTTP_WRITE_TESTS = 'false'
try { npm.cmd run test:http }
finally {
  Remove-Item Env:RUN_STAFF_HTTP_TESTS -ErrorAction SilentlyContinue
  Remove-Item Env:RUN_STAFF_HTTP_WRITE_TESTS -ErrorAction SilentlyContinue
}
```

Nhánh đọc kiểm 401 không token, 403 Customer token thật, 404 truy cập chéo A/B (kể cả cùng booking), UC9 lọc/sort/phân trang hai bản ghi mỗi trang, UC10 snapshot/liên hệ, UC11 ngày Việt Nam và khoảng rỗng, 404 không tồn tại và 400 ngày sai. Đối chiếu API với SQL chỉ đọc và kiểm dữ liệu trước/sau. Đây là các kiểm tra **sẽ chạy**, chưa phải kết quả đạt.

Nếu không bật `RUN_STAFF_HTTP_TESTS=true`, test bỏ qua trước khi nạp cấu hình/kết nối dependency. Khi đã chủ động bật nhưng thiếu JWT, sai mapping hoặc thiếu seed, test **thất bại**, không âm thầm đổi thành SKIP/đạt.

## Chạy phần ghi UC12 khi được phép

Chỉ dùng booking riêng `9109131`, assignments A `9109133` và B `9109134`. Cả hai phải còn `ASSIGNED`, check-in/out `NULL`, booking `CONFIRMED`, đúng marker fixture và chưa có journal Staff transition. Lịch sử tạo/xác nhận Order hợp lệ không bị cấm. Các bước đọc phải đạt trước bất kỳ PATCH ghi nào.

```powershell
$env:RUN_STAFF_HTTP_TESTS = 'true'
$env:RUN_STAFF_HTTP_WRITE_TESTS = 'true'
$env:STAFF_HTTP_WRITE_BOOKING_ID = '9109131'
try { npm.cmd run test:http }
finally {
  Remove-Item Env:RUN_STAFF_HTTP_TESTS -ErrorAction SilentlyContinue
  Remove-Item Env:RUN_STAFF_HTTP_WRITE_TESTS -ErrorAction SilentlyContinue
  Remove-Item Env:STAFF_HTTP_WRITE_BOOKING_ID -ErrorAction SilentlyContinue
}
```

Thiếu một trong ba xác nhận thì không chạy ghi. Chuỗi hợp lệ: A nhận → B nhận → A bắt đầu → B bắt đầu → A xong → B xong. Booking phải còn `IN_PROGRESS` khi chỉ A xong, chỉ `COMPLETED` khi cả hai `DONE`. Mỗi bước đối chiếu ACK Order, assignment/check-in/out, journal duy nhất, acknowledgement và retry cùng key không thêm trạng thái/lịch sử. Pending chỉ quan sát batch trả về, không chứng minh toàn hàng đợi rỗng.

Chỉ trong nhánh ghi, test còn kiểm PATCH chéo A/B trả 404, bỏ bước trả 409, đổi body với key cũ trả 409 `ORDER_REJECTED` cùng reason xung đột của Order và replay key nhận việc sau khi DONE không làm lùi trạng thái. Những request dự kiến bị từ chối vẫn cần cờ ghi vì lỗi phân quyền/nghiệp vụ của hệ thống có thể khiến chúng ghi thật.

**Kiểm tra ghi tiêu thụ fixture thật**, không phải rollback xuyên service. Nếu lỗi sau một phần thao tác, giữ nguyên trạng thái đã ghi để điều tra; test không reset, xóa journal hoặc chạy lại seed để ép trạng thái ban đầu. Chạy lại seed không làm mới fixture. Không dùng booking gốc `9109007` thay thế; cần nhóm thống nhất fixture mới nếu muốn lặp lại toàn chuỗi.

## Phạm vi chưa tự động kiểm chứng

- Chữ ký/expiry/sai role được kiểm độc lập bằng test double và key chỉ trong unit test; chỉ lần chạy trên token Auth thật mới chứng minh tích hợp issuer/key/claims hoạt động.
- Khóa tài khoản, thu hồi phiên, rotation JWKS, dependency timeout/crash sau commit, worker phục hồi và nhiều request DONE đồng thời cần môi trường/fixture riêng có kiểm soát. Không tự sửa tài khoản, dừng service của đồng đội hoặc gây lỗi database để chạy chúng.
- Không kiểm thử UI/Frontend, Gateway, production, giao dịch tiền hoặc hiệu năng tải lớn.
- Seed SQL mới chỉ được kiểm tra tĩnh cho tới khi người dùng chạy thủ công; test nhiều nhân viên/MySQL và test HTTP chưa được báo đạt trước lần chạy thực tế tương ứng.

## Tài liệu bàn giao

- [Checklist Auth](auth-handoff-checklist.md), [contract xác thực](auth-integration.md).
- [Checklist Order](order-handoff-checklist.md), [contract bốn API](order-service-contract.md).
- [Dữ liệu nhiều nhân viên và lệnh Repository test](multi-employee-testing.md).
