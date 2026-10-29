import { useEffect, useRef, useState } from "react";
import { Dialog } from "@headlessui/react";
import type { IWorkspaceWalletMemberInput, IWorkspaceWalletMemberResult } from "@plane/types";
import { Button } from "@plane/propel/button";
import { CustomSelect, Input, ModalCore, EModalPosition, EModalWidth } from "@plane/ui";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: IWorkspaceWalletMemberInput) => Promise<IWorkspaceWalletMemberResult>;
};

export function AddWalletMemberModal({ isOpen, onClose, onSubmit }: Props) {
  const [wallet, setWallet] = useState("");
  const [role, setRole] = useState<15 | 20>(15);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const [retryReviewed, setRetryReviewed] = useState(false);
  const submitting = useRef(false);
  useEffect(() => {
    if (isOpen) {
      setWallet("");
      setRole(15);
      setError("");
      setChecking(false);
      setRetryReviewed(false);
    }
  }, [isOpen]);
  const close = () => {
    if (!submitting.current) onClose();
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting.current) return;
    const address = wallet.trim();
    if (!/^0x[a-f0-9]{40}$/i.test(address) || /^0x0{40}$/i.test(address)) {
      setError("Nhập địa chỉ ví công khai hợp lệ, bắt đầu bằng 0x và đủ 40 ký tự phía sau.");
      return;
    }
    submitting.current = true;
    setPending(true);
    setError("");
    try {
      const result = await onSubmit({
        wallet_address: address,
        role,
        ...(retryReviewed ? { retry_after_review: true } : {}),
      });
      if (!result?.chain_confirmed)
        throw new Error("Chưa xác nhận được quyền trên chain. Hãy kiểm tra lịch sử ví trước khi thử lại.");
      onClose();
    } catch (cause) {
      const message = cause as { error?: string; message?: string; code?: string };
      setChecking(message?.code === "MEMBERSHIP_PENDING");
      setRetryReviewed(false);
      setError(
        message?.error || message?.message || "Chưa thêm được thành viên. Địa chỉ ví vẫn được giữ để bạn kiểm tra lại."
      );
    } finally {
      submitting.current = false;
      setPending(false);
    }
  };
  return (
    <ModalCore isOpen={isOpen} handleClose={close} position={EModalPosition.TOP} width={EModalWidth.XL}>
      <form onSubmit={submit} className="space-y-4 p-5">
        <Dialog.Title as="h3" className="text-body-md-medium text-primary">
          Thêm thành viên bằng ví
        </Dialog.Title>
        <p className="text-body-xs-regular text-secondary">
          Cấp quyền trực tiếp cho ví này. Thành viên dùng đúng ví để mở workspace sau khi giao dịch được xác nhận.
        </p>
        <div className="space-y-2">
          <label htmlFor="workspace-member-wallet" className="text-body-xs-medium text-primary">
            Địa chỉ ví công khai
          </label>
          <Input
            id="workspace-member-wallet"
            name="wallet_address"
            value={wallet}
            onChange={(event) => {
              setWallet(event.target.value);
              setChecking(false);
              setRetryReviewed(false);
            }}
            placeholder="0x…"
            disabled={pending}
            autoComplete="off"
            className="font-mono w-full"
            hasError={!!error}
          />
        </div>
        <div className="space-y-2">
          <span className="block text-body-xs-medium text-primary">Quyền</span>
          <CustomSelect
            value={role}
            onChange={(value: 15 | 20) => setRole(value)}
            label={role === 20 ? "Admin" : "Member"}
            disabled={pending}
          >
            <CustomSelect.Option value={15}>Member</CustomSelect.Option>
            <CustomSelect.Option value={20}>Admin</CustomSelect.Option>
          </CustomSelect>
          {role === 20 && (
            <p className="text-caption-sm-regular text-secondary">
              Admin có quyền quản lý thành viên và workspace. Hãy kiểm tra kỹ địa chỉ ví trước khi cấp quyền.
            </p>
          )}
        </div>
        {error && (
          <p role="alert" className="text-body-xs-regular break-words text-danger-primary">
            {error}
          </p>
        )}
        {checking && (
          <label className="flex items-start gap-2 text-caption-sm-regular text-secondary">
            <input
              type="checkbox"
              checked={retryReviewed}
              disabled={pending}
              onChange={(event) => setRetryReviewed(event.target.checked)}
            />
            Tôi đã kiểm tra lịch sử ví: giao dịch cũ thất bại hoặc chưa được gửi. Cho phép gửi lại.
          </label>
        )}
        {pending && (
          <p role="status" className="text-body-xs-regular text-secondary">
            Đang chờ ví quản trị và xác nhận quyền thành viên…
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="lg" type="button" onClick={close} disabled={pending}>
            Hủy
          </Button>
          <Button variant="primary" size="lg" type="submit" disabled={pending || !wallet.trim()} loading={pending}>
            {pending ? "Đang xác nhận…" : checking && !retryReviewed ? "Kiểm tra quyền" : "Thêm thành viên"}
          </Button>
        </div>
      </form>
    </ModalCore>
  );
}
