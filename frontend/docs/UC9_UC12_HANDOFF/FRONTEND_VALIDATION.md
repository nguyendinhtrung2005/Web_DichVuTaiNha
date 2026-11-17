# Kiểm tra Frontend trên nội dung chuẩn bị staging

**Bằng chứng của lượt staging trước sửa whitespace.** Lượt tiếp theo chỉ bỏ blank EOF và giữ AST nguyên vẹn; đã chạy lại55 Auth unit và Staff typecheck PASS. Build/toàn328unit dưới đây không được nhận là đã chạy lại sau formatting; xem [WHITESPACE_REVIEW.md](WHITESPACE_REVIEW.md). Các phiên bản source trước/sau chỉ khác định dạng có chứng minh, không sửa logic hoặc CSS.

Ngày chạy 25/10/2026, giờ Việt Nam. Không thay source, không nạp .env thật, không gọi MySQL/service thật hoặc workflow Q01–Q06. Kiểm tra trong bản sao cô lập chứa HEAD hiện tại, 186 file toàn bộ đã duyệt và đúng CSS Staff 57 dòng; Portal, Customer auth và 13 dòng CSS Admin ở working tree gốc không được chép đè vào bản sao.

| Kiểm tra | PASS | FAIL | SKIP | NOT_RUN |
| --- | ---: | ---: | ---: | --- |
| Frontend unit năm nhóm auth/jobs/detail/schedule/status | 308 | 0 | 0 | 0 |
| QA relay và backup unit | 20 | 0 | 0 | 0 |
| Lặp lại cùng 328 test trên bản sao nội dung đã chọn | 328 | 0 | 0 | 0 |
| Typecheck Staff | 1 lệnh | 0 | 0 | 0 |
| Typecheck Customer | 1 lệnh | 0 | 0 | 0 |
| Typecheck Admin | 1 lệnh | 0 | 0 | 0 |
| Build Staff trên bản sao cùng ổ đĩa | 1 lệnh | 0 | 0 | 0 |
| Lượt build thử TEMP C với node_modules ở E | 0 | 1 lỗi môi trường | 0 | Không phải lỗi source đã được tái hiện trong build cùng ổ |
| HTTP/JWT/MySQL/browser mới | 0 | 0 | 0 | Không chạy trong lượt staging |
| Q01–Q06 ghi thật | 0 | 0 | 0 | Không chạy lại fixture COMPLETED |

Không cộng lần chạy lại 328 vào số ca khác nhau. Backend 217 + Frontend 308 + QA tooling 32 (relay13, backup7, data12) = 557 unit khác nhau đạt; không phải 557 E2E.

## Lệnh và phạm vi

Unit dùng Node test runner với `--test-concurrency=1`, chỉ 19 file tường minh lấy từ scripts `test:auth`, `test:jobs`, `test:job-detail`, `test:schedule`, `test:status` và hai file `status-qa-relay.test.mjs`, `uc12-qa-backup.test.mjs`. Lượt bản sao dùng `--test-reporter=tap`. Không gọi scripts HTTP/browser/lifecycle hoặc auth:init.

Typecheck gọi TypeScript CLI đã cài với `--noEmit --incremental false --project <app>/tsconfig.json` cho từng app Staff/Customer/Admin. Build gọi Next CLI đã cài với `build --webpack` tại Staff app trong bản sao, `NEXT_TELEMETRY_DISABLED=1`. Không cài hoặc nâng dependency.

Lượt TEMP C ban đầu không resolve được đường dẫn client Next ở ổ E qua junction (`./E:/.../next/dist/client/...`). Lượt này kết thúc FAIL trước compile source. Đã giữ log lỗi và dựng bản sao riêng trên cùng ổ E; build sau compile và TypeScript đều đạt, xuất các route BFF dự kiến. Không sửa Next/node_modules, cấu hình hoặc source để né lỗi.

Khi đối chiếu blob trước checkpoint, phát hiện bản sao cùng ổ ban đầu vẫn chứa CSS baseline: Git apply từ thư mục con trong repo đã bỏ qua đường dẫn patch. Đã chép **đúng blob CSS từ index** vào bản sao private, chạy lại build Staff thành công và đối chiếu lại **186 file toàn bộ + CSS, 187/187 khớp blob index**. Build sơ bộ trước đối chiếu không được dùng thay bằng chứng cuối. Source TypeScript/test của bản sao không đổi; các unit/typecheck trên cùng source vẫn hợp lệ, còn stylesheet cuối được build lại theo index. Working tree gốc không bị sửa.

Bản sao cùng ổ nằm riêng dưới Staff `.auth-data/qa/staging-review-20261025`, được ignore toàn cây. Đây là mã nguồn và build artifact kiểm tra, không phải fixture MySQL hoặc session QA; không chép .env, secrets, session, manifest/backup UC12 gốc. Node_modules chỉ được tham chiếu bằng junction tới dependency có sẵn; không chép hoặc chỉnh dependency.

Log ở `%TEMP%/cleanhome-staging-20261025/`: `frontend-unit.tap`, `frontend-snapshot-unit.tap`, `staff-build.log` (lượt lỗi), `staff-build-same-volume.log` (sơ bộ), `staff-build-exact-index.log` (build cuối) và `typecheck-{staff,customer,admin}.log`. Không đưa log hoặc bản sao private vào Git. Không xóa hoặc đụng dữ liệu QA nghiệm thu cũ.

Kết quả này áp dụng cho tổ hợp đã chọn trên baseline afc5d78, không tự chứng minh từng PR owner độc lập trên main. Kiểm tra cuối đối chiếu blob index của 186 file và CSS với bản sao đã build ở STAGING_REVIEW.md. Bằng chứng HTTP 90 PASS +1 SKIP và 43 E2E cũ vẫn tách riêng; production/HTTPS/tải lớn/crash chưa kiểm chứng.
