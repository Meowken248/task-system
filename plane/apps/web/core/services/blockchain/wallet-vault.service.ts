/**
 * Cầu nối giữa Plane UI và Crypto Vault — NGUỒN SỰ THẬT DUY NHẤT cho câu hỏi
 * "ví nào thật sự ký được giao dịch?".
 *
 * Vì sao cần lớp này: Plane ký bằng Crypto Vault mà nó tự khởi tạo (VITE_FIAI_CRYPTO_VAULT_URL).
 * Nếu ví nằm ở một Vault khác origin (ví dụ app chọn ví trỏ Vault production) thì Plane KHÔNG thể
 * ký được, và trước đây lỗi này bị che thành "Wallet not found" sau 60s chờ vô vọng. Mọi quyết định
 * về ví giờ đi qua đây và trả về mã lỗi rõ ràng (VAULT_UNAVAILABLE / VAULT_EMPTY /
 * WALLET_NOT_IN_VAULT) để UI mở đúng luồng khắc phục.
 */
import type { FiaiSDK } from "@metanodejs/fiai-sdk";
import {
  assertVaultSigningAddress,
  getVaultFrameUrl,
  getVaultSnapshot,
  getVaultWalletsDetailed,
  invalidateVaultWalletCache,
  isVaultSigningError,
  VaultSigningError,
  type VaultErrorCode,
  type VaultSnapshot,
} from "@plane/services";

import { getFiaiSDK, initFiaiSDK } from "./fiai-sdk.service";
import { getLinkedMetanodeWalletAddress, linkMetanodeWalletAddress } from "./metanode-wallet.service";

const PRIVATE_KEY_RE = /^(0x)?[a-fA-F0-9]{64}$/;
/** Overlay mật khẩu/thiết lập bảo mật nằm trong Crypto Vault — phải chờ người dùng thao tác. */
const VAULT_UI_TIMEOUT_MS = 180_000;

export { openWalletCenter, WALLET_CENTER_EVENT, type WalletCenterMode } from "./wallet-center-events";

export type SigningWalletState = {
  /** `true` = đã xác định được ví CÓ THẬT trong Vault để ký. */
  ready: boolean;
  code: VaultErrorCode | null;
  message: string | null;
  address: string | null;
  linkedAddress: string | null;
  snapshot: VaultSnapshot | null;
};

export function normalizePrivateKey(value: string): string {
  const trimmed = (value || "").trim();
  if (!PRIVATE_KEY_RE.test(trimmed)) {
    throw new Error("Private key phải là chuỗi hex 64 ký tự (có hoặc không có tiền tố 0x).");
  }
  return trimmed.toLowerCase().startsWith("0x") ? trimmed : `0x${trimmed}`;
}

export function shortenAddress(address?: string | null, visible = 6): string {
  if (!address) return "—";
  if (address.length <= visible * 2 + 2) return address;
  return `${address.slice(0, visible + 2)}…${address.slice(-visible)}`;
}

function readAddressFromResponse(value: unknown, depth = 0): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim().toLowerCase();
    const withPrefix = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
    return /^0x[a-f0-9]{40}$/.test(withPrefix) ? withPrefix : null;
  }
  if (!value || typeof value !== "object" || depth > 2) return null;
  const raw = value as Record<string, unknown>;
  const direct = readAddressFromResponse(raw.address ?? raw.walletAddress, depth + 1);
  if (direct) return direct;
  for (const nested of Object.values(raw)) {
    const found = readAddressFromResponse(nested, depth + 1);
    if (found) return found;
  }
  return null;
}

async function getSdk(): Promise<FiaiSDK> {
  const sdk = (await initFiaiSDK()) ?? getFiaiSDK();
  if (!sdk) {
    throw new VaultSigningError(
      "VAULT_UNAVAILABLE",
      "MetaNode SDK chưa sẵn sàng. Hãy kiểm tra blockchain-bridge  + Crypto Vault  rồi tải lại trang."
    );
  }
  return sdk;
}

/** Đọc trạng thái Vault; mặc định đọc tươi và bỏ cache danh sách ví. */
export async function refreshVaultSnapshot(options?: { refresh?: boolean }): Promise<VaultSnapshot> {
  if (options?.refresh === false) return getVaultSnapshot({ refresh: false });
  invalidateVaultWalletCache();
  return getVaultSnapshot({ refresh: true });
}

/** Trạng thái ví hiện tại của Plane: có ký được không, ví nào, vì sao không. */
export async function loadSigningWalletState(options?: { refresh?: boolean }): Promise<SigningWalletState> {
  const linkedAddress = getLinkedMetanodeWalletAddress();
  let snapshot: VaultSnapshot | null = null;
  try {
    snapshot = await refreshVaultSnapshot(options);
  } catch (error) {
    console.warn("[Wallet Center] Không đọc được trạng thái Crypto Vault:", error);
  }

  if (!snapshot || !snapshot.reachable) {
    const vaultUrl = snapshot?.vaultUrl || getVaultFrameUrl() || "Crypto Vault";
    return {
      ready: false,
      code: "VAULT_UNAVAILABLE",
      message: `Không đọc được danh sách ví từ ${vaultUrl}. Hãy kiểm tra crypto-vault đang chạy rồi thử lại.`,
      address: null,
      linkedAddress,
      snapshot,
    };
  }

  if (snapshot.wallets.length === 0) {
    return {
      ready: false,
      code: "VAULT_EMPTY",
      message:
        `${snapshot.vaultUrl || "Crypto Vault"} chưa có ví nào. ` +
        "Import private key vào đúng Crypto Vault này để Plane có thể ký giao dịch.",
      address: null,
      linkedAddress,
      snapshot,
    };
  }

  try {
    const address = await assertVaultSigningAddress(linkedAddress ?? snapshot.dappActiveAddress, {
      // Snapshot vừa đọc xong nên dùng lại cache, tránh gọi `getAllWallets` lần thứ hai.
      refresh: false,
    });
    return { ready: true, code: null, message: null, address, linkedAddress, snapshot };
  } catch (error) {
    if (isVaultSigningError(error)) {
      return {
        ready: false,
        code: error.code,
        message: error.message,
        address: null,
        linkedAddress,
        snapshot,
      };
    }
    throw error;
  }
}

/** Lấy địa chỉ ký hợp lệ cho luồng on-chain; ném `VaultSigningError` nếu chưa cấu hình. */
export async function ensureSigningAddress(): Promise<string> {
  const state = await loadSigningWalletState();
  if (state.ready && state.address) return state.address;
  throw new VaultSigningError(
    state.code ?? "VAULT_EMPTY",
    state.message ?? "Chưa có ví hợp lệ trong Crypto Vault.",
    state.snapshot?.wallets.map((wallet) => wallet.address) ?? []
  );
}

/**
 * Import private key TRỰC TIẾP vào Crypto Vault của Plane.
 * - Private key chỉ đi từ form → Crypto Vault (qua postMessage của SDK), không lưu ở Plane,
 *   không ghi log, không đưa vào localStorage/sessionStorage.
 * - Lần đầu tiên Vault tự bật overlay để đặt mật khẩu (hoặc mở khoá). Nếu người dùng thao tác lâu
 *   hơn timeout của request thì ví vẫn có thể đã được tạo → ta đối chiếu lại danh sách ví thật.
 */
export async function importPrivateKeyToVault(privateKey: string, name?: string): Promise<string> {
  const key = normalizePrivateKey(privateKey);
  const sdk = await getSdk();

  invalidateVaultWalletCache();
  const before = new Set(((await getVaultWalletsDetailed({ refresh: true })) ?? []).map((wallet) => wallet.address));
  let failure: unknown = null;

  try {
    const response = await sdk.request<unknown>(
      "createWalletFromPrivateKey",
      {
        privateKey: key,
        name: name?.trim() || `plane_${Date.now()}`,
        backgroundImage: "",
      },
      { timeout: VAULT_UI_TIMEOUT_MS }
    );
    const created = readAddressFromResponse(response);
    if (created) {
      invalidateVaultWalletCache();
      return created;
    }
  } catch (error) {
    failure = error;
  }

  // Xác nhận lại bằng dữ liệu thật của Vault (kể cả khi request timeout nhưng ví đã được tạo).
  invalidateVaultWalletCache();
  const after = (await getVaultWalletsDetailed({ refresh: true })) ?? [];
  const created = after.find((wallet) => !before.has(wallet.address));
  if (created) return created.address;

  const message = failure instanceof Error ? failure.message : String(failure ?? "");
  if (/already exists/i.test(message)) {
    throw new Error("Ví này đã có trong Crypto Vault — hãy chọn ví trong danh sách bên trên.");
  }
  if (/UNLOCK_CANCELLED|cancel|closed/i.test(message)) {
    throw new Error("Bạn đã đóng hộp thoại Crypto Vault nên ví chưa được import.");
  }
  throw new Error(message || "Không import được ví vào Crypto Vault.");
}

/** Chọn ví active cho Plane (persist vào hồ sơ + setActiveWalletDapp cho domain hiện tại). */
export async function selectVaultWallet(address: string): Promise<void> {
  await linkMetanodeWalletAddress(address);
  invalidateVaultWalletCache();
}

/**
 * Mở khoá Vault bằng overlay bảo mật của chính Vault.
 * `getPublicKey` buộc Vault giải mã ví ⇒ Vault tự hiện hộp thoại mật khẩu (hoặc thiết lập mật khẩu
 * ở lần đầu). Plane không nhận private key, chỉ nhận public key và bỏ ngay.
 */
export async function unlockVault(address?: string | null): Promise<void> {
  const sdk = await getSdk();
  const snapshot = await getVaultSnapshot();
  const target = address || snapshot.dappActiveAddress || snapshot.wallets[0]?.address || null;
  if (!target) {
    throw new VaultSigningError(
      "VAULT_EMPTY",
      "Crypto Vault chưa có ví nào nên không có gì để mở khoá. Hãy import ví trước."
    );
  }
  await sdk.request("getPublicKey", { address: target }, { timeout: VAULT_UI_TIMEOUT_MS });
  invalidateVaultWalletCache();
}
