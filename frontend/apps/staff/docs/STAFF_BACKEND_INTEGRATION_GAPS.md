# CleanHome Staff - Khoảng trống tích hợp Backend và contract còn thiếu

- **Ngày:** 2026-10-31
- **Phạm vi:** Frontend Staff trong worktree `CleanHome_Staff_Rebuild` (HEAD `93f61bc`)
- **Mục đích:** Liệt kê chính xác phần Frontend đang chạy bằng dữ liệu thật, phần đang DEMO, và contract Backend cần có để chuyển từng module sang REAL. Tài liệu này bổ sung cho [STAFF_BACKEND_IMPLEMENTATION_REQUESTS.md](STAFF_BACKEND_IMPLEMENTATION_REQUESTS.md) (phân công theo nhóm) và [STAFF_FINAL_QA_REPORT.md](STAFF_FINAL_QA_REPORT.md) (kết quả nghiệm thu).

## 1. Tổng quan khoảng trống

| Module / Route | Hiện trạng Frontend | Backend hiện có | Cần bổ sung | Ưu tiên |
| --- | --- | --- | --- | --- |
| Auth, phiên, logout | REAL | auth-service + BFF `/api/auth/*` | không | - |
| Dashboard `/` | REAL (tổng hợp UC9/UC11) | staff-service | không | - |
| UC9 `/cong-viec` | REAL | `GET /api/staff/jobs` | không | - |
| UC10 `/don/:id` | REAL | `GET /api/staff/jobs/:id` | không | - |
| UC11 `/lich-lam-viec` | REAL | `GET /api/staff/schedule` | không | - |
| UC12 (khối trạng thái) | REAL hiển thị | `GET /api/staff/jobs/:id/status` | API đổi trạng thái + idempotency + audit | P0 |
| Lịch sử `/lich-su` | REAL (lọc từ jobs) | `GET /api/staff/jobs` | bộ lọc thời gian/trạng thái phía server (tuỳ chọn) | P2 |
| Thống kê `/thong-ke-cong-viec` | REAL | `GET /api/staff/schedule` | không | - |
| Thu nhập `/thu-nhap` | DEMO | **chưa có** | Income API | P1 |
| Khu vực & ca `/khu-vuc` | DEMO | **chưa có** | Areas + shift registration API | P1 |
| Thành tích `/thanh-tich` | DEMO + thống kê thật | **chưa có** review API | Review/achievement API | P2 |
| Thông báo `/thong-bao` | DEMO | **chưa có** | Notification API | P1 |
| Hỗ trợ `/ho-tro` | DEMO | **chưa có** ticket API | Support ticket API (kèm phía Admin) | P0 |
| Hồ sơ `/ho-so` | REAL danh tính + DEMO phụ | một phần (session user) | Profile API đầy đủ | P1 |
| Cài đặt `/cai-dat` | LOCAL (trình duyệt) + DEMO cấp tài khoản | **chưa có** | Settings/privacy/password/device API | P1 |

## 2. Contract đề xuất

Quy ước chung cho mọi endpoint dưới đây:

- Xác thực qua BFF session (`cleanhome_staff_session`), scope luôn là nhân viên đang đăng nhập; **không** nhận `employeeId` từ client.
- `id` dạng BIGINT trả về **chuỗi**; tiền tệ trả về **chuỗi số nguyên VND** (không dùng float).
- Thời gian ISO-8601 UTC, kèm `timezone: "Asia/Ho_Chi_Minh"` ở payload có ngày giờ.
- Phân trang: `{ page, pageSize, total, items }`; `total` là tổng trên toàn bộ tập đã lọc.
- Lỗi: `{ code, message, retryAfter? }` với HTTP tương ứng; `409` cho xung đột phiên bản/idempotency.
- Mọi thao tác ghi nhận `Idempotency-Key` (UUID) và ghi audit (`actorId`, `action`, `targetId`, `before/after`).

### 2.1 UC12 - Đổi trạng thái công việc (P0)

```
PATCH /api/staff/jobs/:assignmentId/status
Body: { targetStatus: "ACCEPTED"|"IN_PROGRESS"|"DONE", expectedVersion: number, note?: string }
Headers: Idempotency-Key
200: { assignmentId, status, version, allowedStatus: string[], updatedAt }
409: { code: "ASSIGNMENT_CHANGED"|"IDEMPOTENCY_CONFLICT", current: {...} }
422: { code: "TRANSITION_NOT_ALLOWED", allowedStatus: string[] }
```

- Máy trạng thái: `ASSIGNED -> ACCEPTED -> IN_PROGRESS -> DONE`, `CANCELLED` là trạng thái cuối.
- Bắt buộc kiểm tra quyền sở hữu assignment và phiên bản để tránh ghi đè.
- Frontend đã có sẵn UI xác nhận, xử lý `ASSIGNMENT_CHANGED`, retry theo `idempotencyKey`; chỉ thiếu endpoint và hợp đồng lỗi.

### 2.2 Hỗ trợ - Ticket (P0)

```
POST   /api/staff/support/tickets            { topic, priority, subject, content, relatedJob? }
GET    /api/staff/support/tickets            ?status=&page=&pageSize=   -> kèm counts theo status
GET    /api/staff/support/tickets/:id        -> chi tiết + messages[]
POST   /api/staff/support/tickets/:id/messages { content }
POST   /api/staff/support/tickets/:id/close  { reason? }
```

- `topic`: `SCHEDULE|INCOME|ACCOUNT|APP|OTHER`; `priority`: `LOW|NORMAL|HIGH`.
- Giới hạn độ dài và chặn email/số điện thoại trong nội dung (frontend đã validate; backend phải validate lại).
- Phía Admin cần API tương ứng để phản hồi/đóng ticket; nếu chưa có, module phải tiếp tục là DEMO và **không** ghi lên Backend.
- Trạng thái: `NEW -> IN_PROGRESS -> ANSWERED -> CLOSED`.

### 2.3 Thông báo (P1)

```
GET  /api/staff/notifications            ?filter=all|unread&page=&pageSize=
GET  /api/staff/notifications/unread-count
GET  /api/staff/notifications/:id
POST /api/staff/notifications/:id/read
POST /api/staff/notifications/read-all
```

- Loại: `SHIFT|JOB|SUPPORT|SYSTEM|INCOME`; trả `readAt` (null nếu chưa đọc).
- `read-all` phải idempotent và trả số bản ghi vừa cập nhật.

### 2.4 Thu nhập (P1)

```
GET /api/staff/income?from=YYYY-MM-DD&to=YYYY-MM-DD&granularity=day|week|month&source=&status=&page=&pageSize=
GET /api/staff/income/summary?from=&to=
GET /api/staff/income/:id
```

- Trả `items[]` với `{ id, source, reference, description, amountVnd, recognizedAt, status, paidAt }` và `summary { total, paid, pending, count }`.
- `from/to` theo ngày Việt Nam (UTC+7), `to` bao gồm cả ngày.
- Không suy ra tiền công từ booking ở frontend; mọi phép tính do Backend thực hiện.
- Nếu chưa có API, module giữ DEMO và tự tắt ở production (hiện đúng như vậy).

### 2.5 Khu vực và ca làm (P1)

```
GET    /api/staff/areas
GET    /api/staff/shifts?weekFrom=YYYY-MM-DD
GET    /api/staff/shifts/:id
POST   /api/staff/shifts/:id/registrations      Idempotency-Key
DELETE /api/staff/shifts/:id/registrations
GET    /api/staff/area-preferences
PUT    /api/staff/area-preferences              { selectedAreaIds: string[], available: boolean }
```

- Ca trả `{ id, areaId, startAt, endAt, capacity, registered, status }`; đăng ký phải kiểm tra trùng giờ, sức chứa, ca đã bắt đầu.
- `409 SHIFT_FULL|SHIFT_STARTED|OVERLAP` để UI hiển thị đúng lý do.

### 2.6 Thành tích và đánh giá (P2)

```
GET /api/staff/reviews?stars=&from=&to=&page=&pageSize=
GET /api/staff/reviews/summary?from=&to=     -> { average, total, distribution }
GET /api/staff/reviews/:id
```

- `stars` 1-5, `average` trả số thực đã làm tròn 1 chữ số; `distribution` là số lượng theo từng mức sao.
- Chỉ đánh giá của chính nhân viên; không lộ danh tính khách hàng ngoài phạm vi cho phép.

### 2.7 Hồ sơ (P1)

```
GET   /api/staff/profile
PATCH /api/staff/profile        { displayName?, avatar?, bio? }   (chỉ trường được phép)
```

- Danh tính lõi (id, role, employeeId) lấy từ session, không cho client sửa.
- Trả đủ trường hiển thị: `fullName, employeeCode, phone (masked), email (masked), joinedAt, areaName, avatar`.

### 2.8 Cài đặt cấp tài khoản (P1)

```
GET   /api/staff/settings/notifications
PATCH /api/staff/settings/notifications   { shiftReminder?, supportUpdates?, weeklyDigest? }
GET   /api/staff/settings/privacy
PATCH /api/staff/settings/privacy         { maskPreviewName? }
POST  /api/staff/password/change          { currentPassword, newPassword }
GET   /api/staff/devices
DELETE /api/staff/devices/:id
GET   /api/staff/sessions
DELETE /api/staff/sessions/:id
```

- Đổi mật khẩu: kiểm tra mật khẩu hiện tại, độ mạnh, thu hồi phiên khác; trả `204` hoặc lỗi `400 WEAK_PASSWORD|WRONG_PASSWORD`.
- Thiết bị/phiên: trả `{ id, name, platform, lastSeenAt, current }`, không trả token.
- Preference hiển thị (mật độ, giảm chuyển động, cỡ chữ, focus) **vẫn ở local** theo thiết kế; không cần API.

## 3. Yêu cầu phi chức năng

| Hạng mục | Yêu cầu |
| --- | --- |
| Phân quyền | Mọi endpoint Staff chỉ trả dữ liệu của nhân viên trong session; test A/B phải 404/403 chéo |
| Idempotency | Bắt buộc cho UC12, đăng ký ca, tạo ticket, đọc tất cả thông báo |
| Audit | Ghi log thao tác ghi, không chứa mật khẩu/token |
| Hiệu năng | UC9/UC11/UC10 p95 < 800ms trong mạng nội bộ QA; danh sách ≤ 20 dòng/trang |
| Tính nhất quán | `total` không đổi giữa 2 trang liên tiếp trong cùng bộ lọc (hoặc trả `snapshotAt`) |
| Bảo mật | Không trả PII không cần thiết; mask số điện thoại/email; rate limit theo tài khoản |
| Lỗi | Mã lỗi ổn định để frontend hiển thị đúng; `Retry-After` cho 429/503 |

## 4. Điều kiện để đóng từng khoảng trống

1. Backend triển khai endpoint + contract ở mục 2 trên môi trường QA `cleanhome_staff_test`.
2. Frontend chuyển adapter của module từ `demo` sang `remote`, giữ nguyên cờ `STAFF_*_DEMO_ENABLED` để rollback tức thời.
3. Bổ sung unit test contract/HTTP/UI cho module (theo mẫu `jobs-*`, `schedule-*`).
4. Chạy lại Chrome E2E thật (không dùng BFF double), xác nhận A/B isolation và không có request ghi ngoài phạm vi.
5. Chỉ khi đó mới đổi trạng thái từ `DEMO`/`NOT_RUN` sang `REAL_PASS` trong báo cáo nghiệm thu.

## 5. Nợ production và REAL_E2E

| Nợ | Trạng thái | Điều kiện đóng |
| --- | --- | --- |
| Production HTTPS | NOT_RUN | Dựng runtime TLS (cert hợp lệ, `STAFF_APP_ORIGIN=https://...`), bật `STAFF_SESSION_RENEWAL_ENABLED=true`, chạy lại bộ Chrome 38 kiểm tra |
| REAL_E2E Hỗ trợ | NOT_RUN | Có API ticket + API Admin phản hồi |
| REAL_E2E Cài đặt cấp tài khoản | NOT_RUN | Có API settings/privacy/password/device |
| REAL_E2E Thu nhập / Khu vực / Thành tích / Thông báo | NOT_RUN | Có API tương ứng (mục 2.3-2.6) |
| UC12 mutation | NOT_RUN | Có endpoint 2.1 và fixture QA được duyệt riêng để PATCH |
| Tồn dư fixture DEMO trong bundle production (P3) | Đã ghi nhận | Tách module DEMO khỏi entry production hoặc strip bằng biến build |

## 6. Ghi chú vận hành

- Cấu hình production là **fail-closed**: `lib/server/config.mjs` từ chối khởi tạo phiên nếu origin không HTTPS (ngoài localhost) hoặc giá trị phiên vượt ngưỡng production. Khi đó API trả `503 SESSION_UNAVAILABLE` và UI hiển thị lỗi trung thực; đây là hành vi mong đợi, không phải lỗi Frontend.
- Bảy cờ `STAFF_INCOME_DEMO_ENABLED`, `STAFF_PROFILE_DEMO_ENABLED`, `STAFF_NOTIFICATIONS_DEMO_ENABLED`, `STAFF_AREAS_DEMO_ENABLED`, `STAFF_ACHIEVEMENTS_DEMO_ENABLED`, `STAFF_SUPPORT_DEMO_ENABLED`, `STAFF_SETTINGS_DEMO_ENABLED` chỉ có hiệu lực khi `NODE_ENV=development`; production luôn tắt.
- Không có cơ chế nào cho phép bật DEMO bằng URL, cookie hay localStorage.
