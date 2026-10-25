# Rà soát bảo mật trước bàn giao UC9–UC12

**Báo cáo giai đoạn trước, giữ làm lịch sử.** Kết quả quét index và phạm vi staging hiện hành ở [FINAL_SECURITY_REVIEW.md](FINAL_SECURITY_REVIEW.md), nguồn xác nhận mới ở [OWNER_APPROVALS.md](OWNER_APPROVALS.md). Những câu chưa có approval/index rỗng bên dưới mô tả snapshot cũ.

Ngày rà soát: **25/10/2026, giờ Việt Nam**. Chỉ đọc source/config đã có; không sửa bốn `.gitignore`, không stage, không gọi service hoặc truy cập/ghi MySQL. Đây là kiểm tra nội dung working tree, không phải kiểm toán toàn bộ lịch sử Git hoặc chứng nhận bảo mật production.

## Phạm vi và kết quả

Đọc đúng **186/186 file ứng viên**, 186 đường dẫn duy nhất, tổng 1.852.084 byte tại thời điểm kiểm tra, lấy từ sáu file `01–06-*.review-paths.txt`. Các file handoff mới được quản lý riêng, không cộng vào mẫu số 186. Không có lỗi đọc. Không phát hiện file dữ liệu nhạy cảm cần bổ sung vào EXCLUDE trong tập ứng viên này; trạng thái READY về nội dung không thay thế phê duyệt của owner.

| Kiểm tra | Kết quả |
| --- | --- |
| Đường dẫn private trong 186 ứng viên | 0 `.auth-data/`, `secrets/`, `.env` thật, PEM/key/token/backup runtime |
| Chữ ký private PEM, JWT hoàn chỉnh, GitHub PAT, AWS access-key ID | Không phát hiện |
| URL chứa user/password | 7 kết quả đều là fixture kiểm tra từ chối URL hoặc che thông tin lỗi trong unit tests; không phải credential kết nối thật |
| So sánh giá trị runtime, chỉ trong bộ nhớ | Đối chiếu 6 biểu diễn credential/key có sẵn; không phát hiện Order token, BFF key hoặc private PEM thật trong ứng viên. Các kết quả MYSQL chỉ là chuỗi con trong dữ liệu số/giá/phone/idempotency của test, không phải trường credential |
| Bốn `.env.example` | Secret để trống; URL, issuer/audience và đường dẫn file cấu hình không phải secret. Không đưa nội dung `.env` thật vào báo cáo |
| Private file đã tracked trong bốn scope | 0 |
| Index tại lúc kiểm tra | Rỗng |

Các kết quả URL nằm tại `backend/staff-service/test/{auth,http-test-config,order-client}.test.js`, `backend/order-service/test/repository.test.js`, `frontend/apps/staff/test/{auth-core,jobs-contract,status-qa-relay}.test.mjs`. Không cần xóa test bảo mật vì scanner có kết quả giả dương.

## Bốn quy tắc ignore phải đi cùng source

`git ls-files` chưa liệt kê cả bốn file sau; `git status --short` xác nhận chúng đều untracked:

| File | Phạm vi bảo vệ hiện có |
| --- | --- |
| `backend/auth-service/.gitignore` | `.env*` trừ đúng `.env.example`, `secrets/`, dependency/coverage/log |
| `backend/order-service/.gitignore` | Như Auth; bảo vệ service credential trong `secrets/` |
| `backend/staff-service/.gitignore` | Như Auth; bảo vệ token được cấu hình trong `secrets/` |
| `frontend/apps/staff/.gitignore` | `.auth-data/` toàn cây, `.env*` trừ đúng `.env.example` |

Đã dùng `git check-ignore --stdin --no-index` với **45 đường dẫn giả định, không tạo file**; lệnh exit 0. Trong đó 29 đường dẫn private thuộc vị trí được cấu hình bị ignore, bốn `.env.example` không bị ignore đúng chủ đích, và 12 tên key/JWT/backup tùy ý ngoài các thư mục private không bị ignore. Không dùng `git add`, kể cả dry-run.

Đối chiếu bằng `git ls-files --others --ignored --exclude-standard` cho thấy **168 artifact private đang bị ignore**: 159 trong Staff `.auth-data/`, 7 trong Auth `secrets/`, 2 trong Order `secrets/`. Đây là số file private trong các thư mục này, không phải tổng số file ignore toàn repository; không bao gồm ba `.env` Backend. Không mở hoặc công bố nội dung backup/session để lập báo cáo.

**Giới hạn cụ thể:** rule hiện tại không cấm một `custom-private.pem`, `custom.jwt` hoặc `custom-backup.sql` đặt ngay thư mục gốc service/app. Nếu owner cấu hình đường dẫn private ngoài `.auth-data/` hoặc `secrets/`, cần phê duyệt và thêm rule đúng vị trí trước khi stage. Không tự bổ sung rule toàn cục hoặc cấm mọi `.sql`, vì bốn SQL nguồn trong manifest cần được review riêng. `.gitignore` cũng không bảo vệ file đã tracked hoặc việc dùng `git add -f`.

## Điều kiện kiểm tra lại trước commit

- [ ] Owner duyệt bốn `.gitignore` cùng source tương ứng; không dựa vào rule untracked chỉ có ở máy hiện tại.
- [ ] Dùng danh sách đường dẫn cụ thể, không `git add .`, `git add -A`, glob cả service hoặc `git add -f`.
- [ ] Sau khi người dùng stage, rà soát **toàn bộ staged diff** và danh sách file lần nữa; index hiện còn rỗng nên audit chưa thể chứng nhận commit cuối cùng.
- [ ] Không stage `.auth-data/qa`, session/journal, vault, cookie, key, JWT/token, `.env` thật, runtime manifest, dump SQL/JSON, screenshot/TAP/log hoặc backup, kể cả đã mã hóa.
- [ ] Nếu có thông tin từng bị lộ ngoài tập ứng viên/lịch sử đã kiểm tra, xử lý thu hồi/đổi credential theo quy trình nhóm; việc scanner hiện không thấy không chứng minh chưa từng lộ.
- [ ] Owner xác nhận các công cụ provisioning/seed/QA ghi dữ liệu không được tự chạy khi commit, CI hoặc merge.

Mẫu `backend/staff-service/.env.example` và hướng dẫn theo giai đoạn `backend/staff-service/docs/http-integration-testing.md` còn nhắc booking `9109131` cho opt-in HTTP write test lịch sử. Flag mẫu đang false và ID trống; không có thao tác tự chạy. Script xác nhận đúng ID; test đòi booking `CONFIRMED`, assignments `ASSIGNED`, check-in/out `NULL` trước PATCH, không reset fixture để vượt điều kiện. Booking này đã COMPLETED nên **không chạy lại write test đó**, tương tự Q01–Q06 đã tiêu thụ. Owner cần gắn cảnh báo lịch sử khi bàn giao hướng dẫn. Lượt rà soát không sửa mẫu/tài liệu owner hoặc chạy test ghi; đây không phải phát hiện secret mới hay mở rộng sáu HOLD tài liệu chính.

Không phát hiện blocker secret mới trong 186 file. Các HOLD về tài liệu, contract và CSS dùng chung vẫn phải được giải quyết theo owner; kết quả scan không tự chuyển chúng sang APPROVED. Production, HTTPS, tải lớn và crash thực tế không được kiểm thử trong audit này.
