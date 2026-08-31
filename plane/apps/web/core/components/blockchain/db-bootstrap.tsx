import { useEffect, useState } from "react";
import { initDAppDB, resolveDBConflict } from "@plane/services";

export function DbBootstrap() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ cid: string, ipfsDB: any } | null>(null);

  useEffect(() => {
    const bootstrap = async () => {
      try {
        const res = await initDAppDB();
        if (res?.status === "CONFLICT") {
          setConflict({ cid: res.cid ?? "", ipfsDB: res.ipfsDB });
        } else {
          setLoading(false);
        }
      } catch (err: any) {
        console.error("DB Bootstrap error:", err);
        setError(err.message || "Lỗi tải cơ sở dữ liệu từ mạng lưới.");
      }
    };
    bootstrap();

    // Lắng nghe sự kiện đổi ví từ MetaNode để nạp lại DB của ví mới
    let bridgeInstance: any = null;
    const handleWalletChanged = () => {
      setLoading(true);
      bootstrap();
    };

    import("@plane/services").then(async () => {
      const { initFiaiSDK, getFiaiSDK } = await import("../../services/blockchain/fiai-sdk.service");
      bridgeInstance = (await initFiaiSDK().catch(() => null)) ?? getFiaiSDK();
      if (bridgeInstance) {
        bridgeInstance.on("wallet-changed", handleWalletChanged);
      }
    });

    return () => {
      if (bridgeInstance) {
        bridgeInstance.off?.("wallet-changed", handleWalletChanged);
      }
    };
  }, []);

  const handleResolve = (choice: "USE_CHAIN" | "USE_LOCAL") => {
    if (conflict) {
      resolveDBConflict(choice, conflict.cid, conflict.ipfsDB);
      setConflict(null);
      setLoading(false);
    }
  };

  if (error) {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-gray-900 bg-opacity-75">
        <div className="bg-white p-6 rounded shadow-lg max-w-sm text-center">
          <h2 className="text-xl font-bold text-red-600 mb-2">Lỗi Tải Dữ Liệu</h2>
          <p className="text-gray-700 mb-4">{error}</p>
          <button 
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Thử Lại (Retry)
          </button>
        </div>
      </div>
    );
  }

  if (conflict) {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-gray-900 bg-opacity-80">
        <div className="bg-white p-6 rounded shadow-lg max-w-lg">
          <h2 className="text-xl font-bold text-yellow-600 mb-2">⚠️ Phát hiện dữ liệu chưa đồng bộ!</h2>
          <p className="text-gray-700 mb-6 text-sm">
            Bạn có một số thay đổi trên thiết bị này chưa được lưu lên Blockchain (bản nháp cục bộ). 
            Trong khi đó, phiên bản trên mạng lưới có thể đã thay đổi. Bạn muốn xử lý thế nào?
          </p>
          <div className="flex flex-col gap-3">
            <button 
              onClick={() => handleResolve("USE_LOCAL")}
              className="px-4 py-2 bg-blue-600 text-white font-medium rounded hover:bg-blue-700 text-left"
            >
              Dùng bản nháp cục bộ (Tiếp tục làm việc)
            </button>
            <button 
              onClick={() => handleResolve("USE_CHAIN")}
              className="px-4 py-2 bg-red-100 text-red-700 font-medium rounded hover:bg-red-200 text-left"
            >
              Xóa nháp & tải bản mới nhất từ Blockchain
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-gray-900 bg-opacity-75 text-white">
        <svg className="animate-spin h-10 w-10 text-blue-500 mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        <p className="text-lg font-medium">Đang tải DApp Database từ Blockchain...</p>
      </div>
    );
  }

  return null;
}
