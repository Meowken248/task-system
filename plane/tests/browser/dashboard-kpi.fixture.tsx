// Test-only adapters. The widget, React effects, tracking writes/notifications,
// calculation helpers, IndexedDB storage and asset-source resolver are production code.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { notifyDashboardUpdate } from "../../apps/web/core/services/blockchain/dashboard-updates";
import { saveAttachment } from "../../packages/services/src/file/attachment-storage";

export const fixture: any = {
  records: [],
  chain: {},
  failReports: false,
  reads: 0,
  posts: 0,
  localDB: { assets: [], attachments: [] },
};
export class ProjectService {
  async getProjectsLite(ws: string) {
    return [{ id: ws === "team" ? "p" : "p2", name: ws === "team" ? "ProjectOne" : "ProjectTwo" }];
  }
}
export class IssueService {
  async getIssuesFromServer(ws: string) {
    return {
      results:
        ws === "team"
          ? [
              { id: "root", name: "RootTask", state_group: "started" },
              { id: "leaf", name: "LeafTask", parent_id: "root", state_group: "started" },
            ]
          : [{ id: "new", name: "NewWorkspaceTask", state_group: "unstarted" }],
    };
  }
}
export class WorkspaceService {
  async fetchWorkspaceMembers() {
    return [];
  }
}
export class IssueCommentService {
  async getIssueComments() {
    return [];
  }
}
export class IssueAttachmentService {
  async getIssueAttachments() {
    return [
      { id: "asset_real", asset_url: "asset_real", attributes: { name: "actual-evidence.png", type: "image/png" } },
    ];
  }
}
export class APIService {
  async get(path: string) {
    fixture.reads++;
    return { data: fixture.records.filter((r: any) => path.includes(`/projects/${r.project_id}/`)) };
  }
  async post(path: string, payload: any) {
    fixture.posts++;
    fixture.records.push({
      ...payload,
      project_id: path.includes("/projects/p2/") ? "p2" : "p",
      recorded_at: new Date().toISOString(),
    });
    return { data: payload };
  }
}
export const API_BASE_URL = "";
export function useUser() {
  return { data: { id: "viewer" } };
}
export function getStoredWalletAddress() {
  return null;
}
export async function getSigningWalletAddress() {
  throw Error("Dashboard must not request signing");
}
export async function hashTaskValue(text: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return "0x" + Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}
export function isMissingOnChainRecordError(error: Error) {
  return error.message === "InvalidTask";
}
export async function getIssueOnChainTaskDetails(id: string) {
  if (fixture.gate) await fixture.gate;
  if (!fixture.chain[id]) throw Error("InvalidTask");
  return {
    taskId: 1,
    creator: "",
    assignee: "",
    progress: fixture.chain[id][0]?.progress ?? 0,
    status: 1,
    dueAt: 0,
    createdAt: 1700000000,
    updatedAt: 1700000000,
    priority: 0,
  };
}
export async function getIssueOnChainReports(id: string) {
  if (fixture.failReports) throw Error("Fixture RPC unavailable");
  return fixture.chain[id] || [];
}
export async function getWalletKPI() {
  throw Error("Fixture has no wallet KPI");
}

function App({ Widget }: { Widget: any }) {
  const [workspace, setWorkspace] = useState("team");
  Object.assign(fixture, {
    setWorkspace,
    async report(issueId = "leaf", work = "Live report from actual tracking save", progress = 55) {
      const { blockchainTrackingService } =
        await import("../../apps/web/core/services/blockchain/blockchain-tracking.service");
      await blockchainTrackingService.recordOfflineDailyReport("team", "p", {
        issueId,
        issueName: issueId,
        progress,
        work,
        difficulty: "Actual difficulty",
        evidence: "Actual proof",
      });
    },
    async confirm() {
      fixture.chain.leaf = [
        {
          taskId: 1,
          reportId: 0,
          reportedAt: Math.floor(Date.now() / 1000),
          progress: 55,
          workHash: await hashTaskValue("Live report from actual tracking save"),
          difficultyHash: await hashTaskValue("Actual difficulty"),
          evidenceHash: await hashTaskValue("Actual proof"),
        },
      ];
      notifyDashboardUpdate({ workspaceSlug: "team", projectId: "p" });
    },
    async offlineHundred() {
      const { blockchainTrackingService } =
        await import("../../apps/web/core/services/blockchain/blockchain-tracking.service");
      fixture.chain.leaf = [];
      await blockchainTrackingService.recordOfflineDailyReport("team", "p", {
        issueId: "leaf",
        issueName: "leaf",
        progress: 100,
        work: "Pending hundred percent",
        difficulty: "",
        evidence: "",
      });
    },
    update: () => notifyDashboardUpdate({ workspaceSlug: "team", projectId: "p" }),
    block: () => {
      fixture.gate = new Promise((resolve) => {
        fixture.release = () => {
          fixture.gate = null;
          resolve(null);
        };
      });
    },
  });
  return <Widget workspaceSlug={workspace} />;
}
async function start() {
  const canvas = document.createElement("canvas");
  canvas.width = 3;
  canvas.height = 2;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#4ea9cf";
  ctx.fillRect(0, 0, 3, 2);
  fixture.originalImage = canvas.toDataURL("image/png");
  await saveAttachment("asset_real", { name: "actual-evidence.png", type: "image/png", base64: fixture.originalImage });
  fixture.records.push({
    issue_id: "leaf",
    project_id: "p",
    event_type: "task_content",
    content_kind: "evidence",
    content_reference: "asset_real:actual-evidence.png:100:0",
  });
  (window as any).dashboardFixture = fixture;
  const { OnChainKpiWidget } = await import("../../apps/web/core/components/home/on-chain-kpi-widget");
  createRoot(document.getElementById("root")!).render(<App Widget={OnChainKpiWidget} />);
}
void start();
