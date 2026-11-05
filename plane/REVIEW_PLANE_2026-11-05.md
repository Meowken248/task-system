# Review Plane và dọn tệp — 05/11/2026

> Cập nhật sau review: các lỗi được chọn của năm phân hệ đã có bản sửa và kiểm chứng riêng trong [báo cáo sửa năm phân hệ](/C:/task-system/plane/BAO_CAO_SUA_NAM_PHAN_HE_2026-11-05.md). Các nhận định dưới đây ghi nhận baseline tại thời điểm review; xem báo cáo mới để phân biệt mục đã sửa với vấn đề vẫn còn.

**Kết luận:** chưa đủ cơ sở coi toàn bộ Plane đã mượt hoặc hết bug. Các bộ test hiện có đều qua, nhưng kiểm tra bổ sung đã tái hiện những nhánh chưa được bộ test bao phủ, gồm sai phạm vi dữ liệu, quyền Pages, thu hồi quyền task và mất liên kết khi khôi phục snapshot.

Nhánh kiểm tra: `Fix_bug_ver2.0`, baseline commit `477c3da` cùng các thay đổi cấu hình build/dev đang có. Lượt này chỉ dọn tệp tạm và lập báo cáo, không sửa nghiệp vụ, SDK, env, dependency, lockfile hay deploy lên mạng thực; không commit/push.

## 1. Phạm vi và độ chắc chắn

- **Đã xác nhận:** đọc các nhánh router, kiểm tra quyền, lưu trữ, snapshot/sync, upload, Dashboard, dịch vụ Pages/Intake và contract; chạy bộ test hiện có, 12 phép đối chiếu adapter bằng fixture cách ly, một phép đối chiếu thu hồi quyền trên Hardhat; đọc RPC và HTTP dịch vụ SDK thực.
- **Suy luận cần kiểm thử thêm:** tranh chấp nonce giữa nhiều tab; ghi đè nội dung đang gõ khi Pages fallback chậm; Snooze chưa tự cập nhật theo đồng hồ. Các mục này được tách riêng bên dưới.
- **Giới hạn:** không đọc từng dòng của mọi file trong monorepo, không thao tác hết mọi màn hình và không nghiệm thu cộng tác hai ví/hai máy thật. Không gửi giao dịch, email hoặc pin file thật trong lượt review này. HTTP 200 của trang SDK không chứng minh toàn bộ API iframe hoạt động.

## 2. Đã dọn gì, giữ gì

Đã xóa **4 thư mục kiểm thử cũ**, **14 log/bằng chứng tạm trùng**, tổng **4.271 tệp / 160.346.428 byte**. Trước khi xóa đã kiểm tra không có tiến trình dùng các thư mục đó, tháo riêng ba junction bằng thao tác không đệ quy và xác minh target vẫn còn. Hash các tệp nguồn đã chọn và lockfile không đổi.

Các thư mục đã dọn nằm dưới `tmp`: `cover-live-browser`, `upload-chrome-1793699062877`, `upload-downloads`, `upload-safe-build-1793698688460`. Giữ nguyên thư mục backup migration và các fixture nhỏ chưa kết luận là thừa. Bằng chứng mới được lưu trước khi xóa log trùng.

**17 thay đổi trong ảnh được giữ lại** vì đang phục vụ bản sửa đã kiểm thử:

| Nhóm | Lý do giữ |
| --- | --- |
| [Cấu hình Web](/C:/task-system/plane/apps/web/vite.config.ts), [Router Web](/C:/task-system/plane/apps/web/react-router.config.ts), [cấu hình Spaces](/C:/task-system/plane/apps/space/vite.config.ts), [Router Spaces](/C:/task-system/plane/apps/space/react-router.config.ts) | Nạp env và basename đúng; dev dùng source để tránh mất module khi build dọn dist; Editor có alias riêng. |
| [app-env.mjs](/C:/task-system/plane/scripts/app-env.mjs), [khai báo kiểu](/C:/task-system/plane/scripts/app-env.d.mts) | Dùng chung cách đọc env và guard; khai báo kiểu cần cho TypeScript của các config. |
| [workspace-source-aliases.mjs](/C:/task-system/plane/scripts/workspace-source-aliases.mjs), [khai báo kiểu](/C:/task-system/plane/scripts/workspace-source-aliases.d.mts) | Phân giải đúng 64 export nội bộ, gồm CSS/subpath và package.json. |
| [build-plane.mjs](/C:/task-system/plane/scripts/build-plane.mjs), [guard](/C:/task-system/plane/scripts/check-public-env-secrets.mjs), [chép Spaces](/C:/task-system/plane/scripts/sync-space-build.mjs) | Kiểm tra SDK, build theo thứ tự, giữ guard và xác minh tệp đầu ra. Script chép Spaces vốn đã được package build gọi. |
| [package.json](/C:/task-system/plane/package.json), [turbo.json](/C:/task-system/plane/turbo.json), [.gitignore](/C:/task-system/plane/.gitignore) | Khai báo lệnh build và đầu vào cache; tránh bỏ sót script cần thiết khi lưu thay đổi vào Git sau này. |
| [Test env](/C:/task-system/plane/tests/build-env.test.mjs), [test alias](/C:/task-system/plane/tests/workspace-source-aliases.test.mjs), [hướng dẫn build](/C:/task-system/plane/BUILD_PLANE.md) | Hồi quy đúng các lỗi vừa xử lý và hướng dẫn tái tạo bản build. |

Chi tiết thao tác: [cleanup.json](/C:/task-system/plane/docs/verification/review-plane-2026-11-05/cleanup.json). Các script chẩn đoán mới được lưu cùng bằng chứng; đã dọn thêm chín bản tạm của lượt review. Sau dọn, dev module và CSS trả HTTP 200, hai entry HTML build và dependency roots vẫn còn: [kiểm tra sau dọn](/C:/task-system/plane/docs/verification/review-plane-2026-11-05/post-cleanup-smoke.json).

## 3. Kết quả kiểm tra mới

| Kiểm tra | Kết quả và giới hạn |
| --- | --- |
| Bộ hồi quy DApp và env/alias | **406/406 pass**, không skip. Dùng storage/SDK/network cách ly hoặc mock, không phải 406 thao tác mạng thật. [Log](/C:/task-system/plane/docs/verification/review-plane-2026-11-05/regression.log). |
| Contract | **63 pass** trên Hardhat trong bộ nhớ. Có workspace/member, snapshot, email policy và triển khai/task/KPI cơ bản; không phải kiểm toán đầy đủ mọi hàm TaskManager. [Log](/C:/task-system/plane/docs/verification/review-plane-2026-11-05/contracts.log). |
| TypeScript sau dọn | Services, Web, Spaces đều exit 0. [Kết quả](/C:/task-system/plane/docs/verification/review-plane-2026-11-05/types-exit-codes.json). |
| Build gần nhất | Web/Spaces đã pass trên cùng nguồn nghiệp vụ; worker và 147 tệp Spaces khớp. Lượt review không build lại vì chỉ dọn fixture/log, nguồn và đầu ra build được giữ. Đây vẫn là bản nội bộ dùng cờ chấp nhận khóa công khai. [Log baseline](/C:/task-system/plane/docs/verification/review-plane-2026-11-05/baseline-production-build.log). |
| RPC thực, chỉ đọc | Chain ID **991**; ba địa chỉ được cấu hình có bytecode. TaskManager báo version **2**, workspace policy **3**. Không kết luận cần deploy lại chỉ vì đổi URL node. |
| Dịch vụ SDK dev | Bốn URL bridge/vault/file-processor/wallet trả HTTP **200**. Chưa nghiệm thu giao dịch hay upload qua iframe. |

Thông tin RPC/dịch vụ và protocol production: [runtime-readonly.json](/C:/task-system/plane/docs/verification/review-plane-2026-11-05/runtime-readonly.json). Kết quả Chrome kiểm tra module giao diện/Editor/CSS của lượt sửa trước được giữ làm baseline, không gọi đó là E2E toàn ứng dụng: [browser baseline](/C:/task-system/plane/docs/verification/review-plane-2026-11-05/baseline-browser-modules.json).

## 4. Các vấn đề cần sửa trước — đã tái hiện

P1 ở đây là ưu tiên xử lý quyền, sai dữ liệu và độ bền dữ liệu; không có nghĩa đã quan sát một cuộc tấn công vào hệ thống thật. Các phép thử adapter bên dưới chạy trên dữ liệu bộ nhớ, không sửa dữ liệu của bạn.

| Ưu tiên | Vấn đề đã xác nhận | Bằng chứng và hướng sửa |
| --- | --- | --- |
| **P1 — Pages** | Member khác người tạo đọc và sửa được nội dung Page có `access=1` và `is_locked=true`; cả GET/PATCH trả 200. | [Handler description](/C:/task-system/plane/packages/services/src/dapp/routes.ts:6286) không kiểm tra đầy đủ quyền riêng tư/lock. Áp dụng cùng guard cho đọc, sửa, action và alias; kiểm tra trước mọi mutation. Đây là lỗi thực thi chính sách trong adapter, không phải khẳng định dữ liệu IPFS đã được mã hóa riêng tư. |
| **P1 — phạm vi Cycle** | POST vào Cycle thuộc project A với ID task thuộc project B vẫn trả 200 và đổi Cycle của task B. | [Handler liên kết](/C:/task-system/plane/packages/services/src/dapp/routes.ts:6077) tìm issue theo ID mà chưa kiểm tra đủ phạm vi. Kiểm tra workspace/project/quyền của Cycle và toàn bộ task trước khi thay đổi, kể cả unlink/transfer/archive. |
| **P1 — Search** | Tìm trong workspace rỗng trả task `i-b` thuộc workspace khác đang có trong cache. | [Fallback project](/C:/task-system/plane/packages/services/src/dapp/routes.ts:6659) dùng toàn bộ project khi workspace không có project. Bỏ fallback vượt phạm vi; giới hạn theo workspace, quyền project, private page và tombstone trước khi tìm. |
| **P1 — mất liên kết khi sync** | Gắn task vào Cycle thành công nhưng `updated_at` không đổi. Gộp snapshot trước thao tác làm `cycle_id` trở về null. | [Mutation Cycle](/C:/task-system/plane/packages/services/src/dapp/routes.ts:6086), [LWW](/C:/task-system/plane/packages/services/src/dapp/scope.helper.ts:55). Dùng timestamp đơn điệu/revision cho mọi thay đổi quan hệ, kiểm thử pull snapshot cũ sau add/remove/transfer. Không thay luật merge một cách mù quáng. |
| **P1 — thu hồi quyền task** | Trên Hardhat: xóa member làm role workspace về **0**, nhưng ví vẫn gọi trực tiếp `updateProgress` thành công và đưa task từng được giao lên **100%**. | [Xóa member](/C:/task-system/plane/contracts/PlaneWorkspaceRegistry.sol:481), [quyền update task](/C:/task-system/plane/contracts/PlaneTaskManager.sol:405). TaskManager kiểm tra assignee/admin riêng, chưa gắn quyền này với registry workspace. Cần chốt chính sách và thiết kế scope/thu hồi ở contract; chặn UI riêng không giải quyết lời gọi contract trực tiếp. Thay contract cần kế hoạch ABI/migration/deploy riêng, chưa thực hiện. |
| **P1 — lưu bền vững** | Khi local/session storage bị chặn và IndexedDB không có, PATCH vẫn trả 200, thay đổi chỉ có trong RAM của fixture. | [saveDB](/C:/task-system/plane/packages/services/src/dapp/store.ts:874) không trả trạng thái lưu bền vững cho caller; kết quả [ghi IDB](/C:/task-system/plane/packages/services/src/dapp/indexed-db.ts:67) có thể false nhưng bị bỏ qua. Phân biệt cập nhật RAM, lưu thiết bị và xác nhận chain; báo lỗi/retry/quota rõ ràng. Chỉ kết luận lỗi cho điều kiện storage đã mô phỏng, không nói mọi F5 đều mất dữ liệu. |
| **P2 — Cycles** | Cùng một Cycle: list báo 0 task, progress báo 1; task dùng state ID có thể không được tính đúng nhóm. `date-check` nhận ngày bắt đầu sau ngày kết thúc nhưng trả hợp lệ. | [Date check](/C:/task-system/plane/packages/services/src/dapp/routes.ts:6043), [progress](/C:/task-system/plane/packages/services/src/dapp/routes.ts:6051), [giá trị list](/C:/task-system/plane/packages/services/src/dapp/routes.ts:6944). Tính thống kê từ một tập task chuẩn, resolve state ID qua bảng state, kiểm tra ngày thật. |
| **P2 — Modules** | Xóa task khỏi module trả 200 nhưng GET vẫn trả task đó nếu dữ liệu cũ còn trường `module`. | [Unlink/GET](/C:/task-system/plane/packages/services/src/dapp/routes.ts:6185) xóa `module_ids` nhưng GET còn đọc alias cũ. Chuẩn hóa/migrate quan hệ, cập nhật đồng thời alias cần hỗ trợ và timestamp; dùng cùng tập dữ liệu để đếm. |
| **P2 — Views** | View có bộ lọc priority High vẫn trả task High lẫn Low. | [View issues](/C:/task-system/plane/packages/services/src/dapp/routes.ts:6260) mới giới hạn project, chưa thực thi bộ lọc đã lưu. Dùng chung filter engine với danh sách issue và thống nhất schema filter. |
| **P2 — Pages access/description** | Gửi `{access:0}` trả 200 nhưng Page vẫn private (`1`). Description API trả chuỗi HTML trong khi service yêu cầu ArrayBuffer. | [Access](/C:/task-system/plane/packages/services/src/dapp/routes.ts:6313) kiểm tra truthy; [description](/C:/task-system/plane/packages/services/src/dapp/routes.ts:6286) không khớp [service binary](/C:/task-system/plane/apps/web/core/services/page/project-page.service.ts:151). Kiểm tra giá trị tường minh và thống nhất định dạng Yjs/binary/HTML fallback. |
| **P2 — Intake** | Payload đổi tên nested `issue.name` trả 200 nhưng tên thật vẫn là tên cũ. Tạo Intake mới không sinh `sequence_id` trong fixture. | UI thật gửi payload này qua [Inbox service](/C:/task-system/plane/apps/web/core/services/inbox/inbox-issue.service.ts:64); [PATCH](/C:/task-system/plane/packages/services/src/dapp/routes.ts:6515) chưa áp dụng đủ trường issue. Tách allowlist metadata Inbox và allowlist trường task; thống nhất thời điểm cấp số khi tạo/accept và chống trùng. |
| **P2 — lệnh build** | Hai lối build còn khác nhau: lệnh build gốc chạy Turbo song song, còn `build:plane` có thứ tự Spaces trước Web. Script copy trả exit 0 khi thiếu đầu vào. | [Lệnh gốc](/C:/task-system/plane/package.json:10), [copy](/C:/task-system/plane/scripts/sync-space-build.mjs:11). Cần chọn một luồng phát hành chính thức, fail rõ khi thiếu Spaces, tránh dùng bundle cũ. Hiện nên dùng hướng dẫn build đã kiểm chứng. |

12 phép đối chiếu adapter nằm trong [functional-probes.json](/C:/task-system/plane/docs/verification/review-plane-2026-11-05/functional-probes.json). Chúng là chẩn đoán bổ sung, không được cộng thành các ca “pass” nghiệp vụ. Kết quả contract thu hồi quyền: [contract-revocation-probe.json](/C:/task-system/plane/docs/verification/review-plane-2026-11-05/contract-revocation-probe.json).

Một quan sát cần chốt yêu cầu: Intake pending hiện xuất hiện trong Search. Điều đó đã tái hiện, nhưng việc có nên cho tìm hay không cần thống nhất; riêng vấn đề chưa có sequence và payload bị bỏ qua đã được xác nhận.

## 5. Những rủi ro chưa được kiểm thử đầy đủ

1. **Nhiều tab cùng một ví:** [tx-gateway](/C:/task-system/plane/packages/services/src/dapp/tx-gateway.ts:42) xếp hàng trong một JS runtime. Chưa có bằng chứng khóa chung giữa nhiều tab/origin; chưa tái hiện nonce collision bằng ví thật. Cần thiết kế khóa theo chain/ví và thử nhiều tab trước khi kết luận ổn định.
2. **Pages fallback khi đang gõ:** [fallback](/C:/task-system/plane/apps/web/core/hooks/use-page-fallback.ts:48) chờ fetch rồi nạp document và lưu lại. Có nguy cơ phản hồi cũ thay nội dung mới đang gõ; chưa tái hiện bằng browser với độ trễ có kiểm soát. Cần generation/revision hoặc kiểm tra editor dirty trước khi áp dụng.
3. **Snooze tự hết hạn:** [computed filter](/C:/task-system/plane/apps/web/core/store/inbox/project-inbox.store.ts:157) đọc giờ hiện tại nhưng trong store chưa thấy clock observable/ticker. Nguy cơ không cập nhật nếu không có mutation khác; cần fake clock và browser kiểm tra, chưa gọi là lỗi UI đã tái hiện.
4. **Production HTTPS:** env production hiện là web HTTPS, RPC HTTP, WebSocket WS. Cùng mạng không bỏ giới hạn mixed content của trình duyệt. Đây vẫn là điều kiện phải xử lý khi triển khai server; lượt review không đổi endpoint hoặc cấu hình lead.
5. **Attachment giữa các thiết bị:** [upload thường](/C:/task-system/plane/packages/services/src/file/file-upload.service.ts:129) vẫn lưu byte bằng IndexedDB. Nhánh ảnh presentation có [pin IPFS](/C:/task-system/plane/packages/services/src/file/ipfs-image.ts:23), nhưng không đồng nghĩa mọi attachment đã chia sẻ được giữa hai máy. Cần nghiệm thu yêu cầu đó và triển khai kho byte IPFS tương ứng nếu cần.
6. **Đăng nhập/email:** OTP và credential local không thay thế quyền ví trên chain hay một bằng chứng email độc lập. Không đề xuất thêm database phía dịch vụ trái lựa chọn của bạn. Các khóa public trong bản nội bộ là lựa chọn bạn đã chấp nhận; lượt review không tự đổi cơ chế ký/mail.

## 6. Hiện trạng theo nhóm chức năng

| Nhóm | Đánh giá hiện tại |
| --- | --- |
| Build/dev | Có bản build đạt, dev đã xử lý phụ thuộc dist và có test alias; còn cần hợp nhất lệnh phát hành, nghiệm thu host HTTPS. |
| Workspace/member/ví | Bộ test hiện có và registry local qua; RPC có code/version phù hợp. Chưa nghiệm thu hai ví thật từ đầu đến revoke, và còn vấn đề quyền task sau revoke. |
| Project/task/comment | Có coverage hồi quy cho create, scope, asset và snapshot. Không kết luận mọi action phụ đã bảo vệ đủ; Cycle/Search đã chứng minh còn lỗ hổng phạm vi. |
| Dashboard KPI | Test snapshot, refresh, nguồn local/chain và tính toán hiện có qua. Chưa đối chiếu task/report thật cụ thể của bạn trong lượt này; không khẳng định mọi số trên UI đã đúng. |
| Avatar/cover/logo | Có nhánh IPFS và test policy/bytes; chưa pin/đọc ảnh thật trong đợt review. Tốc độ gateway/CORS cần nghiệm thu thực. |
| Attachment/editor | Test hồi quy qua; giới hạn byte local và chia sẻ hai thiết bị vẫn phải xử lý nếu là yêu cầu sản phẩm. |
| Cycles/Modules/Views/Pages/Intake/Search | **Còn bug đã tái hiện**, chưa nên coi đã hoàn thiện. |
| Đồng bộ/khôi phục | Có kiểm tra snapshot, tombstone và xung đột; còn mất thay đổi quan hệ do timestamp, lỗi storage cần phản hồi và rủi ro giao dịch nhiều tab. |

## 7. Thứ tự sửa đề nghị

1. **Quyền và phạm vi:** tập trung guard đọc/ghi của Pages và action phụ của Cycle/Module/View, Search workspace/project. Viết ca tái hiện trước sửa, bảo đảm yêu cầu sai không đổi bất kỳ dữ liệu nào.
2. **Độ bền dữ liệu:** xử lý kết quả persistence, timestamp/revision của mọi mutation quan hệ và thử snapshot cũ sau thay đổi. Không chỉ làm giao diện trông đúng trước F5.
3. **Quyền task sau revoke:** chốt hợp đồng quyền giữa TaskManager và workspace, thiết kế ABI/migration và kiểm thử contract trước khi cân nhắc deploy. Không tự triển khai trên mạng thật.
4. **Hoàn thiện năm phân hệ:** dùng tập dữ liệu/quan hệ chuẩn cho thống kê Cycle/Module; filter engine cho Views; schema và editor fallback Pages; payload, sequence, accept/snooze Intake. Mỗi phần có test vòng đời, refresh và sai quyền.
5. **Phát hành và nghiệm thu tích hợp:** hợp nhất lệnh build; xử lý transport HTTPS/RPC ở bước server riêng; kiểm thử hai máy/hai ví thật cho mời, sync, comment/file, reload, offline/retry và revoke. Giữ kiến trúc local/IPFS/chain.

Chưa sửa các mục nghiệp vụ trong bảng trên. Kết quả test hiện có đạt là bằng chứng cho phạm vi đã kiểm, không chứng minh các nhánh chẩn đoán bổ sung đã hết lỗi.
