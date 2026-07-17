import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@plane/propel/button";
import { blockchainTrackingService } from "@/services/blockchain/blockchain-tracking.service";
import { getIssueSubTaskStats, isOnChainTaskSyncEnabled, submitIssueDailyReportOnChain, type OnChainSubTaskStats } from "@/services/blockchain/plane-task-chain.service";

type Props = {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  issueName: string;
  ancestorIssueIds: string[];
  canReport: boolean;
  onReportRecorded: (data: { progress: number; transactionHash: string; recordedAt: Date }) => Promise<void>;
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
    if (!isReportOpen || ancestorIssueIds.length > 0) {
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
  }, [isReportOpen, issueId, ancestorIssueIds.length]);
  if (!isOnChainTaskSyncEnabled() || !canReport) return null;

  const closeReport = () => {
    if (!submitting) setIsReportOpen(false);
  };

  const submitReport = async () => {
    // Close the native top-layer dialog before FIAI opens its wallet UI.
    dialogRef.current?.close();
    setIsReportOpen(false);
    setSubmitting(true);
    setStatus("Đang chờ xác nhận ví...");
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    try {
      const result = await submitIssueDailyReportOnChain(
        issueId,
        { progress, work, difficulty, evidence },
        setStatus,
        ancestorIssueIds
      );
      try {
        await blockchainTrackingService.recordDailyReport(workspaceSlug, projectId, {
          issueId,
          issueName,
          transactionHash: result.transactionHash,
          progress: result.progress,
          work,
          difficulty,
          evidence,
        });
      } catch (trackingError) {
        console.error("Báo cáo đã lên blockchain nhưng không ghi được blockchain-data.json:", trackingError);
        setStatus(`Đã gửi on-chain: ${result.transactionHash}. Không ghi được file JSON.`);
        return;
      }
      await onReportRecorded({ progress: result.progress, transactionHash: result.transactionHash, recordedAt: new Date() });
      setStatus(
        result.parentSyncError
          ? `Báo cáo đã thành công (${result.transactionHash}), nhưng chưa đồng bộ được task cha: ${result.parentSyncError}`
          : `Đã gửi báo cáo on-chain: ${result.transactionHash}`
      );
      setWork("");
      setDifficulty("");
      setEvidence("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Giao dịch thất bại");
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
          <div className="relative isolate bg-surface-1 p-5 pointer-events-auto">
            <div className="mb-4 text-16 font-semibold text-primary">Báo cáo cuối ngày</div>
            <div className="space-y-4">
              <textarea
                className="min-h-24 w-full resize-y rounded-md border border-subtle bg-layer-1 p-3 text-13 text-primary outline-none focus:border-accent"
                placeholder="Hôm nay làm gì?"
                value={work}
                onChange={(event) => setWork(event.target.value)}
              />
              <textarea
                className="min-h-20 w-full resize-y rounded-md border border-subtle bg-layer-1 p-3 text-13 text-primary outline-none focus:border-accent"
                placeholder="Khó khăn"
                value={difficulty}
                onChange={(event) => setDifficulty(event.target.value)}
              />
              <input
                className="w-full rounded-md border border-subtle bg-layer-1 px-3 py-2 text-13 text-primary outline-none focus:border-accent"
                placeholder="Evidence URL / mã file"
                value={evidence}
                onChange={(event) => setEvidence(event.target.value)}
              />
              <div className="rounded-md border border-subtle bg-layer-1 p-3">
                <label htmlFor="daily-report-progress" className="block text-12 font-medium text-secondary">
                  Tiến độ: {progress}%{subTaskStats?.activeCount ? ` · ${subTaskStats.completedCount}/${subTaskStats.activeCount} sub-task hoàn thành` : ""}
                </label>
                {subTaskStats?.activeCount ? (
                  <div className="mt-3">
                    <div className="h-2 overflow-hidden rounded-full bg-layer-3">
                      <div className="h-full rounded-full bg-accent-primary transition-[width]" style={{ width: `${progress}%` }} />
                    </div>
                    <p className="mt-2 text-11 text-tertiary">
                      Tiến độ task cha được tự động tính từ các task con và không thể kéo thủ công.
                    </p>
                  </div>
                ) : (
                  <input
                    id="daily-report-progress"
                    className="mt-3 block h-6 w-full cursor-pointer accent-blue-500 pointer-events-auto"
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
          <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-subtle bg-surface-1 px-5 py-4 pointer-events-auto">
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
          <div className="text-11 text-tertiary">Báo cáo ngày và tiến độ được xác thực bởi contract.</div>
        </div>
        <Button
          variant="primary"
          size="sm"
          disabled={submitting}
          onClick={() => {
            setStatus("");
            setIsReportOpen(true);
          }}
        >
          Báo cáo ngày
        </Button>
      </div>
      {status && <div className="mt-3 rounded-md bg-layer-2 px-3 py-2 text-11 break-all text-secondary">{status}</div>}
      {reportDialog}
    </div>
  );
}