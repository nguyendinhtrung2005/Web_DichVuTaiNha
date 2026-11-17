# Rà soát luồng nghiệp vụ Customer — 07/11/2026

**Kết luận: chưa đạt hoàn toàn.** Các luồng thông thường chạy được, nhưng kiểm thử bổ sung tái hiện được ba vấn đề và một khoảng trống quy tắc. Test hiện có PASS không bao phủ hết những tình huống này.

**Cập nhật sau các yêu cầu sửa:** đã sửa nhận xét trắng, xác nhận lại khi đổi giá dịch vụ/sản phẩm và giới hạn giờ đặt lịch theo phê duyệt của chủ nhiệm. Những mô tả tái hiện bên dưới là bằng chứng trước sửa. Luồng hủy/bắt đầu đồng thời và tích hợp Admin/Staff vẫn chưa hoàn tất. Trạng thái triển khai và kiểm thử mới xem `customer-flow-corrections.md`.

Phạm vi: 8 use case trong `D:\DACN\mo_ta_uc_khach_hang.docx`, luồng sản phẩm riêng, frontend Customer → Gateway → services → MySQL; đối chiếu thêm ranh giới Staff/Admin. Theo các quyết định đã duyệt trong `customer-use-case-decisions.md`, hủy là **gửi yêu cầu chờ duyệt**, thanh toán là **mô phỏng**. Không coi hai quyết định này là lỗi so với tài liệu Word gốc.

Lượt này chỉ thêm báo cáo và script chẩn đoán `../tests/customer-business-audit.mjs`; không sửa mã runtime, schema, contract hay cấu hình triển khai. Giữ nguyên các thay đổi/xóa file có sẵn trong working tree, không đổi nhánh hoặc commit.

## Các phát hiện cần xử lý

### 1. Ưu tiên cao — giá có thể đổi trước khi tạo đơn mà không yêu cầu khách xác nhận lại

Bằng chứng trên fixture riêng qua HTTP và MySQL thật:

- Dịch vụ cấu hình `pricingMode=fixed`: GET trả giá 125.000; thay giá Catalog của đúng fixture thành 250.000 trước POST đặt lịch; API trả **201**, đơn lưu giá **250.000**.
- Sản phẩm: GET trả giá 42.000; thay giá đúng sản phẩm fixture thành 84.000 trước POST mua; API trả **200**, đơn `pending` có tổng **84.000**.
- Cả hai request chỉ chứa thông tin đặt hàng, không có quote/version để phát hiện mức giá khách vừa xem. Giao diện không có bước xác nhận lại khi server dùng mức mới.

Server tính giá từ Catalog là đúng để chống sửa giá trong trình duyệt. Vấn đề là thiếu cơ chế xác nhận khi mức giá thay đổi. Với sản phẩm, UI có ghi “Tạm tính” và server kiểm tra lại giá; đây chưa phải cam kết giá cố định, nhưng vẫn có rủi ro khách tạo đơn ở mức khác với màn hình xác nhận. Đơn mới chưa phải thanh toán thành công, không suy diễn thành đã trừ tiền thật.

Điểm liên quan: `order-service/src/app.js:181` và `:212`, `order-service/src/repository.js:132`; frontend `customer-booking.tsx` phần xem lại giá và `product-pages.tsx:311`/`:357`.

Hướng xử lý cần chốt: quote có phiên bản hoặc mức giá kỳ vọng được server đối chiếu với nguồn giá có thẩm quyền. Khi thay đổi, trả xung đột và hiển thị giá mới để khách xác nhận lại, không tự xác nhận thay khách. Không giải quyết bằng cách tin tổng tiền client gửi. Tác động Customer/Catalog/Order, cần thống nhất contract và quy tắc fixed/reference/survey trước triển khai.

### 2. Ưu tiên vừa — kiểm tra hủy chưa đồng bộ nguyên tử với nhân viên bắt đầu việc

`order-service/src/app.js:218` lấy trạng thái assignment từ Staff trước khi gọi `repository.requestCancellation`. Transaction tại `order-service/src/repository.js:386` khóa booking và kiểm tra lại trạng thái booking/yêu cầu hủy, nhưng không phối hợp nguyên tử với thay đổi assignment ở Staff.

Chẩn đoán mô phỏng thứ tự thực thi xác định:

1. Staff đọc snapshot assignment `ASSIGNED`.
2. Trước khi trả snapshot, adapter chuyển đúng assignment fixture trong MySQL sang `IN_PROGRESS`.
3. Order nhận snapshot cũ và vẫn ghi yêu cầu hủy, trả **201**.
4. Đọc lại: assignment đã `IN_PROGRESS`, yêu cầu hủy vẫn `pending`.

Giới hạn bằng chứng: adapter Staff được thay bằng bộ điều phối tình huống race, dùng repository Staff và MySQL thật. Gateway, Auth, Order và các service khác là HTTP thật. Đây là tái hiện khoảng đua trong kiểm tra, **không phải** kiểm thử nhân viên bấm bắt đầu từ website Staff thật. Đơn chưa bị tự hủy hoặc hoàn tiền.

Cần thống nhất với owner Staff/Admin về điểm quyết định trạng thái canonical và cách phối hợp chuyển trạng thái. Thêm một lần gọi REST kiểm tra vẫn có thể để lại khoảng đua; không tự ghi bảng assignment từ Order để né ownership. Cần có test đồng thời sau khi contract được chốt.

### 3. Ưu tiên vừa — nhận xét trống được API chấp nhận dù giao diện bắt buộc nhập

**Cập nhật sau rà soát:** đã sửa validation nhận xét tối thiểu 1 ký tự sau trim theo yêu cầu hoàn thiện Customer. Các ca HTTP/MySQL mới xác nhận nhận xét trắng bị chặn và không ghi dữ liệu; xem `customer-flow-corrections.md`, mục F. Phần dưới giữ bằng chứng của trạng thái trước sửa.

- UI `customer-order-detail.tsx:140` chặn nhận xét rỗng sau trim.
- Review API `review-service/src/app.js:34` dùng độ dài tối thiểu **0**.
- Với booking hoàn thành có assignment hợp lệ, POST `{rating:4, comment:'   '}` trả **201**, lưu `comment:''`.

Đây là lệch validation UI/API. Cần chốt nhận xét bắt buộc hay tùy chọn và đồng bộ cả hai phía. Nếu bắt buộc, server phải chặn chuỗi trắng; nếu chỉ chọn sao cũng hợp lệ, giao diện phải cho phép tương ứng. Chưa kết luận tài liệu yêu cầu mọi đánh giá bắt buộc có chữ khi quy tắc này chưa được xác nhận rõ.

### 4. Cần quyết định nghiệp vụ — khung giờ UI chưa được API thực thi

UI chỉ cho chọn `TIME_SLOTS`, kiểm tra tại `booking-validation.ts:30`/`:67`. API kiểm tra ngày giờ ISO hợp lệ và tương lai, nhưng chấp nhận **02:15 giờ Việt Nam**, trả **201**.

Quyết định hiện tại mục 5 trong `customer-use-case-decisions.md` ghi chưa có chính sách giờ làm/đặt trước/hạn đặt. Vì vậy đây là khoảng trống cần thống nhất, không khẳng định 02:15 trái một khung giờ đã được owner duyệt. Cần chọn: TIME_SLOTS là giới hạn nghiệp vụ bắt buộc hay chỉ là gợi ý giao diện; nếu bắt buộc phải có validation server dùng múi giờ Việt Nam. Chưa tự đặt ngày nghỉ, hạn hủy hoặc thời gian đặt trước.

## Đối chiếu các luồng

| Luồng | Kết quả kiểm tra | Giới hạn/còn lại |
|---|---|---|
| 2.1.2.1 Tài khoản | PASS đăng ký, login SĐT/email, logout, hồ sơ, phiên HttpOnly, ownership, inactive | Avatar/địa chỉ mặc định chưa hỗ trợ; session registry RAM không phải giải pháp nhiều instance production |
| 2.1.2.2 Dịch vụ | PASS tìm/lọc ba nhóm, vệ sinh phòng trọ/nhà ở, chi tiết, trạng thái cung cấp, lỗi API rõ | Không dùng mock làm fallback khi API lỗi |
| 2.1.2.3 Đặt lịch | PASS luồng bốn bước, snapshot, giá server, idempotency/retry, input cơ bản | Chưa đạt trường hợp đổi giá; khung giờ cần quyết định như trên |
| 2.1.2.4 Quản lý đơn | PASS danh sách/chi tiết đúng khách, phân trang, lịch sử/snapshot | Chưa chứng minh chu trình đổi trạng thái Staff/Admin thật |
| 2.1.2.5 Hủy | PASS gửi yêu cầu chờ duyệt, chặn trạng thái không phù hợp khi đọc ổn định, chống gửi trùng | Chưa đạt race nhân viên bắt đầu; duyệt hủy Admin chưa kết nối |
| 2.1.2.6 Thanh toán | PASS mô phỏng cash/transfer, bảo vệ ownership và không tạo PAID giả | Thanh toán thật/đối soát/hoàn tiền SKIP theo phạm vi đã chốt |
| 2.1.2.7 Đánh giá | PASS đơn hoàn thành, chống trùng, quyền sở hữu, điểm chung không PII, giữ input khi lỗi | Nhận xét trắng UI/API khác nhau; chưa có chính sách từ ngữ cấm |
| 2.1.2.8 Lịch sử | PASS bộ lọc server, ngày Việt Nam, dịch vụ snapshot ngừng bán, phân trang, đặt lại | Không biến lịch sử thành dữ liệu demo khi API lỗi |
| Sản phẩm riêng | PASS giỏ/thêm/sửa/xóa, mua không lịch hẹn, tồn kho server, đơn riêng, retry/recovery, hết hàng/API lỗi | Chưa có xác nhận đổi giá; chưa có quy trình vận chuyển/hoàn tất/hủy/hết hạn giữ tồn đã được tích hợp |
| Gợi ý sản phẩm tại dịch vụ | PASS gợi ý tự nguyện, không tự thêm giỏ hoặc đơn lịch | Không coi là thành phần bắt buộc của dịch vụ |

## Giới hạn tích hợp và bàn giao

- Customer dùng API/MySQL thật. Staff/Admin hiện vẫn dùng dữ liệu demo riêng trong localStorage; thao tác xác nhận/duyệt hủy/check-in/out tại hai website đó không cập nhật đơn Customer MySQL. Do đó **chưa đạt E2E toàn bộ ba vai trò**, dù các luồng Customer thông thường đã chạy qua browser.
- Contract chuyển trạng thái Staff–Order cần được tích hợp/kiểm chứng với owner; không dùng việc fixture chuyển booking sang hoàn thành làm bằng chứng Staff đã cập nhật thành công.
- Working tree hiện đánh dấu xóa `customer-api-contract.md`, `services-products-contract.md`, `customer-verification.md` và `databases/migrations/002_README.md`. Báo cáo giữ nguyên các xóa này. Cần nhóm xác nhận tài liệu contract chuẩn còn hiệu lực ở đâu trước bàn giao; README vẫn có liên kết tới các file bị xóa. Đây là vấn đề tài liệu, không phải bằng chứng endpoint ngừng chạy.
- Đây là rà soát nghiệp vụ và các ca kiểm thử liệt kê bên dưới, không phải chứng nhận bảo mật/toàn bộ hệ thống production.

## Kiểm thử thực tế trong lượt rà soát

Chạy tại `backend`, fixture đã được duyệt riêng trên database local:

```powershell
$env:ALLOW_CUSTOMER_DB_TEST='1'
npm.cmd test
node --env-file-if-exists=.env tests/customer-business-audit.mjs
npm.cmd run test:products:browser
```

Chạy tại `frontend`:

```powershell
npm.cmd run test:commerce
npm.cmd run typecheck
npm.cmd run build:customer
```

| Kiểm tra | Kết quả |
|---|---|
| Backend suite | PASS **100**, FAIL 0, SKIP 0; gồm unit/mock/security và HTTP/MySQL, không gọi tất cả là E2E thật |
| Frontend commerce suite | PASS **51**, FAIL 0, SKIP 0; unit/VM |
| Typecheck | PASS Customer/Staff/Admin |
| Customer production build | PASS compilation, TypeScript, static generation |
| Chrome + Next + Gateway/services + MySQL | PASS luồng sản phẩm và Customer thông thường, API lỗi/retry, phiên, giỏ, lịch sử/đánh giá, đặt lại; fixture riêng đã dọn |
| Script chẩn đoán nghiệp vụ | Đã tái hiện các quan sát phía trên; cleanup PASS. Exit 0 chỉ nghĩa script chạy/dọn xong, **không** nghĩa các quy tắc nghiệp vụ đó đạt |
| Dữ liệu trước/sau | PASS SHA-256 nội dung toàn bộ bản ghi của 19 bảng liên quan trùng khớp; không chỉ so số lượng |
| `node --check backend/tests/customer-business-audit.mjs` tại root | PASS cú pháp script chẩn đoán |
| `git diff --check` tại root | PASS; chỉ có cảnh báo LF/CRLF ở các file đang thay đổi, không có lỗi whitespace |
| Staff/Admin browser hồi quy mới trong lượt này | SKIP; không sửa runtime hai vai trò; có typecheck chung, không coi đó là test nghiệp vụ Staff/Admin |
| Payment/shipping thật, duyệt hủy và chuyển trạng thái ba vai trò | SKIP theo phạm vi/thiếu tích hợp nêu trên |

Script chẩn đoán chỉ thay giá/trạng thái và tạo đơn trên fixture có marker/ID riêng đã được cho phép, dọn đúng ID theo khóa ngoại. Không seed lại, không reset bộ `[TEST WEB V1]`, không chạy schema/migration. Nội dung bộ dữ liệu người dùng đang test và các đơn/đánh giá/thanh toán đã tạo được giữ nguyên. Auto-increment có thể tăng do fixture, không đặt lại counter.

Hướng ưu tiên tiếp theo: thống nhất cơ chế xác nhận giá → phối hợp hủy/bắt đầu với Staff → thống nhất nhận xét và giờ đặt lịch → nghiệm thu quy trình liên vai trò khi backend Admin/Staff sẵn sàng. Những phần này chưa được sửa trong lượt kiểm tra.
