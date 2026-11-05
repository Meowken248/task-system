# Sửa các lỗi đã chọn của Cycles, Modules, Views, Pages và Intake — 05/11/2026

Baseline: `a9d228e`, nhánh `Fix_bug_ver2.0`. Phạm vi là các lỗi thống kê/ngày Cycle, unlink Module, bộ lọc View, chuyển quyền Pages, cập nhật tên/cấp số Intake mà người dùng yêu cầu sửa trước. Không thay SDK, contract, env, dependency, lockfile; không deploy, commit hoặc push.

## Thay đổi đã thực hiện

| Phần | Kết quả |
| --- | --- |
| **Cycles** | List, detail và progress dùng cùng tập task đang hoạt động; resolve state ID qua bảng state, loại triage/draft/archived/tombstone. Không giữ progress snapshot thống kê cũ. Ngày phải hợp lệ, đủ cặp, không đảo và không trùng Cycle khác cùng project; bỏ qua chính Cycle đang sửa. Draft không có cả hai ngày vẫn hợp lệ. Kiểm tra lại ngay lúc ghi để hai POST đồng thời không vượt preflight trong cùng runtime. Ngày kết thúc được tính hết ngày theo timezone project. Form dùng đúng project vừa chọn, hiện lỗi cụ thể, không đóng form khi ghi thất bại; sidebar chờ kết quả ghi trước khi báo thành công. |
| **Modules** | Dùng cùng quan hệ chuẩn khi đọc/đếm/ghi; unlink cập nhật `module_ids`, `modules` và trường legacy `module`, gồm dữ liệu đọc dạng object. Giữ các membership khác. Các batch thêm và endpoint sửa membership của một issue kiểm tra scope trước ghi. Timestamp đơn điệu giúp snapshot cũ không làm sống lại quan hệ đã thay đổi. |
| **Views** | Thực thi filter legacy từ query/query_data và filter JSON mà màn View thực gửi tới danh sách issue. Hỗ trợ AND, exact/in/range và AST condition/group hiện có trong mã nguồn. Không âm thầm bỏ filter không hỗ trợ: trả 400. Xóa bộ lọc mới cũng xóa alias cũ để không tự bật lại sau reload. Endpoint danh sách Cycle/Module/View dùng filter và trả envelope có group/subgroup cho store giao diện. |
| **Pages** | Đổi private/public nhận đúng cả `0` và `1`, từ chối boolean/string/giá trị khác. Kiểm tra project/workspace và quyền chủ sở hữu hoặc admin trước khi đổi; áp dụng cả action và generic PATCH. Không cho đổi scope/chủ sở hữu kèm thao tác đổi quyền. Timestamp cập nhật đơn điệu. Đây là sửa chuyển visibility, chưa phải sửa toàn bộ quyền đọc/ghi nội dung Page. |
| **Intake** | Áp dụng payload nested mà service thật gửi, gồm name/description/priority/state và các trường được cho phép. Kiểm tra trước các liên kết và assignee; giữ identity/scope/sequence bất biến trong PATCH. Intake mới và issue thường dùng chung allocator theo project. Backfill số cho dữ liệu thiếu; giữ high-water mark của project qua snapshot để không dùng lại số cao đã cấp trong các tình huống kiểm thử. Accept giữ nguyên số. |

Đã bổ sung làm mới cache thống kê của Cycle/Module khi thêm, gỡ, chuyển quan hệ từ các màn issue; việc đọc thống kê lỗi không bị hiểu nhầm thành ghi membership thất bại để rollback một thao tác đã được chấp nhận.

Logic dùng chung nằm ở [planning-resources.ts](/C:/task-system/plane/packages/services/src/dapp/planning-resources.ts). Các nhánh handler cũ trùng chức năng được gỡ khỏi [router](/C:/task-system/plane/packages/services/src/dapp/routes.ts). [Merge snapshot project](/C:/task-system/plane/packages/services/src/dapp/chain.ts) giữ watermark cấp số lớn nhất độc lập với phiên bản metadata project thắng merge.

## Bằng chứng kiểm thử

| Kiểm tra | Kết quả thực tế |
| --- | --- |
| Trước sửa | 13 ca tái hiện ban đầu đều thất bại. [Log trước sửa](/C:/task-system/plane/docs/verification/planning-resources-2026-11-05/before.log). |
| Hồi quy cuối | **429/429 pass**, không skip. Gồm 23 ca mới cho phạm vi này; phần còn lại là DApp/env/alias hiện có. [Log](/C:/task-system/plane/docs/verification/planning-resources-2026-11-05/regression.log). |
| Chrome fixture | **8 kiểm tra thao tác + 4 kiểm tra sau reload** qua. Dùng service/Axios/interceptor/router thật, các method thật của BaseIssuesStore và cache root-store cách ly. Xác minh cập nhật số không cần F5, filter JSON qua Axios, đổi Pages, sửa Intake và giữ dữ liệu sau reload. **0 request bên ngoài, 0 uncaught exception.** [Kết quả](/C:/task-system/plane/docs/verification/planning-resources-2026-11-05/browser.json). |
| TypeScript | Services, Web, Spaces đều exit 0. Web được kiểm tra lại sau chỉnh project của form. [Kết quả](/C:/task-system/plane/docs/verification/planning-resources-2026-11-05/types.json). |
| Build production | Web và Spaces pass; wallet worker và **147 tệp Spaces** khớp bản vừa build. Dùng cờ chấp nhận khóa public của bản nội bộ đã thống nhất. [Log build](/C:/task-system/plane/docs/verification/planning-resources-2026-11-05/production-build.log). |
| Dev sau build | Module nghiệp vụ mới và module giao diện lỗi đều HTTP 200; Banner vẫn dùng source, không quay lại phụ thuộc dist. [Smoke](/C:/task-system/plane/docs/verification/planning-resources-2026-11-05/dev-smoke.json). |
| Lint trong phạm vi | Module/test mới: 0 warning, 0 error. Bốn file component/store được kiểm tra: 0 error, còn 18 warning. Không tuyên bố lint toàn monorepo sạch. [Lint mới](/C:/task-system/plane/docs/verification/planning-resources-2026-11-05/lint-new.log), [lint giao diện](/C:/task-system/plane/docs/verification/planning-resources-2026-11-05/lint-web.log). |

Các ca mới kiểm tra: trạng thái theo ID; loại bản ghi ẩn; list/detail/progress đồng nhất; ngày đảo/sai/trùng/self; ghi trực tiếp không qua preflight; POST đồng thời; legacy Module aliases và giữ membership khác; batch sai project không ghi dở; restore snapshot cũ; filter legacy/rich/AST/date range; filter không hợp lệ trên tập rỗng; group/subgroup UI; xóa filter qua reload; Page access=0, quyền/scope/generic PATCH; nested Intake patch, numbering đồng thời, backfill dữ liệu cũ và watermark sau snapshot.

Các bài Chrome dùng dữ liệu seed và root-store adapter cách ly. Chúng không phải E2E đăng nhập và thao tác mọi React dialog trên dữ liệu thật. Không gửi email, pin IPFS, ký hay ghi on-chain trong bài Chrome. Bộ test Node mock storage/network; không thay thế nghiệm thu cộng tác thực tế.

## Cách kiểm tra lại

```powershell
node --experimental-transform-types --import ./tests/dapp/register.mjs --test tests/dapp/planning-resources.test.mjs
node tests/browser/planning-resources.mjs
```

Browser test tự tạo và dọn profile/bundle tạm riêng, không dùng profile Chrome đang đăng nhập. Cần Chrome và dependency đã cài trong dự án, không cần cài thêm thư viện. Lệnh build lại giữ theo [hướng dẫn build](/C:/task-system/plane/BUILD_PLANE.md).

Trên giao diện và dữ liệu thật, F5 rồi thử:

1. Tạo/sửa Cycle; thử khoảng ngày hợp lệ, bị đảo và trùng. So list/detail với task Started/Completed; chuyển task giữa hai Cycle rồi đối chiếu số ngay và sau reload.
2. Một task thuộc hai Module: gỡ một Module, giữ Module còn lại; thử từ trang Module và trang issue, sau đó F5/sync lại.
3. View lọc High + state/date; đối chiếu task thực, chuyển group, xóa filter rồi F5.
4. Chủ sở hữu đổi Page private → public → private và F5; member khác thử đổi visibility phải bị từ chối nếu không có quyền quản trị.
5. Tạo nhiều Intake, sửa tên/mô tả/ưu tiên, accept và F5; mã phải có ngay, giữ nguyên khi accept, tiếp tục thứ tự của issue thường trong cùng project.

## Giới hạn và việc vẫn còn

- **Chưa nghiệm thu các thao tác trên bằng hai ví/hai máy thật**, SDK thực hoặc bản deploy của lead. Build vẫn có cảnh báo PostCSS/sourcemap/chunk; cờ build nội bộ không phải đã loại bỏ khóa public.
- Cấp số đồng thời đã kiểm tra trong **một runtime** và qua snapshot merge, không phải allocator phân tán trên chain. Hai thiết bị offline tự tạo cùng lúc vẫn cần thiết kế giải quyết xung đột; không khẳng định đã bảo đảm unique sequence toàn mạng.
- Các mục khác trong [review ban đầu](/C:/task-system/plane/REVIEW_PLANE_2026-11-05.md) vẫn cần xử lý riêng: quyền đọc/sửa nội dung Pages riêng tư/locked; định dạng binary và race fallback Pages; Search vượt workspace; thu hồi quyền task trong contract; phản hồi khi storage không lưu bền vững; nhiều tab cùng ký; transport HTTPS/RPC và attachment giữa thiết bị.
- Các endpoint analytics placeholder, đầy đủ lifecycle archive/restore/move và việc Snooze tự hết hạn chưa được tuyên bố hoàn thiện trong đợt sửa các lỗi đã chọn này.

Không xóa/reset dữ liệu hoặc ví của người dùng. Chỉ dọn các log/profile thử tạm sau khi giữ bằng chứng cần thiết; giữ source và test hồi quy để có thể review/chạy lại.
