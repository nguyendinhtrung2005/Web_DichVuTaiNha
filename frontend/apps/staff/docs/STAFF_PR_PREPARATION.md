# Nghiệm thu nhánh PR CleanHome Staff — Giai đoạn 7C

Ngày nghiệm thu: 2026-11-06. Kết luận: **READY_TO_COMMIT**, chờ người dùng phê duyệt commit. Chưa stage, commit, push, merge hoặc tạo PR.

- Nhánh: `pr/staff-demo-ready-20261106`; base: `72be976d0cce009c54c2503608689b3c8987873d` trên `integration/uc9-uc12`, đã xác nhận remote ở 7B.
- Đối chiếu đầu lượt: đúng 265 file, không thiếu/thừa hoặc lệch hash. Manifest trước đây có 263 bản sao và hai file metadata chưa được liệt kê tường minh; nay `files` + `metadataFiles` ghi đủ 265 đường dẫn.
- 263 bản sao giữ nguyên nội dung được chấp thuận ở 7B. Hai file metadata được cập nhật để chốt nghiệm thu và danh sách commit; file này được sửa lỗi mất dấu do encoding thành UTF-8.
- Danh sách cụ thể từng commit nằm trong trường `commitPlan` của [pr-preparation-manifest.json](../../../../qa/staff/pr-preparation-manifest.json). Mỗi đường dẫn xuất hiện đúng một lần; không dùng wildcard để stage.

## Kết quả kiểm thử trên worktree PR

| Kiểm tra | Kết quả |
|---|---|
| Unit frontend Staff | PASS — 765/765, 0 fail, 0 skip |
| Unit Staff Backend | PASS — 148/148, 0 fail, 0 skip |
| Regression QA | PASS — 5/5: 2 cấu hình frontend + 3 guard/schema/seed thuần, không kết nối SQL |
| API/BFF với test doubles | MOCK_PASS — nằm trong các bộ unit ở trên; không coi là REAL_PASS |
| Smoke Backend/BFF/Chrome thật trên QA riêng của nhánh PR | NOT_RUN — thiếu runtime-config/credential riêng, không sao chép hoặc tạo secret |
| Groq, tile mạng, Review hoặc payout thật trên nhánh PR | NOT_RUN — không gọi provider hoặc khởi động dịch vụ |
| Webpack/typecheck | PASS ở 7B; không chạy lại, đầu vào snapshot ứng dụng không đổi |

Log và kết quả kiểm thử local nằm tại `qa/staff/.private/stage7c/`, được ignore. Test sử dụng mã ở worktree PR và chỉ đọc dependency đã cài qua junction. Không cài gói, không ghi node_modules, không khởi động lại QA nguồn, không kết nối/ghi MySQL hoặc gọi AI.

## Danh sách commit dự kiến

| Nhóm | Nội dung | Số file |
|---|---|---:|
| 01 | Staff Backend: khu vực, thông báo và thu nhập | 19 |
| 02 | Nền tảng phiên và component Staff dùng chung | 15 |
| 03 | Khu vực, chi tiết ca và Leaflet | 29 |
| 04 | Thông báo và tùy chọn hiển thị | 20 |
| 05 | Tiền công dự kiến và biểu đồ thu nhập | 22 |
| 06 | Thành tích vận hành và trạng thái đánh giá | 24 |
| 07 | Chatbot, hội thoại và bảo vệ BFF | 27 |
| 08 | Tích hợp route, giao diện, hồ sơ và cài đặt Staff | 51 |
| 09 | QA cô lập và tài liệu bàn giao Staff | 48 |
| 10 | Tài liệu kiến trúc Database và ERD | 10 |
| | **Tổng** | **265** |

Test và tài liệu tích hợp đi cùng tính năng; nhóm 09 chứa harness dùng chung, test xuyên module và tài liệu bàn giao. Nhóm 10 gồm đúng 10 file Database/ERD, có thể thành PR tài liệu riêng vì không cần code Staff mới. Giữ bước tích hợp route/layout/CSS ở nhóm 08 sau các module; nếu thay đổi cách chia hunk hoặc yêu cầu từng commit build độc lập, phải kiểm tra lại trạng thái trung gian trước khi commit. Chưa nghiệm thu các trạng thái trung gian đó.

## Phạm vi và owner review

- **Owner Staff Backend bắt buộc review trước merge** 13 file source/package và 6 test trong nhóm 01: quyền nhân viên A/B, thông báo read_at của đúng tài khoản, API đọc khu vực/lịch và thu nhập minh họa. Script snapshot chỉ đọc ở nhóm QA.
- Không có thay đổi Auth Backend, Order Backend, Customer, Admin hoặc schema production. Không đưa 12 file Auth của commit nguồn `01a5b03` sang; HEAD nhánh PR vẫn là base, không mang commit riêng của nhánh nguồn.
- BFF Auth là code phía Staff; chức năng gia hạn phiên vẫn mặc định tắt. Base Auth chưa có contract refresh tương ứng, chỉ bật sau khi owner Auth xác nhận. Không sao chép Auth code để bù phụ thuộc.
- Leaflet 1.9.4 / @types/leaflet 1.9.21 khớp package-lock. Gói UI dùng chung chỉ sửa component Staff.

## Những chức năng còn BLOCKED

- Đăng ký/đổi/hủy/phê duyệt ca chính thức: thiếu contract API ghi và chính sách/quyền Admin được duyệt; giữ giao diện yêu cầu bị khóa, không báo thành công giả.
- Sửa hồ sơ, đổi mật khẩu và danh sách thiết bị: thiếu API/quyền tương ứng; không tự sửa Auth.
- Review, KPI/huy hiệu chính thức và payout/đối soát/thanh toán: thiếu API hoặc quy chế; không tạo dữ liệu giả. DEMO_V2 chỉ là tiền công dự kiến minh họa.
- Nghiệm thu runtime nhánh PR cần cấu hình QA độc lập riêng; kết quả READY_FOR_DEMO/REAL_PASS của nguồn không tự chuyển thành REAL_PASS của nhánh này.

## Loại trừ và bảo toàn

- `next-env.d.ts` giữ nguyên base, không nằm trong 265 file.
- `.private`, credential/env thật, key, session, MySQL, dump/log/HAR, dependency và output không nằm trong danh sách commit; các probe ignore tiếp tục được kiểm tra.
- `.env.example`, `config.example.json`, `credentials.ps1` (chỉ mở trình xem), `qa/staff/schema.sql` và seed tổng hợp là mã/tài liệu công khai hợp lệ, không chứa credential QA thật.
- Source `feat/staff-rebuild` giữ 38 modified + 139 untracked, 0 staged. Repo gốc và source được đối chiếu HEAD/status/hash; không thay đổi nội dung.

Không có blocker kỹ thuật trước commit với phạm vi hiện tại. Phê duyệt commit thuộc người dùng; owner review và các API thiếu là điều kiện trước merge/bật chức năng tương ứng.
