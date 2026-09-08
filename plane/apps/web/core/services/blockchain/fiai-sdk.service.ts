import { FiaiSDK } from "@metanodejs/fiai-sdk";

type FiaiSdkWindow = Window & {
  fiaiSDK?: FiaiSDK;
};

const DEFAULT_FRAME_URLS = {
  blockchainBridge: "https://json.iqnb.com/fiai-sdk/blockchain-bridge/",
  cryptoVault: "https://json.iqnb.com/fiai-sdk/crypto-vault/",
  fileProcessor: "https://json.iqnb.com/fiai-sdk/file-processor/",
};

let initPromise: Promise<FiaiSDK | null> | null = null;
let sdkInstance: FiaiSDK | null = null;
let lastSelectedWallet: unknown = null;

type WalletBridgeSdk = FiaiSDK & {
  __planeWalletBridge?: boolean;
};

function registerWalletSelectionBridge(sdk: FiaiSDK): void {
  const bridgedSdk = sdk as WalletBridgeSdk;
  if (bridgedSdk.__planeWalletBridge) return;
  bridgedSdk.__planeWalletBridge = true;

  const emitWalletSelected = (params: unknown) => {
    const wallet = params && typeof params === "object" ? (params as Record<string, unknown>) : {};
    lastSelectedWallet = wallet;
    sdk.emit("onSetActiveWallet", wallet);
    sdk.emit("wallet-changed", wallet);
  };

  sdk.interceptors.request.push((request) => {
    if (request.action === "setActiveWalletDapp" || request.action === "setWalletActiveDApp") {
      emitWalletSelected(request.params);
    }
    return request;
  });

  sdk.registerHostAction("setActiveWallet", async (params: unknown) => {
    const wallet = params && typeof params === "object" ? (params as Record<string, unknown>) : {};

    // Acknowledge immediately so Crypto Vault can leave the picker and show
    // the password/signing screen.
    emitWalletSelected(wallet);
    void sdk
      .request("setActiveWalletDapp", {
        ...wallet,
        domain: window.location.hostname,
      })
      .catch((error) => console.warn("Unable to persist the active MetaNode wallet:", error));

    return { success: true };
  });
}

function getFrameUrls() {
  return {
    blockchainBridge: process.env.VITE_FIAI_BLOCKCHAIN_BRIDGE_URL || DEFAULT_FRAME_URLS.blockchainBridge,
    cryptoVault: process.env.VITE_FIAI_CRYPTO_VAULT_URL || DEFAULT_FRAME_URLS.cryptoVault,
    fileProcessor: process.env.VITE_FIAI_FILE_PROCESSOR_URL || DEFAULT_FRAME_URLS.fileProcessor,
  };
}

function getOrCreateContainer(): HTMLElement {
  const existingContainer = document.getElementById("fiai-container");
  if (existingContainer) return existingContainer;

  const container = document.createElement("div");
  container.id = "fiai-container";
  container.setAttribute("aria-hidden", "true");
  Object.assign(container.style, {
    position: "absolute",
    width: "0",
    height: "0",
    overflow: "hidden",
    pointerEvents: "none",
  });
  document.body.appendChild(container);
  return container;
}

export function getFiaiSDK(): FiaiSDK | null {
  return sdkInstance;
}

export function getLastSelectedMetanodeWallet(): unknown {
  return lastSelectedWallet;
}

export function clearLastSelectedMetanodeWallet(): void {
  lastSelectedWallet = null;
}

export async function initFiaiSDK(): Promise<FiaiSDK | null> {
  if (typeof window === "undefined" || typeof document === "undefined") return null;
  if (sdkInstance && !sdkInstance.isDestroyed) return sdkInstance;
  if (initPromise) return initPromise;

  const isMock = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_MOCK_FIAI === "true") || (typeof process !== 'undefined' && process.env?.VITE_MOCK_FIAI === "true");
  if (isMock) {
    console.log("[FiaiSDK] MOCK MODE enabled. Bypassing real SDK init.");
    const mockSdk = {
      on: () => { },
      request: async (method: string, params: any) => {
        if (method === "sendTransaction") {
          console.log("[FiaiSDK Mock] Fake sendTransaction:", params);
          return { hash: "0xmocktxhash" };
        }
        return null;
      },
      isDestroyed: false,
      destroy: () => { }
    } as unknown as FiaiSDK;
    sdkInstance = mockSdk;
    (window as any).fiaiSDK = mockSdk;
    return mockSdk;
  }

  const timeoutMs = Number(process.env.VITE_FIAI_TIMEOUT) || 60_000;
  console.log(`[FiaiSDK] Bắt đầu init với timeout ${timeoutMs}ms...`);

  const initTask = FiaiSDK.init({});

  const timeoutTask = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Khởi tạo MetaNode SDK thất bại (quá ${timeoutMs / 1000} giây). Có thể do domain bridge không phản hồi hoặc lỗi SSL (ERR_SSL_UNRECOGNIZED_NAME). Vui lòng kiểm tra VPN hoặc file hosts.`));
    }, timeoutMs);
  });

  initPromise = Promise.race([initTask, timeoutTask])
    .then((sdk) => {
      console.log(`[FiaiSDK] Init thành công!`);
      registerWalletSelectionBridge(sdk as FiaiSDK);
      sdkInstance = sdk as FiaiSDK;
      (window as FiaiSdkWindow).fiaiSDK = sdk as FiaiSDK;
      return sdk as FiaiSDK;
    })
    .catch((error: unknown) => {
      console.error("[FiaiSDK] Init thất bại hoặc quá timeout:", error);
      throw error;
    })
    .finally(() => {
      initPromise = null;
    });

  return initPromise;
}

export function disposeFiaiSDK(): void {
  sdkInstance?.destroy();
  sdkInstance = null;
  lastSelectedWallet = null;
  initPromise = null;
  if (typeof window !== "undefined") delete (window as FiaiSdkWindow).fiaiSDK;
}

export async function resetFiaiSDK(): Promise<FiaiSDK | null> {
  disposeFiaiSDK();
  if (typeof document !== "undefined") document.getElementById("fiai-container")?.remove();
  await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  return initFiaiSDK();
}
