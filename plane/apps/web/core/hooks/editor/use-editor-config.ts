/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback } from "react";
// plane imports
import type { TFileHandler } from "@plane/editor";
import { resolveAssetSource, getLocalAssetId, isDirectAssetSource } from "@plane/services";
// hooks
import { useEditorAsset } from "@/hooks/store/use-editor-asset";
// plane web hooks
import { useExtendedEditorConfig } from "@/plane-web/hooks/editor/use-extended-editor-config";
import { useFileSize } from "@/plane-web/hooks/use-file-size";
// services
import { FileService } from "@/services/file.service";
const fileService = new FileService();

type TArgs = {
  projectId?: string;
  uploadFile: TFileHandler["upload"];
  duplicateFile: TFileHandler["duplicate"];
  workspaceId: string;
  workspaceSlug: string;
};

export const useEditorConfig = () => {
  // store hooks
  const { assetsUploadPercentage, cancelEditorAssetUpload } = useEditorAsset();
  // file size
  const { maxFileSize } = useFileSize();
  const { getExtendedEditorFileHandlers } = useExtendedEditorConfig();

  const getEditorFileHandlers = useCallback(
    (args: TArgs): TFileHandler => {
      const { projectId, uploadFile, duplicateFile, workspaceId, workspaceSlug } = args;

      return {
        assetsUploadStatus: assetsUploadPercentage,
        cancel: cancelEditorAssetUpload,
        checkIfAssetExists: async (assetId: string) => {
          try {
            return Boolean(await resolveAssetSource(assetId));
          } catch {
            return false;
          }
        },
        delete: async (src: string) => {
          if (isDirectAssetSource(src) && !src.startsWith("http")) return;
          if (isDirectAssetSource(src)) {
            await fileService.deleteOldWorkspaceAsset(workspaceId, src);
          } else {
            const assetId = getLocalAssetId(src);
            const prefix = `/api/assets/v2/workspaces/${workspaceSlug}/${projectId ? `projects/${projectId}/` : ""}`;
            await fileService.deleteNewAsset(`${prefix}${assetId}/`);
          }
        },
        getAssetDownloadSrc: resolveAssetSource,
        getAssetSrc: resolveAssetSource,
        restore: async (src: string) => {
          await resolveAssetSource(src);
        },
        upload: uploadFile,
        duplicate: duplicateFile,
        validation: {
          maxFileSize,
        },
        ...getExtendedEditorFileHandlers({ projectId, workspaceSlug }),
      };
    },
    [assetsUploadPercentage, cancelEditorAssetUpload, getExtendedEditorFileHandlers, maxFileSize]
  );

  return {
    getEditorFileHandlers,
  };
};
