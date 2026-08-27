/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { AxiosRequestConfig } from "axios";
import { API_BASE_URL } from "@plane/constants";
// plane types
import { getFileMetaDataForUpload, generateFileUploadPayload } from "@plane/services";
import type { TIssueAttachment, TIssueAttachmentUploadResponse, TIssueServiceType } from "@plane/types";
import { EIssueServiceType } from "@plane/types";
// services
import { APIService } from "@/services/api.service";
import { blockchainTrackingService } from "@/services/blockchain/blockchain-tracking.service";
import { isOnChainTaskSyncAvailable, recordIssueContentOnChain } from "@/services/blockchain/plane-task-chain.service";
import { FileUploadService } from "@plane/services";
import { saveAttachmentToStorage } from "@plane/utils";

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

    const formData = new FormData();
    formData.append("asset", file);

    let uploadResult: any;
    try {
      uploadResult = await this.fileUploadService.uploadFile("", formData);
    } catch (uploadError) {
      throw { error: uploadError instanceof Error ? uploadError.message : "Tải file lên hệ thống phi tập trung thất bại." };
    }

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

    return {
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
  }

  async getIssueAttachments(workspaceSlug: string, projectId: string, issueId: string): Promise<TIssueAttachment[]> {
    // TODO: Cần thay bằng gọi Smart Contract thật hoặc indexer.
    // Tạm thời trả về mảng rỗng để không phụ thuộc vào mock server.
    return [];
  }

  async deleteIssueAttachment(
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    assetId: string
  ): Promise<TIssueAttachment> {
    throw { error: "Xóa tệp đính kèm trên blockchain chưa được hỗ trợ." };
  }
}
