# Báo cáo sửa upload Plane — 31/10/2026

Phạm vi: ảnh trong mô tả/bình luận/pages, attachment, avatar, ảnh bìa và logo workspace. Baseline kiểm tra: `1d81b4f`, nhánh `29/10`. Đây là kiểm chứng cục bộ; không phải nghiệm thu toàn bộ Plane hoặc đồng bộ mạng thật.

## Nguyên nhân đã xác nhận

Upload đã lưu byte vào IndexedDB nhưng editor chỉ lưu asset ID, rồi dựng URL API để gán cho thẻ ảnh. Request của thẻ ảnh không đi qua interceptor Axios nên lọt ra Vite proxy đến cổng 8080, nơi không có backend nhận request. Vì vậy việc upload trả thành công không chứng minh ảnh đã hiển thị.

Ngoài ra, khi khôi phục snapshot, bộ gộp giữ collection `issue_comments` cũ nhưng bỏ sót `comments` mà API bình luận đang ghi, cùng metadata `assets`. Bình luận chứa ảnh có thể mất sau refresh dù byte vẫn nằm trong IndexedDB.

## Thay đổi

- [Bộ đọc asset](/C:/task-system/plane/packages/services/src/file/asset-source.ts) nhận asset ID, đường API cũ hoặc nguồn ảnh trực tiếp. Đọc byte trong IndexedDB trước, rồi metadata nội dung đã có trong snapshot; trả nguồn ảnh thực tế cho editor, không gán API metadata làm nguồn ảnh.
- [Upload dùng chung](/C:/task-system/plane/packages/services/src/file/file-upload.service.ts) phục vụ editor và attachment. Chỉ hoàn tất sau giao dịch lưu IndexedDB, báo lỗi quota/abort/khóa kho tệp và hỗ trợ hủy upload. Session cache cũ chỉ dùng để đọc phục hồi, không dùng để tuyên bố lưu bền vững thành công.
- [Dịch vụ web](/C:/task-system/plane/apps/web/core/services/file.service.ts) thống nhất upload avatar, cover và logo; bỏ URL giả và nhánh nuốt lỗi. Xác nhận metadata chỉ sau khi nội dung đã lưu. Ảnh bìa người dùng không còn bị ghi vào avatar.
- [Router asset](/C:/task-system/plane/packages/services/src/dapp/file-assets.ts) tách khỏi router lớn: từ chối xác nhận khi thiếu nội dung; check/restore không tạo asset rỗng; sao chép file sang đúng ID mới; lỗi xóa byte không được báo thành công.
- [Store editor](/C:/task-system/plane/apps/web/core/store/editor/asset.store.ts) dùng chung lượt upload đang chạy cho callback trùng của cùng block, giữ file độc lập giữa các block và nối thao tác hủy vào đúng service đang upload.
- [Bộ gộp snapshot](/C:/task-system/plane/packages/services/src/dapp/chain.ts) giữ cả comments và metadata asset, ưu tiên bản cập nhật mới hơn; ghi nhận và tôn trọng các ID đã xóa để snapshot cũ không làm sống lại file/bình luận đã xóa.
- [Tải file](/C:/task-system/plane/apps/web/helpers/download-asset.ts), danh sách attachment, tab asset của pages và chuyển ảnh khi xuất nội dung đều đọc nội dung qua cùng resolver. Nút tải ảnh editor dùng liên kết download phù hợp nguồn data/blob.

## Kiểm chứng

Chứng cứ cuối được ghi tại [validation.json](/C:/task-system/plane/docs/verification/uploads-2026-10-31/validation.json), gồm 13 kiểm tra pass, log và hash nguồn. Build chuẩn dùng env gốc được ghi riêng là bị chặn, không tính là pass.

- Bộ hồi quy DApp: **225 ca pass**, gồm **22 ca upload**, kiểm tra qua FileService và MobX store thực tế; 3 ca mới kiểm tra mất comments/assets và khôi phục bản ghi đã xóa từ snapshot cũ.
- Kiểm tra kiểu services, utils, editor và web pass. Build services, utils và editor pass. Không đổi dependency, lockfile hoặc SDK.
- Chrome: **5 tình huống pass**, dùng file picker, IndexedDB, giải mã PNG và tải file thật; đối chiếu riêng ID ảnh mô tả và bình luận sau autosave/refresh. File tải xuống đúng 49 byte gốc; không có lỗi JavaScript chưa xử lý hoặc request asset lọt ra proxy. RPC/SDK được giả lập, mọi request ra dịch vụ thật bị chặn. Không gửi giao dịch/email thật. [Ảnh kiểm chứng sau refresh](/C:/task-system/plane/docs/verification/uploads-2026-10-31/images-after-reload.png).
- Lint phạm vi kiểm tra không có lỗi; còn 3 cảnh báo có sẵn trong fullscreen editor về reverse mảng và accessibility. Các script kiểm chứng riêng không có cảnh báo.

Build chuẩn ở workspace bị chặn vì các tệp env đang có signing/API secrets; lần bật cờ bỏ kiểm tra bị hệ thống phê duyệt tự động từ chối. Đã giữ nguyên env gốc, tạo bản sao nguồn để build với env loại khóa, chạy nguyên cổng chặn bí mật và quét đầu ra. [safe-build.json](/C:/task-system/plane/docs/verification/uploads-2026-10-31/safe-build.json) ghi 685 tệp được quét, không khớp các giá trị khóa đã nhận diện từ env nguồn. Đây là build kiểm chứng riêng; không phải phát hành bundle production hoặc thay cấu hình đang chạy. Bản này không build/copy ứng dụng Space. Còn các cảnh báo PostCSS/chunk/import có sẵn trong quá trình build.

## File Processor và giới hạn

Đã đọc SDK ở chế độ chỉ đọc. [File Processor](/C:/metanode-sdk/frames/file-processor/src/main.ts) đăng ký ping, lấy domain và quản lý runtime/bundle. Có tên action upload trong constants nhưng chưa thấy handler attachment tương ứng được đăng ký. Vì vậy bản sửa giữ kiến trúc lưu file local đang dùng, không gọi một API upload chưa được triển khai và không sửa SDK.

Attachment gốc vẫn lưu trên thiết bị theo kiến trúc đã có; metadata trên chain không thay thế byte file. Ảnh có nội dung trong snapshot có thể phục hồi qua metadata, nhưng bản sửa này không triển khai kho file chia sẻ mới hoặc chứng minh tải attachment trên thiết bị khác. File cũ chỉ còn ID mà không có byte trên thiết bị/snapshot thì cần tải lại file gốc.

## Cách test lại

1. Mở work item, chèn ảnh vào mô tả và đợi trạng thái đã lưu. Thêm bình luận có ảnh rồi gửi.
2. Đính kèm file, kiểm tra tên và số lượng. Tải lại toàn bộ trang; ảnh và bình luận phải còn.
3. Tải attachment xuống và so sánh với file gốc. Network không được phát sinh request ảnh asset tới backend 8080.
4. Thử avatar, ảnh bìa người dùng, ảnh bìa project và logo workspace; đổi cover không được thay avatar.
5. Hủy upload hoặc mô phỏng lỗi lưu trữ: phải báo thất bại, không tạo URL/thành công giả. Hai callback đồng thời cho cùng block chỉ được tạo một lượt upload.

Chạy lại kiểm chứng từ thư mục Plane:

```powershell
node --import ./tests/dapp/register.mjs --test tests/dapp/*.test.mjs
node tests/browser/build-upload-fixture.mjs
```

Sau khi build fixture, chạy [kiểm thử Chrome](/C:/task-system/plane/tests/browser/uploads.mjs) với biến tiến trình `UPLOAD_TEST_BUILD_DIR` trỏ tới `buildDirectory` trong safe-build.json. Đây không phải chỉnh tệp env gốc.

Không commit/push, deploy/migration hoặc đổi hạ tầng. Đã dọn 1 bản sao build, 12 profile Chrome và 21 tệp tạm; gỡ các junction trước khi xóa bản sao, giữ nguyên thư mục dependency gốc. Toàn bộ bằng chứng trong docs/verification được giữ lại theo kết quả phê duyệt tự động, cùng mã nguồn và bộ test tái sử dụng. Chi tiết: [cleanup.json](/C:/task-system/plane/docs/verification/uploads-2026-10-31/cleanup.json).
