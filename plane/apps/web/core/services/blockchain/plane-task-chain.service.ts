import type { AbiItem } from "@metanodejs/mtn-contract";
import { assertVaultSigningAddress, isVaultSigningError, runExclusiveChainTx } from "@plane/services";
import type { TIssue, TIssuePriorities } from "@plane/types";
import { planeTaskManagerAbi } from "@/contracts/plane-task-manager.abi";
import { getFiaiSDK, getLatestCapturedWalletTxHash, initFiaiSDK, resetFiaiSDK } from "./fiai-sdk.service";
import { isMissingTaskContractError } from "./contract-errors";
import {
  isMetanodeWalletRuntimeSupported,
  isWalletAddress,
  promptForMetanodeWalletImport,
  rememberSigningWalletAddress,
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

let warnedAboutClientSigningKey = false;

/**
 * Khoá BLS dùng khi contract yêu cầu chữ ký BLS.
 *
 * CẢNH BÁO: mọi biến `VITE_*` đều bị nhúng vào bundle tải về trình duyệt.
 * Production phải để trống biến này (xem `.env.production.example`); chỉ dùng
 * cho môi trường phát triển khi kiểm thử contract.
 */
function getBlsPrivateKey(): string | undefined {
  const key = readEnv("VITE_BLS_PRIVATE_KEY");
  if (!key) return undefined;
  if (!warnedAboutClientSigningKey && typeof window !== "undefined") {
    warnedAboutClientSigningKey = true;
    console.warn(
      "[Blockchain] Đang dùng khoá ký BLS ngay trên trình duyệt (VITE_BLS_PRIVATE_KEY). " +
        "Khoá nằm trong bundle công khai nên chỉ được dùng ở môi trường phát triển."
    );
  }
  return key;
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
// Chờ người dùng mở khoá Crypto Vault + xác nhận ký, nhưng không được treo vô hạn.
const SIGN_TIMEOUT_MS = 120_000;
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
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
    0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
    0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
    0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
    0xc67178f2,
  ];
  const rotr = (n: number, x: number) => (x >>> n) | (x << (32 - n));
  let h0 = 0x6a09e667,
    h1 = 0xbb67ae85,
    h2 = 0x3c6ef372,
    h3 = 0xa54ff53a;
  let h4 = 0x510e527f,
    h5 = 0x9b05688c,
    h6 = 0x1f83d9ab,
    h7 = 0x5be0cd19;

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
    let a = h0,
      b = h1,
      c = h2,
      d = h3,
      e = h4,
      f = h5,
      g = h6,
      h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(6, e) ^ rotr(11, e) ^ rotr(25, e);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[i] + W[i]) | 0;
      const S0 = rotr(2, a) ^ rotr(13, a) ^ rotr(22, a);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }
    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
    h5 = (h5 + f) | 0;
    h6 = (h6 + g) | 0;
    h7 = (h7 + h) | 0;
  }
  return "0x" + [h0, h1, h2, h3, h4, h5, h6, h7].map((v) => (v >>> 0).toString(16).padStart(8, "0")).join("");
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
  // "invalid sign" KHÔNG phải lỗi nonce: nó là lỗi chữ ký/phiên ký. Xếp chung
  // vào đây từng khiến hệ thống gửi lại giao dịch không cần thiết.
  return /invalid nonce|nonce too low|nonce has already been used|replacement transaction underpriced|nonce conflict/i.test(
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

/**
 * Giao dịch đã được ghi lên hệ thống nhưng ứng dụng ví không kịp phản hồi.
 * Đây KHÔNG phải lỗi: lớp trên phải coi như thành công và tuyệt đối không gửi lại.
 */
export class ChainTransactionLandedError extends Error {
  readonly txHash: string;

  constructor(txHash: string, cause?: unknown) {
    super("Giao dịch đã được ghi nhận trên hệ thống dù ứng dụng ví chưa kịp phản hồi.", { cause });
    this.name = "ChainTransactionLandedError";
    this.txHash = txHash;
  }
}

/**
 * Trước khi ký: xác nhận địa chỉ sắp dùng CÓ THẬT trong ứng dụng ví, và ghi nhớ đó là ví đang ký.
 *
 * Vì sao cần: địa chỉ lưu trong hồ sơ/trình duyệt có thể đã cũ (người dùng đổi ví trong ứng dụng
 * ví), khi đó giao dịch sẽ thất bại với thông báo khó hiểu từ cầu nối ví ("Wallet not found").
 * Kiểm tra ở đây cho ra lỗi rõ ràng kèm mã để UI mở "Trung tâm ví" (WALLET-02); đồng thời mọi bản
 * ghi audit sau đó dùng đúng ví đã ký (CHAIN-05).
 *
 * Không chặn nhầm: nếu KHÔNG đọc được danh sách ví (ứng dụng ví chưa sẵn sàng) thì giữ nguyên
 * hành vi cũ — để bước ký báo lỗi chính xác thay vì chặn một giao dịch có thể vẫn ký được.
 */
async function confirmSigningWallet(candidate: string): Promise<string> {
  try {
    // `refresh: false` = dùng danh sách ví vừa đọc khi chọn ví, không gọi lại cầu nối ví.
    const address = await assertVaultSigningAddress(candidate, { refresh: false });
    rememberSigningWalletAddress(address);
    return address;
  } catch (error) {
    if (!isVaultSigningError(error)) throw error;
    if (error.code === "VAULT_UNAVAILABLE") {
      console.warn("[Chain] Không kiểm tra được danh sách ví trước khi ký:", error.message);
      return candidate;
    }
    throw error;
  }
}

async function sendContractTransactionNow(functionName: string, values: Record<string, InputValue>): Promise<string> {
  if (typeof window !== "undefined" && !isMetanodeWalletRuntimeSupported()) {
    throw new Error(
      "Trình duyệt chặn kết nối ví trên địa chỉ không bảo mật. Hãy mở Plane bằng địa chỉ nội bộ do quản trị viên cung cấp."
    );
  }
  const abi = contractFunctions.find((item) => item.type === "function" && item.name === functionName);
  if (!abi) throw new Error("Tính năng này chưa được cấu hình trên hệ thống. Vui lòng liên hệ quản trị viên.");
  const contractAddress = readEnv("VITE_CONTRACT_ADDRESS");
  if (!isWalletAddress(contractAddress)) throw new Error("Hệ thống chưa được cấu hình nơi lưu dữ liệu. Vui lòng liên hệ quản trị viên.");
  let bridge = (await initFiaiSDK()) ?? getFiaiSDK();
  if (!bridge) throw new Error("Chưa kết nối được ứng dụng ví. Hãy mở ứng dụng ví rồi thử lại.");
  let from = await resolveMetanodeWalletAddress();
  from = await confirmSigningWallet(from);
  // Hash tài khoản trước khi gửi, đọc BÊN TRONG khoá giao dịch để không nhầm với
  // giao dịch của luồng khác (xem `tx-gateway.ts`).
  let hashBeforeSend: string | null = null;

  const send = (senderAddress: string) =>
    runExclusiveChainTx(`task:${functionName}`, async () => {
      hashBeforeSend = await readLatestWalletTxHash(bridge!, senderAddress).catch(() => null);
      try {
        return await withTimeout(
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
          }),
          SIGN_TIMEOUT_MS,
          "Ví điện tử chưa phản hồi khi xác nhận. Bạn hãy mở khoá ví rồi thực hiện lại."
        );
      } catch (error) {
        // Ví có thể đã ghi giao dịch lên hệ thống nhưng không kịp phản hồi. Kiểm
        // tra lại hash trong CÙNG khoá: nếu đã lên thì báo "xong" thay vì gửi lại.
        const landed = await readLatestWalletTxHash(bridge!, senderAddress).catch(() => null);
        if (landed && landed !== hashBeforeSend) throw new ChainTransactionLandedError(landed, error);
        throw error;
      }
    });

  const sendWithWalletRecovery = async (): Promise<unknown> => {
    try {
      return await send(from);
    } catch (error) {
      const message = blockchainErrorMessage(error);
      if (!/wallet not found/i.test(message)) throw error;
      const imported = await promptForMetanodeWalletImport(from);
      if (!imported)
        throw new Error("Không tìm thấy ví hoặc phiên kết nối ví đã hết hạn. Hãy chọn lại ví.", { cause: error });
      from = await resolveMetanodeWalletAddress();
      from = await confirmSigningWallet(from);
      return send(from);
    }
  };

  let result: unknown;
  let confirmationTimeoutError: unknown = null;
  try {
    result = await sendWithWalletRecovery();
  } catch (error) {
    if (error instanceof ChainTransactionLandedError) throw error;
    const message = blockchainErrorMessage(error);
    if (/failed to decrypt payload/i.test(message)) {
      bridge = await resetFiaiSDK();
      if (!bridge) throw new Error("Không kết nối lại được với ứng dụng ví. Hãy mở ứng dụng ví rồi thử lại.", { cause: error });
      result = await sendWithWalletRecovery();
    } else if (isConfirmationTimeoutError(error)) {
      confirmationTimeoutError = error;
    } else {
      throw new Error(message, { cause: error });
    }
  }

  let hash = transactionHash(result, true) ?? normalizeTransactionHash(getLatestCapturedWalletTxHash(from));
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
        `Chưa nhận được xác nhận sau ${Math.round(hashWaitTimeout / 1000)} giây. Hãy kiểm tra lịch sử ví trước khi thử lại để tránh lưu trùng.`,
        { cause: confirmationTimeoutError }
      );
    }
    throw new Error(
      `Thay đổi đã được gửi nhưng chưa nhận được xác nhận sau ${Math.round(hashWaitTimeout / 1000)} giây. Dữ liệu chưa được ghi để tránh lưu trùng.`
    );
  }
  return hash;
}

async function sendContractTransaction(functionName: string, values: Record<string, InputValue>): Promise<string> {
  return enqueueTransaction(async () => {
    const wallet = await resolveMetanodeWalletAddress().catch(() => "");
    const hashBeforeAttempt = wallet ? await fetchRpcAccountLastHash(wallet).catch(() => null) : null;

    try {
      return await sendContractTransactionNow(functionName, values);
    } catch (error) {
      if (error instanceof ChainTransactionLandedError) return error.txHash;

      const msg = blockchainErrorMessage(error);
      if (/cancel|user rejected|đã hủy|đã huỷ/i.test(msg)) throw error;

      // Trước khi quyết định gửi lại, hỏi thẳng node: giao dịch đã lên chưa?
      // Nếu đã lên thì trả về hash thật — gửi lại chỉ làm nonce nhảy thêm.
      const landed = wallet ? await fetchRpcAccountLastHash(wallet).catch(() => null) : null;
      if (landed && landed !== hashBeforeAttempt) return landed;

      if (!isNonceError(error)) throw error;

      // Nonce lệch do cache của cầu nối ví → tạo lại phiên (đồng thời xoá cờ
      // "đã có phiên ký") rồi gửi lại ĐÚNG MỘT lần.
      await resetFiaiSDK().catch(() => null);
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
  // Ví tạo task cũng là ví được ghi làm người thực hiện → phải là ví thật sự ký.
  const creatorWallet = await confirmSigningWallet(await resolveMetanodeWalletAddress());
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
  if (!isWalletAddress(walletAddress)) throw new Error("Địa chỉ ví của nhân viên không hợp lệ.");
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
  if (subTaskId === null) throw new Error("Không tìm thấy công việc con trên hệ thống.");
  if (await supportsAtomicHierarchy()) {
    return sendContractTransaction("deleteChildTask", { childTaskId, parentTaskId, subTaskId });
  }
  await sendContractTransaction("deleteSubTask", { taskId: parentTaskId, subTaskId });
  return sendContractTransaction("deleteTask", { taskId: childTaskId });
}

export async function updateIssueProgressOnChain(taskId: number, progress: number): Promise<string> {
  if (!Number.isInteger(progress) || progress < 0 || progress > 100) throw new Error("Tiến độ phải nằm trong khoảng 0–100.");
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

/** Không xác định được ví để ĐỌC dữ liệu (khác với "không có dữ liệu"). */
export class WalletUnavailableError extends Error {
  constructor(message = "Chưa xác định được ví để đọc dữ liệu. Hãy kết nối ví rồi thử lại.") {
    super(message);
    this.name = "WalletUnavailableError";
  }
}

async function readContract(functionName: string, values: Record<string, InputValue>): Promise<unknown> {
  const abi = contractFunctions.find((item) => item.type === "function" && item.name === functionName);
  if (!abi) throw new Error("Tính năng này chưa được cấu hình trên hệ thống. Vui lòng liên hệ quản trị viên.");
  const contractAddress = readEnv("VITE_CONTRACT_ADDRESS");
  if (!isWalletAddress(contractAddress)) throw new Error("Hệ thống chưa được cấu hình nơi lưu dữ liệu. Vui lòng liên hệ quản trị viên.");
  await initFiaiSDK();
  const from = await resolveMetanodeWalletAddress({ silent: true }).catch(() => "");

  // KHÔNG đọc bằng địa chỉ 0x000…0: kết quả không gắn với ví nào và rất dễ bị hiểu
  // nhầm là "chưa có trên hệ thống" ⇒ hệ thống tạo trùng dữ liệu (lỗi CHAIN-07).
  if (!isWalletAddress(from) || from === ZERO_ADDRESS) throw new WalletUnavailableError();

  const effectiveFrom = from;
  const { MtnContract } = await import("@metanodejs/mtn-contract");
  const contract = new MtnContract({ from: effectiveFrom, to: contractAddress });
  return withTimeout(
    contract.sendTransaction({
      from: effectiveFrom,
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
  if (taskId === null) throw new Error("Không xác định được mã công việc trên hệ thống.");
  return taskId;
}

export function isMissingOnChainRecordError(error: unknown): boolean {
  return isMissingTaskContractError(error);
}

/**
 * Trạng thái của một công việc trên contract.
 *
 * `unknown` rất quan trọng: khi không đọc được trạng thái (RPC lỗi, ví chưa
 * sẵn sàng), TUYỆT ĐỐI không được coi là "chưa có" — nếu không hệ thống sẽ tạo
 * trùng dữ liệu (lỗi CHAIN-06).
 */
export type OnChainPresence = "present" | "missing" | "unknown";

export async function getIssueOnChainPresence(issueId: string): Promise<OnChainPresence> {
  try {
    const taskId = await getIssueTaskId(issueId);
    return taskId !== null && taskId !== undefined && taskId >= 0 ? "present" : "missing";
  } catch (error) {
    if (isMissingOnChainRecordError(error)) return "missing";
    console.warn("[Blockchain] Không đọc được trạng thái công việc trên hệ thống:", error);
    return "unknown";
  }
}

/**
 * @deprecated Dùng `getIssueOnChainPresence` để phân biệt được "chưa có" và
 * "không đọc được". Hàm này chỉ trả `true` khi chắc chắn công việc đã có.
 */
export async function issueExistsOnChain(issueId: string): Promise<boolean> {
  return (await getIssueOnChainPresence(issueId)) === "present";
}

export type OnChainTaskBackfillResult = {
  created: number;
  skipped: number;
  failed: number;
  /** Bỏ qua vì không đọc được trạng thái (không phải "đã có sẵn"). */
  unknown: number;
  aborted: boolean;
  /** Chi tiết từng công việc không lưu được — dùng để báo đúng cho người dùng. */
  errors: { issueId: string; name: string; message: string }[];
};

/**
 * Tạo lại các task chưa tồn tại trên contract hiện tại (ví dụ toàn bộ dữ liệu được tạo trước khi
 * contract mới được deploy, nên `taskCount()` = 0). Contract revert `DuplicateExternalId` nếu task
 * đã tồn tại, nên thao tác này an toàn khi chạy lặp lại.
 * Task cha được tạo trước task con để có parentTaskId hợp lệ khi tạo child task.
 */
export async function backfillIssuesOnChain(
  issues: TIssue[],
  onProgress?: (message: string) => void
): Promise<OnChainTaskBackfillResult> {
  const result: OnChainTaskBackfillResult = { created: 0, skipped: 0, failed: 0, unknown: 0, aborted: false, errors: [] };
  if (!isOnChainTaskSyncAvailable()) return { ...result, aborted: true };

  const validIssues = (issues || []).filter((issue) => Boolean(issue?.id));
  if (validIssues.length === 0) return result;

  const issueById = new Map(validIssues.map((issue) => [issue.id, issue]));
  const depthOf = (issue: TIssue): number => {
    let depth = 0;
    let currentParentId: string | null | undefined = issue.parent_id;
    const visited = new Set<string>([issue.id]);
    while (currentParentId && issueById.has(currentParentId) && !visited.has(currentParentId)) {
      visited.add(currentParentId);
      currentParentId = issueById.get(currentParentId)?.parent_id ?? null;
      depth += 1;
    }
    return depth;
  };
  const orderedIssues = [...validIssues].sort((a, b) => depthOf(a) - depthOf(b));

  let consecutiveFailures = 0;
  for (const issue of orderedIssues) {
    // Chỉ tạo mới khi contract xác nhận task KHÔNG tồn tại. Nếu không đọc được
    // trạng thái thì đếm vào `unknown` — không tạo trùng, nhưng cũng không được
    // báo là "đã có sẵn" cho người dùng.
    const presence = await getIssueOnChainPresence(issue.id);
    if (presence === "present") {
      result.skipped += 1;
      continue;
    }
    if (presence === "unknown") {
      result.unknown += 1;
      continue;
    }

    onProgress?.(`Đang lưu công việc: ${issue.name || issue.id}`);
    try {
      await createIssueOnChain(issue);
      result.created += 1;
      consecutiveFailures = 0;
    } catch (error) {
      if (/duplicateexternalid|already exists/i.test(blockchainErrorMessage(error))) {
        result.skipped += 1;
        consecutiveFailures = 0;
        continue;
      }
      result.failed += 1;
      consecutiveFailures += 1;
      result.errors.push({
        issueId: issue.id,
        name: issue.name || issue.id,
        message: blockchainErrorMessage(error).slice(0, 300),
      });
      console.warn(`Không tạo được task on-chain cho issue ${issue.id}:`, error);
      // Ví bị từ chối ký / RPC lỗi liên tiếp → dừng để tránh bật popup ký hàng loạt.
      if (consecutiveFailures >= 2) {
        result.aborted = true;
        break;
      }
    }
  }

  return result;
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
  if (progress === null) throw new Error("Không đọc được tiến độ công việc. Vui lòng thử lại.");
  return progress;
}

export type OnChainTaskDetails = {
  taskId: number;
  creator: string;
  assignee: string;
  createdAt: number;
  updatedAt: number;
  dueAt: number;
  progress: number;
  priority: number;
  status: number;
};

export type OnChainDailyReport = {
  reportedAt: number;
  progress: number;
  workHash: string;
  difficultyHash: string;
  evidenceHash: string;
};

export async function getIssueOnChainTaskDetails(issueId: string): Promise<OnChainTaskDetails | null> {
  try {
    const taskId = await getIssueTaskId(issueId);
    const raw = await readContract("getTask", { taskId });
    if (!raw) return null;
    if (Array.isArray(raw) && raw.length >= 10) {
      return {
        taskId,
        creator: String(raw[2] || ""),
        assignee: String(raw[3] || ""),
        createdAt: Number(raw[4] || 0),
        updatedAt: Number(raw[5] || 0),
        dueAt: Number(raw[6] || 0),
        progress: Number(raw[7] || 0),
        priority: Number(raw[8] || 0),
        status: Number(raw[9] || 0),
      };
    }
    if (typeof raw === "object") {
      const obj = raw as Record<string, any>;
      return {
        taskId,
        creator: String(obj.creator || ""),
        assignee: String(obj.assignee || ""),
        createdAt: Number(obj.createdAt || 0),
        updatedAt: Number(obj.updatedAt || 0),
        dueAt: Number(obj.dueAt || 0),
        progress: Number(obj.progress || 0),
        priority: Number(obj.priority || 0),
        status: Number(obj.status || 0),
      };
    }
    return null;
  } catch {
    return null;
  }
}

export async function getIssueOnChainReports(issueId: string): Promise<OnChainDailyReport[]> {
  try {
    const taskId = await getIssueTaskId(issueId);
    const countRaw = await readContract("getReportCount", { taskId });
    const count = readNumericResult(countRaw);
    if (!count || count <= 0) return [];
    const reports: OnChainDailyReport[] = [];
    for (let i = 0; i < count; i++) {
      try {
        const rRaw = await readContract("getDailyReport", { taskId, reportId: i });
        if (Array.isArray(rRaw) && rRaw.length >= 5) {
          reports.push({
            reportedAt: Number(rRaw[0] || 0),
            progress: Number(rRaw[1] || 0),
            workHash: String(rRaw[2] || ""),
            difficultyHash: String(rRaw[3] || ""),
            evidenceHash: String(rRaw[4] || ""),
          });
        } else if (typeof rRaw === "object" && rRaw !== null) {
          const rObj = rRaw as Record<string, any>;
          reports.push({
            reportedAt: Number(rObj.reportedAt || 0),
            progress: Number(rObj.progress || 0),
            workHash: String(rObj.workHash || ""),
            difficultyHash: String(rObj.difficultyHash || ""),
            evidenceHash: String(rObj.evidenceHash || ""),
          });
        }
      } catch {}
    }
    return reports;
  } catch {
    return [];
  }
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
  if (!stats) throw new Error("Không đọc được thông tin công việc con. Vui lòng thử lại.");
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
  if (subTaskId === null) throw new Error("Không tìm thấy công việc con trên hệ thống.");
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
  if (subTaskId === null) throw new Error("Không tìm thấy công việc con trên hệ thống.");
  return sendContractTransaction("updateSubTaskStatus", { taskId, subTaskId, status });
}
export async function updateIssueSubTaskProgressOnChain(
  parentIssueId: string,
  subIssueId: string,
  progress: number
): Promise<string> {
  if (!Number.isInteger(progress) || progress < 0 || progress > 100) {
    throw new Error("Tiến độ phải nằm trong khoảng 0–100.");
  }
  const taskId = await getIssueTaskId(parentIssueId);
  const subTaskIdResult = await readContract("getSubTaskId", {
    taskId,
    externalId: await hashTaskValue(`plane-sub-issue:${subIssueId}`),
  });
  const subTaskId = readNumericResult(subTaskIdResult);
  if (subTaskId === null) throw new Error("Không tìm thấy công việc con trên hệ thống.");
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
      if (subTaskId === null) throw new Error("Không tìm thấy công việc cha trên hệ thống.");
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
  let wallet = walletAddress?.trim();
  if (!wallet) {
    try {
      wallet = await resolveMetanodeWalletAddress({ silent: true });
    } catch {
      wallet = "0x0000000000000000000000000000000000000000";
    }
  }
  if (!isWalletAddress(wallet) || wallet === "0x0000000000000000000000000000000000000000") {
    return {
      wallet: wallet || "0x0000000000000000000000000000000000000000",
      kpi: {
        total: 0,
        todo: 0,
        completed: 0,
        inProgress: 0,
        cancelled: 0,
        onSchedule: 0,
        delayed: 0,
        overdue: 0,
        progressSum: 0,
        averageProgress: 0,
      },
    };
  }
  const values = findKpiValues(await readContract("getKPI", { assignee: wallet }));
  if (!values) throw new Error("Không đọc được chỉ số KPI trả về. Vui lòng thử lại.");
  const [total, todo, completed, inProgress, cancelled, onSchedule, delayed, overdue, progressSum, averageProgress] =
    values;
  return {
    wallet,
    kpi: { total, todo, completed, inProgress, cancelled, onSchedule, delayed, overdue, progressSum, averageProgress },
  };
}
