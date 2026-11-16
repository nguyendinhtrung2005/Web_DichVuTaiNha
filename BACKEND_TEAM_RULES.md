# CleanHome — Quy tắc phát triển Frontend & Backend thống nhất cho nhóm 3 người

> **Phiên bản:** 3.0 · **Ngày cập nhật:** 30/10/2026 · **Trạng thái:** bản quy chuẩn đề xuất chờ nhóm phê duyệt  
> **Áp dụng cho:** tất cả thành viên và AI coding assistant (Codex, Claude Code, …) khi sửa Frontend, Backend và phần tích hợp CleanHome.  
> **Nguyên tắc cốt lõi:** **Mỗi thành viên phụ trách trọn vẹn frontend và backend cho một vai trò; dùng chung service/dữ liệu qua hợp đồng đã duyệt; mỗi bảng có một owner ghi; bảo vệ code đã nghiệm thu của cả ba thành viên.**

## 0. Cách sử dụng tài liệu

1. Lưu tài liệu này ở **thư mục gốc** repository dưới tên `BACKEND_TEAM_RULES.md` và commit để mọi người cùng nhận được.
2. Trước mỗi nhiệm vụ Frontend/Backend, AI **phải đọc** `AGENTS.md` ở gốc, **tài liệu này**, các `README`/contract liên quan và trạng thái Git. Nếu dùng Claude Code, hãy yêu cầu đọc tài liệu này trong prompt hoặc dẫn chiếu từ `CLAUDE.md`; nếu dùng Codex, dẫn chiếu từ `AGENTS.md` hiện có. **Không giả định AI tự động đọc file này** nếu chưa được chỉ dẫn.
3. Khi mâu thuẫn giữa mô tả cũ và code/contract đã được nhóm chấp thuận, **không tự quyết**: báo rõ điểm khác biệt, đề xuất cách giải quyết và xác nhận với chủ sở hữu service trước khi sửa.
4. Tài liệu này định nghĩa **quy trình và phân công đề xuất**; các REST endpoint chưa hiện diện trong code không được báo là đã triển khai.
5. **Phạm vi hiệu lực:** frontend của cả ba website, backend, cơ sở dữ liệu, contract liên service, API Gateway và cấu hình tích hợp. Nếu AI nhận yêu cầu thuộc phần chưa được phân công, nó phải **chỉ phân tích/đề xuất**, không tự ý triển khai.
6. **Độ ưu tiên:** yêu cầu bảo mật và quy tắc hệ thống/công cụ > chỉ dẫn trực tiếp của chủ nhiệm nhiệm vụ (nếu hợp lệ) > `AGENTS.md`/`CLAUDE.md` áp dụng > file này > README và tài liệu nghiệp vụ. **Riêng các quyết định kiến trúc/contract đã được nhóm phê duyệt** là chuẩn dự án; gặp mâu thuẫn phải dừng phần xung đột và xin quyết định thay vì lặng lẽ chọn tài liệu thuận tiện.
7. **Không đồng nhất “AI đã báo xong” với “đã được nghiệm thu”**; mọi trạng thái triển khai phải có commit/PR/test và môi trường được chỉ rõ.

### Prompt mở đầu dùng chung (dán vào Codex/Claude Code)

```text
Bạn đang phát triển Frontend và Backend CleanHome cùng nhóm 3 người:
- Thưởng: trọn vẹn Customer (frontend + backend).
- Trung: trọn vẹn Admin (frontend + backend).
- Tùng: trọn vẹn Staff (frontend + backend).
Trước khi làm, đọc AGENTS.md, BACKEND_TEAM_RULES.md,
README của service liên quan và API contract hiện có.
Kiểm tra git status/nhánh hiện tại, xác định owner theo vai trò, phạm vi file,
các dependency liên service và kế hoạch kiểm thử.
Chỉ sửa phần được giao, không ghi đè code đã nghiệm thu của BẤT KỲ thành viên nào,
không sửa API contract hoặc schema chung khi chưa được đồng ý.
Nếu cần sửa module/file chung hoặc miền dữ liệu do người khác sở hữu, ghi rõ impact
và dừng phần đó để xin owner phê duyệt.
Không tự commit, push, merge, đổi nhánh, chạy seed/migration ghi dữ liệu,
hoặc tiết lộ secrets. Báo rõ PASS/FAIL/SKIP và các giới hạn kiểm chứng.
Nhiệm vụ của tôi: <MÔ TẢ NHIỆM VỤ TẠI ĐÂY>.
```

## 1. Kiến trúc chuẩn của dự án

| Thành phần | Định hướng bắt buộc |
|---|---|
| Kiến trúc | Microservices hiện có; tích hợp bằng REST API theo hợp đồng được thống nhất; **chia trách nhiệm theo vai trò sử dụng, không tự tách lại service** |
| Backend | Giữ Node.js và các cấu hình/framework **thực tế** của từng service; không đổi stack tùy tiện |
| Dữ liệu | MySQL; tài liệu trước đây ghi nhận môi trường test `cleanhome_staff_test` có 32 bảng; phải kiểm tra trạng thái hiện tại trước khi sử dụng |
| Frontend | Next.js/React/TypeScript, ba website riêng: **Customer `3001` (Thưởng)**; **Staff `3002` (Tùng)**; **Admin `3003` (Trung)**; đây là thông tin cấu hình đã được báo cáo, cần kiểm tra trong repo |
| Auth | Auth Service được báo cáo dùng MySQL, đăng nhập bằng **số điện thoại**, JWT **RS256**, JWKS/introspection; cổng local `4001` |
| Staff | Staff Service local `4005`; UC9–UC11 được báo cáo đã kiểm thử HTTP với JWT thật; UC12 cần tích hợp Order |
| Order | Endpoint/cổng triển khai thực tế phải lấy từ config và tài liệu của owner; **không đoán cổng** |
| API Gateway | Một điểm vào chung nếu cấu hình gateway đã triển khai; không tự bypass hay giả định gateway đã hoạt động |

- **Phân công theo vai trò không đồng nghĩa tạo ba backend độc lập hoặc ba database độc lập.** Thưởng triển khai toàn bộ tính năng Customer, Trung triển khai toàn bộ tính năng Admin, Tùng triển khai toàn bộ tính năng Staff; mỗi người làm giao diện, API dành cho vai trò của mình, nghiệp vụ, kiểm thử và kết nối frontend–backend trong **phạm vi đã phê duyệt**.
- Một microservice hiện có có thể phục vụ nhiều vai trò; một UC có thể gọi nhiều service. **Không tạo microservice mới cho mỗi UC hoặc mỗi vai trò** khi chưa có ADR được nhóm duyệt.
- **REST contract** là ranh giới tích hợp. Không truy cập repository nội bộ của service khác, không tự viết trực tiếp vào bảng do người khác sở hữu. Backend theo vai trò có thể là controller/router/module trong kiến trúc hiện có hoặc lớp API phù hợp **nếu repo thực sự đã có**; không tự giả định có BFF.
- Nếu đang dùng **một MySQL instance/schema test chung**, đó là phương án chuyển tiếp; vẫn phải tuân thủ quyền sở hữu ghi theo bảng. Không xem `databases/*-db` là bằng chứng database vật lý đã tách.

## 2. Phân công và quyền sở hữu code (nhóm 3 người)

**Phân công được cập nhật theo yêu cầu của nhóm:** mỗi người là chủ sở hữu triển khai **toàn bộ frontend và backend của một vai trò**, không chia theo kiểu “người làm frontend, người làm backend”. Quyền sở hữu **API theo vai trò** khác với quyền sở hữu **service/dữ liệu dùng chung**; hai quyền này phải được phối hợp bằng contract.

| Thành viên | Vai trò phụ trách | Frontend phụ trách hoàn toàn | Backend phụ trách hoàn toàn | Trách nhiệm nghiệm thu |
|---|---|---|---|---|
| **Thưởng** | **Customer / Khách hàng** | Toàn bộ website Customer, các trang, component, form, state, xác thực và trải nghiệm mua/đặt dịch vụ | Toàn bộ backend/API/nghiệp vụ dành cho Customer: tài khoản, danh mục và chi tiết dịch vụ/sản phẩm, đặt dịch vụ, giỏ và đơn sản phẩm, hủy, lịch sử, thanh toán mô phỏng, đánh giá và các luồng Customer trong phạm vi đồ án | Chịu trách nhiệm end-to-end kiểm thử chức năng Customer, API và luồng Frontend ↔ Backend Customer |
| **Trung** | **Admin / Quản trị viên** | Website Admin, dashboard, biểu mẫu và giao diện quản lý | API/controller/logic dành cho quản trị: quản lý tài khoản, dịch vụ, đơn, nhân viên, lịch, thanh toán, đánh giá, thống kê/báo cáo theo UC Admin | Test chức năng Admin, phân quyền và luồng Frontend ↔ Backend Admin |
| **Tùng** | **Staff / Nhân viên** | Website Staff, các màn hình hồ sơ, đơn được giao, lịch làm việc và cập nhật tiến độ | API/controller/logic dành cho nhân viên: tài khoản/hồ sơ, assignment, thông tin công việc, lịch làm việc, check-in/out và trạng thái công việc | Test chức năng Staff, ownership assignment và luồng Frontend ↔ Backend Staff |

**Ranh giới thực hiện:**

- **Thưởng không tự sửa** giao diện, API hành vi đặc thù Admin/Staff của Trung/Tùng. **Trung không tự sửa** phần Customer/Staff. **Tùng không tự sửa** phần Customer/Admin. Ngoại lệ: thay đổi được các owner liên quan duyệt và ghi lại bằng PR/contract.
- Với phạm vi Customer, **Thưởng là người phụ trách triển khai duy nhất từ frontend đến backend; không cần chuyển phần việc Customer cho owner vai trò khác**. Quy tắc này không tự chuyển quyền ghi các bảng dữ liệu dùng chung: migration/schema, API contract hoặc thay đổi có ảnh hưởng tới Admin/Staff vẫn cần review/phê duyệt theo quy trình ở các mục dưới.
- Mỗi người chủ trì frontend thuộc vai trò mình; **đường dẫn chính xác phải xác minh từ repo**, không suy đoán các thư mục frontend chỉ từ port `3001–3003`. Backend thuộc vai trò của mình có thể nằm chung service với phần của người khác; phải lập danh sách **file/router/module** trước khi sửa.
- Khi một tính năng Admin/Staff cần ghi dữ liệu do một người khác làm owner, Trung/Tùng vẫn tự phát triển **luồng backend của vai trò mình** và gọi API/contract được owner dữ liệu cung cấp; **không được bypass bằng SQL ghi trực tiếp**. Bên cung cấp có trách nhiệm triển khai/thay đổi API miền dữ liệu theo contract đã thống nhất.

### 2.1. Đầu mối kỹ thuật cho service/miền dùng chung (phân công đề xuất)

Bảng này **không chuyển giao toàn bộ tính năng của một vai trò sang người khác**; chỉ xác định đầu mối review các file dùng chung và logic ghi dữ liệu. Nếu repo có owner đã được duyệt khác, phải đối chiếu trước khi áp dụng.

| Thành phần đang được tài liệu hóa | Đầu mối chính đề xuất | Nguyên tắc phối hợp |
|---|---|---|
| `backend/auth-service/`, `backend/user-service/` | **Thưởng** | Auth/JWT/schema tài khoản dùng chung; Trung và Tùng tự phát triển luồng đăng nhập/phân quyền phía Admin/Staff bằng contract đã duyệt |
| `backend/api-gateway/` | **Thưởng** (điều phối kỹ thuật) | Mọi thay đổi route, CORS, auth middleware cho Admin/Staff cần Trung/Tùng xác nhận; không độc quyền quyết định gateway |
| `backend/service-service/` | **Trung** (đầu mối miền Catalog dùng chung, theo đề xuất) | Thưởng phụ trách toàn bộ yêu cầu, API và tích hợp Catalog trong luồng Customer, gồm xem/tìm dịch vụ và sản phẩm. Đầu mối miền Catalog không phải owner vai trò Customer; quyền ghi các bảng Catalog vẫn theo Mục 3 và cần phối hợp nếu thay schema hoặc ảnh hưởng luồng Admin |
| `backend/order-service/` | **Thưởng** | Thưởng sở hữu ghi booking; Trung và Tùng xây dựng backend Admin/Staff và tích hợp qua API Order đã duyệt |
| `backend/staff-service/` | **Tùng** | Tùng sở hữu dữ liệu nhân viên/assignment; Trung xây dựng backend quản trị nhân viên/phân công thông qua API hợp đồng |
| `backend/payment-service/`, `backend/review-service/` | **Thưởng** | Thưởng sở hữu nghiệp vụ giao dịch/đánh giá; Trung xây dựng backend quản lý/duyệt/báo cáo bằng API được phê duyệt |
| Module thống kê, báo cáo phía Admin | **Trung** | Trung sở hữu API/giao diện báo cáo; Thưởng/Tùng cung cấp DTO/nguồn dữ liệu theo contract; không đọc xuyên DB không được phép |

**Lưu ý:** Các đường dẫn backend trên được giữ từ tài liệu gốc, **không phải xác nhận các file/module đang tồn tại**. Đặc biệt không mặc nhiên tạo thêm service, backend Admin mới, backend Customer mới hay backend Staff mới nếu kiến trúc đã có cách triển khai phù hợp.

**File dùng chung** như bootstrap, router gốc, config, middleware, `package.json`, lockfile, migrations, schema, API Gateway: chỉ đầu mối tích hợp/owner được nhóm thống nhất chủ trì sửa. Người có nhu cầu gửi PR nhỏ, tác động và kiểm thử hồi quy. **Bảo vệ code đã nghiệm thu của cả Thưởng, Trung và Tùng**; owner không có quyền tự ý ghi đè phần của người còn lại.

**Ma trận review tối thiểu:** Người làm UC chịu trách nhiệm frontend/backend theo vai trò và test E2E; owner dữ liệu duyệt thao tác ghi/migration; owner file dùng chung duyệt tích hợp; provider và consumer cùng duyệt contract; ít nhất một thành viên khác review PR trước khi merge theo quy trình nhóm.

## 3. Quyền sở hữu dữ liệu — 32 bảng

**Đề xuất owner ghi duy nhất theo miền nghiệp vụ, phục vụ phân công 3 vai trò** (cần ba thành viên phê duyệt; không khẳng định đây là DB ownership đã triển khai):

| Owner ghi đề xuất | Các bảng logic được sở hữu | Số bảng |
|---|---|---:|
| **Thưởng — Customer / tài khoản, đơn, tương tác** | `users`, `addresses`, `bookings`, `booking_items`, `booking_status_history`, `subscriptions`, `entitlements`, `voucher_redemptions`, `payments`, `reviews`, `conversations`, `conversation_members`, `messages`, `notifications` | **14** |
| **Trung — Admin / danh mục, khuyến mãi, tài chính quản trị** | `service_categories`, `services`, `service_packages`, `package_items`, `product_categories`, `products`, `product_images`, `product_inventory`, `vouchers`, `voucher_services`, `revenue_shares` | **11** |
| **Tùng — Staff / nhân sự, phân công** | `branches`, `employees`, `employee_availability`, `skills`, `employee_skills`, `certificates`, `assignments` | **7** |
| **Tổng** | **32 bảng, mỗi bảng đúng một owner ghi đề xuất** | **32** |

**Quy tắc không thể bỏ qua:**

- **Owner ghi không có nghĩa là người duy nhất được triển khai API theo vai trò.** Ví dụ Trung tự triển khai backend quản lý đơn của Admin nhưng phải dùng contract Order do Thưởng duy trì; Thưởng tự triển khai hiển thị danh mục Customer nhưng dùng contract Catalog do Trung duy trì; Trung tự triển khai phân công Admin nhưng ghi assignment thông qua contract Staff do Tùng duy trì.
- Các bảng `users` và Auth phục vụ cả ba vai trò. Thưởng là đầu mối dữ liệu/xác thực **đề xuất**; Trung và Tùng phải tự bảo vệ API Admin/Staff bằng RBAC + object authorization; không tự thay đổi schema/token chung.
- Các luồng thông báo/hội thoại có thể phục vụ cả ba vai trò; owner đề xuất là Thưởng. Quyền tạo/xem/sửa/xóa theo từng vai trò phải cụ thể hóa bằng contract; không hiểu owner là quyền xem mọi dữ liệu.
- Chỉ owner được thay đổi logic ghi của bảng thuộc miền mình; dịch vụ/role khác cần API hợp đồng đã duyệt. Nếu code cũ đọc xuyên bảng trên một DB test, ghi nhận **nợ kiến trúc** và không mở rộng phụ thuộc mới.
- Mọi thay đổi schema cần migration có phiên bản, lý do, ảnh hưởng, hướng nâng cấp/rollback, review owner bảng và owner service bị ảnh hưởng. Không sửa schema gốc hoặc dùng `SET FOREIGN_KEY_CHECKS=0` để che lỗi dữ liệu.
- Không tự chạy `DROP`, `TRUNCATE`, `DELETE`, seed, migration ghi dữ liệu hay reset DB. Chỉ ghi trên database thử nghiệm đã xác minh và được chấp thuận rõ.
- `databases/schema.sql` là nguồn schema tham khảo được tài liệu gốc nêu là 32 bảng; `schema_staff_test.sql` và `seed_staff_test*.sql` chỉ phục vụ kiểm thử, không đồng nghĩa production.
- ID xuyên service tham chiếu qua ID/DTO và kiểm tra bằng API. Khi tách database, không tạo FK/JOIN xuyên service như thể còn một schema vật lý.

## 4. Use Case → owner toàn bộ frontend/backend → phối hợp

> **Mã UC dưới đây kế thừa từ tài liệu gốc, vẫn là mã tạm**; giữ **UC9–UC12** cho Staff. “Đặt dịch vụ” chưa được chốt mã. Việc phân công owner theo **vai trò** là thay đổi chính: Thưởng nắm toàn bộ Customer, Trung nắm toàn bộ Admin, Tùng nắm toàn bộ Staff. Cột phối hợp thể hiện dependency hợp đồng, **không chuyển giao trách nhiệm code giao diện/backend vai trò**.

| Nhóm | UC | Chức năng | Owner toàn bộ Frontend + Backend | Phối hợp khi cần API/dữ liệu dùng chung |
|---|---|---|---|---|
| Customer | UC1 | Quản lý tài khoản | **Thưởng** | Trung/Tùng nếu thay đổi Auth dùng chung ảnh hưởng họ |
| Customer | UC2 | Xem/tìm kiếm dịch vụ | **Thưởng** | Trung (Catalog) |
| Customer | Chưa chốt mã | Đặt dịch vụ (nếu thuộc phạm vi cuối) | **Thưởng** | Trung (Catalog), Tùng (lịch/nhân viên nếu có) |
| Customer | UC3 | Quản lý đơn | **Thưởng** | Trung/Tùng nếu đổi trạng thái liên vai trò |
| Customer | UC4 | Hủy dịch vụ | **Thưởng** | Trung/Tùng nếu thay đổi tác động Admin/Staff |
| Customer | UC5 | Thanh toán | **Thưởng** | Trung (đối soát/quản trị, khi có) |
| Customer | UC6 | Đánh giá | **Thưởng** | Trung (duyệt/quản lý đánh giá) |
| Customer | UC7 | Lịch sử dịch vụ | **Thưởng** | — |
| Staff | UC8 | Quản lý tài khoản nhân viên | **Tùng** | Thưởng (Auth/tài khoản chung) |
| Staff | **UC9** | Xem đơn được phân công | **Tùng** | Thưởng (Order/Auth) |
| Staff | **UC10** | Xem thông tin công việc | **Tùng** | Thưởng (Order/Auth) |
| Staff | **UC11** | Xem lịch làm việc | **Tùng** | Thưởng (Auth), Trung (quản lý lịch nếu cần) |
| Staff | **UC12** | Cập nhật trạng thái công việc | **Tùng** | **Thưởng (Order)**; Trung nếu dashboard Admin tiêu thụ trạng thái |
| Admin | UC13 | Quản lý tài khoản | **Trung** | Thưởng (Auth/User); Tùng (hồ sơ nhân viên) |
| Admin | UC14 | Quản lý dịch vụ | **Trung** | Thưởng (Customer tiêu thụ catalog) |
| Admin | UC15 | Quản lý đơn | **Trung** | Thưởng (Order); Tùng (assignment nếu có) |
| Admin | UC16 | Phân công nhân viên | **Trung** | Tùng (Staff/assignment); Thưởng (Order) |
| Admin | UC17 | Quản lý lịch nhân viên | **Trung** | Tùng (Staff/availability) |
| Admin | UC18 | Quản lý thanh toán | **Trung** | Thưởng (Payment) |
| Admin | UC19 | Quản lý đánh giá | **Trung** | Thưởng (Review); Tùng nếu liên quan nhân viên |
| Admin | UC20 | Thống kê/báo cáo | **Trung** | Thưởng, Tùng cung cấp dữ liệu qua contract |

**Diễn giải bắt buộc:** “Owner toàn bộ Frontend + Backend” có nghĩa người đó chịu trách nhiệm thiết kế, lập trình, kết nối API và kiểm thử **mọi luồng thuộc website/vai trò của mình**. Nếu phải gọi một miền dữ liệu thuộc người khác, người đó **không được tự sửa API hay viết SQL thay owner**, mà gửi API request và tích hợp contract; đây là phối hợp kỹ thuật, không chia lại công việc theo vai trò.

**Không nhân bản endpoint dùng chung**: Auth login có thể được ba website tiêu thụ; `booking` canonical thuộc Order; Staff UC12 dùng contract với Order thay vì tạo trạng thái đơn song song trong Staff.

## 5. Quy chuẩn REST API và hợp đồng giữa service

### 5.1. Contract trước code

Đối với tính năng liên service **hoặc liên vai trò** (Customer–Admin–Staff), trước khi code phải có tài liệu contract được **owner provider và owner consumer duyệt**, tối thiểu gồm:

1. Endpoint + HTTP method + URL base và phiên bản (ưu tiên `/api/v1` cho public, `/internal/v1` cho service-to-service, **trừ khi hợp đồng hiện tại quy định khác**).
2. Auth của caller: JWT người dùng, token nội bộ, service identity, scope và quyền; **không dùng endpoint internal công khai**.
3. Request/response DTO với tên trường, kiểu, bắt buộc/nullable, mã trạng thái, timezone, enum.
4. Validation, mã lỗi, quyền truy cập, xử lý dữ liệu không tồn tại.
5. Idempotency, retry/timeout, xung đột đồng thời, trạng thái kết quả và cơ chế phục hồi.
6. Người sở hữu API, người tiêu thụ, test contract và cách nâng phiên bản.

**Không tự đổi tên endpoint hoặc enum.** Nếu cần đổi, sửa contract bằng PR trước, đồng thời cập nhật consumer và test; không thay đổi phá vỡ tương thích một phía.

### 5.2. Quy ước API tối thiểu

- JSON UTF-8; input được validate và chuẩn hóa; query DB parameterized; DTO tách khỏi entity DB.
- HTTP: `200/201/204` thành công; `400/422` dữ liệu không hợp lệ; `401` chưa xác thực; `403` không đủ quyền; `404` không có tài nguyên/quyền xem theo chính sách; `409` xung đột trạng thái; `500/503` lỗi dịch vụ. Giữ **error schema thống nhất với contract hiện có**, không tự phát minh format gây vỡ client.
- Trả về timestamp theo ISO 8601 kèm timezone hoặc UTC; nhất quán lưu UTC, hiển thị theo **Asia/Ho_Chi_Minh** ở Frontend. Không bỏ timezone hoặc tự cộng 7 giờ trong DB.
- Pagination, filter và sort phải được tài liệu hóa; có giới hạn `pageSize/limit` và whitelist sort field.
- Không log mật khẩu, hash, Authorization header, access token, private key hoặc thông tin cá nhân không cần thiết.
- Bảo vệ object-level authorization: không chỉ kiểm tra `role`, mà còn kiểm tra **nhân viên đang đăng nhập có sở hữu assignment** được truy cập hay không.

### 5.3. Auth contract hiện đã có báo cáo thực thi

- Auth (local): `POST /api/v1/auth/login`; public JWKS `GET /.well-known/jwks.json`; introspection `GET /api/v1/auth/introspect`.
- Đăng nhập Backend hiện bằng **phone**, trong khi một số giao diện Frontend demo từng dùng **email**: **đây là vấn đề tích hợp phải chốt**, AI không được tự thêm cột email hoặc đổi logic xác thực một phía.
- JWT RS256 phải xác thực chữ ký, `iss`, `aud`, thời hạn và claims/role đúng contract; Staff kiểm tra role **`EMPLOYEE`** theo mapping được chấp thuận. Không chèn bypass xác thực hoặc tạo token production giả.
- Biến môi trường cần nhất quán theo cấu hình thực tế, ví dụ `JWT_ISSUER`, `JWT_AUDIENCE`, `JWT_JWKS_URL`, `AUTH_INTROSPECTION_URL`; không để key thật trong Git.

### 5.4. Staff ↔ Order cho UC12 (đã có contract)

Nguồn chính: `backend/staff-service/docs/order-service-contract.md` và `order-handoff-checklist.md`.

| Method | Endpoint nội bộ mà Order phải cung cấp |
|---|---|
| `GET` | `/internal/v1/bookings/:bookingId/assignment-transitions/:operationId` |
| `PUT` | `/internal/v1/bookings/:bookingId/assignment-transitions/:operationId` |
| `POST` | `/internal/v1/bookings/:bookingId/assignment-transitions/:operationId/acknowledgement` |
| `GET` | `/internal/v1/assignment-transitions/pending` |

- **Tùng** sở hữu logic Staff: assignment/status/check-in/check-out; **Thưởng** sở hữu booking/status history và hợp đồng Order. **Trung** chỉ tiêu thụ các trạng thái này cho Admin theo contract; không tự cập nhật bảng của hai bên.
- **Không đánh dấu booking `COMPLETED` khi mới một trong nhiều nhân viên hoàn thành** nếu quy tắc đơn yêu cầu tất cả hoàn thành.
- Operation ID ổn định, ghi nhận journal, retry, ACK và đối chiếu trạng thái; không xem HTTP timeout là chắc chắn thất bại hay thành công; không cho phép update trùng.
- Không thay đổi API để “test xanh” nếu làm sai nghiệp vụ; cần kiểm chứng UC12 bằng HTTP + MySQL trên dữ liệu có thể phục hồi khi Order thật sẵn sàng.

## 6. Quy tắc làm việc khi cùng sửa **một service**

1. Các owner theo vai trò lập **bản đồ file/module** cho backend dùng chung và giao rõ vùng file (ví dụ route Customer/Admin/Staff, `jobs/`, `profiles/` nếu repo có), cùng danh sách file dùng chung. Không mặc nhiên coi owner một service có quyền sửa mọi phần chức năng vai trò khác.
2. Mỗi người làm **nhánh riêng**, mỗi PR chỉ giải quyết một UC/nhóm thay đổi nhỏ. Các AI không được cùng sửa trực tiếp working tree/branch hoặc cùng chỉnh file dùng chung mà không phối hợp.
3. Trước khi chạm `app.js`, router chính, middleware, `package.json`, lockfile, config, migrations: thông báo owner file và owner vai trò bị ảnh hưởng, thống nhất người tích hợp. Tránh “last write wins” khi ghép route của ba vai trò.
4. Khi cần API của service khác, tạo issue/contract request, nêu payload + ví dụ + test yêu cầu; người sở hữu service thực hiện. **Không copy truy vấn DB hay module của service khác** vào service mình.
5. Khi phát hiện conflict Git: **không** dùng `git reset --hard`, force push, `git checkout --theirs/--ours` toàn bộ, xóa file đối phương để qua conflict. Giải quyết theo từng dòng, chạy lại test cả hai tính năng và review.
6. Mỗi người có quyền triển khai **cả UI lẫn API của vai trò mình** trong cùng PR/nhóm PR liên kết; việc tích hợp yêu cầu kiểm chứng role, API thật và regression ở hai vai trò còn lại nếu dùng chung service.

## 7. Quy trình bắt buộc khi AI bắt đầu một nhiệm vụ

**Trước khi sửa:**

- Đọc `AGENTS.md`, tài liệu này, README service, các test hiện có và contract liên quan.
- Xem `git status`, nhánh hiện tại, thay đổi đang có. Nếu đang có thay đổi chưa thuộc nhiệm vụ, giữ nguyên; không tự stash/reset/checkout.
- Báo **vai trò (Customer/Admin/Staff), UC, owner frontend/backend, owner file/service/dữ liệu liên quan, thư mục/file dự kiến, API phụ thuộc, test cả frontend/backend sẽ chạy, tác động contract/schema/security và code đã nghiệm thu có thể bị ảnh hưởng**.
- Nếu công việc đụng file thuộc owner khác hoặc thay đổi API/schema/security: **dừng phạm vi đó**, đề xuất PR/contract để chủ sở hữu duyệt.

**Trong khi sửa:**

- Thay đổi nhỏ nhất, giữ convention và stack có sẵn; không rewrite/refactor toàn bộ service không liên quan.
- Không cài dependency, thay Node/runtime, cấu hình port hoặc thêm DB khi không có lý do rõ ràng.
- Viết unit test, validation, authz và logging an toàn cho đường đi bị ảnh hưởng.
- **Cho phép và khuyến khích nối frontend với backend trong cùng vai trò do mình sở hữu** khi nhiệm vụ bao gồm luồng đầu-cuối; không sửa frontend/backend **của vai trò khác** hoặc file chung ngoài phạm vi được duyệt.

**Sau khi sửa:**

- Chạy test tối thiểu của service, schema check liên quan, và contract test nếu chạm liên service.
- Báo **PASS / FAIL / SKIP riêng**; mock/repository tests không được gọi là HTTP E2E; test bị skip **không** được tính là pass.
- Báo các file thay đổi, API có thực, migration có/không chạy, dependency còn thiếu, cách phục hồi và cách kiểm chứng.
- Không tự commit/push/merge/đổi nhánh. Chỉ tạo PR khi thành viên yêu cầu và đã kiểm tra secrets/changes.
- Nếu AI không thể chạy môi trường hoặc service phụ thuộc chưa sẵn sàng, phải nêu **lý do và bước xác minh còn thiếu**, không tuyên bố thành công thay cho test thật.

## 8. Tiêu chí nghiệm thu (Definition of Done)

Một UC/luồng theo vai trò **chỉ** được coi là hoàn thành theo cấp độ ghi rõ (mỗi owner phải kiểm chứng cả frontend và backend của vai trò mình):

| Mức | Điều kiện |
|---|---|
| **Code ready** | Có code, validation, unit tests; chưa xác nhận DB/API thật |
| **Repository verified** | Test với MySQL thật/fixture thật, kiểm chứng đúng dữ liệu và quyền ở tầng repository/service |
| **HTTP verified** | Khởi động service và gọi HTTP thật với auth hợp lệ; kiểm tra 401/403, dữ liệu, pagination, timezone |
| **Integrated** | Service phụ thuộc thật chạy và contract test đạt; với tác vụ ghi phải xác nhận transaction/idempotency/journal |
| **Frontend connected / Role E2E** | Website đúng vai trò gọi API thật với auth/session và RBAC đúng, kiểm thử luồng người dùng xuyên frontend–backend, đối chiếu dữ liệu và thông báo lỗi; không còn phụ thuộc localStorage demo cho chức năng đã chuyển |

Tình trạng đã **được thành viên báo cáo** tại thời điểm viết: Staff UC9–UC11 HTTP verified; UC12 chưa Integrated vì Order dependency. Đây là thông tin tiến độ, **không thay cho kết quả CI/test mới**.

## 9. Quy trình Git/GitHub cho team

- Nhánh đề xuất theo vai trò: **Thưởng** `feat/customer-<uc-or-feature>`, **Trung** `feat/admin-<uc-or-feature>`, **Tùng** `feat/staff-<uc-or-feature>`; dùng tên nhánh thực tế nhất quán với repo, tách nhánh theo module/UC nếu nhiều người cần sửa cùng service.
- Không code trực tiếp trên `main`. Mỗi PR ghi: mục tiêu UC, API contract thay đổi, danh sách file, migration, test PASS/FAIL/SKIP, yêu cầu tích hợp và người review.
- Owner vai trò chịu trách nhiệm PR của mình; **ít nhất một thành viên khác review**, PR động đến contract/dữ liệu/route dùng chung cần **cả owner cung cấp và owner tiêu thụ** duyệt (có thể cả ba nếu ảnh hưởng ba website).
- Không merge khi test liên quan FAIL, khi lộ secret, hoặc khi một phía chưa cập nhật contract.
- Bảo vệ `.env`, `*.pem`, private keys, tokens, tệp tài khoản thử nghiệm, dump dữ liệu; cần kiểm tra `git status`, `.gitignore` và diff staged trước commit. Nếu secret từng lộ trong ảnh/chat/log, phải **thu hồi/đổi** và không chỉ xóa khỏi Git.
- Hợp nhất PR lần lượt qua nhánh tích hợp hoặc `main` theo quyết định của nhóm; chạy smoke test các service phụ thuộc sau merge.

## 10. Mẫu yêu cầu API liên service

```md
### API REQUEST — <MÃ UC / TÊN TÍNH NĂNG>
Requester: Thưởng | Trung | Tùng / <vai trò, service gọi>
Owner cung cấp: Thưởng | Trung | Tùng / <service, miền dữ liệu>
Mục đích nghiệp vụ: ...
Method / Endpoint: ...
Auth & quyền: ...
Request JSON (ví dụ): ...
Response JSON (ví dụ): ...
HTTP errors: ...
Idempotency / concurrency: ...
Timeout / retry: ...
Schema/enum liên quan: ...
Test chấp nhận: ...
Trạng thái contract: DRAFT | APPROVED | IMPLEMENTED | VERIFIED
```

## 11. Điều cấm tuyệt đối đối với AI

- Tự sửa hoặc ghi đè toàn bộ service/module của thành viên khác.
- Tạo endpoint/role/enum/bảng mới rồi mô tả là “đã có sẵn”.
- Tắt JWT, bỏ qua RBAC/ownership, hardcode mật khẩu hoặc service token.
- Tự chạy seed/migration ghi/xóa, tự sửa database production hoặc dùng `.env` của đồng đội.
- Tự đổi từ đăng nhập `phone` sang `email` mà chưa thống nhất schema/contract/frontend.
- Tự merge PR, force push, reset hard, dọn file untracked hoặc thay đổi nhánh.
- Báo “đã hoàn thành tích hợp” khi mới chạy test mock/repository hoặc test đang SKIP.

---

## 12. BẢO VỆ CODE ĐÃ HOÀN THÀNH — ÁP DỤNG CHO CẢ 3 THÀNH VIÊN

> **Quy tắc áp dụng bình đẳng:** code frontend/backend Customer của **Thưởng**, Admin của **Trung** và Staff của **Tùng** có cùng mức bảo vệ; không thành viên hay AI nào được tự ưu tiên phần mình. Cũng phải bảo vệ các service, hợp đồng và migration dùng chung đã nghiệm thu.

### 12.1. Thế nào là code đã được bảo vệ?

- Mọi code đã được merge vào nhánh tích hợp chính và đã vượt qua kiểm thử liên quan; hoặc code trên nhánh tính năng đã có báo cáo kiểm thử, owner đánh dấu **READY_FOR_INTEGRATION** trong PR.
- Các file test, DTO, API contract, migration đã được phê duyệt cũng là một phần của hành vi được bảo vệ, không chỉ source production.
- Các logic chưa hoàn thành/đang TODO không được tự xóa; phải xử lý theo nhiệm vụ và phạm vi đã duyệt.

### 12.2. Quy tắc thay đổi an toàn

1. **Không tự xóa, viết lại, di chuyển hoặc đổi tên** module/API/schema đã được nghiệm thu chỉ vì AI thấy cách khác “đẹp hơn”.
2. Muốn sửa phần của thành viên khác: mở issue/PR mô tả **lý do → ảnh hưởng → thay đổi hợp đồng → migration nếu có → test hồi quy → phương án rollback**. Nhận review từ owner trước khi merge.
3. **Fix lỗi hoặc lỗ hổng bảo mật** vẫn được phép, nhưng phải giữ quy trình owner/reviewer; trường hợp khẩn cấp có thể áp dụng quyết định nhóm và review bù sau, ghi audit trail.
4. Không chỉnh sửa test cũ chỉ để “làm xanh CI”, không bỏ `assert`, skip test hoặc thay production bằng mock để hợp thức hóa kết quả.
5. Khi thay đổi hành vi dùng chung, phải chạy test **của cả service được sửa lẫn service tiêu thụ bị ảnh hưởng** (ít nhất smoke/contract test).
6. Không tự chấp nhận `git reset --hard`, force push, xóa file chưa commit, rebase trên working tree của người khác hoặc tự đổi branch. Không có phê duyệt thì **dừng tại bước đề xuất**.

### 12.3. Mẫu đăng ký thay đổi code đã nghiệm thu

```text
Change request: <mô tả 1 câu>
Owner ảnh hưởng: Thưởng | Trung | Tùng / <vai trò, service, dữ liệu>
UC/API/DB ảnh hưởng: ...
Tài liệu hợp đồng hiện tại: ...
Tương thích ngược? Có/Không; phương án: ...
File sẽ sửa: ...
Test hồi quy và kiểm thử consumer: ...
Phương án rollback: ...
Người duyệt: ... (chưa duyệt / đã duyệt)
```

## 13. TRẠNG THÁI HỢP ĐỒNG VÀ QUY TRÌNH PHỐI HỢP LIÊN SERVICE

**Nguồn sự thật:** một API contract phiên bản được commit trong repo, được **owner provider và owner consumer theo cả service lẫn vai trò cùng duyệt**; file README không được âm thầm định nghĩa API trái với contract. Nếu chưa có OpenAPI, dùng Markdown có schema request/response rõ ràng. Với UC12, giữ `backend/staff-service/docs/order-service-contract.md` làm bản làm việc cho tới khi hai owner phê duyệt vị trí contract chung.

| Trạng thái | Ý nghĩa | Có thể báo API “chạy thật”? |
|---|---|---|
| `DRAFT` | Đề xuất, chưa thống nhất | Không |
| `APPROVED` | Provider + consumer duyệt hợp đồng | Không |
| `IMPLEMENTED` | Có code, chưa chứng minh HTTP thật | Không |
| `VERIFIED` | Test contract/HTTP thật có kết quả và môi trường rõ ràng | Có, trong phạm vi test |
| `DEPRECATED` | Có phương án chuyển đổi và thời hạn ngừng hỗ trợ | Chỉ nếu vẫn được hỗ trợ |

**Quy trình bắt buộc:** Người cần dữ liệu lập **API request** → owner cung cấp duyệt contract → hai bên triển khai độc lập → provider chạy test → consumer chạy contract test → người tích hợp chạy test liên service → cập nhật trạng thái bằng PR. Nếu thay đổi breaking: ưu tiên version mới hoặc cơ chế chuyển tiếp tương thích; **không xóa endpoint cũ trước khi consumer chuyển xong**.

**Khi dependency bị chậm:** bên gọi có thể viết adapter và mock trong **test**, đánh dấu rõ giả lập; không tạo route “trả OK giả” ở production hoặc phát hành kết quả `Integrated` khi dịch vụ kia chưa hoạt động.

**Giao dịch xuyên service:** không giả định transaction MySQL của Staff bao trùm được Order. Phải nêu owner thay đổi, trạng thái pending, idempotency key, retry/backoff, timeout, đối chiếu/journal và cách phục hồi nếu một phía thành công còn một phía thất bại. Trường hợp UC12 tham chiếu contract Order đã chốt, không tự sáng chế lại cơ chế.

## 14. QUY TRÌNH KHI NHIỀU THÀNH VIÊN CÙNG LÀM MỘT SERVICE

1. Ba owner lập **bảng phân vùng file** trước sprint/task nếu cùng service (ví dụ Thưởng: route Customer, Trung: route Admin, Tùng: route Staff, còn router/bootstrap do người tích hợp đảm nhiệm); đây chỉ là **minh họa**, phải dùng đường dẫn thật và kiến trúc thật trong repo.
2. Mỗi người tạo **nhánh/working tree riêng**, không cùng điều khiển một VS Code workspace/working tree đang được AI khác sửa. Nếu dùng chung máy, cần bản clone/worktree tách biệt do người quản lý Git thiết lập sau khi bảo toàn thay đổi chưa commit.
3. File dùng chung (`app.js`, router, package/lockfile, `.env.example`, middleware, cấu hình CI, migration, thư viện chung) phải có **người tích hợp chỉ định trước**. Những người khác đưa thay đổi dưới dạng PR nhỏ hoặc mô tả patch để owner ghép.
4. Trước khi sửa dữ liệu/migration chung, owner bảng và owner service liên quan cùng xác nhận thứ tự triển khai; thay đổi có ảnh hưởng trạng thái hoặc khóa ngoại phải có test hồi quy.
5. PR được merge **tuần tự**, các thành viên còn lại cập nhật nhánh theo quy trình nhóm, chạy test lại; không âm thầm overwrite các thay đổi vừa merge.
6. Nếu cùng chỉnh một đoạn code: dừng merge, đối chiếu ý định của các bên, quyết định thiết kế chung, giữ cả hành vi hợp lệ và chạy test; không dùng chiến lược tự động “ours/theirs” cho toàn bộ service.

**Mẫu bảng chia file trước sprint:**

| Tác vụ | Người thực hiện | Service/Module | File được sửa | File chia sẻ cần duyệt | Reviewer | Test bắt buộc |
|---|---|---|---|---|---|---|
| `<vai trò / UC / tính năng>` | `Thưởng / Trung / Tùng` | `<frontend + backend module thực tế>` | `<file list>` | `<file list / none>` | `<owner liên quan>` | `<unit, HTTP, UI, role E2E>` |

## 15. QUY TẮC DATABASE, SEED, VÀ TRIỂN KHAI AN TOÀN

- **Không hiểu nhầm:** thư mục `databases/staff-db` trong repo không đồng nghĩa instance/schema `staff-db` đã được tạo. `cleanhome_staff_test` là database **tích hợp thử nghiệm**, không phải kiến trúc database-per-service đã hoàn thành.
- **Mỗi bảng một owner ghi**; nếu code hiện tại thực hiện JOIN/đọc xuyên miền trên schema tích hợp, ghi nhận giới hạn. Không phát triển thêm coupling mới nếu có thể dùng API/DTO; khi tách DB phải bỏ phụ thuộc khóa ngoại/cross-service JOIN vật lý.
- Schema thay đổi phải theo **migration có số phiên bản**, kiểm chứng trên DB thử nghiệm có bản sao lưu, và đi qua PR review; tránh sửa trực tiếp `schema.sql` đã dùng để khởi tạo môi trường mà không có migration tương ứng.
- Seed dữ liệu phải có điều kiện chống trùng, kiểm tra đúng database đích, không ghi vào production; không chạy tự động khi start service. Script thử nghiệm nhiều nhân viên chỉ dùng môi trường test với sự chấp thuận rõ ràng.
- **Trước mọi lệnh ghi**, AI phải xuất trước: `database host (không secret)`, `database name`, `danh sách bảng ảnh hưởng`, `SQL/migration`, `rủi ro`, `cách rollback/khôi phục`, rồi chờ phê duyệt. Lệnh SELECT kiểm tra chỉ đọc không cần phê duyệt ghi.
- Dữ liệu thật của người dùng không được sao chép vào fixture/test hoặc log. Dữ liệu mẫu phải được gắn nhãn và không dùng password marker làm tài khoản đăng nhập thật.
- Việc dùng MySQL 9.x ở máy phát triển phải được kiểm chứng với cú pháp schema và công cụ runtime; tài liệu thiết kế ghi MySQL 8.0+ **không tự chứng minh** toàn bộ môi trường giống nhau.

## 16. QUY TẮC BẢO MẬT, XÁC THỰC VÀ PHÂN QUYỀN

- Auth Service (đầu mối kỹ thuật đề xuất: **Thưởng**) chịu trách nhiệm đăng nhập, băm mật khẩu và cấp token; **Thưởng, Trung, Tùng tự chịu trách nhiệm** bảo vệ API backend của vai trò mình theo JWT và/hoặc introspection như contract. Không tin `userId`, `role`, `employeeId` do frontend tự gửi.
- Bắt buộc kiểm tra JWT `alg`, signature qua JWKS/public key, `iss`, `aud`, `exp` và trạng thái tài khoản theo yêu cầu. Không cho fallback “allow all” khi Auth tạm ngừng; lỗi phụ thuộc phải fail closed.
- Endpoint nội bộ cần chứng thực **service-to-service**, phân quyền caller và cấu hình chặn truy cập công khai; private tokens/keys phải nằm ngoài repo và được luân chuyển khi lộ.
- **RBAC + object-level authorization:** role đúng chưa đủ; chỉ cho nhân viên xem/cập nhật assignment do mình sở hữu. Không tiết lộ thông tin liên hệ khách hàng ngoài mục đích công việc hợp lệ.
- Đăng nhập Backend hiện bằng **phone**, frontend demo từng dùng **email**: thay đổi phải qua hợp đồng Auth–Frontend, migration được duyệt và test; AI không tự biến một bên thành bên kia.
- File `.env`, private key, access token, account provisioning chứa bí mật, SQL dump người dùng và backup cá nhân **không được commit**. Nếu bí mật đã từng hiện trong ảnh hoặc chat, yêu cầu đổi/thu hồi dù Git đã ignore.

## 17. CHECKLIST CHUẨN ĐỂ AI TỰ KIỂM TRA TRƯỚC KHI KẾT THÚC

> AI phải xuất checklist với giá trị **PASS / FAIL / NOT_APPLICABLE / NOT_VERIFIED** có lý do; không tự đánh dấu PASS dựa trên dự đoán.

| Mục kiểm tra | Điều kiện tối thiểu |
|---|---|
| Đúng phạm vi | Toàn bộ frontend/backend đúng vai trò được giao; chỉ sửa UC, service, bảng, file đã thống nhất; không chạm vai trò khác chưa duyệt |
| Không hồi quy | Test cũ liên quan vẫn đạt; không xóa test hoặc thay đổi hành vi ngoài ý muốn |
| API contract | Request/response/error/enum đúng bản APPROVED, có test phía cung cấp và phía gọi |
| Database | Không chạy ghi/xóa tự ý; thay đổi schema có migration và review |
| Security | Xác thực, role, ownership; secrets không hiện trong code/log/diff |
| Reliability | Timeout, retry/idempotency, xử lý lỗi phụ thuộc; không trả thành công giả |
| Evidence | Nêu rõ lệnh, môi trường, PASS/FAIL/SKIP; tách mock, repository, HTTP và E2E theo website Customer/Admin/Staff |
| Handoff | File thay đổi, quyết định, dependency, cấu hình cần bên khác và hướng kiểm chứng |
| Git | Chưa tự commit/push/merge/đổi nhánh; trạng thái file chưa liên quan được giữ nguyên |

**Mẫu báo cáo kết thúc bắt buộc:**

```text
Vai trò (Customer/Admin/Staff) / UC / Service / Owner frontend+backend: ...
Branch / commit nền (nếu xác định được): ...
Files changed: ...
API Contract: DRAFT | APPROVED | IMPLEMENTED | VERIFIED
Migration/seed: chưa chạy | đã chạy (DB, xác nhận người duyệt)
Tests: Unit PASS/FAIL/SKIP; MySQL PASS/FAIL/SKIP; HTTP PASS/FAIL/SKIP; Frontend PASS/FAIL/SKIP; Role E2E PASS/FAIL/SKIP
Security/authz checks: ...
Tính tương thích với các service khác: ...
Nợ kỹ thuật / blocker: ...
Cần ai review: ...
Cách khởi động/kiểm chứng: ...
```

## 18. MẪU PULL REQUEST VÀ QUẢN LÝ QUYẾT ĐỊNH

### 18.1. Pull Request bắt buộc có

```md
## Mục tiêu và UC
- Vai trò: Customer/Admin/Staff | UC: ... | Frontend+Backend module: ... | Owner: Thưởng/Trung/Tùng
## Thay đổi
- Code / API / Schema / Contract / Security: ...
- File dùng chung ảnh hưởng: ...
## Tương thích
- Provider / Consumer: ...
- API contract status: ...
- Migration và rollback (nếu có): ...
## Kết quả kiểm thử
- Unit: PASS ... / FAIL ... / SKIP ...
- MySQL: PASS ... / FAIL ... / SKIP ...
- HTTP thật: PASS ... / FAIL ... / SKIP ...
- Frontend và role E2E: PASS ... / FAIL ... / SKIP ...
## Kiểm tra an toàn
- [ ] Không chứa `.env` / token / private key / dữ liệu cá nhân
- [ ] Không tự ý xóa hoặc ghi đè code đã nghiệm thu
- [ ] Các owner liên quan đã review
## Blocker và cách chạy lại
...
```

### 18.2. Quyết định kiến trúc (ADR)

Các vấn đề liên quan từ **hai service trở lên** phải có bản quyết định ngắn trong thư mục tài liệu chung do nhóm chọn: bối cảnh, lựa chọn A/B, quyết định, owner phê duyệt, ngày, cách chuyển đổi và kế hoạch rollback. Ví dụ: `phone` hay `email` cho login; quyền ghi bảng `assignments`; DB-per-service; chuẩn error response; cách thống kê Admin; sửa API UC12. **Không coi một câu trả lời AI riêng lẻ là quyết định kiến trúc của cả nhóm.**

### 18.3. Đồng bộ rule trên mọi AI assistant

- `BACKEND_TEAM_RULES.md` là **nguồn nội dung quy tắc chung**; `AGENTS.md` (Codex) và `CLAUDE.md` (Claude Code, nếu dùng) chỉ **dẫn chiếu** đến file này để tránh hai bộ quy tắc độc lập lệch nhau.
- Không để AI tự cập nhật rule hoặc bảng phân công trong một nhiệm vụ code thường ngày. Mọi sửa đổi tài liệu này cần PR, ít nhất hai thành viên review, và thông báo cho cả nhóm trước khi áp dụng.
- Thành viên cần cập nhật nhánh trước khi bắt đầu nhiệm vụ mới; AI không tự chạy `git pull` nếu có working tree chưa được bảo toàn hoặc chưa có chỉ đạo rõ.

## 19. CÁC BƯỚC TRIỂN KHAI RULE CHO NHÓM (MỘT LẦN)

1. **Cả 3 thành viên (Thưởng, Trung, Tùng)** đọc và xác nhận phân công frontend/backend theo vai trò tại Mục 2, 4; cùng chốt **owner ghi 32 bảng và service dùng chung đề xuất** tại Mục 2.1, 3, mã UC cuối cùng bằng biên bản hoặc PR.
2. Đưa file vào root repository dưới tên `BACKEND_TEAM_RULES.md` và bổ sung đường dẫn đọc trong `AGENTS.md` / `CLAUDE.md` phù hợp. **Không ghi đè nội dung cũ của AGENTS.md.**
3. Tạo nơi lưu **API contracts APPROVED** và **ADR** chung, kèm người duyệt hai phía.
4. Bảo vệ `main`, yêu cầu PR review và kiểm thử ở GitHub theo khả năng nhóm; dùng nhánh tính năng riêng.
5. Ghi trạng thái hiện tại của từng service (scaffold, implemented, HTTP verified, integrated) theo **bằng chứng thực**, không dựa vào tên thư mục hoặc lời khẳng định trong báo cáo cũ.
6. Duy trì quy tắc trong suốt đồ án; kiểm tra tại buổi họp tích hợp định kỳ và cập nhật qua PR.

---

**Phân công vai trò đã cập nhật theo yêu cầu:** Thưởng = Customer toàn bộ frontend/backend; Trung = Admin toàn bộ frontend/backend; Tùng = Staff toàn bộ frontend/backend. **Các đề xuất kỹ thuật còn cần ba thành viên xác nhận bằng PR/biên bản:** owner service/file dùng chung, owner ghi của 32 bảng; mã UC chính thức (đặc biệt *Đặt dịch vụ*); phạm vi sản phẩm/tồn kho/hội thoại; thiết kế DB per service; chuẩn error DTO; báo cáo Admin và vị trí nguồn duy nhất cho API contracts. Khi chốt, cập nhật tài liệu bằng PR có review.
