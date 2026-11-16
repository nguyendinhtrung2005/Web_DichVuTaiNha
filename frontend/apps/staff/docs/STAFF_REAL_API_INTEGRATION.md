# CleanHome Staff — Tích hợp API thật: trạng thái và bằng chứng

> Cập nhật 04/11/2026: xem [STAFF_PRIORITIES_20261104.md](STAFF_PRIORITIES_20261104.md) cho chính sách DEMO_V2 và triển khai local mới. Nội dung ngày 02/11 bên dưới giữ làm bằng chứng lịch sử; endpoint pending hiện có lấy source làm chuẩn. DEMO không phải payroll/ledger đã được TV5 duyệt.


- **Ngày:** 2026-11-02
- **Worktree:** `CleanHome_Staff_Rebuild`, nhánh `feat/staff-rebuild`, checkpoint `c8dec00`
- **Phạm vi:** chỉ Frontend Staff + BFF Staff. Không sửa Backend, schema, seed hay dữ liệu MySQL.
- **Quy ước trạng thái:**
  - **REAL_PASS** — chạy bằng API thật, đã kiểm chứng.
  - **PARTIAL** — chỉ một phần dữ liệu có nguồn thật.
  - **DEMO_PASS** — module minh hoạ có nhãn, test pass, không gọi API.
  - **BLOCKED** — thiếu API hoặc thiếu quyết định nghiệp vụ.

---

## 1. Cách kiểm chứng

| Bước | Cách làm | Kết quả |
| --- | --- | --- |
| Dịch vụ Backend | `GET /health/ready` trên cổng 4001/4003/4005 | Lượt kiểm chứng gần nhất: cả 3 trả `200` (`auth-service`, `order-service`, `staff-service`) |
| Đăng nhập thật | BFF `/api/auth/login` bằng tài khoản QA | REAL_PASS (đã chạy ở phiên trước, xem [STAFF_BUG_AUDIT.md](STAFF_BUG_AUDIT.md)) |
| Gọi dữ liệu thật | BFF `/api/staff/jobs`, `/api/staff/schedule`, `/api/staff/jobs/:id` | REAL_PASS (UC9/UC10/UC11) |
| Chuyển trạng thái | PATCH qua BFF với `Idempotency-Key` trên fixture QA được phép | REAL_PASS (UC12, phiên trước) |
| Unit + typecheck + build | Chạy trong lượt này | **PASS** (xem §6) |
| E2E Chrome / HTTP integration | 3 service + MySQL + Staff production (`next start`) trên `http://localhost:3002` | **REAL_PASS** — đăng nhập UI thật, đọc chỉ số thật, A/B, responsive, empty/error/retry (xem §6) |

> Ghi chú trung thực: lượt này đã khởi động lại Auth 4001, Order 4003, Staff 4005 và MySQL QA, chạy Staff ở production (`npm start`, không bật cờ DEMO). Mọi số liệu REAL dưới đây đọc từ API thật của tài khoản QA; hai nhánh không thể tạo bằng dữ liệu QA (cảnh báo timestamp thiếu/sai thứ tự, kỳ >500 dòng) được kiểm tra bằng cách chặn response **ở phía trình duyệt** (chỉ đọc, không ghi DB) và được ghi rõ là mô phỏng phía client.

---

## 2. Module nào đang chạy bằng API thật

| Module / Route | Trạng thái | Nguồn thật | BFF route | Ghi chú |
| --- | --- | --- | --- | --- |
| Đăng nhập, phiên, logout | **REAL_PASS** | `auth-service` `/api/v1/auth/login|refresh|logout|introspect` | `/api/auth/*` | Cookie `HttpOnly`, token chỉ ở server |
| Dashboard `/` | **REAL_PASS** | `staff-service` jobs + schedule | `/api/staff/jobs`, `/api/staff/schedule` | Tổng hợp UC9/UC11 |
| UC9 `/cong-viec` | **REAL_PASS** | `GET /api/v1/staff/jobs` | `/api/staff/jobs` | Lọc `status`, phân trang, sort |
| UC10 `/don/:id` | **REAL_PASS** | `GET /api/v1/staff/jobs/:assignmentId` | `/api/staff/jobs/[assignmentId]` | Lịch sử booking = `null` (`data.historySource: order-service-unavailable`, cảnh báo `ORDER_HISTORY_UNAVAILABLE`) |
| UC11 `/lich-lam-viec` | **REAL_PASS** | `GET /api/v1/staff/schedule` | `/api/staff/schedule` | `from/to` theo ngày Việt Nam, tối đa 366 ngày |
| UC12 khối trạng thái | **REAL_PASS** | `PATCH /api/v1/staff/jobs/:assignmentId/status` | `/api/staff/jobs/[assignmentId]/status` | Cần `Idempotency-Key`; chỉ trên fixture QA được phép |
| `/thong-ke-cong-viec` | **REAL_PASS** | `GET /api/v1/staff/schedule` (chỉ đọc `pagination.total`) | `/api/staff/schedule` | Mỗi trạng thái = một request độc lập, không trộn snapshot |
| `/thanh-tich` — khối "Thống kê phân công thật" | **REAL_PASS (mới)** | `GET /api/v1/staff/schedule` (đọc toàn bộ trang trong kỳ) | `/api/staff/schedule` | Chỉ số vận hành dẫn xuất, xem §3 |
| `/thanh-tich` — điểm sao, huy hiệu, mục tiêu | **DEMO_PASS** | Không có API | — | Chỉ bật ở development + cờ DEMO; REAL hiển thị "Đánh giá chưa được cung cấp" |
| `/khu-vuc` | **DEMO_PASS** | Không có API (`employee_availability`, `branches.service_area` chỉ có bảng) | — | Không ghi dữ liệu thật |
| `/thong-bao` | **BLOCKED** | Không có API (chỉ có bảng `notifications`) | — | REAL: trạng thái chưa khả dụng |
| `/thu-nhap` | **BLOCKED** | `payment-service` rỗng | — | Không có công thức được duyệt |
| `/ho-tro` | **DEMO_PASS** | Không có API | — | Form DEMO trong bộ nhớ trang |
| `/cai-dat` | **LOCAL_ONLY** | Tuỳ chọn hiển thị trình duyệt | — | Không phải dữ liệu nghiệp vụ |
| Hồ sơ cá nhân | **PARTIAL** | Session identity (`id`, role, status) | `/api/auth/session` | Không có API đọc/sửa hồ sơ đầy đủ |

---

## 3. Khối chỉ số vận hành mới (dùng dữ liệu thật)

### 3.1. Luồng đọc

```
Trang /thanh-tich (client)
  └─ StaffPerformanceSection
       └─ readStaffPerformance()            [staff-performance-remote-model.ts]
            └─ GET /api/staff/schedule?from&to&page&pageSize=100&sort=asc
                 └─ BFF (session → Bearer token server)
                      └─ GET /api/v1/staff/schedule (staff-service)
       └─ summarizeStaffPerformance()       [staff-performance-model.ts]
```

### 3.2. Quy tắc đọc

- Chỉ đọc `pageSize=100`, tối đa 5 trang (500 assignment). Vượt → `413 RANGE_TOO_LARGE`, UI yêu cầu chọn khoảng ngắn hơn.
- `pagination.total` phải nhất quán giữa các trang; thay đổi giữa chừng → `409 TOTAL_CHANGED`, không trả số liệu ghép.
- `total` trả về mà số dòng đọc được không khớp → `502 INVALID_RESPONSE` (dữ liệu không nhất quán), không cắt bớt.
- Response phải là `application/json`, tối đa 2 MiB; sai content-type/JSON → `502`.
- Timeout 20 giây; `AbortController` huỷ khi đổi kỳ hoặc rời trang.
- 401/403 → gọi `checkSession()` để BFF/phiên tự xử lý; không hiển thị DEMO thay thế.
- Kỳ mặc định: tháng hiện tại theo `Asia/Ho_Chi_Minh`; kỳ dựa trên `scheduled_start` giao với khoảng ngày, không dựa trên ngày hoàn tất.

### 3.3. Công thức (một nguồn duy nhất)

Xem [STAFF_BUSINESS_SPEC.md](STAFF_BUSINESS_SPEC.md) §5.1. Tóm tắt:

| Chỉ số | Công thức | Mẫu số 0 |
| --- | --- | --- |
| `completionRate` | `DONE / (total − CANCELLED)` | `null` |
| `onTimeRate` | `checkInAt ≤ scheduledAt` trên số dòng có đủ cả hai mốc | `null` |
| `averageServiceMinutes` | trung bình `checkOutAt − checkInAt` của `DONE` hợp lệ | `null` |

### 3.4. Điều khối này **không** làm

- Không đọc `services.unitPrice`, không đọc `total_amount`, không suy thu nhập.
- Không coi `DONE` là khách đã nghiệm thu/đã thanh toán.
- Không gọi đó là KPI/thưởng; UI ghi rõ "chỉ số vận hành".
- Không hiển thị 0% khi chưa có dữ liệu.

### 3.5. Đối chiếu số liệu thật (lượt 2026-11-02)

Kỳ mặc định tháng 2026-11 (`Asia/Ho_Chi_Minh`), đọc qua BFF bằng phiên của chính từng nhân viên. Số liệu dưới đây vừa tính độc lập từ assignment trong MySQL QA, vừa đối chiếu với chữ hiển thị trên `/thanh-tich`.

| Chỉ số | Nhân viên A (user `9109002` / employee `9109004`) | Nhân viên B (user `9109101` / employee `9109102`) |
| --- | --- | --- |
| Tổng phân công trong kỳ | 5 | 5 |
| Phân công `DONE` | 5 | 5 |
| `completionRate` | `100,0%` (5/5, không có `CANCELLED`) | `100,0%` (5/5) |
| `onTimeRate` | `100,0%` (5/5 có đủ `scheduledAt` + `checkInAt`) | `100,0%` (5/5) |
| `averageServiceMinutes` | `0 phút` (5 mẫu, chênh lệch ~1 giây) | `0 phút` (5 mẫu) |
| Cảnh báo chất lượng dữ liệu | Không hiển thị (0 thiếu check-out / 0 thiếu check-in / 0 mốc sai) | Không hiển thị |
| Tổng assignment toàn bộ lịch sử (`/api/staff/jobs`) | 29 (16 `DONE`) | 27 (10 `DONE`) |

- `0 phút` là số thật, không phải fallback: dữ liệu QA có `check_in_at`/`check_out_at` cùng ngày 2026-10-24 và cách nhau khoảng 1 giây, trước cả ngày hẹn.
- Tập `assignmentId` của A (`9109175/177/179/181/183`) và B (`9109176/178/180/182/184`) rời nhau hoàn toàn; không ID nào của A xuất hiện trong nội dung trang của phiên B (kể cả `/cong-viec`).
- Kỳ 2025-06 (không có phân công) hiển thị "Không có phân công nào…" và không bịa tỷ lệ.
- Khi Staff 4005 dừng: khối hiển thị "Số liệu chưa đọc được…" + nút `Thử lại`, không có tỷ lệ giả; sau khi 4005 sẵn sàng lại, `Thử lại` trả về `5 phân công` / `100,0%`.
- Cảnh báo dữ liệu (mô phỏng phía client): chèn 1 `DONE` thiếu check-out, 1 `DONE` thiếu check-in, 1 mốc check-out trước check-in → hiện đúng "1 … thiếu check-out, 1 … thiếu check-in, 1 mốc thời gian không hợp lệ", và các dòng đó không bị tính là 0 phút/đúng giờ.
- Kỳ >500 dòng (mô phỏng phía client): đọc đủ 5 trang rồi báo "Khoảng thời gian có quá nhiều phân công … (tối đa 500)", không trả tỷ lệ một phần.

---

## 4. Hợp đồng lỗi BFF → UI

| Nguồn | BFF trả | UI hiển thị |
| --- | --- | --- |
| Upstream 401 | `401 SESSION_EXPIRED` (huỷ phiên) | "Phiên đăng nhập đã hết hạn…" |
| Upstream 403 | `403 STAFF_ACCESS_DENIED` (huỷ phiên) | "Tài khoản hiện không có quyền…" |
| Upstream 429 | `429 STAFF_RATE_LIMITED` + `Retry-After: 60` | "Vui lòng chờ một lúc rồi thử lại." |
| Upstream 400 | `400 VALIDATION_ERROR` | "Khoảng lịch hẹn chưa hợp lệ…" |
| Upstream ≥500 / timeout | `503 STAFF_UNAVAILABLE` + `Retry-After: 5` | "Số liệu chưa đọc được…" |
| BFF đọc lỗi JSON/sai schema | `502 INVALID_RESPONSE` | "Số liệu chưa đọc được…" |
| Tổng thay đổi giữa trang | `409 TOTAL_CHANGED` | "Dữ liệu vừa thay đổi, thử lại…" |
| Kỳ > 500 dòng | `413 RANGE_TOO_LARGE` | "Chọn khoảng ngắn hơn…" |

Không có trường hợp nào fallback sang DEMO.

---

## 5. Bảo vệ chế độ REAL

| Bảo đảm | Bằng chứng test |
| --- | --- |
| Production luôn tắt mọi cờ DEMO | `*-demo-config.test.mjs`, `settings-demo-config.test.mjs` |
| UI Thành tích không hiển thị sao/huy hiệu DEMO khi DEMO tắt hoặc production | `achievements-demo-ui.test.mjs` |
| Không gọi API chưa được duyệt trong lúc render tĩnh | `achievements-demo-ui.test.mjs` (fetch giả ném lỗi) |
| Chỉ số không lấy giá tiền/dịch vụ | `performance-model.test.mjs` (assert không có `price/salary/revenue/amount`) |
| Mẫu số 0 không thành 0% | `performance-model.test.mjs` |
| Không trả số liệu một phần khi phân trang lệch | `performance-model.test.mjs` (`TOTAL_CHANGED`, `RANGE_TOO_LARGE`) |
| Dữ liệu A/B không lẫn | `jobs-*`, `schedule-*`, `job-detail-*`, `income-isolation.test.mjs` |

---

## 6. Kết quả test (lượt này)

| Hạng mục | Lệnh | Kết quả |
| --- | --- | --- |
| Unit + contract + UI (không gồm integration/browser) | `node --test --test-concurrency=1 test/*.test.mjs` (loại `*integration*`) | **616/616 PASS** |
| Riêng phần mới | `node --test test/performance-model.test.mjs test/achievements-demo-ui.test.mjs` | **16/16 PASS** |
| Typecheck | `npm run typecheck` | **PASS** |
| Build Webpack | `npm run build` | **PASS** (13 route, `ƒ /[[...slug]]`) |
| Chrome E2E — đăng nhập + chỉ số thật | Chrome headless qua CDP, Staff production `localhost:3002` | **PASS** — 5 phân công / DONE 5 / 100,0% / 100,0% / 0 phút, loading skeleton có `aria-busy` |
| Chrome E2E — responsive | 375 / 390 / 768 / 1440 | **PASS** — `scrollWidth ≤ innerWidth`, không nút bị cắt/che, nút ≥ 24px |
| Chrome E2E — cách ly A/B | Phiên B sau khi đăng nhập lại | **PASS** — không ID nào của A lọt vào `/thanh-tich` hoặc `/cong-viec` của B |
| Chrome E2E — empty / error / retry | Kỳ 2025-06; dừng rồi bật lại Staff 4005 | **PASS** — empty không bịa tỷ lệ; error + `Thử lại`; retry phục hồi `100,0%` |
| Chrome E2E — công thức + deep link | Mở `<details>`, bấm "Mở Thống kê công việc" | **PASS** — 5 dòng định nghĩa; `/thong-ke-cong-viec?from=2026-11-01&to=2026-11-30` render |
| Chrome E2E — trang chưa có API | `/thong-bao`, `/thu-nhap`, `/khu-vuc`, `/ho-tro`, `/cai-dat` | **PASS** — không có nhãn "DỮ LIỆU MINH HỌA" trong production, hiện trạng thái chưa khả dụng |
| Chrome E2E — rò rỉ / gọi thẳng Backend | Theo dõi `Network.*` toàn phiên | **PASS** — 0 request tới 4001/4003/4005 hay `/internal/*`; 0 exception; không lộ credential |
| Console 4xx/5xx | Ghi lại URL lỗi | `401 /api/auth/session` (probe phiên trước đăng nhập, có sẵn từ trước) và `503 /api/staff/schedule` (đúng kịch bản dừng 4005) |

Kết quả phiên trước (giữ nguyên, không chạy lại): Chrome E2E 10/10, sai mật khẩu 7/7, routes 64/64, unit 604/604.

---

## 7. Hạn chế còn lại

1. **Chỉ số vận hành tính ở client** trên tối đa 500 assignment/kỳ; kỳ lớn hơn cần aggregate Backend (PROPOSED).
2. **Không có `completed_at` độc lập** khỏi `check_out_at`; chưa đo được "hoàn thành đúng hạn".
3. **Không có dữ liệu từ chối/tranh chấp/vi phạm** trong DTO assignment.
4. **Không có đánh giá khách hàng** (review-service rỗng) → REAL không hiển thị điểm sao.
5. **Không có lịch sử booking** trong UC10: `staff-service` gọi `GET/POST /internal/v1/bookings/.../staff-context` nhưng Order Service trả **404** (đã kiểm trực tiếp ngày 2026-11-02); UI fail-soft với `data.historySource = order-service-unavailable` và cảnh báo `ORDER_HISTORY_UNAVAILABLE`. Bàn giao cho Order Backend, xem §0.4 của [STAFF_BACKEND_CONTRACT_PROPOSALS.md](STAFF_BACKEND_CONTRACT_PROPOSALS.md).
6. **Khu vực/ca, thông báo, thu nhập, hỗ trợ** không có API → giữ DEMO có nhãn hoặc trạng thái chưa khả dụng.
7. **Kỳ >500 dòng và cảnh báo timestamp** chưa tạo được bằng dữ liệu QA thật (không được ghi DB) — đã phủ bằng unit test và bằng chặn response phía client; khi có aggregate Backend thì kiểm lại bằng dữ liệu thật.
8. **Bàn phím/screen reader** chưa kiểm trong lượt này; mới kiểm layout, vùng bấm và thứ tự hiển thị ở 4 breakpoint.
9. **Không có API đánh giá** (`reviews` 0 dòng, `review-service` rỗng) và **không có API hỗ trợ** (không có bảng ticket). Trang Thành tích/Đánh giá, Hỗ trợ và Cài đặt hiển thị trạng thái chưa khả dụng, không trộn DEMO.

---

## 8. Việc cần làm trước khi merge

1. Chạy lại `test:*:http`, `test:*:browser`, `test:auth:lifecycle` trên fixture QA được phép (lượt này chỉ chạy bộ unit + E2E CDP thủ công).
2. Kiểm bàn phím/focus ring và screen reader cho khối chỉ số vận hành trên `/thanh-tich`.
3. Chốt với nhóm Backend các contract PROPOSED trước khi chuyển module tiếp theo sang REAL.
4. Khi Backend có aggregate theo kỳ, thay cách đọc tối đa 500 dòng ở client và kiểm lại kỳ lớn bằng dữ liệu thật.
