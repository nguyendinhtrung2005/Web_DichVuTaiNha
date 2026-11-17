# CleanHome — Giai đoạn 3: lịch làm việc Staff từ Backend

## Phạm vi và nguồn hợp đồng

Chỉ tích hợp **UC11 — xem lịch làm việc** trên website Staff `http://localhost:3002`. Kế thừa phiên thật, UC9 và UC10 đã hoàn thành. Lịch chỉ đọc: không chỉnh lịch, đăng ký ca, thay availability hoặc cập nhật UC12; không đổi Backend, database, Customer/Admin hoặc localStorage cũ.

Đã đọc `AGENTS.md`, `BACKEND_TEAM_RULES .md` (tên file thực tế có khoảng trắng), Staff app `AGENTS.md`, tài liệu Next.js đi kèm, [Auth Frontend](AUTH_INTEGRATION.md), [UC9](UC9_INTEGRATION.md), [UC10](UC10_INTEGRATION.md), [Staff README](../../../../backend/staff-service/README.md), Backend route/validation/service/repository/DTO và các test schedule liên quan. `staff-calendar.tsx` cũ có ngày/tuần/tháng/danh sách tuần; giữ nguồn cũ để bảo toàn các phần chưa tích hợp. Kết quả cũ không thay kết quả kiểm thử UC11 lần này.

## API và quy tắc ngày giờ

```text
Browser Staff :3002/lich-lam-viec
  └─ GET /api/staff/schedule?from=YYYY-MM-DD&to=YYYY-MM-DD&...
       └─ BFF xác minh phiên, lấy JWT phía server
            └─ GET Staff :4005/api/v1/staff/me/schedule?from=...&to=...
                 Authorization: Bearer <JWT phía server>
```

| Query | Contract Backend thực tế |
| --- | --- |
| `from`, `to` | Bắt buộc, đúng `YYYY-MM-DD`, ngày tồn tại trong 1971–2099; `to >= from` |
| Khoảng hỗ trợ | Tối đa **366 ngày gồm cả hai đầu**; khoảng cách hai ngày không quá 365 ngày |
| `status` | WAITING/ASSIGNED, ACCEPTED, IN_PROGRESS, DONE, CANCELLED; WAITING map ASSIGNED |
| `page` | Mặc định 1; số nguyên canonical 1–100000 |
| `pageSize` | Mặc định 20; 1–100 |
| `sort` | asc/desc, mặc định asc; lịch bắt đầu rồi assignment ID để phân trang ổn định |

Chỉ sáu query trên được chấp nhận; query lạ/trùng, employeeId/userId hoặc URL tùy ý bị từ chối. BFF không nhận JWT do browser cung cấp thay phiên, không proxy Order internal. Token chỉ ở server; cookie phiên giữ opaque ID HttpOnly theo Giai đoạn 1. JSON dùng `Cache-Control: no-store`.

`from/to` là **ngày Việt Nam**, không phải ngày UTC. Với ngày D, khoảng truy vấn bắt đầu lúc 00:00 D tại UTC+07 và kết thúc lúc 00:00 ngày sau `to`; đầu khoảng bao gồm, cuối không bao gồm. Công việc được lấy khi:

```text
scheduledStart < rangeEnd && scheduledEnd > rangeStart
```

Vì vậy job giao ngày được giữ, kể cả bắt đầu trước khoảng hoặc kết thúc sau khoảng; hai khoảng chỉ chạm nhau ở đầu/cuối không bị coi là giao. MySQL/API dùng UTC và ISO timestamp; hiển thị/group theo **UTC+07 cố định mà Backend đang quy định cho lịch Việt Nam**, không cắt ngày từ ISO UTC hoặc dựa vào múi giờ máy người xem. Một ngày không có lịch trả `data:[]`, tổng 0; lỗi phụ thuộc phải hiển thị error/retry, không giả thành lịch rỗng.

Rà soát phát hiện khác biệt lịch sử: trường hợp **1971 đã kiểm tra** cho thấy IANA `Asia/Ho_Chi_Minh` có offset UTC+08, trong khi Backend cho phép ngày từ 1971 và luôn trừ 7 giờ khi tạo biên truy vấn. UC11 dùng formatter/grouping riêng theo UTC+07 cố định để khớp contract thực thi trên khoảng 1971–2099; raw ISO từ API giữ nguyên. Đây là tương thích chính sách Backend, **không phải cam kết tái hiện mọi offset lịch sử IANA**. Ngày hiện đại như các fixture 2026 vẫn trùng `Asia/Ho_Chi_Minh` UTC+07. Chỉ sửa model/UI UC11 mới; formatter lịch sử UC9/UC10 giữ nguyên ngoài phạm vi, không thay Backend hoặc contract một phía.

`employee_availability` là dữ liệu khả dụng, **không phải** lịch các assignment. UC11 lấy dữ liệu từ assignments/bookings qua Staff API, không đổi ownership hay ghi trực tiếp database.

## Mapping lịch Backend → Frontend

Response giữ envelope `{data,pagination:{page,pageSize,total,totalPages},timezone:"Asia/Ho_Chi_Minh"}`, cùng DTO danh sách UC9. Không ép thành `Order` local.

| Backend | Dùng trong lịch |
| --- | --- |
| `assignmentId`, `id` | ID phân công dạng chuỗi; khóa event/dòng và link UC10 `/don/:assignmentId` |
| `orderId` | ID booking riêng; cùng booking vẫn có assignment khác nhau cho A/B |
| `scheduledAt`, `expectedEndAt` | ISO UTC thực tế, hiển thị giờ Việt Nam; xét giao khoảng theo cả bắt đầu/kết thúc |
| `durationMinutes` | Thời lượng dự kiến, không tự suy thành số giờ công/thu nhập |
| `services[]` | Giữ mọi dịch vụ snapshot, không gộp mất booking nhiều dịch vụ |
| `serviceId`, `quantity`, `unitPrice` | Giữ chuỗi ID/DECIMAL; không tính lại giá hoặc tạo số liệu giả |
| `status`, `databaseStatus`, `jobStatus` | Trạng thái assignment: ASSIGNED→WAITING/waiting, ACCEPTED, IN_PROGRESS, DONE, CANCELLED |
| `orderStatus` | Trạng thái booking riêng, không dùng thay assignment status |
| `contact.name`, `address` | Thông tin thực có trong list/schedule; không lấy phone chi tiết ngoài UC10 |
| `assignedAt`, `checkInAt`, `checkOutAt` | Giữ timestamp/null, không tạo thao tác/hành trình giả |
| `jobCode`, `orderCode` | Hiện null; dùng ID có nhãn, không tạo mã nghiệp vụ mới |

Không tự thay đổi lịch giao nhau, gộp nhiều assignment thành một event hoặc tạo field còn thiếu.

## Giao diện và phân trang

Source mới giữ phong cách lịch cũ và component Staff dùng chung, có **ngày/tuần/tháng/danh sách**; tuần bắt đầu thứ Hai. Desktop có lưới tuần/tháng, màn hình hẹp dùng danh sách theo ngày. Event giữ từng assignment và toàn bộ dịch vụ, thời gian/địa chỉ/trạng thái; các job trùng giờ xếp thành mục riêng, không đổi lịch hoặc ghi đè. Grouping xét giao với từng ngày, gồm cả lịch kéo qua ngày trong model.

Có chọn khoảng ngày, trạng thái, sort và pageSize; mặc định pageSize 100 theo giới hạn Backend. Khi tổng vượt một trang, UI ghi rõ đang hiển thị một phần, có phân trang và không tuyên bố ô trống trên trang hiện tại là toàn bộ ngày không có lịch. Tổng số job lấy từ pagination, không cộng số event qua các ngày để tránh đếm hai lần lịch giao ngày. Không âm thầm cắt các bản ghi còn ở trang khác.

`view` và `anchor` chỉ là query điều hướng UI; BFF chỉ nhận sáu query Backend ở trên. URL giữ khoảng ngày/bộ lọc/page để reload tải lại đúng. Đổi khoảng, phiên hoặc đăng xuất hủy request cũ và loại dữ liệu cũ trước khi hiển thị; lỗi có thông báo/thử lại, empty chỉ khi API thật trả rỗng. Event mở UC10 bằng assignment ID thật. UC10 giữ hành vi quay về danh sách UC9 đã có; không thay helper UC10 để mở rộng phạm vi trong UC11.

Chrome đã xác nhận bốn chế độ ngày/tuần/tháng/danh sách, nhiều công việc cùng ngày không ghi đè, filter/sort/phân trang có nhãn dữ liệu một phần, validation không gửi request khi khoảng draft sai, empty từ API thật, chuyển năm và 31/01 sang tháng Hai năm nhuận. Reload giữ URL/khoảng/query và tải đúng dữ liệu A. Mở event sang UC10 đúng assignment và browser Back phục hồi lịch; không thay logic quay về của UC10.

Đã kiểm tra **375, 390, 768, 1440px**, không phát hiện tràn ngang hoặc control vượt viewport; đã xem screenshot mobile/desktop. Logout A xóa các event trước khi login B; B không thấy chớp dữ liệu A. Browser chỉ gọi BFF cùng origin, không nhận JWT, giữ storage canary cũ; không ghi nhận exception JavaScript hoặc credential leak và profile QA đã đóng. Kết quả chi tiết ghi trong bảng kiểm thử bên dưới.

Tiêu đề/ngày giờ do ứng dụng định dạng dùng `dd/mm/yyyy`; giá trị ngày API là `YYYY-MM-DD`. Ô `input type="date"` dùng giao diện native theo locale browser; Chrome QA hiển thị `MM/DD/YYYY` trong ô, không ảnh hưởng giá trị gửi API. Chưa thay date picker hoặc tuyên bố mọi ô native đều có định dạng hiển thị cố định.

## Cấu hình và chạy

Giữ cấu hình server BFF đang dùng:

```dotenv
AUTH_SERVICE_URL=http://127.0.0.1:4001
STAFF_SERVICE_URL=http://127.0.0.1:4005
STAFF_API_TIMEOUT_MS=8000
STAFF_APP_ORIGIN=http://localhost:3002
```

Không thêm secret vào `NEXT_PUBLIC_*`, không copy key/vault Auth, MySQL credential hoặc Order internal token sang Frontend. Giữ nguyên khóa/kho phiên; `auth:init` không ghi đè khóa tồn tại. Không chạy seed/reset/provisioning để bật UI.

Tái sử dụng tiến trình đang chạy. Nếu chưa có, mở terminal riêng từ gốc repository:

```powershell
Set-Location backend/auth-service
npm.cmd start
```

**Đã kiểm tra lại trong UC11:** Staff `.env` vẫn thiếu issuer/audience và JWKS/public key; chỉ `npm start` với file đó chưa sẵn sàng. Các lượt tích hợp dùng tiến trình Staff QA được cung cấp cấu hình công khai hợp lệ qua môi trường tiến trình, JWT RS256/JWKS/introspection thật và worker đối chiếu tắt. Không sửa `.env` Backend. Owner có thể bổ sung các giá trị công khai tương ứng Auth vào local config hoặc đặt trong terminal Staff riêng:

```powershell
Set-Location backend/staff-service
$env:JWT_ISSUER = 'http://localhost:4001'
$env:JWT_AUDIENCE = 'cleanhome-staff-api'
$env:JWT_JWKS_URL = 'http://127.0.0.1:4001/.well-known/jwks.json'
$env:AUTH_INTROSPECTION_URL = 'http://127.0.0.1:4001/api/v1/auth/introspect'
$env:RECONCILIATION_WORKER_ENABLED = 'false'
npm.cmd start
```

Chọn đúng một trong `JWT_PUBLIC_KEY` hoặc `JWT_JWKS_URL` theo guard Backend. Các URL/issuer/audience phải khớp Auth đang chạy; không sinh secret hoặc bỏ kiểm tra JWT. Giữ MySQL test và credential hiện có, không sửa source hay `.env` Backend trong lượt Frontend.

```powershell
Set-Location frontend/apps/staff
npm.cmd run auth:init
npm.cmd run dev
```

Mở `http://localhost:3002/dang-nhap`, đăng nhập EMPLOYEE thật do Auth owner cấp, rồi `/lich-lam-viec`. Chọn ngày/khoảng có dữ liệu MySQL hiện tại. Không dùng ngày seed cũ làm giả định bắt buộc và không thử lại UC12 trên QA đã hoàn thành.

## HTTP integration suite

File `test/schedule-http.integration.test.mjs` dùng native Node.js, mặc định NOT_RUN trước khi gọi mạng. Nó chỉ đọc BFF/API và một file metadata QA không PII; không tự SELECT MySQL, đọc Auth vault/key, tạo JWT, chạy seed hoặc gọi UC12. Root/owner tạo metadata từ SELECT snapshot chỉ đọc và cấp credential thật vào môi trường tiến trình test, không ghi password/token vào dòng lệnh/source/log.

| Biến test | Ý nghĩa |
| --- | --- |
| `RUN_STAFF_UC11_HTTP_TESTS=true` | Bật suite |
| `STAFF_BFF_TEST_BASE_URL` | Origin loopback Staff, mặc định `http://localhost:3002` |
| `STAFF_BFF_TEST_PHONE_A`, `STAFF_BFF_TEST_PASSWORD_A` | Employee A thật |
| `STAFF_BFF_TEST_PHONE_B`, `STAFF_BFF_TEST_PASSWORD_B` | Employee B thật |
| `STAFF_BFF_TEST_USER_ID_A/B` | Auth user IDs; mặc định các fixture hiện có 9109002/9109101 |
| `STAFF_UC11_TEST_METADATA_FILE` | File JSON trong `.auth-data/qa/uc11/` bị Git ignore, gồm metadata toàn bộ assignment của A/B |
| `STAFF_BFF_TEST_PHONE_CUSTOMER`, `STAFF_BFF_TEST_PASSWORD_CUSTOMER` | Tùy chọn kiểm tra Auth EMPLOYEE từ chối Customer; không có thì ca này SKIP |

Metadata chỉ nhận envelope `{database:"cleanhome_staff_test",assignments:[...]}`; mỗi dòng có đúng sáu trường `assignmentId,orderId,userId,databaseStatus,scheduledAt,expectedEndAt`. ID là chuỗi và timestamp ISO UTC. Không chứa địa chỉ, phone, tên khách hàng, password, token hoặc cấu hình kết nối. File có symlink, quá 1 MiB hoặc ngoài thư mục QA UC11 bị từ chối. Suite tính khoảng ngày Việt Nam từ snapshot hiện tại, không hardcode ngày/số job seed; so sánh overlap, status, sort, từng page và UTC timestamp với metadata.

Sau khi cấp môi trường an toàn, từ `frontend/apps/staff`:

```powershell
$env:RUN_STAFF_UC11_HTTP_TESTS = 'true'
try { node --test --test-concurrency=1 test/schedule-http.integration.test.mjs }
finally { Remove-Item Env:RUN_STAFF_UC11_HTTP_TESTS -ErrorAction SilentlyContinue }
```

Các lệnh package Staff:

```powershell
npm.cmd run test:auth
npm.cmd run test:jobs
npm.cmd run test:job-detail
npm.cmd run test:schedule
# Sau khi opt-in và cấp credential/metadata an toàn:
npm.cmd run test:schedule:http
$env:RUN_STAFF_UC11_BROWSER_TESTS = 'true'
try { npm.cmd run test:schedule:browser }
finally { Remove-Item Env:RUN_STAFF_UC11_BROWSER_TESTS -ErrorAction SilentlyContinue }
npm.cmd run build
npm.cmd run typecheck -- --incremental false
```

Build và typecheck Staff chạy tuần tự, tránh tranh chấp file type Next.js sinh lại. Không cần build toàn bộ ba ứng dụng.

Browser dùng cùng credential A/B và `STAFF_UC11_TEST_METADATA_FILE`, Chrome profile QA tách biệt; có thể chọn executable bằng `STAFF_BFF_CHROME_PATH`. Scenario mặc định `STAFF_UC11_BROWSER_SCENARIO=regular`. Scenario `outage` chỉ dùng khi kiểm soát đúng tiến trình Staff QA có thể dừng/khôi phục an toàn; không dừng service của người khác hoặc production. Script không tự tìm/dừng một service bất kỳ.

Suite có **22 ca**, timeout 15 giây/request, 180 giây cả suite, body tối đa 1 MiB. Gồm A/B đúng schedule; booking chung; nhiều job cùng ngày/nhiều ngày; sort/page/status; khoảng rỗng được snapshot xác nhận; ngày Việt Nam; leap day/giao năm/366 ngày; input sai; 401, Origin403, chống employeeId/URL/query/method; request mới giống reload HTTP; logout A→login B không lộ schedule A. Không báo HTTP request mới là reload UI thật. Ca biên ngày UTC/VN chỉ chạy khi metadata có job thật phù hợp; thiếu thì SKIP/NOT_RUN, không chèn dữ liệu để làm PASS.

## Kết quả lượt triển khai

HTTP và Chrome đã chạy với Next.js `3002`, Auth `4001`, Staff `4005` và MySQL `cleanhome_staff_test` thật. Kết quả dưới đây là lượt hoàn tất sau thay đổi formatter UTC+07 cuối cùng; các ca chưa có fixture hoặc môi trường riêng giữ SKIP/NOT_RUN, không lấy kết quả cũ thay cho lần này.

| Lớp kiểm tra | PASS | FAIL | SKIP / NOT_RUN | Phạm vi |
| --- | ---: | ---: | --- | --- |
| Cú pháp suite và gate opt-in mặc định | 1 lượt | 0 | Không áp dụng | `node --check` đạt; lượt gate không gọi mạng, không phải HTTP tích hợp |
| Unit UC11 BFF | 31 | 0 | 0 | 15 contract và 16 wrapper; dependency doubles chỉ trong unit |
| Unit model UI UC11 | 14 | 0 | 0 | Range/grouping/query, thời gian UTC+07 và hồi quy lịch sử 1971; tổng UC11 45 PASS |
| HTTP Next.js → Auth → Staff → MySQL | 21 | 0 | 1 SKIP | 22 ca, gồm Customer login403; SKIP đúng một ca thiếu fixture UTC/VN thực tế |
| Chi tiết ca biên ngày UTC/VN đã SKIP ở suite trên | — | — | SKIP / NOT_RUN | Cùng một ca SKIP, không đếm thêm; snapshot không có job phù hợp, không tạo dữ liệu để báo PASS |
| Chrome UC11, luồng bình thường | 22 | 0 | 0 | Bốn chế độ/chiều rộng, nhiều job/ngày, đổi khoảng/filter/page, reload, UC10/Back và đổi tài khoản |
| Chrome UC11, Staff QA ngừng thật | 4 | 0 | 0 | UI lỗi/retry, BFF 503 và Auth vẫn hoạt động; không hiển thị dữ liệu cũ hoặc giả lịch rỗng |
| HTTP mới sau khi Staff QA phục hồi | 1 | 0 | 0 | Login A mới, GET lịch đủ 23 assignment theo metadata, logout; không phải retry thành công trong cùng tab |
| Unit hồi quy Auth / UC9 / UC10 | 55 / 45 / 42 | 0 | 0 | Đã chạy lại trong lượt UC11 |
| HTTP hồi quy UC9 / UC10 | 34 | 0 | 0 | Hai suite thực tế 16 + 18 ca, có Auth/Staff/MySQL thật |
| Typecheck Staff / Customer / Admin | 3 lượt | 0 | 0 | Chạy tuần tự sau build và formatter cuối, `--incremental false` |
| Build Staff | 1 lượt | 0 | 0 | Production build có `/api/staff/schedule`, không đồng nghĩa deployment HTTPS đã được kiểm chứng |

Metadata chỉ đọc có **44 assignment**: A (`users.id=9109002`) có **23**, B (`9109101`) có **21**. Thời gian lưu trong khoảng `2026-10-22T01:00:00.000Z` đến `2026-10-27T03:00:00.000Z`; khoảng ngày API được tính thành 22–27/10/2026 tại Việt Nam. HTTP xác nhận đúng toàn bộ tập A/B tách biệt, booking chung giữ hai assignment riêng, nhiều job cùng ngày, nhiều ngày khác nhau, các trạng thái thực tế, sort/page, leap day/giao năm và giới hạn 366 ngày. Khoảng rỗng 01–02/01/1971 được metadata xác nhận và API trả tổng 0 cho cả hai người.

Snapshot hiện **không có job qua ranh ngày UTC/VN, bắt đầu trước khoảng rồi kéo vào khoảng hoặc qua nửa đêm Việt Nam**. HTTP đã kiểm tra đúng giờ Việt Nam của lịch thực có và input ngày, nhưng các ca dữ liệu qua biên/carry-in/midnight chỉ được kiểm tra trong unit; không báo chúng là MySQL/HTTP fixture thật đã đạt. Không tự cập nhật database để tạo fixture hoặc dữ liệu rỗng.

Ca gián đoạn tạm dừng đúng tiến trình Staff QA do lượt kiểm thử sở hữu, giữ Auth/Frontend hoạt động, rồi khôi phục với cùng public JWT/JWKS/introspection và worker tắt. Chrome có trạng thái lỗi/thử lại, 503 khác empty/404 và không lộ lịch cũ. Sau khôi phục, **một lượt HTTP mới** login A → đọc đúng 23 assignment → logout đạt. Chưa kiểm chứng click retry trở lại thành công trong cùng tab sau phục hồi; không gán request phục hồi mới cho kịch bản đó. Hai profile UC11 normal/outage đã đóng; tổng Chrome **26 PASS / 0 FAIL / 0 SKIP**, không có exception JavaScript hoặc credential leak.

Artifact dưới `apps/staff/.auth-data/qa/uc11/` đã được Git ignore:

| Artifact | Bằng chứng |
| --- | --- |
| `metadata.json` | Metadata không PII từ SELECT snapshot hiện tại |
| `http.tap` | 21 PASS / 0 FAIL / 1 SKIP, đúng ca thiếu fixture biên UTC/VN |
| `regression-http.tap` | 34 ca UC9/UC10 HTTP thật đạt |
| `browser/report.json` | 22 PASS với UI lịch thật, profile closed |
| `browser/uc11-375.png`, `browser/uc11-1440.png` | Screenshot đã xem |
| `browser-outage/report.json` | 4 PASS khi Staff QA ngừng thật, profile closed |
| `recovery.json` | HTTP mới login/read/logout đạt sau khôi phục Staff |
| `preservation-report.json` | Hash 95 file nguồn được bảo vệ không đổi |
| `mysql-preservation.json` | Snapshot mọi cột bốn bảng trước/sau không đổi |

## File và bảo toàn

Các đường dẫn tính từ `frontend/`: **13 file tạo/sửa thủ công**, gồm 11 file mới và 2 cập nhật.

| File | Tạo / sửa | Nội dung |
| --- | --- | --- |
| `apps/staff/app/api/staff/schedule/route.ts` | Tạo | Route GET lịch cùng origin, chỉ đọc |
| `apps/staff/lib/server/schedule-contract.mjs` | Tạo | Whitelist query/ngày, kiểm tra DTO và giao khoảng |
| `apps/staff/lib/server/schedule-http.mjs` | Tạo | Tái sử dụng phiên/JWT server, gọi Staff schedule cố định và xử lý lỗi |
| `packages/ui/src/components/staff/staff-schedule-remote-model.ts` | Tạo | Model lịch, ngày Việt Nam, grouping/range/query và định danh assignment |
| `packages/ui/src/components/staff/staff-schedule-remote.tsx` | Tạo | UI lịch Backend thật, controls và trạng thái |
| `apps/staff/test/schedule-contract.test.mjs` | Tạo | Ngày/query/DTO/overlap hợp lệ và không hợp lệ |
| `apps/staff/test/schedule-http.test.mjs` | Tạo | Wrapper, quyền/phiên, timeout/upstream sai và dữ liệu an toàn |
| `apps/staff/test/schedule-ui.test.mjs` | Tạo | Model lịch và ngày giờ |
| `apps/staff/test/schedule-http.integration.test.mjs` | Tạo | 22 ca HTTP opt-in, snapshot không PII, chỉ đọc |
| `apps/staff/test/schedule-browser.integration.mjs` | Tạo | Chrome QA riêng, lịch thật và gián đoạn |
| `apps/staff/docs/UC11_INTEGRATION.md` | Tạo | Contract/mapping, chạy/kiểm thử và giới hạn |
| `apps/staff/package.json` | Sửa | Lệnh test UC11, không thêm dependency |
| `packages/ui/src/components/staff/staff-auth-portal.tsx` | Sửa | Nối route lịch với component mới, giữ Auth/UC9/UC10 |

Hash **95 file nguồn** được bảo vệ của Backend ba service, core, Auth và UC9/UC10 BFF/UI cũ, login/layout/Portal chung, Customer auth đều giữ nguyên so với đầu lượt. Thay đổi Portal dành riêng Staff chỉ nối thêm route UC11; không sửa logic UC9/UC10. Không ghi file cấu hình Backend/local `.env`. Next.js có thể tự cập nhật `next-env.d.ts` khi dev/build; không chỉnh sửa thủ công file sinh ra.

Snapshot **mọi cột** trước/sau của `assignments` (44 dòng), `bookings` (24), `booking_items` (24), `booking_status_history` (22, gồm `note` chứa journal) khớp hoàn toàn; không phải checksum toàn bộ 32 bảng. Không seed/reset/ghi SQL, cập nhật trạng thái hoặc gọi UC12/Order internal. Customer/Admin chỉ typecheck và đối chiếu nguồn, chưa chạy lại toàn bộ browser nghiệp vụ. Không reset localStorage hoặc commit/push/merge/reset/checkout.

| Kiểm tra tuân thủ | Trạng thái | Bằng chứng / giới hạn |
| --- | --- | --- |
| Đúng phạm vi, bảo vệ code nhóm | PASS | 13 file UC11/Staff; 95 file được bảo vệ không đổi |
| Không hồi quy trong phạm vi đã chạy | PASS | Auth/UC9/UC10 unit 55/45/42; HTTP hồi quy 34; build Staff và ba typecheck |
| Contract và quyền lịch A/B | PASS | Schedule thật A23/B21, không chồng assignment, không nhận employeeId browser |
| UTC+07 và input ngày | PASS theo lớp đã chạy | BFF/model unit và 21 HTTP có dữ liệu hiện tại; fixture thật qua ranh UTC/VN/carry-in/midnight chưa có |
| Database/journal không đổi | PASS theo bốn bảng đối chiếu | Snapshot mọi cột khớp trước/sau, không ghi SQL |
| Token/phiên/secret | PASS theo ca đã chạy | Server-only JWT, cookie HttpOnly opaque, Origin/query/method whitelist, no-store và không log credential |
| Staff chỉ chạy bằng `.env` hiện có | NOT_READY | Thiếu public JWT config; hướng dẫn owner bổ sung, không sửa Backend |
| UC12, availability/chỉnh lịch, schema/Gateway | NOT_APPLICABLE | Ngoài phạm vi UC11 |
| Job thật qua biên UTC/VN, carry-in/midnight | NOT_VERIFIED | Thiếu fixture hiện có; không tạo dữ liệu mới hoặc tính unit thành HTTP PASS |
| HTTPS/nhiều host/JWT hết hạn thật/retry cùng tab sau phục hồi | NOT_VERIFIED | Cần kịch bản/môi trường riêng; recovery đã chạy là request mới |
| Review thủ công của đồng đội | NOT_VERIFIED | Chờ người dùng/owner kiểm tra, không tự coi báo cáo AI là nghiệm thu |

## Giới hạn và bước tiếp theo

- UC11 chỉ xem lịch. Không có thao tác availability/đăng ký ca/chỉnh lịch hoặc UC12.
- Không dùng kiểm thử ngày hợp lệ hoặc đơn vị timezone để tuyên bố đã có job MySQL thật qua ranh UTC/VN. Nếu fixture thiếu, ghi rõ và chờ owner chuẩn bị riêng.
- Khởi động Staff từ local `.env`, deployment HTTPS/nhiều host, JWT thật hết hạn và đồng bộ logout đa tab có giới hạn đã nêu ở các giai đoạn trước; cần kiểm chứng theo phạm vi cụ thể.
- Đề xuất UC12 tiếp theo: BFF mutation cố định với Origin/CSRF, trạng thái theo contract Staff, idempotency key ổn định, phân biệt 200/202/pending/retry và đối chiếu Order journal. Phải có QA riêng còn trạng thái phù hợp cùng quyền ghi rõ ràng, không dùng lại booking đã COMPLETED; chưa triển khai trong UC11.
