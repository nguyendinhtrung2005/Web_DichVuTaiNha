# CleanHome Staff — QA độc lập

Bộ QA dùng source worktree, database và secret mới. Không dùng `cleanhome_staff_test`, không đọc `.env`/vault/key của repo gốc. Mọi dữ liệu là tổng hợp, chỉ dùng cho QA và báo cáo đồ án.

Chạy tại root worktree bằng PowerShell:

```powershell
.\qa\staff\start.ps1
.\qa\staff\status.ps1
.\qa\staff\test.ps1
.\qa\staff\stop.ps1
```

Nếu máy chặn chạy script, dùng `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\qa\staff\start.ps1` (tương tự cho status/test/stop). Không thay execution policy toàn máy. `test.ps1 -SkipBrowser` chỉ chạy HTTP/MySQL.

Khôi phục bộ QA đã có dataset bằng `node .\qa\staff\runtime.mjs resume-services`: chỉ xác minh môi trường và khởi động service; không bootstrap, seed hoặc migration.

Sau khi sửa riêng Staff Backend, dùng `node .\qa\staff\runtime.mjs refresh-staff`: chỉ dừng/khởi động process Staff có identity khớp bộ QA, kiểm tra readiness; không bootstrap/seed hoặc thay đổi dữ liệu. Frontend vẫn dùng `refresh-frontend` và cấu hình AI QA đã được duyệt nếu cần.

Kiểm tra thẻ đội thực hiện: `$env:RUN_STAFF_ISOLATED_TEAM_QA='true'` rồi `node .\qa\staff\team.browser.mjs`. Suite chỉ đọc dữ liệu nghiệp vụ; chặn mọi mutation thật ngoài login/logout của tài khoản tổng hợp. Một PATCH hoàn thành được giữ và trả response double ngay trong Chrome, không gửi đến BFF/Backend; dùng để kiểm tra loading, chống bấm lặp và tải lại chi tiết. Đội hiện có và phân quyền A/B được kiểm tra thật; chính sách đội 1/2/3 người và cảnh báo phân công lặp trong thu nhập dùng response doubles có nhãn MOCK_PASS. Không gọi AI. [Contract và blocker đủ đội](../../frontend/apps/staff/docs/STAFF_TEAM_EXECUTION_CONTRACT.md).

Mặc định: MySQL `3307`, Auth `4101`, Order `4103`, Staff `4115`, Frontend `http://localhost:3102`. Lần tạo mới tự chọn cổng trống khác nếu cần và lưu cấu hình đồng bộ. Không kill tiến trình để lấy cổng. `status.ps1` cho biết cổng thực tế.

Máy hiện có MySQL Server 9.6 và không có Docker. Script khởi tạo **một mysqld riêng** bằng `--no-defaults`, datadir `.private/mysql/data`, chỉ bind loopback; không chạm service MySQL96/cổng3306. Có thể chỉ định binary qua biến `STAFF_QA_MYSQLD` trước lần start đầu. Cần Node.js hỗ trợ `module.registerHooks` (máy hiện dùng Node24), dependency đã cài của Staff/Auth/Frontend và Chrome cho browser test.

Lần start đầu sinh RSA3072, internal token, session key32byte, mật khẩu MySQL và tài khoản A/B/MANUAL/CUSTOMER bằng `node:crypto`. `.private/` được Git ignore và khóa ACL cho user hiện tại/SYSTEM trên Windows. Không gửi hoặc commit nội dung `.private/`.

Xem credential **trực tiếp trên máy**, không in vào chat/log:

```powershell
.\qa\staff\credentials.ps1
```

Lệnh mở Notepad với `.private/credentials.json`. `config.example.json` không chứa secret. Không sửa/xóa các secret đã sinh để reset dữ liệu; start lại dùng đúng bộ cũ. Seed idempotent và chỉ nhận database/UUID/datadir của bộ QA này.

Backend chạy source worktree, worker đối soát tắt. Frontend chạy `next dev --webpack` với working directory và tracing root nằm trong bản sao **public source có fingerprint** dưới `.private/runtime` để Next không ghi đè WIP/next-env hoặc theo dõi file QA/log của worktree. Chỉ tạo dependency junction trong runtime riêng; không sửa package đã cài trong node_modules. Order dùng đúng phiên bản dependency khớp lockfile.

`test.ps1` gọi HTTP/Chrome thật; report/screenshot nằm trong `.private/reports`. Thu nhập DEMO_V2 chỉ minh họa. HTTP suite chỉ kiểm tra readiness chatbot, không tự gọi provider đã cấu hình; AI thật phải được kiểm tra riêng bằng `support-live.browser.mjs` với ngân sách inference rõ ràng. Review và payout chưa có luồng thật. Các lỗi mạng chủ động tạo phải phân loại `MOCK_PASS`; nội dung hoặc số tiền minh họa không được coi là dữ liệu production.

Sau lỗi QA V8 hết bộ nhớ khi giải nén cache và build tạo 15 worker cùng lúc, snapshot frontend dùng heap tối đa 2048 MB, giới hạn worker bằng `experimental.cpus: 2`, bật tối ưu bộ nhớ Webpack và tắt cache Webpack trong development. Thay đổi nằm ở `frontend-config.mjs` của bộ QA, giữ nguyên cấu hình ứng dụng nguồn và kiểm tra TypeScript. Chạy regression bằng `node --test qa/staff/frontend-config.test.mjs`. Khi nghiệm thu trên máy ít bộ nhớ khả dụng, chạy lần lượt Chrome, unit và build; không dừng các tiến trình ngoài QA để lấy bộ nhớ.

Leaflet với tile OpenStreetMap thật được kiểm tra bằng suite riêng có opt-in. Sau khi sửa Frontend, lệnh refresh chỉ cập nhật bản sao source và khởi động lại Staff Frontend do bộ QA quản lý; **không seed hoặc ghi database**:

```powershell
.\qa\staff\refresh-frontend.ps1
$env:RUN_STAFF_ISOLATED_MAPS_QA='true'
node .\qa\staff\maps.browser.mjs
```

Suite Maps dùng đăng nhập thật, dữ liệu chi nhánh từ Staff BFF và tile thật; không trả response bản đồ giả. Chỉ được ghi nhận `REAL_PASS` khi report của lần chạy thực tế xác nhận marker/vùng/tile hiển thị. Dữ liệu chi nhánh QA là tổng hợp. Xem [cấu hình và chính sách tile](../../frontend/apps/staff/docs/STAFF_MAPS_SETUP.md) trước khi triển khai production.

Stop đối chiếu PID, command, thời điểm tạo process và run ID trước khi dừng. MySQL chỉ nhận SHUTDOWN sau khi xác minh UUID/datadir/cổng riêng. Không xóa database/datadir, không dừng process ngoài bộ QA.
