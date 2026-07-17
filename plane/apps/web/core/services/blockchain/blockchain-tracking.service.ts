import { API_BASE_URL } from "@plane/constants";
import { APIService } from "@/services/api.service";

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
  progress?: number;
  work?: string;
  difficulty?: string;
  evidence?: string;
  content_kind?: "comment" | "attachment" | "evidence";
  content_reference?: string;
  recorded_at?: string;
};
class BlockchainTrackingService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  async getTransactions(workspaceSlug: string, projectId: string): Promise<TBlockchainTrackingRecord[]> {
    const response = await this.get(`/api/workspaces/${workspaceSlug}/projects/${projectId}/blockchain-transactions/`);
    return Array.isArray(response?.data) ? response.data : [];
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
    await this.post(`/api/workspaces/${workspaceSlug}/projects/${projectId}/blockchain-transactions/`, {
      event_type: "daily_report",
      issue_id: payload.issueId,
      issue_name: payload.issueName,
      wallet_address: process.env.VITE_METANODE_WALLET_ADDRESS,
      contract_address: process.env.VITE_CONTRACT_ADDRESS,
      chain_id: process.env.VITE_CHAIN_ID,
      transaction_hash: payload.transactionHash,
      progress: payload.progress,
      work: payload.work,
      difficulty: payload.difficulty,
      evidence: payload.evidence,
    });
  }
  async recordTaskContent(
    workspaceSlug: string,
    projectId: string,
    payload: { issueId: string; issueName?: string; transactionHash: string; kind: "comment" | "attachment" | "evidence"; reference: string }
  ): Promise<void> {
    await this.post(`/api/workspaces/${workspaceSlug}/projects/${projectId}/blockchain-transactions/`, {
      event_type: "task_content",
      issue_id: payload.issueId,
      issue_name: payload.issueName,
      wallet_address: process.env.VITE_METANODE_WALLET_ADDRESS,
      contract_address: process.env.VITE_CONTRACT_ADDRESS,
      chain_id: process.env.VITE_CHAIN_ID,
      transaction_hash: payload.transactionHash,
      content_kind: payload.kind,
      content_reference: payload.reference,
    });
  }

  async getStoredAssigneeWallet(workspaceSlug: string, projectId: string, assigneeId: string): Promise<string> {
    const records = await this.getTransactions(workspaceSlug, projectId);
    const assignment = records.find(
      (record: Record<string, unknown>) =>
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
    await this.post(`/api/workspaces/${workspaceSlug}/projects/${projectId}/blockchain-transactions/`, {
      event_type: "delete_task",
      issue_id: payload.issueId,
      issue_name: payload.issueName,
      wallet_address: process.env.VITE_METANODE_WALLET_ADDRESS,
      contract_address: process.env.VITE_CONTRACT_ADDRESS,
      chain_id: process.env.VITE_CHAIN_ID,
      transaction_hash: payload.transactionHash,
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
    await this.post(`/api/workspaces/${workspaceSlug}/projects/${projectId}/blockchain-transactions/`, {
      event_type: "assign_task",
      issue_id: payload.issueId,
      issue_name: payload.issueName,
      wallet_address: process.env.VITE_METANODE_WALLET_ADDRESS,
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
