import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@plane/propel/button";
import { blockchainTrackingService } from "@/services/blockchain/blockchain-tracking.service";
import {
  getIssueSubTaskStats,
  isOnChainTaskSyncAvailable,
  isOnChainTaskSyncEnabled,
  submitIssueDailyReportOnChain,
  type OnChainSubTaskStats,
} from "@/services/blockchain/plane-task-chain.service";

type Props = {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  issueName: string;
  ancestorIssueIds: string[];
  canReport: boolean;
  onReportRecorded: (data: {
    progress: number;
    transactionHash: string;
    recordedAt: Date;
    work: string;
    difficulty: string;
    evidence: string;
  }) => Promise<void>;
};

export function OnChainTaskPanel({
  workspaceSlug,
  projectId,
  issueId,
  issueName,
  ancestorIssueIds,
  canReport,
  onReportRecorded,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [work, setWork] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const [evidence, setEvidence] = useState("");
  const [progress, setProgress] = useState(0);
  const [subTaskStats, setSubTaskStats] = useState<OnChainSubTaskStats>();
  const [status, setStatus] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isReportOpen && !dialog.open) dialog.showModal();
    if (!isReportOpen && dialog.open) dialog.close();
  }, [isReportOpen]);

  useEffect(() => {
    if (!canReport || !isOnChainTaskSyncAvailable()) {
      setSubTaskStats(undefined);
      return;
    }
    let active = true;
    const loadSubTaskStats = async () => {
      try {
        const stats = await getIssueSubTaskStats(issueId);
        if (!active) return;
        setSubTaskStats(stats);
        if (stats.activeCount > 0) setProgress(stats.progress);
      } catch {
        if (active) setSubTaskStats(undefined);
      }
    };
    void loadSubTaskStats();
    return () => {
      active = false;
    };
  }, [canReport, issueId]);
  if (!canReport) return null;

  const closeReport = () => {
    if (!submitting) setIsReportOpen(false);
  };

  const submitReport = async () => {
    if (subTaskStats?.activeCount) {
      setStatus("Task cha không gửi báo cáo trực tiếp; tiến độ được tổng hợp từ các task lá.");
      return;
    }
    // Close the native top-layer dialog before FIAI opens its wallet UI.
    dialogRef.current?.close();
    setIsReportOpen(false);
    setSubmitting(true);
    setStatus("Đang chờ xác nhận ví...");
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    const saveOfflineReport = async (message: string) => {
      await blockchainTrackingService.recordOfflineDailyReport(workspaceSlug, projectId, {
        issueId,
        issueName,
        progress,
        work,
        difficulty,
        evidence,
      });
      await onReportRecorded({ progress, transactionHash: "", recordedAt: new Date(), work, difficulty, evidence });
      setStatus(message);
      setWork("");
      setDifficulty("");
      setEvidence("");
    };
    try {
      if (!isOnChainTaskSyncAvailable()) {
        await saveOfflineReport("Đã lưu báo cáo trên Plane. Chế độ on-chain hiện không khả dụng.");
        return;
      }

      const result = await submitIssueDailyReportOnChain(
        issueId,
        { progress, work, difficulty, evidence },
        setStatus,
        ancestorIssueIds
      );
      void blockchainTrackingService
        .recordDailyReport(workspaceSlug, projectId, {
          issueId,
          issueName,
          transactionHash: result.transactionHash,
          progress: result.progress,
          work,
          difficulty,
          evidence,
        })
        .catch((trackingError) => {
          console.warn("Báo cáo đã lên blockchain; audit đang chờ tự đồng bộ.", trackingError);
        });
      await onReportRecorded({
        progress: result.progress,
        transactionHash: result.transactionHash,
        recordedAt: new Date(),
        work,
        difficulty,
        evidence,
      });
      setStatus(
        result.parentSyncError
          ? `Báo cáo đã thành công (${result.transactionHash}), nhưng chưa đồng bộ được task cha: ${result.parentSyncError}`
          : `Đã gửi báo cáo on-chain: ${result.transactionHash}`
      );
      setWork("");
      setDifficulty("");
      setEvidence("");
    } catch (error) {
      console.warn("Không gửi được báo cáo on-chain; lưu báo cáo trên Plane.", error);
      try {
        await saveOfflineReport(
          "Đã lưu báo cáo trên Plane."
        );
      } catch (localError) {
        setStatus(localError instanceof Error ? localError.message : "Không thể lưu báo cáo trên Plane.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const reportDialog =
    typeof document !== "undefined"
      ? createPortal(
        <dialog
          ref={dialogRef}
          className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-xl border border-subtle bg-surface-1 p-0 text-primary shadow-raised-200 backdrop:bg-black/80 backdrop:backdrop-blur-sm"
          onCancel={(event) => {
            event.preventDefault();
            closeReport();
          }}
          onClose={() => setIsReportOpen(false)}
        >
          <div className="pointer-events-auto relative isolate bg-surface-1 p-5">
            <div className="mb-4 text-16 font-semibold text-primary">Báo cáo cuối ngày</div>
            <div className="space-y-4">
              <textarea
                className="focus:border-accent min-h-24 w-full resize-y rounded-md border border-subtle bg-layer-1 p-3 text-13 text-primary outline-none"
                placeholder="Hôm nay làm gì?"
                value={work}
                onChange={(event) => setWork(event.target.value)}
              />
              <textarea
                className="focus:border-accent min-h-20 w-full resize-y rounded-md border border-subtle bg-layer-1 p-3 text-13 text-primary outline-none"
                placeholder="Khó khăn"
                value={difficulty}
                onChange={(event) => setDifficulty(event.target.value)}
              />
              <input
                className="focus:border-accent w-full rounded-md border border-subtle bg-layer-1 px-3 py-2 text-13 text-primary outline-none"
                placeholder="Evidence URL / mã file"
                value={evidence}
                onChange={(event) => setEvidence(event.target.value)}
              />
              <div className="rounded-md border border-subtle bg-layer-1 p-3">
                <label htmlFor="daily-report-progress" className="block text-12 font-medium text-secondary">
                  Tiến độ: {progress}%
                  {subTaskStats?.activeCount
                    ? ` · ${subTaskStats.completedCount}/${subTaskStats.activeCount} sub-task hoàn thành`
                    : ""}
                </label>
                {subTaskStats?.activeCount ? (
                  <div className="mt-3">
                    <div className="h-2 overflow-hidden rounded-full bg-layer-3">
                      <div
                        className="h-full rounded-full bg-accent-primary transition-[width]"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <p className="mt-2 text-11 text-tertiary">
                      Tiến độ task cha được tự động tính từ các task con và không thể kéo thủ công.
                    </p>
                  </div>
                ) : (
                  <input
                    id="daily-report-progress"
                    className="accent-blue-500 pointer-events-auto mt-3 block h-6 w-full cursor-pointer"
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={progress}
                    onInput={(event) => setProgress(Number(event.currentTarget.value))}
                    onChange={(event) => setProgress(Number(event.currentTarget.value))}
                  />
                )}
              </div>
            </div>
            {status && (
              <div className="mt-4 rounded-md bg-layer-2 px-3 py-2 text-11 break-all text-secondary">{status}</div>
            )}
          </div>
          <div className="pointer-events-auto sticky bottom-0 flex items-center justify-end gap-2 border-t border-subtle bg-surface-1 px-5 py-4">
            <Button variant="secondary" size="sm" disabled={submitting} onClick={closeReport}>
              Hủy
            </Button>
            <Button variant="primary" size="sm" loading={submitting} onClick={() => void submitReport()}>
              Xác nhận
            </Button>
          </div>
        </dialog>,
        document.body
      )
      : null;

  return (
    <div className="shadow-sm rounded-xl border border-subtle bg-layer-1/70 p-4 backdrop-blur-md">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-13 font-semibold text-primary">MetaNode FIAI</div>
          <div className="text-11 text-tertiary">
            {isOnChainTaskSyncEnabled()
              ? ""
              : ""}
          </div>
        </div>
        <Button
          variant="primary"
          size="sm"
          disabled={submitting || Boolean(subTaskStats?.activeCount)}
          onClick={() => {
            setStatus("");
            setIsReportOpen(true);
          }}
        >
          {subTaskStats?.activeCount ? "Tổng hợp từ task con" : "Báo cáo ngày"}
        </Button>
      </div>
      {status && <div className="mt-3 rounded-md bg-layer-2 px-3 py-2 text-11 break-all text-secondary">{status}</div>}
      {reportDialog}
    </div>
  );
}
