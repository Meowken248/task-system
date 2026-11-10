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
import { localDB, saveDB, FileUploadService, deleteAttachment, requireIssueAccess, captureResourceRequestIdentity } from "@plane/services";

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
    const identity = captureResourceRequestIdentity();
    const access = await requireIssueAccess(workspaceSlug, projectId, issueId, true);
    identity.assertCurrent();
    // Trước đây đoạn này gửi POST multipart tới `""` (gốc ứng dụng) — không phải
    // nơi nhận tệp — nên yêu cầu treo tới khi quá thời gian rồi mới báo lỗi (BA-32).
    // Upload qua proxy IPFS đã cấu hình; chỉ xác nhận sau khi đọc lại đúng byte.
    const assetId = `asset_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const payload = new FormData();
    payload.append("asset_id", assetId);
    payload.append("file", file);
    payload.append("storage", "ipfs-file");
    const uploaded = await this.fileUploadService.uploadFile("", payload, uploadProgressHandler);
    identity.assertCurrent();
    await requireIssueAccess(workspaceSlug, projectId, issueId, true);
    identity.assertCurrent();

    const now = new Date().toISOString();
    const attachmentRecord: TIssueAttachment = {
      id: assetId,
      asset_id: assetId,
      // Khoá metadata; renderer đọc CID của tệp đã xác nhận trên IPFS.
      asset_url: assetId,
      storage: "ipfs-file",
      ipfs_cid: uploaded.ipfs_cid,
      content_hash: uploaded.content_hash,
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
    const persisted = await saveDB();
    if (!persisted.durable) throw new Error("Tệp đã được lưu dùng chung nhưng thông tin trên thiết bị chưa được lưu. Hãy giữ trang mở và thử lưu lại.");

    // Bước 3: ghi dấu vết tệp lên hệ thống / blockchain (nếu môi trường on-chain sẵn sàng).
    // Nội dung đã được xác minh trên IPFS; đồng bộ bằng chứng chạy ngầm
    // để UI phản hồi tức thì mà không bị chặn bởi thời gian xác nhận giao dịch blockchain.
    if (isOnChainTaskSyncAvailable()) {
      const evidenceReference = `${uploaded.ipfs_cid}:${uploaded.content_hash}`;
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
            console.warn("Công việc chưa có trên blockchain; tệp đính kèm đã được xác minh trên IPFS.");
          }
        } catch (chainError) {
          notifyVaultProblem(chainError);
          console.warn("Đồng bộ tệp đính kèm on-chain chưa thành công; tệp đã được xác minh trên IPFS:", chainError);
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
    const identity = captureResourceRequestIdentity();
    const access = await requireIssueAccess(workspaceSlug, projectId, issueId, true);
    identity.assertCurrent();
    const allAttachments = localDB.attachments || [];
    const target = allAttachments.find((a: any) => a.id === assetId || a.asset === assetId);
    if (!target || (target.issue || target.issue_id) !== issueId ||
      (access.projectRole < 20 && target.created_by !== access.user.id))
      throw new Error("Bạn không có quyền xóa tệp này.");
    if ((target as any).storage !== "ipfs-file") {
      await deleteAttachment(assetId);
      if (target?.id && target.id !== assetId) await deleteAttachment(target.id);
    }
    await requireIssueAccess(workspaceSlug, projectId, issueId, true);
    identity.assertCurrent();
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
    const persisted = await saveDB();
    if (!persisted.durable) throw new Error("Thay đổi xóa tệp chưa được lưu trên thiết bị. Hãy giữ trang mở và thử lưu lại.");

    return (target || { id: assetId, issue_id: issueId }) as TIssueAttachment;
  }
}
