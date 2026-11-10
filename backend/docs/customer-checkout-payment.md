# Thanh toán trong lúc đặt đơn Customer

Phạm vi chủ nhiệm chọn: cả đơn dịch vụ và đơn sản phẩm. Tiếp tục thanh toán mô phỏng cash/transfer đã được xác nhận; không tích hợp ngân hàng/vận chuyển và không tạo PAID giả. Owner Customer: Thưởng; không sửa màn hình/API riêng Admin/Staff.

## Dịch vụ — dùng contract hiện có

Ở bước kiểm tra yêu cầu, khách chọn phương thức rồi xác nhận. Frontend tạo booking bằng POST /api/v1/orders với requestKey và giá xác nhận, sau đó dùng POST /api/v1/orders/:id/payment-simulation {method:cash|transfer}. Cookie HttpOnly, CORS/Origin và ownership hiện có giữ nguyên. Tiền được lấy từ booking ở server.

Không thể coi hai request REST là một transaction DB xuyên service. Nếu booking đã tạo nhưng lưu thanh toán lỗi/timeout, giao diện phải nói rõ đã có lịch, giữ nguyên key/payload và cho thử lại trên đúng booking; không báo toàn bộ thất bại rồi tạo booking mới. Chỉ chuyển sang màn hình kết quả bình thường khi bước lưu phương thức được xác nhận. Khôi phục cùng tab giữ phương thức và pha đang xử lý; không lưu contact/token vào localStorage. Đơn đã có vẫn có thể cập nhật phương thức bằng màn hình chi tiết hiện tại.

## Sản phẩm — contract và migration đã được duyệt

Đề xuất mở rộng cùng POST /api/v1/product-orders, không tạo một luồng song song: thêm paymentMethod:cash|transfer. Với yêu cầu mới, trường này bắt buộc; replay yêu cầu cũ giữ tương thích hash cũ khi không có trường. Cùng requestKey nhưng đổi phương thức/nội dung trả 409 REQUEST_KEY_REUSED. Retry không tự đổi phương thức đã gửi.

Order ghi phương thức trong cùng transaction tạo journal product_orders. Migration additive 004_product_checkout_payment.sql chỉ thêm payment_method VARCHAR(16) NULL và CHECK CASH/TRANSFER. Không thêm bảng, không dùng payments.booking_id hoặc subscription_id sai mục đích. Các đơn cũ giữ NULL, không tự suy ra phương thức.

Response product order thêm payment:null cho đơn cũ, hoặc {method:cash|transfer,status:not_started|unpaid|pending,simulated:true}. PROCESSING/FAILED là not_started; chỉ khi đơn PENDING mới hiển thị cash=unpaid, transfer=pending. Đây là lưu lựa chọn thanh toán mô phỏng, chưa có giao dịch ngân hàng, nhận tiền hay PAID. Tổng tiền vẫn tính từ Catalog, không nhận amount/status/userId từ trình duyệt. Lỗi giá/tồn không tạo kết quả thanh toán thành công.

Consumer: Customer checkout, danh sách/chi tiết đơn sản phẩm. Provider: Order. Admin/Staff không thay hành vi. Chỉ backend Order đọc/ghi bảng product_orders; không thêm quyền Payment đọc trực tiếp bảng Order.

Schema chưa sẵn sàng: checkout mới cần phương thức trả 503 PRODUCT_PAYMENT_SCHEMA_NOT_READY, không fallback giả thành công. Đọc/replay đơn cũ vẫn cho phép theo schema cũ; không chạy DDL tự động.

## Quy trình migration đề xuất

Target xin duyệt: MySQL 127.0.0.1:3306/dich_vu_ve_sinh. Trước DDL kiểm tra DATABASE(), version, InnoDB, cột/CHECK chưa tồn tại, số lượng đơn và snapshot đọc phục vụ đối chiếu. Một ALTER duy nhất, không import schema.sql, không backfill hoặc seed. ALTER có thể giữ metadata lock; nếu lỗi/kết quả không rõ thì chỉ SELECT đối chiếu và dừng, không tự chạy lại hoặc DROP. Rollback cần sao lưu phương thức đã chọn và owner duyệt riêng vì bỏ cột sẽ mất dữ liệu mới.

## Kiểm thử dự kiến

- Chọn cash/transfer trước xác nhận cho hai loại đơn, hiển thị đúng trạng thái mô phỏng sau tải lại.
- Dịch vụ tạo lịch thành công rồi Payment lỗi/timeout: thử lại cùng key không tạo lịch hoặc giao dịch trùng; đổi tài khoản không nhận kết quả cũ.
- Sản phẩm validate enum/thiếu phương thức, chống role/amount/status injection; giá đổi/tồn thiếu không báo thanh toán thành công.
- Cùng key/phương thức lặp lại không tạo journal/giữ tồn trùng; đổi phương thức bằng cùng key bị chặn; legacy NULL được hiển thị rõ.
- Backend HTTP/MySQL và Chrome dùng fixture riêng đã được duyệt, dọn chính xác marker/ID; không thay dữ liệu web đang sử dụng. Unit/VM, typecheck ba app và build Customer.

Chủ nhiệm đã xác nhận owner duyệt contract và cho phép áp dụng migration 004 trên đúng target MySQL 127.0.0.1:3306/dich_vu_ve_sinh. Migration đã chạy một lần: MySQL 8.0.46, bảng InnoDB, cột/CHECK vắng trước ALTER; sau ALTER xác minh nullable VARCHAR(16), CHECK đúng CASH/TRANSFER và 6 đơn cũ vẫn NULL. Không import schema.sql, không thêm bảng, không backfill đơn cũ hoặc chạy rollback.

## Đã triển khai

- Customer dùng chung component `checkout-payment.tsx` cho bước kiểm tra dịch vụ và form xác nhận mua sản phẩm. Tiền mặt được chọn sẵn và hiển thị rõ trước nút xác nhận; khách có thể đổi sang chuyển khoản. Không có bước chuyển tiền thật.
- `booking-service.ts` dùng hai endpoint hiện có; `paymentMethod` là dữ liệu điều phối frontend, không nhét vào DTO POST booking. Chỉ báo hoàn tất khi Payment xác nhận đúng orderId/method/amount/trạng thái mô phỏng. Khi lỗi sau tạo lịch, `customer-booking.tsx` giữ key/payload, khóa việc sửa thành lịch mới và cho thử lại đúng lịch. `booking-draft.ts` giữ phương thức/pha lỗi trong bộ nhớ riêng từng khách và route.
- `product-commerce.ts` đưa paymentMethod vào body/signature, giữ nguyên khi recovery. Backend Order validate enum, đưa phương thức vào hash (không đổi hash cũ nếu field vắng), ghi cùng journal, trả payment theo trạng thái thực của đơn. Readiness được kiểm tra trước khi mượn connection giữ khóa để tránh kẹt pool nhỏ. Không đọc/ghi payments của đơn dịch vụ cho sản phẩm.
- `product-payment-schema.js` chỉ đọc metadata cột/CHECK; `check:products` dùng cùng kiểm tra này. Đọc/replay đơn cũ vẫn được, payment=null, UI ghi rõ chưa có lựa chọn thanh toán.
- `product-pages.tsx` hiển thị lựa chọn khi checkout và phương thức/trạng thái tại kết quả, danh sách, chi tiết. PROCESSING/FAILED không hiển thị đã thanh toán. Giỏ/đơn dịch vụ vẫn tách biệt.
- Các test/fixture request đã cập nhật cho DTO mới; không thay luồng riêng Admin/Staff, không commit/push/đổi nhánh. Không thêm dependency hoặc biến môi trường.

Khởi động lại backend và frontend hoặc build lại cùng phiên bản để nhận thay đổi. Môi trường khác phải được owner duyệt riêng migration 004; không chạy lại trên DB đã áp dụng. Dùng `npm.cmd run check:products` để kiểm tra chỉ đọc.

## Kết quả kiểm thử thực chạy

| Lệnh | Kết quả |
|---|---|
| backend: `$env:ALLOW_CUSTOMER_DB_TEST='1'; npm.cmd test` | PASS 111, FAIL 0, SKIP 0; unit/mock/security và HTTP/MySQL, gồm cash/transfer lưu/đọc lại, method trong hash, từ chối sửa status/amount, fail-safe khi thiếu schema, legacy NULL và các ca quyền sở hữu/401 có sẵn |
| frontend: `npm.cmd run test:commerce` | PASS 58, FAIL 0, SKIP 0; có thứ tự booking→Payment, mất ACK/retry đúng key/method, price conflict không gọi Payment, phiên đổi không gửi Payment cho tài khoản cũ, không chấp nhận PAID giả |
| frontend: `npm.cmd run typecheck` | PASS Customer/Staff/Admin |
| frontend: `npm.cmd run build:customer` | PASS production compilation, TypeScript, static generation |
| backend: `npm.cmd run test:products:browser` với fixture đã duyệt | PASS Chrome + Next + Gateway/services + MySQL; chọn transfer ngay trong checkout sản phẩm, cash/transfer khi đặt dịch vụ, mất phản hồi Payment sau commit rồi gửi lại vẫn chỉ một booking và một payment; hồi quy giá đổi/form/giỏ/phiên và các luồng Customer thông thường |
| backend: `npm.cmd run check:products` | PASS metadata migration 002 và 004, chỉ đọc |
| root: `git diff --check` | PASS, chỉ cảnh báo LF/CRLF |

Fixture đã dọn chính xác marker/ID. Đối chiếu SHA-256 và số lượng toàn bộ bản ghi trong 19 bảng với thời điểm trước ALTER: trùng khớp sau khi loại riêng cột payment_method mới khỏi phép so sánh nội dung cũ; cả 6 đơn cũ vẫn có NULL. Không nạp lại/reset dữ liệu web, không xóa dữ liệu người dùng, không đổi .env hoặc secrets.

Giới hạn: đây là thanh toán mô phỏng. Đơn sản phẩm lưu phương thức trong Order, không có bản ghi giao dịch ngân hàng. Hai API đặt lịch và Payment không phải một transaction xuyên service; UI hiển thị rõ trạng thái đã tạo lịch nhưng thanh toán chưa xác nhận nếu bước hai lỗi. Khôi phục form/key được giữ trong bộ nhớ tab, không tồn tại sau đóng/tải lại toàn bộ trang; các đơn đã lưu vẫn có trong danh sách và có thể cập nhật thanh toán dịch vụ tại chi tiết. Admin/Staff/đối soát ngân hàng/hoàn tiền không được triển khai trong lượt này.

## Sửa tình trạng không đặt được trên website local

Kiểm tra ngày 07/11/2026: frontend 3001 và cả 8 backend service đều trả health 200; check:db và check:products PASS. Nhưng POST qua đúng gateway 4000 đang chạy trả 400 INVALID_INPUT: dịch vụ từ chối expectedUnitPrice, sản phẩm từ chối paymentMethod. Tiến trình backend cũ chưa nạp contract đã cập nhật trong working tree.

Đã xác minh đúng launcher CleanHome đang giữ cả 4000–4007 rồi khởi động lại bằng mã hiện tại, giữ frontend 3001 đang chạy. Không sửa validation để bỏ các trường bảo vệ giá/thanh toán, không chạy migration hoặc seed thêm. Các phiên Auth cũ hết hạn theo thiết kế; người dùng cần tải lại trang/đăng nhập lại. Backend mới được giữ chạy; không cần mở thêm instance trùng cổng.

Kiểm chứng sau khởi động lại:

- `node --env-file-if-exists=.env tests/customer-live-smoke.mjs` với fixture đã duyệt: PASS; đăng ký fixture 201, đặt dịch vụ 201/pending, lưu thanh toán 200/unpaid, sản phẩm 200/pending với transfer/pending/simulated=true.
- Cùng lệnh thêm `--browser`: PASS trực tiếp trên localhost:3001 + localhost:4000, không dùng server/cổng test thay thế. Chrome thực hiện checkout sản phẩm/dịch vụ, recovery mất phản hồi booking/Payment, quyền sở hữu, API lỗi và xác nhận lại khi đổi giá.
- Script chẩn đoán ban đầu chạy HTTP trước browser nên đã dùng một đơn vị tồn fixture trước assertion stock=8 của browser; đã sửa chạy browser trước HTTP, không thay tồn kho hoặc logic production để bỏ qua lỗi test. Fixture được dọn trong cả lần lỗi và các lần PASS.
- So SHA-256 nội dung/số lượng bản ghi 19 bảng trước/sau: trùng khớp; dữ liệu người dùng giữ nguyên. Không đổi schema/config/nhánh hay mã chức năng trong lượt xử lý runtime này. Chỉ bổ sung script kiểm tra live và tài liệu.
- `node --check backend/tests/customer-live-smoke.mjs` và `git diff --check`: PASS. Không build/test lại toàn bộ vì không sửa mã runtime/frontend; bằng chứng chính là luồng thật trên các cổng người dùng đang chạy.
