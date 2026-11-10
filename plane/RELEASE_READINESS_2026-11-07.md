# Plane — nghiệm thu sửa lỗi trước build, 07/11/2026

> Cập nhật sau báo cáo này: người dùng đã yêu cầu và xác nhận deploy mới hoàn toàn. Xem trạng thái triển khai hiện tại tại [DEPLOYMENT_REVIEW_2026-11-07.md](DEPLOYMENT_REVIEW_2026-11-07.md). Các đoạn “chưa deploy” bên dưới là kết quả của giai đoạn trước deploy.

## Phạm vi và kết luận hiện tại

Đã sửa mã nguồn cho lưu bền trên thiết bị, tệp attachment/editor dùng IPFS, Pages binary/fallback, khóa giao dịch giữa các tab và contract task kiểm tra membership. Chưa thể kết luận mọi chức năng production không có lỗi: contract V3 chưa deploy; dịch vụ thật và transport HTTPS/WSS chưa được nghiệm thu trong phiên này.

Baseline: commit `5f7a641`, working tree sạch trước phiên sửa. Nhánh kiểm tra khi kết thúc là `Fix_bug_ver3.0`, HEAD vẫn `5f7a641`. Không commit/push, deploy, gửi giao dịch, email hoặc pin dữ liệu thật. Không sửa SDK, dependency/lockfile, `.env` hay hạ tầng.

## Những thay đổi đã thực hiện

1. **Lưu dữ liệu:** `saveDB()` trả acknowledgement. Chỉ full snapshot trong localStorage hoặc transaction IndexedDB hoàn tất mới được coi là lưu bền; sessionStorage/RAM không đủ. Có timeout, ghi IDB tuần tự, retry, cảnh báo khi rời trang và trạng thái trên nút Sync. Mutation qua DApp router trả `503 LOCAL_PERSISTENCE_FAILED`, `updated_in_memory=true` khi lưu thất bại; giữ dữ liệu RAM cho người dùng phục hồi. Khi gặp lỗi này, giữ trang mở và dùng Sync để lưu lại, tránh gửi lại thao tác tạo vì bản ghi có thể đã tồn tại trong RAM.
2. **Attachment/editor:** mặc định dùng proxy Pinata hiện có, theo xác nhận của người dùng. Tệp được chia chunk JSON tối đa 512 KiB, manifest riêng, giới hạn tệp 5 MiB, tối đa 3 chunk đồng thời, timeout toàn thao tác 60 giây, đọc JSON giới hạn 800 KB và xác minh SHA-256 từng chunk/toàn tệp. Chỉ xác nhận sau khi đọc lại đúng byte. Snapshot giữ CID/hash; duplicate giữ CID; xóa metadata không đòi có cache local và không unpin CID đang được nơi khác dùng. Luồng đọc/xóa tệp local cũ vẫn được giữ. Không tự chuyển toàn bộ tệp cũ sang IPFS. Người có CID có thể đọc nội dung; đây không phải lưu trữ tệp riêng tư được mã hóa.
3. **Phiên upload:** kiểm tra user/ví xuyên suốt upload và sau các lần chờ quyền/network trước khi xác nhận metadata. Hủy, đổi ví hoặc xóa asset trong lúc xác nhận không được báo upload thành công.
4. **Pages:** endpoint description trả ArrayBuffer từ binary base64, giữ HTML cũ để phục hồi legacy. Fallback kiểm revision/nội dung/editor/page trước khi hydrate; kết quả fetch chậm không ghi đè nội dung đang gõ. Có thông báo lỗi lưu thay vì chỉ log console.
5. **Giao dịch nhiều tab:** module queue kết hợp Web Locks origin-wide. Chờ lock tối đa 120 giây; trình duyệt thiếu Web Locks dừng trước khi gửi và hướng dẫn dùng HTTPS/localhost/trình duyệt phù hợp. Phạm vi khóa là cùng origin và browser; không khóa được máy, browser hoặc origin khác.
6. **Task V3:** contract mới buộc root task gắn workspace, child kế thừa workspace, người ghi và assignee phải còn membership. Các kiểm tra quyền creator/assignee/admin sẵn có vẫn áp dụng sau membership gate. Client nhận biết phiên bản, dùng ABI tạo task có workspace cho V3 và đối chiếu workspace của task cha. V2 tiếp tục tương thích; sửa source không nâng cấp địa chỉ V2 đã deploy. Generic `updateDAppRecord` legacy không được dùng làm nguồn quyền/task và không nằm trong cơ chế membership mới.

## Bằng chứng kiểm thử

| Kiểm tra | Kết quả đã xác nhận | Bằng chứng |
| --- | --- | --- |
| Regression DApp/build-env/source-alias | 503/503 pass trên dist mới build, gồm 4 ca client V2/V3 | `tmp/release-final-regression.log` |
| Hardhat trên network local | 67 pass, gồm revoke/re-add, cached admin, assignee ngoài workspace và child | `tmp/release-contract-tests.log` |
| TypeScript services/web/editor/space | Exit 0 | `tmp/release-*-types.log` |
| Chromium runtime thật | 5 kiểm tra pass: localStorage mô phỏng quota, lỗi hai store/retry, native locks giữa iframe, Yjs typing/binary, IDB thật sau F5 | `docs/verification/release-readiness-2026-11-07/runtime/browser.json` |
| Chromium Pages/Search | 8 kiểm tra + 2 sau reload pass | `docs/verification/release-readiness-2026-11-07/pages-and-search/browser.json` |
| Chromium năm phân hệ | 8 kiểm tra + 4 sau reload pass | `docs/verification/release-readiness-2026-11-07/planning-resources/browser.json` |
| Chromium trên bundle vừa build | 22/22 pass: attachment, editor, profile/logo, ảnh mẫu, tạo project và lỗi/retry OTP | `docs/verification/release-readiness-2026-11-07/built-app-complete/browser-validation.json` |

Các fixture cô lập dữ liệu, chặn mạng ngoài hoặc giả lập proxy/SDK/RPC. Không dùng dữ liệu hoặc ví thực để chứng minh giao dịch thành công. Chromium runtime dùng Yjs thật để kiểm race của helper. Client V3 được kiểm tra root/child/workspace sai/scope thiếu và tương thích V2 bằng SDK giả lập; Hardhat kiểm enforcement contract riêng. Chưa có E2E giữa client và V3 được deploy trên node thật.

Lượt regression đầu có 12 ca upload thất bại vì fixture/expectation cũ còn giả định lưu local. Đã bổ sung JSON IPFS fixture và giữ các ca legacy tường minh; lượt sau đạt 499/499 trước khi bổ sung 4 ca client. Lượt typecheck đầu phát hiện kiểu binary/page ID và import alias chưa đúng; đã sửa và chạy lại.

Sau đó thêm 4 ca client V2/V3 và chạy đủ lại: 503/503 pass. Lượt UI bundle đầu dừng bởi CDP xử lý một request đã hủy; chỉ phân loại hủy khi `Network.loadingFailed` xác nhận đúng request. Lượt tiếp theo phát hiện static server test thiếu MIME JPEG, khiến helper từ chối ảnh mẫu đúng theo kiểm tra loại tệp. Đã sửa harness và chạy lại toàn bộ 22 ca đạt; không bỏ qua các assertion về pinning, byte tải về hay lỗi UI. Kết quả cuối `issues=[]`, `realTransactionsSent=0`, `assetProxyRequests=0`; mọi pin và email trong fixture đều giả lập.

## Build và phần còn phải nghiệm thu

`pnpm run build:plane` đã hoàn tất exit 0: Spaces và Web đều được build mới, HTML được tạo, hash wallet worker đúng, 147 tệp Spaces khớp bản gốc. Log: `tmp/release-production-build.log`. Artifact: `apps/web/build/client`, 833 tệp, basename `/plane`, có `spaces/index.html`; hash/số đo lưu tại `docs/verification/release-readiness-2026-11-07/build-artifact.json`.

Build sử dụng opt-in nội bộ đã được chấp thuận trong phiên, chỉ đặt ở process rồi phục hồi; không phải bản đã loại bỏ signing secret khỏi JavaScript. Không đính kèm `.env` vào artifact.

Bundle lớn nhất của Web: `use-editor-flagging` 1.92 MB (gzip 538 KB), `editor` 1.32 MB (gzip 434 KB). Đây là kích thước tệp, không đồng nghĩa mọi route đều tải toàn bộ. Cần gzip/Brotli, cache và đo trên server trước khi đặt SLA; không thay cấu hình server trong phiên này.

Lượt Chromium cuối đo trên static server local, không throttle, SDK/RPC mock: navigation 225 ms, first contentful paint 100 ms, khoảng 6.03 MB script transfer (server test không nén), 250 resource entries tại điểm kiểm tra picker. FCP chỉ là lần vẽ nội dung đầu tiên, không phải thời gian toàn bộ nghiệp vụ sẵn sàng. Đây là một lượt đo chẩn đoán, không phải benchmark thống kê. Chi tiết: `built-app-complete/initial-load-metrics.json` trong thư mục nghiệm thu trên.

- V3 cần quy trình deploy riêng, xác minh registry/address/chain/bytecode, chọn cách giữ hoặc chuyển task cũ, cập nhật env Web/Spaces đồng bộ rồi kiểm giao dịch thật. Chưa thực hiện bước này.
- Host HTTPS cần RPC HTTPS và WSS hoặc reverse proxy phù hợp. Cùng mạng không loại bỏ mixed-content restriction; không suy đoán endpoint mới.
- Cần kiểm Pinata proxy/gateway thật về hạn mức, CORS, timeout, propagation và quyền truy cập. Mock xác nhận logic xử lý lỗi, không chứng minh hạ tầng luôn sẵn sàng.
- Kiểm server SPA fallback `/plane/*`, `/plane/spaces/*`, wallet worker và origin SDK khi triển khai. Dữ liệu local của localhost không tự đi kèm bundle.
- Số đo hiệu năng trên máy local sẽ ghi riêng; không quy đổi thành cam kết tốc độ production hoặc không bao giờ phát sinh lỗi.

Thư mục `docs/` và `tmp/` đang bị Git ignore theo cấu hình có sẵn; không đổi `.gitignore`. Báo cáo này và mã/test mới được để lại để review, chưa stage hay commit.
