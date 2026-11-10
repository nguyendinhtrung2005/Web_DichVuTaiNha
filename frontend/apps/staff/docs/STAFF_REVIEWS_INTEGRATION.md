# Review API Staff — hợp đồng chờ cung cấp

Mặc định `STAFF_REVIEWS_API_ENABLED` tắt. `/thanh-tich` giữ chỉ số phân công thật; mục đánh giá báo chưa được cung cấp, không tạo điểm sao, review hoặc huy hiệu chính thức.

Chỉ bật `STAFF_REVIEWS_API_ENABLED=true` ở server Staff sau khi nhóm cung cấp API dưới đây và xác nhận quyền nhân viên xem nhận xét. Không dùng `NEXT_PUBLIC_*`, không cấu hình URL qua trình duyệt. BFF chỉ đọc `GET {STAFF_SERVICE_URL}/api/v1/staff/me/reviews` bằng bearer của phiên hiện tại; không chấp nhận employee/customer/booking ID từ client.

Query: `from=YYYY-MM-DD&to=YYYY-MM-DD&page=1&pageSize=10`, `rating=1..5` tùy chọn. Kỳ tối đa 366 ngày theo ngày gửi đánh giá tại UTC+7, sắp xếp `createdAt` giảm dần. API phải kiểm tra EMPLOYEE/ACTIVE, scope nhân viên hiện tại, và chỉ trả review đã được phép hiển thị. Cần chính sách lọc/redact nội dung nhận xét trước khi cung cấp cho nhân viên.

Hợp đồng đề xuất (không phải bằng chứng backend đã triển khai):

```json
{
  "schemaVersion": "STAFF_REVIEWS_V1",
  "timezone": "Asia/Ho_Chi_Minh",
  "range": { "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" },
  "filter": { "rating": null },
  "data": [],
  "pagination": { "page": 1, "pageSize": 10, "total": 0, "totalPages": 0 },
  "summary": { "total": 0, "average": null, "distribution": { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 } }
}
```

Mỗi review có `id` (1–64 ký tự A–Z/a–z/0–9/_/-), `rating` nguyên 1–5, `createdAt` ISO UTC chuẩn có milliseconds, `comment` null hoặc tối đa 2.000 ký tự, `serviceLabel` null hoặc tối đa 150 ký tự. Không cần tên/email/điện thoại khách hay booking. BFF whitelist các trường trên; UI render text React, không render HTML từ API.

`summary` và `pagination.total` tính toàn bộ kết quả khớp bộ lọc, không chỉ trang hiện tại. `average` là trung bình có trọng số từ distribution, làm tròn một chữ số; không dữ liệu phải là null. `totalPages=ceil(total/10)`. Mỗi trang phải đủ số dòng còn lại; ID không trùng trong trang; phân trang phải ổn định tại backend. Giới hạn response 256 KiB và timeout theo `STAFF_API_TIMEOUT_MS`.

401/403 kiểm tra lại phiên; 404/501 biểu thị API chưa được cung cấp; 429 có retry; JSON/hợp đồng sai trả lỗi rõ ràng. Không fallback DEMO trong production. Chưa có quy chế KPI nên review thật cũng không cấp huy hiệu hay tự quy đổi thưởng.

Kiểm tra cô lập: `node --test test/reviews-http.test.mjs test/reviews-ui.test.mjs test/performance-model.test.mjs test/achievements-demo-ui.test.mjs`. Các test mock không chứng minh Review API thật/Chrome E2E/production.

Giai đoạn 4, 06/11/2026: Staff Backend hiện tại chưa triển khai route reviews; QA BFF tắt cấu hình và trả `503 REVIEWS_NOT_AVAILABLE`. UI khóa bộ lọc khi API chưa khả dụng, giữ nút kiểm tra lại và không dựng sao/nhận xét/huy hiệu. Đây khác với API hợp lệ trả 200 nhưng danh sách rỗng. API thật, quyền xem nhận xét và chính sách redact của owner vẫn là blocker.

Chỉ số vận hành vẫn đọc schedule API thật theo lịch hẹn bắt đầu ở UTC+7; thêm chọn nhanh Hôm nay/Tuần này/Tháng này và thanh tỷ lệ hoàn thành/đúng giờ có mẫu số rõ ràng. Không đổi công thức, không suy ra KPI hoặc thưởng. QA 3102 đối chiếu A/B với SQL READ ONLY, có tài khoản 0 phân công, responsive 375/390/768/1440, F5/session/logout; Review dữ liệu thật và Payment vẫn NOT_RUN.
