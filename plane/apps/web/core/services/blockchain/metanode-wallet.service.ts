import type { Wallet } from "@metanodejs/system-core";
import { getVaultWalletsDetailed, VaultSigningError } from "@plane/services";

import {
  clearLastSelectedMetanodeWallet,
  getFiaiSDK,
  getLastSelectedMetanodeWallet,
  initFiaiSDK,
} from "./fiai-sdk.service";
import { UserService } from "@/services/user.service";
import { openWalletCenter, notifyWalletChanged } from "./wallet-center-events";

type WalletLike = { address?: unknown };
type ConnectWallet = (mode: "light") => Promise<unknown> | unknown;

let connectWalletFn: ConnectWallet | null = null;
let systemCorePromise: Promise<ConnectWallet> | null = null;
let connectWalletPopup: Window | null = null;
let currentPlaneUserId: string | null = null;
let linkedWalletAddress: string | null = null;
/**
 * Ví THẬT SỰ ký giao dịch gần nhất (do ứng dụng ví trả về), khác với `linkedWalletAddress`
 * là địa chỉ đang lưu trong hồ sơ/trình duyệt. Sổ audit phải ghi theo ví ký, nếu không bản ghi
 * sẽ mang tên một địa chỉ không hề thực hiện giao dịch (lỗi CHAIN-05).
 */
let signingWalletAddress: string | null = null;
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
let activeResolvePromise: Promise<string> | null = null;
const userService = new UserService();

function walletStorageKey(userId: string): string {
  return `plane:metanode-wallet:${userId}`;
}

function getEffectivePlaneUserId(): string | null {
  if (currentPlaneUserId) return currentPlaneUserId;
  if (typeof window !== "undefined") {
    const storedUser = window.localStorage.getItem("plane_dapp_auth_user")?.trim();
    if (storedUser) {
      currentPlaneUserId = storedUser;
      return storedUser;
    }
  }
  return "user-default";
}

export function configureMetanodeWalletUser(userId?: string, walletAddress?: string | null): void {
  currentPlaneUserId = userId || null;
  // Phiên mới (đăng nhập/đổi tài khoản) ⇒ chưa biết ví nào sẽ ký.
  signingWalletAddress = null;
  if (!currentPlaneUserId || typeof window === "undefined") {
    linkedWalletAddress = null;
    return;
  }
  const localAddress =
    window.localStorage.getItem(walletStorageKey(currentPlaneUserId))?.trim() ||
    window.sessionStorage.getItem("plane_active_wallet_address")?.trim() ||
    window.localStorage.getItem("plane_active_wallet_address")?.trim() ||
    "";
  const serverAddress = walletAddress?.trim() || "";
  // Prefer the browser's locally linked wallet over a shared IPFS snapshot address
  linkedWalletAddress = isWalletAddress(localAddress)
    ? normalizeWalletAddress(localAddress)
    : isWalletAddress(serverAddress)
      ? normalizeWalletAddress(serverAddress)
      : null;
}

export function getLinkedMetanodeWalletAddress(): string | null {
  return linkedWalletAddress;
}

/**
 * Ghi nhớ ví THẬT SỰ ký giao dịch (đã được ứng dụng ví xác nhận) và đồng bộ luôn các nơi
 * đang lưu địa chỉ dùng cho hiển thị. Nhờ vậy mọi màn hình và sổ audit cùng trỏ về một
 * địa chỉ duy nhất — địa chỉ mà ứng dụng ví thực sự dùng để ký (CHAIN-05).
 */
export function rememberSigningWalletAddress(address?: string | null): void {
  const normalized = normalizeWalletAddress(address ?? "");
  if (!isWalletAddress(normalized)) return;
  const previous = linkedWalletAddress;
  signingWalletAddress = normalized;
  linkedWalletAddress = normalized;
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem("plane_active_wallet_address", normalized);
    window.localStorage.setItem("plane_active_wallet_address", normalized);
  } catch {
    // Trình duyệt chặn lưu trữ (chế độ riêng tư) — không ảnh hưởng tới luồng ký.
  }
  if (previous && previous.toLowerCase() === normalized.toLowerCase()) return;
  // Phát hiện lệch: ví đang ký khác địa chỉ đang lưu trong hồ sơ/trình duyệt.
  // Đồng bộ lại mọi nơi lưu (localDB + hồ sơ) để màn hình thành viên và sổ audit cùng một
  // địa chỉ, đồng thời không chặn bước ký đang chờ.
  console.warn(`[Ví] Đồng bộ lại địa chỉ ví theo ví đang ký: ${previous ?? "(chưa có)"} → ${normalized}`);
  void linkMetanodeWalletAddress(normalized).catch((error) => {
    console.warn("[Ví] Chưa lưu được địa chỉ ví mới vào hồ sơ:", error);
  });
  notifyWalletChanged(normalized);
}

/**
 * Địa chỉ đang dùng để ký, đã xác nhận có trong ứng dụng ví. `null` khi chưa xác định được
 * trong phiên này (khi đó nơi gọi dùng địa chỉ hồ sơ làm phương án dự phòng).
 */
export function getSigningWalletAddress(): string | null {
  return signingWalletAddress ?? linkedWalletAddress;
}

export function isMetanodeWalletRuntimeSupported(): boolean {
  if (typeof window === "undefined") return false;
  if (window.isSecureContext) return true;
  const hostname = window.location.hostname;
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") return true;
  if (/^10\./.test(hostname)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return true;
  if (/^192\.168\./.test(hostname)) return true;
  return false;
}

function openConnectWalletPage(): void {
  const connectWalletUrl =
    (typeof process !== "undefined" ? process.env?.VITE_URL_CONNECT_WALLET : undefined)?.trim() ||
    (typeof import.meta !== "undefined" ? (import.meta as any).env?.VITE_URL_CONNECT_WALLET : undefined)?.trim();
  if (!connectWalletUrl) throw new Error("VITE_URL_CONNECT_WALLET is missing.");
  const normalizedUrl = /^https?:\/\//i.test(connectWalletUrl) ? connectWalletUrl : `https://${connectWalletUrl}`;
  if (connectWalletPopup && !connectWalletPopup.closed) {
    connectWalletPopup.focus();
    return;
  }
  connectWalletPopup = window.open(normalizedUrl, "metanode-connect-wallet", "popup,width=480,height=760");
  if (!connectWalletPopup) {
    connectWalletPopup = window.open(normalizedUrl, "_blank");
  }
  connectWalletPopup?.focus();
}

export function isWalletAddress(value: string): boolean {
  return /^(0x)?[a-fA-F0-9]{40}$/.test(value.trim());
}

function normalizeWalletAddress(value: string): string {
  const trimmed = value.trim();
  return `${trimmed.toLowerCase().startsWith("0x") ? "" : "0x"}${trimmed}`.toLowerCase();
}

function readAddress(value: unknown): string | null {
  if (typeof value === "string") {
    if (isWalletAddress(value)) return normalizeWalletAddress(value);
    try {
      return readAddress(JSON.parse(value));
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object") return null;
  const address = (value as WalletLike).address;
  if (typeof address === "string" && isWalletAddress(address)) return normalizeWalletAddress(address);
  for (const nested of Object.values(value as Record<string, unknown>)) {
    const result = readAddress(nested);
    if (result) return result;
  }
  return null;
}

function readWallets(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  for (const key of ["wallets", "data", "result", "returnValue"]) {
    const wallets = readWallets((value as Record<string, unknown>)[key]);
    if (wallets.length > 0) return wallets;
  }
  return [];
}

async function getWallets(): Promise<unknown[]> {
  try {
    const sysCore = (await import("@metanodejs/system-core")) as any;
    if (typeof sysCore?.getAllWallets === "function") {
      const coreWallets = await sysCore.getAllWallets().catch(() => []);
      if (Array.isArray(coreWallets) && coreWallets.length > 0) return coreWallets;
    }
  } catch {}
  const sdk = (await initFiaiSDK()) ?? getFiaiSDK();
  if (!sdk) throw new Error("FiaiSDK is not available.");
  return readWallets(await sdk.request<unknown>("getAllWallets", {}));
}

async function getActiveWalletAddress(): Promise<string | null> {
  try {
    const sysCore = (await import("@metanodejs/system-core")) as any;
    if (typeof sysCore?.getActiveWallet === "function") {
      const active = await sysCore.getActiveWallet().catch(() => null);
      const addr = readAddress(active);
      if (addr) return addr;
    }
  } catch {}
  const sdk = (await initFiaiSDK()) ?? getFiaiSDK();
  if (!sdk) return null;
  const dappActive = await sdk
    .request<unknown>("getActiveWalletDapp", { domain: window.location.hostname })
    .catch(() => null);
  const dappAddr = readAddress(dappActive);
  if (dappAddr) return dappAddr;
  return readAddress(await sdk.request<unknown>("getActiveWallet", {}).catch(() => null));
}

async function dismissMetanodeWalletPicker(address?: string): Promise<void> {
  if (address) {
    const target = normalizeWalletAddress(address);
    const wallet = (await getWallets().catch(() => [])).find(
      (candidate) => readAddress(candidate)?.toLowerCase() === target
    );

    if (wallet) {
      void import("@metanodejs/system-core")
        .then(({ closeSelectPaymentWallet }) => closeSelectPaymentWallet(wallet as Wallet))
        .catch((error) => console.warn("MetaNode wallet picker could not be closed through system-core:", error));
    }
  }

  if (typeof document !== "undefined") {
    document.querySelectorAll(".fiai-modal-overlay").forEach((el) => {
      try {
        el.remove();
      } catch {}
    });
  }

  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  window.postMessage({ type: "close-wallet-modal" }, "*");
  connectWalletPopup?.close();
  connectWalletPopup = null;
}

async function persistLinkedWallet(address: string): Promise<void> {
  const userId = getEffectivePlaneUserId();
  const normalizedAddress = normalizeWalletAddress(address);
  linkedWalletAddress = normalizedAddress;
  if (typeof window !== "undefined") {
    window.sessionStorage.setItem("plane_active_wallet_address", normalizedAddress);
    window.localStorage.setItem("plane_active_wallet_address", normalizedAddress);
    if (userId) {
      window.localStorage.setItem(walletStorageKey(userId), normalizedAddress);
    }
    try {
      const rawDb = window.localStorage.getItem("plane_dapp_local_db");
      if (rawDb) {
        const localDB = JSON.parse(rawDb);
        let updated = false;
        const loggedEmail = (
          window.sessionStorage.getItem("plane_dapp_auth_email") || window.localStorage.getItem("plane_dapp_auth_email")
        )
          ?.trim()
          .toLowerCase();

        if (Array.isArray(localDB.users)) {
          const user = localDB.users.find(
            (u: any) => (userId && u.id === userId) || (loggedEmail && u.email?.toLowerCase() === loggedEmail)
          );
          if (user && user.metanode_wallet_address !== normalizedAddress) {
            user.metanode_wallet_address = normalizedAddress;
            updated = true;
          }
        }
        if (Array.isArray(localDB.workspace_members)) {
          const member = localDB.workspace_members.find(
            (m: any) => (loggedEmail && m.email?.toLowerCase() === loggedEmail) || (userId && m.member === userId)
          );
          if (member && member.wallet_address !== normalizedAddress) {
            member.wallet_address = normalizedAddress;
            updated = true;
          }
        }
        if (updated) {
          window.localStorage.setItem("plane_dapp_local_db", JSON.stringify(localDB));
        }
      }
    } catch (e) {
      console.warn("Could not sync wallet to localDB:", e);
    }
  }
  try {
    await userService.updateUser({ metanode_wallet_address: normalizedAddress });
  } catch (error) {
    console.warn("Could not persist metanode_wallet_address to userService:", error);
  }
}

async function selectAndLinkWallet(): Promise<string> {
  const userId = getEffectivePlaneUserId();
  if (!userId) throw new Error("Hãy đăng nhập Plane trước khi kết nối ví MetaNode.");
  clearLastSelectedMetanodeWallet();

  const availableAddresses = [
    ...new Set(
      (await getWallets().catch(() => []))
        .map((wallet) => readAddress(wallet))
        .filter((address): address is string => Boolean(address))
        .map(normalizeWalletAddress)
    ),
  ];
  // When selectAndLinkWallet is invoked, always open the picker so the user
  // can explicitly select, switch, or create/import a new wallet right in the UI modal.

  // system-core may keep this promise pending after a wallet has been selected.
  // Start the picker without blocking, then observe the active wallet through
  // Crypto Vault so the Plane flow can finish and close the picker reliably.
  let walletPickerError: unknown;
  let walletPickerAddress: string | null = null;
  let messageAddress: string | null = null;
  let isPickerClosed = false;

  const onMessage = (event: MessageEvent) => {
    if (event.data && typeof event.data === "object") {
      if (event.data.type === "wallet-selected") {
        const addr = readAddress(event.data.data);
        if (addr) messageAddress = addr;
      } else if (event.data.type === "close-wallet-modal") {
        isPickerClosed = true;
      }
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      isPickerClosed = true;
    }
  };

  if (typeof window !== "undefined") {
    window.addEventListener("message", onMessage);
    window.addEventListener("keydown", onKeyDown);
  }

  void openMetanodeWallet()
    .then(async (result) => {
      walletPickerAddress = readAddress(result);
      if (!walletPickerAddress) {
        if ((result as any)?.success === true) {
          const activeAddr = await getActiveWalletAddress().catch(() => null);
          if (activeAddr && isWalletAddress(activeAddr)) {
            walletPickerAddress = normalizeWalletAddress(activeAddr);
          }
        } else if ((result as any)?.success === false) {
          isPickerClosed = true;
        }
      }
    })
    .catch((error) => {
      walletPickerError = error;
      isPickerClosed = true;
      console.error("MetaNode wallet picker failed:", error);
    });

  const deadline = Date.now() + 120_000;
  // Give the wallet picker time to render before accepting its active wallet.
  await new Promise((resolve) => window.setTimeout(resolve, 750));
  try {
    while (Date.now() < deadline) {
      // oxlint-disable-next-line no-await-in-loop -- the wallet selection is intentionally polled.
      let selectedAddress: string | null = messageAddress ?? walletPickerAddress;

      if (!selectedAddress) {
        // oxlint-disable-next-line no-await-in-loop
        const vaultActive = await getActiveWalletAddress().catch(() => null);
        if (vaultActive && isWalletAddress(vaultActive)) {
          selectedAddress = normalizeWalletAddress(vaultActive);
        }
      }

      if (isPickerClosed && !selectedAddress) {
        // Give 200ms grace period in case messageAddress or active wallet is in flight
        // oxlint-disable-next-line no-await-in-loop
        await new Promise((resolve) => window.setTimeout(resolve, 200));
        selectedAddress = messageAddress ?? walletPickerAddress;
        if (!selectedAddress) {
          // oxlint-disable-next-line no-await-in-loop
          const vaultActive = await getActiveWalletAddress().catch(() => null);
          if (vaultActive && isWalletAddress(vaultActive)) {
            selectedAddress = normalizeWalletAddress(vaultActive);
          }
        }
        if (!selectedAddress) {
          throw new Error("Người dùng đã hủy chọn ví MetaNode.");
        }
      }

      if (!selectedAddress) {
        // Fallback: Check if a new wallet was created/imported into Crypto Vault during this session
        // oxlint-disable-next-line no-await-in-loop
        const currentWallets = (await getWallets().catch(() => []))
          .map((wallet) => readAddress(wallet))
          .filter((address): address is string => Boolean(address))
          .map(normalizeWalletAddress);
        const newlyAdded = currentWallets.find((addr) => !availableAddresses.includes(addr));
        if (newlyAdded) {
          selectedAddress = newlyAdded;
        } else if (availableAddresses.length === 0 && currentWallets.length === 1) {
          selectedAddress = currentWallets[0];
        }
      }
      if (selectedAddress) {
        try {
          // oxlint-disable-next-line no-await-in-loop -- the account link must finish before transaction signing.
          await persistLinkedWallet(selectedAddress);
          // oxlint-disable-next-line no-await-in-loop
          await activateMetanodeWallet(selectedAddress).catch(() => false);
          return normalizeWalletAddress(selectedAddress);
        } finally {
          // Always release the blocking wallet layer, including when profile persistence fails.
          // oxlint-disable-next-line no-await-in-loop -- dismissal should finish before Plane continues.
          await dismissMetanodeWalletPicker(selectedAddress);
        }
      }
      // oxlint-disable-next-line no-await-in-loop -- polling is throttled to avoid loading Crypto Vault.
      await new Promise((resolve) => window.setTimeout(resolve, 500));
    }
  } finally {
    if (typeof window !== "undefined") {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("keydown", onKeyDown);
    }
  }
  if (walletPickerError instanceof Error) throw walletPickerError;
  throw new Error("Đã hết thời gian chọn ví MetaNode cho tài khoản này.");
}

export async function activateMetanodeWallet(address: string): Promise<boolean> {
  if (!isWalletAddress(address)) return false;
  const sdk = (await initFiaiSDK()) ?? getFiaiSDK();
  if (!sdk) throw new Error("FiaiSDK is not available.");

  const wallet = (await getWallets()).find(
    (candidate) => readAddress(candidate)?.toLowerCase() === address.toLowerCase()
  );
  if (!wallet) return false;

  const activeWallet = await sdk
    .request<unknown>("getActiveWalletDapp", { domain: window.location.hostname })
    .catch(() => null);
  if (readAddress(activeWallet)?.toLowerCase() === address.toLowerCase()) return true;

  try {
    const { setWalletActiveDApp } = await import("@metanodejs/system-core");
    await setWalletActiveDApp(wallet as Wallet);
  } catch (error) {
    console.warn("Unable to setWalletActiveDApp via system-core:", error);
  }
  await sdk
    .request("setActiveWalletDapp", {
      ...(wallet as Record<string, unknown>),
      domain: window.location.hostname,
    })
    .catch((error) => console.warn("Unable to persist the active MetaNode wallet:", error));
  return true;
}

/**
 * Ghi nhớ ví người dùng chọn trong "Trung tâm ví" cho tài khoản Plane hiện tại
 * (localStorage theo user + hồ sơ user + setActiveWalletDapp cho domain), rồi xác nhận lại với
 * Crypto Vault. Dùng khi người dùng chủ động đổi ví — khác với auto-resolve nền.
 */
export async function linkMetanodeWalletAddress(address: string): Promise<boolean> {
  if (!isWalletAddress(address)) return false;
  const normalized = normalizeWalletAddress(address);
  await persistLinkedWallet(normalized);
  await activateMetanodeWallet(normalized).catch(() => false);
  return true;
}

export function preloadMetanodeWallet(): Promise<ConnectWallet> | null {
  if (typeof window === "undefined") return null;
  if (connectWalletFn) return Promise.resolve(connectWalletFn);
  if (!systemCorePromise) {
    systemCorePromise = import("@metanodejs/system-core").then(({ connectWallet }) => {
      connectWalletFn = connectWallet as ConnectWallet;
      return connectWalletFn;
    });
  }
  return systemCorePromise;
}

export async function openMetanodeWallet(): Promise<unknown> {
  if (typeof window === "undefined") return;
  const sdk = await initFiaiSDK();
  if (!sdk) throw new Error("FiaiSDK is not available.");

  // Luôn dùng connectWallet('light') thay vì window.open popup ngoài,
  // vì window.open không đồng bộ được dữ liệu ví về FiaiSDK trên localhost.
  if (connectWalletFn) return Promise.resolve(connectWalletFn("light"));
  return preloadMetanodeWallet()?.then((connectWallet) => connectWallet("light")) ?? Promise.resolve();
}

export type ResolveWalletOptions = {
  silent?: boolean;
  forceSelect?: boolean;
};

export async function resolveMetanodeWalletAddress(options?: ResolveWalletOptions): Promise<string> {
  const silent = Boolean(options?.silent);
  const forceSelect = Boolean(options?.forceSelect);
  if (!forceSelect && activeResolvePromise) {
    const result = await activeResolvePromise.catch(() => null);
    if (result && isWalletAddress(result) && result !== ZERO_ADDRESS) {
      return result;
    }
    if (silent) {
      return result || ZERO_ADDRESS;
    }
  }

  activeResolvePromise = doResolveMetanodeWalletAddress(silent, forceSelect).finally(() => {
    activeResolvePromise = null;
  });
  return activeResolvePromise;
}

async function doResolveMetanodeWalletAddress(silent: boolean, forceSelect = false): Promise<string> {
  if (typeof window === "undefined") throw new Error("MetaNode wallet is only available in the browser.");

  if (!isMetanodeWalletRuntimeSupported()) {
    throw new Error(
      "Trình duyệt chặn kết nối ví trên địa chỉ không bảo mật. Hãy mở Plane bằng địa chỉ do quản trị viên cung cấp."
    );
  }

  await initFiaiSDK();

  // 1. Explicit session candidates (deliberately chosen by the current user for Plane)
  const sessionCandidates: string[] = [];
  if (linkedWalletAddress && isWalletAddress(linkedWalletAddress)) {
    sessionCandidates.push(normalizeWalletAddress(linkedWalletAddress));
  }

  // Active wallet stored from invite join or session
  if (typeof window !== "undefined") {
    const activeStoredWallet = (
      window.sessionStorage.getItem("plane_active_wallet_address") ||
      window.localStorage.getItem("plane_active_wallet_address")
    )?.trim();
    if (activeStoredWallet && isWalletAddress(activeStoredWallet)) {
      sessionCandidates.push(normalizeWalletAddress(activeStoredWallet));
    }
  }

  const userId = getEffectivePlaneUserId();
  if (userId && userId !== "user-default") {
    const localAddr = window.localStorage.getItem(walletStorageKey(userId))?.trim() || "";
    if (isWalletAddress(localAddr)) {
      sessionCandidates.push(normalizeWalletAddress(localAddr));
    }
  }

  // Look up in localDB if present
  if (typeof window !== "undefined") {
    try {
      const rawDb = window.localStorage.getItem("plane_dapp_local_db");
      if (rawDb) {
        const localDB = JSON.parse(rawDb);
        const loggedEmail = (
          window.sessionStorage.getItem("plane_dapp_auth_email") || window.localStorage.getItem("plane_dapp_auth_email")
        )
          ?.trim()
          .toLowerCase();

        if (Array.isArray(localDB.users)) {
          const userRec = localDB.users.find(
            (u: any) => (userId && u.id === userId) || (loggedEmail && u.email?.toLowerCase() === loggedEmail)
          );
          if (userRec?.metanode_wallet_address && isWalletAddress(userRec.metanode_wallet_address)) {
            sessionCandidates.push(normalizeWalletAddress(userRec.metanode_wallet_address));
          }
        }
        if (Array.isArray(localDB.workspace_members)) {
          const memberRec = localDB.workspace_members.find(
            (m: any) => (loggedEmail && m.email?.toLowerCase() === loggedEmail) || (userId && m.member === userId)
          );
          if (memberRec?.wallet_address && isWalletAddress(memberRec.wallet_address)) {
            sessionCandidates.push(normalizeWalletAddress(memberRec.wallet_address));
          }
        }
        if (Array.isArray(localDB.workspaces)) {
          for (const ws of localDB.workspaces) {
            const ownerEth = ws.owner?.wallet_address || ws.owner_details?.wallet_address || ws.owner;
            if (ownerEth && typeof ownerEth === "string" && isWalletAddress(ownerEth)) {
              sessionCandidates.push(normalizeWalletAddress(ownerEth));
            }
          }
        }
      }
    } catch {}
  }

  // 2. Fallback candidates (extension's active wallet or last selected - only used in silent mode or single-wallet vault)
  const fallbackCandidates: string[] = [];
  const activeAddress = await getActiveWalletAddress().catch(() => null);
  if (activeAddress && isWalletAddress(activeAddress)) {
    fallbackCandidates.push(normalizeWalletAddress(activeAddress));
  }
  const lastSelected = readAddress(getLastSelectedMetanodeWallet());
  if (lastSelected && isWalletAddress(lastSelected)) {
    fallbackCandidates.push(normalizeWalletAddress(lastSelected));
  }

  // Nguồn sự thật duy nhất: danh sách ví THẬT trong Crypto Vault mà Plane đang kết nối.
  // `null` = không đọc được Vault (frame chưa ready/timeout) — KHÁC với `[]` = Vault rỗng.
  // Chỉ đọc tươi khi người dùng chủ động chọn ví; luồng thường dùng cache ngắn để không gọi
  // `getAllWallets` (có RPC balance) trên mỗi lần ghi on-chain.
  const vaultWallets = await getVaultWalletsDetailed({ refresh: forceSelect });
  if (vaultWallets === null) {
    if (silent) return ZERO_ADDRESS;
    throw new VaultSigningError(
      "VAULT_UNAVAILABLE",
      "Chưa mở được ứng dụng ví nên chưa thể xác nhận thay đổi. Hãy mở ứng dụng ví trên máy rồi thực hiện lại."
    );
  }
  const availableAddresses = [...new Set(vaultWallets.map((wallet) => wallet.address))];

  const uniqueSessionCandidates = [...new Set(sessionCandidates)];

  // Case 1: If Crypto Vault has wallets
  if (availableAddresses.length > 0) {
    // If not forcing selection and a session wallet was already explicitly linked, use it
    if (!forceSelect) {
      for (const candidate of uniqueSessionCandidates) {
        if (availableAddresses.includes(candidate)) {
          linkedWalletAddress = candidate;
          if (userId) {
            window.localStorage.setItem(walletStorageKey(userId), candidate);
          }
          await activateMetanodeWallet(candidate).catch(() => false);
          return candidate;
        }
      }

      // If Crypto Vault already has an active wallet that was selected (e.g. from connect-wallet iframe or another tab)
      const activeFallback = fallbackCandidates.find((c) => availableAddresses.includes(c));
      if (activeFallback) {
        await persistLinkedWallet(activeFallback);
        await activateMetanodeWallet(activeFallback).catch(() => false);
        return activeFallback;
      }
    }

    // Single wallet in vault -> no need to prompt ONLY if not forcing user selection
    if (availableAddresses.length === 1 && !forceSelect) {
      const singleWallet = availableAddresses[0];
      await persistLinkedWallet(singleWallet);
      await activateMetanodeWallet(singleWallet).catch(() => false);
      return singleWallet;
    }

    // Multiple wallets in vault:
    if (silent && !forceSelect) {
      // In silent mode (background read), fallback to active vault wallet or first available
      const fallback = fallbackCandidates.find((c) => availableAddresses.includes(c)) || availableAddresses[0];
      linkedWalletAddress = fallback;
      return fallback;
    }

    // In interactive mode with multiple wallets (or forceSelect): prompt user to pick!
    return selectAndLinkWallet();
  } else {
    // Case 2: Crypto Vault trả lời nhưng KHÔNG có ví nào.
    // Tuyệt đối không trả về địa chỉ cũ (từ session/localDB/IPFS) — Vault không giữ ví đó nên
    // bridge sẽ báo "Wallet not found", hộp thoại mật khẩu không bao giờ hiện và dữ liệu không
    // lên chain. Chặn sớm + chỉ rõ cách khắc phục thay vì chờ 120s vô vọng.
    if (silent) return ZERO_ADDRESS;
    throw new VaultSigningError(
      "VAULT_EMPTY",
      "Ứng dụng ví chưa có ví nào. Mở “Trung tâm ví” để thêm ví của bạn rồi thực hiện lại."
    );
  }
}

async function hasWallet(address: string): Promise<boolean> {
  const target = normalizeWalletAddress(address);
  const wallets = await getWallets().catch(() => []);
  return wallets.some((wallet) => {
    const addr = readAddress(wallet);
    return addr ? addr.toLowerCase() === target : false;
  });
}

async function detectLinkedWallet(targetAddress: string, knownAddresses: Set<string>): Promise<string | null> {
  // Đọc danh sách ví đúng 1 lần (getAllWallets có gọi RPC lấy balance) rồi đối chiếu:
  // 1. Đúng ví Plane cần → dùng luôn.
  // 2. Ví mới xuất hiện trong Vault (người dùng vừa import/tạo) → dùng ví đó.
  // 3. Ví người dùng chọn trong hộp thoại Crypto Vault → dùng ví đó.
  const vaultAddresses = (await getWallets().catch(() => []))
    .map((wallet) => readAddress(wallet))
    .filter((addr): addr is string => Boolean(addr));

  if (vaultAddresses.includes(targetAddress)) return targetAddress;

  const importedAddress = vaultAddresses.find((addr) => !knownAddresses.has(addr)) ?? null;
  const selectedAddress =
    readAddress(getLastSelectedMetanodeWallet()) ?? (await getActiveWalletAddress()) ?? importedAddress;
  if (selectedAddress && vaultAddresses.includes(selectedAddress)) return selectedAddress;
  return importedAddress;
}

export async function promptForMetanodeWalletImport(address: string): Promise<boolean> {
  if (typeof window === "undefined" || !isWalletAddress(address)) return false;
  const targetAddress = normalizeWalletAddress(address);
  if (await hasWallet(targetAddress)) return activateMetanodeWallet(targetAddress);

  // Vault rỗng ⇒ không có gì để chọn: mở "Trung tâm ví" (chế độ import) và báo thất bại NGAY,
  // thay vì poll 60s chờ một ví không thể xuất hiện trong Vault này (nguyên nhân "treo" cũ).
  const vaultWallets = await getVaultWalletsDetailed({ refresh: true }).catch(() => null);
  if (vaultWallets && vaultWallets.length === 0) {
    console.warn("[MetaNode Wallet] Crypto Vault chưa có ví nào — mở Trung tâm ví để import private key.");
    openWalletCenter("import");
    return false;
  }

  // Ảnh chụp danh sách ví TRƯỚC khi mở hộp thoại: ví nào xuất hiện thêm sau đó = ví vừa import/tạo.
  const knownAddresses = new Set(
    (await getWallets().catch(() => []))
      .map((wallet) => readAddress(wallet))
      .filter((addr): addr is string => Boolean(addr))
  );

  clearLastSelectedMetanodeWallet();

  // fiai-sdk@1.0.0 never resolves connectWallet when the selected wallet is
  // already active, so keep polling Crypto Vault instead of awaiting it.
  void openMetanodeWallet().catch((error) => {
    console.warn("MetaNode runtime could not open the wallet. Opening Connect Wallet instead.", error);
    try {
      openConnectWalletPage();
    } catch (popupError) {
      console.error("Connect Wallet fallback failed:", popupError);
    }
  });
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    // oxlint-disable-next-line no-await-in-loop -- wallet availability must be polled sequentially.
    const detected = await detectLinkedWallet(targetAddress, knownAddresses);
    if (detected) {
      // oxlint-disable-next-line no-await-in-loop -- the account link must finish before the wallet window closes.
      await persistLinkedWallet(detected);
      // oxlint-disable-next-line no-await-in-loop
      const activated = await activateMetanodeWallet(detected);
      // oxlint-disable-next-line no-await-in-loop
      await dismissMetanodeWalletPicker(detected);
      return activated;
    }

    // oxlint-disable-next-line no-await-in-loop -- this delay intentionally throttles the polling loop.
    await new Promise((resolve) => window.setTimeout(resolve, 500));
  }
  console.warn(`[MetaNode Wallet] Hết thời gian chờ liên kết ví ${targetAddress} trong Crypto Vault.`);
  return false;
}
