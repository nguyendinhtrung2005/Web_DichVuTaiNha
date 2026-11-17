# chore(database): hand off Staff test schema and seed sources

Bàn giao bốn file SQL nguồn: `schema.sql`, `schema_staff_test.sql`, `seed_staff_test.sql`, `seed_staff_test_multi.sql`. Giữ cấu trúc 32 bảng và các guard kiểm thử hiện có. Đây là schema/seed nguồn, không phải bản sao lưu database.

Owner/reviewer: owner các bảng liên quan TV1–TV5. Nguồn xác nhận bàn giao: **nhóm xác nhận qua người điều phối, chưa đính kèm bằng chứng riêng**. Không tự ghi tên reviewer, ngày ký hoặc link review.

Kiểm tra: các ca seed-contract nằm trong **99 Staff unit PASS, 0 FAIL, 0 SKIP**; không chạy DDL, seed hoặc MySQL trong lượt staging.

Phụ thuộc và giới hạn: chỉ bàn giao source; không tự chạy SQL khi khởi động, CI hoặc merge. Hash marker trong seed không phải credential dùng để đăng nhập.
Bằng chứng lịch sử của toàn luồng: **43 nhóm E2E local PASS** trên Q01–Q06 và **90 HTTP PASS + 1 SKIP** UC11 qua ranh ngày. Không chạy lại các workflow này hoặc cộng kết quả lịch sử vào unit mới.

Base đề xuất: integration/uc9-uc12 được tạo từ main GitHub đã xác minh3e90f13 (đã merge baselineafc5d78 qua PR #1); chưa tạo nhánh này. Tạo head sau khi dependency cần thiết đã merge vào base. Rủi ro272file của báo cáo cũ dựa trên origin/main local898b65c, không còn đúng với main thật có cùngtreebaseline. Xem [kế hoạch tách PR](../PR_SPLIT_PLAN.md).

- [ ] Head chỉ chứa allowlist của nhóm và các dependency đã được review.
- [ ] Người dùng xác nhận staged diff; secret và `.gitignore` được kiểm tra.
- [ ] Không có `.env` thật, token/key/cookie/session, backup hoặc `.auth-data`.
- [ ] Không ghi dữ liệu MySQL hoặc chạy lại fixture đã COMPLETED.
- [ ] Validate đúng tổ hợp PR/base; production, HTTPS, tải lớn và crash thực tế vẫn chưa được kiểm chứng.

Báo cáo tổng hợp: [STAGING_REVIEW.md](../STAGING_REVIEW.md). Chưa commit, push hoặc tạo Draft PR; mọi bước publish chờ người dùng xác nhận checkpoint staging.
