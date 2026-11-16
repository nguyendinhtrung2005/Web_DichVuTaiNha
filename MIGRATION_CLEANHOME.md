# HƯỚNG DẪN CHUYỂN FRONTEND CLEANHOME VÀO WEB_DICHVUTAINHA

## Nội dung

- Mã nguồn `cleanhome-frontend/` là toàn bộ workspace Next.js 16 (khách hàng, nhân viên, quản trị, packages dùng chung).
- `apply-cleanhome.ps1`: áp dụng vào repository Git hiện có trên Windows PowerShell.
- `apply-cleanhome.sh`: áp dụng trên macOS/Linux/Git Bash.
- **Không chứa `.git`**, không chạy git push và không truy cập GitHub thay cho bạn.

## Trước khi chuyển

1. Mở Terminal trong thư mục **thực tế có `.git`, `backend/`, `frontend/`** (thường tên là `Web_DichVuTaiNha`).
2. Chạy `git status`; bảo đảm đã commit hoặc stash mọi thay đổi quan trọng. Nên tạo branch: `git switch -c feat/cleanhome-frontend`.
3. Giải nén file ZIP migration kit vào một thư mục riêng, **không** ghi đè vào repository.
4. Cài Node.js >= 22.9 và npm tương ứng.

## Cách chạy trên Windows (PowerShell)

Tại thư mục vừa giải nén migration kit:

```powershell
powershell -ExecutionPolicy Bypass -File .\apply-cleanhome.ps1 -ProjectPath "D:\DuAn\Web_DichVuTaiNha"
```

Thay `D:\DuAn\Web_DichVuTaiNha` bằng đường dẫn thật. Script kiểm tra cấu trúc repo và Git working tree. Nếu đã sửa file chưa commit, script sẽ từ chối để tránh mất dữ liệu. Script sẽ:

- Đổi `frontend/` của Vite hiện tại thành `frontend-legacy/`;
- Chép frontend CleanHome vào `frontend/`;
- Giữ nguyên `backend/`, `databases/`, `.git/`, các file hiện có ngoài `frontend/`;
- Thêm quy tắc ignore `.next`, `*.tsbuildinfo`, `.env*.local`;
- Ghi hướng dẫn `MIGRATION_CLEANHOME.md` trong repo.

Nếu repo đã có `frontend-legacy/` thì script **không ghi đè** và dừng để bạn xử lý.

### macOS/Linux/Git Bash

```bash
bash ./apply-cleanhome.sh "/duong-dan/den/Web_DichVuTaiNha"
```

## Chạy frontend mới

Mở Terminal tại `Web_DichVuTaiNha/frontend`:

```bash
npm ci
npm run typecheck
npm run dev:customer
```

Để chạy đủ ba website, mở 2 terminal khác cùng thư mục:

```bash
npm run dev:staff
npm run dev:admin
```

| Site | URL local |
| --- | --- |
| Khách hàng | http://localhost:3001 |
| Nhân viên | http://localhost:3002 |
| Admin | http://localhost:3003 |

Muốn build: `npm run build` ở thư mục `frontend`.

### GitHub (chỉ chạy sau khi đã kiểm tra)

```bash
git status
git add -A
git commit -m "feat: migrate CleanHome frontend into main project"
git push -u origin feat/cleanhome-frontend
```

Nếu bạn làm việc trực tiếp trên nhánh `main`, hãy dùng workflow phù hợp nhóm. Nên tạo Pull Request để review trước khi merge vào `main`.

## Những điều **chưa** được tích hợp

- Next.js thay thế Vite; script không biến đổi mã React Vite cũ. Mã Vite được giữ ở `frontend-legacy/`.
- Hệ thống backend của repo hiện là khung service, **chưa có API hoạt động để giao diện CleanHome kết nối**. CleanHome vẫn chạy dữ liệu demo trong localStorage.
- Trạng thái của ba site customer/staff/admin **không đồng bộ** giữa các cổng.
- Chức năng mở rộng của bản Vite cũ (mặt hàng, sửa chữa, điện lạnh...) **không tự chuyển** sang CleanHome. Mã vẫn ở `frontend-legacy/` để di chuyển có chọn lọc sau.
- Chưa có xác thực, phân quyền hoặc thanh toán thật; không nhập mật khẩu thật trong demo.
- Nếu bạn đã thêm các thay đổi mới vào repo trên máy sau khi nén bản `.rar`, hãy kiểm tra và giải quyết khác biệt trước khi chạy script.

## Hoàn tác

Chỉ hoàn tác khi đang ở đúng branch và không có thay đổi quan trọng chưa lưu:

```powershell
# Windows PowerShell, chạy trong repo
Rename-Item frontend frontend-cleanhome-backup
Rename-Item frontend-legacy frontend
```

Nếu đã commit, ưu tiên hoàn tác bằng Git trên nhánh tương ứng (chẳng hạn `git revert`) để giữ lịch sử rõ ràng.
