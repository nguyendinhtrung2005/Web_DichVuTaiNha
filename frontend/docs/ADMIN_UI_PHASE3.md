# CleanHome — Giai đoạn 3B: giao diện Admin

Đã triển khai **3B.1, 3B.2 và 3B.3**. Bước 3B.3 hoàn thiện `/dich-vu`, `/thanh-toan`, `/danh-gia`, `/bao-cao`. Báo cáo 3B.1–3B.2 được giữ để đối chiếu; phần 3B.3 ghi riêng thay đổi và kết quả kiểm tra. Giai đoạn 4 chỉ được đề xuất, chưa triển khai.

## Phạm vi 3B.1 đã hoàn thành

Nâng cấp layout/navigation, Dashboard, danh sách và chi tiết đơn dịch vụ. Giữ ứng dụng Admin riêng, authentication và các action/core hiện có. Tại thời điểm hoàn tất 3B.1, chưa thực hiện 3B.2 hoặc 3B.3.

Trong 3B.1, các trang tài khoản, dịch vụ, phân công, lịch, thanh toán, đánh giá, báo cáo và hồ sơ mở component hiện có trong layout mới. Các thao tác phân công/ghi nhận thanh toán đã có trong chi tiết đơn được bảo toàn. Ba trang phân công, lịch và tài khoản đã được nâng cấp tiếp trong 3B.2.

## File thay đổi trong 3B.1

Các đường dẫn tính từ `frontend/`:

| File | Nội dung |
| --- | --- |
| `packages/ui/src/components/admin/admin-layout.tsx` | Sidebar có nhóm điều hướng, active state/thu gọn, menu mobile, Header/tài khoản/đăng xuất, skip link và Footer |
| `packages/ui/src/components/admin/admin-shared.tsx` | Header/skeleton/empty/error; helper tìm kiếm/ngày; guard dữ liệu chỉ đọc |
| `packages/ui/src/components/admin/admin-dashboard.tsx` | Chỉ số từ store, lọc ngày, biểu đồ, đơn gần đây và công việc cần xử lý |
| `packages/ui/src/components/admin/admin-orders.tsx` | Tìm kiếm, lọc trạng thái/ngày, sắp xếp, phân trang, bảng desktop/card mobile |
| `packages/ui/src/components/admin/admin-order-detail.tsx` | Thông tin đơn, lịch sử/ghi chú/đánh giá, xác nhận và xử lý các thao tác hiện có |
| `packages/ui/src/components/admin/admin-order-service.ts` | Adapter gọi action hiện có; phân biệt lưu localStorage và giữ trong phiên |
| `packages/ui/src/portal.tsx` | Nối layout và ba màn hình mới vào nhánh Admin |
| `apps/admin/app/globals.css` | Style riêng Admin theo palette CleanHome và kích thước vùng thao tác |
| `docs/ADMIN_UI_PHASE3.md` | Báo cáo, giới hạn, hướng dẫn kiểm tra và công việc còn lại |

Không thêm dependency, sửa schema/core, backend/database, frontend-legacy hoặc chức năng Customer/Staff. Giữ các thay đổi Git chưa commit; không commit/push/merge hoặc đổi nhánh.

## Dữ liệu và quy tắc

- Dashboard tính tổng đơn/trạng thái theo **ngày tạo đơn**; doanh thu chỉ cộng `payments.status === paid` theo **confirmedAt hoặc createdAt**. Tổng khách hàng/nhân viên tính toàn bộ tài khoản hiện có, gồm tài khoản bị khóa, như định nghĩa cũ. Ngày lọc dùng ngày địa phương. Khoảng ngày sai có lỗi rõ ràng.
- Doanh thu là tổng khoản đã xác nhận, **chưa trừ khoản cần hoàn tiền**. Không cộng unpaid/pending, không coi giá trị đơn là tiền đã thu. Không thêm số liệu, đơn, khách hàng hay đánh giá để làm đầy màn hình.
- Danh sách tìm mã đơn, tên liên hệ/tài khoản khách hàng, tên dịch vụ có dấu hoặc không dấu; ngày lọc là **lịch thực hiện**. Phân trang tám mục; giá hiển thị là `order.price` đã lưu, không tính lại từ giá dịch vụ hiện tại.
- Chi tiết giữ các action xác nhận đơn, sửa lịch/liên hệ/yêu cầu, phân công, duyệt/từ chối yêu cầu hủy và ghi nhận đã nhận tiền. Quyền Admin và điều kiện nghiệp vụ do action core hiện có kiểm tra lại khi lưu. Không thêm thao tác tự chuyển đơn sang đang thực hiện/hoàn thành; quy trình Staff vẫn waiting → accepted → in_progress → done.
- Phân công trong chi tiết chỉ mô tả xung đột dựa trên các lịch đã lưu, không khẳng định nhân viên trống lịch thực tế. Không thay đổi lịch hoặc giá ngầm trong thao tác khác.
- Xác nhận thanh toán chỉ cập nhật **bản ghi đã nhận tiền trên trình duyệt**. Không giao dịch ngân hàng, đối soát tự động hoặc thực hiện hoàn tiền. Duyệt hủy đơn đã trả tiền giữ cờ `refundRequired` theo core.
- Thông tin liên hệ, khối lượng, phạm vi công việc, nhân viên, lịch sử, ghi chú thực hiện và đánh giá được hiển thị từ dữ liệu có sẵn; thiếu dữ liệu liên quan có thông báo rõ.
- Modal có xác nhận, loading, lỗi giữ nội dung, mutex tránh gửi trùng và quản lý focus. Không báo đã đồng bộ máy chủ. Lưu không được vào localStorage được thông báo chỉ giữ trong phiên.
- Guard UI báo lỗi cho cấu trúc dữ liệu không đọc được, không tự sửa/xóa/thay thế dữ liệu. Component dùng chung đã có được tái sử dụng; style mới giới hạn Admin.

## Kết quả kiểm tra 3B.1

- **Build production Admin đạt; typecheck Admin, Customer và Staff đạt** sau thay đổi cuối. Build và typecheck Admin chạy tuần tự để tránh tranh chấp file types đang được Next.js sinh lại. Không build lại Customer/Staff trong 3B.1.
- **Chrome development: 36 lượt bố cục** tại **375, 390, 768, 1440px**, gồm Dashboard, danh sách, chi tiết và sáu hộp thoại xác nhận/sửa lịch/phân công/duyệt hủy/từ chối/ghi nhận tiền. Không phát hiện tràn ngang, nội dung bị vùng chứa cắt hoặc nút vượt chiều rộng. Đã xem screenshot mobile/desktop. Badge cho phép tăng chiều cao khi xuống dòng, không che lỗi bằng overflow-x hidden.
- **24 kiểm tra chức năng đạt:** đăng nhập bằng tài khoản hiện có; đối chiếu bảy chỉ số với store; doanh thu paid-only; khoảng ngày địa phương; tìm mã/khách hàng/dịch vụ không dấu; lọc trạng thái/lịch; sắp xếp/phân trang; mở chi tiết; ngày gần nửa đêm UTC vẫn lọc đúng ngày Việt Nam; hủy xác nhận; hai submit chỉ ghi một lịch sử; sửa lịch giữ giá; phân công; duyệt/từ chối hủy; ghi nhận tiền; menu mobile/Escape; đổi mobile sang desktop tự đóng menu; thu gọn sidebar; các route cũ; đăng xuất.
- **13 kiểm tra trạng thái đạt:** khoảng ngày Dashboard/danh sách sai, không có kết quả, lịch quá khứ bị từ chối, localStorage không ghi được chỉ báo giữ trong phiên, đơn đã bắt đầu/hoàn thành không có thao tác sửa/phân công, dữ liệu rỗng, dữ liệu sai cấu trúc và tải lại, đơn không tồn tại, sai vai trò và tài khoản bị khóa.
- **Tám kiểm tra bổ sung đạt:** ảnh dịch vụ tải và giữ tỷ lệ; Escape trả focus về nút mở; validation đưa focus vào trường lỗi và Enter lưu rồi focus thông báo; duyệt hủy đơn đã bắt đầu bị disabled nhưng vẫn cho từ chối yêu cầu theo core; ảnh sai kiểu và tên tài khoản sai kiểu có error state an toàn; menu tại ba chiều rộng mobile/tablet có đủ mười liên kết và vùng bấm tối thiểu 44px; kiểm tra Dashboard desktop sau thay đổi cuối. Không ghi nhận exception JavaScript trong các lượt hoàn tất.
- **58 assertions hồi quy adapter/core đạt** trong VM với storage riêng: xác nhận đúng trạng thái, lịch tương lai/trùng lịch, phân công/đổi nhân viên và giữ accepted khi chọn cùng nhân viên, từ chối hủy in_progress/completed vẫn hợp lệ, duyệt hủy các trạng thái này bị chặn, khoản paid chỉ được đánh dấu cần hoàn tiền khi duyệt hủy, ghi nhận tiền giữ nguyên amount/trạng thái đơn, không lặp thao tác, lỗi quota, sai vai trò/tài khoản khóa và bảo toàn giá/đơn khác. Script: `%TEMP%/cleanhome-admin-order-adapter-check.cjs`.
- Đối chiếu hash **95 file** core, Customer, Staff, UI/component dùng chung đã có và màn hình quản lý cũ: giữ nguyên. Khối CustomerLayout/Auth trong Portal đối chiếu nguyên vẹn; nhánh Staff giữ component/quyền/route hiện có. Kiểm tra khoảng trắng file thay đổi và Git diff không báo lỗi. Không hoàn tác thay đổi Git cũ.
- Route `/phan-cong`, `/lich-lam-viec`, `/tai-khoan`, `/dich-vu`, `/thanh-toan`, `/danh-gia`, `/bao-cao`, `/ho-so` mở được trong layout mới bằng tài khoản Admin. Đây là kiểm tra điều hướng, **chưa kiểm thử đầy đủ nghiệp vụ** của các màn hình dành cho 3B.2–3B.3. Customer/Staff chỉ typecheck và đối chiếu nguồn, không chạy lại các luồng trình duyệt.

QA dùng Chrome profile riêng, không truy cập dữ liệu trình duyệt của người dùng. Fixture chỉ dùng các bản ghi hiện có để kiểm tra ngày giáp UTC, yêu cầu hủy sau khi đã bắt đầu, dữ liệu rỗng/sai kiểu; không thêm dữ liệu để làm đầy giao diện. Dữ liệu gốc trong profile QA được khôi phục và đối chiếu sau từng lượt. Mật khẩu không được đưa vào log/artifact. Timeout 20 giây/lệnh CDP, 240 giây cho lượt đầy đủ và 90 giây cho lượt bổ sung. Chrome QA đã đóng sau kiểm tra; Admin development được giữ tại cổng 3003 để người dùng xem giao diện.

Artifact: `%TEMP%/cleanhome-admin-qa/phase3b1/` và `%TEMP%/cleanhome-admin-qa/extra/`. Báo cáo `qa-report-partial.json` của lượt đầy đủ và `extra/qa-report.json` có `dataRestored: true`.

## Giai đoạn 3B.2

Chỉ nâng cấp phân công, lịch làm việc và quản lý tài khoản. Giữ nguyên layout/navigation, Dashboard, danh sách/chi tiết đơn, action/core, authentication và schema. Không chỉnh Customer, Staff, backend/database hoặc frontend-legacy; không thêm dependency và không commit/push/merge.

### File thay đổi trong 3B.2

Các đường dẫn tính từ `frontend/`; sáu component/helper mới và hai file cập nhật:

| File | Nội dung |
| --- | --- |
| `packages/ui/src/components/admin/admin-assignment.tsx` | Tìm/lọc/phân trang đơn; chọn nhân viên, lịch trong ngày, điều kiện và xác nhận phân công |
| `packages/ui/src/components/admin/admin-calendar.tsx` | Lịch ngày/tuần/tháng/danh sách tuần, bộ lọc, xung đột và mở chi tiết |
| `packages/ui/src/components/admin/admin-accounts.tsx` | Bảng/card, tìm/lọc/sắp xếp/phân trang; chi tiết, sửa, thêm, khóa/mở khóa |
| `packages/ui/src/components/admin/admin-account-service.ts` | Whitelist trường sửa/tạo; gọi action hiện có; báo lưu trên trình duyệt hoặc chỉ trong phiên |
| `packages/ui/src/components/admin/admin-dialog.tsx` | Dialog dùng chung cho 3B.2: xác nhận, loading, khóa thao tác khi lưu, lỗi và focus |
| `packages/ui/src/components/admin/admin-scheduling.ts` | Helper trạng thái công việc, điều kiện phân công và xung đột theo core |
| `packages/ui/src/portal.tsx` | Nối ba route Admin với component mới; giữ nhánh Customer/Staff và Auth |
| `docs/ADMIN_UI_PHASE3.md` | Báo cáo 3B.2, giới hạn, hướng dẫn kiểm tra và kế hoạch 3B.3 |

### Quy tắc được bảo toàn

- Phân công mặc định hiển thị đơn đã xác nhận, chưa có nhân viên, theo lịch thực hiện tăng dần. Có thể tra cứu trạng thái khác và đơn đã phân công; đơn chưa xác nhận, đã bắt đầu/hoàn thành/hủy hoặc lịch quá khứ chỉ xem thông tin, không được phân công.
- Nhân viên bị khóa hoặc trùng lịch đã lưu có nút chọn disabled. Danh sách công việc trong ngày và xung đột lấy từ dữ liệu hiện có; không khẳng định nhân viên trống lịch thực tế. Core vẫn kiểm tra lại khi lưu. Giữ lịch thực hiện, giá đã lưu và các đơn không liên quan.
- Mutex chặn hai lần gửi đồng thời; chọn nhân viên đang được giao không tạo lại phân công. Đổi sang người khác tiếp tục dùng action gốc và trạng thái tiếp nhận của core.
- Lịch chỉ đọc, có ngày/tuần/tháng và danh sách tuần. Tuần bắt đầu thứ Hai; ngày từ input được đọc theo giờ địa phương, không cắt ngày từ ISO UTC. Mặc định bỏ đơn đã hủy; có bộ lọc riêng để xem đơn đã hủy. Nhân viên đã khóa hoặc không còn trong danh sách vẫn không làm mất công việc đã lưu.
- Xung đột lịch kiểm tra với toàn bộ store, gồm công việc hoàn thành hoặc nằm ngoài bộ lọc, đúng quy tắc hiện có. Khoảng giờ sát nhau ở hai đầu không bị coi là trùng theo core. Xem/đổi bộ lọc không thay đổi ngày giờ hoặc phân công.
- Quản lý tài khoản chỉ tác động Customer/Staff; không cấp quyền Admin, không đổi role, ID, mã, ngày tạo hoặc trường authentication. Sửa họ tên, email, số điện thoại, địa chỉ và vị trí của Staff; thông tin khác được giữ nguyên. Adapter whitelist trước khi gọi action cũ.
- Giữ chức năng thêm Customer/Staff có sẵn, với bước xem lại và xác nhận trước khi tạo. Khóa/mở khóa có xác nhận, không xóa tài khoản/đơn liên quan; tài khoản đang đăng nhập không được khóa.
- Validation dùng lại helper hồ sơ, có focus vào trường sai và giữ nội dung khi lưu lỗi. Core giữ quy tắc email trùng; **tạo tài khoản chưa chặn số điện thoại trùng**, còn sửa tài khoản có kiểm tra số điện thoại trùng. Không thêm quy tắc nghiệp vụ ngầm vào UI.
- Không hiển thị mật khẩu/hash. Việc cấp thông tin đăng nhập khi thêm tài khoản vẫn theo cơ chế mặc định của core hiện có; chưa có quy trình cấp mật khẩu an toàn qua backend. Không thay đổi authentication trong 3B.2.
- Loading/skeleton, empty/error và lỗi dữ liệu không đọc được dùng component hiện có. Dialog có Escape, focus quay về nút mở, lỗi/loading và chặn đóng/gửi trùng khi đang lưu; không tự sửa hoặc thay thế dữ liệu sai cấu trúc.

### Kiểm tra 3B.2

- Build production Admin và typecheck Admin/Customer/Staff đạt. Build và typecheck Admin chạy tuần tự.
- Chrome development: **52 lượt bố cục đạt** tại **375, 390, 768, 1440px**: phân công/danh sách nhân viên/xác nhận; lịch ngày/tuần/tháng/danh sách; tài khoản và các dialog chi tiết/sửa/khóa/thêm/xác nhận thêm. Không phát hiện tràn ngang, vùng chứa cắt nội dung hoặc nút vượt màn hình. Đã xem screenshot mobile/desktop; không dùng `overflow-x: hidden` để che lỗi. Nhãn vai trò được rút gọn sau kiểm tra ảnh để dễ đọc trong select.
- **28 nhóm chức năng đạt** (15 nhóm phân công/lịch, 13 nhóm tài khoản, gồm đăng nhập trong mỗi lượt): danh sách đúng dữ liệu; tìm mã/khách hàng/dịch vụ không dấu; lọc; focus khi chọn đơn; hủy/Escape trả focus; phân công hợp lệ, gửi hai lần chỉ thêm một lịch sử và giữ giá/lịch/đơn khác; chặn cùng nhân viên/xung đột/khóa/đơn sai trạng thái; bốn chế độ lịch, lọc công việc, điều hướng chi tiết và bảo toàn dữ liệu; ngày Việt Nam giáp UTC, nhân viên khóa và xung đột ngoài bộ lọc; tìm tên/email/phone, lọc/sắp xếp/phân trang tài khoản; chi tiết/liên hệ/đơn liên quan; validation/focus/draft; lỗi trùng email/phone; sửa hợp lệ/khóa/mở khóa giữ tài khoản và đơn khác; tạo Customer/Staff qua hai bước, không cấp Admin và chống tạo trùng khi gửi hai lần.
- **19 nhóm kiểm tra trạng thái đạt**: nhân viên khóa; trùng với công việc hoàn thành; bốn trạng thái đơn không đủ điều kiện; lịch quá khứ; đơn đổi trạng thái khi dialog đang mở; tài khoản biến mất khi sửa; localStorage lỗi ở phân công và tài khoản; đơn/lịch/tài khoản/nhân viên rỗng; dữ liệu tài khoản/lịch sai cấu trúc; tìm kiếm không có kết quả; sai vai trò và Admin bị khóa trên cả ba route. Không ghi nhận exception JavaScript trong lượt này.
- **Bốn kiểm tra bổ sung đạt**: bấm lại đơn đang chọn vẫn đưa focus đến panel; đổi nhân viên giữ giá/lịch/đơn khác và chỉ thêm một lịch sử; Enter lưu tài khoản và focus thông báo; nhãn vai trò cuối cùng tại cả bốn chiều rộng. Gồm **bốn lượt bố cục bổ sung**, tổng cộng **56 lượt bố cục**. Không ghi nhận exception JavaScript trong các lượt hoàn tất.
- **12 kiểm tra adapter tài khoản đạt** bằng core/auth thực tế trong VM có storage riêng: tạo Customer/Staff, position, sửa hợp lệ, whitelist trường được phép, chặn Admin/actor thiếu hoặc khóa, email/số điện thoại theo core, ID không tồn tại, khóa/mở khóa và giữ nguyên đơn, lỗi storage chỉ báo giữ trong phiên. Script `%TEMP%/cleanhome-admin-qa/admin-account-regression.mjs`.
- **35 assertions lịch đạt**: tuần thứ Hai, giao năm, tháng nhuận/tháng ngắn, 31/1 sang tháng sau, bốn chế độ xem, 23:30 UTC sang ngày Việt Nam tiếp theo, giờ kết thúc qua ngày, lọc, nhân viên bị khóa, xung đột ngoài bộ lọc và dữ liệu deep-freeze chỉ đọc. Script `%TEMP%/cleanhome-admin-calendar-check.cjs`.
- Đối chiếu hash **102 file được bảo toàn**: core, Customer, Staff, component dùng chung/màn hình cũ và toàn bộ component/style/config 3B.1 giữ nguyên. Khối CustomerLayout/Auth trong Portal đối chiếu nguyên vẹn. Sáu file mới không có lỗi khoảng trắng; `git diff --check` không báo lỗi. Không hoàn tác thay đổi Git có trước.

QA dùng Chrome profile riêng `cleanhome-admin-phase3b2`, không truy cập/reset localStorage của người dùng. Tình huống lỗi dùng tạm các bản ghi hiện có trong profile QA; kiểm tra chức năng tạo tài khoản chỉ tạo hai tài khoản QA trong profile riêng, không bổ sung dữ liệu nguồn hoặc làm đầy giao diện. Sau mỗi lượt khôi phục đúng chuỗi dữ liệu ban đầu và đối chiếu `dataRestored: true`. Không log mật khẩu/hash. Lệnh CDP có timeout 20 giây; lượt bố cục/chức năng 240 giây, lượt trạng thái 180 giây và lượt bổ sung 90 giây. Chrome QA đã đóng sau kiểm tra; dùng server development Admin đã có tại cổng 3003 để người dùng xem giao diện.

Artifact 3B.2: `%TEMP%/cleanhome-admin-3b2-qa/`, gồm screenshot/báo cáo `layout/qa-report.json`, `states/qa-report.json`, `extra/qa-report.json`, `functional/assignment-calendar/qa-report-partial.json`, `functional/accounts/qa-report-partial.json` và `preservation-report.json`. Các báo cáo trên có đối chiếu phục hồi dữ liệu; hai script chức năng lưu cờ `dataRestored` trong báo cáo `partial` sau `finally`.

## Giai đoạn 3B.3

Hoàn thiện bốn trang quản lý còn lại, giữ layout/sidebar CleanHome và tái sử dụng Card, Field, Button, badge, AdminDialog, skeleton/empty/error đã có. Không sửa core/schema/authentication, backend/database, frontend-legacy, Customer/Staff, style hoặc component của 3B.1–3B.2; không thêm dependency.

### Toàn bộ file thay đổi trong 3B.3

Các đường dẫn tính từ `frontend/`: tám file mới và hai file cập nhật.

| File | Nội dung |
| --- | --- |
| `packages/ui/src/components/admin/admin-display.ts` | Định dạng ngày và guard dữ liệu bổ sung, chỉ đọc |
| `packages/ui/src/components/admin/admin-services.tsx` | Danh sách/chi tiết, tìm/lọc/phân trang, thêm/sửa, hoạt động/ngừng cung cấp và xóa theo core |
| `packages/ui/src/components/admin/admin-service-service.ts` | Validation, whitelist đầu vào, gọi action dịch vụ cũ và kiểm tra lưu dữ liệu |
| `packages/ui/src/components/admin/admin-payments.tsx` | Tìm/lọc/sắp xếp/phân trang, chi tiết và xác nhận đã nhận tiền qua adapter đơn hiện có |
| `packages/ui/src/components/admin/admin-reviews.tsx` | Danh sách/chi tiết, tìm/lọc/phân trang và xác nhận ẩn/hiện đánh giá |
| `packages/ui/src/components/admin/admin-review-service.ts` | Adapter ẩn/hiện; giữ nội dung, số sao và dữ liệu liên quan |
| `packages/ui/src/components/admin/admin-report-data.ts` | Tính số liệu theo định nghĩa Dashboard và tạo các dòng CSV |
| `packages/ui/src/components/admin/admin-reports.tsx` | Khoảng ngày, chỉ số, biểu đồ, dịch vụ, công việc nhân viên và xuất CSV |
| `packages/ui/src/portal.tsx` | Nối bốn route Admin với component mới; giữ nhánh Customer/Staff và Auth |
| `docs/ADMIN_UI_PHASE3.md` | Báo cáo 3B.3, giới hạn, hướng dẫn kiểm tra và đề xuất Giai đoạn 4 |

### Chức năng và quy tắc

- **Dịch vụ:** ảnh giữ tỷ lệ, bảng desktop/card mobile; tìm tên và mô tả có/không dấu, lọc nhóm/trạng thái, phân trang tám mục. Xem đầy đủ giá/đơn vị, khối lượng, thời lượng, phạm vi và nội dung bao gồm/không bao gồm từ dữ liệu hiện có. Thêm/sửa qua hai bước xem lại và xác nhận; validation số hữu hạn, quan hệ khối lượng tối thiểu/mặc định, nội dung và đường dẫn ảnh. Không áp đặt trần giá/thời lượng mới. Giữ ID/slug khi sửa, không tính lại giá hoặc lịch của đơn đã lưu.
- Giữ thao tác ngừng/mở dịch vụ và xóa đã có trong core, đều có xác nhận. Dịch vụ có bất kỳ đơn liên quan nào không được xóa, kể cả đơn đã hủy; core kiểm tra lại khi lưu. Không bổ sung dịch vụ vào dữ liệu nguồn để làm đầy trang.
- **Thanh toán:** tìm mã thanh toán/mã đơn/khách hàng; lọc trạng thái, phương thức, khoản cần hoàn và ngày tạo bản ghi theo giờ địa phương; sắp xếp/phân trang tám mục. Chi tiết liên kết đơn, hiển thị số tiền/phương thức/ngày tạo/ngày xác nhận và cờ cần hoàn. Ngày lọc của danh sách giữ cơ sở ngày tạo bản ghi; doanh thu báo cáo dùng ngày ghi nhận theo định nghĩa Dashboard.
- Ghi nhận đã nhận tiền chỉ gọi `adminOrderService.confirmPayment` hiện có. Chặn bản ghi đã paid, đơn đã hủy hoặc thiếu đơn liên quan; giữ amount, phương thức, giá và trạng thái đơn. Không giao dịch ngân hàng/đối soát/hoàn tiền. `refundRequired` chỉ là khoản cần xem xét, không phải khoản đã hoàn.
- **Đánh giá:** tìm khách hàng/dịch vụ/mã đơn/nội dung; lọc số sao dịch vụ, hiển thị, dịch vụ, nhân viên; sắp xếp/phân trang tám mục. Chi tiết hiển thị riêng số sao dịch vụ và nhân viên, nhận xét, lý do ẩn, ngày và đơn liên quan. Ẩn cần lý do; hiện lại có xác nhận. Chỉ cập nhật hidden/hiddenReason qua action cũ, không sửa nhận xét hoặc số sao. Đánh dấu hiển thị trong dữ liệu Admin hiện tại chưa đồng bộ sang Customer.
- **Báo cáo:** tổng đơn/trạng thái theo ngày tạo đơn; doanh thu chỉ cộng `payments.status === paid` theo `confirmedAt || createdAt`, lọc ngày địa phương như Dashboard. Tổng Customer/Staff gồm tài khoản khóa, không lọc theo ngày. Doanh thu gộp chưa trừ khoản cần hoàn; số bản ghi cần hoàn lấy toàn bộ dữ liệu, có nhãn giải thích rõ.
- Biểu đồ doanh thu tháng, trạng thái đơn và lượt dùng dịch vụ lấy số liệu hiện có. Lượt dùng dịch vụ bỏ đơn đã hủy, giữ đơn có dịch vụ không còn trong danh sách. Công việc theo nhân viên lấy phân công/trạng thái hiện tại của các đơn được tạo trong khoảng; giữ nhân viên khóa hoặc thiếu tài khoản. Đây không phải lịch sử phân công hoặc thước đo chất lượng nhân viên.
- CSV giữ hai cột và các dòng chỉ số/dịch vụ cũ trước, bổ sung trạng thái/tháng/công việc nhân viên sau. Tái sử dụng helper xuất CSV hiện có: UTF-8 BOM, dấu phẩy/dấu ngoặc kép và bảo vệ giá trị có ký tự mở đầu công thức. Lỗi tải file có thông báo, không báo xuất thành công giả.
- Ngày hiển thị trên bốn trang mới dùng `dd/mm/yyyy`, thời điểm dùng `HH:mm dd/mm/yyyy`. Không đổi bộ lọc ngày địa phương hoặc định dạng của các trang 3B.1–3B.2. Ô nhập ngày native vẫn theo locale trình duyệt; Chrome QA hiển thị `mm/dd/yyyy` trong ô nhập.
- Dialog có Escape, focus quay về nút mở, validation/focus trường sai, giữ draft khi lỗi và mutex chống gửi trùng. Kiểm tra dữ liệu/actor/bản ghi hiện tại trước khi lưu. Lưu được báo trên trình duyệt; lỗi storage chỉ báo giữ trong phiên. Guard chỉ đọc báo dữ liệu sai, không tự xóa/sửa/thay thế dữ liệu.

### Kết quả kiểm tra 3B.3

- **Build production Admin và typecheck Admin/Customer/Staff đạt** sau thay đổi cuối. Build và typecheck Admin chạy tuần tự; không build lại Customer/Staff.
- **Chrome development:** bốn trang mới và các dialog được kiểm tra tại **375, 390, 768, 1440px**, gồm **60 lượt bố cục**; không phát hiện tràn ngang, nội dung bị vùng chứa cắt hoặc nút vượt màn hình. Có screenshot mobile/desktop và kiểm tra ảnh tải/giữ tỷ lệ. Không dùng `overflow-x: hidden` để che lỗi. Hồi quy Dashboard/danh sách/chi tiết đơn và sáu dialog có thêm **36 lượt bố cục**, tổng **96 tình huống bố cục**.
- **Dịch vụ:** 10 nhóm chức năng và 5 nhóm trạng thái đạt: tìm/lọc/chi tiết; xóa bị chặn khi có đơn; xem lại/hủy giữ draft; sửa gửi hai lần chỉ lưu một lần và giữ giá/lịch/toàn bộ đơn; đổi trạng thái; thêm qua form thật rồi xóa dịch vụ QA chưa dùng; validation/focus; dữ liệu đổi hoặc biến mất; lỗi storage chỉ giữ trong phiên. Danh sách nguồn chỉ có sáu dịch vụ, **chưa kiểm chứng chuyển sang trang thứ hai trong trình duyệt**.
- **Thanh toán: 17 nhóm đạt**, gồm tìm/lọc ngày địa phương/trạng thái/phương thức/cờ hoàn, sắp xếp/phân trang, liên kết chi tiết đơn, paid/đơn hủy chỉ đọc, hủy xác nhận/focus, gửi trùng chỉ thêm một lịch sử, bản ghi đổi trạng thái/biến mất, ngày giáp UTC, dữ liệu rỗng và lỗi storage. Giữ amount, giá/trạng thái đơn và các bản ghi khác.
- **Đánh giá: 18 nhóm đạt**, gồm tìm/lọc/sắp xếp, chi tiết hai loại số sao/nội dung/đơn, hủy và focus, lý do trống, ẩn/hiện gửi trùng chỉ ghi một lần và giữ nhận xét/số sao, dữ liệu đổi/biến mất, lỗi storage, dữ liệu rỗng và tùy chọn dịch vụ ngừng/nhân viên khóa. Biên phân trang 1/1 đạt; **chưa kiểm chứng trang thứ hai vì dữ liệu hiện có chưa đủ tám mục**.
- **Báo cáo:** 6 nhóm chức năng và 7 nhóm trạng thái đạt: so khớp Dashboard trước/sau lọc; dữ liệu chỉ đọc; tải file CSV thật, BOM/nội dung; bảo vệ công thức/dấu phẩy; ngày Việt Nam giáp UTC; khoảng ngày sai chặn xuất; lỗi tải CSV; dữ liệu rỗng/thiếu dịch vụ; dữ liệu sai cấu trúc; sai vai trò hoặc Admin khóa bị chặn trên cả bốn trang.
- **Hồi quy Admin 3B.1–3B.2:** 24 nhóm chức năng + 13 nhóm trạng thái của Dashboard/đơn/chi tiết; 15 nhóm phân công/lịch + 13 nhóm tài khoản; 19 nhóm trạng thái của phân công/lịch/tài khoản đều đạt. Gồm sidebar/menu/Escape/resize/thu gọn, mở các route, đăng xuất, tạo/sửa/khóa tài khoản, phân công/trùng lịch, dữ liệu rỗng/sai và lỗi không lưu được. Không ghi nhận exception JavaScript trong các lượt hoàn tất.
- **VM dùng core thực tế và storage riêng:** dịch vụ 17 trường hợp/105 assertions đạt; adapter đánh giá và ghi nhận tiền 61 assertions đạt; tính báo cáo/CSV 10 trường hợp đạt. Kiểm tra actor, whitelist, giá/đơn khác, void action, storage quota, paid-only, ngày địa phương, dịch vụ/nhân viên thiếu và tính chỉ đọc.
- **Bảo toàn:** hash 110 file core/Customer/Staff/UI chung/màn hình cũ/component-style-config 3B.1–3B.2 giữ nguyên; khối CustomerLayout/Auth trong Portal nguyên vẹn. Tám file mới không lỗi khoảng trắng; `git diff --check` không báo lỗi. Giữ mọi thay đổi Git có trước, không commit/push/merge/đổi nhánh.

QA dùng Chrome profile riêng `%TEMP%/cleanhome-admin-phase3b3`, không truy cập/reset dữ liệu trình duyệt của người dùng. Tình huống lỗi chỉ thay tạm bản ghi trong profile QA; kiểm tra thêm dịch vụ/tài khoản dùng form và action thật trong profile riêng rồi phục hồi đúng chuỗi dữ liệu ban đầu. Không thêm dữ liệu nguồn hoặc đánh giá giả. Mọi lượt hoàn tất có đối chiếu `dataRestored: true`; mật khẩu/hash không đưa vào log hoặc artifact. Timeout CDP 20 giây, từng lượt 180–240 giây. Chrome QA đóng sau kiểm tra; Admin development giữ tại cổng 3003 để xem giao diện.

Artifact 3B.3 tại `%TEMP%/cleanhome-admin-3b3-qa/`: `layout/qa-report.json`, `functional-services/results.json`, `functional-payments-reviews/payments/qa-report.json`, `functional-payments-reviews/reviews/qa-report.json`, `reports/qa-report.json`, `regression-3b1/qa-report-partial.json`, `regression-3b2-assignment-calendar/qa-report-partial.json`, `regression-3b2-accounts/qa-report-partial.json`, `regression-3b2-states/qa-report.json` và `preservation-report.json`. Script VM: `%TEMP%/cleanhome-admin-qa/admin-service-regression.mjs`, `%TEMP%/cleanhome-admin-review-adapter-check.cjs`, `%TEMP%/cleanhome-admin-qa/admin-report-regression.mjs`.

## Giới hạn hiện tại

- Nguồn dữ liệu vẫn là store/localStorage `cleanhome-demo-state-admin`, chưa có API quản trị. Adapter là điểm nối UI với action cũ, không phải kết nối backend.
- Customer, Staff và Admin có storage theo vai trò và origin/port riêng; thay đổi tài khoản, dịch vụ, nhận tiền và ẩn/hiện đánh giá của Admin chưa tự đồng bộ sang ứng dụng khác hoặc thiết bị khác. Không thay đổi trong 3B.1–3B.3.
- Cơ chế auth/quyền frontend giữ nguyên; chưa kiểm chứng xác thực/ủy quyền trên server. Form đăng nhập Admin cũ được giữ nguyên theo phạm vi yêu cầu, chưa nâng cấp ở bước này.
- Store cũ có fallback dữ liệu seed khi JSON/version không hợp lệ; nâng cấp UI không thay đổi cơ chế đó. Không reset dữ liệu của người dùng để kiểm thử.
- Chưa kiểm chứng API/backend, đồng bộ liên ứng dụng, giao dịch/hoàn tiền thực, thiết bị vật lý hoặc các trình duyệt khác. Responsive và chức năng được kiểm tra trên Chrome development; build production đạt nhưng chưa chạy lại toàn bộ QA trên production server. Customer/Staff chỉ typecheck và đối chiếu nguồn trong 3B.3, chưa chạy lại các luồng trình duyệt. Phân trang sang trang thứ hai của dịch vụ/đánh giá chưa được kiểm chứng bằng trình duyệt do dữ liệu hiện có ít hơn tám mục.

## Chạy và kiểm tra

Từ thư mục `frontend`, trong PowerShell:

```powershell
npm.cmd run dev:admin
npm.cmd run build:admin
npm.cmd run typecheck --workspace=@cleanhome/admin -- --incremental false
npm.cmd run typecheck --workspace=@cleanhome/customer -- --incremental false
npm.cmd run typecheck --workspace=@cleanhome/staff -- --incremental false
```

Dùng server đã có nếu đang chạy, tránh mở tiến trình trùng cổng. Mở `http://localhost:3003`, đăng nhập bằng tài khoản Admin hiện có:

1. `/` — tổng quan, lọc thời gian, doanh thu và đơn cần xử lý.
2. `/don-dich-vu` — tìm/lọc/sắp xếp/phân trang; chọn **Xem chi tiết**.
3. `/don/:id` — kiểm tra thông tin, lịch sử và thao tác tùy trạng thái của đơn.
4. `/phan-cong` — chọn đơn, kiểm tra lịch nhân viên và xác nhận phân công; thử đơn đã có nhân viên để đổi phân công.
5. `/lich-lam-viec` — ngày/tuần/tháng/danh sách; lọc nhân viên và trạng thái; mở chi tiết đơn.
6. `/tai-khoan` — tìm/lọc/sắp xếp/phân trang, chi tiết, sửa, thêm và khóa/mở khóa. Các thay đổi được lưu trên trình duyệt Admin hiện tại.
7. `/dich-vu` — tìm/lọc, ảnh/giá/đơn vị, chi tiết; thử thêm/sửa qua hai bước và ngừng/mở dịch vụ. Giá đơn cũ phải giữ nguyên. Thay đổi trên trình duyệt đang dùng là thật trong store hiện tại; dùng dữ liệu thử riêng nếu cần thử thao tác xóa.
8. `/thanh-toan` — tìm mã đơn/khách hàng, lọc ngày tạo/trạng thái/phương thức/cờ cần hoàn; mở chi tiết và kiểm tra ghi nhận đã nhận tiền theo trạng thái.
9. `/danh-gia` — tìm/lọc, xem số sao/nhận xét/đơn liên quan; kiểm tra xác nhận ẩn có lý do và hiện lại.
10. `/bao-cao` — lọc ngày, đối chiếu chỉ số với Dashboard cùng khoảng ngày và tải CSV. Báo cáo lấy bản ghi trên trình duyệt hiện tại.
11. Sidebar/menu mobile — kiểm tra điều hướng và đăng xuất; xem bốn trang mới tại 375/390/768/1440px.

## Công việc còn thiếu trước khi hợp nhất

- UI Admin đã có điểm nối với action hiện tại, nhưng dữ liệu vẫn tách theo ứng dụng/port. Cần API và nguồn dữ liệu chung trước khi kiểm chứng quy trình Customer đặt lịch → Admin xác nhận/phân công → Staff thực hiện → thanh toán/đánh giá.
- Hồ sơ và đăng nhập Admin vẫn dùng component hiện có. Cơ chế `APP_ROLE` theo cấu hình build, session và dữ liệu lưu trên trình duyệt chưa đáp ứng đăng nhập chung hoặc phân quyền trên server; bước 3B không thay đổi chúng.
- Cần thống nhất hợp đồng API, trạng thái đơn/công việc, điều kiện hủy/phân công, ngày giờ và định nghĩa doanh thu. Kiểm tra lại quy tắc tạo tài khoản, cấp/đặt lại mật khẩu và email/số điện thoại trùng trước khi đưa lên server.
- Các `src/app.js` backend liên quan đang là TODO; trong `databases/` chưa tìm thấy schema SQL/Prisma. Chưa có cơ sở coi backend, database, đối soát hoặc hoàn tiền là đã vận hành.
- Lập bảng đối chiếu route, CSS và component của ba ứng dụng để tránh trùng `/dich-vu`, `/ho-so`, `/don/:id` và ảnh hưởng style. Giữ riêng ứng dụng Staff/Admin đến khi ứng dụng chung và các luồng hồi quy đạt.
- Gian hàng, giỏ hàng, đơn mua và tồn kho trong `frontend-legacy` cần kế hoạch chuyển riêng: kiểm kê màn hình/action/dữ liệu, thiết kế API sản phẩm–đơn mua–tồn kho và đối chiếu chức năng trước khi chuyển. Giữ nguyên chức năng và thư mục hiện tại.

## Đề xuất Giai đoạn 4 — chỉ là kế hoạch

Giữ tên CleanHome, tên thư mục và repository. Tái sử dụng ứng dụng Next.js hiện có làm nền cho một ứng dụng chung, giữ `packages/ui` và các component đã hoàn thiện. API/backend cùng database là nguồn dữ liệu có thẩm quyền; frontend dùng adapter để tải và gửi dữ liệu, hiển thị loading/lỗi theo kết quả thật.

| Khu vực | Đề xuất |
| --- | --- |
| Route và layout | Customer giữ URL công khai/đặt lịch hiện có khi có thể; Staff dùng `/staff/...`, Admin dùng `/admin/...`. Route group tổ chức layout và trang theo vai trò; prefix URL xử lý trùng đường dẫn. Namespace style theo layout, không gộp CSS toàn cục một cách tự động. |
| Đăng nhập | Một trang `/dang-nhap`, endpoint đăng nhập/đăng xuất và `/auth/me`. Server trả danh tính, trạng thái tài khoản và vai trò; chuyển tới trang phù hợp hoặc `returnTo` nội bộ đã kiểm tra. Không lấy vai trò từ `APP_ROLE` lúc build hoặc dữ liệu người dùng sửa trên trình duyệt. |
| Session và tài khoản | Session được server quản lý, cookie `HttpOnly`/`Secure`/`SameSite`, có hạn dùng và thu hồi khi đăng xuất/khóa tài khoản. Backend lưu mật khẩu đã băm; bổ sung quy trình cấp/đặt lại mật khẩu, giới hạn lần đăng nhập và bảo vệ yêu cầu thay đổi dữ liệu. Không lưu mật khẩu hoặc hash xác thực trên localStorage. |
| Phân quyền | Kiểm tra quyền trên server cho mỗi API và tài nguyên: Customer chỉ xem/sửa dữ liệu của mình, Staff chỉ thao tác công việc được giao, Admin có quyền quản trị theo chính sách. Guard frontend phục vụ điều hướng; backend vẫn kiểm tra chủ sở hữu, vai trò và trạng thái nghiệp vụ. Đăng ký/tạo tài khoản thông thường không tự cấp Admin. |
| API và database | Các nhóm tài khoản, dịch vụ, đặt lịch/đơn, phân công/lịch, thanh toán, đánh giá và báo cáo có hợp đồng dữ liệu/lỗi rõ ràng. Thiết kế schema quan hệ, khóa ngoại, migration và nguồn dữ liệu chung; lưu lịch sử thao tác và người thực hiện. Ưu tiên backend theo mô-đun với database quan hệ chung để kiểm tra trạng thái và lưu thay đổi trong cùng giao dịch; chốt cách tổ chức các service trước khi triển khai. Các service TODO hiện tại chưa phải API vận hành. |
| Tính đúng của nghiệp vụ | Server tính và lưu giá/đơn vị/phạm vi dịch vụ tại thời điểm đặt, giữ giá của đơn cũ khi sửa dịch vụ. Giao dịch database kiểm tra trạng thái và xung đột phân công; phiên bản bản ghi phát hiện dữ liệu thay đổi khi form đang mở. Khóa idempotency tránh ghi lặp đặt lịch, xác nhận tiền hoặc yêu cầu hoàn; audit ghi rõ trước/sau. |
| Thanh toán và báo cáo | Tách bản ghi đã nhận tiền, giao dịch nhà cung cấp và yêu cầu/kết quả hoàn tiền. Chỉ cập nhật kết quả giao dịch theo nguồn được xác thực; không đánh dấu `refundRequired` là đã hoàn. API thống kê và CSV cùng dùng quy tắc paid-only, ngày ghi nhận và phần cần hoàn đã thống nhất với Dashboard; doanh thu gộp/hoàn/doanh thu thuần có định nghĩa riêng. |
| Chuyển dữ liệu | Thay adapter gọi local action bằng adapter API theo từng luồng. Không tự nhập dữ liệu seed hoặc toàn bộ localStorage vào database. Nếu cần giữ dữ liệu do người dùng tạo, có bước xuất, đối chiếu ID/quyền/quan hệ và xem lại trước khi nhập; giữ bản gốc để đối chiếu. |

Lộ trình đề xuất:

1. Chốt route/quyền, hợp đồng API, schema, công thức giá và quy tắc thanh toán/báo cáo; hoàn thiện backend và database thực tế theo phạm vi được phê duyệt.
2. Xây dựng đăng nhập/session trên server, nối các adapter API và kiểm thử đồng bộ ba vai trò với dữ liệu thật trong môi trường kiểm thử riêng.
3. Hợp nhất route/layout vào một ứng dụng Next.js; kiểm thử quyền, reload/session hết hạn, thao tác đồng thời, lỗi mạng/lưu dữ liệu và toàn bộ luồng xuyên vai trò trước khi ngừng ứng dụng cũ.
4. Chuyển gian hàng/giỏ hàng/đơn mua/tồn kho theo kế hoạch riêng; triển khai thanh toán trực tuyến/hoàn tiền qua nhà cung cấp nếu được phê duyệt.

Dừng sau **3B.3** để người dùng kiểm tra giao diện. Giai đoạn 4, authentication chung, backend và database **chưa được triển khai** trong lượt này.