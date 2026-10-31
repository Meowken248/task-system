# Kết quả sửa và kiểm thử Plane — 31/10/2026

Nhánh thực tế: `Fix_bug_ver1.0`, bắt đầu từ `433edba`. Mỗi phần chức năng được
commit sau kiểm thử. Phạm vi là các lỗi đã xác nhận trong adapter local,
upload, link issue, OTP và Analytics; không phải chứng nhận toàn bộ Plane hết lỗi.

## Thay đổi và commit

| Commit | Kết quả |
| --- | --- |
| `4e9cef7` | Chặn xóa workspace/project trước mọi cascade và tombstone nếu chưa đăng nhập, sai quyền, ví đổi hoặc không kiểm tra được quyền. |
| `f7c6ce6` | Asset có phạm vi và người tạo; kiểm tra quyền cả API và dịch vụ attachment ghi trực tiếp vào IndexedDB. Bulk kiểm tra toàn bộ quyền trước khi xác nhận. |
| `1dc7b88` | Bổ sung metadata cho link issue UUID; không redirect sang mã giả khi thiếu sequence/identifier. |
| `804177c` | API và giao diện chờ kết quả gửi OTP; lỗi gửi trả thất bại, không thay mã cũ; gộp gửi đồng thời trong cùng runtime, phát hiện lỗi lưu OTP. |
| `fd12a56` | Analytics đếm tập thành viên chuẩn, không đếm tất cả hồ sơ local hoặc lời mời pending. |
| `88df5c7` | Chuẩn hóa URL tuyệt đối, basename, dấu `/` dư và method trước khi kiểm tra quyền. |
| `6792353` | Khóa alias CRUD đi vòng các handler chuyên biệt; attachment phải thuộc đúng issue. Xóa bytes thành công trước metadata, ghi tombstone và cập nhật số tệp. |
| `18b7568` | Giữ thứ tự ưu tiên Workspace Admin, Project Admin/creator và Guest; quyền project không được nâng thành quyền workspace. |

Mã chính có thể xem tại [router](/C:/task-system/plane/packages/services/src/dapp/routes.ts),
[kiểm tra quyền](/C:/task-system/plane/packages/services/src/dapp/resource-access.ts),
[asset handler](/C:/task-system/plane/packages/services/src/dapp/file-assets.ts),
[gửi OTP](/C:/task-system/plane/packages/services/src/dapp/otp-delivery.ts),
[form đăng nhập](/C:/task-system/plane/apps/web/core/components/account/auth-forms/form-root.tsx)
và [dịch vụ attachment](/C:/task-system/plane/apps/web/core/services/issue/issue_attachment.service.ts).

## Bằng chứng kiểm thử

| Kiểm tra | Kết quả | Phạm vi thực tế |
| --- | --- | --- |
| Native DApp regression | 279/279 đạt, không skip | 54 ca tăng thêm so với 225 ca đầu đợt; dữ liệu/SDK/network được cô lập hoặc mô phỏng. |
| Quyền, metadata, URL và CRUD | 36 ca đạt | Có cả yêu cầu hợp lệ và bị từ chối; so sánh dữ liệu/tombstone sau từ chối. |
| Upload và attachment | 27 ca đạt | Dịch vụ web thật với IndexedDB giả lập, gồm lỗi quota, hủy, sao chép, xóa sai issue và lỗi xóa bytes. |
| OTP | 9 ca đạt | Thiếu cấu hình, HTTP lỗi, abort, hash, gộp gửi, hai email đồng thời, retry và storage lỗi. |
| Analytics mới | 4 ca đạt | Owner, alias/trùng, pending/removed/inactive và workspace không tồn tại. |
| TypeScript services/web | Đạt | `tsc --noEmit --composite false --incremental false` cho cả hai package. |
| Services build | Đạt | Build package thực tế bằng script đang có. |
| Web build cô lập | Đạt | Script build web hiện hữu trên bản sao; không đổi env thật, không tắt guard; 685 tệp bundle được quét, 0 giá trị bí mật nguồn trùng khớp. Không phải build toàn bộ monorepo/Space. |
| Browser link/upload/OTP | 9/9 đạt | Chrome, bundle đã build, IndexedDB/input file/giải mã ảnh/tải tệp thật; SDK, RPC, IPFS và mail provider mô phỏng. |
| Browser Admin–Member | 8/8 đạt | Hai context không dùng chung storage; cấp quyền, discovery, refresh, lỗi RPC/retry, thu hồi quyền với cache cũ. Một giao dịch giả lập, không giao dịch thật. |
| RPC thực chỉ đọc | Đạt | Chain ID 991, registry có bytecode, workspace policy v2. |
| Guard env production thực | Exit 1, đang chặn | Do hai biến ký/gửi mail hiện hữu; không bật cờ bỏ qua, không ghi giá trị bí mật vào bằng chứng. |

Hai nhóm browser có tổng cộng 17 ca, không có uncaught JavaScript exception.
Nhóm upload không có request asset thoát ra backend proxy. Ảnh description và
comment giữ đúng block ID qua reload; nội dung attachment tải xuống khớp byte gốc.
OTP được thử cả lúc đang chờ, nhà cung cấp từ chối và thử lại thành công.

Kiểm thử biên đã bắt được lỗi mà vòng happy path chưa phát hiện: URL/CRUD phụ
và thứ tự ưu tiên quyền trong bản sửa. Log trước/sau được giữ để đối chiếu;
kết quả cuối dùng mã đã hiệu chỉnh. Lint 13 module/test trọng tâm đạt; không
khẳng định lint toàn monorepo đã đạt. Build vẫn có cảnh báo module/sourcemap.

Bằng chứng chi tiết và hash nguồn nằm trong
[validation](/C:/task-system/plane/docs/verification/stability-2026-10-31/validation.json),
[browser upload/OTP](/C:/task-system/plane/docs/verification/stability-2026-10-31/upload/browser-validation.json),
[browser member](/C:/task-system/plane/docs/verification/stability-2026-10-31/member/browser-validation.json)
và [RPC chỉ đọc](/C:/task-system/plane/docs/verification/stability-2026-10-31/rpc-readonly.json).

## Giới hạn và việc cần nghiệm thu thực tế

- **Chưa kiểm thử giao dịch ký thật, gửi mail thật hoặc pin snapshot thật trong
  đợt sửa này.** HTTP/RPC đọc và fixture không chứng minh các bước đó đã đạt.
  Cần nghiệm thu bằng hai ví/ngữ cảnh người dùng thật cho chu trình sync,
  nhận dữ liệu, sửa task/comment, reload và revoke.
- Registry thực vẫn là v2. Self-leave cần phiên bản hỗ trợ; đợt này không
  thay contract, deploy hay migrate dữ liệu.
- Build production trực tiếp với env hiện hữu đang bị guard chặn. Build bản sao
  an toàn đạt không có nghĩa môi trường phát hành hiện tại đã sẵn sàng.
- Attachment bytes vẫn local; chưa có kho chia sẻ tệp giữa các máy. Ảnh editor
  có thể phục hồi từ nội dung đã nhúng vào snapshot, không tương đương một dịch
  vụ lưu mọi tệp upload dùng chung.
- Kiểm soát quyền ở adapter giúp tránh thao tác sai luồng và sai phạm vi. Nó
  không mã hóa dữ liệu đã cache và không ngăn chủ thiết bị tự sửa localStorage.
  OTP local không phải bằng chứng xác minh email độc lập trên chain.
- Không kiểm chứng tranh chấp nonce giữa nhiều tab/ví thật; không suy ra các
  lỗi contract/task hoặc Pinata trước đây đã được giải quyết bởi đợt sửa này.
- Metadata asset cũ chỉ được truy cập qua API nếu suy ra được phạm vi; bản ghi
  mơ hồ bị từ chối. Không tự gán chúng cho workspace trong đường dẫn người gọi.
- Xóa workspace/project yêu cầu Workspace Admin/owner hoặc quyền quản trị chain
  tương ứng. Project Admin được quản lý tài nguyên project, không tự có quyền
  xóa workspace hoặc quản trị workspace.

Không đổi SDK, dependency, lockfile, env thật hoặc hạ tầng; không push.
Thư mục build/profile/download tạm của đợt này được dọn sau xác minh;
đã dọn 4 bản build, 7 profile Chrome và 20 log tạm; giữ 11 log kiểm chứng,
bằng chứng browser và các báo cáo cũ.

## Chạy lại trên cấu hình hiện tại

Chạy services build trước regression vì test dịch vụ web dùng bundle services:

```powershell
pnpm.cmd --filter @plane/services build
node --import ./tests/dapp/register.mjs --test tests/dapp/*.test.mjs
pnpm.cmd --filter @plane/services exec tsc --noEmit --composite false --incremental false
pnpm.cmd --filter web exec tsc --noEmit --composite false --incremental false
```

Build và chạy browser với bản sao env an toàn, không bật cờ bỏ qua guard:

```powershell
$env:PLANE_TEST_OUTPUT_DIR='docs/verification/stability-2026-10-31/build'
node tests/browser/build-upload-fixture.mjs
$buildProof=Get-Content docs/verification/stability-2026-10-31/build/safe-build.json -Raw | ConvertFrom-Json
$env:PLANE_TEST_BUILD_DIR=$buildProof.buildDirectory
$env:PLANE_TEST_OUTPUT_DIR='docs/verification/stability-2026-10-31/upload'
node --import ./tests/dapp/register.mjs tests/browser/uploads.mjs
$env:PLANE_TEST_OUTPUT_DIR='docs/verification/stability-2026-10-31/member'
node --import ./tests/dapp/register.mjs tests/browser/wallet-members.mjs
```

Hai script browser cô lập profile và chặn request ra dịch vụ thật. Chạy lại sẽ
tạo build/profile tạm mới; các thư mục của lần nghiệm thu này đã được dọn.
