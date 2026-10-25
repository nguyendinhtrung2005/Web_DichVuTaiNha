# Kiểm tra bảo mật cho staging UC9–UC12

## Cập nhật sau sửa whitespace

Lượt tiếp theo được người dùng cho phép chỉ sửa định dạng. Danh sách cuối235 đường dẫn (186 file+CSS+hành chính handoff48), tăng ba tài liệu proof/review; không mở rộng source nghiệp vụ. Mười file toàn bộ chỉ đổi blank lines/EOF, artifact patch chuyển zero-context với proof sáu image không đổi. Pattern .gitignore Staff không đổi, chỉ bỏ blank EOF. BlobCSS57 và13 dòng Admin unstaged giữ nguyên.

Raw `git diff --cached --check` cuối **PASS, exit 0, không còn147 cảnhbáo cũ**. Không thay cấu hình whitespace hoặc thêm ngoại lệ .patch; cần `--unidiff-zero` cùng hashguard theo PATCH_FORMAT_PROOF.md. Quét lại index cuối không thấy private artifact, generated output hoặc signature secret trong phạm vi đã dò; bốn.gitignore vẫn staged. Xem [WHITESPACE_REVIEW.md](WHITESPACE_REVIEW.md) và [STAGING_REVIEW.md](STAGING_REVIEW.md).

Các bảng232blob/FAIL phía dưới là **snapshot lịch sử trước formatting**, không phải kết quả hiện tại. Không kiểm toán toàn lịch sử Git hoặc chứng nhận mọi chuỗi secret tự do. Không tải dữ liệu .auth-data/QA/backup lên GitHub, không chạyMySQL hoặcQ01–Q06. Chưa commit/push/tạoPR.

Ngày rà soát: **25/10/2026**, giờ Việt Nam. Scope phê duyệt được ghi nhận qua người điều phối theo yêu cầu bàn giao mới; báo cáo này không tự đặt tên reviewer hoặc tạo bằng chứng owner riêng. Chỉ kiểm tra nội dung/đường dẫn và Git chỉ đọc; không chạy service, test ghi, seed hoặc truy cập MySQL. Không sửa source, ignore hoặc index trong nhiệm vụ kiểm tra bảo mật.

## Kiểm tra trước staging

Snapshot kiểm tra gồm **186 ứng viên duy nhất** trong sáu `.review-paths.txt` và **26 file handoff** đang có lúc đọc, tổng **212 file / 2.056.846 byte**, không lỗi đọc. Các tài liệu bàn giao tạo/cập nhật sau snapshot này cần được kiểm tra cùng staged cuối; mẫu số 186 không bao gồm handoff hoặc CSS hunk riêng.

| Mục kiểm tra | Kết quả | Ghi chú |
| --- | --- | --- |
| Private artifact trong danh sách dự kiến | PASS | Không có `.env` thật, `.auth-data`, `secrets`, PEM/key/JWT/backup runtime |
| Chữ ký private PEM, JWT hoàn chỉnh, GitHub PAT, AWS key | PASS theo mẫu dò | Không phát hiện; không phải chứng nhận toàn lịch sử Git |
| URL có user/password | Đã phân loại | Sáu kết quả của bộ dò là negative fixtures; không phải credential kết nối thực |
| So sánh credential runtime trong bộ nhớ | PASS trong phạm vi đã so sánh | Bốn biểu diễn giá trị/encoding được đối chiếu mà không xuất giá trị; không thấy Order token. Các kết quả MYSQL là chuỗi con trong số/giá/phone/idempotency test, không phải trường credential |
| Ba lockfile Backend | PASS | JSON hợp lệ, không trường registry auth hoặc URL chứa credential |
| Bốn `.env.example` | PASS | Các biến secret đã rà soát để trống; URL/issuer/audience và đường dẫn file không phải secret |
| Private file tracked | PASS | Không có private file tracked trong scope Auth/Staff/Order/Frontend Staff |
| Index ở snapshot trước staging | Rỗng | Không diễn giải kết quả này là staged cuối đã an toàn |

Các URL negative fixture nằm trong Staff `auth.test.js`, `http-test-config.test.js`, `order-client.test.js` và Frontend Staff `auth-core.test.mjs`, `jobs-contract.test.mjs`, `status-qa-relay.test.mjs`. Không xóa dữ liệu kiểm tra validation chỉ vì scanner khớp pattern.

## Bốn .gitignore và dữ liệu private

| File | Phạm vi hiện được bảo vệ |
| --- | --- |
| `backend/auth-service/.gitignore` | `.env*` trừ đúng `.env.example`, `secrets/`, dependency/coverage/log |
| `backend/order-service/.gitignore` | Cùng quy tắc; service credential ở `secrets/` |
| `backend/staff-service/.gitignore` | Cùng quy tắc; token nội bộ và test token ở `secrets/` |
| `frontend/apps/staff/.gitignore` | Toàn cây `.auth-data/`, `.env*` trừ đúng `.env.example` |

Cả bốn file tồn tại và còn untracked ở snapshot trước staging; phải đưa vào đúng nhóm source. Đã kiểm tra **45 đường dẫn giả định** bằng `git check-ignore --no-index --stdin`, không tạo các file probe: **29 private bị ignore**, **bốn template được phép hiện**, **12 tên private tùy chỉnh ngoài thư mục quy ước không bị ignore**; không có kết quả trái kỳ vọng.

Có **168 artifact private thực tế bị ignore**: 159 Frontend Staff `.auth-data`, bảy Auth `secrets`, hai Order `secrets`; số này không gồm ba `.env` Backend. Không mở backup/session để lập báo cáo. Dữ liệu mã hóa vẫn nhạy cảm và không thuộc PR.

Quy tắc không tự bảo vệ `custom-private.pem`, `custom.jwt` hoặc `custom-backup.sql` đặt ngoài `secrets/`/`.auth-data/`. Nếu sử dụng đường dẫn tùy chỉnh, cần owner duyệt ignore cụ thể trước publish. Không cấm mọi `.sql` vì bốn schema/seed nguồn hợp lệ cần được bàn giao riêng. Ignore không loại file đã tracked và không ngăn `git add -f`.

## Kiểm tra staged cuối

Đã đọc **232/232 blob từ Git index**, không lấy working tree làm bằng chứng thay thế, tại snapshot staging ngày 25/10/2026. Tổng nội dung đọc lúc đó 2.317.414 byte, không lỗi đọc. Danh sách staged khớp **232 dòng duy nhất trong STAGING_FILES.csv**, không thiếu/thừa đường dẫn. Số byte có thể đổi khi tài liệu kết quả được cập nhật và stage lại; phạm vi đường dẫn cần giữ nguyên theo manifest đã review.

| Nhóm | Số đường dẫn staged |
| --- | ---: |
| Auth | 27 |
| Schema/seed nguồn | 4 |
| Staff Backend | 42 |
| Order Backend | 27 |
| Frontend Staff | 75: 74 file và một CSS chỉ lấy hunk |
| QA code/test/báo cáo | 12 |
| Tài liệu/allowlist bàn giao | 45 |
| Tổng | **232** |

| Kiểm tra actual cached | Kết quả |
| --- | --- |
| Đủ 186 ứng viên, không file EXCLUDE ngoài CSS hunk được chọn | PASS |
| Portal legacy, UI Customer/Admin, generated artifact, `tatus` | Không staged |
| `.env` thật, `.auth-data`, `secrets`, JWT/key/vault/dump/backup runtime | Không có đường dẫn hoặc chữ ký bí mật phát hiện trong index theo mẫu dò |
| Private PEM/JWT hoàn chỉnh/GitHub PAT/AWS key | Không phát hiện trong 232 blob cached |
| Bốn `.gitignore` | Đều staged, nội dung cached khớp rule working tree đã kiểm tra |
| Bốn mẫu `.env.example` và ba lockfile Backend | Không secret ở biến mẫu đã dò; JSON lock hợp lệ, không registry auth/credential URL |
| CSS | Cached **57 thêm / 0 bỏ**, không selector riêng Admin trong dòng thêm; working tree còn **13 thêm / 0 bỏ** chưa stage |
| Môi trường kiểm tra cô lập mới | Probe `.auth-data/qa/staging-review-20261025/...` bị ignore; không có file dưới cây đó trong index |
| Nhánh/HEAD | `feat/cleanhome-frontend`, `afc5d78b993ec379ba9a9a3c5ab87059dfe2930b` |
| `git diff --cached --check` nguyên bản | **FAIL, exit 2**: cảnh báo định dạng/khoảng trắng được ghi riêng trong kiểm tra staging; không sửa source đã nghiệm thu để làm xanh |

Sáu URL chứa user/password vẫn là negative fixtures đã phân loại. So sánh cached với các biểu diễn credential runtime có thể đọc tại thời điểm kiểm tra không phát hiện credential assignment; kết quả khớp MYSQL vẫn là chuỗi con trong dữ liệu test số/giá/phone/idempotency. Không xuất giá trị credential hoặc nội dung private artifacts vào báo cáo.

**Kết luận bảo mật/phạm vi staged: PASS trong phạm vi đã kiểm tra; kiểm tra khoảng trắng raw không PASS.** Không diễn giải kết luận bảo mật thành toàn bộ quality gate đã đạt hoặc đã được phép commit. Các cảnh báo phải được người dùng xem trước checkpoint commit. Không có commit/push/PR/merge do kiểm tra này thực hiện.

Báo cáo này được cập nhật sau lần đọc index nêu trên; người tích hợp phải stage lại đúng tài liệu kết quả và đối chiếu manifest/diff lần cuối, không mở rộng source/hunk. Chưa kiểm chứng các commit/PR riêng chưa tạo hoặc các revision ngoài index đang xét.

Giới hạn: mẫu dò không chứng minh mọi chuỗi bí mật tự do đều được phát hiện; cần review nội dung và lịch sử head so với base trước publish. Chưa kiểm toán toàn lịch sử Git, production, HTTPS, tải lớn, nhiều host hoặc crash thực tế. Không chạy lại workflow Q01–Q06/booking đã COMPLETED để làm kiểm tra bảo mật.
