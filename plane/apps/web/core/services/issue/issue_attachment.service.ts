/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { AxiosRequestConfig } from "axios";
import { API_BASE_URL } from "@plane/constants";
// plane types
import type { TIssueAttachment, TIssueServiceType } from "@plane/types";
import { EIssueServiceType } from "@plane/types";
// services
import { APIService } from "@/services/api.service";
import { blockchainTrackingService } from "@/services/blockchain/blockchain-tracking.service";
import { isOnChainTaskSyncAvailable, recordIssueContentOnChain } from "@/services/blockchain/plane-task-chain.service";
import { FileUploadService, localDB, saveDB } from "@plane/services";
import { saveAttachmentToStorage, deleteAttachmentFromStorage } from "@plane/utils";

export class IssueAttachmentService extends APIService {
  private fileUploadService: FileUploadService;
  private serviceType: TIssueServiceType;

  constructor(serviceType: TIssueServiceType = EIssueServiceType.ISSUES) {
    super(API_BASE_URL);
    // upload service
    this.fileUploadService = new FileUploadService();
    this.serviceType = serviceType;
  }

  async uploadIssueAttachment(
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    file: File,
    uploadProgressHandler?: AxiosRequestConfig["onUploadProgress"]
  ): Promise<TIssueAttachment> {
    if (!isOnChainTaskSyncAvailable()) {
      throw new Error("Không thể kết nối với hệ thống Blockchain. Không thể tải file đính kèm.");
    }

    // Step 1: Initial upload progress (30%)
    uploadProgressHandler?.({
      loaded: Math.floor(file.size * 0.3),
      total: file.size,
      progress: 0.3,
    } as any);

    const formData = new FormData();
    formData.append("asset", file);

    let uploadResult: any;
    try {
      uploadResult = await this.fileUploadService.uploadFile("", formData);
    } catch (uploadError) {
      throw { error: uploadError instanceof Error ? uploadError.message : "Tải file lên hệ thống phi tập trung thất bại." };
    }

    // Step 2: File processed and hashed (70%)
    uploadProgressHandler?.({
      loaded: Math.floor(file.size * 0.7),
      total: file.size,
      progress: 0.7,
    } as any);

    const assetId = uploadResult?.asset || uploadResult?.id || "unknown-asset";
    const evidenceReference = `${assetId}:${file.name}:${file.size}:${file.lastModified}`;

    try {
      const { transactionHash, contentHash } = await recordIssueContentOnChain(issueId, 2, evidenceReference);
      void blockchainTrackingService
        .recordTaskContent(workspaceSlug, projectId, {
          issueId,
          transactionHash,
          kind: "evidence",
          reference: assetId,
          contentHash,
        })
        .catch((trackingError) => console.warn("Audit tệp đính kèm đang chờ tự đồng bộ.", trackingError));
    } catch (chainError) {
      throw { error: chainError instanceof Error ? chainError.message : "Ghi bằng chứng đính kèm lên blockchain thất bại.", isChainError: true };
    }

    const attachmentId = uploadResult?.id || Math.random().toString(36).substr(2, 9);
    const assetUrl = uploadResult?.asset_url || assetId;

    if (uploadResult?.base64) {
      void saveAttachmentToStorage(assetId, {
        name: file.name,
        base64: uploadResult.base64,
        type: file.type || "application/octet-stream",
        size: file.size,
      }).catch((err) => console.warn("Failed to persist attachment to local IndexedDB:", err));

      if (attachmentId !== assetId) {
        void saveAttachmentToStorage(attachmentId, {
          name: file.name,
          base64: uploadResult.base64,
          type: file.type || "application/octet-stream",
          size: file.size,
        }).catch(() => {});
      }
    }

    const attachmentRecord: TIssueAttachment = {
      id: attachmentId,
      asset_url: assetUrl,
      attributes: {
        name: file.name,
        size: file.size,
      },
      issue_id: issueId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      created_by: "",
      updated_by: "",
      project: projectId,
      workspace: workspaceSlug,
      issue: issueId,
    } as unknown as TIssueAttachment;

    // Persist attachment into localDB for query across sessions
    if (!localDB.attachments) {
      localDB.attachments = [];
    }
    localDB.attachments = localDB.attachments.filter((a: any) => a.id !== attachmentId);
    localDB.attachments.push(attachmentRecord);
    saveDB();

    // Step 3: Complete progress (100%)
    uploadProgressHandler?.({
      loaded: file.size,
      total: file.size,
      progress: 1.0,
    } as any);

    return attachmentRecord;
  }

  async getIssueAttachments(workspaceSlug: string, projectId: string, issueId: string): Promise<TIssueAttachment[]> {
    const allAttachments = localDB.attachments || [];
    return allAttachments.filter((a: any) => a.issue === issueId || a.issue_id === issueId);
  }

  async deleteIssueAttachment(
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    assetId: string
  ): Promise<TIssueAttachment> {
    const allAttachments = localDB.attachments || [];
    const target = allAttachments.find((a: any) => a.id === assetId || a.asset === assetId);
    localDB.attachments = allAttachments.filter((a: any) => a.id !== assetId && a.asset !== assetId);
    saveDB();

    void deleteAttachmentFromStorage(assetId).catch(() => {});
    if (target?.id && target.id !== assetId) {
      void deleteAttachmentFromStorage(target.id).catch(() => {});
    }

    return (target || { id: assetId, issue_id: issueId }) as TIssueAttachment;
  }
}

