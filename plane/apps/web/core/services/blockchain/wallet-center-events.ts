/**
 * Sự kiện mở "Trung tâm ví" — tách thành module riêng để luồng ví (metanode-wallet.service) và
 * UI (wallet-center) nói chuyện với nhau mà không tạo import vòng.
 */
export type WalletCenterMode = "diagnose" | "import" | "select";

export const WALLET_CENTER_EVENT = "plane:open-wallet-center";

/** Phát khi người dùng đổi/thêm ví — để badge ví và các luồng khác cập nhật ngay (WALLET-03). */
export const WALLET_CHANGED_EVENT = "plane:wallet-changed";

export function openWalletCenter(mode: WalletCenterMode = "diagnose"): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(WALLET_CENTER_EVENT, { detail: { mode } }));
}

export function notifyWalletChanged(address?: string | null): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(WALLET_CHANGED_EVENT, { detail: { address: address ?? null } }));
}
