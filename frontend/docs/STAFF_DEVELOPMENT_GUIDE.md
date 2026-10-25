# CleanHome — hướng dẫn phát triển Staff

Điểm bắt đầu cho nhiệm vụ Staff; chỉ mở tài liệu chi tiết theo phần đang sửa. Hướng dẫn này không thay quy tắc nhóm hoặc API contract. Đọc [AGENTS](../../AGENTS.md) và `BACKEND_TEAM_RULES .md` (quy tắc nhóm hiện được owner cung cấp riêng; file local chưa được xuất bản trong PR tài liệu này) khi phạm vi yêu cầu. Không đọc toàn bộ handoff/QA mặc định, không quét service khác khi không có dependency.

Trước khi sửa Backend/database/contract/integration, phải có và đọc bản quy tắc nhóm do owner cung cấp; không dùng guide để thay thế hoặc bỏ qua quy định đó.

## Trạng thái và phạm vi

Theo nghiệm thu ngày 25/10/2026, PR [#2](https://github.com/nguyendinhtrung2005/Web_DichVuTaiNha/pull/2)–[#7](https://github.com/nguyendinhtrung2005/Web_DichVuTaiNha/pull/7) đã merge vào `integration/uc9-uc12`, HEAD `f38ea50709c3d2fc82c82715e703ce73c84324bb`. Đây là mốc đã kiểm chứng, không tự cập nhật theo remote và không chứng minh đã vào `main`.

Staff tại `localhost:3002`: `/dang-nhap`, `/cong-viec`, `/don/:assignmentId`, `/lich-lam-viec`. Auth và UC9–UC12 đã nối Backend; hồ sơ và các luồng legacy khác không tự trở thành API thật.

```text
Browser → Next.js BFF Staff → Auth :4001 / Staff :4005
                                      Staff → Order :4003 → MySQL
```

Database tích hợp thử nghiệm là `cleanhome_staff_test`. Staff sở hữu assignment/check-in/out; Order sở hữu booking/history/journal. Không mở rộng JOIN xuyên miền hoặc ghi bảng của service khác.

## API cần dùng

Browser gọi cùng origin; JWT do BFF gắn phía server. `assignmentId` là chuỗi BIGINT, không phải `bookingId`.

| Chức năng | BFF | Backend |
| --- | --- | --- |
| Đăng nhập | `POST /api/auth/login` | Auth `POST /api/v1/auth/login` |
| Kiểm tra phiên | `GET /api/auth/session` | Auth `GET /api/v1/auth/introspect` |
| Đăng xuất | `POST /api/auth/logout` | Thu hồi phiên BFF; chưa có API revoke JWT |
| UC9 | `GET /api/staff/jobs` | Staff `GET /api/v1/staff/me/jobs` |
| UC10 | `GET /api/staff/jobs/:assignmentId` | Staff `GET /api/v1/staff/me/jobs/:assignmentId` |
| UC11 | `GET /api/staff/schedule` | Staff `GET /api/v1/staff/me/schedule` |
| UC12 | `PATCH /api/staff/jobs/:assignmentId/status` | Staff `PATCH /api/v1/staff/me/jobs/:assignmentId/status` |
| Đối chiếu UC12 | `GET /api/staff/jobs/:assignmentId/status` | Đọc detail và journal BFF; không PATCH ngầm |

UC9 nhận `status,page,pageSize,sort`; mặc định trang 1, 20 mục, tối đa 100; `sort=asc/desc`. Không tự thêm tìm kiếm hoặc lọc `employeeId`. UC11 thêm `from,to=YYYY-MM-DD`, tối đa 366 ngày tính cả hai đầu; lọc công việc giao khoảng thời gian theo UTC+07 của contract hiện tại.

Auth công bố `GET /.well-known/jwks.json`. Bốn API Order chỉ dành cho Staff→Order: GET/PUT `/internal/v1/bookings/:bookingId/assignment-transitions/:operationId`, POST cùng đường dẫn thêm `/acknowledgement`, GET `/internal/v1/assignment-transitions/pending`. Không gọi `/internal/` từ browser hoặc bổ sung proxy tùy ý. Hai API context tùy chọn trong contract chưa phải chức năng Order đã triển khai.

## Phiên, quyền và UC12

- BFF nhận `{phone,password}`, gửi thêm `role: EMPLOYEE` tới Auth. Chấp nhận định danh kiểm thử `TEST-*`; không ép 10 chữ số, không trim mật khẩu. `users.id` dạng chuỗi là định danh JWT `sub/userId`; không thay bằng employee ID.
- JWT RS256 kiểm chữ ký/issuer/audience/hạn dùng và trạng thái ACTIVE. `expiresIn` lấy response thực tế; mặc định Auth hiện là 900 giây. Phiên BFF không dài hơn JWT.
- Cookie `cleanhome_staff_session` chứa ID opaque: HttpOnly, host-only, Path=/, SameSite=Lax, Secure khi HTTPS. JWT mã hóa ở kho phiên server; không localStorage/sessionStorage hoặc JSON cho browser. Logout thu hồi phiên Frontend, chưa thu hồi JWT Backend.
- Mutation kiểm Origin/Host chính xác. Staff resolve employee từ user đã xác thực; A/B chỉ truy cập assignment của mình, truy cập chéo trả 404. Booking chung vẫn có assignment riêng cho từng người.
- Bước ghi: `ASSIGNED → ACCEPTED → IN_PROGRESS → DONE`; API đọc ánh xạ ASSIGNED thành WAITING. Không bỏ bước hoặc đổi ngược. A DONE chưa làm booking COMPLETED khi B chưa xong.
- UC12 chỉ gửi `{status}` cùng `Idempotency-Key` dài 8–128 ký tự `[A-Za-z0-9._:-]`. Retry giữ nguyên key/payload; cùng key khác payload là xung đột. Không tự PATCH khi reload.
- `200 + SYNCHRONIZED` xác nhận thao tác; `202 + PENDING_ACKNOWLEDGEMENT` còn chờ ACK. Timeout là kết quả chưa xác định: giữ context/key, không tự báo thành công hoặc tạo thao tác mới. Xem [contract Staff–Order](../../backend/staff-service/docs/order-service-contract.md) khi sửa phần này.

## Cấu hình và chạy

Dùng cấu hình đã có; không copy đè `.env`, sinh lại khóa, chạy seed hoặc provisioning để khởi động. Node.js cần đáp ứng từng package; hướng dẫn Frontend hiện yêu cầu từ 22.9. Không mở process trùng cổng.

Mẫu **không chứa secret**, chỉ cho server BFF trong `frontend/apps/staff/.env.local`:

```dotenv
AUTH_SERVICE_URL=http://127.0.0.1:4001
STAFF_SERVICE_URL=http://127.0.0.1:4005
STAFF_APP_ORIGIN=http://localhost:3002
STAFF_SESSION_DIR=.auth-data/sessions
STAFF_SESSION_KEY_FILE=.auth-data/session.key
STAFF_STATUS_TIMEOUT_MS=20000
```

Không dùng `NEXT_PUBLIC_*` cho cấu hình server. Không đưa MySQL password, Auth private key hoặc Order token sang Frontend. Kho `.auth-data` của BFF chỉ ở server, không vào Git/browser bundle. Backend cần MySQL, issuer/audience, nguồn JWKS hoặc public key và xác thực nội bộ đã cấu hình bởi owner; xem README tương ứng, không đọc/in secret vào context. Chỉ lần cài mới cần làm theo quy trình khởi tạo khóa trong tài liệu Auth.

Tại repository, mỗi lệnh ở terminal riêng sau khi dependency/cấu hình sẵn sàng:

```powershell
npm.cmd --prefix backend/auth-service start
npm.cmd --prefix backend/order-service start
npm.cmd --prefix backend/order-service run staff:integration
npm.cmd --prefix frontend run dev:staff
```

Launcher `staff:integration` dùng cấu hình Order, chỉ nhận database `cleanhome_staff_test`, truyền credential phía server và tắt worker đối chiếu toàn database. Nếu chạy Staff trực tiếp, owner phải kiểm tra cấu hình worker trước; hướng dẫn này không bật worker.

## Kiểm tra theo phần sửa

Chọn test liên quan trước; các lệnh dưới là unit, không phải live E2E:

```powershell
npm.cmd --prefix backend/auth-service run test:unit
npm.cmd --prefix backend/staff-service run test:unit
npm.cmd --prefix backend/order-service run test:unit
npm.cmd --prefix frontend/apps/staff run test:jobs
```

Frontend còn `test:auth`, `test:job-detail`, `test:schedule`, `test:status`. Không dùng `npm test` mặc định của Staff Backend vì có autodiscovery integration. Khi cần kiểm tra giao diện:

```powershell
npm.cmd --prefix frontend run typecheck --workspace=@cleanhome/staff -- --incremental false
npm.cmd --prefix frontend run build:staff
```

Build và typecheck cùng ứng dụng chạy tuần tự; chỉ kiểm tra Customer/Admin khi ảnh hưởng dùng chung hoặc kiểm thử tích hợp. MySQL/live/recovery/concurrent hoặc E2E cần kiểm tra điều kiện dữ liệu trước; bộ có ghi cần fixture mới được duyệt. `test:status:http` là HTTP guard/chỉ đọc opt-in, không nghiệm thu ghi UC12. Không tự chạy các bộ này từ quick-start.

Sau merge đã chạy 557 unit PASS, ba typecheck và build Staff PASS. Bằng chứng trước đó riêng biệt: 43 E2E local PASS; 90 HTTP PASS + 1 SKIP UC11 thiếu fixture qua ranh ngày. Không cộng các lớp hoặc coi SKIP là PASS. Q01–Q06 và booking `9109131`/`9109141` đã hoàn thành, không reset/tái sử dụng.

## Chỉ đọc chi tiết khi cần

| Công việc | Nguồn |
| --- | --- |
| Auth/JWT | [Contract Auth](../../backend/auth-service/docs/auth-contract.md), [README Auth](../../backend/auth-service/README.md) |
| Staff/Order | [README Staff](../../backend/staff-service/README.md), [README Order](../../backend/order-service/README.md), [Order integration](../../backend/order-service/docs/staff-integration.md) |
| Phiên BFF | [Auth Frontend](../apps/staff/docs/AUTH_INTEGRATION.md) |
| UC9 / UC10 / UC11 | [Danh sách](../apps/staff/docs/UC9_INTEGRATION.md), [Chi tiết](../apps/staff/docs/UC10_INTEGRATION.md), [Lịch](../apps/staff/docs/UC11_INTEGRATION.md) |
| UC12 / bằng chứng | [Tích hợp](../apps/staff/docs/UC12_INTEGRATION.md), [QA](../apps/staff/docs/UC12_E2E_QA_REPORT.md) |

Các báo cáo giai đoạn giữ trạng thái đúng mốc lịch sử, không tự là trạng thái hiện tại. README gốc/Frontend còn mô tả demo cũ; không dùng thông tin đó để đăng nhập Staff Backend. Chưa kiểm chứng production, HTTPS thực, nhiều host/serverless, tải lớn hoặc crash/power-loss. Session/journal BFF còn filesystem một host; Auth chưa refresh/revoke đầy đủ; database test còn dùng chung schema. Giữ nguyên ownership, thay đổi chưa commit, API contract và bằng chứng QA; không tự commit/push/merge.
