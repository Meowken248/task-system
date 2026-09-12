import { API_BASE_URL } from "@plane/constants";
import { APIService } from "@/services/api.service";
import { getLinkedMetanodeWalletAddress } from "@/services/blockchain/metanode-wallet.service";

export type TBlockchainTrackingRecord = {
  report_id?: string;
  event_type?: "create_task" | "assign_task" | "daily_report" | "delete_task" | "task_content";
  issue_id?: string;
  issue_name?: string;
  parent_issue_id?: string;
  target_date?: string;
  priority?: string;
  project_id?: string;
  workspace_slug?: string;
  wallet_address?: string;
  assignee_wallet?: string;
  assignee_id?: string;
  assignee_name?: string;
  reporter_id?: string;
  reporter_name?: string;
  contract_address?: string;
  chain_id?: string;
  transaction_hash?: string;
  client_report_id?: string;
  client_event_id?: string;
  on_chain?: boolean;
  verification_status?: string;
  progress?: number;
  work?: string;
  difficulty?: string;
  evidence?: string;
  content_kind?: "comment" | "attachment" | "evidence";
  content_reference?: string;
  recorded_at?: string;
};

type TTrackingOutboxEntry = {
  path: string;
  payload: Record<string, unknown>;
};

const TRACKING_OUTBOX_KEY = "plane:blockchain-tracking-outbox:v1";

class BlockchainTrackingService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  private currentContractRecords(records: TBlockchainTrackingRecord[]): TBlockchainTrackingRecord[] {
    const currentContractAddress = process.env.VITE_CONTRACT_ADDRESS?.trim().toLowerCase();
    if (!currentContractAddress) return records;
    return records.filter((record) => record.contract_address?.trim().toLowerCase() === currentContractAddress);
  }

  private readOutbox(): Record<string, TTrackingOutboxEntry> {
    if (typeof window === "undefined") return {};
    try {
      const parsed = JSON.parse(window.localStorage.getItem(TRACKING_OUTBOX_KEY) ?? "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  private writeOutbox(entries: Record<string, TTrackingOutboxEntry>): void {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(TRACKING_OUTBOX_KEY, JSON.stringify(entries));
    } catch (error) {
      console.warn("Không thể lưu blockchain outbox vào trình duyệt.", error);
    }
  }

  private queueTracking(path: string, payload: Record<string, unknown>): void {
    const id = String(payload.transaction_hash ?? payload.client_event_id ?? payload.client_report_id ?? "")
      .trim()
      .toLowerCase();
    if (!id) return;
    this.writeOutbox({ ...this.readOutbox(), [id]: { path, payload } });
  }

  private removeQueuedTracking(payload: Record<string, unknown>): void {
    const id = String(payload.transaction_hash ?? payload.client_event_id ?? payload.client_report_id ?? "")
      .trim()
      .toLowerCase();
    if (!id) return;
    const entries = this.readOutbox();
    if (entries[id]) {
      delete entries[id];
      this.writeOutbox(entries);
    }
  }

  private async flushTrackingOutbox(): Promise<void> {
    await Promise.all(
      Object.values(this.readOutbox()).map(async (entry) => {
        try {
          await this.postTracking(entry.path, entry.payload);
        } catch (error) {
          console.warn("Blockchain tracking vẫn đang chờ tự đồng bộ.", error);
        }
      })
    );
  }

  private async postTracking(path: string, payload: Record<string, unknown>, attempt = 0): Promise<void> {
    this.queueTracking(path, payload);
    try {
      await this.post(path, payload);
      this.removeQueuedTracking(payload);
    } catch (error) {
      const responseStatus = (error as { response?: { status?: number } })?.response?.status;
      if (responseStatus && responseStatus >= 400 && responseStatus < 500) {
        this.removeQueuedTracking(payload);
        throw error;
      }
      if (attempt >= 2) throw error;
      await new Promise<void>((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
      return this.postTracking(path, payload, attempt + 1);
    }
  }

  async getTransactions(workspaceSlug: string, projectId: string): Promise<TBlockchainTrackingRecord[]> {
    await this.flushTrackingOutbox();
    const response = await this.get(`/api/workspaces/${workspaceSlug}/projects/${projectId}/blockchain-transactions/`);
    const records: TBlockchainTrackingRecord[] = Array.isArray(response?.data) ? response.data : [];
    return this.currentContractRecords(records);
  }

  async recordTaskCreation(
    workspaceSlug: string,
    projectId: string,
    payload: {
      issueId: string;
      issueName: string;
      parentIssueId?: string | null;
      targetDate?: string | null;
      priority?: string | null;
      transactionHash: string;
      assigneeWallet: string;
      assigneeId?: string;
    }
  ): Promise<void> {
    await this.postTracking(`/api/workspaces/${workspaceSlug}/projects/${projectId}/blockchain-transactions/`, {
      event_type: "create_task",
      issue_id: payload.issueId,
      issue_name: payload.issueName,
      parent_issue_id: payload.parentIssueId,
      target_date: payload.targetDate,
      priority: payload.priority,
      assignee_wallet: payload.assigneeWallet,
      assignee_id: payload.assigneeId,
      wallet_address: getLinkedMetanodeWalletAddress() ?? undefined,
      contract_address: process.env.VITE_CONTRACT_ADDRESS,
      chain_id: process.env.VITE_CHAIN_ID,
      transaction_hash: payload.transactionHash,
    });
  }

  async recordOfflineTaskCreation(
    workspaceSlug: string,
    projectId: string,
    payload: {
      issueId: string;
      issueName: string;
      parentIssueId?: string | null;
      targetDate?: string | null;
      priority?: string | null;
    }
  ): Promise<void> {
    const clientEventId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    await this.postTracking(`/api/workspaces/${workspaceSlug}/projects/${projectId}/blockchain-transactions/`, {
      event_type: "create_task",
      issue_id: payload.issueId,
      issue_name: payload.issueName,
      parent_issue_id: payload.parentIssueId,
      target_date: payload.targetDate,
      priority: payload.priority,
      client_event_id: clientEventId,
      on_chain: false,
      contract_address: process.env.VITE_CONTRACT_ADDRESS,
    });
  }
  async recordDailyReport(
    workspaceSlug: string,
    projectId: string,
    payload: {
      issueId: string;
      issueName: string;
      transactionHash: string;
      progress: number;
      work: string;
      difficulty: string;
      evidence: string;
    }
  ): Promise<void> {
    await this.postTracking(`/api/workspaces/${workspaceSlug}/projects/${projectId}/blockchain-transactions/`, {
      event_type: "daily_report",
      issue_id: payload.issueId,
      issue_name: payload.issueName,
      wallet_address: getLinkedMetanodeWalletAddress() ?? undefined,
      contract_address: process.env.VITE_CONTRACT_ADDRESS,
      chain_id: process.env.VITE_CHAIN_ID,
      transaction_hash: payload.transactionHash,
      progress: payload.progress,
      work: payload.work,
      difficulty: payload.difficulty,
      evidence: payload.evidence,
    });
  }

  async recordOfflineDailyReport(
    workspaceSlug: string,
    projectId: string,
    payload: {
      issueId: string;
      issueName: string;
      progress: number;
      work: string;
      difficulty: string;
      evidence: string;
    }
  ): Promise<void> {
    const clientReportId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    await this.postTracking(`/api/workspaces/${workspaceSlug}/projects/${projectId}/blockchain-transactions/`, {
      event_type: "daily_report",
      issue_id: payload.issueId,
      issue_name: payload.issueName,
      client_event_id: clientReportId,
      on_chain: false,
      contract_address: process.env.VITE_CONTRACT_ADDRESS,
      progress: payload.progress,
      work: payload.work,
      difficulty: payload.difficulty,
      evidence: payload.evidence,
    });
  }
  async recordTaskContent(
    workspaceSlug: string,
    projectId: string,
    payload: {
      issueId: string;
      issueName?: string;
      transactionHash: string;
      kind: "comment" | "attachment" | "evidence";
      reference: string;
      contentHash: string;
    }
  ): Promise<void> {
    await this.postTracking(`/api/workspaces/${workspaceSlug}/projects/${projectId}/blockchain-transactions/`, {
      event_type: "task_content",
      issue_id: payload.issueId,
      issue_name: payload.issueName,
      wallet_address: getLinkedMetanodeWalletAddress() ?? undefined,
      contract_address: process.env.VITE_CONTRACT_ADDRESS,
      chain_id: process.env.VITE_CHAIN_ID,
      transaction_hash: payload.transactionHash,
      content_kind: payload.kind,
      content_reference: payload.reference,
      content_hash: payload.contentHash,
    });
  }

  async getStoredAssigneeWallet(workspaceSlug: string, projectId: string, assigneeId: string): Promise<string> {
    const response = await this.get(
      `/api/workspaces/${workspaceSlug}/projects/${projectId}/blockchain-transactions/?assignee_id=${encodeURIComponent(assigneeId)}`
    );
    const records: TBlockchainTrackingRecord[] = Array.isArray(response?.data) ? response.data : [];
    const assignment = this.currentContractRecords(records).find(
      (record) =>
        record.event_type === "assign_task" &&
        record.assignee_id === assigneeId &&
        typeof record.assignee_wallet === "string"
    );
    return typeof assignment?.assignee_wallet === "string" ? assignment.assignee_wallet : "";
  }
  async recordTaskDeletion(
    workspaceSlug: string,
    projectId: string,
    payload: { issueId: string; issueName: string; transactionHash: string }
  ): Promise<void> {
    await this.postTracking(`/api/workspaces/${workspaceSlug}/projects/${projectId}/blockchain-transactions/`, {
      event_type: "delete_task",
      issue_id: payload.issueId,
      issue_name: payload.issueName,
      wallet_address: getLinkedMetanodeWalletAddress() ?? undefined,
      contract_address: process.env.VITE_CONTRACT_ADDRESS,
      chain_id: process.env.VITE_CHAIN_ID,
      transaction_hash: payload.transactionHash,
    });
  }

  async recordOfflineTaskDeletion(
    workspaceSlug: string,
    projectId: string,
    payload: { issueId: string; issueName: string }
  ): Promise<void> {
    const clientEventId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    await this.postTracking(`/api/workspaces/${workspaceSlug}/projects/${projectId}/blockchain-transactions/`, {
      event_type: "delete_task",
      issue_id: payload.issueId,
      issue_name: payload.issueName,
      client_event_id: clientEventId,
      on_chain: false,
      contract_address: process.env.VITE_CONTRACT_ADDRESS,
    });
  }

  async recordTaskAssignment(
    workspaceSlug: string,
    projectId: string,
    payload: {
      issueId: string;
      issueName: string;
      transactionHash: string;
      assigneeWallet: string;
      assigneeId: string;
      assigneeName: string;
    }
  ): Promise<void> {
    await this.postTracking(`/api/workspaces/${workspaceSlug}/projects/${projectId}/blockchain-transactions/`, {
      event_type: "assign_task",
      issue_id: payload.issueId,
      issue_name: payload.issueName,
      wallet_address: getLinkedMetanodeWalletAddress() ?? undefined,
      assignee_wallet: payload.assigneeWallet,
      assignee_id: payload.assigneeId,
      assignee_name: payload.assigneeName,
      contract_address: process.env.VITE_CONTRACT_ADDRESS,
      chain_id: process.env.VITE_CHAIN_ID,
      transaction_hash: payload.transactionHash,
    });
  }
}

export const blockchainTrackingService = new BlockchainTrackingService();
