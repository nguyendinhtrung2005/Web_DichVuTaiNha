# feat(auth): provide Staff phone login and RS256 tokens

Bàn giao 27 file Auth cho đăng nhập bằng số điện thoại và mật khẩu, scrypt, JWT RS256, JWKS/introspection, repository/config và kiểm thử. Không giả định schema có email hoặc Auth đã hỗ trợ đầy đủ refresh/revoke phiên.

Owner/reviewer: Auth/User TV1; Staff review phần tích hợp. Nguồn xác nhận bàn giao: **nhóm xác nhận qua người điều phối, chưa đính kèm bằng chứng riêng**. Không tự ghi tên reviewer, ngày ký hoặc link review.

Kiểm tra: **46 Auth unit PASS, 0 FAIL, 0 SKIP**. Không chạy lại HTTP với dịch vụ thật trong lượt staging.

Phụ thuộc và giới hạn: Staff xác nhận issuer, audience và claims được sử dụng. Hai tài liệu Auth đã được cập nhật bằng chứng theo patch đã duyệt.
Bằng chứng lịch sử của toàn luồng: **43 nhóm E2E local PASS** trên Q01–Q06 và **90 HTTP PASS + 1 SKIP** UC11 qua ranh ngày. Không chạy lại các workflow này hoặc cộng kết quả lịch sử vào unit mới.

Base đề xuất: integration/uc9-uc12 được tạo từ main GitHub đã xác minh3e90f13 (đã merge baselineafc5d78 qua PR #1); chưa tạo nhánh này. Tạo head sau khi dependency cần thiết đã merge vào base. Rủi ro272file của báo cáo cũ dựa trên origin/main local898b65c, không còn đúng với main thật có cùngtreebaseline. Xem [kế hoạch tách PR](../PR_SPLIT_PLAN.md).

- [ ] Head chỉ chứa allowlist của nhóm và các dependency đã được review.
- [ ] Người dùng xác nhận staged diff; secret và `.gitignore` được kiểm tra.
- [ ] Không có `.env` thật, token/key/cookie/session, backup hoặc `.auth-data`.
- [ ] Không ghi dữ liệu MySQL hoặc chạy lại fixture đã COMPLETED.
- [ ] Validate đúng tổ hợp PR/base; production, HTTPS, tải lớn và crash thực tế vẫn chưa được kiểm chứng.

Báo cáo tổng hợp: [STAGING_REVIEW.md](../STAGING_REVIEW.md). Chưa commit, push hoặc tạo Draft PR; mọi bước publish chờ người dùng xác nhận checkpoint staging.
