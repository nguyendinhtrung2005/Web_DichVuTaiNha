# feat(order): synchronize booking assignment transitions

Bàn giao 27 file Order, không gồm nhóm QA riêng: các API nội bộ lookup/apply/ACK/pending, xác thực liên service, idempotency theo operation, tổng hợp trạng thái booking theo nhiều nhân viên và journal bền vững trong `booking_status_history.note`.

Owner/reviewer: Order TV3; Staff review phần tích hợp. Nguồn xác nhận bàn giao: **nhóm xác nhận qua người điều phối, chưa đính kèm bằng chứng riêng**. Không tự ghi tên reviewer, ngày ký hoặc link review.

Kiểm tra: **72 Order unit PASS, 0 FAIL, 0 SKIP**. Kết quả 43 nhóm E2E local PASS trên Q01–Q06 là bằng chứng trước đó, không chạy lại. Không suy kết quả pending/global worker từ lượt Frontend QA khi worker tắt.

Phụ thuộc và giới hạn: contract Staff và schema nguồn. Không đánh dấu booking COMPLETED sớm khi còn nhân viên chưa hoàn thành; không trả ACK giả hoặc dùng cache RAM thay journal. Không thêm migration trong lượt bàn giao.
Bằng chứng lịch sử của toàn luồng: **43 nhóm E2E local PASS** trên Q01–Q06 và **90 HTTP PASS + 1 SKIP** UC11 qua ranh ngày. Không chạy lại các workflow này hoặc cộng kết quả lịch sử vào unit mới.

Base đề xuất: integration/uc9-uc12 được tạo từ main GitHub đã xác minh3e90f13 (đã merge baselineafc5d78 qua PR #1); chưa tạo nhánh này. Tạo head sau khi dependency cần thiết đã merge vào base. Rủi ro272file của báo cáo cũ dựa trên origin/main local898b65c, không còn đúng với main thật có cùngtreebaseline. Xem [kế hoạch tách PR](../PR_SPLIT_PLAN.md).

- [ ] Head chỉ chứa allowlist của nhóm và các dependency đã được review.
- [ ] Người dùng xác nhận staged diff; secret và `.gitignore` được kiểm tra.
- [ ] Không có `.env` thật, token/key/cookie/session, backup hoặc `.auth-data`.
- [ ] Không ghi dữ liệu MySQL hoặc chạy lại fixture đã COMPLETED.
- [ ] Validate đúng tổ hợp PR/base; production, HTTPS, tải lớn và crash thực tế vẫn chưa được kiểm chứng.

Báo cáo tổng hợp: [STAGING_REVIEW.md](../STAGING_REVIEW.md). Chưa commit, push hoặc tạo Draft PR; mọi bước publish chờ người dùng xác nhận checkpoint staging.
