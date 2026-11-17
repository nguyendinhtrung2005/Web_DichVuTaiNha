# Checklist bàn giao Auth thật cho UC9–UC12

Đây là checklist **chuẩn bị tích hợp**, không phải biên bản kiểm thử thành công. Việc có middleware JWT và unit test không chứng minh đã đăng nhập qua Auth thật. Chỉ đánh dấu một mục khi có bằng chứng từ môi trường tích hợp được nhóm cho phép; không ghi token, mật khẩu, hash hoặc nội dung `.env` vào bằng chứng.

Hướng dẫn cấu hình: [auth-integration.md](./auth-integration.md). Contract đang được Staff Service thực hiện: [auth-contract.md](./auth-contract.md). Dữ liệu kiểm thử phải được chuẩn bị riêng theo [test-data.md](./test-data.md), không tự seed hoặc sửa dữ liệu thật chỉ để làm kiểm thử đi qua.

## 1. Thành viên Auth cần bàn giao

- [ ] Luồng/endpoint đăng nhập **thật** cùng cách lấy access token; ghi URL, method và cấu trúc response đã triển khai trong tài liệu nội bộ, không tự đặt tên endpoint thay thành viên Auth.
- [ ] `JWT_ALGORITHM=RS256`, issuer chính xác và audience dành riêng cho Staff API. Xác nhận đây là access token phù hợp cho Backend, không dùng ID token chỉ vì có cùng chữ ký.
- [ ] Đúng **một** nguồn xác minh: PEM SPKI qua `JWT_PUBLIC_KEY` hoặc URL JWKS thật qua `JWT_JWKS_URL`. Private key thuộc Auth, không chuyển sang Staff Service.
- [ ] Chính sách thời hạn token, refresh/cấp lại token, logout và thu hồi phiên; phân biệt phần đã có với phần chưa triển khai.
- [ ] Nếu dùng JWKS: cách chọn khóa bằng `kid`, lịch rotation, thời gian duy trì khóa cũ và cách xử lý sự cố. Staff hiện cache JWKS tối đa 10 phút, cooldown 30 giây, timeout tải khóa 5 giây; cần duy trì khóa cũ đủ để xác minh token còn hạn và thử cả hai khóa trong giai đoạn chuyển tiếp.
- [ ] Nếu cần kiểm tra phiên hiện tại: Auth triển khai đúng contract GET của `AUTH_INTROSPECTION_URL`; URL này không được coi là có sẵn khi chưa bàn giao. Không cấu hình adapter chỉ để gọi một endpoint đăng nhập hoặc OAuth POST introspection có contract khác.
- [ ] Cách cấp token an toàn cho người kiểm thử: qua hệ thống secret hoặc file riêng có quyền truy cập hạn chế; không gửi lên Git, ảnh chụp hoặc log.

## 2. Chốt claim và mapping trước khi đăng nhập thử

| Nội dung | Điều kiện nhận bàn giao |
| --- | --- |
| Chữ ký | Token được Auth thật ký RS256; không dùng khóa/unit-test token của Staff Service |
| `iss`, `aud` | Khớp `JWT_ISSUER` và `JWT_AUDIENCE`; thống nhất audience Staff API thay vì dùng chung một cách ngầm định |
| `sub` | **Chuỗi `users.id`** canonical, số nguyên dương trong miền signed BIGINT `1..9223372036854775807` |
| ID khác | Không dùng `employees.id`, UUID Frontend localStorage hoặc claim riêng `userId` thay cho `sub`; middleware không dùng các trường đó để xác định danh tính. Nếu Auth vẫn phát `userId`, giá trị đó cần cùng user để tránh hiểu sai ở bên nhận, nhưng `sub` vẫn bắt buộc |
| `role` | Staff A/B: `EMPLOYEE` hoặc `STAFF` → nội bộ `staff`; token Customer phải giữ role Customer thật, không nâng quyền để chạy test |
| Thời gian | `exp` bắt buộc và chưa hết hạn; `nbf` nếu có phải đã tới; đồng bộ giờ vì `clockTolerance=0` |
| Claim trạng thái | Nếu có: `locked/isLocked:false`, `active/isActive:true`, `status/accountStatus:ACTIVE|ENABLED`; đúng kiểu boolean/chuỗi, không dùng `"false"` |

- [ ] Auth xác nhận các `sub` A/B/Customer trùng ID của dataset tích hợp đã được nhóm chuẩn bị. Dataset chưa tạo thì mục này vẫn **chưa đạt**, không thay bằng account giả trong memory.
- [ ] Staff A và B là hai `users.id` khác nhau, mỗi người có `employees.user_id` tương ứng và assignment riêng; không chia sẻ token hoặc dùng cùng một nhân viên cho cả hai vai trò kiểm thử.
- [ ] `users.status=ACTIVE`, `users.role=EMPLOYEE` và `employees.status=ACTIVE` của A/B được kiểm tra trên MySQL thật. Staff Service đọc lại các trường này trong mỗi nghiệp vụ, không chỉ dựa vào claim token.
- [ ] Tài khoản Customer có `users.id` thật trong cùng môi trường, token role Customer thật để kiểm chứng `403` tại Staff API; không cần tạo hồ sơ `employees` cho Customer.
- [ ] Thống nhất cách chuẩn bị tình huống khóa/ngừng hoạt động và phục hồi qua thành viên sở hữu tài khoản hoặc database QA được phép; không tự khóa tài khoản thật hoặc reset database.

## 3. Cấu hình Staff Service và bảo vệ thông tin đăng nhập

- [ ] Node.js 22+, dependency cài từ lockfile của `backend/staff-service`; không sửa Auth/Order/Frontend để lách contract.
- [ ] `.env` hiện hữu được giữ nguyên; chỉ điền cấu hình qua editor/secret manager sau khi nhóm bàn giao. Không chạy lệnh copy ghi đè hoặc in toàn bộ file.
- [ ] RS256 đặt đúng một nguồn khóa; để trống `JWT_SECRET` khi không dùng HS256. Issuer/audience/khóa phải cùng môi trường với ba access token.
- [ ] MySQL đúng schema dự án, quyền đọc cần thiết và quyền ghi giới hạn bảng Staff sở hữu. `check:schema` đạt; không reset hoặc seed ngoài dataset được cho phép.
- [ ] `CORS_ORIGINS=http://localhost:3002` khi kiểm tra Staff trên máy phát triển; origin khác phải được cấu hình rõ, không dùng wildcard. CORS không thay quyền JWT.
- [ ] Nếu bật introspection: response có `sub` trùng JWT, role Staff và `active:true`; lỗi Auth không được bỏ qua. Nếu chưa bật: ghi rõ chưa xác minh thu hồi từng phiên trên Auth theo thời gian thực.
- [ ] Kiểm tra Git ignore cho file cấu hình và mọi bản sao bằng metadata Git; không mở nội dung để kiểm tra. Pattern `.env.*` không bảo vệ tên có dấu cách như `.env copy.example`; bản sao có khả năng chứa bí mật cũng phải được ignore. Chỉ `.env.example` đã được rà soát không chứa bí mật mới được phép đưa vào Git.

Thiếu issuer/audience/thuật toán/nguồn khóa hoặc cấu hình MySQL bắt buộc khiến startup thất bại; không có auth bypass để chạy production. Tuy nhiên startup hiện chưa preflight Auth/JWKS từ xa và PEM được import bất đồng bộ: server listen không đủ để đánh dấu khóa hợp lệ hoặc Auth online. Phải kiểm tra bằng token Auth thật.

## 4. Đầu vào cho lượt HTTP integration

Bộ kiểm thử HTTP nhận token thật từ môi trường hoặc file riêng; không cấp token qua tham số dòng lệnh, không lưu token trong fixture/repository:

| Danh tính | Biến token trực tiếp | Hoặc biến đường dẫn file |
| --- | --- | --- |
| Staff A | `STAFF_HTTP_TOKEN_A` | `STAFF_HTTP_TOKEN_A_FILE` |
| Staff B | `STAFF_HTTP_TOKEN_B` | `STAFF_HTTP_TOKEN_B_FILE` |
| Customer | `STAFF_HTTP_TOKEN_CUSTOMER` | `STAFF_HTTP_TOKEN_CUSTOMER_FILE` |

- [ ] Mỗi danh tính có đúng một nguồn đầu vào rõ ràng. File token nằm ngoài repository, chỉ người kiểm thử được đọc; file chứa token thuần, không phải dump response chứa thêm thông tin đăng nhập.
- [ ] Đường dẫn file không phải file `.env`, bản sao cấu hình hoặc private key. Không in nội dung file để xác nhận token đã truyền.
- [ ] Token lấy từ luồng đăng nhập Auth thật, còn hạn cho toàn bộ lượt chạy; không tự ký token thay Auth khi biến còn thiếu.
- [ ] Base URL Staff trỏ đúng tiến trình đã cấu hình cùng MySQL/Auth; Gateway nếu chưa triển khai phải ghi rõ đang gọi trực tiếp Staff Service.
- [ ] Đã đối chiếu dataset, ID assignment và khoảng ngày lịch của A/B theo manifest được bàn giao; không tự thêm assignment trên dữ liệu dùng chung.
- [ ] Nếu thiếu token, cấu hình xác minh hoặc dataset: ghi **chưa đủ đầu vào/chưa kiểm chứng**, không chạy mock rồi báo kết quả là HTTP integration thật.

Bộ kiểm thử là `test/http.integration.test.js`, chạy bằng `npm.cmd run test:http`. Chỉ bật sau khi đã có các đầu vào thật ở trên:

```powershell
$env:RUN_STAFF_HTTP_TESTS = 'true'
npm.cmd run test:http
```

`STAFF_HTTP_BASE_URL` mặc định là `http://127.0.0.1:4005`; runner hiện chỉ cho URL loopback, không gửi token sang host từ xa. Cờ `RUN_STAFF_HTTP_TESTS=true` bật các kiểm tra HTTP đọc. Chưa có token Auth thật hoặc chưa nhập dataset hai nhân viên thì không chạy thay bằng token tự ký, không lấy unit test làm kết quả của lệnh này.

`RUN_STAFF_HTTP_WRITE_TESTS=true` là cờ **bổ sung** cho UC12, cần cờ đọc và `STAFF_HTTP_WRITE_BOOKING_ID=9109131`. Runner chỉ kết nối database `cleanhome_staff_test`; người chạy phải xác nhận server Staff/Order cũng dùng cùng database test. Shared fixture gồm job A `9109133` và job B `9109134`. Chỉ bật khi Order Service đã triển khai contract thật, dataset và tác động ghi đã được cho phép. Nhánh ghi thay đổi tiến độ fixture, không phục hồi/reset sau kiểm tra. Đọc [hướng dẫn HTTP](http-integration-testing.md) trước khi chạy.

Harness không tự đăng nhập vì endpoint Auth chưa được chốt. Thành viên Auth vẫn cần bàn giao method/path/payload/response của login thật, đồng thời cấp token RS256 A/B có role `EMPLOYEE` và token Customer có role `CUSTOMER` đúng ba tài khoản dataset.

## 5. Bằng chứng cần thu thập khi đủ đầu vào

| Nhóm | Kết quả cần chứng minh |
| --- | --- |
| Đăng nhập thật | Auth cấp access token A/B/Customer đúng issuer/audience/role và ID dataset; không ghi lại token trong báo cáo |
| UC9 | A chỉ thấy assignment của A; B chỉ thấy assignment của B; lọc/sắp xếp/phân trang đúng dữ liệu MySQL |
| UC10 | A mở chi tiết assignment của A; A mở assignment B nhận `404`; B vẫn truy cập được assignment của chính B |
| UC11 | A/B chỉ thấy lịch của chính mình theo khoảng ngày; khoảng sai bị từ chối; ngày hợp lệ không có việc trả mảng rỗng |
| Phân quyền | Không token/sai token/hết hạn → `401`; token Customer → `403`; header hoặc query tự khai userId/role không đổi danh tính JWT |
| Khóa/ngừng hoạt động | User hoặc employee không ACTIVE bị `403` từ kiểm tra MySQL; claim token khóa/ngừng hoạt động bị chặn theo contract |
| Dependency Auth | Introspection đã bật nhưng timeout/lỗi/malformed → từ chối an toàn `503`; lỗi 401/403 giữ đúng mã; JWKS/key rotation được kiểm chứng riêng |
| UC12 | Chỉ chạy cập nhật trạng thái khi Order Service và dataset ghi được đã được cho phép; ghi rõ dependency chưa có nếu chỉ kiểm tra các API đọc |

JWT còn hạn nhưng không đúng role hoặc DB không còn ACTIVE không được bỏ qua để lấy kết quả 200. Không sửa claim rồi dùng token đã mất chữ ký; token dùng kiểm chứng khóa/expiry/rotation cần do Auth thật cấp theo tình huống đã thống nhất.

## 6. Phiếu kết quả bàn giao

| Mục | Ghi nhận, không chứa bí mật |
| --- | --- |
| Môi trường/thời điểm | Điền sau khi kiểm tra thực tế |
| Bản Staff/Auth/Gateway | Commit hoặc phiên bản được nhóm cung cấp; không tự commit/push |
| Dataset | Tên manifest và xác nhận đã chuẩn bị; không ghi mật khẩu/hash |
| Nguồn token | Auth thật, phương thức cấp và thời hạn; không chép giá trị token |
| Xác minh | PEM cố định hoặc JWKS; rotation/introspection đã kiểm chứng hay chưa |
| Kết quả | Số ca đạt/trượt/chưa chạy và nguyên nhân; phân biệt unit, MySQL và HTTP/Auth thật |
| Phụ thuộc còn thiếu | Auth/Gateway/Order/dataset hoặc đầu vào token chưa có |

Mọi ô chưa có bằng chứng giữ trạng thái chưa hoàn tất. Không tuyên bố end-to-end chỉ dựa vào unit test ký JWT, HTTP dependency stub hoặc việc server đã mở cổng.
