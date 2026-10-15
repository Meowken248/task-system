/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { Boxes, Share2, Star, User2 } from "lucide-react";
import { CheckIcon, CloseIcon } from "@plane/propel/icons";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
// components
import { LogoSpinner } from "@/components/common/logo-spinner";
import { EmptySpace, EmptySpaceItem } from "@/components/ui/empty-space";
// constants
import { WORKSPACE_INVITATION } from "@/constants/fetch-keys";
// helpers
import { EPageTypes } from "@/helpers/authentication.helper";
// hooks
import { useUser } from "@/hooks/store/user";
import { useAppRouter } from "@/hooks/use-app-router";
// wrappers
import { AuthenticationWrapper } from "@/lib/wrappers/authentication-wrapper";
import { WorkspaceService } from "@/services/workspace.service";
import { resolveMetanodeWalletAddress } from "@/services/blockchain/metanode-wallet.service";
// services

// service initialization
const workspaceService = new WorkspaceService();

function WorkspaceInvitationPage() {
  const [isAccepting, setIsAccepting] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  // router
  const router = useAppRouter();
  // query params
  const searchParams = useSearchParams();
  const invitation_id = searchParams.get("invitation_id");
  const slug = searchParams.get("slug");
  const token = searchParams.get("token");
  // store hooks
  const { data: currentUser } = useUser();

  const { data: invitationDetail, error } = useSWR(
    invitation_id && slug && WORKSPACE_INVITATION(invitation_id.toString()),
    invitation_id && slug
      ? () => workspaceService.getWorkspaceInvitation(slug.toString(), invitation_id.toString())
      : null
  );

  const getDestinationUrl = (targetSlug?: string | null) => {
    const basePath =
      (typeof window !== "undefined" && (window as any).env?.VITE_ROUTER_BASENAME) ||
      (typeof window !== "undefined" && window.location.pathname.startsWith("/plane") ? "/plane" : "");
    return targetSlug ? `${basePath}/${targetSlug}` : `${basePath}/`;
  };

  useEffect(() => {
    if (invitationDetail?.accepted && !isAccepting && !isJoining && currentUser?.id) {
      const targetSlug = invitationDetail?.workspace?.slug || slug;
      window.location.replace(getDestinationUrl(targetSlug));
    }
  }, [invitationDetail?.accepted, isAccepting, isJoining, invitationDetail?.workspace?.slug, slug, currentUser?.id]);

  const handleAccept = async () => {
    if (!invitationDetail || isAccepting || isJoining) return;
    setIsAccepting(true);
    try {
      setToast({
        type: TOAST_TYPE.INFO,
        title: "Xác thực ví MetaNode",
        message: "Đang kết nối ví MetaNode để xác thực quyền thành viên on-chain...",
      });

      // 1. Resolve & prompt user's MetaNode wallet (same modal as task creation)
      const walletAddress = await resolveMetanodeWalletAddress();

      // 2. Submit join with confirmed wallet address
      await workspaceService.joinWorkspace(invitationDetail.workspace.slug, invitationDetail.id, {
        accepted: true,
        token: token,
        wallet_address: walletAddress,
      });

      setIsJoining(true);
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: "Thành công",
        message: `Đã kết nối ví ${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)} và gia nhập không gian làm việc!`,
      });

      const targetSlug = invitationDetail.workspace?.slug || slug;
      const targetUrl = getDestinationUrl(targetSlug);
      // Hard navigation reload ensures MobX stores and SWR rehydrate fresh session credentials cleanly
      setTimeout(() => {
        window.location.replace(targetUrl);
      }, 500);
    } catch (err: any) {
      console.error("[Workspace Invitations] Error accepting invitation:", err);
      setIsJoining(false);
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Không thể tham gia không gian làm việc",
        message: err?.message || "Lỗi khi kết nối ví MetaNode hoặc gia nhập không gian làm việc.",
      });
    } finally {
      setIsAccepting(false);
    }
  };

  const handleReject = () => {
    if (!invitationDetail || !token) return;
    void workspaceService
      .joinWorkspace(invitationDetail.workspace.slug, invitationDetail.id, {
        accepted: false,
        token: token,
      })
      .then(() => {
        window.location.replace(getDestinationUrl(null));
      })
      .catch((err: unknown) => console.error(err));
  };

  return (
    <AuthenticationWrapper pageType={EPageTypes.PUBLIC}>
      <div className="flex h-full w-full flex-col items-center justify-center px-3">
        {isAccepting || isJoining ? (
          <div className="flex flex-col items-center justify-center space-y-4 py-8 text-center max-w-md">
            <LogoSpinner />
            <div className="space-y-1">
              <h3 className="text-16 font-medium text-primary">
                {isJoining ? "Đang chuyển đến không gian làm việc" : "Đang xác thực ví MetaNode"}
              </h3>
              <p className="text-13 text-secondary animate-pulse">
                {isJoining
                  ? "Xác thực thành công. Vui lòng đợi trong giây lát..."
                  : "Vui lòng xác nhận trong popup ví MetaNode để ký tham gia workspace on-chain..."}
              </p>
            </div>
          </div>
        ) : invitationDetail && !invitationDetail.responded_at ? (
          error ? (
            <div className="shadow-2xl flex w-full flex-col space-y-4 rounded-sm border border-subtle bg-surface-1 px-4 py-8 text-center md:w-1/3">
              <h2 className="text-18 uppercase">INVITATION NOT FOUND</h2>
            </div>
          ) : (
            <EmptySpace
              title={`You have been invited to ${invitationDetail.workspace.name}`}
              description="Your workspace is where you'll create projects, collaborate on your work items, and organize different streams of work in your Plane account."
            >
              <EmptySpaceItem
                Icon={CheckIcon}
                title="Accept with MetaNode Wallet"
                description="Connect your MetaNode wallet and sign membership on Sequoia chain"
                action={handleAccept}
              />
              <EmptySpaceItem Icon={CloseIcon} title="Ignore" action={handleReject} />
            </EmptySpace>
          )
        ) : error || invitationDetail?.responded_at ? (
          invitationDetail?.accepted ? (
            <EmptySpace
              title={`You are already a member of ${invitationDetail.workspace.name}`}
              description="Your workspace is where you'll create projects, collaborate on your work items, and organize different streams of work in your Plane account."
            >
              <EmptySpaceItem
                Icon={Boxes}
                title="Continue to home"
                action={() => {
                  const targetSlug = invitationDetail.workspace?.slug || slug;
                  window.location.replace(getDestinationUrl(targetSlug));
                }}
              />
            </EmptySpace>
          ) : (
            <EmptySpace
              title="This invitation link is not active anymore."
              description="Your workspace is where you'll create projects, collaborate on your work items, and organize different streams of work in your Plane account."
              link={{ text: "Or start from an empty project", href: "/" }}
            >
              {!currentUser ? (
                <EmptySpaceItem Icon={User2} title="Sign in to continue" href="/" />
              ) : (
                <EmptySpaceItem Icon={Boxes} title="Continue to home" href="/" />
              )}
              <EmptySpaceItem Icon={Star} title="Star us on GitHub" href="https://github.com/makeplane" />
              <EmptySpaceItem
                Icon={Share2}
                title="Join our community of active creators"
                href="https://forum.plane.so"
              />
            </EmptySpace>
          )
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <LogoSpinner />
          </div>
        )}
      </div>
    </AuthenticationWrapper>
  );
}

export default observer(WorkspaceInvitationPage);
