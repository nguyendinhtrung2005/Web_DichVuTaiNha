# Chứng minh sửa whitespace SQL không đổi schema

Ngày kiểm tra: **25/10/2026**, giờ Việt Nam. Phạm vi chỉ hai SQL nguồn đã được nhóm đồng ý bàn giao. Người dùng cho phép sửa định dạng thuần túy; không chạy MySQL, schema/seed, migration, transaction hoặc bài QA ghi dữ liệu.

| File | Khoảng trắng trên dòng trống đã bỏ | Dòng trống thừa cuối file | CREATE TABLE trước/sau | Dòng khai báo khóa trước/sau |
| --- | ---: | ---: | ---: | ---: |
| `databases/schema.sql` | 35 | 1 | 32 / 32 | 124 / 124 |
| `databases/schema_staff_test.sql` | 35 | 1 | 32 / 32 | 124 / 124 |

Tổng **72 cảnh báo** ở hai file được xử lý: 70 cảnh báo trailing whitespace và hai blank-at-EOF. Không xóa dòng trống giữa các câu lệnh, chỉ bỏ space/tab trên đúng các dòng trống bị cảnh báo; cuối mỗi file giữ một newline.

## Kiểm chứng trước khi ghi

- Working content khớp bản trong index khi xét chuẩn hóa CRLF/LF; không có thay đổi riêng của thành viên khác cần ghép vào hai SQL.
- Nội dung gốc khớp byte với bản chụp trước nhiệm vụ trong `%TEMP%/cleanhome-whitespace-20261025/before-files/`.
- Chỉ các dòng trống được `git diff --cached --check` nêu ra mới được xử lý; không dùng formatter toàn file.
- Bộ quét trạng thái SQL xác nhận các dòng đích nằm ngoài chuỗi single/double quote, identifier backtick và block comment; cuối file không nằm trong literal/comment chưa đóng. Không trim nội dung string hoặc SQL comment.

## Bằng chứng sau khi ghi

- **PASS:** tất cả dòng có ký tự ngoài whitespace giữ nguyên byte, đúng thứ tự. Không đổi tên database/USE, bảng, cột, kiểu dữ liệu, giá trị mặc định, COMMENT, khóa, ràng buộc, thứ tự câu lệnh hoặc SET FOREIGN_KEY_CHECKS đã có.
- **PASS:** chuỗi byte sau khi bỏ whitespace trước/sau giống nhau; kết hợp với kiểm tra vùng literal và dòng có nội dung ở trên để không bỏ sót thay đổi whitespace bên trong giá trị SQL.
- **PASS:** giữ đúng 32 CREATE TABLE và đúng danh sách bảng theo thứ tự; 124 dòng chứa khai báo khóa/ràng buộc trong từng file giữ nguyên nội dung và thứ tự.
- **PASS:** encoding UTF-8, không BOM và newline LF ban đầu được giữ nguyên. Chỉ bỏ một dòng trống thừa ở EOF mỗi file, vẫn giữ newline cuối.
- **NOT_RUN:** mọi thực thi MySQL/seed/migration hoặc Q01–Q06; không cần chạy database để chứng minh thay đổi thuần định dạng này.

| File | SHA-256 trước sửa | SHA-256 sau sửa |
| --- | --- | --- |
| `databases/schema.sql` | `259d57a61531367d52b7a8dc9bf705a6d6a4168f2b4cc22ab50f498b90a179e2` | `a61ec0da44bcafbbe6ca3ca53ec31e1620f5d3145bed259ffa578dbbb12adcda` |
| `databases/schema_staff_test.sql` | `d662c4161b4ef14c4b76c88e9852f300e43c7f45a6529676c61b9dbc6f128615` | `b6bec82217a3e36e35458f9aa06d32fa22bfefe5aa02f93e11b9f3d07723ae9b` |

Script kiểm chứng và JSON chi tiết chỉ ở `%TEMP%/cleanhome-whitespace-20261025/sql-format-proof.{cjs,json}`, không chứa credential, không được đưa vào source thay thế. Không sửa seed SQL, source Backend/Frontend, dữ liệu QA hoặc index trong phần công việc này. Người tích hợp cập nhật hash của hai file trong inventory/phạm vi đã duyệt trước khi stage lại đúng file.
