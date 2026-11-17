# Nội dung gửi nhóm: duyệt phạm vi bàn giao UC9–UC12

**Mẫu lịch sử của bước xin xác nhận trước:** người dùng hiện đã xác nhận nhóm đồng ý bàn giao toàn bộ phạm vi bên dưới qua người điều phối, chưa đính kèm bằng chứng riêng. Nguồn mới và trạng thái hiện hành ở [OWNER_APPROVALS.md](OWNER_APPROVALS.md), [STAGING_REVIEW.md](STAGING_REVIEW.md). Giữ mẫu này để truy vết, không dùng phần mô tả chờ duyệt cũ dưới đây để phủ nhận xác nhận mới hoặc tự yêu cầu duyệt lại.

Nhóm đã phê duyệt bộ dữ liệu QA và kiểm thử ghi UC12; **chưa phê duyệt chính thức file/hunk để bàn giao Git**. Nhờ từng owner xác nhận phạm vi dưới đây. TV1–TV5 là vai trò quy ước, vui lòng ghi tên người phụ trách thực tế.

| Nhóm cần duyệt | Số file | Owner / reviewer | Danh sách chính xác |
| --- | ---: | --- | --- |
| Auth | 27 | Auth/User TV1; Staff review phần tích hợp | [01-auth.review-paths.txt](01-auth.review-paths.txt) |
| Schema và seed nguồn | 4 | Owner bảng liên quan TV1–TV5 | [02-database.review-paths.txt](02-database.review-paths.txt) |
| Staff Backend | 42 | Staff TV4; Auth/Order review contract | [03-staff.review-paths.txt](03-staff.review-paths.txt) |
| Order Backend | 27 | Order TV3; Staff review contract | [04-order.review-paths.txt](04-order.review-paths.txt) |
| Staff Frontend/BFF | 74 | Frontend Staff; Auth/Staff reviewer | [05-staff-frontend.review-paths.txt](05-staff-frontend.review-paths.txt) |
| QA tooling, tests, báo cáo Markdown | 12 | Staff/Order/Auth và Frontend QA | [06-qa.review-paths.txt](06-qa.review-paths.txt) |

Tổng **186 ứng viên**, gồm 180 READY kỹ thuật và sáu tài liệu HOLD; READY không thay phê duyệt. Các list review có cả HOLD: owner có thể chỉ duyệt subset, cần chỉ rõ file. Dữ liệu QA/private artifacts không thuộc 12 file tooling và không được commit.

- [ ] **Auth/Staff/Order duyệt sáu tài liệu HOLD:** hai tài liệu Auth; Staff README; checklist và contract Staff→Order cần Staff/Order đồng duyệt; Order README. Xem [nội dung và patch đề xuất](BACKEND_DOC_PROPOSALS.md). Chỉ cập nhật tiến độ, không đổi DTO/endpoint/nghiệp vụ.
- [ ] **UI owner duyệt riêng CSS 57 dòng**, có reviewer Customer/Admin do selector dùng chung. Xem [hunk và hash patch](STAFF_HUNKS.md). Không nhận 13 dòng Admin hoặc toàn bộ `portal.tsx`; chưa áp dụng/stage patch.
- [ ] **Mỗi owner duyệt source/test/config trong nhóm của mình**, gồm bootstrap/package/lockfile và `.gitignore` tương ứng. Loại `.env` thật, session/JWT/key/secret, `.auth-data/qa` và backup. Bốn SQL chỉ bàn giao source; không duyệt chạy SQL. Phê duyệt QA trước đây không thay review code công cụ QA.
- [ ] **Người tích hợp duyệt tài liệu bàn giao**, thống nhất head/base, cách chia PR và phạm vi được publish. Xem [list handoff riêng ngoài 186](07-handoff.ready-paths.txt). Root AGENTS/quy tắc nhóm nếu cần đưa lên Git phải review governance riêng, không gộp tự động.
- [ ] **Đối chiếu bằng chứng:** 43 E2E local PASS; 90 HTTP PASS + 1 SKIP UC11 qua ranh ngày. Production/HTTPS/tải lớn/crash thực tế chưa kiểm chứng. Không chạy lại Q01–Q06 hoặc booking cũ đã COMPLETED.

Mẫu phản hồi owner:

```text
Owner/người phụ trách: …
Phạm vi: nhóm + danh sách file cụ thể, hoặc patch/hunk và hash được review
Quyết định: DUYỆT / DUYỆT MỘT PHẦN / GIỮ HOLD; phần loại trừ và lý do
Cho phép: áp dụng đề xuất nào; bàn giao Git những file/hunk nào
Nguồn xác nhận: nội dung phản hồi/link review; ngày xác nhận
```

Xác nhận trực tiếp trong chat có thể dùng làm nguồn; không cần gửi secret. Đến khi có xác nhận rõ ràng, giữ FILES.csv `NOT_RECORDED`, OWNER_APPROVALS.md `CHƯA GHI NHẬN`, không áp dụng patch hoặc stage/commit/push/merge. Nội dung này chỉ được chuẩn bị để người dùng tự gửi, chưa gửi cho nhóm qua công cụ nào.
