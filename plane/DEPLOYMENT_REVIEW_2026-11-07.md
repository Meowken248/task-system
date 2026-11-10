# Plane — deploy mới hoàn toàn và review ngày 07/11/2026

## Phạm vi đã được xác nhận

Người dùng yêu cầu deploy, điền địa chỉ contract và chọn **bắt đầu mới tất cả hoàn toàn**. Đã deploy bộ ba mới trên RPC/chain lấy từ env hiện tại, chain ID 991; không migrate 4 task V2. Không reset node blockchain hoặc kho ví SDK. Không commit/push, sửa SDK, dependency/lockfile hay cấu hình server.

## Contract đã có receipt thành công

| Contract | Địa chỉ mới | Block |
| --- | --- | --- |
| PlaneWorkspaceRegistry | `0x9159762c5a6dc90fBE088aAF0cc8994C3c5269b4` | 5576 |
| OffchainDataRegistry | `0x9f011ae580C77DEe026934cCfd2e54E739A2d423` | 5577 |
| PlaneTaskManagerV3 | `0x29b4c5F925eC2361f0fE09776608CB5CfA77Ab99` | 5578 |

Khởi tạo workspace `fiai` ở block 5579. Ví deploy/owner: `0x4eCB82724890c656D09761b617369479c5392d6D`. Có đúng 4 giao dịch deploy/khởi tạo, nonce 20–23, đều `status=1`. Hash được lưu trước broadcast trong journal để kiểm tra khi mất phản hồi; không lưu khóa hoặc raw signed transaction.

Journal công khai để đối chiếu receipt: [deployment.json](docs/verification/fresh-v3-2026-11-07/deployment.json).

## Review trạng thái trên RPC thật

- Runtime bytecode cả ba contract khớp artifact compiler. TaskManager V3 đã đối chiếu cả các vị trí immutable của địa chỉ registry.
- TaskManager trả version 3; workspace policy version 3; owner/admin đúng ví deploy; immutable registry đúng địa chỉ mới.
- Workspace `fiai` có owner role 3, CID khởi tạo rỗng; danh sách workspace của owner chỉ có `fiai` tại thời điểm xác minh.
- `taskCount=0`, CID người dùng trong OffchainDataRegistry rỗng tại thời điểm xác minh. Không gửi transaction tạo task thử.
- RPC thật từ chối tạo task không có workspace bằng `WorkspaceRequired` và từ chối caller không có membership bằng `Unauthorized`.
- **Giới hạn mô phỏng:** khi `eth_call` đi vào nhánh ghi storage hợp lệ, node trả ABI `Error(string)` với chuỗi chính xác `Cant store stack from read only call`. Kết quả được ghi là `ownerCreateSimulationPassed=false`, `ownerCreateSimulationUnsupported=true`; không coi đây là giao dịch tạo task đã thành công. Các getter và receipt deploy được xác minh độc lập. Chưa kiểm thử gửi báo cáo/task qua SDK wallet thật.

## Env và dữ liệu local

Đã cập nhật địa chỉ mới trong 5 tệp: `.env`, `apps/web/.env`, `apps/web/.env.production`, `apps/space/.env`, `apps/space/.env.production`. Giữ nguyên RPC/WS và các cấu hình khác. Nếu có alias `NEXT_PUBLIC_REGISTRY_CONTRACT_ADDRESS`, đã đồng bộ với OffchainDataRegistry mới. Không hardcode giá trị env mới vào mã chạy ứng dụng.

Mỗi env có thêm `VITE_DAPP_DEPLOYMENT_ID` được suy ra từ bộ địa chỉ mới và genesis, dùng chung cho Web/Spaces. Không tự thay ID này mỗi lần build:

- Khi trình duyệt chuyển sang deployment này lần đầu, bỏ state/cache/cookie do Plane quản lý, gồm login/credentials Plane cũ; giữ lựa chọn ví và dữ liệu SDK/Vault.
- Snapshot có `_deployment_id`; snapshot local/IPFS thiếu ID hoặc khác ID không được phục hồi vào deployment mới.
- Dùng IndexedDB và BroadcastChannel riêng theo ID. F5 trong cùng deployment giữ dữ liệu mới, không reset lại mỗi lần.
- Contract và IDB cũ có thể còn tồn tại để tra cứu, không được dùng làm nguồn phục hồi cho deployment mới. Đây không phải xóa lịch sử blockchain hoặc xóa dữ liệu SDK.

## Kiểm thử và build

- 512/512 regression DApp/build-env/source-alias pass sau bổ sung deployment/env/bytecode/epoch tests.
- 67 ca Hardhat pass trên network local; không tính thành giao dịch thật.
- TypeScript services/web/space/editor đạt. Lượt typecheck Web ban đầu trùng lúc services rebuild `dist` nên lỗi resolve module; chạy lại theo thứ tự đã đạt.
- Chromium runtime đạt 6 kiểm tra, gồm chuyển epoch, cache/cookie cũ, IndexedDB thật, retry/F5, Web Locks và Yjs. Dữ liệu test cô lập; không sử dụng kho trình duyệt người dùng.
- Lần nhập khóa đầu sai định dạng đã dừng trước khi ký, journal chưa có giao dịch; tiếp tục từ journal, không deploy trùng. Khóa không ghi ra file hoặc output.
- Build lại đầy đủ exit 0, wallet worker hash đúng và 147 tệp Spaces khớp. Thư mục giao: `apps/web/build/client` (833 tệp, mount `/plane/`, gồm Spaces).
- Quét JavaScript cả Web/Spaces: có đủ ba địa chỉ mới và deployment ID, không còn địa chỉ contract cũ; không có file `.env` trong bundle. Hash artifact: [build-artifact.json](docs/verification/fresh-v3-2026-11-07/build-artifact.json).
- 22/22 ca Chromium UI trên chính bundle mới pass, gồm attachment/editor, ảnh profile/logo, preset, tạo project/F5 và OTP retry. SDK/RPC/Pinata/mail trong lượt UI này đều giả lập; không có giao dịch hoặc upload thật.
- Tích hợp service/router với **RPC thật mới** đã xác minh owner role 20, project trống và ví ngoài workspace bị từ chối 403. Login/storage của bài kiểm tra là fixture trong RAM, không đăng nhập vào trình duyệt người dùng và không thay thế kiểm thử SDK wallet thật. Kết quả: [live-service-read.json](docs/verification/fresh-v3-2026-11-07/live-service-read.json).

Log và bằng chứng cuối nằm trong `docs/verification/fresh-v3-2026-11-07/`; `docs/` vẫn bị Git ignore theo cấu hình có sẵn. Chỉ thêm ngoại lệ `.gitignore` cho hai script deploy/verify mới để chúng có thể được review cùng mã nguồn; các env thật vẫn bị ignore. Các script deploy legacy V2 không được chạy trong đợt này; quy trình mới là `scripts/deploy-fresh-v3.mjs`, có dry-run và resume bằng journal.

## Khi mở lại Plane

Khởi động lại dev server để nạp env mới, đóng các tab Plane đang chạy bundle cũ rồi mở lại `/plane/`. Đợt mới không giữ tài khoản/dự án/task/báo cáo Plane cũ; kết nối lại ví hiện có để truy cập workspace mới. Không cần xóa hoặc import lại kho ví SDK.

Phần server Lead vẫn cần kiểm HTTPS RPC/WSS hoặc proxy, SPA fallback và dịch vụ SDK/gateway thật. Deploy thành công không chứng minh các dịch vụ này hoạt động ở mọi origin. Build nội bộ vẫn dùng lựa chọn signing secret hiện có đã được người dùng chấp nhận; không tuyên bố đây là bản public đã loại bỏ secret.
