/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useEffect, useState } from "react";
import { Wallet } from "lucide-react";
import {
  getDAppSyncStatus,
  isVaultSigningError,
  localDB,
  syncDAppDBToChain,
  VaultSigningError,
  type DAppSyncStatus,
} from "@plane/services";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { cn } from "@plane/utils";

import { useUser } from "@/hooks/store/user";
import { ensureFiaiFramesReady } from "../../services/blockchain/fiai-sdk.service";
import { WALLET_CHANGED_EVENT } from "../../services/blockchain/wallet-center-events";
import {
  loadSigningWalletState,
  openWalletCenter,
  shortenAddress,
  type SigningWalletState,
} from "../../services/blockchain/wallet-vault.service";
import { backfillIssuesOnChain, isOnChainTaskSyncAvailable } from "../../services/blockchain/plane-task-chain.service";

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error ?? "");
}

/**
 * Biến lỗi ví thành câu thông báo cho người dùng cuối.
 *
 * Nguyên tắc: KHÔNG hiển thị thuật ngữ kỹ thuật (tên SDK, số cổng, blockchain,
 * nonce, IPFS…). Người dùng chỉ cần biết: chuyện gì xảy ra và bấm vào đâu tiếp.
 * Chi tiết kỹ thuật vẫn được ghi ở console để đội vận hành tra cứu.
 */
function presentSyncError(error: unknown): { title: string; message: string } {
  const message = errorMessage(error);

  if (isVaultSigningError(error)) {
    if (error.code === "VAULT_EMPTY") {
      return {
        title: "Chưa có ví",
        message: "Mở “Trung tâm ví” và thêm ví của bạn, sau đó bấm “Đồng bộ dữ liệu” lại.",
      };
    }
    if (error.code === "WALLET_NOT_IN_VAULT") {
      return {
        title: "Ví chưa khớp",
        message: "Mở “Trung tâm ví”, chọn đúng ví bạn đang dùng (hoặc thêm ví) rồi thử lại.",
      };
    }
    return {
      title: "Chưa kết nối được ví",
      message: "Hãy mở ứng dụng ví trên máy, đăng nhập lại và thử lại. Nếu vẫn lỗi, tải lại trang.",
    };
  }

  if (/UNLOCK_CANCELLED|đóng (hộp thoại|cửa sổ) mở khoá/i.test(message)) {
    return {
      title: "Chưa mở khoá ví",
      message: "Thay đổi vẫn được giữ trên máy. Khi sẵn sàng, bấm “Đồng bộ dữ liệu” và nhập mật khẩu ví.",
    };
  }
  if (/wallet not found/i.test(message)) {
    return {
      title: "Không tìm thấy ví",
      message: "Mở “Trung tâm ví” để chọn hoặc thêm ví bạn đang dùng rồi thử lại.",
    };
  }
  if (/frame chưa sẵn sàng|not responding|no frame found/i.test(message)) {
    return {
      title: "Ứng dụng ví chưa sẵn sàng",
      message: "Hãy mở ứng dụng ví trên máy rồi tải lại trang này.",
    };
  }
  if (/Ví (điện tử )?(không|chưa) phản hồi|Vault đang khoá|đang khoá/i.test(message)) {
    return {
      title: "Ví chưa phản hồi",
      message: "Mở “Trung tâm ví” → “Mở khoá ví” rồi bấm “Đồng bộ dữ liệu” lại.",
    };
  }
  if (/không phản hồi|quá \d+ giây/i.test(message)) {
    return {
      title: "Ví phản hồi chậm",
      message: "Hãy kiểm tra ứng dụng ví vẫn đang mở, sau đó thử lại. Dữ liệu trên máy không bị mất.",
    };
  }
  return {
    title: "Chưa lưu được lên hệ thống",
    message: `${message}\n\nDữ liệu vẫn được giữ trên máy. Bạn có thể thử lại bất cứ lúc nào.`,
  };
}

export function SyncToChainButton() {
  const { data: currentUser } = useUser();
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStage, setSyncStage] = useState<string>("Đang xử lý…");
  const [walletState, setWalletState] = useState<SigningWalletState | null>(null);
  const [syncStatus, setSyncStatus] = useState<DAppSyncStatus | null>(null);

  const refreshWalletState = useCallback(async (options?: { refresh?: boolean }) => {
    try {
      setWalletState(await loadSigningWalletState(options));
    } catch (error) {
      console.warn("[Sync] Không đọc được trạng thái ví:", error);
    }
  }, []);

  useEffect(() => {
    // Chưa đăng nhập thì không dò ví (tránh gọi SDK ở trang đăng nhập — WALLET-05).
    if (!currentUser?.id) return;
    void refreshWalletState();
    // Cập nhật lại nhãn ví khi người dùng quay lại tab (ví có thể đã được thêm/xoá).
    let timer: number | undefined;
    const onFocus = () => {
      window.clearTimeout(timer);
      // Đọc lại nhãn ví từ cache: không gọi danh sách ví (tốn RPC) mỗi lần focus.
      timer = window.setTimeout(() => void refreshWalletState({ refresh: false }), 400);
    };
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [currentUser?.id, refreshWalletState]);

  // Ví vừa được thêm/đổi ở "Trung tâm ví" → cập nhật badge ngay (WALLET-03).
  useEffect(() => {
    if (!currentUser?.id) return;
    const onWalletChanged = () => void refreshWalletState({ refresh: true });
    window.addEventListener(WALLET_CHANGED_EVENT, onWalletChanged);
    return () => window.removeEventListener(WALLET_CHANGED_EVENT, onWalletChanged);
  }, [currentUser?.id, refreshWalletState]);

  // Nhãn "đã lưu / chưa lưu" (CHAIN-08). Chỉ đọc dữ liệu có sẵn trong máy nên cập nhật định kỳ
  // không tốn mạng; nhờ vậy người dùng biết dữ liệu đã lên hệ thống lưu trữ chưa thay vì bấm
  // "Đồng bộ dữ liệu" nhiều lần.
  useEffect(() => {
    if (!currentUser?.id) return;
    const update = () => setSyncStatus(getDAppSyncStatus());
    update();
    const timer = window.setInterval(update, 5_000);
    window.addEventListener(WALLET_CHANGED_EVENT, update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(WALLET_CHANGED_EVENT, update);
    };
  }, [currentUser?.id]);

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      setSyncStage("Đang kiểm tra ví…");
      await ensureFiaiFramesReady();

      const state = await loadSigningWalletState();
      setWalletState(state);
      if (!state.ready || !state.address) {
        openWalletCenter(state.code === "VAULT_EMPTY" ? "import" : "select");
        throw new VaultSigningError(state.code ?? "VAULT_EMPTY", state.message ?? "Chưa có ví hợp lệ.");
      }

      setSyncStage("Đang lưu dữ liệu…");
      // Lớp services đã tự chống gửi trùng và tự kiểm tra "giao dịch đã lên chưa"
      // trước khi thử lại, nên ở đây KHÔNG chạy lại toàn bộ quy trình khi lỗi.
      const result = await syncDAppDBToChain(state.address);

      setSyncStage("Đang hoàn tất…");
      let backfillSummary = "";
      let backfillHadFailures = false;
      if (isOnChainTaskSyncAvailable()) {
        const deletedIssueIds = new Set<string>(localDB._deleted_issue_ids || []);
        const issuesToBackfill = (localDB.issues || []).filter(
          (issue: { id?: string; is_draft?: boolean }) => issue?.id && !issue.is_draft && !deletedIssueIds.has(issue.id)
        );
        if (issuesToBackfill.length > 0) {
          const shouldBackfill = window.confirm(
            `Có ${issuesToBackfill.length} công việc có thể chưa được lưu trên hệ thống.\n` +
              "Lưu lại ngay? Mỗi công việc có thể cần bạn xác nhận bằng ví."
          );
          if (shouldBackfill) {
            const backfill = await backfillIssuesOnChain(issuesToBackfill, (note) => console.log(`[Sync] ${note}`));
            const unknownNote = backfill.unknown > 0 ? `, chưa kiểm tra được ${backfill.unknown}` : "";
            backfillHadFailures = backfill.failed > 0 || backfill.unknown > 0;
            backfillSummary =
              `\nCông việc: đã lưu ${backfill.created}, đã có sẵn ${backfill.skipped}` +
              `, chưa lưu được ${backfill.failed}${unknownNote}` +
              (backfill.aborted ? " (đã dừng vì lỗi liên tiếp)." : ".");
            if (backfill.errors.length > 0) {
              const names = backfill.errors
                .slice(0, 3)
                .map((item) => item.name)
                .join(", ");
              backfillSummary += `\nChưa lưu được: ${names}${backfill.errors.length > 3 ? "…" : ""}.`;
            }
          }
        }
      }

      if (!result.ok) {
        // Một phần dữ liệu chưa lên hệ thống → cảnh báo, KHÔNG báo thành công.
        const details = result.warnings.map((warning) => `• ${warning.message}`).join("\n");
        setToast({
          type: TOAST_TYPE.WARNING,
          title: "Mới lưu được một phần",
          message: `Dữ liệu trên máy đã an toàn, nhưng chưa gửi hết lên hệ thống:\n${details}${backfillSummary}`,
        });
        return;
      }

      if (backfillHadFailures) {
        setToast({
          type: TOAST_TYPE.WARNING,
          title: "Đã lưu, còn vài công việc chưa xong",
          message: `Dữ liệu chính đã được lưu.${backfillSummary}\nBạn có thể bấm “Đồng bộ dữ liệu” lại để lưu nốt.`,
        });
        return;
      }

      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: "Đã lưu xong",
        message: `Dữ liệu đã được lưu an toàn.${backfillSummary}`,
      });
    } catch (error) {
      console.error("[Sync] Đồng bộ thất bại:", error);
      if (/LỖI XUNG ĐỘT/.test(errorMessage(error))) {
        setToast({
          type: TOAST_TYPE.WARNING,
          title: "Dữ liệu trên máy và trên hệ thống khác nhau",
          message: "Hệ thống giữ lại bản cũ để tránh ghi đè. Hãy sao lưu phần đang làm trước khi tải lại trang.",
        });
      } else {
        const { title, message } = presentSyncError(error);
        setToast({ type: TOAST_TYPE.ERROR, title, message });
        if (isVaultSigningError(error)) {
          openWalletCenter(error.code === "VAULT_EMPTY" ? "import" : "select");
        }
      }
    } finally {
      setIsSyncing(false);
      // Đọc lại trạng thái lưu trữ để nhãn ở góc màn hình phản ánh kết quả vừa xong.
      setSyncStatus(getDAppSyncStatus());
      void refreshWalletState({ refresh: true });
    }
  };

  const isWalletReady = Boolean(walletState?.ready && walletState.address);
  const walletBadgeLabel = !walletState
    ? "Ví: đang kiểm tra…"
    : isWalletReady
      ? `Ví: ${shortenAddress(walletState.address, 4)}`
      : walletState.code === "VAULT_EMPTY"
        ? "Ví: chưa có ví"
        : walletState.code === "VAULT_UNAVAILABLE"
          ? "Ví: chưa kết nối"
          : "Ví: cần chọn lại";

  // Chưa đăng nhập thì không hiển thị nút đồng bộ (lỗi WALLET-05).
  if (!currentUser?.id) return null;

  return (
    <div className="fixed right-4 bottom-4 z-50 flex flex-col items-end gap-2">
      {syncStatus && (
        <span
          title={syncStatus.description}
          className="shadow-sm flex items-center gap-1.5 rounded-full border border-subtle bg-surface-1 px-2.5 py-1 text-11 font-medium text-secondary"
        >
          <span
            className={cn(
              "size-1.5 rounded-full",
              syncStatus.state === "synced"
                ? "bg-emerald-500"
                : syncStatus.state === "pending"
                  ? "bg-amber-500"
                  : syncStatus.state === "unsynced"
                    ? "bg-red-500"
                    : "bg-gray-400"
            )}
          />
          {syncStatus.label}
        </span>
      )}

      <button
        type="button"
        onClick={() => {
          void refreshWalletState({ refresh: true });
          openWalletCenter(isWalletReady ? "diagnose" : walletState?.code === "VAULT_EMPTY" ? "import" : "select");
        }}
        className={cn(
          "shadow-sm flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-11 font-medium transition-colors",
          isWalletReady
            ? "border-subtle bg-surface-1 text-secondary hover:bg-layer-1"
            : "border-danger-subtle bg-danger-subtle text-danger-primary"
        )}
        title={walletState?.message ?? "Mở Trung tâm ví"}
      >
        <Wallet className="size-3" strokeWidth={2} />
        {walletBadgeLabel}
      </button>

      <button
        onClick={handleSync}
        disabled={isSyncing}
        title="Lưu dữ liệu của bạn lên hệ thống lưu trữ an toàn"
        className={`shadow-lg rounded px-4 py-2 font-medium text-white transition-colors ${
          isSyncing ? "bg-gray-500 cursor-not-allowed opacity-75" : "bg-blue-600 hover:bg-blue-700 cursor-pointer"
        }`}
        style={{
          boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)",
        }}
      >
        {isSyncing ? (
          <span className="flex items-center gap-2">
            <svg
              className="h-4 w-4 animate-spin text-white"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            {syncStage || "Đang xử lý…"}
          </span>
        ) : (
          "Đồng bộ dữ liệu"
        )}
      </button>
    </div>
  );
}
