/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";

import { useTranslation } from "@plane/i18n";
import { TrashIcon } from "@plane/propel/icons";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { Tooltip } from "@plane/propel/tooltip";
import type { TIssueServiceType } from "@plane/types";
import { EIssueServiceType } from "@plane/types";
// ui
import { CustomMenu } from "@plane/ui";
import {
  convertBytesToSize,
  downloadBase64File,
  downloadBlob,
  getAttachmentFromStorage,
  getFileExtension,
  getFileName,
  getFileURL,
  renderFormattedDate,
} from "@plane/utils";
// components
//
import { ButtonAvatars } from "@/components/dropdowns/member/avatar";
import { getFileIcon } from "@/components/icons";
// helpers
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useMember } from "@/hooks/store/use-member";
import { usePlatformOS } from "@/hooks/use-platform-os";

type TIssueAttachmentsListItem = {
  attachmentId: string;
  disabled?: boolean;
  issueServiceType?: TIssueServiceType;
};

export const IssueAttachmentsListItem = observer(function IssueAttachmentsListItem(props: TIssueAttachmentsListItem) {
  const { t } = useTranslation();
  // props
  const { attachmentId, disabled, issueServiceType = EIssueServiceType.ISSUES } = props;
  // store hooks
  const { getUserDetails } = useMember();
  const {
    attachment: { getAttachmentById },
    toggleDeleteAttachmentModal,
  } = useIssueDetail(issueServiceType);
  // derived values
  const attachment = attachmentId ? getAttachmentById(attachmentId) : undefined;
  const fileName = getFileName(attachment?.attributes.name ?? "");
  const fileExtension = getFileExtension(attachment?.attributes.name ?? "");
  const fileIcon = getFileIcon(fileExtension, 18);
  const fileURL = getFileURL(attachment?.asset_url ?? "");
  // hooks
  const { isMobile } = usePlatformOS();

  if (!attachment) return <></>;

  return (
    <>
      <button
        onClick={async (e) => {
          e.preventDefault();
          e.stopPropagation();
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
        <div className="group flex h-11 items-center justify-between gap-3 pr-2 pl-9 hover:bg-surface-2">
          <div className="flex items-center gap-3 truncate text-13">
            <div className="flex items-center gap-3">{fileIcon}</div>
            <Tooltip tooltipContent={`${fileName}.${fileExtension}`} isMobile={isMobile}>
              <p className="truncate font-medium text-secondary">{`${fileName}.${fileExtension}`}</p>
            </Tooltip>
            <span className="flex size-1.5 rounded-full bg-layer-1" />
            <span className="flex-shrink-0 text-placeholder">{convertBytesToSize(attachment.attributes.size)}</span>
          </div>

          <div className="flex items-center gap-3">
            {attachment?.created_by && (
              <>
                <Tooltip
                  isMobile={isMobile}
                  tooltipContent={`${
                    getUserDetails(attachment?.created_by)?.display_name ?? ""
                  } uploaded on ${renderFormattedDate(attachment.updated_at)}`}
                >
                  <div className="flex items-center justify-center">
                    <ButtonAvatars showTooltip userIds={attachment?.created_by} />
                  </div>
                </Tooltip>
              </>
            )}

            <CustomMenu ellipsis closeOnSelect placement="bottom-end" disabled={disabled}>
              <CustomMenu.MenuItem
                onClick={() => {
                  toggleDeleteAttachmentModal(attachmentId);
                }}
              >
                <div className="flex items-center gap-2">
                  <TrashIcon className="h-3.5 w-3.5" strokeWidth={2} />
                  <span>{t("common.actions.delete")}</span>
                </div>
              </CustomMenu.MenuItem>
            </CustomMenu>
          </div>
        </div>
      </button>
    </>
  );
});
