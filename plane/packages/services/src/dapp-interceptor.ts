import type { AxiosInstance, InternalAxiosRequestConfig, AxiosResponse } from "axios";
import { parseData } from "./dapp/store";
import { handleRoute } from "./dapp/routes";

// ── Re-export public blockchain & IPFS synchronization API ───────────────────
export {
  baseCID,
  currentUserAddress,
  getLastUploadedCID,
  isIPFSUploading,
  resolveDBConflict,
  restoreFromIPFS,
  initDAppDB,
  syncDAppDBToChain,
} from "./dapp/chain";

// ── Re-export types and storage utilities for modular consumers ──────────────
export * from "./dapp/types";
export { localDB, defaultDB, saveDB, getDBSnapshot } from "./dapp/store";

/**
 * Public: Install decentralized interceptor on an Axios instance.
 * Completely intercepts API requests and routes them to local offchain store + IPFS/onchain sync.
 */
export function setupDAppInterceptor(axiosInstance: AxiosInstance): void {
  axiosInstance.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
    config.adapter = async (adapterConfig) => {
      let url = adapterConfig.url || "";
      const method = (adapterConfig.method || "get").toLowerCase();
      const body = parseData(adapterConfig.data);

      // Serialize params into URL so route handlers can read query params
      if (adapterConfig.params && typeof adapterConfig.params === "object") {
        const qs = Object.entries(adapterConfig.params)
          .filter(([, v]) => v !== undefined && v !== null)
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
          .join("&");
        if (qs) {
          url += (url.indexOf("?") === -1 ? "?" : "&") + qs;
        }
      }

      const { data, status } = await handleRoute(method, url, body);

      if (status >= 400) {
        const error: any = new Error(`Request failed with status code ${status}`);
        error.name = "AxiosError";
        error.code = status === 401 ? "ERR_BAD_REQUEST" : "ERR_BAD_RESPONSE";
        error.status = status;
        error.response = {
          data,
          status,
          statusText: "Error",
          headers: {},
          config: adapterConfig,
          request: {},
        };
        throw error;
      }

      return {
        data,
        status,
        statusText: "OK",
        headers: {},
        config: adapterConfig,
        request: {},
      } as AxiosResponse;
    };
    return config;
  });
}