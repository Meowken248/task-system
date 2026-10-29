# Triển khai kế hoạch member

## Quyết định hiện hành: thêm trực tiếp bằng ví

Chủ dự án đã chọn phương án đơn giản: Admin lấy địa chỉ ví công khai, chọn Member/Admin và ký `addMember`. Người nhận dùng đúng ví để mở workspace; không cần OTP, nhận lời mời, ký tham gia hoặc Admin duyệt lần hai. Quyết định này thay thế phạm vi tự nhận bằng email ở phần lịch sử bên dưới.

Luồng mới dùng contract v2 đang có; không gọi dịch vụ verifier và không thêm database. Các prototype v3 được giữ để đối chiếu, chưa deploy và không nằm trên đường thêm thành viên mới. Kết quả kiểm chứng riêng được ghi trong [báo cáo thêm bằng ví](/C:/task-system/plane/BAO_CAO_THEM_MEMBER_BANG_VI_2026-10-29.md). Không dùng kết quả 50/166 của prototype để tuyên bố nghiệm thu giao diện mới.

## Lịch sử triển khai giao thức email — chưa phát hành

Kế hoạch được chủ dự án duyệt ngày 29/10/2026. Baseline: `140d571`.

## Ranh giới đã duyệt

- Triển khai mã và kiểm thử cục bộ theo P0–P6.
- Không sửa SDK, không commit/push, không đổi env đang dùng.
- Hosting, dependency mới, deploy/migration contract và test mail/ví thật có điểm duyệt riêng theo D6.

## P0: giao thức được chọn để triển khai và kiểm thử

1. Admin đăng ký quyền mời bằng giao dịch: ID, workspace, cam kết email, role, version và hạn dùng. CID không quyết định quyền mời.
2. Dịch vụ xác minh email ngoài trình duyệt phát bằng chứng ngắn hạn gắn đúng ví. Verifier được Owner cấu hình riêng cho workspace; không dùng khóa Admin.
3. Member gửi giao dịch nhận quyền; `msg.sender` là bằng chứng sở hữu ví. Không phụ thuộc API ký thông điệp bất kỳ của SDK.
4. Contract kiểm tra domain chain/registry/workspace, version, role, expiry, verifier epoch và chữ ký. Tiêu thụ lời mời và cấp member nguyên tử.
5. Đã gửi nhưng chưa rõ kết quả phải đối soát, không tự gửi lại. Từ chối/đổi ví không làm vé đã ký biến mất; chờ vô hiệu hóa/hết hạn có thể kiểm tra.
6. Giữ v2 hoạt động khi chưa cấu hình dịch vụ/contract mới. Không kích hoạt đường tự nhận email trên v2, không fallback sang cấp quyền bằng localStorage.

## Điều chỉnh theo yêu cầu mới: không database, không lưu phía dịch vụ

Chủ dự án xác nhận chỉ dùng local/IPFS/chain, không PostgreSQL/SQLite, không tệp lưu OTP/session phía dịch vụ. Không thêm pg hoặc dependency mới. Mẫu SQLite kiểm thử ban đầu đã bỏ, chưa từng tích hợp vào Plane.

- Quyền mời, hạn dùng, nonce/version, số lượt OTP và trạng thái tiêu thụ: on-chain.
- Metadata email và trạng thái cần bảo mật: mã hóa trước khi pin IPFS; on-chain giữ CID tham chiếu. Không công bố OTP hoặc hash sáu chữ số có thể dò offline.
- Dịch vụ email/verifier không ghi state lên disk; dùng cấu hình bí mật server để giải mã metadata và tạo mã/bằng chứng. Mã OTP có thể tái tạo bằng HMAC có khóa theo challenge ID để phục hồi job sau restart.
- Session là token niêm phong ngắn hạn, đối chiếu với bằng chứng xác minh trên chain; không tin verified flag local.
- Ví dịch vụ cần ghi giao dịch nền cho challenge/attempt/delivery. Các thao tác phải idempotent, được kiểm thử và báo rõ phí/độ trễ. Chưa được deploy hay gửi giao dịch mạng thật.
- Phát hành vẫn có điểm duyệt riêng theo D6. Không hứa đạt SLA giống database khi chưa đo giao dịch nền trên node mục tiêu.

## Trạng thái

Đây là kết quả triển khai cục bộ, **chưa hoàn tất luồng v3 trên giao diện và chưa phát hành**. Kết quả 145/9 trước đây là baseline của luồng cũ, không thay thế test mới.

### Mã đã thực hiện

- [Registry v3](/C:/task-system/plane/contracts/PlaneWorkspaceRegistry.sol): Admin đăng ký quyền mời mà chưa cần biết ví; role/hạn/version/cam kết email/CID metadata nằm trong record có thẩm quyền. Vé gắn chain/registry/workspace/ví và verifier epoch. Có reservation ngắn hạn, nhận quyền nguyên tử, chống cấp hai ví cho cùng cam kết email đang là member, phân biệt declined/revoked và self-leave. Chưa deploy.
- [Contract xác minh](/C:/task-system/plane/contracts/PlaneEmailVerification.sol): số lần thử OTP, cooldown/resend, quota và lease/trạng thái gửi OTP được ghi trên chain. Hash OTP là HMAC có khóa, không phải hash sáu chữ số có thể dò offline. Verifier không được tạo quyền mời/chọn role/tự thêm member. Đây là contract bổ sung, không phải sửa SDK.
- [Lõi verifier không state bền vững](/C:/task-system/plane/services/member-auth/service.mjs): metadata mã hóa AES-GCM trước IPFS; token challenge/session được niêm phong và gắn domain/purpose. Tạo lại service instance dùng cùng key và chain vẫn phục hồi được. Không ghi OTP/session/job ra disk hoặc database. Các token hiện là kết quả lõi nội bộ; HTTP adapter còn phải đặt chúng trong cookie HttpOnly, không đưa ra JSON frontend/localStorage.
- [Adapter chain](/C:/task-system/plane/services/member-auth/chain-adapter.mjs): xếp hàng một writer, đọc nonce không qua cache ngắn của ethers, chờ receipt và đối soát state. Không tự retry giao dịch chưa rõ kết quả. Hiện kiểm thử bằng ethers/Hardhat, chưa chứng minh giao dịch nền phù hợp RPC/fee/chữ ký trên node FIAI thật.
- [Snapshot chia sẻ](/C:/task-system/plane/packages/services/src/dapp/shared-snapshot.ts): loại các trường credential/password/OTP/session/key đã định danh; không nhập credential hoặc cờ email verified từ snapshot. Giữ auth đã có ở thiết bị khi gộp cùng identity, không gắn password sang email khác vì trùng user ID. Giữ locator lời mời v2 để tương thích. Đây không phải công cụ tìm mọi bí mật trong nội dung văn bản tùy ý; không thể thu hồi snapshot IPFS lịch sử đã công khai.
- [Self-leave và ánh xạ role](/C:/task-system/plane/packages/services/src/dapp/chain.ts): Member thường được tự rời qua đúng thao tác contract; API chỉ dọn local sau khi đối soát role None. Owner phải chuyển quyền trước, v2 còn quyền trả lỗi yêu cầu nâng contract, request trùng dùng chung một giao dịch. Chỉ cho phép tạo/cấp role Admin hoặc Member; Guest/Viewer không tự chuyển thành Member. Record cũ vẫn giữ, lời mời Guest cũ vẫn có thể thu hồi.
- [Router](/C:/task-system/plane/packages/services/src/dapp/routes.ts) và ba dropdown quản lý member đã chặn role không hỗ trợ. Chưa bỏ bước duyệt ví ở giao diện v2 vì contract hiện dùng chưa có giao thức tự nhận email.
- Root typecheck phát hiện thiếu declaration của script migration cũ. Đã thêm [khai báo kiểu](/C:/task-system/plane/scripts/restore-workspace-registry.d.mts); sửa quy tắc ignore trùng đang che cả các script được whitelist. Các script có sẵn hiện xuất hiện để review; không thực thi migration/deploy và không xóa script của phiên trước.

### Kiểm chứng và giới hạn

Kết quả cuối cùng được ghi tại [validation.json](/C:/task-system/plane/docs/verification/member-flow-2026-10-29/validation.json), kèm log nguyên bản. Test mới dùng chain Hardhat local và fixture mail/IPFS; không gửi email/giao dịch mạng thật.

- Bộ Hardhat gồm baseline registry, giao thức claim và lõi xác minh không database: 50 ca pass.
- Bộ hồi quy DApp gồm snapshot, self-leave và role: 166 ca pass.
- Typecheck root/contracts, services và web pass. Build services/web được lưu cùng log kiểm chứng; không phải build toàn bộ monorepo. Lint services: 0 lỗi/0 cảnh báo. Lint phạm vi mới + ba file UI: 0 lỗi/3 cảnh báo có sẵn về shadow biến và thẻ tương tác. Có cảnh báo Node về module type của cấu hình PostCSS có sẵn; không sửa dependency/config để che cảnh báo.
- Có ca mất phản hồi OTP/mail/reservation/decline, request đồng thời, code sai/quá lượt/hết hạn, đổi verifier, domain giả, cookie giả, đổi ví, từ chối sau khi đã phát vé, email trùng hai lời mời và không khôi phục member đã xóa.
- Thông số local hiện tại: OTP 10 phút, tối đa 5 lượt thử, resend 60 giây, 6 challenge/lời mời/giờ và 30 challenge/network bucket/giờ; session 30 phút; reservation/vé dự kiến 240 giây, contract tối đa 300 giây. Đây là thông số prototype cần đánh giá vận hành, không phải SLA production.
- Một ca thành công mẫu cần **5 giao dịch nền của verifier + 1 giao dịch của member**, ngoài đăng ký quyền mời ban đầu của Admin và cấu hình workspace/verifier. Gas local được ghi trong validation; chưa quy đổi phí hoặc hứa độ trễ trên node thật. Không có lần duyệt tay thứ hai của Admin.
- Lease hết mà không biết provider đã nhận chưa được đánh dấu ambiguous; không tự gửi lại. Việc gửi lại có chủ đích có thể làm người nhận nhận hai thư nếu provider trước đã nhận. Không hứa gửi đúng một lần tuyệt đối.
- ID lời mời là dữ liệu công khai trên chain. Request OTP cần thêm locator HMAC 256-bit chỉ gửi trong mail mời, không lưu trên chain/snapshot hoặc trả từ API public; biết ID không đủ để đốt quota/gửi thư. Locator này không cấp quyền member và không thay thế xác minh email. HTTP/UI sau này phải tránh log hoặc làm lộ locator qua referrer; chưa coi phần này đã được kiểm chứng trên browser.
- Queue hiện chỉ phục vụ một writer đang hoạt động cho mỗi key; chưa hỗ trợ nhiều instance chủ động cùng một key. Key cấu hình là bí mật server, không phải state OTP/session; đổi key mã hóa không phải thao tác vô hại vì metadata cũ cần giải mã đúng key. Cần quy trình rotation/khôi phục trước phát hành.

### Phần còn phải làm trước nghiệm thu toàn luồng

1. HTTP adapter: cookie HttpOnly/Secure/SameSite, Origin/CSRF, giới hạn body/thời gian, lỗi an toàn, IP lấy từ kết nối/proxy được tin cậy. Không biến tham số networkAddress của lõi thành dữ liệu client tự khai.
2. Adapter IPFS/mail thật có timeout và CID validation; outbox **thư mời ban đầu**; xác thực phiên ví Admin để xem metadata riêng; worker phục hồi job từ event chain. Lõi hiện kiểm chứng outbox OTP, chưa coi phần gửi thư mời v3 đã hoàn tất.
3. Tích hợp SDK/frontend theo feature gate cấu hình + đúng policy v3. Giữ login/signup/link, chọn/thêm ví, chuẩn bị vé, ký một lần, đối soát sau refresh và lỗi IPFS sau khi đã nhận quyền. Không bật v3 chỉ vì bytecode local đã build.
4. Xử lý M07/M09/M12: thu hồi member khi thiếu định danh ví, BroadcastChannel/cookie chỉ là hint và khóa workspace, cập nhật Admin từ chain có giới hạn. Self-leave hiện không được coi là giải quyết xong mọi đường cache cũ.
5. Kiểm thử hai browser profile, failpoint dịch vụ thật cục bộ và migration preview v3. Kết quả Chrome cũ không phải bằng chứng E2E v3.
6. Manifest phát hành trình duyệt theo D6, gồm hai contract, cấu hình verifier/service, key quản lý riêng, phí/độ trễ và rollback. Chưa đổi env, hosting, dependency, contract address hay dữ liệu thật; chưa commit/push.
