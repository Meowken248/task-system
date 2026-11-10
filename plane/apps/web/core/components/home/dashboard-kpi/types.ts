import type { TBlockchainTrackingRecord } from "@/services/blockchain/blockchain-tracking.service";
import type { TIssue } from "@plane/types";
import type { OnChainTaskDetails } from "@/services/blockchain/plane-task-chain.service";

export type ProgressConfidence = "confirmed" | "estimated" | "pending_sync" | "missing";

export type NormalizedProgress = {
  /** Giá trị tiến độ từ 0 đến 100, hoặc null nếu hoàn toàn thiếu dữ liệu */
  value: number | null;
  /** Chuỗi hiển thị an toàn: ví dụ "63%" hoặc "Chưa có dữ liệu" */
  formatted: string;
  /** Nguồn gốc số liệu */
  source: "on_chain_confirmed" | "direct_children_average" | "local_report_estimate" | "unknown";
  /** Mức độ tin cậy của dữ liệu */
  confidence: ProgressConfidence;
  /** Tiến độ cục bộ/báo cáo gần nhất chưa được xác nhận trên chain (nếu có) */
  localProgress?: number;
  hasPendingReport?: boolean;
  /** Tiến độ đã xác nhận trên contract (nếu có) */
  contractProgress?: number;
  /** Đánh dấu dữ liệu nhánh con chưa đầy đủ (nếu có con thiếu dữ liệu) */
  isPartial?: boolean;
};

export type TaskNode = {
  id: string;
  name: string;
  sequence_id?: number;
  identifier?: string;
  parentId?: string;
  statusId?: string;
  stateGroup?: "backlog" | "unstarted" | "started" | "completed" | "cancelled";
  records: TBlockchainTrackingRecord[];
  issueDetail?: TIssue;
  chainDetails?: OnChainTaskDetails;
  /** Con trực tiếp bậc 1 */
  directChildren: TaskNode[];
  /** Toàn bộ hậu duệ các cấp */
  allDescendants: TaskNode[];
  /** Các task lá thuộc nhánh (nếu không có con, chính nó là lá duy nhất) */
  leafTasks: TaskNode[];
};

export type StandardReport = {
  id: string;
  taskId: string;
  onChainIndex?: number;
  onChainTaskId?: number;
  recordedAt?: string;
  progress: number | null;
  reporterName?: string;
  reporterId?: string;
  reporterWallet?: string;
  work?: string;
  difficulty?: string;
  evidence?: string;
  workHash?: string;
  transactionHash?: string;
  isOnChainConfirmed: boolean;
  isLocalOnly: boolean;
  reconciliationStatus: "confirmed_on_chain" | "local_pending" | "unverified" | "content_verified";
};

export type TaskReportsSummary = {
  contractRead: boolean;
  /** Các báo cáo trực tiếp gửi cho chính task này */
  directReports: StandardReport[];
  /** Tổng số báo cáo trực tiếp */
  directCount: number;
  confirmedCount: number;
  unreconciledReports: StandardReport[];
  unreconciledCount: number;
  /** Toàn bộ báo cáo trong toàn nhánh (gồm task này và mọi hậu duệ, đã khử trùng) */
  branchReports: StandardReport[];
  /** Tổng số báo cáo toàn nhánh */
  branchCount: number;
};

export type HierarchyCount = {
  directCount: number;
  descendantCount: number;
  leafCount: number;
};

export type AggregateBranchKpi = {
  total: number;
  todo: number;
  inProgress: number;
  completed: number;
  cancelled: number;
  onSchedule: number;
  delayed: number;
  overdue: number;
  averageProgress: number | null;
  totalReports: number;
  unreconciledReports: number;
  hasIncompleteData: boolean;
};
