/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// plane imports
import { ROLE, EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { LinkIcon, TrashIcon, ChevronDownIcon } from "@plane/propel/icons";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TContextMenuItem } from "@plane/ui";
import { CustomSelect, CustomMenu } from "@plane/ui";
import { cn, copyTextToClipboard } from "@plane/utils";
// components
import { ConfirmWorkspaceMemberRemove } from "@/components/workspace/confirm-workspace-member-remove";
import { ApproveInvitationWallet } from "./approve-invitation-wallet";
// hooks
import { useMember } from "@/hooks/store/use-member";
import { useUserPermissions } from "@/hooks/store/user";

type Props = {
  invitationId: string;
};

export const WorkspaceInvitationsListItem = observer(function WorkspaceInvitationsListItem(props: Props) {
  const { invitationId } = props;
  // router
  const { workspaceSlug } = useParams();
  // states
  const [removeMemberModal, setRemoveMemberModal] = useState(false);
  const [walletModal, setWalletModal] = useState(false);
  // plane hooks
  const { t } = useTranslation();
  // store hooks
  const { allowPermissions, workspaceInfoBySlug } = useUserPermissions();
  const {
    workspace: { updateMemberInvitation, deleteMemberInvitation, getWorkspaceInvitationDetails },
  } = useMember();
  // derived values
  const invitationDetails = getWorkspaceInvitationDetails(invitationId);
  const currentWorkspaceMemberInfo = workspaceInfoBySlug(workspaceSlug.toString());
  const currentWorkspaceRole = currentWorkspaceMemberInfo?.role;
  // is the current logged in user admin
  const isAdmin = allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.WORKSPACE);
  // role change access-
  // 1. user cannot change their own role
  // 2. only admin or member can change role
  // 3. user cannot change role of higher role
  const hasRoleChangeAccess = allowPermissions(
    [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
    EUserPermissionsLevel.WORKSPACE
  );

  const handleRemoveInvitation = async () => {
    try {
      if (!workspaceSlug || !invitationDetails) return;

      await deleteMemberInvitation(workspaceSlug.toString(), invitationDetails.id);
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: "Success!",
        message: "Invitation removed successfully.",
      });
    } catch (err: unknown) {
      const error = err as { error?: string };
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Error!",
        message: error?.error || "Something went wrong. Please try again.",
      });
    }
  };

  if (!invitationDetails || !currentWorkspaceMemberInfo) return null;

  const handleCopyText = async () => {
    try {
      const inviteLink = new URL(invitationDetails.invite_link, window.location.origin).href;
      await copyTextToClipboard(inviteLink);
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: t("common.link_copied"),
        message: t("entity.link_copied_to_clipboard", { entity: t("common.invite") }),
      });
    } catch (error) {
      console.error("Error generating invite link:", error);
    }
  };

  const MENU_ITEMS: TContextMenuItem[] = [
    {
      key: "approve-wallet",
      action: () => setWalletModal(true),
      title: "Xác nhận ví người nhận",
      icon: LinkIcon,
      shouldRender: isAdmin,
    },
    {
      key: "copy-link",
      action: () => void handleCopyText(),
      title: t("common.actions.copy_link"),
      icon: LinkIcon,
      shouldRender: !!invitationDetails.invite_link,
    },
    {
      key: "remove",
      action: () => {
        setRemoveMemberModal(true);
      },
      title: t("common.remove"),
      icon: TrashIcon,
      shouldRender: isAdmin,
      className: "text-danger-primary",
      iconClassName: "text-danger-primary",
    },
  ];

  return (
    <>
      {walletModal && isAdmin && (
        <ApproveInvitationWallet
          email={invitationDetails.email}
          initialWallet={invitationDetails.wallet_address}
          onClose={() => setWalletModal(false)}
          onSubmit={async (wallet) => {
            await updateMemberInvitation(workspaceSlug.toString(), invitationDetails.id, { wallet_address: wallet });
            setToast({
              type: TOAST_TYPE.SUCCESS,
              title: "Đã xác nhận ví",
              message: "Quyền nhận lời mời đã được xác nhận và công bố. Người nhận có thể kiểm tra lại lời mời.",
            });
          }}
        />
      )}
      <ConfirmWorkspaceMemberRemove
        isOpen={removeMemberModal}
        onClose={() => setRemoveMemberModal(false)}
        userDetails={{
          id: invitationDetails.id,
          display_name: `${invitationDetails.email}`,
        }}
        onSubmit={handleRemoveInvitation}
      />
      <div className="group flex h-full w-full items-center justify-between px-3 py-4 hover:bg-layer-transparent-hover">
        <div className="flex items-center gap-x-4 gap-y-2">
          <span className="relative flex h-10 w-10 items-center justify-center rounded-sm bg-layer-3 p-4 text-tertiary capitalize">
            {(invitationDetails.email ?? "?")[0]}
          </span>
          <div>
            <h4 className="cursor-default text-body-xs-regular">{invitationDetails.email}</h4>
            <p className="max-w-sm text-caption-sm-regular break-all text-secondary">
              {invitationDetails.wallet_address
                ? `Ví: ${invitationDetails.wallet_address}${invitationDetails.wallet_approval_required || (invitationDetails as any).chain_approval_failed ? " — Chưa xác nhận" : ""}`
                : "Chờ xác nhận ví người nhận"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-11">
          <div className="flex items-center justify-center rounded-sm bg-label-yellow-bg-strong/20 px-2.5 py-1 text-center text-caption-sm-medium text-label-yellow-text">
            <p>{t("common.pending")}</p>
          </div>
          <CustomSelect
            customButton={
              <div className="item-center flex gap-1 rounded-sm px-2 py-0.5">
                <span
                  className={`flex items-center rounded-sm text-caption-sm-medium ${
                    hasRoleChangeAccess ? "" : "text-placeholder"
                  }`}
                >
                  {ROLE[invitationDetails.role]}
                </span>
                {hasRoleChangeAccess && (
                  <span className="grid place-items-center">
                    <ChevronDownIcon className="h-3 w-3" />
                  </span>
                )}
              </div>
            }
            value={invitationDetails.role}
            onChange={(value: EUserPermissions) => {
              if (!workspaceSlug || !value) return;

              updateMemberInvitation(workspaceSlug.toString(), invitationDetails.id, {
                role: value,
              }).catch((err: unknown) => {
                const error = err as { error?: string };
                setToast({
                  type: TOAST_TYPE.ERROR,
                  title: "Error!",
                  message: error?.error || "An error occurred while updating member role. Please try again.",
                });
              });
            }}
            disabled={!hasRoleChangeAccess}
            placement="bottom-end"
          >
            {Object.keys(ROLE)
              .filter((key) => [15, 20].includes(Number(key)))
              .map((key) => {
                if (
                  currentWorkspaceRole &&
                  Number(currentWorkspaceRole) !== 20 &&
                  Number(currentWorkspaceRole) < parseInt(key)
                )
                  return null;

                return (
                  <CustomSelect.Option key={key} value={parseInt(key, 10)}>
                    <>{ROLE[parseInt(key) as keyof typeof ROLE]}</>
                  </CustomSelect.Option>
                );
              })}
          </CustomSelect>
          {isAdmin && (
            <CustomMenu ellipsis placement="bottom-end" closeOnSelect>
              {MENU_ITEMS.map((item) => {
                if (item.shouldRender === false) return null;
                return (
                  <CustomMenu.MenuItem
                    key={item.key}
                    onClick={() => {
                      item.action();
                    }}
                    className={cn(
                      "flex items-center gap-2",
                      {
                        "text-placeholder": item.disabled,
                      },
                      item.className
                    )}
                    disabled={item.disabled}
                  >
                    {item.icon && <item.icon className={cn("h-3 w-3", item.iconClassName)} />}
                    <div>
                      <h5>{item.title}</h5>
                      {item.description && (
                        <p
                          className={cn("whitespace-pre-line text-tertiary", {
                            "text-placeholder": item.disabled,
                          })}
                        >
                          {item.description}
                        </p>
                      )}
                    </div>
                  </CustomMenu.MenuItem>
                );
              })}
            </CustomMenu>
          )}
        </div>
      </div>
    </>
  );
});
