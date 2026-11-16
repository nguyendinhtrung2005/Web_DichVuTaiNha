# CleanHome — kế hoạch nâng cấp toàn bộ website Staff

Ngày lập: **28/10/2026**. Trạng thái: **đề xuất để review, chưa triển khai**. Website giữ Next.js và cổng3002, tách Customer/Admin. Lượt này chỉ tạo tài liệu; không sửa source, cấu hình, contract hoặc MySQL.

## 1. Cơ sở và phạm vi bảo toàn

- Đã đọc `AGENTS.md`, file thực tế `BACKEND_TEAM_RULES .md`, hướng dẫn Staff, source entry/layout/BFF và contract liên quan. Ưu tiên source hiện tại khi tài liệu giai đoạn cũ chưa cập nhật refresh.
- Git: `feat/cleanhome-frontend`, HEAD `afc5d78b993ec379ba9a9a3c5ab87059dfe2930b`; **235 đường dẫn staged**, nhiều thay đổi unstaged/untracked, gồm **13 dòng CSS Admin unstaged**. Không stage, đổi nhánh, commit/push/merge hoặc ghi đè phần đó.
- Giữ Auth phone/EMPLOYEE, RS256/JWKS/introspection, refresh rotation/revocation, BFF, HttpOnly, session encryption và Origin/CSRF. Local hiện có giới hạn tổng phiên7ngày, access JWT900giây; không thay chính sách này khi thiết kế UI.
- Giữ URL, DTO, ownership A/B, assignmentId dạng chuỗi BIGINT, giá/khối lượng DECIMAL dạng chuỗi và múi giờ `Asia/Ho_Chi_Minh`.
- Giữ UC12 idempotency/journal/retry/ACK và Staff→Order. Browser không gọi `/internal/`; không ghi trực tiếp booking từ Staff UI.
- Không nối lại store/localStorage legacy vào danh tính Backend. Không xóa dữ liệu cũ, sửa schema gốc hoặc replay Q01–Q06 đã hoàn thành.

Tài liệu phiên hiện tại: [SESSION_RENEWAL.md](SESSION_RENEWAL.md). Kết quả kiểm thử trong tài liệu đó là bằng chứng của lượt trước; lượt lập kế hoạch này **không chạy test/build hoặc gọi API ghi**.

## 2. Bộ ảnh tham khảo và nhận diện

Đã mở **14 ảnh JPG** trong `E:\New folder (2).rar`, chỉ giải nén vào thư mục TEMP riêng để xem. Các ảnh là ứng dụng giao nhận; lấy cách tổ chức thông tin, không sao chép thương hiệu, danh tính, số tiền hoặc nghiệp vụ giao hàng.

| Ảnh theo thứ tự tên file | Nội dung tham khảo | Áp dụng cho CleanHome |
| --- | --- | --- |
| 01–02, prefix9015/9068 | Tổng quan và menu tài khoản | Việc hôm nay, việc cần xử lý, lối vào các module; không tự thêm Free-Pick/nhận đơn tự do |
| 03–07, prefix9097–9186 | HUB, bản đồ, hiệu suất, lịch ca | Khu vực phục vụ, lịch rõ theo ngày và nhóm thông tin; đăng ký ca/bản đồ là nghiệp vụ riêng cần duyệt |
| 08, prefix9208 | Thông báo theo nhóm, đã đọc | Danh sách/counter/read-state từ API, không chấm đỏ giả |
| 09, prefix9227 | Thu nhập theo kỳ | Tách thu nhập đã xác nhận/chờ đối soát nếu Backend định nghĩa; không sao chép công nợ/ví |
| 10–11, prefix9247/9268 | Cấp độ và điểm vi phạm | Gợi ý bố cục tiến độ/thành tích; chưa tự đặt hạng, thưởng, điểm phạt hoặc tiêu chí |
| 12, prefix9288 | Lịch sử rỗng | Empty state gọn, điều hướng hợp lý, không tạo đơn để làm đầy |
| 13–14, prefix9308/9328 | FAQ và cài đặt theo nhóm | Hỗ trợ, hồ sơ, tùy chọn giao diện; nội dung/liên hệ phải được nhóm cung cấp |

Prefix ở bảng là bốn chữ số cuối phần đầu tên ảnh `179318334xxxx`; ảnh04/05 là hai góc nhìn bản đồ tương tự nhau. Bộ ảnh không có màn hình login riêng: tái sử dụng thiết kế đăng nhập CleanHome hiện tại.

**Màu lấy nguyên từ CSS**, không dùng màu cam/đen của bộ ảnh:

| Token hiện có | Giá trị | Nguồn |
| --- | --- | --- |
| `--ch-blue`, `--ch-blue-hover`, `--ch-blue-soft` | `#2563eb`, `#1d4ed8`, `#eff6ff` | `frontend/packages/ui/src/portal.css` |
| `--ch-ink`, `--ch-muted`, `--ch-border` | `#16263e`, `#64748b`, `#e2e8f0` | Cùng file |
| `--ch-surface`, `--ch-surface-soft` | `#ffffff`, `#f8fafc` | Cùng file; giữ trắng/xanh sáng |
| `--ch-danger`; radius | `#b91c1c`; `12/16/24px` | Cùng hệ thống style |

Staff `app/globals.css` đã ánh xạ primary/ring sang `--ch-blue`. Giữ **Be Vietnam Pro400/500/600/700** đang import trong `app/layout.tsx`. Dùng lại `shared/logo.tsx` nguyên vẹn; không đổi tên CleanHome, icon/brand asset hay CSS dùng chung để phục vụ riêng Staff.

## 3. Kiểm kê hiện trạng

| Trang/route hiện có | Entry/component thực tế | Tình trạng |
| --- | --- | --- |
| `/dang-nhap` | `StaffLogin`, `StaffAuthProvider` | Auth/BFF thật; phone, autofill chuẩn, form ổn định khi đổi tab |
| `/` | Card trong `StaffAuthPortal` | Có đăng nhập và link công việc; chưa là Dashboard dữ liệu |
| `/cong-viec` | `StaffJobsRemote` + model | UC9 thật; filter trạng thái, sort, pagination |
| `/don/:assignmentId` | `StaffJobDetailRemote`, `StaffJobStatus` + models | UC10/12 thật; giữ xác nhận/pending/đối chiếu |
| `/lich-lam-viec` | `StaffScheduleRemote` + model | UC11 thật; ngày/tuần/tháng/danh sách |
| `/ho-so` | Nhánh placeholder trong `StaffAuthPortal` | Chưa có API hồ sơ; Auth chỉ có ID/role/status |
| `/dang-ky` | Hướng dẫn liên hệ quản lý | Không có tự đăng ký nhân viên |
| `/du-lieu` | `RawDataExportPage` | Sao lưu localStorage cũ, không phải export MySQL; giữ trong phần công cụ dữ liệu |

Entry: `apps/staff/app/[[...slug]]/page.tsx` → `StaffAuthPortal`; `StaffLayout` hiện có sidebar desktop và Sheet mobile, **chưa có bottom navigation**. Component Dashboard/Jobs/Calendar/Profile cũ còn trong nhánh legacy của `portal.tsx`, không phải các trang Staff Backend đang chạy.

**BFF hiện có:** Auth login/session/renew/logout; jobs, detail, schedule; GET/PATCH status. `lib/server/auth-core.mjs`, `auth-http.mjs`, `config.mjs` quản lý phiên; các contract/http/model riêng kiểm DTO. `status-core.mjs`, `status-store.mjs` giữ operation context. Không thay lõi đó khi thay layout.

## 4. API hiện có và khoảng trống

Các URL dưới là **đã có trong source**; không phải kết quả gọi lại HTTP ở lượt này.

| Chức năng | Browser cùng origin | Backend do server gọi |
| --- | --- | --- |
| Đăng nhập | POST `/api/auth/login` | Auth POST `/api/v1/auth/login`; BFF cố định role EMPLOYEE, renewable mode |
| Kiểm tra phiên | GET `/api/auth/session` | Auth GET `/api/v1/auth/introspect`; BFF tự refresh khi cần |
| Gia hạn | POST `/api/auth/renew` | Auth POST `/api/v1/auth/refresh`, credential chỉ phía server |
| Đăng xuất | POST `/api/auth/logout` | Auth POST `/api/v1/auth/logout` khi phiên renewable |
| UC9 | GET `/api/staff/jobs` | Staff GET `/api/v1/staff/me/jobs` |
| UC10 | GET `/api/staff/jobs/:assignmentId` | Staff GET `/api/v1/staff/me/jobs/:assignmentId` |
| UC11 | GET `/api/staff/schedule` | Staff GET `/api/v1/staff/me/schedule` |
| UC12 | PATCH `/api/staff/jobs/:assignmentId/status` | Staff PATCH `/api/v1/staff/me/jobs/:assignmentId/status` |
| Đối chiếu thao tác UC12 | GET cùng URL status | BFF đọc detail và context/journal theo thiết kế hiện có; không tự PATCH |

UC9 chỉ hỗ trợ `status,page,pageSize,sort`; mặc định1/20, tối đa100 mục/trang, sort lịch rồi ID. **Chưa có search toàn bộ hoặc filter ngày trên jobs**. UC11 thêm `from,to=YYYY-MM-DD`, inclusive ngày Việt Nam, tối đa366ngày; không đồng nghĩa quản lý ca rảnh.

UC12 gửi `{status}` + `Idempotency-Key`: `ASSIGNED → ACCEPTED → IN_PROGRESS → DONE`; UI đọc ASSIGNED thành WAITING. HTTP200/SYNCHRONIZED khác202/PENDING_ACKNOWLEDGEMENT. Timeout giữ operation context, không báo thành công hoặc gửi key mới. Một assignment DONE không tự làm booking nhiều nhân viên COMPLETED.

| Module | Phân loại | Điều có thể làm/điều còn thiếu |
| --- | --- | --- |
| Login, công việc, detail, lịch, trạng thái | **ĐÃ CÓ API** | Thiết kế lại UI trên contract hiện tại |
| Tổng quan | **ĐÃ CÓ API một phần** | Việc hôm nay qua schedule; tổng từng trạng thái qua pagination.total; KPI nhiều chiều cần aggregate contract nếu truy vấn hiện có không đủ |
| Lịch sử công việc cá nhân | **ĐÃ CÓ API một phần** | Jobs lọc DONE/CANCELLED; lọc kỳ ngày/tổng hợp cần Backend; DONE là trạng thái assignment |
| Lịch sử trạng thái booking | **CẦN BACKEND** | Client Staff đã viết nhưng hai API đọc context chưa được Order expose; phải giữ error/warning khi thiếu |
| Hồ sơ, kỹ năng/chứng chỉ | **CẦN BACKEND** | User-service hiện scaffold; chưa có contract profile cho Staff; không tự thêm tên/email/avatar |
| Thông báo/đánh dấu đã đọc | **CẦN BACKEND** | Chưa có route Staff/BFF tương ứng; cần nội dung, unread count, pagination và quyền theo user |
| Thu nhập | **CHƯA RÕ NGHIỆP VỤ → CẦN BACKEND** | Chốt lương/chia sẻ doanh thu, phí, kỳ trả, hoàn/hủy, tiền đã trả; giá booking không phải lương |
| Khu vực và khả dụng/đăng ký ca | **CHƯA RÕ NGHIỆP VỤ → CẦN BACKEND** | Chốt chỉ xem chi nhánh/vùng được giao hay tự đăng ký; chưa có dữ liệu/API bản đồ Staff |
| Hỗ trợ/FAQ/yêu cầu hỗ trợ | **CHƯA RÕ NGHIỆP VỤ** | Chốt kênh, người nhận, SLA, nội dung; FAQ có thể là nội dung quản lý duyệt; ticket/chat cần Backend |
| Cài đặt | **CẦN BACKEND một phần** | Cỡ chữ/reduced motion có thể xử lý UI; password, thông báo, thiết bị/phiên và đồng bộ tùy chọn cần Auth/User API |
| Thành tích/hiệu suất/đánh giá | **CHƯA RÕ NGHIỆP VỤ → CẦN BACKEND** | Chốt công thức, quyền lợi, thời gian tính, nguồn review/chứng chỉ; không tự sinh huy hiệu hoặc điểm |

Chưa rà toàn bộ service Payment/Review/Report: owner phải xác nhận API có sẵn trước khi thiết kế contract mới. Bảng SQL tồn tại không chứng minh có API. Schema hiện có users/employees/availability/branches/notifications/revenue_shares/reviews/certificates là nguồn đối chiếu; không đủ để tự triển khai ví/công nợ/điểm phạt.

**Khoảng trống Order cần ghi rõ:** `staff-service/src/order-client.js` có client POST `/internal/v1/bookings/staff-context/batch` và GET `/internal/v1/bookings/:bookingId/staff-context`; `order-service/src/app.js` chưa expose chúng. Không coi là API hoạt động. Detail có thể trả `ORDER_HISTORY_UNAVAILABLE`; không tự thay bằng lịch sử giả.

## 5. Sitemap và thiết kế từng trang

Các route mới là **đề xuất**, chưa được route allowlist chấp nhận hoặc triển khai. Giữ `/don/:assignmentId` để link cũ tiếp tục hoạt động.

| Route | Bố cục chính | Dữ liệu/điều kiện |
| --- | --- | --- |
| `/dang-nhap` | Logo, phone/password, lỗi tại form; mobile một cột, desktop bố cục hiện có | Dùng nguyên Auth/refresh; không thêm đăng ký tự do/quen mật khẩu khi thiếu API |
| `/` | Chào theo thông tin có thật, ngày hiện tại, việc tiếp theo, việc cần xử lý, lối tắt | Schedule/jobs; không tính KPI bằng số phần tử của một trang; tổng khác kỳ phải ghi rõ |
| `/cong-viec` | Tab trạng thái, filter/sort, card mobile/bảng desktop, phân trang URL | Giữ query hiện có; không thêm thanh search toàn bộ giả |
| `/don/:assignmentId` | Header/trạng thái, dịch vụ, liên hệ, lịch, lịch sử; action UC12 gần ngón tay | Detail thật; trường unsupported có nhãn thiếu dữ liệu, không suy diễn diện tích/giá/tiền lương |
| `/lich-lam-viec` | Ngày/tuần/tháng/danh sách, chọn ngày rõ, lịch agenda trên mobile | Schedule giờ Việt Nam; không gọi lịch được phân công là ca đã đăng ký |
| `/ho-so` | Hồ sơ + hub Cá nhân: thông tin, kỹ năng, các lối vào module mở rộng | Tách identity Auth khỏi profile; form sửa chỉ mở khi có contract |
| `/thong-bao` | Nhóm/unread, danh sách theo thời gian, detail, đánh dấu đọc | Backend notifications; không số unread hardcode |
| `/lich-su` | Việc đã hoàn thành/hủy, kỳ ngày khi API hỗ trợ, mở lại detail | Tái dùng remote DTO/jobs; không trộn legacy orders |
| `/thu-nhap` | Kỳ thu nhập, khoản đã xác nhận/chờ xử lý, các dòng đối soát | Contract TV5 và công thức được duyệt; không quy đổi unitPrice thành thu nhập |
| `/khu-vuc` | Chi nhánh/vùng được phân công dạng danh sách; bản đồ là phần tùy chọn | Dữ liệu thật; tọa độ/nhà cung cấp bản đồ/quyền vị trí cần duyệt trước |
| `/ho-tro` | FAQ tìm trong nội dung đã duyệt, liên hệ, yêu cầu hỗ trợ | Không tạo số điện thoại hoặc success ticket giả |
| `/cai-dat` | Nhóm giao diện, thông báo, tài khoản/bảo mật; logout | Không bật trạng thái nhận việc bằng cách đổi ACTIVE/LOCKED của Auth |
| `/thanh-tich` | Hiệu suất theo kỳ, đánh giá/kỹ năng/chứng chỉ, tiến độ nếu có quy tắc | Không tạo bảng xếp hạng/huy hiệu/điểm vi phạm mặc định |
| `/du-lieu` | Liên kết phụ trong Cài đặt → Công cụ dữ liệu | Giữ backup local cũ và nhãn đúng nguồn; không export JWT/session |

Module chưa đủ API không hiện như một chức năng đã hoạt động: thống nhất với nhóm việc tạm ẩn khỏi navigation hoặc thể hiện trạng thái chưa khả dụng có lý do tự nhiên. Không làm nút lưu/thanh toán/đăng ký ca giả.

## 6. Layout và component

**Mobile <1024px:** header gọn, nội dung một cột; bottom navigation5 mục **Tổng quan / Công việc / Lịch / Thông báo / Cá nhân**. Menu phụ trong Cá nhân hoặc Sheet chứa Lịch sử/Thu nhập/Khu vực/Thành tích/Hỗ trợ/Cài đặt. Login không có bottom nav. Chừa `safe-area-inset-bottom` và khoảng đệm nội dung tương ứng; action UC12 nằm phía trên bottom nav, không che nút khi bàn phím mở.

**Desktop ≥1024px:** giữ sidebar256px/thu gọn88px, nhóm Công việc–Hoạt động–Cá nhân; main giới hạn chiều rộng, detail có vùng tóm tắt/action bên phải. Tablet ưu tiên card/agenda thay vì ép bảng nhiều cột. Header có tài khoản và thông báo khi có API.

Đích kiểm tra375/390/768/1440px; min-width0, text-wrap hợp lý, touch target≥44px. Không dùng overflow-x hidden để che lỗi. Đủ keyboard/focus/aria-current, heading đúng cấp, dialog trả focus, loading/skeleton, empty, error/retry và trạng thái pending thật. Không mặc định dark mode vì phong cách yêu cầu trắng sáng.

Tái sử dụng Button/Card/Table/Tabs/Pagination/Input/Select/Sheet/DropdownMenu/Dialog/AlertDialog/Skeleton/Avatar; Logo, StaffPageHeader/Empty/Loading và badge có sẵn. Tạo navigation metadata và bottom nav riêng Staff; card mới nhận remote DTO, không dùng trực tiếp `StaffJobCard` cũ nhận local `Order`. Không thêm dependency nếu chưa chứng minh cần.

Giữ catch-all hiện tại trong đợt đầu, tách màn hình thành module nhỏ. Route allowlist mới nên **Staff-only** và được dùng thống nhất bởi Portal/login return URL; tránh sửa `shared/route-policy.ts` đang dùng bởi Customer/Admin. Nếu phải sửa policy chung thì chỉ nhánh Staff, owner review và hồi quy Customer/Admin trước khi áp dụng.

## 7. Năm giai đoạn triển khai

| Giai đoạn | Phạm vi/file chính | Điều kiện nghiệm thu thực tế |
| --- | --- | --- |
| **1 — Nền giao diện và navigation** | Staff globals/layout/navigation/bottom nav/route policy riêng; chỉnh presentation login tối thiểu | Brand/màu/font giữ đúng; 5 mục mobile/sidebar hoạt động, deep link/F5/keyboard và375–1440px đạt. Auth login/refresh/logout và chuyển tab không hồi quy; không đổi BFF/security/session TTL |
| **2 — Tổng quan và công việc cốt lõi** | Dashboard mới; jobs/detail/calendar/status presentation trên UC9–UC12 đã có | A/B chỉ thấy việc của mình; filter/sort/page, 4 chế độ lịch và ngày Việt Nam đúng; không KPI sai từ một page; UC12 giữ200/202/unknown/idempotency. E2E ghi chỉ trên fixture mới được duyệt; thiếu fixture ghi NOT_RUN, không replay Q01–Q06 |
| **3 — Cá nhân và tương tác** | Profile, history, notifications, support, settings; BFF mới chỉ sau contract | Profile là dữ liệu thật, validation/quyền đúng; history DONE/CANCELLED đúng assignment; unread/read-state và tùy chọn lưu qua đúng nguồn; FAQ/liên hệ được duyệt, ticket chỉ báo thành công sau Backend xác nhận. Module thiếu API giữ BLOCKED, không coi UI mock là hoàn thành |
| **4 — Thu nhập, khu vực, thành tích** | Contract/data mapping rồi income/area/achievements; availability nếu nhóm chọn | Owner duyệt công thức tiền/KPI/quyền và dữ liệu; đối chiếu số liệu Backend, empty/permission/error; không giá booking=thu nhập, không tự thêm ví/điểm phạt. Bản đồ/đăng ký ca chỉ nghiệm thu khi có API thật và quy tắc xung đột |
| **5 — Nghiệm thu toàn website** | E2E xuyên module, responsive/a11y/performance, tài liệu và bàn giao | Auth hết hạn/refresh/outage/logout; ownership/CSRF; 375/390/768/1440px, loading/empty/error, browser storage an toàn; unit/contract/HTTP, typecheck/build Staff đạt; file/diff/secret sạch trong phạm vi. Báo rõ PASS/FAIL/SKIP/NOT_RUN; không gọi production-ready nếu chưa kiểm chứng HTTPS/tải/crash |

Mỗi giai đoạn là một phạm vi review nhỏ, tiếp tục tái sử dụng phần đã đạt. Giai đoạn3/4 có thể chuẩn bị thiết kế độc lập trong lúc chờ owner nhưng không hoàn tất tính năng ghi trước khi Backend sẵn sàng. Không gộp thay đổi UI với thay đổi nghiệp vụ Backend trong cùng patch.

## 8. File dự kiến thay đổi khi được duyệt triển khai

| Nhóm | Đường dẫn dự kiến | Mục đích/giới hạn |
| --- | --- | --- |
| Staff app | `frontend/apps/staff/app/globals.css`; tùy cần `app/layout.tsx`, `app/[[...slug]]/page.tsx` | Style/layout/metadata/entry Staff; không sửa portal.css dùng chung |
| Staff điều hướng | `frontend/packages/ui/src/components/staff/staff-layout.tsx`, `staff-auth-portal.tsx`, `staff-login-route.ts` | Nối màn hình và safe return URL; giữ provider/session logic |
| Staff mới | Cùng thư mục: `staff-navigation.ts`, `staff-bottom-nav.tsx`, `staff-route-policy.ts`, `staff-dashboard-remote.tsx` | Metadata/menu/allowlist Staff và dashboard dữ liệu thật |
| Staff cốt lõi | `staff-login.tsx`, `staff-jobs-remote.tsx`, `staff-job-detail-remote.tsx`, `staff-schedule-remote.tsx`, `staff-job-status.tsx`, `staff-shared.tsx` | Presentation nhỏ theo từng module; models chỉ thay khi cần mapping rõ ràng |
| Module mới | Cùng thư mục: `staff-profile-remote.tsx`, `staff-history-remote.tsx`, `staff-notifications-remote.tsx`, `staff-income-remote.tsx`, `staff-areas-remote.tsx`, `staff-support-remote.tsx`, `staff-settings.tsx`, `staff-achievements-remote.tsx` | Tên file đề xuất; chỉ tạo khi module được chốt, không scaffold toàn bộ một lần |
| BFF mở rộng | `frontend/apps/staff/app/api/staff/<module>/route.ts` và `lib/server/<module>-contract.mjs`, `<module>-http.mjs` | Chỉ thêm endpoint cố định theo contract owner duyệt; không proxy tùy ý/internal |
| Kiểm thử/tài liệu | `frontend/apps/staff/test/` theo module; `docs/` | Thêm/điều chỉnh assert UI khi layout đổi; giữ kiểm tra nghiệp vụ đã nghiệm thu |

**Giữ nguyên làm nền:** Auth Service, auth session/provider/core/http/renew, lõi BFF UC9–UC12/status store, Staff/Order nghiệp vụ, packages/core, schema/seed, Customer/Admin, frontend-legacy và source legacy. Không cần sửa `frontend/packages/ui/src/portal.tsx` hoặc `portal.css`. Trường hợp phát hiện bắt buộc thay file nền phải nêu impact/owner trước, không coi kế hoạch này là duyệt sửa.

Các thư mục Backend không nằm trong allowlist UI. Chưa có danh sách source Backend sẽ sửa: phải lập change request riêng theo contract/module sau khi owner nhận việc.

## 9. Phối hợp Backend và quyết định cần chốt

Không đặt endpoint mới thành API đã triển khai. Các mục dưới là **yêu cầu contract dự kiến, chưa phê duyệt URL/DTO**:

| Nhóm yêu cầu | Dữ liệu/thao tác cần thống nhất | Owner đề xuất theo quy tắc nhóm |
| --- | --- | --- |
| Profile/tài khoản | Danh tính hiển thị, thông tin được sửa, avatar, phone, đổi mật khẩu, invalidate sessions; không giả định email có trong users | TV1 Auth/User; TV4 employees/skills/certificates |
| History/thống kê cá nhân | Thời điểm lọc theo lịch hay hoàn thành, số liệu toàn bộ vs trang, booking history/context chỉ được phép xem | TV4 Staff; TV3 Order cho booking/history |
| Notifications/support | Danh mục, unread count, read-all, deep link an toàn; FAQ/ticket/chat, attachments, retention/SLA | TV5 phối hợp TV1/TV4; nhóm xác nhận owner support |
| Income | Currency/DECIMAL, kỳ, gross/net, phí/hoàn/hủy, trạng thái đối soát/đã trả và nguồn ledger | TV5 Payment/Report; TV3 khi cần booking facts |
| Areas/availability | Đọc vùng được giao hay tự chọn, ca rảnh khác assignment, kiểm xung đột, geolocation/quyền vị trí | TV4; phối hợp TV3 khi ảnh hưởng phân công |
| Achievements/performance | Công thức, kỳ tính, nguồn đánh giá, khiếu nại/chỉnh sửa; có hay không hạng/quyền lợi | TV4/TV5, người điều phối chốt nghiệp vụ |

Mặc định đề xuất: giữ phân công bởi quản lý; không thêm nhận việc tự do/online-offline nghiệp vụ, ví/công nợ, điểm phạt hoặc đăng ký ca chỉ vì xuất hiện trong ảnh. Không dùng `users.status`/`employees.status` để bật tắt “sẵn sàng nhận việc”. Nếu cần cột/bảng mới, owner dữ liệu soạn migration riêng, không sửa schema32bảng gốc.

Trước giai đoạn1: duyệt sitemap/bottom nav và cách ẩn module chưa sẵn sàng. Trước giai đoạn3/4: xác nhận owner, API thực có sẵn hay cần bổ sung, DTO/quyền/error/pagination, công thức và fixture QA mới. Trước ghi E2E: duyệt database/allowlist fixture/tables/backup và đối chiếu trước–sau. Không mặc định dữ liệu QA cũ được phép chạy lại.

## 10. Kịch bản nghiệm thu cần giữ

1. Login phone/password chuẩn, sai mật khẩu/role, tài khoản khóa; F5/đổi tab không mất phiên; JWT hết hạn được refresh trong cap7ngày, Auth outage không bị đổi thành lỗi sai mật khẩu; logout/absolute expiry thật.
2. A/B đọc danh sách/detail/schedule đúng quyền; truy cập chéo404; booking chung vẫn hai assignment; dữ liệu rỗng và nhiều trang đúng tổng.
3. Ngày Việt Nam giáp UTC, lịch chồng ngày, chuyển ngày/tuần/tháng/danh sách; không đổi lịch hoặc assignment khi chỉ xem.
4. UC12 chỉ trên bộ QA mới: transition hợp lệ/sai, gửi hai lần, timeout/202, retry cùng key, Order gián đoạn/phục hồi, nhiều nhân viên chưa xong thì booking chưa COMPLETED. Đối chiếu đúng bảng/journal sau mỗi case.
5. Module mở rộng test dữ liệu thật, quyền, validation, lỗi phụ thuộc; tiền/KPI/read-state phải đối chiếu nguồn. Không có API thì NOT_RUN/BLOCKED, không mock thành PASS tích hợp.
6. Bottom nav/desktop sidebar, deep link/return URL, focus/dialog, bàn phím, safe area/keyboard mobile và cả4chiều rộng; không tràn/cắt nội dung. Không JWT/refresh/password trong browser storage, URL, log hoặc export.

**Bước tiếp theo đề xuất:** review kế hoạch này, chốt các quyết định ở mục9, rồi triển khai riêng giai đoạn1. Tài liệu này không tự cấp quyền triển khai Backend, ghi MySQL hoặc thay đổi kiến trúc Auth đã nghiệm thu.
