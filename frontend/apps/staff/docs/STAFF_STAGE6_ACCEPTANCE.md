# CleanHome Staff — Nghiệm thu giai đoạn 6

Ngày: **06/11/2026**. Worktree: `CleanHome_Staff_Rebuild`, branch `feat/staff-rebuild`.

URL: **http://localhost:3102**. Backend QA: Auth `4101`, Order `4103`, Staff `4115`; MySQL QA độc lập `3307`, database `cleanhome_staff_qa_isolated`. Không kiểm tra lại ERD hoặc phát triển nghiệp vụ mới.

## Phạm vi và cách phân loại

| Nhãn | Ý nghĩa trong báo cáo này |
| --- | --- |
| REAL_PASS | Luồng đã chạy với service thật trên QA độc lập. Dữ liệu QA vẫn là dữ liệu tổng hợp, không phải dữ liệu khách hàng production. |
| DEMO_PASS | Chức năng minh họa đã chạy đúng; đặc biệt tiền công DEMO_V2 lấy đầu vào thật từ Backend QA nhưng không phải chính sách trả lương/chi trả thật. |
| MOCK_PASS | Dùng phản hồi AI mock hoặc lỗi mạng/storage chủ động để kiểm tra UI và xử lý lỗi; không chứng minh provider đã trả mã lỗi đó ngoài thực tế. |
| NOT_RUN | Chưa chạy trong lượt này do phạm vi, ngân sách inference hoặc thiếu fixture phù hợp. |
| BLOCKED | Chưa thể nghiệm thu luồng thật vì thiếu API, chính sách hoặc quy trình được phê duyệt. |

Các suite cũ có một số nhãn REAL_PASS cho lỗi mạng chủ động hoặc biểu đồ DEMO; bản tổng hợp đã phân loại lại các trường hợp này, đồng thời giữ nhãn gốc trong `reportedStatus` để đối chiếu.

## Kết quả theo module

| Module / luồng | Kết quả | Bằng chứng và giới hạn |
| --- | --- | --- |
| Đăng nhập | REAL_PASS | Sai mật khẩu 401; Customer bị từ chối 403; Origin không hợp lệ bị từ chối. A/B đăng nhập thật, cookie opaque HttpOnly/SameSite=Lax, không trả JWT/mật khẩu về UI. |
| Session, F5, logout | REAL_PASS | Khôi phục đúng tài khoản khi F5; logout vô hiệu cookie cũ, không làm mất session B; session core dùng Auth thật với kho test riêng TTL 1 giây bị từ chối khi hết hạn. Không đổi TTL của frontend QA chính. |
| Dashboard | REAL_PASS | Tự tải; chỉ số khớp API/phân công của đúng tài khoản. A có 12 phân công/5 DONE; B có 27 phân công/10 DONE trên toàn bộ fixture. |
| Công việc, chi tiết | REAL_PASS cho đọc | Danh sách đúng ID và số lượng; chi tiết được phân công trả 200, truy cập phân công người khác trả 404; header tài khoản cũ trả 409. Không thực thi chuyển trạng thái UC12 trên các fixture đang được bảo vệ. |
| Lịch làm việc | REAL_PASS | Danh sách/khoảng ngày khớp API và SQL; khoảng rỗng có trạng thái trống, không tạo công việc giả. |
| Thông báo | REAL_PASS | Danh sách, số chưa đọc, đánh dấu đã đọc/read-all và tính idempotent trên thông báo fixture A; không làm đổi thông báo B. Đây là business mutation duy nhất được thực hiện trên QA cô lập trong lượt này. |
| Hồ sơ | REAL_PASS cho danh tính; BLOCKED cho sửa | Mã tài khoản A/B lấy từ session thật, không giữ dữ liệu A trong hồ sơ B; F5 đúng. Trường chưa được API cung cấp có trạng thái thiếu dữ liệu, không tự điền thông tin cá nhân giả. |
| Thu nhập | DEMO_PASS | DEMO_V2 khớp Backend, SQL, bảng kê, biểu đồ ngày/tuần/tháng và khoảng 1/3/6/12 tháng. Có nhãn dự kiến, chi tiết chính sách; payout vẫn NOT_INTEGRATED. |
| Bản đồ | REAL_PASS trên QA | Marker/popup khớp chi nhánh BFF/SQL, GeoJSON thật từ fixture, zoom/kéo/phím/attribution và 4 viewport. Có 86 response tile OSM HTTP 200 trong lượt tương tác; không prefetch trước khi mở, không sửa chi nhánh hoặc gửi địa chỉ booking. |
| Lịch khả dụng / quản lý ca | REAL_PASS cho đọc/bản nháp; BLOCKED cho gửi | Mở ngày/ca, chi tiết, kiểm tra thời gian không hợp lệ/quá khứ, xem lại nội dung và xác nhận; nút gửi luôn khóa, không tạo yêu cầu chờ duyệt hoặc thông báo thành công giả. A/B không chia sẻ bản nháp. |
| Thành tích | REAL_PASS | Tỷ lệ hoàn thành/đúng giờ, số phân công và bộ lọc khớp dữ liệu SQL/Staff API; tài khoản 0 phân công không có tỷ lệ hay đánh giá giả. |
| Review | REAL_PASS cho fallback; BLOCKED cho đánh giá thật | BFF trả 503 REVIEWS_NOT_AVAILABLE có chủ đích; UI không tạo sao, review hoặc huy hiệu chính thức. |
| FAQ / cửa sổ hỗ trợ | REAL_PASS | Đủ 6 FAQ, một cửa sổ chat dùng chung, launcher chỉ ở trang đã đăng nhập. |
| Chatbot Groq thật | REAL_PASS | Đúng **2 inference** qua Staff BFF: “xin” và câu hỏi tiếp theo; cả hai HTTP 200, lượt sau tái sử dụng context, câu trả lời được kiểm tra. Không gọi lại 6 FAQ bằng provider để tránh tốn quota. |
| Cài đặt | REAL_PASS cho khả năng hiện có | Sidebar/active route, preference local/F5/reset, focus/motion, thao tác logout có xác nhận; local preference A/B cách ly. Sửa hồ sơ, đổi mật khẩu và danh sách thiết bị chưa có API hợp lệ nên không được coi đã hoàn thành. |

Tiền công tháng 11/2026 trong fixture:

| Tài khoản | Phân công thuộc kỳ API thu nhập | DONE hợp lệ để tính trong kỳ | Tổng minh họa |
| --- | ---: | ---: | ---: |
| A | 12 | 5 | 320.000đ |
| B | 22 | 5 | 320.000đ |

B có 27 phân công và 10 DONE trên toàn fixture nhưng không phải tất cả đều thuộc kỳ hoàn thành tháng 11. Thu nhập ghi nhận theo check-out và UTC+7, không lấy toàn bộ DONE hoặc tổng giá booking để nhân tiền công.

## Error/retry, responsive và bàn phím

- MOCK_PASS: giữ/chặn GET rồi retry cho công việc, thu nhập, lịch ca và Thành tích; lỗi storage/transport trong Cài đặt; lỗi tile chủ động rồi tải lại tile thật.
- MOCK_PASS: chatbot free-text/multi-turn, Enter/Shift+Enter, gợi ý FAQ, loading, chống gửi trùng, 18 giây timeout, 400/401/403/429/500/503, FAQ tĩnh gắn nhãn riêng, không tạo câu trả lời AI giả.
- MOCK_PASS: hội thoại QA đi tới 30 lượt, chặn lượt 31, nút “Bắt đầu cuộc trò chuyện mới”; lỗi quota theo tài khoản vẫn được thể hiện. Unit server kiểm tra quota không phụ thuộc việc tạo conversation mới; không gửi 30 inference thật để thử giới hạn.
- REAL_PASS: mất session/logout xóa dữ liệu được bảo vệ; context chat không tồn tại qua F5/logout/đổi A/B. Với nội dung AI mock, trường hợp context/UI được ghi MOCK_PASS, không coi là hội thoại provider thật.
- PASS ở 375/390/768/1440: không tràn ngang trang, vùng biểu đồ/bảng được cuộn riêng; dialog không cắt nút. Core Chrome ghi 40 tổ hợp trang/viewport; các suite chuyên biệt có ảnh và kiểm tra bổ sung.
- PASS bàn phím: form đăng nhập, marker/popup/zoom/pan bản đồ, dialog ca/hồ sơ, Sidebar Cài đặt, combobox gợi ý và ô chat; kiểm tra focus và tên truy cập. Không khẳng định đây là audit WCAG toàn dự án.

## Kiểm tra kỹ thuật

| Kiểm tra | Kết quả cuối |
| --- | --- |
| Unit Staff, loại integration có môi trường/mutation riêng | **765/765 PASS**, không skip |
| Regression cấu hình QA | **2/2 PASS** |
| TypeScript | **PASS** trên snapshot đúng source worktree |
| Webpack build | **PASS**, có chạy TypeScript trong build; không ignoreBuildErrors |
| HTTP integration thật | **27 REAL_PASS + 1 DEMO_PASS**, 0 FAIL/0 BLOCKED; 4 NOT_RUN được thực hiện bằng suite riêng hoặc giữ nguyên giới hạn bên dưới |
| Core Chrome | **14 REAL_PASS + 1 DEMO_PASS + 1 MOCK_PASS**; 40 kiểm tra responsive |
| Các suite chuyên biệt | Maps, Maps A/B+SQL, Profile/Settings, Availability, Income Chart, Income/Achievements SQL, chat mock, giới hạn lượt và Groq thật đã chạy; xem suite-index.json |

## Lỗi phát hiện và đã xử lý

1. **QA frontend dừng / hết bộ nhớ.** Lượt đầu HTTP không kết nối được sau khi frontend dừng; log có lỗi V8 thiếu bộ nhớ khi giải nén cache. Snapshot QA hiện dùng heap 2048 MB, bật tối ưu bộ nhớ Webpack và tắt cache Webpack trong dev. Sau đó core Chrome và các module chuyên biệt đã chạy qua, không sửa cấu hình ứng dụng nguồn.
2. **Build hết bộ nhớ ở 15 worker.** Biên dịch và TypeScript đã qua nhưng bước thu thập page data bị lỗi cấp phát bộ nhớ. Giới hạn riêng snapshot QA còn 2 worker; build/typecheck chạy lại PASS. Không tắt kiểm tra kiểu hoặc dừng tiến trình ngoài QA. Tham khảo [hướng dẫn bộ nhớ Next.js](https://nextjs.org/docs/app/guides/memory-usage).
3. **4 unit test cũ không khớp giao diện đã được duyệt.** Cập nhật loader context/widget và kiểm tra fallback Maps, FAQ một cửa sổ, chỉ số thật; thay các assertion câu chữ kỹ thuật đã bị rút gọn. Giữ các kiểm tra không có bản đồ/dữ liệu/AI giả.
4. **Script nghiệm thu lỗi thời/race.** Bỏ yêu cầu banner “CHỈ ĐỌC” đã được chủ sản phẩm yêu cầu xóa; readiness AI kiểm tra theo cấu hình thật, không mặc định AI-off. Chờ menu logout hiển thị trước khi chọn và không coi các cột nằm trong vùng cuộn ngang là tràn toàn trang. Phân loại fault injection thành MOCK_PASS.

Không sửa nghiệp vụ UI/Backend để làm test qua, không thêm tính năng mới và không kiểm tra lại tài liệu Database/ERD.

## NOT_RUN / BLOCKED phải trình bày rõ trước buổi bảo vệ

| Ưu tiên | Phần còn thiếu | Trạng thái / việc cần xác nhận |
| --- | --- | --- |
| P1 nếu yêu cầu trình diễn vòng đời công việc | Mutation nhận việc/check-in/check-out/hủy UC12 | **NOT_RUN trong lượt này.** Cần fixture mutation riêng được cho phép; không dùng các phân công A/B đang đối chiếu làm dữ liệu thử phá. API đọc, quyền và unit đã kiểm tra, không thay thế bằng chứng mutation thật. |
| P1 nếu yêu cầu đăng ký/đổi/hủy ca thật | API ghi, chính sách và quy trình Admin phê duyệt | **BLOCKED.** Cần contract hợp lệ, người duyệt, trạng thái, chống xung đột và idempotency; hiện chỉ xem và chuẩn bị bản nháp. |
| P2 kiểm thử dữ liệu biên | Overlap/change/cancel với ca tương lai có thật | **NOT_RUN** cho fixture thật: SELECT chỉ đọc xác nhận A có 3 ca/B có 3 ca, cả hai có 0 ca bắt đầu trong tương lai. Validation được kiểm tra unit/mock và ca quá khứ; không thay ngày/seed để biến thành PASS. |
| P1 nếu yêu cầu quản lý tài khoản đầy đủ | Sửa thông tin cá nhân, đổi mật khẩu, phiên/thiết bị | **BLOCKED** vì thiếu contract/API được duyệt. Form giữ disabled; không có endpoint đổi role/employeeId/status từ browser. |
| P1 nếu yêu cầu thanh toán/đánh giá thật | Payout, đối soát chính thức, Review | **BLOCKED.** Không trình bày DEMO_V2 là lương hay tiền đã chi; không tạo giao dịch/review/huy hiệu giả. |
| Chuẩn bị trình diễn | Internet, Groq Free Plan và tile OSM | Luồng hiện tại đã REAL_PASS nhưng phụ thuộc mạng/quota. Không cố tình dùng key sai hoặc gửi nhiều inference để tạo lỗi provider; mã lỗi provider được kiểm tra bằng mock. Tile production/khả năng tải lớn cần quyết định và kiểm thử riêng. |
| Chuẩn bị trình diễn | Tài nguyên máy | Chạy lần lượt suite nặng; giữ cấu hình QA đã điều chỉnh. Các lần dừng/build lỗi ban đầu được ghi nhận, không xóa hoặc gọi là PASS trước khi chạy lại. |

Chưa nghiệm thu deployment production, tải lớn hoặc độ ổn định dài hạn. Kết quả là nghiệm thu QA độc lập theo các luồng và giới hạn nêu trên, không phải tuyên bố production-ready.

## Bằng chứng, cách mở và phạm vi Git

- Thư mục bằng chứng: `qa/staff/.private/reports/stage6-2026-11-06T05-24-08-847Z/`; chỉ mục `suite-index.json`, log unit đầu/cuối và báo cáo HTTP lần đầu bị gián đoạn. Report và ảnh của từng suite nằm trong các thư mục anh em được chỉ mục tham chiếu. `.private` được Git ignore.
- Xem tài khoản fixture trực tiếp trên máy bằng `qa/staff/credentials.ps1`; không đưa password/token/key/cookie vào báo cáo.
- Nếu phải refresh frontend với AI đã được cấu hình, cần giữ môi trường server-side và chính sách QA đã được cho phép. Không tự tạo/sao chép key hoặc dùng khóa công khai.
- Các file thay đổi thuộc test Staff, script/cấu hình QA và báo cáo này. Không đổi schema, Auth/Order/Staff Backend nghiệp vụ, Customer/Admin hoặc repository gốc; không reset/stash/clean/commit/push.
- WIP trước lượt: **38 modified + 136 untracked**. Hash baseline được lưu riêng để đối chiếu cuối lượt; không loại bỏ thay đổi có sẵn.
- Git cuối lượt: **38 modified + 139 untracked**, 0 staged. Đối chiếu 174 file WIP ban đầu: không mất file; ngoài các file test/QA được nêu dưới đây, không có thay đổi khác. Secret QA vẫn gitignored.

Bằng chứng QA riêng tư chỉ lưu tại máy nguồn, không đưa vào PR. Kết quả đối chiếu WIP nằm trong `wip-verification.json` cùng thư mục; các tệp này không cần đưa lên Git.

File cập nhật: `frontend/apps/staff/test/staff-priorities.test.mjs`; `qa/staff/README.md`, `browser.mjs`, `maps.browser.mjs`, `runtime.mjs`, `settings.browser.mjs`, `support.browser.mjs`, `test.mjs`.

File mới: báo cáo này; `qa/staff/frontend-config.mjs` và `qa/staff/frontend-config.test.mjs`. Các thay đổi QA không mở khóa thao tác nghiệp vụ, không sửa secret và không làm thay đổi source cấu hình production của ứng dụng.
