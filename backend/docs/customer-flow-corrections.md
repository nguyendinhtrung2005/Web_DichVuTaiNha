# Hoàn thiện luồng Customer sau rà soát

Ngày 07/11/2026. Phạm vi Customer của Thưởng; giữ hủy chờ duyệt và thanh toán mô phỏng đã được xác nhận. Không khôi phục các contract đang bị xóa trong working tree; tài liệu này chỉ mô tả thay đổi bổ sung cần review.

## A. Nhận xét

Giữ hành vi giao diện hiện có: chọn điểm 1–5 và nhập nhận xét sau trim từ 1–2.000 ký tự. API Review đồng bộ validation này; chuỗi trắng trả 400 INVALID_INPUT với field comment, không ghi review. Không sửa schema hoặc đánh giá cũ. Triển khai trong phạm vi Customer theo yêu cầu sửa luồng của chủ nhiệm.

## B. Xác nhận giá — owner đã duyệt triển khai

Chủ nhiệm xác nhận owner đã duyệt Customer/Order–Catalog qua trả lời yêu cầu phê duyệt. Giới hạn thay đổi: xác nhận giá của Customer, không sửa chức năng Admin quản lý giá, không đổi schema.

- POST /api/v1/orders: thêm expectedUnitPrice (number, 0–9999999999.99, tối đa hai số thập phân) là đơn giá khách đang xác nhận. Với yêu cầu mới, thiếu trường trả 400; giá khác Catalog trả 409 PRICE_CHANGED, không tạo booking. Giá lưu vẫn do server tính từ Catalog, không tin expectedUnitPrice để tính tiền. Áp dụng cả fixed/reference/survey; với hai loại sau đây chỉ là xác nhận mức tham khảo hiện tại, không cam kết giá sau khảo sát.
- POST /api/v1/product-orders: mỗi item thêm expectedUnitPrice cùng giới hạn. Order lưu trong items_request JSON hiện có; không cần migration. Order truyền trường này sang POST /internal/v1/product-reservations. Catalog so giá khi đang giữ khóa sản phẩm/tồn kho trong transaction; khác giá trả 409 PRICE_CHANGED, không giữ tồn. Journal Order có thể ghi FAILED/PRICE_CHANGED để kết quả không mơ hồ, nhưng không tạo đơn pending hoặc thu tiền. UI giữ giỏ, tải giá mới và yêu cầu khách bấm xác nhận lại bằng requestKey mới.
- Theo envelope journal hiện có, Order trả HTTP 200 với `data.status=failed,errorCode=PRICE_CHANGED` khi đã xác minh không có reservation; HTTP 200 này chỉ xác nhận đọc được kết quả thất bại. Không diễn giải nó thành mua thành công. Booking đổi giá trả HTTP 409 trực tiếp, không có booking mới. Request sản phẩm mới thiếu giá xác nhận trả HTTP 400 PRICE_CONFIRMATION_REQUIRED trước khi tạo journal.
- Expected price thuộc nội dung idempotency. Cùng key và nội dung trả lại kết quả; đổi giá xác nhận/nội dung bằng key cũ trả REQUEST_KEY_REUSED. Retry sau timeout giữ nguyên key, giá, số lượng và liên hệ đã gửi. Không tự đổi giá trong request chưa biết kết quả.
- Khi Order trả PROCESSING, frontend vẫn giữ giỏ và yêu cầu khôi phục cũ; không tạo request mới bằng nội dung/giá khác trước khi biết kết quả. Chỉ trừ các dòng đã gửi khi trạng thái được xác minh là PENDING. Nếu kiểm tra/retry sau đó trả FAILED/PRICE_CHANGED, giỏ còn nguyên để khách xác nhận giá mới. Recovery trong bộ nhớ của tab, không lưu token/contact vào localStorage.
- Tương thích dữ liệu cũ: replay booking cũ không có expectedUnitPrice vẫn được đọc lại qua key/hash cũ; không cho tạo booking mới thiếu xác nhận. Journal sản phẩm cũ có reservation thì đọc lại kết quả đã biết; nếu chưa có reservation và thiếu giá xác nhận thì kết thúc FAILED/PRICE_CONFIRMATION_REQUIRED, không mua theo giá tự chọn. Không sửa dữ liệu cũ hàng loạt.
- Frontend không điều hướng sang thành công khi PRICE_CHANGED/PRICE_CONFIRMATION_REQUIRED; giữ form/giỏ và hiển thị bước xác nhận lại. Response/error envelope và auth cookie hiện có giữ nguyên.
- Test: tăng/giảm giá giữa xem và POST, thay giá trước giữ tồn, sửa giá từ client, thiếu/giá sai, không ghi booking/không giữ tồn khi xung đột, retry cùng key sau đổi giá/timeout, key cũ đổi nội dung, dữ liệu cũ, ownership/401.

## C. Khung giờ — chủ nhiệm đã duyệt

Đã duyệt dùng đúng lựa chọn UI hiện có làm khung giờ bắt đầu của booking mới tại Asia/Ho_Chi_Minh: 07:00, 07:30, 08:00, 08:30, 09:00, 09:30, 10:00, 10:30, 13:00, 13:30, 14:00, 14:30, 15:00, 15:30, 16:00. Giây/millisecond bằng 0. Thời điểm phải ở tương lai. Không suy ra quy tắc giờ kết thúc, ngày nghỉ hoặc hạn đặt trước. Replay booking đã lưu không bị từ chối vì giờ cũ ngoài danh sách hoặc đã qua.

## D. Hủy/bắt đầu và tích hợp ba vai trò — cần owner Staff/Admin

Không sửa assignment từ Order, không sửa frontend Staff/Admin hoặc biến dữ liệu demo của hai vai trò thành backend khi chưa có owner duyệt. Cần thống nhất hợp đồng chuyển trạng thái và điểm quyết định canonical để không nhận yêu cầu hủy dựa vào snapshot ASSIGNED cũ khi công việc đã bắt đầu. Thêm một REST read sau ghi không đủ bảo đảm nguyên tử. Các tài liệu Staff–Order được BACKEND_TEAM_RULES dẫn chiếu hiện không có trong checkout này; không tự đoán request/response hoặc tạo schema journal thay thế.

Owner Staff cần cung cấp/duyệt contract transition/operation/ACK, mapping trạng thái booking, quy tắc nhiều assignment và thứ tự kiểm tra hủy. Owner Admin cần contract xác nhận/phân công/duyệt hoặc từ chối yêu cầu hủy, quyền truy cập và xử lý payment mô phỏng. Phần này đang chặn quy trình end-to-end ba vai trò, không được báo hoàn tất chỉ bằng fixture.

## E. Hồ sơ và schema

Giữ tên/SĐT/email hiện có. Ảnh và địa chỉ mặc định chưa đủ schema/contract; không tự tạo cột/bảng hoặc lưu thông tin giả vào localStorage. Cần quyết định schema riêng nếu mở rộng các trường này.

## F. Đã triển khai và kiểm chứng

- Đã sửa `backend/review-service/src/app.js`: comment trim từ 1–2.000 ký tự, đồng bộ với giao diện Customer. Không thay endpoint, DTO, auth hoặc quy tắc đơn hoàn thành/ownership/chống đánh giá trùng.
- Đã cập nhật `backend/tests/customer-http.mysql.test.js`: từ chối chuỗi rỗng/trắng/tab/newline/NBSP/null/quá dài và điểm 0/6/không nguyên/chuỗi; kiểm tra không có bản ghi sau lỗi; sau đó cùng booking vẫn gửi đánh giá hợp lệ được và comment được trim. Giữ các ca ownership, 401, đơn chưa hoàn thành và duplicate có sẵn.
- Cập nhật lượt tiếp theo: chủ nhiệm đã duyệt B và C. Đã triển khai xác nhận giá qua frontend/Order/Catalog và validation giờ bắt đầu tại Order. D/E vẫn chờ contract/schema và phê duyệt phạm vi tương ứng; chưa sửa Staff/Admin hoặc mở rộng hồ sơ.

Các phần sửa cho B/C:

- `backend/order-service/src/app.js`: parse expectedUnitPrice, kiểm tra giá trước tạo booking, validation khung giờ chỉ cho yêu cầu mới; gửi giá xác nhận khi giữ sản phẩm, xử lý journal cũ thiếu xác nhận.
- `backend/order-service/src/repository.js`: hash có giá xác nhận nhưng giữ hash cũ nếu không có trường; lưu/đọc giá xác nhận trong JSON có sẵn; chặn journal mới thiếu giá, giữ FAILED/PRICE_CHANGED hoặc PRICE_CONFIRMATION_REQUIRED ở trạng thái kết thúc; đối chiếu snapshot trả từ Catalog.
- `backend/service-service/src/app.js`, `src/repository.js`: DTO reservation nhận giá xác nhận, kiểm tra trong transaction sau khóa sản phẩm, trước mọi tăng reserved_quantity. Giá tiền thực tế vẫn lấy từ server.
- `frontend/packages/core/src/product-commerce.ts`, `types.ts`: đưa giá đang hiển thị vào request, giữ nguyên trong recovery, giữ giỏ khi thất bại xác định; chỉ tạo key mới khi khách chủ động xác nhận yêu cầu mới.
- `frontend/packages/ui/src/components/customer/booking-service.ts`, `customer-booking.tsx`, `product-pages.tsx`: giữ dữ liệu nhập, tải giá mới, không tự submit lại/điều hướng thành công khi xung đột giá; thông báo rõ và yêu cầu bấm xác nhận lại.
- Tests: `customer-confirmation.test.js` mới; cập nhật fixture/test request hiện có cho contract mới. Test lịch sử tạo booking ở slot hợp lệ rồi chỉnh đúng snapshot fixture để vẫn kiểm tra biên ngày cũ ngoài slot; không mở lại API để làm test xanh. Test browser đổi giá fixture thật tại bước xác nhận và đối chiếu các request/key.

### Kiểm thử lượt sửa A (trước khi nhận phê duyệt B/C)

Lệnh thực chạy tại `backend` với `$env:ALLOW_CUSTOMER_DB_TEST='1'`:

| Lệnh | Kết quả sau sửa |
|---|---|
| `npm.cmd run test:mysql` | PASS 18, FAIL 0, SKIP 0, HTTP Gateway/services/MySQL thật với fixture riêng |
| `npm.cmd test` | PASS 101, FAIL 0, SKIP 0; có cả unit/mock và HTTP/MySQL |
| `npm.cmd run test:products:browser` | PASS Chrome + Next + Gateway/services + MySQL cho luồng Customer/sản phẩm thông thường, gồm đánh giá/giữ form/thử lại |
| `git diff --check` tại root | PASS, chỉ cảnh báo LF/CRLF |
| Typecheck/build mới | SKIP, lượt này không đổi frontend; không dùng kết quả trước đây để tuyên bố đã build lại |

Lần đầu test HTTP bị chờ do subtest mới dùng sai context cha; đã sửa context, dừng đúng phiên test và chạy cleanup chính xác registry của fixture bị ngắt theo quyền đã cấp. Lần chạy lại và toàn bộ suite đều PASS. Fixture browser được dọn tự động. Đối chiếu SHA-256 toàn bộ nội dung và số lượng bản ghi trong 19 bảng liên quan trước/sau trùng khớp; dữ liệu người dùng đang test được giữ nguyên. Không chạy migration/seed, không thay môi trường, không ghi vào mã Staff/Admin hoặc các file bị xóa sẵn. Không đổi nhánh/commit/push.

## G. Kiểm chứng sau triển khai B/C

| Lệnh/kiểm tra | Kết quả |
|---|---|
| backend: `$env:ALLOW_CUSTOMER_DB_TEST='1'; npm.cmd test` | PASS 108 / FAIL 0 / SKIP 0; unit/mock/security và HTTP/MySQL, gồm test mới giá tăng/giảm, từ chối đầu vào và không ghi/giữ tồn, replay giá đã đồng ý, key thay nội dung, journal cũ có/không reservation |
| frontend: `npm.cmd run test:commerce` | PASS 54 / FAIL 0 / SKIP 0; có giữ giỏ/new-key khi đổi giá, exact-payload recovery, PROCESSING rồi FAILED/PRICE_CHANGED, không gửi khi thiếu đơn giá |
| frontend: `npm.cmd run typecheck` | PASS Customer/Staff/Admin |
| frontend: `npm.cmd run build:customer` | PASS sau thay đổi cuối cùng, gồm compilation/TypeScript/static generation |
| backend: `npm.cmd run test:products:browser` với fixture đã duyệt | PASS Chrome + Next + Gateway/services + MySQL, các luồng thường và đổi giá thật lúc đang xem màn hình xác nhận; giữ form/giỏ, không tự gửi, giá mới/key mới chỉ sau lần bấm tiếp theo |
| backend: `node --env-file-if-exists=.env tests/customer-business-audit.mjs` với fixture đã duyệt | Service đổi giá: 409; lịch 02:15: 400; nhận xét trắng: 400; sản phẩm đổi giá: journal FAILED, không thành đơn pending; race hủy/bắt đầu vẫn tái hiện như mục D |
| Nội dung DB trước/sau | PASS SHA-256 và số lượng toàn bộ bản ghi 19 bảng trùng khớp; fixture/registry đã dọn, dữ liệu đang dùng được giữ nguyên |
| `git diff --check` | PASS, chỉ cảnh báo LF/CRLF |

Trong quá trình cập nhật test, ca mock replay cũ ban đầu so chữ ký bằng JSON thứ tự thuộc tính nên bị lệch; đã đổi mock sang hàm hash canonical đang dùng ở repository và chạy lại toàn bộ suite PASS. Test browser bổ sung ban đầu tìm link sản phẩm trong layout tài khoản không có link này; đã sửa cách mở trang bắt đầu ca kiểm thử, chạy lại PASS. Không nới validation runtime để bỏ qua lỗi test. Các lần lỗi đều dọn fixture qua finally.

Không migration/bảng/cột/biến môi trường mới. Giữ auth HttpOnly, ownership và định dạng lỗi hiện có. Khởi động lại backend và frontend hoặc build/deploy cả hai cùng phiên bản; client cũ không có xác nhận giá chỉ được replay kết quả cũ phù hợp, không tạo đơn mới.

Chưa hoàn tất D/E: hủy đồng thời với Staff bắt đầu, Admin duyệt hủy và toàn bộ chu trình ba vai trò chưa được tích hợp; avatar/địa chỉ mặc định chưa có contract/schema. Không tuyên bố toàn bộ nghiệp vụ đã hoàn tất.
