import { FiaiSDK } from "@metanodejs/fiai-sdk";
import { invalidateAllSigningSessions, registerChainSigningPreflight } from "@plane/services";

type FiaiSdkWindow = Window & {
  fiaiSDK?: FiaiSDK;
};

let initPromise: Promise<FiaiSDK | null> | null = null;
let sdkInstance: FiaiSDK | null = null;
let lastSelectedWallet: unknown = null;
let sdkGeneration = 0;
let disposeWalletBridge: (() => void) | null = null;
let pendingSdkTask: Promise<FiaiSDK> | null = null;
const walletSelectionListeners = new Set<(wallet: unknown) => void>();
const pickerSources = new Map<Window, { origin: string; removedAt: number | null }>();
registerChainSigningPreflight(async () => {
  if (!await ensureFiaiFramesReady()) throw new Error("Chưa kết nối được ứng dụng ví. Vui lòng thử lại.");
});

export function subscribeMetanodeWalletSelection(listener: (wallet: unknown) => void): () => void {
  if (walletSelectionListeners.size === 0) pickerSources.clear();
  captureWalletPickerSources();
  walletSelectionListeners.add(listener);
  return () => { walletSelectionListeners.delete(listener); };
}

function captureWalletPickerSources(): void {
  const present = new Set<Window>();
  for (const frame of document.querySelectorAll<HTMLIFrameElement>('.fiai-modal-overlay iframe[name="mini_wallet"]')) {
    if (!frame.contentWindow) continue;
    try {
      present.add(frame.contentWindow);
      pickerSources.set(frame.contentWindow, { origin: new URL(frame.src).origin, removedAt: null });
    } catch { /* A loading iframe has no usable origin yet. */ }
  }
  for (const [source, state] of pickerSources) {
    if (!present.has(source) && state.removedAt === null) state.removedAt = Date.now();
    if (state.removedAt !== null && Date.now() - state.removedAt > 1000) pickerSources.delete(source);
  }
}

/** A wallet decision must come from the actual picker, at the configured origin. */
export function isTrustedWalletMessage(event: MessageEvent): boolean {
  const configured = readEnv("VITE_URL_CONNECT_WALLET");
  if (!configured || !event.source || event.origin === "null") return false;
  try {
    const expected = new URL(configured, window.location.href).origin;
    captureWalletPickerSources();
    // SDK may hide its modal before the picker posts wallet-selected. Retain the
    // observed WindowProxy briefly; clear it at the next selection/reset boundary.
    const source = pickerSources.get(event.source as Window);
    return event.origin === expected && source?.origin === expected;
  } catch { return false; }
}

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

function registerWalletSelectionBridge(sdk: FiaiSDK): () => void {
  let disposed = false;

  const emitWalletSelected = (params: unknown) => {
    if (disposed || sdk.isDestroyed) return;
    const wallet = params && typeof params === "object" ? (params as Record<string, unknown>) : {};
    if (typeof wallet.address !== "string" || !/^(0x)?[a-fA-F0-9]{40}$/.test(wallet.address)) return;
    lastSelectedWallet = wallet;
    walletSelectionListeners.forEach((listener) => listener(wallet));
    sdk.emit("onSetActiveWallet", wallet);
  };

  const onMessage = (event: MessageEvent) => {
    if (event.data?.type === "wallet-selected" && isTrustedWalletMessage(event)) emitWalletSelected(event.data.data);
  };
  window.addEventListener("message", onMessage);
  const observer = typeof MutationObserver === "undefined" ? null : new MutationObserver(captureWalletPickerSources);
  observer?.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["src", "name"] });

  let lastWriteSenderKey = "";

  const requestInterceptor: (typeof sdk.interceptors.request)[number] = (request) => {
    if (disposed) return request;
    if (request.action === "sendTransaction" && request.params && typeof request.params === "object") {
      const params = request.params as Record<string, unknown>;
      if (params.feeType === "sc") {
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
  };
  sdk.interceptors.request.push(requestInterceptor);

  const responseInterceptor = (response: unknown) => {
    if (disposed) return response;
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
  };
  sdk.interceptors.response.push(responseInterceptor);
  // Keep the SDK's setActiveWallet handler: it awaits Vault instead of acknowledging early.
  return () => {
    disposed = true;
    window.removeEventListener("message", onMessage);
    observer?.disconnect();
    pickerSources.clear();
    const requestIndex = sdk.interceptors.request.indexOf(requestInterceptor);
    if (requestIndex >= 0) sdk.interceptors.request.splice(requestIndex, 1);
    const responseIndex = sdk.interceptors.response.indexOf(responseInterceptor);
    if (responseIndex >= 0) sdk.interceptors.response.splice(responseIndex, 1);
  };
}

export function getFiaiSDK(): FiaiSDK | null {
  return sdkInstance;
}

/** Các frame bắt buộc phải handshake xong trước khi ký giao dịch. */
const REQUIRED_SIGNING_FRAMES = ["blockchain-bridge", "crypto-vault"] as const;

export function getFiaiFrameStatus(): Record<string, string> {
  const sdk = sdkInstance as unknown as { getStatus?: () => Record<string, string> } | null;
  if (!sdk || typeof sdk.getStatus !== "function") return {};
  try {
    return sdk.getStatus();
  } catch {
    return {};
  }
}

/**
 * Bảo đảm các iframe cần cho việc ký (bridge 6001 + Crypto Vault 6002) đã sẵn sàng.
 *
 * `FiaiSDK.init` chỉ chờ tối đa 10s cho mỗi frame rồi bỏ qua frame lỗi. Nếu Crypto Vault
 * không load được, `sendTransaction` sẽ treo tới khi timeout mà người dùng KHÔNG hề thấy
 * hộp thoại mật khẩu — nhìn bên ngoài giống như "bấm Sync mà không có gì xảy ra".
 * Hàm này biến tình huống đó thành lỗi rõ ràng, kèm trạng thái từng frame.
 */
export async function ensureFiaiFramesReady(timeoutMs = 20_000): Promise<FiaiSDK | null> {
  const sdk = await initFiaiSDK();
  if (!sdk) return null;

  const getMissingFrames = (): string[] => {
    if (sdk !== sdkInstance || sdk.isDestroyed) throw new Error("Phiên ví đã thay đổi. Vui lòng thử lại.");
    const status = getFiaiFrameStatus();
    // Mock SDK (hoặc SDK không expose getStatus) → không kiểm tra được, cho qua.
    if (Object.keys(status).length === 0 && readEnv("VITE_MOCK_FIAI") === "true") return [];
    return REQUIRED_SIGNING_FRAMES.filter((name) => status[name] !== "ready");
  };

  if (getMissingFrames().length === 0) return sdk;

  const deadline = Date.now() + timeoutMs;
  const poll = (): Promise<FiaiSDK> =>
    new Promise<void>((resolve) => {
      window.setTimeout(resolve, 500);
    }).then(() => {
      const stillMissing = getMissingFrames();
      if (stillMissing.length === 0) return sdk;
      if (Date.now() >= deadline) {
        const status = getFiaiFrameStatus();
        console.error("[FiaiSDK] Frame chưa sẵn sàng để ký:", stillMissing, status);
        throw new Error(
          `MetaNode frame chưa sẵn sàng: ${stillMissing.map((name) => `${name}=${status[name] ?? "unknown"}`).join(", ")}. ` +
            `Hãy kiểm tra kết nối tới ${readEnv("VITE_FIAI_BLOCKCHAIN_BRIDGE_URL")} và ${readEnv("VITE_FIAI_CRYPTO_VAULT_URL")} rồi thử lại.`
        );
      }
      return poll();
    });

  return poll();
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
  if (pendingSdkTask) throw new Error("SDK đang kết thúc phiên khởi tạo trước. Vui lòng chờ rồi thử lại.");
  const generation = sdkGeneration;

  const isMock = readEnv("VITE_MOCK_FIAI") === "true";
  if (isMock) {
    console.log("[FiaiSDK] MOCK MODE enabled. Bypassing real SDK init.");
    const mockSdk = {
      on: () => () => { },
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
    container: typeof document !== "undefined" ? document.body : undefined,
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
  if (!blockchainBridge || !cryptoVault || !fileProcessor) throw new Error("Thiếu cấu hình URL của ba dịch vụ MetaNode trong env.");
  initOptions.frameUrls = { blockchainBridge, cryptoVault, fileProcessor };
  initOptions.basePath = readEnv("VITE_ROUTER_BASENAME") || "/";

  let expired = false;
  let timeout: ReturnType<typeof setTimeout>;
  const initTask = FiaiSDK.init(initOptions).then((sdk) => {
    if (expired || generation !== sdkGeneration) {
      sdk.destroy();
      if ((window as FiaiSdkWindow).fiaiSDK === sdk) delete (window as FiaiSdkWindow).fiaiSDK;
      throw new Error("Phiên khởi tạo SDK đã hết hạn. Vui lòng thử lại.");
    }
    return sdk;
  }).finally(() => {
    if (pendingSdkTask === initTask) pendingSdkTask = null;
  });
  pendingSdkTask = initTask;

  const timeoutTask = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      expired = true;
      reject(new Error(`Khởi tạo MetaNode SDK thất bại (quá ${timeoutMs / 1000} giây). Có thể do domain bridge không phản hồi hoặc lỗi SSL (ERR_SSL_UNRECOGNIZED_NAME). Vui lòng kiểm tra VPN hoặc file hosts.`));
    }, timeoutMs);
  });

  initPromise = Promise.race([initTask, timeoutTask])
    .then((sdk) => {
      console.log(`[FiaiSDK] Init thành công!`);
      disposeWalletBridge = registerWalletSelectionBridge(sdk as FiaiSDK);
      sdkInstance = sdk as FiaiSDK;
      (window as FiaiSdkWindow).fiaiSDK = sdk as FiaiSDK;
      return sdk as FiaiSDK;
    })
    .catch((error: unknown) => {
      console.error("[FiaiSDK] Init thất bại hoặc quá timeout:", error);
      throw error;
    })
    .finally(() => {
      clearTimeout(timeout);
      if (generation === sdkGeneration) initPromise = null;
    });

  return initPromise;
}

export function disposeFiaiSDK(): void {
  sdkGeneration++;
  disposeWalletBridge?.();
  disposeWalletBridge = null;
  // SDK.destroy does not hide WalletModal. Close it through its public keyboard
  // handler first so an old picker cannot send decisions into the next session.
  if (typeof window !== "undefined") window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  sdkInstance?.destroy();
  sdkInstance = null;
  latestWalletTxStateByAddress.clear();
  lastSelectedWallet = null;
  initPromise = null;
  if (typeof window !== "undefined") delete (window as FiaiSdkWindow).fiaiSDK;
}

export async function resetFiaiSDK(): Promise<FiaiSDK | null> {
  // Reset SDK chỉ xoá cache nonce/phiên bên trong bundle. Cờ "đã có phiên ký"
  // nằm ở lớp services, nên phải xoá luôn — nếu không, lần ghi kế tiếp sẽ tưởng
  // ví đã mở khoá, gửi giao dịch mà không kèm hộp thoại mật khẩu và thất bại.
  invalidateAllSigningSessions();
  disposeFiaiSDK();
  if (typeof document !== "undefined") document.getElementById("fiai-container")?.remove();
  await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  return initFiaiSDK();
}

