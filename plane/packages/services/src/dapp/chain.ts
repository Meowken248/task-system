import {
  localDB,
  defaultDB,
  saveDB,
  getDBSnapshot,
  getEnvVar,
  getContractGas,
  getDefaultWorkspaceSlug,
  getLoggedInUserId,
  getLoggedInEmail,
  syncWorkspacesToCookie,
  registerSaveHook,
  syncCrossPortWorkspaces,
  DEFAULT_WORKSPACE,
  getStoredInvitations,
  saveStoredInvitations,
  isInvitationDeleted,
} from "./store";
import { preserveLocalUserAuth, sanitizeSharedSnapshot } from "./shared-snapshot";
import { readIPFSSnapshot } from "./ipfs-snapshot";
import { resolveInvitationWorkspace } from "./invitation-workspace";
import { saveSnapshotToIDB, loadSnapshotFromIDB, saveCidToIDB, getCidFromIDB } from "./indexed-db";
import { registerSigningSessionInvalidator, runExclusiveChainTx } from "./tx-gateway";
import { publishSnapshot, snapshotUploadPolicy, isPublishedCID, notifySnapshotUploadReuse, SnapshotUploadError } from "./snapshot-upload";
import { walletMemberOperationPending, setWalletMemberOperationPending, clearWalletMemberOperationPending } from "./wallet-member-operation";

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
    { internalType: "string", name: "key", type: "string" },
  ],
  outputs: [{ internalType: "string", name: "", type: "string" }],
  stateMutability: "view",
};

export const SET_CID_ABI = {
  type: "function",
  name: "setCID",
  inputs: [
    { internalType: "string", name: "key", type: "string" },
    { internalType: "string", name: "cid", type: "string" },
  ],
  outputs: [],
  stateMutability: "nonpayable",
};

export const SET_CID_IF_MATCHES_ABI = {
  type: "function",
  name: "setCIDIfMatches",
  inputs: [
    { internalType: "string", name: "key", type: "string" },
    { internalType: "string", name: "expectedOldCid", type: "string" },
    { internalType: "string", name: "newCid", type: "string" },
  ],
  outputs: [],
  stateMutability: "nonpayable",
};

export function getRegistryContractAddress(): string {
  return getEnvVar("VITE_REGISTRY_CONTRACT_ADDRESS") || getEnvVar("NEXT_PUBLIC_REGISTRY_CONTRACT_ADDRESS") || "";
}

export function getWorkspaceRegistryAddress(): string {
  return getEnvVar("VITE_WORKSPACE_REGISTRY_ADDRESS") || getEnvVar("NEXT_PUBLIC_WORKSPACE_REGISTRY_ADDRESS") || "";
}

let warnedAboutClientSigningKey = false;

/**
 * Khoá BLS dùng khi contract yêu cầu chữ ký BLS.
 *
 * CẢNH BÁO: đây là biến `VITE_*` nên giá trị sẽ nằm trong bundle trình duyệt.
 * Production phải để trống (xem `.env.production.example`); chỉ dùng ở môi
 * trường phát triển khi kiểm thử contract.
 */
export function getBlsPrivateKey(): string | undefined {
  const key = (getEnvVar("VITE_BLS_PRIVATE_KEY") || "").trim();
  if (!key) return undefined;
  if (!warnedAboutClientSigningKey) {
    warnedAboutClientSigningKey = true;
    console.warn(
      "[DApp Chain] Đang dùng khoá ký BLS ngay trên trình duyệt (VITE_BLS_PRIVATE_KEY). " +
        "Khoá nằm trong bundle công khai nên chỉ được dùng ở môi trường phát triển."
    );
  }
  return key;
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

export const UPDATE_WORKSPACE_CID_IF_MATCHES_ABI = {
  ...UPDATE_WORKSPACE_CID_ABI,
  name: "updateWorkspaceCIDIfMatches",
  inputs: [
    { internalType: "string", name: "slug", type: "string" },
    { internalType: "string", name: "expectedOldCid", type: "string" },
    { internalType: "string", name: "newCid", type: "string" },
  ],
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

export const JOIN_WORKSPACE_ABI = {
  type: "function",
  name: "joinWorkspace",
  inputs: [{ internalType: "string", name: "slug", type: "string" }],
  outputs: [],
  stateMutability: "nonpayable",
};

export const LEAVE_WORKSPACE_ABI = { ...JOIN_WORKSPACE_ABI, name: "leaveWorkspace" };

export class MembershipOperationError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "MembershipOperationError";
    this.code = code;
  }
}

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
  if (r === 20) return 2;
  if (r === 15) return 1;
  throw new MembershipOperationError("UNSUPPORTED_ROLE", "Contract chỉ hỗ trợ quyền Admin và Member. Không tự chuyển Guest hoặc quyền khác thành Member.");
}

export function getFiaiSDK(): any {
  if (typeof window !== "undefined") {
    return (window as any).fiaiSDK || null;
  }
  return null;
}

const PLACEHOLDER_PATTERNS = ["your-worker", "your-subdomain", "your-domain", "example.com"];

export function getProxyUrl(): string | null {
  const url = (getEnvVar("VITE_PINATA_PROXY_URL") || "").trim();
  if (!url) return null;
  if (PLACEHOLDER_PATTERNS.some((p) => url.includes(p))) return null;
  return url;
}

export function getConfiguredIpfsGateways(cid: string): string[] {
  const raw = (getEnvVar("VITE_IPFS_GATEWAYS") || "").trim();
  const list = raw
    ? raw
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
  return list.map((prefix) => `${prefix.endsWith("/") ? prefix : `${prefix}/`}${cid}`);
}

// ── Direct RPC (bypass Bridge iframe for read-only calls) ──────────────
const GET_CID_SELECTOR = "0xfa3e97e7";
const GET_WORKSPACE_CID_SELECTOR = "0xdf48cfdc";
const GET_USER_WORKSPACES_SELECTOR = "0xd7d19c4e";
const GET_WORKSPACE_SELECTOR = "0x1cd7381a";
const GET_MEMBER_ROLE_SELECTOR = "0xb1eed828";
const GET_WORKSPACE_MEMBERS_SELECTOR = "0x4f597d85";

let warnedInsecureRpc = false;

/**
 * URL node đọc dữ liệu on-chain. Cảnh báo một lần nếu cấu hình dùng `http://` trên
 * địa chỉ không phải mạng nội bộ: dữ liệu (và chữ ký đọc) có thể bị nghe lén/sửa
 * trên đường truyền (SEC-05). Cảnh báo thay vì chặn để không làm sập môi trường
 * đang chạy, nhưng phải xử lý trước khi mở ra Internet.
 */
export function getRpcUrl(): string {
  const url = (getEnvVar("VITE_RPC_URL") || "").trim();
  if (!warnedInsecureRpc && url && typeof window !== "undefined") {
    warnedInsecureRpc = true;
    const isPrivateHost = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\]|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(
      url
    );
    if (url.toLowerCase().startsWith("http://") && !isPrivateHost) {
      console.warn(
        "[DApp Chain] VITE_RPC_URL đang dùng http:// trên địa chỉ công khai — dữ liệu có thể bị đọc/sửa trên đường truyền. Hãy chuyển sang https."
      );
    }
  }
  return url;
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
  const keyLen = keyBytes.length / 2;
  const keyLenHex = padHex(keyLen.toString(16), 32);
  const keyDataHex = keyBytes.padEnd(Math.ceil(keyBytes.length / 64) * 64, "0");
  return GET_CID_SELECTOR + addressHex + offsetHex + keyLenHex + keyDataHex;
}

export function abiEncodeGetWorkspaceCID(slug: string): string {
  const offsetHex = padHex("20", 32);
  const slugBytes = utf8ToHex(slug);
  const slugLen = slugBytes.length / 2;
  const slugLenHex = padHex(slugLen.toString(16), 32);
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
  const slugLen = slugBytes.length / 2;
  const slugLenHex = padHex(slugLen.toString(16), 32);
  const slugDataHex = slugBytes.padEnd(Math.ceil(slugBytes.length / 64) * 64, "0");
  return GET_WORKSPACE_SELECTOR + offsetHex + slugLenHex + slugDataHex;
}

export function abiEncodeGetMemberRole(slug: string, userAddress: string): string {
  const offsetHex = padHex("40", 32);
  const addressHex = padHex(userAddress, 32);
  const slugBytes = utf8ToHex(slug);
  const slugLen = slugBytes.length / 2;
  const slugLenHex = padHex(slugLen.toString(16), 32);
  const slugDataHex = slugBytes.padEnd(Math.ceil(slugBytes.length / 64) * 64, "0");
  return GET_MEMBER_ROLE_SELECTOR + offsetHex + addressHex + slugLenHex + slugDataHex;
}

export function abiEncodeGetWorkspaceMembers(slug: string): string {
  const offsetHex = padHex("20", 32);
  const slugBytes = utf8ToHex(slug);
  const slugLen = slugBytes.length / 2;
  const slugLenHex = padHex(slugLen.toString(16), 32);
  const slugDataHex = slugBytes.padEnd(Math.ceil(slugBytes.length / 64) * 64, "0");
  return GET_WORKSPACE_MEMBERS_SELECTOR + offsetHex + slugLenHex + slugDataHex;
}

export function decodeAbiAddressArray(hexResult: string): string[] {
  if (!hexResult || hexResult === "0x" || hexResult.length < 130) return [];
  const data = hexResult.startsWith("0x") ? hexResult.slice(2) : hexResult;
  try {
    const arrayOffset = parseInt(data.slice(0, 64), 16) * 2;
    const count = parseInt(data.slice(arrayOffset, arrayOffset + 64), 16);
    if (isNaN(count) || count <= 0 || count > 500) return [];
    const result: string[] = [];
    for (let i = 0; i < count; i++) {
      const wordStart = arrayOffset + 64 + i * 64;
      const word = data.slice(wordStart, wordStart + 64);
      if (word.length === 64) {
        const addr = "0x" + word.slice(24, 64).toLowerCase();
        result.push(addr);
      }
    }
    return result;
  } catch (err) {
    console.warn("[DApp DB] decodeAbiAddressArray error:", err);
    return [];
  }
}

const membersOnChainCache = new Map<string, { addresses: string[]; timestamp: number }>();
const membersOnChainInFlight = new Map<string, Promise<string[]>>();

export function invalidateWorkspaceMembersOnChainCache(slug?: string): void {
  if (slug) {
    membersOnChainCache.delete(slug);
    membersOnChainInFlight.delete(slug);
  } else {
    membersOnChainCache.clear();
    membersOnChainInFlight.clear();
  }
}

export async function fetchMemberRoleOnChain(slug: string, memberAddress: string): Promise<number> {
  const wsRegistryAddr = getWorkspaceRegistryAddress();
  if (!wsRegistryAddr || !slug || !memberAddress) return 0;
  try {
    const roleCalldata = abiEncodeGetMemberRole(slug, memberAddress);
    const roleHex = await directRpcRead(wsRegistryAddr, roleCalldata, 4000);
    if (!/^0x[0-9a-f]{64}$/i.test(roleHex)) throw new Error("Invalid membership response");
    const role = decodeAbiUint8(roleHex);
    if (![0, 1, 2, 3].includes(role)) throw new Error("Invalid membership role");
    return role;
  } catch (err) {
    console.warn(`[DApp Chain] fetchMemberRoleOnChain("${slug}", "${memberAddress}") error:`, err);
    return -1;
  }
}

export async function fetchWorkspaceMembersOnChain(slug: string, forceRefresh = false): Promise<string[]> {
  const wsRegistryAddr = getWorkspaceRegistryAddress();
  if (!wsRegistryAddr || !slug) return [];

  if (!forceRefresh) {
    const cached = membersOnChainCache.get(slug);
    if (cached && Date.now() - cached.timestamp < 10000) {
      return cached.addresses;
    }
    const inFlight = membersOnChainInFlight.get(slug);
    if (inFlight) {
      return inFlight;
    }
  }

  const fetchPromise = (async () => {
    try {
      const calldata = abiEncodeGetWorkspaceMembers(slug);
      const hex = await directRpcRead(wsRegistryAddr, calldata, 6000);
      const allAddresses = decodeAbiAddressArray(hex);
      if (!allAddresses || allAddresses.length === 0) {
        membersOnChainCache.set(slug, { addresses: [], timestamp: Date.now() });
        return [];
      }

      // Filter by on-chain role (Role.None = 0, Member = 1, Admin = 2, Owner = 3)
      // In Solidity, removeMember sets role to Role.None (0) but keeps address in _workspaceMemberList.
      // LƯU Ý: Owner (3) cũng là member hợp lệ — bản contract hiện tại thậm chí không thêm Owner
      // vào _workspaceMemberList, nên nếu chỉ nhận role 1|2 thì danh sách member/assignee bị thiếu.
      const activeAddresses: string[] = [];
      const seenAddresses = new Set<string>();
      await Promise.all(
        allAddresses.map(async (addr) => {
          try {
            const roleCalldata = abiEncodeGetMemberRole(slug, addr);
            const roleHex = await directRpcRead(wsRegistryAddr, roleCalldata, 4000);
            const role = decodeAbiUint8(roleHex);
            const normalized = String(addr || "").toLowerCase();
            if (role >= 1) {
              if (!seenAddresses.has(normalized)) {
                seenAddresses.add(normalized);
                activeAddresses.push(addr);
              }
            } else {
              console.log(
                `[DApp Chain] Address ${addr} has role ${role} (không còn là member) on-chain in ${slug}. Excluded.`
              );
            }
          } catch (roleErr) {
            console.warn(`[DApp Chain] Error checking role for ${addr}:`, roleErr);
          }
        })
      );

      // Owner của workspace có thể không nằm trong danh sách member on-chain → bổ sung từ getWorkspace().
      try {
        const workspaceHex = await directRpcRead(wsRegistryAddr, abiEncodeGetWorkspace(slug), 4000);
        const workspaceInfo = decodeAbiWorkspace(workspaceHex);
        const ownerAddress = String(workspaceInfo?.owner || "").toLowerCase();
        if (ownerAddress && /^0x[0-9a-f]{40}$/.test(ownerAddress) && !/^0x0{40}$/.test(ownerAddress)) {
          if (!seenAddresses.has(ownerAddress)) {
            seenAddresses.add(ownerAddress);
            activeAddresses.unshift(workspaceInfo!.owner);
          }
        }
      } catch (ownerErr) {
        console.warn(`[DApp Chain] Không đọc được owner on-chain của workspace "${slug}":`, ownerErr);
      }

      membersOnChainCache.set(slug, { addresses: activeAddresses, timestamp: Date.now() });
      return activeAddresses;
    } catch (err) {
      console.warn(`[DApp DB] fetchWorkspaceMembersOnChain("${slug}") error:`, err);
      return [];
    } finally {
      membersOnChainInFlight.delete(slug);
    }
  })();

  membersOnChainInFlight.set(slug, fetchPromise);
  return fetchPromise;
}

export function decodeAbiUint8(hexResult: string): number {
  if (!hexResult || hexResult === "0x") return 0;
  const data = hexResult.startsWith("0x") ? hexResult.slice(2) : hexResult;
  if (data.length < 64) return 0;
  const parsed = parseInt(data.slice(0, 64), 16);
  return Number.isFinite(parsed) ? parsed : 0;
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

export function decodeAbiWorkspace(
  hexResult: string
): { name: string; owner: string; ipfsCID: string; updatedAt: number } | null {
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
  // An explicit selection in the current tab wins over a previous bootstrap's
  // in-memory address. Otherwise switching accounts can rediscover the old
  // wallet's workspaces until a full reload.
  try {
    for (const storage of [sessionStorage, localStorage]) {
      const selected = storage.getItem("plane_active_wallet_address")?.trim() || "";
      if (/^0x[a-fA-F0-9]{40}$/.test(selected)) return selected;
    }
  } catch { /* Fall back to the last bootstrap address if storage is blocked. */ }
  if (currentUserAddress) return currentUserAddress;
  try {
    const directKeys = [
      "plane_active_wallet_address",
      "active_wallet_address",
      "plane_last_active_wallet",
      "metanode:active_wallet",
      "plane_dapp_auth_user",
    ];
    for (const key of directKeys) {
      const val = localStorage.getItem(key)?.trim() || "";
      if (/^0x[a-fA-F0-9]{40}$/.test(val)) return val;
    }
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith("plane:metanode-wallet:")) {
        const addr = localStorage.getItem(key)?.trim() || "";
        if (/^0x[a-fA-F0-9]{40}$/.test(addr)) return addr;
      }
    }
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith("plane_dapp_db_0x")) {
        const addr = key.replace("plane_dapp_db_", "");
        if (/^0x[a-fA-F0-9]{40}$/.test(addr)) return addr;
      }
    }
  } catch {}
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
      reject(
        new Error(
          `Không thể kết nối với ví MetaNode (quá ${timeoutMs / 1000} giây). Lỗi mạng hoặc Bridge không phản hồi.`
        )
      );
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
let isDirtyState = (() => { try { return typeof localStorage !== "undefined" && localStorage.getItem("plane_dapp_dirty") === "true"; } catch { return false; } })();

// ── Auto commit CID on-chain ─────────────────────────────────────────────
// Việc ghi CID on-chain là *bản sao lưu con trỏ dữ liệu*, không phải dữ liệu
// nghiệp vụ. Trước đây nó bật mặc định và bắn một giao dịch cho mỗi lần lưu,
// nên một thao tác của người dùng sinh 2–3 giao dịch và nonce nhảy 2–3
// (lỗi CHAIN-09). Nay:
//   - Mặc định chỉ bật khi công việc KHÔNG được ghi on-chain (xem
//     `isAutoCommitOnChainEnabled`), nhờ vậy mỗi thao tác chỉ có 1 giao dịch.
//   - Thời gian gộp/thử lại đọc từ .env để vận hành chỉnh được mà không sửa mã.
function readPositiveIntEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = (getEnvVar(name) || "").trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.round(parsed), min), max);
}

const ONCHAIN_COMMIT_DEBOUNCE_MS = readPositiveIntEnv("VITE_ONCHAIN_COMMIT_DEBOUNCE_MS", 90_000, 5_000, 15 * 60_000);
const ONCHAIN_COMMIT_MIN_INTERVAL_MS = readPositiveIntEnv(
  "VITE_ONCHAIN_COMMIT_MIN_INTERVAL_MS",
  120_000,
  0,
  30 * 60_000
);
const ONCHAIN_COMMIT_RETRY_MS = readPositiveIntEnv("VITE_ONCHAIN_COMMIT_RETRY_MS", 30_000, 5_000, 10 * 60_000);
// Số lần tự thử lại khi ví/vault chưa sẵn sàng.
const ONCHAIN_COMMIT_MAX_ATTEMPTS = readPositiveIntEnv("VITE_ONCHAIN_COMMIT_MAX_ATTEMPTS", 5, 1, 20);
let pendingOnChainCommit: { slug: string; cid: string } | null = null;
let onChainCommitTimer: ReturnType<typeof setTimeout> | null = null;
let isOnChainCommitInFlight = false;
let onChainCommitAttempts = 0;
let lastOnChainCommitAt = 0;
let lastCommittedWorkspaceCid: { slug: string; cid: string } | null = null;

/**
 * Người dùng đã chủ động đóng hộp thoại mở khoá Crypto Vault (UNLOCK_CANCELLED).
 * Khi cờ này bật, auto-commit KHÔNG được tự bật lại hộp thoại mật khẩu (tránh spam modal sau
 * mỗi lần auto-save). Cờ được xoá khi: ký thành công, hoặc người dùng bấm "Sync to chain",
 * hoặc tải lại trang.
 */
let userDeclinedVaultUnlock = false;

const BRIDGE_STATUS_TIMEOUT_MS = 5000;
const BRIDGE_SIGN_TIMEOUT_MS = 120000;

/**
 * Bridge (fiaiSDK) có thể không bao giờ trả lời — ví dụ Crypto Vault đang khoá và người dùng
 * đóng hộp thoại mở khoá. Nếu `await bridge.request(...)` treo vĩnh viễn thì cờ
 * `isOnChainCommitInFlight` (và cả hàng đợi giao dịch ở phía web) cũng kẹt theo, khiến mọi lần
 * ghi on-chain về sau bị bỏ qua/luôn quay. Vì vậy mọi lời gọi bridge đều phải có timeout.
 */
function withBridgeTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(message));
    }, timeoutMs);
    promise.then(
      (value) => {
        if (settled) return undefined;
        settled = true;
        clearTimeout(timer);
        resolve(value);
        return undefined;
      },
      (error) => {
        if (settled) return undefined;
        settled = true;
        clearTimeout(timer);
        reject(error);
        return undefined;
      }
    );
  });
}

// ── Signing session & unlock orchestration ───────────────────────────────
// `blockchain-bridge` chỉ giữ private key trong RAM của chính nó (accountMap) sau lần ký ĐẦU TIÊN.
// Từ lần ký thứ 2 trở đi, bridge ký bằng key đã cache → KHÔNG cần Crypto Vault mở khoá nữa.
// Vì vậy trạng thái khoá của Vault chỉ được phép chặn giao dịch đầu tiên của phiên làm việc.
const signingReadyAddresses = new Set<string>();

const VAULT_UNLOCK_POLL_MS = 1500;
const VAULT_UNLOCK_WAIT_MS = 35_000;
const VAULT_UNLOCK_WATCH_MAX_MS = 30 * 60 * 1000;
const SIGN_RETRY_MAX_ATTEMPTS = 3;

/** Người dùng chủ động đóng hộp thoại mật khẩu → không được tự mở lại. */
const SIGN_CANCELLED_ERROR_RE = /UNLOCK_CANCELLED/i;
/**
 * Lỗi "hết giờ" là lỗi bình thường khi người dùng cần thời gian gõ mật khẩu:
 * `FrameClient.call` của SDK chỉ chờ crypto-vault 30s cho mỗi request `getPrivateKey`,
 * trong khi hộp thoại nhập mật khẩu vẫn đang mở. Ta chờ Vault mở khoá xong rồi ký lại.
 */
const SIGN_RETRYABLE_ERROR_RE =
  /timed out|timeout|không phản hồi|not responding|session key not established|no frame found/i;

let vaultUnlockWatcher: number | null = null;
let vaultUnlockWatchDeadline = 0;

function normalizeSigningAddress(address?: string | null): string {
  return (address || currentUserAddress || getStoredWalletAddress() || "").trim().toLowerCase();
}

/**
 * Đánh dấu "phiên ký đã thiết lập": bridge đã có private key trong RAM cho địa chỉ này.
 * Nhờ đó auto-commit on-chain không bị chặn bởi trạng thái khoá của Vault nữa.
 */
export function markSigningSessionReady(address?: string | null): void {
  const addr = normalizeSigningAddress(address);
  if (!addr) return;
  if (!signingReadyAddresses.has(addr)) {
    console.log(`[DApp Chain] Đã thiết lập phiên ký cho ví ${addr} (bridge cache private key trong RAM).`);
  }
  signingReadyAddresses.add(addr);
}

export function isSigningSessionReady(address?: string | null): boolean {
  const addr = normalizeSigningAddress(address);
  return Boolean(addr) && signingReadyAddresses.has(addr);
}

/**
 * Quên phiên ký đã cache.
 *
 * Phải gọi hàm này mỗi khi reset SDK / đổi ví: nếu không, lần ghi kế tiếp tưởng
 * ví đã mở khoá nên gửi giao dịch mà không kèm hộp thoại mật khẩu, dẫn tới lỗi
 * "không gửi được giao dịch" rất khó hiểu với người dùng.
 */
export function invalidateSigningSession(address?: string | null): void {
  if (address) {
    const addr = normalizeSigningAddress(address);
    if (addr) signingReadyAddresses.delete(addr);
  } else {
    signingReadyAddresses.clear();
  }
  userDeclinedVaultUnlock = false;
}

// Lớp web reset SDK ở module khác; đăng ký để cờ phiên ký luôn được xoá theo.
registerSigningSessionInvalidator(() => invalidateSigningSession());

const ACCOUNT_STATE_TIMEOUT_MS = 2500;

function normalizeRpcHash(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const raw = trimmed.startsWith("0x") || trimmed.startsWith("0X") ? trimmed.slice(2) : trimmed;
  if (!/^[a-fA-F0-9]{64}$/.test(raw) || /^0{64}$/.test(raw)) return null;
  return `0x${raw.toLowerCase()}`;
}

/**
 * Đọc hash giao dịch gần nhất của một tài khoản từ RPC (`mtn_getAccountState`).
 *
 * Dùng để trả lời câu hỏi "giao dịch vừa gửi đã lên chain chưa?" sau khi cầu nối
 * ví trả về timeout. Nếu đã lên chain thì KHÔNG được gửi lại — gửi lại chính là
 * nguyên nhân nonce nhảy 2–3 cho một hành động.
 */
async function readRpcAccountLastHash(address?: string | null): Promise<string | null> {
  const rpcUrl = getEnvVar("VITE_RPC_URL");
  if (!rpcUrl || !address || typeof fetch === "undefined") return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ACCOUNT_STATE_TIMEOUT_MS);
  try {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "mtn_getAccountState",
        params: [address, "latest"],
      }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const json = await response.json();
    return normalizeRpcHash(json?.result?.lastHash ?? json?.result?.last_hash);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Chờ Crypto Vault được mở khoá (người dùng nhập mật khẩu xong).
 * Trả về true ngay khi `getVaultStatus().isLocked === false`.
 */
export function waitForVaultUnlock(timeoutMs = VAULT_UNLOCK_WAIT_MS): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  const check = (): Promise<boolean> =>
    isVaultLocked().then((locked) => {
      if (!locked) return true;
      if (Date.now() >= deadline) return false;
      return new Promise<boolean>((resolve) => {
        setTimeout(resolve, VAULT_UNLOCK_POLL_MS);
      }).then(check);
    });
  return check();
}

/**
 * Gửi giao dịch ký qua bridge, tự xử lý trường hợp người dùng cần thời gian nhập mật khẩu.
 *
 * Vấn đề gốc: bridge gọi `getPrivateKey` sang crypto-vault với timeout cứng 30s (giới hạn của SDK).
 * Nếu người dùng gõ mật khẩu lâu hơn 30s, request đầu tiên timeout dù hộp thoại mật khẩu vẫn đang mở.
 * Trước đây lỗi này nổi lên UI và giao dịch bị bỏ → không có gì lên chain.
 * Nay ta chờ Vault mở khoá rồi ký lại (key đã nằm trong RAM của Vault nên lần sau tức thì).
 */
type SignAttemptOutcome =
  | { ok: true; value: unknown }
  | { ok: false; error: unknown; hashBefore: string | null; hashAfter: string | null };

export async function signTransactionWithUnlockRetry(
  bridge: { request: (action: string, params: unknown, options?: unknown) => Promise<unknown> },
  params: Record<string, unknown>,
  label: string,
  options?: { maxAttempts?: number }
): Promise<unknown> {
  const maxAttempts = Math.max(1, options?.maxAttempts ?? SIGN_RETRY_MAX_ATTEMPTS);
  const from = typeof params.from === "string" ? params.from : null;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    // Toàn bộ "đọc hash tài khoản → gửi → xác minh đã lên chain chưa" nằm trong
    // MỘT khoá của cổng giao dịch dùng chung. Nhờ vậy không giao dịch nào khác
    // chen vào giữa lúc ta đọc hash và lúc ta gửi, và không có hai lần ký chồng nhau.
    // oxlint-disable-next-line no-await-in-loop -- các lần thử phải tuần tự để chờ người dùng mở khoá ví.
    const outcome = await runExclusiveChainTx<SignAttemptOutcome>(`sign:${label}`, async () => {
      const hashBefore = await readRpcAccountLastHash(from);
      try {
        const value = await withBridgeTimeout<unknown>(
          bridge.request("sendTransaction", params),
          BRIDGE_SIGN_TIMEOUT_MS,
          "Ví điện tử chưa phản hồi khi xác nhận. Bạn hãy mở khoá ví rồi thực hiện lại."
        );
        const success: SignAttemptOutcome = { ok: true, value };
        return success;
      } catch (error) {
        const hashAfter = await readRpcAccountLastHash(from);
        const failure: SignAttemptOutcome = { ok: false, error, hashBefore, hashAfter };
        return failure;
      }
    });

    if (outcome.ok) {
      if (from) markSigningSessionReady(from);
      userDeclinedVaultUnlock = false;
      return outcome.value;
    }

    const { error, hashBefore, hashAfter } = outcome;

    // Giao dịch đã lên chain dù phản hồi của ví bị timeout ⇒ trả về hash thật và
    // TUYỆT ĐỐI không gửi lại (gửi lại làm nonce nhảy thêm và mất thêm phí).
    if (hashAfter && hashAfter !== hashBefore) {
      if (from) markSigningSessionReady(from);
      userDeclinedVaultUnlock = false;
      console.log(
        `[DApp Chain] ${label} đã lên chain (${hashAfter}) dù phản hồi ví bị timeout — không gửi lại.`
      );
      return { txHash: hashAfter, recoveredFromTimeout: true };
    }

    lastError = error;
    const message = error instanceof Error ? error.message : String(error);
    if (SIGN_CANCELLED_ERROR_RE.test(message)) {
      // Người dùng chủ động đóng cửa sổ mật khẩu → không tự mở lại (xem commitWorkspaceCID).
      userDeclinedVaultUnlock = true;
      throw new Error("Bạn đã đóng cửa sổ mở khoá ví nên thay đổi chưa được lưu lên hệ thống.", {
        cause: error,
      });
    }
    if (!SIGN_RETRYABLE_ERROR_RE.test(message) || attempt >= maxAttempts) throw error;
    console.warn(
      `[DApp Chain] Ký ${label} lần ${attempt} chưa xong (${message}). ` +
        "Đang chờ bạn nhập mật khẩu mở khoá ví rồi ký lại..."
    );
    // oxlint-disable-next-line no-await-in-loop -- phải chờ mở khoá xong mới ký lại được.
    const unlocked = await waitForVaultUnlock();
    if (!unlocked) break;
    console.log(`[DApp Chain] Ví đã mở khoá — ký lại ${label} (lần ${attempt + 1}).`);
  }

  throw lastError instanceof Error ? lastError : new Error("Không thể xác nhận giao dịch bằng ví của bạn.");
}

function stopVaultUnlockWatcher(): void {
  if (vaultUnlockWatcher !== null) {
    window.clearInterval(vaultUnlockWatcher);
    vaultUnlockWatcher = null;
  }
  vaultUnlockWatchDeadline = 0;
}

/**
 * Trong lúc CID còn tồn đọng và Vault đang khoá, theo dõi trạng thái Vault mỗi 1.5s.
 * Ngay khi người dùng mở khoá ví (ở bất kỳ luồng nào), CID tồn đọng được ghi lên chain luôn —
 * người dùng không phải sửa thêm dữ liệu hay bấm Sync lần nữa.
 */
function ensureVaultUnlockWatcher(): void {
  if (typeof window === "undefined") return;
  vaultUnlockWatchDeadline = Date.now() + VAULT_UNLOCK_WATCH_MAX_MS;
  if (vaultUnlockWatcher !== null) return;

  console.log("[DApp Chain] CID mới chưa lên chain vì Crypto Vault đang khoá — đang chờ ví được mở khoá...");
  vaultUnlockWatcher = window.setInterval(() => {
    void (async () => {
      if (Date.now() > vaultUnlockWatchDeadline || !readPendingOnChainCommit()) {
        stopVaultUnlockWatcher();
        return;
      }
      const locked = await isVaultLocked();
      if (locked) return;
      stopVaultUnlockWatcher();
      console.log("[DApp Chain] ✅ Crypto Vault đã mở khoá — ghi CID tồn đọng lên chain ngay.");
      onChainCommitAttempts = 0;
      void flushWorkspaceCIDCommit();
    })();
  }, VAULT_UNLOCK_POLL_MS);
}

export function isAutoCommitOnChainEnabled(): boolean {
  const raw = (getEnvVar("VITE_AUTO_COMMIT_ONCHAIN") || "").trim().toLowerCase();

  // Cấu hình tường minh trong .env luôn thắng.
  if (raw) return !["false", "0", "off", "no"].includes(raw);

  // Chưa cấu hình → chọn chế độ chỉ phát sinh MỘT giao dịch cho mỗi thao tác:
  // - Công việc đã được ghi on-chain ⇒ mỗi thao tác đã có giao dịch riêng, nên
  //   không ghi thêm CID (nếu không nonce sẽ nhảy 2–3 — lỗi CHAIN-09).
  // - Công việc KHÔNG ghi on-chain ⇒ CID là đường duy nhất đưa dữ liệu lên
  //   chain, buộc phải bật.
  return !isOnChainTaskSyncEnabled();
}

/** Đọc cờ ghi công việc on-chain (dùng cho quyết định auto-commit ở trên). */
function isOnChainTaskSyncEnabled(): boolean {
  const raw = (getEnvVar("VITE_ONCHAIN_TASKS_ENABLED") || "").trim().toLowerCase();
  return ["true", "1", "on", "yes"].includes(raw);
}

function readCommittedWorkspaceCid(slug: string): string | null {
  if (lastCommittedWorkspaceCid?.slug === slug) return lastCommittedWorkspaceCid.cid;
  if (typeof localStorage === "undefined") return null;
  try {
    return localStorage.getItem(`plane_dapp_onchain_cid_${slug}`);
  } catch {
    return null;
  }
}

function storeCommittedWorkspaceCid(slug: string, cid: string): void {
  lastCommittedWorkspaceCid = { slug, cid };
  try {
    localStorage.setItem(`plane_dapp_onchain_cid_${slug}`, cid);
  } catch {
    // localStorage có thể bị chặn (private mode) — bỏ qua, vẫn còn cache trong memory.
  }
}

function readPendingOnChainCommit(): { slug: string; cid: string } | null {
  return pendingOnChainCommit;
}

/**
 * Hẹn giờ ghi CID mới nhất lên contract workspace registry.
 * - Bỏ qua CID giả lập (`bafkrei...`) sinh ra khi Pinata lỗi.
 * - Bỏ qua nếu CID này đã được ghi on-chain thành công trước đó.
 * - Gộp nhiều lần lưu liên tiếp vào 1 giao dịch và giữ khoảng cách tối thiểu giữa 2 giao dịch.
 */
export function scheduleWorkspaceCIDCommit(slug: string, cid: string, delayMs = ONCHAIN_COMMIT_DEBOUNCE_MS): void {
  if (!slug || !cid) return;
  if (cid.startsWith("bafkrei")) return;
  if (!getWorkspaceRegistryAddress()) return;
  if (readCommittedWorkspaceCid(slug) === cid) return;

  if (pendingOnChainCommit?.cid !== cid) onChainCommitAttempts = 0;
  pendingOnChainCommit = { slug, cid };
  if (onChainCommitTimer) clearTimeout(onChainCommitTimer);
  const elapsed = Date.now() - lastOnChainCommitAt;
  const wait = Math.max(delayMs, ONCHAIN_COMMIT_MIN_INTERVAL_MS - elapsed, 0);
  onChainCommitTimer = setTimeout(() => {
    onChainCommitTimer = null;
    void flushWorkspaceCIDCommit();
  }, wait);
}

async function flushWorkspaceCIDCommit(): Promise<void> {
  const job = pendingOnChainCommit;
  if (!job) return;

  if (isOnChainCommitInFlight) {
    if (!onChainCommitTimer) {
      onChainCommitTimer = setTimeout(() => {
        onChainCommitTimer = null;
        void flushWorkspaceCIDCommit();
      }, ONCHAIN_COMMIT_RETRY_MS);
    }
    return;
  }

  pendingOnChainCommit = null;
  isOnChainCommitInFlight = true;
  lastOnChainCommitAt = Date.now();
  let committed = false;
  try {
    committed = await commitWorkspaceCID(job.slug, job.cid);
    if (committed) {
      onChainCommitAttempts = 0;
      stopVaultUnlockWatcher();
      storeCommittedWorkspaceCid(job.slug, job.cid);
      console.log(`[DApp Chain] ✅ Đã ghi CID "${job.cid}" on-chain cho workspace "${job.slug}".`);
    } else {
      onChainCommitAttempts += 1;
      const willRetry = onChainCommitAttempts < ONCHAIN_COMMIT_MAX_ATTEMPTS;
      // Vault khoá là trạng thái thường gặp → chỉ log lần đầu, lần thứ 5, 10... để không spam.
      if (onChainCommitAttempts <= 2 || !willRetry || onChainCommitAttempts % 5 === 0) {
        console.warn(
          `[DApp Chain] Chưa ghi được CID "${job.cid}" on-chain ` +
            `(Crypto Vault chưa mở khoá hoặc cầu nối ví chưa sẵn sàng). ` +
            (willRetry
              ? `Sẽ tự thử lại sau ${Math.round(ONCHAIN_COMMIT_RETRY_MS / 1000)}s (lần ${onChainCommitAttempts}/${ONCHAIN_COMMIT_MAX_ATTEMPTS}).`
              : "Đã hết số lần thử tự động, sẽ thử lại ở lần lưu tiếp theo.")
        );
      }
    }
  } catch (err) {
    onChainCommitAttempts += 1;
    console.warn("[DApp Chain] Ghi CID on-chain thất bại:", err);
  } finally {
    isOnChainCommitInFlight = false;
  }

  // Có CID mới hơn trong lúc đang ghi → hẹn ghi tiếp bản mới nhất.
  // (đọc qua hàm để TypeScript không narrow biến module về null sau các `await`)
  const nextJob = readPendingOnChainCommit();
  if (nextJob) {
    scheduleWorkspaceCIDCommit(nextJob.slug, nextJob.cid);
  } else if (!committed && userDeclinedVaultUnlock) {
    // Người dùng đã đóng hộp thoại mật khẩu → KHÔNG tự bật lại modal, giữ CID ở local.
    stopVaultUnlockWatcher();
    console.warn(
      `[DApp Chain] Bạn đã huỷ mở khoá Crypto Vault nên CID "${job.cid}" vẫn chỉ nằm ở local. ` +
        `Bấm "Sync to chain" khi muốn ghi lại (hộp thoại mật khẩu sẽ hiện lại).`
    );
  } else if (!committed && onChainCommitAttempts < ONCHAIN_COMMIT_MAX_ATTEMPTS) {
    // Ghi thất bại (vault khoá / bridge không phản hồi) → giữ lại CID và tự thử lại.
    // Nhờ vậy khi người dùng mở khoá ví, dữ liệu vẫn lên chain mà không cần sửa thêm gì.
    pendingOnChainCommit = job;
    scheduleWorkspaceCIDCommit(job.slug, job.cid, ONCHAIN_COMMIT_RETRY_MS);
    // Vault đang khoá → theo dõi trạng thái Vault và ghi ngay khi người dùng mở khoá.
    ensureVaultUnlockWatcher();
  }
}

export function checkHasRealContent(): boolean {
  const hasRealWorkspaces = (localDB.workspaces || []).some(
    (w: any) => w && w.slug && (w.slug !== DEFAULT_WORKSPACE.slug || (localDB.projects && localDB.projects.length > 0))
  );
  const hasRealProjects = Array.isArray(localDB.projects) && localDB.projects.length > 0;
  const hasRealIssues = Array.isArray(localDB.issues) && localDB.issues.length > 0;
  const hasRealStates = Array.isArray(localDB.states) && localDB.states.length > 0;
  return hasRealProjects || hasRealIssues || (hasRealWorkspaces && (hasRealStates || hasRealProjects));
}

export function getIsDirtyState(): boolean {
  return isDirtyState;
}

export function setDirtyState(val: boolean): void {
  isDirtyState = val;
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem("plane_dapp_dirty", String(val));
  } catch {}
  if (typeof window !== "undefined") {
    (window as any).__isDAppDirty = val;
  }
}

export type DAppSyncStatusState = "synced" | "pending" | "unsynced" | "unknown";

export type DAppSyncStatus = {
  state: DAppSyncStatusState;
  /** Câu ngắn hiển thị cho người dùng cuối — không dùng thuật ngữ kỹ thuật. */
  label: string;
  /** Giải thích thêm cho tooltip (vẫn là ngôn ngữ người dùng). */
  description: string;
  /** CID đang có trên máy (bản dữ liệu mới nhất đã đóng gói). */
  localCid: string | null;
  /** CID đã được xác nhận ghi lên hệ thống lưu trữ. */
  committedCid: string | null;
  /** Còn một bản đang chờ ghi lên hệ thống lưu trữ. */
  hasPendingCommit: boolean;
  /** Trên máy đang có thay đổi chưa đóng gói. */
  hasUnsavedChanges: boolean;
};

/**
 * Trạng thái "dữ liệu của tôi đã được lưu lên hệ thống lưu trữ chưa?" — dùng cho badge ở góc
 * màn hình (lỗi CHAIN-08: trước đây người dùng không có cách nào biết, nên bấm "Đồng bộ dữ liệu"
 * nhiều lần và sinh thêm giao dịch).
 *
 * Chỉ đọc dữ liệu đã có trong máy (bộ nhớ + localStorage), KHÔNG gọi mạng, nên gọi lại vài giây
 * một lần cũng không ảnh hưởng hiệu năng.
 */
export function getDAppSyncStatus(slug?: string): DAppSyncStatus {
  const targetSlug = slug || getDefaultWorkspaceSlug();
  const localCid = getLastUploadedCID();
  const pendingJob = readPendingOnChainCommit();
  const committedCid = targetSlug ? readCommittedWorkspaceCid(targetSlug) : null;
  const hasUnsavedChanges = isDirtyState;
  // Sau khi tải lại trang, "đang chờ ghi" chỉ còn dấu vết trong localStorage (biến bộ nhớ đã mất).
  // Khoá này được xoá đúng lúc ghi thành công nên dùng được làm tín hiệu.
  let pendingCid: string | null = null;
  if (typeof localStorage !== "undefined") {
    try {
      const stored = localStorage.getItem("plane_dapp_pending_onchain_cid");
      pendingCid = stored && localCid && stored === localCid ? stored : null;
    } catch {
      pendingCid = null;
    }
  }
  const hasPendingCommit =
    Boolean(pendingJob) || Boolean(pendingCid) || Boolean(localCid && committedCid && localCid !== committedCid);

  const base = {
    localCid,
    committedCid,
    hasPendingCommit,
    hasUnsavedChanges,
  };

  if (hasUnsavedChanges) {
    return {
      ...base,
      state: "unsynced",
      label: "Có thay đổi chưa lưu",
      description: "Thay đổi mới nhất mới nằm trên máy này. Bấm “Đồng bộ dữ liệu” để lưu lại.",
    };
  }

  if (!localCid) {
    return {
      ...base,
      state: "unknown",
      label: "Chưa lưu lần nào",
      description: "Dữ liệu chưa được lưu lên hệ thống lưu trữ. Bấm “Đồng bộ dữ liệu” khi bạn sẵn sàng.",
    };
  }

  if (hasPendingCommit || (committedCid && committedCid !== localCid)) {
    return {
      ...base,
      state: "pending",
      label: "Đang chờ lưu",
      description: "Bản mới nhất đã được đóng gói và đang chờ xác nhận bằng ví.",
    };
  }

  if (committedCid === localCid) {
    return {
      ...base,
      state: "synced",
      label: "Đã lưu",
      description: "Dữ liệu trên máy và trên hệ thống lưu trữ đang khớp nhau.",
    };
  }

  // Chưa từng ghi mốc xác nhận cho không gian làm việc này (ví dụ chế độ chỉ ghi từng công việc).
  return {
    ...base,
    state: "unknown",
    label: "Chưa xác nhận",
    description: "Chưa có mốc xác nhận cho không gian làm việc này. Bấm “Đồng bộ dữ liệu” để chắc chắn.",
  };
}

function getDBStorageKey(): string {
  return currentUserAddress || "local";
}

// ── IPFS Upload & Fetch ──────────────────────────────────────────────────
let ipfsUploadTail: Promise<unknown> = Promise.resolve();
const ipfsUploadFlights = new Map<string, { promise: Promise<string | null>; requestManual: () => void }>();
let backgroundUploadCooldown: { context: string; until: number } | null = null;

function uploadContext(): string {
  let sessionWallet = "";
  let localWallet = "";
  let workspace = "";
  try {
    sessionWallet = sessionStorage.getItem("plane_active_wallet_address") || "";
    localWallet = localStorage.getItem("plane_active_wallet_address") || "";
    workspace = localStorage.getItem("last_workspace_slug") || "";
  } catch {
    /* The local checkpoint reports unavailable storage explicitly. */
  }
  return JSON.stringify([
    getLoggedInUserId(),
    sessionWallet.toLowerCase(),
    localWallet.toLowerCase(),
    currentUserAddress,
    getStoredWalletAddress(),
    getRegistryContractAddress(),
    getWorkspaceRegistryAddress(),
    getProxyUrl(),
    workspace,
  ]);
}

function queueIPFSUpload(force: boolean): Promise<string | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  const serialized = JSON.stringify(getDBSnapshot());
  const context = uploadContext();
  if (!force && backgroundUploadCooldown?.context === context && Date.now() < backgroundUploadCooldown.until)
    return Promise.resolve(null);
  const key = context + String(force && !checkHasRealContent()) + serialized;
  const existing = ipfsUploadFlights.get(key);
  if (existing) {
    if (force) existing.requestManual();
    return existing.promise;
  }
  let requestedForce = force;
  const run = ipfsUploadTail.catch(() => undefined).then(() => uploadSnapshotToIPFS(requestedForce, context));
  const tracked = run
    .catch((error: unknown) => {
      backgroundUploadCooldown = {
        context,
        until: Date.now() + readPositiveIntEnv("VITE_IPFS_BACKGROUND_RETRY_MS", 30_000, 1_000, 300_000),
      };
      throw error;
    })
    .finally(() => {
      ipfsUploadFlights.delete(key);
    });
  ipfsUploadFlights.set(key, { promise: tracked, requestManual: () => { requestedForce = true; } });
  ipfsUploadTail = tracked.catch(() => undefined);
  return tracked;
}

/** Compatibility for background callers: failures keep local data and return no CID. */
export function uploadToIPFS(force = false): Promise<string | null> {
  return queueIPFSUpload(force).catch((error: unknown) => {
    console.warn(
      "[DApp DB] Chưa công bố snapshot; giữ dữ liệu local.",
      error instanceof SnapshotUploadError ? error.code : "STORAGE_ERROR"
    );
    return null;
  });
}

async function uploadSnapshotToIPFS(force: boolean, context: string): Promise<string | null> {
  const serialized = JSON.stringify(getDBSnapshot());
  const dbToSave = JSON.parse(serialized);
  const isCurrent = () => context === uploadContext();
  if (!isCurrent()) throw new SnapshotUploadError("CONTEXT_CHANGED", "Phiên làm việc đã thay đổi. Hãy đồng bộ lại.");
  if (!force && backgroundUploadCooldown?.context === context && Date.now() < backgroundUploadCooldown.until) return null;
  const hasData = Object.values(dbToSave).some((value) =>
    Array.isArray(value)
      ? value.length > 0
      : value && typeof value === "object"
        ? Object.keys(value).length > 0
        : Boolean(value)
  );
  if (!hasData) return null;
  const existingCID = getLastUploadedCID();
  if (!force && !checkHasRealContent()) return existingCID;
  if (serialized === lastUploadedDataHash && isPublishedCID(lastUploadedCID)) {
    setDirtyState(false);
    notifySnapshotUploadReuse();
    return lastUploadedCID;
  }

  let localSaved = false;
  try {
    localStorage.setItem("plane_dapp_local_db", serialized);
    localSaved = true;
  } catch {}
  const idbWrite = saveSnapshotToIDB(dbToSave, existingCID || undefined);
  let idbSaved = false;
  if (!localSaved) {
    let checkpointTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      idbSaved = await Promise.race([
        idbWrite,
        new Promise<boolean>((resolve) => {
          checkpointTimer = setTimeout(() => resolve(false), 3000);
        }),
      ]);
    } finally {
      if (checkpointTimer) clearTimeout(checkpointTimer);
    }
  }
  if (!localSaved && !idbSaved)
    throw new SnapshotUploadError(
      "LOCAL_STORAGE",
      "Chưa lưu được bản sao trên thiết bị. Hãy kiểm tra dung lượng hoặc quyền lưu trữ của trình duyệt rồi thử lại."
    );
  try {
    isUploadingIPFS = true;
    const cid = await publishSnapshot(getProxyUrl(), serialized, snapshotUploadPolicy(getEnvVar), isCurrent);
    if (!isCurrent()) throw new SnapshotUploadError("CONTEXT_CHANGED", "Phiên làm việc đã thay đổi. Hãy đồng bộ lại.");
    backgroundUploadCooldown = null;
    const unchanged = serialized === JSON.stringify(getDBSnapshot());
    try {
      sessionStorage.setItem("ipfs_" + cid, serialized);
      localStorage.setItem("ipfs_" + cid, serialized);
    } catch {}
    lastUploadedCID = cid;
    lastUploadedDataHash = serialized;
    setDirtyState(!unchanged);
    try {
      localStorage.setItem("plane_dapp_ipfs_cid_" + getDBStorageKey(), cid);
      localStorage.setItem("plane_dapp_ipfs_cid_local", cid);
      localStorage.setItem("plane_dapp_ipfs_cid_last_valid", cid);
      localStorage.setItem("plane_dapp_pending_onchain_cid", cid);
    } catch {}
    syncWorkspacesToCookie(cid);
    void saveCidToIDB(cid);
    // Do not replace a newer local edit with the older snapshot that just finished uploading.
    void saveSnapshotToIDB(
      unchanged ? dbToSave : JSON.parse(JSON.stringify(getDBSnapshot())),
      unchanged ? cid : undefined
    );
    if (unchanged && isAutoCommitOnChainEnabled()) {
      const activeSlug =
        localStorage.getItem("last_workspace_slug") || localDB.workspaces?.[0]?.slug || getDefaultWorkspaceSlug();
      if (getWorkspaceRegistryAddress()) scheduleWorkspaceCIDCommit(activeSlug, cid);
    }
    return cid;
  } finally {
    isUploadingIPFS = false;
  }
}

export type VaultStatusInfo = {
  isLocked: boolean;
  isInitialized?: boolean;
  authMode?: string;
};

/**
 * Đọc trạng thái Crypto Vault (`getVaultStatus`).
 *
 * Lưu ý quan trọng: `isLocked` chỉ phản ánh việc Master Key có trong RAM của Vault hay không.
 * Nó KHÔNG có nghĩa là giao dịch sẽ thất bại — hộp thoại nhập mật khẩu chỉ xuất hiện khi
 * blockchain-bridge gửi yêu cầu `getPrivateKey` (tức là khi ta thực sự ký). Vì vậy trạng thái
 * này chỉ dùng để log/giải thích, không dùng để chặn việc ký.
 */
export async function readVaultStatus(): Promise<VaultStatusInfo | null> {
  const bridge = typeof window !== "undefined" ? (window as any).fiaiSDK : null;
  if (!bridge) return null;
  try {
    const status = await withBridgeTimeout<unknown>(
      bridge.request("getVaultStatus", {}),
      BRIDGE_STATUS_TIMEOUT_MS,
      "vault-status-timeout"
    );
    if (!status || typeof status !== "object") return null;
    const raw = status as Record<string, unknown>;
    return {
      isLocked: Boolean(raw.isLocked),
      isInitialized: typeof raw.isInitialized === "boolean" ? raw.isInitialized : undefined,
      authMode: typeof raw.authMode === "string" ? raw.authMode : undefined,
    };
  } catch {
    return null;
  }
}

export async function isVaultLocked(): Promise<boolean> {
  const bridge = typeof window !== "undefined" ? (window as any).fiaiSDK : null;
  if (!bridge) return true;
  const status = await readVaultStatus();
  // Không đọc được trạng thái (Vault chưa ready / không trả lời) → coi như không khoá để
  // không chặn oan; nếu thật sự khoá thì bước ký sẽ tự bật hộp thoại mật khẩu.
  return status ? status.isLocked : false;
}

// ── Ví thực sự có trong Crypto Vault ─────────────────────────────────────
// blockchain-bridge ký bằng cách gọi `getPrivateKey(address)` sang Crypto Vault, và Vault tra
// cứu IndexedDB bằng `db.wallets.get(address)` — tức là SO KHỚP CHÍNH XÁC địa chỉ
// (`utils.formatAddress` = lowercase + tiền tố 0x). Nếu Plane giữ một địa chỉ không còn trong
// Vault (ví đã bị xoá/đổi trong MetaNode Wallet, hoặc địa chỉ cũ đến từ snapshot IPFS), giao
// dịch sẽ lỗi `Wallet not found` mà KHÔNG hề hiện hộp thoại mật khẩu → dữ liệu không bao giờ
// lên chain. Vì vậy trước mỗi lần ký ta phải đối chiếu địa chỉ với danh sách ví thật trong Vault.
const VAULT_WALLETS_CACHE_TTL_MS = 10_000;
/**
 * `getAllWallets` phải đi qua bridge để lấy balance (RPC) nên chậm hơn các call metadata.
 * Cho hạn mức rộng hơn để không kết luận sai "Vault không phản hồi" chỉ vì RPC đang chậm.
 */
const VAULT_WALLETS_TIMEOUT_MS = 25_000;
const WALLET_NOT_IN_VAULT_RE = /wallet not found/i;
let vaultWalletsCache: { wallets: VaultWalletInfo[]; at: number } | null = null;

// ── Lỗi ví/Crypto Vault có MÃ LỖI rõ ràng ────────────────────────────────
// Trước đây mọi sự cố ví đều quy về `new Error("Wallet not found")` của bridge, nên UI không
// phân biệt được "Vault rỗng" / "Vault không phản hồi" / "ví Plane đang giữ không có trong Vault"
// → người dùng chỉ thấy một alert chung chung và bấm Sync lại vô ích. Có mã lỗi, UI sẽ mở đúng
// luồng khắc phục (Trung tâm ví: import / chọn ví) ngay tại chỗ.
export type VaultWalletInfo = { address: string; name: string };

export type VaultErrorCode = "VAULT_UNAVAILABLE" | "VAULT_EMPTY" | "WALLET_NOT_IN_VAULT";

export class VaultSigningError extends Error {
  readonly code: VaultErrorCode;
  readonly vaultAddresses: string[];

  constructor(code: VaultErrorCode, message: string, vaultAddresses: string[] = []) {
    super(message);
    this.name = "VaultSigningError";
    this.code = code;
    this.vaultAddresses = vaultAddresses;
  }
}

export function isVaultSigningError(error: unknown): error is VaultSigningError {
  if (error instanceof VaultSigningError) return true;
  return Boolean(error) && (error as Error).name === "VaultSigningError";
}

/** URL Crypto Vault mà Plane đang kết nối (dùng cho thông báo lỗi + chẩn đoán). */
export function getVaultFrameUrl(): string {
  return (getEnvVar("VITE_FIAI_CRYPTO_VAULT_URL") || "").trim().replace(/\/+$/, "");
}

/** Chuẩn hoá địa chỉ về đúng định dạng Vault dùng để tra cứu: lowercase + tiền tố 0x. */
function normalizeWalletAddress(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  const withPrefix = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
  return /^0x[a-f0-9]{40}$/.test(withPrefix) ? withPrefix : null;
}

/** Tìm địa chỉ ví trong 1 phần tử trả về từ Vault (string | { address } | { data: {...} }). */
function readWalletEntryAddress(entry: unknown, depth = 0): string | null {
  const direct = normalizeWalletAddress(entry);
  if (direct) return direct;
  if (!entry || typeof entry !== "object" || depth > 3) return null;
  const raw = entry as Record<string, unknown>;
  const named = normalizeWalletAddress(raw.address ?? raw.Address ?? raw.walletAddress);
  if (named) return named;
  for (const value of Object.values(raw)) {
    const nested = readWalletEntryAddress(value, depth + 1);
    if (nested) return nested;
  }
  return null;
}

function readWalletList(value: unknown, depth = 0): unknown[] {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object" || depth > 3) return [];
  for (const key of ["wallets", "data", "result", "returnValue"]) {
    const list = readWalletList((value as Record<string, unknown>)[key], depth + 1);
    if (list.length > 0) return list;
  }
  return [];
}

/** Danh sách ví (address + name) trả về từ Crypto Vault, đã chuẩn hoá & khử trùng lặp. */
function readWalletEntries(value: unknown): VaultWalletInfo[] {
  const wallets: VaultWalletInfo[] = [];
  for (const entry of readWalletList(value)) {
    const address = readWalletEntryAddress(entry);
    if (!address || wallets.some((wallet) => wallet.address === address)) continue;
    const rawName = entry && typeof entry === "object" ? (entry as Record<string, unknown>).name : undefined;
    wallets.push({ address, name: typeof rawName === "string" ? rawName : "" });
  }
  return wallets;
}

/**
 * Đọc danh sách ví thật trong Crypto Vault (`getAllWallets`), có cache ngắn 10s.
 * Trả về `null` khi KHÔNG đọc được (Vault chưa ready / không phản hồi) — phân biệt rõ với
 * mảng rỗng (`[]` = Vault trả lời và thật sự không có ví nào). Đây là điểm khác biệt quan trọng:
 * rỗng thì phải hướng người dùng nạp ví, còn không đọc được thì phải kiểm tra frame.
 */
async function loadVaultWallets(options?: { refresh?: boolean }): Promise<VaultWalletInfo[] | null> {
  const bridge = typeof window !== "undefined" ? (window as any).fiaiSDK : null;
  if (!bridge) return null;
  if (!options?.refresh && vaultWalletsCache && Date.now() - vaultWalletsCache.at < VAULT_WALLETS_CACHE_TTL_MS) {
    return vaultWalletsCache.wallets;
  }
  try {
    const raw = await withBridgeTimeout<unknown>(
      bridge.request("getAllWallets", {}),
      VAULT_WALLETS_TIMEOUT_MS,
      "vault-wallets-timeout"
    );
    const wallets = readWalletEntries(raw);
    vaultWalletsCache = { wallets, at: Date.now() };
    return wallets;
  } catch {
    // Không cache lỗi: lần đọc sau phải thử lại thật, tránh "dính" trạng thái rỗng giả.
    vaultWalletsCache = null;
    return null;
  }
}

/** Xoá cache danh sách ví (gọi sau khi import/chọn/xoá ví để UI thấy dữ liệu mới ngay). */
export function invalidateVaultWalletCache(): void {
  vaultWalletsCache = null;
}

/**
 * Danh sách địa chỉ ví đang có trong Crypto Vault (`getAllWallets`).
 * Trả về `null` khi KHÔNG đọc được (Vault chưa ready / không phản hồi) — khi đó ta không kết
 * luận gì và giữ nguyên địa chỉ hiện tại.
 */
export async function getVaultWalletAddresses(options?: { refresh?: boolean }): Promise<string[] | null> {
  const wallets = await loadVaultWallets(options);
  return wallets ? wallets.map((wallet) => wallet.address) : null;
}

/** Danh sách ví kèm tên ví — dùng cho Trung tâm ví và chẩn đoán. `null` = không đọc được. */
export async function getVaultWalletsDetailed(options?: { refresh?: boolean }): Promise<VaultWalletInfo[] | null> {
  return loadVaultWallets(options);
}

/**
 * Chọn địa chỉ ví dùng để ký, bảo đảm địa chỉ đó CÓ trong Crypto Vault.
 *
 * - Địa chỉ ưu tiên còn trong Vault → dùng luôn.
 * - Không còn → tự chuyển sang ví đang mở trong Vault (`getActiveWalletDapp` / `getActiveWallet`
 *   / địa chỉ đã lưu), hoặc ví duy nhất trong Vault; ghi lại địa chỉ mới và log rõ ràng.
 * - Không đọc được danh sách ví → giữ nguyên địa chỉ ưu tiên (bước ký sẽ báo lỗi cụ thể).
 */
export async function resolveVaultSigningAddress(preferred?: string | null): Promise<string | null> {
  const preferredAddr =
    normalizeWalletAddress(preferred) ??
    normalizeWalletAddress(currentUserAddress) ??
    normalizeWalletAddress(getStoredWalletAddress());

  const vaultAddresses = await getVaultWalletAddresses();
  if (!vaultAddresses || vaultAddresses.length === 0) return preferredAddr;
  if (preferredAddr && vaultAddresses.includes(preferredAddr)) return preferredAddr;

  const bridge = typeof window !== "undefined" ? (window as any).fiaiSDK : null;
  const candidates: (string | null)[] = [];

  if (bridge && typeof window !== "undefined") {
    const dappActive = await withBridgeTimeout<unknown>(
      bridge.request("getActiveWalletDapp", { domain: window.location.hostname }),
      BRIDGE_STATUS_TIMEOUT_MS,
      "dapp-wallet-timeout"
    ).catch(() => null);
    candidates.push(readWalletEntryAddress(dappActive));

    const globalActive = await withBridgeTimeout<unknown>(
      bridge.request("getActiveWallet", {}),
      BRIDGE_STATUS_TIMEOUT_MS,
      "active-wallet-timeout"
    ).catch(() => null);
    candidates.push(readWalletEntryAddress(globalActive));

    try {
      candidates.push(normalizeWalletAddress(window.sessionStorage.getItem("plane_active_wallet_address")));
      candidates.push(normalizeWalletAddress(window.localStorage.getItem("plane_active_wallet_address")));
    } catch {}
  }

  const inVault = (address: string | null): address is string =>
    Boolean(address) && vaultAddresses.includes(address as string);
  // Chỉ tự chuyển khi có đúng 1 ví trong Vault (không thể chọn nhầm); nhiều ví thì để người dùng chọn.
  const replacement = candidates.find(inVault) ?? (vaultAddresses.length === 1 ? vaultAddresses[0] : null);

  if (!replacement) {
    console.warn(
      `[DApp Chain] ⚠️ Ví ${preferredAddr ?? "(chưa xác định)"} không có trong Crypto Vault. ` +
        `Ví đang có trong Vault: ${vaultAddresses.join(", ")}. Có nhiều ví nên không tự chuyển — ` +
        "hãy chọn đúng ví trong MetaNode Wallet rồi thử lại."
    );
    return preferredAddr;
  }

  console.warn(
    `[DApp Chain] ⚠️ Ví ${preferredAddr ?? "(chưa xác định)"} không có trong Crypto Vault ` +
      `nhưng ví ${replacement} thì có. Tự động chuyển sang ví trong Vault để ký được giao dịch.`
  );
  currentUserAddress = replacement;
  if (typeof window !== "undefined") {
    try {
      window.sessionStorage.setItem("plane_active_wallet_address", replacement);
      window.localStorage.setItem("plane_active_wallet_address", replacement);
    } catch {}
  }
  return replacement;
}

export type VaultSnapshot = {
  reachable: boolean;
  isLocked: boolean;
  isInitialized: boolean;
  authMode: string;
  wallets: VaultWalletInfo[];
  dappActiveAddress: string | null;
  vaultUrl: string;
};

/** Ảnh chụp trạng thái Crypto Vault để hiển thị/chẩn đoán trong Trung tâm ví. */
export async function getVaultSnapshot(options?: { refresh?: boolean }): Promise<VaultSnapshot> {
  const vaultUrl = getVaultFrameUrl();
  const bridge = typeof window !== "undefined" ? (window as any).fiaiSDK : null;
  const wallets = await loadVaultWallets({ refresh: options?.refresh ?? true });
  const status = bridge ? await readVaultStatus() : null;

  let dappActiveAddress: string | null = null;
  if (bridge && typeof window !== "undefined") {
    const dappActive = await withBridgeTimeout<unknown>(
      bridge.request("getActiveWalletDapp", { domain: window.location.hostname }),
      BRIDGE_STATUS_TIMEOUT_MS,
      "dapp-wallet-timeout"
    ).catch(() => null);
    dappActiveAddress = readWalletEntryAddress(dappActive);
  }

  return {
    reachable: Boolean(bridge) && wallets !== null,
    isLocked: status ? status.isLocked : true,
    isInitialized: status?.isInitialized ?? false,
    authMode: status?.authMode ?? "unknown",
    wallets: wallets ?? [],
    dappActiveAddress,
    vaultUrl,
  };
}

/**
 * Chọn địa chỉ ví để ký và BẢO ĐẢM địa chỉ đó có thật trong Crypto Vault — nếu không thì ném
 * `VaultSigningError` có mã lỗi rõ ràng (không bao giờ để bridge ký bằng ví không tồn tại).
 *
 * Khác với `resolveVaultSigningAddress` (best-effort cho luồng auto-commit nền), hàm này là
 * preflight bắt buộc cho luồng người dùng chủ động: Sync to Chain, join workspace, ...
 */
export async function assertVaultSigningAddress(
  preferred?: string | null,
  options?: { refresh?: boolean }
): Promise<string> {
  const preferredAddr =
    normalizeWalletAddress(preferred) ??
    normalizeWalletAddress(currentUserAddress) ??
    normalizeWalletAddress(getStoredWalletAddress());

  const bridge = typeof window !== "undefined" ? (window as any).fiaiSDK : null;
  if (!bridge) {
    throw new VaultSigningError(
      "VAULT_UNAVAILABLE",
      "Chưa kết nối được ứng dụng ví. Hãy mở ứng dụng ví rồi tải lại trang."
    );
  }

  const wallets = await loadVaultWallets({ refresh: options?.refresh ?? true });
  if (!wallets) {
    throw new VaultSigningError(
      "VAULT_UNAVAILABLE",
      "Không đọc được danh sách ví. Hãy mở ứng dụng ví rồi tải lại trang.",
      []
    );
  }

  const addresses = wallets.map((wallet) => wallet.address);
  if (addresses.length === 0) {
    throw new VaultSigningError(
      "VAULT_EMPTY",
      `Ứng dụng ví chưa có ví nào nên chưa thể xác nhận thay đổi. Mở "Trung tâm ví" để thêm ví.`,
      addresses
    );
  }

  if (preferredAddr && addresses.includes(preferredAddr)) return preferredAddr;

  // Tự chữa lành: ưu tiên ví active của domain, ví active toàn cục, ví Plane đã lưu.
  const candidates: (string | null)[] = [];
  const dappActive = await withBridgeTimeout<unknown>(
    bridge.request("getActiveWalletDapp", { domain: window.location.hostname }),
    BRIDGE_STATUS_TIMEOUT_MS,
    "dapp-wallet-timeout"
  ).catch(() => null);
  candidates.push(readWalletEntryAddress(dappActive));

  const globalActive = await withBridgeTimeout<unknown>(
    bridge.request("getActiveWallet", {}),
    BRIDGE_STATUS_TIMEOUT_MS,
    "active-wallet-timeout"
  ).catch(() => null);
  candidates.push(readWalletEntryAddress(globalActive));

  if (typeof window !== "undefined") {
    try {
      candidates.push(normalizeWalletAddress(window.sessionStorage.getItem("plane_active_wallet_address")));
      candidates.push(normalizeWalletAddress(window.localStorage.getItem("plane_active_wallet_address")));
    } catch {
      // Storage có thể bị chặn (private mode) — bỏ qua.
    }
  }

  const inVault = (address: string | null): address is string =>
    Boolean(address) && addresses.includes(address as string);
  // Chỉ tự chuyển khi xác định được ví (active của domain/đã lưu) hoặc Vault chỉ có 1 ví.
  const replacement = candidates.find(inVault) ?? (addresses.length === 1 ? addresses[0] : null);

  if (!replacement) {
    throw new VaultSigningError(
      "WALLET_NOT_IN_VAULT",
      `Ví ${preferredAddr ?? "(chưa xác định)"} không có trong ứng dụng ví. ` +
        `Ví đang có: ${addresses.join(", ")}. Hãy chọn đúng ví trong "Trung tâm ví" rồi thử lại.`,
      addresses
    );
  }

  console.warn(
    `[DApp Chain] ⚠️ Ví ${preferredAddr ?? "(chưa xác định)"} không có trong Crypto Vault — ` +
      `tự chuyển sang ${replacement} để ký được giao dịch.`
  );
  currentUserAddress = replacement;
  if (typeof window !== "undefined") {
    try {
      window.sessionStorage.setItem("plane_active_wallet_address", replacement);
      window.localStorage.setItem("plane_active_wallet_address", replacement);
    } catch {
      // Bỏ qua khi storage bị chặn.
    }
  }
  return replacement;
}

let inFlightCommitKey = "";
let inFlightCommitPromise: Promise<boolean> | null = null;

/**
 * Ghi CID của workspace lên registry on-chain.
 *
 * Ba lớp bảo vệ chống "1 hành động ⇒ nhiều giao dịch":
 *  1. Dedupe theo CID đã ghi thành công (đọc từ localStorage + cache RAM).
 *  2. Single-flight theo cặp (slug, cid): mọi lời gọi trùng trong lúc đang gửi
 *     sẽ dùng chung một promise thay vì mở giao dịch thứ hai.
 *  3. Tuần tự hoá qua cổng giao dịch dùng chung (xem `signTransactionWithUnlockRetry`).
 */
export function commitWorkspaceCID(
  slug: string,
  newCid: string,
  options?: { force?: boolean }
): Promise<boolean> {
  const key = `${slug}::${newCid}`;
  if (inFlightCommitPromise && inFlightCommitKey === key) return inFlightCommitPromise;

  const run = commitWorkspaceCIDOnce(slug, newCid, options).catch((error) => {
    console.warn("[DApp Chain] Workspace publication was not confirmed:", error);
    return false;
  });
  inFlightCommitKey = key;
  inFlightCommitPromise = run;
  void run
    .finally(() => {
      if (inFlightCommitPromise === run) {
        inFlightCommitPromise = null;
        inFlightCommitKey = "";
      }
    })
    .catch(() => undefined);
  return run;
}

async function commitWorkspaceCIDOnce(
  slug: string,
  newCid: string,
  options?: { force?: boolean }
): Promise<boolean> {
  const wsRegistryAddr = getWorkspaceRegistryAddress();
  if (!wsRegistryAddr || !newCid) return false;

  // CID này đã nằm on-chain ⇒ không gửi lại. Đây là lớp chặn cuối cùng cho các
  // luồng gọi trực tiếp (ví dụ đoạn tự đồng bộ trong routes.ts).
  const current = decodeAbiWorkspace(await directRpcRead(wsRegistryAddr, abiEncodeGetWorkspace(slug), 5000));
  if (!current) return false;
  const expectedCid = readCommittedWorkspaceCid(slug);
  if (current.ipfsCID === newCid) {
    storeCommittedWorkspaceCid(slug, newCid);
    console.log(`[DApp Chain] Bỏ qua updateWorkspaceCID("${slug}") — CID "${newCid}" đã có trên chain.`);
    return true;
  }
  // A cached base different from the shared base means another device wrote.
  // Force opens signing again; it never authorises overwriting a conflict.
  if (expectedCid !== null && current.ipfsCID !== expectedCid) return false;

  const bridge = typeof window !== "undefined" ? (window as any).fiaiSDK : null;
  const preferredAddr = currentUserAddress || getStoredWalletAddress();

  if (!bridge || !preferredAddr) {
    console.log(
      `[DApp Chain] Chưa kết nối ví trên trình duyệt hoặc Bridge chưa sẵn sàng. Bỏ qua ghi on-chain trực tiếp.`
    );
    return false;
  }

  // Chỉ ví thật sự có trong Crypto Vault mới ký được. Nếu địa chỉ đang lưu không còn trong Vault
  // (ví bị xoá/đổi) thì tự chuyển sang ví có trong Vault, tránh lỗi "Wallet not found".
  const userAddr = await assertVaultSigningAddress(preferredAddr);
  if (userAddr.toLowerCase() !== preferredAddr.toLowerCase()) return false;

  const signingSessionReady = isSigningSessionReady(userAddr);
  if (options?.force) userDeclinedVaultUnlock = false;

  // Người dùng đã chủ động đóng hộp thoại mật khẩu trước đó → không tự bật lại (tránh spam modal
  // sau mỗi lần auto-save). Chỉ mở lại khi người dùng bấm "Sync to chain" (force = true).
  if (!signingSessionReady && userDeclinedVaultUnlock && !options?.force) {
    console.log(
      "[DApp Chain] Bạn đã đóng hộp thoại mở khoá Crypto Vault trước đó nên hệ thống không tự mở lại. " +
        `CID được giữ ở local, bấm "Sync to chain" khi muốn ghi updateWorkspaceCID("${slug}") lên chain.`
    );
    return false;
  }

  // QUAN TRỌNG: Crypto Vault CHỈ bật hộp thoại nhập mật khẩu khi nhận được yêu cầu ký
  // (blockchain-bridge gọi `getPrivateKey` sang Vault). Vì vậy tuyệt đối KHÔNG được bỏ qua
  // giao dịch chỉ vì `getVaultStatus().isLocked === true` — nếu bỏ qua thì hộp thoại mật khẩu
  // không bao giờ hiện và dữ liệu không bao giờ lên chain (ví ẩn còn ký được mà không cần mật khẩu).
  if (!signingSessionReady) {
    const vaultStatus = await readVaultStatus();
    console.log(
      `[DApp Chain] Chưa có phiên ký trong tab này — gửi yêu cầu ký updateWorkspaceCID("${slug}") ` +
        `để Crypto Vault xử lý (isLocked=${vaultStatus ? String(vaultStatus.isLocked) : "unknown"}, ` +
        `authMode=${vaultStatus?.authMode ?? "unknown"}). Nếu Vault đang khoá, hộp thoại nhập mật khẩu sẽ hiện.`
    );
  }

  try {
    console.log(
      `[DApp Chain] Đang gửi transaction updateWorkspaceCID("${slug}", "${newCid}") qua ví người dùng (${userAddr})...`
    );
    await signTransactionWithUnlockRetry(
      bridge,
      {
        from: userAddr,
        to: wsRegistryAddr,
        abiData: [UPDATE_WORKSPACE_CID_IF_MATCHES_ABI],
        functionName: "updateWorkspaceCIDIfMatches",
        feeType: "sc",
        amount: "0",
        value: "0",
        gas: getContractGas(),
        type: "transaction",
        inputArray: [
          { name: "slug", type: "string", value: slug },
          { name: "expectedOldCid", type: "string", value: current.ipfsCID },
          { name: "newCid", type: "string", value: newCid },
        ],
        isReadOnly: false,
        bundleId: "",
        ...(getBlsPrivateKey() ? { blsPrivateKey: getBlsPrivateKey() } : {}),
      },
      "updateWorkspaceCID",
      // Chưa có phiên ký → phải chờ người dùng nhập mật khẩu; SDK chỉ chờ Vault 30s/request nên
      // lần đầu thường timeout trong khi hộp thoại vẫn mở, ta chờ Vault mở khoá rồi ký lại.
      // Đã có phiên ký → bridge ký bằng private key đã cache trong RAM nên chỉ cần 1 lần.
      { maxAttempts: 1 }
    );
    const confirmed = decodeAbiWorkspace(await directRpcRead(wsRegistryAddr, abiEncodeGetWorkspace(slug), 5000));
    if (confirmed?.ipfsCID !== newCid) return false;
    console.log(`[DApp Chain] ✅ updateWorkspaceCID thành công qua ví người dùng!`);
    userDeclinedVaultUnlock = false;

    // CID này đã nằm on-chain → bỏ cờ "chỉ có ở local" và ghi nhớ để không gửi trùng.
    try {
      lastCommittedWorkspaceCid = { slug, cid: newCid };
      localStorage.setItem(`plane_dapp_onchain_cid_${slug}`, newCid);
      if (localStorage.getItem("plane_dapp_pending_onchain_cid") === newCid) {
        localStorage.removeItem("plane_dapp_pending_onchain_cid");
      }
    } catch {}

    // Đồng bộ dọn dẹp on-chain cho các thành viên trong removed_members nếu role on-chain vẫn > 0

    return true;
  } catch (bridgeErr) {
    const message = bridgeErr instanceof Error ? bridgeErr.message : String(bridgeErr);
    if (WALLET_NOT_IN_VAULT_RE.test(message)) {
      // Crypto Vault tra cứu ví theo địa chỉ chính xác trong IndexedDB → không có ví thì không
      // thể ký. Tự chuyển ví đã thử ở trên nhưng thất bại ⇒ cần người dùng chọn lại ví.
      const available = await getVaultWalletAddresses({ refresh: true });
      console.warn(
        `[DApp Chain] Crypto Vault không giữ ví ${userAddr} nên không thể ký ` +
          `updateWorkspaceCID("${slug}") cho CID ${newCid}. ` +
          `Ví đang có trong Vault: ${available?.join(", ") || "(không đọc được danh sách ví)"}. ` +
          "Hãy chọn/import đúng ví trong MetaNode Wallet rồi bấm Sync to Chain."
      );
      return false;
    }
    console.warn(`[DApp Chain] Giao dịch updateWorkspaceCID qua ví người dùng không thành công:`, bridgeErr);
    return false;
  }
}

/** Only a verified postcondition counts as a completed membership write. */
async function writeWorkspaceMembership(slug: string, member: string, desiredRole: number | null, signer?: string, selfLeave = false): Promise<boolean> {
  const registry = getWorkspaceRegistryAddress();
  const bridge = getFiaiSDK();
  if (!registry || !bridge || !slug || !/^0x[a-f0-9]{40}$/i.test(member)) return false;
  const from = await assertVaultSigningAddress(signer || member);
  if (signer && from.toLowerCase() !== signer.toLowerCase()) throw new Error("Signing wallet changed. Select the intended wallet again.");
  const before = await fetchMemberRoleOnChain(slug, member);
  if (before < 0) throw new Error("Unable to verify the current membership. Try again later.");
  const matches = (role: number) => desiredRole === null ? [1, 2, 3].includes(role) : role === desiredRole;
  if (matches(before)) return true;
  const fn = selfLeave ? "leaveWorkspace" : desiredRole === null ? "joinWorkspace" : desiredRole === 0 ? "removeMember" : "addMember";
  const abi = selfLeave ? LEAVE_WORKSPACE_ABI : desiredRole === null ? JOIN_WORKSPACE_ABI : desiredRole === 0 ? REMOVE_MEMBER_ABI : ADD_MEMBER_ABI;
  let sendError: unknown = null;
  try {
    await signTransactionWithUnlockRetry(bridge, {
      from, to: registry, abiData: [abi], functionName: fn, feeType: "sc", amount: "0", value: "0", gas: getContractGas(), type: "transaction",
      inputArray: [
        { name: "slug", type: "string", value: slug },
        ...(desiredRole === null || selfLeave ? [] : [{ name: "member", type: "address", value: member }]),
        ...(desiredRole !== null && desiredRole > 0 ? [{ name: "role", type: "uint8", value: String(desiredRole) }] : []),
      ], isReadOnly: false, bundleId: "", ...(getBlsPrivateKey() ? { blsPrivateKey: getBlsPrivateKey() } : {}),
    }, fn, { maxAttempts: 1 });
  } catch (error) { sendError = error; }
  // Account lastHash or an error containing "member" is not proof of success.
  const after = await fetchMemberRoleOnChain(slug, member);
  if (matches(after)) { invalidateWorkspaceMembersOnChainCache(slug); return true; }
  if (sendError) throw sendError;
  throw new Error("The requested membership change has not been confirmed. Check the wallet history before retrying.");
}

export async function canManageWorkspaceOnChain(slug: string, signer: string): Promise<boolean> {
  const role = await fetchMemberRoleOnChain(slug, signer);
  if (role < 0) throw new Error("Unable to verify workspace permissions.");
  if (role === 2 || role === 3) return true;
  const registry = getWorkspaceRegistryAddress();
  if (!registry) throw new Error("Workspace registry is not configured.");
  // Selector verified with ethers.id("operator()").slice(0, 10).
  const raw = await directRpcRead(registry, "0x570ca735", 4000);
  if (!/^0x[0-9a-f]{64}$/i.test(raw)) throw new Error("Invalid workspace operator response.");
  return ("0x" + raw.slice(-40)).toLowerCase() === signer.toLowerCase();
}

export async function joinWorkspaceOnChain(slug: string, memberWallet?: string): Promise<boolean> {
  const member = memberWallet || currentUserAddress || getStoredWalletAddress();
  if (!member) return false;
  return writeWorkspaceMembership(slug, member, null, member);
}

export async function removeWorkspaceMemberOnChain(slug: string, memberAddress: string, adminWallet?: string): Promise<boolean> {
  const admin = adminWallet || currentUserAddress || getStoredWalletAddress();
  if (!admin) return false;
  if (!await canManageWorkspaceOnChain(slug, admin)) throw new Error("Only a workspace administrator can remove a member.");
  return writeWorkspaceMembership(slug, memberAddress, 0, admin);
}

const selfLeaveOperations = new Map<string, Promise<boolean>>();
export function leaveWorkspaceOnChain(slug: string, memberWallet: string): Promise<boolean> {
  const key = `${getWorkspaceRegistryAddress().toLowerCase()}:${slug}:${memberWallet.toLowerCase()}`;
  const existing = selfLeaveOperations.get(key);
  if (existing) return existing;
  const operation = leaveWorkspaceOnChainOnce(slug, memberWallet);
  selfLeaveOperations.set(key, operation);
  void operation.finally(() => { if (selfLeaveOperations.get(key) === operation) selfLeaveOperations.delete(key); }).catch(() => undefined);
  return operation;
}

async function leaveWorkspaceOnChainOnce(slug: string, memberWallet: string): Promise<boolean> {
  if (!getFiaiSDK() || !getWorkspaceRegistryAddress() || !/^0x[a-f0-9]{40}$/i.test(memberWallet)) {
    throw new MembershipOperationError("WALLET_REQUIRED", "Hãy kết nối và chọn ví của bạn trước khi rời workspace.");
  }
  const signer = await assertVaultSigningAddress(memberWallet);
  if (signer.toLowerCase() !== memberWallet.toLowerCase()) {
    throw new MembershipOperationError("SIGNING_WALLET_CHANGED", "Ví ký đã thay đổi. Hãy chọn lại ví rồi thực hiện lại.");
  }
  const before = await fetchMemberRoleOnChain(slug, signer);
  if (before < 0) throw new MembershipOperationError("PERMISSION_UNAVAILABLE", "Chưa kiểm tra được quyền trên chain. Dữ liệu thành viên vẫn được giữ nguyên.");
  if (before === 3) throw new MembershipOperationError("OWNER_CANNOT_LEAVE", "Chủ workspace cần chuyển quyền sở hữu trước khi rời.");
  if (before === 0) return true;
  const rawVersion = await directRpcRead(getWorkspaceRegistryAddress(), "0x7a64d5e0", 5000);
  if (!/^0x[0-9a-f]{64}$/i.test(rawVersion || "") || BigInt(rawVersion!) < 3n) {
    throw new MembershipOperationError("CONTRACT_UPGRADE_REQUIRED", "Contract hiện tại chưa hỗ trợ thành viên tự rời workspace. Cần phát hành bản contract mới trước khi dùng thao tác này.");
  }
  return writeWorkspaceMembership(slug, signer, 0, signer, true);
}

export async function setWorkspaceMemberRoleOnChain(slug: string, memberAddress: string, planeRole: number, adminWallet: string): Promise<boolean> {
  if (![15, 20].includes(planeRole)) throw new Error("Only Admin and Member roles are supported by this contract.");
  if (!await canManageWorkspaceOnChain(slug, adminWallet)) throw new Error("Only a workspace administrator can change member roles.");
  return writeWorkspaceMembership(slug, memberAddress, mapPlaneRoleToContractRole(planeRole), adminWallet);
}

/** Direct provisioning: the admin sends the transaction, never the recipient.
 * Existing memberships retain their role; role changes use the separate action.
 */
export async function addWorkspaceWalletMemberOnChain(slug: string, wallet: string, planeRole: number, adminWallet: string, retryAfterReview = false): Promise<{ role: number; alreadyMember: boolean }> {
  const desired = mapPlaneRoleToContractRole(planeRole);
  if (!/^0x[a-f0-9]{40}$/i.test(wallet) || /^0x0{40}$/i.test(wallet)) throw new MembershipOperationError("INVALID_WALLET", "Địa chỉ ví thành viên không hợp lệ.");
  if (!getFiaiSDK() || !getWorkspaceRegistryAddress()) throw new MembershipOperationError("WALLET_REQUIRED", "Hãy kết nối ví quản trị trước khi thêm thành viên.");
  const signer = await assertVaultSigningAddress(adminWallet);
  if (signer.toLowerCase() !== adminWallet.toLowerCase()) throw new MembershipOperationError("SIGNING_WALLET_CHANGED", "Ví ký đã thay đổi. Hãy chọn lại ví quản trị.");
  if (!await canManageWorkspaceOnChain(slug, signer)) throw new MembershipOperationError("NOT_AUTHORIZED", "Chỉ quản trị viên mới được thêm thành viên.");
  const before = await fetchMemberRoleOnChain(slug, wallet);
  if (before < 0) throw new MembershipOperationError("PERMISSION_UNAVAILABLE", "Chưa đọc được quyền hiện tại của ví. Chưa gửi giao dịch.");
  const operationKey = `plane_wallet_member_pending:${getEnvVar("VITE_RPC_URL")}:${getWorkspaceRegistryAddress()}:${slug}:${wallet.toLowerCase()}`;
  if ([1, 2, 3].includes(before)) { clearWalletMemberOperationPending(operationKey); return { role: before, alreadyMember: true }; }
  if (walletMemberOperationPending(operationKey) && !retryAfterReview) throw new MembershipOperationError("MEMBERSHIP_PENDING", "Giao dịch trước chưa rõ kết quả. Hãy kiểm tra lại quyền hoặc lịch sử ví; chưa gửi thêm giao dịch.");
  setWalletMemberOperationPending(operationKey);
  let sendError: unknown;
  try {
    await signTransactionWithUnlockRetry(getFiaiSDK(), {
      from: signer, to: getWorkspaceRegistryAddress(), abiData: [ADD_MEMBER_ABI], functionName: "addMember", feeType: "sc", amount: "0", value: "0", gas: getContractGas(), type: "transaction",
      inputArray: [{ name: "slug", type: "string", value: slug }, { name: "member", type: "address", value: wallet }, { name: "role", type: "uint8", value: String(desired) }],
      isReadOnly: false, bundleId: "", ...(getBlsPrivateKey() ? { blsPrivateKey: getBlsPrivateKey() } : {}),
    }, "addMember", { maxAttempts: 1 });
  } catch (error) { sendError = error; }
  let after = await fetchMemberRoleOnChain(slug, wallet);
  const rejected = sendError instanceof Error && /reject|denied|cancel|đã đóng cửa sổ/i.test(sendError.message);
  if (after !== desired && !rejected) {
    for (const delay of [500, 1000]) {
      // oxlint-disable-next-line no-await-in-loop -- Poll the postcondition in order; never rebroadcast while waiting for confirmation.
      await new Promise<void>(resolve => { if (typeof window !== "undefined") window.setTimeout(resolve, delay); else setTimeout(resolve, delay); });
      // oxlint-disable-next-line no-await-in-loop -- Wait for each read before deciding whether another is needed.
      after = await fetchMemberRoleOnChain(slug, wallet);
      if (after === desired) break;
    }
  }
  if (after !== desired) {
    if (rejected) { clearWalletMemberOperationPending(operationKey); throw sendError; }
    throw new MembershipOperationError("MEMBERSHIP_PENDING", "Chưa xác nhận được quyền. Giao dịch có thể đang chờ; hãy kiểm tra lại trước khi gửi thêm.");
  }
  clearWalletMemberOperationPending(operationKey);
  invalidateWorkspaceMembersOnChainCache(slug);
  return { role: desired, alreadyMember: false };
}

export async function readWorkspaceWalletInvitation(slug: string, wallet: string): Promise<{ role: number; expiresAt: number }> {
  const calldata = "0xd1ab7cb1" + abiEncodeGetMemberRole(slug, wallet).slice(10);
  const raw = await directRpcRead(getWorkspaceRegistryAddress(), calldata, 5000);
  if (!/^0x[0-9a-f]{128}$/i.test(raw)) throw new Error("Chưa đọc được trạng thái lời mời của ví.");
  return { role: Number(BigInt("0x" + raw.slice(2, 66))), expiresAt: Number(BigInt("0x" + raw.slice(66, 130))) };
}

export async function writeWorkspaceWalletInvitation(slug: string, wallet: string, planeRole: number, expiresAt: number, adminWallet: string, revoke = false): Promise<boolean> {
  if (!/^0x[a-f0-9]{40}$/i.test(wallet) || /^0x0{40}$/i.test(wallet)) throw new Error("Ví người nhận không hợp lệ.");
  if (!revoke && (![15, 20].includes(planeRole) || !Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000))) throw new Error("Chỉ hỗ trợ quyền Admin/Member và lời mời chưa hết hạn.");
  const signer = await assertVaultSigningAddress(adminWallet);
  if (signer.toLowerCase() !== adminWallet.toLowerCase()) throw new Error("Ví ký đã thay đổi. Hãy chọn lại ví.");
  if (!await canManageWorkspaceOnChain(slug, signer)) throw new Error("Bạn chưa có quyền quản lý lời mời.");
  const version = await directRpcRead(getWorkspaceRegistryAddress(), "0x7a64d5e0", 5000).catch(() => null);
  if (!version || !/^0x[0-9a-f]{64}$/i.test(version) || BigInt(version) < 2n) throw new Error("Contract hiện tại chưa hỗ trợ lời mời ràng buộc ví. Cần triển khai bản contract đã kiểm thử trước khi cấp lời mời này.");
  const role = revoke ? 0 : mapPlaneRoleToContractRole(planeRole);
  const current = await readWorkspaceWalletInvitation(slug, wallet);
  if (revoke ? current.role === 0 : current.role === role && current.expiresAt === expiresAt) return true;
  const fn = revoke ? "revokeInvitation" : "inviteMember";
  const inputs = [
    { internalType: "string", name: "slug", type: "string" },
    { internalType: "address", name: "member", type: "address" },
    ...(!revoke ? [{ internalType: "uint8", name: "role", type: "uint8" }, { internalType: "uint256", name: "expiresAt", type: "uint256" }] : []),
  ];
  let sendError: unknown;
  try {
    await signTransactionWithUnlockRetry(getFiaiSDK(), {
      from: signer, to: getWorkspaceRegistryAddress(), abiData: [{ type: "function", name: fn, inputs, outputs: [], stateMutability: "nonpayable" }],
      functionName: fn, feeType: "sc", amount: "0", value: "0", gas: getContractGas(), type: "transaction",
      // oxlint-disable-next-line oxc/no-map-spread -- Copy-on-write response enrichment must not mutate shared persisted records.
      inputArray: inputs.map((input) => ({ ...input, value: ({ slug, member: wallet, role: String(role), expiresAt: String(expiresAt) } as Record<string, string>)[input.name] })),
      isReadOnly: false, bundleId: "", ...(getBlsPrivateKey() ? { blsPrivateKey: getBlsPrivateKey() } : {}),
    }, fn, { maxAttempts: 1 });
  } catch (error) { sendError = error; }
  const confirmed = await readWorkspaceWalletInvitation(slug, wallet);
  if (revoke ? confirmed.role === 0 : confirmed.role === role && confirmed.expiresAt === expiresAt) return true;
  if (sendError) throw sendError;
  throw new Error("Chưa xác nhận được thay đổi lời mời. Hãy kiểm tra lịch sử ví rồi thử lại.");
}

export function scheduleIPFSUpload(): void {
  if (ipfsDebounceTimer) clearTimeout(ipfsDebounceTimer);
  ipfsDebounceTimer = setTimeout(() => {
    void uploadToIPFS();
  }, 2000);
}

export function getLastUploadedCID(): string | null {
  if (lastUploadedCID) return lastUploadedCID;
  if (typeof window === "undefined") return null;
  return (
    localStorage.getItem(`plane_dapp_ipfs_cid_${getDBStorageKey()}`) ||
    localStorage.getItem("plane_dapp_ipfs_cid_local") ||
    localStorage.getItem("plane_dapp_ipfs_cid_last_valid") ||
    null
  );
}

export function isIPFSUploading(): boolean {
  return isUploadingIPFS;
}

export async function fetchFromIPFS(cid: string): Promise<Record<string, any> | null> {
  if (!cid || typeof cid !== "string" || cid.trim() === "") return null;
  const cleanCid = cid.trim();

  try {
    const cached =
      sessionStorage.getItem(`ipfs_${cleanCid}`) ||
      (typeof localStorage !== "undefined" ? localStorage.getItem(`ipfs_${cleanCid}`) : null);
    if (cached) {
      const json = JSON.parse(cached);
      if (json && typeof json === "object") return json;
    }
  } catch {}

  // "latest" in IndexedDB is a mutable offline checkpoint, not the immutable
  // contents of its last known CID. Registration/autosave can change that data
  // before publication. Only the per-CID caches above contain fetched/pinned data.

  const result = await readIPFSSnapshot(getConfiguredIpfsGateways(cleanCid));
  if (!result) return null;
  try {
    sessionStorage.setItem(`ipfs_${cleanCid}`, result.text);
    localStorage.setItem(`ipfs_${cleanCid}`, result.text);
  } catch {}
  return result.data;
}

export function applyOffchainDB(ipfsDB: Record<string, any>): void {
  ipfsDB = sanitizeSharedSnapshot(ipfsDB);

  const currentWorkspaces = [...(localDB.workspaces || [])];
  const currentUsers = [...(localDB.users || [])];
  const currentProjects = [...(localDB.projects || [])];
  const currentIssues = [...(localDB.issues || [])];
  const currentStates = [...(localDB.states || [])];
  const currentLabels = [...(localDB.labels || [])];
  const currentCycles = [...(localDB.cycles || [])];
  const currentModules = [...(localDB.modules || [])];
  const currentComments = [...(localDB.issue_comments || [])];
  const currentAttachments = [...(localDB.attachments || [])];
  const currentDeployBoards = [...(localDB["project-deploy-boards"] || [])];
  const currentMembers = [...(localDB.members || [])];
  const currentWorkspaceMembers = [...(localDB.workspace_members || [])];
  const currentProjectMembers = [...(localDB.project_members || [])];
  const currentInvitations = [...getStoredInvitations(), ...(localDB.invitations || [])];
  const currentNotifications = [...(localDB.notifications || [])];
  const currentIssueRelations = [...(localDB.issue_relations || [])];
  const currentIssueLinks = [...(localDB.issue_links || [])];
  const currentReactions = [...(localDB.issue_reactions || [])];
  const currentPages = [...(localDB.pages || [])];
  const currentViews = [...(localDB.views || [])];
  const currentInboxIssues = [...(localDB.inbox_issues || [])];
  const currentEstimates = [...(localDB.estimates || [])];
  const currentTransactions = [...(localDB["blockchain-transactions"] || [])];
  const mergedDeletedWorkspaces = new Set<string>([
    ...(localDB._deleted_workspace_ids || []),
    ...(ipfsDB._deleted_workspace_ids || []),
  ]);
  const mergedDeletedWorkspaceSlugs = new Set<string>([
    ...(localDB._deleted_workspace_slugs || []),
    ...(ipfsDB._deleted_workspace_slugs || []),
  ]);
  const mergedDeletedProjects = new Set<string>([
    ...(localDB._deleted_project_ids || []),
    ...(ipfsDB._deleted_project_ids || []),
  ]);
  const mergedDeletedIssues = new Set<string>([
    ...(localDB._deleted_issue_ids || []),
    ...(ipfsDB._deleted_issue_ids || []),
  ]);
  const mergedDeletedInvitations = new Set<string>([
    ...(localDB._deleted_invitation_ids || []),
    ...(ipfsDB._deleted_invitation_ids || []),
  ]);

  const mergedRemovedMembers: Record<string, string[]> = {};
  const allRemovedSources: any[] = [localDB.removed_members, ipfsDB.removed_members];
  if (typeof window !== "undefined") {
    try {
      const raw = localStorage.getItem("plane_dapp_removed_members");
      if (raw) allRemovedSources.push(JSON.parse(raw));
    } catch {}
  }
  for (const src of allRemovedSources) {
    if (src && typeof src === "object") {
      for (const [ws, list] of Object.entries(src)) {
        if (!mergedRemovedMembers[ws]) mergedRemovedMembers[ws] = [];
        if (Array.isArray(list)) {
          for (const item of list) {
            const clean = String(item).toLowerCase().trim();
            if (clean && !mergedRemovedMembers[ws].includes(clean)) {
              mergedRemovedMembers[ws].push(clean);
            }
          }
        }
      }
    }
  }

  // Cross-map workspace slug <-> id so removed_members works regardless of key used (slug vs UUID)
  const wsSlugToId: Record<string, string> = {};
  const wsIdToSlug: Record<string, string> = {};
  const allKnownWorkspaces = (currentWorkspaces || []).concat(ipfsDB.workspaces || []).concat(localDB.workspaces || []);
  for (const w of allKnownWorkspaces) {
    if (w?.id && w?.slug) {
      const s = String(w.slug).toLowerCase().trim();
      const id = String(w.id).toLowerCase().trim();
      // A seeded workspace-<slug> is not an alias of a real UUID workspace.
      // Propagating its historical removals bans newly invited recipients.
      const canonical = resolveInvitationWorkspace(ipfsDB.workspaces || allKnownWorkspaces, s);
      if (canonical && String(canonical.id).toLowerCase().trim() !== id) continue;
      wsSlugToId[s] = id;
      wsIdToSlug[id] = s;
    }
  }

  // Synchronize removed identifiers across all keys for the same workspace
  for (const [ws, list] of Object.entries({ ...mergedRemovedMembers })) {
    const wsLower = ws.toLowerCase().trim();
    const mapped = wsSlugToId[wsLower] || wsIdToSlug[wsLower];
    if (mapped) {
      if (!mergedRemovedMembers[mapped]) mergedRemovedMembers[mapped] = [];
      for (const item of list) {
        if (!mergedRemovedMembers[mapped].includes(item)) {
          mergedRemovedMembers[mapped].push(item);
        }
      }
    }
  }

  for (const key in localDB) delete localDB[key];
  Object.assign(localDB, ipfsDB);

  localDB._deleted_workspace_ids = Array.from(mergedDeletedWorkspaces);
  localDB._deleted_workspace_slugs = Array.from(mergedDeletedWorkspaceSlugs);
  localDB._deleted_project_ids = Array.from(mergedDeletedProjects);
  localDB._deleted_issue_ids = Array.from(mergedDeletedIssues);
  localDB._deleted_invitation_ids = Array.from(mergedDeletedInvitations);
  localDB.removed_members = mergedRemovedMembers;
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem("plane_dapp_removed_members", JSON.stringify(mergedRemovedMembers));
    } catch {}
  }

  if (!localDB.users) localDB.users = [];
  for (const u of currentUsers) {
    const existingIndex = localDB.users.findIndex(
      (existing: any) =>
        existing.id === u.id || (existing.email && existing.email.toLowerCase() === u.email?.toLowerCase())
    );
    if (existingIndex === -1) {
      localDB.users.push(u);
    } else {
      const existing = localDB.users[existingIndex];
      if (existing.id === u.id && String(existing.email || "").trim().toLowerCase() !== String(u.email || "").trim().toLowerCase()) {
        localDB.users[existingIndex] = u;
        continue;
      }
      preserveLocalUserAuth(u, existing);
      if (u.theme) {
        localDB.users[existingIndex].theme = {
          ...localDB.users[existingIndex].theme,
          ...u.theme,
        };
      }
      if (u.user_timezone) localDB.users[existingIndex].user_timezone = u.user_timezone;
      if (u.display_name) localDB.users[existingIndex].display_name = u.display_name;
      if (u.first_name) localDB.users[existingIndex].first_name = u.first_name;
      if (u.last_name) localDB.users[existingIndex].last_name = u.last_name;
    }
  }

  if (typeof window !== "undefined") {
    const localSavedTheme = localStorage.getItem("theme") || localStorage.getItem("plane_user_theme");
    if (localSavedTheme && localSavedTheme !== "system") {
      for (const u of localDB.users) {
        if (!u.theme) u.theme = {};
        u.theme.theme = localSavedTheme;
      }
    }
  }

  if (!localDB.workspaces) localDB.workspaces = [];
  localDB.workspaces = localDB.workspaces.filter(
    (w: any) => !mergedDeletedWorkspaces.has(w.id) && !mergedDeletedWorkspaceSlugs.has(w.slug)
  );
  for (const w of currentWorkspaces) {
    if (
      !mergedDeletedWorkspaces.has(w.id) &&
      !mergedDeletedWorkspaceSlugs.has(w.slug) &&
      !localDB.workspaces.some((existing: any) => existing.slug === w.slug || existing.id === w.id)
    ) {
      localDB.workspaces.push(w);
    }
  }
  if (localDB.workspaces.length === 0) {
    if (
      !mergedDeletedWorkspaceSlugs.has(DEFAULT_WORKSPACE.slug) &&
      !mergedDeletedWorkspaces.has(DEFAULT_WORKSPACE.id)
    ) {
      localDB.workspaces = [DEFAULT_WORKSPACE];
    }
  }

  if (!localDB.projects) localDB.projects = [];
  for (const p of currentProjects) {
    if (!mergedDeletedProjects.has(p.id) && !mergedDeletedProjects.has(p.identifier)) {
      const existingIdx = localDB.projects.findIndex(
        (existing: any) => existing.id === p.id || (p.identifier && existing.identifier === p.identifier)
      );
      if (existingIdx === -1) {
        localDB.projects.push(p);
      } else {
        const localUpdated = p.updated_at
          ? new Date(p.updated_at).getTime()
          : p.created_at
            ? new Date(p.created_at).getTime()
            : 0;
        const ipfsUpdated = localDB.projects[existingIdx].updated_at
          ? new Date(localDB.projects[existingIdx].updated_at).getTime()
          : localDB.projects[existingIdx].created_at
            ? new Date(localDB.projects[existingIdx].created_at).getTime()
            : 0;
        if (localUpdated >= ipfsUpdated) {
          localDB.projects[existingIdx] = { ...localDB.projects[existingIdx], ...p };
        }
      }
    }
  }
  localDB.projects = localDB.projects.filter(
    (p: any) => !mergedDeletedProjects.has(p.id) && !mergedDeletedProjects.has(p.identifier)
  );
  (localDB.projects || []).forEach((p: any) => {
    if (!p.logo_props) p.logo_props = { in_use: "icon", icon: { name: "folder", color: "#3f3f46" } };
  });

  if (!localDB.states) localDB.states = [];
  for (const s of currentStates) {
    if (!mergedDeletedProjects.has(s.project) && !mergedDeletedProjects.has(s.project_id)) {
      const existingIdx = localDB.states.findIndex((existing: any) => existing.id === s.id);
      if (existingIdx === -1) {
        localDB.states.push(s);
      } else {
        const localUpdated = s.updated_at
          ? new Date(s.updated_at).getTime()
          : s.created_at
            ? new Date(s.created_at).getTime()
            : 0;
        const ipfsUpdated = localDB.states[existingIdx].updated_at
          ? new Date(localDB.states[existingIdx].updated_at).getTime()
          : localDB.states[existingIdx].created_at
            ? new Date(localDB.states[existingIdx].created_at).getTime()
            : 0;
        if (localUpdated >= ipfsUpdated) {
          localDB.states[existingIdx] = { ...localDB.states[existingIdx], ...s };
        }
      }
    }
  }
  localDB.states = localDB.states.filter(
    (s: any) => !mergedDeletedProjects.has(s.project) && !mergedDeletedProjects.has(s.project_id)
  );

  if (!localDB.issues) localDB.issues = [];
  for (const issue of currentIssues) {
    if (
      !mergedDeletedProjects.has(issue.project) &&
      !mergedDeletedProjects.has(issue.project_id) &&
      !mergedDeletedIssues.has(issue.id)
    ) {
      const existingIdx = localDB.issues.findIndex((i: any) => i.id === issue.id);
      if (existingIdx === -1) {
        localDB.issues.push(issue);
      } else {
        const localUpdated = issue.updated_at
          ? new Date(issue.updated_at).getTime()
          : issue.created_at
            ? new Date(issue.created_at).getTime()
            : 0;
        const ipfsUpdated = localDB.issues[existingIdx].updated_at
          ? new Date(localDB.issues[existingIdx].updated_at).getTime()
          : localDB.issues[existingIdx].created_at
            ? new Date(localDB.issues[existingIdx].created_at).getTime()
            : 0;
        if (localUpdated >= ipfsUpdated) {
          localDB.issues[existingIdx] = { ...localDB.issues[existingIdx], ...issue };
        }
      }
    }
  }
  localDB.issues = localDB.issues.filter(
    (i: any) =>
      !mergedDeletedProjects.has(i.project) &&
      !mergedDeletedProjects.has(i.project_id) &&
      !mergedDeletedIssues.has(i.id)
  );

  if (localDB.issue_comments) {
    localDB.issue_comments = localDB.issue_comments.filter((c: any) => !mergedDeletedIssues.has(c.issue || c.issue_id));
  }

  if (!localDB.labels) localDB.labels = [];
  for (const l of currentLabels) {
    if (
      !mergedDeletedProjects.has(l.project) &&
      !mergedDeletedProjects.has(l.project_id) &&
      !localDB.labels.some((existing: any) => existing.id === l.id)
    ) {
      localDB.labels.push(l);
    }
  }
  localDB.labels = localDB.labels.filter(
    (l: any) => !mergedDeletedProjects.has(l.project) && !mergedDeletedProjects.has(l.project_id)
  );

  if (!localDB.cycles) localDB.cycles = [];
  for (const c of currentCycles) {
    if (
      !mergedDeletedProjects.has(c.project) &&
      !mergedDeletedProjects.has(c.project_id) &&
      !localDB.cycles.some((existing: any) => existing.id === c.id)
    ) {
      localDB.cycles.push(c);
    }
  }
  localDB.cycles = localDB.cycles.filter(
    (c: any) => !mergedDeletedProjects.has(c.project) && !mergedDeletedProjects.has(c.project_id)
  );

  if (!localDB.modules) localDB.modules = [];
  for (const m of currentModules) {
    if (
      !mergedDeletedProjects.has(m.project) &&
      !mergedDeletedProjects.has(m.project_id) &&
      !localDB.modules.some((existing: any) => existing.id === m.id)
    ) {
      localDB.modules.push(m);
    }
  }
  localDB.modules = localDB.modules.filter(
    (m: any) => !mergedDeletedProjects.has(m.project) && !mergedDeletedProjects.has(m.project_id)
  );

  if (!localDB.workspace_members) localDB.workspace_members = [];
  for (const wm of currentWorkspaceMembers) {
    const wsKey = String(wm.workspace || wm.workspace_id || "")
      .toLowerCase()
      .trim();
    const mapped1 = wsSlugToId[wsKey] || "";
    const mapped2 = wsIdToSlug[wsKey] || "";
    const rSet = new Set(
      [
        ...(mergedRemovedMembers[wsKey] || []),
        ...(mapped1 ? mergedRemovedMembers[mapped1] || [] : []),
        ...(mapped2 ? mergedRemovedMembers[mapped2] || [] : []),
      ].map((x: string) => String(x).toLowerCase().trim())
    );
    const wmMail = (wm.email || "").toLowerCase().trim();
    const wmMem = String(wm.member || "")
      .toLowerCase()
      .trim();
    const wmId = String(wm.id || "")
      .toLowerCase()
      .trim();
    const wmWall = (wm.wallet_address || "").toLowerCase().trim();
    if (rSet.has(wmMail) || rSet.has(wmMem) || rSet.has(wmId) || rSet.has(wmWall)) {
      continue; // NEVER resurrect a removed member!
    }
    const existingIdx = localDB.workspace_members.findIndex(
      (m: any) =>
        (m.workspace === wm.workspace || m.workspace_id === wm.workspace_id) &&
        (m.member === wm.member || (wm.email && m.email?.toLowerCase() === wm.email.toLowerCase()))
    );
    if (existingIdx === -1) {
      localDB.workspace_members.push(wm);
    } else {
      localDB.workspace_members[existingIdx] = { ...localDB.workspace_members[existingIdx], ...wm };
    }
  }

  // Enforce removal filter across all workspace_members
  localDB.workspace_members = (localDB.workspace_members || []).filter((m: any) => {
    const wsKey = String(m.workspace || m.workspace_id || "")
      .toLowerCase()
      .trim();
    const mapped1 = wsSlugToId[wsKey] || "";
    const mapped2 = wsIdToSlug[wsKey] || "";
    const rSet = new Set(
      [
        ...(mergedRemovedMembers[wsKey] || []),
        ...(mapped1 ? mergedRemovedMembers[mapped1] || [] : []),
        ...(mapped2 ? mergedRemovedMembers[mapped2] || [] : []),
      ].map((x: string) => String(x).toLowerCase().trim())
    );
    const mMail = (m.email || "").toLowerCase().trim();
    const mMem = String(m.member || "")
      .toLowerCase()
      .trim();
    const mId = String(m.id || "")
      .toLowerCase()
      .trim();
    const mWall = (m.wallet_address || "").toLowerCase().trim();
    return !rSet.has(mMail) && !rSet.has(mMem) && !rSet.has(mId) && !rSet.has(mWall);
  });

  if (!localDB.project_members) localDB.project_members = [];
  for (const pm of currentProjectMembers) {
    const existingIdx = localDB.project_members.findIndex(
      (m: any) =>
        (m.project === pm.project || m.project_id === pm.project_id) &&
        (m.member === pm.member || (pm.email && m.email?.toLowerCase() === pm.email.toLowerCase()))
    );
    if (existingIdx === -1) {
      localDB.project_members.push(pm);
    } else {
      localDB.project_members[existingIdx] = { ...localDB.project_members[existingIdx], ...pm };
    }
  }
  // Drop project memberships of people who were removed from the workspace.
  // project_members has no workspace column, so resolve it through the project.
  const projectWsById = new Map<string, string>();
  (localDB.projects || []).forEach((p: any) => {
    const wsKey = String(p.workspace || p.workspace_id || "").toLowerCase().trim();
    if (p?.id && wsKey) projectWsById.set(String(p.id), wsKey);
  });
  localDB.project_members = localDB.project_members.filter((pm: any) => {
    if (mergedDeletedProjects.has(pm.project) || mergedDeletedProjects.has(pm.project_id)) return false;
    const projectId = String(pm.project || pm.project_id || "");
    const wsKey = projectWsById.get(projectId) || "";
    const mapped1 = wsSlugToId[wsKey] || "";
    const mapped2 = wsIdToSlug[wsKey] || "";
    const rSet = new Set(
      [
        ...(mergedRemovedMembers[wsKey] || []),
        ...(mapped1 ? mergedRemovedMembers[mapped1] || [] : []),
        ...(mapped2 ? mergedRemovedMembers[mapped2] || [] : []),
      ].map((x: string) => String(x).toLowerCase().trim())
    );
    if (rSet.size === 0) return true;
    const pmMember = String(
      typeof pm.member === "object" && pm.member?.id ? pm.member.id : pm.member || pm.id || ""
    )
      .toLowerCase()
      .trim();
    const pmMail = (pm.email || pm.member_detail?.email || pm.member?.email || "").toLowerCase().trim();
    const pmEth = String(pm.wallet_address || "")
      .toLowerCase()
      .trim();
    return !rSet.has(pmMember) && !(pmMail && rSet.has(pmMail)) && !(pmEth && rSet.has(pmEth));
  });

  let deletedInvSet = new Set<string>(mergedDeletedInvitations);
  if (typeof window !== "undefined") {
    const deletedInvRaw = localStorage.getItem("plane_dapp_deleted_invitations");
    if (deletedInvRaw) {
      try {
        const parsed = JSON.parse(deletedInvRaw);
        if (Array.isArray(parsed)) parsed.forEach((d) => deletedInvSet.add(d));
      } catch {}
    }
  }

  if (!localDB.invitations) localDB.invitations = [];
  for (const inv of currentInvitations) {
    if (isInvitationDeleted(inv, deletedInvSet)) continue;
    const invWs = String(inv.workspace?.slug || inv.workspace_slug || inv.workspace?.id || inv.workspace || "")
      .toLowerCase()
      .trim();
    const mapped1 = wsSlugToId[invWs] || "";
    const mapped2 = wsIdToSlug[invWs] || "";
    const rSet = new Set(
      [
        ...(mergedRemovedMembers[invWs] || []),
        ...(mapped1 ? mergedRemovedMembers[mapped1] || [] : []),
        ...(mapped2 ? mergedRemovedMembers[mapped2] || [] : []),
      ].map((x: string) => String(x).toLowerCase().trim())
    );
    const invMail = (inv.email || "").toLowerCase().trim();
    const invWall = (inv.wallet_address || "").toLowerCase().trim();
    const invId = String(inv.id || "")
      .toLowerCase()
      .trim();
    if (rSet.has(invId) || (invMail && rSet.has(invMail)) || (invWall && rSet.has(invWall))) {
      continue;
    }
    const existingIdx = localDB.invitations.findIndex((i: any) => i.id === inv.id);
    if (existingIdx === -1) {
      localDB.invitations.push(inv);
    } else {
      if (inv.accepted) localDB.invitations[existingIdx].accepted = true;
    }
  }
  localDB.invitations = localDB.invitations.filter((i: any) => {
    if (isInvitationDeleted(i, deletedInvSet)) return false;
    const invWs = String(i.workspace?.slug || i.workspace_slug || i.workspace?.id || i.workspace || "")
      .toLowerCase()
      .trim();
    const mapped1 = wsSlugToId[invWs] || "";
    const mapped2 = wsIdToSlug[invWs] || "";
    const rSet = new Set(
      [
        ...(mergedRemovedMembers[invWs] || []),
        ...(mapped1 ? mergedRemovedMembers[mapped1] || [] : []),
        ...(mapped2 ? mergedRemovedMembers[mapped2] || [] : []),
      ].map((x: string) => String(x).toLowerCase().trim())
    );
    const invMail = (i.email || "").toLowerCase().trim();
    const invWall = (i.wallet_address || "").toLowerCase().trim();
    const invId = String(i.id || "")
      .toLowerCase()
      .trim();
    if (rSet.has(invId) || (invMail && rSet.has(invMail)) || (invWall && rSet.has(invWall))) return false;
    return true;
  });
  saveStoredInvitations(localDB.invitations);

  if (!localDB.notifications) localDB.notifications = [];
  for (const n of currentNotifications) {
    if (!localDB.notifications.some((existing: any) => existing.id === n.id)) {
      localDB.notifications.push(n);
    }
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
  if (!localDB["project-deploy-boards"]) localDB["project-deploy-boards"] = [];
  for (const b of currentDeployBoards) {
    if (
      !localDB["project-deploy-boards"].some((existing: any) => existing.id === b.id || existing.anchor === b.anchor)
    ) {
      localDB["project-deploy-boards"].push(b);
    }
  }
  if (!localDB.members) localDB.members = [];
  for (const m of currentMembers) {
    if (!localDB.members.some((existing: any) => existing.id === m.id)) {
      localDB.members.push(m);
    }
  }
  if (!localDB.issue_relations) localDB.issue_relations = [];
  for (const r of currentIssueRelations) {
    if (
      !localDB.issue_relations.some(
        (existing: any) =>
          existing.id === r.id ||
          (existing.issue_id === r.issue_id &&
            existing.related_issue_id === r.related_issue_id &&
            existing.relation_type === r.relation_type)
      )
    ) {
      localDB.issue_relations.push(r);
    }
  }

  if (!localDB.issue_links) localDB.issue_links = [];
  for (const l of currentIssueLinks) {
    if (!localDB.issue_links.some((existing: any) => existing.id === l.id)) {
      localDB.issue_links.push(l);
    }
  }

  if (!localDB.issue_reactions) localDB.issue_reactions = [];
  for (const r of currentReactions) {
    if (!localDB.issue_reactions.some((existing: any) => existing.id === r.id)) {
      localDB.issue_reactions.push(r);
    }
  }

  if (!localDB.pages) localDB.pages = [];
  for (const page of currentPages) {
    if (!mergedDeletedProjects.has(page.project) && !mergedDeletedProjects.has(page.project_id)) {
      const existingIdx = localDB.pages.findIndex((p: any) => p.id === page.id);
      if (existingIdx === -1) {
        localDB.pages.push(page);
      } else {
        const localUpdated = page.updated_at
          ? new Date(page.updated_at).getTime()
          : page.created_at
            ? new Date(page.created_at).getTime()
            : 0;
        const ipfsUpdated = localDB.pages[existingIdx].updated_at
          ? new Date(localDB.pages[existingIdx].updated_at).getTime()
          : localDB.pages[existingIdx].created_at
            ? new Date(localDB.pages[existingIdx].created_at).getTime()
            : 0;
        if (localUpdated >= ipfsUpdated) {
          localDB.pages[existingIdx] = { ...localDB.pages[existingIdx], ...page };
        }
      }
    }
  }
  localDB.pages = localDB.pages.filter(
    (p: any) => !mergedDeletedProjects.has(p.project) && !mergedDeletedProjects.has(p.project_id)
  );

  if (!localDB.views) localDB.views = [];
  for (const v of currentViews) {
    if (
      !mergedDeletedProjects.has(v.project) &&
      !mergedDeletedProjects.has(v.project_id) &&
      !localDB.views.some((existing: any) => existing.id === v.id)
    ) {
      localDB.views.push(v);
    }
  }
  localDB.views = localDB.views.filter(
    (v: any) => !mergedDeletedProjects.has(v.project) && !mergedDeletedProjects.has(v.project_id)
  );

  if (!localDB.inbox_issues) localDB.inbox_issues = [];
  for (const ib of currentInboxIssues) {
    if (
      !mergedDeletedProjects.has(ib.project) &&
      !mergedDeletedProjects.has(ib.project_id) &&
      !localDB.inbox_issues.some((existing: any) => existing.id === ib.id)
    ) {
      localDB.inbox_issues.push(ib);
    }
  }
  localDB.inbox_issues = localDB.inbox_issues.filter(
    (ib: any) => !mergedDeletedProjects.has(ib.project) && !mergedDeletedProjects.has(ib.project_id)
  );

  if (!localDB.estimates) localDB.estimates = [];
  for (const est of currentEstimates) {
    if (
      !mergedDeletedProjects.has(est.project) &&
      !mergedDeletedProjects.has(est.project_id) &&
      !localDB.estimates.some((existing: any) => existing.id === est.id)
    ) {
      localDB.estimates.push(est);
    }
  }

  if (!localDB["blockchain-transactions"]) localDB["blockchain-transactions"] = [];
  for (const tx of currentTransactions) {
    if (!localDB["blockchain-transactions"].some((existing: any) => existing.id === tx.id)) {
      localDB["blockchain-transactions"].push(tx);
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

  try {
    const snapshot = JSON.stringify(localDB);
    localStorage.setItem("plane_dapp_local_db", snapshot);
    sessionStorage.setItem("plane_dapp_latest_db", snapshot);
  } catch (err) {
    console.warn("[DApp DB] Không thể lưu cache local:", err);
  }
  try {
    void saveSnapshotToIDB(localDB, lastUploadedCID || undefined);
  } catch {}
  syncWorkspacesToCookie();
  if (typeof window !== "undefined") {
    const activeUid = (getLoggedInUserId?.() || localStorage.getItem("plane_dapp_auth_user") || "")
      .toLowerCase()
      .trim();
    const activeMail = (getLoggedInEmail?.() || localStorage.getItem("plane_dapp_auth_email") || "")
      .toLowerCase()
      .trim();
    const activeWallet = (getStoredWalletAddress() || "").toLowerCase().trim();

    if (localDB.removed_members && typeof localDB.removed_members === "object") {
      for (const [ws, rList] of Object.entries(localDB.removed_members)) {
        const ridSet = new Set((rList as string[]).map((x: string) => String(x).toLowerCase().trim()));
        const isRemoved =
          (activeUid && ridSet.has(activeUid)) ||
          (activeMail && ridSet.has(activeMail)) ||
          (activeWallet && ridSet.has(activeWallet));
        if (isRemoved) {
          console.warn(
            `[DApp DB] Current session (${activeMail || activeUid || activeWallet}) was removed from workspace "${ws}". Triggering real-time kick-out.`
          );
          window.dispatchEvent(
            new CustomEvent("plane_member_kicked_out", {
              detail: { workspaceSlug: ws, reason: "removed" },
            })
          );
        }
      }
    }

    window.dispatchEvent(new CustomEvent("plane_dapp_db_reloaded", { detail: { cid: lastUploadedCID } }));
  }
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
      void saveCidToIDB(cleanCid);
      window.dispatchEvent(new CustomEvent("plane_dapp_db_reloaded", { detail: { cid: cleanCid } }));
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
async function _initDAppDB(): Promise<{ status: string; cid?: string; ipfsDB?: any }> {
  if (typeof window === "undefined") return { status: "OK" };
  const activeWallet = await getWalletAddress().catch(() => null);
  const registryAddr = getRegistryContractAddress();
  const wsRegistryAddr = getWorkspaceRegistryAddress();
  const defaultSlug = getDefaultWorkspaceSlug();

  const urlParams = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const urlCid = urlParams?.get("cid");

  if (!activeWallet) {
    console.log(`[DApp DB] Khởi tạo DB (Ưu tiên cache cục bộ + Stale-While-Revalidate on-chain)...`);

    // 1. Instant Cache Hydration: If localStorage or sessionStorage has DB, load immediately (0ms)
    let hadCachedDB = false;
    try {
      const cached = localStorage.getItem("plane_dapp_local_db") || sessionStorage.getItem("plane_dapp_latest_db");
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && typeof parsed === "object" && (parsed.workspaces?.length > 0 || parsed.users?.length > 0)) {
          applyOffchainDB(parsed);
          hadCachedDB = true;
          console.log("[DApp DB] Nạp DB tức thì từ cache cục bộ thành công (0ms).");
        }
      }
    } catch {}

    if (!hadCachedDB) {
      try {
        const idbBackup = await loadSnapshotFromIDB();
        if (idbBackup?.data && (idbBackup.data.workspaces?.length > 0 || idbBackup.data.users?.length > 0)) {
          applyOffchainDB(idbBackup.data);
          hadCachedDB = true;
          if (idbBackup.cid) lastUploadedCID = idbBackup.cid;
          console.log("[DApp DB] Nạp DB tức thì từ IndexedDB thành công.");
        }
      } catch {}
    }

    // 2. Discover authoritative CID from query, local storage, cookie, or on-chain
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

    if (!candidateCid) {
      candidateCid = (await getCidFromIDB().catch(() => null)) || "";
    }

    if (!candidateCid && wsRegistryAddr) {
      try {
        const wsInfoCalldata = abiEncodeGetWorkspace(defaultSlug);
        const wsInfoRaw = await directRpcRead(wsRegistryAddr, wsInfoCalldata, 3000);
        const wsInfo = decodeAbiWorkspace(wsInfoRaw);
        if (wsInfo?.ipfsCID && wsInfo.ipfsCID.trim() !== "") {
          candidateCid = wsInfo.ipfsCID.trim();
          console.log(`[DApp DB] Tìm thấy CID workspace "${defaultSlug}" từ contract:`, candidateCid);
        }
      } catch {}
    }

    // 3. If candidateCid is found and we need to fetch or revalidate
    const curCid = localStorage.getItem("plane_dapp_ipfs_cid_local") || lastUploadedCID;
    const shouldFetch = candidateCid && (!hadCachedDB || candidateCid !== curCid);

    if (shouldFetch) {
      console.log(`[DApp DB] Đang tải cập nhật DB từ IPFS CID: ${candidateCid}...`);
      const ipfsDB = await fetchFromIPFS(candidateCid);
      if (ipfsDB) {
        applyOffchainDB(ipfsDB);
        lastUploadedCID = candidateCid;
        localStorage.setItem("plane_dapp_ipfs_cid_local", candidateCid);
        localStorage.setItem("plane_dapp_ipfs_cid_last_valid", candidateCid);
        void saveCidToIDB(candidateCid);
        void saveSnapshotToIDB(ipfsDB, candidateCid);
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("plane_dapp_db_reloaded", { detail: { cid: candidateCid } }));
        }
        return { status: "OK", cid: candidateCid };
      }
    }

    if (hadCachedDB) {
      return { status: "OK", cid: curCid || candidateCid || undefined };
    }

    return { status: "OK" };
  }

  if (currentUserAddress && activeWallet.toLowerCase() !== currentUserAddress.toLowerCase()) {
    const prevMatches = (localDB.users || []).some(
      (u: any) => u.id?.toLowerCase() === currentUserAddress?.toLowerCase()
    );
    if (prevMatches) {
      console.log(`[DApp DB] Phát hiện đổi tài khoản ví từ ${currentUserAddress} sang ${activeWallet}.`);
      const preservedInv = [...getStoredInvitations(), ...(localDB.invitations || [])];
      for (const key in localDB) delete localDB[key];
      Object.assign(localDB, JSON.parse(JSON.stringify(defaultDB)));
      localDB.invitations = preservedInv;
      saveStoredInvitations(preservedInv);
    }
  }
  currentUserAddress = activeWallet;
  if (typeof window !== "undefined") {
    try {
      sessionStorage.setItem("plane_active_wallet_address", activeWallet);
    } catch {}
    localStorage.setItem("plane_active_wallet_address", activeWallet);
  }

  try {
    const isMock = getEnvVar("VITE_MOCK_FIAI") === "true";
    if (isMock) {
      return { status: "OK" };
    }

    let onChainUserCid = "";
    if (registryAddr) {
      try {
        const calldata = abiEncodeGetCID(currentUserAddress as string, "plane_dapp_db");
        const rawResult = await directRpcRead(registryAddr, calldata, 8000);
        onChainUserCid = decodeAbiString(rawResult);
      } catch {}
    }

    let onChainWorkspaceCid = "";
    if (wsRegistryAddr) {
      try {
        const userWsCalldata = abiEncodeGetUserWorkspaces(currentUserAddress as string);
        const userWsRaw = await directRpcRead(wsRegistryAddr, userWsCalldata, 8000);
        const userWsSlugs = decodeAbiStringArray(userWsRaw);

        if (!localDB.workspaces) localDB.workspaces = [];
        const deletedWsSlugs = new Set(localDB._deleted_workspace_slugs || []);
        const deletedWsIds = new Set(localDB._deleted_workspace_ids || []);
        const urlSlug = urlParams?.get("slug") || "";
        const pathnameSlug =
          typeof window !== "undefined" ? window.location.pathname.split("/").find(Boolean) : "";
        const cleanPathSlug =
          pathnameSlug &&
          !["workspace-invitations", "profile", "create-workspace", "onboarding", "invitations"].includes(pathnameSlug)
            ? pathnameSlug
            : "";
        const savedLastSlug =
          (typeof localStorage !== "undefined" ? localStorage.getItem("last_workspace_slug") : "") || "";
        const slugsToCheck = Array.from(
          new Set([...userWsSlugs, defaultSlug, urlSlug, cleanPathSlug, savedLastSlug])
        ).filter((s) => Boolean(s) && !deletedWsSlugs.has(s) && !deletedWsIds.has(s));

        for (const slug of slugsToCheck) {
          try {
            const wsInfoCalldata = abiEncodeGetWorkspace(slug);
            // oxlint-disable-next-line no-await-in-loop -- Hydrate workspace records in order so each merge observes the preceding state.
            const wsInfoRaw = await directRpcRead(wsRegistryAddr, wsInfoCalldata, 5000);
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
          } catch {}
        }
      } catch {}
    }

    let cookieCid = "";
    if (typeof document !== "undefined") {
      const cookies = document.cookie ? document.cookie.split(";") : [];
      const cidCookie = cookies.find((row) => row.trim().startsWith("plane_dapp_sync_cid="));
      if (cidCookie) {
        const raw = cidCookie.trim().substring(cidCookie.trim().indexOf("=") + 1);
        cookieCid = decodeURIComponent(raw || "").trim();
      }
    }

    const onChainCid = onChainWorkspaceCid || onChainUserCid;
    baseCID = onChainUserCid || "";

    const idbCid = await getCidFromIDB().catch(() => null);

    const cachedIpfsCid =
      cookieCid ||
      localStorage.getItem("plane_dapp_ipfs_cid_local") ||
      localStorage.getItem("plane_dapp_ipfs_cid_last_valid") ||
      localStorage.getItem(`plane_dapp_ipfs_cid_${currentUserAddress}`) ||
      idbCid ||
      "";

    const isLocalDirty = typeof window !== "undefined" && Boolean((window as any).__isDAppDirty);

    // ON-CHAIN FIRST PRIORITY:
    // If local changes are not dirty and onChainCid exists, prioritize onChainCid!
    let targetCID = "";
    if (onChainCid && !onChainCid.startsWith("bafkrei") && !isLocalDirty) {
      targetCID = onChainCid;
    } else if (cachedIpfsCid) {
      targetCID = cachedIpfsCid;
    } else {
      targetCID = onChainCid || "";
    }

    let loadedDB: any = null;
    let loadedCID: string = "";

    if (targetCID && targetCID !== "") {
      const ipfsDB = await fetchFromIPFS(targetCID);
      if (ipfsDB) {
        loadedDB = ipfsDB;
        loadedCID = targetCID;
      }
    }

    // Fallback: If primary targetCID failed, try alternate candidate
    if (!loadedDB) {
      const fallbackCID = targetCID === onChainCid ? cachedIpfsCid : onChainCid;
      if (fallbackCID && fallbackCID !== targetCID) {
        console.log(`[DApp DB] Thử tải dữ liệu từ fallback CID: ${fallbackCID}`);
        const fallbackDB = await fetchFromIPFS(fallbackCID);
        if (fallbackDB) {
          loadedDB = fallbackDB;
          loadedCID = fallbackCID;
        }
      }
    }

    // Fallback: If network / IPFS unavailable, check IndexedDB if localDB is empty
    if (!loadedDB && !checkHasRealContent()) {
      try {
        const idbBackup = await loadSnapshotFromIDB();
        if (idbBackup?.data) {
          console.log("[DApp DB] Phục hồi cơ sở dữ liệu từ IndexedDB do IPFS/local rỗng.");
          loadedDB = idbBackup.data;
          loadedCID = idbBackup.cid || targetCID || "";
        }
      } catch {}
    }

    if (loadedDB) {
      applyOffchainDB(loadedDB);
      if (loadedCID) {
        lastUploadedCID = loadedCID;
        if (typeof window !== "undefined") {
          localStorage.setItem("plane_dapp_ipfs_cid_local", loadedCID);
          localStorage.setItem("plane_dapp_ipfs_cid_last_valid", loadedCID);
          localStorage.setItem(`plane_dapp_ipfs_cid_${currentUserAddress}`, loadedCID);
        }
        syncWorkspacesToCookie(loadedCID);
        void saveCidToIDB(loadedCID);
        void saveSnapshotToIDB(loadedDB, loadedCID);
      }
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("plane_dapp_db_reloaded", { detail: { cid: loadedCID } }));
      }
      return { status: "OK", cid: loadedCID };
    }

    return { status: "OK" };
  } catch (err) {
    console.error("Failed to load DApp DB from chain / IPFS:", err);
    return { status: "OK" };
  }
}

export async function initDAppDB(): Promise<{ status: string; cid?: string; ipfsDB?: any }> {
  const timeoutMs = 30000;
  const timeoutTask = new Promise<{ status: string; cid?: string; ipfsDB?: any }>((resolve, reject) => {
    setTimeout(() => {
      if (checkHasRealContent()) {
        console.warn(
          `[DApp DB] Quá thời gian kết nối (${timeoutMs / 1000}s) khi đồng bộ online, tự động dùng dữ liệu offline cục bộ.`
        );
        resolve({ status: "OK" });
      } else {
        reject(
          new Error(`Quá thời gian kết nối (${timeoutMs / 1000} giây). Lỗi mạng, SSL, hoặc Bridge không phản hồi.`)
        );
      }
    }, timeoutMs);
  });

  return Promise.race([_initDAppDB(), timeoutTask]);
}

export type DAppSyncWarningCode =
  | "WORKSPACE_REGISTRY"
  | "WORKSPACE_NOT_MEMBER"
  | "WORKSPACE_NOT_OWNER"
  | "LOCAL_CHANGES_PENDING";

export type DAppSyncWarning = {
  code: DAppSyncWarningCode;
  /** Câu giải thích cho người dùng cuối, không dùng thuật ngữ kỹ thuật. */
  message: string;
};

export type DAppSyncResult = {
  /** `true` chỉ khi MỌI bước ghi dữ liệu đều thành công. */
  ok: boolean;
  cid: string;
  wallet: string;
  /** Slug workspace đã được cập nhật trên chain (rỗng nếu chỉ ghi con trỏ dữ liệu). */
  workspaceSlug: string;
  /** Các bước chưa hoàn tất — UI phải hiển thị cảnh báo, không được báo "thành công". */
  warnings: DAppSyncWarning[];
};

let manualSyncFlight: { context: string; promise: Promise<DAppSyncResult> } | null = null;

export function syncDAppDBToChain(forcedWallet?: string): Promise<DAppSyncResult> {
  const context = uploadContext() + String(forcedWallet || "").toLowerCase();
  if (manualSyncFlight) {
    if (manualSyncFlight.context === context) return manualSyncFlight.promise;
    return Promise.reject(
      new SnapshotUploadError("CONTEXT_CHANGED", "Một lượt đồng bộ khác đang xử lý. Hãy chờ hoàn tất rồi thử lại.")
    );
  }
  const promise = runManualDAppSync(forcedWallet).finally(() => {
    if (manualSyncFlight?.promise === promise) manualSyncFlight = null;
  });
  manualSyncFlight = { context, promise };
  return promise;
}

async function runManualDAppSync(forcedWallet?: string): Promise<DAppSyncResult> {
  const requestedWallet = forcedWallet || getStoredWalletAddress();
  if (!requestedWallet) throw new Error("Chưa có ví. Hãy mở “Trung tâm ví” để thêm ví rồi thử lại.");
  // PREFLIGHT BẮT BUỘC: chỉ ký bằng ví thật sự có trong Crypto Vault. Nếu Vault rỗng / không đọc
  // được / ví Plane đang giữ không còn trong Vault thì dừng ngay với `VaultSigningError` có mã lỗi
  // để UI mở "Trung tâm ví" — thay vì gửi giao dịch rồi nhận `Wallet not found` từ bridge.
  const activeWallet = await assertVaultSigningAddress(requestedWallet);
  currentUserAddress = activeWallet;
  // Người dùng chủ động bấm "Sync to chain" → cho phép bật lại hộp thoại mật khẩu Crypto Vault
  // (kể cả khi trước đó họ đã đóng hộp thoại của auto-commit).
  userDeclinedVaultUnlock = false;

  const hasRealContent = checkHasRealContent();
  if (!hasRealContent) {
    console.warn("[DApp Sync] Chặn đồng bộ on-chain: Cơ sở dữ liệu đang rỗng (chưa có dự án hoặc công việc).");
    throw new Error(
      "Chưa có dự án hoặc công việc nào để lưu. Hãy tạo dự án hoặc công việc trước."
    );
  }

  const registryAddr = getRegistryContractAddress();
  const wsRegistryAddr = getWorkspaceRegistryAddress();
  const contractGas = getContractGas();
  const blsPrivateKey = getBlsPrivateKey();
  const defaultSlug = getDefaultWorkspaceSlug();
  // Các bước chưa hoàn tất. UI dựa vào đây để KHÔNG báo "thành công" khi thực tế
  // còn phần dữ liệu chưa lên chain (lỗi CHAIN-02/CHAIN-03).
  const syncWarnings: DAppSyncWarning[] = [];

  if (ipfsDebounceTimer) { clearTimeout(ipfsDebounceTimer); ipfsDebounceTimer = null; }
  const syncContext = uploadContext();
  const cid = await queueIPFSUpload(true);
  if (!cid) throw new SnapshotUploadError("SERVICE", "Chưa lưu được dữ liệu. Hãy thử lại.");
  const syncedSnapshot = lastUploadedDataHash;
  if (syncContext !== uploadContext()) throw new SnapshotUploadError("CONTEXT_CHANGED", "Phiên làm việc đã thay đổi. Hãy đồng bộ lại.");

  // `uploadToIPFS` ở trên đã hẹn ghi ngầm CID này on-chain. Ta đang ghi trực tiếp ngay bây giờ
  // nên huỷ lịch hẹn để không gửi trùng 1 giao dịch (mỗi giao dịch là 1 lần xác nhận ký ví).
  // `pendingOnChainCommit` vẫn được giữ: nếu lần ghi tay này thất bại, cơ chế tự thử lại vẫn chạy.
  if (onChainCommitTimer) {
    clearTimeout(onChainCommitTimer);
    onChainCommitTimer = null;
  }

  const bridge = typeof window !== "undefined" ? (window as any).fiaiSDK : null;
  if (!bridge) throw new Error("Chưa kết nối được ứng dụng ví. Hãy mở ứng dụng ví rồi thử lại.");

  try {
    const sysCore = (await import("@metanodejs/system-core")) as any;
    // SDK export tên `getAllWallets` (KHÔNG có `getWallets`) — trước đây gọi sai tên nên cả block
    // này luôn throw và bị `catch {}` nuốt mất, ví dApp không bao giờ được set active.
    const { getAllWallets, setWalletActiveDApp } = sysCore;
    const wallets: any[] = typeof getAllWallets === "function" ? await getAllWallets().catch(() => []) : [];
    const walletObj = wallets.find((w: any) => {
      // Vault trả address KHÔNG có tiền tố 0x → phải chuẩn hoá trước khi so sánh.
      const addr = normalizeWalletAddress(w?.address ?? w?.Address);
      return Boolean(addr) && addr === normalizeWalletAddress(currentUserAddress);
    });
    if (walletObj) {
      if (typeof setWalletActiveDApp === "function") await setWalletActiveDApp(walletObj);
      await bridge.request("setActiveWalletDapp", { ...walletObj, domain: window.location.hostname }).catch(() => null);
    }
  } catch {}

  // 1. Send authoritative setCID transaction to OffchainDataRegistry
  // Using setCID directly avoids CID_CONFLICT reverts when baseCID came from a shared workspace CID,
  // and prevents poisoning blockchain-bridge's in-memory account nonce cache.
  if (registryAddr) {
    try {
      // Đọc con trỏ hiện tại trên chain trước khi ghi. Nếu đã đúng CID này thì bỏ
      // hẳn giao dịch — mỗi giao dịch là một lần người dùng phải xác nhận ví.
      const currentOnChainCid = await directRpcRead(
        registryAddr,
        abiEncodeGetCID(currentUserAddress as string, "plane_dapp_db"),
        5000
      )
        .then((raw) => decodeAbiString(raw))
        .catch(() => "");

      if (currentOnChainCid === cid) {
        console.log("[DApp Sync] Bỏ qua setCID: con trỏ dữ liệu trên chain đã đúng CID này.");
      } else {
        await signTransactionWithUnlockRetry(
          bridge,
          {
            from: currentUserAddress as string,
            to: registryAddr,
            abiData: [SET_CID_ABI],
            functionName: "setCID",
            feeType: "sc",
            amount: "0",
            value: "0",
            gas: contractGas,
            type: "transaction",
            inputArray: [
              { ...SET_CID_ABI.inputs[0], value: "plane_dapp_db" },
              { ...SET_CID_ABI.inputs[1], value: cid },
            ],
            isReadOnly: false,
            bundleId: "",
            ...(blsPrivateKey ? { blsPrivateKey } : {}),
          },
          "setCID"
        );
      }
    } catch (signError) {
      const message = signError instanceof Error ? signError.message : String(signError);
      if (WALLET_NOT_IN_VAULT_RE.test(message)) {
        // Vault đã đổi ví giữa lúc preflight và lúc ký (người dùng xoá/đổi ví) → báo lỗi có mã
        // kèm danh sách ví thật để UI mở lại Trung tâm ví thay vì hiện "Wallet not found".
        const available = (await getVaultWalletAddresses({ refresh: true })) ?? [];
        throw new VaultSigningError(
          "WALLET_NOT_IN_VAULT",
          `Crypto Vault không giữ ví ${currentUserAddress} nên không thể ký giao dịch. ` +
            `Ví đang có: ${available.join(", ") || "(không có ví nào)"}. ` +
            'Hãy chọn lại ví trong "Trung tâm ví" rồi đồng bộ lại.',
          available
        );
      }
      throw signError;
    }
  }

  // 2. Workspace Registry update (only if workspace doesn't exist yet or caller is Owner/Admin on-chain)
  // Slug thực sự đã ghi CID on-chain thành công — dùng để đánh dấu "đã đồng bộ" sau khi xong.
  let syncedWorkspaceSlug = "";
  if (wsRegistryAddr && bridge) {
    try {
      // Ví dùng để ký đã được đối chiếu với Crypto Vault, còn localDB có thể vẫn ghi ví cũ (ví đã
      // bị xoá/đổi trong MetaNode Wallet). Khi đối chiếu quyền Owner ở dữ liệu local, chấp nhận cả hai.
      const signingIdentities = [activeWallet, requestedWallet]
        .filter((value): value is string => Boolean(value))
        .map((value) => value.toLowerCase());
      const isSigningIdentity = (value?: string | null) =>
        Boolean(value) && signingIdentities.includes(String(value).toLowerCase());

      const activeUserId = getLoggedInUserId();
      const activeUser = (localDB.users || []).find((u: any) => u.id === activeUserId);

      let activeSlug = "";
      if (typeof window !== "undefined") {
        const rawSegments = window.location.pathname.split("/").filter(Boolean);
        const segments = rawSegments[0] === "plane" ? rawSegments.slice(1) : rawSegments;
        const reservedPaths = [
          "plane",
          "assets",
          "api",
          "create-workspace",
          "invitations",
          "settings",
          "profile",
          "installations",
          "onboarding",
          "god-mode",
          "workspace-member-invitations",
          "workspace",
          "preview",
        ];
        if (segments[0] && !reservedPaths.includes(segments[0])) {
          activeSlug = segments[0];
        }
        if (!activeSlug) {
          activeSlug = localStorage.getItem("last_workspace_slug") || "";
        }
      }
      if (!activeSlug) {
        activeSlug = activeUser?.last_workspace_slug || localDB.workspaces?.[0]?.slug || defaultSlug;
      }

      const targetWs = (localDB.workspaces || []).find((w: any) => w.slug === activeSlug) || localDB.workspaces?.[0];
      const targetSlug = targetWs?.slug || activeSlug || defaultSlug;
      const targetName = targetWs?.name || targetSlug.toUpperCase();

      let wsExistsOnChain = false;
      let canUpdateWorkspace = false;
      try {
        const wsInfoCalldata = abiEncodeGetWorkspace(targetSlug);
        const wsInfoRaw = await directRpcRead(wsRegistryAddr, wsInfoCalldata, 3000);
        const wsInfo = decodeAbiWorkspace(wsInfoRaw);
        const zeroAddr = "0x0000000000000000000000000000000000000000";
        if (wsInfo && wsInfo.owner && wsInfo.owner.toLowerCase() !== zeroAddr && wsInfo.name) {
          wsExistsOnChain = true;
          if (wsInfo.owner.toLowerCase() === (currentUserAddress as string).toLowerCase()) {
            canUpdateWorkspace = true;
          } else {
            const roleCalldata = abiEncodeGetMemberRole(targetSlug, currentUserAddress as string);
            const roleRaw = await directRpcRead(wsRegistryAddr, roleCalldata, 3000).catch(() => "0x");
            const memberRole = decodeAbiUint8(roleRaw);
            // Role.Member = 1, Role.Admin = 2, Role.Owner = 3 in PlaneWorkspaceRegistry.sol
            canUpdateWorkspace = memberRole >= 1;
          }
        }
      } catch {
        wsExistsOnChain = false;
      }

      if (wsExistsOnChain) {
        if (canUpdateWorkspace) {
          const committed = await commitWorkspaceCID(targetSlug, cid, { force: true });
          if (committed) syncedWorkspaceSlug = targetSlug;
          else syncWarnings.push({ code: "WORKSPACE_REGISTRY", message: "Workspace publication was not confirmed or conflicts with another device. Local data was retained." });

        } else {
          console.info(
            `[DApp Sync] Bỏ qua updateWorkspaceCID("${targetSlug}") vì ví ${currentUserAddress} không phải Member/Admin/Owner của workspace trên contract.`
          );
          syncWarnings.push({
            code: "WORKSPACE_NOT_MEMBER",
            message:
              "Bạn chưa được cấp quyền cập nhật thông tin chung của workspace này trên hệ thống, " +
              "nên lần này chỉ dữ liệu do bạn tạo được lưu lại.",
          });
        }
      } else {
        const isOwnerOfWs =
          targetWs &&
          (isSigningIdentity(targetWs.created_by) ||
            isSigningIdentity(targetWs.owner?.id) ||
            signingIdentities.some((identity) =>
              String(targetWs.owner?.email || "")
                .toLowerCase()
                .includes(identity)
            ));
        if (isOwnerOfWs) {
          await signTransactionWithUnlockRetry(
            bridge,
            {
              from: currentUserAddress as string,
              to: wsRegistryAddr,
              abiData: [CREATE_WORKSPACE_ABI],
              functionName: "createWorkspace",
              feeType: "sc",
              amount: "0",
              value: "0",
              gas: contractGas,
              type: "transaction",
              inputArray: [
                { name: "slug", type: "string", value: targetSlug },
                { name: "name", type: "string", value: targetName },
                { name: "initialCid", type: "string", value: cid },
              ],
              isReadOnly: false,
              bundleId: "",
              ...(blsPrivateKey ? { blsPrivateKey } : {}),
            },
            "createWorkspace"
          )
            .then(() => {
              syncedWorkspaceSlug = targetSlug;
              return targetSlug;
            })
            .catch((createErr: any) => {
              console.warn("[DApp Sync] createWorkspace failed:", createErr);
              syncWarnings.push({
                code: "WORKSPACE_REGISTRY",
                message:
                  "Chưa tạo được workspace trên hệ thống lưu trữ. " +
                  "Dữ liệu công việc vẫn an toàn trên máy bạn và sẽ được gửi lại ở lần đồng bộ sau.",
              });
            });
        } else {
          console.info(
            `[DApp Sync] Không tìm thấy workspace "${targetSlug}" on-chain và ví ${currentUserAddress} không phải Owner. Bỏ qua createWorkspace.`
          );
          syncWarnings.push({
            code: "WORKSPACE_NOT_OWNER",
            message:
              "Workspace này chưa có trên hệ thống lưu trữ và bạn không phải người tạo workspace, " +
              "nên chưa thể lưu thông tin chung. Hãy nhờ người tạo workspace đồng bộ trước.",
          });
        }
      }
    } catch (wsErr) {
      console.warn("[DApp Sync] Workspace registry error:", wsErr);
      syncWarnings.push({
        code: "WORKSPACE_REGISTRY",
        message:
          "Chưa kiểm tra được thông tin workspace trên hệ thống lưu trữ, nên phần thông tin chung chưa được cập nhật. " +
          "Dữ liệu công việc vẫn an toàn trên máy bạn.",
      });
    }
  }

  // Đánh dấu CID này đã nằm on-chain để:
  // 1. `routes.ts` không coi đây là "CID chỉ có ở local" nữa (nếu không sẽ chặn đồng bộ từ chain mãi mãi).
  // 2. Cơ chế ghi ngầm không gửi lại đúng CID này (tránh 1 giao dịch + 1 lần ký trùng).
  if (syncedWorkspaceSlug) {
    storeCommittedWorkspaceCid(syncedWorkspaceSlug, cid);
    try {
      if (localStorage.getItem("plane_dapp_pending_onchain_cid") === cid) {
        localStorage.removeItem("plane_dapp_pending_onchain_cid");
      }
    } catch {
      // localStorage có thể bị chặn (private mode) — bỏ qua.
    }
    if (pendingOnChainCommit?.cid === cid) {
      pendingOnChainCommit = null;
      if (onChainCommitTimer) {
        clearTimeout(onChainCommitTimer);
        onChainCommitTimer = null;
      }
    }
    stopVaultUnlockWatcher();
    console.log(
      `[DApp Sync] ✅ Đã ghi CID "${cid}" on-chain cho workspace "${syncedWorkspaceSlug}" (đánh dấu đã đồng bộ).`
    );
  }

  baseCID = cid;
  const hasNewEdits = syncedSnapshot !== JSON.stringify(getDBSnapshot());
  setDirtyState(hasNewEdits);
  if (hasNewEdits) syncWarnings.push({ code: "LOCAL_CHANGES_PENDING", message: "Bản đã xác nhận đã được lưu. Có thay đổi mới trên máy đang chờ đồng bộ tiếp." });

  return {
    ok: syncWarnings.length === 0,
    cid,
    wallet: currentUserAddress as string,
    workspaceSlug: syncedWorkspaceSlug,
    warnings: syncWarnings,
  };
}

// ── Connect Hooks ────────────────────────────────────────────────────────
registerSaveHook(() => {
  setDirtyState(true);
  scheduleIPFSUpload();
});

syncCrossPortWorkspaces(async (newCid) => {
  try {
    if (isDirtyState) {
      console.log("[DApp DB] Bỏ qua sync cross-port vì đang có dữ liệu chưa lưu tại local.");
      return;
    }
    const ipfsDB = await fetchFromIPFS(newCid);
    if (ipfsDB) {
      applyOffchainDB(ipfsDB);
      saveDB();
    }
  } catch {
    // Ignore cross-port sync fetch failures
  }
});
