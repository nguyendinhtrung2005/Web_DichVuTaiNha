# Chứng minh chuẩn hóa định dạng patch tài liệu Backend

Ngày kiểm tra: 25/10/2026, giờ Việt Nam. Chỉ đổi artifact `proposals/backend-docs-update.patch` và tài liệu hướng dẫn; **không sửa lại sáu tài liệu Backend, source, database hoặc Git index** trong thao tác này. Root thực hiện kiểm tra staged cuối riêng.

67 cảnh báo trước đây xuất phát từ dòng context trống của unified diff: mỗi dòng cần một ký tự space ở đầu. Không xóa space tùy tiện vì có thể làm hỏng patch, không thêm `.gitattributes` hoặc nới quy tắc whitespace để che cảnh báo. Đã tái biểu diễn cùng thay đổi thành **zero-context unified diff** và kiểm chứng hiệu ứng bằng nội dung Git chuẩn hóa LF.

| Thuộc tính | Bản có context trước | Bản zero-context hiện tại |
| --- | ---: | ---: |
| File đích | 6 | 6 |
| Hunk | 21 | 28 |
| Dòng thêm / bỏ | 75 / 26 | 74 / 25 |
| Dòng context bắt đầu space | Có, gồm 67 context trống | 0 |
| Dòng trailing whitespace trong artifact | 67 | 0 |

Một cặp thêm/bỏ cùng dòng trống được biểu diễn tối giản hơn. So sánh multiset các dòng thay đổi giữa hai bản chỉ khác đúng một dòng trống ở phía thêm và một ở phía bỏ; không khác bất kỳ dòng văn bản nào. Hunk nhiều hơn vì các đoạn thay đổi được tách khỏi context.

## Chứng minh kết quả

Đã dùng sáu preimage trước khi áp dụng patch, được sao lưu ở `%TEMP%/cleanhome-staging-20261025/before-docs`, và sáu postimage từ index của lượt bàn giao. Trên thư mục scratch riêng, ngoài working tree:

- PASS: patch gốc áp dụng từ preimage cho kết quả đúng cả sáu postimage Git.
- PASS: patch mới với `--unidiff-zero --check`, rồi áp dụng trong scratch, cho kết quả **6/6 byte-identical** với postimage Git.
- PASS: reverse-check và reverse trong scratch có `--unidiff-zero` khôi phục **6/6 byte-identical** preimage Git.
- PASS: không có trailing whitespace trong artifact mới; không dùng rule exception hoặc tắt check. Kết quả raw `git diff --cached --check` cuối do root kiểm tra sau re-stage.
- PASS: SHA-256 nội dung working tree của cả sáu tài liệu Backend trước/sau đổi artifact giữ nguyên.

Git trên máy dùng chuyển đổi CRLF/LF; preimage backup là LF, còn working copy có thể CRLF. Scratch dùng `core.autocrlf=false` riêng từng lệnh để so sánh **đúng byte của nội dung Git LF**, không tắt kiểm tra whitespace. Chuyển đổi này không chỉnh config repository hoặc file thật. Lượt thăm dò ban đầu dùng EOL mặc định cho kết quả reverse khác CRLF; không lấy lượt đó làm bằng chứng byte-exact. Chứng minh cuối ở trên giữ cùng LF cả hai chiều.

Plain `git apply --check` không có flag bị từ chối ở scratch đúng như dự kiến với zero-context. Vì vậy mọi kiểm tra/applied ở nơi khác **bắt buộc thêm `--unidiff-zero` và guard đủ sáu image**; không coi việc bỏ context là lý do được áp dụng lên file bất kỳ.

## Hash artifact và image

- Artifact hiện tại: SHA-256 của UTF-8 LF `41bcc0cdd26856f9f1d89d2d665eaf5f67f880410ff9310dc6e86d976ef98625`.
- Git blob artifact hiện tại sau text filters: `7fb28561cb170afddbe6fb5d780a0e834f9c8b5a`.
- Bản artifact gốc giữ nguyên byte tại `%TEMP%/cleanhome-whitespace-20261025/backend-docs-update.original-context.patch`; SHA-256 bản raw đó là `cfa8eefabf9debc7f11bd7eed4410357bcbc04a7fbb4333cd5a31cd5c03457d5`. Không đưa bản context có warning trở lại staging hoặc xóa bản lưu.

Guard dùng Git blob để không nhầm CRLF của working copy với thay đổi nội dung. Hash dưới đây là preimage/postimage Git, không phải token hoặc chữ ký owner.

| File | Preimage Git blob | Postimage Git blob |
| --- | --- | --- |
| `backend/auth-service/README.md` | `5d441834d7fb17c34bd3cfa171132d582c209c46` | `87c4d9dd41aa4872d9a7f27891ee44e600006f40` |
| `backend/auth-service/docs/staff-integration.md` | `4efa9ea05d6fb7234a201fbbfb819a9c50ef8fcb` | `7dea2f2d8229d7e17cebceac73da8bed23f180f8` |
| `backend/staff-service/README.md` | `68b3f40b913e2392bcc00d9bb7237f9cf9bf3a7f` | `c6af95e1c1435616a475bbd313a4447afd843438` |
| `backend/staff-service/docs/order-handoff-checklist.md` | `42e55506f317d30dbf0d239e30b81442ac9557c5` | `e477936162d8792cab138cf2c7c073dc1b796581` |
| `backend/staff-service/docs/order-service-contract.md` | `cdae9ba901cdc10fd40c41f4cc476dae50f711bf` | `a64e9e9e90d49ae60124861c96b1dc87e1051ccf` |
| `backend/order-service/README.md` | `9ed0cea38743fd73b49c42e0cbf29150300346ed` | `3a5011510831d906803c3e16d0da937eccfce431` |

## Kiểm tra hiện trạng hoặc dùng lại ở môi trường khác

Sáu tài liệu thật hiện đã là postimage, **không áp dụng thuận hoặc đảo patch thật**. Tại repo root, guard đọc sau đây phải đạt trước reverse-check chỉ đọc:

```powershell
$docPatch = 'frontend/docs/UC9_UC12_HANDOFF/proposals/backend-docs-update.patch'
$docImages = @(
  @{ path='backend/auth-service/README.md'; before='5d441834d7fb17c34bd3cfa171132d582c209c46'; after='87c4d9dd41aa4872d9a7f27891ee44e600006f40' },
  @{ path='backend/auth-service/docs/staff-integration.md'; before='4efa9ea05d6fb7234a201fbbfb819a9c50ef8fcb'; after='7dea2f2d8229d7e17cebceac73da8bed23f180f8' },
  @{ path='backend/staff-service/README.md'; before='68b3f40b913e2392bcc00d9bb7237f9cf9bf3a7f'; after='c6af95e1c1435616a475bbd313a4447afd843438' },
  @{ path='backend/staff-service/docs/order-handoff-checklist.md'; before='42e55506f317d30dbf0d239e30b81442ac9557c5'; after='e477936162d8792cab138cf2c7c073dc1b796581' },
  @{ path='backend/staff-service/docs/order-service-contract.md'; before='cdae9ba901cdc10fd40c41f4cc476dae50f711bf'; after='a64e9e9e90d49ae60124861c96b1dc87e1051ccf' },
  @{ path='backend/order-service/README.md'; before='9ed0cea38743fd73b49c42e0cbf29150300346ed'; after='3a5011510831d906803c3e16d0da937eccfce431' }
)
function Assert-ReviewedDocImage([string]$image) {
  if ($image -notin @('before','after')) { throw 'Image không hợp lệ.' }
  foreach ($entry in $docImages) {
    $docPath = [string]$entry.path
    $actual = git hash-object --path="$docPath" -- "$docPath"
    if ($LASTEXITCODE -ne 0 -or $actual -cne $entry[$image]) { throw "Image đã thay đổi: $docPath; dừng để review, không ép apply." }
  }
}
$patchBlob = git hash-object --path="$docPatch" -- "$docPatch"
if ($LASTEXITCODE -ne 0 -or $patchBlob -cne '7fb28561cb170afddbe6fb5d780a0e834f9c8b5a') { throw 'Artifact đã thay đổi; cần kiểm tra lại.' }
Assert-ReviewedDocImage 'after'
git apply --unidiff-zero --reverse --check -- "$docPatch"
if ($LASTEXITCODE -ne 0) { throw 'Reverse-check không đạt; không đảo hoặc sửa file.' }
```

Nếu dùng artifact ở bản sao khác trước khi cập nhật tài liệu, chỉ khi được owner cho phép: kiểm tra hash artifact, gọi guard `before`, chạy `git apply --unidiff-zero --check`, rồi mới áp dụng thuận và gọi guard `after`. Không apply nếu bất kỳ file nào khác preimage, không dùng `--3way`, `--reject`, force hoặc bỏ guard. Không dùng quy trình này để đảo tài liệu thật đã cập nhật. Cùng một patch phải ràng buộc cả preimage lẫn postimage, không chỉ trông vào vị trí dòng của zero-context.

Proof scratch: `%TEMP%/cleanhome-whitespace-20261025/patch-zero-context-proof.json` và `patch-representation-equivalence.json`. Các file này chỉ chứa hash/nội dung tài liệu để kiểm tra, không truy cập MySQL hoặc QA Q01–Q06; không được thêm scratch/log vào Git. Không stage, commit, push, đổi branch hoặc lịch sử trong thao tác chuẩn hóa này.
