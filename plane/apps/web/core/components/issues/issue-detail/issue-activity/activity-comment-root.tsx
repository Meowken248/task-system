/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useMemo } from "react";
import { observer } from "mobx-react";
// plane imports
import type { E_SORT_ORDER, TActivityFilters, EActivityFilterType } from "@plane/constants";
import { BASE_ACTIVITY_FILTER_TYPES, filterActivityOnSelectedFilters } from "@plane/constants";
import type { TCommentsOperations } from "@plane/types";
// components
import { CommentCard } from "@/components/comments/card/root";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
// plane web components
import { IssueAdditionalPropertiesActivity } from "@/plane-web/components/issues/issue-details/issue-properties-activity";
import { IssueActivityWorklog } from "@/plane-web/components/issues/worklog/activity/root";
// local imports
import { IssueActivityItem } from "./activity/activity-list";
import { IssueActivityLoader } from "./loader";
import type { TActivityTab } from "./root";

type TIssueActivityCommentRoot = {
  workspaceSlug: string;
  projectId: string;
  isIntakeIssue: boolean;
  issueId: string;
  selectedFilters: TActivityFilters[];
  activeTab?: TActivityTab;
  activityOperations: TCommentsOperations;
  showAccessSpecifier?: boolean;
  disabled?: boolean;
  sortOrder: E_SORT_ORDER;
};

export const IssueActivityCommentRoot = observer(function IssueActivityCommentRoot(props: TIssueActivityCommentRoot) {
  const {
    workspaceSlug,
    isIntakeIssue,
    issueId,
    selectedFilters,
    activeTab = "all",
    activityOperations,
    showAccessSpecifier,
    projectId,
    disabled,
    sortOrder,
  } = props;
  // store hooks
  const {
    activity: { getActivityAndCommentsByIssueId, getActivityById },
    comment: { getCommentById },
  } = useIssueDetail();
  // derived values
  const activityAndComments = getActivityAndCommentsByIssueId(issueId, sortOrder);

  const filteredActivityAndComments = useMemo(() => {
    if (!activityAndComments) return [];
    const baseFiltered = filterActivityOnSelectedFilters(activityAndComments, selectedFilters);

    if (activeTab === "all") {
      return baseFiltered;
    }

    if (activeTab === "comments") {
      return baseFiltered.filter((item) => item.activity_type === "COMMENT");
    }

    if (activeTab === "transition") {
      return baseFiltered.filter((item) => {
        if (item.activity_type === "COMMENT") return false;
        const act = getActivityById(item.id);
        return item.activity_type === "STATE" || act?.field === "state";
      });
    }

    if (activeTab === "updates") {
      return baseFiltered.filter((item) => {
        if (item.activity_type === "COMMENT") return false;
        const act = getActivityById(item.id);
        return act?.field !== null && act?.field !== "state";
      });
    }

    if (activeTab === "activity") {
      return baseFiltered.filter((item) => item.activity_type !== "COMMENT");
    }

    if (activeTab === "history") {
      return baseFiltered.filter((item) => item.activity_type !== "COMMENT");
    }

    return baseFiltered;
  }, [activityAndComments, selectedFilters, activeTab, getActivityById]);

  if (!activityAndComments) return <IssueActivityLoader />;

  if (activityAndComments.length <= 0) return null;

  if (filteredActivityAndComments.length <= 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center text-13 text-placeholder">
        {activeTab === "comments"
          ? "No comments yet"
          : activeTab === "transition"
            ? "No transitions yet"
            : activeTab === "updates"
              ? "No updates yet"
              : activeTab === "history"
                ? "No history records yet"
                : "No activity yet"}
      </div>
    );
  }

  return (
    <div>
      {filteredActivityAndComments.map((activityComment, index) => {
        const comment = getCommentById(activityComment.id);
        console.log("[IssueActivity] rendering comment ID:", activityComment.id, "found in store:", !!comment, comment);
        return activityComment.activity_type === "COMMENT" ? (
          <CommentCard
            key={activityComment.id}
            workspaceSlug={workspaceSlug}
            entityId={issueId}
            comment={comment}
            activityOperations={activityOperations}
            ends={index === 0 ? "top" : index === filteredActivityAndComments.length - 1 ? "bottom" : undefined}
            showAccessSpecifier={!!showAccessSpecifier}
            showCopyLinkOption={!isIntakeIssue}
            disabled={disabled}
            projectId={projectId}
            enableReplies
          />
        ) : BASE_ACTIVITY_FILTER_TYPES.includes(activityComment.activity_type as EActivityFilterType) ? (
          <IssueActivityItem
            key={activityComment.id}
            activityId={activityComment.id}
            ends={index === 0 ? "top" : index === filteredActivityAndComments.length - 1 ? "bottom" : undefined}
          />
        ) : activityComment.activity_type === "ISSUE_ADDITIONAL_PROPERTIES_ACTIVITY" ? (
          <IssueAdditionalPropertiesActivity
            key={activityComment.id}
            activityId={activityComment.id}
            ends={index === 0 ? "top" : index === filteredActivityAndComments.length - 1 ? "bottom" : undefined}
          />
        ) : activityComment.activity_type === "WORKLOG" ? (
          <IssueActivityWorklog
            key={activityComment.id}
            workspaceSlug={workspaceSlug}
            projectId={projectId}
            issueId={issueId}
            activityComment={activityComment}
            ends={index === 0 ? "top" : index === filteredActivityAndComments.length - 1 ? "bottom" : undefined}
          />
        ) : (
          <></>
        );
      })}
    </div>
  );
});
