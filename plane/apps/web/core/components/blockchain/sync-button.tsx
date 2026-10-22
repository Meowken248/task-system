import { useCallback, useEffect, useState } from "react";
import { Wallet } from "lucide-react";
import { localDB, syncDAppDBToChain, isVaultSigningError, VaultSigningError } from "@plane/services";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { cn } from "@plane/utils";

import { ensureFiaiFramesReady, resetFiaiSDK } from "../../services/blockchain/fiai-sdk.service";
import {
  loadSigningWalletState,
  openWalletCenter,
  shortenAddress,
  type SigningWalletState,
} from "../../services/blockchain/wallet-vault.service";
import { backfillIssuesOnChain, isOnChainTaskSyncAvailable } from "../../services/blockchain/plane-task-chain.service";

const SIGN_NONCE_ERROR_RE = /invalid sign|invalid nonce|nonce too low|nonce has already been used|nonce conflict/i;

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error ?? "Lỗi không xác định");
}

/** Biến lỗi ví/ký thành thông báo có tiêu đề + hướng khắc phục cụ thể. */
function presentSyncError(error: unknown): { title: string; message: string } {
  const message = errorMessage(error);

  if (isVaultSigningError(error)) {
    if (error.code === "VAULT_EMPTY") {
      return {
        title: "Crypto Vault chưa có ví",
        message:
          `${message}\n\n` +
          'Bấm "Trung tâm ví" → import private key vào đúng Crypto Vault mà Plane đang dùng ' +
          "(khóa chỉ đi vào Vault, Plane không lưu), rồi bấm Sync to Chain lại.",
      };
    }
    if (error.code === "WALLET_NOT_IN_VAULT") {
      return {
        title: "Ví chưa khớp với Crypto Vault",
        message: `${message}\n\nMở "Trung tâm ví" → chọn ví đang có trong Vault (hoặc import ví của bạn) rồi Sync lại.`,
      };
    }
    return {
      title: "Crypto Vault không phản hồi",
      message:
        `${message}\n\n` +
        "Kiểm tra blockchain-bridge (:6001) và crypto-vault (:6002) đang chạy, sau đó tải lại trang.",
    };
  }

  if (/UNLOCK_CANCELLED|đóng hộp thoại mở khoá/i.test(message)) {
    return {
      title: "Chưa mở khoá Crypto Vault",
      message: `${message}\n\nBấm Sync to Chain và nhập mật khẩu khi hộp thoại Crypto Vault hiện ra.`,
    };
  }
  if (/wallet not found/i.test(message)) {
    return {
      title: "Ví không có trong Crypto Vault",
      message:
        `${message}\n\n` +
        "Ví Plane đang dùng không tồn tại trong Crypto Vault nên Vault không ký được. " +
        'Mở "Trung tâm ví" để chọn/import đúng ví rồi Sync lại.',
    };
  }
  if (/MetaNode frame chưa sẵn sàng/i.test(message)) {
    return {
      title: "MetaNode frame chưa sẵn sàng",
      message: `${message}\n\nKhởi động lại blockchain-bridge (:6001) + crypto-vault (:6002) rồi tải lại trang.`,
    };
  }
  if (/Ví không phản hồi|Crypto Vault đang khoá/i.test(message)) {
    return {
      title: "Ví không phản hồi",
      message: `${message}\n\nMở "Trung tâm ví" → "Mở khoá Vault" rồi bấm Sync lại.`,
    };
  }
  return { title: "Đồng bộ thất bại", message };
}

export function SyncToChainButton() {
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStage, setSyncStage] = useState<string>("Đang đồng bộ...");
  const [walletState, setWalletState] = useState<SigningWalletState | null>(null);

  const refreshWalletState = useCallback(async (options?: { refresh?: boolean }) => {
    try {
      setWalletState(await loadSigningWalletState(options));
    } catch (error) {
      console.warn("[Sync] Không đọc được trạng thái Crypto Vault:", error);
    }
  }, []);

  useEffect(() => {
    // Không chặn render: kiểm tra ví sau khi trang đã tải xong, và mỗi lần tab được focus lại.
    // Dùng cache để không gọi `getAllWallets` (có RPC balance) mỗi lần đổi tab.
    const timer = window.setTimeout(() => void refreshWalletState({ refresh: false }), 4000);
    const onFocus = () => void refreshWalletState({ refresh: false });
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refreshWalletState]);

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      // 1. Bảo đảm bridge (6001) + Crypto Vault (6002) đã handshake xong trước khi ký.
      setSyncStage("1/4: Kiểm tra cầu nối SDK...");
      await ensureFiaiFramesReady();

      // 2. Preflight: ví phải tồn tại THẬT trong Crypto Vault mà Plane đang dùng.
      setSyncStage("2/4: Đối chiếu ví với Crypto Vault...");
      const state = await loadSigningWalletState();
      setWalletState(state);
      if (!state.ready || !state.address) {
        openWalletCenter(state.code === "VAULT_EMPTY" ? "import" : "select");
        throw new VaultSigningError(
          state.code ?? "VAULT_EMPTY",
          state.message ?? "Chưa có ví hợp lệ trong Crypto Vault."
        );
      }

      // 3. Gửi transaction (kèm retry khi lỗi chữ ký/nonce do bridge cache).
      setSyncStage("3/4: Ký giao dịch on-chain...");
      try {
        await syncDAppDBToChain(state.address);
      } catch (sendError) {
        const message = errorMessage(sendError);
        if (!SIGN_NONCE_ERROR_RE.test(message)) throw sendError;

        console.warn("[Sync] Phát hiện lỗi chữ ký/nonce, đang reset SDK và thử lại...", message);
        setSyncStage("3/4: Ký lại giao dịch...");
        await resetFiaiSDK();
        const refreshed = await loadSigningWalletState();
        setWalletState(refreshed);
        if (!refreshed.ready || !refreshed.address) {
          throw new VaultSigningError(
            refreshed.code ?? "VAULT_EMPTY",
            refreshed.message ?? "Chưa có ví hợp lệ trong Crypto Vault."
          );
        }
        await syncDAppDBToChain(refreshed.address);
      }

      // 4. Tạo lại (backfill) các task chưa tồn tại on-chain.
      setSyncStage("4/4: Tạo task còn thiếu on-chain...");
      let backfillSummary = "";
      if (isOnChainTaskSyncAvailable()) {
        const deletedIssueIds = new Set<string>(localDB._deleted_issue_ids || []);
        const issuesToBackfill = (localDB.issues || []).filter(
          (issue: { id?: string; is_draft?: boolean }) => issue?.id && !issue.is_draft && !deletedIssueIds.has(issue.id)
        );
        if (issuesToBackfill.length > 0) {
          const shouldBackfill = window.confirm(
            `Có ${issuesToBackfill.length} công việc có thể chưa được ghi on-chain.\n` +
              "Tạo lại trên blockchain ngay? Mỗi công việc có thể cần một lần xác nhận ký ví."
          );
          if (shouldBackfill) {
            const result = await backfillIssuesOnChain(issuesToBackfill, (message) => console.log(`[Sync] ${message}`));
            backfillSummary =
              `\nTask on-chain: tạo mới ${result.created}, đã có sẵn ${result.skipped}, lỗi ${result.failed}` +
              (result.aborted ? " (đã dừng sớm do lỗi liên tiếp)" : "");
          }
        }
      }

      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: "Đồng bộ on-chain thành công",
        message: `Dữ liệu đã được ghi lên blockchain.${backfillSummary}`,
      });
    } catch (error) {
      console.error("[Sync] Đồng bộ on-chain thất bại:", error);
      if (/LỖI XUNG ĐỘT/.test(errorMessage(error))) {
        setToast({
          type: TOAST_TYPE.WARNING,
          title: "Xung đột dữ liệu on-chain",
          message: `${errorMessage(error)}\n\nHãy sao lưu thủ công phần việc đang làm trước khi F5!`,
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
      void refreshWalletState();
    }
  };

  const isWalletReady = Boolean(walletState?.ready && walletState.address);
  const walletBadgeLabel = !walletState
    ? "Ví: đang kiểm tra…"
    : isWalletReady
      ? `Ví: ${shortenAddress(walletState.address, 4)}`
      : walletState.code === "VAULT_EMPTY"
        ? "Ví: Vault chưa có ví"
        : walletState.code === "VAULT_UNAVAILABLE"
          ? "Ví: Vault không phản hồi"
          : "Ví: cần chọn lại";

  return (
    <div className="fixed right-4 bottom-4 z-50 flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={() => {
          void refreshWalletState();
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
            {syncStage || "Đang xử lý..."}
          </span>
        ) : (
          "Sync to Chain"
        )}
      </button>
    </div>
  );
}
