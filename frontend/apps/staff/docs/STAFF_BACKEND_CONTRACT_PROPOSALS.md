# CleanHome Staff — Contract Backend đề xuất (PROPOSED)

- **Ngày:** 2026-11-02
- **Trạng thái:** toàn bộ tài liệu này là **PROPOSED** — chưa được duyệt, chưa triển khai, chưa có trong source Backend.
- **Người lập:** Frontend Staff. **Không** sửa Backend/schema/seed trong phạm vi này.
- **Cách đọc:** mỗi mục ghi rõ service owner, endpoint đề xuất, quyền, request/response mẫu (không chứa dữ liệu nhạy cảm), validation, lỗi và tiêu chí nghiệm thu.

Tham chiếu bắt buộc:

- [STAFF_BUSINESS_SPEC.md](STAFF_BUSINESS_SPEC.md) — nghiệp vụ và quy tắc.
- [STAFF_REAL_API_INTEGRATION.md](STAFF_REAL_API_INTEGRATION.md) — phần đã có thật.
- [STAFF_INCOME_ACCEPTANCE_CONTRACT_PROPOSAL.md](STAFF_INCOME_ACCEPTANCE_CONTRACT_PROPOSAL.md) — chi tiết thu nhập/ledger.

---

## 0. Quy ước chung

### 0.1. Envelope lỗi

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Khoảng ngày chưa hợp lệ." }, "requestId": "uuid" }
```

| HTTP | Code gợi ý | Khi nào |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Query/body sai schema, enum, khoảng ngày |
| 401 | `UNAUTHENTICATED` | Thiếu/hết hạn token |
| 403 | `FORBIDDEN` / `STAFF_INACTIVE` | Role không đủ, employee không ACTIVE |
| 404 | `NOT_FOUND` | Không tồn tại **hoặc** không thuộc quyền (object ownership) |
| 409 | `CONFLICT` / `SNAPSHOT_STALE` | Xung đột trạng thái, snapshot hết hiệu lực |
| 413 | `RANGE_TOO_LARGE` | Kỳ vượt giới hạn owner chốt |
| 429 | `RATE_LIMITED` | Vượt hạn mức |
| 503 | `DEPENDENCY_UNAVAILABLE` | DB/service phụ thuộc chưa sẵn sàng |

Quy ước bắt buộc:

1. `Cache-Control: no-store`, có `X-Request-Id`.
2. `Asia/Ho_Chi_Minh` cho mọi ngày lọc; tham số `from`/`to` dạng `YYYY-MM-DD`, inclusive hai đầu; Backend tự đổi sang UTC.
3. Phân trang: `page`/`pageSize` (tối đa 100) **hoặc** cursor ổn định; response luôn có `pagination.total` là số bản ghi, **không** phải tổng tiền.
4. Không nhận `userId`/`employeeId` từ client; actor lấy từ JWT, scope theo actor.
5. Mutation phải có `Idempotency-Key`; retry cùng key trả cùng kết quả.
6. DTO whitelist; không trả PII của người khác, không trả token, không trả secret.
7. Không trả `0` thay cho "không có dữ liệu": dùng `null` + `reason`/`capabilities`.

### 0.2. BFF mirror

Mỗi endpoint Backend đề xuất có route BFF tương ứng `/api/staff/...` (session → Bearer server-side). Browser **không** gọi trực tiếp Backend.

### 0.3. Ưu tiên triển khai

| Thứ tự | Module | Lý do |
| --- | --- | --- |
| 1 | Availability + khu vực | Nền cho ca làm và điều phối |
| 2 | Performance aggregate | Bỏ giới hạn 500 dòng, chuẩn hoá công thức |
| 3 | Notifications | Cần cho mọi sự kiện nghiệp vụ |
| 4 | Income | Phụ thuộc quyết định tài chính |
| 5 | Reviews | Phụ thuộc Review service |
| 6 | Support | Độc lập, ưu tiên thấp hơn |

### 0.4. Bằng chứng kiểm chứng ngày 2026-11-02

Đọc source Backend (không sửa) và MySQL QA (chỉ `SELECT`):

| Hạng mục | Bằng chứng | Kết luận |
| --- | --- | --- |
| Route `staff-service` | `src/app.js` chỉ có `GET /jobs`, `GET /schedule`, `GET /jobs/:id`, `PATCH /jobs/:id/status` | Không có notifications/areas/availability/performance/reviews/support |
| `payment-service`, `review-service`, `user-service`, `service-service` | `src/app.js` chỉ là stub 50–53 byte, `package.json` không có script | Không có API |
| `api-gateway` | `src/app.js` chỉ có TODO | Không có route |
| Bảng `notifications` | Cột hiện có: `id, user_id, booking_id, content, read_at, created_at`; 0 dòng | Thiếu `type`, `title`, `link`, `source_event_id`; chưa đủ cho contract §3 |
| Bảng `reviews` | `booking_id, employee_id, rating, comment, created_at`; 0 dòng | Chưa có API, chưa có cờ xác minh |
| Bảng `payments` | `booking_id, subscription_id, amount, method, status, paid_at`; 0 dòng | Là thanh toán của khách, **không phải** tiền công |
| Bảng `revenue_shares` | `payment_id, branch_id, employee_id, beneficiary_type, amount DECIMAL(12,2), settlement_status`; 0 dòng | Chưa có API/công thức được duyệt |
| Bảng `employee_availability` | `employee_id, starts_at, ends_at, status`; 0 dòng | Chưa có API |
| `branches.service_area` | Cột `JSON NOT NULL`, 1 chi nhánh | Dữ liệu có, chưa có API |
| Support ticket | Không có bảng `support_ticket*` | Cần cả bảng và API |
| Order `staff-context` | `GET /internal/v1/bookings/:id/staff-context` → **404 `NOT_FOUND`**; `POST /internal/v1/bookings/staff-context/batch` → **404**; `GET /internal/v1/assignment-transitions/pending` → **200** | Staff Service đã gọi đúng path nhưng Order chưa triển khai |

Hệ quả: các mục §1, §3–§6 vẫn là **PROPOSED**. Frontend chỉ được bật REAL khi endpoint tương ứng tồn tại và trả `capabilities`; hiện production hiển thị trạng thái chưa khả dụng, không fallback DEMO.

---

## 1. Khu vực phục vụ & ca làm — owner `staff-service` (TV4)

### 1.1. `GET /api/v1/staff/me/service-areas` — PROPOSED

**Quyền:** EMPLOYEE/STAFF, `ACTIVE`, chỉ đọc của chính mình.
**Nguồn:** `employees.branch_id` → `branches.service_area`, `branches.status`.

```json
{
  "data": {
    "branch": { "id": "12", "name": "CleanHome Quận 1", "status": "ACTIVE" },
    "areas": [
      { "code": "Q1", "name": "Quận 1", "isPrimary": true },
      { "code": "Q3", "name": "Quận 3", "isPrimary": false }
    ],
    "source": "BRANCH_ASSIGNMENT",
    "asOf": "2026-11-02T03:00:00.000Z"
  }
}
```

**Validation:** không tham số. `service_area` sai cấu trúc → `503 INVALID_DATABASE_DATA`, không trả mảng rỗng giả.
**Lỗi:** 401/403/404 (không có employee)/503.
**Nghiệm thu:**

- A không đọc được khu vực của B (không có tham số chọn người).
- Nhân viên không thuộc branch → `404`, không suy khu vực từ booking.
- Không có mutation; không cho sửa khu vực qua endpoint này.

### 1.2. `GET /api/v1/staff/me/availability?from=YYYY-MM-DD&to=YYYY-MM-DD` — PROPOSED

**Quyền:** self.
**Nguồn:** `employee_availability`.

```json
{
  "data": [
    { "id": "501", "startsAt": "2026-11-03T01:00:00.000Z", "endsAt": "2026-11-03T09:00:00.000Z",
      "status": "AVAILABLE", "crossesMidnight": false }
  ],
  "pagination": { "page": 1, "pageSize": 50, "total": 1, "totalPages": 1 },
  "timezone": "Asia/Ho_Chi_Minh",
  "range": { "from": "2026-11-03", "to": "2026-11-09" }
}
```

**Validation:** `from <= to`, tối đa 62 ngày; `startsAt < endsAt`; status thuộc enum owner chốt (`AVAILABLE | UNAVAILABLE | LEAVE | ASSIGNED`).
**Lỗi:** 400/401/403/413/503.
**Nghiệm thu:**

- Ca qua đêm hiển thị đúng theo UTC+7, không bị cắt thành hai ca giả.
- Trả đủ ca giao với khoảng, kể cả ca bắt đầu trước `from`.
- Không trả ca của nhân viên khác.

### 1.3. `POST /api/v1/staff/me/availability-requests` — PROPOSED (cần duyệt nghiệp vụ trước)

**Quyền:** self; **cần** luồng duyệt của quản lý.
**Body:**

```json
{ "type": "SHIFT_CHANGE", "currentAvailabilityId": "501",
  "proposed": { "startsAt": "2026-11-04T01:00:00.000Z", "endsAt": "2026-11-04T09:00:00.000Z" },
  "reason": "Việc gia đình" }
```

**Validation:** `Idempotency-Key`; không chồng lấn ca đã duyệt (trừ khi owner cho phép); `type` thuộc enum; `reason` ≤ 500 ký tự; không cho tự duyệt.
**Lỗi:** 400/401/403/404/409/429/503.
**Nghiệm thu:**

- Tạo trùng key không sinh hai yêu cầu.
- Không thể tạo ca chồng lấn trái quy tắc.
- Nhân viên không sửa được trạng thái duyệt.

---

## 2. Chỉ số vận hành (aggregate) — owner `staff-service` (TV4)

### 2.1. `GET /api/v1/staff/me/performance?from=YYYY-MM-DD&to=YYYY-MM-DD` — PROPOSED

**Mục tiêu:** thay việc client đọc tối đa 500 assignment; Backend tính đúng một lần, có test.

```json
{
  "range": { "from": "2026-11-01", "to": "2026-11-30", "timezone": "Asia/Ho_Chi_Minh", "basis": "SCHEDULED_START_OVERLAP" },
  "counts": { "total": 42, "waiting": 3, "accepted": 5, "inProgress": 2, "done": 30, "cancelled": 2 },
  "completion": { "numerator": 30, "denominator": 40, "rate": 75.0 },
  "onTime": { "numerator": 24, "denominator": 32, "rate": 75.0, "basis": "CHECK_IN_VS_SCHEDULED_START" },
  "serviceDuration": { "sample": 28, "averageMinutes": 94, "basis": "CHECK_OUT_MINUS_CHECK_IN_DONE_ONLY" },
  "dataQuality": { "doneMissingCheckOut": 1, "activeMissingCheckIn": 0, "invalidDuration": 0 },
  "capabilities": { "reviews": false, "income": false, "disputes": false },
  "snapshot": { "id": "perf-20261102T030000Z-7f3a", "asOf": "2026-11-02T03:00:00.000Z" }
}
```

**Validation:** `from <= to`, tối đa 366 ngày; mẫu số 0 → `rate: null` (không phải 0); `numerator/denominator` luôn kèm để UI kiểm chứng.
**Lỗi:** 400/401/403/413/503.
**Nghiệm thu:**

- Công thức khớp `staff-performance-model.ts` (regression test đối chiếu cùng fixture).
- `cancelled` bị loại khỏi mẫu số `completion`.
- `DONE` thiếu `checkOutAt` không thành 0 phút.
- Snapshot nhất quán giữa `counts` và các rate.
- Không đọc giá booking/`unitPrice`.

---

## 3. Thông báo — owner đề xuất: TV1 (`user-service`) hoặc service thông báo riêng

> Chưa có service thông báo. Cần nhóm chốt owner trước khi triển khai.
>
> **Hiện trạng schema (2026-11-02):** bảng `notifications` chỉ có `id, user_id, booking_id, content, read_at, created_at`, 0 dòng. Contract dưới đây cần migration bổ sung tối thiểu `type`, `title`, `link`, `source_event_id` và unique `(user_id, type, source_event_id)`; nếu owner chọn không thêm cột thì phải chốt cách suy `type`/`link` từ `booking_id` và ghi rõ trong tài liệu API.

### 3.1. `GET /api/v1/staff/me/notifications?page&pageSize&type&unreadOnly` — PROPOSED

```json
{
  "data": [
    { "id": "9001", "type": "JOB", "title": "Bạn được phân công việc mới",
      "body": "Đơn #9109131 lúc 09:00 03/11/2026", "createdAt": "2026-11-02T02:00:00.000Z",
      "readAt": null, "link": "/don/12345" }
  ],
  "pagination": { "page": 1, "pageSize": 20, "total": 1, "totalPages": 1 },
  "unreadCount": 1
}
```

**Validation:** `type ∈ {JOB, SCHEDULE, INCOME, REVIEW, SYSTEM, SUPPORT}`; `link` chỉ đường dẫn nội bộ đã whitelist (`/don/:id`, `/lich-lam-viec`, `/thu-nhap`, `/thanh-tich`, `/ho-tro`); `pageSize ≤ 50`.
**Lỗi:** 400/401/403/503.
**Nghiệm thu:**

- Chỉ trả thông báo của actor; không có tham số chọn người nhận.
- Không rò rỉ nội dung của nhân viên khác qua `link`/`body`.
- Thứ tự `createdAt desc, id desc` ổn định khi phân trang.

### 3.2. `POST /api/v1/staff/me/notifications/:notificationId/read` — PROPOSED

**Body:** `{}` + `Idempotency-Key`.
**Nghiệm thu:**

- Đánh dấu đã đọc lần hai trả cùng kết quả, không lỗi.
- Thông báo của người khác → `404`.
- `readAt` do server set, không nhận từ client.
- Sự kiện nguồn trùng không sinh hai thông báo: unique `(recipientId, type, sourceEventId)`.

---

## 4. Thu nhập — owner `payment-service` (TV5)

Chi tiết đầy đủ tại [STAFF_INCOME_ACCEPTANCE_CONTRACT_PROPOSAL.md](STAFF_INCOME_ACCEPTANCE_CONTRACT_PROPOSAL.md). Tóm tắt PROPOSED:

### 4.1. `GET /api/v1/staff/me/income/report?from&to&periodBasis&sourceType&settlementState` — PROPOSED

```json
{
  "period": { "from": "2026-11-01", "to": "2026-11-30", "periodBasis": "RECOGNIZED_AT", "timezone": "Asia/Ho_Chi_Minh", "currency": "VND" },
  "snapshot": { "id": "inc-20261102T030000Z-1a2b", "asOf": "2026-11-02T03:00:00.000Z" },
  "recognitionSummary": { "totalSigned": "1250000.00", "entryCount": 18 },
  "settlementOfRecognizedCohort": { "settledSigned": "800000.00", "outstandingSigned": "450000.00" },
  "cashflowSummary": { "confirmedSigned": "700000.00", "confirmedAt": "2026-11-01T10:00:00.000Z" },
  "entries": [
    { "entryId": "501", "sourceType": "ASSIGNMENT_COMPLETION", "assignmentId": "12345",
      "amount": "150000.00", "recognizedAt": "2026-11-01T09:30:00.000Z",
      "recognitionState": "APPROVED", "settlementState": "PARTIALLY_SETTLED" }
  ],
  "pagination": { "page": 1, "pageSize": 20, "total": 18, "totalPages": 1 },
  "capabilities": { "settlement": true, "cashflow": true }
}
```

**Điều kiện chặn:** phải có quyết định §A.2 (đơn giá, mốc ghi nhận, kỳ chốt sổ, làm tròn, enum trạng thái, quyền duyệt, nguồn xác nhận đã trả). **Chưa có** → không triển khai.
**Nghiệm thu:** không đếm trùng entry; tiền `DECIMAL` dạng chuỗi; tổng do server tính; `settlement ≠ cashflow`; entry người khác → 404.

---

## 5. Đánh giá khách hàng — owner `review-service` (TV5/TV3)

### 5.1. `GET /api/v1/staff/me/reviews?from&to&page&pageSize` — PROPOSED

```json
{
  "data": [
    { "reviewId": "7001", "assignmentId": "12345", "rating": 5,
      "comment": "Nhân viên đúng giờ.", "createdAt": "2026-11-01T10:00:00.000Z",
      "verified": true, "customerDisplayName": "Khách Q1" }
  ],
  "summary": { "averageRating": 4.7, "reviewCount": 12, "distribution": { "5": 8, "4": 3, "3": 1, "2": 0, "1": 0 } },
  "pagination": { "page": 1, "pageSize": 20, "total": 12, "totalPages": 1 }
}
```

**Validation:** `rating` 1–5; chỉ review `verified` mới vào `averageRating`; `reviewCount` phải khớp tổng; không có review → `averageRating: null`.
**Quyền:** self; `customerDisplayName` đã ẩn danh theo chính sách.
**Nghiệm thu:**

- Không trộn review của nhân viên khác.
- Không tính trung bình từ dữ liệu thiếu/không xác minh.
- Không cho Staff sửa/trả lời review trong phạm vi này.

---

## 6. Hỗ trợ — owner đề xuất: TV4 + Admin

### 6.1. `POST /api/v1/staff/me/support-tickets` — PROPOSED

```json
{ "subject": "Không mở được chi tiết công việc", "priority": "NORMAL",
  "category": "APP", "description": "Mô tả ngắn, không chứa token/mật khẩu." }
```

**Validation:** `subject` 5–150 ký tự; `description` ≤ 2000; `priority ∈ {LOW, NORMAL, HIGH}`; `category ∈ {APP, JOB, SCHEDULE, INCOME, OTHER}`; `Idempotency-Key`.
**Nghiệm thu:** tạo trùng key không sinh hai ticket; nhân viên chỉ thấy ticket của mình; không nhận `employeeId` từ client.

### 6.2. `GET /api/v1/staff/me/support-tickets?status&page&pageSize` — PROPOSED

```json
{
  "data": [
    { "ticketCode": "SP-20261102-0001", "subject": "Không mở được chi tiết công việc",
      "priority": "NORMAL", "status": "IN_PROGRESS", "createdAt": "2026-11-02T02:00:00.000Z",
      "updatedAt": "2026-11-02T04:00:00.000Z", "lastReplyAt": "2026-11-02T03:30:00.000Z" }
  ],
  "pagination": { "page": 1, "pageSize": 20, "total": 1, "totalPages": 1 }
}
```

**Trạng thái (owner chốt):** `NEW → IN_PROGRESS → RESOLVED → CLOSED`; mở lại chỉ khi chính sách cho phép.
**Nghiệm thu:** enum đúng; ticket của người khác → 404; lịch sử phản hồi chỉ đọc nếu API hỗ trợ.

---

## 7. Ma trận PROPOSED (tổng hợp)

| # | Endpoint PROPOSED | Method | Owner | Ưu tiên | Phụ thuộc |
| --- | --- | --- | --- | --- | --- |
| 1 | `/api/v1/staff/me/service-areas` | GET | staff-service (TV4) | P1 | `branches.service_area` |
| 2 | `/api/v1/staff/me/availability` | GET | staff-service (TV4) | P1 | `employee_availability` |
| 3 | `/api/v1/staff/me/availability-requests` | POST | staff-service (TV4) | P2 | Quyết định ca/duyệt |
| 4 | `/api/v1/staff/me/performance` | GET | staff-service (TV4) | P1 | Công thức đã thống nhất |
| 5 | `/api/v1/staff/me/notifications` | GET | TV1/service mới | P2 | Owner + chống trùng |
| 6 | `/api/v1/staff/me/notifications/:id/read` | POST | TV1/service mới | P2 | Idempotency |
| 7 | `/api/v1/staff/me/income/report` | GET | payment-service (TV5) | P3 | 7 quyết định tài chính |
| 8 | `/api/v1/staff/me/reviews` | GET | review-service (TV5/TV3) | P3 | Review API + xác minh |
| 9 | `/api/v1/staff/me/support-tickets` | POST | TV4 + Admin | P4 | Bảng/API ticket |
| 10 | `/api/v1/staff/me/support-tickets` | GET | TV4 + Admin | P4 | Phân quyền self |

---

## 8. Điều Frontend sẽ làm ngay khi contract được duyệt

1. Thêm typed client + schema validation ở BFF (không tin DTO).
2. UI states: loading / empty / error / 403 / 404 / 5xx / retry.
3. Regression test cho công thức, phân trang, A/B isolation, timezone.
4. Chỉ bật REAL khi API trả `capabilities` tương ứng; không fallback DEMO.
5. Giữ DEMO tách biệt, có nhãn, tắt hoàn toàn ở production.
