/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useMemo } from "react";
import { observer } from "mobx-react";
import { MoreHorizontal } from "lucide-react";
// plane imports
import { EIssueCommentAccessSpecifier, EUserPermissions } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { IconButton } from "@plane/propel/icon-button";
import { LinkIcon, GlobeIcon, LockIcon, EditIcon, TrashIcon, CommentReplyIcon } from "@plane/propel/icons";
import type { TIssueComment, TCommentsOperations } from "@plane/types";
import type { TContextMenuItem } from "@plane/ui";
import { CustomMenu } from "@plane/ui";
import { cn } from "@plane/utils";
// hooks
import { useUser, useUserPermissions } from "@/hooks/store/user";

type TCommentCard = {
  activityOperations: TCommentsOperations;
  comment: TIssueComment;
  setEditMode: () => void;
  showAccessSpecifier: boolean;
  showCopyLinkOption: boolean;
  onReply?: () => void;
  workspaceSlug?: string;
  projectId?: string;
  entityId?: string;
};

export const CommentQuickActions = observer(function CommentQuickActions(props: TCommentCard) {
  const {
    activityOperations,
    comment,
    setEditMode,
    showAccessSpecifier,
    showCopyLinkOption,
    onReply,
    workspaceSlug,
    projectId,
    entityId,
  } = props;
  // store hooks
  const { data: currentUser } = useUser();
  const { getProjectRoleByWorkspaceSlugAndProjectId } = useUserPermissions();

  const currentUserProjectRole =
    workspaceSlug && projectId ? getProjectRoleByWorkspaceSlugAndProjectId(workspaceSlug, projectId) : undefined;
  const isAdmin = currentUserProjectRole === EUserPermissions.ADMIN;

  // derived values
  const isAuthor =
    (currentUser?.id && (comment.actor === currentUser.id || comment.created_by === currentUser.id)) ||
    comment.actor === "me" ||
    comment.created_by === "me" ||
    !comment.actor;

  const canEdit = isAuthor;
  const canDelete = isAuthor || isAdmin;

  // translation
  const { t } = useTranslation();

  const handleReplyAction = () => {
    if (onReply) {
      onReply();
      return;
    }
    if (typeof window !== "undefined") {
      const targetEntityId = entityId || comment.issue || (comment as any).issue_id;
      window.dispatchEvent(
        new CustomEvent("plane:reply-comment", {
          detail: {
            entityId: targetEntityId,
            commentId: comment.id,
            authorName: comment.actor_detail?.display_name || "user",
            commentText: comment.comment_stripped || "",
          },
        })
      );
    }
  };

  const MENU_ITEMS = useMemo(
    function MENU_ITEMS(): TContextMenuItem[] {
      return [
        {
          key: "reply",
          action: handleReplyAction,
          title: t("common.actions.reply") || "Reply",
          icon: CommentReplyIcon,
          shouldRender: true,
        },
        {
          key: "edit",
          action: setEditMode,
          title: t("common.actions.edit") || "Edit",
          icon: EditIcon,
          shouldRender: canEdit,
        },
        {
          key: "access_specifier",
          action: () =>
            activityOperations.updateComment(comment.id, {
              access:
                comment.access === EIssueCommentAccessSpecifier.INTERNAL
                  ? EIssueCommentAccessSpecifier.EXTERNAL
                  : EIssueCommentAccessSpecifier.INTERNAL,
            }),
          title:
            comment.access === EIssueCommentAccessSpecifier.INTERNAL
              ? t("issue.comments.switch.public") || "Switch to public comment"
              : t("issue.comments.switch.private") || "Switch to private comment",
          icon: comment.access === EIssueCommentAccessSpecifier.INTERNAL ? GlobeIcon : LockIcon,
          shouldRender: showAccessSpecifier,
        },
        {
          key: "copy_link",
          action: () => activityOperations.copyCommentLink(comment.id),
          title: t("common.actions.copy_link") || "Copy link",
          icon: LinkIcon,
          shouldRender: showCopyLinkOption,
        },
        {
          key: "delete",
          action: () => activityOperations.removeComment(comment.id),
          title: t("common.actions.delete") || "Delete",
          icon: TrashIcon,
          shouldRender: canDelete,
          className: "text-danger hover:bg-danger-subtle",
          iconClassName: "text-danger",
        },
      ];
    },
    [t, handleReplyAction, setEditMode, canEdit, showAccessSpecifier, comment, activityOperations, showCopyLinkOption, canDelete]
  );

  return (
    <CustomMenu customButton={<IconButton icon={MoreHorizontal} variant="ghost" size="sm" />} closeOnSelect>
      {MENU_ITEMS.map((item) => {
        if (item.shouldRender === false) return null;

        return (
          <CustomMenu.MenuItem
            key={item.key}
            onClick={() => item.action()}
            className={cn(
              "flex items-center gap-2",
              {
                "text-placeholder": item.disabled,
              },
              item.className
            )}
            disabled={item.disabled}
          >
            {item.icon && <item.icon className={cn("size-3 shrink-0", item.iconClassName)} />}
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
  );
});
