# Tự động xác nhận và điều phối đơn dịch vụ

Đơn dịch vụ tiếp tục dùng `order-service` và API `/api/v1/orders`. Đơn mua hàng tiếp tục dùng `/api/v1/product-orders`; migration, endpoint và nghiệp vụ kho không đổi.

## Quyết định tạo đơn

`POST /api/v1/orders` giữ `requestKey`, `expectedUnitPrice`, thông tin khách/nhà, thời điểm, ghi chú và payment simulation hiện tại. Có thể gửi thêm `contact.region` (tên phường/xã/khu vực riêng, tối đa 180 ký tự); field này không bắt buộc và không được suy ra từ chuỗi địa chỉ. Customer UI PR #11 chỉ rõ field này là tùy chọn.

API trả đơn đã lưu, gồm các field bổ sung:

- `decisionState`: `AUTO_CONFIRMED`, `NEEDS_DISPATCH`, `NEEDS_ADMIN`, hoặc `LEGACY` cho dữ liệu cũ.
- `decisionSource`: `SYSTEM`, `ADMIN`, hoặc `LEGACY`.
- `decisionReason`: giải thích cho khách và điều phối.
- `branchId`, `durationMinutes`: có thể `null` nếu chưa xác định an toàn.

`AUTO_CONFIRMED` chỉ được dùng khi server xác minh dịch vụ active, mapping khu vực duy nhất, chi nhánh active/nhận dịch vụ, kỹ năng đã cấu hình, thời lượng, nhân viên active/verified, availability bao phủ toàn khoảng và không có lịch chồng lấn. Đơn đã phân công có booking status `CONFIRMED`; queue vẫn là booking status `PENDING`. Thiếu mapping/availability hoặc dữ liệu không chắc chuyển `NEEDS_ADMIN`; đủ điều kiện chi nhánh nhưng nhân viên không rảnh chuyển `NEEDS_DISPATCH`. Tạo đơn queue vẫn là kết quả tạo đơn thật; response không tuyên bố đã xác nhận.

`requestKey` được kiểm tra trong transaction trước quyết định mới; retry trả về đơn đã lưu và không chạy phân công lần hai.

## API quản trị

Các endpoint chỉ chấp nhận role `ADMIN` qua middleware JWT/session hiện có:

- `GET /api/v1/admin/orders`: lọc `status`, `decisionState`, `branchId`, `from`, `to`, `reason`, phân trang `page`/`limit`.
- `GET /api/v1/admin/orders/:id`: chi tiết và lịch sử audit quyết định append-only.
- `GET /api/v1/admin/orders/:id/options`: chi nhánh nhận dịch vụ và nhân viên active/verified có kỹ năng; cho biết availability/conflict hiện tại.
- `POST /api/v1/admin/orders/:id/decisions`: action `assign`/`confirm`, `set-branch`, `needs-dispatch`, `needs-admin`, `reschedule`, `update`, `resolve-cancellation`, `reject`, `cancel`. Mọi mutation yêu cầu `reason`; assignment vẫn server-side kiểm tra branch, skill, availability và conflict trong transaction.

Assignment và quyết định booking là hai dữ liệu riêng. Đưa đơn về queue sẽ ngừng assignment đang hoạt động để Staff không nhận công việc đó. Chỉ assignment hợp lệ mới xuất hiện trong Staff jobs.

## Dữ liệu vận hành cần xác minh

Migration không tạo seed hoặc giả định dữ liệu nghiệp vụ. Sau khi DB owner áp dụng migration, người phụ trách phải nhập dữ liệu đã được xác nhận:

1. `branch_service_areas`: mỗi khu vực có `region_key` đã chuẩn hóa bởi `canonicalRegionKey` và `region_name`; kiểm tra không có nhiều chi nhánh cùng active cho một khu vực.
2. `branch_services`: đánh dấu dịch vụ chi nhánh thực sự nhận.
3. `service_auto_assignment_config`: đặt `skills_verified=TRUE` chỉ sau khi người phụ trách xác nhận danh sách kỹ năng. Ghi yêu cầu ở `service_required_skills`; bộ rỗng chỉ có nghĩa “không yêu cầu kỹ năng” khi đã được xác nhận rõ.
4. `employee_availability`: chỉ nhập ca/lịch có thật; nhân viên cần `status=ACTIVE`, `verification_status=VERIFIED`, đúng chi nhánh và đủ `employee_skills`.

Không có vùng/kỹ năng/availability xác nhận thì đơn tiếp tục vào queue. Ứng dụng không tự tạo lịch làm hoặc mapping.

Backend hiện chỉ có role `ADMIN` toàn cục; chưa có branch-admin scope. Vì vậy toàn bộ ADMIN có thể xem/thao tác mọi chi nhánh. Không gửi request xác thực runtime hoặc thay đổi role trong migration này.

## Migration, backup và kiểm thử

Chỉ áp dụng `databases/migrations/006_service_order_auto_assignment.sql` sau khi DB owner xác nhận đúng host/database, tạo backup phù hợp, kiểm tra preflight các cột/bảng/index chưa tồn tại và chọn maintenance window cho `ALTER TABLE`. Migration không tự chạy khi service start và không được thực thi trong task này. Xác minh sau migration các cột, foreign key, index và bảng; nếu kết quả DDL không chắc chắn, kiểm tra metadata trước, không chạy lại hoặc drop tự động.

Lệnh kiểm thử unit order và quyết định:

```powershell
cd backend
node --env-file-if-exists=.env --test --test-isolation=none tests/booking-auto-assignment.test.js tests/domain-integrity.test.js
```

`tests/customer-confirmation.test.js`, kiểm thử MySQL gateway và hồi quy kho cần dependency backend đã cài; kiểm thử tích hợp DB chỉ chạy sau khi có phê duyệt riêng cho database và migration 006. Không bật `ALLOW_CUSTOMER_DB_TEST` hoặc chạy migration theo mặc định. `/product-orders` không được dùng làm nguồn dữ liệu hoặc đi qua decision queue dịch vụ.
