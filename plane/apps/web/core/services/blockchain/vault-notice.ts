import { isVaultSigningError } from "@plane/services";

import { openWalletCenter } from "./wallet-center-events";

/**
 * Một thao tác cần chữ ký ví có thể lỗi ở nhiều bước liên tiếp (tạo task → ghi nội dung →
 * audit). Chỉ mở "Trung tâm ví" một lần trong khoảng này để người dùng không bị mở đi mở lại.
 */
const NOTICE_COOLDOWN_MS = 15_000;
let lastNoticeAt = 0;

/**
 * Người dùng vừa làm một việc cần chữ ký ví nhưng ứng dụng ví chưa sẵn sàng
 * (chưa có ví / ví đang chọn không còn trong ứng dụng ví / chưa mở được ứng dụng ví).
 *
 * Trước đây các luồng tạo công việc, bình luận, tệp đính kèm chỉ ghi một dòng log kỹ thuật
 * (`Wallet not found`) rồi thôi — người dùng không biết phải làm gì tiếp. Giờ mở đúng
 * chế độ của "Trung tâm ví" để họ tự khắc phục được ngay tại chỗ.
 *
 * Trả `true` nếu lỗi thuộc nhóm ví (đã xử lý), `false` nếu là lỗi khác.
 */
export function notifyVaultProblem(error: unknown): boolean {
  if (!isVaultSigningError(error)) return false;
  console.warn("[Ví] Chưa thể xác nhận thay đổi bằng ví:", error.code, error.message);
  const now = Date.now();
  if (now - lastNoticeAt < NOTICE_COOLDOWN_MS) return true;
  lastNoticeAt = now;
  openWalletCenter(error.code === "VAULT_EMPTY" ? "import" : "select");
  return true;
}
