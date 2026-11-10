import { useRef, useState } from "react";
import { Button } from "@plane/propel/button";
import { EModalPosition, EModalWidth, ModalCore } from "@plane/ui";

type Props = {
  email: string;
  initialWallet?: string;
  onClose: () => void;
  onSubmit: (wallet: string) => Promise<void>;
};

export function ApproveInvitationWallet({ email, initialWallet = "", onClose, onSubmit }: Props) {
  const [wallet, setWallet] = useState(initialWallet);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState("");
  const valid = /^0x[a-f0-9]{40}$/i.test(wallet.trim()) && !/^0x0{40}$/i.test(wallet.trim());
  const submit = async () => {
    if (!valid || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await onSubmit(wallet.trim());
      onClose();
    } catch (failure) {
      setError(
        (failure as { error?: string; message?: string })?.error ||
          (failure as Error)?.message ||
          "Chưa xác nhận được ví. Hãy thử lại."
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  return (
    <ModalCore
      isOpen
      handleClose={() => {
        if (!busyRef.current) onClose();
      }}
      position={EModalPosition.CENTER}
      width={EModalWidth.XXL}
    >
      <form
        className="space-y-4 p-6"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <h3 className="text-h5-medium">Xác nhận ví người nhận lời mời</h3>
        <p className="break-all">Người nhận: {email}</p>
        <p className="text-body-sm-regular text-secondary">
          Xác minh địa chỉ này với người nhận trước khi ký. Lần xác nhận ví đầu tiên giữ nguyên link email còn hạn; đổi
          ví hoặc quyền sẽ tạo link mới.
        </p>
        <label className="block space-y-2">
          <span>Địa chỉ ví người nhận</span>
          <input
            value={wallet}
            disabled={busy}
            onChange={(event) => setWallet(event.target.value)}
            placeholder="0x…"
            autoComplete="off"
            spellCheck={false}
            required
            className="w-full rounded border border-subtle bg-transparent px-3 py-2 text-body-sm-regular"
          />
        </label>
        {error && (
          <p role="alert" className="text-danger-primary">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
            Hủy
          </Button>
          <Button type="submit" disabled={!valid || busy}>
            {busy ? "Đang ký và công bố…" : "Xác nhận và công bố"}
          </Button>
        </div>
      </form>
    </ModalCore>
  );
}
