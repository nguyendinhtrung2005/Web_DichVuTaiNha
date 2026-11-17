# Bộ dữ liệu Customer để test trên website local

Marker: `CH_CUSTOMER_WEB_TEST_V1`; nhãn hiển thị: **[TEST WEB V1]**. Đây là dữ liệu tổng hợp lưu lại trong MySQL để thao tác bằng web, khác fixture E2E tự dọn. Không phải dữ liệu kinh doanh/đánh giá/thanh toán thật.

## Target, owner và phạm vi cần duyệt

- Target duy nhất: **127.0.0.1:3306 / dich_vu_ve_sinh**, MySQL8.0.46 đã kiểm tra chỉ đọc.
- Chủ nhiệm đã xác nhận owner Catalog/Staff đồng ý và duyệt nạp bộ lưu lại trong hội thoại ngày 07/11/2026. Đã apply đúng một lần, commit thành công; không cần chạy --apply lại.
- Dùng chi nhánh mặc định ACTIVE hiện cấu hình, preflight hiện thấy **ID22**. Chỉ đọc branches, không sửa branch hay .env và không đoán ID cho máy khác.
- Customer/Order/Review/Payment/Auth: Thưởng. Các bản ghi Catalog cần owner Trung và employees/assignments cần owner Tùng đồng ý cho dữ liệu tổng hợp. Không đổi code UI/API Admin/Staff hoặc coi họ đã tích hợp backend.
- Nhiều WIP đang tồn tại được giữ nguyên, gồm các file contract/tài liệu đang bị xóa trước nhiệm vụ. Không khôi phục hoặc sửa contract/schema/migration để nạp bộ dữ liệu này.

| Bảng ghi | Số bản ghi mới | Mục đích |
|---|---:|---|
| users | 5 | 4 Customer: có lịch sử, khác chủ, trống, inactive; 1 EMPLOYEE chỉ làm FK, không cấp tài khoản Staff web |
| employees | 1 | Nhân viên tổng hợp cho assignment/review |
| service_categories | 3 | Vệ sinh, Chăm sóc, Bảo dưỡng |
| services | 9 | 8 active, 1 ngừng cung cấp; phòng trọ/nhà gia đình, giá fixed/reference/survey và số lượng 0.5 |
| product_categories | 3 | Nhóm hàng vệ sinh/chăm sóc/bảo dưỡng |
| products | 9 | 6 hàng thường, 1 tồn một, 1 hết, 1 ngừng bán |
| product_images | 9 | Placeholder trung thực, không dùng ảnh giả như hàng thật |
| product_inventory | 9 | Tồn riêng của sản phẩm mới, không nạp lại tồn có sẵn |
| product_services | 9 | Gợi ý mua thêm tự nguyện, không bắt buộc |
| bookings | 14 | A có 12 đơn, B có 2; đủ 5 trạng thái |
| booking_items | 14 | Snapshot tên/đơn giá/số lượng |
| booking_status_history | 35 | Các bước trạng thái và một yêu cầu hủy đang chờ |
| assignments | 8 | ASSIGNED/IN_PROGRESS/COMPLETED phù hợp trạng thái mẫu |
| payments | 2 | CASH/TRANSFER mô phỏng PENDING; cash hiển thị unpaid, không PAID |
| reviews | 2 | Điểm 4 và 5 cho đơn completed; điểm chung dịch vụ phòng trọ 4.5 |
| product_orders | 4 | A: pending/processing/failed; B: pending để kiểm tra quyền |
| product_order_items | 3 | Snapshot của hai đơn pending |
| product_stock_reservations | 2 | Giữ hàng cho hai đơn pending, đúng operation/request hash |

**18 bảng ghi**, thêm mới toàn bộ. SQL là các INSERT tham số hóa trong `backend/scripts/prepare-customer-web-data.js`; UPDATE duy nhất tăng reserved_quantity của đúng sản phẩm vừa tạo cho đơn mẫu. Tất cả gói trong một transaction InnoDB; không ALTER/DROP/TRUNCATE/DELETE, không import schema, không sửa mật khẩu hoặc đơn của tài khoản có sẵn.

## Chống ghi đè, rủi ro và khôi phục

- Preflight kiểm tra actual database, schema001/002/003, engine InnoDB, branch, marker và SĐT/email mẫu chưa tồn tại. Giữ account thật hiện có và dữ liệu [DEMO] cũ.
- Muốn apply phải có phê duyệt và cờ `ALLOW_CUSTOMER_WEB_SEED=1`. Mặc định script chỉ xuất kế hoạch, không mở DB.
- Khóa theo database + marker để không seed hai lần đồng thời. Nếu marker/tài khoản/private file tồn tại, dừng thay vì reset, refill hoặc tạo trùng.
- Rủi ro: tăng dữ liệu tổng hợp, giữ tổng cộng 3 đơn vị tồn riêng cho hai đơn mua mẫu; thao tác web sau đó tiếp tục thay đổi dữ liệu theo API thật. Dãy auto-increment tăng và không được reset.
- Lỗi trước commit: rollback mọi bảng. Registry ghi phase rolledback; không tự ghi lại đè lên file riêng. COMMIT/ACK hoặc ghi file bị gián đoạn: có thể đã commit, giữ registry phase uncertain/committing và dùng --verify; không tự rerun apply hoặc xóa dữ liệu để làm sạch.
- Sau commit bộ dữ liệu được giữ lại. Dọn về sau cần duyệt riêng: kiểm tra registry ID/marker, phát hiện các đơn mới do bạn tạo và các FK/giữ tồn liên quan; chỉ xóa đúng dữ liệu đã được duyệt theo thứ tự con trước cha, không xóa theo prefix rộng, không giảm tồn sản phẩm cũ. Chưa có lệnh reset/cleanup tự động.

## Tài khoản và mật khẩu

| Tài khoản | Email đăng nhập | Vai trò kiểm thử |
|---|---|---|
| A | web-a@cleanhome.test | Có 12 lịch dịch vụ và 3 đơn mua, dùng thử hầu hết chức năng |
| B | web-b@cleanhome.test | Có dữ liệu riêng để kiểm tra không xem được đơn A |
| Trống | web-empty@cleanhome.test | Chưa có đơn/review/payment, thử empty state và tạo đơn mới |
| Khóa | web-locked@cleanhome.test | INACTIVE, đăng nhập phải bị từ chối |

Mật khẩu **ngẫu nhiên riêng từng tài khoản**, lưu vào `backend/.test-artifacts/customer-web-data/access.json` chỉ sau bước chuẩn bị apply; file bị Git ignore, không đưa vào source/chat/log. Trong DB chỉ có scrypt hash. File cũng có ID, URL từng service/product/booking/purchase để mở trực tiếp. Không gửi file này lên GitHub. Nhân viên mẫu không có mật khẩu đăng nhập được cấp trong file, không thay tài khoản demo Staff/Admin.

## Các lệnh

Chạy từ `backend`:

```powershell
node scripts/prepare-customer-web-data.js --plan
node --env-file-if-exists=.env scripts/prepare-customer-web-data.js --check
```

Chỉ sau khi owner đã duyệt ghi:

```powershell
$env:ALLOW_CUSTOMER_WEB_SEED='1'
node --env-file-if-exists=.env scripts/prepare-customer-web-data.js --apply
Remove-Item Env:ALLOW_CUSTOMER_WEB_SEED
node --env-file-if-exists=.env scripts/prepare-customer-web-data.js --verify
node --env-file-if-exists=.env scripts/prepare-customer-web-data.js --verify-http
node --env-file-if-exists=.env tests/customer-web-data.browser.mjs
```

--verify chỉ đọc ID/count đối chiếu registry. --verify-http mở stack ở cổng ngẫu nhiên, dùng Auth thật và HTTP thật để kiểm tra bộ ban đầu; không tạo/cập nhật đơn/review/payment, chỉ có session Auth trong RAM và tự đóng stack. Chạy trước khi tự thao tác web làm thay đổi các tình huống ban đầu.

Browser test mở Next/Chrome test riêng ở4301, đăng nhập bằng file mật khẩu local và chỉ xem các màn hình; không click tạo/hủy đơn, thanh toán, retry purchase hoặc gửi review. Kiểm tra cả phân trang, lịch sử, điểm chung, empty, khác tài khoản và inactive. Tự đóng đúng process test và khôi phục output next-env/tsconfig tạm do test tạo. Không dừng frontend/backend đang dùng của bạn.

## Test trên web

Từ root mở hai terminal, tránh chạy trùng service cũ:

```powershell
npm.cmd --prefix backend run start:customer
```

```powershell
npm.cmd --prefix frontend run dev:customer
```

Mở http://localhost:3001. Tài khoản/mật khẩu và đường dẫn đầy đủ lấy từ file riêng sau khi seed PASS.

1. **Xem dịch vụ khi chưa đăng nhập:** chọn ba nhóm, tìm [TEST WEB V1], xem scope/bao gồm/không bao gồm/giá. Mở URL service inactive trong registry phải báo không khả dụng.
2. **Đăng nhập A:** xem 12 đơn, phân trang 8 + 4. Dùng status/date/service filters; lịch sử có 4 completed, gồm đơn cũ 35 ngày. Ngày được tính tương đối lúc nạp theo giờ Việt Nam.
3. **Đặt mới:** chọn room/house để kiểm tra required house details, garden để thử số lượng 0.5/1.5; bỏ trống thông tin, chọn giờ quá khứ rồi sửa. Xác nhận xem đơn vừa lưu và giá server.
4. **Hủy:** pending có thể gửi yêu cầu; cancel-requested đã có yêu cầu phải hiển thị chờ duyệt và không báo đã hủy. working không được hủy; cancelled hiển thị trạng thái đã hủy. Đây là fixture trạng thái, không phải bằng chứng Admin đã xử lý qua API.
5. **Thanh toán:** transfer hiển thị pending, cash hiển thị chưa thanh toán. Chỉ đổi lựa chọn mô phỏng, không có nhận tiền/vận chuyển thật.
6. **Đánh giá:** mở review-ready (completed, chưa review), thử thiếu sao/nhận xét rồi gửi hợp lệ. reviewed có review sẵn, không gửi lặp. Trang room có sẵn 2 điểm 4 và 5 (trung bình 4.5) từ dữ liệu tổng hợp.
7. **Sản phẩm:** lọc nhóm/liên quan dịch vụ; gợi ý không tự thêm giỏ. Thử tồn một, hết hàng, inactive trực tiếp bằng URL registry. Thêm/sửa/xóa giỏ và mua riêng không chọn lịch hẹn. pending đã giữ hàng, processing có thể bấm kiểm tra để API ghi nhận thực, failed hết hàng phải báo lỗi đúng.
8. **Phân quyền:** mở cửa sổ ẩn danh đăng nhập B rồi dán URL đơn A: không được xem. B có 2 lịch dịch vụ và 1 đơn mua riêng. Trống phải không thấy đơn của A/B; tài khoản khóa không đăng nhập được. Sau khi bạn tạo đơn bằng tài khoản trống, nó đương nhiên không còn empty.

Không nạp lại script để khôi phục trạng thái sau test, không tự trả kho hoặc xóa các thao tác thật bạn vừa thử. Đây là bộ dữ liệu lưu lại cho bạn; các fixture E2E khác có marker riêng và không được dọn bộ này.

## Bằng chứng chuẩn bị

- Preflight MySQL chỉ đọc: PASS, đủ schema, branch22 ACTIVE, chưa có marker/tài khoản mẫu trùng.
- `node --test --test-isolation=none tests/customer-web-data.test.js`: PASS 5/5 (mock transaction/artifact, không ghi DB).
- `node --check scripts/prepare-customer-web-data.js`: PASS.
- Git ignore cho private access file: PASS.
- Apply MySQL: **PASS**, đã commit đủ 18 bảng đúng số lượng kế hoạch. Registry phase applied; tài khoản có sẵn và dữ liệu [DEMO] cũ được giữ nguyên.
- `node --env-file-if-exists=.env scripts/prepare-customer-web-data.js --verify`: **PASS**, khớp 14 kịch bản dịch vụ và 4 kịch bản đơn sản phẩm.
- `node --env-file-if-exists=.env scripts/prepare-customer-web-data.js --verify-http`: **PASS** HTTP thật: 4 trạng thái login, quyền sở hữu, empty, 5 trạng thái dịch vụ, pagination, reviews/summary, thanh toán mô phỏng, trạng thái hàng/đơn sản phẩm. Chỉ login tạo session RAM, không thay đổi dữ liệu nghiệp vụ.
- `node --env-file-if-exists=.env tests/customer-web-data.browser.mjs`: **PASS** Chrome thật + Next + API + MySQL trên bộ đã lưu: A có 12 đơn, trang2/2, 4 completed, review-ready và điểm chung; product states; tài khoản trống, B bị từ chối đơn A và inactive không login. Không có POST/PATCH/PUT/DELETE nghiệp vụ ngoài Auth. Lần kiểm tra một lần đầu dừng do nhãn assertion rút gọn “Chưa tạo đơn”; đã dùng đúng nhãn “Chưa tạo được đơn” trong harness và chạy lại PASS, không sửa ứng dụng hoặc bỏ assert.
- Đối chiếu lại sau browser: **PASS**, toàn bộ ID của 18 bảng còn nguyên và registry phase applied. Branch22 và .env giữ nguyên; secret file được git check-ignore xác nhận, không nằm trong staged changes. Không commit/push/đổi nhánh.
- Không chạy lại frontend build/typecheck hoặc toàn bộ backend suite trong bước apply: không đổi source runtime/frontend; test unit5, metadata, transaction apply, HTTP và browser là bằng chứng riêng của bộ dữ liệu này. Không coi đây là tích hợp Admin/Staff thật.

## Một số URL của bộ đã nạp

Đăng nhập A trước khi mở các đơn dưới đây. ID là của lần nạp local này, không hardcode vào code ứng dụng hoặc giả định giống máy khác.

| Tình huống | URL local |
|---|---|
| Chờ xác nhận, có thể gửi yêu cầu hủy | http://localhost:3001/don/108 |
| Đã xác nhận | http://localhost:3001/don/109 |
| Đang thực hiện | http://localhost:3001/don/110 |
| Hoàn thành, chưa đánh giá | http://localhost:3001/don/111 |
| Đã có đánh giá | http://localhost:3001/don/112 |
| Đã hủy | http://localhost:3001/don/113 |
| Yêu cầu hủy đang chờ | http://localhost:3001/don/114 |
| Chuyển khoản mô phỏng pending | http://localhost:3001/don/115 |
| Tiền mặt chưa thanh toán | http://localhost:3001/don/116 |
| Đơn mua pending | http://localhost:3001/don-san-pham/225 |
| Đơn mua đang xác minh, có thể thử kiểm tra lại | http://localhost:3001/don-san-pham/226 |
| Đơn mua failed do hết hàng | http://localhost:3001/don-san-pham/227 |
| Sản phẩm tồn một | http://localhost:3001/san-pham/113 |
| Sản phẩm hết hàng | http://localhost:3001/san-pham/114 |
| Sản phẩm ngừng bán | http://localhost:3001/san-pham/115 |
