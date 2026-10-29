import { useState } from "react";
import type { IWorkspaceWalletMemberInput } from "@plane/types";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { WorkspaceService } from "@/services/workspace.service";
import { AddWalletMemberModal } from "./add-wallet-member-modal";

const service = new WorkspaceService();
export function WalletTeamSetup({
  workspaceSlug,
  onComplete,
}: {
  workspaceSlug?: string;
  onComplete: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [added, setAdded] = useState(0);
  const add = async (input: IWorkspaceWalletMemberInput) => {
    if (!workspaceSlug) throw new Error("Workspace chưa sẵn sàng. Hãy thử lại sau khi tạo workspace hoàn tất.");
    const result = await service.addWalletMember(workspaceSlug, input);
    if (!result?.chain_confirmed) throw new Error("Chưa xác nhận được quyền thành viên.");
    if (!result.already_member) setAdded((value) => value + 1);
    setToast({
      type: TOAST_TYPE.SUCCESS,
      title: result.already_member ? "Ví đã là thành viên" : "Đã thêm thành viên",
      message: "Thành viên dùng đúng ví đã được cấp quyền để mở workspace.",
    });
    return result;
  };
  const finish = async () => {
    if (finishing) return;
    setFinishing(true);
    try {
      await onComplete();
    } catch {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Chưa hoàn tất thiết lập",
        message: "Các quyền đã cấp vẫn được giữ. Bạn có thể thử tiếp tục lại.",
      });
    } finally {
      setFinishing(false);
    }
  };
  return (
    <section className="mx-auto flex w-full max-w-xl flex-col gap-5 p-6">
      <h3 className="text-h3-medium text-primary">Thêm thành viên bằng ví</h3>
      <p className="text-body-xs-regular text-secondary">
        Lấy địa chỉ ví công khai của người cần thêm, chọn quyền và xác nhận bằng ví quản trị. Người đó có thể mở
        workspace ngay khi quyền được xác nhận.
      </p>
      {added > 0 && (
        <p role="status" className="text-body-xs-regular text-secondary">
          Đã thêm {added} thành viên trong bước này.
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <Button variant="primary" size="lg" disabled={!workspaceSlug || finishing} onClick={() => setOpen(true)}>
          Thêm bằng ví
        </Button>
        <Button variant="secondary" size="lg" loading={finishing} disabled={finishing} onClick={() => void finish()}>
          {added ? "Hoàn tất" : "Để sau"}
        </Button>
      </div>
      <p className="text-caption-sm-regular text-secondary">Bạn có thể thêm người sau tại Settings → Members.</p>
      <AddWalletMemberModal isOpen={open} onClose={() => setOpen(false)} onSubmit={add} />
    </section>
  );
}
