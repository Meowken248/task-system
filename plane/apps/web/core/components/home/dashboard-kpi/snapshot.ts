/* oxlint-disable no-await-in-loop -- Four workers bound RPC concurrency; each task needs its detail before reports. */
import type { TBlockchainTrackingRecord } from "@/services/blockchain/blockchain-tracking.service";
import type { OnChainDailyReport, OnChainTaskDetails } from "@/services/blockchain/plane-task-chain.service";
import type { TaskNode } from "./types";

export type ChainSnapshot = {
  details: Record<string, OnChainTaskDetails>;
  reports: Record<string, OnChainDailyReport[] | undefined>;
  errors: string[];
};

/** All tasks share this explicit read snapshot. A failed RPC is never an empty report list. */
export async function readChainSnapshot(
  tasks: TaskNode[],
  reader: {
    details: (id: string) => Promise<OnChainTaskDetails | null>;
    reports: (id: string, taskId: number) => Promise<OnChainDailyReport[]>;
    missing: (error: unknown) => boolean;
    isCurrent?: () => boolean;
  }
): Promise<ChainSnapshot> {
  const result: ChainSnapshot = { details: {}, reports: {}, errors: [] };
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, tasks.length) }, async () => {
      while (next < tasks.length && reader.isCurrent?.() !== false) {
        const task = tasks[next++];
        try {
          const detail = await reader.details(task.id);
          if (reader.isCurrent?.() === false) return;
          if (!detail) throw new Error("Invalid task response");
          result.details[task.id] = detail;
          result.reports[task.id] = await reader.reports(task.id, detail.taskId);
        } catch (error) {
          if (reader.missing(error) && !result.details[task.id]) result.reports[task.id] = [];
          else result.errors.push(task.id);
        }
      }
    })
  );
  return result;
}

/** Hash exactly the original strings sent by submitDailyReport. No identity is inferred. */
export async function hydrateReportContent(
  records: TBlockchainTrackingRecord[],
  hash: (value: string) => Promise<string>
) {
  return Promise.all(
    records.map(async (record) =>
      record.event_type !== "daily_report"
        ? record
        : {
            ...record,
            dashboard_content_hashes: {
              work: await hash(record.work ?? ""),
              difficulty: await hash(record.difficulty ?? ""),
              evidence: await hash(record.evidence ?? ""),
            },
          }
    )
  );
}
