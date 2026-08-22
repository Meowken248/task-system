/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// plane imports
import { API_BASE_URL } from "@plane/constants";
import { EIssueServiceType } from "@plane/types";
import type {
  TIssueParams,
  IIssueDisplayProperties,
  TBulkOperationsPayload,
  TIssue,
  TIssueActivity,
  TIssueLink,
  TIssueServiceType,
  TIssuesResponse,
  TIssueSubIssues,
} from "@plane/types";
// services
import { APIService } from "@/services/api.service";
import { blockchainTrackingService } from "@/services/blockchain/blockchain-tracking.service";
import { isWalletAddress } from "@/services/blockchain/metanode-wallet.service";
import {
  assignIssueByIssueIdOnChain,
  cancelIssueByIssueIdOnChain,
  consumePendingAssignmentWallet,
  createIssueOnChain,
  deleteIssueByIssueIdOnChain,
  getIssueSubTaskStats,
  isOnChainTaskSyncAvailable,
  issueExistsOnChain,
  updateIssueMetadataByIssueIdOnChain,
  updateIssueProgressByIssueIdOnChain,
  updateIssueScheduleByIssueIdOnChain,
  updateIssueSubTaskProgressOnChain,
  updateIssueSubTaskStatusOnChain,
} from "@/services/blockchain/plane-task-chain.service";

const assertStartDateIsNotInPast = (startDate: string | null | undefined) => {
  if (!startDate) return;

  const selectedDate = new Date(`${startDate.slice(0, 10)}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (Number.isNaN(selectedDate.getTime()) || selectedDate < today) {
    throw { error: "Ngày bắt đầu không được phép là ngày trong quá khứ." };
  }
};

export class IssueService extends APIService {
  private serviceType: TIssueServiceType;

  constructor(serviceType: TIssueServiceType = EIssueServiceType.ISSUES) {
    super(API_BASE_URL);
    this.serviceType = serviceType;
  }

  private async syncIssueStateOnChain(
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    stateId: string,
    currentIssue: TIssue
  ): Promise<void> {
    const state = await this.get(`/api/workspaces/${workspaceSlug}/projects/${projectId}/states/${stateId}/`).then(
      (response) => response?.data
    );
    const group = state?.group as string | undefined;
    if (!group) throw new Error("Không thể xác định trạng thái để đồng bộ on-chain.");

    let progress = group === "completed" ? 100 : group === "started" ? 50 : 0;
    let subTaskStatus: 0 | 1 | 2 | 3 = group === "cancelled" ? 3 : progress === 100 ? 2 : progress > 0 ? 1 : 0;

    if (group === "cancelled") {
      await cancelIssueByIssueIdOnChain(issueId);
    } else {
      const stats = await getIssueSubTaskStats(issueId);
      if (stats.activeCount === 0) {
        await updateIssueProgressByIssueIdOnChain(issueId, progress);
      } else if (progress !== stats.progress) {
        throw new Error("Task cha có task con nên tiến độ phải được tính tự động từ các task con.");
      }
    }

    let childIssueId = issueId;
    let parentIssueId = currentIssue.parent_id;
    while (parentIssueId) {
      // Each parent update is a separate wallet-confirmed transaction.
      const syncTransaction =
        subTaskStatus === 3
          ? updateIssueSubTaskStatusOnChain(parentIssueId, childIssueId, subTaskStatus)
          : updateIssueSubTaskProgressOnChain(parentIssueId, childIssueId, progress);
      // eslint-disable-next-line no-await-in-loop
      await syncTransaction;
      // eslint-disable-next-line no-await-in-loop
      const parentStats = await getIssueSubTaskStats(parentIssueId);
      progress = parentStats.progress;
      subTaskStatus = progress === 100 ? 2 : progress > 0 ? 1 : 0;
      childIssueId = parentIssueId;
      // eslint-disable-next-line no-await-in-loop
      const parentIssue = await this.retrieve(workspaceSlug, projectId, parentIssueId);
      parentIssueId = parentIssue.parent_id;
    }
  }

  async createIssue(workspaceSlug: string, projectId: string, data: Partial<TIssue>): Promise<TIssue> {
    assertStartDateIsNotInPast(data.start_date);

    let issue: TIssue;
    try {
      const response = await this.post(
        `/api/workspaces/${workspaceSlug}/projects/${projectId}/${this.serviceType}/`,
        data
      );
      issue = response?.data;
    } catch (error: any) {
      throw error?.response?.data ?? error;
    }

    if (!isOnChainTaskSyncAvailable()) {
      throw new Error("Không thể kết nối với hệ thống Blockchain. Không thể tạo Task.");
    }

    let transactionHash: string;
    let assigneeWallet: string;
    try {
      const chainResult = await createIssueOnChain(issue);
      transactionHash = chainResult.transactionHash;
      assigneeWallet = chainResult.assigneeWallet;
    } catch (chainError) {
      const message = chainError instanceof Error ? chainError.message : "Giao dịch blockchain bị hủy hoặc thất bại.";
      throw { error: message, isChainError: true };
    }

    void blockchainTrackingService
      .recordTaskCreation(workspaceSlug, projectId, {
        issueId: issue.id,
        issueName: issue.name,
        parentIssueId: issue.parent_id,
        targetDate: issue.target_date,
        priority: issue.priority,
        assigneeWallet,
        assigneeId: issue.assignee_ids?.[0],
        transactionHash,
      })
      .catch((trackingError) => {
        console.warn("Task đã được tạo on-chain; audit đang chờ tự đồng bộ.", trackingError);
      });

    return issue;
  }

  async getIssuesFromServer(
    workspaceSlug: string,
    projectId: string,
    queries?: any,
    config = {}
  ): Promise<TIssuesResponse> {
    const path =
      (queries.expand as string)?.includes("issue_relation") && !queries.group_by
        ? `/api/workspaces/${workspaceSlug}/projects/${projectId}/${this.serviceType}-detail/`
        : `/api/workspaces/${workspaceSlug}/projects/${projectId}/${this.serviceType}/`;
    return this.get(
      path,
      {
        params: queries,
      },
      config
    )
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async getIssuesForSync(
    workspaceSlug: string,
    projectId: string,
    queries?: any,
    config = {}
  ): Promise<TIssuesResponse> {
    return this.get(
      `/api/workspaces/${workspaceSlug}/projects/${projectId}/v2/${this.serviceType}/`,
      { params: queries },
      config
    )
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async getIssues(
    workspaceSlug: string,
    projectId: string,
    queries?: Partial<Record<TIssueParams, string | boolean>>,
    config = {}
  ): Promise<TIssuesResponse> {
    return this.getIssuesFromServer(workspaceSlug, projectId, queries, config);
  }

  async getDeletedIssues(workspaceSlug: string, projectId: string, queries?: any): Promise<TIssuesResponse> {
    return this.get(`/api/workspaces/${workspaceSlug}/projects/${projectId}/deleted-issues/`, {
      params: queries,
    })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async getIssuesWithParams(
    workspaceSlug: string,
    projectId: string,
    queries?: any
  ): Promise<TIssue[] | { [key: string]: TIssue[] }> {
    return this.get(`/api/workspaces/${workspaceSlug}/projects/${projectId}/${this.serviceType}/`, {
      params: queries,
    })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async retrieve(workspaceSlug: string, projectId: string, issueId: string, queries?: any): Promise<TIssue> {
    return this.get(`/api/workspaces/${workspaceSlug}/projects/${projectId}/${this.serviceType}/${issueId}/`, {
      params: queries,
    })
      .then(async (response) => {
        // add is_epic flag when the service type is epic
        if (response.data && this.serviceType === EIssueServiceType.EPICS) {
          response.data.is_epic = true;
        }
        return response?.data;
      })
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async retrieveIssues(workspaceSlug: string, projectId: string, issueIds: string[]): Promise<TIssue[]> {
    return this.get(`/api/workspaces/${workspaceSlug}/projects/${projectId}/${this.serviceType}/list/`, {
      params: { issues: issueIds.join(",") },
    })
      .then(async (response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async getIssueActivities(workspaceSlug: string, projectId: string, issueId: string): Promise<TIssueActivity[]> {
    return this.get(`/api/workspaces/${workspaceSlug}/projects/${projectId}/${this.serviceType}/${issueId}/history/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async addIssueToCycle(
    workspaceSlug: string,
    projectId: string,
    cycleId: string,
    data: {
      issues: string[];
    }
  ) {
    return this.post(`/api/workspaces/${workspaceSlug}/projects/${projectId}/cycles/${cycleId}/cycle-issues/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async removeIssueFromCycle(workspaceSlug: string, projectId: string, cycleId: string, bridgeId: string) {
    return this.delete(
      `/api/workspaces/${workspaceSlug}/projects/${projectId}/cycles/${cycleId}/cycle-issues/${bridgeId}/`
    )
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async createIssueRelation(
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    data: {
      related_list: Array<{
        relation_type: "duplicate" | "relates_to" | "blocked_by";
        related_issue: string;
      }>;
      relation?: "blocking" | null;
    }
  ) {
    return this.post(
      `/api/workspaces/${workspaceSlug}/projects/${projectId}/${this.serviceType}/${issueId}/issue-relation/`,
      data
    )
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response;
      });
  }

  async deleteIssueRelation(workspaceSlug: string, projectId: string, issueId: string, relationId: string) {
    return this.delete(
      `/api/workspaces/${workspaceSlug}/projects/${projectId}/${this.serviceType}/${issueId}/issue-relation/${relationId}/`
    )
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response;
      });
  }

  async getIssueDisplayProperties(workspaceSlug: string, projectId: string): Promise<any> {
    return this.get(`/api/workspaces/${workspaceSlug}/projects/${projectId}/issue-display-properties/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async updateIssueDisplayProperties(
    workspaceSlug: string,
    projectId: string,
    data: IIssueDisplayProperties
  ): Promise<any> {
    return this.post(`/api/workspaces/${workspaceSlug}/projects/${projectId}/issue-display-properties/`, {
      properties: data,
    })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async patchIssue(workspaceSlug: string, projectId: string, issueId: string, data: Partial<TIssue>): Promise<any> {
    if ("start_date" in data) assertStartDateIsNotInPast(data.start_date);

    const updatedIssue = await this.patch(
      `/api/workspaces/${workspaceSlug}/projects/${projectId}/${this.serviceType}/${issueId}/`,
      data
    )
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });

    if (isOnChainTaskSyncAvailable()) {
      try {
        const metadataFields = [
          "name",
          "description_html",
          "description_json",
          "description_stripped",
          "description_binary",
        ];

        if (data.state_id) {
          await this.syncIssueStateOnChain(workspaceSlug, projectId, issueId, data.state_id, updatedIssue);
        }

        if ("priority" in data || "target_date" in data) {
          await updateIssueScheduleByIssueIdOnChain(issueId, updatedIssue.target_date, updatedIssue.priority);
        }

        if (metadataFields.some((field) => field in data)) {
          await updateIssueMetadataByIssueIdOnChain(updatedIssue as TIssue);
        }
      } catch (chainError) {
        throw { error: chainError instanceof Error ? chainError.message : "Cập nhật on-chain thất bại.", isChainError: true };
      }
    }

    if (isOnChainTaskSyncAvailable() && data.assignee_ids) {
      const assigneeId = data.assignee_ids.at(-1);
      if (!assigneeId) return updatedIssue;
      const storedWallet = await blockchainTrackingService
        .getStoredAssigneeWallet(workspaceSlug, projectId, assigneeId)
        .catch(() => "");
      const assigneeWallet = consumePendingAssignmentWallet(issueId) || storedWallet;
      if (isWalletAddress(assigneeWallet)) {
        try {
          const transactionHash = await assignIssueByIssueIdOnChain(issueId, assigneeWallet);
          void blockchainTrackingService
            .recordTaskAssignment(workspaceSlug, projectId, {
              issueId,
              issueName: updatedIssue.name || issueId,
              transactionHash,
              assigneeWallet,
              assigneeId,
              assigneeName: "",
            })
            .catch((trackingError) => {
              console.warn("Giao task đã thành công; audit đang chờ tự đồng bộ.", trackingError);
            });
        } catch (chainError) {
          throw { error: chainError instanceof Error ? chainError.message : "Giao task on-chain thất bại.", isChainError: true };
        }
      }
    }
    return updatedIssue;
  }
  async deleteIssue(workspaceSlug: string, projectId: string, issuesId: string): Promise<any> {
    if (!isOnChainTaskSyncAvailable()) {
      return this.delete(`/api/workspaces/${workspaceSlug}/projects/${projectId}/${this.serviceType}/${issuesId}/`)
        .then((response) => response?.data)
        .catch((error) => {
          throw error?.response?.data;
        });
    }

    try {
      const issue = await this.retrieve(workspaceSlug, projectId, issuesId);
      const existsOnCurrentContract = await issueExistsOnChain(issuesId);

      if (existsOnCurrentContract) {
        const transactionHash = await deleteIssueByIssueIdOnChain(issuesId, issue.parent_id);
        void blockchainTrackingService
          .recordTaskDeletion(workspaceSlug, projectId, {
            issueId: issuesId,
            issueName: issue.name,
            transactionHash,
          })
          .catch((trackingError) => {
            console.warn("Task đã xóa on-chain; audit đang chờ tự đồng bộ.", trackingError);
          });
      } else {
        void blockchainTrackingService
          .recordOfflineTaskDeletion(workspaceSlug, projectId, {
            issueId: issuesId,
            issueName: issue.name,
          })
          .catch((trackingError) => {
            console.warn("Task offline đã xóa; audit đang chờ tự đồng bộ.", trackingError);
          });
      }
    } catch (chainError) {
      console.warn("Không xóa được task on-chain; vẫn tiếp tục xóa task trên Plane.", chainError);
    }

    return this.delete(`/api/workspaces/${workspaceSlug}/projects/${projectId}/${this.serviceType}/${issuesId}/`)
      .then((result) => result?.data)
      .catch((error) => {
        throw error?.response?.data ?? error;
      });
  }

  async updateIssueDates(
    workspaceSlug: string,
    projectId: string,
    updates: { id: string; start_date?: string; target_date?: string }[]
  ): Promise<void> {
    updates.forEach((update) => {
      if ("start_date" in update) assertStartDateIsNotInPast(update.start_date);
    });

    return this.post(`/api/workspaces/${workspaceSlug}/projects/${projectId}/issue-dates/`, { updates })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async subIssues(
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    queries?: Partial<Record<TIssueParams, string | boolean>>
  ): Promise<TIssueSubIssues> {
    return this.get(
      `/api/workspaces/${workspaceSlug}/projects/${projectId}/${this.serviceType}/${issueId}/${this.serviceType === EIssueServiceType.EPICS ? "issues" : "sub-issues"}/`,
      { params: queries }
    )
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async addSubIssues(
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    data: { sub_issue_ids: string[] }
  ): Promise<TIssueSubIssues> {
    return this.post(
      `/api/workspaces/${workspaceSlug}/projects/${projectId}/${this.serviceType}/${issueId}/${this.serviceType === EIssueServiceType.EPICS ? "issues" : "sub-issues"}/`,
      data
    )
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async fetchIssueLinks(workspaceSlug: string, projectId: string, issueId: string): Promise<TIssueLink[]> {
    return this.get(
      `/api/workspaces/${workspaceSlug}/projects/${projectId}/${this.serviceType}/${issueId}/${this.serviceType === EIssueServiceType.EPICS ? "links" : "issue-links"}/`
    )
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response;
      });
  }

  async createIssueLink(
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    data: Partial<TIssueLink>
  ): Promise<TIssueLink> {
    return this.post(
      `/api/workspaces/${workspaceSlug}/projects/${projectId}/${this.serviceType}/${issueId}/${this.serviceType === EIssueServiceType.EPICS ? "links" : "issue-links"}/`,
      data
    )
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response;
      });
  }

  async updateIssueLink(
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    linkId: string,
    data: Partial<TIssueLink>
  ): Promise<TIssueLink> {
    return this.patch(
      `/api/workspaces/${workspaceSlug}/projects/${projectId}/${this.serviceType}/${issueId}/${this.serviceType === EIssueServiceType.EPICS ? "links" : "issue-links"}/${linkId}/`,
      data
    )
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response;
      });
  }

  async deleteIssueLink(workspaceSlug: string, projectId: string, issueId: string, linkId: string): Promise<any> {
    return this.delete(
      `/api/workspaces/${workspaceSlug}/projects/${projectId}/${this.serviceType}/${issueId}/${this.serviceType === EIssueServiceType.EPICS ? "links" : "issue-links"}/${linkId}/`
    )
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async bulkOperations(workspaceSlug: string, projectId: string, data: TBulkOperationsPayload): Promise<any> {
    return this.post(`/api/workspaces/${workspaceSlug}/projects/${projectId}/bulk-operation-issues/`, data)
      .then(async (response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async bulkDeleteIssues(
    workspaceSlug: string,
    projectId: string,
    data: {
      issue_ids: string[];
    }
  ): Promise<any> {
    return this.delete(`/api/workspaces/${workspaceSlug}/projects/${projectId}/bulk-delete-issues/`, data)
      .then(async (response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async bulkArchiveIssues(
    workspaceSlug: string,
    projectId: string,
    data: {
      issue_ids: string[];
    }
  ): Promise<{
    archived_at: string;
  }> {
    return this.post(`/api/workspaces/${workspaceSlug}/projects/${projectId}/bulk-archive-issues/`, data)
      .then(async (response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  // issue subscriptions
  async getIssueNotificationSubscriptionStatus(
    workspaceSlug: string,
    projectId: string,
    issueId: string
  ): Promise<{
    subscribed: boolean;
  }> {
    return this.get(`/api/workspaces/${workspaceSlug}/projects/${projectId}/${this.serviceType}/${issueId}/subscribe/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async unsubscribeFromIssueNotifications(workspaceSlug: string, projectId: string, issueId: string): Promise<any> {
    return this.delete(
      `/api/workspaces/${workspaceSlug}/projects/${projectId}/${this.serviceType}/${issueId}/subscribe/`
    )
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async subscribeToIssueNotifications(workspaceSlug: string, projectId: string, issueId: string): Promise<any> {
    return this.post(`/api/workspaces/${workspaceSlug}/projects/${projectId}/${this.serviceType}/${issueId}/subscribe/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async bulkSubscribeIssues(
    workspaceSlug: string,
    projectId: string,
    data: {
      issue_ids: string[];
    }
  ): Promise<any> {
    return this.post(`/api/workspaces/${workspaceSlug}/projects/${projectId}/bulk-subscribe-issues/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async getIssueMetaFromURL(
    workspaceSlug: string,
    projectId: string,
    issueId: string
  ): Promise<{
    project_identifier: string;
    sequence_id: string;
  }> {
    return this.get(`/api/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/meta/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async retrieveWithIdentifier(
    workspaceSlug: string,
    project_identifier: string,
    issue_sequence: string,
    queries?: any
  ): Promise<TIssue> {
    return this.get(`/api/workspaces/${workspaceSlug}/work-items/${project_identifier}-${issue_sequence}/`, {
      params: queries,
    })
      .then(async (response) => {
        // add is_epic flag when the service type is epic
        if (response.data && this.serviceType === EIssueServiceType.EPICS) {
          response.data.is_epic = true;
        }
        return response?.data;
      })
      .catch((error) => {
        throw error?.response?.data;
      });
  }
}
