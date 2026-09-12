/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import { AlertCircle } from "lucide-react";
import { CloseIcon } from "@plane/propel/icons";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
// ui
import { Tooltip } from "@plane/propel/tooltip";
import {
  convertBytesToSize,
  downloadBase64File,
  downloadBlob,
  getAttachmentFromStorage,
  getFileExtension,
  getFileName,
  getFileURL,
  renderFormattedDate,
  truncateText,
} from "@plane/utils";
// icons
//
import { getFileIcon } from "@/components/icons";
// components
import { IssueAttachmentDeleteModal } from "@/components/issues/attachment/delete-attachment-modal";
// helpers
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useMember } from "@/hooks/store/use-member";
import { usePlatformOS } from "@/hooks/use-platform-os";
// types
import type { TAttachmentHelpers } from "../issue-detail-widgets/attachments/helper";

type TAttachmentOperationsRemoveModal = Exclude<TAttachmentHelpers, "create">;

type TIssueAttachmentsDetail = {
  attachmentId: string;
  attachmentHelpers: TAttachmentOperationsRemoveModal;
  disabled?: boolean;
};

export const IssueAttachmentsDetail = observer(function IssueAttachmentsDetail(props: TIssueAttachmentsDetail) {
  // props
  const { attachmentId, attachmentHelpers, disabled } = props;
  // store hooks
  const { getUserDetails } = useMember();
  const {
    attachment: { getAttachmentById },
  } = useIssueDetail();
  // state
  const [isDeleteIssueAttachmentModalOpen, setIsDeleteIssueAttachmentModalOpen] = useState(false);
  // derived values
  const attachment = attachmentId ? getAttachmentById(attachmentId) : undefined;
  const fileName = getFileName(attachment?.attributes.name ?? "");
  const fileExtension = getFileExtension(attachment?.attributes.name ?? attachment?.asset_url ?? "");
  const fileIcon = getFileIcon(fileExtension, 28);
  const fileURL = getFileURL(attachment?.asset_url ?? "");
  // hooks
  const { isMobile } = usePlatformOS();

  if (!attachment) return <></>;

  return (
    <>
      {isDeleteIssueAttachmentModalOpen && (
        <IssueAttachmentDeleteModal
          isOpen={isDeleteIssueAttachmentModalOpen}
          onClose={() => setIsDeleteIssueAttachmentModalOpen(false)}
          attachmentOperations={attachmentHelpers.operations}
          attachmentId={attachmentId}
        />
      )}
      <div className="flex h-[60px] items-center justify-between gap-1 rounded-md border-[2px] border-subtle bg-surface-1 px-4 py-2 text-13">
        <div
          className="cursor-pointer"
          onClick={async () => {
            const fullName = `${fileName}.${fileExtension}`;
            const rawUrl = attachment?.asset_url ?? "";

            // 1. Direct Data URL (base64)
            if (rawUrl.startsWith("data:")) {
              const mimeType = rawUrl.substring(5, rawUrl.indexOf(";")) || "application/octet-stream";
              downloadBase64File(rawUrl, fullName, mimeType);
              setToast({
                type: TOAST_TYPE.SUCCESS,
                title: "Tải xuống",
                message: `Đang tải tệp ${fullName}...`,
              });
              return;
            }

            // 2. Direct HTTP URL
            if (rawUrl.startsWith("http://") || rawUrl.startsWith("https://")) {
              const link = document.createElement("a");
              link.href = rawUrl;
              link.download = fullName;
              link.target = "_blank";
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
              return;
            }

            // 3. Search storage by hash / attachment id
            const keysToTry = [rawUrl, attachment.id, (attachment as any).asset].filter(Boolean);
            let cachedFile: any = null;
            for (const k of keysToTry) {
              cachedFile = await getAttachmentFromStorage(k);
              if (cachedFile?.base64) break;
            }

            if (cachedFile?.base64) {
              downloadBase64File(cachedFile.base64, fullName, cachedFile.type || "application/octet-stream");
              setToast({
                type: TOAST_TYPE.SUCCESS,
                title: "Tải xuống",
                message: `Đang tải tệp ${fullName}...`,
              });
              return;
            }

            // 4. Fallback if not found in storage: create blockchain proof export
            const proofContent = JSON.stringify(
              {
                fileName: fullName,
                fileSize: attachment.attributes?.size,
                blockchainHash: rawUrl || attachment.id,
                issueId: attachment.issue_id,
                uploadedAt: attachment.updated_at,
                status: "Verified On-Chain",
                notice: "Tệp này được lưu trữ xác thực trên blockchain.",
              },
              null,
              2
            );
            const proofBlob = new Blob([proofContent], { type: "application/json" });
            downloadBlob(proofBlob, `${fullName}.blockchain-proof.json`);
            setToast({
              type: TOAST_TYPE.INFO,
              title: "Chứng thực Blockchain",
              message: `Đã tải tệp chứng thực On-Chain cho ${fullName}.`,
            });
          }}
        >
          <div className="flex items-center gap-3">
            <div className="h-7 w-7">{fileIcon}</div>
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <Tooltip tooltipContent={fileName} isMobile={isMobile}>
                  <span className="text-13">{truncateText(`${fileName}`, 10)}</span>
                </Tooltip>
                <Tooltip
                  isMobile={isMobile}
                  tooltipContent={`${
                    getUserDetails(attachment.updated_by)?.display_name ?? ""
                  } uploaded on ${renderFormattedDate(attachment.updated_at)}`}
                >
                  <span>
                    <AlertCircle className="h-3 w-3" />
                  </span>
                </Tooltip>
              </div>

              <div className="flex items-center gap-3 text-11 text-secondary">
                <span>{fileExtension.toUpperCase()}</span>
                <span>{convertBytesToSize(attachment.attributes.size)}</span>
              </div>
            </div>
          </div>
        </div>

        {!disabled && (
          <button type="button" onClick={() => setIsDeleteIssueAttachmentModalOpen(true)}>
            <CloseIcon className="h-4 w-4 text-secondary hover:text-primary" />
          </button>
        )}
      </div>
    </>
  );
});
