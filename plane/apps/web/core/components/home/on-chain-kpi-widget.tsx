import { useState } from "react";
import { Button } from "@plane/propel/button";
import { getWalletKPI, type OnChainKPI } from "@/services/blockchain/plane-task-chain.service";

export function OnChainKpiWidget() {
  const [data, setData] = useState<{ wallet: string; kpi: OnChainKPI }>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const load = async () => {
    setLoading(true);
    setError("");
    try {
      setData(await getWalletKPI());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không đọc được KPI");
    } finally {
      setLoading(false);
    }
  };
  const cards = data
    ? [
        ["Tổng task", data.kpi.total],
        ["Hoàn thành", data.kpi.completed],
        ["Đang làm", data.kpi.inProgress],
        ["Đúng tiến độ", data.kpi.onSchedule],
        ["Chậm", data.kpi.delayed],
        ["Quá hạn", data.kpi.overdue],
        ["Tiến độ TB", `${data.kpi.averageProgress}%`],
      ]
    : [];
  return (
    <section className="shadow-sm rounded-2xl border border-subtle bg-layer-1/70 p-5 backdrop-blur-md">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-14 font-semibold text-primary">Dashboard KPI on-chain</div>
          <div className="text-11 text-tertiary">Theo ví MetaNode đang active</div>
        </div>
        <Button size="sm" variant="secondary" loading={loading} onClick={() => void load()}>
          Tải KPI
        </Button>
      </div>
      {data && (
        <>
          <div className="mt-2 truncate text-11 text-tertiary">{data.wallet}</div>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {cards.map(([label, value]) => (
              <div key={label} className="rounded-xl border border-subtle bg-surface-1/70 p-3 backdrop-blur-lg">
                <div className="text-11 text-tertiary">{label}</div>
                <div className="mt-1 text-20 font-semibold text-primary">{value}</div>
              </div>
            ))}
          </div>
        </>
      )}
      {error && <div className="mt-3 rounded-md bg-danger-subtle px-3 py-2 text-11 text-danger-primary">{error}</div>}
    </section>
  );
}
