# CleanHome — Giai đoạn 2A: danh sách công việc Staff từ Backend

## Phạm vi và nguồn hợp đồng

Chỉ tích hợp UC9 — xem danh sách công việc tại `http://localhost:3002/cong-viec`. Kế thừa đăng nhập phone và phiên HttpOnly của Giai đoạn 1. Không tích hợp chi tiết UC10, lịch UC11 hay cập nhật trạng thái UC12; không đổi Backend, schema, Gateway hoặc Customer/Admin. Không reset localStorage, chạy seed hoặc cập nhật booking/assignment.

Nguồn đã đọc: `AGENTS.md`, `BACKEND_TEAM_RULES .md` (tên thực tế có khoảng trắng), [Auth Frontend](AUTH_INTEGRATION.md), [Staff README](../../../../backend/staff-service/README.md), `src/mapping.js`, `src/validation.js`, `src/job-service.js`, `src/repository.js` và các test Staff liên quan. README Staff có một số báo cáo giai đoạn cũ; contract thực thi lấy từ source và kiểm chứng lại theo lớp kiểm thử dưới đây.

## API được sử dụng

```text
Browser Staff :3002
  └─ GET /api/staff/jobs?status=...&page=...&pageSize=...&sort=...
       └─ Next.js BFF: đọc phiên server, kiểm tra Auth thật
            └─ GET Staff :4005/api/v1/staff/me/jobs
                 Authorization: Bearer <JWT phía server>
```

Browser không nhận JWT, không gọi cổng 4005 trực tiếp và không cung cấp employeeId. BFF chỉ gọi endpoint danh sách cố định, không tạo proxy URL tùy ý hoặc chuyển tiếp `/internal/` của Order. Staff Service quyết định nhân viên hiện tại từ JWT đã xác minh rồi giới hạn assignment theo `employees.user_id`.

| Query | Hợp đồng Staff hiện có |
| --- | --- |
| `status` | `WAITING`, `ASSIGNED`, `ACCEPTED`, `IN_PROGRESS`, `DONE`, `CANCELLED`; `WAITING` được hiểu là database `ASSIGNED` |
| `page` | Số nguyên canonical từ 1 đến 100000; mặc định 1 |
| `pageSize` | Từ 1 đến 100; mặc định 20 |
| `sort` | `asc` hoặc `desc`; mặc định `asc`, theo lịch thực hiện rồi assignment ID |

Không hỗ trợ tìm kiếm toàn bộ dữ liệu, lọc ngày, employeeId/userId hoặc các tham số tùy ý trên API UC9 hiện tại. Query lạ/trùng hoặc giá trị sai bị từ chối. Không giả vờ đã hỗ trợ tính năng Backend chưa có.

Response danh sách giữ envelope `{data,pagination:{page,pageSize,total,totalPages},timezone:"Asia/Ho_Chi_Minh"}`. Danh sách rỗng là `data:[]`; trang vượt cuối vẫn giữ tổng số bản ghi thực tế. Không coi một trang rỗng là bằng chứng nhân viên không có việc.

## Mapping dữ liệu

Không ép DTO Backend thành kiểu `Order` local cũ và không bổ sung tên, giá, mã đơn hoặc hồ sơ giả.

| Backend | Hiển thị / xử lý Frontend |
| --- | --- |
| `assignmentId` và `id` | ID công việc; khóa dòng và điều hướng `/don/:assignmentId`, giữ chuỗi BIGINT; trang chi tiết chưa nối API trong 2A |
| `orderId` | ID booking riêng biệt; không dùng thay assignment ID |
| `jobCode`, `orderCode` | Hiện trả null; hiển thị ID có nhãn khi thiếu mã, không tạo mã nghiệp vụ mới |
| `services[]` | Giữ tất cả dịch vụ trong đơn; tên, đơn vị, khối lượng và giá lấy từ snapshot |
| `services[].quantity`, `unitPrice` | Chuỗi DECIMAL; không dùng để tính lại giá booking hoặc gán thành thu nhập nhân viên |
| `contact.name`, `contact.address` | Thông tin có thật từ address snapshot/Customer; thiếu dữ liệu có nhãn phù hợp |
| `scheduledAt`, `expectedEndAt` | ISO UTC, hiển thị giờ Việt Nam bằng `Asia/Ho_Chi_Minh`; không phụ thuộc múi giờ máy người xem |
| `durationMinutes` | Thời lượng lịch Backend; không suy ra số giờ công hoặc tiền lương |
| `databaseStatus=ASSIGNED`, `status=WAITING`, `jobStatus=waiting` | Chờ tiếp nhận |
| `ACCEPTED` / `accepted` | Đã tiếp nhận |
| `IN_PROGRESS` / `in_progress` | Đang thực hiện |
| `DONE` / `done` | Hoàn thành |
| `CANCELLED` / `jobStatus=null` | Đã hủy; xử lý riêng, không tự gán thành đang chờ |
| `orderStatus` | Trạng thái booking, không thay thế trạng thái assignment |
| `assignedAt`, `checkInAt`, `checkOutAt` | Giữ thời điểm thực tế hoặc null; không tạo lịch sử hoặc thời điểm giả |

Một booking có thể có nhiều nhân viên: mỗi người nhận assignment riêng; một booking cũng có thể có nhiều `services`. UC9 không gộp mất các thông tin này. Danh sách Backend không trả phone khách hàng; không lấy thêm thông tin từ localStorage để bù.

## Cấu hình và chạy

Giữ cấu hình phiên Giai đoạn 1, bổ sung cấu hình server theo `.env.example` của Staff:

```dotenv
STAFF_SERVICE_URL=http://127.0.0.1:4005
STAFF_API_TIMEOUT_MS=8000
```

`STAFF_SERVICE_URL` là URL service cố định, không nhận từ query browser. Không đặt biến này cùng credential dưới `NEXT_PUBLIC_*`; không chuyển MySQL password, Auth private key hoặc Order internal token vào Frontend.

Tái sử dụng các tiến trình đang chạy. Nếu chưa chạy, mở các terminal riêng từ thư mục gốc:

```powershell
Set-Location backend/auth-service
npm.cmd start
```

```powershell
Set-Location backend/staff-service
$env:JWT_ISSUER = 'http://localhost:4001'
$env:JWT_AUDIENCE = 'cleanhome-staff-api'
$env:JWT_JWKS_URL = 'http://127.0.0.1:4001/.well-known/jwks.json'
$env:AUTH_INTROSPECTION_URL = 'http://127.0.0.1:4001/api/v1/auth/introspect'
$env:RECONCILIATION_WORKER_ENABLED = 'false'
npm.cmd start
```

Đây là cấu hình **công khai ở môi trường tiến trình local đã kiểm thử**, không phải private key hoặc token. Lượt này phát hiện `.env` Staff hiện có issuer/audience trống và chưa chọn public key/JWKS; không sửa file Backend của owner. Các giá trị phía trên phải khớp Auth đang chạy. Giữ cấu hình MySQL hiện có và xác minh database `cleanhome_staff_test`. Worker đối chiếu UC12 được tắt trong tiến trình chỉ đọc UC9. Nếu owner cấu hình `JWT_PUBLIC_KEY`, chọn đúng một trong public key và JWKS theo guard Backend; không âm thầm ghi đè lựa chọn của owner.

```powershell
Set-Location frontend/apps/staff
npm.cmd run auth:init
npm.cmd run dev
```

`auth:init` không ghi đè khóa đã có. Không chạy lại provisioning/seed để khởi động website. Dùng tài khoản EMPLOYEE do Auth owner cấp, mở `http://localhost:3002/dang-nhap` rồi `/cong-viec`. Order Service không cần cho thao tác đọc UC9; không gọi UC12 để thử dữ liệu đã hoàn thành.

## Kiểm thử HTTP thật

File `test/jobs-http.integration.test.mjs` chỉ chạy opt-in với BFF Next.js, Auth và Staff thật. Nó không đọc `.env` Backend, khóa/vault, không tạo token, không truy vấn SQL và không sửa MySQL. Owner có thể cung cấp credential QA vào môi trường tiến trình con từ helper Auth đã có; không in credential vào chat, terminal hoặc artifact.

| Biến của tiến trình test | Ý nghĩa |
| --- | --- |
| `RUN_STAFF_UC9_HTTP_TESTS=true` | Cho phép chạy suite; mặc định SKIP trước khi gọi HTTP |
| `STAFF_BFF_TEST_BASE_URL` | Origin loopback Staff, mặc định `http://localhost:3002` |
| `STAFF_BFF_TEST_PHONE_A`, `STAFF_BFF_TEST_PASSWORD_A` | Employee A thật |
| `STAFF_BFF_TEST_PHONE_B`, `STAFF_BFF_TEST_PASSWORD_B` | Employee B thật, khác A |
| `STAFF_BFF_TEST_USER_ID_A`, `STAFF_BFF_TEST_USER_ID_B` | Tùy chọn đối chiếu ID Auth |
| `STAFF_UC9_TEST_ASSIGNMENT_IDS_A`, `STAFF_UC9_TEST_ASSIGNMENT_IDS_B` | CSV ID assignment từ SELECT snapshot chỉ đọc, để đối chiếu chính xác toàn bộ tập kết quả |

Nếu không truyền CSV metadata, suite chỉ kiểm tra sự hiện diện các ID fixture đã ghi trong tài liệu multi-employee và việc loại trừ ID của người kia; khi đó không được mô tả là đã đối chiếu đầy đủ mọi assignment trong MySQL. Không hardcode trạng thái ban đầu từ seed vì UC12 QA có thể đã hoàn thành các công việc đó.

```powershell
# Sau khi đã cung cấp credential vào môi trường một cách an toàn:
$env:RUN_STAFF_UC9_HTTP_TESTS = 'true'
try { node --test --test-concurrency=1 test/jobs-http.integration.test.mjs }
finally { Remove-Item Env:RUN_STAFF_UC9_HTTP_TESTS -ErrorAction SilentlyContinue }
```

Các lệnh tương ứng đã có trong package Staff:

```powershell
npm.cmd run test:auth
npm.cmd run test:jobs
npm.cmd run typecheck -- --incremental false
npm.cmd run build
```

Chạy build và typecheck Staff tuần tự. Sau khi đã cung cấp credential A/B an toàn, bật riêng từng suite tích hợp:

```powershell
$env:RUN_STAFF_UC9_HTTP_TESTS = 'true'
try { npm.cmd run test:jobs:http }
finally { Remove-Item Env:RUN_STAFF_UC9_HTTP_TESTS -ErrorAction SilentlyContinue }

$env:RUN_STAFF_UC9_LIFECYCLE_TESTS = 'true'
try { npm.cmd run test:jobs:lifecycle }
finally { Remove-Item Env:RUN_STAFF_UC9_LIFECYCLE_TESTS -ErrorAction SilentlyContinue }

$env:RUN_STAFF_UC9_BROWSER_TESTS = 'true'
try { npm.cmd run test:jobs:browser }
finally { Remove-Item Env:RUN_STAFF_UC9_BROWSER_TESTS -ErrorAction SilentlyContinue }
```

Browser suite dùng CSV metadata có tên `STAFF_UC9_EXPECTED_ASSIGNMENT_IDS_A/B` (khác `STAFF_UC9_TEST_ASSIGNMENT_IDS_A/B` của HTTP suite); cả hai lấy từ cùng SELECT snapshot đã xác minh. Lifecycle dùng `AUTH_SERVICE_URL`/`STAFF_SERVICE_URL` phía tiến trình test và credential A. Nó tạo HTTP bridge/kho phiên QA riêng quanh chính handler BFF, gọi Auth/Staff thật, không phải Next.js routing E2E. Browser cần Chrome, profile tách biệt; mặc định scenario `regular`. Scenario `outage` chỉ dùng khi người kiểm thử kiểm soát tiến trình Staff QA có thể dừng/khôi phục an toàn, không áp dụng cho service của người khác hoặc production. Script không tự dừng một service bất kỳ.

Suite có 16 ca, mỗi request timeout 15 giây, cả suite 180 giây; giới hạn dữ liệu trả về 1 MiB. Kiểm tra thiếu/không tồn tại phiên, không nhận Authorization browser thay phiên, Auth thật A/B, đúng tập assignment riêng, booking chung vẫn tách assignment, sắp xếp/phân trang/lọc trạng thái, trang vượt cuối, chặn query định danh/URL và giá trị sai, chặn method ghi/Origin khác, request mới giống reload HTTP và logout A → đăng nhập B. Mọi JSON được kiểm tra không lộ JWT/credential và có `Cache-Control: no-store`. Cleanup chỉ logout các phiên do suite tạo, không reset dữ liệu hoặc xóa file phiên ứng dụng bằng tay.

HTTP request mới không thay thế kiểm chứng reload UI thật. Kết quả browser/E2E phải ghi riêng. Trang rỗng do filter/page không thay thế tài khoản nhân viên thật không có assignment.

## Kết quả lượt triển khai

Lượt ngày 24/10/2026 dùng Auth `4001`, Next.js Staff `3002`, Staff `4005`, MySQL `cleanhome_staff_test` thật. Bộ HTTP được opt-in và chạy với credential A/B truyền qua môi trường tiến trình test riêng từ helper Auth, không đưa khóa/vault vào Frontend, không đưa mật khẩu vào source hoặc browser response. Các kết quả chưa hoàn tất giữ NOT_RUN; suite mặc định SKIP không được tính PASS.

| Lớp kiểm tra | PASS | FAIL | SKIP / NOT_RUN | Phạm vi |
| --- | ---: | ---: | --- | --- |
| Unit Auth hồi quy | 55 | 0 | 0 | Core, HTTP wrapper và helper UI Giai đoạn 1 |
| Unit UC9 BFF / mapping | 45 | 0 | 0 | 14 contract/config, 14 HTTP wrapper, 7 phiên mã hóa thật với Auth double, 10 UI model; không thay thế HTTP thật |
| HTTP Next BFF → Auth → Staff → MySQL | 16 | 0 | 0 | JWT Auth thật; A/B đối chiếu CSV toàn bộ assignment từ SELECT snapshot chỉ đọc |
| HTTP lifecycle bridge → Auth/Staff thật | 2 | 0 | 0 | TTL phiên BFF tối đa 3 giây hết hạn trả 401; logout vô hiệu hóa SID cho UC9; không phải Next.js routing E2E |
| Chrome UC9, luồng bình thường | 15 | 0 | 0 | Dữ liệu A/B thật, filter/sort/page/empty theo filter, reload, đổi tài khoản, cookie/storage và bốn chiều rộng |
| Chrome UC9, Staff QA ngừng thật | 4 | 0 | 0 | Dừng tạm tiến trình Staff QA do lượt kiểm thử sở hữu, UI lỗi/retry, HTTP 503 và Auth vẫn giữ phiên 200 |
| HTTP Next.js sau khôi phục Staff QA | 1 | 0 | 0 | Đăng nhập A mới, GET 200 đúng 23 assignment theo SELECT snapshot và logout thành công |
| Nhân viên thật không có assignment | — | — | NOT_RUN | Hiện chỉ xác nhận hai nhân viên đã có công việc; không tự tạo tài khoản/dữ liệu |
| JWT thật hết hạn | — | — | NOT_RUN | Không nhầm TTL BFF ngắn với JWT Auth hết hạn |
| Typecheck Staff / Customer / Admin | 3 lượt | 0 | 0 | Chạy tuần tự sau build Staff, `--incremental false` |
| Build Staff | 1 lượt | 0 | 0 | Production build có route `/api/staff/jobs`; không đồng nghĩa kiểm chứng deployment HTTPS |

Snapshot MySQL trước kiểm thử có **44 assignments, 24 bookings, 24 booking_items, 22 booking_status_history**. A (`users.id=9109002`) nhận đúng **23 assignment** của A; B (`9109101`) nhận đúng **21 assignment** của B. Hai tập tách biệt, đối chiếu đầy đủ với CSV từ SELECT; không chỉ kiểm tra các ID seed tối thiểu. Booking chung giữ hai assignment `9109133`/`9109134` riêng và hiện đã `DONE`; test chỉ đọc, không đưa chúng về trạng thái ban đầu hoặc gọi lại UC12.

HTTP xác nhận pageSize 1/page 2, sort asc/desc ổn định theo lịch và ID, sáu giá trị bộ lọc theo trạng thái thực tế và trang vượt cuối có metadata đúng. Bộ lọc `CANCELLED` hiện cho kết quả rỗng; đây là **danh sách sau lọc**, không phải bằng chứng một nhân viên thật chưa có assignment. Header Authorization từ browser không thay thế phiên; query employeeId/userId/URL và method ghi bị chặn. Logout A làm ID phiên cũ trả 401, đăng nhập B nhận tập B không chứa assignment A. Các JSON kiểm tra không có token/credential và có `no-store`; bằng chứng reload UI và browser storage được ghi riêng dưới đây.

Chrome đã kiểm chứng reload giữ phiên và lấy lại dữ liệu A, logout xóa danh sách/cookie rồi đăng nhập B không chớp dữ liệu của A, các link chi tiết giữ assignment ID nhưng không gọi API UC10. Browser chỉ gọi BFF cùng origin, không gọi Staff/Order trực tiếp hoặc nhận JWT; canary localStorage/sessionStorage cũ giữ nguyên. Cả hai profile QA đã đóng, không ghi nhận exception JavaScript hoặc credential leak. Bố cục UC9 kiểm tra **375, 390, 768, 1440px**, không phát hiện tràn ngang hoặc nút vượt viewport; đã xem screenshot mobile/desktop.

Các lượt browser đầu áp tiêu chí chiều cao vùng bấm 44px cho cả Header cũ và UC9 nên báo FAIL ở nút tài khoản Header cao 32px đã có trước nhiệm vụ. Đã sửa phạm vi assertion chiều cao thành các control UC9, tiếp tục kiểm tra toàn bộ control không vượt viewport, rồi chạy lại đạt 15/15. Không sửa Header để mở rộng phạm vi; không tuyên bố mọi nút Header đã đạt 44px. Giới hạn Header này được giữ lại để owner cân nhắc riêng.

Ca gián đoạn dùng **Staff thật tại 4005**, tạm dừng đúng tiến trình QA do lượt này khởi chạy rồi khôi phục thành công. Auth và Frontend vẫn chạy; UI báo lỗi có nút thử lại, không hiển thị dữ liệu cũ hoặc giả danh sách rỗng, `/api/staff/jobs` trả 503 và `/api/auth/session` vẫn 200. Không thay API production bằng mock. Ca TTL 3 giây là phiên BFF thật ngắn hạn; **chưa chờ JWT Auth 900 giây hết hạn**.

Artifact dưới `apps/staff/.auth-data/qa/uc9/` đã được Git ignore:

| Artifact | Bằng chứng |
| --- | --- |
| `browser/report.json` | 15 PASS, 0 FAIL, 0 SKIP; profile closed; metadata mạng và assignment |
| `browser/uc9-375.png`, `browser/uc9-1440.png` | Ảnh responsive đã xem |
| `browser-outage/report.json` | 4 PASS, 0 FAIL, 0 SKIP với Staff QA ngừng thật; profile closed |
| `lifecycle.tap` | 2 PASS, 0 FAIL, 0 SKIP qua HTTP bridge |
| `recovery.json` | Khôi phục Staff thật, Next.js GET 200 đúng toàn bộ 23 assignment A |
| `preservation-report.json` | Hash 69 file nguồn được bảo vệ không đổi |
| `mysql-preservation.json` | So sánh snapshot mọi cột bốn bảng trước/sau không đổi |

## File và bảo toàn

Các đường dẫn dưới đây tính từ `frontend/`; **17 file tạo/sửa thủ công** trong 2A.

| File | Tạo / sửa | Nội dung |
| --- | --- | --- |
| `apps/staff/app/api/staff/jobs/route.ts` | Tạo | Route GET cùng origin, chỉ danh sách UC9 |
| `apps/staff/lib/server/jobs-config.mjs` | Tạo | URL Staff cố định và timeout server |
| `apps/staff/lib/server/jobs-contract.mjs` | Tạo | Whitelist query và validation/sanitization DTO |
| `apps/staff/lib/server/jobs-http.mjs` | Tạo | Xác minh phiên, gọi Staff bằng JWT phía server, xử lý lỗi/no-store |
| `apps/staff/lib/server/auth-core.mjs` | Sửa | Tái sử dụng kiểm tra phiên qua helper; thêm callback sử dụng token phía server, giữ DTO phiên browser không có token |
| `apps/staff/.env.example` | Sửa | Thêm `STAFF_SERVICE_URL`, `STAFF_API_TIMEOUT_MS`, không có secret |
| `apps/staff/package.json` | Sửa | Lệnh test UC9, không thêm dependency |
| `packages/ui/src/components/staff/staff-auth-portal.tsx` | Sửa | Nối trang công việc với UC9 thật; các UC khác giữ giới hạn Giai đoạn 1 |
| `packages/ui/src/components/staff/staff-jobs-remote-model.ts` | Tạo | DTO/query và định dạng giờ Việt Nam tách khỏi kiểu Order local |
| `packages/ui/src/components/staff/staff-jobs-remote.tsx` | Tạo | Card/bảng responsive, filter/sort/phân trang, loading/empty/error/retry, chống kết quả cũ khi đổi phiên |
| `apps/staff/test/jobs-contract.test.mjs` | Tạo | Kiểm thử config, query, DTO và dữ liệu sai |
| `apps/staff/test/jobs-http.test.mjs` | Tạo | Wrapper BFF và phiên mã hóa; doubles chỉ trong unit |
| `apps/staff/test/jobs-ui.test.mjs` | Tạo | Model UI, trạng thái, ID, query và giờ Việt Nam |
| `apps/staff/test/jobs-http.integration.test.mjs` | Tạo | HTTP Next.js → Auth/Staff/MySQL thật, 16 ca chỉ đọc |
| `apps/staff/test/jobs-lifecycle.integration.test.mjs` | Tạo | Vòng đời UC9 HTTP với dependency thật và môi trường QA riêng |
| `apps/staff/test/jobs-browser.integration.mjs` | Tạo | Chrome profile QA riêng, luồng UC9 và các trạng thái |
| `apps/staff/docs/UC9_INTEGRATION.md` | Tạo | Báo cáo, contract/mapping, lệnh chạy và giới hạn |

Next.js có thể tự cập nhật type reference trong `apps/staff/next-env.d.ts` khi dev/build; không chỉnh sửa thủ công file sinh ra. Đối chiếu hash **69 file nguồn** Backend ba service, core, Staff cũ, component dùng chung/Portal và Customer auth đều không đổi so với đầu lượt. Customer/Admin chỉ typecheck và đối chiếu nguồn trong 2A, không chạy lại toàn bộ luồng trình duyệt của hai ứng dụng đó.

Snapshot trước/sau **mọi cột** của `assignments` (44 dòng), `bookings` (24), `booking_items` (24), `booking_status_history` (22) khớp hoàn toàn. Đây không phải checksum toàn bộ 32 bảng. Không đổi contract Backend, không ghi database, không gọi Order, không cập nhật UC12, không xóa localStorage và không tự commit/push/merge/reset/checkout.

| Kiểm tra tuân thủ | Trạng thái | Bằng chứng / giới hạn |
| --- | --- | --- |
| Đúng phạm vi và bảo vệ code nhóm | PASS | 17 file Frontend Staff; 69 file được đối chiếu hash không đổi |
| Không hồi quy Auth / Customer / Admin | PASS theo phạm vi đã chạy | Auth unit 55; ba typecheck; không đồng nghĩa đã chạy lại toàn bộ E2E Customer/Admin |
| Contract và quyền sở hữu dữ liệu UC9 | PASS | DTO/query theo source Staff, HTTP thật A23/B21 không chồng lẫn |
| MySQL không bị thay đổi | PASS theo bốn bảng đối chiếu | Snapshot mọi cột trước/sau; không seed/reset/ghi SQL |
| JWT/phiên và secret | PASS theo các ca đã chạy | HttpOnly opaque cookie, server-only token, no-store, Origin và query whitelist; không đưa credential vào source/artifact |
| Tích hợp UC10–UC12 / migration | NOT_APPLICABLE | Ngoài phạm vi 2A, không thực thi |
| Employee thật không có assignment / JWT Auth hết hạn | NOT_VERIFIED | Thiếu fixture nhân viên rỗng; chưa chờ 900 giây, không tự tạo/xóa dữ liệu |
| Deployment HTTPS / nhiều host / review thủ công của đồng đội | NOT_VERIFIED | Cần môi trường và review riêng, không suy từ build local |

## Giới hạn và bước tiếp theo

- UC10, UC11 và UC12 chưa tích hợp. Điều hướng công việc dùng assignment ID nhưng không được mô tả là đã gọi API chi tiết hoặc cập nhật trạng thái.
- Dữ liệu UC9 chỉ từ Staff API; những chức năng cũ chưa nối API tiếp tục theo giới hạn Giai đoạn 1, không trộn store demo với phiên Backend.
- JWT/Auth introspection, MySQL hoặc Staff gián đoạn có thể khiến UC9 tạm không khả dụng; UI phải báo lỗi, không fallback về dữ liệu giả.
- Kho phiên vẫn là filesystem mã hóa trên một host theo [giới hạn Giai đoạn 1](AUTH_INTEGRATION.md). HTTPS, reverse proxy và triển khai nhiều máy cần kiểm chứng riêng.
- Chưa có tài khoản EMPLOYEE thật không có assignment; empty state đã kiểm tra qua filter có tổng 0 và unit, không báo ca employee rỗng thật là PASS. Nút tài khoản Header cũ cao 32px vẫn ngoài phạm vi UC9.
- Giai đoạn tiếp theo đề xuất UC10: BFF cố định `/api/staff/jobs/:assignmentId`, đọc API chi tiết thật, tiếp tục kiểm tra A/B nhận 404 với assignment không thuộc quyền, giữ các trường null/unsupported đúng contract và không gọi Order internal từ browser. Chưa triển khai trong 2A.
