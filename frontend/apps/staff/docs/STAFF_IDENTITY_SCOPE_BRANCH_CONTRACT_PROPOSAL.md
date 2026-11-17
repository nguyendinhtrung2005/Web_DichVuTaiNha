# Contract hồ sơ, bộ lọc và chi nhánh — đề xuất cần owner duyệt

Tài liệu bàn giao cho Auth owner, Trung/Order/Admin và Customer. Mọi endpoint/field ghi **đề xuất** bên dưới chưa tồn tại, không được dùng để bật nút hoặc báo lưu thành công. Không thêm migration hoặc sửa dữ liệu từ Staff.

## 1. Inventory API đã có và thiếu

| Nhu cầu | Có thật trong source | Cần owner cung cấp |
|---|---|---|
| Danh tính | Auth login, refresh, logout, introspect, JWKS | GET hồ sơ; session công khai hiện chỉ ID/role/status/expiry |
| Hồ sơ nhân viên | Staff đọc employee ACTIVE, branch theo actor | Auth API họ tên/phone/email/avatar + capability tự sửa; schema hiện chưa có users.email/avatar |
| Lọc công việc | Staff GET jobs hỗ trợ status/from/to/serviceId/page/pageSize/sort; GET job-filters có services scoped | Snapshot diện tích chính thức và required_staff_count; query/capability/version sau thống nhất |
| Chi nhánh | Staff GET branch với name/addressText/latitude/longitude/serviceArea/status từ API thật | Admin cấp bản ghi production đã xác minh và GeoJSON khi có; không đổi tên dữ liệu DEMO để coi là thật |
| Lịch ca | GET availability | Register/change/cancel + approval workflow; chưa được mở nút ghi |
| Review / tiền công | Thống kê assignment thật, estimate DEMO_V2 | Review/KPI/payout và chính sách nghiệp vụ được phê duyệt |

## 2. Hồ sơ: contract Auth đề xuất

Nguồn danh tính vẫn là Auth. Staff không thêm endpoint ghi users, không tự đọc database Auth để làm API hồ sơ thay chủ module.

`GET /api/v1/auth/me` với Bearer server-side, không nhận userId/employeeId tùy chọn. Ví dụ DTO **đề xuất**:

```json
{
  "data": {
    "id": "201", "fullName": "Tên nhân viên", "phone": null, "email": null,
    "avatarUrl": null, "role": "EMPLOYEE", "status": "ACTIVE",
    "phoneVerified": false, "emailVerified": false,
    "editableFields": ["fullName"],
    "revision": "12"
  }
}
```

Null nghĩa chưa cung cấp, không điền dữ liệu demo/placeholder như giá trị hồ sơ. Staff trình bày ID/role/status chỉ đọc. EmployeeId/branch do Staff/Admin quản lý, không sửa từ form danh tính.

Staff/BFF phải giao `editableFields` với allowlist local đã được duyệt; role/status/userId/employeeId luôn khóa kể cả upstream trả capability lạ. Chưa có GET hợp lệ thì không tự mở form lưu. Phone/email không được đi vòng flow xác minh bằng một PATCH generic.

`PATCH /api/v1/auth/me/profile` **đề xuất** dùng `If-Match`/revision, allowlist từ GET; bước đầu chỉ fullName nếu owner cho phép. Không nhận role/status/employeeId/userId/password/verification flags. Họ tên theo giới hạn schema Auth, Unicode, trim và từ chối control character; quy tắc tên phải được Auth xác nhận trước áp dụng như chính sách chính thức. Response là hồ sơ canonical + revision mới, không chỉ `{success:true}`. Client giữ draft trong bộ nhớ khi lỗi, xóa khi đổi tài khoản/logout; không lưu PII vào localStorage.

Đổi phone/email cần flow riêng, không ghi trực tiếp PATCH rồi coi là verified:

- `POST /api/v1/auth/me/contact-change` đề xuất: `{type:"phone"|"email",value,profileRevision}`; re-auth khi cần, rate limit theo tài khoản/IP/đích, trả challengeId + expiresAt + địa chỉ che bớt. Không trả mã xác minh về client trong production.
- `POST /api/v1/auth/me/contact-change/:challengeId/verify` đề xuất: `{code}`; challenge thuộc đúng account, TTL, giới hạn số lần, single-use. Chỉ commit contact khi verify thành công và uniqueness được kiểm tra nguyên tử.
- Auth quyết định chuẩn hóa E.164/email, uniqueness/collation, nhà cung cấp SMS/email, chi phí và chính sách thu hồi phiên. Không tự tạo phone/email QA thành danh tính thật. Nếu provider chưa có, chức năng tiếp tục unavailable, không gửi OTP giả.

| HTTP / mã đề xuất | Hành vi Staff |
|---|---|
| 400 VALIDATION_ERROR | Hiển thị lỗi field allowlist; giữ draft |
| 401 SESSION_EXPIRED / 403 PROFILE_UPDATE_FORBIDDEN | Kiểm tra phiên, xóa dữ liệu khi đổi tài khoản; không tự nâng quyền |
| 409 PROFILE_REVISION_CONFLICT | Không ghi đè bản mới; yêu cầu tải lại và xác nhận |
| 409 CONTACT_UNAVAILABLE | Thông báo trung tính, tránh lộ tài khoản khác |
| 422 VERIFICATION_INVALID / 410 VERIFICATION_EXPIRED | Không đổi contact; không tự tạo challenge/verify thành công |
| 429 RATE_LIMITED / 503 AUTH_UNAVAILABLE | Tôn trọng Retry-After, giữ draft, không retry liên tục |

BFF tương lai: `GET/PATCH /api/staff/profile` chỉ proxy fixed Auth routes, same-origin/CSRF/session/account binding; giới hạn request/response, không chuyển cookie/JWT/key về browser, không chuyển hồ sơ sang AI/maps. API chưa có nên nút Lưu hiện tiếp tục disabled; validation authoritative và persistence chưa được nghiệm thu.

Test cần Auth owner: self A/B isolation; forbidden fields; Unicode/giới hạn/control char; contact trùng/OTP sai/hết hạn/replay; mất mạng/retry; If-Match conflict; reload sau lưu; logout khi đang gửi; session revoked theo chính sách. Không ghi Auth/schema từ Staff để tạo bằng chứng giả.

## 3. Diện tích và số người: field/query đề xuất

Customer cung cấp phạm vi khi đặt; Order lưu snapshot có version. Admin chỉnh qua quy trình được duyệt; Staff chỉ đọc. Hai nguồn không được suy ra từ `booking_items.quantity`, unit label hoặc số assignments.

| Field snapshot đề xuất | Quy tắc |
|---|---|
| `work_area_m2` → DTO `areaM2` | DECIMAL nullable, gửi JSON bằng chuỗi; null = chưa rõ/không áp dụng. Không dùng 0 thay null. Miền/độ chính xác/giới hạn do owner duyệt. |
| `required_staff_count` → DTO `requiredStaffCount` | Số nguyên dương hoặc null legacy; nguồn gói/hợp đồng chính thức, cùng staffing version/revision trong proposal đội. |
| `minimum_staff_count` → DTO `minimumStaffCount` | Số người tối thiểu Order tính từ policy đã duyệt; required là số khách chọn >= minimum, không dùng minimum thay required khi điều khiển đội. Chưa có field này trong API/DB hiện hành. |
| `scope_version` / `scope_source` | Chứng minh snapshot tại thời điểm xác nhận booking; không đọc gói mới rồi thay ngầm booking cũ. |

Query Staff **đề xuất, hiện chưa nhận**: `areaMinM2`, `areaMaxM2`, `requiredStaffMin`, `requiredStaffMax`. Validate decimal chuẩn/không số mũ, min<=max, integer cho số người, chống tham số lặp/injection. Khoảng inclusive và kết hợp AND với status/ngày/service; lọc bằng SQL trước COUNT/pagination, không lọc riêng trang hiện tại. Booking unknown scope không khớp bộ lọc range; không giả unknown thành 0.

`GET /job-filters` tương lai cần capability/version từ owner: `areaSupported`, `requiredStaffCountSupported`, nguồn snapshot và miền hợp lệ. Không bật capability chỉ vì một response có quantity hay roster. Nếu field/capability chưa có, UI giữ thông báo chưa hỗ trợ và BFF từ chối query đó. Staff parser/DTO/SQL chỉ mở sau sign-off và migration owner đã áp dụng ở môi trường được phép.

Test sau API: m² decimal chính xác; null khác 0; N=1/2/3/4 và min/max; minimum=2 nhưng required=4 phải tuân đội bốn người; thay gói không đổi booking snapshot; nhiều booking_items không nhân assignment; tổng/pagination/biểu đồ không lệch; A/B facets; khoảng ngày Việt Nam xuyên tháng/năm; input sai không gửi request. Chi tiết quote, version, snapshot và quyết định tổng hợp nhiều dịch vụ tại [proposal nhân sự](./STAFF_ORDER_STAFFING_CONTRACT_PROPOSAL.md).

## 4. Branch/Map: contract và nguồn dữ liệu

API thật hiện có: Staff `GET /api/v1/staff/me/branch` → BFF `GET /api/staff/branch`, actor xác thực quyết định employee/branch. Browser không chọn employee hoặc branch tùy ý. Fields `name`, `addressText`, `latitude`, `longitude`, `serviceArea`, `status` đã có; dữ liệu production chính thức còn thiếu.

Admin cần cung cấp, xác minh và chịu trách nhiệm:

- Tên/địa chỉ/chi nhánh thật; latitude trong [-90,90], longitude trong [-180,180], cùng datum WGS84 và nguồn xác minh. Không geocode booking/địa chỉ khách để bù tọa độ chi nhánh.
- `serviceArea` nếu cần vùng: GeoJSON Polygon/MultiPolygon hoặc Feature/FeatureCollection được kiểm tra; tọa độ [longitude,latitude], ring đóng, không điểm ngoài miền; version/updatedAt và quyền chỉnh sửa. Thiếu/hỏng thì Staff không vẽ thay thế.
- Metadata môi trường/nguồn đáng tin cậy, ví dụ `dataClassification: QA_SYNTHETIC|PRODUCTION_VERIFIED`, để phân biệt rõ bằng contract thay vì dựa vào tên. Field này **đề xuất**, Staff không tự thêm vào response thật khi DB chưa có.

Leaflet/OSM giữ attribution, cache/Referer, chỉ tile viewport; không location permission, geocoding khách, prefetch hay bulk download. ERR_CONNECTION_RESET ghi là lỗi transport/tile; không quy kết frontend hoặc provider ngừng hoạt động nếu chưa có bằng chứng. Tile 200 từng phần không đồng nghĩa toàn bộ lớp nền ổn định.

Production cần operator chọn tile provider/self-host đáp ứng tải và điều khoản. Public OSM không có SLA được Staff cam kết. Không tự thay endpoint hoặc dùng API key công khai để che lỗi mạng. Marker/popup/zoom/pan và lỗi/retry kiểm thử riêng với tải tile, dữ liệu branch và GeoJSON.

## 5. Tiêu chí chấp nhận chung

Không bỏ guard hoặc mở nút lưu chỉ bằng mock/capability do client tự gửi. Owner ký contract/version, triển khai và cung cấp QA độc lập; Staff chạy HTTP + Chrome + DB đối chiếu theo quyền; log không có PII/secret/stack; request thiếu/đổi session và A/B bị chặn. Chỉ REAL_PASS cho luồng thật, ghi riêng MOCK_PASS/DEMO_PASS/NOT_RUN/BLOCKED.
