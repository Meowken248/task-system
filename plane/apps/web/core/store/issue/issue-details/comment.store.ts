/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { pull, concat, update, uniq, set } from "lodash-es";
import { action, makeObservable, observable, runInAction } from "mobx";
// Plane Imports
import type { TIssueComment, TIssueCommentMap, TIssueCommentIdMap, TIssueServiceType } from "@plane/types";
// services
import { IssueCommentService } from "@/services/issue";
// types
import type { IIssueDetail } from "./root.store";

export type TCommentLoader = "fetch" | "create" | "update" | "delete" | "mutate" | undefined;

export interface IIssueCommentStoreActions {
  fetchComments: (
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    loaderType?: TCommentLoader
  ) => Promise<TIssueComment[]>;
  createComment: (
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    data: Partial<TIssueComment>
  ) => Promise<any>;
  updateComment: (
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    commentId: string,
    data: Partial<TIssueComment>
  ) => Promise<any>;
  removeComment: (workspaceSlug: string, projectId: string, issueId: string, commentId: string) => Promise<any>;
}

export interface IIssueCommentStore extends IIssueCommentStoreActions {
  // observables
  loader: TCommentLoader;
  comments: TIssueCommentIdMap;
  commentMap: TIssueCommentMap;
  // helper methods
  getCommentsByIssueId: (issueId: string) => string[] | undefined;
  getCommentById: (activityId: string) => TIssueComment | undefined;
}

export class IssueCommentStore implements IIssueCommentStore {
  // observables
  loader: TCommentLoader = "fetch";
  comments: TIssueCommentIdMap = {};
  commentMap: TIssueCommentMap = {};
  serviceType;
  // root store
  rootIssueDetail: IIssueDetail;
  // services
  issueCommentService;

  constructor(rootStore: IIssueDetail, serviceType: TIssueServiceType) {
    makeObservable(this, {
      // observables
      loader: observable.ref,
      comments: observable,
      commentMap: observable,
      // actions
      fetchComments: action,
      createComment: action,
      updateComment: action,
      removeComment: action,
    });
    // root store
    this.serviceType = serviceType;
    this.rootIssueDetail = rootStore;
    // services
    this.issueCommentService = new IssueCommentService(serviceType);
  }

  // helper methods
  getCommentsByIssueId = (issueId: string) => {
    if (!issueId) return undefined;
    return this.comments[issueId] ?? undefined;
  };

  getCommentById = (commentId: string) => {
    if (!commentId) return undefined;
    return this.commentMap[commentId] ?? undefined;
  };

  fetchComments = async (
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    loaderType: TCommentLoader = "fetch"
  ) => {
    this.loader = loaderType;

    let props = {};
    const _commentIds = this.getCommentsByIssueId(issueId);
    if (_commentIds && _commentIds.length > 0) {
      const _comment = this.getCommentById(_commentIds[_commentIds.length - 1]);
      if (_comment) props = { created_at__gt: _comment.created_at };
    }

    const comments = await this.issueCommentService.getIssueComments(workspaceSlug, projectId, issueId, props);

    const commentIds = comments.map((comment) => comment.id);
    runInAction(() => {
      const existing = this.comments[issueId] || [];
      this.comments[issueId] = uniq(concat(existing, commentIds));

      const currentUser = this.rootIssueDetail.rootIssueStore.rootStore.user.data;
      const defaultActorDetail = currentUser
        ? {
            id: currentUser.id,
            first_name: currentUser.first_name,
            last_name: currentUser.last_name,
            is_bot: currentUser.is_bot || false,
            display_name: currentUser.display_name || currentUser.first_name || "User",
            avatar_url: currentUser.avatar_url || "",
          }
        : { id: "me", first_name: "Plane", last_name: "Admin", is_bot: false, display_name: "Plane Admin" };

      comments.forEach((comment) => {
        // Bypassing dapp-interceptor stripping issue
        if (!comment.created_at) comment.created_at = new Date().toISOString();
        if (!comment.updated_at) comment.updated_at = new Date().toISOString();
        if (!comment.created_by) comment.created_by = currentUser?.id || "me";
        if (!comment.updated_by) comment.updated_by = currentUser?.id || "me";
        if (!(comment as any).project_id && !comment.project) comment.project = projectId;
        if (!(comment as any).workspace_id && !comment.workspace) comment.workspace = workspaceSlug;
        if (!comment.actor) comment.actor = currentUser?.id || "me";
        if (!comment.actor_detail) comment.actor_detail = defaultActorDetail as any;
        if (!comment.comment_html && (comment as any).body) comment.comment_html = (comment as any).body;

        this.rootIssueDetail.commentReaction.applyCommentReactions(comment.id, comment?.comment_reactions || []);
        this.commentMap[comment.id] = comment;
      });
      this.loader = undefined;
    });

    return comments;
  };

  createComment = async (workspaceSlug: string, projectId: string, issueId: string, data: Partial<TIssueComment>) => {
    const response = await this.issueCommentService.createIssueComment(workspaceSlug, projectId, issueId, data);

    runInAction(() => {
      const existing = this.comments[issueId] || [];
      this.comments[issueId] = uniq(concat(existing, [response.id]));

      const currentUser = this.rootIssueDetail.rootIssueStore.rootStore.user.data;
      const defaultActorDetail = currentUser
        ? {
            id: currentUser.id,
            first_name: currentUser.first_name,
            last_name: currentUser.last_name,
            is_bot: currentUser.is_bot || false,
            display_name: currentUser.display_name || currentUser.first_name || "User",
            avatar_url: currentUser.avatar_url || "",
          }
        : { id: "me", first_name: "Plane", last_name: "Admin", is_bot: false, display_name: "Plane Admin" };

      if (!response.workspace) response.workspace = workspaceSlug;
      if (!response.project) response.project = projectId;
      if (!response.actor) response.actor = currentUser?.id || "me";
      if (!response.actor_detail) response.actor_detail = defaultActorDetail as any;
      if (!response.comment_html && (response as any).body) response.comment_html = (response as any).body;

      this.commentMap[response.id] = response;
    });

    return response;
  };

  updateComment = async (
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    commentId: string,
    data: Partial<TIssueComment>
  ) => {
    try {
      runInAction(() => {
        Object.keys(data).forEach((key) => {
          set(this.commentMap, [commentId, key], data[key as keyof TIssueComment]);
        });
      });

      const response = await this.issueCommentService.patchIssueComment(
        workspaceSlug,
        projectId,
        issueId,
        commentId,
        data
      );

      runInAction(() => {
        set(this.commentMap, [commentId, "updated_at"], response.updated_at);
        set(this.commentMap, [commentId, "edited_at"], response.edited_at);
      });

      return response;
    } catch (error) {
      this.rootIssueDetail.activity.fetchActivities(workspaceSlug, projectId, issueId);
      throw error;
    }
  };

  removeComment = async (workspaceSlug: string, projectId: string, issueId: string, commentId: string) => {
    const response = await this.issueCommentService.deleteIssueComment(workspaceSlug, projectId, issueId, commentId);

    runInAction(() => {
      pull(this.comments[issueId], commentId);
      delete this.commentMap[commentId];
    });

    return response;
  };
}
