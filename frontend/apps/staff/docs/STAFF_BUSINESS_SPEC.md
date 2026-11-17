# CleanHome Staff — Đặc tả nghiệp vụ thống nhất

> Cập nhật 04/11/2026: xem [STAFF_PRIORITIES_20261104.md](STAFF_PRIORITIES_20261104.md) cho chính sách DEMO_V2 và triển khai local mới. Nội dung ngày 02/11 bên dưới giữ làm bằng chứng lịch sử; endpoint pending hiện có lấy source làm chuẩn. DEMO không phải payroll/ledger đã được TV5 duyệt.


- **Ngày:** 2026-11-02
- **Worktree:** `CleanHome_Staff_Rebuild`, nhánh `feat/staff-rebuild`, checkpoint `c8dec00`
- **Phạm vi:** website Staff (`frontend/apps/staff`) + package UI dùng chung cho Staff
- **Nguyên tắc tài liệu:** chỉ ghi "ĐÃ CÓ" khi có bằng chứng trong source Backend/DB; mọi thứ khác ghi rõ **PROPOSED** hoặc **BLOCKED**. Tài liệu này không thay thế contract của owner Backend.

Tài liệu liên quan:

- [STAFF_REAL_API_INTEGRATION.md](STAFF_REAL_API_INTEGRATION.md) — phần đã chạy bằng API thật và test.
- [STAFF_BACKEND_CONTRACT_PROPOSALS.md](STAFF_BACKEND_CONTRACT_PROPOSALS.md) — endpoint PROPOSED cho phần còn thiếu.
- [STAFF_BACKEND_INTEGRATION_GAPS.md](STAFF_BACKEND_INTEGRATION_GAPS.md), [STAFF_BACKEND_IMPLEMENTATION_REQUESTS.md](STAFF_BACKEND_IMPLEMENTATION_REQUESTS.md) — khoảng trống và owner.
- [STAFF_INCOME_ACCEPTANCE_CONTRACT_PROPOSAL.md](STAFF_INCOME_ACCEPTANCE_CONTRACT_PROPOSAL.md) — chi tiết thu nhập/ledger (chưa duyệt).

---

## 1. Nguồn sự thật (source of truth)

| Miền dữ liệu | Service sở hữu | Trạng thái thực tế |
| --- | --- | --- |
| Danh tính, phiên, JWT | `auth-service` | Có API thật: login / refresh / logout / introspect / JWKS |
| Phân công, lịch làm theo phân công | `staff-service` | Có API thật: jobs, schedule, detail, PATCH status |
| Đơn hàng, trạng thái booking, xác nhận chuyển trạng thái | `order-service` | Chỉ có route nội bộ `assignment-transitions` (GET/PUT/ack/pending) |
| Chi nhánh, khu vực phục vụ, ca sẵn sàng | `staff-service` (bảng `branches`, `employee_availability`) | Có API đọc branch/availability; đăng ký/đổi/hủy chờ API và quyền duyệt |
| Thu nhập, ledger, chi trả | `payment-service` | **Scaffold rỗng (~53 byte), không có API** |
| Đánh giá khách hàng | `review-service` | **Scaffold rỗng (~52 byte), không có API** |
| Thông báo | chưa có service | **Chỉ có bảng `notifications` trong schema** |
| Hỗ trợ (ticket) | chưa có service | **Không có bảng, không có API** |
| Danh mục dịch vụ/giá | `service-service` | **Scaffold rỗng, không có API** |

Bằng chứng: `backend/*/src/app.js`, `databases/schema_staff_test.sql`, `frontend/apps/staff/lib/server/*.mjs`.

---

## 2. Khái niệm domain

| Khái niệm | Định nghĩa | Ghi chú |
| --- | --- | --- |
| **Employee** | Bản ghi `employees` gắn `user_id`; chỉ `status = ACTIVE` và user `ACTIVE` với role `EMPLOYEE`/`STAFF` mới được dùng Staff API | `staff-service` tự resolve từ `actor.userId`, không nhận `employeeId` từ client |
| **Assignment** | Một dòng `assignments` nối `booking_id` + `employee_id`; đơn vị công việc của Staff | Là DTO duy nhất Staff được đọc cho UC9/UC10/UC11 |
| **Booking** | Đơn dịch vụ của khách; có `scheduled_start/end`, `status`, `address_snapshot` | Staff **không** sở hữu; chỉ đọc qua assignment |
| **Job (UI)** | Cách gọi assignment trong giao diện UC9 | Không phải entity riêng |
| **Availability / Shift** | `employee_availability(starts_at, ends_at, status)` | API đọc thật, chi tiết ngày/ca; **không** đồng nhất với lịch phân công hoặc trạng thái phê duyệt |
| **Service area** | `branches.service_area` (JSON) + `employees.branch_id` | API branch thật + Leaflet; **không** suy ra từ địa chỉ booking |
| **Income entry** | Khoản thu nhập được ghi nhận theo chính sách | **PROPOSED**, chưa có bảng/API/công thức được duyệt |
| **Review** | Đánh giá của khách (`reviews.rating`, `reviews.comment`) | Có bảng, chưa có API |
| **Notification** | Thông báo cho `user_id`, có `read_at` | Có bảng, chưa có API |
| **Support ticket** | Yêu cầu hỗ trợ của nhân viên | **PROPOSED**, chưa có bảng/API |

---

## 3. Quy tắc chung (áp dụng cho mọi module)

1. **Danh tính do server quyết định.** Browser không gửi `employeeId`/`userId`; BFF lấy từ session, `staff-service` lấy từ JWT actor. Nhân viên A không thể đọc dữ liệu của B (mọi query bị scope theo actor).
2. **Không có fallback DEMO trong chế độ REAL.** Lỗi API thật phải hiện lỗi/empty đúng nghĩa; DEMO chỉ bật khi `NODE_ENV=development` **và** cờ `STAFF_*_DEMO_ENABLED`, và production luôn tắt.
3. **Thời gian:** mọi kỳ thống kê/ngày lọc dùng `Asia/Ho_Chi_Minh` (UTC+7). API nhận `YYYY-MM-DD` inclusive hai đầu; Backend đổi sang UTC khi truy vấn.
4. **Tiền:** chỉ dùng `DECIMAL` dạng chuỗi hoặc đơn vị tiền nhỏ nhất theo contract; không tính bằng `Number` rồi cộng dồn; không suy tiền công từ giá booking, `quantity`, `unitPrice` hay số lượng DONE.
5. **Không ghi khi chưa có quyền/nghiệp vụ.** Các mutation hiện có duy nhất là PATCH trạng thái assignment (UC12) và chỉ chạy trên fixture QA được phép.
6. **Trạng thái là domain state, không phải boolean.** UI hiển thị đúng enum, không gộp "đã xong" với "đã nghiệm thu/đã trả tiền".
7. **Một phép tính, một chỗ.** Công thức chỉ số nằm trong `staff-performance-model.ts`; trang chỉ hiển thị.

---

## 4. Phân công — state machine ĐÃ CÓ

Nguồn: `backend/staff-service/src/mapping.js`, `job-service.js`, `repository.js`, `validation.js`.

### 4.1. Trạng thái

| DB (`assignments.status`) | DTO Staff | Ý nghĩa |
| --- | --- | --- |
| `ASSIGNED` | `WAITING` | Đã phân công, nhân viên chưa tiếp nhận |
| `ACCEPTED` | `ACCEPTED` | Nhân viên đã tiếp nhận |
| `IN_PROGRESS` | `IN_PROGRESS` | Đang thực hiện; set `check_in_at` |
| `DONE` | `DONE` | Hoàn thành; set `check_out_at` |
| `CANCELLED` | `CANCELLED` | Đã hủy (không do Staff PATCH) |

### 4.2. Chuyển trạng thái được phép qua Staff API

```
ASSIGNED ──ACCEPTED──▶ ACCEPTED ──IN_PROGRESS──▶ IN_PROGRESS ──DONE──▶ DONE
   │
   └────────────── CANCELLED (ngoài Staff PATCH) ──────────────────────▶ CANCELLED
```

- `PATCH /api/v1/staff/jobs/:assignmentId/status` chỉ nhận `ACCEPTED | IN_PROGRESS | DONE`.
- Bắt buộc `Idempotency-Key` (8–128 ký tự ASCII `[A-Za-z0-9._:-]`); khóa được hash cùng `userId` + `assignmentId`.
- `check_in_at` chỉ set khi vào `IN_PROGRESS`; `check_out_at` chỉ set khi `DONE`; cả hai lấy `occurredAt` từ Order ACK, **không** lấy giờ thiết bị.
- Nếu Order đã ghi nhận nhưng DB chưa cập nhật → `409 RECONCILIATION_CONFLICT`; nếu đã ghi DB nhưng chưa ACK Order → `503 RECONCILIATION_REQUIRED` (retry cùng Idempotency-Key).
- Booking status (`PENDING/CONFIRMED/IN_PROGRESS/COMPLETED/CANCELLED`) là dữ liệu của `order-service`, chỉ đọc.

### 4.3. Bất biến

- `DONE` của assignment **không** đồng nghĩa booking `COMPLETED`, khách đã nghiệm thu, đã đối soát hay đã thanh toán.
- Không cho phép nhảy cóc (ví dụ `ASSIGNED → DONE`): service so `steps.indexOf`.
- Không sửa lịch sử; điều chỉnh phải là bút toán/sự kiện mới (áp dụng cho thu nhập khi có).

---

## 5. Chỉ số vận hành & KPI

### 5.1. ĐÃ TRIỂN KHAI — chỉ số vận hành (không phải KPI thưởng)

Nguồn dữ liệu duy nhất: DTO assignment từ `GET /api/staff/schedule` (qua BFF `/api/staff/schedule`). Kỳ = các assignment có `scheduled_start` giao với khoảng ngày Việt Nam đã chọn (mặc định: tháng hiện tại). Tối đa 500 dòng/kỳ; vượt mức thì báo lỗi thay vì cắt bớt.

| Chỉ số | Công thức | Mẫu số 0 | Ghi chú |
| --- | --- | --- | --- |
| `total` | số assignment trong kỳ | 0 | Có thể bằng 0 |
| `waiting/accepted/inProgress/done/cancelled` | đếm theo `status` hiện tại | 0 | Không phải lịch sử trạng thái |
| `completionRate` | `done / (total − cancelled)` | `null` → "Chưa đủ dữ liệu" | Làm tròn 1 chữ số thập phân |
| `checkInSample` | số assignment có **cả** `scheduledAt` và `checkInAt` | 0 | Chỉ mẫu có đủ mốc |
| `onTimeRate` | `checkInAt ≤ scheduledAt` trên `checkInSample` | `null` | Bằng đúng mốc giờ được tính đúng giờ |
| `durationSample` | số assignment `DONE` có `checkInAt`, `checkOutAt` và `checkOut ≥ checkIn` | 0 | Bản ghi lỗi bị loại, không quy về 0 phút |
| `averageServiceMinutes` | trung bình `checkOutAt − checkInAt` (phút), làm tròn số nguyên | `null` | Chỉ trên `durationSample` |
| `doneMissingCheckOut` | `DONE` thiếu `checkOutAt` | 0 | Cảnh báo chất lượng dữ liệu |
| `activeMissingCheckIn` | `IN_PROGRESS`/`DONE` thiếu `checkInAt` | 0 | Không được tính là đúng giờ |
| `invalidDuration` | `checkOutAt < checkInAt` | 0 | Bị loại khỏi trung bình |

Quy ước hiển thị: `null` → "Chưa đủ dữ liệu"; tỷ lệ dùng dấu phẩy thập phân Việt Nam (`66,7%`); thời lượng `1 giờ 30 phút`.

**Giới hạn đã biết:**

- Chỉ số tính ở client từ tối đa 500 assignment; kỳ lớn hơn cần aggregate phía Backend (**PROPOSED**, xem contract).
- `onTimeRate` đo **nhận việc đúng giờ hẹn**, không đo hoàn thành đúng hạn (chưa có `completed_at` đáng tin cậy tách khỏi `check_out_at`).
- Không có dữ liệu từ chối, vi phạm, tranh chấp hay đánh giá của khách.

### 5.2. CHƯA ĐƯỢC DUYỆT — KPI/huy hiệu/xếp hạng

- Chưa có định nghĩa KPI chính thức, trọng số, ngưỡng, kỳ chốt hay quy tắc thưởng.
- Không dùng điểm sao DEMO trong chế độ REAL.
- Không tạo huy hiệu từ con số tuỳ ý; huy hiệu/mục tiêu hiện chỉ là DEMO có nhãn "DỮ LIỆU MINH HỌA".
- Bảng xếp hạng chỉ được xây khi có API + chính sách quyền riêng tư được duyệt.
- Điểm đánh giá trung bình chỉ được tính khi Review API trả dữ liệu đã xác minh, có `reviewId` và trạng thái; hiện **không hiển thị** trong REAL.

---

## 6. Đánh giá khách hàng

- Bảng `reviews(rating, comment, ...)` tồn tại trong schema nhưng `review-service` **không có API**.
- Trong REAL, trang Thành tích hiển thị "Đánh giá chưa được cung cấp" — không hiển thị sao giả, không tính trung bình từ dữ liệu thiếu.
- Khi có API: chỉ hiển thị đánh giá thuộc assignment/booking của chính nhân viên; trung bình phải kèm số lượng mẫu; không trộn DEMO.

---

## 7. Khu vực & ca làm

### 7.1. Dữ liệu đã có trong schema

| Bảng | Trường liên quan | Ý nghĩa |
| --- | --- | --- |
| `branches` | `service_area JSON`, `latitude`, `longitude`, `status` | Khu vực phục vụ của chi nhánh |
| `employees` | `branch_id` | Chi nhánh của nhân viên |
| `employee_availability` | `employee_id`, `starts_at`, `ends_at`, `status` | Ca/khung sẵn sàng |

### 7.2. Trạng thái thực tế

- Đã có API đọc thật `GET /api/v1/staff/me/branch` và `GET /api/v1/staff/me/availability`, qua Staff BFF. Backend lấy nhân viên/chi nhánh từ phiên đăng nhập, không nhận employeeId/branchId từ trình duyệt.
- Trang mặc định dùng dữ liệu thật, có chi tiết từng ngày/khung giờ và Leaflet + OpenStreetMap. Lịch khả dụng vẫn **CHỈ ĐỌC**; bản DEMO riêng không phải dữ liệu chính thức.
- Chưa có API đăng ký/đổi/hủy hoặc dữ liệu phê duyệt. Giao diện chỉ chuẩn bị và xem lại nội dung tạm, khóa gửi; không tạo yêu cầu chờ duyệt và không thay đổi ca. Xem [các xác nhận còn thiếu](./STAFF_AVAILABILITY_REQUESTS.md).

### 7.3. Quy tắc nghiệp vụ bắt buộc khi triển khai

- Lịch ca (`employee_availability`) và lịch phân công (UC11) là **hai dữ liệu khác nhau**; không hiển thị cái này thay cái kia.
- Khu vực phục vụ do quản lý/Backend cấp; **không** suy ra từ địa chỉ của một booking, **không** cho nhân viên tự sửa nếu API không cho phép.
- Ca hợp lệ: `starts_at < ends_at`; ca qua ngày/qua đêm phải được biểu diễn bằng timestamp tuyệt đối (UTC) + hiển thị theo UTC+7, không dùng giờ rời rạc.
- Chồng lấn ca: `[start, end)` giao nhau thì từ chối (trừ khi owner cho phép nhiều ca song song).
- Xung đột với assignment đã nhận: chỉ cảnh báo/chặn nếu owner chốt quy tắc; hiện chưa có.
- Đổi ca/nghỉ phép/đăng ký ca cần luồng duyệt của quản lý — **PROPOSED**, chưa triển khai.

---

## 8. Thông báo

- Bảng `notifications(user_id, read_at, ...)` có trong schema; **không có API**, không có service.
- REAL: màn hình chỉ hiển thị trạng thái "chưa khả dụng", không tự sinh thông báo, không giả push event.
- Khi có API, contract bắt buộc: `notificationId`, `recipientId` (server-scope), `type` (`JOB | SCHEDULE | INCOME | REVIEW | SYSTEM | SUPPORT`), `title`, `body`, `createdAt`, `readAt`, `link` (đường dẫn nội bộ đã whitelist), phân trang + `unreadCount`, và mutation đánh dấu đã đọc có idempotency.
- Chống trùng: unique theo `(recipientId, type, sourceEventId)`; client không được tạo thông báo.

---

## 9. Hỗ trợ

- Không có bảng/API. REAL: chỉ hiển thị trạng thái chưa khả dụng.
- DEMO hiện có form tạo yêu cầu trong bộ nhớ trang (mất khi F5) — không gửi đi đâu.
- Khi triển khai (PROPOSED): `ticketCode`, `subject`, `priority`, `status` (`NEW | IN_PROGRESS | RESOLVED | CLOSED`), `createdAt`, `updatedAt`, lịch sử phản hồi; nhân viên chỉ đọc ticket của mình; tạo ticket có idempotency; không mutation trên dữ liệu QA thật.

---

## 10. Cài đặt

- Chỉ có tuỳ chọn hiển thị lưu cục bộ trên trình duyệt (giao diện, mật độ bảng...). Không phải dữ liệu nghiệp vụ, không đồng bộ Backend.
- Không lưu token, không lưu PII vào `localStorage`.

---

## 11. Thu nhập / tính lương — BLOCKED

### 11.1. Kết luận từ source

- `payment-service` rỗng; không có API, ledger, aggregate hay quyền chi trả.
- `revenue_shares(amount DECIMAL(12,2), settlement_status)` có trong schema nhưng **không có API** và không chứng minh công thức/đơn giá đã được duyệt.
- DTO assignment có `services.unitPrice` (giá dịch vụ của booking) — **không phải tiền công**.

### 11.2. Vì vậy

- Không triển khai bất kỳ phép tính lương nào trong REAL; màn hình Thu nhập giữ DEMO có nhãn hoặc trạng thái chưa khả dụng.
- Không hardcode %, không suy từ DONE, không nhân đôi một công việc.

### 11.3. Mô hình chờ duyệt (PROPOSED)

- `IncomeEntry`: `entryId`, `sourceType`, `sourceId`, `assignmentId?`, `bookingId?`, `amount` (DECIMAL chuỗi, VND), `recognizedAt`, `recognitionState`, `settlementState`, `correctionOf?`, `reversalOf?`.
- `Payout`/`Allocation`: mỗi payout phân bổ nhiều entry; không cộng trùng entry + payout vào một tổng.
- Trạng thái (owner chốt enum): dự kiến → chờ duyệt → đã duyệt → đã đối soát → đã chi trả; điều chỉnh bằng bút toán mới.
- Idempotency: unique `(sourceType, sourceId, eventId, version, employeeId)`.
- Công thức, mốc ghi nhận, kỳ chốt sổ, làm tròn, quyền duyệt và xử lý hủy/hoàn/khiếu nại: xem [STAFF_INCOME_ACCEPTANCE_CONTRACT_PROPOSAL.md](STAFF_INCOME_ACCEPTANCE_CONTRACT_PROPOSAL.md) §A.2 (7 quyết định chặn triển khai).

---

## 12. Phân quyền

| Đối tượng | Quyền |
| --- | --- |
| Browser | Chỉ giữ cookie phiên `HttpOnly`; không thấy access/refresh token, không gửi `employeeId` |
| BFF Staff | Đọc session server-side, gọi Backend bằng Bearer token server; trả lỗi chuẩn hoá |
| `staff-service` | Resolve employee từ `actor.userId`; chỉ `EMPLOYEE/STAFF` + `ACTIVE`; scope mọi query theo employee |
| Order/Review/Payment | Không tin `employeeId` từ client; object ownership trả 404 cho tài nguyên của người khác |

- A/B isolation: mọi endpoint list/detail/aggregate phải scope theo actor; test bắt buộc có ca "A không đọc được dữ liệu của B".
- 401/403 từ upstream được BFF map thành `SESSION_EXPIRED`/`STAFF_ACCESS_DENIED` và huỷ phiên khi cần.
- Không mở quyền bằng query/body/path/cursor do browser chọn.

---

## 13. Quyết định cần nhóm phê duyệt

| # | Quyết định | Owner | Ảnh hưởng |
| --- | --- | --- | --- |
| 1 | Đơn giá/công thức thu nhập, mốc ghi nhận, kỳ chốt sổ, làm tròn, quyền duyệt | TV5 + business owner | Chặn toàn bộ Thu nhập |
| 2 | Enum trạng thái ghi nhận/đối soát/chi trả; có chi trả một phần không | TV5 | Chặn UI + ledger |
| 3 | KPI chính thức: công thức, trọng số, ngưỡng, kỳ, quy tắc thưởng | Business owner + TV4 | Chỉ số vận hành hiện tại **không** phải KPI |
| 4 | Quy tắc khu vực: ai cấp, có nhiều khu vực không, có suy theo chi nhánh không | TV4 + business owner | Chặn Khu vực |
| 5 | Quy tắc ca: chồng lấn, ca đêm, đổi ca, duyệt nghỉ phép | TV4 | Chặn Ca làm |
| 6 | Contract thông báo: loại, chống trùng, quyền đọc/đánh dấu đã đọc | TV1/TV4 | Chặn Thông báo |
| 7 | Contract hỗ trợ: trạng thái, SLA, quyền tạo/đọc | TV4 + Admin | Chặn Hỗ trợ |
| 8 | Contract đánh giá: chỉ đánh giá đã xác minh, hiển thị ẩn danh hay tên | TV3/TV5 | Chặn Đánh giá |
| 9 | Có cần aggregate phía Backend cho chỉ số vận hành (thay vì đọc 500 dòng) | TV4 | Hiệu năng kỳ lớn |

---

## 14. Ma trận API (tổng hợp)

| Module | Hành động nghiệp vụ | Owner | Endpoint hiện có | Method | Quyền | Trạng thái |
| --- | --- | --- | --- | --- | --- | --- |
| Auth | Đăng nhập/phiên/logout | auth-service | `/api/v1/auth/login`, `/refresh`, `/logout`, `/introspect` | POST/GET | Public/BFF | **READY_API** |
| Phân công | Danh sách việc | staff-service | `/api/v1/staff/jobs` | GET | EMPLOYEE self | **READY_API** |
| Phân công | Chi tiết việc | staff-service | `/api/v1/staff/jobs/:assignmentId` | GET | EMPLOYEE self | **READY_API** |
| Phân công | Lịch theo khoảng ngày | staff-service | `/api/v1/staff/schedule` | GET | EMPLOYEE self | **READY_API** |
| Phân công | Chuyển trạng thái | staff-service | `/api/v1/staff/jobs/:assignmentId/status` | PATCH | EMPLOYEE self + Idempotency-Key | **READY_API** |
| Thành tích | Chỉ số vận hành | staff-service (dẫn xuất) | `/api/staff/schedule` (BFF) | GET | EMPLOYEE self | **READY_API** (tính client, ≤500 dòng) |
| Thành tích | Điểm sao khách hàng | review-service | — | — | — | **MISSING_API** |
| Thành tích | KPI/huy hiệu/xếp hạng | chưa có | — | — | — | **BLOCKED** (chưa duyệt nghiệp vụ) |
| Khu vực & ca | Đọc khu vực/ca | staff-service | — | — | — | **MISSING_API** |
| Khu vực & ca | Đăng ký/đổi ca | staff-service | — | — | — | **BLOCKED** (chưa duyệt) |
| Thông báo | Danh sách/đã đọc | chưa có | — | — | — | **MISSING_API** |
| Thu nhập | Báo cáo thu nhập | payment-service | — | — | — | **BLOCKED** |
| Hỗ trợ | Tạo/đọc ticket | chưa có | — | — | — | **MISSING_API** |
| Hồ sơ | Danh tính phiên | auth-service | `/api/auth/session` (BFF) | GET | Self | **PARTIAL_API** (chỉ identity) |
| Cài đặt | Tuỳ chọn hiển thị | local | — | — | — | **LOCAL_ONLY** |

> Mọi endpoint trong bảng trên là API **đã tồn tại**. Endpoint đề xuất mới nằm ở [STAFF_BACKEND_CONTRACT_PROPOSALS.md](STAFF_BACKEND_CONTRACT_PROPOSALS.md) và luôn được đánh dấu **PROPOSED**.
