/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { useRef, useState } from "react";
import { observer } from "mobx-react";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { Button } from "@plane/propel/button";
import { setLoggedInUser } from "@plane/services";
import { copyTextToClipboard } from "@plane/utils";
import { LogoSpinner } from "@/components/common/logo-spinner";
import { WORKSPACE_INVITATION } from "@/constants/fetch-keys";
import { EPageTypes } from "@/helpers/authentication.helper";
import { getInvitationReturnPath } from "@/helpers/invitation-navigation";
import { useUser } from "@/hooks/store/user";
import { AuthenticationWrapper } from "@/lib/wrappers/authentication-wrapper";
import { WorkspaceService } from "@/services/workspace.service";
import { resolveMetanodeWalletAddress } from "@/services/blockchain/metanode-wallet.service";

const workspaceService = new WorkspaceService();
const errorMessage = (error: unknown) => {
  const failure = error as { error?: string; message?: string };
  return failure?.error || failure?.message || "Chưa hoàn tất thao tác. Hãy thử lại.";
};

function WorkspaceInvitationPage() {
  const searchParams = useSearchParams();
  const invitationId = searchParams.get("invitation_id");
  const slug = searchParams.get("slug");
  const token = searchParams.get("token") || undefined;
  const { data: currentUser } = useUser();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [message, setMessage] = useState("");
  const [wallet, setWallet] = useState("");
  const [rejected, setRejected] = useState(false);
  const {
    data: invitation,
    error,
    isLoading,
    isValidating,
    mutate,
  } = useSWR(
    invitationId && slug
      ? [WORKSPACE_INVITATION(invitationId), slug, token, currentUser?.id, currentUser?.email]
      : null,
    () => workspaceService.getWorkspaceInvitation(slug!, invitationId!, token),
    { shouldRetryOnError: false, revalidateOnFocus: true }
  );
  const base = (process.env.VITE_ROUTER_BASENAME || "").replace(/\/+$/, "");
  const returnPath = getInvitationReturnPath(new URLSearchParams(searchParams.toString()));
  const authUrl = (signup = false) =>
    `${base}/${signup ? "sign-up" : ""}?${new URLSearchParams({
      ...(returnPath ? { next_path: returnPath } : {}),
      ...(invitation?.email && !/^0x[a-f0-9]{40}$/i.test(invitation.email) ? { email: invitation.email } : {}),
    })}`;
  const walletRecipient = /^0x[a-f0-9]{40}$/i.test(invitation?.email || "");
  const mismatch = Boolean(
    currentUser?.email &&
    invitation?.email &&
    !walletRecipient &&
    currentUser.email.toLowerCase().trim() !== invitation.email.toLowerCase().trim()
  );
  const approvalRequired = Boolean(invitation?.wallet_approval_required);
  const terminalCodes = new Set([
    "INVITATION_NOT_FOUND",
    "INVITATION_REVOKED",
    "INVITATION_EXPIRED",
    "MEMBER_REMOVED",
    "INVITATION_TOKEN_MISMATCH",
    "INVITATION_ROLE_INVALID",
  ]);
  const failureCode = (error as { code?: string })?.code;

  const switchAccount = () => {
    // Preserve offline edits, snapshots and CID caches when changing accounts.
    setLoggedInUser(null);
    window.location.assign(authUrl());
  };

  const respond = async (accepted: boolean) => {
    if (!invitation || !currentUser || mismatch || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setMessage("");
    try {
      const address = accepted ? await resolveMetanodeWalletAddress({ forceSelect: true }) : undefined;
      if (address) setWallet(address);
      if (accepted && approvalRequired) {
        setMessage(
          "Hãy gửi địa chỉ ví bên dưới cho quản trị viên. Sau khi được xác nhận, bấm Kiểm tra lại lời mời ngay tại đây."
        );
        return;
      }
      if (accepted && invitation.wallet_address?.toLowerCase() !== address?.toLowerCase()) {
        setMessage(
          `Ví đã chọn không khớp ví được mời: ${invitation.wallet_address}. Hãy chọn đúng ví hoặc liên hệ quản trị viên.`
        );
        return;
      }
      const result = await workspaceService.joinWorkspace(invitation.workspace.slug, invitation.id, {
        accepted,
        token,
        ...(address ? { wallet_address: address } : {}),
      });
      if (accepted && result.accepted && result.verified_on_chain)
        window.location.replace(`${base}/${encodeURIComponent(invitation.workspace.slug)}`);
      else if (!accepted) setRejected(true);
      else setMessage("Chưa xác nhận được quyền thành viên. Hãy kiểm tra lại lời mời.");
    } catch (failure) {
      setMessage(errorMessage(failure));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <AuthenticationWrapper pageType={EPageTypes.PUBLIC}>
      <div className="flex h-full min-h-screen w-full items-center justify-center px-4 py-12">
        <main
          className="w-full max-w-lg space-y-5 rounded-lg border border-subtle bg-surface-1 p-6"
          aria-busy={busy || isValidating}
        >
          <h1 className="text-h5-medium text-primary">Lời mời tham gia không gian làm việc</h1>
          {!invitationId || !slug ? (
            <p role="alert">Liên kết thiếu thông tin lời mời. Hãy mở đầy đủ liên kết trong email.</p>
          ) : isLoading ? (
            <div role="status" className="flex items-center gap-3">
              <LogoSpinner />
              <span>Đang kiểm tra lời mời…</span>
            </div>
          ) : error ? (
            <>
              <p role="alert">{errorMessage(error)}</p>
              <p className="text-body-sm-regular text-secondary">
                {terminalCodes.has(failureCode || "")
                  ? "Hãy liên hệ quản trị viên để kiểm tra hoặc gửi lại lời mời."
                  : "Chưa đọc được trạng thái lời mời. Kết nối có thể đang gián đoạn; bạn có thể thử lại tại đây."}
              </p>
              <Button variant="secondary" disabled={isValidating} onClick={() => void mutate()}>
                Thử lại
              </Button>
            </>
          ) : rejected ? (
            <p role="status">Bạn đã từ chối lời mời trên thiết bị này.</p>
          ) : invitation ? (
            <>
              <p>
                Bạn được mời tham gia <strong>{invitation.workspace.name}</strong>.
              </p>
              <p className="text-body-sm-regular break-all text-secondary">Người nhận: {invitation.email}</p>
              {!currentUser ? (
                <>
                  <p>Đăng nhập hoặc đăng ký bằng email nhận lời mời để tiếp tục.</p>
                  <div className="flex flex-wrap gap-3">
                    <Button onClick={() => window.location.assign(authUrl())}>Đăng nhập</Button>
                    <Button variant="secondary" onClick={() => window.location.assign(authUrl(true))}>
                      Đăng ký
                    </Button>
                  </div>
                </>
              ) : mismatch ? (
                <>
                  <p role="alert">
                    Bạn đang đăng nhập bằng {currentUser.email}. Hãy dùng tài khoản {invitation.email}.
                  </p>
                  <Button onClick={switchAccount}>Đổi tài khoản</Button>
                </>
              ) : invitation.accepted ? (
                <Button
                  onClick={() => window.location.replace(`${base}/${encodeURIComponent(invitation.workspace.slug)}`)}
                >
                  Mở không gian làm việc
                </Button>
              ) : (
                <>
                  {invitation.source_verified === false && (
                    <p role="status">
                      Đang hiển thị bản lưu trên máy. Khi tham gia, hệ thống sẽ kiểm tra lại trạng thái mới nhất.
                    </p>
                  )}
                  <p>
                    {approvalRequired
                      ? "Lời mời còn hiệu lực, đang chờ quản trị viên xác nhận ví của bạn. Chọn ví và gửi địa chỉ cho quản trị viên để được cấp quyền tham gia."
                      : "Chọn ví được mời và xác nhận giao dịch để tham gia."}
                  </p>
                  {invitation.wallet_address && (
                    <p className="text-body-sm-regular break-all">Ví được mời: {invitation.wallet_address}</p>
                  )}
                  <div className="flex flex-wrap gap-3">
                    <Button disabled={busy || isValidating} onClick={() => void respond(true)}>
                      {busy ? "Đang xử lý…" : approvalRequired ? "Chọn ví của tôi" : "Chấp nhận và xác nhận ví"}
                    </Button>
                    <Button variant="secondary" disabled={busy || isValidating} onClick={() => void mutate()}>
                      Kiểm tra lại lời mời
                    </Button>
                    <Button variant="secondary" disabled={busy || isValidating} onClick={() => void respond(false)}>
                      Từ chối
                    </Button>
                  </div>
                </>
              )}
            </>
          ) : (
            <p>Chưa đọc được lời mời. Hãy tải lại trang.</p>
          )}
          {wallet && (
            <div className="space-y-2">
              <p className="text-body-sm-regular break-all">Ví của bạn: {wallet}</p>
              <Button
                variant="secondary"
                onClick={() => {
                  void copyTextToClipboard(wallet)
                    .then(() => setMessage("Đã sao chép địa chỉ ví."))
                    .catch(() => setMessage("Chưa sao chép được. Hãy sao chép địa chỉ ví hiển thị bên trên."));
                }}
              >
                Sao chép địa chỉ ví
              </Button>
            </div>
          )}
          {message && (
            <p role="status" aria-live="polite" className="text-body-sm-regular text-secondary">
              {message}
            </p>
          )}
        </main>
      </div>
    </AuthenticationWrapper>
  );
}

export default observer(WorkspaceInvitationPage);
