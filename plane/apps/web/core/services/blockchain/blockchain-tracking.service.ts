import { API_BASE_URL } from "@plane/constants";
import { APIService } from "@/services/api.service";

class BlockchainTrackingService extends APIService {
  constructor() {
    super(API_BASE_URL);
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
  async getStoredAssigneeWallet(workspaceSlug: string, projectId: string, assigneeId: string): Promise<string> {
    const response = await this.get(`/api/workspaces/${workspaceSlug}/projects/${projectId}/blockchain-transactions/`);
    const records = Array.isArray(response?.data) ? response.data : [];
    const assignment = records.find(
      (record: Record<string, unknown>) =>
        record.event_type === "assign_task" &&
        record.assignee_id === assigneeId &&
        typeof record.assignee_wallet === "string"
    );
    return typeof assignment?.assignee_wallet === "string" ? assignment.assignee_wallet : "";
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
