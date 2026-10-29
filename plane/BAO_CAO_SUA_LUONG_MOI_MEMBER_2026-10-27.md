# Kiểm tra và sửa luồng mời thành viên — 27/10/2026

## Nguyên nhân đã xác nhận

Lời mời trong ảnh vẫn đang Pending và còn hạn. API trên trình duyệt trả `MEMBER_REMOVED`, nhưng giao diện trước đây chuyển mọi lỗi thành “This invitation link is not active anymore”. Đây không phải bằng chứng lời mời hết hạn.

Workspace mặc định cũ có ID dạng `workspace-fiai`, còn workspace đã công bố có UUID khác. Phía nhận chọn bản ghi local trước bản ghi công bố. Bộ gộp snapshot còn ánh xạ dấu xóa của workspace mặc định sang slug và UUID thật, khiến người nhận bị coi là đã bị xóa dù lời mời mới hợp lệ.

Một lỗi nguồn dữ liệu khác cũng đã xác nhận trong mã: bản nháp IndexedDB có thể mang CID đã biết gần nhất rồi bị đọc như nội dung IPFS bất biến. Đăng ký hoặc autosave thay đổi bản nháp có thể khiến danh sách lời mời bị đọc thiếu. Metadata CID mới cũng có thể gán nhãn sai cho một checkpoint cũ.

Lời mời được báo cáo chưa có ví người nhận. Vì vậy, sau khi đọc đúng lời mời vẫn phải có bước quản trị viên xác nhận ví trước khi người nhận ký tham gia.

## Thay đổi

- Chọn workspace từ snapshot công bố, ưu tiên ID gắn với chính lời mời. Không truyền dấu xóa của workspace mặc định sang workspace UUID khác.
- Khi đọc được nguồn mới nhất, dùng dấu xóa thành viên của nguồn đó để xét lời mời. Sau khi giao dịch và quyền thành viên đã được xác nhận, gỡ dấu xóa cũ của đúng người trong các khóa workspace tương ứng trên thiết bị.
- Lời mời lại đã công bố có thể vượt qua dấu cấm email cũ ở thiết bị nhận. Thu hồi theo ID/token cụ thể và dấu cấm trong snapshot công bố vẫn được giữ nguyên.
- Không dùng checkpoint IndexedDB mới nhất thay cho nội dung CID. Giữ checkpoint để phục hồi offline; CID của checkpoint không bị thay bằng metadata không thuộc nó.
- Đọc các IPFS gateway song song; hạn chờ bao gồm cả tải body, bỏ các bản trả HTTP lỗi hoặc JSON sai dạng.
- Trang lời mời có trạng thái tải, lỗi có thể thử lại, thông tin link sai/hết hạn, đăng nhập/đăng ký, sai tài khoản, chờ duyệt ví và đã tham gia. Không gom lỗi kết nối thành link chết.
- Giữ ID, slug và token qua đăng ký, đăng nhập, đổi phương thức và nhập lại email. Chặn return URL đi ra ngoài origin; tránh lặp basename khi React Router chuyển trang.
- Lời mời là trang công khai: lỗi 401 của request kiểm tra tài khoản không tự đẩy người nhận ra khỏi trang.
- Phục hồi workspace DB chạy nền trên các trang đăng nhập, đăng ký và lời mời; không có lớp chờ toàn màn hình che các nút/form này. Trang workspace vẫn giữ lựa chọn xử lý xung đột dữ liệu.
- Người nhận chưa được duyệt ví có thể chọn và sao chép địa chỉ ví. Thao tác này không gửi giao dịch tham gia.
- Trong Pending invites, quản trị viên có menu “Xác nhận ví người nhận”. Backend kiểm tra quyền quản trị bằng ví ký, xác nhận quyền nhận lời mời trên contract và công bố snapshot trước khi báo thành công.
- Lần gắn ví đầu tiên cho lời mời còn hạn giữ nguyên link email. Đổi ví, đổi quyền hoặc gửi lại lời mời sẽ đổi token. Lỗi khi duyệt ví được hiển thị, có thể thử lại; không tự thêm thành viên.
- Store giao diện nhận lại bản ghi lời mời từ API, gồm link/token mới khi có thay đổi. Đổi tài khoản không xóa toàn bộ sessionStorage và dữ liệu offline.
- QA trình duyệt còn phát hiện ví đang kết nối có thể tự tạo lại phiên tài khoản ngay sau khi người nhận chọn đổi tài khoản. Đăng xuất chủ động được ghi nhận riêng trong tab; phát hiện lại ví không tự đăng nhập. Đăng nhập thành công qua mật khẩu/OTP hoặc API mới mở lại phiên tài khoản.

## Kiểm chứng

Kết quả cuối và log được lưu trong [bộ bằng chứng](docs/verification/invitations-2026-10-27/validation.json).

| Kiểm tra | Kết quả |
| --- | --- |
| Hồi quy TypeScript nguồn thật | 145/145, không bỏ qua ca nào |
| Chrome: đăng ký, đăng nhập, lời mời, chờ duyệt ví, tham gia, quản trị duyệt ví, đổi tài khoản | 9/9; click bằng chuột CDP và kiểm tra nút không bị che |
| TypeScript services | Đạt |
| TypeScript web | Đạt: typegen và tsc |
| Build services và production web | Đạt cả hai |
| Lint services | 0 lỗi, 0 cảnh báo |
| Lint 5 file UI/điều phối đã sửa | 0 lỗi, 1 cảnh báo có sẵn tại callback của bootstrap |

### Tiếp tục và hoàn tất ngày 29/10/2026

Đã chạy lại toàn bộ 145 kiểm thử, 9 tình huống Chrome bằng click chuột, TypeScript services/web, build services/web và lint nêu trên. Kịch bản đăng nhập dùng hàm đăng xuất chủ động của DApp trước khi đăng nhập lại. Toàn bộ kết quả đều đạt; cảnh báo lint có sẵn được giữ nguyên và ghi trong log.

Đã tạo lại output của Propel bằng script build có sẵn để web phân giải đúng các entry của package; không sửa dependency, lockfile hoặc cấu hình. Trên môi trường PowerShell hiện tại, các lệnh kiểm tra dùng `pnpm.cmd` để không phải đổi ExecutionPolicy.

[Hồ sơ kiểm chứng](docs/verification/invitations-2026-10-27/validation.json) ghi kết quả lệnh, SHA-256 của 27 file nguồn được kiểm tra và hash các log/ảnh bằng chứng. Bộ bằng chứng nằm trong thư mục `docs/` đang được Git ignore theo cấu hình hiện có; không sửa quy tắc ignore hoặc tự stage file.

Đã dọn 31 mục QA tạm do tác vụ tạo ra, gồm script, log tạm và profile Chrome riêng; không còn mục `invitation*` trong thư mục tạm. Giữ các log/ảnh cần đối chiếu trong bộ bằng chứng, bản sao dự phòng và file phục vụ dev server. Web server đang có ở port 3000 được giữ nguyên, không dừng hoặc tạo thêm tiến trình thay thế.

Các đối soát RPC/IPFS và thay đổi dữ liệu thật dưới đây là bằng chứng ngày 27/10; không đối soát lại trạng thái lời mời thật trên chain trong lượt 29/10. Kiểm thử trình duyệt bổ sung vẫn dùng ví/RPC/lưu trữ giả lập, không gửi email hay giao dịch thật.

Kiểm thử hồi quy chạy trên TypeScript nguồn thật với RPC, ví, lưu trữ và email giả lập. Kiểm thử trình duyệt dùng Chrome với profile riêng; mọi giao dịch, upload và email thật bị chặn. Kiểm tra link thật chỉ đọc RPC/IPFS, không chấp nhận lời mời thay người dùng.

Tại block 15829 (09:39 UTC), link được báo cáo sau sửa đọc thành công, đúng UUID workspace, `accepted: false`, `wallet_approval_required: true`, `source_verified: true`. Tạo checkpoint local thiếu lời mời rồi đọc lại CID vẫn lấy đúng lời mời đã công bố. Đây là bằng chứng tại thời điểm kiểm tra, không phải cam kết về trạng thái link sau khi quản trị viên thay dữ liệu.

Đến lần đối soát cuối, nguồn đã đổi: giao dịch ở block 15833 cập nhật CID và snapshot mới không còn ID lời mời trong ảnh. Chủ dự án xác nhận đã chủ động xóa hoặc khôi phục/đồng bộ dữ liệu trong lúc QA. Không khôi phục lời mời cũ. Link cũ hiện trả `INVITATION_NOT_FOUND` và giao diện hướng dẫn liên hệ quản trị viên; không bị báo lỗi kết nối/hết hạn sai. Cần tạo lời mời mới để kiểm tra tiếp bằng người nhận thật. Bằng chứng trước sửa, sau sửa và sau thay đổi dữ liệu được lưu riêng.

Build production dùng ngoại lệ `ALLOW_PUBLIC_SIGNING_SECRETS=true` chỉ trong tiến trình build, theo quyết định trước của chủ dự án về các khóa public hiện có. Không sửa env hoặc tắt cổng kiểm tra trong mã. Cảnh báo có sẵn của công cụ build/lint được giữ trong log; kết quả thành công không có nghĩa mọi cảnh báo toàn dự án đã được xử lý.

## Cách kiểm tra lại bằng tài khoản thật

1. Vì dữ liệu hiện tại đã xóa lời mời được báo cáo, quản trị viên tạo lời mời mới. Mở đầy đủ link email mới, tải mới trang và đăng nhập đúng email nhận lời mời.
2. Nếu đang chờ duyệt ví, chọn ví rồi sao chép địa chỉ gửi riêng cho quản trị viên.
3. Quản trị viên mở Settings → Members → Pending invites → menu của đúng email → Xác nhận ví người nhận. Đối chiếu địa chỉ với người nhận trước khi ký; chờ thông báo xác nhận và công bố.
4. Người nhận bấm “Kiểm tra lại lời mời” tại link email ban đầu, sau đó “Chấp nhận và xác nhận ví”. Chọn đúng ví được duyệt và xác nhận giao dịch.
5. Chỉ sau khi đọc lại quyền trên contract thành công, ứng dụng mới lưu thành viên đã xác minh và mở workspace.

## Phạm vi và giới hạn

Không deploy/sửa contract, không sửa SDK, dependency, lockfile hoặc env trong đợt sửa này; không commit/push. Các thay đổi OTP đã có trong workspace khi đọc mã và các thao tác xóa file ngoài phạm vi xuất hiện trong lúc làm việc được giữ nguyên, không được tính là phần sửa lời mời trong báo cáo này.

Chưa ký giao dịch bằng ví thật của người nhận và chưa gửi email mời mới trong lượt QA này. Việc trao địa chỉ ví giữa người nhận và quản trị viên vẫn là bước xác minh trực tiếp; chưa có cơ chế tự động yêu cầu/duyệt ví từ email. Hệ thống không thể bảo đảm RPC, dịch vụ lưu trữ, email hoặc ví bên ngoài không bao giờ gặp lỗi; bản sửa giữ dữ liệu, hiển thị bước phục hồi và không báo thành công khi chưa xác nhận được.
