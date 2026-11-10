# Build Plane Web trên Windows

Chạy tại thư mục gốc Plane bằng Node/pnpm đã cài trong dự án. Không cần sửa SDK hoặc cài thêm dependency.

## Cấu hình

- Dev dùng `.env` và `.env.development*`; build dùng `.env`, `.env.local`, `.env.production`, `.env.production.local` theo thứ tự ưu tiên của Vite. Biến môi trường của tiến trình có ưu tiên cao nhất.
- Web: basename `/plane`. Spaces: dev `/spaces`, production `/plane/spaces`.
- Dev phân giải các export nội bộ (Propel, Editor, UI, Hooks...) về tệp nguồn thực tế, kể cả CSS và subpath. Vì vậy bước build dọn `dist` không làm mất module đang được dev phục vụ. Production tiếp tục dùng cách phân giải build hiện có.
- RPC, WebSocket, chain ID và ba địa chỉ contract của Web/Spaces phải trùng nhau trong cùng môi trường. Các giá trị thực đặt trong env, không đặt trong mã nguồn.
- Env không được đóng gói vào ZIP hoặc commit. Vite vẫn nhúng các giá trị `VITE_*` được sử dụng vào JavaScript trình duyệt.

## Build

```powershell
pnpm.cmd run build:plane
```

Lệnh đối chiếu source map của artifact SDK với source hiện có, kiểm hash ESM/CJS/types của bản đã cài tại Plane, build Spaces trước rồi mới build Web và chép Spaces vào Web. Không chạy build/install hay ghi file trong workspace SDK.

Sau khi chủ SDK cung cấp artifact mới, cập nhật **chỉ bản sao thư viện bên trong Plane** bằng lệnh sau rồi build lại:

```powershell
node scripts/sync-fiai-runtime.mjs --refresh
```

Lệnh dừng nếu source map cũ hoặc metadata dependency thay đổi. Không đổi package version hoặc lockfile. Chế độ mở ví được đọc từ implementation SDK đã đối chiếu source map; SDK hiện dùng URL loader nên không cần wallet worker. Worker cũ của Plane được bỏ để tránh ghép artifact của hai phiên bản. Nếu SDK chuyển sang runtime, pipeline yêu cầu worker tương ứng. Biến `FIAI_CONNECT_WALLET_LOAD_MODE` không tự đổi implementation SDK mới.

Nếu giữ khóa BLS/Brevo phía trình duyệt cho bản nội bộ đã được chấp nhận, guard mặc định sẽ chặn. Chỉ với lựa chọn nội bộ này, bật cờ cho đúng tiến trình build rồi phục hồi trạng thái cũ:

```powershell
$previousOptIn = $env:ALLOW_PUBLIC_SIGNING_SECRETS
try {
    $env:ALLOW_PUBLIC_SIGNING_SECRETS = 'true'
    pnpm.cmd run build:plane
    if ($LASTEXITCODE -ne 0) { throw 'Build Plane thất bại' }
} finally {
    if ($null -eq $previousOptIn) {
        Remove-Item Env:\ALLOW_PUBLIC_SIGNING_SECRETS -ErrorAction SilentlyContinue
    } else {
        $env:ALLOW_PUBLIC_SIGNING_SECRETS = $previousOptIn
    }
}
```

Không thêm cờ này vào env mặc định hoặc tắt guard trong mã nguồn. Đây là build nội bộ có khóa công khai trong bundle, không phải bản đã loại bỏ bí mật.

Đầu ra để kiểm tra/nén: `apps/web/build/client`, gồm `index.html`, `assets`, `spaces` và `fiai-sdk-build.json` ghi fingerprint artifact. URL loader không đóng gói `wallet-runtime-sw.js`. Local dev tiếp tục chạy bằng lệnh dev hiện có; sau khi refresh SDK cần khởi động lại dev server để Vite nạp thư viện mới.

## Giới hạn của kiểm tra build

Build thành công xác nhận biên dịch và tạo bundle, chưa chứng minh mọi nghiệp vụ chạy trên server. Trước khi đưa lên HTTPS cần kiểm tra RPC/WebSocket qua HTTPS/WSS, SPA fallback cho `/plane/*` và `/plane/spaces/*`, ba dịch vụ SDK và app chọn ví. SDK hiện chọn app ví local trên localhost/127.0.0.1 và app production trên các hostname khác; `VITE_URL_CONNECT_WALLET` của Plane phải khớp origin thực tế để xác minh sự kiện. App ví và Plane phải dùng cùng Crypto Vault. Phần cấu hình server được xử lý riêng.

Không xóa dữ liệu local hoặc kho ví khi chuyển origin; dữ liệu của origin localhost không nằm trong bundle build.
