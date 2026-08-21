import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, ClipboardList, FileText, FolderKanban, UserRound } from "lucide-react";
import {
  blockchainTrackingService,
  type TBlockchainTrackingRecord,
} from "@/services/blockchain/blockchain-tracking.service";
import { getIssueOnChainProgress, getWalletKPI, type OnChainKPI } from "@/services/blockchain/plane-task-chain.service";
import { ProjectService } from "@/services/project";
import { IssueService } from "@/services/issue";
import type { TIssue } from "@plane/types";
import { useUser } from "@/hooks/store/user";

type Props = { workspaceSlug: string };
type ProjectOption = { id: string; name: string; identifier?: string };
type TaskOption = { id: string; name: string; parentId?: string; records: TBlockchainTrackingRecord[] };
type AggregateKpi = {
  total: number;
  todo: number;
  inProgress: number;
  completed: number;
  onSchedule: number;
  delayed: number;
  overdue: number;
  averageProgress: number;
  reports: number;
};

const projectService = new ProjectService();
const issueService = new IssueService();

function formatDateTime(value?: string, fallbackValue?: string): string {
  const time = value || fallbackValue;
  if (!time) return "Chưa có thời gian";
  const date = new Date(time);
  if (Number.isNaN(date.getTime())) return time;
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(date);
}

function shortHash(value?: string): string {
  if (!value) return "Chưa có";
  return value.length > 22 ? `${value.slice(0, 12)}...${value.slice(-8)}` : value;
}

function taskProgress(task?: TaskOption, onChainProgress?: Readonly<Record<string, number>>): number {
  const contractProgress = task && typeof onChainProgress?.[task.id] === "number" ? onChainProgress[task.id] : 0;
  const reports = task?.records.filter((record) => record.event_type === "daily_report") ?? [];
  const latestReport = reports[reports.length - 1];
  const localProgress = typeof latestReport?.progress === "number" ? latestReport.progress : 0;
  return Math.max(contractProgress, localProgress);
}

function aggregateKpi(tasks: TaskOption[], onChainProgress?: Readonly<Record<string, number>>): AggregateKpi {
  const result: AggregateKpi = {
    total: tasks.length,
    todo: 0,
    inProgress: 0,
    completed: 0,
    onSchedule: 0,
    delayed: 0,
    overdue: 0,
    averageProgress: 0,
    reports: 0,
  };
  let progressSum = 0;
  const now = Date.now();
  tasks.forEach((task) => {
    const progress = taskProgress(task, onChainProgress);
    progressSum += progress;
    result.reports += task.records.filter((record) => record.event_type === "daily_report").length;
    if (progress === 100) result.completed += 1;
    else if (progress > 0) result.inProgress += 1;
    else result.todo += 1;

    const creation = task.records.find((record) => record.event_type === "create_task");
    const dueAt = creation?.target_date ? Date.parse(`${creation.target_date}T23:59:59`) : Number.NaN;
    const createdAt = creation?.recorded_at ? Date.parse(creation.recorded_at) : Number.NaN;
    if (progress < 100 && Number.isFinite(dueAt) && now > dueAt) result.overdue += 1;
    else if (progress < 100 && Number.isFinite(dueAt) && Number.isFinite(createdAt) && dueAt > createdAt) {
      const expected = Math.min(100, Math.max(0, ((now - createdAt) * 100) / (dueAt - createdAt)));
      if (progress < expected) result.delayed += 1;
      else result.onSchedule += 1;
    } else if (progress < 100) result.onSchedule += 1;
  });
  result.averageProgress = result.total ? Math.round(progressSum / result.total) : 0;
  return result;
}

function KpiGrid({ value }: { value: AggregateKpi }) {
  const items: Array<[string, number | string]> = [
    ["Tổng task", value.total],
    ["Chưa làm", value.todo],
    ["Đang làm", value.inProgress],
    ["Hoàn thành", value.completed],
    ["Đúng tiến độ", value.onSchedule],
    ["Chậm", value.delayed],
    ["Quá hạn", value.overdue],
    ["Tiến độ TB", `${value.averageProgress}%`],
    ["Báo cáo", value.reports],
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
      {items.map(([label, metric]) => (
        <div key={label} className="rounded-lg border border-subtle bg-surface-1/65 p-3 backdrop-blur-md">
          <p className="text-10 text-tertiary">{label}</p>
          <p className="mt-1 text-16 font-semibold text-primary">{metric}</p>
        </div>
      ))}
    </div>
  );
}

export function OnChainKpiWidget({ workspaceSlug }: Props) {
  const { data: currentUser } = useUser();
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [records, setRecords] = useState<TBlockchainTrackingRecord[]>([]);
  const [planeTasks, setPlaneTasks] = useState<TIssue[]>([]);
  const [kpi, setKpi] = useState<OnChainKPI | undefined>();
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [expandedTaskIds, setExpandedTaskIds] = useState<Set<string>>(new Set());
  const [onChainProgress, setOnChainProgress] = useState<Record<string, number>>({});
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [loadingKpi, setLoadingKpi] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const loadProjects = async () => {
      setLoadingProjects(true);
      try {
        const items = await projectService.getProjectsLite(workspaceSlug);
        if (active) {
          setProjects(items.map((project) => ({ id: project.id, name: project.name, identifier: project.identifier })));
        }
      } catch {
        if (active) setError("Không tải được danh sách dự án.");
      } finally {
        if (active) setLoadingProjects(false);
      }
    };
    void loadProjects();
    return () => {
      active = false;
    };
  }, [workspaceSlug]);

  const tasks = useMemo<TaskOption[]>(() => {
    const grouped = new Map<string, TBlockchainTrackingRecord[]>();
    records.forEach((record) => {
      if (!record.issue_id) return;
      grouped.set(record.issue_id, [...(grouped.get(record.issue_id) ?? []), record]);
    });

    const taskOptions: TaskOption[] = [];
    const processedIds = new Set<string>();

    planeTasks.forEach((issue) => {
      processedIds.add(issue.id);
      const taskRecords = grouped.get(issue.id) ?? [];
      taskOptions.push({
        id: issue.id,
        name: issue.name,
        parentId: issue.parent_id || undefined,
        records: taskRecords,
      });
    });

    Array.from(grouped).forEach(([id, taskRecords]) => {
      if (processedIds.has(id)) return;
      const creation = taskRecords.find((record) => record.event_type === "create_task");
      taskOptions.push({
        id,
        name: taskRecords.find((record) => record.issue_name)?.issue_name || id,
        parentId: creation?.parent_issue_id,
        records: taskRecords,
      });
    });

    return taskOptions.filter((task) => !task.records.some((record) => record.event_type === "delete_task"));
  }, [records, planeTasks]);

  useEffect(() => {
    let active = true;
    if (!tasks.length) {
      setOnChainProgress({});
      return () => {
        active = false;
      };
    }
    const loadOnChainProgress = async () => {
      const entries = await Promise.all(
        tasks.map(async (task): Promise<readonly [string, number] | null> => {
          try {
            return [task.id, await getIssueOnChainProgress(task.id)] as const;
          } catch {
            return null;
          }
        })
      );
      if (active) setOnChainProgress(Object.fromEntries(entries.filter((entry) => entry !== null)));
    };
    void loadOnChainProgress();
    return () => {
      active = false;
    };
  }, [tasks]);

  const selectedProject = projects.find((project) => project.id === selectedProjectId);
  const selectedTask = tasks.find((task) => task.id === selectedTaskId);
  const childrenByParent = useMemo(() => {
    const grouped = new Map<string, TaskOption[]>();
    tasks.forEach((task) => {
      if (!task.parentId) return;
      grouped.set(task.parentId, [...(grouped.get(task.parentId) ?? []), task]);
    });
    return grouped;
  }, [tasks]);
  const rootTasks = tasks.filter(
    (task) => !task.parentId || !tasks.some((candidate) => candidate.id === task.parentId)
  );
  const selectedTaskChildren = selectedTask ? (childrenByParent.get(selectedTask.id) ?? []) : [];
  const collectLeafTasks = (task: TaskOption, visited = new Set<string>()): TaskOption[] => {
    if (visited.has(task.id)) return [];
    const nextVisited = new Set(visited).add(task.id);
    const children = childrenByParent.get(task.id) ?? [];
    return children.length ? children.flatMap((child) => collectLeafTasks(child, nextVisited)) : [task];
  };
  const displayTaskProgress = (task: TaskOption): number => {
    const contractProgress = onChainProgress[task.id] ?? 0;
    const leaves = collectLeafTasks(task);
    if (leaves.length) {
      return Math.max(contractProgress, aggregateKpi(leaves, onChainProgress).averageProgress);
    }
    return taskProgress(task, onChainProgress);
  };
  const projectLeafTasks = rootTasks.flatMap((task) => collectLeafTasks(task));
  const selectedTaskLeafTasks = selectedTask ? collectLeafTasks(selectedTask) : [];
  const projectKpi = aggregateKpi(projectLeafTasks, onChainProgress);
  const selectedTaskKpi = aggregateKpi(selectedTaskLeafTasks, onChainProgress);
  const creation = selectedTask?.records.find((record) => record.event_type === "create_task");
  const assignment =
    selectedTask?.records.find((record) => record.event_type === "assign_task") ??
    (creation?.assignee_wallet ? creation : undefined);
  const reports = selectedTask?.records.filter((record) => record.event_type === "daily_report") ?? [];
  const contentRecords = selectedTask?.records.filter((record) => record.event_type === "task_content") ?? [];
  const progress = selectedTask ? displayTaskProgress(selectedTask) : 0;

  const selectProject = async (projectId: string) => {
    setSelectedProjectId(projectId);
    setSelectedTaskId("");
    setRecords([]);
    setPlaneTasks([]);
    setKpi(undefined);
    setError("");
    setLoadingTasks(true);
    try {
      const [txRecords, planeIssuesRes] = await Promise.all([
        blockchainTrackingService
          .getTransactions(workspaceSlug, projectId)
          .catch(() => [] as TBlockchainTrackingRecord[]),
        issueService.getIssuesFromServer(workspaceSlug, projectId, {}).catch(() => ({ results: [] as TIssue[] })),
      ]);
      setRecords(txRecords);
      setPlaneTasks(Array.isArray(planeIssuesRes?.results) ? planeIssuesRes.results : []);
    } catch {
      setError("Không tải được task và dữ liệu on-chain của dự án.");
    } finally {
      setLoadingTasks(false);
    }
  };

  const selectTask = async (task: TaskOption) => {
    setSelectedTaskId(task.id);
    setKpi(undefined);
    setError("");
    const latestAssignment =
      task.records.find((record) => record.event_type === "assign_task") ??
      task.records.find((record) => record.event_type === "create_task" && record.assignee_wallet);
    if (!latestAssignment?.assignee_wallet) return;
    setLoadingKpi(true);
    try {
      const result = await getWalletKPI(latestAssignment.assignee_wallet);
      setKpi(result.kpi);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không đọc được KPI nhân viên từ contract.");
    } finally {
      setLoadingKpi(false);
    }
  };

  const kpiItems = kpi
    ? [
      ["Tổng task", kpi.total],
      ["Đang làm", kpi.inProgress],
      ["Hoàn thành", kpi.completed],
      ["Đúng tiến độ", kpi.onSchedule],
      ["Chậm", kpi.delayed],
      ["Quá hạn", kpi.overdue],
      ["Tiến độ TB", `${kpi.averageProgress}%`],
    ]
    : [];

  const toggleTask = (taskId: string) => {
    setExpandedTaskIds((current) => {
      const next = new Set(current);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const renderTaskRow = (task: TaskOption, depth = 0) => {
    const children = childrenByParent.get(task.id) ?? [];
    const expanded = expandedTaskIds.has(task.id);
    const taskValue = displayTaskProgress(task);
    return (
      <div key={task.id}>
        <div
          className={`flex rounded-lg transition-colors ${selectedTaskId === task.id ? "bg-accent-primary/10" : "hover:bg-surface-2"
            }`}
          style={{ marginLeft: `${depth * 14}px` }}
        >
          {children.length ? (
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
            onClick={() => void selectTask(task)}
            className="min-w-0 flex-1 px-1 py-2.5 pr-3 text-left active:scale-[0.99]"
          >
            <span className="flex items-center gap-2">
              <span className="truncate text-12 font-medium text-primary">{task.name}</span>
              {children.length > 0 && <span className="text-10 text-tertiary">{children.length} task con</span>}
            </span>
            <span className="mt-1 flex items-center justify-between text-10 text-tertiary">
              <span>{task.records.filter((record) => record.event_type === "daily_report").length} báo cáo</span>
              <span>{taskValue}%</span>
            </span>
            <span className="bg-surface-3 mt-2 block h-1 overflow-hidden rounded-full" aria-hidden="true">
              <span className="block h-full rounded-full bg-accent-primary" style={{ width: `${taskValue}%` }} />
            </span>
          </button>
        </div>
        {expanded && children.map((child) => renderTaskRow(child, depth + 1))}
      </div>
    );
  };
  return (
    <section className="shadow-sm overflow-hidden rounded-2xl border border-subtle bg-layer-1/75 backdrop-blur-xl">
      <header className="border-b border-subtle px-5 py-4">
        <h2 className="text-14 font-semibold text-primary">Dashboard KPI on-chain</h2>
        <p className="mt-1 text-11 text-tertiary">Chọn dự án, chọn task để xem báo cáo và KPI của nhân viên.</p>
      </header>

      <div className="grid min-h-[520px] grid-cols-1 divide-y divide-subtle lg:grid-cols-[220px_300px_minmax(0,1fr)] lg:divide-x lg:divide-y-0 xl:grid-cols-[260px_360px_minmax(560px,1fr)]">
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
          ) : projects.length === 0 ? (
            <p className="px-2 py-4 text-11 text-tertiary">Chưa có dự án nào.</p>
          ) : (
            <div className="space-y-1">
              {projects.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => void selectProject(project.id)}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left transition-colors active:scale-[0.99] ${selectedProjectId === project.id
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

        <div className="p-3">
          <div className="flex items-center gap-2 px-2 py-2 text-11 font-medium text-secondary">
            <ClipboardList className="h-4 w-4" aria-hidden="true" />
            Task {selectedProject ? `trong ${selectedProject.name}` : ""}
          </div>
          {!selectedProjectId ? (
            <p className="px-2 py-4 text-11 text-tertiary">Chọn một dự án để xem task.</p>
          ) : loadingTasks ? (
            <div className="space-y-2 px-2 py-3" aria-label="Đang tải task">
              {[0, 1, 2].map((item) => (
                <div key={item} className="h-12 animate-pulse rounded-lg bg-surface-2/70" />
              ))}
            </div>
          ) : tasks.length === 0 ? (
            <p className="px-2 py-4 text-11 text-tertiary">Dự án chưa có task on-chain.</p>
          ) : (
            <div className="space-y-1">{rootTasks.map((task) => renderTaskRow(task))}</div>
          )}
        </div>

        <div className="min-w-0 p-5">
          {!selectedTask ? (
            selectedProject ? (
              <div className="space-y-5">
                <div>
                  <p className="text-10 text-tertiary">{selectedProject.identifier || "PROJECT"}</p>
                  <h3 className="mt-1 text-16 font-semibold text-primary">Tổng quan {selectedProject.name}</h3>
                  <p className="mt-1 text-11 text-tertiary">
                    KPI tổng hợp từ toàn bộ task cha, task con và báo cáo cuối ngày trong dự án.
                  </p>
                </div>
                <KpiGrid value={projectKpi} />
                <div>
                  <h4 className="text-12 font-semibold text-primary">Tiến độ task trong dự án</h4>
                  <div className="mt-3 space-y-2">
                    {rootTasks.map((task) => {
                      const children = childrenByParent.get(task.id) ?? [];
                      const summary = aggregateKpi(collectLeafTasks(task), onChainProgress);
                      return (
                        <button
                          key={task.id}
                          type="button"
                          onClick={() => void selectTask(task)}
                          className="w-full rounded-lg border border-subtle bg-surface-1/60 p-3 text-left hover:bg-surface-2"
                        >
                          <span className="flex items-center justify-between gap-3">
                            <span className="truncate text-11 font-medium text-primary">{task.name}</span>
                            <span className="text-10 text-tertiary">{summary.averageProgress}%</span>
                          </span>
                          <span className="bg-surface-3 mt-2 block h-1.5 overflow-hidden rounded-full">
                            <span
                              className="block h-full rounded-full bg-accent-primary"
                              style={{ width: `${summary.averageProgress}%` }}
                            />
                          </span>
                          <span className="mt-2 block text-10 text-tertiary">
                            {children.length ? `${children.length} task con · ` : ""}
                            {summary.completed}/{summary.total} hoàn thành · {summary.reports} báo cáo
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
                <p className="mt-3 text-12 font-medium text-secondary">Chọn một dự án để xem KPI tổng hợp</p>
              </div>
            )
          ) : (
            <div className="space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-10 text-tertiary">{selectedProject?.identifier || "TASK"}</p>
                  <h3 className="mt-1 truncate text-16 font-semibold text-primary">{selectedTask.name}</h3>
                  <p className="mt-1 text-11 text-tertiary">Tạo on-chain: {formatDateTime(creation?.recorded_at)}</p>
                </div>
                <div className="rounded-lg border border-subtle bg-surface-1/70 px-3 py-2 text-right backdrop-blur-md">
                  <p className="text-10 text-tertiary">Tiến độ mới nhất</p>
                  <p className="text-18 font-semibold text-primary">{progress}%</p>
                  <div
                    className="bg-surface-3 mt-2 h-1.5 w-28 overflow-hidden rounded-full"
                    role="progressbar"
                    aria-label="Tiến độ task"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={progress}
                  >
                    <div
                      className="h-full rounded-full bg-accent-primary transition-[width]"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              </div>

              <div>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h4 className="text-12 font-semibold text-primary">
                    {selectedTaskChildren.length ? "KPI tổng hợp task cha" : "KPI của task"}
                  </h4>
                  {selectedTaskChildren.length > 0 && (
                    <span className="text-10 text-tertiary">Tổng hợp từ {selectedTaskChildren.length} task con</span>
                  )}
                </div>
                <KpiGrid value={selectedTaskKpi} />
              </div>

              {selectedTaskChildren.length > 0 && (
                <div>
                  <h4 className="text-12 font-semibold text-primary">Task con</h4>
                  <div className="mt-3 space-y-2">
                    {selectedTaskChildren.map((child) => (
                      <button
                        key={child.id}
                        type="button"
                        onClick={() => void selectTask(child)}
                        className="flex w-full items-center justify-between rounded-lg border border-subtle bg-surface-1/60 px-3 py-2.5 text-left hover:bg-surface-2"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-11 font-medium text-primary">{child.name}</span>
                          <span className="mt-0.5 block text-10 text-tertiary">
                            {child.records.filter((record) => record.event_type === "daily_report").length} báo cáo
                          </span>
                        </span>
                        <span className="ml-3 text-11 font-medium text-primary">
                          {taskProgress(child, onChainProgress)}%
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="rounded-xl border border-subtle bg-surface-1/60 p-4 backdrop-blur-md">
                <div className="flex items-center gap-2 text-11 font-medium text-secondary">
                  <UserRound className="h-4 w-4" aria-hidden="true" />
                  Nhân viên được giao
                </div>
                {assignment ? (
                  <div className="mt-3 grid gap-2 text-11 sm:grid-cols-2">
                    <div>
                      <span className="text-tertiary">Tên:</span>{" "}
                      <span className="text-primary">
                        {assignment.assignee_name ||
                          (assignment.assignee_id?.startsWith("user-")
                            ? currentUser?.display_name || currentUser?.first_name || "Bạn (You)"
                            : assignment.assignee_id)}
                      </span>
                    </div>
                    <div>
                      <span className="text-tertiary">Thời gian giao:</span>{" "}
                      <span className="text-primary">
                        {formatDateTime(assignment.recorded_at, (assignment as any).created_at)}
                      </span>
                    </div>
                    <div className="sm:col-span-2">
                      <span className="text-tertiary">Ví:</span>{" "}
                      <span className="font-mono break-all text-primary">{assignment.assignee_wallet}</span>
                    </div>
                    <div className="sm:col-span-2">
                      <span className="text-tertiary">Hash giao task:</span>{" "}
                      <span className="font-mono text-primary" title={assignment.transaction_hash}>
                        {shortHash(assignment.transaction_hash)}
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className="mt-3 text-11 text-tertiary">Task chưa có bản ghi giao nhân viên on-chain.</p>
                )}
              </div>

              <div>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h4 className="text-12 font-semibold text-primary">KPI nhân viên</h4>
                  {loadingKpi && <span className="text-10 text-tertiary">Đang đọc contract...</span>}
                </div>
                {kpi ? (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {kpiItems.map(([label, value]) => (
                      <div key={label} className="rounded-lg border border-subtle bg-surface-1/65 p-3 backdrop-blur-md">
                        <p className="text-10 text-tertiary">{label}</p>
                        <p className="mt-1 text-16 font-semibold text-primary">{value}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  !loadingKpi && (
                    <p className="rounded-lg border border-dashed border-subtle px-3 py-4 text-11 text-tertiary">
                      {assignment?.assignee_wallet
                        ? "Chưa đọc được KPI từ contract."
                        : "Cần giao task on-chain để tự động tra KPI."}
                    </p>
                  )
                )}
              </div>

              <div>
                <h4 className="text-12 font-semibold text-primary">Báo cáo cuối ngày ({reports.length})</h4>
                {reports.length === 0 ? (
                  <p className="mt-3 rounded-lg border border-dashed border-subtle px-3 py-4 text-11 text-tertiary">
                    Nhân viên chưa gửi báo cáo cho task này.
                  </p>
                ) : (
                  <div className="mt-3 space-y-3">
                    {reports.map((report) => (
                      <article
                        key={
                          report.report_id ||
                          report.transaction_hash ||
                          `${report.issue_id}-${report.recorded_at}-${report.progress}`
                        }
                        className="rounded-xl border border-subtle bg-surface-1/60 p-4 backdrop-blur-md"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <time className="text-11 font-medium text-secondary">
                            {formatDateTime(report.recorded_at, (report as any).created_at)}
                          </time>
                          <span className="rounded-md bg-accent-primary/10 px-2 py-1 text-10 font-medium text-accent-primary">
                            Tiến độ {report.progress ?? 0}%
                          </span>
                          {report.on_chain === false && (
                            <span className="rounded-md bg-layer-2 px-2 py-1 text-10 font-medium text-secondary">
                              Lưu nội bộ
                            </span>
                          )}
                        </div>
                        <dl className="mt-3 space-y-2 text-11">
                          <div>
                            <dt className="text-tertiary">Nhân viên báo cáo</dt>
                            <dd className="mt-0.5 text-primary">
                              {report.reporter_name ||
                                (report.reporter_id?.startsWith("user-")
                                  ? currentUser?.display_name || currentUser?.first_name || "Bạn (You)"
                                  : report.reporter_id) ||
                                assignment?.assignee_name ||
                                assignment?.assignee_id ||
                                "Chưa xác định"}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-tertiary">Hôm nay làm gì?</dt>
                            <dd className="mt-0.5 whitespace-pre-wrap text-primary">
                              {report.work || "Không có nội dung"}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-tertiary">Khó khăn</dt>
                            <dd className="mt-0.5 whitespace-pre-wrap text-primary">
                              {report.difficulty || "Không có"}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-tertiary">Evidence</dt>
                            <dd className="mt-0.5 break-all text-primary">{report.evidence || "Không có"}</dd>
                          </div>
                          {report.transaction_hash && (
                            <div>
                              <dt className="text-tertiary">Transaction hash</dt>
                              <dd className="font-mono mt-0.5 text-primary" title={report.transaction_hash}>
                                {shortHash(report.transaction_hash)}
                              </dd>
                            </div>
                          )}
                        </dl>
                      </article>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h4 className="text-12 font-semibold text-primary">
                  Nội dung xác thực({contentRecords.length})
                </h4>
                {contentRecords.length === 0 ? (
                  <p className="mt-3 rounded-lg border border-dashed border-subtle px-3 py-4 text-11 text-tertiary">
                    Chưa có comment hoặc evidence được xác thực.
                  </p>
                ) : (
                  <div className="mt-3 space-y-2">
                    {contentRecords.map((record) => (
                      <div
                        key={
                          record.transaction_hash ||
                          `${record.issue_id}-${record.recorded_at}-${record.content_kind}-${record.content_reference}`
                        }
                        className="rounded-lg border border-subtle bg-surface-1/60 p-3 text-11 backdrop-blur-md"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-primary">
                            {record.content_kind === "comment" ? "Bình luận" : "Evidence"}
                          </span>
                          <time className="text-tertiary">
                            {formatDateTime(record.recorded_at, (record as any).created_at)}
                          </time>
                        </div>
                        <p className="mt-2 text-tertiary">
                          Tham chiếu:{" "}
                          <span className="break-all text-primary">{record.content_reference || "Không có"}</span>
                        </p>
                        <p className="mt-1 text-tertiary">
                          Transaction:{" "}
                          <span className="font-mono text-primary" title={record.transaction_hash}>
                            {shortHash(record.transaction_hash)}
                          </span>
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
          {error && (
            <div className="mt-4 rounded-lg bg-danger-subtle px-3 py-2 text-11 text-danger-primary">{error}</div>
          )}
        </div>
      </div>
    </section>
  );
}
