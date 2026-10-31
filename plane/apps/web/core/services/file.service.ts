/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { AxiosRequestConfig } from "axios";
// plane types
import { API_BASE_URL } from "@plane/constants";
import { getFileMetaDataForUpload, generateFileUploadPayload, FileUploadService, localDB } from "@plane/services";
import type { EFileAssetType, TFileEntityInfo, TFileSignedURLResponse } from "@plane/types";
import { getAssetIdFromUrl } from "@plane/utils";
// helpers
// services
import { APIService } from "@/services/api.service";

export interface UnSplashImage {
  id: string;
  created_at: Date;
  updated_at: Date;
  promoted_at: Date;
  width: number;
  height: number;
  color: string;
  blur_hash: string;
  description: null;
  alt_description: string;
  urls: UnSplashImageUrls;
  [key: string]: any;
}

export interface UnSplashImageUrls {
  raw: string;
  full: string;
  regular: string;
  small: string;
  thumb: string;
  small_s3: string;
}

export enum TFileAssetType {
  COMMENT_DESCRIPTION = "COMMENT_DESCRIPTION",
  ISSUE_ATTACHMENT = "ISSUE_ATTACHMENT",
  ISSUE_DESCRIPTION = "ISSUE_DESCRIPTION",
  PAGE_DESCRIPTION = "PAGE_DESCRIPTION",
  PROJECT_COVER = "PROJECT_COVER",
  USER_AVATAR = "USER_AVATAR",
  USER_COVER = "USER_COVER",
  WORKSPACE_LOGO = "WORKSPACE_LOGO",
}

export class FileService extends APIService {
  private fileUploadService: FileUploadService;
  private cancellationVersion = 0;

  constructor() {
    super(API_BASE_URL);
    this.cancelUpload = this.cancelUpload.bind(this);
    // upload service
    this.fileUploadService = new FileUploadService();
  }

  private async uploadAsset(
    path: string,
    data: TFileEntityInfo,
    file: File,
    onProgress?: AxiosRequestConfig["onUploadProgress"]
  ): Promise<TFileSignedURLResponse> {
    const version = this.cancellationVersion;
    const checkCancelled = () => {
      if (version !== this.cancellationVersion) throw new Error("Đã hủy upload tệp.");
    };
    try {
      const metadata = await getFileMetaDataForUpload(file);
      const response = await this.post(path, { ...data, ...metadata });
      const initialized: TFileSignedURLResponse = response.data;
      checkCancelled();
      if (!initialized?.asset_id || !initialized.upload_data?.fields)
        throw new Error("Chưa tạo được mã tệp. Hãy thử lại.");
      const content = await this.fileUploadService.uploadFile(
        initialized.upload_data.url,
        generateFileUploadPayload(initialized, file),
        onProgress
      );
      if (!content?.asset_url) throw new Error("Chưa lưu được nội dung tệp.");
      checkCancelled();
      const confirmed = await this.patch(`${path}${initialized.asset_id}/`, content.ipfs_cid ? { ipfs_cid: content.ipfs_cid } : undefined);
      if (!confirmed.data?.is_uploaded) throw new Error("Chưa xác nhận được tệp đã lưu.");
      return { ...initialized, asset_url: confirmed.data.asset_url || content.asset_url };
    } catch (error) {
      const failure = error as { response?: { data?: unknown } };
      throw failure?.response?.data || error;
    }
  }

  async uploadWorkspaceAsset(
    workspaceSlug: string,
    data: TFileEntityInfo,
    file: File,
    uploadProgressHandler?: AxiosRequestConfig["onUploadProgress"]
  ): Promise<TFileSignedURLResponse> {
    return this.uploadAsset(`/api/assets/v2/workspaces/${workspaceSlug}/`, data, file, uploadProgressHandler);
  }

  async deleteWorkspaceAsset(workspaceSlug: string, assetId: string): Promise<void> {
    return this.delete(`/api/assets/v2/workspaces/${workspaceSlug}/${assetId}/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async updateBulkWorkspaceAssetsUploadStatus(
    workspaceSlug: string,
    entityId: string,
    data: {
      asset_ids: string[];
    }
  ): Promise<void> {
    return this.post(`/api/assets/v2/workspaces/${workspaceSlug}/${entityId}/bulk/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async updateBulkProjectAssetsUploadStatus(
    workspaceSlug: string,
    projectId: string,
    entityId: string,
    data: {
      asset_ids: string[];
    }
  ): Promise<void> {
    return this.post(`/api/assets/v2/workspaces/${workspaceSlug}/projects/${projectId}/${entityId}/bulk/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async uploadProjectAsset(
    workspaceSlug: string,
    projectId: string,
    data: TFileEntityInfo,
    file: File,
    uploadProgressHandler?: AxiosRequestConfig["onUploadProgress"]
  ): Promise<TFileSignedURLResponse> {
    return this.uploadAsset(
      `/api/assets/v2/workspaces/${workspaceSlug}/projects/${projectId}/`,
      data,
      file,
      uploadProgressHandler
    );
  }

  async uploadUserAsset(data: TFileEntityInfo, file: File): Promise<TFileSignedURLResponse> {
    return this.uploadAsset(`/api/assets/v2/user-assets/`, data, file);
  }

  async deleteUserAsset(assetId: string): Promise<void> {
    return this.delete(`/api/assets/v2/user-assets/${assetId}/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async deleteNewAsset(assetPath: string): Promise<void> {
    return this.delete(assetPath)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async deleteOldWorkspaceAsset(workspaceId: string, src: string): Promise<any> {
    const pinned = (localDB.assets || []).find((asset: any) => asset.storage === "ipfs" && asset.asset_url === src && asset.workspace === workspaceId);
    if (pinned) return this.deleteWorkspaceAsset(workspaceId, pinned.id);
    const assetKey = getAssetIdFromUrl(src);
    return this.delete(`/api/workspaces/file-assets/${workspaceId}/${assetKey}/`)
      .then((response) => response?.status)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async deleteOldUserAsset(src: string): Promise<any> {
    const pinned = (localDB.assets || []).find((asset: any) => asset.storage === "ipfs" && asset.user_asset && asset.asset_url === src);
    if (pinned) return this.deleteUserAsset(pinned.id);
    const assetKey = getAssetIdFromUrl(src);
    return this.delete(`/api/users/file-assets/${assetKey}/`)
      .then((response) => response?.status)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async restoreNewAsset(workspaceSlug: string, src: string): Promise<void> {
    // remove the last slash and get the asset id
    const assetId = getAssetIdFromUrl(src);
    return this.post(`/api/assets/v2/workspaces/${workspaceSlug}/restore/${assetId}/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async checkIfAssetExists(
    workspaceSlug: string,
    assetId: string
  ): Promise<{
    exists: boolean;
  }> {
    return this.get(`/api/assets/v2/workspaces/${workspaceSlug}/check/${assetId}/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async restoreOldEditorAsset(workspaceId: string, src: string): Promise<void> {
    const assetKey = getAssetIdFromUrl(src);
    return this.post(`/api/workspaces/file-assets/${workspaceId}/${assetKey}/restore/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  cancelUpload() {
    this.cancellationVersion++;
    this.fileUploadService.cancelUpload();
  }

  async getUnsplashImages(query?: string): Promise<UnSplashImage[]> {
    return this.get(`/api/unsplash/`, {
      params: {
        query,
      },
    })
      .then((res) => res?.data?.results ?? res?.data)
      .catch((err) => {
        throw err?.response?.data;
      });
  }

  async duplicateAsset(
    workspaceSlug: string,
    assetId: string,
    data: {
      entity_id?: string;
      entity_type: EFileAssetType;
      project_id?: string;
    }
  ): Promise<{ asset_id: string }> {
    return this.post(`/api/assets/v2/workspaces/${workspaceSlug}/duplicate-assets/${assetId}/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }
}
