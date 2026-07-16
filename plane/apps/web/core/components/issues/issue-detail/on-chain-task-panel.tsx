import { useState } from "react";
import { Button } from "@plane/propel/button";
import {
  assignIssueOnChain,
  getIssueTaskId,
  isOnChainTaskSyncEnabled,
  submitIssueDailyReportOnChain,
} from "@/services/blockchain/plane-task-chain.service";

type Props = { issueId: string; canManage: boolean };

export function OnChainTaskPanel({ issueId, canManage }: Props) {
  const [modal, setModal] = useState<"assign" | "report" | null>(null);
  const [wallet, setWallet] = useState("");
  const [work, setWork] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const [evidence, setEvidence] = useState("");
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!isOnChainTaskSyncEnabled()) return null;

  const run = async (operation: () => Promise<string>) => {
    setSubmitting(true);
    setStatus("Đang chờ xác nhận ví...");
    try {
      const result = await operation();
      setStatus(`Đã gửi on-chain: ${result}`);
      setModal(null);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Giao dịch thất bại");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="shadow-sm rounded-xl border border-subtle bg-layer-1/70 p-4 backdrop-blur-md">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-13 font-semibold text-primary">MetaNode on-chain</div>
          <div className="text-11 text-tertiary">Assignment, daily report và tiến độ được xác thực bởi contract.</div>
        </div>
        <div className="flex gap-2">
          {canManage && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setStatus("");
                setModal("assign");
              }}
            >
              Gán ví
            </Button>
          )}
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              setStatus("");
              setModal("report");
            }}
          >
            Báo cáo ngày
          </Button>
        </div>
      </div>
      {status && <div className="mt-3 rounded-md bg-layer-2 px-3 py-2 text-11 break-all text-secondary">{status}</div>}

      {modal && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-backdrop/70 p-4 backdrop-blur-md">
          <div className="shadow-2xl w-full max-w-lg rounded-2xl border border-subtle bg-surface-1/95 p-5 backdrop-blur-xl">
            <div className="mb-4 text-16 font-semibold text-primary">
              {modal === "assign" ? "Gán ví nhân viên" : "Báo cáo cuối ngày"}
            </div>
            {modal === "assign" ? (
              <input
                className="focus:border-accent w-full rounded-md border border-subtle bg-layer-1 px-3 py-2 text-13 text-primary outline-none"
                placeholder="0x..."
                value={wallet}
                onChange={(event) => setWallet(event.target.value)}
              />
            ) : (
              <div className="space-y-3">
                <textarea
                  className="min-h-20 w-full rounded-md border border-subtle bg-layer-1 p-3 text-13 text-primary outline-none"
                  placeholder="Hôm nay làm gì?"
                  value={work}
                  onChange={(event) => setWork(event.target.value)}
                />
                <textarea
                  className="min-h-16 w-full rounded-md border border-subtle bg-layer-1 p-3 text-13 text-primary outline-none"
                  placeholder="Khó khăn"
                  value={difficulty}
                  onChange={(event) => setDifficulty(event.target.value)}
                />
                <input
                  className="w-full rounded-md border border-subtle bg-layer-1 px-3 py-2 text-13 text-primary outline-none"
                  placeholder="Evidence URL / mã file"
                  value={evidence}
                  onChange={(event) => setEvidence(event.target.value)}
                />
                <label className="block text-12 text-secondary">Tiến độ: {progress}%</label>
                <input
                  className="w-full"
                  type="range"
                  min="0"
                  max="100"
                  value={progress}
                  onChange={(event) => setProgress(Number(event.target.value))}
                />
              </div>
            )}
            {status && (
              <div className="mt-4 rounded-md bg-layer-2 px-3 py-2 text-11 break-all text-secondary">{status}</div>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="secondary" size="sm" disabled={submitting} onClick={() => setModal(null)}>
                Hủy
              </Button>
              <Button
                variant="primary"
                size="sm"
                loading={submitting}
                onClick={() =>
                  void run(async () => {
                    const taskId = await getIssueTaskId(issueId);
                    return modal === "assign"
                      ? assignIssueOnChain(taskId, wallet)
                      : submitIssueDailyReportOnChain(issueId, { progress, work, difficulty, evidence });
                  })
                }
              >
                Xác nhận
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
