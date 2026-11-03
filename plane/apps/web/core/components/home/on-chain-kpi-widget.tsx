/* oxlint-disable unicorn/no-array-sort -- ES2022 target; assignment records are copied before sorting. */
import { useProjectSnapshot } from "./dashboard-kpi/use-project-snapshot";
import { ActivityAttachment } from "./dashboard-kpi/activity-attachment";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Copy,
  FileText,
  FolderKanban,
  MessageSquare,
  Paperclip,
  UserRound,
} from "lucide-react";
import { type TBlockchainTrackingRecord } from "@/services/blockchain/blockchain-tracking.service";
import { getWalletKPI, type OnChainKPI } from "@/services/blockchain/plane-task-chain.service";
import { ProjectService } from "@/services/project";
import { WorkspaceService } from "@/services/workspace.service";
import { IssueCommentService } from "@/services/issue/issue_comment.service";
import { IssueAttachmentService } from "@/services/issue/issue_attachment.service";
import type { TIssueAttachment, TIssueComment } from "@plane/types";
import { useUser } from "@/hooks/store/user";
import {
  calculateTaskProgress,
  mergeAndDeduplicateReports,
  aggregateBranchKpi,
  getHierarchyCount,
} from "./dashboard-kpi/kpi-calculator";
import { resolveMemberIdentity, formatShortWallet, normalizeWallet } from "./dashboard-kpi/identity-resolver";
import {
  resolveActivityRecords,
  formatVietnamDateTime,
  type ResolvedActivityItem,
} from "./dashboard-kpi/activity-resolver";
import type { AggregateBranchKpi, TaskNode } from "./dashboard-kpi/types";

type Props = { workspaceSlug: string };
type ProjectOption = { id: string; name: string; identifier?: string };

const projectService = new ProjectService();
const workspaceService = new WorkspaceService();
const issueCommentService = new IssueCommentService();
const issueAttachmentService = new IssueAttachmentService();

function shortHash(value?: string): string {
  if (!value) return "Chưa có";
  return value.length > 22 ? `${value.slice(0, 10)}...${value.slice(-8)}` : value;
}

function KpiGrid({ value }: { value: AggregateBranchKpi }) {
  const items: Array<[string, number | string]> = [
    ["Tổng task (lá)", value.total],
    ["Chưa làm", value.todo],
    ["Đang làm", value.inProgress],
    ["Hoàn thành", value.completed],
    ...(value.cancelled > 0 ? [["Đã hủy", value.cancelled] as [string, number | string]] : []),
    ["Đúng tiến độ", value.onSchedule],
    ["Chậm", value.delayed],
    ["Quá hạn", value.overdue],
    ["Tiến độ TB", value.averageProgress === null ? "Chưa có dữ liệu" : `${value.averageProgress}%`],
    ["Báo cáo (đã đọc)", value.totalReports],
  ];

  return (
    <div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
        {items.map(([label, metric]) => (
          <div key={label} className="rounded-lg border border-subtle bg-surface-1/65 p-3 backdrop-blur-md">
            <p className="text-10 text-tertiary">{label}</p>
            <p className="mt-1 text-16 font-semibold text-primary">{metric}</p>
          </div>
        ))}
      </div>
      {value.hasIncompleteData && (
        <p className="mt-2 text-11 text-tertiary">
          Số liệu chưa đầy đủ; tiến độ trung bình chỉ tính các task có dữ liệu.
        </p>
      )}
      {value.unreconciledReports > 0 && (
        <p className="mt-2 text-11 text-tertiary">
          {value.unreconciledReports} bản local chưa đối chiếu định danh, không cộng vào tổng báo cáo.
        </p>
      )}
    </div>
  );
}

export function OnChainKpiWidget({ workspaceSlug }: Props) {
  const { data: currentUser } = useUser();
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [workspaceMembers, setWorkspaceMembers] = useState<any[]>([]);
  const [comments, setComments] = useState<TIssueComment[]>([]);
  const [attachments, setAttachments] = useState<TIssueAttachment[]>([]);
  const [kpi, setKpi] = useState<OnChainKPI>();
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loadingKpi, setLoadingKpi] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [openTechDetails, setOpenTechDetails] = useState<Record<string, boolean>>({});
  const [expandedTaskIds, setExpandedTaskIds] = useState<Set<string>>(new Set());
  const currentUserWallet = (currentUser as { wallet_address?: string })?.wallet_address;
  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selectedProjectId),
    [projects, selectedProjectId]
  );
  const snapshot = useProjectSnapshot(workspaceSlug, selectedProject, currentUserWallet);
  const { roots, tasksById, allTasks, progress: onChainProgress } = snapshot;
  const loadingTasks = Boolean(selectedProjectId && !snapshot.loaded);
  const error = [catalogError, snapshot.error, detailError].filter(Boolean).join(" ");
  const selectedTask = tasksById.get(selectedTaskId);
  const selectedTaskDetails = selectedTask?.chainDetails;
  const selectProject = (id: string) => {
    setSelectedProjectId(id);
    setSelectedTaskId("");
  };
  const selectTask = (id: string) => setSelectedTaskId(id);

  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(copyTimer.current), []);
  const handleCopy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      setDetailError("Không sao chép được. Hãy chọn và sao chép nội dung thủ công.");
    }
  };
  const toggleTechDetails = (id: string) => setOpenTechDetails((prev) => ({ ...prev, [id]: !prev[id] }));

  useEffect(() => {
    let active = true;
    setProjects([]);
    setSelectedProjectId("");
    setSelectedTaskId("");
    setWorkspaceMembers([]);
    setLoadingProjects(true);
    setCatalogError("");
    void (async () => {
      try {
        const [items, members] = await Promise.allSettled([
          projectService.getProjectsLite(workspaceSlug),
          workspaceService.fetchWorkspaceMembers(workspaceSlug),
        ]);
        if (!active) return;
        if (items.status === "rejected") throw items.reason;
        const options = items.value.map((p) => ({ id: p.id, name: p.name, identifier: p.identifier }));
        setProjects(options);
        setSelectedProjectId(options[0]?.id ?? "");
        if (members.status === "fulfilled") setWorkspaceMembers(Array.isArray(members.value) ? members.value : []);
        else setCatalogError("Chưa tải được hồ sơ thành viên; danh tính có thể chưa đầy đủ.");
      } catch {
        if (active) setCatalogError("Không tải được danh mục dự án.");
      } finally {
        if (active) setLoadingProjects(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [workspaceSlug]);

  // Expand newly selected project once, without reopening user-collapsed branches on each poll.
  const expandedProject = useRef("");
  useEffect(() => {
    const key = workspaceSlug + "/" + selectedProjectId;
    if (!allTasks.length || expandedProject.current === key) return;
    expandedProject.current = key;
    setExpandedTaskIds(new Set(allTasks.filter((t) => t.directChildren.length).map((t) => t.id)));
  }, [allTasks, workspaceSlug, selectedProjectId]);

  useEffect(() => {
    let active = true;
    setComments([]);
    setAttachments([]);
    setKpi(undefined);
    setLoadingKpi(false);
    setDetailError("");
    if (!selectedTask)
      return () => {
        active = false;
      };
    void (async () => {
      const results = await Promise.allSettled([
        issueCommentService.getIssueComments(workspaceSlug, selectedProjectId, selectedTask.id),
        issueAttachmentService.getIssueAttachments(workspaceSlug, selectedProjectId, selectedTask.id),
      ]);
      if (!active) return;
      if (results[0].status === "fulfilled") setComments(Array.isArray(results[0].value) ? results[0].value : []);
      if (results[1].status === "fulfilled") setAttachments(Array.isArray(results[1].value) ? results[1].value : []);
      if (results.some((r) => r.status === "rejected"))
        setDetailError("Chưa tải đủ bình luận hoặc tệp bằng chứng. Hãy thử làm mới.");
    })();
    const assignment = [...selectedTask.records]
      .sort((a, b) => (Date.parse(b.recorded_at || "") || 0) - (Date.parse(a.recorded_at || "") || 0))
      .find((r) => r.event_type === "assign_task" || (r.event_type === "create_task" && r.assignee_wallet));
    const targetWallet = normalizeWallet(selectedTaskDetails?.assignee) || normalizeWallet(assignment?.assignee_wallet);
    if (targetWallet && targetWallet !== "0x0000000000000000000000000000000000000000") {
      setLoadingKpi(true);
      void getWalletKPI(targetWallet)
        .then((result) => {
          if (active) setKpi(result.kpi);
          return result;
        })
        .catch(() => {
          if (active)
            setDetailError((prev) => [prev, "Chưa đọc được KPI của ví từ contract."].filter(Boolean).join(" "));
        })
        .finally(() => {
          if (active) setLoadingKpi(false);
        });
    }
    return () => {
      active = false;
    };
  }, [selectedTask, selectedTaskDetails, selectedProjectId, workspaceSlug]);

  const summaries = useMemo(
    () =>
      Object.fromEntries(
        allTasks.map((task) => [
          task.id,
          mergeAndDeduplicateReports(task, snapshot.chain.reports[task.id], currentUserWallet, snapshot.chain.reports),
        ])
      ),
    [allTasks, snapshot.chain.reports, currentUserWallet]
  );
  const reportsSummary = selectedTask ? summaries[selectedTask.id] : null;
  const activityItems: ResolvedActivityItem[] = useMemo(
    () =>
      selectedTask
        ? resolveActivityRecords(
            selectedTask.records.filter((r) => r.event_type === "task_content"),
            comments,
            attachments
          )
        : [],
    [selectedTask, comments, attachments]
  );
  const selectedTaskProgress = selectedTask ? calculateTaskProgress(selectedTask, onChainProgress) : null;
  const selectedTaskCounts = selectedTask ? getHierarchyCount(selectedTask) : null;
  const selectedTaskKpi = selectedTask
    ? aggregateBranchKpi([selectedTask, ...selectedTask.allDescendants], onChainProgress, summaries)
    : null;
  const allProjectLeaves = allTasks.filter((task) => !task.directChildren.length);
  const projectKpi = aggregateBranchKpi(allTasks, onChainProgress, summaries);

  // 9. Danh tính người được giao
  const assignmentRecord = useMemo(() => {
    if (!selectedTask) return undefined;
    const confirmedAssignee =
      selectedTaskDetails?.assignee &&
      selectedTaskDetails.assignee.toLowerCase() !== "0x0000000000000000000000000000000000000000"
        ? normalizeWallet(selectedTaskDetails.assignee)
        : undefined;

    const explicit =
      [...selectedTask.records]
        .sort((a, b) => (Date.parse(b.recorded_at || "") || 0) - (Date.parse(a.recorded_at || "") || 0))
        .find((record) => record.event_type === "assign_task") ??
      selectedTask.records.find((record) => record.event_type === "create_task" && record.assignee_wallet);

    if (confirmedAssignee) {
      if (explicit && normalizeWallet(explicit.assignee_wallet) === confirmedAssignee) {
        return explicit;
      }
      return {
        event_type: "assign_task" as const,
        assignee_wallet: confirmedAssignee,
      } as TBlockchainTrackingRecord;
    }

    if (explicit) return explicit;
    return undefined;
  }, [selectedTask, selectedTaskDetails]);

  const assigneeIdentity = useMemo(() => {
    return resolveMemberIdentity(
      {
        assignee_wallet: assignmentRecord?.assignee_wallet,
        assignee_id: assignmentRecord?.assignee_id,
        assignee_name: assignmentRecord?.assignee_name,
      },
      workspaceMembers,
      currentUser
    );
  }, [assignmentRecord, workspaceMembers, currentUser]);

  const toggleTask = (taskId: string) => {
    setExpandedTaskIds((current) => {
      const next = new Set(current);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const renderTaskRow = (task: TaskNode, depth = 0) => {
    const hasChildren = task.directChildren.length > 0;
    const expanded = expandedTaskIds.has(task.id);
    const progress = calculateTaskProgress(task, onChainProgress);
    const repSummary = summaries[task.id];
    const isSelected = selectedTaskId === task.id;

    return (
      <div key={task.id}>
        <div
          className={`flex rounded-lg transition-colors ${
            isSelected ? "border-accent-primary border-l-2 bg-accent-primary/10" : "hover:bg-surface-2"
          }`}
          style={{ marginLeft: `${depth * 14}px` }}
        >
          {hasChildren ? (
            <button
              type="button"
              aria-label={expanded ? "Thu gọn task con" : "Mở danh sách task con"}
              aria-expanded={expanded}
              onClick={() => toggleTask(task.id)}
              className="flex w-8 shrink-0 items-center justify-center text-tertiary hover:text-primary"
            >
              {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
          ) : (
            <span className="w-8 shrink-0" />
          )}
          <button
            type="button"
            onClick={() => selectTask(task.id)}
            className="min-w-0 flex-1 px-1 py-2.5 pr-3 text-left active:scale-[0.99]"
          >
            <span className="flex items-center gap-2">
              {task.identifier && (
                <span className="font-mono shrink-0 rounded bg-surface-2 px-1 py-0.5 text-10 font-semibold text-tertiary">
                  {task.identifier}
                </span>
              )}
              <span className="truncate text-12 font-medium text-primary">{task.name}</span>
              {hasChildren && <span className="text-10 text-tertiary">({task.directChildren.length})</span>}
            </span>
            <span className="mt-1 flex items-center justify-between text-10 text-tertiary">
              <span>
                {repSummary.directCount}{" "}
                {snapshot.chain.reports[task.id] === undefined ? "bản local · chưa đọc đủ contract" : "báo cáo"}
              </span>
              <span className="font-medium text-secondary">{progress.formatted}</span>
            </span>
            {progress.hasPendingReport && (
              <span className="mt-1 block text-10 text-warning-primary">
                Báo cáo local: {progress.localProgress}% · Chưa xác nhận trên chain
              </span>
            )}
            <span className="bg-surface-3 mt-2 block h-1 overflow-hidden rounded-full" aria-hidden="true">
              <span
                className={`block h-full rounded-full transition-all ${
                  progress.confidence === "confirmed" ? "bg-accent-primary" : "bg-accent-primary/60"
                }`}
                style={{ width: `${progress.value ?? 0}%` }}
              />
            </span>
          </button>
        </div>
        {expanded && task.directChildren.map((child) => renderTaskRow(child, depth + 1))}
      </div>
    );
  };

  const kpiItems = kpi
    ? [
        ["Tổng task", kpi.total],
        ["Đang làm", kpi.inProgress],
        ["Hoàn thành", kpi.completed],
        ["Đã hủy", kpi.cancelled],
        ["Đúng tiến độ", kpi.onSchedule],
        ["Chậm", kpi.delayed],
        ["Quá hạn", kpi.overdue],
        ["Tiến độ TB", `${kpi.averageProgress}%`],
      ]
    : [];

  return (
    <section className="shadow-sm overflow-hidden rounded-2xl border border-subtle bg-layer-1/75 backdrop-blur-xl">
      <header className="border-b border-subtle px-5 py-4">
        <h2 className="text-14 font-semibold text-primary">Dashboard KPI</h2>
        <p className="mt-1 text-11 text-tertiary">
          Theo dõi tiến độ và báo cáo; dữ liệu contract và dữ liệu chờ đồng bộ được ghi nhãn riêng.
        </p>
        <div className="mt-2 flex items-center gap-3 text-11 text-tertiary" aria-live="polite">
          <button
            type="button"
            disabled={snapshot.refreshing || !selectedProjectId}
            onClick={() => void snapshot.refresh()}
            className="text-accent-primary disabled:opacity-50"
          >
            {snapshot.refreshing ? "Đang cập nhật..." : "Làm mới"}
          </button>
          {snapshot.updatedAt && <span>Đọc lần cuối: {formatVietnamDateTime(snapshot.updatedAt / 1000)}</span>}
        </div>
        {error && (
          <p role="status" className="mt-2 text-11 text-danger-primary">
            {error}
          </p>
        )}
        {allTasks.some((task) => calculateTaskProgress(task, onChainProgress).hasPendingReport) && (
          <p className="mt-2 text-11 text-warning-primary">
            Có báo cáo mới chỉ lưu local. Tiến độ contract và KPI đã xác nhận chưa bao gồm các báo cáo này.
          </p>
        )}
      </header>

      <div className="grid min-h-[520px] grid-cols-1 divide-y divide-subtle lg:grid-cols-[220px_300px_minmax(0,1fr)] lg:divide-x lg:divide-y-0 xl:grid-cols-[260px_360px_minmax(560px,1fr)]">
        {/* Cột 1: Danh sách Dự án */}
        <div className="p-3">
          <div className="flex items-center gap-2 px-2 py-2 text-11 font-medium text-secondary">
            <FolderKanban className="h-4 w-4" aria-hidden="true" />
            Dự án
          </div>
          {loadingProjects ? (
            <div className="space-y-2 px-2 py-3" aria-label="Đang tải dự án">
              {[0, 1, 2].map((item) => (
                <div key={item} className="h-10 animate-pulse rounded-lg bg-surface-2/70" />
              ))}
            </div>
          ) : catalogError && !projects.length ? (
            <div className="flex items-center gap-2 px-2 py-4 text-11 text-danger-primary">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : projects.length === 0 ? (
            <p className="px-2 py-4 text-11 text-tertiary">Chưa có dự án nào trong workspace.</p>
          ) : (
            <div className="space-y-1">
              {projects.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => void selectProject(project.id)}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left transition-colors active:scale-[0.99] ${
                    selectedProjectId === project.id
                      ? "bg-accent-primary/10 text-accent-primary"
                      : "text-secondary hover:bg-surface-2"
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-12 font-medium">{project.name}</span>
                    {project.identifier && <span className="block text-10 text-tertiary">{project.identifier}</span>}
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Cột 2: Cây Task */}
        <div className="p-3">
          <div className="flex items-center gap-2 px-2 py-2 text-11 font-medium text-secondary">
            <ClipboardList className="h-4 w-4" aria-hidden="true" />
            Task {selectedProject ? `trong ${selectedProject.name}` : ""}
          </div>
          {!selectedProjectId ? (
            <p className="px-2 py-4 text-11 text-tertiary">Chọn một dự án để xem danh sách công việc.</p>
          ) : loadingTasks ? (
            <div className="space-y-2 px-2 py-3" aria-label="Đang tải task">
              {[0, 1, 2].map((item) => (
                <div key={item} className="h-12 animate-pulse rounded-lg bg-surface-2/70" />
              ))}
            </div>
          ) : snapshot.error && !allTasks.length ? (
            <div className="flex items-center gap-2 px-2 py-4 text-11 text-danger-primary">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : allTasks.length === 0 ? (
            <p className="px-2 py-4 text-11 text-tertiary">Dự án chưa có task nào.</p>
          ) : (
            <div className="space-y-1">{roots.map((task) => renderTaskRow(task))}</div>
          )}
        </div>

        {/* Cột 3: Chi tiết Task hoặc Tổng quan Dự án */}
        <div className="min-w-0 p-5">
          {!selectedTask ? (
            selectedProject ? (
              <div className="space-y-5">
                <div>
                  <p className="text-10 text-tertiary">{selectedProject.identifier || "PROJECT"}</p>
                  <h3 className="mt-1 text-16 font-semibold text-primary">Tổng quan {selectedProject.name}</h3>
                  <p className="mt-1 text-11 text-tertiary">
                    KPI tổng hợp từ {allProjectLeaves.length} task lá trong toàn bộ dự án.
                  </p>
                </div>
                <KpiGrid value={projectKpi} />
                <div>
                  <h4 className="text-12 font-semibold text-primary">Tiến độ task cấp cao nhất trong dự án</h4>
                  <div className="mt-3 space-y-2">
                    {roots.map((task) => {
                      const summary = aggregateBranchKpi([task, ...task.allDescendants], onChainProgress, summaries);
                      const prog = calculateTaskProgress(task, onChainProgress);
                      return (
                        <button
                          key={task.id}
                          type="button"
                          onClick={() => selectTask(task.id)}
                          className="w-full rounded-lg border border-subtle bg-surface-1/60 p-3 text-left transition-colors hover:bg-surface-2"
                        >
                          <span className="flex items-center justify-between gap-3">
                            <span className="truncate text-11 font-medium text-primary">
                              {task.identifier ? `[${task.identifier}] ` : ""}
                              {task.name}
                            </span>
                            <span className="text-10 font-semibold text-primary">{prog.formatted}</span>
                          </span>
                          <span className="bg-surface-3 mt-2 block h-1.5 overflow-hidden rounded-full">
                            <span
                              className="block h-full rounded-full bg-accent-primary"
                              style={{ width: `${prog.value ?? 0}%` }}
                            />
                          </span>
                          <span className="mt-2 block text-10 text-tertiary">
                            {task.directChildren.length > 0
                              ? `${task.directChildren.length} task con trực tiếp · `
                              : ""}
                            {summary.completed}/{summary.total} hoàn thành · {summary.totalReports} báo cáo đã đọc
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex min-h-[360px] flex-col items-center justify-center text-center">
                <FileText className="h-8 w-8 text-tertiary" aria-hidden="true" />
                <p className="mt-3 text-12 font-medium text-secondary">Chọn một dự án để xem dữ liệu KPI</p>
              </div>
            )
          ) : (
            <div className="space-y-5">
              {error && (
                <div className="flex items-center gap-2 rounded-lg border border-danger-subtle bg-danger-subtle/10 px-3 py-2.5 text-11 text-danger-primary">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
              {/* Header Task */}
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-10 text-tertiary">
                    {selectedTask.identifier || selectedProject?.identifier || "TASK"}
                  </p>
                  <h3 className="mt-1 truncate text-16 font-semibold text-primary">
                    {selectedTask.identifier ? `[${selectedTask.identifier}] ` : ""}
                    {selectedTask.name}
                  </h3>
                  <p className="mt-1 text-11 text-tertiary">
                    Thời gian tạo:{" "}
                    {formatVietnamDateTime(
                      selectedTask.records.find((r) => r.event_type === "create_task")?.recorded_at,
                      selectedTaskDetails?.createdAt
                        ? new Date(selectedTaskDetails.createdAt * 1000).toISOString()
                        : undefined
                    )}
                  </p>
                </div>
                <div className="rounded-lg border border-subtle bg-surface-1/70 px-3 py-2 text-right backdrop-blur-md">
                  <div className="flex items-center justify-end gap-2">
                    <p className="text-10 text-tertiary">Tiến độ chuẩn hóa</p>
                    <span
                      className={`rounded px-1.5 py-0.5 text-9 font-medium ${
                        selectedTaskProgress?.confidence === "confirmed"
                          ? "bg-accent-primary/10 text-accent-primary"
                          : selectedTaskProgress?.confidence === "estimated"
                            ? "bg-warning-subtle text-warning-primary"
                            : "bg-surface-2 text-tertiary"
                      }`}
                    >
                      {selectedTaskProgress?.confidence === "confirmed"
                        ? "On-chain"
                        : selectedTaskProgress?.confidence === "estimated"
                          ? "Ước tính từ con"
                          : selectedTaskProgress?.confidence === "missing"
                            ? "Chưa có dữ liệu"
                            : "Chờ đồng bộ"}
                    </span>
                  </div>
                  <p className="mt-0.5 text-18 font-semibold text-primary">{selectedTaskProgress?.formatted}</p>
                  {selectedTaskProgress?.hasPendingReport && (
                    <p className="mt-1 text-11 text-warning-primary">
                      Báo cáo local: {selectedTaskProgress.localProgress}% · Chưa xác nhận trên chain
                    </p>
                  )}
                  <div
                    className="bg-surface-3 mt-2 h-1.5 w-32 overflow-hidden rounded-full"
                    role="progressbar"
                    aria-label="Tiến độ task"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={selectedTaskProgress?.value ?? 0}
                  >
                    <div
                      className="h-full rounded-full bg-accent-primary transition-[width]"
                      style={{ width: `${selectedTaskProgress?.value ?? 0}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Khối KPI tổng hợp / KPI của task */}
              {selectedTaskKpi && (
                <div>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h4 className="text-12 font-semibold text-primary">
                      {selectedTaskCounts && selectedTaskCounts.directCount > 0
                        ? "KPI tổng hợp task cha"
                        : "KPI của task"}
                    </h4>
                    {selectedTaskCounts && selectedTaskCounts.directCount > 0 && (
                      <span className="text-10 text-tertiary">
                        Tổng hợp từ {selectedTaskCounts.directCount} task con trực tiếp ({selectedTaskCounts.leafCount}{" "}
                        task lá)
                      </span>
                    )}
                  </div>
                  <KpiGrid value={selectedTaskKpi} />
                </div>
              )}

              {/* Danh sách Task con trực tiếp */}
              {selectedTask.directChildren.length > 0 && (
                <div>
                  <h4 className="text-12 font-semibold text-primary">
                    Task con trực tiếp ({selectedTask.directChildren.length})
                  </h4>
                  <div className="mt-3 space-y-2">
                    {selectedTask.directChildren.map((child) => {
                      const childProg = calculateTaskProgress(child, onChainProgress);
                      const childRep = summaries[child.id];
                      return (
                        <button
                          key={child.id}
                          type="button"
                          onClick={() => selectTask(child.id)}
                          className="flex w-full items-center justify-between rounded-lg border border-subtle bg-surface-1/60 px-3 py-2.5 text-left transition-colors hover:bg-surface-2"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-11 font-medium text-primary">
                              {child.identifier ? `[${child.identifier}] ` : ""}
                              {child.name}
                            </span>
                            <span className="mt-0.5 block text-10 text-tertiary">{childRep.directCount} báo cáo</span>
                          </span>
                          <span className="ml-3 text-11 font-semibold text-primary">{childProg.formatted}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Khối Nhân viên được giao */}
              <div className="rounded-xl border border-subtle bg-surface-1/60 p-4 backdrop-blur-md">
                <div className="flex items-center gap-2 text-11 font-medium text-secondary">
                  <UserRound className="h-4 w-4" aria-hidden="true" />
                  Nhân viên được giao
                </div>
                {assignmentRecord ? (
                  <div className="mt-3 grid gap-2 text-11 sm:grid-cols-2">
                    <div>
                      <span className="text-tertiary">Tên nhân viên:</span>{" "}
                      <span className="font-medium text-primary">{assigneeIdentity.displayName}</span>
                      {assigneeIdentity.isCurrentUser && (
                        <span className="ml-1.5 rounded bg-accent-primary/10 px-1.5 py-0.5 text-9 text-accent-primary">
                          Bạn
                        </span>
                      )}
                    </div>
                    <div>
                      <span className="text-tertiary">Thời gian giao:</span>{" "}
                      <span className="text-primary">
                        {formatVietnamDateTime(assignmentRecord.recorded_at, (assignmentRecord as any).created_at)}
                      </span>
                    </div>
                    {assigneeIdentity.email && (
                      <div>
                        <span className="text-tertiary">Email:</span>{" "}
                        <span className="text-primary">{assigneeIdentity.email}</span>
                      </div>
                    )}
                    {assigneeIdentity.wallet && (
                      <div className="flex items-center gap-2 sm:col-span-2">
                        <span className="shrink-0 text-tertiary">Địa chỉ ví:</span>{" "}
                        <span className="font-mono break-all text-primary">{assigneeIdentity.wallet}</span>
                        <button
                          type="button"
                          onClick={() => handleCopy(assigneeIdentity.wallet!, "assignee_wallet")}
                          className="shrink-0 p-1 text-tertiary transition-colors hover:text-primary"
                          title="Sao chép ví"
                        >
                          {copiedKey === "assignee_wallet" ? (
                            <Check className="h-3.5 w-3.5 text-success-primary" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </div>
                    )}
                    <div className="flex items-center gap-2 sm:col-span-2">
                      <span className="shrink-0 text-tertiary">Hash giao task:</span>{" "}
                      {assignmentRecord.transaction_hash ? (
                        <>
                          <span className="font-mono text-primary" title={assignmentRecord.transaction_hash}>
                            {shortHash(assignmentRecord.transaction_hash)}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleCopy(assignmentRecord.transaction_hash!, "assign_tx")}
                            className="p-1 text-tertiary transition-colors hover:text-primary"
                            title="Sao chép hash"
                          >
                            {copiedKey === "assign_tx" ? (
                              <Check className="h-3.5 w-3.5 text-success-primary" />
                            ) : (
                              <Copy className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </>
                      ) : (
                        <span className="text-tertiary italic">Lưu nội bộ (Chưa có hash giao task on-chain riêng)</span>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="mt-3 text-11 text-tertiary">Task chưa có bản ghi giao nhân viên.</p>
                )}
              </div>

              {/* Khối KPI nhân viên theo ví trong contract */}
              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div>
                    <h4 className="text-12 font-semibold text-primary">KPI của ví trong contract hiện tại</h4>
                    <p className="text-10 text-tertiary">
                      Chỉ số tích lũy toàn contract cho ví được giao, gồm cả task đã hủy; khác phạm vi task lá của dự
                      án.
                    </p>
                  </div>
                  {loadingKpi && <span className="animate-pulse text-10 text-tertiary">Đang đọc contract...</span>}
                </div>
                {kpi ? (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {kpiItems.map(([label, val]) => (
                      <div key={label} className="rounded-lg border border-subtle bg-surface-1/65 p-3 backdrop-blur-md">
                        <p className="text-10 text-tertiary">{label}</p>
                        <p className="mt-1 text-16 font-semibold text-primary">{val}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  !loadingKpi && (
                    <p className="rounded-lg border border-dashed border-subtle px-3 py-4 text-11 text-tertiary">
                      {assignmentRecord?.assignee_wallet
                        ? "Chưa đọc được dữ liệu KPI cho ví này từ contract."
                        : "Cần giao task on-chain để tra cứu KPI theo ví."}
                    </p>
                  )
                )}
              </div>

              {/* Khối Báo cáo cuối ngày */}
              {reportsSummary && (
                <div>
                  <div className="flex items-center justify-between gap-3">
                    <h4 className="text-12 font-semibold text-primary">
                      {snapshot.chain.reports[selectedTask.id] === undefined
                        ? `Báo cáo: chưa đọc đủ contract (${reportsSummary.directCount} bản local)`
                        : `Báo cáo của task này (${reportsSummary.directCount})`}
                    </h4>
                    {reportsSummary.branchCount > reportsSummary.directCount && (
                      <span className="text-10 text-tertiary">
                        ({reportsSummary.branchCount} báo cáo đã đọc trong toàn nhánh)
                      </span>
                    )}
                  </div>
                  {reportsSummary.directCount === 0 ? (
                    <p className="mt-3 rounded-lg border border-dashed border-subtle px-3 py-4 text-11 text-tertiary">
                      {snapshot.chain.reports[selectedTask.id] === undefined
                        ? "Chưa xác định được số báo cáo trên contract. Hãy thử làm mới."
                        : "Chưa có báo cáo trong dữ liệu đã đọc cho task này."}
                    </p>
                  ) : (
                    <div className="mt-3 space-y-3">
                      {reportsSummary.directReports.map((report) => (
                        <article
                          key={report.id}
                          className="rounded-xl border border-subtle bg-surface-1/60 p-4 backdrop-blur-md"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <time className="text-11 font-medium text-secondary">
                              {formatVietnamDateTime(report.recordedAt)}
                            </time>
                            <div className="flex items-center gap-2">
                              <span className="rounded-md bg-accent-primary/10 px-2 py-0.5 text-10 font-medium text-accent-primary">
                                {report.progress === null ? "Chưa có tiến độ" : `Tiến độ ${report.progress}%`}
                              </span>
                              <span
                                className={`rounded-md px-2 py-0.5 text-10 font-medium ${
                                  report.reconciliationStatus === "content_verified"
                                    ? "bg-success-subtle text-success-primary"
                                    : report.reconciliationStatus === "confirmed_on_chain"
                                      ? "bg-accent-primary/10 text-accent-primary"
                                      : "bg-surface-2 text-tertiary"
                                }`}
                              >
                                {report.reconciliationStatus === "content_verified"
                                  ? "Nội dung khớp contract"
                                  : report.reconciliationStatus === "confirmed_on_chain"
                                    ? "On-chain"
                                    : "Chờ đồng bộ"}
                              </span>
                            </div>
                          </div>
                          <dl className="mt-3 space-y-2 text-11">
                            <div>
                              <dt className="text-tertiary">Nhân viên báo cáo</dt>
                              <dd className="mt-0.5 font-medium text-primary">
                                {report.reporterName ||
                                  (report.reporterWallet ? formatShortWallet(report.reporterWallet) : "Chưa xác định")}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-tertiary">Hôm nay làm gì?</dt>
                              <dd className="mt-0.5 whitespace-pre-wrap text-primary">
                                {report.work ||
                                  (report.isOnChainConfirmed
                                    ? "Chỉ có mã kiểm chứng; chưa tải được nội dung gốc."
                                    : "Không có nội dung")}
                              </dd>
                            </div>
                            {report.difficulty && report.difficulty !== "Không có" && (
                              <div>
                                <dt className="text-tertiary">Khó khăn</dt>
                                <dd className="mt-0.5 whitespace-pre-wrap text-primary">{report.difficulty}</dd>
                              </div>
                            )}
                            {report.evidence && report.evidence !== "Không có" && (
                              <div>
                                <dt className="text-tertiary">Evidence</dt>
                                <dd className="mt-0.5 break-all text-primary">{report.evidence}</dd>
                              </div>
                            )}
                            {report.transactionHash && (
                              <div className="flex items-center gap-2 pt-1">
                                <dt className="shrink-0 text-tertiary">Transaction hash:</dt>
                                <dd className="font-mono text-primary" title={report.transactionHash}>
                                  {shortHash(report.transactionHash)}
                                </dd>
                                <button
                                  type="button"
                                  onClick={() => handleCopy(report.transactionHash!, `rep-${report.id}`)}
                                  className="p-1 text-tertiary transition-colors hover:text-primary"
                                  title="Sao chép transaction hash"
                                >
                                  {copiedKey === `rep-${report.id}` ? (
                                    <Check className="h-3 w-3 text-success-primary" />
                                  ) : (
                                    <Copy className="h-3 w-3" />
                                  )}
                                </button>
                              </div>
                            )}
                          </dl>
                        </article>
                      ))}
                    </div>
                  )}
                  {reportsSummary.unreconciledReports.length > 0 && (
                    <details className="mt-3 rounded-lg border border-subtle p-3 text-11">
                      <summary className="cursor-pointer text-secondary">
                        {reportsSummary.unreconciledReports.length} bản local chưa đối chiếu định danh (không cộng vào
                        tổng)
                      </summary>
                      {reportsSummary.unreconciledReports.map((report) => (
                        <article key={report.id} className="mt-3 border-t border-subtle pt-2">
                          <p>
                            {formatVietnamDateTime(report.recordedAt)} · {report.progress}% ·{" "}
                            {report.reporterName || report.reporterWallet || "Chưa xác định người gửi"}
                          </p>
                          <p className="whitespace-pre-wrap">{report.work}</p>
                          {report.difficulty && <p className="whitespace-pre-wrap">Khó khăn: {report.difficulty}</p>}
                          {report.evidence && <p className="break-all">Bằng chứng: {report.evidence}</p>}
                        </article>
                      ))}
                    </details>
                  )}
                </div>
              )}

              {/* Khối Lịch sử hoạt động */}
              <div>
                <h4 className="text-12 font-semibold text-primary">Lịch sử hoạt động ({activityItems.length})</h4>
                {activityItems.length === 0 ? (
                  <p className="mt-3 rounded-lg border border-dashed border-subtle px-3 py-4 text-11 text-tertiary">
                    Chưa có hoạt động bình luận hoặc bằng chứng được ghi nhận cho task này.
                  </p>
                ) : (
                  <div className="mt-3 space-y-2">
                    {activityItems.map((item) => (
                      <div
                        key={item.id}
                        className="rounded-lg border border-subtle bg-surface-1/60 p-3 text-11 backdrop-blur-md"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-1.5 font-medium text-primary">
                            {item.kind === "comment" ? (
                              <MessageSquare className="h-3.5 w-3.5 text-accent-primary" />
                            ) : (
                              <Paperclip className="h-3.5 w-3.5 text-success-primary" />
                            )}
                            {item.kindLabel}
                          </span>
                          <time className="text-10 text-tertiary">{item.formattedTime}</time>
                        </div>

                        <p className="mt-1.5 font-medium text-primary">{item.contentTitle}</p>
                        {item.contentBody && (
                          <p className="mt-1 whitespace-pre-wrap text-secondary">{item.contentBody}</p>
                        )}

                        {item.metadata?.assetSource && (
                          <ActivityAttachment
                            key={item.id + item.metadata.assetSource}
                            source={item.metadata.assetSource}
                            name={item.metadata.fileName}
                            fileType={item.metadata.fileType}
                          />
                        )}
                        {item.kind !== "comment" && !item.metadata?.assetSource && (
                          <p className="mt-2 text-tertiary">Chưa tải được thông tin tệp gốc. Hãy thử làm mới.</p>
                        )}

                        {/* Chi tiết kỹ thuật Accordion */}
                        <div className="mt-2 border-t border-subtle/50 pt-2">
                          <button
                            type="button"
                            onClick={() => toggleTechDetails(item.id)}
                            className="flex items-center gap-1 text-10 text-tertiary transition-colors hover:text-primary"
                          >
                            {openTechDetails[item.id] ? (
                              <ChevronDown className="h-3 w-3" />
                            ) : (
                              <ChevronRight className="h-3 w-3" />
                            )}
                            <span>Chi tiết kỹ thuật on-chain</span>
                          </button>

                          {openTechDetails[item.id] && (
                            <div className="font-mono mt-2 space-y-1 rounded bg-surface-2/40 p-2 text-10 text-tertiary">
                              {item.referenceId && (
                                <p>
                                  Tham chiếu: <span className="break-all text-primary">{item.referenceId}</span>
                                </p>
                              )}
                              {item.transactionHash ? (
                                <div className="flex items-center gap-2">
                                  <span>Giao dịch:</span>
                                  <span className="break-all text-primary">{item.transactionHash}</span>
                                  <button
                                    type="button"
                                    onClick={() => handleCopy(item.transactionHash!, `act-${item.id}`)}
                                    className="p-0.5 text-tertiary hover:text-primary"
                                    title="Sao chép"
                                  >
                                    {copiedKey === `act-${item.id}` ? (
                                      <Check className="h-3 w-3 text-success-primary" />
                                    ) : (
                                      <Copy className="h-3 w-3" />
                                    )}
                                  </button>
                                </div>
                              ) : (
                                <p className="italic">Chưa có transaction hash trên chain</p>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {error && (
            <div className="mt-4 flex items-center gap-2 rounded-lg bg-danger-subtle px-3 py-2 text-11 text-danger-primary">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
