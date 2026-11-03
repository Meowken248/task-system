import { useEffect, useMemo, useRef, useState } from "react";
import type { TIssue } from "@plane/types";
import { getStoredWalletAddress } from "@plane/services";
import { IssueService } from "@/services/issue";
import {
  blockchainTrackingService,
  type TBlockchainTrackingRecord,
} from "@/services/blockchain/blockchain-tracking.service";
import {
  getIssueOnChainTaskDetails,
  getIssueOnChainReports,
  hashTaskValue,
  isMissingOnChainRecordError,
} from "@/services/blockchain/plane-task-chain.service";
import { buildTaskHierarchy } from "./kpi-calculator";
import { hydrateReportContent, readChainSnapshot, type ChainSnapshot } from "./snapshot";
import { createRefreshController } from "./refresh-controller";
import { subscribeDashboardUpdates } from "@/services/blockchain/dashboard-updates";

const issueService = new IssueService();
const emptyChain = (): ChainSnapshot => ({ details: {}, reports: {}, errors: [] });
const empty = () => ({
  context: "",
  records: [] as TBlockchainTrackingRecord[],
  issues: [] as TIssue[],
  chain: emptyChain(),
  refreshing: false,
  loaded: false,
  updatedAt: undefined as number | undefined,
  error: "",
  version: 0,
});

function issuesFromResponse(response: unknown): TIssue[] {
  if (Array.isArray(response)) return response;
  const results = (response as { results?: unknown })?.results;
  if (Array.isArray(results)) return results;
  if (results && typeof results === "object")
    return Object.values(results).flatMap((g: any) => (Array.isArray(g?.results) ? g.results : []));
  throw new Error("Invalid issue list response");
}

export function useProjectSnapshot(
  workspaceSlug: string,
  project?: { id: string; identifier?: string },
  wallet?: string
) {
  const [state, setState] = useState(empty);
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  // A silent wallet change must also invalidate the previous read context.
  const storedWallet = getStoredWalletAddress();
  const context = JSON.stringify([workspaceSlug, project?.id, project?.identifier, wallet, storedWallet]);
  useEffect(() => {
    setState({ ...empty(), context });
    if (!project?.id) return;
    const controller = createRefreshController(async (isCurrent) => {
      if (!isCurrent()) return;
      setState((s) => ({ ...s, refreshing: true }));
      try {
        const [rawRecords, response] = await Promise.all([
          blockchainTrackingService.getTransactionsReadOnly(workspaceSlug, project.id),
          issueService.getIssuesFromServer(workspaceSlug, project.id, { sub_issue: "true" } as any),
        ]);
        const records = await hydrateReportContent(rawRecords, hashTaskValue);
        const issues = issuesFromResponse(response);
        if (!isCurrent()) return;
        // Keep the last confirmed values while reading. The header marks this refresh;
        // a failed read replaces the affected task with an explicit unknown result.
        setState((s) => ({
          ...s,
          records,
          issues,
          loaded: true,
          error: "",
          version: s.version + 1,
        }));
        const hierarchy = buildTaskHierarchy(records, issues, project);
        const chain = await readChainSnapshot(hierarchy.allTasks, {
          details: (id) => getIssueOnChainTaskDetails(id, { strict: true }),
          reports: (id, taskId) => getIssueOnChainReports(id, { strict: true, taskId }),
          missing: isMissingOnChainRecordError,
          isCurrent,
        });
        if (!isCurrent()) return;
        setState((s) => ({
          ...s,
          chain,
          refreshing: false,
          updatedAt: Date.now(),
          error: chain.errors.length
            ? `Chưa đọc đủ dữ liệu contract của ${chain.errors.length} task. Số liệu hiện có có thể chưa đầy đủ; hãy thử làm mới.`
            : "",
          version: s.version + 1,
        }));
      } catch (error) {
        console.warn("Dashboard read failed", error);
        if (isCurrent())
          setState((s) => ({
            ...s,
            refreshing: false,
            loaded: true,
            error: "Không tải được dữ liệu mới. Dữ liệu đang hiển thị có thể đã cũ; hãy thử làm mới.",
          }));
      }
    });
    refreshRef.current = controller.request;
    const refresh = () => {
      if (document.visibilityState !== "hidden") void controller.request();
    };
    const unsubscribe = subscribeDashboardUpdates((update) => {
      if (update.workspaceSlug === workspaceSlug && update.projectId === project.id) void controller.request();
    });
    window.addEventListener("focus", refresh);
    window.addEventListener("plane_dapp_db_reloaded", refresh);
    document.addEventListener("visibilitychange", refresh);
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "hidden") void controller.request(false);
    }, 15000);
    void controller.request();
    return () => {
      controller.dispose();
      unsubscribe();
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("plane_dapp_db_reloaded", refresh);
      document.removeEventListener("visibilitychange", refresh);
      refreshRef.current = async () => {};
    };
  }, [workspaceSlug, project, wallet, storedWallet, context]);
  const visible = state.context === context ? state : empty();
  const hierarchy = useMemo(() => {
    const value = buildTaskHierarchy(visible.records, visible.issues, project);
    value.allTasks.forEach((task) => {
      task.chainDetails = visible.chain.details[task.id];
    });
    return value;
  }, [visible.records, visible.issues, visible.chain, project]);
  return {
    ...visible,
    ...hierarchy,
    refresh: () => refreshRef.current(),
    progress: Object.fromEntries(Object.entries(visible.chain.details).map(([id, detail]) => [id, detail.progress])),
  };
}
