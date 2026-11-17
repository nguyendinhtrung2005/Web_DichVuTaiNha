# Customer — kiểm chứng theo tài liệu Use Case

Ngày: **07/11/2026**. Đã đọc toàn bộ `D:\DACN\mo_ta_uc_khach_hang.docx`, mục 2.1.2.1–2.1.2.8. Dùng số mục tài liệu, không tự đổi mã UC tạm của nhóm.

Owner frontend/backend: **Thưởng / Customer**. Giữ nhánh `feat/mysql-database-integration`, commit nền `0f9d96b`. Working tree có nhiều thay đổi trước nhiệm vụ; giữ nguyên, chỉ bổ sung patch Customer. Không stage/commit/push/merge/reset/đổi nhánh. Không thay nghiệp vụ Admin/Staff.

## A. Bảng đối chiếu Use Case

| Use Case | Yêu cầu | Frontend | Backend | Kiểm thử | Trạng thái |
|---|---|---|---|---|---|
| 2.1.2.1 Quản lý tài khoản | Đăng ký/login/logout/hồ sơ, chặn tài khoản inactive | Giữ các trang API hiện có, SĐT/email đã duyệt | Auth/User băm mật khẩu, CUSTOMER do server gán, hồ sơ đúng chủ | HTTP/MySQL: duplicate/input/role/credentials sai, inactive và phiên cũ; browser auth/profile/reload | PASS chức năng local; thông báo khóa khác văn bản như ghi dưới |
| 2.1.2.2 Xem/tìm dịch vụ | Public, active, tìm từ khóa, chi tiết/giá/đơn vị/thời lượng | Đã đổi tìm/lọc sang API Catalog; loading/error/retry riêng | Tái sử dụng q/group/cleaningType/page/limit và chi tiết | HTTP/MySQL tìm/chi tiết; browser query thật, lỗi search/retry, ba nhóm | PASS Role E2E local |
| 2.1.2.3 Đặt dịch vụ | Form liên hệ/nhà ở/lịch/ghi chú, xem lại, xác nhận và lưu nguyên vẹn | Giữ bốn bước; đồng bộ phone/area, giờ Việt Nam | Bổ sung required house details, giá/thời lượng server, transaction/key chống trùng | HTTP/MySQL thiếu trường/price/items/history; mock rollback lỗi item; browser đặt/retry cùng key | PASS Role E2E local; fault injection rollback là mock |
| 2.1.2.4 Quản lý đơn | Danh sách/chi tiết/trạng thái, số lượng/đơn giá, đúng chủ | Danh sách phân trang API; thêm giá snapshot cả đơn một dịch vụ | Ownership principal, snapshot/lịch sử DB | HTTP/MySQL 401/404/khác chủ; browser danh sách/chi tiết | PASS Role E2E local |
| 2.1.2.5 Hủy dịch vụ | Văn bản gốc muốn chuyển CANCELLED | Chủ nhiệm xác nhận giữ yêu cầu chờ duyệt; UI không nói đã hủy | Giữ cancellation-requests, kiểm tra trạng thái/assignment, pending history | HTTP/MySQL concurrent/ownership/đang làm; browser đơn vẫn pending | PASS theo quyết định mới; không phải hủy ngay trong Word |
| 2.1.2.6 Thanh toán | Chọn phương thức, lưu kết quả | Chủ nhiệm chấp nhận mô phỏng, UI nói rõ chưa nhận tiền | cash/transfer → UNPAID/PENDING, không PAID giả | HTTP/MySQL idempotency/ownership/bảo vệ payment có sẵn; browser transfer pending | PASS mô phỏng; payment thật SKIP |
| 2.1.2.7 Đánh giá | Đơn hoàn thành, chọn sao/nhận xét, lỗi giữ input, điểm chung | Bỏ mặc định 5 sao; giữ input POST lỗi; thêm điểm chung ở trang dịch vụ | Giữ ghi review; thêm summary count/average qua REST Order | HTTP/MySQL review thật/duplicate/ownership/summary503; unit tổng hợp; browser thiếu sao/lỗi POST/gửi lại/điểm chung | PASS Role E2E local; chưa có chính sách từ ngữ cấm |
| 2.1.2.8 Lịch sử | Tìm DB/lọc thời gian/loại dịch vụ, rỗng rõ | Gửi query và pagination tới API; chọn dịch vụ từ snapshot | GET orders mới đã duyệt: UTC date bounds/EXISTS/LIKE params/sort whitelist | HTTP/MySQL ranh giới ngày/pagination/inactive snapshot/SQL-shaped text/isolation; browser query serviceId/from/to/status | PASS Role E2E local |

## B. Phân tích actor, luồng và dữ liệu

### 2.1.2.1 — Quản lý tài khoản

Actor: khách chưa có phiên cho đăng ký/login; Customer có phiên cho hồ sơ/logout. Input name/phone/password, email tùy chọn; login bằng identifier SĐT/email. Tiền điều kiện: truy cập web hoặc tài khoản hợp lệ; hậu điều kiện: users/phiên được tạo, cập nhật hoặc kết thúc. Main flow dùng Auth/User API và MySQL, không browser demo. Validate tên 2–100, SĐT Việt Nam chuẩn hóa, mật khẩu đăng ký 8–128, email chuẩn hóa/unique. Output User/cookie không có hash/token công khai. Invalid 400, trùng 409, credentials sai/inactive 401; lỗi DB không báo thành công.

Điểm khác văn bản: Auth đang dùng cùng thông báo cho sai credentials và inactive. HTTP đã chứng minh tài khoản inactive bị từ chối và phiên cũ mất hiệu lực. Chưa đổi chính sách thông báo để tiết lộ trạng thái khóa; cần owner Auth/security chốt nếu yêu cầu đúng câu thông báo Word. Hồ sơ giữ name/phone/email; avatar/địa chỉ mặc định chưa hỗ trợ theo contract/schema hiện có.

### 2.1.2.2 — Xem/tìm dịch vụ

Actor public, không cần đăng nhập. Input q/group/cleaningType, sort giá trên kết quả API; output Service DTO. Catalog đọc services/service_categories active. Tìm khi nhập hoặc bấm nút; phản hồi cũ không thay kết quả tiêu chí mới. Error khác empty; backend lỗi không fallback cache/mock thành công. Metadata giá cố định/tham khảo/khảo sát và phạm vi công việc giữ nguyên, thiếu thông tin nói rõ. Từ chi tiết đi tiếp đặt lịch.

### 2.1.2.3 — Đặt dịch vụ

Actor Customer đã xác thực, service active. Input requestKey/serviceId/quantity/contact/scheduledAt/specialRequest; contact gồm liên hệ/địa chỉ/nhà/thú cưng. Quantity 0.01–100000, tối đa hai chữ số thập phân và đạt minimum Catalog. Area 0.01–1000000, rooms/floors nguyên 1–1000; vệ sinh phòng trọ/nhà gia đình bắt buộc đủ ba trường ở server lẫn UI, chăm sóc/bảo dưỡng cho bỏ thông tin không phù hợp. UI xem lại/sửa trước gửi, lịch theo Asia/Ho_Chi_Minh; server lưu UTC, lịch mới phải trong tương lai.

Order xác minh Catalog/Staff branch qua REST, không tin giá/customer ID/role từ browser. Một transaction ghi bookings/booking_items/booking_status_history ở PENDING. Lỗi item rollback toàn bộ; đúng UUID/payload gửi lại lấy đơn cũ, đổi payload 409. Hậu điều kiện: mở đơn đã lưu thật. Không thêm sản phẩm vào booking hoặc tự thêm hàng gợi ý.

### 2.1.2.4 — Quản lý đơn

Actor Customer có phiên, input query/page hoặc ID; output Order page/detail có items/contact/schedule/history/status. Luôn giới hạn theo principal; không có/khác chủ trả 404. Chi tiết hiển thị đơn giá, số lượng và thành tiền từng item từ snapshot, không lấy giá Catalog mới thay giá đã đặt. Trạng thái pending/confirmed/in_progress/completed/cancelled từ DB; lỗi tải không biểu diễn thành chưa có đơn. Có đường quay lại danh sách.

### 2.1.2.5 — Hủy dịch vụ

Chủ nhiệm xác nhận ngày 07/11/2026 giữ main flow: chủ đơn nhập lý do → xác nhận → POST cancellation-requests → ghi pending history → UI “chờ duyệt”, booking giữ trạng thái. Backend kiểm tra ownership/trạng thái/assignment và kiểm tra lại điều kiện khi ghi trong transaction, ngăn yêu cầu trùng. Công việc đã bắt đầu hoặc Staff không sẵn sàng không thể báo hủy thành công. Quay lại modal không POST. Admin duyệt/chuyển CANCELLED, cutoff và hoàn tiền ngoài phạm vi.

### 2.1.2.6 — Thanh toán

Actor chủ đơn chưa hủy, input cash/transfer; output payment unpaid/pending đã lưu. Chủ nhiệm chấp nhận mô phỏng. Không provider/callback/số dư/PAID giả. Gửi lại idempotent; bảo vệ payment PAID hoặc provider độc lập. POST lỗi giữ form; POST đã ACK nhưng reload lỗi trả warning đã lưu, yêu cầu tải lại, không tự gửi ghi lần nữa.

### 2.1.2.7 — Đánh giá

Actor chủ đơn completed có assignment thực. Input rating nguyên 1–5/comment tối đa 2000; UI yêu cầu tự chọn sao/nhận xét, không mặc định 5. Backend lấy customer/service/employee từ Order và khóa theo booking chống lặp. POST lỗi giữ sao/nhận xét; thành công hiển thị review đã lưu. Public summary chỉ count/average cho review gắn booking completed của dịch vụ; không tên/comment/SĐT/địa chỉ. Không mở đánh giá sản phẩm: các bước và tiền điều kiện Word đều là đơn dịch vụ hoàn thành.

### 2.1.2.8 — Lịch sử

Actor Customer có phiên. Giữ lịch sử completed như UI hiện có; mọi trạng thái ở Đơn của tôi. Input q/serviceId/status/from/to/sort/page/limit; from/to là ngày lịch thực hiện tại Việt Nam, gồm cả ngày to. Server dùng UTC >=start, <next-day, validate ngày/range/enum, AND ownership; EXISTS item snapshot tránh nhân đôi đơn và không phụ thuộc Catalog active. Output total/page sau lọc; UI không tự slice/lọc localStorage thay DB. Ngày đảo ngược báo tại form và không gửi truy vấn đó. Kết quả rỗng có hướng đổi bộ lọc.

## C. API, database, xác thực và cấu hình

Contract: [customer-api-contract.md](customer-api-contract.md). Các quyết định chủ nhiệm đã duyệt: [customer-use-case-decisions.md](customer-use-case-decisions.md). Team owner review trước merge vẫn cần, không suy diễn phê duyệt nhiệm vụ là cả nhóm nghiệm thu.

| API | Thay đổi/dữ liệu |
|---|---|
| POST /api/v1/orders | Giữ endpoint, thực thi house details đã quy định; transaction Order hiện có |
| GET /api/v1/orders?q=&serviceId=&status=&from=&to=&sort=&page=&limit= | Additive, giữ default/response cũ; Order chỉ đọc bảng của mình |
| GET /api/v1/reviews/service-summary?serviceId= | Public count/average; Review chỉ đọc reviews và gọi Order REST |
| GET /internal/v1/services/:id/completed-bookings?page=&limit= | Chỉ caller review có credential, chỉ ID completed; Gateway không expose |
| GET /api/v1/catalog/services?q=&group=&cleaningType= và /:id | Tái sử dụng; không sửa Catalog trong nhiệm vụ này |

Giữ RS256/JWKS/introspection, HttpOnly SameSite=Lax cookie, Secure production, credentials include và Origin chính xác. Không password/token browser storage, không tin ID/role/status/price do browser gửi, SQL tham số hóa, lỗi không stack/secret.

**Không migration/schema/seed mới, không sửa .env/thêm biến môi trường/dependency.** Tên biến hiện có: DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD, CUSTOMER_ORIGIN, CUSTOMER_DEFAULT_BRANCH_ID, NEXT_PUBLIC_API_URL và INTERNAL_*_TOKEN/JWT_* theo README.

Fixture chỉ trên target đã duyệt 127.0.0.1:3306/dich_vu_ve_sinh; đúng marker/ID, cleanup theo FK. Sau kiểm thử: users=1, branches=1, service_categories=3, services=4, products=2, product_inventory=2, bookings=0, product_orders=0; quantity=40, reserved=0. Không còn registry JSON. Dữ liệu demo từ nhiệm vụ trước giữ nguyên, không chỉnh tài khoản thật. Test có thể làm tăng dãy auto-increment; không reset ID.

## D. File thay đổi của nhiệm vụ này

Các WIP khác đã có trước được bảo toàn, không tính thành code mới của nhiệm vụ.

| Đường dẫn chính xác | Mục đích |
|---|---|
| backend/order-service/src/customer-order-query.js | Validate filter, UTC bounds |
| backend/order-service/src/app.js | Query, required house details, provider ID |
| backend/order-service/src/repository.js | SQL filter/page và completed-bookings |
| backend/review-service/src/app.js | Summary route |
| backend/review-service/src/repository.js | Aggregate bảng reviews |
| backend/review-service/src/service-summary.js | Điều phối REST, cộng điểm, fail closed |
| backend/api-gateway/src/app.js | Route Customer summary |
| backend/docs/customer-api-contract.md | Contract additive đã duyệt |
| backend/docs/customer-use-case-decisions.md | Quyết định và điểm chưa rõ |
| backend/docs/customer-use-case-verification.md | Báo cáo này |
| backend/README.md | Link báo cáo |
| backend/tests/customer-http.mysql.test.js | HTTP/MySQL house details, inactive, filters, summary/quyền/lỗi |
| backend/tests/domain-integrity.test.js | HTTP house details với dependency mock |
| backend/tests/customer-order-query.test.js | Calendar/SQL params/sort |
| backend/tests/service-review-summary.test.js | Aggregate/page/error và ranh giới bảng |
| frontend/packages/core/src/customer-service-search.ts | Adapter Catalog filters |
| frontend/packages/core/src/customer-order-api.ts | Adapter Order page/ownership/session scope |
| frontend/packages/core/src/customer-time.ts | Ngày/giờ Việt Nam |
| frontend/packages/core/src/customer-service-reviews.ts | Adapter/validation summary |
| frontend/packages/ui/src/components/customer/service-catalog.tsx | Search API/loading/error/retry |
| frontend/packages/ui/src/components/customer/service-detail.tsx | Gắn summary vào trang sẵn có |
| frontend/packages/ui/src/components/customer/service-rating-summary.tsx | Điểm thật/empty/error/retry |
| frontend/packages/ui/src/components/customer/customer-orders.tsx | Lọc/phân trang API |
| frontend/packages/ui/src/components/customer/customer-order-detail.tsx | Đơn giá, chọn sao, warning và giờ Việt Nam |
| frontend/packages/ui/src/components/customer/booking-service.ts | Phân biệt POST ACK và refresh failure |
| frontend/packages/ui/src/components/customer/booking-validation.ts | Phone/area và lịch Việt Nam |
| frontend/packages/ui/src/components/customer/customer-booking.tsx | Hiển thị giờ xác nhận |
| frontend/tests/customer-use-cases.unit.test.mjs | Adapter/ACK/time/validation tests |
| frontend/tests/customer-browser.cdp.mjs | UC browser, API query, lỗi review/search, điểm chung |
| frontend/tests/product-commerce.unit.test.mjs | Dependency thời gian thật cho test cũ |
| frontend/docs/CUSTOMER_API_INTEGRATION.md | Cách hoạt động mới |

## E. Kết quả kiểm thử thực chạy

| Thư mục/lệnh | Kết quả |
|---|---|
| backend: `$env:ALLOW_CUSTOMER_DB_TEST='1'; npm.cmd test` | **PASS 95 / FAIL 0 / SKIP 0**; gồm unit/mock/security và HTTP/MySQL thật, phân biệt tên suite |
| frontend: `npm.cmd run test:commerce` | **PASS 48 / FAIL 0 / SKIP 0**; unit/VM, không gọi là browser E2E |
| frontend: `npm.cmd run typecheck` | **PASS** Customer/Staff/Admin |
| frontend: `npm.cmd run build:customer` | **PASS** production compilation/TypeScript/static generation |
| backend: `$env:ALLOW_CUSTOMER_DB_TEST='1'; npm.cmd run test:products:browser` | **PASS** Chrome + Next4301 + Gateway/services/MySQL, sản phẩm và toàn bộ Customer flow |
| backend: `node tests/role-demo-browser.mjs` | **PASS** Staff/Admin login/dashboard/reload, storage riêng, zero Customer API requests |
| backend: `npm.cmd run check:db` / `npm.cmd run check:products` | **PASS**, metadata/kết nối chỉ đọc |
| root: `git diff --check` | **PASS**, cảnh báo LF/CRLF không phải whitespace failure |
| lint riêng | **SKIP** — không có script lint, không tự thêm dependency |
| Payment thật; Admin duyệt hủy/Staff đổi trạng thái qua backend | **SKIP** — ngoài phạm vi đã chốt; fixture completed không chứng minh tích hợp hai vai trò |
| Production/multi-instance/tải lớn/toàn bộ viewport/kiểm duyệt từ ngữ | **NOT VERIFIED** — thiếu môi trường/chính sách |

Browser đã kiểm tra mobile 390px trong flow đặt lịch/sản phẩm; không đồng nghĩa kiểm định mọi thiết bị. Test đầu phát hiện method tổng hợp Review đặt sai vị trí; test bổ sung inactive cũng bắt lỗi tên cột name/full_name trong fixture. Đã sửa, giữ assert và chạy lại backend cuối đạt 95/95. Không còn lỗi test chưa giải quyết.

Next/Chrome sinh output theo phê duyệt trước. Next-env và stub Staff do test tạo đã đối chiếu trước khi dọn; không đổi source Staff/Admin. Đã dừng đúng các tiến trình do test tạo.

## F. Giới hạn và bàn giao

- Đây là kiểm chứng local, chưa phải production/team acceptance. Cần cập nhật Word theo hai quyết định hủy chờ duyệt/thanh toán mô phỏng; không sửa tệp Word gốc trong nhiệm vụ code.
- Giờ mở cửa, hạn đặt trước, cutoff hủy, danh sách từ cấm, lịch sử ngoài completed chưa được cung cấp; giữ hành vi đã duyệt. Thông báo khóa tài khoản còn dùng chính sách credentials chung.
- Chưa mở avatar/địa chỉ mặc định, đánh giá sản phẩm, shipping/payment thật. Staff/Admin vẫn demo riêng; Customer MySQL không tự xuất hiện trong hai demo đó.
- Summary giới hạn 10.000 booking completed/dịch vụ, không phải distributed snapshot; quá giới hạn/thay đổi pagination/dependency lỗi trả 503. Cần projection/cache được duyệt cho triển khai lớn.
- Session registry Auth ở RAM, restart hết phiên; chưa dùng cho nhiều instance production.
- Reviewer: Thưởng (Order/Review/Auth/Customer/Gateway), Trung (Catalog/provider/shared review), Tùng (assignment dependency). Không sửa UC12 hay phần Admin/Staff chưa duyệt.
- Khôi phục code bằng patch riêng được review trên đúng file mục D, bảo toàn WIP; không reset working tree/xóa dữ liệu. Không có DDL mới cần rollback.

Checklist: phạm vi **PASS**; hồi quy **PASS**; contract chủ nhiệm/test local **PASS**, team merge approval **NOT VERIFIED**; DB/fixture **PASS**; authz/security phạm vi test **PASS**; reliability **PASS**; bằng chứng/bàn giao **PASS**; Git **PASS**.

Chạy từ root trong hai terminal: `npm.cmd --prefix backend run start:customer`, `npm.cmd --prefix frontend run dev:customer`; mở http://localhost:3001. Dừng đúng terminal cũ trước khi restart để nạp backend mới, không chạy seed/migration lại.
