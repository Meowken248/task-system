import { useState } from "react";
import { syncDAppDBToChain } from "@plane/services";

import { resolveMetanodeWalletAddress, promptForMetanodeWalletImport } from "../../services/blockchain/metanode-wallet.service";

export function SyncToChainButton() {
  const [isSyncing, setIsSyncing] = useState(false);

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      // 1. Lấy địa chỉ ví đã liên kết
      const walletAddress = await resolveMetanodeWalletAddress();
      
      // 2. Gửi transaction trực tiếp (chỉ hỏi mật khẩu ký 1 lần duy nhất)
      try {
        await syncDAppDBToChain(walletAddress);
      } catch (sendErr: any) {
        // Fallback: nếu SDK chưa nhận diện được ví, mới gọi promptForMetanodeWalletImport
        const errMsg = sendErr?.message || sendErr?.toString?.() || "";
        if (/wallet not found|no frame found/i.test(errMsg)) {
          const imported = await promptForMetanodeWalletImport(walletAddress);
          if (imported) {
            await syncDAppDBToChain(walletAddress);
          } else {
            throw sendErr;
          }
        } else {
          throw sendErr;
        }
      }
      alert("Đồng bộ dữ liệu lên Blockchain thành công!");
    } catch (err: any) {
      if (err.message && err.message.includes("LỖI XUNG ĐỘT")) {
        // Bỏ window.location.reload() tự động để user kịp đọc thông báo và backup
        alert(err.message + "\n\nHãy sao lưu thủ công phần việc đang làm trước khi F5!");
      } else if (err.message && err.message.includes("Đã hết thời gian chọn ví")) {
        // User ignored/cancelled wallet picker
      } else {
        alert("Đồng bộ thất bại: " + err.message);
      }
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <button 
      onClick={handleSync} 
      disabled={isSyncing}
      className={`fixed bottom-4 right-4 px-4 py-2 text-white font-medium rounded shadow-lg transition-colors z-50 ${isSyncing ? "bg-gray-500 cursor-not-allowed opacity-75" : "bg-blue-600 hover:bg-blue-700 cursor-pointer"}`}
      style={{
        boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)"
      }}
    >
      {isSyncing ? (
        <span className="flex items-center gap-2">
          <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          Đang ký giao dịch...
        </span>
      ) : (
        "Sync to Chain"
      )}
    </button>
  );
}
