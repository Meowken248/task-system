# Báo cáo triển khai và kiểm chứng Plane — 27/10/2026

Đã deploy **PlaneWorkspaceRegistry policy v2** lên Chain 991, khôi phục workspace `fiai`, kiểm tra receipt/quyền/CID rồi cập nhật cấu hình của ba ứng dụng. Đây là kết quả triển khai thực tế; **chưa phải nghiệm thu hoàn tất toàn bộ hệ thống hoặc toàn bộ 31 mã lỗi**.

Nhánh làm việc `27/10`. Không commit/push; không sửa SDK, dependency hoặc lockfile. Private key người dùng cung cấp chỉ được nhập vào tiến trình ký, không lưu vào mã nguồn, báo cáo hay env.

## 1. Contract và dữ liệu đã triển khai — đã xác nhận

| Thành phần | Địa chỉ sau triển khai | Tác động |
|---|---|---|
| Workspace Registry | `0xe312A421055985cB07CeC73e167B6e11895c9A16` | Deploy mới, policy v2 |
| Task Manager | `0x5E11C911Aa79a7CF8482B07F09565e908f5019C8` | Giữ nguyên contract/dữ liệu |
| Offchain Data Registry | `0x02998Fa5958f7C73bfaB5C6DfBDBB304952Fdaa0` | Giữ nguyên contract/dữ liệu |

Registry nguồn `0x9c20334Bd99ea9e51DC633863D4e7c7e686f8295` được giữ lại. Đối soát cuối tại block **15.739** xác nhận bytecode registry mới trùng artifact đã build, policy bằng **2**, operator đúng ví người dùng cung cấp.

Giao dịch deploy: `0x0cae81a4e8da5b73489d0bdeb7f711294c25f2147f77459f866d973983cd2324`, block **15.694**, receipt **status 1**. Tổng cộng **5 giao dịch thật**: deploy, tạo workspace, khôi phục Admin, tạo lời mời QA và thu hồi lời mời QA. Tất cả receipt status 1. [Journal giao dịch](/C:/task-system/plane/docs/deployments/registry-migration-journal.json).

Dữ liệu `fiai` giữ CID `QmR9DYEf4w17swxvUAeggh6jhiHr8uZTnevT1CZwq98Fcy`; snapshot sao lưu có **164.157 byte**, **1 workspace, 2 dự án, 4 issues, 0 bản ghi attachment**. SHA-256 bản sao khớp metadata. Không suy ra dữ liệu chưa Sync trong trình duyệt cũng đã được chuyển.

Quyền sau khôi phục:

- `0x4eCB82724890c656D09761b617369479c5392d6D`: Owner, role 3, đồng thời là operator.
- `0x55798165960a62cED34a0d86e36B1758D1303907`: Admin, role 2. Nguồn cũ có role Owner thừa; đã chuẩn hóa theo trường owner chính thức trong phương án migration.
- Danh sách mới có đúng 2 thành viên; ví QA không có membership và lời mời QA đã thu hồi.

Đã đọc lại **4/4 task** của snapshot trên Task Manager hiện tại: đều tồn tại. Không backfill hoặc deploy lại Task Manager. Kết quả này không chứng minh mọi thao tác ghi task hoặc các issue chỉ có local đều hết lỗi InvalidTask.

[Bằng chứng đối soát cuối](/C:/task-system/plane/docs/deployments/final-verification.json), [manifest nguồn](/C:/task-system/plane/docs/deployments/workspace-registry-source.json), [metadata sao lưu](/C:/task-system/plane/docs/deployments/workspace-registry-backups.json).

## 2. Cấu hình môi trường — đã xác nhận

Đã điền đồng nhất ba địa chỉ contract và chain ID vào 6 tệp; cập nhật các alias NEXT_PUBLIC tương ứng nếu có:

- [Env gốc](/C:/task-system/plane/.env).
- [Web local](/C:/task-system/plane/apps/web/.env) và [Web production](/C:/task-system/plane/apps/web/.env.production).
- [Space local](/C:/task-system/plane/apps/space/.env) và [Space production](/C:/task-system/plane/apps/space/.env.production).
- [Admin](/C:/task-system/plane/apps/admin/.env).

Cả 6 tệp đều được Git ignore và không được Git track. Địa chỉ deployment mới không được hardcode trong source ứng dụng hoặc script triển khai; script đọc cấu hình từ env. Địa chỉ được ghi trong hồ sơ deployment để đối chiếu lịch sử. [Biên bản cập nhật env](/C:/task-system/plane/docs/deployments/env-cutover.json).

Đã giữ bản cấu hình trước chuyển đổi tại [backup env local](/C:/task-system/plane/tmp/registry-migration/env-before.json), nằm ngoài Git. Không tự quay lại registry cũ sau khi có ghi mới: cần đối chiếu dữ liệu/quyền giữa hai nguồn trước để tránh mất thay đổi.

## 3. Các thay đổi nguồn chính — đã đọc mã và kiểm thử

| Phần | Thay đổi và mục đích |
|---|---|
| Lời mời | Token ngẫu nhiên mật mã 256 bit; payload Base64 cũ không tự cấp quyền; kiểm tra bản ghi thật, workspace, người nhận, ví, role, hạn dùng và thu hồi. Không tự chấp nhận khi login/GET. |
| Membership | Quyền quản trị dựa vào ví ký và role/operator on-chain. Xác minh kết quả contract trước khi cập nhật quyền local; bỏ fallback ký lần hai theo thông báo lỗi. |
| Registry v2 | Ví chỉ join khi có lời mời dành cho chính ví đó; lời mời có hạn, thu hồi và bị tiêu thụ. Bảo vệ Owner, ngăn Admin hạ quyền peer để xóa; danh sách thành viên không trùng sau remove/re-add. |
| Snapshot/IPFS | Không tạo CID giả khi upload lỗi; giữ dirty/con trỏ cũ; xếp hàng upload và ghi CID theo điều kiện base cũ, đọc lại trước khi báo hoàn tất. |
| Task | Chỉ selector/lỗi task đã xác định mới được coi là missing; revert chung, lỗi quyền/RPC và selector chưa biết giữ trạng thái chưa xác định. |
| IndexedDB | Không giữ vĩnh viễn promise mở DB đã lỗi hoặc handle đã đóng; cho phép mở lại sau lỗi/versionchange, chỉ báo lưu sau transaction complete. |
| Chất lượng mã | Sửa các cảnh báo services; giữ nguyên ngưỡng lint. Ngoại lệ lint hẹp có giải thích cho các vòng giao dịch phải tuần tự và thao tác trên bản sao dữ liệu. |

Mã chính: [contract](/C:/task-system/plane/contracts/PlaneWorkspaceRegistry.sol), [router](/C:/task-system/plane/packages/services/src/dapp/routes.ts), [luồng lời mời](/C:/task-system/plane/packages/services/src/dapp/workspace-invitations.ts), [chính sách token](/C:/task-system/plane/packages/services/src/dapp/invitation-policy.ts), [chain](/C:/task-system/plane/packages/services/src/dapp/chain.ts), [IndexedDB](/C:/task-system/plane/packages/services/src/dapp/indexed-db.ts), [phân loại lỗi task](/C:/task-system/plane/apps/web/core/services/blockchain/contract-errors.ts).

## 4. Kiểm thử và giới hạn bằng chứng

| Kiểm tra | Kết quả thực tế |
|---|---|
| Regression DApp/migration/task-error/IndexedDB | **67/67 PASS**; nguồn TypeScript thật, ví/mail/RPC được giả lập |
| Contract và khôi phục dữ liệu | **21/21 PASS**, Hardhat local |
| Typecheck services, web, space, admin | **PASS**, gồm `tsc --noEmit` |
| Build services, web, space, admin | **PASS theo điều kiện nêu dưới** |
| Lint toàn services | **0 warning, 0 error**; ngưỡng 6 không đổi |
| Lint 4 script deployment | **0 warning, 0 error**, deny warnings |
| Lint web | Lệnh **PASS**, nhưng còn **1.083 warnings, 0 errors**; ngưỡng 11.957 không đổi |
| Registry trên Chain 991 | **7/7 kiểm tra QA đạt**; chi tiết phân loại bên dưới |
| Build bundle sau đổi env | Web/Space/Admin chứa địa chỉ mới, không có địa chỉ registry cũ trong JS đã kiểm tra |
| Ứng dụng đang chạy | Web 3000, Admin 3001, Space 3002: HTTP 200; runtime module dùng registry mới |
| Chrome headless | Trang “Sign up - Plane” render 1 form; không có Vite error overlay hoặc application error |
| Whitespace diff | `git diff --check` đạt sau dọn whitespace |

**Điều kiện build:** Web/Space được build với `ALLOW_PUBLIC_SIGNING_SECRETS=true` chỉ trong môi trường tiến trình, theo việc người dùng chấp nhận các khóa hiện có. Cổng prebuild gốc không bị sửa; build chuẩn không có ngoại lệ vẫn bị chặn bởi cấu hình khóa hiện tại. Còn cảnh báo PostCSS/module, sourcemap và chunk. Chưa chạy hoặc tuyên bố root monorepo build đạt.

**QA chain:** tạo và thu hồi lời mời là 2 giao dịch ghi thật. Các kiểm tra cấm join không mời, cấm Member mời, ràng buộc ví, cấm join sau thu hồi, bảo vệ Owner và từ chối CID cũ được đối chiếu qua đọc trạng thái/`eth_call`; không gọi mô phỏng là giao dịch ghi thành công. Chưa test recipient ký join thật qua popup SDK.

**Runtime:** đã khởi động lại ba ứng dụng bằng đúng lệnh pnpm của dự án. Lần thử khởi chạy trực tiếp CLI trước đó gây lỗi phân giải PostCSS; đã xác định thiếu môi trường wrapper pnpm và sửa cách khởi chạy, không thêm dependency. Ba ứng dụng được để chạy để người dùng test. Không restart hay chỉnh sửa SDK.

[Kết quả kiểm tra và hash nguồn](/C:/task-system/plane/docs/deployments/validation-2026-10-27.json), [log regression/contract/lint](/C:/task-system/plane/docs/deployments/regression-tests.log).

## 5. Việc cần test trên giao diện và phần chưa hoàn tất

Sau khi reload [Plane local](http://localhost:3000/plane/), Owner/Admin mời đúng email và ví đích; người nhận mở bằng trình duyệt riêng, chọn đúng ví rồi chấp nhận. Kiểm tra tiếp sai ví, hủy ký, reload giữa chờ giao dịch, thu hồi/mời lại và remove rồi mở link cũ. Không xóa IndexedDB/localStorage để thử nếu còn thay đổi chưa Sync.

Lời mời cũ chưa được ghi vào registry mới cần quản trị viên phát hành lại/gắn ví. Lời mời chỉ có email vẫn chờ quản trị viên xác nhận ví; email tự khai báo không chứng minh quyền sở hữu. Mail thật, login/OTP và toàn bộ luồng popup ví chưa được nghiệm thu trong đợt này.

Các đợt còn mở trong [kế hoạch](/C:/task-system/plane/KE_HOACH_HOAN_THIEN_PLANE_2026-10-27.md): backend xác thực email/session; journal/receipt phục hồi cho mọi luồng task/comment/file; khóa giữa tab và hợp nhất nhiều máy; lưu/khôi phục byte attachment đa máy; hồi quy CRUD, phân quyền dự án và toàn bộ 31 mã lỗi. Không suy ra các phần này đã hoàn tất từ việc deploy registry thành công.

## 6. Dọn dẹp và bàn giao

Đã thay bộ chẩn đoán cũ bằng bằng chứng deployment hiện tại, xóa log/preview lỗi thời, tệp phân tích tạm và hồ sơ Chrome QA. Giữ source, tests, artifact/typechain đúng contract đã deploy, 4 script migration cần để tái lập/đối soát và hồ sơ receipt/manifest/kiểm chứng.

Giữ bản sao snapshot và cấu hình cũ trong thư mục local được ignore để phục hồi; không đưa nội dung backup vào Git. Log điều hành và thông tin tiến trình của ba ứng dụng cũng được giữ local. Không xóa tệp có sẵn chỉ để giảm số lượng Changes.

## 7. Sửa lỗi runtime người dùng báo sau bàn giao — 27/10/2026

**Đã xác nhận trước sửa:** trang Web trả HTTP 500 với lỗi không tải được module types từ dist, dù tệp đã có trở lại lúc kiểm tra. Có hai bộ dev server chạy chồng: bộ cũ do tôi để lại chiếm cổng, bộ `pnpm dev` chạy sau tự chuyển cổng; log build types có bước clean đầu ra. Việc tôi để các server riêng chạy khi người dùng chạy lại dev là thiếu sót trong bàn giao. HTTP 200 và một lượt render trước đó không đủ chứng minh ổn định qua lần rebuild tiếp theo.

**Thay đổi:** thêm alias runtime types sang source trong [Web](/C:/task-system/plane/apps/web/vite.config.ts), [Space](/C:/task-system/plane/apps/space/vite.config.ts) và [Admin](/C:/task-system/plane/apps/admin/vite.config.ts). Như vậy các enum runtime dùng bởi analytics không phụ thuộc tệp dist bị tái tạo. Dừng các tiến trình Plane trùng đã xác minh và khởi động một phiên `pnpm dev` theo dependency graph. Không xóa cache người dùng, không sửa env/dependency/SDK/contract.

Kiểm tra trình duyệt còn phát hiện manifest Admin dùng đường dẫn gốc không phù hợp base path. Đã dùng base URL hiện tại cho [liên kết manifest](/C:/task-system/plane/apps/admin/app/root.tsx) và dùng đường dẫn icon tương đối trong [manifest](/C:/task-system/plane/apps/admin/public/site.webmanifest.json).

**Kết quả kiểm chứng sau sửa:**

- Typecheck và build lại Web, Space, Admin đều PASS. Web/Space vẫn dùng ngoại lệ khóa chỉ trong tiến trình như mục 4.
- Chạy build types có clean trong khi liên tục tải trang và module analytics: **36/36 HTTP 200**, không có tham chiếu types/dist trong module đã kiểm tra.
- Chrome với hồ sơ QA riêng: cả ba ứng dụng render 1 form; import analytics trả 8 trường overview; không có Vite overlay, application error, HTTP lỗi local, request local thất bại hoặc JavaScript exception chưa xử lý. Chỉ kiểm tra trang vào chưa đăng nhập; không mở ví/ký giao dịch.
- Bundle mới của cả ba ứng dụng vẫn chứa registry mới và không có địa chỉ registry cũ.
- Lint component Admin có **3 cảnh báo import font có sẵn, 0 lỗi**; đối chiếu các dòng với HEAD cho thấy chúng không thay đổi. Lệnh strict lint không đạt vì các cảnh báo này. Project bỏ qua cấu hình Vite trong lint; không lấy kết quả “0 files” làm bằng chứng đã lint sạch.
- `git diff --check` đạt. Giữ một phiên dev, Web 3000 / Admin 3001 / Space 3002; không có bộ frontend thứ hai chiếm cổng 3003–3004.

[Bằng chứng Chrome](/C:/task-system/plane/docs/deployments/runtime-browser-fix-2026-10-27.json), [bằng chứng rebuild](/C:/task-system/plane/docs/deployments/runtime-rebuild-fix-2026-10-27.json), [kiểm tra cập nhật](/C:/task-system/plane/docs/deployments/validation-2026-10-27.json). Tệp và hồ sơ Chrome QA tạm được dọn sau khi lưu bằng chứng; log/định danh phiên dev đang chạy được giữ local.

Phát hiện riêng: tiến trình live trong root dev log lỗi kết nối Redis ở cấu hình hiện có. Không tự cài/chạy Redis hoặc sửa hạ tầng trong phạm vi sửa lỗi tải module. Không tuyên bố toàn bộ dịch vụ root dev đều khỏe chỉ từ việc ba giao diện hoạt động.

## 8. Bộ đếm Members ghi 3 nhưng bảng chỉ có 1 dòng — 27/10/2026

**Nguyên nhân đã xác nhận trong mã và snapshot:** phép đếm cũ cộng riêng hồ sơ Owner theo email/ID, các bản ghi ví và cả lời mời accepted. Cùng một Owner xuất hiện dưới hồ sơ người dùng và ví nên có thể bị đếm hai lần. Snapshot hiện tại có 5 bản ghi membership, gồm các bản trùng dưới UUID workspace và khóa legacy. Bộ đếm MobX trước đây còn tính cả membership thiếu hồ sơ hoặc inactive, trong khi bảng lọc chúng. Chưa đọc bộ lọc và storage trong trình duyệt đang đăng nhập của người dùng; không khẳng định đó là nguyên nhân duy nhất khiến chính phiên đó chỉ có một dòng.

**Đối soát thật:** tại block 15.775, contract có đúng 2 ví: Owner `0x4eCB82724890c656D09761b617369479c5392d6D` (role 3), Admin cũ `0x55798165960a62cED34a0d86e36B1758D1303907` (role 2). Địa chỉ Admin này được giữ từ migration, không phải ví QA mới. CID đã được ứng dụng cập nhật sau deployment; kiểm tra lần này dùng CID hiện hành, không giả định CID migration vẫn là mới nhất.

**Đã sửa:** dùng [một projection danh sách thành viên](/C:/task-system/plane/packages/services/src/dapp/workspace-members.ts) cho bộ đếm và API danh sách. Gộp hồ sơ/ví và các bản trùng theo danh tính; không cộng invitations; loại bản inactive, pending, chưa xác nhận, removed và bot. Ví chưa có hồ sơ email vẫn có một dòng theo địa chỉ đầy đủ, không tạo email giả. Role vừa đọc từ chain được ưu tiên hơn bản cache cũ. [Store giao diện](/C:/task-system/plane/apps/web/core/store/member/workspace/workspace-member.store.ts) tính cùng tập dữ liệu render được; [sidebar](/C:/task-system/plane/apps/web/core/components/workspace/sidebar/dropdown-item.tsx) giữ đúng số 0 khi đã tải thay vì ép tối thiểu 1.

Kết quả:

- **83/83 regression PASS**, gồm count/API đồng nhất, vai trò chain, pending/accepted/inactive, tombstone, bot, trùng Owner/ví và không sửa input.
- Services typecheck/build PASS; lint **0 warning, 0 error**. Web typecheck/build PASS, build vẫn dùng ngoại lệ khóa chỉ trong tiến trình.
- Chrome chạy store MobX thật bằng fixture riêng: 2 thành viên → 2 dòng → tổng 2; 1 → 1 → 1; 0 → 0 → 0. Không thao tác storage/phiên đăng nhập của người dùng.
- Bản sao snapshot hiện hành + **6 RPC eth_call thật**: count trước GET = **2**, API trả **2**, count sau GET = **2**; hai dòng đều có quyền UI Admin tương ứng Owner/Admin on-chain. Harness chặn ghi ngoài, số lần thử ghi = **0**. Không đổi quyền, không deploy hoặc ký giao dịch trong lượt sửa này.
- `git diff --check` đạt. Giữ log/bằng chứng, dọn harness và hồ sơ Chrome tạm sau kiểm tra.

[Bằng chứng API/snapshot](/C:/task-system/plane/docs/deployments/member-count-verification-2026-10-27.json), [bằng chứng MobX trên Chrome](/C:/task-system/plane/docs/deployments/member-count-browser-2026-10-27.json). Sau khi reload, kỳ vọng hiển thị đúng 2 ví theo quyền hiện tại. Nếu mục tiêu chỉ giữ một ví, cần một thao tác thu hồi quyền Admin cũ được người dùng chỉ định; không sửa dữ liệu đếm để che quyền còn tồn tại trên contract.

## 9. Sửa luồng Sync khi Pinata chậm — 27/10/2026

Đã thay timeout upload 8 giây bằng chính sách có ngân sách: 45 giây/lần, tối đa 2 lần và 90 giây HTTP/tác vụ; chỉ thử lại lỗi tạm thời, giữ Retry-After. Có coalescing upload trùng, cooldown nền 30 giây, nâng ưu tiên Sync chủ động cho tác vụ đang chờ, checkpoint local, bảo vệ edit mới và marker dirty qua reload. Nút Sync chặn bấm lặp bằng ref; trình bày tiến độ và lỗi lưu trữ riêng với lỗi ví. GET membership không còn đổi timestamp/save DB khi dữ liệu giữ nguyên.

**Đã kiểm chứng:** 126/126 regression; services/Web typecheck và build; services lint và UI/Worker lint 0 warning, 0 error; 10/10 Worker tests chạy trên artifact JavaScript biên dịch. Web build giữ điều kiện ngoại lệ khóa trong tiến trình, không thay chính sách build. Chrome QA kiểm tra module/component thật với HTTP fixture; chưa thao tác ví thật của người dùng.

**Live storage:** marker công khai 45 byte upload bằng module mới trong 2.825 ms, CID đọc lại khớp qua gateway Pinata. Không gửi snapshot tài khoản của người dùng; không ký giao dịch trong lượt này. Một số gateway khác không truy xuất được marker ở lần dò này, nên không coi toàn bộ hạ tầng là đã khỏe.

**Worker chờ duyệt:** đã chuẩn bị source/module mới có giới hạn byte UTF-8 mặc định 2 MiB, upstream timeout 40 giây và lỗi có mã an toàn; giữ JWT trong binding server. Có module rollback từ source nguyên bản và manifest SHA-256. Worker Cloudflare đang chạy **chưa được cập nhật**; việc deploy cần người dùng đồng ý theo Quy tắc 2 về thay đổi hạ tầng. Chưa kiểm tra quyền truy cập Cloudflare và không cài thêm công cụ/dependency để tự deploy.

[Chi tiết, artifact và kế hoạch rollout](/C:/task-system/plane/docs/deployments/STORAGE_ROLLOUT_2026-10-27.md), [bằng chứng chất lượng](/C:/task-system/plane/docs/deployments/storage-validation-2026-10-27.json). Giữ lại bằng chứng/artifact cần bàn giao, dọn harness, hồ sơ Chrome và log tạm. Không commit/push, không sửa SDK, không thay env thật hoặc lockfile.
