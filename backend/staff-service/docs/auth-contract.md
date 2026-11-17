# Contract Auth → Staff Service

Staff Service không cấp tài khoản, mật khẩu hoặc token. Auth Service hiện thuộc thành viên khác; tài liệu này ghi hợp đồng mà middleware `src/auth.js` thực sự kiểm tra, không khẳng định Auth đã triển khai endpoint đăng nhập.

## Access token

Request dùng `Authorization: Bearer <JWT>` với chữ ký **HS256 hoặc RS256 theo đúng cấu hình**, issuer/audience khớp `JWT_ISSUER/JWT_AUDIENCE`, `exp` chưa hết hạn. Middleware không chấp nhận `alg:none`, sai algorithm hoặc tự nhận danh tính qua `staffId`, `userId`, `X-User-Id`, `X-Role`.

JWT cần `sub` là chuỗi `users.id` BIGINT dương, không phải employees.id; tối đa BIGINT signed MySQL. Claim `role` phải là `EMPLOYEE` hoặc `STAFF` (không phân biệt hoa thường), ánh xạ nội bộ Frontend `staff`. Các claim trạng thái nếu được Auth cung cấp phải nhất quán: `locked/isLocked:false`, `active/isActive:true`, `status/accountStatus:ACTIVE|ENABLED`. Sai kiểu hoặc tài khoản khóa bị từ chối 403, không ép chuỗi `"false"` thành false.

RS256 dùng đúng một nguồn `JWT_PUBLIC_KEY` hoặc `JWT_JWKS_URL`. HS256 dùng secret ít nhất 32 byte từ môi trường; không có secret hardcode hoặc token mẫu cố định. Không log token, mật khẩu hoặc hash.

Sau xác thực, mỗi nghiệp vụ kiểm tra lại user role/status và employees.status trong MySQL. Assignment truy vấn theo employees.id tìm từ JWT sub; không dùng employee ID tự truyền từ client. Token hợp lệ nhưng user/employee bị khóa vẫn không truy cập được. Chưa có cơ chế thu hồi phiên tức thời trong schema; có thể cấu hình adapter trạng thái phía dưới khi Auth thật hỗ trợ.

## Kiểm tra phiên hiện tại tùy chọn

Nếu cấu hình `AUTH_INTROSPECTION_URL`, middleware gọi **GET URL được cấu hình**, chuyển Bearer đang xác minh tới Auth, không theo redirect, timeout 5 giây. Đây là contract đề xuất của adapter, không đặt tên một endpoint giả là đã tồn tại.

Auth cần trả JSON 200:

```json
{"sub":"7","role":"EMPLOYEE","active":true}
```

`sub` phải trùng JWT; `active` phải là boolean true và role vẫn Staff. Có thể thêm những claim trạng thái ở trên. Auth trả 401 thì Staff trả 401; 403 thì Staff trả 403; timeout/network/JSON sai hoặc lỗi dependency trả 503, không cho request đi qua khi kiểm tra phiên thất bại.

Không bật introspection khi Auth chưa triển khai contract. Khi chưa bật, chữ ký/expiry JWT và trạng thái user/employee trong MySQL vẫn được kiểm tra; không khẳng định đã xác minh logout/revocation trên Auth theo thời gian thực. JWT Frontend localStorage hiện tại không phải access token Backend và không được chuyển giả thành JWT hợp lệ.

## Các phần chưa được chứng minh end-to-end

Chưa có token thật do Auth của nhóm cấp, key rotation thực tế, endpoint introspection thật hoặc Gateway proxy thật trong kiểm thử hiện tại. Test dùng key sinh ngẫu nhiên riêng cho test, JWT được ký/xác minh thật; dependency Auth HTTP dùng stub được phân biệt với tích hợp thực tế.
