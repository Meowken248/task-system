import { getVaultWalletsDetailed, VaultSigningError } from "@plane/services";

import {
  clearLastSelectedMetanodeWallet,
  getFiaiSDK,
  getLastSelectedMetanodeWallet,
  initFiaiSDK,
  ensureFiaiFramesReady,
  subscribeMetanodeWalletSelection,
} from "./fiai-sdk.service";
import { UserService } from "@/services/user.service";
import { openWalletCenter, notifyWalletChanged } from "./wallet-center-events";

type WalletLike = { address?: unknown };
type ConnectWallet = (mode: "light") => Promise<unknown> | unknown;

let connectWalletFn: ConnectWallet | null = null;
let systemCorePromise: Promise<ConnectWallet> | null = null;
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
let activeSelectionPromise: Promise<string> | null = null;
let walletContextVersion = 0;
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
  if (currentPlaneUserId !== (userId || null)) walletContextVersion++;
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
  const sdk = (await initFiaiSDK()) ?? getFiaiSDK();
  if (!sdk) throw new Error("FiaiSDK is not available.");
  return readWallets(await sdk.request<unknown>("getAllWallets", {}));
}

async function getActiveWalletAddress(): Promise<string | null> {
  const sdk = (await initFiaiSDK()) ?? getFiaiSDK();
  if (!sdk) return null;
  const dappActive = await sdk
    .request<unknown>("getActiveWalletDapp", { domain: window.location.hostname })
    .catch(() => null);
  const dappAddr = readAddress(dappActive);
  return dappAddr;
}

async function dismissMetanodeWalletPicker(): Promise<void> {
  // WalletModal.hide releases its own listeners, iframe and pending promise.
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
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
  if (activeSelectionPromise) return activeSelectionPromise;
  const task = runWalletSelection().finally(() => {
    if (activeSelectionPromise === task) activeSelectionPromise = null;
  });
  activeSelectionPromise = task;
  return task;
}

async function runWalletSelection(): Promise<string> {
  const userId = getEffectivePlaneUserId();
  if (!userId) throw new Error("Hãy đăng nhập Plane trước khi kết nối ví MetaNode.");
  const context = walletContextVersion;
  const sdk = await initFiaiSDK();
  const assertContext = () => {
    if (context !== walletContextVersion || sdk !== getFiaiSDK() || sdk?.isDestroyed) {
      throw new Error("Tài khoản hoặc phiên ví đã thay đổi. Vui lòng chọn ví lại.");
    }
  };
  assertContext();
  clearLastSelectedMetanodeWallet();
  let walletPickerError: unknown;
  let messageAddress: string | null = null;
  let isPickerClosed = false;
  let accepting = true;
  const unsubscribe = subscribeMetanodeWalletSelection((wallet) => {
    if (accepting && !isPickerClosed) messageAddress = readAddress(wallet);
  });
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") isPickerClosed = true;
  };
  window.addEventListener("keydown", onKeyDown);
  void openMetanodeWallet()
    .then((result) => {
      if (!accepting) return;
      // A successful SDK promise can also be caused by a programmatic Vault
      // activation. Only the trusted picker decision supplies the selected address.
      if ((result as any)?.success === false) isPickerClosed = true;
    })
    .catch((error) => {
      if (!accepting) return;
      walletPickerError = error;
      isPickerClosed = true;
      console.error("MetaNode wallet picker failed:", error);
    });

  const deadline = Date.now() + 120_000;
  try {
    while (Date.now() < deadline) {
      assertContext();
      const selectedAddress = messageAddress;
      if (isPickerClosed && !selectedAddress) {
        if (walletPickerError instanceof Error) throw walletPickerError;
        throw new Error("Người dùng đã hủy chọn ví MetaNode.");
      }
      if (selectedAddress) {
        if (!await linkMetanodeWalletAddress(selectedAddress)) throw new Error("Chưa xác nhận được ví đang dùng trong Crypto Vault. Vui lòng thử lại.");
        assertContext();
        return normalizeWalletAddress(selectedAddress);
      }
      // oxlint-disable-next-line no-await-in-loop -- polling is throttled to avoid loading Crypto Vault.
      await new Promise((resolve) => window.setTimeout(resolve, 500));
    }
  } finally {
    accepting = false;
    unsubscribe();
    window.removeEventListener("keydown", onKeyDown);
    if (sdk === getFiaiSDK()) await dismissMetanodeWalletPicker();
  }
  if (walletPickerError instanceof Error) throw walletPickerError;
  throw new Error("Đã hết thời gian chọn ví MetaNode cho tài khoản này.");
}

export async function activateMetanodeWallet(address: string): Promise<boolean> {
  if (!isWalletAddress(address)) return false;
  const context = walletContextVersion;
  const sdk = (await ensureFiaiFramesReady()) ?? getFiaiSDK();
  if (!sdk) throw new Error("FiaiSDK is not available.");

  const wallet = (await getWallets()).find(
    (candidate) => readAddress(candidate)?.toLowerCase() === address.toLowerCase()
  );
  if (!wallet) return false;

  const activeWallet = await sdk
    .request<unknown>("getActiveWalletDapp", { domain: window.location.hostname })
    .catch(() => null);
  if (context !== walletContextVersion || sdk !== getFiaiSDK() || sdk.isDestroyed) return false;
  if (readAddress(activeWallet)?.toLowerCase() === address.toLowerCase()) return true;

  if (context !== walletContextVersion || sdk !== getFiaiSDK() || sdk.isDestroyed) return false;
  const acknowledged = await sdk
    .request("setActiveWalletDapp", {
      ...(wallet as Record<string, unknown>),
      domain: window.location.hostname,
    })
    .catch(() => false);
  if (acknowledged !== true) return false;
  const confirmed = await sdk.request<unknown>("getActiveWalletDapp", { domain: window.location.hostname }).catch(() => null);
  return context === walletContextVersion && sdk === getFiaiSDK() && !sdk.isDestroyed &&
    readAddress(confirmed)?.toLowerCase() === address.toLowerCase();
}

/**
 * Ghi nhớ ví người dùng chọn trong "Trung tâm ví" cho tài khoản Plane hiện tại
 * (localStorage theo user + hồ sơ user + setActiveWalletDapp cho domain), rồi xác nhận lại với
 * Crypto Vault. Dùng khi người dùng chủ động đổi ví — khác với auto-resolve nền.
 */
export async function linkMetanodeWalletAddress(address: string): Promise<boolean> {
  if (!isWalletAddress(address)) return false;
  const context = walletContextVersion;
  const normalized = normalizeWalletAddress(address);
  if (!await activateMetanodeWallet(normalized) || context !== walletContextVersion) return false;
  const previous = linkedWalletAddress;
  await persistLinkedWallet(normalized);
  if (context !== walletContextVersion) return false;
  if (previous !== normalized) {
    getFiaiSDK()?.emit("wallet-changed", { address: normalized });
    notifyWalletChanged(normalized);
  }
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
  if (forceSelect) {
    const context = walletContextVersion;
    if (activeResolvePromise) await activeResolvePromise.catch(() => null);
    await ensureFiaiFramesReady();
    if (context !== walletContextVersion) throw new Error("Tài khoản đã thay đổi. Vui lòng chọn ví lại.");
    return selectAndLinkWallet();
  }
  if (activeSelectionPromise) return silent ? ZERO_ADDRESS : activeSelectionPromise;
  if (!forceSelect && activeResolvePromise) {
    const result = await activeResolvePromise.catch(() => null);
    if (result && isWalletAddress(result) && result !== ZERO_ADDRESS) {
      return result;
    }
    if (silent) {
      return result || ZERO_ADDRESS;
    }
  }

  const task = doResolveMetanodeWalletAddress(silent, forceSelect).finally(() => {
    if (activeResolvePromise === task) activeResolvePromise = null;
  });
  activeResolvePromise = task;
  return task;
}

async function doResolveMetanodeWalletAddress(silent: boolean, forceSelect = false): Promise<string> {
  if (typeof window === "undefined") throw new Error("MetaNode wallet is only available in the browser.");

  if (!isMetanodeWalletRuntimeSupported()) {
    throw new Error(
      "Trình duyệt chặn kết nối ví trên địa chỉ không bảo mật. Hãy mở Plane bằng địa chỉ do quản trị viên cung cấp."
    );
  }

  const context = walletContextVersion;
  const resolveSdk = silent ? await initFiaiSDK() : await ensureFiaiFramesReady();
  const assertContext = () => {
    if (context !== walletContextVersion || resolveSdk !== getFiaiSDK() || resolveSdk?.isDestroyed) throw new Error("Tài khoản hoặc phiên ví đã thay đổi. Vui lòng thử lại.");
  };
  assertContext();

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
  assertContext();
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
          if (context !== walletContextVersion) throw new Error("Tài khoản đã thay đổi. Vui lòng thử lại.");
          if (silent) return candidate;
          if (!await linkMetanodeWalletAddress(candidate)) throw new Error("Chưa kích hoạt được ví đã liên kết. Vui lòng thử lại.");
          return candidate;
        }
      }

      // If Crypto Vault already has an active wallet that was selected (e.g. from connect-wallet iframe or another tab)
      const activeFallback = fallbackCandidates.find((c) => availableAddresses.includes(c));
      if (activeFallback) {
        if (context !== walletContextVersion) throw new Error("Tài khoản đã thay đổi. Vui lòng thử lại.");
        if (silent) return activeFallback;
        if (!await linkMetanodeWalletAddress(activeFallback)) throw new Error("Chưa xác nhận được ví đang dùng. Vui lòng thử lại.");
        return activeFallback;
      }
    }

    // Single wallet in vault -> no need to prompt ONLY if not forcing user selection
    if (availableAddresses.length === 1 && !forceSelect) {
      const singleWallet = availableAddresses[0];
      if (context !== walletContextVersion) throw new Error("Tài khoản đã thay đổi. Vui lòng thử lại.");
      if (silent) return singleWallet;
      if (!await linkMetanodeWalletAddress(singleWallet)) throw new Error("Chưa kích hoạt được ví. Vui lòng thử lại.");
      return singleWallet;
    }

    // Multiple wallets in vault:
    if (silent && !forceSelect) {
      return ZERO_ADDRESS;
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

/** Missing keys are imported through Plane's Wallet Center, using the same Vault. */
export async function promptForMetanodeWalletImport(address: string): Promise<boolean> {
  if (typeof window === "undefined" || !isWalletAddress(address)) return false;
  const target = normalizeWalletAddress(address);
  if (await hasWallet(target)) return linkMetanodeWalletAddress(target);
  openWalletCenter("import");
  return false;
}
