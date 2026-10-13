# CleanHome — khôi phục ba website riêng

## Phạm vi

Theo yêu cầu trình diễn đồ án, CleanHome chạy riêng Customer tại `3001`, Staff tại `3002` và Admin tại `3003`. Giữ toàn bộ màn hình và nghiệp vụ đã hoàn thiện trong Giai đoạn 2–3. Không đổi thương hiệu, sửa backend/database, thêm dependency, commit/push hoặc hoàn tác các thay đổi Git có trước.

Trước lượt khôi phục này, `apps/customer/next.config.mjs` vẫn đặt `NEXT_PUBLIC_APP_MODE: "unified"`. Vì vậy Customer đi qua bước chọn dữ liệu Giai đoạn 4: việc khôi phục chưa hoàn tất trong cấu hình. Lượt này đặt chế độ `legacy` rõ ràng cho cả ba ứng dụng và dùng lại các luồng đăng nhập, route, component và dữ liệu riêng sẵn có.

## Hành vi sau khôi phục

| Website | Trang chính | Đăng nhập | Khu vực quản lý |
| --- | --- | --- | --- |
| Customer | `http://localhost:3001` mở trang chủ trực tiếp | `http://localhost:3001/dang-nhap` | `/dat-dich-vu`, `/don-cua-toi`, `/lich-su`, `/ho-so` |
| Staff | `http://localhost:3002` cần tài khoản Staff | `http://localhost:3002/dang-nhap` | `/cong-viec`, `/don/:id`, `/lich-lam-viec`, `/ho-so` |
| Admin | `http://localhost:3003` cần tài khoản Admin | `http://localhost:3003/dang-nhap` | `/don-dich-vu`, `/phan-cong`, `/lich-lam-viec`, `/tai-khoan`, `/dich-vu`, `/thanh-toan`, `/danh-gia`, `/bao-cao`, `/ho-so` |

Customer không yêu cầu migration hoặc nhập bản sao dữ liệu để mở trang chủ/đăng nhập. URL Giai đoạn 4 trên cổng Customer như `/staff/...` và `/admin/...` chuyển đến website tương ứng; việc chuyển cổng không mang theo phiên đăng nhập. Đăng nhập lại bằng đúng vai trò tại website đích.

Trang `/du-lieu` của mỗi website chỉ xuất bản sao nguồn tại chính origin đó; không tự nhập, hợp nhất hoặc sửa dữ liệu. Mã hợp nhất Giai đoạn 4 được giữ để tham khảo/phát triển sau, không dùng làm chế độ mặc định.

## Bảo toàn dữ liệu và tài khoản

| Origin | Khóa dữ liệu riêng |
| --- | --- |
| `http://localhost:3001` | `cleanhome-demo-state-customer` |
| `http://localhost:3002` | `cleanhome-demo-state-staff` |
| `http://localhost:3003` | `cleanhome-demo-state-admin` |

- Dùng lại dữ liệu và mã xác thực tài khoản thử nghiệm trong khóa riêng nếu cấu trúc/version hợp lệ; không thay tài khoản hiện có bằng tài khoản mặc định.
- Khi chưa có khóa riêng trên một origin, sử dụng dữ liệu phát triển đã có trong dự án theo cơ chế cũ. Không bắt buộc nhập file từ website khác và không tự lấy dữ liệu hợp nhất làm nguồn.
- Nếu dữ liệu đã lưu hỏng, version không hỗ trợ hoặc trình duyệt chặn truy cập, giữ nguyên nguồn. Cơ chế bảo vệ không được ghi dữ liệu khởi tạo đè lên khóa đó; thông báo giới hạn rõ ràng thay vì tự reset.
- Giữ nguyên `cleanhome-unified-state-v1` và phiên Giai đoạn 4; không xóa, nhập ngầm hoặc chuyển chúng sang khóa riêng.
- Các thao tác người dùng chủ động thực hiện sau đăng nhập vẫn lưu theo luồng hiện có. Trường hợp không lưu được phải báo giới hạn, không khẳng định đã đồng bộ máy chủ.

Trong trường hợp chỉ giữ thay đổi trong phiên, tải lại hoặc đóng trang sẽ mất các thay đổi chưa lưu. `/du-lieu` chỉ sao lưu bản gốc đang có trong localStorage, không sao lưu bản làm việc trong RAM và không sửa bản gốc bị lỗi. Các tài khoản chỉ được tạo trong dữ liệu hợp nhất Giai đoạn 4 không tự chuyển sang ba kho riêng.

Ba cổng là ba origin khác nhau. Đơn Customer vừa đặt không tự xuất hiện ở Admin/Staff; tài khoản Admin vừa tạo không tự xuất hiện ở website khác. Để trình diễn từng phía, dùng dữ liệu hiện có của chính website đó. Đây vẫn là frontend dùng lưu trữ trình duyệt, chưa có backend dùng chung hoặc thanh toán/hoàn tiền thực tế.

Nếu tài khoản cũ không đăng nhập được, kiểm tra đúng website, trạng thái tài khoản và dữ liệu riêng trước; không xóa localStorage để thử lại. Dùng `/du-lieu` để xuất bản sao nếu cần đối chiếu. Thông tin tài khoản thử nghiệm gốc được khai báo tại [auth.ts](../packages/core/src/auth.ts); không hiển thị lại thông tin xác thực trong báo cáo khôi phục.

## File liên quan

Các đường dẫn tính từ `frontend/`. Danh sách cuối cùng được đối chiếu sau khi hoàn tất chỉnh sửa và kiểm thử:

| File | Mục đích |
| --- | --- |
| `apps/customer/next.config.mjs` | Chọn rõ chế độ Customer riêng, giữ cổng và thương hiệu |
| `apps/staff/next.config.mjs` | Chọn rõ chế độ Staff riêng |
| `apps/admin/next.config.mjs` | Chọn rõ chế độ Admin riêng |
| `apps/customer/app/staff/[[...slug]]/page.tsx` | Chuyển URL Staff Giai đoạn 4 sang website Staff |
| `apps/customer/app/admin/[[...slug]]/page.tsx` | Chuyển URL Admin Giai đoạn 4 sang website Admin |
| `apps/customer/app/du-lieu/page.tsx` | Xuất nguồn Customer riêng, không bắt buộc thiết lập dữ liệu chung |
| `packages/core/src/store.ts` | Bảo vệ dữ liệu riêng đã có khi JSON/version/lưu trữ gặp lỗi |
| `packages/ui/src/portal.tsx` | Hiển thị giới hạn dữ liệu riêng khi cần, giữ route và màn hình hiện có |
| `packages/ui/src/components/shared/data-export.tsx` | Mô tả sao lưu website riêng, quay lại trang chính của chính website; giữ định dạng và thao tác xuất |
| `README.md` | Hướng dẫn ba website và dữ liệu riêng hiện tại |
| `docs/FRONTEND_UNIFICATION_PHASE4.md` | Ghi chú báo cáo hợp nhất là lịch sử, giữ nguyên nội dung cũ |
| `docs/THREE_WEBSITES_RESTORE.md` | Báo cáo khôi phục, kiểm tra và hướng dẫn sử dụng |

## Chạy và đăng nhập

Từ repository, đặt cả ba Terminal tại thư mục `frontend`. Nếu đang chạy bản hợp nhất trên `3001`, nhấn Ctrl+C tại đúng Terminal đó rồi khởi động lại để Next.js nạp cấu hình mới. Không mở tiến trình trùng cổng.

Terminal Customer:

```powershell
npm.cmd run dev:customer
```

Terminal Staff:

```powershell
npm.cmd run dev:staff
```

Terminal Admin:

```powershell
npm.cmd run dev:admin
```

Mở trang đăng nhập ở bảng đầu tài liệu, dùng tài khoản đúng vai trò hiện có của website tương ứng. Customer có đăng ký công khai; Staff và Admin giữ đăng nhập riêng, không có đăng ký công khai. Phiên và dữ liệu giữa ba cổng độc lập.

## Kiểm tra

Đã kiểm tra phiên bản ba website sau khôi phục; không dùng kết quả lịch sử Giai đoạn 4 thay cho kiểm tra lần này:

- **Build production và TypeScript check Customer, Staff, Admin đều đạt** sau thay đổi cuối. Chạy tuần tự để tránh tranh chấp types do Next.js sinh ra.
- **111 kiểm tra trình duyệt**: Customer 38, Staff 30, Admin 43; gồm mở trực tiếp, đăng nhập đúng/sai vai trò, giữ phiên khi tải lại, các route chính Giai đoạn 2–3, tìm kiếm, menu và đăng xuất. Đã mở 28 lượt route; không bị yêu cầu chọn/nhập dữ liệu. Không chạy lại toàn bộ thao tác thay đổi nghiệp vụ Giai đoạn 2–3.
- **124 lượt bố cục** ở `375`, `390`, `768`, `1440px` cho các trang chính; không phát hiện tràn ngang hoặc vùng thao tác vượt màn hình. Đã xem ảnh Customer mobile, Staff desktop và Admin mobile.
- **90 kiểm tra và 12 lượt bố cục bổ sung** trên ba bản build cuối: trang `/du-lieu` hiển thị sao lưu riêng, link quay lại `/`, xuất nguyên raw và đúng checksum/source; nguồn lỗi vẫn giữ nguyên, nguồn rỗng báo lỗi và không tự tạo dữ liệu. Blob sao lưu chỉ giữ trong RAM khi kiểm thử, không ghi file có thông tin xác thực vào artifact.
- **82 kiểm tra trình duyệt về an toàn dữ liệu** trên bản build cuối: dữ liệu riêng hợp lệ không bị viết lại khi chỉ mở trang; JSON lỗi, version không hỗ trợ, cấu trúc sai, quyền đọc bị chặn và lỗi quota không thay thế dữ liệu gốc. Đăng nhập trong RAM vẫn hoạt động, có thông báo giới hạn; khóa hợp nhất, phiên hợp nhất và khóa không liên quan được giữ nguyên. Đã xem thêm cảnh báo mobile 375px.
- **Bốn redirect HTTP** từ `/staff`, `/staff/cong-viec`, `/admin`, `/admin/bao-cao` trên `3001` sang đúng website riêng đạt; kiểm tra lại sau build cuối cũng đạt.
- **159 assertions core cho ba chế độ riêng, 88 assertions hồi quy unified** đạt. Kiểm tra routing/SSR 68, route policy 160, adapter guard 9, config/redirect 19 đều đạt. Không sửa authentication hoặc công thức nghiệp vụ.
- **Bảo toàn 209 file đã ghi nhận trước chỉnh sửa**: 198 giữ nguyên hash, 11 thay đổi đúng bảng trên; thêm duy nhất tài liệu này. Không mất file hoặc thay đổi ngoài phạm vi đã kiểm tra. Toàn bộ 329 dòng Git status có trước giữ nguyên; chỉ thêm dòng của tài liệu mới. `git diff --check` và kiểm tra khoảng trắng của 12 file thay đổi đạt.

QA dùng Chrome profile riêng, không truy cập/reset localStorage của người dùng. Mỗi lượt phục hồi và đối chiếu nguyên văn dữ liệu trong profile QA; các báo cáo có `dataRestored: true`. Không ghi nhận exception JavaScript trong các lượt hoàn tất. CDP timeout 20 giây/lệnh, mỗi suite tối đa 115–230 giây. Chrome QA đã đóng sau kiểm tra; giữ ba production server ở `3001`, `3002`, `3003` để xem giao diện. Muốn chuyển sang development, dừng đúng server đang chạy rồi dùng các lệnh bên trên, không chạy trùng cổng.

Artifact kiểm tra:

- `%TEMP%/cleanhome-restore-three-sites-qa/`: báo cáo từng vai trò, `*-export-final-report.json` và screenshot mobile/desktop.
- `%TEMP%/cleanhome-three-sites-storage-browser/`: `report.json` và screenshot cảnh báo; không chứa bản sao dữ liệu xác thực.
- `%TEMP%/cleanhome-three-sites-restore/preservation-report.json`: đối chiếu file và Git status.

Chạy build rồi typecheck tuần tự cho từng ứng dụng:

```powershell
npm.cmd run build:customer
npm.cmd run typecheck --workspace=@cleanhome/customer -- --incremental false
npm.cmd run build:staff
npm.cmd run typecheck --workspace=@cleanhome/staff -- --incremental false
npm.cmd run build:admin
npm.cmd run typecheck --workspace=@cleanhome/admin -- --incremental false
```

Để kiểm tra thủ công, mở Customer trang chủ, đăng nhập đúng vai trò ở từng cổng, duyệt các màn hình chính rồi đăng xuất. Nếu tab cũ vẫn hiển thị màn hình hợp nhất, tải lại trang sau khi server đã nạp cấu hình mới; không xóa localStorage. Không cần nhập dữ liệu từ website khác.

Chưa kiểm chứng backend/database, dữ liệu đa thiết bị, xác thực máy chủ hoặc giao dịch thanh toán thực tế. Không thay đổi những giới hạn này trong lượt khôi phục.
