import type { AbiItem } from "@metanodejs/mtn-contract";
import type { TIssue, TIssuePriorities } from "@plane/types";
import { planeTaskManagerAbi } from "@/contracts/plane-task-manager.abi";
import {
  getFiaiSDK,
  getLatestCapturedWalletTxHash,
  initFiaiSDK,
  resetFiaiSDK,
} from "./fiai-sdk.service";
import {
  isMetanodeWalletRuntimeSupported,
  isWalletAddress,
  promptForMetanodeWalletImport,
  resolveMetanodeWalletAddress,
} from "./metanode-wallet.service";

function readEnv(name: string): string {
  const fromProcess = typeof process !== "undefined" ? process.env?.[name] : undefined;
  const fromMeta = typeof import.meta !== "undefined" ? (import.meta as any).env?.[name] : undefined;
  return (fromProcess ?? fromMeta ?? "").toString().trim();
}

function getContractGas(): string {
  return readEnv("VITE_CONTRACT_GAS") || "3000000";
}

function getBlsPrivateKey(): string | undefined {
  return readEnv("VITE_BLS_PRIVATE_KEY") || readEnv("NEXT_PUBLIC_BLS_PRIVATE_KEY") || undefined;
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
let pendingCreateAssigneeWallet = ZERO_ADDRESS;
const pendingAssignmentWallets = new Map<string, string>();

export function setPendingCreateAssigneeWallet(walletAddress: string): void {
  if (!isWalletAddress(walletAddress)) throw new Error("Địa chỉ ví nhân viên không hợp lệ.");
  pendingCreateAssigneeWallet = walletAddress;
}

export function setPendingAssignmentWallet(issueId: string, walletAddress: string): void {
  if (!isWalletAddress(walletAddress)) throw new Error("Địa chỉ ví nhân viên không hợp lệ.");
  pendingAssignmentWallets.set(issueId, walletAddress);
}

export function consumePendingAssignmentWallet(issueId: string): string | undefined {
  const walletAddress = pendingAssignmentWallets.get(issueId);
  pendingAssignmentWallets.delete(issueId);
  return walletAddress;
}
const contractFunctions = planeTaskManagerAbi as unknown as AbiItem[];
type InputValue = string | number | number[];
let atomicHierarchySupport: boolean | undefined;
type HashLike = {
  hash?: unknown;
  txHash?: unknown;
  tx_hash?: unknown;
  transactionHash?: unknown;
  transaction_hash?: unknown;
  lastHash?: unknown;
  last_hash?: unknown;
  lastTransactionHash?: unknown;
  data?: HashLike;
  returnValue?: HashLike;
  result?: HashLike;
  response?: HashLike;
  payload?: HashLike;
  output?: HashLike;
  receipt?: HashLike;
};

const DEFAULT_TRANSACTION_TIMEOUT_MS = 60_000;
const TRANSACTION_HASH_POLL_INTERVAL_MS = 400;

function transactionWaitTimeoutMs(): number {
  const configured = Number(readEnv("VITE_FIAI_TIMEOUT") || DEFAULT_TRANSACTION_TIMEOUT_MS);
  if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_TRANSACTION_TIMEOUT_MS;
  return Math.min(Math.max(configured, 10_000), 300_000);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timeout);
        resolve(value);
        return undefined;
      },
      (error) => {
        window.clearTimeout(timeout);
        reject(error);
        return undefined;
      }
    );
  });
}
function normalizeTransactionHash(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  const normalized = candidate.startsWith("0x") || candidate.startsWith("0X") ? candidate.slice(2) : candidate;
  if (!/^[a-fA-F0-9]{64}$/.test(normalized)) return null;
  if (/^0{64}$/.test(normalized)) return null;
  return `0x${normalized.toLowerCase()}`;
}

function transactionHash(value: unknown, includeLastHash = false, visited = new WeakSet<object>()): string | null {
  const directHash = normalizeTransactionHash(value);
  if (directHash) return directHash;
  if (typeof value === "string") {
    try {
      return transactionHash(JSON.parse(value), includeLastHash, visited);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object" || visited.has(value)) return null;
  visited.add(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const hash = transactionHash(item, includeLastHash, visited);
      if (hash) return hash;
    }
    return null;
  }

  const result = value as HashLike;
  const candidates = [
    result.hash,
    result.txHash,
    result.tx_hash,
    result.transactionHash,
    result.transaction_hash,
    ...(includeLastHash ? [result.lastHash, result.last_hash, result.lastTransactionHash] : []),
  ];
  for (const candidate of candidates) {
    const hash = normalizeTransactionHash(candidate);
    if (hash) return hash;
  }

  for (const nested of [
    result.data,
    result.returnValue,
    result.result,
    result.response,
    result.payload,
    result.output,
    result.receipt,
  ]) {
    const hash = transactionHash(nested, includeLastHash, visited);
    if (hash) return hash;
  }
  return null;
}

function blockchainErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const object = error as Record<string, unknown>;
    for (const key of ["message", "description", "error", "data", "response"]) {
      if (key in object) {
        const nested = blockchainErrorMessage(object[key]);
        if (nested && nested !== "Unknown blockchain error.") return nested;
      }
    }
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return "Unknown blockchain error.";
}

function sha256Fallback(bytes: Uint8Array): string {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const rotr = (n: number, x: number) => (x >>> n) | (x << (32 - n));
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

  const bitLen = bytes.length * 8;
  const totalLen = (((bytes.length + 8) >> 6) + 1) << 6;
  const padded = new Uint8Array(totalLen);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(totalLen - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(totalLen - 4, bitLen >>> 0, false);

  const W = new Int32Array(64);
  for (let offset = 0; offset < totalLen; offset += 64) {
    for (let i = 0; i < 16; i++) W[i] = view.getInt32(offset + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(7, W[i - 15]) ^ rotr(18, W[i - 15]) ^ (W[i - 15] >>> 3);
      const s1 = rotr(17, W[i - 2]) ^ rotr(19, W[i - 2]) ^ (W[i - 2] >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(6, e) ^ rotr(11, e) ^ rotr(25, e);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[i] + W[i]) | 0;
      const S0 = rotr(2, a) ^ rotr(13, a) ^ rotr(22, a);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + temp1) | 0;
      d = c; c = b; b = a; a = (temp1 + temp2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }
  return (
    "0x" +
    [h0, h1, h2, h3, h4, h5, h6, h7]
      .map((v) => (v >>> 0).toString(16).padStart(8, "0"))
      .join("")
  );
}

export async function hashTaskValue(value: unknown): Promise<string> {
  const input = typeof value === "string" ? value : JSON.stringify(value);
  const bytes = new TextEncoder().encode(input);
  if (typeof crypto !== "undefined" && crypto.subtle?.digest) {
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return `0x${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  }
  return sha256Fallback(bytes);
}

function priorityValue(priority: TIssuePriorities | null | undefined): number {
  return { none: 0, low: 1, medium: 2, high: 3, urgent: 4 }[priority ?? "none"];
}

function dueTimestamp(targetDate: string | null | undefined): number {
  if (!targetDate) return 0;
  const timestamp = Date.parse(`${targetDate}T23:59:59Z`);
  return Number.isNaN(timestamp) ? 0 : Math.floor(timestamp / 1000);
}

let transactionQueue: Promise<void> = Promise.resolve();

function enqueueTransaction<T>(operation: () => Promise<T>): Promise<T> {
  const result = transactionQueue.then(operation, operation);
  transactionQueue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

function isNonceError(error: unknown): boolean {
  return /invalid nonce|nonce too low|nonce has already been used|replacement transaction underpriced|nonce conflict|invalid sign/i.test(
    blockchainErrorMessage(error)
  );
}

function isConfirmationTimeoutError(error: unknown): boolean {
  return /transaction not confirmed|confirmation.*timed out|\b408\b/i.test(blockchainErrorMessage(error));
}

async function fetchRpcAccountLastHash(address: string, timeoutMs = 4000): Promise<string | null> {
  const rpcUrl = readEnv("VITE_RPC_URL");
  if (!rpcUrl || typeof fetch === "undefined") return null;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(rpcUrl, {
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
    if (!res.ok) return null;
    const json = await res.json();
    return normalizeTransactionHash(json?.result?.lastHash ?? json?.result?.last_hash);
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

async function readLatestWalletTxHash(
  bridge: NonNullable<ReturnType<typeof getFiaiSDK>>,
  from: string
): Promise<string | null> {
  // 1. Check hash captured directly from blockchain-bridge -> updateWalletInfo
  const captured = normalizeTransactionHash(getLatestCapturedWalletTxHash(from));

  // 2. Query live account state directly from RPC node (no cache, no password prompt)
  const rpcHash = await fetchRpcAccountLastHash(from, 3500);
  if (rpcHash) return rpcHash;
  if (captured) return captured;

  // 3. Fallback: read directly from Crypto Vault IndexedDB (getActiveWalletDapp / getAllWallets)
  // which bypasses Crypto Vault's 60-second decryptedCache and never prompts for password.
  const activeDapp = await bridge
    .request("getActiveWalletDapp", { domain: window.location.hostname }, { timeout: 4000 })
    .catch(() => null);
  const activeHash = transactionHash(activeDapp, true);
  if (activeHash) return activeHash;

  const allWallets = await bridge.request("getAllWallets", {}, { timeout: 4000 }).catch(() => null);
  if (Array.isArray(allWallets)) {
    const matched = allWallets.find((w: any) => {
      const addr = typeof w?.address === "string" ? w.address.toLowerCase() : "";
      const normFrom = from.toLowerCase().startsWith("0x") ? from.toLowerCase() : `0x${from.toLowerCase()}`;
      const normAddr = addr.startsWith("0x") ? addr : `0x${addr}`;
      return normAddr === normFrom;
    });
    const matchedHash = transactionHash(matched, true);
    if (matchedHash) return matchedHash;
  }

  return null;
}

async function sendContractTransactionNow(functionName: string, values: Record<string, InputValue>): Promise<string> {
  if (typeof window !== "undefined" && !isMetanodeWalletRuntimeSupported()) {
    throw new Error(
      "MetaNode Wallet không thể ký an toàn trên địa chỉ HTTP công cộng. Hãy mở http://localhost:3000/plane/ hoặc mạng nội bộ (LAN)."
    );
  }
  const abi = contractFunctions.find((item) => item.type === "function" && item.name === functionName);
  if (!abi) throw new Error(`Contract function ${functionName} is missing from the ABI.`);
  const contractAddress = readEnv("VITE_CONTRACT_ADDRESS");
  if (!isWalletAddress(contractAddress)) throw new Error("VITE_CONTRACT_ADDRESS is invalid.");
  let bridge = (await initFiaiSDK()) ?? getFiaiSDK();
  if (!bridge) throw new Error("FiaiSDK is not available.");
  let from = await resolveMetanodeWalletAddress();
  const hashBeforeSend = await readLatestWalletTxHash(bridge, from).catch(() => null);

  const send = (senderAddress: string) =>
    bridge!.request("sendTransaction", {
      from: senderAddress,
      to: contractAddress,
      abiData: [abi],
      functionName,
      feeType: "sc",
      amount: "0",
      value: "0",
      gas: getContractGas(),
      type: "transaction",
      inputArray: abi.inputs.map((input) => Object.assign({}, input, { value: values[input.name ?? ""] ?? "" })),
      isReadOnly: false,
      bundleId: "",
      blsPrivateKey: getBlsPrivateKey(),
    });

  const sendWithWalletRecovery = async (): Promise<unknown> => {
    try {
      return await send(from);
    } catch (error) {
      const message = blockchainErrorMessage(error);
      if (!/wallet not found/i.test(message)) throw error;
      const imported = await promptForMetanodeWalletImport(from);
      if (!imported)
        throw new Error("Không tìm thấy ví trong Crypto Vault hoặc thao tác kết nối đã hết hạn.", { cause: error });
      from = await resolveMetanodeWalletAddress();
      return send(from);
    }
  };

  let result: unknown;
  let confirmationTimeoutError: unknown = null;
  try {
    result = await sendWithWalletRecovery();
  } catch (error) {
    const message = blockchainErrorMessage(error);
    if (/failed to decrypt payload/i.test(message)) {
      bridge = await resetFiaiSDK();
      if (!bridge) throw new Error("Không thể tạo lại phiên bảo mật với Crypto Vault.", { cause: error });
      result = await sendWithWalletRecovery();
    } else if (isConfirmationTimeoutError(error)) {
      confirmationTimeoutError = error;
    } else {
      throw new Error(message, { cause: error });
    }
  }

  let hash =
    transactionHash(result, true) ?? normalizeTransactionHash(getLatestCapturedWalletTxHash(from));
  if (hash && hash === hashBeforeSend) hash = null;

  const hashWaitTimeout = transactionWaitTimeoutMs();
  const hashWaitDeadline = Date.now() + hashWaitTimeout;
  while (!hash && Date.now() < hashWaitDeadline) {
    // eslint-disable-next-line no-await-in-loop
    const walletHash = await readLatestWalletTxHash(bridge, from).catch(() => null);
    if (walletHash && walletHash !== hashBeforeSend) {
      hash = walletHash;
      break;
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise<void>((resolve) => window.setTimeout(resolve, TRANSACTION_HASH_POLL_INTERVAL_MS));
  }
  if (!hash) {
    if (confirmationTimeoutError) {
      throw new Error(
        `Blockchain Bridge chưa xác nhận giao dịch sau ${Math.round(hashWaitTimeout / 1000)} giây và Crypto Vault không trả hash mới. Vui lòng kiểm tra lịch sử ví trước khi gửi lại.`,
        { cause: confirmationTimeoutError }
      );
    }
    throw new Error(
      `Giao dịch đã được gửi nhưng Crypto Vault chưa trả transaction hash mới sau ${Math.round(hashWaitTimeout / 1000)} giây. Dữ liệu chưa được ghi để tránh dùng nhầm hash cũ.`
    );
  }
  return hash;
}

async function sendContractTransaction(functionName: string, values: Record<string, InputValue>): Promise<string> {
  return enqueueTransaction(async () => {
    try {
      return await sendContractTransactionNow(functionName, values);
    } catch (error) {
      const msg = blockchainErrorMessage(error);
      const isUserCancel = /cancel|user rejected|đã hủy/i.test(msg);
      if (!isUserCancel) {
        // Reset bridge session so blockchain-bridge's in-memory accountMap nonce
        // is refreshed from on-chain state on the next transaction.
        await resetFiaiSDK().catch(() => null);
      }
      if (!isNonceError(error)) throw error;

      await new Promise<void>((resolve) => window.setTimeout(resolve, 1_500));
      return sendContractTransactionNow(functionName, values);
    }
  });
}
export function isOnChainTaskSyncEnabled(): boolean {
  return readEnv("VITE_ONCHAIN_TASKS_ENABLED") === "true" && isWalletAddress(readEnv("VITE_CONTRACT_ADDRESS"));
}

export function isOnChainTaskSyncAvailable(): boolean {
  if (!isOnChainTaskSyncEnabled()) return false;
  return isMetanodeWalletRuntimeSupported();
}

async function supportsAtomicHierarchy(): Promise<boolean> {
  if (atomicHierarchySupport !== undefined) return atomicHierarchySupport;
  const version = await readContract("contractVersion", {})
    .then(readNumericResult)
    .catch(() => null);
  atomicHierarchySupport = version !== null && version >= 2;
  return atomicHierarchySupport;
}

export async function createIssueOnChain(issue: TIssue): Promise<{ transactionHash: string; assigneeWallet: string }> {
  const creatorWallet = await resolveMetanodeWalletAddress();
  const assignee = pendingCreateAssigneeWallet === ZERO_ADDRESS ? creatorWallet : pendingCreateAssigneeWallet;
  pendingCreateAssigneeWallet = ZERO_ADDRESS;
  const commonValues = {
    externalId: await hashTaskValue(`plane-issue:${issue.id}`),
    metadataHash: await hashTaskValue({
      id: issue.id,
      projectId: issue.project_id,
      name: issue.name,
      description: issue.description_html,
    }),
    assignee,

    dueAt: dueTimestamp(issue.target_date),
    priority: priorityValue(issue.priority),
  };
  let createdTransactionHash: string;
  if (issue.parent_id && (await supportsAtomicHierarchy())) {
    const parentTaskId = await getIssueTaskId(issue.parent_id);
    createdTransactionHash = await sendContractTransaction("createChildTask", {
      parentTaskId,
      childExternalId: commonValues.externalId,
      childMetadataHash: commonValues.metadataHash,
      assignee,
      dueAt: commonValues.dueAt,
      priority: commonValues.priority,
      relationshipExternalId: await hashTaskValue(`plane-sub-issue:${issue.id}`),
      relationshipMetadataHash: commonValues.metadataHash,
    });
  } else {
    createdTransactionHash = await sendContractTransaction("createTask", { ...commonValues, assignee });
  }
  return { transactionHash: createdTransactionHash, assigneeWallet: assignee };
}

export async function assignIssueOnChain(taskId: number, walletAddress: string): Promise<string> {
  if (!isWalletAddress(walletAddress)) throw new Error("The employee wallet address is invalid.");
  return sendContractTransaction("assignTask", { taskId, assignee: walletAddress });
}

export async function assignIssueByIssueIdOnChain(issueId: string, walletAddress: string): Promise<string> {
  const taskId = await getIssueTaskId(issueId);
  return assignIssueOnChain(taskId, walletAddress);
}

export async function deleteIssueByIssueIdOnChain(issueId: string, parentIssueId?: string | null): Promise<string> {
  const childTaskId = await getIssueTaskId(issueId);
  if (!parentIssueId) return sendContractTransaction("deleteTask", { taskId: childTaskId });
  const parentTaskId = await getIssueTaskId(parentIssueId);
  const subTaskId = readNumericResult(
    await readContract("getSubTaskId", {
      taskId: parentTaskId,
      externalId: await hashTaskValue(`plane-sub-issue:${issueId}`),
    })
  );
  if (subTaskId === null) throw new Error("Không tìm thấy sub-task on-chain.");
  if (await supportsAtomicHierarchy()) {
    return sendContractTransaction("deleteChildTask", { childTaskId, parentTaskId, subTaskId });
  }
  await sendContractTransaction("deleteSubTask", { taskId: parentTaskId, subTaskId });
  return sendContractTransaction("deleteTask", { taskId: childTaskId });
}

export async function updateIssueProgressOnChain(taskId: number, progress: number): Promise<string> {
  if (!Number.isInteger(progress) || progress < 0 || progress > 100) throw new Error("Progress must be 0-100.");
  return sendContractTransaction("updateProgress", { taskId, progress });
}
export async function updateIssueProgressByIssueIdOnChain(issueId: string, progress: number): Promise<string> {
  return updateIssueProgressOnChain(await getIssueTaskId(issueId), progress);
}
export async function cancelIssueByIssueIdOnChain(issueId: string): Promise<string> {
  return sendContractTransaction("cancelTask", { taskId: await getIssueTaskId(issueId) });
}

export async function updateIssueScheduleByIssueIdOnChain(
  issueId: string,
  targetDate: string | null | undefined,
  priority: TIssuePriorities | null | undefined
): Promise<string> {
  return sendContractTransaction("updateSchedule", {
    taskId: await getIssueTaskId(issueId),
    dueAt: dueTimestamp(targetDate),
    priority: priorityValue(priority),
  });
}

export async function updateIssueMetadataByIssueIdOnChain(issue: TIssue): Promise<string> {
  return sendContractTransaction("updateTaskMetadata", {
    taskId: await getIssueTaskId(issue.id),
    metadataHash: await hashTaskValue({
      id: issue.id,
      projectId: issue.project_id,
      name: issue.name,
      description: issue.description_html,
    }),
  });
}

function readNumericResult(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  if (!value || typeof value !== "object") return null;
  for (const nested of Object.values(value as Record<string, unknown>)) {
    const result = readNumericResult(nested);
    if (result !== null) return result;
  }
  return null;
}

async function readContract(functionName: string, values: Record<string, InputValue>): Promise<unknown> {
  const abi = contractFunctions.find((item) => item.type === "function" && item.name === functionName);
  if (!abi) throw new Error(`Contract function ${functionName} is missing from the ABI.`);
  const contractAddress = readEnv("VITE_CONTRACT_ADDRESS");
  if (!isWalletAddress(contractAddress)) throw new Error("VITE_CONTRACT_ADDRESS is invalid.");
  await initFiaiSDK();
  const from = await resolveMetanodeWalletAddress();
  const { MtnContract } = await import("@metanodejs/mtn-contract");
  const contract = new MtnContract({ from, to: contractAddress });
  return withTimeout(
    contract.sendTransaction({
      from,
      to: contractAddress,
      abiData: [abi],
      functionName,
      feeType: "read",
      amount: "0",
      value: "0",
      gas: getContractGas(),
      type: "transaction",
      inputArray: abi.inputs.map((input) => Object.assign({}, input, { value: values[input.name ?? ""] ?? "" })),
      isReadOnly: true,
      bundleId: "",
    }),
    20_000,
    "Không đọc được task on-chain sau 20 giây. Vui lòng thử lại."
  );
}

export async function getIssueTaskId(issueId: string): Promise<number> {
  const result = await readContract("getTaskId", { externalId: await hashTaskValue(`plane-issue:${issueId}`) });
  const taskId = readNumericResult(result);
  if (taskId === null) throw new Error("Could not read the on-chain task ID.");
  return taskId;
}

export function isMissingOnChainRecordError(error: unknown): boolean {
  return /execution reverted|invalid task|invalid subtask|could not read the on-chain task id|0x0531bbb1|0x464522a9|call_exception/i.test(
    blockchainErrorMessage(error)
  );
}

export async function issueExistsOnChain(issueId: string): Promise<boolean> {
  try {
    const taskId = await getIssueTaskId(issueId);
    return taskId !== null && taskId !== undefined && taskId >= 0;
  } catch (error) {
    if (isMissingOnChainRecordError(error)) return false;
    return false;
  }
}

function findTaskProgress(value: unknown): number | null {
  if (Array.isArray(value)) {
    if (value.length >= 11) {
      const progress = Number(value[7]);
      if (Number.isFinite(progress) && progress >= 0 && progress <= 100) return progress;
    }
    for (const nested of value) {
      const progress = findTaskProgress(nested);
      if (progress !== null) return progress;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const object = value as Record<string, unknown>;
  if ("progress" in object) {
    const progress = Number(object.progress);
    if (Number.isFinite(progress) && progress >= 0 && progress <= 100) return progress;
  }
  for (const nested of Object.values(object)) {
    const progress = findTaskProgress(nested);
    if (progress !== null) return progress;
  }
  return null;
}

export async function getIssueOnChainProgress(issueId: string): Promise<number> {
  const taskId = await getIssueTaskId(issueId);
  const progress = findTaskProgress(await readContract("getTask", { taskId }));
  if (progress === null) throw new Error("Không đọc được tiến độ task từ contract.");
  return progress;
}

export type OnChainSubTaskStats = {
  activeCount: number;
  completedCount: number;
  progress: number;
};

function findSubTaskStats(value: unknown): OnChainSubTaskStats | null {
  if (Array.isArray(value) && value.length >= 3) {
    const numbers = value.slice(0, 3).map((item) => Number(item));
    if (numbers.every(Number.isFinite)) {
      return { activeCount: numbers[0], completedCount: numbers[1], progress: numbers[2] };
    }
  }
  if (!value || typeof value !== "object") return null;
  const object = value as Record<string, unknown>;
  if ("activeCount" in object && "completedCount" in object && "progress" in object) {
    const result = {
      activeCount: Number(object.activeCount),
      completedCount: Number(object.completedCount),
      progress: Number(object.progress),
    };
    if (Object.values(result).every(Number.isFinite)) return result;
  }
  for (const nested of Object.values(object)) {
    const result = findSubTaskStats(nested);
    if (result) return result;
  }
  return null;
}

export async function getIssueSubTaskStats(issueId: string): Promise<OnChainSubTaskStats> {
  const taskId = await getIssueTaskId(issueId);
  const stats = findSubTaskStats(await readContract("getSubTaskStats", { taskId }));
  if (!stats) throw new Error("Không đọc được thống kê sub-task từ contract.");
  return stats;
}

export async function createIssueSubTaskOnChain(
  parentIssueId: string,
  subIssue: { id: string; name: string; description_html?: string | null }
): Promise<string> {
  const taskId = await getIssueTaskId(parentIssueId);
  if (await supportsAtomicHierarchy()) {
    const existing = await readContract("getSubTaskId", {
      taskId,
      externalId: await hashTaskValue(`plane-sub-issue:${subIssue.id}`),
    }).catch(() => null);
    if (readNumericResult(existing) !== null) return "";
  }
  return sendContractTransaction("createSubTask", {
    taskId,
    externalId: await hashTaskValue(`plane-sub-issue:${subIssue.id}`),
    metadataHash: await hashTaskValue({ id: subIssue.id, name: subIssue.name, description: subIssue.description_html }),
  });
}

export async function deleteIssueSubTaskOnChain(parentIssueId: string, subIssueId: string): Promise<string> {
  const taskId = await getIssueTaskId(parentIssueId);
  const subTaskIdResult = await readContract("getSubTaskId", {
    taskId,
    externalId: await hashTaskValue(`plane-sub-issue:${subIssueId}`),
  });
  const subTaskId = readNumericResult(subTaskIdResult);
  if (subTaskId === null) throw new Error("Không tìm thấy sub-task on-chain.");
  return sendContractTransaction("deleteSubTask", { taskId, subTaskId });
}
export async function updateIssueSubTaskStatusOnChain(
  parentIssueId: string,
  subIssueId: string,
  status: 0 | 1 | 2 | 3
): Promise<string> {
  const taskId = await getIssueTaskId(parentIssueId);
  const subTaskIdResult = await readContract("getSubTaskId", {
    taskId,
    externalId: await hashTaskValue(`plane-sub-issue:${subIssueId}`),
  });
  const subTaskId = readNumericResult(subTaskIdResult);
  if (subTaskId === null) throw new Error("Không tìm thấy sub-task on-chain.");
  return sendContractTransaction("updateSubTaskStatus", { taskId, subTaskId, status });
}
export async function updateIssueSubTaskProgressOnChain(
  parentIssueId: string,
  subIssueId: string,
  progress: number
): Promise<string> {
  if (!Number.isInteger(progress) || progress < 0 || progress > 100) {
    throw new Error("Progress must be 0-100.");
  }
  const taskId = await getIssueTaskId(parentIssueId);
  const subTaskIdResult = await readContract("getSubTaskId", {
    taskId,
    externalId: await hashTaskValue(`plane-sub-issue:${subIssueId}`),
  });
  const subTaskId = readNumericResult(subTaskIdResult);
  if (subTaskId === null) throw new Error("Không tìm thấy sub-task on-chain.");
  return sendContractTransaction("updateSubTaskProgress", { taskId, subTaskId, progress });
}
export async function submitIssueDailyReportOnChain(
  issueId: string,
  report: { progress: number; work: string; difficulty: string; evidence: string },
  onStatus?: (message: string) => void,
  ancestorIssueIds: string[] = []
): Promise<{
  transactionHash: string;
  progress: number;
  subTaskStats: OnChainSubTaskStats;
  parentSyncTransactionHashes: string[];
  parentSyncError?: string;
}> {
  onStatus?.("Đang đọc task từ blockchain...");
  const taskId = await getIssueTaskId(issueId);
  const subTaskStatsResult = await readContract("getSubTaskStats", { taskId }).catch(() => null);
  const subTaskStats = findSubTaskStats(subTaskStatsResult) ?? {
    activeCount: 0,
    completedCount: 0,
    progress: report.progress,
  };
  const effectiveProgress = subTaskStats.activeCount > 0 ? subTaskStats.progress : report.progress;
  onStatus?.("Đang chờ mở ví và xác nhận giao dịch...");
  const reportValues = {
    taskId,
    progress: effectiveProgress,
    workHash: await hashTaskValue(report.work),
    difficultyHash: await hashTaskValue(report.difficulty),
    evidenceHash: await hashTaskValue(report.evidence),
  };
  const useAtomicSync = ancestorIssueIds.length > 0 && (await supportsAtomicHierarchy());
  const parentTaskIds: number[] = [];
  const subTaskIds: number[] = [];
  if (useAtomicSync) {
    let childIssueId = issueId;
    for (const parentIssueId of ancestorIssueIds) {
      // eslint-disable-next-line no-await-in-loop
      const parentTaskId = await getIssueTaskId(parentIssueId);
      // eslint-disable-next-line no-await-in-loop
      const relationshipExternalId = await hashTaskValue(`plane-sub-issue:${childIssueId}`);
      // eslint-disable-next-line no-await-in-loop
      const subTaskResult = await readContract("getSubTaskId", {
        taskId: parentTaskId,
        externalId: relationshipExternalId,
      });
      const subTaskId = readNumericResult(subTaskResult);
      if (subTaskId === null) throw new Error("Không tìm thấy quan hệ task cha on-chain.");
      parentTaskIds.push(parentTaskId);
      subTaskIds.push(subTaskId);
      childIssueId = parentIssueId;
    }
  }
  const reportTransactionHash = await withTimeout(
    sendContractTransaction(
      useAtomicSync ? "submitDailyReportAndSyncAncestors" : "submitDailyReport",
      useAtomicSync ? { ...reportValues, parentTaskIds, subTaskIds } : reportValues
    ),
    90_000,
    "Giao dịch báo cáo quá thời gian 90 giây. Hãy kiểm tra cửa sổ ví và thử lại."
  );
  const parentSyncTransactionHashes: string[] = [];
  let parentSyncError: string | undefined;
  let childIssueId = issueId;
  let childProgress = effectiveProgress;
  for (const [index, parentIssueId] of (useAtomicSync ? [] : ancestorIssueIds).entries()) {
    onStatus?.(`Báo cáo đã thành công. Đang đồng bộ tiến độ lên cấp ${index + 1}/${ancestorIssueIds.length}...`);
    try {
      // Wallet confirmations are intentionally sequential from the nearest parent to the root.
      // eslint-disable-next-line no-await-in-loop
      const syncTransactionHash = await updateIssueSubTaskProgressOnChain(parentIssueId, childIssueId, childProgress);
      parentSyncTransactionHashes.push(syncTransactionHash);
      // eslint-disable-next-line no-await-in-loop
      const parentStats = await getIssueSubTaskStats(parentIssueId);
      childIssueId = parentIssueId;
      childProgress = parentStats.progress;
    } catch (error) {
      parentSyncError = `Không đồng bộ được cấp ${index + 1}: ${blockchainErrorMessage(error)}`;
      break;
    }
  }
  return {
    transactionHash: reportTransactionHash,
    progress: effectiveProgress,
    subTaskStats,
    parentSyncTransactionHashes,
    parentSyncError,
  };
}

export async function recordIssueContentOnChain(
  issueId: string,
  kind: 0 | 1 | 2,
  content: string
): Promise<{ transactionHash: string; contentHash: string }> {
  const taskId = await getIssueTaskId(issueId);
  const contentHash = await hashTaskValue(content);
  const contentTransactionHash = await sendContractTransaction("recordTaskContent", {
    taskId,
    kind,
    contentHash,
  });
  return { transactionHash: contentTransactionHash, contentHash };
}
export type OnChainKPI = {
  total: number;
  todo: number;
  completed: number;
  inProgress: number;
  cancelled: number;
  onSchedule: number;
  delayed: number;
  overdue: number;
  progressSum: number;
  averageProgress: number;
};

function findKpiValues(value: unknown): number[] | null {
  if (Array.isArray(value) && value.length >= 10) {
    const numbers = value.slice(0, 10).map((item) => Number(item));
    if (numbers.every(Number.isFinite)) return numbers;
  }
  if (!value || typeof value !== "object") return null;
  const object = value as Record<string, unknown>;
  const keys = [
    "total",
    "todo",
    "completed",
    "inProgress",
    "cancelled",
    "onSchedule",
    "delayed",
    "overdue",
    "progressSum",
    "averageProgress",
  ];
  if (keys.every((key) => key in object)) return keys.map((key) => Number(object[key]));
  for (const nested of Object.values(object)) {
    const result = findKpiValues(nested);
    if (result) return result;
  }
  return null;
}

export async function getWalletKPI(walletAddress?: string): Promise<{ wallet: string; kpi: OnChainKPI }> {
  const wallet = walletAddress?.trim() || (await resolveMetanodeWalletAddress());
  if (!isWalletAddress(wallet)) throw new Error("Địa chỉ ví nhân viên không hợp lệ.");
  const values = findKpiValues(await readContract("getKPI", { assignee: wallet }));
  if (!values) throw new Error("Could not parse KPI returned by the contract.");
  const [total, todo, completed, inProgress, cancelled, onSchedule, delayed, overdue, progressSum, averageProgress] =
    values;
  return {
    wallet,
    kpi: { total, todo, completed, inProgress, cancelled, onSchedule, delayed, overdue, progressSum, averageProgress },
  };
}
