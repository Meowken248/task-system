/* oxlint-disable unicorn/no-array-sort -- ES2022 target; all sorts below operate on new arrays owned by this read model. */
import type { TBlockchainTrackingRecord } from "@/services/blockchain/blockchain-tracking.service";
import type { OnChainDailyReport } from "@/services/blockchain/plane-task-chain.service";
import type { TIssue } from "@plane/types";
import type {
  AggregateBranchKpi,
  HierarchyCount,
  NormalizedProgress,
  StandardReport,
  TaskNode,
  TaskReportsSummary,
} from "./types";

export function getCleanParentId(val: unknown): string | undefined {
  if (!val) return undefined;
  if (typeof val === "string") {
    const trimmed = val.trim();
    return trimmed && trimmed !== "null" && trimmed !== "undefined" ? trimmed : undefined;
  }
  if (typeof val === "object" && val !== null) {
    const id = (val as any).id;
    if (typeof id === "string") {
      const trimmed = id.trim();
      return trimmed && trimmed !== "null" && trimmed !== "undefined" ? trimmed : undefined;
    }
  }
  return undefined;
}

export function buildTaskHierarchy(
  records: TBlockchainTrackingRecord[],
  planeTasks: TIssue[],
  selectedProject?: { id: string; identifier?: string }
): { roots: TaskNode[]; tasksById: Map<string, TaskNode>; allTasks: TaskNode[] } {
  const groupedRecords = new Map<string, TBlockchainTrackingRecord[]>();
  records.forEach((record) => {
    if (!record.issue_id) return;
    const existing = groupedRecords.get(record.issue_id) ?? [];
    existing.push(record);
    groupedRecords.set(record.issue_id, existing);
  });

  const taskNodes: TaskNode[] = [];
  const processedIds = new Set<string>();

  // 1. Khởi tạo từ planeTasks
  planeTasks.forEach((issue) => {
    processedIds.add(issue.id);
    const taskRecords = groupedRecords.get(issue.id) ?? [];
    const creation = taskRecords.find((record) => record.event_type === "create_task");
    const rawParentId =
      getCleanParentId(issue.parent_id) ||
      getCleanParentId((issue as any).parent) ||
      getCleanParentId((issue as any).parent_detail) ||
      getCleanParentId(creation?.parent_issue_id);

    const seqId = typeof issue.sequence_id === "number" ? issue.sequence_id : undefined;
    const projIdent = (issue as any).project_detail?.identifier || selectedProject?.identifier || "";
    const issueIdent = projIdent && seqId ? `${projIdent}-${seqId}` : undefined;

    const stateGroup = ((issue as any).state_detail?.group || (issue as any).state_group) as TaskNode["stateGroup"];

    taskNodes.push({
      id: issue.id,
      name: issue.name,
      sequence_id: seqId,
      identifier: issueIdent,
      parentId: rawParentId && rawParentId !== issue.id && rawParentId !== issueIdent ? rawParentId : undefined,
      statusId: issue.state_id || (issue as any).state,
      stateGroup,
      records: taskRecords,
      issueDetail: issue,
      directChildren: [],
      allDescendants: [],
      leafTasks: [],
    });
  });

  // 2. Khởi tạo từ các bản ghi tracking chưa có trong planeTasks
  Array.from(groupedRecords.entries()).forEach(([id, taskRecords]) => {
    if (processedIds.has(id)) return;
    const creation = taskRecords.find((record) => record.event_type === "create_task");
    const rawParentId = getCleanParentId(creation?.parent_issue_id);
    taskNodes.push({
      id,
      name: taskRecords.find((record) => record.issue_name)?.issue_name || id,
      parentId: rawParentId && rawParentId !== id ? rawParentId : undefined,
      records: taskRecords,
      directChildren: [],
      allDescendants: [],
      leafTasks: [],
    });
  });

  // 3. Lọc bỏ các task đã bị xóa
  const activeTasks = taskNodes.filter((task) => {
    const hasDeleteEvent = task.records.some((record) => record.event_type === "delete_task");
    const isArchived = Boolean(task.issueDetail?.archived_at);
    return !hasDeleteEvent && !isArchived;
  });

  // 4. Chuẩn hóa parentId sang canonical task.id (hỗ trợ UUID, identifier 'AA-1', sequence_id '1')
  activeTasks.forEach((task) => {
    if (!task.parentId) return;
    const target = task.parentId.trim().toLowerCase();
    const matchedParent = activeTasks.find(
      (p) =>
        p.id !== task.id &&
        (p.id.toLowerCase() === target ||
          (p.identifier && p.identifier.toLowerCase() === target) ||
          (p.sequence_id !== undefined && String(p.sequence_id) === target))
    );
    if (matchedParent) {
      task.parentId = matchedParent.id;
    } else {
      task.parentId = undefined;
    }
  });

  // 5. Phá bỏ các vòng lặp tham chiếu cha-con (circular references)
  activeTasks.forEach((task) => {
    if (!task.parentId) return;
    const visited = new Set<string>([task.id]);
    let curr = activeTasks.find((p) => p.id === task.parentId);
    while (curr && curr.parentId) {
      if (visited.has(curr.parentId)) {
        curr.parentId = undefined;
        break;
      }
      visited.add(curr.id);
      curr = activeTasks.find((p) => p.id === curr!.parentId);
    }
  });

  // 6. Xây dựng cấu trúc cây
  const tasksById = new Map<string, TaskNode>();
  activeTasks.forEach((task) => tasksById.set(task.id, task));

  activeTasks.forEach((task) => {
    if (task.parentId) {
      const parent = tasksById.get(task.parentId);
      if (parent && parent.id !== task.id) {
        parent.directChildren.push(task);
      } else {
        task.parentId = undefined;
      }
    }
  });

  // 7. Thu thập đệ quy allDescendants và leafTasks cho từng node
  const collectDescendantsAndLeaves = (
    node: TaskNode,
    visited = new Set<string>()
  ): { descendants: TaskNode[]; leaves: TaskNode[] } => {
    if (visited.has(node.id)) return { descendants: [], leaves: [] };
    const nextVisited = new Set(visited).add(node.id);

    if (node.directChildren.length === 0) {
      node.allDescendants = [];
      node.leafTasks = [node];
      return { descendants: [], leaves: [node] };
    }

    const descendants: TaskNode[] = [];
    const leaves: TaskNode[] = [];

    node.directChildren.forEach((child) => {
      descendants.push(child);
      const childSub = collectDescendantsAndLeaves(child, nextVisited);
      descendants.push(...childSub.descendants);
      leaves.push(...childSub.leaves);
    });

    const descMap = new Map<string, TaskNode>();
    descendants.forEach((d) => descMap.set(d.id, d));
    node.allDescendants = Array.from(descMap.values());

    const leafMap = new Map<string, TaskNode>();
    leaves.forEach((l) => leafMap.set(l.id, l));
    node.leafTasks = Array.from(leafMap.values());

    return { descendants: node.allDescendants, leaves: node.leafTasks };
  };

  const roots = activeTasks.filter((task) => !task.parentId);
  roots.forEach((root) => collectDescendantsAndLeaves(root));

  return { roots, tasksById, allTasks: activeTasks };
}

export function getHierarchyCount(task: TaskNode): HierarchyCount {
  return {
    directCount: task.directChildren.length,
    descendantCount: task.allDescendants.length,
    leafCount: task.leafTasks.length,
  };
}

export function calculateTaskProgress(
  task: TaskNode,
  onChainProgressMap: Readonly<Record<string, number | null | undefined>>,
  visited = new Set<string>()
): NormalizedProgress {
  if (visited.has(task.id)) {
    return {
      value: null,
      formatted: "Lỗi vòng lặp",
      source: "unknown",
      confidence: "missing",
    };
  }

  // 1. Ưu tiên số liệu on-chain đã được xác nhận (0% là giá trị hợp lệ!)
  const latestLocal = task.records
    .filter((r) => r.event_type === "daily_report")
    .sort((a, b) => timestamp(b.recorded_at) - timestamp(a.recorded_at))[0];
  const localProgress =
    latestLocal?.on_chain === false &&
    typeof latestLocal.progress === "number" &&
    Number.isFinite(latestLocal.progress) &&
    latestLocal.progress >= 0 &&
    latestLocal.progress <= 100
      ? latestLocal.progress
      : undefined;
  const rawOnChain = onChainProgressMap[task.id];
  if (typeof rawOnChain === "number" && Number.isFinite(rawOnChain)) {
    const clamped = Math.min(100, Math.max(0, Math.round(rawOnChain)));
    return {
      value: clamped,
      formatted: `${clamped}%`,
      source: "on_chain_confirmed",
      confidence: "confirmed",
      contractProgress: clamped,
      localProgress,
      hasPendingReport: localProgress !== undefined,
    };
  }

  // 2. Nếu task cha chưa có on-chain, tính trung bình đệ quy từ các con trực tiếp
  if (task.directChildren.length > 0) {
    const nextVisited = new Set(visited).add(task.id);
    let validSum = 0;
    let activeDenominator = 0;
    let hasIncompleteChild = false;

    task.directChildren.forEach((child) => {
      if (child.chainDetails?.status === 3 || (!child.chainDetails && child.stateGroup === "cancelled")) return;

      const childProgress = calculateTaskProgress(child, onChainProgressMap, nextVisited);
      if (childProgress.isPartial) hasIncompleteChild = true;
      if (childProgress.value !== null) {
        validSum += childProgress.value;
        activeDenominator += 1;
      } else {
        hasIncompleteChild = true;
      }
    });

    if (activeDenominator > 0) {
      const avg = Math.min(100, Math.max(0, Math.round(validSum / activeDenominator)));
      return {
        value: avg,
        formatted: `${avg}%`,
        source: "direct_children_average",
        confidence: "estimated",
        isPartial: hasIncompleteChild,
      };
    }
  }

  // 3. Nếu task lá chưa có on-chain, lấy tiến độ từ báo cáo local gần nhất
  const dailyReports = task.records.filter((r) => r.event_type === "daily_report");
  const latestReport = dailyReports.sort((a, b) => timestamp(b.recorded_at) - timestamp(a.recorded_at))[0];
  if (typeof latestReport?.progress === "number" && Number.isFinite(latestReport.progress)) {
    const clamped = Math.min(100, Math.max(0, Math.round(latestReport.progress)));
    return {
      value: clamped,
      formatted: `${clamped}%`,
      source: "local_report_estimate",
      confidence: "pending_sync",
      localProgress: clamped,
      hasPendingReport: latestReport.on_chain === false,
    };
  }

  // 4. Hoàn toàn chưa có dữ liệu tiến độ
  return {
    value: null,
    formatted: "Chưa có",
    source: "unknown",
    confidence: "missing",
  };
}

export type ReportsByTask = Readonly<Record<string, readonly OnChainDailyReport[] | undefined>>;
const timestamp = (value?: string) => {
  const n = Date.parse(value || "");
  return Number.isFinite(n) ? n : 0;
};
const newestFirst = (a: StandardReport, b: StandardReport) => timestamp(b.recordedAt) - timestamp(a.recordedAt);

function directReports(task: TaskNode, chain: readonly OnChainDailyReport[] | undefined) {
  const seen = new Set<string>();
  const local: StandardReport[] = [];
  const records = task.records
    .filter((r) => r.event_type === "daily_report")
    .sort((a, b) => timestamp(b.recorded_at) - timestamp(a.recorded_at));
  const localRecords = new Map<string, TBlockchainTrackingRecord>();
  for (const [index, record] of records.entries()) {
    const keys = [
      record.report_id,
      record.client_report_id,
      record.client_event_id,
      record.transaction_hash,
      (record as { id?: string }).id,
    ]
      .filter((v): v is string => Boolean(v && v !== "0x"))
      .map((v) => v.trim().toLowerCase());
    if (keys.some((k) => seen.has(k))) {
      keys.forEach((k) => seen.add(k));
      continue;
    }
    keys.forEach((k) => seen.add(k));
    const id = "local-" + task.id + "-" + (keys[0] || index);
    localRecords.set(id, record);
    local.push({
      id,
      taskId: task.id,
      recordedAt: record.recorded_at,
      progress:
        typeof record.progress === "number" &&
        Number.isFinite(record.progress) &&
        record.progress >= 0 &&
        record.progress <= 100
          ? record.progress
          : null,
      reporterName: record.reporter_name,
      reporterId: record.reporter_id,
      reporterWallet: record.wallet_address,
      work: record.work ?? "",
      difficulty: record.difficulty ?? "",
      evidence: record.evidence ?? "",
      transactionHash: record.transaction_hash,
      isOnChainConfirmed: false,
      isLocalOnly: record.on_chain === false,
      reconciliationStatus: record.transaction_hash ? "unverified" : "local_pending",
    });
  }
  const canonical = new Map<string, StandardReport>();
  for (const [index, report] of (chain || []).entries()) {
    const id = "chain-" + task.id + "-" + report.taskId + "-" + (report.reportId ?? index);
    const content = local.find((item) => {
      const hashes = localRecords.get(item.id)?.dashboard_content_hashes;
      return (
        hashes &&
        item.progress === report.progress &&
        hashes.work.toLowerCase() === report.workHash.toLowerCase() &&
        hashes.difficulty.toLowerCase() === report.difficultyHash.toLowerCase() &&
        hashes.evidence.toLowerCase() === report.evidenceHash.toLowerCase()
      );
    });
    // Only plaintext is borrowed; never reporter, tx hash, or local identity.
    canonical.set(id, {
      id,
      taskId: task.id,
      onChainTaskId: report.taskId,
      onChainIndex: report.reportId ?? index,
      recordedAt: report.reportedAt ? new Date(report.reportedAt * 1000).toISOString() : undefined,
      progress: report.progress,
      work: content?.work ?? "",
      difficulty: content?.difficulty,
      evidence: content?.evidence,
      workHash: report.workHash,
      isOnChainConfirmed: true,
      isLocalOnly: false,
      reconciliationStatus: content ? "content_verified" : "confirmed_on_chain",
    });
  }
  // Report identity cannot be inferred from content. Keep local copies separately instead of claiming a summed total.
  return {
    reports: canonical.size ? [...canonical.values()].sort(newestFirst) : local.sort(newestFirst),
    unreconciled: canonical.size ? local.sort(newestFirst) : [],
    confirmed: canonical.size,
  };
}

/** Pure read model: no module cache, mutation, signing, or persistent storage. */
export function mergeAndDeduplicateReports(
  task: TaskNode,
  onChainReports?: readonly OnChainDailyReport[],
  _currentUserWallet?: string,
  reportsByTask: ReportsByTask = {}
): TaskReportsSummary {
  const own = directReports(task, onChainReports ?? reportsByTask[task.id]);
  const branch = new Map<string, StandardReport>();
  const scope = new Map([task, ...task.allDescendants].map((t) => [t.id, t]));
  let unreconciledCount = 0;
  for (const item of scope.values()) {
    const summary = item.id === task.id ? own : directReports(item, reportsByTask[item.id]);
    summary.reports.forEach((r) => branch.set(r.id, r));
    unreconciledCount += summary.unreconciled.length;
  }
  return {
    contractRead: (onChainReports ?? reportsByTask[task.id]) !== undefined,
    directReports: own.reports,
    directCount: own.reports.length,
    confirmedCount: own.confirmed,
    unreconciledReports: own.unreconciled,
    unreconciledCount,
    branchReports: [...branch.values()].sort(newestFirst),
    branchCount: branch.size,
  };
}

/** The input is the explicit whole scope (selected root + descendants, or all project tasks). */
export function aggregateBranchKpi(
  scope: TaskNode[],
  onChainProgressMap: Readonly<Record<string, number | null | undefined>>,
  summaries: Readonly<Record<string, TaskReportsSummary>> = {}
): AggregateBranchKpi {
  const tasks = [...new Map(scope.map((t) => [t.id, t])).values()];
  const ids = new Set(tasks.map((t) => t.id));
  const leaves = tasks.filter((t) => !t.directChildren.some((c) => ids.has(c.id)));
  const result: AggregateBranchKpi = {
    total: leaves.length,
    todo: 0,
    inProgress: 0,
    completed: 0,
    cancelled: 0,
    onSchedule: 0,
    delayed: 0,
    overdue: 0,
    averageProgress: null,
    totalReports: 0,
    unreconciledReports: 0,
    hasIncompleteData: false,
  };
  const reports = new Set<string>();
  for (const task of tasks) {
    const summary = summaries[task.id] ?? mergeAndDeduplicateReports(task);
    if (!summary.contractRead) result.hasIncompleteData = true;
    summary.directReports.forEach((r) => reports.add(r.id));
    result.unreconciledReports += summary.unreconciledReports.length;
  }
  result.totalReports = reports.size;
  let sum = 0,
    denominator = 0;
  const now = Date.now();
  for (const task of leaves) {
    const progress = calculateTaskProgress(task, onChainProgressMap);
    const status = task.chainDetails
      ? ["unstarted", "started", "completed", "cancelled"][task.chainDetails.status]
      : task.stateGroup;
    if (status === "cancelled") {
      result.cancelled++;
      continue;
    }
    if (status === "completed") result.completed++;
    else if (status === "started") result.inProgress++;
    else if (status === "unstarted" || status === "backlog") result.todo++;
    if (progress.value === null) {
      result.hasIncompleteData = true;
    } else {
      sum += progress.value;
      denominator++;
    }
    if (progress.isPartial) result.hasIncompleteData = true;
    if (!status) result.hasIncompleteData = true;
    const creation = task.records.find((r) => r.event_type === "create_task");
    const date = task.issueDetail?.target_date || creation?.target_date;
    const due = task.chainDetails ? task.chainDetails.dueAt * 1000 : date ? Date.parse(date + "T23:59:59Z") : NaN;
    const created = task.chainDetails
      ? task.chainDetails.createdAt * 1000
      : timestamp(task.issueDetail?.created_at || creation?.recorded_at);
    if (status === "completed" || !Number.isFinite(due) || due <= 0) continue;
    if (now > due) result.overdue++;
    else if (progress.value === null) result.hasIncompleteData = true;
    else if (created > 0 && due > created) {
      const expected = Math.max(0, Math.min(100, Math.floor(((now - created) * 100) / (due - created))));
      if (progress.value < expected) result.delayed++;
      else result.onSchedule++;
    } else result.hasIncompleteData = true;
  }
  result.averageProgress = denominator ? Math.round(sum / denominator) : null;
  return result;
}
