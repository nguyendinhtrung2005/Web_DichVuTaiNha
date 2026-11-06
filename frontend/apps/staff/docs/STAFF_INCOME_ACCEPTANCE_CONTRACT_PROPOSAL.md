# CleanHome — Thu nhập và tiếp nhận phân công: audit/contract đề xuất

> Cập nhật 04/11/2026: xem [STAFF_PRIORITIES_20261104.md](STAFF_PRIORITIES_20261104.md) cho chính sách DEMO_V2 và triển khai local mới. Nội dung ngày 02/11 bên dưới giữ làm bằng chứng lịch sử; endpoint pending hiện có lấy source làm chuẩn. DEMO không phải payroll/ledger đã được TV5 duyệt.


Ngày:29/10/2026 · Source checkpoint:913a12d38d98d0752624affbf23d809ba53bcd86.

Trạng thái: ĐỀ XUẤT CHƯA PHÊ DUYỆT. Tài liệu không cấp quyền sửa Backend/schema hoặc chạy fixture. Không endpoint/DTO/công thức/shared-slot mới nào được triển khai trong lượt này.

| Vấn đề | Trạng thái | Owner quyết định |
| --- | --- | --- |
| A. Thu nhập đa nguồn, ngày/tháng/chi trả | BLOCKED: thiếu provider API/ledger/công thức/ownership/aggregate | TV5 + business owner; TV3/TV4/TV1 phối hợp |
| B. Tiếp nhận | PARTIAL: phân công đích danh đã chốt; race ghi cần fixture QA mới | TV4/TV3 + business owner; TV1 cho identity/quyền |

Đã đọc AGENTS.md trong worktree, STAFF_REBUILD_PROGRESS.md và file quy tắc thực tế BACKEND_TEAM_RULES .md tại repository gốc (file tên có khoảng trắng trước .md, chưa hiện diện trong worktree). Chỉ tham chiếu nội dung ownership, không chép/sửa file quy tắc.

**Đính chính phạm vi ngày 29/10/2026:** người dùng chỉ phụ trách website Staff/BFF/test/doc và đã chọn **giữ phân công đích danh hiện tại**. Không chờ quyết định shared-slot cho mô hình đang chạy; các mục shared-slot bên dưới chỉ là phương án tương lai chưa duyệt, không thuộc triển khai hiện tại. Không có quyền mặc định sửa Backend của TV1/TV3/TV4/TV5. Ma trận đầy đủ và yêu cầu owner: [STAFF_BACKEND_IMPLEMENTATION_REQUESTS.md](STAFF_BACKEND_IMPLEMENTATION_REQUESTS.md).

## A. Thu nhập nhân viên

Nội dung dưới là contract proposal cho TV5 duyệt; không phải API/công thức đã có.
### A.1. Bằng chứng source hiện có

- backend/payment-service/src/app.js:1 chỉ TODO; package.json:1 chỉ name/private; controllers/models/routes/services chỉ .gitkeep. Không có API tiền công/hoa hồng, ledger, aggregate, đối soát/chi trả hoặc quyền Staff trong service này.
- backend/staff-service/src/app.js:34–42 chỉ jobs/schedule/detail/PATCH status. backend/staff-service/src/mapping.js:37–49 trả assignmentId/orderId, lịch hẹn, trạng thái, checkInAt/checkOutAt và services.quantity/unitPrice; không có income/payroll DTO.
- backend/order-service/src/app.js:16–23 chỉ các route nội bộ assignment-transitions; không expose thu nhập nhân viên. Booking facts không phải nguồn tiền công.
- frontend/apps/staff/lib/server/auth-core.mjs:68,469–470 chỉ công khai user.id/EMPLOYEE/ACTIVE và metadata phiên; không có công thức, nhân viên tính lương hoặc tài khoản nhận tiền.
- Staff jobs/schedule/BFF contract hiện có không chứa API thu nhập. Bảng có tên revenue_shares không đủ chứng minh có API, công thức đã duyệt hoặc ledger chi trả.
- Kết luận chỉ áp dụng source/contract được kiểm tra trong worktree; không suy đoán hệ thống ngoài worktree.

### A.2. Owner và các quyết định chặn triển khai

TV5 Payment/Report chủ trì nguồn ledger, công thức, chi trả và aggregate; TV4 cung cấp định danh employee/assignment và sự kiện hợp lệ; TV3 cung cấp booking facts/hủy/hoàn/đồng bộ; TV1 phụ trách danh tính/quyền/định tuyến. Người điều phối/business owner duyệt chính sách tiền.

Phải có biên bản/contract owner chốt trước khi code:

1. Nguồn thu được phép: tiền công, lương, thưởng, điều chỉnh và mã nguồn khác chỉ sau phê duyệt. Ai phát sinh/duyệt từng nguồn, điều kiện hưởng, phiên bản quy tắc, gross/net/khấu trừ/thuế/phí và kỳ hiệu lực? Không tự gán tỷ lệ phần trăm booking.
2. Mốc ghi nhận: lúc phân công DONE, Order ACK, booking COMPLETED, đối soát hay mốc khác? Điều kiện hủy/hoàn/nhiều nhân viên và sửa sai? Không tự coi mọi DONE là phát sinh tiền công.
3. Kỳ trả và lịch chốt sổ, thời điểm thực trả; trục thống kê ghi nhận hay dòng tiền; có điều chỉnh hồi tố và điều chỉnh kỳ đã đóng không?
4. Đơn vị VND, độ chính xác/scale, quy tắc làm tròn từng nguồn và tổng; biên tiền tối đa; khoản âm cho phép, quy trình duyệt và cách thu hồi/cấn trừ.
5. Enum trạng thái ghi nhận, đối soát và chi trả; có chi trả một phần, một khoản qua nhiều lần trả hoặc một lần trả nhiều khoản không? Nếu có phải có allocation, không dùng một boolean paid.
6. Nguồn xác nhận đã trả: ledger nội bộ/provider/bank reconciliation nào; ai có quyền xác nhận? Gửi yêu cầu thanh toán hoặc trả HTTP200 không tự đồng nghĩa tiền đã nhận.
7. Danh tính sở hữu, retention, quyền đọc, quy tắc người nghỉ/khóa tài khoản và dữ liệu được phép hiển thị; không mở quyền qua employeeId do browser chọn.

### A.3. Mô hình logic cần được contract mô tả

Tên trường/enum dưới đây là đề xuất, chưa phải schema hoặc DTO được chấp thuận. Owner soạn migration phiên bản riêng nếu cần; không sửa schema gốc.

#### Khoản ghi nhận (IncomeEntry)

- entryId: BIGINT/opaque ID dạng chuỗi; thuộc employee đã xác minh qua actor/session.
- sourceType: mã enum do owner duyệt; sourceId và sourceEventId/version để truy vết, sourceLabel/description từ nguồn đã duyệt.
- assignmentId và bookingId nullable, dạng chuỗi; tách hai loại ID. Lương/thưởng có thể không gắn booking.
- amount: DECIMAL có dấu dạng chuỗi chính xác; currency cố định VND trong contract này. Không parse Number rồi cộng tiền; không chuyển unitPrice thành tiền công.
- recognizedAt: thời điểm ghi nhận chuẩn ISO8601 UTC; recognitionState và ruleVersion/auditReference theo chính sách được duyệt.
- settlementState: enum owner định nghĩa; settledSignedAmount/outstandingSignedAmount do Backend tính theo allocation hợp lệ.
- paymentAllocations: tham chiếu payout/settlement thực, số tiền được phân bổ có semantics dấu và thời điểm do owner định nghĩa; không nhân số entry khi JOIN allocations.
- paidAt chỉ có nghĩa khi đã xác nhận chi trả theo trạng thái đã duyệt. Nếu có nhiều lần trả, cung cấp từng allocation và lastSettledAt/fullySettledAt có nhãn rõ; không suy một ngày trả chung.
- correctionOf/reversalOf nullable để truy vết; sửa sai bằng bút toán bổ sung/đảo có audit, không xóa lịch sử.

#### Dòng tiền thực nhận (Payout/Cashflow)

- payoutId/transactionId chuỗi ổn định, beneficiary xác minh server, currency, confirmedSignedCashAmount, provider/internal settlement reference và confirmedAt.
- Theo dõi trạng thái đang xử lý/thành công/thất bại/hủy/đảo theo enum owner duyệt; chỉ giao dịch được nguồn thanh toán xác nhận mới vào tiền thực nhận.
- Một payout có thể phân bổ nhiều entry; mỗi cashflow chỉ được đếm một lần. Không cộng amount entry với amount payout vào cùng tổng thu nhập.
- Phí/khấu trừ/hoàn/đảo phải có nguồn đối soát và quy tắc dấu rõ; không bỏ khoản âm, lấy abs, clamp về0 hoặc sửa entry đã trả để che điều chỉnh.

#### Invariant và idempotency

- Unique business-event identity theo sourceType/sourceId/eventId/version/employee; retry hoặc phát lại cùng sự kiện không tạo thu nhập trùng.
- Quy tắc đánh giá sự kiện nguồn và ghi ledger/outbox nằm trong transaction của owner; trạng thái xử lý/đối soát phải bền vững để retry/crash không ghi hoặc trả trùng.
- Payout request/provider callback dùng khóa idempotency, unique provider/event reference và kiểm trạng thái hợp lệ; callback trùng, timeout rồi retry và ACK chậm không nhân tiền.
- Không payout vượt số được phép chi trả theo chính sách; kiểm số dư/allocation đồng thời bằng transaction/conditional update của TV5, không dựa UI.
- Thu nhập được ghi nhận và tiền thực nhận là hai tập sự kiện khác nhau; owner phải xác định invariant signed-recognized = settled-against-entry + outstanding nếu áp dụng, trên cùng snapshot/cohort/currency. Không ép invariant giữa hai kỳ thời gian khác nhau.

### A.4. API đọc đề xuất, chưa được phê duyệt hoặc triển khai

Ưu tiên một report response chứa toàn bộ aggregate và trang bảng kê từ một snapshot server nhất quán.

- Backend provider TV5: GET /api/v1/staff/me/income/report (URL chỉ để owner review).
- Browser Staff BFF: GET /api/staff/income/report (chỉ được thêm sau contract TV5/TV4/TV1 duyệt).
- Detail nếu cần: GET cùng miền /entries/:entryId, phân quyền sở hữu trên từng entry.
- Không thêm endpoint ghi lương/trả tiền cho browser Staff trong phạm vi này. Chức năng tạo/duyệt/trả tiền cần contract quyền riêng.

Query đề xuất:

- from/to dạng YYYY-MM-DD, inclusive ngày Việt Nam; periodBasis phải được định nghĩa rõ là recognizedAt hoặc confirmedPaymentAt, không dùng lịch hẹn.
- sourceType, settlementState và granularity day/month chỉ nhận enum đã được API hỗ trợ; thiếu hỗ trợ thì UI không dựng filter giả.
- Phân trang bằng cursor/sort ổn định và giới hạn owner chốt; pagination.total là số entry, không phải tổng tiền.
- Timezone Asia/Ho_Chi_Minh; Backend chuyển bounds sang UTC đầu ngày–cuối ngày exclusive. Owner công bố phạm vi năm/ngày tối đa và xử lý DST/lịch sử nếu hỗ trợ năm cũ.
- Không nhận userId/employeeId tùy ý. Mọi query/snapshot/cursor bị ràng buộc với actor, quyền và filter đã chuẩn hóa.

Response đề xuất:

- period: from/to, periodBasis, timezone, startInclusiveUtc/endExclusiveUtc; currency VND.
- snapshot: snapshotId/asOf/expiresAt/dataVersion và filter fingerprint, được server tạo/chốt.
- recognitionSummary: tổng signed ghi nhận của cohort theo recognizedAt, tách nguồn/điều chỉnh đã duyệt.
- settlementOfRecognizedCohort: phần đã được xác nhận chi trả và phần còn chờ của chính cohort trên cùng snapshot; trạng thái đối soát trình bày riêng, không coi đã đối soát là đã trả. Nhãn không gây nhầm với tiền chuyển trong kỳ.
- cashflowSummary: tổng signed thực nhận theo confirmedPaymentAt trong kỳ tiền, tách chi trả/hoàn/đảo nếu contract cho phép.
- daily/monthly/sourceBreakdown: aggregate do server tính đầy đủ theo đúng trục thời gian, dấu tiền và filter; mỗi bucket ghi basis/currency. Không tính từ một trang entries.
- entries + pagination: các IncomeEntry đã whitelisted; aggregateScope mô tả tổng thuộc toàn bộ truy vấn, không chỉ trang.
- settlement và cashflow không có API/nguồn thì khai báo unavailable/null + reason/capabilities; không trả0 để che phụ thuộc thiếu.

Nếu phải tách endpoint/bucket/bảng kê, owner phải cung cấp snapshotId thực sự pin dataset/version cho mọi request. Không có snapshot đảm bảo thì UI phải ghi riêng thời điểm đọc/phạm vi và không cộng các request thành một tổng nhất quán. Không chỉ gắn cùng chuỗi snapshotId mà không có isolation thực.

### A.5. Semantics thống kê bắt buộc trước UI

- Biểu đồ ghi nhận ngày/tháng nhóm recognizedAt trong timezone contract. Biểu đồ thực nhận nhóm thời điểm xác nhận thanh toán, không nhóm scheduledAt/checkOutAt.
- Tổng ghi nhận, tổng đã chi trả cho cohort ghi nhận, còn chờ và tổng dòng tiền thực nhận là nhãn khác nhau. Không lấy recognized - cashflow-trong-kỳ làm pending khi hai tập khác nhau.
- Source breakdown của khoản âm/dương giữ đúng dấu, không bỏ nhóm âm hoặc dùng tỷ lệ tròn khiến tổng sai; cách thể hiện tỷ trọng khi net âm/0 do business owner duyệt.
- Status filter/recognition filter và phạm vi summary phải được response mô tả; thống kê trạng thái hiện tại khác lịch sử trạng thái vào ngày đó.
- Tổng do Backend tính từ ledger và allocation/cashflow chuẩn, không JOIN nhân bản bút toán, không đếm paid entry hai lần.
- Không dùng booking quantity/unitPrice, booking payment, số lượng DONE hoặc scheduledAt làm bằng chứng tiền công/thực nhận.

### A.6. Quyền, lỗi, bảo mật và biên tích hợp

- JWT/introspection hiện có tiếp tục là nguồn actor; TV5 dùng mapping employee có contract TV4, không tự JOIN/xâm phạm bảng thuộc owner khác hoặc suy user.id = employee.id.
- EMPLOYEE chỉ đọc chính mình. A/B không đổi được owner bằng query/body/path/cursor/snapshot; entry của người khác trả404 theo chính sách object ownership.
- TV1 xác nhận audience/scope/service auth trước mở Payment route; BFF dùng token server qua interface đã kiểm chứng, không sửa Auth/Refresh hoặc đưa token/khóa vào browser.
- 400 validation/enum/range/duplicate query;401 phiên thiếu/hết hạn;403 role không đủ;404 entry không thuộc quyền;409 snapshot hết hiệu lực hoặc conflict có mã ổn định;429 hạn mức;503 dependency/ledger chưa sẵn sàng. Owner duyệt mã lỗi/DTO chung; lỗi không được biến thành tổng0.
- Response no-store, whitelisted DTO, requestId; không trả dữ liệu ngân hàng/định danh người khác, raw ledger internals hoặc provider secret.
- Giới hạn payload/thời gian/row count; URL deep link chỉ chứa filter đã hỗ trợ, không chứa token/PII.

### A.7. Ma trận nghiệm thu cần owner chuẩn bị

Chỉ chạy ghi trên fixture QA MỚI, cô lập, được duyệt DB/allowlist/backup/đối chiếu trước–sau. Không replay Q01–Q06 hoặc động booking9109131/9109141.

1. A/B list/report/detail/snapshot/cursor chỉ đúng quyền, foreign404; account/employee mapping tách rõ.
2. Nhiều trang, nhiều nguồn, tổng vượt trang, nhiều allocations/payouts và source event retry vẫn không đếm trùng.
3. Signed adjustments âm/dương, đảo khoản đã trả, khấu trừ/hoàn theo chính sách; không làm sai pending/cash totals.
4. Chi trả một phần/nhiều lần, một payout cho nhiều entry; timeout/callback trùng/crash rồi retry không ghi/trả trùng.
5. RecognizedAt cuối ngày/tháng/năm UTC+7; paidAt khác ngày hẹn và khác kỳ ghi nhận; leapday/range/mốc snapshot chính xác.
6. Snapshot thay đổi trong khi phân trang/đọc nhiều bucket; aggregate và entries cùngversion hoặc báo không đảm bảo rõ ràng.
7. Dependency outage/invalid amount/currency/status/ownership trả lỗi đúng, không số0/paid-success giả.
8. Sau contract/API thật: unit/contract/HTTP + đối chiếu ledger/payout/DB theo allowlist; Frontend typecheck/build1worker + Chrome thật375/390/768/1440, loading/empty/error/retry/keyboard và A/B.

### A.8. Gate để bắt đầu triển khai

- TV5 cùng business owner ký nguồn tiền, công thức và quy tắc điều chỉnh/chi trả; TV4/TV3 duyệt facts/sự kiện và mapping; TV1 duyệt auth/ownership.
- Provider contract/version/method/URL/DTO/timezone/filter/pagination/errors/snapshot được hai phía duyệt, có owner test evidence.
- API/ledger/payment nguồn có thật, fixture QA mới được duyệt; thiếu điều kiện nào thì vẫn BLOCKED.
- Lượt audit hiện tại: chỉ đọc source và lập đặc tả; không UI fake/API mới, không thay đổi Backend/MySQL/.env/QA/Git.

## B. Tiếp nhận phân công và chống nhận trùng

### B1. Kết luận về mô hình hiện có

| Phạm vi | Phân loại | Bằng chứng và ý nghĩa |
| --- | --- | --- |
| Một assignment đích danh | READY về cơ chế source; race MySQL mới NOT_RUN | employees được tra từ actor; B không có quyền nhận assignment của A; khóa dòng và conditional update ngăn đi lại cùng bước. |
| Nhiều assignment trong một booking | ĐÃ HỖ TRỢ theo mô hình hiện tại | Các assignment khác ID/employee không tự đồng nghĩa nhiều lời mời cho cùng một suất. Một người nhận không được xóa/hủy phân công hợp lệ của người khác. |
| Nhiều lời mời cho một suất chung | BLOCKED | Chưa có slotId/offerId/claim identity hay contract xác định lời mời nào cùng một suất. |
| Chống vượt số người cần thiết | BLOCKED | Chưa có field/contract capacity và authority cho số suất được phép; không suy capacity từ số assignment hiện có. |

Đối với toàn bộ yêu cầu mới, phần B là PARTIAL: có nền chống lặp cho named-assignment, còn business shared-slot/capacity phải được TV4/TV3 chốt trước khi triển khai. Không báo “đã giải quyết tiếp nhận trùng suất” chỉ vì đã khóa một assignment.

Bằng chứng source:

- databases/schema.sql:190–205,227–240: bookings/assignments nguồn; assignment.id khác booking_id, employee_id bắt buộc. Chưa có slot/offer/capacity trong các định nghĩa được đọc. Đây là kiểm tra schema file, không truy vấn hay thay đổi MySQL.
- backend/staff-service/src/job-service.js:11–16 tìm employee từ actor, kiểm quyền/trạng thái mới; :48–99 scope operation bằng actorUserId + assignmentId + Idempotency-Key, giữ đúng FSM và lookup journal trước apply.
- backend/staff-service/src/repository.js:173–205 BEGIN, SELECT assignment theo employee_id/id FOR UPDATE, lấy status mới nhất từ dòng khóa; UPDATE có điều kiện employee_id/id/oldStatus, affectedRows phải bằng1; nếu không trả409 ASSIGNMENT_CHANGED; lỗi rollback. B không sở hữu assignment trả404 trước callback.
- backend/order-service/src/repository.js:107–152 khóa operation bền vững/advisory và booking FOR UPDATE, đọc roster/journal, cập nhật có điều kiện rồi commit/rollback. Order không khóa/ghi assignment đang do Staff giữ qua REST, tránh vòng khóa.
- backend/order-service/src/domain.js:108–149 kiểm assignmentId/employeeId/actorUserId, tính trạng thái hiệu lực cùng pending journal; COMPLETED chỉ khi mọi assignment hoạt động hiệu lực DONE. Không suy từ một nhân viên hoặc số booking duy nhất.
- backend/order-service/src/app.js:17–23 đã có GET/PUT assignment-transitions, POST acknowledgement và GET pending. Đoạn README Staff cũ còn nói Order scaffold là ghi chú lịch sử, không được dùng để phủ nhận source Order/contract hiện tại.
- frontend/packages/ui/src/components/staff/staff-job-status.tsx:86–136 đã GET khi mount/F5 và có Kiểm tra lại trạng thái; :155–172 xử lý200/202 và giữ unknown/saved operation. Các nhánh Auth/BFF và UI này không bị thay đổi trong audit.

### B2. Các quyết định bắt buộc của TV4/TV3

1. Một assignment có chính là một suất đã giao đích danh, hay là một offer trước khi có người thắng? Có đồng thời hai mô hình không và trường/phân quyền nào phân biệt chúng?
2. Nếu chung suất: identity ổn định của slot/position, offer và assignment sau khi nhận là gì? Slot thuộc booking nào, owner tạo/chốt số suất là ai?
3. Nhu cầu nhân sự N từ contract Order hay roster Staff; có theo booking, booking-item, kỹ năng hoặc khoảng ca riêng không? Không tự chọn một cách tính.
4. Cùng employee có thể nhận nhiều suất của cùng booking hay không; phân công quản lý có chiếm capacity như claim tự nhận không?
5. Khi hủy, phân công lại, nhân viên khóa/từ chối hoặc Order pending: suất có được mở lại, ai quyết định, lúc nào và giữ lịch sử/quyền xem cũ ra sao?
6. OFFER hết hạn, SLOT đã nhận và ASSIGNMENT_CANCELLED phải là khái niệm được owner phân biệt; không tự gán CANCELLED cho mọi assignment khác để làm biến mất danh sách.
7. Ai sở hữu claim journal/reservation và cơ chế phục hồi; không mở rộng tùy tiện JSON journal Order hoặc sửa schema32bảng gốc.

Nếu nhóm giữ named-assignment thuần túy, không thêm open-claim hoặc ẩn phân công của B sau khi A nhận một assignment khác. Owner phải xác minh bằng assignmentId/employeeId, không dựa trùng khách hàng, lịch hẹn, dịch vụ hoặc booking ID gần nhau.

### B3. Contract claim đề xuất nếu owner chọn shared-slot

Toàn bộ mục này là ứng viên để owner duyệt, không phải API hiện có. Không đổi body/status/Idempotency-Key của PATCH UC12 v1 đang nghiệm thu.

- Ứng viên endpoint Staff: POST /api/v1/staff/me/work-slots/:slotId/acceptance; browser BFF tương ứng chỉ được thiết kế sau provider contract được duyệt. TV4/TV3 có thể chọn giao diện khác; không triển khai route ở lượt này.
- Request tối thiểu: offerId và expectedVersion của suất/offer nếu contract dùng optimistic concurrency; Idempotency-Key bắt buộc. Actor/employee lấy từ JWT + mapping server, không nhận employeeId từ client.
- GET danh sách ứng viên chỉ trả offer/slot actor có quyền xem: slotId/bookingId/offerId dạng chuỗi, version, trạng thái suất/lời mời, eligibility/canAccept và capability có nguồn server. Client không coi canAccept cũ là quyền ghi hiện tại.
- Thành công phải trả assignmentId đã có nguồn thật, operationId/key scope, version và synchronization có semantics tương thích v1. 200 chỉ khi contract xác nhận SYNCHRONIZED;202 giữ PENDING_ACKNOWLEDGEMENT/đối chiếu, không coi hoàn tất đồng bộ.
- Không nhận được response không chứng minh claim thất bại: giữ đúng operation/key và có GET đối chiếu theo operation/key, không tự tạo key mới hoặc bỏ reservation để B nhận.
- Đề xuất409 với mã owner duyệt: SLOT_ALREADY_CLAIMED, SLOT_NOT_OPEN, OFFER_EXPIRED, CAPACITY_EXCEEDED, ALLOCATION_CHANGED; idempotency payload mismatch dùng nguyên tắc409 conflict. Các mã SLOT/CAPACITY chưa tồn tại trong contract hiện tại, không được đưa thẳng vào UI như mã đã hỗ trợ.
- Người không có quyền candidate/slot/assignment trả404 theo object ownership;403 cho role/account bị chặn;400 input;429 rate limit;503 phụ thuộc hoặc kết quả chưa xác định. Error DTO giữ requestId, không trả danh tính/PII của người thắng cho người thua.
- Khi A thắng, offer cùng slot của B trở nên không nhận được theo trạng thái server; giữ offer/claim/history, không DELETE. Các slot hợp lệ khác của booking không bị mất.
- Trang chờ, counter và detail đọc cùng contract về hiệu lực offer; nếu nhiều request không có snapshot guarantee thì hiển thị giới hạn độ mới, không tự ghép thành một quyết định nguyên tử.

### B4. Invariant transaction/race và khả năng phục hồi

Owner phải chứng minh các invariant bằng transaction và ràng buộc bền vững, không chỉ bởi UI:

1. Tối đa một claim hiệu lực cho một logical slot; tối đa N suất chiếm chỗ khi capacityN do authority đã duyệt cung cấp. Ràng buộc unique/index/claim record cần migration riêng được owner dữ liệu duyệt; không tự thêm unique(booking_id) vì booking có thể cần nhiều nhân viên.
2. Sau xác thực và kiểm quyền hiện hành, tra kết quả idempotency bền vững theo actor/resource/key và đối chiếu payload trước các điều kiện dành cho thao tác mới. Replay cùng payload khôi phục kết quả gốc dù chính lần nhận trước đã đóng offer, đổi version hoặc làm đầy capacity; không rewind hiện trạng. Chỉ operation mới kiểm offer còn hiệu lực, khóa logical slot và authority capacity hoặc CAS version rồi ghi claim/reservation và kết quả idempotency nguyên tử. Không đọc “còn trống” ngoài transaction rồi UPDATE không có điều kiện.
3. Cùng key/cùng actor/cùng payload replay một kết quả, không cấp thêm suất; payload khác trả409. Khác key/cùng slot phải có một winner và một conflict. CAS/transaction phải bảo vệ cả slot uniqueness lẫn capacity authority: CAS riêng version từng slot không ngăn hai slot khác nhau vượt capacity còn1. Tính reservation pending/unknown là chỗ đang chiếm; mapping actor + slot + payload/version + operation phải bền vững trước retry.
4. Pending/unknown sau timeout hoặc lỗi Order phải giữ reservation theo operation cho tới khi có kết quả đối chiếu xác định. Không thả suất chỉ vì timeout rồi cho người khác thắng trong khi Order có thể đã commit.
5. Khi chắc chắn remote chưa áp dụng và nghiệp vụ cho phép mở lại, thực hiện bù/release có audit và version mới; không xóa lịch sử. Nếu không chắc, worker/GET đối chiếu phục hồi cùng operation, không tự bù hoặc rewind.
6. Tương thích thứ tự khóa của v1: Staff đang khóa assignment trong lúc gọi Order; Order đang khóa booking và không khóa assignment. Không thêm khóa ngược gây deadlock. Owner chốt lock order, timeout, retry cùng key và điểm commit của claim so với journal.
7. TV3 sở hữu booking/status/history; TV4 không ghi trực tiếp booking hoặc xóa roster từ Frontend. Roster/capacity có nguồn contract và xử lý an toàn khi quản lý đồng thời thêm/hủy/đổi người.
8. Một assignment DONE không tự làm booking nhiều nhân viên COMPLETED; claim ACCEPTED cũng không làm mất các slot/assignment hoạt động khác.
9. Không dùng key theo timestamp mới mỗi retry; không dùng mutex browser/in-memory lock hoặc worker một process làm bằng chứng an toàn MySQL nhiều request/replica.

### B5. Frontend sau khi contract Backend đủ

- Backend là quyết định cuối cùng; nút ẩn/disabled chỉ phản ánh dữ liệu đã đọc, không thay CAS/transaction.
- Revalidate sau thao tác đã được xác nhận, khi focus hoặc polling giới hạn nếu owner chốt nhu cầu; dùng GET thật, hủy request cũ, giữ query/filter/page và chống hiển thị identity cũ.
- 409 từ offer cũ phải thông báo suất không còn khả dụng theo mã lỗi đã duyệt rồi đọc lại đúng danh sách/operation. Không xóa lịch sử và không ẩn mọi assignment có cùng bookingId.
- Giữ cơ chế v1 unknown/pending/key qua F5. staff-job-status.tsx:126–130 chỉ gọi parent onChanged nếu GET khớp key attempt đang giữ; :165–172 giữ saved/unknown operation và chỉ xóa attempt khi outcome=not_sent. Refresh/remount mù có thể làm mất key chưa ghi bền vững; không bỏ guard này.
- Không thêm WebSocket nếu hạ tầng chưa có; không sửa Auth/Refresh/BFF security để giải quyết claim.
- Chưa triển khai freshness tự động trong lượt audit này vì không thể biến dữ liệu named-assignment thành contract invitation-pool.

### B6. Ma trận nghiệm thu và điều kiện fixture mới

| Case | Bằng chứng source/baseline hiện có | Kiểm thử cần sau owner approval |
| --- | --- | --- |
| B truy cập assignment đích danh của A | Owner-scoped lookup/lock,404; unit/HTTP loopback dùng doubles | A/B thật với fixture mới, không lộ assignment/danh tính người khác |
| A gửi cùng key hai lần trên một assignment | Journal lookup + FSM; unit concurrent duplicates dùng promise lock | Hai kết nối SQL/HTTP thật đồng thời, một journal và một bước/timestamp |
| Khác key cùng assignment | Lock/CAS/FSM, sai bước409 | Contention thật và ảnh hưởng commit/rollback, không ghi hai lần |
| Hai offer cùng một logical slot | Chưa có slot contract | A/B cùng thời điểm: một winner, một409, lịch sử đủ |
| Hai slot khác nhau trong cùng booking | V1 không được hủy assignment độc lập | CapacityN và các slot hợp lệ còn nhận được; không dedup booking |
| Capacity đang đầy/được quản lý sửa đồng thời | Chưa có authority/capacity contract | Atomic counter/slot constraint, staleversion, không nhận vượtN |
| Order outage/response mất/Staff commit lỗi/ACK lỗi | Journal v1 có phục hồi503/202; unit dùng service doubles | Crash/restart thật theo scope mới; reservation không bị nhận lại |
| F5/focus/stale list/409 | GET đối chiếu và guard key v1 | Browser thật giữ key/pending, list phản ánh server, không request ghi ngầm |
| Hủy/đổi nhân viên/offer hết hạn | Quy tắc shared-slot còn thiếu | Business owner duyệt release/reopen/history/ownership trước test |

Mọi case ghi/concurrency thật mới là NOT_RUN cho tới khi có fixture QA MỚI, cô lập, duyệt DB/allowlist/tables/backup và đối chiếu trước–sau. Không PATCH/replay Q01–Q06; không động booking9109131/9109141. Không gọi generic test:mysql/test:http/test:concurrent trên môi trường nhóm để thay fixture approval.

## C. Kết quả audit và gate bàn giao

- Không có API/công thức Thu nhập đủ để triển khai; phần A BLOCKED, TV5 chủ trì.
- Cơ chế chống lặp assignment đích danh đã có; phần B PARTIAL, yêu cầu shared-slot/capacity BLOCKED ở quyết định nghiệp vụ + contract TV4/TV3. Không có căn cứ sửa Frontend/BFF để tự giải quyết.
- Lượt này chỉ tạo đặc tả và cập nhật tiến độ; không UI giả, không endpoint/BFF/DTO runtime/migration mới, không đổi mô hình phân công hoặc các chức năng Staff đã hoàn thành.
- Kết quả kiểm tra thực chạy và giới hạn được ghi tại STAFF_REBUILD_PROGRESS.md; unit/HTTP loopback dùng doubles không phải kiểm chứng race MySQL hoặc Backend thu nhập.
- Sau khi TV5/business owner duyệt nguồn tiền/công thức và TV4/TV3 duyệt mô hình slot/capacity, owner provider triển khai contract và chuẩn bị fixture mới; Frontend chỉ nối phần có API/DTO/ownership/errors/snapshot thực đã nghiệm thu.
