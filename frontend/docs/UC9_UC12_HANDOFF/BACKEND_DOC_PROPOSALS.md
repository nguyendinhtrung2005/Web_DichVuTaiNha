# Cập nhật sáu tài liệu Backend theo phạm vi đã được nhóm xác nhận

Ngày chuẩn bị: **25/10/2026**, giờ Việt Nam. Người dùng đã xác nhận nhóm đồng ý bàn giao phạm vi được trình trong handoff, gồm sáu tài liệu bên dưới. Nguồn phê duyệt được ghi đúng là **"nhóm xác nhận qua người điều phối, chưa đính kèm bằng chứng riêng"**; không tự bịa tên reviewer, ngày ký hoặc link phê duyệt. **Patch tài liệu đã được áp dụng**, không đổi DTO, endpoint, enum, schema hay logic nghiệp vụ. Việc đồng ý bàn giao không tự thay thế một biên bản phê duyệt contract API chính thức.

Bản diff được giữ để truy vết: [proposals/backend-docs-update.patch](proposals/backend-docs-update.patch). Sáu file đích hiện chứa thay đổi trong patch này. Trong lượt sửa whitespace, chỉ đổi cách biểu diễn artifact sang unified diff **zero-context** để bỏ 67 dòng context trống có tiền tố space; **không sửa lại sáu tài liệu Backend**. Bản gốc có context được lưu ở TEMP; [PATCH_FORMAT_PROOF.md](PATCH_FORMAT_PROOF.md) ghi hash, chứng minh forward/reverse và guard preimage/postimage.

Định dạng gốc 21 hunk, 75 dòng thêm/26 dòng bỏ; bản chuẩn hóa 28 hunk, 74 dòng thêm/25 dòng bỏ. Chênh lệch một cặp thêm/bỏ cùng dòng trống được triệt tiêu, không thay kết quả sáu file. Bản mới cần **`--unidiff-zero`**, không cắt tiền tố context hoặc tắt kiểm tra whitespace. Các liên kết trong phần diễn giải được điều chỉnh theo vị trí tài liệu handoff; liên kết trong patch vẫn dùng vị trí file Backend đích. **Dòng nguồn và SHA-256 ở bảng bên dưới là baseline trước patch, không phải hash hiện tại**; hash sau áp dụng đối chiếu FILES.csv. Không áp dụng patch lặp.

## Bằng chứng và phạm vi cập nhật

- Nguồn: [UC12_E2E_QA_REPORT.md](../../apps/staff/docs/UC12_E2E_QA_REPORT.md), kết thúc lúc 23:22:13 ngày 24/10/2026 giờ Việt Nam.
- Q01–Q06: **43 nhóm E2E PASS / 0 FAIL / 0 SKIP / 0 NOT_RUN**; luồng Browser/BFF/Auth/Staff/Order/MySQL thật, sáu fixture đã COMPLETED/DONE, 36 journal mới đã ACK.
- Hồi quy HTTP riêng: **90 PASS / 0 FAIL / 1 SKIP** do thiếu fixture UC11 qua ranh ngày UTC/Việt Nam. Không biến SKIP thành PASS hoặc coi đây là SKIP của Q01–Q06.
- Giữ bảng test, cấp credential và số liệu seed cũ dưới mốc lịch sử; không thay mọi số 5 booking/6 assignment thành tổng hiện tại hoặc cộng test cha/con.
- Chưa kiểm chứng production, HTTPS/Secure cookie thực, tải lớn/stress/soak, đa host/replica và crash/kill/mất điện/restore trong lượt Frontend. Fault mất kết nối/phản hồi khác crash. Backend recovery lịch sử giữ phạm vi riêng; worker toàn DB trong lượt Frontend tắt.
- Không dùng lại `9109131`, `9109141` hoặc Q01–Q06 như fixture chưa hoàn thành; không bật lại nhóm ghi lịch sử.

## Sáu file và phạm vi ownership đã được nhóm xác nhận

| File | Owner/reviewer theo quy tắc nhóm | Dòng nguồn trước patch | SHA-256 nguồn trước patch |
| --- | --- | --- | --- |
| `backend/auth-service/README.md` | Auth / TV1 | 3, 117, 126, 148; thêm khối cập nhật | `b0f7cf057f9bc9e6c493cad8603fb7cdb802958042d55cf062385a462bdf1940` |
| `backend/auth-service/docs/staff-integration.md` | Auth / TV1 | 140, 155, 184, 185; thêm khối cập nhật | `ef8f8dc9a96d482d9c9f290579958a6d835ddffeb317dc097056a6e7c47f52ff` |
| `backend/staff-service/README.md` | Staff / TV4; Order / TV3 review contract/checklist | 4, 6; thêm khối cập nhật | `f40875213f358e7912b38beaad5910ff0b94feced011299a6e9a55b0d6eb62d5` |
| `backend/staff-service/docs/order-handoff-checklist.md` | Staff / TV4; Order / TV3 review contract/checklist | 3, 13, 84, 86, 118, 120, 124; thêm khối cập nhật | `cc4739e059184c1cfdcaafe3341975bcac0e7e981b632e5c9f02f9ddfca97b04` |
| `backend/staff-service/docs/order-service-contract.md` | Staff / TV4; Order / TV3 review contract/checklist | 3, 25, 134, 148, 187, 191; thêm khối cập nhật | `1c56e93fd3c3222cb50c8a22e00229419724c567cf2442ec9b5448d75a0ba45a` |
| `backend/order-service/README.md` | Order / TV3; Staff / TV4 xác nhận tương thích | 185, 228; thêm khối cập nhật | `c711bf96f244fbfb5fd8f3c18f81da1ed218b05e0df8097d651c18b77183fdc9` |

TV1/TV3/TV4 là vai trò trong quy tắc nhóm, không suy ra tên người thực tế. Cả sáu file nằm trong xác nhận bàn giao qua người điều phối; chưa đính kèm bằng chứng review riêng cho từng owner. Head/base và các commit/PR cuối vẫn phải đối chiếu ở bước kiểm tra staging.

## Nội dung patch đã áp dụng theo file

### `backend/auth-service/README.md`

- Dòng 3: Đã triển khai đăng nhập **bằng `users.phone`**, cấp JWT **RS256**, public JWKS và introspection kiểm trạng thái MySQL hiện tại. Auth/Staff đã được kiểm chứng HTTP thật; Frontend Staff và UC12 đã có bằng chứng local Q01–Q06 riêng ở phần cập nhật dưới đây.
- Dòng 117: ## Kiểm thử và giới hạn kết quả giai đoạn Auth (lịch sử)
- Dòng 126: Dòng Auth HTTP gồm một test cha gọi suite Staff; dòng Staff phân rã kết quả con, không cộng để khẳng định số endpoint độc lập. Staff kiểm 401 không token, 403 Customer, 404 A/B truy cập chéo (kể cả chung booking), UC9 lọc/sort/phân trang, UC10 chi tiết và UC11 lịch Việt Nam. Nhánh ghi UC12 SKIP trong suite Auth lịch sử này; kết quả đó không thay trạng thái Q01–Q06 đã nghiệm thu riêng. Lần đầu runner lồng nhau không đọc được thống kê Node; đã sửa IPC/reporter ở Auth test harness, chạy lại đạt bảng trên, không sửa Staff.
- Dòng 148: MySQL/live mặc định bỏ qua khi chưa opt-in; bật mà thiếu input thì FAIL, không đổi thành API giả. Test live của Auth chỉ đọc dữ liệu và chạy Staff suite có sẵn với `RUN_STAFF_HTTP_WRITE_TESTS=false`. Không cần Order để đọc UC9–UC11. Ở giai đoạn Auth lịch sử này, UC12/worker còn chờ Order và Frontend chưa được nối JWT; Order và Frontend Staff đã được tích hợp trong các giai đoạn sau theo báo cáo Q01–Q06 ở đầu tài liệu. Không chạy lại test ghi trên fixture đã hoàn tất.
- Thêm khối bằng chứng local liên kết báo cáo 43 PASS; tách lớp test và giới hạn.

### `backend/auth-service/docs/staff-integration.md`

- Dòng 140: ## Kết quả giai đoạn triển khai Auth (lịch sử)
- Dòng 155: **Giới hạn của lượt Auth lịch sử**: chưa kiểm thử live với MySQL thật các tài khoản bị khóa/ngừng hoạt động, token chờ hết hạn và đăng nhập Admin hợp lệ; không đổi trạng thái seed hoặc thêm Admin để chạy HTTP. Rotation JWKS và thu hồi từng phiên chưa được chứng minh trong lượt này. UC12 với Order thật về sau đã được nghiệm thu local theo cập nhật ở đầu tài liệu; không gộp bằng chứng các giai đoạn.
- Dòng 184: - Auth không triển khai thay Order Service bốn API transition/ack/pending. Bốn API hiện đã có implementation Order và bằng chứng Backend local trong README Order. Q01–Q06 kiểm Frontend qua lookup/apply/ack; worker toàn database tắt, không chứng minh riêng pending/global worker. Không bật worker hoặc chạy ghi thêm trên dữ liệu dùng chung chỉ vì đã có kết quả trước đó. Không dùng API giả để có kết quả 200.
- Dòng 185: - Giai đoạn Auth này không sửa Frontend. Ở giai đoạn tích hợp sau, Staff Frontend đăng nhập phone qua BFF, JWT giữ ở server và UC9–UC12 gọi REST thật; dữ liệu localStorage cũ được giữ nguyên. Không suy rộng kết quả Staff sang Customer/Admin; CORS không thay xác thực và phân quyền.
- Thêm khối bằng chứng local liên kết báo cáo 43 PASS; tách lớp test và giới hạn.

### `backend/staff-service/README.md`

- Dòng 4: Chỉ phục vụ nhân viên: xem công việc, chi tiết, lịch và cập nhật tiến độ. Frontend Staff đã tích hợp qua BFF trong các giai đoạn sau; service này không xóa hoặc reset dữ liệu localStorage cũ.
- Dòng 6: **Mốc lịch sử kiểm thử nhiều nhân viên 23/10/2026:** khi mới chạy seed bổ sung có 2 nhân viên, 5 booking, 6 assignment; 99 kiểm thử độc lập và 28 kiểm thử MySQL đạt, HTTP thật khi đó có 1 suite SKIP và không chạy UC12 ghi. Xem [báo cáo giai đoạn đó](../../../backend/staff-service/docs/multi-employee-testing.md#kết-quả-kiểm-thử-sau-khi-người-dùng-chạy-seed) và [hướng dẫn HTTP](../../../backend/staff-service/docs/http-integration-testing.md). Đây không phải tổng dữ liệu hoặc trạng thái tích hợp hiện tại.
- Thêm khối bằng chứng local liên kết báo cáo 43 PASS; tách lớp test và giới hạn.

### `backend/staff-service/docs/order-handoff-checklist.md`

- Dòng 3: **Đây là checklist owner review, không tự đánh dấu các ô là đã được phê duyệt.** Auth RS256 và bốn API Order đã có implementation; Staff có HTTP client và transaction assignment thật. README Order ghi bằng chứng Backend local của bốn API. Q01–Q06 bên dưới kiểm luồng Frontend với lookup/apply/ack; worker toàn database tắt nên không dùng lượt này để khẳng định endpoint pending hoặc global worker đã được nghiệm thu. Không có Order/JWT giả hoặc middleware bỏ qua xác thực trong runtime.
- Dòng 13: - [ ] Owner xác nhận implementation journal bền vững trong `booking_status_history.note` ở mục 4, đã có bằng chứng local. Nếu đổi cách lưu/schema, cần thống nhất contract và migration riêng trước; không dùng cache RAM thay thế.
- Dòng 84: ## 4. Journal và lịch sử: implementation Order cần owner review
- Dòng 86: Implementation Order dùng `booking_status_history.note TEXT` với marker `kind:"cleanhome.staff-transition"`, `version:1`, gồm `operation`, `ack` bất biến và cờ `staffAcknowledged`. `booking_status_history` vẫn do Order sở hữu; Staff không INSERT/UPDATE bảng này. Bằng chứng transaction/journal local nằm tại [README Order](../../../backend/order-service/README.md) và báo cáo Q01–Q06; phê duyệt thiết kế/contract vẫn cần đúng owner.
- Dòng 118: Phần này giữ điều kiện/assertion của runner Backend lịch sử. UC12 ghi đã được kiểm chứng local riêng trên Q01–Q06 theo cập nhật ở đầu tài liệu; không tự tạo JWT/mock Auth/Order hoặc chạy lại fixture đã tiêu thụ để đánh dấu đạt.
- Dòng 120: Runner Backend lịch sử nằm tại [test/http.integration.test.js](../../../backend/staff-service/test/http.integration.test.js), lệnh `npm.cmd run test:http` từ `backend/staff-service`. Mặc định bỏ qua khi chưa bật `RUN_STAFF_HTTP_TESTS=true`. Nhóm ghi cũ yêu cầu `RUN_STAFF_HTTP_WRITE_TESTS=true` và từng dùng `STAFF_HTTP_WRITE_BOOKING_ID=9109131`; **booking này đã COMPLETED, không bật lại nhóm ghi hoặc reset để chạy lại**. Kiểm thử ghi mới cần fixture/runner và phạm vi được owner duyệt riêng. Xem [hướng dẫn HTTP và giới hạn guard](../../../backend/staff-service/docs/http-integration-testing.md); service/test phải cùng trỏ database test.
- Dòng 124: Manifest Backend lịch sử dưới đây đã được sử dụng: booking `9109131` hiện COMPLETED, hai assignment DONE. Giữ để truy vết, không coi là fixture ASSIGNED mới và không dùng bảng này như phê duyệt ghi lại:
- Thêm khối bằng chứng local liên kết báo cáo 43 PASS; tách lớp test và giới hạn.

### `backend/staff-service/docs/order-service-contract.md`

- Dòng 3: **Trạng thái thực thi: đã triển khai và có bằng chứng tích hợp local; phê duyệt contract chính thức vẫn chờ owner Staff/Order.** `src/order-client.js` là REST client thật; không có Order giả trong runtime. Test client dùng stub riêng có nhãn mock; HTTP/MySQL/E2E thật là lớp bằng chứng riêng, không suy ra từ stub.
- Dòng 25: Có **bốn endpoint bắt buộc cho UC12 và cơ chế khôi phục**, đã được Order triển khai theo contract; bằng chứng Backend local của bốn API nằm ở [README Order](../../../backend/order-service/README.md). Q01–Q06 kiểm Frontend qua ba API lookup/apply/ack; worker toàn database tắt, không suy từ lượt Frontend này sang pending/global worker. **Hai endpoint đọc context tùy chọn chưa triển khai**. Đường dẫn/DTO dưới đây được giữ nguyên.
- Dòng 134: Implementation Order cần owner review: dùng **một dòng booking_status_history cho mỗi operation**, metadata JSON có marker/version riêng trong `note`, ví dụ:
- Dòng 148: Khóa booking bảo đảm dedup có transaction theo booking. Cùng assignment/actor/key luôn sinh cùng operation ID. Schema chưa có unique index operation ID hoặc index pending; implementation Order kết hợp advisory lock theo operation ID, khóa booking và kiểm payload đầy đủ, không chỉ cache RAM. Journal/pending đã có code đọc/ghi và bằng chứng local. Quy mô lớn cần đánh giá index/migration riêng với owner; không coi kết quả local là kiểm chứng hiệu năng production.
- Dòng 187: Chống chồng lượt trong một tiến trình không thay thế idempotency phân tán. Journal note hiện do Order triển khai và sở hữu; Staff chỉ đọc/đối chiếu qua REST, không ghi journal SQL. Trong lượt Frontend Q01–Q06, worker toàn database cố ý tắt; bằng chứng phục hồi là retry cùng key và receipt, không phải nghiệm thu global queue/fairness.
- Dòng 191: Test client độc lập kiểm native fetch/HTTP loopback với **Order stub** có nhãn, timeout, malformed JSON, whitelist, multiworker ACK, idempotency payload và journal recovery contract. Test vòng worker dùng service stub **chỉ trong test**. Bằng chứng Backend MySQL/HTTP/recovery thật ở [README Order](../../../backend/order-service/README.md); bằng chứng Frontend/BFF thật Q01–Q06 ở báo cáo liên kết đầu tài liệu. Chưa kiểm chứng cạnh tranh nhiều worker production, global queue/fairness hoặc crash thực tế trong lượt Frontend này. Không bật worker toàn database dùng chung chỉ để tái diễn kết quả.
- Thêm khối bằng chứng local liên kết báo cáo 43 PASS; tách lớp test và giới hạn.

### `backend/order-service/README.md`

- Dòng 185: | Frontend Staff connected (local) | PASS trong Q01–Q06 | Giai đoạn Frontend/BFF sau lượt Backend này đã có 43 nhóm E2E thật; xem cập nhật đầu tài liệu |
| Production/HTTPS/tải lớn/crash thực tế | NOT_VERIFIED | Không suy từ local QA, hai nhân viên đồng thời hoặc fault mất response sang môi trường triển khai/tải lớn/crash |
- Dòng 228: - Ở giai đoạn Backend lịch sử này chưa sửa Frontend; giai đoạn sau đã tích hợp Frontend Staff qua BFF với Auth/JWT/REST thật và nghiệm thu Q01–Q06. Chỉ các luồng Staff đã nối mới dùng Backend; localStorage cũ được giữ nguyên, không suy rộng sang Customer/Admin. Không tự đổi kiến trúc microservices.
- Thêm khối bằng chứng local liên kết báo cáo 43 PASS; tách lớp test và giới hạn.

## Kiểm tra sau áp dụng

1. Phạm vi phê duyệt được ghi nhận qua người điều phối cho toàn bộ sáu file; chưa có chữ ký hoặc bằng chứng riêng từng owner. Giữ nguyên JSON DTO, endpoint, enum và quyền ghi bảng.
2. Patch đã được áp dụng; **không chạy lại `git apply` thuận hoặc áp dụng ngược**. Tại repo root có thể xác minh chỉ đọc rằng nội dung patch hiện đã có trong working tree:

```powershell
git apply --unidiff-zero --reverse --check -- frontend/docs/UC9_UC12_HANDOFF/proposals/backend-docs-update.patch
```

3. Lệnh reverse-check có `--unidiff-zero` đạt sau chuẩn hóa artifact; `--check` chỉ kiểm tra, không đảo patch hoặc ghi file. Trước kiểm tra hoặc áp dụng ở môi trường khác, phải xác minh hash artifact và đủ sáu preimage/postimage theo [PATCH_FORMAT_PROOF.md](PATCH_FORMAT_PROOF.md); zero-context không được dùng để áp dụng mù trên tài liệu đã đổi. Hash trước patch trong bảng giữ làm lịch sử; hash hiện tại phải đối chiếu FILES.csv và staged diff.
4. Người tích hợp kiểm tra link, dữ liệu nhạy cảm và đúng sáu file trước stage. Root xử lý cập nhật FILES.csv/OWNER_APPROVALS.md; không nhận approval riêng từng người khi chưa có bằng chứng.
5. Danh sách staged cuối và các kiểm tra trước commit được ghi tại STAGING_REVIEW.md. Dừng ở checkpoint staging; chưa được commit/push/tạo PR/merge trước khi người dùng kiểm tra và xác nhận.

## Checklist kiểm tra staging và reviewer

- [x] Sáu file thuộc Auth/Staff/Order đã được nhóm đồng ý bàn giao qua người điều phối, không ghi nhận tên hoặc chữ ký owner riêng.
- [x] Patch tài liệu đã áp dụng và reverse-check chỉ đọc đạt; bản diff và hash trước patch được giữ để truy vết.
- [ ] Reviewer kiểm tra staged diff/link và bảo toàn evidence Backend restart riêng; không suy crash từ fault Frontend.
- [ ] Reviewer đối chiếu 43 E2E với 90 HTTP + 1 SKIP và các giới hạn production/HTTPS/tải lớn.
- [ ] Reviewer kiểm tra không đổi DTO hoặc tự gán trạng thái contract API APPROVED; bổ sung bằng chứng riêng nếu nhóm yêu cầu.
- [ ] Xác nhận staged allowlist/secrets và checkpoint STAGING_REVIEW.md trước mọi commit/publish; không chạy seed/test ghi/worker toàn DB hoặc reset fixture đã tiêu thụ.
