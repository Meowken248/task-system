import type { Wallet } from "@metanodejs/system-core";

import {
  clearLastSelectedMetanodeWallet,
  getFiaiSDK,
  getLastSelectedMetanodeWallet,
  initFiaiSDK,
} from "./fiai-sdk.service";
import { UserService } from "@/services/user.service";

type WalletLike = { address?: unknown };
type ConnectWallet = (mode: "light") => Promise<unknown> | unknown;

let connectWalletFn: ConnectWallet | null = null;
let systemCorePromise: Promise<ConnectWallet> | null = null;
let connectWalletPopup: Window | null = null;
let currentPlaneUserId: string | null = null;
let linkedWalletAddress: string | null = null;
const userService = new UserService();

function walletStorageKey(userId: string): string {
  return `plane:metanode-wallet:${userId}`;
}

export function configureMetanodeWalletUser(userId?: string, walletAddress?: string | null): void {
  currentPlaneUserId = userId || null;
  if (!currentPlaneUserId || typeof window === "undefined") {
    linkedWalletAddress = null;
    return;
  }
  const serverAddress = walletAddress?.trim() || "";
  const localAddress = window.localStorage.getItem(walletStorageKey(currentPlaneUserId))?.trim() || "";
  linkedWalletAddress = isWalletAddress(serverAddress)
    ? normalizeWalletAddress(serverAddress)
    : isWalletAddress(localAddress)
      ? normalizeWalletAddress(localAddress)
      : null;
}

export function getLinkedMetanodeWalletAddress(): string | null {
  return linkedWalletAddress;
}
export function isMetanodeWalletRuntimeSupported(): boolean {
  if (typeof window === "undefined") return false;
  // On HTTP localhost development, browser prevents subframe iframe TLS connection to external domains.
  // Using the popup window allows top-level navigation, avoiding ERR_SSL_UNRECOGNIZED_NAME_ALERT.
  const isLocalDev = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
  if (isLocalDev) return false;
  return window.isSecureContext && "serviceWorker" in navigator;
}

function openConnectWalletPage(): void {
  const connectWalletUrl = process.env.VITE_URL_CONNECT_WALLET?.trim();
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
    if (isWalletAddress(value)) return value;
    try {
      return readAddress(JSON.parse(value));
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object") return null;
  const address = (value as WalletLike).address;
  if (typeof address === "string" && isWalletAddress(address)) return address;
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
  return readAddress(await sdk.request<unknown>("getActiveWallet", {}).catch(() => null));
}

async function dismissMetanodeWalletPicker(address: string): Promise<void> {
  const wallet = (await getWallets().catch(() => [])).find(
    (candidate) => readAddress(candidate)?.toLowerCase() === address.toLowerCase()
  );

  if (wallet) {
    void import("@metanodejs/system-core")
      .then(({ closeSelectPaymentWallet }) => closeSelectPaymentWallet(wallet as Wallet))
      .catch((error) => console.warn("MetaNode wallet picker could not be closed through system-core:", error));
  }

  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  connectWalletPopup?.close();
  connectWalletPopup = null;
}

async function persistLinkedWallet(address: string): Promise<void> {
  if (!currentPlaneUserId) throw new Error("Hãy đăng nhập Plane trước khi kết nối ví MetaNode.");
  const normalizedAddress = normalizeWalletAddress(address);
  linkedWalletAddress = normalizedAddress;
  window.localStorage.setItem(walletStorageKey(currentPlaneUserId), normalizedAddress);
  try {
    await userService.updateUser({ metanode_wallet_address: normalizedAddress });
  } catch (error) {
    linkedWalletAddress = null;
    window.localStorage.removeItem(walletStorageKey(currentPlaneUserId));
    throw new Error("Ví này đã được liên kết với tài khoản khác hoặc không thể lưu vào hồ sơ Plane.", {
      cause: error,
    });
  }
}

async function selectAndLinkWallet(): Promise<string> {
  if (!currentPlaneUserId) throw new Error("Hãy đăng nhập Plane trước khi kết nối ví MetaNode.");
  clearLastSelectedMetanodeWallet();

  // Crypto Vault may already contain a single wallet while system-core keeps
  // the `connectWallet` promise pending forever. In that case there is no
  // ambiguity: link the only available wallet and let MtnContract open the
  // password/signing screen directly.
  const activeAddress = await getActiveWalletAddress();
  if (activeAddress) {
    await persistLinkedWallet(activeAddress);
    return normalizeWalletAddress(activeAddress);
  }

  const availableAddresses = [
    ...new Set(
      (await getWallets())
        .map((wallet) => readAddress(wallet))
        .filter((address): address is string => Boolean(address))
        .map(normalizeWalletAddress)
    ),
  ];
  if (availableAddresses.length === 1) {
    await persistLinkedWallet(availableAddresses[0]);
    return availableAddresses[0];
  }

  // system-core may keep this promise pending after a wallet has been selected.
  // Start the picker without blocking, then observe the active wallet through
  // Crypto Vault so the Plane flow can finish and close the picker reliably.
  let walletPickerError: unknown;
  let walletPickerAddress: string | null = null;
  void openMetanodeWallet()
    .then((result) => {
      walletPickerAddress = readAddress(result);
    })
    .catch((error) => {
      walletPickerError = error;
      console.error("MetaNode wallet picker failed:", error);
    });

  const deadline = Date.now() + 120_000;
  // Give the wallet picker time to render before accepting its active wallet.
  await new Promise((resolve) => window.setTimeout(resolve, 750));
  while (Date.now() < deadline) {
    // oxlint-disable-next-line no-await-in-loop -- the wallet selection is intentionally polled.
    const selectedAddress =
      walletPickerAddress ?? readAddress(getLastSelectedMetanodeWallet()) ?? (await getActiveWalletAddress());
    if (selectedAddress) {
      try {
        // oxlint-disable-next-line no-await-in-loop -- the account link must finish before transaction signing.
        await persistLinkedWallet(selectedAddress);
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

  const activeWallet = await sdk.request<unknown>("getActiveWallet", {}).catch(() => null);
  if (readAddress(activeWallet)?.toLowerCase() === address.toLowerCase()) return true;

  const { setWalletActiveDApp } = await import("@metanodejs/system-core");
  await setWalletActiveDApp(wallet as Wallet);
  await sdk
    .request("setActiveWalletDapp", {
      ...(wallet as Record<string, unknown>),
      domain: window.location.hostname,
    })
    .catch((error) => console.warn("Unable to persist the active MetaNode wallet:", error));
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

  // RuntimeSW used by system-core only works in a secure context. LAN development
  // over plain HTTP must use the hosted HTTPS Connect Wallet page instead.
  if (!isMetanodeWalletRuntimeSupported()) {
    openConnectWalletPage();
    return Promise.resolve();
  }

  // The module is preloaded by MetanodeBootstrap, so this call remains inside
  // the user's click and browsers do not block the wallet dialog as a popup.
  if (connectWalletFn) return Promise.resolve(connectWalletFn("light"));
  return preloadMetanodeWallet()?.then((connectWallet) => connectWallet("light")) ?? Promise.resolve();
}

export async function resolveMetanodeWalletAddress(): Promise<string> {
  if (typeof window === "undefined") throw new Error("MetaNode wallet is only available in the browser.");
  await initFiaiSDK();
  if (linkedWalletAddress && isWalletAddress(linkedWalletAddress)) return linkedWalletAddress;
  return selectAndLinkWallet();
}
async function hasWallet(address: string): Promise<boolean> {
  const wallets = await getWallets().catch(() => []);
  return wallets.some((wallet) => readAddress(wallet)?.toLowerCase() === address.toLowerCase());
}

export async function promptForMetanodeWalletImport(address: string): Promise<boolean> {
  if (typeof window === "undefined" || !isWalletAddress(address)) return false;
  if (await hasWallet(address)) return activateMetanodeWallet(address);

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
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    // oxlint-disable-next-line no-await-in-loop -- wallet availability must be polled sequentially.
    if (await hasWallet(address)) {
      // oxlint-disable-next-line no-await-in-loop -- activation must finish before closing the wallet window.
      const activated = await activateMetanodeWallet(address);
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      connectWalletPopup?.close();
      connectWalletPopup = null;
      return activated;
    }
    // oxlint-disable-next-line no-await-in-loop -- this delay intentionally throttles the polling loop.
    await new Promise((resolve) => window.setTimeout(resolve, 500));
  }
  return false;
}
