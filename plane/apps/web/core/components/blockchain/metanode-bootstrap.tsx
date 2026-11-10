import { useEffect } from "react";
import { observer } from "mobx-react";
import { useUser } from "@/hooks/store/user";
import { configureMetanodeWalletUser } from "@/services/blockchain/metanode-wallet.service";

export const MetanodeBootstrap = observer(function MetanodeBootstrap() {
  const { data: currentUser } = useUser();

  useEffect(() => {
    configureMetanodeWalletUser(currentUser?.id, currentUser?.metanode_wallet_address);
  }, [currentUser?.id, currentUser?.metanode_wallet_address]);

  useEffect(() => {
    let disposed = false;
    // Defer Bridge iframe init — don't block page load with heavy wasm/manifest downloads
    const timer = setTimeout(async () => {
      try {
        const { initFiaiSDK } = await import("@/services/blockchain/fiai-sdk.service");
        const { preloadMetanodeWallet } = await import("@/services/blockchain/metanode-wallet.service");
        if (disposed) return;
        await initFiaiSDK();
        if (!disposed) await preloadMetanodeWallet();
      } catch (error) {
        console.warn("[MetaNode] Chưa kết nối được dịch vụ ví. Có thể thử lại từ Trung tâm ví.", error);
      }
    }, 5000); // Load Bridge 5s after page render

    return () => { disposed = true; clearTimeout(timer); };
  }, []);

  return null;
});
