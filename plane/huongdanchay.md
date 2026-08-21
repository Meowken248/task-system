# Hướng Dẫn Chạy Dự Án (Plane Monorepo)

Dự án này được quản lý theo dạng **Monorepo** sử dụng [TurboRepo](https://turbo.build/) và công cụ quản lý package [pnpm](https://pnpm.io/).

## 1. Yêu cầu hệ thống (Prerequisites)
Để chạy được dự án này, máy tính của bạn cần cài đặt sẵn:
- **Node.js**: Phiên bản 18.x hoặc mới hơn (Khuyến nghị sử dụng bản LTS).
- **pnpm**: Công cụ quản lý thư viện (thay thế cho npm/yarn). 
  - Nếu chưa có pnpm, bạn có thể cài đặt thông qua npm bằng lệnh:
    ```bash
    npm install -g pnpm
    ```

## 2. Cài đặt các thư viện (Install Dependencies)
Sau khi giải nén toàn bộ mã nguồn, hãy mở Terminal (hoặc Command Prompt / PowerShell) tại thư mục gốc của dự án (`plane`) và chạy lệnh sau để tự động tải về tất cả các thư viện cần thiết:

```bash
pnpm install
```
*(Lưu ý: Quá trình này có thể mất vài phút tuỳ thuộc vào tốc độ mạng của bạn).*

## 3. Khởi chạy môi trường phát triển (Run Development Server)
Sau khi quá trình cài đặt hoàn tất, bạn có thể khởi chạy toàn bộ các ứng dụng (web, admin, space, v.v.) ở chế độ phát triển (Development) bằng lệnh:

```bash
pnpm dev
```
- Lệnh này sẽ tự động chạy song song tất cả các service.
- Ứng dụng chính (Web) thường sẽ chạy trên địa chỉ: **http://localhost:3000**
- Các thay đổi trong code sẽ được tự động cập nhật lên trình duyệt (hot-reload).

## 4. Biên dịch dự án (Build for Production)
Nếu bạn cần biên dịch (build) dự án để chuẩn bị triển khai lên môi trường Production, hãy chạy lệnh:

```bash
pnpm build
```

## Lỗi Thường Gặp
1. **Lỗi không tìm thấy lệnh `pnpm`:** Đảm bảo bạn đã chạy `npm install -g pnpm` và khởi động lại Terminal.
2. **Lỗi liên quan đến phiên bản Node.js:** Đảm bảo bạn đang sử dụng đúng phiên bản Node.js yêu cầu. Bạn có thể dùng [NVM (Node Version Manager)](https://github.com/nvm-sh/nvm) hoặc [NVM cho Windows](https://github.com/coreybutler/nvm-windows) để dễ dàng chuyển đổi phiên bản Node.
