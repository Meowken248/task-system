/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { uniq, debounce } from "lodash-es";
import { action, computed, makeObservable, observable, runInAction } from "mobx";
import { computedFn } from "mobx-utils";
import { v4 as uuidv4 } from "uuid";
// types
import type { TIssueAttachment, TIssueAttachmentMap, TIssueAttachmentIdMap, TIssueServiceType } from "@plane/types";
// services
import { IssueAttachmentService } from "@/services/issue";
import type { IIssueRootStore } from "../root.store";
import type { IIssueDetail } from "./root.store";

export type TAttachmentUploadStatus = {
  id: string;
  name: string;
  progress: number;
  size: number;
  type: string;
};

export interface IIssueAttachmentStoreActions {
  // actions
  addAttachments: (issueId: string, attachments: TIssueAttachment[]) => void;
  fetchAttachments: (workspaceSlug: string, projectId: string, issueId: string) => Promise<TIssueAttachment[]>;
  createAttachment: (
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    file: File
  ) => Promise<TIssueAttachment>;
  removeAttachment: (
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    attachmentId: string
  ) => Promise<TIssueAttachment>;
}

export interface IIssueAttachmentStore extends IIssueAttachmentStoreActions {
  // observables
  attachments: TIssueAttachmentIdMap;
  attachmentMap: TIssueAttachmentMap;
  attachmentsUploadStatusMap: Record<string, Record<string, TAttachmentUploadStatus>>;
  // computed
  issueAttachments: string[] | undefined;
  // helper methods
  getAttachmentsUploadStatusByIssueId: (issueId: string) => TAttachmentUploadStatus[] | undefined;
  getAttachmentsByIssueId: (issueId: string) => string[] | undefined;
  getAttachmentById: (attachmentId: string) => TIssueAttachment | undefined;
  getAttachmentsCountByIssueId: (issueId: string) => number;
}

export class IssueAttachmentStore implements IIssueAttachmentStore {
  // observables
  attachments: TIssueAttachmentIdMap = {};
  attachmentMap: TIssueAttachmentMap = {};
  attachmentsUploadStatusMap: Record<string, Record<string, TAttachmentUploadStatus>> = {};
  // root store
  rootIssueStore: IIssueRootStore;
  rootIssueDetailStore: IIssueDetail;
  // services
  issueAttachmentService;

  constructor(rootStore: IIssueRootStore, serviceType: TIssueServiceType) {
    makeObservable(this, {
      // observables
      attachments: observable,
      attachmentMap: observable,
      attachmentsUploadStatusMap: observable,
      // computed
      issueAttachments: computed,
      // actions
      addAttachments: action.bound,
      fetchAttachments: action,
      createAttachment: action,
      removeAttachment: action,
    });
    // root store
    this.rootIssueStore = rootStore;
    this.rootIssueDetailStore = rootStore.issueDetail;
    // services
    this.issueAttachmentService = new IssueAttachmentService(serviceType);
  }

  // computed
  get issueAttachments() {
    const issueId = this.rootIssueDetailStore.peekIssue?.issueId;
    if (!issueId) return undefined;
    return this.attachments[issueId] ?? undefined;
  }

  // helper methods
  getAttachmentsUploadStatusByIssueId = computedFn((issueId: string) => {
    if (!issueId) return undefined;
    const attachmentsUploadStatus = Object.values(this.attachmentsUploadStatusMap[issueId] ?? {});
    return attachmentsUploadStatus.filter((status) => Boolean(status && status.id && status.name));
  });

  getAttachmentsByIssueId = computedFn((issueId: string) => {
    if (!issueId) return undefined;
    return this.attachments[issueId] ?? undefined;
  });

  getAttachmentById = computedFn((attachmentId: string) => {
    if (!attachmentId) return undefined;
    return this.attachmentMap[attachmentId] ?? undefined;
  });

  getAttachmentsCountByIssueId = computedFn((issueId: string) => {
    const attachments = this.getAttachmentsByIssueId(issueId);
    return attachments?.length ?? 0;
  });

  // actions
  addAttachments = (issueId: string, attachments: TIssueAttachment[]) => {
    if (attachments && attachments.length > 0) {
      const newAttachmentIds = attachments.map((attachment) => attachment.id);
      runInAction(() => {
        const currentIds = this.attachments[issueId] || [];
        const nextIds = uniq([...currentIds, ...newAttachmentIds]);
        const nextAttachmentMap = { ...this.attachmentMap };
        attachments.forEach((attachment) => {
          nextAttachmentMap[attachment.id] = attachment;
        });
        this.attachmentMap = nextAttachmentMap;
        this.attachments = {
          ...this.attachments,
          [issueId]: nextIds,
        };
        this.rootIssueStore.issues.updateIssue(issueId, {
          attachment_count: nextIds.length,
        });
      });
    }
  };

  fetchAttachments = async (workspaceSlug: string, projectId: string, issueId: string) => {
    const response = await this.issueAttachmentService.getIssueAttachments(workspaceSlug, projectId, issueId);
    this.addAttachments(issueId, response);
    runInAction(() => {
      this.rootIssueStore.issues.updateIssue(issueId, {
        attachment_count: this.getAttachmentsCountByIssueId(issueId),
      });
    });
    return response;
  };

  private debouncedUpdateProgress = debounce((issueId: string, tempId: string, progress: number) => {
    runInAction(() => {
      const issueStatusMap = this.attachmentsUploadStatusMap[issueId];
      if (issueStatusMap?.[tempId]) {
        this.attachmentsUploadStatusMap = {
          ...this.attachmentsUploadStatusMap,
          [issueId]: {
            ...issueStatusMap,
            [tempId]: {
              ...issueStatusMap[tempId],
              progress,
            },
          },
        };
      }
    });
  }, 16);

  createAttachment = async (workspaceSlug: string, projectId: string, issueId: string, file: File) => {
    const tempId = uuidv4();
    try {
      // update attachment upload status
      runInAction(() => {
        this.attachmentsUploadStatusMap = {
          ...this.attachmentsUploadStatusMap,
          [issueId]: {
            ...(this.attachmentsUploadStatusMap[issueId] || {}),
            [tempId]: {
              id: tempId,
              name: file.name,
              progress: 0,
              size: file.size,
              type: file.type,
            },
          },
        };
      });
      const response = await this.issueAttachmentService.uploadIssueAttachment(
        workspaceSlug,
        projectId,
        issueId,
        file,
        (progressEvent) => {
          const progressPercentage = Math.round((progressEvent.progress ?? 0) * 100);
          this.debouncedUpdateProgress(issueId, tempId, progressPercentage);
        }
      );

      if (response && response.id) {
        runInAction(() => {
          const currentIds = this.attachments[issueId] || [];
          const nextIds = uniq([...currentIds, response.id]);
          this.attachmentMap = {
            ...this.attachmentMap,
            [response.id]: response,
          };
          this.attachments = {
            ...this.attachments,
            [issueId]: nextIds,
          };
          this.rootIssueStore.issues.updateIssue(issueId, {
            attachment_count: nextIds.length,
          });
        });
      }

      return response;
    } catch (error) {
      console.error("Error in uploading issue attachment:", error);
      throw error;
    } finally {
      this.debouncedUpdateProgress.cancel();
      runInAction(() => {
        const issueStatusMap = { ...(this.attachmentsUploadStatusMap[issueId] || {}) };
        delete issueStatusMap[tempId];
        const nextMap = { ...this.attachmentsUploadStatusMap };
        if (Object.keys(issueStatusMap).length === 0) {
          delete nextMap[issueId];
        } else {
          nextMap[issueId] = issueStatusMap;
        }
        this.attachmentsUploadStatusMap = nextMap;
      });
    }
  };

  removeAttachment = async (workspaceSlug: string, projectId: string, issueId: string, attachmentId: string) => {
    const response = await this.issueAttachmentService.deleteIssueAttachment(
      workspaceSlug,
      projectId,
      issueId,
      attachmentId
    );

    runInAction(() => {
      const currentIds = this.attachments[issueId] || [];
      const nextIds = currentIds.filter((id) => id !== attachmentId);
      const nextAttachmentMap = { ...this.attachmentMap };
      delete nextAttachmentMap[attachmentId];
      this.attachmentMap = nextAttachmentMap;
      this.attachments = {
        ...this.attachments,
        [issueId]: nextIds,
      };
      this.rootIssueStore.issues.updateIssue(issueId, {
        attachment_count: nextIds.length,
      });
    });

    return response;
  };
}
