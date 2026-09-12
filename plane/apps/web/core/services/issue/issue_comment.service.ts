/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// plane types
import { API_BASE_URL } from "@plane/constants";
import type { TIssueComment, TIssueServiceType } from "@plane/types";
import { EIssueServiceType } from "@plane/types";
// services
import { APIService } from "@/services/api.service";
import { blockchainTrackingService } from "@/services/blockchain/blockchain-tracking.service";
import { isOnChainTaskSyncAvailable, recordIssueContentOnChain } from "@/services/blockchain/plane-task-chain.service";
import { FileUploadService } from "@/services/file-upload.service";

export class IssueCommentService extends APIService {
  private fileUploadService: FileUploadService;
  private serviceType: TIssueServiceType;

  constructor(serviceType: TIssueServiceType = EIssueServiceType.ISSUES) {
    super(API_BASE_URL);
    // upload service
    this.fileUploadService = new FileUploadService();
    this.serviceType = serviceType;
  }

  async getIssueComments(
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    params:
      | {
          created_at__gt: string;
        }
      | object = {}
  ): Promise<TIssueComment[]> {
    return this.get(`/api/workspaces/${workspaceSlug}/projects/${projectId}/${this.serviceType}/${issueId}/history/`, {
      params: {
        activity_type: `${this.serviceType === EIssueServiceType.EPICS ? "epic-comment" : "issue-comment"}`,
        ...params,
      },
    })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async createIssueComment(
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    data: Partial<TIssueComment>
  ): Promise<TIssueComment> {
    const comment = await this.post(
      `/api/workspaces/${workspaceSlug}/projects/${projectId}/${this.serviceType}/${issueId}/comments/`,
      data
    )
      .then((response) => response?.data as TIssueComment)
      .catch((error) => {
        throw error?.response?.data ?? error;
      });
    if (!isOnChainTaskSyncAvailable()) {
      throw new Error("Không thể kết nối với hệ thống Blockchain. Không thể tạo bình luận.");
    }
    if (data.external_source === "blockchain-daily-report") return comment;

    try {
      const { transactionHash, contentHash } = await recordIssueContentOnChain(
        issueId,
        0,
        comment.comment_stripped || comment.comment_html
      );
      void blockchainTrackingService
        .recordTaskContent(workspaceSlug, projectId, {
          issueId,
          transactionHash,
          kind: "comment",
          reference: comment.id,
          contentHash,
        })
        .catch((trackingError) => console.warn("Audit bình luận đang chờ tự đồng bộ.", trackingError));
      return comment;
    } catch (error) {
      throw { error: error instanceof Error ? error.message : "Đồng bộ bình luận on-chain thất bại.", isChainError: true };
    }
  }

  async patchIssueComment(
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    commentId: string,
    data: Partial<TIssueComment>
  ): Promise<TIssueComment> {
    return this.patch(
      `/api/workspaces/${workspaceSlug}/projects/${projectId}/${this.serviceType}/${issueId}/comments/${commentId}/`,
      data
    )
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async deleteIssueComment(
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    commentId: string
  ): Promise<void> {
    return this.delete(
      `/api/workspaces/${workspaceSlug}/projects/${projectId}/${this.serviceType}/${issueId}/comments/${commentId}/`
    )
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }
}
