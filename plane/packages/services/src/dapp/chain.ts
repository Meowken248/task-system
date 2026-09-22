import {
  localDB,
  defaultDB,
  saveDB,
  getDBSnapshot,
  getEnvVar,
  getLoggedInUserId,
  syncWorkspacesToCookie,
  registerSaveHook,
  syncCrossPortWorkspaces,
  DEFAULT_WORKSPACE,
} from "./store";
import { setStoredCredential } from "./auth";

/**
 * Generic on-chain sync (fire-and-forget, never blocks UI)
 * Disabled so we don't spam the network with duplicate mock records.
 */
export async function syncDAppRecord(collection: string, id: string, _record?: any): Promise<void> {
  console.log(`[DApp Sync] Generic sync disabled for ${collection}/${id}`);
}

// ── Decentralized IPFS + Blockchain Sync ─────────────────────────────────

export const GET_CID_ABI = {
  type: "function",
  name: "getCID",
  inputs: [
    { internalType: "address", name: "user", type: "address" },
    { internalType: "string", name: "key", type: "string" }
  ],
  outputs: [{ internalType: "string", name: "", type: "string" }],
  stateMutability: "view"
};

export const SET_CID_IF_MATCHES_ABI = {
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

export function getRegistryContractAddress(): string {
  return (
    getEnvVar("VITE_REGISTRY_CONTRACT_ADDRESS") ||
    getEnvVar("NEXT_PUBLIC_REGISTRY_CONTRACT_ADDRESS") ||
    ""
  );
}

export function getWorkspaceRegistryAddress(): string {
  return (
    getEnvVar("VITE_WORKSPACE_REGISTRY_ADDRESS") ||
    getEnvVar("NEXT_PUBLIC_WORKSPACE_REGISTRY_ADDRESS") ||
    ""
  );
}

export const CONTRACT_ADDRESS = getRegistryContractAddress();
export const WORKSPACE_REGISTRY_ADDRESS = getWorkspaceRegistryAddress();

export const GET_WORKSPACE_CID_ABI = {
  type: "function",
  name: "getWorkspaceCID",
  inputs: [{ internalType: "string", name: "slug", type: "string" }],
  outputs: [{ internalType: "string", name: "", type: "string" }],
  stateMutability: "view",
};

export const UPDATE_WORKSPACE_CID_ABI = {
  type: "function",
  name: "updateWorkspaceCID",
  inputs: [
    { internalType: "string", name: "slug", type: "string" },
    { internalType: "string", name: "newCid", type: "string" },
  ],
  outputs: [],
  stateMutability: "nonpayable",
};

export const CREATE_WORKSPACE_ABI = {
  type: "function",
  name: "createWorkspace",
  inputs: [
    { internalType: "string", name: "slug", type: "string" },
    { internalType: "string", name: "name", type: "string" },
    { internalType: "string", name: "initialCid", type: "string" },
  ],
  outputs: [],
  stateMutability: "nonpayable",
};

export const ADD_MEMBER_ABI = {
  type: "function",
  name: "addMember",
  inputs: [
    { internalType: "string", name: "slug", type: "string" },
    { internalType: "address", name: "member", type: "address" },
    { internalType: "uint8", name: "role", type: "uint8" },
  ],
  outputs: [],
  stateMutability: "nonpayable",
};

export const REMOVE_MEMBER_ABI = {
  type: "function",
  name: "removeMember",
  inputs: [
    { internalType: "string", name: "slug", type: "string" },
    { internalType: "address", name: "member", type: "address" },
  ],
  outputs: [],
  stateMutability: "nonpayable",
};

export function extractEthAddress(input: string | undefined | null): string | null {
  if (!input) return null;
  const clean = input.trim().toLowerCase();
  if (/^0x[a-f0-9]{40}$/.test(clean)) return clean;
  const match = clean.match(/^(0x[a-f0-9]{40})(@.*)?$/);
  if (match) return match[1];
  return null;
}

export function mapPlaneRoleToContractRole(planeRole: number | string | undefined): number {
  const r = Number(planeRole);
  if (r >= 20) return 2; // Admin
  if (r >= 5) return 1; // Member / Guest
  return 1;
}

export function getFiaiSDK(): any {
  if (typeof window !== "undefined") {
    return (window as any).fiaiSDK || null;
  }
  return null;
}

export const DEFAULT_PROXY_URL = "https://plane-ipfs-proxy.anh2482006.workers.dev";
const PLACEHOLDER_PATTERNS = ["your-worker", "your-subdomain", "your-domain", "example.com"];

export function getProxyUrl(): string | null {
  const envUrl = getEnvVar("VITE_PINATA_PROXY_URL");
  const url = envUrl || DEFAULT_PROXY_URL;
  if (PLACEHOLDER_PATTERNS.some(p => url.includes(p))) return null;
  return url;
}

// ── Direct RPC (bypass Bridge iframe for read-only calls) ──────────────
const GET_CID_SELECTOR = "0xfa3e97e7";
const GET_WORKSPACE_CID_SELECTOR = "0xdf48cfdc";
const GET_USER_WORKSPACES_SELECTOR = "0xd7d19c4e";
const GET_WORKSPACE_SELECTOR = "0x1cd7381a";

export function getRpcUrl(): string {
  return getEnvVar("VITE_RPC_URL") || "http://192.168.1.231:10746";
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

export function abiEncodeGetCID(userAddress: string, key: string): string {
  const addressHex = padHex(userAddress, 32);
  const offsetHex = padHex("40", 32);
  const keyBytes = utf8ToHex(key);
  const keyLen = key.length;
  const keyLenHex = padHex(keyLen.toString(16), 32);
  const keyDataHex = keyBytes.padEnd(Math.ceil(keyBytes.length / 64) * 64, "0");
  return GET_CID_SELECTOR + addressHex + offsetHex + keyLenHex + keyDataHex;
}

export function abiEncodeGetWorkspaceCID(slug: string): string {
  const offsetHex = padHex("20", 32);
  const slugBytes = utf8ToHex(slug);
  const slugLenHex = padHex(slug.length.toString(16), 32);
  const slugDataHex = slugBytes.padEnd(Math.ceil(slugBytes.length / 64) * 64, "0");
  return GET_WORKSPACE_CID_SELECTOR + offsetHex + slugLenHex + slugDataHex;
}

export function abiEncodeGetUserWorkspaces(userAddress: string): string {
  const addressHex = padHex(userAddress, 32);
  return GET_USER_WORKSPACES_SELECTOR + addressHex;
}

export function abiEncodeGetWorkspace(slug: string): string {
  const offsetHex = padHex("20", 32);
  const slugBytes = utf8ToHex(slug);
  const slugLenHex = padHex(slug.length.toString(16), 32);
  const slugDataHex = slugBytes.padEnd(Math.ceil(slugBytes.length / 64) * 64, "0");
  return GET_WORKSPACE_SELECTOR + offsetHex + slugLenHex + slugDataHex;
}

export function decodeAbiString(hexResult: string): string {
  if (!hexResult || hexResult === "0x" || hexResult.length < 130) return "";
  const data = hexResult.startsWith("0x") ? hexResult.slice(2) : hexResult;
  const length = parseInt(data.slice(64, 128), 16);
  if (length === 0) return "";
  const strHex = data.slice(128, 128 + length * 2);
  const bytes = new Uint8Array(strHex.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
  return new TextDecoder().decode(bytes);
}

export function decodeAbiStringArray(hexResult: string): string[] {
  if (!hexResult || hexResult === "0x" || hexResult.length < 130) return [];
  const data = hexResult.startsWith("0x") ? hexResult.slice(2) : hexResult;
  try {
    const arrayOffset = parseInt(data.slice(0, 64), 16) * 2;
    const count = parseInt(data.slice(arrayOffset, arrayOffset + 64), 16);
    if (isNaN(count) || count <= 0 || count > 100) return [];
    const result: string[] = [];
    for (let i = 0; i < count; i++) {
      const elemOffset = parseInt(data.slice(arrayOffset + 64 + i * 64, arrayOffset + 64 + (i + 1) * 64), 16) * 2;
      const strStart = arrayOffset + 64 + elemOffset;
      const strLen = parseInt(data.slice(strStart, strStart + 64), 16);
      if (isNaN(strLen) || strLen < 0 || strLen > 500) continue;
      const strHex = data.slice(strStart + 64, strStart + 64 + strLen * 2);
      const bytes = new Uint8Array(strHex.match(/.{2}/g)?.map((b) => parseInt(b, 16)) || []);
      result.push(new TextDecoder().decode(bytes));
    }
    return result;
  } catch (err) {
    console.warn("[DApp DB] decodeAbiStringArray error:", err);
    return [];
  }
}

export function decodeAbiWorkspace(hexResult: string): { name: string; owner: string; ipfsCID: string; updatedAt: number } | null {
  if (!hexResult || hexResult === "0x" || hexResult.length < 256) return null;
  const data = hexResult.startsWith("0x") ? hexResult.slice(2) : hexResult;
  try {
    const nameOffset = parseInt(data.slice(0, 64), 16) * 2;
    const owner = "0x" + data.slice(64 + 24, 128);
    const cidOffset = parseInt(data.slice(128, 192), 16) * 2;
    const updatedAt = parseInt(data.slice(192, 256), 16);

    const nameLen = parseInt(data.slice(nameOffset, nameOffset + 64), 16);
    const nameHex = data.slice(nameOffset + 64, nameOffset + 64 + nameLen * 2);
    const nameBytes = new Uint8Array(nameHex.match(/.{2}/g)?.map((b) => parseInt(b, 16)) || []);
    const name = new TextDecoder().decode(nameBytes);

    const cidLen = parseInt(data.slice(cidOffset, cidOffset + 64), 16);
    const cidHex = data.slice(cidOffset + 64, cidOffset + 64 + cidLen * 2);
    const cidBytes = new Uint8Array(cidHex.match(/.{2}/g)?.map((b) => parseInt(b, 16)) || []);
    const ipfsCID = new TextDecoder().decode(cidBytes);

    return { name, owner, ipfsCID, updatedAt };
  } catch (err) {
    console.warn("[DApp DB] decodeAbiWorkspace error:", err);
    return null;
  }
}

export async function directRpcRead(contractAddr: string, calldata: string, timeoutMs = 15000): Promise<string> {
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

// ── Wallet Helpers ───────────────────────────────────────────────────────
export function getStoredWalletAddress(): string | null {
  if (typeof window === "undefined") return null;
  if (currentUserAddress) return currentUserAddress;
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
  } catch { }
  return null;
}

export async function getWalletAddress(): Promise<string | null> {
  const isMock = getEnvVar("VITE_MOCK_FIAI") === "true";
  if (isMock) return "0xMockUserAddress1234567890abcdef12345678";

  const stored = getStoredWalletAddress();
  if (stored) return stored;
  return null;
}

export async function getWalletAddressViaBridge(): Promise<string | null> {
  const isMock = getEnvVar("VITE_MOCK_FIAI") === "true";
  if (isMock) return "0xMockUserAddress1234567890abcdef12345678";

  const stored = getStoredWalletAddress();
  if (stored) return stored;

  console.log(`[DApp DB] Đang kết nối ví qua Bridge...`);
  const { getActiveWallet } = await import("@metanodejs/system-core");
  const timeoutMs = 20000;
  const timeoutTask = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Không thể kết nối với ví MetaNode (quá ${timeoutMs / 1000} giây). Lỗi mạng hoặc Bridge không phản hồi.`));
    }, timeoutMs);
  });

  const wallet = await Promise.race([getActiveWallet(), timeoutTask]);
  if (typeof document !== "undefined") {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  }
  return (wallet as any)?.address || null;
}

// ── State Variables ──────────────────────────────────────────────────────
export let baseCID: string = "";
export let currentUserAddress: string | null = null;
let ipfsDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let lastUploadedCID: string | null = null;
let lastUploadedDataHash: string | null = null;
let isUploadingIPFS = false;
let isDirtyState = false;
let isDAppDBInitialized = false;

function getDBStorageKey(): string {
  return currentUserAddress || "local";
}

// ── IPFS Upload & Fetch ──────────────────────────────────────────────────
export async function uploadToIPFS(force = false): Promise<string | null> {
  if (typeof window === "undefined") return null;
  const dbToSave = getDBSnapshot();

  const hasData = Object.keys(dbToSave).some(key => {
    const val = dbToSave[key];
    if (Array.isArray(val)) return val.length > 0;
    if (val && typeof val === "object") return Object.keys(val).length > 0;
    return Boolean(val);
  });
  if (!hasData) {
    console.log("[DApp DB] Bỏ qua IPFS upload — chưa có dữ liệu off-chain.");
    return null;
  }

  const hasRealContent =
    (localDB.users && localDB.users.length > 0) ||
    (localDB.workspaces && localDB.workspaces.length > 0) ||
    (localDB.projects && localDB.projects.length > 0) ||
    (localDB.issues && localDB.issues.length > 0);

  const existingCID =
    lastUploadedCID ||
    localStorage.getItem(`plane_dapp_ipfs_cid_${getDBStorageKey()}`) ||
    localStorage.getItem("plane_dapp_ipfs_cid_local") ||
    localStorage.getItem("plane_dapp_ipfs_cid_last_valid");

  if (!force && !isDAppDBInitialized && !hasRealContent) {
    console.log("[DApp DB] Bỏ qua IPFS upload — cơ sở dữ liệu chưa hoàn tất nạp từ IPFS/chain.");
    return null;
  }

  if (!force && existingCID && !existingCID.startsWith("bafkrei") && !hasRealContent) {
    console.warn("[DApp DB] Chặn upload IPFS rỗng: Tránh ghi đè mất dữ liệu cũ trên IPFS:", existingCID);
    return existingCID;
  }

  const serialized = JSON.stringify(dbToSave);
  if (serialized === lastUploadedDataHash && lastUploadedCID && !lastUploadedCID.startsWith("bafkrei")) {
    return lastUploadedCID;
  }

  try {
    isUploadingIPFS = true;
    console.log("[DApp DB] Đang tự động upload dữ liệu off-chain lên IPFS Pinata...");
    let cid: string | null = null;
    const proxyUrl = getProxyUrl();
    if (proxyUrl) {
      try {
        const response = await fetch(proxyUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: serialized,
        });
        if (response.ok) {
          const resJson = await response.json();
          cid = resJson?.cid || null;
          console.log(`[DApp DB] ✅ Upload thành công lên Pinata IPFS! CID: ${cid}`);
        } else {
          const errText = await response.text().catch(() => "");
          console.warn(`[DApp DB] Pinata proxy trả về mã lỗi ${response.status}:`, errText);
        }
      } catch (proxyErr) {
        console.warn("[DApp DB] Không thể kết nối tới Pinata proxy:", proxyErr);
      }
    }

    if (!cid) {
      let hash = 0;
      for (let i = 0; i < serialized.length; i++) {
        hash = (hash << 5) - hash + serialized.charCodeAt(i);
        hash |= 0;
      }
      cid = `bafkrei${Math.abs(hash).toString(36)}${Date.now().toString(36)}`;
    }

    try {
      sessionStorage.setItem(`ipfs_${cid}`, serialized);
    } catch { }

    lastUploadedCID = cid;
    lastUploadedDataHash = serialized;
    isDirtyState = false;
    const storageKey = getDBStorageKey();
    localStorage.setItem(`plane_dapp_ipfs_cid_${storageKey}`, cid);
    localStorage.setItem("plane_dapp_ipfs_cid_local", cid);
    localStorage.setItem("plane_dapp_ipfs_cid_last_valid", cid);
    syncWorkspacesToCookie(cid);
    console.log(`[DApp DB] ✅ Auto-save IPFS thành công: ${cid}`);
    return cid;
  } catch (err) {
    console.error("[DApp DB] IPFS upload lỗi:", err);
    return null;
  } finally {
    isUploadingIPFS = false;
  }
}

export function scheduleIPFSUpload(): void {
  if (ipfsDebounceTimer) clearTimeout(ipfsDebounceTimer);
  ipfsDebounceTimer = setTimeout(() => {
    void uploadToIPFS();
  }, 2000);
}

export function getLastUploadedCID(): string | null {
  if (isDirtyState) return null;
  if (lastUploadedCID) return lastUploadedCID;
  if (typeof window === "undefined") return null;
  return localStorage.getItem(`plane_dapp_ipfs_cid_${getDBStorageKey()}`) || localStorage.getItem("plane_dapp_ipfs_cid_local");
}

export function isIPFSUploading(): boolean {
  return isUploadingIPFS;
}

export async function fetchFromIPFS(cid: string): Promise<Record<string, any> | null> {
  if (!cid || typeof cid !== "string" || cid.trim() === "") return null;
  const cleanCid = cid.trim();

  try {
    const cached = sessionStorage.getItem(`ipfs_${cleanCid}`);
    if (cached) {
      const json = JSON.parse(cached);
      if (json && typeof json === "object") return json;
    }
  } catch { }

  const gateways = [
    `https://gateway.pinata.cloud/ipfs/${cleanCid}`,
    `https://cloudflare-ipfs.com/ipfs/${cleanCid}`,
    `https://ipfs.io/ipfs/${cleanCid}`,
    `https://dweb.link/ipfs/${cleanCid}`,
  ];

  for (const gw of gateways) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(gw, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (res.ok) {
        const json = await res.json();
        if (json && typeof json === "object") {
          console.log(`[DApp DB] Tải thành công từ IPFS gateway: ${gw}`);
          return json;
        }
      }
    } catch (err) {
      console.warn(`[DApp DB] IPFS gateway ${gw} lỗi hoặc timeout:`, err);
    }
  }
  console.error(`[DApp DB] Không thể tải dữ liệu từ bất kỳ IPFS gateway nào cho CID: ${cleanCid}`);
  return null;
}

export function applyOffchainDB(ipfsDB: Record<string, any>): void {
  if (ipfsDB.credentials && typeof ipfsDB.credentials === "object") {
    for (const [email, hash] of Object.entries(ipfsDB.credentials)) {
      if (email && typeof hash === "string") {
        setStoredCredential(email, hash);
      }
    }
  }

  const currentWorkspaces = [...(localDB.workspaces || [])];
  const currentUsers = [...(localDB.users || [])];
  const currentIssues = [...(localDB.issues || [])];
  const currentComments = [...(localDB.issue_comments || [])];
  const currentAttachments = [...(localDB.attachments || [])];
  const mergedDeletedProjects = new Set<string>([
    ...(localDB._deleted_project_ids || []),
    ...(ipfsDB._deleted_project_ids || []),
  ]);

  for (const key in localDB) delete localDB[key];
  Object.assign(localDB, ipfsDB);

  localDB._deleted_project_ids = Array.from(mergedDeletedProjects);

  if (!localDB.users) localDB.users = [];
  for (const u of currentUsers) {
    if (!localDB.users.some((existing: any) => existing.id === u.id || (existing.email && existing.email.toLowerCase() === u.email?.toLowerCase()))) {
      localDB.users.push(u);
    }
  }

  if (!localDB.workspaces) localDB.workspaces = [];
  for (const w of currentWorkspaces) {
    if (!localDB.workspaces.some((existing: any) => existing.slug === w.slug || existing.id === w.id)) {
      localDB.workspaces.push(w);
    }
  }
  if (localDB.workspaces.length === 0) localDB.workspaces = [DEFAULT_WORKSPACE];

  if (!localDB.projects) localDB.projects = [];
  localDB.projects = localDB.projects.filter(
    (p: any) => !mergedDeletedProjects.has(p.id) && !mergedDeletedProjects.has(p.identifier)
  );
  (localDB.projects || []).forEach((p: any) => {
    if (!p.logo_props) p.logo_props = { in_use: "icon", icon: { name: "folder", color: "#3f3f46" } };
  });

  if (!localDB.states) localDB.states = [];
  localDB.states = localDB.states.filter(
    (s: any) => !mergedDeletedProjects.has(s.project) && !mergedDeletedProjects.has(s.project_id)
  );

  if (!localDB.issues) localDB.issues = [];
  for (const issue of currentIssues) {
    if (
      !mergedDeletedProjects.has(issue.project) &&
      !mergedDeletedProjects.has(issue.project_id) &&
      !localDB.issues.some((i: any) => i.id === issue.id)
    ) {
      localDB.issues.push(issue);
    }
  }
  localDB.issues = localDB.issues.filter(
    (i: any) => !mergedDeletedProjects.has(i.project) && !mergedDeletedProjects.has(i.project_id)
  );

  if (localDB.labels) {
    localDB.labels = localDB.labels.filter(
      (l: any) => !mergedDeletedProjects.has(l.project) && !mergedDeletedProjects.has(l.project_id)
    );
  }
  if (localDB.cycles) {
    localDB.cycles = localDB.cycles.filter(
      (c: any) => !mergedDeletedProjects.has(c.project) && !mergedDeletedProjects.has(c.project_id)
    );
  }
  if (localDB.modules) {
    localDB.modules = localDB.modules.filter(
      (m: any) => !mergedDeletedProjects.has(m.project) && !mergedDeletedProjects.has(m.project_id)
    );
  }
  if (localDB.project_members) {
    localDB.project_members = localDB.project_members.filter(
      (pm: any) => !mergedDeletedProjects.has(pm.project) && !mergedDeletedProjects.has(pm.project_id)
    );
  }
  if (!localDB.issue_comments) localDB.issue_comments = [];
  for (const c of currentComments) {
    if (!localDB.issue_comments.some((existing: any) => existing.id === c.id)) {
      localDB.issue_comments.push(c);
    }
  }
  if (!localDB.attachments) localDB.attachments = [];
  for (const a of currentAttachments) {
    if (!localDB.attachments.some((existing: any) => existing.id === a.id)) {
      localDB.attachments.push(a);
    }
  }
  if (!localDB.instance) localDB.instance = { ...defaultDB.instance };
  localDB.instance.is_setup_done = true;

  if (localDB.instance.id === "dapp-instance") {
    localDB.instance.id = "instance-main";
    localDB.instance.instance_id = "instance-main";
  }
  if (localDB.instance.instance_name === "Plane DApp") {
    localDB.instance.instance_name = "Plane Instance";
  }

  isDAppDBInitialized = true;
  try {
    const snapshot = JSON.stringify(localDB);
    localStorage.setItem("plane_dapp_local_db", snapshot);
    sessionStorage.setItem("plane_dapp_latest_db", snapshot);
  } catch { }
  syncWorkspacesToCookie();
}

export function resolveDBConflict(choice: "USE_CHAIN" | "USE_LOCAL", cid: string, ipfsDB: any): void {
  if (typeof window === "undefined" || !currentUserAddress) return;

  if (choice === "USE_CHAIN") {
    baseCID = cid;
    applyOffchainDB(ipfsDB);
    localStorage.setItem(`plane_dapp_ipfs_cid_${currentUserAddress}`, cid);
  } else if (choice === "USE_LOCAL") {
    baseCID = cid;
    void uploadToIPFS();
  }
}
  
export async function restoreFromIPFS(cid: string): Promise<boolean> {
  const cleanCid = cid.trim();
  if (!cleanCid) return false;
  console.log(`[DApp DB] Đang khôi phục dữ liệu từ IPFS CID: ${cleanCid}`);
  const ipfsDB = await fetchFromIPFS(cleanCid);
  if (ipfsDB) {
    applyOffchainDB(ipfsDB);
    saveDB();
    if (typeof window !== "undefined") {
      localStorage.setItem("plane_dapp_ipfs_cid_local", cleanCid);
      localStorage.setItem(`plane_dapp_ipfs_cid_${getDBStorageKey()}`, cleanCid);
      lastUploadedCID = cleanCid;
    }
    console.log(`[DApp DB] Khôi phục thành công từ IPFS CID: ${cleanCid}`);
    return true;
  }
  return false;
}

if (typeof window !== "undefined") {
  (window as any).restoreFromIPFS = restoreFromIPFS;
}

// ── Database Initializer with Smart Contract / IPFS ──────────────────────
async function _initDAppDB() {
  if (typeof window === "undefined") return { status: "OK" };
  const activeWallet = await getWalletAddress().catch(() => null);

  const urlParams = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const urlCid = urlParams?.get("cid");

  if (!activeWallet) {
    console.log(`[DApp DB] Chưa có ví. Tìm kiếm CID từ local cache, cookie hoặc on-chain...`);
    let candidateCid =
      urlCid ||
      localStorage.getItem(`plane_dapp_ipfs_cid_${getDBStorageKey()}`) ||
      localStorage.getItem("plane_dapp_ipfs_cid_local") ||
      localStorage.getItem("plane_dapp_ipfs_cid_last_valid");

    if (!candidateCid && typeof document !== "undefined") {
      const cookies = document.cookie ? document.cookie.split(";") : [];
      const cidCookie = cookies.find((row) => row.trim().startsWith("plane_dapp_sync_cid="));
      if (cidCookie) {
        const raw = cidCookie.trim().substring(cidCookie.trim().indexOf("=") + 1);
        candidateCid = decodeURIComponent(raw || "").trim();
      }
    }

    if (!candidateCid && WORKSPACE_REGISTRY_ADDRESS) {
      try {
        const wsInfoCalldata = abiEncodeGetWorkspace("fiai");
        const wsInfoRaw = await directRpcRead(WORKSPACE_REGISTRY_ADDRESS, wsInfoCalldata, 3000);
        const wsInfo = decodeAbiWorkspace(wsInfoRaw);
        if (wsInfo?.ipfsCID && wsInfo.ipfsCID.trim() !== "") {
          candidateCid = wsInfo.ipfsCID.trim();
          console.log(`[DApp DB] Tìm thấy CID workspace "fiai" từ contract:`, candidateCid);
        }
      } catch { }
    }

    if (candidateCid) {
      console.log(`[DApp DB] Khởi tạo DB từ CID: ${candidateCid}`);
      const ipfsDB = await fetchFromIPFS(candidateCid);
      if (ipfsDB) {
        applyOffchainDB(ipfsDB);
        lastUploadedCID = candidateCid;
        localStorage.setItem("plane_dapp_ipfs_cid_local", candidateCid);
        localStorage.setItem("plane_dapp_ipfs_cid_last_valid", candidateCid);
        isDAppDBInitialized = true;
        return { status: "OK" };
      }
    }

    try {
      const cached = localStorage.getItem("plane_dapp_local_db") || sessionStorage.getItem("plane_dapp_latest_db");
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && typeof parsed === "object") {
          applyOffchainDB(parsed);
          console.log("[DApp DB] Nạp DB từ local cache snapshot thành công.");
        }
      }
    } catch { }

    if (!lastUploadedCID || lastUploadedCID.startsWith("bafkrei")) {
      scheduleIPFSUpload();
    }

    isDAppDBInitialized = true;
    return { status: "OK" };
  }

  if (currentUserAddress && activeWallet.toLowerCase() !== currentUserAddress.toLowerCase()) {
    for (const key in localDB) delete localDB[key];
    Object.assign(localDB, JSON.parse(JSON.stringify(defaultDB)));
  }
  currentUserAddress = activeWallet;

  try {
    const isMock = getEnvVar("VITE_MOCK_FIAI") === "true";
    if (isMock) {
      isDAppDBInitialized = true;
      return { status: "OK" };
    }

    let onChainUserCid = "";
    try {
      const calldata = abiEncodeGetCID(currentUserAddress as string, "plane_dapp_db");
      const rawResult = await directRpcRead(CONTRACT_ADDRESS, calldata, 8000);
      onChainUserCid = decodeAbiString(rawResult);
    } catch { }

    let onChainWorkspaceCid = "";
    if (WORKSPACE_REGISTRY_ADDRESS) {
      try {
        const userWsCalldata = abiEncodeGetUserWorkspaces(currentUserAddress as string);
        const userWsRaw = await directRpcRead(WORKSPACE_REGISTRY_ADDRESS, userWsCalldata, 8000);
        const userWsSlugs = decodeAbiStringArray(userWsRaw);

        if (!localDB.workspaces) localDB.workspaces = [];
        const slugsToCheck = Array.from(new Set([...userWsSlugs, "fiai"]));

        for (const slug of slugsToCheck) {
          try {
            const wsInfoCalldata = abiEncodeGetWorkspace(slug);
            const wsInfoRaw = await directRpcRead(WORKSPACE_REGISTRY_ADDRESS, wsInfoCalldata, 5000);
            const wsInfo = decodeAbiWorkspace(wsInfoRaw);
            if (wsInfo && wsInfo.name) {
              const existingIdx = localDB.workspaces.findIndex((w: any) => w.slug === slug);
              if (existingIdx > -1) {
                localDB.workspaces[existingIdx].name = wsInfo.name;
                localDB.workspaces[existingIdx].owner = wsInfo.owner;
              } else {
                localDB.workspaces.push({
                  id: slug,
                  name: wsInfo.name,
                  slug: slug,
                  owner: wsInfo.owner,
                  created_at: new Date().toISOString(),
                  updated_at: new Date(wsInfo.updatedAt * 1000).toISOString(),
                });
              }

              if (wsInfo.ipfsCID && !onChainWorkspaceCid) {
                onChainWorkspaceCid = wsInfo.ipfsCID;
              }
            }
          } catch { }
        }
        syncWorkspacesToCookie();
      } catch { }
    }

    const onChainCid = onChainWorkspaceCid || onChainUserCid;
    baseCID = onChainCid || "";

    const cachedIpfsCid =
      localStorage.getItem(`plane_dapp_ipfs_cid_${currentUserAddress}`) ||
      localStorage.getItem("plane_dapp_ipfs_cid_local");
    const targetCID = onChainCid || cachedIpfsCid;

    if (targetCID && targetCID !== "") {
      const ipfsDB = await fetchFromIPFS(targetCID);
      if (ipfsDB) {
        if (onChainCid && cachedIpfsCid && onChainCid !== cachedIpfsCid) {
          console.warn(`[DApp DB] Phát hiện xung đột CID: On-chain (${onChainCid}) vs IPFS (${cachedIpfsCid})`);
          isDAppDBInitialized = true;
          return { status: "CONFLICT", cid: onChainCid, ipfsDB };
        }
        applyOffchainDB(ipfsDB);
        lastUploadedCID = targetCID;
        isDAppDBInitialized = true;
        return { status: "OK" };
      }
    }

    isDAppDBInitialized = true;
    return { status: "OK" };
  } catch (err) {
    console.error("Failed to load DApp DB from chain / IPFS:", err);
    isDAppDBInitialized = true;
    return { status: "OK" };
  }
}

export async function initDAppDB() {
  const timeoutMs = 20000;
  const timeoutTask = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Quá thời gian kết nối (${timeoutMs / 1000} giây). Lỗi mạng, SSL, hoặc Bridge không phản hồi.`));
    }, timeoutMs);
  });

  return Promise.race([_initDAppDB(), timeoutTask]);
}

export async function syncDAppDBToChain(forcedWallet?: string) {
  const activeWallet = forcedWallet || getStoredWalletAddress();
  if (!activeWallet) throw new Error("Chưa kết nối ví. Vui lòng kết nối ví từ giao diện.");
  if (currentUserAddress && activeWallet.toLowerCase() !== currentUserAddress.toLowerCase()) {
    throw new Error("Tài khoản ví đã thay đổi. Vui lòng tải lại trang để nạp dữ liệu của ví mới.");
  }
  currentUserAddress = activeWallet;

  let cid = isDirtyState ? null : getLastUploadedCID();
  if (!cid) {
    if (ipfsDebounceTimer) {
      clearTimeout(ipfsDebounceTimer);
      ipfsDebounceTimer = null;
    }
    cid = await uploadToIPFS(true);
  }
  if (!cid) throw new Error("Không thể upload dữ liệu lên IPFS.");

  const bridge = typeof window !== "undefined" ? (window as any).fiaiSDK : null;
  if (!bridge) throw new Error("FiaiSDK is not available.");

  try {
    const sysCore = (await import("@metanodejs/system-core")) as any;
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
  } catch { }

  await bridge.request("sendTransaction", {
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

  if (WORKSPACE_REGISTRY_ADDRESS && bridge) {
    try {
      const activeUserId = getLoggedInUserId();
      const activeUser = (localDB.users || []).find((u: any) => u.id === activeUserId);
      const activeSlug =
        (typeof window !== "undefined" ? localStorage.getItem("last_workspace_slug") : null) ||
        activeUser?.last_workspace_slug ||
        localDB.workspaces?.[0]?.slug ||
        "fiai";
      const targetWs = (localDB.workspaces || []).find((w: any) => w.slug === activeSlug) || localDB.workspaces?.[0];
      const targetSlug = targetWs?.slug || activeSlug || "fiai";
      const targetName = targetWs?.name || "Plane Workspace";

      await bridge.request("sendTransaction", {
        from: currentUserAddress as string,
        to: WORKSPACE_REGISTRY_ADDRESS,
        abiData: [UPDATE_WORKSPACE_CID_ABI],
        functionName: "updateWorkspaceCID",
        feeType: "sc",
        amount: "0",
        value: "0",
        gas: "3000000",
        type: "transaction",
        inputArray: [
          { name: "slug", type: "string", value: targetSlug },
          { name: "newCid", type: "string", value: cid },
        ],
        isReadOnly: false,
        bundleId: "",
      }).catch(async () => {
        return bridge.request("sendTransaction", {
          from: currentUserAddress as string,
          to: WORKSPACE_REGISTRY_ADDRESS,
          abiData: [CREATE_WORKSPACE_ABI],
          functionName: "createWorkspace",
          feeType: "sc",
          amount: "0",
          value: "0",
          gas: "3000000",
          type: "transaction",
          inputArray: [
            { name: "slug", type: "string", value: targetSlug },
            { name: "name", type: "string", value: targetName },
            { name: "initialCid", type: "string", value: cid },
          ],
          isReadOnly: false,
          bundleId: "",
        });
      });
    } catch { }
  }

  baseCID = cid;
  isDirtyState = false;
  return cid;
}

// ── Connect Hooks ────────────────────────────────────────────────────────
registerSaveHook(() => {
  scheduleIPFSUpload();
});

syncCrossPortWorkspaces(async (newCid) => {
  try {
    const ipfsDB = await fetchFromIPFS(newCid);
    if (ipfsDB) {
      applyOffchainDB(ipfsDB);
      saveDB();
    }
  } catch {
    // Ignore cross-port sync fetch failures
  }
});
