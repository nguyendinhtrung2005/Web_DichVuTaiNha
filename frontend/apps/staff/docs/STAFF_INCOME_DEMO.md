# Thu nhập Staff — DEMO cô lập

Hoàn tất DEMO ngày 30/10/2026. Đây là mô-đun frontend minh họa được người dùng yêu cầu; không phải tích hợp Payment thật hoặc chính sách tiền công đã duyệt.

- Route `/thu-nhap`, lối vào ở Cá nhân, sidebar và mobile menu. Bottom navigation vẫn 5 mục; Thu nhập thuộc Cá nhân.
- Chỉ bật khi server có `NODE_ENV=development` và `STAFF_INCOME_DEMO_ENABLED=true`. Không dùng `NEXT_PUBLIC_*`, query, cookie hoặc localStorage để bật. Không sửa .env; có thể đặt biến cho riêng tiến trình dev đã có cấu hình Auth.
- Production luôn khóa demo dù biến bật là true. Khi tắt/demo production, trang chỉ báo nguồn thu nhập thật chưa khả dụng, không hiển thị tiền 0 như thu nhập thật.
- `IncomeAdapter` là ranh giới read/detail/reset cho UI; `staff-income-demo.ts` chứa 20 khoản bất biến, ID `DEMO-INCOME-*`, tham chiếu `DEMO-CV-*` dạng text. Không nối tham chiếu này với /don hoặc assignment thật.
- Adapter không đọc danh tính, giá booking, credential, storage hoặc gọi API. Bộ minh họa dùng chung A/B, không phải thu nhập tài khoản đăng nhập. UI vẫn yêu cầu phiên Staff hợp lệ.
- Tiền VND dùng chuỗi số nguyên và BigInt. Tất cả thẻ, nguồn, biểu đồ, bảng kê dùng cùng tập khoản lọc theo ngày ghi nhận UTC+7. Tổng = phần đã thanh toán/đối trừ + phần chờ; khoản điều chỉnh đã nằm trong tổng.
- Ngày chi trả/đối trừ chỉ thuộc dòng minh họa. Thẻ đã thanh toán là phần của tập khoản ghi nhận trong kỳ, không phải dòng tiền ngân hàng theo ngày thực trả. Khoản âm giữ nguyên dấu; không suy lương từ unitPrice/DONE.
- Bộ tháng 10/2026: 14 khoản, tổng 3.420.000 VND; đã thanh toán/đối trừ 1.760.000; chờ 1.660.000; điều chỉnh −40.000. Có các kỳ giáp tháng/năm để kiểm thử và kỳ rỗng.
- Bộ lọc/kỳ nằm trong URL để F5/deep link; không lưu tương tác vào storage. Đặt lại demo trả bộ lọc/kỳ mặc định và đóng chi tiết, không xóa dữ liệu trình duyệt khác.
- Tích hợp sau: TV5/business owner cần duyệt ledger/công thức/kỳ/chi trả/quyền/DTO, rồi viết adapter Payment đọc report/detail đã chuẩn hóa; không tái dùng seed demo làm dữ liệu thật. Tham khảo `STAFF_INCOME_ACCEPTANCE_CONTRACT_PROPOSAL.md` và `STAFF_BACKEND_IMPLEMENTATION_REQUESTS.md`.
- Kiểm thử frontend minh họa ghi **DEMO_PASS**. Payment thật/chi trả/đối soát ghi **REAL_E2E_NOT_RUN** cho tới khi có contract, API và fixture được duyệt.
