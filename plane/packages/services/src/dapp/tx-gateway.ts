/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Cổng giao dịch dùng chung (single-flight transaction gateway).
 *
 * VẤN ĐỀ GỐC (CHAIN-09): hai nhánh ghi dữ liệu on-chain dùng hai cơ chế xếp
 * hàng riêng và không chia sẻ khoá:
 *   - Nhánh A (auto-commit CID): `setTimeout` + cờ `isOnChainCommitInFlight`.
 *   - Nhánh B (task/comment/member): `transactionQueue` trong plane-task-chain.
 * Vì vậy hai nhánh có thể gọi `bridge.request("sendTransaction")` cùng lúc.
 * Blockchain-bridge giữ nonce trong RAM; hai lệnh gửi chồng nhau ⇒ nonce nhảy
 * 2–3 cho một hành động, hoặc giao dịch bị thay thế (replacement underpriced).
 *
 * GIẢI PHÁP: mọi giao dịch (cả hai nhánh) đi qua đúng một hàng đợi toàn cục,
 * chạy tuần tự, không bao giờ chồng nhau. Nhờ đó:
 *   1. Một hành động ⇒ tối đa một giao dịch đang bay tại một thời điểm.
 *   2. Có thể kiểm tra "giao dịch đã lên chain chưa?" ngay sau lỗi timeout mà
 *      không sợ nhầm với giao dịch của luồng khác (không có luồng khác đang chạy).
 *
 * Module này cố ý không phụ thuộc DOM để dùng được ở cả `@plane/services` và
 * lớp service của web app; cả hai chạy trong cùng một JS runtime nên dùng chung
 * đúng một instance.
 */

export type ChainTxState = {
  /** Số tác vụ đang chờ (không tính tác vụ đang chạy). */
  queued: number;
  /** Nhãn tác vụ đang chạy, `null` nếu rảnh. */
  active: string | null;
  /** Lỗi gần nhất (đã được xử lý hoặc bỏ qua bởi caller). */
  lastError: unknown;
};

type Listener = (state: ChainTxState) => void;

let queueTail: Promise<void> = Promise.resolve();
let queuedCount = 0;
let activeLabel: string | null = null;
let lastError: unknown = null;
const listeners = new Set<Listener>();

function snapshot(): ChainTxState {
  return { queued: queuedCount, active: activeLabel, lastError };
}

function emit(): void {
  if (listeners.size === 0) return;
  const state = snapshot();
  for (const listener of listeners) {
    try {
      listener(state);
    } catch {
      // Listener lỗi không được phép làm hỏng hàng đợi giao dịch.
    }
  }
}

/** Theo dõi trạng thái hàng đợi (dùng cho UI hiển thị "đang ghi dữ liệu"). */
export function subscribeChainTxState(listener: Listener): () => void {
  listeners.add(listener);
  listener(snapshot());
  return () => {
    listeners.delete(listener);
  };
}

export function getChainTxState(): ChainTxState {
  return snapshot();
}

export function isChainTxInFlight(): boolean {
  return activeLabel !== null;
}

/**
 * Chạy `task` khi mọi giao dịch trước đó đã kết thúc.
 * Luôn trả về promise của chính `task`; lỗi của tác vụ trước không làm hỏng hàng đợi.
 */
export function runExclusiveChainTx<T>(label: string, task: () => Promise<T>): Promise<T> {
  queuedCount += 1;
  emit();

  const run = queueTail.then(async () => {
    queuedCount = Math.max(0, queuedCount - 1);
    activeLabel = label;
    emit();
    try {
      return await task();
    } catch (error) {
      lastError = error;
      throw error;
    } finally {
      activeLabel = null;
      emit();
    }
  });

  queueTail = run.then(
    () => undefined,
    () => undefined
  );

  return run;
}

/**
 * Chờ hàng đợi rảnh (dùng trước khi đọc lại trạng thái chain hoặc trước khi
 * người dùng rời trang). Trả về `true` nếu rảnh trước khi hết thời gian chờ.
 */
export async function waitForChainTxIdle(timeoutMs = 30_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  // oxlint-disable-next-line no-unmodified-loop-condition -- The queued promise callbacks update queuedCount while this loop awaits.
  while (isChainTxInFlight() || queuedCount > 0) {
    if (Date.now() >= deadline) return false;
    // oxlint-disable-next-line no-await-in-loop -- phải chờ tuần tự cho tới khi hàng đợi rảnh.
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
  }
  return true;
}

/**
 * Xoá dấu vết phiên ký cũ (dùng khi reset SDK/ví).
 *
 * Việc reset SDK chỉ xoá cache trong bundle; cờ "đã có phiên ký" nằm ở module
 * này và ở `chain.ts`. Nếu không xoá, lần ghi kế tiếp tưởng ví đã mở khoá và gửi
 * giao dịch không kèm hộp thoại mật khẩu ⇒ lỗi khó hiểu cho người dùng.
 */
const signingSessionInvalidators = new Set<() => void>();

export function registerSigningSessionInvalidator(fn: () => void): void {
  signingSessionInvalidators.add(fn);
}

export function invalidateAllSigningSessions(): void {
  for (const fn of signingSessionInvalidators) {
    try {
      fn();
    } catch {
      // Bỏ qua: một invalidator lỗi không được chặn các invalidator còn lại.
    }
  }
}
