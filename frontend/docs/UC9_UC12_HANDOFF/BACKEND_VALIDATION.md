# Kiểm tra Backend trước staging UC9–UC12

Ngày chạy: **25/10/2026**, giờ Việt Nam. Chỉ chạy các file unit test đã đọc và kiểm tra trước; không nạp `.env`, không kết nối MySQL thật, không khởi động Auth/Staff/Order development và không chạy workflow Q01–Q06.

## Kết quả mới trong lượt chuẩn bị staging

| Bộ kiểm tra | PASS | FAIL | SKIP | NOT_RUN | Exit code |
| --- | ---: | ---: | ---: | ---: | ---: |
| Auth `test:unit` | 46 | 0 | 0 | 0 | 0 |
| Staff `test:unit` | 99 | 0 | 0 | 0 | 0 |
| Order `test:unit` | 72 | 0 | 0 | 0 | 0 |
| Công cụ tạo fixture UC12, unit SQL double | 12 | 0 | 0 | 0 | 0 |
| Tổng unit Backend và QA-data tooling | **229** | **0** | **0** | **0** | |

Đây là tổng Node test runner của các file được chọn, có cả test cha/con theo cách runner đếm; không quy đổi thành số API hoặc số ca E2E. Auth 46 + Staff 99 + Order 72 = 217; 12 ca công cụ QA được tách để tránh cộng trùng với nhóm QA trong báo cáo tổng.

## Lệnh đã chạy

Từ `backend/auth-service`:

```powershell
npm.cmd run test:unit
```

Từ `backend/staff-service`:

```powershell
npm.cmd run test:unit
```

Từ `backend/order-service`:

```powershell
npm.cmd run test:unit
node --test test/uc12-qa-data.test.mjs
```

Auth chạy đúng bốn file: crypto, credential-vault, repository, auth. Staff chạy đúng chín file: auth, jobs, order-client, repository, validation-mapping, reconciliation, seed-contract, multi-seed-contract, http-test-config. Order chạy đúng ba file: domain, repository, http. Không dùng `npm test` của Staff vì auto-discovery có thể tìm các bài integration ngoài phạm vi.

## Phạm vi và bảo toàn

- Password/JWT dùng mật mã thật trong test với khóa và tài khoản chỉ có trong tiến trình test; không dùng token đó để giả nhận Auth production hoạt động. Không ghi credential, access token hoặc private key vào báo cáo.
- Repository và transaction dùng SQL doubles/memory repositories rõ nhãn; loopback HTTP trong unit chỉ là dependency test. **Không phải kiểm chứng HTTP Auth → Staff → Order → MySQL thật.**
- Seed-contract chỉ đọc SQL nguồn và kiểm tra cú pháp/guard; không thực thi seed hoặc DDL.
- `uc12-qa-data.test.mjs` truyền fake SQL pool, không mở MySQL. Artifact scratch có tên `uc12-data-unit-<UUID>` riêng dưới thư mục private đã ignore; cleanup chỉ tác động thư mục do test vừa tạo sau kiểm tra parent/prefix. Không đụng manifest/backup hoặc fixture nghiệm thu Q01–Q06.
- Không sửa source Backend, schema, package/lockfile hoặc dữ liệu thật trong lượt kiểm thử. File báo cáo này là thay đổi tài liệu duy nhất của tác nhân thực hiện kiểm thử Backend.

Log đầy đủ chỉ lưu tại `%TEMP%/cleanhome-handoff-{auth,staff,order}-unit.tap` và `%TEMP%/cleanhome-handoff-order-qadata-unit.tap`; không thuộc danh sách commit. Báo cáo chỉ lấy tên và thống kê test, không công bố log credential.

## Các lớp chưa chạy lại

| Lớp | Trạng thái lượt staging | Lý do |
| --- | --- | --- |
| MySQL repository/integration | NOT_RUN | Không cần ghi hoặc truy cập database để kiểm tra patch tài liệu/CSS |
| HTTP integration với service/JWT thật | NOT_RUN | Giữ bằng chứng nghiệm thu trước đó riêng; không khởi động workflow dịch vụ |
| Q01–Q06 ghi thật UC12 | NOT_RUN | Fixture đã COMPLETED/DONE; không được chạy lại hoặc reset |
| Production, HTTPS, tải lớn, crash thực tế | NOT_RUN | Ngoài phạm vi kiểm tra staging |

Kết quả lịch sử 43 nhóm E2E local PASS và 90 HTTP PASS + 1 SKIP UC11 vẫn tham chiếu `UC12_E2E_QA_REPORT.md`; không trộn chúng vào 229 unit mới. Frontend typecheck/build và kiểm tra nội dung staged được ghi riêng bởi người tích hợp.
