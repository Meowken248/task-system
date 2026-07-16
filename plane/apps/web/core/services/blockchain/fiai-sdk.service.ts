import { FiaiSDK } from "@metanodejs/fiai-sdk";

type FiaiSdkWindow = Window & {
  fiaiSDK?: FiaiSDK;
};

const DEFAULT_FRAME_URLS = {
  blockchainBridge: "https://blockchain-bridge.fi.ai/",
  cryptoVault: "https://crypto-vault.fi.ai/",
  fileProcessor: "https://file-processor.fi.ai/",
};

let initPromise: Promise<FiaiSDK | null> | null = null;
let sdkInstance: FiaiSDK | null = null;

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

export async function initFiaiSDK(): Promise<FiaiSDK | null> {
  if (typeof window === "undefined" || typeof document === "undefined") return null;
  if (sdkInstance && !sdkInstance.isDestroyed) return sdkInstance;
  if (initPromise) return initPromise;

  initPromise = FiaiSDK.init({
    container: getOrCreateContainer(),
    timeout: Number(process.env.VITE_FIAI_TIMEOUT || 60_000),
    debug: process.env.NODE_ENV === "development",
    frameUrls: getFrameUrls(),
    onError: (error) => console.error("FiaiSDK error:", error),
  })
    .then((sdk) => {
      sdkInstance = sdk;
      (window as FiaiSdkWindow).fiaiSDK = sdk;
      return sdk;
    })
    .catch((error: unknown) => {
      console.error("Failed to initialize FiaiSDK:", error);
      return null;
    })
    .finally(() => {
      initPromise = null;
    });

  return initPromise;
}

export function disposeFiaiSDK(): void {
  sdkInstance?.destroy();
  sdkInstance = null;
  initPromise = null;
  if (typeof window !== "undefined") delete (window as FiaiSdkWindow).fiaiSDK;
}


export async function resetFiaiSDK(): Promise<FiaiSDK | null> {
  disposeFiaiSDK();
  if (typeof document !== "undefined") document.getElementById("fiai-container")?.remove();
  await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  return initFiaiSDK();
}
