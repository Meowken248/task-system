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
import { localDB, saveDB } from "@plane/services";
import { getAttachmentFromStorage, saveAttachmentToStorage, deleteAttachmentFromStorage } from "@plane/utils";

/**
 * Đọc tệp ngay trên máy thành base64 (bỏ tiền tố `data:*;base64,` để khớp
 * `downloadBase64File`/`base64ToBlob`).
 */
function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const commaIndex = result.indexOf(",");
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Không đọc được tệp đã chọn."));
    reader.readAsDataURL(file);
  });
}

export class IssueAttachmentService extends APIService {
  private serviceType: TIssueServiceType;

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
    if (!isOnChainTaskSyncAvailable()) {
      throw new Error("Chưa kết nối được với hệ thống lưu dấu vết. Chưa thể thêm tệp đính kèm.");
    }

    // Bước 1: đọc tệp ngay trên máy (30%).
    uploadProgressHandler?.({
      loaded: Math.floor(file.size * 0.3),
      total: file.size,
      progress: 0.3,
    } as any);

    // Trước đây đoạn này gửi POST multipart tới `""` (gốc ứng dụng) — không phải
    // nơi nhận tệp — nên yêu cầu treo tới khi quá thời gian rồi mới báo lỗi (BA-32).
    // Tệp không cần rời khỏi máy: chỉ dấu vết (mã tệp + tên + kích thước) lên hệ thống.
    let base64: string;
    try {
      base64 = await readFileAsBase64(file);
    } catch {
      throw { error: "Không đọc được tệp đã chọn. Hãy thử lại với tệp khác." };
    }
    const assetId = `asset_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const fileType = file.type || "application/octet-stream";

    // Bước 2: lưu tệp vào máy trước khi ký (70%).
    uploadProgressHandler?.({
      loaded: Math.floor(file.size * 0.7),
      total: file.size,
      progress: 0.7,
    } as any);

    await saveAttachmentToStorage(assetId, { name: file.name, base64, type: fileType, size: file.size });
    // Kiểm tra lại ngay: nếu trình duyệt không lưu được (hết chỗ) thì dừng TRƯỚC
    // khi ký, để người dùng không mất một lượt ký vô ích.
    const storedFile = await getAttachmentFromStorage(assetId);
    if (!storedFile?.base64) {
      throw { error: "Máy không đủ chỗ để lưu tệp này. Hãy xoá bớt tệp đính kèm cũ rồi thử lại." };
    }

    // Bước 3: ghi dấu vết tệp lên hệ thống (một lượt ký).
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
      // Chưa có dấu vết trên hệ thống thì không giữ tệp lại (tránh tệp mồ côi).
      await deleteAttachmentFromStorage(assetId).catch(() => {});
      throw {
        error: chainError instanceof Error ? chainError.message : "Ghi bằng chứng đính kèm lên hệ thống thất bại.",
        isChainError: true,
      };
    }

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
    localDB.attachments = localDB.attachments.filter((a: any) => a.id !== assetId);
    localDB.attachments.push(attachmentRecord);
    saveDB();

    // Bước 4: hoàn tất (100%)
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

