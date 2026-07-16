import { getFiaiSDK, initFiaiSDK } from "./fiai-sdk.service";

type WalletLike = { address?: unknown };
type ConnectWallet = (mode: "light") => Promise<unknown> | unknown;

let connectWalletFn: ConnectWallet | null = null;
let systemCorePromise: Promise<ConnectWallet> | null = null;
let connectWalletPopup: Window | null = null;
export function isMetanodeWalletRuntimeSupported(): boolean {
  return typeof window !== "undefined" && window.isSecureContext && "serviceWorker" in navigator;
}

function openConnectWalletPage(): void {
  const connectWalletUrl = process.env.VITE_URL_CONNECT_WALLET?.trim();
  if (!connectWalletUrl) throw new Error("VITE_URL_CONNECT_WALLET is missing.");
  connectWalletPopup = window.open(connectWalletUrl, "metanode-connect-wallet", "popup,width=480,height=760");
  if (!connectWalletPopup) throw new Error("Connect Wallet popup was blocked by the browser.");
  connectWalletPopup.focus();
}

export function isWalletAddress(value: string): boolean {
  return /^(0x)?[a-fA-F0-9]{40}$/.test(value.trim());
}

function readAddress(value: unknown): string | null {
  if (typeof value === "string" && isWalletAddress(value)) return value;
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

  await sdk.request("setActiveWallet", wallet as Record<string, unknown>);
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

  const configuredAddress = process.env.VITE_METANODE_WALLET_ADDRESS?.trim();
  if (!configuredAddress || !isWalletAddress(configuredAddress)) {
    throw new Error("VITE_METANODE_WALLET_ADDRESS is invalid.");
  }
  return configuredAddress;
}
async function hasWallet(address: string): Promise<boolean> {
  const wallets = await getWallets().catch(() => []);
  return wallets.some((wallet) => readAddress(wallet)?.toLowerCase() === address.toLowerCase());
}

export async function promptForMetanodeWalletImport(address: string): Promise<boolean> {
  if (typeof window === "undefined" || !isWalletAddress(address)) return false;
  if (await hasWallet(address)) return true;

  void openMetanodeWallet().catch(() => null);
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (await hasWallet(address)) {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      connectWalletPopup?.close();
      connectWalletPopup = null;
      return true;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 500));
  }
  return false;
}
