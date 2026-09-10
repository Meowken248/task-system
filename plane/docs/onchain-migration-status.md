# Trạng Thái Di Chuyển Lên On-Chain (On-Chain Migration Status)

**Ngày cập nhật:** 22/08/2026

Tài liệu này tổng hợp lại các công việc đã thực hiện để chuyển đổi kiến trúc ứng dụng từ việc sử dụng mock/localStorage sang gọi thẳng Smart Contract qua Blockchain Bridge, các lỗi hạ tầng đang chặn tiến độ, và kế hoạch cho các bước tiếp theo.

## 1. Đã Hoàn Thành (Phần 1 - Sửa Code Frontend)

Các thay đổi sau đây đã được hoàn thành 100% và đang được giữ nguyên trong code:

### 1.1. Luồng Upload File (`issue_attachment.service.ts` & `file-upload.service.ts`)
- **Gỡ bỏ Mock URL:** Đã xóa logic gửi POST `/api/assets/v2/` lấy url giả, đổi sang truyền `FormData` gọi trực tiếp vào `FileUploadService`.
- **Upload thẳng qua FiaiSDK:** Dữ liệu file được gọi thẳng qua `fiaiSDK.request("uploadFile", { filename, ext, base64 })`.
- **Chống Race Condition:** Bổ sung logic `waitForReady('file-processor', 60000)` trong `file-upload.service.ts` để chắc chắn iframe tải xong trước khi gọi upload.
- **Ghi bằng chứng On-Chain:** Sau khi upload xong, bắt buộc `await recordIssueContentOnChain`. Ném lỗi thẳng ra UI (Toast) nếu giao dịch chain thất bại (không còn console.warn âm thầm giấu lỗi).
- **Vô hiệu hóa Get/Delete giả:** `getIssueAttachments` đã bị đổi thành trả về `[]` (kèm TODO comment), và `deleteIssueAttachment` ném lỗi chưa được hỗ trợ.

### 1.2. Luồng Ghi Dữ Liệu (Create/Update/Delete Issues & Comments)
- **Ép buộc giao dịch Chain (`issue.service.ts`, `issue_comment.service.ts`):** 
  - Đã gỡ bỏ toàn bộ logic lưu dự phòng (fallback) xuống local như `recordOfflineTaskCreation` và `recordOfflineDailyReport`.
  - Mọi thao tác ghi (tạo task, gán nhân viên, sửa mô tả, ném comment) nếu bị chain từ chối (hoặc lỗi mạng) sẽ bắt buộc ném lỗi `throw { error: ..., isChainError: true }` để chặn hành động và hiện lỗi đỏ trên UI.

### 1.3. Lưu Trữ Dữ Liệu Task (`dapp-interceptor.ts`)
- **Lưu trữ Persistent & IPFS Snapshot:** `issues`, `issue_comments`, `attachments` được lưu bền vững trong `localStorage` (`plane_dapp_local_db`) và tự động đồng bộ lên IPFS snapshot để bảo toàn dữ liệu task giữa các lần F5 reload trang.
- **Khôi phục Search Issues:** Endpoint `search-issues` trả về đúng danh sách tasks từ localDB để hỗ trợ tìm kiếm, liên kết task cha-con (sub-issues) và hiển thị trên giao diện.
- **Ghi bằng chứng On-chain song song:** Mọi thao tác tạo task vẫn tạo giao dịch ghi bằng chứng on-chain qua `plane-task-chain.service.ts` để phục vụ KPI và audit trail.

---

## 2. Các Blockers Hạ Tầng Hiện Tại (Đang Chờ Team Bridge)

Code đã chuẩn xác nhưng chưa thể hoạt động trơn tru 100% vì đang vướng các lỗi do phía Backend (Blockchain Bridge/Network):

1. **Lỗi `502 Bad Gateway` từ RPC Proxy:** 
   - Server `https://rpc-proxy-sequoia.iqnb.com:8446/` đang phản hồi 502 khi ứng dụng gọi `[blockchain bridge] ExecuteContractUseCase`. 
   - Hậu quả: Không thể hoàn tất giao dịch tạo Task/Comment trên môi trường Metanode Sequoia.
2. **Thiếu hỗ trợ List Data / searchTransactions:** 
   - Contract hiện không có hàm lấy list, không có event, và API `searchTransactions` của Bridge cũng bị lỗi 502/chưa khả dụng.
   - Hậu quả: Giao diện không thể lấy danh sách Work Items.

---

## 3. Kế Hoạch Tiếp Theo (Phần 2/3 - Sau khi Hạ Tầng Ổn Định)

Khi các blockers hạ tầng được giải quyết, các bước cuối cùng sẽ là:

1. **Dọn dẹp triệt để `dapp-interceptor.ts` (Phần 2):**
   - Xóa bỏ hoàn toàn biến `localDB`, hàm `saveDB()`, `setLoggedInUser`.
   - Với những API mock còn sót lại, thêm comment TODO giải thích `"Cần thay bằng gọi Smart Contract thật, xem plane-task-chain.service.ts"` thay vì xóa bừa bãi làm crash app.
2. **Cập nhật UI Trang Danh Sách "Work Items" (Phần 3):**
   - Chèn một Banner/Thông báo hiển thị cứng trên UI: *"Danh sách task on-chain hiện chưa khả dụng — vui lòng dùng ID/link trực tiếp để mở từng task, hoặc liên hệ người tạo task để lấy ID."*
   - Tuyệt đối không tự viết "Local Indexer" hay dùng bất kỳ Storage ngầm nào để làm tính năng danh sách theo lệnh cấm nghiêm ngặt.
   - (Các chức năng xem chi tiết Task / lấy thống kê KPI bằng Contract vẫn giữ nguyên và hoạt động bình thường).
