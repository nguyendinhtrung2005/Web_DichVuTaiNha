# Phương án Git sạch theo owner sau khi kiểm tra remote

Ngày đối chiếu: 25/10/2026, giờ Việt Nam. Không commit/push/merge, không checkout/rebase/cherry-pick/reset hoặc tạo worktree/branch trong repository dự án. Lịch sử remote được đọc trong một kho audit riêng ở TEMP; refs, HEAD, index và working tree dự án được bảo toàn ngoài các cập nhật staging đã được phép.

## Kết quả remote khác với thông tin local trước đây

| Đối tượng | Commit / kết quả đã xác minh |
| --- | --- |
| HEAD, feat/cleanhome-frontend, origin/feat/cleanhome-frontend local | afc5d78b993ec379ba9a9a3c5ab87059dfe2930b |
| main và origin/main local (chưa cập nhật) | 898b65c8d0595c54627977310ff6ca36c1dbade7 |
| GitHub refs/heads/main thực tế khi đọc remote | **3e90f134fc9e344d6750280e6a0ce8abbf9290d5** |
| GitHub refs/heads/feat/cleanhome-frontend | afc5d78b993ec379ba9a9a3c5ab87059dfe2930b |
| Merge-base remote main thật và feature | **afc5d78** |
| Remote main so với feature | Main hơn một merge commit, feature không có commit riêng |
| Commit mới trên main | 3e90f13: Merge pull request #1 from nguyendinhtrung2005/feat/cleanhome-frontend |
| Cây file của main và feature baseline | Cùng tree **e4c723759a24ec2cd181f311548005c0f87f4343** |

Main có hai parent898b65c và afc5d78; không có khác biệt nội dung giữa main 3e90f13 và baseline afc5d78. Vì vậy **272 file Frontend nền đã nằm trong main trên GitHub qua PR #1**. Cảnh báo kéo lại 272 file chỉ còn đúng khi so với ref local cũ898b65c; không được dùng nó làm kết luận về main thật hiện tại.

Kiểm kê lịch sử local cũ vẫn đúng về nguồn gốc: commitafc5d78 thay272 file, trong đó5đườngdẫn cũng thuộc handoff và267ngoài manifest. So staged với origin/main local cũ cho267 đường dẫn nền ngoài scope; đó là ref cũ, không phải PRdiff tới main thật. Vì hai cây main 3e90f13 và afc5d78 giống hệt, **diff từ index hiện tại tới main thật chỉ có phạm vi handoff**, không mang thêm267file nền. Không cần cherry-pick, rebase hoặc replay commit Frontend cũ.

Chỉ hai remote heads main và feat/cleanhome-frontend được advertised khi kiểm tra. Chưa có nhánh integration/uc9-uc12; chưa biết branch-protection/CI trên GitHub và không coi việc đọc remote là phê duyệt tên nhánh mới. Nếu main tiến thêm trước khi publish, kiểm tra lại remote và các file chồng lấn.

## Phương án đề xuất tốt nhất

Đề xuất nhóm dùng **integration/uc9-uc12**, tạo riêng từ main đã cập nhật (baseline đã kiểm chứng3e90f13), làm base cho sáu PR owner. Đây là tên nhánh đề xuất, **chưa tạo hoặc được tự nhận đã thống nhất**. Cách này cho phép ghép provider/consumer và tài liệu liên service trong nhánh tích hợp trước một PR cuối vào main; tránh đưa trạng thái tích hợp còn thiếu dependency lên main.

| Thứ tự | Head đề xuất | Base đích | Dependency cần có trong base trước khi tạo/kiểm tra head |
| --- | --- | --- | --- |
| 1A | handoff/staff-test-schema | integration/uc9-uc12 | Bốn SQL chỉ bàn giao source, không chạy database |
| 1B | handoff/auth-staff-rs256 | integration/uc9-uc12 | Có thể review song song schema; runtime cần schema đã khởi tạo ngoài quy trình Git |
| 2 | handoff/order-staff-transitions | integration/uc9-uc12 | Schema/Auth; Staff đồng review contract |
| 3 | handoff/staff-uc9-uc12 | integration/uc9-uc12 | Schema/Auth/Order; Order đồng review contract |
| 4 | handoff/staff-bff-uc9-uc12 | integration/uc9-uc12 | Auth/Staff/Order; chỉ CSS57 dòng Staff |
| 5 | handoff/uc12-qa-and-handoff | integration/uc9-uc12 | Tất cả provider +Frontend; nhận12QA và toàn bộ tài liệu handoff, không bỏ sót proof/list/PRbody |
| 6 | integration/uc9-uc12 (PR tổng tích hợp) | main | Sáu PR owner đã ghép, kiểm tra tổ hợp cuối và diff main thật sạch |

Schema/Auth có thể review song song, merge tuần tự theo quy trình nhóm. Các head Order/Staff/Frontend/QA nên được tạo từ **tip tích hợp sau khi dependency đã merge**, không tạo cả sáu từ baseline cố định rồi mặc định tất cả có provider cần thiết. Nếu đã tạo sớm, chỉ cập nhật bằng cách merge dependency được nhóm duyệt trong worktree tương ứng, không tự rebase/cherry-pick trên workspace đang làm.

Auth/Order/Staff mỗi service có unit độc lập; tích hợp HTTP là dependency runtime khác với việc unit dùng doubles. QA tooling có import mã Auth/Order và cần các provider thực khi thực thi; phải merge QA sau các provider và Frontend. Bốn SQL không được chạy tự động khi merge. Crosslink Markdown giữa README và báo cáo ở PR chưa merge phải được ghi nhận là dependency tài liệu tạm thời, review chung và kiểm tra link đầy đủ ở lượt tích hợp; không sửa code hoặc giả API để giải quyết vòng link tài liệu. Nếu CI bắt buộc mọi link hợp lệ ở từng PR, người tích hợp phải chốt cách chia phần tài liệu riêng trước merge, không bỏ kiểm tra âm thầm.

Nếu nhóm muốn chỉ sáu PR thẳng vào main thay vì nhánh tích hợp, có thể chọn main 3e90f13 làm baseline đã có Frontend và giữ cùng thứ tự dependency. Phương án này cần nhóm chấp nhận từng trạng thái trung gian; không còn lý do phải lấy feature cũ làm base để né272 file. Chưa thực hiện cả hai phương án.

## Bảo vệ workspace và index đang review

1. Giữ nguyên branch feat/cleanhome-frontend, HEADafc5d78 và index tổng hợp đã review; không stash/reset/clean hoặc checkout để tách ngay tại đây. Giữ nguyên các file EXCLUDE và CSSAdmin13dòng unstaged.
2. Sau khi người dùng duyệt staging và phương án nhánh, mới fetch cập nhật refs rồi xác minh main tip/merge-base. Không git pull vào working tree hiện tại.
3. Tạo integration/owner worktree ở thư mục riêng theo phương án đã duyệt; mỗi worktree có index riêng. Branch/worktree chưa được tạo trong nhiệm vụ này.
4. Chép **đúng blob index đã được review theo từng allowlist**, không sao chép nguyên working directory. CSS lấy blob/hunk Staff từ index, không lấy portal.css working70dòng; không lấy Portal/Customer/Admin ngoài scope.
5. Trước chép, so baseline afc5d78 với tip base mới trên các đường dẫn của nhóm đó. Nếu owner khác đã thay đổi cùng file, dừng để ghép/review; không ghi đè bản mới bằng snapshot cũ. Các thay đổi provider ở đường dẫn khác phải được giữ nguyên.
6. Mỗi owner worktree kiểm tra staged danh sách, secrets, whitespace và tests phù hợp trước commit. Nguồn group approval vẫn là qua người điều phối, không bịa chữ ký riêng.
7. Sau khi cả sáu PR ghép, kiểm tra diff integration...main thật, dependency và link, rồi mới tạo PR tổng tích hợp khi được phép. Không push toàn bộ index tổng hợp lên feature làm base để giả tách sáu PR.

Lệnh minh họa **chỉ dùng sau quyền mới và chọn tên/path cụ thể**, chưa thực hiện:

```powershell
git fetch origin main
git rev-parse origin/main
git merge-base origin/main feat/cleanhome-frontend
# Chỉ tạo nhánh/worktree sau khi người dùng chốt phương án:
git worktree add -b integration/uc9-uc12 "<thu-muc-integration-rieng>" origin/main
# Sau khi dependency cần thiết đã merge vào integration:
git worktree add -b handoff/staff-uc9-uc12 "<thu-muc-staff-rieng>" integration/uc9-uc12
```

Không tự chạy các lệnh trên trong lượt này. Repo audit TEMP chỉ dùng đọc remote; không thay refs dự án. Không chỉnh global safe.directory, thông số whitespace hoặc cấu hình repo để qua kiểm tra.

## Điều kiện commit và tạo Draft

Staging sạch về đường dẫn/secret/whitespace là điều kiện kỹ thuật, không tự cho phép commit/push/tạo PR. Người dùng cần xác nhận staged diff cuối và chọn phương án integration hoặc main, rồi cho phép chuẩn bị các worktree/head theo owner. Sau đó mỗi PR phải có diff thật đúngbase, CI phù hợp, reviewer và dependency rõ. Không chạy lại Q01–Q06 đã COMPLETED để kiểm tra PR; dùng evidence cũ đúng phạm vi và chỉ chạy kiểm tra không phá hủy dữ liệu cần thiết.
