# Kế hoạch hoàn thiện Plane DApp — 27/10/2026

Trạng thái cập nhật: người dùng đã duyệt và đã deploy Workspace Registry policy v2 lên Chain 991, chuyển dữ liệu `fiai`, cập nhật 6 tệp env và đối soát receipt/quyền/CID. Có 67 regression và 21 contract test đạt; services lint sạch. Chưa nghiệm thu toàn kế hoạch: còn QA ví trên giao diện và các đợt 2–5. Xem [báo cáo thực hiện](/C:/task-system/plane/BAO_CAO_SUA_LOI_PLANE_2026-10-27.md) cùng bằng chứng deployment hiện tại. Các mục bên dưới giữ vai trò kế hoạch/baseline lịch sử, không phải kết quả kiểm thử mới nhất.

## 1. Phạm vi và bằng chứng đầu vào

- Người dùng xác nhận chấp nhận tình trạng các khóa đã lộ. Thu hồi/đổi khóa và xử lý việc lộ khóa nằm ngoài kế hoạch này. Không tự đổi khóa, cấu hình, dependency, lockfile hoặc chính sách cổng build.
- Không sửa/xóa nội dung trong `C:\metanode-sdk`. Chỉ đọc SDK khi cần xác minh khả năng tích hợp; không giả định API ký tồn tại.
- Không commit/push. Phần deploy/chuyển registry và cập nhật env đã được người dùng duyệt ở phiên này; việc thêm dịch vụ/dependency mới vẫn phải có phương án cụ thể được duyệt.
- Git ở lần kiểm tra mới nhất: nhánh `27/10`, HEAD `a68fabf`. Phiên trước ở `24/10`; agent không chuyển nhánh. Có thay đổi sẵn trong router và module token mới, cùng hai file chẩn đoán chưa được theo dõi.
- Kết quả lượt kiểm tra trước: web typecheck pass; services typecheck có hai lỗi tham chiếu hàm tạo token đã bị xóa; web build bị chặn tại prebuild vì cấu hình khóa phía client. Chạy lại baseline trước khi sửa, không coi đây là kết quả nghiệm thu trên nhánh hiện tại.
- Lượt trước xác nhận HTTP 200 ở web và bốn dịch vụ SDK; RPC trả chain ID 991 và bytecode cho ba địa chỉ contract. Chưa kiểm thử giao dịch bằng ví thật.
- Báo cáo v1.1 là mốc lịch sử. Không suy ra tỷ lệ hoàn thành hiện tại từ số 15/31.

## 2. Nguyên tắc hoàn thành

1. Mỗi lỗi có thao tác tái hiện, nguyên nhân, thay đổi và tiêu chí nghiệm thu trước khi được đóng.
2. Ví thực sự ký là danh tính on-chain. Quyền không lấy từ trường role/email do client tự khai báo.
3. Phân biệt không có quyền với không đọc được quyền; RPC lỗi không tự cấp quyền hoặc tự kết luận bị xóa.
4. Phân biệt lưu local, chờ ký, đã gửi, đang chờ xác nhận, đã xác nhận và thất bại. Timeout sau khi gửi là trạng thái chưa xác định cho tới khi đối soát.
5. Giữ dữ liệu chưa đồng bộ khi lỗi; đối soát thao tác dở dang khi tải lại. Không giả định có giao dịch nguyên tử giữa localDB, IPFS và blockchain.
6. Dùng thư viện/công cụ đã có trước. Chỉ bổ sung dependency hoặc hạ tầng sau khi trình bày nhu cầu cụ thể và được người dùng đồng ý.
7. Mã đã sửa, kiểm tra tĩnh đạt và QA ví thật đạt là ba trạng thái riêng.

## 3. Đợt 0 — Baseline và mô hình dữ liệu

Mục đích: có trạng thái tái hiện được và tránh làm hỏng thay đổi sẵn có.

- Đọc diff hiện tại, xác định đầy đủ nơi phát hành/đọc/gửi lại/thu hồi/chấp nhận token.
- Chạy typecheck services và web; ghi kết quả build, không vượt cổng bảo mật để báo PASS.
- Lập bảng workspace ID/slug, user ID/email, ví ký, quyền local và quyền contract; ghi rõ chuyển đổi role giữa Plane và Solidity.
- Lập ma trận ai được mời, sửa quyền, xóa thành viên, quản lý dự án, giao việc và cập nhật snapshot. Đối chiếu cả operator và Owner/Admin, không chỉ UI.
- Đọc khả năng SDK và ABI/bytecode triển khai trước khi chốt phương án chứng minh quyền phát hành lời mời.
- Chuẩn bị dữ liệu kiểm thử riêng, gồm Owner, Admin, hai Member và hai workspace. Không dùng dữ liệu thật để thử xóa/thu hồi.

Đầu ra: danh sách lỗi tái hiện, ma trận quyền, đặc tả luồng lời mời và bộ lệnh kiểm tra. Những thay đổi hành vi sản phẩm/contract được ghi rõ trước khi thực hiện.

## 4. Đợt 1 — Lời mời và quyền thành viên từ đầu đến cuối

Ưu tiên cao nhất; xử lý hai lỗi TypeScript trong cùng thay đổi nhất quán của luồng token.

### Công việc

- Thống nhất một cơ chế phát hành/đọc token; xử lý tất cả caller cũ và quy tắc tương thích lời mời đã gửi.
- Link chỉ định danh lời mời; quyền phải được xác minh bằng bản ghi đáng tin cậy. Loại bỏ nhánh tự cấp quyền từ payload Base64 chưa xác thực.
- Quy định vòng đời phát hành, chờ chấp nhận, hết hạn, thu hồi, từ chối, đã sử dụng; hạn dùng không được tự gia hạn khi đọc link.
- Ràng buộc lời mời với workspace, người nhận/ví đích, quyền, mạng/contract và định danh chống dùng lại. Không dùng timestamp do người mở link khai báo làm bằng chứng hợp lệ.
- Gửi email sau khi trạng thái lời mời có thể được người nhận xác minh. Gửi lại phải có quy tắc rõ cho token cũ; lỗi mail và lỗi công bố được báo riêng.
- Giữ kiểm tra đúng tài khoản nhận email; không đồng nhất kiểm tra chuỗi email với bằng chứng sở hữu email. Phần chứng minh email phụ thuộc đợt 2.
- Chấp nhận lời mời bằng ví ký thật. Nếu ví đang chọn khác ví đích, yêu cầu chọn đúng ví trước khi gửi; không âm thầm ghi thành viên theo ví cũ.
- Local chỉ phản ánh quyền đã xác minh; lưu yêu cầu đang chờ riêng. Tải lại đối soát receipt/quyền thay vì đánh dấu thành công sớm.
- Thu hồi và xóa thành viên có hiệu lực ở nguồn quyền chung; snapshot cũ, tab cũ và lời mời cũ không được tự khôi phục quyền. Mời lại phải là thao tác phát hành mới được cho phép.
- Dọn quyền dự án/assignee liên quan theo quy tắc nghiệp vụ, giữ lịch sử tác giả và audit.
- Xem lại bảo vệ Owner, chuyển Owner, danh sách thành viên bị trùng sau chu kỳ xóa/thêm lại, cùng quyền cập nhật snapshot của Member.

### Phần contract cần giải quyết

Nguồn hiện tại cho phép bất kỳ ví nào tham gia workspace tồn tại qua `joinWorkspace`. Với workspace kín, đóng lỗi quyền đòi hỏi kiểm soát tham gia ở contract; chặn trong UI không đủ.

Ưu tiên xem khả năng quản lý lời mời/ủy quyền bằng giao dịch contract đã được Owner/Admin ký, ràng buộc ví người nhận và trạng thái thu hồi. Chỉ chọn phương án ký thông điệp nếu đã xác minh SDK hỗ trợ và contract có thể kiểm chứng. Không bịa thêm API SDK.

Email chưa có ví cần một bước ràng buộc ví được xác thực/duyệt trước khi cấp quyền; đặc tả phải nêu trải nghiệm này. Việc cần dịch vụ xác thực email được xử lý ở đợt 2.

Chuẩn bị mã contract, ABI, kiểm thử và kế hoạch chuyển dữ liệu để review. Deploy mới/đổi địa chỉ contract chỉ thực hiện sau khi người dùng duyệt thay đổi cụ thể. Không hứa dùng frontend để đóng giới hạn của contract cũ.

### Nghiệm thu

- Lời mời hợp lệ vào đúng workspace và đúng quyền trên trình duyệt chưa có dữ liệu local.
- Từ chối token bị sửa role/email/workspace, token thiếu thông tin bắt buộc, hết hạn, thu hồi hoặc đã sử dụng trái quy tắc.
- Ví/tài khoản khác không nhận vơ lời mời; Member không tự nâng thành Admin.
- Xóa rồi mở link cũ, nhập snapshot cũ hoặc tải lại tab cũ không hồi sinh thành viên.
- Mời lại chỉ phục hồi đúng workspace; không ảnh hưởng workspace khác.
- Hủy ký, RPC lỗi và reload giữa giao dịch giữ trạng thái đúng, không hiện thành công giả.
- Có kiểm thử contract và kiểm thử router cho các trường hợp trên; services và web typecheck đạt.

## 5. Đợt 2 — Xác thực tài khoản và gắn tài khoản với ví

Phần này xử lý tính đúng đắn của đăng nhập, độc lập với việc người dùng chấp nhận khóa đã lộ.

- Kiểm toán luồng đăng nhập mật khẩu/OTP và nguồn session hiện tại.
- Nếu email tiếp tục là bằng chứng đăng nhập, chuyển việc phát hành/kiểm tra OTP, hạn dùng, số lần thử và chống dùng lại tới dịch vụ xác thực đáng tin cậy. Tận dụng dịch vụ hiện có nếu có; không coi localStorage là nơi quyết định xác thực.
- Việc liên kết/đổi ví phải chứng minh quyền kiểm soát ví bằng khả năng đã xác nhận của SDK. Nếu không có API ký thông điệp phù hợp, thiết kế xác nhận qua giao dịch thay vì thêm mock.
- Chốt ranh giới: tài khoản email, quyền kiểm soát ví và quyền workspace là ba thông tin riêng. Đổi tài khoản/đổi ví phải xóa cache quyền và trạng thái ký liên quan.
- Thiết kế tương thích tài khoản cũ và thông báo bước xác minh lại cần thiết; không xóa dữ liệu người dùng để giải quyết xung đột danh tính.

Nghiệm thu: OTP sai/hết hạn/dùng lại bị từ chối; sửa localStorage không tạo được session được nguồn tin cậy công nhận; đổi ví không nhận quyền của ví trước; đăng xuất vô hiệu session theo chính sách đã chốt.

Phụ thuộc: cần thiết kế endpoint/dịch vụ và phương án triển khai cụ thể nếu môi trường chưa có backend xác thực. Không tự thay hạ tầng. Chỉ đóng phần xác thực email khi đã có kiểm thử end-to-end trên dịch vụ thật.

## 6. Đợt 3 — Task, giao dịch và đối soát on-chain

- Lập bản đồ issue ID -> contract task ID, lưu rõ chain ID và địa chỉ contract của bản ghi. Đối chiếu contract triển khai với ABI đang dùng, không chỉ kiểm tra có bytecode.
- Phân biệt task thiếu, dữ liệu thuộc contract cũ, thiếu quyền, lỗi RPC và lỗi ABI. Không biến mọi lỗi đọc thành kết luận task không tồn tại.
- Chuẩn bị backfill/migration có preview, chống tạo trùng, checkpoint và khả năng tiếp tục. Chỉ ghi dữ liệu thật sau khi phương án/danh sách tác động được duyệt.
- Kiểm tra mọi đường gửi: task, comment, attachment, member, Sync và auto-commit. Dùng một cơ chế đối soát hash/receipt và hàng đợi nhất quán.
- Rà soát fallback ký BLS -> ký ví, nhận diện lỗi bằng chuỗi và retry nhiều tầng. Không coi từ "member" trong thông báo lỗi là bằng chứng giao dịch thành công.
- Lưu dấu thao tác đang chờ để phục hồi sau reload. Timeout sau gửi không tự gửi lại trước khi xác định kết quả giao dịch trước.
- Giữ nguyên lựa chọn auto-commit hiện tại trong baseline; đo riêng giao dịch nghiệp vụ và giao dịch CID. Mọi thay đổi D1 được trình bày bằng số giao dịch đo được.
- Xác định số giao dịch hợp lệ theo thao tác. Hành động cần cập nhật nhiều contract có thể cần nhiều giao dịch; mục tiêu là không gửi trùng cùng bước nghiệp vụ và không báo thành công khi chỉ hoàn tất một phần.

Nghiệm thu: tạo/sửa/giao/xóa task, comment, đính kèm, thêm/xóa thành viên và Sync đều có kết quả đối chiếu receipt; mất mạng sau gửi không tạo bản ghi/giao dịch trùng; lỗi một bước được hiển thị đúng. Đo nonce/hash bằng ví test và chạy lại Q1–Q8 với kỳ vọng đã đối chiếu call graph thực tế.

## 7. Đợt 4 — Snapshot và sửa đồng thời

- Rà soát cơ chế BroadcastChannel, bản sao IndexedDB và hợp nhất snapshot hiện có trước khi thay đổi.
- Mỗi thay đổi có định danh/phạm vi workspace và phiên bản nguồn. Tab/máy đang có dữ liệu chưa đồng bộ không bị snapshot từ nơi khác âm thầm thay thế.
- Áp dụng điều phối ghi giữa các tab phù hợp với trình duyệt hỗ trợ; hàng đợi trong một JS runtime chưa đủ để khóa hai tab.
- Contract nguồn đã có cập nhật CID có điều kiện theo CID cũ. Xác minh contract triển khai hỗ trợ trước khi nối luồng ghi vào cơ chế này.
- Khi xung đột, đọc lại bản mới rồi hợp nhất các thay đổi độc lập; báo người dùng với thay đổi cùng trường không thể hợp nhất an toàn. Không ghi đè cưỡng bức sau lỗi xung đột.
- Giới hạn phạm vi snapshot, bảo toàn bản ghi xóa và thay đổi quyền; phát hiện bản local chưa được đồng bộ để phục hồi có kiểm soát.
- Dùng danh sách workspace/thành viên đã có trên contract và con trỏ snapshot để khôi phục dữ liệu đa máy trước. Chỉ bổ sung indexer nếu thử nghiệm chứng minh thiếu khả năng tìm kiếm/đồng bộ, kèm thiết kế hạ tầng riêng.

Nghiệm thu: hai tab sửa bản ghi khác nhau không mất dữ liệu; hai máy cập nhật CID cùng lúc không âm thầm ghi đè; sửa/xóa cùng bản ghi có kết quả xác định; máy mới khôi phục đúng workspace, quyền và task; ngắt mạng rồi kết nối lại không hồi sinh dữ liệu đã xóa.

## 8. Đợt 5 — Tệp đính kèm dùng được trên nhiều máy

- Giữ lưu local trước khi ký như bộ đệm bền vững, nhưng kiểm tra lại nhánh xóa file khi giao dịch lỗi/timeout. Kết quả chưa xác định không được xóa bản duy nhất trước khi đối soát.
- Nếu yêu cầu dùng nhiều máy, đưa nội dung tệp tới kho lưu trữ thực qua khả năng File Processor đã được xác minh; lưu tham chiếu bền vững và kiểm tra đọc lại.
- Bằng chứng gắn với hash nội dung thực của tệp; đối chiếu định dạng/thuật toán contract đang dùng. Metadata tên/kích thước không thay thế bằng chứng byte của tệp.
- Tách trạng thái lưu local, tải kho, chờ ghi bằng chứng và hoàn tất. Retry không tạo tệp/bằng chứng trùng.
- Lập chính sách quyền truy cập cho tệp workspace kín. Membership trên chain không tự làm dữ liệu IPFS công khai trở thành riêng tư; nếu cần mã hóa/phân phối khóa thì phải thiết kế và nghiệm thu riêng.
- Tệp cũ chỉ tồn tại trên máy nào phải được nhận diện đúng; chỉ chuyển được khi còn byte gốc. Không tạo file chứng thực giả thay tệp bị thiếu.

Nghiệm thu: máy B tải đúng byte của tệp do máy A thêm; tải lại trang, hủy ký, lỗi upload, timeout sau gửi, hết dung lượng và tệp cũ thiếu byte đều có kết quả đúng và khả năng tiếp tục phù hợp.

## 9. Đợt 6 — Kiểm tra tổng thể và đóng báo cáo

- Chạy typecheck services/web, lint vùng thay đổi, build các gói bị tác động và web build; chạy root build khi cần nghiệm thu toàn monorepo.
- Cổng build hiện chặn cấu hình khóa người dùng chấp nhận giữ lại. Nếu cấu hình không đổi, ghi rõ build bị chặn bởi cấu hình; không báo build PASS hoặc tự vô hiệu cổng. Chấp nhận khóa đã lộ không được diễn giải thành tự thay chính sách build.
- Chạy kiểm thử logic, contract local và end-to-end bằng ví test thật. Không coi mock SDK hoặc HTTP 200 là bằng chứng giao dịch thành công.
- Kiểm tra hồi quy CRUD dự án/task, quyền dự án, assignee, Activity/History, comment, tệp, link chia sẻ và đăng nhập/đổi ví.
- Mỗi kết quả runtime lưu môi trường, thao tác, thời điểm, địa chỉ ví/contract phù hợp, hash/receipt và kết quả mong đợi/thực tế; không ghi khóa hoặc OTP.
- Cập nhật báo cáo v1.1 bằng kết quả mới, tách lỗi đóng, lỗi chờ triển khai và lỗi chưa kiểm thử. Không dùng một nhãn "đã xong" cho cả ba.
- Phân trang, Import và các lựa chọn UI/BA khác được đưa vào backlog riêng, không tự coi đã được xử lý bởi các đợt trên.

## 10. Thứ tự và điểm duyệt

Thứ tự: đợt 0 -> đợt 1 -> đợt 2 -> đợt 3 -> đợt 4 -> đợt 5 -> đợt 6. Thiết kế xác thực email của đợt 2 là phụ thuộc để đóng toàn bộ luồng mời theo email ở đợt 1; có thể chuẩn bị hai phần cùng đợt nhưng không đóng sớm phần phụ thuộc.

Thực hiện các thay đổi nguồn và kiểm thử local trong Plane theo phạm vi được giao. Trước các việc deploy/đổi contract, chuyển dữ liệu thật hoặc thêm dịch vụ/dependency, chuẩn bị sẵn diff, kết quả kiểm thử, tác động và phương án khôi phục để người dùng duyệt kết quả cụ thể.

Kế hoạch này không khẳng định mọi lỗi có thể được đóng chỉ bằng sửa frontend. Nếu giữ contract tự cho tham gia và xác thực email hoàn toàn trong trình duyệt, các giới hạn quyền/xác thực tương ứng vẫn còn và phải được báo là chưa đóng.
