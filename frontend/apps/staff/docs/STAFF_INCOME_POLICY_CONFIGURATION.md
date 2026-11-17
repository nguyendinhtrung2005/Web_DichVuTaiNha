# Chuẩn bị chính sách tiền công Staff

Ngày 05/11/2026. `DEMO_V2` được giữ nguyên và chỉ bật bằng `STAFF_INCOME_DEMO_ENABLED=true` trong `NODE_ENV=development`. Cờ này không bật thu nhập minh họa trong production.

`backend/staff-service/src/income-configured-policy.js` là lớp tính dự kiến độc lập, **chưa nối vào route, môi trường hoặc database**. Không có đơn giá mặc định. Chưa có chính sách chính thức được triển khai; các mức tiền trong test chỉ là fixture của test.

Provider chính sách do owner phê duyệt phải cung cấp đủ:

- `schemaVersion=STAFF_POLICY_V1`, `status=APPROVED`, `policyId`, `version`, `approvalReference`; tham chiếu phê duyệt là metadata kiểm toán, không tự cấp quyền phê duyệt.
- `currency=VND`, `timezone=Asia/Ho_Chi_Minh`, `effectiveFrom/effectiveTo` theo ngày hoàn thành tại Việt Nam, `dayBasis=CHECK_OUT_AT`, `peakBasis=CHECK_IN_AT`.
- `baseVnd`: tiền công cơ bản nguyên đồng không âm.
- `distance.feePerKmVnd`, `distance.includedMetres` và quy tắc làm tròn bắt buộc `FLOOR_VND`, `CEIL_VND` hoặc `NEAREST_VND`. Không tính phí khi thiếu bằng chứng.
- `peakWindows`: các khoảng phút trong ngày không chồng lấn, đầu khoảng được tính và cuối khoảng không được tính; mỗi khoảng có `bonusVnd`. Có thể cấu hình khoảng qua nửa đêm.
- `incentiveMode=HIGHEST_DAILY_TIER`, `dailyIncentiveTiers`: các cặp `threshold/amountVnd` tăng dần. Mỗi ngày check-out chỉ cộng mức thưởng cao nhất đạt điều kiện. Nếu owner chọn quy chế khác cần phiên bản contract khác trước khi kích hoạt.

Bằng chứng di chuyển phải do adapter server tin cậy cung cấp: `assignmentId` khớp phân công, `verified=true`, `source=ROUTE_PROVIDER|OPERATIONS`, `reference`, `verifiedAt` ISO UTC và `kilometres` chuỗi tối đa ba chữ số thập phân. Cờ `verified` từ browser không phải bằng chứng và không được nối trực tiếp vào engine. Không lấy khoảng cách từ địa chỉ, tên khu vực hoặc giá booking.

`estimateConfiguredIncome` chỉ nhận danh sách phân công đã giới hạn theo employee của phiên đăng nhập ở server. Phân công trùng, cấu hình sai hoặc tổng vượt số nguyên an toàn bị từ chối. Kết quả luôn là `ESTIMATED`; `reconciliation` và `payment` đều `NOT_INTEGRATED`, số tiền là `null`, không biến thành 0đ đã xác nhận.

Để kích hoạt production còn cần owner cung cấp chính sách đã ký, provider chính sách có quyền truy cập rõ ràng, nguồn bằng chứng di chuyển, API đối soát/chi trả thật và contract ownership A/B. Không tự thay công thức DEMO hoặc dùng số dự kiến làm khoản phải trả. Lượt này không ghi MySQL, không tạo ledger và không chạy migration.

Giai đoạn 4, 06/11/2026: UI đối chiếu tổng các phân công + thưởng ngày từ API với tổng kỳ; thưởng ngày không chia lại vào từng dòng. Bộ lọc bảng kê cộng toàn bộ kết quả khớp, không chỉ 20 dòng của trang hiện tại; không thay đổi tổng kỳ. Nhóm ngày/tuần/tháng và từng nguồn phải giữ nguyên tổng Backend. Thu nhập xử lý timeout 20 giây, retry và kiểm tra lại session khi nhận 401/403 hoặc account binding thay đổi; chuyển kỳ không hiển thị tiền của kỳ cũ.

Nguồn bằng chứng di chuyển vẫn chưa được nối vào `StaffIncomeService`; dòng API hiện là UNVERIFIED, không tự suy km. Nhánh tính quãng đường xác minh chỉ được kiểm tra bằng fixture unit. API đối soát và Payment vẫn chưa có; không hiển thị 0đ như một khoản đã thanh toán.

QA riêng: `$env:RUN_STAFF_STAGE4_QA='true'; node qa/staff/stage4.browser.mjs`. Harness đọc SQL trong transaction READ ONLY, so A/B với API/BFF thật; thu nhập được ghi DEMO_PASS vì công thức minh họa. Loading/lỗi/timeout được gây bằng chặn kết nối và ghi MOCK_PASS; không tạo response tiền giả, không gọi AI, không seed/migrate.
