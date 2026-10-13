# CleanHome — giao diện Customer, Giai đoạn 2

## Phạm vi Bước 1 và Bước 2

Chuẩn hóa màu sắc, typography và component dùng chung; nâng cấp Header, Footer và trang chủ Customer. Giữ thương hiệu CleanHome, nền trắng và xanh dương. Tái sử dụng font Be Vietnam Pro, component UI và hình ảnh đã có trong dự án.

Không hợp nhất ba ứng dụng, thay kiến trúc đăng nhập, sửa quyền truy cập hoặc chỉnh backend/database ở bước này. Các trang dịch vụ, đặt lịch, đơn, lịch sử, thanh toán, đánh giá và hồ sơ giữ nguyên luồng xử lý hiện có. Việc nâng cấp riêng các màn hình này thuộc các bước tiếp theo.

## Các file đã thay đổi

| File | Nội dung |
| --- | --- |
| `apps/customer/app/globals.css` | Màu trắng/xanh, font và theme Customer |
| `packages/ui/src/portal.css` | Design tokens, sửa cascade typography, style control/card/form/table và responsive |
| `packages/ui/src/common.tsx` | Field hint/error, nhãn modal, tiêu đề cột bảng |
| `packages/ui/src/components/ui/button.tsx` | Metadata kích thước/variant và transition |
| `packages/ui/src/components/shared/logo.tsx` | Vùng bấm logo tối thiểu 44px |
| `packages/ui/src/components/customer/site-header.tsx` | Header Customer mới, menu mobile, điều hướng và skip link |
| `packages/ui/src/components/customer/site-footer.tsx` | Footer có liên kết hoạt động, bỏ thông tin liên hệ mẫu |
| `packages/ui/src/components/customer/home-sections.tsx` | Hero, dịch vụ, quy trình, lợi ích, FAQ và CTA; bỏ số liệu/đánh giá quảng bá mẫu |
| `packages/ui/src/components/customer/service-card.tsx` | Thẻ dịch vụ, ảnh, hover và nhãn liên kết |
| `packages/ui/src/customer.tsx` | Chỉ đổi thành phần trang chủ; giữ nguyên Services/Booking |
| `packages/ui/src/portal.tsx` | Nối shell Customer và skeleton; bỏ thông tin tài khoản thử nghiệm khỏi UI Customer |
| `README.md` | Liên kết tài liệu Giai đoạn 2 |
| `docs/CUSTOMER_UI_PHASE2.md` | Phạm vi, giới hạn, kế hoạch gian hàng và hướng dẫn kiểm tra |

Màu chủ đạo là `#2563eb`, nền trắng và slate nhạt; giữ font Be Vietnam Pro. Menu Customer có thể đóng bằng Escape, khi bấm bên ngoài hoặc chọn liên kết. Thay phần đánh giá quảng bá bằng câu hỏi thường gặp; chức năng gửi/xem đánh giá trong đơn vẫn được giữ nguyên.

## Nguồn dữ liệu và giới hạn kỹ thuật

- `packages/core/src/store.ts` vẫn lưu dữ liệu trong localStorage theo ứng dụng và origin. Đây là cơ chế phục vụ phát triển, không phải cơ sở dữ liệu dùng chung.
- Đăng nhập/đăng ký hiện vẫn xác thực phía trình duyệt. Ẩn thông tin tài khoản thử nghiệm khỏi giao diện không biến cơ chế này thành xác thực an toàn. Không nhập mật khẩu thật hoặc dữ liệu cá nhân thật.
- Giá dịch vụ, đơn, tài khoản và đánh giá đang lấy từ dữ liệu mẫu hoặc các thay đổi lưu trong trình duyệt. Trang chủ không dùng số liệu mẫu, đánh giá mẫu hoặc cam kết chưa được xác minh để quảng bá.
- Luồng đặt lịch, hủy, thanh toán, đánh giá và cập nhật hồ sơ vẫn được giữ để phát triển. Thông báo của các luồng hiện có phản ánh thay đổi dữ liệu trong trình duyệt; chưa có xác nhận từ máy chủ, nhân viên hoặc ngân hàng.
- `packages/core/src/api-client.ts` chưa được các màn hình gọi. Biến cấu hình mock không tự chuyển toàn bộ ứng dụng sang API thật.
- Backend hiện chưa có API hoạt động. Giai đoạn xác thực, phiên, lưu đơn, phân công và thanh toán thật cần triển khai API và kiểm tra quyền tại server sau khi được duyệt riêng.
- Thông tin liên hệ trong `COMPANY` chưa được xác minh. Footer mới không công bố địa chỉ, số điện thoại hoặc email mẫu như thông tin doanh nghiệp thật. Chưa có route chính sách, nên không tạo liên kết tới trang chính sách không tồn tại.

## Gian hàng frontend-legacy — kế hoạch chuyển riêng

Giữ nguyên toàn bộ `frontend-legacy/`. Chưa chuyển gian hàng sang Next.js trong Bước 1–2.

1. Lập ánh xạ các route `/products`, `/user/products`, `/admin/products` và các model sản phẩm/đơn mua hiện có.
2. Chuyển catalog, tìm kiếm/lọc, trạng thái tồn kho và giỏ hàng; tái sử dụng component CleanHome hiện có.
3. Chuyển form đặt mua, lịch sử đơn mua và các trạng thái lỗi/tải/không có dữ liệu. Đơn mua tách biệt với đơn dịch vụ.
4. Chuyển màn hình quản trị sản phẩm, tồn kho và xử lý đơn; có validation và xác nhận thao tác quan trọng.
5. Khi có API đã duyệt: kiểm tra quyền sở hữu đơn, giá/tồn kho tại server, chuyển trạng thái hợp lệ và xử lý tồn kho nhất quán. Không dùng localStorage làm căn cứ xác nhận giao dịch thật.

## Chỉnh sửa nhỏ trước Bước 3

Lượt kiểm tra ngày 13/10/2026 chỉ thay đổi các file sau:

| File | Nội dung |
| --- | --- |
| `apps/customer/next.config.mjs` | Thêm `devIndicators: false` |
| `apps/staff/next.config.mjs` | Thêm `devIndicators: false` |
| `apps/admin/next.config.mjs` | Thêm `devIndicators: false` |
| `packages/ui/src/components/customer/home-sections.tsx` | Giảm cỡ chữ Hero ở breakpoint tablet để tiêu đề giữ hai dòng cân đối |
| `docs/CUSTOMER_UI_PHASE2.md` | Cập nhật kết quả kiểm tra thực tế |

`devIndicators: false` được hỗ trợ bởi schema và kiểu cấu hình của Next.js 16.3.6 đang cài trong dự án. Không sửa thư viện, cơ chế báo lỗi, logo hoặc kiến trúc ứng dụng.

Đã kiểm tra bằng Chrome headless trên các server development đang chạy:

- Customer `localhost:3001`, Staff `localhost:3002`, Admin `localhost:3003`: không còn phần tử biểu tượng Next.js hoặc nút Development Indicator hiển thị; logo CleanHome vẫn có. Portal dành cho overlay Next.js vẫn tồn tại.
- Customer tại **375px, 390px, 768px và 1440px**: kiểm tra Hero, thẻ dịch vụ, CTA xanh, Footer và menu bằng số đo DOM và screenshot. Không phát hiện tràn ngang, nội dung bị cắt bởi vùng chứa hoặc liên kết/nút nằm ngoài màn hình. `scrollWidth` bằng `clientWidth` tại cả bốn kích thước; không thêm `overflow-x: hidden`.
- Menu ở 375px, 390px và 768px mở/đóng được; Escape trả focus về nút menu. Chọn Dịch vụ chuyển tới `/dich-vu` và đóng menu. Các vùng bấm hiển thị trong Header/Footer đạt tối thiểu 44px; tám ảnh trang chủ tải thành công. Không ghi nhận exception JavaScript trong lượt kiểm tra.
- Typecheck và build production **Customer, Staff, Admin đều đạt** sau chỉnh sửa. Không thay đổi backend, database, auth, dependency hoặc các luồng nghiệp vụ.

Screenshot và báo cáo đo bố cục được lưu tạm tại `%TEMP%/cleanhome-customer-qa/smallfix/`. Đây là kiểm tra trên Chrome ở máy phát triển; chưa chạy trên thiết bị vật lý hoặc các trình duyệt khác. Dừng trước Bước 3 để người dùng kiểm tra.

## Bước 3 — danh sách và chi tiết dịch vụ

Đã nâng cấp riêng Customer, giữ nguyên thiết kế trang chủ và các dữ liệu dịch vụ đang có. Các file của Bước 3:

| File | Nội dung |
| --- | --- |
| `packages/ui/src/components/customer/service-catalog.tsx` | Tìm kiếm tên/mô tả có dấu hoặc không dấu; nhóm đang có; sắp xếp giá; trạng thái rỗng; grid 1/2/3 cột |
| `packages/ui/src/components/customer/service-detail.tsx` | Ảnh, giới thiệu, phạm vi, bao gồm/không bao gồm, chuẩn bị, giá và dịch vụ cùng nhóm |
| `packages/ui/src/components/customer/service-pages.tsx` | Kết nối dữ liệu, skeleton, dịch vụ không tồn tại và lỗi hiển thị có nút tải lại |
| `packages/ui/src/components/customer/service-card.tsx` | Tái sử dụng card; tùy chọn CTA đặt lịch và h2 cho catalog, dự phòng ảnh lỗi; mặc định trang chủ giữ nguyên |
| `packages/ui/src/customer.tsx` | Nối trang dịch vụ mới; Booking và tính giá giữ nguyên trong Bước 3 |
| `packages/ui/src/portal.tsx` | Container riêng cho trang dịch vụ; giữ `/dat-dich-vu/:id` qua đăng nhập/đăng ký Customer bằng `next` |
| `docs/CUSTOMER_UI_PHASE2.md` | Kết quả và giới hạn kiểm tra |

Đích quay lại chỉ chấp nhận `/dat-dich-vu/:id`, không nhận URL bên ngoài, query hoặc hash. Cơ chế xác thực, quyền truy cập và schema không thay đổi; Staff/Admin vẫn dùng đích đăng nhập cũ.

Kiểm tra Chrome tại **375, 390, 768 và 1440px**: catalog và cả sáu trang chi tiết, tổng cộng **28 lượt đo bố cục**, không phát hiện tràn ngang hoặc nội dung/nút bị cắt. Đã kiểm chứng tìm kiếm không dấu, xóa từ khóa và trả focus, lọc kết hợp, sắp xếp, điều hướng bằng Enter, dịch vụ liên quan, không có kết quả, danh sách rỗng, dịch vụ không tồn tại/inactive, dữ liệu lỗi và tải lại, ảnh lỗi và skeleton ban đầu. Đã kiểm chứng giữ dịch vụ qua đăng nhập/đăng ký và qua bốn bước Booking; lượt đó không xác nhận tạo đơn. URL quay lại bên ngoài bị bỏ qua. Không ghi nhận exception JavaScript. Artifact tại `%TEMP%/cleanhome-customer-qa/step3/`.

Build và typecheck Customer sau chỉnh sửa đạt. Chạy tuần tự hai lệnh: build tái sinh `.next/types`, nên chạy đồng thời với typecheck có thể làm typecheck báo thiếu file sinh ra; lượt kiểm tra lại sau build đã đạt.

Nguồn dữ liệu vẫn là store/localStorage hiện có; không tạo dịch vụ, mức giá hoặc đánh giá bổ sung. Next Image giữ tỷ lệ, lazy loading ở catalog và ưu tiên ảnh đại diện chi tiết; cấu hình `unoptimized` hiện có giữ nguyên, chưa triển khai dịch vụ tối ưu ảnh trên server. Đây là kiểm tra Chrome mô phỏng kích thước, chưa kiểm tra thiết bị vật lý hoặc trình duyệt khác.

Đường dẫn kiểm tra: `/dich-vu`, `/dich-vu/don-nha-theo-gio`, `/dich-vu/ve-sinh-sofa`, `/dich-vu/tong-ve-sinh`; nút đặt dịch vụ chuyển tới `/dat-dich-vu/dv-01`, `/dat-dich-vu/dv-03` tương ứng. Chưa nâng cấp Booking/Orders trong Bước 3; người dùng đã tiếp tục phê duyệt Bước 4.

## Bước 4 — đặt lịch và quản lý đơn Customer

Nâng cấp riêng các route `/dat-dich-vu`, `/dat-dich-vu/:id`, `/don-cua-toi` và `/don/:id` của Customer. Trang chủ, dịch vụ, Header/Footer và các màn hình Staff/Admin giữ nguyên. Trang lịch sử vẫn dùng màn hình hiện có, chờ Bước 5.

| File | Nội dung |
| --- | --- |
| `packages/ui/src/components/customer/customer-booking.tsx` | Form bốn bước, dữ liệu dịch vụ/đặt lại, sửa và quay lại, tổng kết, loading và khóa gửi trùng |
| `packages/ui/src/components/customer/booking-validation.ts` | Validation cạnh trường nhập: số lượng, liên hệ, thông tin nhà, ngày giờ tương lai, ghi chú; chặn kết quả giá/thời lượng không hữu hạn |
| `packages/ui/src/components/customer/booking-service.ts` | Interface `CustomerOrderService` và adapter bất đồng bộ cho lưu yêu cầu, yêu cầu hủy, phương thức thanh toán, đánh giá; phân biệt lưu thiết bị với chỉ giữ trong phiên |
| `packages/ui/src/components/customer/customer-orders.tsx` | Tìm mã/tên dịch vụ không dấu, trạng thái/ngày địa phương, sắp xếp, phân trang tám đơn, card mobile và bảng desktop, loading/empty/error |
| `packages/ui/src/components/customer/customer-order-detail.tsx` | Thông tin đơn và lịch sử có sẵn; quyền sở hữu, hủy có xác nhận, thanh toán, đánh giá và đặt lại |
| `packages/ui/src/customer.tsx` | Nối Booking mới; nội dung Home giữ nguyên |
| `packages/ui/src/portal.tsx` | Chọn component và container riêng cho các route Customer; Staff/Admin và lịch sử giữ component cũ |
| `docs/CUSTOMER_UI_PHASE2.md` | Báo cáo triển khai, kiểm chứng và giới hạn dữ liệu |

### Quy tắc dữ liệu và giới hạn

- Giữ nguyên `Order`, `AppState`, phiên bản seed và khóa localStorage hiện có; không bổ sung trạng thái draft, không chuyển đổi hoặc xóa đơn cũ. Không sửa `packages/core` hay kiến trúc xác thực.
- Giá và thời lượng gọi đúng `estimatePrice`/`estimateDuration` hiện có. Số lượng thập phân vẫn được chấp nhận theo core; thêm kiểm tra để không lưu `Infinity` thành `null`. Ngày giờ được lấy từ `TIME_SLOTS` hiện có, kiểm tra lại khi chuyển bước và trước khi lưu; đây là thời gian khách yêu cầu, chưa kiểm tra nhân viên rảnh.
- Nút cuối là **Lưu yêu cầu**. Store hiện tạo đơn `pending` trên trình duyệt; giao diện nói rõ lịch chưa xác nhận. Đây là yêu cầu lưu cục bộ, chưa gửi tới nhân viên hoặc hệ thống nghiệp vụ. Không tạo xác nhận đặt lịch thành công giả.
- Adapter kiểm tra kết quả store và bản ghi thực sự trong localStorage. Khi trình duyệt không lưu được, thông báo chỉ giữ trong phiên hiện tại; tải lại có thể mất thay đổi đó. Interface đã sẵn để thay adapter bằng API sau khi backend được triển khai; hiện chưa có đồng bộ giữa Customer/Staff/Admin hoặc giữa thiết bị.
- Hủy dùng chính `canRequestCancel` và `actions.requestCancel`: đơn pending/confirmed, chưa bắt đầu/hoàn thành và không có yêu cầu hủy đang chờ. Lưu yêu cầu hủy không chuyển đơn sang cancelled; việc duyệt thuộc quyền Admin hiện có.
- Thanh toán chỉ lưu phương thức cash/transfer. Không công bố tài khoản ngân hàng mẫu, không chuyển tiền hoặc tự xác nhận đã nhận tiền. Core hiện ghi nhãn lịch sử “Khách báo đã chuyển khoản – chờ xác nhận” khi chọn transfer; Customer diễn đạt thành lựa chọn chuyển khoản đã lưu, không sửa bản ghi hoặc logic Staff/Admin. Đánh giá vẫn chỉ mở cho đơn hoàn thành chưa có đánh giá.

### Kiểm chứng Bước 4

- Chrome development: **24 lượt đo bố cục** gồm bốn bước Booking, danh sách đơn và chi tiết đơn tại **375, 390, 768, 1440px**. Không phát hiện tràn ngang, chữ bị vùng chứa cắt hoặc nút nằm ngoài màn hình. Hộp thoại thanh toán nằm trong màn hình tại cả bốn kích thước; đã xem screenshot mobile/desktop. Không thêm `overflow-x: hidden`.
- Đã kiểm chứng đủ mười tình huống bắt buộc: dịch vụ → chi tiết → Booking (giữ dịch vụ qua đăng ký); quay lại không mất dữ liệu; trường bắt buộc; điện thoại sai; ngày giờ quá khứ; giá theo số lượng × đơn giá; hai lần submit chỉ tạo một đơn; danh sách/chi tiết; hủy được phép và bị chặn; tìm kiếm/lọc/danh sách trống.
- Kiểm tra mở rộng: chủ đơn khác bị từ chối, yêu cầu hủy trùng chỉ thêm một lịch sử và không đổi trạng thái, confirmed được phép yêu cầu hủy, in_progress/completed/cancelled hoặc yêu cầu hủy pending bị chặn. Thanh toán cash/transfer giữ đúng trạng thái chưa xác nhận; trình duyệt không lưu được hiển thị giới hạn phiên. Sắp xếp, phân trang, khoảng ngày sai, đặt lại, đánh giá không trùng, dữ liệu lỗi/tải lại và ID dịch vụ sai đều đã kiểm chứng. Không ghi nhận exception JavaScript trong lượt QA đầy đủ.
- Validation được kiểm tra riêng bằng TypeScript và các hàm core nguyên bản: **30 assertions đạt**, gồm số lượng rỗng/không hữu hạn/quá lớn, số nhà/phòng/tầng, giới hạn ký tự, ngày không tồn tại, khung giờ và bước có lỗi đầu tiên.
- Kiểm tra hồi quy thêm: đơn 01:00 tại Việt Nam lọc đúng ngày địa phương; Enter chuyển bước Booking và focus vào tiêu đề bước; Escape đóng hộp thoại, trả focus về nút mở trên điện thoại. Sau khi lưu hủy/đánh giá và nút thao tác biến mất, focus vào thông báo kết quả. Sự kiện đóng native dialog bị chặn trong lúc lưu. Không ghi nhận exception trong lượt kiểm tra này.
- Typecheck Customer/Staff/Admin và build Customer đạt. Chạy build rồi typecheck Customer tuần tự để tránh `.next/types` đang được tái sinh. Hash các file core, Home/Header/Footer và `orders.tsx` dùng cho Staff/Admin đối chiếu giữ nguyên; không sửa nguồn Staff/Admin, backend, database, legacy hoặc dependency.
- Các server đang chạy Customer/Staff/Admin trả HTTP 200 sau tích hợp. Chưa build lại Staff/Admin trong riêng Bước 4; typecheck cả ba và kiểm tra nguồn dùng chung được thực hiện, build Staff/Admin đã đạt ở lượt trước Bước 3.

QA dùng Chrome profile riêng, có timeout cho lệnh trình duyệt và toàn bộ lượt kiểm thử. Tài khoản và fixture kiểm tra chỉ tồn tại trong profile tạm; một số đơn đã có được gán chủ tạm để kiểm tra nhiều trạng thái/phân trang. Không tạo thêm đơn để trang đầy hơn; dữ liệu ban đầu của profile được khôi phục sau kiểm tra. Artifact tại `%TEMP%/cleanhome-customer-qa/step4/`. Chưa kiểm chứng trên thiết bị vật lý, trình duyệt khác, API lịch trống, đồng bộ backend hoặc giao dịch thanh toán thật.

Để kiểm tra, chạy `npm.cmd run dev:customer` từ `frontend`, mở `http://localhost:3001`. Chọn `/dich-vu/ve-sinh-sofa` → **Đặt dịch vụ ngay** → `/dat-dich-vu/dv-03`; kiểm tra bốn bước và **Lưu yêu cầu**, sau đó `/don-cua-toi` → `/don/:id`. Dừng sau Bước 4, chờ người dùng kiểm tra trước Bước 5.

## Bước 5 — lịch sử, hồ sơ và tài khoản Customer

Phạm vi: `/lich-su`, `/ho-so`, `/dang-nhap`, `/dang-ky` và phần chọn component Customer trong Portal. Không thiết kế lại các trang đã hoàn thiện hoặc chuyển sang Giai đoạn 3.

| File | Nội dung |
| --- | --- |
| `packages/ui/src/components/customer/customer-orders.tsx` | Tái sử dụng danh sách đơn với chế độ `history`; chỉ đơn hoàn thành của chủ tài khoản, tìm mã/tên dịch vụ, ngày địa phương, sắp xếp mới nhất, phân trang và đặt lại |
| `packages/ui/src/components/customer/customer-profile.tsx` | Xem/chỉnh sửa/lưu/hủy hồ sơ; giữ draft khi lỗi; giữ chức năng ảnh đại diện hiện có, kiểm tra định dạng/dung lượng và đọc ảnh |
| `packages/ui/src/components/customer/customer-auth.tsx` | Form đăng nhập/đăng ký Customer, validation cạnh trường, loading, chống gửi trùng và giữ đường dẫn quay lại |
| `packages/ui/src/components/shared/password-field.tsx` | Input mật khẩu dùng lại được; hiện/ẩn, autocomplete, nhãn và aria cho lỗi |
| `packages/ui/src/components/customer/account-validation.ts` | Họ tên, email, số Việt Nam, địa chỉ và mật khẩu theo quy tắc hiện có |
| `packages/ui/src/components/customer/account-service.ts` | Interface/adapter gọi store hiện có, đối chiếu dữ liệu localStorage và báo giới hạn phiên |
| `packages/ui/src/portal.tsx` | Nối lịch sử/hồ sơ/form Customer; giữ UI và hành động đăng nhập của Staff/Admin trong `InternalAuth` |
| `docs/CUSTOMER_UI_PHASE2.md` | Báo cáo Bước 5, tổng kết Customer và đề xuất Giai đoạn 3 |

### Quy tắc và giới hạn Bước 5

- Lịch sử giữ định nghĩa cũ: chỉ `completed`, thuộc Customer đang đăng nhập. Chi phí là giá đã lưu trong đơn; ngày dùng `scheduledAt` hiện có. Chưa có trường ngày hoàn thành riêng từ backend.
- Đặt lại đi tới `/dat-dich-vu/:orderId`, giữ thông tin cần thiết, yêu cầu ngày/giờ mới, tính bằng đơn giá dịch vụ hiện tại và vẫn qua bốn bước kiểm tra. Dịch vụ không còn hoạt động không có CTA đặt lại trong lịch sử. Không tự tạo đơn hoặc bổ sung lịch sử/đánh giá để trang đầy hơn.
- Hồ sơ chỉ sửa name/email/phone/address/avatar, giữ id/code/role/status/createdAt và passwordHashes. Địa chỉ mặc định có thể để trống; khi đặt dịch vụ, địa chỉ thực hiện vẫn bắt buộc. Số điện thoại cho phép di động hoặc điện thoại bàn tại Việt Nam và mã quốc gia 84; helper chuẩn hóa chỉ dùng validation, dữ liệu giữ định dạng người dùng nhập sau khi trim.
- Avatar vẫn lưu theo cơ chế hiện có: PNG/JPEG/WebP tối đa 1 MB; kiểm tra ảnh đọc được trước preview. Hủy hoặc đổi tài khoản hủy việc đọc ảnh; callback cũ không ghi đè draft. Lưu hồ sơ có lỗi giữ các giá trị đã nhập.
- `CustomerAccountService` tách thao tác khỏi UI. Hiện gọi `actions.login/register/updateUser`; lưu dữ liệu trên trình duyệt, chưa có API hồ sơ/tài khoản hoặc đồng bộ thiết bị. Khi localStorage không lưu được, giao diện nói rõ chỉ giữ trong phiên. Không thông báo đã cập nhật tài khoản trên máy chủ.
- PasswordField giữ giá trị mật khẩu khi hiện/ẩn. Đăng ký giữ tối thiểu tám ký tự như core; đăng nhập chỉ yêu cầu mật khẩu không rỗng để không khóa tài khoản cũ bằng điều kiện mới. Không trim mật khẩu, thêm log nhạy cảm hoặc lưu plaintext mới; cơ chế hash hiện có không thay đổi. Chưa có authentication chung, xác thực server, đổi/quên mật khẩu hoặc hệ thống production.
- Return path vẫn chỉ nhận `/dat-dich-vu/:id` như Bước 3–4; chuyển giữa đăng nhập/đăng ký giữ `next`. URL bên ngoài không được dùng. Staff/Admin tiếp tục dùng form, quyền và đích đăng nhập cũ. Header dùng trạng thái user từ store hiện có, cập nhật tên và trạng thái khi lưu/đăng xuất.

### Kiểm chứng Bước 5

- Chrome development: **20 lượt đo bố cục** cho đăng nhập, đăng ký, hồ sơ xem/chỉnh sửa và lịch sử tại **375, 390, 768, 1440px**. Không phát hiện tràn ngang, nội dung bị vùng chứa cắt hoặc nút ngoài màn hình; mỗi trang có một h1. Đã xem screenshot mobile/desktop, ảnh giữ tỷ lệ. Không thêm `overflow-x: hidden`.
- Đủ **10 tình huống yêu cầu đã đạt**: lịch sử rỗng; lịch sử các đơn hoàn thành; tìm mã/tên và lọc ngày; mở chi tiết; đặt lại; xem/chỉnh sửa hồ sơ; email/điện thoại sai; lưu/hủy; đăng nhập/đăng ký; đăng xuất và trạng thái Header. Lượt đầy đủ ghi nhận 22 kiểm tra chức năng và bảy kiểm tra trạng thái, không có exception JavaScript.
- Lịch sử đối chiếu đúng chủ tài khoản, chỉ `completed`, lịch thực hiện giảm dần và phân trang. Đặt lại giữ dịch vụ/số lượng/thông tin liên hệ, dùng giá dịch vụ hiện tại, để trống ngày/giờ và không tạo đơn. Dịch vụ inactive bị vô hiệu hóa CTA. Lỗi dữ liệu và tải lại đã kiểm chứng.
- Hồ sơ: lưu/hủy không thay đổi code/role/createdAt hoặc số đơn. Validation chặn dữ liệu sai; email trùng giữ draft và báo lỗi cạnh trường. Hai lần gửi chỉ ghi một lần. Tên mới cập nhật Header; focus đúng sau chỉnh sửa/hủy/lưu. Avatar kiểm tra MIME, ảnh quá 1 MB, ảnh hỏng, ảnh PNG hợp lệ và hủy khi đang đọc. Giả lập localStorage không lưu được đã hiển thị giới hạn phiên, không báo đã lưu trên thiết bị.
- Tài khoản: hiện/ẩn giữ nguyên mật khẩu, form bắt buộc/định dạng/độ dài/xác nhận, lỗi đăng nhập và focus vào trường hoặc thông báo. Validation chạy khi submit, xóa lỗi khi nhập để tránh thêm lỗi lúc blur làm nút dịch chuyển giữa thao tác chạm. Đăng ký chống gửi trùng, giữ vai trò Customer từ core; không lưu plaintext mới. Đăng nhập giữ cả khoảng trắng của mật khẩu. Giữ dịch vụ qua chuyển form và đăng nhập/đăng ký; URL quay lại ngoài website bị bỏ qua. Menu/đăng xuất được thao tác bằng Enter; sau đăng xuất, Header và các trang tài khoản trở về trạng thái chưa đăng nhập.
- Helper validation nguyên bản: **40 assertions đạt**, gồm tên Unicode, email, số di động/điện thoại bàn và mã 84, giới hạn độ dài, địa chỉ tùy chọn, mật khẩu/xác nhận và không sửa giá trị đầu vào.
- Build production Customer và typecheck Customer/Staff/Admin đều đạt sau thay đổi cuối. Build và typecheck Customer chạy tuần tự. Đối chiếu hash 18 file liên quan: 17 file core, trang chủ/Header/Footer, dịch vụ, Booking/chi tiết đơn và màn hình Staff/Admin giữ nguyên; `customer-orders.tsx` là thay đổi có chủ đích để tái sử dụng cho lịch sử. Không thêm dependency hoặc sửa backend/database/legacy. Git chưa commit được giữ nguyên; không commit/push/merge.

QA có timeout 20 giây/lệnh và 180 giây/lượt, dùng Chrome profile riêng; tài khoản kiểm tra sinh trong bộ nhớ, không đưa mật khẩu vào log. Một số đơn sẵn có được gán chủ tạm trong profile kiểm tra; dữ liệu ban đầu được khôi phục sau lượt QA. Screenshot/báo cáo ở `%TEMP%/cleanhome-customer-qa/step5/`. Trang đăng nhập trên ba server development đang có đều trả HTTP 200 và giữ CleanHome. Chưa kiểm chứng trên thiết bị vật lý, trình duyệt khác, API tài khoản/lịch trống, đồng bộ backend hoặc thanh toán thật. Riêng Bước 5 không build lại Staff/Admin; đã typecheck cả hai vì Portal/component thuộc package dùng chung.

Để kiểm tra, chạy `npm.cmd run dev:customer` trong `frontend`, mở `http://localhost:3001`: `/dang-nhap`, `/dang-ky`, `/ho-so`, `/lich-su`; từ lịch sử chọn **Chi tiết** hoặc **Đặt lại**. Có thể thử `/dang-nhap?next=%2Fdat-dich-vu%2Fdv-03` để kiểm tra giữ dịch vụ qua đăng nhập/đăng ký. Customer mới chưa có đơn hoàn thành sẽ thấy trạng thái rỗng đúng dữ liệu.

### Tổng kết UI Customer sau Giai đoạn 2

| Khu vực | Kết quả giao diện | Giới hạn chức năng |
| --- | --- | --- |
| Design system, Header/Footer, trang chủ | Đồng bộ trắng/xanh, typography/component và bố cục responsive | Giữ thương hiệu và dữ liệu hiện có |
| Dịch vụ/chi tiết | Tìm kiếm, nhóm, ảnh, nội dung, giá và CTA nối Booking | Danh mục và giá vẫn từ store |
| Đặt lịch/đơn/chi tiết đơn | Bốn bước, validation, quản lý đơn và thao tác có trạng thái | Yêu cầu cục bộ, chưa kiểm tra lịch trống hoặc gửi tới backend |
| Lịch sử | Chỉ đơn hoàn thành, lọc/tìm/sắp xếp/phân trang/đặt lại | Ngày/chi phí dựa trường đã lưu |
| Hồ sơ/tài khoản | Xem và sửa hồ sơ, ảnh, đăng nhập/đăng ký và hiện/ẩn mật khẩu | Auth/localStorage hiện có, chưa xác thực server hoặc đồng bộ ba ứng dụng |

Các màn hình Customer chính đã được chuẩn hóa theo phạm vi Giai đoạn 2. Chức năng hiện có được bảo toàn; chưa coi hệ thống là dịch vụ đặt lịch hoặc giao dịch production. Gian hàng, giỏ hàng, đơn mua và tồn kho legacy giữ nguyên, kế hoạch chuyển riêng nằm trong phần trước của tài liệu.

### Đề xuất Giai đoạn 3 — Staff và Admin

1. Chuẩn hóa bố cục làm việc, navigation, bảng/form, loading/empty/error cho hai ứng dụng bằng component/design token hiện có; giữ thương hiệu và ba ứng dụng riêng.
2. Staff: nâng cấp tổng quan, danh sách việc được phân công, lịch làm việc và chi tiết công việc; giữ quy tắc tiếp nhận/bắt đầu/hoàn thành, ghi chú và quyền xem đơn.
3. Admin: nâng cấp quản lý đơn và phân công trước, sau đó tài khoản, dịch vụ, thanh toán, đánh giá và báo cáo; giữ kiểm tra lịch trùng, chuyển trạng thái và quyền hiện có. Không bổ sung xác nhận thanh toán hoặc hoàn tiền thật khi chưa có API.
4. Kiểm thử responsive, thao tác bàn phím, quyền truy cập và luồng chuyển trạng thái; typecheck/build từng ứng dụng, ghi rõ dữ liệu cục bộ và các API còn thiếu. Gian hàng/tồn kho chuyển theo kế hoạch riêng đã đề xuất.

Đây chỉ là đề xuất; chờ người dùng kiểm tra và phê duyệt trước khi triển khai Giai đoạn 3. Hợp nhất đăng nhập/phân quyền là công việc Giai đoạn 4 theo yêu cầu, cần khảo sát và phê duyệt kiến trúc riêng.

## Kiểm tra và chạy tại máy

Kết quả kiểm tra Bước 1–2:

- TypeScript Customer/Staff/Admin đạt với `tsc --noEmit --incremental false`.
- Build production Customer đạt; trang chủ bản build trả HTTP 200.
- Kiểm tra mã xác nhận auth/store/types, các route wrapper và các file gian hàng legacy đã đối chiếu không thay đổi. Không thêm dependency, commit, push hoặc merge.
- Responsive đã được rà soát trong mã: menu thu gọn dưới 1280px; nút Hero xếp dọc trên điện thoại và được phép xuống dòng trên tablet; logo/menu có vùng bấm tối thiểu 44px. Ở màn hình dưới 360px, liên kết đăng nhập dùng biểu tượng có nhãn truy cập.
- Lượt Bước 1–2 ban đầu chưa chạy được Chrome headless. Đã hoàn tất kiểm tra trình duyệt trong lượt chỉnh sửa nhỏ trước Bước 3; xem kết quả phía trên.
- Bước 3 và Bước 4 đã hoàn tất theo phần báo cáo phía trên. Kết quả kiểm tra Bước 5 được ghi tại phần tương ứng; chưa triển khai Giai đoạn 3.

Từ thư mục `frontend`, trong PowerShell dùng `npm.cmd` để không phụ thuộc execution policy của `npm.ps1`:

```powershell
npm.cmd run typecheck --workspace=@cleanhome/customer -- --incremental false
npm.cmd run typecheck --workspace=@cleanhome/staff -- --incremental false
npm.cmd run typecheck --workspace=@cleanhome/admin -- --incremental false
npm.cmd run build:customer
npm.cmd run build:staff
npm.cmd run build:admin
npm.cmd run dev:customer
```

Customer chạy tại `http://localhost:3001`. Kiểm tra trang chủ, menu trên điện thoại, các liên kết dịch vụ/đơn/lịch sử/hồ sơ, đăng nhập và đăng ký. Kiểm tra keyboard, focus, zoom và chiều rộng điện thoại/tablet/desktop. Build chỉ sinh đầu ra qua công cụ; không chỉnh thủ công `node_modules`, `.next` hoặc các build output.
