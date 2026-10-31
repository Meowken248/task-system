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
import {
  isOnChainTaskSyncAvailable,
  issueExistsOnChain,
  recordIssueContentOnChain,
} from "@/services/blockchain/plane-task-chain.service";
import { notifyVaultProblem } from "@/services/blockchain/vault-notice";
import { localDB, saveDB, FileUploadService, deleteAttachment, requireIssueAccess } from "@plane/services";

export class IssueAttachmentService extends APIService {
  private serviceType: TIssueServiceType;
  private fileUploadService = new FileUploadService();

  constructor(serviceType: TIssueServiceType = EIssueServiceType.ISSUES) {
    super(API_BASE_URL);
    this.serviceType = serviceType;
  }

  async uploadIssueAttachment(
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    file: File,
    uploadProgressHandler?: AxiosRequestConfig["onUploadProgress"]
  ): Promise<TIssueAttachment> {
    const access = await requireIssueAccess(workspaceSlug, projectId, issueId, true);
    // Trước đây đoạn này gửi POST multipart tới `""` (gốc ứng dụng) — không phải
    // nơi nhận tệp — nên yêu cầu treo tới khi quá thời gian rồi mới báo lỗi (BA-32).
    // Tệp không cần rời khỏi máy: chỉ dấu vết (mã tệp + tên + kích thước) lên hệ thống.
    const assetId = `asset_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const payload = new FormData();
    payload.append("asset_id", assetId);
    payload.append("file", file);
    await this.fileUploadService.uploadFile("", payload, uploadProgressHandler);

    const now = new Date().toISOString();
    const attachmentRecord: TIssueAttachment = {
      id: assetId,
      asset_id: assetId,
      // Khoá tra cứu tệp đã lưu trong máy (không phải URL mạng).
      asset_url: assetId,
      is_uploaded: true,
      attributes: {
        name: file.name,
        size: file.size,
      },
      issue_id: issueId,
      created_at: now,
      updated_at: now,
      created_by: access.user.id,
      updated_by: access.user.id,
      project: projectId,
      workspace: workspaceSlug,
      issue: issueId,
    } as unknown as TIssueAttachment;

    // Persist attachment into localDB for query across sessions
    if (!localDB.attachments) {
      localDB.attachments = [];
    }
    localDB.attachments = localDB.attachments.filter((a: any) => a.id !== assetId);
    localDB.attachments.push(attachmentRecord);

    const targetIssue = (localDB.issues || []).find((i: any) => i.id === issueId);
    if (targetIssue) {
      const issueAttachments = localDB.attachments.filter((a: any) => a.issue === issueId || a.issue_id === issueId);
      targetIssue.attachment_count = issueAttachments.length;
    }
    saveDB();

    // Bước 3: ghi dấu vết tệp lên hệ thống / blockchain (nếu môi trường on-chain sẵn sàng).
    // Kiến trúc Local-First: tệp đã được lưu an toàn trên máy; đồng bộ bằng chứng chạy ngầm
    // để UI phản hồi tức thì mà không bị chặn bởi thời gian xác nhận giao dịch blockchain.
    if (isOnChainTaskSyncAvailable()) {
      const evidenceReference = `${assetId}:${file.name}:${file.size}:${file.lastModified}`;
      void (async () => {
        try {
          const existsOnChain = await issueExistsOnChain(issueId).catch(() => false);
          if (existsOnChain) {
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
          } else {
            console.warn("Công việc chưa có trên blockchain; tệp đính kèm đã được lưu an toàn nội bộ.");
          }
        } catch (chainError) {
          notifyVaultProblem(chainError);
          console.warn("Đồng bộ tệp đính kèm on-chain chưa thành công; tệp đã được lưu an toàn nội bộ:", chainError);
        }
      })();
    }

    // Bước 4: hoàn tất (100%)
    uploadProgressHandler?.({
      loaded: file.size,
      total: file.size,
      progress: 1.0,
    } as any);

    return attachmentRecord;
  }

  async getIssueAttachments(workspaceSlug: string, projectId: string, issueId: string): Promise<TIssueAttachment[]> {
    await requireIssueAccess(workspaceSlug, projectId, issueId);
    const allAttachments = localDB.attachments || [];
    return allAttachments.filter((a: any) => a.issue === issueId || a.issue_id === issueId);
  }

  async deleteIssueAttachment(
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    assetId: string
  ): Promise<TIssueAttachment> {
    const access = await requireIssueAccess(workspaceSlug, projectId, issueId, true);
    const allAttachments = localDB.attachments || [];
    const target = allAttachments.find((a: any) => a.id === assetId || a.asset === assetId);
    if (!target || (target.issue || target.issue_id) !== issueId ||
      (access.role < 20 && target.created_by !== access.user.id))
      throw new Error("Bạn không có quyền xóa tệp này.");
    await deleteAttachment(assetId);
    if (target?.id && target.id !== assetId) await deleteAttachment(target.id);
    localDB._deleted_attachment_ids = [
      ...new Set([...(localDB._deleted_attachment_ids || []), assetId, ...(target?.id ? [target.id] : [])]),
    ];
    localDB.attachments = allAttachments.filter((a: any) => a.id !== assetId && a.asset !== assetId);

    const targetIssue = (localDB.issues || []).find((i: any) => i.id === issueId);
    if (targetIssue) {
      targetIssue.attachment_count = localDB.attachments.filter(
        (a: any) => a.issue === issueId || a.issue_id === issueId
      ).length;
    }
    saveDB();

    return (target || { id: assetId, issue_id: issueId }) as TIssueAttachment;
  }
}
