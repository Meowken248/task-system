/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React, { useState, useRef, useEffect } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import {
  BellDot,
  Copy,
  Archive,
  Trash2,
  Calendar as CalendarIcon,
  CalendarCheck,
  Tag,
  Users,
  Search,
  Circle,
  Ban,
} from "lucide-react";
// plane constants
import { EIconSize, ISSUE_PRIORITIES } from "@plane/constants";
// propel icons
import {
  StateGroupIcon,
  PriorityIcon,
  CycleIcon,
  ModuleIcon,
} from "@plane/propel/icons";
import { Tooltip } from "@plane/propel/tooltip";
import { setToast, TOAST_TYPE } from "@plane/propel/toast";
// plane ui
import { Avatar, AlertModalCore } from "@plane/ui";
import { cn } from "@plane/utils";
import { useOutsideClickDetector } from "@plane/hooks";
import type { TIssuePriorities } from "@plane/types";
// hooks
import { useMultipleSelectStore } from "@/hooks/store/use-multiple-select-store";
import { useIssuesStore } from "@/hooks/use-issue-layout-store";
import { useProjectState } from "@/hooks/store/use-project-state";
import { useMember } from "@/hooks/store/use-member";
import { useLabel } from "@/hooks/store/use-label";
import { useCycle } from "@/hooks/store/use-cycle";
import { useModule } from "@/hooks/store/use-module";
import { useUser } from "@/hooks/store/user";
import type { TSelectionHelper } from "@/hooks/use-multiple-select";

type Props = {
  className?: string;
  selectionHelpers: TSelectionHelper;
};

// ===================== CALENDAR HELPER =====================
const getCalendarDays = (currentDate: Date) => {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const today = new Date();
  const isSameDay = (d1: Date, d2: Date) =>
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate();

  const firstDayIndex = new Date(year, month, 1).getDay(); // 0 for Sunday
  const daysInCurrentMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  const days: Array<{
    date: Date;
    dayNum: number;
    isCurrentMonth: boolean;
    isToday: boolean;
  }> = [];

  for (let i = firstDayIndex - 1; i >= 0; i--) {
    const d = new Date(year, month - 1, daysInPrevMonth - i);
    days.push({
      date: d,
      dayNum: daysInPrevMonth - i,
      isCurrentMonth: false,
      isToday: isSameDay(d, today),
    });
  }

  for (let i = 1; i <= daysInCurrentMonth; i++) {
    const d = new Date(year, month, i);
    days.push({
      date: d,
      dayNum: i,
      isCurrentMonth: true,
      isToday: isSameDay(d, today),
    });
  }

  const remainingDays = 42 - days.length;
  for (let i = 1; i <= remainingDays; i++) {
    const d = new Date(year, month + 1, i);
    days.push({
      date: d,
      dayNum: i,
      isCurrentMonth: false,
      isToday: isSameDay(d, today),
    });
  }

  return days;
};

const formatDatePayload = (d: Date | null): string | null => {
  if (!d) return null;
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

// ===================== SUBCOMPONENTS =====================

function BulkCalendarDropdown({
  onSelectDate,
  onClose,
}: {
  onSelectDate: (date: Date | null) => void;
  onClose: () => void;
}) {
  const [viewDate, setViewDate] = useState(() => new Date());
  const days = getCalendarDays(viewDate);

  const prevYear = () =>
    setViewDate(new Date(viewDate.getFullYear() - 1, viewDate.getMonth(), 1));
  const prevMonth = () =>
    setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1));
  const nextMonth = () =>
    setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1));
  const nextYear = () =>
    setViewDate(new Date(viewDate.getFullYear() + 1, viewDate.getMonth(), 1));

  return (
    <div
      className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-50 w-[240px] rounded-md border border-[#262729] bg-[#141515] p-3 shadow-2xl select-none animate-in fade-in zoom-in-95 duration-100"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between mb-2.5 px-1 text-[11px] text-[#71717a]">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={prevYear}
            className="hover:text-white transition-colors cursor-pointer font-mono font-bold px-0.5"
            title="Previous year"
          >
            «
          </button>
          <button
            type="button"
            onClick={prevMonth}
            className="hover:text-white transition-colors cursor-pointer font-mono font-bold px-0.5"
            title="Previous month"
          >
            ‹
          </button>
        </div>
        <span className="text-[11px] font-semibold text-white">
          {viewDate.toLocaleDateString("en-US", { month: "short", year: "numeric" })}
        </span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={nextMonth}
            className="hover:text-white transition-colors cursor-pointer font-mono font-bold px-0.5"
            title="Next month"
          >
            ›
          </button>
          <button
            type="button"
            onClick={nextYear}
            className="hover:text-white transition-colors cursor-pointer font-mono font-bold px-0.5"
            title="Next year"
          >
            »
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 mb-1.5 text-center">
        {["SU", "MO", "TU", "WE", "TH", "FR", "SA"].map((day) => (
          <span key={day} className="text-[10px] font-medium text-[#71717a]">
            {day}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-y-0.5 text-center">
        {days.map((item, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => {
              onSelectDate(item.date);
              onClose();
            }}
            className={cn(
              "h-7 w-7 mx-auto flex flex-col items-center justify-center rounded-[3px] text-[11px] transition-colors cursor-pointer leading-none",
              item.isCurrentMonth
                ? "text-[#d4d4d8] hover:bg-[#252628]"
                : "text-[#52525b] hover:bg-[#252628]/50"
            )}
          >
            <span>{item.dayNum}</span>
            {item.isToday && (
              <span className="h-1 w-1 rounded-full bg-blue-500 mt-0.5" />
            )}
          </button>
        ))}
      </div>

      <div className="mt-2 pt-1.5 border-t border-[#262729] flex items-center justify-between text-[11px] px-1">
        <button
          type="button"
          onClick={() => {
            onSelectDate(null);
            onClose();
          }}
          className="text-red-400 hover:text-red-300 transition-colors cursor-pointer"
        >
          Clear date
        </button>
        <button
          type="button"
          onClick={() => {
            onSelectDate(new Date());
            onClose();
          }}
          className="text-[#a1a1aa] hover:text-white transition-colors cursor-pointer"
        >
          Today
        </button>
      </div>
    </div>
  );
}

function AssigneesDropdown({
  memberIds,
  getUserDetails,
  currentUserId,
  onSelectMember,
  onClose,
}: {
  memberIds: string[];
  getUserDetails: (id: string) => any;
  currentUserId?: string;
  onSelectMember: (id: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");

  const filteredMembers = memberIds.filter((userId) => {
    const member = getUserDetails(userId);
    const name = member?.display_name || member?.first_name || "";
    return name.toLowerCase().includes(query.toLowerCase());
  });

  return (
    <div
      className="absolute bottom-full mb-2 left-0 z-50 w-52 rounded-md border border-[#262729] bg-[#141515] p-1 shadow-2xl select-none animate-in fade-in zoom-in-95 duration-100"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-1.5 px-2 py-1 border-b border-[#262729] mb-1">
        <Search className="h-3 w-3 text-[#71717a] flex-shrink-0" />
        <input
          type="text"
          placeholder="Search members..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full bg-transparent text-[11px] text-[#e4e4e7] placeholder-[#71717a] focus:outline-none"
          autoFocus
        />
      </div>
      <div className="max-h-52 overflow-y-auto space-y-0.5">
        {filteredMembers.length === 0 ? (
          <div className="p-2 text-[11px] text-[#71717a] text-center">No members found</div>
        ) : (
          filteredMembers.map((userId) => {
            const member = getUserDetails(userId);
            const displayName = member?.display_name || member?.first_name || "Member";
            const isYou = userId === currentUserId;
            return (
              <button
                key={userId}
                type="button"
                onClick={() => {
                  onSelectMember(userId);
                  onClose();
                }}
                className="w-full flex items-center gap-2 px-2 py-1 rounded-[4px] hover:bg-[#252628] cursor-pointer text-[11px] text-[#e4e4e7] transition-colors text-left"
              >
                <Avatar name={displayName} src={member?.avatar_url} size={16} />
                <span className="truncate">
                  {displayName}
                  {isYou && <span className="text-[#a1a1aa] ml-1">(you)</span>}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

function LabelsDropdown({
  labels,
  onSelectLabel,
  onClose,
}: {
  labels: any[];
  onSelectLabel: (id: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");

  const filteredLabels = labels.filter((label) =>
    (label.name || "").toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div
      className="absolute bottom-full mb-2 left-0 z-50 w-52 rounded-md border border-[#262729] bg-[#141515] p-1 shadow-2xl select-none animate-in fade-in zoom-in-95 duration-100"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-1.5 px-2 py-1 border-b border-[#262729] mb-1">
        <Search className="h-3 w-3 text-[#71717a] flex-shrink-0" />
        <input
          type="text"
          placeholder="Search labels..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full bg-transparent text-[11px] text-[#e4e4e7] placeholder-[#71717a] focus:outline-none"
          autoFocus
        />
      </div>
      <div className="max-h-52 overflow-y-auto space-y-0.5">
        {filteredLabels.length === 0 ? (
          <div className="p-2 text-[11px] text-[#71717a] text-center">No labels found</div>
        ) : (
          filteredLabels.map((label) => (
            <button
              key={label.id}
              type="button"
              onClick={() => {
                onSelectLabel(label.id);
                onClose();
              }}
              className="w-full flex items-center gap-2 px-2 py-1 rounded-[4px] hover:bg-[#252628] cursor-pointer text-[11px] text-[#e4e4e7] transition-colors text-left"
            >
              <span
                className="h-2 w-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: label.color || "#737373" }}
              />
              <span className="truncate">{label.name}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

// ===================== ROOT COMPONENT =====================

export const IssueBulkOperationsRoot = observer(function IssueBulkOperationsRoot(props: Props) {
  const { className, selectionHelpers } = props;

  // selection store
  const { isSelectionActive, selectedEntityIds } = useMultipleSelectStore();

  // router params
  const { workspaceSlug: routerWorkspaceSlug, projectId: routerProjectId } = useParams();

  // current user
  const { data: currentUser } = useUser();

  // issues store
  const { issues, issueMap } = useIssuesStore();

  // state & modals
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // dropdown popup state
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);

  useOutsideClickDetector(barRef, () => {
    setActiveDropdown(null);
  });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setActiveDropdown(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // properties stores
  const { getProjectStates } = useProjectState();
  const { getUserDetails, project: projectMemberStore } = useMember();
  const { getProjectLabels } = useLabel();
  const { getProjectCycleDetails } = useCycle();
  const { getProjectModuleDetails } = useModule();

  // if selection is not active, return null
  if (!isSelectionActive || selectionHelpers.isSelectionDisabled || selectedEntityIds.length === 0) {
    return null;
  }

  // resolve current project and workspace
  const firstIssue = selectedEntityIds.length > 0 ? issueMap?.[selectedEntityIds[0]] : null;
  const workspaceSlug = ((routerWorkspaceSlug as string) || (firstIssue as any)?.workspace__slug || "").toString();
  const projectId = ((routerProjectId as string) || firstIssue?.project_id || "").toString();

  // available options
  const projectStates = projectId ? getProjectStates(projectId) || [] : [];
  const memberIds = projectId ? projectMemberStore.getProjectMemberIds(projectId, true) || [] : [];
  const projectLabels = projectId ? getProjectLabels(projectId) || [] : [];
  const projectCycles = projectId ? getProjectCycleDetails(projectId) || [] : [];
  const projectModules = projectId ? getProjectModuleDetails(projectId) || [] : [];

  // ===================== ACTION HANDLERS =====================

  const handleUpdateState = async (stateId: string) => {
    if (!workspaceSlug || !projectId) return;
    try {
      await issues.bulkUpdateProperties(workspaceSlug, projectId, {
        issue_ids: selectedEntityIds,
        properties: { state_id: stateId },
      });
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: "Success",
        message: "State updated for selected work items",
      });
    } catch {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Error",
        message: "Failed to update state",
      });
    }
  };

  const handleUpdatePriority = async (priority: TIssuePriorities) => {
    if (!workspaceSlug || !projectId) return;
    try {
      await issues.bulkUpdateProperties(workspaceSlug, projectId, {
        issue_ids: selectedEntityIds,
        properties: { priority },
      });
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: "Success",
        message: "Priority updated for selected work items",
      });
    } catch {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Error",
        message: "Failed to update priority",
      });
    }
  };

  const handleUpdateAssignee = async (userId: string) => {
    if (!workspaceSlug || !projectId) return;
    try {
      await issues.bulkUpdateProperties(workspaceSlug, projectId, {
        issue_ids: selectedEntityIds,
        properties: { assignee_ids: [userId] },
      });
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: "Success",
        message: "Assignee updated for selected work items",
      });
    } catch {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Error",
        message: "Failed to update assignee",
      });
    }
  };

  const handleUpdateStartDate = async (startDate: string | null) => {
    if (!workspaceSlug || !projectId) return;
    try {
      await issues.bulkUpdateProperties(workspaceSlug, projectId, {
        issue_ids: selectedEntityIds,
        properties: { start_date: startDate },
      });
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: "Success",
        message: "Start date updated for selected work items",
      });
    } catch {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Error",
        message: "Failed to update start date",
      });
    }
  };

  const handleUpdateDueDate = async (dueDate: string | null) => {
    if (!workspaceSlug || !projectId) return;
    try {
      await issues.bulkUpdateProperties(workspaceSlug, projectId, {
        issue_ids: selectedEntityIds,
        properties: { target_date: dueDate },
      });
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: "Success",
        message: "Due date updated for selected work items",
      });
    } catch {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Error",
        message: "Failed to update due date",
      });
    }
  };

  const handleAddLabel = async (labelId: string) => {
    if (!workspaceSlug || !projectId) return;
    try {
      await issues.bulkUpdateProperties(workspaceSlug, projectId, {
        issue_ids: selectedEntityIds,
        properties: { label_ids: [labelId] },
      });
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: "Success",
        message: "Label updated for selected work items",
      });
    } catch {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Error",
        message: "Failed to update label",
      });
    }
  };

  const handleUpdateCycle = async (cycleId: string | null) => {
    if (!workspaceSlug || !projectId) return;
    try {
      await issues.bulkUpdateProperties(workspaceSlug, projectId, {
        issue_ids: selectedEntityIds,
        properties: { cycle_id: cycleId },
      });
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: "Success",
        message: cycleId ? "Cycle updated for selected work items" : "Removed from cycle",
      });
    } catch {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Error",
        message: "Failed to update cycle",
      });
    }
  };

  const handleUpdateModule = async (moduleId: string | null) => {
    if (!workspaceSlug || !projectId) return;
    try {
      await issues.bulkUpdateProperties(workspaceSlug, projectId, {
        issue_ids: selectedEntityIds,
        properties: { module_ids: moduleId ? [moduleId] : [] },
      });
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: "Success",
        message: moduleId ? "Module updated for selected work items" : "Removed from module",
      });
    } catch {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Error",
        message: "Failed to update module",
      });
    }
  };

  const handleBulkArchive = async () => {
    if (!workspaceSlug || !projectId) return;
    try {
      if (issues.archiveBulkIssues) {
        await issues.archiveBulkIssues(workspaceSlug, projectId, selectedEntityIds);
      }
      selectionHelpers.handleClearSelection();
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: "Success",
        message: `${selectedEntityIds.length} work items archived successfully`,
      });
    } catch {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Error",
        message: "Failed to archive work items",
      });
    }
  };

  const handleBulkDelete = async () => {
    if (!workspaceSlug || !projectId) return;
    setIsDeleting(true);
    try {
      await issues.removeBulkIssues(workspaceSlug, projectId, selectedEntityIds);
      selectionHelpers.handleClearSelection();
      setIsDeleteModalOpen(false);
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: "Success",
        message: `${selectedEntityIds.length} work items deleted successfully`,
      });
    } catch {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Error",
        message: "Failed to delete work items",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDuplicate = async () => {
    if (!workspaceSlug || !projectId) return;
    try {
      for (const issueId of selectedEntityIds) {
        const issue = issueMap?.[issueId];
        if (issue && "createIssue" in issues && typeof (issues as any).createIssue === "function") {
          await (issues as any).createIssue(workspaceSlug, projectId, {
            name: `${issue.name} (Copy)`,
            description_html: issue.description_html || "",
            priority: issue.priority,
            state_id: issue.state_id,
            assignee_ids: issue.assignee_ids,
            label_ids: issue.label_ids,
          });
        }
      }
      selectionHelpers.handleClearSelection();
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: "Success",
        message: "Work items duplicated successfully",
      });
    } catch {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Error",
        message: "Failed to duplicate work items",
      });
    }
  };

  const handleToggleWatch = () => {
    setToast({
      type: TOAST_TYPE.SUCCESS,
      title: "Notifications",
      message: `Subscribed to notifications for ${selectedEntityIds.length} work items`,
    });
  };

  const toggleDropdown = (name: string) => {
    setActiveDropdown((prev) => (prev === name ? null : name));
  };

  // Ultra-slim, elegant pill button matching the target image
  const getPillButtonClass = (isActive: boolean) =>
    cn(
      "flex items-center gap-1 h-[22px] px-2 rounded-[4px] text-[11px] font-normal border transition-colors cursor-pointer select-none whitespace-nowrap flex-shrink-0 leading-none",
      isActive
        ? "bg-[#28292c] text-white border-[#3f3f46]"
        : "border-[#262729] bg-[#1c1d1e] hover:bg-[#252628] text-[#a1a1aa] hover:text-[#ededed]"
    );

  return (
    <>
      <div
        ref={barRef}
        className={cn(
          "fixed bottom-4 left-1/2 -translate-x-1/2 z-30 flex items-center h-[34px] gap-1 rounded-md border border-[#262729] bg-[#141515] px-2 shadow-2xl transition-all duration-200 animate-in fade-in slide-in-from-bottom-2 whitespace-nowrap select-none",
          className
        )}
      >
        {/* Count & Deselect Button */}
        <Tooltip tooltipContent="Click to clear selection">
          <button
            type="button"
            onClick={selectionHelpers.handleClearSelection}
            className="flex items-center gap-1.5 px-1 py-0.5 rounded-[4px] text-[11px] font-normal text-[#a1a1aa] hover:text-[#ededed] hover:bg-[#252628] transition-colors whitespace-nowrap flex-shrink-0 cursor-pointer leading-none"
          >
            <span className="flex h-3.5 w-3.5 items-center justify-center rounded-[2.5px] bg-[#0284c7] text-white text-[10px] font-bold leading-none select-none">
              −
            </span>
            <span>{selectedEntityIds.length} selected</span>
          </button>
        </Tooltip>

        {/* Divider */}
        <div className="h-3 w-[1px] bg-[#262729] mx-1 flex-shrink-0" />

        {/* Action Icon: Subscribe / Notifications */}
        <Tooltip tooltipContent="Notifications">
          <button
            type="button"
            onClick={handleToggleWatch}
            className="p-1 rounded-[4px] hover:bg-[#252628] text-[#8c8c94] hover:text-[#ededed] transition-colors flex-shrink-0 cursor-pointer"
          >
            <BellDot className="h-3.5 w-3.5 stroke-[1.5]" />
          </button>
        </Tooltip>

        {/* Action Icon: Duplicate */}
        <Tooltip tooltipContent="Make a copy">
          <button
            type="button"
            onClick={handleDuplicate}
            className="p-1 rounded-[4px] hover:bg-[#252628] text-[#8c8c94] hover:text-[#ededed] transition-colors flex-shrink-0 cursor-pointer"
          >
            <Copy className="h-3.5 w-3.5 stroke-[1.5]" />
          </button>
        </Tooltip>

        {/* Action Icon: Archive */}
        <Tooltip tooltipContent="Archive work items">
          <button
            type="button"
            onClick={handleBulkArchive}
            className="p-1 rounded-[4px] hover:bg-[#252628] text-[#8c8c94] hover:text-[#ededed] transition-colors flex-shrink-0 cursor-pointer"
          >
            <Archive className="h-3.5 w-3.5 stroke-[1.5]" />
          </button>
        </Tooltip>

        {/* Action Icon: Delete */}
        <Tooltip tooltipContent="Delete work items">
          <button
            type="button"
            onClick={() => setIsDeleteModalOpen(true)}
            className="p-1 rounded-[4px] hover:bg-[#252628] text-[#8c8c94] hover:text-red-400 transition-colors flex-shrink-0 cursor-pointer"
          >
            <Trash2 className="h-3.5 w-3.5 stroke-[1.5]" />
          </button>
        </Tooltip>

        {/* Spacer before properties */}
        <div className="w-1" />

        {/* Property: State */}
        <div className="relative">
          <button
            type="button"
            onClick={() => toggleDropdown("state")}
            className={getPillButtonClass(activeDropdown === "state")}
          >
            <Circle className="h-2.5 w-2.5 stroke-[1.75] text-[#8c8c94] flex-shrink-0" />
            <span>State</span>
          </button>

          {activeDropdown === "state" && (
            <div
              className="absolute bottom-full mb-2 left-0 z-50 min-w-[11rem] rounded-md border border-[#262729] bg-[#141515] p-1 shadow-2xl select-none max-h-64 overflow-y-auto space-y-0.5 animate-in fade-in zoom-in-95 duration-100"
              onClick={(e) => e.stopPropagation()}
            >
              {projectStates.length === 0 ? (
                <div className="p-2 text-[11px] text-[#71717a] text-center">No states available</div>
              ) : (
                projectStates.map((state) => (
                  <button
                    key={state.id}
                    type="button"
                    onClick={() => {
                      handleUpdateState(state.id);
                      setActiveDropdown(null);
                    }}
                    className="w-full flex items-center gap-2 px-2 py-1 rounded-[4px] hover:bg-[#252628] cursor-pointer text-[11px] text-[#e4e4e7] transition-colors text-left"
                  >
                    <StateGroupIcon stateGroup={state.group} color={state.color} size={EIconSize.XS} />
                    <span className="truncate">{state.name}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {/* Property: Priority */}
        <div className="relative">
          <button
            type="button"
            onClick={() => toggleDropdown("priority")}
            className={getPillButtonClass(activeDropdown === "priority")}
          >
            <Ban className="h-2.5 w-2.5 stroke-[1.75] text-[#8c8c94] flex-shrink-0" />
            <span>Priority</span>
          </button>

          {activeDropdown === "priority" && (
            <div
              className="absolute bottom-full mb-2 left-0 z-50 min-w-[10rem] rounded-md border border-[#262729] bg-[#141515] p-1 shadow-2xl select-none max-h-64 overflow-y-auto space-y-0.5 animate-in fade-in zoom-in-95 duration-100"
              onClick={(e) => e.stopPropagation()}
            >
              {ISSUE_PRIORITIES.map((priority) => (
                <button
                  key={priority.key}
                  type="button"
                  onClick={() => {
                    handleUpdatePriority(priority.key as TIssuePriorities);
                    setActiveDropdown(null);
                  }}
                  className="w-full flex items-center gap-2 px-2 py-1 rounded-[4px] hover:bg-[#252628] cursor-pointer text-[11px] text-[#e4e4e7] capitalize transition-colors text-left"
                >
                  <PriorityIcon priority={priority.key as TIssuePriorities} size={13} />
                  <span className="truncate">{priority.title || priority.key}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Property: Assignees */}
        <div className="relative">
          <button
            type="button"
            onClick={() => toggleDropdown("assignees")}
            className={getPillButtonClass(activeDropdown === "assignees")}
          >
            <Users className="h-3 w-3 stroke-[1.75] text-[#8c8c94] flex-shrink-0" />
            <span>Assignees</span>
          </button>

          {activeDropdown === "assignees" && (
            <AssigneesDropdown
              memberIds={memberIds}
              getUserDetails={getUserDetails}
              currentUserId={currentUser?.id}
              onSelectMember={(userId) => handleUpdateAssignee(userId)}
              onClose={() => setActiveDropdown(null)}
            />
          )}
        </div>

        {/* Property: Start date */}
        <div className="relative">
          <button
            type="button"
            onClick={() => toggleDropdown("start_date")}
            className={getPillButtonClass(activeDropdown === "start_date")}
          >
            <CalendarCheck className="h-3 w-3 stroke-[1.75] text-[#8c8c94] flex-shrink-0" />
            <span>Start date</span>
          </button>

          {activeDropdown === "start_date" && (
            <BulkCalendarDropdown
              onSelectDate={(date) => handleUpdateStartDate(formatDatePayload(date))}
              onClose={() => setActiveDropdown(null)}
            />
          )}
        </div>

        {/* Property: Due date */}
        <div className="relative">
          <button
            type="button"
            onClick={() => toggleDropdown("due_date")}
            className={getPillButtonClass(activeDropdown === "due_date")}
          >
            <CalendarIcon className="h-3 w-3 stroke-[1.75] text-[#8c8c94] flex-shrink-0" />
            <span>Due date</span>
          </button>

          {activeDropdown === "due_date" && (
            <BulkCalendarDropdown
              onSelectDate={(date) => handleUpdateDueDate(formatDatePayload(date))}
              onClose={() => setActiveDropdown(null)}
            />
          )}
        </div>

        {/* Property: Labels */}
        <div className="relative">
          <button
            type="button"
            onClick={() => toggleDropdown("labels")}
            className={getPillButtonClass(activeDropdown === "labels")}
          >
            <Tag className="h-2.5 w-2.5 stroke-[1.75] text-[#8c8c94] flex-shrink-0" />
            <span>Labels</span>
          </button>

          {activeDropdown === "labels" && (
            <LabelsDropdown
              labels={projectLabels}
              onSelectLabel={(labelId) => handleAddLabel(labelId)}
              onClose={() => setActiveDropdown(null)}
            />
          )}
        </div>

        {/* Property: Cycle */}
        <div className="relative">
          <button
            type="button"
            onClick={() => toggleDropdown("cycle")}
            className={getPillButtonClass(activeDropdown === "cycle")}
          >
            <CycleIcon className="h-3 w-3 text-[#8c8c94] flex-shrink-0" />
            <span>Cycle</span>
          </button>

          {activeDropdown === "cycle" && (
            <div
              className="absolute bottom-full mb-2 right-0 z-50 min-w-[12rem] rounded-md border border-[#262729] bg-[#141515] p-1 shadow-2xl select-none max-h-64 overflow-y-auto space-y-0.5 animate-in fade-in zoom-in-95 duration-100"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => {
                  handleUpdateCycle(null);
                  setActiveDropdown(null);
                }}
                className="w-full flex items-center gap-2 px-2 py-1 rounded-[4px] hover:bg-[#252628] text-[11px] text-[#71717a] hover:text-red-400 cursor-pointer transition-colors text-left"
              >
                None (Remove from cycle)
              </button>
              {projectCycles.length === 0 ? (
                <div className="p-2 text-[11px] text-[#71717a] text-center">No cycles available</div>
              ) : (
                projectCycles.map((cycle) => (
                  <button
                    key={cycle.id}
                    type="button"
                    onClick={() => {
                      handleUpdateCycle(cycle.id);
                      setActiveDropdown(null);
                    }}
                    className="w-full flex items-center gap-2 px-2 py-1 rounded-[4px] hover:bg-[#252628] text-[11px] text-[#e4e4e7] cursor-pointer transition-colors text-left"
                  >
                    <CycleIcon className="h-3 w-3 flex-shrink-0 text-[#71717a]" />
                    <span className="truncate">{cycle.name}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {/* Property: Module */}
        <div className="relative">
          <button
            type="button"
            onClick={() => toggleDropdown("module")}
            className={getPillButtonClass(activeDropdown === "module")}
          >
            <ModuleIcon className="h-3 w-3 text-[#8c8c94] flex-shrink-0" />
            <span>Module</span>
          </button>

          {activeDropdown === "module" && (
            <div
              className="absolute bottom-full mb-2 right-0 z-50 min-w-[12rem] rounded-md border border-[#262729] bg-[#141515] p-1 shadow-2xl select-none max-h-64 overflow-y-auto space-y-0.5 animate-in fade-in zoom-in-95 duration-100"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => {
                  handleUpdateModule(null);
                  setActiveDropdown(null);
                }}
                className="w-full flex items-center gap-2 px-2 py-1 rounded-[4px] hover:bg-[#252628] text-[11px] text-[#71717a] hover:text-red-400 cursor-pointer transition-colors text-left"
              >
                None (Remove from module)
              </button>
              {projectModules.length === 0 ? (
                <div className="p-2 text-[11px] text-[#71717a] text-center">No modules available</div>
              ) : (
                projectModules.map((mod) => (
                  <button
                    key={mod.id}
                    type="button"
                    onClick={() => {
                      handleUpdateModule(mod.id);
                      setActiveDropdown(null);
                    }}
                    className="w-full flex items-center gap-2 px-2 py-1 rounded-[4px] hover:bg-[#252628] text-[11px] text-[#e4e4e7] cursor-pointer transition-colors text-left"
                  >
                    <ModuleIcon className="h-3 w-3 flex-shrink-0 text-[#71717a]" />
                    <span className="truncate">{mod.name}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      <AlertModalCore
        isOpen={isDeleteModalOpen}
        handleClose={() => setIsDeleteModalOpen(false)}
        handleSubmit={handleBulkDelete}
        isSubmitting={isDeleting}
        title="Delete work items"
        content={
          <>
            Are you sure you want to delete{" "}
            <span className="font-semibold text-primary">{selectedEntityIds.length} work items</span>? This action cannot
            be undone.
          </>
        }
      />
    </>
  );
});
