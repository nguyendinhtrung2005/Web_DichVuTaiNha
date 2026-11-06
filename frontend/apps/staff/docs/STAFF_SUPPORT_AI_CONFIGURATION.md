# Cấu hình trợ lý hỗ trợ Staff

FAQ sử dụng website hoạt động độc lập, gồm công việc, nhận/thực hiện công việc, lịch/ca làm, thu nhập dự kiến, tài khoản và liên hệ hỗ trợ. Ticket Admin vẫn cần API tiếp nhận/trao đổi thật. Không có phản hồi AI mẫu, model hay dịch vụ tính phí được bật mặc định.

BFF `/api/staff/support/chat` xác thực phiên nhân viên ACTIVE, kiểm tra same-origin và account binding. GET chỉ trả trạng thái cấu hình (không khẳng định provider kết nối được). POST giữ contract FAQ `{questionId}` trong `jobs`, `job-steps`, `schedule`, `income`, `account`, `contact`; hội thoại tự do dùng contract riêng bên dưới. Browser không được gửi lịch sử, system role hoặc dữ liệu booking. Không có tool executor hoặc quyền thay đổi dữ liệu.

Chỉ bật sau khi người có thẩm quyền duyệt nội dung `general-guidance-v2`, nhà cung cấp/model, chi phí/hạn mức, nơi xử lý dữ liệu và chính sách lưu log. v1 bị từ chối vì danh sách FAQ đã thay đổi. Đây là mã policy gate kỹ thuật, không tự chứng nhận đã được duyệt.

Thêm vào môi trường server Staff (không dùng tiền tố NEXT_PUBLIC, không commit giá trị thật):

```dotenv
STAFF_SUPPORT_AI_ENABLED=true
STAFF_SUPPORT_AI_PROVIDER=gateway
STAFF_SUPPORT_AI_POLICY_VERSION=general-guidance-v2
STAFF_SUPPORT_AI_ENDPOINT=https://your-approved-gateway.example/staff-support
STAFF_SUPPORT_AI_API_KEY=<server-side-secret>
STAFF_SUPPORT_AI_MODEL=
STAFF_SUPPORT_AI_MAX_OUTPUT_TOKENS=512
STAFF_SUPPORT_AI_TIMEOUT_MS=10000
```

Endpoint đầy đủ do đội triển khai cung cấp phải là HTTPS, không có user/password/query/hash. Không tự tạo key, dùng key công khai hoặc chọn model tính phí. Các giá trị trong khối trên là mẫu chưa kết nối; phải thay bằng cấu hình đã được cấp phép. BFF gửi POST với `Authorization: Bearer <key>`.

## Provider hỗ trợ

`openai-compatible`: tái sử dụng Chat Completions. Server chỉ chấp nhận hai URL chính xác: `https://api.openai.com/v1/chat/completions` và `https://api.groq.com/openai/v1/chat/completions`. Không nhận URL từ browser; từ chối hostname giả, port khác, đường dẫn khác, query, fragment hoặc credential trong URL. OpenAI dùng contract [API chính thức](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create); Groq dùng [contract tương thích chính thức](https://console.groq.com/docs/openai).

Payload FAQ có model, hai messages system/user từ hướng dẫn cố định, `stream:false` và `max_completion_tokens` (64–2048, mặc định 512). Chỉ OpenAI nhận `store:false`; Groq có tham số riêng bên dưới. FAQ không gửi lịch sử; free-text có context ngắn đã kiểm tra ở server. Không có user metadata, tools, tài liệu hay booking. Đọc duy nhất một answer từ `choices[0].message.content` có finish_reason `stop`; từ chối tool calls, refusal và câu trả lời bị cắt. Không suy ra chính sách lưu log chỉ từ tham số API.

### Groq Free Plan — chờ key và xác nhận chính sách dữ liệu

Đã chuẩn bị `qa/staff/.private/support-groq.env`, gitignored và thừa hưởng ACL riêng. File này tách khỏi cấu hình OpenAI cũ; không đọc/copy key cũ. Người vận hành mở Notepad, chỉ nhập key Groq vào dòng `STAFF_SUPPORT_AI_API_KEY=` rồi lưu. Không đưa key vào chat, command line hoặc screenshot.

Các trường công khai được điền sẵn: provider `openai-compatible`, endpoint `https://api.groq.com/openai/v1/chat/completions`, model `openai/gpt-oss-20b`, policy `general-guidance-v2`, token 512, timeout 15000 ms. Chưa nạp file vào service đang chạy trước khi người vận hành xác nhận đã lưu key và chấp nhận chính sách dữ liệu Groq.

Khác biệt đã kiểm tra theo [Groq API Reference](https://console.groq.com/docs/api-reference) và [GPT-OSS reasoning](https://console.groq.com/docs/reasoning): bỏ `store` vì chưa được hỗ trợ, dùng `include_reasoning:false` và `reasoning_effort:low`; không gửi `reasoning_format`, metadata hay tham số tools. Không dùng `reasoning_effort:none` cho GPT-OSS. Model Groq bị khóa đúng `openai/gpt-oss-20b`; response phải xác nhận cùng model, chỉ lấy final content, không chuyển trường reasoning đến browser.

Free Plan do tài khoản/organization Groq quyết định; code không thể bảo đảm miễn phí nếu key thuộc gói tính phí. Không nâng cấp gói hoặc chọn paid service tier. Kiểm tra [Free Plan và giới hạn tài khoản](https://console.groq.com/docs/rate-limits) trong Groq Console trước khi bật. BFF vẫn giới hạn 5 yêu cầu/phút/tài khoản, 30/phút/tiến trình và không tự retry; hạn mức token của Groq có thể chặn sớm hơn bằng HTTP 429.

Chính sách cần xác nhận: chỉ chuyển câu hỏi và hướng dẫn FAQ cố định. Theo [Groq Data Controls](https://console.groq.com/docs/your-data), inference không lưu dữ liệu mặc định, nhưng có ngoại lệ xử lý sự cố/lạm dụng có thể giữ log tối đa 30 ngày; organization có tùy chọn Zero Data Retention. Không tự coi tham số API là chấp thuận hoặc chứng nhận ZDR.

Sau xác nhận của người vận hành, chỉ restart Staff Frontend:

```powershell
node --env-file=qa/staff/.private/support-groq.env qa/staff/runtime.mjs refresh-frontend
$env:RUN_STAFF_ISOLATED_SUPPORT_LIVE_QA='true'
node qa/staff/support-live.browser.mjs --smoke
```

Smoke chỉ gọi đúng 1 FAQ; dừng nếu HTTP 400/401/403/429 hoặc lỗi response, không retry. Chỉ sau smoke REAL_PASS mới cân nhắc `--all-faq` cho ca cần thiết. `--read-only` kiểm tra UI/session với 0 lần gọi provider. Các mã lỗi BFF được làm sạch: `SUPPORT_PROVIDER_REQUEST_REJECTED`, `SUPPORT_PROVIDER_AUTH_FAILED`, `SUPPORT_PROVIDER_FORBIDDEN`, `SUPPORT_PROVIDER_RATE_LIMITED` / `SUPPORT_PROVIDER_QUOTA_EXCEEDED`; không ghi response lỗi thô hoặc key.

`gateway`: giữ contract nội bộ cũ (khi không đặt PROVIDER cũng dùng gateway), cần gateway gọi AI thật được đơn vị chọn. Không đặt URL API gốc Chat Completions vào chế độ gateway. Payload:

```json
{
  "policyVersion": "general-guidance-v2",
  "questionId": "jobs",
  "question": "câu hỏi cố định",
  "guidance": "hướng dẫn sử dụng cố định",
  "instructions": "ràng buộc trả lời bằng tiếng Việt, không yêu cầu dữ liệu cá nhân hoặc suy diễn chính sách"
}
```

Gateway trả HTTP 200 `application/json` với `{ "answer": "..." }`. Cả hai adapter giới hạn answer 4.000 ký tự và response 16 KiB. Không gửi cookie, Auth access token, user id, hồ sơ, công việc hoặc lịch sử cho provider. Không log API key/nội dung hội thoại. Không ghi response AI vào FAQ hay xem là chính sách tiền lương/KPI chính thức.

Giới hạn hiện tại: 5 yêu cầu/phút/tài khoản; 30/phút/tiến trình; tối đa 4 yêu cầu AI đồng thời, 1/tài khoản; tối đa 1.000 bản ghi giới hạn tạm, chỉ giữ hash định danh. Đổi phiên đăng nhập không vượt được giới hạn tài khoản. Với nhiều tiến trình/replica cần bổ sung giới hạn dùng chung ở reverse proxy/API gateway và hạn mức toàn dịch vụ trước khi bật production. Timeout provider 100–15.000 ms; đọc request tối đa 256 byte và 5 giây. Response lỗi được hủy/giải phóng, lỗi provider được làm sạch, không tự động retry gây phát sinh thêm lần gọi. UI giữ lựa chọn và hội thoại khi kết nối lại, không báo AI trả lời thành công khi lỗi.

Hội thoại UI chỉ nằm trong bộ nhớ trang, tối đa 20 tin; không lưu localStorage/sessionStorage. Thu nhỏ hoặc điều hướng giữa các trang Staff giữ hội thoại trong layout gốc. F5, rời ứng dụng, logout hoặc đổi tài khoản xóa UI và không tái sử dụng context cũ. Streaming, tải file và liên kết booking chưa được hỗ trợ.

## Hội thoại tự do — phê duyệt riêng

Người vận hành đã xác nhận ngày 06/11/2026: cho phép QA gửi câu hỏi đã kiểm tra và tối đa 4 lượt ngữ cảnh gần nhất tới Groq Free Plan. Hai biến server riêng `STAFF_SUPPORT_AI_FREE_TEXT_ENABLED=true` và `STAFF_SUPPORT_AI_FREE_TEXT_POLICY_VERSION=general-conversation-v1` phải đồng thời hợp lệ; FAQ v2 hoặc biến NEXT_PUBLIC không bật được chế độ này. Mặc định tắt; chỉ adapter openai-compatible hỗ trợ.

POST nhận `{mode:"free-text",message,conversationId?}` với header account binding bắt buộc. Không nhận history/role/tools từ browser. Response trả answer, conversationId ngẫu nhiên, turnCount và policy; không trả lịch sử, SID hay cấu hình provider. DELETE cùng endpoint xóa context của phiên hiện tại, cần session, same-origin và account binding; không thay đổi dữ liệu nghiệp vụ.

Giới hạn: câu hỏi 1.000 ký tự/3.000 byte UTF-8; production mặc định 10 lượt/hội thoại, QA độc lập 30 lượt; tối đa 4 cặp hỏi/đáp và 6.000 byte context. Tổng prompt giới hạn bảo thủ 12.000 byte cộng overhead (không phải đếm tokenizer chính xác); output mặc định 512 token. Giữ hạn mức 5/phút/tài khoản, 30/phút/process, 4 đồng thời. Xóa hội thoại không reset quota. Không retry tự động.

Giới hạn 30 chỉ được BFF chấp nhận khi đồng thời có `NODE_ENV=development`, app origin HTTP loopback, `STAFF_SUPPORT_AI_QA_ISOLATED=true`, `STAFF_SUPPORT_AI_QA_MAX_TURNS=30`. `qa/staff/runtime.mjs` đặt hai biến QA này trong tiến trình Frontend riêng; không sửa file key. Production, biến public hoặc tham số request không nâng được giới hạn. UI đọc maxTurns từ BFF, hiển thị ngay thông báo và nút **Bắt đầu cuộc trò chuyện mới** khi đạt giới hạn. Nút này chỉ DELETE context phiên, không tác động limiter theo tài khoản. TTL 15 phút và giới hạn token/context giữ nguyên.

QA nâng giới hạn ngày 06/11/2026: support unit 59/59, typecheck và Webpack PASS; Chrome `support.browser.mjs --turn-limit` 3 nhóm PASS (BFF thật quảng bá maxTurns=30, 30 phản hồi AI mock, nút bắt đầu lại và lỗi quota). Kiểm tra BFF bằng provider double chứng minh lượt 31 bị chặn, context tối đa 4 cặp, output vẫn 512 token và bắt đầu lại vẫn nhận 429 trong cùng cửa sổ quota. Không gọi thêm Groq thật cho thay đổi giới hạn.

Context chỉ trong RAM server, gắn hash phiên + tài khoản, tối đa 500 hội thoại, xóa theo hạn phiên hoặc sau 15 phút, khi logout/đăng nhập đổi phiên và khi bấm xóa. Không ghi DB/file/log hay localStorage. Chặn mẫu credential, email/điện thoại, thông tin định danh/địa chỉ và lệnh ghi đè chỉ dẫn; kiểm tra lại output/context. Bộ lọc theo quy tắc có thể từ chối nhầm và không bảo đảm nhận diện mọi cách diễn đạt PII/prompt injection. Ranh giới chính là không cấp dữ liệu nghiệp vụ, bí mật hoặc công cụ cho model. Production cần đánh giá DLP, chính sách provider và hạn mức dùng chung; context RAM cần định tuyến cùng process, không dùng như trạng thái bền vững nhiều replica.

QA đã được cho phép, không sửa file key có sẵn:

```powershell
$env:STAFF_SUPPORT_AI_FREE_TEXT_ENABLED='true'
$env:STAFF_SUPPORT_AI_FREE_TEXT_POLICY_VERSION='general-conversation-v1'
node --env-file=qa/staff/.private/support-groq.env qa/staff/runtime.mjs refresh-frontend
$env:RUN_STAFF_ISOLATED_SUPPORT_QA='true'
node qa/staff/support.browser.mjs --conversation
# Chỉ chạy sau khi mock PASS: tối đa 2 lượt ngắn, dừng khi lỗi, không retry.
$env:RUN_STAFF_ISOLATED_SUPPORT_LIVE_QA='true'
node qa/staff/support-live.browser.mjs --conversation
```

Kết quả QA free-text 06/11/2026: unit 111/111 (support 53, Auth BFF/session 58), typecheck và Webpack PASS. Chrome 10 nhóm PASS; lỗi/timeout dùng mock có nhãn. Groq thật `openai/gpt-oss-20b`: đúng 2 lượt HTTP 200, nhận “xin” rồi nhắc lại đúng nội dung trước đó; không gọi lại 6 FAQ. Chỉ đây là bằng chứng AI REAL_PASS, chưa phải nghiệm thu production.

File của lượt free-text: `app/api/staff/support/chat/route.ts`, `app/globals.css`, `.env.example`, `package.json`, tài liệu này; Staff BFF `auth-http.mjs`, `support-chat-{config,context,http,provider}.mjs`; test `support-conversation.test.mjs`, `support-demo-ui.test.mjs`; UI Staff `staff-support-assistant.tsx`, `staff-support-conversation.mjs`; QA `runtime.mjs`, `support.browser.mjs`, `support-live.browser.mjs`. Auth Service và dữ liệu nghiệp vụ không được sửa.

## Cửa sổ chat nổi

Một cửa sổ Trợ lý CleanHome dùng chung trên các trang đã đăng nhập; `/ho-tro` mở chính cửa sổ này và giữ FAQ. Gợi ý từ sáu FAQ local hỗ trợ có/không dấu, từ đồng nghĩa, mũi tên và Escape; gõ không gọi API. Enter gửi nội dung, Shift+Enter xuống dòng; khi đã dùng mũi tên chọn gợi ý, Enter xác nhận gợi ý trước. Khi được duyệt, câu hỏi gửi theo free-text; khi chưa được duyệt, FAQ vẫn dùng `{questionId}` cũ. Phản hồi AI và hướng dẫn FAQ cố định có nhãn riêng; lỗi không tạo câu trả lời AI giả.

QA cửa sổ nổi ngày 06/11/2026: unit support 43/43, auth/session/runtime 38/38, typecheck và Webpack PASS. Chrome 11 nhóm PASS (Auth/BFF thật, phản hồi/lỗi provider là mock có nhãn), gồm responsive 375/390/768/1440 và 375×667, bàn phím, điều hướng, timeout, 401/403/429/503, retry, xóa, logout, A/B và F5. Một FAQ qua Groq thật nhận HTTP 200, AI REAL_PASS; không chạy lại năm FAQ còn lại trong lượt này. Kết quả QA local không thay thế nghiệm thu môi trường production.

File thay đổi trong lượt cửa sổ nổi (15 file):

- `frontend/apps/staff/`: `app/layout.tsx`, `app/globals.css`, `package.json`, `test/support-demo-ui.test.mjs`, `test/support-search.test.mjs`, `docs/STAFF_SUPPORT_AI_CONFIGURATION.md`.
- `frontend/packages/ui/src/components/staff/`: `staff-app-providers.tsx`, `staff-auth-portal.tsx`, `staff-support-assistant.tsx`, `staff-support-knowledge.tsx`, `staff-support-search.ts`, `staff-support-widget-context.tsx`, `staff-support-widget.tsx`.
- `qa/staff/`: `support.browser.mjs`, `support-live.browser.mjs`.

## QA và bật cấu hình

Production: nạp biến server vào tiến trình Next Staff, khởi động lại; tuyệt đối không dùng NEXT_PUBLIC cho key. QA độc lập: nạp các biến AI vào phiên PowerShell rồi chạy `node qa/staff/runtime.mjs refresh-frontend`; runtime chỉ truyền allowlist các biến AI này tới frontend, không in giá trị, không seed/migrate. Mặc định QA tiếp tục tắt AI. Không sửa hoặc sao chép secret từ repository gốc.

Unit: `npm.cmd run test:support --workspace @cleanhome/staff` tại `frontend/` (provider/auth doubles). Chrome tại 3102: `$env:RUN_STAFF_ISOLATED_SUPPORT_QA='true'; node qa/staff/support.browser.mjs`. Harness kiểm tra Auth/BFF/FAQ thật, còn phản hồi AI dùng CDP mock có nhãn MOCK QA, không phải bằng chứng provider thật. Không lưu mock vào source sản phẩm hoặc runtime.

Để nghiệm thu AI thật còn cần endpoint/key/model được cấp phép, phê duyệt FAQ v2 và ngân sách/chính sách dữ liệu; sau đó kiểm tra chất lượng câu trả lời tiếng Việt, lỗi/hạn mức và session trên môi trường triển khai. Khi chưa có những cấu hình này, AI REAL_PASS là NOT_RUN.

Kết quả bước 3 ngày 06/11/2026 (UTC+7): unit 36/36 PASS (Auth/provider doubles), TypeScript PASS, Webpack PASS. Chrome: 3 nhóm REAL_PASS (FAQ/session/BFF fallback và phân biệt ứng dụng bản đồ với lỗi tile), 4 nhóm MOCK_PASS (reply/loading/lỗi/retry, bàn phím, responsive 375/390/768/1440, A/B/F5). Không có browser exception, request ghi nghiệp vụ hoặc gọi provider tính phí. AI thật NOT_RUN. Một lần kiểm tra OSM cho thấy Chrome ERR_CONNECTION_RESET và probe HTTP độc lập UND_ERR_CONNECT_TIMEOUT, còn Leaflet/marker/lịch hoạt động; không sửa bản đồ.
