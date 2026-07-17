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
  deleteIssueSubTaskOnChain,
  getIssueSubTaskStats,
  isOnChainTaskSyncEnabled,
  updateIssueMetadataByIssueIdOnChain,
  updateIssueProgressByIssueIdOnChain,
  updateIssueScheduleByIssueIdOnChain,
  updateIssueSubTaskProgressOnChain,
  updateIssueSubTaskStatusOnChain,
} from "@/services/blockchain/plane-task-chain.service";

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
    let subTaskStatus: 0 | 1 | 2 | 3 =
      group === "cancelled" ? 3 : progress === 100 ? 2 : progress > 0 ? 1 : 0;

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

    if (!isOnChainTaskSyncEnabled()) return issue;

    let transactionHash: string;
    let assigneeWallet: string;
    try {
      const chainResult = await createIssueOnChain(issue);
      transactionHash = chainResult.transactionHash;
      assigneeWallet = chainResult.assigneeWallet;
    } catch (chainError) {
      console.error("On-chain task creation failed. Rolling back the Plane task:", chainError);
      try {
        await this.delete(`/api/workspaces/${workspaceSlug}/projects/${projectId}/${this.serviceType}/${issue.id}/`);
      } catch (rollbackError) {
        console.error("Failed to roll back the Plane task after the blockchain error:", rollbackError);
        throw {
          error: "Giao dịch blockchain thất bại và không thể tự xóa task tạm. Hãy xóa task này thủ công.",
          cause: chainError,
        };
      }

      const message =
        chainError instanceof Error ? chainError.message : "Giao dịch blockchain đã bị hủy hoặc thất bại.";
      throw { error: `Không tạo task: ${message}`, cause: chainError };
    }

    try {
      await this.post(`/api/workspaces/${workspaceSlug}/projects/${projectId}/blockchain-transactions/`, {
        event_type: "create_task",
        issue_id: issue.id,
        issue_name: issue.name,
        parent_issue_id: issue.parent_id,
        target_date: issue.target_date,
        priority: issue.priority,
        assignee_wallet: assigneeWallet,
        assignee_id: issue.assignee_ids?.[0],
        wallet_address: process.env.VITE_METANODE_WALLET_ADDRESS,
        contract_address: process.env.VITE_CONTRACT_ADDRESS,
        chain_id: process.env.VITE_CHAIN_ID,
        transaction_hash: transactionHash,
      });
    } catch (trackingError) {
      console.error("Task đã được tạo on-chain nhưng không thể ghi file blockchain-data.json:", trackingError);
    }

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
    if (isOnChainTaskSyncEnabled()) {
      const metadataFields = [
        "name",
        "description_html",
        "description_json",
        "description_stripped",
        "description_binary",
      ];
      const needsCurrentIssue =
        Boolean(data.state_id) ||
        "priority" in data ||
        "target_date" in data ||
        metadataFields.some((field) => field in data);
      const currentIssue = needsCurrentIssue ? await this.retrieve(workspaceSlug, projectId, issueId) : undefined;

      if (data.state_id && currentIssue) {
        await this.syncIssueStateOnChain(workspaceSlug, projectId, issueId, data.state_id, currentIssue);
      }

      if (("priority" in data || "target_date" in data) && currentIssue) {
        const updatedIssue = { ...currentIssue, ...data } as TIssue;
        await updateIssueScheduleByIssueIdOnChain(issueId, updatedIssue.target_date, updatedIssue.priority);
      }

      if (metadataFields.some((field) => field in data) && currentIssue) {
        await updateIssueMetadataByIssueIdOnChain({ ...currentIssue, ...data } as TIssue);
      }
    }

    if (isOnChainTaskSyncEnabled() && data.assignee_ids) {
      const assigneeId = data.assignee_ids.at(-1);
      if (!assigneeId) throw { error: "Task phải có một nhân viên phụ trách." };
      const storedWallet = await blockchainTrackingService
        .getStoredAssigneeWallet(workspaceSlug, projectId, assigneeId)
        .catch(() => "");
      const assigneeWallet =
        consumePendingAssignmentWallet(issueId) || storedWallet || process.env.VITE_METANODE_WALLET_ADDRESS || "";
      if (!isWalletAddress(assigneeWallet)) throw { error: "Chưa có địa chỉ ví MetaNode hợp lệ của nhân viên." };

      const transactionHash = await assignIssueByIssueIdOnChain(issueId, assigneeWallet);
      const response = await this.patch(
        `/api/workspaces/${workspaceSlug}/projects/${projectId}/${this.serviceType}/${issueId}/`,
        { ...data, assignee_ids: [assigneeId] }
      ).then((result) => result?.data);
      await blockchainTrackingService.recordTaskAssignment(workspaceSlug, projectId, {
        issueId,
        issueName: response?.name || issueId,
        transactionHash,
        assigneeWallet,
        assigneeId,
        assigneeName: "",
      });
      return response;
    }
    return this.patch(`/api/workspaces/${workspaceSlug}/projects/${projectId}/${this.serviceType}/${issueId}/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }
  async deleteIssue(workspaceSlug: string, projectId: string, issuesId: string): Promise<any> {
    if (!isOnChainTaskSyncEnabled()) {
      return this.delete(`/api/workspaces/${workspaceSlug}/projects/${projectId}/${this.serviceType}/${issuesId}/`)
        .then((response) => response?.data)
        .catch((error) => {
          throw error?.response?.data;
        });
    }

    const issue = await this.retrieve(workspaceSlug, projectId, issuesId);
    const currentContract = process.env.VITE_CONTRACT_ADDRESS?.trim().toLowerCase() || "";
    const creationRecords = (await blockchainTrackingService.getTransactions(workspaceSlug, projectId)).filter(
      (record) =>
        record.issue_id === issuesId && record.event_type === "create_task" && Boolean(record.contract_address)
    );
    const existsOnCurrentContract = creationRecords.some(
      (record) => record.contract_address?.trim().toLowerCase() === currentContract
    );

    if (!existsOnCurrentContract) {
      console.warn(
        creationRecords.length > 0
          ? `Task ${issuesId} thuộc contract cũ; chỉ xóa dữ liệu Plane vì contract hiện tại không có task này.`
          : `Task ${issuesId} không có bản ghi tạo on-chain; chỉ xóa dữ liệu Plane.`
      );
      return this.delete(
        `/api/workspaces/${workspaceSlug}/projects/${projectId}/${this.serviceType}/${issuesId}/`
      ).then((result) => result?.data);
    }

    if (issue.parent_id) {
      await deleteIssueSubTaskOnChain(issue.parent_id, issuesId);
    }
    const transactionHash = await deleteIssueByIssueIdOnChain(issuesId);
    const response = await this.delete(
      `/api/workspaces/${workspaceSlug}/projects/${projectId}/${this.serviceType}/${issuesId}/`
    ).then((result) => result?.data);
    await blockchainTrackingService.recordTaskDeletion(workspaceSlug, projectId, {
      issueId: issuesId,
      issueName: issue.name,
      transactionHash,
    });
    return response;
  }

  async updateIssueDates(
    workspaceSlug: string,
    projectId: string,
    updates: { id: string; start_date?: string; target_date?: string }[]
  ): Promise<void> {
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
