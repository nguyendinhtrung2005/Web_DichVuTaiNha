# Dọn dẹp và tối ưu project — 07/11/2026

Trạng thái ban đầu: nhánh `feat/mysql-database-integration`, nhiều WIP Customer đã tồn tại và phải được giữ nguyên. Không commit/push/đổi nhánh/reset, không đổi API/schema/DB.

Quyết định chủ nhiệm: **chỉ tối ưu Customer, giữ nguyên package/lockfile/portal/module dùng chung**; owner đã đồng ý **xóa file tracked frontend-legacy**. Các đề xuất dùng chung ở dưới chưa được phép thực hiện trong nhiệm vụ này.

## Kết quả khảo sát

- README gốc vẫn hướng dẫn Vite5173/Node18 và nói backend chưa có API, trái với Next Customer3001 + Gateway/MySQL hiện tại. Cần cập nhật hướng dẫn chính và đánh dấu tài liệu migration kit là lịch sử.
- Ba dependency không có import nguồn/CSS/config nào trong frontend hiện tại: `@vercel/analytics`, `date-fns`, `next-themes`. Đang được khai báo trực tiếp ở frontend/package.json và cả ba apps/*/package.json. `react-dom` không có import trực tiếp nhưng bắt buộc với React/Next; phải giữ. `shadcn` được CSS import, phải giữ.
- `frontend-legacy` có 60 file, 1.932.637 byte trước dọn. Owner đã đồng ý gỡ; đã xác minh working/index sạch và chỉ xóa đúng 60 file tracked, giữ nguyên file riêng/ignored nếu có. Không dùng xóa đệ quy; sau khi dọn không còn file riêng nên thư mục rỗng cũng được gỡ.
- Có 33 module không tới được từ import graph page/layout của ba app. Đây chỉ là ứng viên rà soát: có public exports/test/direct consumers nên không coi là bằng chứng đủ để xóa. Ví dụ core/index.ts là public package entry, phải giữ. Không xóa kho component UI, mock-data hoặc test dựa trên graph này.
- Ảnh PNG ở mỗi app khoảng 1,4–1,8 MB/ảnh; Customer đang tắt Next Image Optimization. Có thể tối ưu ảnh local bằng Next và giữ passthrough ảnh ngoài/ảnh cần auth; không đổi ảnh gốc hoặc mở remotePatterns wildcard.
- Các app cần public assets độc lập để build/deploy riêng; ảnh giống hash giữa apps không phải lý do đủ để xóa một bản.
- Portal đang import trực tiếp màn hình của cả ba vai trò. Có thể dùng next/dynamic để tải màn hình khi điều hướng, giữ route/guard/Context/hành vi và SSR.
- Số JS chunk Customer production trước tối ưu: 14 file, tổng 1.771.762 byte. Đây là tổng mọi chunk, chưa phải số byte tải đầu trang.

## Thay đổi có thể thực hiện trong phạm vi Customer/tài liệu

1. Sửa README gốc để trỏ đúng hướng dẫn frontend/backend, phân biệt Customer API và Staff/Admin demo.
2. Tái sử dụng Intl formatter ngày giờ Customer thay vì tạo lại mỗi hàng/bước; output và timezone không đổi.
3. Hủy yêu cầu tìm dịch vụ đã lỗi thời khi đổi bộ lọc/unmount, dùng AbortSignal qua API client và pagination có sẵn; không đổi contract.
4. Tối ưu chỉ ảnh public local Customer qua Next. Không xóa/đổi file ảnh; ảnh ngoài, data/blob và các đường dẫn không nằm trong public allowlist giữ unoptimized để tránh lỗi host hoặc mở quyền fetch không cần thiết.

## Phần dùng chung cần xác nhận theo BACKEND_TEAM_RULES mục 6/7/12/14

Phương án cụ thể, **không thực hiện theo lựa chọn giữ nguyên phần dùng chung của chủ nhiệm**; các dòng dưới là đề xuất cho đợt owner review sau:

- File: `frontend/package.json`, `frontend/apps/{customer,staff,admin}/package.json`, `frontend/package-lock.json`.
- Xóa ba dependency trực tiếp không dùng nêu trên; giữ Next/React và mọi package có consumer. Cập nhật lock bằng `npm install --package-lock-only --ignore-scripts --offline --no-audit --no-fund`, không nâng phiên bản hoặc sửa node_modules. So sánh phiên bản còn lại trước/sau.
- File `frontend/packages/ui/src/portal.tsx`: đổi import màn hình sang next/dynamic; không đổi route/role/guard/props hoặc sửa source màn hình Admin/Staff. Loading dùng component hiện có. Cần regression cả ba vai trò.
- Chưa xóa module có public exports, bộ mock Staff/Admin, test, API contract, migration, fixture cleanup, docs nghiệm thu hoặc file hướng dẫn AI.
- Có thể gỡ hai module giao diện cũ `frontend/packages/ui/src/dashboard.tsx` và `frontend/packages/ui/src/orders.tsx` nếu owner xác nhận không còn consumer ngoài repo. Không gỡ `manage.tsx` vì Portal còn dùng Profile.

## Nếu owner duyệt bỏ frontend-legacy

Kiểm tra lại git status và nội dung file so với baseline, chỉ xóa danh sách file tracked đã duyệt dưới đường dẫn tuyệt đối trong workspace. Giữ mọi untracked/ignored như .env và node_modules nếu có. Không dùng xóa thư mục đệ quy hoặc xóa theo wildcard chung. Code lịch sử vẫn có trong Git, không tự commit việc xóa. Tài liệu phải ghi thay đổi rõ ràng.

## Kiểm chứng dự kiến

- Frontend unit, typecheck ba app, build và browser Customer; Staff/Admin smoke nếu sửa dùng chung.
- Backend test/schema không cần nếu không sửa backend; fixture/browser chỉ theo target/marker/ID đã được duyệt trước.
- So sánh network/chunk và dung lượng ảnh bằng số đo thực; không coi dependency declaration bị xóa là số MB disk đã được giải phóng.
- Không xóa/chỉnh tay node_modules, .next, dist, database hoặc browser storage. Không xóa hàng loạt docs/tests vì không xuất hiện trong import graph.

## Thay đổi đã thực hiện

- Gỡ đúng 60 file tracked sạch trong frontend-legacy (1.932.637 byte); không reset/stage/commit. Trước khi xóa kiểm tra cả working tree lẫn index, tất cả đường dẫn tuyệt đối phải nằm dưới frontend-legacy trong workspace. Chỉ gỡ thư mục đã rỗng, không xóa đệ quy.
- README gốc hướng dẫn đúng Next3001/Gateway thay Vite5173, liên kết tài liệu hiện có và nói rõ giới hạn Staff/Admin demo. MIGRATION_CLEANHOME.md có nhãn lịch sử, không xóa nội dung tham khảo.
- Customer dùng CustomerImage cho ảnh dịch vụ/sản phẩm/auth/trang chủ. Chỉ raster public dưới /images với tên đường dẫn được kiểm tra mới đi qua Next optimizer, output WebP theo Accept/sizes. Giữ ảnh nguồn, layout và fallback; remote/auth/query/data/blob/SVG vẫn passthrough. Không mở remotePatterns wildcard. Next localPatterns chỉ chấp nhận /images/** không có query.
- customerDay/customerDate giữ output/múi giờ nhưng dùng hai Intl formatter tái sử dụng; test 200 lần gọi không sinh formatter theo từng dòng.
- Search có AbortController; đổi tiêu chí/unmount hủy fetch/pagination cũ qua API client sẵn có, không chỉ bỏ kết quả trả muộn.
- Không sửa backend, API contract, schema, migration, seed hoặc .env. Giữ nguyên toàn bộ package/lockfile, portal, hai module cũ và Staff/Admin theo lựa chọn chủ nhiệm. Các file này đã có WIP trước nhiệm vụ, không được hoàn tác để làm git status sạch.

## File thay đổi ngoài danh sách xóa legacy

- README.md, MIGRATION_CLEANHOME.md: hướng dẫn chạy và nhãn lịch sử.
- frontend/docs/PROJECT_CLEANUP.md: khảo sát, quyết định, phạm vi, bằng chứng.
- frontend/apps/customer/next.config.mjs: bật optimizer chỉ ảnh local public.
- frontend/packages/core/src/customer-image-policy.ts và frontend/packages/ui/src/components/customer/customer-image.tsx: chính sách ảnh và wrapper Customer.
- frontend/packages/core/src/customer-time.ts: cache Intl.
- frontend/packages/core/src/customer-api-store.ts, customer-service-search.ts: truyền AbortSignal cho các trang kết quả Customer.
- frontend/packages/ui/src/components/customer/service-catalog.tsx: hủy request cũ.
- Các component Customer customer-auth.tsx, customer-booking.tsx, customer-order-detail.tsx, customer-orders.tsx, home-sections.tsx, service-card.tsx, service-detail.tsx, product-pages.tsx: dùng wrapper ảnh, giữ UI và sizes tương ứng.
- frontend/tests/customer-optimization.unit.test.mjs: ảnh public/passthrough, cache formatter, abort search.
- frontend/tests/customer-browser.cdp.mjs: đo bytes ảnh thực và kiểm tra optimizer không fetch arbitrary remote.

## Dung lượng JavaScript

Tổng chunk production trước: 14 file / 1.771.762 byte. Sau mã cuối: 14 file / 1.772.202 byte (+440 byte). Đây là tổng mọi chunk, không phải initial transfer. Không tuyên bố giảm JS: tối ưu lazy loading/phụ thuộc dùng chung chưa được duyệt. Lợi ích đang kiểm chứng là dung lượng ảnh truyền tải, giảm tạo formatter và hủy request dư.

## Kết quả kiểm chứng cuối

| Kiểm tra/lệnh đã chạy | Kết quả |
|---|---|
| frontend: `npm.cmd run test:commerce` | **PASS 51, FAIL 0, SKIP 0**; thêm kiểm tra image allowlist/passthrough, reuse Intl và abort pagination |
| frontend: `npm.cmd run typecheck` | **PASS** Customer/Staff/Admin |
| frontend: `npm.cmd run build:customer` | **PASS** compilation, TypeScript và static generation trên mã cuối |
| backend: `$env:ALLOW_CUSTOMER_DB_TEST='1'; npm.cmd run test:products:browser` | **PASS** Chrome thật + Next4301 + Gateway/services/MySQL; Customer auth/profile/search/booking/orders/history/review/payment simulation và regression products/cart/stock/recovery/mobile390px |
| root: `git diff --check` | **PASS**; cảnh báo chuyển LF/CRLF không phải lỗi whitespace |
| Kiểm tra dữ liệu sau fixture cleanup bằng SELECT | **PASS** users1/branches1/categories3/services4/products2/bookings0/product_orders0, inventory quantity40/reserved0, không còn registry JSON |
| Backend unit suite riêng | **SKIP** trong đợt cleanup — không sửa backend; browser vẫn chạy với backend/MySQL thật |
| Staff/Admin browser smoke/build riêng | **SKIP** trong đợt cleanup — theo quyết định không sửa phần dùng chung, có typecheck cả hai |
| Lint riêng | **SKIP** — không có script lint hiện tại |
| Production hosting/load test/pixel comparison mọi viewport | **NOT VERIFIED** |

Số đo thực tế qua Next/browser: ảnh `/images/hero.png` gốc **1.723.267 byte**, request optimizer `w=640&q=75` với Accept image/webp trả **31.662 byte**, HTTP200/content-type image/webp, giảm **98,16%** so với truyền file gốc. Đây là một kích thước/ảnh cụ thể, không phải tuyên bố mọi trang hoặc ảnh đều giảm cùng tỷ lệ. Request ảnh ngoài domain chưa cho phép trả HTTP400. Ảnh nguồn trên disk không bị đổi; runtime/cache optimizer yêu cầu Next server như kiến trúc hiện có.

Các process/fixture của browser test đã dọn. Chỉ khôi phục phần route import next-env do build tạo sau khi đối chiếu baseline, không chỉnh tay .next/node_modules. Không đổi nhánh/stage/commit/push/merge, không reset WIP. 60 file legacy đã bỏ khỏi working tree; lịch sử Git vẫn giữ bản cũ, không rewrite lịch sử để giảm dung lượng .git.

## Những phần chủ động giữ lại

- Ba dependency chưa dùng vẫn còn khai báo, package/lockfile không được sửa vì chủ nhiệm chọn giữ nguyên phần dùng chung. Không chạy npm install/uninstall/ci trong đợt này.
- Giữ portal và import hiện có, module dashboard/orders cũ, kho UI shared, mock-data/logic/store của Staff/Admin, tests, migration, contract và docs nghiệm thu. Danh sách ứng viên import graph chưa phải danh sách được phép xóa.
- Giữ public assets riêng của ba app, chỉ gỡ bản copy trong frontend Vite đã được duyệt bỏ.
- Không đổi nội dung quy tắc AGENTS/BACKEND_TEAM_RULES trong nhiệm vụ cleanup; tham chiếu cấu trúc cũ trong tài liệu lịch sử/rule cần owner xem xét khi cập nhật quy tắc chung.

Để thấy thay đổi optimizer, restart đúng terminal Customer (`npm.cmd --prefix frontend run dev:customer` từ root). Không cần seed/migration hoặc cấu hình credential mới. Shared cleanup/lazy loading cần owner review ở nhiệm vụ riêng nếu nhóm muốn tiếp tục.
