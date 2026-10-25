# CleanHome — Giai đoạn 2B: chi tiết công việc Staff từ Backend

## Phạm vi và nguồn hợp đồng

Chỉ tích hợp **UC10 — xem chi tiết công việc** trong website Staff. Giữ phiên thật Giai đoạn 1 và danh sách UC9 đã kết nối trong 2A. Không tích hợp UC11/UC12, không cập nhật trạng thái, booking hoặc journal; không sửa Backend, schema, Gateway, Customer/Admin hoặc localStorage cũ.

Đã đọc `AGENTS.md`, `BACKEND_TEAM_RULES .md` (file thực tế có khoảng trắng), Staff app `AGENTS.md` và tài liệu Next.js đi kèm. Nguồn nghiệp vụ: [Auth Frontend](AUTH_INTEGRATION.md), [UC9 Frontend](UC9_INTEGRATION.md), [Staff README](../../../../backend/staff-service/README.md), Backend `src/app.js`, `src/validation.js`, `src/mapping.js`, `src/job-service.js`, `src/repository.js` cùng các test detail/ownership hiện có. Không coi số liệu tiến độ cũ trong README là kết quả kiểm thử của lượt này.

## API và bảo mật

```text
Browser Staff :3002/don/:assignmentId
  └─ GET /api/staff/jobs/:assignmentId
       └─ BFF: đọc và xác minh phiên server Giai đoạn 1
            └─ GET Staff :4005/api/v1/staff/me/jobs/:assignmentId
                 Authorization: Bearer <JWT phía server>
```

UC9 vẫn dùng `GET /api/staff/jobs`. Chi tiết được lấy bằng **assignmentId**, không phải booking ID hoặc employee ID. Backend tìm employee từ JWT user ID và giới hạn assignment theo chủ sở hữu; hai nhân viên trong cùng booking vẫn có assignment riêng.

- Browser chỉ gọi BFF cùng origin. JWT không trả cho JavaScript, không lưu localStorage/sessionStorage; cookie giữ ID phiên opaque HttpOnly.
- BFF chỉ gọi đường dẫn Staff cố định sau validation ID; không nhận URL tùy ý hoặc proxy `/internal/` của Order.
- ID là chuỗi số nguyên dương canonical, tối đa `9223372036854775807` theo BIGINT signed. Không nhận số 0, dấu âm, số có zero đầu hoặc path ghép vào ID.
- Chi tiết không cần query. BFF từ chối query thay đổi định danh như employeeId/userId và các query lạ; không gửi chúng tới Backend dù route detail Backend cũ có thể bỏ qua query.
- JSON dữ liệu/lỗi dùng `Cache-Control: no-store`. Lỗi không chứa assignment, contact, JWT hoặc chi tiết upstream nguyên văn.

| Trường hợp | Xử lý theo contract / thiết kế BFF |
| --- | --- |
| Không có phiên, phiên không tồn tại/hết hạn | 401; yêu cầu đăng nhập lại |
| Auth/Staff từ chối quyền nhân viên | 403; không fallback dữ liệu local |
| Assignment không tồn tại hoặc không thuộc nhân viên | Cùng 404 an toàn, không tiết lộ assignment có tồn tại cho người khác hay không |
| ID/query không hợp lệ | 400 trước khi gọi đọc chi tiết; path không khớp route có thể 404 |
| Origin không khớp | 403 trước khi dùng phiên; không thu hồi một phiên đúng chỉ vì request Origin sai |
| Staff gián đoạn/timeout | Lỗi phụ thuộc rõ ràng, có thử lại; không giả danh sách rỗng hoặc thành công |
| Response upstream sai cấu trúc | Lỗi dữ liệu; không hiển thị một phần dữ liệu chưa được xác minh |
| POST/PUT/PATCH/DELETE tới BFF detail | 405; không chuyển thành thao tác UC12 |

## Mapping Backend → Frontend

Backend detail trả `{data: job}`. Không ép thành `Order` local hoặc bù dữ liệu bằng store demo.

| Backend | Hiển thị / bảo toàn |
| --- | --- |
| `id`, `assignmentId` | Cùng chuỗi ID phân công; khóa công việc, route `/don/:assignmentId` |
| `orderId` | ID booking; hiển thị tách biệt với ID phân công |
| `jobCode`, `orderCode` | Hiện null; không tạo mã giả, dùng ID có nhãn |
| `status`, `databaseStatus`, `jobStatus` | Trạng thái assignment; `ASSIGNED` → API `WAITING` / `waiting`; ACCEPTED, IN_PROGRESS, DONE, CANCELLED giữ mapping hiện có |
| `orderStatus` | Trạng thái booking riêng; không dùng thay trạng thái assignment |
| `services[]` | Giữ toàn bộ dịch vụ snapshot, không chọn giả một dịch vụ đại diện |
| `serviceId`, `name`, `unit`, `quantity`, `unitPrice` | ID/DECIMAL giữ chuỗi; tên, đơn vị, khối lượng và đơn giá lấy từ booking item đã lưu, không tính lại giá booking hoặc thu nhập nhân viên |
| `scheduledAt`, `expectedEndAt`, `durationMinutes` | Lịch/thời lượng dự kiến; ISO UTC hiển thị bằng `Asia/Ho_Chi_Minh` |
| `assignedAt`, `checkInAt`, `checkOutAt` | Thời điểm thực tế hoặc null; không tạo check-in/check-out giả |
| `contact.name`, `address`, `phone` | Từ snapshot/Customer thực có; phone chỉ có ở detail thuộc quyền, không log vào báo cáo |
| `contact.houseType`, `area`, `rooms`, `floors`, `hasPets` | Backend hiện trả null vì schema chưa hỗ trợ; không dựng hồ sơ nhà giả |
| `specialRequest` | Hiện null; không tự thêm yêu cầu khách hàng |
| `cancellationPending` | Null khi chưa có dữ liệu; chỉ dùng boolean khi Backend thực sự cung cấp, không đổi null thành false |
| `orderHistory` | Null hoặc lịch sử được Backend cung cấp; không biến “chưa lấy được” thành “không có lịch sử” |
| `historySource` | Phân biệt `order-service-not-loaded`, `order-service`, `order-service-unavailable` |
| `unsupportedFields`, `warnings` | Giữ ý nghĩa dữ liệu chưa hỗ trợ/nguồn phụ thuộc; UI trình bày tiếng Việt phù hợp, không bịa dữ liệu để lấp chỗ trống |

Không có note Staff, email Customer, loại nhà hoặc diện tích mới trong schema. Nếu cần các trường đó, phải đề xuất migration/contract riêng với owner; không sửa schema gốc trong 2B. Order history là khả năng tùy chọn của Staff Service; Frontend không gọi nội bộ Order trực tiếp.

## Điều hướng và trạng thái UI

Luồng đã nối trong source: đăng nhập thật → `/cong-viec` → **Xem chi tiết** → `/don/:assignmentId?from=...` → quay lại danh sách. Link giữ trạng thái `status/page/pageSize/sort` bằng đường dẫn quay về `/cong-viec?...` đã mã hóa. Chỉ chấp nhận đường dẫn nội bộ danh sách và bốn query whitelist, không open redirect, không dùng `from` làm URL upstream. `from` là query của **trang UI**; request **BFF detail** không gửi query này. Không lưu assignment/phiên vào localStorage.

Trang detail có loading, thông báo 404, lỗi quyền/phụ thuộc và retry; không giữ dữ liệu nhân viên cũ khi logout/đổi người hoặc đổi ID. Chưa có thao tác UC12 trong giai đoạn này. Kết quả điều hướng, reload và responsive thực tế được ghi riêng trong browser QA bên dưới.

## Cấu hình và khởi động

BFF dùng cấu hình server Giai đoạn 1/2A, không cần biến public hoặc token nội bộ mới:

```dotenv
AUTH_SERVICE_URL=http://127.0.0.1:4001
STAFF_SERVICE_URL=http://127.0.0.1:4005
STAFF_API_TIMEOUT_MS=8000
STAFF_APP_ORIGIN=http://localhost:3002
```

Giữ nguyên khóa/kho phiên mã hóa và biến phiên đang dùng. Không copy đè `.env.local`, không đưa secret vào `NEXT_PUBLIC_*`. Tái sử dụng tiến trình có sẵn; nếu chưa chạy, mở terminal riêng từ gốc repository:

```powershell
Set-Location backend/auth-service
npm.cmd start
```

Staff Service chỉ chạy khi cấu hình JWT/MySQL thực hợp lệ. **Đã kiểm tra lại trong 2B:** `.env` Staff vẫn có issuer/audience trống và chưa cấu hình JWKS/public key, nên chỉ chạy `npm start` với file này chưa đủ để khởi động bình thường. Lượt kiểm thử dùng tiến trình QA còn chạy từ 2A, có JWKS/introspection thật qua môi trường tiến trình. Không sửa `.env` Backend của owner. Có thể cung cấp các giá trị công khai sau cho terminal Staff riêng:

```powershell
Set-Location backend/staff-service
$env:JWT_ISSUER = 'http://localhost:4001'
$env:JWT_AUDIENCE = 'cleanhome-staff-api'
$env:JWT_JWKS_URL = 'http://127.0.0.1:4001/.well-known/jwks.json'
$env:AUTH_INTROSPECTION_URL = 'http://127.0.0.1:4001/api/v1/auth/introspect'
$env:RECONCILIATION_WORKER_ENABLED = 'false'
npm.cmd start
```

Các giá trị phải khớp Auth đang chạy. Chọn đúng một trong `JWT_PUBLIC_KEY` và `JWT_JWKS_URL` theo cấu hình Backend; không thay private key hoặc bypass JWT. Giữ MySQL `cleanhome_staff_test` và credential local hiện có. Nếu owner muốn khởi động chỉ bằng `npm start` không cần biến môi trường bổ sung, owner cần điền các cấu hình công khai còn thiếu vào local `.env` theo tài liệu Auth/Staff. Không chỉnh file Backend trong lượt Frontend này.

```powershell
Set-Location frontend/apps/staff
npm.cmd run auth:init
npm.cmd run dev
```

`auth:init` giữ khóa đã tồn tại. Không chạy seed/provisioning/reset chỉ để bật UI. Mở `http://localhost:3002/dang-nhap`, dùng tài khoản EMPLOYEE thật được Auth owner cấp, rồi `/cong-viec` → **Xem chi tiết**. Ví dụ ID fixture A/B có trong tài liệu kiểm thử, nhưng phải đăng nhập đúng nhân viên và dùng dữ liệu thực tế hiện tại.

## Bộ kiểm thử HTTP thật

`test/job-detail-http.integration.test.mjs` dùng native Node.js, không thêm dependency, mặc định **NOT_RUN** trước khi gọi HTTP. Opt-in yêu cầu Auth, Staff, Next.js BFF và credential A/B thật, cùng CSV ID từ SELECT snapshot chỉ đọc. Test không tự truy cập MySQL, key/vault Auth, không tạo JWT và không gọi UC11/UC12.

| Biến tiến trình test | Ý nghĩa |
| --- | --- |
| `RUN_STAFF_UC10_HTTP_TESTS=true` | Cho phép chạy suite |
| `STAFF_BFF_TEST_BASE_URL` | Origin Staff loopback, mặc định `http://localhost:3002` |
| `STAFF_BFF_TEST_PHONE_A`, `STAFF_BFF_TEST_PASSWORD_A` | Employee A thật |
| `STAFF_BFF_TEST_PHONE_B`, `STAFF_BFF_TEST_PASSWORD_B` | Employee B thật, khác A |
| `STAFF_BFF_TEST_USER_ID_A/B` | Tùy chọn đối chiếu thêm Auth user ID |
| `STAFF_UC10_TEST_ASSIGNMENT_IDS_A/B` | CSV toàn bộ assignment của từng nhân viên từ SELECT snapshot đã xác minh; bắt buộc |
| `STAFF_UC10_TEST_MISSING_ID` | ID hợp lệ không tồn tại được xác nhận bằng SELECT; mặc định `9223372036854775807` |
| `STAFF_BFF_TEST_PHONE_CUSTOMER`, `STAFF_BFF_TEST_PASSWORD_CUSTOMER` | Tùy chọn kiểm thử Customer bị từ chối bởi Auth EMPLOYEE; thiếu thì ca này SKIP |

Owner Auth cung cấp credential vào môi trường tiến trình test qua kênh riêng/helper đã có; không ghi mật khẩu/token vào dòng lệnh, source, chat hoặc artifact. Sau khi cấp môi trường an toàn, từ `frontend/apps/staff`:

```powershell
$env:RUN_STAFF_UC10_HTTP_TESTS = 'true'
try { node --test --test-concurrency=1 test/job-detail-http.integration.test.mjs }
finally { Remove-Item Env:RUN_STAFF_UC10_HTTP_TESTS -ErrorAction SilentlyContinue }
```

Các lệnh package Staff hiện có:

```powershell
npm.cmd run test:auth
npm.cmd run test:jobs
npm.cmd run test:job-detail
# Bật RUN_STAFF_UC10_HTTP_TESTS và cấp credential/metadata an toàn trước:
npm.cmd run test:job-detail:http
$env:RUN_STAFF_UC10_BROWSER_TESTS = 'true'
try { npm.cmd run test:job-detail:browser }
finally { Remove-Item Env:RUN_STAFF_UC10_BROWSER_TESTS -ErrorAction SilentlyContinue }
npm.cmd run build
npm.cmd run typecheck -- --incremental false
```

Chạy build và typecheck Staff tuần tự để tránh xung đột file type do Next.js sinh lại. Không cần build toàn bộ ba ứng dụng.

Browser dùng cùng credential và CSV `STAFF_UC10_TEST_ASSIGNMENT_IDS_A/B`, profile Chrome QA riêng, mặc định `STAFF_UC10_BROWSER_SCENARIO=regular`. Biến tùy chọn ID không tồn tại của browser là `STAFF_UC10_TEST_MISSING_ASSIGNMENT_ID`; HTTP suite dùng `STAFF_UC10_TEST_MISSING_ID`. Cả hai mặc định ID BIGINT tối đa đã xác nhận không tồn tại. Scenario `outage` chỉ chạy với tiến trình Staff QA do người kiểm thử kiểm soát và có phương án khôi phục, không dừng service của người khác hoặc production. Các script không tự tìm/dừng một service bất kỳ.

Suite có **18 ca**, request timeout 15 giây, toàn suite 180 giây, body giới hạn 1 MiB. Các ca kiểm tra: thiếu/không tồn tại phiên, Authorization browser không thay phiên; login A/B thật; chọn assignment qua UC9 rồi detail đúng dữ liệu; 404 chéo hai chiều, kể cả hai assignment cùng booking; ID không tồn tại có cùng lỗi 404; ID sai/query định danh/URL bị chặn; method ghi 405; Origin 403 không làm mất phiên; request mới giống reload HTTP; logout A → login B không đọc được detail A. Ca Customer403 là tùy chọn, không được tính PASS khi SKIP. JSON được kiểm tra không lộ JWT/credential, lỗi không lộ assignment và có no-store.

HTTP request mới không thay thế kiểm thử reload UI/cache thật trong Chrome. Customer403 tại login BFF chứng minh Auth từ chối role EMPLOYEE, **không phải** đã ép được Staff Service trả 403 bằng cách khóa dữ liệu. Không sửa MySQL hoặc tạo token giả để dựng trường hợp đó.

## Kết quả kiểm thử của lượt 2B

Kết quả được phân lớp từ output thực tế. HTTP dùng Next.js `3002`, Auth `4001`, Staff QA `4005`, MySQL `cleanhome_staff_test` thật; credential A/B/Customer truyền qua môi trường tiến trình riêng, không đưa vào source hoặc báo cáo. Các dòng đang NOT_RUN chưa được tính PASS.

| Lớp kiểm tra | PASS | FAIL | SKIP / NOT_RUN | Phạm vi / giới hạn |
| --- | ---: | ---: | --- | --- |
| Cú pháp HTTP suite và gate opt-in mặc định | 1 lượt | 0 | Không áp dụng | `node --check` đạt; riêng lượt kiểm tra gate không gửi HTTP, tách biệt 18 ca tích hợp đã chạy |
| Unit UC10 BFF / model UI | 42 | 0 | 0 | 14 contract, 15 wrapper, 13 model/UI navigation; dependency doubles chỉ trong unit |
| HTTP Next BFF → Auth → Staff → MySQL | 18 | 0 | 0 | JWT thật, dữ liệu A/B và Customer login403; đối chiếu CSV từ SELECT |
| HTTP trực tiếp Staff với JWT Auth thật | 3 | 0 | 0 | Không JWT → 401; Customer JWT → 403; A xem assignment 9109008 → 200; helper Auth giữ token phía tiến trình Auth, không phải BFF/browser |
| Chrome UC10, luồng bình thường | 19 | 0 | 0 | Điều hướng UC9→UC10→UC9 giữ query, dữ liệu/404 A/B, reload, đổi người, bốn chiều rộng và an toàn browser |
| Chrome UC10, Staff QA ngừng thật | 4 | 0 | 0 | UI lỗi/retry, 503 khác 404, không lộ dữ liệu cũ và Auth vẫn hoạt động |
| HTTP Next.js sau khôi phục Staff QA | 1 | 0 | 0 | Login A mới → detail thuộc A 200 → logout; không coi là retry thành công trong cùng tab |
| Auth / UC9 unit hồi quy | 55 / 45 | 0 | 0 | Đã chạy lại trong 2B, không dùng số liệu cũ thay kết quả mới |
| Chrome UC9 hồi quy | 15 | 0 | 0 | Chạy lại sau thay đổi link detail; giữ danh sách, query và an toàn phiên |
| Typecheck Staff / Customer / Admin | 3 lượt | 0 | 0 | Chạy tuần tự sau build bằng `--incremental false` |
| Production build Staff | 1 lượt | 0 | 0 | Có dynamic route `/api/staff/jobs/[assignmentId]`; không đồng nghĩa đã deploy production |
| 403 do hồ sơ nhân viên thật bị khóa | — | — | NOT_RUN | Không thay đổi tài khoản/employee để ép trường hợp này |
| JWT Auth thật hết 900 giây / deployment HTTPS | — | — | NOT_RUN | Không suy từ TTL BFF ngắn hoặc unit |

SELECT snapshot chỉ đọc đầu lượt xác nhận A có **23 assignment**, B có **21**; ID `9223372036854775807` không tồn tại. HTTP UC10 đã đối chiếu các assignment được chọn từ UC9 đúng metadata của từng người: A/B xem detail của mình 200, truy cập chéo hai chiều 404, kể cả hai assignment `9109133`/`9109134` cùng booking. Đổi ID trên URL không vượt quyền; không tồn tại và không thuộc quyền dùng cùng lỗi 404 không chứa dữ liệu. Phiên hợp lệ tiếp tục hoạt động sau 404/Origin sai. Logout A làm SID cũ mất hiệu lực; login B vẫn không đọc được detail A.

Chrome đã kiểm chứng UC9 → UC10 → UC9 trả đúng bộ lọc, sort, page 2 và pageSize 2; reload detail vẫn đúng assignment. A/B chỉ xem công việc thuộc mình, mở URL chéo hoặc ID không tồn tại hiển thị 404, ID sai không lộ dữ liệu. Logout và đổi tài khoản không chớp lại detail người trước. Cookie tiếp tục HttpOnly opaque, browser không nhận JWT hoặc gọi Backend trực tiếp, canary localStorage/sessionStorage cũ không đổi.

UC10 kiểm tra responsive tại **375, 390, 768, 1440px**, không phát hiện tràn ngang hoặc control vượt viewport; đã xem screenshot mobile/desktop. Tiêu chí vùng bấm 44px áp cho control UC10; Header cũ vẫn ngoài phạm vi thay đổi và không được tuyên bố mọi nút Header đã đạt tiêu chí này. Hai profile UC10 normal/outage đã đóng, không ghi nhận exception JavaScript hoặc credential leak. UC9 browser hồi quy chạy lại đạt 15 ca với assertion link mới kiểm tra cả pathname và query quay về an toàn.

Ca gián đoạn tạm dừng đúng tiến trình Staff QA đang được lượt kiểm thử kiểm soát, không dừng Auth/Frontend hoặc service của người khác. BFF detail trả 503; UI có trạng thái lỗi/thử lại, không nhầm thành 404 và không giữ nội dung assignment cũ. Sau đó Staff được khôi phục với cùng cấu hình JWT công khai/worker tắt; một lượt HTTP Next.js mới đăng nhập A, đọc own detail 200 rồi logout đã đạt. **Chưa kiểm chứng click retry trở lại thành công trong cùng tab sau khi Staff phục hồi**; không gán kết quả request phục hồi mới cho kịch bản đó.

Booking/assignment/profile giữ trạng thái từ 2A; nhiều QA đã hoàn thành nên không thử lại trạng thái khởi đầu. Journal nằm trong `booking_status_history.note`, không giả định có bảng journal riêng. Không dùng số liệu UC9 cũ để báo UC10 đã tích hợp.

Artifact dưới `apps/staff/.auth-data/qa/uc10/` đã được Git ignore, không chứa mật khẩu, JWT hoặc cookie phiên:

| Artifact | Bằng chứng |
| --- | --- |
| `http.tap` | 18 PASS qua Next.js BFF → Auth/Staff/MySQL thật |
| `staff-authz.json` | 3 PASS trực tiếp Staff với JWT Auth thật: 401/403/200 |
| `browser/report.json` | 19 PASS, 0 FAIL, 0 SKIP; profile closed |
| `browser/uc10-375.png`, `browser/uc10-1440.png` | Ảnh responsive đã xem |
| `browser-outage/report.json` | 4 PASS với Staff QA ngừng thật; profile closed |
| `recovery.json` | New login/read/logout thành công sau khi Staff phục hồi |
| `preservation-report.json` | 77 file nguồn được bảo vệ không đổi |
| `mysql-preservation.json` | Snapshot mọi cột bốn bảng trước/sau không đổi |

## File và bảo toàn

Các đường dẫn tính từ `frontend/`: **16 file tạo/sửa thủ công**, gồm 11 file mới và 5 file cập nhật.

| File | Tạo / sửa | Nội dung |
| --- | --- | --- |
| `apps/staff/app/api/staff/jobs/[assignmentId]/route.ts` | Tạo | Route GET detail chuyển Request cho BFF kiểm tra URL và ID |
| `apps/staff/lib/server/job-detail-contract.mjs` | Tạo | Validation BIGINT/query và DTO detail, whitelist dữ liệu |
| `apps/staff/lib/server/job-detail-http.mjs` | Tạo | Dùng phiên/JWT server đã có, gọi Staff detail và xử lý lỗi |
| `packages/ui/src/components/staff/staff-job-detail-remote-model.ts` | Tạo | DTO detail, nullable fields/history, định dạng snapshot và đường dẫn quay về an toàn |
| `packages/ui/src/components/staff/staff-job-detail-remote.tsx` | Tạo | Chi tiết thật, trạng thái loading/404/error/retry, chống dữ liệu cũ khi đổi ID/phiên |
| `apps/staff/test/job-detail-contract.test.mjs` | Tạo | ID/query/DTO/history sai hoặc dư trường |
| `apps/staff/test/job-detail-http.test.mjs` | Tạo | HTTP wrapper, quyền/phiên, lỗi upstream và whitelist |
| `apps/staff/test/job-detail-ui.test.mjs` | Tạo | Model, đường dẫn quay về, giá DECIMAL và định dạng |
| `apps/staff/test/job-detail-http.integration.test.mjs` | Tạo | 18 ca HTTP UC10 opt-in, chỉ đọc |
| `apps/staff/test/job-detail-browser.integration.mjs` | Tạo | Chrome profile QA tách biệt cho UC10 và gián đoạn |
| `apps/staff/docs/UC10_INTEGRATION.md` | Tạo | Contract/mapping, chạy/kiểm thử và giới hạn |
| `apps/staff/package.json` | Sửa | Lệnh test UC10, không thêm dependency |
| `packages/ui/src/components/staff/staff-auth-portal.tsx` | Sửa | Nối `/don/:assignmentId` với detail mới |
| `packages/ui/src/components/staff/staff-jobs-remote-model.ts` | Sửa | Helper query/URL danh sách và detail, giữ filter/sort/page/pageSize |
| `packages/ui/src/components/staff/staff-jobs-remote.tsx` | Sửa | Link detail dùng assignment ID và đường dẫn quay về, khôi phục query danh sách |
| `apps/staff/test/jobs-browser.integration.mjs` | Sửa | Assertion hồi quy link UC9 chấp nhận đường dẫn detail và bốn query quay về an toàn |

Đối chiếu hash **77 file nguồn** Backend ba service, core, Auth core, toàn bộ UC9 BFF, Staff cũ, login/layout/Portal và Customer auth: không đổi so với đầu lượt. Không sửa Auth/Staff/Order Backend, `.env` Backend hoặc file cấu hình local. Các biến JWT công khai chỉ đặt trong tiến trình Staff QA. Next.js có thể tự cập nhật `next-env.d.ts` khi dev/build; không chỉnh sửa thủ công file sinh ra.

Snapshot **mọi cột** trước/sau của `assignments` (44 dòng), `bookings` (24), `booking_items` (24), `booking_status_history` (22, gồm `note` chứa journal) khớp hoàn toàn. Không phải checksum toàn bộ 32 bảng. Không seed/reset/ghi SQL, sửa trạng thái hoặc chạy UC12. Customer/Admin chỉ typecheck và đối chiếu nguồn trong 2B; chưa chạy lại toàn bộ browser nghiệp vụ hai ứng dụng đó. Không xóa dữ liệu demo hoặc commit/push/merge/reset/checkout.

| Kiểm tra tuân thủ | Trạng thái | Bằng chứng / giới hạn |
| --- | --- | --- |
| Đúng phạm vi, bảo vệ code nhóm | PASS | 16 file Frontend Staff; hash 77 file được bảo vệ không đổi |
| Không hồi quy theo phạm vi đã chạy | PASS | Auth 55 unit, UC9 45 unit + 15 Chrome, ba typecheck và build Staff |
| Contract và object-level authorization | PASS | UC10 18 HTTP thật; A/B own200/cross404, kể cả booking chung; không dựa vào employeeId browser |
| Trạng thái HTTP theo lớp xác thực | PASS theo ca đã chạy | Next BFF thiếu phiên401, Origin403, own/cross200/404; Staff trực tiếp với JWT thật401/403/200; 403 employee bị khóa chưa dựng |
| Database và journal không đổi | PASS theo bốn bảng đối chiếu | Snapshot mọi cột trước/sau giữ nguyên; không ghi SQL |
| Token/phiên/secret | PASS theo ca đã chạy | JWT phía server, cookie opaque HttpOnly, no-store, Origin/ID/query whitelist, không log PII/credential |
| Khởi động Staff chỉ bằng `.env` hiện có | NOT_READY | Thiếu JWT issuer/audience/key source; owner cần bổ sung public config, không coi tiến trình QA đã chạy là bằng chứng `.env` đã đủ |
| UC11/UC12, migration hoặc Gateway | NOT_APPLICABLE | Ngoài phạm vi 2B |
| JWT Auth hết hạn thật / HTTPS / nhiều host | NOT_VERIFIED | Chưa chờ JWT 900 giây hoặc kiểm thử deployment riêng |
| Logout đa tab / vị trí cuộn-focus khi trở về | NOT_VERIFIED | Chưa có cơ chế broadcast/khôi phục riêng; không suy từ reload và giữ query |
| Review thủ công của đồng đội | NOT_VERIFIED | Chờ người dùng/owner kiểm tra, không tự coi báo cáo AI là nghiệm thu |

## Giới hạn và bước tiếp theo

- Chưa tích hợp UC11/UC12. Trang detail không tự cập nhật trạng thái hoặc gọi Order internal.
- Giữ null và provenance lịch sử đúng nguồn. Không hứa có thông tin nhà, yêu cầu đặc biệt hoặc lịch sử chưa được Backend cung cấp.
- Môi trường thật hiện có `historySource=order-service-not-loaded`; các trường hợp Order history đã tải/lỗi chỉ kiểm tra trong unit với dependency doubles, chưa được báo là tích hợp lịch sử Order thật trong 2B.
- Giới hạn filesystem session một host, HTTPS/reverse proxy và thiếu refresh token vẫn như [Giai đoạn 1](AUTH_INTEGRATION.md).
- Giữ query khi quay về đã được Chrome kiểm chứng; broadcast logout giữa nhiều tab và khôi phục riêng vị trí cuộn/focus chưa có cơ chế hoặc kiểm thử riêng. Retry khi Staff ngừng đã được kiểm tra, nhưng retry thành công trong cùng tab sau phục hồi chưa kiểm chứng.
- Giai đoạn tiếp theo đề xuất UC11: BFF lịch cố định, đối chiếu `from/to` ngày địa phương Việt Nam, giới hạn 366 ngày, pagination và giao khoảng qua nửa đêm; tiếp tục kiểm thử A/B và không dùng `employee_availability` thay lịch công việc. Chưa triển khai trong 2B.
