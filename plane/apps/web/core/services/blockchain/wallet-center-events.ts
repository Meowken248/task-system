/**
 * Sự kiện mở "Trung tâm ví" — tách thành module riêng để luồng ví (metanode-wallet.service) và
 * UI (wallet-center) nói chuyện với nhau mà không tạo import vòng.
 */
export type WalletCenterMode = "diagnose" | "import" | "select";

export const WALLET_CENTER_EVENT = "plane:open-wallet-center";

export function openWalletCenter(mode: WalletCenterMode = "diagnose"): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(WALLET_CENTER_EVENT, { detail: { mode } }));
}
