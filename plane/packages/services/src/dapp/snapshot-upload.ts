export type SnapshotUploadCode =
  | "OFFLINE"
  | "CONFIGURATION"
  | "TIMEOUT"
  | "NETWORK"
  | "RATE_LIMIT"
  | "TOO_LARGE"
  | "SERVICE"
  | "INVALID_RESPONSE"
  | "CONTEXT_CHANGED"
  | "LOCAL_STORAGE";

export class SnapshotUploadError extends Error {
  readonly code: SnapshotUploadCode;
  readonly retryable: boolean;
  readonly status?: number;
  readonly retryAfterMs?: number;
  constructor(code: SnapshotUploadCode, message: string, retryable = false, status?: number, retryAfterMs?: number) {
    super(message);
    this.name = "SnapshotUploadError";
    this.code = code;
    this.retryable = retryable;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

export type SnapshotUploadState = {
  phase: "idle" | "uploading" | "retrying" | "complete" | "failed";
  attempt: number;
  maxAttempts: number;
  error?: SnapshotUploadError;
};
export type SnapshotUploadPolicy = {
  timeoutMs: number;
  totalTimeoutMs: number;
  maxAttempts: number;
  retryDelayMs: number;
};
let state: SnapshotUploadState = { phase: "idle", attempt: 0, maxAttempts: 2 };
const listeners = new Set<(value: SnapshotUploadState) => void>();
function emit(next: SnapshotUploadState): void {
  state = next;
  for (const listener of listeners) {
    try {
      listener({ ...next });
    } catch {
      /* A view cannot interrupt storage. */
    }
  }
}
export function subscribeSnapshotUploadState(listener: (value: SnapshotUploadState) => void): () => void {
  listeners.add(listener);
  listener({ ...state });
  return () => {
    listeners.delete(listener);
  };
}

export function notifySnapshotUploadReuse(): void {
  emit({ phase: "complete", attempt: 0, maxAttempts: 0 });
}

export function snapshotUploadPolicy(read: (name: string) => string | undefined): SnapshotUploadPolicy {
  const value = (key: string, fallback: number, min: number, max: number) => {
    const input = read(key)?.trim();
    const number = input ? Number(input) : Number.NaN;
    return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
  };
  return {
    timeoutMs: value("VITE_IPFS_UPLOAD_TIMEOUT_MS", 45_000, 1_000, 120_000),
    totalTimeoutMs: value("VITE_IPFS_UPLOAD_TOTAL_TIMEOUT_MS", 90_000, 1_000, 180_000),
    maxAttempts: value("VITE_IPFS_UPLOAD_MAX_ATTEMPTS", 2, 1, 3),
    retryDelayMs: value("VITE_IPFS_UPLOAD_RETRY_DELAY_MS", 1_000, 0, 10_000),
  };
}

export function isPublishedCID(value: unknown): value is string {
  return typeof value === "string" && /^(?:Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{30,120})$/.test(value);
}

function serviceError(status: number, code: unknown, retryAfter: string | null): SnapshotUploadError {
  if (status === 413)
    return new SnapshotUploadError(
      "TOO_LARGE",
      "Dữ liệu vượt giới hạn của dịch vụ lưu trữ. Thay đổi vẫn được giữ trên máy; hãy liên hệ quản trị viên.",
      false,
      status
    );
  if (status === 401 || status === 403 || code === "STORAGE_CONFIGURATION" || code === "STORAGE_UPSTREAM_AUTH")
    return new SnapshotUploadError(
      "CONFIGURATION",
      "Dịch vụ lưu trữ cần quản trị viên kiểm tra cấu hình. Thay đổi vẫn được giữ trên máy.",
      false,
      status
    );
  if (status === 429) {
    const seconds = retryAfter ? Number(retryAfter) : Number.NaN;
    const date = retryAfter ? Date.parse(retryAfter) : Number.NaN;
    const delay = Number.isFinite(seconds)
      ? Math.max(0, seconds * 1000)
      : Number.isFinite(date)
        ? Math.max(0, date - Date.now())
        : undefined;
    return new SnapshotUploadError(
      "RATE_LIMIT",
      "Dịch vụ lưu trữ đang bận. Thay đổi vẫn được giữ trên máy; vui lòng thử lại sau.",
      true,
      status,
      delay
    );
  }
  const retryable = status === 408 || status === 425 || status >= 500;
  return new SnapshotUploadError(
    "SERVICE",
    "Dịch vụ lưu trữ chưa xử lý được yêu cầu. Thay đổi vẫn được giữ trên máy; bạn có thể thử lại.",
    retryable,
    status
  );
}

/** Retries storage only. This module has no wallet or transaction dependencies. */
export async function publishSnapshot(
  endpoint: string | null,
  serialized: string,
  policy: SnapshotUploadPolicy,
  isCurrent: () => boolean = () => true
): Promise<string> {
  const deadline = Date.now() + policy.totalTimeoutMs;
  let attempt = 0;
  try {
    if (!endpoint)
      throw new SnapshotUploadError("CONFIGURATION", "Chưa cấu hình dịch vụ lưu trữ. Hãy liên hệ quản trị viên.");
    let url: URL;
    try {
      url = new URL(endpoint);
    } catch {
      throw new SnapshotUploadError("CONFIGURATION", "Địa chỉ dịch vụ lưu trữ chưa hợp lệ. Hãy liên hệ quản trị viên.");
    }
    if (!["http:", "https:"].includes(url.protocol))
      throw new SnapshotUploadError("CONFIGURATION", "Địa chỉ dịch vụ lưu trữ chưa hợp lệ. Hãy liên hệ quản trị viên.");
    let failure: SnapshotUploadError | undefined;
    while (attempt < policy.maxAttempts) {
      if (!isCurrent())
        throw new SnapshotUploadError(
          "CONTEXT_CHANGED",
          "Tài khoản hoặc không gian làm việc đã thay đổi. Hãy đồng bộ lại trong phiên hiện tại."
        );
      if (typeof navigator !== "undefined" && navigator.onLine === false)
        throw new SnapshotUploadError(
          "OFFLINE",
          "Máy đang mất kết nối mạng. Thay đổi vẫn được giữ trên máy; hãy thử lại khi có mạng."
        );
      const remaining = deadline - Date.now();
      if (remaining <= 0)
        throw (
          failure ||
          new SnapshotUploadError(
            "TIMEOUT",
            "Kết nối lưu trữ đang chậm. Thay đổi vẫn được giữ trên máy; bạn có thể thử lại."
          )
        );
      attempt++;
      emit({ phase: "uploading", attempt, maxAttempts: policy.maxAttempts });
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => {
              controller.abort();
              reject(
                new SnapshotUploadError(
                  "TIMEOUT",
                  "Kết nối lưu trữ đang chậm. Thay đổi vẫn được giữ trên máy; bạn có thể thử lại.",
                  true
                )
              );
            },
            Math.min(policy.timeoutMs, remaining)
          );
        });
        const request = (async () => {
          const response = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: serialized,
            signal: controller.signal,
          });
          let body: any;
          try {
            body = await response.json();
          } catch {
            body = null;
          }
          if (!response.ok) throw serviceError(response.status, body?.code, response.headers.get("Retry-After"));
          if (!isPublishedCID(body?.cid))
            throw new SnapshotUploadError(
              "INVALID_RESPONSE",
              "Dịch vụ lưu trữ trả kết quả chưa hợp lệ. Dữ liệu chưa được xác nhận lưu; hãy thử lại hoặc liên hệ quản trị viên."
            );
          return body.cid as string;
        })();
        // oxlint-disable-next-line no-await-in-loop -- Attempts are sequential; a timeout never triggers a wallet transaction.
        const cid = await Promise.race([request, timeout]);
        if (!isCurrent())
          throw new SnapshotUploadError(
            "CONTEXT_CHANGED",
            "Tài khoản hoặc không gian làm việc đã thay đổi. Hãy đồng bộ lại trong phiên hiện tại."
          );
        emit({ phase: "complete", attempt, maxAttempts: policy.maxAttempts });
        return cid;
      } catch (error) {
        failure =
          error instanceof SnapshotUploadError
            ? error
            : new SnapshotUploadError(
                "NETWORK",
                "Chưa kết nối được dịch vụ lưu trữ. Thay đổi vẫn được giữ trên máy; bạn có thể thử lại.",
                true
              );
      } finally {
        if (timer) clearTimeout(timer);
      }
      if (!failure.retryable || attempt >= policy.maxAttempts) throw failure;
      const backoff =
        failure.retryAfterMs ??
        Math.min(10_000, policy.retryDelayMs * 2 ** (attempt - 1) + Math.floor(Math.random() * policy.retryDelayMs));
      if (backoff >= deadline - Date.now()) throw failure;
      emit({ phase: "retrying", attempt, maxAttempts: policy.maxAttempts });
      // oxlint-disable-next-line no-await-in-loop -- Respect backoff before the next storage attempt.
      await new Promise<void>((resolve) => setTimeout(resolve, backoff));
    }
    throw failure || new SnapshotUploadError("SERVICE", "Chưa lưu được dữ liệu. Hãy thử lại.");
  } catch (error) {
    const failure =
      error instanceof SnapshotUploadError
        ? error
        : new SnapshotUploadError("SERVICE", "Chưa lưu được dữ liệu. Thay đổi vẫn được giữ trên máy.");
    emit({ phase: "failed", attempt, maxAttempts: policy.maxAttempts, error: failure });
    throw failure;
  }
}
