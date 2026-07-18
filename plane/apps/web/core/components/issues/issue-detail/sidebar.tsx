/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { createPortal } from "react-dom";
import { observer } from "mobx-react";
// i18n
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
// ui
import {
  CycleIcon,
  StatePropertyIcon,
  ModuleIcon,
  MembersPropertyIcon,
  PriorityPropertyIcon,
  StartDatePropertyIcon,
  DueDatePropertyIcon,
  LabelPropertyIcon,
  UserCirclePropertyIcon,
  EstimatePropertyIcon,
  ParentPropertyIcon,
} from "@plane/propel/icons";
import { cn, getDate, renderFormattedPayloadDate, shouldHighlightIssueDueDate } from "@plane/utils";
// components
import { DateDropdown } from "@/components/dropdowns/date";
import { EstimateDropdown } from "@/components/dropdowns/estimate";
import { ButtonAvatars } from "@/components/dropdowns/member/avatar";
import { MemberDropdown } from "@/components/dropdowns/member/dropdown";
import { PriorityDropdown } from "@/components/dropdowns/priority";
import { StateDropdown } from "@/components/dropdowns/state/dropdown";
// hooks
import { useProjectEstimates } from "@/hooks/store/estimates";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useMember } from "@/hooks/store/use-member";
import { useProject } from "@/hooks/store/use-project";
import { useProjectState } from "@/hooks/store/use-project-state";
import { useUserPermissions } from "@/hooks/store/user";
import { blockchainTrackingService } from "@/services/blockchain/blockchain-tracking.service";
import { isWalletAddress } from "@/services/blockchain/metanode-wallet.service";
import { isOnChainTaskSyncEnabled, setPendingAssignmentWallet } from "@/services/blockchain/plane-task-chain.service";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
// plane web components
// components
import { WorkItemAdditionalSidebarProperties } from "@/plane-web/components/issues/issue-details/additional-properties";
import { IssueParentSelectRoot } from "@/plane-web/components/issues/issue-details/parent-select-root";
import { DateAlert } from "@/plane-web/components/issues/issue-details/sidebar/date-alert";
import { TransferHopInfo } from "@/plane-web/components/issues/issue-details/sidebar/transfer-hop-info";
import { IssueWorklogProperty } from "@/plane-web/components/issues/worklog/property";
import { SidebarPropertyListItem } from "@/components/common/layout/sidebar/property-list-item";
import { IssueCycleSelect } from "./cycle-select";
import { IssueLabel } from "./label";
import { IssueModuleSelect } from "./module-select";
import type { TIssueOperations } from "./root";

type Props = {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  issueOperations: TIssueOperations;
  isEditable: boolean;
};

export const IssueDetailsSidebar = observer(function IssueDetailsSidebar(props: Props) {
  const { t } = useTranslation();
  const { workspaceSlug, projectId, issueId, issueOperations, isEditable } = props;
  // store hooks
  const { getProjectById } = useProject();
  const { areEstimateEnabledByProjectId } = useProjectEstimates();
  const {
    issue: { getIssueById },
  } = useIssueDetail();
  const { getUserDetails } = useMember();
  const { getStateById } = useProjectState();
  const { allowPermissions } = useUserPermissions();
  const [pendingAssigneeIds, setPendingAssigneeIds] = useState<string[] | null>(null);
  const [assigneeWallet, setAssigneeWallet] = useState(process.env.VITE_METANODE_WALLET_ADDRESS || "");
  const [isAssigningOnChain, setIsAssigningOnChain] = useState(false);
  const issue = getIssueById(issueId);
  if (!issue) return <></>;

  const createdByDetails = getUserDetails(issue.created_by);

  // derived values
  const projectDetails = getProjectById(issue.project_id);
  const stateDetails = getStateById(issue.state_id);
  const isAdmin = allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.PROJECT, workspaceSlug, projectId);

  const pendingAssigneeId = pendingAssigneeIds?.at(-1) ?? "";
  const pendingAssignee = pendingAssigneeId ? getUserDetails(pendingAssigneeId) : undefined;

  const handleAssigneeChange = async (assigneeIds: string[]) => {
    if (!isOnChainTaskSyncEnabled()) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "On-chain chưa được cấu hình",
        message: "Không thể giao task khi kết nối hợp đồng MetaNode chưa sẵn sàng.",
      });
      return;
    }
    if (assigneeIds.length === 0) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Task cần một nhân viên",
        message: "Hãy chọn nhân viên thay thế; không thể bỏ trống người được giao task.",
      });
      return;
    }
    const selectedAssigneeId = assigneeIds.at(-1);
    setPendingAssigneeIds(selectedAssigneeId ? [selectedAssigneeId] : []);
    if (!selectedAssigneeId) {
      setAssigneeWallet("");
      return;
    }
    const storedWallet = await blockchainTrackingService
      .getStoredAssigneeWallet(workspaceSlug, projectId, selectedAssigneeId)
      .catch(() => "");
    setAssigneeWallet(storedWallet || process.env.VITE_METANODE_WALLET_ADDRESS || "");
  };

  const confirmOnChainAssignment = async () => {
    if (!pendingAssigneeIds || !pendingAssigneeId || !isWalletAddress(assigneeWallet)) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Ví MetaNode không hợp lệ",
        message: "Hãy nhập địa chỉ ví 0x gồm 40 ký tự của nhân viên.",
      });
      return;
    }
    setIsAssigningOnChain(true);
    try {
      setPendingAssignmentWallet(issueId, assigneeWallet.trim());
      await issueOperations.update(workspaceSlug, projectId, issueId, {
        assignee_ids: [pendingAssigneeId],
      });
      await issueOperations.fetch(workspaceSlug, projectId, issueId, true);
      setPendingAssigneeIds(null);
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: "Giao task thành công",
        message: `Đã cập nhật nhân viên trên Plane và hợp đồng on-chain.`,
      });
    } catch (error) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Không thể giao task",
        message: error instanceof Error ? error.message : "Giao dịch on-chain thất bại.",
      });
    } finally {
      setIsAssigningOnChain(false);
    }
  };

  const handleStateChange = async (stateId: string) => {
    await issueOperations.update(workspaceSlug, projectId, issueId, { state_id: stateId });
  };
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const minDate = issue.start_date ? getDate(issue.start_date) : null;
  minDate?.setDate(minDate.getDate());

  const maxDate = issue.target_date ? getDate(issue.target_date) : null;
  maxDate?.setDate(maxDate.getDate());

  return (
    <>
      <div className="flex h-full w-full flex-col items-center divide-y-2 divide-subtle-1 overflow-hidden">
        <div className="h-full w-full overflow-y-auto px-6">
          <h5 className="mt-5 text-body-xs-medium">{t("common.properties")}</h5>
          <div className={`mt-4 mb-2 space-y-2.5 truncate ${!isEditable ? "opacity-60" : ""}`}>
            <SidebarPropertyListItem icon={StatePropertyIcon} label={t("common.state")}>
              <StateDropdown
                value={issue?.state_id}
                onChange={(val) => void handleStateChange(val)}
                projectId={projectId?.toString() ?? ""}
                disabled={!isEditable}
                buttonVariant="transparent-with-text"
                className="group w-full grow"
                buttonContainerClassName="w-full text-left h-7.5"
                buttonClassName="text-body-xs-regular"
                dropdownArrow
                dropdownArrowClassName="h-3.5 w-3.5 hidden group-hover:inline"
              />
            </SidebarPropertyListItem>

            <SidebarPropertyListItem icon={MembersPropertyIcon} label="Nhân viên">
              <MemberDropdown
                value={issue?.assignee_ids?.[0] ?? null}
                onChange={(assigneeId) => void handleAssigneeChange(assigneeId ? [assigneeId] : [])}
                disabled={!isEditable || !isAdmin}
                projectId={projectId?.toString() ?? ""}
                placeholder={t("issue.add.assignee")}
                multiple={false}
                buttonVariant={issue?.assignee_ids?.length > 1 ? "transparent-without-text" : "transparent-with-text"}
                className="group w-full grow"
                buttonContainerClassName="w-full text-left h-7.5"
                buttonClassName={`text-body-xs-regular justify-between ${issue?.assignee_ids?.length > 0 ? "" : "text-placeholder"}`}
                hideIcon={issue.assignee_ids?.length === 0}
                dropdownArrow
                dropdownArrowClassName="h-3.5 w-3.5 hidden group-hover:inline"
              />
            </SidebarPropertyListItem>

            <SidebarPropertyListItem icon={PriorityPropertyIcon} label={t("common.priority")}>
              <PriorityDropdown
                value={issue?.priority}
                onChange={(val) => issueOperations.update(workspaceSlug, projectId, issueId, { priority: val })}
                disabled={!isEditable || !isAdmin}
                buttonVariant="transparent-with-text"
                className="h-7.5 w-full grow rounded-sm"
                buttonContainerClassName="size-full text-left"
                buttonClassName="size-full px-2 py-0.5 whitespace-nowrap [&_svg]:size-3.5"
              />
            </SidebarPropertyListItem>

            {createdByDetails && (
              <SidebarPropertyListItem icon={UserCirclePropertyIcon} label={t("common.created_by")}>
                <div className="flex gap-2 px-2">
                  <ButtonAvatars showTooltip userIds={createdByDetails.id} />
                  <span className="grow truncate text-body-xs-regular leading-5">{createdByDetails?.display_name}</span>
                </div>
              </SidebarPropertyListItem>
            )}

            <SidebarPropertyListItem icon={StartDatePropertyIcon} label={t("common.order_by.start_date")}>
              <DateDropdown
                placeholder={t("issue.add.start_date")}
                value={issue.start_date}
                onChange={(val) =>
                  issueOperations.update(workspaceSlug, projectId, issueId, {
                    start_date: val ? renderFormattedPayloadDate(val) : null,
                  })
                }
                minDate={today}
                maxDate={maxDate ?? undefined}
                disabled={!isEditable || !isAdmin}
                buttonVariant="transparent-with-text"
                className="group w-full grow"
                buttonContainerClassName="w-full text-left h-7.5"
                buttonClassName={`text-body-xs-regular ${issue?.start_date ? "" : "text-placeholder"}`}
                hideIcon
                clearIconClassName="h-3 w-3 hidden group-hover:inline"
              />
            </SidebarPropertyListItem>

            <SidebarPropertyListItem icon={DueDatePropertyIcon} label={t("common.order_by.due_date")}>
              <div className="flex w-full items-center gap-2">
                <DateDropdown
                  placeholder={t("issue.add.due_date")}
                  value={issue.target_date}
                  onChange={(val) =>
                    issueOperations.update(workspaceSlug, projectId, issueId, {
                      target_date: val ? renderFormattedPayloadDate(val) : null,
                    })
                  }
                  minDate={minDate ?? undefined}
                  disabled={!isEditable || !isAdmin}
                  buttonVariant="transparent-with-text"
                  className="group w-full grow"
                  buttonContainerClassName="w-full text-left h-7.5"
                  buttonClassName={cn("text-body-xs-regular", {
                    "text-placeholder": !issue.target_date,
                    "text-danger-primary": shouldHighlightIssueDueDate(issue.target_date, stateDetails?.group),
                  })}
                  hideIcon
                  clearIconClassName="h-3 w-3 hidden group-hover:inline text-primary"
                />
                {issue.target_date && <DateAlert date={issue.target_date} workItem={issue} projectId={projectId} />}
              </div>
            </SidebarPropertyListItem>

            {projectId && areEstimateEnabledByProjectId(projectId) && (
              <SidebarPropertyListItem icon={EstimatePropertyIcon} label={t("common.estimate")}>
                <EstimateDropdown
                  value={issue?.estimate_point ?? undefined}
                  onChange={(val: string | undefined) =>
                    issueOperations.update(workspaceSlug, projectId, issueId, { estimate_point: val })
                  }
                  projectId={projectId}
                  disabled={!isEditable || !isAdmin}
                  buttonVariant="transparent-with-text"
                  className="group w-full grow"
                  buttonContainerClassName="w-full text-left h-7.5"
                  buttonClassName={`text-body-xs-regular ${issue?.estimate_point !== null ? "" : "text-placeholder"}`}
                  placeholder={t("common.none")}
                  hideIcon
                  dropdownArrow
                  dropdownArrowClassName="h-3.5 w-3.5 hidden group-hover:inline"
                />
              </SidebarPropertyListItem>
            )}

            {projectDetails?.module_view && (
              <SidebarPropertyListItem icon={ModuleIcon} label={t("common.modules")}>
                <IssueModuleSelect
                  className="w-full grow"
                  workspaceSlug={workspaceSlug}
                  projectId={projectId}
                  issueId={issueId}
                  issueOperations={issueOperations}
                  disabled={!isEditable || !isAdmin}
                />
              </SidebarPropertyListItem>
            )}

            {projectDetails?.cycle_view && (
              <SidebarPropertyListItem
                icon={CycleIcon}
                label={t("common.cycle")}
                appendElement={<TransferHopInfo workItem={issue} />}
              >
                <IssueCycleSelect
                  className="h-7.5 w-full grow"
                  workspaceSlug={workspaceSlug}
                  projectId={projectId}
                  issueId={issueId}
                  issueOperations={issueOperations}
                  disabled={!isEditable || !isAdmin}
                />
              </SidebarPropertyListItem>
            )}

            <SidebarPropertyListItem icon={ParentPropertyIcon} label={t("common.parent")}>
              <IssueParentSelectRoot
                className="h-7.5 w-full grow"
                workspaceSlug={workspaceSlug}
                projectId={projectId}
                issueId={issueId}
                issueOperations={issueOperations}
                disabled={!isEditable || !isAdmin}
              />
            </SidebarPropertyListItem>

            <SidebarPropertyListItem icon={LabelPropertyIcon} label={t("common.labels")}>
              <IssueLabel
                workspaceSlug={workspaceSlug}
                projectId={projectId}
                issueId={issueId}
                disabled={!isEditable || !isAdmin}
              />
            </SidebarPropertyListItem>

            <IssueWorklogProperty
              workspaceSlug={workspaceSlug}
              projectId={projectId}
              issueId={issueId}
              disabled={!isEditable || !isAdmin}
            />

            <WorkItemAdditionalSidebarProperties
              workItemId={issue.id}
              workItemTypeId={issue.type_id}
              projectId={projectId}
              workspaceSlug={workspaceSlug}
              isEditable={isEditable && isAdmin}
            />
          </div>
        </div>
      </div>
      {pendingAssigneeIds &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 p-4 backdrop-blur-md">
            <div className="shadow-2xl w-full max-w-md rounded-xl border border-subtle-1 bg-surface-1 p-5">
              <h3 className="text-lg font-semibold text-primary">Giao task on-chain</h3>
              <p className="text-sm mt-1 text-secondary">
                Nhập ví MetaNode của {pendingAssignee?.display_name || pendingAssignee?.email || "nhân viên"}. Task chỉ
                được giao sau khi giao dịch thành công.
              </p>
              <label htmlFor="on-chain-assignee-wallet" className="text-sm mt-5 block font-medium text-primary">
                Ví MetaNode của nhân viên
              </label>
              <input
                id="on-chain-assignee-wallet"
                value={assigneeWallet}
                onChange={(event) => setAssigneeWallet(event.target.value)}
                disabled={isAssigningOnChain}
                placeholder="0x..."
                className="text-sm focus:border-accent-primary mt-2 h-10 w-full rounded-md border border-subtle-1 bg-surface-2 px-3 text-primary outline-none"
              />
              {isAssigningOnChain && (
                <div className="text-sm mt-4 rounded-md bg-surface-2 p-3 text-secondary">
                  Đang chờ mở ví, ký giao dịch và nhận transaction hash...
                </div>
              )}
              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  disabled={isAssigningOnChain}
                  onClick={() => setPendingAssigneeIds(null)}
                  className="text-sm rounded-md border border-subtle-1 px-3 py-2 text-secondary hover:bg-surface-2 disabled:opacity-50"
                >
                  Hủy
                </button>
                <button
                  type="button"
                  disabled={isAssigningOnChain || !isWalletAddress(assigneeWallet)}
                  onClick={confirmOnChainAssignment}
                  className="text-sm rounded-md bg-accent-primary px-3 py-2 font-medium text-on-color disabled:opacity-50"
                >
                  {isAssigningOnChain ? "Đang xác nhận..." : "Ký và giao task"}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
});
