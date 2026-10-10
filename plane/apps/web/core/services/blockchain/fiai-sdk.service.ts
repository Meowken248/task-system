import { FiaiSDK } from "@metanodejs/fiai-sdk";

type FiaiSdkWindow = Window & {
  fiaiSDK?: FiaiSDK;
};

let initPromise: Promise<FiaiSDK | null> | null = null;
let sdkInstance: FiaiSDK | null = null;
let lastSelectedWallet: unknown = null;

type CapturedWalletTxState = {
  lastHash: string;
  lastDeviceKey?: string;
  updatedAt: number;
};

const latestWalletTxStateByAddress = new Map<string, CapturedWalletTxState>();

function readEnv(name: string): string {
  const fromProcess = typeof process !== "undefined" ? process.env?.[name] : undefined;
  const fromMeta = typeof import.meta !== "undefined" ? (import.meta as any).env?.[name] : undefined;
  return (fromProcess ?? fromMeta ?? "").toString().trim();
}

function normalizeAddrKey(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return "";
  return trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
}

function normalizeHexHash(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const raw = trimmed.startsWith("0x") || trimmed.startsWith("0X") ? trimmed.slice(2) : trimmed;
  return /^[a-fA-F0-9]{64}$/.test(raw) ? `0x${raw}` : null;
}

export function getLatestCapturedWalletTxHash(address?: string): string | null {
  if (address) {
    const key = normalizeAddrKey(address);
    return latestWalletTxStateByAddress.get(key)?.lastHash ?? null;
  }
  let newest: CapturedWalletTxState | null = null;
  for (const state of latestWalletTxStateByAddress.values()) {
    if (!newest || state.updatedAt > newest.updatedAt) {
      newest = state;
    }
  }
  return newest?.lastHash ?? null;
}

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

  if (typeof window !== "undefined") {
    window.addEventListener("message", (event) => {
      if (event.data && typeof event.data === "object" && event.data.type === "wallet-selected") {
        emitWalletSelected(event.data.data);
      }
    });
  }

  let lastWriteSenderKey = "";

  sdk.interceptors.request.push((request) => {
    if (request.action === "setActiveWalletDapp" || request.action === "setWalletActiveDApp") {
      emitWalletSelected(request.params);
    } else if (request.action === "sendTransaction" && request.params && typeof request.params === "object") {
      const params = request.params as Record<string, unknown>;
      if (!params.isReadOnly) {
        lastWriteSenderKey = normalizeAddrKey(params.from);
      }
    } else if (request.action === "updateWalletInfo" && request.params && typeof request.params === "object") {
      const params = request.params as Record<string, unknown>;
      const addrKey = normalizeAddrKey(params.address);
      const normHash = normalizeHexHash(params.lastHash);
      if (addrKey && normHash) {
        latestWalletTxStateByAddress.set(addrKey, {
          lastHash: normHash,
          lastDeviceKey: typeof params.lastDeviceKey === "string" ? params.lastDeviceKey : undefined,
          updatedAt: Date.now(),
        });
      }
    }
    return request;
  });

  sdk.interceptors.response.push((response: unknown) => {
    if (!response || typeof response !== "object" || Array.isArray(response)) return response;
    const enrichPayload = (obj: Record<string, unknown>): Record<string, unknown> => {
      if (typeof obj.address === "string") {
        const addrKey = normalizeAddrKey(obj.address);
        const captured = addrKey ? latestWalletTxStateByAddress.get(addrKey) : undefined;
        if (captured?.lastHash) {
          return {
            ...obj,
            lastHash: captured.lastHash,
            ...(captured.lastDeviceKey ? { lastDeviceKey: captured.lastDeviceKey } : {}),
          };
        }
      } else if ("returnValue" in obj && !obj.hash && !obj.txHash) {
        const captured = lastWriteSenderKey
          ? latestWalletTxStateByAddress.get(lastWriteSenderKey)
          : undefined;
        if (captured?.lastHash) {
          return {
            ...obj,
            hash: captured.lastHash,
            lastHash: captured.lastHash,
          };
        }
      }
      return obj;
    };

    const respObj = response as Record<string, unknown>;
    if (respObj.data && typeof respObj.data === "object" && !Array.isArray(respObj.data)) {
      return {
        ...respObj,
        data: enrichPayload(respObj.data as Record<string, unknown>),
      };
    }
    return enrichPayload(respObj);
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

  const isMock = readEnv("VITE_MOCK_FIAI") === "true";
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

  getOrCreateContainer();

  const timeoutMs = Number(readEnv("VITE_FIAI_TIMEOUT")) || 60_000;
  const rpcUrl = readEnv("VITE_RPC_URL");
  if (!rpcUrl) {
    throw new Error("Thiếu cấu hình VITE_RPC_URL trong file .env.");
  }
  const chainId = Number(readEnv("VITE_CHAIN_ID") || "0");
  let wsUrl = readEnv("VITE_WS_URL") || rpcUrl.replace(/^http/, "ws");
  if (wsUrl && !wsUrl.endsWith("/ws")) {
    wsUrl = `${wsUrl.replace(/\/$/, "")}/ws`;
  }

  console.log(`[FiaiSDK] Bắt đầu init với timeout ${timeoutMs}ms, RPC=${rpcUrl}, WS=${wsUrl}, ChainId=${chainId}`);

  const initOptions: Parameters<typeof FiaiSDK.init>[0] = {
    timeout: timeoutMs,
    chainConfig: {
      rpcUrl,
      wsUrl,
      chainId,
    },
  };

  const blockchainBridge = readEnv("VITE_FIAI_BLOCKCHAIN_BRIDGE_URL");
  const cryptoVault = readEnv("VITE_FIAI_CRYPTO_VAULT_URL");
  const fileProcessor = readEnv("VITE_FIAI_FILE_PROCESSOR_URL");
  const urlConnectWallet = readEnv("VITE_URL_CONNECT_WALLET");

  if (blockchainBridge && cryptoVault && fileProcessor) {
    initOptions.frameUrls = {
      blockchainBridge,
      cryptoVault,
      fileProcessor,
      ...(urlConnectWallet ? { urlConnectWallet } : {}),
    } as NonNullable<Parameters<typeof FiaiSDK.init>[0]>["frameUrls"];
  }

  const initTask = FiaiSDK.init(initOptions);

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

