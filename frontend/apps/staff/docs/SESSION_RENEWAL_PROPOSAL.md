# CleanHome — phạm vi phiên Staff tự gia hạn đã duyệt

**Trạng thái: người dùng đã phê duyệt triển khai Auth + Staff BFF; source opt-in đã được bổ sung.** Xác nhận nhận được trong hội thoại: “Duyệt triển khai Auth và Staff BFF”. Không tự ghi tên reviewer hoặc đường dẫn review không có thật. Báo cáo cấu hình và kiểm thử runtime nằm tại [SESSION_RENEWAL.md](SESSION_RENEWAL.md); tài liệu phạm vi này không tự xác nhận kiểm thử localhost đã PASS.

Mục tiêu hiện tại: Staff tiếp tục làm việc qua nhiều chu kỳ JWT, chuyển tab/F5 không mất phiên còn hợp lệ; local/QA có **hard cap 7 ngày tính từ login**, gia hạn không vượt mốc này. **Không sửa MySQL hoặc nghiệp vụ UC9–UC12.** Đăng xuất, hết hạn, khóa tài khoản và thu hồi vẫn có hiệu lực.

## Hiện trạng trước triển khai — giữ để giải thích nguyên nhân

- Auth `config.js` và `tokens.js`: access token mặc định 900 giây, cấu hình chỉ nhận 60–3600 giây; luôn có exp, kiểm chữ ký RS256/issuer/audience/expiry.
- Staff `src/auth.js`: JWT cần exp và được JOSE kiểm hết hạn. Không chấp nhận token tự bỏ exp.
- BFF cũ `config.mjs`, `auth-core.mjs`: phiên/cookie không dài hơn JWT và giới hạn cấu hình một giờ; đây là hành vi legacy, không áp dụng phiên renewable mới.
- Auth tại mốc phân tích ban đầu chỉ có login, introspection, JWKS và health. Nhận định chưa có refresh/logout khi đó là lịch sử; xem contract extension hiện tại bên dưới.

Vì vậy, chỉ sửa cookie hoặc `.env` Staff không đáp ứng yêu cầu. Gỡ exp, lưu password để tự login, hoặc kéo JWT thành token vĩnh viễn sẽ thay đổi các bảo vệ và contract đã nghiệm thu; không được áp dụng ngầm.

## Phương án đã được duyệt và triển khai trong source

1. Giữ access JWT RS256 có hạn ngắn hiện tại, các claim/role và xác minh Staff giữ nguyên.
2. Auth phát thêm opaque refresh credential ngẫu nhiên cho BFF qua contract mới. Browser không nhận access/refresh token; BFF giữ chúng trong kho server được mã hóa hiện có.
3. Để tuân thủ yêu cầu không sửa MySQL: Auth lưu hash của refresh credential và thông tin phiên/rotation/thu hồi trong **kho file mã hóa bền vững riêng của Auth**, ngoài source/public, được Git ignore và bảo vệ ACL. Không lưu password, không dùng process-memory store. Phương án này chỉ dành cho local/QA một máy; không tự gọi là giải pháp production nhiều replica. Không tạo bảng/cột, chạy migration hoặc ghi dữ liệu nghiệp vụ.
4. Auth refresh atomically rotate credential, kiểm lại users/employee ACTIVE và role; phát JWT mới. Phát hiện credential cũ bị dùng lại, thu hồi đúng family/session theo chính sách được duyệt. Không cho retry tạo hai nhánh credential song song; cần contract xử lý response loss và khóa đồng thời rõ ràng.
5. BFF thêm renew action cùng origin có Origin/CSRF guard như login/logout. Renew trước deadline trong lúc người dùng làm việc; dùng mutex/CAS để nhiều request/tab không refresh trùng. Thay token trong cùng phiên mã hóa, cập nhật expiresAt/cookie theo credential mới.
6. Provider chỉ chuyển về login khi Auth xác nhận phiên không còn hợp lệ. Outage giữ lỗi phụ thuộc, không coi là logout hoặc trả thành công giả. Timer nhận expiresAt mới sau renewal, không dùng deadline cũ xóa phiên đã gia hạn.
7. Logout thu hồi phiên server và refresh credential ở Auth theo cơ chế idempotent; khóa tài khoản/role change tiếp tục bị từ chối. Không xóa phiên của người khác.

### Contract opt-in hiện có trong source

| Thành phần | Endpoint | Mục đích |
| --- | --- | --- |
| Auth | POST `/api/v1/auth/refresh` | Rotate refresh credential, trả access JWT/refresh credential mới cho BFF |
| Auth | POST `/api/v1/auth/logout` | Thu hồi refresh session/family đã xác minh |
| Staff BFF | POST `/api/auth/renew` | Browser yêu cầu gia hạn bằng cookie HttpOnly, không gửi/nhận JWT |

Contract chính xác về request/response, BFF client credential, mã lỗi, rotation, retry và logout: cần owner Auth cung cấp và phê duyệt riêng; session renewal vẫn mặc định tắt. Route có trong source không đồng nghĩa tiến trình Auth đang chạy đã nạp code/cấu hình mới; cần restart đúng service và kiểm chứng HTTP theo báo cáo runtime.

## Quyết định và giới hạn được ghi nhận

- Phạm vi Auth + Staff BFF/Provider và contract refresh mới đã được người dùng duyệt; **không thay MySQL**, không triển khai migration hoặc thay đổi UC9–UC12.
- JWT vẫn mặc định 15 phút. Local/QA mặc định idle và hard cap đều 604800 giây (7 ngày); gia hạn access token không kéo dài hard cap tính từ login. Cấu hình `0` bỏ hard cap chỉ là khả năng QA tường minh, không phải chính sách local được chọn cho yêu cầu này. Khi renewal production được bật, hard cap tối đa 8 giờ, idle tối đa 30 phút, path tuyệt đối/volume bền vững và HTTPS vẫn bắt buộc. Cờ renewal mặc định tắt cho đến khi kho riêng và credential BFF được cấu hình.
- Session TTL và token TTL tách biệt. F5 sau khi access token hết hạn vẫn có thể renew bằng refresh credential server-side nếu phiên chưa hết hạn. Không giữ password để gọi login lại, không tắt kiểm tra JWT exp. Không quảng cáo phiên là vĩnh viễn.
- Logout/lock/đổi quyền/đổi password và sự cố security phải thu hồi được. Người dùng xóa cookie, mất kho phiên/khóa hoặc service không sẵn sàng vẫn có thể phải đăng nhập lại; không hứa bảo toàn đăng nhập vô điều kiện.
- Quyền tạo kho phiên local Auth, backup/rollback cho file session, rotation/idempotency và đối chiếu trạng thái sau timeout. Không dùng lại workflow UC12 hoặc reset account/bookings để test phiên.

## Checklist kiểm chứng — kết quả thực tế xem báo cáo runtime

- Fake clock: qua nhiều chu kỳ 15 phút vẫn hoạt động khi renew thành công; JWT cũ thực sự hết hạn vẫn bị từ chối.
- Real Auth → BFF → Staff read bằng JWT mới, đúng A/B và cross-assignment 404.
- Hai tab/request đồng thời; response refresh mất/timeout; rotation/reuse detection; restart giữ phiên bền vững; transaction rollback.
- Logout/locked user/role change/credential revoked ngừng renewal; phân biệt 401 với outage 503.
- Browser không có JWT/password/refresh credential trong localStorage/sessionStorage/URL/log; cookie HttpOnly/SameSite/Secure theo môi trường, CSRF/Origin giữ nguyên.
- Typecheck/build Staff và unit/contract/HTTP tests của Auth, Staff/BFF bị ảnh hưởng. UC12 write vẫn không nằm trong kiểm tra phiên.

## Ranh giới nghiệm thu

Source Auth/BFF/Provider và unit test đã được bổ sung theo phê duyệt riêng cho refresh; phê duyệt này độc lập với việc reset mật khẩu QA trước đó. Việc cấu hình local, khởi động service, kiểm thử sau hạn JWT và kết quả PASS/FAIL/NOT_RUN phải được ghi theo bằng chứng thực tế tại [SESSION_RENEWAL.md](SESSION_RENEWAL.md). Không coi tài liệu này là bằng chứng đã chạy localhost hoặc production. Index/staging, dữ liệu QA hiện có và các thay đổi ngoài phạm vi phải được bảo toàn.
