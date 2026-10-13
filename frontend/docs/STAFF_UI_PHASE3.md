# CleanHome — Giai đoạn 3A: giao diện Staff

Đã nâng cấp khu vực nhân viên theo design system trắng/xanh của Customer. Giữ ứng dụng Staff riêng, các route và cơ chế dữ liệu/xác thực hiện có. Không triển khai Giai đoạn 3B.

## File thay đổi

Các đường dẫn bên dưới tính từ `frontend/`.

| File | Nội dung |
| --- | --- |
| `packages/ui/src/components/staff/staff-layout.tsx` | Sidebar desktop có thu gọn, menu mobile, Header, menu tài khoản, đăng xuất, skip link |
| `packages/ui/src/components/staff/staff-shared.tsx` | Header/empty/error/skeleton, card/badge công việc, kiểm tra dữ liệu chỉ đọc và helper ngày/tìm kiếm |
| `packages/ui/src/components/staff/staff-login.tsx` | Chuẩn hóa form Staff, validation, hiện/ẩn mật khẩu, loading, chống gửi trùng; gọi login core hiện có |
| `packages/ui/src/components/staff/staff-dashboard.tsx` | Lời chào, thống kê từ công việc được phân công, lịch sắp tới và công việc cần chú ý |
| `packages/ui/src/components/staff/staff-jobs.tsx` | Tìm mã/tên dịch vụ không dấu, lọc trạng thái, sắp xếp lịch, phân trang tám mục; bảng desktop/card mobile |
| `packages/ui/src/components/staff/staff-calendar.tsx` | Ngày, tuần, tháng và danh sách tuần; lịch ngày địa phương, lọc trạng thái, điều hướng và mở chi tiết |
| `packages/ui/src/components/staff/staff-job-detail.tsx` | Thông tin công việc, xác nhận chuyển trạng thái, ghi chú, lịch sử và chi phí chỉ đọc |
| `packages/ui/src/components/staff/staff-job-service.ts` | Adapter bất đồng bộ gọi advanceJob/addStaffNote, phân biệt lưu thiết bị với giữ trong phiên |
| `packages/ui/src/components/staff/staff-profile.tsx` | Xem/sửa/lưu/hủy thông tin liên hệ, avatar, thông tin nhân viên và đăng xuất |
| `packages/ui/src/components/staff/staff-profile-service.ts` | Patch các trường hồ sơ được phép qua updateUser, đối chiếu dữ liệu localStorage |
| `packages/ui/src/portal.tsx` | Chọn component/layout Staff mới; giữ nhánh Customer/Admin và cơ chế auth/quyền hiện có |
| `apps/staff/app/globals.css` | Style riêng Staff: palette CleanHome, kích thước vùng bấm, chiều rộng sidebar và bố cục nội dung |
| `docs/STAFF_UI_PHASE3.md` | Báo cáo triển khai, kết quả kiểm tra, giới hạn và đề xuất Admin |

Không sửa component Customer, màn hình Admin, `core`, schema, backend/database hoặc `frontend-legacy`. Không thêm dependency. Các thay đổi Git chưa commit trước đó được giữ nguyên; không commit/push/merge hoặc đổi nhánh.

## Giao diện và quy tắc dữ liệu

- Dashboard chỉ tính từ `orders.staffId === user.id`. Công việc hôm nay dùng ngày thực hiện theo giờ địa phương và loại đơn hủy; ba thống kê còn lại tính toàn bộ công việc của nhân viên theo trạng thái. Lịch sắp tới chỉ gồm công việc chưa bắt đầu trong tương lai. Công việc quá lịch chưa xong, chờ tiếp nhận, đang thực hiện hoặc có yêu cầu hủy nằm trong phần cần chú ý. Không thêm công việc hoặc số liệu quảng bá mới.
- Danh sách công việc hiển thị mã đơn, dịch vụ, khách hàng, địa chỉ, lịch và trạng thái. Phân biệt trạng thái việc waiting/accepted/in_progress/done với trạng thái đơn; đơn hủy hiển thị đã hủy. Tìm kiếm có dấu/không dấu, sắp xếp lịch tăng/giảm và phân trang tám mục.
- Lịch giữ các chế độ tuần/tháng/danh sách tuần cũ và thêm chế độ ngày. Trên điện thoại hiển thị lịch hẹn theo từng ngày có công việc; desktop có lưới tuần/tháng. Mặc định loại đơn hủy như trước; có thể chọn bộ lọc đã hủy để tra cứu. Ngày thực hiện không dùng cách cắt chuỗi UTC để tránh sai ngày tại Việt Nam.
- Chi tiết chỉ mở công việc của nhân viên hiện tại. Thông tin liên hệ, địa điểm, khối lượng, phạm vi, yêu cầu và chi phí đã lưu chỉ đọc. Không thêm quyền sửa giá, lịch, phân công, đơn, thanh toán hoặc dữ liệu tài khoản người khác. Không hiển thị mật khẩu, email khách hàng hoặc thông tin nhạy cảm bổ sung.
- Giữ quy trình core: **waiting → accepted → in_progress → done**. Tiếp nhận giữ trạng thái đơn; bắt đầu chuyển đơn sang in_progress, hoàn thành chuyển sang completed. Không bỏ qua bước. Đơn hủy/đã hoàn thành không có thao tác advance; yêu cầu hủy pending chặn bắt đầu theo quy tắc hiện có. Có xác nhận, loading và mutex chung với lưu ghi chú; Escape/backdrop không đóng hộp thoại khi đang lưu.
- Ghi chú trim, bắt buộc, tối đa 2.000 ký tự. Giữ quy tắc UI cũ: công việc hoàn thành vẫn có thể thêm ghi chú bàn giao, công việc hủy chỉ tra cứu ghi chú cũ. Lỗi lưu giữ nội dung để thử lại.
- Hồ sơ chỉ sửa **name/email/phone/address/avatar**. Mã, vai trò, trạng thái, ngày tham gia và chức danh hiện có chỉ đọc. Tái sử dụng helper validation Customer; không sửa helper đó. Avatar giữ PNG/JPEG/WebP tối đa 1 MB, đọc/giải mã trước preview và hủy callback cũ khi hủy chỉnh sửa. Địa chỉ liên hệ có thể để trống; dữ liệu đã nhập được giữ khi lưu thất bại.
- Đăng nhập Staff gọi nguyên `actions.login`, giữ mật khẩu không trim và kiểm tra vai trò từ core. Đích đăng nhập vẫn `HOME_PATH.staff`; không thêm return path hoặc đăng ký Staff công khai. Form không hiển thị tài khoản/mật khẩu thử nghiệm. Không thêm quên/đổi mật khẩu hoặc xác thực production giả.
- Component tái sử dụng Button/Card/Input/Field/Avatar/Skeleton/PasswordField/Logo/badge và Sheet/DropdownMenu đang có. Style mới giới hạn ở Staff; không dùng `overflow-x: hidden` để che bố cục. Bố cục thống kê điện thoại hai cột để lịch hẹn xuất hiện sớm hơn.

## Kết quả kiểm tra

- **Build production Staff đạt. Typecheck Staff, Customer và Admin đạt** sau thay đổi cuối. Build rồi typecheck Staff chạy tuần tự để tránh `.next/types` đang được sinh lại. Không build lại Customer/Admin trong riêng Giai đoạn 3A.
- Chrome development tại **375, 390, 768, 1440px**: 40 lượt bố cục cho đăng nhập, Dashboard, danh sách, chi tiết, hồ sơ xem/chỉnh sửa và bốn chế độ lịch. Tám lượt bổ sung sau chỉnh thống kê mobile và bố cục hồ sơ, tổng **48 lượt**. Không phát hiện tràn ngang, nội dung bị vùng chứa cắt hoặc nút ngoài màn hình; mỗi trang chính có một h1. Đã xem screenshot mobile/desktop.
- Đủ **10 luồng yêu cầu** được kiểm chứng: đăng nhập Staff hiện có; Dashboard; danh sách; tìm kiếm/lọc; chi tiết; chuyển trạng thái hợp lệ; chặn trạng thái không được phép; lịch; xem/sửa hồ sơ; đăng xuất.
- Lượt đầy đủ ghi nhận 18 kiểm tra chức năng và chín kiểm tra trạng thái. Kiểm chứng số liệu Dashboard bằng dữ liệu thực trong store; quyền sở hữu; tìm kiếm không dấu; sắp xếp/phân trang; empty state; công việc người khác bị từ chối; đơn hủy; yêu cầu hủy pending; giá giữ nguyên sau chuyển trạng thái; hai submit chỉ thêm một lịch sử/ghi chú; thêm ghi chú completed; lưu hồ sơ trùng email giữ draft; hủy/lưu giữ code/role/position/createdAt; Header cập nhật tên.
- Đã kiểm chứng lưu trạng thái/hồ sơ khi localStorage bị chặn: thông báo chỉ giữ trong phiên, dữ liệu trên thiết bị không bị báo đã lưu sai. Dữ liệu scheduledAt hoặc tên nhân viên sai kiểu hiển thị lỗi thay vì exception; tải lại khôi phục màn hình khi nguồn dữ liệu hợp lệ.
- Bàn phím: validation đưa focus tới trường/thông báo; Enter hiện/ẩn mật khẩu và chọn đăng xuất; Escape đóng xác nhận/menu và trả focus; sau chuyển trạng thái và lưu/hủy hồ sơ, focus vào vị trí phù hợp. Sidebar desktop thu gọn/mở rộng và menu mobile chuyển route đều đạt.
- Avatar Staff kiểm chứng riêng: định dạng không được phép chặn lưu, PNG đọc và lưu thực, hủy trong lúc đọc không để callback cũ hiện lỗi. Không ghi nhận exception JavaScript trong các lượt trình duyệt.
- Adapter chạy với store/logic nguyên bản trong VM và storage riêng: **28 assertions đạt**, gồm chuyển đúng bước, lịch sử, giữ giá/đơn người khác, từ chối skip/cancelled/wrong ownership/pending cancel, ghi chú completed và quota không lưu được.
- Đối chiếu hash **43 file** core, Customer, component dùng chung đã có, màn hình Admin và stylesheet chung: không thay đổi. Portal được kiểm tra riêng để chỉ nối Staff. Git diff và kiểm tra khoảng trắng trên file thay đổi không báo lỗi.
- Smoke sau build: trang chủ Customer (3001), đăng nhập Staff (3002) và đăng nhập Admin (3003) đều trả HTTP 200, giữ thương hiệu CleanHome. Khối `InternalAuth` dành cho Admin và `CustomerLayout` đối chiếu nguyên vẹn; Git status không có thay đổi ngoài các thư mục đang untracked từ trước.

QA dùng Chrome profile riêng và dữ liệu sẵn có. Một số đơn được gán nhân viên tạm để kiểm tra phân trang, yêu cầu hủy hoặc trạng thái lỗi, chỉ trong profile QA; không tạo công việc để làm đầy website. Dữ liệu ban đầu được khôi phục sau các lượt kiểm tra. Mật khẩu không đưa vào log hoặc artifact. Timeout 20 giây/lệnh trình duyệt, 210 giây cho lượt đầy đủ, 60 giây cho lượt bổ sung. Chrome kiểm tra được đóng sau khi xong; giữ các server development đã có của người dùng.

Artifact tại `%TEMP%/cleanhome-staff-qa/phase3a/` và `%TEMP%/cleanhome-staff-qa/final-layouts/`. Script adapter tại `%TEMP%/cleanhome-staff-job-adapter-check.cjs`.

## Giới hạn và nội dung chưa kiểm chứng

- Nguồn vẫn là store/localStorage `cleanhome-demo-state-staff`; không có API công việc/hồ sơ/lịch thực tế. Adapter chỉ chuẩn bị điểm nối API, không gửi tới backend. Thông báo thao tác nói rõ lưu trình duyệt hoặc giữ trong phiên.
- Các website hiện có storage theo vai trò và origin/port riêng. Thay đổi Staff chưa tự đồng bộ sang Customer/Admin hoặc thiết bị khác. Nâng cấp UI không thay đổi giới hạn này và không thêm schema/sync mới.
- Auth/hash/kiểm tra quyền frontend giữ nguyên; chưa có xác thực server, kiểm soát quyền trên backend hoặc hệ thống production. Staff không tự cấp tài khoản, sửa vai trò, xác nhận tiền hoặc hoàn tiền.
- Guard UI chỉ đọc và báo lỗi cho dữ liệu sai cấu trúc, không tự sửa/xóa/khởi tạo lại dữ liệu. Store cũ vẫn có fallback dữ liệu seed khi JSON/version không hợp lệ; xử lý phục hồi/migration dữ liệu an toàn cần khảo sát riêng trước khi sửa core.
- Lịch dùng scheduledAt/durationMinutes đã lưu, chưa kiểm tra API lịch thực tế hoặc xung đột từ server. Chi phí/trạng thái thanh toán chỉ là bản ghi hiện có, chưa kiểm chứng giao dịch thật.
- **Chưa kiểm chứng** trên thiết bị vật lý hoặc trình duyệt khác; chưa kiểm tra API/backend, đồng bộ giữa ứng dụng, đăng nhập server, gửi thông báo hoặc thanh toán thật. Customer/Admin chỉ typecheck và kiểm tra hồi quy nguồn/smoke, không chạy lại toàn bộ các luồng trình duyệt của hai ứng dụng.

## Chạy và kiểm tra trực tiếp

Trong thư mục `frontend`, PowerShell dùng `npm.cmd`:

```powershell
npm.cmd run dev:staff
npm.cmd run build:staff
npm.cmd run typecheck --workspace=@cleanhome/staff -- --incremental false
npm.cmd run typecheck --workspace=@cleanhome/customer -- --incremental false
npm.cmd run typecheck --workspace=@cleanhome/admin -- --incremental false
```

Mở `http://localhost:3002`:

1. `/dang-nhap` — tài khoản Staff hiện có; `/dang-ky` chỉ thông tin liên hệ người quản lý.
2. `/` — thống kê và công việc cần chú ý.
3. `/cong-viec` — tìm kiếm/lọc/sắp xếp; chọn **Chi tiết** để mở `/don/:id` của công việc được phân công.
4. `/don/:id` — tiếp nhận/bắt đầu/hoàn thành theo trạng thái, xác nhận và lưu ghi chú.
5. `/lich-lam-viec` — chọn ngày và chế độ ngày/tuần/tháng/danh sách tuần.
6. `/ho-so` — sửa, kiểm tra lỗi, lưu/hủy, avatar và đăng xuất.

Nếu server Staff đang chạy thì dùng server đó, không mở thêm tiến trình trùng cổng. Tài khoản chưa có việc được phân công sẽ thấy trạng thái rỗng đúng dữ liệu.

## Đề xuất Giai đoạn 3B — Admin

1. Chuẩn hóa layout/navigation, Header và tài khoản Admin bằng design system hiện có; giữ ứng dụng riêng, không hợp nhất authentication.
2. Ưu tiên danh sách/chi tiết đơn, phân công và lịch nhân viên; giữ các điều kiện xác nhận, yêu cầu hủy, chuyển trạng thái và kiểm tra trùng lịch hiện có.
3. Nâng cấp tài khoản, dịch vụ, thanh toán và đánh giá; chỉ thao tác thật mà core/API hiện có hỗ trợ, bảo toàn dữ liệu và không thêm xác nhận thanh toán/hoàn tiền giả.
4. Hoàn thiện tổng quan/báo cáo từ dữ liệu hiện có, phân biệt dữ liệu cục bộ và máy chủ; tiếp tục giữ gian hàng/tồn kho legacy cho kế hoạch chuyển riêng.
5. Kiểm tra responsive, bàn phím, quyền/thao tác không được phép, typecheck/build cả phạm vi bị ảnh hưởng và ghi rõ API còn thiếu.

Đây là kế hoạch đề xuất. Dừng sau Giai đoạn 3A để người dùng kiểm tra và phê duyệt trước khi nâng cấp Admin; đăng nhập/phân quyền chung vẫn là phạm vi Giai đoạn 4 riêng.
