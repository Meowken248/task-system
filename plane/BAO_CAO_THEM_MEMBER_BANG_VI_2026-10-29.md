# Báo cáo thêm thành viên trực tiếp bằng ví

Ngày kiểm tra: 29/10/2026. Nhánh kiểm tra: `29/10`, baseline `140d571`. Báo cáo này chỉ đánh giá luồng thêm trực tiếp bằng ví được chủ dự án chọn; không phải nghiệm thu toàn bộ Plane hoặc giao thức email v3.

## Luồng sử dụng hiện hành

1. Người nhận cung cấp **địa chỉ ví công khai**, không cung cấp khóa riêng.
2. Admin mở Settings → Members → **Thêm bằng ví**, nhập địa chỉ và chọn Member hoặc Admin.
3. Plane đối chiếu ví ký, quyền quản trị và quyền hiện tại của người nhận trên chain. Ví đã có quyền được trả về với quyền thực tế, không tự nâng quyền theo form.
4. Admin xác nhận giao dịch `addMember`. Chỉ khi đọc lại đúng quyền trên chain mới báo đã thêm.
5. Người nhận đăng nhập Plane, chọn đúng ví. Plane đọc danh sách workspace của ví và tải dữ liệu IPFS. Không có OTP, thao tác nhận lời mời, giao dịch tham gia hoặc bước Admin duyệt lại.
6. Khi trang đang mở và có mạng, danh sách được kiểm tra định kỳ 15 giây và khi quay lại trang. Thời gian thực tế còn phụ thuộc RPC và tải snapshot; đây không phải cam kết phản hồi trong đúng 15 giây.

Nếu chưa biết ví thì cần lấy địa chỉ ví trước. Luồng đơn giản này không còn đáp ứng việc chỉ nhập email để tự động cấp quyền. Lời mời email cũ được giữ để tương thích dữ liệu; không dùng chúng làm bằng chứng cấp quyền mới.

## Các thay đổi đã kiểm tra trong mã

- [Router](/C:/task-system/plane/packages/services/src/dapp/routes.ts), [dịch vụ member bằng ví](/C:/task-system/plane/packages/services/src/dapp/workspace-wallet-members.ts) và [adapter chain](/C:/task-system/plane/packages/services/src/dapp/chain.ts): cấp quyền bằng ví Admin thực sự, đọc hậu điều kiện, không tin email hoặc cờ Admin trong snapshot.
- [Tiến trình phục hồi](/C:/task-system/plane/packages/services/src/dapp/wallet-member-operation.ts): chống request trùng, lưu dấu giao dịch chưa rõ kết quả qua refresh và khóa giữa các tab khi trình duyệt hỗ trợ Web Locks. Mất phản hồi thì kiểm tra quyền; chỉ gửi lại khi người dùng xác nhận đã kiểm tra lịch sử ví. Không đủ chỗ lưu dấu thì dừng trước khi ký.
- [Form thêm ví](/C:/task-system/plane/apps/web/core/components/workspace/add-wallet-member-modal.tsx): giữ địa chỉ khi lỗi, kiểm tra định dạng và ví zero, chặn bấm/đóng lặp khi đang xử lý. Chỉ đóng sau xác nhận quyền; lỗi làm mới danh sách sau đó không biến giao dịch đã thành công thành thất bại.
- Settings, menu workspace và cả hai màn onboarding dùng chung luồng thêm bằng ví. Không yêu cầu thêm backend, database hoặc verifier.
- Member tự tìm workspace từ chain bằng ví đang chọn; khôi phục UUID và dự án từ snapshot. Trạng thái onboarding được cập nhật sau khi tìm thấy quyền. Workspace mẫu không còn khiến ví mới bị coi là member khi đã cấu hình registry.
- Lỗi đọc quyền RPC có trạng thái thử lại riêng. IPFS lỗi giữ quyền đã xác nhận và hiển thị thử tải dữ liệu lại, không yêu cầu cấp quyền hoặc ký tham gia lần nữa.
- Danh sách member dùng quyền chain đã đọc thay cho quyền Admin cũ trong cache. Tín hiệu cập nhật giữa các tab chỉ là yêu cầu đọc lại, không tự cấp quyền. Đọc/làm mới member không tự yêu cầu công bố thêm CID.
- Discovery giữ một request đang chạy khi RPC chậm, kể cả qua thời hạn cache; chuyển ví/reset local không tái dùng kết quả sai tài khoản.

## Bằng chứng kiểm chứng

Kiểm thử hợp đồng chạy Hardhat local. DApp và Chrome dùng ví, SDK, RPC và IPFS giả lập; không dùng khóa riêng thật và không gửi mail/giao dịch thật. File chứng cứ được tập hợp tại [validation.json](/C:/task-system/plane/docs/verification/wallet-members-2026-10-29/validation.json).

- Hardhat: **54 ca pass**, trong đó **4 ca mới** chạy trực tiếp bytecode v2 lấy từ baseline: Admin cấp quyền, Member không thể cấp/nâng quyền, cấp lặp không nhân đôi index, thu hồi loại khỏi discovery. 50 ca còn lại gồm bộ hồi quy và prototype v3 cũ, không được tính thành 54 ca mới của tính năng này.
- DApp: **206 ca pass**, trong đó **34 ca trực tiếp về luồng ví**. Tổng này bao gồm các kiểm thử attachment có sẵn trong workspace từ phần việc khác.
- Chrome: **8 tình huống pass**, hai browser context tách biệt, một giao dịch cấp quyền giả lập từ Admin, không có giao dịch từ Member và **0 lỗi JavaScript chưa xử lý**. Bao gồm nhập ví sai, cấp quyền, tự tìm workspace, tải lại trang, phân quyền giao diện, RPC gián đoạn/thử lại và quyền chain đã thu hồi.
- Typecheck root/contracts, services và web pass. Build types, utils, services và web pass; đây là các gói liên quan, **không phải build toàn bộ monorepo**. Build web dùng tùy chọn `ALLOW_PUBLIC_SIGNING_SECRETS=true` chỉ trong tiến trình theo lựa chọn môi trường phát triển đã có; không sửa `.env` và không coi bundle này là cấu hình production không chứa khóa công khai.
- Lint không có lỗi trong phạm vi kiểm tra. Còn 2 cảnh báo accessibility ở nút đăng xuất có sẵn trong workspace wrapper và 5 cảnh báo của phần attachment trong kiểm tra services; không đổi phần việc khác để che cảnh báo. Build còn cảnh báo module type PostCSS, sourcemap và kích thước chunk/import có sẵn.
- Chrome đã phát hiện Promise rejection khi listener refresh nền đọc quyền gặp lỗi. Đã sửa xử lý nhóm tác vụ bằng `Promise.allSettled` và chạy lại failpoint đạt 0 rejection; giữ [bằng chứng trước sửa](/C:/task-system/plane/docs/verification/wallet-members-2026-10-29/regression-unhandled-refresh-before-fix.json).

Chạy lại sau khi build các gói liên quan:

```powershell
pnpm.cmd exec hardhat test contracts/PlaneWorkspaceRegistry.test.ts contracts/PlaneWorkspaceRegistry.email.test.ts contracts/PlaneEmailVerification.test.ts contracts/PlaneWorkspaceRegistry.direct.test.ts
node --import ./tests/dapp/register.mjs --test tests/dapp/*.test.mjs
node --experimental-strip-types tests/browser/wallet-members.mjs
```

[Bộ kiểm thử Chrome](/C:/task-system/plane/tests/browser/wallet-members.mjs) phục vụ bản build web trên cổng loopback tạm, chặn request tới dịch vụ thật và dùng Chrome cài sẵn trên Windows. Không chạy script này để kiểm tra một contract thật; contract chỉ được đọc ở phép kiểm chứng riêng.

## Contract và ranh giới triển khai

[Kết quả đọc node](/C:/task-system/plane/docs/verification/wallet-members-2026-10-29/contract-readiness.json) xác nhận chain 991, registry đang cấu hình dùng policy v2. Hash runtime bytecode khớp artifact baseline và ABI có `addMember`; phương án thêm trực tiếp không đòi hỏi deploy v3.

Node từ chối mô phỏng thao tác ghi qua `eth_call` với thông báo `Cant store stack from read only call`. Vì vậy đây **không phải** bằng chứng giao dịch cấp quyền thật thành công. Cần nghiệm thu cuối bằng Admin và một ví Member thật: cấp Member, mở workspace ở trình duyệt/thiết bị khác, tải lại trang, kiểm tra đúng quyền và dự án chia sẻ.

Không đổi `.env`, dependency/lockfile, Docker hoặc SDK; không deploy/migration, commit/push, gửi email hoặc giao dịch thật trong phần việc này. Các địa chỉ/cấu hình đang dùng tiếp tục được đọc từ môi trường, không chép vào logic ứng dụng. Prototype email/OTP v3 trước đây chưa deploy, không được kích hoạt bởi luồng mới và được giữ để không xóa phần việc đã có.

Member được cấp quyền workspace không tự có quyền vào dự án private; các quyền dự án vẫn áp dụng. Contract v2 đang dùng chưa hỗ trợ Member tự rời workspace; thao tác đó phải báo giới hạn, không báo rời thành công giả. Không tuyên bố hệ thống sẽ không phát sinh bất kỳ lỗi nào từ RPC, IPFS hoặc ứng dụng ví.

## Dọn dẹp

Đã lưu log kiểm chứng, giữ mã nguồn và bộ kiểm thử tái sử dụng; đã dọn **19 tệp tạm, 11 profile Chrome và 7 ảnh/dump lỗi dư thừa**. Giữ ảnh kiểm thử thành công và một bản bằng chứng hồi quy trước sửa. Chi tiết tại [cleanup.json](/C:/task-system/plane/docs/verification/wallet-members-2026-10-29/cleanup.json). Giữ nguyên thay đổi attachment/dự án và các script/prototype đã có từ phần việc khác.
