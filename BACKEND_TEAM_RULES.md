# CleanHome — Quy tắc phát triển Backend thống nhất cho nhóm 5 người

> **Phiên bản:** 2.0 · **Ngày:** 23/10/2026 · **Trạng thái:** bản quy chuẩn đề xuất chờ nhóm phê duyệt  
> **Áp dụng cho:** tất cả thành viên và AI coding assistant (Codex, Claude Code, …) khi sửa Backend CleanHome.  
> **Nguyên tắc cốt lõi:** **Một hợp đồng API được duyệt; một chủ sở hữu dữ liệu cho mỗi miền nghiệp vụ; mọi thay đổi có phạm vi, người review và bằng chứng kiểm thử; bảo vệ code đã nghiệm thu của TẤT CẢ thành viên.**

## 0. Cách sử dụng tài liệu

1. Lưu tài liệu này ở **thư mục gốc** repository dưới tên `BACKEND_TEAM_RULES.md` và commit để mọi người cùng nhận được.
2. Trước mỗi nhiệm vụ Backend, AI **phải đọc** `AGENTS.md` ở gốc, **tài liệu này**, các `README`/contract liên quan và trạng thái Git. Nếu dùng Claude Code, hãy yêu cầu đọc tài liệu này trong prompt hoặc dẫn chiếu từ `CLAUDE.md`; nếu dùng Codex, dẫn chiếu từ `AGENTS.md` hiện có. **Không giả định AI tự động đọc file này** nếu chưa được chỉ dẫn.
3. Khi mâu thuẫn giữa mô tả cũ và code/contract đã được nhóm chấp thuận, **không tự quyết**: báo rõ điểm khác biệt, đề xuất cách giải quyết và xác nhận với chủ sở hữu service trước khi sửa.
4. Tài liệu này định nghĩa **quy trình và phân công đề xuất**; các REST endpoint chưa hiện diện trong code không được báo là đã triển khai.
5. **Phạm vi hiệu lực:** backend, cơ sở dữ liệu, contract liên service, API Gateway, cấu hình tích hợp và mọi thay đổi frontend khi nối API. Nếu AI nhận yêu cầu thuộc phần chưa được phân công, nó phải **chỉ phân tích/đề xuất**, không tự ý triển khai.
6. **Độ ưu tiên:** yêu cầu bảo mật và quy tắc hệ thống/công cụ > chỉ dẫn trực tiếp của chủ nhiệm nhiệm vụ (nếu hợp lệ) > `AGENTS.md`/`CLAUDE.md` áp dụng > file này > README và tài liệu nghiệp vụ. **Riêng các quyết định kiến trúc/contract đã được nhóm phê duyệt** là chuẩn dự án; gặp mâu thuẫn phải dừng phần xung đột và xin quyết định thay vì lặng lẽ chọn tài liệu thuận tiện.
7. **Không đồng nhất “AI đã báo xong” với “đã được nghiệm thu”**; mọi trạng thái triển khai phải có commit/PR/test và môi trường được chỉ rõ.

### Prompt mở đầu dùng chung (dán vào Codex/Claude Code)

```text
Bạn đang phát triển Backend CleanHome cùng nhóm 5 người.
Trước khi làm, đọc AGENTS.md, BACKEND_TEAM_RULES.md,
README của service liên quan và API contract hiện có.
Kiểm tra git status/nhánh hiện tại, xác định owner, phạm vi file,
các dependency liên service và kế hoạch kiểm thử.
Chỉ sửa phần được giao, không ghi đè code đã nghiệm thu của BẤT KỲ thành viên nào,
không sửa API contract hoặc schema chung khi chưa được đồng ý.
Nếu cần sửa file chung hoặc service do người khác sở hữu, ghi rõ impact
và dừng phần đó để xin owner phê duyệt.
Không tự commit, push, merge, đổi nhánh, chạy seed/migration ghi dữ liệu,
hoặc tiết lộ secrets. Báo rõ PASS/FAIL/SKIP và các giới hạn kiểm chứng.
Nhiệm vụ của tôi: <MÔ TẢ NHIỆM VỤ TẠI ĐÂY>.
```

## 1. Kiến trúc chuẩn của dự án

| Thành phần | Định hướng bắt buộc |
|---|---|
| Kiến trúc | Microservices; tích hợp bằng REST API theo hợp đồng được thống nhất |
| Backend | Giữ Node.js và các cấu hình/framework **thực tế** của từng service; không đổi stack tùy tiện |
| Dữ liệu | MySQL; môi trường test hiện dùng `cleanhome_staff_test` với 32 bảng |
| Frontend | Next.js/React/TypeScript, 3 website riêng: Customer `3001`, Staff `3002`, Admin `3003` |
| Auth | Auth Service được báo cáo đang dùng MySQL, đăng nhập bằng **số điện thoại**, JWT **RS256**, JWKS/introspection; cổng local `4001` |
| Staff | Staff Service local `4005`; UC9–UC11 đã được báo cáo kiểm thử HTTP với JWT thật; UC12 cần tích hợp Order |
| Order | Endpoint/cổng triển khai thực tế phải lấy từ config và tài liệu owner; **không đoán cổng** |
| API Gateway | Một điểm vào chung nếu cấu hình gateway đã triển khai; không tự bypass hay giả định gateway đã hoạt động |

- **Không tạo một microservice mới cho mỗi Use Case.** Một service phục vụ nhiều UC theo miền nghiệp vụ; một UC có thể dùng nhiều service.
- **REST contract** là ranh giới tích hợp. Các service không được truy cập lớp repository nội bộ của nhau hoặc sửa database do service khác sở hữu.
- Nếu hiện tại cùng dùng **một MySQL instance/schema cho môi trường test**, đó là phương án chuyển tiếp; vẫn tuân thủ **quyền sở hữu ghi dữ liệu theo bảng**. Không coi các thư mục `databases/*-db` là bằng chứng đã có database tách biệt.

## 2. Phân công và quyền sở hữu code (team 5 người)

> TV1–TV5 là **vai trò**, nhóm thay bằng tên người thực tế khi thống nhất. Một người có thể yêu cầu service của người khác cung cấp API nhưng **không tự ý sửa** source của service đó.

| Thành viên | Service owner chính | Đường dẫn được quyền chủ trì chỉnh sửa | Trách nhiệm |
|---|---|---|---|
| **TV1** | Auth / User / API Gateway | `backend/auth-service/`, `backend/user-service/`, `backend/api-gateway/` | Đăng nhập, JWT, tài khoản, phân quyền, cấu hình định tuyến |
| **TV2** | Service Catalog | `backend/service-service/` | Danh mục, dịch vụ, chi tiết, giá; sản phẩm nếu vẫn nằm trong phạm vi đồ án |
| **TV3** | Order | `backend/order-service/` | Booking, booking items, trạng thái đơn, hủy, lịch sử, contract nội bộ với Staff |
| **TV4** | Staff | `backend/staff-service/` | UC9–UC12, assignment, xem việc, lịch, tiến độ công việc |
| **TV5** | Payment / Review / Report | `backend/payment-service/`, `backend/review-service/`; module báo cáo khi được thống nhất | Thanh toán, đánh giá, thống kê tổng hợp |

**Ngoại lệ có kiểm soát:** Một service có thể có nhiều người đóng góp. Khi đó owner chia module/file cụ thể, ví dụ `jobs/` và `employees/`. **File bootstrap, config, middleware, migrations, package.json, lockfile và router gốc** là tài nguyên chia sẻ: chỉ owner hoặc người tích hợp được phê duyệt sửa. AI **không được di chuyển/refactor** code đang hoạt động để áp đặt cấu trúc thư mục giả định.

**Quyền `owner` không đồng nghĩa độc quyền tuyệt đối:** người khác có thể đề xuất thay đổi qua issue/PR; owner chịu trách nhiệm review kỹ thuật, không được cố tình chặn thay đổi cần thiết. Nếu owner vắng mặt, nhóm chỉ định reviewer thay thế và ghi lại quyết định trước khi merge.

**Ma trận trách nhiệm tối thiểu:** Người thực hiện nhiệm vụ (implementer) viết code/test trong phạm vi; owner service duyệt nghiệp vụ và tương thích; owner dữ liệu duyệt migration; owner API phía gọi và phía cung cấp cùng duyệt thay đổi contract; điều phối tích hợp (nhóm cử) xác nhận kết quả test hệ thống trước khi merge phát hành.

## 3. Quyền sở hữu dữ liệu — 32 bảng

| Owner | Các bảng logic được sở hữu |
|---|---|
| TV1 | `users`, `addresses` |
| TV2 | `service_categories`, `services`, `service_packages`, `package_items`, `product_categories`, `products`, `product_images`, `product_inventory` |
| TV3 | `bookings`, `booking_items`, `booking_status_history`, `subscriptions`, `entitlements`, `vouchers`, `voucher_services`, `voucher_redemptions` |
| TV4 | `branches`, `employees`, `employee_availability`, `skills`, `employee_skills`, `certificates`, `assignments` |
| TV5 | `payments`, `revenue_shares`, `reviews`, `conversations`, `conversation_members`, `messages`, `notifications` |

**Quy tắc dữ liệu:**

- Chỉ owner được thay đổi logic ghi của bảng thuộc miền mình; mọi truy cập từ service khác phải qua API/hợp đồng đã chấp thuận. Đọc xuyên bảng ở database test hiện có có thể xuất hiện trong code cũ; phải **ghi nhận nợ kiến trúc**, không mở rộng thành phụ thuộc mới.
- Mọi chỉnh sửa schema cần **migration phiên bản riêng**, lý do, ảnh hưởng, hướng nâng cấp/rollback, review owner bảng và owner service bị ảnh hưởng. Không sửa schema gốc hoặc `SET FOREIGN_KEY_CHECKS=0` để che lỗi dữ liệu.
- Không tự động chạy `DROP`, `TRUNCATE`, `DELETE`, seed, migration ghi dữ liệu, reset DB. Chỉ chạy ghi trên **database thử nghiệm được xác minh rõ tên** và sau khi có chấp thuận.
- File `databases/schema.sql` là nguồn schema tham khảo đã trích từ tài liệu 32 bảng; `schema_staff_test.sql` và các `seed_staff_test*.sql` chỉ phục vụ **kiểm thử**. Không xem DB test là môi trường production.
- ID từ service khác được tham chiếu qua ID/DTO và kiểm tra qua API. Khi tách database vật lý, không giữ khóa ngoại xuyên database/service như thể có thể JOIN trực tiếp.

## 4. Use Case → người thực hiện chính → phối hợp

> Mã UC bên dưới **theo cách đánh số tạm** đã trao đổi trước đây; **UC9–UC12 được giữ cố định** cho công việc Staff. Chức năng “Đặt dịch vụ” chưa được gán mã chính thức do phạm vi/đánh số cần nhóm xác nhận. Nếu tài liệu Use Case cuối cùng khác, cập nhật bảng này bằng PR thay vì tự đổi trong code.

| Nhóm | UC | Chức năng | Owner chính | Phối hợp |
|---|---|---|---|---|
| Customer | UC1 | Quản lý tài khoản | TV1 | — |
| Customer | UC2 | Xem/tìm kiếm dịch vụ | TV2 | — |
| Customer | Chưa chốt mã | Đặt dịch vụ (nếu còn trong phạm vi) | TV3 | TV1, TV2 |
| Customer | UC3 | Quản lý đơn | TV3 | — |
| Customer | UC4 | Hủy dịch vụ | TV3 | TV5 nếu liên quan hoàn tiền |
| Customer | UC5 | Thanh toán | TV5 | TV3 |
| Customer | UC6 | Đánh giá | TV5 | TV3, TV4 |
| Customer | UC7 | Lịch sử dịch vụ | TV3 | — |
| Staff | UC8 | Quản lý tài khoản nhân viên | TV1 | TV4 (hồ sơ nghiệp vụ) |
| Staff | **UC9** | Xem đơn được phân công | **TV4** | TV1, TV3 |
| Staff | **UC10** | Xem thông tin công việc | **TV4** | TV1, TV3 |
| Staff | **UC11** | Xem lịch làm việc | **TV4** | TV1 |
| Staff | **UC12** | Cập nhật trạng thái công việc | **TV4** | **TV3**, TV1 |
| Admin | UC13 | Quản lý tài khoản | TV1 | TV4 |
| Admin | UC14 | Quản lý dịch vụ | TV2 | — |
| Admin | UC15 | Quản lý đơn | TV3 | TV4 |
| Admin | UC16 | Phân công nhân viên | TV4 | TV3 |
| Admin | UC17 | Quản lý lịch nhân viên | TV4 | TV3 |
| Admin | UC18 | Quản lý thanh toán | TV5 | TV3 |
| Admin | UC19 | Quản lý đánh giá | TV5 | TV3, TV4 |
| Admin | UC20 | Thống kê/báo cáo | TV5 (tổng hợp) | TV1–TV4 cung cấp dữ liệu |

**Không nhân bản endpoint chỉ vì các UC dùng chung**: ví dụ API Auth login được nhiều vai trò sử dụng; API Order booking không thuộc quyền viết lại của TV4 dù UC12 cần cập nhật trạng thái đơn.

## 5. Quy chuẩn REST API và hợp đồng giữa service

### 5.1. Contract trước code

Đối với bất kỳ tính năng liên service nào, trước khi code phải có tài liệu contract được **hai owner duyệt**, tối thiểu gồm:

1. Endpoint + HTTP method + URL base và phiên bản (ưu tiên `/api/v1` cho public, `/internal/v1` cho service-to-service, **trừ khi hợp đồng hiện tại quy định khác**).
2. Auth của caller: JWT người dùng, token nội bộ, service identity, scope và quyền; **không dùng endpoint internal công khai**.
3. Request/response DTO với tên trường, kiểu, bắt buộc/nullable, mã trạng thái, timezone, enum.
4. Validation, mã lỗi, quyền truy cập, xử lý dữ liệu không tồn tại.
5. Idempotency, retry/timeout, xung đột đồng thời, trạng thái kết quả và cơ chế phục hồi.
6. Người sở hữu API, người tiêu thụ, test contract và cách nâng phiên bản.

**Không tự đổi tên endpoint hoặc enum.** Nếu cần đổi, sửa contract bằng PR trước, đồng thời cập nhật consumer và test; không thay đổi phá vỡ tương thích một phía.

### 5.2. Quy ước API tối thiểu

- JSON UTF-8; input được validate và chuẩn hóa; query DB parameterized; DTO tách khỏi entity DB.
- HTTP: `200/201/204` thành công; `400/422` dữ liệu không hợp lệ; `401` chưa xác thực; `403` không đủ quyền; `404` không có tài nguyên/quyền xem theo chính sách; `409` xung đột trạng thái; `500/503` lỗi dịch vụ. Giữ **error schema thống nhất với contract hiện có**, không tự phát minh format gây vỡ client.
- Trả về timestamp theo ISO 8601 kèm timezone hoặc UTC; nhất quán lưu UTC, hiển thị theo **Asia/Ho_Chi_Minh** ở Frontend. Không bỏ timezone hoặc tự cộng 7 giờ trong DB.
- Pagination, filter và sort phải được tài liệu hóa; có giới hạn `pageSize/limit` và whitelist sort field.
- Không log mật khẩu, hash, Authorization header, access token, private key hoặc thông tin cá nhân không cần thiết.
- Bảo vệ object-level authorization: không chỉ kiểm tra `role`, mà còn kiểm tra **nhân viên đang đăng nhập có sở hữu assignment** được truy cập hay không.

### 5.3. Auth contract hiện đã có báo cáo thực thi

- Auth (local): `POST /api/v1/auth/login`; public JWKS `GET /.well-known/jwks.json`; introspection `GET /api/v1/auth/introspect`.
- Đăng nhập Backend hiện bằng **phone**, trong khi một số giao diện Frontend demo từng dùng **email**: **đây là vấn đề tích hợp phải chốt**, AI không được tự thêm cột email hoặc đổi logic xác thực một phía.
- JWT RS256 phải xác thực chữ ký, `iss`, `aud`, thời hạn và claims/role đúng contract; Staff kiểm tra role **`EMPLOYEE`** theo mapping được chấp thuận. Không chèn bypass xác thực hoặc tạo token production giả.
- Biến môi trường cần nhất quán theo cấu hình thực tế, ví dụ `JWT_ISSUER`, `JWT_AUDIENCE`, `JWT_JWKS_URL`, `AUTH_INTROSPECTION_URL`; không để key thật trong Git.

### 5.4. Staff ↔ Order cho UC12 (đã có contract)

Nguồn chính: `backend/staff-service/docs/order-service-contract.md` và `order-handoff-checklist.md`.

| Method | Endpoint nội bộ mà Order phải cung cấp |
|---|---|
| `GET` | `/internal/v1/bookings/:bookingId/assignment-transitions/:operationId` |
| `PUT` | `/internal/v1/bookings/:bookingId/assignment-transitions/:operationId` |
| `POST` | `/internal/v1/bookings/:bookingId/assignment-transitions/:operationId/acknowledgement` |
| `GET` | `/internal/v1/assignment-transitions/pending` |

- TV4 sở hữu assignment/status/check-in/check-out; TV3 sở hữu booking/status history và hợp đồng Order.
- **Không đánh dấu booking `COMPLETED` khi mới một trong nhiều nhân viên hoàn thành** nếu quy tắc đơn yêu cầu tất cả hoàn thành.
- Operation ID ổn định, ghi nhận journal, retry, ACK và đối chiếu trạng thái; không xem HTTP timeout là chắc chắn thất bại hay thành công; không cho phép update trùng.
- Không thay đổi API để “test xanh” nếu làm sai nghiệp vụ; cần kiểm chứng UC12 bằng HTTP + MySQL trên dữ liệu có thể phục hồi khi Order thật sẵn sàng.

## 6. Quy tắc làm việc khi cùng sửa **một service**

1. Owner tạo **bản đồ file/module** và giao rõ vùng file (`jobs/`, `profiles/`…), cùng danh sách file dùng chung.
2. Mỗi người làm **nhánh riêng**, mỗi PR chỉ giải quyết một UC/nhóm thay đổi nhỏ. Hai AI không được cùng sửa trực tiếp working tree/branch hoặc cùng chỉnh file dùng chung mà không phối hợp.
3. Trước khi chạm `app.js`, router chính, middleware, `package.json`, lockfile, config, migrations: thông báo owner, thống nhất phương án ghép. Owner tích hợp route của cả hai bên, tránh “last write wins”.
4. Khi cần API của service khác, tạo issue/contract request, nêu payload + ví dụ + test yêu cầu; người sở hữu service thực hiện. **Không copy truy vấn DB hay module của service khác** vào service mình.
5. Khi phát hiện conflict Git: **không** dùng `git reset --hard`, force push, `git checkout --theirs/--ours` toàn bộ, xóa file đối phương để qua conflict. Giải quyết theo từng dòng, chạy lại test cả hai tính năng và review.

## 7. Quy trình bắt buộc khi AI bắt đầu một nhiệm vụ

**Trước khi sửa:**

- Đọc `AGENTS.md`, tài liệu này, README service, các test hiện có và contract liên quan.
- Xem `git status`, nhánh hiện tại, thay đổi đang có. Nếu đang có thay đổi chưa thuộc nhiệm vụ, giữ nguyên; không tự stash/reset/checkout.
- Báo **UC, service owner, thư mục/file dự kiến, API phụ thuộc, dữ liệu cần dùng, test sẽ chạy, tác động API/schema/security và phần code đã nghiệm thu có thể bị ảnh hưởng**.
- Nếu công việc đụng file thuộc owner khác hoặc thay đổi API/schema/security: **dừng phạm vi đó**, đề xuất PR/contract để chủ sở hữu duyệt.

**Trong khi sửa:**

- Thay đổi nhỏ nhất, giữ convention và stack có sẵn; không rewrite/refactor toàn bộ service không liên quan.
- Không cài dependency, thay Node/runtime, cấu hình port hoặc thêm DB khi không có lý do rõ ràng.
- Viết unit test, validation, authz và logging an toàn cho đường đi bị ảnh hưởng.
- Không sửa Frontend nếu đang làm nhiệm vụ Backend, trừ khi được giao rõ và có contract phê duyệt.

**Sau khi sửa:**

- Chạy test tối thiểu của service, schema check liên quan, và contract test nếu chạm liên service.
- Báo **PASS / FAIL / SKIP riêng**; mock/repository tests không được gọi là HTTP E2E; test bị skip **không** được tính là pass.
- Báo các file thay đổi, API có thực, migration có/không chạy, dependency còn thiếu, cách phục hồi và cách kiểm chứng.
- Không tự commit/push/merge/đổi nhánh. Chỉ tạo PR khi thành viên yêu cầu và đã kiểm tra secrets/changes.
- Nếu AI không thể chạy môi trường hoặc service phụ thuộc chưa sẵn sàng, phải nêu **lý do và bước xác minh còn thiếu**, không tuyên bố thành công thay cho test thật.

## 8. Tiêu chí nghiệm thu (Definition of Done)

Một UC/service **chỉ** được coi là hoàn thành theo cấp độ ghi rõ:

| Mức | Điều kiện |
|---|---|
| **Code ready** | Có code, validation, unit tests; chưa xác nhận DB/API thật |
| **Repository verified** | Test với MySQL thật/fixture thật, kiểm chứng đúng dữ liệu và quyền ở tầng repository/service |
| **HTTP verified** | Khởi động service và gọi HTTP thật với auth hợp lệ; kiểm tra 401/403, dữ liệu, pagination, timezone |
| **Integrated** | Service phụ thuộc thật chạy và contract test đạt; với tác vụ ghi phải xác nhận transaction/idempotency/journal |
| **Frontend connected** | Frontend gọi API thật với auth/session đúng, kiểm thử luồng người dùng; không còn phụ thuộc vào localStorage demo cho chức năng đã chuyển |

Tình trạng đã **được thành viên báo cáo** tại thời điểm viết: Staff UC9–UC11 HTTP verified; UC12 chưa Integrated vì Order dependency. Đây là thông tin tiến độ, **không thay cho kết quả CI/test mới**.

## 9. Quy trình Git/GitHub cho team

- Nhánh đề xuất: `feat/auth-user`, `feat/service-catalog`, `feat/order`, `feat/staff`, `feat/payment-review`; nếu 2 người cùng service, thêm nhánh theo module/UC: `feat/staff-jobs`, `feat/staff-profile`.
- Không code trực tiếp trên `main`. Mỗi PR ghi: mục tiêu UC, API contract thay đổi, danh sách file, migration, test PASS/FAIL/SKIP, yêu cầu tích hợp và người review.
- Người sở hữu service duyệt PR của mình; PR đổi contract giữa 2 service cần **hai owner cùng review**.
- Không merge khi test liên quan FAIL, khi lộ secret, hoặc khi một phía chưa cập nhật contract.
- Bảo vệ `.env`, `*.pem`, private keys, tokens, tệp tài khoản thử nghiệm, dump dữ liệu; cần kiểm tra `git status`, `.gitignore` và diff staged trước commit. Nếu secret từng lộ trong ảnh/chat/log, phải **thu hồi/đổi** và không chỉ xóa khỏi Git.
- Hợp nhất PR lần lượt qua nhánh tích hợp hoặc `main` theo quyết định của nhóm; chạy smoke test các service phụ thuộc sau merge.

## 10. Mẫu yêu cầu API liên service

```md
### API REQUEST — <MÃ UC / TÊN TÍNH NĂNG>
Requester: TV__ / <service gọi>
Owner: TV__ / <service cung cấp>
Mục đích nghiệp vụ: ...
Method / Endpoint: ...
Auth & quyền: ...
Request JSON (ví dụ): ...
Response JSON (ví dụ): ...
HTTP errors: ...
Idempotency / concurrency: ...
Timeout / retry: ...
Schema/enum liên quan: ...
Test chấp nhận: ...
Trạng thái contract: DRAFT | APPROVED | IMPLEMENTED | VERIFIED
```

## 11. Điều cấm tuyệt đối đối với AI

- Tự sửa hoặc ghi đè toàn bộ service/module của thành viên khác.
- Tạo endpoint/role/enum/bảng mới rồi mô tả là “đã có sẵn”.
- Tắt JWT, bỏ qua RBAC/ownership, hardcode mật khẩu hoặc service token.
- Tự chạy seed/migration ghi/xóa, tự sửa database production hoặc dùng `.env` của đồng đội.
- Tự đổi từ đăng nhập `phone` sang `email` mà chưa thống nhất schema/contract/frontend.
- Tự merge PR, force push, reset hard, dọn file untracked hoặc thay đổi nhánh.
- Báo “đã hoàn thành tích hợp” khi mới chạy test mock/repository hoặc test đang SKIP.

---

## 12. BẢO VỆ CODE ĐÃ HOÀN THÀNH — ÁP DỤNG CHO TOÀN BỘ 5 THÀNH VIÊN

> **Đây là quy tắc hai chiều:** code TV1, TV2, TV3, TV4, TV5 đều có cùng mức bảo vệ. Không một thành viên hay AI nào được coi code của mình “ưu tiên hơn” code của người khác.

### 12.1. Thế nào là code đã được bảo vệ?

- Mọi code đã được merge vào nhánh tích hợp chính và đã vượt qua kiểm thử liên quan; hoặc code trên nhánh tính năng đã có báo cáo kiểm thử, owner đánh dấu **READY_FOR_INTEGRATION** trong PR.
- Các file test, DTO, API contract, migration đã được phê duyệt cũng là một phần của hành vi được bảo vệ, không chỉ source production.
- Các logic chưa hoàn thành/đang TODO không được tự xóa; phải xử lý theo nhiệm vụ và phạm vi đã duyệt.

### 12.2. Quy tắc thay đổi an toàn

1. **Không tự xóa, viết lại, di chuyển hoặc đổi tên** module/API/schema đã được nghiệm thu chỉ vì AI thấy cách khác “đẹp hơn”.
2. Muốn sửa phần của thành viên khác: mở issue/PR mô tả **lý do → ảnh hưởng → thay đổi hợp đồng → migration nếu có → test hồi quy → phương án rollback**. Nhận review từ owner trước khi merge.
3. **Fix lỗi hoặc lỗ hổng bảo mật** vẫn được phép, nhưng phải giữ quy trình owner/reviewer; trường hợp khẩn cấp có thể áp dụng quyết định nhóm và review bù sau, ghi audit trail.
4. Không chỉnh sửa test cũ chỉ để “làm xanh CI”, không bỏ `assert`, skip test hoặc thay production bằng mock để hợp thức hóa kết quả.
5. Khi thay đổi hành vi dùng chung, phải chạy test **của cả service được sửa lẫn service tiêu thụ bị ảnh hưởng** (ít nhất smoke/contract test).
6. Không tự chấp nhận `git reset --hard`, force push, xóa file chưa commit, rebase trên working tree của người khác hoặc tự đổi branch. Không có phê duyệt thì **dừng tại bước đề xuất**.

### 12.3. Mẫu đăng ký thay đổi code đã nghiệm thu

```text
Change request: <mô tả 1 câu>
Owner ảnh hưởng: TV__ / <service>
UC/API/DB ảnh hưởng: ...
Tài liệu hợp đồng hiện tại: ...
Tương thích ngược? Có/Không; phương án: ...
File sẽ sửa: ...
Test hồi quy và kiểm thử consumer: ...
Phương án rollback: ...
Người duyệt: ... (chưa duyệt / đã duyệt)
```

## 13. TRẠNG THÁI HỢP ĐỒNG VÀ QUY TRÌNH PHỐI HỢP LIÊN SERVICE

**Nguồn sự thật:** một API contract phiên bản được commit trong repo, được **service provider và service consumer cùng duyệt**; file README không được âm thầm định nghĩa API trái với contract. Nếu chưa có OpenAPI, dùng Markdown có schema request/response rõ ràng. Với UC12, giữ `backend/staff-service/docs/order-service-contract.md` làm bản làm việc cho tới khi hai owner phê duyệt vị trí contract chung.

| Trạng thái | Ý nghĩa | Có thể báo API “chạy thật”? |
|---|---|---|
| `DRAFT` | Đề xuất, chưa thống nhất | Không |
| `APPROVED` | Provider + consumer duyệt hợp đồng | Không |
| `IMPLEMENTED` | Có code, chưa chứng minh HTTP thật | Không |
| `VERIFIED` | Test contract/HTTP thật có kết quả và môi trường rõ ràng | Có, trong phạm vi test |
| `DEPRECATED` | Có phương án chuyển đổi và thời hạn ngừng hỗ trợ | Chỉ nếu vẫn được hỗ trợ |

**Quy trình bắt buộc:** Người cần dữ liệu lập **API request** → owner cung cấp duyệt contract → hai bên triển khai độc lập → provider chạy test → consumer chạy contract test → người tích hợp chạy test liên service → cập nhật trạng thái bằng PR. Nếu thay đổi breaking: ưu tiên version mới hoặc cơ chế chuyển tiếp tương thích; **không xóa endpoint cũ trước khi consumer chuyển xong**.

**Khi dependency bị chậm:** bên gọi có thể viết adapter và mock trong **test**, đánh dấu rõ giả lập; không tạo route “trả OK giả” ở production hoặc phát hành kết quả `Integrated` khi dịch vụ kia chưa hoạt động.

**Giao dịch xuyên service:** không giả định transaction MySQL của Staff bao trùm được Order. Phải nêu owner thay đổi, trạng thái pending, idempotency key, retry/backoff, timeout, đối chiếu/journal và cách phục hồi nếu một phía thành công còn một phía thất bại. Trường hợp UC12 tham chiếu contract Order đã chốt, không tự sáng chế lại cơ chế.

## 14. QUY TRÌNH KHI HAI NGƯỜI CÙNG LÀM MỘT SERVICE

1. Owner lập **bảng phân vùng file** cho một sprint/task (ví dụ TV4-A: `jobs/*`, TV4-B: `profiles/*`; router/bootstrap: người tích hợp). Đường dẫn chỉ là minh họa; giữ cấu trúc thực tế.
2. Mỗi người tạo **nhánh/working tree riêng**, không cùng điều khiển một VS Code workspace/working tree đang được AI khác sửa. Nếu dùng chung máy, cần bản clone/worktree tách biệt do người quản lý Git thiết lập sau khi bảo toàn thay đổi chưa commit.
3. File dùng chung (`app.js`, router, package/lockfile, `.env.example`, middleware, cấu hình CI, migration, thư viện chung) phải có **người tích hợp chỉ định trước**. Những người khác đưa thay đổi dưới dạng PR nhỏ hoặc mô tả patch để owner ghép.
4. Trước khi sửa dữ liệu/migration chung, owner bảng và owner service liên quan cùng xác nhận thứ tự triển khai; thay đổi có ảnh hưởng trạng thái hoặc khóa ngoại phải có test hồi quy.
5. PR được merge **tuần tự**, người còn lại cập nhật nhánh theo quy trình nhóm, chạy test lại; không âm thầm overwrite các thay đổi vừa merge.
6. Nếu cùng chỉnh một đoạn code: dừng merge, đối chiếu ý định của cả hai, quyết định thiết kế chung, giữ cả hành vi hợp lệ và chạy test; không dùng chiến lược tự động “ours/theirs” cho toàn bộ service.

**Mẫu bảng chia file trước sprint:**

| Tác vụ | Người thực hiện | Service/Module | File được sửa | File chia sẻ cần duyệt | Reviewer | Test bắt buộc |
|---|---|---|---|---|---|---|
| `<UC / tính năng>` | `TV__` | `<service>/<module>` | `<file list>` | `<file list / none>` | `TV__` | `<test names>` |

## 15. QUY TẮC DATABASE, SEED, VÀ TRIỂN KHAI AN TOÀN

- **Không hiểu nhầm:** thư mục `databases/staff-db` trong repo không đồng nghĩa instance/schema `staff-db` đã được tạo. `cleanhome_staff_test` là database **tích hợp thử nghiệm**, không phải kiến trúc database-per-service đã hoàn thành.
- **Mỗi bảng một owner ghi**; nếu code hiện tại thực hiện JOIN/đọc xuyên miền trên schema tích hợp, ghi nhận giới hạn. Không phát triển thêm coupling mới nếu có thể dùng API/DTO; khi tách DB phải bỏ phụ thuộc khóa ngoại/cross-service JOIN vật lý.
- Schema thay đổi phải theo **migration có số phiên bản**, kiểm chứng trên DB thử nghiệm có bản sao lưu, và đi qua PR review; tránh sửa trực tiếp `schema.sql` đã dùng để khởi tạo môi trường mà không có migration tương ứng.
- Seed dữ liệu phải có điều kiện chống trùng, kiểm tra đúng database đích, không ghi vào production; không chạy tự động khi start service. Script thử nghiệm nhiều nhân viên chỉ dùng môi trường test với sự chấp thuận rõ ràng.
- **Trước mọi lệnh ghi**, AI phải xuất trước: `database host (không secret)`, `database name`, `danh sách bảng ảnh hưởng`, `SQL/migration`, `rủi ro`, `cách rollback/khôi phục`, rồi chờ phê duyệt. Lệnh SELECT kiểm tra chỉ đọc không cần phê duyệt ghi.
- Dữ liệu thật của người dùng không được sao chép vào fixture/test hoặc log. Dữ liệu mẫu phải được gắn nhãn và không dùng password marker làm tài khoản đăng nhập thật.
- Việc dùng MySQL 9.x ở máy phát triển phải được kiểm chứng với cú pháp schema và công cụ runtime; tài liệu thiết kế ghi MySQL 8.0+ **không tự chứng minh** toàn bộ môi trường giống nhau.

## 16. QUY TẮC BẢO MẬT, XÁC THỰC VÀ PHÂN QUYỀN

- Auth Service chịu trách nhiệm đăng nhập, mã hóa/băm mật khẩu, cấp token; các service tiêu thụ **tự kiểm tra quyền ở server** theo JWT và/hoặc introspection như contract. Không tin `userId`, `role`, `employeeId` do frontend tự gửi.
- Bắt buộc kiểm tra JWT `alg`, signature qua JWKS/public key, `iss`, `aud`, `exp` và trạng thái tài khoản theo yêu cầu. Không cho fallback “allow all” khi Auth tạm ngừng; lỗi phụ thuộc phải fail closed.
- Endpoint nội bộ cần chứng thực **service-to-service**, phân quyền caller và cấu hình chặn truy cập công khai; private tokens/keys phải nằm ngoài repo và được luân chuyển khi lộ.
- **RBAC + object-level authorization:** role đúng chưa đủ; chỉ cho nhân viên xem/cập nhật assignment do mình sở hữu. Không tiết lộ thông tin liên hệ khách hàng ngoài mục đích công việc hợp lệ.
- Đăng nhập Backend hiện bằng **phone**, frontend demo từng dùng **email**: thay đổi phải qua hợp đồng Auth–Frontend, migration được duyệt và test; AI không tự biến một bên thành bên kia.
- File `.env`, private key, access token, account provisioning chứa bí mật, SQL dump người dùng và backup cá nhân **không được commit**. Nếu bí mật đã từng hiện trong ảnh hoặc chat, yêu cầu đổi/thu hồi dù Git đã ignore.

## 17. CHECKLIST CHUẨN ĐỂ AI TỰ KIỂM TRA TRƯỚC KHI KẾT THÚC

> AI phải xuất checklist với giá trị **PASS / FAIL / NOT_APPLICABLE / NOT_VERIFIED** có lý do; không tự đánh dấu PASS dựa trên dự đoán.

| Mục kiểm tra | Điều kiện tối thiểu |
|---|---|
| Đúng phạm vi | Chỉ sửa UC, service và file đã thống nhất; không chạm code owner khác chưa duyệt |
| Không hồi quy | Test cũ liên quan vẫn đạt; không xóa test hoặc thay đổi hành vi ngoài ý muốn |
| API contract | Request/response/error/enum đúng bản APPROVED, có test phía cung cấp và phía gọi |
| Database | Không chạy ghi/xóa tự ý; thay đổi schema có migration và review |
| Security | Xác thực, role, ownership; secrets không hiện trong code/log/diff |
| Reliability | Timeout, retry/idempotency, xử lý lỗi phụ thuộc; không trả thành công giả |
| Evidence | Nêu rõ lệnh, môi trường, PASS/FAIL/SKIP; tách mock, repository, HTTP và E2E |
| Handoff | File thay đổi, quyết định, dependency, cấu hình cần bên khác và hướng kiểm chứng |
| Git | Chưa tự commit/push/merge/đổi nhánh; trạng thái file chưa liên quan được giữ nguyên |

**Mẫu báo cáo kết thúc bắt buộc:**

```text
UC / Service / Owner: ...
Branch / commit nền (nếu xác định được): ...
Files changed: ...
API Contract: DRAFT | APPROVED | IMPLEMENTED | VERIFIED
Migration/seed: chưa chạy | đã chạy (DB, xác nhận người duyệt)
Tests: Unit PASS/FAIL/SKIP; MySQL PASS/FAIL/SKIP; HTTP PASS/FAIL/SKIP; E2E PASS/FAIL/SKIP
Security/authz checks: ...
Tính tương thích với các service khác: ...
Nợ kỹ thuật / blocker: ...
Cần ai review: ...
Cách khởi động/kiểm chứng: ...
```

## 18. MẪU PULL REQUEST VÀ QUẢN LÝ QUYẾT ĐỊNH

### 18.1. Pull Request bắt buộc có

```md
## Mục tiêu và UC
- UC: ... | Service/module: ... | Owner: ...
## Thay đổi
- Code / API / Schema / Contract / Security: ...
- File dùng chung ảnh hưởng: ...
## Tương thích
- Provider / Consumer: ...
- API contract status: ...
- Migration và rollback (nếu có): ...
## Kết quả kiểm thử
- Unit: PASS ... / FAIL ... / SKIP ...
- MySQL: PASS ... / FAIL ... / SKIP ...
- HTTP thật: PASS ... / FAIL ... / SKIP ...
- E2E: PASS ... / FAIL ... / SKIP ...
## Kiểm tra an toàn
- [ ] Không chứa `.env` / token / private key / dữ liệu cá nhân
- [ ] Không tự ý xóa hoặc ghi đè code đã nghiệm thu
- [ ] Các owner liên quan đã review
## Blocker và cách chạy lại
...
```

### 18.2. Quyết định kiến trúc (ADR)

Các vấn đề liên quan từ **hai service trở lên** phải có bản quyết định ngắn trong thư mục tài liệu chung do nhóm chọn: bối cảnh, lựa chọn A/B, quyết định, owner phê duyệt, ngày, cách chuyển đổi và kế hoạch rollback. Ví dụ: `phone` hay `email` cho login; quyền ghi bảng `assignments`; DB-per-service; chuẩn error response; cách thống kê Admin; sửa API UC12. **Không coi một câu trả lời AI riêng lẻ là quyết định kiến trúc của cả nhóm.**

### 18.3. Đồng bộ rule trên mọi AI assistant

- `BACKEND_TEAM_RULES.md` là **nguồn nội dung quy tắc chung**; `AGENTS.md` (Codex) và `CLAUDE.md` (Claude Code, nếu dùng) chỉ **dẫn chiếu** đến file này để tránh hai bộ quy tắc độc lập lệch nhau.
- Không để AI tự cập nhật rule hoặc bảng phân công trong một nhiệm vụ code thường ngày. Mọi sửa đổi tài liệu này cần PR, ít nhất hai thành viên review, và thông báo cho cả nhóm trước khi áp dụng.
- Thành viên cần cập nhật nhánh trước khi bắt đầu nhiệm vụ mới; AI không tự chạy `git pull` nếu có working tree chưa được bảo toàn hoặc chưa có chỉ đạo rõ.

## 19. CÁC BƯỚC TRIỂN KHAI RULE CHO NHÓM (MỘT LẦN)

1. Cả 5 thành viên đọc và **xác nhận bảng owner và mã UC**; điền tên thực tế vào một issue/biên bản chung. Không suy đoán phân công thực tế từ TV1–TV5.
2. Đưa file vào root repository dưới tên `BACKEND_TEAM_RULES.md` và bổ sung đường dẫn đọc trong `AGENTS.md` / `CLAUDE.md` phù hợp. **Không ghi đè nội dung cũ của AGENTS.md.**
3. Tạo nơi lưu **API contracts APPROVED** và **ADR** chung, kèm người duyệt hai phía.
4. Bảo vệ `main`, yêu cầu PR review và kiểm thử ở GitHub theo khả năng nhóm; dùng nhánh tính năng riêng.
5. Ghi trạng thái hiện tại của từng service (scaffold, implemented, HTTP verified, integrated) theo **bằng chứng thực**, không dựa vào tên thư mục hoặc lời khẳng định trong báo cáo cũ.
6. Duy trì quy tắc trong suốt đồ án; kiểm tra tại buổi họp tích hợp định kỳ và cập nhật qua PR.

---

**Các quyết định còn chờ cả nhóm xác nhận bằng PR/biên bản:** người sở hữu thực tế TV1–TV5; mã UC chính thức (đặc biệt *Đặt dịch vụ*); phạm vi sản phẩm/tồn kho/hội thoại; thiết kế DB per service; chuẩn error DTO; chiến lược tổng hợp báo cáo Admin; nguồn duy nhất của các API contracts. Sau khi chốt, cập nhật tài liệu này bằng một Pull Request được cả nhóm review.
