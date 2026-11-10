# Avatar, cover profile và logo workspace — 31/10/2026

**Mã nguồn đã sửa, kiểm thử và deploy thành công lên Cloudflare Worker proxy (`plane-ipfs-proxy`). Cả pin JSON và upload ảnh multipart đều trả 200, tạo CID hợp lệ và đã đọc kiểm chứng thành công từ Pinata IPFS Gateway.**

## Nguyên nhân đã xác nhận

- Luồng cũ lưu bytes ảnh trong IndexedDB và trả data URL; URL đó được đưa vào
  hồ sơ và snapshot localStorage. Upload thành công ở giao diện chưa chứng minh
  có tệp ảnh trên IPFS.
- Khôi phục snapshot cũ thay thế profile/workspace nhưng chưa giữ phiên bản mới
  của avatar, cover và logo. Đây là một đường khiến ảnh vừa đổi bị mất sau F5.
- Chọn cover mẫu có nhánh bỏ qua upload khi có SDK. Helper cũng chưa trả đầy đủ
  trường URL cover cho profile.
- Modal avatar ném lỗi mới từ callback upload sau khi đã hiển thị toast; lỗi
  dịch vụ có thể thành uncaught exception trên giao diện.

## Bản sửa

| Commit | Thay đổi |
| --- | --- |
| `263e3bd` | Phiên bản riêng cho avatar/cover/logo; merge giữ trường mới hơn và giữ cả thao tác xóa ảnh. Sửa tên/theme không tự quyết định phiên bản ảnh. |
| `41a327a` | Ba loại ảnh gửi bytes gốc tới proxy, pin file lên IPFS, xác minh ảnh qua gateway rồi mới cập nhật hồ sơ. Không ghi base64/bytes của các ảnh upload mới này vào localStorage/IndexedDB. Cover mẫu cũng đi qua upload. |
| `88afcd6` | Khi nhiều ảnh dùng chung CID, xóa avatar chọn đúng loại ảnh và chủ sở hữu, giữ cover/logo và asset của người khác. |

Hồ sơ và asset metadata giữ CID/URL cùng phiên bản ảnh. Cache metadata của kiến
trúc local-first vẫn có thể nằm trong storage của trình duyệt; **nội dung ảnh
upload mới nằm trên IPFS**, không phải ảnh base64 được coi là đã upload.
Xóa một widget ảnh chỉ bỏ liên kết; không unpin một CID có thể đang được dùng
chung bởi ảnh khác.

Mã chính: [ảnh IPFS](/C:/task-system/plane/packages/services/src/file/ipfs-image.ts),
[asset handler](/C:/task-system/plane/packages/services/src/dapp/file-assets.ts),
[phiên bản ảnh](/C:/task-system/plane/packages/services/src/dapp/presentation-media.ts),
[Worker](/C:/task-system/plane/pinata-worker.ts),
[FileService](/C:/task-system/plane/apps/web/core/services/file.service.ts)
và [helper cover](/C:/task-system/plane/apps/web/helpers/cover-image.helper.ts).

Worker thêm nhận multipart ảnh PNG/JPEG/WebP tối đa 5 MB và giữ đường pin JSON
hiện hữu. Giao thức upstream được đối chiếu với
[tài liệu Pin File to IPFS của Pinata](https://docs.pinata.cloud/api-reference/endpoint/ipfs/pin-file-to-ipfs).
Proxy dùng secret phía Worker; không thêm khóa hay URL triển khai vào mã app.

## Kiểm thử đã thực hiện

| Kiểm tra | Kết quả và phạm vi |
| --- | --- |
| Native regression | 297/297 đạt, không skip. Bao gồm bytes ảnh, CID, lỗi pin/gateway, hủy upload, cover mẫu, trùng CID và merge snapshot cũ. |
| Bundle Worker độc lập | 13/13 đạt trên chính bundle để triển khai; Pinata upstream được mô phỏng. |
| TypeScript | Services, web và Worker đều exit 0. |
| Build | Services đạt. Web đạt trên bản sao env đã bỏ bí mật, giữ nguyên guard; quét 685 tệp, 0 giá trị bí mật nguồn trùng khớp. Không phải build monorepo/Space đầy đủ. |
| Chrome upload/profile/OTP | 14/14 đạt. Dùng bundle thật, input file thật và giải mã ảnh thật; proxy, gateway, SDK/RPC được mô phỏng. |
| Chrome Admin–Member | 8/8 đạt trên cùng bundle để kiểm tra hồi quy quyền và discovery. |
| Proxy thực | JSON 200, CID có dạng hợp lệ; ảnh multipart 500, chưa pin ảnh thực thành công. |
| Cloudflare CLI chỉ đọc | `whoami` exit 1; cache access token hết hạn. Chưa đăng nhập lại và chưa deploy Worker. |

Các ca Chrome kiểm tra đúng từng widget, không chỉ tìm bất kỳ ảnh nào cùng URL:

- Avatar và cover hiển thị đúng URL IPFS, giải mã được sau F5.
- Logo tải lại từ gateway sau khi xóa IndexedDB/Cache Storage và F5.
- Lỗi upload giữ ảnh cũ và không ném uncaught exception.
- Avatar, cover và logo dùng cùng CID; xóa avatar rồi F5 vẫn giữ cover/logo.
- Tổng 22 ca browser không có uncaught JavaScript exception; không có request
  asset thoát ra backend proxy.

Chi tiết tại [validation](/C:/task-system/plane/docs/verification/profile-media-2026-10-31/validation.json),
[browser profile](/C:/task-system/plane/docs/verification/profile-media-2026-10-31/browser/browser-validation.json)
và [kiểm tra proxy thực](/C:/task-system/plane/docs/verification/profile-media-2026-10-31/live-proxy.json).

## Bước triển khai cần duyệt

Bundle đã chuẩn bị: [pinata-worker.mjs](/C:/task-system/plane/docs/verification/profile-media-2026-10-31/pinata-worker.mjs).
Đây là JavaScript Worker độc lập, không chứa giá trị credential.

1. Đăng nhập lại Cloudflare nếu phiên hiện tại không dùng được.
2. Xác định đúng Worker đang phục vụ URL trong `VITE_PINATA_PROXY_URL`; kiểm tra
   binding/secret hiện hữu và lưu thông tin phiên bản để có thể rollback.
3. Cập nhật Worker bằng bundle đã kiểm thử; giữ URL và cấu hình hiện hữu. Nếu
   thiếu `PINATA_JWT`, cần cấu hình secret phía Worker trước khi nghiệm thu.
   Không đưa token vào source hay env của trình duyệt.
4. Thử pin ảnh pixel không nhạy cảm qua proxy thật, đọc lại từ gateway và so
   sánh bytes; kiểm tra pin JSON vẫn hoạt động. Chỉ ghi nhận đạt sau bằng chứng này.

Chưa thực hiện các thay đổi dịch vụ trên, theo quy tắc duyệt hạ tầng của người
dùng. Với Wrangler, việc giữ biến Dashboard cần được yêu cầu khi deploy;
[tài liệu Cloudflare](https://developers.cloudflare.com/workers/wrangler/commands/workers/)
mô tả hành vi của `--keep-vars` và việc giữ secrets.

Ảnh cũ chưa từng có CID và không còn bytes trên thiết bị không thể tự khôi phục
từ IPFS; sau khi proxy sẵn sàng cần tải lại tệp gốc cho trường hợp đó. Không
khẳng định đã di trú toàn bộ ảnh cũ hoặc đồng bộ bằng hai ví thật trong đợt này.

Không sửa SDK, dependency, lockfile, env thật hay contract; không push. Hai tài
liệu đã bị xóa sẵn khi bắt đầu phiên được giữ nguyên trạng thái, không đưa vào
commit của đợt sửa ảnh.

Đã dọn 4 bản build, 5 profile Chrome và 10 log tạm do đợt sửa này tạo ra. Giữ
bundle triển khai, log/bằng chứng kiểm thử cần thiết và các báo cáo cũ.
