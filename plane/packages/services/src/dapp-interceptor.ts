import type { AxiosInstance, InternalAxiosRequestConfig, AxiosResponse } from "axios";

declare const process: { env: Record<string, string | undefined> };

const PLANE_CONTRACT = "0x2CB649c0A6338f668F0ADc4AE96c1b2Dc198ed41";

// ── On-chain sync (fire-and-forget, never blocks UI) ──────────────────────
async function syncDAppRecord(collection: string, id: string, _record?: any) {
  // DISABLE generic syncDAppRecord so we don't spam the network with duplicate mock records.
  // The UI will rely purely on the specialized blockchain service (e.g. createTask)
  console.log(`[DApp Sync] Generic sync disabled for ${collection}/${id}`);
}

// ── Default mock user (shared across all seed data) ──────────────────────
const MOCK_USER = {
  id: "me",
  email: "admin@plane.so",
  first_name: "Plane",
  last_name: "Admin",
  display_name: "Plane Admin",
  avatar_url: "",
  is_bot: false,
  is_active: true,
  is_email_verified: true,
  is_password_autoset: false,
  is_tour_completed: true,
  is_onboarded: true,
  onboarding_step: {
    workspace_join: true,
    profile_complete: true,
    workspace_create: true,
    workspace_invite: true,
  },
  mobile_number: null,
  last_workspace_id: "mock-workspace",
  user_timezone: "Asia/Ho_Chi_Minh",
  username: "plane_admin",
  last_login_medium: "email",
  cover_image_url: null,
  date_joined: new Date().toISOString(),
  theme: { theme: "dark" },
};

// ── Seed data (bootstraps a fresh instance) ──────────────────────────────
const defaultDB: Record<string, any[]> = {
  users: [MOCK_USER],
  workspaces: [
    {
      id: "mock-workspace",
      name: "Mock Workspace",
      slug: "mock-workspace",
      created_by: "me",
      owner: {
        id: "me",
        email: "admin@plane.so",
        first_name: "Plane",
        last_name: "Admin",
        avatar: "",
      },
      role: 20,
    },
  ],
};

// ── Auth state (persisted in localStorage) ───────────────────────────────
function getLoggedInUserId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("plane_dapp_auth_user");
}
function isLoggedIn(): boolean {
  return !!getLoggedInUserId();
}
function setLoggedInUser(userId: string | null) {
  if (typeof window === "undefined") return;
  if (userId) localStorage.setItem("plane_dapp_auth_user", userId);
  else localStorage.removeItem("plane_dapp_auth_user");
}

// ── Persistent local store ───────────────────────────────────────────────
let parsedDB: Record<string, any[]> | null = null;
if (typeof window !== "undefined") {
  try {
    const saved = localStorage.getItem("plane_dapp_db");
    if (saved) parsedDB = JSON.parse(saved);
  } catch {
    /* corrupted – will reset */
  }
}
const localDB: Record<string, any[]> = parsedDB && Object.keys(parsedDB).length > 0 ? parsedDB : { ...defaultDB };

const TRANSIENT_COLLECTIONS = ["issues", "issue_comments", "attachments"];

// Safety checks for older local storage DBs missing new seed data
if (!localDB.users) localDB.users = defaultDB.users;
if (!localDB.workspaces || localDB.workspaces.length === 0) localDB.workspaces = defaultDB.workspaces;

// Clear transient collections on startup to enforce blockchain sync
TRANSIENT_COLLECTIONS.forEach(col => {
  localDB[col] = [];
});

// Enforce onboarding state for mock/local users so they don't get stuck in the onboarding flow
if (localDB.users) {
  localDB.users.forEach((u: any) => {
    u.is_onboarded = true;
    u.is_tour_completed = true;
    if (!u.onboarding_step) {
      u.onboarding_step = {
        workspace_join: true,
        profile_complete: true,
        workspace_create: true,
        workspace_invite: true,
      };
    }
  });
}

export let currentUserAddress: string | null = null;

function getDBStorageKey(): string {
  return currentUserAddress || "local";
}

// ── Auto-save to IPFS (debounced) ─────────────────────────────────────
let ipfsDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let lastUploadedCID: string | null = null;
let isUploadingIPFS = false;

/** Get the data object that should be persisted (excludes transient collections) */
function getDBSnapshot(): Record<string, any[]> {
  const dbToSave: Record<string, any[]> = {};
  for (const [key, value] of Object.entries(localDB)) {
    if (!TRANSIENT_COLLECTIONS.includes(key)) {
      dbToSave[key] = value;
    }
  }
  return dbToSave;
}

/** Upload current DB to IPFS (no wallet needed) */
async function uploadToIPFS(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  const dbToSave = getDBSnapshot();

  // Don't upload empty or default-only data
  const hasUserData = Object.keys(dbToSave).some(key =>
    key !== "users" && key !== "workspaces" && dbToSave[key]?.length > 0
  );
  if (!hasUserData) {
    console.log("[DApp DB] Bỏ qua IPFS upload — chưa có dữ liệu user.");
    return null;
  }

  try {
    isUploadingIPFS = true;
    console.log("[DApp DB] Đang tự động upload IPFS...");
    const response = await fetch(getProxyUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(dbToSave),
    });
    if (!response.ok) {
      console.error("[DApp DB] IPFS upload thất bại:", response.status);
      return null;
    }
    const { cid } = await response.json();
    if (!cid) {
      console.error("[DApp DB] Proxy không trả về CID");
      return null;
    }
    lastUploadedCID = cid;
    const storageKey = getDBStorageKey();
    localStorage.setItem(`plane_dapp_ipfs_cid_${storageKey}`, cid);
    console.log(`[DApp DB] ✅ Auto-save IPFS thành công: ${cid}`);

    // Bỏ auto-sync to chain ở đây. On-chain cần chữ ký (popup) nên chỉ nên chạy khi bấm nút Sync.
    return cid;
  } catch (err) {
    console.error("[DApp DB] IPFS upload lỗi:", err);
    return null;
  } finally {
    isUploadingIPFS = false;
  }
}

/** Schedule a debounced IPFS upload (5s after last change) */
function scheduleIPFSUpload() {
  if (ipfsDebounceTimer) clearTimeout(ipfsDebounceTimer);
  ipfsDebounceTimer = setTimeout(() => {
    void uploadToIPFS();
  }, 5000);
}

/** Get the last uploaded CID (for syncDAppDBToChain to reuse) */
export function getLastUploadedCID(): string | null {
  if (lastUploadedCID) return lastUploadedCID;
  if (typeof window === "undefined") return null;
  return localStorage.getItem(`plane_dapp_ipfs_cid_${getDBStorageKey()}`);
}

/** Check if IPFS upload is in progress */
export function isIPFSUploading(): boolean {
  return isUploadingIPFS;
}

function saveDB() {
  if (typeof window === "undefined") return;
  const storageKey = getDBStorageKey();
  const dbToSave = getDBSnapshot();
  localStorage.setItem(`plane_dapp_db_${storageKey}`, JSON.stringify(dbToSave));
  localStorage.setItem(`plane_dapp_is_dirty_${storageKey}`, "true");
  // Auto-save to IPFS after debounce
  scheduleIPFSUpload();
}

// Hàm resolve dùng cho db-bootstrap.tsx xử lý UI conflict
export function resolveDBConflict(choice: "USE_CHAIN" | "USE_LOCAL", cid: string, ipfsDB: any) {
  if (typeof window === "undefined" || !currentUserAddress) return;

  if (choice === "USE_CHAIN") {
    // Ghi đè RAM bằng IPFS
    for (const key in localDB) delete localDB[key];
    Object.assign(localDB, ipfsDB);
    if (!localDB.users) localDB.users = defaultDB.users;
    if (!localDB.workspaces || localDB.workspaces.length === 0) localDB.workspaces = defaultDB.workspaces;
    TRANSIENT_COLLECTIONS.forEach(col => { localDB[col] = []; });

    baseCID = cid;

    // Xóa nháp cũ, tạo nháp sạch mới, XÓA cờ is_dirty
    localStorage.removeItem(`plane_dapp_is_dirty_${currentUserAddress}`);
    localStorage.setItem(`plane_dapp_db_${currentUserAddress}`, JSON.stringify(ipfsDB));

  } else if (choice === "USE_LOCAL") {
    // Dùng nháp cục bộ
    const saved = localStorage.getItem(`plane_dapp_db_${currentUserAddress}`);
    if (saved) {
      const parsed = JSON.parse(saved);
      for (const key in localDB) delete localDB[key];
      Object.assign(localDB, parsed);
      if (!localDB.users) localDB.users = defaultDB.users;
      if (!localDB.workspaces || localDB.workspaces.length === 0) localDB.workspaces = defaultDB.workspaces;
      TRANSIENT_COLLECTIONS.forEach(col => { localDB[col] = []; });
    }
    baseCID = cid; // Đặt baseCID chuẩn để sync sau này có thể chạy check đúng
  }
}

// ── Decentralized IPFS + Blockchain Sync ─────────────────────────────────

export let baseCID: string = "";

const GET_CID_ABI = {
  type: "function",
  name: "getCID",
  inputs: [
    { internalType: "address", name: "user", type: "address" },
    { internalType: "string", name: "key", type: "string" }
  ],
  outputs: [{ internalType: "string", name: "", type: "string" }],
  stateMutability: "view"
};

const SET_CID_IF_MATCHES_ABI = {
  type: "function",
  name: "setCIDIfMatches",
  inputs: [
    { internalType: "string", name: "key", type: "string" },
    { internalType: "string", name: "expectedOldCid", type: "string" },
    { internalType: "string", name: "newCid", type: "string" }
  ],
  outputs: [],
  stateMutability: "nonpayable"
};

const CONTRACT_ADDRESS = "0x1eF16F9e7Faf6977f8a6d13187A9eD7981b4460B";
const PROXY_URL = "https://your-worker-url.workers.dev"; // User will configure in .env but here we can read process.env if available, or pass it via UI. Wait, we can't easily read process.env inside packages/services if it's not injected. Let's use window.VITE_PINATA_PROXY_URL or fallback.
const getProxyUrl = () => {
  if (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_PINATA_PROXY_URL) return (import.meta as any).env.VITE_PINATA_PROXY_URL;
  if (typeof window !== "undefined" && (window as any).__env__?.VITE_PINATA_PROXY_URL) return (window as any).__env__.VITE_PINATA_PROXY_URL;
  if (typeof process !== "undefined" && process.env?.VITE_PINATA_PROXY_URL) return process.env.VITE_PINATA_PROXY_URL;
  return PROXY_URL;
};

// ── Direct RPC (bypass Bridge iframe for read-only calls) ──────────────
const GET_CID_SELECTOR = "0xfa3e97e7"; // keccak256("getCID(address,string)")[0:4]

function getRpcUrl(): string {
  if (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_RPC_URL) return (import.meta as any).env.VITE_RPC_URL;
  if (typeof process !== "undefined" && process.env?.VITE_RPC_URL) return process.env.VITE_RPC_URL;
  return "https://rpc-proxy-sequoia.iqnb.com:8446";
}

function padHex(hex: string, bytes: number): string {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  return clean.padStart(bytes * 2, "0");
}

function utf8ToHex(str: string): string {
  return Array.from(new TextEncoder().encode(str))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** ABI-encode getCID(address, string) calldata without external libs */
function abiEncodeGetCID(userAddress: string, key: string): string {
  // address param (left-padded to 32 bytes)
  const addressHex = padHex(userAddress, 32);
  // string is dynamic → offset pointer at position 1 = 0x40 (64)
  const offsetHex = padHex("40", 32);
  // string length
  const keyBytes = utf8ToHex(key);
  const keyLen = key.length;
  const keyLenHex = padHex(keyLen.toString(16), 32);
  // string data (right-padded to 32-byte boundary)
  const keyDataHex = keyBytes.padEnd(Math.ceil(keyBytes.length / 64) * 64, "0");
  return GET_CID_SELECTOR + addressHex + offsetHex + keyLenHex + keyDataHex;
}

/** Decode ABI-encoded string return value from eth_call hex result */
function decodeAbiString(hexResult: string): string {
  if (!hexResult || hexResult === "0x" || hexResult.length < 130) return "";
  const data = hexResult.startsWith("0x") ? hexResult.slice(2) : hexResult;
  // Skip offset (first 32 bytes) → read length (next 32 bytes) → read string data
  const length = parseInt(data.slice(64, 128), 16);
  if (length === 0) return "";
  const strHex = data.slice(128, 128 + length * 2);
  const bytes = new Uint8Array(strHex.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
  return new TextDecoder().decode(bytes);
}

/** Call a read-only contract function directly via JSON-RPC eth_call */
async function directRpcRead(contractAddr: string, calldata: string, timeoutMs = 15000): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(getRpcUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_call",
        params: [{ to: contractAddr, data: calldata }, "latest"],
      }),
      signal: controller.signal,
    });
    const json = await response.json();
    if (json.error) throw new Error(json.error.message || JSON.stringify(json.error));
    return json.result || "0x";
  } finally {
    clearTimeout(timeoutId);
  }
}

// ── Wallet address helpers ─────────────────────────────────────────────

/** Read wallet address from localStorage (stored by metanode-wallet.service) */
function getStoredWalletAddress(): string | null {
  if (typeof window === "undefined") return null;
  // Try the module-level cached address first
  if (currentUserAddress) return currentUserAddress;
  // Scan localStorage for a previously saved wallet-keyed DB
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith("plane_dapp_db_0x")) {
        const addr = key.replace("plane_dapp_db_", "");
        if (/^0x[a-fA-F0-9]{40}$/.test(addr)) return addr;
      }
    }
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith("plane:metanode-wallet:")) {
        const addr = localStorage.getItem(key)?.trim() || "";
        if (/^0x[a-fA-F0-9]{40}$/.test(addr)) return addr;
      }
    }
  } catch { /* localStorage access can throw in sandboxed iframes */ }
  return null;
}

async function getWalletAddress() {
  const isMock = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_MOCK_FIAI === "true") || (typeof process !== 'undefined' && process.env?.VITE_MOCK_FIAI === "true");
  if (isMock) {
    return "0xMockUserAddress1234567890abcdef12345678";
  }

  // Try localStorage first (instant, no Bridge needed)
  const stored = getStoredWalletAddress();
  if (stored) {
    console.log(`[DApp DB] Wallet từ localStorage: ${stored}`);
    return stored;
  }

  // No wallet in localStorage → return null (don't block page load with Bridge)
  console.log(`[DApp DB] Chưa có wallet trong localStorage. Cần kết nối ví trước.`);
  return null;
}

/** Get wallet via Bridge iframe — only used for write operations (Sync to Chain) */
async function getWalletAddressViaBridge() {
  const isMock = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_MOCK_FIAI === "true") || (typeof process !== 'undefined' && process.env?.VITE_MOCK_FIAI === "true");
  if (isMock) {
    return "0xMockUserAddress1234567890abcdef12345678";
  }

  // 1. Try localStorage first
  const stored = getStoredWalletAddress();
  if (stored) return stored;

  // 2. Fallback: connect through Bridge (slow, requires iframe)
  console.log(`[DApp DB] Đang kết nối ví qua Bridge...`);
  const { getActiveWallet } = await import("@metanodejs/system-core");
  const timeoutMs = 20000;
  const timeoutTask = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Không thể kết nối với ví MetaNode (quá ${timeoutMs / 1000} giây). Lỗi mạng hoặc Bridge không phản hồi.`));
    }, timeoutMs);
  });

  const wallet = await Promise.race([getActiveWallet(), timeoutTask]);
  console.log(`[DApp DB] Kết nối ví thành công:`, wallet);

  // Ép đóng popup vì system-core đôi khi không tự đóng
  if (typeof document !== "undefined") {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  }

  return (wallet as any)?.address || null;
}

async function _initDAppDB() {
  if (typeof window === "undefined") return;
  const activeWallet = await getWalletAddress().catch(() => null);

  if (!activeWallet) {
    // Chưa kết nối ví — load dữ liệu local nếu có
    console.log(`[DApp DB] Chưa có ví. Đọc dữ liệu local...`);
    try {
      const saved = localStorage.getItem("plane_dapp_db_local");
      if (saved) {
        const parsed = JSON.parse(saved);
        for (const key in localDB) delete localDB[key];
        Object.assign(localDB, parsed);
        if (!localDB.users) localDB.users = defaultDB.users;
        if (!localDB.workspaces || localDB.workspaces.length === 0) localDB.workspaces = defaultDB.workspaces;
        TRANSIENT_COLLECTIONS.forEach(col => { localDB[col] = []; });
      }
    } catch { /* ignore parse errors */ }
    return { status: "OK" };
  }

  if (currentUserAddress && activeWallet !== currentUserAddress) {
    for (const key in localDB) delete localDB[key]; // Xoá sạch RAM cũ nếu đổi ví
  }
  currentUserAddress = activeWallet;

  // Nếu trước đó dùng "local" key, migrate sang wallet key
  if (!localStorage.getItem(`plane_dapp_db_${activeWallet}`)) {
    const localData = localStorage.getItem("plane_dapp_db_local");
    if (localData) {
      localStorage.setItem(`plane_dapp_db_${activeWallet}`, localData);
      localStorage.removeItem("plane_dapp_db_local");
      localStorage.removeItem("plane_dapp_is_dirty_local");
      console.log(`[DApp DB] Migrated local data to wallet key: ${activeWallet}`);
    }
  }

  try {
    const isMock = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_MOCK_FIAI === "true") || (typeof process !== 'undefined' && process.env?.VITE_MOCK_FIAI === "true");
    if (isMock) {
      console.log(`[DApp DB] MOCK MODE: Bỏ qua đọc từ contract.`);
      return null; // Trả về null để dùng dữ liệu local
    }

    // ── Direct RPC call: getCID(address, "plane_dapp_db") ──────────────
    // Gọi thẳng qua JSON-RPC eth_call, KHÔNG qua Bridge iframe
    console.log(`[DApp DB] Đọc CID trực tiếp từ RPC (${getRpcUrl()})...`);
    const calldata = abiEncodeGetCID(currentUserAddress as string, "plane_dapp_db");
    const rawResult = await directRpcRead(CONTRACT_ADDRESS, calldata, 15000);
    const cid = decodeAbiString(rawResult);
    console.log(`[DApp DB] CID từ contract:`, cid || "(trống)");

    const isDirty = localStorage.getItem(`plane_dapp_is_dirty_${currentUserAddress}`) === "true";

    if (cid && cid !== "") {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(`https://purple-fascinating-quelea-533.mypinata.cloud/ipfs/${cid}`, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (response.ok) {
        const ipfsDB = await response.json();

        if (isDirty) {
          // Trả về UI để user chọn
          return { status: "CONFLICT", cid, ipfsDB };
        } else {
          resolveDBConflict("USE_CHAIN", cid, ipfsDB);
          return { status: "OK" };
        }
      }
      return { status: "ERROR", message: "Failed to fetch from IPFS" };
    } else {
      // User chưa từng sync
      baseCID = "";
      if (isDirty) {
        const saved = localStorage.getItem(`plane_dapp_db_${currentUserAddress}`);
        if (saved) {
          const parsed = JSON.parse(saved);
          Object.assign(localDB, parsed);
        }
      }
      return { status: "OK" };
    }
  } catch (err) {
    console.error("Failed to load DApp DB from chain:", err);
    throw err;
  }
}

export async function initDAppDB() {
  const timeoutMs = 20000;
  console.log(`[DApp DB] Bắt đầu init, tự động ngắt sau ${timeoutMs}ms...`);

  const timeoutTask = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Quá thời gian kết nối (${timeoutMs / 1000} giây). Lỗi mạng, SSL, hoặc Bridge không phản hồi.`));
    }, timeoutMs);
  });

  return Promise.race([_initDAppDB(), timeoutTask])
    .then(res => {
      console.log(`[DApp DB] Init thành công:`, res);
      return res;
    })
    .catch(err => {
      console.error(`[DApp DB] Init thất bại hoặc quá timeout:`, err);
      throw err;
    });
}

export async function syncDAppDBToChain(forcedWallet?: string) {
  const activeWallet = forcedWallet || getStoredWalletAddress();
  if (!activeWallet) throw new Error("Chưa kết nối ví. Vui lòng kết nối ví từ giao diện.");
  if (currentUserAddress && activeWallet.toLowerCase() !== currentUserAddress.toLowerCase()) {
    throw new Error("Tài khoản ví đã thay đổi. Vui lòng tải lại trang để nạp dữ liệu của ví mới.");
  }
  currentUserAddress = activeWallet;

  // Upload IPFS — reuse auto-saved CID if available, otherwise upload now
  let cid = getLastUploadedCID();
  if (!cid) {
    console.log("[DApp DB] Không có CID đã cache, upload IPFS mới...");
    cid = await uploadToIPFS();
  }
  if (!cid) throw new Error("Không thể upload dữ liệu lên IPFS.");

  const bridge = typeof window !== "undefined" ? (window as any).fiaiSDK : null;
  if (!bridge) throw new Error("FiaiSDK is not available.");

  // Khởi tạo active wallet trong SDK để tránh popup chọn ví (bị lỗi treo) của Bridge
  try {
    const sysCore = await import("@metanodejs/system-core") as any;
    const { getWallets, setWalletActiveDApp } = sysCore;
    const wallets = await getWallets().catch(() => []);
    const walletObj = wallets.find((w: any) => {
      const addr = w.address || w.Address || "";
      return addr.toLowerCase() === currentUserAddress?.toLowerCase();
    });
    if (walletObj) {
      await setWalletActiveDApp(walletObj);
      await bridge.request("setActiveWalletDapp", { ...walletObj, domain: window.location.hostname }).catch(() => null);
    }
  } catch (err) {
    console.warn("[DApp DB] Không thể set active wallet cho SDK:", err);
  }

  const send = () =>
    bridge!.request("sendTransaction", {
      from: currentUserAddress as string,
      to: CONTRACT_ADDRESS,
      abiData: [SET_CID_IF_MATCHES_ABI],
      functionName: "setCIDIfMatches",
      feeType: "sc",
      amount: "0",
      value: "0",
      gas: "3000000",
      type: "transaction",
      inputArray: [
        { ...SET_CID_IF_MATCHES_ABI.inputs[0], value: "plane_dapp_db" },
        { ...SET_CID_IF_MATCHES_ABI.inputs[1], value: baseCID },
        { ...SET_CID_IF_MATCHES_ABI.inputs[2], value: cid }
      ],
      isReadOnly: false,
      bundleId: "",
    });

  const sendWithWalletRecovery = async (): Promise<unknown> => {
    try {
      return await send();
    } catch (error: any) {
      console.log(JSON.stringify(error, null, 2)); // Giữ lại log cho dev test

      const errStr = [
        error?.message,
        error?.toString?.(),
        error?.reason,
        error?.data?.message,
        (() => { try { return JSON.stringify(error); } catch { return ""; } })()
      ].filter(Boolean).join(" | ");

      if (errStr.includes("CID_CONFLICT")) {
        throw new Error("LỖI XUNG ĐỘT: Dữ liệu đã thay đổi ở nơi khác từ lúc bạn mở trang. Tải lại để lấy bản mới nhất trước khi lưu tiếp, nếu không thay đổi của bạn sẽ bị mất khi ghi đè.");
      }
      throw error;
    }
  };

  await sendWithWalletRecovery();

  // Xóa cờ is_dirty CHỈ SAU KHI transaction confirm thành công
  localStorage.removeItem(`plane_dapp_is_dirty_${currentUserAddress}`);
  baseCID = cid;

  return cid;
}

function getInstanceInfo() {
  return {
    instance: {
      id: "dapp-instance",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      instance_name: "Plane DApp",
      whitelist_emails: null,
      instance_id: "dapp-instance",
      license_key: null,
      current_version: "1.0.0",
      latest_version: "1.0.0",
      last_checked_at: new Date().toISOString(),
      namespace: null,
      is_telemetry_enabled: false,
      is_support_required: false,
      is_activated: true,
      is_setup_done: true,
      is_signup_screen_visited: true,
      user_count: 1,
      is_verified: true,
      created_by: null,
      updated_by: null,
      workspaces_exist: true,
    },
    config: {
      enable_signup: true,
      is_workspace_creation_disabled: false,
      is_google_enabled: false,
      is_github_enabled: false,
      is_gitlab_enabled: false,
      is_gitea_enabled: false,
      is_magic_login_enabled: false,
      is_email_password_enabled: true,
      github_app_name: null,
      slack_client_id: null,
      posthog_api_key: null,
      posthog_host: null,
      has_unsplash_configured: false,
      has_llm_configured: false,
      file_size_limit: 5242880,
      is_smtp_configured: false,
      app_base_url: typeof window !== "undefined" ? window.location.origin : "http://localhost:3000",
      space_base_url: null,
      admin_base_url: typeof window !== "undefined" ? window.location.origin : "http://localhost:3001",
      is_self_managed: true,
    },
  };
}

function getUserProfile() {
  return {
    id: "me",
    user: "me",
    role: "admin",
    last_workspace_id: "mock-workspace",
    theme: { theme: "dark", primary: null, background: null, darkPalette: false },
    onboarding_step: { workspace_join: true, profile_complete: true, workspace_create: true, workspace_invite: true },
    is_onboarded: true,
    is_tour_completed: true,
    use_case: null,
    billing_address_country: null,
    billing_address: null,
    has_billing_address: false,
    has_marketing_email_consent: false,
    language: "en",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    start_of_the_week: 1,
  };
}

function getUserSettings() {
  return {
    id: "me",
    email: "admin@plane.so",
    workspace: {
      last_workspace_id: "mock-workspace",
      last_workspace_slug: "mock-workspace",
      last_workspace_name: "Mock Workspace",
      last_workspace_logo: null,
      fallback_workspace_id: "mock-workspace",
      fallback_workspace_slug: "mock-workspace",
      invites: 0,
    },
  };
}

// ── Safe data parser (handles string, object, FormData) ──────────────────
function parseData(raw: any): Record<string, any> {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (typeof raw === "object" && !(raw instanceof FormData)) return raw;
  return {};
}

// ── Route matcher ────────────────────────────────────────────────────────
type RouteResult = { data: any; status: number };

function handleRoute(method: string, url: string, body: Record<string, any>): RouteResult {
  console.log(`[Dapp interceptor] INTERCEPTED ${method.toUpperCase()} ${url}`);
  const activeUserId = getLoggedInUserId();
  const activeUser = localDB.users.find((u: any) => u.id === activeUserId) || MOCK_USER;

  // ── Auth endpoints ──────────────────────────────────────────────────
  if (url.includes("/auth/get-csrf-token")) return ok({ csrf_token: "dapp-csrf-token" });

  if (url.includes("/auth/email-check"))
    return ok({ existing: true, is_password_autoset: false, status: "CREDENTIAL" });

  if (url.includes("/auth/sign-in") || url.includes("/auth/sign-up") || url.includes("/auth/magic-sign-in")) {
    let email = body?.email || "admin@plane.so";
    let user = localDB.users.find((u: any) => u.email === email);

    if (!user) {
      // Create a new user based on MOCK_USER but with new email and ID
      user = {
        ...MOCK_USER,
        id: `user-${Date.now()}`,
        email,
        first_name: email.split("@")[0],
        last_name: "",
        display_name: email.split("@")[0],
      };
      localDB.users.push(user);
      saveDB();
    }

    setLoggedInUser(user.id);
    return ok({ ...user, access_token: "dapp-token", refresh_token: "dapp-refresh" });
  }

  if (url.includes("/auth/forgot-password") || url.includes("/auth/set-password")) return ok({ message: "success" });

  if (url.includes("/auth/sign-out")) {
    setLoggedInUser(null);
    return ok({ message: "success" });
  }

  // ── Instance ────────────────────────────────────────────────────────
  if (url.match(/\/api\/instances\/?$/) || url.match(/\/api\/instances\/\?/)) return ok(getInstanceInfo());

  if (url.includes("/api/instances/configurations")) return ok([]);

  if (url.includes("/api/instances/workspaces"))
    return ok({ results: localDB.workspaces || [], next_cursor: null, prev_cursor: null });

  if (url.includes("/api/instances/admins")) return ok([MOCK_USER]);

  if (url.match(/\/api\/users\/me/)) {
    if (!isLoggedIn()) return { data: { error: "not authenticated" }, status: 401 };

    if (url.includes("/api/users/me/profile")) {
      if (method === "patch" || method === "put" || method === "post") {
        Object.assign(activeUser, body);
        saveDB();
      }
      return ok({
        ...activeUser,
        workspace: { fallback_workspace_id: "mock-workspace", fallback_workspace_slug: "mock-workspace", invites: 0 },
      });
    }

    if (url.includes("/api/users/me/settings")) return ok(getUserSettings());

    if (url.includes("/api/users/me/instance-admin")) return ok({ is_instance_admin: true });

    if (url.includes("/api/users/me/accounts")) return ok([]);

    if (url.includes("/api/users/me/notification-preferences")) return ok({});

    if (url.includes("/project-roles")) return ok({}); // return empty object for project roles

    if (url.includes("/api/users/me/workspaces") && !url.includes("/project-roles") && !url.includes("/invitations")) {
      const workspaces = localDB.workspaces || [];
      return ok(workspaces.map((ws) => ({ ...ws, role: 20 })));
    }

    if (url.includes("/api/users/me/workspaces/invitations") || url.includes("/api/users/me/invitations")) {
      return ok([]);
    }

    if (method === "patch" || method === "put" || method === "post") {
      Object.assign(activeUser, body);
      saveDB();
    }
    return ok(activeUser);
  }

  // ── Projects & Workspace Members ────────────────────────────────────
  if (method === "get" && url.match(/\/api\/workspaces\/[^/]+\/workspace-members\/me\/?/)) {
    return ok({
      id: "mock-ws-member-me",
      member: activeUser?.id,
      role: 20, // Admin role
      workspace: "mock-workspace-id",
      is_active: true,
      created_at: new Date().toISOString(),
    });
  }

  if (method === "get" && url.match(/\/api\/workspaces\/[^/]+\/members\/?(?:\?.*)?$/)) {
    return ok([
      {
        id: "mock-ws-member-me",
        member: activeUser,
        role: 20,
        workspace: "mock-workspace-id",
        is_active: true,
        created_at: new Date().toISOString(),
      },
    ]);
  }

  if (
    method === "get" &&
    (url.match(/\/api\/workspaces\/[^/]+\/projects\/?(?:\?.*)?$/) || url.includes("/projects/details"))
  ) {
    const projects = (localDB.projects || []).map((p: any) => {
      // Calculate next_work_item_sequence from actual issues
      const projectIssues = (localDB.issues || []).filter((i: any) => i.project === p.id || i.project_id === p.id);
      const maxSeq = projectIssues.reduce((max: number, i: any) => Math.max(max, i.sequence_id || 0), 0);
      return {
        ...p,
        next_work_item_sequence: maxSeq + 1,
      };
    });
    return ok(projects);
  }


  // ── Project Members ──────────────────────────────────────────────────
  if (method === "get" && url.match(/\/api\/workspaces\/[^/]+\/projects\/[^/]+\/project-members\/me\/?/)) {
    return ok({
      id: "mock-proj-member-me",
      member: activeUser?.id,
      role: 20, // Admin role
    });
  }

  if (method === "get" && url.match(/\/api\/workspaces\/[^/]+\/projects\/[^/]+\/members\/?(?:\?.*)?$/)) {
    return ok([
      {
        id: "mock-proj-member-me",
        member: activeUser?.id,
        role: 20,
      },
    ]);
  }

  // ── Project Archive / Restore ────────────────────────────────────────
  const archiveMatch = url.match(/\/api\/workspaces\/[^/]+\/projects\/([^/]+)\/archive\/?$/);
  if (archiveMatch) {
    const projectId = archiveMatch[1];
    const project = localDB.projects?.find((p) => p.id === projectId);
    if (project) {
      if (method === "post") {
        project.archived_at = new Date().toISOString();
      } else if (method === "delete") {
        project.archived_at = null;
      }
      saveDB();
      syncDAppRecord("projects", projectId, project);
      return ok(project);
    }
    console.log("404 for URL:", url, "method:", method);
    return { data: null, status: 404 };
  }

  // ── Recent Visits & Favorites ────────────────────────────────────────
  if (method === "get" && url.match(/\/api\/workspaces\/[^/]+\/recent-visits\/?(?:\?.*)?$/)) {
    return ok(localDB["recent-visits"] || []);
  }

  if (method === "get" && url.match(/\/api\/workspaces\/[^/]+\/user-favorites\/?(?:\?.*)?$/)) {
    return ok(localDB.favorites || []);
  }

  // Assets v2
  if (url.match(/\/api\/assets\/v2\//) && method === "post") {
    const assetId = `asset_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const issueMatch = url.match(/\/(issues|work-items|epics)\/([^\/]+)\/attachments/);
    const issueId = issueMatch ? issueMatch[2] : null;
    if (issueId) {
      if (!localDB["attachments"]) localDB["attachments"] = [];
      localDB["attachments"].push({
        id: assetId,
        asset_id: assetId,
        issue: issueId,
        is_uploaded: false,
        attributes: { name: body?.name || "mock_file.png", size: body?.size || 1024 }
      });
      saveDB();
    }
    return ok({
      asset_id: assetId,
      asset_url: `mock_asset_url_${assetId}`,
      upload_data: {
        url: "mock_upload_url",
        fields: {
          "Content-Type": "image/jpeg",
          key: "mock_key",
          "x-amz-algorithm": "mock_algo",
          "x-amz-credential": "mock_cred",
          "x-amz-date": "mock_date",
          policy: "mock_policy",
          "x-amz-signature": "mock_sig",
        },
      },
    });
  }

  if (url.match(/\/api\/assets\/v2\//) && method === "patch") {
    const assetMatch = url.match(/\/attachments\/([^/]+)\/?/); const assetId = assetMatch ? assetMatch[1] : null; const attachment = (localDB["attachments"] || []).find((a: any) => a.id === assetId || a.asset_id === assetId); if (attachment) { attachment.is_uploaded = true; saveDB(); return ok(attachment); } return ok({ success: true });
  }

  // ── Issue sub-resource endpoints ─────────────────────────────────────
  // subscribe
  if (url.match(/\/(issues|work-items|epics)\/[^/]+\/subscribe\/?(?:\?.*)?$/)) {
    if (method === "get") return ok({ subscribed: false });
    if (method === "post") return ok({ subscribed: true });
    if (method === "delete") return ok({ subscribed: false });
  }

  // history / activity — serves both activities and comments depending on activity_type query param
  const historyMatch = url.match(/\/(issues|work-items|epics)\/([^/]+)\/history\/?(?:\?.*)?$/);
  if (historyMatch && method === "get") {
    const issueId = historyMatch[2];
    // Parse activity_type from query string
    const qsMatch = url.match(/[?&]activity_type=([^&]+)/);
    const activityType = qsMatch ? decodeURIComponent(qsMatch[1]) : null;

    if (activityType === "issue-comment" || activityType === "epic-comment") {
      // Return comments for this issue, formatted as the store expects (TIssueComment)
      const comments = (localDB.comments || []).filter((c: any) => c.issue === issueId || c.issue_id === issueId);
      const issue = (localDB.issues || []).find((i: any) => i.id === issueId);
      const enrichedComments = comments.map((c: any) => ({
        id: c.id,
        issue: issueId,
        issue_detail: issue ? { id: issue.id, name: issue.name, sequence_id: issue.sequence_id } : null,
        comment_html: c.comment_html || c.body || "",
        comment_stripped: c.comment_stripped || "",
        comment_json: c.comment_json || null,
        actor: c.actor || "me",
        actor_detail: c.actor_detail || {
          id: "me",
          first_name: "Plane",
          last_name: "Admin",
          is_bot: false,
          display_name: "Plane Admin",
          avatar: "",
        },
        created_at: c.created_at,
        updated_at: c.updated_at || c.created_at,
        edited_at: c.edited_at || null,
        comment_reactions: c.comment_reactions || [],
        is_member: true,
        external_source: c.external_source || null,
        workspace: c.workspace || issue?.workspace,
        project: c.project || issue?.project,
        project_id: c.project_id || c.project || issue?.project,
        workspace_id: c.workspace_id || c.workspace || issue?.workspace,
        access: c.access || "INTERNAL",
      }));
      return ok(enrichedComments);
    }

    // Default: return activity history (issue-property type)
    const history = (localDB.history || []).filter((h: any) => h.issue === issueId || h.issue_id === issueId);
    return ok(history);
  }

  // comments
  const commentMatch = url.match(/\/(issues|work-items|epics)\/([^/]+)\/comments\/?(?:\?.*)?$/);
  if (commentMatch) {
    const issueId = commentMatch[2];
    if (method === "get") {
      const comments = (localDB.comments || []).filter((c: any) => c.issue === issueId || c.issue_id === issueId);
      const issue = localDB.issues?.find((i: any) => i.id === issueId);
      const enrichedComments = comments.map((c: any) => ({
        ...c,
        issue_id: issueId,
        project_id: c.project_id || c.project || issue?.project,
        workspace_id: c.workspace_id || c.workspace || issue?.workspace,
        actor: c.actor || "me",
        actor_detail: { id: "me", first_name: "Plane", last_name: "Admin", is_bot: false, display_name: "Plane Admin" },
      }));
      return ok(enrichedComments);
    }
    if (method === "post") {
      const issue = localDB.issues?.find((i: any) => i.id === issueId);
      const urlWsMatch = url.match(/\/api\/workspaces\/([^/]+)\//);
      const urlProjMatch = url.match(/\/projects\/([^/]+)\//);
      const wsSlug = urlWsMatch ? urlWsMatch[1] : issue?.workspace || "mock-workspace";
      const projId = urlProjMatch ? urlProjMatch[1] : issue?.project || "mock-project";

      const newComment = {
        id: crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11),
        issue: issueId,
        issue_id: issueId,
        project_id: projId,
        workspace_id: wsSlug,
        project: projId,
        workspace: wsSlug,
        actor: "me",
        actor_detail: {
          id: "me",
          first_name: "Plane",
          last_name: "Admin",
          is_bot: false,
          display_name: "Plane Admin",
          avatar: "",
        },
        access: "EXTERNAL",
        reaction_groups: {},
        created_by: "me",
        updated_by: "me",
        comment_html: "",
        comment_json: {},
        comment_stripped: "",
        ...body,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      if (!localDB.comments) localDB.comments = [];
      localDB.comments.push(newComment);
      saveDB();
      return ok(newComment);
    }
    if (method === "delete") {
      if (localDB.comments) {
        const commentIdMatch = url.match(/\/comments\/([^/]+)\/?(?:\?.*)?$/);
        if (commentIdMatch) {
          const commentId = commentIdMatch[1];
          localDB.comments = localDB.comments.filter((c: any) => c.id !== commentId);
          saveDB();
        }
      }
      return ok({});
    }
  }

  // reactions
  if (url.match(/\/(issues|work-items|epics)\/[^/]+\/reactions\/?(?:\?.*)?$/)) {
    if (method === "get") return ok([]);
    if (method === "post") return ok({ id: crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11), ...body });
    if (method === "delete") return ok({});
  }

  // sub-issues
  const subIssuesMatch = url.match(/\/(issues|work-items|epics)\/([^/]+)\/sub-issues\/?(?:\?.*)?$/);
  if (subIssuesMatch) {
    if (method === "get") {
      const parentId = subIssuesMatch[2];
      const subIssues = (localDB.issues || []).filter((i: any) => i.parent_id === parentId || i.parent === parentId);

      const enrichedSubIssues = subIssues.map((item: any) => {
        const children = (localDB.issues || []).filter((i: any) => i.parent_id === item.id || i.parent === item.id);
        const stateDetail = item.state_detail || (localDB.states || []).find((s: any) => s.id === (item.state_id || item.state));
        const projectDetail = item.project_detail || (localDB.projects || []).find((p: any) => p.id === (item.project_id || item.project));
        return {
          ...item,
          state_detail: stateDetail,
          project_detail: projectDetail,
          sub_issues_count: children.length
        };
      });
      return ok({ sub_issues: enrichedSubIssues, state_distribution: {} });
    }
    if (method === "post") {
      const parentId = subIssuesMatch[2];
      const subIssueIds = body.sub_issue_ids || [];

      let updatedSubIssues: any[] = [];
      if (localDB.issues) {
        localDB.issues = localDB.issues.map((i: any) => {
          if (subIssueIds.includes(i.id)) {
            const updated = { ...i, parent_id: parentId, parent: parentId };
            updatedSubIssues.push(updated);
            return updated;
          }
          return i;
        });

        const parentIdx = localDB.issues.findIndex((i: any) => i.id === parentId);
        if (parentIdx > -1) {
          localDB.issues[parentIdx].sub_issues_count = (localDB.issues[parentIdx].sub_issues_count || 0) + updatedSubIssues.length;
        }
        saveDB();
      }

      return ok({ sub_issues: updatedSubIssues, state_distribution: {} });
    }
  }

  // issue-relation
  if (url.match(/\/(issues|work-items|epics)\/[^/]+\/issue-relation\/?(?:\?.*)?$/)) {
    if (method === "get") return ok({});
    if (method === "post") return ok({ ...body });
  }

  // links
  if (url.match(/\/(issues|work-items|epics)\/[^/]+\/links\/?(?:\?.*)?$/)) {
    if (method === "get") return ok([]);
    if (method === "post") return ok({ id: crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11), ...body });
  }

  // attachments
  const attachmentsMatch = url.match(/\/(issues|work-items|epics)\/([^/]+)\/attachments\/?(?:\?.*)?$/);
  if (attachmentsMatch) {
    const issueId = attachmentsMatch[2];
    if (method === "get") {
      const attachments = (localDB["attachments"] || []).filter((a: any) => a.issue === issueId || a.issue_id === issueId);
      return ok(attachments);
    }
  }

  // description-versions
  if (url.match(/\/(issues|work-items|epics)\/[^/]+\/description-versions\/?(?:\?.*)?$/)) {
    return ok([]);
  }

  // modules endpoint for an issue
  if (url.match(/\/(issues|work-items|epics)\/[^/]+\/modules\/?(?:\?.*)?$/)) {
    if (method === "get") return ok([]);
    if (method === "post") return ok({ ...body });
  }


  // search-issues endpoint — return issues in ISearchIssueResponse format
  if (url.includes("/search-issues") || url.includes("search-issues")) {
    if (method === "get") {
      // Return empty array so UI is forced to rely on on-chain data
      return ok([]);
    }
  }
  // ── Generic CRUD ────────────────────────────────────────────────────
  return handleCRUD(method, url, body);
}

// ── Generic CRUD handler ─────────────────────────────────────────────────
function handleCRUD(method: string, url: string, body: Record<string, any>): RouteResult {
  let { collection, id, isPaginated } = parseApiUrl(url);
  console.log(
    `[DApp CRUD] ${method.toUpperCase()} collection=${collection}, id=${id}, isPaginated=${isPaginated}, url=${url}`
  );

  // Handle search-issues directly — return ISearchIssueResponse[] format
  if (collection === "search-issues" && method === "get") {
    // Return empty array so UI is forced to rely on on-chain data
    return ok([]);
  }

  // Alias work-items / issues-detail / work-items-detail to issues
  if (
    collection === "work-items" ||
    collection === "issues-detail" ||
    collection === "work-items-detail" ||
    collection === "search-issues"
  ) {
    collection = "issues";
  }

  // Sub-resource collections that don't have persistent storage — return empty stubs
  const subResourceCollections = [
    "history",
    "comments",
    "reactions",
    "sub-issues",
    "issue-relation",
    "links",
    "subscriptions",
    "description-versions",
    "archive",
  ];
  if (subResourceCollections.includes(collection) && !localDB[collection]?.length) {
    if (method === "get") {
      return ok([]);
    }
  }

  if (collection === "advance-analytics" && method === "get") {
    const issues = localDB.issues || [];
    const states = localDB.states || [];
    const projectIdMatch = url.match(/\/projects\/([^/]+)/);
    const projectId = projectIdMatch ? projectIdMatch[1] : null;

    let filteredIssues = issues;
    if (projectId) {
      filteredIssues = issues.filter((i: any) => i.project_id === projectId || i.project === projectId);
    }

    let started = 0;
    let backlog = 0;
    let unstarted = 0;
    let completed = 0;

    filteredIssues.forEach((issue: any) => {
      const stateId = issue.state_id || issue.state;
      const state = states.find((s: any) => s.id === stateId);
      if (state) {
        if (state.group === "started") started++;
        else if (state.group === "backlog") backlog++;
        else if (state.group === "unstarted") unstarted++;
        else if (state.group === "completed" || state.group === "done") completed++;
      }
    });

    return ok({
      total_work_items: { count: filteredIssues.length },
      started_work_items: { count: started },
      backlog_work_items: { count: backlog },
      un_started_work_items: { count: unstarted },
      completed_work_items: { count: completed }
    });
  }

  if (collection === "advance-analytics-stats" && method === "get") {
    const isPeekView = url.includes("/projects/");
    const projectIdMatch = url.match(/\/projects\/([^/]+)/);
    const projectId = projectIdMatch ? projectIdMatch[1] : null;

    const issues = localDB.issues || [];
    const states = localDB.states || [];
    const users = localDB.users || [];
    const projects = localDB.projects || [];

    let filteredIssues = issues;
    if (isPeekView && projectId) {
      filteredIssues = issues.filter((i: any) => i.project_id === projectId || i.project === projectId);
    }

    if (isPeekView) {
      // Group by assignee
      const assigneeMap: Record<string, any> = {};

      filteredIssues.forEach((issue: any) => {
        let assignees = issue.assignee_ids || issue.assignees || [];
        if (!Array.isArray(assignees)) assignees = [assignees];
        if (assignees.length === 0) assignees = ["unassigned"];

        assignees.forEach((assigneeId: string) => {
          if (!assigneeMap[assigneeId]) {
            let displayName = "Unassigned";
            let avatarUrl = "";
            if (assigneeId !== "unassigned") {
              const user = users.find((u: any) => u.id === assigneeId);
              if (user) {
                displayName = user.display_name || user.first_name || user.name || "User";
                avatarUrl = user.avatar || user.avatar_url || "";
              }
            } else {
              displayName = null as any; // Table displays 'Unassigned' if null
            }
            assigneeMap[assigneeId] = {
              display_name: displayName,
              avatar_url: avatarUrl,
              backlog_work_items: 0,
              started_work_items: 0,
              un_started_work_items: 0,
              completed_work_items: 0,
              cancelled_work_items: 0
            };
          }

          const stateId = issue.state_id || issue.state;
          const state = states.find((s: any) => s.id === stateId);
          if (state) {
            if (state.group === "started") assigneeMap[assigneeId].started_work_items++;
            else if (state.group === "backlog") assigneeMap[assigneeId].backlog_work_items++;
            else if (state.group === "unstarted") assigneeMap[assigneeId].un_started_work_items++;
            else if (state.group === "completed" || state.group === "done") assigneeMap[assigneeId].completed_work_items++;
            else if (state.group === "cancelled") assigneeMap[assigneeId].cancelled_work_items++;
          }
        });
      });

      return ok(Object.values(assigneeMap));
    } else {
      // Group by project
      const projectMap: Record<string, any> = {};
      filteredIssues.forEach((issue: any) => {
        const pid = issue.project_id || issue.project || "unassigned";
        if (!projectMap[pid]) {
          let projectName = "Unknown Project";
          if (pid !== "unassigned") {
            const proj = projects.find((p: any) => p.id === pid);
            if (proj) projectName = proj.name;
          }
          projectMap[pid] = {
            project__name: projectName,
            backlog_work_items: 0,
            started_work_items: 0,
            un_started_work_items: 0,
            completed_work_items: 0,
            cancelled_work_items: 0
          };
        }

        const stateId = issue.state_id || issue.state;
        const state = states.find((s: any) => s.id === stateId);
        if (state) {
          if (state.group === "started") projectMap[pid].started_work_items++;
          else if (state.group === "backlog") projectMap[pid].backlog_work_items++;
          else if (state.group === "unstarted") projectMap[pid].un_started_work_items++;
          else if (state.group === "completed" || state.group === "done") projectMap[pid].completed_work_items++;
          else if (state.group === "cancelled") projectMap[pid].cancelled_work_items++;
        }
      });

      return ok(Object.values(projectMap));
    }
  }

  if (collection === "advance-analytics-charts" && method === "get") {
    const params = new URLSearchParams(url.split("?")[1] || "");
    const type = params.get("type") || "work-items";
    const xAxis = params.get("x_axis");

    const issues = localDB.issues || [];
    const states = localDB.states || [];
    const users = localDB.users || [];

    const projectIdMatch = url.match(/\/projects\/([^/]+)/);
    const projectId = projectIdMatch ? projectIdMatch[1] : null;

    let filteredIssues = issues;
    if (projectId) {
      filteredIssues = issues.filter((i: any) => i.project_id === projectId || i.project === projectId);
    }

    if (type === "work-items") {
      // Created vs Resolved grouped by date
      const dateMap: Record<string, any> = {};

      filteredIssues.forEach((issue: any) => {
        if (issue.created_at) {
          const createdDate = issue.created_at.split("T")[0];
          if (!dateMap[createdDate]) dateMap[createdDate] = { created_issues: 0, completed_issues: 0 };
          dateMap[createdDate].created_issues++;
        }

        const stateId = issue.state_id || issue.state;
        const state = states.find((s: any) => s.id === stateId);
        if (state && (state.group === "completed" || state.group === "done")) {
          const completedDate = (issue.completed_at || issue.updated_at || issue.created_at).split("T")[0];
          if (!dateMap[completedDate]) dateMap[completedDate] = { created_issues: 0, completed_issues: 0 };
          dateMap[completedDate].completed_issues++;
        }
      });

      const mockData = Object.keys(dateMap).sort().map(dateStr => {
        return {
          key: dateStr,
          name: dateStr,
          count: dateMap[dateStr].created_issues + dateMap[dateStr].completed_issues,
          created_issues: dateMap[dateStr].created_issues,
          completed_issues: dateMap[dateStr].completed_issues
        };
      });

      const schema = { created_issues: "Created", completed_issues: "Completed", count: "Count" };
      return ok({ data: mockData, schema });

    } else {
      // Group by x_axis dynamically
      let mockDataMap: Record<string, any> = {};
      let schema: Record<string, string> = { count: "Count" };

      filteredIssues.forEach((issue: any) => {
        let key = "unknown";
        let name = "Unknown";

        if (xAxis === "priority") {
          key = issue.priority || "none";
          name = (key === "none") ? "None" : key;
        } else if (xAxis === "state_id" || xAxis === "state__group") {
          const stateId = issue.state_id || issue.state;
          const state = states.find((s: any) => s.id === stateId);
          if (state) {
            key = xAxis === "state__group" ? state.group : state.name;
            name = state.name;
          }
        } else if (xAxis === "assignees__id") {
          let assignees = issue.assignee_ids || issue.assignees || [];
          if (!Array.isArray(assignees)) assignees = [assignees];
          if (assignees.length === 0) assignees = ["unassigned"];

          if (assignees.length > 0) {
            key = assignees[0];
            if (key === "unassigned") {
              name = "Unassigned";
            } else {
              const user = users.find((u: any) => u.id === key);
              name = user ? (user.display_name || user.first_name || user.name || "User") : key;
            }
          }
        } else if (xAxis === "labels__id") {
          const labels = Array.isArray(issue.labels) ? issue.labels : (issue.label_ids || []);
          if (labels.length > 0) {
            key = labels[0];
            name = "Label " + key; // Simplified for mock
          } else {
            key = "none";
            name = "None";
          }
        }

        if (!mockDataMap[key]) {
          mockDataMap[key] = { key, name, count: 0 };
        }
        mockDataMap[key].count++;

        // Also populate the key in the schema
        if (!schema[key]) {
          schema[key] = name;
        }
        if (mockDataMap[key][key] === undefined) {
          mockDataMap[key][key] = 0;
        }
        mockDataMap[key][key]++;
      });

      return ok({ data: Object.values(mockDataMap), schema });
    }
  }
  if (collection === "user-properties" && method === "get") {
    return ok({
      display_filters: { layout: "list" },
      display_properties: {
        assignee: true,
        attachment_count: true,
        created_on: true,
        due_date: true,
        estimate: true,
        key: true,
        labels: true,
        link: true,
        priority: true,
        start_date: true,
        state: true,
        sub_issue_count: true,
        updated_on: true,
      },
    });
  }

  if (!localDB[collection]) localDB[collection] = [];

  // Auto-fix missing sequence_id and project_detail for existing issues
  if (collection === "issues") {
    let saveNeeded = false;
    const projectSeqMap: Record<string, number> = {};

    // First pass: find max sequence_id for each project
    localDB.issues.forEach((issue: any) => {
      if (issue.project && issue.sequence_id) {
        projectSeqMap[issue.project] = Math.max(projectSeqMap[issue.project] || 0, issue.sequence_id);
      }
    });

    // Second pass: backfill missing data
    localDB.issues.forEach((issue: any) => {
      if (issue.project && (!issue.sequence_id || !issue.project_detail)) {
        if (!issue.sequence_id) {
          projectSeqMap[issue.project] = (projectSeqMap[issue.project] || 0) + 1;
          issue.sequence_id = projectSeqMap[issue.project];
        }
        if (!issue.project_detail) {
          const project = (localDB.projects || []).find((p: any) => p.id === issue.project);
          if (project) issue.project_detail = project;
        }
        saveNeeded = true;
      }
    });

    if (saveNeeded) saveDB();
  }

  if (method === "get") {
    if (id) {
      let item = localDB[collection].find((r) => r.id === id || r.slug === id);

      // Fallback: If id is a number (sequenceId), try finding by project id or identifier
      if (!item && collection === "issues") {
        const projMatch = url.match(/\/projects\/([^/]+)\//);
        console.log(`[DApp Interceptor] Searching for sequence ID ${id}, projMatch:`, projMatch?.[1]);
        if (projMatch) {
          const projOrIdentifier = projMatch[1];
          const seqId = parseInt(id, 10);
          console.log(`[DApp Interceptor] Project: ${projOrIdentifier}, seqId: ${seqId}`);
          if (!isNaN(seqId)) {
            item = localDB.issues.find((r: any) => {
              const match =
                (r.project === projOrIdentifier || r.project_detail?.identifier === projOrIdentifier) &&
                r.sequence_id === seqId;
              return match;
            });
            console.log(`[DApp Interceptor] Fallback seqId result:`, item ? `FOUND ${item.id}` : "NOT FOUND");
          } else if (id === "undefined") {
            item = localDB.issues.find(
              (r: any) => r.project === projOrIdentifier || r.project_detail?.identifier === projOrIdentifier
            );
          }
        }
      }

      // Older fallback for retrieveWithIdentifier (e.g., FIAI-1 or FIAI-undefined)
      if (!item && collection === "issues" && id.includes("-")) {
        const [projIdentifier, seqIdStr] = id.split("-");
        const seqId = parseInt(seqIdStr, 10);
        if (!isNaN(seqId)) {
          item = localDB.issues.find(
            (r: any) => r.project_detail?.identifier === projIdentifier && r.sequence_id === seqId
          );
        } else if (seqIdStr === "undefined") {
          // Special fallback if UI still requests undefined
          item = localDB.issues.find((r: any) => r.project_detail?.identifier === projIdentifier);
        }
      }

      if (!item) return { data: null, status: 404 };
      // Enrich issue/work-item data with defaults expected by the detail store
      if (collection === "issues") {
        const stateDetail =
          item.state_detail || (localDB.states || []).find((s: any) => s.id === (item.state_id || item.state));
        const projectDetail =
          item.project_detail || (localDB.projects || []).find((p: any) => p.id === (item.project_id || item.project));
        return ok({
          is_subscribed: false,
          issue_reactions: [],
          issue_link: [],
          issue_attachments: [],
          parent: null,
          ...item,
          project_id: item.project_id || item.project,
          workspace_id: item.workspace_id || item.workspace || item.project_detail?.workspace || "mock-workspace",
          state_id: item.state_id || item.state,
          parent_id: item.parent_id || item.parent,
          cycle_id: item.cycle_id || item.cycle,
          type_id: item.type_id || item.type,
          assignees: item.assignees || item.assignee_ids || [],
          assignee_ids: item.assignee_ids || item.assignees || [],
          labels: item.labels || item.label_ids || [],
          label_ids: item.label_ids || item.labels || [],
          state_detail: stateDetail,
          project_detail: projectDetail,
        });
      }
      return ok(item);
    }
    let list = localDB[collection] || [];

    // History endpoint should also return comments
    if (collection === "history") {
      const commentsList = localDB["comments"] || [];
      list = [...list, ...commentsList];
    }

    // Auto-seed states for a project if none exist
    if (collection === "states" && url.includes("/projects/")) {
      const projId = id || url.match(/\/projects\/([^/]+)\//)?.[1];
      if (projId) {
        const projStates = list.filter((s: any) => s.project === projId);
        if (projStates.length === 0) {
          const match = url.match(/\/api\/workspaces\/([^/]+)\//);
          const wsSlug = match ? match[1] : "unknown";
          let wsId = wsSlug;
          if (localDB.workspaces) {
            const ws = localDB.workspaces.find((w: any) => w.slug === wsSlug);
            if (ws) wsId = ws.id;
          }

          const defaultStates = [
            {
              id: crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11),
              name: "Backlog",
              group: "backlog",
              project: projId,
              workspace: wsId,
              sequence: 15000,
              color: "#a3a3a3",
              default: true,
            },
            {
              id: crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11),
              name: "Unstarted",
              group: "unstarted",
              project: projId,
              workspace: wsId,
              sequence: 25000,
              color: "#3f3f46",
              default: false,
            },
            {
              id: crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11),
              name: "Started",
              group: "started",
              project: projId,
              workspace: wsId,
              sequence: 35000,
              color: "#f59e0b",
              default: false,
            },
            {
              id: crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11),
              name: "Completed",
              group: "completed",
              project: projId,
              workspace: wsId,
              sequence: 45000,
              color: "#16a34a",
              default: false,
            },
            {
              id: crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11),
              name: "Cancelled",
              group: "cancelled",
              project: projId,
              workspace: wsId,
              sequence: 55000,
              color: "#ef4444",
              default: false,
            },
          ];
          list.push(...defaultStates);
          (localDB as any)["states"] = list;
          saveDB();
        }
      }
    }

    // Generic _id suffix mapping for all items to satisfy frontend MobX stores
    list = list.map((item: any) => {
      if (!item || typeof item !== "object") return item;
      const res = { ...item };
      if (res.project && !res.project_id) res.project_id = res.project;
      if (res.workspace && !res.workspace_id) res.workspace_id = res.workspace;
      return res;
    });

    // Filter collections by project ID if the URL is scoped to a project
    if (url.includes("/projects/")) {
      const match = url.match(/\/projects\/([^/]+)\//);
      if (match) {
        const projId = match[1];
        if (
          ["issues", "states", "labels", "project-members", "project-roles", "cycles", "modules"].includes(collection)
        ) {
          list = list.filter((item: any) => item.project === projId || item.project_id === projId);
        }
      }
    }

    // Filter sub-resources by issue ID
    if (["comments", "history", "issue_reactions"].includes(collection) && id) {
      list = list.filter((item: any) => item.issue === id || item.issue_id === id);
    }

    if (collection === "invitations") {
      // Fix corrupted old records that have `emails: [{ email, role }]` instead of top-level properties
      list = list.map((item: any) => {
        if (!item.email && item.emails && Array.isArray(item.emails) && item.emails.length > 0) {
          return {
            ...item,
            email: item.emails[0].email,
            role: item.emails[0].role,
          };
        }
        return item;
      });
      list = list.filter((item: any) => !!item.email);
      console.log(`[DApp Interceptor] Returning invitations:`, JSON.stringify(list));
    }

    // Enrich issues with project_id, workspace_id, and other _id fields (required by UI)
    if (collection === "issues") {
      list = list.map((item: any) => {
        const stateDetail =
          item.state_detail || (localDB.states || []).find((s: any) => s.id === (item.state_id || item.state));
        const projectDetail =
          item.project_detail || (localDB.projects || []).find((p: any) => p.id === (item.project_id || item.project));

        const children = (localDB.issues || []).filter((i: any) => i.parent_id === item.id || i.parent === item.id);

        return {
          ...item,
          project_id: item.project_id || item.project,
          workspace_id: item.workspace_id || item.workspace || item.project_detail?.workspace || "mock-workspace",
          state_id: item.state_id || item.state,
          parent_id: item.parent_id || item.parent,
          cycle_id: item.cycle_id || item.cycle,
          type_id: item.type_id || item.type,
          assignees: item.assignees || item.assignee_ids || [],
          assignee_ids: item.assignee_ids || item.assignees || [],
          labels: item.labels || item.label_ids || [],
          label_ids: item.label_ids || item.labels || [],
          state_detail: stateDetail,
          project_detail: projectDetail,
          sub_issues_count: children.length,
        };
      });

      // Always exclude issues that have a parent_id from the top-level list when fetching multiple issues
      // But don't exclude them for search-issues so that existing sub-issues can be found
      if (!id && !url.includes("search-issues")) {
        list = list.filter((item: any) => !item.parent_id && !item.parent);
      }
    }

    // Enrich states with project_id and workspace_id
    if (collection === "states") {
      list = list.map((item: any) => ({
        ...item,
        project_id: item.project_id || item.project,
        workspace_id: item.workspace_id || item.workspace || "mock-workspace",
      }));
      console.log(
        `[DApp CRUD] States returning ${list.length} items:`,
        JSON.stringify(list.map((s: any) => ({ id: s.id, name: s.name, project_id: s.project_id })))
      );
    }

    const urlObj = new URL(url, "http://localhost");
    const groupBy = urlObj.searchParams.get("group_by");

    if (groupBy) {
      const groupedResults: Record<string, any> = {};

      // Initialize groups if it's states
      if (groupBy === "state" && collection === "issues") {
        const projId = id || url.match(/\/projects\/([^/]+)\//)?.[1];
        const states = (localDB.states || []).filter((s: any) => s.project === projId);
        states.forEach((s: any) => {
          groupedResults[s.id] = { results: [], total_results: 0 };
        });
      }

      list.forEach((item) => {
        const groupKey = item[groupBy] || "None";
        if (!groupedResults[groupKey]) {
          groupedResults[groupKey] = { results: [], total_results: 0 };
        }
        groupedResults[groupKey].results.push(item);
        groupedResults[groupKey].total_results++;
      });
      return ok({
        results: groupedResults,
        grouped_by: groupBy,
        next_cursor: null,
        prev_cursor: null,
        next_page_results: false,
        prev_page_results: false,
        total_count: list.length,
        count: list.length,
        total_pages: 1,
        total_results: list.length,
      });
    }

    if (isPaginated) {
      return ok({
        results: list,
        next_cursor: null,
        prev_cursor: null,
        next_page_results: false,
        prev_page_results: false,
        total_count: list.length,
        count: list.length,
        total_pages: 1,
        total_results: list.length,
        extra_stats: null,
      });
    }
    return ok(list);
  }

  if (method === "post") {
    console.log("[DApp Interceptor] POST", collection, body);
    if (collection === "invitations" && body.emails && Array.isArray(body.emails)) {
      const match = url.match(/\/api\/workspaces\/([^/]+)\//);
      const wsSlug = match ? match[1] : "mock-workspace";

      const newInvites = body.emails.map((e: any) => ({
        id: crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        email: e.email,
        role: e.role,
        accepted: false,
        message: "You have been invited.",
        workspace: {
          id: wsSlug,
          name: "Mock Workspace",
          slug: wsSlug,
          logo_url: "",
        },
      }));

      if (!localDB[collection]) localDB[collection] = [];
      localDB[collection].push(...newInvites);
      saveDB();
      newInvites.forEach((inv) => syncDAppRecord(collection, inv.id, inv));
      return ok({ message: "Invitations sent successfully" });
    }

    const newRecord: any = {
      id: body.id || crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...body,
    };
    if (collection === "blockchain-transactions") {
      newRecord.recorded_at = new Date().toISOString();
      const activeUserId = getLoggedInUserId();
      const activeUser = localDB.users?.find((u: any) => u.id === activeUserId) || MOCK_USER;
      if (newRecord.event_type === "assign_task" && !newRecord.assignee_name && newRecord.assignee_id) {
        const u = localDB.users?.find((u: any) => u.id === newRecord.assignee_id);
        newRecord.assignee_name = u?.display_name || u?.first_name || newRecord.assignee_id;
      }
      if (
        (newRecord.event_type === "daily_report" || newRecord.event_type === "task_content") &&
        !newRecord.reporter_name
      ) {
        newRecord.reporter_id = activeUserId;
        newRecord.reporter_name = activeUser?.display_name || activeUser?.first_name || activeUserId;
      }
    }
    if (collection === "workspaces" && !newRecord.slug)
      newRecord.slug = newRecord.name?.toLowerCase().replace(/\s+/g, "-");
    if (collection === "workspaces" && !newRecord.owner) {
      newRecord.owner = { id: "me", email: "admin@plane.so", first_name: "Plane", last_name: "Admin", avatar: "" };
      newRecord.created_by = "me";
    }
    if (collection === "projects") {
      const match = url.match(/\/api\/workspaces\/([^/]+)\//);
      if (match) {
        const wsSlug = match[1];
        const ws = (localDB.workspaces || []).find((w: any) => w.slug === wsSlug);
        if (ws) {
          newRecord.workspace = ws.id;
          newRecord.workspace_detail = ws;
        }
      }
      newRecord.member_role = 20;

      // Seed default states for the new project
      if (!localDB["states"]) localDB["states"] = [];
      const defaultStates = [
        {
          id: crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11),
          name: "Backlog",
          group: "backlog",
          project: newRecord.id,
          workspace: newRecord.workspace,
          sequence: 15000,
          color: "#a3a3a3",
          default: true,
        },
        {
          id: crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11),
          name: "Unstarted",
          group: "unstarted",
          project: newRecord.id,
          workspace: newRecord.workspace,
          sequence: 25000,
          color: "#3f3f46",
          default: false,
        },
        {
          id: crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11),
          name: "Started",
          group: "started",
          project: newRecord.id,
          workspace: newRecord.workspace,
          sequence: 35000,
          color: "#f59e0b",
          default: false,
        },
        {
          id: crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11),
          name: "Completed",
          group: "completed",
          project: newRecord.id,
          workspace: newRecord.workspace,
          sequence: 45000,
          color: "#16a34a",
          default: false,
        },
        {
          id: crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11),
          name: "Cancelled",
          group: "cancelled",
          project: newRecord.id,
          workspace: newRecord.workspace,
          sequence: 55000,
          color: "#ef4444",
          default: false,
        },
      ];
      localDB["states"].push(...defaultStates);
    }
    if (collection === "issues") {
      // Find the project ID from the URL: /api/workspaces/.../projects/:projectId/issues/
      const match = url.match(/\/projects\/([^/]+)\//);
      if (match) {
        const projId = match[1];
        newRecord.project = projId;
        const project = (localDB.projects || []).find((p: any) => p.id === projId);
        if (project) {
          newRecord.project_detail = project;
        }

        // Auto-increment sequence_id for the project
        const projectIssues = (localDB.issues || []).filter((i: any) => i.project === projId);
        const maxSeq = projectIssues.reduce((max: number, issue: any) => Math.max(max, issue.sequence_id || 0), 0);
        newRecord.sequence_id = maxSeq + 1;
      }
    }

    localDB[collection].push(newRecord);

    // If this is an issue and it has a parent, update the parent's sub_issues_count
    if (collection === "issues" && newRecord.parent_id) {
      const parentIdx = localDB[collection].findIndex((i: any) => i.id === newRecord.parent_id);
      if (parentIdx > -1) {
        localDB[collection][parentIdx].sub_issues_count = (localDB[collection][parentIdx].sub_issues_count || 0) + 1;
        // Broadcast the parent update if needed, though for mock DB just saving is enough for next fetch
      }
    }

    saveDB();
    syncDAppRecord(collection, newRecord.id, newRecord);

    let returnedRecord = { ...newRecord };

    // Generic mapping for all records
    if (returnedRecord.project && !returnedRecord.project_id) returnedRecord.project_id = returnedRecord.project;
    if (returnedRecord.workspace && !returnedRecord.workspace_id)
      returnedRecord.workspace_id = returnedRecord.workspace;

    if (collection === "issues") {
      const stateDetail =
        returnedRecord.state_detail ||
        (localDB.states || []).find((s: any) => s.id === (returnedRecord.state_id || returnedRecord.state));
      const projectDetail =
        returnedRecord.project_detail ||
        (localDB.projects || []).find((p: any) => p.id === (returnedRecord.project_id || returnedRecord.project));
      returnedRecord = {
        ...returnedRecord,
        project_id: returnedRecord.project_id || returnedRecord.project,
        workspace_id:
          returnedRecord.workspace_id ||
          returnedRecord.workspace ||
          returnedRecord.project_detail?.workspace ||
          "mock-workspace",
        state_id: returnedRecord.state_id || returnedRecord.state,
        parent_id: returnedRecord.parent_id || returnedRecord.parent,
        cycle_id: returnedRecord.cycle_id || returnedRecord.cycle,
        type_id: returnedRecord.type_id || returnedRecord.type,
        assignees: returnedRecord.assignees || returnedRecord.assignee_ids || [],
        assignee_ids: returnedRecord.assignee_ids || returnedRecord.assignees || [],
        labels: returnedRecord.labels || returnedRecord.label_ids || [],
        label_ids: returnedRecord.label_ids || returnedRecord.labels || [],
        state_detail: stateDetail,
        project_detail: projectDetail,
      };
    }

    if (["comments", "history", "issue_reactions"].includes(collection) && id) {
      newRecord.issue = id;
      newRecord.issue_id = id;
    }

    return { data: returnedRecord, status: 201 };
  }

  if (method === "patch" || method === "put") {
    const idx = localDB[collection].findIndex((r) => r.id === id || r.slug === id);
    if (idx > -1) {
      localDB[collection][idx] = { ...localDB[collection][idx], ...body, updated_at: new Date().toISOString() };
      saveDB();
      syncDAppRecord(collection, id!, localDB[collection][idx]);

      let returnedRecord = { ...localDB[collection][idx] };
      if (collection === "issues") {
        returnedRecord = {
          ...returnedRecord,
          project_id: returnedRecord.project_id || returnedRecord.project,
          workspace_id:
            returnedRecord.workspace_id ||
            returnedRecord.workspace ||
            returnedRecord.project_detail?.workspace ||
            "mock-workspace",
          state_id: returnedRecord.state_id || returnedRecord.state,
          parent_id: returnedRecord.parent_id || returnedRecord.parent,
          cycle_id: returnedRecord.cycle_id || returnedRecord.cycle,
          type_id: returnedRecord.type_id || returnedRecord.type,
        };
      }

      // Generic mapping for all other records
      if (returnedRecord.project && !returnedRecord.project_id) returnedRecord.project_id = returnedRecord.project;
      if (returnedRecord.workspace && !returnedRecord.workspace_id)
        returnedRecord.workspace_id = returnedRecord.workspace;

      return ok(returnedRecord);
    }
    console.log("404 for URL:", url, "method:", method);
    return { data: null, status: 404 };
  }

  if (method === "delete") {
    localDB[collection] = localDB[collection].filter((r) => r.id !== id);
    saveDB();
    return ok({});
  }

  return ok(null);
}

function ok(data: any): RouteResult {
  return { data, status: 200 };
}

// ── URL → collection parser ──────────────────────────────────────────────
function parseApiUrl(url: string): { collection: string; id: string | null; isPaginated: boolean } {
  const clean = url.split("?")[0].replace(/\/+$/, ""); // strip query and trailing slash
  const segments = clean.split("/").filter(Boolean); // e.g. ["api","workspaces","ws","projects","p","issues","id","history"]

  // Must start with "api"
  const apiIdx = segments.indexOf("api");
  if (apiIdx === -1) return { collection: "general", id: null, isPaginated: false };

  const rest = segments.slice(apiIdx + 1); // everything after "api"

  // Skip known structural prefixes to find the meaningful resource segments
  // Pattern: workspaces/:slug/projects/:pid/[v2/]<resource>[/:id[/<sub-resource>[/:subId]]]
  let i = 0;

  // skip "workspaces/:slug"
  if (rest[i] === "workspaces" && rest[i + 1]) i += 2;
  // skip "projects/:pid"
  if (rest[i] === "projects" && rest[i + 1]) i += 2;
  // skip "v2" prefix
  if (rest[i] === "v2") i += 1;

  const resourceSegments = rest.slice(i); // e.g. ["issues","id","history"] or ["issues"] or ["issues","id"]

  if (resourceSegments.length === 0) {
    return { collection: "general", id: null, isPaginated: false };
  }

  if (resourceSegments.length === 1) {
    // /api/.../issues/
    const unpaginated = [
      "members",
      "invitations",
      "states",
      "labels",
      "project-roles",
      "workspace-members",
      "project-members",
      "projects",
      "workspaces",
      "cycles",
      "modules",
      "views",
      "pages",
      "project-identifiers",
      "project-stats",
      "blockchain-transactions",
      "search-issues",
    ];
    const collection = resourceSegments[0];
    return { collection, id: null, isPaginated: !unpaginated.includes(collection) };
  }

  if (resourceSegments.length === 2) {
    const [resource, idOrSub] = resourceSegments;
    // Special case: "list" is not an id but a sub-endpoint
    if (idOrSub === "list") {
      return { collection: resource, id: null, isPaginated: true };
    }
    // /api/.../issues/:id
    return { collection: resource, id: idOrSub, isPaginated: false };
  }

  if (resourceSegments.length === 3) {
    // /api/.../issues/:id/history  or /api/.../issues/:id/comments
    const [_parentResource, parentId, subResource] = resourceSegments;
    const unpaginatedSub = ["comments", "history", "issue_reactions"];
    // Return the sub-resource as collection, with the parent id for context
    return { collection: subResource, id: parentId, isPaginated: !unpaginatedSub.includes(subResource) };
  }

  if (resourceSegments.length >= 4) {
    // /api/.../issues/:id/comments/:commentId
    const subResource = resourceSegments[2];
    const subId = resourceSegments[3];
    return { collection: subResource, id: subId, isPaginated: false };
  }

  return { collection: "general", id: null, isPaginated: false };
}

// ── Public: install interceptor on an Axios instance ─────────────────────
export function setupDAppInterceptor(axiosInstance: AxiosInstance) {
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

      const { data, status } = handleRoute(method, url, body);

      return {
        data,
        status,
        statusText: status < 400 ? "OK" : "Error",
        headers: {},
        config: adapterConfig,
        request: {},
      } as AxiosResponse;
    };
    return config;
  });
}



