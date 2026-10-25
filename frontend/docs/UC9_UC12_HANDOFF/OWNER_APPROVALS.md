# Phê duyệt phạm vi bàn giao UC9–UC12

Ghi nhận trong lượt bàn giao ngày **25/10/2026**, giờ Việt Nam; đây không phải ngày ký của từng owner. Người dùng xác nhận nhóm CleanHome đã đồng ý bàn giao các phần UC9–UC12 và thay đổi liên quan trong bộ handoff, đồng thời cho phép áp dụng sáu tài liệu Backend, chọn riêng CSS Staff và chuẩn bị staging.

**Nguồn phê duyệt: nhóm xác nhận qua người điều phối, chưa đính kèm bằng chứng riêng.** Nguồn là yêu cầu trực tiếp của người dùng “CLEANHOME – HOÀN TẤT BÀN GIAO UC9–UC12 LÊN GITHUB”. Không tự bịa tên reviewer, ngày ký, URL review hoặc xác nhận độc lập của từng owner. TV1–TV5 dưới đây là vai trò theo `BACKEND_TEAM_RULES .md`, không phải tên người đã ký.

Các trạng thái NOT_RECORDED/CHƯA GHI NHẬN trong lượt trước là mốc lịch sử, được thay bằng xác nhận mới đúng phạm vi dưới đây. Phê duyệt bàn giao không tự chuyển contract sang trạng thái được hai owner ký APPROVED và không mở rộng ra governance, file/hunk EXCLUDE hoặc production.

| Nhóm | Phạm vi được đồng ý bàn giao | Owner / reviewer liên quan | Nguồn xác nhận |
| --- | ---: | --- | --- |
| 01-auth | 27 file | Auth/User TV1; Staff consumer | Nhóm xác nhận qua người điều phối, chưa đính kèm bằng chứng riêng |
| 02-database | 4 SQL nguồn | Owner bảng liên quan TV1–TV5 | Cùng xác nhận; chỉ bàn giao source, không thực thi SQL |
| 03-staff | 42 file | Staff TV4; Auth/Order review contract | Cùng xác nhận, chưa có bằng chứng riêng từng owner |
| 04-order | 27 file, không gồm QA riêng | Order TV3; Staff consumer | Cùng xác nhận, chưa có bằng chứng riêng từng owner |
| 05-staff-frontend | 74 file | Frontend Staff; Auth/Staff reviewer | Cùng xác nhận, chưa có bằng chứng riêng từng owner |
| 06-qa | 12 file code/test/báo cáo Markdown | Staff, Order, Auth và Frontend QA | Cùng xác nhận; không cho phép chạy lại fixture đã tiêu thụ |
| CSS riêng | Chỉ patch Staff 57 dòng | UI maintainer; Customer/Admin reviewer bị ảnh hưởng | Cùng xác nhận; không gồm 13 dòng Admin |
| Tài liệu handoff | Các tài liệu/allowlist/patch trong bộ bàn giao | Người tích hợp và reviewer liên quan | Cùng xác nhận; không bao gồm private artifacts |

Tổng nguồn/test/config/schema/QA là **186 file toàn bộ**, cộng CSS theo hunk và bộ tài liệu riêng. Danh sách đầy đủ ở FILES.csv và sáu `.review-paths.txt`; các `.ready-paths.txt`/`.approved-paths.txt` sau cập nhật phải khớp đúng phạm vi. FILES.csv ghi 186 ứng viên `APPROVED`; CSS `APPROVED` chỉ theo hunk, không cho stage toàn file. Hash và APPROVED_STAGE.csv ràng buộc nội dung bàn giao; không phải chữ ký số hoặc bằng chứng owner review độc lập.

## Sáu tài liệu Backend đã áp dụng

Patch [proposals/backend-docs-update.patch](proposals/backend-docs-update.patch) đã được áp dụng đúng sáu file, giữ DTO/endpoint/enum và nghiệp vụ. [BACKEND_DOC_PROPOSALS.md](BACKEND_DOC_PROPOSALS.md) giữ mô tả diff gốc để truy vết; không áp dụng lại patch.

- [x] Ghi nhận xác nhận qua người điều phối cho `backend/auth-service/README.md` và `docs/staff-integration.md`.
- [x] Ghi nhận cùng nguồn cho `backend/staff-service/README.md`.
- [x] Ghi nhận phạm vi liên quan Staff/Order cho `backend/staff-service/docs/order-handoff-checklist.md` và `order-service-contract.md`; chưa đính kèm bằng chứng review độc lập hai phía.
- [x] Ghi nhận cùng nguồn cho `backend/order-service/README.md`.
- [x] Sáu nội dung tiến độ được cập nhật theo local QA, hash/CSV được cập nhật; không tự gán phê duyệt kiến trúc/contract chính thức.

CSS 57 dòng đã có sẵn trong working tree cùng 13 dòng Admin. Không viết lại hoặc áp dụng lặp vào working tree. Chỉ chọn phần Staff trong patch đã đồng ý khi staging; giữ Admin unstaged và không stage `portal.tsx`. Trạng thái staging cuối cùng phải được đối chiếu trong `STAGING_REVIEW.md`, không suy từ việc được phép stage sang đã hoàn thành kiểm tra.

## Phạm vi chưa được mở rộng

- Root AGENTS.md và `BACKEND_TEAM_RULES .md` giữ HOLD governance; không tự đổi tên file rule hoặc đưa vào feature.
- Các file EXCLUDE vẫn loại khỏi PR và giữ nguyên trên máy: Customer auth, Portal legacy/Admin, generated/tooling ngoài scope, tài liệu UI khác và output lệnh.
- Không có quyền mới để ghi/reset MySQL, chạy seed/migration hoặc lặp Q01–Q06/booking `9109131`/`9109141` đã COMPLETED.
- Dừng tại kiểm tra staging. **Chưa được commit, push, tạo PR hoặc merge** cho đến khi người dùng xem và xác nhận staged diff cuối.

## Checklist trước tạo Draft

- [x] Ghi nhận nguồn xác nhận nhóm qua người điều phối, đúng 186 file + CSS Staff + bộ tài liệu handoff; không bịa reviewer/link/ngày ký.
- [x] Áp dụng đúng sáu tài liệu Backend; giữ nghiệp vụ, DTO và evidence lịch sử.
- [x] Phạm vi staging được cập nhật232→235 đường dẫn, chỉ thêm ba tài liệu proof/review; CSS57 và bốn `.gitignore` giữ nguyên phạm vi. Xem STAGING_FILES.csv và WHITESPACE_REVIEW.md.
- [x] Theo yêu cầu mới của người dùng, đã sửa đúng whitespace, cập nhật hash có proof SQL/AST/patch; raw `git diff --cached --check` cuối PASS. Auth55unit/Staff typecheck lượt này PASS;557unit/build là evidence lượt trước, không nhận đã chạy lại.
- [ ] Người dùng xác nhận danh sách staged trước mọi commit/push/PR.
- [ ] Nhóm chọn head/base và cách tách PR theo [PR_SPLIT_PLAN.md](PR_SPLIT_PLAN.md). Main GitHub 3e90f13 đã merge baseline afc5d78; nhánh integration mới vẫn là đề xuất chờ chọn, không tự tạo.
- [ ] Khi được phép publish, cập nhật PR body theo nội dung và bằng chứng thực sự bàn giao.

## Checklist trước Ready for Review

- [ ] Phân biệt rõ phê duyệt qua người điều phối với bằng chứng review độc lập chưa đính kèm; reviewer xác nhận các quyết định contract/quyền ghi còn cần thiết.
- [ ] Kiểm tra đúng các commit/subset trên base đã chọn, gồm ảnh hưởng CSS chung tới Customer/Admin; không chạy lại workflow ghi đã COMPLETED.
- [ ] Giữ đúng bằng chứng 43 nhóm E2E local PASS và 90 HTTP PASS + 1 SKIP UC11 qua ranh ngày. Production, HTTPS/Secure cookie thực, tải lớn và crash thực tế chưa kiểm chứng.
- [ ] Không có `.env` thật, session/JWT/cookie/key/vault, `.auth-data`, backup/dump hoặc dữ liệu QA riêng trong commit/lịch sử PR.
- [ ] Review đúng ownership và phạm vi PR; việc nhóm đồng ý bàn giao không thay review kỹ thuật trước merge hoặc quyền triển khai production.
