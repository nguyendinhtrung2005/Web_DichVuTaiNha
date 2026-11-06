# CleanHome Staff - Báo cáo nghiệm thu tổng thể cuối

- **Ngày:** 2026-10-31
- **Worktree:** `E:\DACN\du an chinh\CleanHome_Staff_Rebuild`
- **Nhánh / HEAD:** `feat/staff-rebuild` / `93f61bcd116f2531867e9d873572ee3a4f36f7d1`
- **Kết luận:** **READY_WITH_LIMITATIONS** (sẵn sàng bàn giao phần Frontend Staff đã có Backend; các module DEMO và các contract còn thiếu được ghi rõ, không tuyên bố REAL_E2E cho API chưa tồn tại)
- **Lượt QA không sửa/không commit source sản phẩm.** Chỉ commit cục bộ hai tài liệu nghiệm thu; không push, không merge. Không sửa Backend, MySQL, Customer, Admin, Auth/Refresh/BFF, UC9-UC12.

## 1. Phạm vi và môi trường kiểm thử

| Hạng mục | Giá trị |
| --- | --- |
| Backend QA | auth-service `4001`, order-service `4003`, staff-service `4005`; DB `cleanhome_staff_test` |
| Preview DEMO_ON | Next dev (webpack) `http://localhost:3153`, 7 cờ `STAFF_*_DEMO_ENABLED=true`, `NODE_ENV=development` |
| Preview DEMO_OFF | Next dev (webpack) `http://localhost:3154`, toàn bộ 7 cờ `false` |
| Production runtime | `next start` `http://127.0.0.1:3155`, `NODE_ENV=production`, toàn bộ 7 cờ `false`, **HTTP only** |
| Tài khoản QA | A `9109002` / B `9109101` (mật khẩu đọc từ vault, không ghi vào tài liệu/log) |
| Trình duyệt | Chrome headless qua CDP, viewport 375 / 390 / 768 / 1440 |

Mọi request ghi ngoài `/api/auth/login`, `/api/auth/logout`, `/api/auth/renew` đều bị chặn ở tầng trang (guard `fetch`/XHR) và `Network.setBlockedURLs` cho cổng `4001/4003/4005` và `/internal/*`. Không PATCH, không seed, không reset dữ liệu QA.

## 2. Kết quả tổng hợp

| Hạng mục | Kết quả |
| --- | --- |
| Unit test Staff (49 file, không gồm integration) | **604 PASS / 0 FAIL / 0 SKIP** |
| 7 file integration test (auth-http, auth-lifecycle, jobs-http, jobs-lifecycle, job-detail-http, schedule-http, status-http) | **NOT_RUN** (7/7) |
| `npm run typecheck` | **PASS** |
| Production build (`next build --webpack`, 1 worker) | **PASS**, `BUILD_ID=elPV7XXnMPUkOQf9Qz5vL` |
| Chrome tổng hợp DEMO_ON + DEMO_OFF | **38/38 PASS** (core 7, modules 10, site 10, off 11) |
| Chrome production runtime (HTTP, DEMO_OFF) | **11/11 PASS** |
| Exception JS / lỗi console nghiêm trọng | 0 / 0 |
| Request ghi bị chặn (`blockedWrites`) | 0 |
| Request tới cổng Backend trực tiếp hoặc `/internal/*` | 0 |
| Ảnh chứng cứ | 42 (DEMO_ON/OFF) + 14 (production runtime) |

### Phân bố unit test

| Nhóm | Số test |
| --- | --- |
| Auth / BFF / session UI | 114 |
| UC9 jobs | 63 |
| UC10 job detail | 42 |
| UC11 schedule | 45 |
| UC12 status | 121 |
| Navigation | 12 |
| Dashboard / history / statistics / qa-relay / uc12-backup | 53 |
| Thu nhập (income demo + isolation) | 26 |
| Hồ sơ | 27 |
| Thông báo | 24 |
| Khu vực | 25 |
| Thành tích | 17 |
| Hỗ trợ | 16 |
| Cài đặt | 19 |
| **Tổng** | **604** |

## 3. Danh sách route và trạng thái

| Route | Nội dung | Nguồn dữ liệu | Trạng thái nghiệm thu |
| --- | --- | --- | --- |
| `/` | Tổng quan (4 chỉ số, liên kết nhanh) | REAL - tổng hợp UC9/UC11 | PASS (REAL) |
| `/cong-viec` | Danh sách công việc (UC9) | REAL - `/api/staff/jobs` | PASS (REAL) |
| `/lich-lam-viec` | Lịch làm việc (UC11) | REAL - `/api/staff/schedule` | PASS (REAL) |
| `/don/:id` | Chi tiết công việc (UC10) + khối trạng thái (UC12) | REAL - `/api/staff/jobs/:id` | PASS (REAL, chỉ hiển thị UC12) |
| `/lich-su` | Lịch sử công việc | REAL - `/api/staff/jobs` (trạng thái kết thúc) | PASS (REAL) |
| `/thong-ke-cong-viec` | Thống kê công việc (6 chỉ số) | REAL - `pagination.total` của schedule | PASS (REAL) |
| `/ho-so` | Hồ sơ: danh tính thật + khối minh họa | REAL + DEMO | PASS (REAL + DEMO) |
| `/thu-nhap` | Thu nhập | DEMO (chưa có API) | PASS (DEMO) / DEMO_OFF hiển thị "chưa hỗ trợ" |
| `/khu-vuc` | Khu vực và ca làm | DEMO | PASS (DEMO) / DEMO_OFF "chưa hỗ trợ" |
| `/thanh-tich` | Thành tích: đánh giá minh họa + thống kê thật | DEMO + REAL | PASS (DEMO + REAL) |
| `/ho-tro` | Hỗ trợ (ticket minh họa) | DEMO (chưa có API Admin) | PASS (DEMO) / REAL_E2E NOT_RUN |
| `/cai-dat` | Cài đặt: hiển thị lưu trên trình duyệt + tùy chọn cấp tài khoản | LOCAL (trình duyệt) + DEMO | PASS (LOCAL + DEMO) |
| `/thong-bao` | Thông báo | DEMO | PASS (DEMO) / REAL_E2E NOT_RUN |
| `/dang-nhap` | Đăng nhập | REAL - `/api/auth/*` | PASS (REAL) |
| `/dang-ky` | Thông tin cấp tài khoản (không tự đăng ký) | Tĩnh | PASS |
| `*` | Fallback 404 | Tĩnh | PASS ("Trang không tồn tại") |

## 4. Ma trận PASS / FAIL / NOT_RUN

| Hạng mục | PASS | FAIL | NOT_RUN |
| --- | --- | --- | --- |
| Auth: deep link, giữ `next`, session, logout | 1 | 0 | 0 |
| 7 file integration test (HTTP/lifecycle) | 0 | 0 | 7 |
| Dashboard REAL | 1 | 0 | 0 |
| UC9 danh sách, phân trang, revalidation, query rác | 1 | 0 | 0 |
| UC10 chi tiết + UC12 hiển thị (không mutation) | 1 | 0 | 1 (UC12 mutation) |
| UC11 lịch làm việc REAL | 1 | 0 | 0 |
| Lịch sử + thống kê REAL | 1 | 0 | 0 |
| 7 module DEMO (empty/error/loading, reset, F5) | 7 | 0 | 0 |
| Cô lập A/B (dữ liệu thật + DEMO) | 1 | 0 | 0 |
| Toàn website: sidebar, bottom nav 5 mục, deep link, back/forward, 404 | 2 | 0 | 0 |
| Responsive 375/390/768/1440 (12 route x 4) | 4 | 0 | 0 |
| Keyboard / dialog / Escape / Enter / focus | 1 | 0 | 0 |
| Bảo mật mạng: không ghi DEMO, không cổng trực tiếp, storage sạch | 1 | 0 | 0 |
| DEMO_OFF: 7 module ẩn dữ liệu + nhãn | 7 | 0 | 0 |
| DEMO_OFF: UC9/UC10/UC11/lịch sử/thống kê vẫn thật | 1 | 0 | 0 |
| DEMO_OFF: preference hiển thị lưu local | 1 | 0 | 0 |
| DEMO_OFF: không ghi DEMO + logout | 1 | 0 | 0 |
| Production runtime HTTP (DEMO_OFF) | 11 | 0 | 0 |
| Production HTTPS | 0 | 0 | 1 |
| REAL_E2E Hỗ trợ (ticket Admin) | 0 | 0 | 1 |
| REAL_E2E Cài đặt cấp tài khoản | 0 | 0 | 1 |
| REAL_E2E Thu nhập / Khu vực / Thành tích / Thông báo | 0 | 0 | 4 |
| REAL_E2E UC12 mutation | 0 | 0 | 1 |

## 5. Bằng chứng

### 5.1 Artifact tổng hợp DEMO_ON + DEMO_OFF

`frontend/apps/staff/.auth-data/final-qa-f6f4ef96-cff1-46e1-a5fd-a51b7040c586/browser-b697328d-a5e5-4c8d-b623-d5224e90711c`

| Report | Scope | Kết quả | Request | Non-200 | Ảnh |
| --- | --- | --- | --- | --- | --- |
| `final-qa-core-report.json` | core | CORE_PASS 7/7 | 105 | chỉ `session 401` x5 | - |
| `final-qa-modules-report.json` | modules | MODULES_PASS 10/10 | 113 | chỉ `session 401` x11 | - |
| `final-qa-site-report.json` | site | SITE_PASS 10/10 | 331 | chỉ `session 401` x5 | 28 ảnh responsive |
| `final-qa-off-report.json` | off | DEMO_OFF_PASS 11/11 | 126 | chỉ `session 401` x5 | 14 ảnh DEMO_OFF |
| `preservation.json` | - | PASS | - | - | - |

- Request ghi duy nhất: `POST /api/auth/login`, `POST /api/auth/logout`.
- `consoleErrors=0`, `exceptions=0`, `blockedWrites=0`, `ports` chỉ `3153/3154`.
- 8 lần F5 thật trong scope `modules` (`Page.reload` có xác nhận `performance.timeOrigin` đổi), 0 fallback.
- `preservation.json`: `originalGitUnchanged=true`, `stagedPaths=235`, `adminCssUnchanged=true`, `head=93f61bc...`, `configAndSessionKeyUnchanged=true`, `sourceSnapshotVerified=true`.

### 5.2 Artifact production runtime (HTTP)

`frontend/apps/staff/.auth-data/prod-qa-1edbbad5-fe66-4582-829e-7fb59484b10b/browser-1c37394f-4053-4d55-99a6-92e3c79ea25e`

- `final-qa-prod-off-report.json`: **DEMO_OFF_PASS 11/11**, 77 request, non-200 chỉ `session 401` x5, 0 exception, 0 console error, 0 blocked write, 14 ảnh.
- Server: `next start`, `NODE_ENV=production`, 7 cờ DEMO `false`, cổng `3155`, bind `127.0.0.1`.

### 5.3 Phân tích bundle production

- Ở bundle client production, adapter DEMO đã bị fold thành `kind:"unavailable"` (`kind:"demo"` xuất hiện **0** lần); các root chỉ tồn tại khi DEMO bật (`data-staff-areas-demo`, `data-profile-demo`, `data-staff-notifications-demo`) **không có** trong bundle.
- Các cờ DEMO đều yêu cầu đồng thời `NODE_ENV === "development"` **và** biến môi trường `= "true"`, nên production không thể bật bằng URL/cookie/localStorage.
- Tồn dư (P3): một số chuỗi fixture minh họa vẫn nằm trong bundle dưới dạng dead code (`DEMO-INCOME*`, `DEMO-AREA-CENTRE`, `Nguyễn Minh Anh`, nhãn "DỮ LIỆU MINH HỌA"). Không có đường thực thi, dữ liệu là hư cấu và đã được ghi rõ là DEMO.

## 6. Chi tiết theo nhóm chức năng

### 6.1 Auth và phiên

- Deep link `/cong-viec` khi chưa đăng nhập -> `/dang-nhap?next=%2Fcong-viec`, đăng nhập xong quay lại đúng đích.
- Session thật đối chiếu `/api/auth/session` (`user.id`, `role=EMPLOYEE`).
- Logout xoá phiên: `/api/auth/session` trả `401`.
- Production: cấu hình phiên sai (giá trị dev như `STAFF_SESSION_RENEWAL_ENABLED=true`, `STAFF_SESSION_ABSOLUTE_SECONDS=604800` khi chạy production) bị `config.mjs` từ chối -> API trả `503 SESSION_UNAVAILABLE`; UI hiển thị đúng "Chưa thể kiểm tra phiên đăng nhập" + "Thử lại", không lộ dữ liệu DEMO. Đây là hành vi đúng (fail-closed).

### 6.2 UC9 - Danh sách công việc

- 5 dòng duy nhất theo `data-assignment-id`, phân trang `page/pageSize/sort`.
- Điều hướng đi rồi quay lại có revalidation thật (số request `/api/staff/jobs` tăng).
- Query rác (`page=abc&pageSize=999&sort=weird&status=NOPE`) được chuẩn hoá, không lỗi, không tràn ngang.

### 6.3 UC10 + UC12

- Mở chi tiết theo `assignmentId` của chính tài khoản A (loại trừ fixture QA `9109131/9109141/9109151-9109156`).
- `data-assignment-detail-id` khớp, `GET /api/staff/jobs/:id` trả `200`.
- Khối `[data-staff-status-panel]` có đúng 4 bước `[data-progress-step]`, trạng thái `complete|current|upcoming`, đúng 1 bước `current`.
- Không có request ghi nào lên `/api/staff/jobs*`. **UC12 mutation: NOT_RUN** (không PATCH dữ liệu QA thật).

### 6.4 UC11 - Lịch làm việc

- API trả `200`, `timezone=Asia/Ho_Chi_Minh`; UI render `[data-schedule-day]` có `data-schedule-assignment-id`.

### 6.5 Lịch sử và thống kê

- `/lich-su`: `[data-history-loaded]`, tổng số bản ghi hiển thị.
- `/thong-ke-cong-viec`: đúng 6 `[data-statistic]` từ `pagination.total` (không cộng dồn trang).

### 6.6 Bảy module DEMO

| Module | Kiểm tra | Kết quả |
| --- | --- | --- |
| Thu nhập | 4 chỉ số, tổng `3420000`, chi tiết, Escape, reset, F5 | DEMO_PASS |
| Hồ sơ | danh tính thật theo `accountId`, khối minh họa, shortcut, không lộ PII, F5 | DEMO_PASS |
| Thông báo | 10 thông báo, đọc chi tiết, Escape, reset, F5 | DEMO_PASS |
| Khu vực | ca minh họa, chi tiết, đăng ký, Escape, reset, F5 | DEMO_PASS |
| Thành tích | trung bình `3.8`, 12 đánh giá, lọc 5 sao + submit, chi tiết, reset, F5, thống kê thật | DEMO_PASS |
| Hỗ trợ | 4 ticket, validate form, tạo `DEMO-SUP-005`, phản hồi mẫu, lọc, reset, F5 | DEMO_PASS |
| Cài đặt | 2 lớp (local thật + DEMO), che tên, reset, F5, "Đổi mật khẩu: Chưa hỗ trợ" | DEMO_PASS |

- Cô lập A/B: ticket nháp của A không xuất hiện ở B và ngược lại; preference hiển thị của B không kế thừa A; PII của B không lộ ở A.

### 6.7 Toàn website

- Sidebar desktop: 8 liên kết (5 chính + 3 phụ), `aria-current="page"` đúng.
- Bottom nav mobile: đúng 5 mục, active theo route.
- Deep link, `history.back()`, `history.forward()` đúng; 404 hiển thị "Trang không tồn tại".
- Responsive 375/390/768/1440 trên 12 route: không tràn ngang (`scrollWidth <= clientWidth`), đúng 1 `h1`, font Be Vietnam Pro.
- Keyboard: Enter mở dialog, focus vào trong `[role=dialog]`, Escape đóng và trả focus về nút mở; Space toggle checkbox giữ focus.
- Storage: không có `accessToken/refreshToken/password/cookie/PII` trong `localStorage`/`sessionStorage`.

### 6.8 DEMO_OFF

- 7 module không render dữ liệu/nhãn DEMO, hiển thị trạng thái "chưa hỗ trợ" trung thực.
- UC9/UC10/UC11/lịch sử/thống kê vẫn lấy dữ liệu thật; preference hiển thị vẫn lưu/khôi phục local.
- Không request ghi DEMO, logout sạch.

## 7. Lỗi phát hiện

| Mức | Nội dung | Trạng thái |
| --- | --- | --- |
| P0 | Không có | - |
| P1 | Không có | - |
| P2 | Không có | - |
| P3 | Bundle production còn chuỗi fixture minh họa dạng dead code | Đã ghi nhận, khuyến nghị tách/strip khi build |
| P3 | `staff-service` trả `503` tạm thời cho `/api/staff/schedule` trong một lượt sweep 1440 trước đó | UI hiển thị lỗi + "Thử lại" đúng; lượt tổng hợp cuối không tái hiện |
| P3 | Production HTTPS chưa dựng được runtime TLS an toàn | NOT_RUN, ghi rõ nguyên nhân |

Không có lỗi Frontend nào phải sửa trong mã nguồn sản phẩm ở lượt này. Các lỗi gặp phải đều thuộc harness kiểm thử (selector/giả định sai, `returnByValue` trên DOM node, cách xác nhận F5) và đã sửa trong harness, không đụng source.

## 8. Bảo mật Frontend và route policy

- Route Staff-only: chưa đăng nhập -> `/dang-nhap` kèm `next`; không có route Admin/Customer bị lộ qua Staff.
- Không có request tới `4001/4003/4005` hay `/internal/*` từ trình duyệt; toàn bộ đi qua BFF `/api/*`.
- Không in/lưu credential trong artifact; báo cáo JSON không chứa token/mật khẩu.
- `config.mjs` fail-closed: production từ chối cấu hình phiên không hợp lệ, từ chối origin không HTTPS ngoài localhost.

## 9. Nợ production và REAL_E2E

1. **Production HTTPS: NOT_RUN.** Lý do: không dựng runtime TLS an toàn trong phạm vi cho phép (không sửa cert/secret/.env của dự án). Đã kiểm chứng production ở mức HTTP (`next start`, `NODE_ENV=production`, DEMO_OFF) đạt 11/11.
2. **REAL_E2E Hỗ trợ: NOT_RUN.** Thiếu API ticket Admin (tạo/đọc/phản hồi/đóng).
3. **REAL_E2E Cài đặt cấp tài khoản: NOT_RUN.** Thiếu API thông báo, quyền riêng tư, đổi mật khẩu, thiết bị/phiên.
4. **REAL_E2E Thu nhập / Khu vực / Thành tích / Thông báo: NOT_RUN.** Chưa có API tương ứng; hiện là DEMO có nhãn rõ ràng và tự tắt ở production.
5. **UC12 mutation: NOT_RUN.** Không PATCH dữ liệu QA thật; chỉ nghiệm thu phần hiển thị.
6. **7 file integration test: NOT_RUN.** `auth-http`, `auth-lifecycle`, `jobs-http`, `jobs-lifecycle`, `job-detail-http`, `schedule-http`, `status-http` cần Backend/DB thật và có ghi dữ liệu, nằm ngoài phạm vi lượt này nên không chạy.

Chi tiết contract còn thiếu: xem [STAFF_BACKEND_INTEGRATION_GAPS.md](STAFF_BACKEND_INTEGRATION_GAPS.md).

## 10. Git và bảo toàn

| Kiểm tra | Kết quả |
| --- | --- |
| Worktree `CleanHome_Staff_Rebuild` | sạch trước khi tạo tài liệu; sau đó chỉ có 2 file tài liệu mới trong 1 commit cục bộ |
| HEAD worktree trước commit | `93f61bcd116f2531867e9d873572ee3a4f36f7d1` |
| Commit tài liệu | `docs(staff): finalize frontend QA and backend integration gaps` (xem `git log -1`) |
| Repo gốc `Web_DichVuTaiNha` | HEAD `afc5d78b993ec379ba9a9a3c5ab87059dfe2930b`, 235 staged path, không bị QA sửa |
| `portal.css` - staged (index vs HEAD) | **+57 dòng** (khối CSS login dùng chung) |
| `portal.css` - unstaged (worktree vs index) | **+13 dòng** (khối `.ch-admin-auth`, thay đổi chưa stage của chủ repo) |
| File QA | chỉ trong `.auth-data/` (đã gitignore) và thư mục TEMP |
| `next-env.d.ts` | bị `next dev` sinh lại trong lúc chạy, đã khôi phục đúng nội dung HEAD |

Hai số `+57` và `+13` không mâu thuẫn: `+57` là diff **đã stage** (index so với HEAD), `+13` là diff **chưa stage** (worktree so với index) của cùng file. Index repo gốc giữ nguyên từ 2026-10-27 và file `portal.css` không đổi từ 2026-10-17, nên QA không làm thay đổi repo gốc.

Không chạy `git add .`, không reset/stash/clean, không push/merge. Chỉ stage đúng hai tài liệu nghiệm thu.

## 11. Kết luận

- Frontend Staff đã có: Auth/session, Dashboard, UC9, UC10, UC11, UC12 (hiển thị), lịch sử, thống kê và 7 module minh họa có nhãn DEMO, tắt được hoàn toàn bằng cờ môi trường.
- Chất lượng: 604 unit test PASS, typecheck PASS, production build PASS, 38/38 kiểm thử Chrome tổng hợp PASS, 11/11 production runtime HTTP PASS, không exception, không console error, không request ghi ngoài auth.
- **READY_WITH_LIMITATIONS**: bàn giao được phần đã có Backend; các module còn lại chỉ ở mức DEMO và cần Backend contract (mục 9) trước khi tuyên bố REAL_E2E. Production HTTPS vẫn là điều kiện bắt buộc trước khi phát hành thật.
