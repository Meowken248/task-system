/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import { Clock, Mail, UserPlus, ExternalLink } from "lucide-react";
// plane imports
import { Avatar, Row } from "@plane/ui";
import { cn, calculateTimeAgo, renderFormattedDate, renderFormattedTime, getFileURL } from "@plane/utils";
// hooks
import { useWorkspaceNotifications } from "@/hooks/store/notifications";
import { useNotification } from "@/hooks/store/notifications/use-notification";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useWorkspace } from "@/hooks/store/use-workspace";
import { useAppRouter } from "@/hooks/use-app-router";
// local imports
import { NotificationContent } from "./content";
import { NotificationOption } from "./options";

type TNotificationItem = {
  workspaceSlug: string;
  notificationId: string;
};

export const NotificationItem = observer(function NotificationItem(props: TNotificationItem) {
  const { workspaceSlug, notificationId } = props;
  // router
  const router = useAppRouter();
  // hooks
  const { currentSelectedNotificationId, setCurrentSelectedNotificationId } = useWorkspaceNotifications();
  const { asJson: notification, markNotificationAsRead } = useNotification(notificationId);
  const { getIsIssuePeeked, setPeekIssue } = useIssueDetail();
  const { getWorkspaceBySlug } = useWorkspace();
  // states
  const [isSnoozeStateModalOpen, setIsSnoozeStateModalOpen] = useState(false);
  const [customSnoozeModal, setCustomSnoozeModal] = useState(false);

  // derived values
  const projectId = notification?.project || undefined;
  const issueId = notification?.data?.issue?.id || undefined;
  const workspace = getWorkspaceBySlug(workspaceSlug);

  const notificationField = notification?.data?.issue_activity?.field || undefined;
  const notificationTriggeredBy = notification?.triggered_by_details || undefined;

  const isInvitation =
    notification?.entity_name === "workspace_invitation" ||
    notification?.title?.toLowerCase().includes("invitation") ||
    Boolean((notification?.data as any)?.invitation_id);

  const handleInvitationClick = async () => {
    if (notification.read_at === null) {
      try {
        await markNotificationAsRead(workspaceSlug);
      } catch (error) {
        console.error(error);
      }
    }
    const inviteLink = (notification?.data as any)?.invite_link;
    if (inviteLink) {
      router.push(inviteLink);
    } else {
      router.push(`/${workspaceSlug}/invitations`);
    }
  };

  const handleNotificationIssuePeekOverview = async () => {
    if (workspaceSlug && projectId && issueId && !isSnoozeStateModalOpen && !customSnoozeModal) {
      setPeekIssue(undefined);
      setCurrentSelectedNotificationId(notificationId);

      // make the notification as read
      if (notification.read_at === null) {
        try {
          await markNotificationAsRead(workspaceSlug);
        } catch (error) {
          console.error(error);
        }
      }

      if (notification?.is_inbox_issue === false) {
        if (!getIsIssuePeeked(issueId)) {
          setPeekIssue({ workspaceSlug, projectId, issueId });
        }
      }
    }
  };

  if (!workspaceSlug || !notificationId || !notification?.id || !workspace?.id) return <></>;

  // Render Workspace Invitation Card
  if (isInvitation) {
    const invRole = (notification?.data as any)?.role;
    const roleLabel = invRole === 20 ? "Admin" : invRole === 15 ? "Member" : "Guest";
    const wsName = (notification?.data as any)?.workspace_name || workspace?.name || workspaceSlug;

    return (
      <Row
        className={cn(
          "group relative flex cursor-pointer items-center gap-2 border-b border-subtle py-4 transition-all hover:bg-layer-1/20",
          {
            "bg-accent-primary/5": notification.read_at === null,
          }
        )}
        onClick={handleInvitationClick}
      >
        {notification.read_at === null && (
          <div className="absolute top-[50%] left-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent-primary" />
        )}

        <div className="relative flex w-full gap-2 pl-2">
          <div className="relative flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-accent-primary/10 text-accent-primary">
            {notificationTriggeredBy?.avatar_url ? (
              <Avatar
                name={notificationTriggeredBy.display_name || notificationTriggeredBy?.first_name || "Admin"}
                src={getFileURL(notificationTriggeredBy.avatar_url)}
                size={40}
                shape="circle"
                className="bg-layer-1 text-body-sm-medium"
              />
            ) : (
              <UserPlus className="h-5 w-5" />
            )}
          </div>

          <div className="-mt-1 w-full space-y-1">
            <div className="relative flex h-7 items-center justify-between gap-2">
              <div className="line-clamp-1 w-full truncate overflow-hidden text-body-xs-medium text-primary">
                <span className="font-semibold text-accent-primary">
                  {notificationTriggeredBy?.display_name || notificationTriggeredBy?.first_name || "Admin"}
                </span>
                <span className="text-secondary"> đã mời bạn tham gia </span>
                <span className="font-semibold text-primary">{wsName}</span>
              </div>
              <NotificationOption
                workspaceSlug={workspaceSlug}
                notificationId={notification?.id}
                isSnoozeStateModalOpen={isSnoozeStateModalOpen}
                setIsSnoozeStateModalOpen={setIsSnoozeStateModalOpen}
                customSnoozeModal={customSnoozeModal}
                setCustomSnoozeModal={setCustomSnoozeModal}
              />
            </div>

            <div className="relative flex items-center justify-between gap-3 text-caption-sm-regular text-secondary">
              <div className="flex items-center gap-2">
                <span className="rounded bg-accent-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-accent-primary">
                  Vai trò: {roleLabel}
                </span>
                <span className="flex items-center gap-1 text-[11px] text-accent-primary hover:underline">
                  Xem lời mời <ExternalLink className="h-3 w-3" />
                </span>
              </div>
              <div className="flex-shrink-0 text-tertiary">
                {notification.created_at && calculateTimeAgo(notification.created_at)}
              </div>
            </div>
          </div>
        </div>
      </Row>
    );
  }

  // Fallback for General Notifications (without issue_activity or project)
  if (!notificationField || !projectId || !issueId) {
    return (
      <Row
        className={cn(
          "group relative flex cursor-pointer items-center gap-2 border-b border-subtle py-4 transition-all hover:bg-layer-1/20",
          {
            "bg-accent-primary/5": notification.read_at === null,
          }
        )}
        onClick={async () => {
          if (notification.read_at === null) {
            try {
              await markNotificationAsRead(workspaceSlug);
            } catch (error) {
              console.error(error);
            }
          }
        }}
      >
        {notification.read_at === null && (
          <div className="absolute top-[50%] left-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent-primary" />
        )}
        <div className="relative flex w-full gap-2 pl-2">
          <div className="relative flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-layer-1">
            {notificationTriggeredBy ? (
              <Avatar
                name={notificationTriggeredBy.display_name || notificationTriggeredBy?.first_name || "Plane"}
                src={getFileURL(notificationTriggeredBy.avatar_url)}
                size={40}
                shape="circle"
                className="bg-layer-1 text-body-sm-medium"
              />
            ) : (
              <Mail className="h-5 w-5 text-tertiary" />
            )}
          </div>
          <div className="-mt-1 w-full space-y-1">
            <div className="relative flex h-7 items-center justify-between gap-2">
              <div className="line-clamp-1 w-full truncate overflow-hidden text-body-xs-medium font-medium text-primary">
                {notification.title || "Thông báo"}
              </div>
              <NotificationOption
                workspaceSlug={workspaceSlug}
                notificationId={notification?.id}
                isSnoozeStateModalOpen={isSnoozeStateModalOpen}
                setIsSnoozeStateModalOpen={setIsSnoozeStateModalOpen}
                customSnoozeModal={customSnoozeModal}
                setCustomSnoozeModal={setCustomSnoozeModal}
              />
            </div>
            <div className="relative flex items-center justify-between gap-3 text-caption-sm-regular text-secondary">
              <div className="line-clamp-1 w-full truncate overflow-hidden break-words whitespace-normal text-secondary">
                {(notification as any).message || notification.message_html || "Không có nội dung"}
              </div>
              <div className="flex-shrink-0 text-tertiary">
                {notification.created_at && calculateTimeAgo(notification.created_at)}
              </div>
            </div>
          </div>
        </div>
      </Row>
    );
  }

  // Standard Issue / Work Item / Daily Report Notification Card
  return (
    <Row
      className={cn(
        "group relative flex cursor-pointer items-center gap-2 border-b border-subtle py-4 transition-all hover:bg-layer-1/20",
        {
          "bg-layer-1/30": currentSelectedNotificationId === notification?.id,
          "bg-accent-primary/5": notification.read_at === null,
        }
      )}
      onClick={handleNotificationIssuePeekOverview}
    >
      {notification.read_at === null && (
        <div className="absolute top-[50%] left-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent-primary" />
      )}

      <div className="relative flex w-full gap-2 pl-2">
        <div className="relative flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-layer-1">
          {notificationTriggeredBy && (
            <Avatar
              name={notificationTriggeredBy.display_name || notificationTriggeredBy?.first_name}
              src={getFileURL(notificationTriggeredBy.avatar_url)}
              size={42}
              shape="circle"
              className="bg-layer-1 text-body-sm-medium"
            />
          )}
        </div>

        <div className="-mt-2 w-full space-y-1">
          <div className="relative flex h-8 items-center gap-3">
            <div className="line-clamp-1 w-full truncate overflow-hidden text-body-xs-medium break-all whitespace-normal text-primary">
              <NotificationContent
                notification={notification}
                workspaceId={workspace.id}
                workspaceSlug={workspaceSlug}
                projectId={projectId}
              />
            </div>
            <NotificationOption
              workspaceSlug={workspaceSlug}
              notificationId={notification?.id}
              isSnoozeStateModalOpen={isSnoozeStateModalOpen}
              setIsSnoozeStateModalOpen={setIsSnoozeStateModalOpen}
              customSnoozeModal={customSnoozeModal}
              setCustomSnoozeModal={setCustomSnoozeModal}
            />
          </div>

          <div className="relative flex items-center gap-3 text-caption-sm-regular text-secondary">
            <div className="line-clamp-1 w-full truncate overflow-hidden break-words whitespace-normal">
              {notification?.data?.issue?.identifier}-{notification?.data?.issue?.sequence_id}&nbsp;
              {notification?.data?.issue?.name}
            </div>
            <div className="flex-shrink-0">
              {notification?.snoozed_till ? (
                <p className="flex flex-shrink-0 items-center justify-end gap-x-1 text-tertiary">
                  <Clock className="h-4 w-4" />
                  <span>
                    Till {renderFormattedDate(notification.snoozed_till)},&nbsp;
                    {renderFormattedTime(notification.snoozed_till, "12-hour")}
                  </span>
                </p>
              ) : (
                <p className="mt-auto flex-shrink-0 text-tertiary">
                  {notification.created_at && calculateTimeAgo(notification.created_at)}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </Row>
  );
});
