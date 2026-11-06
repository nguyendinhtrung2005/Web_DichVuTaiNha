# STAFF BUG AUDIT — CleanHome Staff Frontend

- **Ngày audit:** 2026-11-01 (lượt 2: chẩn đoán Auth Backend + QA thật)
- **Phạm vi:** `frontend/apps/staff` + `frontend/packages/ui` (chỉ phần Staff)
- **Branch / HEAD:** `feat/staff-rebuild` / `4c0d737`
- **Môi trường:** Node v24.21.0, Next.js 16 (App Router), React 19, TypeScript, Webpack, `http://localhost:3002`
- **Tính chất:** Git worktree riêng `CleanHome_Staff_Rebuild`, không phải repository độc lập.
- **Kết luận:** **READY_WITH_LIMITATIONS** — đăng nhập thật và các chức năng đọc đã PASS; còn 1 gap Backend (Order Service) và một số hạng mục chưa chạy.

> Chỉ ghi lỗi đã **chứng minh được**. Hạng mục không chạy được ghi `NOT_RUN` kèm lý do. Không in mật khẩu, JWT, cookie, token, private key hay nội dung `.env`.

---

## 1. Nguyên nhân chính xác của Auth startup failure

### Triệu chứng

```
.env not found. Continuing without it.
auth_startup_failed
CONFIGURATION_KEY_OR_DATABASE_UNAVAILABLE
```

### Kết luận: **thiếu `.env` do sai working directory**, không phải lỗi khóa JWT hay Database

Bằng chứng đo trực tiếp (chỉ in phân loại an toàn):

| Thư mục chạy | Kết quả chẩn đoán |
| --- | --- |
| `CleanHome_Staff_Rebuild\backend\auth-service` (worktree) | `.env not found` → `{"ok":false,"kind":"MISSING_CONFIG","variable":"JWT_ISSUER"}` |
| `Web_DichVuTaiNha\backend\auth-service` (repo gốc) | `{"ok":true,"port":4001,"refreshEnabled":true,"dbConnected":true,"schemaOk":true}` |

Giải thích chuỗi lỗi:

1. Worktree chỉ có `.env.example` và **không có `secrets/`** (đều là file gitignored, không được đưa vào worktree).
2. Script chạy `node --env-file-if-exists=.env src/server.js` → Node in `.env not found`.
3. `loadConfig()` ném `Missing configuration: JWT_ISSUER` (biến bắt buộc đầu tiên được kiểm tra).
4. `src/server.js` bắt **mọi** lỗi của `runtime()` bằng một `catch` chung và in `CONFIGURATION_KEY_OR_DATABASE_UNAVAILABLE`.
   → Mã lỗi này là **catch-all**, không chứng minh khóa hay DB hỏng.

Đã loại trừ từng khả năng:

| Khả năng | Kết quả |
| --- | --- |
| Không tìm thấy `.env` | **ĐÚNG — nguyên nhân gốc** (worktree) |
| Thiếu biến bắt buộc | Hệ quả trực tiếp: `JWT_ISSUER`, `MYSQL_USER`, `MYSQL_DATABASE`, … |
| Sai/thiếu khóa JWT | **Không** — repo gốc nạp private key + refresh store OK |
| Sai cấu hình Auth BFF | **Không** — BFF dùng mặc định `http://127.0.0.1:4001`, renewal tắt |
| MySQL chưa chạy | **Không** — service `MySQL96` Running, cổng 3306 LISTEN |
| Database/schema chưa sẵn sàng | **Không** — `dbConnected: true`, `schemaOk: true` trên `cleanhome_staff_test` |
| Cổng 4001 bị chiếm | **Không** — 4001 free trước khi khởi động |
| Sai working directory | **ĐÚNG** — tiến trình lỗi chạy từ worktree, nơi không có `.env`/`secrets` |

Ghi chú về log cũ xuất hiện đường dẫn `Web_DichVuTaiNha\backend\auth-service`: worktree có `node_modules` là **junction** trỏ về repo gốc, nên `--watch` in đường dẫn thật của dependency; điều này không chứng minh cwd là repo gốc.

### Cách khắc phục đã thực hiện

- Khởi động Auth/Order/Staff Service **từ repo gốc** (nơi có `.env` + `secrets/` QA hợp lệ), **không sửa source**, **không copy secret** sang worktree, **không tạo khóa mới**.
- Log service ghi ra `%TEMP%`, không vào repo.
- Xác nhận sẵn sàng bằng `/health/ready` (không chỉ TCP).

---

## 2. Trạng thái Backend và Database

| Thành phần | Cổng | Trạng thái | Bằng chứng |
| --- | --- | --- | --- |
| Auth Service | 4001 | **UP / READY** | `/health/ready` → `{"status":"ready","service":"auth-service"}`; DB + schema OK |
| Order Service | 4003 | **UP / READY** | `/health/ready` → `{"status":"ready","service":"order-service"}` |
| Staff Service | 4005 | **UP / READY** | `/health/ready` → `{"status":"ready","capabilities":{"mysqlReads":true,...}}` |
| MySQL96 | 3306 | **UP** | Windows service Running; Auth/Staff/Order kết nối `cleanhome_staff_test` |
| Staff Frontend | 3002 | **UP** | `GET /` và `/dang-nhap` → 200 |

PID đang chạy: auth 8616, order 8136, staff 23684, frontend 4068 (tiến trình dev của người dùng, không bị dừng).

---

## 3. Nguyên nhân lỗi login 503 `AUTH_UNAVAILABLE`

- BFF `auth-core.mjs` ánh xạ lỗi kết nối/5xx từ Auth thành `503 AUTH_UNAVAILABLE`.
- Vì Auth Service không khởi động được (mục 1), mọi lần login đều rơi vào nhánh này.
- Sau khi Auth chạy đúng: login trả **200**, không còn 503.
- `GET /api/auth/session` khi chưa đăng nhập trả **401 `SESSION_REQUIRED`** — đúng hợp đồng.
- Lỗi 503 `SESSION_STORE_UNAVAILABLE` trước đây (đường dẫn keyFile) vẫn đang được xử lý đúng bằng `.env.local` ghim tuyệt đối; không tạo lại/ghi đè `session.key`.

---

## 4. Đăng nhập thật — **REAL_PASS**

Thực hiện qua Staff BFF `http://localhost:3002` với credential QA giải mã trong bộ nhớ (không in ra):

| Kịch bản | Kết quả | Chi tiết |
| --- | --- | --- |
| Sai mật khẩu | **PASS** | `401 INVALID_CREDENTIALS`, không cấp cookie |
| Đúng mật khẩu (tài khoản A) | **PASS** | `200`, cấp cookie, `EMPLOYEE / ACTIVE`, userId `9109002`, có `expiresAt` |
| F5 / tải lại (dùng lại cookie) | **PASS** | `GET /api/auth/session` → `200`, đúng userId |
| Logout | **PASS** | `200`, cookie bị xoá (`Max-Age=0`), session sau đó `401 SESSION_EXPIRED` |
| Tài khoản B (cách ly A/B) | **PASS** | `200`, userId riêng `9109101`, session riêng |
| Sai mật khẩu trên Chrome thật | **PASS 7/7** | Ở lại `/dang-nhap`, giữ SĐT, **xoá mật khẩu**, thông báo "Số điện thoại hoặc mật khẩu chưa đúng", **không** hiện banner "chưa khả dụng", nút submit dùng lại được, 0 exception |

Chrome E2E thật (10/10 PASS): mở form → đăng nhập → Dashboard → UC9 → UC10 → UC11 → Lịch sử → Thống kê → F5 giữ phiên → responsive 4 breakpoint → logout.

Không có mutation: log Order Service chỉ có `GET`, log Staff Service chỉ có `GET` (`/jobs`, `/jobs/:id`, `/schedule`). Không PATCH trạng thái, không ghi DB.

---

## 5. Lỗi Frontend phát hiện và đã sửa

### Lượt này: **0 lỗi sản phẩm mới**

Các triệu chứng người dùng báo đều được xác minh là **đã hết** sau khi Backend hoạt động:

- Không còn banner "Dịch vụ đăng nhập hiện chưa khả dụng" trên form.
- Sai mật khẩu: mật khẩu bị xoá, không tự điền lại trong Chrome test; SĐT giữ nguyên.
- Không còn 503 khi login.

### Lượt trước (giữ nguyên, chưa commit) — 5 lỗi đã sửa

| ID | Mức | Lỗi | Trạng thái |
| --- | --- | --- | --- |
| P1-01 | P1 | Banner dịch vụ hiện trên form login do recheck session nền nhận 5xx | Đã sửa (provider không set error khi form anonymous) |
| P1-02 | P1 | Mật khẩu tự điền lại sau đăng nhập thất bại (Chrome password manager) | Đã sửa (remount `PasswordField` sau thất bại) — native PM `NOT_RUN` |
| P2-01 | P2 | `SESSION_STORE_UNAVAILABLE` bị gộp thông báo với Auth outage | Đã sửa (tách thông báo) |
| P2-02 | P2 | Test Chrome fail giả do assertion phụ thuộc ID hiển thị | Đã sửa |
| P3-01 | P3 | Harness coi request dashboard sau login là lỗi | Đã sửa (observation) |

**Nguyên nhân mật khẩu tự điền lại (giữ nguyên kết luận):** không phải React state/remount/revalidation/Backend; app xoá đúng `value=""`. Nguyên nhân là Chrome password manager re-apply giá trị đã lưu khi field được re-enable. Mitigation: remount field. Không kiểm soát tuyệt đối password manager; cần kiểm thủ công.

---

## 6. File đã chỉnh sửa

| File | Loại | Thay đổi |
| --- | --- | --- |
| `frontend/packages/ui/src/components/staff/staff-auth-session.tsx` | Source | `statusRef`; không báo lỗi nền khi form anonymous; tách thông báo `SESSION_STORE_UNAVAILABLE` |
| `frontend/packages/ui/src/components/staff/staff-login.tsx` | Source | Remount `PasswordField` sau submit thất bại |
| `frontend/apps/staff/test/auth-session-ui.test.mjs` | Test | Assert không còn banner nền |
| `frontend/apps/staff/test/auth-form-browser.integration.mjs` | Test | Sửa assertion; thêm regression banner/password; business-call thành observation |
| `frontend/apps/staff/docs/STAFF_BUG_AUDIT.md` | Docs | Báo cáo này |

**Không sửa:** Backend, Auth/Refresh contract, JWT, cookie policy, MySQL, Customer, Admin, `session.key`, `next-env.d.ts` (giữ nguyên trạng thái modified có sẵn).

**Lượt này không thêm thay đổi source mới** — chỉ chẩn đoán, khởi động service và kiểm thử.

---

## 7. Unit / Typecheck / Build

| Hạng mục | Kết quả |
| --- | --- |
| Unit toàn bộ Staff (49 file, không integration) | **604 PASS / 0 FAIL / 0 SKIP** (21.8s) |
| `npm run typecheck` (`tsc --noEmit`) | **PASS** |
| Production build `next build --webpack` | **PASS** — compiled 4.7s, TypeScript 2.6s, 13 worker, không OOM |
| Dev server sau build | Vẫn `200` (`/` và `/dang-nhap`) |

`next-env.d.ts` được khôi phục đúng nội dung trước build (`.next/dev/types/...`).

---

## 8. Chrome QA

| Hạng mục | Kết quả |
| --- | --- |
| Real login E2E (Auth/Order/Staff thật) | **10/10 PASS**, 0 exception, 0 console error |
| Route pass với phiên thật: 16 route × 4 breakpoint | **64/64 render**, `overflowX = 0`, 0 alert, 0 exception, 0 console error |
| Sai mật khẩu thật (regression triệu chứng) | **7/7 PASS** |
| DEMO_OFF (mặc định) | **REAL_PASS** — các module hiện "chưa khả dụng / chưa được cấu hình", không giả dữ liệu thật |
| DEMO_ON | **NOT_RUN** — cần restart dev server với cờ `STAFF_*_DEMO_ENABLED=true`; không dừng server của người dùng |
| Native Chrome password manager | **NOT_RUN** — cần chọn credential đã lưu thủ công |
| Production HTTP/HTTPS | **NOT_RUN** |
| UC12 mutation | **NOT_RUN** — không PATCH fixture QA |

**Route đã kiểm tra thật:** `/`, `/dang-nhap`, `/dang-ky`, `/cong-viec`, `/don/9109113`, `/lich-lam-viec`, `/lich-su`, `/thong-ke-cong-viec`, `/thu-nhap`, `/ho-so`, `/thong-bao`, `/khu-vuc`, `/thanh-tich`, `/ho-tro`, `/cai-dat`, `/khong-ton-tai`.

Khi đã đăng nhập, `/dang-nhap` và `/dang-ky` tự điều hướng về `/` (đúng hành vi route protection).

Dữ liệu thật quan sát được: UC9 trả 29 phân công (2 trang, pageSize 20), filter `ASSIGNED` đúng, UC11 lịch tuần 26/10–01/11/2026, UC10 chi tiết phân công #9109113, lịch sử và thống kê render dữ liệu API thật.

---

## 9. Tính năng Backend còn thiếu

### Order Service thiếu endpoint cho lịch sử chi tiết công việc

Staff Service gọi:

- `GET /internal/v1/bookings/:bookingId/staff-context`
- `POST /internal/v1/bookings/staff-context/batch`

Order Service hiện chỉ có:

- `GET|PUT /internal/v1/bookings/:bookingId/assignment-transitions/:operationId`
- `POST .../acknowledgement`
- `GET /internal/v1/assignment-transitions/pending`

Bằng chứng: Order Service trả **404** cho `GET /internal/v1/bookings/9109111/staff-context` (17 lần trong một lượt xem chi tiết). Hệ quả:

- `jobDetail.historySource = "order-service-unavailable"`.
- UI hiển thị notice "Chưa tải được lịch sử…" và vẫn render đầy đủ thông tin công việc (fail-soft đúng thiết kế, không crash, không lộ dữ liệu giả).

Đây là **gap Backend thuộc thành viên Order Service**, không sửa trong phạm vi Frontend Staff.

### Các phần chưa tích hợp (giữ DEMO/disabled)

Thu nhập, Thông báo, Khu vực & Ca làm, Thành tích & Đánh giá, Hỗ trợ: chưa có API thật → giữ trạng thái disabled/DEMO, không giả lập.

---

## 10. Git status

```
 M frontend/apps/staff/next-env.d.ts                        (modified có sẵn — giữ nguyên)
 M frontend/apps/staff/test/auth-form-browser.integration.mjs
 M frontend/apps/staff/test/auth-session-ui.test.mjs
 M frontend/packages/ui/src/components/staff/staff-auth-session.tsx
 M frontend/packages/ui/src/components/staff/staff-login.tsx
?? frontend/apps/staff/docs/STAFF_BUG_AUDIT.md
```

- Branch `feat/staff-rebuild`, HEAD `4c0d737`, **không commit / push / merge**.
- Không `reset`, `stash`, `clean`, không `git add .`.
- Không sửa file source nào trong repo gốc `Web_DichVuTaiNha`. Repo gốc đang có nhiều thay đổi staged/untracked **có sẵn của thành viên khác** (263 mục) — giữ nguyên, không đụng tới.
- Service chạy từ repo gốc chỉ đọc source; log ghi ra `%TEMP%`; dữ liệu phiên refresh ghi vào thư mục `secrets/` đã gitignore (hành vi runtime bình thường).
- Không đưa `.env.local`, `.auth-data`, `session.key`, screenshot, cookie, token, log hay browser profile vào Git.
- Lưu ý bảo mật: nếu BFF token từng bị lộ trong log cũ → **cần rotate** bởi người phụ trách Auth (không in lại giá trị).

### Cách khởi động lại môi trường local (không chứa secret)

```powershell
# 1) Auth Service (bắt buộc có .env + secrets)
cd "E:\DACN\du an chinh\Web_DichVuTaiNha\backend\auth-service"
npm.cmd start

# 2) Staff Service
cd "E:\DACN\du an chinh\Web_DichVuTaiNha\backend\staff-service"
npm.cmd start

# 3) Order Service
cd "E:\DACN\du an chinh\Web_DichVuTaiNha\backend\order-service"
npm.cmd start

# 4) Staff Frontend (Webpack)
cd "E:\DACN\du an chinh\CleanHome_Staff_Rebuild\frontend\apps\staff"
npm.cmd run dev -- --webpack
```

Kiểm tra: `http://127.0.0.1:4001/health/ready`, `:4003/health/ready`, `:4005/health/ready` phải trả 200.

---

## 11. Vấn đề cần thành viên Backend phối hợp

1. **Order Service**: bổ sung `GET /internal/v1/bookings/:bookingId/staff-context` và `POST /internal/v1/bookings/staff-context/batch` (hoặc chốt lại contract và cập nhật `order-client.js`). Hiện chi tiết công việc luôn ở trạng thái "lịch sử chưa tải được".
2. **Cấu hình QA cho worktree**: worktree `backend/*` không có `.env`/`secrets/`. Nếu muốn chạy Backend ngay trong worktree, cần thành viên Backend cung cấp bộ cấu hình QA an toàn (qua kênh riêng, không commit). Nếu không, tiếp tục chạy từ repo gốc như hướng dẫn trên.
3. **Dọn tiến trình lỗi**: đang có một tiến trình `node --watch src/server.js` khởi động từ worktree (không có `.env`) và fail lặp lại. Nên dừng tiến trình này và dùng lệnh ở mục 10.
4. **Rotate credential** nếu BFF token từng bị lộ (không in lại giá trị).
5. **UC12**: cần fixture an toàn được phê duyệt trước khi kiểm thử mutation thật.

---

## 12. Kết luận

**READY_WITH_LIMITATIONS**

**Đã đạt:**
- Xác định đúng nguyên nhân Auth startup failure (thiếu `.env`/`secrets` do chạy từ worktree), không phải lỗi khóa hay DB.
- Auth/Order/Staff Service và MySQL đều READY; `/health/ready` 200.
- **Đăng nhập thật REAL_PASS** (đúng/sai mật khẩu, F5, logout, A/B isolation).
- Dashboard, UC9, UC10, UC11, Lịch sử, Thống kê render dữ liệu thật; 64/64 route pass 4 breakpoint, không tràn ngang, 0 exception.
- 604/604 unit PASS, typecheck PASS, production build PASS.
- Không mutation, không ghi DB, không đụng fixture QA.

**Giới hạn còn lại:**
1. Order Service thiếu endpoint `staff-context` → lịch sử chi tiết công việc hiển thị cảnh báo (Backend blocker).
2. DEMO_ON, native password manager, HTTPS production, UC12 mutation: **NOT_RUN** (có lý do).
3. Worktree Backend không tự chạy được nếu không có cấu hình QA; phải chạy từ repo gốc.

**Điều kiện nâng lên READY:** Backend bổ sung endpoint `staff-context`, chạy DEMO_ON/OFF có kiểm soát, kiểm thủ công password manager, xác minh HTTPS và UC12 theo phê duyệt.
