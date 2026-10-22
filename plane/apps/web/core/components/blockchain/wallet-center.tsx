/**
 * Trung tâm ví — nơi người dùng cấu hình đúng Crypto Vault mà Plane dùng để ký.
 *
 * Trước đây Plane không có UI nào cho ví: nếu Vault rỗng (ví nằm ở Vault khác origin) thì nút
 * "Sync to Chain" quay 60s rồi báo lỗi chung chung. Component này cho phép:
 * - Xem trạng thái Vault (URL, đã thiết lập bảo mật chưa, đang khoá hay không, có bao nhiêu ví).
 * - Import private key vào CHÍNH Vault đó (Vault tự bật overlay đặt/mở mật khẩu).
 * - Mở khoá Vault, chọn ví active, chép địa chỉ, chẩn đoán khi ví không khớp.
 */
import { useCallback, useEffect, useState } from "react";
import { Check, Copy, KeyRound, RefreshCw, ShieldCheck, ShieldAlert, Wallet } from "lucide-react";
// ui
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { EModalPosition, EModalWidth, ModalCore } from "@plane/ui";
import { cn } from "@plane/utils";
// services
import { openMetanodeWallet } from "@/services/blockchain/metanode-wallet.service";
import {
  importPrivateKeyToVault,
  loadSigningWalletState,
  selectVaultWallet,
  shortenAddress,
  unlockVault,
  WALLET_CENTER_EVENT,
  type SigningWalletState,
  type WalletCenterMode,
} from "@/services/blockchain/wallet-vault.service";

type BusyState = "unlock" | "import" | `select:${string}` | null;

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error ?? "Lỗi không xác định");
}

function formatAuthMode(mode?: string): string {
  if (mode === "password") return "Mật khẩu";
  if (mode === "biometric") return "Sinh trắc học";
  if (mode === "none") return "Chưa thiết lập";
  return "Không rõ";
}

const ERROR_TITLES: Record<string, string> = {
  VAULT_UNAVAILABLE: "Crypto Vault không phản hồi",
  VAULT_EMPTY: "Crypto Vault chưa có ví",
  WALLET_NOT_IN_VAULT: "Ví đang dùng không có trong Crypto Vault",
};

export function WalletCenter() {
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<WalletCenterMode>("diagnose");
  const [state, setState] = useState<SigningWalletState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [busy, setBusy] = useState<BusyState>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [privateKey, setPrivateKey] = useState("");
  const [walletName, setWalletName] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const next = await loadSigningWalletState();
      setState(next);
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const handleOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ mode?: WalletCenterMode }>).detail;
      setMode(detail?.mode ?? "diagnose");
      setActionError(null);
      setIsOpen(true);
    };
    window.addEventListener(WALLET_CENTER_EVENT, handleOpen);
    return () => window.removeEventListener(WALLET_CENTER_EVENT, handleOpen);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    void refresh();
    const handleFocus = () => void refresh();
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [isOpen, refresh]);

  const handleClose = () => {
    setIsOpen(false);
    setPrivateKey("");
    setWalletName("");
    setShowKey(false);
    setActionError(null);
  };

  const handleCopy = async (address: string) => {
    try {
      await navigator.clipboard.writeText(address);
      setCopiedAddress(address);
      window.setTimeout(() => setCopiedAddress(null), 1500);
    } catch {
      setActionError("Trình duyệt chặn clipboard — hãy copy địa chỉ bằng tay.");
    }
  };

  const handleSelect = async (address: string) => {
    setBusy(`select:${address}`);
    setActionError(null);
    try {
      await selectVaultWallet(address);
      await refresh();
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: "Đã chọn ví để ký",
        message: `${shortenAddress(address)} sẽ được dùng cho các giao dịch on-chain của bạn.`,
      });
      setMode("diagnose");
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const handleImport = async () => {
    setBusy("import");
    setActionError(null);
    try {
      const address = await importPrivateKeyToVault(privateKey, walletName);
      setPrivateKey("");
      setWalletName("");
      await selectVaultWallet(address);
      await refresh();
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: "Đã nạp ví vào Crypto Vault",
        message: `${shortenAddress(address)} đã sẵn sàng ký giao dịch.`,
      });
      setMode("diagnose");
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const handleUnlock = async () => {
    setBusy("unlock");
    setActionError(null);
    try {
      await unlockVault(state?.address);
      await refresh();
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: "Crypto Vault đã mở khoá",
        message: "Phiên ký trong tab này đã sẵn sàng.",
      });
    } catch (error) {
      const message = errorMessage(error);
      setActionError(/UNLOCK_CANCELLED/i.test(message) ? "Bạn đã đóng hộp thoại mật khẩu của Crypto Vault." : message);
    } finally {
      setBusy(null);
    }
  };

  const handleOpenMetaNodeWallet = async () => {
    setActionError(null);
    try {
      await openMetanodeWallet();
    } catch (error) {
      setActionError(
        `${errorMessage(error)}\nKhông mở được MetaNode Wallet — hãy import private key trực tiếp bên dưới.`
      );
    }
  };

  const snapshot = state?.snapshot ?? null;
  const wallets = snapshot?.wallets ?? [];
  const activeAddress = state?.address ?? null;
  const dappActiveAddress = snapshot?.dappActiveAddress ?? null;
  const isVaultReachable = snapshot?.reachable ?? false;
  const vaultStatusText = !isVaultReachable ? "Không phản hồi" : snapshot?.isLocked ? "Đang khoá" : "Đã mở khoá";
  const authModeText = formatAuthMode(snapshot?.authMode);
  const showMessage = actionError ?? (state?.ready ? null : state?.message);
  const showImportForm = mode === "import" || (isVaultReachable && wallets.length === 0);

  return (
    <ModalCore isOpen={isOpen} handleClose={handleClose} position={EModalPosition.CENTER} width={EModalWidth.XXL}>
      <div className="flex max-h-[82vh] flex-col">
        <div className="flex items-start justify-between gap-4 border-b border-subtle px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent-subtle text-accent-primary">
              <Wallet className="size-5" strokeWidth={1.75} />
            </div>
            <div>
              <h3 className="text-16 font-medium text-primary">Trung tâm ví</h3>
              <p className="text-12 text-tertiary">
                Plane ký giao dịch bằng Crypto Vault bên dưới — ví phải nằm đúng Vault này.
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="base"
            onClick={() => void refresh()}
            disabled={isLoading}
            prependIcon={<RefreshCw className={cn("size-3.5", isLoading && "animate-spin")} />}
          >
            Làm mới
          </Button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="min-w-0 rounded-lg border border-subtle bg-layer-1 px-3 py-2.5">
              <p className="text-11 text-tertiary">Crypto Vault</p>
              <p
                className="mt-1 truncate text-12 font-medium text-primary"
                title={snapshot?.vaultUrl || "Chưa cấu hình"}
              >
                {snapshot?.vaultUrl || "Chưa cấu hình"}
              </p>
              <p
                className={cn(
                  "mt-1 flex items-center gap-1 text-11",
                  isVaultReachable ? "text-success-primary" : "text-danger-primary"
                )}
              >
                <span
                  className={cn("size-1.5 rounded-full", isVaultReachable ? "bg-success-primary" : "bg-danger-primary")}
                />
                {isVaultReachable ? "Đã kết nối" : "Không phản hồi"}
              </p>
            </div>
            <div className="min-w-0 rounded-lg border border-subtle bg-layer-1 px-3 py-2.5">
              <p className="text-11 text-tertiary">Bảo mật Vault</p>
              <p className="mt-1 truncate text-12 font-medium text-primary">{authModeText}</p>
              <p className={cn("mt-1 text-11", snapshot?.isLocked ? "text-warning-primary" : "text-success-primary")}>
                {vaultStatusText}
              </p>
            </div>
            <div className="min-w-0 rounded-lg border border-subtle bg-layer-1 px-3 py-2.5">
              <p className="text-11 text-tertiary">Ví dùng để ký</p>
              <p className="font-mono mt-1 truncate text-12 font-medium text-primary">
                {activeAddress ? shortenAddress(activeAddress, 8) : "Chưa có"}
              </p>
              <p className="mt-1 text-11 text-tertiary">{wallets.length} ví trong Vault</p>
            </div>
          </div>

          {showMessage ? (
            <div className="flex items-start gap-2 rounded-lg bg-danger-subtle px-3 py-2.5 text-12 whitespace-pre-line text-danger-primary">
              <ShieldAlert className="mt-0.5 size-4 shrink-0" strokeWidth={2} />
              <div className="space-y-1">
                <p className="font-medium">{state?.code ? ERROR_TITLES[state.code] : "Không thể dùng ví này"}</p>
                <p>{showMessage}</p>
              </div>
            </div>
          ) : null}

          {state?.ready ? (
            <div className="flex items-center gap-2 rounded-lg bg-success-subtle px-3 py-2 text-12 text-success-primary">
              <ShieldCheck className="size-4 shrink-0" strokeWidth={2} />
              Ví đã sẵn sàng ký giao dịch on-chain.
            </div>
          ) : null}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-12 font-medium text-primary">Ví trong Crypto Vault ({wallets.length})</p>
              <Button variant="link" size="base" onClick={() => void handleOpenMetaNodeWallet()}>
                Mở MetaNode Wallet
              </Button>
            </div>

            {wallets.length === 0 ? (
              <div className="rounded-lg border border-dashed border-subtle px-3 py-6 text-center">
                <p className="text-12 text-secondary">Vault này chưa có ví nào.</p>
                <p className="mt-1 text-11 text-tertiary">
                  Import private key bên dưới — khóa chỉ đi trực tiếp vào Crypto Vault, Plane không lưu.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-subtle overflow-hidden rounded-lg border border-subtle">
                {wallets.map((wallet) => {
                  const isActive = activeAddress?.toLowerCase() === wallet.address;
                  const isDappActive = dappActiveAddress?.toLowerCase() === wallet.address;
                  return (
                    <li
                      key={wallet.address}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2.5",
                        isActive ? "bg-success-subtle" : "bg-surface-1"
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="truncate text-12 font-medium text-primary">
                            {wallet.name || "Ví không tên"}
                          </span>
                          {isActive ? (
                            <span className="rounded bg-success-subtle px-1.5 py-0.5 text-10 font-medium text-success-primary">
                              Đang dùng
                            </span>
                          ) : null}
                          {isDappActive && !isActive ? (
                            <span className="rounded bg-layer-1 px-1.5 py-0.5 text-10 text-tertiary">
                              Active trong Vault
                            </span>
                          ) : null}
                        </div>
                        <p className="font-mono truncate text-11 text-tertiary">{wallet.address}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleCopy(wallet.address)}
                        className="grid size-6 shrink-0 place-items-center rounded text-tertiary hover:bg-layer-1-hover"
                        title="Chép địa chỉ"
                      >
                        {copiedAddress === wallet.address ? (
                          <Check className="size-3.5 text-success-primary" />
                        ) : (
                          <Copy className="size-3.5" />
                        )}
                      </button>
                      <Button
                        size="sm"
                        variant={isActive ? "secondary" : "primary"}
                        onClick={() => void handleSelect(wallet.address)}
                        loading={busy === `select:${wallet.address}`}
                        disabled={isActive}
                      >
                        {isActive ? "Đang dùng" : "Dùng ví này"}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          {showImportForm ? (
            <div className="space-y-2 rounded-lg border border-subtle bg-layer-1 px-3 py-3">
              <p className="text-12 font-medium text-primary">Import private key vào Crypto Vault này</p>
              <input
                value={walletName}
                onChange={(event) => setWalletName(event.target.value)}
                placeholder="Tên ví (không bắt buộc)"
                className="w-full rounded-md border border-subtle bg-surface-1 px-2.5 py-2 text-12 text-primary outline-none focus:border-accent-strong"
              />
              <div className="relative">
                <input
                  type={showKey ? "text" : "password"}
                  value={privateKey}
                  onChange={(event) => setPrivateKey(event.target.value)}
                  placeholder="0x… (64 ký tự hex)"
                  spellCheck={false}
                  autoComplete="off"
                  className="font-mono w-full rounded-md border border-subtle bg-surface-1 px-2.5 py-2 pr-14 text-12 text-primary outline-none focus:border-accent-strong"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((value) => !value)}
                  className="absolute top-1/2 right-2 -translate-y-1/2 text-11 text-tertiary hover:text-primary"
                >
                  {showKey ? "Ẩn" : "Hiện"}
                </button>
              </div>
              <p className="text-11 text-tertiary">
                Private key chỉ được gửi trực tiếp vào Crypto Vault (không lưu ở Plane, không ghi log). Lần đầu Vault sẽ
                yêu cầu đặt mật khẩu — hộp thoại hiện ở giữa màn hình.
              </p>
              <div className="flex justify-end gap-2">
                <Button
                  variant="secondary"
                  size="base"
                  onClick={() => setMode("diagnose")}
                  disabled={busy === "import"}
                >
                  Huỷ
                </Button>
                <Button
                  variant="primary"
                  size="base"
                  onClick={() => void handleImport()}
                  loading={busy === "import"}
                  disabled={!privateKey.trim()}
                >
                  Import ví
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="secondary"
              size="base"
              prependIcon={<KeyRound className="size-3.5" />}
              onClick={() => setMode("import")}
            >
              Import private key vào Vault này
            </Button>
          )}
        </div>

        <div className="flex flex-col gap-2 border-t border-subtle px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-11 text-tertiary">
            Nếu ví của bạn nằm ở MetaNode Wallet khác, hãy import private key vào Vault này để Plane ký được.
          </p>
          <div className="flex shrink-0 justify-end gap-2">
            <Button
              variant="secondary"
              size="base"
              onClick={() => void handleUnlock()}
              loading={busy === "unlock"}
              disabled={wallets.length === 0}
              prependIcon={<ShieldCheck className="size-3.5" />}
            >
              Mở khoá Vault
            </Button>
            <Button variant="primary" size="base" onClick={handleClose}>
              Đóng
            </Button>
          </div>
        </div>
      </div>
    </ModalCore>
  );
}
